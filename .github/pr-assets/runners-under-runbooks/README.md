# Runners move from Project Settings into Runbooks

How these were made: the dashboard's real Settings and Runbooks route groups, layouts and pages,
bundled with the dashboard's own esbuild config and rendered in headless Chromium at the real URLs
with the model API stubbed (three Runners, two credentials). 1100px wide (one at 390px), 2x. Every
`before-*` image is the same harness built from master at 75e0f77002. They are not screenshots of
a running stack.

- `before-runners-in-project-settings.png` / `after-runners-in-runbooks.png`: the Runners list.
  Before: the sixth section of the Project Settings menu, below AI, under the "Project Settings"
  title. After: the same page under Runbooks, with its own Runners section in the Runbooks menu
  and a Project > Runbooks > Runners trail. The old `/settings/runners` URL lands on the second
  image.
- `before-runbooks-menu.png` / `after-runbooks-menu.png`: the Runbooks landing page. The menu
  gains the Runners section between the runbooks and their Settings; Settings stays folded and
  Runners does not.
- `after-runner-credentials.png`: Runner Credentials, the section's second entry. A credential's
  Runner links to that Runner's page under Runbooks.
- `after-project-settings-menu.png`: Project Settings without the Runners section; AI is followed
  by Advanced.
- `after-runners-phone.png`: the Runners list at 390px. The menu button reads "Runners / Runners".
