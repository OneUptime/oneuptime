# Right to left: the UI review

How these were made: `before-*` is the builder's branch (claude/fu-rtl before the review) and
`after-*` the reviewed branch, on a local stack (the App with Postgres, ClickHouse and Valkey)
seeded with monitors, incidents, an on-call schedule, a maintenance event and a few logs,
opened in headless Chromium at 1280 pixels with the Dashboard in Persian.
`after-notes-and-fields-fa.png` is the reading direction browser suite's own screen
(packages/E2E/ReadingDirection).

- `before-feed-list-fa.png`, `after-feed-list-fa.png`: an incident's feed on a Persian page.
  Before, the note's bullets stood at the far right of its English resource list, and the
  creator's name came after "created Incident INC-2". After, the list is laid out left to right
  with its bullets beside the names, and the name leads its sentence.
- `before-detail-value-fa.png`, `after-detail-value-fa.png`: an English description in a
  Persian detail card keeps its full stop at its end.
- `before-logs-fa.png`, `after-logs-fa.png`: the same for log messages.
- `before-typed-fa.png`, `after-typed-fa.png`: what is typed into a field reads the way it is
  written.
- `before-calendar-fa.png`, `after-calendar-fa.png`: the maintenance calendar in Persian
  digits, the grid's day numbers too.
- `after-notes-and-fields-fa.png`: notes (a feed note, a Persian list with an English item, a
  Persian sentence that starts with code), the editor, a detail card and fields.
