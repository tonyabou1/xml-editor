import type { AppMenuDefinition } from "../types";

export const appMenus: AppMenuDefinition[] = [
  {
    id: "file",
    label: "File",
    items: [
      { id: "import-file", label: "Import File", command: "importFile", icon: "import" },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    items: [
      { id: "undo", label: "Undo", command: "undo", icon: "undo" },
      { id: "redo", label: "Redo", command: "redo", icon: "redo" },
    ],
  },
  {
    id: "view",
    label: "View",
    items: [
      { id: "view-terminal", label: "View Terminal", command: "viewTerminal", icon: "terminal" },
    ],
  },
  { id: "map", label: "Map", items: [{ id: "map-empty", label: "No commands yet", disabled: true }] },
  {
    id: "options",
    label: "Options",
    items: [
      { id: "preferences", label: "Preferences", command: "preferences", icon: "preferences" },
      { id: "specializations", label: "Specializations...", command: "specializations", icon: "schema" },
      {
        id: "visual-templates",
        label: "Visual Templates",
        icon: "schema",
        children: [
          { id: "create-visual-template", label: "New", command: "createVisualTemplate", icon: "schema" },
          { id: "open-visual-template", label: "Open...", command: "openVisualTemplate", icon: "schema" },
          { id: "upload-visual-template", label: "Upload...", command: "uploadVisualTemplate", icon: "import" },
          { id: "import-visual-template", label: "Import...", command: "importVisualTemplate", icon: "import" },
        ],
      },
    ],
  },
  { id: "help", label: "Help", items: [{ id: "help-empty", label: "No commands yet", disabled: true }] },
];
