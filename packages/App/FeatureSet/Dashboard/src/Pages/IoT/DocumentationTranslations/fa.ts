import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Persian (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Persian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Persian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "دستگاهی که یک SDK از OpenTelemetry را اجرا می‌کند و OTLP را روی HTTP صادر می‌کند",
  "Network access from the device to your OneUptime instance":
    "دسترسی شبکه از دستگاه به نمونه OneUptime شما",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "`building-a-sensors` و `sensor-001` را با نام ناوگان و شناسه دستگاه خود جایگزین کنید. `iot.fleet.name` را ثابت نگه دارید: تغییر آن یک ناوگان کاملاً تازه ثبت می‌کند.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در مرحله 1 یک کلید دریافت داده انتخاب کنید.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "خوانش‌های خود را به‌صورت متریک‌هایی با نام‌های مطابق قراردادهای `iot_*` بفرستید و به هر نقطه داده یک ویژگی `device.id` بدهید، مثلاً:",
  "| Metric | Value | Datapoint attribute |":
    "| متریک | مقدار | ویژگی نقطه داده |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "فهرست دستگاه‌ها بر اساس `device.id` نقطه داده ساخته می‌شود، نه منبع، پس آن را علاوه بر `OTEL_RESOURCE_ATTRIBUTES` روی هر اندازه‌گیری هم تنظیم کنید. همه نام‌های شناخته‌شده زیر **قراردادهای متریک** در پیشرفته آمده‌اند.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. مطمئن شوید دستگاه بدون خطا صادر می‌کند: لاگ‌های SDK را از نظر خطاهای صدور و پاسخ‌های HTTP `401` یا `422` بررسی کنید.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. در داشبورد OneUptime بخش **IoT** را باز کنید: ناوگان شما باید در حدود یک دقیقه نمایان شود.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. زبانه **دستگاه‌ها** ناوگان را باز کنید: هر `device.id` که فرستاده‌اید باید با آخرین وضعیت باتری، سیگنال، دما، CPU، حافظه و روشن/خاموش در فهرست باشد.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. برای رسم نمودار هر یک از سری‌های `iot_*`، **متریک‌ها** را زیر ناوگان باز کنید.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "عاملی برای نصب روی دستگاه وجود ندارد. OneUptime با ویژگی‌های OpenTelemetry دستگاه‌های شما را به دو مفهوم نگاشت می‌کند:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **ناوگان**: گروهی منطقی از دستگاه‌ها (مثلاً `building-a-sensors` یا `field-gateways`). ناوگان از ویژگی منبع `iot.fleet.name` به دست می‌آید و در OneUptime به‌صورت سرویس تله‌متری `iot/<fleet>` نمایان می‌شود. `service.name=iot/<fleet>` را تنظیم کنید تا لاگ‌ها و متریک‌ها زیر یک سرویس قرار بگیرند.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **دستگاه**: یک دستگاه منفرد در ناوگان که با ویژگی `device.id` هر نقطه داده شناسایی می‌شود. OneUptime برای هر ناوگان فهرستی از دستگاه‌ها بر اساس `device.id` می‌سازد و نگه می‌دارد.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "ویژگی‌هایی که OneUptime می‌خواند؛ ویژگی‌های اختیاری، دسته‌بندی هر دستگاه و محدوده آن در مانیتورها را دقیق‌تر می‌کنند:",
  "| Attribute | Set on | Required | Description |":
    "| ویژگی | محل تنظیم | الزامی | توضیح |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | منبع | بله | ناوگانی که این دستگاه به آن تعلق دارد. به سرویس OneUptime به نام `iot/<fleet>` تبدیل می‌شود |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | هر نقطه داده | بله | شناسه ثابت و یکتای دستگاه در ناوگان |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | هر نقطه داده | خیر | رده دستگاه، مثلاً `Device`، `Sensor` یا `Gateway`. پیش‌فرض: `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | هر نقطه داده | خیر | نوع یا مدل دقیق‌تر دستگاه برای فیلتر کردن مانیتورها (مثلاً `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | هر نقطه داده | خیر | نسخه میان‌افزاری که دستگاه گزارش می‌کند |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime نام‌های متریک `iot_*` زیر را می‌شناسد. هر نقطه داده باید برچسب `device.id` داشته باشد تا خوانش به دستگاه درست نسبت داده شود. فقط متریک‌هایی را بفرستید که برای دستگاه شما معنا دارند: متریک‌های ناموجود فقط رسم نمی‌شوند.",
  "| Metric Name | Meaning |": "| نام متریک | معنا |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | دسترس‌پذیری دستگاه. `1` = روشن/در دسترس، `0` = خاموش. مانیتور دستگاه IoT را به کار می‌اندازد |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | سیگنالی فقط برای هویت. `device.id` / رده / نوع / میان‌افزار را دارد تا دستگاه حتی پیش از گزارش خوانش‌ها در فهرست نمایان شود |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | میزان شارژ باتری، `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | قدرت سیگنال بی‌سیم بر حسب dBm (مثلاً RSSI در Wi-Fi / LoRa / شبکه همراه) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | دمای دستگاه یا حسگر بر حسب °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | مصرف CPU به‌صورت نسبت `0`–`1` (فهرست دستگاه‌ها آن را به درصد نشان می‌دهد) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | حافظه در حال استفاده، بر حسب بایت |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | کل حافظه در دسترس دستگاه، بر حسب بایت |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | ثانیه‌های گذشته از آخرین راه‌اندازی دستگاه |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. بررسی کنید که `iot.fleet.name` به‌عنوان ویژگی **منبع** تنظیم شده باشد (نه برچسب نقطه داده) و `service.name` برابر `iot/<fleet>` باشد.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. مطمئن شوید نقطه پایانی صادرکننده `<YOUR_ONEUPTIME_URL>/otlp` است و سرآیند `x-oneuptime-token` یک کلید دریافت داده معتبر دارد.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. مطمئن شوید هر نقطه داده برچسب `device.id` دارد: دستگاه‌ها بر اساس آن شناخته می‌شوند.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. برای دستگاه‌هایی که هنوز خوانشی گزارش نکرده‌اند `iot_device_info` (فقط هویت) بفرستید تا باز هم در فهرست نمایان شوند.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. بررسی کنید که مقدارهای `device.id` در گزارش‌های مختلف ثابت بمانند؛ شناسه‌ای که تغییر کند ردیف‌های تکراری دستگاه می‌سازد.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` یعنی کلید دریافت داده وجود ندارد، نادرست است یا منقضی شده؛ `422` یعنی غیرفعال شده یا یک کلید مرورگر است که نمی‌تواند تله‌متری دستگاه بفرستد. کلید دیگری را در بالا انتخاب کنید (یا کلید تازه‌ای بسازید) و سرآیند `x-oneuptime-token` را که دستگاه یا کالکتور شما می‌فرستد به‌روز کنید.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. نام‌های دقیق متریک `iot_*` را از **قراردادهای متریک** در پیشرفته به کار ببرید: نام‌های دیگر به‌صورت متریک‌های عمومی ذخیره می‌شوند و نمودارهای IoT را پر نمی‌کنند.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` نسبتی `0`–`1` است؛ همان نسبت خام را بفرستید تا OneUptime آن را به درصد نشان دهد.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. پس از اینکه دستگاه گزارش دادن را شروع کرد، تا یک دقیقه برای نمایان شدن نخستین نقطه‌های داده فرصت دهید.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "این کار خوانش‌ها را به ناوگان **`fleet-1`** می‌فرستد. `sensor-001` را با شناسه دستگاه جایگزین کنید و `iot.fleet.name` را دقیقاً همان‌طور که هست نگه دارید: نام دیگری یک ناوگان تازه ثبت می‌کند.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "یک دروازه که بتواند OpenTelemetry Collector را اجرا کند (با Docker یا فایل اجرایی `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "دستگاه‌هایی که OTLP را به دروازه می‌فرستند، و دسترسی شبکه از دروازه به نمونه OneUptime شما",
  "Save this as `config.yaml` on the gateway:":
    "این را با نام `config.yaml` روی دروازه ذخیره کنید:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- برای هر دروازه `iot.fleet.name` (و `service.name=iot/<fleet>` متناظر) را تنظیم کنید تا دستگاه‌های هر دروازه در ناوگان درست قرار بگیرند.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- `device.id` (و در صورت نیاز `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) را روی هر نقطه داده نگه دارید تا OneUptime بتواند دستگاه منفرد را در ناوگان پیدا کند.",
  "Run it from the directory that holds `config.yaml`:":
    "آن را از پوشه‌ای که `config.yaml` در آن است اجرا کنید:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "سپس دستگاه‌ها OTLP را به دروازه می‌فرستند (gRPC روی درگاه `4317`، HTTP روی درگاه `4318`)، مثلاً با `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` در SDK هر دستگاه.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "از قبل `otelcol-contrib` را روی دروازه دارید؟ آن را به این فایل ارجاع دهید:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. مطمئن شوید کالکتور دروازه بدون خطا صادر می‌کند: لاگ‌های آن را از نظر خطاهای صدور و پاسخ‌های HTTP `401` یا `422` بررسی کنید (وقتی در Docker اجرا می‌شود، `docker logs -f otel-collector`).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** داده‌ها را از دستگاه‌های شما روی gRPC (`4317`) و HTTP (`4318`) دریافت می‌کند. خوانش‌ها را از هر راه دیگری که کالکتور پشتیبانی می‌کند (پل MQTT، لاگ‌های فایل، …) دریافت کنید و از همان خط لوله عبور دهید.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** ویژگی‌های ناوگان را روی هر رکورد می‌زند. برای هر دروازه `iot.fleet.name` (و `service.name=iot/<fleet>` متناظر) را تنظیم کنید تا دستگاه‌های هر دروازه در ناوگان درست قرار بگیرند.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** رکوردها را پیش از صدور دسته‌بندی می‌کند تا دروازه برای هر خوانش یک رفت‌وبرگشت HTTP نپردازد.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** داده‌ها را با توکن دریافت داده روی HTTPS به OneUptime می‌فرستد. هم رمزگذاری پیش‌فرض protobuf و هم `encoding: json` پذیرفته می‌شوند.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- هر خوانشی که این دروازه ارسال می‌کند به ناوگان **`fleet-1`** می‌رود: `iot.fleet.name` و `service.name` را دقیقاً همان‌طور که هستند نگه دارید، وگرنه خوانش‌ها ناوگان تازه‌ای ثبت می‌کنند. دروازه ناوگان دیگر مقدارهای خودش را تنظیم می‌کند.",
  "Any MQTT client that can connect over WebSocket":
    "هر کلاینت MQTT که بتواند روی WebSocket متصل شود",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "مثلاً با کلاینت `mqtt` در Node.js (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "`building-a-sensors` و `sensor-001` را با نام ناوگان و شناسه دستگاه خود جایگزین کنید: OneUptime ناوگان و دستگاه را از موضوع می‌سازد. Last Will دستگاه را همان لحظه که اتصالش قطع شود آفلاین گزارش می‌کند؛ برای دستگاه‌هایی که مستقیم متصل می‌شوند، اعتبارنامه مخصوص خودشان بهتر است (هر دو در پیشرفته).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. مطمئن شوید کلاینت بدون خطا متصل می‌شود و منتشر می‌کند: رد شدن اتصال با کد بازگشت 4 (نام کاربری یا گذرواژه نادرست) یعنی کلید نادرست است.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. زبانه **دستگاه‌ها** ناوگان را باز کنید: هر دستگاهی که برایش منتشر کرده‌اید باید با آخرین وضعیت باتری، سیگنال، دما، CPU، حافظه و روشن/خاموش در فهرست باشد.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "عاملی برای نصب روی دستگاه وجود ندارد. OneUptime دستگاه‌های شما را به دو مفهوم نگاشت می‌کند و با MQTT، موضوع هر دو را تعیین می‌کند:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **ناوگان**: `<fleet>` در `oneuptime/<fleet>/…`، یعنی گروهی منطقی از دستگاه‌ها (مثلاً `building-a-sensors`). این بخش به `iot.fleet.name` خوانش‌ها تبدیل می‌شود و در OneUptime به‌صورت سرویس تله‌متری `iot/<fleet>` نمایان می‌شود.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **دستگاه**: `<device>` در `oneuptime/<fleet>/<device>/…`، یعنی یک دستگاه منفرد در ناوگان. این بخش به `device.id` هر خوانش تبدیل می‌شود و OneUptime بر اساس آن برای هر ناوگان فهرستی از دستگاه‌ها می‌سازد و نگه می‌دارد.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'ویژگی‌های اختیاری، دسته‌بندی هر دستگاه و محدوده آن در مانیتورها را دقیق‌تر می‌کنند. آن‌ها را در نگاشت `"attributes"` یک انتشار تله‌متری بگذارید: روی هر نقطه داده آن انتشار زده می‌شوند:',
  "| Attribute | Description |": "| ویژگی | توضیح |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | رده دستگاه، مثلاً `Device`، `Sensor` یا `Gateway`. پیش‌فرض: `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | نوع یا مدل دقیق‌تر دستگاه برای فیلتر کردن مانیتورها (مثلاً `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | نسخه میان‌افزاری که دستگاه گزارش می‌کند |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime نام‌های متریک `iot_*` زیر را می‌شناسد. در MQTT موضوع، دستگاه را نام می‌برد، پس هر خوانش به آن نسبت داده می‌شود. فقط متریک‌هایی را بفرستید که برای دستگاه شما معنا دارند: متریک‌های ناموجود فقط رسم نمی‌شوند.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "کلید دریافت داده کل پروژه برای دروازه‌هایی مناسب است که از طرف دستگاه‌های زیادی منتشر می‌کنند. برای دستگاه‌هایی که مستقیم متصل می‌شوند، هر دستگاه را در زبانه **رجیستری دستگاه‌ها** ناوگان ثبت کنید: این زبانه برای هر دستگاه اعتبارنامه‌ای صادر می‌کند؛ شناسه اعتبارنامه همان **نام کاربری** MQTT و رمز آن همان **گذرواژه** است. ناوگان با نخستین خوانشش نمایان می‌شود، پس مثل مرحله 2 ابتدا یک خوانش با کلید کل پروژه بفرستید.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **جداسازی موضوع‌ها**: اعتبارنامه یک دستگاه فقط می‌تواند زیر موضوع‌های `oneuptime/<fleet>/<device>/…` خود آن دستگاه منتشر کند؛ هر چیز دیگری دور ریخته می‌شود.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **ابطال جداگانه**: اعتبارنامه یک دستگاه را بدون دست زدن به بقیه ناوگان غیرفعال یا حذف کنید؛ دستگاه متصل ظرف چند ثانیه قطع می‌شود.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **تشخیص آفلاین شدن خاموش**: دستگاه ثبت‌شده وقتی گزارش دادن را متوقف کند، به‌جای ناپدید شدن، به‌صورت آفلاین در فهرست می‌ماند، حتی اگر بدون Last Will از کار بیفتد.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "روی `oneuptime/<fleet>/<device>/status` یک **Last Will** در MQTT با محموله `offline` ثبت کنید: اگر دستگاه از کار بیفتد، OneUptime همان لحظه که نشست قطع شود از طرف آن `iot_device_up = 0` را منتشر می‌کند و بدون نیاز به پرس‌وجوی دوره‌ای، الگوی هشدار آماده Device Offline را فعال می‌کند. پس از اتصال، `online` را روی همان موضوع منتشر کنید تا دستگاه دوباره روشن نشان داده شود؛ مثال مرحله 2 هر دو کار را انجام می‌دهد. هر خوانشی که دستگاه منتشر کند هم روشن به حساب می‌آید، پس دستگاهی که پیوسته خوانش می‌فرستد بدون انتشار دوباره وضعیتش روشن می‌ماند. موضوع وضعیت `1`/`0`، `true`/`false` و `up`/`down` را هم می‌پذیرد.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "keepalive در MQTT را روی نقطه پایانی WebSocket **زیر 5 دقیقه** نگه دارید (پیش‌فرض 60 ثانیه کتابخانه‌های کلاینت مناسب است): اتصال‌های WebSocket بی‌کار پس از 300 ثانیه بسته می‌شوند و این کار Last Will و یک هشدار آفلاین نادرست را فعال می‌کند.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "زیر پیشوند ثابت `oneuptime/` منتشر کنید. بخش‌های ناوگان و دستگاه نباید `/`، `+` یا `#` داشته باشند یا با `$` شروع شوند، و حداکثر 100 نویسه‌اند.",
  "| Topic | Payload |": "| موضوع | محموله |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | یک شیء JSON از خوانش‌ها، `{"metrics":{"iot_temperature_celsius":21.5}}`، یا شیئی تخت که فیلدهای عددی‌اش همان متریک‌ها هستند |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | یک مقدار تنها: یک عدد خالی (`23.4`) یا `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` یا `offline` که به `iot_device_up` نگاشت می‌شود |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'محموله‌های تله‌متری می‌توانند `"attributes"` (نگاشتی از رشته‌ها که روی هر نقطه داده زده می‌شود؛ آن را برای `iot.device.kind`، `iot.device.type`، `iot.device.firmware` یا برچسب‌های خودتان به کار ببرید) و `"timestamp"` (ISO-8601، یا ثانیه/میلی‌ثانیه Unix) هم داشته باشند. هر دو اختیاری‌اند؛ وقتی `timestamp` نباشد، زمان دریافت به کار می‌رود.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "این نقطه پایانی فقط برای دریافت داده است: اشتراک‌ها رد می‌شوند. هر انتشار به 128 KB و 100 متریک محدود است. انتشارهای خارج از این قرارداد، یا با محموله‌های بدشکل، پذیرفته و دور ریخته می‌شوند (MQTT 3.1.1 برای هر پیام پاسخ خطا ندارد) و OneUptime هشداری همراه با علت در لاگ ثبت می‌کند.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "استقرارهای خودمیزبان می‌توانند MQTT خام روی TCP را هم باز کنند (`MQTT_INGEST_PORT`، پیش‌فرض `1883`). شنونده به‌طور پیش‌فرض فقط درون شبکه خوشه یا Compose در دسترس است: اگر دستگاه‌های شما نمی‌توانند از WebSocket استفاده کنند، آن را باز کنید. سقف keepalive در WebSocket آنجا اعمال نمی‌شود.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "برای خاموش کردن شنونده‌های MQTT، `MQTT_INGEST_ENABLED=false` را روی سرویس برنامه تنظیم کنید.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. مطمئن شوید موضوع دقیقاً از `oneuptime/<fleet>/<device>/…` پیروی می‌کند: بخش ناوگان موضوع است که ناوگان را می‌سازد.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. انتشارهای خارج از قرارداد موضوع، یا با محموله‌های بدشکل، پذیرفته و دور ریخته می‌شوند (MQTT 3.1.1 برای هر پیام پاسخ خطا ندارد). انتشارهای خود را با **موضوع‌ها و محموله‌های MQTT** در پیشرفته مقایسه کنید؛ در یک نمونه خودمیزبان، لاگ‌های برنامه علت را ذکر می‌کنند (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime اعتبارنامه‌های نادرست را هنگام CONNECT با کد بازگشت 4 رد می‌کند. بررسی کنید که:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- گذرواژه یک کلید دریافت داده معتبر باشد، یا برای دستگاه ثبت‌شده، رمز اعتبارنامه باشد و شناسه اعتبارنامه به‌عنوان نام کاربری به کار رفته باشد؛",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- کلید یک کلید سرور باشد (کلیدهای مرورگر روی MQTT رد می‌شوند) و نه غیرفعال شده باشد و نه منقضی.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. شناسه دستگاه همان بخش `<device>` موضوع است: آن را در انتشارهای مختلف ثابت نگه دارید؛ شناسه‌ای که تغییر کند ردیف‌های تکراری دستگاه می‌سازد.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. برای دستگاه‌هایی که هنوز خوانشی گزارش نکرده‌اند، `iot_device_info` (فقط هویت) یا یک پیام `status` منتشر کنید تا باز هم در فهرست نمایان شوند.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "روی نقطه پایانی WebSocket، اتصال‌های بی‌کار پس از 300 ثانیه بسته می‌شوند و این کار Last Will و یک هشدار نادرست Device Offline را فعال می‌کند. keepalive در MQTT را زیر 5 دقیقه نگه دارید؛ پیش‌فرض 60 ثانیه کتابخانه‌های کلاینت مناسب است.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "`sensor-001` را با شناسه دستگاه جایگزین کنید: OneUptime دستگاه را از روی موضوع به ناوگان **`fleet-1`** اضافه می‌کند. Last Will دستگاه را همان لحظه که اتصالش قطع شود آفلاین گزارش می‌کند؛ برای دستگاه‌هایی که مستقیم متصل می‌شوند، اعتبارنامه مخصوص خودشان بهتر است (هر دو در پیشرفته).",
};

export default TRANSLATION;
