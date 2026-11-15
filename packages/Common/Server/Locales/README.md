# The server's words, in the reader's language

Every frontend shows its own words in the reader's language (its `Locales`
folder). The files here hold the words the **server** writes for a reader in
a language of their own:

- a status page's notifications to its subscribers - incidents, their notes,
  states and postmortems, incident episodes, scheduled maintenance and its
  notes and states, and announcements - by email, text message, Slack and
  Microsoft Teams;
- the messages about a subscription: the link to confirm it, the welcome,
  and the link to manage it;
- the status page's uptime report (`StatusPageService.sendEmailReport`),
  its figures written in the language too
  (`Common/Utils/StatusPage/ReportText.ts`);
- a person's on-call pages, in the language on their account
  (`Common/Types/UserLanguage`, read by
  `Common/Server/Utils/Notification/UserLanguage.ts`): email, text message,
  push notification, Telegram and their own Slack, Microsoft Teams and
  Mattermost messages - a first page, a page again, a page a person sent
  and an observer's page (`Common/Types/OnCallDutyPolicy/OnCallPageWords.ts`
  and the files beside it). Calls and WhatsApp stay English.
- the words of a record the server makes for a person, which become the
  project's own text once saved: a new monitor's default criteria - each
  criteria's name and description, and the incident and alert it opens -
  when Ask AI sets up a website monitor (`set_up_website_monitoring`), and
  the name a status page starts with ("Acme Status") when Ask AI publishes
  one the person did not name (`publish_status_page`), in the language the
  person reads the Dashboard in, as the guided setups name them
  (`ServerTranslation.getRecordWordsTranslator`). These sentences are the
  Dashboard's: see "Sentences the Dashboard words" below.

Everything else the server writes - the other emails, texts, calls and
pushes to a project's own team, every API answer, feed items - is still
English.

## Which language a message is written in

A subscriber is written to in the language they read the status page in when
they signed up, or last changed their subscription there, when that was not
the page's default language, and otherwise in the page's **Default Language**
(its Branding page). A subscriber the team
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
reads exactly as written. A custom template is one text for every
subscriber: the values OneUptime fills it with that are its own words - a
default state's name, `None`, `Yes` / `No`, a date, the report's figures -
are written in the page's default language
(`Common/Server/Utils/StatusPage/SubscriberTemplateValues.ts`), and so is a
test report.

## How it works

- **The key is the English text**, as in the Dashboard's files: `en.json` maps
  `"[Incident] {{title}}"` to itself, `de.json` to `"[Vorfall] {{title}}"`.
- `Common/Server/Utils/ServerTranslation.ts` builds a `Translator` - the same
  one every frontend uses (`Common/Types/Translator.ts`, which the frontends'
  `Common/UI/Utils/TranslateTemplate.ts` re-exports) - for a language:
  `getServerTranslator(language)`. Server code imports the translator from
  `Common/Types/Translator`, never from `UI/`: that would load i18next for
  nothing. `writeInLanguage(language, (translator) => ...)` also writes
  OneUptime's dates in that language while it runs. It is synchronous: never
  wait on anything inside it.
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
3. Translate it in all 16 files
   (`de fr es it pt nl da no sv ru ja ko zh-CN zh-TW hi fa`): keep every
   `{{placeholder}}`, keep what the English ends
   with, use the words the file already uses, and the register the status
   page uses (German `Sie`, Spanish `usted`). A word that really reads the same
   in a language (`Status` in German) goes in `SameAsEnglish.json` under that
   language. So does a plural's `_one` key that a language words as English
   does (`"{{count}} minutes_one"` in French). The translator then reads that
   form as the language's own, so French says "0 minute". Unlisted, a `_one`
   form equal to English's is read as English left in the file, and French
   would say "0 minutes".

## Sentences the Dashboard words

A sentence the Dashboard writes too, for a record a person makes (a new
monitor's default criteria, `Common/Types/Monitor/MonitorCriteriaInstance.ts`,
and a new status page's name, `Common/Utils/GuidedSetup/StatusPageRecords.ts`),
must read the same whichever way the record was made, so it is never
worded here by hand. The files `DASHBOARD_SHARED_TEXT_SOURCES` lists
(`Common/Scripts/I18n/ServerLocales.ts`) are worded in the Dashboard's locale
files (`App/FeatureSet/Dashboard/src/Locales`), and `npm run i18n:server-sync`
copies each language's wording of their sentences from there - the English
while the Dashboard has none yet. After changing or translating such a
sentence in the Dashboard, run `npm run i18n:server-sync` too. They are put
together as the Dashboard puts them: their values are never set apart with
isolate marks, which a record would keep.

`packages/Common/Tests/Server/Locales/ServerLocales.test.ts` holds the files to
all of this. `npm run i18n:validate` checks them with every frontend's.
