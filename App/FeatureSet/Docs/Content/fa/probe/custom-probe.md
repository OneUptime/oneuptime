## برپا کردن پروب‌های سفارشی

می‌توانید پروب‌های سفارشی را درون شبکه‌تان برپا کنید تا منابع شبکه خصوصی یا منابع پشت دیوار آتشتان را زیر نظر بگیرید.

برای شروع باید در داشبورد OneUptime خود، زیر Monitors > Settings > Probes، پروبی سفارشی بسازید. پس از ساختن پروب سفارشی در داشبورد OneUptime، باید `PROBE_ID` و `PROBE_KEY` را داشته باشید.

### استقرار پروب

#### Docker

برای اجرای پروب، لطفاً مطمئن شوید docker نصب است. می‌توانید پروب سفارشی را چنین اجرا کنید:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

اگر OneUptime را خودمیزبان می‌کنید، می‌توانید `ONEUPTIME_URL` را به نمونه خودمیزبان سفارشی خود تغییر دهید.

##### پیکربندی پراکسی

اگر پروب شما باید برای رسیدن به OneUptime یا زیر نظر گرفتن منابع بیرونی از کارساز پراکسی بگذرد، می‌توانید تنظیمات پراکسی را با این متغیرهای محیطی پیکربندی کنید:

```
# For HTTP proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# For HTTPS proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# With proxy authentication
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

می‌توانید پروب را با docker-compose هم اجرا کنید. فایلی `docker-compose.yml` با محتوای زیر بسازید:

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
    network_mode: host
    restart: always
```

##### با پیکربندی پراکسی

اگر لازم دارید از کارساز پراکسی استفاده کنید، می‌توانید متغیرهای محیطی پراکسی را بیفزایید:

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
      # Proxy configuration (optional)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # For proxy with authentication:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

سپس فرمان زیر را اجرا کنید:

```
docker compose up -d
```

اگر OneUptime را خودمیزبان می‌کنید، می‌توانید `ONEUPTIME_URL` را به نمونه خودمیزبان سفارشی خود تغییر دهید.

#### Kubernetes

