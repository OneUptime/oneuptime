import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Arabic (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Arabic. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Arabic words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "جهاز يشغّل حزمة OpenTelemetry SDK تصدّر OTLP عبر HTTP",
  "Network access from the device to your OneUptime instance":
    "وصول شبكي من الجهاز إلى مثيل OneUptime لديك",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "استبدل `building-a-sensors` و`sensor-001` باسم أسطولك ومعرّف الجهاز. أبقِ `iot.fleet.name` ثابتًا: تغييره يسجّل أسطولًا جديدًا تمامًا.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "أرسل قراءاتك بوصفها مقاييس تحمل أسماء وفق اصطلاحات `iot_*`، وامنح كل نقطة بيانات السمة `device.id`، مثلًا:",
  "| Metric | Value | Datapoint attribute |":
    "| المقياس | القيمة | سمة نقطة البيانات |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "يعتمد مخزون الأجهزة على `device.id` الخاص بنقطة البيانات لا على الخاص بالمورد، لذا اضبطه على كل قياس إضافةً إلى `OTEL_RESOURCE_ATTRIBUTES`. كل الأسماء المعروفة موجودة في **اصطلاحات المقاييس** ضمن متقدم.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. تحقّق من أن الجهاز يصدّر دون أخطاء: افحص سجلات SDK بحثًا عن إخفاقات التصدير واستجابات HTTP `401` أو `422`.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. في لوحة معلومات OneUptime، افتح قسم **IoT**: يُفترض أن يظهر أسطولك خلال دقيقة تقريبًا.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. افتح تبويب **الأجهزة** في الأسطول: يُفترض أن يظهر كل `device.id` أرسلته مع أحدث حالة للبطارية والإشارة والحرارة وCPU والذاكرة والتشغيل/التوقف.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. افتح **المقاييس** ضمن الأسطول لرسم أي سلسلة من سلاسل `iot_*`.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "لا يوجد وكيل لتثبيته على الجهاز. يربط OneUptime أجهزتك بمفهومين باستخدام سمات OpenTelemetry:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **الأسطول**: مجموعة منطقية من الأجهزة (مثل `building-a-sensors` أو `field-gateways`). يُستمد الأسطول من سمة المورد `iot.fleet.name` ويظهر في OneUptime بوصفه خدمة القياس عن بُعد `iot/<fleet>`. اضبط `service.name=iot/<fleet>` لتجتمع السجلات والمقاييس تحت الخدمة نفسها.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **الجهاز**: جهاز مفرد داخل الأسطول، يُعرَّف بالسمة `device.id` على كل نقطة بيانات. يبني OneUptime لكل أسطول مخزونًا من الأجهزة يعتمد على `device.id` ويحافظ عليه.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "السمات التي يقرؤها OneUptime؛ وتدقّق السمات الاختيارية طريقة تصنيف كل جهاز ونطاقه في المراقبات:",
  "| Attribute | Set on | Required | Description |":
    "| السمة | تُضبط على | مطلوبة | الوصف |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | المورد | نعم | الأسطول الذي ينتمي إليه هذا الجهاز. يصبح خدمة OneUptime باسم `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | كل نقطة بيانات | نعم | معرّف ثابت وفريد للجهاز داخل الأسطول |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | كل نقطة بيانات | لا | فئة الجهاز، مثل `Device` أو `Sensor` أو `Gateway`. القيمة الافتراضية `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | كل نقطة بيانات | لا | نوع أو طراز أدق للجهاز يُستخدم لتصفية المراقبات (مثل `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | كل نقطة بيانات | لا | إصدار البرنامج الثابت الذي يبلّغ عنه الجهاز |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "يتعرّف OneUptime على أسماء مقاييس `iot_*` التالية. يجب أن تحمل كل نقطة بيانات التسمية `device.id` لتُنسب القراءة إلى الجهاز الصحيح. لا تحتاج إلا إلى إرسال المقاييس المفيدة لجهازك: المقاييس الغائبة لا تُرسم فحسب.",
  "| Metric Name | Meaning |": "| اسم المقياس | المعنى |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | توفّر الجهاز. `1` = يعمل/يمكن الوصول إليه، `0` = متوقف. يشغّل مراقبة أجهزة IoT |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | إشارة للهوية فقط. تحمل `device.id` / الفئة / النوع / البرنامج الثابت ليظهر الجهاز في المخزون حتى قبل أن يبلّغ عن قراءات |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | مستوى شحن البطارية، `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | قوة الإشارة اللاسلكية بوحدة dBm (مثل RSSI لشبكة Wi-Fi أو LoRa أو الشبكة الخلوية) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | حرارة الجهاز أو المستشعر بالدرجة °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | استخدام CPU بوصفه نسبة `0`–`1` (يعرضه مخزون الأجهزة نسبة مئوية) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | الذاكرة المستخدمة حاليًا، بالبايت |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | إجمالي الذاكرة المتاحة على الجهاز، بالبايت |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | الثواني منذ آخر إقلاع للجهاز |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. تحقّق من ضبط `iot.fleet.name` بوصفه سمة **مورد** (لا تسمية لنقطة البيانات)، ومن أن قيمة `service.name` هي `iot/<fleet>`.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. تأكد من أن نقطة نهاية المصدِّر هي `<YOUR_ONEUPTIME_URL>/otlp` وأن الترويسة `x-oneuptime-token` تحمل مفتاح استيعاب صالحًا.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. تأكد من أن كل نقطة بيانات تحمل التسمية `device.id`: تُعرَّف الأجهزة بها.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. أرسل `iot_device_info` (للهوية فقط) للأجهزة التي لم تبلّغ عن قراءات بعد، لتظهر في المخزون مع ذلك.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. تحقّق من أن قيم `device.id` ثابتة بين الإرسالات؛ فالمعرّف المتغيّر ينشئ صفوفًا مكررة للأجهزة.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "يعني `401` أن مفتاح الاستيعاب مفقود أو خاطئ أو منتهي الصلاحية؛ ويعني `422` أنه معطَّل أو أنه مفتاح متصفح لا يمكنه إرسال القياس عن بُعد للأجهزة. اختر مفتاحًا آخر بالأعلى (أو أنشئ مفتاحًا جديدًا) وحدّث الترويسة `x-oneuptime-token` التي يرسلها جهازك أو المجمّع.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. استخدم أسماء مقاييس `iot_*` نفسها الواردة في **اصطلاحات المقاييس** ضمن متقدم: تُخزَّن الأسماء الأخرى بوصفها مقاييس عامة ولا تملأ رسوم IoT البيانية.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` نسبة من `0`–`1`؛ أرسل النسبة الخام وسيعرضها OneUptime نسبة مئوية.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. انتظر حتى دقيقة لظهور أولى نقاط البيانات بعد أن يبدأ الجهاز الإبلاغ.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "يرسل هذا القراءات إلى الأسطول **`fleet-1`**. استبدل `sensor-001` بمعرّف الجهاز، وأبقِ `iot.fleet.name` كما هو تمامًا: أي اسم آخر يسجّل أسطولًا جديدًا.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "بوابة يمكنها تشغيل OpenTelemetry Collector (باستخدام Docker أو الملف التنفيذي `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "أجهزة ترسل OTLP إلى البوابة، ووصول شبكي من البوابة إلى مثيل OneUptime لديك",
  "Save this as `config.yaml` on the gateway:":
    "احفظ هذا باسم `config.yaml` على البوابة:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- اضبط `iot.fleet.name` (و`service.name=iot/<fleet>` المطابق) لكل بوابة لتصل أجهزة كل بوابة إلى الأسطول الصحيح.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- أبقِ `device.id` (واختياريًا `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) على كل نقطة بيانات ليتمكن OneUptime من تحديد الجهاز المفرد داخل الأسطول.",
  "Run it from the directory that holds `config.yaml`:":
    "شغّله من المجلد الذي يحتوي على `config.yaml`:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "ترسل الأجهزة بعد ذلك OTLP إلى البوابة (gRPC على المنفذ `4317`، وHTTP على المنفذ `4318`)، مثلًا باستخدام `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` في SDK كل جهاز.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "هل لديك `otelcol-contrib` على البوابة بالفعل؟ وجّهه إلى الملف:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. تحقّق من أن مجمّع البوابة يصدّر دون أخطاء: افحص سجلاته بحثًا عن إخفاقات التصدير واستجابات HTTP `401` أو `422` (`docker logs -f otel-collector` عندما يعمل في Docker).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** يستقبل من أجهزتك عبر gRPC (`4317`) وHTTP (`4318`). استقبل القراءات بأي طريقة أخرى يدعمها المجمّع (جسر MQTT، سجلات الملفات، …) ومرّرها عبر خط المعالجة نفسه.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** يَسِم كل سجل بسمات الأسطول. اضبط `iot.fleet.name` (و`service.name=iot/<fleet>` المطابق) لكل بوابة لتصل أجهزة كل بوابة إلى الأسطول الصحيح.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** يجمّع السجلات قبل التصدير كي لا تتحمّل البوابة رحلة HTTP ذهابًا وإيابًا لكل قراءة.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** يرسل إلى OneUptime عبر HTTPS مع إرفاق رمز الاستيعاب. يُقبل كل من ترميز protobuf الافتراضي و`encoding: json`.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- كل قراءة تمرّرها هذه البوابة تذهب إلى الأسطول **`fleet-1`**: أبقِ `iot.fleet.name` و`service.name` كما هما تمامًا، وإلا فستسجّل القراءات أسطولًا جديدًا. تضبط بوابة أسطول آخر قيمها الخاصة.",
  "Any MQTT client that can connect over WebSocket":
    "أي عميل MQTT يمكنه الاتصال عبر WebSocket",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "مثلًا، باستخدام عميل `mqtt` في Node.js (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "استبدل `building-a-sensors` و`sensor-001` باسم أسطولك ومعرّف الجهاز: ينشئ OneUptime الأسطول والجهاز من الموضوع. يبلّغ Last Will عن الجهاز بأنه غير متصل لحظة انقطاع اتصاله؛ والأفضل للأجهزة التي تتصل مباشرة أن تكون لها بيانات اعتماد خاصة بها (كلاهما ضمن متقدم).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. تحقّق من أن العميل يتصل وينشر دون أخطاء: رفض الاتصال برمز الإرجاع 4 (اسم مستخدم أو كلمة مرور خاطئة) يعني أن المفتاح خاطئ.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. افتح تبويب **الأجهزة** في الأسطول: يُفترض أن يظهر كل جهاز نشرت له مع أحدث حالة للبطارية والإشارة والحرارة وCPU والذاكرة والتشغيل/التوقف.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "لا يوجد وكيل لتثبيته على الجهاز. يربط OneUptime أجهزتك بمفهومين، ومع MQTT يحدد الموضوع كليهما:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **الأسطول**: قيمة `<fleet>` في `oneuptime/<fleet>/…`، أي مجموعة منطقية من الأجهزة (مثل `building-a-sensors`). تصبح `iot.fleet.name` للقراءات وتظهر في OneUptime بوصفها خدمة القياس عن بُعد `iot/<fleet>`.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **الجهاز**: قيمة `<device>` في `oneuptime/<fleet>/<device>/…`، أي جهاز مفرد داخل الأسطول. تصبح `device.id` لكل قراءة، ويبني OneUptime عليها لكل أسطول مخزونًا من الأجهزة ويحافظ عليه.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'تدقّق السمات الاختيارية طريقة تصنيف كل جهاز ونطاقه في المراقبات. ضعها في الخريطة `"attributes"` لعملية نشر القياس عن بُعد: تُوسَم بها كل نقطة بيانات في عملية النشر تلك:',
  "| Attribute | Description |": "| السمة | الوصف |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | فئة الجهاز، مثل `Device` أو `Sensor` أو `Gateway`. القيمة الافتراضية `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | نوع أو طراز أدق للجهاز يُستخدم لتصفية المراقبات (مثل `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | إصدار البرنامج الثابت الذي يبلّغ عنه الجهاز |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "يتعرّف OneUptime على أسماء مقاييس `iot_*` التالية. عبر MQTT يسمّي الموضوع الجهاز، لذا تُنسب كل قراءة إليه. لا تحتاج إلا إلى إرسال المقاييس المفيدة لجهازك: المقاييس الغائبة لا تُرسم فحسب.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "يناسب مفتاح الاستيعاب على مستوى المشروع البوابات التي تنشر نيابةً عن أجهزة كثيرة. أما الأجهزة التي تتصل مباشرة فسجّل كل جهاز منها في تبويب **سجل الأجهزة** في الأسطول: يُصدر بيانات اعتماد لكل جهاز؛ ومعرّف بيانات الاعتماد هو **اسم المستخدم** في MQTT والسر هو **كلمة المرور**. يظهر الأسطول مع أول قراءة له، لذا أرسل أولًا قراءة بمفتاح المشروع، كما في الخطوة 2.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **عزل المواضيع**: لا يمكن لبيانات اعتماد الجهاز النشر إلا تحت مواضيعه الخاصة `oneuptime/<fleet>/<device>/…`؛ ويُتجاهل كل ما عدا ذلك.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **الإبطال الفردي**: عطّل بيانات اعتماد جهاز واحد أو احذفها دون المساس ببقية الأسطول؛ ويُقطع اتصال الجهاز المتصل خلال ثوانٍ.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **اكتشاف التوقف الصامت**: يبقى الجهاز المسجّل في المخزون بحالة غير متصل عندما يتوقف عن الإبلاغ، بدل أن يختفي، حتى لو توقف دون Last Will.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "سجّل **Last Will** في MQTT على `oneuptime/<fleet>/<device>/status` بالحمولة `offline`: إذا توقف الجهاز، ينشر OneUptime نيابةً عنه `iot_device_up = 0` لحظة انقطاع الجلسة، ما يشغّل قالب التنبيه الجاهز Device Offline دون استطلاع دوري. انشر `online` على الموضوع نفسه بعد الاتصال ليظهر الجهاز في حالة تشغيل من جديد؛ ومثال الخطوة 2 يفعل الأمرين. تُحتسب أي قراءة ينشرها الجهاز تشغيلًا أيضًا، لذا يبقى الجهاز الذي يواصل إرسال القراءات في حالة تشغيل دون أن ينشر حالته من جديد. يقبل موضوع الحالة أيضًا `1`/`0` و`true`/`false` و`up`/`down`.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "أبقِ مهلة keepalive في MQTT **أقل من 5 دقائق** على نقطة نهاية WebSocket (القيم الافتراضية البالغة 60 ثانية في مكتبات العملاء مناسبة): تُغلق اتصالات WebSocket الخاملة بعد 300 ثانية، ما سيشغّل Last Will وتنبيهًا خاطئًا بانقطاع الاتصال.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "انشر تحت البادئة الثابتة `oneuptime/`. لا يجوز أن تحتوي مقاطع الأسطول والجهاز على `/` أو `+` أو `#` أو أن تبدأ بـ `$`، وهي محدودة بـ 100 حرف.",
  "| Topic | Payload |": "| الموضوع | الحمولة |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | كائن JSON من القراءات، `{"metrics":{"iot_temperature_celsius":21.5}}`، أو كائن مسطّح حقوله الرقمية هي المقاييس |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | قيمة واحدة: رقم مجرد (`23.4`) أو `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` أو `offline`، وتُطابَق مع `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'يمكن أن تحمل حمولات القياس عن بُعد أيضًا `"attributes"` (خريطة نصوص تُوسَم بها كل نقطة بيانات؛ استخدمها لـ `iot.device.kind` و`iot.device.type` و`iot.device.firmware` أو لتسمياتك الخاصة) و`"timestamp"` (ISO-8601، أو ثوانٍ/أجزاء من الألف من الثانية بتوقيت Unix). كلاهما اختياري؛ ويُستخدم وقت الاستيعاب عند غياب `timestamp`.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "نقطة النهاية مخصصة للاستيعاب فقط: تُرفض الاشتراكات. يُحدّ النشر الواحد بـ 128 KB و100 مقياس. تُقبل عمليات النشر الخارجة عن هذا العقد، أو ذات الحمولات المشوّهة، ثم تُتجاهل (لا يحتوي MQTT 3.1.1 على رد خطأ لكل رسالة)، ويسجّل OneUptime تحذيرًا يذكر السبب.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "يمكن لعمليات النشر المستضافة ذاتيًا أن تكشف أيضًا MQTT خامًا عبر TCP (`MQTT_INGEST_PORT`، الافتراضي `1883`). المستمع داخلي في شبكة العنقود أو Compose افتراضيًا: اكشفه إذا كانت أجهزتك لا تستطيع استخدام WebSocket. لا ينطبق هناك الحد الأقصى لمهلة keepalive في WebSocket.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "اضبط `MQTT_INGEST_ENABLED=false` على خدمة التطبيق لإيقاف مستمعي MQTT.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. تأكد من أن الموضوع يتبع `oneuptime/<fleet>/<device>/…` تمامًا: مقطع الأسطول في الموضوع هو ما ينشئ الأسطول.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. تُقبل عمليات النشر الخارجة عن عقد المواضيع، أو ذات الحمولات المشوّهة، ثم تُتجاهل (لا يحتوي MQTT 3.1.1 على رد خطأ لكل رسالة). قارن عمليات نشرك بما في **مواضيع MQTT وحمولاتها** ضمن متقدم؛ وفي المثيل المستضاف ذاتيًا تذكر سجلات التطبيق السبب (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "يرفض OneUptime بيانات الاعتماد الخاطئة عند CONNECT برمز الإرجاع 4. تحقّق من أن:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- كلمة المرور مفتاح استيعاب صالح، أو سر بيانات الاعتماد للجهاز المسجّل مع استخدام معرّف بيانات الاعتماد اسمًا للمستخدم؛",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- المفتاح مفتاح خادم (تُرفض مفاتيح المتصفح عبر MQTT) ولم يُعطَّل ولم تنتهِ صلاحيته.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. معرّف الجهاز هو مقطع `<device>` في الموضوع: أبقه ثابتًا بين عمليات النشر؛ فالمعرّف المتغيّر ينشئ صفوفًا مكررة للأجهزة.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. انشر `iot_device_info` (للهوية فقط) أو رسالة `status` للأجهزة التي لم تبلّغ عن قراءات بعد، لتظهر في المخزون مع ذلك.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "على نقطة نهاية WebSocket، تُغلق الاتصالات الخاملة بعد 300 ثانية، ما يشغّل Last Will وتنبيه Device Offline خاطئًا. أبقِ مهلة keepalive في MQTT أقل من 5 دقائق؛ والقيم الافتراضية البالغة 60 ثانية في مكتبات العملاء مناسبة.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "استبدل `sensor-001` بمعرّف الجهاز: يضيف OneUptime الجهاز إلى الأسطول **`fleet-1`** انطلاقًا من الموضوع. يبلّغ Last Will عن الجهاز بأنه غير متصل لحظة انقطاع اتصاله؛ والأفضل للأجهزة التي تتصل مباشرة أن تكون لها بيانات اعتماد خاصة بها (كلاهما ضمن متقدم).",
};

export default TRANSLATION;
