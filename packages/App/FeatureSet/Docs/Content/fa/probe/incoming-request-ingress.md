# ورودی درخواست‌های دریافتی

یک پراب سفارشی می‌تواند به‌صورت اختیاری یک **شنونده HTTP ورودی** اجرا کند که فراخوان‌های `heartbeat` و `incoming-request` را از درون شبکه خصوصی شما می‌پذیرد و به OneUptime ارجاع می‌دهد. این کار به سرویس‌هایی که **هیچ دسترسی خروجی به اینترنت ندارند** امکان می‌دهد باز هم به یک [مانیتور درخواست ورودی](/docs/monitor/incoming-request-monitor) گزارش دهند، با فرستادن درخواست به پرابی روی شبکه محلی به‌جای `oneuptime.com`.

## نمای کلی

وقتی `PROBE_INGRESS_PORT` تنظیم شود، پراب یک شنونده HTTP اضافی روی آن پورت باز می‌کند. این شنونده همان مسیرهای `secretkey` را می‌پذیرد که نقاط پایانی عمومی OneUptime می‌پذیرند:

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

سپس پراب درخواست را به نمونه OneUptime شما پراکسی می‌کند و روش، بدنه و هدرهای درخواست را حفظ می‌کند (به‌جز هدرهای گام‌به‌گام مانند `Host`، `Connection`، `Content-Length` و مانند آن). پراب به‌صورت خودکار یک هدر `OneUptime-Probe-Id` می‌افزاید تا درخواست به پراب ارجاع‌دهنده نسبت داده شود.

شنونده روی یک **پورت اختصاصی** و جدا از نقاط پایانی وضعیت/متریک داخلی پراب اجرا می‌شود، بنابراین می‌توانید آن را به شبکه خصوصی خود عرضه کنید بی‌آنکه چیز دیگری را عرضه کرده باشید.

## چه زمانی از این استفاده کنیم

از شنونده ورودی وقتی استفاده کنید که:

- سرویس‌های شما در بخش شبکه‌ای ایزوله بدون دسترسی خروجی HTTPS اجرا می‌شوند
- لازم است همه ترافیک پایش درون VPC / شبکه داخلی شما بماند
- می‌خواهید یک نقطه خروج واحد داشته باشید — پراب — که اجازه رسیدن به OneUptime را دارد
- از پیش یک [پراب سفارشی](/docs/probe/custom-probe) مستقر کرده‌اید و می‌خواهید برای ضربان‌های ورودی هم از آن استفاده کنید

اگر سرویس‌های شما از پیش می‌توانند مستقیماً به `https://oneuptime.com` (یا نشانی خودمیزبان شما) برسند، به این قابلیت نیاز **ندارید** — نشانی ضربان را مستقیم از سرویس فراخوانی کنید.

## فعال کردن شنونده ورودی

مقدار `PROBE_INGRESS_PORT` را روی پورتی بگذارید که می‌خواهید شنونده روی آن باز شود. هر مقدار بزرگ‌تر از `0` شنونده را فعال می‌کند؛ تنظیم‌نکردن (یا `0`) آن را غیرفعال می‌کند.

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

اگر از `--network host` استفاده نمی‌کنید، پورت ورودی را صریحاً منتشر کنید:

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

آنگاه سرویس‌های داخلی می‌توانند ضربان‌ها را به `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>` بفرستند.

## فرستادن درخواست به پراب

نشانی عمومی ضربان:

```
https://oneuptime.com/heartbeat/<secret-key>
```

را با نشانی ورودی پراب جایگزین کنید:

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

مسیر، روش، بدنه و هدرها در بقیه موارد یکسان‌اند، بنابراین هر کد کلاینت موجودی فقط به تغییر نشانی پایه نیاز دارد.

### نمونه‌ها

