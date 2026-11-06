# Status page subscribers in their own language, next

How these were made: the subscriber lists are the real status page routes (StatusPagesRoutes, with
the side menu and breadcrumbs) bundled with the Dashboard's own esbuild config and rendered in
headless Chromium with the model APIs answered from memory, the Dashboard's Tailwind runtime and
the Inter font, at 2x. The emails are the real uptime report, rendered through MailService.render
from a report built by the real tree util and written in each language by StatusPageReportText.
`before-*` is the builder's branch at 741bce83ea, rendered the same way. They are not screenshots
of a running stack, and every name and number in them is made up. The status page's default
language is German (Deutsch) in every list.

- `before-list-ru.png`, `after-list-ru.png`: Microsoft Teams Subscribers in Russian. A subscriber
  who follows the page read "По умолчанию д..." - cut to fit, the language gone. It now reads
  "Deutsch (по умолчанию)", the language first, so a cut cell still names it.
- `before-list-de-dark.png`, `after-list-de-dark.png`: Email Subscribers in German, dark:
  "Seitenstandard (Deuts" became "Deutsch (Standard)".
- `before-list-en.png`, `after-list-en.png`: the same list in English, beside the side menu at
  1280: "Page default (De..." became "Deutsch (default)".
- `after-list-fa.png`: in Persian, read from the right.
- `after-add-form.png`: Add, with More fields open and the Language list open. Empty, the field
  says what the subscriber follows: "Page default (Deutsch)".
- `after-edit-form.png`: Edit, with the subscriber's own language set and clearable.
- `before-report-headings-*-375.png`, `after-report-headings-*-375.png`: the uptime report's
  table headings on a 375px phone, in German and Russian. "Verfügbark/eit" and "Доступнос/ть"
  now break where the language hyphenates them, "Verfügbar-keit" and "Доступ-ность", in mail
  clients that hyphenate (Apple Mail, iOS Mail); the others break as before.
- `after-report-en-720.png`, `after-report-de-375.png`, `after-report-fa-375.png`,
  `after-report-ja-720.png`: the whole report, in English (unchanged), German on a phone,
  Persian on a phone (read from the right) and Japanese.
