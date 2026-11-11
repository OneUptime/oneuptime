# An alert's Lineage card: UI review

How these were made: `before-*` and the `after-*` images without `busy` in their name are the
Event Overview fixture (`packages/E2E/EventOverview/Fixture`, the Dashboard's real alert page with
its APIs answered in the browser) on alert #311, in headless Chromium at 2x, the card only.
`before-*` is the builder's commit (84d54762048, main merged), `after-*` this PR. The `busy` images
are the real `AlertLineageDiagram` given a larger lineage (seven tables, a failed dbt run, a
cause and a consequence) in the same Chromium, with the Dashboard's Tailwind runtime, Theme.css and
locales. They are not screenshots of a running stack.

- `before-cause-on-arrow-phone.png` / `after-cause-on-arrow-phone.png`: an alert caused on the
  pipeline that moves data into its table (`?data=table&cause=pipeline`), at 390px. Before, the
  drawing opened on the alert's own card, and the label that says which pipeline is the cause was
  cut at the canvas's left edge, Cause half out of view. After, the drawing opens with that label
  in view. On a level arrow the label sits just over the line, so the arrow and its head still
  show; before, it covered nearly all of the arrow.
- `before-column-check.png` / `after-column-check.png`: an alert from a check on one column
  (`?data=table&check=column`). Before, the alert's sentence sat above the counts and the column's
  sentence below the picker, two blocks with the picker between them, and the picker cut
  "provider_reference" to "provider_refer...". After, both sentences are one block right over the
  drawing with their marks lined up. The picker is 256px wide, and on a phone it takes the whole
  line.
- `before-column-check-fa-dark.png` / `after-column-check-fa-dark.png`: the same in Persian, dark,
  at 768px, read right to left.
- `after-cause-run-failed.png`: the cause's pipeline whose latest run failed (`&run=failed`, now
  sent as FAIL, the run state OpenLineage uses). The arrow and the pipeline's name are red and
  Cause is still under it. The label's words are a shade darker than the arrow (red-600 words
  on a red-500 arrow, indigo-600 on indigo-500), so they read at 4.5:1 or better on the light
  page. Dark mode lightens them.
- `after-busy-column-followed.png`: a busier drawing with a column followed: four sentences in one
  block. The last one has no mark; it keeps the mark's room, so it lines up with the others. A
  failed run's label sits on its curved arrow's middle, over the arrows and under the cards.
- `after-busy-column-not-on-arrows.png`: the alert's check is on a column no arrow names. A new
  sentence says so ("No arrow on this diagram says where discount_code comes from or where it
  goes."), so nobody looks for it on the drawing.
- `after-busy-cause-on-arrow-phone.png`: a busier drawing at 390px whose cause is on a pipeline,
  opened on the Cause label.
