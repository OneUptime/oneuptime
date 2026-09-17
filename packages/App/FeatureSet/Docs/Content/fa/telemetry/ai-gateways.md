# پاییدن دروازه‌های هوش مصنوعی (LiteLLM و Portkey)

دروازه هوش مصنوعی نقطه گلوگاه طبیعی رصدپذیری است: هر فراخوان LLM از هر برنامه‌ای از آن می‌گذرد. صادرات OpenTelemetry دروازه را یک بار به OneUptime نشانه بگیرید، و [رصدپذیری هوش مصنوعی/LLM](/docs/telemetry/ai-llm-observability) — ردیابی‌ها، مصرف توکن، هزینه، اعلان‌ها و تکمیل‌ها — را برای هر چیزی که پشتش است می‌گیرید، بی‌آنکه هر برنامه را ابزارگذاری کنید.

این راهنما دو دروازه رایج‌تر را پوشش می‌دهد:

- **[LiteLLM Proxy](#litellm-proxy)** — صادرات توکار OTel در پراکسی متن‌باز.
- **[Portkey](#portkey)** — صادرات توکار روی استقرارهای خودمیزبان/سازمانی؛ الگویی سمت کلاینت برای دروازه متن‌باز و میزبانی‌شده.

## پیش از آغاز

1. در OneUptime توکن دریافت تله‌متری بسازید: **Project Settings → Telemetry & APM → Ingestion Keys → Create Ingestion Key**.
2. نقطه پایانی OTLP خود را یادداشت کنید: `https://oneuptime.com/otlp` — یا `https://YOUR-ONEUPTIME-HOST/otlp` اگر خودمیزبان هستید. ردیابی‌ها در `/otlp/v1/traces` روی OTLP HTTP، در هر دو رمزگذاری protobuf و JSON پذیرفته می‌شوند.
3. توکن روی هر درخواست صادرات به‌صورت هدر `x-oneuptime-token` سفر می‌کند.

## LiteLLM Proxy

فراخوان‌برگشتی OpenTelemetry در LiteLLM در پراکسی متن‌باز عرضه می‌شود. ایمیج رسمی Docker (`ghcr.io/berriai/litellm`) بسته‌های OpenTelemetry را همراه دارد، پس صادرات صرفاً مسئله‌ای از پیکربندی است. (به‌جایش با pip نصب می‌کنید؟ `pip install litellm[proxy]` آن‌ها را دربر **نمی‌گیرد** — `pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp` را بیفزایید.)

### ۱. فعال کردن فراخوان‌برگشتی OTel

در `config.yaml` خود در LiteLLM:

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

litellm_settings:
  callbacks: ["otel"]
```

### ۲. نشانه گرفتن صادرکننده به OneUptime

سه متغیر محیطی روی پراکسی تنظیم کنید:

```bash
export OTEL_EXPORTER="otlp_http"
export OTEL_ENDPOINT="https://oneuptime.com/otlp/v1/traces"
export OTEL_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
```

یادداشت‌هایی درباره مقادیر دقیق:

- در `OTEL_ENDPOINT` **مسیر کامل `/v1/traces`** را به کار ببرید. LiteLLM نسخه ۱٫۷۹ به بالا نشانی پایه‌ای مانند `https://oneuptime.com/otlp` را خودکار به مسیر درست هر سیگنال نرمال می‌کند، اما نسخه‌های قدیمی‌تر نقطه پایانی را عیناً عبور می‌دهند — مسیر کامل روی هر نسخه‌ای کار می‌کند.
- مقدار `OTEL_HEADERS` جفت‌های `key=value` جداشده با ویرگول می‌گیرد، پس چند هدر می‌شود `key1=val1,key2=val2`.
- نام‌های استاندارد OpenTelemetry (`OTEL_EXPORTER_OTLP_PROTOCOL`، `OTEL_EXPORTER_OTLP_ENDPOINT`، `OTEL_EXPORTER_OTLP_HEADERS`) هم کار می‌کنند و بر نام‌های کوتاه LiteLLM تقدم دارند.
- مقدار `OTEL_SERVICE_NAME` سرویسی را می‌گذارد که اسپن‌ها در OneUptime زیرش پدیدار می‌شوند (پیش‌فرض: `litellm`).

### ۳. اجرایش کنید

نمونه Docker، همه با هم:

```bash
docker run \
  -v $(pwd)/config.yaml:/app/config.yaml \
  -e OPENAI_API_KEY="sk-..." \
  -e OTEL_EXPORTER="otlp_http" \
  -e OTEL_ENDPOINT="https://oneuptime.com/otlp/v1/traces" \
  -e OTEL_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN" \
  -e OTEL_SERVICE_NAME="litellm-gateway" \
  -p 4000:4000 \
  ghcr.io/berriai/litellm:main-stable \
  --config /app/config.yaml
```

اکنون هر درخواستی از راه پراکسی، اسپنی به نام `litellm_request` تولید می‌کند که `gen_ai.system` (ارائه‌دهنده)، `gen_ai.request.model`، `gen_ai.response.model`، `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`، پارامترهای درخواست، و محتوای اعلان و تکمیل را حمل می‌کند — همه ویژگی‌هایی که OneUptime [بومی می‌شناسدشان](/docs/telemetry/ai-llm-observability).

**هزینه:** LiteLLM خودش هر فراخوانی را قیمت می‌گذارد و روی اسپن گزارش می‌دهد (`gen_ai.cost.total_cost`، یا `litellm.cost.total` در حالت v2). OneUptime آن را به‌عنوان هزینه گزارش‌شده اسپن می‌خواند، پس قیمت‌گذاری خودِ LiteLLM — از جمله هر نرخ سفارشی به ازای هر مدل که روی پراکسی پیکربندی کرده‌اید — بر برآورد فهرست OneUptime می‌چربد. وقتی LiteLLM نتواند فراخوانی را قیمت‌گذاری کند (مدلی سفارشی بدون قیمت پیکربندی‌شده)، OneUptime به [محاسبه برآوردی](/docs/telemetry/ai-llm-observability) از روی شمار توکن‌ها بازمی‌گردد.

### محتوای اعلان و حریم خصوصی

فراخوان‌برگشتی `otel` **به‌طور پیش‌فرض محتوای کامل اعلان و تکمیل را ثبت می‌کند**. اگر دروازه شما جلوی ترافیک حساسی است، سه راه برای خاموش کردنش:

```yaml
# Option 1: global kill-switch for all logging callbacks
litellm_settings:
  callbacks: ["otel"]
  turn_off_message_logging: true
```

```yaml
# Option 2: just the otel callback (callback_settings is a TOP-LEVEL key)
litellm_settings:
  callbacks: ["otel"]

callback_settings:
  otel:
    message_logging: False
```

```bash
# Option 3: environment variable
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT="NO_CONTENT"
```

می‌توانید محتوا را هم در جریان نگه دارید و با قواعد پاک‌سازی تله‌متری OneUptime زیر **Traces → Settings** گزینشی پاکش کنید.

### اختیاری: ردیابی یکپارچه با OTel v2

نسخه‌های تازه‌تر LiteLLM حالت اختیاری «OpenTelemetry v2» را عرضه می‌کنند (`LITELLM_OTEL_V2=true`، بدون نیاز به تغییر `config.yaml`) که به ازای هر درخواست یک ردیابی یکپارچه منتشر می‌کند — اداره HTTP، احراز هویت، نگهبان‌ها، و فراخوان LLM به‌عنوان اسپن‌های متعارف قرارداد معنایی GenAI با نام‌هایی مانند `chat gpt-4o`. در حالت v2، محتوای اعلان به‌طور پیش‌فرض **خاموش** است و با `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` روشن می‌شود. یکی از دو حالت را برگزینید، نه هر دو.

### رفع اشکال

- موقتاً `OTEL_EXPORTER="console"` بگذارید — اگر اسپن‌ها روی stdout پراکسی چاپ شوند، LiteLLM درست ابزارگذاری می‌کند و مشکل نقطه پایانی یا توکن است.
- برای گزارش‌گیری پرحرف صادرکننده `DEBUG_OTEL="true"` بگذارید.
- به‌طور پیش‌فرض فقط ردیابی‌ها صادر می‌شوند؛ سنجه‌ها/رویدادهای OTel در LiteLLM اختیارهای جداگانه‌اند و برای قابلیت‌های هوش مصنوعی OneUptime لازم نیستند.

## Portkey

داستان Portkey به این بستگی دارد که چگونه اجرایش می‌کنید — نخست استقرارتان را با این سه سطر بسنجید:

| استقرار | صادرات ردیابی OTel به OneUptime |
| ------------------------------------------ | ------------------------------------------------------------------- |
| دروازه خودمیزبان / سازمانی | **توکار** (آزمایشی) — با متغیرهای محیطی زیر پیکربندی کنید |
| دروازه متن‌باز (`portkey-ai/gateway`) | در دسترس نیست — از ابزارگذاری سمت کلاینت استفاده کنید |
| میزبانی‌شده (portkey.ai) | در سمت دروازه در دسترس نیست — از ابزارگذاری سمت کلاینت استفاده کنید |

این را با نقطه پایانی **دریافت** OpenTelemetry خودِ Portkey ‏(`api.portkey.ai/v1/otel`) اشتباه نگیرید — آن ردیابی‌ها را *به درون* Portkey می‌گیرد و جهت مخالف کاری است که این راهنما برپا می‌کند.

### دروازه خودمیزبان / سازمانی: صادرات توکار

دروازه سازمانی و خودمیزبان Portkey می‌تواند هر درخواست/پاسخ LLM را به‌عنوان اسپن ردیابی OTLP بفرستد، با پیروی از قراردادهای معنایی GenAI ‏(۱٫۴۰٫۰). این متغیرهای محیطی را روی کانتینر دروازه تنظیم کنید:

```yaml
EXPERIMENTAL_GEN_AI_OTEL_TRACES_ENABLED: "true"
EXPERIMENTAL_GEN_AI_OTEL_EXPORTER_OTLP_ENDPOINT: "https://oneuptime.com/otlp"
EXPERIMENTAL_GEN_AI_OTEL_EXPORTER_OTLP_HEADERS: "x-oneuptime-token=YOUR_INGESTION_TOKEN"
```

جزئیاتی که دانستنشان می‌ارزد:

- نشانی **پایه** OTLP را بدهید — Portkey خودش `/v1/traces` را می‌افزاید.
- هدرها جفت‌های `key=value` جداشده با ویرگول‌اند.
- صادرات OTLP روی **HTTP/JSON** است (بدون gRPC). نقطه پایانی OTLP در OneUptime ‏JSON می‌پذیرد، پس جمع‌کننده‌ای در میانه لازم نیست.
- اسپن‌ها به نام `{operation} {model}` (برای نمونه `chat gpt-4o`) نام‌گذاری می‌شوند و زیر نام سرویس `portkey` می‌رسند، و `gen_ai.provider.name`، `gen_ai.request.model`، `gen_ai.response.model`، `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`، `gen_ai.conversation.id` و `gen_ai.input.messages` / `gen_ai.output.messages` ساخت‌یافته را حمل می‌کنند.
- صادرات‌ها ناهمگام پس از پاسخ رخ می‌دهند (بدون تأخیر درخواست)، اما **دسته‌بندی و تلاش دوباره‌ای نیست** — صادرات شکست‌خورده انداخته می‌شود، پس این را رصدپذیری بدانید نه دفتر حسابرسی.
- **محتوای کامل اعلان و تکمیل گنجانده می‌شود.** اگر پاک‌سازی لازم دارید قواعد پاک‌سازی OneUptime را (**Traces → Settings**) اعمال کنید.
- اگر Portkey مقدار `x-portkey-trace-id` شما را به‌عنوان شناسه ردیابی بازاستفاده کند (وقتی شناسه رشته‌ای معتبر با ۳۲ نویسه هگز باشد چنین می‌کند)، اسپن‌های دروازه با ردیابی‌های خودِ برنامه شما هم‌بسته می‌شوند.

‏Portkey این قابلیت را آزمایشی علامت می‌زند؛ اگر متغیرها اثری نکردند، مستندات جاری و نسخه ایمیج دروازه‌شان را بررسی کنید — نمودارهای قدیمی‌تر Helm نام متغیرهای پیشین را مستند کرده بودند.

### دروازه متن‌باز و میزبانی‌شده: کلاینت را ابزارگذاری کنید

دروازه متن‌باز `portkey-ai/gateway` صادرکننده OTel ندارد، و روی دروازه میزبانی‌شده نمی‌توانید متغیر محیطی کارساز بگذارید. الگوی پشتیبانی‌شده برای هر دو: **برنامه‌ای را که از راه Portkey فراخوان می‌دهد ابزارگذاری کنید**، و آن اسپن‌ها را به OneUptime صادر کنید.

‏Portkey با API ‏OpenAI سازگار است، پس همان ابزارگذاری‌های GenAI از [راهنمای رصدپذیری هوش مصنوعی/LLM](/docs/telemetry/ai-llm-observability) — ‏OpenLLMetry، ‏OpenInference، ‏OpenLIT — فراخوان‌های SDK ‏OpenAI/Anthropic شما را حتی وقتی نشانی پایه به Portkey اشاره می‌کند عادی می‌پیچند:

```python
from traceloop.sdk import Traceloop
from openai import OpenAI

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

client = OpenAI(
    base_url="https://api.portkey.ai/v1",   # or your gateway's URL
    default_headers={"x-portkey-api-key": "PORTKEY_API_KEY"},
)
# Calls through Portkey are now traced to OneUptime.
```

یک هشدار صادقانه: اسپن‌های سمت کلاینت فراخوان را _همان‌گونه که برنامه شما فرستاده_ توصیف می‌کنند — مدل درخواست‌شده، تأخیر همان‌طور که مشاهده شده، توکن‌ها همان‌طور که برگشته‌اند. تصمیم‌های درونی دروازه (مسیردهی پشتیبان، تلاش دوباره، برخورد حافظه نهان) فقط درون Portkey دیده می‌مانند. اگر آن‌ها را در OneUptime لازم دارید، صادرات سازمانی بالا برای همین است.

## تأیید نشستن اسپن‌ها

درخواستی آزمایشی از راه دروازه بفرستید، چند ثانیه صبر کنید، سپس در پیمایش OneUptime (زیر Observability) بخش **AI / LLM** را باز کنید:

1. **LLM Calls** باید فراخوان را فهرست کند — ارائه‌دهنده، مدل، و شمار توکن‌ها پرشده. اسپن‌های LiteLLM به نام `litellm_request` هستند؛ صادرات سازمانی Portkey آن‌ها را `chat <model>` نام می‌گذارد.
2. روی فراخوان کلیک کنید تا ردیابی باز شود، و **پنل AI / LLM** اسپن را بررسی کنید: مدل، توکن‌های ورودی/خروجی، پارامترهای درخواست، و (مگر ثبت محتوا را غیرفعال کرده باشید) اعلان و تکمیل.
3. **Overview** باید فراخوان را در کل‌ها نشان دهد؛ هزینه هم پدیدار می‌شود — هرجا در دسترس باشد گزارش‌شده توسط دروازه، وگرنه برای مدل‌های شناخته [محاسبه‌شده هنگام دریافت](/docs/telemetry/ai-llm-observability) از روی شمار توکن‌ها.

چیزی پدیدار نمی‌شود؟

- توکن را دوباره بررسی کنید — `x-oneuptime-token` اشتباه هنگام دریافت رد می‌شود.
- املای نقطه پایانی را برای راه‌اندازی خودتان دوباره بررسی کنید: LiteLLM مسیر کامل `/otlp/v1/traces` را می‌خواهد؛ Portkey پایه `/otlp` را.
- از کلید اشکال‌زدایی هر دروازه (`OTEL_EXPORTER=console` برای LiteLLM؛ گزارش‌های دروازه برای Portkey) استفاده کنید تا تأیید کنید اصلاً اسپنی تولید می‌شود.
- صفحه **Traces** را بر پایه نام سرویس دروازه (`litellm`، `portkey`، یا `OTEL_SERVICE_NAME` شما) بپالایید تا اسپن‌های خام را ببینید، حتی اگر به‌عنوان فراخوان LLM دسته‌بندی نشده باشند.

## این چه چیزی را باز می‌کند

پس از نشستن اسپن‌های دروازه به‌صورت ردیابی‌های `gen_ai.*`، هر چیزی در رصدپذیری هوش مصنوعی OneUptime روی آن‌ها کار می‌کند:

- **[بودجه‌های روزانه هزینه](/docs/telemetry/ai-llm-observability)** در سراسر هر برنامه‌ای پشت دروازه — منتشرشده به‌عنوان سنجه‌هایی که مانیتورهایتان بر آن‌ها هشدار می‌دهند.
- **[مانیتورهای ردیابی](/docs/monitor/traces-monitor)** روی الگوهای اسپن، مانند عاملی لگام‌گسیخته که همان ابزار را در حلقه فرا می‌خواند.
- **[قطع مدار ناهمگام](/docs/telemetry/ai-agent-circuit-breaker)** — آن هشدارها را به گردش کاری‌ای زنجیر کنید که زیرساخت شما را برای متوقف کردن عاملی لگام‌گسیخته فرا می‌خواند، بی‌آنکه چیز تازه‌ای در مسیر درخواست بگذارید.
