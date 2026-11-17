# Home is one overview page

The UI review of PR #6981 (issue #6857).

How these were made: the real Home page and every card it mounts, from the offline Home fixture
(`packages/E2E/HomeOverview/Fixture`), and the real SLOs list, from the offline SLO fixture
(`packages/E2E/SloBurnRate/Fixture`). Both are bundled with esbuild and the production Tailwind
build, served locally and rendered in headless Chromium with Inter. The docs images are the Home
Page & Shortcuts page rendered by the docs' own renderer and stylesheet. These are not screenshots
of a running stack, and every record in them is made up.

- `home-1280.png`: Home in a busy project. One page with no side menu, under the trail
  Project › Home. Each of the five numbers and each View all opens the list in its own product.
- `home-1280-fa.png`: the same in Persian, right to left. The Home fixture now loads the reading
  direction's script after Tailwind's runtime, as the dashboard does, so its left and right
  utilities follow the page's direction here too (the Explore tabs' counts had lost their gap).
- `home-390-dark.png`: on a phone, in the dark theme. Nothing is wider than the screen.
- `before-slos-at-risk-1280.png`: what **SLOs at risk** opened before the review: every SLO, with
  no filter set.
- `after-slos-at-risk-1280.png`: what it opens now while SLOs are at risk: the SLOs list with its
  **Status · At Risk, Budget Exhausted** and **Enabled · Enabled** chips set, **Filter 2** and
  **Clear all**, and only the two SLOs at risk. The fixture's list answer ignores filters, so for
  these two images it was made, for the run only, to apply the Status and Enabled the list asked
  for; the page, its chips and its request are the product's.
- `after-slos-at-risk-390.png`: the same on a phone, with the chips under the filter bar.
- `docs-home-390-en.png` and `docs-home-390-fa.png`: the docs paragraph under the five numbers,
  with the sentence about SLOs at risk, in English and in Persian on a phone.

The offline browser suite (`HomeOverview.spec.ts`) clicks every number and View all and checks the
address each opens, the SLOs list's chips decoded from it.
