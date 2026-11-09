# Arabic (`ar`)

Arabic is the eighteenth language. The status page, Accounts, the admin
dashboard, public dashboards and the server's own texts (emails, chat and
text messages) are fully translated. The Dashboard is partly translated:
its most-used surfaces come first, and every key still in English falls
back to English (`npm run i18n:check` in the Dashboard counts what is left).

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

A noun that arrives in a placeholder (`{{resourceName}}`, `{{noun}}`) is
named after a fixed noun, `هذا المورد ({{resourceName}})`, so no adjective
has to agree with a word it cannot see.

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
| Response time | زمن الاستجابة |
| Ingestion key | مفتاح الاستيعاب |
| Probe | المسبار |
| Collector | المجمّع |
| Receiver | مستقبِل |
| Workspace | مساحة العمل |
| Connect | ربط |
| Project Settings | إعدادات المشروع |
| Advanced | متقدم |
| Detection rule | قاعدة كشف |
| Entity risk | مخاطر الكيانات |
| Observable | المُلاحَظ |
| Storage array | مصفوفة التخزين |
| Data store | مخزن البيانات |
| Merge request / Pull request | طلب دمج / طلب سحب |
| Operational / Degraded / Offline | يعمل بشكل طبيعي / متراجع / غير متصل |
| Turn on / Turn off | تفعيل / إيقاف |
| Webhook (in a sentence) | خطاف الويب |

Kept in Latin letters: product, vendor and protocol names, plan names, the
default teams Owners, Admin and Members, and units such as `ms` and `GB`.
The Dashboard's list of texts Arabic writes as English on purpose is
`sameAsEnglish` in `../../i18n/Progress/ar.json`.
