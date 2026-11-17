# Cloud agents: the UI review's before and after

Screenshots for the pull request "Cloud agents" (#5367). Each
`<name>-before.png` is the branch as its builder left it (cb61758e02), each
`<name>-after.png` the branch after its UI review; both drawn from the same
data, by the offline Cloud Connect fixture (`packages/E2E/CloudConnect`,
`?state=connected`, `&ai=connected` where an agent runs, `&lang=de|fa` and
`&theme=dark` where the name says so), the "before" from a copy of the
builder's commit.

- `dialog-*`: **Let AI fix problems** on an AWS account's Overview, the whole
  dialog. After: the question on top (the setup guides' option picker), then
  three numbered steps - the key (it had no label), the command, the wait -
  and More fields as the forms' quiet line.
- `change-keeps-choices-*`: **Change** on the AI agent page of an account
  whose agent runs with three changes, the required tag and two protected
  resources (`&agentsettings=custom`). The dialog starts from them; before,
  it started from the defaults, and running its command again turned the
  other seven changes back on and dropped the tag and the protected
  resources.
- `fixes-*`: the Fixes row of the AI agent page, with the project's
  automatic fixing switches off. One sentence and a Turn on link per switch,
  laid out by the row's own width.
- `agent-page-none-1280-*`: the AI agent page with no agent: "Not set up",
  and no line about the project's switches while the account's fixes are
  off.
- `overview-card-1280-*`: the Overview's AI agent card before an agent
  connects, with the header the connected card has.
- `logs-1280-*`: AI Logs, whose commands table was titled "cloud
  operations".
- `feed-1280-after.png`: the account's Feed, the agent's connection item in
  the words the server now writes for a Cloud AI agent.

The phone shots (`*-390-*`) are at 2x; the rest at 1x.
