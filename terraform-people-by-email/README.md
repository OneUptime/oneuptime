# Terraform: people by email address - the People and Teams docs page

How these were made: the real `/docs/<language>/terraform/people-and-teams` page as a local
OneUptime serves it (the App run natively from this branch), opened in headless Chromium and
captured whole, at 1280px and at 390px for the phone. The local App has no built mermaid, so the
diagram reads "This diagram could not be drawn" here; on oneuptime.com it is drawn.

- `people-and-teams-en.png`: the page in English. Naming people by address, onboarding (Alice
  invited by address, Bob named as an owner), finding someone with `data "oneuptime_user"`,
  offboarding, importing a membership by team and address, address changes, troubleshooting.
- `people-and-teams-en-dark.png`: the same page in the dark theme.
- `people-and-teams-fa.png`: the page in Persian, right to left. The code stays left to right.
- `people-and-teams-en-phone.png`: the page at 390px. Nothing scrolls sideways; the code blocks
  scroll on their own.
