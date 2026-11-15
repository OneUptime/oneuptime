# Arabic (`ar`)

Arabic is the eighteenth language. The status page, Accounts, the admin
dashboard, public dashboards, the server's own texts (emails, chat and text
messages) and the Dashboard are fully translated: `npm run i18n:check --
--locale ar` in the Dashboard counts 0 keys left. `Common/Tests/App/ArabicLocaleGuards`
keeps it so: a key added later fails it while ar.json holds its English, until
it is translated - or, for a name, a code or an example that stays as written,
recorded with `--same-as-english` (README.md).

This file is the glossary and the choices every Arabic string follows, so the
next person who translates a key writes it the same way.

## Plurals

i18next gives Arabic six plural forms: zero, one, two, few (3-10), many
(11-99) and other (100 and up). The locale files hold the keys `en.json` holds:
the general key and `_one`, never `_zero`, `_two`, `_few` or `_many`. So
i18next uses the general key for 0, 2, 3-10, 11-99 and 100+, and the general
form must read right for every one of those counts. It does so in one of
these shapes:

| Shape | Example |
| --- | --- |
| A label and its count | `المراقبات: {{count}}`, `(العدد: {{count}})` |
| "count of the things" | `{{count}} من المراقبات الأخرى`, `تم إنشاء {{count}} من {{itemsName}}` |
| A short unit, the same for every count | `{{count}} ث` (seconds), `{{count}} د` (minutes), `{{count}} س` (hours) |
| The count after the noun | `خلال الأيام الـ{{days}} الماضية` |

