# Contextual AI insights browser checks

Screenshots show the production `AIChatPanel`, `useAiChat`, `PageContextUtil`,
composer and suggestion cards, rendered with an isolated browser fixture. The
application title and provider are synthetic; no model response is fabricated or
shown. Keyboard opening, RUM context detection, and desktop/mobile layout were
checked in Chromium. API behavior is covered separately by the focused Jest
suites.

The shared development Docker app was mounted to another worktree, and configured
test-login credentials were empty. The fixture therefore loaded the components
from this branch directly without altering that running app.

- `rum-desktop.png`: RUM application name, suggested insights, and attached context.
- `rum-mobile.png`: 390×844 layout with accessible composer and scrollable cards.
