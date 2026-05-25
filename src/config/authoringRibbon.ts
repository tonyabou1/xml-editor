export type RibbonCommand = {
  tag: string;
  label: string;
  icon?: string;
  emphasis?: boolean;
};

export type RibbonGroup = {
  id: string;
  label: string;
  commands: RibbonCommand[];
};

export const authoringRibbonGroups: RibbonGroup[] = [
  {
    id: "text",
    label: "Text",
    commands: [
      { tag: "b", label: "B", icon: "bold", emphasis: true },
      { tag: "i", label: "I", icon: "italic" },
      { tag: "u", label: "U", icon: "underline" },
      { tag: "ph", label: "ph" },
    ],
  },
  {
    id: "headings",
    label: "Headings",
    commands: [
      { tag: "title", label: "title" },
      { tag: "section", label: "section" },
      { tag: "shortdesc", label: "shortdesc" },
    ],
  },
  {
    id: "lists",
    label: "Lists",
    commands: [
      { tag: "ul", label: "ul", icon: "bullet-list" },
      { tag: "ol", label: "ol", icon: "number-list" },
      { tag: "li", label: "li" },
    ],
  },
  {
    id: "dita-elements",
    label: "DITA Elements",
    commands: [
      { tag: "p", label: "p" },
      { tag: "note", label: "note" },
      { tag: "section", label: "section" },
      { tag: "codeblock", label: "codeblock" },
      { tag: "fig", label: "fig" },
      { tag: "image", label: "image", icon: "image" },
    ],
  },
  {
    id: "references",
    label: "References",
    commands: [
      { tag: "xref", label: "xref", icon: "link", emphasis: true },
      { tag: "topicref", label: "topicref", icon: "link" },
      { tag: "image", label: "image", icon: "image" },
    ],
  },
  {
    id: "insert",
    label: "Insert",
    commands: [
      { tag: "table", label: "table", icon: "table" },
      { tag: "simpletable", label: "simpletable", icon: "table" },
      { tag: "dl", label: "dl" },
      { tag: "pre", label: "pre", icon: "screen" },
    ],
  },
];
