# Code, next: production reviews off GitHub (#5407, UI review)

How these were made: the real Code route group (Production Reviews, a review's page, Review a pull
request, a repository's Settings) bundled by `packages/E2E/Code/Fixture/server.js` over its
in-memory Code server, drawn in headless Chromium with the Dashboard's Tailwind runtime, its
reading-direction plugin and the Inter font, 2x. Every record is fabricated: billing-service on
GitLab (merge request !15), status-widgets on Codeberg's Forgejo (pull request #7, and #9 from a
fork), checkout-api on GitHub (#42). `?hosts=1&token=refused` has GitLab refuse the token;
`?reviewllm=gone` has #42 read by the project's default because the repository's pick is gone.
Persian is the Dashboard's `fa.json` loaded over the fixture, with `dir="rtl"` as the Dashboard
sets it.

`builder-*` is this PR before its UI review (origin/claude/fu-code-next at eefe9a3a0c), drawn
with the same fixture. `after-*` is this PR after the UI review.

- `builder-review-gitlab-trail-1280` / `after-review-gitlab-trail-1280`: a GitLab review's trail
  said "Pull request !15" under a page that says "Merge request !15" everywhere else. After: the
  crumb is in the host's words.
- `builder-reviews-gitlab-status-1280` / `after-reviews-gitlab-status-1280`: GitLab's Production
  Reviews. "...reviewed when someone with write access asks for it here" read as write access on
  GitLab, but asking here takes permission to edit the repository in OneUptime (only those who
  have it see the button). After: "...reviewed only when someone asks for it here".
- `builder-reviews-gitlab-refused-1280` / `after-reviews-gitlab-refused-1280`: a token GitLab
  refused. "Go to Settings" becomes the fix itself, "Replace access token", as the repository's
  Tasks name it; a connection that is gone still says Go to Settings.
- `builder-review-gitlab-refused-footer-1280` / `after-review-gitlab-refused-footer-1280` (and
  `after-review-gitlab-refused-footer-390`): a review that cannot be reviewed again now has the
  same fix beside it (Connect GitHub on GitHub).
- `builder-ask-letters-1280` / `after-ask-letters-1280` (and `after-ask-de-letters-390`): Review
  a merge request with "VAT" typed. Before, Review now just stayed disabled. After, the field says
  "Enter the number of a merge request, such as 12." (never for a lone # or ! on its way to a
  number), its help is read with it by a screen reader, and a phone offers its number keys. The
  help reads "Any open merge request in this repository, even one from a fork or a bot."
- `builder-ask-fa-digits-1280` / `after-ask-fa-digits-1280`: "۱۵" as a Persian keyboard types
  it. Before, no number; after, merge request 15 (full-width "＃１５" too).
- `builder-asked-fork-queued-1280` / `after-asked-fork-queued-1280`: a fork's pull request just
  asked for. Before, the page promised "Reviewed again each time the pull request changes." - not
  true for a fork. After, no promise and no disabled button until the review is in; then it says
  it is reviewed again only when someone asks.
- `builder-llm-fell-back-1280` / `after-llm-fell-back-1280` (and `after-llm-fell-back-dark-1280`,
  `after-llm-fell-back-fa-390`): a review read by the default because the repository's pick is
  gone. After: marked as a warning by an icon, not only by its colour, with Change in Settings,
  which opens More settings at the pick, for those who may change it.
- `after-reviews-gitlab-390`, `after-reviews-gitlab-dark-1280`: the Production Reviews page of a
  GitLab repository on a phone and in dark mode.
