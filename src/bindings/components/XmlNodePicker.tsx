import { useMemo } from "react";
import type { TemplateBindingOutputMode, TemplateBindingSource } from "../utils/model";
import { getXmlBindingTreeNodes } from "../utils/xmlTree";

type XmlNodePickerProps = {
  isOpen?: boolean;
  selectedXPath: string;
  source: TemplateBindingSource | null | undefined;
  onSelectNode: (xpath: string, outputMode: TemplateBindingOutputMode) => void;
};

export function XmlNodePicker({ isOpen = false, onSelectNode, selectedXPath, source }: XmlNodePickerProps) {
  const nodes = useMemo(() => getXmlBindingTreeNodes(source), [source?.id, source?.content]);

  return (
    <details className="xml-node-picker" open={isOpen}>
      <summary>Pick from XML</summary>
      {nodes.length ? (
        <div className="xml-node-picker-list">
          {nodes.map((node) => (
            <button
              type="button"
              className={node.xpath === selectedXPath ? "active" : ""}
              key={node.id}
              style={{ "--xml-node-depth": node.depth } as any}
              title={node.xpath}
              onClick={() => onSelectNode(node.xpath, node.suggestedOutputMode)}
            >
              <span>{node.name}</span>
              <small>{node.preview}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="xml-node-picker-empty">No XML nodes found for this source.</p>
      )}
    </details>
  );
}
