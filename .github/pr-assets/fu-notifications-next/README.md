# fu-notifications-next: screenshots

Emails rendered by the real `MailService` (production Handlebars helpers and
partials) from a scratch jest harness, opened from disk in headless Chromium
with every request off the disk refused - as a mail client that loads nothing
from the internet shows them - and shot at 2x.

- `uptime-report-640-*.png`, `uptime-report-390-*.png`: the status page uptime
  report (`StatusPageSubscriberReport.hbs`) at 640 and 390 pixels. Before, the
  three supporting tiles drew the number first; after, each names what it
  counts first, as the Average Uptime tile does, and the three sit at the top
  of their strip so their labels line up when a value wraps.
- `report-starter-390-*.png`: the same for the starter a status page is
  offered for its own report template. Its numbers were 24px, wider than a
  phone's tile, so "minutes" broke in two ("minute" over "s"); they are now
  the built-in report's 22px, and the word fits whole.

The sample page has three groups with their rolled-up numbers, as the server
computes them, and four resources.

- `teams-guide-cloud-*.png`: the Microsoft Teams setup guide a server without
  its Teams app shows (`MicrosoftTeamsIntegrationDocumentation`), its settings
  list, rendered by an esbuild harness of the real component with Inter, for
  `MICROSOFT_TEAMS_CLOUD` unset (`commercial`), `gcc-high` (1280 and 390
  pixels) and a value that names no cloud (`no-cloud`). The new line explains
  the setting and says which cloud this server is in, or that Teams is off.
  Its "Azure Government's portal" link opens https://portal.azure.us, and
  Step 2's "Azure Portal" link opens the server's cloud's portal:
  https://portal.azure.com unset, https://portal.azure.us for GCC High.
- `status-page-logo-*.png`: a status page email whose page has an uploaded
  logo. Before, the logo was an address on the installation, which a mail
  client that cannot reach it (or blocks remote images) shows as a broken
  image; after, the logo travels inside the email and shows.
