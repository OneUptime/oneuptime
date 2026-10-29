# The CLI README's Installation section: UI review screenshots

Before/after shots for the UI review of #5387. The only words a person sees
in that pull request are on `packages/CLI/README.md`, which npm shows as the
page of `@oneuptime/cli` and GitHub shows under `packages/CLI`.

- **How they were drawn**: the README rendered by GitHub's own markdown API
  (`POST /markdown`, GFM) inside github-markdown-css 5.8.1, and by marked in
  a stand-in for npm's page (a 16px body, grey quotes with a left bar, light
  grey code blocks; npm draws no GitHub alerts). Headless Chromium at 1280px,
  and 390px at 2x for a phone, with Inter standing in for the system font.
  Each image is cropped to the Installation section.
- **npm-1280-master**: master before #5387 - the install command, the
  Node.js line and a contributor's "Or run directly within the monorepo".
- **npm-1280-builder**: the builder's branch - the version advice and the
  bold Warning (npm prints GitHub's `[!WARNING]` as text), with the
  contributor block still after it, its "Or" now far from the command it
  offered an alternative to.
- **npm-1280-after**, **npm-390-after**, **github-dark-1280-after**: after
  the review - the section ends on the warning, as the docs' "Install the
  CLI" does; the same commands for running the CLI from the repository stay
  under the README's Development section.
