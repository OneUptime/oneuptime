# Other companies' marks: one colour, inline SVG

Screenshots of every surface that draws another company's product mark,
before and after this branch. `before-*` is master's code, `after-*` this
branch's; both were taken in Chromium (device scale 2) from the same
esbuild harness, which renders the real Dashboard and Common components
(catalogs, tiles, cards, CardSelect, the icon set, the telemetry guide)
with the Dashboard's Tailwind setup, its `Theme.css` dark-mode remaps and
its locales. The website shots render the real Home views (`renderView`)
and load them with the Home stylesheet.

- `before-export-1280.png`, `after-export-1280.png`: Export audit logs >
  Destination, the maintainer's screenshot. Amazon S3, Google Cloud Storage
  and Azure Blob Storage were colour images beside grey outline icons; now
  each is a grey mark (or, for Amazon S3, OneUptime's archive icon, as AWS
  allows no logo here) on the same tile as S3-compatible, Webhook and
  Syslog.
- `before-export-1280-dark.png`, `after-export-1280-dark.png`: the same
  dialog in the dark theme.
- `before-export-picked.png`, `after-export-picked.png`: Google Cloud
  Storage picked: its mark turns indigo like a picked icon.
- `after-export-390.png`, `after-export-390-dark.png`: at phone width.
- `after-export-german.png`, `after-export-persian-390.png`: German, and
  Persian (right to left) at phone width.
- `before-backups.png`, `after-backups.png`: where backups go (list layout).
- `before-security-tiles.png`, `after-security-tiles.png`, and the `-dark`
  pair: Security > Connections, the connector tiles.
- `after-security-tiles-persian.png`, `after-security-tiles-390.png`.
- `before-connect-and-providers.png`, `after-connect-and-providers.png`,
  `after-connect-and-providers-dark.png`: Cloud > Connect, AI / LLM >
  Connect and the Provider column of Settings > AI > LLM Providers.
- `before-video-calls-and-import.png`, `after-video-calls-and-import.png`,
  `after-video-calls-and-import-dark.png`,
  `after-video-calls-and-import-persian-390.png`: Settings > Video Calls
  and Import from another tool.
- `before-menu-code-empty-state.png`, `after-menu-code-empty-state.png`,
  `after-menu-code-empty-state-dark.png`: the icon set's brand glyphs in a
  side menu (Microsoft Teams is now Microsoft's own monochrome glyph), the
  code hosts and Connect GitHub, and an empty state with Slack's mark.
- `before-every-mark.png`, `after-every-mark.png`,
  `after-every-mark-dark.png`: every mark in the registry at 40 and 24
  pixel tiles and 16 pixels bare.
- `before-setup-checklist.png`, `after-setup-checklist.png`,
  `after-setup-checklist-dark.png`,
  `after-setup-checklist-persian-390.png`: User Settings' setup checklist:
  Slack and Teams now sit in their step's colour block like every other
  step.
- `before-workflow-steps.png`, `after-workflow-steps.png`,
  `after-workflow-steps-dark.png`: the workflow builder's step picker.
- `before-telemetry-guide.png`, `after-telemetry-guide.png`,
  `after-telemetry-guide-german-390.png`: the telemetry setup guide's
  language and framework buttons.
- `before-website-compare.png`, `after-website-compare.png`: the website's
  /compare index. It loaded 29 colour images, half of them made-up
  coloured initials; now the 16 tools with an official mark are drawn by
  it, inline, and the others by their initials in the same grey.
- `before-website-integrations.png`, `after-website-integrations.png`: the
  website's /integrations index, its framework cards.
