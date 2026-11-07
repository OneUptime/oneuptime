# fu-cloud-polish-lists: UI review screenshots

Screens of #6227 (the Cloud Account chip on Cloud's All Resources, accounts
named by Cloud > Accounts, a scale-only ECS update read as scaling, and
production-true operation names on the Changes lists), taken by its UI review
in headless Chromium at 2x against the repository's offline fixtures, with the
Dashboard's Inter font:

- `packages/E2E/CloudConnect` - Cloud > All Resources at
  `cloud/resources?state=connected` (`&accountreads=held|fail` for the chip's
  accounts still being read, or a read that failed once; `&lang=fa`), the AWS
  account's Changes (`&changes=ai` for OneUptime AI's rows, `&lang=de|fa`), the
  load balancer's Changes, and Cloud > Connect.
- `packages/E2E/AppPlatforms` - All Environments with `?accounts=named`.

`*-before.png` is the branch as its builder left it, `*-after.png` the branch
after the UI review: a change's operation as one box that broke inside itself
against its pieces flowing with the sentence, and a Persian page's option lines
cut at their start against cut at their own end. The other shots are the
builder's surfaces after the review.
