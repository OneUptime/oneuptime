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
    before the split and its pill's tooltip. They were taken again after the
    UI review, so they show the pages as merged.
  - The `ui-review-*-before.png` / `ui-review-*-after.png` pairs are the UI
    review's: one fixture over the builder's pages (before) and the reviewed
    ones (after), the same data in both.
    - `ui-review-overview-390-*` and `ui-review-overview-768-*`: the
      Overview's Platforms card on a phone and beside the side menu. Before,
      an environment's state sat under one name and beside the next, a quiet
      environment's dot was the same grey as one never heard from (and both
      lines amber), every connected row said Connected again under its green
      dot, the state pill squeezed AWS ECS / Fargate onto two lines on a
      phone, and the tile's 2 AWS · 2 Azure · 2 Google Cloud broke inside
      2 Google Cloud. After, each platform lays out by the room it has, every
      row of a width reads the same way, a quiet row is amber (dot and Last
      seen) and a new one grey (Waiting for its first data), and the tile
      breaks only between clouds.
    - `ui-review-rule-view-*`: an owner rule made before the split, opened
      in App Platforms. Before, the page called it a Cloud Resource Owner
      Rule and its Run Now card offered to run it over cloud resources only.
      After, it is the page's Cloud Environment Owner Rule, its pill says it
      also applies in Cloud, and Run Now names both kinds it runs over.
    - `ui-review-rule-create-*`: App Platforms' Create dialog. Before, it
      offered All cloud resources; after, All cloud environments.
    - `ui-review-environments-*`: All Environments at 1280. Before, a
      Provider column (the Platform column already names the cloud) pushed
      Status under the row's buttons; after, Status shows whole.
- `after-products-menu.png` is the Products menu on an App Platforms page,
  from this branch's Navigation Search fixture: the new Cloud section (Cloud,
  App Platforms, Serverless) after Infrastructure, open, with App Platforms
  lit. On master, Cloud and Serverless were two of Infrastructure's 13.
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
