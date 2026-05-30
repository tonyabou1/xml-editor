export type TemplateBindingStatus = "valid" | "changed" | "unbound" | "unmapped" | "unresolved" | "error";

export type TemplateBindingOutputMode = "text" | "fragment" | "list" | "imageHref";

export type TemplateBindingFingerprint = {
  nodeName: string;
  textSample: string;
};

export type TemplateBindingRule = {
  selector: string;
  outputMode: TemplateBindingOutputMode;
  selectorType: "xpath";
  fingerprint: TemplateBindingFingerprint | null;
};

export type TemplateBindingEvaluation = {
  status: TemplateBindingStatus;
  value: string | string[];
  preview: string;
  count: number;
  nodes: Node[];
  fingerprint?: TemplateBindingFingerprint | null;
};

export type TemplateBindingSource = {
  id?: string;
  name?: string;
  path?: string;
  githubPath?: string;
  href?: string;
  content?: string;
  title?: string;
  shortdesc?: string;
  body?: string[];
  topicrefs?: string[];
  rootName?: string;
};

export type TemplateBindingRegion = {
  binding?: string;
  bindingRule?: Partial<TemplateBindingRule> | null;
};

function parseBindingXml(xml: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const parserError = doc.querySelector("parsererror");
  return {
    doc: parserError ? null : doc,
    error: parserError?.textContent?.trim() || null,
  };
}

export function getVisualTemplateBindingValue(source: TemplateBindingSource | null | undefined, binding = "") {
  if (!source) {
    if (binding === "bodyParagraphs") return [];
    if (binding === "topicrefs") return [];
    return "";
  }

  if (binding === "title") return source.title || source.name || "";
  if (binding === "shortdesc") return source.shortdesc || "";
  if (binding === "bodyParagraphs") return source.body?.length ? source.body : [];
  if (binding === "topicrefs") return source.topicrefs || [];
  if (binding === "rootName") return source.rootName || "";
  if (binding === "path") return source.path || "";
  return "";
}

export function getDefaultVisualTemplateSelector(binding = "") {
  if (binding === "title") return "/*/*[local-name()='title'][1]";
  if (binding === "shortdesc") return "/*/*[local-name()='shortdesc'][1]";
  if (binding === "bodyParagraphs") return "//*[local-name()='body' or local-name()='conbody' or local-name()='taskbody']/*[local-name()='p']";
  if (binding === "topicrefs") return "//*[local-name()='topicref']";
  if (binding === "rootName") return "/*";
  if (binding === "path") return "";
  return "";
}

export function getEmptyVisualTemplateBindingRule(): TemplateBindingRule {
  return {
    selector: "",
    outputMode: "text",
    selectorType: "xpath",
    fingerprint: null,
  };
}

export function getVisualTemplateRegionBindingRule(region?: TemplateBindingRegion | null, useDefaultSelector = true): TemplateBindingRule {
  if (region?.bindingRule && typeof region.bindingRule === "object") {
    return {
      selector: String(region.bindingRule.selector || ""),
      outputMode: getValidOutputMode(region.bindingRule.outputMode),
      selectorType: "xpath",
      fingerprint: region.bindingRule.fingerprint || null,
    };
  }
  if (!useDefaultSelector) return getEmptyVisualTemplateBindingRule();

  const selector = getDefaultVisualTemplateSelector(region?.binding || "");
  return {
    selector,
    outputMode: region?.binding === "bodyParagraphs" || region?.binding === "topicrefs" ? "list" : "text",
    selectorType: "xpath",
    fingerprint: null,
  };
}

export function getVisualTemplateBindingFingerprint(nodes: Node[]): TemplateBindingFingerprint | null {
  const firstNode = nodes[0];
  if (!firstNode) return null;
  const textSample = (firstNode.textContent || firstNode.nodeValue || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return {
    nodeName: firstNode.nodeName || "",
    textSample,
  };
}

export function evaluateVisualTemplateBindingRule(
  source: TemplateBindingSource | null | undefined,
  rule: Partial<TemplateBindingRule> | null | undefined,
): TemplateBindingEvaluation {
  const selector = String(rule?.selector || "").trim();
  const outputMode = getValidOutputMode(rule?.outputMode);
  if (!source) {
    return { status: "unbound", value: "", preview: "No source selected", count: 0, nodes: [] };
  }
  if (!selector) {
    return { status: "unmapped", value: "", preview: "No XPath selector set", count: 0, nodes: [] };
  }

  const content = String(source.content || "");
  const parsedSource = parseBindingXml(content);
  if (!parsedSource.doc) {
    return { status: "error", value: "", preview: parsedSource.error || "Source XML could not be parsed", count: 0, nodes: [] };
  }

  try {
    const snapshot = parsedSource.doc.evaluate(
      selector,
      parsedSource.doc,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const nodes = Array.from({ length: snapshot.snapshotLength }, (_, index) => snapshot.snapshotItem(index))
      .filter((node): node is Node => Boolean(node));
    if (!nodes.length) {
      return { status: "unresolved", value: "", preview: `XPath returned no result: ${selector}`, count: 0, nodes: [] };
    }

    const serializer = new XMLSerializer();
    const values = nodes.map((node) => {
      if (node.nodeType === Node.ATTRIBUTE_NODE) return node.nodeValue || "";
      if (outputMode === "fragment") return serializer.serializeToString(node);
      if (outputMode === "imageHref") {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          return element.getAttribute("href") || element.getAttribute("src") || element.textContent || "";
        }
        return node.nodeValue || node.textContent || "";
      }
      return (node.textContent || node.nodeValue || "").replace(/\s+/g, " ").trim();
    }).filter((value) => String(value || "").trim());
    const value = outputMode === "list" ? values : values[0] || "";
    const fingerprint = getVisualTemplateBindingFingerprint(nodes);
    const savedFingerprint = rule?.fingerprint;
    const hasFingerprintDrift = savedFingerprint && fingerprint && (
      savedFingerprint.nodeName !== fingerprint.nodeName ||
      (
        savedFingerprint.textSample &&
        fingerprint.textSample &&
        savedFingerprint.textSample !== fingerprint.textSample
      )
    );

    return {
      status: hasFingerprintDrift ? "changed" : "valid",
      value,
      preview: hasFingerprintDrift
        ? "XPath still resolves, but the matched content changed. Review and accept the current match if this is correct."
        : Array.isArray(value) ? value.slice(0, 3).join(" · ") : String(value || "No value found"),
      count: nodes.length,
      nodes,
      fingerprint,
    };
  } catch (error) {
    return {
      status: "error",
      value: "",
      preview: error instanceof Error ? error.message : "XPath could not be evaluated",
      count: 0,
      nodes: [],
    };
  }
}

export function getVisualTemplateBindingOptions(source?: TemplateBindingSource | null) {
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

export function getVisualTemplateBindingPreview(source: TemplateBindingSource | null | undefined, binding = "") {
  const value = getVisualTemplateBindingValue(source, binding);
  if (Array.isArray(value)) {
    if (!value.length) return "No values found";
    return value.slice(0, 3).join(" · ");
  }
  return String(value || "No value found");
}

function getValidOutputMode(value: unknown): TemplateBindingOutputMode {
  if (value === "fragment" || value === "list" || value === "imageHref") return value;
  return "text";
}
