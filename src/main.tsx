import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { DiffEditor } from "@monaco-editor/react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { appMenus } from "./config/appMenus";
import { authoringRibbonGroups } from "./config/authoringRibbon";
import "./styles.css";
import {
  formatGitCommitDate,
  formatNotificationTime,
  formatTerminalTime,
  getGitBranchDisplayName,
} from "./utils/formatters";
import {
  getProjectNodePath,
  getProjectPathParts,
  getRelativeProjectHref,
  isExternalHref,
  normalizeProjectPath,
  resolveProjectHref,
  splitHrefFragment,
} from "./utils/path";
import { createValidationReportContent } from "./validation/report";
import {
  collectSpellingIssuesForDocument,
  collectSpellingIssuesForText,
  collectSpellingTextSegmentsForDocument,
  isSpellcheckSkippedElement,
  resolveXmlLanguageForElement,
  spellingEngineVersion,
  type SpellingIssue,
  type SpellingTextSegment,
} from "./spelling/checker";
import type {
  AttributeDefinition,
  ElementDefinition,
  DitaSchemaProfile,
  HrefValidationState,
  HrefValidationMap,
  ChatMessage,
  AiContext,
  LeanDitaContext,
  AiOperation,
  AiSuggestion,
  NotificationSeverity,
  AppNotification,
  SidePanelId,
  AppMenuCommand,
  AppMenuItem,
  AppMenuDefinition,
  SearchResult,
  ValidationState,
  ValidationRun,
  TerminalMessage,
  AppAccount,
  GitHubRepository,
  GitHubStatus,
  GitBranch,
  GitCommitSummary,
  GitLocalCommitFile,
  GitLocalCommit,
  GitConflictPayload,
  FileGitHistoryPayload,
  GitHubTreeEntry,
  DraftSaveState
} from "./types";

const editableCaretSeed = "\u200b";

function stripEditableCaretSeed(value = "") {
  return value.replace(/\u200b/g, "");
}

const starterXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA 1.3 Topic//EN" "topic.dtd">
<topic id="browser-xml-editor">
  <title>Browser XML Editor</title>
  <shortdesc>Edit DITA topic content in a structured WYSIWYG surface.</shortdesc>
  <body>
    <section id="overview">
      <title>Overview</title>
      <p>This editor keeps XML source and the visual document synchronized. See <xref href="related-topic.dita">sample related topic</xref>.</p>
      <note type="tip">Use the insert bar to add DITA-safe elements.</note>
      <fig id="sample-figure">
        <title>Sample figure</title>
        <image href="../assets/sample-figure.png" alt="Placeholder DITA image"/>
      </fig>
    </section>
    <section id="workflow">
      <title>Workflow</title>
      <p>Validate the document, format the XML, and export the topic when ready.</p>
      <ul>
        <li>Edit the rendered DITA topic.</li>
        <li>Inspect the source XML.</li>
        <li>Fix schema issues before publishing.</li>
      </ul>
    </section>
  </body>
</topic>`;

const brokenDitaXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA 1.3 Topic//EN" "topic.dtd">
<topic id="broken-validation-sample">
  <body>
    <p>This body appears before the required title, so DITA-OT should report a schema error.</p>
  </body>
  <title>Broken validation sample</title>
</topic>`;

const relatedTopicXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA 1.3 Topic//EN" "topic.dtd">
<topic id="related-topic">
  <title>Sample related topic</title>
  <shortdesc>A valid referenced topic used by the starter sample.</shortdesc>
  <body>
    <p>This topic exists so xref validation can resolve a real DITA target.</p>
  </body>
</topic>`;

const aiReviewSampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE concept PUBLIC "-//OASIS//DTD DITA 1.3 Concept//EN" "concept.dtd">
<concept id="ai-review-sample">
  <title>AI review sample</title>
  <conbody>
    <p>This paragraph is intentionally long so the ambient AI review can flag it as a candidate for splitting into smaller DITA blocks. It describes a publishing workflow where authors update release notes, validate references, coordinate with reviewers, confirm image links, verify conref targets, prepare branch changes, and publish the final topic after the content passes all required checks. The paragraph keeps going so it crosses the configured threshold and creates a useful test case for the first review foundation.</p>
    <note>This note intentionally has no type attribute so the AI Review can suggest adding type="note".</note>
  </conbody>
</concept>`;

const sampleImagePreviewUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAYAAABkW7XSAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAANSURBVHhe7cEBAQAAAMKg9U9tDB8gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgYwEoAAABP9sEWAAAAABJRU5ErkJggg==";
const backendBaseUrl = import.meta.env.VITE_XML_EDITOR_BACKEND_URL || "http://127.0.0.1:3174";
const specializationsTabId = "system-specializations-workbench";
const specializationsTabFile = {
  id: specializationsTabId,
  name: "Specializations",
  type: "file",
  ditaType: "specializations",
  content: "",
};
const visualTemplatesTabId = "system-visual-template-designer";
const visualTemplatesTabFile = {
  id: visualTemplatesTabId,
  name: "Visual Template",
  type: "file",
  ditaType: "visual-template",
  content: "",
};
const visualTemplatePageSize = { width: 760, height: 560 };
const visualTemplateGridDefaults = {
  showGrid: true,
  gridSize: 16,
  snapToGrid: true,
  snapToObjects: true,
  snapThreshold: 4,
  columnGuideCount: 0,
  zoom: 1,
};
type VisualTemplateResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
const defaultVisualTemplateModel = {
  artifactType: "template",
  id: "topic-deliverable-template",
  name: "Topic deliverable template",
  template: {
    id: "topic-deliverable-template",
    name: "Topic deliverable template",
    source: "built-in",
  },
  output: "responsive-html",
  filePath: "",
  regions: [
    {
      id: "hero",
      label: "Hero",
      kind: "container",
      role: "headline",
      binding: "title",
      notes: "Primary title slot for the selected topic or map.",
      layout: { x: 28, y: 28, width: 704, height: 150, zIndex: 1 },
      style: {
        fillMode: "gradient",
        backgroundColor: "#eef5ff",
        gradientFrom: "#eef5ff",
        gradientTo: "#fff7ed",
        gradientAngle: 135,
        backgroundImage: "",
        backgroundImageMode: "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundOverlayColor: "#000000",
        backgroundOverlayOpacity: 0,
        borderColor: "#b9c9df",
        borderWidth: 1,
        borderRadius: 8,
        padding: 14,
        minHeight: 150,
        shadowPreset: "soft",
        shadowColor: "#23406f",
        shadowOpacity: 14,
        shadowX: 0,
        shadowY: 18,
        shadowBlur: 38,
        animationName: "none",
        animationDuration: 600,
        animationDelay: 0,
      },
      textStyle: {
        color: "#172033",
        fontSize: 13,
        fontWeight: 650,
        textAlign: "left",
      },
    },
    {
      id: "heroTitle",
      label: "Title",
      kind: "slot",
      parentId: "hero",
      role: "headline",
      binding: "title",
      notes: "Primary title slot inside the hero container.",
      layout: { x: 22, y: 30, width: 470, height: 44, zIndex: 2 },
      style: {},
      textStyle: {
        color: "#172033",
        fontSize: 22,
        fontWeight: 800,
        textAlign: "left",
      },
    },
    {
      id: "summary",
      label: "Summary",
      kind: "slot",
      parentId: "hero",
      role: "deck",
      binding: "shortdesc",
      notes: "Short description or generated abstract.",
      layout: { x: 22, y: 88, width: 470, height: 38, zIndex: 2 },
      style: {},
      textStyle: {
        color: "#475467",
        fontSize: 13,
        fontWeight: 550,
        textAlign: "left",
      },
    },
    {
      id: "body",
      label: "Body",
      kind: "container",
      role: "flow",
      binding: "bodyParagraphs",
      notes: "Main authored paragraphs and sections.",
      layout: { x: 28, y: 196, width: 500, height: 320, zIndex: 1 },
      style: {
        fillMode: "solid",
        backgroundColor: "#ffffff",
        gradientFrom: "#ffffff",
        gradientTo: "#eef5ff",
        gradientAngle: 135,
        backgroundImage: "",
        backgroundImageMode: "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundOverlayColor: "#000000",
        backgroundOverlayOpacity: 0,
        borderColor: "#b9c9df",
        borderWidth: 1,
        borderRadius: 8,
        padding: 14,
        minHeight: 260,
        shadowPreset: "none",
        shadowColor: "#23406f",
        shadowOpacity: 12,
        shadowX: 0,
        shadowY: 12,
        shadowBlur: 24,
        animationName: "none",
        animationDuration: 600,
        animationDelay: 0,
      },
      textStyle: {
        color: "#475467",
        fontSize: 13,
        fontWeight: 500,
        textAlign: "left",
      },
    },
    {
      id: "sidebar",
      label: "Sidebar",
      kind: "container",
      role: "navigation",
      binding: "topicrefs",
      notes: "Map topic references or supporting links.",
      layout: { x: 552, y: 196, width: 180, height: 320, zIndex: 1 },
      style: {
        fillMode: "solid",
        backgroundColor: "#fbfdff",
        gradientFrom: "#fbfdff",
        gradientTo: "#eef5ff",
        gradientAngle: 135,
        backgroundImage: "",
        backgroundImageMode: "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundOverlayColor: "#000000",
        backgroundOverlayOpacity: 0,
        borderColor: "#b9c9df",
        borderWidth: 1,
        borderRadius: 8,
        padding: 14,
        minHeight: 260,
        shadowPreset: "none",
        shadowColor: "#23406f",
        shadowOpacity: 12,
        shadowX: 0,
        shadowY: 12,
        shadowBlur: 24,
        animationName: "none",
        animationDuration: 600,
        animationDelay: 0,
      },
      textStyle: {
        color: "#2f5ea7",
        fontSize: 11,
        fontWeight: 750,
        textAlign: "left",
      },
    },
  ],
};

const visualTemplateStyleDefaults = {
  layout: {
    x: 40,
    y: 40,
    width: 260,
    height: 160,
    zIndex: 1,
  },
  style: {
    fillMode: "solid",
    backgroundColor: "#ffffff",
    gradientFrom: "#ffffff",
    gradientTo: "#eef5ff",
    gradientAngle: 135,
    backgroundImage: "",
    backgroundImageMode: "none",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundOverlayColor: "#000000",
    backgroundOverlayOpacity: 0,
    borderColor: "#b9c9df",
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    minHeight: 120,
    shadowPreset: "none",
    shadowColor: "#23406f",
    shadowOpacity: 12,
    shadowX: 0,
    shadowY: 12,
    shadowBlur: 24,
    animationName: "none",
    animationDuration: 600,
    animationDelay: 0,
  },
  textStyle: {
    color: "#172033",
    fontSize: 13,
    fontWeight: 500,
    textAlign: "left",
  },
};

function normalizeVisualTemplateLayout(layout: any, fallback: any = visualTemplateStyleDefaults.layout) {
  const source = layout && typeof layout === "object" ? layout : {};
  return {
    ...fallback,
    x: Number.isFinite(Number(source.x)) ? Number(source.x) : fallback.x,
    y: Number.isFinite(Number(source.y)) ? Number(source.y) : fallback.y,
    width: Number.isFinite(Number(source.width)) ? Number(source.width) : fallback.width,
    height: Number.isFinite(Number(source.height)) ? Number(source.height) : fallback.height,
    zIndex: Number.isFinite(Number(source.zIndex)) ? Number(source.zIndex) : fallback.zIndex,
  };
}

function normalizeVisualTemplateGridSettings(settings: any) {
  const source = settings && typeof settings === "object" ? settings : {};
  const gridSize = Number(source.gridSize);
  const snapThreshold = Number(source.snapThreshold);
  const zoom = Number(source.zoom);
  const columnGuideCount = Number(source.columnGuideCount);

  return {
    ...visualTemplateGridDefaults,
    ...source,
    gridSize: [8, 16, 24].includes(gridSize) ? gridSize : visualTemplateGridDefaults.gridSize,
    snapThreshold: Number.isFinite(snapThreshold) ? Math.max(1, Math.min(16, snapThreshold)) : visualTemplateGridDefaults.snapThreshold,
    columnGuideCount: [0, 2, 3, 12].includes(columnGuideCount) ? columnGuideCount : visualTemplateGridDefaults.columnGuideCount,
    zoom: Number.isFinite(zoom) ? Math.max(0.25, Math.min(4, zoom)) : visualTemplateGridDefaults.zoom,
    showGrid: source.showGrid !== false,
    snapToGrid: source.snapToGrid !== false,
    snapToObjects: source.snapToObjects !== false,
  };
}

function normalizeVisualTemplateStyle(style: any, fallback: any = {}) {
  return {
    ...fallback,
    ...(style && typeof style === "object" ? style : {}),
  };
}

function hexToRgbColor(hex = "#000000") {
  const clean = String(hex || "#000000").replace("#", "").trim();
  const expanded = clean.length === 3
    ? clean.split("").map((char) => `${char}${char}`).join("")
    : clean;
  const value = Number.parseInt(expanded.padEnd(6, "0").slice(0, 6), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbaFromHexColor(hex = "#000000", opacity = 100) {
  const { r, g, b } = hexToRgbColor(hex);
  const alpha = Math.max(0, Math.min(100, Number(opacity) || 0)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function cssUrlValue(value = "") {
  const clean = String(value || "").trim();
  if (!clean) return "";
  return `url("${clean.replace(/"/g, "%22")}")`;
}

function normalizeVisualTemplateModel(rawModel: any) {
  const model = rawModel && typeof rawModel === "object" ? rawModel : {};
  const artifactType = model.artifactType === "binding" ? "binding" : "template";
  const template = model.template && typeof model.template === "object"
    ? model.template
    : defaultVisualTemplateModel.template;
  const defaultRegionsById = new Map(defaultVisualTemplateModel.regions.map((region) => [region.id, region]));
  const regions = Array.isArray(model.regions)
    ? model.regions.map((region) => {
        const fallback = defaultRegionsById.get(region?.id) || defaultVisualTemplateModel.regions[0];
        const normalizedRegion = {
          ...fallback,
          ...(region && typeof region === "object" ? region : {}),
        };
        return {
          ...normalizedRegion,
          kind: normalizedRegion.kind || (normalizedRegion.parentId ? "slot" : "container"),
          layout: normalizeVisualTemplateLayout(region?.layout, fallback.layout || visualTemplateStyleDefaults.layout),
          style: normalizeVisualTemplateStyle(region?.style, fallback.style || visualTemplateStyleDefaults.style),
          textStyle: normalizeVisualTemplateStyle(region?.textStyle, fallback.textStyle || visualTemplateStyleDefaults.textStyle),
        };
      })
    : defaultVisualTemplateModel.regions;

  return {
    ...defaultVisualTemplateModel,
    ...model,
    artifactType,
    gridSettings: normalizeVisualTemplateGridSettings(model.gridSettings),
    template,
    regions,
  };
}

function parseVisualTemplateModel(content: string) {
  try {
    return normalizeVisualTemplateModel(JSON.parse(String(content || "")));
  } catch {
    return normalizeVisualTemplateModel(defaultVisualTemplateModel);
  }
}
const authoringProfileTabPrefix = "system-authoring-profile";
const validationSessionId = (
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const commonAttributeDefinitions: AttributeDefinition[] = [
  { name: "id", label: "id", placeholder: "optional-id" },
  { name: "outputclass", label: "outputclass", placeholder: "style token" },
  { name: "class", label: "class", placeholder: "DITA specialization class" },
];

const linkAttributeDefinitions: AttributeDefinition[] = [
  { name: "href", label: "href", placeholder: "Drop a DITA file or type a relative href" },
  { name: "keyref", label: "keyref", placeholder: "topic-key" },
  { name: "format", label: "format", placeholder: "dita" },
  { name: "scope", label: "scope", placeholder: "local" },
];

const fallbackDitaSchemaProfile: DitaSchemaProfile = {
  fileTypes: [
  { key: "topic", label: "Topic", extension: "dita" },
  { key: "concept", label: "Concept", extension: "dita" },
  { key: "task", label: "Task", extension: "dita" },
  { key: "reference", label: "Reference", extension: "dita" },
  { key: "map", label: "Map", extension: "ditamap" },
  ],
  rootElements: ["topic", "concept", "task", "reference", "map"],
  elements: {
    topic: { children: ["title", "shortdesc", "body"], uniqueChildren: ["title", "shortdesc", "body"] },
    concept: { children: ["title", "shortdesc", "conbody"], uniqueChildren: ["title", "shortdesc", "conbody"] },
    task: { children: ["title", "shortdesc", "taskbody"], uniqueChildren: ["title", "shortdesc", "taskbody"] },
    reference: { children: ["title", "shortdesc", "refbody"], uniqueChildren: ["title", "shortdesc", "refbody"] },
    map: { children: ["title", "topicref"], attributes: [], orderedChildren: true, uniqueChildren: ["title"] },
    body: { children: ["section", "p", "ul", "ol", "note", "codeblock"] },
    conbody: { children: ["section", "p", "ul", "ol", "note", "codeblock", "fig", "image"] },
    taskbody: { children: ["context", "steps", "result", "section", "p", "note", "fig", "image"] },
    refbody: { children: ["section", "p", "ul", "ol", "note", "codeblock", "fig", "image"] },
    section: {
      children: ["title", "p", "ul", "ol", "note", "codeblock", "fig", "image", "xref"],
      template: "section",
    },
    context: { children: ["p", "note", "fig", "image"] },
    steps: { children: ["step"], requiredChildren: ["step"], orderedChildren: true, childOrder: ["step"] },
    step: { children: ["cmd", "info", "stepxmp"], requiredChildren: ["cmd"], orderedChildren: true, childOrder: ["cmd", "info", "stepxmp"] },
    cmd: { children: ["ph", "xref", "image", "b", "i", "u", "codeph"], inlineContainer: true },
    info: { children: ["p", "note", "fig", "image"] },
    stepxmp: { children: ["p", "codeblock"] },
    result: { children: ["p", "note", "fig", "image"] },
    fig: { children: ["title", "image", "p"], template: "fig" },
    topicref: {
      children: ["topicref"],
      template: "topicref",
      attributes: [
        ...commonAttributeDefinitions,
        { name: "href", label: "href", placeholder: "../topics/topic.dita" },
        { name: "navtitle", label: "navtitle", placeholder: "Navigation title" },
        { name: "keys", label: "keys", placeholder: "topic-key" },
        { name: "keyscope", label: "keyscope", placeholder: "scope-name" },
        { name: "format", label: "format", placeholder: "dita" },
        { name: "scope", label: "scope", placeholder: "local" },
      ],
    },
    ul: { children: ["li"], requiredChildren: ["li"], orderedChildren: true, childOrder: ["li"], template: "list" },
    ol: { children: ["li"], requiredChildren: ["li"], orderedChildren: true, childOrder: ["li"], template: "list" },
    li: { children: ["p", "ul", "ol", "note", "fig", "image", "xref", "ph"] },
    p: { children: ["ph", "xref", "image", "b", "i", "u", "codeph"], inlineContainer: true, template: "emptyText" },
    note: {
      children: ["p", "ph", "xref", "image", "codeblock"],
      template: "note",
      attributes: [
        ...commonAttributeDefinitions,
        {
          name: "type",
          label: "type",
          placeholder: "note",
          values: ["note", "tip", "fastpath", "restriction", "important", "remember", "attention", "caution", "notice", "danger", "warning"],
        },
      ],
    },
    title: { children: ["ph"], inlineContainer: true, template: "title" },
    shortdesc: { children: ["ph", "xref", "image"], inlineContainer: true },
    codeblock: { children: [], template: "codeblock" },
    image: {
      children: [],
      template: "image",
      attributes: [
        ...commonAttributeDefinitions,
        { name: "href", label: "href / location", placeholder: "image.png" },
        { name: "alt", label: "alt", placeholder: "Image description" },
        {
          name: "placement",
          label: "placement",
          placeholder: "inline",
          values: ["inline", "break"],
        },
        { name: "width", label: "width", placeholder: "320px, 4in, 50%" },
        { name: "height", label: "height", placeholder: "180px, 2in" },
        {
          name: "align",
          label: "align",
          placeholder: "center",
          values: ["left", "right", "center", "current"],
        },
        { name: "scale", label: "scale", placeholder: "50" },
        {
          name: "scalefit",
          label: "scalefit",
          placeholder: "yes",
          values: ["yes", "no"],
        },
        {
          name: "expanse",
          label: "expanse",
          placeholder: "textline",
          values: ["page", "column", "textline"],
        },
      ],
    },
    xref: {
      children: [],
      inline: true,
      template: "xref",
      attributes: [...commonAttributeDefinitions, ...linkAttributeDefinitions],
    },
    ph: { children: ["xref", "image", "b", "i", "u", "codeph"], inline: true, inlineContainer: true, template: "emptyText" },
    b: { children: ["ph", "xref", "image", "i", "u", "codeph"], inline: true, inlineContainer: true, template: "emptyText" },
    i: { children: ["ph", "xref", "image", "b", "u", "codeph"], inline: true, inlineContainer: true, template: "emptyText" },
    u: { children: ["ph", "xref", "image", "b", "i", "codeph"], inline: true, inlineContainer: true, template: "emptyText" },
    codeph: { children: ["ph", "xref", "image", "b", "i", "u"], inline: true, inlineContainer: true, template: "emptyText" },
  },
};

let activeBaseDitaSchemaProfile: DitaSchemaProfile = fallbackDitaSchemaProfile;
let activeDitaSchemaProfile: DitaSchemaProfile = fallbackDitaSchemaProfile;
let activeSpecializationDefinitions: any[] = [];
let activeDitaSchemaDocumentType = "";
let activeAuthoringProfiles: Record<string, { enabled: boolean; visibleElements: string[] }> = {};

function getActiveDitaSchemaProfile(): DitaSchemaProfile {
  return activeDitaSchemaProfile;
}

function getDocumentRootElementNames() {
  const profile = getActiveDitaSchemaProfile();

  return new Set(
    [
      ...(profile.rootElements || []),
      ...(profile.fileTypes || []).map((fileType) => fileType.key),
    ].filter(Boolean)
  );
}

function isDocumentRootElement(tagName: string) {
  return getDocumentRootElementNames().has(tagName);
}

function isTopicRootCandidate(tagName: string) {
  if (!tagName) return false;
  if (isDocumentRootElement(tagName)) return true;

  const definition = getElementDefinition(tagName);
  return Boolean(definition?.contentRefs?.includes(`${tagName}-info-types`));
}

function getSpecializationByName(tagName: string) {
  return activeSpecializationDefinitions.find((specialization) => specialization.name === tagName) || null;
}

function getSpecializationClassChain(tagName: string): string {
  return getSpecializationByName(tagName)?.classChain ||
    getSpecializationByName(tagName)?.definition?.classChain ||
    getSpecializationByName(tagName)?.definition?.inheritedElement?.classChain ||
    "";
}

function getSpecializationDefinition(specialization: any) {
  return specialization?.definition || specialization || {};
}

function isValidSpecialization(specialization: any) {
  return specialization?.status === "valid";
}

function classChainIncludesBaseElement(classChain = "", baseName: string) {
  if (!classChain || !baseName) return false;
  return classChain.split(/\s+/).some((token) => token.endsWith(`/${baseName}`));
}

function getDefinitionClassChain(definition: Partial<ElementDefinition> | null | undefined): string {
  return [
    definition?.classChain,
    (definition as any)?.class,
    (definition as any)?.ditaClass,
    (definition as any)?.className,
    ...(Array.isArray(definition?.attributes)
      ? definition.attributes
          .filter((attribute) => attribute.name === "class")
          .flatMap((attribute) => [
            (attribute as any).defaultValue,
            (attribute as any).value,
            attribute.placeholder,
          ])
      : []),
  ]
    .filter(Boolean)
    .map(String)
    .join(" ");
}

function definitionContentRefsInclude(definition: Partial<ElementDefinition> | null | undefined, refName: string): boolean {
  return Boolean(
    Array.isArray(definition?.contentRefs) &&
    definition.contentRefs.some((ref) => String(ref) === refName),
  );
}

function definitionSpecializesFrom(
  definition: Partial<ElementDefinition> | null | undefined,
  baseName: string,
  visited = new Set<string>(),
): boolean {
  if (!definition || !baseName) return false;

  const definitionName = String((definition as any).name || "");
  const definitionBase = definition.baseName || (definition as any).base || (definition as any).specializesFrom || "";
  const classChain = getDefinitionClassChain(definition);

  if (definitionName === baseName || definitionBase === baseName || classChainIncludesBaseElement(classChain, baseName)) {
    return true;
  }

  if (baseName === "body" && definitionContentRefsInclude(definition, "body.cnt")) {
    return true;
  }

  return Boolean(definitionBase && !visited.has(definitionBase) && elementSpecializesFrom(definitionBase, baseName, visited));
}

function elementSpecializesFrom(tagName: string, baseName: string, visited = new Set<string>()): boolean {
  if (!tagName || !baseName || visited.has(tagName)) return false;
  if (tagName === baseName) return true;
  if (tagName === "step" && baseName === "li") return true;

  visited.add(tagName);

  const definition = getElementDefinition(tagName);
  const specialization = getSpecializationByName(tagName);
  const specializationBase = specialization?.baseName || specialization?.definition?.baseName || definition?.baseName || "";
  const classChain = getSpecializationClassChain(tagName);

  return specializationBase === baseName ||
    classChainIncludesBaseElement(classChain, baseName) ||
    definitionSpecializesFrom(definition, baseName, visited) ||
    Boolean(specializationBase && elementSpecializesFrom(specializationBase, baseName, visited));
}

function nodeSpecializesFrom(node: Element | null | undefined, baseName: string): boolean {
  if (!node) return false;
  return elementSpecializesFrom(node.tagName, baseName) ||
    classChainIncludesBaseElement(node.getAttribute("class") || "", baseName);
}

function getSpecializationScope(specialization: any): string[] {
  const definition = getSpecializationDefinition(specialization);
  const scope = specialization?.allowedDocumentTypes || definition.allowedDocumentTypes || [];
  return Array.isArray(scope) ? scope.map((item) => String(item).trim()).filter(Boolean) : [];
}

function specializationAppliesToDocument(specialization: any, documentType: string) {
  const scope = getSpecializationScope(specialization);
  if (scope.length === 0) return true;
  if (scope.includes(documentType)) return true;
  const baseRoot = getBaseSchemaRootForDocumentType(documentType);
  return Boolean(baseRoot && scope.includes(baseRoot));
}

function getDocumentTypeSpecialization(documentType: string) {
  return getValidDocumentSpecializations().find((specialization) => (
    specialization.name === documentType || specialization.definition?.name === documentType
  )) || null;
}

function getAuthoringProfileForDocument(documentType: string) {
  const configuredProfile = activeAuthoringProfiles[documentType];
  if (configuredProfile?.enabled) {
    return {
      visibleElements: Array.isArray(configuredProfile.visibleElements)
        ? configuredProfile.visibleElements.map((item) => String(item).trim()).filter(Boolean)
        : [],
    };
  }

  const specialization = getDocumentTypeSpecialization(documentType);
  const profile = specialization?.definition?.authoringProfile || specialization?.authoringProfile || null;
  if (!profile?.enabled) return null;

  return {
    visibleElements: Array.isArray(profile.visibleElements)
      ? profile.visibleElements.map((item) => String(item).trim()).filter(Boolean)
      : [],
  };
}

function getAuthoringDocumentTypeForNode(node: Element | null | undefined) {
  return node?.ownerDocument?.documentElement?.tagName || activeDitaSchemaDocumentType || "";
}

function applyAuthoringVisibilityFilter(options: string[], parentNode?: Element | null) {
  const documentType = getAuthoringDocumentTypeForNode(parentNode);
  const profile = getAuthoringProfileForDocument(documentType);
  if (!profile) return options;

  const visible = new Set(profile.visibleElements || []);
  const required = new Set(getElementDefinition(parentNode?.tagName || "")?.requiredChildren || []);
  return options.filter((tagName) => visible.has(tagName) || required.has(tagName));
}

function getValidDocumentSpecializations(specializations = activeSpecializationDefinitions) {
  return specializations.filter((specialization) => (
    isValidSpecialization(specialization) &&
    (specialization?.kind || specialization?.definition?.kind) === "documentType"
  ));
}

function getBaseSchemaRootForDocumentType(documentType: string) {
  if (!documentType) return "";
  if (fallbackDitaSchemaProfile.rootElements.includes(documentType)) return documentType;
  const specialization = getValidDocumentSpecializations().find((item) => item.name === documentType || item.definition?.name === documentType);
  return specialization?.baseName || specialization?.definition?.baseName || "";
}

function getDocumentTypeIconKind(documentType: string) {
  const builtInKind = ["topic", "concept", "task", "reference", "map"].includes(documentType)
    ? documentType
    : "";
  return builtInKind || getBaseSchemaRootForDocumentType(documentType) || documentType || "file";
}

function getDocumentTypeFileExtension(typeKey: string) {
  return getActiveDitaSchemaProfile().fileTypes.find((fileType) => fileType.key === typeKey)?.extension ||
    genericFileTypes.find((fileType) => fileType.key === typeKey)?.extension ||
    (typeKey === "map" ? "ditamap" : "dita");
}

function getDocumentTypeLabel(typeKey: string) {
  return getActiveDitaSchemaProfile().fileTypes.find((fileType) => fileType.key === typeKey)?.label ||
    genericFileTypes.find((fileType) => fileType.key === typeKey)?.label ||
    typeKey;
}

function applySpecializationOverlays(profile: DitaSchemaProfile, specializations: any[] = [], documentType = activeDitaSchemaDocumentType): DitaSchemaProfile {
  const elements: Record<string, ElementDefinition> = Object.fromEntries(
    Object.entries(profile.elements || {}).map(([tagName, definition]) => [
      tagName,
      {
        ...definition,
        baseName: definition.baseName,
        classChain: definition.classChain,
        children: [...(definition.children || [])],
        attributes: [...(definition.attributes || [])],
      childOrder: definition.childOrder ? [...definition.childOrder] : undefined,
      contentRefs: definition.contentRefs ? [...definition.contentRefs] : undefined,
      requiredChildren: definition.requiredChildren ? [...definition.requiredChildren] : undefined,
      sourceFiles: definition.sourceFiles ? [...definition.sourceFiles] : undefined,
      uniqueChildren: definition.uniqueChildren ? [...definition.uniqueChildren] : undefined,
      },
    ]),
  );
  const rootElements = [...(profile.rootElements || [])];
  const fileTypes = [...(profile.fileTypes || [])];

  for (const specialization of specializations) {
    const name = specialization?.name || specialization?.definition?.name;
    const baseName = specialization?.baseName || specialization?.definition?.baseName;
    const kind = specialization?.kind || specialization?.definition?.kind;
    if (!isValidSpecialization(specialization)) continue;
    if (!name || !baseName || kind !== "documentType") continue;

    const baseDefinition = elements[baseName];
    if (!baseDefinition) continue;

    elements[name] = {
      ...baseDefinition,
      baseName,
      classChain: specialization?.classChain || specialization?.definition?.classChain || baseDefinition.classChain,
      children: [...(baseDefinition.children || [])],
      attributes: [
        ...(baseDefinition.attributes || []),
        { name: "class", label: "class", placeholder: "DITA specialization class" },
      ],
      childOrder: baseDefinition.childOrder ? [...baseDefinition.childOrder] : undefined,
      contentRefs: baseDefinition.contentRefs ? [...baseDefinition.contentRefs] : undefined,
      requiredChildren: baseDefinition.requiredChildren ? [...baseDefinition.requiredChildren] : undefined,
      sourceFiles: baseDefinition.sourceFiles ? [...baseDefinition.sourceFiles] : undefined,
      uniqueChildren: baseDefinition.uniqueChildren ? [...baseDefinition.uniqueChildren] : undefined,
    };

    if (!rootElements.includes(name)) {
      rootElements.push(name);
    }
    if (!fileTypes.some((fileType) => fileType.key === name)) {
      fileTypes.push({ key: name, label: name, extension: "dita", baseKey: baseName } as any);
    }
  }

  for (const specialization of specializations) {
    const name = specialization?.name || specialization?.definition?.name;
    const baseName = specialization?.baseName || specialization?.definition?.baseName;
    const kind = specialization?.kind || specialization?.definition?.kind;
    if (!isValidSpecialization(specialization)) continue;
    if (!name || !baseName || kind !== "element") continue;
    if (!specializationAppliesToDocument(specialization, documentType)) continue;

    const baseDefinition = elements[baseName];
    if (!baseDefinition) continue;

    const addedAttributes = Array.isArray(specialization?.definition?.addedAttributes)
      ? specialization.definition.addedAttributes.map(normalizeRngAttribute).filter((attribute) => attribute.name)
      : [];
    const inheritedAttributes = [
      ...(baseDefinition.attributes || []),
      ...addedAttributes,
      { name: "class", label: "class", placeholder: "DITA specialization class" },
    ];

    elements[name] = {
      ...baseDefinition,
      baseName,
      classChain: specialization?.classChain || specialization?.definition?.classChain || baseDefinition.classChain,
      attributes: [
        ...new Map(inheritedAttributes.map((attribute) => [attribute.name, attribute])).values(),
      ],
      template: baseDefinition.template || "emptyText",
    };

    for (const definition of Object.values(elements)) {
      if (definition.children?.includes(baseName) && !definition.children.includes(name)) {
        definition.children = [...definition.children, name].sort((a, b) => a.localeCompare(b));
      }
      if (definition.childOrder?.includes(baseName) && !definition.childOrder.includes(name)) {
        const nextOrder = [...definition.childOrder];
        nextOrder.splice(nextOrder.indexOf(baseName) + 1, 0, name);
        definition.childOrder = nextOrder;
      }
    }
  }

  return {
    ...profile,
    fileTypes,
    rootElements,
    elements,
  };
}

function setActiveDitaSchemaProfile(profile: DitaSchemaProfile, specializations = activeSpecializationDefinitions, documentType = activeDitaSchemaDocumentType) {
  activeBaseDitaSchemaProfile = profile;
  activeDitaSchemaDocumentType = documentType || activeDitaSchemaDocumentType;
  activeDitaSchemaProfile = applySpecializationOverlays(activeBaseDitaSchemaProfile, specializations, activeDitaSchemaDocumentType);
}

function setActiveSpecializationDefinitions(specializations: any[], documentType = activeDitaSchemaDocumentType) {
  activeSpecializationDefinitions = specializations;
  activeDitaSchemaDocumentType = documentType || activeDitaSchemaDocumentType;
  activeDitaSchemaProfile = applySpecializationOverlays(activeBaseDitaSchemaProfile, activeSpecializationDefinitions, activeDitaSchemaDocumentType);
}

function setActiveAuthoringProfiles(profiles: Record<string, { enabled: boolean; visibleElements: string[] }>) {
  activeAuthoringProfiles = profiles || {};
}

function getSchemaChildrenMap() {
  return Object.fromEntries(
    Object.entries(getActiveDitaSchemaProfile().elements).map(([tagName, definition]) => [
      tagName,
      definition.children || [],
    ]),
  );
}

function getAllowedAttributeNames() {
  return new Set(
    Object.values(getActiveDitaSchemaProfile().elements)
      .flatMap((definition) => definition.attributes || commonAttributeDefinitions)
      .map((attribute) => attribute.name),
  );
}

function isKnownInlineElement(tagName: string): boolean {
  return Boolean(getActiveDitaSchemaProfile().elements[tagName]?.inline);
}

function elementAllowsText(tagName: string): boolean {
  const definition = getElementDefinition(tagName);
  return definition?.allowsText !== false;
}

const ditaFileTypes = fallbackDitaSchemaProfile.fileTypes;
const visualTemplateFileType = { key: "visual-template", label: "Visual Template", extension: "af-template.json" };
const genericFileTypes = [
  ...ditaFileTypes,
  visualTemplateFileType,
  { key: "text", label: "Text", extension: "txt" },
  { key: "html", label: "HTML", extension: "html" },
  { key: "image", label: "Image", extension: "png" },
];

function isInlineInsertionElement(tagName: string): boolean {
  return isKnownInlineElement(tagName) || tagName === "image";
}

function getElementDefinition(tagName: string): ElementDefinition | null {
  return getActiveDitaSchemaProfile().elements[tagName] || null;
}

function isInlineContainerElement(tagName: string): boolean {
  return Boolean(getElementDefinition(tagName)?.inlineContainer);
}

function isInlineRenderingElement(tagName: string): boolean {
  if (elementSpecializesFrom(tagName, "body")) return false;
  return isInlineInsertionElement(tagName);
}

function isInlineSchemaContent(tagName: string, definition: any, fallbackDefinition: Partial<ElementDefinition> = {}) {
  if (
    tagName === "body" ||
    definitionSpecializesFrom({ ...fallbackDefinition, ...definition, name: tagName }, "body")
  ) {
    return false;
  }

  if (!definition?.allowsText) return Boolean(fallbackDefinition.inline);
  if (fallbackDefinition.inline) return true;

  const refs = Array.isArray(definition.contentRefs) ? definition.contentRefs : [];
  if (refs.some((ref) => /\.(ph|keyword|term|tm|xrefph|txt|text)\.cnt$|^(ph|xrefph)\.cnt$/i.test(String(ref)))) {
    return true;
  }

  const children = Array.isArray(definition.content) ? definition.content : [];
  if (!children.length) return true;

  const blockChildren = new Set([
    "body",
    "conbody",
    "section",
    "p",
    "ul",
    "ol",
    "dl",
    "sl",
    "table",
    "simpletable",
    "fig",
    "note",
    "codeblock",
    "steps",
    "step",
    "topic",
    "concept",
    "task",
    "reference",
  ]);

  return !children.some((child) => blockChildren.has(child?.name));
}

function getVisualTagForElement(tagName: string) {
  if (tagName === "title") return "h2";
  if (tagName === "shortdesc") return "p";
  if (tagName === "li") return "li";
  if (tagName === "step") return "li";
  if (tagName === "p") return "p";
  if (tagName === "b") return "strong";
  if (tagName === "i") return "em";
  if (tagName === "codeph") return "code";
  if (tagName === "u" || tagName === "xref" || isInlineRenderingElement(tagName)) return "span";
  return "div";
}

function getAttributeDefinitions(tagName: string): AttributeDefinition[] {
  return getElementDefinition(tagName)?.attributes || commonAttributeDefinitions;
}

function getDefaultFileStem(typeKey: string): string {
  if (typeKey === "visual-template") return "new-template";
  return `new-${typeKey}`;
}

function isDefaultFileStem(value: string): boolean {
  const stem = value.trim().replace(/\.[^./]+$/i, "");
  const activeFileTypes = [
    ...getActiveDitaSchemaProfile().fileTypes,
    ...genericFileTypes.filter((type) => !getActiveDitaSchemaProfile().fileTypes.some((fileType) => fileType.key === type.key)),
  ];
  return activeFileTypes.some((type) => stem === getDefaultFileStem(type.key));
}

function getAuthoringProfileTabId(documentType: string) {
  return `${authoringProfileTabPrefix}-${documentType}`;
}

function getAuthoringProfileDocumentTypeFromTabId(fileId = "") {
  return fileId.startsWith(`${authoringProfileTabPrefix}-`)
    ? fileId.slice(authoringProfileTabPrefix.length + 1)
    : "";
}

function createAuthoringProfileTabFile(documentType: string) {
  return {
    id: getAuthoringProfileTabId(documentType),
    name: `Customize: ${documentType}`,
    type: "file",
    ditaType: "authoring-profile",
    content: documentType,
  };
}

function isImageHref(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^data:image\//i.test(trimmed)) return true;
  if (/\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i.test(trimmed)) return true;

  try {
    const url = new URL(trimmed, window.location.href);
    return /(^|\/)(avif|gif|jpe?g|png|svg|webp)(\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isDitaDocumentHref(value: string): boolean {
  return /\.(dita|ditamap|xml)(#.*)?$/i.test(value.trim());
}

function normalizeRngAttribute(attribute): AttributeDefinition {
  const name = typeof attribute === "string" ? attribute : attribute?.name || "";
  return {
    name,
    label: typeof attribute === "object" ? attribute.label || name : name,
    placeholder: typeof attribute === "object" ? attribute.placeholder : undefined,
    values: Array.isArray(attribute?.values) ? attribute.values : undefined,
  };
}

function collectDirectElementNamesFromModel(model, result: string[] = []): string[] {
  if (!model) return result;

  if (model.type === "ref" && model.name && !model.name.includes(".")) {
    result.push(model.name);
    return result;
  }

  if (model.type === "element" && model.name) {
    result.push(model.name);
    return result;
  }

  for (const child of model.children || []) {
    collectDirectElementNamesFromModel(child, result);
  }

  return result;
}

function deriveOrderedChildrenFromContentModel(model): string[] {
  if (model?.type !== "sequence") return [];

  return [...new Set<string>(
    (model.children || []).flatMap((child) => collectDirectElementNamesFromModel(child)),
  )];
}

function collectRequiredElementNamesFromModel(model, result: string[] = []): string[] {
  if (!model || ["optional", "zeroOrMore"].includes(model.type)) return result;

  if (model.type === "choice") {
    return result;
  }

  if (model.type === "ref" && model.name && !model.name.includes(".")) {
    result.push(model.name);
    return result;
  }

  if (model.type === "element" && model.name) {
    result.push(model.name);
    return result;
  }

  for (const child of model.children || []) {
    collectRequiredElementNamesFromModel(child, result);
  }

  return result;
}

function deriveRequiredChildrenFromContentModel(model): string[] {
  if (model?.type !== "sequence") return [];

  return [...new Set<string>(
    (model.children || []).flatMap((child) => collectRequiredElementNamesFromModel(child)),
  )];
}

function deriveRequiredChildrenFromContentList(content): string[] {
  if (!Array.isArray(content)) return [];

  return [...new Set<string>(
    content
      .filter((child) => {
        const min = child?.min;
        return min === undefined || min === null || Number(min) > 0;
      })
      .map((child) => child?.name)
      .filter((name): name is string => typeof name === "string" && name !== "text"),
  )];
}

function convertRngSchemaToUiProfile(rngSchema, requestedType = ""): DitaSchemaProfile {
  const fallback = fallbackDitaSchemaProfile;
  const generatedElements = rngSchema?.elements && typeof rngSchema.elements === "object"
    ? rngSchema.elements
    : {};
  const elements: Record<string, ElementDefinition> = {};

  for (const [tagName, definition] of Object.entries(generatedElements)) {
    const generatedDefinition = definition as any;
    const fallbackDefinition = (fallback.elements[tagName] || {}) as Partial<ElementDefinition>;
    const children = Array.isArray(generatedDefinition.content)
      ? generatedDefinition.content
          .map((child) => child?.name)
          .filter((name) => typeof name === "string" && name !== "text")
      : fallbackDefinition.children || [];
    const uniqueChildren: string[] = Array.isArray(generatedDefinition.content)
      ? generatedDefinition.content
          .filter((child) => child?.max === 1)
          .map((child) => child?.name)
          .filter((name): name is string => typeof name === "string" && name !== "text")
      : fallbackDefinition.uniqueChildren || [];
    const orderedChildren = deriveOrderedChildrenFromContentModel(generatedDefinition.contentModel);
    const requiredChildren = deriveRequiredChildrenFromContentModel(generatedDefinition.contentModel);
    const requiredContentChildren = requiredChildren.length
      ? requiredChildren
      : deriveRequiredChildrenFromContentList(generatedDefinition.content);
    const sourceFiles = Array.isArray(generatedDefinition.sourceFiles) ? generatedDefinition.sourceFiles : [];
    const isInline = isInlineSchemaContent(tagName, generatedDefinition, fallbackDefinition);

    elements[tagName] = {
      name: tagName,
      children: [...new Set(children)] as string[],
      allowsText: Boolean(generatedDefinition.allowsText),
      attributes: Array.isArray(generatedDefinition.attributes)
        ? generatedDefinition.attributes.map(normalizeRngAttribute).filter((attribute) => attribute.name)
        : fallbackDefinition.attributes,
      baseName: generatedDefinition.baseName || fallbackDefinition.baseName,
      childOrder: orderedChildren,
      classChain: generatedDefinition.classChain || generatedDefinition.class || fallbackDefinition.classChain,
      contentRefs: Array.isArray(generatedDefinition.contentRefs) ? generatedDefinition.contentRefs : fallbackDefinition.contentRefs,
      inline: isInline,
      inlineContainer: Boolean(generatedDefinition.allowsText || fallbackDefinition.inlineContainer),
      orderedChildren: Boolean(orderedChildren.length || fallbackDefinition.orderedChildren),
      requiredChildren: requiredContentChildren,
      sourceFiles,
      template: fallbackDefinition.template,
      uniqueChildren: [...new Set<string>(uniqueChildren)],
    };
  }

  for (const [tagName, definition] of Object.entries(fallback.elements)) {
    elements[tagName] = {
      ...definition,
      ...(elements[tagName] || {}),
      allowsText: elements[tagName]?.allowsText ?? definition.allowsText,
      baseName: elements[tagName]?.baseName || definition.baseName,
      template: definition.template || elements[tagName]?.template,
      orderedChildren: definition.orderedChildren || elements[tagName]?.orderedChildren,
      childOrder: elements[tagName]?.childOrder || definition.childOrder,
      classChain: elements[tagName]?.classChain || definition.classChain,
      contentRefs: elements[tagName]?.contentRefs || definition.contentRefs,
      requiredChildren: elements[tagName]?.requiredChildren || definition.requiredChildren,
      sourceFiles: elements[tagName]?.sourceFiles || definition.sourceFiles,
      uniqueChildren: elements[tagName]?.uniqueChildren || definition.uniqueChildren,
    };
  }

  for (const tagName of elements.ph?.children || []) {
    if (tagName !== "text" && elements[tagName]) {
      elements[tagName] = {
        ...elements[tagName],
        inline: true,
      };
    }
  }

  const fileTypes = Array.isArray(rngSchema?.fileTypes) && rngSchema.fileTypes.length
    ? rngSchema.fileTypes.map((fileType) => ({
        key: fileType.key,
        label: fileType.label || fileType.key,
        extension: fileType.extension || (fileType.key === "map" ? "ditamap" : "dita"),
      }))
    : fallback.fileTypes;

  return {
    fileTypes,
    rootElements: fileTypes.map((fileType) => fileType.key).filter(Boolean),
    elements,
  };
}

function getProjectFilePath(node, id, pathParts: string[] = []): string {
  const currentPathParts = [...pathParts, node.name];

  if (node.id === id) {
    return getProjectNodePath(currentPathParts);
  }

  if (node.type !== "folder") return "";

  for (const child of node.children) {
    const match = getProjectFilePath(child, id, currentPathParts);
    if (match) return match;
  }

  return "";
}

function collectProjectFiles(node, pathParts: string[] = []) {
  const currentPathParts = [...pathParts, node.name];
  const currentPath = getProjectNodePath(currentPathParts);

  if (node.type === "file") {
    return [{ node, path: currentPath }];
  }

  return node.children.flatMap((child) => collectProjectFiles(child, currentPathParts));
}

function collectValidationFiles(projectTree, fileHistories) {
  return collectProjectFiles(projectTree)
    .filter(({ node }) => node.type === "file")
    .filter(({ node }) => !node.generated)
    .map(({ node, path }) => {
      const fileKind = getProjectFileKind(node);
      const content = fileHistories[node.id]?.present ?? node.content ?? "";
      const validationFile: { path: string; content: string; encoding?: string } = {
        path,
        content: fileKind === "xml" ? ensureDitaDoctype(content) : content,
      };

      if (fileKind === "image" && node.previewHref?.startsWith("data:")) {
        validationFile.content = node.previewHref;
        validationFile.encoding = "data-url";
      }

      return validationFile;
    });
}

function findProjectFileByPath(node, targetPath: string, pathParts: string[] = []) {
  const currentPathParts = [...pathParts, node.name];
  const currentPath = getProjectNodePath(currentPathParts);

  if (node.type === "file" && normalizeProjectPath(currentPath) === normalizeProjectPath(targetPath)) {
    return node;
  }

  if (node.type !== "folder") return null;

  for (const child of node.children) {
    const match = findProjectFileByPath(child, targetPath, currentPathParts);
    if (match) return match;
  }

  return null;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createFindRegex(rawQuery: string, caseSensitive = false): RegExp | null {
  const query = rawQuery.trim();
  if (!query) return null;
  return new RegExp(escapeRegExp(query), caseSensitive ? "g" : "gi");
}

function replaceTextMatches(text: string, rawQuery: string, replacement: string, caseSensitive = false) {
  const regex = createFindRegex(rawQuery, caseSensitive);
  if (!regex) return { text, count: 0 };

  let count = 0;
  const nextText = text.replace(regex, () => {
    count += 1;
    return replacement;
  });

  return { text: nextText, count };
}

function countTextMatches(text: string, rawQuery: string, caseSensitive = false): number {
  return replaceTextMatches(text, rawQuery, "", caseSensitive).count;
}

function countVisibleXmlTextMatches(xml: string, rawQuery: string, caseSensitive = false): number {
  const { doc, error } = parseXml(xml);
  if (!doc || error) return 0;

  let count = 0;
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();

  while (currentNode) {
    count += countTextMatches(currentNode.textContent || "", rawQuery, caseSensitive);
    currentNode = walker.nextNode();
  }

  return count;
}

function replaceVisibleXmlText(xml: string, rawQuery: string, replacement: string, caseSensitive = false) {
  const { doc, error } = parseXml(xml);
  if (!doc || error) return { content: xml, count: 0 };

  let count = 0;
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();

  while (currentNode) {
    const result = replaceTextMatches(currentNode.textContent || "", rawQuery, replacement, caseSensitive);
    if (result.count) {
      currentNode.textContent = result.text;
      count += result.count;
    }
    currentNode = walker.nextNode();
  }

  return {
    content: count ? formatXml(new XMLSerializer().serializeToString(doc)) : xml,
    count,
  };
}

function getReplaceMatchCount(fileKind: string, content: string, rawQuery: string, caseSensitive = false): number {
  if (!rawQuery.trim() || fileKind === "image") return 0;
  return fileKind === "xml"
    ? countVisibleXmlTextMatches(content, rawQuery, caseSensitive)
    : countTextMatches(content, rawQuery, caseSensitive);
}

function replaceEditableContent(fileKind: string, content: string, rawQuery: string, replacement: string, caseSensitive = false) {
  if (!rawQuery.trim() || fileKind === "image") return { content, count: 0 };
  return fileKind === "xml"
    ? replaceVisibleXmlText(content, rawQuery, replacement, caseSensitive)
    : (() => {
        const result = replaceTextMatches(content, rawQuery, replacement, caseSensitive);
        return { content: result.text, count: result.count };
      })();
}

function getLineNumberForIndex(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function getSearchSnippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 54);
  const end = Math.min(text.length, index + length + 74);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < text.length ? " ..." : "";

  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function buildSearchResults(
  projectTree,
  fileHistories,
  openTabs,
  rawQuery: string,
  scope: "all" | "open",
): SearchResult[] {
  const query = normalizeSearchText(rawQuery);
  if (!query) return [];

  const openFileIds = new Set(openTabs.map((tab) => tab.fileId));
  const files = collectProjectFiles(projectTree)
    .filter(({ node }) => scope === "all" || openFileIds.has(node.id));
  const results: SearchResult[] = [];

  files.forEach(({ node, path }) => {
    const fileKind = getProjectFileKind(node);
    const content = fileHistories[node.id]?.present ?? node.content ?? "";
    const lowerName = node.name.toLowerCase();
    const lowerPath = path.toLowerCase();
    const lowerContent = content.toLowerCase();
    const isOpen = openFileIds.has(node.id);

    if (lowerName.includes(query) || lowerPath.includes(query)) {
      results.push({
        id: `${node.id}-file`,
        fileId: node.id,
        fileName: node.name,
        filePath: path,
        fileKind,
        kind: "file",
        label: node.name,
        detail: path,
        snippet: lowerName.includes(query) ? "File name match" : "Path match",
        isOpen,
      });
    }

    if (content && fileKind !== "image") {
      let fromIndex = 0;
      let matchIndex = lowerContent.indexOf(query, fromIndex);
      let matchCount = 0;

      while (matchIndex !== -1 && matchCount < 5) {
        const line = getLineNumberForIndex(content, matchIndex);
        results.push({
          id: `${node.id}-text-${matchIndex}`,
          fileId: node.id,
          fileName: node.name,
          filePath: path,
          fileKind,
          kind: "text",
          label: `${node.name}:${line}`,
          detail: path,
          snippet: getSearchSnippet(content, matchIndex, rawQuery.length),
          line,
          isOpen,
        });

        matchCount += 1;
        fromIndex = matchIndex + query.length;
        matchIndex = lowerContent.indexOf(query, fromIndex);
      }
    }
  });

  return results.sort((first, second) => {
    if (first.isOpen !== second.isOpen) return first.isOpen ? -1 : 1;
    if (first.kind !== second.kind) return first.kind === "file" ? -1 : 1;
    return first.filePath.localeCompare(second.filePath);
  });
}

function renderHighlightedSearchText(text: string, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return text;

  const lowerText = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(normalizedQuery, cursor);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }

    parts.push(
      <mark className="search-highlight" key={`${matchIndex}-${normalizedQuery}`}>
        {text.slice(matchIndex, matchIndex + normalizedQuery.length)}
      </mark>,
    );

    cursor = matchIndex + normalizedQuery.length;
    matchIndex = lowerText.indexOf(normalizedQuery, cursor);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
}

const pathKeyFor = (path: number[]) => path.join(".");

function getHrefValidationState(
  node: Element,
  path: number[],
  activeFilePath: string | null,
  projectTree,
): HrefValidationState | null {
  const href = (node.getAttribute("href") || "").trim();
  const pathKey = pathKeyFor(path);

  if (!href) return null;

  const invalid = (message: string): HrefValidationState => ({
    pathKey,
    status: "invalid",
    message,
    value: href,
  });
  const valid = (message: string): HrefValidationState => ({
    pathKey,
    status: "valid",
    message,
    value: href,
  });

  if (isExternalHref(href) || href.startsWith("/")) {
    return invalid("Use a relative href for local DITA project references.");
  }

  const { path: hrefPath } = splitHrefFragment(href);
  if (!hrefPath) {
    return invalid("Same-file fragment hrefs will be validated when element id lookup is enabled.");
  }

  if (!activeFilePath) {
    return invalid("Select an active file before validating href references.");
  }

  const resolvedPath = resolveProjectHref(activeFilePath, hrefPath);
  const referencedFile = findProjectFileByPath(projectTree, resolvedPath);

  if (!referencedFile) {
    return invalid(`Reference not found: ${href} resolves to ${resolvedPath}.`);
  }

  if (node.tagName === "image" && referencedFile.ditaType !== "image") {
    return invalid(`Image href must point to an image asset: ${href}.`);
  }

  if (node.tagName === "xref" && !isDitaDocumentType(referencedFile.ditaType)) {
    return invalid(`Xref href must point to a DITA document: ${href}.`);
  }

  return valid(`Reference resolved: ${href} -> ${resolvedPath}`);
}

function collectHrefValidationStates(
  doc: XMLDocument | null,
  activeFilePath: string | null,
  projectTree,
): HrefValidationMap {
  const validationStates: HrefValidationMap = {};

  function visit(node: Element, path: number[]) {
    const validationState = node.hasAttribute("href")
      ? getHrefValidationState(node, path, activeFilePath, projectTree)
      : null;

    if (validationState) {
      validationStates[validationState.pathKey] = validationState;
    }

    elementChildren(node).forEach((child, index) => visit(child, [...path, index]));
  }

  if (doc?.documentElement) {
    visit(doc.documentElement, []);
  }

  return validationStates;
}

function collectProjectReferences(node, pathParts: string[] = [], references = []) {
  const currentPathParts = [...pathParts, node.name];
  const sourcePath = getProjectNodePath(currentPathParts);

  if (node.type === "file" && node.content) {
    const { doc } = parseXml(node.content);

    if (doc) {
      Array.from(doc.querySelectorAll("[href]") as NodeListOf<Element>).forEach((element) => {
        const rawHref = element.getAttribute("href") || "";
        const { path: hrefPath, fragment } = splitHrefFragment(rawHref.trim());

        if (!hrefPath || isExternalHref(hrefPath)) return;

        references.push({
          sourceFileId: node.id,
          sourcePath,
          element: element.tagName,
          attribute: "href",
          rawHref,
          fragment,
          resolvedTargetPath: resolveProjectHref(sourcePath, hrefPath),
        });
      });
    }
  }

  if (node.type === "folder") {
    node.children.forEach((child) => collectProjectReferences(child, currentPathParts, references));
  }

  return references;
}

function findReferencesTargetingProjectPath(projectTree, targetPath: string) {
  const normalizedTargetPath = normalizeProjectPath(targetPath);

  return collectProjectReferences(projectTree).filter((reference) => {
    const normalizedReferencePath = normalizeProjectPath(reference.resolvedTargetPath);
    return normalizedReferencePath === normalizedTargetPath ||
      normalizedReferencePath.startsWith(`${normalizedTargetPath}/`);
  });
}

function rewriteProjectReferencesForMovedPath(projectTree, oldPath: string, newPath: string) {
  const normalizedOldPath = normalizeProjectPath(oldPath);
  const normalizedNewPath = normalizeProjectPath(newPath);
  let rewrittenCount = 0;

  function getMovedTargetPath(targetPath: string) {
    const normalizedTargetPath = normalizeProjectPath(targetPath);

    if (normalizedTargetPath === normalizedOldPath) {
      return normalizedNewPath;
    }

    if (normalizedTargetPath.startsWith(`${normalizedOldPath}/`)) {
      return `${normalizedNewPath}${normalizedTargetPath.slice(normalizedOldPath.length)}`;
    }

    return null;
  }

  function rewriteNode(node, pathParts: string[] = []) {
    const currentPathParts = [...pathParts, node.name];
    const sourcePath = getProjectNodePath(currentPathParts);

    if (node.type === "file" && node.content) {
      const { doc } = parseXml(node.content);
      let fileChanged = false;

      if (!doc) return node;

      Array.from(doc.querySelectorAll("[href]") as NodeListOf<Element>).forEach((element) => {
        const rawHref = element.getAttribute("href") || "";
        const { path: hrefPath, fragment } = splitHrefFragment(rawHref.trim());

        if (!hrefPath || isExternalHref(hrefPath)) return;

        const movedTargetPath = getMovedTargetPath(resolveProjectHref(sourcePath, hrefPath));
        if (!movedTargetPath) return;

        element.setAttribute("href", `${getRelativeProjectHref(sourcePath, movedTargetPath)}${fragment}`);
        fileChanged = true;
        rewrittenCount += 1;
      });

      if (!fileChanged) return node;

      return {
        ...node,
        content: formatXml(new XMLSerializer().serializeToString(doc)),
      };
    }

    if (node.type !== "folder") return node;

    return {
      ...node,
      children: node.children.map((child) => rewriteNode(child, currentPathParts)),
    };
  }

  return {
    tree: rewriteNode(projectTree),
    rewrittenCount,
  };
}

function getReferenceSourceSummary(references) {
  return [...new Set(references.map((reference) => reference.sourcePath))].join(", ");
}

const initialProjectTree = {
  id: "root",
  type: "folder",
  name: "content",
  children: [
    {
      id: "folder-topics",
      type: "folder",
      name: "topics",
      children: [
        {
          id: "file-browser-xml-editor",
          type: "file",
          name: "browser-xml-editor.dita",
          ditaType: "topic",
          content: starterXml,
          checkedInAt: "Not checked in",
        },
        {
          id: "file-related-topic",
          type: "file",
          name: "related-topic.dita",
          ditaType: "topic",
          content: relatedTopicXml,
          checkedInAt: "Sample",
        },
        {
          id: "file-broken-validation-sample",
          type: "file",
          name: "broken-validation-sample.dita",
          ditaType: "topic",
          content: brokenDitaXml,
          checkedInAt: "Test fixture",
        },
      ],
    },
    {
      id: "folder-assets",
      type: "folder",
      name: "assets",
      children: [
        {
          id: "asset-sample-figure",
          type: "file",
          name: "sample-figure.png",
          ditaType: "image",
          content: "",
          previewHref: sampleImagePreviewUrl,
          checkedInAt: "Asset",
        },
      ],
    },
    {
      id: "folder-general",
      type: "folder",
      name: "general",
      children: [
        {
          id: "file-release-notes",
          type: "file",
          name: "release-notes.txt",
          ditaType: "text",
          content: "Release notes\n\n- Generic text files open in a plain editor.\n",
          checkedInAt: "Not checked in",
        },
        {
          id: "file-sample-html",
          type: "file",
          name: "sample-page.html",
          ditaType: "html",
          content: createGenericFileContent("html", "sample-page.html"),
          checkedInAt: "Not checked in",
        },
      ],
    },
    {
      id: "folder-maps",
      type: "folder",
      name: "maps",
      children: [
        {
          id: "file-root-map",
          type: "file",
          name: "root.ditamap",
          ditaType: "map",
          content: createDitaTemplate("map", "Root map"),
          checkedInAt: "Not checked in",
        },
      ],
    },
  ],
};

const emptyProjectTree = {
  id: "root",
  type: "folder",
  name: "content",
  children: [],
};

function createDitaTemplate(type, title) {
  const rootName = type || "topic";
  const baseRootName = getBaseSchemaRootForDocumentType(rootName) || rootName;
  const templateProfile = applySpecializationOverlays(activeBaseDitaSchemaProfile, activeSpecializationDefinitions, rootName);
  const rootDefinition = templateProfile.elements[rootName] || templateProfile.elements[baseRootName] || templateProfile.elements.topic;
  const id = (title || rootName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || rootName;
  const rootAttributes = rootName === "map" ? "" : ` id="${escapeXml(id)}"`;
  const classChain = getSpecializationClassChain(rootName);
  const specializationAttribute = classChain ? ` class="${escapeXml(classChain)}"` : "";
  const rootChildren = createDocumentStarterChildren(rootDefinition, rootName, templateProfile, title || "Topic Title", new Set([rootName]));
  const doctype = rootName === baseRootName ? getDitaDoctypeForRoot(rootName) : "";

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    doctype,
    `<${rootName}${rootAttributes}${specializationAttribute}>`,
    rootChildren || createSchemaTemplateElement(getPreferredEditableLeaf(rootDefinition, templateProfile), "  ", new Set([rootName]), "Topic Title", templateProfile),
    `</${rootName}>`,
  ].filter(Boolean).join("\n");
}

function createDocumentStarterChildren(definition: ElementDefinition | null | undefined, rootName: string, profile: DitaSchemaProfile, title: string, visited: Set<string>) {
  if (!definition) return "";

  const childNames = getDocumentStarterChildNames(definition, rootName, profile);
  return childNames
    .map((childName) => createSchemaTemplateElement(childName, "  ", new Set(visited), title, profile))
    .filter(Boolean)
    .join("\n");
}

function getDocumentStarterChildNames(definition: ElementDefinition, rootName: string, profile: DitaSchemaProfile) {
  const orderedChildren = definition.childOrder?.length ? definition.childOrder : definition.children || [];
  const starterChildren: string[] = [];
  const bodyChild = getPreferredBodyChild(definition, rootName, profile);

  if (definition.children?.includes("title")) {
    starterChildren.push("title");
  }

  if (bodyChild) {
    starterChildren.push(bodyChild);
  }

  if (starterChildren.length) {
    return starterChildren;
  }

  return orderedChildren.filter((childName) => definition.requiredChildren?.includes(childName));
}

function getPreferredBodyChild(definition: ElementDefinition | null | undefined, rootName: string, profile: DitaSchemaProfile) {
  const children = definition?.children || [];
  const orderedChildren = definition?.childOrder?.length ? definition.childOrder : children;
  const scopedSpecializedBody = activeSpecializationDefinitions.find((specialization) => {
    const name = specialization?.name || specialization?.definition?.name;
    const baseName = specialization?.baseName || specialization?.definition?.baseName || "";
    const kind = specialization?.kind || specialization?.definition?.kind;
    return Boolean(
      isValidSpecialization(specialization) &&
      kind === "element" &&
      name &&
      profile.elements[name] &&
      isBodyLikeElementName(baseName, profile) &&
      children.includes(baseName) &&
      specializationAppliesToDocument(specialization, rootName)
    );
  });

  if (scopedSpecializedBody) {
    return scopedSpecializedBody.name || scopedSpecializedBody.definition?.name || "";
  }

  const bodyChildren = orderedChildren.filter((childName) => children.includes(childName) && isBodyLikeElementName(childName, profile));
  const specializedBodyChild = bodyChildren.find((childName) => {
    const specialization = getSpecializationByName(childName);
    const baseName = specialization?.baseName || specialization?.definition?.baseName || "";
    return Boolean(specialization && isBodyLikeElementName(baseName, profile));
  });

  return specializedBodyChild ||
    bodyChildren[0] ||
    "";
}

function isBodyLikeElementName(tagName = "", profile = getActiveDitaSchemaProfile()) {
  if (!tagName) return false;
  if (tagName === "body") return true;

  const definition = profile.elements[tagName];
  if (definitionSpecializesFrom(definition, "body")) return true;
  return elementSpecializesFrom(tagName, "body");
}

function getBodySpecializationBase(tagName: string) {
  const specialization = getSpecializationByName(tagName);
  return specialization?.baseName || specialization?.definition?.baseName || "";
}

function getPreferredEditableLeaf(definition: ElementDefinition | null | undefined, profile = getActiveDitaSchemaProfile()) {
  const children = definition?.children || [];
  if (children.includes("p")) return "p";
  if (children.includes("cmd")) return "cmd";
  if (children.includes("li")) return "li";
  return children.find((childName) => profile.elements[childName]?.inlineContainer) || "";
}

function getPreferredAuthoringChild(definition: ElementDefinition | null | undefined, profile = getActiveDitaSchemaProfile(), depth = 0): string {
  if (!definition || depth > 3) return "";

  const leaf = getPreferredEditableLeaf(definition, profile);
  if (leaf) return leaf;

  const orderedChildren = definition.childOrder?.length ? definition.childOrder : definition.children || [];
  return orderedChildren.find((childName) => {
    const childDefinition = profile.elements[childName];
    return Boolean(childDefinition && getPreferredAuthoringChild(childDefinition, profile, depth + 1));
  }) || "";
}

function createSchemaTemplateElement(tagName: string, indent = "", visited = new Set<string>(), title = "Topic Title", profile = getActiveDitaSchemaProfile()): string {
  if (!tagName || visited.has(tagName)) return "";

  const definition = profile.elements[tagName];
  const classChain = getSpecializationClassChain(tagName);
  const classAttribute = classChain ? ` class="${escapeXml(classChain)}"` : "";

  if (tagName === "title") {
    return `${indent}<title>${escapeXml(title || "Topic Title")}</title>`;
  }

  if (tagName === "image" || tagName === "xref" || tagName === "topicref") {
    return `${indent}<${tagName}${classAttribute}/>`;
  }

  if (!definition || definition.inline || definition.inlineContainer || definition.children.length === 0) {
    return `${indent}<${tagName}${classAttribute}/>`;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(tagName);
  const childNames = getRequiredTemplateChildren(definition);
  const preferredChild = childNames.length ? "" : getPreferredAuthoringChild(definition, profile);
  const children = [
    ...childNames.map((childName) => createSchemaTemplateElement(childName, `${indent}  `, nextVisited, title, profile)),
    preferredChild ? createSchemaTemplateElement(preferredChild, `${indent}  `, nextVisited, title, profile) : "",
  ].filter(Boolean);

  if (children.length === 0) {
    return `${indent}<${tagName}${classAttribute}/>`;
  }

  return `${indent}<${tagName}${classAttribute}>\n${children.join("\n")}\n${indent}</${tagName}>`;
}

function getRequiredTemplateChildren(definition: ElementDefinition) {
  const requiredChildren = definition.requiredChildren || [];
  const orderedChildren = definition.childOrder?.length ? definition.childOrder : definition.children || [];
  return orderedChildren.filter((childName) => requiredChildren.includes(childName));
}

function normalizeFileName(name, typeKey) {
  const extension = getDocumentTypeFileExtension(typeKey);
  const trimmed = name.trim() || `new-${typeKey || "file"}`;
  const extensionSuffix = `.${extension}`;
  const withoutExtension = trimmed.toLowerCase().endsWith(extensionSuffix.toLowerCase())
    ? trimmed.slice(0, -extensionSuffix.length)
    : trimmed.replace(/\.[^./]+$/i, "");
  return `${withoutExtension}.${extension}`;
}

function getFileExtension(name = "") {
  return name.split(".").pop()?.toLowerCase() || "";
}

function getProjectFileKind(file) {
  if (!file || file.type !== "file") return "unknown";

  if (file.ditaType === "specializations") {
    return "specializations";
  }

  if (file.ditaType === "authoring-profile") {
    return "authoring-profile";
  }

  if (file.ditaType === "visual-template" || file.ditaType === "visual-template-binding") {
    return "visual-template";
  }

  if (file.ditaType === "git-history") {
    return "git-history";
  }

  if (file.ditaType === "git-conflict") {
    return "git-conflict";
  }

  const extension = getFileExtension(file.name);

  if (file.ditaType === "image" || /^(avif|gif|jpe?g|png|svg|webp)$/i.test(extension)) {
    return "image";
  }

  if (isDitaDocumentType(file.ditaType) || ["dita", "ditamap", "xml"].includes(extension)) {
    return "xml";
  }

  if (["html", "htm"].includes(extension)) {
    return "html";
  }

  return "text";
}

function getProjectFileIconKind(file) {
  if (!file || file.type !== "file") return "file";

  const extension = getFileExtension(file.name);
  if (file.ditaType === "visual-template") return "visual-template";
  if (["topic", "concept", "task", "reference", "map"].includes(file.ditaType)) {
    return file.ditaType;
  }
  if (isDitaDocumentType(file.ditaType)) {
    return getDocumentTypeIconKind(file.ditaType);
  }

  if (extension === "ditamap") return "map";
  if (extension === "dita") return "topic";
  if (["xml"].includes(extension)) return "xml";
  if (file.ditaType === "image" || /^(avif|gif|jpe?g|png|svg|webp)$/i.test(extension)) return "image";
  if (["html", "htm"].includes(extension)) return "html";
  if (["txt", "md", "css", "js", "json"].includes(extension) || file.ditaType === "text") return "text";

  return "file";
}

function isTextEditableFile(file) {
  return ["xml", "html", "text"].includes(getProjectFileKind(file));
}

function slugifyWorkspaceArtifactName(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createGenericFileContent(typeKey: string, name: string) {
  const title = name.replace(/\.[^./]+$/i, "").replace(/[-_]+/g, " ");

  if (typeKey === "visual-template") {
    const templateId = `template-${slugifyWorkspaceArtifactName(title) || Date.now().toString(36)}`;
    return JSON.stringify(
      normalizeVisualTemplateModel({
        ...defaultVisualTemplateModel,
        artifactType: "template",
        id: templateId,
        name: title || "Visual template",
        template: {
          id: templateId,
          name: title || "Visual template",
          source: "workspace",
        },
        filePath: "",
      }),
      null,
      2,
    );
  }

  if (isDitaDocumentType(typeKey)) {
    return createDitaTemplate(typeKey, title);
  }

  if (typeKey === "html") {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>${escapeXml(title)}</title>
  </head>
  <body>
    <h1>${escapeXml(title)}</h1>
    <p>Start writing HTML.</p>
  </body>
</html>`;
  }

  if (typeKey === "text") {
    return "";
  }

  return "";
}

function normalizeAssetFileName(name: string, currentName: string) {
  const trimmed = name.trim() || currentName;
  if (/\.[^./]+$/.test(trimmed)) return trimmed;

  const extension = currentName.match(/(\.[^./]+)$/)?.[1] || "";
  return `${trimmed}${extension}`;
}

function isDitaDocumentType(typeKey) {
  return getActiveDitaSchemaProfile().fileTypes.some((type) => type.key === typeKey);
}

function makeUniqueName(baseName, siblings, ignoreId = null) {
  const siblingNames = new Set(
    siblings
      .filter((node) => node.id !== ignoreId)
      .map((node) => node.name.toLowerCase()),
  );

  if (!siblingNames.has(baseName.toLowerCase())) return baseName;

  const extensionMatch = baseName.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] || "";
  const stem = extension ? baseName.slice(0, -extension.length) : baseName;
  let index = 2;

  while (siblingNames.has(`${stem}-${index}${extension}`.toLowerCase())) {
    index += 1;
  }

  return `${stem}-${index}${extension}`;
}

function findProjectNode(node, id, parent = null) {
  if (node.id === id) return { node, parent };
  if (node.type !== "folder") return null;

  for (const child of node.children) {
    const match = findProjectNode(child, id, node);
    if (match) return match;
  }

  return null;
}

function findProjectFolderByPath(node, targetPath: string, pathParts: string[] = []) {
  const currentPathParts = [...pathParts, node.name];
  const currentPath = getProjectNodePath(currentPathParts);

  if (node.type === "folder" && currentPath === targetPath) {
    return { node, path: currentPath };
  }

  if (node.type !== "folder") return null;

  for (const child of node.children) {
    const match = findProjectFolderByPath(child, targetPath, currentPathParts);
    if (match) return match;
  }

  return null;
}

function updateProjectNode(node, id, updater) {
  if (node.id === id) return updater(node);
  if (node.type !== "folder") return node;

  return {
    ...node,
    children: node.children.map((child) => updateProjectNode(child, id, updater)),
  };
}

function removeProjectNode(node, id) {
  if (node.type !== "folder") return node;

  return {
    ...node,
    children: node.children
      .filter((child) => child.id !== id)
      .map((child) => removeProjectNode(child, id)),
  };
}

function cloneProjectNode(node) {
  const nextId = `${node.id}-copy-${Date.now().toString(36)}`;

  if (node.type === "file") {
    return {
      ...node,
      id: nextId,
      checkedInAt: "Not checked in",
    };
  }

  return {
    ...node,
    id: nextId,
    children: node.children.map(cloneProjectNode),
  };
}

function isDescendantProjectNode(root, id) {
  if (root.type !== "folder") return false;
  return root.children.some((child) => child.id === id || isDescendantProjectNode(child, id));
}

function inferProjectFileType(fileName: string) {
  const extension = getFileExtension(fileName);

  if (/^(avif|gif|jpe?g|png|svg|webp)$/i.test(extension)) return "image";
  if (["ditamap"].includes(extension)) return "map";
  if (["dita", "xml"].includes(extension)) {
    return inferDitaTypeFromFileName(fileName);
  }
  if (["html", "htm"].includes(extension)) return "html";
  return "text";
}

function inferBestProjectFileType(fileName: string, storedType = "") {
  const extension = getFileExtension(fileName);
  if (extension === "ditamap") return "map";
  if (["dita", "xml"].includes(extension)) {
    if (storedType && storedType !== "topic") return storedType;
    return inferDitaTypeFromFileName(fileName, storedType);
  }
  return storedType || inferProjectFileType(fileName);
}

function inferDitaTypeFromFileName(fileName: string, storedType = "") {
  const normalizedName = fileName.toLowerCase().replace(/\.[^./]+$/i, "");
  const fileTypes = getActiveDitaSchemaProfile().fileTypes
    .map((fileType) => fileType.key)
    .filter((key) => key && key !== "topic")
    .sort((left, right) => right.length - left.length);
  const matchedType = fileTypes.find((typeKey) => {
    const normalizedType = typeKey.toLowerCase();
    const typePrefixPattern = new RegExp(`^${escapeRegExp(normalizedType)}(?:$|[-_\\d])`);
    return normalizedName === normalizedType ||
      typePrefixPattern.test(normalizedName) ||
      normalizedName.startsWith(`${normalizedType}-`) ||
      normalizedName.startsWith(`new-${normalizedType}`) ||
      normalizedName.includes(`-${normalizedType}-`) ||
      normalizedName.endsWith(`-${normalizedType}`);
  });

  return matchedType || storedType || "topic";
}

function inferDitaTypeFromXml(rawContent: string) {
  const source = String(rawContent || "")
    .replace(/^\uFEFF/, "")
    .replace(/^\s*<\?xml[\s\S]*?\?>/i, "")
    .replace(/^\s*<!DOCTYPE[\s\S]*?>/i, "");
  const match = source.match(/^\s*<([A-Za-z_][\w:.-]*)\b/);
  return match?.[1]?.split(":").pop() || "";
}

function buildProjectTreeFromGitHubEntries(entries: GitHubTreeEntry[]) {
  const root: any = {
    id: "root",
    type: "folder",
    name: "content",
    children: [] as any[],
    githubPath: "",
    githubLoaded: true,
  };
  const folderMap = new Map<string, any>([["", root]]);

  function ensureFolder(folderPath: string) {
    const normalizedPath = normalizeProjectPath(folderPath);
    if (folderMap.has(normalizedPath)) return folderMap.get(normalizedPath);

    const parts = normalizedPath.split("/").filter(Boolean);
    const folderName = parts[parts.length - 1] || "content";
    const parentPath = parts.slice(0, -1).join("/");
    const parent = ensureFolder(parentPath);
    const folder = {
      id: `github-folder-${normalizedPath || "root"}`,
      type: "folder",
      name: folderName,
      children: [],
      githubPath: normalizedPath,
    };

    parent.children.push(folder);
    folderMap.set(normalizedPath, folder);
    return folder;
  }

  entries
    .filter((entry) => entry.type === "folder")
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach((entry) => ensureFolder(entry.path));

  entries
    .filter((entry) => entry.type === "file")
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach((entry) => {
      const pathParts = normalizeProjectPath(entry.path).split("/").filter(Boolean);
      const fileName = pathParts.pop();
      if (!fileName) return;

      const parent = ensureFolder(pathParts.join("/"));
      parent.children.push({
        id: `github-file-${normalizeProjectPath(entry.path)}`,
        type: "file",
        name: fileName,
        ditaType: inferBestProjectFileType(fileName, entry.ditaType),
        content: "",
        checkedInAt: "GitHub",
        githubPath: normalizeProjectPath(entry.path),
        githubSha: entry.sha || "",
        githubSize: entry.size || 0,
        githubLoaded: false,
        draftDirty: Boolean(entry.draftDirty),
        draftSavedAt: entry.draftSavedAt || null,
        deletedAt: entry.deletedAt || null,
        sourceContentHash: entry.sourceContentHash || "",
        draftContentHash: entry.draftContentHash || "",
      });
    });

  return root;
}

function upsertProjectTreeFileByPath(tree, rawFilePath: string, filePatch) {
  const filePath = normalizeProjectPath(rawFilePath);
  const parts = filePath.split("/").filter(Boolean);
  if (!parts.length) return tree;

  function upsertIntoFolder(folder, parentPathParts: string[]) {
    const [nextName, ...rest] = parts.slice(parentPathParts.length);
    const nextPath = normalizeProjectPath([...parentPathParts, nextName].join("/"));

    if (rest.length === 0) {
      const existingIndex = folder.children.findIndex((child) => (
        child.type === "file" &&
        (normalizeProjectPath(child.githubPath || "") === filePath || child.name === nextName)
      ));
      const nextFile = {
        id: existingIndex >= 0 ? folder.children[existingIndex].id : `github-file-${filePath}`,
        type: "file",
        name: nextName,
        ditaType: "visual-template-binding",
        content: "",
        checkedInAt: "Draft",
        githubPath: filePath,
        githubSha: "",
        githubLoaded: true,
        ...filePatch,
      };

      return {
        ...folder,
        children: existingIndex >= 0
          ? folder.children.map((child, index) => index === existingIndex ? { ...child, ...nextFile } : child)
          : [...folder.children, nextFile],
      };
    }

    const existingFolderIndex = folder.children.findIndex((child) => (
      child.type === "folder" &&
      (normalizeProjectPath(child.githubPath || "") === nextPath || child.name === nextName)
    ));
    const existingFolder = existingFolderIndex >= 0
      ? folder.children[existingFolderIndex]
      : {
          id: `github-folder-${nextPath}`,
          type: "folder",
          name: nextName,
          children: [],
          githubPath: nextPath,
          githubLoaded: true,
        };
    const nextFolder = upsertIntoFolder(existingFolder, [...parentPathParts, nextName]);

    return {
      ...folder,
      children: existingFolderIndex >= 0
        ? folder.children.map((child, index) => index === existingFolderIndex ? nextFolder : child)
        : [...folder.children, nextFolder],
    };
  }

  return upsertIntoFolder(tree, []);
}

function getGitHubChildPath(folder, name: string) {
  if (!folder || typeof folder.githubPath !== "string") return "";
  return normalizeProjectPath([folder.githubPath, name].filter(Boolean).join("/"));
}

function rebaseGitHubPath(node, nextPath: string) {
  if (typeof node.githubPath !== "string") return node;

  if (node.type === "file") {
    return {
      ...node,
      githubPath: nextPath,
      githubLoaded: true,
    };
  }

  return {
    ...node,
    githubPath: nextPath,
    githubLoaded: true,
    children: node.children.map((child) => rebaseGitHubPath(
      child,
      normalizeProjectPath([nextPath, child.name].filter(Boolean).join("/")),
    )),
  };
}

function insertProjectNodeInTree(root, targetId, nodeToInsert, placement = "inside") {
  if (root.id === targetId && root.type === "folder" && placement === "inside") {
    return {
      ...root,
      children: [...root.children, {
        ...nodeToInsert,
        name: makeUniqueName(nodeToInsert.name, root.children, nodeToInsert.id),
      }],
    };
  }

  if (root.type !== "folder") return root;

  const targetIndex = root.children.findIndex((child) => child.id === targetId);

  if (targetIndex !== -1 && placement !== "inside") {
    const siblings = root.children.filter((child) => child.id !== nodeToInsert.id);
    const insertIndex = siblings.findIndex((child) => child.id === targetId);
    const safeNode = {
      ...nodeToInsert,
      name: makeUniqueName(nodeToInsert.name, siblings, nodeToInsert.id),
    };
    const nextChildren = [...siblings];
    nextChildren.splice(placement === "before" ? insertIndex : insertIndex + 1, 0, safeNode);

    return {
      ...root,
      children: nextChildren,
    };
  }

  return {
    ...root,
    children: root.children.map((child) => {
      if (child.id === targetId && child.type === "folder" && placement === "inside") {
        return {
          ...child,
          children: [...child.children, {
            ...nodeToInsert,
            name: makeUniqueName(nodeToInsert.name, child.children, nodeToInsert.id),
          }],
        };
      }

      return insertProjectNodeInTree(child, targetId, nodeToInsert, placement);
    }),
  };
}

function moveProjectNodeInTree(root, sourceId, targetId, placement = "inside") {
  if (sourceId === targetId || sourceId === "root") {
    return { tree: root, moved: false, oldPath: "", newPath: "" };
  }

  const sourceMatch = findProjectNode(root, sourceId);
  const targetMatch = findProjectNode(root, targetId);
  if (!sourceMatch || !targetMatch) return { tree: root, moved: false, oldPath: "", newPath: "" };
  if (isDescendantProjectNode(sourceMatch.node, targetId)) return { tree: root, moved: false, oldPath: "", newPath: "" };

  const oldPath = getProjectFilePath(root, sourceId);
  const withoutSource = removeProjectNode(root, sourceId);
  const adjustedTarget = findProjectNode(withoutSource, targetId);
  if (!adjustedTarget) return { tree: root, moved: false, oldPath: "", newPath: "" };

  const actualPlacement = placement === "inside" && adjustedTarget.node.type !== "folder" ? "after" : placement;
  const movedTree = insertProjectNodeInTree(withoutSource, targetId, sourceMatch.node, actualPlacement);
  const newPath = getProjectFilePath(movedTree, sourceId);

  return {
    tree: movedTree,
    moved: true,
    oldPath,
    newPath,
  };
}

function findFirstFile(node) {
  if (node.type === "file") return node;

  for (const child of node.children) {
    const file = findFirstFile(child);
    if (file) return file;
  }

  return null;
}

function findFirstVisibleFile(node) {
  if (node.type === "file") return node.deletedAt ? null : node;

  for (const child of node.children) {
    if (child.deletedAt) continue;
    const file = findFirstVisibleFile(child);
    if (file) return file;
  }

  return null;
}

function hasVisibleProjectChildren(node) {
  return node.type === "folder" && node.children.some((child) => !child.deletedAt);
}

function collectProjectFileIds(node, ids = new Set<string>()) {
  if (node.type === "file") {
    ids.add(node.id);
    return ids;
  }

  if (node.type === "folder") {
    node.children.forEach((child) => collectProjectFileIds(child, ids));
  }

  return ids;
}

function getReadableSize(length = 0) {
  if (length < 1024) return `${length} B`;
  if (length < 1024 * 1024) return `${(length / 1024).toFixed(1)} KB`;
  return `${(length / (1024 * 1024)).toFixed(1)} MB`;
}

function getSortedProjectChildren(children, sortMode) {
  return [...children].sort((first, second) => {
    if (first.type !== second.type) {
      return first.type === "folder" ? -1 : 1;
    }

    if (sortMode === "type") {
      const firstType = first.type === "folder" ? "folder" : getProjectFileKind(first);
      const secondType = second.type === "folder" ? "folder" : getProjectFileKind(second);
      const typeCompare = firstType.localeCompare(secondType);
      if (typeCompare !== 0) return typeCompare;
    }

    return first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function projectNodeMatchesQuery(node, query, projectPath = "") {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const haystack = [
    node.name,
    node.type,
    node.type === "file" ? getProjectFileKind(node) : "folder",
    projectPath,
  ].join(" ").toLowerCase();

  return haystack.includes(normalizedQuery);
}

function projectNodeHasVisibleMatch(node, query, projectPath = "") {
  if (!query.trim()) return true;
  if (projectNodeMatchesQuery(node, query, projectPath)) return true;
  if (node.type !== "folder") return false;

  const currentPathParts = getProjectPathParts(projectPath || node.name);
  return node.children.some((child) => {
    const childPath = getProjectNodePath([...currentPathParts, child.name]);
    return projectNodeHasVisibleMatch(child, query, childPath);
  });
}

function collectJsonNodeTypes(value, nodeTypes = new Set()) {
  if (!value || typeof value !== "object") return nodeTypes;

  if (typeof value.type === "string") {
    nodeTypes.add(value.type);
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonNodeTypes(item, nodeTypes));
  } else if (Array.isArray(value.content)) {
    value.content.forEach((item) => collectJsonNodeTypes(item, nodeTypes));
  }

  return nodeTypes;
}

function parseXml(xml) {
  const trimmedXml = xml.trim();

  if (trimmedXml.startsWith("{") || trimmedXml.startsWith("[")) {
    try {
      const parsedJson = JSON.parse(trimmedXml);
      const contentTypes = [...collectJsonNodeTypes(parsedJson)].filter((type) => type !== "doc");
      const typesLabel = contentTypes.length ? ` Detected nodes: ${contentTypes.join(", ")}.` : "";

      return {
        doc: null,
        error: `This content is editor JSON, not XML. Export or convert it to DITA XML before validating.${typesLabel}`,
      };
    } catch {
      return {
        doc: null,
        error: "This content starts like JSON, but it is not valid JSON or XML.",
      };
    }
  }

  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.querySelector("parsererror");

  if (parserError) {
    return {
      doc: null,
      error: parserError.textContent.replace(/\s+/g, " ").trim().slice(0, 320),
    };
  }

  return { doc, error: null };
}

function isEditorJsonContent(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;

  try {
    const parsed = JSON.parse(trimmed);
    const nodeTypes = collectJsonNodeTypes(parsed);
    return nodeTypes.has("doc") || nodeTypes.has("paragraph") || nodeTypes.has("text");
  } catch {
    return false;
  }
}

function extractEditorJsonTextBlocks(node): string[] {
  if (!node || typeof node !== "object") return [];

  if (node.type === "paragraph" || node.type === "heading") {
    const text = extractEditorJsonInlineText(node).trim();
    return text ? [text] : [];
  }

  if (!Array.isArray(node.content)) return [];
  return node.content.flatMap((child) => extractEditorJsonTextBlocks(child));
}

function extractEditorJsonInlineText(node): string {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return String(node.text || "");
  if (node.type === "hardBreak") return "\n";
  if (!Array.isArray(node.content)) return "";

  return node.content.map(extractEditorJsonInlineText).join("");
}

function extractEditorJsonTopicRefs(node): Array<{ href: string; navtitle?: string; children: Array<any> }> {
  if (!node || typeof node !== "object") return [];

  const current = node.type === "ditaTopicRef"
    ? [{
        href: String(node.attrs?.href || ""),
        navtitle: node.attrs?.navtitle ? String(node.attrs.navtitle) : undefined,
        children: Array.isArray(node.content) ? node.content.flatMap(extractEditorJsonTopicRefs) : [],
      }]
    : [];

  if (!Array.isArray(node.content) || node.type === "ditaTopicRef") return current;
  return [...current, ...node.content.flatMap(extractEditorJsonTopicRefs)];
}

function serializeTopicRefFromJson(topicref, depth = 1): string {
  const pad = "  ".repeat(depth);
  const attrs = [
    topicref.href ? ` href="${escapeXml(topicref.href)}"` : "",
    topicref.navtitle ? ` navtitle="${escapeXml(topicref.navtitle)}"` : "",
  ].join("");

  if (!topicref.children.length) {
    return `${pad}<topicref${attrs}/>`;
  }

  const children = topicref.children.map((child) => serializeTopicRefFromJson(child, depth + 1)).join("\n");
  return `${pad}<topicref${attrs}>\n${children}\n${pad}</topicref>`;
}

function convertEditorJsonToDitaXml(rawContent: string, fileName: string, ditaType = "topic") {
  if (!isEditorJsonContent(rawContent)) return null;

  try {
    const parsed = JSON.parse(rawContent.trim());
    const title = fileName.replace(/\.[^./]+$/i, "").replace(/[-_]+/g, " ") || "Imported DITA";
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported-dita";

    if (ditaType === "map" || getFileExtension(fileName) === "ditamap") {
      const topicrefs = extractEditorJsonTopicRefs(parsed);
      const topicrefXml = topicrefs.length
        ? topicrefs.map((topicref) => serializeTopicRefFromJson(topicref, 1)).join("\n")
        : "  <topicref/>";

      return formatXml(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE map PUBLIC "-//OASIS//DTD DITA 1.3 Map//EN" "map.dtd">
<map>
  <title>${escapeXml(title)}</title>
${topicrefXml}
</map>`);
    }

    const paragraphs = extractEditorJsonTextBlocks(parsed);
    const paragraphXml = paragraphs.length
      ? paragraphs.map((text) => `    <p>${escapeXml(text)}</p>`).join("\n")
      : "    <p></p>";

    return formatXml(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA 1.3 Topic//EN" "topic.dtd">
<topic id="${id}">
  <title>${escapeXml(title)}</title>
  <body>
${paragraphXml}
  </body>
</topic>`);
  } catch {
    return null;
  }
}

function getTagSignature(xml) {
  return (xml.match(/<[^>]*>/g) || []).join("\n");
}

function tokenizeXmlSource(xml) {
  return xml.split(/(<[^>]*>)/g).filter(Boolean).map((token, index) => ({
    id: `${index}-${token.length}`,
    text: token,
    type: token.startsWith("<") && token.endsWith(">") ? "tag" : "text",
    tagName: getXmlSourceTokenTagName(token),
  }));
}

function getXmlSourceTokenTagName(token: string): string {
  if (!token.startsWith("<") || !token.endsWith(">")) return "";
  if (/^<\?/.test(token) || /^<!/.test(token)) return "";

  const match = token.match(/^<\/?\s*([A-Za-z_][\w:.-]*)/);
  return match?.[1] || "";
}

function getBrokenSchemaTagNames(issues): Set<string> {
  const tagNames = new Set<string>();

  for (const issue of issues || []) {
    if (issue.level !== "error") continue;
    if (Array.isArray(issue.tags)) {
      issue.tags.forEach((tagName) => tagNames.add(tagName));
    }

    const message = String(issue.message || "");
    for (const match of message.matchAll(/<([A-Za-z_][\w:.-]*)>/g)) {
      tagNames.add(match[1]);
    }
  }

  return tagNames;
}

function elementChildren(node: Element): Element[] {
  return Array.from(node.children);
}

function editableTextNodes(node: Element): ChildNode[] {
  return Array.from(node.childNodes).filter((child) => {
    if (!elementAllowsText(node.tagName)) {
      return child.nodeType === Node.ELEMENT_NODE;
    }

    if (
      child.nodeType === Node.TEXT_NODE &&
      isInlineRenderingElement(node.tagName) &&
      !(child.textContent || "").trim()
    ) {
      return false;
    }

    return child.nodeType === Node.TEXT_NODE || child.nodeType === Node.ELEMENT_NODE;
  });
}

function getNodeByPath(doc, path) {
  let node = doc.documentElement;

  for (const index of path) {
    node = elementChildren(node)[index];
    if (!node) return null;
  }

  return node;
}

function getPathForElement(doc: Document, target: Element): number[] | null {
  const path: number[] = [];
  let current: Element | null = target;

  while (current && current !== doc.documentElement) {
    const parent = current.parentElement;
    if (!parent) return null;
    const index = elementChildren(parent).indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }

  return current === doc.documentElement ? path : null;
}

function getRelativePathForElement(root: Element, target: Element): number[] | null {
  const path: number[] = [];
  let current: Element | null = target;

  while (current && current !== root) {
    const parent = current.parentElement;
    if (!parent) return null;
    const index = elementChildren(parent).indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }

  return current === root ? path : null;
}

function getAllowedChildOptions(node) {
  if (!node) return [];

  const definition = getElementDefinition(node.tagName);
  const allowed = definition?.children || [];
  const uniqueChildren = definition?.uniqueChildren || [];
  const nodeIsDocumentRoot = node === node.ownerDocument?.documentElement || isDocumentRootElement(node.tagName);
  const filterRootTopicCandidates = (options: string[]) => {
    if (!nodeIsDocumentRoot || node.tagName === "map") return options;
    return options.filter((tagName) => !isTopicRootCandidate(tagName) || tagName === node.tagName);
  };
  const filterVisible = (options: string[]) => applyAuthoringVisibilityFilter(filterRootTopicCandidates(options), node);

  if (uniqueChildren.length === 0) {
    return filterVisible(allowed);
  }

  const existing = elementChildren(node).map((child) => child.tagName);

  return filterVisible(allowed.filter((tagName) => {
    if (uniqueChildren.includes(tagName)) {
      return !existing.includes(tagName);
    }

    return true;
  }));
}

function getAllowedSiblingOptions(doc, selectedPath) {
  if (!doc || selectedPath.length === 0) return [];

  const parentPath = selectedPath.slice(0, -1);
  const parentNode = getNodeByPath(doc, parentPath);
  const selectedNode = getNodeByPath(doc, selectedPath);

  if (!parentNode || !selectedNode) return [];

  const parentDefinition = getElementDefinition(parentNode.tagName);
  const parentIsDocumentRoot = parentNode === doc.documentElement || isDocumentRootElement(parentNode.tagName);

  return getAllowedChildOptions(parentNode).filter((tagName) => {
    if (parentIsDocumentRoot && isDocumentRootElement(tagName)) return false;

    const isAllowedByParent = getElementDefinition(parentNode.tagName)?.children?.includes(tagName);
    if (!isAllowedByParent) return false;

    if (parentDefinition?.orderedChildren) {
      const order = parentDefinition.childOrder?.length ? parentDefinition.childOrder : parentDefinition.children;
      const selectedOrder = order.indexOf(selectedNode.tagName);
      const candidateOrder = order.indexOf(tagName);

      return selectedOrder === -1 || candidateOrder === -1 || candidateOrder >= selectedOrder;
    }

    return true;
  });
}

function getAllowedSurroundOptions(doc, authoringSelection) {
  if (!doc || authoringSelection?.kind !== "range") return [];

  const parentNode = getNodeByPath(doc, authoringSelection.path);
  if (!parentNode) return [];

  return getAllowedChildOptions(parentNode).filter((tagName) => isKnownInlineElement(tagName));
}

function uniqueOptions(options: string[]) {
  return [...new Set(options)];
}

function getAuthoringInsertActions(doc, selectedPath, authoringSelection = null) {
  const selectedNode = doc ? getNodeByPath(doc, selectedPath) : null;
  const childOptions = getAllowedChildOptions(selectedNode);
  const siblingOptions = getAllowedSiblingOptions(doc, selectedPath);
  const surroundOptions = getAllowedSurroundOptions(doc, authoringSelection);

  return {
    selectedNode,
    childOptions,
    siblingOptions,
    surroundOptions,
    ribbonOptions: uniqueOptions([
      ...childOptions,
      ...siblingOptions,
      ...surroundOptions,
    ]),
  };
}

type TableCommand =
  | "insert-column-before"
  | "insert-column-after"
  | "insert-row-before"
  | "insert-row-after"
  | "delete-column"
  | "delete-row"
  | "merge-right"
  | "merge-left"
  | "split-cells";

type TableContext = {
  canEditColumns: boolean;
  cellPath: number[] | null;
  columnIndex: number;
  label: string;
  model: "cals" | "simple" | "choice" | "properties";
  rowPath: number[] | null;
  tablePath: number[];
};

function hasSchemaChild(tagName: string, childName: string): boolean {
  return Boolean(getElementDefinition(tagName)?.children?.includes(childName));
}

function getTableModelForRow(tagName: string): TableContext["model"] | null {
  if (tagName === "row" || hasSchemaChild(tagName, "entry")) return "cals";
  if (tagName === "strow" || hasSchemaChild(tagName, "stentry")) return "simple";
  if (tagName === "chrow" || (hasSchemaChild(tagName, "choption") && hasSchemaChild(tagName, "chdesc"))) return "choice";
  if (tagName === "property" || (hasSchemaChild(tagName, "proptype") && hasSchemaChild(tagName, "propvalue"))) return "properties";
  return null;
}

function getTableModelForTable(tagName: string): TableContext["model"] | null {
  if (tagName === "table" || tagName === "tgroup" || hasSchemaChild(tagName, "tgroup")) return "cals";
  if (tagName === "simpletable" || hasSchemaChild(tagName, "strow")) return "simple";
  if (tagName === "choicetable" || hasSchemaChild(tagName, "chrow")) return "choice";
  if (tagName === "properties" || hasSchemaChild(tagName, "property")) return "properties";
  return null;
}

function getTableCellTags(model: TableContext["model"]): string[] {
  if (model === "cals") return ["entry"];
  if (model === "simple") return ["stentry"];
  if (model === "choice") return ["choption", "chdesc"];
  return ["proptype", "propvalue", "propdesc"];
}

function isTableCellForModel(tagName: string, model: TableContext["model"]) {
  return getTableCellTags(model).includes(tagName);
}

function getTableRows(table: Element, model: TableContext["model"]): Element[] {
  const rowTag = model === "cals"
    ? "row"
    : model === "simple"
      ? "strow"
      : model === "choice"
        ? "chrow"
        : "property";

  return Array.from(table.getElementsByTagName(rowTag));
}

function isTableContainerElement(tagName: string): boolean {
  return Boolean(getTableModelForTable(tagName) || ["tbody", "thead", "tgroup"].includes(tagName));
}

function isTableRowElement(tagName: string): boolean {
  return Boolean(getTableModelForRow(tagName));
}

function isTableCellElement(tagName: string): boolean {
  return ["entry", "stentry", "choption", "chdesc", "proptype", "propvalue", "propdesc"].includes(tagName);
}

function isVisualMetadataElement(tagName: string): boolean {
  return tagName === "colspec";
}

function getRowCells(row: Element, model: TableContext["model"]): Element[] {
  const cellTags = getTableCellTags(model);
  return elementChildren(row).filter((child) => cellTags.includes(child.tagName));
}

function createTableRowElement(doc: Document, rowTagName: string, referenceRow: Element | null = null): Element | null {
  const model = getTableModelForRow(rowTagName);
  if (!model) return null;

  const row = doc.createElement(rowTagName);
  const fixedCellTags = model === "choice" || model === "properties" ? getTableCellTags(model) : null;
  const referenceCells = referenceRow ? getRowCells(referenceRow, model) : [];
  const fallbackCellCount = model === "cals" || model === "simple" ? Math.max(1, referenceCells.length || 2) : 0;
  const cellTags = fixedCellTags || Array.from({ length: fallbackCellCount }, () => getTableCellTags(model)[0]);

  for (const cellTag of cellTags) {
    row.append(createElementFor(doc, cellTag));
  }

  return row;
}

function syncCalsTgroupColumnCount(model: TableContext["model"], table: Element) {
  if (model !== "cals") return;

  const rows = getTableRows(table, model);
  const maxColumns = Math.max(1, ...rows.map((row) => getRowCells(row, model).length));
  const tgroup = table.tagName === "tgroup" ? table : table.getElementsByTagName("tgroup")[0];
  if (tgroup) {
    tgroup.setAttribute("cols", String(maxColumns));
  }
}

function calsTableHasSpans(table: Element): boolean {
  return Array.from(table.getElementsByTagName("entry")).some((entry) => (
    entry.hasAttribute("namest") ||
    entry.hasAttribute("nameend") ||
    entry.hasAttribute("spanname") ||
    Number(entry.getAttribute("morerows") || 0) > 0
  ));
}

function getCalsTgroup(table: Element): Element | null {
  return table.tagName === "tgroup" ? table : table.getElementsByTagName("tgroup")[0] || null;
}

function getCalsColspecs(table: Element): Element[] {
  const tgroup = getCalsTgroup(table);
  return tgroup ? Array.from(tgroup.children).filter((child) => child.tagName === "colspec") : [];
}

function getCalsColumnNames(table: Element) {
  const tgroup = getCalsTgroup(table);
  const colspecs = getCalsColspecs(table);
  const cols = Math.max(
    Number(tgroup?.getAttribute("cols") || 0),
    colspecs.length,
    1,
  );

  return Array.from({ length: cols }, (_, index) => (
    colspecs[index]?.getAttribute("colname") || `col${index + 1}`
  ));
}

function getUniqueCalsColname(existingNames: string[], preferredIndex: number) {
  let index = preferredIndex + 1;
  let candidate = `col${index}`;
  while (existingNames.includes(candidate)) {
    index += 1;
    candidate = `col${index}`;
  }
  return candidate;
}

function createCalsColspec(doc: Document, colIndex: number) {
  const colspec = doc.createElement("colspec");
  colspec.setAttribute("colname", `col${colIndex + 1}`);
  return colspec;
}

function createCalsRowWithColumnCount(doc: Document, columnCount: number) {
  const row = doc.createElement("row");
  const safeColumnCount = Math.max(1, columnCount);
  for (let index = 0; index < safeColumnCount; index += 1) {
    row.append(createElementFor(doc, "entry"));
  }
  return row;
}

function getCalsDeclaredColumnCount(tgroup: Element) {
  return Math.max(1, Number(tgroup.getAttribute("cols") || 0));
}

function ensureCalsSectionRows(section: Element, tgroup: Element) {
  const columnCount = getCalsDeclaredColumnCount(tgroup);
  const rows = Array.from(section.children).filter((child) => child.tagName === "row") as Element[];

  if (!rows.length) {
    section.append(createCalsRowWithColumnCount(section.ownerDocument, columnCount));
    return;
  }

  rows.forEach((row) => {
    const cells = getRowCells(row, "cals");
    while (getRowCells(row, "cals").length < columnCount) {
      row.append(createElementFor(section.ownerDocument, "entry"));
    }

    cells.slice(columnCount).forEach((cell) => {
      if (isEmptyElement(cell)) {
        cell.remove();
      }
    });
  });
}

function insertCalsTheadIntoTgroup(tgroup: Element, thead: Element) {
  ensureCalsSectionRows(thead, tgroup);
  const tbody = elementChildren(tgroup).find((child) => child.tagName === "tbody") || null;
  tgroup.insertBefore(thead, tbody);
}

function ensureCalsColspecs(table: Element, doc: Document) {
  const tgroup = getCalsTgroup(table);
  if (!tgroup) return [];

  const targetCols = Math.max(Number(tgroup.getAttribute("cols") || 0), getCalsColspecs(table).length, 1);
  let colspecs = getCalsColspecs(table);
  if (colspecs.length >= targetCols) return colspecs;

  for (let index = colspecs.length; index < targetCols; index += 1) {
    const colspec = createCalsColspec(doc, index);
    const insertBefore = Array.from(tgroup.children).find((child) => child.tagName !== "colspec") || null;
    tgroup.insertBefore(colspec, insertBefore);
  }

  colspecs = getCalsColspecs(table);
  return colspecs;
}

function getCalsEntrySpan(entry: Element, columnNames: string[], fallbackColumn: number) {
  const nameToIndex = new Map(columnNames.map((name, index) => [name, index]));
  const namest = entry.getAttribute("namest");
  const nameend = entry.getAttribute("nameend");
  const colname = entry.getAttribute("colname");
  let startCol = fallbackColumn;
  let endCol = fallbackColumn;

  if (namest && nameToIndex.has(namest)) {
    startCol = nameToIndex.get(namest) ?? fallbackColumn;
    endCol = nameend && nameToIndex.has(nameend)
      ? nameToIndex.get(nameend) ?? startCol
      : startCol;
  } else if (colname && nameToIndex.has(colname)) {
    startCol = nameToIndex.get(colname) ?? fallbackColumn;
    endCol = startCol;
  }

  if (endCol < startCol) {
    [startCol, endCol] = [endCol, startCol];
  }

  return {
    endCol,
    morerows: Math.max(0, Number(entry.getAttribute("morerows") || 0)),
    startCol,
  };
}

function findAncestorByTagName(node: Element | null | undefined, tagName: string): Element | null {
  let current = node?.parentElement || null;
  while (current) {
    if (current.tagName === tagName) return current;
    current = current.parentElement;
  }
  return null;
}

function getCalsRowOccupiedColumnCount(row: Element, columnNames: string[]): number {
  let currentColumn = 0;
  getRowCells(row, "cals").forEach((entry) => {
    const span = getCalsEntrySpan(entry, columnNames, currentColumn);
    currentColumn = Math.max(currentColumn, span.endCol + 1);
  });
  return currentColumn;
}

function getCalsSequentialRowCells(row: Element, columnNames: string[]) {
  let currentColumn = 0;
  return getRowCells(row, "cals").map((entry) => {
    const span = getCalsEntrySpan(entry, columnNames, currentColumn);
    currentColumn = Math.max(currentColumn, span.endCol + 1);
    return { entry, ...span };
  });
}

function mergeCalsEntryContent(targetEntry: Element, coveredEntry: Element) {
  if (isEmptyElement(coveredEntry)) return;

  const targetHasContent = Boolean((targetEntry.textContent || "").trim()) || elementChildren(targetEntry).length > 0;
  const coveredHasLeadingText = coveredEntry.firstChild?.nodeType === Node.TEXT_NODE;
  if (targetHasContent && coveredHasLeadingText) {
    targetEntry.appendChild(targetEntry.ownerDocument.createTextNode(" "));
  }

  while (coveredEntry.firstChild) {
    targetEntry.appendChild(coveredEntry.firstChild);
  }
}

function compactCalsFullyMergedColumns(tgroup: Element) {
  const columnNames = getCalsColumnNames(tgroup);
  if (columnNames.length <= 1) return;

  const rows = getTableRows(tgroup, "cals");
  if (rows.length <= 1) return;

  const rowEntries = rows.map((row) => getRowCells(row, "cals"));
  const everyRowIsFullyMerged = rowEntries.every((entries, rowIndex) => {
    if (entries.length !== 1) return false;
    const span = getCalsEntrySpan(entries[0], columnNames, 0);
    return span.startCol === 0 && span.endCol === columnNames.length - 1;
  });

  if (!everyRowIsFullyMerged) return;

  tgroup.setAttribute("cols", "1");
  const colspecs = getCalsColspecs(tgroup);
  if (colspecs[0]) {
    colspecs[0].setAttribute("colname", "col1");
  } else {
    const insertBefore = Array.from(tgroup.children).find((child) => child.tagName !== "colspec") || null;
    tgroup.insertBefore(createCalsColspec(tgroup.ownerDocument, 0), insertBefore);
  }

  getCalsColspecs(tgroup).slice(1).forEach((colspec) => colspec.remove());
  rowEntries.forEach(([entry]) => {
    entry.removeAttribute("colname");
    entry.removeAttribute("namest");
    entry.removeAttribute("nameend");
  });
}

function normalizeCalsRowAfterHorizontalSpanEdit(doc: Document, entry: Element) {
  const row = entry.parentElement?.tagName === "row" ? entry.parentElement : null;
  const tgroup = findAncestorByTagName(entry, "tgroup");
  if (!row || !tgroup) return;

  const columnNames = getCalsColumnNames(tgroup);
  const columnCount = columnNames.length;
  let currentColumn = 0;

  for (const currentEntry of getRowCells(row, "cals")) {
    const span = getCalsEntrySpan(currentEntry, columnNames, currentColumn);
    const startsBeyondTable = span.startCol >= columnCount;
    const overlapsEarlierEntry = span.startCol < currentColumn;
    const overflowsTable = span.endCol >= columnCount;

    if (
      currentEntry !== entry &&
      (startsBeyondTable || overlapsEarlierEntry || overflowsTable)
    ) {
      mergeCalsEntryContent(entry, currentEntry);
      currentEntry.remove();
      continue;
    }

    currentColumn = Math.max(currentColumn, span.endCol + 1);
  }

  let occupiedColumnCount = getCalsRowOccupiedColumnCount(row, columnNames);
  while (occupiedColumnCount < columnCount) {
    row.append(createElementFor(doc, "entry"));
    occupiedColumnCount += 1;
  }

  compactCalsFullyMergedColumns(tgroup);
}

function restoreAttributeValue(element: Element, name: string, value: string | null) {
  if (value === null) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
}

function getCalsHorizontalSpanIssue(entry: Element, editedAttribute: string, previousValue: string | null): string | null {
  const row = entry.parentElement?.tagName === "row" ? entry.parentElement : null;
  const tgroup = findAncestorByTagName(entry, "tgroup");
  if (!row || !tgroup) return null;

  const columnNames = getCalsColumnNames(tgroup);
  const desiredTargetCell = getCalsSequentialRowCells(row, columnNames).find((cell) => cell.entry === entry);
  if (!desiredTargetCell) return "Could not resolve the selected table cell.";

  const currentValue = entry.getAttribute(editedAttribute);
  restoreAttributeValue(entry, editedAttribute, previousValue);
  const baseRowCells = getCalsSequentialRowCells(row, columnNames);
  restoreAttributeValue(entry, editedAttribute, currentValue);

  const coveredCells = baseRowCells.filter((cell) => (
    cell.entry !== entry &&
    cell.startCol <= desiredTargetCell.endCol &&
    cell.endCol >= desiredTargetCell.startCol
  ));

  const spanningMoreRows = desiredTargetCell.morerows;
  const mismatchedRowSpan = coveredCells.find((cell) => {
    const coveredMoreRows = Number(cell.entry.getAttribute("morerows") || 0);
    return !(spanningMoreRows === 0 && coveredMoreRows === 0) && coveredMoreRows !== spanningMoreRows;
  });

  if (mismatchedRowSpan) {
    return `Cannot merge cells with different morerows values. Set both cells to the same morerows value, or clear morerows on both cells first.`;
  }

  return null;
}

function getCalsVerticalSpanBaseContext(entry: Element, requestedMoreRows: number) {
  const tgroup = findAncestorByTagName(entry, "tgroup");
  const currentValue = entry.getAttribute("morerows");
  if (!tgroup) return null;

  entry.removeAttribute("morerows");
  const grid = resolveCalsGrid(tgroup);
  if (currentValue === null) {
    entry.removeAttribute("morerows");
  } else {
    entry.setAttribute("morerows", currentValue);
  }

  if (!grid.valid) return null;

  const targetCell = getCalsGridCellForEntry(grid, entry);
  if (!targetCell) return null;

  return {
    grid,
    requestedMoreRows,
    targetCell,
  };
}

function getCalsVerticalSpanIssue(entry: Element): string | null {
  const tgroup = findAncestorByTagName(entry, "tgroup");
  if (!tgroup) return null;

  const requestedMoreRows = Number(entry.getAttribute("morerows") || 0);
  if (requestedMoreRows <= 0) return null;

  const context = getCalsVerticalSpanBaseContext(entry, requestedMoreRows);
  if (!context) return "Could not resolve the selected table cell.";

  const { grid, targetCell } = context;
  if (targetCell.rowIndex + requestedMoreRows >= grid.rows.length) {
    return `morerows="${requestedMoreRows}" requires ${requestedMoreRows} row${requestedMoreRows === 1 ? "" : "s"} below the current row.`;
  }

  for (let offset = 1; offset <= requestedMoreRows; offset += 1) {
    const targetRowIndex = targetCell.rowIndex + offset;
    const rowCells = grid.rows[targetRowIndex]?.cells || [];
    const coveredCells = rowCells.filter((cell) => (
      cell.startCol <= targetCell.endCol && cell.endCol >= targetCell.startCol
    ));
    const matchingFootprintCell = coveredCells.length === 1 &&
      coveredCells[0].startCol === targetCell.startCol &&
      coveredCells[0].endCol === targetCell.endCol;

    if (!matchingFootprintCell) {
      return `morerows="${requestedMoreRows}" requires the cell below in row ${targetRowIndex + 1} to have the same column span.`;
    }

    const rowIsFullyCovered = coveredCells.length === rowCells.length;
    const nonEmptyCoveredCell = coveredCells.find((cell) => !isEmptyElement(cell.entry));
    if (!rowIsFullyCovered && nonEmptyCoveredCell) {
      return `morerows="${requestedMoreRows}" would overlap non-empty content in row ${targetRowIndex + 1}.`;
    }
  }

  return null;
}

function decrementCalsSpansCrossingRemovedRows(tgroup: Element, removedRowIndexes: number[]) {
  if (!removedRowIndexes.length) return;

  const grid = resolveCalsGrid(tgroup);
  if (!grid.valid) return;

  const decrementCounts = new Map<Element, number>();
  removedRowIndexes.forEach((removedRowIndex) => {
    const entriesCrossingRow = new Set<Element>();
    (grid.rows[removedRowIndex]?.slots || []).forEach((cell) => {
      if (cell && cell.rowIndex < removedRowIndex && cell.endRow >= removedRowIndex) {
        entriesCrossingRow.add(cell.entry);
      }
    });
    entriesCrossingRow.forEach((entry) => {
      decrementCounts.set(entry, (decrementCounts.get(entry) || 0) + 1);
    });
  });

  decrementCounts.forEach((count, spanningEntry) => {
    const currentMoreRows = Number(spanningEntry.getAttribute("morerows") || 0);
    const nextMoreRows = Math.max(0, currentMoreRows - count);
    if (nextMoreRows > 0) {
      spanningEntry.setAttribute("morerows", String(nextMoreRows));
    } else {
      spanningEntry.removeAttribute("morerows");
    }
  });
}

function normalizeCalsRowsAfterVerticalSpanEdit(entry: Element) {
  const tgroup = findAncestorByTagName(entry, "tgroup");
  const requestedMoreRows = Number(entry.getAttribute("morerows") || 0);
  if (!tgroup || requestedMoreRows <= 0) return;

  const context = getCalsVerticalSpanBaseContext(entry, requestedMoreRows);
  if (!context) return;

  const { grid, targetCell } = context;
  if (targetCell.rowIndex + requestedMoreRows >= grid.rows.length) return;

  const rowIndexesToRemove: number[] = [];
  const rowsToRemove: Element[] = [];
  const cellsToRemove: Element[] = [];

  for (let offset = 1; offset <= requestedMoreRows; offset += 1) {
    const rowGrid = grid.rows[targetCell.rowIndex + offset];
    const rowCells = rowGrid?.cells || [];
    const coveredCells = rowCells.filter((cell) => (
      cell.startCol <= targetCell.endCol && cell.endCol >= targetCell.startCol
    ));
    if (rowCells.length && coveredCells.length === rowCells.length) {
      rowIndexesToRemove.push(rowGrid.rowIndex);
      rowsToRemove.push(rowGrid.row);
    } else {
      coveredCells
        .filter((cell) => isEmptyElement(cell.entry))
        .forEach((cell) => cellsToRemove.push(cell.entry));
    }
  }

  decrementCalsSpansCrossingRemovedRows(tgroup, rowIndexesToRemove);
  rowsToRemove.forEach((row) => row.remove());
  cellsToRemove.forEach((cell) => cell.remove());
}

function insertCalsEntriesAtColumn(doc: Document, rowGrid, insertBeforeCol: number, count: number) {
  const { nextCell, previousCell } = getCalsInsertReferenceCell(rowGrid, insertBeforeCol - 1);
  let lastInserted: Element | null = null;

  for (let index = 0; index < count; index += 1) {
    const newCell = createElementFor(doc, "entry");
    if (nextCell?.entry) {
      rowGrid.row.insertBefore(newCell, nextCell.entry);
    } else if (lastInserted) {
      rowGrid.row.insertBefore(newCell, lastInserted.nextSibling);
    } else if (previousCell?.entry) {
      rowGrid.row.insertBefore(newCell, previousCell.entry.nextSibling);
    } else {
      rowGrid.row.appendChild(newCell);
    }
    lastInserted = newCell;
  }
}

function splitCalsSpannedCell(doc: Document, entry: Element) {
  const tgroup = findAncestorByTagName(entry, "tgroup");
  if (!tgroup) return false;

  const grid = resolveCalsGrid(tgroup);
  if (!grid.valid) return false;

  const selectedCell = getCalsGridCellForEntry(grid, entry);
  if (!selectedCell) return false;

  const colSpan = selectedCell.endCol - selectedCell.startCol + 1;
  const rowSpan = selectedCell.rowSpan;
  if (colSpan <= 1 && rowSpan <= 1) return false;

  entry.removeAttribute("colname");
  entry.removeAttribute("namest");
  entry.removeAttribute("nameend");
  entry.removeAttribute("morerows");

  let lastInserted: Element = entry;
  for (let index = 1; index < colSpan; index += 1) {
    const restoredEntry = createElementFor(doc, "entry");
    selectedCell.row.insertBefore(restoredEntry, lastInserted.nextSibling);
    lastInserted = restoredEntry;
  }

  const columnCount = grid.columnCount || getCalsDeclaredColumnCount(tgroup);
  let insertionAnchor = selectedCell.row;
  for (let rowIndex = selectedCell.rowIndex + 1; rowIndex <= selectedCell.endRow; rowIndex += 1) {
    const rowGrid = grid.rows[rowIndex];
    if (rowGrid?.row?.parentNode) {
      insertCalsEntriesAtColumn(doc, rowGrid, selectedCell.startCol, colSpan);
      insertionAnchor = rowGrid.row;
      continue;
    }

    const restoredRow = createCalsRowWithColumnCount(doc, columnCount);
    insertionAnchor.parentNode?.insertBefore(restoredRow, insertionAnchor.nextSibling);
    insertionAnchor = restoredRow;
  }

  return true;
}

function validateCalsEntrySpans(table: Element) {
  const columnNames = getCalsColumnNames(table);
  const columnNameSet = new Set(columnNames);
  const issues: string[] = [];

  getTableRows(table, "cals").forEach((row, rowIndex) => {
    getRowCells(row, "cals").forEach((entry, entryIndex) => {
      const label = `row ${rowIndex + 1}, entry ${entryIndex + 1}`;
      const colname = entry.getAttribute("colname");
      const namest = entry.getAttribute("namest");
      const nameend = entry.getAttribute("nameend");
      const morerows = entry.getAttribute("morerows");

      if (colname && !columnNameSet.has(colname)) {
        issues.push(`${label} references unknown colname "${colname}".`);
      }

      if (namest && !columnNameSet.has(namest)) {
        issues.push(`${label} references unknown namest "${namest}".`);
      }

      if (nameend && !columnNameSet.has(nameend)) {
        issues.push(`${label} references unknown nameend "${nameend}".`);
      }

      if (namest && nameend && columnNameSet.has(namest) && columnNameSet.has(nameend)) {
        const startIndex = columnNames.indexOf(namest);
        const endIndex = columnNames.indexOf(nameend);
        if (startIndex > endIndex) {
          issues.push(`${label} has namest after nameend.`);
        }
      }

      if (morerows && (!/^\d+$/.test(morerows) || Number(morerows) < 0)) {
        issues.push(`${label} has invalid morerows "${morerows}".`);
      }
    });
  });

  return {
    issues,
    valid: issues.length === 0,
  };
}

function resolveCalsGrid(table: Element) {
  const validation = validateCalsEntrySpans(table);
  if (!validation.valid) {
    return {
      columnCount: 0,
      columnNames: [],
      rows: [],
      valid: false,
      validationIssues: validation.issues,
    };
  }

  const columnNames = getCalsColumnNames(table);
  const rows = getTableRows(table, "cals");
  const activeSpans: Array<any | null> = [];
  const resolvedRows = [];

  rows.forEach((row, rowIndex) => {
    const entries = getRowCells(row, "cals");
    const slots: Array<any | null> = [];
    const rowCells = [];
    const nextSpans = activeSpans.map((span) => (
      span && span.remaining > 1 ? { ...span, remaining: span.remaining - 1 } : null
    ));

    activeSpans.forEach((span, columnIndex) => {
      if (span?.cell) {
        slots[columnIndex] = span.cell;
      }
    });

    let searchColumn = 0;
    entries.forEach((entry) => {
      while (slots[searchColumn]) searchColumn += 1;

      const span = getCalsEntrySpan(entry, columnNames, searchColumn);
      const cell = {
        endCol: span.endCol,
        endRow: rowIndex + span.morerows,
        entry,
        row,
        rowIndex,
        rowSpan: span.morerows + 1,
        startCol: span.startCol,
      };

      rowCells.push(cell);

      for (let columnIndex = span.startCol; columnIndex <= span.endCol; columnIndex += 1) {
        slots[columnIndex] = cell;
        if (span.morerows > 0) {
          nextSpans[columnIndex] = { cell, remaining: span.morerows };
        }
      }

      searchColumn = span.endCol + 1;
    });

    resolvedRows.push({ cells: rowCells, row, rowIndex, slots });
    activeSpans.splice(0, activeSpans.length, ...nextSpans);
  });

  return {
    columnCount: Math.max(columnNames.length, ...resolvedRows.map((row) => row.slots.length)),
    columnNames,
    rows: resolvedRows,
    valid: true,
    validationIssues: [],
  };
}

function getCalsGridCellForEntry(grid, entry: Element) {
  for (const row of grid.rows) {
    const cell = row.cells.find((candidate) => candidate.entry === entry);
    if (cell) return cell;
  }
  return null;
}

function insertCalsColspecAfter(table: Element, doc: Document, insertAfterCol: number) {
  const tgroup = getCalsTgroup(table);
  if (!tgroup) return null;

  const colspecs = ensureCalsColspecs(table, doc);
  const nextCols = Math.max(Number(tgroup.getAttribute("cols") || 0), colspecs.length, insertAfterCol + 1) + 1;
  tgroup.setAttribute("cols", String(nextCols));

  const columnNames = getCalsColumnNames(table);
  const newColspec = doc.createElement("colspec");
  newColspec.setAttribute("colname", getUniqueCalsColname(columnNames, insertAfterCol + 1));

  if (insertAfterCol < 0) {
    const firstColspec = colspecs[0] || Array.from(tgroup.children).find((child) => child.tagName !== "colspec") || null;
    tgroup.insertBefore(newColspec, firstColspec);
  } else {
    const referenceColspec = colspecs[insertAfterCol] || colspecs.at(-1) || null;
    if (referenceColspec) {
    tgroup.insertBefore(newColspec, referenceColspec.nextSibling);
    } else {
      tgroup.insertBefore(newColspec, tgroup.firstChild);
    }
  }

  return newColspec;
}

function deleteCalsColspecAt(table: Element, columnIndex: number) {
  const tgroup = getCalsTgroup(table);
  if (!tgroup) return;

  const colspecs = getCalsColspecs(table);
  const colspec = colspecs[columnIndex];
  if (colspec?.parentNode) {
    colspec.parentNode.removeChild(colspec);
  }
}

function getCalsInsertReferenceCell(rowGrid, insertAfterCol: number) {
  const rowOwnedCells = rowGrid.cells;
  const previousCell = [...rowOwnedCells].reverse().find((cell) => cell.endCol <= insertAfterCol) || null;
  const nextCell = rowOwnedCells.find((cell) => cell.startCol > insertAfterCol) || null;
  return { nextCell, previousCell };
}

function insertCalsColumnAfterIndex(
  doc: Document,
  table: Element,
  insertAfterCol: number,
  selectedRow: Element | null = null,
) {
  const grid = resolveCalsGrid(table);
  if (!grid.valid) return null;

  const newColspec = insertCalsColspecAfter(table, doc, insertAfterCol);
  if (!newColspec) return null;

  let selectedRowNewCell: Element | null = null;
  for (const rowGrid of grid.rows) {
    const crossingSpan = rowGrid.slots.find((cell) => (
      cell && cell.startCol <= insertAfterCol && cell.endCol > insertAfterCol
    ));
    if (crossingSpan) continue;

    const newCell = createElementFor(doc, "entry");
    const { nextCell, previousCell } = getCalsInsertReferenceCell(rowGrid, insertAfterCol);

    if (nextCell?.entry) {
      rowGrid.row.insertBefore(newCell, nextCell.entry);
    } else if (previousCell?.entry) {
      rowGrid.row.insertBefore(newCell, previousCell.entry.nextSibling);
    } else {
      rowGrid.row.appendChild(newCell);
    }

    if (selectedRow && rowGrid.row === selectedRow) {
      selectedRowNewCell = newCell;
    }
  }

  return { newColspec, selectedRowNewCell };
}

function insertCalsColumnAfterCell(doc: Document, selectedPath: number[]): number[] | null | undefined {
  const selectedNode = getNodeByPath(doc, selectedPath);
  const context = findNearestTableContext(doc, selectedPath);
  if (!selectedNode || context?.model !== "cals") return undefined;
  if (!isTableCellForModel(selectedNode.tagName, context.model)) return undefined;

  const table = getNodeByPath(doc, context.tablePath);
  if (!table) return null;

  const grid = resolveCalsGrid(table);
  const selectedGridCell = getCalsGridCellForEntry(grid, selectedNode);
  if (!selectedGridCell) return null;

  const insertAfterCol = selectedGridCell.endCol;
  const result = insertCalsColumnAfterIndex(doc, table, insertAfterCol, selectedGridCell.row);
  const selectedRowNewCell = result?.selectedRowNewCell || null;

  return selectedRowNewCell ? getPathForElement(doc, selectedRowNewCell) : context.tablePath;
}

function insertTableColumnAfterCell(doc: Document, selectedPath: number[], cellTagName: string): number[] | null | undefined {
  const selectedNode = getNodeByPath(doc, selectedPath);
  const context = findNearestTableContext(doc, selectedPath);
  if (!selectedNode || !context?.canEditColumns) return undefined;
  if (!isTableCellForModel(selectedNode.tagName, context.model) || !isTableCellForModel(cellTagName, context.model)) {
    return undefined;
  }

  if (context.model === "cals") {
    return insertCalsColumnAfterCell(doc, selectedPath);
  }

  const table = getNodeByPath(doc, context.tablePath);
  if (!table) return null;

  const rows = getTableRows(table, context.model);
  const columnIndex = Math.max(0, context.columnIndex);
  let selectedRowNewCell: Element | null = null;

  for (const currentRow of rows) {
    const cells = getRowCells(currentRow, context.model);
    const referenceCell = cells[Math.min(columnIndex, Math.max(0, cells.length - 1))] || null;
    const newCell = createElementFor(doc, cellTagName);

    if (referenceCell) {
      currentRow.insertBefore(newCell, referenceCell.nextSibling);
    } else {
      currentRow.appendChild(newCell);
    }

    const currentRowPath = context.rowPath ? getPathForElement(doc, currentRow) : null;
    if (currentRowPath?.join(".") === context.rowPath?.join(".")) {
      selectedRowNewCell = newCell;
    }
  }

  syncCalsTgroupColumnCount(context.model, table);
  return selectedRowNewCell ? getPathForElement(doc, selectedRowNewCell) : context.tablePath;
}

function deleteTableColumnAtCell(doc: Document, selectedPath: number[]): number[] | null | undefined {
  const selectedNode = getNodeByPath(doc, selectedPath);
  const context = findNearestTableContext(doc, selectedPath);
  if (!selectedNode || !context?.canEditColumns) return undefined;
  if (!isTableCellForModel(selectedNode.tagName, context.model)) return undefined;

  const table = getNodeByPath(doc, context.tablePath);
  if (!table) return null;
  if (context.model === "cals" && calsTableHasSpans(table)) return null;

  const rows = getTableRows(table, context.model);
  if (!rows.length) return null;

  const columnIndex = Math.max(0, context.columnIndex);
  const maxColumns = Math.max(0, ...rows.map((row) => getRowCells(row, context.model).length));
  if (maxColumns <= 1) return context.tablePath;

  if (context.model === "cals") {
    ensureCalsColspecs(table, doc);
    deleteCalsColspecAt(table, columnIndex);
  }

  for (const currentRow of rows) {
    const cells = getRowCells(currentRow, context.model);
    const cell = cells[columnIndex];
    if (cell?.parentNode) {
      cell.parentNode.removeChild(cell);
    }
  }

  syncCalsTgroupColumnCount(context.model, table);
  return context.tablePath;
}

function findNearestTableContext(doc: Document | null, selectedPath: number[] = []): TableContext | null {
  if (!doc?.documentElement) return null;

  const ancestry = selectedPath
    .map((_, index) => selectedPath.slice(0, index + 1))
    .reverse();
  ancestry.push([]);

  let rowPath: number[] | null = null;
  let cellPath: number[] | null = null;
  let model: TableContext["model"] | null = null;

  for (const path of ancestry) {
    const node = getNodeByPath(doc, path);
    if (!node) continue;

    if (!cellPath && model && isTableCellForModel(node.tagName, model)) {
      cellPath = path;
    }

    const rowModel = getTableModelForRow(node.tagName);
    if (!rowPath && rowModel) {
      rowPath = path;
      model = rowModel;
      const selectedNode = getNodeByPath(doc, selectedPath);
      if (selectedNode && isTableCellForModel(selectedNode.tagName, model)) {
        cellPath = selectedPath;
      }
    }
  }

  for (const path of ancestry) {
    const node = getNodeByPath(doc, path);
    if (!node) continue;
    const tableModel = getTableModelForTable(node.tagName);
    if (!tableModel) continue;

    const resolvedModel = model || tableModel;
    const row = rowPath ? getNodeByPath(doc, rowPath) : null;
    const rowCells = row ? getRowCells(row, resolvedModel) : [];
    const resolvedCellPath = cellPath || rowCells
      .map((cell) => getPathForElement(doc, cell))
      .find((candidatePath) => candidatePath && pathStartsWith(selectedPath, candidatePath)) || null;
    const cell = resolvedCellPath ? getNodeByPath(doc, resolvedCellPath) : null;
    const columnIndex = cell && rowCells.includes(cell)
      ? rowCells.indexOf(cell)
      : Math.max(0, rowCells.length - 1);

    return {
      canEditColumns: resolvedModel === "cals" || resolvedModel === "simple",
      cellPath: resolvedCellPath,
      columnIndex,
      label: node.tagName,
      model: resolvedModel,
      rowPath,
      tablePath: path,
    };
  }

  return null;
}

function getTableCommandValidation(doc: Document | null, selectedPath: number[], command: TableCommand) {
  const context = findNearestTableContext(doc, selectedPath);
  if (!doc || !context) return { enabled: false, reason: "No table selected." };

  const table = getNodeByPath(doc, context.tablePath);
  const row = context.rowPath ? getNodeByPath(doc, context.rowPath) : null;
  const cell = context.cellPath ? getNodeByPath(doc, context.cellPath) : null;
  if (!table) return { enabled: false, reason: "No table selected." };

  if (command === "insert-row-before" || command === "insert-row-after") {
    return row
      ? { enabled: true, reason: "" }
      : { enabled: false, reason: "Select a table row or cell first." };
  }

  if (command === "delete-row") {
    return row
      ? { enabled: true, reason: "" }
      : { enabled: false, reason: "Select a table row or cell first." };
  }

  if (!context.canEditColumns || !cell || !isTableCellForModel(cell.tagName, context.model)) {
    return { enabled: false, reason: "Select a table cell first." };
  }

  if (command === "insert-column-before" || command === "insert-column-after") {
    if (context.model !== "cals") return { enabled: true, reason: "" };
    const grid = resolveCalsGrid(table);
    if (!grid.valid) return { enabled: false, reason: "Fix invalid table spans before inserting columns." };
    const selectedCell = getCalsGridCellForEntry(grid, cell);
    if (!selectedCell) return { enabled: false, reason: "Could not resolve selected cell." };
    const insertAfterCol = command === "insert-column-before" ? selectedCell.startCol - 1 : selectedCell.endCol;
    const crossingSpan = grid.rows.some((rowGrid) => rowGrid.slots.some((slot) => (
      slot && slot.startCol <= insertAfterCol && slot.endCol > insertAfterCol
    )));
    return crossingSpan
      ? { enabled: false, reason: "A column span crosses this insertion point." }
      : { enabled: true, reason: "" };
  }

  if (command === "delete-column") {
    if (context.model === "cals" && calsTableHasSpans(table)) {
      return { enabled: false, reason: "Clear table spans before deleting a CALS column." };
    }
    const rows = getTableRows(table, context.model);
    const maxColumns = Math.max(0, ...rows.map((currentRow) => getRowCells(currentRow, context.model).length));
    return maxColumns > 1
      ? { enabled: true, reason: "" }
      : { enabled: false, reason: "A table must keep at least one column." };
  }

  if (command === "merge-right") {
    if (context.model !== "cals") return { enabled: false, reason: "Merge right is available for CALS tables." };
    const grid = resolveCalsGrid(table);
    if (!grid.valid) return { enabled: false, reason: "Fix invalid table spans before merging." };
    const selectedCell = getCalsGridCellForEntry(grid, cell);
    if (!selectedCell) return { enabled: false, reason: "Could not resolve selected cell." };
    const rightCell = grid.rows[selectedCell.rowIndex]?.cells.find((candidate) => candidate.startCol === selectedCell.endCol + 1);
    if (!rightCell) return { enabled: false, reason: "No cell exists to the right." };
    const selectedMoreRows = Number(selectedCell.entry.getAttribute("morerows") || 0);
    const rightMoreRows = Number(rightCell.entry.getAttribute("morerows") || 0);
    return selectedMoreRows === rightMoreRows
      ? { enabled: true, reason: "" }
      : { enabled: false, reason: "Both cells must have the same morerows value." };
  }

  if (command === "merge-left") {
    if (context.model !== "cals") return { enabled: false, reason: "Merge left is available for CALS tables." };
    const grid = resolveCalsGrid(table);
    if (!grid.valid) return { enabled: false, reason: "Fix invalid table spans before merging." };
    const selectedCell = getCalsGridCellForEntry(grid, cell);
    if (!selectedCell) return { enabled: false, reason: "Could not resolve selected cell." };
    const leftCell = grid.rows[selectedCell.rowIndex]?.cells.find((candidate) => candidate.endCol + 1 === selectedCell.startCol);
    if (!leftCell) return { enabled: false, reason: "No cell exists to the left." };
    const selectedMoreRows = Number(selectedCell.entry.getAttribute("morerows") || 0);
    const leftMoreRows = Number(leftCell.entry.getAttribute("morerows") || 0);
    return selectedMoreRows === leftMoreRows
      ? { enabled: true, reason: "" }
      : { enabled: false, reason: "Both cells must have the same morerows value." };
  }

  if (command === "split-cells") {
    if (context.model !== "cals") return { enabled: false, reason: "Split cells is available for CALS tables." };
    const grid = resolveCalsGrid(table);
    if (!grid.valid) return { enabled: false, reason: "Fix invalid table spans before splitting cells." };
    const selectedCell = getCalsGridCellForEntry(grid, cell);
    if (!selectedCell) return { enabled: false, reason: "Could not resolve selected cell." };
    return selectedCell.rowSpan > 1 || selectedCell.endCol > selectedCell.startCol
      ? { enabled: true, reason: "" }
      : { enabled: false, reason: "Select a spanned cell first." };
  }

  return { enabled: false, reason: "Unsupported table command." };
}

function getTableContextMenuOptions(doc: Document | null, selectedPath: number[]) {
  const context = findNearestTableContext(doc, selectedPath);
  if (!context) return [];

  const commands: Array<{ id: TableCommand; label: string; icon: string }> = [
    { id: "insert-row-after", label: "Insert Row After", icon: "table-row-after" },
    { id: "insert-row-before", label: "Insert Row Before", icon: "table-row-before" },
    { id: "insert-column-after", label: "Insert Column After", icon: "table-column-after" },
    { id: "insert-column-before", label: "Insert Column Before", icon: "table-column-before" },
    { id: "delete-column", label: "Delete Column", icon: "table-delete-column" },
    { id: "delete-row", label: "Delete Row", icon: "table-delete-row" },
    { id: "merge-right", label: "Merge Right", icon: "table-merge-right" },
    { id: "merge-left", label: "Merge Left", icon: "table-merge-left" },
    { id: "split-cells", label: "Split Cells", icon: "table-split-cells" },
  ];

  return commands.map((command) => {
    const validation = getTableCommandValidation(doc, selectedPath, command.id);
    return {
      ...command,
      disabled: !validation.enabled,
      title: validation.reason,
    };
  });
}

function getContextualAttributeValues(doc: Document | null, selectedPath: number[], attributeName: string): string[] | null {
  if (!["colname", "namest", "nameend"].includes(attributeName)) return null;

  const context = findNearestTableContext(doc, selectedPath);
  if (context?.model !== "cals") return null;

  const table = getNodeByPath(doc, context.tablePath);
  if (!table) return null;

  return getCalsColumnNames(table).filter(Boolean);
}

function getImagePlacementForParent(parent: Element | null): string {
  return parent && isInlineContainerElement(parent.tagName) ? "inline" : "break";
}

function getInsertContext(doc, selectedPath, authoringSelection = null) {
  const {
    selectedNode,
    childOptions,
    siblingOptions,
    surroundOptions,
    ribbonOptions,
  } = getAuthoringInsertActions(doc, selectedPath, authoringSelection);

  if (!selectedNode) {
    return {
      label: "No selection",
      options: [],
      childOptions: [],
      siblingOptions: [],
      surroundOptions: [],
      ribbonOptions: [],
      placement: "none",
      selectedNode: null,
    };
  }

  if (childOptions.length > 0) {
    return {
      label: `Children allowed in <${selectedNode.tagName}>`,
      options: childOptions,
      childOptions,
      siblingOptions,
      surroundOptions,
      ribbonOptions,
      placement: "child",
      selectedNode,
    };
  }

  if (selectedPath.length > 0) {
    return {
      label: `Allowed after <${selectedNode.tagName}>`,
      options: siblingOptions,
      childOptions,
      siblingOptions,
      surroundOptions,
      ribbonOptions,
      placement: "after",
      selectedNode,
    };
  }

  return {
    label: `<${selectedNode.tagName}> has no child elements`,
    options: [],
    childOptions,
    siblingOptions,
    surroundOptions,
    ribbonOptions,
    placement: "none",
    selectedNode,
  };
}

function getElementPathLabel(doc: Document | null, path: number[] = []): string {
  if (!doc?.documentElement) return "";

  const names = [doc.documentElement.tagName];
  let current: Element | null = doc.documentElement;

  for (const index of path) {
    const child = current ? elementChildren(current)[index] : null;
    if (!child) break;
    names.push(child.tagName);
    current = child;
  }

  return `/${names.join("/")}`;
}

function getElementBreadcrumbItems(doc: Document | null, path: number[] = []) {
  if (!doc?.documentElement) return [];

  const items = [{ tagName: doc.documentElement.tagName, path: [] as number[] }];
  let current: Element | null = doc.documentElement;
  const currentPath: number[] = [];

  for (const index of path) {
    const child = current ? elementChildren(current)[index] : null;
    if (!child) break;

    currentPath.push(index);
    items.push({ tagName: child.tagName, path: [...currentPath] });
    current = child;
  }

  return items;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function getElementAttributes(node: Element | null): Array<{ name: string; value: string }> {
  if (!node) return [];
  return Array.from(node.attributes || []).map((attribute) => ({
    name: attribute.name,
    value: attribute.value,
  }));
}

function collectElementInventory(root: Element | null): Array<{ name: string; count: number }> {
  if (!root) return [];
  const counts = new Map<string, number>();

  function walk(node: Element) {
    counts.set(node.tagName, (counts.get(node.tagName) || 0) + 1);
    elementChildren(node).forEach(walk);
  }

  walk(root);
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function collectParagraphSummaries(doc: Document | null): Array<{ path: string; words: number; preview: string }> {
  if (!doc?.documentElement) return [];
  const summaries: Array<{ path: string; words: number; preview: string }> = [];

  function walk(node: Element, path: number[]) {
    if (["p", "li", "shortdesc", "cmd"].includes(node.tagName)) {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      summaries.push({
        path: getElementPathLabel(doc, path),
        words: countWords(text),
        preview: text.split(/\s+/).slice(0, 20).join(" "),
      });
    }

    elementChildren(node).forEach((child, index) => walk(child, [...path, index]));
  }

  walk(doc.documentElement, []);
  return summaries;
}

function getFirstChildText(parent: Element | null, tagName: string): string {
  if (!parent) return "";
  const child = elementChildren(parent).find((element) => element.tagName === tagName);
  return (child?.textContent || "").replace(/\s+/g, " ").trim();
}

function getDirectTitleText(node: Element | null): string {
  return getFirstChildText(node, "title");
}

function collectSectionSummaries(doc: Document | null): Array<{ path: string; title: string; words: number }> {
  if (!doc?.documentElement) return [];
  const sections: Array<{ path: string; title: string; words: number }> = [];

  function walk(node: Element, path: number[]) {
    if (node.tagName === "section") {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      sections.push({
        path: getElementPathLabel(doc, path),
        title: getDirectTitleText(node),
        words: countWords(text),
      });
    }

    elementChildren(node).forEach((child, index) => walk(child, [...path, index]));
  }

  walk(doc.documentElement, []);
  return sections.slice(0, 8);
}

function collectTaskStepSummaries(doc: Document | null): Array<{ path: string; command: string; words: number }> {
  if (!doc?.documentElement) return [];
  const steps: Array<{ path: string; command: string; words: number }> = [];

  function walk(node: Element, path: number[]) {
    if (node.tagName === "step") {
      const command = getFirstChildText(node, "cmd");
      steps.push({
        path: getElementPathLabel(doc, path),
        command: command.slice(0, 180),
        words: countWords(command),
      });
    }

    elementChildren(node).forEach((child, index) => walk(child, [...path, index]));
  }

  walk(doc.documentElement, []);
  return steps.slice(0, 10);
}

function collectReferenceBlockSummaries(doc: Document | null): Array<{ path: string; tagName: string; preview: string }> {
  if (!doc?.documentElement) return [];
  const blocks: Array<{ path: string; tagName: string; preview: string }> = [];
  const referenceTags = new Set(["section", "table", "simpletable", "properties", "codeblock", "dl"]);

  function walk(node: Element, path: number[]) {
    if (referenceTags.has(node.tagName)) {
      blocks.push({
        path: getElementPathLabel(doc, path),
        tagName: node.tagName,
        preview: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180),
      });
    }

    elementChildren(node).forEach((child, index) => walk(child, [...path, index]));
  }

  walk(doc.documentElement, []);
  return blocks.slice(0, 10);
}

function collectTopicrefSummaries(doc: Document | null): Array<{ path: string; href: string; navtitle: string; depth: number }> {
  if (!doc?.documentElement) return [];
  const topicrefs: Array<{ path: string; href: string; navtitle: string; depth: number }> = [];

  function walk(node: Element, path: number[]) {
    if (node.tagName === "topicref") {
      topicrefs.push({
        path: getElementPathLabel(doc, path),
        href: node.getAttribute("href") || "",
        navtitle: node.getAttribute("navtitle") || "",
        depth: path.length,
      });
    }

    elementChildren(node).forEach((child, index) => walk(child, [...path, index]));
  }

  walk(doc.documentElement, []);
  return topicrefs.slice(0, 30);
}

function buildLeanDitaContext({
  activeFileName,
  aiContext,
  doc,
}: {
  activeFileName: string;
  aiContext: AiContext;
  doc: Document | null;
}): LeanDitaContext {
  const root = doc?.documentElement || null;
  const topicType = root?.tagName || aiContext.topicType || "topic";
  const base = {
    activeFileName,
    topicType,
    title: getDirectTitleText(root),
    existingShortdesc: getFirstChildText(root, "shortdesc"),
    inventory: aiContext.inventory.slice(0, 20),
    validation: aiContext.validation,
  };

  if (topicType === "map") {
    return {
      ...base,
      summaryKind: "map",
      paragraphs: [],
      topicrefs: collectTopicrefSummaries(doc),
    };
  }

  if (topicType === "task") {
    return {
      ...base,
      summaryKind: "task",
      paragraphs: aiContext.paragraphs.slice(0, 4),
      steps: collectTaskStepSummaries(doc),
    };
  }

  if (topicType === "reference") {
    return {
      ...base,
      summaryKind: "reference",
      paragraphs: aiContext.paragraphs.slice(0, 4),
      referenceBlocks: collectReferenceBlockSummaries(doc),
    };
  }

  if (topicType === "concept") {
    return {
      ...base,
      summaryKind: "concept",
      paragraphs: aiContext.paragraphs.slice(0, 5),
      sections: collectSectionSummaries(doc),
    };
  }

  return {
    ...base,
    summaryKind: "topic",
    paragraphs: aiContext.paragraphs.slice(0, 5),
    sections: collectSectionSummaries(doc),
  };
}

function findFirstChildPathByTag(parent: Element | null, parentPath: number[], tagName: string): number[] | null {
  if (!parent) return null;
  const index = elementChildren(parent).findIndex((child) => child.tagName === tagName);
  return index >= 0 ? [...parentPath, index] : null;
}

function buildAiContext({
  activeFile,
  activeFilePath,
  activeGitBranchName,
  doc,
  errorCount,
  insertContext,
  issues,
  mode,
  repositoryLabel,
  selectedNode,
  selectedPath,
}: {
  activeFile: any;
  activeFilePath: string;
  activeGitBranchName: string;
  doc: Document | null;
  errorCount: number;
  insertContext: ReturnType<typeof getInsertContext>;
  issues: Array<{ level?: string; message?: string }>;
  mode: string;
  repositoryLabel: string;
  selectedNode: Element | null;
  selectedPath: number[];
}): AiContext {
  const root = doc?.documentElement || null;
  const warningCount = issues.filter((issue) => issue.level === "warning").length;
  const selectedText = (selectedNode?.textContent || "").replace(/\s+/g, " ").trim();

  return {
    activeFileName: activeFile?.name || "No file",
    activeFilePath: activeFilePath || "",
    branchName: activeGitBranchName || "",
    repositoryName: repositoryLabel,
    mode,
    topicType: root?.tagName || "",
    selectedElementName: selectedNode?.tagName || null,
    selectedElementPath: selectedNode ? getElementPathLabel(doc, selectedPath) : "",
    selectedElementText: selectedText.slice(0, 400),
    allowedChildren: insertContext.childOptions || [],
    allowedSiblings: insertContext.siblingOptions || [],
    attributes: getElementAttributes(selectedNode),
    validation: {
      status: errorCount > 0 ? "invalid" : issues.length ? "valid" : "idle",
      errorCount,
      warningCount,
      messages: issues.slice(0, 5).map((issue) => issue.message || "Validation issue"),
    },
    inventory: collectElementInventory(root),
    paragraphs: collectParagraphSummaries(doc),
  };
}

function generateAmbientAiSuggestions(context: AiContext, doc: Document | null): AiSuggestion[] {
  if (!doc?.documentElement || !context.topicType) return [];

  const suggestions: AiSuggestion[] = [];
  const root = doc.documentElement;
  const rootPath: number[] = [];
  const rootChildren = elementChildren(root);
  const titlePath = findFirstChildPathByTag(root, rootPath, "title");
  const hasShortdesc = rootChildren.some((child) => child.tagName === "shortdesc");
  const reviewIssues = validateDita(doc);
  const reviewParagraphs = collectParagraphSummaries(doc);

  if (["topic", "concept", "task", "reference"].includes(root.tagName) && !hasShortdesc && titlePath) {
    suggestions.push({
      id: "missing-shortdesc",
      severity: "warning",
      title: "Missing shortdesc",
      body: `Add a short description near the top of this ${root.tagName}.`,
      targetPath: getElementPathLabel(doc, rootPath),
      operation: {
        type: "insert_element",
        placement: "after",
        targetPath: titlePath,
        tagName: "shortdesc",
        text: "Add a concise summary of this topic.",
      },
    });
  }

  const notesMissingType: Array<{ path: number[]; node: Element }> = [];
  function walk(node: Element, path: number[]) {
    if (node.tagName === "note" && !node.getAttribute("type")) {
      notesMissingType.push({ path, node });
    }
    elementChildren(node).forEach((child, index) => walk(child, [...path, index]));
  }
  walk(root, []);

  notesMissingType.slice(0, 2).forEach(({ path }) => {
    suggestions.push({
      id: `note-type-${pathKeyFor(path)}`,
      severity: "info",
      title: "Note type missing",
      body: "Set a note type so publishing and styling can communicate the right intent.",
      targetPath: getElementPathLabel(doc, path),
      operation: {
        type: "set_attribute",
        targetPath: path,
        name: "type",
        value: "note",
      },
    });
  });

  reviewParagraphs
    .filter((paragraph) => paragraph.words > 100)
    .slice(0, 3)
    .forEach((paragraph, index) => {
      suggestions.push({
        id: `long-paragraph-${index}`,
        severity: "warning",
        title: "Long paragraph",
        body: `${paragraph.path} has ${paragraph.words} words. Consider splitting it into smaller DITA blocks.`,
        targetPath: paragraph.path,
      });
    });

  if (root.tagName === "concept" && context.inventory.some((item) => ["steps", "step", "cmd"].includes(item.name))) {
    suggestions.push({
      id: "concept-contains-task-structure",
      severity: "warning",
      title: "Concept contains task structure",
      body: "This concept includes task-like elements. Consider changing the topic type to task or moving the procedure.",
      targetPath: getElementPathLabel(doc, rootPath),
    });
  }

  reviewIssues.slice(0, 5).forEach((issue, index) => {
    suggestions.push({
      id: `validation-${index}`,
      severity: issue.level === "error" ? "error" : "warning",
      title: "Validation signal",
      body: issue.message || "Validation issue",
    });
  });

  return suggestions.slice(0, 8);
}

function validateDita(doc) {
  const issues = [];
  const root = doc.documentElement;

  const schema = getSchemaChildrenMap();
  const allowedAttributes = getAllowedAttributeNames();

  if (!root || !Object.prototype.hasOwnProperty.call(schema, root.tagName)) {
    return [{ level: "error", message: "Root element must be a supported DITA element." }];
  }

  if (root.tagName !== "map" && !root.getAttribute("id")) {
    issues.push({ level: "warning", message: `<${root.tagName}> should include an id attribute.` });
  }

  function walk(node: Element, path = "topic") {
    const definition = getElementDefinition(node.tagName);
    const children = elementChildren(node);
    const childTagNames = children.map((child) => child.tagName);

    for (const attr of Array.from(node.attributes || [])) {
      if (!allowedAttributes.has(attr.name)) {
        issues.push({
          level: "warning",
          message: `${path} uses non-profile attribute "${attr.name}".`,
        });
      }
    }

    for (const requiredChild of definition?.requiredChildren || []) {
      if (!childTagNames.includes(requiredChild)) {
        issues.push({
          level: "error",
          message: `<${node.tagName}> must include <${requiredChild}>.`,
          tags: [node.tagName, requiredChild],
        });
      }
    }

    for (const uniqueChild of definition?.uniqueChildren || []) {
      const count = childTagNames.filter((tagName) => tagName === uniqueChild).length;
      if (count > 1) {
        issues.push({
          level: "error",
          message: `<${node.tagName}> can contain only one <${uniqueChild}>.`,
          tags: [node.tagName, uniqueChild],
        });
      }
    }

    if (definition?.orderedChildren) {
      const order = definition.childOrder?.length ? definition.childOrder : definition.children;
      let highestOrderSeen = -1;

      for (const child of children) {
        const childOrder = order.indexOf(child.tagName);
        if (childOrder === -1) continue;

        if (childOrder < highestOrderSeen) {
          issues.push({
            level: "error",
            message: `<${child.tagName}> appears out of order inside <${node.tagName}>.`,
            tags: [node.tagName, child.tagName],
          });
          break;
        }

        highestOrderSeen = Math.max(highestOrderSeen, childOrder);
      }
    }

    for (const child of children) {
      const allowed = schema[node.tagName] || [];
      const childPath = `${path} > ${child.tagName}`;

      if (!Object.prototype.hasOwnProperty.call(schema, child.tagName)) {
        issues.push({ level: "error", message: `${childPath} is not in this DITA profile.`, tags: [child.tagName] });
      }

      if (!allowed.includes(child.tagName)) {
        issues.push({
          level: "error",
          message: `<${child.tagName}> is not allowed inside <${node.tagName}>.`,
          tags: [node.tagName, child.tagName],
        });
      }

      walk(child, childPath);
    }
  }

  walk(root);
  return issues;
}

function formatXml(xml) {
  const { doc, error } = parseXml(xml);
  if (error) return xml;

  function normalizeInlineText(text = "", position: "middle" | "start" | "end" | "only" = "middle") {
    let normalized = text.replace(/[\t\r\n ]+/g, " ");

    if (position === "start" || position === "only") {
      normalized = normalized.trimStart();
    }

    if (position === "end" || position === "only") {
      normalized = normalized.trimEnd();
    }

    return normalized.trim() ? escapeXml(normalized) : "";
  }

  function serializeInline(node: Node, index = 0, siblings: ChildNode[] = []): string {
    if (node.nodeType === Node.TEXT_NODE) {
      const position =
        siblings.length <= 1 ? "only"
        : index === 0 ? "start"
        : index === siblings.length - 1 ? "end"
        : "middle";

      return normalizeInlineText(node.textContent || "", position);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node as Element;
    const attrs = Array.from(element.attributes)
      .map((attr) => ` ${attr.name}="${escapeXml(attr.value)}"`)
      .join("");
    const children = Array.from(element.childNodes).filter((child) => {
      return child.nodeType === Node.ELEMENT_NODE || child.textContent;
    });

    if (children.length === 0) {
      return `<${element.tagName}${attrs}/>`;
    }

    return `<${element.tagName}${attrs}>${children.map((child, index) => serializeInline(child, index, children)).join("")}</${element.tagName}>`;
  }

  function serialize(node: Node, depth = 0): string {
    const pad = "  ".repeat(depth);

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      return text ? escapeXml(text) : "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node as Element;
    const attrs = Array.from(element.attributes)
      .map((attr) => ` ${attr.name}="${escapeXml(attr.value)}"`)
      .join("");
    const children = Array.from(element.childNodes).filter((child) => {
      return child.nodeType === Node.ELEMENT_NODE || child.textContent.trim();
    });

    if (children.length === 0) {
      return `${pad}<${element.tagName}${attrs}/>`;
    }

    const onlyText = children.length === 1 && children[0].nodeType === Node.TEXT_NODE;
    if (onlyText) {
      return `${pad}<${element.tagName}${attrs}>${escapeXml(children[0].textContent.trim())}</${element.tagName}>`;
    }

    const elementChildNodes = children.filter((child) => child.nodeType === Node.ELEMENT_NODE) as Element[];
    const hasTextContent = children.some((child) => child.nodeType === Node.TEXT_NODE && child.textContent);
    const isMixedInlineContent =
      hasTextContent &&
      isInlineContainerElement(element.tagName) &&
      elementChildNodes.every((child) => isInlineInsertionElement(child.tagName));

    if (isMixedInlineContent) {
      return `${pad}<${element.tagName}${attrs}>${children.map((child, index) => serializeInline(child, index, children)).join("")}</${element.tagName}>`;
    }

    const inner = children.map((child) => serialize(child, depth + 1)).filter(Boolean).join("\n");
    return `${pad}<${element.tagName}${attrs}>\n${inner}\n${pad}</${element.tagName}>`;
  }

  const doctype = getDitaDoctypeForRoot(doc.documentElement?.tagName);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    doctype,
    serialize(doc.documentElement),
  ].filter(Boolean).join("\n");
}

function getDitaDoctypeForRoot(rootName = "") {
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

function ensureDitaDoctype(xml = "") {
  if (!xml.trim() || /<!DOCTYPE\s+/i.test(xml)) return xml;

  const { doc, error } = parseXml(xml);
  if (error || !doc?.documentElement) return xml;

  const doctype = getDitaDoctypeForRoot(doc.documentElement.tagName);
  if (!doctype) return xml;

  return xml.replace(/(<\?xml[^>]*\?>\s*)?/i, (declaration) => (
    `${declaration || '<?xml version="1.0" encoding="UTF-8"?>\n'}${doctype}\n`
  ));
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createElementFor(doc, tagName, options: { imagePlacement?: string; referenceRow?: Element | null } = {}) {
  const tableRow = createTableRowElement(doc, tagName, options.referenceRow || null);
  if (tableRow) return tableRow;

  const element = doc.createElement(tagName);
  const definition = getElementDefinition(tagName);
  const template = definition?.template;
  const classChain = getSpecializationClassChain(tagName);

  if (classChain) {
    element.setAttribute("class", classChain);
  }

  if (template === "section") {
    element.setAttribute("id", `section-${Date.now().toString(36)}`);
    const title = doc.createElement("title");
    const paragraph = doc.createElement("p");
    element.append(title, paragraph);
  } else if (template === "fig") {
    element.setAttribute("id", `figure-${Date.now().toString(36)}`);
    const title = doc.createElement("title");
    const image = doc.createElement("image");
    element.append(title, image);
  } else if (template === "image") {
    element.removeAttribute("href");
    if (options.imagePlacement) {
      element.setAttribute("placement", options.imagePlacement);
    }
  } else if (template === "topicref") {
    element.removeAttribute("href");
  } else if (template === "list") {
    const item = doc.createElement("li");
    item.textContent = "";
    element.append(item);
  } else if (template === "xref") {
    element.textContent = "";
  } else if (template === "emptyText" || isKnownInlineElement(tagName)) {
    element.textContent = "";
  } else if (template === "codeblock") {
    element.textContent = "";
  } else if (template === "note") {
    element.setAttribute("type", "note");
    element.textContent = "";
  } else if (template === "title") {
    element.textContent = "";
  } else if (tagName === "table") {
    const tgroup = doc.createElement("tgroup");
    const tbody = doc.createElement("tbody");
    tgroup.setAttribute("cols", "2");
    tgroup.append(createCalsColspec(doc, 0), createCalsColspec(doc, 1));
    tbody.append(createCalsRowWithColumnCount(doc, 2));
    tgroup.append(tbody);
    element.append(tgroup);
  } else if (tagName === "thead" || tagName === "tbody") {
    element.append(createCalsRowWithColumnCount(doc, 2));
  } else if (tagName === "simpletable") {
    const row = doc.createElement("strow");
    row.append(doc.createElement("stentry"), doc.createElement("stentry"));
    element.append(row);
  } else if (definition?.requiredChildren?.length) {
    getRequiredTemplateChildren(definition).forEach((childName) => {
      element.append(createElementFor(doc, childName, {
        imagePlacement: childName === "image" ? getImagePlacementForParent(element) : undefined,
      }));
    });
  } else {
    element.textContent = "";
  }

  return element;
}

function getEditorPlaceholderForNode(node: Element): string {
  return node.tagName;
}

function getUserInitials(value?: string | null): string {
  const parts = String(value || "")
    .split(/[\s@._-]+/)
    .filter(Boolean);
  const initials = `${parts[0]?.[0] || "U"}${parts[1]?.[0] || ""}`;
  return initials.toUpperCase();
}

function getFirstEditablePath(element: Element | null, basePath: number[]): number[] {
  if (!element) return basePath;

  const tagName = element.tagName;
  const editableTags = new Set([
    "title",
    "shortdesc",
    "p",
    "li",
    "note",
    "codeblock",
    "xref",
    "ph",
    "b",
    "i",
    "u",
    "cmd",
    "entry",
    "stentry",
    "choption",
    "chdesc",
    "proptype",
    "propvalue",
    "propdesc",
  ]);

  if (editableTags.has(tagName) && elementChildren(element).length === 0) {
    return basePath;
  }

  const children = elementChildren(element);
  for (let index = 0; index < children.length; index += 1) {
    const focusPath = getFirstEditablePath(children[index], [...basePath, index]);
    if (focusPath.join(".") !== basePath.join(".") || editableTags.has(children[index].tagName)) {
      return focusPath;
    }
  }

  return basePath;
}

function parsePathValue(value) {
  if (!value) return [];
  return value.split(".").filter(Boolean).map(Number);
}

function resizeCodeblockTextarea(textarea: HTMLTextAreaElement) {
  const maxHeight = 360;
  textarea.style.height = "auto";
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function sanitizePastedText(text: string, preserveLineBreaks = false): string {
  const normalized = text.replace(/\r\n?/g, "\n");

  if (preserveLineBreaks) {
    return normalized.replace(/\u00a0/g, " ");
  }

  return normalized
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]*\n+[ \t]*/g, " ")
    .replace(/[ \t]{2,}/g, " ");
}

function insertTextAtSelection(target: HTMLElement, text: string) {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    target.textContent = `${target.textContent || ""}${text}`;
    return;
  }

  const range = selection.getRangeAt(0);
  if (!target.contains(range.commonAncestorContainer)) {
    target.textContent = `${target.textContent || ""}${text}`;
    return;
  }

  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertTextIntoTextarea(textarea: HTMLTextAreaElement, text: string) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
  const nextPosition = start + text.length;
  textarea.setSelectionRange(nextPosition, nextPosition);
  resizeCodeblockTextarea(textarea);
}

function getRangeTextOffsetWithin(container: HTMLElement, range: Range, boundary: "start" | "end" = "start") {
  const offsetRange = document.createRange();
  const boundaryContainer = boundary === "start" ? range.startContainer : range.endContainer;
  const boundaryOffset = boundary === "start" ? range.startOffset : range.endOffset;

  try {
    offsetRange.selectNodeContents(container);
    offsetRange.setEnd(boundaryContainer, boundaryOffset);
    return offsetRange.toString().length;
  } catch {
    return boundaryOffset;
  }
}

function setCaretByTextOffset(target: HTMLElement, offset: number) {
  const safeOffset = Math.max(0, offset);
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let remaining = safeOffset;
  let textNode = walker.nextNode();

  while (textNode) {
    const textLength = textNode.textContent?.length || 0;
    if (remaining <= textLength) {
      const range = document.createRange();
      range.setStart(textNode, remaining);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }

    remaining -= textLength;
    textNode = walker.nextNode();
  }

  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function createRangeForTextOffsets(container: HTMLElement, startOffset: number, endOffset: number) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  let runningOffset = 0;
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  let startNodeOffset = 0;
  let endNodeOffset = 0;

  while (textNode) {
    const textLength = textNode.textContent?.length || 0;
    const nodeStart = runningOffset;
    const nodeEnd = runningOffset + textLength;

    if (!startNode && startOffset >= nodeStart && startOffset <= nodeEnd) {
      startNode = textNode;
      startNodeOffset = startOffset - nodeStart;
    }

    if (!endNode && endOffset >= nodeStart && endOffset <= nodeEnd) {
      endNode = textNode;
      endNodeOffset = endOffset - nodeStart;
      break;
    }

    runningOffset = nodeEnd;
    textNode = walker.nextNode();
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startNodeOffset);
  range.setEnd(endNode, endNodeOffset);
  return range;
}

function spellingMarksAreEqual(
  current: Array<{ id: string; left: number; top: number; width: number }>,
  nextMarks: Array<{ id: string; left: number; top: number; width: number }>,
) {
  return current.length === nextMarks.length &&
    current.every((mark, index) => {
      const next = nextMarks[index];
      return next &&
        mark.id === next.id &&
        Math.abs(mark.left - next.left) < 0.5 &&
        Math.abs(mark.top - next.top) < 0.5 &&
        Math.abs(mark.width - next.width) < 0.5;
    });
}

function selectWordAtPoint(target: HTMLElement, clientX: number, clientY: number) {
  const rangeFromPoint =
    (document as any).caretRangeFromPoint?.(clientX, clientY) ||
    (() => {
      const position = (document as any).caretPositionFromPoint?.(clientX, clientY);
      if (!position) return null;
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    })();

  if (!rangeFromPoint || !target.contains(rangeFromPoint.startContainer)) return null;

  let textNode = rangeFromPoint.startContainer;
  let offset = rangeFromPoint.startOffset;

  if (textNode.nodeType !== Node.TEXT_NODE) {
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    textNode = walker.nextNode();
    offset = 0;
  }

  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;

  const text = textNode.textContent || "";
  if (!text.trim()) return null;

  const isWordCharacter = (char: string) => /[\p{L}\p{N}_'-]/u.test(char);
  let start = Math.max(0, Math.min(offset, text.length));
  let end = start;

  if (start === text.length || !isWordCharacter(text[start])) {
    if (start > 0 && isWordCharacter(text[start - 1])) {
      start -= 1;
      end = start + 1;
    } else {
      while (end < text.length && !isWordCharacter(text[end])) end += 1;
      start = end;
    }
  }

  while (start > 0 && isWordCharacter(text[start - 1])) start -= 1;
  while (end < text.length && isWordCharacter(text[end])) end += 1;
  if (start === end) return null;

  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  return getAuthoringSelection();
}

function getTextOffsetAtPoint(clientX: number, clientY: number) {
  const rangeFromPoint =
    (document as any).caretRangeFromPoint?.(clientX, clientY) ||
    (() => {
      const position = (document as any).caretPositionFromPoint?.(clientX, clientY);
      if (!position) return null;
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    })();

  if (!rangeFromPoint) return null;

  const rawElement =
    rangeFromPoint.startContainer.nodeType === Node.ELEMENT_NODE
      ? rangeFromPoint.startContainer as Element
      : rangeFromPoint.startContainer.parentElement;
  const textRun = rawElement?.closest?.("[data-node-path]") as HTMLElement | null;

  if (!textRun?.dataset.nodePath) return null;

  return {
    path: parsePathValue(textRun.dataset.nodePath),
    pathKey: textRun.dataset.nodePath,
    childNodeIndex: Number(textRun.dataset.textNodeIndex || 0),
    offset: getRangeTextOffsetWithin(textRun, rangeFromPoint),
  };
}

function toCssLength(value: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}px`;
  return trimmed;
}

function getCaretInsertionPoint() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const rawNode = range.startContainer;
  const element =
    rawNode.nodeType === Node.ELEMENT_NODE
      ? rawNode as Element
      : rawNode.parentElement;
  const textRun = element?.closest?.("[data-text-node-index]") as HTMLElement | null;

  if (textRun) {
    return {
      path: parsePathValue(textRun.dataset.nodePath),
      childNodeIndex: Number(textRun.dataset.textNodeIndex),
      offset: getRangeTextOffsetWithin(textRun, range),
    };
  }

  const editableNode = element?.closest?.("[data-node-path]") as HTMLElement | null;
  if (!editableNode) return null;

  return {
    path: parsePathValue(editableNode.dataset.nodePath),
    childNodeIndex: 0,
    offset: getRangeTextOffsetWithin(editableNode, range),
  };
}

function getAuthoringSelection() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const startElement =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
  const endElement =
    range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer as Element
      : range.endContainer.parentElement;
  const startRun = startElement?.closest?.("[data-text-node-index]") as HTMLElement | null;
  const endRun = endElement?.closest?.("[data-text-node-index]") as HTMLElement | null;

  if (
    !range.collapsed &&
    startRun &&
    endRun &&
    startRun.dataset.nodePath === endRun.dataset.nodePath &&
    startRun.dataset.textNodeIndex === endRun.dataset.textNodeIndex
  ) {
    return {
      kind: "range",
      path: parsePathValue(startRun.dataset.nodePath),
      childNodeIndex: Number(startRun.dataset.textNodeIndex),
      startOffset: Math.min(
        getRangeTextOffsetWithin(startRun, range, "start"),
        getRangeTextOffsetWithin(endRun, range, "end"),
      ),
      endOffset: Math.max(
        getRangeTextOffsetWithin(startRun, range, "start"),
        getRangeTextOffsetWithin(endRun, range, "end"),
      ),
    };
  }

  const startEditable = startElement?.closest?.("[data-node-path]") as HTMLElement | null;
  const endEditable = endElement?.closest?.("[data-node-path]") as HTMLElement | null;

  if (
    !range.collapsed &&
    startEditable &&
    endEditable &&
    startEditable.dataset.nodePath === endEditable.dataset.nodePath
  ) {
    return {
      kind: "range",
      path: parsePathValue(startEditable.dataset.nodePath),
      childNodeIndex: 0,
      startOffset: Math.min(
        getRangeTextOffsetWithin(startEditable, range, "start"),
        getRangeTextOffsetWithin(endEditable, range, "end"),
      ),
      endOffset: Math.max(
        getRangeTextOffsetWithin(startEditable, range, "start"),
        getRangeTextOffsetWithin(endEditable, range, "end"),
      ),
    };
  }

  const caret = getCaretInsertionPoint();
  return caret ? { kind: "caret", ...caret } : null;
}

function pathsEqual(first, second) {
  if (!first || !second || first.length !== second.length) return false;
  return first.every((part, index) => part === second[index]);
}

function pathStartsWith(path, prefix) {
  if (!Array.isArray(path) || !Array.isArray(prefix) || prefix.length > path.length) return false;
  return prefix.every((part, index) => part === path[index]);
}

function renderTextWithVisualHighlights(
  text,
  pinnedSelection,
  path,
  childNodeIndex = 0,
  searchQuery = "",
  spellingIssues: SpellingIssue[] = [],
) {
  const ranges: Array<{ start: number; end: number; className: string; spellingIssue?: SpellingIssue }> = [];
  const normalizedQuery = normalizeSearchText(searchQuery);

  if (normalizedQuery) {
    const lowerText = text.toLowerCase();
    let matchIndex = lowerText.indexOf(normalizedQuery);

    while (matchIndex !== -1) {
      ranges.push({
        start: matchIndex,
        end: matchIndex + normalizedQuery.length,
        className: "visual-search-highlight",
      });
      matchIndex = lowerText.indexOf(normalizedQuery, matchIndex + normalizedQuery.length);
    }
  }

  if (
    pinnedSelection &&
    pinnedSelection.kind === "range" &&
    pathsEqual(pinnedSelection.path, path) &&
    pinnedSelection.childNodeIndex === childNodeIndex &&
    pinnedSelection.startOffset !== pinnedSelection.endOffset
  ) {
    const startOffset = Math.max(0, Math.min(text.length, pinnedSelection.startOffset));
    const endOffset = Math.max(startOffset, Math.min(text.length, pinnedSelection.endOffset));

    if (startOffset !== endOffset) {
      ranges.push({
        start: startOffset,
        end: endOffset,
        className: "dita-selection-pin",
      });
    }
  }

  if (!ranges.length) return text;

  const boundaries = [...new Set([0, text.length, ...ranges.flatMap((range) => [range.start, range.end])])]
    .filter((offset) => offset >= 0 && offset <= text.length)
    .sort((first, second) => first - second);

  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const segment = text.slice(start, end);
    const className = [...new Set(
      ranges
        .filter((range) => range.start < end && range.end > start)
        .map((range) => range.className),
    )].join(" ");

    return className ? (
      <span
        className={className}
        key={`${start}-${end}-${className}`}
      >
        {segment}
      </span>
    ) : segment;
  });
}

function isAuthoringSelection(selection) {
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  const startElement =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
  const endElement =
    range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer as Element
      : range.endContainer.parentElement;

  return Boolean(
    startElement?.closest?.("[data-node-path]") &&
      endElement?.closest?.("[data-node-path]"),
  );
}

function insertInlineElementAtCaret(doc, tagName, caret) {
  const parent = getNodeByPath(doc, caret.path);
  const textNode = parent?.childNodes[caret.childNodeIndex];

  if (!parent || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  const newElement = createElementFor(doc, tagName, {
    imagePlacement: tagName === "image" ? "inline" : undefined,
  });
  const text = textNode.textContent || "";
  const safeOffset = Math.max(0, Math.min(caret.offset, text.length));
  const before = doc.createTextNode(text.slice(0, safeOffset));
  const after = doc.createTextNode(text.slice(safeOffset));

  parent.insertBefore(before, textNode);
  parent.insertBefore(newElement, textNode);
  parent.insertBefore(after, textNode);
  parent.removeChild(textNode);

  return [...caret.path, elementChildren(parent).indexOf(newElement)];
}

function wrapTextRangeWithInlineElement(doc, tagName, textRange) {
  const parent = getNodeByPath(doc, textRange.path);
  const textNode = parent?.childNodes[textRange.childNodeIndex];

  if (!parent || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  const text = textNode.textContent || "";
  const safeStart = Math.max(0, Math.min(textRange.startOffset, text.length));
  const safeEnd = Math.max(safeStart, Math.min(textRange.endOffset, text.length));
  const selectedText = text.slice(safeStart, safeEnd);

  if (!selectedText) return null;

  const before = doc.createTextNode(text.slice(0, safeStart));
  const wrapped = createElementFor(doc, tagName);
  wrapped.textContent = selectedText;
  const after = doc.createTextNode(text.slice(safeEnd));

  parent.insertBefore(before, textNode);
  parent.insertBefore(wrapped, textNode);
  parent.insertBefore(after, textNode);
  parent.removeChild(textNode);

  return {
    insertedPath: [...textRange.path, elementChildren(parent).indexOf(wrapped)],
    nextCaret: {
      kind: "caret",
      path: textRange.path,
      childNodeIndex: Array.from(parent.childNodes).indexOf(after),
      offset: 0,
    },
  };
}

function unwrapElementAtPath(doc: Document, path: number[]) {
  const node = getNodeByPath(doc, path);
  const parent = node?.parentNode;
  if (!node || node.nodeType !== Node.ELEMENT_NODE || !parent) return false;
  const focusNode = node.firstChild;

  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node);
  }
  parent.removeChild(node);

  return {
    focusChildNodeIndex: focusNode ? Array.from(parent.childNodes).indexOf(focusNode) : 0,
  };
}

function isCaretAtEndOfElement(node: Element, nodePath: number[], caret): boolean {
  if (!node || caret?.kind !== "caret") return false;

  if (!pathsEqual(caret.path, nodePath)) {
    return false;
  }

  return caret.offset >= stripEditableCaretSeed(node.textContent || "").length;
}

function hasMeaningfulContentAfterNode(node: Element): boolean {
  let sibling = node.nextSibling;

  while (sibling) {
    if (sibling.nodeType === Node.ELEMENT_NODE) return true;
    if (sibling.nodeType === Node.TEXT_NODE && stripEditableCaretSeed(sibling.textContent || "").trim()) {
      return true;
    }

    sibling = sibling.nextSibling;
  }

  return false;
}

function getTextRangeValue(doc: Document | null, textRange): string {
  if (!doc || textRange?.kind !== "range") return "";

  const parent = getNodeByPath(doc, textRange.path);
  const textNode = parent?.childNodes[textRange.childNodeIndex];
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return "";

  const text = textNode.textContent || "";
  const safeStart = Math.max(0, Math.min(textRange.startOffset, text.length));
  const safeEnd = Math.max(safeStart, Math.min(textRange.endOffset, text.length));
  return text.slice(safeStart, safeEnd);
}

function replaceTextRangeValue(doc: Document, textRange, replacement: string): boolean {
  if (textRange?.kind !== "range") return false;

  const parent = getNodeByPath(doc, textRange.path);
  const textNode = parent?.childNodes[textRange.childNodeIndex];
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;

  const text = textNode.textContent || "";
  const safeStart = Math.max(0, Math.min(textRange.startOffset, text.length));
  const safeEnd = Math.max(safeStart, Math.min(textRange.endOffset, text.length));
  textNode.textContent = `${text.slice(0, safeStart)}${replacement}${text.slice(safeEnd)}`;
  return true;
}

function getSchemaChildOrder(parent: Element): string[] {
  const definition = getElementDefinition(parent.tagName);
  return definition?.childOrder?.length ? definition.childOrder : definition?.children || [];
}

function insertSchemaOrderedChild(parent: Element, child: Element, minimumIndex = 0) {
  const childOrder = getSchemaChildOrder(parent);
  const candidateOrder = childOrder.indexOf(child.tagName);
  const children = elementChildren(parent);
  const safeMinimumIndex = Math.max(0, Math.min(minimumIndex, children.length));

  if (candidateOrder === -1) {
    parent.insertBefore(child, minimumIndex > 0 ? children[safeMinimumIndex] || null : null);
    return elementChildren(parent).indexOf(child);
  }

  const reference = children.slice(safeMinimumIndex).find((existingChild) => {
    const existingOrder = childOrder.indexOf(existingChild.tagName);
    return existingOrder !== -1 && existingOrder > candidateOrder;
  }) || null;

  parent.insertBefore(child, reference);
  return elementChildren(parent).indexOf(child);
}

function appendSchemaChild(parent, child) {
  if (parent.tagName === "topic" && child.tagName === "shortdesc") {
    const body = elementChildren(parent).find((element) => element.tagName === "body");
    if (body) {
      parent.insertBefore(child, body);
      return elementChildren(parent).indexOf(child);
    }
  }

  if (parent.tagName === "tgroup" && child.tagName === "colspec") {
    const insertAfterCol = getCalsColumnNames(parent).length - 1;
    const result = insertCalsColumnAfterIndex(parent.ownerDocument, parent, insertAfterCol);
    return result?.newColspec ? elementChildren(parent).indexOf(result.newColspec) : null;
  }

  if (parent.tagName === "tgroup" && child.tagName === "thead") {
    const existingThead = elementChildren(parent).find((element) => element.tagName === "thead");
    if (existingThead) return elementChildren(parent).indexOf(existingThead);
    insertCalsTheadIntoTgroup(parent, child);
    return elementChildren(parent).indexOf(child);
  }

  return insertSchemaOrderedChild(parent, child);
}

function insertSchemaSiblingAfter(doc, selectedPath, tagName) {
  if (selectedPath.length === 0) return null;

  const parentPath = selectedPath.slice(0, -1);
  const parent = getNodeByPath(doc, parentPath);
  const reference = getNodeByPath(doc, selectedPath);

  if (!parent || !reference) return null;
  const tableColumnPath = insertTableColumnAfterCell(doc, selectedPath, tagName);
  if (tableColumnPath !== undefined) return tableColumnPath;

  if (!getAllowedChildOptions(parent).includes(tagName)) return null;

  if (parent.tagName === "tgroup" && tagName === "colspec") {
    const colspecs = getCalsColspecs(parent);
    const referenceIndex = reference.tagName === "colspec" ? colspecs.indexOf(reference) : colspecs.length - 1;
    const insertAfterCol = referenceIndex >= 0 ? referenceIndex : getCalsColumnNames(parent).length - 1;
    const result = insertCalsColumnAfterIndex(doc, parent, insertAfterCol);
    return result?.newColspec ? [...parentPath, elementChildren(parent).indexOf(result.newColspec)] : null;
  }

  if (parent.tagName === "tgroup" && tagName === "thead") {
    const existingThead = elementChildren(parent).find((element) => element.tagName === "thead");
    if (existingThead) return [...parentPath, elementChildren(parent).indexOf(existingThead)];
    const newElement = createElementFor(doc, tagName);
    insertCalsTheadIntoTgroup(parent, newElement);
    return [...parentPath, elementChildren(parent).indexOf(newElement)];
  }

  const referenceRow = getTableModelForRow(tagName) && getTableModelForRow(reference.tagName) === getTableModelForRow(tagName)
    ? reference
    : null;
  const newElement = createElementFor(doc, tagName, {
    imagePlacement: tagName === "image" ? getImagePlacementForParent(parent) : undefined,
    referenceRow,
  });
  insertSchemaOrderedChild(parent, newElement, elementChildren(parent).indexOf(reference) + 1);

  return [...parentPath, elementChildren(parent).indexOf(newElement)];
}

function splitEditableElementAtCaret(doc, elementPath, tagName, currentText = "", textNodeIndex = null, caret = null) {
  if (elementPath.length === 0) return null;

  const element = getNodeByPath(doc, elementPath);
  const parentPath = elementPath.slice(0, -1);
  const parent = getNodeByPath(doc, parentPath);

  if (!element || !parent || element.tagName !== tagName) return null;
  if (!getAllowedChildOptions(parent).includes(tagName)) return null;

  const nextElement = doc.createElement(tagName);
  const splitNodeIndex = Number.isInteger(textNodeIndex)
    ? textNodeIndex
    : Number.isInteger(caret?.childNodeIndex)
      ? caret.childNodeIndex
      : 0;
  const offsetSource = Number.isFinite(caret?.offset) ? caret.offset : currentText.length;

  if (elementChildren(element).length === 0) {
    const text = currentText ?? element.textContent ?? "";
    const safeOffset = Math.max(0, Math.min(offsetSource, text.length));
    element.textContent = text.slice(0, safeOffset);
    nextElement.textContent = text.slice(safeOffset);
  } else {
    const childNodes = Array.from(element.childNodes) as ChildNode[];
    const splitNode = childNodes[splitNodeIndex];

    if (splitNode?.nodeType === Node.TEXT_NODE) {
      const text = currentText ?? splitNode.textContent ?? "";
      const safeOffset = Math.max(0, Math.min(offsetSource, text.length));
      splitNode.textContent = text.slice(0, safeOffset);

      const afterText = text.slice(safeOffset);
      if (afterText) {
        nextElement.append(doc.createTextNode(afterText));
      }

      let sibling = splitNode.nextSibling;
      while (sibling) {
        const nextSibling = sibling.nextSibling;
        nextElement.append(sibling);
        sibling = nextSibling;
      }
    } else {
      for (let index = splitNodeIndex; index < childNodes.length; index += 1) {
        nextElement.append(childNodes[index]);
      }
    }
  }

  parent.insertBefore(nextElement, element.nextSibling);

  return [...parentPath, elementChildren(parent).indexOf(nextElement)];
}

function getDefaultSiblingTagAfterList(doc, listPath) {
  const options = getAllowedSiblingOptions(doc, listPath);
  const preferred = ["p", "section", "note", "codeblock", "fig", "image"];

  return preferred.find((tagName) => options.includes(tagName)) || options[0] || null;
}

function exitListFromEmptyItem(doc, listItemPath) {
  const listPath = listItemPath.slice(0, -1);
  const listItem = getNodeByPath(doc, listItemPath);
  const list = getNodeByPath(doc, listPath);
  const tagName = getDefaultSiblingTagAfterList(doc, listPath);

  if (!listItem || !list || !["ul", "ol"].includes(list.tagName) || !tagName) return null;
  if (listItem.textContent?.trim() || elementChildren(listItem).length > 0) return null;

  listItem.remove();

  const insertedPath = insertSchemaSiblingAfter(doc, listPath, tagName);

  if (elementChildren(list).length === 0) {
    list.remove();
  }

  return insertedPath;
}

function splitListItemAtCaret(doc, listItemPath, currentText = "", textNodeIndex = null, caret = null) {
  const listItem = getNodeByPath(doc, listItemPath);
  const liveText = currentText ?? listItem?.textContent ?? "";

  if (liveText.trim() === "" && elementChildren(listItem).length === 0) {
    return exitListFromEmptyItem(doc, listItemPath);
  }

  return splitEditableElementAtCaret(doc, listItemPath, "li", currentText, textNodeIndex, caret);
}

function getElementByRelativePath(root: Element, relativePath: number[]): Element | null {
  let current: Element | null = root;

  for (const index of relativePath) {
    current = current ? elementChildren(current)[index] || null : null;
    if (!current) return null;
  }

  return current;
}

function findClosestListItemSpecializationPath(doc: Document, path: number[]) {
  for (let depth = path.length; depth >= 0; depth -= 1) {
    const ancestorPath = path.slice(0, depth);
    const node = getNodeByPath(doc, ancestorPath);
    if (nodeSpecializesFrom(node, "li")) {
      return ancestorPath;
    }
  }

  return null;
}

function splitListItemSpecializationAtCaret(doc, editPath, currentText = "", textNodeIndex = null, caret = null) {
  const listItemPath = findClosestListItemSpecializationPath(doc, editPath);
  if (!listItemPath) return null;

  const listItem = getNodeByPath(doc, listItemPath);
  if (!listItem) return null;

  if (listItem.tagName === "li" && editPath.join(".") === listItemPath.join(".")) {
    return splitListItemAtCaret(doc, listItemPath, currentText, textNodeIndex, caret);
  }

  const parentPath = listItemPath.slice(0, -1);
  const parent = getNodeByPath(doc, parentPath);
  if (!parent || !getAllowedChildOptions(parent).includes(listItem.tagName)) return null;

  const nextListItem = createElementFor(doc, listItem.tagName);
  const editRelativePath = editPath.slice(listItemPath.length);
  const originalEditable = getNodeByPath(doc, editPath);
  const nextEditable = editRelativePath.length
    ? getElementByRelativePath(nextListItem, editRelativePath)
    : nextListItem;
  const offsetSource = Number.isFinite(caret?.offset) ? caret.offset : currentText.length;

  if (originalEditable && nextEditable && elementChildren(originalEditable).length === 0) {
    const text = currentText ?? originalEditable.textContent ?? "";
    const safeOffset = Math.max(0, Math.min(offsetSource, text.length));
    originalEditable.textContent = text.slice(0, safeOffset);
    nextEditable.textContent = text.slice(safeOffset);
  }

  parent.insertBefore(nextListItem, listItem.nextSibling);

  return [...parentPath, elementChildren(parent).indexOf(nextListItem)];
}

function splitParagraphAtCaret(doc, paragraphPath, currentText = "", textNodeIndex = null, caret = null) {
  return splitEditableElementAtCaret(doc, paragraphPath, "p", currentText, textNodeIndex, caret);
}

function isEmptyElement(node: Element | null | undefined) {
  if (!node) return false;
  return elementChildren(node).length === 0 && !(node.textContent || "").trim();
}

function isRemovableEmptyInlineElement(node: Element | null | undefined) {
  if (!node || !isKnownInlineElement(node.tagName) || !isEmptyElement(node)) return false;
  if (["image", "xref", "topicref", "boolean"].includes(node.tagName)) return false;
  return node.attributes.length === 0;
}

function cleanupEmptyInlineElements(node: Element | null | undefined) {
  if (!node) return;

  for (const child of elementChildren(node)) {
    cleanupEmptyInlineElements(child);
    if (isRemovableEmptyInlineElement(child)) {
      child.remove();
    }
  }
}

function isRequiredListContainer(node: Element | null | undefined) {
  if (!node) return false;
  const definition = getElementDefinition(node.tagName);
  return Boolean(definition?.requiredChildren?.some((childName) => elementSpecializesFrom(childName, "li")));
}

function cleanupEmptyRequiredListContainers(doc: Document, startPath: number[]) {
  let nextPath = [...startPath];

  while (nextPath.length >= 0) {
    const node = getNodeByPath(doc, nextPath);
    if (!node || !isRequiredListContainer(node) || !isEmptyElement(node)) break;

    const parentPath = nextPath.slice(0, -1);
    node.remove();
    nextPath = parentPath;

    if (nextPath.length === 0) break;
  }

  return nextPath;
}

function removeElementWithSchemaCleanup(doc: Document, path: number[]) {
  const selectedNode = getNodeByPath(doc, path);
  if (!selectedNode || !selectedNode.parentElement) return null;

  const tableColumnPath = deleteTableColumnAtCell(doc, path);
  if (tableColumnPath !== undefined) return tableColumnPath;

  const parentPath = path.slice(0, -1);
  const parent = selectedNode.parentElement;
  const parentDefinition = getElementDefinition(parent.tagName);
  const removeOwningListItem = Boolean(
    parentDefinition?.requiredChildren?.includes(selectedNode.tagName) &&
    nodeSpecializesFrom(parent, "li")
  );
  const targetPath = removeOwningListItem ? parentPath : path;
  const targetNode = removeOwningListItem ? parent : selectedNode;
  let nextPath = targetPath.slice(0, -1);

  targetNode.remove();
  nextPath = cleanupEmptyRequiredListContainers(doc, nextPath);

  return nextPath;
}

const maxHistoryEntries = 80;

function App() {
  const {
    isLoading: authIsLoading,
    isAuthenticated,
    error: authError,
    loginWithRedirect,
    logout: auth0Logout,
    getIdTokenClaims,
    user,
  } = useAuth0();
  const [projectTree, setProjectTree] = useState(emptyProjectTree);
  const [activeFileId, setActiveFileId] = useState(null);
  const [activePaneId, setActivePaneId] = useState("pane-left");
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [tabPanes, setTabPanes] = useState([
    { id: "pane-left", label: "Left", tabs: [], activeFileId: null },
  ]);
  const [fileHistories, setFileHistories] = useState({});
  const [selectedPathsByFile, setSelectedPathsByFile] = useState({});
  const [caretContextVersion, setCaretContextVersion] = useState(0);
  const [documentHighlightPathKey, setDocumentHighlightPathKey] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState(getDefaultFileStem("topic"));
  const [newItemType, setNewItemType] = useState("topic");
  const [explorerMessage, setExplorerMessage] = useState("");
  const [mode, setMode] = useState("visual");
  const [activeLeftPanel, setActiveLeftPanel] = useState<"explorer" | "doc" | "git" | null>("explorer");
  const [lastLeftPanel, setLastLeftPanel] = useState<"explorer" | "doc" | "git">("explorer");
  const [activeSidePanel, setActiveSidePanel] = useState<SidePanelId | null>(null);
  const [lastSidePanel, setLastSidePanel] = useState<SidePanelId>("inspector");
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [voiceMessage, setVoiceMessage] = useState("Voice assistant is ready when your OpenAI API key is configured.");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Select a prompt below or ask for help with the current topic, schema, references, or wording.",
    },
  ]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatStatus, setChatStatus] = useState<"idle" | "sending">("idle");
  const [chatPanelTab, setChatPanelTab] = useState<"chat" | "topics">("chat");
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [dismissedAiSuggestionIds, setDismissedAiSuggestionIds] = useState<string[]>([]);
  const [aiReviewStatus, setAiReviewStatus] = useState<"idle" | "reviewing" | "ready" | "error">("idle");
  const [aiShortdescStatus, setAiShortdescStatus] = useState<"idle" | "generating">("idle");
  const [aiRewriteStatus, setAiRewriteStatus] = useState<"idle" | "rewriting">("idle");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"all" | "open">("all");
  const [replaceText, setReplaceText] = useState("");
  const [replaceScope, setReplaceScope] = useState<"current" | "open">("current");
  const [replaceCaseSensitive, setReplaceCaseSensitive] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationStatus, setNotificationStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [validationByFile, setValidationByFile] = useState<Record<string, ValidationState>>({});
  const [lastValidation, setLastValidation] = useState<ValidationState>({ status: "idle", message: "Not validated yet." });
  const [validationRuns, setValidationRuns] = useState<ValidationRun[]>([]);
  const [activeValidationRunId, setActiveValidationRunId] = useState<string | null>(null);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<"problems" | "output" | "terminal">("problems");
  const [bottomPanelHeight, setBottomPanelHeight] = useState(260);
  const [terminalMessages, setTerminalMessages] = useState<TerminalMessage[]>([]);
  const [paneSplitPercent, setPaneSplitPercent] = useState(50);
  const [paneSplitDirection, setPaneSplitDirection] = useState("right");
  const [editorLeftOverlap, setEditorLeftOverlap] = useState(0);
  const [editorRightOverlap, setEditorRightOverlap] = useState(0);
  const [pendingFocusPath, setPendingFocusPath] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [tabContextMenu, setTabContextMenu] = useState(null);
  const [projectContextMenu, setProjectContextMenu] = useState(null);
  const [projectPropertiesNodeId, setProjectPropertiesNodeId] = useState<string | null>(null);
  const [gitCommitContextMenu, setGitCommitContextMenu] = useState(null);
  const [editingProjectNodeId, setEditingProjectNodeId] = useState<string | null>(null);
  const [fileTypePicker, setFileTypePicker] = useState(null);
  const [activeAppMenuId, setActiveAppMenuId] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [appAccount, setAppAccount] = useState<AppAccount | null>(null);
  const [appAccountStatus, setAppAccountStatus] = useState<"idle" | "syncing" | "ready" | "error">("idle");
  const [appAccountError, setAppAccountError] = useState("");
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [githubStatusState, setGithubStatusState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [githubMessage, setGithubMessage] = useState("");
  const [githubRepositories, setGithubRepositories] = useState<GitHubRepository[]>([]);
  const [githubRepositoriesState, setGithubRepositoriesState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [githubTreeState, setGithubTreeState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [gitBranches, setGitBranches] = useState<GitBranch[]>([]);
  const [gitBranchState, setGitBranchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [gitCommits, setGitCommits] = useState<GitCommitSummary[]>([]);
  const [gitCommitsState, setGitCommitsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [gitLocalCommits, setGitLocalCommits] = useState<GitLocalCommit[]>([]);
  const [gitLocalCommitState, setGitLocalCommitState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [gitMessage, setGitMessage] = useState("");
  const [gitNewBranchName, setGitNewBranchName] = useState("");
  const [gitBaseBranch, setGitBaseBranch] = useState("");
  const [gitCheckoutBranch, setGitCheckoutBranch] = useState("");
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [isCommittingGitChanges, setIsCommittingGitChanges] = useState(false);
  const [isPublishingGitChanges, setIsPublishingGitChanges] = useState(false);
  const [isSwitchingGitBranch, setIsSwitchingGitBranch] = useState(false);
  const [selectedGitCommitFileIds, setSelectedGitCommitFileIds] = useState<Set<string>>(() => new Set());
  const previousGitChangeFileIdsRef = useRef<Set<string>>(new Set());
  const [loadedRepositoryName, setLoadedRepositoryName] = useState("");
  const [workspaceSource, setWorkspaceSource] = useState<"loading" | "empty" | "github">("loading");
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>({
    status: "idle",
    message: "No draft changes saved yet.",
  });
  const [schemaProfileVersion, setSchemaProfileVersion] = useState(0);
  const [authoringProfiles, setAuthoringProfiles] = useState<Record<string, { enabled: boolean; visibleElements: string[] }>>(() => {
    try {
      return JSON.parse(localStorage.getItem("xml-editor-authoring-profiles") || "{}");
    } catch {
      return {};
    }
  });
  const [specializations, setSpecializations] = useState<any[]>([]);
  const [selectedSpecializationId, setSelectedSpecializationId] = useState<string | null>(null);
  const [specializationStatus, setSpecializationStatus] = useState<"idle" | "loading" | "ready" | "saving" | "error">("idle");
  const [specializationMessage, setSpecializationMessage] = useState("");
  const [specializationPreview, setSpecializationPreview] = useState<any | null>(null);
  const [specializationForm, setSpecializationForm] = useState({
    kind: "element",
    name: "",
    baseName: "section",
    moduleName: "",
    addedAttributes: [] as string[],
    allowedDocumentTypes: [] as string[],
    authoringProfile: {
      enabled: false,
      visibleElements: [] as string[],
    },
    description: "",
  });
  const [visualTemplateModel, setVisualTemplateModel] = useState<any>(defaultVisualTemplateModel);
  const [visualTemplatePickerMode, setVisualTemplatePickerMode] = useState<"create" | "open" | null>(null);
  const [visualTemplateCreationTarget, setVisualTemplateCreationTarget] = useState<null | {
    folderId: string;
    fileName: string;
    filePath: string;
  }>(null);
  const [visualTemplateSaveAsOpen, setVisualTemplateSaveAsOpen] = useState(false);
  const [visualTemplateUploadOpen, setVisualTemplateUploadOpen] = useState(false);
  const [visualTemplateImportOpen, setVisualTemplateImportOpen] = useState(false);
  const [visualTemplateSourceId, setVisualTemplateSourceId] = useState<string | null>(null);
  const [visualTemplateDropRegionId, setVisualTemplateDropRegionId] = useState<string | null>(null);
  const [visualTemplateSelectedRegionId, setVisualTemplateSelectedRegionId] = useState<string | null>("hero");
  const [visualTemplateEditingRegionId, setVisualTemplateEditingRegionId] = useState<string | null>(null);
  const [visualTemplateEditingLabel, setVisualTemplateEditingLabel] = useState("");
  const [visualTemplateMoveModifierActive, setVisualTemplateMoveModifierActive] = useState(false);
  const [visualTemplateLayerDragId, setVisualTemplateLayerDragId] = useState<string | null>(null);
  const [visualTemplateDeleteDropActive, setVisualTemplateDeleteDropActive] = useState(false);
  const [visualTemplateLayerSearch, setVisualTemplateLayerSearch] = useState("");
  const [visualTemplateExpandedLayerIds, setVisualTemplateExpandedLayerIds] = useState<Set<string>>(() => new Set(["hero", "body", "sidebar"]));
  const visualTemplatePreviewRef = useRef<HTMLDivElement | null>(null);
  const [visualTemplateSmartGuides, setVisualTemplateSmartGuides] = useState<Array<{ axis: "x" | "y"; value: number; from: number; to: number; label?: string }>>([]);
  const [visualTemplateMeasureMode, setVisualTemplateMeasureMode] = useState(false);
  const [visualTemplateMeasurement, setVisualTemplateMeasurement] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    measuring: boolean;
  } | null>(null);
  const [visualTemplateLayoutDrag, setVisualTemplateLayoutDrag] = useState<{
    id: string;
    kind?: string;
    mode: "move" | "resize";
    handle?: VisualTemplateResizeHandle;
    startX: number;
    startY: number;
    layout: Record<string, number>;
  } | null>(null);
  const visualTemplateModelRef = useRef<any>(defaultVisualTemplateModel);
  const visualTemplateUndoStackRef = useRef<any[]>([]);
  const visualTemplateRedoStackRef = useRef<any[]>([]);
  const visualTemplateDragHistorySnapshotRef = useRef<any | null>(null);
  const [visualTemplateHistoryVersion, setVisualTemplateHistoryVersion] = useState(0);
  const [tabDropTarget, setTabDropTarget] = useState(null);
  const [projectDropTarget, setProjectDropTarget] = useState(null);
  const [pinnedAuthoringSelection, setPinnedAuthoringSelection] = useState(null);
  const [inlineExitCaret, setInlineExitCaret] = useState<{
    parentPath: number[];
    afterElementIndex: number;
    tagName: string;
  } | null>(null);
  const [spellingIssues, setSpellingIssues] = useState<SpellingIssue[]>([]);
  const [spellingMarks, setSpellingMarks] = useState<Array<{
    id: string;
    left: number;
    top: number;
    width: number;
  }>>([]);

  useEffect(() => {
    visualTemplateModelRef.current = visualTemplateModel;
  }, [visualTemplateModel]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Control") setVisualTemplateMoveModifierActive(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") setVisualTemplateMoveModifierActive(false);
    };
    const handleBlur = () => setVisualTemplateMoveModifierActive(false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    if (!visualTemplateLayoutDrag) return;

    const handlePointerMove = (event: PointerEvent) => {
      const gridSettings = normalizeVisualTemplateGridSettings(visualTemplateModel.gridSettings);
      const dx = (event.clientX - visualTemplateLayoutDrag.startX) / gridSettings.zoom;
      const dy = (event.clientY - visualTemplateLayoutDrag.startY) / gridSettings.zoom;
      const startLayout = normalizeVisualTemplateLayout(visualTemplateLayoutDrag.layout);
      const rawUpdates = visualTemplateLayoutDrag.mode === "resize"
        ? getVisualTemplateResizeLayout(startLayout, dx, dy, visualTemplateLayoutDrag.handle || "se", visualTemplateLayoutDrag.kind)
        : {
            x: Math.max(0, Math.min(visualTemplatePageSize.width - startLayout.width, startLayout.x + dx)),
            y: Math.max(0, Math.min(visualTemplatePageSize.height - startLayout.height, startLayout.y + dy)),
          };
      const snapped = resolveVisualTemplateSnappedLayout(
        visualTemplateLayoutDrag.id,
        { ...startLayout, ...rawUpdates },
        visualTemplateLayoutDrag.mode,
        gridSettings,
        visualTemplateLayoutDrag.handle,
      );
      setVisualTemplateSmartGuides(snapped.guides);
      updateVisualTemplateRegionLayout(visualTemplateLayoutDrag.id, snapped.layout, { recordHistory: false });
    };

    const handlePointerUp = () => {
      commitVisualTemplateDragHistory();
      setVisualTemplateLayoutDrag(null);
      setVisualTemplateSmartGuides([]);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [visualTemplateLayoutDrag, visualTemplateModel.gridSettings, visualTemplateModel.regions]);
  const fileInputRef = useRef(null);
  const caretRef = useRef(null);
  const contextSelectionRangeRef = useRef<Range | null>(null);
  const pendingFocusPlacementRef = useRef<"start" | "end">("end");
  const sourceHighlightRef = useRef(null);
  const sourceEditBaseRef = useRef(null);
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null);
  const realtimeStreamRef = useRef<MediaStream | null>(null);
  const realtimeChannelRef = useRef<RTCDataChannel | null>(null);
  const realtimeAudioRef = useRef<HTMLAudioElement | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualTextCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spellingCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spellingRequestIdRef = useRef(0);
  const ignoredSpellingIssueIdsRef = useRef<Set<string>>(new Set());
  const pendingCaretFocusRef = useRef<{
    path: number[];
    childNodeIndex: number;
    offset: number;
  } | null>(null);
  const lastSavedDraftRef = useRef("");
  const authoringProfileSaveTimerRef = useRef<number | null>(null);
  const authoringProfilesLoadedRef = useRef(false);
  const lastSavedAuthoringProfilesRef = useRef("");
  const schemaProfileCacheRef = useRef<Record<string, DitaSchemaProfile>>({});
  const schemaProfileLoadingRef = useRef<Set<string>>(new Set());
  const defaultExplorerSelectionRef = useRef(false);
  const pendingVisualEditRef = useRef<{
    fileId: string | null;
    path: number[];
    textNodeIndex: number | null;
    value: string;
    offset?: number;
  } | null>(null);
  const activeFile = findProjectNode(projectTree, activeFileId)?.node;
  const activeFileKind = getProjectFileKind(activeFile);
  const activeIsVisualTemplate = activeFileId === visualTemplatesTabId || activeFileKind === "visual-template";
  const activeIsVisualTemplateBinding = activeIsVisualTemplate && (
    activeFile?.ditaType === "visual-template-binding" ||
    visualTemplateModel.artifactType === "binding"
  );
  const activeIsTextEditable = isTextEditableFile(activeFile);
  const activeIsXml = activeFileKind === "xml";
  const activeFilePath = getProjectFilePath(projectTree, activeFileId);
  const history = fileHistories[activeFileId] || {
    past: [],
    present: activeFile?.content || "",
    future: [],
  };
  const selectedPath = selectedPathsByFile[activeFileId] || [];
  const xml = history.present;
  const activeSpellingIssues = spellingIssues.filter((issue) => issue.fileId === activeFileId);
  const activeSpellingIssuesKey = activeSpellingIssues
    .map((issue) => `${issue.id}:${issue.startOffset}:${issue.endOffset}`)
    .join("|");
  const activeValidation = validationByFile[activeFileId] || { status: "idle", message: "Not validated yet." };
  const toolbarValidation = activeValidation.status === "idle" ? lastValidation : activeValidation;
  const activeValidationRun = validationRuns.find((run) => run.id === activeValidationRunId) || validationRuns[0] || null;
  const unreadNotificationCount = notifications.length;
  const toastNotifications = notifications.filter((notification) => !notification.toastDismissed).slice(0, 10);
  const activeValidationProblems = activeValidationRun?.issues.map((issue, index) => ({
    ...issue,
    id: `${activeValidationRun.id}-${index}`,
    runId: activeValidationRun.id,
    fileId: activeValidationRun.fileId,
    fileName: activeValidationRun.fileName,
    fallbackFilePath: activeValidationRun.filePath,
  })) || [];
  const validationProblems = activeValidationProblems;

  const parsed = useMemo(() => (activeIsXml ? parseXml(xml) : { doc: null, error: null }), [activeIsXml, xml]);
  const activeDitaRootName = parsed.doc?.documentElement?.tagName || "";
  const issues = useMemo(() => (parsed.doc ? validateDita(parsed.doc) : []), [parsed.doc, schemaProfileVersion]);
  const brokenSchemaTagNames = useMemo(() => getBrokenSchemaTagNames(issues), [issues]);
  const selectedNode = parsed.doc ? getNodeByPath(parsed.doc, selectedPath) : null;
  const hrefValidationMap = useMemo(
    () => (parsed.doc ? collectHrefValidationStates(parsed.doc, activeFilePath, projectTree) : {}),
    [parsed.doc, activeFilePath, projectTree],
  );
  const hrefValidationIssues = useMemo(
    () => Object.values(hrefValidationMap).filter((validation) => validation.status === "invalid"),
    [hrefValidationMap],
  );
  const selectedProject = findProjectNode(projectTree, selectedProjectId);
  const selectedProjectNode = selectedProject?.node;
  const selectedContainerId = selectedProjectNode?.type === "folder"
    ? selectedProjectNode.id
    : selectedProject?.parent?.id || "root";
  const selectedContainer = findProjectNode(projectTree, selectedContainerId)?.node;
  const activeAuthoringSelection = pinnedAuthoringSelection || caretRef.current;
  const insertContext = parsed.doc
    ? getInsertContext(parsed.doc, selectedPath, activeAuthoringSelection)
    : getInsertContext(null, selectedPath, activeAuthoringSelection);
  const activeTableContext = useMemo(() => (
    parsed.doc ? findNearestTableContext(parsed.doc, selectedPath) : null
  ), [parsed.doc, schemaProfileVersion, selectedPath]);
  const ribbonAllowedTags = useMemo(() => (
    new Set<string>(insertContext.ribbonOptions || [])
  ), [insertContext.ribbonOptions, schemaProfileVersion]);
  const activeRibbonTags = useMemo(() => {
    const tags = new Set<string>();
    if (!parsed.doc) return tags;

    const selectionPath = caretRef.current?.path || selectedPath;
    const path = Array.isArray(selectionPath) && selectionPath.length ? selectionPath : selectedPath;

    for (let depth = path.length; depth >= 0; depth -= 1) {
      const ancestorPath = path.slice(0, depth);
      const node = getNodeByPath(parsed.doc, ancestorPath);
      if (node?.nodeType === Node.ELEMENT_NODE && isKnownInlineElement(node.tagName)) {
        tags.add(node.tagName);
      }
    }

    return tags;
  }, [activeFileId, caretContextVersion, parsed.doc, schemaProfileVersion, selectedPath]);
  const errorCount = activeIsXml ? issues.filter((issue) => issue.level === "error").length + hrefValidationIssues.length : 0;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  const openTabs = tabPanes.flatMap((pane) => pane.tabs.map((fileId) => ({ fileId, paneId: pane.id })));
  const activeGitBranchName = gitBranches.find((branch) => branch.active)?.name ||
    githubStatus?.selectedRepository?.selected_branch ||
    githubStatus?.selectedRepository?.default_branch ||
    "";
  const pendingLocalCommitHashByPath = new Map(
    gitLocalCommits.flatMap((commit) => commit.files.map((file) => [
      normalizeProjectPath(file.filePath),
      file.draftContentHash || "",
    ] as const)),
  );
  const draftBackedFiles = collectProjectFiles(projectTree).filter(({ node }) => (
    node.type === "file" &&
    Boolean(node.githubPath) &&
    (node.deletedAt || node.draftDirty || (node.githubPath && !node.githubSha)) &&
    !(node.deletedAt && !node.githubSha) &&
    (
      !pendingLocalCommitHashByPath.has(normalizeProjectPath(node.githubPath)) ||
      pendingLocalCommitHashByPath.get(normalizeProjectPath(node.githubPath)) !== (node.draftContentHash || "")
    )
  ));
  const draftBackedFileIdsKey = draftBackedFiles.map(({ node }) => node.id).join("|");
  const selectedGitCommitCount = draftBackedFiles.filter(({ node }) => selectedGitCommitFileIds.has(node.id)).length;
  const pendingPublishFileCount = new Set(gitLocalCommits.flatMap((commit) => commit.files.map((file) => file.filePath))).size;
  const pendingPublishCommitCount = gitLocalCommits.length;
  const currentAiModelLabel = "GPT-4o · DITA Agent";
  const repositoryLabel = loadedRepositoryName || githubStatus?.selectedRepository?.full_name || "No repository";
  const signedInLabel = appAccount?.user.email || user?.email || user?.name || "Signed in";
  const signedInInitials = getUserInitials(user?.name || appAccount?.user.email || user?.email);
  const primaryMembership = appAccount?.memberships[0] || null;
  const accountContextLabel = primaryMembership
    ? `${primaryMembership.organization_name} · ${primaryMembership.role_name || "Member"}`
    : "Workspace account";

  useEffect(() => {
    if (!activeIsXml || !activeDitaRootName) return;
    const schemaRootName = getBaseSchemaRootForDocumentType(activeDitaRootName);
    if (!schemaRootName) return;

    const cachedProfile = schemaProfileCacheRef.current[schemaRootName];
    if (cachedProfile) {
      if (activeDitaSchemaProfile !== cachedProfile) {
        setActiveDitaSchemaProfile(cachedProfile, activeSpecializationDefinitions, activeDitaRootName);
        setSchemaProfileVersion((version) => version + 1);
      }
      return;
    }

    if (schemaProfileLoadingRef.current.has(schemaRootName)) return;
    schemaProfileLoadingRef.current.add(schemaRootName);

    let cancelled = false;

    fetch(`${backendBaseUrl}/api/schema/dita?type=${encodeURIComponent(schemaRootName)}&refresh=1`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || `Could not load ${schemaRootName} schema.`);
        }
        return convertRngSchemaToUiProfile(body.schema, schemaRootName);
      })
      .then((profile) => {
        if (cancelled) return;
        schemaProfileCacheRef.current[schemaRootName] = profile;
        setActiveDitaSchemaProfile(profile, activeSpecializationDefinitions, activeDitaRootName);
        setSchemaProfileVersion((version) => version + 1);
        appendTerminalMessage(`Loaded ${schemaRootName} schema from DITA RNG.`, {
          source: "SCHEMA",
          level: "info",
          open: false,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        appendTerminalMessage(error instanceof Error ? error.message : `Could not load ${schemaRootName} schema.`, {
          source: "SCHEMA",
          level: "warning",
          open: false,
        });
      })
      .finally(() => {
        schemaProfileLoadingRef.current.delete(schemaRootName);
      });

    return () => {
      cancelled = true;
    };
  }, [activeDitaRootName, activeIsXml, specializations]);

  useEffect(() => {
    setActiveAuthoringProfiles(authoringProfiles);
    localStorage.setItem("xml-editor-authoring-profiles", JSON.stringify(authoringProfiles));
    setSchemaProfileVersion((version) => version + 1);

    if (authoringProfileSaveTimerRef.current) {
      window.clearTimeout(authoringProfileSaveTimerRef.current);
    }

    authoringProfileSaveTimerRef.current = window.setTimeout(() => {
      saveAuthoringProfilesToTeam(authoringProfiles);
    }, 500);

    return () => {
      if (authoringProfileSaveTimerRef.current) {
        window.clearTimeout(authoringProfileSaveTimerRef.current);
      }
    };
  }, [authoringProfiles, appAccountStatus, isAuthenticated]);

  const aiContext = useMemo(() => buildAiContext({
    activeFile,
    activeFilePath,
    activeGitBranchName,
    doc: parsed.doc,
    errorCount,
    insertContext,
    issues,
    mode,
    repositoryLabel,
    selectedNode,
    selectedPath,
  }), [
    activeFile,
    activeFilePath,
    activeGitBranchName,
    errorCount,
    insertContext,
    issues,
    mode,
    parsed.doc,
    repositoryLabel,
    selectedNode,
    selectedPath,
  ]);
  const activeAiSuggestion = useMemo(
    () => aiSuggestions.find((suggestion) => !dismissedAiSuggestionIds.includes(suggestion.id)) || null,
    [aiSuggestions, dismissedAiSuggestionIds],
  );
  const searchResults = useMemo(
    () => buildSearchResults(projectTree, fileHistories, openTabs, searchQuery, searchScope),
    [projectTree, fileHistories, openTabs, searchQuery, searchScope],
  );
  const searchFileMatches = searchResults.filter((result) => result.kind === "file");
  const searchTextMatches = searchResults.filter((result) => result.kind === "text");
  const replaceTargetFileIds = useMemo(() => (
    replaceScope === "current"
      ? [activeFileId]
      : [...new Set(openTabs.map((tab) => tab.fileId))]
  ), [activeFileId, openTabs, replaceScope]);
  const replaceMatchCount = useMemo(() => (
    replaceTargetFileIds.reduce((total, fileId) => {
      const file = findProjectNode(projectTree, fileId)?.node;
      if (!file || file.type !== "file") return total;

      const fileKind = getProjectFileKind(file);
      const content = fileHistories[fileId]?.present ?? file.content ?? "";
      return total + getReplaceMatchCount(fileKind, content, searchQuery, replaceCaseSensitive);
    }, 0)
  ), [fileHistories, projectTree, replaceCaseSensitive, replaceTargetFileIds, searchQuery]);

  function pushNotification({
    body,
    persistent = true,
    severity = "info",
    source,
    title,
  }: {
    body: string;
    persistent?: boolean;
    severity?: NotificationSeverity;
    source?: string;
    title: string;
  }) {
    const createdAt = new Date().toISOString();
    const id = `notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticNotification = {
      id,
      severity,
      title,
      body,
      persistent,
      source,
      createdAt,
    };

    setNotifications((current) => [
      optimisticNotification,
      ...current,
    ].slice(0, 10));

    saveNotification(optimisticNotification);

    if (!persistent) {
      window.setTimeout(() => dismissNotificationToast(id), 5000);
    }
  }

  function dismissNotificationToast(notificationId: string) {
    setNotifications((current) => current.map((notification) => (
      notification.id === notificationId
        ? { ...notification, toastDismissed: true }
        : notification
    )));
  }

  async function saveNotification(notification: AppNotification) {
    if (!isAuthenticated || appAccountStatus !== "ready") return;

    try {
      const response = await fetch(`${backendBaseUrl}/api/notifications`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          severity: notification.severity,
          title: notification.title,
          body: notification.body,
          source: notification.source,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not save notification.");
      }

      if (body.notification) {
        if (notification.persistent === false) {
          window.setTimeout(() => dismissNotificationToast(body.notification.id), 5000);
        }

        setNotifications((current) => [
          {
            ...body.notification,
            persistent: notification.persistent,
            toastDismissed: notification.toastDismissed,
          },
          ...current.filter((item) => item.id !== notification.id && item.id !== body.notification.id),
        ].slice(0, 10));
      }
    } catch {
      setNotificationStatus("error");
    }
  }

  async function loadNotifications() {
    if (!isAuthenticated || appAccountStatus !== "ready") return;

    setNotificationStatus("loading");
    try {
      const response = await fetch(`${backendBaseUrl}/api/notifications`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not load notifications.");
      }

      setNotifications((body.notifications || []).map((notification) => ({
        ...notification,
        toastDismissed: true,
      })));
      setNotificationStatus("ready");
    } catch {
      setNotificationStatus("error");
    }
  }

  async function clearNotifications() {
    setNotifications([]);
    if (!isAuthenticated || appAccountStatus !== "ready") return;

    try {
      await fetch(`${backendBaseUrl}/api/notifications`, {
        method: "DELETE",
        headers: await getBackendAuthHeaders(),
      });
    } catch {
      setNotificationStatus("error");
    }
  }

  async function loadAuthoringProfiles() {
    if (!isAuthenticated || appAccountStatus !== "ready") return;

    try {
      const response = await fetch(`${backendBaseUrl}/api/authoring-profiles`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not load Customize Types profiles.");
      }

      const profiles = body.profiles || {};
      const hasServerProfiles = Object.keys(profiles).length > 0;
      const hasLocalProfiles = Object.keys(authoringProfiles).length > 0;
      authoringProfilesLoadedRef.current = true;
      lastSavedAuthoringProfilesRef.current = JSON.stringify(profiles);

      if (!hasServerProfiles && hasLocalProfiles) {
        await saveAuthoringProfilesToTeam(authoringProfiles);
        return;
      }

      setAuthoringProfiles(profiles);
    } catch (error) {
      authoringProfilesLoadedRef.current = true;
      lastSavedAuthoringProfilesRef.current = JSON.stringify(authoringProfiles);
      appendTerminalMessage(error instanceof Error ? error.message : "Could not load Customize Types profiles.", {
        source: "TYPES",
        level: "warning",
        open: false,
      });
    }
  }

  async function saveAuthoringProfilesToTeam(profiles: Record<string, { enabled: boolean; visibleElements: string[] }>) {
    if (!isAuthenticated || appAccountStatus !== "ready" || !authoringProfilesLoadedRef.current) return;

    const serializedProfiles = JSON.stringify(profiles);
    if (serializedProfiles === lastSavedAuthoringProfilesRef.current) return;

    try {
      const response = await fetch(`${backendBaseUrl}/api/authoring-profiles`, {
        method: "PUT",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ profiles }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not save Customize Types profiles.");
      }

      const savedProfiles = body.profiles || profiles;
      lastSavedAuthoringProfilesRef.current = JSON.stringify(savedProfiles);
      if (JSON.stringify(savedProfiles) !== serializedProfiles) {
        setAuthoringProfiles(savedProfiles);
      }
    } catch (error) {
      appendTerminalMessage(error instanceof Error ? error.message : "Could not save Customize Types profiles.", {
        source: "TYPES",
        level: "warning",
        open: false,
      });
    }
  }

  async function loadSpecializations() {
    if (!isAuthenticated || appAccountStatus !== "ready") return;

    setSpecializationStatus("loading");
    setSpecializationMessage("");
    try {
      const response = await fetch(`${backendBaseUrl}/api/specializations`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not load specializations.");
      }

      setSpecializations(body.specializations || []);
      setActiveSpecializationDefinitions(body.specializations || [], activeDitaRootName);
      setSchemaProfileVersion((version) => version + 1);
      setSpecializationStatus("ready");
    } catch (error) {
      setSpecializationStatus("error");
      setSpecializationMessage(error instanceof Error ? error.message : "Could not load specializations.");
    }
  }

  function specializationPayload() {
    return {
      id: selectedSpecializationId || undefined,
      kind: specializationForm.kind,
      name: specializationForm.name.trim(),
      baseName: specializationForm.baseName.trim(),
      moduleName: specializationForm.moduleName.trim(),
      description: specializationForm.description.trim(),
      allowedDocumentTypes: specializationForm.kind === "element" ? specializationForm.allowedDocumentTypes : [],
      authoringProfile: specializationForm.kind === "documentType"
        ? specializationForm.authoringProfile
        : { enabled: false, visibleElements: [] },
      addedAttributes: specializationForm.addedAttributes
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name, required: false })),
    };
  }

  function getSpecializationBaseOptions(kind = specializationForm.kind, currentBase = specializationForm.baseName) {
    const profile = getActiveDitaSchemaProfile();
    const validSpecializedBases = specializations
      .filter((specialization) => (
        specialization.status === "valid" &&
        (specialization.kind || specialization.definition?.kind) === kind
      ))
      .map((specialization) => specialization.name || specialization.definition?.name)
      .filter(Boolean);
    const names = kind === "documentType"
      ? [...(profile.rootElements || [])]
      : Object.keys(profile.elements || {});

    names.push(...validSpecializedBases);

    if (currentBase && !names.includes(currentBase)) {
      names.push(currentBase);
    }

    return [...new Set(names)]
      .filter(Boolean)
      .sort((a, b) => {
        const rootA = profile.rootElements.includes(a);
        const rootB = profile.rootElements.includes(b);
        if (rootA !== rootB) return rootA ? -1 : 1;
        return a.localeCompare(b);
      });
  }

  function getDefaultSpecializationBase(kind: string) {
    return getSpecializationBaseOptions(kind, "").find(Boolean) || (kind === "documentType" ? "topic" : "section");
  }

  function slugifySpecializationName(value: string) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getSuggestedSpecializationModuleName() {
    const name = slugifySpecializationName(specializationForm.name);
    if (!name) {
      return specializationForm.kind === "documentType" ? "newtype-shell" : "authflow-purpose-domain";
    }
    return specializationForm.kind === "documentType" ? `${name}-shell` : `authflow-${name}-domain`;
  }

  function editSpecializationDraft(specialization: any) {
    const definition = specialization.definition || {};
    const addedAttributes = Array.isArray(definition.addedAttributes)
      ? definition.addedAttributes.map((attribute) => attribute?.name || "").filter(Boolean)
      : [];

    setSelectedSpecializationId(specialization.id);
    setSpecializationForm({
      kind: specialization.kind || definition.kind || "element",
      name: specialization.name || definition.name || "",
      baseName: specialization.baseName || definition.baseName || "",
      moduleName: specialization.moduleName || definition.moduleName || "",
      addedAttributes,
      allowedDocumentTypes: Array.isArray(definition.allowedDocumentTypes) ? definition.allowedDocumentTypes : [],
      authoringProfile: {
        enabled: Boolean(definition.authoringProfile?.enabled),
        visibleElements: Array.isArray(definition.authoringProfile?.visibleElements) ? definition.authoringProfile.visibleElements : [],
      },
      description: definition.description || "",
    });
    setSpecializationPreview(definition.inheritedElement
      ? {
          definition,
          inheritedElement: definition.inheritedElement,
          rngPreview: definition.rngPreview || "",
        }
      : null);
    setSpecializationMessage(`Editing draft ${specialization.name}.`);
  }

  function startNewSpecializationDraft() {
    setSelectedSpecializationId(null);
    setSpecializationPreview(null);
    setSpecializationMessage("");
    setSpecializationForm({
      kind: "element",
      name: "",
      baseName: "section",
      moduleName: "",
      addedAttributes: [],
      allowedDocumentTypes: [],
      authoringProfile: {
        enabled: false,
        visibleElements: [],
      },
      description: "",
    });
  }

  function addSpecializationAttribute() {
    setSpecializationForm((current) => ({
      ...current,
      addedAttributes: [...current.addedAttributes, ""],
    }));
  }

  function updateSpecializationAttribute(index: number, value: string) {
    setSpecializationForm((current) => ({
      ...current,
      addedAttributes: current.addedAttributes.map((attribute, attributeIndex) => (
        attributeIndex === index ? value : attribute
      )),
    }));
  }

  function removeSpecializationAttribute(index: number) {
    setSpecializationForm((current) => ({
      ...current,
      addedAttributes: current.addedAttributes.filter((_, attributeIndex) => attributeIndex !== index),
    }));
  }

  function getSpecializationDocumentTypeOptions() {
    const profile = getActiveDitaSchemaProfile();
    const validSpecializedDocumentTypes = getValidDocumentSpecializations(specializations)
      .map((specialization) => specialization.name || specialization.definition?.name)
      .filter(Boolean);

    return [...new Set([
      ...(profile.rootElements || []),
      ...validSpecializedDocumentTypes,
      ...specializationForm.allowedDocumentTypes,
    ])].sort((a, b) => a.localeCompare(b));
  }

  function toggleSpecializationScope(documentType: string) {
    setSpecializationForm((current) => {
      const selected = new Set(current.allowedDocumentTypes || []);
      if (selected.has(documentType)) {
        selected.delete(documentType);
      } else {
        selected.add(documentType);
      }
      return {
        ...current,
        allowedDocumentTypes: [...selected].sort((a, b) => a.localeCompare(b)),
      };
    });
  }

  function getAuthoringProfileDocumentType() {
    return specializationForm.kind === "documentType"
      ? specializationForm.name.trim() || specializationForm.baseName
      : activeDitaRootName || specializationForm.allowedDocumentTypes[0] || "";
  }

  function getAuthoringProfileElementOptions() {
    const documentType = getAuthoringProfileDocumentType();
    const baseType = getBaseSchemaRootForDocumentType(documentType) || specializationForm.baseName || documentType;
    const profile = applySpecializationOverlays(activeBaseDitaSchemaProfile, activeSpecializationDefinitions, documentType);
    const rootDefinition = profile.elements[documentType] || profile.elements[baseType];
    if (!rootDefinition) return [];

    const rootChildren = rootDefinition.children || [];
    const bodyChild = getPreferredBodyChild(rootDefinition, documentType, profile);
    const bodyDefinition = bodyChild ? profile.elements[bodyChild] : null;
    const scopedSpecializedElements = activeSpecializationDefinitions
      .filter((specialization) => (
        isValidSpecialization(specialization) &&
        (specialization.kind || specialization.definition?.kind) === "element" &&
        specializationAppliesToDocument(specialization, documentType)
      ))
      .map((specialization) => specialization.name || specialization.definition?.name)
      .filter((tagName) => tagName && profile.elements[tagName]);
    const rootOptionalChildren = rootChildren.filter((tagName) => (
      tagName !== "title" &&
      tagName !== bodyChild &&
      !rootDefinition.requiredChildren?.includes(tagName)
    ));
    const bodyOptionalChildren = (bodyDefinition?.children || []).filter((tagName) => (
      !bodyDefinition?.requiredChildren?.includes(tagName)
    ));

    return [...new Set([...scopedSpecializedElements, ...rootOptionalChildren, ...bodyOptionalChildren])]
      .filter((tagName) => profile.elements[tagName])
      .sort((a, b) => {
        const aSpecialized = Boolean(getSpecializationByName(a));
        const bSpecialized = Boolean(getSpecializationByName(b));
        if (aSpecialized !== bSpecialized) return aSpecialized ? -1 : 1;
        return a.localeCompare(b);
      });
  }

  function toggleAuthoringProfileElement(tagName: string) {
    setSpecializationForm((current) => {
      const visible = new Set(current.authoringProfile.visibleElements || []);
      if (visible.has(tagName)) {
        visible.delete(tagName);
      } else {
        visible.add(tagName);
      }

      return {
        ...current,
        authoringProfile: {
          ...current.authoringProfile,
          enabled: true,
          visibleElements: [...visible].sort((a, b) => a.localeCompare(b)),
        },
      };
    });
  }

  function setAuthoringProfileEnabled(enabled: boolean) {
    setSpecializationForm((current) => ({
      ...current,
      authoringProfile: {
        ...current.authoringProfile,
        enabled,
      },
    }));
  }

  function getSpecializationStatusLabel(status?: string) {
    if (status === "valid") return "Valid";
    if (status === "invalid") return "Invalid";
    return "Draft";
  }

  function getSpecializationStatusDescription(status?: string) {
    if (status === "valid") return "This specialization is active in local authoring and insert menus.";
    if (status === "invalid") return "Fix the draft and validate it again before it can be used.";
    return "Save and validate this draft before it appears in insert menus.";
  }

  async function previewCurrentSpecialization() {
    if (!isAuthenticated || appAccountStatus !== "ready") {
      setSpecializationMessage("Sign in before previewing a specialization.");
      return;
    }

    setSpecializationStatus("loading");
    setSpecializationMessage("");
    try {
      const response = await fetch(`${backendBaseUrl}/api/specializations/preview`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(specializationPayload()),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not preview specialization.");
      }

      setSpecializationPreview(body);
      setSpecializationStatus("ready");
    } catch (error) {
      setSpecializationStatus("error");
      setSpecializationMessage(error instanceof Error ? error.message : "Could not preview specialization.");
    }
  }

  async function saveCurrentSpecialization() {
    if (!isAuthenticated || appAccountStatus !== "ready") {
      setSpecializationMessage("Sign in before saving a specialization.");
      return;
    }

    setSpecializationStatus("saving");
    setSpecializationMessage("");
    try {
      const response = await fetch(`${backendBaseUrl}/api/specializations`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(specializationPayload()),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not save specialization.");
      }

      await loadSpecializations();
      setSpecializationPreview(body);
      setSelectedSpecializationId(body.specialization?.id || selectedSpecializationId);
      setSpecializationStatus("ready");
      setSpecializationMessage(`Saved ${body.specialization?.name || specializationForm.name} as a draft specialization. Validate it to activate it locally.`);
    } catch (error) {
      setSpecializationStatus("error");
      setSpecializationMessage(error instanceof Error ? error.message : "Could not save specialization.");
    }
  }

  async function validateCurrentSpecialization() {
    if (!selectedSpecializationId) {
      setSpecializationMessage("Save the specialization draft before validating it.");
      return;
    }
    if (!isAuthenticated || appAccountStatus !== "ready") {
      setSpecializationMessage("Sign in before validating a specialization.");
      return;
    }

    setSpecializationStatus("loading");
    setSpecializationMessage("");
    try {
      const response = await fetch(`${backendBaseUrl}/api/specializations/${encodeURIComponent(selectedSpecializationId)}/validate`, {
        method: "POST",
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not validate specialization.");
      }

      await loadSpecializations();
      setSpecializationPreview(body);
      setSelectedSpecializationId(body.specialization?.id || selectedSpecializationId);
      setSpecializationStatus("ready");
      setSpecializationMessage(body.ok
        ? `Validated ${body.specialization?.name || specializationForm.name}. It is active for local authoring.`
        : `Specialization ${body.specialization?.name || specializationForm.name} is invalid.`);
    } catch (error) {
      setSpecializationStatus("error");
      setSpecializationMessage(error instanceof Error ? error.message : "Could not validate specialization.");
    }
  }

  function appendTerminalMessage(
    message: string,
    options: { level?: TerminalMessage["level"]; open?: boolean; source?: string } = {},
  ) {
    const trimmed = String(message || "").trim();
    if (!trimmed) return;

    setTerminalMessages((current) => [{
      id: `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      level: options.level || "info",
      message: trimmed,
      source: options.source || "System",
    }, ...current].slice(0, 200));

    if (options.open) {
      setBottomPanelTab("terminal");
      setBottomPanelOpen(true);
    }
  }

  function setSystemMessage(message: string, options: { level?: TerminalMessage["level"]; open?: boolean; source?: string } = {}) {
    appendTerminalMessage(message, options);
  }

  function setExplorerSystemMessage(message: string, level: TerminalMessage["level"] = "info", options: { open?: boolean } = {}) {
    setExplorerMessage("");
    setSystemMessage(message, { level, source: "Explorer", open: options.open ?? level !== "info" });
  }

  function setGitSystemMessage(message: string, level: TerminalMessage["level"] = "info") {
    setGitMessage("");
    setSystemMessage(message, { level, source: "Git", open: level !== "info" });
  }

  function setGithubSystemMessage(message: string, level: TerminalMessage["level"] = "info") {
    setGithubMessage("");
    setSystemMessage(message, { level, source: "GitHub", open: level !== "info" });
  }

  const hasRightPane = tabPanes.some((pane) => pane.id === "pane-right");
  const hasBottomPane = tabPanes.some((pane) => pane.id === "pane-bottom");
  const hasSecondaryPane = tabPanes.length > 1;
  const editorPaneStyle = {
    ...(hasSecondaryPane && paneSplitDirection === "right"
      ? { gridTemplateColumns: `minmax(260px, ${paneSplitPercent}%) 10px minmax(260px, ${100 - paneSplitPercent}%)` }
      : {}),
    ...(hasSecondaryPane && paneSplitDirection === "down"
      ? { gridTemplateRows: `minmax(160px, ${paneSplitPercent}fr) 6px minmax(280px, ${100 - paneSplitPercent}fr)` }
      : {}),
    marginLeft: activeLeftPanel ? -editorLeftOverlap : 0,
    marginRight: activeSidePanel ? -editorRightOverlap : 0,
    zIndex: (activeLeftPanel && editorLeftOverlap) || editorRightOverlap ? 2 : undefined,
  };
  const workspaceStyle = {
    gridTemplateColumns: [
      "46px",
      ...(activeLeftPanel ? ["260px", "6px"] : ["0px", "0px"]),
      "minmax(520px, 1fr)",
      ...(activeSidePanel ? ["6px", "260px"] : ["0px", "0px"]),
      "46px",
    ].join(" "),
  };
  const navigatorResizerStyle = {
    transform: `translateX(${-editorLeftOverlap}px)`,
  };
  const inspectorResizerStyle = {
    transform: `translateX(${editorRightOverlap}px)`,
  };
  const renderedLeftPanel = activeLeftPanel || lastLeftPanel;
  const renderedSidePanel = activeSidePanel || lastSidePanel;
  const visualTemplateSidePanels: SidePanelId[] = activeIsVisualTemplateBinding
    ? ["templateSources", "templateBindings", "templateLayers", "templateLayout", "templateStyle", "notifications"]
    : ["templateLayers", "templateLayout", "templateStyle", "notifications"];
  const defaultSidePanels: SidePanelId[] = ["inspector", "schema", "search", "chat", "aiReview", "github", "notifications", "help"];
  const visibleSidePanels = activeIsVisualTemplate ? visualTemplateSidePanels : defaultSidePanels;

  useEffect(() => {
    if (activeSidePanel && !visibleSidePanels.includes(activeSidePanel)) {
      setActiveSidePanel(activeIsVisualTemplate ? "templateLayers" : null);
    }
  }, [activeIsVisualTemplate, activeSidePanel, visibleSidePanels]);

  function filterIgnoredSpellingIssues(issues: SpellingIssue[]) {
    return issues.filter((issue) => !ignoredSpellingIssueIdsRef.current.has(issue.id));
  }

  async function checkSpellingOnBackend(segments: SpellingTextSegment[]): Promise<SpellingIssue[]> {
    if (!segments.length) return [];

    const response = await fetch(`${backendBaseUrl}/api/spelling/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getBackendAuthHeaders()),
      },
      body: JSON.stringify({ segments }),
    });
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error || "Spelling check failed.");
    }

    return Array.isArray(body.issues) ? body.issues : [];
  }

  useEffect(() => {
    ignoredSpellingIssueIdsRef.current.clear();
  }, [spellingEngineVersion]);

  useEffect(() => {
    ignoredSpellingIssueIdsRef.current.clear();
  }, [activeFileId, xml]);

  useEffect(() => {
    setSpellingIssues([]);
    ignoredSpellingIssueIdsRef.current.clear();
    spellingRequestIdRef.current += 1;
    if (spellingCheckTimerRef.current) {
      clearTimeout(spellingCheckTimerRef.current);
      spellingCheckTimerRef.current = null;
    }
  }, [activeFileId]);

  useEffect(() => {
    if (!activeFileId || !activeIsXml || !parsed.doc?.documentElement) {
      setSpellingIssues((current) => current.filter((issue) => issue.fileId !== activeFileId));
      return;
    }

    const requestId = spellingRequestIdRef.current + 1;
    spellingRequestIdRef.current = requestId;

    if (spellingCheckTimerRef.current) {
      clearTimeout(spellingCheckTimerRef.current);
    }

    spellingCheckTimerRef.current = setTimeout(() => {
      if (requestId !== spellingRequestIdRef.current) return;
      const segments = collectSpellingTextSegmentsForDocument(parsed.doc!.documentElement, activeFileId);

      checkSpellingOnBackend(segments)
        .then((issues) => {
          if (requestId !== spellingRequestIdRef.current) return;
          const nextIssues = filterIgnoredSpellingIssues(issues);

          setSpellingIssues((current) => [
            ...current.filter((issue) => issue.fileId !== activeFileId),
            ...nextIssues,
          ]);
        })
        .catch(() => {
          if (requestId !== spellingRequestIdRef.current) return;
          const nextIssues = filterIgnoredSpellingIssues(
            collectSpellingIssuesForDocument(parsed.doc!.documentElement, activeFileId),
          );

          setSpellingIssues((current) => [
            ...current.filter((issue) => issue.fileId !== activeFileId),
            ...nextIssues,
          ]);
        });
    }, 850);
  }, [activeFileId, activeIsXml, parsed.doc, xml]);

  useEffect(() => {
    return () => {
      if (spellingCheckTimerRef.current) {
        clearTimeout(spellingCheckTimerRef.current);
      }
    };
  }, [selectedPath]);

  useLayoutEffect(() => {
    const workbench = document.querySelector(".editor-column.active-pane .visual-workbench") as HTMLElement | null;
    const workbenchRect = workbench?.getBoundingClientRect();
    const nextMarks: Array<{ id: string; left: number; top: number; width: number }> = [];

    activeSpellingIssues.forEach((issue) => {
      const textRun = Array.from(
        document.querySelectorAll(".editor-column.active-pane [data-node-path][data-text-node-index]"),
      ).find((candidate) => (
        candidate instanceof HTMLElement &&
        candidate.dataset.nodePath === issue.pathKey &&
        Number(candidate.dataset.textNodeIndex || 0) === issue.childNodeIndex
      )) as HTMLElement | undefined;

      if (!textRun) {
        return;
      }

      const textLength = textRun.textContent?.length || 0;
      const startOffset = Math.max(0, Math.min(issue.startOffset, textLength));
      const endOffset = Math.max(startOffset, Math.min(issue.endOffset, textLength));
      if (startOffset === endOffset) {
        return;
      }

      const range = createRangeForTextOffsets(textRun, startOffset, endOffset);
      if (!range) return;

      if (workbenchRect) {
        Array.from(range.getClientRects()).forEach((rect, index) => {
          if (rect.width <= 0 || rect.height <= 0) return;
          nextMarks.push({
            id: `${issue.id}-${index}`,
            left: rect.left - workbenchRect.left + (workbench?.scrollLeft || 0),
            top: rect.bottom - workbenchRect.top + (workbench?.scrollTop || 0) - 2,
            width: rect.width,
          });
        });
      }
    });

    setSpellingMarks((current) => {
      return spellingMarksAreEqual(current, nextMarks) ? current : nextMarks;
    });

    const refreshMarks = () => {
      setSpellingMarks((current) => current.map((mark) => ({ ...mark })));
    };

    workbench?.addEventListener("scroll", refreshMarks, { passive: true });
    window.addEventListener("resize", refreshMarks);

    return () => {
      workbench?.removeEventListener("scroll", refreshMarks);
      window.removeEventListener("resize", refreshMarks);
    };
  }, [activeFileId, activeSpellingIssuesKey, mode, xml]);

  useEffect(() => {
    const availableIds = new Set<string>(draftBackedFiles.map(({ node }) => node.id));
    const previousIds = previousGitChangeFileIdsRef.current;

    setSelectedGitCommitFileIds((currentIds) => {
      const nextIds = new Set<string>([...currentIds].filter((id) => availableIds.has(id)));
      availableIds.forEach((id) => {
        if (!previousIds.has(id)) {
          nextIds.add(id);
        }
      });

      const unchanged = nextIds.size === currentIds.size && [...nextIds].every((id) => currentIds.has(id));
      return unchanged ? currentIds : nextIds;
    });

    previousGitChangeFileIdsRef.current = availableIds;
  }, [draftBackedFileIdsKey]);

  useEffect(() => {
    let cancelled = false;

    async function syncAppAccount() {
      if (!isAuthenticated) {
        setAppAccount(null);
        setAppAccountError("");
        setAppAccountStatus("idle");
        return;
      }

      setAppAccountStatus("syncing");
      setAppAccountError("");

      try {
        const claims = await getIdTokenClaims();
        const token = claims?.__raw;

        if (!token) {
          throw new Error("Auth0 did not return an ID token.");
        }

        const response = await fetch(`${backendBaseUrl}/api/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error || "Could not sync the signed-in user.");
        }

        if (!cancelled) {
          setAppAccount(body);
          setAppAccountStatus("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setAppAccount(null);
          setAppAccountError(error instanceof Error ? error.message : "Could not sync the signed-in user.");
          setAppAccountStatus("error");
        }
      }
    }

    syncAppAccount();

    return () => {
      cancelled = true;
    };
  }, [getIdTokenClaims, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && appAccountStatus === "ready") {
      loadNotifications();
      loadSpecializations();
      loadAuthoringProfiles();
    } else if (!isAuthenticated) {
      setNotifications([]);
      setNotificationStatus("idle");
      setSpecializations([]);
      setActiveSpecializationDefinitions([]);
      authoringProfilesLoadedRef.current = false;
      lastSavedAuthoringProfilesRef.current = "";
      setSchemaProfileVersion((version) => version + 1);
    }
  }, [appAccountStatus, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || appAccountStatus !== "ready") return;

    refreshGitHubStatus();
    restoreProjectTreeFromDatabase();
  }, [appAccountStatus, isAuthenticated]);

  useEffect(() => {
    if (selectedProjectId || defaultExplorerSelectionRef.current) return;

    const contentFolder = findProjectFolderByPath(projectTree, "content");
    if (!contentFolder) return;

    defaultExplorerSelectionRef.current = true;
    setSelectedProjectId(contentFolder.node.id);
  }, [projectTree, selectedProjectId]);

  useEffect(() => {
    if (!isAuthenticated || githubStatusState !== "ready") return;
    if (githubStatus?.selectedRepository || workspaceSource !== "loading") return;

    setProjectTree(emptyProjectTree);
    setFileHistories({});
    setWorkspaceSource("empty");
    setExplorerSystemMessage("No GitHub repository selected. Create files or connect a repository.");
  }, [githubStatus?.selectedRepository, githubStatusState, isAuthenticated, workspaceSource]);

  useEffect(() => {
    if (activeLeftPanel) {
      setLastLeftPanel(activeLeftPanel);
    }
  }, [activeLeftPanel]);

  useEffect(() => {
    if (activeSidePanel) {
      setLastSidePanel(activeSidePanel);
    }
  }, [activeSidePanel]);

  useEffect(() => {
    function handleUndoRedoShortcut(event: KeyboardEvent) {
      if (
        (!activeIsVisualTemplate && !activeIsTextEditable) ||
        event.key.toLowerCase() !== "z" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest("input, select") ||
        (
          target?.closest("textarea") &&
          !target.closest(".source-editor") &&
          !target.closest(".plain-text-editor") &&
          !target.closest(".dita-codeblock")
        )
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (activeIsVisualTemplate) {
        if (event.shiftKey) {
          redoVisualTemplateChange();
        } else {
          undoVisualTemplateChange();
        }
        return;
      }

      if (event.shiftKey) {
        runRedo();
      } else {
        runUndo();
      }
    }

    document.addEventListener("keydown", handleUndoRedoShortcut, true);
    return () => document.removeEventListener("keydown", handleUndoRedoShortcut, true);
  }, [activeIsTextEditable, activeIsVisualTemplate, activeFileId, xml, canRedo, visualTemplateHistoryVersion]);

  useEffect(() => {
    if (activeLeftPanel !== "git" || !githubStatus?.selectedRepository) return;
    loadGitBranches();
    loadGitCommits(activeGitBranchName);
    loadGitLocalCommits(activeGitBranchName);
  }, [activeLeftPanel, githubStatus?.selectedRepository?.full_name]);

  useEffect(() => {
    if (!activeIsXml || mode === "source") return;

    if (!documentHighlightPathKey) return;

    const frame = requestAnimationFrame(() => {
      const selectedElement = document.querySelector(
        `.editor-column.active-pane .visual-editor [data-node-path="${documentHighlightPathKey}"]`,
      );

      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [activeFileId, activeIsXml, documentHighlightPathKey, mode]);

  useEffect(() => {
    if (!projectContextMenu) return;

    function handlePointerDown(event) {
      if (event.target instanceof Element && event.target.closest(".project-context-menu")) {
        return;
      }

      setProjectContextMenu(null);
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setProjectContextMenu(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [projectContextMenu]);

  useEffect(() => {
    if (!gitCommitContextMenu) return;

    function handlePointerDown(event) {
      if (event.target instanceof Element && event.target.closest(".git-commit-context-menu")) {
        return;
      }

      setGitCommitContextMenu(null);
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setGitCommitContextMenu(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [gitCommitContextMenu]);

  useEffect(() => {
    if (!fileTypePicker) return;

    function handlePointerDown(event) {
      if (event.target instanceof Element && event.target.closest(".file-type-picker")) {
        return;
      }

      setFileTypePicker(null);
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setFileTypePicker(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [fileTypePicker]);

  function setSelectedPath(nextPath) {
    setSelectedPathsByFile((current) => ({
      ...current,
      [activeFileId]: typeof nextPath === "function"
        ? nextPath(current[activeFileId] || [])
        : nextPath,
    }));
  }

  function selectDocumentExplorerNode(path) {
    setSelectedPath(path);
    setDocumentHighlightPathKey(pathKeyFor(path));
  }

  function setHistory(updater) {
    setFileHistories((current) => {
      const currentHistory = current[activeFileId] || {
        past: [],
        present: activeFile?.content || "",
        future: [],
      };
      const nextHistory = typeof updater === "function" ? updater(currentHistory) : updater;

      if (nextHistory === currentHistory) return current;

      return {
        ...current,
        [activeFileId]: nextHistory,
      };
    });
  }

  function switchToTab(fileId, paneId = null) {
    const file = findProjectNode(projectTree, fileId)?.node ||
      (fileId === specializationsTabId ? specializationsTabFile : null) ||
      (fileId === visualTemplatesTabId ? visualTemplatesTabFile : null) ||
      (fileId?.startsWith(`${authoringProfileTabPrefix}-`) ? createAuthoringProfileTabFile(getAuthoringProfileDocumentTypeFromTabId(fileId)) : null);
    if (!file || file.type !== "file") return;
    const pane = tabPanes.find((candidate) => candidate.id === paneId && candidate.tabs.includes(fileId)) ||
      tabPanes.find((candidate) => candidate.tabs.includes(fileId));

    sourceEditBaseRef.current = null;
    setContextMenu(null);
    if (pane) {
      setActivePaneId(pane.id);
      setTabPanes((currentPanes) => currentPanes.map((currentPane) => (
        currentPane.id === pane.id
          ? { ...currentPane, activeFileId: fileId }
          : currentPane
      )));
    }
    setActiveFileId(fileId);
    setSelectedProjectId(fileId === specializationsTabId ? null : fileId);
  }

  function activatePaneSelection(paneId, fileId, path) {
    switchToTab(fileId, paneId);
    setSelectedPathsByFile((current) => ({
      ...current,
      [fileId]: path,
    }));
  }

  function startPaneResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startPercent = paneSplitPercent;
    const container = event.currentTarget.parentElement;
    const containerRect = container?.getBoundingClientRect();
    const containerSize = paneSplitDirection === "down"
      ? containerRect?.height || 1
      : containerRect?.width || 1;

    function handlePointerMove(moveEvent) {
      const delta = paneSplitDirection === "down"
        ? moveEvent.clientY - startY
        : moveEvent.clientX - startX;
      const deltaPercent = (delta / containerSize) * 100;
      setPaneSplitPercent(Math.max(25, Math.min(75, startPercent + deltaPercent)));
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function startBottomPanelResize(event) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = bottomPanelHeight;

    function handlePointerMove(moveEvent) {
      const delta = startY - moveEvent.clientY;
      setBottomPanelHeight(Math.max(170, Math.min(460, startHeight + delta)));
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function startNavigatorResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startOverlap = editorLeftOverlap;

    function handlePointerMove(moveEvent) {
      setEditorLeftOverlap(Math.max(0, Math.min(180, startOverlap - (moveEvent.clientX - startX))));
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function startInspectorResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startOverlap = editorRightOverlap;

    function handlePointerMove(moveEvent) {
      setEditorRightOverlap(Math.max(0, Math.min(220, startOverlap + moveEvent.clientX - startX)));
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function getFileName(fileId) {
    const file = findProjectNode(projectTree, fileId)?.node;
    if (!file && fileId === specializationsTabId) return specializationsTabFile.name;
    if (!file && fileId === visualTemplatesTabId) return visualTemplatesTabFile.name;
    if (!file && fileId?.startsWith(`${authoringProfileTabPrefix}-`)) return createAuthoringProfileTabFile(getAuthoringProfileDocumentTypeFromTabId(fileId)).name;
    return file?.type === "file" ? file.name : "file";
  }

  function closeTab(fileId, event = null, paneId = null) {
    event?.stopPropagation();

    let nextActiveFileId = activeFileId;
    let nextActivePaneId = activePaneId;

    setTabPanes((currentPanes) => {
      const sourcePane = currentPanes.find((pane) => pane.id === (paneId || currentPanes.find((candidate) => candidate.tabs.includes(fileId))?.id));
      if (!sourcePane) return currentPanes;

      const tabIndex = sourcePane.tabs.indexOf(fileId);
      const nextPanes = currentPanes.map((pane) => {
        if (pane.id !== sourcePane.id) return pane;

        const nextTabs = pane.tabs.filter((id) => id !== fileId);
        const nextPaneActiveFileId = pane.activeFileId === fileId
          ? nextTabs[Math.max(0, tabIndex - 1)] || nextTabs[0] || null
          : pane.activeFileId;

        if (fileId === activeFileId && nextPaneActiveFileId) {
          nextActiveFileId = nextPaneActiveFileId;
          nextActivePaneId = pane.id;
        }

        return { ...pane, tabs: nextTabs, activeFileId: nextPaneActiveFileId };
      }).filter((pane) => pane.tabs.length > 0 || currentPanes.length === 1);

      if (fileId === activeFileId && !nextPanes.some((pane) => pane.tabs.includes(nextActiveFileId))) {
        nextActivePaneId = nextPanes[0]?.id || "pane-left";
        nextActiveFileId = nextPanes[0]?.activeFileId || nextPanes[0]?.tabs[0] || null;
      }

      return nextPanes;
    });

    if (fileId === activeFileId) {
      setActivePaneId(nextActivePaneId);
      setActiveFileId(nextActiveFileId);
      setSelectedProjectId(null);
    }
  }

  function closeOtherTabs(fileId, paneId) {
    setTabPanes((currentPanes) => currentPanes.map((pane) => (
      pane.id === paneId
        ? { ...pane, tabs: [fileId], activeFileId: fileId }
        : pane
    )));
    setActivePaneId(paneId);
    setActiveFileId(fileId);
    setSelectedProjectId(fileId);
    setTabContextMenu(null);
  }

  function closeAllTabs(paneId) {
    const pane = tabPanes.find((candidate) => candidate.id === paneId);
    if (!pane) return;

    if (tabPanes.length === 1) {
      setTabPanes([{ ...pane, tabs: [], activeFileId: null }]);
      setActiveFileId(null);
      setSelectedProjectId(null);
      setTabContextMenu(null);
      return;
    }

    const nextPanes = tabPanes.filter((candidate) => candidate.id !== paneId);
    const nextPane = nextPanes[0];
    setTabPanes(nextPanes);
    setActivePaneId(nextPane.id);
    setActiveFileId(nextPane.activeFileId);
    setSelectedProjectId(nextPane.activeFileId);
    setTabContextMenu(null);
  }

  function splitTabRight(fileId, paneId) {
    const rightPaneId = "pane-right";

    setTabPanes((currentPanes) => {
      if (currentPanes.length > 1) return currentPanes;

      return [
        ...currentPanes.map((pane) => (
        pane.id === paneId && pane.tabs.includes(fileId)
          ? { ...pane, activeFileId: fileId }
          : pane
        )),
        { id: rightPaneId, label: "Right", tabs: [fileId], activeFileId: fileId },
      ];
    });
    setPaneSplitDirection("right");
    setActivePaneId(rightPaneId);
    setActiveFileId(fileId);
    setSelectedProjectId(fileId);
    setTabContextMenu(null);
  }

  function splitTabDown(fileId, paneId) {
    const bottomPaneId = "pane-bottom";

    setTabPanes((currentPanes) => {
      if (currentPanes.length > 1) return currentPanes;

      return [
        ...currentPanes.map((pane) => (
          pane.id === paneId && pane.tabs.includes(fileId)
            ? { ...pane, activeFileId: fileId }
            : pane
        )),
        { id: bottomPaneId, label: "Bottom", tabs: [fileId], activeFileId: fileId },
      ];
    });
    setPaneSplitDirection("down");
    setPaneSplitPercent(45);
    setActivePaneId(bottomPaneId);
    setActiveFileId(fileId);
    setSelectedProjectId(fileId);
    setTabContextMenu(null);
  }

  function splitAndMoveTabRight(fileId, paneId) {
    const rightPaneId = "pane-right";

    setTabPanes((currentPanes) => {
      if (currentPanes.length > 1) return currentPanes;

      const sourcePane = currentPanes.find((pane) => pane.id === paneId);
      if (!sourcePane || sourcePane.tabs.length <= 1) return currentPanes;

      return [
        ...currentPanes.map((pane) => {
          if (pane.id !== paneId) return pane;

          const nextTabs = pane.tabs.filter((id) => id !== fileId);
          return {
            ...pane,
            tabs: nextTabs,
            activeFileId: pane.activeFileId === fileId ? nextTabs[0] || null : pane.activeFileId,
          };
        }),
        { id: rightPaneId, label: "Right", tabs: [fileId], activeFileId: fileId },
      ];
    });
    setPaneSplitDirection("right");
    setActivePaneId(rightPaneId);
    setActiveFileId(fileId);
    setSelectedProjectId(fileId);
    setTabContextMenu(null);
  }

  function splitAndMoveTabDown(fileId, paneId) {
    const bottomPaneId = "pane-bottom";

    setTabPanes((currentPanes) => {
      if (currentPanes.length > 1) return currentPanes;

      const sourcePane = currentPanes.find((pane) => pane.id === paneId);
      if (!sourcePane || sourcePane.tabs.length <= 1) return currentPanes;

      return [
        ...currentPanes.map((pane) => {
          if (pane.id !== paneId) return pane;

          const nextTabs = pane.tabs.filter((id) => id !== fileId);
          return {
            ...pane,
            tabs: nextTabs,
            activeFileId: pane.activeFileId === fileId ? nextTabs[0] || null : pane.activeFileId,
          };
        }),
        { id: bottomPaneId, label: "Bottom", tabs: [fileId], activeFileId: fileId },
      ];
    });
    setPaneSplitDirection("down");
    setActivePaneId(bottomPaneId);
    setActiveFileId(fileId);
    setSelectedProjectId(fileId);
    setTabContextMenu(null);
  }

  function moveTabToPane(fileId, sourcePaneId, targetPaneId) {
    if (sourcePaneId === targetPaneId) return;

    setTabPanes((currentPanes) => {
      const targetExists = currentPanes.some((pane) => pane.id === targetPaneId);
      const targetLabel = targetPaneId === "pane-right"
        ? "Right"
        : targetPaneId === "pane-bottom"
          ? "Bottom"
          : "Left";
      const panesWithTarget = targetExists
        ? currentPanes
        : [...currentPanes, { id: targetPaneId, label: targetLabel, tabs: [], activeFileId: fileId }];

      return panesWithTarget.map((pane) => {
        if (pane.id === sourcePaneId) {
          const nextTabs = pane.tabs.filter((id) => id !== fileId);
          return {
            ...pane,
            tabs: nextTabs,
            activeFileId: pane.activeFileId === fileId ? nextTabs[0] || null : pane.activeFileId,
          };
        }

        if (pane.id === targetPaneId) {
          return {
            ...pane,
            tabs: pane.tabs.includes(fileId) ? pane.tabs : [...pane.tabs, fileId],
            activeFileId: fileId,
          };
        }

        return pane;
      }).filter((pane) => pane.tabs.length > 0);
    });

    setActivePaneId(targetPaneId);
    setActiveFileId(fileId);
    setSelectedProjectId(fileId);
    setTabContextMenu(null);
  }

  function moveDraggedTab(draggedTab, targetPaneId, targetIndex = null) {
    if (!draggedTab?.fileId || !draggedTab?.paneId) return;

    const { fileId, paneId: sourcePaneId } = draggedTab;
    let nextActivePaneId = targetPaneId;
    let nextActiveFileId = fileId;

    setTabPanes((currentPanes) => {
      const sourcePane = currentPanes.find((pane) => pane.id === sourcePaneId);
      const targetPane = currentPanes.find((pane) => pane.id === targetPaneId);

      if (!sourcePane || !targetPane) return currentPanes;

      if (sourcePaneId === targetPaneId) {
        const fromIndex = sourcePane.tabs.indexOf(fileId);
        if (fromIndex === -1) return currentPanes;

        const nextTabs = sourcePane.tabs.filter((id) => id !== fileId);
        const rawIndex = targetIndex ?? nextTabs.length;
        const adjustedIndex = rawIndex > fromIndex ? rawIndex - 1 : rawIndex;
        const insertIndex = Math.max(0, Math.min(nextTabs.length, adjustedIndex));
        nextTabs.splice(insertIndex, 0, fileId);

        nextActivePaneId = sourcePaneId;
        nextActiveFileId = sourcePane.activeFileId || fileId;

        return currentPanes.map((pane) => (
          pane.id === sourcePaneId
            ? { ...pane, tabs: nextTabs }
            : pane
        ));
      }

      const nextPanes = currentPanes.map((pane) => {
        if (pane.id === sourcePaneId) {
          const nextTabs = pane.tabs.filter((id) => id !== fileId);
          return {
            ...pane,
            tabs: nextTabs,
            activeFileId: pane.activeFileId === fileId ? nextTabs[0] || null : pane.activeFileId,
          };
        }

        if (pane.id === targetPaneId) {
          const nextTabs = pane.tabs.filter((id) => id !== fileId);
          const insertIndex = Math.max(0, Math.min(nextTabs.length, targetIndex ?? nextTabs.length));
          nextTabs.splice(insertIndex, 0, fileId);

          return {
            ...pane,
            tabs: nextTabs,
            activeFileId: fileId,
          };
        }

        return pane;
      }).filter((pane) => pane.tabs.length > 0);

      if (nextPanes.length === 1) {
        nextActivePaneId = nextPanes[0].id;
      }

      return nextPanes;
    });

    setActivePaneId(nextActivePaneId);
    setActiveFileId(nextActiveFileId);
    setSelectedProjectId(nextActiveFileId);
    setTabDropTarget(null);
    setTabContextMenu(null);
  }

  function getDraggedTab(event) {
    const tabData = event.dataTransfer.getData("application/x-xml-editor-tab");
    if (!tabData) return null;

    try {
      const parsedTab = JSON.parse(tabData);
      if (typeof parsedTab.fileId === "string" && typeof parsedTab.paneId === "string") {
        return parsedTab;
      }
    } catch {
      return null;
    }

    return null;
  }

  function stopVoiceSession(message = "Voice session stopped.") {
    realtimeChannelRef.current?.close();
    realtimePeerRef.current?.close();
    realtimeStreamRef.current?.getTracks().forEach((track) => track.stop());
    realtimeAudioRef.current?.remove();

    realtimeChannelRef.current = null;
    realtimePeerRef.current = null;
    realtimeStreamRef.current = null;
    realtimeAudioRef.current = null;
    setVoiceStatus("idle");
    setVoiceMessage(message);
  }

  async function startVoiceSession() {
    if (voiceStatus === "connected" || voiceStatus === "connecting") {
      stopVoiceSession();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceStatus("error");
      setVoiceMessage("Microphone access is not available in this browser.");
      return;
    }

    setVoiceStatus("connecting");
    setVoiceMessage("Requesting microphone access...");

    try {
      const tokenResponse = await fetch("/api/realtime/client-secret");
      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        throw new Error(tokenData.error || "Unable to create a Realtime client secret.");
      }

      const ephemeralKey = tokenData.value || tokenData.client_secret?.value;

      if (!ephemeralKey) {
        throw new Error("Realtime client secret response did not include a token value.");
      }

      const peerConnection = new RTCPeerConnection();
      const audioElement = document.createElement("audio");
      audioElement.autoplay = true;
      peerConnection.ontrack = (event) => {
        audioElement.srcObject = event.streams[0];
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStream.getTracks().forEach((track) => peerConnection.addTrack(track, mediaStream));

      const dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannel.addEventListener("open", () => {
        setVoiceStatus("connected");
        setVoiceMessage("Voice assistant is listening. Speak naturally.");
      });
      dataChannel.addEventListener("message", (event) => {
        try {
          const realtimeEvent = JSON.parse(event.data);
          if (realtimeEvent.type === "response.done") {
            setVoiceMessage("Assistant responded. Continue speaking or stop the session.");
          }
        } catch {
          // Ignore non-JSON diagnostic messages.
        }
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(await sdpResponse.text());
      }

      const answer = {
        type: "answer" as RTCSdpType,
        sdp: await sdpResponse.text(),
      };
      await peerConnection.setRemoteDescription(answer);

      realtimePeerRef.current = peerConnection;
      realtimeStreamRef.current = mediaStream;
      realtimeChannelRef.current = dataChannel;
      realtimeAudioRef.current = audioElement;
      setVoiceMessage("Connecting to the voice assistant...");
    } catch (error) {
      stopVoiceSession(
        error instanceof Error
          ? error.message
          : "Unable to start the voice assistant.",
      );
      setVoiceStatus("error");
    }
  }

  async function sendChatMessage(message = chatDraft) {
    const trimmed = message.trim();
    if (!trimmed) return;

    const pendingMessageId = `pending-${Date.now().toString(36)}`;
    setChatMessages((current) => [
      ...current,
      { role: "user", text: trimmed },
      {
        id: pendingMessageId,
        role: "assistant",
        text: "Thinking...",
      },
    ]);
    setChatDraft("");
    setChatStatus("sending");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: trimmed,
          context: aiContext,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Chat request failed.");
      }

      setChatMessages((current) => current.map((chatMessage) => (
        chatMessage.id === pendingMessageId
          ? { role: "assistant", text: body.text || "I could not produce a response." }
          : chatMessage
      )));
    } catch (error) {
      setChatMessages((current) => current.map((chatMessage) => (
        chatMessage.id === pendingMessageId
          ? {
              role: "assistant",
              text: error instanceof Error
                ? error.message
                : "Chat request failed.",
            }
          : chatMessage
      )));
    } finally {
      setChatStatus("idle");
    }
  }

  function startNewChat() {
    setChatMessages([
      {
        role: "assistant",
        text: "New chat started. Ask for help with the current topic, schema, references, or wording.",
      },
    ]);
    setChatDraft("");
  }

  function clearChat() {
    setChatMessages([]);
    setChatDraft("");
  }

  function runAiReview() {
    if (!activeIsXml || !parsed.doc) {
      setAiReviewStatus("error");
      setAiSuggestions([]);
      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "Open a DITA or XML document before running AI Review.",
        },
      ]);
      setActiveSidePanel("aiReview");
      return;
    }

    setAiReviewStatus("reviewing");
    const suggestions = generateAmbientAiSuggestions(aiContext, parsed.doc);
    setAiSuggestions(suggestions);
    setDismissedAiSuggestionIds([]);
    setAiReviewStatus("ready");
    setActiveSidePanel("aiReview");
    setChatMessages((current) => [
      ...current,
      {
        role: "assistant",
        text: suggestions.length
          ? `AI Review found ${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} for ${activeFile?.name || "this document"}.`
          : `${activeFile?.name || "This document"} looks clean for the first AI foundation pass.`,
      },
    ]);
  }

  function applyAiOperation(operation: AiOperation): Document | null {
    if (!activeIsXml) return null;

    const { doc, error } = parseXml(xml);
    if (error || !doc) return null;

    let focusPath = operation.targetPath;
    let shouldMoveFocus = false;

    if (operation.type === "insert_element") {
      let insertedPath: number[] | null = null;
      shouldMoveFocus = true;

      if (operation.placement === "after") {
        if (!getAllowedSiblingOptions(doc, operation.targetPath).includes(operation.tagName)) return null;
        insertedPath = insertSchemaSiblingAfter(doc, operation.targetPath, operation.tagName);
      } else {
        const parent = getNodeByPath(doc, operation.targetPath);
        if (!parent || !getAllowedChildOptions(parent).includes(operation.tagName)) return null;
        const index = appendSchemaChild(parent, createElementFor(doc, operation.tagName));
        insertedPath = [...operation.targetPath, index];
      }

      const inserted = insertedPath ? getNodeByPath(doc, insertedPath) : null;
      if (!inserted) return null;

      Object.entries(operation.attributes || {}).forEach(([name, value]) => {
        inserted.setAttribute(name, value);
      });
      if (typeof operation.text === "string") {
        inserted.textContent = operation.text;
      }
      focusPath = getFirstEditablePath(inserted, insertedPath || operation.targetPath);
    } else if (operation.type === "set_attribute") {
      const node = getNodeByPath(doc, operation.targetPath);
      if (!node) return null;
      node.setAttribute(operation.name, operation.value);
    } else if (operation.type === "replace_text") {
      const node = getNodeByPath(doc, operation.targetPath);
      if (!node) return null;
      node.textContent = operation.text;
    } else if (operation.type === "replace_range") {
      const replaced = replaceTextRangeValue(doc, {
        kind: "range",
        path: operation.targetPath,
        childNodeIndex: operation.childNodeIndex,
        startOffset: operation.startOffset,
        endOffset: operation.endOffset,
      }, operation.text);
      if (!replaced) return null;
    }

    const nextIssues = validateDita(doc).filter((issue) => issue.level === "error");
    if (nextIssues.length) {
      setBottomPanelTab("terminal");
      setBottomPanelOpen(true);
      appendTerminalMessage(`AI operation blocked: ${nextIssues[0].message || "resulting XML is not valid."}`, {
        source: "AI",
        level: "error",
      });
      return null;
    }

    if (shouldMoveFocus) {
      setSelectedPath(focusPath);
      setPendingFocusPath(focusPath);
    }
    updateXmlFromDoc(doc);
    return doc;
  }

  function applyAiSuggestion(suggestion: AiSuggestion) {
    if (!suggestion.operation) return;

    const appliedDoc = applyAiOperation(suggestion.operation);
    if (!appliedDoc) return;

    const nextIssues = validateDita(appliedDoc);
    const nextErrors = nextIssues.filter((issue) => issue.level === "error");
    setAiSuggestions(generateAmbientAiSuggestions({
      ...aiContext,
      topicType: appliedDoc.documentElement?.tagName || aiContext.topicType,
    }, appliedDoc).filter((item) => item.id !== suggestion.id));
    setDismissedAiSuggestionIds([]);
    setChatMessages((current) => [
      ...current,
      {
        role: "assistant",
        text: `Applied suggestion: ${suggestion.title}. The draft was checked with the local DITA profile${nextErrors.length ? ` and still has ${nextErrors.length} error${nextErrors.length === 1 ? "" : "s"}.` : " and no blocking schema errors were found."}`,
      },
    ]);
    appendTerminalMessage(
      `Applied AI suggestion "${suggestion.title}" to ${activeFile?.name || "active document"}. ${nextErrors.length ? `${nextErrors.length} local schema error${nextErrors.length === 1 ? "" : "s"} remain.` : "Local schema check passed."}`,
      {
      source: "AI",
      level: nextErrors.length ? "warning" : "info",
      open: nextErrors.length > 0,
    },
    );
  }

  async function generateAiShortdescSuggestion() {
    if (!activeIsXml || !parsed.doc?.documentElement) {
      setActiveSidePanel("aiReview");
      appendTerminalMessage("Open a DITA XML document before generating a shortdesc.", {
        source: "AI",
        level: "warning",
        open: true,
      });
      return;
    }

    const titlePath = findFirstChildPathByTag(parsed.doc.documentElement, [], "title");
    const existingShortdescPath = findFirstChildPathByTag(parsed.doc.documentElement, [], "shortdesc");
    const leanContext = buildLeanDitaContext({
      activeFileName: activeFile?.name || "Untitled topic",
      aiContext,
      doc: parsed.doc,
    });
    if (!titlePath && !existingShortdescPath) {
      appendTerminalMessage("AI shortdesc needs a topic title or an existing shortdesc target.", {
        source: "AI",
        level: "warning",
        open: true,
      });
      return;
    }

    setAiShortdescStatus("generating");
    setActiveSidePanel("aiReview");
    appendTerminalMessage(`Generating AI shortdesc for ${activeFile?.name || "active topic"}...`, {
      source: "AI",
      level: "info",
    });

    try {
      const response = await fetch(`${backendBaseUrl}/api/ai/shortdesc`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...leanContext,
          purpose: "generate-shortdesc",
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not generate shortdesc.");
      }

      const shortdesc = String(body.shortdesc || "").trim();
      if (!shortdesc) {
        throw new Error("The AI response did not include a shortdesc.");
      }

      const suggestion: AiSuggestion = {
        id: `ai-shortdesc-${Date.now()}`,
        severity: "info",
        title: existingShortdescPath ? "AI shortdesc rewrite" : "AI shortdesc proposal",
        body: shortdesc,
        targetPath: getElementPathLabel(parsed.doc, existingShortdescPath || []),
        operation: existingShortdescPath
          ? {
              type: "replace_text",
              targetPath: existingShortdescPath,
              text: shortdesc,
            }
          : {
              type: "insert_element",
              placement: "after",
              targetPath: titlePath || [],
              tagName: "shortdesc",
              text: shortdesc,
            },
      };

      setAiSuggestions((current) => [suggestion, ...current.filter((item) => item.id !== "missing-shortdesc")].slice(0, 8));
      setDismissedAiSuggestionIds([]);
      appendTerminalMessage(`AI shortdesc ready from ${body.model || "configured model"}. Review it before applying.`, {
        source: "AI",
        level: "info",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not generate shortdesc.";
      appendTerminalMessage(message, {
        source: "AI",
        level: "error",
        open: true,
      });
      pushNotification({
        severity: "error",
        title: "AI Shortdesc Failed",
        body: message,
        source: "AI",
      });
    } finally {
      setAiShortdescStatus("idle");
    }
  }

  function explainSelectedElement(path = selectedPath) {
    if (!activeIsXml || !parsed.doc?.documentElement) {
      setActiveSidePanel("aiReview");
      appendTerminalMessage("Open a DITA XML document before explaining an element.", {
        source: "AI",
        level: "warning",
        open: true,
      });
      return;
    }

    const targetNode = getNodeByPath(parsed.doc, path);
    if (!targetNode) {
      appendTerminalMessage("Select a DITA element before requesting an explanation.", {
        source: "AI",
        level: "warning",
        open: true,
      });
      return;
    }

    const definition = getElementDefinition(targetNode.tagName);
    const childOptions = getAllowedChildOptions(targetNode);
    const siblingOptions = getAllowedSiblingOptions(parsed.doc, path);
    const attributes = getAttributeDefinitions(targetNode.tagName);
    const inlineText = definition?.inline ? "inline" : "block";
    const childSummary = childOptions.length
      ? `Allowed child elements include: ${childOptions.slice(0, 12).join(", ")}${childOptions.length > 12 ? ", ..." : ""}.`
      : "This element does not allow child elements in the active schema profile.";
    const siblingSummary = siblingOptions.length
      ? `Allowed Add After elements include: ${siblingOptions.slice(0, 12).join(", ")}${siblingOptions.length > 12 ? ", ..." : ""}.`
      : "The active schema profile does not allow another sibling after this element here.";
    const attributeSummary = attributes.length
      ? `Common attributes here: ${attributes.slice(0, 8).map((attribute) => attribute.name).join(", ")}${attributes.length > 8 ? ", ..." : ""}.`
      : "No attributes are defined for this element.";
    const explanation = [
      `<${targetNode.tagName}> is a ${inlineText} DITA element.`,
      childSummary,
      siblingSummary,
      attributeSummary,
    ].join(" ");

    setActiveSidePanel("aiReview");
    const explanationSuggestion: AiSuggestion = {
      id: `ai-explain-${targetNode.tagName}-${Date.now()}`,
      severity: "info",
      title: `Explain <${targetNode.tagName}>`,
      body: explanation,
      targetPath: getElementPathLabel(parsed.doc, path),
    };
    setAiSuggestions((current) => [
      explanationSuggestion,
      ...current.filter((suggestion) => !suggestion.id.startsWith("ai-explain-")),
    ].slice(0, 8));
    setDismissedAiSuggestionIds([]);
    appendTerminalMessage(`Explained <${targetNode.tagName}> in ${activeFile?.name || "active topic"}.`, {
      source: "AI",
      level: "info",
    });
  }

  async function rewriteSelectedTextSuggestion(options: {
    instruction?: string;
    logLabel?: string;
    suggestionTitle?: string;
  } = {}) {
    if (!activeIsXml || !parsed.doc?.documentElement) {
      setActiveSidePanel("aiReview");
      appendTerminalMessage("Open a DITA XML document before rewriting text.", {
        source: "AI",
        level: "warning",
        open: true,
      });
      return;
    }

    const liveSelection = getAuthoringSelection();
    const authoringSelection = liveSelection?.kind === "range"
      ? liveSelection
      : caretRef.current?.kind === "range"
        ? caretRef.current
        : liveSelection || caretRef.current;
    const selectedText = getTextRangeValue(parsed.doc, authoringSelection);
    if (authoringSelection?.kind !== "range" || !selectedText.trim()) {
      appendTerminalMessage("Select text in the WYSIWYG editor before requesting a rewrite.", {
        source: "AI",
        level: "warning",
        open: true,
      });
      return;
    }

    const targetNode = getNodeByPath(parsed.doc, authoringSelection.path);
    const leanContext = buildLeanDitaContext({
      activeFileName: activeFile?.name || "Untitled topic",
      aiContext,
      doc: parsed.doc,
    });

    setAiRewriteStatus("rewriting");
    setActiveSidePanel("aiReview");
    setPinnedAuthoringSelection(authoringSelection);
    appendTerminalMessage(`${options.logLabel || "Rewriting selected text"} in ${activeFile?.name || "active topic"}...`, {
      source: "AI",
      level: "info",
    });

    try {
      const response = await fetch(`${backendBaseUrl}/api/ai/rewrite`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          activeFileName: activeFile?.name || "Untitled topic",
          topicType: parsed.doc.documentElement.tagName,
          selectedElementName: targetNode?.tagName || aiContext.selectedElementName || "",
          selectedElementPath: getElementPathLabel(parsed.doc, authoringSelection.path),
          selectedText,
          instruction: options.instruction || "Rewrite for clarity and concision while preserving technical meaning.",
          context: leanContext,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not rewrite selected text.");
      }

      const rewrite = String(body.rewrite || "").trim();
      if (!rewrite) {
        throw new Error("The AI response did not include a rewrite.");
      }

      const suggestion: AiSuggestion = {
        id: `ai-rewrite-${Date.now()}`,
        severity: "info",
        title: options.suggestionTitle || "AI rewrite proposal",
        body: rewrite,
        targetPath: getElementPathLabel(parsed.doc, authoringSelection.path),
        operation: {
          type: "replace_range",
          targetPath: authoringSelection.path,
          childNodeIndex: authoringSelection.childNodeIndex,
          startOffset: authoringSelection.startOffset,
          endOffset: authoringSelection.endOffset,
          text: rewrite,
        },
      };

      setAiSuggestions((current) => [suggestion, ...current].slice(0, 8));
      setDismissedAiSuggestionIds([]);
      appendTerminalMessage(`AI rewrite ready from ${body.model || "configured model"}. Review it before applying.`, {
        source: "AI",
        level: "info",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not rewrite selected text.";
      appendTerminalMessage(message, {
        source: "AI",
        level: "error",
        open: true,
      });
      pushNotification({
        severity: "error",
        title: "AI Rewrite Failed",
        body: message,
        source: "AI",
      });
    } finally {
      setAiRewriteStatus("idle");
    }
  }

  useEffect(() => {
    setAiSuggestions([]);
    setDismissedAiSuggestionIds([]);
    setAiReviewStatus("idle");
  }, [activeFileId]);

  useEffect(() => {
    if (!activeIsTextEditable) return;

    setProjectTree((currentTree) => updateProjectNode(currentTree, activeFileId, (node) => {
      if (node.type !== "file" || node.content === xml) return node;
      return { ...node, content: xml };
    }));
  }, [activeFileId, activeIsTextEditable, xml]);

  useEffect(() => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }

    if (!isAuthenticated || !activeFile || !activeIsTextEditable || !activeFile.githubPath) {
      return;
    }

    const draftKey = `${activeFile.githubPath}\n${activeFile.githubSha || ""}\n${xml}`;
    if (draftKey === lastSavedDraftRef.current) {
      return;
    }

    setDraftSaveState({
      status: "pending",
      message: `Draft changes pending for ${activeFile.name}.`,
    });

    draftSaveTimerRef.current = setTimeout(async () => {
      try {
        setDraftSaveState({
          status: "saving",
          message: `Saving draft for ${activeFile.name}...`,
        });
        const draftContent = activeFileKind === "xml" ? ensureDitaDoctype(xml) : xml;
        const response = await fetch(`${backendBaseUrl}/api/drafts/github`, {
          method: "PUT",
          headers: {
            ...(await getBackendAuthHeaders()),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filePath: activeFile.githubPath,
            githubSha: activeFile.githubSha || "",
            sourceContentHash: activeFile.sourceContentHash || "",
            contentFormat: activeFileKind,
            content: draftContent,
          }),
        });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error || "Could not save draft.");
        }

        lastSavedDraftRef.current = draftKey;
        setProjectTree((currentTree) => updateProjectNode(currentTree, activeFile.id, (node) => ({
          ...node,
          draftSavedAt: body.draft?.saved_at || new Date().toISOString(),
          draftDirty: Boolean(body.draft?.dirty),
          draftContentHash: body.draft?.draft_content_hash || node.draftContentHash || "",
          sourceContentHash: body.draft?.source_content_hash || node.sourceContentHash || "",
        })));
        setDraftSaveState({
          status: "saved",
          message: `Draft saved at ${new Date(body.draft?.saved_at || Date.now()).toLocaleTimeString()}.`,
        });
      } catch (error) {
        setDraftSaveState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not save draft.",
        });
      }
    }, 1200);

    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [activeFileId, activeFile?.githubPath, activeFile?.githubSha, activeFile?.sourceContentHash, activeFileKind, activeIsTextEditable, isAuthenticated, xml]);

  function loadXmlIntoEditor(nextXml, fileId = activeFileId) {
    sourceEditBaseRef.current = null;
    setContextMenu(null);
    setSelectedPathsByFile((current) => ({
      ...current,
      [fileId]: [],
    }));
    setFileHistories((current) => ({
      ...current,
      [fileId]: {
        past: [],
        present: nextXml,
        future: [],
      },
    }));
  }

  async function loadGitHubFileIfNeeded(file) {
    if (!file?.githubPath || file.githubLoaded) {
      return file;
    }

    try {
      setExplorerSystemMessage(`Loading ${file.name} from GitHub...`, "info", { open: false });
      const draftResponse = await fetch(`${backendBaseUrl}/api/drafts/github?path=${encodeURIComponent(file.githubPath)}`, {
        headers: await getBackendAuthHeaders(),
      });
      const draftBody = await draftResponse.json();
      const savedDraft = draftResponse.ok &&
        draftBody.draft?.dirty &&
        !draftBody.draft?.deleted_at &&
        draftBody.draft?.change_type !== "delete"
        ? draftBody.draft
        : null;
      const response = await fetch(`${backendBaseUrl}/api/github/file?path=${encodeURIComponent(file.githubPath)}`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok && !savedDraft) {
        throw new Error(body.error || `Could not load ${file.name} from GitHub.`);
      }

      const extension = getFileExtension(file.name);
      const isImage = /^(avif|gif|jpe?g|png|svg|webp)$/i.test(extension);
      const fileKind = getProjectFileKind(file);
      let rawContent = isImage ? "" : savedDraft?.content_text || body.content || "";
      const detectedDitaType = fileKind === "xml"
        ? inferDitaTypeFromXml(rawContent) || inferBestProjectFileType(file.name, file.ditaType)
        : file.ditaType;
      let recoveredEmptyXml = false;
      if (fileKind === "xml" && !String(rawContent).trim()) {
        recoveredEmptyXml = true;
        rawContent = createGenericFileContent(detectedDitaType || "topic", file.name);
      }
      const convertedContent = fileKind === "xml"
        ? convertEditorJsonToDitaXml(rawContent, file.name, file.ditaType)
        : null;
      const normalizedContent = fileKind === "xml"
        ? ensureDitaDoctype(convertedContent || rawContent)
        : rawContent;
      const loadedFile = {
        ...file,
        ditaType: detectedDitaType || file.ditaType,
        content: normalizedContent,
        previewHref: isImage && response.ok && body.contentBase64
          ? `data:${body.mimeType || "application/octet-stream"};base64,${body.contentBase64}`
          : file.previewHref,
        githubSha: response.ok ? body.sha || file.githubSha || "" : savedDraft?.github_sha || file.githubSha || "",
        sourceContentHash: savedDraft?.source_content_hash || (response.ok ? body.contentHash : "") || file.sourceContentHash || "",
        draftContentHash: savedDraft?.draft_content_hash || "",
        githubLoaded: true,
        githubConvertedFromJson: Boolean(convertedContent),
        draftLoaded: Boolean(savedDraft),
        draftSavedAt: savedDraft?.saved_at || null,
        draftDirty: Boolean(savedDraft?.dirty),
      };
      if (recoveredEmptyXml) {
        setExplorerSystemMessage(`${file.name} is empty in GitHub. A valid starter XML document was opened locally; save and commit it to repair the file.`, "warning", { open: false });
      }
      lastSavedDraftRef.current = loadedFile.githubPath
        ? `${loadedFile.githubPath}\n${loadedFile.githubSha || ""}\n${loadedFile.content || ""}`
        : lastSavedDraftRef.current;

      setProjectTree((currentTree) => updateProjectNode(currentTree, file.id, (node) => ({
        ...node,
        content: loadedFile.content,
        previewHref: loadedFile.previewHref,
        githubSha: loadedFile.githubSha,
        sourceContentHash: loadedFile.sourceContentHash,
        draftContentHash: loadedFile.draftContentHash,
        githubLoaded: true,
        githubConvertedFromJson: loadedFile.githubConvertedFromJson,
        draftLoaded: loadedFile.draftLoaded,
        draftSavedAt: loadedFile.draftSavedAt,
        draftDirty: loadedFile.draftDirty,
      })));

      return loadedFile;
    } catch (error) {
      setExplorerSystemMessage(error instanceof Error ? error.message : `Could not load ${file.name} from GitHub.`, "error");
      return null;
    }
  }

  async function openProjectFile(fileId) {
    const projectFile = findProjectNode(projectTree, fileId)?.node;
    const file = await loadGitHubFileIfNeeded(projectFile);
    if (!file || file.type !== "file") {
      return;
    }

    const fileKind = getProjectFileKind(file);
    const existingPane = tabPanes.find((pane) => pane.tabs.includes(file.id));
    const targetPaneId = existingPane?.id || activePaneId;

    setTabPanes((currentPanes) => currentPanes.map((pane) => (
      pane.id === targetPaneId
        ? {
            ...pane,
            tabs: pane.tabs.includes(file.id) ? pane.tabs : [...pane.tabs, file.id],
            activeFileId: file.id,
          }
        : pane
    )));
    setFileHistories((current) => (
      current[file.id]
        ? current
        : {
            ...current,
            [file.id]: {
              past: [],
              present: file.content || "",
              future: [],
            },
          }
    ));
    setSelectedPathsByFile((current) => (
      current[file.id] ? current : { ...current, [file.id]: [] }
    ));
    setActiveFileId(file.id);
    setActivePaneId(targetPaneId);
    setSelectedProjectId(file.id);

    if (fileKind === "visual-template") {
      const model = parseVisualTemplateModel(file.content || "");
      loadVisualTemplateModel({
        ...model,
        artifactType: file.ditaType === "visual-template-binding" ? "binding" : model.artifactType,
        filePath: file.githubPath || getProjectFilePath(projectTree, file.id) || model.filePath || "",
      });
      setExplorerSystemMessage(`Opened visual template ${file.name}`, "info", { open: false });
      return;
    }

    if (fileKind === "xml") {
      const { doc } = parseXml(file.content || "");
      const filePath = getProjectFilePath(projectTree, file.id);
      const brokenReferences = Object.values(
        collectHrefValidationStates(doc, filePath, projectTree),
      ).filter((validation) => validation.status === "invalid");

      setExplorerSystemMessage(
        file.draftLoaded
          ? `Opened ${file.name} from saved Postgres draft.`
          : file.githubConvertedFromJson
          ? `Opened ${file.name}. Converted saved editor JSON into DITA XML for editing.`
          : brokenReferences.length
          ? `Opened ${file.name}. ${brokenReferences.length} broken href reference${brokenReferences.length === 1 ? "" : "s"} found.`
          : `Opened ${file.name}`,
        brokenReferences.length ? "warning" : "info",
        { open: false },
      );
      return;
    }

    setExplorerSystemMessage(fileKind === "image" ? `Opened image ${file.name}` : `Opened ${file.name}`, "info", { open: false });
  }

  function showValidationRun(run: ValidationRun, preferredTab: "problems" | "output" = run.issues.length ? "problems" : "output") {
    setValidationRuns((current) => [run, ...current.filter((item) => item.fileId !== run.fileId)].slice(0, 12));
    setActiveValidationRunId(run.id);
    if (run.status !== "valid" || run.issues.length > 0) {
      setBottomPanelTab(preferredTab);
      setBottomPanelOpen(true);
    }
  }

  function closeValidationRun(runId: string) {
    setValidationRuns((current) => {
      const nextRuns = current.filter((run) => run.id !== runId);
      const closedActiveRun = activeValidationRunId === runId;

      if (closedActiveRun) {
        setActiveValidationRunId(nextRuns[0]?.id || null);
      }
      if (!nextRuns.length) {
        setBottomPanelTab("output");
      }

      return nextRuns;
    });
  }

  function openValidationProblem(problem) {
    const targetPath = problem.file || problem.fallbackFilePath;
    const targetFile = targetPath ? findProjectFileByPath(projectTree, targetPath) : null;
    const targetFileId = targetFile?.id || problem.fileId;

    if (targetFileId) {
      openProjectFile(targetFileId);
    }
    if (problem.line) {
      setMode("source");
    }
  }

  async function validateActiveDitaDocument() {
    if (!activeFile || activeFile.type !== "file") return;

    const validatedAt = new Date().toLocaleString();
    const targetFile = activeFile.generated && activeFile.sourceFileId
      ? findProjectNode(projectTree, activeFile.sourceFileId)?.node || activeFile
      : activeFile;
    const targetFileKind = getProjectFileKind(targetFile);
    const targetFilePath = getProjectFilePath(projectTree, targetFile.id);

    if (targetFileKind !== "xml") {
      const reportContent = [
        `Validation report: ${targetFile.name}`,
        `Validated: ${validatedAt}`,
        "Status: Not a DITA/XML document",
        "",
        "Only DITA, DITA map, and XML files can be validated with DITA-OT.",
      ].join("\n");
      const runId = `validation-${targetFile.id}-${Date.now()}`;
      showValidationRun({
        id: runId,
        fileId: targetFile.id,
        fileName: targetFile.name,
        filePath: targetFilePath || targetFile.name,
        status: "error",
        validatedAt,
        report: reportContent,
        output: "",
        issues: [{
          level: "error",
          file: targetFilePath || targetFile.name,
          message: "Only DITA, DITA map, and XML files can be validated with DITA-OT.",
        }],
      });
      const validationState = {
        status: "error" as const,
        message: "Only DITA/XML files can be validated.",
        runId,
        validatedAt,
      };
      setValidationByFile((current) => ({
        ...current,
        [targetFile.id]: validationState,
      }));
      setLastValidation(validationState);
      pushNotification({
        severity: "error",
        title: "Invalid Validation Target",
        body: `${targetFile.name} is not a DITA, DITA map, or XML file.`,
        persistent: false,
        source: "Validation",
      });
      return;
    }

    const validatingState = {
      status: "validating" as const,
      message: "Validating with DITA-OT...",
      validatedAt,
    };
    const entry = targetFilePath || targetFile.name;
    setValidationByFile((current) => ({
      ...current,
      [targetFile.id]: validatingState,
    }));
    setLastValidation(validatingState);

    try {
      const response = await fetch(`${backendBaseUrl}/api/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry,
          sessionId: validationSessionId,
          files: collectValidationFiles(projectTree, fileHistories),
          specializations: activeSpecializationDefinitions,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Validation request failed.");
      }

      const reportContent = createValidationReportContent({
        fileName: targetFile.name,
        filePath: entry,
        result,
        validatedAt,
      });
      const isValid = Boolean(result.ok);
      const issues = Array.isArray(result.issues) ? result.issues : [];
      const runId = `validation-${targetFile.id}-${Date.now()}`;
      showValidationRun({
        id: runId,
        fileId: targetFile.id,
        fileName: targetFile.name,
        filePath: entry,
        status: isValid ? "valid" : "invalid",
        validatedAt,
        report: reportContent,
        output: String(result.output || ""),
        issues,
      });
      const issueCount = issues.length;
      const firstIssue = issues[0];
      const firstIssueLocation = firstIssue
        ? [firstIssue.file, firstIssue.line ? `line ${firstIssue.line}` : ""].filter(Boolean).join(", ")
        : "";
      const validationState = {
        status: isValid ? "valid" as const : "invalid" as const,
        message: isValid
          ? "DITA-OT validation passed."
          : firstIssue
            ? `${firstIssue.message}${firstIssueLocation ? ` (${firstIssueLocation})` : ""}`
            : `${issueCount || "DITA-OT"} validation issue${issueCount === 1 ? "" : "s"} found.`,
        runId,
        validatedAt,
      };

      setValidationByFile((current) => ({
        ...current,
        [targetFile.id]: validationState,
      }));
      setLastValidation(validationState);
      setExplorerSystemMessage(isValid ? `Validation passed for ${targetFile.name}` : `Validation failed for ${targetFile.name}`, isValid ? "info" : "error");
      pushNotification({
        severity: isValid ? "info" : "error",
        title: isValid ? "Schema Validation Passed" : "Invalid Schema",
        body: isValid
          ? `${targetFile.name} is valid according to DITA-OT.`
          : validationState.message,
        persistent: false,
        source: targetFile.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Validation failed.";
      const reportContent = [
        `Validation report: ${targetFile.name}`,
        `Validated: ${validatedAt}`,
        `Entry: ${entry}`,
        "Status: Validation service error",
        "",
        message,
      ].join("\n");
      const runId = `validation-${targetFile.id}-${Date.now()}`;
      showValidationRun({
        id: runId,
        fileId: targetFile.id,
        fileName: targetFile.name,
        filePath: entry,
        status: "error",
        validatedAt,
        report: reportContent,
        output: message,
        issues: [{
          level: "error",
          file: entry,
          message,
        }],
      });
      const validationState = {
        status: "error" as const,
        message,
        runId,
        validatedAt,
      };

      setValidationByFile((current) => ({
        ...current,
        [targetFile.id]: validationState,
      }));
      setLastValidation(validationState);
      setExplorerSystemMessage(`Validation service error: ${message}`, "error");
      pushNotification({
        severity: "error",
        title: "Validation Service Error",
        body: message,
        persistent: false,
        source: targetFile.name,
      });
    }
  }

  function openSearchResult(result: SearchResult) {
    const file = findProjectNode(projectTree, result.fileId)?.node;

    openProjectFile(result.fileId);
    if (result.kind === "text" && getProjectFileKind(file) === "xml") {
      setMode("source");
    }
  }

  function replaceInOpenedDocuments() {
    const query = searchQuery.trim();
    if (!query || replaceMatchCount === 0) return;

    const changes = replaceTargetFileIds.flatMap((fileId) => {
      const file = findProjectNode(projectTree, fileId)?.node;
      if (!file || file.type !== "file") return [];

      const fileKind = getProjectFileKind(file);
      const currentHistory = fileHistories[fileId] || {
        past: [],
        present: file.content || "",
        future: [],
      };
      const result = replaceEditableContent(
        fileKind,
        currentHistory.present,
        query,
        replaceText,
        replaceCaseSensitive,
      );

      return result.count && result.content !== currentHistory.present
        ? [{ fileId, currentHistory, content: result.content, count: result.count }]
        : [];
    });

    const replacements = changes.reduce((total, change) => total + change.count, 0);
    if (!replacements) return;

    setFileHistories((current) => {
      const nextHistories = { ...current };

      changes.forEach((change) => {
        const latestHistory = current[change.fileId] || change.currentHistory;
        nextHistories[change.fileId] = {
          past: [...latestHistory.past.slice(-(maxHistoryEntries - 1)), latestHistory.present],
          present: change.content,
          future: [],
        };
      });

      return nextHistories;
    });

    sourceEditBaseRef.current = null;
    setExplorerSystemMessage(
      `Replaced ${replacements} match${replacements === 1 ? "" : "es"} in ${changes.length} open document${changes.length === 1 ? "" : "s"}.`,
    );
  }

  function createFolder() {
    const folder = selectedContainer;
    if (!folder || folder.type !== "folder") return;

    const name = makeUniqueName(newItemName.trim() || "new-folder", folder.children);
    const folderNode = {
      id: `folder-${Date.now().toString(36)}`,
      type: "folder",
      name,
      children: [],
    };

    setProjectTree((tree) => updateProjectNode(tree, folder.id, (node) => ({
      ...node,
      children: [...node.children, folderNode],
    })));
    setSelectedProjectId(folderNode.id);
    setExplorerSystemMessage(`Created folder ${name}`);
  }

  function createFile() {
    const folder = selectedContainer;
    if (!folder || folder.type !== "folder") return;

    const fileName = makeUniqueName(normalizeFileName(newItemName, newItemType), folder.children);
    const isImageFile = newItemType === "image";
    const fileNode = {
      id: `file-${Date.now().toString(36)}`,
      type: "file",
      name: fileName,
      ditaType: newItemType,
      content: createGenericFileContent(newItemType, fileName),
      previewHref: isImageFile ? sampleImagePreviewUrl : undefined,
      checkedInAt: "Not checked in",
    };

    setProjectTree((tree) => updateProjectNode(tree, folder.id, (node) => ({
      ...node,
      children: [...node.children, fileNode],
    })));
    setTabPanes((panes) => panes.map((pane) => (
      pane.id === activePaneId
        ? { ...pane, tabs: [...pane.tabs, fileNode.id], activeFileId: fileNode.id }
        : pane
    )));
    setActiveFileId(fileNode.id);
    setActivePaneId(activePaneId);
    setSelectedProjectId(fileNode.id);
    loadXmlIntoEditor(fileNode.content || "", fileNode.id);
    setExplorerSystemMessage(`Created ${fileName}`);
  }

  function getExplorerTargetFolderId(nodeId = selectedProjectId) {
    const match = findProjectNode(projectTree, nodeId);
    if (!match) return "root";

    return match.node.type === "folder" ? match.node.id : match.parent?.id || "root";
  }

  function openFileTypePicker(event, nodeId = selectedProjectId) {
    const rect = event.currentTarget.getBoundingClientRect();
    setFileTypePicker({
      x: rect.left,
      y: rect.bottom + 4,
      folderId: getExplorerTargetFolderId(nodeId),
    });
  }

  function createExplorerFile(typeKey = "topic", folderId = getExplorerTargetFolderId()) {
    const folder = findProjectNode(projectTree, folderId)?.node;
    if (!folder || folder.type !== "folder") return;

    const fileName = makeUniqueName(normalizeFileName(getDefaultFileStem(typeKey), typeKey), folder.children);
    const fileType = typeKey;
    const githubPath = getGitHubChildPath(folder, fileName);
    if (fileType === "visual-template") {
      setVisualTemplateCreationTarget({
        folderId: folder.id,
        fileName,
        filePath: githubPath || fileName,
      });
      setVisualTemplatePickerMode("create");
      setFileTypePicker(null);
      return;
    }

    const isImageFile = fileType === "image";
    const fileNode = {
      id: `file-${Date.now().toString(36)}`,
      type: "file",
      name: fileName,
      ditaType: fileType,
      content: createGenericFileContent(fileType, fileName),
      previewHref: isImageFile ? sampleImagePreviewUrl : undefined,
      checkedInAt: "Not checked in",
      githubPath: githubPath || undefined,
      githubSha: githubPath ? "" : undefined,
      githubLoaded: Boolean(githubPath),
    };

    setProjectTree((tree) => updateProjectNode(tree, folder.id, (node) => ({
      ...node,
      children: [...node.children, fileNode],
    })));
    setTabPanes((panes) => panes.map((pane) => (
      pane.id === activePaneId
        ? { ...pane, tabs: [...pane.tabs, fileNode.id], activeFileId: fileNode.id }
        : pane
    )));
    setActiveFileId(fileNode.id);
    setSelectedProjectId(fileNode.id);
    setEditingProjectNodeId(fileNode.id);
    loadXmlIntoEditor(fileNode.content || "", fileNode.id);
    if (fileType === "visual-template") {
      loadVisualTemplateModel({
        ...parseVisualTemplateModel(fileNode.content || ""),
        filePath: githubPath || "",
      });
    }
    setFileTypePicker(null);
    setExplorerSystemMessage(`Created ${fileName}`);

    if (isAuthenticated && fileNode.githubPath) {
      void (async () => {
        try {
          const response = await fetch(`${backendBaseUrl}/api/drafts/github`, {
            method: "PUT",
            headers: {
              ...(await getBackendAuthHeaders()),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              filePath: fileNode.githubPath,
              githubSha: fileNode.githubSha || "",
              sourceContentHash: "",
              contentFormat: getProjectFileKind(fileNode),
              content: fileNode.content || "",
            }),
          });
          const body = await response.json();

          if (!response.ok) {
            throw new Error(body.error || "Could not save new file draft.");
          }

          lastSavedDraftRef.current = `${fileNode.githubPath}\n${fileNode.githubSha || ""}\n${fileNode.content || ""}`;
          setProjectTree((currentTree) => updateProjectNode(currentTree, fileNode.id, (node) => ({
            ...node,
            draftSavedAt: body.draft?.saved_at || new Date().toISOString(),
            draftDirty: Boolean(body.draft?.dirty),
            draftContentHash: body.draft?.draft_content_hash || node.draftContentHash || "",
            sourceContentHash: body.draft?.source_content_hash || node.sourceContentHash || "",
          })));
        } catch (error) {
          setDraftSaveState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not save new file draft.",
          });
        }
      })();
    }
  }

  function createExplorerVisualTemplateFile(template, target = visualTemplateCreationTarget) {
    if (!target) return;

    const folder = findProjectNode(projectTree, target.folderId)?.node;
    if (!folder || folder.type !== "folder") return;

    const templateName = target.fileName.replace(/\.[^./]+$/i, "").replace(/[-_]+/g, " ");
    const templateId = `template-${slugifyWorkspaceArtifactName(templateName) || Date.now().toString(36)}`;
    const nextModel = normalizeVisualTemplateModel({
      ...defaultVisualTemplateModel,
      artifactType: "template",
      id: templateId,
      name: templateName || template.name || "Visual template",
      template: {
        id: templateId,
        name: templateName || template.name || "Visual template",
        source: template.source || "workspace",
      },
      filePath: target.filePath,
      regions: template.regions || [],
    });
    const content = JSON.stringify(nextModel, null, 2);
    const fileNode = {
      id: `file-${Date.now().toString(36)}`,
      type: "file",
      name: target.fileName,
      ditaType: "visual-template",
      content,
      checkedInAt: "Not checked in",
      githubPath: target.filePath || undefined,
      githubSha: target.filePath ? "" : undefined,
      githubLoaded: Boolean(target.filePath),
    };

    setProjectTree((tree) => updateProjectNode(tree, folder.id, (node) => ({
      ...node,
      children: [...node.children, fileNode],
    })));
    setFileHistories((current) => ({
      ...current,
      [fileNode.id]: {
        past: [],
        present: content,
        future: [],
      },
    }));
    setTabPanes((panes) => panes.map((pane) => (
      pane.id === activePaneId
        ? { ...pane, tabs: [...pane.tabs, fileNode.id], activeFileId: fileNode.id }
        : pane
    )));
    setActiveFileId(fileNode.id);
    setSelectedProjectId(fileNode.id);
    setEditingProjectNodeId(fileNode.id);
    loadVisualTemplateModel(nextModel);
    setVisualTemplateSourceId(null);
    setVisualTemplateCreationTarget(null);
    setFileTypePicker(null);
    setExplorerSystemMessage(`Created ${target.fileName}`);

    if (isAuthenticated && fileNode.githubPath) {
      void (async () => {
        try {
          const response = await fetch(`${backendBaseUrl}/api/drafts/github`, {
            method: "PUT",
            headers: {
              ...(await getBackendAuthHeaders()),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              filePath: fileNode.githubPath,
              githubSha: "",
              sourceContentHash: "",
              contentFormat: "visual-template",
              content,
            }),
          });
          const body = await response.json();

          if (!response.ok) {
            throw new Error(body.error || "Could not save visual template draft.");
          }

          setProjectTree((currentTree) => updateProjectNode(currentTree, fileNode.id, (node) => ({
            ...node,
            draftSavedAt: body.draft?.saved_at || new Date().toISOString(),
            draftDirty: Boolean(body.draft?.dirty),
            draftContentHash: body.draft?.draft_content_hash || node.draftContentHash || "",
            sourceContentHash: body.draft?.source_content_hash || node.sourceContentHash || "",
          })));
        } catch (error) {
          setDraftSaveState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not save visual template draft.",
          });
        }
      })();
    }
  }

  function createExplorerFolder(folderId = getExplorerTargetFolderId()) {
    const folder = findProjectNode(projectTree, folderId)?.node;
    if (!folder || folder.type !== "folder") return;

    const name = makeUniqueName("New Folder", folder.children);
    const githubPath = getGitHubChildPath(folder, name);
    const folderNode = {
      id: `folder-${Date.now().toString(36)}`,
      type: "folder",
      name,
      children: [],
      githubPath: githubPath || undefined,
      githubLoaded: Boolean(githubPath),
    };

    setProjectTree((tree) => updateProjectNode(tree, folder.id, (node) => ({
      ...node,
      children: [...node.children, folderNode],
    })));
    setSelectedProjectId(folderNode.id);
    setEditingProjectNodeId(folderNode.id);
    setExplorerSystemMessage(`Created folder ${name}`);
  }

  function createAiReviewSampleFile() {
    const sampleFileName = "ai-review-sample.dita";
    const sampleFileId = "file-ai-review-sample";
    const targetFolderId = selectedContainer?.type === "folder" ? selectedContainer.id : projectTree.id;
    const fileNode = {
      id: sampleFileId,
      type: "file",
      name: sampleFileName,
      ditaType: "concept",
      content: aiReviewSampleXml,
      checkedInAt: "Local AI test fixture",
      githubLoaded: true,
    };
    const isAiReviewSample = (node) => node.type === "file" && /^ai-review-sample(?:-\d+)?\.dita$/i.test(node.name);
    const removeOldSamples = (node) => {
      if (node.type !== "folder") return node;

      return {
        ...node,
        children: node.children
          .filter((child) => !isAiReviewSample(child))
          .map(removeOldSamples),
      };
    };

    setProjectTree((tree) => {
      const cleanedTree = removeOldSamples(tree);
      const targetExists = findProjectNode(cleanedTree, targetFolderId)?.node?.type === "folder";
      const insertFolderId = targetExists ? targetFolderId : cleanedTree.id;

      return updateProjectNode(cleanedTree, insertFolderId, (node) => ({
        ...node,
        children: [...node.children, fileNode],
      }));
    });
    setTabPanes((panes) => panes.map((pane) => (
      pane.id === activePaneId
        ? {
            ...pane,
            tabs: [...pane.tabs.filter((fileId) => !String(fileId).startsWith("file-ai-review-sample")), fileNode.id],
            activeFileId: fileNode.id,
          }
        : {
            ...pane,
            tabs: pane.tabs.filter((fileId) => !String(fileId).startsWith("file-ai-review-sample")),
          }
    )));
    setActiveFileId(fileNode.id);
    setSelectedProjectId(fileNode.id);
    setSelectedPathsByFile((current) => ({ ...current, [fileNode.id]: [] }));
    loadXmlIntoEditor(fileNode.content, fileNode.id);
    setActiveSidePanel("aiReview");
    setExplorerSystemMessage(`Created local ${sampleFileName} for AI Review testing.`);
  }

  function changeNewItemType(typeKey: string) {
    setNewItemType(typeKey);
    setNewItemName((currentName) => {
      if (currentName.trim() && !isDefaultFileStem(currentName)) {
        return currentName;
      }

      return getDefaultFileStem(typeKey);
    });
  }

  function renameSelectedProjectItem() {
    if (!selectedProjectNode || selectedProjectNode.id === "root") return;

    const parent = selectedProject.parent;
    const oldPath = getProjectFilePath(projectTree, selectedProjectNode.id);
    const parentPath = getProjectFilePath(projectTree, parent.id);
    const normalized = selectedProjectNode.type === "file"
      ? isDitaDocumentType(selectedProjectNode.ditaType)
        ? normalizeFileName(newItemName, selectedProjectNode.ditaType || newItemType)
        : normalizeAssetFileName(newItemName, selectedProjectNode.name)
      : (newItemName.trim() || selectedProjectNode.name);
    const name = makeUniqueName(normalized, parent.children, selectedProjectNode.id);
    const newPath = normalizeProjectPath(`${parentPath}/${name}`);

    const renamedTree = updateProjectNode(projectTree, selectedProjectNode.id, (node) => ({
      ...node,
      name,
    }));
    const { tree: nextTree, rewrittenCount } = rewriteProjectReferencesForMovedPath(renamedTree, oldPath, newPath);

    setProjectTree(nextTree);
    setFileHistories((current) => {
      let changed = false;
      const nextHistories = { ...current };

      openTabs.forEach((tab) => {
        const file = findProjectNode(nextTree, tab.fileId)?.node;
        if (!file?.content || file.content === current[tab.fileId]?.present) return;

        changed = true;
        nextHistories[tab.fileId] = {
          past: [],
          present: file.content,
          future: [],
        };
      });

      return changed ? nextHistories : current;
    });

    setExplorerSystemMessage(
      rewrittenCount
        ? `Renamed to ${name} and updated ${rewrittenCount} href${rewrittenCount === 1 ? "" : "s"}.`
        : `Renamed to ${name}`,
    );
  }

  function renameProjectItemById(nodeId) {
    const match = findProjectNode(projectTree, nodeId);
    if (!match || match.node.id === "root" || !match.parent) return;

    setSelectedProjectId(nodeId);
    setEditingProjectNodeId(nodeId);
  }

  function commitProjectItemRename(nodeId, enteredName) {
    const match = findProjectNode(projectTree, nodeId);
    if (!match || match.node.id === "root" || !match.parent) {
      setEditingProjectNodeId(null);
      return;
    }

    if (!enteredName?.trim()) {
      setEditingProjectNodeId(null);
      return;
    }

    const oldPath = getProjectFilePath(projectTree, match.node.id);
    const parentPath = getProjectFilePath(projectTree, match.parent.id);
    const normalized = match.node.type === "file"
      ? isDitaDocumentType(match.node.ditaType)
        ? normalizeFileName(enteredName, match.node.ditaType || inferProjectFileType(match.node.name))
        : normalizeAssetFileName(enteredName, match.node.name)
      : enteredName.trim();
    const name = makeUniqueName(normalized, match.parent.children, match.node.id);
    const newPath = normalizeProjectPath(`${parentPath}/${name}`);
    const newGitHubPath = getGitHubChildPath(match.parent, name);
    const renamedTree = updateProjectNode(projectTree, match.node.id, (node) => ({
      ...(newGitHubPath ? rebaseGitHubPath(node, newGitHubPath) : node),
      name,
    }));
    const { tree: nextTree, rewrittenCount } = rewriteProjectReferencesForMovedPath(renamedTree, oldPath, newPath);

    setProjectTree(nextTree);
    setFileHistories((current) => {
      let changed = false;
      const nextHistories = { ...current };

      openTabs.forEach((tab) => {
        const file = findProjectNode(nextTree, tab.fileId)?.node;
        if (!file?.content || file.content === current[tab.fileId]?.present) return;

        changed = true;
        nextHistories[tab.fileId] = {
          past: [],
          present: file.content,
          future: [],
        };
      });

      return changed ? nextHistories : current;
    });
    setSelectedProjectId(match.node.id);
    setExplorerSystemMessage(
      rewrittenCount
        ? `Renamed to ${name} and updated ${rewrittenCount} href${rewrittenCount === 1 ? "" : "s"}.`
        : `Renamed to ${name}`,
    );
    setEditingProjectNodeId(null);
  }

  function copySelectedProjectItem() {
    if (!selectedProjectNode || selectedProjectNode.id === "root") return;

    const parent = selectedProject.parent;
    const clone = cloneProjectNode(selectedProjectNode);
    clone.name = makeUniqueName(`Copy of ${selectedProjectNode.name}`, parent.children);

    setProjectTree((tree) => updateProjectNode(tree, parent.id, (node) => ({
      ...node,
      children: [...node.children, clone],
    })));
    setSelectedProjectId(clone.id);
    setExplorerSystemMessage(`Copied ${selectedProjectNode.name}`);
  }

  function copyProjectItemById(nodeId) {
    const match = findProjectNode(projectTree, nodeId);
    if (!match || match.node.id === "root" || !match.parent) return;

    const clone = cloneProjectNode(match.node);
    clone.name = makeUniqueName(`Copy of ${match.node.name}`, match.parent.children);

    setProjectTree((tree) => updateProjectNode(tree, match.parent.id, (node) => ({
      ...node,
      children: [...node.children, clone],
    })));
    setSelectedProjectId(clone.id);
    setExplorerSystemMessage(`Copied ${match.node.name}`);
  }

  async function deleteProjectPathFromDatabase(projectPath: string, label: string) {
    const response = await fetch(`${backendBaseUrl}/api/projects/path`, {
      method: "DELETE",
      headers: {
        ...(await getBackendAuthHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: projectPath }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || `Could not delete ${label} from Postgres.`);
    }

    appendTerminalMessage(
      `Marked ${label} as deleted in Postgres (${body.softDeletedProjectFiles || 0} metadata rows, ${body.softDeletedDrafts || 0} drafts).`,
      { source: "EXPLORER", level: "info" },
    );

    return body;
  }

  async function deleteSelectedProjectItem() {
    if (!selectedProjectNode || selectedProjectNode.id === "root") return;

    const selectedProjectPath = getProjectFilePath(projectTree, selectedProjectNode.id);
    const blockingReferences = findReferencesTargetingProjectPath(projectTree, selectedProjectPath).filter((reference) => {
      const sourcePath = normalizeProjectPath(reference.sourcePath);
      const targetPath = normalizeProjectPath(selectedProjectPath);
      return sourcePath !== targetPath && !sourcePath.startsWith(`${targetPath}/`);
    });

    if (blockingReferences.length > 0) {
      setExplorerSystemMessage(
        `Cannot delete ${selectedProjectNode.name}; it is referenced by ${getReferenceSourceSummary(blockingReferences)}.`,
        "warning",
      );
      return;
    }

    let deleteResult: any = null;

    try {
      deleteResult = await deleteProjectPathFromDatabase(selectedProjectPath, selectedProjectNode.name);
    } catch (error) {
      setExplorerSystemMessage(error.message, "warning");
      appendTerminalMessage(error.message, { source: "EXPLORER", level: "error", open: true });
      return;
    }

    if (selectedProjectNode.type === "file" && selectedProjectNode.githubPath && selectedProjectNode.githubSha) {
      const nextTree = updateProjectNode(projectTree, selectedProjectNode.id, (node) => ({
        ...node,
        deletedAt: deleteResult?.deletedAt || new Date().toISOString(),
        draftDirty: true,
      }));
      const deletedFileIds = new Set([selectedProjectNode.id]);
      const nextVisibleFile = findFirstVisibleFile(nextTree);
      const nextPanes = tabPanes.map((pane) => {
        const nextTabs = pane.tabs.filter((fileId) => !deletedFileIds.has(fileId));
        return {
          ...pane,
          tabs: nextTabs,
          activeFileId: deletedFileIds.has(pane.activeFileId) ? nextTabs[0] || null : pane.activeFileId,
        };
      }).filter((pane) => pane.tabs.length > 0);
      const safePanes = nextPanes.length
        ? nextPanes
        : nextVisibleFile
          ? [{ id: "pane-left", label: "Left", tabs: [nextVisibleFile.id], activeFileId: nextVisibleFile.id }]
          : [];
      const fallbackPane = safePanes.find((pane) => pane.id === activePaneId) || safePanes[0];
      const fallbackActiveFileId = fallbackPane?.activeFileId || nextVisibleFile?.id;

      setProjectTree(nextTree);
      setTabPanes(safePanes);
      setFileHistories((current) => {
        const nextHistories = { ...current };
        deletedFileIds.forEach((id) => delete nextHistories[id]);
        return nextHistories;
      });
      setSelectedPathsByFile((current) => {
        const nextPaths = { ...current };
        deletedFileIds.forEach((id) => delete nextPaths[id]);
        return nextPaths;
      });
      setSelectedProjectId(fallbackActiveFileId || nextVisibleFile?.id || "root");
      setSelectedGitCommitFileIds((currentIds) => new Set(currentIds).add(selectedProjectNode.id));
      setExplorerSystemMessage(`Marked ${selectedProjectNode.name} for deletion`);
      if (deletedFileIds.has(activeFileId) && fallbackActiveFileId) {
        setActivePaneId(fallbackPane?.id || "pane-left");
        setActiveFileId(fallbackActiveFileId);
      }
      return;
    }

    const deletedActiveFile = selectedProjectNode.id === activeFileId ||
      (selectedProjectNode.type === "folder" && Boolean(findProjectNode(selectedProjectNode, activeFileId)));
    const deletedFileIds = collectProjectFileIds(selectedProjectNode);
    const nextTree = removeProjectNode(projectTree, selectedProjectNode.id);
    const nextFile = findFirstFile(nextTree);
    const nextPanes = tabPanes.map((pane) => {
      const nextTabs = pane.tabs.filter((fileId) => !deletedFileIds.has(fileId));
      return {
        ...pane,
        tabs: nextTabs,
        activeFileId: deletedFileIds.has(pane.activeFileId) ? nextTabs[0] || null : pane.activeFileId,
      };
    }).filter((pane) => pane.tabs.length > 0);
    const safePanes = nextPanes.length
      ? nextPanes
      : nextFile
        ? [{ id: "pane-left", label: "Left", tabs: [nextFile.id], activeFileId: nextFile.id }]
        : [];
    const fallbackPane = safePanes.find((pane) => pane.id === activePaneId) || safePanes[0];
    const fallbackActiveFileId = fallbackPane?.activeFileId || nextFile?.id;

    setProjectTree(nextTree);
    setTabPanes(safePanes);
    setFileHistories((current) => {
      const nextHistories = { ...current };
      deletedFileIds.forEach((id) => delete nextHistories[id]);

      if (nextFile && !nextHistories[nextFile.id]) {
        nextHistories[nextFile.id] = {
          past: [],
          present: nextFile.content,
          future: [],
        };
      }

      return nextHistories;
    });
    setSelectedPathsByFile((current) => {
      const nextPaths = { ...current };
      deletedFileIds.forEach((id) => delete nextPaths[id]);

      if (nextFile && !nextPaths[nextFile.id]) {
        nextPaths[nextFile.id] = [];
      }

      return nextPaths;
    });
    setSelectedProjectId(fallbackActiveFileId || nextFile?.id || "root");
    setExplorerSystemMessage(`Deleted ${selectedProjectNode.name}`);

    if (deletedActiveFile && fallbackActiveFileId) {
      setActivePaneId(fallbackPane?.id || "pane-left");
      setActiveFileId(fallbackActiveFileId);
    }
  }

  async function deleteProjectItemById(nodeId) {
    const match = findProjectNode(projectTree, nodeId);
    if (!match || match.node.id === "root") return;

    const selectedProjectPath = getProjectFilePath(projectTree, match.node.id);
    const blockingReferences = findReferencesTargetingProjectPath(projectTree, selectedProjectPath).filter((reference) => {
      const sourcePath = normalizeProjectPath(reference.sourcePath);
      const targetPath = normalizeProjectPath(selectedProjectPath);
      return sourcePath !== targetPath && !sourcePath.startsWith(`${targetPath}/`);
    });

    if (blockingReferences.length > 0) {
      setExplorerSystemMessage(
        `Cannot delete ${match.node.name}; it is referenced by ${getReferenceSourceSummary(blockingReferences)}.`,
        "warning",
      );
      return;
    }

    let deleteResult: any = null;

    try {
      deleteResult = await deleteProjectPathFromDatabase(selectedProjectPath, match.node.name);
    } catch (error) {
      setExplorerSystemMessage(error.message, "warning");
      appendTerminalMessage(error.message, { source: "EXPLORER", level: "error", open: true });
      return;
    }

    if (match.node.type === "file" && match.node.githubPath && match.node.githubSha) {
      const nextTree = updateProjectNode(projectTree, match.node.id, (node) => ({
        ...node,
        deletedAt: deleteResult?.deletedAt || new Date().toISOString(),
        draftDirty: true,
      }));
      const deletedFileIds = new Set([match.node.id]);
      const nextVisibleFile = findFirstVisibleFile(nextTree);
      const nextPanes = tabPanes.map((pane) => {
        const nextTabs = pane.tabs.filter((fileId) => !deletedFileIds.has(fileId));
        return {
          ...pane,
          tabs: nextTabs,
          activeFileId: deletedFileIds.has(pane.activeFileId) ? nextTabs[0] || null : pane.activeFileId,
        };
      }).filter((pane) => pane.tabs.length > 0);
      const safePanes = nextPanes.length
        ? nextPanes
        : nextVisibleFile
          ? [{ id: "pane-left", label: "Left", tabs: [nextVisibleFile.id], activeFileId: nextVisibleFile.id }]
          : [];
      const fallbackPane = safePanes.find((pane) => pane.id === activePaneId) || safePanes[0];
      const fallbackActiveFileId = fallbackPane?.activeFileId || nextVisibleFile?.id;

      setProjectTree(nextTree);
      setTabPanes(safePanes);
      setFileHistories((current) => {
        const nextHistories = { ...current };
        deletedFileIds.forEach((id) => delete nextHistories[id]);
        return nextHistories;
      });
      setSelectedPathsByFile((current) => {
        const nextPaths = { ...current };
        deletedFileIds.forEach((id) => delete nextPaths[id]);
        return nextPaths;
      });
      setSelectedProjectId(fallbackActiveFileId || nextVisibleFile?.id || "root");
      setSelectedGitCommitFileIds((currentIds) => new Set(currentIds).add(match.node.id));
      setExplorerSystemMessage(`Marked ${match.node.name} for deletion`);
      if (deletedFileIds.has(activeFileId) && fallbackActiveFileId) {
        setActivePaneId(fallbackPane?.id || "pane-left");
        setActiveFileId(fallbackActiveFileId);
      }
      return;
    }

    const deletedActiveFile = match.node.id === activeFileId ||
      (match.node.type === "folder" && Boolean(findProjectNode(match.node, activeFileId)));
    const deletedFileIds = collectProjectFileIds(match.node);
    const nextTree = removeProjectNode(projectTree, match.node.id);
    const nextFile = findFirstFile(nextTree);
    const nextPanes = tabPanes.map((pane) => {
      const nextTabs = pane.tabs.filter((fileId) => !deletedFileIds.has(fileId));
      return {
        ...pane,
        tabs: nextTabs,
        activeFileId: deletedFileIds.has(pane.activeFileId) ? nextTabs[0] || null : pane.activeFileId,
      };
    }).filter((pane) => pane.tabs.length > 0);
    const safePanes = nextPanes.length
      ? nextPanes
      : nextFile
        ? [{ id: "pane-left", label: "Left", tabs: [nextFile.id], activeFileId: nextFile.id }]
        : [];
    const fallbackPane = safePanes.find((pane) => pane.id === activePaneId) || safePanes[0];
    const fallbackActiveFileId = fallbackPane?.activeFileId || nextFile?.id;

    setProjectTree(nextTree);
    setTabPanes(safePanes);
    setFileHistories((current) => {
      const nextHistories = { ...current };
      deletedFileIds.forEach((id) => delete nextHistories[id]);
      return nextHistories;
    });
    setSelectedPathsByFile((current) => {
      const nextPaths = { ...current };
      deletedFileIds.forEach((id) => delete nextPaths[id]);
      return nextPaths;
    });
    setSelectedProjectId(fallbackActiveFileId || nextFile?.id || "root");
    setExplorerSystemMessage(`Deleted ${match.node.name}`);

    if (deletedActiveFile && fallbackActiveFileId) {
      setActivePaneId(fallbackPane?.id || "pane-left");
      setActiveFileId(fallbackActiveFileId);
    }
  }

  function checkInProjectFileById(nodeId) {
    const file = findProjectNode(projectTree, nodeId)?.node;
    if (!file || file.type !== "file") return;

    const checkedInAt = new Date().toLocaleString();
    const content = fileHistories[file.id]?.present ?? file.content ?? "";
    setProjectTree((tree) => updateProjectNode(tree, file.id, (node) => ({
      ...node,
      content,
      checkedInAt,
    })));
    setExplorerSystemMessage(`Checked in ${file.name}`);
  }

  function moveProjectItem(sourceId, targetId, placement = "inside") {
    const result = moveProjectNodeInTree(projectTree, sourceId, targetId, placement);
    if (!result.moved) return;

    const { tree: nextTree, rewrittenCount } = result.oldPath && result.newPath
      ? rewriteProjectReferencesForMovedPath(result.tree, result.oldPath, result.newPath)
      : { tree: result.tree, rewrittenCount: 0 };
    const movedNode = findProjectNode(nextTree, sourceId)?.node;

    setProjectTree(nextTree);
    setFileHistories((current) => {
      if (!rewrittenCount) return current;

      let changed = false;
      const nextHistories = { ...current };

      openTabs.forEach((tab) => {
        const file = findProjectNode(nextTree, tab.fileId)?.node;
        if (!file?.content || file.content === current[tab.fileId]?.present) return;

        changed = true;
        nextHistories[tab.fileId] = {
          past: [],
          present: file.content,
          future: [],
        };
      });

      return changed ? nextHistories : current;
    });
    setSelectedProjectId(sourceId);
    setExplorerSystemMessage(
      `${movedNode?.name || "Item"} moved${rewrittenCount ? ` and updated ${rewrittenCount} href${rewrittenCount === 1 ? "" : "s"}` : ""}.`,
    );
  }

  function checkInActiveFile() {
    if (!activeFile) return;

    const checkedInAt = new Date().toLocaleString();
    setProjectTree((tree) => updateProjectNode(tree, activeFile.id, (node) => ({
      ...node,
      content: xml,
      checkedInAt,
    })));
    setExplorerSystemMessage(`Checked in ${activeFile.name}`);
  }

  function commitXml(nextXml) {
    sourceEditBaseRef.current = null;

    if (nextXml !== xml && activeFile?.githubPath && activeIsTextEditable) {
      setDraftSaveState({
        status: "pending",
        message: `Draft changes pending for ${activeFile.name}.`,
      });
    }

    setHistory((current) => {
      if (nextXml === current.present) return current;

      return {
        past: [...current.past.slice(-(maxHistoryEntries - 1)), current.present],
        present: nextXml,
        future: [],
      };
    });
  }

  function updateSourceDraft(nextXml) {
    if (getTagSignature(nextXml) !== getTagSignature(xml)) {
      return;
    }

    setHistory((current) => {
      if (nextXml === current.present) return current;

      if (sourceEditBaseRef.current !== null) {
        return {
          ...current,
          present: nextXml,
        };
      }

      sourceEditBaseRef.current = current.present;

      return {
        past: [...current.past.slice(-(maxHistoryEntries - 1)), current.present],
        present: nextXml,
        future: [],
      };
    });
  }

  function finalizeSourceDraft() {
    sourceEditBaseRef.current = null;
  }

  function updatePlainTextDraft(nextText: string) {
    setHistory((current) => {
      if (nextText === current.present) return current;

      if (sourceEditBaseRef.current !== null) {
        return {
          ...current,
          present: nextText,
        };
      }

      sourceEditBaseRef.current = current.present;

      return {
        past: [...current.past.slice(-(maxHistoryEntries - 1)), current.present],
        present: nextText,
        future: [],
      };
    });
  }

  function undo() {
    sourceEditBaseRef.current = null;

    setHistory((current) => {
      if (current.past.length === 0) return current;

      const previous = current.past.at(-1);
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
    setContextMenu(null);
  }

  function redo() {
    sourceEditBaseRef.current = null;

    setHistory((current) => {
      if (current.future.length === 0) return current;

      const [next, ...future] = current.future;
      return {
        past: [...current.past, current.present].slice(-maxHistoryEntries),
        present: next,
        future,
      };
    });
    setContextMenu(null);
  }

  function trackVisualTextEdit(path: number[], value: string, textNodeIndex: number | null = null) {
    if (visualTextCommitTimerRef.current) {
      clearTimeout(visualTextCommitTimerRef.current);
      visualTextCommitTimerRef.current = null;
    }

    const caret = getAuthoringSelection();
    const offset = caret?.kind === "caret" &&
      pathKeyFor(caret.path) === pathKeyFor(path) &&
      caret.childNodeIndex === (textNodeIndex ?? 0) &&
      "offset" in caret
      ? caret.offset
      : value.length;

    pendingVisualEditRef.current = {
      fileId: activeFileId,
      path,
      textNodeIndex,
      value,
      offset,
    };
    if (activeFile?.githubPath && activeIsTextEditable) {
      setDraftSaveState({
        status: "pending",
        message: `Draft changes pending for ${activeFile.name}.`,
      });
    }
    scheduleSpellingCheck(path, value, textNodeIndex ?? 0);

    visualTextCommitTimerRef.current = setTimeout(() => {
      visualTextCommitTimerRef.current = null;
      commitPendingVisualTextEdit();
    }, 700);
  }

  function scheduleSpellingCheck(path: number[], value: string, textNodeIndex: number) {
    if (spellingCheckTimerRef.current) {
      clearTimeout(spellingCheckTimerRef.current);
      spellingCheckTimerRef.current = null;
    }

    const requestId = spellingRequestIdRef.current + 1;
    spellingRequestIdRef.current = requestId;
    const fileId = activeFileId;
    const sourceXml = xml;

    runSpellingCheck(requestId, fileId, sourceXml, path, value, textNodeIndex);
  }

  function runSpellingCheck(
    requestId: number,
    fileId: string | null,
    sourceXml: string,
    path: number[],
    value: string,
    textNodeIndex: number,
  ) {
    if (requestId !== spellingRequestIdRef.current) return;

    const targetPathKey = pathKeyFor(path);
    const parsedSource = parseXml(sourceXml);
    const node = parsedSource.doc ? getNodeByPath(parsedSource.doc, path) : null;
    const strippedValue = stripEditableCaretSeed(value);

    const updateTargetIssues = (targetIssues: SpellingIssue[]) => {
      if (requestId !== spellingRequestIdRef.current) return;

      setSpellingIssues((current) => [
        ...current.filter((issue) => !(
          issue.fileId === fileId &&
          issue.pathKey === targetPathKey &&
          issue.childNodeIndex === textNodeIndex
        )),
        ...targetIssues,
      ]);
    };

    if (!node || isSpellcheckSkippedElement(node.tagName)) {
      updateTargetIssues([]);
      return;
    }

    const language = resolveXmlLanguageForElement(node);
    const segment: SpellingTextSegment = {
      text: strippedValue,
      language,
      fileId,
      path,
      childNodeIndex: textNodeIndex,
    };

    checkSpellingOnBackend([segment])
      .then((issues) => {
        updateTargetIssues(filterIgnoredSpellingIssues(issues));
      })
      .catch(() => {
        updateTargetIssues(filterIgnoredSpellingIssues(
          collectSpellingIssuesForText(
            strippedValue,
            language,
            fileId,
            path,
            textNodeIndex,
          ),
        ));
      });
  }

  function clearPendingVisualTextEdit(path: number[], textNodeIndex: number | null = null) {
    const pending = pendingVisualEditRef.current;
    if (
      pending &&
      pending.fileId === activeFileId &&
      pending.textNodeIndex === textNodeIndex &&
      pathKeyFor(pending.path) === pathKeyFor(path)
    ) {
      pendingVisualEditRef.current = null;
      if (visualTextCommitTimerRef.current) {
        clearTimeout(visualTextCommitTimerRef.current);
        visualTextCommitTimerRef.current = null;
      }
    }
  }

  function commitPendingVisualTextEdit() {
    if (visualTextCommitTimerRef.current) {
      clearTimeout(visualTextCommitTimerRef.current);
      visualTextCommitTimerRef.current = null;
    }

    const pending = pendingVisualEditRef.current;
    if (!pending || pending.fileId !== activeFileId || !activeIsXml) return false;

    pendingVisualEditRef.current = null;
    const { doc, error } = parseXml(xml);
    if (error) return false;

    const node = getNodeByPath(doc, pending.path);
    if (!node) return false;

    if (pending.textNodeIndex === null) {
      if (node.textContent === pending.value) return false;
      node.textContent = pending.value;
    } else {
      const childNode = node.childNodes[pending.textNodeIndex];
      if (!childNode || childNode.nodeType !== Node.TEXT_NODE || childNode.textContent === pending.value) {
        return false;
      }
      childNode.textContent = pending.value;
    }

    pendingCaretFocusRef.current = {
      path: pending.path,
      childNodeIndex: pending.textNodeIndex ?? 0,
      offset: pending.offset ?? pending.value.length,
    };
    setPendingFocusPath(pending.path);

    flushSync(() => {
      updateXmlFromDoc(doc);
    });
    return true;
  }

  function runUndo() {
    commitPendingVisualTextEdit();
    undo();
  }

  function runRedo() {
    commitPendingVisualTextEdit();
    redo();
  }

  useEffect(() => {
    if (!pendingFocusPath || mode === "source") return;

    const focusPath = pendingFocusPath.join(".");
    const frame = requestAnimationFrame(() => {
      const pendingCaret = pendingCaretFocusRef.current;
      if (pendingCaret && pathKeyFor(pendingCaret.path) === focusPath) {
        const caretTarget = document.querySelector(
          `[data-node-path="${focusPath}"][data-text-node-index="${pendingCaret.childNodeIndex}"][contenteditable="true"]`,
        ) || document.querySelector(`[data-node-path="${focusPath}"][contenteditable="true"]`);

        if (caretTarget instanceof HTMLElement) {
          caretTarget.focus();
          setCaretByTextOffset(caretTarget, pendingCaret.offset);
          caretRef.current = getAuthoringSelection();
          pendingCaretFocusRef.current = null;
          pendingFocusPlacementRef.current = "end";
          setPendingFocusPath(null);
          return;
        }
      }

      const target = document.querySelector(
        `[data-node-path="${focusPath}"][contenteditable="true"], textarea[data-node-path="${focusPath}"], [data-node-path="${focusPath}"] [contenteditable="true"]`,
      ) || document.querySelector(`[data-node-path="${focusPath}"]`);

      if (!(target instanceof HTMLElement)) return;

      target.focus();

      if (target instanceof HTMLTextAreaElement) {
        target.setSelectionRange(target.value.length, target.value.length);
        caretRef.current = getAuthoringSelection();
        pendingFocusPlacementRef.current = "end";
        setPendingFocusPath(null);
        return;
      }

      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(pendingFocusPlacementRef.current !== "start");

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      caretRef.current = getAuthoringSelection();
      pendingFocusPlacementRef.current = "end";
      setPendingFocusPath(null);
    });

    return () => cancelAnimationFrame(frame);
  }, [mode, pendingFocusPath, xml]);

  useEffect(() => {
    if (!inlineExitCaret || mode === "source") return;

    const frame = requestAnimationFrame(() => {
      const target = document.querySelector('[data-inline-exit-caret="true"]');
      if (!(target instanceof HTMLElement)) return;

      target.focus();
      setCaretByTextOffset(target, stripEditableCaretSeed(target.textContent || "").length);
    });

    return () => cancelAnimationFrame(frame);
  }, [inlineExitCaret, mode]);

  useEffect(() => {
    function handleKeyDown(event) {
      const commandKey = event.metaKey || event.ctrlKey;
      if (!commandKey || event.key.toLowerCase() !== "z") return;

      event.preventDefault();

      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    return () => stopVoiceSession("Voice session stopped.");
  }, []);

  useEffect(() => {
    function preserveAuthoringSelection() {
      const selection = window.getSelection();
      if (!isAuthoringSelection(selection)) return;

      const authoringSelection = getAuthoringSelection();
      if (authoringSelection) {
        if (authoringSelection.kind !== "range" && caretRef.current?.kind === "range") return;
        caretRef.current = authoringSelection;
        if (authoringSelection.path && !pathsEqual(authoringSelection.path, selectedPath)) {
          setSelectedPath(authoringSelection.path);
        }
        if (authoringSelection.kind === "range") {
          setCaretContextVersion((version) => version + 1);
        }
      }
    }

    document.addEventListener("selectionchange", preserveAuthoringSelection);
    return () => document.removeEventListener("selectionchange", preserveAuthoringSelection);
  }, []);

  function rememberAuthoringSelectionForChat() {
    const liveSelection = getAuthoringSelection();
    const authoringSelection = liveSelection?.kind === "range"
      ? liveSelection
      : caretRef.current?.kind === "range"
        ? caretRef.current
        : liveSelection || caretRef.current;

    if (!authoringSelection) return;

    caretRef.current = authoringSelection;
    if (authoringSelection.kind === "range") {
      setPinnedAuthoringSelection(authoringSelection);
    }
  }

  function updateCaretSelection(caret) {
    caretRef.current = caret;
    if (caret?.path && !pathsEqual(caret.path, selectedPath)) {
      setSelectedPath(caret.path);
    }
    if (caret?.kind === "range") {
      setCaretContextVersion((version) => version + 1);
    }
    if (caret) {
      setPinnedAuthoringSelection(null);
    }
  }

  function preserveContextSelectionFromPointer(event) {
    const isContextClick = event.button === 2 || (event.button === 0 && event.ctrlKey);

    if (!isContextClick) {
      contextSelectionRangeRef.current = null;
      setPinnedAuthoringSelection(null);
      setDocumentHighlightPathKey(null);
      return;
    }

    const selection = window.getSelection();
    const liveSelection = getAuthoringSelection();
    if (selection && selection.rangeCount > 0 && liveSelection?.kind === "range") {
      contextSelectionRangeRef.current = selection.getRangeAt(0).cloneRange();
      caretRef.current = liveSelection;
    }
  }

  function updateXmlFromDoc(doc) {
    commitXml(formatXml(new XMLSerializer().serializeToString(doc)));
  }

  function updateText(path, value) {
    clearPendingVisualTextEdit(path, null);
    const { doc, error } = parseXml(xml);
    if (error) return;

    const node = getNodeByPath(doc, path);
    if (!node) return;

    node.textContent = value;
    cleanupEmptyInlineElements(doc.documentElement);
    updateXmlFromDoc(doc);
  }

  function updateTextNode(path, childNodeIndex, value) {
    clearPendingVisualTextEdit(path, childNodeIndex);
    const { doc, error } = parseXml(xml);
    if (error) return;

    const node = getNodeByPath(doc, path);
    const childNode = node?.childNodes[childNodeIndex];
    if (!childNode || childNode.nodeType !== Node.TEXT_NODE) return;

    childNode.textContent = value;
    cleanupEmptyInlineElements(doc.documentElement);
    updateXmlFromDoc(doc);
  }

  function updateAttribute(path, name, value) {
    const { doc, error } = parseXml(xml);
    if (error) return;

    const node = getNodeByPath(doc, path);
    if (!node) return;

    const previousValue = node.getAttribute(name);
    if (value.trim()) {
      node.setAttribute(name, value.trim());
    } else {
      node.removeAttribute(name);
    }

    if (node.tagName === "entry" && ["colname", "namest", "nameend"].includes(name)) {
      const issue = getCalsHorizontalSpanIssue(node, name, previousValue);
      if (issue) {
        restoreAttributeValue(node, name, previousValue);
        appendTerminalMessage(issue, { level: "warning", source: "Table", open: false });
        return;
      }
      normalizeCalsRowAfterHorizontalSpanEdit(doc, node);
    }

    if (node.tagName === "entry" && name === "morerows") {
      const issue = getCalsVerticalSpanIssue(node);
      if (issue) {
        if (previousValue === null) {
          node.removeAttribute(name);
        } else {
          node.setAttribute(name, previousValue);
        }
        appendTerminalMessage(issue, { level: "warning", source: "Table", open: false });
        return;
      }
      normalizeCalsRowsAfterVerticalSpanEdit(node);
    }

    updateXmlFromDoc(doc);
  }

  function validateHrefAttribute(path: number[], value: string) {
    const href = value.trim();
    if (!href) {
      setExplorerSystemMessage("href cleared.");
      return;
    }

    const { doc } = parseXml(xml);
    const node = doc ? getNodeByPath(doc, path) : null;
    const validation = node ? getHrefValidationState(node, path, activeFilePath, projectTree) : null;
    setExplorerSystemMessage(validation?.message || "href is ready for validation.", validation?.status === "invalid" ? "error" : "info");
  }

  function updateHrefFromDrop(path: number[], droppedFile) {
    const { doc, error } = parseXml(xml);
    if (error) return;

    const node = getNodeByPath(doc, path);
    if (!node || !["image", "xref", "topicref"].includes(node.tagName)) return;

    const href = typeof droppedFile?.href === "string" ? droppedFile.href : "";
    const ditaHref = activeFilePath && !isExternalHref(href)
      ? getRelativeProjectHref(activeFilePath, href)
      : href.trim();

    if (node.tagName === "image" && !isImageHref(ditaHref)) {
      setExplorerSystemMessage("Only image assets can be dropped onto a DITA image.", "warning");
      return;
    }

    if (node.tagName === "xref" || node.tagName === "topicref") {
      const isDitaProjectFile = droppedFile?.kind && isDitaDocumentType(droppedFile.kind);

      if (!isDitaProjectFile && !isDitaDocumentHref(ditaHref)) {
        setExplorerSystemMessage(`Only DITA documents can be dropped onto a ${node.tagName}.`, "warning");
        return;
      }

      if (
        activeFilePath &&
        !isExternalHref(href) &&
        normalizeProjectPath(href) === normalizeProjectPath(activeFilePath)
      ) {
        setExplorerSystemMessage(`Cannot link a ${node.tagName} to its own file.`, "warning");
        return;
      }
    }

    node.setAttribute("href", ditaHref);
    if (node.tagName === "xref" && !node.textContent?.trim() && droppedFile?.name) {
      node.textContent = droppedFile.name.replace(/\.(dita|ditamap|xml)$/i, "");
    }
    if (node.tagName === "topicref" && !node.getAttribute("navtitle") && droppedFile?.name) {
      node.setAttribute("navtitle", droppedFile.name.replace(/\.(dita|ditamap|xml)$/i, ""));
    }

    setSelectedPath(path);
    setExplorerSystemMessage(`Set ${node.tagName} href to ${ditaHref}`);
    updateXmlFromDoc(doc);
  }

  function resolveImageHrefForPreview(href: string) {
    const trimmed = href.trim();
    if (!trimmed || isExternalHref(trimmed) || !activeFilePath) return trimmed;

    const projectHref = resolveProjectHref(activeFilePath, trimmed);
    const projectFile = findProjectFileByPath(projectTree, projectHref);
    return projectFile?.previewHref || trimmed;
  }

  function insertElement(tagName, placement = insertContext.placement, targetPath = selectedPath) {
    const { doc, error } = parseXml(xml);
    if (error) return;

    if (placement === "surround") {
      const liveSelection = getAuthoringSelection();
      const authoringSelection = liveSelection?.kind === "range"
        ? liveSelection
        : caretRef.current?.kind === "range"
          ? caretRef.current
          : liveSelection || caretRef.current;
      if (!isKnownInlineElement(tagName) || authoringSelection?.kind !== "range") return;

      const wrappedResult = wrapTextRangeWithInlineElement(doc, tagName, authoringSelection);

      if (wrappedResult) {
        setSelectedPath(wrappedResult.insertedPath);
        setPendingFocusPath(wrappedResult.insertedPath);
        caretRef.current = wrappedResult.nextCaret;
        updateXmlFromDoc(doc);
      }

      return;
    }

    if (placement === "after") {
      const insertedPath = insertSchemaSiblingAfter(doc, targetPath, tagName);

      if (insertedPath) {
        const focusPath = getFirstEditablePath(getNodeByPath(doc, insertedPath), insertedPath);
        setSelectedPath(focusPath);
        setPendingFocusPath(focusPath);
        updateXmlFromDoc(doc);
      }

      return;
    }

    const parent = getNodeByPath(doc, targetPath);
    if (!parent) return;
    if (!getAllowedChildOptions(parent).includes(tagName)) return;

    const liveSelection = getAuthoringSelection();
    const authoringSelection = liveSelection?.kind === "range"
      ? liveSelection
      : caretRef.current?.kind === "range"
        ? caretRef.current
        : liveSelection || caretRef.current;
    if (
      isInlineInsertionElement(tagName) &&
      authoringSelection &&
      authoringSelection.path.join(".") === targetPath.join(".")
    ) {
      if (authoringSelection.kind === "range") {
        const wrappedResult = wrapTextRangeWithInlineElement(doc, tagName, authoringSelection);

        if (wrappedResult) {
          setSelectedPath(wrappedResult.insertedPath);
          setPendingFocusPath(wrappedResult.insertedPath);
          caretRef.current = wrappedResult.nextCaret;
          updateXmlFromDoc(doc);
          return;
        }
      }

      const insertedPath = insertInlineElementAtCaret(doc, tagName, authoringSelection);

      if (insertedPath) {
        setSelectedPath(insertedPath);
        setPendingFocusPath(insertedPath);
        updateXmlFromDoc(doc);
        return;
      }
    }

    const childIndex = appendSchemaChild(parent, createElementFor(doc, tagName, {
      imagePlacement: tagName === "image" ? getImagePlacementForParent(parent) : undefined,
    }));
    const insertedPath = [...targetPath, childIndex];
    const focusPath = getFirstEditablePath(getNodeByPath(doc, insertedPath), insertedPath);
    setSelectedPath(focusPath);
    setPendingFocusPath(focusPath);
    updateXmlFromDoc(doc);
  }

  function createTableRowForContext(doc: Document, context: TableContext, referenceRow: Element | null = null): Element {
    const rowTagName = context.model === "cals"
      ? "row"
      : context.model === "simple"
        ? "strow"
        : context.model === "choice"
          ? "chrow"
          : "property";
    return createTableRowElement(doc, rowTagName, referenceRow) || doc.createElement(rowTagName);
  }

  function updateCalsTgroupColumnCount(context: TableContext, table: Element) {
    syncCalsTgroupColumnCount(context.model, table);
  }

  function getDefaultTableRowParent(context: TableContext, table: Element): Element {
    if (context.model !== "cals") return table;

    const tgroup = table.tagName === "tgroup" ? table : table.getElementsByTagName("tgroup")[0];
    const tbody = tgroup?.getElementsByTagName("tbody")[0];
    return tbody || tgroup || table;
  }

  function runTableCommand(command: TableCommand, commandPath = selectedPath) {
    if (!activeIsXml) return;

    const { doc, error } = parseXml(xml);
    if (error || !doc) return;

    const validation = getTableCommandValidation(doc, commandPath, command);
    if (!validation.enabled) {
      if (validation.reason) {
        appendTerminalMessage(validation.reason, { level: "warning", source: "Table", open: false });
      }
      return;
    }

    const context = findNearestTableContext(doc, commandPath);
    if (!context) return;

    const table = getNodeByPath(doc, context.tablePath);
    const row = context.rowPath ? getNodeByPath(doc, context.rowPath) : null;
    const cell = context.cellPath ? getNodeByPath(doc, context.cellPath) : null;
    if (!table) return;

    if (command === "insert-row-before" || command === "insert-row-after") {
      const referenceRow = row || getTableRows(table, context.model)[0] || null;
      const newRow = createTableRowForContext(doc, context, referenceRow);
      const rowParent = referenceRow?.parentNode || getDefaultTableRowParent(context, table);
      if (!rowParent) return;

      if (command === "insert-row-before" && referenceRow) {
        rowParent.insertBefore(newRow, referenceRow);
      } else if (referenceRow) {
        rowParent.insertBefore(newRow, referenceRow.nextSibling);
      } else {
        rowParent.appendChild(newRow);
      }

      updateCalsTgroupColumnCount(context, table);
      const insertedPath = getPathForElement(doc, newRow) || context.tablePath;
      setSelectedPath(getFirstEditablePath(newRow, insertedPath));
      setPendingFocusPath(getFirstEditablePath(newRow, insertedPath));
      updateXmlFromDoc(doc);
      return;
    }

    if (command === "delete-row") {
      if (!row?.parentNode) return;
      const nextSelection = context.tablePath;
      row.parentNode.removeChild(row);
      updateCalsTgroupColumnCount(context, table);
      setSelectedPath(nextSelection);
      updateXmlFromDoc(doc);
      return;
    }

    if (!context.canEditColumns) return;

    const rows = getTableRows(table, context.model);
    if (!rows.length) return;

    const columnIndex = Math.max(0, context.columnIndex);
    const cellTag = getTableCellTags(context.model)[0];

    if (command === "insert-column-before" || command === "insert-column-after") {
      if (context.model === "cals") {
        if (!cell) return;
        const grid = resolveCalsGrid(table);
        const selectedCell = getCalsGridCellForEntry(grid, cell);
        if (!selectedCell) return;
        const insertAfterCol = command === "insert-column-before" ? selectedCell.startCol - 1 : selectedCell.endCol;
        const result = insertCalsColumnAfterIndex(doc, table, insertAfterCol, selectedCell.row);
        const focusCell = result?.selectedRowNewCell;
        const focusPath = focusCell ? getPathForElement(doc, focusCell) : context.tablePath;
        setSelectedPath(focusPath || context.tablePath);
        if (focusPath) setPendingFocusPath(focusPath);
        updateXmlFromDoc(doc);
        return;
      }

      for (const currentRow of rows) {
        const cells = getRowCells(currentRow, context.model);
        const referenceCell = cells[Math.min(columnIndex, Math.max(0, cells.length - 1))] || null;
        const newCell = createElementFor(doc, cellTag);
        if (command === "insert-column-before" && referenceCell) {
          currentRow.insertBefore(newCell, referenceCell);
        } else if (referenceCell) {
          currentRow.insertBefore(newCell, referenceCell.nextSibling);
        } else {
          currentRow.appendChild(newCell);
        }
      }

      updateCalsTgroupColumnCount(context, table);
      setSelectedPath(context.tablePath);
      updateXmlFromDoc(doc);
      return;
    }

    if (command === "delete-column") {
      for (const currentRow of rows) {
        const cells = getRowCells(currentRow, context.model);
        const cell = cells[columnIndex];
        if (cell?.parentNode) {
          cell.parentNode.removeChild(cell);
        }
      }

      updateCalsTgroupColumnCount(context, table);
      setSelectedPath(context.tablePath);
      updateXmlFromDoc(doc);
      return;
    }

    if (command === "merge-right") {
      if (context.model !== "cals" || !cell) return;
      const grid = resolveCalsGrid(table);
      const selectedCell = getCalsGridCellForEntry(grid, cell);
      if (!selectedCell) return;
      const rightCell = grid.rows[selectedCell.rowIndex]?.cells.find((candidate) => candidate.startCol === selectedCell.endCol + 1);
      if (!rightCell) return;
      const columnNames = getCalsColumnNames(table);
      cell.setAttribute("namest", columnNames[selectedCell.startCol]);
      cell.setAttribute("nameend", columnNames[rightCell.endCol]);
      normalizeCalsRowAfterHorizontalSpanEdit(doc, cell);
      const focusPath = getPathForElement(doc, cell) || context.cellPath || context.tablePath;
      setSelectedPath(focusPath);
      setPendingFocusPath(focusPath);
      updateXmlFromDoc(doc);
      return;
    }

    if (command === "merge-left") {
      if (context.model !== "cals" || !cell) return;
      const grid = resolveCalsGrid(table);
      const selectedCell = getCalsGridCellForEntry(grid, cell);
      if (!selectedCell) return;
      const leftCell = grid.rows[selectedCell.rowIndex]?.cells.find((candidate) => candidate.endCol + 1 === selectedCell.startCol);
      if (!leftCell) return;
      const columnNames = getCalsColumnNames(table);
      leftCell.entry.setAttribute("namest", columnNames[leftCell.startCol]);
      leftCell.entry.setAttribute("nameend", columnNames[selectedCell.endCol]);
      normalizeCalsRowAfterHorizontalSpanEdit(doc, leftCell.entry);
      const focusPath = getPathForElement(doc, leftCell.entry) || context.cellPath || context.tablePath;
      setSelectedPath(focusPath);
      setPendingFocusPath(focusPath);
      updateXmlFromDoc(doc);
      return;
    }

    if (command === "split-cells") {
      if (context.model !== "cals" || !cell) return;
      if (!splitCalsSpannedCell(doc, cell)) return;
      const focusPath = getPathForElement(doc, cell) || context.cellPath || context.tablePath;
      setSelectedPath(focusPath);
      setPendingFocusPath(focusPath);
      updateXmlFromDoc(doc);
    }
  }

  function toggleInlineRibbonElement(tagName: string) {
    if (!activeIsXml || !isKnownInlineElement(tagName)) return false;

    const { doc, error } = parseXml(xml);
    if (error || !doc) return false;

    const selectionPath = caretRef.current?.path || selectedPath;
    const currentCaret = caretRef.current;
    const path = Array.isArray(selectionPath) ? selectionPath : selectedPath;

    for (let depth = path.length; depth >= 0; depth -= 1) {
      const ancestorPath = path.slice(0, depth);
      const node = getNodeByPath(doc, ancestorPath);
      if (node?.nodeType === Node.ELEMENT_NODE && node.tagName === tagName) {
        if (currentCaret?.kind === "range") {
          const nextSelectedPath = ancestorPath.slice(0, -1);
          const unwrapResult = unwrapElementAtPath(doc, ancestorPath);
          if (!unwrapResult) return false;
          setInlineExitCaret(null);
          setSelectedPath(nextSelectedPath);
          caretRef.current = {
            kind: "caret",
            path: nextSelectedPath,
            childNodeIndex: Math.max(0, unwrapResult.focusChildNodeIndex),
            offset: 0,
          };
          pendingCaretFocusRef.current = {
            path: nextSelectedPath,
            childNodeIndex: Math.max(0, unwrapResult.focusChildNodeIndex),
            offset: 0,
          };
          pendingFocusPlacementRef.current = "start";
          setPendingFocusPath(nextSelectedPath);
          updateXmlFromDoc(doc);
          return true;
        }

        const parentPath = ancestorPath.slice(0, -1);
        const afterElementIndex = ancestorPath.at(-1) ?? 0;
        if (isCaretAtEndOfElement(node, ancestorPath, currentCaret) && !hasMeaningfulContentAfterNode(node)) {
          setInlineExitCaret({ parentPath, afterElementIndex, tagName });
          setSelectedPath(parentPath);
          caretRef.current = {
            kind: "caret",
            path: parentPath,
            childNodeIndex: -1,
            offset: 0,
          };
          return true;
        }

        const unwrapResult = unwrapElementAtPath(doc, ancestorPath);
        if (!unwrapResult) return false;
        setInlineExitCaret(null);
        caretRef.current = {
          kind: "caret",
          path: parentPath,
          childNodeIndex: Math.max(0, unwrapResult.focusChildNodeIndex),
          offset: 0,
        };
        pendingCaretFocusRef.current = {
          path: parentPath,
          childNodeIndex: Math.max(0, unwrapResult.focusChildNodeIndex),
          offset: 0,
        };
        pendingFocusPlacementRef.current = "start";
        setSelectedPath(parentPath);
        setPendingFocusPath(parentPath);
        updateXmlFromDoc(doc);
        return true;
      }
    }

    return false;
  }

  function handleListItemEnter(path, currentText, textNodeIndex = null, caret = null) {
    const { doc, error } = parseXml(xml);
    if (error) return false;

    clearPendingVisualTextEdit(path, textNodeIndex);
    const authoringCaret = caret?.kind === "caret"
      ? caret
      : caretRef.current?.kind === "caret"
        ? caretRef.current
        : getAuthoringSelection();
    const insertedPath = splitListItemSpecializationAtCaret(doc, path, currentText, textNodeIndex, authoringCaret);
    if (!insertedPath) return false;

    const focusPath = getFirstEditablePath(getNodeByPath(doc, insertedPath), insertedPath);
    pendingFocusPlacementRef.current = "start";
    setSelectedPath(focusPath);
    setPendingFocusPath(focusPath);
    updateXmlFromDoc(doc);
    return true;
  }

  function handleParagraphEnter(path, currentText, textNodeIndex = null, caret = null) {
    const { doc, error } = parseXml(xml);
    if (error) return;

    clearPendingVisualTextEdit(path, textNodeIndex);
    const authoringCaret = caret?.kind === "caret"
      ? caret
      : caretRef.current?.kind === "caret"
        ? caretRef.current
        : getAuthoringSelection();
    const insertedPath = splitParagraphAtCaret(doc, path, currentText, textNodeIndex, authoringCaret);
    if (!insertedPath) return;

    const focusPath = getFirstEditablePath(getNodeByPath(doc, insertedPath), insertedPath);
    pendingFocusPlacementRef.current = "start";
    setSelectedPath(focusPath);
    setPendingFocusPath(focusPath);
    updateXmlFromDoc(doc);
  }

  function commitInlineExitText(parentPath: number[], afterElementIndex: number, value: string) {
    const nextText = stripEditableCaretSeed(value);
    if (!nextText) {
      setInlineExitCaret(null);
      return;
    }

    const { doc, error } = parseXml(xml);
    if (error) return;

    const parent = getNodeByPath(doc, parentPath);
    const referenceElement = parent ? elementChildren(parent)[afterElementIndex] : null;
    if (!parent || !referenceElement) return;

    const textNode = doc.createTextNode(nextText);
    parent.insertBefore(textNode, referenceElement.nextSibling);

    const childNodeIndex = Array.from(parent.childNodes).indexOf(textNode);
    const nextCaret = {
      kind: "caret",
      path: parentPath,
      childNodeIndex,
      offset: nextText.length,
    };
    setInlineExitCaret(null);
    setSelectedPath(parentPath);
    caretRef.current = nextCaret;
    pendingCaretFocusRef.current = nextCaret;
    pendingFocusPlacementRef.current = "end";
    setPendingFocusPath(parentPath);
    updateXmlFromDoc(doc);
  }

  function openContextMenu(event, path) {
    if (!parsed.doc) return;

    event.preventDefault();
    event.stopPropagation();

    const textPoint = getTextOffsetAtPoint(event.clientX, event.clientY);
    const spellingIssue = textPoint
      ? activeSpellingIssues.find((issue) => (
          issue.pathKey === textPoint.pathKey &&
          issue.childNodeIndex === textPoint.childNodeIndex &&
          textPoint.offset >= issue.startOffset &&
          textPoint.offset <= issue.endOffset
        )) || null
      : null;
    const liveSelection = getAuthoringSelection();
    const authoringSelection = liveSelection?.kind === "range"
      ? liveSelection
      : caretRef.current?.kind === "range"
        ? caretRef.current
        : liveSelection || caretRef.current;
    const insertContext = getInsertContext(parsed.doc, path, authoringSelection);
    const tableOptions = getTableContextMenuOptions(parsed.doc, path);

    if (authoringSelection?.kind === "range") {
      caretRef.current = authoringSelection;
    }
    setSelectedPath(path);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      path,
      authoringSelection,
      insertContext,
      spellingIssue,
      tableOptions,
    });

    const range = contextSelectionRangeRef.current;
    if (range && authoringSelection?.kind === "range") {
      window.requestAnimationFrame(() => {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
    }
  }

  function replaceSpellingIssue(issue: SpellingIssue, replacement: string) {
    const { doc, error } = parseXml(xml);
    if (error || !doc) return;

    const node = getNodeByPath(doc, issue.path);
    const textNode = node?.childNodes[issue.childNodeIndex];
    if (!node || !textNode || textNode.nodeType !== Node.TEXT_NODE) return;

    const currentText = textNode.textContent || "";
    const nextText = `${currentText.slice(0, issue.startOffset)}${replacement}${currentText.slice(issue.endOffset)}`;
    textNode.textContent = nextText;
    setContextMenu(null);
    setSpellingIssues((current) => current.filter((candidate) => candidate.id !== issue.id));
    updateXmlFromDoc(doc);
  }

  function ignoreSpellingIssue(issue: SpellingIssue) {
    ignoredSpellingIssueIdsRef.current.add(issue.id);
    setContextMenu(null);
    setSpellingIssues((current) => current.filter((candidate) => candidate.id !== issue.id));
  }

  async function addSpellingIssueToDictionary(issue: SpellingIssue) {
    setContextMenu(null);

    try {
      const response = await fetch(`${backendBaseUrl}/api/spelling/dictionary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getBackendAuthHeaders()),
        },
        body: JSON.stringify({
          word: issue.word,
          language: issue.language,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not add word to dictionary.");
      }

      const normalizedWord = issue.word.toLowerCase();
      const normalizedLanguage = issue.language.toLowerCase().startsWith("en") ? "en" : issue.language.toLowerCase();
      setSpellingIssues((current) => current.filter((candidate) => !(
        candidate.word.toLowerCase() === normalizedWord &&
        (candidate.language.toLowerCase().startsWith("en") ? "en" : candidate.language.toLowerCase()) === normalizedLanguage
      )));
      appendTerminalMessage(`Added "${issue.word}" to your spelling dictionary.`, {
        source: "SPELLING",
        level: "info",
        open: false,
      });
    } catch (error) {
      appendTerminalMessage(error instanceof Error ? error.message : "Could not add word to dictionary.", {
        source: "SPELLING",
        level: "warning",
        open: false,
      });
    }
  }

  function removeSelected() {
    if (selectedPath.length === 0) return;

    const { doc, error } = parseXml(xml);
    if (error) return;

    const nextPath = removeElementWithSchemaCleanup(doc, selectedPath);
    if (!nextPath) return;

    setSelectedPath(nextPath);
    updateXmlFromDoc(doc);
  }

  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    const folder = selectedContainer?.type === "folder" ? selectedContainer : projectTree;
    const extension = getFileExtension(file.name);
    const detectedType = /^(avif|gif|jpe?g|png|svg|webp)$/i.test(extension)
      ? "image"
      : ["dita", "ditamap", "xml"].includes(extension)
        ? "topic"
        : ["html", "htm"].includes(extension)
          ? "html"
          : "text";

    reader.onload = () => {
      const fileName = makeUniqueName(file.name, folder.children);
      const importedFile = {
        id: `file-${Date.now().toString(36)}`,
        type: "file",
        name: fileName,
        ditaType: detectedType,
        content: detectedType === "image" ? "" : String(reader.result),
        previewHref: detectedType === "image" ? String(reader.result) : undefined,
        checkedInAt: "Imported",
      };

      setProjectTree((tree) => updateProjectNode(tree, folder.id, (node) => ({
        ...node,
        children: [...node.children, importedFile],
      })));
      setTabPanes((panes) => panes.map((pane) => (
        pane.id === activePaneId
          ? { ...pane, tabs: [...pane.tabs, importedFile.id], activeFileId: importedFile.id }
          : pane
      )));
      setFileHistories((current) => ({
        ...current,
        [importedFile.id]: {
          past: [],
          present: importedFile.content,
          future: [],
        },
      }));
      setSelectedPathsByFile((current) => ({
        ...current,
        [importedFile.id]: [],
      }));
      setActiveFileId(importedFile.id);
      setSelectedProjectId(importedFile.id);
      setExplorerSystemMessage(`Imported ${fileName}`);
    };

    if (/^(avif|gif|jpe?g|png|svg|webp)$/i.test(extension)) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  }

  function exportXml() {
    if (!activeFile) return;

    if (activeFileKind === "image") {
      const link = document.createElement("a");
      link.href = activeFile.previewHref || "";
      link.download = activeFile.name;
      link.click();
      return;
    }

    const exportText = activeFileKind === "xml" ? formatXml(xml) : xml;
    const blob = new Blob([exportText], {
      type: activeFileKind === "html"
        ? "text/html"
        : activeFileKind === "xml"
          ? "application/xml"
          : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = activeFile.name || "document.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  function isAppMenuItemDisabled(item: AppMenuItem) {
    if (item.disabled) return true;

    if (item.command === "undo") {
      return !activeIsTextEditable;
    }

    if (item.command === "redo") {
      return !activeIsTextEditable || !canRedo;
    }

    return false;
  }

  function runAppMenuCommand(command?: AppMenuCommand) {
    if (!command) return;

    if (command === "importFile") {
      fileInputRef.current?.click();
    } else if (command === "undo") {
      runUndo();
    } else if (command === "redo") {
      runRedo();
    } else if (command === "viewTerminal") {
      setBottomPanelTab("terminal");
      setBottomPanelOpen(true);
    } else if (command === "specializations") {
      openSpecializationsTab();
    } else if (command === "visualTemplates") {
      openVisualTemplatesTab();
    } else if (command === "createVisualTemplate") {
      setVisualTemplatePickerMode("create");
    } else if (command === "openVisualTemplate") {
      setVisualTemplatePickerMode("open");
    } else if (command === "uploadVisualTemplate") {
      setVisualTemplateUploadOpen(true);
    } else if (command === "importVisualTemplate") {
      setVisualTemplateImportOpen(true);
    }
  }

  function runAppMenuItem(item: AppMenuItem) {
    if (item.command === "customizeAuthoring" && item.documentType) {
      openAuthoringProfileTab(item.documentType);
      return;
    }

    runAppMenuCommand(item.command);
  }

  function getAvailableAuthoringDocumentTypes() {
    return [...new Set([
      ...fallbackDitaSchemaProfile.fileTypes.map((fileType) => fileType.key),
      ...getActiveDitaSchemaProfile().fileTypes.map((fileType) => fileType.key),
      ...getValidDocumentSpecializations(specializations)
        .map((specialization) => specialization.name || specialization.definition?.name)
        .filter(Boolean),
    ])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  function getRuntimeAppMenus(): AppMenuDefinition[] {
    return appMenus.map((menu) => {
      if (menu.id !== "options") return menu;

      return {
        ...menu,
        items: [
          ...menu.items,
          {
            id: "customize-authoring",
            label: "Customize Types",
            icon: "schema",
            children: getAvailableAuthoringDocumentTypes().map((documentType) => ({
              id: `customize-authoring-${documentType}`,
              label: getDocumentTypeLabel(documentType),
              command: "customizeAuthoring",
              documentType,
              icon: "schema",
            })),
          },
        ],
      };
    });
  }

  function openSpecializationsTab() {
    const paneId = activePaneId || "pane-left";
    setFileHistories((current) => current[specializationsTabId]
      ? current
      : {
          ...current,
          [specializationsTabId]: {
            past: [],
            present: "",
            future: [],
          },
        });
    setTabPanes((panes) => panes.map((pane) => (
      pane.id === paneId
        ? {
            ...pane,
            tabs: pane.tabs.includes(specializationsTabId) ? pane.tabs : [...pane.tabs, specializationsTabId],
            activeFileId: specializationsTabId,
          }
        : pane
    )));
    setActivePaneId(paneId);
    setActiveFileId(specializationsTabId);
    setSelectedProjectId(null);
    setActiveSidePanel(null);
    loadSpecializations();
  }

  function openVisualTemplatesTab(model = visualTemplateModel) {
    const paneId = activePaneId || "pane-left";
    setFileHistories((current) => current[visualTemplatesTabId]
      ? current
      : {
          ...current,
          [visualTemplatesTabId]: {
            past: [],
            present: JSON.stringify(model, null, 2),
            future: [],
          },
        });
    setTabPanes((panes) => panes.map((pane) => (
      pane.id === paneId
        ? {
            ...pane,
            tabs: pane.tabs.includes(visualTemplatesTabId) ? pane.tabs : [...pane.tabs, visualTemplatesTabId],
            activeFileId: visualTemplatesTabId,
          }
        : pane
    )));
    setActivePaneId(paneId);
    setActiveFileId(visualTemplatesTabId);
    setSelectedProjectId(null);
    setActiveSidePanel(null);
  }

  function getVisualTemplateCatalog() {
    const templates = [
      {
        id: defaultVisualTemplateModel.template.id,
        name: defaultVisualTemplateModel.template.name,
        description: "Default responsive topic deliverable layout with hero, body, summary, and sidebar containers.",
        source: "built-in",
        regions: defaultVisualTemplateModel.regions,
      },
    ];
    const currentTemplate = visualTemplateModel.template;
    if (currentTemplate?.id && !templates.some((template) => template.id === currentTemplate.id)) {
      templates.push({
        id: currentTemplate.id,
        name: currentTemplate.name || "Current template",
        description: "Template currently loaded in the designer.",
        source: currentTemplate.source || "current",
        regions: visualTemplateModel.regions,
      });
    }
    return templates;
  }

  function startTemplateBindingFromTemplate(template) {
    const nextModel = normalizeVisualTemplateModel({
      ...defaultVisualTemplateModel,
      artifactType: "binding",
      id: `binding-${slugifySpecializationName(template.name || template.id || "template") || Date.now().toString(36)}`,
      name: `Binding - ${template.name || "Template"}`,
      template: {
        id: template.id,
        name: template.name,
        source: template.source || "template",
      },
      filePath: "",
      regions: (template.regions || defaultVisualTemplateModel.regions).map((region) => ({
        ...region,
        sourceFileId: undefined,
        sourceKind: undefined,
        sourceName: undefined,
        sourcePath: undefined,
      })),
    });
    loadVisualTemplateModel(nextModel);
    setVisualTemplateSourceId(null);
    openVisualTemplatesTab(nextModel);
  }

  function startVisualTemplateDesigner(template) {
    const nextModel = normalizeVisualTemplateModel({
      ...defaultVisualTemplateModel,
      artifactType: "template",
      id: template.id,
      name: template.name || "Visual template",
      template: {
        id: template.id,
        name: template.name || "Visual template",
        source: template.source || "template",
      },
      filePath: template.filePath || "",
      regions: template.regions || defaultVisualTemplateModel.regions,
    });
    loadVisualTemplateModel(nextModel);
    setVisualTemplateSourceId(null);
    openVisualTemplatesTab(nextModel);
  }

  function createNewVisualTemplateBinding() {
    const templateName = `New template ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    startVisualTemplateDesigner({
      id: `template-${Date.now().toString(36)}`,
      name: templateName,
      description: "New reusable template definition. Arrange containers and slots, then save it for later bindings.",
      source: "new",
      regions: defaultVisualTemplateModel.regions,
    });
  }

  async function uploadVisualTemplateFile(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const uploadedTemplate = normalizeVisualTemplateModel({
        ...parsed,
        template: {
          id: parsed.template?.id || `uploaded-${slugifySpecializationName(file.name) || Date.now().toString(36)}`,
          name: parsed.template?.name || parsed.name || file.name.replace(/\.[^./]+$/i, ""),
          source: "uploaded",
        },
        filePath: "",
      });
      startVisualTemplateDesigner({
        id: uploadedTemplate.template.id,
        name: uploadedTemplate.template.name,
        description: `Uploaded from ${file.name}.`,
        source: "uploaded",
        regions: uploadedTemplate.regions,
      });
      appendTerminalMessage(`Uploaded template ${file.name}. Edit containers and slots, then save the reusable template.`, {
        level: "info",
        source: "Templates",
        open: false,
      });
      setVisualTemplateUploadOpen(false);
    } catch (error) {
      appendTerminalMessage(error instanceof Error ? error.message : "Could not upload template. Use a JSON template file for now.", {
        level: "error",
        source: "Templates",
        open: false,
      });
    }
  }

  function startImportedVisualTemplate(provider: "canva" | "figma") {
    const providerLabel = provider === "figma" ? "Figma" : "Canva";
    startVisualTemplateDesigner({
      id: `${provider}-template-${Date.now().toString(36)}`,
      name: `${providerLabel} imported template`,
      description: `${providerLabel} import placeholder. Later this will connect to the provider and map frames/components to containers and slots.`,
      source: provider,
      regions: defaultVisualTemplateModel.regions,
    });
    appendTerminalMessage(`${providerLabel} template import is staged as a placeholder. Provider connection and mapping rules come next.`, {
      level: "info",
      source: "Templates",
      open: false,
    });
    setVisualTemplateImportOpen(false);
  }

  function openAuthoringProfileTab(documentType: string) {
    const tabFile = createAuthoringProfileTabFile(documentType);
    const paneId = activePaneId || "pane-left";
    setFileHistories((current) => current[tabFile.id]
      ? current
      : {
          ...current,
          [tabFile.id]: {
            past: [],
            present: documentType,
            future: [],
          },
        });
    setTabPanes((panes) => panes.map((pane) => (
      pane.id === paneId
        ? {
            ...pane,
            tabs: pane.tabs.includes(tabFile.id) ? pane.tabs : [...pane.tabs, tabFile.id],
            activeFileId: tabFile.id,
          }
        : pane
    )));
    setActivePaneId(paneId);
    setActiveFileId(tabFile.id);
    setSelectedProjectId(null);
    setActiveSidePanel(null);
  }

  function getCollapsedInlineShortcutContext(tagName: string) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (!range.collapsed) return null;

    const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
    const inlineElement = startElement?.closest?.(`[data-dita-tag="${tagName}"]`) as HTMLElement | null;
    if (!inlineElement) return null;

    const inlinePath = parsePathValue(inlineElement.dataset.nodePath);
    if (!inlinePath.length) return null;

    const textLength = stripEditableCaretSeed(inlineElement.textContent || "").length;
    const offset = stripEditableCaretSeed(range.toString()).length || getRangeTextOffsetWithin(inlineElement, range);
    let sibling = inlineElement.nextSibling;
    let hasContentAfter = false;

    while (sibling) {
      if (sibling instanceof HTMLElement && sibling.dataset.inlineExitCaret === "true") {
        sibling = sibling.nextSibling;
        continue;
      }

      if (sibling.nodeType === Node.ELEMENT_NODE) {
        hasContentAfter = true;
        break;
      }

      if (sibling.nodeType === Node.TEXT_NODE && stripEditableCaretSeed(sibling.textContent || "").trim()) {
        hasContentAfter = true;
        break;
      }

      sibling = sibling.nextSibling;
    }

    return {
      afterElementIndex: inlinePath.at(-1) ?? 0,
      atEnd: offset >= textLength,
      hasContentAfter,
      parentPath: inlinePath.slice(0, -1),
    };
  }

  function insertRibbonElement(tagName: string) {
    if (!activeIsXml) return;

    if (isKnownInlineElement(tagName)) {
      const inlineContext = getCollapsedInlineShortcutContext(tagName);
      if (inlineContext) {
        if (inlineContext.atEnd && !inlineContext.hasContentAfter) {
          setInlineExitCaret({
            parentPath: inlineContext.parentPath,
            afterElementIndex: inlineContext.afterElementIndex,
            tagName,
          });
          setSelectedPath(inlineContext.parentPath);
          caretRef.current = {
            kind: "caret",
            path: inlineContext.parentPath,
            childNodeIndex: -1,
            offset: 0,
          };
        }

        if (!inlineContext.atEnd || inlineContext.hasContentAfter) {
          toggleInlineRibbonElement(tagName);
        }

        return;
      }
    }

    if (isKnownInlineElement(tagName) && toggleInlineRibbonElement(tagName)) {
      return;
    }

    if (!ribbonAllowedTags.has(tagName)) return;

    const placement = insertContext.childOptions.includes(tagName)
      ? "child"
      : insertContext.siblingOptions.includes(tagName)
        ? "after"
        : "surround";
    insertElement(tagName, placement);
  }

  function moveCaretToPreviousEditableRun(target: HTMLElement): boolean {
    const activeWorkbench = target.closest(".visual-workbench");
    if (!activeWorkbench) return false;

    const editableRuns = Array.from(
      activeWorkbench.querySelectorAll('[contenteditable="true"][data-node-path][data-text-node-index]'),
    ).filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement);
    const currentIndex = editableRuns.indexOf(target);
    if (currentIndex <= 0) return false;

    const previousRun = editableRuns[currentIndex - 1];
    previousRun.focus();
    setCaretByTextOffset(previousRun, stripEditableCaretSeed(previousRun.textContent || "").length);
    caretRef.current = getAuthoringSelection();
    return true;
  }

  function focusTableCell(doc: Document, cell: Element | null) {
    const cellPath = cell ? getPathForElement(doc, cell) : null;
    if (!cellPath) return false;

    const focusPath = getFirstEditablePath(cell, cellPath);
    pendingFocusPlacementRef.current = "start";
    setSelectedPath(focusPath);
    setPendingFocusPath(focusPath);
    return true;
  }

  function handleAuthoringTableTabKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return false;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    if (!target.closest('[contenteditable="true"]')) return false;

    const { doc, error } = parseXml(xml);
    if (error || !doc) return false;

    const authoringSelection = getAuthoringSelection();
    const selectionPath = authoringSelection?.path || caretRef.current?.path || selectedPath;
    const context = findNearestTableContext(doc, selectionPath);
    if (!context?.cellPath || !context.rowPath) return false;

    const table = getNodeByPath(doc, context.tablePath);
    const row = getNodeByPath(doc, context.rowPath);
    const cell = getNodeByPath(doc, context.cellPath);
    if (!table || !row || !cell) return false;

    const rows = getTableRows(table, context.model);
    const rowIndex = rows.indexOf(row);
    const cells = getRowCells(row, context.model);
    const cellIndex = cells.indexOf(cell);
    if (rowIndex < 0 || cellIndex < 0) return false;

    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey) {
      const previousCell = cellIndex > 0
        ? cells[cellIndex - 1]
        : rowIndex > 0
          ? getRowCells(rows[rowIndex - 1], context.model).at(-1) || null
          : null;
      return focusTableCell(doc, previousCell);
    }

    const nextCell = cellIndex < cells.length - 1
      ? cells[cellIndex + 1]
      : rowIndex < rows.length - 1
        ? getRowCells(rows[rowIndex + 1], context.model)[0] || null
        : null;

    if (nextCell) {
      return focusTableCell(doc, nextCell);
    }

    const newRow = createTableRowForContext(doc, context, row);
    if (!row.parentNode) return true;

    row.parentNode.insertBefore(newRow, row.nextSibling);
    updateCalsTgroupColumnCount(context, table);
    const firstCell = getRowCells(newRow, context.model)[0] || null;
    const focused = focusTableCell(doc, firstCell);
    updateXmlFromDoc(doc);
    return focused;
  }

  function handleAuthoringBackspaceKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Backspace" || event.metaKey || event.ctrlKey || event.altKey) return false;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    if (!target.matches('[contenteditable="true"][data-node-path][data-text-node-index]')) return false;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    if (!range.collapsed || !target.contains(range.startContainer)) return false;

    const offset = getRangeTextOffsetWithin(target, range);
    if (offset > 0) return false;

    if (!moveCaretToPreviousEditableRun(target)) return false;

    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handleAuthoringShortcutKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (handleAuthoringTableTabKeyDown(event)) return;
    if (handleAuthoringBackspaceKeyDown(event)) return;

    const shortcutKey = event.key.toLowerCase();
    const commandKey = event.metaKey || event.ctrlKey;
    const tagName = shortcutKey === "b"
      ? "b"
      : shortcutKey === "i"
        ? "i"
        : shortcutKey === "u"
          ? "u"
          : "";

    if (!commandKey || event.altKey) return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("textarea, input, select")) return;
    if (!target.closest('[contenteditable="true"]')) return;

    if (!tagName) {
      const allowedBrowserEditingShortcuts = new Set(["a", "c", "v", "x", "y", "z"]);
      if (!allowedBrowserEditingShortcuts.has(shortcutKey)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const authoringSelection = getAuthoringSelection();
    if (authoringSelection) {
      caretRef.current = authoringSelection;
      updateCaretSelection(authoringSelection);
    }

    insertRibbonElement(tagName);
  }

  async function getBackendAuthHeaders() {
    const claims = await getIdTokenClaims();
    const token = claims?.__raw;

    if (!token) {
      throw new Error("Auth0 did not return an ID token.");
    }

    return {
      Authorization: `Bearer ${token}`,
    };
  }

  async function refreshGitHubStatus() {
    setGithubStatusState("loading");
    setGithubMessage("");

    try {
      const response = await fetch(`${backendBaseUrl}/api/github/status`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not load GitHub connection status.");
      }

      setGithubStatus(body);
      setGithubStatusState("ready");

      if (body.connected) {
        await loadGitHubRepositories();
        await loadGitBranches();
      }
    } catch (error) {
      setGithubStatusState("error");
      setGithubSystemMessage(error instanceof Error ? error.message : "Could not load GitHub connection status.", "error");
    }
  }

  async function connectGitHub() {
    setGithubMessage("");
    try {
      const response = await fetch(`${backendBaseUrl}/api/github/oauth-url`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ returnTo: window.location.origin }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not start GitHub connection.");
      }

      window.location.assign(body.authorizeUrl);
    } catch (error) {
      setGithubSystemMessage(error instanceof Error ? error.message : "Could not start GitHub connection.", "error");
      setGithubStatusState("error");
    }
  }

  async function loadGitHubRepositories() {
    setGithubRepositoriesState("loading");
    setGithubMessage("");

    try {
      const response = await fetch(`${backendBaseUrl}/api/github/repos`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not load GitHub repositories.");
      }

      setGithubRepositories(body.repositories || []);
      setGithubRepositoriesState("ready");
    } catch (error) {
      setGithubRepositoriesState("error");
      setGithubSystemMessage(error instanceof Error ? error.message : "Could not load GitHub repositories.", "error");
    }
  }

  async function loadGitBranches() {
    setGitBranchState("loading");
    setGitMessage("");

    try {
      const response = await fetch(`${backendBaseUrl}/api/github/branches`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not load GitHub branches.");
      }

      const branches = body.branches || [];
      const activeBranch = branches.find((branch: GitBranch) => branch.active) || branches[0];
      setGitBranches(branches);
      setGitBaseBranch(activeBranch?.name || githubStatus?.selectedRepository?.default_branch || "");
      setGitCheckoutBranch(activeBranch?.name || githubStatus?.selectedRepository?.selected_branch || githubStatus?.selectedRepository?.default_branch || "");
      setGitBranchState("ready");
    } catch (error) {
      setGitBranchState("error");
      setGitSystemMessage(error instanceof Error ? error.message : "Could not load GitHub branches.", "error");
    }
  }

  async function loadGitCommits(branchName = activeGitBranchName) {
    if (!githubStatus?.selectedRepository) return;

    setGitCommitsState("loading");
    setGitMessage("");

    try {
      const params = new URLSearchParams();
      if (branchName) params.set("branch", branchName);
      params.set("limit", "30");
      const response = await fetch(`${backendBaseUrl}/api/github/commits?${params.toString()}`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not load Git history.");
      }

      setGitCommits(body.commits || []);
      setGitCommitsState("ready");
    } catch (error) {
      setGitCommitsState("error");
      setGitSystemMessage(error instanceof Error ? error.message : "Could not load Git history.", "error");
    }
  }

  async function loadGitLocalCommits(branchName = activeGitBranchName) {
    if (!githubStatus?.selectedRepository) return;

    setGitLocalCommitState("loading");

    try {
      const params = new URLSearchParams();
      if (branchName) params.set("branch", branchName);
      const response = await fetch(`${backendBaseUrl}/api/github/local-commits?${params.toString()}`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not load pending local commits.");
      }

      setGitLocalCommits(body.localCommits || []);
      setGitLocalCommitState("ready");
    } catch (error) {
      setGitLocalCommitState("error");
      setGitSystemMessage(error instanceof Error ? error.message : "Could not load pending local commits.", "error");
    }
  }

  async function openGitHistoryForProjectFile(nodeId: string) {
    const match = findProjectNode(projectTree, nodeId);
    const node = match?.node;

    if (!node || node.type !== "file" || !node.githubPath) {
      setExplorerSystemMessage("Git history is available for files pulled from GitHub.", "warning");
      return;
    }

    const branch = gitCheckoutBranch || activeGitBranchName || githubStatus?.selectedRepository?.selected_branch || githubStatus?.selectedRepository?.default_branch || "";
    setExplorerSystemMessage(`Loading Git history for ${node.name}...`);

    try {
      const params = new URLSearchParams({
        path: node.githubPath,
        limit: "30",
      });
      if (branch) params.set("branch", branch);
      const response = await fetch(`${backendBaseUrl}/api/github/file-commits?${params.toString()}`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not load file Git history.");
      }

      const historyFileId = `git-history-${node.id}`;
      const payload: FileGitHistoryPayload = {
        fileId: node.id,
        fileName: node.name,
        filePath: node.githubPath,
        branch: body.branch || branch,
        commits: body.commits || [],
        loadedAt: new Date().toISOString(),
      };
      const historyFile = {
        id: historyFileId,
        type: "file",
        name: `Git History - ${node.name}`,
        ditaType: "git-history",
        content: JSON.stringify(payload),
        generated: true,
        sourceFileId: node.id,
        githubLoaded: true,
      };

      setProjectTree((currentTree) => {
        const existing = findProjectNode(currentTree, historyFileId)?.node;
        if (existing) {
          return updateProjectNode(currentTree, historyFileId, (currentNode) => ({
            ...currentNode,
            ...historyFile,
          }));
        }
        return {
          ...currentTree,
          children: [historyFile, ...currentTree.children],
        };
      });
      setFileHistories((current) => ({
        ...current,
        [historyFileId]: {
          past: [],
          present: historyFile.content,
          future: [],
        },
      }));
      setTabPanes((currentPanes) => currentPanes.map((pane) => (
        pane.id === activePaneId
          ? {
              ...pane,
              tabs: pane.tabs.includes(historyFileId) ? pane.tabs : [...pane.tabs, historyFileId],
              activeFileId: historyFileId,
            }
          : pane
      )));
      setActiveFileId(historyFileId);
      setSelectedProjectId(node.id);
      setExplorerSystemMessage(`Loaded ${payload.commits.length} commit${payload.commits.length === 1 ? "" : "s"} for ${node.name}.`);
    } catch (error) {
      setExplorerSystemMessage(error instanceof Error ? error.message : "Could not load file Git history.", "error");
    }
  }

  async function checkoutGitHistoryCommit(payload: FileGitHistoryPayload, commit: GitCommitSummary) {
    setGitCommitContextMenu(null);
    const match = findProjectNode(projectTree, payload.fileId);
    const file = match?.node;

    if (!file || file.type !== "file" || !file.githubPath) {
      setExplorerSystemMessage("Could not find the source file for this Git history entry.", "error");
      return;
    }

    setExplorerSystemMessage(`Restoring ${payload.fileName} from ${commit.shortSha}...`);

    try {
      const params = new URLSearchParams({
        path: payload.filePath,
        ref: commit.sha,
      });
      const response = await fetch(`${backendBaseUrl}/api/github/file-version?${params.toString()}`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not load file content from that commit.");
      }
      if (body.contentBase64) {
        throw new Error("Binary file checkout is not supported in the editor yet.");
      }

      const rawRestoredContent = body.content || "";
      const convertedRestoredContent = getProjectFileKind(file) === "xml"
        ? convertEditorJsonToDitaXml(rawRestoredContent, file.name, file.ditaType)
        : null;
      const restoredContent = convertedRestoredContent || rawRestoredContent;
      const draftResponse = await fetch(`${backendBaseUrl}/api/drafts/github`, {
        method: "PUT",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filePath: file.githubPath,
          githubSha: file.githubSha || "",
          sourceContentHash: file.sourceContentHash || "",
          contentFormat: getProjectFileKind(file),
          content: restoredContent,
        }),
      });
      const draftBody = await draftResponse.json();

      if (!draftResponse.ok) {
        throw new Error(draftBody.error || "Could not save restored content as a draft.");
      }

      setProjectTree((currentTree) => updateProjectNode(currentTree, file.id, (node) => ({
        ...node,
        content: restoredContent,
        githubLoaded: true,
        githubConvertedFromJson: Boolean(convertedRestoredContent),
        draftLoaded: true,
        draftDirty: Boolean(draftBody.draft?.dirty),
        draftSavedAt: draftBody.draft?.saved_at || new Date().toISOString(),
        draftContentHash: draftBody.draft?.draft_content_hash || node.draftContentHash || "",
        sourceContentHash: draftBody.draft?.source_content_hash || node.sourceContentHash || "",
      })));
      setFileHistories((current) => ({
        ...current,
        [file.id]: {
          past: [],
          present: restoredContent,
          future: [],
        },
      }));
      setTabPanes((currentPanes) => currentPanes.map((pane) => (
        pane.id === activePaneId
          ? {
              ...pane,
              tabs: pane.tabs.includes(file.id) ? pane.tabs : [...pane.tabs, file.id],
              activeFileId: file.id,
            }
          : pane
      )));
      setSelectedPathsByFile((current) => ({
        ...current,
        [file.id]: [],
      }));
      setActiveFileId(file.id);
      setSelectedProjectId(file.id);
      setExplorerSystemMessage(`Restored ${payload.fileName} from ${commit.shortSha} into the working draft.`);
    } catch (error) {
      setExplorerSystemMessage(error instanceof Error ? error.message : "Could not restore file from commit.", "error");
    }
  }

  async function checkoutGitBranch(branchName: string) {
    setGitMessage("");

    try {
      const response = await fetch(`${backendBaseUrl}/api/github/branches/checkout`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ branchName }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not check out branch.");
      }

      setGitSystemMessage(`Checked out ${getGitBranchDisplayName(body.repository.selected_branch)}. Use Pull to refresh the tree from this branch.`);
      await refreshGitHubStatus();
      await loadGitBranches();
      await loadGitCommits(branchName);
    } catch (error) {
      setGitSystemMessage(error instanceof Error ? error.message : "Could not check out branch.", "error");
    }
  }

  async function switchGitBranch(branchName: string) {
    const nextBranch = branchName.trim();
    const currentBranch = activeGitBranchName;
    if (!nextBranch || nextBranch === currentBranch || isSwitchingGitBranch) return;

    const filesToSave = collectProjectFiles(projectTree).filter(({ node }) => (
      node.type === "file" &&
      node.githubPath &&
      isTextEditableFile(node) &&
      (node.draftDirty || fileHistories[node.id]?.present !== undefined || node.id === activeFileId)
    ));

    setIsSwitchingGitBranch(true);
    setGitSystemMessage(filesToSave.length
      ? `Saving ${filesToSave.length} changed file${filesToSave.length === 1 ? "" : "s"} before switching branches...`
      : `Switching to ${getGitBranchDisplayName(nextBranch)}...`);

    try {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      await Promise.all(filesToSave.map(({ node }) => saveDraftForGitCommit(node)));

      const response = await fetch(`${backendBaseUrl}/api/github/branches/checkout`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ branchName: nextBranch }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not check out branch.");
      }

      setGitCheckoutBranch(nextBranch);
      setGitBranches((currentBranches) => currentBranches.map((branch) => ({
        ...branch,
        active: branch.name === nextBranch,
      })));
      setGithubStatus((currentStatus) => currentStatus
        ? {
            ...currentStatus,
            selectedRepository: currentStatus.selectedRepository
              ? {
                  ...currentStatus.selectedRepository,
                  selected_branch: body.repository?.selected_branch || nextBranch,
                }
              : currentStatus.selectedRepository,
          }
        : currentStatus);
      setGitSystemMessage(`Pulling ${getGitBranchDisplayName(nextBranch)} from GitHub...`);
      await loadSelectedGitHubRepositoryTree({ silent: true });
      await loadGitBranches();
      await loadGitCommits(nextBranch);
      await loadGitLocalCommits(nextBranch);
      setGitSystemMessage(`Checked out and pulled ${getGitBranchDisplayName(nextBranch)}.`);
    } catch (error) {
      setGitCheckoutBranch(currentBranch);
      setGitSystemMessage(error instanceof Error ? error.message : "Could not switch branch.", "error");
    } finally {
      setIsSwitchingGitBranch(false);
    }
  }

  async function createGitBranch(baseBranchOverride?: string) {
    const branchName = gitNewBranchName.trim();
    if (!branchName) return;

    setGitMessage("");
    try {
      const response = await fetch(`${backendBaseUrl}/api/github/branches`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ branchName, baseBranch: baseBranchOverride || gitBaseBranch }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not create branch.");
      }

      setGitNewBranchName("");
      setGitSystemMessage(`Created and checked out ${getGitBranchDisplayName(body.branch.name)}.`);
      await refreshGitHubStatus();
      await loadGitBranches();
      await loadGitCommits(body.branch.name);
      await loadGitLocalCommits(body.branch.name);
    } catch (error) {
      setGitSystemMessage(error instanceof Error ? error.message : "Could not create branch.", "error");
    }
  }

  async function saveDraftForGitCommit(node) {
    if (!node?.githubPath || !isTextEditableFile(node)) return;

    const content = fileHistories[node.id]?.present ?? node.content ?? "";
    const response = await fetch(`${backendBaseUrl}/api/drafts/github`, {
      method: "PUT",
      headers: {
        ...(await getBackendAuthHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filePath: node.githubPath,
        githubSha: node.githubSha || "",
        sourceContentHash: node.sourceContentHash || "",
        contentFormat: getProjectFileKind(node),
        content,
      }),
    });
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error || `Could not save draft for ${node.name}.`);
    }

    setProjectTree((currentTree) => updateProjectNode(currentTree, node.id, (currentNode) => ({
      ...currentNode,
      content,
      draftSavedAt: body.draft?.saved_at || new Date().toISOString(),
      draftDirty: Boolean(body.draft?.dirty),
      draftContentHash: body.draft?.draft_content_hash || currentNode.draftContentHash || "",
      sourceContentHash: body.draft?.source_content_hash || currentNode.sourceContentHash || "",
    })));
  }

  async function discardGitHubDraft(node) {
    if (!node?.githubPath) return;

    const displayName = node.name || node.githubPath;
    setGitSystemMessage(`Discarding changes for ${displayName}...`);

    try {
      const response = await fetch(`${backendBaseUrl}/api/drafts/github/discard`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: node.githubPath }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || `Could not discard changes for ${displayName}.`);
      }

      setSelectedGitCommitFileIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(node.id);
        return nextIds;
      });

      if (body.action === "removed-local-file") {
        closeTab(node.id);
        setProjectTree((currentTree) => removeProjectNode(currentTree, node.id));
        setFileHistories((current) => {
          const next = { ...current };
          delete next[node.id];
          return next;
        });
        setSelectedPathsByFile((current) => {
          const next = { ...current };
          delete next[node.id];
          return next;
        });
        setGitSystemMessage(`Discarded ${displayName}; the unpublished file was removed.`);
        return;
      }

      const reloadedFile = await loadGitHubFileIfNeeded({
        ...node,
        deletedAt: null,
        draftDirty: false,
        draftLoaded: false,
        draftSavedAt: null,
        draftContentHash: "",
        githubLoaded: false,
      });

      if (reloadedFile) {
        setFileHistories((current) => ({
          ...current,
          [node.id]: {
            past: [],
            present: reloadedFile.content || "",
            future: [],
          },
        }));
        setProjectTree((currentTree) => updateProjectNode(currentTree, node.id, (currentNode) => ({
          ...currentNode,
          ...reloadedFile,
          deletedAt: null,
          draftDirty: false,
          draftLoaded: false,
          draftSavedAt: null,
          draftContentHash: "",
        })));
      } else {
        setProjectTree((currentTree) => updateProjectNode(currentTree, node.id, (currentNode) => ({
          ...currentNode,
          deletedAt: null,
          draftDirty: false,
          draftLoaded: false,
          draftSavedAt: null,
          draftContentHash: "",
          githubLoaded: false,
        })));
      }

      setGitSystemMessage(`Discarded changes for ${displayName}.`);
    } catch (error) {
      setGitSystemMessage(error instanceof Error ? error.message : `Could not discard changes for ${displayName}.`, "error");
    }
  }

  async function commitSelectedGitHubDraftsLocally() {
    const selectedFiles = draftBackedFiles.filter(({ node }) => selectedGitCommitFileIds.has(node.id));
    const message = gitCommitMessage.trim();

    if (!selectedFiles.length || !message || isCommittingGitChanges) return;

    setIsCommittingGitChanges(true);
    setGitSystemMessage(`Saving ${selectedFiles.length} draft${selectedFiles.length === 1 ? "" : "s"} before commit...`);

    try {
      await Promise.all(selectedFiles
        .filter(({ node }) => !node.deletedAt)
        .map(({ node }) => saveDraftForGitCommit(node)));
      setGitSystemMessage(`Creating local commit for ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}...`);

      const response = await fetch(`${backendBaseUrl}/api/github/local-commits`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filePaths: selectedFiles.map(({ node }) => node.githubPath).filter(Boolean),
          message,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not create the local commit.");
      }

      setSelectedGitCommitFileIds((currentIds) => {
        const nextIds = new Set(currentIds);
        selectedFiles.forEach(({ node }) => nextIds.delete(node.id));
        return nextIds;
      });
      setGitCommitMessage("");
      setGitSystemMessage(`Committed ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} locally. Publish when ready.`);
      await loadGitLocalCommits(body.branch || activeGitBranchName);
    } catch (error) {
      setGitSystemMessage(error instanceof Error ? error.message : "Could not create the local commit.", "error");
    } finally {
      setIsCommittingGitChanges(false);
    }
  }

  async function publishGitHubLocalCommitsFromPanel() {
    if (!pendingPublishCommitCount || isPublishingGitChanges) return;

    setIsPublishingGitChanges(true);
    setGitSystemMessage(`Publishing ${pendingPublishCommitCount} local commit${pendingPublishCommitCount === 1 ? "" : "s"} to GitHub...`);

    try {
      const response = await fetch(`${backendBaseUrl}/api/github/publish`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          localCommitIds: gitLocalCommits.map((commit) => commit.id),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        if (response.status === 409 && Array.isArray(body.conflicts) && body.conflicts.length) {
          openGitConflictTabs(body.conflicts);
          throw new Error(body.error || "Publish blocked because GitHub has newer changes.");
        }
        throw new Error(body.error || "Could not publish local commits to GitHub.");
      }

      const publishedFilesByPath = new Map<string, { path: string; sha: string; contentHash: string; changeType?: string }>(
        (body.files || []).map((file) => [normalizeProjectPath(file.path), file]),
      );

      setProjectTree((currentTree) => {
        let nextTree = currentTree;
        collectProjectFiles(currentTree).forEach(({ node }) => {
          if (node.type !== "file" || !node.githubPath) return;
          const publishedFile = publishedFilesByPath.get(normalizeProjectPath(node.githubPath));
          if (!publishedFile) return;

          if (publishedFile.changeType === "delete") {
            nextTree = removeProjectNode(nextTree, node.id);
            return;
          }

          nextTree = updateProjectNode(nextTree, node.id, (currentNode) => ({
            ...currentNode,
            githubSha: publishedFile.sha || currentNode.githubSha || "",
            sourceContentHash: publishedFile.contentHash || currentNode.sourceContentHash || "",
            draftContentHash: publishedFile.contentHash || currentNode.draftContentHash || "",
            draftDirty: false,
            draftSavedAt: new Date().toISOString(),
            deletedAt: null,
          }));
        });
        return nextTree;
      });

      setSelectedGitCommitFileIds((currentIds) => {
        const nextIds = new Set(currentIds);
        draftBackedFiles.forEach(({ node }) => {
          if (node.githubPath && publishedFilesByPath.has(normalizeProjectPath(node.githubPath))) {
            nextIds.delete(node.id);
          }
        });
        return nextIds;
      });
      setGitSystemMessage(`Published ${body.commits?.length || pendingPublishCommitCount} commit${(body.commits?.length || pendingPublishCommitCount) === 1 ? "" : "s"} to ${getGitBranchDisplayName(body.branch || activeGitBranchName)}.`);
      await loadGitLocalCommits(body.branch || activeGitBranchName);
      await loadGitBranches();
      await loadGitCommits(body.branch || activeGitBranchName);
    } catch (error) {
      setGitSystemMessage(error instanceof Error ? error.message : "Could not publish local commits to GitHub.", "error");
      await loadGitLocalCommits(activeGitBranchName);
    } finally {
      setIsPublishingGitChanges(false);
    }
  }

  function openGitConflictTabs(conflicts) {
    const conflictFiles = conflicts.map((conflict, index) => {
      const filePath = normalizeProjectPath(conflict.filePath || "");
      const projectMatch = collectProjectFiles(projectTree).find(({ path, node }) => (
        normalizeProjectPath(node.githubPath || path) === filePath
      ));
      const fileName = filePath.split("/").pop() || `conflict-${index + 1}.xml`;
      const conflictFileId = `git-conflict-${filePath || index}-${Date.now().toString(36)}`;
      const payload: GitConflictPayload = {
        filePath,
        fileId: projectMatch?.node.id,
        fileName,
        sample: Boolean(conflict.sample),
        sampleExpectInvalid: Boolean(conflict.sampleExpectInvalid),
        baseSha: conflict.baseSha || "",
        currentSha: conflict.currentSha || "",
        remoteContent: conflict.remoteContent || "",
        remoteContentHash: conflict.remoteContentHash || "",
        localContent: conflict.localContent || "",
        localContentHash: conflict.localContentHash || "",
        message: conflict.message || `${fileName} has a merge conflict.`,
      };

      return {
        id: conflictFileId,
        type: "file",
        name: `Conflict - ${fileName}`,
        ditaType: "git-conflict",
        content: JSON.stringify(payload),
        generated: true,
        sourceFileId: projectMatch?.node.id,
        githubLoaded: true,
      };
    });

    setProjectTree((currentTree) => ({
      ...currentTree,
      children: [
        ...conflictFiles,
        ...currentTree.children.filter((node) => node.ditaType !== "git-conflict"),
      ],
    }));
    setFileHistories((current) => ({
      ...current,
      ...Object.fromEntries(conflictFiles.map((file) => [
        file.id,
        { past: [], present: file.content, future: [] },
      ])),
    }));
    setTabPanes((currentPanes) => currentPanes.map((pane) => (
      pane.id === activePaneId
        ? {
            ...pane,
            tabs: [...pane.tabs.filter((fileId) => !fileId.startsWith("git-conflict-")), ...conflictFiles.map((file) => file.id)],
            activeFileId: conflictFiles[0]?.id || pane.activeFileId,
          }
        : pane
    )));
    if (conflictFiles[0]) {
      setActiveFileId(conflictFiles[0].id);
    }
    setGitMessage("");
    pushNotification({
      severity: "warning",
      title: "Merge Conflict",
      body: `Publishing is blocked by ${conflictFiles.length} conflicted file${conflictFiles.length === 1 ? "" : "s"}. Resolve the conflict tab before publishing.`,
      source: "GitHub",
    });
  }

  function openSampleGitConflicts() {
    openGitConflictTabs([
      {
        sample: true,
        filePath: "samples/conflict-concept.dita",
        fileName: "conflict-concept.dita",
        baseSha: "9b43a21",
        currentSha: "e17d4c9",
        message: "Sample conflict: GitHub changed the concept title while your draft changed the body.",
        remoteContent: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE concept PUBLIC "-//OASIS//DTD DITA Concept//EN" "concept.dtd">
<concept id="release-notes">
  <title>Release notes reviewed by GitHub</title>
  <conbody>
    <p>The GitHub version clarifies the deployment notes and keeps the support matrix unchanged.</p>
    <section>
      <title>Compatibility</title>
      <p>Validated against DITA 1.3 and the current publishing pipeline.</p>
    </section>
  </conbody>
</concept>`,
        localContent: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE concept PUBLIC "-//OASIS//DTD DITA Concept//EN" "concept.dtd">
<concept id="release-notes">
  <title>Release notes</title>
  <conbody>
    <p>Your draft adds author guidance for reviewing release notes before publishing.</p>
    <section>
      <title>Author checklist</title>
      <p>Confirm links, image references, and short descriptions before publishing.</p>
    </section>
  </conbody>
</concept>`,
      },
      {
        sample: true,
        sampleExpectInvalid: true,
        filePath: "samples/invalid-resolution-concept.dita",
        fileName: "invalid-resolution-concept.dita",
        baseSha: "72d9a88",
        currentSha: "f3b91d0",
        message: "Sample invalid resolution: choosing Mine creates an invalid concept so Apply Resolution should be blocked.",
        remoteContent: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE concept PUBLIC "-//OASIS//DTD DITA Concept//EN" "concept.dtd">
<concept id="invalid-resolution">
  <title>Valid concept from GitHub</title>
  <conbody>
    <p>The remote version keeps the concept body valid.</p>
  </conbody>
</concept>`,
        localContent: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE concept PUBLIC "-//OASIS//DTD DITA Concept//EN" "concept.dtd">
<concept id="invalid-resolution">
  <conbody>
    <p>Your draft accidentally moves the title after the body, which is invalid for a concept.</p>
  </conbody>
  <title>Invalid title location</title>
</concept>`,
      },
      {
        sample: true,
        filePath: "samples/conflict-task.dita",
        fileName: "conflict-task.dita",
        baseSha: "2ac47f0",
        currentSha: "c64198d",
        message: "Sample conflict: GitHub reordered task steps while your draft edited the command text.",
        remoteContent: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE task PUBLIC "-//OASIS//DTD DITA Task//EN" "task.dtd">
<task id="validate-document">
  <title>Validate a DITA document</title>
  <taskbody>
    <steps>
      <step><cmd>Open the Git panel and pull the latest branch.</cmd></step>
      <step><cmd>Run Validate from the editor toolbar.</cmd></step>
      <step><cmd>Review the Output panel for schema errors.</cmd></step>
    </steps>
  </taskbody>
</task>`,
        localContent: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE task PUBLIC "-//OASIS//DTD DITA Task//EN" "task.dtd">
<task id="validate-document">
  <title>Validate and publish a DITA document</title>
  <taskbody>
    <steps>
      <step><cmd>Save the current draft before validation.</cmd></step>
      <step><cmd>Run Validate from the editor toolbar and fix all blocking issues.</cmd></step>
      <step><cmd>Commit the selected files and publish them to origin.</cmd></step>
    </steps>
  </taskbody>
</task>`,
      },
    ]);
  }

  async function saveGitConflictResolution(payload: GitConflictPayload, resolvedContent: string) {
    const filePath = normalizeProjectPath(payload.filePath);
    const targetMatch = collectProjectFiles(projectTree).find(({ path, node }) => (
      node.type === "file" &&
      node.ditaType !== "git-conflict" &&
      normalizeProjectPath(node.githubPath || path) === filePath
    ));
    const targetFile = targetMatch?.node;

    if ((!targetFile || targetFile.type !== "file") && !payload.sample) {
      setGitSystemMessage("Could not find the conflicted file in the Explorer.", "error");
      return { applied: false, issues: [] };
    }

    try {
      const validatedAt = new Date().toLocaleString();
      const validationFileId = targetFile?.id || activeFileId;
      const validationFileName = targetFile?.name || payload.fileName;
      const validationFilePath = targetMatch?.path || filePath || payload.fileName;
      const validationFiles = targetFile
        ? collectValidationFiles(projectTree, fileHistories).map((file) => (
          normalizeProjectPath(file.path) === filePath || normalizeProjectPath(file.path) === normalizeProjectPath(validationFilePath)
            ? { ...file, content: resolvedContent, encoding: undefined }
            : file
        ))
        : [{ path: validationFilePath, content: resolvedContent }];
      const validationResponse = await fetch(`${backendBaseUrl}/api/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry: validationFilePath,
          sessionId: validationSessionId,
          files: validationFiles,
          specializations: activeSpecializationDefinitions,
        }),
      });
      const validationResult = await validationResponse.json();

      if (!validationResponse.ok) {
        throw new Error(validationResult.error || "Validation request failed.");
      }

      const validationIssues = Array.isArray(validationResult.issues) ? validationResult.issues : [];
      const validationRunId = `validation-${validationFileId}-${Date.now()}`;
      const validationReport = createValidationReportContent({
        fileName: validationFileName,
        filePath: validationFilePath,
        result: validationResult,
        validatedAt,
        note: validationResult.ok ? "✓ Apply Resolution   → saves to your draft, does not publish" : "",
      });
      const validationState = {
        status: validationResult.ok ? "valid" as const : "invalid" as const,
        message: validationResult.ok
          ? "DITA-OT validation passed."
          : validationIssues[0]?.message || "Resolved content is not valid DITA.",
        runId: validationRunId,
        validatedAt,
      };

      showValidationRun({
        id: validationRunId,
        fileId: validationFileId,
        fileName: validationFileName,
        filePath: validationFilePath,
        status: validationResult.ok ? "valid" : "invalid",
        validatedAt,
        report: validationReport,
        output: String(validationResult.output || ""),
        issues: validationIssues,
      });
      setValidationByFile((current) => ({
        ...current,
        [validationFileId]: validationState,
      }));
      setLastValidation(validationState);

      if (!validationResult.ok) {
      setGitSystemMessage(`Apply Resolution blocked: ${validationState.message}`, "error");
        pushNotification({
          severity: "error",
          title: "Invalid Schema",
          body: `Apply Resolution was blocked for ${validationFileName}: ${validationState.message}`,
          source: validationFileName,
        });
        return { applied: false, issues: validationIssues };
      }

      if (payload.sample) {
        setGitSystemMessage(
          payload.sampleExpectInvalid
            ? `Sample ${payload.fileName} is valid after your choices.`
            : `Sample ${payload.fileName} validates successfully.`,
        );
        pushNotification({
          severity: "info",
          title: "Resolution Validated",
          body: `${payload.fileName} validates successfully. This sample was not saved or published.`,
          source: payload.fileName,
        });
        return { applied: true, issues: [] };
      }

      const response = await fetch(`${backendBaseUrl}/api/drafts/github`, {
        method: "PUT",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filePath,
          githubSha: payload.currentSha || targetFile.githubSha || "",
          sourceContentHash: payload.remoteContentHash || "",
          contentFormat: getProjectFileKind(targetFile),
          content: resolvedContent,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not save the resolved draft.");
      }

      setProjectTree((currentTree) => updateProjectNode(currentTree, targetFile.id, (node) => ({
        ...node,
        content: resolvedContent,
        githubSha: payload.currentSha || node.githubSha || "",
        sourceContentHash: body.draft?.source_content_hash || payload.remoteContentHash || node.sourceContentHash || "",
        draftContentHash: body.draft?.draft_content_hash || node.draftContentHash || "",
        draftDirty: Boolean(body.draft?.dirty),
        draftSavedAt: body.draft?.saved_at || new Date().toISOString(),
      })));
      setFileHistories((current) => ({
        ...current,
        [targetFile.id]: {
          past: [],
          present: resolvedContent,
          future: [],
        },
      }));
      setGitLocalCommits([]);
      await loadGitLocalCommits(activeGitBranchName);
      setGitSystemMessage(`Saved conflict resolution for ${payload.fileName}. Select the file in Changes, commit it again, then publish.`);
      pushNotification({
        severity: "info",
        title: "Resolution Saved",
        body: `${payload.fileName} was validated and saved to your draft. It was not published.`,
        source: payload.fileName,
      });
      return { applied: true, issues: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the resolved draft.";
      setGitSystemMessage(message, "error");
      pushNotification({
        severity: "error",
        title: "Resolution Failed",
        body: message,
        source: payload.fileName,
      });
      return { applied: false, issues: [] };
    }
  }

  async function chooseGitHubRepository(fullName: string) {
    setGithubMessage("");

    try {
      const response = await fetch(`${backendBaseUrl}/api/github/repository`, {
        method: "POST",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fullName }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not select GitHub repository.");
      }

      setGithubSystemMessage(`Repository selected: ${body.repository.full_name}`);
      await refreshGitHubStatus();
    } catch (error) {
      setGithubSystemMessage(error instanceof Error ? error.message : "Could not select GitHub repository.", "error");
    }
  }

  async function restoreProjectTreeFromDatabase() {
    setWorkspaceSource("loading");

    try {
      const response = await fetch(`${backendBaseUrl}/api/projects/tree`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not restore project tree.");
      }

      if (!body.entries?.length) {
        setProjectTree(emptyProjectTree);
        setFileHistories({});
        setActiveFileId(null);
        setSelectedProjectId(null);
        setTabPanes([{ id: "pane-left", label: "Left", tabs: [], activeFileId: null }]);
        setWorkspaceSource("empty");
        setExplorerSystemMessage(body.repository ? "No persisted files yet. Use Pull to load GitHub metadata." : "No GitHub repository selected. Create files or connect a repository.");
        return;
      }

      const nextTree = buildProjectTreeFromGitHubEntries(body.entries || []);
      setProjectTree(nextTree);
      setFileHistories({});
      setActiveFileId(null);
      setSelectedProjectId(null);
      setTabPanes([{ id: "pane-left", label: "Left", tabs: [], activeFileId: null }]);
      setLoadedRepositoryName(body.repository?.full_name || body.project?.name || "");
      setWorkspaceSource("github");
      setExplorerSystemMessage(`Restored ${body.project?.name || body.repository?.full_name || "project"} from Postgres.`);
    } catch (error) {
      setProjectTree(emptyProjectTree);
      setWorkspaceSource("empty");
      setExplorerSystemMessage(error instanceof Error ? error.message : "Could not restore project tree.", "error");
    }
  }

  async function loadSelectedGitHubRepositoryTree(options: { silent?: boolean } = {}) {
    setGithubTreeState("loading");
    if (!options.silent) {
      setGithubMessage("");
    }

    try {
      const response = await fetch(`${backendBaseUrl}/api/github/tree`, {
        headers: await getBackendAuthHeaders(),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not load the selected repository tree.");
      }

      const nextTree = buildProjectTreeFromGitHubEntries(body.entries || []);
      const fileCount = (body.entries || []).filter((entry: GitHubTreeEntry) => entry.type === "file").length;
      const folderCount = (body.entries || []).filter((entry: GitHubTreeEntry) => entry.type === "folder").length;

      setProjectTree(nextTree);
      setActiveFileId(null);
      setActivePaneId("pane-left");
      setSelectedProjectId(null);
      setTabPanes([{ id: "pane-left", label: "Left", tabs: [], activeFileId: null }]);
      setFileHistories({});
      setSelectedPathsByFile({});
      setValidationRuns([]);
      setActiveValidationRunId(null);
      lastSavedDraftRef.current = "";
      setLoadedRepositoryName(body.repository?.full_name || githubStatus?.selectedRepository?.full_name || "");
      setWorkspaceSource("github");
      setGithubTreeState("ready");
      setExplorerSystemMessage(`Loaded ${body.repository?.full_name || "GitHub repository"} into Explorer.`);
      if (!options.silent) {
        setGithubSystemMessage(`Loaded ${fileCount} files and ${folderCount} folders. File contents load when opened.`);
      }
      await loadGitLocalCommits(body.repository?.selected_branch || body.repository?.default_branch || activeGitBranchName);
    } catch (error) {
      setGithubTreeState("error");
      setGithubSystemMessage(error instanceof Error ? error.message : "Could not load the selected repository tree.", "error");
    }
  }

  function getAuthoringProfileCandidates(documentType: string) {
    const baseType = getBaseSchemaRootForDocumentType(documentType) || documentType;
    const profile = applySpecializationOverlays(activeBaseDitaSchemaProfile, activeSpecializationDefinitions, documentType);
    const rootDefinition = profile.elements[documentType] || profile.elements[baseType];
    if (!rootDefinition) return [];

    const structuralElements = new Set([
      documentType,
      baseType,
      ...profile.rootElements,
      ...getDocumentStarterChildNames(rootDefinition, documentType, profile),
      ...(rootDefinition.requiredChildren || []),
    ]);

    const candidates = new Set(
      Object.keys(profile.elements || {}).filter((tagName) => !structuralElements.has(tagName)),
    );

    activeSpecializationDefinitions
      .filter((specialization) => (
        isValidSpecialization(specialization) &&
        (specialization.kind || specialization.definition?.kind) === "element" &&
        specializationAppliesToDocument(specialization, documentType)
      ))
      .forEach((specialization) => {
        const name = specialization.name || specialization.definition?.name;
        if (name && profile.elements[name]) candidates.add(name);
      });

    return [...candidates]
      .filter((tagName) => (
        tagName !== "title" &&
        Boolean(profile.elements[tagName])
      ))
      .sort((a, b) => a.localeCompare(b))
      .map((tagName) => ({ tagName, definition: profile.elements[tagName] }));
  }

  function getAuthoringProfileGroups(documentType: string) {
    const candidates = getAuthoringProfileCandidates(documentType);
    const groups = [
      { id: "specialized", title: "Specialized elements", description: "Elements created by your DITA specialization modules.", items: [] as string[] },
      { id: "inline", title: "Inline elements", description: "Phrase-level elements used inside text.", items: [] as string[] },
      { id: "lists", title: "Lists", description: "Ordered, unordered, and list item elements.", items: [] as string[] },
      { id: "references", title: "References and media", description: "Links, cross references, figures, and images.", items: [] as string[] },
      { id: "blocks", title: "Block elements", description: "Structural authoring blocks available in this document type.", items: [] as string[] },
      { id: "other", title: "Other optional elements", description: "Additional optional DITA elements from the inherited schema.", items: [] as string[] },
    ];

    for (const { tagName, definition } of candidates) {
      if (getSpecializationByName(tagName)) {
        groups[0].items.push(tagName);
      } else if (definition.inline || definition.inlineContainer) {
        groups[1].items.push(tagName);
      } else if (["ul", "ol", "li", "dl", "sl", "simpletable", "table"].includes(tagName)) {
        groups[2].items.push(tagName);
      } else if (/xref|link|ref|image|fig|media|object/i.test(tagName)) {
        groups[3].items.push(tagName);
      } else if (/body|section|div|p|note|code|pre|example|context|steps|result/i.test(tagName)) {
        groups[4].items.push(tagName);
      } else {
        groups[5].items.push(tagName);
      }
    }

    return groups.filter((group) => group.items.length);
  }

  function updateAuthoringProfile(documentType: string, updater: (profile: { enabled: boolean; visibleElements: string[] }) => { enabled: boolean; visibleElements: string[] }) {
    setAuthoringProfiles((current) => {
      const existing = current[documentType] || { enabled: false, visibleElements: [] };
      return {
        ...current,
        [documentType]: updater(existing),
      };
    });
  }

  function renderAuthoringProfileWorkbench(documentType: string) {
    const profile = authoringProfiles[documentType] || { enabled: false, visibleElements: [] };
    const visible = new Set(profile.visibleElements || []);
    const groups = getAuthoringProfileGroups(documentType);
    const selectedCount = visible.size;

    return (
      <div className="authoring-profile-tab">
        <header className="authoring-profile-header">
          <div>
            <span>Authoring profile</span>
            <strong>{getDocumentTypeLabel(documentType)}</strong>
          </div>
          <label>
            <input
              type="checkbox"
              checked={profile.enabled}
              onChange={(event) => updateAuthoringProfile(documentType, (current) => ({
                ...current,
                enabled: event.target.checked,
              }))}
            />
            <span>Use this profile</span>
          </label>
        </header>
        <div className="authoring-profile-summary">
          <p>Choose which optional elements authors see in the ribbon, context menu, and Inspector. Schema validation still uses the full DITA model.</p>
          <strong>{selectedCount} selected</strong>
        </div>
        <div className="authoring-profile-grid">
          {groups.map((group) => (
            <section className="authoring-profile-card" key={group.id}>
              <header>
                <div>
                  <h3>{group.title}</h3>
                  <p>{group.description}</p>
                </div>
                <small>{group.items.length}</small>
              </header>
              <div className="authoring-profile-options">
                {group.items.map((tagName) => (
                  <label key={tagName}>
                    <input
                      type="checkbox"
                      checked={visible.has(tagName)}
                      onChange={() => updateAuthoringProfile(documentType, (current) => {
                        const next = new Set(current.visibleElements || []);
                        if (next.has(tagName)) {
                          next.delete(tagName);
                        } else {
                          next.add(tagName);
                        }
                        return {
                          ...current,
                          enabled: true,
                          visibleElements: [...next].sort((a, b) => a.localeCompare(b)),
                        };
                      })}
                    />
                    <span>{tagName}</span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  function createVisualTemplateSourceFromFile(node, path) {
    const normalizedPath = normalizeProjectPath(path || node.githubPath || node.name || "");
    const content = fileHistories[node.id]?.present ?? node.content ?? "";
    const parsedSource = parseXml(content);
    const rootName = parsedSource.doc?.documentElement?.tagName || node.ditaType || "xml";
    const title = parsedSource.doc
      ? parsedSource.doc.getElementsByTagName("title")[0]?.textContent?.trim() || node.name
      : node.name;
    const shortdesc = parsedSource.doc?.getElementsByTagName("shortdesc")[0]?.textContent?.trim() || "";
    const body = parsedSource.doc
      ? Array.from(parsedSource.doc.getElementsByTagName("p") as HTMLCollectionOf<Element>)
          .slice(0, 3)
          .map((paragraph) => paragraph.textContent?.trim())
          .filter(Boolean)
      : [];
    const topicrefs = parsedSource.doc
      ? Array.from(parsedSource.doc.getElementsByTagName("topicref") as HTMLCollectionOf<Element>)
          .map((topicref) => topicref.getAttribute("href") || topicref.getAttribute("navtitle") || "")
          .filter(Boolean)
      : [];

    return {
      id: node.id,
      name: node.name,
      path: normalizedPath,
      githubPath: normalizeProjectPath(node.githubPath || ""),
      rootName,
      title,
      shortdesc,
      body,
      topicrefs,
    };
  }

  function getVisualTemplateSources() {
    return collectProjectFiles(projectTree)
      .filter(({ node }) => node.type === "file")
      .filter(({ node }) => getProjectFileKind(node) === "xml")
      .map(({ node, path }) => createVisualTemplateSourceFromFile(node, path));
  }

  function getVisualTemplatePathVariants(value = "") {
    const normalized = normalizeProjectPath(value);
    const withoutContentRoot = normalized.replace(/^content\//, "");
    const withContentRoot = withoutContentRoot ? normalizeProjectPath(`content/${withoutContentRoot}`) : "";
    return new Set([normalized, withoutContentRoot, withContentRoot].filter(Boolean));
  }

  function visualTemplateSourceMatchesDrop(source, droppedSource) {
    if (!source || !droppedSource) return false;
    if (source.id && droppedSource.id && source.id === droppedSource.id) return true;

    const sourcePaths = new Set([
      ...getVisualTemplatePathVariants(source.path),
      ...getVisualTemplatePathVariants(source.githubPath),
      ...getVisualTemplatePathVariants(source.href),
    ]);
    const droppedPaths = [
      ...getVisualTemplatePathVariants(droppedSource.path),
      ...getVisualTemplatePathVariants(droppedSource.githubPath),
      ...getVisualTemplatePathVariants(droppedSource.href),
    ];

    return droppedPaths.some((path) => sourcePaths.has(path));
  }

  function findVisualTemplateSourceForDrop(droppedSource, sources) {
    return sources.find((source) => visualTemplateSourceMatchesDrop(source, droppedSource)) || null;
  }

  function getVisualTemplateBindingValue(source, binding: string) {
    if (!source) {
      if (binding === "bodyParagraphs") return ["Paragraph and section content will flow here."];
      if (binding === "topicrefs") return [];
      return "";
    }

    if (binding === "title") return source.title || source.name;
    if (binding === "shortdesc") return source.shortdesc || "Short description slot";
    if (binding === "bodyParagraphs") return source.body?.length ? source.body : ["Paragraph and section content will flow here."];
    if (binding === "topicrefs") return source.topicrefs || [];
    if (binding === "rootName") return source.rootName;
    if (binding === "path") return source.path;
    return "";
  }

  function getVisualTemplateBindingOptions(source) {
    const baseOptions = [
      { value: "title", label: "Title", detail: "Document title" },
      { value: "shortdesc", label: "Shortdesc", detail: "Short description" },
      { value: "bodyParagraphs", label: "Body paragraphs", detail: "Main content" },
      { value: "topicrefs", label: "Topicrefs", detail: "Map links" },
      { value: "rootName", label: "Root element", detail: "DITA type" },
      { value: "path", label: "File path", detail: "Source path" },
    ];

    if (!source) return baseOptions.map((option) => ({ ...option, hasValue: false }));

    return baseOptions.map((option) => {
      const value = getVisualTemplateBindingValue(source, option.value);
      const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(String(value || "").trim());
      return { ...option, hasValue };
    });
  }

  function getVisualTemplateBindingPreview(source, binding: string) {
    const value = getVisualTemplateBindingValue(source, binding);
    if (Array.isArray(value)) {
      if (!value.length) return "No values found";
      return value.slice(0, 3).join(" · ");
    }
    return String(value || "No value found");
  }

  function getVisualTemplateSourceLabel(source) {
    if (!source) return "";
    const title = source.title && source.title !== source.name ? ` — ${source.title}` : "";
    return `${source.name}${title}`;
  }

  function getVisualTemplateSlotLabel(binding = "") {
    const option = getVisualTemplateBindingOptions(null).find((item) => item.value === binding);
    return option?.label || binding || "Slot";
  }

  function cloneVisualTemplateHistoryModel(model: any) {
    return normalizeVisualTemplateModel(JSON.parse(JSON.stringify(model || defaultVisualTemplateModel)));
  }

  function getVisualTemplateHistorySignature(model: any) {
    return JSON.stringify(normalizeVisualTemplateModel(model || defaultVisualTemplateModel));
  }

  function resetVisualTemplateHistory(nextModel = visualTemplateModelRef.current) {
    visualTemplateUndoStackRef.current = [];
    visualTemplateRedoStackRef.current = [];
    visualTemplateDragHistorySnapshotRef.current = null;
    visualTemplateModelRef.current = cloneVisualTemplateHistoryModel(nextModel);
    setVisualTemplateHistoryVersion((version) => version + 1);
  }

  function loadVisualTemplateModel(nextModel: any) {
    const normalizedModel = cloneVisualTemplateHistoryModel(nextModel);
    visualTemplateModelRef.current = normalizedModel;
    setVisualTemplateModel(normalizedModel);
    resetVisualTemplateHistory(normalizedModel);
  }

  function applyVisualTemplateModelUpdate(
    updater: any,
    options: { recordHistory?: boolean } = {},
  ) {
    const recordHistory = options.recordHistory !== false;
    setVisualTemplateModel((current) => {
      const nextValue = typeof updater === "function" ? updater(current) : updater;
      const nextModel = cloneVisualTemplateHistoryModel(nextValue);
      if (getVisualTemplateHistorySignature(current) === getVisualTemplateHistorySignature(nextModel)) {
        return current;
      }

      if (recordHistory) {
        visualTemplateUndoStackRef.current = [
          ...visualTemplateUndoStackRef.current.slice(-49),
          cloneVisualTemplateHistoryModel(current),
        ];
        visualTemplateRedoStackRef.current = [];
        setVisualTemplateHistoryVersion((version) => version + 1);
      }

      visualTemplateModelRef.current = nextModel;
      return nextModel;
    });
  }

  function keepVisualTemplateSelectionInModel(model: any) {
    setVisualTemplateSelectedRegionId((selectedId) => {
      if (selectedId && model.regions.some((region) => region.id === selectedId)) return selectedId;
      return model.regions[0]?.id || null;
    });
  }

  function undoVisualTemplateChange() {
    const previousModel = visualTemplateUndoStackRef.current.pop();
    if (!previousModel) return;
    const currentModel = cloneVisualTemplateHistoryModel(visualTemplateModelRef.current);
    visualTemplateRedoStackRef.current = [
      ...visualTemplateRedoStackRef.current.slice(-49),
      currentModel,
    ];
    const normalizedPrevious = cloneVisualTemplateHistoryModel(previousModel);
    visualTemplateModelRef.current = normalizedPrevious;
    setVisualTemplateModel(normalizedPrevious);
    keepVisualTemplateSelectionInModel(normalizedPrevious);
    setVisualTemplateHistoryVersion((version) => version + 1);
  }

  function redoVisualTemplateChange() {
    const nextModel = visualTemplateRedoStackRef.current.pop();
    if (!nextModel) return;
    const currentModel = cloneVisualTemplateHistoryModel(visualTemplateModelRef.current);
    visualTemplateUndoStackRef.current = [
      ...visualTemplateUndoStackRef.current.slice(-49),
      currentModel,
    ];
    const normalizedNext = cloneVisualTemplateHistoryModel(nextModel);
    visualTemplateModelRef.current = normalizedNext;
    setVisualTemplateModel(normalizedNext);
    keepVisualTemplateSelectionInModel(normalizedNext);
    setVisualTemplateHistoryVersion((version) => version + 1);
  }

  function commitVisualTemplateDragHistory() {
    const snapshot = visualTemplateDragHistorySnapshotRef.current;
    visualTemplateDragHistorySnapshotRef.current = null;
    if (!snapshot) return;
    if (getVisualTemplateHistorySignature(snapshot) === getVisualTemplateHistorySignature(visualTemplateModelRef.current)) return;
    visualTemplateUndoStackRef.current = [
      ...visualTemplateUndoStackRef.current.slice(-49),
      cloneVisualTemplateHistoryModel(snapshot),
    ];
    visualTemplateRedoStackRef.current = [];
    setVisualTemplateHistoryVersion((version) => version + 1);
  }

  function setVisualTemplateRegionSource(regionId: string, sourceId: string) {
    if (!sourceId) {
      resetVisualTemplateRegion(regionId);
      return;
    }

    const source = getVisualTemplateBoundSources().find((item) => item.id === sourceId);
    if (!source) return;
    updateVisualTemplateRegion(regionId, {
      sourceFileId: source.id,
      sourcePath: source.path,
      sourceName: source.name,
      sourceKind: source.rootName,
    });
    setVisualTemplateSourceId(source.id);
  }

  function updateVisualTemplateRegion(regionId: string, updates: Record<string, any>) {
    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: current.regions.map((region) => (
        region.id === regionId ? { ...region, ...updates } : region
      )),
    }));
  }

  function startEditingVisualTemplateRegionLabel(region: any) {
    setVisualTemplateSelectedRegionId(region.id);
    setVisualTemplateEditingRegionId(region.id);
    setVisualTemplateEditingLabel(region.label || (region.kind === "slot" ? "Slot" : "Container"));
  }

  function commitVisualTemplateRegionLabel() {
    if (!visualTemplateEditingRegionId) return;
    const region = visualTemplateModel.regions.find((item) => item.id === visualTemplateEditingRegionId);
    const fallbackLabel = region?.kind === "slot" ? "Slot" : "Container";
    const nextLabel = visualTemplateEditingLabel.trim() || fallbackLabel;
    updateVisualTemplateRegion(visualTemplateEditingRegionId, { label: nextLabel });
    setVisualTemplateEditingRegionId(null);
    setVisualTemplateEditingLabel("");
  }

  function cancelVisualTemplateRegionLabelEdit() {
    setVisualTemplateEditingRegionId(null);
    setVisualTemplateEditingLabel("");
  }

  function updateVisualTemplateRegionLayout(
    regionId: string,
    updates: Record<string, any>,
    options: { recordHistory?: boolean } = {},
  ) {
    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: current.regions.map((region) => (
        region.id === regionId
          ? {
              ...region,
              layout: {
                ...visualTemplateStyleDefaults.layout,
                ...(region.layout || {}),
                ...updates,
              },
            }
          : region
      )),
    }), options);
  }

  function updateVisualTemplateRegionStyle(regionId: string, styleKey: "style" | "textStyle", updates: Record<string, any>) {
    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: current.regions.map((region) => (
        region.id === regionId
          ? {
              ...region,
              [styleKey]: {
                ...(styleKey === "style" ? visualTemplateStyleDefaults.style : visualTemplateStyleDefaults.textStyle),
                ...(region[styleKey] || {}),
                ...updates,
              },
            }
          : region
      )),
    }));
  }

  function updateVisualTemplateRegionMeta(regionId: string, updates: Record<string, any>) {
    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: current.regions.map((region) => (
        region.id === regionId ? { ...region, ...updates } : region
      )),
    }));
  }

  function getVisualTemplateLayerRows() {
    const childrenByParent = new Map<string, any[]>();
    visualTemplateModel.regions.forEach((region) => {
      const parentId = region.parentId || "";
      const children = childrenByParent.get(parentId) || [];
      children.push(region);
      childrenByParent.set(parentId, children);
    });
    const sortByLayer = (items: any[]) => [...items].sort((a, b) => (
      normalizeVisualTemplateLayout(b.layout).zIndex - normalizeVisualTemplateLayout(a.layout).zIndex ||
      String(a.label || a.id).localeCompare(String(b.label || b.id))
    ));
    const rows: Array<{ region: any; depth: number }> = [];
    const visit = (parentId = "", depth = 0) => {
      sortByLayer(childrenByParent.get(parentId) || []).forEach((region) => {
        rows.push({ region, depth });
        visit(region.id, depth + 1);
      });
    };
    visit();
    return rows;
  }

  function getVisualTemplateLayerTreeRows() {
    const childrenByParent = new Map<string, any[]>();
    visualTemplateModel.regions.forEach((region) => {
      const parentId = region.parentId || "";
      const children = childrenByParent.get(parentId) || [];
      children.push(region);
      childrenByParent.set(parentId, children);
    });
    const sortByLayer = (items: any[]) => [...items].sort((a, b) => (
      normalizeVisualTemplateLayout(b.layout).zIndex - normalizeVisualTemplateLayout(a.layout).zIndex ||
      String(a.label || a.id).localeCompare(String(b.label || b.id))
    ));
    const query = visualTemplateLayerSearch.trim().toLowerCase();
    const matches = (region: any) => !query || String(region.label || region.id || "").toLowerCase().includes(query);
    const descendantMatches = (region: any): boolean => matches(region) || (childrenByParent.get(region.id) || []).some(descendantMatches);
    const rows: Array<{ region: any; depth: number; hasChildren: boolean; expanded: boolean }> = [];
    const visit = (parentId = "", depth = 0) => {
      sortByLayer(childrenByParent.get(parentId) || []).forEach((region) => {
        if (query && !descendantMatches(region)) return;
        const hasChildren = Boolean((childrenByParent.get(region.id) || []).length);
        const expanded = query ? true : visualTemplateExpandedLayerIds.has(region.id);
        rows.push({ region, depth, hasChildren, expanded });
        if (hasChildren && expanded) visit(region.id, depth + 1);
      });
    };
    visit();
    return rows;
  }

  function toggleVisualTemplateLayerExpanded(regionId: string) {
    setVisualTemplateExpandedLayerIds((current) => {
      const next = new Set(current);
      if (next.has(regionId)) {
        next.delete(regionId);
      } else {
        next.add(regionId);
      }
      return next;
    });
  }

  function moveVisualTemplateLayer(regionId: string, direction: "up" | "down") {
    const region = visualTemplateModel.regions.find((item) => item.id === regionId);
    if (!region) return;
    const siblings = visualTemplateModel.regions
      .filter((item) => (item.parentId || "") === (region.parentId || ""))
      .sort((a, b) => normalizeVisualTemplateLayout(b.layout).zIndex - normalizeVisualTemplateLayout(a.layout).zIndex);
    const currentIndex = siblings.findIndex((item) => item.id === regionId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;
    const target = siblings[targetIndex];
    const currentLayer = normalizeVisualTemplateLayout(region.layout).zIndex;
    const targetLayer = normalizeVisualTemplateLayout(target.layout).zIndex;
    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: current.regions.map((item) => {
        if (item.id === region.id) {
          return { ...item, layout: { ...normalizeVisualTemplateLayout(item.layout), zIndex: targetLayer } };
        }
        if (item.id === target.id) {
          return { ...item, layout: { ...normalizeVisualTemplateLayout(item.layout), zIndex: currentLayer } };
        }
        return item;
      }),
    }));
  }

  function reorderVisualTemplateLayer(dragRegionId: string | null, targetRegionId: string) {
    if (!dragRegionId || dragRegionId === targetRegionId) return;
    const dragged = visualTemplateModel.regions.find((region) => region.id === dragRegionId);
    const target = visualTemplateModel.regions.find((region) => region.id === targetRegionId);
    if (!dragged || !target || (dragged.parentId || "") !== (target.parentId || "")) return;
    const draggedLayer = normalizeVisualTemplateLayout(dragged.layout).zIndex;
    const targetLayer = normalizeVisualTemplateLayout(target.layout).zIndex;
    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: current.regions.map((region) => {
        if (region.id === dragged.id) {
          return { ...region, layout: { ...normalizeVisualTemplateLayout(region.layout), zIndex: targetLayer } };
        }
        if (region.id === target.id) {
          return { ...region, layout: { ...normalizeVisualTemplateLayout(region.layout), zIndex: draggedLayer } };
        }
        return region;
      }),
    }));
    setVisualTemplateSelectedRegionId(dragged.id);
  }

  function updateVisualTemplateGridSettings(updates: Record<string, any>) {
    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      gridSettings: normalizeVisualTemplateGridSettings({
        ...(current.gridSettings || visualTemplateGridDefaults),
        ...updates,
      }),
    }));
  }

  function getVisualTemplateLayoutStyle(region: any): React.CSSProperties {
    const layout = normalizeVisualTemplateLayout(region?.layout);
    return {
      height: layout.height,
      left: layout.x,
      position: "absolute",
      top: layout.y,
      width: layout.width,
      zIndex: layout.zIndex,
    };
  }

  function getVisualTemplateCssStyle(region: any): React.CSSProperties {
    const style = normalizeVisualTemplateStyle(region?.style, visualTemplateStyleDefaults.style);
    const shadowPreset = String(style.shadowPreset || "none");
    const shadowValue = shadowPreset === "none"
      ? undefined
      : shadowPreset === "soft"
        ? `0 18px 38px ${rgbaFromHexColor(style.shadowColor || "#23406f", style.shadowOpacity ?? 14)}`
        : shadowPreset === "lifted"
          ? `0 10px 18px ${rgbaFromHexColor(style.shadowColor || "#23406f", style.shadowOpacity ?? 18)}, 0 2px 6px ${rgbaFromHexColor(style.shadowColor || "#23406f", 10)}`
          : `${Number(style.shadowX ?? 0)}px ${Number(style.shadowY ?? 12)}px ${Number(style.shadowBlur ?? 24)}px ${rgbaFromHexColor(style.shadowColor || "#23406f", style.shadowOpacity ?? 12)}`;
    const animationName = String(style.animationName || "none");
    const surfaceBackground = style.fillMode === "gradient"
      ? `linear-gradient(${Number(style.gradientAngle ?? 135)}deg, ${style.gradientFrom || style.backgroundColor || "#ffffff"}, ${style.gradientTo || "#eef5ff"})`
      : style.backgroundColor || undefined;
    const imageBackground = style.backgroundImageMode === "image" && style.backgroundImage
      ? cssUrlValue(style.backgroundImage)
      : "";
    const overlayBackground = imageBackground && Number(style.backgroundOverlayOpacity || 0) > 0
      ? `linear-gradient(${rgbaFromHexColor(style.backgroundOverlayColor || "#000000", style.backgroundOverlayOpacity)}, ${rgbaFromHexColor(style.backgroundOverlayColor || "#000000", style.backgroundOverlayOpacity)})`
      : "";
    const backgrounds = [overlayBackground, imageBackground, surfaceBackground].filter(Boolean);
    const backgroundLayerCount = backgrounds.length;
    const imageLayerPosition = style.backgroundPosition || "center";
    const imageLayerRepeat = style.backgroundRepeat || "no-repeat";
    const imageLayerSize = style.backgroundSize || "cover";
    const layeredBackgroundPosition = imageBackground
      ? (overlayBackground ? ["center", imageLayerPosition, "center"] : [imageLayerPosition, "center"]).slice(0, backgroundLayerCount).join(", ")
      : undefined;
    const layeredBackgroundRepeat = imageBackground
      ? (overlayBackground ? ["no-repeat", imageLayerRepeat, "no-repeat"] : [imageLayerRepeat, "no-repeat"]).slice(0, backgroundLayerCount).join(", ")
      : undefined;
    const layeredBackgroundSize = imageBackground
      ? (overlayBackground ? ["cover", imageLayerSize, "cover"] : [imageLayerSize, "cover"]).slice(0, backgroundLayerCount).join(", ")
      : undefined;
    return {
      animationDelay: animationName === "none" ? undefined : `${Number(style.animationDelay ?? 0)}ms`,
      animationDuration: animationName === "none" ? undefined : `${Number(style.animationDuration ?? 600)}ms`,
      animationName: animationName === "none" ? undefined : `visual-template-${animationName}`,
      animationTimingFunction: animationName === "none" ? undefined : "ease",
      background: backgrounds.length ? backgrounds.join(", ") : undefined,
      backgroundPosition: layeredBackgroundPosition,
      backgroundRepeat: layeredBackgroundRepeat,
      backgroundSize: layeredBackgroundSize,
      borderColor: style.borderColor || undefined,
      borderRadius: Number.isFinite(Number(style.borderRadius)) ? Number(style.borderRadius) : undefined,
      borderStyle: style.borderWidth === 0 ? "none" : "dashed",
      borderWidth: Number.isFinite(Number(style.borderWidth)) ? Number(style.borderWidth) : undefined,
      boxShadow: shadowValue,
      minHeight: region?.kind === "slot"
        ? undefined
        : Number.isFinite(Number(style.minHeight)) ? Number(style.minHeight) : undefined,
      padding: Number.isFinite(Number(style.padding)) ? Number(style.padding) : undefined,
      textAlign: region?.textStyle?.textAlign || undefined,
    };
  }

  function getVisualTemplateTextCssStyle(region: any): React.CSSProperties {
    const textStyle = normalizeVisualTemplateStyle(region?.textStyle, visualTemplateStyleDefaults.textStyle);
    return {
      color: textStyle.color || undefined,
      fontSize: Number.isFinite(Number(textStyle.fontSize)) ? Number(textStyle.fontSize) : undefined,
      fontWeight: Number.isFinite(Number(textStyle.fontWeight)) ? Number(textStyle.fontWeight) : undefined,
      textAlign: textStyle.textAlign || undefined,
    };
  }

  function selectVisualTemplateRegion(event: React.MouseEvent<HTMLElement>, regionId: string) {
    event.stopPropagation();
    setVisualTemplateSelectedRegionId(regionId);
  }

  function getVisualTemplateSnapPeers(regionId: string) {
    const region = visualTemplateModel.regions.find((item) => item.id === regionId);
    return visualTemplateModel.regions.filter((item) => (
      item.id !== regionId &&
      (item.parentId || "") === (region?.parentId || "")
    ));
  }

  function snapVisualTemplateNumber(value: number, target: number, threshold: number) {
    return Math.abs(value - target) <= threshold ? target : value;
  }

  function getVisualTemplateResizeLayout(
    startLayout: Record<string, number>,
    dx: number,
    dy: number,
    handle: VisualTemplateResizeHandle,
    regionKind?: string,
  ) {
    const layout = normalizeVisualTemplateLayout(startLayout);
    const minWidth = regionKind === "slot" ? 24 : 40;
    const minHeight = regionKind === "slot" ? 18 : 24;
    const startRight = layout.x + layout.width;
    const startBottom = layout.y + layout.height;
    let nextX = layout.x;
    let nextY = layout.y;
    let nextWidth = layout.width;
    let nextHeight = layout.height;

    if (handle.includes("e")) {
      nextWidth = Math.max(minWidth, Math.min(visualTemplatePageSize.width - layout.x, layout.width + dx));
    }
    if (handle.includes("s")) {
      nextHeight = Math.max(minHeight, Math.min(visualTemplatePageSize.height - layout.y, layout.height + dy));
    }
    if (handle.includes("w")) {
      nextX = Math.max(0, Math.min(startRight - minWidth, layout.x + dx));
      nextWidth = startRight - nextX;
    }
    if (handle.includes("n")) {
      nextY = Math.max(0, Math.min(startBottom - minHeight, layout.y + dy));
      nextHeight = startBottom - nextY;
    }

    return {
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight,
    };
  }

  function resolveVisualTemplateSnappedLayout(
    regionId: string,
    rawLayout: Record<string, number>,
    mode: "move" | "resize",
    gridSettings = normalizeVisualTemplateGridSettings(visualTemplateModel.gridSettings),
    resizeHandle: VisualTemplateResizeHandle = "se",
  ) {
    let layout = normalizeVisualTemplateLayout(rawLayout);
    const guides: Array<{ axis: "x" | "y"; value: number; from: number; to: number; label?: string }> = [];
    const threshold = Number(gridSettings.snapThreshold || 4);

    if (gridSettings.snapToGrid) {
      const gridSize = Number(gridSettings.gridSize || 16);
      const snapGrid = (value: number) => Math.round(value / gridSize) * gridSize;
      if (mode === "resize") {
        const right = layout.x + layout.width;
        const bottom = layout.y + layout.height;
        const snappedLeft = snapVisualTemplateNumber(layout.x, snapGrid(layout.x), threshold);
        const snappedTop = snapVisualTemplateNumber(layout.y, snapGrid(layout.y), threshold);
        const snappedRight = snapVisualTemplateNumber(right, snapGrid(right), threshold);
        const snappedBottom = snapVisualTemplateNumber(bottom, snapGrid(bottom), threshold);
        const left = resizeHandle.includes("w") ? snappedLeft : layout.x;
        const top = resizeHandle.includes("n") ? snappedTop : layout.y;
        layout = {
          ...layout,
          x: left,
          y: top,
          width: Math.max(40, (resizeHandle.includes("e") ? snappedRight : right) - left),
          height: Math.max(24, (resizeHandle.includes("s") ? snappedBottom : bottom) - top),
        };
      } else {
        layout = {
          ...layout,
          x: snapVisualTemplateNumber(layout.x, snapGrid(layout.x), threshold),
          y: snapVisualTemplateNumber(layout.y, snapGrid(layout.y), threshold),
        };
      }
    }

    if (gridSettings.snapToObjects) {
      const currentEdges = () => ({
        left: layout.x,
        right: layout.x + layout.width,
        centerX: layout.x + layout.width / 2,
        top: layout.y,
        bottom: layout.y + layout.height,
        centerY: layout.y + layout.height / 2,
      });
      const xCandidates = [
        { kind: "left", value: 0 },
        { kind: "centerX", value: visualTemplatePageSize.width / 2 },
        { kind: "right", value: visualTemplatePageSize.width },
      ];
      const yCandidates = [
        { kind: "top", value: 0 },
        { kind: "centerY", value: visualTemplatePageSize.height / 2 },
        { kind: "bottom", value: visualTemplatePageSize.height },
      ];

      for (const peer of getVisualTemplateSnapPeers(regionId)) {
        const peerLayout = normalizeVisualTemplateLayout(peer.layout);
        xCandidates.push(
          { kind: "left", value: peerLayout.x },
          { kind: "centerX", value: peerLayout.x + peerLayout.width / 2 },
          { kind: "right", value: peerLayout.x + peerLayout.width },
        );
        yCandidates.push(
          { kind: "top", value: peerLayout.y },
          { kind: "centerY", value: peerLayout.y + peerLayout.height / 2 },
          { kind: "bottom", value: peerLayout.y + peerLayout.height },
        );
      }

      const snapAxis = (axis: "x" | "y", candidates: Array<{ kind: string; value: number }>) => {
        const edges = currentEdges();
        const edgeKeys = axis === "x"
          ? mode === "resize"
            ? [
                ...(resizeHandle.includes("w") ? ["left"] : []),
                ...(resizeHandle.includes("e") ? ["right"] : []),
              ]
            : ["left", "centerX", "right"]
          : mode === "resize"
            ? [
                ...(resizeHandle.includes("n") ? ["top"] : []),
                ...(resizeHandle.includes("s") ? ["bottom"] : []),
              ]
            : ["top", "centerY", "bottom"];
        for (const edgeKey of edgeKeys) {
          const edgeValue = edges[edgeKey];
          const match = candidates.find((candidate) => Math.abs(edgeValue - candidate.value) <= threshold);
          if (!match) continue;
          if (axis === "x") {
            if (mode === "resize" && edgeKey === "right") {
              layout = { ...layout, width: Math.max(40, match.value - layout.x) };
            } else if (mode === "resize" && edgeKey === "left") {
              const right = layout.x + layout.width;
              layout = { ...layout, x: Math.max(0, Math.min(right - 40, match.value)), width: Math.max(40, right - match.value) };
            } else if (mode !== "resize") {
              const offset = edgeKey === "left" ? 0 : edgeKey === "centerX" ? layout.width / 2 : layout.width;
              layout = { ...layout, x: Math.max(0, Math.min(visualTemplatePageSize.width - layout.width, match.value - offset)) };
            }
            guides.push({ axis: "x", value: match.value, from: 0, to: visualTemplatePageSize.height, label: match.kind });
          } else {
            if (mode === "resize" && edgeKey === "bottom") {
              layout = { ...layout, height: Math.max(24, match.value - layout.y) };
            } else if (mode === "resize" && edgeKey === "top") {
              const bottom = layout.y + layout.height;
              layout = { ...layout, y: Math.max(0, Math.min(bottom - 24, match.value)), height: Math.max(24, bottom - match.value) };
            } else if (mode !== "resize") {
              const offset = edgeKey === "top" ? 0 : edgeKey === "centerY" ? layout.height / 2 : layout.height;
              layout = { ...layout, y: Math.max(0, Math.min(visualTemplatePageSize.height - layout.height, match.value - offset)) };
            }
            guides.push({ axis: "y", value: match.value, from: 0, to: visualTemplatePageSize.width, label: match.kind });
          }
          break;
        }
      };

      snapAxis("x", xCandidates);
      snapAxis("y", yCandidates);
    }

    layout = {
      ...layout,
      x: Math.max(0, Math.min(visualTemplatePageSize.width - layout.width, layout.x)),
      y: Math.max(0, Math.min(visualTemplatePageSize.height - layout.height, layout.y)),
      width: Math.max(40, Math.min(visualTemplatePageSize.width - layout.x, layout.width)),
      height: Math.max(24, Math.min(visualTemplatePageSize.height - layout.y, layout.height)),
    };

    return { layout, guides: guides.slice(0, 4) };
  }

  function alignVisualTemplateSelection(alignment: "left" | "center" | "right" | "top" | "middle" | "bottom") {
    const selectedRegion = visualTemplateModel.regions.find((region) => region.id === visualTemplateSelectedRegionId);
    if (!selectedRegion) return;
    const layout = normalizeVisualTemplateLayout(selectedRegion.layout);
    const updates: Record<string, number> = {};
    if (alignment === "left") updates.x = 0;
    if (alignment === "center") updates.x = Math.round((visualTemplatePageSize.width - layout.width) / 2);
    if (alignment === "right") updates.x = visualTemplatePageSize.width - layout.width;
    if (alignment === "top") updates.y = 0;
    if (alignment === "middle") updates.y = Math.round((visualTemplatePageSize.height - layout.height) / 2);
    if (alignment === "bottom") updates.y = visualTemplatePageSize.height - layout.height;
    updateVisualTemplateRegionLayout(selectedRegion.id, updates);
  }

  function distributeVisualTemplateRegions(direction: "horizontal" | "vertical") {
    const regions = visualTemplateModel.regions
      .filter((region) => !region.parentId)
      .map((region) => ({ region, layout: normalizeVisualTemplateLayout(region.layout) }));
    if (regions.length < 3) return;

    const sorted = [...regions].sort((a, b) => (
      direction === "horizontal" ? a.layout.x - b.layout.x : a.layout.y - b.layout.y
    ));
    const first = sorted[0].layout;
    const last = sorted[sorted.length - 1].layout;
    const totalSize = sorted.reduce((sum, item) => sum + (direction === "horizontal" ? item.layout.width : item.layout.height), 0);
    const available = direction === "horizontal"
      ? last.x + last.width - first.x - totalSize
      : last.y + last.height - first.y - totalSize;
    const gap = Math.max(0, available / (sorted.length - 1));

    let cursor = direction === "horizontal" ? first.x : first.y;
    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: current.regions.map((region) => {
        const sortedItem = sorted.find((item) => item.region.id === region.id);
        if (!sortedItem) return region;
        const nextLayout = {
          ...normalizeVisualTemplateLayout(region.layout),
          [direction === "horizontal" ? "x" : "y"]: Math.round(cursor),
        };
        cursor += (direction === "horizontal" ? sortedItem.layout.width : sortedItem.layout.height) + gap;
        return { ...region, layout: nextLayout };
      }),
    }));
  }

  function getVisualTemplateCanvasPoint(event: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) {
    const preview = visualTemplatePreviewRef.current;
    const gridSettings = normalizeVisualTemplateGridSettings(visualTemplateModel.gridSettings);
    const rect = preview?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.max(0, Math.min(visualTemplatePageSize.width, (event.clientX - rect.left) / gridSettings.zoom)),
      y: Math.max(0, Math.min(visualTemplatePageSize.height, (event.clientY - rect.top) / gridSettings.zoom)),
    };
  }

  function handleVisualTemplateMeasurePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!visualTemplateMeasureMode || event.target !== event.currentTarget) return;
    const point = getVisualTemplateCanvasPoint(event);
    if (!point) return;
    event.preventDefault();
    setVisualTemplateMeasurement({ startX: point.x, startY: point.y, endX: point.x, endY: point.y, measuring: true });
  }

  function handleVisualTemplateMeasurePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!visualTemplateMeasurement?.measuring) return;
    const point = getVisualTemplateCanvasPoint(event);
    if (!point) return;
    setVisualTemplateMeasurement((current) => (current ? { ...current, endX: point.x, endY: point.y } : current));
  }

  function handleVisualTemplateMeasurePointerUp() {
    setVisualTemplateMeasurement((current) => (current ? { ...current, measuring: false } : current));
  }

  function startVisualTemplateLayoutDrag(
    event: React.PointerEvent<HTMLElement>,
    region: any,
    mode: "move" | "resize",
    handle?: VisualTemplateResizeHandle,
  ) {
    if (region.locked) {
      event.stopPropagation();
      setVisualTemplateSelectedRegionId(region.id);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setVisualTemplateSelectedRegionId(region.id);
    visualTemplateDragHistorySnapshotRef.current = cloneVisualTemplateHistoryModel(visualTemplateModelRef.current);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setVisualTemplateLayoutDrag({
      id: region.id,
      kind: region.kind,
      mode,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      layout: normalizeVisualTemplateLayout(region.layout),
    });
  }

  function addVisualTemplateContainer() {
    const customCount = visualTemplateModel.regions.filter((region) => String(region.id || "").startsWith("container-")).length + 1;
    const id = `container-${Date.now()}`;
    const offset = Math.min(120, customCount * 18);
    const nextRegion = {
      id,
      label: `Container ${customCount}`,
      kind: "container",
      role: "custom",
      binding: "bodyParagraphs",
      notes: "Custom layout container.",
      layout: {
        x: 72 + offset,
        y: 76 + offset,
        width: 260,
        height: 160,
        zIndex: customCount + 2,
      },
      style: {
        ...visualTemplateStyleDefaults.style,
        backgroundColor: "#ffffff",
        borderColor: "#9bbcf2",
      },
      textStyle: {
        ...visualTemplateStyleDefaults.textStyle,
      },
    };

    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: [...current.regions, nextRegion],
    }));
    setVisualTemplateSelectedRegionId(id);
  }

  function deleteVisualTemplateContainer(regionId = visualTemplateSelectedRegionId) {
    if (!regionId) return;
    applyVisualTemplateModelUpdate((current) => {
      const idsToDelete = new Set([regionId]);
      let foundChild = true;
      while (foundChild) {
        foundChild = false;
        current.regions.forEach((region) => {
          if (region.parentId && idsToDelete.has(region.parentId) && !idsToDelete.has(region.id)) {
            idsToDelete.add(region.id);
            foundChild = true;
          }
        });
      }
      return {
        ...current,
        regions: current.regions.filter((region) => !idsToDelete.has(region.id)),
      };
    });
    setVisualTemplateSelectedRegionId((current) => {
      if (!current) return null;
      const selectedRegion = visualTemplateModel.regions.find((region) => region.id === current);
      return current === regionId || selectedRegion?.parentId === regionId ? null : current;
    });
  }

  function deleteDraggedVisualTemplateLayer() {
    if (!visualTemplateLayerDragId) return;
    deleteVisualTemplateContainer(visualTemplateLayerDragId);
    setVisualTemplateLayerDragId(null);
    setVisualTemplateDeleteDropActive(false);
  }

  function clearVisualTemplateCanvas() {
    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: [],
    }));
    setVisualTemplateSelectedRegionId(null);
  }

  function addVisualTemplateSlot() {
    const selectedRegion = visualTemplateModel.regions.find((region) => region.id === visualTemplateSelectedRegionId);
    const parentRegion = selectedRegion?.kind === "slot"
      ? visualTemplateModel.regions.find((region) => region.id === selectedRegion.parentId)
      : selectedRegion;
    const targetContainer = parentRegion?.kind === "container"
      ? parentRegion
      : visualTemplateModel.regions.find((region) => region.kind === "container" && !region.parentId);

    if (!targetContainer) {
      appendTerminalMessage("Add a container first, then add slots inside it.", {
        level: "warning",
        source: "Templates",
        open: false,
      });
      return;
    }

    const slotCount = visualTemplateModel.regions.filter((region) => String(region.id || "").startsWith("slot-")).length + 1;
    const id = `slot-${Date.now()}`;
    const nextSlot = {
      id,
      label: `Slot ${slotCount}`,
      kind: "slot",
      parentId: targetContainer.id,
      role: "custom",
      binding: "bodyParagraphs",
      notes: "Bindable slot inside a visual container.",
      layout: {
        x: 16,
        y: 18 + Math.min(140, slotCount * 18),
        width: Math.max(120, Math.min(220, normalizeVisualTemplateLayout(targetContainer.layout).width - 32)),
        height: 56,
        zIndex: slotCount + 4,
      },
      style: {
        ...visualTemplateStyleDefaults.style,
        backgroundColor: "#eef5ff",
        borderColor: "#9bbcf2",
        borderRadius: 6,
        padding: 8,
        minHeight: 48,
      },
      textStyle: {
        ...visualTemplateStyleDefaults.textStyle,
        color: "#2f5ea7",
        fontWeight: 750,
      },
    };

    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: [...current.regions, nextSlot],
    }));
    setVisualTemplateSelectedRegionId(id);
  }

  function resetVisualTemplateRegion(regionId: string) {
    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: current.regions.map((region) => {
        if (region.id !== regionId) return region;
        const {
          sourceFileId,
          sourceKind,
          sourceName,
          sourcePath,
          ...rest
        } = region;
        return rest;
      }),
    }));
  }

  function getVisualTemplateRegionSource(region, sources = getVisualTemplateSources()) {
    return findVisualTemplateSourceForDrop({
      id: region?.sourceFileId,
      path: region?.sourcePath,
    }, sources);
  }

  function getVisualTemplateBoundSources(sources = getVisualTemplateSources()) {
    const sourceMap = new Map<string, any>();
    visualTemplateModel.regions.forEach((region) => {
      const source = getVisualTemplateRegionSource(region, sources);
      if (source) {
        sourceMap.set(source.id, source);
      }
    });
    return [...sourceMap.values()];
  }

  function removeVisualTemplateSource(source) {
    applyVisualTemplateModelUpdate((current) => ({
      ...current,
      regions: current.regions.map((region) => {
        const isRegionSource =
          (source.id && region.sourceFileId === source.id) ||
          visualTemplateSourceMatchesDrop(source, {
            id: region.sourceFileId,
            path: region.sourcePath,
          });
        if (!isRegionSource) return region;
        const {
          sourceFileId,
          sourceKind,
          sourceName,
          sourcePath,
          ...rest
        } = region;
        return rest;
      }),
    }));
    setVisualTemplateSourceId((current) => (current === source.id ? null : current));
  }

  function getDroppedVisualTemplateSource(event: React.DragEvent<HTMLElement>) {
    const projectNodeId = event.dataTransfer.getData("application/x-xml-editor-project-node");
    if (projectNodeId) {
      const match = findProjectNode(projectTree, projectNodeId);
      if (match?.node?.type === "file") {
        return {
          id: match.node.id,
          name: match.node.name,
          path: getProjectFilePath(projectTree, match.node.id),
          githubPath: match.node.githubPath || "",
          kind: match.node.ditaType || "file",
        };
      }
    }

    const projectFileData = event.dataTransfer.getData("application/x-dita-project-file");
    if (!projectFileData) return null;

    try {
      const parsedFile = JSON.parse(projectFileData);
      if (parsedFile && (typeof parsedFile.path === "string" || typeof parsedFile.href === "string")) {
        return parsedFile;
      }
    } catch {
      return null;
    }

    return null;
  }

  function canDropVisualTemplateSource(event: React.DragEvent<HTMLElement>) {
    if (visualTemplateModel.artifactType !== "binding") return false;
    return Array.from(event.dataTransfer.types).some((type) => (
      type === "application/x-xml-editor-project-node" || type === "application/x-dita-project-file"
    ));
  }

  async function bindDroppedFileToVisualRegion(event: React.DragEvent<HTMLElement>, regionId: string) {
    event.preventDefault();
    event.stopPropagation();
    setVisualTemplateDropRegionId(null);

    if (visualTemplateModel.artifactType !== "binding") {
      appendTerminalMessage("Save the visual template first. DITA files are bound later in a separate template binding document.", {
        level: "info",
        source: "Templates",
        open: false,
      });
      return;
    }

    const droppedSource = getDroppedVisualTemplateSource(event);
    if (!droppedSource) return;

    let sources = getVisualTemplateSources();
    let source = findVisualTemplateSourceForDrop(droppedSource, sources);
    const matchedNode = droppedSource.id ? findProjectNode(projectTree, droppedSource.id)?.node : null;
    if (matchedNode?.type === "file" && (!source || (!fileHistories[matchedNode.id]?.present && !matchedNode.content && matchedNode.githubPath))) {
      const loadedFile = await loadGitHubFileIfNeeded(matchedNode);
      if (loadedFile) {
        source = createVisualTemplateSourceFromFile(
          loadedFile,
          getProjectFilePath(projectTree, loadedFile.id) || loadedFile.githubPath || loadedFile.name,
        );
        sources = sources.filter((item) => item.id !== source.id).concat(source);
      }
    }

    if (!source) {
      appendTerminalMessage("Only DITA XML topics and maps can be bound to template binding containers for now.", {
        level: "warning",
        source: "Templates",
        open: false,
      });
      return;
    }

    updateVisualTemplateRegion(regionId, {
      sourceFileId: source.id,
      sourcePath: source.path,
      sourceName: source.name,
      sourceKind: source.rootName,
    });
    setVisualTemplateSourceId(source.id);
  }

  function handleVisualTemplateDragOver(event: React.DragEvent<HTMLElement>, regionId: string) {
    if (!canDropVisualTemplateSource(event)) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setVisualTemplateDropRegionId(regionId);
  }

  function handleVisualTemplateDragLeave(event: React.DragEvent<HTMLElement>, regionId: string) {
    if (visualTemplateDropRegionId !== regionId) return;
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setVisualTemplateDropRegionId(null);
  }

  function getVisualTemplateExistingPath() {
    const activeTemplatePath = activeFileKind === "visual-template" && activeFile?.githubPath
      ? activeFile.githubPath
      : "";
    return normalizeProjectPath(visualTemplateModel.filePath || activeTemplatePath || "");
  }

  function getVisualTemplateDraftPath(filePathOverride = "") {
    if (filePathOverride) return normalizeProjectPath(filePathOverride);

    const existingPath = getVisualTemplateExistingPath();
    if (existingPath) return existingPath;

    const isBinding = visualTemplateModel.artifactType === "binding";
    const fallbackName = isBinding ? "template-binding" : "visual-template";
    const slug = slugifySpecializationName(visualTemplateModel.name || fallbackName) || fallbackName;
    return isBinding
      ? `visual_template_bindings/${slug}.af-binding.json`
      : `visual_templates/${slug}.af-template.json`;
  }

  function getSuggestedVisualTemplateFileName() {
    const isBinding = visualTemplateModel.artifactType === "binding";
    const fallbackName = isBinding ? "template-binding" : "visual-template";
    const slug = slugifyWorkspaceArtifactName(visualTemplateModel.name || fallbackName) || fallbackName;
    return normalizeFileName(slug, isBinding ? "visual-template-binding" : "visual-template");
  }

  async function saveVisualTemplateDraft(filePathOverride = "") {
    const explicitPath = typeof filePathOverride === "string" ? filePathOverride : "";
    const existingPath = getVisualTemplateExistingPath();
    if (!explicitPath && !existingPath) {
      setVisualTemplateSaveAsOpen(true);
      return;
    }

    const shouldReplaceUntitledTemplateTab = activeFileId === visualTemplatesTabId;
    const filePath = getVisualTemplateDraftPath(explicitPath);
    const nextModel = normalizeVisualTemplateModel({
      ...visualTemplateModel,
      filePath,
    });
    const content = JSON.stringify(nextModel, null, 2);

    applyVisualTemplateModelUpdate(nextModel, { recordHistory: false });
    setFileHistories((current) => ({
      ...current,
      [activeFileKind === "visual-template" && activeFileId ? activeFileId : visualTemplatesTabId]: {
        past: current[activeFileId]?.past || current[visualTemplatesTabId]?.past || [],
        present: content,
        future: [],
      },
    }));

    if (!isAuthenticated) {
      appendTerminalMessage("Sign in before saving visual templates to the workspace.", {
        level: "warning",
        source: "Templates",
        open: false,
      });
      return;
    }

    try {
      const response = await fetch(`${backendBaseUrl}/api/drafts/github`, {
        method: "PUT",
        headers: {
          ...(await getBackendAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filePath,
          githubSha: activeFileKind === "visual-template" ? activeFile?.githubSha || "" : "",
          sourceContentHash: activeFileKind === "visual-template" ? activeFile?.sourceContentHash || "" : "",
          contentFormat: nextModel.artifactType === "binding" ? "visual-template-binding" : "visual-template",
          content,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Could not save visual template.");
      }

      const savedFileName = filePath.split("/").pop() || (nextModel.artifactType === "binding" ? "template-binding.af-binding.json" : "visual-template.af-template.json");
      const savedFileId = activeFileKind === "visual-template" && activeFileId
        ? activeFileId
        : `github-file-${filePath}`;
      setFileHistories((current) => ({
        ...current,
        [savedFileId]: {
          past: current[savedFileId]?.past || [],
          present: content,
          future: [],
        },
      }));
      setProjectTree((currentTree) => upsertProjectTreeFileByPath(currentTree, filePath, {
        id: savedFileId,
        name: savedFileName,
        ditaType: nextModel.artifactType === "binding" ? "visual-template-binding" : "visual-template",
        content,
        githubPath: filePath,
        githubSha: activeFileKind === "visual-template" ? activeFile?.githubSha || "" : "",
        sourceContentHash: body.draft?.source_content_hash || activeFile?.sourceContentHash || "",
        draftContentHash: body.draft?.draft_content_hash || "",
        draftSavedAt: body.draft?.saved_at || new Date().toISOString(),
        draftDirty: Boolean(body.draft?.dirty),
      }));
      if (shouldReplaceUntitledTemplateTab) {
        setTabPanes((panes) => panes.map((pane) => {
          const hasUntitledTemplate = pane.tabs.includes(visualTemplatesTabId);
          if (!hasUntitledTemplate) return pane;
          const nextTabs = pane.tabs
            .map((tabId) => (tabId === visualTemplatesTabId ? savedFileId : tabId))
            .filter((tabId, index, tabs) => tabs.indexOf(tabId) === index);
          return {
            ...pane,
            tabs: nextTabs,
            activeFileId: pane.activeFileId === visualTemplatesTabId ? savedFileId : pane.activeFileId,
          };
        }));
        setActiveFileId(savedFileId);
        setSelectedProjectId(savedFileId);
      }
      appendTerminalMessage(`Saved ${nextModel.artifactType === "binding" ? "template binding document" : "visual template"} to ${filePath}.`, {
        level: "info",
        source: "Templates",
        open: false,
      });
    } catch (error) {
      appendTerminalMessage(error instanceof Error ? error.message : "Could not save visual template.", {
        level: "error",
        source: "Templates",
        open: false,
      });
    }
  }

  function renderVisualTemplateLayoutPanel() {
    const selectedRegion = visualTemplateModel.regions.find((region) => region.id === visualTemplateSelectedRegionId);
    const regionLayout = normalizeVisualTemplateLayout(selectedRegion?.layout);
    const gridSettings = normalizeVisualTemplateGridSettings(visualTemplateModel.gridSettings);
    const hasSelectedRegion = Boolean(selectedRegion);
    const canDistribute = visualTemplateModel.regions.filter((region) => !region.parentId).length >= 3;

    const updateLayout = (updates: Record<string, any>) => {
      if (!selectedRegion) return;
      updateVisualTemplateRegionLayout(selectedRegion.id, updates);
    };

    return (
      <aside
        className={`inspector side-panel visual-template-side-panel visual-template-layout-side-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
        aria-label="Template layout panel"
        aria-hidden={activeSidePanel ? undefined : "true"}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="visual-template-panel-header">
          <div className="visual-template-panel-title">
            <span>Layout</span>
            {selectedRegion ? <strong>{selectedRegion.label}</strong> : <strong>None</strong>}
          </div>
          <div className="visual-template-panel-actions">
            <button type="button" className="visual-template-panel-icon-button" title="Add container" aria-label="Add container" onClick={addVisualTemplateContainer}>
              <PlusIcon />
            </button>
            <button type="button" className="visual-template-panel-icon-button" title="Close panel" aria-label="Close Layout panel" onClick={() => setActiveSidePanel(null)}>
              <CloseIcon />
            </button>
          </div>
        </div>
        {selectedRegion ? (
          <div className="visual-template-side-content visual-style-panel">
            <section className="visual-style-section">
              <header>
                <strong>Selected item</strong>
                <small>{selectedRegion.kind === "slot" ? "Slot inside a container" : "Visual container"}</small>
              </header>
              <label>
                <span>Name</span>
                <input
                  type="text"
                  value={String(selectedRegion.label || "")}
                  onChange={(event) => updateVisualTemplateRegionMeta(selectedRegion.id, { label: event.target.value })}
                />
              </label>
              <label>
                <span>Role</span>
                <select
                  value={String(selectedRegion.role || "custom")}
                  onChange={(event) => updateVisualTemplateRegionMeta(selectedRegion.id, { role: event.target.value })}
                >
                  <option value="headline">Hero</option>
                  <option value="flow">Body</option>
                  <option value="navigation">Sidebar</option>
                  <option value="media">Media</option>
                  <option value="footer">Footer</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label>
                <span>Binding</span>
                <select
                  value={String(selectedRegion.binding || "bodyParagraphs")}
                  onChange={(event) => updateVisualTemplateRegionMeta(selectedRegion.id, { binding: event.target.value })}
                >
                  {getVisualTemplateBindingOptions(getVisualTemplateRegionSource(selectedRegion)).map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}{option.hasValue === false ? " (empty)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </section>
            <section className="visual-style-section">
              <header>
                <strong>Position and size</strong>
                <small>Canvas coordinates</small>
              </header>
              <div className="visual-style-grid-two">
                <label>
                  <span>X</span>
                  <input
                    type="number"
                    min="0"
                    max={visualTemplatePageSize.width}
                    value={Math.round(regionLayout.x)}
                    onChange={(event) => updateLayout({ x: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>Y</span>
                  <input
                    type="number"
                    min="0"
                    max={visualTemplatePageSize.height}
                    value={Math.round(regionLayout.y)}
                    onChange={(event) => updateLayout({ y: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>W</span>
                  <input
                    type="number"
                    min="40"
                    max={visualTemplatePageSize.width}
                    value={Math.round(regionLayout.width)}
                    onChange={(event) => updateLayout({ width: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>H</span>
                  <input
                    type="number"
                    min="24"
                    max={visualTemplatePageSize.height}
                    value={Math.round(regionLayout.height)}
                    onChange={(event) => updateLayout({ height: Number(event.target.value) })}
                  />
                </label>
              </div>
              <label>
                <span>Layer</span>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={Math.round(regionLayout.zIndex)}
                  onChange={(event) => updateLayout({ zIndex: Number(event.target.value) })}
                />
              </label>
            </section>
            <section className="visual-style-section">
              <header>
                <strong>Grid and snap</strong>
                <small>Precision layout controls</small>
              </header>
              <label className="visual-style-checkbox">
                <input
                  type="checkbox"
                  checked={gridSettings.showGrid}
                  onChange={(event) => updateVisualTemplateGridSettings({ showGrid: event.target.checked })}
                />
                <span>Show grid overlay</span>
              </label>
              <label>
                <span>Grid size</span>
                <select
                  value={String(gridSettings.gridSize)}
                  onChange={(event) => updateVisualTemplateGridSettings({ gridSize: Number(event.target.value) })}
                >
                  <option value="8">8 px</option>
                  <option value="16">16 px</option>
                  <option value="24">24 px</option>
                </select>
              </label>
              <label className="visual-style-checkbox">
                <input
                  type="checkbox"
                  checked={gridSettings.snapToGrid}
                  onChange={(event) => updateVisualTemplateGridSettings({ snapToGrid: event.target.checked })}
                />
                <span>Snap to grid</span>
              </label>
              <label className="visual-style-checkbox">
                <input
                  type="checkbox"
                  checked={gridSettings.snapToObjects}
                  onChange={(event) => updateVisualTemplateGridSettings({ snapToObjects: event.target.checked })}
                />
                <span>Snap to objects</span>
              </label>
              <label>
                <span>Threshold</span>
                <input
                  type="number"
                  min="1"
                  max="16"
                  value={gridSettings.snapThreshold}
                  onChange={(event) => updateVisualTemplateGridSettings({ snapThreshold: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Columns</span>
                <select
                  value={String(gridSettings.columnGuideCount)}
                  onChange={(event) => updateVisualTemplateGridSettings({ columnGuideCount: Number(event.target.value) })}
                >
                  <option value="0">None</option>
                  <option value="2">2 columns</option>
                  <option value="3">3 columns</option>
                  <option value="12">12 columns</option>
                </select>
              </label>
            </section>
            <section className="visual-style-section">
              <header>
                <strong>Alignment</strong>
                <small>Align selected item or distribute containers</small>
              </header>
              <div className="visual-alignment-toolbar" aria-label="Alignment toolbar">
                <button type="button" disabled={!hasSelectedRegion} title="Align left" onClick={() => alignVisualTemplateSelection("left")}>L</button>
                <button type="button" disabled={!hasSelectedRegion} title="Align center" onClick={() => alignVisualTemplateSelection("center")}>C</button>
                <button type="button" disabled={!hasSelectedRegion} title="Align right" onClick={() => alignVisualTemplateSelection("right")}>R</button>
                <button type="button" disabled={!hasSelectedRegion} title="Align top" onClick={() => alignVisualTemplateSelection("top")}>T</button>
                <button type="button" disabled={!hasSelectedRegion} title="Align middle" onClick={() => alignVisualTemplateSelection("middle")}>M</button>
                <button type="button" disabled={!hasSelectedRegion} title="Align bottom" onClick={() => alignVisualTemplateSelection("bottom")}>B</button>
                <button type="button" disabled={!canDistribute} title="Distribute horizontally" onClick={() => distributeVisualTemplateRegions("horizontal")}>H</button>
                <button type="button" disabled={!canDistribute} title="Distribute vertically" onClick={() => distributeVisualTemplateRegions("vertical")}>V</button>
              </div>
            </section>
            <section className="visual-style-section">
              <header>
                <strong>Canvas view</strong>
                <small>Zoom and measurement</small>
              </header>
              <label>
                <span>Zoom</span>
                <select
                  value={String(gridSettings.zoom)}
                  onChange={(event) => updateVisualTemplateGridSettings({ zoom: Number(event.target.value) })}
                >
                  <option value="0.25">25%</option>
                  <option value="0.5">50%</option>
                  <option value="0.75">75%</option>
                  <option value="1">100%</option>
                  <option value="1.5">150%</option>
                  <option value="2">200%</option>
                  <option value="3">300%</option>
                  <option value="4">400%</option>
                </select>
              </label>
              <div className="visual-style-actions">
                <button type="button" onClick={() => updateVisualTemplateGridSettings({ zoom: 1 })}>100%</button>
                <button type="button" onClick={() => updateVisualTemplateGridSettings({ zoom: 0.85 })}>Fit width</button>
                <button type="button" onClick={() => updateVisualTemplateGridSettings({ zoom: 0.75 })}>Fit screen</button>
                <button
                  type="button"
                  className={visualTemplateMeasureMode ? "active" : ""}
                  onClick={() => {
                    setVisualTemplateMeasureMode((current) => !current);
                    setVisualTemplateMeasurement(null);
                  }}
                >
                  Measure
                </button>
              </div>
            </section>
            <section className="visual-style-section">
              <header>
                <strong>Structure</strong>
                <small>Containers and slots</small>
              </header>
              <div className="visual-style-actions">
                <button type="button" onClick={addVisualTemplateContainer}>Add container</button>
                <button type="button" onClick={addVisualTemplateSlot}>Add slot</button>
                <button type="button" className="danger" onClick={() => deleteVisualTemplateContainer(selectedRegion.id)}>
                  Delete selected
                </button>
                <button type="button" className="danger" onClick={clearVisualTemplateCanvas}>Clear all</button>
              </div>
            </section>
          </div>
        ) : (
          <div className="visual-template-empty-source">
            <strong>Select a container or slot</strong>
            <p>Click an item on the template canvas to rename it, resize it, or add slots.</p>
            <div className="visual-style-actions">
              <button type="button" onClick={addVisualTemplateContainer}>Add container</button>
              <button type="button" disabled={!visualTemplateModel.regions.length} onClick={clearVisualTemplateCanvas}>Clear all</button>
            </div>
          </div>
        )}
      </aside>
    );
  }

  function renderVisualTemplateStylePanel() {
    const selectedRegion = visualTemplateModel.regions.find((region) => region.id === visualTemplateSelectedRegionId);
    const regionStyle = normalizeVisualTemplateStyle(selectedRegion?.style, visualTemplateStyleDefaults.style);
    const textStyle = normalizeVisualTemplateStyle(selectedRegion?.textStyle, visualTemplateStyleDefaults.textStyle);

    const updateContainerStyle = (updates: Record<string, any>) => {
      if (!selectedRegion) return;
      updateVisualTemplateRegionStyle(selectedRegion.id, "style", updates);
    };
    const updateTextStyle = (updates: Record<string, any>) => {
      if (!selectedRegion) return;
      updateVisualTemplateRegionStyle(selectedRegion.id, "textStyle", updates);
    };

    return (
      <aside
        className={`inspector side-panel visual-template-side-panel visual-template-style-side-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
        aria-label="Template style panel"
        aria-hidden={activeSidePanel ? undefined : "true"}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="visual-template-panel-header">
          <div className="visual-template-panel-title">
            <span>Style</span>
            {selectedRegion ? <strong>{selectedRegion.label}</strong> : <strong>None</strong>}
          </div>
          <div className="visual-template-panel-actions">
            <button type="button" className="visual-template-panel-icon-button" title="Close panel" aria-label="Close Style panel" onClick={() => setActiveSidePanel(null)}>
              <CloseIcon />
            </button>
          </div>
        </div>
        {selectedRegion ? (
          <div className="visual-template-side-content visual-style-panel">
            <section className="visual-style-section">
              <header>
                <strong>Fill</strong>
                <small>Container surface</small>
              </header>
              <label>
                <span>Type</span>
                <select
                  value={String(regionStyle.fillMode || "solid")}
                  onChange={(event) => updateContainerStyle({ fillMode: event.target.value })}
                >
                  <option value="solid">Solid</option>
                  <option value="gradient">Gradient</option>
                </select>
              </label>
              <label>
                <span>Background</span>
                <input
                  type="color"
                  value={regionStyle.backgroundColor || "#ffffff"}
                  onChange={(event) => updateContainerStyle({ backgroundColor: event.target.value })}
                />
              </label>
              {regionStyle.fillMode === "gradient" && (
                <>
                  <label>
                    <span>From</span>
                    <input
                      type="color"
                      value={regionStyle.gradientFrom || regionStyle.backgroundColor || "#ffffff"}
                      onChange={(event) => updateContainerStyle({ gradientFrom: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      type="color"
                      value={regionStyle.gradientTo || "#eef5ff"}
                      onChange={(event) => updateContainerStyle({ gradientTo: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Angle</span>
                    <input
                      type="number"
                      min="0"
                      max="360"
                      value={Number(regionStyle.gradientAngle ?? 135)}
                      onChange={(event) => updateContainerStyle({ gradientAngle: Number(event.target.value) })}
                    />
                  </label>
                </>
              )}
              <div className="visual-style-divider" />
              <label>
                <span>Image</span>
                <select
                  value={String(regionStyle.backgroundImageMode || "none")}
                  onChange={(event) => updateContainerStyle({ backgroundImageMode: event.target.value })}
                >
                  <option value="none">None</option>
                  <option value="image">Use image</option>
                </select>
              </label>
              {regionStyle.backgroundImageMode === "image" && (
                <>
                  <label className="visual-style-wide-control">
                    <span>Path or URL</span>
                    <input
                      type="text"
                      placeholder="images/hero.png or https://..."
                      value={String(regionStyle.backgroundImage || "")}
                      onChange={(event) => updateContainerStyle({ backgroundImage: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Size</span>
                    <select
                      value={String(regionStyle.backgroundSize || "cover")}
                      onChange={(event) => updateContainerStyle({ backgroundSize: event.target.value })}
                    >
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                      <option value="auto">Actual size</option>
                    </select>
                  </label>
                  <label>
                    <span>Position</span>
                    <select
                      value={String(regionStyle.backgroundPosition || "center")}
                      onChange={(event) => updateContainerStyle({ backgroundPosition: event.target.value })}
                    >
                      <option value="center">Center</option>
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                      <option value="left top">Left top</option>
                      <option value="right top">Right top</option>
                      <option value="left bottom">Left bottom</option>
                      <option value="right bottom">Right bottom</option>
                    </select>
                  </label>
                  <label>
                    <span>Repeat</span>
                    <select
                      value={String(regionStyle.backgroundRepeat || "no-repeat")}
                      onChange={(event) => updateContainerStyle({ backgroundRepeat: event.target.value })}
                    >
                      <option value="no-repeat">No repeat</option>
                      <option value="repeat">Repeat</option>
                      <option value="repeat-x">Repeat X</option>
                      <option value="repeat-y">Repeat Y</option>
                    </select>
                  </label>
                  <label>
                    <span>Overlay</span>
                    <input
                      type="color"
                      value={regionStyle.backgroundOverlayColor || "#000000"}
                      onChange={(event) => updateContainerStyle({ backgroundOverlayColor: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Overlay %</span>
                    <input
                      type="number"
                      min="0"
                      max="90"
                      value={Number(regionStyle.backgroundOverlayOpacity ?? 0)}
                      onChange={(event) => updateContainerStyle({ backgroundOverlayOpacity: Number(event.target.value) })}
                    />
                  </label>
                </>
              )}
            </section>
            <section className="visual-style-section">
              <header>
                <strong>Border</strong>
                <small>Outline and shape</small>
              </header>
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={regionStyle.borderColor || "#b9c9df"}
                  onChange={(event) => updateContainerStyle({ borderColor: event.target.value })}
                />
              </label>
              <label>
                <span>Width</span>
                <input
                  type="number"
                  min="0"
                  max="8"
                  value={Number(regionStyle.borderWidth ?? 1)}
                  onChange={(event) => updateContainerStyle({ borderWidth: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Radius</span>
                <input
                  type="number"
                  min="0"
                  max="48"
                  value={Number(regionStyle.borderRadius ?? 8)}
                  onChange={(event) => updateContainerStyle({ borderRadius: Number(event.target.value) })}
                />
              </label>
            </section>
            <section className="visual-style-section">
              <header>
                <strong>Spacing</strong>
                <small>Inside the container</small>
              </header>
              <label>
                <span>Padding</span>
                <input
                  type="number"
                  min="0"
                  max="80"
                  value={Number(regionStyle.padding ?? 14)}
                  onChange={(event) => updateContainerStyle({ padding: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Min height</span>
                <input
                  type="number"
                  min="40"
                  max="600"
                  value={Number(regionStyle.minHeight ?? 120)}
                  onChange={(event) => updateContainerStyle({ minHeight: Number(event.target.value) })}
                />
              </label>
            </section>
            <section className="visual-style-section">
              <header>
                <strong>Shadow</strong>
                <small>Depth and emphasis</small>
              </header>
              <label>
                <span>Preset</span>
                <select
                  value={String(regionStyle.shadowPreset || "none")}
                  onChange={(event) => updateContainerStyle({ shadowPreset: event.target.value })}
                >
                  <option value="none">None</option>
                  <option value="soft">Soft</option>
                  <option value="lifted">Lifted</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {regionStyle.shadowPreset !== "none" && (
                <>
                  <label>
                    <span>Color</span>
                    <input
                      type="color"
                      value={regionStyle.shadowColor || "#23406f"}
                      onChange={(event) => updateContainerStyle({ shadowColor: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Opacity</span>
                    <input
                      type="number"
                      min="0"
                      max="60"
                      value={Number(regionStyle.shadowOpacity ?? 12)}
                      onChange={(event) => updateContainerStyle({ shadowOpacity: Number(event.target.value) })}
                    />
                  </label>
                </>
              )}
              {regionStyle.shadowPreset === "custom" && (
                <>
                  <label>
                    <span>X offset</span>
                    <input
                      type="number"
                      min="-80"
                      max="80"
                      value={Number(regionStyle.shadowX ?? 0)}
                      onChange={(event) => updateContainerStyle({ shadowX: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>Y offset</span>
                    <input
                      type="number"
                      min="-80"
                      max="80"
                      value={Number(regionStyle.shadowY ?? 12)}
                      onChange={(event) => updateContainerStyle({ shadowY: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>Blur</span>
                    <input
                      type="number"
                      min="0"
                      max="120"
                      value={Number(regionStyle.shadowBlur ?? 24)}
                      onChange={(event) => updateContainerStyle({ shadowBlur: Number(event.target.value) })}
                    />
                  </label>
                </>
              )}
            </section>
            <section className="visual-style-section">
              <header>
                <strong>Text</strong>
                <small>Typography for this slot</small>
              </header>
              <label>
                <span>Color</span>
                <input
                  type="color"
                  value={textStyle.color || "#172033"}
                  onChange={(event) => updateTextStyle({ color: event.target.value })}
                />
              </label>
              <label>
                <span>Size</span>
                <input
                  type="number"
                  min="8"
                  max="80"
                  value={Number(textStyle.fontSize ?? 13)}
                  onChange={(event) => updateTextStyle({ fontSize: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Weight</span>
                <select
                  value={String(textStyle.fontWeight ?? 500)}
                  onChange={(event) => updateTextStyle({ fontWeight: Number(event.target.value) })}
                >
                  <option value="400">Regular</option>
                  <option value="500">Medium</option>
                  <option value="650">Semibold</option>
                  <option value="750">Bold</option>
                  <option value="850">Heavy</option>
                </select>
              </label>
              <label>
                <span>Align</span>
                <select
                  value={String(textStyle.textAlign || "left")}
                  onChange={(event) => updateTextStyle({ textAlign: event.target.value })}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
            </section>
            <section className="visual-style-section">
              <header>
                <strong>Animation</strong>
                <small>Preview motion</small>
              </header>
              <label>
                <span>Effect</span>
                <select
                  value={String(regionStyle.animationName || "none")}
                  onChange={(event) => updateContainerStyle({ animationName: event.target.value })}
                >
                  <option value="none">None</option>
                  <option value="fade-in">Fade in</option>
                  <option value="slide-up">Slide up</option>
                  <option value="scale-in">Scale in</option>
                </select>
              </label>
              {regionStyle.animationName !== "none" && (
                <>
                  <label>
                    <span>Duration</span>
                    <input
                      type="number"
                      min="100"
                      max="3000"
                      step="50"
                      value={Number(regionStyle.animationDuration ?? 600)}
                      onChange={(event) => updateContainerStyle({ animationDuration: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>Delay</span>
                    <input
                      type="number"
                      min="0"
                      max="3000"
                      step="50"
                      value={Number(regionStyle.animationDelay ?? 0)}
                      onChange={(event) => updateContainerStyle({ animationDelay: Number(event.target.value) })}
                    />
                  </label>
                </>
              )}
            </section>
          </div>
        ) : (
          <div className="visual-template-empty-source">
            <strong>Select a container or slot</strong>
            <p>Click a visible area on the template canvas to edit its fill, border, spacing, and text style.</p>
          </div>
        )}
      </aside>
    );
  }

  function renderVisualTemplateLayersPanel() {
    const layerRows = getVisualTemplateLayerTreeRows();
    return (
      <aside
        className={`inspector side-panel visual-template-side-panel visual-layers-side-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
        aria-label="Template layers panel"
        aria-hidden={activeSidePanel ? undefined : "true"}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="visual-template-panel-header">
          <div className="visual-template-panel-title">
            <span>Layers</span>
            <strong className="visual-template-panel-count">{visualTemplateModel.regions.length}</strong>
          </div>
          <div className="visual-template-panel-actions">
            <button type="button" className="visual-template-panel-icon-button" title="Add container" aria-label="Add container" onClick={addVisualTemplateContainer}>
              <PlusIcon />
            </button>
            <button type="button" className="visual-template-panel-icon-button" title="Close panel" aria-label="Close Layers panel" onClick={() => setActiveSidePanel(null)}>
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="visual-template-side-content visual-layers-panel">
          <label className="visual-layer-search">
            <SearchIcon />
            <input
              type="search"
              value={visualTemplateLayerSearch}
              onChange={(event) => setVisualTemplateLayerSearch(event.target.value)}
              placeholder="Search layers..."
              aria-label="Search layers"
            />
          </label>
          <div className="visual-layer-legend" aria-hidden="true">
            <span><span className="visual-layer-kind container">C</span> Container</span>
            <span><span className="visual-layer-kind slot">S</span> Slot</span>
          </div>
          {layerRows.length ? (
            <div className="visual-layer-tree">
            {layerRows.map(({ region, depth, hasChildren, expanded }) => {
              const selected = visualTemplateSelectedRegionId === region.id;
              return (
                <div
                  key={region.id}
                  className={`visual-layer-row depth-${Math.min(depth, 4)}${selected ? " active" : ""}${region.hidden ? " hidden-layer" : ""}${region.locked ? " locked-layer" : ""}`}
                  draggable
                  onDragStart={() => setVisualTemplateLayerDragId(region.id)}
                  onDragEnd={() => {
                    setVisualTemplateLayerDragId(null);
                    setVisualTemplateDeleteDropActive(false);
                  }}
                  onDragOver={(event) => {
                    if (visualTemplateLayerDragId && visualTemplateLayerDragId !== region.id) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    reorderVisualTemplateLayer(visualTemplateLayerDragId, region.id);
                    setVisualTemplateLayerDragId(null);
                  }}
                >
                  {depth > 0 && <span className="visual-layer-branch" aria-hidden="true" />}
                  <button
                    type="button"
                    className="visual-layer-disclosure"
                    disabled={!hasChildren}
                    title={hasChildren ? (expanded ? "Collapse layer" : "Expand layer") : ""}
                    aria-label={hasChildren ? `${expanded ? "Collapse" : "Expand"} ${region.label}` : undefined}
                    onClick={() => hasChildren && toggleVisualTemplateLayerExpanded(region.id)}
                  >
                    {hasChildren ? (expanded ? "⌄" : "›") : ""}
                  </button>
                  <span className={`visual-layer-kind ${region.kind}`}>{region.kind === "slot" ? "S" : "C"}</span>
                  <input
                    aria-label={`Rename ${region.label}`}
                    value={String(region.label || "")}
                    onChange={(event) => updateVisualTemplateRegionMeta(region.id, { label: event.target.value })}
                    onClick={() => setVisualTemplateSelectedRegionId(region.id)}
                    onFocus={() => setVisualTemplateSelectedRegionId(region.id)}
                  />
                  <button
                    type="button"
                    className={region.hidden ? "active" : ""}
                    title={region.hidden ? "Show layer" : "Hide layer"}
                    aria-label={region.hidden ? `Show ${region.label}` : `Hide ${region.label}`}
                    onClick={() => updateVisualTemplateRegionMeta(region.id, { hidden: !region.hidden })}
                  >
                    {region.hidden ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                  <button
                    type="button"
                    className={region.locked ? "active" : ""}
                    title={region.locked ? "Unlock layer" : "Lock layer"}
                    aria-label={region.locked ? `Unlock ${region.label}` : `Lock ${region.label}`}
                    onClick={() => updateVisualTemplateRegionMeta(region.id, { locked: !region.locked })}
                  >
                    {region.locked ? <LockIcon /> : <UnlockIcon />}
                  </button>
                </div>
              );
            })
            }
            </div>
          ) : (
            <div className="visual-template-empty-source">
              <strong>No layers yet</strong>
              <p>{visualTemplateLayerSearch.trim() ? "No layers match your search." : "Add a container, then add slots inside it."}</p>
              <div className="visual-style-actions">
                <button type="button" onClick={addVisualTemplateContainer}>Add container</button>
              </div>
            </div>
          )}
          <div
            className={`visual-layers-footer${visualTemplateLayerDragId ? " deleting" : ""}${visualTemplateDeleteDropActive ? " delete-active" : ""}`}
            onDragEnter={(event) => {
              if (!visualTemplateLayerDragId) return;
              event.preventDefault();
              setVisualTemplateDeleteDropActive(true);
            }}
            onDragOver={(event) => {
              if (!visualTemplateLayerDragId) return;
              event.preventDefault();
              setVisualTemplateDeleteDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setVisualTemplateDeleteDropActive(false);
              }
            }}
            onDrop={(event) => {
              if (!visualTemplateLayerDragId) return;
              event.preventDefault();
              deleteDraggedVisualTemplateLayer();
            }}
          >
            {visualTemplateLayerDragId ? (
              <div className="visual-layer-delete-zone" aria-live="polite">
                <TrashIcon />
                <span>{visualTemplateDeleteDropActive ? "Release to delete" : "Drop here to delete"}</span>
              </div>
            ) : (
              <>
                <button type="button" onClick={addVisualTemplateContainer}>+ Container</button>
                <button type="button" onClick={addVisualTemplateSlot}>+ Slot</button>
              </>
            )}
          </div>
        </div>
      </aside>
    );
  }

  function renderVisualTemplateWorkbench() {
    const sources = getVisualTemplateSources();
    const gridSettings = normalizeVisualTemplateGridSettings(visualTemplateModel.gridSettings);
    const getRegionSource = (region) => getVisualTemplateRegionSource(region, sources);
    const childRegionsByParent = new Map<string, any[]>();
    visualTemplateModel.regions.forEach((region) => {
      if (!region.parentId) return;
      const children = childRegionsByParent.get(region.parentId) || [];
      children.push(region);
      childRegionsByParent.set(region.parentId, children);
    });
    const topLevelRegions = visualTemplateModel.regions.filter((region) => !region.parentId);
    const getPlaceholderForBinding = (binding: string) => {
      if (binding === "title") return "Article title goes here";
      if (binding === "shortdesc") return "Short description";
      if (binding === "topicrefs") return "Topic reference slot";
      return "DITA content slot";
    };
    const renderRegionContent = (region) => {
      const source = getRegionSource(region);
      const binding = region.binding || (region.role === "headline" ? "title" : "bodyParagraphs");
      const value = getVisualTemplateBindingValue(source, binding);
      const childRegions = childRegionsByParent.get(region.id) || [];
      if (Array.isArray(value) && value.length) {
        return value.slice(0, 4).map((item, index) => (
          <span key={`${region.id}-${item}-${index}`} style={getVisualTemplateTextCssStyle(region)}>{item}</span>
        ));
      }
      if (value) {
        return <p style={getVisualTemplateTextCssStyle(region)}>{String(value)}</p>;
      }
      if (visualTemplateModel.artifactType !== "binding" && region.kind !== "slot" && childRegions.length) {
        return null;
      }
      if (visualTemplateModel.artifactType !== "binding" && region.kind === "slot") {
        return (
          <p
            className="visual-template-slot-placeholder"
            style={{
              ...getVisualTemplateTextCssStyle(region),
              color: "#98a2b3",
              fontStyle: "italic",
              fontWeight: 500,
            }}
          >
            {getPlaceholderForBinding(binding)}
          </p>
        );
      }
      return (
        <>
          <strong style={getVisualTemplateTextCssStyle(region)}>{region.label || (region.kind === "slot" ? "Slot" : "Container")}</strong>
          <p style={getVisualTemplateTextCssStyle(region)}>
            {visualTemplateModel.artifactType === "binding"
              ? getPlaceholderForBinding(binding)
              : region.kind === "slot"
                ? getPlaceholderForBinding(binding)
                : "Container"}
          </p>
        </>
      );
    };
    const renderRegionChrome = (region, className: string, children: React.ReactNode) => {
      const selected = visualTemplateSelectedRegionId === region.id;
      const childRegions = childRegionsByParent.get(region.id) || [];
      const hasSelectedChild = childRegions.some((childRegion) => childRegion.id === visualTemplateSelectedRegionId);
      if (region.hidden) return null;
      return (
        <section
          key={region.id}
          className={`${className} visual-drop-region visual-layout-container${visualTemplateDropRegionId === region.id ? " drop-active" : ""}${selected ? " selected" : ""}${hasSelectedChild ? " has-selected-child" : ""}${region.locked ? " locked" : ""}${visualTemplateLayoutDrag?.id === region.id ? " dragging" : ""}${visualTemplateMoveModifierActive ? " move-modifier" : ""}`}
          style={{ ...getVisualTemplateLayoutStyle(region), ...getVisualTemplateCssStyle(region) }}
          onClick={(event) => selectVisualTemplateRegion(event, region.id)}
          onDragOver={(event) => handleVisualTemplateDragOver(event, region.id)}
          onDragLeave={(event) => handleVisualTemplateDragLeave(event, region.id)}
          onDrop={(event) => { void bindDroppedFileToVisualRegion(event, region.id); }}
          title={visualTemplateModel.artifactType === "binding"
            ? "Drag an edge to resize. Hold Ctrl while dragging an edge to move. Drop a DITA file from Explorer to bind this container."
            : "Drag an edge to resize. Hold Ctrl while dragging an edge to move. Save this reusable template before creating bindings."}
        >
          <span
            className={`visual-layout-name ${region.kind === "slot" ? "slot" : "container"}${visualTemplateEditingRegionId === region.id ? " editing" : ""}`}
            title="Double-click to rename"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              setVisualTemplateSelectedRegionId(region.id);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              startEditingVisualTemplateRegionLabel(region);
            }}
          >
            <i aria-hidden="true" />
            {region.kind === "slot" ? "S" : "C"}
            <b aria-hidden="true">·</b>
            {visualTemplateEditingRegionId === region.id ? (
              <input
                autoFocus
                className="visual-layout-name-input"
                value={visualTemplateEditingLabel}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setVisualTemplateEditingLabel(event.target.value)}
                onBlur={commitVisualTemplateRegionLabel}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitVisualTemplateRegionLabel();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelVisualTemplateRegionLabelEdit();
                  }
                }}
              />
            ) : (
              region.label
            )}
          </span>
          {children}
          {childRegions.map((childRegion) => renderRegionChrome(
            childRegion,
            "visual-template-slot-region",
            renderRegionContent(childRegion),
          ))}
          {!region.locked && (
            <>
              {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as VisualTemplateResizeHandle[]).map((handle) => (
                <span
                  key={handle}
                  className={`visual-layout-resize-handle ${handle}`}
                  onPointerDown={(event) => startVisualTemplateLayoutDrag(
                    event,
                    region,
                    event.ctrlKey || visualTemplateMoveModifierActive ? "move" : "resize",
                    handle,
                  )}
                  aria-hidden="true"
                />
              ))}
            </>
          )}
        </section>
      );
    };
    const columnGuides = gridSettings.columnGuideCount > 0
      ? Array.from({ length: gridSettings.columnGuideCount - 1 }, (_, index) => (
        <span
          key={`column-guide-${index}`}
          className="visual-column-guide"
          style={{ left: `${((index + 1) / gridSettings.columnGuideCount) * 100}%` }}
        />
      ))
      : [];
    const measurement = visualTemplateMeasurement;
    const measurementDistance = measurement
      ? Math.round(Math.hypot(measurement.endX - measurement.startX, measurement.endY - measurement.startY))
      : 0;
    const containerCount = visualTemplateModel.regions.filter((region) => region.kind !== "slot").length;
    const slotCount = visualTemplateModel.regions.filter((region) => region.kind === "slot").length;
    const selectedRegion = visualTemplateModel.regions.find((region) => region.id === visualTemplateSelectedRegionId);
    const canUndoVisualTemplate = visualTemplateHistoryVersion >= 0 && visualTemplateUndoStackRef.current.length > 0;
    const canRedoVisualTemplate = visualTemplateHistoryVersion >= 0 && visualTemplateRedoStackRef.current.length > 0;

    return (
      <div className="visual-template-tab">
        <div className="visual-template-editor-toolbar" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="icon-only"
            disabled={!canUndoVisualTemplate}
            title="Undo"
            aria-label="Undo"
            onClick={undoVisualTemplateChange}
          >
            <UndoArrowIcon />
          </button>
          <button
            type="button"
            className="icon-only"
            disabled={!canRedoVisualTemplate}
            title="Redo"
            aria-label="Redo"
            onClick={redoVisualTemplateChange}
          >
            <RedoArrowIcon />
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <button type="button" onClick={addVisualTemplateContainer}>
            <span className="toolbar-icon box" aria-hidden="true" />
            Add container
          </button>
          <button type="button" onClick={addVisualTemplateSlot}>
            <span className="toolbar-icon plus-circle" aria-hidden="true" />
            Add slot
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className={gridSettings.showGrid ? "active" : ""}
            onClick={() => updateVisualTemplateGridSettings({ showGrid: !gridSettings.showGrid })}
          >
            <span className="toolbar-icon grid" aria-hidden="true" />
            Grid
          </button>
          <button
            type="button"
            className={gridSettings.snapToGrid || gridSettings.snapToObjects ? "active" : ""}
            onClick={() => updateVisualTemplateGridSettings({
              snapToGrid: !(gridSettings.snapToGrid || gridSettings.snapToObjects),
              snapToObjects: !(gridSettings.snapToGrid || gridSettings.snapToObjects),
            })}
          >
            <span className="toolbar-icon snap" aria-hidden="true" />
            Snap
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <button type="button" disabled>
            <EyeIcon />
            Preview
          </button>
          <button
            type="button"
            className="icon-only"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => updateVisualTemplateGridSettings({ zoom: Math.max(0.25, Number((gridSettings.zoom - 0.25).toFixed(2))) })}
          >
            −
          </button>
          <span className="visual-template-zoom-label">{Math.round(gridSettings.zoom * 100)}%</span>
          <button
            type="button"
            className="icon-only"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => updateVisualTemplateGridSettings({ zoom: Math.min(4, Number((gridSettings.zoom + 0.25).toFixed(2))) })}
          >
            +
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            disabled={!visualTemplateSelectedRegionId}
            onClick={() => deleteVisualTemplateContainer()}
          >
            <TrashIcon />
            Delete
          </button>
          <button
            type="button"
            disabled={!visualTemplateModel.regions.length}
            onClick={clearVisualTemplateCanvas}
          >
            <TrashIcon />
            Clear all
          </button>
          <button type="button" className="save-template" onClick={() => { void saveVisualTemplateDraft(); }}>
            <SaveIcon />
            Save
          </button>
        </div>

        <div className="visual-template-grid canvas-only">
          <section className="visual-template-canvas" aria-label="Visual template canvas">
            <div className="visual-template-stage">
              <div
                ref={visualTemplatePreviewRef}
                className={`visual-page-preview${gridSettings.showGrid ? " grid-visible" : ""}${visualTemplateMeasureMode ? " measuring" : ""}`}
                style={{
                  "--visual-grid-size": `${gridSettings.gridSize}px`,
                  "--visual-template-zoom": gridSettings.zoom,
                } as React.CSSProperties}
                onClick={() => setVisualTemplateSelectedRegionId(null)}
                onPointerDown={handleVisualTemplateMeasurePointerDown}
                onPointerMove={handleVisualTemplateMeasurePointerMove}
                onPointerUp={handleVisualTemplateMeasurePointerUp}
              >
                {topLevelRegions.map((region) => renderRegionChrome(
                  region,
                  region.kind === "slot" ? "visual-template-slot-region" : "visual-custom-region",
                  renderRegionContent(region),
                ))}
                {!topLevelRegions.length && (
                  <div className="visual-template-empty-canvas">
                    <strong>Blank template</strong>
                    <p>Add a container to start designing.</p>
                  </div>
                )}
                {columnGuides}
                {visualTemplateSmartGuides.map((guide, index) => (
                  <span
                    key={`${guide.axis}-${guide.value}-${index}`}
                    className={`visual-smart-guide ${guide.axis}`}
                    style={guide.axis === "x"
                      ? { left: guide.value, top: guide.from, height: guide.to - guide.from }
                      : { top: guide.value, left: guide.from, width: guide.to - guide.from }}
                  />
                ))}
                {measurement && (
                  <div className="visual-measurement-layer" aria-hidden="true">
                    <span
                      className="visual-measurement-line"
                      style={{
                        left: measurement.startX,
                        top: measurement.startY,
                        width: Math.max(1, measurementDistance),
                        transform: `rotate(${Math.atan2(measurement.endY - measurement.startY, measurement.endX - measurement.startX)}rad)`,
                      }}
                    />
                    <span
                      className="visual-measurement-label"
                      style={{
                        left: (measurement.startX + measurement.endX) / 2,
                        top: (measurement.startY + measurement.endY) / 2,
                      }}
                    >
                      {measurementDistance}px
                    </span>
                  </div>
                )}
              </div>
            </div>
            <footer className="visual-template-statusbar">
              <span><i className="dot container" />{containerCount} containers</span>
              <span><i className="dot slot" />{slotCount} slots</span>
              <span><i className="dot selected" />Selected: {selectedRegion?.label || "none"}</span>
              <span><i className="dot muted" />Grid {gridSettings.gridSize}px</span>
              <span><i className="dot muted" />Snap {gridSettings.snapToGrid || gridSettings.snapToObjects ? "on" : "off"}</span>
              <button type="button" onClick={() => setActiveSidePanel((current) => current === "templateLayers" ? null : "templateLayers")}>
                <TemplateLayersIcon />
                Layers
              </button>
              <button type="button" onClick={() => setActiveSidePanel((current) => current === "templateLayout" ? null : "templateLayout")}>
                <span className="toolbar-icon box" aria-hidden="true" />
                Layout
              </button>
            </footer>
          </section>
        </div>
      </div>
    );
  }

  function renderSpecializationsWorkbench() {
    const selectedSpecialization = specializations.find((specialization) => specialization.id === selectedSpecializationId);
    const currentStatus = selectedSpecialization?.status || (selectedSpecializationId ? "draft" : "new");

    return (
      <div className="specialization-tab">
        <header className="specialization-tab-header">
          <div>
            <span>Schema Workbench</span>
            <strong>DITA Specializations</strong>
          </div>
          <button type="button" onClick={loadSpecializations}>Refresh drafts</button>
        </header>
        <div className="specialization-workspace specialization-tab-grid">
          <section className="specialization-card">
            <header>
              <div>
                <h3>{selectedSpecializationId ? "Edit specialization" : "New specialization"}</h3>
                <p>{selectedSpecializationId ? "Changes update the selected draft UUID." : "Inherit from a base DITA element or document type."}</p>
              </div>
              {selectedSpecializationId ? (
                <div className="specialization-header-actions">
                  <span
                    className={`specialization-status-badge ${currentStatus === "valid" ? "valid" : currentStatus === "invalid" ? "invalid" : "draft"}`}
                    title={getSpecializationStatusDescription(currentStatus)}
                  >
                    {getSpecializationStatusLabel(currentStatus)}
                  </span>
                  <button type="button" onClick={startNewSpecializationDraft}>New</button>
                </div>
              ) : (
                <span className="specialization-status-badge draft" title="This specialization has not been saved yet.">
                  New
                </span>
              )}
            </header>
            {selectedSpecializationId && (
              <p className={`specialization-status-note ${currentStatus === "valid" ? "valid" : currentStatus === "invalid" ? "invalid" : ""}`}>
                {getSpecializationStatusDescription(currentStatus)}
              </p>
            )}
            <label>
              Kind
              <select
                value={specializationForm.kind}
                onChange={(event) => {
                  const nextKind = event.target.value;
                  setSpecializationForm((current) => ({
                    ...current,
                    kind: nextKind,
                    baseName: getDefaultSpecializationBase(nextKind),
                    allowedDocumentTypes: nextKind === "element" ? current.allowedDocumentTypes : [],
                    authoringProfile: nextKind === "documentType"
                      ? current.authoringProfile
                      : { enabled: false, visibleElements: [] },
                  }));
                }}
              >
                <option value="element">Element</option>
                <option value="documentType">Document type</option>
              </select>
            </label>
            <label>
              Name
              <input
                value={specializationForm.name}
                onChange={(event) => setSpecializationForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Specialized element name"
              />
            </label>
            <label>
              Base
              <select
                value={specializationForm.baseName}
                onChange={(event) => setSpecializationForm((current) => ({ ...current, baseName: event.target.value }))}
              >
                {getSpecializationBaseOptions().map((baseName) => (
                  <option value={baseName} key={baseName}>
                    {baseName}
                  </option>
                ))}
              </select>
            </label>
            {specializationForm.kind === "element" && (
              <fieldset className="specialization-scope-field">
                <legend>Scope</legend>
                <p>{specializationForm.allowedDocumentTypes.length ? "Only show this element in selected document types." : "Global: show wherever the base element is allowed."}</p>
                <div className="specialization-scope-options">
                  {getSpecializationDocumentTypeOptions().map((documentType) => (
                    <label key={documentType}>
                      <input
                        type="checkbox"
                        checked={specializationForm.allowedDocumentTypes.includes(documentType)}
                        onChange={() => toggleSpecializationScope(documentType)}
                      />
                      <span>{documentType}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <label>
              Module
              <input
                value={specializationForm.moduleName}
                onChange={(event) => setSpecializationForm((current) => ({ ...current, moduleName: event.target.value }))}
                placeholder="Specialization module name"
              />
              <span className="specialization-field-help">
                Convention: {specializationForm.kind === "documentType" ? "<document-type>-shell" : "<organization>-<purpose>-domain"}.
                Suggested: <button type="button" onClick={() => setSpecializationForm((current) => ({ ...current, moduleName: getSuggestedSpecializationModuleName() }))}>{getSuggestedSpecializationModuleName()}</button>
              </span>
            </label>
            <div className="specialization-attributes-field">
              <div className="specialization-subsection-heading">
                <span>Custom attributes</span>
                <button type="button" onClick={addSpecializationAttribute}>Add</button>
              </div>
              {specializationForm.addedAttributes.length ? (
                <div className="specialization-attribute-list">
                  {specializationForm.addedAttributes.map((attributeName, index) => (
                    <label key={index}>
                      <input
                        value={attributeName}
                        onChange={(event) => updateSpecializationAttribute(index, event.target.value)}
                        placeholder="optional XML name"
                      />
                      <button type="button" aria-label={`Remove ${attributeName || "custom attribute"}`} onClick={() => removeSpecializationAttribute(index)}>
                        Remove
                      </button>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="specialization-field-help">Optional. Add attributes only when the specialization introduces new metadata beyond the base element.</p>
              )}
            </div>
            <label>
              Description
              <textarea
                value={specializationForm.description}
                onChange={(event) => setSpecializationForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="What this specialization is for..."
              />
            </label>
            <div className="specialization-actions">
              <button type="button" disabled={specializationStatus === "loading" || specializationStatus === "saving"} onClick={previewCurrentSpecialization}>
                Preview inheritance
              </button>
              <button type="button" className="primary" disabled={specializationStatus === "saving"} onClick={saveCurrentSpecialization}>
                {selectedSpecializationId ? "Update draft" : "Save draft"}
              </button>
              <button type="button" disabled={!selectedSpecializationId || specializationStatus === "loading" || specializationStatus === "saving"} onClick={validateCurrentSpecialization}>
                Validate draft
              </button>
            </div>
            {specializationMessage && <p className={`specialization-message ${specializationStatus === "error" ? "error" : ""}`}>{specializationMessage}</p>}
          </section>

          <section className="specialization-card specialization-preview-card">
            <header>
              <div>
                <h3>{specializationPreview?.inheritedElement ? `Preview <${specializationPreview.inheritedElement.name}>` : "Preview"}</h3>
                <p>{specializationPreview?.inheritedElement ? `Inherits from <${specializationPreview.inheritedElement.baseName}>` : "Preview the inherited content model before saving."}</p>
              </div>
              {specializationPreview?.inheritedElement && <span>{specializationPreview.inheritedElement.kind}</span>}
            </header>
            {specializationPreview?.inheritedElement ? (
              <>
                <div className="specialization-detail-grid">
                  <span>Class</span>
                  <code>{specializationPreview.inheritedElement.classChain}</code>
                  <span>Text</span>
                  <strong>{specializationPreview.inheritedElement.inherits.allowsText ? "Allowed" : "Element only"}</strong>
                  <span>Children</span>
                  <strong>{specializationPreview.inheritedElement.inherits.content.length}</strong>
                  <span>Attributes</span>
                  <strong>{specializationPreview.inheritedElement.attributes.length}</strong>
                </div>
                <pre>{specializationPreview.rngPreview}</pre>
              </>
            ) : (
              <p className="section-empty">Use Preview inheritance to see the generated RNG module skeleton.</p>
            )}
          </section>

          <section className="specialization-card specialization-drafts-card">
            <header>
              <div>
                <h3>Saved drafts</h3>
                <p>Click a saved specialization to resume editing it.</p>
              </div>
              <strong>{specializations.length}</strong>
            </header>
            {specializations.length ? (
              <div className="specialization-list">
                {specializations.map((specialization) => (
                  <button
                    type="button"
                    className={specialization.id === selectedSpecializationId ? "active" : ""}
                    key={specialization.id}
                    onClick={() => editSpecializationDraft(specialization)}
                  >
                    <div>
                      <strong>{specialization.name || "Unnamed specialization"}</strong>
                      <span>{specialization.kind} · base {specialization.baseName} · {String(specialization.id).slice(0, 8)}</span>
                    </div>
                    <small className={`specialization-status-badge ${specialization.status === "valid" ? "valid" : specialization.status === "invalid" ? "invalid" : "draft"}`}>
                      {getSpecializationStatusLabel(specialization.status)}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="section-empty">No specializations saved yet.</p>
            )}
          </section>
        </div>
      </div>
    );
  }

  const signup = () => loginWithRedirect({ authorizationParams: { screen_hint: "signup" } });
  const logout = () => auth0Logout({ logoutParams: { returnTo: window.location.origin } });

  if (authIsLoading) {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-label="Loading authentication">
          <div className="auth-brand">XML Editor</div>
          <h1>Preparing your workspace</h1>
          <p>Checking your sign-in session.</p>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-label="Sign in">
          <div className="auth-brand">XML Editor</div>
          <h1>Sign in to continue</h1>
          <p>Use your organization account to open projects, edit DITA content, and validate documents.</p>
          {authError && <div className="auth-error">Error: {authError.message}</div>}
          <div className="auth-actions">
            <button type="button" className="primary-button" onClick={() => loginWithRedirect()}>
              Login
            </button>
            <button type="button" onClick={signup}>
              Signup
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (appAccountStatus === "syncing" || appAccountStatus === "idle") {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-label="Syncing account">
          <div className="auth-brand">XML Editor</div>
          <h1>Setting up your account</h1>
          <p>Connecting your Auth0 identity to the XML Editor workspace.</p>
        </section>
      </main>
    );
  }

  if (appAccountStatus === "error") {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-label="Account sync error">
          <div className="auth-brand">XML Editor</div>
          <h1>Account setup needs attention</h1>
          <p>{appAccountError}</p>
          <div className="auth-actions">
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>
              Retry
            </button>
            <button type="button" onClick={logout}>
              Logout
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (appAccount?.access === "pending") {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-label="Waiting for access">
          <div className="auth-brand">XML Editor</div>
          <h1>Waiting for access</h1>
          <p>
            Your account has been created. An administrator needs to assign you to an organization,
            team, and role before you can open the editor.
          </p>
          <div className="auth-user-summary">
            <span>{appAccount.user.email}</span>
          </div>
          <div className="auth-actions">
            <button type="button" onClick={logout}>
              Logout
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell" onClick={() => {
      setContextMenu(null);
      setTabContextMenu(null);
      setProjectContextMenu(null);
      setActiveAppMenuId(null);
      setAccountMenuOpen(false);
    }}>
      <header
        className={`top-panel${activeIsXml && activeFile ? " editing" : " idle"}`}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="top-panel-accent" />
        <div className="top-identity-row">
          <div className="product-lockup" aria-label="AuthFlow DITA Authoring Editor">
            <div className="product-mark">AF</div>
            <div className="product-copy">
              <strong>AuthFlow</strong>
              <span>DITA Authoring Editor</span>
            </div>
          </div>
          <div className="top-divider" />
          <span className={`repo-status-pill${repositoryLabel === "No repository" ? " muted" : ""}`} title={repositoryLabel}>
            <span className="status-dot" />
            <span>{repositoryLabel}</span>
          </span>
          <div className="top-spacer" />
          <span className="ai-model-pill" title={`Current AI model: ${currentAiModelLabel}`}>
            <span className="ai-dot" />
            <span>{currentAiModelLabel}</span>
          </span>
          <div className="top-divider" />
          <div className="account-menu-anchor" onClick={(event) => event.stopPropagation()}>
            <button
              className="user-avatar"
              type="button"
              title={signedInLabel}
              aria-label="Open account menu"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              onClick={() => {
                setActiveAppMenuId(null);
                setAccountMenuOpen((current) => !current);
              }}
            >
              {signedInInitials}
            </button>
            {accountMenuOpen ? (
              <div className="account-popover" role="menu">
                <div className="account-popover-header">
                  <div className="account-popover-avatar">{signedInInitials}</div>
                  <div>
                    <strong>{appAccount?.user.display_name || user?.name || "Signed in"}</strong>
                    <span>{signedInLabel}</span>
                  </div>
                </div>
                <div className="account-popover-meta">{accountContextLabel}</div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    logout();
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <nav
          className="app-menu-bar"
          aria-label="Application menu"
          onClick={(event) => event.stopPropagation()}
          onMouseLeave={() => setActiveAppMenuId(null)}
        >
          <div className="app-menu-list" role="menubar">
            {getRuntimeAppMenus().map((menu) => (
              <div className="app-menu-group" key={menu.id}>
                <button
                  className={activeAppMenuId === menu.id ? "active" : ""}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={activeAppMenuId === menu.id}
                  onClick={() => setActiveAppMenuId((current) => current === menu.id ? null : menu.id)}
                  onMouseEnter={() => {
                    if (activeAppMenuId) {
                      setActiveAppMenuId(menu.id);
                    }
                  }}
                >
                  {menu.label}
                </button>
                {activeAppMenuId === menu.id && (
                  <div className="app-menu-popover" role="menu">
                    {menu.items.map((item) => (
                      <div className="app-menu-row" key={item.id}>
                        <button
                          className={item.children?.length ? "has-submenu" : ""}
                          disabled={isAppMenuItemDisabled(item)}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            if (!isAppMenuItemDisabled(item) && !item.children?.length) {
                              runAppMenuItem(item);
                              setActiveAppMenuId(null);
                            }
                          }}
                        >
                          <span className="app-menu-item-label">
                            <AppMenuItemIcon icon={item.icon} />
                            <span>{item.label}</span>
                          </span>
                          {item.children?.length ? <span className="submenu-arrow">›</span> : null}
                        </button>
                        {item.children?.length ? (
                          <div className="app-menu-submenu" role="menu">
                            {item.children.map((child) => (
                              <button
                                disabled={isAppMenuItemDisabled(child)}
                                key={child.id}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  if (!isAppMenuItemDisabled(child)) {
                                    runAppMenuItem(child);
                                    setActiveAppMenuId(null);
                                  }
                                }}
                              >
                                <span className="app-menu-item-label">
                                  <AppMenuItemIcon icon={child.icon} />
                                  <span>{child.label}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </nav>
        {activeIsXml && activeFile ? (
          <AuthoringRibbon
            active
            activeTags={activeRibbonTags}
            allowedTags={ribbonAllowedTags}
            tableContext={activeTableContext}
            onInsert={insertRibbonElement}
            onTableCommand={runTableCommand}
          />
        ) : null}
      </header>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xml,.dita,.ditamap,.txt,.md,.html,.htm,.css,.js,.json,.png,.jpg,.jpeg,.gif,.svg,.webp,image/*,text/*,application/xml"
        hidden
        onChange={(event) => loadFile(event.target.files?.[0])}
      />

      <section className="workspace" style={workspaceStyle}>
        <nav className="side-dock left-dock" aria-label="Left dock panels" onContextMenu={(event) => event.preventDefault()}>
          <button
            className={activeLeftPanel === "explorer" ? "active" : ""}
            type="button"
            title="Explorer"
            data-tooltip="Explorer"
            aria-label="Show Explorer panel"
            aria-pressed={activeLeftPanel === "explorer"}
            onClick={() => setActiveLeftPanel((current) => current === "explorer" ? null : "explorer")}
          >
            <ExplorerIcon />
          </button>
          <button
            className={activeLeftPanel === "doc" ? "active" : ""}
            type="button"
            title="Doc"
            data-tooltip="Doc"
            aria-label="Show Doc panel"
            aria-pressed={activeLeftPanel === "doc"}
            onClick={() => setActiveLeftPanel((current) => current === "doc" ? null : "doc")}
          >
            <DocIcon />
          </button>
          <button
            className={activeLeftPanel === "git" ? "active" : ""}
            type="button"
            title="Git"
            data-tooltip="Git"
            aria-label="Show Git panel"
            aria-pressed={activeLeftPanel === "git"}
            onClick={() => setActiveLeftPanel((current) => current === "git" ? null : "git")}
          >
            <GitBranchIcon />
          </button>
        </nav>

        <aside
          className={`navigator left-panel${activeLeftPanel ? "" : " collapsed"}${renderedLeftPanel === "git" ? " git-left-panel" : ""}`}
          aria-label={renderedLeftPanel === "explorer" ? "Project explorer" : renderedLeftPanel === "git" ? "Git workspace" : "DITA document tree"}
          aria-hidden={activeLeftPanel ? undefined : "true"}
          onContextMenu={(event) => event.preventDefault()}
        >
          {renderedLeftPanel === "explorer" ? (
            <>
              <div className="panel-title">
                <span>Explorer</span>
                <div className="panel-title-actions explorer-title-actions">
                  {selectedProjectNode && (
                    <>
                    <button type="button" title="New file" aria-label="New file" onClick={(event) => openFileTypePicker(event, selectedProjectNode.id)}>
                      <FilePlusIcon />
                    </button>
                    <button type="button" title="New folder" aria-label="New folder" onClick={() => createExplorerFolder(getExplorerTargetFolderId(selectedProjectNode.id))}>
                      <FolderPlusIcon />
                    </button>
                    </>
                  )}
                  <button type="button" className="panel-close-button" title="Close panel" aria-label="Close Explorer panel" onClick={() => setActiveLeftPanel(null)}>
                    <CloseIcon />
                  </button>
                </div>
              </div>
              <ProjectTreeNode
                node={projectTree}
                activeFileId={activeFileId}
                selectedProjectId={selectedProjectId}
                onSelect={setSelectedProjectId}
                onOpenFile={openProjectFile}
                editingNodeId={editingProjectNodeId}
                onCommitRename={commitProjectItemRename}
                onCancelRename={() => setEditingProjectNodeId(null)}
                onOpenContextMenu={(event, nodeId) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedProjectId(nodeId);
                  setProjectContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    nodeId,
                  });
                }}
                onMove={moveProjectItem}
                dropTarget={projectDropTarget}
                onDropTargetChange={setProjectDropTarget}
                query=""
                sortMode="name"
              />
              {workspaceSource === "loading" && <p className="empty-state">Loading workspace...</p>}
              {workspaceSource !== "loading" && !hasVisibleProjectChildren(projectTree) && (
                <p className="empty-state">No files found in this workspace.</p>
              )}
              {explorerMessage && <p className="explorer-message">{explorerMessage}</p>}
            </>
          ) : renderedLeftPanel === "git" ? (
            <>
              <div className="git-card-header">
                <div className="git-card-title">
                  <GitBranchIcon />
                  <span>Git</span>
                </div>
                <div className="git-card-header-actions">
                  <span className="git-branch-pill">{getGitBranchDisplayName(activeGitBranchName) || "main"}</span>
                  <button type="button" className="panel-close-button" title="Close panel" aria-label="Close Git panel" onClick={() => setActiveLeftPanel(null)}>
                    <CloseIcon />
                  </button>
                </div>
              </div>
              <div className="git-panel-content">
                <section className="git-workbench" aria-label="Git workspace">
                  <section className="git-panel-section git-branch-section" aria-label="Branch">
                    <div className="git-section-title">
                      <GitBranchIcon />
                      <span>Branch</span>
                    </div>
                    <label className="git-field-label">
                      <span className="sr-only">Current Branch</span>
                      <select
                        aria-label="Current Branch"
                        value={activeGitBranchName}
                        onFocus={() => {
                          if (!gitBranches.length && githubStatus?.selectedRepository) {
                            loadGitBranches();
                          }
                        }}
                        onChange={(event) => {
                          switchGitBranch(event.target.value);
                        }}
                        disabled={!githubStatus?.selectedRepository || isSwitchingGitBranch}
                      >
                        {gitBranches.map((branch) => (
                          <option key={branch.name} value={branch.name}>{getGitBranchDisplayName(branch.name)}</option>
                        ))}
                        {!gitBranches.length && <option value={activeGitBranchName}>{getGitBranchDisplayName(activeGitBranchName) || "main"}</option>}
                      </select>
                    </label>
                    <div className="git-new-branch-row">
                      <input
                        aria-label="New branch name"
                        value={gitNewBranchName}
                        onChange={(event) => setGitNewBranchName(event.target.value)}
                        placeholder="New branch name..."
                      />
                      <button
                        type="button"
                        className="git-new-branch-button"
                        onClick={() => {
                          const baseBranch = gitCheckoutBranch || activeGitBranchName;
                          setGitBaseBranch(baseBranch);
                          createGitBranch(baseBranch);
                        }}
                        disabled={!githubStatus?.selectedRepository || !gitNewBranchName.trim()}
                        title={`Create branch from ${getGitBranchDisplayName(gitCheckoutBranch || activeGitBranchName) || "selected branch"}`}
                      >
                        <span aria-hidden="true">+</span>
                        New
                      </button>
                    </div>
                    <div className="git-remote-actions">
                      <button
                        type="button"
                        className="git-remote-button primary"
                        disabled={!githubStatus?.selectedRepository || githubTreeState === "loading"}
                        onClick={async () => {
                          await loadSelectedGitHubRepositoryTree();
                          await loadGitLocalCommits(activeGitBranchName);
                        }}
                      >
                        <GitPullIcon />
                        <span>Pull</span>
                      </button>
                      <button
                        type="button"
                        className="git-remote-button"
                        disabled={!githubStatus?.selectedRepository || gitBranchState === "loading"}
                        onClick={async () => {
                          await loadGitBranches();
                          await loadGitCommits(activeGitBranchName);
                          await loadGitLocalCommits(activeGitBranchName);
                        }}
                      >
                        <GitClockIcon />
                        <span>Fetch</span>
                      </button>
                      <button
                        type="button"
                        className="git-remote-button"
                        disabled={!githubStatus?.selectedRepository || githubTreeState === "loading" || gitBranchState === "loading"}
                        onClick={async () => {
                          await loadGitBranches();
                          await loadGitCommits(activeGitBranchName);
                          await loadGitLocalCommits(activeGitBranchName);
                          await loadSelectedGitHubRepositoryTree({ silent: true });
                        }}
                      >
                        <GitSyncIcon />
                        <span>Sync</span>
                      </button>
                    </div>
                    <div className="git-remote-status">
                      <GitOriginIcon />
                      <span>origin/{getGitBranchDisplayName(activeGitBranchName) || "main"}</span>
                      <span className="ahead">↑ 0 ahead</span>
                      <span className="behind">↓ 0 behind</span>
                    </div>
                  </section>

                  <section className="git-panel-section git-changes-section" aria-label="Changed files">
                    <div className="git-section-heading">
                      <div className="git-section-title">
                        <GitChangesIcon />
                        <span>Changes</span>
                      </div>
                      <div className="git-section-actions">
                        <button type="button" className="git-sample-conflict-button" onClick={openSampleGitConflicts}>
                          Sample conflicts
                        </button>
                        <small>{draftBackedFiles.length} file{draftBackedFiles.length === 1 ? "" : "s"}</small>
                      </div>
                    </div>
                    <div className="git-change-table-wrap">
                      {draftBackedFiles.length ? (
                        <table className="git-change-table" aria-label="Changed files">
                          <tbody>
                            {draftBackedFiles.map(({ node, path }) => {
                              const displayPath = path.replace(/^content\//, "");
                              const changeState = node.deletedAt ? "Deleted" : node.githubSha ? "Updated" : "Added";
                              return (
                                <tr key={node.id}>
                                  <td className="git-change-check-cell">
                                    <input
                                      type="checkbox"
                                      checked={selectedGitCommitFileIds.has(node.id)}
                                      aria-label={`Select ${displayPath} for commit`}
                                      onChange={(event) => {
                                        const isChecked = event.target.checked;
                                        setSelectedGitCommitFileIds((currentIds) => {
                                          const nextIds = new Set(currentIds);
                                          if (isChecked) {
                                            nextIds.add(node.id);
                                          } else {
                                            nextIds.delete(node.id);
                                          }
                                          return nextIds;
                                        });
                                      }}
                                    />
                                  </td>
                                  <td className="git-change-icon-cell">
                                    <span className="git-change-icon">
                                      <FileTypeIcon kind={getProjectFileIconKind(node)} />
                                    </span>
                                  </td>
                                  <td className="git-change-file-cell">
                                    <button type="button" className="git-change-file-button" onClick={() => openProjectFile(node.id)}>
                                      <span className="git-change-name">{displayPath}</span>
                                    </button>
                                  </td>
                                  <td className="git-change-state-cell">
                                    <span className={`git-change-state ${changeState.toLowerCase()}`}>{changeState}</span>
                                  </td>
                                  <td className="git-change-action-cell">
                                    <button
                                      type="button"
                                      className="git-change-discard-button"
                                      title={`Discard changes for ${displayPath}`}
                                      aria-label={`Discard changes for ${displayPath}`}
                                      onClick={() => discardGitHubDraft(node)}
                                    >
                                      <GitDiscardIcon />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : (
                        <p className="section-empty">No changes in loaded files.</p>
                      )}
                    </div>
                  </section>

                  <section className="git-panel-section git-commit-section" aria-label="Commit message">
                    <div className="git-section-title">
                      <span>Commit Message</span>
                    </div>
                    <label className="git-field-label git-message-label">
                      <span className="sr-only">Commit Message</span>
                      <textarea
                        value={gitCommitMessage}
                        onChange={(event) => setGitCommitMessage(event.target.value)}
                        placeholder="Describe your changes..."
                        rows={4}
                      />
                    </label>
                    <button
                      type="button"
                      className="git-commit-button"
                      disabled={!gitCommitMessage.trim() || selectedGitCommitCount === 0 || isCommittingGitChanges}
                      onClick={commitSelectedGitHubDraftsLocally}
                    >
                      <span aria-hidden="true">✓</span>
                      <span>{isCommittingGitChanges ? "Committing..." : `Commit ${selectedGitCommitCount || 0} file${selectedGitCommitCount === 1 ? "" : "s"}`}</span>
                    </button>
                    <button
                      type="button"
                      className="git-publish-button"
                      disabled={pendingPublishCommitCount === 0 || isPublishingGitChanges}
                      onClick={publishGitHubLocalCommitsFromPanel}
                    >
                      <GitPushIcon />
                      <span>{isPublishingGitChanges ? "Publishing..." : "Publish to origin"}</span>
                      <strong>{pendingPublishFileCount}</strong>
                    </button>
                  </section>

                  <section className="git-panel-section git-recent-section" aria-label="Recent commits">
                    <div className="git-section-heading">
                      <div className="git-section-title">
                        <GitClockIcon />
                        <span>Recent Commits</span>
                      </div>
                      <span className="git-branch-chip">{getGitBranchDisplayName(activeGitBranchName) || "main"}</span>
                    </div>
                    <div className="git-recent-list">
                      {gitCommits.slice(0, 3).map((commit) => (
                        <div className="git-recent-item" key={commit.sha}>
                          <strong>{commit.headline}</strong>
                          <div>
                            <code>{commit.shortSha}</code>
                            <span>{commit.authorName || commit.authorLogin || "Unknown"}</span>
                            <span>{formatGitCommitDate(commit.committedAt || commit.authoredAt)}</span>
                          </div>
                        </div>
                      ))}
                      {!gitCommits.length && <p className="section-empty">No recent commits loaded.</p>}
                    </div>
                  </section>
                </section>
                {gitMessage && <p className="github-message">{gitMessage}</p>}
              </div>
            </>
          ) : (
            <>
              <div className="panel-title">
                <span>Doc</span>
                <div className="panel-title-actions">
                  <strong className={errorCount ? "status-error" : "status-ok"}>
                    {activeFileKind !== "xml" ? activeFileKind : parsed.error ? "Invalid XML" : errorCount ? `${errorCount} errors` : "Valid"}
                  </strong>
                  <button type="button" className="panel-close-button" title="Close panel" aria-label="Close Doc panel" onClick={() => setActiveLeftPanel(null)}>
                    <CloseIcon />
                  </button>
                </div>
              </div>
              {activeFileKind !== "xml" ? (
                <p className="empty-state">Document outline is available for XML and DITA files.</p>
              ) : parsed.doc ? (
                <TreeNode
                  node={parsed.doc.documentElement}
                  path={[]}
                  selectedPath={selectedPath}
                  hrefValidationMap={hrefValidationMap}
                  onSelect={selectDocumentExplorerNode}
                />
              ) : (
                <p className="empty-state">Fix XML syntax to restore the tree.</p>
              )}
            </>
          )}
        </aside>

        <div
          className={`workspace-resizer left-panel-resizer${activeLeftPanel ? "" : " collapsed"}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file explorer"
          aria-hidden={activeLeftPanel ? undefined : "true"}
          style={navigatorResizerStyle}
          onPointerDown={activeLeftPanel ? startNavigatorResize : undefined}
        />

        <div className="editor-workspace">
          <section
            className={`editor-panes ${hasSecondaryPane ? `split-${paneSplitDirection}` : ""}`}
            style={editorPaneStyle}
            onContextMenu={(event) => event.preventDefault()}
          >
          {tabPanes.map((pane, paneIndex) => {
            const paneFileId = pane.activeFileId || pane.tabs[0];
            const paneFile = findProjectNode(projectTree, paneFileId)?.node ||
              (paneFileId === specializationsTabId ? specializationsTabFile : null) ||
              (paneFileId === visualTemplatesTabId ? visualTemplatesTabFile : null) ||
              (paneFileId?.startsWith(`${authoringProfileTabPrefix}-`) ? createAuthoringProfileTabFile(getAuthoringProfileDocumentTypeFromTabId(paneFileId)) : null);
            const paneFileKind = getProjectFileKind(paneFile);
            const paneFilePath = getProjectFilePath(projectTree, paneFileId);
            const paneHistory = fileHistories[paneFileId] || {
              past: [],
              present: paneFile?.content || "",
              future: [],
            };
            const paneXml = paneHistory.present;
            const paneParsed = paneFileKind === "xml" ? parseXml(paneXml) : { doc: null, error: null };
            const paneSelectedPath = selectedPathsByFile[paneFileId] || [];
            const paneHrefValidationMap = paneParsed.doc
              ? collectHrefValidationStates(paneParsed.doc, paneFilePath, projectTree)
              : {};

            return (
              <React.Fragment key={pane.id}>
            <section
              className={`editor-column ${pane.id === activePaneId ? "active-pane" : ""}`}
              onClick={() => setActivePaneId(pane.id)}
            >
          <div
            className={`file-tabs${tabDropTarget?.paneId === pane.id && tabDropTarget?.placement === "end" ? " drag-over" : ""}`}
            role="tablist"
            aria-label={`${pane.label} open files`}
            onDragOver={(event) => {
              if (!Array.from(event.dataTransfer.types).includes("application/x-xml-editor-tab")) return;

              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setTabDropTarget({ paneId: pane.id, index: pane.tabs.length, placement: "end" });
            }}
            onDragLeave={() => {
              if (tabDropTarget?.paneId === pane.id && tabDropTarget?.placement === "end") {
                setTabDropTarget(null);
              }
            }}
            onDrop={(event) => {
              const draggedTab = getDraggedTab(event);
              if (!draggedTab) return;

              event.preventDefault();
              moveDraggedTab(draggedTab, pane.id, pane.tabs.length);
            }}
          >
            {pane.tabs.map((fileId, tabIndex) => {
              const tab = { fileId, paneId: pane.id };
              const tabFile = findProjectNode(projectTree, tab.fileId)?.node ||
                (tab.fileId === specializationsTabId ? specializationsTabFile : null) ||
                (tab.fileId === visualTemplatesTabId ? visualTemplatesTabFile : null) ||
                (tab.fileId?.startsWith(`${authoringProfileTabPrefix}-`) ? createAuthoringProfileTabFile(getAuthoringProfileDocumentTypeFromTabId(tab.fileId)) : null);
              if (!tabFile || tabFile.type !== "file") return null;

              const active = pane.id === activePaneId && tab.fileId === activeFileId;
              const displayed = tab.fileId === pane.activeFileId;
              const tabFileKind = getProjectFileKind(tabFile);
              const isDocumentTab = ["xml", "text", "html", "image"].includes(tabFileKind) && !tabFile.generated;
              const dragOver = tabDropTarget?.paneId === pane.id &&
                tabDropTarget?.fileId === tab.fileId &&
                tabDropTarget?.placement === "tab";
              const draftDotState = active && activeFile?.id === tab.fileId && activeFile?.githubPath &&
                ["pending", "saving", "error"].includes(draftSaveState.status)
                ? draftSaveState.status
                : "";

              return (
                <button
                  className={`file-tab${displayed ? " displayed" : ""}${active ? " active" : ""}${dragOver ? " drag-over" : ""}`}
                  key={`${pane.id}-${tab.fileId}`}
                  role="tab"
                  aria-selected={active}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-xml-editor-tab", JSON.stringify({
                      fileId: tab.fileId,
                      paneId: pane.id,
                    }));
                    event.dataTransfer.setData("text/plain", tabFile.name);
                    setTabContextMenu(null);
                  }}
                  onDragOver={(event) => {
                    if (!Array.from(event.dataTransfer.types).includes("application/x-xml-editor-tab")) return;

                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "move";
                    setTabDropTarget({
                      paneId: pane.id,
                      fileId: tab.fileId,
                      index: tabIndex,
                      placement: "tab",
                    });
                  }}
                  onDragLeave={() => {
                    if (dragOver) {
                      setTabDropTarget(null);
                    }
                  }}
                  onDrop={(event) => {
                    const draggedTab = getDraggedTab(event);
                    if (!draggedTab) return;

                    event.preventDefault();
                    event.stopPropagation();
                    moveDraggedTab(draggedTab, pane.id, tabIndex);
                  }}
                  onDragEnd={() => setTabDropTarget(null)}
                  onClick={() => switchToTab(tab.fileId, pane.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!isDocumentTab) {
                      setTabContextMenu(null);
                      return;
                    }
                    setActivePaneId(pane.id);
                    setActiveFileId(tab.fileId);
                    setSelectedProjectId(tab.fileId === specializationsTabId ? null : tab.fileId);
                    setTabContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      fileId: tab.fileId,
                      paneId: pane.id,
                    });
                  }}
                  title={tabFile.name}
                >
                  {draftDotState && (
                    <small
                      aria-label={draftDotState === "pending" ? "Draft changes pending" : draftDotState === "saving" ? "Saving draft" : "Draft save error"}
                      className={`tab-draft-dot ${draftDotState}`}
                      title={draftSaveState.message}
                    />
                  )}
                  <span>{tabFile.name}</span>
                  <em
                    aria-label={`Close ${tabFile.name}`}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => closeTab(tab.fileId, event, pane.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        closeTab(tab.fileId, event, pane.id);
                      }
                    }}
                  >
                    ×
                  </em>
                </button>
              );
            })}
          </div>
          {pane.tabs.length === 0 ? (
            <div className="empty-editor-state">
              <strong>No file open</strong>
              <span>Select a file from Explorer to begin editing.</span>
            </div>
          ) : pane.id === activePaneId && paneFileKind === "xml" ? (
            <>
          <div className="modebar" role="toolbar" aria-label="Editor view toggles">
            <button
              aria-pressed={mode === "layout"}
              className={mode === "layout" ? "active" : ""}
              onClick={() => setMode((current) => current === "layout" ? "visual" : "layout")}
              title={mode === "layout" ? "Return to WYSIWYG" : "Show layout structure"}
            >
              <EditorModeIcon mode="layout" />
              <span>Layout</span>
            </button>
            <button
              aria-pressed={mode === "source"}
              className={mode === "source" ? "active" : ""}
              onClick={() => setMode((current) => current === "source" ? "visual" : "source")}
              title={mode === "source" ? "Return to WYSIWYG" : "Show XML source"}
            >
              <EditorModeIcon mode="source" />
              <span>Source</span>
            </button>
            <button
              className="editor-validate-button"
              disabled={toolbarValidation.status === "validating"}
              onClick={validateActiveDitaDocument}
              title={toolbarValidation.message}
            >
              <EditorModeIcon mode="validate" />
              <span>{toolbarValidation.status === "validating" ? "Validating..." : "Validate"}</span>
            </button>
          </div>

          {parsed.doc && (
            <nav className="element-breadcrumb" aria-label="Selected element hierarchy">
              {getElementBreadcrumbItems(parsed.doc, selectedPath).map((item, index, items) => {
                const isCurrent = index === items.length - 1;
                return (
                  <React.Fragment key={pathKeyFor(item.path) || "root"}>
                    <button
                      type="button"
                      className={isCurrent ? "current" : ""}
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => {
                        setSelectedPath(item.path);
                        setDocumentHighlightPathKey(pathKeyFor(item.path));
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSelectedPath(item.path);
                        setDocumentHighlightPathKey(pathKeyFor(item.path));
                        openContextMenu(event, item.path);
                      }}
                    >
                      {item.tagName}
                    </button>
                    {index < items.length - 1 && <span aria-hidden="true">&gt;</span>}
                  </React.Fragment>
                );
              })}
            </nav>
          )}

          {activeAiSuggestion && (
            <section className={`ai-review-banner ${activeAiSuggestion.severity}`} aria-label="AI review suggestion">
              <div>
                <strong>{activeAiSuggestion.title}</strong>
                <span>{activeAiSuggestion.targetPath || activeFile?.name || "Active document"}</span>
                <p>{activeAiSuggestion.body}</p>
              </div>
              <div className="ai-review-banner-actions">
                {activeAiSuggestion.operation && (
                  <button type="button" className="primary" onClick={() => applyAiSuggestion(activeAiSuggestion)}>
                    Apply
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDismissedAiSuggestionIds((current) => (
                    current.includes(activeAiSuggestion.id) ? current : [...current, activeAiSuggestion.id]
                  ))}
                >
                  Dismiss
                </button>
              </div>
            </section>
          )}

          <div className={`editor-stage ${mode}`}>
            {(mode === "visual" || mode === "layout" || mode === "split") && (
              <section className="visual-workbench">
                <div className="spelling-overlay" aria-hidden="true">
                  {spellingMarks.map((mark) => (
                    <span
                      className="spelling-overlay-mark"
                      key={mark.id}
                      style={{
                        left: mark.left,
                        top: mark.top,
                        width: mark.width,
                      }}
                    />
                  ))}
                </div>
                <article
                  className={`visual-editor${mode === "layout" ? " layout-editor" : ""}`}
                  aria-label="WYSIWYG DITA editor"
                  spellCheck={false}
                  onKeyDownCapture={handleAuthoringShortcutKeyDown}
                  onPointerDownCapture={preserveContextSelectionFromPointer}
                >
                  {parsed.doc ? (
                    <VisualNode
                      node={parsed.doc.documentElement}
                      path={[]}
                      selectedPath={selectedPath}
                      highlightedPathKey={documentHighlightPathKey}
                      onSelect={setSelectedPath}
                      onTextChange={updateText}
                      onTextNodeChange={updateTextNode}
                      onTextInput={trackVisualTextEdit}
                      onCaretChange={updateCaretSelection}
                      onListItemEnter={handleListItemEnter}
                      onParagraphEnter={handleParagraphEnter}
	                      onHrefDrop={updateHrefFromDrop}
                      resolveImageHref={resolveImageHrefForPreview}
                      hrefValidationMap={hrefValidationMap}
                      pinnedSelection={pinnedAuthoringSelection}
                      visualSearchQuery={activeSidePanel === "search" ? searchQuery : ""}
                      spellingIssues={activeSpellingIssues}
                      inlineExitCaret={inlineExitCaret}
                      onInlineExitTextInput={commitInlineExitText}
	                      onOpenContextMenu={openContextMenu}
	                    />
                  ) : (
                    <div className="parse-error">{parsed.error}</div>
                  )}
                </article>
              </section>
            )}

            {(mode === "source" || mode === "split") && (
              <div className="source-pane">
                <pre
                  ref={sourceHighlightRef}
                  className="source-highlight"
                  aria-hidden="true"
                >
                  {tokenizeXmlSource(xml).map((token) => (
                    <span
                      className={`source-token ${token.type}${token.tagName && brokenSchemaTagNames.has(token.tagName) ? " schema-error" : ""}`}
                      key={token.id}
                      title={token.tagName && brokenSchemaTagNames.has(token.tagName) ? "Schema issue" : undefined}
                      onMouseDown={(event) => {
                        if (token.type !== "tag") return;

                        event.preventDefault();
                        const sourceEditor = event.currentTarget
                          .closest(".source-pane")
                          ?.querySelector(".source-editor");
                        if (sourceEditor instanceof HTMLElement) {
                          sourceEditor.blur();
                        }
                      }}
                    >
                      {renderHighlightedSearchText(
                        token.text,
                        activeSidePanel === "search" ? searchQuery : "",
                      )}
                    </span>
                  ))}
                </pre>
                <textarea
                  className="source-editor"
                  aria-label="XML source"
                  value={xml}
                  spellCheck="false"
                  onChange={(event) => updateSourceDraft(event.target.value)}
                  onScroll={(event) => {
                    if (!sourceHighlightRef.current) return;
                    sourceHighlightRef.current.scrollTop = event.currentTarget.scrollTop;
                    sourceHighlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
                  }}
                  onBlur={finalizeSourceDraft}
                />
              </div>
            )}
          </div>
            </>
          ) : pane.id === activePaneId && paneFileKind === "specializations" ? (
            renderSpecializationsWorkbench()
          ) : pane.id === activePaneId && paneFileKind === "visual-template" ? (
            renderVisualTemplateWorkbench()
          ) : pane.id === activePaneId && paneFileKind === "authoring-profile" ? (
            renderAuthoringProfileWorkbench(getAuthoringProfileDocumentTypeFromTabId(paneFileId))
          ) : pane.id === activePaneId && paneFileKind === "image" ? (
            <ImageViewer file={paneFile} />
          ) : pane.id === activePaneId && paneFileKind === "git-history" ? (
            <GitHistoryViewer
              payload={parseGitHistoryPayload(paneXml)}
              onOpenCommitContextMenu={(event, payload, commit) => {
                event.preventDefault();
                setGitCommitContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  payload,
                  commit,
                });
              }}
            />
          ) : pane.id === activePaneId && paneFileKind === "git-conflict" ? (
            <GitConflictResolver
              payload={parseGitConflictPayload(paneXml)}
              onSaveResolution={saveGitConflictResolution}
            />
          ) : pane.id === activePaneId ? (
            <PlainTextEditor
              value={paneXml}
              kind={paneFileKind}
              fileName={paneFile?.name || "file"}
              onChange={updatePlainTextDraft}
              onBlur={finalizeSourceDraft}
            />
          ) : (
            <div
              className={`inactive-pane-preview${paneFile?.generated ? " validation-report-preview" : ""}`}
              onMouseDown={() => switchToTab(paneFileId, pane.id)}
            >
              {paneFileKind === "xml" && paneParsed.doc ? (
                <article className="visual-editor" aria-label={`${pane.label} pane preview`} spellCheck={false}>
                  <VisualNode
                    node={paneParsed.doc.documentElement}
                    path={[]}
                    selectedPath={paneSelectedPath}
                    highlightedPathKey={pane.id === activePaneId && paneFileId === activeFileId ? documentHighlightPathKey : null}
                    onSelect={(path) => activatePaneSelection(pane.id, paneFileId, path)}
                    onTextChange={() => {}}
                    onTextNodeChange={() => {}}
                    onTextInput={() => {}}
                    onCaretChange={() => {}}
                    onListItemEnter={() => {}}
                    onParagraphEnter={() => {}}
                    onHrefDrop={() => {}}
                    resolveImageHref={(href) => {
                      const trimmed = href.trim();
                      if (!trimmed || isExternalHref(trimmed) || !paneFilePath) return trimmed;

                      const projectHref = resolveProjectHref(paneFilePath, trimmed);
                      const projectFile = findProjectFileByPath(projectTree, projectHref);
                      return projectFile?.previewHref || trimmed;
                    }}
                    hrefValidationMap={paneHrefValidationMap}
                    pinnedSelection={null}
                    visualSearchQuery={activeSidePanel === "search" ? searchQuery : ""}
                    spellingIssues={[]}
                    inlineExitCaret={null}
                    onInlineExitTextInput={() => {}}
                    onOpenContextMenu={(event, path) => {
                      event.preventDefault();
                      activatePaneSelection(pane.id, paneFileId, path);
                    }}
                  />
                </article>
              ) : paneFileKind === "image" ? (
                <ImageViewer file={paneFile} />
              ) : paneFileKind === "git-history" ? (
                <GitHistoryViewer
                  payload={parseGitHistoryPayload(paneXml)}
                  onOpenCommitContextMenu={(event, payload, commit) => {
                    event.preventDefault();
                    setGitCommitContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      payload,
                      commit,
                    });
                  }}
                />
              ) : paneFileKind === "git-conflict" ? (
                <GitConflictResolver
                  payload={parseGitConflictPayload(paneXml)}
                  onSaveResolution={() => {}}
                  readOnly
                />
              ) : paneFileKind === "xml" ? (
                <div className="parse-error">{paneParsed.error}</div>
              ) : (
                <PlainTextEditor
                  value={paneXml}
                  kind={paneFileKind}
                  fileName={paneFile?.name || "file"}
                  onChange={() => {}}
                  onBlur={() => {}}
                  readOnly
                />
              )}
            </div>
          )}
        </section>
          {tabPanes.length > 1 && paneIndex === 0 && (
            <div
              className={`pane-resizer ${paneSplitDirection === "down" ? "horizontal" : "vertical"}`}
              role="separator"
              aria-orientation={paneSplitDirection === "down" ? "horizontal" : "vertical"}
              aria-label="Resize editor panes"
              onPointerDown={startPaneResize}
            />
          )}
          </React.Fragment>
            );
          })}
          </section>

          {bottomPanelOpen && (
            <>
            <div
              className="bottom-panel-resizer"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize bottom panel"
              onPointerDown={startBottomPanelResize}
            />
            <section className="bottom-panel" aria-label="Validation bottom panel" style={{ flexBasis: bottomPanelHeight }}>
              <div className="bottom-panel-header">
                <div className="bottom-panel-tabs" role="tablist" aria-label="Bottom panel tabs">
                  <button className={bottomPanelTab === "problems" ? "active" : ""} onClick={() => setBottomPanelTab("problems")}>
                    Problems
                    {validationProblems.length > 0 && <span>{validationProblems.length}</span>}
                  </button>
                  <button className={bottomPanelTab === "output" ? "active" : ""} onClick={() => setBottomPanelTab("output")}>
                    Output
                  </button>
                  <button className={bottomPanelTab === "terminal" ? "active" : ""} onClick={() => setBottomPanelTab("terminal")}>
                    Terminal
                  </button>
                </div>
                <button
                  type="button"
                  className="panel-close-button"
                  title="Close bottom panel"
                  aria-label="Close bottom panel"
                  onClick={() => setBottomPanelOpen(false)}
                >
                  <CloseIcon />
                </button>
              </div>

              {bottomPanelTab === "problems" && (
                <div className="problems-panel">
                  <div className="problems-scope">
                    <span>
                      {activeValidationRun
                        ? `Showing latest result for ${activeValidationRun.fileName}`
                        : "Showing latest validation result"}
                    </span>
                  </div>
                  {validationProblems.length ? (
                    <div className="problems-list">
                      {validationProblems.map((problem) => (
                        <div
                          key={problem.id}
                          className="problem-row"
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (window.getSelection()?.toString()) return;
                            openValidationProblem(problem);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            openValidationProblem(problem);
                          }}
                        >
                          <span className={`problem-severity ${problem.level || "error"}`}>{problem.level === "warning" ? "!" : "x"}</span>
                          <span className="problem-message">{problem.message || "Validation issue"}</span>
                          <span className="problem-location">
                            {[
                              problem.file || problem.fallbackFilePath || problem.fileName,
                              problem.line ? `line ${problem.line}` : "",
                              problem.column ? `col ${problem.column}` : "",
                            ].filter(Boolean).join(", ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="bottom-panel-empty">
                      {activeValidationRun
                        ? `No validation problems for ${activeValidationRun.fileName}.`
                        : "No validation problems. Run Validate to refresh the list."}
                    </p>
                  )}
                </div>
              )}

              {bottomPanelTab === "output" && (
                <div className="output-panel">
                  {validationRuns.length ? (
                    <>
                      <div className="output-run-tabs" role="tablist" aria-label="Validation outputs">
                        {validationRuns.map((run) => (
                          <div
                            key={run.id}
                            className={`output-run-tab ${run.id === activeValidationRun?.id ? "active" : ""}`}
                            role="tab"
                            tabIndex={0}
                            aria-selected={run.id === activeValidationRun?.id}
                            onClick={() => setActiveValidationRunId(run.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setActiveValidationRunId(run.id);
                              }
                            }}
                            title={`${run.fileName} - ${run.validatedAt}`}
                          >
                            <span className={`output-status ${run.status}`}>{run.status === "valid" ? "✓" : "x"}</span>
                            <span className="output-run-name">{run.fileName}</span>
                            <button
                              aria-label={`Close ${run.fileName} validation output`}
                              className="output-run-close"
                              title={`Close ${run.fileName} output`}
                              onClick={(event) => {
                                event.stopPropagation();
                                closeValidationRun(run.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  closeValidationRun(run.id);
                                }
                              }}
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                      <pre className="output-log">
                        {activeValidationRun?.report || "Select a validation output."}
                      </pre>
                    </>
                  ) : (
                    <p className="bottom-panel-empty">No validation output yet.</p>
                  )}
                </div>
              )}

              {bottomPanelTab === "terminal" && (
                <div className="terminal-panel">
                  {terminalMessages.length ? (
                    <div className="terminal-log" role="log" aria-label="System terminal messages">
                      {terminalMessages.map((message) => (
                        <div className={`terminal-log-row ${message.level}`} key={message.id}>
                          <span className="terminal-time">{formatTerminalTime(message.createdAt)}</span>
                          <span className="terminal-source">{message.source}</span>
                          <span className="terminal-message">{message.message}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="bottom-panel-empty">No system messages yet.</p>
                  )}
                </div>
              )}
            </section>
            </>
          )}
        </div>

        <div
          className={`workspace-resizer inspector-resizer right-panel-resizer${activeSidePanel ? "" : " collapsed"}`}
          role="separator"
          aria-orientation="vertical"
          aria-label={activeSidePanel ? `Resize ${activeSidePanel} panel` : "Resize side panel"}
          aria-hidden={activeSidePanel ? undefined : "true"}
          style={inspectorResizerStyle}
          onPointerDown={activeSidePanel ? startInspectorResize : undefined}
        />

        {renderedSidePanel === "inspector" && (
        <aside
          className={`inspector side-panel inspector-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
          aria-label="DITA inspector"
          aria-hidden={activeSidePanel ? undefined : "true"}
          onContextMenu={(event) => event.preventDefault()}
        >
          {activeFileKind !== "xml" ? (
            <>
            <div className="inspector-topbar">
              <span>Inspector</span>
              <div className="inspector-topbar-actions">
                <button type="button" className="inspector-close-button" title="Close panel" aria-label="Close Inspector panel" onClick={() => setActiveSidePanel(null)}>
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="generic-inspector">
              <p className="empty-state">
                {activeFileKind === "image"
                  ? "Image files are displayed as previews. Drag them onto DITA image elements to set href values."
                  : "Text and HTML files use the plain editor. DITA schema attributes are shown only for XML and DITA documents."}
              </p>
              {activeFile && (
                <div className="file-detail-list">
                  <span>Name</span>
                  <strong>{activeFile.name}</strong>
                  <span>Type</span>
                  <strong>{activeFileKind}</strong>
                  <span>Checked in</span>
                  <strong>{activeFile.checkedInAt || "Not checked in"}</strong>
                </div>
              )}
            </div>
            </>
          ) : selectedNode ? (
            <InspectorPanel
              doc={parsed.doc}
              selectedNode={selectedNode}
              selectedPath={selectedPath}
              childOptions={insertContext.childOptions}
              siblingOptions={insertContext.siblingOptions}
              hrefValidation={hrefValidationMap[pathKeyFor(selectedPath)]}
              onClose={() => setActiveSidePanel(null)}
              onInsert={insertElement}
              onRemove={removeSelected}
              onUpdateAttribute={(name, value) => updateAttribute(selectedPath, name, value)}
              onAttributeBlur={(name, value) => {
                if (name === "href") {
                  validateHrefAttribute(selectedPath, value);
                }
              }}
            />
          ) : (
            <>
            <div className="inspector-topbar">
              <span>Inspector</span>
              <div className="inspector-topbar-actions">
                <button type="button" className="inspector-close-button" title="Close panel" aria-label="Close Inspector panel" onClick={() => setActiveSidePanel(null)}>
                  <CloseIcon />
                </button>
              </div>
            </div>
            <p className="empty-state">Select an element to edit attributes or insert DITA children.</p>
            </>
          )}
        </aside>
        )}

        {renderedSidePanel === "search" && (
          <aside
            className={`inspector side-panel search-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
            aria-label="Search panel"
            aria-hidden={activeSidePanel ? undefined : "true"}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="panel-title">
              <span>Search</span>
              <div className="panel-title-actions">
                <strong>{searchResults.length}</strong>
                <button type="button" className="panel-close-button" title="Close panel" aria-label="Close Search panel" onClick={() => setActiveSidePanel(null)}>
                  <CloseIcon />
                </button>
              </div>
            </div>

            <div className="search-controls">
              <label className="search-input-wrap">
                <SearchIcon />
                <input
                  aria-label="Search files and document text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search files or text..."
                />
              </label>
              <div className="search-scope" role="tablist" aria-label="Search scope">
                <button
                  type="button"
                  className={searchScope === "all" ? "active" : ""}
                  aria-selected={searchScope === "all"}
                  role="tab"
                  onClick={() => setSearchScope("all")}
                >
                  All files
                </button>
                <button
                  type="button"
                  className={searchScope === "open" ? "active" : ""}
                  aria-selected={searchScope === "open"}
                  role="tab"
                  onClick={() => setSearchScope("open")}
                >
                  Open docs
                </button>
              </div>
              <div className="replace-box" aria-label="Replace in opened documents">
                <label className="replace-input-wrap">
                  <span>Replace with</span>
                  <input
                    aria-label="Replacement text"
                    value={replaceText}
                    onChange={(event) => setReplaceText(event.target.value)}
                    placeholder="Replacement text"
                  />
                </label>
                <div className="replace-options">
                  <div className="search-scope compact-scope" role="tablist" aria-label="Replace scope">
                    <button
                      type="button"
                      className={replaceScope === "current" ? "active" : ""}
                      aria-selected={replaceScope === "current"}
                      role="tab"
                      onClick={() => setReplaceScope("current")}
                    >
                      Current
                    </button>
                    <button
                      type="button"
                      className={replaceScope === "open" ? "active" : ""}
                      aria-selected={replaceScope === "open"}
                      role="tab"
                      onClick={() => setReplaceScope("open")}
                    >
                      Open docs
                    </button>
                  </div>
                  <label className="replace-checkbox">
                    <input
                      type="checkbox"
                      checked={replaceCaseSensitive}
                      onChange={(event) => setReplaceCaseSensitive(event.target.checked)}
                    />
                    Case sensitive
                  </label>
                </div>
                <button
                  type="button"
                  className="primary replace-action"
                  disabled={!searchQuery.trim() || replaceMatchCount === 0}
                  onClick={replaceInOpenedDocuments}
                >
                  Replace {replaceMatchCount ? `${replaceMatchCount} match${replaceMatchCount === 1 ? "" : "es"}` : "matches"}
                </button>
                <p>Safe mode replaces visible XML text and editable text files only. Tags and attributes are preserved.</p>
              </div>
            </div>

            {!searchQuery.trim() ? (
              <div className="search-empty-state">
                <SearchIcon />
                <strong>Find files and content</strong>
                <p>Search by file name, folder path, DITA tags, attributes, or document text.</p>
              </div>
            ) : searchResults.length ? (
              <div className="search-results">
                {searchFileMatches.length > 0 && (
                  <section className="search-result-group">
                    <div className="search-group-title">
                      <span>Files</span>
                      <strong>{searchFileMatches.length}</strong>
                    </div>
                    {searchFileMatches.map((result) => (
                      <button type="button" className="search-result-card" key={result.id} onClick={() => openSearchResult(result)}>
                        <span className="search-result-icon">{result.fileKind}</span>
                        <span>
                          <strong>{renderHighlightedSearchText(result.label, searchQuery)}</strong>
                          <small>{renderHighlightedSearchText(result.detail, searchQuery)}</small>
                          <em>{renderHighlightedSearchText(result.snippet, searchQuery)}</em>
                        </span>
                      </button>
                    ))}
                  </section>
                )}

                {searchTextMatches.length > 0 && (
                  <section className="search-result-group">
                    <div className="search-group-title">
                      <span>Text matches</span>
                      <strong>{searchTextMatches.length}</strong>
                    </div>
                    {searchTextMatches.map((result) => (
                      <button type="button" className="search-result-card" key={result.id} onClick={() => openSearchResult(result)}>
                        <span className="search-result-icon">L{result.line}</span>
                        <span>
                          <strong>{renderHighlightedSearchText(result.label, searchQuery)}</strong>
                          <small>{renderHighlightedSearchText(result.detail, searchQuery)}</small>
                          <em>{renderHighlightedSearchText(result.snippet, searchQuery)}</em>
                        </span>
                      </button>
                    ))}
                  </section>
                )}
              </div>
            ) : (
              <div className="search-empty-state">
                <SearchIcon />
                <strong>No matches</strong>
                <p>Try a broader term, switch scope, or search for a DITA element like image, xref, or codeblock.</p>
              </div>
            )}
          </aside>
        )}

        {renderedSidePanel === "chat" && (
          <aside
            className={`inspector side-panel chat-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
            aria-label="AI authoring chat"
            aria-hidden={activeSidePanel ? undefined : "true"}
            onPointerDownCapture={rememberAuthoringSelectionForChat}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="panel-title">
              <span>AI Assistant</span>
              <div className="panel-title-actions">
                <strong>POC</strong>
                <button type="button" className="panel-close-button" title="Close panel" aria-label="Close AI Assistant panel" onClick={() => setActiveSidePanel(null)}>
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="chat-workspace">
              <div className="chat-toolbar" aria-label="Chat actions">
                <div className="chat-toolbar-actions">
                  <button
                    type="button"
                    className={voiceStatus === "connected" ? "voice-active" : ""}
                    title={voiceStatus === "connected" ? "Stop voice session" : "Start voice session"}
                    aria-label={voiceStatus === "connected" ? "Stop voice session" : "Start voice session"}
                    disabled={voiceStatus === "connecting"}
                    onClick={startVoiceSession}
                  >
                    <MicrophoneIcon />
                  </button>
                  <button
                    type="button"
                    title="Review current topic"
                    aria-label="Review current topic"
                    disabled={!activeIsXml || aiReviewStatus === "reviewing"}
                    onClick={runAiReview}
                  >
                    <AiReviewIcon />
                  </button>
                  <button type="button" title="New chat" aria-label="New chat" onClick={startNewChat}>
                    <NewChatIcon />
                  </button>
                  <button type="button" title="Clear chat" aria-label="Clear chat" onClick={clearChat}>
                    <ClearChatIcon />
                  </button>
                </div>
              </div>

              <div className="chat-panel-tabs" role="tablist" aria-label="Chat panel sections">
                <button
                  className={chatPanelTab === "chat" ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={chatPanelTab === "chat"}
                  onClick={() => setChatPanelTab("chat")}
                >
                  Chat
                </button>
                <button
                  className={chatPanelTab === "topics" ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={chatPanelTab === "topics"}
                  onClick={() => setChatPanelTab("topics")}
                >
                  Topics
                </button>
              </div>

              {chatPanelTab === "chat" ? (
                <>
                  <div className="chat-thread" aria-label="Chat conversation">
                    {chatMessages.length ? (
                      chatMessages.map((message, index) => (
                        <div className={`chat-message ${message.role}`} key={`${message.role}-${index}-${message.text.slice(0, 12)}`}>
                          <span>{message.role === "user" ? "You" : "Assistant"}</span>
                          <p>{message.text}</p>
                        </div>
                      ))
                    ) : (
                      <div className="chat-empty">
                        <strong>No messages</strong>
                        <p>Type below or choose a prepared topic.</p>
                      </div>
                    )}
                    <div className={`voice-status ${voiceStatus}`}>
                      <span>{voiceStatus === "connected" ? "Voice connected" : voiceStatus === "connecting" ? "Connecting voice" : voiceStatus === "error" ? "Voice unavailable" : "Voice"}</span>
                      <p>{voiceMessage}</p>
                    </div>
                  </div>
                  <div className="chat-composer">
                    <textarea
                      aria-label="Chat prompt"
                      placeholder="Ask the assistant..."
                      value={chatDraft}
                      disabled={chatStatus === "sending"}
                      onChange={(event) => setChatDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          sendChatMessage();
                        }
                      }}
                    />
                    <button type="button" className="primary" title="Send prompt" aria-label="Send prompt" disabled={!chatDraft.trim() || chatStatus === "sending"} onClick={() => sendChatMessage()}>
                      <SendIcon />
                    </button>
                  </div>
                </>
              ) : (
                <section className="prepared-prompts topics-panel" aria-label="Prepared topics">
                  <h3>Prepared topics</h3>
                  <button type="button" onClick={() => {
                    setChatDraft("Improve the selected text while preserving its DITA meaning.");
                    setChatPanelTab("chat");
                  }}>Improve selected text</button>
                  <button type="button" onClick={() => {
                    setChatDraft("Explain the selected DITA element and when I should use it.");
                    setChatPanelTab("chat");
                  }}>Explain this element</button>
                  <button type="button" onClick={() => {
                    setChatDraft("Suggest allowed child elements for the current selection.");
                    setChatPanelTab("chat");
                  }}>Suggest allowed children</button>
                  <button type="button" onClick={() => {
                    setChatDraft("Help me fix the current validation issues.");
                    setChatPanelTab("chat");
                  }}>Fix validation issues</button>
                  <button type="button" onClick={createAiReviewSampleFile}>Create AI Review sample</button>
                </section>
              )}
            </div>
          </aside>
        )}

        {renderedSidePanel === "aiReview" && (
          <aside
            className={`inspector side-panel ai-review-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
            aria-label="AI Review panel"
            aria-hidden={activeSidePanel ? undefined : "true"}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="panel-title">
              <span>AI Review</span>
              <div className="panel-title-actions">
                <strong>{aiSuggestions.length ? `${aiSuggestions.length}` : "POC"}</strong>
                <button type="button" className="panel-close-button" title="Close panel" aria-label="Close AI Review panel" onClick={() => setActiveSidePanel(null)}>
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="ai-review-workspace">
              <section className="ai-context-card" aria-label="Current AI context">
                <div>
                  <strong>Context</strong>
                  <span>{aiContext.activeFileName}</span>
                </div>
                <div className="ai-context-chips">
                  <span>{aiContext.topicType || "no document"}</span>
                  <span>{aiContext.selectedElementName ? `<${aiContext.selectedElementName}>` : "no element"}</span>
                  <span>{aiContext.validation.errorCount ? `${aiContext.validation.errorCount} errors` : "schema ready"}</span>
                </div>
              </section>
              <div className="ai-review-actions">
                <button type="button" className="primary" disabled={!activeIsXml || aiReviewStatus === "reviewing"} onClick={runAiReview}>
                  <AiReviewIcon />
                  <span>{aiReviewStatus === "reviewing" ? "Reviewing" : "Review Current Topic"}</span>
                </button>
                <button type="button" disabled={!activeIsXml || aiShortdescStatus === "generating"} onClick={generateAiShortdescSuggestion}>
                  <AiReviewIcon />
                  <span>{aiShortdescStatus === "generating" ? "Generating" : "Generate Shortdesc"}</span>
                </button>
                <button type="button" disabled={!activeIsXml || aiRewriteStatus === "rewriting"} onPointerDownCapture={rememberAuthoringSelectionForChat} onClick={() => rewriteSelectedTextSuggestion()}>
                  <AiReviewIcon />
                  <span>{aiRewriteStatus === "rewriting" ? "Rewriting" : "Rewrite Selection"}</span>
                </button>
              </div>
              <section className="ai-suggestion-stack" aria-label="AI review suggestions">
                <div className="ai-suggestion-heading">
                  <strong>Suggestions</strong>
                  <span>{aiSuggestions.length ? `${aiSuggestions.length} found` : "none yet"}</span>
                </div>
                {aiSuggestions.length ? (
                  aiSuggestions.map((suggestion) => (
                    <article className={`ai-suggestion ${suggestion.severity}`} key={suggestion.id}>
                      <div>
                        <strong>{suggestion.title}</strong>
                        {suggestion.targetPath ? <span>{suggestion.targetPath}</span> : null}
                      </div>
                      <p>{suggestion.body}</p>
                      {suggestion.operation ? (
                        <button type="button" onClick={() => applyAiSuggestion(suggestion)}>
                          Apply
                        </button>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <div className="chat-empty">
                    <strong>No review results</strong>
                    <p>Click Review Current Topic to analyze the active DITA document.</p>
                  </div>
                )}
              </section>
            </div>
          </aside>
        )}

        {renderedSidePanel === "schema" && (
          <aside
            className={`inspector side-panel schema-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
            aria-label="DITA schema panel"
            aria-hidden={activeSidePanel ? undefined : "true"}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="panel-title">
              <span>Schema</span>
              <div className="panel-title-actions">
                <strong>{selectedNode?.tagName || "None"}</strong>
                <button type="button" className="panel-close-button" title="Close panel" aria-label="Close Schema panel" onClick={() => setActiveSidePanel(null)}>
                  <CloseIcon />
                </button>
              </div>
            </div>
            <SchemaPanel
              selectedNode={selectedNode}
              selectedPath={selectedPath}
              parsedDoc={parsed.doc}
            />
          </aside>
        )}

        {renderedSidePanel === "github" && (
          <aside
            className={`inspector side-panel github-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
            aria-label="GitHub panel"
            aria-hidden={activeSidePanel ? undefined : "true"}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="panel-title">
              <span>GitHub</span>
              <div className="panel-title-actions">
                <strong className={githubStatus?.connected ? "status-ok" : "status-error"}>
                  {githubStatus?.connected ? "Connected" : "Offline"}
                </strong>
                <button type="button" className="panel-close-button" title="Close panel" aria-label="Close GitHub panel" onClick={() => setActiveSidePanel(null)}>
                  <CloseIcon />
                </button>
              </div>
            </div>

            <div className="github-panel-content">
              <section className="github-card">
                <header>
                  <div>
                    <h3>Connection</h3>
                    <p>{githubStatus?.connection?.github_login || "Connect a GitHub account to load repositories."}</p>
                  </div>
                  <button type="button" className="primary" onClick={connectGitHub}>
                    {githubStatus?.connected ? "Reconnect" : "Connect"}
                  </button>
                </header>
                {!githubStatus?.configured && (
                  <p className="github-warning">
                    GitHub OAuth is not configured. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to the backend .env file.
                  </p>
                )}
                {githubMessage && <p className="github-message">{githubMessage}</p>}
              </section>

              {githubStatus?.selectedRepository && (
                <section className="github-card selected-repo-card">
                  <header>
                    <div>
                      <h3>Selected repository</h3>
                      <a href={githubStatus.selectedRepository.html_url} target="_blank" rel="noreferrer">
                        {githubStatus.selectedRepository.full_name}
                      </a>
                      <small>
                        {githubStatus.selectedRepository.private ? "Private" : "Public"} · {githubStatus.selectedRepository.default_branch}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => loadSelectedGitHubRepositoryTree()}
                      disabled={githubTreeState === "loading"}
                    >
                      {githubTreeState === "loading" ? "Pulling..." : "Pull"}
                    </button>
                  </header>
                </section>
              )}

              <section className="github-card repository-list-card">
                <header>
                  <div>
                    <h3>Repositories</h3>
                    <p>Choose the repo XML Editor will pull from and check in to.</p>
                  </div>
                  <button type="button" onClick={loadGitHubRepositories} disabled={!githubStatus?.connected}>
                    Refresh
                  </button>
                </header>
                {githubRepositoriesState === "loading" ? (
                  <p className="section-empty">Loading repositories...</p>
                ) : githubRepositories.length ? (
                  <div className="github-repository-list">
                    {githubRepositories.map((repository) => (
                      <button
                        type="button"
                        key={repository.fullName}
                        className={githubStatus?.selectedRepository?.full_name === repository.fullName ? "selected" : ""}
                        onClick={() => chooseGitHubRepository(repository.fullName)}
                      >
                        <span>
                          <strong>{repository.fullName}</strong>
                          <small>{repository.private ? "Private" : "Public"} · {repository.defaultBranch}</small>
                        </span>
                        <GitHubIcon />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="section-empty">
                    {githubStatus?.connected ? "No repositories loaded yet." : "Connect GitHub before loading repositories."}
                  </p>
                )}
              </section>
            </div>
          </aside>
        )}

        {renderedSidePanel === "notifications" && (
          <aside
            className={`inspector side-panel notifications-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
            aria-label="Notifications panel"
            aria-hidden={activeSidePanel ? undefined : "true"}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="panel-title">
              <span>Notifications</span>
              <div className="panel-title-actions">
                <strong>{notifications.length}</strong>
                <button type="button" className="panel-close-button" title="Close panel" aria-label="Close Notifications panel" onClick={() => setActiveSidePanel(null)}>
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="notifications-panel-content">
              <div className="notifications-panel-toolbar">
                <div>
                  <strong>Event history</strong>
                  <span className="notification-history-summary">
                    <span
                      className="notification-info-icon"
                      aria-label="Showing the latest 10 notifications. Older notifications are removed when new ones arrive."
                      role="img"
                      tabIndex={0}
                    >
                      i
                      <span className="notification-info-tooltip" role="tooltip">
                        Showing the latest 10 notifications. Older notifications are removed when new ones arrive.
                      </span>
                    </span>
                    <span>Showing...</span>
                  </span>
                </div>
                <button type="button" disabled={!notifications.length} onClick={clearNotifications}>
                  Clear all
                </button>
              </div>
              {notificationStatus === "error" && (
                <p className="notification-history-note">
                  Notification history could not sync with Postgres. Local notifications are still visible for this session.
                </p>
              )}
              {notifications.length ? (
                <div className="notification-history-list">
                  {notifications.map((notification) => (
                    <article className={`notification-history-card ${notification.severity}`} key={notification.id}>
                      <span className="notification-severity-dot" aria-hidden="true" />
                      <div>
                        <header>
                          <strong>{notification.title}</strong>
                          <time>{formatNotificationTime(notification.createdAt)}</time>
                        </header>
                        <p>{notification.body}</p>
                        {notification.source && <small>{notification.source}</small>}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="notification-empty-state">
                  <NotificationIcon />
                  <strong>No notifications</strong>
                  <p>Validation results, merge conflicts, and other important events will appear here.</p>
                </div>
              )}
            </div>
          </aside>
        )}

        {renderedSidePanel === "help" && (
          <aside
            className={`inspector side-panel help-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
            aria-label="Help panel"
            aria-hidden={activeSidePanel ? undefined : "true"}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="panel-title">
              <span>Help</span>
              <div className="panel-title-actions">
                <strong>TOC</strong>
                <button type="button" className="panel-close-button" title="Close panel" aria-label="Close Help panel" onClick={() => setActiveSidePanel(null)}>
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="help-toc">
              <button type="button">
                <span>Getting started</span>
                <small>Create and open files</small>
              </button>
              <button type="button">
                <span>Authoring DITA</span>
                <small>Insert, wrap, and edit elements</small>
              </button>
              <button type="button">
                <span>Working with references</span>
                <small>Images, xrefs, and validation</small>
              </button>
              <button type="button">
                <span>Tabs and panes</span>
                <small>Split, move, and reorder tabs</small>
              </button>
              <button type="button">
                <span>Validation</span>
                <small>Understand schema issues</small>
              </button>
            </div>
          </aside>
        )}

        {activeIsVisualTemplateBinding && renderedSidePanel === "templateSources" && (
          <aside
            className={`inspector side-panel visual-template-side-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
            aria-label="Dropped files panel"
            aria-hidden={activeSidePanel ? undefined : "true"}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="panel-title">
              <span>Dropped Files</span>
              <div className="panel-title-actions">
                <strong>{getVisualTemplateBoundSources().length}</strong>
                <button type="button" className="panel-close-button" title="Close panel" aria-label="Close Dropped Files panel" onClick={() => setActiveSidePanel(null)}>
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="visual-template-side-content">
              {getVisualTemplateBoundSources().length ? (
                getVisualTemplateBoundSources().map((source) => (
                  <div
                    className={`visual-template-source-card${visualTemplateSourceId === source.id ? " active" : ""}`}
                    key={source.id}
                  >
                    <button
                      type="button"
                      className="visual-template-source-main"
                      onClick={() => setVisualTemplateSourceId(source.id)}
                    >
                      <span>{source.rootName}</span>
                      <strong>{source.name}</strong>
                      {source.title && source.title !== source.name ? <em>{source.title}</em> : null}
                      <small>{source.path}</small>
                    </button>
                    <button
                      type="button"
                      className="visual-template-source-remove"
                      title={`Remove ${source.title} from binding sources`}
                      aria-label={`Remove ${source.title} from binding sources`}
                      onClick={() => removeVisualTemplateSource(source)}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                ))
              ) : (
                <div className="visual-template-empty-source">
                  <strong>No dropped files</strong>
                  <p>Drag DITA topics or maps from Explorer onto a binding container to add sources here.</p>
                </div>
              )}
            </div>
          </aside>
        )}

        {activeIsVisualTemplateBinding && renderedSidePanel === "templateBindings" && (
          <aside
            className={`inspector side-panel visual-template-side-panel right-panel${activeSidePanel ? "" : " collapsed"}`}
            aria-label="Template bindings panel"
            aria-hidden={activeSidePanel ? undefined : "true"}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="panel-title">
              <span>Container Slots</span>
              <div className="panel-title-actions">
                <strong>{visualTemplateModel.regions.length}</strong>
                <button type="button" className="panel-close-button" title="Close panel" aria-label="Close Bindings panel" onClick={() => setActiveSidePanel(null)}>
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="visual-template-side-content">
              {visualTemplateModel.regions.map((region) => {
                const sources = getVisualTemplateSources();
                const regionSource = getVisualTemplateRegionSource(region, sources);
                const droppedSources = getVisualTemplateBoundSources(sources);
                const bindingOptions = getVisualTemplateBindingOptions(regionSource);
                const bindingPreview = getVisualTemplateBindingPreview(regionSource, region.binding);
                return (
                  <div className="visual-binding-row editable" key={region.id}>
                    <header>
                      <div>
                        <strong>{region.label} container</strong>
                        <small>{region.role} layout · {region.binding} slot</small>
                      </div>
                      {regionSource ? (
                        <button
                          className="visual-binding-reset"
                          type="button"
                          onClick={() => resetVisualTemplateRegion(region.id)}
                        >
                          Reset
                        </button>
                      ) : null}
                    </header>
                    <label>
                      <span>Source</span>
                      <select
                        value={regionSource?.id || ""}
                        onChange={(event) => setVisualTemplateRegionSource(region.id, event.target.value)}
                      >
                        <option value="">Drop a source file</option>
                        {droppedSources.map((source) => (
                          <option value={source.id} key={source.id}>
                            {getVisualTemplateSourceLabel(source)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Binding</span>
                      <select
                        value={region.binding}
                        onChange={(event) => updateVisualTemplateRegion(region.id, { binding: event.target.value })}
                      >
                        {bindingOptions.map((option) => (
                          <option value={option.value} key={option.value}>
                            {option.label}{option.hasValue === false ? " (empty)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="visual-binding-preview">
                      <span>Preview</span>
                      <p>{bindingPreview}</p>
                    </div>
                    <code>
                      {regionSource ? `${regionSource.path}#${region.binding}` : "No source bound"}
                    </code>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {renderedSidePanel === "templateLayers" && renderVisualTemplateLayersPanel()}

        {renderedSidePanel === "templateLayout" && renderVisualTemplateLayoutPanel()}

        {renderedSidePanel === "templateStyle" && renderVisualTemplateStylePanel()}

        <nav className="side-dock" aria-label="Right side panels" onContextMenu={(event) => event.preventDefault()}>
          {activeIsVisualTemplate ? (
            <>
              {activeIsVisualTemplateBinding && (
                <>
                  <button
                    className={activeSidePanel === "templateSources" ? "active" : ""}
                    type="button"
                    title="Dropped Files"
                    data-tooltip="Dropped Files"
                    aria-label="Toggle Dropped Files panel"
                    aria-pressed={activeSidePanel === "templateSources"}
                    onClick={() => setActiveSidePanel((current) => current === "templateSources" ? null : "templateSources")}
                  >
                    <TemplateSourcesIcon />
                  </button>
                  <button
                    className={activeSidePanel === "templateBindings" ? "active" : ""}
                    type="button"
                    title="Bindings"
                    data-tooltip="Bindings"
                    aria-label="Toggle Bindings panel"
                    aria-pressed={activeSidePanel === "templateBindings"}
                    onClick={() => setActiveSidePanel((current) => current === "templateBindings" ? null : "templateBindings")}
                  >
                    <TemplateBindingsIcon />
                  </button>
                </>
              )}
              <button
                className={activeSidePanel === "templateLayers" ? "active" : ""}
                type="button"
                title="Layers"
                data-tooltip="Layers"
                aria-label="Toggle Layers panel"
                aria-pressed={activeSidePanel === "templateLayers"}
                onClick={() => setActiveSidePanel((current) => current === "templateLayers" ? null : "templateLayers")}
              >
                <TemplateLayersIcon />
              </button>
              <button
                className={activeSidePanel === "templateLayout" ? "active" : ""}
                type="button"
                title="Layout"
                data-tooltip="Layout"
                aria-label="Toggle Layout panel"
                aria-pressed={activeSidePanel === "templateLayout"}
                onClick={() => setActiveSidePanel((current) => current === "templateLayout" ? null : "templateLayout")}
              >
                <TemplateLayoutIcon />
              </button>
              <button
                className={activeSidePanel === "templateStyle" ? "active" : ""}
                type="button"
                title="Style"
                data-tooltip="Style"
                aria-label="Toggle Style panel"
                aria-pressed={activeSidePanel === "templateStyle"}
                onClick={() => setActiveSidePanel((current) => current === "templateStyle" ? null : "templateStyle")}
              >
                <TemplateStyleIcon />
              </button>
              <button
                className={activeSidePanel === "notifications" ? "active" : ""}
                type="button"
                title="Notifications"
                data-tooltip="Notifications"
                aria-label="Toggle Notifications panel"
                aria-pressed={activeSidePanel === "notifications"}
                onClick={() => setActiveSidePanel((current) => current === "notifications" ? null : "notifications")}
              >
                <NotificationIcon />
                {unreadNotificationCount > 0 && <span className="dock-badge">{Math.min(99, unreadNotificationCount)}</span>}
              </button>
            </>
          ) : (
            <>
          <button
            className={activeSidePanel === "inspector" ? "active" : ""}
            type="button"
            title="Inspector"
            data-tooltip="Inspector"
            aria-label="Toggle Inspector panel"
            aria-pressed={activeSidePanel === "inspector"}
            onClick={() => setActiveSidePanel((current) => current === "inspector" ? null : "inspector")}
          >
            <InspectorIcon />
          </button>
          <button
            className={activeSidePanel === "schema" ? "active" : ""}
            type="button"
            title="Schema"
            data-tooltip="Schema"
            aria-label="Toggle Schema panel"
            aria-pressed={activeSidePanel === "schema"}
            onClick={() => setActiveSidePanel((current) => current === "schema" ? null : "schema")}
          >
            <SchemaIcon />
          </button>
          <button
            className={activeSidePanel === "search" ? "active" : ""}
            type="button"
            title="Search"
            data-tooltip="Search"
            aria-label="Toggle Search panel"
            aria-pressed={activeSidePanel === "search"}
            onClick={() => setActiveSidePanel((current) => current === "search" ? null : "search")}
          >
            <SearchIcon />
          </button>
          <button
            className={activeSidePanel === "chat" ? "active" : ""}
            type="button"
            title="AI Assistant"
            data-tooltip="AI Assistant"
            aria-label="Toggle AI Assistant panel"
            aria-pressed={activeSidePanel === "chat"}
            onPointerDownCapture={rememberAuthoringSelectionForChat}
            onClick={() => setActiveSidePanel((current) => current === "chat" ? null : "chat")}
          >
            <ChatIcon />
          </button>
          <button
            className={activeSidePanel === "aiReview" ? "active" : ""}
            type="button"
            title="AI Review"
            data-tooltip="AI Review"
            aria-label="Toggle AI Review panel"
            aria-pressed={activeSidePanel === "aiReview"}
            onClick={() => {
              const shouldRunReview = activeSidePanel !== "aiReview" && activeIsXml && aiSuggestions.length === 0;
              setActiveSidePanel((current) => current === "aiReview" ? null : "aiReview");
              if (shouldRunReview) {
                window.setTimeout(runAiReview, 0);
              }
            }}
          >
            <AiReviewIcon />
          </button>
          <button
            className={activeSidePanel === "github" ? "active" : ""}
            type="button"
            title="GitHub"
            data-tooltip="GitHub"
            aria-label="Toggle GitHub panel"
            aria-pressed={activeSidePanel === "github"}
            onClick={() => setActiveSidePanel((current) => current === "github" ? null : "github")}
          >
            <GitHubIcon />
          </button>
          <button
            className={activeSidePanel === "notifications" ? "active" : ""}
            type="button"
            title="Notifications"
            data-tooltip="Notifications"
            aria-label="Toggle Notifications panel"
            aria-pressed={activeSidePanel === "notifications"}
            onClick={() => setActiveSidePanel((current) => current === "notifications" ? null : "notifications")}
          >
            <NotificationIcon />
            {unreadNotificationCount > 0 && <span className="dock-badge">{Math.min(99, unreadNotificationCount)}</span>}
          </button>
          <button
            className={activeSidePanel === "help" ? "active" : ""}
            type="button"
            title="Help"
            data-tooltip="Help"
            aria-label="Toggle Help panel"
            aria-pressed={activeSidePanel === "help"}
            onClick={() => setActiveSidePanel((current) => current === "help" ? null : "help")}
          >
            <HelpIcon />
          </button>
            </>
          )}
        </nav>
      </section>
      {contextMenu && (
        <SchemaContextMenu
          contextMenu={contextMenu}
          onClose={() => {
            setContextMenu(null);
            contextSelectionRangeRef.current = null;
            setPinnedAuthoringSelection(null);
          }}
          onInsert={(tagName, placement) => {
            caretRef.current = contextMenu.authoringSelection;
            insertElement(tagName, placement, contextMenu.path);
            setContextMenu(null);
            contextSelectionRangeRef.current = null;
            setPinnedAuthoringSelection(null);
          }}
          onSpellingReplace={replaceSpellingIssue}
          onSpellingIgnore={ignoreSpellingIssue}
          onSpellingAddToDictionary={addSpellingIssueToDictionary}
          onTableCommand={(command) => {
            runTableCommand(command, contextMenu.path);
            setContextMenu(null);
          }}
          onAiAction={(action) => {
            caretRef.current = contextMenu.authoringSelection;
            setContextMenu(null);
            contextSelectionRangeRef.current = null;

            if (action === "rewrite") {
              rewriteSelectedTextSuggestion();
            } else if (action === "shorter") {
              rewriteSelectedTextSuggestion({
                instruction: "Make the selected text shorter and more direct while preserving the technical meaning.",
                logLabel: "Shortening selected text",
                suggestionTitle: "AI shorter rewrite proposal",
              });
            } else if (action === "longer") {
              rewriteSelectedTextSuggestion({
                instruction: "Expand the selected text with helpful detail while preserving the technical meaning and without inventing facts.",
                logLabel: "Expanding selected text",
                suggestionTitle: "AI expanded rewrite proposal",
              });
            } else if (action === "shortdesc") {
              generateAiShortdescSuggestion();
            } else if (action === "review") {
              runAiReview();
            } else if (action === "explain") {
              explainSelectedElement(contextMenu.path);
            }
          }}
        />
      )}
      {tabContextMenu && (
        <TabContextMenu
          contextMenu={tabContextMenu}
          paneCount={tabPanes.length}
          hasRightPane={hasRightPane}
          hasBottomPane={hasBottomPane}
          hasSecondaryPane={hasSecondaryPane}
          sourcePaneTabCount={tabPanes.find((pane) => pane.id === tabContextMenu.paneId)?.tabs.length || 0}
          fileName={getFileName(tabContextMenu.fileId)}
          onClose={() => setTabContextMenu(null)}
          onCloseTab={() => closeTab(tabContextMenu.fileId, null, tabContextMenu.paneId)}
          onCloseOthers={() => closeOtherTabs(tabContextMenu.fileId, tabContextMenu.paneId)}
          onCloseAll={() => closeAllTabs(tabContextMenu.paneId)}
          onSplitRight={() => splitTabRight(tabContextMenu.fileId, tabContextMenu.paneId)}
          onSplitDown={() => splitTabDown(tabContextMenu.fileId, tabContextMenu.paneId)}
          onSplitAndMoveRight={() => splitAndMoveTabRight(tabContextMenu.fileId, tabContextMenu.paneId)}
          onSplitAndMoveDown={() => splitAndMoveTabDown(tabContextMenu.fileId, tabContextMenu.paneId)}
          onMoveLeft={() => moveTabToPane(tabContextMenu.fileId, tabContextMenu.paneId, "pane-left")}
          onMoveRight={() => moveTabToPane(tabContextMenu.fileId, tabContextMenu.paneId, "pane-right")}
          onMoveBottom={() => moveTabToPane(tabContextMenu.fileId, tabContextMenu.paneId, "pane-bottom")}
        />
      )}
      {projectContextMenu && (
        <ProjectContextMenu
          contextMenu={projectContextMenu}
          projectTree={projectTree}
          onOpen={(nodeId) => {
            const node = findProjectNode(projectTree, nodeId)?.node;
            if (node?.type === "file") {
              openProjectFile(nodeId);
            }
            setProjectContextMenu(null);
          }}
          onNewFile={(nodeId) => {
            setFileTypePicker({
              x: projectContextMenu.x,
              y: projectContextMenu.y,
              folderId: getExplorerTargetFolderId(nodeId),
            });
            setProjectContextMenu(null);
          }}
          onNewFolder={(nodeId) => {
            createExplorerFolder(getExplorerTargetFolderId(nodeId));
            setProjectContextMenu(null);
          }}
          onRename={(nodeId) => {
            renameProjectItemById(nodeId);
            setProjectContextMenu(null);
          }}
          onCopy={(nodeId) => {
            copyProjectItemById(nodeId);
            setProjectContextMenu(null);
          }}
          onDelete={(nodeId) => {
            deleteProjectItemById(nodeId);
            setProjectContextMenu(null);
          }}
          onCheckIn={(nodeId) => {
            checkInProjectFileById(nodeId);
            setProjectContextMenu(null);
          }}
          onGitHistory={(nodeId) => {
            openGitHistoryForProjectFile(nodeId);
            setProjectContextMenu(null);
          }}
          onProperties={(nodeId) => {
            setProjectPropertiesNodeId(nodeId);
            setProjectContextMenu(null);
          }}
          onClose={() => setProjectContextMenu(null)}
        />
      )}
      {gitCommitContextMenu && (
        <GitCommitContextMenu
          contextMenu={gitCommitContextMenu}
          onCheckout={() => checkoutGitHistoryCommit(gitCommitContextMenu.payload, gitCommitContextMenu.commit)}
          onOpenGitHub={() => {
            if (gitCommitContextMenu.commit.htmlUrl) {
              window.open(gitCommitContextMenu.commit.htmlUrl, "_blank", "noopener,noreferrer");
            }
            setGitCommitContextMenu(null);
          }}
          onClose={() => setGitCommitContextMenu(null)}
        />
      )}
      {fileTypePicker && (
        <FileTypePicker
          picker={fileTypePicker}
          fileTypes={[
            ...getActiveDitaSchemaProfile().fileTypes,
            visualTemplateFileType,
          ]}
          onSelect={(typeKey) => createExplorerFile(typeKey, fileTypePicker.folderId)}
        />
      )}
      {projectPropertiesNodeId && (
        <ProjectPropertiesPopup
          nodeId={projectPropertiesNodeId}
          projectTree={projectTree}
          fileHistories={fileHistories}
          onClose={() => setProjectPropertiesNodeId(null)}
        />
      )}
      {visualTemplatePickerMode && (
        <VisualTemplatePickerDialog
          mode={visualTemplatePickerMode}
          templates={getVisualTemplateCatalog()}
          onSelect={(template) => {
            if (visualTemplatePickerMode === "create" && visualTemplateCreationTarget) {
              createExplorerVisualTemplateFile(template, visualTemplateCreationTarget);
            } else {
              startVisualTemplateDesigner(template);
            }
            setVisualTemplatePickerMode(null);
          }}
          onClose={() => {
            setVisualTemplatePickerMode(null);
            setVisualTemplateCreationTarget(null);
          }}
        />
      )}
      {visualTemplateSaveAsOpen && (
        <VisualTemplateSaveAsDialog
          projectTree={projectTree}
          initialFolderId={getExplorerTargetFolderId()}
          suggestedFileName={getSuggestedVisualTemplateFileName()}
          onSave={(filePath) => {
            setVisualTemplateSaveAsOpen(false);
            void saveVisualTemplateDraft(filePath);
          }}
          onClose={() => setVisualTemplateSaveAsOpen(false)}
        />
      )}
      {visualTemplateUploadOpen && (
        <VisualTemplateUploadDialog
          onUpload={(file) => { void uploadVisualTemplateFile(file); }}
          onClose={() => setVisualTemplateUploadOpen(false)}
        />
      )}
      {visualTemplateImportOpen && (
        <VisualTemplateImportDialog
          onImport={startImportedVisualTemplate}
          onClose={() => setVisualTemplateImportOpen(false)}
        />
      )}
      {toastNotifications.length > 0 && (
        <div className="notification-toast-stack" role="status" aria-live="polite">
          {toastNotifications.map((notification) => (
            <article className={`notification-toast ${notification.severity}`} key={notification.id}>
              <div>
                <header>
                  <strong>{notification.title}</strong>
                  <button
                    type="button"
                    className="toast-close-button"
                    aria-label={`Dismiss ${notification.title}`}
                    onClick={() => dismissNotificationToast(notification.id)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </header>
                <p>{notification.body}</p>
                <small>
                  {notification.source ? `${notification.source} · ` : ""}
                  {formatNotificationTime(notification.createdAt)}
                </small>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function ProjectContextMenu({
  contextMenu,
  projectTree,
  onOpen,
  onNewFile,
  onNewFolder,
  onRename,
  onCopy,
  onDelete,
  onCheckIn,
  onGitHistory,
  onProperties,
  onClose,
}) {
  const menuRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const node = findProjectNode(projectTree, contextMenu.nodeId)?.node;
  const isRoot = node?.id === "root";
  const isFile = node?.type === "file";
  const label = node?.name || "Project";

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(contextMenu.x, margin), window.innerWidth - rect.width - margin);
    const shouldOpenAbove = contextMenu.y + rect.height + margin > window.innerHeight;
    const top = shouldOpenAbove
      ? Math.max(margin, contextMenu.y - rect.height - 4)
      : Math.min(contextMenu.y, window.innerHeight - rect.height - margin);

    setMenuPosition({ x: left, y: top });
  }, [contextMenu.x, contextMenu.y, contextMenu.nodeId]);

  return (
    <div
      ref={menuRef}
      className="tab-context-menu project-context-menu"
      style={{
        left: menuPosition?.x ?? contextMenu.x,
        top: menuPosition?.y ?? contextMenu.y,
        visibility: menuPosition ? "visible" : "hidden",
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      aria-label={`Explorer actions for ${label}`}
    >
      {isFile && <ProjectMenuItem icon="open" label="Open" onClick={() => onOpen(contextMenu.nodeId)} />}
      <ProjectMenuItem icon="file" label="New File" onClick={() => onNewFile(contextMenu.nodeId)} />
      <ProjectMenuItem icon="folder" label="New Folder" onClick={() => onNewFolder(contextMenu.nodeId)} />
      <hr />
      <ProjectMenuItem icon="rename" label="Rename" disabled={isRoot} onClick={() => onRename(contextMenu.nodeId)} />
      <ProjectMenuItem icon="copy" label="Copy" disabled={isRoot} onClick={() => onCopy(contextMenu.nodeId)} />
      {isFile && <ProjectMenuItem icon="check" label="Check in" onClick={() => onCheckIn(contextMenu.nodeId)} />}
      {isFile && <ProjectMenuItem icon="history" label="Git History" onClick={() => onGitHistory(contextMenu.nodeId)} />}
      <hr />
      <ProjectMenuItem icon="info" label="Properties" onClick={() => onProperties(contextMenu.nodeId)} />
      <hr />
      <ProjectMenuItem icon="delete" label="Delete" tone="danger" disabled={isRoot} onClick={() => onDelete(contextMenu.nodeId)} />
    </div>
  );
}

function ProjectMenuItem({ icon, label, disabled = false, tone = "default", onClick }) {
  return (
    <button
      type="button"
      className={`project-menu-item${tone === "danger" ? " danger-menu-item" : ""}`}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
    >
      <span className="project-menu-icon" aria-hidden="true">
        <ProjectMenuIcon type={icon} />
      </span>
      <span className="project-menu-label">{label}</span>
    </button>
  );
}

function ProjectMenuIcon({ type }) {
  if (type === "open") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M5 6.5h5l2 2h7v8A2.5 2.5 0 0 1 16.5 19h-9A2.5 2.5 0 0 1 5 16.5z" />
        <path d="M8 13h7" />
        <path d="m12 10 3 3-3 3" />
      </svg>
    );
  }

  if (type === "file") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M6 4h8l4 4v12H6z" />
        <path d="M14 4v5h5" />
        <path d="M12 12v5" />
        <path d="M9.5 14.5h5" />
      </svg>
    );
  }

  if (type === "folder") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v6A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5z" />
        <path d="M12 10.5v5" />
        <path d="M9.5 13h5" />
      </svg>
    );
  }

  if (type === "rename") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M5 19h4l10-10-4-4L5 15z" />
        <path d="m13.5 6.5 4 4" />
      </svg>
    );
  }

  if (type === "copy") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <rect x="8" y="8" width="10" height="12" rx="2" />
        <path d="M6 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }

  if (type === "check") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M5 12.5 9.2 17 19 7" />
      </svg>
    );
  }

  if (type === "history") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M4 12a8 8 0 1 0 2.35-5.65" />
        <path d="M4 5.5v4h4" />
        <path d="M12 8v4l3 2" />
      </svg>
    );
  }

  if (type === "info") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 11.5V16" />
        <path d="M12 8h.01" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M6 7h12" />
      <path d="M9 7V5h6v2" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
      <path d="M7 7l1 13h8l1-13" />
    </svg>
  );
}

function FileTypePicker({ picker, fileTypes, onSelect }) {
  const pickerRef = useRef(null);
  const [position, setPosition] = useState(null);
  const visibleFileTypes = fileTypes?.length ? fileTypes : ditaFileTypes;

  useLayoutEffect(() => {
    const menu = pickerRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(picker.x, margin), window.innerWidth - rect.width - margin);
    const top = Math.min(Math.max(picker.y, margin), window.innerHeight - rect.height - margin);

    setPosition({ x: left, y: top });
  }, [picker.x, picker.y]);

  return (
    <div
      ref={pickerRef}
      className="file-type-picker"
      style={{
        left: position?.x ?? picker.x,
        top: position?.y ?? picker.y,
        visibility: position ? "visible" : "hidden",
      }}
      role="menu"
      aria-label="Choose DITA file type"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {visibleFileTypes.map((fileType) => (
        <button key={fileType.key} type="button" onClick={() => onSelect(fileType.key)}>
          <span className={`project-node-icon ${getDocumentTypeIconKind(fileType.key)}`} aria-hidden="true">
            <FileTypeIcon kind={getDocumentTypeIconKind(fileType.key)} />
          </span>
          <span>{fileType.label || getDocumentTypeLabel(fileType.key)}</span>
        </button>
      ))}
    </div>
  );
}

function VisualTemplatePickerDialog({ mode, templates, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selectedId, setSelectedId] = useState(mode === "create" ? "blank" : templates[0]?.id || "");
  const title = mode === "create" ? "New template" : "Open template";
  const createTemplates = [
    {
      id: "blank",
      name: "Blank",
      description: "Start from scratch with an empty canvas.",
      category: "Basic",
      source: "blank",
      available: true,
      regions: [],
      preview: "blank",
    },
    {
      id: "basic",
      name: "Basic",
      description: "Hero, Body, Sidebar and Footer containers.",
      category: "Basic",
      source: "starter",
      available: true,
      regions: defaultVisualTemplateModel.regions,
      preview: "basic",
      badge: "Starter",
    },
    {
      id: "article",
      name: "Article",
      description: "Single-column article with title and body.",
      category: "Document",
      source: "planned",
      available: false,
      preview: "article",
    },
    {
      id: "two-column",
      name: "Two Column",
      description: "Split layout for side-by-side content.",
      category: "Document",
      source: "planned",
      available: false,
      preview: "two-column",
    },
    {
      id: "cover-page",
      name: "Cover Page",
      description: "Title page with centered content and footer.",
      category: "Document",
      source: "planned",
      available: false,
      preview: "cover",
    },
    {
      id: "reference",
      name: "Reference",
      description: "Structured reference topic with table rows.",
      category: "DITA",
      source: "planned",
      available: false,
      preview: "reference",
      badge: "DITA",
    },
    {
      id: "task",
      name: "Task",
      description: "Step-by-step task topic layout.",
      category: "DITA",
      source: "planned",
      available: false,
      preview: "task",
      badge: "DITA",
    },
    {
      id: "concept",
      name: "Concept",
      description: "Concept topic with icon and description.",
      category: "DITA",
      source: "planned",
      available: false,
      preview: "concept",
      badge: "DITA",
    },
    {
      id: "newsletter",
      name: "Newsletter",
      description: "Multi-column newsletter with hero and article blocks.",
      category: "Newsletter",
      source: "planned",
      available: false,
      preview: "newsletter",
      badge: "New",
    },
    {
      id: "email-newsletter",
      name: "Email Newsletter",
      description: "Single-column email layout with header and sections.",
      category: "Newsletter",
      source: "planned",
      available: false,
      preview: "email",
      badge: "New",
    },
    {
      id: "linkedin",
      name: "LinkedIn Post",
      description: "Professional post with image and caption.",
      category: "Social Media",
      source: "planned",
      available: false,
      preview: "linkedin",
      badge: "Social",
    },
    {
      id: "instagram",
      name: "Instagram Post",
      description: "Square 1:1 visual-first post layout.",
      category: "Social Media",
      source: "planned",
      available: false,
      preview: "instagram",
      badge: "Social",
    },
  ];
  const pickerTemplates = mode === "create"
    ? createTemplates
    : templates.map((template) => ({
        ...template,
        category: "Basic",
        available: true,
        preview: "basic",
      }));
  const categories = ["All", "Basic", "Document", "DITA", "Newsletter", "Social Media"];
  const filteredTemplates = pickerTemplates.filter((template) => {
    const matchesCategory = category === "All" || template.category === category;
    const haystack = `${template.name} ${template.description} ${template.category}`.toLowerCase();
    return matchesCategory && haystack.includes(query.trim().toLowerCase());
  });
  const selectedTemplate = pickerTemplates.find((template) => template.id === selectedId) || filteredTemplates[0] || pickerTemplates[0];
  const canCreate = mode !== "create" || selectedTemplate?.available;
  const actionLabel = mode === "create" ? "Create template" : "Open template";

  function createTemplateFromSelection(template) {
    if (!template?.available) return;
    const templateName = template.id === "blank"
      ? `Blank template ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : `Basic template ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    onSelect({
      id: `template-${template.id}-${Date.now().toString(36)}`,
      name: templateName,
      description: template.description,
      source: template.source,
      regions: template.id === "blank" ? [] : defaultVisualTemplateModel.regions,
    });
  }

  function chooseTemplate(template) {
    setSelectedId(template.id);
    if (mode === "open") {
      onSelect(template);
    }
  }

  return (
    <div className="template-picker-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="template-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <header className="template-picker-header">
          <div>
            <strong>{title}</strong>
            <p>Choose a starting layout for your visual template.</p>
          </div>
          <button type="button" aria-label="Close template picker" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="template-picker-filters">
          <label className="template-picker-search">
            <SearchIcon />
            <input
              type="search"
              value={query}
              placeholder="Search templates..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="template-picker-categories" aria-label="Template categories">
            {categories.map((item) => (
              <button
                type="button"
                key={item}
                className={category === item ? "active" : ""}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="template-picker-list" role="listbox" aria-label="Template layouts">
          {filteredTemplates.map((template) => {
            const selected = selectedTemplate?.id === template.id;
            return (
              <button
                type="button"
                key={template.id}
                className={`template-layout-card${selected ? " selected" : ""}${template.available ? "" : " disabled"}`}
                onClick={() => chooseTemplate(template)}
                onDoubleClick={() => template.available && createTemplateFromSelection(template)}
                aria-selected={selected}
              >
                <TemplatePreview variant={template.preview} badge={template.badge} />
                <span className="template-selected-check" aria-hidden="true">
                  <CheckIcon />
                </span>
                <strong>{template.name}</strong>
                <small>{template.description}</small>
              </button>
            );
          })}
          {filteredTemplates.length === 0 && (
            <div className="template-picker-empty">No templates match your search.</div>
          )}
        </div>
        <footer className="template-picker-footer">
          <div>
            <span className="template-picker-dot" aria-hidden="true" />
            <strong>{selectedTemplate?.name || "Blank"}</strong>
            <span>{selectedTemplate?.available ? "selected · double-click to create" : "preview only · coming later"}</span>
          </div>
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary"
            disabled={!canCreate}
            onClick={() => (mode === "create" ? createTemplateFromSelection(selectedTemplate) : selectedTemplate && onSelect(selectedTemplate))}
          >
            {actionLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function VisualTemplateSaveAsDialog({ projectTree, initialFolderId, suggestedFileName, onSave, onClose }) {
  const folders = collectVisualTemplateFolders(projectTree);
  const fallbackFolderId = folders.find((folder) => folder.path === "content")?.id || folders[0]?.id || projectTree.id;
  const initialFolderExists = folders.some((folder) => folder.id === initialFolderId);
  const [selectedFolderId, setSelectedFolderId] = useState(initialFolderExists ? initialFolderId : fallbackFolderId);
  const [fileName, setFileName] = useState(suggestedFileName || "visual-template.af-template.json");
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) || folders[0];
  const normalizedFileName = normalizeFileName(fileName || "visual-template", "visual-template");
  const selectedFolderNode = selectedFolder ? findProjectNode(projectTree, selectedFolder.id)?.node : null;
  const duplicateName = Boolean(selectedFolderNode?.children?.some((child) => (
    child.type === "file"
    && !child.deletedAt
    && String(child.name || "").toLowerCase() === normalizedFileName.toLowerCase()
  )));
  const canSave = Boolean(selectedFolder && normalizedFileName.trim() && !duplicateName);
  const targetPath = selectedFolder ? getGitHubChildPath(selectedFolder.node, normalizedFileName) || normalizedFileName : normalizedFileName;

  return (
    <div className="template-picker-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="template-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Save visual template"
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <header className="template-picker-header">
          <div>
            <strong>Save template as</strong>
            <p>Choose where this visual template should live in the workspace.</p>
          </div>
          <button type="button" aria-label="Close save template dialog" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="template-save-body">
          <label className="template-save-field">
            <span>File name</span>
            <input
              type="text"
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              onBlur={() => setFileName(normalizedFileName)}
              autoFocus
            />
          </label>
          <section className="template-save-location" aria-label="Template location">
            <div className="template-save-section-title">Location</div>
            <div className="template-save-folder-list">
              {folders.map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  className={folder.id === selectedFolderId ? "active" : ""}
                  style={{ "--folder-depth": folder.depth } as React.CSSProperties}
                  onClick={() => setSelectedFolderId(folder.id)}
                >
                  <FolderFileIcon />
                  <span>{folder.path || "Workspace root"}</span>
                </button>
              ))}
            </div>
          </section>
          <div className={`template-save-preview${duplicateName ? " error" : ""}`}>
            <span>{duplicateName ? "A file with this name already exists." : "Will be saved as"}</span>
            <strong>{duplicateName ? normalizedFileName : targetPath}</strong>
          </div>
        </div>
        <footer className="template-picker-footer">
          <div>
            <span className="template-picker-dot" aria-hidden="true" />
            <strong>{normalizedFileName}</strong>
            <span>{selectedFolder?.path ? `in ${selectedFolder.path}` : "in workspace root"}</span>
          </div>
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary"
            disabled={!canSave}
            onClick={() => onSave(targetPath)}
          >
            Save template
          </button>
        </footer>
      </section>
    </div>
  );
}

function collectVisualTemplateFolders(node, pathParts: string[] = [], depth = 0) {
  if (!node || node.deletedAt) return [];
  if (node.type !== "folder") return [];
  const folderPath = node.githubPath
    ? normalizeProjectPath(node.githubPath)
    : normalizeProjectPath([...pathParts, depth === 0 ? "" : node.name].filter(Boolean).join("/"));
  const current = [{
    id: node.id,
    node,
    name: node.name,
    path: folderPath,
    depth,
  }];
  const children = (node.children || [])
    .filter((child) => child.type === "folder" && !child.deletedAt)
    .flatMap((child) => collectVisualTemplateFolders(child, folderPath ? folderPath.split("/") : [], depth + 1));
  return current.concat(children);
}

function TemplatePreview({ variant, badge }) {
  return (
    <div className={`template-preview ${variant || "basic"}`} aria-hidden="true">
      {badge && <span className={`template-preview-badge ${String(badge).toLowerCase().replace(/\s+/g, "-")}`}>{badge}</span>}
      {variant === "blank" ? (
        <span className="template-preview-plus">+</span>
      ) : (
        <>
          <span className="preview-line wide" />
          <span className="preview-line medium" />
          <span className="preview-line small" />
          <span className="preview-line side" />
          <span className="preview-line footer" />
        </>
      )}
    </div>
  );
}

function VisualTemplateUploadDialog({ onUpload, onClose }) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  return (
    <div className="template-picker-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="template-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Upload Template"
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <header>
          <div>
            <span>Template Library</span>
            <strong>Upload Template</strong>
          </div>
          <button type="button" aria-label="Close upload template" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <p>
          Upload an existing template JSON file. It will open as a reusable template definition that can be saved and bound later.
        </p>
        <label className="template-upload-dropzone">
          <input
            type="file"
            accept=".json,application/json"
            onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
          />
          <strong>{selectedFile?.name || "Choose template JSON"}</strong>
          <span>{selectedFile ? "Ready to upload" : "Supported now: AuthFlow template JSON"}</span>
        </label>
        <div className="template-dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!selectedFile} onClick={() => selectedFile && onUpload(selectedFile)}>
            Upload Template
          </button>
        </div>
      </section>
    </div>
  );
}

function VisualTemplateImportDialog({ onImport, onClose }) {
  return (
    <div className="template-picker-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="template-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Import Template"
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <header>
          <div>
            <span>Template Library</span>
            <strong>Import Template</strong>
          </div>
          <button type="button" aria-label="Close import template" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <p>
          Import from design tools and convert frames or components into template containers and slots.
        </p>
        <div className="template-picker-list">
          <button type="button" onClick={() => onImport("canva")}>
            <span>Canva</span>
            <strong>Import from Canva</strong>
            <small>Prepare a Canva template connection and map visual areas to DITA-driven slots.</small>
            <em>provider</em>
          </button>
          <button type="button" onClick={() => onImport("figma")}>
            <span>Figma</span>
            <strong>Import from Figma</strong>
            <small>Prepare a Figma template connection and map frames/components to containers and slots.</small>
            <em>provider</em>
          </button>
        </div>
      </section>
    </div>
  );
}

function ProjectPropertiesPopup({ nodeId, projectTree, fileHistories, onClose }) {
  const match = findProjectNode(projectTree, nodeId);
  const node = match?.node;

  if (!node) return null;

  const path = getProjectFilePath(projectTree, node.id) || "Project root";
  const isFile = node.type === "file";
  const fileContent = isFile ? (fileHistories[node.id]?.present ?? node.content ?? "") : "";
  const fileCount = node.type === "folder" ? collectProjectFileIds(node).size : 0;
  const properties = isFile
    ? [
        ["Name", node.name],
        ["Type", node.ditaType || getProjectFileKind(node)],
        ["Kind", getProjectFileKind(node)],
        ["Path", path],
        ["Size", getReadableSize(fileContent.length)],
        ["Checked in", node.checkedInAt || "Not checked in"],
      ]
    : [
        ["Name", node.name],
        ["Type", "Folder"],
        ["Path", path],
        ["Files", `${fileCount}`],
      ];

  return (
    <div className="properties-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="properties-popup"
        role="dialog"
        aria-modal="true"
        aria-label={`Properties for ${node.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className={`project-node-icon ${isFile ? getProjectFileIconKind(node) : "folder"}`} aria-hidden="true">
              {isFile ? <FileTypeIcon kind={getProjectFileIconKind(node)} /> : <FolderFileIcon />}
            </span>
            <strong>{node.name}</strong>
          </div>
          <button type="button" aria-label="Close properties" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <dl>
          {properties.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function TabContextMenu({
  contextMenu,
  paneCount,
  hasRightPane,
  hasBottomPane,
  hasSecondaryPane,
  sourcePaneTabCount,
  fileName,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onSplitRight,
  onSplitDown,
  onSplitAndMoveRight,
  onSplitAndMoveDown,
  onMoveLeft,
  onMoveRight,
  onMoveBottom,
}) {
  return (
    <div
      className="tab-context-menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      aria-label={`Tab actions for ${fileName}`}
    >
      <button type="button" onClick={onCloseTab}>Close</button>
      <button type="button" onClick={onCloseOthers}>Close others</button>
      <button type="button" onClick={onCloseAll}>Close all</button>
      <hr />
      {!hasSecondaryPane ? (
        <>
          <button type="button" onClick={onSplitRight}>Split Right</button>
          <button type="button" onClick={onSplitDown}>Split Down</button>
          <div className="context-submenu">
            <button
              type="button"
              disabled={sourcePaneTabCount <= 1}
              title={sourcePaneTabCount <= 1 ? "Open another tab before moving this tab into a new pane." : undefined}
              aria-haspopup="menu"
            >
              Split &amp; Move
              <span aria-hidden="true">›</span>
            </button>
            {sourcePaneTabCount > 1 && (
              <div className="context-submenu-panel" role="menu" aria-label="Split and move direction">
                <button type="button" onClick={onSplitAndMoveRight}>Right</button>
                <button type="button" onClick={onSplitAndMoveDown}>Down</button>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {contextMenu.paneId !== "pane-left" && (
            <button type="button" onClick={onMoveLeft}>
              Move to main pane
            </button>
          )}
          {hasRightPane && contextMenu.paneId !== "pane-right" && (
            <button type="button" onClick={onMoveRight}>
              Move to right pane
            </button>
          )}
          {hasBottomPane && contextMenu.paneId !== "pane-bottom" && (
            <button type="button" onClick={onMoveBottom}>
              Move to bottom pane
            </button>
          )}
        </>
      )}
      <hr />
      <button type="button" onClick={onClose}>Cancel</button>
    </div>
  );
}

function InspectorIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4 5.5h16" />
      <path d="M4 12h16" />
      <path d="M4 18.5h16" />
      <circle cx="8" cy="5.5" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="10" cy="18.5" r="1.6" />
    </svg>
  );
}

function ExplorerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v6A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5z" />
      <path d="M7 11h10" />
      <path d="M7 14h7" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M6 4h8l4 4v12H6z" />
      <path d="M14 4v5h5" />
      <path d="M9 12h6" />
      <path d="M9 15h4" />
    </svg>
  );
}

function GitBranchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="17" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <path d="M7 8.2v7.6" />
      <path d="M17 8.2v1.3A4.5 4.5 0 0 1 12.5 14H7" />
    </svg>
  );
}

function GitFetchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M7 5.5v4.2a3.8 3.8 0 0 0 3.8 3.8H12" />
      <path d="M17 5.5v12" />
      <path d="m13.4 14 3.6 3.6 3.6-3.6" />
      <path d="M6.5 19.5h11" />
    </svg>
  );
}

function GitClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

function GitPullIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 4.8v11.4" />
      <path d="m7.8 12 4.2 4.2 4.2-4.2" />
      <path d="M6.8 19.2h10.4" />
    </svg>
  );
}

function GitSyncIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M7.5 7.8h8.3l-2.3-2.3" />
      <path d="m15.8 7.8-2.3 2.3" />
      <path d="M16.5 16.2H8.2l2.3 2.3" />
      <path d="m8.2 16.2 2.3-2.3" />
    </svg>
  );
}

function GitPushIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 19.2V7.8" />
      <path d="M7.8 12 12 7.8l4.2 4.2" />
      <path d="M6.8 4.8h10.4" />
    </svg>
  );
}

function GitOriginIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4.8 9.5h14.4v8.3H4.8z" />
      <path d="M8 9.5V6.8h8v2.7" />
    </svg>
  );
}

function GitChangesIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <circle cx="12" cy="12" r="7.2" />
      <path d="M12 8.4v4.4" />
      <path d="M12 15.7h.01" />
    </svg>
  );
}

function GitDiscardIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M9 7.2H5.8V4" />
      <path d="M5.9 7.2A7.2 7.2 0 1 1 4.8 14" />
      <path d="M9.2 9.2 14.8 14.8" />
      <path d="m14.8 9.2-5.6 5.6" />
    </svg>
  );
}

function FilePlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" className="file-plus-glyph">
      <path className="file-plus-page" d="M6 3.8h8.2L19 8.6v11.6H6z" />
      <path className="file-plus-fold" d="M14.2 3.8v5H19" />
      <circle className="add-badge" cx="17.2" cy="17.2" r="5" />
      <path className="add-badge-mark" d="M17.2 14.6v5.2" />
      <path className="add-badge-mark" d="M14.6 17.2h5.2" />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" className="folder-plus-glyph">
      <path className="folder-plus-back" d="M3 6.8A2.3 2.3 0 0 1 5.3 4.5h4.5l2.2 2.1h6.7A2.3 2.3 0 0 1 21 8.9v1.2H3z" />
      <path className="folder-plus-front" d="M3 9.2h18l-1.1 8.1a2.5 2.5 0 0 1-2.5 2.2H6.6a2.5 2.5 0 0 1-2.5-2.2z" />
      <circle className="add-badge" cx="17.2" cy="17.2" r="5" />
      <path className="add-badge-mark" d="M17.2 14.6v5.2" />
      <path className="add-badge-mark" d="M14.6 17.2h5.2" />
    </svg>
  );
}

function FolderFileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" className="folder-glyph">
      <path className="folder-back" d="M3 6.8A2.3 2.3 0 0 1 5.3 4.5h4.5l2.2 2.1h6.7A2.3 2.3 0 0 1 21 8.9v1.2H3z" />
      <path className="folder-front" d="M3 9.2h18l-1.1 8.1a2.5 2.5 0 0 1-2.5 2.2H6.6a2.5 2.5 0 0 1-2.5-2.2z" />
      <path className="folder-line" d="M4.2 9.2h15.6" />
    </svg>
  );
}

function FileTypeIcon({ kind }) {
  if (kind === "topic") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M6 4h8l4 4v12H6z" />
        <path d="M14 4v5h5" />
        <path d="M9 13h6" />
        <path d="M9 16h4" />
      </svg>
    );
  }

  if (kind === "concept") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M6 4h8l4 4v12H6z" />
        <path d="M14 4v5h5" />
        <circle cx="12" cy="13" r="2.2" />
        <path d="M12 15.2v2.3" />
      </svg>
    );
  }

  if (kind === "task") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M6 4h8l4 4v12H6z" />
        <path d="M14 4v5h5" />
        <path d="m9 14 2 2 4-5" />
      </svg>
    );
  }

  if (kind === "reference") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M6 4h8l4 4v12H6z" />
        <path d="M14 4v5h5" />
        <path d="M9 12h6" />
        <path d="M9 15h6" />
        <path d="M9 18h3" />
      </svg>
    );
  }

  if (kind === "map") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M5 5h5v5H5z" />
        <path d="M14 5h5v5h-5z" />
        <path d="M9.5 15h5v5h-5z" />
        <path d="M10 7.5h4" />
        <path d="M16.5 10v2.5a2.5 2.5 0 0 1-2.5 2.5" />
        <path d="M7.5 10v2.5A2.5 2.5 0 0 0 10 15" />
      </svg>
    );
  }

  if (kind === "visual-template") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M7 8h10" />
        <path d="M7 11h4" />
        <rect x="7" y="13" width="4" height="3" rx=".6" />
        <rect x="13" y="13" width="4" height="3" rx=".6" />
      </svg>
    );
  }

  if (kind === "image") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="m6.5 17 4.2-4.2 2.5 2.5 2.1-2.1 2.7 3.8" />
      </svg>
    );
  }

  if (kind === "html") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="m9 8-4 4 4 4" />
        <path d="m15 8 4 4-4 4" />
        <path d="m13 6-2 12" />
      </svg>
    );
  }

  if (kind === "xml") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M6 4h8l4 4v12H6z" />
        <path d="M14 4v5h5" />
        <path d="m10 12-2 2 2 2" />
        <path d="m14 12 2 2-2 2" />
      </svg>
    );
  }

  if (kind === "text") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M6 4h8l4 4v12H6z" />
        <path d="M14 4v5h5" />
        <path d="M9 12h6" />
        <path d="M9 15h5" />
        <path d="M9 18h4" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M6 4h8l4 4v12H6z" />
      <path d="M14 4v5h5" />
      <path d="M9 13h6" />
    </svg>
  );
}

function SchemaIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" />
      <rect x="9" y="14" width="6" height="6" rx="1.5" />
      <path d="M10 7h4" />
      <path d="M17 10v2.5a1.5 1.5 0 0 1-1.5 1.5H12" />
      <path d="M7 10v2.5A1.5 1.5 0 0 0 8.5 14H12" />
    </svg>
  );
}

function AuthoringRibbon({
  active,
  activeTags,
  allowedTags,
  tableContext,
  onInsert,
  onTableCommand,
}: {
  active: boolean;
  activeTags: Set<string>;
  allowedTags: Set<string>;
  tableContext: TableContext | null;
  onInsert: (tagName: string) => void;
  onTableCommand: (command: TableCommand) => void;
}) {
  const visibleGroups = authoringRibbonGroups
    .map((group) => ({
      ...group,
      commands: group.commands,
    }))
    .filter((group) => group.commands.length > 0);

  if (!active) {
    return null;
  }

  return (
    <section className="authoring-ribbon" aria-label="Authoring toolbar">
      <div className="authoring-ribbon-scroll">
        {visibleGroups.length ? (
          visibleGroups.map((group) => (
            <article className="ribbon-card" key={group.id} aria-label={group.label}>
              <div className="ribbon-card-actions">
                {group.commands.map((command) => {
                  const activeCommand = activeTags.has(command.tag);
                  const enabled = activeCommand || allowedTags.has(command.tag);
                  const commandLabel = activeCommand ? `Remove <${command.tag}>` : `Insert <${command.tag}>`;

                  return (
                    <button
                      aria-pressed={activeCommand}
                      className={`${command.emphasis ? "emphasis" : ""}${activeCommand ? " active" : ""}`.trim()}
                      disabled={!enabled}
                      key={`${group.id}-${command.tag}`}
                      type="button"
                      title={enabled ? commandLabel : `<${command.tag}> is not valid here`}
                      onClick={() => {
                        if (enabled) {
                          onInsert(command.tag);
                        }
                      }}
                    >
                      <RibbonCommandIcon icon={command.icon} label={command.label} />
                      <span>{command.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="ribbon-card-label">{group.label}</div>
            </article>
          ))
        ) : null}
        {tableContext ? (
          <article className="ribbon-card table-ribbon-card" aria-label={`${tableContext.label} table tools`}>
            <div className="ribbon-card-actions">
              <button
                type="button"
                title="Insert row above"
                onClick={() => onTableCommand("insert-row-before")}
              >
                <RibbonCommandIcon icon="row-before" label="Row before" />
                <span>Row Before</span>
              </button>
              <button
                type="button"
                title="Insert row below"
                onClick={() => onTableCommand("insert-row-after")}
              >
                <RibbonCommandIcon icon="row-after" label="Row after" />
                <span>Row After</span>
              </button>
              <button
                disabled={!tableContext.canEditColumns}
                type="button"
                title={tableContext.canEditColumns ? "Insert column before" : "This table type has fixed columns"}
                onClick={() => onTableCommand("insert-column-before")}
              >
                <RibbonCommandIcon icon="column-before" label="Column before" />
                <span>Col Before</span>
              </button>
              <button
                disabled={!tableContext.canEditColumns}
                type="button"
                title={tableContext.canEditColumns ? "Insert column after" : "This table type has fixed columns"}
                onClick={() => onTableCommand("insert-column-after")}
              >
                <RibbonCommandIcon icon="column-after" label="Column after" />
                <span>Col After</span>
              </button>
              <button
                type="button"
                title="Delete row"
                onClick={() => onTableCommand("delete-row")}
              >
                <RibbonCommandIcon icon="delete-row" label="Delete row" />
                <span>Delete Row</span>
              </button>
              <button
                disabled={!tableContext.canEditColumns}
                type="button"
                title={tableContext.canEditColumns ? "Delete column" : "This table type has fixed columns"}
                onClick={() => onTableCommand("delete-column")}
              >
                <RibbonCommandIcon icon="delete-column" label="Delete column" />
                <span>Delete Col</span>
              </button>
            </div>
            <div className="ribbon-card-label">Table Layout</div>
          </article>
        ) : null}
        <button className="ribbon-customize" type="button" title="Customize toolbar">
          <RibbonCommandIcon icon="customize" label="" />
          <span>Customize toolbar</span>
        </button>
      </div>
    </section>
  );
}

function RibbonCommandIcon({ icon, label }: { icon?: string; label: string }) {
  if (icon === "bold" || icon === "italic" || icon === "underline" || icon === "sup" || icon === "sub") {
    return <span className={`ribbon-text-icon ${icon}`} aria-hidden="true">{label}</span>;
  }

  if (icon === "bullet-list" || icon === "number-list") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        {icon === "bullet-list" ? (
          <>
            <path d="M8 7h11" />
            <path d="M8 12h11" />
            <path d="M8 17h11" />
            <path d="M4 7h.01" />
            <path d="M4 12h.01" />
            <path d="M4 17h.01" />
          </>
        ) : (
          <>
            <path d="M10 7h9" />
            <path d="M10 12h9" />
            <path d="M10 17h9" />
            <path d="M4 6h1v3" />
            <path d="M4 11h2l-2 3h2" />
            <path d="M4 17h2" />
          </>
        )}
      </svg>
    );
  }

  if (icon === "link") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
        <path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" />
      </svg>
    );
  }

  if (icon === "image") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="m7 16 4-4 3 3 2-2 3 3" />
        <circle cx="9" cy="9" r="1.4" />
      </svg>
    );
  }

  if (icon === "table") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M4 10h16" />
        <path d="M9 5v14" />
        <path d="M15 5v14" />
      </svg>
    );
  }

  if (
    icon === "row-before" ||
    icon === "row-after" ||
    icon === "column-before" ||
    icon === "column-after" ||
    icon === "delete-row" ||
    icon === "delete-column"
  ) {
    const isRow = icon.includes("row");
    const isDelete = icon.startsWith("delete");
    const isBefore = icon.endsWith("before");
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <rect x="5" y="5" width="14" height="14" rx="2" />
        <path d="M5 11h14" />
        <path d="M5 16h14" />
        <path d="M11 5v14" />
        <path d="M16 5v14" />
        {isDelete ? (
          isRow ? (
            <>
              <path d="M7 13.5h10" />
              <path d="m10 10.5 4 6" />
              <path d="m14 10.5-4 6" />
            </>
          ) : (
            <>
              <path d="M13.5 7v10" />
              <path d="m10.5 10 6 4" />
              <path d="m10.5 14 6-4" />
            </>
          )
        ) : isRow ? (
          <>
            <path d={isBefore ? "M7 3h10" : "M7 21h10"} />
            <path d={isBefore ? "m12 2 0 4" : "m12 18 0 4"} />
          </>
        ) : (
          <>
            <path d={isBefore ? "M3 7v10" : "M21 7v10"} />
            <path d={isBefore ? "m2 12 4 0" : "m18 12 4 0"} />
          </>
        )}
      </svg>
    );
  }

  if (icon === "screen") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <rect x="5" y="5" width="14" height="10" rx="2" />
        <path d="M9 19h6" />
        <path d="M12 15v4" />
      </svg>
    );
  }

  if (icon === "code") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="m9 8-4 4 4 4" />
        <path d="m15 8 4 4-4 4" />
      </svg>
    );
  }

  if (icon === "customize") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M5 5h5v5H5z" />
        <path d="M14 5h5v5h-5z" />
        <path d="M5 14h5v5H5z" />
        <path d="M16.5 14v5" />
        <path d="M14 16.5h5" />
      </svg>
    );
  }

  return null;
}

function AppMenuItemIcon({ icon }: { icon?: AppMenuItem["icon"] }) {
  if (icon === "import") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M6 4h8l4 4v12H6z" />
        <path d="M14 4v5h5" />
        <path d="M12 17V10" />
        <path d="m9 13 3-3 3 3" />
      </svg>
    );
  }

  if (icon === "undo" || icon === "redo") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        {icon === "undo" ? (
          <>
            <path d="M9 7 5 11l4 4" />
            <path d="M5 11h9a5 5 0 0 1 0 10h-2" />
          </>
        ) : (
          <>
            <path d="m15 7 4 4-4 4" />
            <path d="M19 11h-9a5 5 0 0 0 0 10h2" />
          </>
        )}
      </svg>
    );
  }

  if (icon === "preferences") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" />
        <path d="M19.3 13.6a7.8 7.8 0 0 0 0-3.2l2-1.5-2-3.4-2.4 1a8.7 8.7 0 0 0-2.7-1.6L13.9 2h-3.8l-.3 2.9a8.7 8.7 0 0 0-2.7 1.6l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 3.2l-2 1.5 2 3.4 2.4-1a8.7 8.7 0 0 0 2.7 1.6l.3 2.9h3.8l.3-2.9a8.7 8.7 0 0 0 2.7-1.6l2.4 1 2-3.4z" />
      </svg>
    );
  }

  if (icon === "terminal") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M4 5h16v14H4z" />
        <path d="m7 9 3 3-3 3" />
        <path d="M12 15h5" />
      </svg>
    );
  }

  if (icon === "schema") {
    return <SchemaIcon />;
  }

  return <span className="app-menu-icon-placeholder" aria-hidden="true" />;
}

function EditorModeIcon({ mode }: { mode: "layout" | "source" | "validate" | "visual" }) {
  if (mode === "visual") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M4 6.5h16" />
        <path d="M4 12h10" />
        <path d="M4 17.5h14" />
        <path d="M17 10.2 20 12l-3 1.8z" />
      </svg>
    );
  }

  if (mode === "layout") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 5v14" />
        <path d="M4 10h16" />
        <path d="M11 14h6" />
      </svg>
    );
  }

  if (mode === "source") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="m9 8-4 4 4 4" />
        <path d="m15 8 4 4-4 4" />
        <path d="m13 6-2 12" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="m5 12 4 4 10-10" />
      <path d="M20 12a8 8 0 1 1-3.2-6.4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M16 10.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
      <path d="m15 15 4 4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M5 12.5 9.2 16.7 19 7" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v5A3.5 3.5 0 0 1 15.5 15H11l-5 4v-4.5A3.5 3.5 0 0 1 5 11.5z" />
      <path d="M8 8h8" />
      <path d="M8 11h5" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 2.8a9.2 9.2 0 0 0-2.9 17.9c.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.2-3.5-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.4-2.3-.3-4.7-1.2-4.7-5.1 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.4.1-2.8 0 0 .9-.3 2.9 1.1a10 10 0 0 1 5.2 0c2-1.4 2.9-1.1 2.9-1.1.6 1.4.2 2.5.1 2.8.7.8 1.1 1.7 1.1 2.8 0 4-2.4 4.9-4.7 5.1.4.3.8 1 .8 2v3c0 .3.2.6.8.5A9.2 9.2 0 0 0 12 2.8z" />
    </svg>
  );
}

function NotificationIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M18 9.5a6 6 0 0 0-12 0c0 6-2.2 6.8-2.2 6.8h16.4S18 15.5 18 9.5z" />
      <path d="M9.5 19a2.7 2.7 0 0 0 5 0" />
      <path d="M12 3V2" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v15H7.5A2.5 2.5 0 0 0 5 20.5z" />
      <path d="M5 20.5A2.5 2.5 0 0 1 7.5 18H20" />
      <path d="M8 7h8" />
      <path d="M8 10h6" />
    </svg>
  );
}

function TemplateSourcesIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H11l2 2h3.5A2.5 2.5 0 0 1 19 7.5v9A2.5 2.5 0 0 1 16.5 19h-9A2.5 2.5 0 0 1 5 16.5z" />
      <path d="M8 10h8" />
      <path d="M8 13h6" />
      <path d="M8 16h4" />
    </svg>
  );
}

function TemplateBindingsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M7 7.5h4.5v4.5H7z" />
      <path d="M12.5 12h4.5v4.5h-4.5z" />
      <path d="M11.5 9.8h2.8" />
      <path d="M9.2 12v2.2h3.3" />
      <path d="M5 4.5h14v15H5z" />
    </svg>
  );
}

function TemplateLayersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 4 4.5 8 12 12l7.5-4z" />
      <path d="M6.5 11.5 12 14.5l5.5-3" />
      <path d="M6.5 15 12 18l5.5-3" />
    </svg>
  );
}

function TemplateLayoutIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8" />
      <path d="M8 12h4" />
      <path d="M13 12h3" />
      <path d="M8 15h8" />
    </svg>
  );
}

function TemplateStyleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4.5 18.5h15" />
      <path d="M7 15.5 14.5 8l1.5 1.5L8.5 17H7z" />
      <path d="M13.5 6.5 15 5l4 4-1.5 1.5" />
      <path d="M5.5 5.5h5" />
      <path d="M5.5 8.5h3" />
    </svg>
  );
}

function UndoArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M9 7 5 11l4 4" />
      <path d="M5 11h9a5 5 0 0 1 0 10h-2" />
    </svg>
  );
}

function RedoArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="m15 7 4 4-4 4" />
      <path d="M19 11h-9a5 5 0 0 0 0 10h2" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M3.5 12s3.2-5.5 8.5-5.5 8.5 5.5 8.5 5.5-3.2 5.5-8.5 5.5S3.5 12 3.5 12z" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M3.5 12s3.2-5.5 8.5-5.5c1.5 0 2.8.4 3.9 1" />
      <path d="M20.5 12s-3.2 5.5-8.5 5.5c-1.4 0-2.7-.4-3.8-1" />
      <path d="M4 4l16 16" />
      <path d="M10.6 10.6a2.2 2.2 0 0 0 2.8 2.8" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <rect x="6.5" y="10" width="11" height="9" rx="2" />
      <path d="M8.5 10V7.8a3.5 3.5 0 0 1 7 0V10" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <rect x="6.5" y="10" width="11" height="9" rx="2" />
      <path d="M8.5 10V7.8a3.5 3.5 0 0 1 6.6-1.6" />
      <path d="M16.2 4.7 18 3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M6.5 7 7.4 19a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.5 7" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M5 4h12l2 2v14H5z" />
      <path d="M8 4v6h8V4" />
      <path d="M8 20v-6h8v6" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M5 5.5A3.5 3.5 0 0 1 8.5 2h7A3.5 3.5 0 0 1 19 5.5v5A3.5 3.5 0 0 1 15.5 14H11l-5 4v-4.5A3.5 3.5 0 0 1 5 10.5z" />
      <path d="M12 6v5" />
      <path d="M9.5 8.5h5" />
    </svg>
  );
}

function AiReviewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 3.5 13.9 8l4.6.4-3.5 3 1 4.5-4-2.4-4 2.4 1-4.5-3.5-3 4.6-.4z" />
      <path d="M4 20h16" />
    </svg>
  );
}

function MicrophoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
      <path d="M18 11a6 6 0 0 1-12 0" />
      <path d="M12 17v4" />
      <path d="M9 21h6" />
    </svg>
  );
}

function ClearChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M6 7h12" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M8 7l.7 12h6.6L16 7" />
      <path d="M10.5 10.5v5" />
      <path d="M13.5 10.5v5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4 12 20 4l-5 16-3-7z" />
      <path d="m12 13 8-9" />
    </svg>
  );
}

function InspectorPanel({
  doc,
  selectedNode,
  selectedPath,
  childOptions,
  siblingOptions,
  hrefValidation,
  onClose,
  onInsert,
  onRemove,
  onUpdateAttribute,
  onAttributeBlur,
}) {
  const [expandedSection, setExpandedSection] = useState("insert-into");
  const [attributeFilter, setAttributeFilter] = useState("");
  const [insertIntoFilter, setInsertIntoFilter] = useState("");
  const [insertAfterFilter, setInsertAfterFilter] = useState("");
  const [insertIntoKind, setInsertIntoKind] = useState("all");
  const [insertAfterKind, setInsertAfterKind] = useState("all");
  const attributeDefinitions = getAttributeDefinitions(selectedNode.tagName);
  const validationByName = hrefValidation ? { href: hrefValidation } : {};
  const toggleSection = (sectionId: string) => {
    setExpandedSection((current) => current === sectionId ? "" : sectionId);
  };

  return (
    <>
      <div className="inspector-topbar">
        <span>Inspector</span>
        <div className="inspector-topbar-actions">
          <strong>&lt;{selectedNode.tagName}&gt;</strong>
          <button type="button" className="inspector-close-button" title="Close panel" aria-label="Close Inspector panel" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="inspector-accordion" aria-label={`Inspector for ${selectedNode.tagName}`}>
        <InspectorAccordionSection
          id="attributes"
          title="Attributes"
          subtitle={`Allowed on <${selectedNode.tagName}>`}
          count={attributeDefinitions.length}
          expanded={expandedSection === "attributes"}
          onToggle={() => toggleSection("attributes")}
        >
          <InspectorAttributeTable
            doc={doc}
            node={selectedNode}
            selectedPath={selectedPath}
            attributeDefinitions={attributeDefinitions}
            filter={attributeFilter}
            validationByName={validationByName}
            onFilterChange={setAttributeFilter}
            onChange={onUpdateAttribute}
            onBlur={onAttributeBlur}
          />
        </InspectorAccordionSection>

        <InspectorAccordionSection
          id="insert-into"
          title="Insert Into"
          subtitle={`Children allowed inside <${selectedNode.tagName}>`}
          count={childOptions.length}
          expanded={expandedSection === "insert-into"}
          onToggle={() => toggleSection("insert-into")}
        >
          <InspectorElementList
            filter={insertIntoFilter}
            kind={insertIntoKind}
            options={childOptions}
            onFilterChange={setInsertIntoFilter}
            onKindChange={setInsertIntoKind}
            onInsert={(tagName) => onInsert(tagName, "child")}
            emptyText="No child elements are allowed here."
          />
        </InspectorAccordionSection>

        <InspectorAccordionSection
          id="insert-after"
          title="Insert After"
          subtitle={`Siblings allowed after <${selectedNode.tagName}>`}
          count={siblingOptions.length}
          expanded={expandedSection === "insert-after"}
          onToggle={() => toggleSection("insert-after")}
        >
          <InspectorElementList
            filter={insertAfterFilter}
            kind={insertAfterKind}
            options={siblingOptions}
            onFilterChange={setInsertAfterFilter}
            onKindChange={setInsertAfterKind}
            onInsert={(tagName) => onInsert(tagName, "after")}
            emptyText="No following sibling elements are allowed here."
          />
        </InspectorAccordionSection>
      </div>

      <div className="inspector-remove-bar">
        <button className="inspector-remove-button" disabled={selectedPath.length === 0} onClick={onRemove}>
          Remove selected
        </button>
      </div>
    </>
  );
}

function InspectorAccordionSection({ id, title, subtitle, count, expanded, onToggle, children }) {
  return (
    <section className={`inspector-accordion-section${expanded ? " expanded" : ""}`} aria-labelledby={`${id}-heading`}>
      <button
        type="button"
        className="inspector-section-toggle"
        id={`${id}-heading`}
        aria-expanded={expanded}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggle}
      >
        <span className="inspector-section-chevron" aria-hidden="true">›</span>
        <span className="inspector-section-copy">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </span>
        <span className="inspector-section-count">{count}</span>
      </button>
      {expanded && (
        <div className="inspector-expanded-body">
          {children}
        </div>
      )}
    </section>
  );
}

function InspectorElementList({ options, filter, kind, onFilterChange, onKindChange, onInsert, emptyText }) {
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredOptions = options.filter((tagName) => {
    const definition = getElementDefinition(tagName);
    const isInline = Boolean(definition?.inline);
    if (kind === "inline" && !isInline) return false;
    if (kind === "block" && isInline) return false;
    return !normalizedFilter || tagName.toLowerCase().includes(normalizedFilter);
  });

  return (
    <div className="inspector-expanded-content">
      <div className="inspector-filter-row">
        <label className="inspector-filter-field">
          <SearchIcon />
          <input
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Filter elements..."
          />
        </label>
        <button
          type="button"
          className={kind === "block" ? "active" : ""}
          onClick={() => onKindChange(kind === "block" ? "all" : "block")}
        >
          BLK
        </button>
        <button
          type="button"
          className={kind === "inline" ? "active" : ""}
          onClick={() => onKindChange(kind === "inline" ? "all" : "inline")}
        >
          INL
        </button>
      </div>

      {filteredOptions.length ? (
        <div className="inspector-element-list">
          {filteredOptions.map((tagName) => {
            const isInline = Boolean(getElementDefinition(tagName)?.inline);
            return (
              <button
                key={tagName}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onInsert(tagName)}
              >
                <span>{tagName}</span>
                <small className={isInline ? "inline" : ""}>{isInline ? "Inline" : "Block"}</small>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="section-empty">{emptyText}</p>
      )}
    </div>
  );
}

function InspectorAttributeTable({
  doc,
  node,
  selectedPath,
  attributeDefinitions,
  filter,
  validationByName = {},
  onFilterChange,
  onChange,
  onBlur,
}) {
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredAttributes = attributeDefinitions.filter((attribute) => {
    const label = attribute.label || attribute.name;
    return !normalizedFilter || label.toLowerCase().includes(normalizedFilter) || attribute.name.toLowerCase().includes(normalizedFilter);
  });

  return (
    <div className="inspector-expanded-content">
      <div className="inspector-attribute-filter">
        <label className="inspector-filter-field">
          <SearchIcon />
          <input
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Filter attributes..."
          />
        </label>
      </div>

      {filteredAttributes.length ? (
        <div className="inspector-attribute-table" role="table" aria-label={`Attributes for ${node.tagName}`}>
          {filteredAttributes.map((attribute) => {
            const value = node.getAttribute(attribute.name) || "";
            const optionValues = getContextualAttributeValues(doc, selectedPath, attribute.name) || attribute.values || [];
            return (
              <label className="inspector-attribute-row" key={attribute.name} role="row">
                <span className="inspector-attribute-name" role="cell">{attribute.label || attribute.name}</span>
                <span className="inspector-attribute-value" role="cell">
                  {optionValues.length ? (
                    <select
                      value={value}
                      onChange={(event) => onChange(attribute.name, event.target.value)}
                    >
                      <option value="">-</option>
                      {optionValues.map((optionValue) => (
                        <option key={optionValue} value={optionValue}>
                          {optionValue}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="input-shell">
                      <input
                        className={validationByName[attribute.name] ? `has-validation ${validationByName[attribute.name].status}` : ""}
                        value={value}
                        onChange={(event) => onChange(attribute.name, event.target.value)}
                        onBlur={(event) => onBlur?.(attribute.name, event.target.value)}
                        placeholder={attribute.placeholder || "-"}
                        aria-invalid={validationByName[attribute.name]?.status === "invalid" ? "true" : undefined}
                        aria-describedby={validationByName[attribute.name] ? `${attribute.name}-validation` : undefined}
                      />
                      {validationByName[attribute.name] && (
                        <span
                          className={`validation-marker ${validationByName[attribute.name].status}`}
                          id={`${attribute.name}-validation`}
                          role="status"
                          tabIndex={0}
                          aria-label={validationByName[attribute.name].message}
                        >
                          {validationByName[attribute.name].status === "valid" ? "✓" : "x"}
                          <span className="validation-tooltip">{validationByName[attribute.name].message}</span>
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="section-empty">No matching attributes.</p>
      )}
    </div>
  );
}

function AttributeEditor({ node, attributeDefinitions, validationByName = {}, onChange, onBlur }) {
  if (!attributeDefinitions.length) {
    return <p className="attribute-empty">No editable attributes for this element.</p>;
  }

  return (
    <div className="attribute-list">
      {attributeDefinitions.map((attribute) => (
        <label className="field" key={attribute.name}>
          <span className="attribute-label">{attribute.label || attribute.name}</span>
          {attribute.values ? (
            <select
              value={node.getAttribute(attribute.name) || ""}
              onChange={(event) => onChange(attribute.name, event.target.value)}
            >
              <option value="">Unset</option>
              {attribute.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : (
            <span className="input-shell">
              <input
                className={validationByName[attribute.name] ? `has-validation ${validationByName[attribute.name].status}` : ""}
                value={node.getAttribute(attribute.name) || ""}
                onChange={(event) => onChange(attribute.name, event.target.value)}
                onBlur={(event) => onBlur?.(attribute.name, event.target.value)}
                placeholder={attribute.placeholder || attribute.name}
                aria-invalid={validationByName[attribute.name]?.status === "invalid" ? "true" : undefined}
                aria-describedby={validationByName[attribute.name] ? `${attribute.name}-validation` : undefined}
              />
              {validationByName[attribute.name] && (
                <span
                  className={`validation-marker ${validationByName[attribute.name].status}`}
                  id={`${attribute.name}-validation`}
                  role="status"
                  tabIndex={0}
                  aria-label={validationByName[attribute.name].message}
                >
                  {validationByName[attribute.name].status === "valid" ? "✓" : "x"}
                  <span className="validation-tooltip">{validationByName[attribute.name].message}</span>
                </span>
              )}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

function PlainTextEditor({ value, kind, fileName, onChange, onBlur, readOnly = false }) {
  const isReport = fileName.startsWith("Validation -");

  return (
    <div className={`plain-editor-shell${isReport ? " validation-report-shell" : ""}`}>
      <textarea
        className={`plain-text-editor${isReport ? " validation-report-editor" : ""}`}
        aria-label={`${isReport ? "Validation report" : kind === "html" ? "HTML" : "Text"} editor for ${fileName}`}
        value={value}
        readOnly={readOnly}
        spellCheck="false"
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}

function parseGitHistoryPayload(value: string): FileGitHistoryPayload | null {
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && Array.isArray(parsed.commits)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function parseGitConflictPayload(value: string): GitConflictPayload | null {
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && parsed.filePath) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function GitHistoryViewer({ payload, onOpenCommitContextMenu }) {
  if (!payload) {
    return <div className="git-history-tab"><p className="empty-state">Git history could not be loaded.</p></div>;
  }

  return (
    <div className="git-history-tab">
      <header className="git-history-tab-header">
        <div>
          <span>Git History</span>
          <strong>{payload.fileName}</strong>
        </div>
        <small>{getGitBranchDisplayName(payload.branch)} · {payload.filePath}</small>
      </header>
      {payload.commits.length ? (
        <div className="git-history-table-wrap">
          <table className="git-history-table">
            <thead>
              <tr>
                <th>Message</th>
                <th>User</th>
                <th>Date</th>
                <th>SHA</th>
              </tr>
            </thead>
            <tbody>
              {payload.commits.map((commit) => (
                <tr
                  key={commit.sha}
                  onContextMenu={(event) => onOpenCommitContextMenu(event, payload, commit)}
                  title="Right-click for commit actions"
                >
                  <td>{commit.headline}</td>
                  <td>{commit.authorLogin || commit.authorName}</td>
                  <td>{formatGitCommitDate(commit.committedAt || commit.authoredAt)}</td>
                  <td><code>{commit.shortSha}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">No commits found for this file on the selected branch.</p>
      )}
    </div>
  );
}

function GitConflictResolver({ payload, onSaveResolution, readOnly = false }) {
  const [resolvedContent, setResolvedContent] = useState(payload?.localContent || "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [lineChanges, setLineChanges] = useState<any[]>([]);
  const [activeChangeIndex, setActiveChangeIndex] = useState(0);
  const [changeChoices, setChangeChoices] = useState<Record<number, "mine" | "theirs">>({});
  const [inlineChoicePositions, setInlineChoicePositions] = useState<Array<{ index: number; side: "mine" | "theirs"; top: number; left: number }>>([]);
  const [sideHeaderPositions, setSideHeaderPositions] = useState<{ theirs: number; mine: number } | null>(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const conflictEditorRef = useRef<HTMLDivElement | null>(null);
  const changeChoicesRef = useRef<Record<number, "mine" | "theirs">>({});

  useEffect(() => {
    setResolvedContent(payload?.localContent || "");
    setSaveState("idle");
    setLineChanges([]);
    setActiveChangeIndex(0);
    setChangeChoices({});
    setInlineChoicePositions([]);
    setSideHeaderPositions(null);
    changeChoicesRef.current = {};
    const modifiedModel = editorRef.current?.getModifiedEditor?.().getModel?.();
    if (modifiedModel) {
      monacoRef.current?.editor?.setModelMarkers?.(modifiedModel, "dita-resolution-validation", []);
    }
  }, [payload?.filePath, payload?.localContent]);

  useEffect(() => {
    if (!lineChanges.length) {
      setActiveChangeIndex(0);
      return;
    }
    setActiveChangeIndex((current) => Math.min(current, lineChanges.length - 1));
  }, [lineChanges.length]);

  if (!payload) {
    return <div className="git-conflict-tab"><p className="empty-state">Conflict details could not be loaded.</p></div>;
  }

  const setModifiedContent = (nextContent: string) => {
    setResolvedContent(nextContent);
    editorRef.current?.getModifiedEditor?.().setValue(nextContent);
    setSaveState("idle");
    changeChoicesRef.current = {};
    setChangeChoices({});
  };
  const setValidationMarkers = (issues = []) => {
    const monaco = monacoRef.current;
    const modifiedEditor = editorRef.current?.getModifiedEditor?.();
    const model = modifiedEditor?.getModel?.();
    if (!monaco || !model) return;

    const lineCount = model.getLineCount();
    const getIssueRange = (issue) => {
      const reportedLine = Math.max(1, Math.min(lineCount, Number(issue.line) || 1));
      const candidateLines = [reportedLine, reportedLine + 1, reportedLine + 2, reportedLine - 1]
        .filter((lineNumber) => lineNumber >= 1 && lineNumber <= lineCount);

      for (const lineNumber of candidateLines) {
        const text = model.getLineContent(lineNumber);
        const tagMatch = text.match(/<\s*\/?\s*[\w:-]+/);
        if (tagMatch?.index !== undefined) {
          const startColumn = tagMatch.index + 1;
          const endColumn = Math.min(
            model.getLineMaxColumn(lineNumber),
            startColumn + tagMatch[0].length,
          );
          return { lineNumber, startColumn, endColumn: Math.max(startColumn + 1, endColumn) };
        }
      }

      const lineLength = model.getLineMaxColumn(reportedLine);
      const startColumn = Math.max(1, Math.min(lineLength, Number(issue.column) || 1));
      return {
        lineNumber: reportedLine,
        startColumn,
        endColumn: Math.max(startColumn + 1, lineLength),
      };
    };
    const markers = issues
      .filter((issue) => issue?.level !== "warning" || issue.line)
      .map((issue) => {
        const range = getIssueRange(issue);
        return {
          severity: issue.level === "warning"
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Error,
          message: issue.message || issue.raw || "DITA validation issue.",
          startLineNumber: range.lineNumber,
          startColumn: range.startColumn,
          endLineNumber: range.lineNumber,
          endColumn: range.endColumn,
        };
      });

    monaco.editor.setModelMarkers(model, "dita-resolution-validation", markers);
  };
  const splitLines = (value: string) => (value ? value.split(/\r?\n/) : []);
  const getRangeText = (value: string, startLine: number, endLine: number) => {
    if (!startLine || !endLine || endLine < startLine) return "";
    return splitLines(value).slice(startLine - 1, endLine).join("\n");
  };
  const buildResolvedContentFromChoices = () => {
    const currentContent = editorRef.current?.getModifiedEditor?.().getValue?.() ?? resolvedContent;
    let nextLines = splitLines(currentContent);
    const selectedTheirsChanges = lineChanges
      .map((change, index) => ({ change, index }))
      .filter(({ index }) => changeChoicesRef.current[index] === "theirs")
      .sort((a, b) => {
        const aLine = a.change.modifiedStartLineNumber || a.change.modifiedEndLineNumber || 1;
        const bLine = b.change.modifiedStartLineNumber || b.change.modifiedEndLineNumber || 1;
        return bLine - aLine;
      });

    selectedTheirsChanges.forEach(({ change }) => {
      const startLine = Math.max(1, change.modifiedStartLineNumber || 1);
      const startIndex = startLine - 1;
      const endIndexExclusive = change.modifiedEndLineNumber && change.modifiedEndLineNumber >= startLine
        ? change.modifiedEndLineNumber
        : startIndex;
      const replacementLines = splitLines(getRangeText(
        payload.remoteContent,
        change.originalStartLineNumber,
        change.originalEndLineNumber,
      ));
      nextLines = [
        ...nextLines.slice(0, startIndex),
        ...replacementLines,
        ...nextLines.slice(endIndexExclusive),
      ];
    });

    return nextLines.join("\n");
  };
  const markChangeChoice = (index: number, choice: "mine" | "theirs") => {
    changeChoicesRef.current = {
      ...changeChoicesRef.current,
      [index]: choice,
    };
    setChangeChoices((current) => ({
      ...current,
      [index]: choice,
    }));
  };
  const chooseAllChanges = (choice: "mine" | "theirs") => {
    const nextChoices = Object.fromEntries(lineChanges.map((_, index) => [index, choice])) as Record<number, "mine" | "theirs">;
    changeChoicesRef.current = nextChoices;
    setChangeChoices(nextChoices);
    setActiveChangeIndex(0);
    setSaveState("idle");
    setValidationMarkers([]);
    revealChange(0);
  };
  const revealChange = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, Math.max(0, lineChanges.length - 1)));
    const change = lineChanges[nextIndex];
    setActiveChangeIndex(nextIndex);
    if (!change) return;

    const modifiedEditor = editorRef.current?.getModifiedEditor?.();
    const lineNumber = Math.max(1, change.modifiedStartLineNumber || change.modifiedEndLineNumber || 1);
    modifiedEditor?.revealLineInCenter?.(lineNumber);
    modifiedEditor?.setPosition?.({ lineNumber, column: 1 });
    modifiedEditor?.focus?.();
  };
  const useTheirsForChange = (index: number) => {
    if (!lineChanges[index]) return;
    setActiveChangeIndex(index);
    markChangeChoice(index, "theirs");
    revealChange(Math.min(index + 1, Math.max(0, lineChanges.length - 1)));
  };
  const useMineForChange = (index: number) => {
    if (!lineChanges[index]) return;
    setActiveChangeIndex(index);
    markChangeChoice(index, "mine");
    revealChange(Math.min(index + 1, Math.max(0, lineChanges.length - 1)));
  };
  const chosenChangeCount = lineChanges.filter((_, index) => changeChoices[index]).length;
  const allChangesChosen = lineChanges.length > 0 && chosenChangeCount === lineChanges.length;

  return (
    <div className="git-conflict-tab">
      <header className="git-conflict-header">
        <div>
          <span>Merge Conflict</span>
          <strong>{payload.fileName}</strong>
        </div>
        <small>{payload.message}</small>
      </header>
      <div className="git-conflict-meta">
        <div>
          <span>Theirs: GitHub <code>{String(payload.currentSha || "").slice(0, 7) || "new"}</code></span>
          <span>Yours: Local draft <code>{String(payload.baseSha || "").slice(0, 7) || "none"}</code></span>
        </div>
        {!readOnly && (
          <div className="git-conflict-apply-bar">
            <span className={allChangesChosen ? "git-conflict-ready-note" : "git-conflict-sample-note"}>
              {lineChanges.length
                ? `${chosenChangeCount} of ${lineChanges.length} conflicts resolved`
                : payload.sample
                  ? "Sample conflict for testing the diff editor."
                  : "No conflicts to resolve"}
            </span>
            <button
              type="button"
              className="git-commit-button"
              disabled={saveState === "saving" || !allChangesChosen}
            onClick={async () => {
              setSaveState("saving");
              const nextContent = buildResolvedContentFromChoices();
              setValidationMarkers([]);
              const result = await onSaveResolution(payload, nextContent);
              if (result?.issues?.length) {
                setValidationMarkers(result.issues);
              }
              setSaveState(result?.applied === false ? "idle" : "saved");
            }}
          >
              <span aria-hidden="true">✓</span>
              <span>{saveState === "saving" ? "Applying..." : saveState === "saved" ? "Resolution applied" : "Apply Resolution"}</span>
            </button>
          </div>
        )}
        {!readOnly && (
          <div className="git-conflict-toolbar" aria-label="Conflict resolution actions">
            <button type="button" onClick={() => chooseAllChanges("theirs")}>
              Use Theirs File
            </button>
            <button type="button" onClick={() => chooseAllChanges("mine")}>
              Use Mine File
            </button>
            <button type="button" onClick={() => setModifiedContent(payload.localContent)}>
              Reset
            </button>
          </div>
        )}
      </div>
      {!readOnly && (
        <div className="git-conflict-changebar" aria-label="Current conflict change">
          <span>{lineChanges.length ? `Change ${activeChangeIndex + 1} of ${lineChanges.length}` : "No differences"}</span>
          <div>
            <button type="button" disabled={!lineChanges.length} onClick={() => revealChange(activeChangeIndex - 1)}>
              Previous
            </button>
            <button type="button" disabled={!lineChanges.length} onClick={() => revealChange(activeChangeIndex + 1)}>
              Next
            </button>
          </div>
        </div>
      )}
      {!readOnly && lineChanges.length > 0 && (
        <p className="git-conflict-inline-help">
          Use the checkbox beside a red block for Theirs, or beside a green block for Mine.
        </p>
      )}
      <div className="git-conflict-side-header" aria-hidden="true">
        <span style={sideHeaderPositions ? { left: sideHeaderPositions.theirs } : undefined}>Theirs</span>
        <span style={sideHeaderPositions ? { left: sideHeaderPositions.mine } : undefined}>Mine</span>
      </div>
      <div
        className="git-conflict-editor"
        ref={conflictEditorRef}
        onContextMenu={(event) => event.preventDefault()}
      >
        {!readOnly && inlineChoicePositions.map((position) => (
          <button
            type="button"
            className={`git-conflict-overlay-choice ${position.side}${changeChoices[position.index] === position.side ? " selected" : ""}`}
            style={{ top: position.top, left: position.left }}
            key={`${position.side}-${position.index}`}
            title={position.side === "theirs" ? "Use theirs for this change" : "Use mine for this change"}
            aria-label={position.side === "theirs" ? `Use theirs for change ${position.index + 1}` : `Use mine for change ${position.index + 1}`}
            onClick={() => {
              if (position.side === "theirs") {
                useTheirsForChange(position.index);
              } else {
                useMineForChange(position.index);
              }
            }}
          />
        ))}
        <DiffEditor
          height="100%"
          language={payload.fileName.endsWith(".json") ? "json" : payload.fileName.endsWith(".html") ? "html" : "xml"}
          original={payload.remoteContent}
          modified={resolvedContent}
          theme="vs"
          options={{
            readOnly,
            originalEditable: false,
            renderSideBySide: true,
            contextmenu: false,
            glyphMargin: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            fontSize: 13,
          }}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
            const originalEditor = editor.getOriginalEditor();
            const modifiedEditor = editor.getModifiedEditor();
            originalEditor.updateOptions({
              glyphMargin: true,
              lineDecorationsWidth: 28,
              lineNumbersMinChars: 3,
            });
            modifiedEditor.updateOptions({
              glyphMargin: true,
              lineDecorationsWidth: 28,
              lineNumbersMinChars: 3,
            });
            const originalDecorations = originalEditor.createDecorationsCollection();
            const modifiedDecorations = modifiedEditor.createDecorationsCollection();
            let latestChanges = [];
            modifiedEditor.onContextMenu((event) => {
              event.event.preventDefault();
              event.event.stopPropagation();
            });
            originalEditor.onContextMenu((event) => {
              event.event.preventDefault();
              event.event.stopPropagation();
            });
            const renderInlineChoiceOverlay = () => {
              const container = conflictEditorRef.current;
              const originalNode = originalEditor.getDomNode();
              const modifiedNode = modifiedEditor.getDomNode();
              if (!container || !originalNode || !modifiedNode) {
                setInlineChoicePositions([]);
                setSideHeaderPositions(null);
                return;
              }

              const containerRect = container.getBoundingClientRect();
              const originalRect = originalNode.getBoundingClientRect();
              const modifiedRect = modifiedNode.getBoundingClientRect();
              const lineHeight = Number(modifiedEditor.getOption(monaco.editor.EditorOption.lineHeight)) || 19;
              const lineNumberCenters = Array.from(container.querySelectorAll(".line-numbers"))
                .map((node) => node instanceof HTMLElement ? node.getBoundingClientRect() : null)
                .filter((rect): rect is DOMRect => Boolean(rect) && rect.width > 0 && rect.height > 0)
                .map((rect) => rect.left - containerRect.left + rect.width / 2)
                .sort((a, b) => a - b)
                .reduce<number[]>((uniqueCenters, center) => {
                  const last = uniqueCenters.at(-1);
                  if (last === undefined || Math.abs(center - last) > 6) {
                    uniqueCenters.push(center);
                  }
                  return uniqueCenters;
                }, []);
              const headerPair = lineNumberCenters
                .slice(0, -1)
                .map((center, index) => ({
                  theirs: center,
                  mine: lineNumberCenters[index + 1],
                  gap: lineNumberCenters[index + 1] - center,
                }))
                .filter((pair) => pair.gap >= 24 && pair.gap <= 160)
                .sort((a, b) => a.gap - b.gap)[0];

              const headerNudge = 8;
              setSideHeaderPositions((current) => {
                if (!headerPair) return current === null ? current : null;
                const nextPositions = {
                  theirs: headerPair.theirs + headerNudge,
                  mine: headerPair.mine + headerNudge,
                };
                if (
                  current
                  && Math.abs(current.theirs - nextPositions.theirs) < 0.5
                  && Math.abs(current.mine - nextPositions.mine) < 0.5
                ) {
                  return current;
                }
                return nextPositions;
              });

              if (readOnly) {
                setInlineChoicePositions([]);
                return;
              }

              const nextPositions = [];
              const getChangeRange = (change, side) => {
                const start = side === "theirs" ? change.originalStartLineNumber : change.modifiedStartLineNumber;
                const end = side === "theirs" ? change.originalEndLineNumber : change.modifiedEndLineNumber;
                const fallback = Math.max(1, start || end || 1);
                return {
                  startLine: fallback,
                  lineCount: Math.max(1, (end || fallback) - fallback + 1),
                };
              };
              const getRenderedRangeTop = (editor, editorRect, change, side) => {
                const { startLine, lineCount } = getChangeRange(change, side);
                const position = editor.getScrolledVisiblePosition({ lineNumber: startLine, column: 1 });
                if (!position) return null;
                const endLine = startLine + lineCount - 1;
                const scrollTop = editor.getScrollTop?.() ?? 0;
                const renderedTop = editor.getTopForLineNumber?.(startLine);
                const renderedBottom = editor.getBottomForLineNumber?.(endLine);
                if (typeof renderedTop === "number" && typeof renderedBottom === "number") {
                  return editorRect.top - containerRect.top + renderedTop - scrollTop + ((renderedBottom - renderedTop) - 16) / 2;
                }
                return editorRect.top - containerRect.top + position.top + ((lineCount * lineHeight) - 16) / 2;
              };
              const getDomBlockTop = (className, fallbackTop) => {
                if (fallbackTop == null) return null;

                const absoluteFallbackCenter = containerRect.top + fallbackTop + 8;
                const blocks = Array.from(container.querySelectorAll(`.${className}`))
                  .map((node) => node instanceof HTMLElement ? node.getBoundingClientRect() : null)
                  .filter((rect): rect is DOMRect => Boolean(rect) && rect.height >= lineHeight * 0.75 && rect.width > 80)
                  .sort((a, b) => a.top - b.top);
                const groups = blocks.reduce<Array<{ top: number; bottom: number }>>((current, rect) => {
                  const last = current.at(-1);
                  if (last && rect.top <= last.bottom + 2) {
                    last.bottom = Math.max(last.bottom, rect.bottom);
                    return current;
                  }

                  current.push({ top: rect.top, bottom: rect.bottom });
                  return current;
                }, []);
                const group = groups
                  .map((candidate) => ({
                    ...candidate,
                    distance: absoluteFallbackCenter >= candidate.top && absoluteFallbackCenter <= candidate.bottom
                      ? 0
                      : Math.min(Math.abs(candidate.top - absoluteFallbackCenter), Math.abs(candidate.bottom - absoluteFallbackCenter)),
                  }))
                  .sort((a, b) => a.distance - b.distance)[0];
                if (!group || group.distance > lineHeight * 4) return fallbackTop;

                return group.top - containerRect.top + ((group.bottom - group.top) - 16) / 2;
              };
              const getChoiceColumnLeft = () => {
                const closestPair = lineNumberCenters
                  .slice(0, -1)
                  .map((center, index) => ({
                    left: center,
                    right: lineNumberCenters[index + 1],
                    gap: lineNumberCenters[index + 1] - center,
                  }))
                  .filter((pair) => pair.gap >= 24 && pair.gap <= 140)
                  .sort((a, b) => a.gap - b.gap)[0];

                if (closestPair) {
                  return (closestPair.left + closestPair.right) / 2;
                }

                return modifiedRect.left - containerRect.left + Math.max(
                  4,
                  ((modifiedEditor.getScrolledVisiblePosition({ lineNumber: 1, column: 1 })?.left) ?? 44) - 30,
                );
              };

              latestChanges.forEach((change, index) => {
                const originalStart = getChangeRange(change, "theirs").startLine;
                const modifiedStart = getChangeRange(change, "mine").startLine;
                const originalPosition = originalEditor.getScrolledVisiblePosition({ lineNumber: originalStart, column: 1 });
                const modifiedPosition = modifiedEditor.getScrolledVisiblePosition({ lineNumber: modifiedStart, column: 1 });
                const originalTop = getDomBlockTop("line-delete", getRenderedRangeTop(originalEditor, originalRect, change, "theirs"));
                const modifiedTop = getDomBlockTop("line-insert", getRenderedRangeTop(modifiedEditor, modifiedRect, change, "mine"));
                const choiceLeft = getChoiceColumnLeft();

                if (originalPosition && originalTop != null) {
                  nextPositions.push({
                    index,
                    side: "theirs",
                    top: originalTop,
                    left: choiceLeft,
                  });
                }
                if (modifiedPosition && modifiedTop != null) {
                  nextPositions.push({
                    index,
                    side: "mine",
                    top: modifiedTop,
                    left: choiceLeft,
                  });
                }
              });

              setInlineChoicePositions(nextPositions);
            };
            const lineInChange = (lineNumber, change, side) => {
              const start = side === "theirs" ? change.originalStartLineNumber : change.modifiedStartLineNumber;
              const end = side === "theirs" ? change.originalEndLineNumber : change.modifiedEndLineNumber;
              const fallback = Math.max(1, start || end || 1);
              return lineNumber >= fallback && lineNumber <= Math.max(fallback, end || fallback);
            };
            const chooseInlineChange = (side, index, change) => {
              setActiveChangeIndex(index);
              changeChoicesRef.current = {
                ...changeChoicesRef.current,
                [index]: side,
              };
              setChangeChoices((current) => ({ ...current, [index]: side }));
              modifiedEditor.revealLineInCenter(Math.max(1, change.modifiedStartLineNumber || change.modifiedEndLineNumber || 1));
              modifiedEditor.focus();
            };
            const getChoiceDecoration = (side, index) => ({
              glyphMarginClassName: `git-conflict-glyph-choice git-conflict-glyph-${side}${changeChoicesRef.current[index] === side ? " selected" : ""}`,
              glyphMarginHoverMessage: {
                value: side === "theirs" ? "Use theirs for this change" : "Use mine for this change",
              },
              isWholeLine: false,
            });
            const handleGlyphClick = (side, event) => {
              if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
              const lineNumber = event.target.position?.lineNumber;
              if (!lineNumber) return;
              const index = latestChanges.findIndex((change) => lineInChange(lineNumber, change, side));
              if (index < 0) return;
              chooseInlineChange(side, index, latestChanges[index]);
            };
            const syncChanges = () => {
              const changes = editor.getLineChanges?.() || [];
              latestChanges = changes;
              setLineChanges(changes);
              window.setTimeout(renderInlineChoiceOverlay, 0);
              originalDecorations.clear();
              modifiedDecorations.clear();
              if (readOnly) {
                return;
              }
            };
            modifiedEditor.onDidChangeModelContent(() => {
              setResolvedContent(modifiedEditor.getValue());
              setSaveState("idle");
              monaco.editor.setModelMarkers(modifiedEditor.getModel(), "dita-resolution-validation", []);
              window.setTimeout(() => {
                syncChanges();
                renderInlineChoiceOverlay();
              }, 0);
            });
            originalEditor.onDidScrollChange(renderInlineChoiceOverlay);
            modifiedEditor.onDidScrollChange(renderInlineChoiceOverlay);
            originalEditor.onDidLayoutChange(renderInlineChoiceOverlay);
            modifiedEditor.onDidLayoutChange(renderInlineChoiceOverlay);
            editor.onDidUpdateDiff?.(syncChanges);
            window.setTimeout(() => {
              syncChanges();
              renderInlineChoiceOverlay();
            }, 0);
          }}
        />
      </div>
    </div>
  );
}

function GitCommitContextMenu({ contextMenu, onCheckout, onOpenGitHub, onClose }) {
  const menuRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(contextMenu.x, margin), window.innerWidth - rect.width - margin);
    const shouldOpenAbove = contextMenu.y + rect.height + margin > window.innerHeight;
    const top = shouldOpenAbove
      ? Math.max(margin, contextMenu.y - rect.height - 4)
      : Math.min(contextMenu.y, window.innerHeight - rect.height - margin);

    setMenuPosition({ x: left, y: top });
  }, [contextMenu.x, contextMenu.y]);

  return (
    <div
      ref={menuRef}
      className="tab-context-menu project-context-menu git-commit-context-menu"
      style={{
        left: menuPosition?.x ?? contextMenu.x,
        top: menuPosition?.y ?? contextMenu.y,
        visibility: menuPosition ? "visible" : "hidden",
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      aria-label={`Commit actions for ${contextMenu.commit.shortSha}`}
    >
      <ProjectMenuItem icon="history" label="Checkout" onClick={onCheckout} />
      <ProjectMenuItem icon="open" label="Open on GitHub" onClick={onOpenGitHub} />
      <hr />
      <ProjectMenuItem icon="delete" label="Close" onClick={onClose} />
    </div>
  );
}

function SchemaPanel({ selectedNode, selectedPath, parsedDoc }) {
  if (!selectedNode) {
    return <p className="empty-state">Select an XML element to inspect its schema.</p>;
  }

  const definition = getElementDefinition(selectedNode.tagName);
  const childOptions = getAllowedChildOptions(selectedNode);
  const siblingOptions = getAllowedSiblingOptions(parsedDoc, selectedPath);
  const attributeDefinitions = getAttributeDefinitions(selectedNode.tagName);

  if (!definition) {
    return (
      <div className="schema-panel-content">
        <p className="issue error">&lt;{selectedNode.tagName}&gt; is not defined in the active schema profile.</p>
      </div>
    );
  }

  return (
    <div className="schema-panel-content">
      <section className="schema-card">
        <h3>&lt;{selectedNode.tagName}&gt;</h3>
        <div className="schema-meta-grid">
          <span>Inline</span>
          <strong>{definition.inline ? "Yes" : "No"}</strong>
          <span>Inline container</span>
          <strong>{definition.inlineContainer ? "Yes" : "No"}</strong>
          <span>Template</span>
          <strong>{definition.template || "None"}</strong>
        </div>
      </section>

      <SchemaList title="Allowed Children" values={childOptions} emptyText="No child elements are allowed." />
      <SchemaList title="Add After" values={siblingOptions} emptyText="No following siblings are allowed here." />
      <SchemaList title="Unique Children" values={definition.uniqueChildren || []} emptyText="No unique-child rules." />

      <section className="schema-card">
        <h3>Attributes</h3>
        {attributeDefinitions.length ? (
          <div className="schema-attribute-list">
            {attributeDefinitions.map((attribute) => (
              <div key={attribute.name}>
                <strong>{attribute.name}</strong>
                <span>{attribute.values?.length ? attribute.values.join(", ") : attribute.placeholder || "Free text"}</span>
              </div>
            ))}
          </div>
        ) : (
          <p>No attributes are defined.</p>
        )}
      </section>
    </div>
  );
}

function SchemaList({ title, values, emptyText }) {
  return (
    <section className="schema-card">
      <h3>{title}</h3>
      {values.length ? (
        <div className="schema-chip-list">
          {values.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </div>
      ) : (
        <p>{emptyText}</p>
      )}
    </section>
  );
}

function ImageViewer({ file }) {
  const imageSrc = file?.previewHref || file?.content || "";

  return (
    <div className="image-viewer" aria-label={`Image preview for ${file?.name || "image"}`}>
      {imageSrc ? (
        <img src={imageSrc} alt={file?.name || "Preview"} />
      ) : (
        <div className="image-viewer-placeholder">
          <strong>{file?.name || "Image"}</strong>
          <span>No preview is available.</span>
        </div>
      )}
    </div>
  );
}

function SchemaContextMenu({
  contextMenu,
  onClose,
  onInsert,
  onSpellingReplace,
  onSpellingIgnore,
  onSpellingAddToDictionary,
  onAiAction,
  onTableCommand,
}) {
  const { insertContext } = contextMenu;
  const spellingIssue = contextMenu.spellingIssue as SpellingIssue | null | undefined;
  const tableOptions = contextMenu.tableOptions || [];
  const hasTextSelection = contextMenu.authoringSelection?.kind === "range";
  const addIntoOptions = hasTextSelection
    ? []
    : insertContext.childOptions;
  const addAfterOptions = insertContext.siblingOptions;
  const surroundOptions = hasTextSelection ? insertContext.surroundOptions : [];
  const aiOptions = [
    { id: "rewrite", label: "Rewrite Selection", icon: "rewrite", disabled: !hasTextSelection },
    { id: "shorter", label: "Make Shorter", icon: "shorter", disabled: !hasTextSelection },
    { id: "longer", label: "Make Longer", icon: "longer", disabled: !hasTextSelection },
    { id: "shortdesc", label: "Generate Shortdesc", icon: "shortdesc", disabled: !insertContext.selectedNode },
    { id: "review", label: "Review Current Topic", icon: "review", disabled: !insertContext.selectedNode },
    { id: "explain", label: "Explain Element", icon: "explain", disabled: !insertContext.selectedNode },
  ];
  const menuRef = useRef(null);
  const [position, setPosition] = useState({
    left: contextMenu.x,
    top: contextMenu.y,
    maxHeight: 480,
  });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const maxHeight = Math.max(180, window.innerHeight - margin * 2);
    const measuredHeight = Math.min(rect.height, maxHeight);
    const hasRoomBelow = contextMenu.y + measuredHeight + margin <= window.innerHeight;
    const top = hasRoomBelow
      ? contextMenu.y
      : Math.max(margin, contextMenu.y - measuredHeight - 4);
    const left = Math.min(
      Math.max(margin, contextMenu.x),
      Math.max(margin, window.innerWidth - rect.width - margin),
    );

    setPosition({ left, top, maxHeight });
  }, [
    contextMenu.x,
    contextMenu.y,
    addIntoOptions.length,
    addAfterOptions.length,
    surroundOptions.length,
    tableOptions.length,
  ]);

  useEffect(() => {
    function handlePointerDown(event) {
      const menu = menuRef.current;
      if (menu?.contains(event.target)) return;
      onClose();
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="schema-context-menu"
      style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      aria-label="Schema context menu"
    >
      <div className="context-menu-header">
        <span>{insertContext.selectedNode?.tagName || "none"}</span>
      </div>
      {spellingIssue && (
        <section className="context-menu-section spelling-context-section">
          <h3>Spelling</h3>
          <div className="spelling-context-word">
            <span>{spellingIssue.word}</span>
            <small>{spellingIssue.language}</small>
          </div>
          <div className="context-menu-actions">
            {spellingIssue.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                role="menuitem"
                type="button"
                onClick={() => onSpellingReplace(spellingIssue, suggestion)}
              >
                <span className="schema-context-menu-label">
                  <span className="schema-context-menu-icon" aria-hidden="true">
                    <SchemaContextMenuIcon type="spelling" />
                  </span>
                  <span>{suggestion}</span>
                </span>
              </button>
            ))}
            <button
              role="menuitem"
              type="button"
              onClick={() => onSpellingIgnore(spellingIssue)}
            >
              Ignore
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => onSpellingAddToDictionary(spellingIssue)}
            >
              Add to dictionary
            </button>
          </div>
        </section>
      )}
      <ContextMenuSubmenu
        title="AI"
        icon="ai"
        options={aiOptions}
        emptyText="No AI actions are available."
        onSelect={(option) => onAiAction(option.id)}
      />
      {surroundOptions.length > 0 && (
        <ContextMenuSubmenu
          title="Surround With"
          icon="surround"
          options={surroundOptions.map((tagName) => ({ id: tagName, label: tagName, icon: "element" }))}
          emptyText="No inline wrappers allowed for this selection."
          onSelect={(option) => onInsert(option.id, "surround")}
        />
      )}
      {!hasTextSelection && (
        <ContextMenuSubmenu
          title="Add Into"
          icon="addInto"
          options={addIntoOptions.map((tagName) => ({ id: tagName, label: tagName, icon: "element" }))}
          emptyText="No child elements are allowed inside this element."
          onSelect={(option) => onInsert(option.id, "child")}
        />
      )}
      <ContextMenuSubmenu
        title="Add After"
        icon="addAfter"
        options={addAfterOptions.map((tagName) => ({ id: tagName, label: tagName, icon: "element" }))}
        emptyText="No following sibling elements are allowed here."
        onSelect={(option) => onInsert(option.id, "after")}
      />
      {tableOptions.length > 0 && (
        <ContextMenuSubmenu
          title="Table"
          icon="table"
          options={tableOptions}
          emptyText="No table operations are available."
          onSelect={(option) => onTableCommand(option.id)}
        />
      )}
    </div>
  );
}

function ContextMenuSubmenu({ title, icon, options, emptyText, onSelect }) {
  const availableOptions = options.filter((option) => !option.hidden);
  const submenuRef = useRef(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({ top: -4, bottom: "auto", maxHeight: 360 });

  function updatePanelPlacement() {
    const submenu = submenuRef.current;
    if (!submenu) return;

    const margin = 10;
    const rect = submenu.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.top - margin;
    const spaceAbove = rect.bottom - margin;
    const openBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;

    setPanelStyle(openBelow
      ? { top: -4, bottom: "auto", maxHeight: Math.max(150, Math.min(360, spaceBelow)) }
      : { top: "auto", bottom: -4, maxHeight: Math.max(150, Math.min(360, spaceAbove)) });
  }

  return (
    <div
      ref={submenuRef}
      className="schema-context-submenu"
      role="none"
      onPointerEnter={updatePanelPlacement}
      onFocus={updatePanelPlacement}
    >
      <button type="button" className="schema-context-submenu-trigger" role="menuitem" disabled={!availableOptions.length}>
        <span className="schema-context-menu-label">
          <span className="schema-context-menu-icon" aria-hidden="true">
            <SchemaContextMenuIcon type={icon} />
          </span>
          <span>{title}</span>
        </span>
        <span aria-hidden="true">›</span>
      </button>
      <div
        className={`schema-context-submenu-panel${availableOptions.length > 8 ? " scrollable" : ""}`}
        role="menu"
        aria-label={title}
        style={panelStyle}
      >
        {availableOptions.length ? (
          availableOptions.map((option) => (
            <button
              disabled={option.disabled}
              key={option.id}
              role="menuitem"
              title={option.title || ""}
              type="button"
              onClick={() => onSelect(option)}
            >
              <span className="schema-context-menu-label">
                <span className="schema-context-menu-icon" aria-hidden="true">
                  <SchemaContextMenuIcon type={option.icon || "element"} />
                </span>
                <span>{option.label}</span>
              </span>
            </button>
          ))
        ) : (
          <em>{emptyText}</em>
        )}
      </div>
    </div>
  );
}

function SchemaContextMenuIcon({ type }) {
  if (type === "spelling") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="m5 13 4 4L19 7" />
        <path d="M4 20h16" />
      </svg>
    );
  }

  if (type === "ai") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 3.5l1.4 4.1 4.1 1.4-4.1 1.4-1.4 4.1-1.4-4.1-4.1-1.4 4.1-1.4L12 3.5Z" />
        <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z" />
      </svg>
    );
  }

  if (type === "rewrite") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 18h6" />
        <path d="M4 14h10" />
        <path d="M4 10h8" />
        <path d="M14.5 18.5 20 13l1 1-5.5 5.5H14v-1Z" />
      </svg>
    );
  }

  if (type === "shorter") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M5 8h14" />
        <path d="M5 12h10" />
        <path d="M5 16h6" />
        <path d="m15 15 3-3-3-3" />
      </svg>
    );
  }

  if (type === "longer") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M5 8h8" />
        <path d="M5 12h10" />
        <path d="M5 16h14" />
        <path d="m17 9 3 3-3 3" />
      </svg>
    );
  }

  if (type === "explain") {
    return (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
      </svg>
    );
  }

  if (type === "shortdesc") {
    return (
      <svg viewBox="0 0 24 24">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
      </svg>
    );
  }

  if (type === "review") {
    return (
      <svg viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="6" />
        <path d="m16 16 4 4" />
        <path d="m8.5 11 1.7 1.7 3.4-3.7" />
      </svg>
    );
  }

  if (type === "addInto") {
    return (
      <svg viewBox="0 0 24 24">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M12 9v6" />
        <path d="M9 12h6" />
      </svg>
    );
  }

  if (type === "addAfter") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M5 7h9" />
        <path d="M5 12h9" />
        <path d="M5 17h6" />
        <path d="M18 10v8" />
        <path d="M14 14h8" />
      </svg>
    );
  }

  if (type === "surround") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M8 5H5v14h3" />
        <path d="M16 5h3v14h-3" />
        <path d="M10 12h4" />
      </svg>
    );
  }

  if (type === "table") {
    return (
      <svg viewBox="0 0 24 24">
        <rect x="4" y="5" width="16" height="14" rx="1" />
        <path d="M4 10h16" />
        <path d="M4 15h16" />
        <path d="M10 5v14" />
        <path d="M16 5v14" />
      </svg>
    );
  }

  if (type === "table-row-before" || type === "table-row-after") {
    return (
      <svg viewBox="0 0 24 24">
        <rect x="5" y="7" width="14" height="10" rx="1" />
        <path d="M5 12h14" />
        <path d={type === "table-row-before" ? "M12 3v4" : "M12 17v4"} />
        <path d={type === "table-row-before" ? "M9 5h6" : "M9 19h6"} />
      </svg>
    );
  }

  if (type === "table-column-before" || type === "table-column-after") {
    return (
      <svg viewBox="0 0 24 24">
        <rect x="7" y="5" width="10" height="14" rx="1" />
        <path d="M12 5v14" />
        <path d={type === "table-column-before" ? "M3 12h4" : "M17 12h4"} />
        <path d={type === "table-column-before" ? "M5 9v6" : "M19 9v6"} />
      </svg>
    );
  }

  if (type === "table-delete-row" || type === "table-delete-column") {
    return (
      <svg viewBox="0 0 24 24">
        <rect x="5" y="5" width="14" height="14" rx="1" />
        {type === "table-delete-row" ? <path d="M5 12h14" /> : <path d="M12 5v14" />}
        <path d="m8 8 8 8" />
        <path d="m16 8-8 8" />
      </svg>
    );
  }

  if (type === "table-merge-right" || type === "table-merge-left") {
    return (
      <svg viewBox="0 0 24 24">
        <rect x="5" y="5" width="14" height="14" rx="1" />
        <path d="M12 5v14" />
        <path d="M5 12h14" />
        {type === "table-merge-right" ? <path d="m10 12 4-4v8l-4-4Z" /> : <path d="m14 12-4-4v8l4-4Z" />}
      </svg>
    );
  }

  if (type === "table-split-cells") {
    return (
      <svg viewBox="0 0 24 24">
        <rect x="5" y="5" width="14" height="14" rx="1" />
        <path d="M12 5v14" />
        <path d="M5 12h14" />
        <path d="m9 9-2 2 2 2" />
        <path d="m15 9 2 2-2 2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24">
      <path d="m9 7-5 5 5 5" />
      <path d="m15 7 5 5-5 5" />
    </svg>
  );
}

function ContextMenuSection({ title, options, emptyText, onSelect }) {
  return (
    <section className="context-menu-section">
      <h3>{title}</h3>
      <div className="context-menu-actions">
        {options.length ? (
          options.map((tagName) => (
            <button
              key={tagName}
              role="menuitem"
              onClick={() => onSelect(tagName)}
            >
              {tagName}
            </button>
          ))
        ) : (
          <em>{emptyText}</em>
        )}
      </div>
    </section>
  );
}

function projectNodeContainsId(node, id) {
  if (node.id === id) return true;
  if (node.type !== "folder") return false;
  return node.children.some((child) => projectNodeContainsId(child, id));
}

function ProjectNodeNameEditor({ name, onCommit, onCancel }) {
  const [draft, setDraft] = useState(name);
  const inputRef = useRef(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className="project-node-name-editor"
      aria-label="Edit name"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onBlur={() => {
        if (finishedRef.current) return;
        finishedRef.current = true;
        onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (finishedRef.current) return;
          finishedRef.current = true;
          onCommit(draft);
        }

        if (event.key === "Escape") {
          event.preventDefault();
          finishedRef.current = true;
          onCancel();
        }
      }}
    />
  );
}

function ProjectTreeNode({
  node,
  activeFileId,
  selectedProjectId,
  onSelect,
  onOpenFile,
  editingNodeId,
  onCommitRename,
  onCancelRename,
  onOpenContextMenu,
  onMove,
  dropTarget,
  onDropTargetChange,
  query = "",
  sortMode = "name",
  depth = 0,
  pathParts = [],
}) {
  const selected = node.id === selectedProjectId;
  const active = node.id === activeFileId;
  const currentPathParts = [...pathParts, node.name];
  const projectPath = getProjectNodePath(currentPathParts);
  const dragHref = projectPath;
  const visible = projectNodeHasVisibleMatch(node, query, projectPath);
  const matched = projectNodeMatchesQuery(node, query, projectPath);
  const dropPlacement = dropTarget?.nodeId === node.id ? dropTarget.placement : null;
  const isSearchActive = Boolean(query.trim());
  const visibleChildren = node.type === "folder"
    ? getSortedProjectChildren(node.children.filter((child) => !child.deletedAt), sortMode)
    : [];
  const canExpand = node.type === "folder" && visibleChildren.length > 0;
  const iconKind = node.type === "folder" ? "folder" : getProjectFileIconKind(node);
  const [expanded, setExpanded] = useState(node.id === "root" || depth < 2);
  const showChildren = canExpand && (expanded || isSearchActive);

  useEffect(() => {
    if (canExpand && selectedProjectId && projectNodeContainsId(node, selectedProjectId)) {
      setExpanded(true);
    }
  }, [canExpand, node, selectedProjectId]);

  if ((node.deletedAt && node.id !== "root") || !visible) return null;

  function getDropPlacement(event) {
    if (node.type === "folder") {
      const rect = event.currentTarget.getBoundingClientRect();
      const offset = event.clientY - rect.top;
      if (offset < rect.height * 0.25) return "before";
      if (offset > rect.height * 0.75) return "after";
      return "inside";
    }

    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY - rect.top < rect.height / 2 ? "before" : "after";
  }

  return (
    <div className={`project-node${matched && query.trim() ? " search-match" : ""}${dropPlacement ? ` drop-${dropPlacement}` : ""}`} style={{ "--depth": depth } as React.CSSProperties}>
      <button
        className={`${selected ? "selected" : ""} ${active ? "active-file" : ""}`}
        draggable={node.id !== "root" && editingNodeId !== node.id}
        onDragStart={(event) => {
          if (node.id === "root") return;

          event.dataTransfer.effectAllowed = node.type === "file" ? "copyMove" : "move";
          event.dataTransfer.setData("application/x-xml-editor-project-node", node.id);
          if (node.type === "file") {
            event.dataTransfer.setData("text/plain", dragHref);
            event.dataTransfer.setData("application/x-dita-project-file", JSON.stringify({
              id: node.id,
              href: dragHref,
              name: node.name,
              path: projectPath,
              githubPath: node.githubPath || "",
              previewHref: node.previewHref || "",
              kind: node.ditaType || "file",
            }));
          }
        }}
        onDragOver={(event) => {
          const draggedNodeId = event.dataTransfer.getData("application/x-xml-editor-project-node");
          if (!draggedNodeId || draggedNodeId === node.id) return;

          event.preventDefault();
          const placement = getDropPlacement(event);
          event.dataTransfer.dropEffect = "move";
          onDropTargetChange({ nodeId: node.id, placement });
        }}
        onDragLeave={() => {
          if (dropTarget?.nodeId === node.id) {
            onDropTargetChange(null);
          }
        }}
        onDrop={(event) => {
          const draggedNodeId = event.dataTransfer.getData("application/x-xml-editor-project-node");
          if (!draggedNodeId || draggedNodeId === node.id) return;

          event.preventDefault();
          event.stopPropagation();
          const placement = dropTarget?.nodeId === node.id ? dropTarget.placement : getDropPlacement(event);
          onMove(draggedNodeId, node.id, placement);
          onDropTargetChange(null);
        }}
        onDragEnd={() => onDropTargetChange(null)}
        aria-expanded={canExpand ? showChildren : undefined}
        onClick={() => {
          onSelect(node.id);
          if (canExpand && !isSearchActive) {
            setExpanded((current) => !current);
          }
        }}
        onContextMenu={(event) => onOpenContextMenu(event, node.id)}
        onDoubleClick={() => {
          if (node.type === "file") {
            onOpenFile(node.id);
          }
        }}
      >
        <span className={`project-node-chevron${canExpand ? "" : " placeholder"}${showChildren ? " expanded" : ""}`} aria-hidden="true" />
        <span className={`project-node-icon ${iconKind}`} aria-hidden="true">
          {node.type === "folder" ? <FolderFileIcon /> : <FileTypeIcon kind={iconKind} />}
        </span>
        {editingNodeId === node.id ? (
          <ProjectNodeNameEditor
            name={node.name}
            onCommit={(nextName) => onCommitRename(node.id, nextName)}
            onCancel={onCancelRename}
          />
        ) : (
          <span className="project-node-name">{node.name}</span>
        )}
      </button>
      {showChildren && (
        <div className="project-children">
          {visibleChildren.map((child) => (
            <ProjectTreeNode
              key={child.id}
              node={child}
              activeFileId={activeFileId}
              selectedProjectId={selectedProjectId}
              onSelect={onSelect}
              onOpenFile={onOpenFile}
              editingNodeId={editingNodeId}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onOpenContextMenu={onOpenContextMenu}
              onMove={onMove}
              dropTarget={dropTarget}
              onDropTargetChange={onDropTargetChange}
              query={query}
              sortMode={sortMode}
              depth={depth + 1}
              pathParts={currentPathParts}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeNode({ node, path, selectedPath, hrefValidationMap, onSelect }) {
  const selected = path.join(".") === selectedPath.join(".");
  if (isVisualMetadataElement(node.tagName)) {
    return null;
  }

  const children = elementChildren(node);
  const hrefValidationState = hrefValidationMap[pathKeyFor(path)];
  const hasBrokenHref = hrefValidationState?.status === "invalid";

  return (
    <div className="tree-node">
      <button
        className={`${selected ? "selected" : ""}${hasBrokenHref ? " href-invalid" : ""}`}
        title={hasBrokenHref ? hrefValidationState.message : undefined}
        onClick={() => onSelect(path)}
      >
        <span>{node.tagName}</span>
        {node.getAttribute("id") && <small>#{node.getAttribute("id")}</small>}
      </button>
      {children.length > 0 && (
        <div className="tree-children">
          {children.map((child, index) => (
            <TreeNode
              key={`${child.tagName}-${index}`}
              node={child}
              path={[...path, index]}
              selectedPath={selectedPath}
              hrefValidationMap={hrefValidationMap}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VisualNode({
  node,
  path,
  selectedPath,
  highlightedPathKey,
  onSelect,
  onTextChange,
  onTextNodeChange,
  onTextInput,
  onCaretChange,
  onListItemEnter,
  onParagraphEnter,
  onHrefDrop,
  resolveImageHref,
  hrefValidationMap,
  pinnedSelection,
  visualSearchQuery,
  spellingIssues = [],
  inlineExitCaret,
  onInlineExitTextInput,
  onOpenContextMenu,
}) {
  const highlighted = pathKeyFor(path) === highlightedPathKey;
  const selected = pathKeyFor(path) === pathKeyFor(selectedPath);
  const tagName = node.tagName;
  if (isVisualMetadataElement(tagName)) {
    return null;
  }

  const children = elementChildren(node);
  const text = node.textContent || "";
  const hasElementChildren = children.length > 0;
  const isHrefDropTarget = tagName === "image" || tagName === "xref" || tagName === "topicref";
  const rendersInline = isInlineRenderingElement(tagName) && tagName !== "image";
  const rendersBodyBlock = nodeSpecializesFrom(node, "body");
  const [isHrefDragOver, setIsHrefDragOver] = useState(false);
  const hrefValidationState = hrefValidationMap[pathKeyFor(path)];
  const className = `dita-node dita-${tagName}${rendersInline ? " inline-node" : ""}${rendersBodyBlock ? " body-node" : ""}${highlighted || selected ? " selected" : ""}${hrefValidationState?.status === "invalid" ? " href-invalid" : ""}${hrefValidationState?.status === "valid" ? " href-valid" : ""}${isHrefDropTarget && isHrefDragOver ? " drop-active" : ""}`;
  const placeholder = getEditorPlaceholderForNode(node);

  function select(event) {
    event.stopPropagation();
    onSelect(path);
    onCaretChange(getAuthoringSelection());
  }

  function handleEditableEnterKeyDown(event, textNodeIndex = null) {
    if (event.key !== "Enter" || event.shiftKey) return;

    if (!["li", "cmd", "p"].includes(tagName)) return;

    const authoringSelection = getAuthoringSelection();
    const currentText = stripEditableCaretSeed(event.currentTarget.textContent || "");

    if (tagName === "li" || tagName === "cmd") {
      const handled = onListItemEnter(path, currentText, textNodeIndex, authoringSelection);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onParagraphEnter(path, currentText, textNodeIndex, authoringSelection);
  }

  function handlePlainTextPaste(event: React.ClipboardEvent<HTMLElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;

    event.preventDefault();
    insertTextAtSelection(event.currentTarget, sanitizePastedText(text));
    onCaretChange(getAuthoringSelection());
  }

  function handleCodeblockPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;

    event.preventDefault();
    insertTextIntoTextarea(event.currentTarget, sanitizePastedText(text, true));
  }

  function handleEditableDoubleClick(event: React.MouseEvent<HTMLElement>) {
    event.stopPropagation();
    const target = event.currentTarget;
    const { clientX, clientY } = event;

    window.requestAnimationFrame(() => {
      const nativeSelection = getAuthoringSelection();
      const authoringSelection = nativeSelection?.kind === "range"
        ? nativeSelection
        : selectWordAtPoint(target, clientX, clientY);

      if (authoringSelection) {
        onCaretChange(authoringSelection);
      }
    });
  }

  function handleEditableMouseDown(event: React.MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function handleEditableClick(event: React.MouseEvent<HTMLElement>) {
    event.stopPropagation();
    onCaretChange(getAuthoringSelection());
  }

  function handleEditableMouseUp(event: React.MouseEvent<HTMLElement>) {
    event.stopPropagation();
    onCaretChange(getAuthoringSelection());
  }

  function handleEditableFocus(event: React.FocusEvent<HTMLElement>) {
    event.stopPropagation();
    window.requestAnimationFrame(() => onCaretChange(getAuthoringSelection()));
  }

  function normalizeEditableBlur(target: HTMLElement) {
    const nextText = stripEditableCaretSeed(target.textContent || "");
    const hasText = Boolean(nextText.trim());

    target.classList.toggle("has-live-text", hasText);
    target.classList.toggle("editable-empty", !hasText);

    if (!hasText) {
      target.textContent = "";
    }

    return nextText;
  }

  function normalizeEditableInputTarget(target: HTMLElement, stripCaretSeed = false) {
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const shouldRestoreCaret = Boolean(range?.collapsed && target.contains(range.startContainer));
    const caretOffset = range && shouldRestoreCaret ? getRangeTextOffsetWithin(target, range) : null;
    const rawText = target.textContent || "";
    const nextText = stripCaretSeed ? stripEditableCaretSeed(rawText) : rawText;
    const shouldFlattenDom = target.childNodes.length !== 1 || target.firstChild?.nodeType !== Node.TEXT_NODE;

    if (shouldFlattenDom || rawText !== nextText) {
      target.textContent = nextText;
      if (shouldRestoreCaret && caretOffset !== null) {
        setCaretByTextOffset(target, Math.min(caretOffset, nextText.length));
      }
    }

    const hasText = Boolean(nextText.trim());
    target.classList.toggle("has-live-text", hasText);
    target.classList.toggle("editable-empty", !hasText);
    return nextText;
  }

  function getDroppedProjectFile(event: React.DragEvent<HTMLElement>) {
    const projectFileData = event.dataTransfer.getData("application/x-dita-project-file");
    if (projectFileData) {
      try {
        const parsedFile = JSON.parse(projectFileData);
        if (typeof parsedFile.href === "string") return parsedFile;
      } catch {
        return null;
      }
    }

    const href = event.dataTransfer.getData("text/plain");
    return href ? { href, name: "", kind: "file" } : null;
  }

  function handleHrefDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsHrefDragOver(false);

    const droppedFile = getDroppedProjectFile(event);
    if (droppedFile) {
      onHrefDrop(path, droppedFile);
    }
  }

  function handleHrefDrag(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsHrefDragOver(true);
  }

  function renderChildNodes(childNodes = children) {
    return childNodes.map((child, index) => (
      <VisualNode
        key={`${child.tagName}-${index}`}
        node={child}
        path={[...path, index]}
        selectedPath={selectedPath}
        highlightedPathKey={highlightedPathKey}
        onSelect={onSelect}
        onTextChange={onTextChange}
        onTextNodeChange={onTextNodeChange}
        onTextInput={onTextInput}
        onCaretChange={onCaretChange}
        onListItemEnter={onListItemEnter}
        onParagraphEnter={onParagraphEnter}
        onHrefDrop={onHrefDrop}
        resolveImageHref={resolveImageHref}
        hrefValidationMap={hrefValidationMap}
        pinnedSelection={pinnedSelection}
        visualSearchQuery={visualSearchQuery}
        spellingIssues={spellingIssues}
        inlineExitCaret={inlineExitCaret}
        onInlineExitTextInput={onInlineExitTextInput}
        onOpenContextMenu={onOpenContextMenu}
      />
    ));
  }

  function renderCalsGridCells() {
    const grid = resolveCalsGrid(node);
    if (!grid.valid) return null;

    return grid.rows.flatMap((rowGrid) => rowGrid.cells.map((cell) => {
      const relativePath = getRelativePathForElement(node, cell.entry);
      if (!relativePath) return null;

      const cellPath = [...path, ...relativePath];
      return (
        <div
          className="dita-cals-cell-shell"
          key={cellPath.join(".")}
          style={{
            gridColumn: `${cell.startCol + 1} / ${cell.endCol + 2}`,
            gridRow: `${cell.rowIndex + 1} / ${cell.endRow + 2}`,
          }}
        >
          <VisualNode
            node={cell.entry}
            path={cellPath}
            selectedPath={selectedPath}
            highlightedPathKey={highlightedPathKey}
            onSelect={onSelect}
            onTextChange={onTextChange}
            onTextNodeChange={onTextNodeChange}
            onTextInput={onTextInput}
            onCaretChange={onCaretChange}
            onListItemEnter={onListItemEnter}
            onParagraphEnter={onParagraphEnter}
            onHrefDrop={onHrefDrop}
            resolveImageHref={resolveImageHref}
            hrefValidationMap={hrefValidationMap}
            pinnedSelection={pinnedSelection}
            visualSearchQuery={visualSearchQuery}
            spellingIssues={spellingIssues}
            inlineExitCaret={inlineExitCaret}
            onInlineExitTextInput={onInlineExitTextInput}
            onOpenContextMenu={onOpenContextMenu}
          />
        </div>
      );
    }));
  }

  if (tagName === "topic" || tagName === "map") {
    return (
      <div
        className={className}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        tabIndex={0}
      >
        {children.map((child, index) => (
          <VisualNode
            key={`${child.tagName}-${index}`}
            node={child}
            path={[...path, index]}
            selectedPath={selectedPath}
            highlightedPathKey={highlightedPathKey}
            onSelect={onSelect}
            onTextChange={onTextChange}
            onTextNodeChange={onTextNodeChange}
            onTextInput={onTextInput}
            onCaretChange={onCaretChange}
            onListItemEnter={onListItemEnter}
            onParagraphEnter={onParagraphEnter}
            onHrefDrop={onHrefDrop}
            resolveImageHref={resolveImageHref}
            hrefValidationMap={hrefValidationMap}
            pinnedSelection={pinnedSelection}
            visualSearchQuery={visualSearchQuery}
            spellingIssues={spellingIssues}
            inlineExitCaret={inlineExitCaret}
            onInlineExitTextInput={onInlineExitTextInput}
            onOpenContextMenu={onOpenContextMenu}
          />
        ))}
      </div>
    );
  }

  if (tagName === "body") {
    return (
      <div
        className={className}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        tabIndex={0}
      >
        {children.map((child, index) => (
          <VisualNode
            key={`${child.tagName}-${index}`}
            node={child}
            path={[...path, index]}
            selectedPath={selectedPath}
            highlightedPathKey={highlightedPathKey}
            onSelect={onSelect}
            onTextChange={onTextChange}
            onTextNodeChange={onTextNodeChange}
            onTextInput={onTextInput}
            onCaretChange={onCaretChange}
            onListItemEnter={onListItemEnter}
            onParagraphEnter={onParagraphEnter}
            onHrefDrop={onHrefDrop}
            resolveImageHref={resolveImageHref}
            hrefValidationMap={hrefValidationMap}
            pinnedSelection={pinnedSelection}
            visualSearchQuery={visualSearchQuery}
            spellingIssues={spellingIssues}
            inlineExitCaret={inlineExitCaret}
            onInlineExitTextInput={onInlineExitTextInput}
            onOpenContextMenu={onOpenContextMenu}
          />
        ))}
      </div>
    );
  }

  if (tagName === "section") {
    return (
      <section
        className={className}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        tabIndex={0}
      >
        {children.map((child, index) => (
          <VisualNode
            key={`${child.tagName}-${index}`}
            node={child}
            path={[...path, index]}
            selectedPath={selectedPath}
            highlightedPathKey={highlightedPathKey}
            onSelect={onSelect}
            onTextChange={onTextChange}
            onTextNodeChange={onTextNodeChange}
            onTextInput={onTextInput}
            onCaretChange={onCaretChange}
            onListItemEnter={onListItemEnter}
            onParagraphEnter={onParagraphEnter}
            onHrefDrop={onHrefDrop}
            resolveImageHref={resolveImageHref}
            hrefValidationMap={hrefValidationMap}
            pinnedSelection={pinnedSelection}
            visualSearchQuery={visualSearchQuery}
            spellingIssues={spellingIssues}
            inlineExitCaret={inlineExitCaret}
            onInlineExitTextInput={onInlineExitTextInput}
            onOpenContextMenu={onOpenContextMenu}
          />
        ))}
      </section>
    );
  }

  if (tagName === "fig") {
    return (
      <figure
        className={className}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        tabIndex={0}
      >
        {children.map((child, index) => (
          <VisualNode
            key={`${child.tagName}-${index}`}
            node={child}
            path={[...path, index]}
            selectedPath={selectedPath}
            highlightedPathKey={highlightedPathKey}
            onSelect={onSelect}
            onTextChange={onTextChange}
            onTextNodeChange={onTextNodeChange}
            onTextInput={onTextInput}
            onCaretChange={onCaretChange}
            onListItemEnter={onListItemEnter}
            onParagraphEnter={onParagraphEnter}
            onHrefDrop={onHrefDrop}
            resolveImageHref={resolveImageHref}
            hrefValidationMap={hrefValidationMap}
            pinnedSelection={pinnedSelection}
            visualSearchQuery={visualSearchQuery}
            spellingIssues={spellingIssues}
            inlineExitCaret={inlineExitCaret}
            onInlineExitTextInput={onInlineExitTextInput}
            onOpenContextMenu={onOpenContextMenu}
          />
        ))}
      </figure>
    );
  }

  if (isTableContainerElement(tagName)) {
    const containerModel = getTableModelForTable(tagName);
    const tableClass = containerModel ? ` table-model-${containerModel}` : "";
    const calsGrid = tagName === "tgroup" ? resolveCalsGrid(node) : null;

    return (
      <div
        className={`${className} dita-table-grid${tableClass}${calsGrid?.valid ? " cals-resolved-grid" : ""}`}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        style={calsGrid?.valid
          ? { "--dita-column-count": String(Math.max(1, calsGrid.columnCount)) } as React.CSSProperties
          : undefined}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        tabIndex={0}
      >
        {calsGrid?.valid ? renderCalsGridCells() : renderChildNodes()}
      </div>
    );
  }

  if (isTableRowElement(tagName)) {
    const rowModel = getTableModelForRow(tagName) || "simple";
    const cells = getRowCells(node, rowModel);

    return (
      <div
        className={`${className} dita-table-row table-model-${rowModel}`}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        style={{ "--dita-column-count": String(Math.max(1, cells.length)) } as React.CSSProperties}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        tabIndex={0}
      >
        {renderChildNodes()}
      </div>
    );
  }

  if (isTableCellElement(tagName)) {
    return (
      <div
        className={`${className} dita-table-cell`}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        tabIndex={0}
      >
        {hasElementChildren ? renderChildNodes() : (
          <span
            className={`dita-text-run${text.trim() ? " has-live-text" : " editable-empty"}`}
            contentEditable
            data-dita-tag={tagName}
            data-editing-element={tagName}
            data-node-path={path.join(".")}
            data-text-node-index={0}
            data-placeholder={placeholder}
            suppressContentEditableWarning
            spellCheck={false}
            onMouseDown={handleEditableMouseDown}
            onClick={handleEditableClick}
            onContextMenu={(event) => onOpenContextMenu(event, path)}
            onKeyDown={(event) => handleEditableEnterKeyDown(event)}
            onInput={(event) => {
              const nextText = normalizeEditableInputTarget(event.currentTarget, true);
              onTextInput(path, nextText, null);
            }}
            onPaste={handlePlainTextPaste}
            onDoubleClick={handleEditableDoubleClick}
            onFocus={handleEditableFocus}
            onKeyUp={() => {
              onCaretChange(getAuthoringSelection());
            }}
            onMouseUp={handleEditableMouseUp}
            onBlur={(event) => onTextChange(path, normalizeEditableBlur(event.currentTarget))}
          >
            {text}
          </span>
        )}
      </div>
    );
  }

  if (tagName === "ul" || tagName === "ol") {
    const ListTag = tagName;
    return (
      <ListTag
        className={className}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        tabIndex={0}
      >
        {children.map((child, index) => (
          <VisualNode
            key={`${child.tagName}-${index}`}
            node={child}
            path={[...path, index]}
            selectedPath={selectedPath}
            highlightedPathKey={highlightedPathKey}
            onSelect={onSelect}
            onTextChange={onTextChange}
            onTextNodeChange={onTextNodeChange}
            onTextInput={onTextInput}
            onCaretChange={onCaretChange}
            onListItemEnter={onListItemEnter}
            onParagraphEnter={onParagraphEnter}
            onHrefDrop={onHrefDrop}
            resolveImageHref={resolveImageHref}
            hrefValidationMap={hrefValidationMap}
            pinnedSelection={pinnedSelection}
            visualSearchQuery={visualSearchQuery}
            spellingIssues={spellingIssues}
            inlineExitCaret={inlineExitCaret}
            onInlineExitTextInput={onInlineExitTextInput}
            onOpenContextMenu={onOpenContextMenu}
          />
        ))}
      </ListTag>
    );
  }

  if (tagName === "steps") {
    return (
      <ol
        className={className}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        tabIndex={0}
      >
        {children.map((child, index) => (
          <VisualNode
            key={`${child.tagName}-${index}`}
            node={child}
            path={[...path, index]}
            selectedPath={selectedPath}
            highlightedPathKey={highlightedPathKey}
            onSelect={onSelect}
            onTextChange={onTextChange}
            onTextNodeChange={onTextNodeChange}
            onTextInput={onTextInput}
            onCaretChange={onCaretChange}
            onListItemEnter={onListItemEnter}
            onParagraphEnter={onParagraphEnter}
            onHrefDrop={onHrefDrop}
            resolveImageHref={resolveImageHref}
            hrefValidationMap={hrefValidationMap}
            pinnedSelection={pinnedSelection}
            visualSearchQuery={visualSearchQuery}
            spellingIssues={spellingIssues}
            inlineExitCaret={inlineExitCaret}
            onInlineExitTextInput={onInlineExitTextInput}
            onOpenContextMenu={onOpenContextMenu}
          />
        ))}
      </ol>
    );
  }

  if (tagName === "topicref") {
    const href = node.getAttribute("href") || "";
    const displayHref = href || "#???";

    return (
      <div
        className={className}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        title={hrefValidationState?.status === "invalid" ? hrefValidationState.message : undefined}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        onDragEnter={handleHrefDrag}
        onDragOver={handleHrefDrag}
        onDragLeave={() => setIsHrefDragOver(false)}
        onDrop={handleHrefDrop}
        tabIndex={0}
      >
        <div className="topicref-card">
          <span className="topicref-badge">topicref</span>
          <strong className={href ? "" : "topicref-empty"}>
            {renderHighlightedSearchText(displayHref, visualSearchQuery)}
          </strong>
        </div>
        {children.length > 0 && (
          <div className="topicref-children">
            {children.map((child, index) => (
              <VisualNode
                key={`${child.tagName}-${index}`}
                node={child}
                path={[...path, index]}
                selectedPath={selectedPath}
                highlightedPathKey={highlightedPathKey}
                onSelect={onSelect}
                onTextChange={onTextChange}
                onTextNodeChange={onTextNodeChange}
                onTextInput={onTextInput}
                onCaretChange={onCaretChange}
                onListItemEnter={onListItemEnter}
                onParagraphEnter={onParagraphEnter}
                onHrefDrop={onHrefDrop}
                resolveImageHref={resolveImageHref}
                hrefValidationMap={hrefValidationMap}
                pinnedSelection={pinnedSelection}
                visualSearchQuery={visualSearchQuery}
                spellingIssues={spellingIssues}
                inlineExitCaret={inlineExitCaret}
                onInlineExitTextInput={onInlineExitTextInput}
                onOpenContextMenu={onOpenContextMenu}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (hasElementChildren) {
    const MixedTag = getVisualTagForElement(tagName) as any;
    let elementIndex = 0;

    return (
      <MixedTag
        className={className}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        onDragEnter={handleHrefDrag}
        onDragOver={handleHrefDrag}
        onDragLeave={() => setIsHrefDragOver(false)}
        onDrop={handleHrefDrop}
        tabIndex={0}
      >
        {editableTextNodes(node).map((child, childNodeIndex) => {
          if (child.nodeType === Node.TEXT_NODE) {
            return (
              <span
                className={`dita-text-run${(child.textContent || "").trim() ? " has-live-text" : ""}`}
                contentEditable
                spellCheck={false}
                data-node-path={path.join(".")}
                data-text-node-index={childNodeIndex}
                data-placeholder={placeholder}
                suppressContentEditableWarning
                key={`text-${childNodeIndex}`}
                onKeyUp={() => {
                  onCaretChange(getAuthoringSelection());
                }}
                onKeyDown={(event) => handleEditableEnterKeyDown(event, childNodeIndex)}
                onInput={(event) => {
                  const nextText = normalizeEditableInputTarget(event.currentTarget);
                  onTextInput(path, nextText, childNodeIndex);
                }}
                onPaste={handlePlainTextPaste}
                onDoubleClick={handleEditableDoubleClick}
                onMouseDown={handleEditableMouseDown}
                onClick={handleEditableClick}
                onMouseUp={handleEditableMouseUp}
                onFocus={handleEditableFocus}
                onBlur={(event) =>
                  onTextNodeChange(path, childNodeIndex, normalizeEditableBlur(event.currentTarget))
                }
              >
                {renderTextWithVisualHighlights(
                  child.textContent || "",
                  pinnedSelection,
                  path,
                  childNodeIndex,
                  visualSearchQuery,
                  spellingIssues,
                )}
              </span>
            );
          }

          const childElementIndex = elementIndex;
          const childPath = [...path, childElementIndex];
          elementIndex += 1;
          const elementChild = child as Element;
          const showInlineExitCaret =
            inlineExitCaret &&
            pathKeyFor(inlineExitCaret.parentPath) === pathKeyFor(path) &&
            inlineExitCaret.afterElementIndex === childElementIndex;

          return (
            <React.Fragment key={`${elementChild.tagName}-${childNodeIndex}`}>
              <VisualNode
                node={elementChild}
                path={childPath}
                selectedPath={selectedPath}
                highlightedPathKey={highlightedPathKey}
                onSelect={onSelect}
                onTextChange={onTextChange}
                onTextNodeChange={onTextNodeChange}
                onTextInput={onTextInput}
                onCaretChange={onCaretChange}
                onListItemEnter={onListItemEnter}
                onParagraphEnter={onParagraphEnter}
                onHrefDrop={onHrefDrop}
                resolveImageHref={resolveImageHref}
                hrefValidationMap={hrefValidationMap}
                pinnedSelection={pinnedSelection}
                visualSearchQuery={visualSearchQuery}
                spellingIssues={spellingIssues}
                inlineExitCaret={inlineExitCaret}
                onInlineExitTextInput={onInlineExitTextInput}
                onOpenContextMenu={onOpenContextMenu}
              />
              {showInlineExitCaret && (
                <span
                  className="dita-text-run inline-exit-caret"
                  contentEditable
                  spellCheck={false}
                  data-inline-exit-caret="true"
                  data-node-path={path.join(".")}
                  data-text-node-index="-1"
                  suppressContentEditableWarning
                  onMouseDown={handleEditableMouseDown}
                  onClick={handleEditableClick}
                  onMouseUp={handleEditableMouseUp}
                  onFocus={handleEditableFocus}
                  onInput={(event) => {
                    const nextText = normalizeEditableInputTarget(event.currentTarget, true);
                    onInlineExitTextInput(path, childElementIndex, nextText);
                  }}
                  onBlur={() => onInlineExitTextInput(path, childElementIndex, "")}
                >
                  {editableCaretSeed}
                </span>
              )}
            </React.Fragment>
          );
        })}
      </MixedTag>
    );
  }

  const Tag = getVisualTagForElement(tagName) as any;
  const useEditableCaretSeed = (tagName === "cmd" || rendersInline) && !text.trim();
  const allowsTextContent = elementAllowsText(tagName);

  if (tagName === "image") {
    const href = node.getAttribute("href") || "";
    const previewHref = href ? resolveImageHref(href) : "";
    const alt = node.getAttribute("alt") || "DITA image";
    const isInlineImage = node.getAttribute("placement") === "inline";
    const ImageTag = isInlineImage ? "span" : "div";
    const align = node.getAttribute("align") || "";
    const width = toCssLength(node.getAttribute("width"));
    const height = toCssLength(node.getAttribute("height"));
    const scale = node.getAttribute("scale")?.trim();
    const imageStyle: React.CSSProperties = {
      width: width || (scale ? `${scale}%` : undefined),
      height,
    };
    const wrapperStyle: React.CSSProperties = !isInlineImage
      ? {
          marginLeft: align === "center" || align === "right" ? "auto" : undefined,
          marginRight: align === "center" ? "auto" : undefined,
        }
      : {};

    return (
      <ImageTag
        className={className}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        title={hrefValidationState?.status === "invalid" ? hrefValidationState.message : undefined}
        style={wrapperStyle}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        onDragEnter={handleHrefDrag}
        onDragOver={handleHrefDrag}
        onDragLeave={() => setIsHrefDragOver(false)}
        onDrop={handleHrefDrop}
        tabIndex={0}
      >
        {href ? (
          <img src={previewHref} alt={alt} style={imageStyle} />
        ) : (
          <span className="image-placeholder">Drop image or set href</span>
        )}
      </ImageTag>
    );
  }

  if (tagName === "codeblock") {
    return (
      <textarea
        className={className}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        data-placeholder={tagName}
        defaultValue={text}
        placeholder={placeholder}
        spellCheck="false"
        rows={1}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        onInput={(event) => resizeCodeblockTextarea(event.currentTarget)}
        onChange={(event) => onTextInput(path, event.currentTarget.value)}
        onPaste={handleCodeblockPaste}
        ref={(textarea) => {
          if (textarea) {
            resizeCodeblockTextarea(textarea);
          }
        }}
        onBlur={(event) => onTextChange(path, event.currentTarget.value)}
      />
    );
  }

  if (!allowsTextContent && !hasElementChildren) {
    return (
      <Tag
        className={`${className} schema-empty-element`}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        title={hrefValidationState?.status === "invalid" ? hrefValidationState.message : undefined}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        tabIndex={0}
      >
        <span className="dita-empty-element-label">{tagName}</span>
      </Tag>
    );
  }

  if (rendersInline) {
    return (
      <Tag
        className={`${className}${text.trim() ? " has-live-text" : ""}${useEditableCaretSeed ? " editable-empty" : ""}`}
        data-dita-tag={tagName}
        data-node-path={path.join(".")}
        title={hrefValidationState?.status === "invalid" ? hrefValidationState.message : undefined}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(event, path)}
        onDragEnter={isHrefDropTarget ? handleHrefDrag : undefined}
        onDragOver={isHrefDropTarget ? handleHrefDrag : undefined}
        onDragLeave={isHrefDropTarget ? () => setIsHrefDragOver(false) : undefined}
        onDrop={isHrefDropTarget ? handleHrefDrop : undefined}
        tabIndex={0}
      >
        <span
          className={`dita-text-run inline-leaf-editor${text.trim() ? " has-live-text" : ""}${useEditableCaretSeed ? " editable-empty" : ""}`}
          contentEditable
          data-dita-tag={tagName}
          data-editing-element={tagName}
          data-node-path={path.join(".")}
          data-text-node-index={0}
          data-placeholder={placeholder}
          suppressContentEditableWarning
          spellCheck={false}
          onMouseDown={handleEditableMouseDown}
          onClick={handleEditableClick}
          onContextMenu={(event) => onOpenContextMenu(event, path)}
          onDragEnter={isHrefDropTarget ? handleHrefDrag : undefined}
          onDragOver={isHrefDropTarget ? handleHrefDrag : undefined}
          onDragLeave={isHrefDropTarget ? () => setIsHrefDragOver(false) : undefined}
          onDrop={isHrefDropTarget ? handleHrefDrop : undefined}
          onKeyDown={(event) => handleEditableEnterKeyDown(event)}
          onInput={(event) => {
            const nextText = normalizeEditableInputTarget(event.currentTarget, true);
            onTextInput(path, nextText, null);
          }}
          onPaste={handlePlainTextPaste}
          onDoubleClick={handleEditableDoubleClick}
          onFocus={handleEditableFocus}
          onKeyUp={() => {
            onCaretChange(getAuthoringSelection());
          }}
          onMouseUp={handleEditableMouseUp}
          onBlur={(event) => onTextChange(path, normalizeEditableBlur(event.currentTarget))}
        >
          {useEditableCaretSeed ? editableCaretSeed : text}
        </span>
      </Tag>
    );
  }

	  return (
	    <Tag
	      className={`${className}${text.trim() ? " has-live-text" : ""}${useEditableCaretSeed ? " editable-empty" : ""}`}
	      contentEditable
	      data-dita-tag={tagName}
	      data-node-path={path.join(".")}
	      data-text-node-index={0}
	      data-placeholder={placeholder}
	      title={hrefValidationState?.status === "invalid" ? hrefValidationState.message : undefined}
	      suppressContentEditableWarning
	      spellCheck={false}
	      onMouseDown={rendersInline ? handleEditableMouseDown : undefined}
	      onClick={rendersInline ? handleEditableClick : select}
	      onContextMenu={(event) => onOpenContextMenu(event, path)}
	      onDragEnter={isHrefDropTarget ? handleHrefDrag : undefined}
	      onDragOver={isHrefDropTarget ? handleHrefDrag : undefined}
	      onDragLeave={isHrefDropTarget ? () => setIsHrefDragOver(false) : undefined}
	      onDrop={isHrefDropTarget ? handleHrefDrop : undefined}
	      onKeyDown={(event) => handleEditableEnterKeyDown(event)}
	      onInput={(event) => {
	        const nextText = normalizeEditableInputTarget(event.currentTarget, true);
	        onTextInput(path, nextText, null);
	      }}
	      onPaste={handlePlainTextPaste}
	      onDoubleClick={handleEditableDoubleClick}
      onFocus={rendersInline ? handleEditableFocus : undefined}
      onKeyUp={() => {
        onCaretChange(getAuthoringSelection());
      }}
      onMouseUp={rendersInline ? handleEditableMouseUp : () => {
        onCaretChange(getAuthoringSelection());
      }}
      onBlur={(event) => onTextChange(path, normalizeEditableBlur(event.currentTarget))}
    >
      {useEditableCaretSeed
        ? editableCaretSeed
        : renderTextWithVisualHighlights(text, pinnedSelection, path, 0, visualSearchQuery, spellingIssues)}
    </Tag>
  );
}

createRoot(document.getElementById("root")).render(
  <Auth0Provider
    domain="dev-dfnxiq863kzpijxm.us.auth0.com"
    clientId="lePPZLTWDfemOOUGqPsks8ApGjo47RST"
    authorizationParams={{ redirect_uri: window.location.origin }}
  >
    <App />
  </Auth0Provider>,
);
