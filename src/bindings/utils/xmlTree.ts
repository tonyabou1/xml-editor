import type { TemplateBindingOutputMode, TemplateBindingSource } from "./model";

export type XmlBindingTreeNode = {
  id: string;
  name: string;
  xpath: string;
  preview: string;
  depth: number;
  suggestedOutputMode: TemplateBindingOutputMode;
};

export function getXmlBindingTreeNodes(source: TemplateBindingSource | null | undefined, maxNodes = 90) {
  const content = String(source?.content || "").trim();
  if (!content) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "application/xml");
  if (doc.querySelector("parsererror") || !doc.documentElement) return [];

  const nodes: XmlBindingTreeNode[] = [];

  function visit(element: Element, depth: number) {
    if (nodes.length >= maxNodes) return;
    const xpath = getElementXPath(element);
    nodes.push({
      id: xpath,
      name: element.localName || element.nodeName,
      xpath,
      preview: getElementPreview(element),
      depth,
      suggestedOutputMode: getSuggestedOutputMode(element),
    });

    Array.from(element.children).forEach((child) => visit(child, depth + 1));
  }

  visit(doc.documentElement, 0);
  return nodes;
}

function getElementXPath(element: Element) {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current) {
    const localName = current.localName || current.nodeName;
    const position = getSameNameElementIndex(current);
    segments.unshift(`*[local-name()='${escapeXPathLiteral(localName)}'][${position}]`);
    current = current.parentElement;
  }

  return `/${segments.join("/")}`;
}

function getSameNameElementIndex(element: Element) {
  const localName = element.localName || element.nodeName;
  if (!element.parentElement) return 1;
  return Array.from(element.parentElement.children)
    .filter((sibling) => (sibling.localName || sibling.nodeName) === localName)
    .indexOf(element) + 1;
}

function getElementPreview(element: Element) {
  const href = element.getAttribute("href") || element.getAttribute("src");
  const navtitle = element.getAttribute("navtitle");
  const alt = element.getAttribute("alt");
  const text = (element.textContent || "").replace(/\s+/g, " ").trim();
  return href || navtitle || alt || text.slice(0, 90) || "<empty>";
}

function getSuggestedOutputMode(element: Element): TemplateBindingOutputMode {
  const localName = (element.localName || element.nodeName || "").toLowerCase();
  if (localName === "image" || element.hasAttribute("href") || element.hasAttribute("src")) return "imageHref";
  if (localName === "ul" || localName === "ol" || localName === "steps" || localName === "choices") return "fragment";
  return "text";
}

function escapeXPathLiteral(value: string) {
  return String(value || "").replace(/'/g, "&apos;");
}
