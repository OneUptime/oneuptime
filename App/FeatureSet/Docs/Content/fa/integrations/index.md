# یکپارچه‌سازی‌ها

OneUptime از راه **[گردش‌های کاری](/docs/workflows/index)**، موتور خودکارسازی توکار، به ابزارهایی که تیم شما از پیش به کار می‌برد وصل می‌شود — Zabbix، Jira، PagerDuty، Slack و بسیاری دیگر. هیچ افزونه جداگانه‌ای برای نصب وجود ندارد. یکپارچه‌سازی را روی یک بوم کشیدنی-رهاکردنی سیم‌کشی می‌کنید و هر وقت اتفاقی بیفتد اجرا می‌شود.

این صفحه دو الگویی را توضیح می‌دهد که هر یکپارچه‌سازی به کار می‌برد. وقتی آن‌ها را فهمیدید، می‌توانید OneUptime را تقریباً به هر چیزی وصل کنید، حتی ابزارهایی که اینجا صفحه اختصاصی ندارند.

## دو الگو

هر یکپارچه‌سازی داده را در یکی از دو جهت جابه‌جا می‌کند (و بسیاری هر دو را به کار می‌برند).

### ورودی — ابزاری دیگر داده را به درون OneUptime می‌فرستد

وقتی از این استفاده کنید که سامانه‌ای بیرونی لازم دارد _چیزی را در OneUptime بسازد یا به‌روزرسانی کند_ — معمولاً هنگام تشخیص مشکل، یک حادثه یا هشدار باز کند.

