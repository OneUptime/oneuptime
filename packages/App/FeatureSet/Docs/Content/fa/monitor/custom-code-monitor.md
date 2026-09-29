# مانیتور کد سفارشی

مانیتور کد سفارشی به شما امکان می‌دهد اسکریپت‌های سفارشی بنویسید تا برنامه‌هایتان را پایش کنید. با این قابلیت می‌توانید برنامه‌های خود را به شکلی پایش کنید که با مانیتورهای موجود ممکن نیست. برای نمونه، می‌توانید درخواست‌های API چندمرحله‌ای داشته باشید.

#### نمونه

نمونه زیر نشان می‌دهد چگونه از مانیتور کد سفارشی استفاده کنید:

```javascript
// You can use axios module.

await axios.get("https://api.example.com/");

// Axios Documentation here: https://axios-http.com/docs/intro

return {
  data: "Hello World", // return any data you like here.
};
```

### استفاده از اسرار مانیتور

#### افزودن یک راز

برای افزودن یک راز، لطفاً به داشبورد OneUptime -> Monitors -> Settings -> Secrets -> Create Monitor Secret بروید.

![ساخت راز](/docs/static/images/CreateMonitorSecret.png)

می‌توانید انتخاب کنید کدام مانیتورها به این راز دسترسی داشته باشند. در این نمونه راز `ApiKey` را اضافه کردیم و مانیتورهایی را که به آن دسترسی دارند برگزیدیم.

**توجه کنید**: اسرار رمزگذاری و به‌صورت امن ذخیره می‌شوند. اگر راز را از دست بدهید باید راز جدیدی بسازید. پس از ذخیره، نمی‌توانید راز را ببینید یا به‌روزرسانی کنید.

#### استفاده از یک راز

برای استفاده از اسرار مانیتور در اسکریپت، می‌توانید در بافتار اسکریپت از شیء `monitorSecrets` استفاده کنید. با آن به اسراری که به مانیتور افزوده‌اید دسترسی دارید.

```javascript
// if your secret is of type string then you need to wrap it in quotes
let stringSecret = '{{monitorSecrets.StringSecret}}';

// if your secret is of type number or boolean then you can use it directly
let numberSecret = {{monitorSecrets.NumberSecret}};

// if your secret is of type boolean then you can use it directly
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// you can even console log to see if the secrets is being fetched correctly
console.log(stringSecret);
```

### متریک‌های سفارشی

می‌توانید با تابع `oneuptime.captureMetric()` از اسکریپت خود متریک‌های سفارشی ثبت کنید. این متریک‌ها در OneUptime ذخیره می‌شوند و می‌توان آن‌ها را با کاوشگر متریک روی داشبوردها نمودار کرد.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (رشته، الزامی): نام متریک (برای نمونه `"api.response.time"`). به‌صورت خودکار با پیشوند `custom.monitor.` ذخیره می‌شود.
- `value` (عدد، الزامی): مقدار عددی متریک.
- `attributes` (شیء، اختیاری): جفت‌های کلید-مقدار برای بافتار بیشتر. مقادیر رشته‌ای، عددی و بولی ثبت می‌شوند (اعداد و بولی‌ها به‌صورت متن ذخیره می‌شوند، چون ویژگی‌های متریک بُعد هستند نه اندازه‌گیری). مقادیر از هر نوع دیگری نادیده گرفته می‌شوند.

#### نمونه

```javascript
const response = await axios.get("https://api.example.com/health");

// Capture a simple metric
oneuptime.captureMetric("api.response.time", response.data.latency);

// Capture a metric with attributes
oneuptime.captureMetric("api.queue.depth", response.data.queueDepth, {
  region: "us-east-1",
  environment: "production",
});

return {
  data: response.data,
};
```

پس از ثبت، این متریک‌ها در کاوشگر متریک با نام‌هایی مانند `custom.monitor.api.response.time` ظاهر می‌شوند. می‌توانید آن‌ها را به نمودارهای داشبورد اضافه کنید، هشدار تنظیم کنید و بر اساس مانیتور، پراب یا هر ویژگی سفارشی‌ای که داده‌اید فیلتر کنید.

**محدودیت‌ها:**

