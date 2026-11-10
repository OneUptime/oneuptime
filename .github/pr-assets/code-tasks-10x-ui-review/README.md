# Code tasks, UI review: before and after (#6439, #6442)

How these were made: the real Dashboard pages (Code's Tasks page, a repository's Tasks
page, a task's conversation, the AI insights list and an insight's page), bundled with the
Dashboard's own esbuild config and rendered in headless Chromium with Inter, 1x. The Code
and insight APIs answer from made-up data: two repositories, eleven tasks in every state
(working, an attempt waiting to try again, waiting for you, a pull request open, merged or
closed, failed after 3 attempts, failed once, stopped) and five insights with a fix task.
The width in the name is the viewport's. `before-` images are the pull request as it was
before the review; the others are after it, with main merged in.

The insights list's counts above the table read 7 everywhere: the mock answers every count
with the whole list.

- `before-code-search-none-1280.png` / `code-search-none-1280.png`: Code's page, searching
  for a word no task has. Before, the search reported 0 as the number of tasks, so the page
  took it for "no tasks yet" and swapped the list, search box included, for the first-run
  suggestions. After, the list stays, says "No tasks match." and offers Clear filters.
- `code-1280.png` and `code-390.png`: Code's page with every kind of task: the filters
  with their counts, the search box with its magnifier, and rows that say which attempt is
  running, when the next starts, why a task failed and how long AI worked.
- `before-repo-1280.png` / `repo-1280.png`: a repository's Tasks page. Before, the request
  box and the list had different widths and edges, and rows with a check box started their
  titles further right than the others. After: one column, one edge, every title at the
  same place, and the stopped row that offers Try again says Stopped.
- `before-repo-select-390.png` / `repo-select-390.png`: the same on a phone with two rows
  picked for Retry selected. Before, Try again squeezed the titles; after, it sits under
  the title.
- `before-repo-fa-390.png` / `repo-fa-390.png`: Persian on a phone. An English title or
  reason too long for its row was cut in the right place but drew its "..." at the left,
  before its first word; it now ends in "..." after its last word, and a short one still
  starts at the right.
- `repo-de-1024.png` and `repo-dark-1280-dark.png`: German beside the side menu, and dark.
- `before-task40-1280.png` / `task40-1280.png`: a task whose attempt waits to be tried
  again. Before, its header and its turn said Queued while the list said Retrying; after,
  both say Retrying.
- `before-task36-1280.png` / `task36-1280.png`: a task that failed after 3 attempts.
  Before, the turn said "AI could not finish." and, under the reason, "Failed after 3
  attempts." After, once: "AI could not finish after 3 attempts." over the reason. The
  header's work time has a clock.
- `before-insight1-1280.png` / `insight1-1280.png`: an insight whose fix task waits for its
  next attempt. After, the Fix Task card comes first in the side column, says in one line
  that a person reviews the pull request, shows how long AI has worked, stacks its note in
  the narrow column and links View the task.
- `before-insight3-card-1280.png` / `insight3-card-1280.png` and
  `before-insight4-card-1280.png` / `insight4-card-1280.png`: the Fix Task card of a task
  that failed after 3 attempts, and of a request that failed once. Before, a red box. After,
  the card says a failure as the insight's other AI cards do (main's triage card among
  them): a red mark, "AI could not finish.", and a quieter line with the reason and, when
  OneUptime tried more than once, how many times. A request has the product's Try again
  under it.
- `insight4-triage-1280.png`: the same insight when its triage did not finish either: both
  cards say it the same way.
- `insight1-fa-1280-dark.png` and `insight2-fa-390.png`: the card in Persian, dark, and on
  a phone, where AI's English reply ends in "..." after its last word.
- `before-insights-de-1280.png` / `insights-de-1280.png`: the insights list in German.
  Before, "Aufgabe fehlgeschlagen" broke over two lines; after, the status column fits it,
  and a longer stage is cut short with its words on hover.
