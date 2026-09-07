# استقرار کاملاً رایگان OneUptime با Docker Compose

اگر ترجیح می‌دهید OneUptime را روی سرور خودتان میزبانی کنید، می‌توانید با Docker Compose یک نمونه تک‌سروری از OneUptime را روی Debian، Ubuntu یا RHEL مستقر کنید. این گزینه کنترل و سفارشی‌سازی بیشتری روی نمونه شما می‌دهد، اما به مهارت و منابع فنی بیشتری برای استقرار و نگهداری نیاز دارد.

#### پیش‌نیازهای سامانه خود را انتخاب کنید

بسته به میزان استفاده و بودجه، می‌توانید پیش‌نیازهای سامانه‌ای متفاوتی برای سرور خود انتخاب کنید. برای بهترین کارایی، پیشنهاد می‌کنیم OneUptime را با این مشخصات اجرا کنید:

- **پیش‌نیازهای توصیه‌شده سامانه**
  - ۱۶ گیگابایت RAM
  - ۸ هسته
  - ۴۰۰ گیگابایت دیسک
  - Ubuntu 22.04
  - Docker و Docker Compose نصب‌شده
- **پیش‌نیازهای هوم‌لب / کمینه**
  - اگر می‌خواهید OneUptime را برای استفاده شخصی یا آزمایشی در خانه اجرا کنید (برخی از کاربران ما حتی آن را روی Raspberry Pi نصب کرده‌اند)، می‌توانید از پیش‌نیازهای هوم‌لب استفاده کنید:
    - ۸ گیگابایت RAM
    - ۴ هسته
    - ۲۰ گیگابایت دیسک
    - Docker و Docker Compose نصب‌شده

#### پیش‌نیازهای استقرار تک‌سروری

آموزش تصویری نصب: [https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

پیش از شروع فرایند استقرار، مطمئن شوید این‌ها را دارید:

- سروری که Debian، Ubuntu یا یکی از مشتقات RHEL را اجرا می‌کند
- Docker و Docker Compose نصب‌شده روی سرور شما

برای نصب OneUptime:

```
# Clone this repo with just the release branch and cd into it.
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copy config.example.env to config.env
cp config.example.env config.env

# IMPORTANT: Edit config.env file. Please make sure you have random secrets.

npm start
```

اگر نمی‌خواهید از npm استفاده کنید یا نصبش ندارید، به‌جای آن این را اجرا کنید:

```
# Read env vars from config.env file and run docker compose up.
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# Use sudo if you're having permission issues with binding ports.
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```

### دسترسی به OneUptime

OneUptime باید روی http://localhost اجرا شود. برای شروع استفاده باید یک حساب جدید در نمونه خود ثبت کنید.

### راه‌اندازی گواهی‌های TLS/SSL

OneUptime از راه‌اندازی گواهی‌های SSL/TLS پشتیبانی **نمی‌کند**. باید خودتان گواهی‌های SSL/TLS را راه‌اندازی کنید.

اگر به گواهی‌های SSL/TLS نیاز دارید، این مراحل را دنبال کنید:

1. از یک پراکسی معکوس مانند Nginx یا Caddy استفاده کنید.
2. برای صدور گواهی‌ها از Let's Encrypt استفاده کنید.
3. پراکسی معکوس را به سرور OneUptime بدهید.
4. این تنظیمات را به‌روزرسانی کنید:
   - متغیر محیطی `HTTP_PROTOCOL` را روی `https` بگذارید.
   - متغیر محیطی `HOST` را به نام دامنه سروری که پراکسی معکوس روی آن میزبانی می‌شود تغییر دهید.

## فهرست آمادگی برای محیط عملیاتی

در حالت ایده‌آل OneUptime را با docker-compose در محیط عملیاتی مستقر نکنید. ما به‌شدت استفاده از Kubernetes را توصیه می‌کنیم. یک چارت Helm برای OneUptime [اینجا](https://artifacthub.io/packages/helm/oneuptime/oneuptime) در دسترس است.

اگر باز هم می‌خواهید OneUptime را با docker-compose در محیط عملیاتی مستقر کنید، لطفاً این موارد را در نظر بگیرید:

- **SSL/TLS**: گواهی‌های SSL/TLS را راه‌اندازی کنید. OneUptime از راه‌اندازی گواهی‌های SSL/TLS پشتیبانی نمی‌کند. باید خودتان این کار را انجام دهید. بالا را ببینید.
- **اسرار**: مطمئن شوید در فایل `config.env` خود اسرار تصادفی دارید. در آن فایل چند راز پیش‌فرض هست. آن‌ها را با رشته‌های تصادفی بلند جایگزین کنید.
- **پشتیبان‌گیری**: به‌صورت منظم از پایگاه‌های داده خود (Clickhouse، Postgres) پشتیبان بگیرید. کش بی‌حالت است و می‌توان با خیال راحت نادیده‌اش گرفت.
- **کش و صف‌ها**: سرویس `valkey` نرم‌افزار [Valkey](https://valkey.io) را اجرا می‌کند — همان فورک با مجوز BSD از Redis 7.2 — که از طریق تنظیمات `VALKEY_*` در `config.env` پیکربندی می‌شود. هر سروری با پروتکل Redis کار می‌کند — اگر ترجیح می‌دهید، `VALKEY_HOST` را به یک Redis مدیریت‌شده بدهید. این تنظیمات تا نسخه 12.0.36 با نام `REDIS_*` بودند؛ نام‌های قدیمی هنوز خوانده می‌شوند، کانتینر همچنان به نام میزبان `redis` پاسخ می‌دهد و `npm run update` آن‌ها را بازنویسی نمی‌کند، بنابراین یک `config.env` قدیمی به هیچ ویرایشی نیاز ندارد.
- **به‌روزرسانی‌ها**: OneUptime را به‌صورت منظم به‌روزرسانی کنید. ما هر روز به‌روزرسانی منتشر می‌کنیم. اگر در محیط عملیاتی اجرا می‌کنید، توصیه می‌کنیم دست‌کم هفته‌ای یک بار نرم‌افزار را به‌روزرسانی کنید.

### به‌روزرسانی OneUptime

برای به‌روزرسانی:

```
git checkout release # Please make sure you're on release branch.
git pull
npm run update
```

### نکته‌هایی که باید در نظر بگیرید

- در راه‌اندازی Docker ما از درایور لاگ محلی استفاده می‌شود. OneUptime، به‌ویژه در کانتینرهای probe و ingest، حجم زیادی لاگ تولید می‌کند. برای اینکه فضای ذخیره‌سازی شما پر نشود، محدود کردن فضای لاگ در Docker حیاتی است. برای دستورالعمل‌های دقیق، لطفاً به مستندات رسمی Docker [اینجا](https://docs.docker.com/config/containers/logging/local/) مراجعه کنید.

### حذف نصب OneUptime

برای حذف نصب OneUptime، این دستور را اجرا کنید:

```
npm run down
```

این کار همه کانتینرها، شبکه‌ها و حجم‌هایی را که OneUptime ساخته متوقف و حذف می‌کند. فایل `config.env` یا مخزن کلون‌شده را حذف نمی‌کند.
