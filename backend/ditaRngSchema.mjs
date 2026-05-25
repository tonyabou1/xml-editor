import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const rngNamespaceTags = new Set([
  "attribute",
  "choice",
  "data",
  "define",
  "element",
  "empty",
  "grammar",
  "group",
  "include",
  "interleave",
  "list",
  "mixed",
  "name",
  "notAllowed",
  "oneOrMore",
  "optional",
  "param",
  "ref",
  "start",
  "text",
  "value",
  "zeroOrMore",
]);

const documentShells = [
  { key: "topic", label: "Topic", root: "topic", extension: "dita", rng: "technicalContent/rng/topic.rng" },
  { key: "concept", label: "Concept", root: "concept", extension: "dita", rng: "technicalContent/rng/concept.rng" },
  { key: "task", label: "Task", root: "task", extension: "dita", rng: "technicalContent/rng/task.rng" },
  { key: "reference", label: "Reference", root: "reference", extension: "dita", rng: "technicalContent/rng/reference.rng" },
  { key: "map", label: "Map", root: "map", extension: "ditamap", rng: "technicalContent/rng/map.rng" },
];

const schemaCache = new Map();

function stripXmlNoise(source) {
  return source
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeXml(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseAttributes(raw) {
  const attrs = {};
  const attrPattern = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;

  while ((match = attrPattern.exec(raw))) {
    attrs[match[1]] = decodeXml(match[3] ?? match[4] ?? "");
  }

  return attrs;
}

function parseXml(source) {
  const cleanSource = stripXmlNoise(source);
  const root = { name: "#document", attrs: {}, children: [] };
  const stack = [root];
  const tagPattern = /<([^>]+)>/g;
  let match;
  let lastIndex = 0;

  while ((match = tagPattern.exec(cleanSource))) {
    const text = cleanSource.slice(lastIndex, match.index);
    if (text.trim()) {
      stack.at(-1).children.push({ name: "#text", attrs: {}, text: decodeXml(text.trim()), children: [] });
    }

    const raw = match[1].trim();
    lastIndex = tagPattern.lastIndex;
    if (!raw || raw.startsWith("!") || raw.startsWith("?")) {
      continue;
    }

    if (raw.startsWith("/")) {
      const closingName = raw.slice(1).trim().split(/\s+/)[0];
      while (stack.length > 1) {
        const node = stack.pop();
        if (node.name === closingName) {
          break;
        }
      }
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const cleanRaw = selfClosing ? raw.slice(0, -1).trim() : raw;
    const firstSpace = cleanRaw.search(/\s/);
    const name = firstSpace === -1 ? cleanRaw : cleanRaw.slice(0, firstSpace);
    const attrsRaw = firstSpace === -1 ? "" : cleanRaw.slice(firstSpace + 1);
    const node = { name, attrs: parseAttributes(attrsRaw), children: [] };
    stack.at(-1).children.push(node);

    if (!selfClosing) {
      stack.push(node);
    }
  }

  return root;
}

function localName(name) {
  return name.includes(":") ? name.split(":").at(-1) : name;
}

function isRngNode(node, name) {
  return localName(node.name) === name && rngNamespaceTags.has(localName(node.name));
}

function walk(node, visitor) {
  visitor(node);
  for (const child of node.children || []) {
    walk(child, visitor);
  }
}

async function collectRngFiles(rngRoot) {
  const files = [];

  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".rng")) {
        files.push(fullPath);
      }
    }
  }

  await visit(rngRoot);
  return files.sort();
}

function clonePattern(node) {
  return {
    name: localName(node.name),
    attrs: { ...node.attrs },
    text: node.text || "",
    children: (node.children || [])
      .filter((child) => child.name === "#text" || rngNamespaceTags.has(localName(child.name)))
      .map(clonePattern),
  };
}

function mergeDefine(defines, node, sourceFile) {
  const name = node.attrs.name;
  if (!name) {
    return;
  }

  const entry = defines.get(name) || {
    name,
    combine: node.attrs.combine || null,
    sourceFiles: [],
    patterns: [],
  };

  if (node.attrs.combine && !entry.combine) {
    entry.combine = node.attrs.combine;
  }

  entry.sourceFiles.push(sourceFile);
  entry.patterns.push(...node.children.filter((child) => rngNamespaceTags.has(localName(child.name))).map(clonePattern));
  defines.set(name, entry);
}

function collectShellIncludes(rootNode) {
  const includes = [];
  walk(rootNode, (node) => {
    if (isRngNode(node, "include") && node.attrs.href) {
      includes.push(node.attrs.href);
    }
  });
  return includes;
}

