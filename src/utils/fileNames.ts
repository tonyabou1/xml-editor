import projectNameRules from "../config/projectNameRules.json";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const projectItemNameMaxLength = Math.max(1, Number(projectNameRules.maxNameLength) || 100);
export const projectPathMaxLength = Math.max(projectItemNameMaxLength, Number(projectNameRules.maxPathLength) || 240);

const illegalCharacters = String(projectNameRules.illegalCharacters || "");
const illegalCharacterPattern = illegalCharacters
  ? new RegExp(`[${escapeRegExp(illegalCharacters)}]`, "g")
  : null;
const controlCharacterPattern = /[\u0000-\u001F]/g;
const trailingUnsafePattern = /[\s.]+$/g;
const reservedWindowsNames = new Set(
  (projectNameRules.reservedWindowsNames || []).map((name) => String(name).toUpperCase()),
);
const reservedNameSuffix = String(projectNameRules.reservedNameSuffix || "-item");

function removeIllegalProjectItemCharacters(value: string) {
  const withoutConfiguredCharacters = illegalCharacterPattern
    ? value.replace(illegalCharacterPattern, "")
    : value;
  return projectNameRules.disallowControlCharacters
    ? withoutConfiguredCharacters.replace(controlCharacterPattern, "")
    : withoutConfiguredCharacters;
}

function protectReservedProjectItemName(value: string, maxLength: number) {
  const extensionMatch = value.match(/(\.[^.]*)$/);
  const extension = extensionMatch?.[1] || "";
  const stem = extension ? value.slice(0, -extension.length) : value;

  if (!reservedWindowsNames.has(stem.toUpperCase())) return value;

  const maxStemLength = Math.max(1, maxLength - extension.length);
  return `${`${stem}${reservedNameSuffix}`.slice(0, maxStemLength)}${extension}`;
}

export function sanitizeProjectItemName(
  value: string,
  options: { allowEmpty?: boolean; fallback?: string; maxLength?: number; trimTrailingUnsafe?: boolean } = {},
) {
  const maxLength = Math.max(1, options.maxLength || projectItemNameMaxLength);
  const withoutIllegal = removeIllegalProjectItemCharacters(String(value || ""));
  const cleaned = (options.trimTrailingUnsafe === false
    ? withoutIllegal
    : projectNameRules.trimTrailingSpacesAndDots
    ? withoutIllegal.replace(trailingUnsafePattern, "")
    : withoutIllegal
  ).slice(0, maxLength);

  if (cleaned || options.allowEmpty) {
    return cleaned ? protectReservedProjectItemName(cleaned, maxLength) : cleaned;
  }
  return sanitizeProjectItemName(options.fallback || "Untitled", {
    allowEmpty: false,
    maxLength,
  });
}

export function sanitizeProjectFileNameStem(value: string, extension = "", fallback = "file") {
  const suffix = extension ? `.${extension.replace(/^\./, "")}` : "";
  const maxStemLength = Math.max(1, projectItemNameMaxLength - suffix.length);
  return sanitizeProjectItemName(value, { fallback, maxLength: maxStemLength });
}

export function getProjectPathLengthMessage(path: string) {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath || normalizedPath.length <= projectPathMaxLength) return "";
  return `Path is ${normalizedPath.length} characters. Keep project paths at ${projectPathMaxLength} characters or less for GitHub and cross-platform checkouts.`;
}
