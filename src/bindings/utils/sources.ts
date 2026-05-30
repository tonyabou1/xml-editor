import type { TemplateBindingSource } from "./model";

type ProjectFileEntry = {
  node: any;
  path: string;
};

type CreateTemplateBindingSourceOptions = {
  getFileContent: (node: any) => string;
  normalizePath: (value: string) => string;
  parseXml: (xml: string) => { doc: Document | null };
};

export function createTemplateBindingSourceFromFile(
  { node, path }: ProjectFileEntry,
  { getFileContent, normalizePath, parseXml }: CreateTemplateBindingSourceOptions,
): TemplateBindingSource {
  const normalizedPath = normalizePath(path || node.githubPath || node.name || "");
  const content = getFileContent(node);
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
    githubPath: normalizePath(node.githubPath || ""),
    content,
    rootName,
    title,
    shortdesc,
    body,
    topicrefs,
  };
}

export function getTemplateBindingPathVariants(value = "", normalizePath: (value: string) => string) {
  const normalized = normalizePath(value);
  const withoutContentRoot = normalized.replace(/^content\//, "");
  const withContentRoot = withoutContentRoot ? normalizePath(`content/${withoutContentRoot}`) : "";
  return new Set([normalized, withoutContentRoot, withContentRoot].filter(Boolean));
}

export function templateBindingSourceMatchesDrop(
  source: TemplateBindingSource | null | undefined,
  droppedSource: any,
  normalizePath: (value: string) => string,
) {
  if (!source || !droppedSource) return false;
  if (source.id && droppedSource.id && source.id === droppedSource.id) return true;

  const sourcePaths = new Set([
    ...getTemplateBindingPathVariants(source.path, normalizePath),
    ...getTemplateBindingPathVariants(source.githubPath, normalizePath),
    ...getTemplateBindingPathVariants(source.href, normalizePath),
  ]);
  const droppedPaths = [
    ...getTemplateBindingPathVariants(droppedSource.path, normalizePath),
    ...getTemplateBindingPathVariants(droppedSource.githubPath, normalizePath),
    ...getTemplateBindingPathVariants(droppedSource.href, normalizePath),
  ];

  return droppedPaths.some((path) => sourcePaths.has(path));
}

export function findTemplateBindingSourceForDrop(
  droppedSource: any,
  sources: TemplateBindingSource[],
  normalizePath: (value: string) => string,
) {
  return sources.find((source) => templateBindingSourceMatchesDrop(source, droppedSource, normalizePath)) || null;
}

export function getTemplateBindingSourceLabel(source: TemplateBindingSource | null | undefined) {
  if (!source) return "";
  const title = source.title && source.title !== source.name ? ` — ${source.title}` : "";
  return `${source.name}${title}`;
}