The `_one` form keeps `{{count}}` and a singular noun: `{{count}} مراقبة`.
Where the English `_one` has no `{{count}}` ("A fix is waiting for
approval"), the Arabic has none either.

The short units are the ones `Intl.NumberFormat` draws for `ar` with
`unitDisplay: "short"`, so a duration reads the same whether a sentence or
`CompactDuration` wrote it. Short relative times are templates, not plurals:
`قبل {{count}} د`, `قبل {{count}} س`, `قبل {{count}} ي`.

A number that is not a plural count (the status page's `{{days}} days ago`
under its uptime bars) is written for the value it nearly always has:
`قبل {{days}} يومًا` reads right for 11 to 99 days, and every page starts
with 90.

A noun that arrives in a placeholder (`{{resourceName}}`, `{{noun}}`) is
named after a fixed noun, `هذا المورد ({{resourceName}})`, so no adjective
has to agree with a word it cannot see.

A plural noun in a placeholder (`{{itemsName}}`) arrives with its article
(`incidents` is `الحوادث`), so the sentence around it is worded for one:
`عرض كل {{itemsName}}`, `تعذّر تحديث {{itemsName}}`, and
`لا شيء من {{itemsName}} في هذه الحلقة بعد` rather than `لا توجد {{itemsName}}`,
which wants a noun without one.

## Digits and the calendar

Arabic in OneUptime writes Latin digits (0-9) and the Gregorian calendar, as
most Arabic software for engineers does: ids, versions, IP addresses, logs
and the numbers people type are in Latin digits, and a figure in a sentence
should match them. `getNumberLocale("ar")` is `ar-u-nu-latn`, which every
`Intl` date and number format takes, so month names are the Arabic Gregorian
names (يناير، فبراير ...) and every figure is Latin. Zero is never written
as a dot.

## Punctuation

- The Arabic comma `،`, semicolon `؛` and question mark `؟`. A full stop
  stays `.`.
- Lists join with `، ` (`Common/Types/Translator.ts`).
- A UI label quoted in a sentence goes in `«»`: `اختر «بث السجلات»`.
- Search syntax keeps its ASCII quotes: `"عبارة مقتبسة"`.
- A menu path keeps `>` (it mirrors in right-to-left text): `السحابة > ربط`.
  An English `→` becomes `←`, as in Persian, beside a step written in
  Arabic; between two steps left in Latin letters, which are drawn from the
  left, it stays `→` (`Services ← خدمتك ← Configuration → Configure service`).
  `›` stays `›`.
- A link that leads on ends with `←` (`كل المقاييس ←` for `All metrics →`),
  and one that leads back starts with `→` (`→ رجوع` for `← Back`), as in
  Persian.

## Direction

Arabic reads right to left everywhere Persian does: `isRightToLeftLanguage`
answers true, pages are served with `dir="rtl"`, and a server chat message
isolates each value (FSI ... PDI) so an English value keeps its brackets and
full stop at its end. Product names, protocols and plan names stay Latin
(`خطة Free`, `Slack`, `OpenTelemetry`); the browser lays them out left to
right inside the Arabic line.

### Code in a sentence

Code is written exactly as `en.json` writes it: `.env` with its dot,
`--help` with its dashes, `/.well-known/openid-configuration` with its slash,
a function with its brackets (`استدعِ الدالة grantConsent()`), a cron line as
`0 9 * * 1-5`. Do not reword code to dodge the bidi algorithm (no `ملف env`,
no Latin word put in front of a flag), and put no direction mark beside it.

The page draws it as written: every frontend's i18next sets each piece of
code in a sentence of a language read from the right apart in a
left-to-right isolate (LRI ... PDI) as it hands the sentence to the page
(`Common/UI/Utils/CodeReadsAsWritten`, which finds the code with
`Common/Types/CodeInSentence`). It does this for Arabic, Persian and any
language read from the right added later. Copying the sentence leaves the
isolate marks out. A help line, an empty state's sentence or an error
worded in Arabic is laid out from the right however much code and however
many product names it gives in Latin letters
(`getTranslatedLineDirection` in `Common/UI/Utils/LineDirection`). An English
line, such as the server's answer that quotes a name typed in Arabic, still
reads left to right: its small English words (`is`, `the`, `already`) outside
quotes and code tell it apart. So keep a vendor's English label that holds
such a word in `«»` or in a Title Case name. Where a text is read by most of
its letters (`getTextReadingDirectionByMostLetters`), the code's letters do
not count.

The one mark the locale files keep is a left-to-right mark (LRM, U+200E)
on each side of a lone key's sign in brackets, so the sign is not drawn
mirrored: the brace of `جلسة أحدث لهذا المستخدم (})` is written as LRM, `}`,
LRM. The guard
`Common/Tests/App/CodeInRightToLeftSentences.test.ts` lays every Arabic and
Persian sentence out with a copy of the bidi algorithm, fails on a mark
beside code and on code written without the sign the English gives it.

The server's texts (`Common/Server/Locales`: emails, chat messages) are not
set apart. Whatever shows them lays them out, so wording around code still
matters there.

### Numbers in a sentence

A sentence the page draws sets each value apart in an isolate (FSI ... PDI)
where it could move the words round it: a Latin name, a time, a count
(`setsValuesApart` in `Common/Types/Translator.ts`). Two counts joined by
one slash or colon (`{{online}}/{{count}}`, `{{hours}}:{{minutes}}`) and a
number after `#` (`#{{number}}`) are left as the sentence writes them, so
the bidi algorithm draws them as one number: `3/5`, never `5/3`. After
Arabic words `الحادثة #{{number}}` is drawn `42#`, the sign read first;
Persian writes a right-to-left mark (U+200F) before the `#` to draw `#۴۲`.
A number with `%` or a currency sign stays set apart, so every percent in
a sentence is drawn the same way (`%45`). The guard
`Common/Tests/App/NumbersInRightToLeftSentences.test.ts` lays every such
sentence of every frontend out.

The Tatweel (`ـ`, as in `الـ CronJob` and `لـ SMTP`) is an Arabic letter
wherever a text is read by most of its letters
(`getTextReadingDirectionByMostLetters`), as the bidi algorithm reads it.
`Common/Tests/App/TatweelInArabicSentences.test.ts` reads every Arabic text
that writes one.

### Other text

- A negative number is written out: `سالب 70 dBm`.
- A Latin aside in brackets right after a Latin name reads before the name:
  write `{{file}} في VS Code`, or put an Arabic word inside the brackets
  (`(السمات {{attributes}})`).
- A range is written out: `من 5 إلى 15 دقيقة`.

### Quoting what the page shows

A label, a state or a button quoted in `«»` is quoted as the page draws it.
If the page translates it, quote the Arabic the page shows
(`«متوقف عن التشغيل»`, not `«Powered off»`). If the page draws it in English
(a vendor's column or state, a template's name, a permission title that is
not a translation key), quote the English (`«Manage Billing»`, `«TX Power»`).
The guard `Common/Tests/App/QuotedWordsInRightToLeftSentences.test.ts`
fails on a quoted Latin phrase that the Dashboard translates, unless its
allowlist gives the reason the page shows it in English.

## Fonts

Arabic script is drawn with Vazirmatn, self-hosted as woff2 next to Inter (no
font is fetched from another site). Latin text keeps Inter.

## Glossary

| English | Arabic |
| --- | --- |
| Monitor | المراقبة (المراقبات) |
| Incident | الحادثة (الحوادث) |
| Alert | التنبيه (التنبيهات) |
| Status page | صفحة الحالة |
| Scheduled maintenance | الصيانة المجدولة |
| On-Call, On-Call Duty | المناوبة |
| On call (a person) | مناوب |
| Page (verb) | يستدعي، استدعاء |
| Acknowledge | الإقرار |
| Severity | الخطورة |
| State (incident, alert) | الحالة |
| Case status (security) | الوضع (الأوضاع) |
| Security case | الحالة الأمنية |
| Episode | الحلقة |
| Postmortem | تقرير ما بعد الحادثة |
| Owners | المالكون |
| Labels | التسميات |
| Tags | الوسوم |
| Workflow | سير العمل (مهام سير العمل) |
| Trigger (noun) | المحفّز (المحفّزات) |
| Runner | المشغّل (المشغّلات) |
| Runbook | دليل التشغيل (أدلة التشغيل) |
| Playbook | دليل الإجراءات (أدلة الإجراءات) |
| Dashboard | لوحة المعلومات |
| Insights | الرؤى |
| Telemetry | القياس عن بُعد |
| Trace | التتبع |
| Span | الامتداد |
| Span Type / Span Kind | نوع الامتداد / صنف الامتداد |
| Waterfall | المخطط الشلالي |
| Latency | زمن الانتقال |
| Response time (a monitor's request) | زمن الاستجابة |
| Response time (SLA, to acknowledge) | وقت الاستجابة |
| Grouping rule | قاعدة التجميع |
| Parent monitor | المراقبة الأم |
| Suppressed (alerts) | مكتومة |
| Re-investigation cooldown | فترة التهدئة قبل إعادة التحقيق |
| Measurement | القياس |
| Criteria (a monitor's) | المعيار (المعايير) |
| Filters (of a criteria, a list) | عوامل التصفية |
| Matched / Did not match | مطابق / غير مطابق |
| Investigation (AI) | التحقيق |
| Triage (an investigation step, a state) | الفرز |
| Remediation | المعالجة |
| Verdict | الحكم |
| Tokens (AI) | الرموز |
| Prompt (AI) | المطالبة (المطالبات) |
| LLM provider | موفّر LLM (موفّرو LLM) |
| OneUptime AI | OneUptime AI (a product name) |
| Responders | المستجيبون |
| Feed (an incident's, an alert's) | الموجز |
| Incident Commander | قائد الحادثة |
| Call transcript | النص المكتوب للمكالمة |
| Ingestion key | مفتاح الاستيعاب |
| Probe | المسبار (المسابير) |
| Collector | المجمّع (OpenTelemetry Collector stays Latin) |
| Pipeline (telemetry) / Pipeline (data) | مسار المعالجة / مسار البيانات |
| Host | المضيف (المضيفون) |
| Instance (cloud, database, VM) | المثيل (المثيلات) |
| Instance (a OneUptime installation) | النسخة |
| Inventory | الجرد |
| Workload | حمل العمل (أحمال العمل) |
| Container | الحاوية (الحاويات) |
| Bucket (object storage) | حاوية التخزين; الحاوية alone once S3 or Cloud Storage is named |
| Pool | المجمّع (المجمّعات) |
| Availability / High availability / Availability zone | التوفر / التوفر العالي / منطقة التوفر |
| Serverless function | دالة بلا خادم |
| Walk (SNMP) | الاستعراض |
| Release (a software version) | الإصدار |
| Threat intel | استخبارات التهديدات |
| Receiver | مستقبِل |
| Workspace | مساحة العمل |
| Connect | ربط |
| Project Settings | إعدادات المشروع |
| Advanced | متقدم |
| Detection rule | قاعدة كشف |
| Entity risk | مخاطر الكيانات |
| Observable | المُلاحَظ |
| Storage array | مصفوفة التخزين |
| Data store, Datastore (VMware) | مخزن البيانات (مخازن البيانات) |
| Merge request / Pull request | طلب دمج / طلب سحب |
| Operational / Degraded / Offline | يعمل بشكل طبيعي / متدهور / غير متصل |
| Turn on / Turn off | تفعيل / إيقاف |
| Webhook (in a sentence) | خطاف الويب |
| Code (the product, a code block) | التعليمات البرمجية |
| Huddle (Slack's) | huddle |

Kept in Latin letters: product, vendor and protocol names, plan names, the
default teams Owners, Admin and Members, and units such as `ms` and `GB`.
A duration drawn on its own, the `{{value}} ms` every monitor summary
writes (`Dashboard/src/Utils/Milliseconds`), is the exception: it reads
Intl's short unit, `{{value}} ملي ث`, as the durations `DateLanguage`
writes do, so a page read from the right never reads "ms 411". The
network path's DNS sentence (`... خلال {{time}} ملي ث`) uses the same
unit as the traceroute hops listed under it, and the Response time card's
`Latest: ...` sentence (`الأحدث: الوسيط {{median}} ملي ث ...`) the same
unit as the probe durations listed beside it.
The Dashboard's list of texts Arabic writes as English on purpose is
`sameAsEnglish` in `../../i18n/Progress/ar.json`.

Latency, a datastore and the inventory are named in well over a hundred texts
each. `Common/Tests/App/ArabicLocaleGuards` fails when a text whose English names
one in a sentence says it in other words than the table's; a metric's dotted
name, a placeholder or an identifier is not a sentence.
