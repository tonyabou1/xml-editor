export function getProjectNodePath(pathParts: string[]): string {
  return pathParts.filter(Boolean).join("/");
}

export function getProjectPathParts(path: string): string[] {
  const parts: string[] = [];

  path.split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") {
      parts.pop();
      return;
    }

    parts.push(part);
  });

  return parts;
}

export function normalizeProjectPath(path: string): string {
  return getProjectPathParts(path).join("/");
}

export function isExternalHref(href: string): boolean {
  return /^(https?:|data:|blob:)/i.test(href.trim());
}

export function resolveProjectHref(fromFilePath: string, href: string): string {
  const trimmed = href.trim();
  if (!trimmed || isExternalHref(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return normalizeProjectPath(trimmed.slice(1));

  const fromDirectory = getProjectPathParts(fromFilePath).slice(0, -1).join("/");
  return normalizeProjectPath(`${fromDirectory}/${trimmed}`);
}

export function getRelativeProjectHref(fromFilePath: string, targetPath: string): string {
  const fromDirectoryParts = getProjectPathParts(fromFilePath).slice(0, -1);
  const targetParts = getProjectPathParts(targetPath);
  let sharedIndex = 0;

  while (
    sharedIndex < fromDirectoryParts.length &&
    sharedIndex < targetParts.length &&
    fromDirectoryParts[sharedIndex] === targetParts[sharedIndex]
  ) {
    sharedIndex += 1;
  }

  const upwardParts = fromDirectoryParts.slice(sharedIndex).map(() => "..");
  const downwardParts = targetParts.slice(sharedIndex);
  return [...upwardParts, ...downwardParts].join("/") || targetParts.at(-1) || "";
}

export function splitHrefFragment(href: string) {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) {
    return { path: href, fragment: "" };
  }

  return {
    path: href.slice(0, hashIndex),
    fragment: href.slice(hashIndex),
  };
}
