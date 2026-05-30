import type { ReactNode } from "react";
import {
  evaluateVisualTemplateBindingRule,
  getVisualTemplateRegionBindingRule,
  type TemplateBindingSource,
} from "../utils/model";
import { XmlNodePicker } from "./XmlNodePicker";

type TemplateBindingsPanelProps = {
  boundSources: TemplateBindingSource[];
  closeIcon: ReactNode;
  isCollapsed: boolean;
  isReusableTemplate?: boolean;
  regions: any[];
  selectedRegionId: string | null;
  sources: TemplateBindingSource[];
  getRegionSource: (region: any, sources: TemplateBindingSource[]) => TemplateBindingSource | null;
  getSourceLabel: (source: TemplateBindingSource) => string;
  onAcceptMatch: (regionId: string, fingerprint: unknown) => void;
  onClose: () => void;
  onResetRegion: (regionId: string) => void;
  onSelectRegion: (regionId: string) => void;
  onSetRegionSource: (regionId: string, sourceId: string) => void;
  onUpdateBindingRule: (regionId: string, updates: Record<string, any>) => void;
  onUpdateRegion: (regionId: string, updates: Record<string, any>) => void;
};

export function TemplateBindingsPanel({
  boundSources,
  closeIcon,
  getRegionSource,
  getSourceLabel,
  isCollapsed,
  isReusableTemplate = false,
  onAcceptMatch,
  onClose,
  onResetRegion,
  onSelectRegion,
  onSetRegionSource,
  onUpdateBindingRule,
  onUpdateRegion,
  regions,
  selectedRegionId,
  sources,
}: TemplateBindingsPanelProps) {
  const selectedRegion = regions.find((region) => region.id === selectedRegionId) || null;
  const regionSource = selectedRegion ? getRegionSource(selectedRegion, sources) : null;
  const bindingRule = getVisualTemplateRegionBindingRule(selectedRegion, false);
  const bindingEvaluation = selectedRegion
    ? isReusableTemplate
      ? { status: bindingRule.selector ? "valid" : "unmapped", preview: bindingRule.selector ? "Reusable XPath rule" : "No reusable XPath selector set", count: 0, fingerprint: null }
      : evaluateVisualTemplateBindingRule(regionSource, bindingRule)
    : null;
  const bindingPreview = bindingEvaluation?.preview || "";

  return (
    <aside
      className={`inspector side-panel visual-template-side-panel right-panel${isCollapsed ? " collapsed" : ""}`}
      aria-label="Template bindings panel"
      aria-hidden={isCollapsed ? "true" : undefined}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="panel-title">
        <span>Container Slots</span>
        <div className="panel-title-actions">
          <strong>{regions.length}</strong>
          <button type="button" className="panel-close-button" title="Close panel" aria-label="Close Bindings panel" onClick={onClose}>
            {closeIcon}
          </button>
        </div>
      </div>
      <div className="visual-template-side-content">
        {selectedRegion && bindingEvaluation ? (
            <div className={`visual-binding-row editable selected ${bindingEvaluation.status}`} key={selectedRegion.id}>
              <header>
                <div>
                  <strong>{selectedRegion.label} {selectedRegion.kind === "slot" ? "slot" : "container"}</strong>
                  <small>
                    {selectedRegion.role} layout · {["valid", "changed"].includes(bindingEvaluation.status)
                      ? `${bindingEvaluation.count} match${bindingEvaluation.count === 1 ? "" : "es"}`
                      : bindingEvaluation.status}
                  </small>
                </div>
                {!isReusableTemplate && regionSource ? (
                  <button
                    className="visual-binding-reset"
                    type="button"
                    onClick={() => onResetRegion(selectedRegion.id)}
                  >
                    Reset
                  </button>
                ) : null}
              </header>
              {isReusableTemplate ? (
                <div className="visual-binding-reusable-note">
                  <span>Reusable rule</span>
                  <p>This template stores XPath rules for a DITA type. Drop a matching XML file on the canvas later to create a binding instance.</p>
                </div>
              ) : (
                <label>
                  <span>Source</span>
                  <select
                    value={regionSource?.id || ""}
                    onChange={(event) => onSetRegionSource(selectedRegion.id, event.target.value)}
                  >
                    <option value="">Drop a source file</option>
                    {boundSources.map((source) => (
                      <option value={source.id} key={source.id}>
                        {getSourceLabel(source)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span>XPath</span>
                <input
                  type="text"
                  value={bindingRule.selector}
                  placeholder="/topic/body/ul[2]"
                  onChange={(event) => onUpdateBindingRule(selectedRegion.id, { selector: event.target.value })}
                />
              </label>
              {!isReusableTemplate && regionSource ? (
                <XmlNodePicker
                  isOpen
                  selectedXPath={bindingRule.selector}
                  source={regionSource}
                  onSelectNode={(selector, outputMode) => {
                    onUpdateRegion(selectedRegion.id, { binding: "" });
                    onUpdateBindingRule(selectedRegion.id, {
                      selector,
                      outputMode,
                      fingerprint: null,
                    });
                  }}
                />
              ) : null}
              <label>
                <span>Output</span>
                <select
                  value={bindingRule.outputMode}
                  onChange={(event) => onUpdateBindingRule(selectedRegion.id, { outputMode: event.target.value })}
                >
                  <option value="text">Text</option>
                  <option value="fragment">XML fragment</option>
                  <option value="list">Repeating list</option>
                  <option value="imageHref">Image href</option>
                </select>
              </label>
              <div className={`visual-binding-validation ${bindingEvaluation.status}`}>
                <span>{bindingEvaluation.status === "valid" ? "Resolved" : bindingEvaluation.status === "changed" ? "Review match" : bindingEvaluation.status}</span>
                <p>{bindingEvaluation.preview}</p>
                {!isReusableTemplate && ["valid", "changed"].includes(bindingEvaluation.status) ? (
                  <button
                    type="button"
                    className="visual-binding-accept"
                    onClick={() => {
                      onAcceptMatch(selectedRegion.id, bindingEvaluation.fingerprint);
                    }}
                  >
                    Accept current match
                  </button>
                ) : null}
              </div>
              {!isReusableTemplate && (
                <div className="visual-binding-preview">
                  <span>Preview</span>
                  <p>{bindingPreview}</p>
                </div>
              )}
              <code>
                {isReusableTemplate ? bindingRule.selector || "No XPath rule" : regionSource ? bindingRule.selector || "No XPath rule" : "No source bound"}
              </code>
            </div>
        ) : (
          <div className="visual-binding-empty-state">
            <strong>Select a container or slot</strong>
            <p>Click an object on the canvas to edit its XML binding here.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
