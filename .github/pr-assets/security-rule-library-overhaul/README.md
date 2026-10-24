# Security Events: the Rule Library overhauled

Before and after frames for "This looks extremely ugly. Please overhaul it."
about Security Events > Detections > Rule Library: a library a security
engineer can scan, filter and add from.

Rendered from the real Rule Library page in headless Chromium at a 2x device
pixel ratio, from the Security Operations offline fixture
(`packages/E2E/SecurityOperations`), with the Dashboard's Tailwind build,
`Theme.css` and Inter, at production widths (the fixture's own 1440px wrapper
taken off, so 1280 is a 1280px window beside the side menu). The "before"
frames are master's bundle at e1834316cd. Every record in them is made up.
The frames are palette-compressed PNGs.

| File | Shows |
| --- | --- |
| `rule-library-1280-before.png` | Master: two columns of tall cards, each a person icon, a grey line of category and data source, the description, red tactic and technique chips, Added and View Rule; four rules in a screen, no way to tell which events a rule needs or whether they arrive, and Add All 40 Rules beside the recommended button. |
| `rule-library-1280-after.png` | One list, a row a rule: its name (which opens its details), Recommended, what it finds and its ATT&CK tags in a quiet line; the events it reads and whether they arrived in the last 7 days; its severity; Add or Added. The header is every table's: search (`/`), Add 17 Recommended Rules and a ⋯ menu; three selects narrow by category, data and status, with the count. |
| `rule-library-1280-dark-before.png` / `-after.png` | The same in the dark theme. |
| `rule-library-1024-before.png` / `-after.png` | Beside the side menu at 1024: every column in the card, the name and description wrapping. |
| `rule-library-390-before.png` | Master on a phone: one card a rule, each most of a screen tall. |
| `rule-library-390-after.png` / `rule-library-390-dark-after.png` | A phone: the selects stacked, a card a rule with its severity, events and whether they arrive on one line, Add or Added under it. |
| `not-receiving-1280-after.png` | Data you don't send yet: the 13 rules whose events this project does not send, each with Add, and Clear Filters. The filters live in the page's address. |
| `details-1280-after.png` / `details-390-after.png` | A rule's details beside the list: severity, Recommended, its category; What it reads (AWS CloudTrail, Not receiving) and how to send it, with Go to Connections; How it runs; its ATT&CK tags, each linked; its Sigma rule; Add Rule. |
| `add-recommended-1280-after.png` | Add 17 recommended rules?: what adding does, the 17 rules each with its events and whether they arrive, and how many of them have nothing to read yet. |
| `new-project-1280-after.png` | A project that sent no security event this week: said once, over the list, with Go to Connections; the data select off, no per-row status. |
| `german-1280-after.png` / `japanese-390-after.png` | German at 1280 and Japanese on a phone: every word of the page's own translated. |