```bash
# GET heartbeat
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# POST heartbeat with JSON body
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cron job
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## رفتار ارجاع

- **پاسخ هم‌گام، ارجاع ناهم‌گام.** پراب درخواست ورودی را بی‌درنگ با `200` تأیید می‌کند و در پس‌زمینه به OneUptime ارجاع می‌دهد. سرویس شما لازم نیست منتظر کامل شدن ارجاع بماند.
- **هدرها حفظ می‌شوند.** همه هدرها به‌جز هدرهای گام‌به‌گام (`Host`، `Connection`، `Content-Length`، `Transfer-Encoding`، `Keep-Alive`، `Proxy-Authenticate`، `Proxy-Authorization`، `TE`، `Trailer`، `Upgrade`) عبور داده می‌شوند. پراب یک هدر `OneUptime-Probe-Id` می‌افزاید که خودش را معرفی می‌کند.
- **بدنه حفظ می‌شود.** محموله‌های JSON، URL-encoded و خام `application/octet-stream` تا **۵۰ مگابایت** پذیرفته می‌شوند.
- **تلاش مجدد با عقب‌نشینی.** اگر ارجاع شکست بخورد، پراب تا `PROBE_INGRESS_FORWARD_RETRY_LIMIT` بار با عقب‌نشینی نمایی (۲ ثانیه، ۴ ثانیه، ۸ ثانیه، با سقف ۱۵ ثانیه) دوباره تلاش می‌کند.
- **آگاه از پراکسی.** اگر خود پراب با `HTTP_PROXY_URL` / `HTTPS_PROXY_URL` پیکربندی شده باشد، درخواست‌های ارجاع‌شده از پراکسی عبور می‌کنند.

## متغیرهای محیطی

| متغیر                               | پیش‌فرض              | توضیحات                                                                                    |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `PROBE_INGRESS_PORT`                | _تنظیم‌نشده_ (غیرفعال) | پورتی که شنونده ورودی روی آن باز می‌شود. هر مقدار `> 0` ورودی را فعال می‌کند.              |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS`  | `10000`              | وقفه (میلی‌ثانیه) برای هر تلاش ارجاع به OneUptime. کمینه `1000`.                           |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3`                  | تعداد تلاش‌های مجدد پیش از آنکه پراب از ارجاع دست بکشد. برای غیرفعال کردن روی `0` بگذارید. |

متغیرهای استاندارد پراب (`PROBE_KEY`، `PROBE_ID`، `ONEUPTIME_URL`، متغیرهای پراکسی) همگی اعمال می‌شوند — برای فهرست کامل [پراب‌های سفارشی](/docs/probe/custom-probe) را ببینید.

## ملاحظات امنیتی

- **این نقطه پایانی عمداً بدون احراز هویت است** — کلید محرمانه در مسیر نشانی _همان_ احراز هویت است، درست مانند نقطه پایانی عمومی `oneuptime.com`. با کلید محرمانه مانند یک اعتبارنامه رفتار کنید.
- **فقط روی یک رابط خصوصی باز کنید.** شنونده ورودی نباید از اینترنت عمومی در دسترس باشد. با یک سیاست شبکه، قاعده دیوار آتش یا سرویس `ClusterIP` دسترسی را محدود کنید.
- **اگر به رمزگذاری در انتقال نیاز دارید از خاتمه HTTPS استفاده کنید.** شنونده پراب HTTP ساده صحبت می‌کند. اگر در گام ورودی به TLS نیاز دارید، آن را پشت یک متعادل‌کننده بار / کنترلر ingress داخلی بگذارید. مسیر ارجاع از پراب به OneUptime همیشه از HTTPS استفاده می‌کند (با فرض اینکه `ONEUPTIME_URL` با `https://` باشد).
- **محدودیت منابع.** شنونده بدنه درخواست تا ۵۰ مگابایت را می‌پذیرد. اگر به سقف سخت‌گیرانه‌تری نیاز دارید، یک پراکسی معکوس جلویش بگذارید.

## رفع اشکال

- **پراب هنگام راه‌اندازی `Probe ingress listener started on port <port>` را لاگ می‌کند** — تأیید می‌کند که شنونده بالاست. اگر این خط را نمی‌بینید، `PROBE_INGRESS_PORT` تنظیم‌نشده، `0` یا نامعتبر است.
- **`Probe ingress: failed to forward to <url> after N attempts`** — پراب نتوانست به OneUptime برسد. اتصال خروجی پراب، تنظیمات پراکسی و مقدار `ONEUPTIME_URL` را بررسی کنید.
- **`Probe ingress: probe ID not available, forwarding without it`** — پراب هنوز ثبت نشده است. ارجاع باز هم موفق می‌شود؛ فقط ضربان به یک پراب نسبت داده نمی‌شود.
- **ضربان در OneUptime ظاهر می‌شود اما نه از طریق پراب** — مطمئن شوید سرویس شما به `http://<probe-host>:<port>/...` می‌زند و نه به نشانی عمومی. دلیل معمول، یک مدخل نادرست DNS یا `/etc/hosts` است.

## مرتبط

- [پراب‌های سفارشی](/docs/probe/custom-probe)
- [مانیتور درخواست ورودی](/docs/monitor/incoming-request-monitor)
