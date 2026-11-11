# Code in Arabic and Persian sentences, and quotes as the page shows them (#6655, #6659)

How these were made: the reading-direction fixture (`packages/E2E/ReadingDirection/Fixture`)
bundles the production `FieldLabel` and Translator with the app's esbuild config, loads the
Dashboard's real `ar.json` and `fa.json`, and is drawn in headless Chromium by
`ReadingDirection.spec.ts` ("code in a sentence read from the right"). Run
`npm run test-reading-direction-ui` in `packages/E2E` to write them to
`output/playwright/reading-direction/`. They are not screenshots of a running stack. Every
sentence is one the Dashboard shows today.

- `code-in-sentences-ar-1280.png` and `code-in-sentences-fa-1280.png` show the help texts as the
  page draws them now. Each sentence starts at the right, and each piece of code reads left to
  right as written: `/var/lib/docker/containers`, `--help`,
  `--disable-metric=neutron-quota_network`, `grantConsent()`, `0 9 * * 1-5`, `.env`,
  `OneUptimeReplay.grantConsent()`, and the address `{{url}}/otlp` with the value filled in.
  Under them, three help texts that name more products in Latin letters than they have words
  of their own (the SMTP server's hostname, the authenticator apps, the detected status page
  provider) also start at the right, their words in order. Then a key's sign in brackets (`}`,
  `{`, `<`, `>`) is drawn unmirrored. The last two sentences quote states as the page names
  them. In Arabic: «قيد التشغيل», «متوقف عن التشغيل» and «القالب», then «سليم», «غير مستخدم»
  and «غير سليم». Persian names the states without quotation marks. Persian has no translation
  yet for the Quotas, Agent and authenticator help, so those three stay in English.
- `-dark-1280` and `-dark-390` are the same in dark mode, and `-390` is a phone width.
- `code-in-sentences-ar-as-the-file-holds-it-1280.png` and
  `code-in-sentences-fa-as-the-file-holds-it-1280.png` are the negative control: the same
  sentences as the locale files hold them, with no code set apart. Persian's `--help` reads
  `help--`, and both languages' path puts its slash at the far end. Arabic's flag and `.env`
  put their sign at the far end, and `grantConsent()` its brackets before the name. The
  sentences themselves still start at the right.
- `names-in-help-ar-before.png` and `names-in-help-ar-after.png` are the three Arabic help
  texts that name products, cropped from the same fixture at twice the size. Before, each was
  laid out from the left because it has more Latin letters than Arabic ones, so its words came
  out in the wrong order ("اسم مضيف خادم" at the left end). After, each reads from the right.
  The before picture was made by turning the new rule off in
  `Common/UI/Utils/LineDirection.ts` (`getTranslatedLineDirection`) for one run.
- `server-answers-ar.png` and `server-answers-fa.png` are English answers from the server that
  quote a channel name typed in Arabic or Persian, on an Arabic and a Persian page, at twice the
  size: `ErrorMessage` (the first line), `FieldError` (in red) and `TableEmptyState` (under its
  title in the page's words). Each reads left to right, its full stop at its end, as on main.
  The rule that draws a translated line the page's way leaves a line with English words of its
  own (`hasEnglishWords` in `Common/Types/ReadingDirection.ts`) to most of its letters. They
  were drawn by a page that bundles the production components with the app's esbuild config,
  as the fixture does, and the Dashboard's real `ar.json` and `fa.json`.
