# عامل Docker مربوط به OneUptime

## نمای کلی

عامل Docker مربوط به OneUptime یک ایمیج کانتینر از پیش ساخته‌شده است که با یک پیکربندی تنظیم‌شده از کالکتور OpenTelemetry عرضه می‌شود. آن را کنار کانتینرهای موجود خود اجرا کنید تا هر کانتینر روی میزبان را به‌صورت خودکار کشف کند، متریک‌های پردازنده / حافظه / شبکه / ورودی‌خروجی بلوکی به‌همراه لاگ‌های کانتینر را جمع کند و همه‌چیز را از طریق OTLP به OneUptime بفرستد. یک ایمیج، یک دستور.

این صفحه **راهنمای نصب** است. برای پیکربندی مانیتورها و هشدارهای Docker روی داده‌ای که عامل جمع می‌کند، [مانیتور Docker](/docs/monitor/docker-monitor) را ببینید.

## پیش‌نیازها

- Docker Engine نسخه 20.10 یا بالاتر
- دسترسی به `/var/run/docker.sock` روی میزبان
- یک **توکن دریافت تله‌متری OneUptime** — یکی را از مسیر _Project Settings → Telemetry & APM → Ingestion Keys_ بسازید و مقدارش را کپی کنید

## شروع سریع (یک دستور)

مقادیر `YOUR_ONEUPTIME_URL`، `YOUR_TELEMETRY_INGESTION_TOKEN` و نام میزبان را با مقادیر محیط خود جایگزین کنید. نام میزبان همان چیزی است که این میزبان Docker با آن در OneUptime ظاهر می‌شود — چیزی مانند `prod-docker-01` انتخاب کنید.

```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

همین. به‌محض اتصال عامل، میزبان Docker شما به‌صورت خودکار در بخش **Docker** داشبورد OneUptime ظاهر می‌شود.

## جایگزین — Docker Compose

اگر Docker Compose را ترجیح می‌دهید، این را در یک `docker-compose.yml` بگذارید:

```yaml
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

اجرایش کنید:

```bash
docker compose up -d
```

## متغیرهای محیطی

| متغیر                     | الزامی | توضیحات                                                                                                                                                          |
| ------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | بله    | نشانی نمونه OneUptime شما (برای نمونه `https://oneuptime.com` یا میزبان خودمیزبان شما)                                                                            |
| `ONEUPTIME_SERVICE_TOKEN` | بله    | توکن دریافت تله‌متری از مسیر _Project Settings → Telemetry & APM → Ingestion Keys_                                                                                |
| `DOCKER_HOST_NAME`        | خیر    | نام دوستانه این میزبان. پیش‌فرض `docker-host` است. برای هر میزبان چیزی پایدار بگذارید (برای نمونه `prod-docker-01`)                                              |
| `DOCKER_API_VERSION`      | خیر    | نسخه API موتور Docker که عامل با آن صحبت می‌کند. پیش‌فرض `1.44` است؛ روی میزبان‌هایی با دیمن قدیمی‌تر پایین‌ترش بیاورید، یا خالی بگذارید تا خودکار مذاکره شود (بخش رفع اشکال) |

## راستی‌آزمایی نصب

بررسی کنید که عامل در حال اجراست:

```bash
docker ps --filter name=oneuptime-docker-agent
```

گزارش‌های عامل را بررسی کنید:

```bash
docker logs -f oneuptime-docker-agent
```

به دنبال این بگردید: `"Everything is ready. Begin running and processing data."`

ظرف حدود یک دقیقه، میزبان باید در داشبورد OneUptime با جریان متریک و لاگ ظاهر شود.

## ارتقای عامل

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Re-run the `docker run` command above
```

یا با Docker Compose:

```bash
docker compose pull
docker compose up -d
```

## حذف نصب عامل

```bash
docker rm -f oneuptime-docker-agent
```

اگر از Docker Compose استفاده کرده‌اید:

```bash
docker compose down
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

### دسترسی به سوکت Docker رد شد

کانتینر عامل باید به‌عنوان root (`--user 0:0`) اجرا شود تا به `/var/run/docker.sock` دسترسی داشته باشد. مطمئن شوید پرچم `--user 0:0` (یا `user: "0:0"` در Compose) وجود دارد.

### عامل با پیام «client version is too new» راه‌اندازی مجدد می‌شود

```
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

دیمن کلاینتی جدیدتر از بیشینه خودش را رد می‌کند، بنابراین گیرنده هرگز شروع نمی‌شود و کالکتور هم با آن خارج می‌شود. بیشینه دیمن را بررسی کنید و به عامل بدهید:

```bash
docker version --format '{{ .Server.APIVersion }}'
```

سپس `-e DOCKER_API_VERSION=1.41` (یا مقداری که گرفتید) را به `docker run` اضافه کنید، یا `DOCKER_API_VERSION` را در Compose تنظیم کنید. دیمن‌های جدیدتر هنوز نسخه‌های قدیمی‌تر API را ارائه می‌دهند، پس این تنظیم پس از ارتقا هم معتبر می‌ماند.

اگر ترجیح می‌دهید عدد را پیدا نکنید، `DOCKER_API_VERSION` را روی **رشته خالی** بگذارید. آنگاه عامل از SDK مربوط به Docker می‌خواهد نسخه را با دیمن مذاکره کند (یک `HEAD /_ping` و سپس بیشینه خود دیمن)، که هم با دیمن‌های قدیمی و هم جدید کار می‌کند:

```bash
docker run -d ... -e DOCKER_API_VERSION= ...
```

### عامل قطع‌شده نشان داده می‌شود

1. بررسی کنید که عامل در حال اجراست: `docker ps --filter name=oneuptime-docker-agent`
2. گزارش‌های عامل را بررسی کنید: `docker logs oneuptime-docker-agent | grep -i error`
3. درست بودن نشانی OneUptime و توکن سرویس خود را راستی‌آزمایی کنید
4. مطمئن شوید میزبان Docker شما می‌تواند از طریق شبکه به نمونه OneUptime برسد

### هیچ متریکی ظاهر نمی‌شود

1. راستی‌آزمایی کنید سوکت Docker درون عامل قابل دسترسی است: `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. گزارش‌های کالکتور را برای خطاهای ارسال بررسی کنید: `docker logs oneuptime-docker-agent | tail -100`
3. مطمئن شوید توکن سرویس شما معتبر و منقضی‌نشده است

### نام میزبان به‌صورت شناسه کانتینر نمایش داده می‌شود

متغیر محیطی `DOCKER_HOST_NAME` را روی یک نام دوستانه بگذارید و کانتینر را دوباره بسازید.

## گام‌های بعدی

- **مانیتورهای Docker** را برای هشدار روی شرایط پردازنده / حافظه / راه‌اندازی مجدد کانتینر پیکربندی کنید — [مانیتور Docker](/docs/monitor/docker-monitor) را ببینید.
- برای خوشه‌های Kubernetes به‌جای میزبان‌های مستقل Docker، از [عامل Kubernetes مربوط به OneUptime](/docs/telemetry/kubernetes-agent) استفاده کنید.
- برای میزبان‌های غیرکانتینری (ماشین‌های مجازی و فیزیکی Linux / macOS / Windows)، از [کالکتور OpenTelemetry روی میزبان](/docs/telemetry/host-otel-collector) استفاده کنید.
