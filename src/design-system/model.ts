export type DesignTokenType =
  | "color"
  | "space"
  | "radius"
  | "border"
  | "shadow"
  | "font-size"
  | "font-family"
  | "font-weight"
  | "number"
  | "asset";

export type StyleClassTarget = "container" | "slot" | "dita" | "both";

export type DesignToken = {
  id?: string;
  key: string;
  type: DesignTokenType;
  value: string;
  description?: string;
};

export type StyleClass = {
  id?: string;
  key: string;
  displayName: string;
  description?: string;
  appliesTo: StyleClassTarget;
  style: Record<string, unknown>;
  styleOrder?: string[];
  textStyle: Record<string, unknown>;
  textStyleOrder?: string[];
};

export type DesignSystem = {
  tokens: DesignToken[];
  styleClasses: StyleClass[];
};

export const fallbackDesignSystem: DesignSystem = {
  tokens: [
    { key: "color.brand.primary", type: "color", value: "#5454c9" },
    { key: "color.surface.page", type: "color", value: "#ffffff" },
    { key: "color.border.soft", type: "color", value: "#c7d3e7" },
    { key: "color.text.primary", type: "color", value: "#172033" },
    { key: "color.text.muted", type: "color", value: "#667085" },
    { key: "space.region", type: "space", value: "14px" },
    { key: "radius.region", type: "radius", value: "8px" },
    { key: "font.family.body", type: "font-family", value: "Inter" },
    { key: "font.size.body", type: "font-size", value: "13px" },
    { key: "font.weight.regular", type: "font-weight", value: "400" },
    { key: "font.weight.semibold", type: "font-weight", value: "600" },
  ],
  styleClasses: [],
};

export function normalizeDesignSystem(raw: unknown): DesignSystem {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const tokens = Array.isArray(source.tokens)
    ? source.tokens
        .filter((token): token is Record<string, unknown> => Boolean(token && typeof token === "object"))
        .map((token) => ({
          id: typeof token.id === "string" ? token.id : undefined,
          key: String(token.key || ""),
          type: normalizeDesignTokenType(token.type),
          value: String(token.value ?? ""),
          description: typeof token.description === "string" ? token.description : "",
        }))
        .filter((token) => token.key && token.value)
    : fallbackDesignSystem.tokens;
  const styleClasses = Array.isArray(source.styleClasses)
    ? source.styleClasses
        .filter((styleClass): styleClass is Record<string, unknown> => Boolean(styleClass && typeof styleClass === "object"))
        .map((styleClass) => ({
          id: typeof styleClass.id === "string" ? styleClass.id : undefined,
          key: String(styleClass.key || ""),
          displayName: String(styleClass.displayName || styleClass.key || ""),
          description: typeof styleClass.description === "string" ? styleClass.description : "",
          appliesTo: String(styleClass.appliesTo || "both") as StyleClassTarget,
          style: styleClass.style && typeof styleClass.style === "object" && !Array.isArray(styleClass.style)
            ? styleClass.style as Record<string, unknown>
            : {},
          styleOrder: Array.isArray(styleClass.styleOrder)
            ? styleClass.styleOrder.map((item) => String(item)).filter(Boolean)
            : styleClass.style && typeof styleClass.style === "object" && !Array.isArray(styleClass.style)
              ? Object.keys(styleClass.style as Record<string, unknown>)
              : [],
          textStyle: styleClass.textStyle && typeof styleClass.textStyle === "object" && !Array.isArray(styleClass.textStyle)
            ? styleClass.textStyle as Record<string, unknown>
            : {},
          textStyleOrder: Array.isArray(styleClass.textStyleOrder)
            ? styleClass.textStyleOrder.map((item) => String(item)).filter(Boolean)
            : styleClass.textStyle && typeof styleClass.textStyle === "object" && !Array.isArray(styleClass.textStyle)
              ? Object.keys(styleClass.textStyle as Record<string, unknown>)
              : [],
        }))
        .filter((styleClass) => styleClass.key && styleClass.displayName)
    : fallbackDesignSystem.styleClasses;

  return { tokens, styleClasses };
}

function normalizeDesignTokenType(value: unknown): DesignTokenType {
  const tokenType = String(value || "number");
  if (tokenType === "font") return "font-family";
  if (tokenType === "typography") return "font-size";
  return tokenType as DesignTokenType;
}

export function getTokenMap(tokens: DesignToken[]) {
  return new Map(tokens.map((token) => [token.key, token]));
}

export function resolveTokenValue(value: unknown, tokensByKey: Map<string, DesignToken>): unknown {
  if (typeof value !== "string") return value;
  const clean = value.trim();
  const tokenReference = clean.match(/^token\(([^)]+)\)$/)?.[1]?.trim() || clean;
  return tokensByKey.get(tokenReference)?.value ?? value;
}

export function resolveStyleTokens(style: Record<string, unknown>, tokensByKey: Map<string, DesignToken>) {
  return Object.fromEntries(
    Object.entries(style || {}).map(([key, value]) => [key, resolveTokenValue(value, tokensByKey)]),
  );
}

export function getStyleClassForRegion(region: { kind?: string; styleClassId?: string } | null | undefined, styleClasses: StyleClass[]) {
  if (!region?.styleClassId) return null;
  return styleClasses.find((styleClass) => (
    styleClass.key === region.styleClassId &&
    (styleClass.appliesTo === "both" || styleClass.appliesTo === region.kind)
  )) || null;
}

export function getStyleClassesForRegionKind(kind: string | undefined, styleClasses: StyleClass[]) {
  return styleClasses.filter((styleClass) => (
    styleClass.appliesTo === "both" || styleClass.appliesTo === kind
  ));
}
