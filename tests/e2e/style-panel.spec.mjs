import { expect, test } from "@playwright/test";
import {
  addContainer,
  boxFor,
  collectConsoleIssues,
  expectNoFrameworkOverlay,
  expectNoRelevantConsoleIssues,
  gotoApp,
  openBlankVisualTemplate,
  requireEditor,
} from "./helpers/app.mjs";

test("style panel color presets keep the color input compact", async ({ page }, testInfo) => {
  const consoleIssues = collectConsoleIssues(page);

  await gotoApp(page);
  await requireEditor(page, testInfo);
  await openBlankVisualTemplate(page);

  const container = await addContainer(page);
  await container.click();

  await page.getByRole("button", { name: "Toggle Style panel" }).click();
  await expect(page.getByRole("complementary", { name: "Template style panel" })).toBeVisible();

  const backgroundPreset = page.getByLabel("Set Background to #2f6ce5");
  const colorInput = page.getByRole("complementary", { name: "Template style panel" }).locator('input[type="color"]').first();
  const before = await boxFor(colorInput);
  await backgroundPreset.click();
  const after = await boxFor(colorInput);

  expect(after.height).toBeLessThanOrEqual(before.height + 2);
  expect(after.height).toBeLessThan(50);
  expect(after.width).toBeGreaterThanOrEqual(34);
  expect(after.width).toBeLessThanOrEqual(44);
  await expect(container).toHaveCSS("background-color", "rgb(47, 108, 229)");

  await expectNoFrameworkOverlay(page);
  await expectNoRelevantConsoleIssues(consoleIssues);
});
