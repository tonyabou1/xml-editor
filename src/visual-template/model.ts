export const visualTemplatePageSize = { width: 760, height: 560 };

export const visualTemplateGridDefaults = {
  showGrid: true,
  gridSize: 16,
  snapToGrid: true,
  snapToObjects: true,
  snapThreshold: 4,
  columnGuideCount: 0,
  zoom: 1,
};

export type VisualTemplateResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export type VisualTemplateArtifactType = "template" | "binding" | "node-binding-template";

export function normalizeVisualTemplateArtifactType(value: unknown, fallback: VisualTemplateArtifactType = "template"): VisualTemplateArtifactType {
  return value === "binding" || value === "node-binding-template" || value === "template"
    ? value
    : fallback;
}

export function readVisualTemplateArtifactType(content = ""): VisualTemplateArtifactType | null {
  const text = String(content || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return normalizeVisualTemplateArtifactType(parsed?.artifactType, "template");
  } catch {
    return null;
  }
}

export function getVisualTemplateFileArtifactType(file: any, content = ""): VisualTemplateArtifactType {
  if (file?.ditaType === "visual-template-binding") return "binding";
  if (file?.ditaType === "node-binding-template") return "node-binding-template";

  const name = String(file?.name || file?.githubPath || "").toLowerCase();
  if (name.endsWith(".af-binding.json")) return "binding";
  if (name.endsWith(".af-node-binding.json")) return "node-binding-template";

  return readVisualTemplateArtifactType(content) || "template";
}

export function isVisualTemplateFileName(value = "") {
  const name = String(value || "").toLowerCase();
  return name.endsWith(".af-template.json") ||
    name.endsWith(".af-binding.json") ||
    name.endsWith(".af-node-binding.json");
}

export function isVisualTemplateBindingArtifactType(artifactType: unknown) {
  return artifactType === "binding" || artifactType === "node-binding-template";
}

export function isVisualTemplateStructureLockedArtifactType(artifactType: unknown) {
  return isVisualTemplateBindingArtifactType(artifactType);
}

export const defaultVisualTemplateModel = {
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
      layout: { x: 32, y: 32, width: 704, height: 160, zIndex: 1 },
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
        borderStyle: "solid",
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
      layout: { x: 32, y: 32, width: 464, height: 48, zIndex: 2 },
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
      layout: { x: 32, y: 96, width: 464, height: 48, zIndex: 2 },
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
      layout: { x: 32, y: 208, width: 496, height: 320, zIndex: 1 },
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
        borderStyle: "solid",
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
      layout: { x: 544, y: 208, width: 192, height: 320, zIndex: 1 },
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
        borderStyle: "solid",
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

export const visualTemplateStyleDefaults = {
  layout: {
    x: 40,
    y: 40,
    width: 260,
    height: 160,
    zIndex: 1,
  },
  style: {
    fillMode: "solid",
    backgroundColor: "transparent",
    gradientFrom: "#ffffff",
    gradientTo: "#eef5ff",
    gradientAngle: 135,
    backgroundImage: "",
    backgroundImageMode: "none",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundPositionX: 50,
    backgroundPositionY: 50,
    backgroundRepeat: "no-repeat",
    backgroundOpacity: 100,
    backgroundBlendMode: "normal",
    backgroundFilterBlur: 0,
    backgroundFilterBrightness: 100,
    backgroundFilterContrast: 100,
    backgroundFilterSaturate: 100,
    backgroundFilterGrayscale: 0,
    backgroundOverlayColor: "#000000",
    backgroundOverlayOpacity: 0,
    borderColor: "transparent",
    borderStyle: "solid",
    borderWidth: 0,
    borderRadius: 0,
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

export function normalizeVisualTemplateLayout(layout: any, fallback: any = visualTemplateStyleDefaults.layout) {
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

export function normalizeVisualTemplateGridSettings(settings: any) {
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

export function normalizeVisualTemplateStyle(style: any, fallback: any = {}) {
  return {
    ...fallback,
    ...(style && typeof style === "object" ? style : {}),
  };
}

export function hexToRgbColor(hex = "#000000") {
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

export function rgbaFromHexColor(hex = "#000000", opacity = 100) {
  const { r, g, b } = hexToRgbColor(hex);
  const alpha = Math.max(0, Math.min(100, Number(opacity) || 0)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function cssUrlValue(value = "") {
  const clean = String(value || "").trim();
  if (!clean) return "";
  return `url("${clean.replace(/"/g, "%22")}")`;
}

export function normalizeVisualTemplateModel(rawModel: any) {
  const model = rawModel && typeof rawModel === "object" ? rawModel : {};
  const artifactType = normalizeVisualTemplateArtifactType(model.artifactType);
  const template = model.template && typeof model.template === "object"
    ? model.template
    : defaultVisualTemplateModel.template;
  const defaultRegionsById = new Map(defaultVisualTemplateModel.regions.map((region) => [region.id, region]));
  const regions = Array.isArray(model.regions)
    ? model.regions.map((region) => {
        const isSlot = Boolean(region?.parentId || region?.kind === "slot");
        const fallback = defaultRegionsById.get(region?.id) || {
          id: region?.id || (isSlot ? "slot" : "container"),
          label: isSlot ? "Slot" : "Container",
          kind: isSlot ? "slot" : "container",
          role: "custom",
          binding: "bodyParagraphs",
          notes: "",
          layout: visualTemplateStyleDefaults.layout,
          style: isSlot
            ? {
                ...visualTemplateStyleDefaults.style,
                backgroundColor: "transparent",
                borderRadius: 6,
                padding: 8,
                minHeight: 48,
              }
            : visualTemplateStyleDefaults.style,
          textStyle: visualTemplateStyleDefaults.textStyle,
        };
        const normalizedRegion = {
          ...fallback,
          ...(region && typeof region === "object" ? region : {}),
        };
        const regionSource = region && typeof region === "object" ? region : {};
        const hasOwnStyle = Object.prototype.hasOwnProperty.call(regionSource, "style");
        const hasOwnTextStyle = Object.prototype.hasOwnProperty.call(regionSource, "textStyle");
        return {
          ...normalizedRegion,
          kind: normalizedRegion.kind || (normalizedRegion.parentId ? "slot" : "container"),
          layout: normalizeVisualTemplateLayout(region?.layout, fallback.layout || visualTemplateStyleDefaults.layout),
          style: normalizeVisualTemplateStyle(region?.style, hasOwnStyle ? {} : fallback.style || visualTemplateStyleDefaults.style),
          textStyle: normalizeVisualTemplateStyle(region?.textStyle, hasOwnTextStyle ? {} : fallback.textStyle || visualTemplateStyleDefaults.textStyle),
        };
      })
    : defaultVisualTemplateModel.regions;

  return {
    ...defaultVisualTemplateModel,
    ...model,
    artifactType,
    bindingSources: Array.isArray(model.bindingSources) ? model.bindingSources : [],
    ditaBindingType: typeof model.ditaBindingType === "string" ? model.ditaBindingType : "",
    gridSettings: normalizeVisualTemplateGridSettings(model.gridSettings),
    template,
    regions,
  };
}

export function parseVisualTemplateModel(content: string) {
  try {
    return normalizeVisualTemplateModel(JSON.parse(String(content || "")));
  } catch {
    return normalizeVisualTemplateModel(defaultVisualTemplateModel);
  }
}
