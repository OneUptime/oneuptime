# A widget's Live Preview never leaves the board (#6859)

These screenshots come from a small esbuild page that renders this branch's real `ComponentSettingsModal` (the
widget settings dialog, with its Live Preview) and the same widget on the board out of edit mode, through
`DashboardBaseComponentElement`. Only the reads are stood in for: four SLOs for the SLO List widget, a line of
`http.server.duration` and one incident for the Chart widget. Each shot was taken at 2x in headless Chromium with
the Inter font, and the page logged every call that would have left it: a click on a name, a tile or a text widget's
link in the preview logged none.

## The SLO List widget

- `1280-list-preview-hover.png`: the preview, with the pointer on "Payments API latency". The name is its words:
  no underline, no blue, no pointer. The row's own hover shade stays.
- `1280-list-board-hover.png`: the same widget on the board, the same pointer: the name is a link, as before.
- `1280-honeycomb-preview-hover.png`: the widget as a honeycomb, in the dialog, the pointer on a tile. Its card
  says what the tile is, with no "Click to open" under it.
- `1280-honeycomb-board-hover.png`: on the board the card ends with "Click to open", as before.
- `1280-ar-dark-list-preview-hover.png`: the preview in Arabic, in the dark theme, the pointer on a name.
- `390-list-preview.png`: the preview at phone width.

## The Chart widget

- `1280-chart-preview.png`: the preview has no Investigate and no Open in Metric Explorer at its title's end, and
  its series chip has no investigate button. The incident's marker is drawn, and opens nothing there.
- `1280-chart-board.png`: on the board, both buttons and the chip's button are there, as before.

## The Text widget

- `1280-text-preview-hover.png`: the preview, with the pointer on "checkout runbook": the links are drawn as links
  look (blue, underlined, the same weight), with no hover colour and nothing to click.

## UI review

Taken the same way, at 1x, as each dialog opens. `before` is this PR's head before the review, `after` is the
review's commits.

- `review-1280-chart-dialog-before.png`: a Chart widget's settings opened 486px down. The folded Display Options'
  Title focused itself as it drew and the dialog scrolled to it, past the Live Preview.
- `review-1280-chart-dialog-after.png`: the dialog opens on the preview. The chart also fills its box now: it was
  drawn 32px narrower, with a 48px gap after it and 16px before it.
- `review-390-chart-dialog-before.png` and `review-390-chart-dialog-after.png`: the same at phone width. The chart's
  preview is now 400px tall, as a phone's board draws a chart; at 240px its plot was a line.
- `review-1280-datasource-dialog-before.png` and `review-1280-datasource-dialog-after.png`: a Data Source Value
  widget opened 917px down, at its Display Options' Title below the query. It opens on the preview now.
- `review-1024-de-dark-funnel-dialog-after.png`: a Funnel widget in German, in the dark theme. It used to open 195px
  down, at the Title of its second, open, section.
