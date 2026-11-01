# Cloud and App Platforms, split

How these were made: headless Chromium (the cached headless shell), no App and
no backend. Every image is at 1x.

- The Dashboard images come from offline fixtures that bundle the production
  pages with the app's esbuild config, Tailwind, theme and font over a stubbed
  data boundary:
  - `before-cloud-menu.png` is master at 633e1afd56 (a `git archive` copy),
    served by its own `packages/E2E/CloudConnect` fixture: Cloud > Accounts,
    with Cloud's side menu listing All Environments beside All Resources.
  - `after-cloud-menu.png` is the same page on this branch: Cloud keeps
    Accounts, All Resources and Connect.
  - Every `after-app-platforms-*` image is from this branch's App Platforms
    suite (`packages/E2E/AppPlatforms`, `npm run test-app-platforms-ui`), which
    saves them as it runs: the Overview at 1280 and 390 pixels (and 390 dark),
    in Persian, an environment's Overview, and Owner Rules with a rule made
    before the split and its pill's tooltip.
- The website images render Home's EJS views as Routes.ts does (ts-node,
  `ejs.renderFile`) and serve Home's static files and Common's vendor folder
  to the browser; Google Fonts load from the network:
  - `before-website-cloud.png` is master's `/product/cloud`: auto-discovered
    environments and a Cloud Environments mockup.
  - `after-website-cloud.png` is this branch's `/product/cloud`: accounts and
    every resource in them.
  - `after-website-app-platforms.png` and
    `after-website-app-platforms-platforms.png` are the new
    `/product/app-platforms`: its hero and its eight platforms by cloud.
