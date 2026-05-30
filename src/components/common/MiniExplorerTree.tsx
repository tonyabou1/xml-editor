import { useEffect, useMemo, useRef, useState } from "react";
import { sanitizeProjectItemName } from "../../utils/fileNames";

type ProjectNode = {
  id: string;
  name: string;
  type: "file" | "folder";
  children?: ProjectNode[];
  ditaType?: string;
  githubPath?: string;
  deletedAt?: string | null;
};

type MiniExplorerTreeProps = {
  deletableFolderIds?: string[];
  editableFolderIds?: string[];
  fileTypes?: string[];
  getFileType?: (node: ProjectNode) => string;
  getNodePath?: (node: ProjectNode, pathParts: string[]) => string;
  editingFolderId?: string | null;
  mode?: "files" | "folders" | "all";
  onDeleteFolder?: (node: ProjectNode, path: string) => void;
  onSelectFile?: (node: ProjectNode, path: string) => void;
  onSelectFolder?: (node: ProjectNode, path: string) => void;
  onStartFolderRename?: (nodeId: string) => void;
  onCommitFolderRename?: (nodeId: string, nextName: string) => void;
  onCancelFolderRename?: () => void;
  projectTree: ProjectNode;
  selectedFileId?: string | null;
  selectedFolderId?: string | null;
};

type VisibleNode = ProjectNode & {
  children?: VisibleNode[];
};

function defaultGetFileType(node: ProjectNode) {
  return node.ditaType || "";
}

function defaultGetNodePath(_node: ProjectNode, pathParts: string[]) {
  return pathParts.filter(Boolean).join("/");
}

function filterVisibleTree(
  node: ProjectNode,
  allowedTypes: Set<string> | null,
  getFileType: (node: ProjectNode) => string,
  mode: "files" | "folders" | "all",
): VisibleNode | null {
  if (node.deletedAt) return null;

  if (node.type === "file") {
    if (mode === "folders") return null;
    if (!allowedTypes || allowedTypes.has(getFileType(node))) return node;
    return null;
  }

  const visibleChildren = (node.children || [])
    .map((child) => filterVisibleTree(child, allowedTypes, getFileType, mode))
    .filter((child): child is VisibleNode => Boolean(child));

  if (mode === "folders" || !allowedTypes || visibleChildren.length) {
    return {
      ...node,
      children: visibleChildren,
    };
  }

  return null;
}

function collectFolderIds(node: VisibleNode | null, ids = new Set<string>()) {
  if (!node) return ids;
  if (node.type === "folder") {
    ids.add(node.id);
    (node.children || []).forEach((child) => collectFolderIds(child, ids));
  }
  return ids;
}

function MiniExplorerNameEditor({
  name,
  onCancel,
  onCommit,
}: {
  name: string;
  onCancel: () => void;
  onCommit: (value: string) => void;
}) {
  const safeName = name.trim() || "New Folder";
  const [draft, setDraft] = useState(safeName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commit() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCommit(sanitizeProjectItemName(draft, { fallback: safeName }));
  }

  return (
    <input
      ref={inputRef}
      className="mini-explorer-name-editor"
      aria-label="Edit folder name"
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(sanitizeProjectItemName(event.target.value, { allowEmpty: true, trimTrailingUnsafe: false }))}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }

        if (event.key === "Escape") {
          event.preventDefault();
          finishedRef.current = true;
          onCancel();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}

