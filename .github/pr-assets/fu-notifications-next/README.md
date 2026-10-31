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
  offered for its own report template.
- `status-page-logo-*.png`: a status page email whose page has an uploaded
  logo. Before, the logo was an address on the installation, which a mail
  client that cannot reach it (or blocks remote images) shows as a broken
  image; after, the logo travels inside the email and shows.
