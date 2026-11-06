# Right to left, next: screens

Drawn from the reading-direction fixture (`packages/E2E/ReadingDirection`), the production
components bundled with the Dashboard's esbuild config, Tailwind runtime, Theme.css and Inter,
on a Persian page (`?lang=fa`), at device scale 2. "Before" is this branch before its calendar
and canvas changes (the same code as `main`); "after" is the branch.

- `calendar-narrow-month-fa-*`: a month in a 390px card. Before, each day's full name was cut
  ("چها…"); after, a narrow column shows the day's one-letter name ("چ").
- `calendar-week-fa-*`: a week in an 800px card with "now" on Monday. Before, the current-time
  dot sat at the far (left) end of today's column and the blocks' stripes on their trailing
  edges; after, the dot sits at the line's start beside the hours, the stripes on the leading
  (right) edges, and a day's blocks keep their gap at its end.
- `canvas-fa-*`: a React Flow canvas. Before, the zoom buttons stayed at the bottom left;
  after, they sit at the bottom right, where a Persian line starts.
- `separator-beside-persian-digits.png`: the separators considered between two facts beside
  Persian digits, in the product's font stack. The middle dot reads as Persian's zero ("۰");
  the bullet, chosen, reads as a separator.
