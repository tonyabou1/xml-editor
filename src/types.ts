export type AttributeDefinition = {
  name: string;
  label: string;
  placeholder?: string;
  values?: string[];
};

export type ElementDefinition = {
  name?: string;
  children: string[];
  attributes?: AttributeDefinition[];
  allowsText?: boolean;
  baseName?: string;
  childOrder?: string[];
  classChain?: string;
  contentRefs?: string[];
  inline?: boolean;
  inlineContainer?: boolean;
  orderedChildren?: boolean;
  requiredChildren?: string[];
  sourceFiles?: string[];
  template?: string;
  uniqueChildren?: string[];
};

export type DitaSchemaProfile = {
  fileTypes: Array<{ key: string; label: string; extension: string }>;
  rootElements: string[];
  elements: Record<string, ElementDefinition>;
};

export type HrefValidationState = {
  pathKey: string;
  status: "valid" | "invalid";
  message: string;
  value: string;
};

export type HrefValidationMap = Record<string, HrefValidationState>;

export type ChatMessage = {
  id?: string;
  role: "assistant" | "user";
  text: string;
};

export type AiContext = {
  activeFileName: string;
  activeFilePath: string;
  branchName: string;
  repositoryName: string;
  mode: string;
  topicType: string;
  selectedElementName: string | null;
  selectedElementPath: string;
  selectedElementText: string;
  allowedChildren: string[];
  allowedSiblings: string[];
  attributes: Array<{ name: string; value: string }>;
  validation: {
    status: ValidationState["status"];
    errorCount: number;
    warningCount: number;
    messages: string[];
  };
  inventory: Array<{ name: string; count: number }>;
  paragraphs: Array<{ path: string; words: number; preview: string }>;
};

export type LeanDitaContext = {
  activeFileName: string;
  topicType: string;
  title: string;
  existingShortdesc: string;
  summaryKind: "concept" | "task" | "reference" | "map" | "topic";
  paragraphs: Array<{ path: string; words: number; preview: string }>;
  sections?: Array<{ path: string; title: string; words: number }>;
  steps?: Array<{ path: string; command: string; words: number }>;
  referenceBlocks?: Array<{ path: string; tagName: string; preview: string }>;
  topicrefs?: Array<{ path: string; href: string; navtitle: string; depth: number }>;
  inventory: Array<{ name: string; count: number }>;
  validation: AiContext["validation"];
};

export type AiOperation =
  | {
      type: "insert_element";
      placement: "after" | "child";
      targetPath: number[];
      tagName: string;
      text?: string;
      attributes?: Record<string, string>;
    }
  | {
      type: "set_attribute";
      targetPath: number[];
      name: string;
      value: string;
    }
  | {
      type: "replace_text";
      targetPath: number[];
      text: string;
    }
  | {
      type: "replace_range";
      targetPath: number[];
      childNodeIndex: number;
      startOffset: number;
      endOffset: number;
      text: string;
    };

export type AiSuggestion = {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  body: string;
  targetPath?: string;
  operation?: AiOperation;
};

export type NotificationSeverity = "error" | "info" | "warning";

export type AppNotification = {
  id: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  createdAt: string;
  persistent?: boolean;
  source?: string;
  toastDismissed?: boolean;
};

export type SidePanelId = "inspector" | "schema" | "search" | "chat" | "aiReview" | "github" | "notifications" | "help" | "templateSources" | "templateBindings" | "templateLayers" | "templateLayout" | "templateStyle";
export type AppMenuCommand = "createVisualTemplate" | "customizeAuthoring" | "importFile" | "importVisualTemplate" | "openVisualTemplate" | "undo" | "redo" | "preferences" | "specializations" | "uploadVisualTemplate" | "viewTerminal" | "visualTemplates";

export type AppMenuItem = {
  id: string;
  label: string;
  command?: AppMenuCommand;
  documentType?: string;
  disabled?: boolean;
  icon?: "import" | "preferences" | "redo" | "schema" | "terminal" | "undo" | "placeholder";
  children?: AppMenuItem[];
};

