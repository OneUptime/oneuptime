# Cloud follow-ups, part 1: the UI review

How these were made: the offline fixtures of `packages/E2E/CloudConnect`
(`node CloudConnect/server.js`: Cloud > Accounts, an AWS account and its
resources, as the real pages draw them) and `packages/E2E/CloudSpend`
(`node CloudSpend/Fixture/server.js`: Cloud's Overview and Spend), with the
Dashboard's esbuild config, Tailwind, theme and Inter, in Chromium at twice
the pixels. Each "before" is the builder's branch (65724c13ac) with the same
fixture and data; each "after" is the reviewed branch.

- `hero-identifier-en-*`: a resource's hero, 1280. The identifier line
  ("type: Elastic Load Balancer (ALB, NLB, GWLB)") had lost its monospace on
  every resource page: set apart in two elements, each took the page's
  universal Inter rule. Both pieces are monospace again, a monospace space
  between them.
- `connected-resources-fa-*`: a resource's Connected Resources in Persian,
  1280. "web-1EC2 Instance" read as one Latin run, left to right, with no
  gap; the name and its kind are each set apart now, in reading order, with
  the gap beside the name.
- `changes-en-390-*`, `changes-fa-390-*`: an account's Changes on a phone,
  in English and Persian. A resource's id or name broke at its hyphen
  ("sg-" / "0f1e2d3c4b5a69788", "nightly-" / "export"); each value of a
  change's title is a box that moves to the next line whole now. The health
  event's English is set in its own direction on the Persian page, so its
  cut is at its end.
- `app-platforms-de-390-*`: the App Platforms card on Cloud's Overview, in
  German on a phone, where the card's description is folded away. "The
  lists also hold 1 environment in an account Cloud does not read" said
  neither which lists nor what "not read" means; the line names App
  Platforms and says "not connected to Cloud", the words Cloud > Connect
  uses.
