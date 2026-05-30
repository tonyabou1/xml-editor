import { expect, test } from "@playwright/test";
import {
  addContainer,
  boxFor,
  collectConsoleIssues,
  dragTitleBy,
  expectNoFrameworkOverlay,
  expectNoRelevantConsoleIssues,
  gotoApp,
  openBlankVisualTemplate,
  requireEditor,
  roundedBox,
} from "./helpers/app.mjs";

test("layout right alignment and manual drag use the same true border boundary", async ({ page }, testInfo) => {
  const consoleIssues = collectConsoleIssues(page);

  await gotoApp(page);
  await requireEditor(page, testInfo);
  await openBlankVisualTemplate(page);

  const container = await addContainer(page);
  await container.click();

  await page.getByRole("button", { name: "Toggle Layout panel" }).click();
  await expect(page.getByRole("complementary", { name: "Template layout panel" })).toBeVisible();
  await page.getByRole("button", { name: "Align right" }).click();

  const aligned = roundedBox(await boxFor(container));
  await page.getByRole("button", { name: "Align left" }).click();
  await dragTitleBy(page, container, 2000, 0);
  await dragTitleBy(page, container, 2000, 0);
  const dragged = roundedBox(await boxFor(container));

  expect(Math.abs(dragged.x - aligned.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(dragged.width - aligned.width)).toBeLessThanOrEqual(1);

  await expectNoFrameworkOverlay(page);
  await expectNoRelevantConsoleIssues(consoleIssues);
});
