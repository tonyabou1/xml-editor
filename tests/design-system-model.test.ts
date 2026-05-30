import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getStyleClassForRegion,
  getStyleClassesForRegionKind,
  getTokenMap,
  normalizeDesignSystem,
  resolveStyleTokens,
} from "../src/design-system/model.ts";

describe("design system model", () => {
  it("normalizes malformed design-system input with fallback tokens and usable style classes", () => {
    const normalized = normalizeDesignSystem({
      tokens: "bad",
      styleClasses: [{ key: "hero", displayName: "Hero", appliesTo: "container" }],
    });

    assert.ok(normalized.tokens.some((token) => token.key === "color.brand.primary"));
    assert.equal(normalized.styleClasses[0].key, "hero");
    assert.equal(normalized.styleClasses[0].appliesTo, "container");
  });

  it("resolves token references inside style maps", () => {
    const tokensByKey = getTokenMap([
      { key: "color.brand", name: "Brand", type: "color", value: "#123456" },
      { key: "space.md", name: "Medium", type: "space", value: "16px" },
    ]);

    assert.deepEqual(resolveStyleTokens({ color: "color.brand", padding: "space.md", border: "1px" }, tokensByKey), {
      color: "#123456",
      padding: "16px",
      border: "1px",
    });
  });

  it("filters and selects style classes by region kind", () => {
    const classes = normalizeDesignSystem({
      styleClasses: [
        { key: "hero", displayName: "Hero", appliesTo: "container" },
        { key: "caption", displayName: "Caption", appliesTo: "slot" },
        { key: "universal", displayName: "Universal", appliesTo: "both" },
      ],
    }).styleClasses;

    assert.deepEqual(getStyleClassesForRegionKind("container", classes).map((item) => item.key), ["hero", "universal"]);
    assert.equal(getStyleClassForRegion({ kind: "container", styleClassId: "hero" }, classes)?.key, "hero");
    assert.equal(getStyleClassForRegion({ kind: "slot", styleClassId: "hero" }, classes), null);
  });
});