می‌توانید پروب را با Kubernetes هم اجرا کنید. فایلی `oneuptime-probe.yaml` با محتوای زیر بسازید:

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
```

##### با پیکربندی پراکسی

اگر لازم دارید از کارساز پراکسی استفاده کنید، می‌توانید متغیرهای محیطی پراکسی را بیفزایید:

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
            # Proxy configuration (optional)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # For proxy with authentication, use:
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

سپس فرمان زیر را اجرا کنید:

```bash
kubectl apply -f oneuptime-probe.yaml
```

اگر OneUptime را خودمیزبان می‌کنید، می‌توانید `ONEUPTIME_URL` را به نمونه خودمیزبان سفارشی خود تغییر دهید.

### متغیرهای محیطی

پروب از متغیرهای محیطی زیر پشتیبانی می‌کند:

#### متغیرهای الزامی

- `PROBE_KEY` — کلید پروب از داشبورد OneUptime شما
- `PROBE_ID` — شناسه پروب از داشبورد OneUptime شما
- `ONEUPTIME_URL` — نشانی نمونه OneUptime شما (پیش‌فرض: https://oneuptime.com)

#### متغیرهای اختیاری

- `HTTP_PROXY_URL` — نشانی کارساز پراکسی HTTP برای درخواست‌های HTTP
- `HTTPS_PROXY_URL` — نشانی کارساز پراکسی HTTP برای درخواست‌های HTTPS
- `NO_PROXY` — میزبان‌ها یا دامنه‌های جداشده با ویرگول که باید از پراکسی بگذرند
- `PROBE_NAME` — نام سفارشی پروب
- `PROBE_DESCRIPTION` — توضیحات پروب
- `PROBE_MONITORING_WORKERS` — شمار کارگرهای مانیتورینگ (پیش‌فرض: ۱)
- `PROBE_MONITOR_FETCH_LIMIT` — شمار مانیتورهایی که یک‌جا گرفته می‌شوند (پیش‌فرض: ۱۰)
- `PROBE_MONITOR_RETRY_LIMIT` — شمار تلاش‌های دوباره برای مانیتورهای شکست‌خورده (پیش‌فرض: ۳)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` — مهلت اسکریپت‌های مانیتور مصنوعی بر حسب میلی‌ثانیه (پیش‌فرض: ۶۰۰۰۰)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` — مهلت اسکریپت‌های مانیتور کد سفارشی بر حسب میلی‌ثانیه (پیش‌فرض: ۶۰۰۰۰)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` — مهلت هر درخواستی که پروب به OneUptime می‌فرستد (پیش‌فرض: ۴۵۰۰۰)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` — برای درخواست‌های کندتر از این به OneUptime هشداری گزارش کن (پیش‌فرض: ۱۰۰۰۰)
- `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` — مهلت بررسی یک مانیتور، که پس از آن بررسی رها و در چرخه بعد دوباره تلاش می‌شود (پیش‌فرض: ۹۰۰۰۰۰)
- `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` — مهلت یک جاروی کشف شبکه، که پس از آن رها و پویش شکست‌خورده گزارش می‌شود (پیش‌فرض: ۵۴۰۰۰۰۰، یعنی ۹۰ دقیقه)
- `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` — هر چند وقت یک جاروی در حال اجرای کشف، میزبان‌هایی را که تا کنون یافته بارگذاری کند، تا پویشی طولانی پیشرفت نشان دهد و دستگاه‌هایش پیش از پایانش وارد شوند (پیش‌فرض: ۳۰۰۰۰، کمینه: ۵۰۰۰)
- `PROBE_DISCOVERY_SCAN_CONCURRENCY` — شمار ثابت نشانی‌هایی که جاروی کشف یک‌جا می‌کاود. تنظیم‌نشده (یا ۰) رهایش کنید تا از هدف پویش اندازه‌گیری شود، که همان چیزی است که می‌خواهید مگر آنکه کانتینر پروب به‌طور نامتعارف کوچک یا بزرگ باشد (پیش‌فرض: ۰)
- `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` — بیشینه پویش‌های کشف مستقلی که هم‌زمان روی این پروب اجرا می‌شوند (پیش‌فرض: ۴، بازه: ۱ تا ۱۶). تا وقتی ظرفیت هست، پروب هر دقیقه دنبال پویش معلق دیگری می‌گردد، پس پویشی طولانی همه پویش‌های دیگر را نمی‌بندد. وقتی همه جایگاه‌ها اشغال باشند، پویش‌های بیشتر تا آزاد شدن جایگاهی معلق می‌مانند. هر پویش هم‌زمانی میزبان خودش را دارد، پس مصرف منابع با هر دو تنظیم رشد می‌کند؛ برای کانتینرهای کوچک هرکدام را پایین بیاورید. برای اجرای ترتیبی پویش‌ها این را روی ۱ بگذارید.

پیش از ارتقای پروب‌های سفارشی برای استفاده از کشف هم‌زمان، کارساز OneUptime را ارتقا دهید. کارساز باید از کنار گذاشتن پویش‌هایی که پروب هنوز اجرا می‌کند پشتیبانی کند، تا ویرایش پویشی در حال اجرا، پیکربندی تازه‌اش را امن در صف بگذارد. هنگام وصل کردن پروبی به‌روزشده به کارسازی قدیمی‌تر، تا ارتقای کارساز `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1` را تنظیم کنید.

#### پیکربندی پراکسی

پروب از کارسازهای پراکسی HTTP و HTTPS پشتیبانی می‌کند. وقتی پیکربندی شود، پروب همه ترافیک مانیتورینگ را از راه کارسازهای پراکسی مشخص‌شده مسیردهی می‌کند. می‌توانید فهرستی از `NO_PROXY` جداشده با ویرگول هم بدهید تا برای میزبان‌ها یا شبکه‌های داخلی از پراکسی بگذرد.

**قالب نشانی پراکسی:**

```
http://[username:password@]proxy.server.com:port
```

**نمونه‌ها:**

- پراکسی پایه: `http://proxy.example.com:8080`
- با احراز هویت: `http://username:password@proxy.example.com:8080`

**قابلیت‌های پشتیبانی‌شده:**

- پشتیبانی از پراکسی HTTP و HTTPS
- احراز هویت پراکسی (نام کاربری/گذرواژه)
- بازگشت خودکار میان پراکسی‌های HTTP و HTTPS
- گذر گزینشی از پراکسی با `NO_PROXY`
- با همه نوع‌های مانیتور کار می‌کند (وب‌سایت، API، ‏SSL، مصنوعی و غیره)

**توجه:** برای سازگاری، هم متغیرهای محیطی استاندارد (`HTTP_PROXY_URL`، `HTTPS_PROXY_URL`، `NO_PROXY`) و هم گونه‌های حروف کوچک (`http_proxy`، `https_proxy`، `no_proxy`) پشتیبانی می‌شوند.

### بررسی

