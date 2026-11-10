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
  An English `→` becomes `←`, as in Persian. `›` stays `›`.

## Direction

Arabic reads right to left everywhere Persian does: `isRightToLeftLanguage`
answers true, pages are served with `dir="rtl"`, and a server chat message
isolates each value (FSI ... PDI) so an English value keeps its brackets and
full stop at its end. Product names, protocols and plan names stay Latin
(`خطة Free`, `Slack`, `OpenTelemetry`); the browser lays them out left to
right inside the Arabic line.

The locale files hold no direction marks, so a string is worded so the
browser's own rules lay it out right:

- A Latin word that starts with a dot, a dash, a slash or a hash right after
  Arabic shows that sign at its far end (`.env` reads `env.`). Put a Latin
  word before it (`شبكة CIDR /24`, `الأمر helm upgrade --reuse-values`,
  `regex ^api-.*`), or name the format without its dot (`ملف VTT`,
  `ملف env`).
- A negative number is written out: `سالب 70 dBm`.
- A function keeps its brackets, as the English writes it and as the suites
  that hold code to its written form expect: `استدعِ الدالة grantConsent()`.
  A right-to-left line can draw the brackets on the name's left; keeping code
  in its own direction inside a line is the page's job, not the locale's.
- A Latin aside in brackets right after a Latin name reads before the name:
  write `{{file}} في VS Code`, or put an Arabic word inside the brackets
  (`(السمات {{attributes}})`).
- A range is written out: `من 5 إلى 15 دقيقة`.

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
The Dashboard's list of texts Arabic writes as English on purpose is
`sameAsEnglish` in `../../i18n/Progress/ar.json`.

Latency, a datastore and the inventory are named in well over a hundred texts
each. `Common/Tests/App/ArabicLocaleGuards` fails when a text whose English names
one in a sentence says it in other words than the table's; a metric's dotted
name, a placeholder or an identifier is not a sentence.
