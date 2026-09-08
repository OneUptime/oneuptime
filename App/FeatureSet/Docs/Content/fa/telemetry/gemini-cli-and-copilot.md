# پاییدن Gemini CLI و GitHub Copilot با OneUptime

هر دو ابزار به‌طور بومی OpenTelemetry منتشر می‌کنند، پس هیچ‌کدام به پراکسی یا لفافی نیاز ندارند — صادرکننده‌هایشان را به نقطه پایانی OTLP در OneUptime نشانه بگیرید و مصرف توکن، هزینه، تأخیر و فراخوان‌های ابزارشان در بخش [AI / LLM](/docs/telemetry/ai-llm-observability) کنار اسپن‌های LLM خود برنامه‌تان فرود می‌آید.

در آن چیزی که تعیین می‌کند داده برای تسویه هزینه داخلی به کار می‌آید یا نه، با هم فرق دارند:

- **[Gemini CLI](#gemini-cli)** روی هر رکوردی که منتشر می‌کند `user.email` می‌گذارد، پس انتساب به ازای هر کارمند به هیچ به‌هم‌دوختنی و هیچ پیکربندی‌ای نیاز ندارد. تنظیم `traces` آن را هم روشن کنید: به‌طور پیش‌فرض خاموش است، و با خاموش بودنش اسپن‌هایی که Gemini CLI صادر می‌کند نه نام مدل دارند و نه شمار توکن، پس چیزی نیست که OneUptime قیمت‌گذاری‌اش کند — و Gemini CLI سنجه هزینه‌ای هم منتشر نمی‌کند.
- **[GitHub Copilot](#github-copilot)** **اصلاً هیچ ویژگی کاربری** منتشر نمی‌کند. باید خودتان یکی را، به ازای هر ماشین، تزریق کنید وگرنه خرج Copilot غیرقابل انتساب است.

## پیش از آغاز

1. توکن دریافت تله‌متری بسازید: **Project Settings → Telemetry & APM → Ingestion Keys → Create Ingestion Key**.
2. نقطه پایانی OTLP شما `https://oneuptime.com/otlp` است — یا اگر خودمیزبان هستید `https://YOUR-ONEUPTIME-HOST/otlp`.
3. توکن روی هر درخواست صادرات به‌صورت هدر `x-oneuptime-token` سفر می‌کند.

نقطه پایانی OneUptime‏ **OTLP روی HTTP** حرف می‌زند (protobuf و JSON). هیچ‌کدام از دو ابزار پایین برای رسیدن به آن به gRPC نیاز ندارند، اما پیش‌فرض Gemini CLI‏ gRPC است، پس تنظیم پروتکل مهم است — بخش پایین را ببینید.

## Gemini CLI

‏Gemini CLI کامل‌ترین منتشرکننده OpenTelemetry در میان CLIهای کدنویسی است، و اگر خرج هوش مصنوعی به ازای هر کارمند را ارزیابی می‌کنید همان جایی است که باید از آن آغاز کنید. ردیابی‌ها، سنجه‌ها و رویدادهای گزارش ساختارمند می‌فرستد، و — به‌طور یگانه در میان CLIهای کدنویسی — وقتی کاربر احراز هویت شده باشد هر رکوردی **`user.email`** را حمل می‌کند. OneUptime‏ `user.email` را مستقیم به‌عنوان هویت کارمند می‌خواند، پس انتساب بدون هیچ نگاشت هویتی، بدون جدول پیوند و بدون پیکربندی به ازای هر ماشین کار می‌کند. مقدار `traces` را روشن کنید (به‌طور پیش‌فرض خاموش است). اسپن‌ها هر وقت تله‌متری فعال باشد صادر می‌شوند، اما با خاموش بودن `traces` فقط `gen_ai.operation.name`، `gen_ai.agent.name`، `gen_ai.agent.description` و `gen_ai.conversation.id` را حمل می‌کنند — نه مدلی، نه شمار توکنی، هیچ چیز قابل قیمت‌گذاری‌ای. Gemini CLI سنجه هزینه‌ای هم منتشر نمی‌کند، پس `traces: true` همان چیزی است که به OneUptime اجازه می‌دهد فراخوان‌ها را هنگام دریافت قیمت‌گذاری کند.

### روشن کردن تله‌متری

تله‌متری زیر شیء `telemetry` در `.gemini/settings.json` پیکربندی می‌شود (در سطح پروژه درون مخزن، یا تنظیمات Gemini در سطح کاربر برای کل یک ماشین):

```json
{
  "telemetry": {
    "enabled": true,
    "target": "local",
    "otlpEndpoint": "http://localhost:4317",
    "otlpProtocol": "grpc",
    "traces": true,
    "logPrompts": false
  }
}
```

این کار Gemini CLI را به جمع‌کننده‌ای محلی از OpenTelemetry نشانه می‌گیرد، که راهی است که پیشنهادش می‌کنیم — برای چرایی‌اش [رساندن توکن به مقصد](#getting-the-token-in) را ببینید.

هر کلید این بلوک، همراه با متغیر محیطی‌ای که بر آن می‌چربد:

| کلید | بازنویسی محیطی | پیش‌فرض | چه می‌کند |
| -------------- | --------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled` | `GEMINI_TELEMETRY_ENABLED` | `false` | کلید اصلی. تا وقتی این true نباشد چیزی منتشر نمی‌شود. |
| `target` | `GEMINI_TELEMETRY_TARGET` | `"local"` | `"local"` یا `"gcp"`. برای OneUptime‏ `"local"` را به کار ببرید — یعنی «نقطه پایانی OTLP خودم»، نه «روی دیسک بنویس». |
| `otlpEndpoint` | `GEMINI_TELEMETRY_OTLP_ENDPOINT` | `http://localhost:4317` | جایی که تله‌متری به آن صادر می‌شود. |
| `otlpProtocol` | `GEMINI_TELEMETRY_OTLP_PROTOCOL` | `grpc` | `"grpc"` یا `"http"`. **صادرات مستقیم به OneUptime به `"http"` نیاز دارد** — gRPC پیش‌فرض وصل نخواهد شد. |
| `traces` | `GEMINI_TELEMETRY_TRACES_ENABLED` | `false` | ویژگی‌های تفصیلی اسپن، به‌طور پیش‌فرض خاموش. اسپن‌ها هر وقت تله‌متری فعال باشد صادر می‌شوند؛ با خاموش بودن این، فقط `gen_ai.operation.name`، `gen_ai.agent.name`، `gen_ai.agent.description` و `gen_ai.conversation.id` را حمل می‌کنند. روشنش کنید تا نام مدل، شمار توکن‌ها و بار اعلان/ابزار روی اسپن‌ها بیاید. |
| `logPrompts` | `GEMINI_TELEMETRY_LOG_PROMPTS` | **`true`** | آیا متن اعلان در رویدادهای گزارش گنجانده شود. هشدار پایین را ببینید. |
| `outfile` | `GEMINI_TELEMETRY_OUTFILE` | — | به‌جایش تله‌متری را در پرونده‌ای بنویس. برای بازرسی دقیقاً آنچه فرستاده می‌شود، پیش از فرستادنش، مفید است. |
| `useCollector` | `GEMINI_TELEMETRY_USE_COLLECTOR` | `false` | از جمع‌کننده OTLP بیرونی استفاده کن (پیشرفته). با `target: "local"` لازم نیست — فقط هدف `gcp` را از صادرات مستقیم به GCP دور می‌کند. |
| `useCliAuth` | `GEMINI_TELEMETRY_USE_CLI_AUTH` | `false` | از اعتبارنامه‌های خود CLI برای تله‌متری استفاده کن. فقط هدف GCP — به صادرات OTLP به OneUptime ربطی ندارد. |

متغیرهای `OTLP_GOOGLE_CLOUD_PROJECT` و `GOOGLE_CLOUD_PROJECT` فقط وقتی `target` برابر `"gcp"` باشد اعمال می‌شوند. متغیر `GEMINI_CLI_SURFACE` برچسب می‌زند که CLI به‌عنوان کدام سطح اجرا می‌شود.

**تقدم: پرچم‌های CLI ‏> متغیرهای محیطی ‏> `settings.json`.** اگر پیکربندی را به‌جای dotfileها از راه MDM می‌فرستید، متغیرهای `GEMINI_TELEMETRY_*` را تنظیم کنید تا بر هر چیزی که `.gemini/settings.json` واردشده در مخزن می‌گوید بچربند — که برای سیاست ناوگانی همان چیزی است که می‌خواهید.

### مقدار پیش‌فرض `logPrompts` برابر TRUE است — متن اعلان فرستاده می‌شود مگر خاموشش کنید

این مهم‌ترین سطر تکِ این صفحه است. برخلاف تقریباً هر ابزار دیگری در این حوزه، **Gemini CLI به‌طور پیش‌فرض محتوای اعلان را ثبت می‌کند**. تله‌متری را بدون دست زدن به `logPrompts` روشن کنید و متنی که مهندسانتان تایپ می‌کنند — که به‌طور معمول کد منبع، داده مشتری و اعتبارنامه‌های چسبانده‌شده در پایانه را در بر می‌گیرد — به پشتوانه رصدپذیری شما صادر و همان‌جا ذخیره می‌شود.

آن را صریح، در همان تغییری که تله‌متری را فعال می‌کند، تنظیم کنید:

```json
{
  "telemetry": {
    "enabled": true,
    "logPrompts": false
  }
}
```

یا، برای یک ناوگان:

```bash
export GEMINI_TELEMETRY_LOG_PROMPTS=false
```

اگر عمداً محتوای اعلان را می‌خواهید — مثلاً برای اشکال‌زدایی رفتار عامل — این تصمیمی است که باید آگاهانه گرفته شود، نه چیزی که از یک پیش‌فرض به ارث برسد. **scrub rules** و **drop filters** تله‌متری OneUptime (**Traces → Settings**) مانند هر داده دیگری بر این داده هم اعمال می‌شوند، پس می‌توانید به‌جای انتخاب همه‌یا‌هیچ، گزینشی سانسور کنید. اما سانسور هنگام دریافت خط دوم دفاع است، نه جایگزین `logPrompts: false`.

### رساندن توکن به مقصد

تنظیمات مستندشده `telemetry` در Gemini CLI نقطه پایانی و پروتکل دارند، اما **هیچ کلیدی برای هدرهای سفارشی صادرات** ندارند — و OneUptime با هدر `x-oneuptime-token` احراز هویت می‌کند. پس جمع‌کننده‌ای در میانه اجرا کنید و بگذارید همان هدر را بچسباند:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_INGESTION_TOKEN"

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
```

با اجرای آن، بلوک `settings.json` بالای همین بخش بدون تغییر کار می‌کند — پیش‌فرض‌های `http://localhost:4317` و `grpc` در Gemini CLI با گیرنده gRPC جمع‌کننده جور درمی‌آیند. برای اجرای جمع‌کننده به‌صورت sidecar، ‏DaemonSet، یا فرایندی محلی به ازای هر توسعه‌دهنده، [راهنمای OpenTelemetry](/docs/telemetry/open-telemetry) را ببینید.

اگر می‌خواهید از جمع‌کننده بگذرید، `otlpEndpoint` را روی `https://oneuptime.com/otlp` و `otlpProtocol` را روی `"http"` بگذارید، و بکوشید توکن را از راه متغیر استاندارد OpenTelemetry عبور دهید:

```bash
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
```

**تأییدنشده:** متغیر `OTEL_EXPORTER_OTLP_HEADERS` بخشی از تنظیمات مستندشده تله‌متری Gemini CLI نیست، و اینکه نسخه‌ای معین به آن احترام بگذارد چیزی نیست که تأییدش کرده باشیم. پیش از پخش کردنش روی یک ناوگان، روی یک ماشین آزمایشش کنید و بررسی کنید که داده می‌رسد — صادراتی که بی‌صدا انداخته می‌شود دقیقاً شبیه توسعه‌دهنده‌ای بیکار به نظر می‌رسد.

### Gemini CLI چه منتشر می‌کند

**سنجه‌ها.** ‏Gemini CLI از این نظر غیرعادی است که برای همان توکن‌ها هم سنجه توکن اختصاصی فروشنده و هم سنجه قرارداد معنایی را منتشر می‌کند. OneUptime سری **قرارداد معنایی**، یعنی `gen_ai.client.token.usage`، را جمع‌بست می‌کند و عمداً `gemini_cli.token.usage` را نادیده می‌گیرد — شناختن هر دو همان توکن‌ها را دو بار جمع می‌زد و بی‌صدا دو برابر رقم واقعی را گزارش می‌کرد. توکن‌های ورودی و خروجی کاملاً پوشیده‌اند: `gen_ai.client.token.usage` دقیقاً همان دو نوع را حمل می‌کند. اما نوع‌های توکن `thought`، `cache` و `tool` در Gemini CLI فقط زیر `gemini_cli.token.usage` ثبت می‌شوند، پس اگر لازمشان دارید همان سری را مستقیم نمودار کنید — بخشی از جمع‌بست توکن OneUptime نیستند.

| سنجه | چه چیزی حمل می‌کند |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `gen_ai.client.token.usage` | هیستوگرام توکن به قرارداد GenAI — **همان سری‌ای که نماهای توکن و هزینه OneUptime می‌خوانند** |
| `gemini_cli.token.usage` | همان توکن‌ها زیر نام خود Gemini CLI. روی داشبورد قابل نمودار کردن؛ برای پرهیز از دوباره‌شماری جمع‌بست نمی‌شود |
| `gen_ai.client.operation.duration` | هیستوگرام تأخیر به قرارداد GenAI |
| `gemini_cli.api.request.count` / `gemini_cli.api.request.latency` | فراخوان‌های API مدل و تأخیرشان |
| `gemini_cli.tool.call.count` / `gemini_cli.tool.call.latency` | فراخوانی‌های ابزار |
| `gemini_cli.session.count` | نشست‌های آغازشده |
| `gemini_cli.file.operation.count` / `gemini_cli.lines.changed` | آنچه عامل واقعاً با پایگاه کد کرده است |
| `gemini_cli.agent.run.count` / `gemini_cli.agent.duration` / `gemini_cli.agent.turns` | فعالیت زیرعامل |

بیشتر هم هست — `gemini_cli.chat_compression`، `gemini_cli.model_routing.latency`، `gemini_cli.model_routing.failure.count`، `gemini_cli.slash_command.model.call_count`، `gemini_cli.plan.execution.count`، `gemini_cli.startup.duration`، `gemini_cli.memory.usage`، `gemini_cli.cpu.usage`، `gemini_cli.tool.queue.depth`، `gemini_cli.tool.execution.breakdown`، `gemini_cli.ui.flicker.count`، `gemini_cli.onboarding.start`، `gemini_cli.onboarding.success` — که همه به‌عنوان سنجه‌های معمولی OpenTelemetry روی داشبوردها و [مانیتورهای سنجه](/docs/monitor/metrics-monitor) قابل پرس‌وجو هستند.

**رویدادهای گزارش.** آن‌هایی که ارزش ساختن روی‌شان را دارند:

| رویداد | معنا |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `gemini_cli.user_prompt` | اعلانی ثبت شد (متن را حمل می‌کند مگر `logPrompts` نادرست باشد) |
| `gemini_cli.api_request` / `gemini_cli.api_response` / `gemini_cli.api_error` | فراخوان مدل، نتیجه‌اش، و شکست‌ها |
| `gen_ai.client.inference.operation.details` | رکورد استنتاج به قرارداد GenAI |
| `gemini_cli.tool_call` | ابزاری فراخوانده شد |
| `gemini_cli.file_operation` | پرونده‌ای خوانده یا نوشته شد |
| `gemini_cli.conversation_finished` | پایان یک گفت‌وگو |
| `gemini_cli.model_routing` / `gemini_cli.flash_fallback` | اینکه کدام مدل برگزیده شد، و کِی عقب‌نشینی کرد |
| `gemini_cli.chat_compression` | زمینه فشرده شد |
| `gemini_cli.slash_command` | فرمان اسلشی اجرا شد |
| `gemini_cli.config` | پیکربندی هنگام راه‌اندازی |

دیگرها شامل `gemini_cli.tool_output_truncated`، `gemini_cli.tool_output_masking`، `gemini_cli.edit_strategy`، `gemini_cli.edit_correction`، `gemini_cli.malformed_json_response`، `gemini_cli.chat.invalid_chunk`، `gemini_cli.chat.content_retry`، `gemini_cli.chat.content_retry_failure`، `gemini_cli.agent.start`، `gemini_cli.agent.finish`، `gemini_cli.agent.recovery_attempt`، `gemini_cli.ide_connection`، `gemini_cli.rewind`، `gemini_cli.hook_call`، `gemini_cli.ripgrep_fallback`، `gemini_cli.web_fetch_fallback_attempt`، `gemini_cli.keychain.availability`، `gemini_cli.startup_stats`، `gemini_cli.extension_install`، `gemini_cli.extension_uninstall`، `gemini_cli.extension_enable` و `gemini_cli.extension_disable` هستند.

**ویژگی‌هایی روی همه‌چیز:** ‏`session.id`، `installation.id`، `active_approval_mode`، و وقتی احراز هویت شده باشد `user.email`. OneUptime‏ `session.id` را شناسه گفت‌وگو هم می‌گیرد، پس یک نشست کامل Gemini CLI در فهرست فراخوان‌های LLM با هم گروه می‌شود، حتی وقتی روی چند ردیابی گسترده باشد.

### کارمندان و تیم‌ها

مقدار `user.email` هم روی جریان اسپن و هم روی جریان سنجه به‌عنوان هویت کارمند خوانده می‌شود، پس برای خرج به ازای هر نفر چیز دیگری لازم نیست. برای گرفتن جمع‌بست تیم و مرکز هزینه، ویژگی‌های منبع بیفزایید — این تنها تکه‌ای است که Gemini CLI نمی‌تواند بداند:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-tools,department=Engineering"
```

متغیر `OTEL_RESOURCE_ATTRIBUTES` ویژگی‌های _منبع_ را می‌گذارد، که با پیشوند به OneUptime می‌رسند — `resource.team.id`، `resource.cost_center` و از این دست. OneUptime‏ `team.id`، `team`، `cost_center` و `department` را هم در املای برهنه و هم با پیشوند `resource.` می‌شناسد، به یک اندازه روی اسپن‌ها و روی نقطه‌داده‌های سنجه، پس تفکیک تیم / مرکز هزینه در زبانه **Usage** به هر شکلی که صادرکننده‌تان آن‌ها را حمل کند کار می‌کند.

دو چیز تعیین می‌کنند زبانه Usage واقعاً چه چیزی می‌تواند برای Gemini CLI نشان دهد:

- **با خاموش بودن `traces` (پیش‌فرض)، Gemini CLI همچنان اسپن صادر می‌کند، اما آن‌ها هیچ ویژگی مدل یا توکنی حمل نمی‌کنند** — پس OneUptime نمی‌تواند قیمت‌گذاری‌شان کند، و در عمل پروژه، Gemini CLI را برای خرج منبعی فقط‌سنجه‌ای می‌بیند. اسپن‌های GenAI مرجع‌اند و سنجه‌ها عقبه‌ای هستند که فقط وقتی جریان اسپن چیزی گزارش نکرده باشد به آن‌ها رجوع می‌شود — این دو هرگز با هم جمع نمی‌شوند. پس اگر این پروژه از پیش اسپن‌های GenAI دارد که همان رقم را گزارش می‌کنند، سهم سنجه‌ای Gemini CLI پدیدار نخواهد شد؛ اگر لازم است جدا بایستند، به ناوگان پروژه خودش را بدهید. روشن کردن `traces` مسئله را به‌کل برمی‌دارد، چون آنگاه اسپن‌های Gemini CLI همان مدل و شمار توکن‌هایی را حمل می‌کنند که آن‌ها را به اسپن‌های GenAI قابل قیمت‌گذاری بدل می‌کند.
- **روی مسیر فقط‌سنجه‌ای، تفکیک‌های Employee، Team و Model کار می‌کنند؛ Provider و Application / Service نه**، و سطری که از سنجه می‌آید فقط هزینه حمل می‌کند — ستون‌های Calls و توکنش به‌صورت `—` رندر می‌شوند. جزئیات کامل در [رصدپذیری هوش مصنوعی / LLM](/docs/telemetry/ai-llm-observability). توجه کنید که Gemini CLI اصلاً سنجه هزینه‌ای منتشر نمی‌کند، پس روی مسیر فقط‌سنجه‌ای جدول Usage خرجی برای رتبه‌بندی ندارد؛ توکن‌هایش همچنان به کاشی‌های توکن صفحه Overview می‌رسند. اجرای `traces` همان چیزی است که فراخوان‌های هزینه‌دار Gemini CLI را برایتان می‌آورد، قیمت‌گذاری‌شده هنگام دریافت از روی مدل و شمار توکن‌ها.

## GitHub Copilot

### چه چیزی تله‌متری منتشر می‌کند و چه چیزی نه

‏GitHub پشتیبانی OpenTelemetry در Copilot را **فقط برای سطح‌های عامل** مستند می‌کند — عنوان صفحه مفهومی «OpenTelemetry for agent monitoring» است و راهنمای VS Code تعامل‌های عامل را پوشش می‌دهد. هیچ‌جا صریح نمی‌گوید که سطح‌های دیگر چیزی منتشر نمی‌کنند؛ آنچه در پی می‌آید برداشت ما از این است که کدام سطح‌ها پوشش داده شده‌اند:

| سطح | ‏OTel منتشر می‌کند |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| ‏VS Code Copilot Chat / حالت عامل | بله |
| فرایند میزبان عامل پشت Copilot CLI | بله |
| ‏Copilot SDK | بله |
| افزونه Copilot در JetBrains (گردش‌کارهای عامل) | بله — زیر **Settings → Tools → GitHub Copilot → Chat** پیکربندی می‌شود |
| عامل ابری (کدنویسی) Copilot | پشتیبانی نمی‌شود — ماتریس تنظیمات مدیریت‌شده GitHub‏ `telemetry` را برایش پشتیبانی‌نشده علامت می‌زند |
| تکمیل‌های کد درون‌خطی | مستند نشده که منتشر کند |
| ‏Copilot روی github.com | مستند نشده که منتشر کند |
| بازبینی کد Copilot | مستند نشده که منتشر کند |

انتظارها را درون سازمانتان بر همین اساس تنظیم کنید. تیمی که در تکمیل‌های درون‌خطی زندگی می‌کند، هر طور که صادرات پیکربندی شده باشد در OneUptime بیکار به نظر می‌رسد، چون GitHub برای آن سطح هیچ OTelی مستند نکرده است. پوشش Copilot از آن سطح‌ها به‌جایش در APIهای REST است — [صندلی‌ها و صورت‌حساب فقط از راه API](#seats-and-billing-are-api-only) را ببینید.

تنظیمات OTel افزونه JetBrains وجود دارند، اما تغییرنامه GitHub نام کلیدهای تنظیم را منتشر نمی‌کند، پس **نمی‌توانیم تأیید کنیم که با کلیدهای VS Code یکی باشند**. به‌جای فرض کردن اینکه کلیدهای پایین منتقل می‌شوند، آن را از رابط کاربری افزونه پیکربندی کنید و تأیید کنید که داده می‌رسد. مسیر تنظیمات مدیریت‌شده آنجا تأییداً کار می‌کند — ماتریس پشتیبانی GitHub‏ `telemetry` را برای IDEهای JetBrains پشتیبانی‌شده علامت می‌زند — هرچند نام کلیدهای محلی منتشر نشده‌اند.

### تنظیمات VS Code

کلیدهای `settings.json` در سطح کاربر برای افزونه Copilot Chat:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.otlpEndpoint": "https://oneuptime.com/otlp",
  "github.copilot.chat.otel.captureContent": false,
  "github.copilot.chat.otel.maxAttributeSizeChars": 8192
}
```

کلید `exporterType` مقادیر `"otlp-http"`، `"otlp-grpc"`، `"console"` یا `"file"` را می‌پذیرد و پیش‌فرضش `"otlp-http"` است — که همان چیزی است که می‌خواهید، چون نقطه پایانی OneUptime‏ HTTP است. کلید `github.copilot.chat.otel.dbSpanExporter.enabled` هم برای ذخیره‌سازی محلی اسپن هست.

میزبان عامل پشت Copilot CLI معادل‌های خودش را دارد: `chat.agentHost.otel.enabled`، `chat.agentHost.otel.otlpEndpoint`، `chat.agentHost.otel.exporterType`، `chat.agentHost.otel.captureContent`، `chat.agentHost.otel.serviceName`، `chat.agentHost.otel.resourceAttributes` و `chat.agentHost.otel.headers`.

به آنچه در کلیدهای Chat در سطح کاربر غایب است توجه کنید: **هیچ کلید هدری نیست**، پس آن تنظیمات به‌تنهایی نمی‌توانند `x-oneuptime-token` را حمل کنند. چهار راه بیرون‌رفت، ساده‌ترین اول:

```bash
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
```

…یا از تنظیمات مدیریت‌شده سازمانی پایین استفاده کنید، یا کلید `headers` میزبان عامل را به کار ببرید، یا `otlpEndpoint` را به جمع‌کننده‌ای محلی از OpenTelemetry نشانه بگیرید که هدر را می‌چسباند (همان پیکربندی جمع‌کننده در [بخش Gemini CLI](#getting-the-token-in) کار می‌کند).

متغیرهای محیطی‌ای که Copilot می‌خواند شامل `COPILOT_OTEL_ENABLED`، `COPILOT_OTEL_ENDPOINT`، `OTEL_EXPORTER_OTLP_ENDPOINT`، `OTEL_EXPORTER_OTLP_PROTOCOL` / `COPILOT_OTEL_PROTOCOL`، `OTEL_SERVICE_NAME`، `OTEL_RESOURCE_ATTRIBUTES`، `OTEL_EXPORTER_OTLP_HEADERS`، `COPILOT_OTEL_MAX_ATTRIBUTE_SIZE_CHARS`، `COPILOT_OTEL_LOG_LEVEL`، `COPILOT_OTEL_FILE_EXPORTER_PATH` و `COPILOT_OTEL_HTTP_INSTRUMENTATION` هستند — به‌علاوه، برای ثبت محتوا، `COPILOT_OTEL_CAPTURE_CONTENT` در VS Code یا `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` در Copilot CLI.

### تنظیمات مدیریت‌شده سازمانی

برای یک ناوگان، بلوک `telemetry` را از راه تنظیمات مدیریت‌شده سازمانی Copilot بفرستید. این تنها جایی است که هم می‌توانید صادرات را احراز هویت کنید و هم ثبت محتوا را خاموش قفل کنید:

```json
{
  "telemetry": {
    "enabled": true,
    "endpoint": "https://oneuptime.com/otlp",
    "protocol": "http/protobuf",
    "serviceName": "github-copilot",
    "captureContent": false,
    "lockCaptureContent": true,
    "headers": {
      "x-oneuptime-token": "YOUR_INGESTION_TOKEN"
    },
    "resourceAttributes": {
      "enduser.id": "alice@example.com",
      "user.email": "alice@example.com",
      "team.id": "platform",
      "cost_center": "eng-tools"
    }
  }
}
```

کلیدهای `headers` و `resourceAttributes` شیءهای JSON هستند. مقدار `protocol` اینجا **رمزگذاری سیمی** OTLP است، نه نام صادرکننده: مرجع تنظیمات مدیریت‌شده GitHub‏ `"http/json"` و `"http/protobuf"` را می‌پذیرد، و نمونه خودش `"http/protobuf"` را به کار می‌برد. (مستندات سازمانی VS Code همان کلید مدیریت‌شده را چنین توصیف می‌کنند که به تنظیم `chat.agentHost.otel.exporterType` نگاشت می‌شود، که واژگانش `otlp-http` / `otlp-grpc` است — اما درباره آنچه بلوک مدیریت‌شده می‌پذیرد، مرجع تنظیمات مدیریت‌شده GitHub حرف آخر را می‌زند، پس `http/protobuf` بنویسید.) مقدار `captureContent` همراه با `lockCaptureContent: true` ثبت اعلان و تکمیل را خاموش می‌کند و جلوی روشن کردن دوباره‌اش به‌صورت محلی به دست یک توسعه‌دهنده را می‌گیرد.

یک رفتار که باید برایش برنامه بریزید: `telemetry.headers` مدیریت‌شده فقط بر صادرکننده OTLP افزونه Copilot Chat اعمال می‌شود و هرگز از راه متغیرهای محیطی عبور داده نمی‌شود — عمداً، تا مقدار هدری مانند توکن احراز هویت نتواند به زیرفرایندهای ابزاری که میزبان عامل می‌زایاند نشت کند. پس راه‌اندازی ترکیبی — متغیر محیطی برای نقطه پایانی، تنظیمات مدیریت‌شده برای توکن — آن‌طور که انتظار دارید کار نخواهد کرد. صادرات را در یک جا پیکربندی کنید.

**و پیامدی که باید رسیدگی‌اش کنید:** در این نسخه، هدرهای مدیریت‌شده اصلاً **به فرایند میزبان عامل تحویل نمی‌شوند**. پس میزبان عامل پشت Copilot CLI بدون `x-oneuptime-token` صادر می‌کند و OneUptime داده‌اش را رد می‌کند. یا `chat.agentHost.otel.headers` را مستقیم تنظیم کنید، یا `OTEL_EXPORTER_OTLP_HEADERS` را در محیط میزبان عامل بگذارید، یا میزبان عامل را به جمع‌کننده‌ای محلی نشانه بگیرید که هدر را می‌چسباند.

باقی بلوک تنظیمات مدیریت‌شده — `enabled`، `endpoint`، `protocol`، `captureContent`، `serviceName`، `resourceAttributes` — بر افزونه Chat در VS Code، میزبان عامل Copilot CLI و افزونه JetBrains اعمال می‌شود.

### انتساب: Copilot هیچ کاربری را نام نمی‌برد، پس شما باید ببرید

**‏Copilot هیچ هویت انسانی قابل استفاده‌ای منتشر نمی‌کند.** نه `user.email`ای هست، نه `user.id`ای و نه `enduser.id`ای. میزبان عامل Copilot CLI روی اسپن‌های `invoke_agent` خود `enduser.pseudo.id` می‌گذارد — شناسه‌ای مستعار مشتق‌شده از `analytics_tracking_id` — اما ایمیل نیست، افزونه VS Code منتشرش نمی‌کند، و OneUptime نمی‌تواند به کارمندی نگاشتش کند. جز این، اسپن‌ها با یک مدل، شمار توکن‌ها و یک نام سرویس می‌رسند و هیچ‌چیزی که بگوید چه کسی اجرایشان کرده است. بدون مداخله، هر دلار Copilot در OneUptime در یک سطل ناشناس فرود می‌آید.

رفعش این است که خودتان هویت را به‌صورت ویژگی منبع، به ازای هر ماشین، تزریق کنید. در تنظیمات مدیریت‌شده، همان شیء `resourceAttributes` است که بالا نشان داده شد. جایی که به‌جایش ماشین‌های توسعه‌دهنده را از راه نمایه پوسته یا اسکریپت MDM تدارک می‌بینید:

```bash
export OTEL_RESOURCE_ATTRIBUTES="enduser.id=${USER_EMAIL},user.email=${USER_EMAIL},team.id=platform,cost_center=eng-tools,department=Engineering"
```

هر دوی `enduser.id` و `user.email` را تنظیم کنید: OneUptime‏ `enduser.id` را شناسه کارمند و `user.email` را ایمیل کارمند می‌خواند، و داشتن هر دو باعث می‌شود زبانه Usage به‌جای شناسه‌ای مبهم، نامی را رندر کند که می‌شناسید. مقادیر `team.id`، `team`، `cost_center` و `department` جمع‌بست‌های تیم و مرکز هزینه را می‌رانند.

این‌ها ویژگی‌های _منبع_ هستند، پس به‌صورت `resource.enduser.id`، `resource.user.email` و `resource.team.id` به OneUptime می‌رسند. همین املا است که اینجا اهمیت دارد، و OneUptime با آن جور درمی‌آید: هر کلید هویت و تیم هم در شکل برهنه و هم با پیشوند `resource.` شناخته می‌شود. اسپن‌های Copilot ویژگی‌های GenAI را حمل می‌کنند که آن‌ها را فراخوان LLM علامت می‌زند، پس هویت روی همان ستون‌هایی فرود می‌آید که زبانه Usage بر پایه‌شان گروه‌بندی می‌کند.

این کار را هنگام تدارک انجام دهید. افزودن پسینی انتساب ناممکن است — اسپن‌هایی که پیش‌تر بدون هویت فرود آمده‌اند بعداً دوباره منتسب نمی‌شوند.

یک تله که ارزش نام بردن دارد: برای حمل کارمند به سراغ `gen_ai.user` یا `llm.user` **نروید**. OneUptime عمداً آن‌ها را کارمند نمی‌گیرد، چون در برنامه‌ای که به مشتریان خدمت می‌دهد _مشتری پایین‌دستی خود فراخواننده_ را حمل می‌کنند، و نگاشت آن به کارمند تسویه هزینه داخلی نادرست تولید می‌کند. `enduser.id` و `user.email` ویژگی‌هایی هستند که باید تنظیم شوند.

### اسپن‌های Copilot چه شکلی‌اند

‏Copilot از قراردادهای معنایی GenAI در OpenTelemetry پیروی می‌کند، یعنی بدون پیکربندی اضافه به همان رسیدگی موجود OneUptime به اسپن‌های LLM سرازیر می‌شود — همان فهرست فراخوان‌های LLM، همان پنل AI / LLM، همان [بودجه‌های هزینه](/docs/telemetry/ai-llm-observability) که برنامه‌های ابزارگذاری‌شده خودتان دارند.

نام‌های اسپن:

| اسپن | منتشر می‌شود |
| -------------- | ----------------------------- |
| `invoke_agent` | اسپن ریشه، یکی به ازای هر نوبت عامل |
| `chat` | یکی به ازای هر فراخوان API‏ LLM |
| `execute_tool` | یکی به ازای هر فراخوان ابزار |
| `execute_hook` | یکی به ازای هر اجرای قلاب |

ویژگی‌ها شامل `gen_ai.agent.name`، `gen_ai.request.model`، `gen_ai.response.model`، `gen_ai.usage.input_tokens`، `gen_ai.usage.output_tokens`، `gen_ai.usage.cache_read.input_tokens`، `gen_ai.conversation.id`، `gen_ai.response.finish_reasons`، `gen_ai.tool.name` و `gen_ai.tool.call.id` هستند، به‌علاوه `copilot_chat.time_to_first_token`.

سنجه‌ها از هر دو سطح: `gen_ai.client.operation.duration` و `gen_ai.client.token.usage`، هر دو هیستوگرام. سنجه‌های اختصاصی فروشنده بسته به سطح فرق می‌کنند — افزونه VS Code فضای‌نام قدیمی `copilot_chat.*` را منتشر می‌کند (`copilot_chat.tool.call.count`، `copilot_chat.tool.call.duration`، `copilot_chat.agent.invocation.duration`)، در حالی که میزبان عامل Copilot CLI فضای‌نام متعارف `github.copilot.*` را منتشر می‌کند (`github.copilot.tool.call.count`، `github.copilot.tool.call.duration`، `github.copilot.agent.turn.count`، `github.copilot.code.lines_added` / `lines_removed`). GitHub می‌گوید `github.copilot.*` همان فضای‌نامی است که باید داشبوردهای تازه را رویش ساخت.

‏Copilot ردیابی‌ها، سنجه‌ها و **رویدادها** را منتشر می‌کند — که روی سیگنال گزارش OTLP تحویل می‌شوند، پس در هر جمع‌کننده‌ای که جلوی OneUptime می‌گذارید خط لوله `logs` را نگه دارید. رویدادهای Copilot Chat در VS Code شامل `gen_ai.client.inference.operation.details`، `copilot_chat.session.start`، `copilot_chat.tool.call`، `copilot_chat.agent.turn`، `copilot_chat.edit.feedback` و `copilot_chat.user.feedback` هستند. میزبان عامل Copilot CLI به‌جایش چرخه عمرش را به‌صورت رویدادهای اسپن ثبت می‌کند (`github.copilot.hook.start`، `github.copilot.session.truncation`، `github.copilot.session.shutdown` و از این دست).

چون `gen_ai.conversation.id` حاضر است، OneUptime یک نوبت کامل عامل Copilot را به‌عنوان یک گفت‌وگو در فهرست فراخوان‌های LLM گروه می‌کند. و چون شمار توکن‌ها از نام‌های استاندارد ویژگی استفاده می‌کند، برای مدل‌های موجود در فهرست‌نامه، هزینه از روی مدل و شمار توکن‌ها [هنگام دریافت محاسبه می‌شود](/docs/telemetry/ai-llm-observability).

میزبان عامل خود Copilot هم خرج را مستقیم گزارش می‌دهد: `github.copilot.cost` (هزینه پولی) و `github.copilot.aiu` (واحدهای هوش مصنوعی) روی هر دو اسپن `invoke_agent` و `chat` می‌نشینند. OneUptime به‌جای خواندن آن ویژگی‌ها، فراخوان‌ها را هنگام دریافت از روی مدل و شمار توکن‌ها قیمت‌گذاری می‌کند، پس رقم OneUptime و `github.copilot.cost` خود GitHub می‌توانند فرق کنند — اگر عدد GitHub را لازم دارید، مستقیم همان ویژگی را پرس‌وجو کنید.

### Copilot SDK

اگر Copilot SDK را جاسازی می‌کنید، `TelemetryConfig` آن کلیدهای خودش را دارد: `otlpEndpoint` (بسته به زبان به‌صورت `otlp_endpoint` / `OTLPEndpoint` هم پذیرفته می‌شود)، `otlpProtocol` (`"http/json"` یا `"http/protobuf"`)، `exporterType` (`"otlp-http"` یا `"file"`)، `filePath`، `sourceName` و `captureContent`. این SDK‏ `traceparent` و `tracestate` از W3C را روی JSON-RPC انتشار می‌دهد، پس اسپن‌های SDK به‌جای شناور ماندن به‌تنهایی به ردیابی‌های برنامه‌تان می‌پیوندند، و رویداد جریانی `assistant.usage` را در معرض می‌گذارد که می‌توانید مشترکش شوید و فیلد `apiEndpoint` آن از انتساب هزینه پشتیبانی می‌کند — GitHub این را به‌عنوان اشتراک رویداد SDK مستند می‌کند، نه چیزی که روی OTLP صادر شود.

### صندلی‌ها و صورت‌حساب فقط از راه API

تخصیص صندلی‌ها، فعالیت صندلی و صورت‌حساب درخواست‌های ممتاز در Copilot **اصلاً روی OpenTelemetry در دسترس نیستند**. ‏OTel آنچه را سطح‌های عامل کردند به شما می‌دهد؛ نمی‌گوید چه کسی صندلی‌ای در اختیار دارد، آن صندلی بیکار است یا نه، یا GitHub چقدر صورت‌حساب کرده است. برای صندلی‌های نرخ‌ثابت، بازپس‌گیری صندلی‌های بیکار اهرم واقعی هزینه است، و به‌کل در API‏ REST زندگی می‌کند.

دو چیز که پیش از ساختن هر چیزی روی آن APIها به دست خودتان باید بدانید:

- نقطه پایانی تجمیعی قدیمی `GET /orgs/{org}/copilot/metrics` (و همتایان تیمی و سازمانی‌اش) **بازنشسته شده** است. هر چیزی که روی شکل `total_active_users` / `total_engaged_users` / `copilot_ide_code_completions` آن نوشته شده باشد حالا شکست می‌خورد. تاریخ دقیق خاموشی به‌جای تغییرنامه‌ای دست‌اول در بحثی انجمنی گزارش شده است، پس به‌جای اعتماد به تاریخی از یک نوشته وبلاگی، مستندات کنونی GitHub را بررسی کنید.
- جایگزینش مجموعه‌ای از **نقطه‌های پایانی گزارش** است — `.../copilot/metrics/reports/users-1-day?day=YYYY-MM-DD`، `.../reports/users-28-day/latest`، و گونه‌های سازمان، بنگاه، مخزن‌ها و تیم‌های کاربر — که به‌جای سطرهای درون‌خطی، بدنه JSON کوچکی از **پیوندهای امضاشده دانلود** (`download_links`، `report_day`) برمی‌گردانند. برای گرفتن داده، پیوندها را واکشی می‌کنید. اینجا سودی واقعی هست: گزارش‌های به ازای هر کاربر یک رکورد به ازای هر نفر حمل می‌کنند (`user_login`، `ai_credits_used`، `user_initiated_interaction_count`، `code_generation_activity_count`، `loc_added_sum`، و پرچم‌های `used_agent` / `used_chat` / `used_cli`)، کاری که API تجمیعی قدیمی هرگز نمی‌کرد.

**‏OneUptime امروز این APIها را نمی‌پیماید.** رابطی زمان‌بندی‌شده که صندلی‌ها، نقطه‌های پایانی گزارش به ازای هر کاربر و صورت‌حساب درخواست‌های ممتاز را بکشد و کنار داده OTel به سنجه‌های به ازای هر کارمند بدلشان کند، رابطی برنامه‌ریزی‌شده برای آینده است — نه چیزی که همین حالا بتوانید فعالش کنید. تا وقتی وجود پیدا کند، نمای Copilot در OneUptime را پوششی بر مصرف سطح‌های عامل بگیرید و اعداد صندلی و صورت‌حساب را جداگانه از GitHub بکشید.

## تأیید اینکه رسید

از راه هر ابزار یک اعلان اجرا کنید، چند ثانیه صبر کنید، سپس **AI / LLM** را در ناوبری (زیر Observability) باز کنید:

- **LLM Calls** باید فراخوان‌ها را فهرست کند. فراخوان‌های Copilot به‌صورت اسپن‌های `invoke_agent` / `chat` / `execute_tool` می‌رسند؛ فراخوان‌های Gemini CLI زیر نام سرویسی که پیکربندی کرده‌اید می‌رسند — و فقط اگر سیگنال `traces` آن را روشن کرده باشید.
- زبانه **Usage** کارمندان، تیم‌ها، مدل‌ها، ارائه‌دهندگان و سرویس‌ها را بر پایه خرج رتبه‌بندی می‌کند. هر دو ابزار از راه اسپن‌هایشان اینجا پدیدار می‌شوند، پس هر دو با هزینه‌ای رتبه‌بندی می‌شوند که هنگام دریافت از روی مدل و شمار توکن‌ها محاسبه شده است. کاربران Gemini CLI باید بی‌درنگ با ایمیلشان پدیدار شوند. اگر سطرهای Copilot هیچ کارمندی نشان نمی‌دهند، ویژگی‌های منبع به صادرکننده نرسیده‌اند — بررسی کنید که هویت در همان جایی تنظیم شده باشد که باقی پیکربندی صادرات هست.
- اصلاً هیچ‌چیز؟ توکن `x-oneuptime-token` اشتباه هنگام دریافت رد می‌شود، و برای Gemini CLI رایج‌ترین علت این است که هنگام صادرات مستقیم به OneUptime، ‏`otlpProtocol` روی پیش‌فرض `grpc` رها شده باشد.

## مرتبط

- [رصدپذیری هوش مصنوعی / LLM با OneUptime](/docs/telemetry/ai-llm-observability) — ویژگی‌هایی که OneUptime می‌شناسد، اینکه هزینه چگونه محاسبه می‌شود، و بودجه‌های هزینه روزانه.