- حداکثر ۱۰۰ متریک در هر اجرای اسکریپت.
- نام متریک‌ها به ۲۰۰ نویسه محدود است.
- مقادیر باید عددی باشند.
- حداکثر ۵۰ ویژگی به ازای هر متریک. کلید ویژگی‌ها به ۲۰۰ نویسه و مقدار ویژگی‌ها به ۱۰۰۰ نویسه محدود است.

**کلیدهای ویژگی رزروشده:**

برخی نام‌های ویژگی متعلق به خود OneUptime هستند و اسکریپت نمی‌تواند آن‌ها را بنویسد. اگر اسکریپت شما یکی از آن‌ها را تنظیم کند، آن ویژگی حذف می‌شود — خودِ متریک همچنان ثبت می‌شود — و هشداری با نام آن کلید در گزارش‌های سرور OneUptime نوشته می‌شود. این‌ها هستند:

- هویت مانیتور: `monitorId`، `projectId`، `monitorName`، `probeName`، `probeId`، `isCustomMetric`.
- هر چیزی در فضای نام `oneuptime.` یا `resource.` — این‌ها شناسه‌هایی را حمل می‌کنند که OneUptime هنگام دریافت مهر می‌زند.
- ویژگی‌های هویت منبع: `service.name`، `host.name`، `k8s.cluster.name`، `iot.fleet.name`، `proxmox.cluster.name`، `vmware.vcenter.name`، `ceph.cluster.name` و `docker.swarm.cluster.name`.

دلیلش این است که این نام‌ها فقط برچسب نیستند — OneUptime آن‌ها را به‌عنوان ادعایی درباره اینکه یک نقطه داده به کدام منبع تعلق دارد بازمی‌خواند. متریکی که با `service.name: payments-api` نشانه‌گذاری شده باشد در زبانه متریک‌های همان سرویس ظاهر می‌شود، و اگر بعداً یک مانیتور متریک گروه‌بندی‌شده بر اساس `service.name` بسازید، هشدارهایش به آن سرویس پیوند می‌خورند، به مالکان آن سرویس فراخوان می‌دهند و در پنجره تعمیر و نگهداری آن ساکت می‌شوند. برای مرتبط کردن یک مانیتور با یک سرویس یا میزبان، به‌جایش از برچسب‌های خود مانیتور استفاده کنید.

### ماژول‌های در دسترس در اسکریپت

- `axios`: با این ماژول می‌توانید درخواست HTTP بزنید. یک کلاینت HTTP مبتنی بر promise برای مرورگر و Node.js است.
- `crypto`: با این ماژول می‌توانید عملیات رمزنگاشتی انجام دهید. یک ماژول درونی Node.js است که قابلیت‌های رمزنگاشتی از جمله مجموعه‌ای از پوشش‌ها برای توابع hash، HMAC، cipher، decipher، sign و verify در OpenSSL را فراهم می‌کند.
- `console.log`: با این می‌توانید داده را در کنسول لاگ کنید. برای عیب‌یابی مفید است.
- `oneuptime.captureMetric`: با این می‌توانید از اسکریپت خود متریک سفارشی ثبت کنید. بخش متریک‌های سفارشی بالا را ببینید.
- `http`: با این ماژول می‌توانید درخواست HTTP بزنید. یک ماژول درونی Node.js است که کلاینت و سرور HTTP فراهم می‌کند.
- `https`: با این ماژول می‌توانید درخواست HTTPS بزنید. یک ماژول درونی Node.js است که کلاینت و سرور HTTPS فراهم می‌کند.

### نکته‌هایی که باید در نظر بگیرید

- می‌توانید با `console.log` داده را در کنسول لاگ کنید. این در بخش گزارش‌های مانیتور در دسترس است (Probes > View Logs).
- می‌توانید داده را با دستور `return` از اسکریپت برگردانید.
- این یک اسکریپت JavaScript است، پس می‌توانید از همه قابلیت‌های JavaScript در آن استفاده کنید.
- وقفه اسکریپت ۲ دقیقه است. اگر اجرای اسکریپت بیش از ۲ دقیقه طول بکشد، خاتمه داده می‌شود.
