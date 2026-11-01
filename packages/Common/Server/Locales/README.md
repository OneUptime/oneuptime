# The server's words, in the reader's language

Every frontend shows its own words in the reader's language (its `Locales`
folder). The files here hold the words the **server** writes for a reader in
a language of their own:

- a status page's notifications to its subscribers - incidents, their notes,
  states and postmortems, incident episodes, scheduled maintenance and its
  notes and states, and announcements - by email, text message, Slack and
  Microsoft Teams;
- the messages about a subscription: the link to confirm it, the welcome,
  and the link to manage it.

Everything else the server writes - the emails, texts, calls and pushes to a
project's own team, every API answer, feed items, the status page's uptime
report - is still English.

## Which language a message is written in

A subscriber is written to in the language they read the status page in when
they signed up, when that was not the page's default language, and otherwise
in the page's **Default Language** (its Branding page). A subscriber the team
added, and one who signed up before this, has no language of their own and
follows the page's default - also when the team changes it.
`Common/Server/Utils/StatusPage/SubscriberLanguage.ts` decides it; the status
page sends the language it is read in as each request's `Accept-Language`
(`StatusPage/src/Utils/API.ts`), and a sign-up stores it
(`StatusPageSubscriber.language`).

What changes is OneUptime's own words: subjects, headings, labels, buttons,
sentences, OneUptime's default names of states and severities (`Identified`,
`Resolved`, `Major Incident`, `Ongoing`...) and dates. What the team wrote -
titles, descriptions, notes, names of their own states, a custom template -
reads exactly as written.

## How it works

- **The key is the English text**, as in the Dashboard's files: `en.json` maps
  `"[Incident] {{title}}"` to itself, `de.json` to `"[Vorfall] {{title}}"`.
- `Common/Server/Utils/ServerTranslation.ts` builds a `Translator` - the same
  one every frontend uses (`Common/UI/Utils/TranslateTemplate.ts`) - for a
  language: `getServerTranslator(language)`. `writeInLanguage(language,
  (translator) => ...)` also writes OneUptime's dates in that language while
  it runs. It is synchronous: never wait on anything inside it.
- **A sentence is translated whole, or not at all.** Values go in through
  `{{placeholders}}`; a sentence a language has not worded reads wholly in
  English, values and all.
- A state's or severity's name goes into a sentence as
  `SubscriberMessageText.stateName(name)`: OneUptime's default names in the
  sentence's language (the status page's own words for them,
  `statusNames` in `StatusPage/src/Locales`), a project's own as written.
- **A template whose values are translated** (`{{state}}`, `{{severity}}`)
  must be worded differently from the English in every language: a wording
  equal to the English reads as not translated, and its values would be
  English.
- **Emails** word their own text in the templates
  (`App/FeatureSet/Notification/Templates`) with the helpers in
  `Notification/Utils/EmailLanguage.ts` - `t`, `tHtml`, `tt`, `ttHtml`, `tp`,
  `emailStart`, `emailEnd` - in the language the sender puts on the email
  (`EmailEnvelope.language`). An email in Persian is laid out right to left.
- **Text messages** keep a space before every link in every language: a link
  goes out exactly as written (`Common/Utils/Sms/SubscriberSms.ts`), and only a
  word that starts with it is a link.

## Adding or changing a sentence

1. Write it in the code with `translationKey("...")`, or look it up with
   `translator.translateTemplate("...", values)` /
   `translator.translateText("...")`, in a file `SERVER_TEXT_SOURCES` lists
   (`Common/Scripts/I18n/ServerLocales.ts`) - or with a helper in an email
   template: `{{t "..."}}`, `title=(tt "New Incident: {{title}}" title=incidentTitle)`.
2. From the repository's root: `npm run i18n:server-sync`. It writes `en.json`
   from the sources and gives every other file the new sentence in English.
3. Translate it in all 16 files (`de fr es it pt nl da no sv ru ja ko zh-CN
   zh-TW hi fa`): keep every `{{placeholder}}`, keep what the English ends
   with, use the words the file already uses, and the register the status
   page uses (German `Sie`, Spanish `usted`). A word that really reads the same
   in a language (`Status` in German) goes in `SameAsEnglish.json` under that
   language.

`packages/Common/Tests/Server/Locales/ServerLocales.test.ts` holds the files to
all of this. `npm run i18n:validate` checks them with every frontend's.
