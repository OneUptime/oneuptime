# Rule exceptions and Run on Past Events: the UI review, before and after

Screenshots for the pull request "Detection rule exceptions and Run on Past
Events (retrohunt)" (#5360). Each `<name>-before.png` is the branch as it was
built (e52f32e616), each `<name>-after.png` the branch after its UI review.
Both are drawn by the offline browser fixture of `packages/E2E/SecurityOperations`
(the real Security Events routes over its synthetic month, Inter, Theme.css),
at 1x, on a clock held at 2026-10-14 12:00 UTC. The fixture is 64 pixels
narrower than production: its 1344-pixel window is a 1280 laptop.

- `list-1280-*`: Security Events > Detections > Rule Exceptions. Values and
  patterns are in the mono type Protected Entities writes them in; under each
  status pill, how far off ("Expires in a month", "Starts in 21 hours", "2 days
  ago") with the date under the pointer, not a date broken over two lines that
  repeated its pill's word ("Ended Oct 6, 4:00 PM" under Ended); a window's
  times and "6 days ago" never break inside.
- `list-1280-de-*`: the same in German. The Status column ran under the row's
  sticky Edit; the list now fits its card, as it does in Russian and French.
- `edit-expired-*`: Edit on an exception that expired, its reason changed,
  Save Changes. The form refused the exception's own past expiry ("An exception
  expires in the future"), so nothing about it could be fixed; it now saves.
- `delete-*`: Delete names what it removes.
- `retrohunt-*`: Run on Past Events from a rule's row. The dialog was as wide
  as the page, so a value and its count were a screen's width apart.
- `retrohunt-failed-*`: a run that cannot be made says why in a box of its own.
- `form-tools-*`: the rule form's quiet tools under its YAML share one line.
- `form-new-*`: a new rule's empty form has nothing to run, so it no longer
  shows Run on Past Events greyed out with its reason only under the pointer.
- `case-add-exception-*`: Add Exception on a case's detection said "Its other
  matches still fire." twice; the dialog now says what an exception is for, as
  it does from a rule's row.
- `retrohunt-24h-after.png`: over the last 24 hours the answer no longer adds
  "6 a day" under "Would have fired 6 times".
- `list-1280-fa-after.png`: Persian, right to left, every date and time in
  Persian.