async function loadDefinitions(rngRoot) {
  const defines = new Map();
  const elementSources = new Map();
  const shellSources = {};
  const files = await collectRngFiles(rngRoot);

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const root = parseXml(source);
    const relativeSource = path.relative(rngRoot, file).replace(/\\/g, "/");

    for (const shell of documentShells) {
      if (relativeSource === shell.rng) {
        shellSources[shell.key] = {
          ...shell,
          sourceFile: relativeSource,
          includes: collectShellIncludes(root),
        };
      }
    }

    walk(root, (node) => {
      if (isRngNode(node, "define")) {
        mergeDefine(defines, node, relativeSource);
      }
      if (isRngNode(node, "element") && node.attrs.name) {
        const existing = elementSources.get(node.attrs.name) || [];
        existing.push(relativeSource);
        elementSources.set(node.attrs.name, existing);
      }
    });
  }

  return { defines, elementSources, shellSources, files };
}

function normalizePatternList(patterns) {
  if (!patterns.length) {
    return { type: "empty" };
  }
  if (patterns.length === 1) {
    return patterns[0];
  }
  return { type: "sequence", children: patterns };
}

function patternToModel(pattern, defines, options = {}) {
  const refs = options.refs || new Set();
  const tag = pattern.name;

  if (tag === "ref") {
    return { type: "ref", name: pattern.attrs.name };
  }
  if (tag === "text") {
    return { type: "text" };
  }
  if (tag === "empty") {
    return { type: "empty" };
  }
  if (tag === "value") {
    return {
      type: "value",
      value: pattern.children?.find((child) => child.name === "#text")?.text || "",
    };
  }
  if (tag === "element") {
    return { type: "element", name: pattern.attrs.name || "(anonymous)" };
  }
  if (tag === "attribute") {
    return {
      type: "attribute",
      name: pattern.attrs.name || "(anonymous)",
      children: pattern.children.map((child) => patternToModel(child, defines, { refs })),
    };
  }
  if (tag === "optional" || tag === "zeroOrMore" || tag === "oneOrMore") {
    return {
      type: tag,
      children: pattern.children.map((child) => patternToModel(child, defines, { refs })),
    };
  }
  if (tag === "choice" || tag === "group" || tag === "interleave" || tag === "mixed") {
    return {
      type: tag === "group" ? "sequence" : tag,
      children: pattern.children.map((child) => patternToModel(child, defines, { refs })),
    };
  }

  return {
    type: tag,
    children: pattern.children.map((child) => patternToModel(child, defines, { refs })),
  };
}

function getDefineModel(defines, name) {
  const definition = defines.get(name);
  if (!definition) {
    return null;
  }

  const children = definition.patterns.map((pattern) => patternToModel(pattern, defines));
  if (definition.combine === "choice") {
    return { type: "choice", children };
  }
  if (definition.combine === "interleave") {
    return { type: "interleave", children };
  }
  return normalizePatternList(children);
}

function mergeCardinality(current, next) {
  if (!current) {
    return next;
  }

  return {
    min: Math.min(current.min, next.min),
    max: current.max === "*" || next.max === "*" ? "*" : Math.max(current.max, next.max),
  };
}

function unwrapCardinality(type, inherited) {
  if (type === "optional") {
    return { min: 0, max: inherited.max };
  }
  if (type === "zeroOrMore") {
    return { min: 0, max: "*" };
  }
  if (type === "oneOrMore") {
    return { min: Math.max(1, inherited.min), max: "*" };
  }
  return inherited;
}

function collectAllowedChildrenFromModel(model, defines, result, cardinality = { min: 1, max: 1 }, seen = new Set(), depth = 0) {
  if (!model || depth > 12) {
    return;
  }

  if (model.type === "element") {
    const existing = result.get(model.name);
    result.set(model.name, mergeCardinality(existing, cardinality));
    return;
  }

  if (model.type === "ref") {
    if (seen.has(model.name)) {
      return;
    }
    seen.add(model.name);
    const refModel = getDefineModel(defines, model.name);
    collectAllowedChildrenFromModel(refModel, defines, result, cardinality, seen, depth + 1);
    seen.delete(model.name);
    return;
  }

  const nextCardinality = unwrapCardinality(model.type, cardinality);
  for (const child of model.children || []) {
    collectAllowedChildrenFromModel(child, defines, result, nextCardinality, seen, depth + 1);
  }
}

