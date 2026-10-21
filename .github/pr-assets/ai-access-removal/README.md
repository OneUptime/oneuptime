# Runbooks menu without AI Access

Screenshots of the production Runbooks route group (`Routes/RunbookRoutes.tsx`:
the Runbooks layout, its side menu and the real Runners page), taken in
Chromium by the offline suite `packages/E2E/RunbooksMenu`
(`npm run test-runbooks-menu-ui`). The project and its empty lists are
synthetic: the fixture replaces only the data boundary and the signed-in user.

- `runbooks-menu-laptop.png`: 1280 pixels, on Runbooks → Runners. The menu's
  first section lists Runbooks, Executions and Runners; the Runners section and
  its AI Access entry are gone, and Settings stays folded.
- `runbooks-menu-phone.png`: 390 pixels, the phone menu opened on Runbooks: the
  same three entries, nothing running off the screen.
