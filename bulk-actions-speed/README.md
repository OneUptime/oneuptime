# Bulk actions: the progress dialog (issue #5299)

How these were made: the real `BulkUpdateForm` and `runBulkAction`, bundled with the Dashboard's own
esbuild config and rendered in headless Chromium with the Dashboard's Tailwind runtime and the Inter
font, at 2x. The bulk action is a stand-in that takes 0.9 s per item, about what the customer's
server took per alert; the 4,594 alerts are the customer's count. `before-*` is master's dialog at
the merge base, rendered the same way. They are not screenshots of a running stack.

- `before-in-progress.png`: master, 3.2 s into a bulk Resolve of 4,594 alerts. One alert at a time,
  a note that says it "may take a moment", and Close, which cannot be pressed until the end.
- `after-in-progress.png`: the same run on this branch, 3.2 s in. Four alerts at a time, what
  happened so far in the words the summary will use, how long is left once it can tell, and Stop.
  The note says to keep the page open, and that a Stop keeps what is already done.
- `after-stopping.png`: right after Stop. No more alerts are started; the ones running finish.
- `after-stopped.png`: the end of a stopped run: what was done, and how many were never started.
- `after-completed.png`: a run with failures and alerts left alone, as before.
- `after-in-progress-390.png`, `after-in-progress-dark.png` and `after-in-progress-de.png`: the
  dialog at 390px, in the dark theme, and in German.