export type AppMenuDefinition = {
  id: string;
  label: string;
  items: AppMenuItem[];
};

export type SearchResult = {
  id: string;
  fileId: string;
  fileName: string;
  filePath: string;
  fileKind: string;
  kind: "file" | "text";
  label: string;
  detail: string;
  snippet: string;
  line?: number;
  isOpen: boolean;
};

export type ValidationState = {
  status: "idle" | "validating" | "valid" | "invalid" | "error";
  message: string;
  runId?: string;
  validatedAt?: string;
};

export type ValidationRun = {
  id: string;
  fileId: string;
  fileName: string;
  filePath: string;
  status: "valid" | "invalid" | "error";
  validatedAt: string;
  report: string;
  output: string;
  issues: Array<{
    level?: string;
    file?: string;
    line?: number;
    column?: number;
    message?: string;
    raw?: string;
  }>;
};

export type TerminalMessage = {
  id: string;
  createdAt: string;
  level: "error" | "info" | "warning";
  message: string;
  source: string;
};

export type AppAccount = {
  user: {
    id: string;
    email: string;
    display_name: string;
    auth_provider: string;
    auth_subject: string;
  };
  memberships: Array<{
    organization_id: string;
    organization_name: string;
    organization_slug: string;
    team_id: string;
    team_name: string;
    team_slug: string;
    role_id: string | null;
    role_name: string | null;
    permissions: string[];
  }>;
  access: "granted" | "pending";
  bootstrappedOwner: boolean;
};

export type GitHubRepository = {
  githubRepositoryId?: number;
  fullName: string;
  ownerLogin?: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  pushedAt?: string;
  updatedAt?: string;
};

export type GitHubStatus = {
  configured: boolean;
  connected: boolean;
  connection: {
    github_login: string;
    scope: string;
    connected_at: string;
    updated_at: string;
  } | null;
  selectedRepository: {
    full_name: string;
    owner_login: string;
    name: string;
    default_branch: string;
    selected_branch?: string;
    private: boolean;
    html_url: string;
    selected_at: string;
  } | null;
};

export type GitBranch = {
  name: string;
  sha: string;
  protected: boolean;
  active: boolean;
};

export type GitCommitSummary = {
  sha: string;
  shortSha: string;
  headline: string;
  message: string;
  authorName: string;
  authorLogin: string;
  authoredAt: string;
  committedAt: string;
  htmlUrl: string;
};

export type GitLocalCommitFile = {
  filePath: string;
  githubSha?: string | null;
  draftContentHash?: string;
  contentFormat?: string;
  sizeBytes?: number;
  changeType?: "delete" | "upsert";
};

export type GitLocalCommit = {
  id: string;
  branch_name: string;
  message: string;
  status: "pending" | "published" | "failed";
  github_commit_sha?: string | null;
  github_commit_url?: string | null;
  error_message?: string | null;
  created_at: string;
  published_at?: string | null;
  files: GitLocalCommitFile[];
};

export type GitConflictPayload = {
  filePath: string;
  fileId?: string;
  fileName: string;
  sample?: boolean;
  sampleExpectInvalid?: boolean;
  baseSha?: string;
  currentSha?: string;
  remoteContent: string;
  remoteContentHash?: string;
  localContent: string;
  localContentHash?: string;
  message: string;
};

export type FileGitHistoryPayload = {
  fileId: string;
  fileName: string;
  filePath: string;
  branch: string;
  commits: GitCommitSummary[];
  loadedAt: string;
};

export type GitHubTreeEntry = {
  path: string;
  type: "file" | "folder";
  sha?: string;
  size?: number;
  ditaType?: string;
  draftDirty?: boolean;
  draftSavedAt?: string | null;
  deletedAt?: string | null;
  sourceContentHash?: string;
  draftContentHash?: string;
};

export type DraftSaveState = {
  status: "idle" | "pending" | "saving" | "saved" | "error";
  message: string;
};
