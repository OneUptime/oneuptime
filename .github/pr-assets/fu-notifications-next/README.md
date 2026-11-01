# fu-notifications-next: screenshots

Emails rendered by the real `MailService` (production Handlebars helpers and
partials) from a scratch jest harness, opened from disk in headless Chromium
with every request off the disk refused - as a mail client that loads nothing
from the internet shows them - and shot at 2x.

- `uptime-report-640-*.png`, `uptime-report-390-*.png`: the status page uptime
  report (`StatusPageSubscriberReport.hbs`) at 640 and 390 pixels. Before, the
  three supporting tiles drew the number first; after, each names what it
  counts first, as the Average Uptime tile does, and the three sit at the top
  of their strip so their labels line up when a value wraps. Under 600 pixels
  (the UI review) the three stats are rows, each label on the left and its
  value on the right.
- `uptime-report-320-*.png`: the top of the same report at 320 pixels. Before,
  "4 hours, 39 minutes" took five lines and "minutes" and "RESOURCES" broke
  in two; after, the rows.
- `report-starter-390-*.png`: the same for the starter a status page is
  offered for its own report template. Its numbers were 24px, wider than a
  phone's tile, so "minutes" broke in two ("minute" over "s"); they are now
  the built-in report's 22px, and on a phone the stats are rows as well.

The sample page has three groups with their rolled-up numbers, as the server
computes them, and four resources.

- `teams-guide-cloud-*.png`: the Microsoft Teams setup guide a server without
  its Teams app shows (`MicrosoftTeamsIntegrationDocumentation`), its settings
  list, rendered by an esbuild harness of the real component with Inter, for
  `MICROSOFT_TEAMS_CLOUD` unset (`commercial`), `gcc-high` (1280 and 390
  pixels) and a value that names no cloud (`no-cloud`). The line explains the
  setting as the docs do, says what a set value names, and quotes a value that
  names no cloud, with Teams off until it is changed.
- `teams-guide-step2-*.png`: the guide's Step 2. On a server not set to GCC
  High or DoD it names the Azure Government portal beside the Azure portal, so
  such a tenant's admin reads it before making the app; on a server set to
  GCC High it opens https://portal.azure.us.
- `docs-us-government-clouds-1280-*.png`: the docs' US Government clouds
  section at 1280 pixels. Before, the table's fifth column hid behind a
  sideways scroll; after, its four columns fit in every language.
- `status-page-logo-*.png`: a status page email whose page has an uploaded
  logo. Before, the logo was an address on the installation, which a mail
  client that cannot reach it (or blocks remote images) shows as a broken
  image; after, the logo travels inside the email and shows.
