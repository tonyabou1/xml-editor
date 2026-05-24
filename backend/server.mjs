import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  listTeamAuthoringProfiles,
  saveTeamAuthoringProfiles,
} from "./authoringProfiles.mjs";
import { requireAuth0User } from "./auth0.mjs";
import { buildDitaRngSchema } from "./ditaRngSchema.mjs";
import { getDatabaseStatus } from "./db.mjs";
import { getGitHubFileDraft, saveGitHubFileDraft } from "./drafts.mjs";
import {
  completeGitHubOAuth,
  checkoutGitHubBranch,
  commitGitHubDrafts,
  createGitHubLocalCommit,
  createGitHubAuthorizeUrl,
  createGitHubBranch,
  getGitHubConfigStatus,
  getGitHubFileContent,
  getGitHubFileContentAtRef,
  getGitHubRepositoryTree,
  getGitHubStatus,
  listGitHubBranches,
  listGitHubCommits,
  listGitHubFileCommits,
  listGitHubLocalCommits,
  listGitHubRepositories,
  publishGitHubLocalCommits,
  selectGitHubRepository,
} from "./github.mjs";
import {
  clearUserNotifications,
  createUserNotification,
  listUserNotifications,
} from "./notifications.mjs";
import { getCurrentProjectTree } from "./projects.mjs";
import {
  listSpecializations,
  previewSpecialization,
  saveSpecialization,
  validateSpecializationDraft,
} from "./specializations.mjs";
import { syncAuthenticatedUser } from "./users.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

async function loadDotEnv() {
  const envPath = path.join(projectRoot, ".env");

  try {
    const raw = await readFile(envPath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) return;

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key] !== undefined) return;

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    });
  } catch {
    // Local development can also provide environment variables from the shell.
  }
}

await loadDotEnv();

const defaultPort = Number(process.env.BACKEND_PORT || 3174);
const defaultHost = process.env.BACKEND_HOST || "127.0.0.1";
const maxRequestBytes = 50 * 1024 * 1024;

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Access-Control-Allow-Origin", process.env.BACKEND_CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

function normalizeRequestPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function normalizeSessionId(value) {
  return String(value || "anonymous")
    .replace(/[^a-z0-9_-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "anonymous";
}

async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxRequestBytes) {
      throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveDitaCommand() {
  const configuredHome = process.env.DITA_OT_HOME;
  const localHome = path.join(projectRoot, "tools", "dita-ot-4.4");
  const homes = [configuredHome, localHome].filter(Boolean);

  for (const home of homes) {
    const command = path.join(home, "bin", process.platform === "win32" ? "dita.bat" : "dita");
    if (await fileExists(command)) {
      return { command, home };
    }
  }

  return { command: process.env.DITA_COMMAND || "dita", home: configuredHome || null };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      shell: false,
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      resolve({
        ok: false,
        exitCode: -1,
        stdout: "",
        stderr: error.message,
      });
    });
    child.on("close", (exitCode) => {
      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function getDitaOtStatus() {
  const { command, home } = await resolveDitaCommand();
  const result = await runCommand(command, ["--version"]);

  return {
    configured: result.ok,
    command,
    home,
    version: result.ok ? `${result.stdout}${result.stderr}`.trim() : null,
    error: result.ok ? null : result.stderr || "DITA-OT command is not available.",
  };
}

async function writeWorkspaceFiles(workspaceDir, files) {
  for (const file of files) {
    const relativePath = normalizeRequestPath(file.path);
    if (!relativePath) {
      throw Object.assign(new Error("Each file must include a safe relative path."), { statusCode: 400 });
    }

    const targetPath = path.join(workspaceDir, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });

    if (file.encoding === "base64") {
      await writeFile(targetPath, Buffer.from(String(file.content ?? ""), "base64"));
      continue;
    }

    if (file.encoding === "data-url") {
      const match = String(file.content ?? "").match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
      if (!match) {
        throw Object.assign(new Error(`File ${relativePath} has an invalid data URL payload.`), { statusCode: 400 });
      }
      await writeFile(targetPath, Buffer.from(match[2], "base64"));
      continue;
    }

    await writeFile(targetPath, String(file.content ?? ""), "utf8");
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generalizeSpecializedDitaContent(content, specializations = []) {
  let generalized = String(content ?? "");
  const applied = [];

  for (const specialization of specializations) {
    const kind = specialization?.kind || specialization?.definition?.kind;
    if (kind !== "element" && kind !== "documentType") continue;
    const name = String(specialization.name || specialization.definition?.name || "").trim();
    const baseName = String(specialization.baseName || specialization.definition?.baseName || "").trim();
    if (!name || !baseName || name === baseName) continue;

    const before = generalized;
    const tagPattern = new RegExp(`<(\\/?)${escapeRegExp(name)}(?=\\s|\\/|>)`, "g");
    generalized = generalized.replace(tagPattern, `<$1${baseName}`);
    if (before !== generalized) {
      applied.push({ name, baseName });
    }
  }

  return { content: ensureStandardDitaDoctype(generalized), applied };
}

function getStandardDitaDoctype(rootName = "") {
  const doctypes = {
    topic: '<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA 1.3 Topic//EN" "topic.dtd">',
    concept: '<!DOCTYPE concept PUBLIC "-//OASIS//DTD DITA 1.3 Concept//EN" "concept.dtd">',
    task: '<!DOCTYPE task PUBLIC "-//OASIS//DTD DITA 1.3 Task//EN" "task.dtd">',
    reference: '<!DOCTYPE reference PUBLIC "-//OASIS//DTD DITA 1.3 Reference//EN" "reference.dtd">',
    map: '<!DOCTYPE map PUBLIC "-//OASIS//DTD DITA 1.3 Map//EN" "map.dtd">',
    bookmap: '<!DOCTYPE bookmap PUBLIC "-//OASIS//DTD DITA 1.3 BookMap//EN" "bookmap.dtd">',
  };

  return doctypes[rootName] || "";
}

function ensureStandardDitaDoctype(content) {
  const source = String(content ?? "");
  const rootMatch = source.match(/<([A-Za-z_][\w:.-]*)(?=\s|\/|>)/);
  const rootName = rootMatch?.[1] || "";
  const doctype = getStandardDitaDoctype(rootName);
  if (!doctype) return source;

  const withoutDoctype = source.replace(/<!DOCTYPE[\s\S]*?>\s*/i, "");
  const declarationMatch = withoutDoctype.match(/^\s*<\?xml[^>]*\?>/i);
  if (declarationMatch) {
    return withoutDoctype.replace(declarationMatch[0], `${declarationMatch[0]}\n${doctype}`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${doctype}\n${withoutDoctype.trimStart()}`;
}

function generalizeValidationFiles(files, specializations = []) {
  if (!Array.isArray(specializations) || !specializations.length) {
    return { files, applied: [] };
  }

  const appliedByFile = [];
  const nextFiles = files.map((file) => {
    if (file.encoding === "base64" || file.encoding === "data-url") {
      return file;
    }

    const { content, applied } = generalizeSpecializedDitaContent(file.content, specializations);
    if (applied.length) {
      appliedByFile.push({ path: file.path, specializations: applied });
      return { ...file, content };
    }
    return file;
  });

  return { files: nextFiles, applied: appliedByFile };
}

function cleanDitaPath(value, workspaceDir) {
  const withoutFileScheme = String(value || "").replace(/^file:/, "");
  let decoded = withoutFileScheme;

  try {
    decoded = decodeURI(decoded);
  } catch {
    decoded = withoutFileScheme;
  }

  return decoded
    .replace(workspaceDir, "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
}

function parseDitaLog(output, workspaceDir = "") {
  const issues = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /\b(error|warn|fatal|exception)\b/i.test(line))
    .map((line) => {
      const locationMatch = line.match(/((?:file:)?[^'"\s]+?\.(?:dita|ditamap|xml)):(\d+):(\d+):\s*(.+)$/i);
      const level = /\b(error|fatal|exception)\b/i.test(line) ? "error" : "warning";
      const message = explainDitaMessage(line);

      if (!locationMatch) {
        return {
          level,
          message,
          raw: line,
        };
      }

      return {
        level,
        file: cleanDitaPath(locationMatch[1], workspaceDir),
        line: Number(locationMatch[2]),
        column: Number(locationMatch[3]),
        message: explainDitaMessage(locationMatch[4].trim()),
        raw: line,
      };
    });

  if (issues.length) {
    return issues;
  }

  const fallback = output.trim();
  return fallback
    ? [{
        level: "error",
        message: fallback.slice(0, 1200),
        raw: fallback,
      }]
    : [];
}

function explainDitaMessage(message) {
  if (/\bDOTJ022F\b/.test(message)) {
    return [
      message,
      "XML Editor did not send a DITAVAL filter for this validation run, so this usually means DITA-OT could not parse the input as valid DITA.",
      "Check the root element, DOCTYPE, required title/body order, and any recent source edits around the reported file.",
    ].join(" ");
  }

  if (/\bDOTJ021[EW]\b/.test(message)) {
    return [
      message,
      "Because XML Editor did not send a DITAVAL filter, this usually points to invalid DITA content rather than intentional filtering.",
    ].join(" ");
  }

  return message;
}

async function validateWithDitaOt({ files, entry, sessionId, specializations = [] }) {
  const status = await getDitaOtStatus();
  if (!status.configured) {
    return {
      ok: false,
      engine: "well-formed-xml",
      ditaOt: status,
      issues: [
        {
          level: "warning",
          message: "DITA-OT is not configured; only backend XML parsing can be checked.",
        },
      ],
    };
  }

  const workspacePrefix = `xml-editor-dita-${normalizeSessionId(sessionId)}-`;
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), workspacePrefix));
  try {
    const generalized = generalizeValidationFiles(files, specializations);
    await writeWorkspaceFiles(workspaceDir, generalized.files);
    const entryPath = path.join(workspaceDir, normalizeRequestPath(entry || files[0]?.path));
    const result = await runCommand(status.command, ["validate", "-i", entryPath], {
      cwd: workspaceDir,
      env: status.home ? { DITA_HOME: status.home } : {},
    });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const issues = parseDitaLog(output, workspaceDir);

    return {
      ok: result.ok,
      engine: "dita-ot",
      ditaOt: status,
      entry: normalizeRequestPath(entry || files[0]?.path),
      issues,
      output,
      exitCode: result.exitCode,
      specializationGeneralization: generalized.applied,
    };
  } finally {
    await rm(workspaceDir, { force: true, recursive: true });
  }
}

function validateXmlWellFormed(files) {
  const issues = [];

  for (const file of files) {
    const content = String(file.content ?? "");
    if (!content.trim()) {
      issues.push({
        level: "error",
        file: file.path,
        message: "File is empty.",
      });
      continue;
    }

    const looksXml = /^\s*</.test(content);
    if (!looksXml) {
      issues.push({
        level: "warning",
        file: file.path,
        message: "File does not look like XML; DITA-OT is required for complete validation.",
      });
    }
  }

  return issues;
}

function cleanAiShortdesc(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

async function generateAiShortdesc({
  activeFileName,
  topicType,
  summaryKind,
  title,
  existingShortdesc,
  paragraphs,
  sections,
  steps,
  referenceBlocks,
  topicrefs,
  inventory,
  validation,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("OPENAI_API_KEY is not configured on the backend."), { statusCode: 503 });
  }

  const model = process.env.OPENAI_SHORTDESC_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const leanContext = {
    activeFileName: String(activeFileName || "Untitled DITA topic").slice(0, 160),
    topicType: String(topicType || "topic").slice(0, 60),
    summaryKind: String(summaryKind || topicType || "topic").slice(0, 60),
    title: String(title || "").replace(/\s+/g, " ").trim().slice(0, 220),
    existingShortdesc: String(existingShortdesc || "").replace(/\s+/g, " ").trim().slice(0, 320),
    paragraphs: Array.isArray(paragraphs)
      ? paragraphs.slice(0, 5).map((paragraph) => ({
          path: String(paragraph.path || "").slice(0, 160),
          words: Number(paragraph.words || 0),
          preview: String(paragraph.preview || "").replace(/\s+/g, " ").trim().slice(0, 180),
        }))
      : [],
    sections: Array.isArray(sections)
      ? sections.slice(0, 8).map((section) => ({
          path: String(section.path || "").slice(0, 160),
          title: String(section.title || "").replace(/\s+/g, " ").trim().slice(0, 160),
          words: Number(section.words || 0),
        }))
      : [],
    steps: Array.isArray(steps)
      ? steps.slice(0, 10).map((step) => ({
          path: String(step.path || "").slice(0, 160),
          command: String(step.command || "").replace(/\s+/g, " ").trim().slice(0, 180),
          words: Number(step.words || 0),
        }))
      : [],
    referenceBlocks: Array.isArray(referenceBlocks)
      ? referenceBlocks.slice(0, 10).map((block) => ({
          path: String(block.path || "").slice(0, 160),
          tagName: String(block.tagName || "").slice(0, 60),
          preview: String(block.preview || "").replace(/\s+/g, " ").trim().slice(0, 180),
        }))
      : [],
    topicrefs: Array.isArray(topicrefs)
      ? topicrefs.slice(0, 30).map((topicref) => ({
          path: String(topicref.path || "").slice(0, 160),
          href: String(topicref.href || "").slice(0, 180),
          navtitle: String(topicref.navtitle || "").replace(/\s+/g, " ").trim().slice(0, 160),
          depth: Number(topicref.depth || 0),
        }))
      : [],
    inventory: Array.isArray(inventory)
      ? inventory.slice(0, 20).map((item) => ({
          name: String(item.name || "").slice(0, 60),
          count: Number(item.count || 0),
        }))
      : [],
    validation: {
      status: String(validation?.status || "unknown").slice(0, 40),
      errorCount: Number(validation?.errorCount || 0),
      warningCount: Number(validation?.warningCount || 0),
      messages: Array.isArray(validation?.messages)
        ? validation.messages.slice(0, 3).map((message) => String(message || "").slice(0, 220))
        : [],
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            "You generate concise DITA shortdesc text for technical authoring.",
            "Return only JSON in this exact shape: {\"shortdesc\":\"...\"}.",
            "The shortdesc must be one sentence, plain text only, no XML tags, 12 to 28 words.",
            "Do not invent product names, version numbers, or facts not present in the supplied context.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify(leanContext),
        },
      ],
    }),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message || "OpenAI shortdesc request failed."), { statusCode: response.status });
  }

  const outputText = body.output_text
    || body.output?.flatMap((item) => item.content || [])
      .map((content) => content.text || "")
      .join("")
    || "";

  let parsed = {};
  try {
    parsed = JSON.parse(outputText);
  } catch {
    parsed = { shortdesc: outputText };
  }

  const shortdesc = cleanAiShortdesc(parsed.shortdesc);
  if (!shortdesc) {
    throw Object.assign(new Error("OpenAI did not return a usable shortdesc."), { statusCode: 502 });
  }

  return {
    model,
    shortdesc,
  };
}

async function generateAiRewrite({
  activeFileName,
  topicType,
  selectedElementName,
  selectedElementPath,
  selectedText,
  instruction,
  context,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("OPENAI_API_KEY is not configured on the backend."), { statusCode: 503 });
  }

  const sourceText = String(selectedText || "").replace(/\s+/g, " ").trim();
  if (!sourceText) {
    throw Object.assign(new Error("Select text before requesting a rewrite."), { statusCode: 400 });
  }

  const model = process.env.OPENAI_REWRITE_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const leanContext = {
    activeFileName: String(activeFileName || "Untitled DITA topic").slice(0, 160),
    topicType: String(topicType || "topic").slice(0, 60),
    selectedElementName: String(selectedElementName || "").slice(0, 60),
    selectedElementPath: String(selectedElementPath || "").slice(0, 180),
    selectedText: sourceText.slice(0, 1800),
    instruction: String(instruction || "Rewrite for clarity and concision.").replace(/\s+/g, " ").trim().slice(0, 220),
    nearbyContext: {
      title: String(context?.title || "").replace(/\s+/g, " ").trim().slice(0, 220),
      summaryKind: String(context?.summaryKind || context?.topicType || "").slice(0, 60),
      paragraphs: Array.isArray(context?.paragraphs)
        ? context.paragraphs.slice(0, 3).map((paragraph) => ({
            path: String(paragraph.path || "").slice(0, 160),
            preview: String(paragraph.preview || "").replace(/\s+/g, " ").trim().slice(0, 180),
          }))
        : [],
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            "You rewrite selected DITA authoring text.",
            "Return only JSON in this exact shape: {\"rewrite\":\"...\"}.",
            "Keep meaning intact, preserve terminology, and do not add XML tags.",
            "Do not invent facts. Keep roughly the same scope unless the instruction asks otherwise.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify(leanContext),
        },
      ],
    }),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message || "OpenAI rewrite request failed."), { statusCode: response.status });
  }

  const outputText = body.output_text
    || body.output?.flatMap((item) => item.content || [])
      .map((content) => content.text || "")
      .join("")
    || "";

  let parsed = {};
  try {
    parsed = JSON.parse(outputText);
  } catch {
    parsed = { rewrite: outputText };
  }

  const rewrite = String(parsed.rewrite || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2400);
  if (!rewrite) {
    throw Object.assign(new Error("OpenAI did not return a usable rewrite."), { statusCode: 502 });
  }

  return {
    model,
    rewrite,
  };
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "xml-editor-backend",
      database: await getDatabaseStatus(),
      ditaOt: await getDitaOtStatus(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/db/health") {
    const database = await getDatabaseStatus();
    sendJson(res, database.ok ? 200 : 503, database);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, account);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/projects/tree") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await getCurrentProjectTree(account.user.id));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/notifications") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await listUserNotifications(account.user.id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notifications") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    sendJson(res, 201, await createUserNotification(account.user.id, body));
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/notifications") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await clearUserNotifications(account.user.id));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/authoring-profiles") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await listTeamAuthoringProfiles(account));
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/authoring-profiles") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    sendJson(res, 200, await saveTeamAuthoringProfiles(account, body));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/github/config") {
    sendJson(res, 200, getGitHubConfigStatus());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/github/oauth-url") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    const authorizeUrl = createGitHubAuthorizeUrl({
      userId: account.user.id,
      returnTo: body.returnTo,
    });

    sendJson(res, 200, { authorizeUrl });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/github/callback") {
    try {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        throw Object.assign(new Error("GitHub did not return a code and state."), { statusCode: 400 });
      }

      const result = await completeGitHubOAuth({ code, state });
      const redirectUrl = new URL(result.returnTo);
      redirectUrl.searchParams.set("github", "connected");
      redirectUrl.searchParams.set("github_login", result.githubLogin);
      res.statusCode = 302;
      res.setHeader("Location", redirectUrl.toString());
      res.end();
    } catch (error) {
      const redirectUrl = new URL(url.searchParams.get("returnTo") || "http://localhost:5175/");
      redirectUrl.searchParams.set("github", "error");
      redirectUrl.searchParams.set("message", error.message || "GitHub connection failed.");
      res.statusCode = 302;
      res.setHeader("Location", redirectUrl.toString());
      res.end();
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/github/status") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await getGitHubStatus(account.user.id));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/github/repos") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, { repositories: await listGitHubRepositories(account.user.id) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/github/branches") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await listGitHubBranches(account.user.id));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/github/commits") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await listGitHubCommits(account.user.id, {
      branch: url.searchParams.get("branch"),
      limit: url.searchParams.get("limit"),
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/github/file-commits") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await listGitHubFileCommits(account.user.id, {
      filePath: url.searchParams.get("path"),
      branch: url.searchParams.get("branch"),
      limit: url.searchParams.get("limit"),
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/github/branches/checkout") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    sendJson(res, 200, await checkoutGitHubBranch(account.user.id, body.branchName));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/github/branches") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    sendJson(res, 200, await createGitHubBranch(account.user.id, body.branchName, body.baseBranch));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/github/commit") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    sendJson(res, 200, await commitGitHubDrafts(account.user.id, body));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/github/local-commits") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await listGitHubLocalCommits(account.user.id, {
      branch: url.searchParams.get("branch"),
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/github/local-commits") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    sendJson(res, 200, await createGitHubLocalCommit(account.user.id, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/github/publish") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    sendJson(res, 200, await publishGitHubLocalCommits(account.user.id, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/github/repository") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    const repository = await selectGitHubRepository(account.user.id, body.fullName);
    sendJson(res, 200, { repository });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/github/tree") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await getGitHubRepositoryTree(account.user.id));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/github/file") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await getGitHubFileContent(account.user.id, url.searchParams.get("path")));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/github/file-version") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await getGitHubFileContentAtRef(account.user.id, {
      filePath: url.searchParams.get("path"),
      ref: url.searchParams.get("ref"),
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/drafts/github") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await getGitHubFileDraft(account.user.id, url.searchParams.get("path")));
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/drafts/github") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    sendJson(res, 200, await saveGitHubFileDraft(account.user.id, body));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/schema/dita") {
    const ditaOt = await getDitaOtStatus();
    if (!ditaOt.home) {
      sendJson(res, 503, {
        error: "DITA-OT home could not be resolved. Set DITA_OT_HOME or install DITA-OT under tools/dita-ot-4.4.",
        ditaOt,
      });
      return;
    }

    const schema = await buildDitaRngSchema({
      ditaOtHome: ditaOt.home,
      force: url.searchParams.get("refresh") === "1",
    });
    sendJson(res, 200, {
      schema,
      ditaOt,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/specializations") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    sendJson(res, 200, await listSpecializations(account));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/specializations/preview") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    const ditaOt = await getDitaOtStatus();
    if (!ditaOt.home) {
      sendJson(res, 503, {
        error: "DITA-OT home could not be resolved. Set DITA_OT_HOME or install DITA-OT under tools/dita-ot-4.4.",
        ditaOt,
      });
      return;
    }
    const schema = await buildDitaRngSchema({ ditaOtHome: ditaOt.home });
    sendJson(res, 200, await previewSpecialization({ account, schema, payload: body }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/specializations") {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const body = await readJsonBody(req);
    const ditaOt = await getDitaOtStatus();
    if (!ditaOt.home) {
      sendJson(res, 503, {
        error: "DITA-OT home could not be resolved. Set DITA_OT_HOME or install DITA-OT under tools/dita-ot-4.4.",
        ditaOt,
      });
      return;
    }
    const schema = await buildDitaRngSchema({ ditaOtHome: ditaOt.home });
    sendJson(res, 201, await saveSpecialization({ account, schema, payload: body }));
    return;
  }

  const validateSpecializationMatch = url.pathname.match(/^\/api\/specializations\/([^/]+)\/validate$/);
  if (req.method === "POST" && validateSpecializationMatch) {
    const identity = await requireAuth0User(req);
    const account = await syncAuthenticatedUser(identity);
    const ditaOt = await getDitaOtStatus();
    if (!ditaOt.home) {
      sendJson(res, 503, {
        error: "DITA-OT home could not be resolved. Set DITA_OT_HOME or install DITA-OT under tools/dita-ot-4.4.",
        ditaOt,
      });
      return;
    }
    const schema = await buildDitaRngSchema({ ditaOtHome: ditaOt.home });
    sendJson(res, 200, await validateSpecializationDraft({
      account,
      schema,
      id: decodeURIComponent(validateSpecializationMatch[1]),
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ai/shortdesc") {
    await requireAuth0User(req);
    const body = await readJsonBody(req);
    sendJson(res, 200, await generateAiShortdesc(body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ai/rewrite") {
    await requireAuth0User(req);
    const body = await readJsonBody(req);
    sendJson(res, 200, await generateAiRewrite(body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/validate") {
    const body = await readJsonBody(req);
    const files = Array.isArray(body.files) ? body.files : [];

    if (!files.length) {
      sendJson(res, 400, { error: "files[] is required." });
      return;
    }

    const result = await validateWithDitaOt({
      files,
      entry: body.entry,
      sessionId: body.sessionId,
      specializations: Array.isArray(body.specializations) ? body.specializations : [],
    });

    if (result.engine !== "dita-ot") {
      const fallbackIssues = validateXmlWellFormed(files);
      sendJson(res, 200, {
        ...result,
        ok: fallbackIssues.every((issue) => issue.level !== "error"),
        issues: [...result.issues, ...fallbackIssues],
      });
      return;
    }

    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Backend request failed.",
      ...(error.conflicts ? { conflicts: error.conflicts } : {}),
    });
  });
});

server.listen(defaultPort, defaultHost, () => {
  console.log(`XML editor backend listening on http://${defaultHost}:${defaultPort}`);
});
