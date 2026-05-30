import { expect, test } from "@playwright/test";
import {
  addContainer,
  addSlot,
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

test("visual template canvas supports container, slot, preview, and bounded slot drag", async ({ page }, testInfo) => {
  const consoleIssues = collectConsoleIssues(page);

  await gotoApp(page);
  await requireEditor(page, testInfo);
  await openBlankVisualTemplate(page);

  const container = await addContainer(page);
  await container.click();
  const slot = await addSlot(page);

  const slotBefore = roundedBox(await boxFor(slot));
  await dragTitleBy(page, slot, 900, 0);
  await dragTitleBy(page, slot, 900, 0);
  const slotAfter = roundedBox(await boxFor(slot));
  const containerBox = roundedBox(await boxFor(container));

  expect(slotAfter.width).toBe(slotBefore.width);
  expect(slotAfter.height).toBe(slotBefore.height);
  expect(slotAfter.x + slotAfter.width).toBeLessThanOrEqual(containerBox.x + containerBox.width + 2);

  await page.getByTestId("visual-template-toolbar").getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("visual-template-page")).toHaveClass(/preview-mode/);
  await page.getByTestId("visual-template-toolbar").getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("visual-template-page")).not.toHaveClass(/preview-mode/);

  await expectNoFrameworkOverlay(page);
  await expectNoRelevantConsoleIssues(consoleIssues);
});
