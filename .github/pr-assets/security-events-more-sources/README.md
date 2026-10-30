# Security Events: more sources

How these were made: the Security Events empty states fixture
(`packages/E2E/SecurityEventsEmptyStates`, the real Connections and Security Events pages with the
data boundary stubbed) built from this branch, with the Dashboard's own Tailwind runtime,
`tailwind-reading-direction.js`, Inter and Theme.css, the clock pinned to the fixture's
2026-09-22 12:00 UTC, and a Dashboard locale loaded for the German and Persian shots. Headless
Chromium, 2x. They are not screenshots of a running stack.

- `your-logs.png`: Your logs on Connections, on, at 1280: the ten kinds grouped as Servers, Cloud,
  Security devices and Applications, each saying what the last check found of it, when one was
  last found, or that none has been yet.
- `your-logs-768.png`: the same card beside the side menu at a 768 window, where it is about
  370px wide: one column, taken from the card's width.
- `your-logs-phone.png`: 390px: a kind's name and its health, its sentence left out.
- `your-logs-dark.png`: the dark theme.
- `your-logs-de.png`: German.
- `check-a-log-line.png`: Check a log line, opened, on the CEF example: one High Detection
  Finding, "SQL injection from 203.0.113.7 to 10.0.0.5:443 (block)". The line is read in the
  browser by the scan's own parsers, and nothing is saved or sent.
- `check-a-log-line-fa.png`: Persian, right to left, on the LEEF example.
- `connections-ten-products.png`: Connections with no connection yet, at 1440: Microsoft Entra
  ID and Google Workspace join the eight products, with their official marks.
- `add-connection-entra-polling.png`: Add connection for Microsoft Entra ID, on its Polling step:
  the Microsoft 365 audit log option.
- `add-connection-workspace.png`: Add connection for Google Workspace, on its Connection step.
- `events-empty-state-phone.png`: the Security Events empty state at 390: the ten kinds Your logs
  reads, each kept whole on a line.
