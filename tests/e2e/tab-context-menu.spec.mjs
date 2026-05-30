import { expect, test } from "@playwright/test";
import {
  collectConsoleIssues,
  expectNoFrameworkOverlay,
  expectNoRelevantConsoleIssues,
  gotoApp,
  openBlankVisualTemplate,
  requireEditor,
} from "./helpers/app.mjs";

test("tab context menu opens cleanly and disables duplicate split actions for a unique template tab", async ({ page }, testInfo) => {
  const consoleIssues = collectConsoleIssues(page);

  await gotoApp(page);
  await requireEditor(page, testInfo);
  await openBlankVisualTemplate(page);

  const templateTab = page.getByTestId("file-tab").filter({ hasText: "Visual Template" }).first();
  await expect(templateTab).toBeVisible();
  await templateTab.click({ button: "right" });

  const menu = page.getByRole("menu", { name: /Tab actions for Visual Template/i });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Split Right" })).toBeDisabled();
  await expect(menu.getByRole("button", { name: "Split Down" })).toBeDisabled();
  await expect(menu.getByRole("button", { name: "Split & Move" })).toBeDisabled();

  await page.keyboard.press("Escape");
  await expectNoFrameworkOverlay(page);
  await expectNoRelevantConsoleIssues(consoleIssues);
});
