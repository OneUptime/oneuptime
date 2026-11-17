# Workflows, runbooks and Runners follow-ups: UI review

How these were made: the real Dashboard pages, bundled from the repository's offline browser
fixtures (`packages/E2E/WorkflowBuilder`, `RunbookTriggers`, `RunbookVariables`) with the
Dashboard's own esbuild config, its Tailwind runtime and the Inter font, and rendered in headless
Chromium at 1x with the model APIs answered from memory. `before-*` is the branch as its builder
left it (bf5401f9cc), rendered the same way. They are not screenshots of a running stack. Every
name in them is made up.

- `before-view-only-step.png` / `after-view-only-step.png`: a Workflow Member opens a step to read
  it. Before, its first value box took the focus (the indigo ring) and the keyboard's typing, and
  each box kept its `{ }` button to insert a value. After, the boxes show their values to be read:
  no focus, no `{ }`, nothing typed changes them.
- `before-view-only-toolbar-390.png` / `after-view-only-toolbar-390.png`: the Builder as a view on
  a phone. Before, the locked Add Trigger was narrower than Run Workflow, and the canvas's controls
  had react-flow's lock, which turned dragging and connecting back on. After, the locked button is
  as wide as the others, and the controls zoom and fit only.
- `before-run-no-trigger-member.png` / `after-run-no-trigger-member.png`: Run Workflow on a
  workflow with no trigger, for someone who may not add one. The panel's own description no
  longer repeats what its empty state says, and the empty state says whom to ask.
- `before-free-plan-notice.png` / `after-free-plan-notice.png`: the Free plan's notice reads as
  the AI features' plan notice does ("AI requires the Growth plan"), with the same link to Billing.
- `before-overview-paused.png` / `after-overview-paused.png`: a runbook whose schedule is paused.
  Before, its Overview said "Its schedule is paused." over "No schedule or webhook: ..."; after,
  one line says both.
- `before-global-variables-runbook-admin.png` / `after-global-variables-runbook-admin.png`: Global
  Variables, empty, to a Runbook Admin, who may not add one. The empty state no longer says whom
  to ask a second time: the locked Create Variable under it already does.
- `before-ssh-host-key.png` / `after-ssh-host-key.png`: an SSH step's Host key, under More fields:
  the help leads with what the field does, one key per line.
