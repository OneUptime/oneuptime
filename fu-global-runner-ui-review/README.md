# Runners that take no AI code fixes: the UI review of #5583

How these were made: the real pages in headless Chromium with the Dashboard's own Tailwind runtime
and Inter, at 1x. The Code and Runbooks shots come from the offline fixtures in packages/E2E
(`Code/Fixture`, `GlobalRunners/Fixture`; `?gfix=0` makes the global Runners take no AI code fixes,
`?runner=prod&prodfix=0` and `?fix=0` turn them off on the host of prod-eu-west-1). The Admin
Dashboard shots come from a scratch harness that renders `Pages/Settings/GlobalRunners/Index.tsx`
over four global Runners: one that takes AI code fixes, one of an older release, one whose host
turned them off, and one that never connected. Every `before-*` image is the builder's branch at
10579bffd8, drawn the same way. They are not screenshots of a running stack.

- `before-admin-global-runners.png` / `after-admin-global-runners.png`: the amber line under a
  Runner's status was cut off behind the row's buttons ("...update it to this server's versio").
  The Status column wraps now, and the line for a host that turned code fixes off says what to do.
- `after-admin-global-runners-dark.png`, `after-admin-global-runners-fa.png` (Persian, right to
  left) and `after-admin-global-runners-390.png`: the same page.
- `before-runner-card-390.png` / `after-runner-card-390.png`: a repository's Runner card on a phone.
  The setting broke at the letter that filled the line ("...CODE_FIXES=fals" / "e"). It is drawn as
  code now and breaks only after an underscore.
- `before-code-notice-390.png` / `after-code-notice-390.png`: Code's notice for the same Runner,
  the same fix. `after-code-notice-fa-390.png`: in Persian.
- `after-code-notice-global.png`: Code's notice when no global Runner online takes AI code fixes.
- `before-runners-page.png` / `after-runners-page.png`: Runbooks -> Runners. The card says global
  Runners run AI code fixes, so one that takes none says so under its status.
  `after-runners-page-dark.png`: dark.
- `before-runner-page.png` / `after-runner-page.png`: a Runner's own page says, under the code
  repositories that pick it, that its host turned AI code fixes off.
- `after-more-settings.png`: a repository's folded More settings: "Runner: prod-eu-west-1 · Takes
  no AI code fixes", as it says "· Disconnected".
- `after-picker-menu-390.png`: the Runner picker's menu marks the Runner that takes no AI code fixes.
- `after-picker-no-global-runner-de-390.png`: the picker in German when no global Runner takes
  them: the Global Runner choice is left out, and the line under it says why.
