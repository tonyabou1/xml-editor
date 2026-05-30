import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getVisualTemplateFileArtifactType,
  isVisualTemplateBindingArtifactType,
  isVisualTemplateFileName,
  isVisualTemplateStructureLockedArtifactType,
  normalizeVisualTemplateGridSettings,
  normalizeVisualTemplateLayout,
  normalizeVisualTemplateModel,
  parseVisualTemplateModel,
} from "../src/visual-template/model.ts";

describe("visual template model", () => {
  it("classifies template artifact files from metadata and filenames", () => {
    assert.equal(getVisualTemplateFileArtifactType({ ditaType: "node-binding-template" }), "node-binding-template");
    assert.equal(getVisualTemplateFileArtifactType({ name: "hero.af-binding.json" }), "binding");
    assert.equal(getVisualTemplateFileArtifactType({ githubPath: "templates/page.af-template.json" }), "template");
    assert.equal(isVisualTemplateFileName("page.af-node-binding.json"), true);
    assert.equal(isVisualTemplateBindingArtifactType("node-binding-template"), true);
    assert.equal(isVisualTemplateStructureLockedArtifactType("binding"), true);
  });

  it("normalizes layout and grid bounds", () => {
    assert.deepEqual(
      normalizeVisualTemplateLayout({ x: "12", y: "24", width: "320", height: "180", zIndex: "3" }),
      { x: 12, y: 24, width: 320, height: 180, zIndex: 3 },
    );
    assert.deepEqual(
      normalizeVisualTemplateGridSettings({ gridSize: 99, snapThreshold: 99, columnGuideCount: 7, zoom: 20 }),
      {
        showGrid: true,
        gridSize: 16,
        snapToGrid: true,
        snapToObjects: true,
        snapThreshold: 16,
        columnGuideCount: 0,
        zoom: 4,
      },
    );
  });

  it("preserves explicit sparse text styles on saved regions", () => {
    const model = normalizeVisualTemplateModel({
      artifactType: "node-binding-template",
      regions: [
        {
          id: "hero",
          label: "Hero",
          kind: "container",
          layout: { x: 1, y: 2, width: 300, height: 100 },
          style: { backgroundColor: "#00ff00" },
          textStyle: { fontWeight: 800 },
        },
      ],
    });

    assert.equal(model.artifactType, "node-binding-template");
    assert.equal(model.regions[0].style.backgroundColor, "#00ff00");
    assert.equal(model.regions[0].textStyle.fontWeight, 800);
    assert.equal(Object.hasOwn(model.regions[0].textStyle, "fontSize"), false);
  });

  it("falls back to a valid template model for invalid JSON", () => {
    const model = parseVisualTemplateModel("{");
    assert.equal(model.artifactType, "template");
    assert.ok(model.regions.length > 0);
  });
});
