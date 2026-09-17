# عامل Podman مربوط به OneUptime

## نمای کلی

عامل Podman مربوط به OneUptime یک ایمیج کانتینر از پیش ساخته‌شده است که با یک پیکربندی تنظیم‌شده از کالکتور OpenTelemetry عرضه می‌شود. آن را کنار کانتینرهای موجود خود اجرا کنید تا هر کانتینر روی میزبان را به‌صورت خودکار کشف کند، متریک‌های پردازنده / حافظه / شبکه / ورودی‌خروجی بلوکی به‌همراه لاگ‌های کانتینر را جمع کند و همه‌چیز را از طریق OTLP به OneUptime بفرستد. یک ایمیج، یک دستور.

این صفحه **راهنمای نصب** است. برای پیکربندی مانیتورها و هشدارهای Podman روی داده‌ای که عامل جمع می‌کند، [مانیتور Podman](/docs/monitor/podman-monitor) را ببینید.

## پیش‌نیازها

- Podman نسخه 4.0 یا بالاتر
- دسترسی به `/run/podman/podman.sock` روی میزبان
- یک **توکن دریافت تله‌متری OneUptime** — یکی را از مسیر _Project Settings → Telemetry & APM → Ingestion Keys_ بسازید و مقدارش را کپی کنید

## شروع سریع (یک دستور)

مقادیر `YOUR_ONEUPTIME_URL`، `YOUR_TELEMETRY_INGESTION_TOKEN` و نام میزبان را با مقادیر محیط خود جایگزین کنید. نام میزبان همان چیزی است که این میزبان Podman با آن در OneUptime ظاهر می‌شود — چیزی مانند `prod-podman-01` انتخاب کنید.

```bash
podman run -d \
  --name oneuptime-podman-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
  -v /var/lib/containers:/var/lib/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e PODMAN_HOST_NAME="my-podman-host" \
  oneuptime/podman-agent:release
```

همین. به‌محض اتصال عامل، میزبان Podman شما به‌صورت خودکار در بخش **Podman** داشبورد OneUptime ظاهر می‌شود.

## جایگزین — Podman Compose

اگر Podman Compose را ترجیح می‌دهید، این را در یک `docker-compose.yml` بگذارید:

```yaml
services:
  oneuptime-podman-agent:
    image: oneuptime/podman-agent:release
    container_name: oneuptime-podman-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /run/podman/podman.sock:/run/podman/podman.sock:ro
      - /var/lib/containers:/var/lib/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - PODMAN_HOST_NAME=my-podman-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

اجرایش کنید:

```bash
podman compose up -d
```

## متغیرهای محیطی

| متغیر                     | الزامی | توضیحات                                                                                                                                                                                       |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | بله    | نشانی نمونه OneUptime شما (برای نمونه `https://oneuptime.com` یا میزبان خودمیزبان شما)                                                                                                        |
| `ONEUPTIME_SERVICE_TOKEN` | بله    | توکن دریافت تله‌متری از مسیر _Project Settings → Telemetry & APM → Ingestion Keys_                                                                                                            |
| `PODMAN_HOST_NAME`        | خیر    | نام دوستانه این میزبان. پیش‌فرض `podman-host` است. برای هر میزبان چیزی پایدار بگذارید (برای نمونه `prod-podman-01`)                                                                          |
| `DOCKER_API_VERSION`      | خیر    | نسخه API موتور Docker که عامل با سوکت Podman صحبت می‌کند. پیش‌فرض `1.44` است؛ اگر سوکت بیشینه قدیمی‌تری گزارش می‌کند پایین‌ترش بیاورید، یا خالی بگذارید تا خودکار مذاکره شود (بخش رفع اشکال) |

## راستی‌آزمایی نصب

بررسی کنید که عامل در حال اجراست:

```bash
podman ps --filter name=oneuptime-podman-agent
```

گزارش‌های عامل را بررسی کنید:

```bash
podman logs -f oneuptime-podman-agent
```

به دنبال این بگردید: `"Everything is ready. Begin running and processing data."`

ظرف حدود یک دقیقه، میزبان باید در داشبورد OneUptime با جریان متریک و لاگ ظاهر شود.

## ارتقای عامل

```bash
podman pull oneuptime/podman-agent:release
podman rm -f oneuptime-podman-agent
# Re-run the `podman run` command above
```

یا با Podman Compose:

```bash
podman compose pull
podman compose up -d
```

## حذف نصب عامل

```bash
podman rm -f oneuptime-podman-agent
```

اگر از Podman Compose استفاده کرده‌اید:

```bash
podman compose down
```

## چه چیزی جمع‌آوری می‌شود

| دسته                     | داده                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| **متریک‌های پردازنده**   | کل مصرف، درصد مصرف، زمان محدودسازی (به ازای هر کانتینر)           |
| **متریک‌های حافظه**      | مصرف، حد مجاز، درصد، RSS، کش (به ازای هر کانتینر)                 |
| **متریک‌های شبکه**       | بایت‌ها و بسته‌های دریافتی / ارسالی (به ازای هر کانتینر)          |
| **متریک‌های ورودی‌خروجی بلوکی** | بایت‌ها و عملیات خواندن / نوشتن (به ازای هر کانتینر)        |
| **اطلاعات کانتینر**      | زمان کارکرد، تعداد راه‌اندازی مجدد، تعداد فرایند                  |
| **لاگ‌های کانتینر**      | لاگ‌های stdout / stderr از همه کانتینرها                          |

