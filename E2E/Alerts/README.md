# Shared alert browser regressions

From `E2E`, run `npm run test-alerts-ui`. Install the repository dependencies and
Playwright Chromium/Firefox browsers first. Use `-- --project=chromium` to run a
single browser. The fixture builds on startup and listens on `127.0.0.1:4211`;
Docker, authentication and a database are not required.

The fixture imports the production `Alert`, `Card` and `Button` components and
uses the repository's bundled Tailwind runtime, production `Theme.css`, and
shared frontend build setup.
All example text and counters are synthetic. The project settings preview is a
small component host, not the authenticated Dashboard or a project deletion
workflow; its delete button deliberately has no side effects.

Tests cover each severity's text/icon and hover contrast in light/dark themes,
title hierarchy, 320/390/1440px
layout, unbroken links and metadata, hidden icons, custom status colors and large
text, native keyboard activation, JSX actions, and dismissal inside a form and
clickable parent. Desktop/mobile gallery and danger-zone screenshots are saved
to `output/playwright/alerts/*-synthetic.png` and attached to the Playwright
results. Failure traces/screenshots live in the adjacent `test-results` folder.

For manual inspection, run `node Alerts/server.js` and open
`http://127.0.0.1:4211/?view=gallery`, `?view=danger` or `?view=regressions`.
Append `&theme=dark` for the actual dashboard dark palette.
Restart the fixture after changing source components before inspecting again.
