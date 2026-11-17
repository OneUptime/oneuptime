# fu-cloud-polish-words: UI review screenshots

Screens of #6220 (a security case's Story and Impact in every language, cloud
health event descriptions in the reader's words, right-to-left hero labels and
record headings), taken by its UI review in headless Chromium at 2x against the
repository's offline fixtures, with the Dashboard's Inter font:

- `packages/E2E/SecurityOperations` - the case
  `cases/20000000-0000-4000-8000-000000000141` (its Impact) and
  `cases/20000000-0000-4000-8000-000000000142/story`, `?lang=de|fa|ja`,
  `&theme=dark`, the clock fixed at 2026-10-14 12:00 UTC as the suite fixes it.
- `packages/E2E/CloudConnect` - the Azure account's Changes with
  `?state=connected&changes=health&lang=de|fa`, a resource's Overview with
  `?state=connected&lang=fa`.
- `packages/E2E/AppPlatforms` - the Checkout environment with `?lang=fa`.

`*-before.png` is the branch as its builder left it, `*-after.png` the branch
after the UI review. `impact-health-title-fa.png` shows a cloud health event as
a record's last change: the fixture has no such case, so for this one shot its
case context was given an AWS Health change for the moment it was taken (not
committed).
