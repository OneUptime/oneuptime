# فرستادن داده Syslog به OneUptime

## نمای کلی

سرویس OpenTelemetry Ingest اکنون محموله‌های بومی Syslog را می‌پذیرد. می‌توانید پیام‌ها را از هر منبع سازگار با RFC3164 یا RFC5424 مستقیماً از طریق HTTPS به OneUptime بفرستید. OneUptime اولویت، facility، شدت، داده ساختاریافته و بدنه پیام syslog را تجزیه می‌کند و سپس همه‌چیز را به‌صورت لاگ‌های قابل جستجو ذخیره می‌کند.

## پیش‌نیازها

- **توکن دریافت تله‌متری** — یکی را از مسیر _Project Settings → Telemetry & APM → Ingestion Keys_ بسازید و مقدار `x-oneuptime-token` را کپی کنید.
- **ارجاع‌دهنده syslog** — هر ابزاری که بتواند درخواست HTTP POST بفرستد (برای نمونه `curl`، `rsyslog` با `omhttp`، یا `syslog-ng` با افزونه مقصد HTTP).
- **نام سرویس (اختیاری)** — هدر `x-oneuptime-service-name` را تنظیم کنید تا لاگ‌های ورودی زیر یک سرویس تله‌متری مشخص گروه‌بندی شوند. اگر نباشد، OneUptime به `APP-NAME` در syslog، نام میزبان یا `Syslog` بازمی‌گردد.

## نقطه پایانی

```
POST https://oneuptime.com/syslog/v1/logs
```

- اگر OneUptime را خودمیزبانی می‌کنید، `oneuptime.com` را با میزبان خود جایگزین کنید.
- همیشه هدر `x-oneuptime-token` را در درخواست بگنجانید.

## بدنه درخواست

رشته‌های Syslog جداشده با خط جدید یا یک محموله JSON با آرایه `messages` بفرستید. هر دو قالب RFC3164 (BSD) و RFC5424 پشتیبانی می‌شوند.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### نوع‌های محتوای پشتیبانی‌شده

- `application/json` — توصیه‌شده.
- `text/plain` — پیام‌های جداشده با خط جدید.
- `application/octet-stream` — محموله‌های خام. فشرده‌سازی gzip (`Content-Encoding: gzip`) هم پذیرفته می‌شود.

## آزمایش سریع با curl

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_KEY" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## ارجاع از rsyslog

1. ماژول خروجی HTTP را نصب کنید:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. مقصد را به `/etc/rsyslog.d/oneuptime.conf` اضافه کنید:

   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: YOUR_TELEMETRY_KEY"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```

3. rsyslog را راه‌اندازی مجدد کنید:
   ```bash
   sudo systemctl restart rsyslog
   ```

## کاربردهای رایجی که از پیش می‌بینیم

### ۱. تجهیزات شبکه و امنیت

بیشتر تجهیزات شبکه هنوز تغییرهای پیکربندی، برخوردهای ACL و تشخیص تهدید را فقط از طریق syslog ارائه می‌دهند. رله موجود خود (Palo Alto، Fortinet، Cisco ASA، Juniper، pfSense و دیگران) را مستقیماً به OneUptime بدهید، یا یک رله داخلی نگه دارید و از طریق HTTPS ارجاع دهید:

```bash
# rsyslog snippet that batches messages into JSON and posts to OneUptime
module(load="omhttp")

template(name="OneUptimeJSON" type="list") {
  constant(value="{\"messages\":[\"")
  property(name="rawmsg")
  constant(value="\"]}")
}

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: perimeter-firewall"
  template="OneUptimeJSON"
)
```

### ۲. سرورهای Linux و کارهای cron

بسیاری از کارهای cron و دیمن‌های قدیمی هنوز فقط از طریق facility مربوط به کرنل/syslog لاگ می‌کنند. ارجاع `/var/log/syslog` یا مدخل‌های journald، ردپاهای عملیاتی را در یک جا نگه می‌دارد. میزبان‌های systemd می‌توانند به پل journald → syslog تکیه کنند:

```bash
# /etc/rsyslog.d/oneuptime.conf
module(load="imjournal" StateFile="imjournal.state")
module(load="omhttp")

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: linux-fleet"
  template="OneUptimeJSON"
)
```

چون کدهای شدت را نگاشت می‌کنیم، می‌توانید روی `syslog.severity.name = "error"` هشدار بدهید یا بر اساس `syslog.hostname` تفکیک کنید تا ماشین‌های پرنوفه را سریع جدا کنید.

### ۳. کنترلرهای ingress در Kubernetes و گره‌های لبه

اگر از پیش Fluent Bit یا Fluentd را اجرا می‌کنید، آن‌ها را برای لاگ‌های کانتینر نگه دارید و یک مقصد سبک syslog برای میزبان‌ها یا تجهیزات لبه اضافه کنید. ورودی `syslog` در Fluent Bit با خروجی HTTP جفت می‌شود:

```ini
[INPUT]
    Name              syslog
    Mode              tcp
    Listen            0.0.0.0
    Port              5140

[OUTPUT]
    Name              http
    Match             *
    Host              oneuptime.com
    Port              443
    URI               /syslog/v1/logs
    Format            json
    json_date_key     time
    Header            Content-Type application/json
    Header            x-oneuptime-token <TOKEN>
    Header            x-oneuptime-service-name edge-ingress
    tls               On
```

این راه‌اندازی به شما امکان می‌دهد syslog را از کارگرهای فیزیکی یا متعادل‌کننده‌های بار سخت‌افزاری دریافت کنید، بی‌آنکه پشته لاگ دیگری بسازید.

### ۴. آرشیو انطباق بدون انتظار

لازم است لاگ‌های دیوار آتش را برای PCI یا SOX نگه دارید؟ آن‌ها را مستقیم به OneUptime بفرستید، یک سیاست نگهداری بلندمدت روی سرویس تله‌متری اعمال کنید و از یک جا به ذخیره‌سازی سرد خروجی بگیرید. دیگر خبری از خروجی گرفتن از چند رله syslog نیست.

## ویژگی‌های تجزیه‌شده

OneUptime به‌صورت خودکار این ویژگی‌ها را به هر مدخل لاگ اضافه می‌کند:

- `syslog.priority`، `syslog.facility.code`، `syslog.facility.name`
- `syslog.severity.code`، `syslog.severity.name`
- `syslog.hostname`، `syslog.appName`، `syslog.processId`، `syslog.messageId`
- `syslog.structured.*` (داده ساختاریافته RFC5424 که تخت شده است)
- `syslog.raw` (پیام اصلی برای ردیابی‌پذیری)

این ویژگی‌ها درون کاوشگر **Products → Logs** قابل جستجو می‌شوند.

## رفع اشکال

- **HTTP 401 یا نتایج خالی** — بررسی کنید هدر `x-oneuptime-token` متعلق به پروژه‌ای باشد که لاگ‌ها را دریافت می‌کند.
- **هیچ لاگی ظاهر نمی‌شود** — مطمئن شوید بدنه درخواست واقعاً خطوط syslog دارد. بدنه‌های خالی با HTTP 400 رد می‌شوند.
- **نام سرویس غیرمنتظره** — برای بازنویسی منطق تشخیص پیش‌فرض، `x-oneuptime-service-name` را تنظیم کنید.
- **جهش‌های بزرگ** — دسته‌بندی تا ۱۰۰۰ خط در هر درخواست پشتیبانی می‌شود. جهش‌های بزرگ‌تر در صف قرار می‌گیرند و به‌صورت ناهم‌گام پردازش می‌شوند.
