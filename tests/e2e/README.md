# UI Regression Automation

This folder contains Playwright regression tests for the XML/DITA editor.

## Commands

- `npm run test:e2e` runs browser regression tests.
- `npm run test:e2e:headed` runs the same tests with the browser visible.
- `npm run test:e2e:ui` opens the Playwright test runner UI.
- `npm run test:regression` runs typecheck, unit tests, and e2e tests.

By default Playwright starts both the backend and Vite dev server. To use an already running app:

```sh
E2E_SKIP_WEB_SERVER=1 E2E_BASE_URL=http://127.0.0.1:5175 npm run test:e2e
```

## Authenticated Flows

The app uses Auth0, so tests that need the actual editor skip when the browser is not authenticated.
To run the full workflow suite, create a local storage state once:

```sh
npx playwright codegen http://127.0.0.1:5175 --save-storage=playwright/.auth/user.json
```

Sign in during the codegen session, then close it. After that:

```sh
E2E_STORAGE_STATE=playwright/.auth/user.json npm run test:e2e
```

`playwright/.auth/` is ignored by git because it can contain local session tokens.

## Coverage Areas

Current coverage includes:

- App load, sign-in/editor state detection, framework overlay checks, and console health.
- Visual template creation, container and slot creation, preview toggle, and bounded slot dragging.
- Layout panel right alignment versus manual drag boundary behavior.
- Style panel preset colors and color input sizing.
- Tab context menu visibility and split command guard behavior.

Add new specs when a UI bug is fixed. Prefer stable roles and `data-testid` hooks over brittle CSS-only selectors.