اگر پروب با موفقیت اجرا شود، باید در داشبورد OneUptime شما `Connected` نشان داده شود. اگر متصل نشان داده نشد، باید گزارش‌های کانتینر را بررسی کنید. اگر همچنان مشکل دارید، لطفاً در [GitHub](https://github.com/oneuptime/oneuptime) یک issue بسازید یا [با پشتیبانی تماس بگیرید](https://oneuptime.com/support)

### تشخیص پروب قطع‌شده

پروب وقتی `Disconnected` نشانه‌گذاری می‌شود که درخواست‌هایش به OneUptime دیگر موفق نشوند. گزارش پروب می‌گوید هر درخواست شکست‌خورده کجا گیر کرده، پس به‌ندرت مجبورید حدس بزنید.

**۱. بلوک محیطی چاپ‌شده هنگام راه‌اندازی را بخوانید.** هر پروب هنگام بوت یک بلوک JSON چاپ می‌کند با نشانی OneUptimeای که به کار می‌برد، مهلت درخواستش، تنظیمات پراکسی‌اش، تفکیک‌کننده‌های DNSای که به ارث برده، نسخه Node/سیستم‌عامل، و اینکه آیا تأیید TLS غیرفعال شده است. هر وقت مشکلی گزارش می‌کنید این بلوک را بگنجانید.

**۲. گزارش شکست را بیابید.** هر درخواست شکست‌خورده به OneUptime بلوکی گزارش می‌کند که `stalledAt` و `whatThisMeans` را دربر دارد. مقدار `stalledAt` فازی است که درخواست هرگز از آن نگذشت:

| `stalledAt` | معنایش چیست |
| --- | --- |
| `SocketAssignment` | چیزی از ماشین بیرون نرفت. استخر سوکت اشباع بود، یا پراکسی پیکربندی‌شده هرگز تونل CONNECT خود را کامل نکرد. |
| `TcpConnect` | ماشین SYN فرستاد و چیزی نگرفت — دیوار آتش یا دستگاه امنیتی بسته‌ها را می‌اندازد، یا میزبان دست‌یافتنی نیست. |
| `TlsHandshake` | ‏TCP وصل شد، TLS هرگز تمام نشد. معمولاً جعبه میانی بازرس TLS. |
| `RequestSend` | وصل شد، اما درخواست هرگز کامل نوشته نشد — سوی دور خواندن را متوقف کرد. |
| `WaitingForServerResponse` | درخواست تحویل شد و کارساز چیزی پس نفرستاد. **شبکه پروب سالم است** — کارساز OneUptime، متعادل‌کننده بار و پراکسی معکوسش را بررسی کنید. |
| `ResponseBody` | کارساز شروع به پاسخ کرد و در میانه راه ماند. |

همان بلوک `deadlineOverrunInMs` را هم گزارش می‌دهد. اگر مهلت ۴۵۰۰۰ میلی‌ثانیه‌ای بسیار بیش از ۴۵۰۰۰ میلی‌ثانیه زمان دیواری طول کشید، خودِ فرایند پروب مسدود بوده است — پیش از بررسی شبکه، `probeProcess.eventLoopMaxDriftInMs` را در آن بلوک بررسی کنید.

**۳. خودآزمون اتصال را بخوانید.** پس از سه شکست پیاپی، پروب همان کارساز را لایه‌به‌لایه می‌آزماید — DNS، سپس TCP، سپس TLS، سپس یک رفت‌وبرگشت واقعی HTTP — و هر مرحله را با زمان‌بندی‌اش گزارش می‌کند. نخستین مرحله‌ای که شکست بخورد پاسخ شماست. وقتی پراکسی‌ای پیکربندی شده باشد، پروب پرش به پراکسی را می‌آزماید، چون تنها پرشی است که واقعاً می‌کند.

**۴. پیش از آنکه درخواست‌های کند به شکست تبدیل شوند بپاییدشان.** درخواست‌هایی که موفق می‌شوند اما بیش از `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` طول می‌کشند با زمان سپری‌شده‌شان گزارش می‌شوند. پروبی که شروع به گزارش درخواست‌های ۲۰ ثانیه‌ای می‌کند در راه گذشتن از مهلت ۴۵ ثانیه‌ای است.

در سمت کارساز OneUptime، درخواست پروبی که کند پاسخ داده می‌شود — یا پروب پیش از فرستاده شدن پاسخ رهایش کرده — آنجا هم با شناسه پروب گزارش می‌شود. آن دو گزارش با هم به شما می‌گویند کدام سوی اتصال مقصر است.