## OneUptime خودمیزبان

اگر OneUptime را خودمیزبانی می‌کنید، `ONEUPTIME_URL` را روی نمونه خودتان بگذارید:

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

اگر نمونه شما فقط HTTP است، از `http://` و پورت مناسب استفاده کنید.

## رفع اشکال

### دسترسی به سوکت Podman رد شد

کانتینر عامل باید به‌عنوان root (`--user 0:0`) اجرا شود تا به `/run/podman/podman.sock` دسترسی داشته باشد. مطمئن شوید پرچم `--user 0:0` (یا `user: "0:0"` در Compose) وجود دارد.

### سوکت Podman / درایور لاگ

سوکت API مربوط به Podman باید فعال و روی `/run/podman/podman.sock` در دسترس باشد. روی میزبان‌های systemd با دسترسی root، آن را با `systemctl enable --now podman.socket` فعال کنید. لاگ‌های کانتینر از `/var/lib/containers` خوانده می‌شوند، پس مطمئن شوید آن مسیر درون عامل mount شده است و Podman از یک درایور لاگ فایلی استفاده می‌کند (برای نمونه `--log-driver=k8s-file` یا `json-file`). اگر Podman را بدون root اجرا می‌کنید، سوکت به‌جای آن در `/run/user/<uid>/podman/podman.sock` قرار دارد — آن مسیر را mount کنید و حجم را متناسب تنظیم کنید.

### عامل با پیام «client version is too new» راه‌اندازی مجدد می‌شود

```
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

سروری با API مربوط به Docker که بیشینه نسخه کلاینت را اعمال می‌کند، کلاینت جدیدتر را رد می‌کند (Docker Engine آن را همان‌طور که بالا آمده گزارش می‌کند)، بنابراین گیرنده هرگز شروع نمی‌شود و کالکتور هم با آن خارج می‌شود. نسخه APIای را که سوکت Podman گزارش می‌کند بررسی کنید و به عامل بدهید:

```bash
curl -s -o /dev/null -D - --unix-socket /run/podman/podman.sock http://localhost/_ping | grep -i '^api-version'
```

سپس `-e DOCKER_API_VERSION=1.41` (یا مقداری که گرفتید) را به `podman run` اضافه کنید، یا `DOCKER_API_VERSION` را در Compose تنظیم کنید. سرورهای جدیدتر هنوز نسخه‌های قدیمی‌تر API را ارائه می‌دهند، پس این تنظیم پس از ارتقا هم معتبر می‌ماند.

اگر ترجیح می‌دهید عدد را پیدا نکنید، `DOCKER_API_VERSION` را روی **رشته خالی** بگذارید. آنگاه عامل به‌جای پین کردن یک نسخه، آن را با سوکت مذاکره می‌کند (یک `HEAD /_ping` و سپس بیشینه‌ای که سوکت گزارش می‌کند):

```bash
podman run -d ... -e DOCKER_API_VERSION= ...
```

### عامل قطع‌شده نشان داده می‌شود

1. بررسی کنید که عامل در حال اجراست: `podman ps --filter name=oneuptime-podman-agent`
2. گزارش‌های عامل را بررسی کنید: `podman logs oneuptime-podman-agent | grep -i error`
3. درست بودن نشانی OneUptime و توکن سرویس خود را راستی‌آزمایی کنید
4. مطمئن شوید میزبان Podman شما می‌تواند از طریق شبکه به نمونه OneUptime برسد

### هیچ متریکی ظاهر نمی‌شود

1. راستی‌آزمایی کنید سوکت Podman درون عامل قابل دسترسی است: `podman exec oneuptime-podman-agent ls -la /run/podman/podman.sock`
2. گزارش‌های کالکتور را برای خطاهای ارسال بررسی کنید: `podman logs oneuptime-podman-agent | tail -100`
3. مطمئن شوید توکن سرویس شما معتبر و منقضی‌نشده است

### نام میزبان به‌صورت شناسه کانتینر نمایش داده می‌شود

متغیر محیطی `PODMAN_HOST_NAME` را روی یک نام دوستانه بگذارید و کانتینر را دوباره بسازید.

## گام‌های بعدی

- **مانیتورهای Podman** را برای هشدار روی شرایط پردازنده / حافظه / راه‌اندازی مجدد کانتینر پیکربندی کنید — [مانیتور Podman](/docs/monitor/podman-monitor) را ببینید.
- برای خوشه‌های Kubernetes به‌جای میزبان‌های مستقل Podman، از [عامل Kubernetes مربوط به OneUptime](/docs/telemetry/kubernetes-agent) استفاده کنید.
- برای میزبان‌های غیرکانتینری (ماشین‌های مجازی و فیزیکی Linux / macOS / Windows)، از [کالکتور OpenTelemetry روی میزبان](/docs/telemetry/host-otel-collector) استفاده کنید.
