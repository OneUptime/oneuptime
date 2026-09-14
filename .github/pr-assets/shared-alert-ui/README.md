# Shared alert banner screenshots

`before-provided.png` is the original screenshot supplied for this change.

The remaining screenshots render the actual shared `Alert`, `Card`, and `Button` components from this branch with the repository's bundled Tailwind and theme styles. They use synthetic content in the isolated `E2E/Alerts` fixture, not a signed-in production project. No banner markup is recreated for the screenshots.

Run `cd E2E && npm run test-alerts-ui` to regenerate the desktop, mobile, light, and dark captures under `output/playwright/alerts/`.
