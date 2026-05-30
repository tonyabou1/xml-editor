import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getProjectNodePath,
  getProjectPathParts,
  getRelativeProjectHref,
  isExternalHref,
  normalizeProjectPath,
  resolveProjectHref,
  splitHrefFragment,
} from "../src/utils/path.ts";

describe("project path utilities", () => {
  it("normalizes slashes, dot segments, and content roots consistently", () => {
    assert.equal(normalizeProjectPath("/content//topics/./intro.dita"), "content/topics/intro.dita");
    assert.equal(normalizeProjectPath("content/topics/../assets/logo.png"), "content/assets/logo.png");
    assert.equal(getProjectNodePath(["content", "topics", "intro.dita"]), "content/topics/intro.dita");
    assert.deepEqual(getProjectPathParts("/content/topics/intro.dita"), ["content", "topics", "intro.dita"]);
  });

  it("resolves relative hrefs without disturbing external URLs", () => {
    assert.equal(isExternalHref("https://example.com/topic.dita"), true);
    assert.equal(isExternalHref("data:image/png;base64,abc"), true);
    assert.equal(isExternalHref("../assets/logo.png"), false);
    assert.equal(resolveProjectHref("content/topics/intro.dita", "../assets/logo.png"), "content/assets/logo.png");
    assert.equal(resolveProjectHref("content/topics/intro.dita", "https://example.com/logo.png"), "https://example.com/logo.png");
  });

  it("creates relative hrefs and preserves fragments separately", () => {
    assert.equal(getRelativeProjectHref("content/topics/intro.dita", "content/assets/logo.png"), "../assets/logo.png");
    assert.deepEqual(splitHrefFragment("../topics/intro.dita#overview"), {
      path: "../topics/intro.dita",
      fragment: "#overview",
    });
  });
});