1. گردش کاری‌ای بسازید که با یک **[تریگر وب‌هوک](/docs/workflows/triggers#webhook)** آغاز شود. OneUptime نشانی یکتایی به شما می‌دهد.
2. در ابزار دیگر، یک کنش وب‌هوک/اعلان پیکربندی کنید که هنگام رخ دادن چیزی به آن نشانی POST کند.
3. در گردش کاری، محموله ورودی را بخوانید و برای ثبتش از یک مؤلفه **Create Incident** (یا Create Alert) استفاده کنید.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

> **نکته:** به‌ویژه برای ابزارهای هشداردهی، یک **[مانیتور درخواست ورودی](/docs/monitor/incoming-request-monitor)** معمولاً مسیر ورودی بهتری است. بدون ساختن گردش کاری نشانی وب‌هوکی به شما می‌دهد، به ازای هر هشدار در محموله یک حادثه باز می‌کند، به یک سیاست کشیک تشدید می‌کند و هر حادثه را وقتی ابزار بهبود را گزارش داد برطرف می‌کند. وقتی سراغ گردش کاری بروید که به منطقی نیاز دارید که OneUptime به‌صورت بومی انجامش نمی‌دهد. برای نمونه‌ای عملی [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) را ببینید.

### خروجی — OneUptime داده را به ابزاری دیگر می‌فرستد

وقتی از این استفاده کنید که _چیزی در OneUptime باید در ابزاری دیگر پدیدار شود_ — باز کردن یک تیکت Jira، فراخواندن کسی در PagerDuty، ارسال به Slack.

1. گردش کاری‌ای بسازید که با یک **[تریگر رویداد OneUptime](/docs/workflows/triggers#oneuptime-event-triggers)** آغاز شود — برای نمونه **Incident → On Create**.
2. یک **[مؤلفه API](/docs/workflows/components#api)** اضافه کنید که API RESTِ ابزار دیگر را با جزئیات حادثه فرا می‌خواند.
3. هر کلید APIای را به‌عنوان **[متغیر سراسری](/docs/workflows/variables#global-variables) محرمانه** ذخیره کنید تا هرگز در گردش کاری یا گزارش‌هایش پدیدار نشود.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## فهرست

| ابزار | جهت | چه می‌کند |
| --------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix) | ورودی | مشکل‌های Zabbix را به حادثه‌های OneUptime تبدیل می‌کند (و هنگام بهبود برطرفشان می‌کند). |
| [Jira](/docs/integrations/jira) | خروجی (+ ورودی) | برای هر حادثه یک issue در Jira باز می‌کند؛ وضعیت را برمی‌گرداند. |
| [PagerDuty](/docs/integrations/pagerduty) | خروجی (+ ورودی) | رویدادهای PagerDuty را از حادثه‌های OneUptime راه می‌اندازد و برطرف می‌کند. |
| [Opsgenie](/docs/integrations/opsgenie) | خروجی (+ ورودی) | هشدارهای Opsgenie را می‌سازد و می‌بندد. |
| [ServiceNow](/docs/integrations/servicenow) | خروجی (+ ورودی) | حادثه‌های ServiceNow را از OneUptime باز می‌کند. |
| [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) | خروجی (+ ورودی) | Caseهای Dynamics 365 را از حادثه‌های OneUptime باز و برطرف می‌کند. |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | ورودی | اعلان‌های Alertmanager را به حادثه تبدیل می‌کند. |
| [Grafana](/docs/integrations/grafana) | ورودی | هشدارهای Grafana را به حادثه تبدیل می‌کند. |
| [Datadog](/docs/integrations/datadog) | ورودی | هشدارهای مانیتور Datadog را به حادثه تبدیل می‌کند. |
| [GitHub](/docs/integrations/github) | خروجی | برای یک حادثه، issue در GitHub باز می‌کند. |
| [GitLab](/docs/integrations/gitlab) | خروجی | برای یک حادثه، issue در GitLab باز می‌کند. |
| [Discord](/docs/integrations/discord) | خروجی | به‌روزرسانی‌های حادثه را به کانالی در Discord می‌فرستد. |
| [Telegram](/docs/integrations/telegram) | خروجی | به‌روزرسانی‌های حادثه را به گفت‌وگویی در Telegram می‌فرستد. |
| [Slack](/docs/workspace-connections/slack) | هر دو | اتصال بومی فضای کاری — کانال‌ها، هشدارها و کشیک. |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams) | هر دو | اتصال بومی فضای کاری. |

> **Slack و Microsoft Teams** اتصالی بومی و عمیق‌تر دارند که فراتر از گردش‌های کاری می‌رود — کانال‌های خودکار حادثه، کنش‌های دوطرفه و اعلان‌های کشیک. برای آن‌ها به‌جای ساختن گردش کاری، از اتصال‌های فضای کاری [Slack](/docs/workspace-connections/slack) و [Microsoft Teams](/docs/workspace-connections/microsoft-teams) استفاده کنید.

## مدیریت اسرار

هرگز کلید API یا توکنی را مستقیم درون یک بلوک نچسبانید. به‌جایش:

1. به **Workflows → Global Variables** بروید.
2. متغیری بسازید — برای نمونه `JIRA_AUTH` — و **Secret** را روشن کنید.
3. هر جا با `{{global.variables.JIRA_AUTH}}` به آن ارجاع دهید.

متغیرهای محرمانه پس از ذخیره در رابط کاربری پنهان می‌شوند و از گزارش‌های اجرا پاک می‌شوند. [متغیرها](/docs/workflows/variables#global-variables) را ببینید.

## برگه تقلب احراز هویت

بیشتر یکپارچه‌سازی‌های خروجی روی بلوک API به هدر `Authorization` نیاز دارند. شکل‌های رایج:

| طرح | مقدار هدر | به کار رفته در |
| --------------------------- | -------------------------------------------------- | ----------------------------------- |
| توکن Bearer | `Bearer {{global.variables.TOKEN}}` | GitHub، بسیاری از APIهای امروزی |
| احراز هویت Basic | `Basic {{global.variables.BASE64_USER_PASS}}` | Jira Cloud، ServiceNow |
| هدر کلید API | `GenieKey {{global.variables.OPSGENIE_KEY}}` | Opsgenie |
| توکن در بدنه | فیلد `routing_key` در بدنه JSON | PagerDuty Events API |
| هدر توکن خصوصی | `PRIVATE-TOKEN: {{global.variables.GITLAB_TOKEN}}` | GitLab |
| اعتبارنامه‌های کلاینت OAuth 2.0 | `Bearer <token fetched by an earlier API block>` | Microsoft Dynamics 365 (Dataverse) |

برای احراز هویت Basic، مقدار `username:password` (یا `email:api_token`) را **یک بار** با base64 رمزگذاری کنید و سپس نتیجه را به‌عنوان راز ذخیره کنید. روی macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## ابزارتان را نمی‌بینید؟

تقریباً هر ابزاری در یکی از دو الگوی بالا جا می‌شود:

- اگر ابزار می‌تواند هنگام رخ دادن چیزی **وب‌هوک بفرستد**، از الگوی **ورودی** استفاده کنید — اگر ابزار هشداردهی است وب‌هوکش را به یک [مانیتور درخواست ورودی](/docs/monitor/incoming-request-monitor) نشانه بگیرید، یا اگر منطق سفارشی لازم دارید به یک تریگر وب‌هوک OneUptime.
- اگر ابزار **API REST** دارد، از الگوی **خروجی** استفاده کنید — آن را از یک **مؤلفه API** فرا بخوانید.
- اگر لازم است داده را میان این دو بازشکل دهید، یک بلوک **[کد سفارشی](/docs/workflows/components#custom-code)** بگذارید.

این دنباله بلند را پوشش می‌دهد — Zendesk، AWS CloudWatch (از راه SNS)، New Relic، Splunk، StatusCake و مانند آن. دستور کار همان است؛ فقط نشانی و محموله تغییر می‌کند.

## در ادامه چه بخوانیم

- [نمای کلی گردش‌های کاری](/docs/workflows/index) — موتور خودکارسازی چگونه کار می‌کند.
- [تریگرها](/docs/workflows/triggers) — تریگرهای وب‌هوک و رویداد OneUptime با جزئیات.
- [مؤلفه‌ها](/docs/workflows/components) — مؤلفه‌های API، وب‌هوک و داده.
- [متغیرها](/docs/workflows/variables) — اسرار و انتقال داده میان بلوک‌ها.
- [مانیتور درخواست ورودی](/docs/monitor/incoming-request-monitor) — مسیر ورودی بدون گردش کاری برای ابزارهای هشداردهی.
- [Zabbix](/docs/integrations/zabbix)، [Jira](/docs/integrations/jira) و [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — نمونه‌های عملی کامل.
