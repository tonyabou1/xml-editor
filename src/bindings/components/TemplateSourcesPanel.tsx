import type { ReactNode } from "react";
import type { TemplateBindingSource } from "../utils/model";

type TemplateSourcesPanelProps = {
  closeIcon: ReactNode;
  isCollapsed: boolean;
  selectedSourceId: string | null;
  sources: TemplateBindingSource[];
  onClose: () => void;
  onRemoveSource: (source: TemplateBindingSource) => void;
  onSelectSource: (sourceId: string) => void;
};

export function TemplateSourcesPanel({
  closeIcon,
  isCollapsed,
  onClose,
  onRemoveSource,
  onSelectSource,
  selectedSourceId,
  sources,
}: TemplateSourcesPanelProps) {
  return (
    <aside
      className={`inspector side-panel visual-template-side-panel right-panel${isCollapsed ? " collapsed" : ""}`}
      aria-label="Dropped files panel"
      aria-hidden={isCollapsed ? "true" : undefined}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="panel-title">
        <span>Dropped Files</span>
        <div className="panel-title-actions">
          <strong>{sources.length}</strong>
          <button type="button" className="panel-close-button" title="Close panel" aria-label="Close Dropped Files panel" onClick={onClose}>
            {closeIcon}
          </button>
        </div>
      </div>
      <div className="visual-template-side-content">
        {sources.length ? (
          sources.map((source) => (
            <div
              className={`visual-template-source-card${selectedSourceId === source.id ? " active" : ""}`}
              key={source.id}
            >
              <button
                type="button"
                className="visual-template-source-main"
                onClick={() => source.id && onSelectSource(source.id)}
              >
                <span>{source.rootName}</span>
                <strong>{source.name}</strong>
                {source.title && source.title !== source.name ? <em>{source.title}</em> : null}
                <small>{source.path}</small>
              </button>
              <button
                type="button"
                className="visual-template-source-remove"
                title={`Remove ${source.title || source.name} from binding sources`}
                aria-label={`Remove ${source.title || source.name} from binding sources`}
                onClick={() => onRemoveSource(source)}
              >
                {closeIcon}
              </button>
            </div>
          ))
        ) : (
          <div className="visual-template-empty-source">
            <strong>No dropped files</strong>
            <p>Drag DITA topics or maps from Explorer onto the canvas to add binding sources here.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
