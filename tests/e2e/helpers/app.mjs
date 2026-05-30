import { expect } from "@playwright/test";

export function collectConsoleIssues(page) {
  const issues = [];
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    issues.push({
      type: message.type(),
      text: message.text(),
    });
  });
  page.on("pageerror", (error) => {
    issues.push({
      type: "pageerror",
      text: error.message,
    });
  });
  return issues;
}

export function relevantConsoleIssues(issues) {
  return issues.filter((issue) => (
    !/Failed to load resource: the server responded with a status of 401/.test(issue.text) &&
    !/ResizeObserver loop completed/.test(issue.text)
  ));
}

export async function gotoApp(page) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("body")).not.toBeEmpty();
}

export async function getAppState(page) {
  if (await page.getByRole("heading", { name: "Sign in to continue" }).isVisible().catch(() => false)) {
    return "signed-out";
  }
  if (await page.getByRole("heading", { name: "Setting up your account" }).isVisible().catch(() => false)) {
    return "syncing-account";
  }
  if (await page.getByRole("heading", { name: "Waiting for access" }).isVisible().catch(() => false)) {
    return "waiting-for-access";
  }
  if (await page.getByRole("heading", { name: "Account setup needs attention" }).isVisible().catch(() => false)) {
    return "account-error";
  }
  if (await page.getByTestId("app-shell").isVisible().catch(() => false)) {
    return "editor";
  }
  return "unknown";
}

export async function requireEditor(page, testInfo) {
  const state = await getAppState(page);
  if (state !== "editor") {
    testInfo.skip(true, `Authenticated editor is not available; current app state is ${state}. Set E2E_STORAGE_STATE to run full UI workflows.`);
  }
}

export async function expectNoFrameworkOverlay(page) {
  await expect(page.locator("text=/Failed to compile|Internal server error|Vite Error|React Refresh|Unhandled Runtime Error/i")).toHaveCount(0);
}

export async function expectNoRelevantConsoleIssues(issues) {
  expect(relevantConsoleIssues(issues)).toEqual([]);
}

export async function openMenuItem(page, topMenu, itemLabel) {
  await page.getByRole("menuitem", { name: topMenu }).click();
  await page.getByRole("menuitem", { name: itemLabel }).click();
}

export async function openNestedMenuItem(page, topMenu, parentLabel, childLabel) {
  await page.getByRole("menuitem", { name: topMenu }).click();
  await page.getByRole("menuitem", { name: parentLabel }).hover();
  await page.getByRole("menuitem", { name: childLabel }).click();
}

export async function openBlankVisualTemplate(page) {
  await openNestedMenuItem(page, "Options", "Visual Templates", "New");
  await expect(page.getByRole("dialog", { name: "New template" })).toBeVisible();
  await page.getByRole("button", { name: /Blank template/i }).click();
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByTestId("visual-template-toolbar")).toBeVisible();
  await expect(page.getByTestId("visual-template-canvas")).toBeVisible();
}

export async function addContainer(page) {
  await page.getByTestId("visual-template-toolbar").getByRole("button", { name: "Add container" }).click();
  const container = page.locator('[data-visual-template-region-kind="container"]').last();
  await expect(container).toBeVisible();
  return container;
}

export async function addSlot(page) {
  await page.getByTestId("visual-template-toolbar").getByRole("button", { name: "Add slot" }).click();
  const slot = page.locator('[data-visual-template-region-kind="slot"]').last();
  await expect(slot).toBeVisible();
  return slot;
}

export async function dragBy(page, locator, deltaX, deltaY) {
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 12 });
  await page.mouse.up();
}

export async function dragTitleBy(page, region, deltaX, deltaY) {
  const title = region.locator(".visual-layout-name").first();
  await dragBy(page, title, deltaX, deltaY);
}

export async function boxFor(locator) {
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  return box;
}

export function roundedBox(box) {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}
