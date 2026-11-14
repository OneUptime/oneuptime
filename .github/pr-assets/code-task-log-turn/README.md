# A Code task's Log, opened from a link to one of its turns (#7130)

How these were made: the repository's offline Code fixture (`packages/E2E/Code/Fixture/server.js`),
which bundles the production Code route group with esbuild over an in-memory Code server, in
Playwright's Chromium at 1x, with Tailwind's runtime, the reading-direction script production
loads after it, and the Inter font. The fixture's `?long=1` task has 207 turns: its page reads Turn 1
and the newest 199, so turns 2 to 8 are not shown. `&theme=dark` and `&lang=de` / `&lang=ar` pick
the theme and the Dashboard's language, with its real locale files. Every page was checked for
sideways scroll (none), page errors (none) and, in Arabic, `dir="rtl"`.

## A link to Turn 5, which the task's page does not show

The address is the task's Log with `?turn=` naming Turn 5's run. The page asks the server for that
turn by name, opens it, and lists it in the Turn picker at its place, with a line on each side
for the turns still not listed: Turn 1, 3 earlier turns are not shown, Turn 5, 3 earlier turns
are not shown, Turn 9. Before, the page showed Turn 1 and said nothing.

- `linked-turn-picker-1280-light-en.png`: English, the picker open.
- `linked-turn-picker-1280-dark-de.png`: German, dark.
- `linked-turn-picker-390-light-ar.png`: Arabic, on a phone. What was asked under each turn is
  English, as its person wrote it, and reads left to right at the page's start: "Now the orders
  handler." keeps its full stop at its end, and a long request ends its line with "…" on the right.
  (The UI review's shot: before it, these lines were laid out right to left with the page.)

## A link to a run of another task

The address names a run of another task. The page shows this task's first turn and says so:
"That turn is not part of this task" / "The task's first turn is shown instead." Before, the page
showed that other task's record under this task's name.

- `not-of-task-1280-light-en.png`: English.
- `not-of-task-1280-dark-de.png`: German, dark.
- `not-of-task-1280-dark-ar.png`: Arabic, dark.
- `not-of-task-390-light-en.png`: English, on a phone.

## A link cut short

The address's `turn` is no run's id at all - Turn 5's id with its last part lost when it was
pasted. Before the UI review this opened Turn 1 and said nothing; it now says the same as a link to
another task's run, at once, with no turn asked of the server.

- `broken-link-390-dark-ar.png`: Arabic, dark, on a phone.
