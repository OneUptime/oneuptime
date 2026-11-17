# Dashboard playlists: the UI review, before and after

Screenshots for the pull request "Dashboards: playlists that rotate dashboards
on a NOC screen" (#5235). Each `<name>-before.png` is the branch as it was built
(a2192f99f9), each `<name>-after.png` the branch after its UI review. Both are
drawn by the offline browser fixture of `packages/E2E/DashboardPlaylists` (the
real Dashboards routes over fixture data, Inter, Theme.css), at 1x, on a clock
held at 2026-10-27 10:00 UTC.

- `list-1280-*`, `list-768-*`, `list-390-*`: Dashboards > Playlists. One phrase
  says what a playlist plays ("3 dashboards, 1 minute each"); at 768 pixels,
  beside the side menu, the phrase goes under the name instead of under the
  sticky Play buttons, and a phone's card drops the Name and Dashboards labels.
- `view-night-1280-*`, `view-night-768-*`: a playlist's page (Night shift: an
  archived, a deleted and an unreadable dashboard between two that play). The
  order and the player link have rows of their own; the link sits in a box
  beside Copy link; the description runs under the title and its buttons.
- `create-1280-submit-empty-*`: Create Playlist pressed with nothing filled in.
  The picker is marked invalid with the form's error, as the Name is.
  `create-1280-submit-empty-dark-after.png` is the same in the dark theme: the
  invalid picker is framed red (before the review's Theme.css rule it was framed
  near white).
- `edit-night-1280-*`: Edit Playlist. A row's Move up, Move down and Remove are
  grey-500 (3:1 on white).
- `player-wall-1280-*`: the player on a 1280-pixel screen. The charts have no
  zoom and investigate icons, no "Drag to zoom" and no legend menus.
- `player-wall-1280-shortcuts-*`: the keyboard sheet, a medium dialog.
- `player-fail-1280-*`: a failed read: the message in the middle of the screen,
  saying the player tries again in a minute.
- `player-draft-390-*`: a playlist with nothing to play on a phone: Full screen
  and Exit stay on the playlist's line.
