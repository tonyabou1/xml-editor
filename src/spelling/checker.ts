export type SpellingIssue = {
  id: string;
  fileId: string | null;
  pathKey: string;
  path: number[];
  childNodeIndex: number;
  startOffset: number;
  endOffset: number;
  word: string;
  suggestions: string[];
  language: string;
};

export type SpellingTextSegment = {
  text: string;
  language: string;
  fileId: string | null;
  path: number[];
  childNodeIndex: number;
};

export const spellingEngineVersion = 3;

const spellingSkipTags = new Set([
  "apiname",
  "codeblock",
  "codeph",
  "cmdname",
  "filepath",
  "msgph",
  "option",
  "parmname",
  "synph",
  "systemoutput",
  "userinput",
  "varname",
]);

const spellingSuggestionMap: Record<string, string[]> = {
  adress: ["address"],
  accomodate: ["accommodate"],
  becuase: ["because"],
  calender: ["calendar"],
  definately: ["definitely"],
  enohgh: ["enough"],
  enviroment: ["environment"],
  fors: ["for"],
  goode: ["good"],
  hte: ["the"],
  iecieve: ["receive"],
  mispelled: ["misspelled"],
  occurance: ["occurrence"],
  recve: ["receive"],
  recieve: ["receive"],
  seperate: ["separate"],
  splling: ["spelling"],
  speling: ["spelling"],
  teh: ["the"],
  thier: ["their"],
  uthis: ["This"],
  wierd: ["weird"],
};

const pathKeyFor = (path: number[]) => path.join(".");

export function isSpellcheckSkippedElement(tagName: string) {
  return spellingSkipTags.has(tagName);
}

export function resolveXmlLanguageForElement(node: Element | null) {
  let current: Element | null = node;

  while (current) {
    const language = current.getAttribute("xml:lang") || current.getAttribute("lang");
    if (language?.trim()) return language.trim();
    current = current.parentElement;
  }

  return "en-US";
}

export function collectSpellingIssuesForText(
  text: string,
  language: string,
  fileId: string | null,
  path: number[],
  childNodeIndex: number,
): SpellingIssue[] {
  if (!language.toLowerCase().startsWith("en")) return [];

  const issues: SpellingIssue[] = [];
  const wordPattern = /\b[\p{L}][\p{L}'-]*\b/gu;

  for (const match of text.matchAll(wordPattern)) {
    const word = match[0];
    const suggestions = spellingSuggestionMap[word.toLowerCase()];
    if (!suggestions) continue;

    const startOffset = match.index || 0;
    issues.push({
      id: `${pathKeyFor(path)}:${childNodeIndex}:${startOffset}:${word.toLowerCase()}`,
      fileId,
      pathKey: pathKeyFor(path),
      path,
      childNodeIndex,
      startOffset,
      endOffset: startOffset + word.length,
      word,
      suggestions,
      language,
    });
  }

  return issues;
}

export function collectSpellingIssuesForDocument(
  root: Element,
  fileId: string | null,
): SpellingIssue[] {
  const issues: SpellingIssue[] = [];

  function visit(node: Element, path: number[]) {
    if (isSpellcheckSkippedElement(node.tagName)) return;

    const elementChildren = Array.from(node.children);
    if (elementChildren.length === 0) {
      issues.push(
        ...collectSpellingIssuesForText(
          node.textContent || "",
          resolveXmlLanguageForElement(node),
          fileId,
          path,
          0,
        ),
      );
      return;
    }

    let elementIndex = 0;
    const editableChildren = Array.from(node.childNodes).filter((child) => {
      return child.nodeType === Node.TEXT_NODE || child.nodeType === Node.ELEMENT_NODE;
    });

    editableChildren.forEach((child, childNodeIndex) => {
      if (child.nodeType === Node.TEXT_NODE) {
        issues.push(
          ...collectSpellingIssuesForText(
            child.textContent || "",
            resolveXmlLanguageForElement(node),
            fileId,
            path,
            childNodeIndex,
          ),
        );
        return;
      }

      visit(child as Element, [...path, elementIndex]);
      elementIndex += 1;
    });
  }

  visit(root, []);
  return issues;
}

export function collectSpellingTextSegmentsForDocument(
  root: Element,
  fileId: string | null,
): SpellingTextSegment[] {
  const segments: SpellingTextSegment[] = [];

  function addSegment(node: Element, path: number[], childNodeIndex: number, text: string | null | undefined) {
    if (!String(text || "").trim()) return;

    segments.push({
      text: text || "",
      language: resolveXmlLanguageForElement(node),
      fileId,
      path,
      childNodeIndex,
    });
  }

  function visit(node: Element, path: number[]) {
    if (isSpellcheckSkippedElement(node.tagName)) return;

    const elementChildren = Array.from(node.children);
    if (elementChildren.length === 0) {
      addSegment(node, path, 0, node.textContent || "");
      return;
    }

    let elementIndex = 0;
    const editableChildren = Array.from(node.childNodes).filter((child) => {
      return child.nodeType === Node.TEXT_NODE || child.nodeType === Node.ELEMENT_NODE;
    });

    editableChildren.forEach((child, childNodeIndex) => {
      if (child.nodeType === Node.TEXT_NODE) {
        addSegment(node, path, childNodeIndex, child.textContent || "");
        return;
      }

      visit(child as Element, [...path, elementIndex]);
      elementIndex += 1;
    });
  }

  visit(root, []);
  return segments;
}
