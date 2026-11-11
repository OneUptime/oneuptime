# An on-call run's Execution Timeline, with Notified Via (#6585)

How these were made: the real `ExecutionLogsTimelineTable` (the Execution Timeline card of an on-call
policy run), bundled with the Dashboard's esbuild config and rendered in headless Chromium at 2x,
with the model API answered from memory, `Theme.css`, the Tailwind runtime and the Inter font. People
with no picture get the API's own blank profile picture. `before-1920.png` is `main`'s table, rendered
the same way. They are not screenshots of a running stack; every person, rule and time in them is
made up.

- `before-1920.png` / `after-1920.png`: a 1920-pixel window, with the Dashboard's side menu beside the
  card. **Notified Via** sits right after **Notification Sent To**: one chip a channel, with its icon,
  in the order the run's Slack/Teams message lists them, two or three to a line. A chip never breaks
  its name. A step that paged nobody, or a step from before this change, shows the table's quiet
  dash.
- `after-1280-scrolls.png`: a laptop. With the side menu, the table scrolls sideways under its sticky
  actions, as `main`'s table already did at this width.
- `after-390.png`: a phone. The rows are cards; Notified Via is a label and its chips. A step with no
  channels leaves the label out, as the cards do for every empty value.
- `after-german.png`: German. The column is "Benachrichtigt über", and a phone call is "Telefonanruf".
- `after-rtl-fa.png`: Persian, right to left. The chips run from the right, icon first.
- `after-dark.png`: the dark theme.