export function MiniExplorerTree({
  deletableFolderIds = [],
  editableFolderIds = [],
  editingFolderId = null,
  fileTypes,
  getFileType = defaultGetFileType,
  getNodePath = defaultGetNodePath,
  mode = "files",
  onCancelFolderRename,
  onCommitFolderRename,
  onDeleteFolder,
  onSelectFile,
  onSelectFolder,
  onStartFolderRename,
  projectTree,
  selectedFileId = null,
  selectedFolderId = null,
}: MiniExplorerTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set([projectTree.id]));
  const allowedTypes = useMemo(() => (
    fileTypes?.length ? new Set(fileTypes) : null
  ), [fileTypes]);
  const visibleTree = useMemo(() => (
    filterVisibleTree(projectTree, allowedTypes, getFileType, mode)
  ), [allowedTypes, getFileType, mode, projectTree]);

  useEffect(() => {
    setExpandedIds(collectFolderIds(visibleTree));
  }, [visibleTree]);

  function toggleFolder(nodeId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  function renderNode(node: VisibleNode, pathParts: string[], depth: number) {
    const isFolder = node.type === "folder";
    const isExpanded = expandedIds.has(node.id);
    const isEditingFolder = isFolder && editingFolderId === node.id;
    const canDeleteFolder = isFolder && deletableFolderIds.includes(node.id);
    const canRenameFolder = isFolder && editableFolderIds.includes(node.id);
    const displayName = node.name?.trim() || (isFolder ? "New Folder" : "Untitled");
    const currentPathParts = node.id === projectTree.id ? [] : [...pathParts, node.name];
    const nodePath = getNodePath(node, currentPathParts);

    return (
      <div className="mini-explorer-node" key={node.id}>
        <div
          className={`${isFolder ? "folder" : "file"}${selectedFileId === node.id || selectedFolderId === node.id ? " selected" : ""}`}
          role="button"
          tabIndex={0}
          style={{ "--mini-explorer-depth": depth } as any}
          onClick={() => {
            if (isFolder) {
              if (onSelectFolder) {
                onSelectFolder(node, nodePath);
              } else {
                toggleFolder(node.id);
              }
            } else {
              onSelectFile?.(node, nodePath);
            }
          }}
          onDoubleClick={() => {
            if (isFolder && onSelectFolder) {
              toggleFolder(node.id);
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            if (isFolder) {
              if (onSelectFolder) {
                onSelectFolder(node, nodePath);
              } else {
                toggleFolder(node.id);
              }
            } else {
              onSelectFile?.(node, nodePath);
            }
          }}
        >
          <span className="mini-explorer-row-main">
            <span className="mini-explorer-caret" aria-hidden="true">
              {isFolder ? isExpanded ? "v" : ">" : ""}
            </span>
            <span className={`mini-explorer-icon ${isFolder ? "folder" : "file"}`} aria-hidden="true" />
            {isEditingFolder ? (
              <MiniExplorerNameEditor
                name={displayName}
                onCancel={() => onCancelFolderRename?.()}
                onCommit={(nextName) => onCommitFolderRename?.(node.id, nextName)}
              />
            ) : (
              <span
                className={`mini-explorer-name${canRenameFolder ? " editable" : ""}`}
                onDoubleClick={(event) => {
                  if (!canRenameFolder) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onStartFolderRename?.(node.id);
                }}
              >
                {displayName}
              </span>
            )}
          </span>
          {canDeleteFolder && !isEditingFolder ? (
            <button
              type="button"
              className="mini-explorer-delete-folder"
              aria-label={`Delete ${displayName}`}
              title="Delete folder"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDeleteFolder?.(node, nodePath);
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                <path d="M5 7h14" />
                <path d="M9 7V5h6v2" />
                <path d="M8 10v8" />
                <path d="M12 10v8" />
                <path d="M16 10v8" />
                <path d="M7 7l1 13h8l1-13" />
              </svg>
            </button>
          ) : null}
        </div>
        {isFolder && isExpanded && node.children?.map((child) => renderNode(child, currentPathParts, depth + 1))}
      </div>
    );
  }

  if (!visibleTree) {
    return (
      <div className="mini-explorer-tree empty">
        <strong>No matching files</strong>
      </div>
    );
  }

  return (
    <div className="mini-explorer-tree">
      {renderNode(visibleTree, [], 0)}
    </div>
  );
}
