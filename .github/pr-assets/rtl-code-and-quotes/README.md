# Code in Arabic and Persian sentences, and quotes as the page shows them (#6655, #6659)

How these were made: the reading-direction fixture (`packages/E2E/ReadingDirection/Fixture`)
bundles the production `FieldLabel` and Translator with the app's esbuild config, loads the
Dashboard's real `ar.json` and `fa.json`, and is drawn in headless Chromium by
`ReadingDirection.spec.ts` ("code in a sentence read from the right"). Run
`npm run test-reading-direction-ui` in `packages/E2E` to write them to
`output/playwright/reading-direction/`. They are not screenshots of a running stack.

- `code-in-sentences-ar-1280.png` and `code-in-sentences-fa-1280.png` show the help texts as the
  page draws them now. Each sentence starts at the right, and each piece of code reads left to
  right as written: `/.well-known/openid-configuration`, `--help`,
  `--disable-metric=neutron-quota_network`, `grantConsent()`, `0 9 * * 1-5`, `.env`,
  `OneUptimeReplay.grantConsent()`, and the address `{{url}}/otlp` with the value filled in.
  Under them, a key's sign in brackets (`}`, `{`, `<`, `>`) is drawn unmirrored. The last two
  sentences quote states as the page names them. In Arabic: «قيد التشغيل», «متوقف عن التشغيل»
  and «القالب», then «دائمًا» and «عند الخطأ أو الإحباط». In Persian: «همیشه» and
  «هنگام خطا یا کلافگی» (its VM sentence names the states without quotation marks).
  Persian has no translation yet for the Quotas and Agent help, so those two stay in English.
- `-dark-1280` and `-dark-390` are the same in dark mode, and `-390` is a phone width.
- `code-in-sentences-ar-as-the-file-holds-it-1280.png` and
  `code-in-sentences-fa-as-the-file-holds-it-1280.png` are the negative control: the same
  sentences as the locale files hold them, with no code set apart. Persian's `--help` reads
  `help--`. Arabic's flag and `.env` put their sign at the far end, and `grantConsent()` its
  brackets before the name. The Arabic replay sentence (Persian's OIDC help, likewise) is laid
  out from the left, because its code has more Latin letters than the sentence has Arabic ones.
