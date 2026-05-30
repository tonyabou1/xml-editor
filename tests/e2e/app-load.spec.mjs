import { expect, test } from "@playwright/test";
import {
  collectConsoleIssues,
  expectNoFrameworkOverlay,
  expectNoRelevantConsoleIssues,
  getAppState,
  gotoApp,
} from "./helpers/app.mjs";

test("app loads to a meaningful authenticated or sign-in state without framework errors", async ({ page }) => {
  const consoleIssues = collectConsoleIssues(page);

  await gotoApp(page);
  await expect(page).toHaveTitle(/XML|Editor|Vite/i);
  await expectNoFrameworkOverlay(page);

  const appState = await getAppState(page);
  expect(["editor", "signed-out", "syncing-account", "waiting-for-access", "account-error"]).toContain(appState);

  if (appState === "editor") {
    await expect(page.getByTestId("app-shell")).toBeVisible();
  } else if (appState === "signed-out") {
    await expect(page.getByRole("button", { name: "Login" })).toBeVisible();
  }

  await expectNoRelevantConsoleIssues(consoleIssues);
});