function collectTextAllowance(model, defines, seen = new Set(), depth = 0) {
  if (!model || depth > 12) {
    return false;
  }
  if (model.type === "text") {
    return true;
  }
  if (model.type === "ref") {
    if (seen.has(model.name)) {
      return false;
    }
    seen.add(model.name);
    const allowed = collectTextAllowance(getDefineModel(defines, model.name), defines, seen, depth + 1);
    seen.delete(model.name);
    return allowed;
  }
  return (model.children || []).some((child) => collectTextAllowance(child, defines, seen, depth + 1));
}

function collectRefs(model, result = new Set()) {
  if (!model) {
    return result;
  }
  if (model.type === "ref" && model.name) {
    result.add(model.name);
  }
  for (const child of model.children || []) {
    collectRefs(child, result);
  }
  return result;
}

function collectValuesFromModel(model, result = []) {
  if (!model) {
    return result;
  }
  if (model.type === "value" && model.value) {
    result.push(model.value);
  }
  for (const child of model.children || []) {
    collectValuesFromModel(child, result);
  }
  return result;
}

function summarizeContent(defines, elementName) {
  const model = getDefineModel(defines, `${elementName}.content`);
  const allowed = new Map();
  collectAllowedChildrenFromModel(model, defines, allowed);

  return {
    model,
    content: [...allowed.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, cardinality]) => ({ name, ...cardinality })),
    allowsText: collectTextAllowance(model, defines),
    refs: [...collectRefs(model)].sort(),
  };
}

function collectAttributesFromModel(model, defines, result, seen = new Set(), depth = 0) {
  if (!model || depth > 12) {
    return;
  }

  if (model.type === "ref") {
    if (seen.has(model.name)) {
      return;
    }
    seen.add(model.name);
    collectAttributesFromModel(getDefineModel(defines, model.name), defines, result, seen, depth + 1);
    seen.delete(model.name);
    return;
  }

  if (model.type === "attribute" && model.name) {
    const existing = result.get(model.name) || { name: model.name, values: new Set() };
    for (const value of collectValuesFromModel(model)) {
      existing.values.add(value);
    }
    result.set(model.name, existing);
  }

  for (const child of model.children || []) {
    collectAttributesFromModel(child, defines, result, seen, depth + 1);
  }
}

function collectAttributes(defines, elementName) {
  const result = new Map();
  collectAttributesFromModel(getDefineModel(defines, `${elementName}.attributes`), defines, result);
  collectAttributesFromModel(getDefineModel(defines, `${elementName}.attlist`), defines, result);
  return [...result.values()]
    .map((attribute) => ({
      name: attribute.name,
      values: [...attribute.values],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function collectElements(defines, elementSources) {
  const elementNames = new Set();

  for (const name of defines.keys()) {
    if (name.endsWith(".element")) {
      elementNames.add(name.slice(0, -".element".length));
    }
  }
  for (const name of elementSources.keys()) {
    elementNames.add(name);
  }

  const elements = {};
  for (const elementName of [...elementNames].sort()) {
    const content = summarizeContent(defines, elementName);
    const attributes = collectAttributes(defines, elementName);
    const sources = [
      ...(defines.get(`${elementName}.element`)?.sourceFiles || []),
      ...(elementSources.get(elementName) || []),
    ];

    elements[elementName] = {
      content: content.content,
      contentModel: content.model,
      contentRefs: content.refs,
      allowsText: content.allowsText,
      attributes,
      sourceFiles: [...new Set(sources)].sort(),
    };
  }

  return elements;
}

export async function buildDitaRngSchema({ ditaOtHome, force = false } = {}) {
  const rngRoot = path.join(ditaOtHome, "plugins", "org.oasis-open.dita.v1_3", "rng");
  const cacheKey = rngRoot;

  if (!force && schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey);
  }

  const { defines, elementSources, shellSources, files } = await loadDefinitions(rngRoot);
  const schema = {
    name: "DITA 1.3 RNG schema index",
    source: "Generated from DITA-OT org.oasis-open.dita.v1_3 Relax NG modules. DITA-OT validation remains the final authority.",
    format: "relax-ng",
    version: "1.3",
    rngRoot,
    generatedAt: new Date().toISOString(),
    fileTypes: documentShells.map((shell) => ({
      ...shell,
      sourceFile: shellSources[shell.key]?.sourceFile || shell.rng,
      includes: shellSources[shell.key]?.includes || [],
    })),
    stats: {
      rngFiles: files.length,
      definitions: defines.size,
      elements: elementSources.size,
    },
    elements: collectElements(defines, elementSources),
  };

  schemaCache.set(cacheKey, schema);
  return schema;
}
