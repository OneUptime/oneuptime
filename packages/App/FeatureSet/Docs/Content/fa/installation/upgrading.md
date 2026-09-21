# ارتقای OneUptime

این راهنما پوشش می‌دهد که چگونه نصب خودمیزبان OneUptime خود را با ایمنی ارتقا دهید.

## راهنمایی کلی

- گام‌به‌گام میان نسخه‌های اصلی ارتقا دهید (برای نمونه، 6 → 7 → 8). از نسخه‌های اصلی نپرید.
- تا وقتی یادداشت‌های انتشار را دنبال می‌کنید می‌توانید از نسخه‌های فرعی/وصله‌ای بجهید (برای نمونه، 8.1 → 8.4).
- همیشه پیش از ارتقا پشتیبان بگیرید، و تأیید کنید که می‌توانید بازگردانی‌شان کنید.

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the Community/Enterprise image split). -->

## Community and Enterprise Edition images

OneUptime now ships the app as two images. The **Community Edition** is open
source under the Apache License 2.0. The **Enterprise Edition** adds the
enterprise modules from the repository's `ee/` directory: SAML SSO, OIDC, SCIM,
team compliance, audit logs and the enterprise Health dashboards in the Admin
Dashboard. Before this change both editions ran the same code, and
`IS_ENTERPRISE_EDITION` decided which features were switched on. Now the image
decides, and the Community image does not contain the `ee/` directory.

The [Enterprise Edition](/docs/self-hosted/enterprise) page has the full
feature comparison, licensing details and what happens when you switch
editions.

### What to do before you upgrade

- **Community Edition without SSO, OIDC or SCIM:** nothing. Upgrade as usual.
- **Helm with `image.type: enterprise-edition`:** nothing. The chart already
  pulls the `enterprise-` images, which now contain the enterprise modules.
- **Docker Compose with `IS_ENTERPRISE_EDITION=true`:** switch to the
  Enterprise image when you upgrade by setting `APP_TAG=enterprise-release`
  (or `enterprise-<version>`) in `config.env`. `APP_TAG=release` is the
  Community image, and `IS_ENTERPRISE_EDITION=true` no longer switches anything
  on. `npm run update` makes this change for you while
  `IS_ENTERPRISE_EDITION=true` (`release` becomes `enterprise-release`, a
  pinned `13.0.7` becomes `enterprise-13.0.7`) and prints what it changed.
  The App now **refuses to start** when `IS_ENTERPRISE_EDITION=true` is set on
  the Community image, instead of silently no longer enforcing "Require SSO",
  SSO, SCIM and audit logging. The error says what to set:
  `APP_TAG=enterprise-<version>` to keep the Enterprise Edition, or
  `IS_ENTERPRISE_EDITION=false` to run the Community Edition.
- **Community image with SSO, OIDC or SCIM already configured:** SSO sign-in
  and SCIM provisioning stop with this upgrade, and "Require SSO for login" is
  no longer enforced. Switch to the Enterprise image to keep them. Otherwise,
  read [Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community)
  before you upgrade. It explains how users sign in afterwards and who to
  remove first. To run the Community Edition, also set
  `IS_ENTERPRISE_EDITION=false`.

Your configuration is never deleted, and no migration is needed to switch
editions in either direction.

### Licensing after the upgrade

The Enterprise Edition now checks its license:

- **An install with a license key** keeps working. It checks the license with
  OneUptime when it starts and once a day. If the license expires, everything
  keeps working for a 30-day grace period, and after that the same happens as
  for an install with no license.
- **An install with no license**, for example one that ran the Enterprise
  Edition on `IS_ENTERPRISE_EDITION=true` alone, gets a 14-day trial from the
  first start of this release. **If you use SSO, OIDC, SCIM or audit logging,
  activate a license before the trial ends.** After the trial, SSO and OIDC
  sign-in stop, "Require SSO for login" is no longer enforced (users sign in
  with their password), SCIM provisioning stops and audit logging stops
  recording. Enterprise configuration also becomes read-only and the
  enterprise Health dashboards are locked. Everything resumes, without a
  restart, as soon as you activate a license. The trial is for evaluation:
  production use of the Enterprise Edition requires a OneUptime Enterprise
  subscription. See
  [When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing).
- **Air-gapped installs** can activate with a signed license token instead of
  a key. See [Offline activation](/docs/self-hosted/enterprise#offline-activation-air-gapped-installs).

### OneUptime Cloud customers

Nothing changes for you. OneUptime Cloud runs the Enterprise Edition, and your
plan still decides which features you get: SSO, OIDC, SCIM and team
compliance on the Scale plan and above, and audit logs on the Enterprise plan.
Projects on the Scale plan now see the SSO, OIDC, SCIM and team compliance
settings that used to show an upgrade prompt.

### API and endpoint changes

- `GET /api/global-config/license` returns the license key, the license token,
  the instance list, the instance ID and version details only to master
  admins. Other callers get the edition and the license status.
- Self-hosted installs no longer serve the license-server endpoints under
  `/api/enterprise-license/`. Only oneuptime.com uses them.
- The SSO, OIDC and SCIM endpoints keep their exact paths on the Enterprise
  Edition, so identity provider configuration does not change. On the
  Community Edition they return `404`. On the Enterprise Edition they refuse
  requests while the license is lapsed (after the trial or grace period), and
  answer again as soon as a license is activated.

## ارتقا از OneUptime 13 → 14

نسخهٔ OneUptime 14 برنامه را به دو ویرایش تقسیم می‌کند و اینکه کدام‌یک اجرا شود با ایمیجی که دریافت می‌کنید تعیین می‌شود. **Community Edition** (با پروانهٔ Apache-2.0، برچسب‌های `release` و `<version>`) شامل پوشهٔ `ee/` مخزن نیست: SAML SSO، OpenID Connect، تأمین حساب با SCIM، تنظیمات انطباق تیم‌ها، گزارش‌های حسابرسی، داشبوردهای **Health** در بخش مدیریت و **Query Console** به‌هیچ‌وجه در آن ایمیج وجود ندارند. **Enterprise Edition** (برچسب‌های `enterprise-release` و `enterprise-<version>`) این موارد را در خود دارد و هنگام اجرا پروانهٔ Enterprise را بررسی می‌کند؛ کاری که OneUptime 13 هرگز انجام نمی‌داد.

بخش [Community and Enterprise Edition images](#community-and-enterprise-edition-images) در بالا مرجع این تغییر است: هر ویرایش چه چیزی دارد، برای هر شیوهٔ استقرار چه باید تنظیم شود و پروانه چه می‌کند. این بخش خودِ ارتقا را توضیح می‌دهد. از 13 ارتقا دهید؛ اگر هنوز روی 12 هستید، نخست 12 → 13 را انجام دهید.

در هیچ‌یک از دو ویرایش چیزی حذف نمی‌شود. تنظیمات SSO، OIDC و SCIM شما، تنظیم «Require SSO for login» و گزارش‌های حسابرسیِ ثبت‌شده تا امروز در پایگاه داده می‌مانند. Community Edition تنها آن‌ها را ارائه و اعمال نمی‌کند، و تغییر ویرایش در هیچ جهتی به مهاجرت نیاز ندارد.

### کارهایی که باید انجام دهید

1. **مشخص کنید این نصب کدام ویرایش را اجرا می‌کند.** اگر از SAML SSO، OpenID Connect، تأمین حساب با SCIM، تنظیمات انطباق تیم‌ها یا گزارش‌های حسابرسی استفاده می‌کنید، یا داشبوردهای **Health** بخش مدیریت را می‌خواهید، آن Enterprise Edition است. در غیر این صورت چیزی برای تصمیم‌گیری نیست: همان چیزی که دارید Community Edition است.
2. **در Helm ویرایش را در فایل values خود تعیین کنید:** `image.type: enterprise-edition` (مقدار پیش‌فرض `community-edition` است). `image.tag` را دست نزنید؛ چارت خودش پیشوند `enterprise-` را اضافه می‌کند، پس `image.tag: release` ایمیج `oneuptime/app:enterprise-release` را دریافت می‌کند. این مقدار تازه نیست: اگر از قبل `enterprise-edition` را اجرا می‌کنید چیزی برای تغییر نیست، زیرا همان برچسبی که دریافت می‌کردید اکنون `ee/` را در خود دارد.
3. **در Docker Compose در فایل `config.env` مقدار `APP_TAG=enterprise-release` را قرار دهید** (یا `enterprise-<version>` برای قفل‌کردن یک نسخه). `APP_TAG=release` ایمیج Community است. نصب‌های روی 13 دقیقاً همین‌جا متوقف می‌شوند: در 13 یک نصب Enterprise با Compose ترکیب `APP_TAG=release` و `IS_ENTERPRISE_EDITION=true` بود و این ترکیب اکنون **از راه‌اندازی خودداری می‌کند**، به‌جای آنکه به‌عنوان Community Edition بالا بیاید و تنظیمات SSO شما را دیگر اعمال نکند. تا زمانی که `IS_ENTERPRISE_EDITION=true` باشد، `npm run update` مقدار `APP_TAG` را برایتان بازنویسی می‌کند (`release` به `enterprise-release` و `13.0.8` قفل‌شده به `enterprise-13.0.8`) و تغییرها را چاپ می‌کند. اگر ایمیج‌ها را دستی دریافت می‌کنید، نخست خودتان `APP_TAG` را تنظیم کنید.
4. **در Enterprise Edition یک پروانه فعال کنید.** نصب بدون پروانه یک دورهٔ آزمایشی ۱۴ روزه می‌گیرد که از نخستین راه‌اندازی Enterprise Edition شمرده می‌شود؛ در یک ارتقا یعنی روزی که ارتقا می‌دهید، نه روزی که OneUptime را نصب کرده‌اید. مدیر ارشد آن را از برچسب ویرایش در سرصفحهٔ بخش مدیریت فعال می‌کند؛ نصب‌های جدا از اینترنت با یک توکن امضاشده فعال می‌شوند. به [Licensing](/docs/self-hosted/enterprise#licensing) نگاه کنید.
5. **اگر این نصب با وجود تنظیم اجبار SSO روی Community Edition اجرا خواهد شد، پیش از ارتقا بررسی کنید چه کسانی دسترسی دارند.** «Require SSO for login» دیگر اعمال نمی‌شود، ورود با گذرواژه باز می‌گردد، و هر کسی که همچنان حساب و دسترسی به صندوق پستی آن را دارد می‌تواند از «فراموشی گذرواژه» برای خود گذرواژه تعیین کند؛ از جمله کسانی که در ارائه‌دهندهٔ هویت شما حذف شده‌اند، چون لغو تأمین حساب با SCIM هم متوقف می‌شود. نخست آن کاربران را حذف کنید: [Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community).
6. **اگر نشانی‌های IPv6 را با مانیتورهای Ping، Port یا SSL پایش می‌کنید، پس از ارتقا آن مانیتورها را دوباره ذخیره کنید.** مقصدهای ذخیره‌شده پیش از 14 ممکن است بریده ذخیره شده باشند — پایین‌تر را ببینید.

### ویرایش‌ها: چه چیزی تغییر کرد و چه چیزی نه

| | تا 13 | از 14 |
| --- | --- | --- |
| کد Enterprise | در همهٔ ایمیج‌ها؛ `IS_ENTERPRISE_EDITION=true` آن را روشن می‌کرد | در `ee/` و تنها در ایمیج‌های `enterprise-` |
| انتخاب در Helm | `image.type` | `image.type` — بدون تغییر، اما محتوای ایمیج‌ها حالا واقعاً متفاوت است |
| انتخاب در Compose | `IS_ENTERPRISE_EDITION=true` | `APP_TAG=enterprise-release` |
| پروانهٔ Enterprise | هنگام اجرا هرگز بررسی نمی‌شد | در راه‌اندازی و روزی یک بار بررسی می‌شود |
| نقاط پایانی SSO، OIDC و SCIM | مسیرهای یکسان در هر دو ویرایش | همان مسیرها در Enterprise؛ `404` در Community |
| تنظیمات Enterprise شما | ذخیره‌شده و اعمال‌شده | در هر دو ذخیره می‌شود، در Enterprise اعمال می‌شود |

یک مهاجرت اجرا می‌شود: افزودن ستون nullable با نام `enterpriseEditionFirstSeenAt` به جدول تک‌سطری `GlobalConfig` که فوری انجام می‌شود. هیچ مهاجرت ClickHouse وجود ندارد، چیزی حذف نمی‌شود و تغییر ویرایش در هیچ جهتی به مهاجرت نیاز ندارد.

### خط زمانی پروانه در Enterprise Edition

- **نصب بدون پروانه** یک دورهٔ آزمایشی ۱۴ روزه دارد که از نخستین راه‌اندازی Enterprise Edition شمرده می‌شود. در این مدت همهٔ قابلیت‌های Enterprise کار می‌کنند و برچسب ویرایش پیش از پایان آن هشدار می‌دهد. دورهٔ آزمایشی برای ارزیابی است: استفادهٔ عملیاتی از Enterprise Edition به اشتراک تحت OneUptime Enterprise License نیاز دارد.
- **پروانه‌ای که منقضی می‌شود** از تاریخ انقضا ۳۰ روز مهلت می‌گیرد؛ در این مدت همهٔ قابلیت‌های Enterprise کار می‌کنند و برچسب ویرایش هشدار می‌دهد.
- **پس از دورهٔ آزمایشی، یا پس از آن مهلت**، تا زمانی که پروانه‌ای فعال شود: ورود با SSO و OIDC رد می‌شود، «Require SSO for login» دیگر اعمال نمی‌شود (کاربران با گذرواژهٔ خود وارد می‌شوند)، درخواست‌های SCIM ارائه‌دهندهٔ هویت شما رد می‌شوند و ثبت گزارش حسابرسی متوقف می‌شود. تنظیمات Enterprise فقط‌خواندنی می‌شود — همچنان می‌توانید آن را ببینید و حذف کنید، یک ارائه‌دهندهٔ SSO یا OIDC را غیرفعال کنید و توکن Bearer مربوط به SCIM را بازنشانی کنید، یعنی همان کارهایی که هنگام یک رخداد لازم است — و داشبوردهای Health و Query Console قفل می‌شوند.
- **چیزی حذف نمی‌شود و پایش اصلی هرگز تحت تأثیر قرار نمی‌گیرد.** مانیتورها، هشدارها، رخدادها، کشیک، صفحه‌های وضعیت و داده‌های تلمتری بیرون از دامنهٔ پروانه هستند و ورود با گذرواژه برای همهٔ کاربران، از جمله مدیران ارشد، در دسترس می‌ماند. با فعال‌کردن پروانه، ورود با SSO، اعمال SSO، تأمین حساب با SCIM و ثبت گزارش حسابرسی با همان تنظیماتی که دارید و بدون راه‌اندازی مجدد بازمی‌گردند.
- **کلید پروانه‌ای که از قبل دارید پذیرفته می‌شود**، به‌عنوان پروانهٔ «unverified»: تاریخ انقضا و سقف نشست‌ها از همان چیزی گرفته می‌شود که سرور پروانه پیش‌تر به این نصب گفته است و پس از آن انقضا همان مهلت ۳۰ روزه اعمال می‌شود. پروانه‌هایی که از این پس صادر می‌شوند امضا شده‌اند و خود برنامه آن‌ها را بررسی می‌کند. برای این ارتقا به کلید جدید نیازی نیست.

جدول کامل وضعیت‌ها در [When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing) آمده است.

### Docker Compose: انتخاب برچسب ایمیج

```
git checkout release # مطمئن شوید روی شاخهٔ release هستید.
git pull
npm run update
```

- **تا زمانی که `IS_ENTERPRISE_EDITION=true` است، `npm run update` مقدار `APP_TAG` را** به ایمیج Enterprise همان انتشار منتقل می‌کند و تغییرها را چاپ می‌کند. توضیح‌ها و گیومه‌های شما حفظ می‌شوند، `APP_TAG`ی که از قبل برچسب `enterprise-` است دست‌نخورده می‌ماند و اجرای دوباره چیزی را تغییر نمی‌دهد.
- **دریافت دستی ایمیج‌ها این مرحله را رد می‌کند**؛ در آن صورت برنامه هنگام راه‌اندازی خارج می‌شود و خطایی می‌دهد که دقیقاً می‌گوید چه چیزی را تنظیم کنید: برای نگه‌داشتن Enterprise Edition مقدار `APP_TAG=enterprise-<version>` و برای اجرای Community Edition مقدار `IS_ENTERPRISE_EDITION=false`.
- **برای رفتن آگاهانه به Community Edition** مقدارهای `APP_TAG=release` و `IS_ENTERPRISE_EDITION=false` را تنظیم کنید. اگر این نصب SSO را اجباری کرده است، نخست بند ۵ بالا را بخوانید.
- برای این انتشار چیز دیگری در `config.env` نیاز به تغییر ندارد.

### Helm: انتخاب نوع ایمیج

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **نصبی که از قبل روی `image.type: enterprise-edition` است به تغییر هیچ مقداری نیاز ندارد.** چارت مدت‌ها است پیشوند را به برچسب اضافه می‌کند؛ چیز تازه این است که ایمیج‌های `enterprise-` حالا `ee/` را در خود دارند. از این انتشار به بعد، پروانه بر اساس خط زمانی بالا برای آن‌ها اعمال می‌شود.
- **`image.tag: release` مقدار پیش‌فرض است**، پس چارتی که روی این برچسب شناور مانده در ارتقای بعدی و بدون هیچ تغییری در مقادیر به 14 می‌رود. اگر آن نصب روی `community-edition` تنظیمات SSO، OIDC یا SCIM دارد، در همان ارتقا `image.type: enterprise-edition` را تنظیم کنید.
- **`IS_ENTERPRISE_EDITION` را هنوز چارت تولید می‌کند**، که از `image.type` مشتق می‌شود تا این دو هرگز با هم ناسازگار نشوند. این متغیر چیزی را کنترل نمی‌کند. اجبار آن به `true` با `extraEnv` روی ایمیج Community تنها باعث می‌شود برنامه از راه‌اندازی خودداری کند. `ONEUPTIME_EDITION` را هرگز از طریق چارت تنظیم نکنید.
- **پروب‌های چارت دوباره `probes.<key>.allowPrivateNetworkMonitors` را رعایت می‌کنند** ([#3879](https://github.com/OneUptime/oneuptime/issues/3879)). اگر این مقدار را تنظیم نکنید چیزی تغییر نمی‌کند — همچنان `false` است — و چون پروب‌های چارت پروب جهانی هستند، تنظیم آن روی مانیتورهای **همهٔ پروژه‌های** آن نمونه اثر می‌گذارد. نشانی‌های loopback، link-local و `169.254.169.254` با هر مقداری مسدود می‌مانند.

### تغییرهای دیگر در 14

- **دریافت OTLP تنها پس از پذیرش صف، یک دسته را تأیید می‌کند.** نسخهٔ 13 نخست `200` پاسخ می‌داد و سپس در صف قرار می‌داد، بنابراین دسته‌ای که صف رد می‌کرد بی‌صدا از دست می‌رفت. نسخهٔ 14 پاسخ `503` با متن `Telemetry queue unavailable. Please retry.` می‌دهد و نقطهٔ پایانی gRPC مقدار `UNAVAILABLE` برمی‌گرداند؛ هر دو قابل تلاش مجدد هستند و صادرکننده‌ها دوباره می‌فرستند. این موضوع برای گزارش‌ها، سنجه‌ها، ردیابی‌ها و پروفایل‌ها برقرار است. کاری لازم نیست، اما تلاش‌های مجدد صادرکننده‌ها و فشار بازگشتی صف اکنون در جایی دیده می‌شوند که پیش‌تر داده‌ها ناپدید می‌شدند — اگر ظرفیت دریافت را برآورد می‌کنید، دانستنش ارزش دارد.
- **داشبوردهای Health و Query Console در بخش مدیریت به Enterprise Edition نیاز دارند**، و همچنین هشدارهای سلامت PostgreSQL و Valkey. در 13 این‌ها تنها با `IS_ENTERPRISE_EDITION=true` در دسترس بودند، پس برای نصب Community که از آن‌ها استفاده می‌کرد این یک کاهش محسوس است. نمای ظرفیت ClickHouse و پاک‌سازی آن، وضعیت مهاجرت‌ها، پروب‌های جهانی و بستهٔ پشتیبانی در هر دو ویرایش هستند.
- **مانیتورهای HTTPS که از طریق پراکسی یک پروب به نشانی IP می‌رسند دوباره کار می‌کنند.** پروب نشانی IP را به‌عنوان نام سرور TLS می‌فرستاد؛ IP نام سرور معتبری نیست و Node آن را یکسره رد می‌کند، بنابراین مانیتور روی `https://<IP خصوصی>` از یک پروب جهانی با `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` در دست‌دادن TLS شکست می‌خورد. اکنون پروب برای مقصدِ IP نام سرور را نمی‌فرستد و گواهی را در برابر خود آن IP بررسی می‌کند. مقصدهای نام میزبان تغییری نکرده‌اند.
- **ابزار خط فرمان `oneuptime` در `--version` نسخهٔ واقعی خود را اعلام می‌کند**، نه یک مقدار جای‌نگهدار.
- اینکه کدام نقاط پایانی جابه‌جا یا محدودتر شده‌اند، از جمله `GET /api/global-config/license` و نقاط پایانی سرور پروانه که نصب‌های خودمیزبان دیگر ارائه نمی‌کنند، در بخش [API and endpoint changes](#api-and-endpoint-changes) در بالا آمده است.

### مانیتورهای IPv6: Ping، Port و SSL

مقصد Ping یا Port که با فاصله‌های ابتدا و انتها چسبانده می‌شد — یعنی همان چیزی که کپی‌کردن نشانی از یک looking glass یا تنظیمات روتر به دست می‌دهد — بریده ذخیره می‌شد: `2001:518:2800:9::2 ` به میزبان `2001` با درگاه `518` تبدیل می‌شد. هر دو بخش معتبر هستند، پس چیزی شکست نمی‌خورد و خطایی نشان داده نمی‌شد؛ مانیتور فقط میزبانی را پایش می‌کرد که هیچ‌کس آن را تایپ نکرده بود. نشانی‌های IPv4 هرگز تحت تأثیر نبودند، چون دونقطه‌ای برای جدا کردن وجود ندارد. نسخهٔ 14 این تفسیر را درست می‌کند و همراه آن این مشکل‌ها را نیز: شکست فوری و همیشگی مانیتورهای Ping روی IPv6 در پروب‌های macOS و FreeBSD (که به‌عنوان قطعی واقعی گزارش می‌شد) و شکست مانیتورهای SSL روی IPv6 با خطای `ENOTFOUND`.

برای مقصدهایی که از قبل ذخیره شده‌اند هیچ مهاجرتی وجود ندارد، پس **پس از ارتقا هر مانیتور IPv6 از نوع Ping، Port و SSL را باز کنید و دوباره ذخیره کنید** و مقصدی که نشان داده می‌شود را بررسی کنید. انتظار داشته باشید مانیتورهایی که روی پروب‌های macOS یا FreeBSD همیشه شکست می‌خوردند از این پس واقعیت را گزارش کنند؛ این می‌تواند رخدادهایی را ببندد یا رخدادهای تازه‌ای بسازد.

### بررسی ویرایش و پروانه

- **برچسب ویرایش در سرصفحهٔ بخش مدیریت** ویرایش در حال اجرا را نشان می‌دهد و در Enterprise Edition وضعیت پروانه را هم.
- **Compose:** فرمان `docker compose images` برچسب‌های در حال اجرا را فهرست می‌کند — در Enterprise Edition هر ایمیج OneUptime پیشوند `enterprise-` دارد.
- **Helm:** فرمان `kubectl get pods -n <namespace> -o jsonpath='{..image}'` ایمیج‌هایی را که پادها اجرا می‌کنند چاپ می‌کند؛ همان قاعدهٔ پیشوند برقرار است.
- نقاط پایانی SSO، OIDC و SCIM این دو حالت را از هم جدا می‌کنند: `404` یعنی آن ایمیج `ee/` را ندارد (Community Edition)، و `402` یا `403` یعنی Enterprise Edition در حال اجراست و پروانه‌اش به رسیدگی نیاز دارد.

### بازگشت به 13

- هر دو ویرایش و هر دو انتشار همان داده‌ها را می‌خوانند و تنها تغییر ساختار یک ستون nullable است که 13 آن را نادیده می‌گیرد، پس بازگرداندن ایمیج‌ها هیچ کاری روی پایگاه داده نمی‌خواهد.
- **Docker Compose:** مقدار `APP_TAG` را به همان برچسب 13 که اجرا می‌کردید برگردانید (`13.0.8` یا `enterprise-13.0.8`) و `npm run update` را اجرا کنید. در 13 این `IS_ENTERPRISE_EDITION=true` است که قابلیت‌های Enterprise را روشن می‌کند، پس اگر آن را داشتید دوباره قرار دهید.
- **Helm:** فرمان `helm rollback my-oneuptime` را اجرا کنید یا `image.tag` را روی `13.0.8` قفل کنید.
- اجرای 14 به تنظیمات Enterprise شما دست نمی‌زند، پس بازگشت آن را همان‌گونه که بود می‌یابد.

> نکته: در Enterprise Edition پروانه را همان روز ارتقا فعال کنید، نه در پایان دورهٔ آزمایشی. همین فعال‌سازی است که اجبار ورود یکپارچه را برپا نگه می‌دارد، و دورهٔ آزمایشی از این ارتقا شمرده می‌شود، نه از تاریخ نصب نخستین شما.

## ارتقا از OneUptime 12 → 13

‏OneUptime 13 به‌جای Redis‏ [Valkey](https://valkey.io) را به‌عنوان موتور همراهِ حافظه نهان و صف می‌گذارد. Redis 7.4 پروانه BSD را ترک کرد و بیشتر مشارکت‌کنندگان اصلی Redis به Valkey کوچیدند، که انشعابی از Redis 7.2 است و همان پروتکل سیمی را حرف می‌زند. هیچ‌چیزی بالای سوکت تغییر نکرد — و اگر ترجیح می‌دهید هنوز می‌توانید OneUptime را به یک Redis واقعی، یا به سرویسی مدیریت‌شده و سازگار با Redis، نشانه بگیرید.

هر چیزی که پیکربندی می‌کنید اکنون به نام آن خوانده می‌شود: تنظیم‌ها `VALKEY_*`اند، مقادیر Helm‏ `valkey:` / `externalValkey:`اند، و شیءهای Kubernetes‏ `<release>-valkey*`اند. **هر نام کهنه‌ای هنوز کار می‌کند**، پس `config.env` یا `values.yaml` دست‌نخورده ارتقا می‌یابد و به کار ادامه می‌دهد. هیچ پیکربندی‌ای نیست که ناچار به ویرایشش باشید، و داده‌ای برای مهاجرت نیست — حافظه نهان منبع حقیقت نیست، و Postgres و ClickHouse دست‌نخورده‌اند.

اینکه چه باید بکنید به این بستگی دارد که چگونه مستقر کرده‌اید:

- **‏Docker Compose:** به شیوه همیشگی ارتقا دهید، با یک پرچم که مهم است — [ارتقاهای Docker Compose](#ارتقاهای-docker-compose) را ببینید.
- **‏Helm:** تغییری در مقادیر لازم نیست، اما پاد حافظه نهان بازساخته می‌شود و خالی برمی‌گردد — [ارتقاهای Helm](#ارتقاهای-helm) را ببینید.
- **‏OneUptime را به حافظه نهانی نشانه می‌گیرید که خودتان اجرایش می‌کنید** (‏Redis مدیریت‌شده، ‏ElastiCache، ‏Memorystore، ‏Valkey خودتان): [اگر حافظه نهان خودتان را اجرا می‌کنید](#اگر-حافظه-نهان-خودتان-را-اجرا-میکنید) را بخوانید. این تنها چیدمانی است که می‌تواند بی‌صدا از رسیدن به کارساز شما بازبماند.
- **داشبورد، هشدار، سیاست شبکه یا اسکریپتی دارید که به نام شیءهای Kubernetes کلید خورده است:** آن نام‌ها تغییر می‌کنند — [ارتقاهای Helm](#ارتقاهای-helm) را ببینید.

### چه چیزی تغییر کرد و چه چیزی نکرد

| | تا 12 | از 13 |
| --- | --- | --- |
| موتور | `redis:7.0.12` | `valkey/valkey:9.1-alpine` |
| تنظیم‌ها | `REDIS_*` | `VALKEY_*` — ‏`REDIS_*` هنوز خوانده می‌شود |
| سرویس compose | `redis` | `valkey` — هنوز به نام میزبان `redis` پاسخ می‌دهد |
| مقادیر Helm | `redis:`، `externalRedis:` | `valkey:`، `externalValkey:` — کلیدهای کهنه هنوز اعمال می‌شوند |
| شیءهای Kubernetes | `<release>-redis`، `<release>-redis-master` | `<release>-valkey`، `<release>-valkey-master` |
| Secret تولیدشده | `redis-password` در `<release>-redis` | `valkey-password` در `<release>-valkey` |
| Secret حافظه نهان بیرونی | `<release>-external-redis` | `<release>-external-valkey` |

ده تنظیمی که نامشان تغییر کرد این‌هایند: `VALKEY_HOST`، `VALKEY_PORT`، `VALKEY_DB`، `VALKEY_USERNAME`، `VALKEY_PASSWORD`، `VALKEY_IP_FAMILY`، `VALKEY_TLS_CA`، `VALKEY_TLS_CERT`، `VALKEY_TLS_KEY` و `VALKEY_TLS_SENTINEL_MODE`. هرجا تنظیمی زیر هر دو املا حاضر باشد، برنامه `VALKEY_*` را ترجیح می‌دهد. نمودار Helm این برخورد را وارونه حل می‌کند: کلید میراثی `redis:` بر پیش‌فرض تازه پیروز می‌شود، پس پرونده مقادیری که هرگز دستش نزده‌اید دقیقاً همان‌طور که رفتار می‌کرد به رفتارش ادامه می‌دهد.

**حافظه نهان یک بار بازراه‌اندازی می‌شود**، روی هر دو مسیر استقرار، چون کانتینر جایگزین می‌شود. چیزی روی دیسک نگه نمی‌دارد (`appendonly no`، `save ""`)، پس سرد برمی‌گردد: مقادیر نهان‌شده رفته‌اند، و کارهای BullMQ که در انتظار، تأخیر یا عقب‌نشینی بودند از دست می‌روند. کارهای تکرارشونده و cron هنگام اتصال دوباره خودشان را دوباره ثبت می‌کنند. اگر تله‌متری در پرواز یا تلاش‌های دوباره گردش کار برایتان مهم است، در لحظه‌ای آرام ارتقا دهید.

### ارتقاهای Docker Compose

به‌روزرسانی استاندارد همه آن چیزی است که لازم دارید:

```
git checkout release # Please make sure you're on release branch.
git pull
npm run update
```

- **اگر compose را دستی اجرا می‌کنید از `--remove-orphans` استفاده کنید.** ‏`npm run update` و `npm run start` از پیش آن را می‌دهند، و همین است که کانتینر کهنه `redis` را برمی‌دارد. آن کانتینر را در حال اجرا رها کنید و دو کانتینر به نام میزبان `redis` پاسخ می‌دهند — اتصال‌ها تصادفی روی کانتینر بیات فرود می‌آیند.
- **‏`config.env` شما بازنویسی نمی‌شود.** ‏`npm run update` معمولاً هر تنظیمی را که در `config.example.env` بیابد و پرونده شما نداشته باشد می‌افزاید، اما این ده تا را به‌عنوان تغییر نام می‌شناسد و مقادیر شما — از جمله `REDIS_PASSWORD` شما — را دقیقاً همان‌جا که هستند رها می‌کند. چاپ می‌کند کدام‌ها را نگه داشته است.
- تغییر نام کلیدهای خودتان به `VALKEY_*` اختیاری است و بی‌خطر می‌توانید بعداً انجامش دهید. به ازای هر تنظیم فقط یک املا بگذارید.
- **اگر متغیرهای حافظه نهان را در `docker-compose.override.yml` تنظیم می‌کنید، نامشان را به `VALKEY_*` تغییر دهید.** پرونده پایه اکنون `VALKEY_HOST` را از `REDIS_HOST` شما تنظیم می‌کند، و برنامه نخست `VALKEY_HOST` را می‌خواند، پس بازنویسی‌ای که فقط `REDIS_HOST` را تنظیم کند دیگر برنده نمی‌شود.

### ارتقاهای Helm

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **تغییری در مقادیر لازم نیست.** ‏`redis:` و `externalRedis:` هنوز کار می‌کنند — هر چه زیرشان تنظیم کنید روی پیش‌فرض‌های تازه `valkey:` / `externalValkey:` لایه می‌شود — و `helm upgrade` اعلان `DEPRECATED VALUES`ای چاپ می‌کند که کلیدهای کهنه یافته‌شده را فهرست می‌کند. هر وقت برایتان راحت بود نامشان را تغییر دهید.
- **چیزی چرخانده نمی‌شود.** نمودار به‌جای اینکه گذرواژه‌ای تازه ضرب کند، آن را از Secret موجود `<release>-redis` شما می‌خواند و به `<release>-valkey` می‌بردش.
- **هر دو Secret کهنه نگه داشته می‌شوند.** ‏`<release>-redis` و، اگر حافظه نهان خودتان را می‌آورید، `<release>-external-redis` با `helm.sh/resource-policy: keep` حاشیه‌نویسی می‌شوند، پس عقب می‌مانند و رونوشت‌هایی اکنون بی‌استفاده را در خود دارند. وقتی ارتقا جا افتاد حذفشان کنید — اما نخست [بازگشت به 12](#بازگشت-به-12) را بخوانید.
- **نام شیءها تغییر می‌کند.** هر چیزی را که به `<release>-redis` یا `<release>-redis-master` کلید خورده به‌روزرسانی کنید: داشبوردهای Grafana، قاعده‌های هشدار، NetworkPolicyها، ServiceMonitorها، کارهای پشتیبان‌گیری.
- ‏Service زیر نام کهنه‌اش، `<release>-redis-master`، هم منتشر می‌شود، پس پادهایی که هنوز نچرخیده‌اند به‌جای اینکه در تمام مدت پخش نامی را به هیچ تفکیک کنند، خودشان دوباره وصل می‌شوند. وقتی همه بارهای کاری چرخیدند، `valkey.legacyServiceAlias: false` را بگذارید تا برداشته شود.
- **اگر `persistence.enabled: true` داشتید**، ‏StatefulSet تازه حجم تازه‌ای به نام `data-<release>-valkey-0` مطالبه می‌کند. حجم کهنه `data-<release>-redis-0` هرگز چیزی در خود نداشت، پس حذفش کنید تا دیگر بابتش نپردازید.

### اگر حافظه نهان خودتان را اجرا می‌کنید

نشانه گرفتن OneUptime به حافظه نهانی که خودش اجرایش نمی‌کند هنوز به‌طور کامل پشتیبانی می‌شود، و کارساز آن سر می‌تواند Valkey، ‏Redis یا سرویسی مدیریت‌شده و سازگار با Redis باشد. آنچه تغییر می‌کند نام بلوکی است که پیکربندی‌اش می‌کند.

- در پرونده مقادیرتان نام `externalRedis:` را به `externalValkey:` تغییر دهید. اختیاری است — کلید کهنه هنوز اعمال می‌شود — اما این چیزی است که نمودار اکنون مستند می‌کند.
- نمودار Secret را زیر نام تازه، `<release>-external-valkey`، دوباره رندر می‌کند. ‏`<release>-external-redis` کهنه نگه داشته می‌شود و دیگر به‌روز نمی‌شود، پس اگر هرکدام از مانیفست‌های خودتان با نام به آن ارجاع می‌دهد، نشانه‌شان را عوض کنید.
- **بازنویسی‌های `extraEnv` دیگر به حافظه نهان نمی‌رسند — این یکی بی‌صدا شکست می‌خورد.** اگر به‌جای بلوک `externalValkey:` با `extraEnv: [{name: REDIS_HOST, ...}]` به حافظه نهانی مدیریت‌شده نشانه می‌گیرید، مدخل شما هنوز جایگاه `REDIS_HOST` را می‌برد، اما برنامه اکنون نخست `VALKEY_HOST` را می‌خواند — و نمودار آن را روی حافظه نهان درون‌خوشه‌ای خودش می‌گذارد. بازنویسی شما در مشخصات پاد حاضر است و نادیده گرفته می‌شود. نام آن مدخل‌ها را به `VALKEY_*` تغییر دهید، یا تنظیم‌ها را به `externalValkey:` ببرید، که راه پشتیبانی‌شده است. ‏`helm upgrade` درباره مدخل‌های `extraEnv` در سطح نمودار هشدار می‌دهد؛ فهرست‌های `<service>.extraEnv` به ازای هر سرویس را نمی‌بیند، پس خودتان بررسی‌شان کنید. معادل آن در Compose، پرونده بازنویسی‌ای است که فقط `REDIS_HOST` را تنظیم می‌کند.

### ارتقا را تأیید کنید

- **Admin Dashboard → Health → Valkey** باید Connected را نشان دهد، همراه با رقمی از حافظه. این همان بررسی دسترس‌پذیری‌ای است که ایمیل‌های هشدار سلامت به کار می‌برند.
- **‏Compose:** ‏`docker compose ps` سرویسی به نام `valkey` و هیچ کانتینر `redis`ای فهرست می‌کند.
- **‏Helm:** ‏`kubectl get pods,svc -n <namespace>` پاد `<release>-valkey-0` را در حال Running و Service‏ `<release>-valkey-master` را نشان می‌دهد. برای پخش دوباره اعلان‌های منسوخ‌شدگی‌ای که ارتقا چاپ کرد، `helm get notes my-oneuptime` را اجرا کنید.
- برای نگاهی عمیق‌تر، `HelmChart/Public/diagnose.sh` حافظه، بیرون‌اندازی‌ها و اتصال‌پذیری حافظه نهان را گزارش می‌دهد و هم نام‌های کهنه و هم نام‌های تازه شیءها را می‌فهمد.

### بازگشت به 12

- **‏Helm:** ‏`helm rollback` کار می‌کند، چون نمودار 12 ‏Secret‏ `<release>-redis`ای را که خودش ساخته بود هنوز سر جایش می‌یابد و از گذرواژه‌اش دوباره استفاده می‌کند. به همین دلیل است که Secretهای کهنه نگه داشته می‌شوند — تا وقتی مطمئن نشده‌اید که روی 13 می‌مانید حذفشان نکنید.
- **‏Docker Compose:** تا وقتی مطمئن نشده‌اید املای `REDIS_*` را در `config.env` نگه دارید. ‏OneUptime 12 فقط `REDIS_*` را می‌خواند، پس بازگرداندن `config.env`ای که نام کلیدهایش را تغییر داده‌اید حافظه نهان را بدون گذرواژه پیکربندی‌شده رها می‌کند، و آن روی شبکه compose کاملاً باز راه می‌افتد در حالی که برنامه نمی‌تواند احراز هویت کند. نگه داشتن هر دو املا، با مقادیر یکسان، هم کار می‌کند.
- بازگشت دوباره حافظه نهان را بازراه‌اندازی می‌کند، با همان هزینه راه‌اندازی سرد.

### نام‌هایی که عمداً Redis ماندند

این‌ها از قلم نیفتاده‌اند، و هیچ‌کدام به اقدامی نیاز ندارند:

- **‏API شکلش را نگه می‌دارد.** ‏`components.redis` و `summary.redis` در بار سلامت نمونه، مسیر `/api/admin/health/redis`، و مقدار موتور `redis` در Query Console مدیر، کلیدهای سیمی‌اند، نه متن نمایشی. هر چیزی که رویشان اسکریپت نوشته‌اید به کار ادامه می‌دهد.
- **واژگان پروتکل Redis:** ‏`redis-cli`، فیلد `redis_version` در `INFO`، و کلید ذخیره‌شده خط‌مبنای حافظه که اعلان‌های سلامت با آن مقایسه می‌کنند. تغییر نام آن کلید تاریخچه هر نمونه‌ای را دور می‌ریخت.
- **نام میزبان پیش‌فرض هنوز `redis` است**، برای مانیفست‌های دست‌نویس و چیدمان‌های `docker run` خالی. فقط وقتی به کار می‌رود که نه `VALKEY_HOST` تنظیم شده باشد و نه `REDIS_HOST`، که در Compose یا Helm خودمان هرگز رخ نمی‌دهد.
- نام کلاس‌های درونی و نام ستون‌های Postgres، که هیچ خواننده‌ای نمی‌بیندشان و تغییر نامشان هزینه یک مهاجرت دارد.

## ارتقا از OneUptime 11 → 12

‏OneUptime 12 دو مؤلفه را در یکی ادغام می‌کند. **Runbook Agent** (کانتینری که روی میزبان‌های خودتان نصب می‌کردید تا گام‌های رانبوک را اجرا کند) و **AI Agent** (سرویسی که روی رفع‌های کد با هوش مصنوعی کار می‌کرد) اکنون یک مؤلفه واحدند: **OneUptime Runner**، که به‌عنوان تصویر Docker‏ `oneuptime/runner` عرضه می‌شود. تصویرهای کهنه `oneuptime/runbook-agent` و `oneuptime/ai-agent` دیگر ساخته یا منتشر نمی‌شوند — برچسب‌های موجود همچنان قابل کشیدن‌اند، اما هرگز به‌روزرسانی دیگری نمی‌گیرند.

‏Runner یک کانتینر نصب‌شده است که می‌تواند چند **قابلیت** را در خود داشته باشد و در داشبورد به ازای هر Runner روشن و خاموش می‌شوند: **Runs Runbooks** (به‌طور پیش‌فرض روشن)، **Runs AI Code Fixes** (به‌طور پیش‌فرض خاموش) و **Runs AI Remediation Commands** (به‌طور پیش‌فرض خاموش). تغییرهای قابلیت در ضربان قلب بعدی Runner پذیرفته می‌شوند — به بازراه‌اندازی نیازی نیست. برای اینکه این مؤلفه روزبه‌روز چگونه کار می‌کند [Runnerها](/docs/runbooks/agents) را ببینید.

اینکه چه باید بکنید به این بستگی دارد که چگونه مستقر کرده‌اید:

- **همه:** [چه چیزی خودکار رخ می‌دهد](#چه-چیزی-خودکار-رخ-میدهد) و [صفحه‌های داشبورد جابه‌جا شدند](#صفحههای-داشبورد-جابهجا-شدند) را بخوانید.
- **‏Runbook Agent روی میزبان‌هایتان نصب کرده‌اید:** آن‌ها را روی تصویر تازه دوباره مستقر کنید — [عامل‌های رانبوک خود را دوباره مستقر کنید](#عاملهای-رانبوک-خود-را-دوباره-مستقر-کنید) را ببینید.
- **‏Docker Compose:** تغییر نام متغیرهای محیطی به‌علاوه **یک گام مرتبط با امنیت** — [استقرارهای Docker Compose](#استقرارهای-docker-compose) را ببینید.
- **‏Helm:** تغییر نامی در پرونده مقادیر که اگر رد شود اعتبارسنجی را شکست می‌دهد — [استقرارهای Helm](#استقرارهای-helm) را ببینید.
- **کلیدهای APIای که دسترسی‌های عامل مستقیم به آن‌ها اعطا شده بود:** دوباره اعطایشان کنید — [دسترسی‌ها: تیم‌ها مهاجرت می‌کنند، کلیدهای API نه](#دسترسیها-تیمها-مهاجرت-میکنند-کلیدهای-api-نه) را ببینید.

### چه چیزی خودکار رخ می‌دهد

هیچ کار دستی‌ای روی پایگاه داده لازم نیست. در نخستین راه‌اندازی، v12 مهاجرتی اجرا می‌کند که:

- نام جدول‌ها و ستون‌های Postgres را تغییر می‌دهد (`RunbookAgent` → `Runner`، `RunbookAgentJob` → `RunnerJob`، به‌علاوه جدول‌های مالک، برچسب و پیوند برای همخوانی). شناسه‌ها، کلیدها و تاریخچه کار Runnerها دست‌نخورده‌اند — این تغییر نام است، نه ثبت دوباره.
- هر اعطای دسترسی **تیمی** را از نام‌های کهنه دسترسی `…RunbookAgent…` به نام‌های تازه `…Runner…` مهاجرت می‌دهد، پس نقش‌های تیمی بدون واگذاری دوباره به کار ادامه می‌دهند. (اعطاهای مستقیم به کلید API استثنا هستند — پایین را ببینید.)

‏API هم سازگار می‌ماند:

- درخواست‌ها به `/api/runbook-agent`، `/api/runbook-agent-job`، `/api/runbook-agent-owner-team` و `/api/runbook-agent-owner-user` سمت کارساز روی معادل‌های `/runner…`شان بازنویسی می‌شوند، پس اسکریپت‌های موجود به کار ادامه می‌دهند.
- مسیر دریافتِ رو به عامل `/runbook-agent-ingest` هنوز در کنار `/runner-ingest` تازه سرو می‌شود، پس **کانتینرهای Runbook Agentای که هنوز دوباره مستقرشان نکرده‌اید در برابر کارساز v12 به ضربان زدن و اجرای گام‌های Bash و JavaScript ادامه می‌دهند**. هرکدام روی کارساز هشدار منسوخ‌شدگی‌ای ثبت می‌کند که نام عاملی را که باید دوباره مستقر شود می‌برد.

### عامل‌های رانبوک خود را دوباره مستقر کنید

عامل‌های موجودتان بدون تغییر به اجرای گام‌های Bash و JavaScript ادامه می‌دهند، پس این ارتقا را نمی‌بندد — اما کمی پس از آن انجامش دهید:

- **گام‌های SSH و Kubernetes (تازه در v12) روی عامل‌های کهنه شکست می‌خورند.** کارساز عامل‌های کهنه را از برداشتن آن‌ها کنار نمی‌گذارد: عاملی که هنوز روی تصویر `runbook-agent` است کار SSH یا Kubernetes را برمی‌دارد و با `Unsupported step type` شکستش می‌دهد — معمولاً وسط حادثه، وقتی رانبوک اجرا می‌شود. عامل را **پیش از** نوشتن گام‌های SSH یا Kubernetesای که آن را نشانه می‌گیرند دوباره مستقر کنید.
- تصویر کهنه دیگر هیچ به‌روزرسانی‌ای از هیچ نوعی نمی‌گیرد.

دوباره مستقر کردن یعنی اجرای دوباره فرمان نصب با تصویر و نام‌های متغیر تازه. شناسه و کلید عامل **تغییر نکرده‌اند** (همان سطر پایگاه داده) — نام‌ها را عوض کنید، مقادیر را نگه دارید:

```bash
docker rm -f oneuptime-runbook-agent

docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<agent-id> \
  -e ONEUPTIME_RUNNER_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

(یا Runner را در **Settings → Runners** باز کنید و برای فرمانی از پیش پرشده از **Show setup instructions** استفاده کنید.)

اگر عامل را با متغیرهای محیطی تنظیم کرده بودید، نامشان را تغییر دهید — تصویر تازه نام‌های کهنه را **بی‌صدا نادیده می‌گیرد**:

| کهنه (Runbook Agent)                    | تازه (Runner)                             |
| --------------------------------------- | ----------------------------------------- |
| `RUNBOOK_AGENT_ID`                       | `ONEUPTIME_RUNNER_ID`                     |
| `RUNBOOK_AGENT_KEY`                      | `ONEUPTIME_RUNNER_KEY`                    |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`         | `ONEUPTIME_RUNNER_POLL_INTERVAL_MS`       |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`    | `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS`  |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS`| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` |
| `RUNBOOK_AGENT_CONCURRENCY`              | `ONEUPTIME_RUNNER_CONCURRENCY`            |

### اگر AI Agent مستقل را اجرا می‌کردید

صفحه **Settings → AI → AI Agents** رفته است و تصویر `oneuptime/ai-agent` دیگر ساخته نمی‌شود. اگر خودتان کانتینر AI Agentای نصب کرده بودید، آن را با یک Runner جایگزین کنید:

1. زیر **Settings → Runners** یک Runner بسازید و با فرمان **Show setup instructions** نصبش کنید.
2. روی آن **Runs AI Code Fixes** را فعال کنید. تغییر در ضربان قلب بعدی برداشته می‌شود.

اعتبارنامه‌های کهنه AI Agent هنوز از راه یک عقب‌نشینی میراثی تصویر تازه `oneuptime/runner` را راه می‌اندازند (فقط رفع‌های کد، با هشداری ثبت‌شده که می‌گوید Runner واقعی بسازید) — آن را پلی در میانه مهاجرت بگیرید، نه مقصد.

### استقرارهای Docker Compose

سرویس compose‏ `ai-agent` اکنون `runner` است. اگر با جریان استاندارد `npm run update` ارتقا دهید، متغیرهای تازه خودکار به `config.env` شما افزوده می‌شوند و پشته راه می‌افتد — اما هشدار کلید را در پایین بخوانید. تغییر نام‌ها، اگر `config.env` یا بازنویسی‌ها را دستی اداره می‌کنید:

| کهنه                             | تازه                               |
| -------------------------------- | ---------------------------------- |
| `AI_AGENT_KEY`                   | `ONEUPTIME_RUNNER_KEY`             |
| `AI_AGENT_ONEUPTIME_URL`         | `ONEUPTIME_RUNNER_ONEUPTIME_URL`   |
| `AI_AGENT_PORT`                  | `ONEUPTIME_RUNNER_PORT`            |
| `DISABLE_TELEMETRY_FOR_AI_AGENT` | `DISABLE_TELEMETRY_FOR_RUNNER`     |
| `ENABLE_PROFILING_FOR_AI_AGENT`  | `ENABLE_PROFILING_FOR_RUNNER`      |

خط‌های کهنه `AI_AGENT_*` می‌توانند در `config.env` بمانند؛ دیگر چیزی آن‌ها را نمی‌خواند.

**مهم — ‏`ONEUPTIME_RUNNER_KEY` را روی مقداری تصادفی بگذارید.** ادغام قالب آن را با جانگهدار عینی `please-change-this-to-random-value` می‌افزاید؛ مقدار کهنه `AI_AGENT_KEY` شما منتقل **نمی‌شود**. این کلید Runner سراسر نمونه را ثبت می‌کند و پروتکل رفع کد با هوش مصنوعی را احراز هویت می‌کند — از جمله صادر کردن توکن‌های دسترسی مخزن — پس رها کردن جانگهداری که همه می‌شناسندش حفره‌ای امنیتی است. پیش از راه‌اندازی v12، آن را روی مقداری تصادفی و بلند بگذارید (استفاده دوباره از مقدار کهنه `AI_AGENT_KEY` شما اشکالی ندارد).

**کانتینر یتیم `ai-agent` را بردارید.** ‏`npm start`‏ compose را با `--remove-orphans` اجرا می‌کند و پاکش می‌کند. اگر `docker compose up -d` را دستی اجرا می‌کنید، `--remove-orphans` بیفزایید (یا کانتینر کهنه را با `docker rm -f` بردارید) — وگرنه AI Agent کهنه به اجرا ادامه می‌دهد و در کنار Runner تازه به برداشتن کارهای رفع کد ادامه می‌دهد.

### استقرارهای Helm

- نام بلوک `aiAgent:` را در بازنویسی‌های مقادیرتان به `runner:` تغییر دهید. همه زیرکلیدها (`enabled`، `replicaCount`، `resources`، `keda` و جز آن) تغییر نکرده‌اند. این شکستی سخت است: طرحواره نمودار کلیدهای ناشناخته را رد می‌کند، پس تا وقتی بلوک `aiAgent:` باقی بماند `helm upgrade` **اعتبارسنجی را شکست می‌دهد**.
- نام بارهای کاری از `<release>-ai-agent` به `<release>-runner` تغییر می‌کند — هر چیزی را که به نام‌های کهنه کلید خورده به‌روزرسانی کنید (داشبوردها، هشدارها، سیاست‌های شبکه).
- کلید راز انتشار از `ai-agent-key` به `runner-key` تغییر می‌کند. هنگام ارتقا کلیدی تازه تولید می‌شود و Runner درون‌خوشه‌ای خودش را خودکار دوباره ثبت می‌کند، پس کاری نیست مگر اینکه چیزی بیرونی به مقدار راز کهنه ارجاع داده باشد.
- عمداً تغییرنکرده: سنجه مقیاس‌دهی KEDA هنوز `oneuptime_ai_agent_queue_size` نام دارد — در مقیاس‌دهنده‌های سفارشی نامش را تغییر ندهید.

### دسترسی‌ها: تیم‌ها مهاجرت می‌کنند، کلیدهای API نه

نام دوازده دسترسی تغییر کرد (`CreateRunbookAgent` → `CreateRunner`، `EditRunbookAgent` → `EditRunner`، `DeleteRunbookAgent` → `DeleteRunner`، `ReadRunbookAgent` → `ReadRunner`، و همان چهار فعل برای `…RunbookAgentOwnerTeam` → `…RunnerOwnerTeam` و `…RunbookAgentOwnerUser` → `…RunnerOwnerUser`). اعطاهایی که از راه **تیم‌ها** نگه داشته می‌شوند خودکار مهاجرت می‌کنند. اعطاهایی که **مستقیم به یک کلید API** چسبیده‌اند نه — کلیدی که یکی از این دوازده دسترسی را داشت پس از ارتقا آن دسترسی را از دست می‌دهد. دسترسی‌های تازه `…Runner…` را روی آن کلیدها در داشبورد دوباره اعطا کنید. خانواده‌های دسترسی `RunbookSecret`، `RunbookCredential` و `RunbookExecution` نامشان را نگه داشتند.

جدا از آن، v12 حفره‌ای را می‌بندد: آغاز کردن اجرای رانبوک اکنون به فراخوانی احراز هویت‌شده با `ProjectOwner`، `ProjectAdmin`، `ProjectMember`، `CreateRunbookExecution`، `RunbookAdmin` یا `RunbookMember` نیاز دارد — پیش بردن یا لغو کردن یکی `EditRunbookExecution` را هم می‌پذیرد. راه‌اندازی بدون احراز هویت دیگر کار نمی‌کند، و نقش‌های فقط‌خواندنی (برای نمونه `RunbookViewer`) دیگر نمی‌توانند اجرا را آغاز کنند — خودکارسازی APIای که رانبوک‌ها را راه می‌اندازد به `CreateRunbookExecution` نیاز دارد.

### صفحه‌های داشبورد جابه‌جا شدند

از نشانی‌های کهنه هیچ تغییرمسیری نیست — نشانک‌ها و پیوندهای ویکی داخلی را به‌روزرسانی کنید:

| صفحه                    | جای کهنه                                 | جای تازه                                  |
| ----------------------- | ---------------------------------------- | ----------------------------------------- |
| Runners (پیش‌تر «Agents») | Runbooks → Settings → Agents (`…/runbooks/settings/agents`) | Settings → Runners (`…/settings/runners`) |
| Runner Credentials      | Runbooks → Settings → Credentials (`…/runbooks/settings/credentials`) | Settings → Runner Credentials (`…/settings/runner-credentials`) |
| AI Agents               | Settings → AI → AI Agents (`…/settings/ai-agents`) | برداشته شد — Runnerهایی با قابلیت **Runs AI Code Fixes** جایش را می‌گیرند |

‏Runbook Secrets همان‌جا که بود می‌ماند، زیر Runbooks → Settings → Secrets.

### تازه در 12، چیزی نیست که تصادفی فعال شود

‏v12 فرمان‌های اصلاحی نوشته‌شده با هوش مصنوعی را می‌افزاید: هوش مصنوعی می‌تواند طرح فرمانی پیشنهاد دهد و برای اجرا به Runnerای بسپاردش. همه‌چیز درباره‌اش به‌طور پیش‌فرض خاموش است و خاموش می‌ماند تا وقتی دو بار انتخابش کنید — تنظیم **AI command execution** در سطح پروژه و قابلیت **Runs AI Remediation Commands** به ازای هر Runner هر دو باید فعال شوند، و فقط رانبوک‌ها/قاعده‌هایی که برایش پیکربندی می‌کنید شرکت می‌کنند. ارتقا اینجا چیزی را تغییر نمی‌دهد.

> نکته: مانند هر ارتقای اصلی دیگری، پیش از ارتقا از Postgres پشتیبان بگیرید (بازگشت به v11 یعنی بازگرداندن همان پشتیبان)، نخست در محیط آزمایشی بیازمایید، و گام‌به‌گام ارتقا دهید — 11 → 12، از نسخه‌های اصلی قدیمی‌تر نپرید.

## ارتقا از OneUptime 10 → 11

‏OneUptime 11 دو تغییر دارد که پیش از ارتقا به توجه شما نیاز دارند:

1. **ویژگی‌های هویت (SSO، ‏OIDC، ‏SCIM) به Enterprise Edition منتقل شدند** — اگر روی ساخت Community خودمیزبانی با SSO وارد می‌شوید، نخست این را بخوانید.
2. **انباره تله‌متری ClickHouse بازساخته شد** — اگر می‌خواهید تله‌متری تاریخی را به جلو ببرید مربوط است.

این صفحه هر دو را توضیح می‌دهد — چه چیزی تغییر می‌کند، چه کسی باید اقدام کند، و (برای بازسازی تله‌متری) هر پرس‌وجویی که برای مهاجرت تاریخچه لازم است.

### ویژگی‌های هویت (SSO، ‏OIDC، ‏SCIM) اکنون به Enterprise Edition نیاز دارند

در v11، ویژگی‌های احراز هویت و مدیریت دسترسی زیر به **OneUptime Enterprise Edition** منتقل شدند و دیگر بخشی از ساخت رایگان و متن‌باز (Community) نیستند:

- **SAML SSO** — هم ورود پروژه و هم ورود صفحه وضعیت
- **OpenID Connect (OIDC)** — هم ورود پروژه و هم ورود صفحه وضعیت
- **تأمین کاربر SCIM** — پروژه و صفحه وضعیت
- **‏SSO / OIDC سراسری (در سطح نمونه)**
- **تنظیم‌های انطباق تیم**

**پس از ارتقا چه می‌بینید:** اگر هرکدام از این‌ها را روی ساخت Community Edition پیکربندی کرده بودید، صفحه‌های تنظیم به‌جای فرم پیکربندی، درخواست ارتقا نشان می‌دهند و پیکربندی دیگر قابل تغییر نیست. تا پیش از جدا شدن ایمیج‌های Community و Enterprise، ارائه‌دهنده‌هایی که از قبل پیکربندی کرده بودید روی ساخت Community می‌توانستند همچنان کاربران را وارد کنند، چون کد ورود هنوز در آن بود. ایمیج Community دیگر هیچ کدی برای SSO، ‏OIDC یا SCIM ندارد، پس با ارتقا به آن، ورود از راه آن‌ها متوقف می‌شود — [Community and Enterprise Edition images](#community-and-enterprise-edition-images) را ببینید. رکوردهای موجود ارائه‌دهنده شما **در پایگاه داده نگه داشته می‌شوند** — چیزی حذف نمی‌شود — و به‌محض اینکه نمونه، Enterprise Edition را اجرا کند دوباره کار می‌کنند.

**در دسترس بودن:**

- **خودمیزبان:** به ساخت **Enterprise Edition** نیاز دارد.
- **‏OneUptime Cloud:** به طرح **Scale** (یا بالاتر) نیاز دارد.

**اگر به SSO تکیه دارید و خودمیزبانید**، برای پروانه Enterprise Edition به [support@oneuptime.com](mailto:support@oneuptime.com) ایمیل بزنید تا بتوانید SSO/OIDC/SCIM را بازگردانید. اشاره کنید که از v10 به v11 ارتقا داده‌اید و کمکتان می‌کنیم دوباره آنلاینش کنید. اگر تیمتان وسط ارتقاست و این ورود را می‌بندد، پیش از ارتقای تولید با ما تماس بگیرید تا با هم برنامه‌ریزی‌اش کنیم.

### چه چیزی در v11 تغییر می‌کند (انباره تله‌متری)

تله‌متری (گزارش‌ها، ردیابی‌ها، سنجه‌ها، استثناها، پروفایل‌ها، گزارش‌های مانیتور، گزارش‌های ممیزی) به جدول‌های تازه ClickHouse با پارتیشن‌بندی زمان‌محور، کدک‌های فشرده‌سازی به ازای هر ستون، و ستون‌های تازه مدل موجودیت منتقل می‌شود:

| جدول کهنه             | جدول تازه             |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

روی هر جدول تله‌متری نام دو ستون تغییر می‌کند: `serviceId` → `primaryEntityId` و `serviceType` → `primaryEntityType`. این تغییر نامی سخت است — **اگر API تحلیلی OneUptime را مستقیم با پالایه‌های `serviceId`/`serviceType` پرس‌وجو می‌کنید، آن‌ها را به نام‌های تازه به‌روزرسانی کنید.** داشبوردها، مانیتورها و هشدارهای درون OneUptime خودکار مهاجرت می‌کنند.

این برش **فقط رو به جلو** است: جدول‌های تازه خالی آغاز می‌شوند، همه تله‌متری دریافت‌شده پس از ارتقا بی‌درنگ در آن‌ها فرود می‌آید، و تاریخچه با گذشت زمان به‌طور طبیعی دوباره پر می‌شود. جدول‌های کهنه هنگام ارتقا **خودکار انداخته می‌شوند** تا دیسکشان بازپس گرفته شود — اگر می‌خواهید گزینه بردن تاریخچه به جلو را داشته باشید، **پیش از** ارتقا نامشان را تغییر دهید (گام ۰ پایین).

> **از پیش روی 11.0.0 یا 11.0.1 هستید؟** آن انتشارها جدول‌های کهنه را نگه می‌داشتند (از راه TTL تخلیه می‌شدند، و رونوشت را می‌شد «هر وقت پس از ارتقا» اجرا کرد). هر به‌روزرسانی بعدی‌ای **هنگام راه‌اندازی می‌اندازدشان**. اگر هنوز رونوشت تاریخچه را می‌خواهید و هنوز انجامش نداده‌اید، پیش از اعمال به‌روزرسانی گام ۰ پایین را اجرا کنید.

### چه کسی باید کاری بکند

- **نصب‌های تازه:** کاری نیست.
- **ارتقاهایی که به تله‌متری پیش از ارتقا در رابط کاربری نیاز ندارند:** کاری نیست. صفحه‌های تله‌متری صرفاً داده را از لحظه ارتقا به بعد نشان می‌دهند؛ جدول‌های کهنه هنگام ارتقا انداخته می‌شوند.
- **ارتقاهایی که می‌خواهند تله‌متری پیش از ارتقا دیدنی باشد:** **پیش از** ارتقا نام جدول‌های کهنه را تغییر دهید (گام ۰ پایین)، سپس رونوشت دستی را هر وقت پس از آن اجرا کنید.

مثل همیشه: نسخه‌های اصلی را گام‌به‌گام ارتقا دهید (10 → 11، نپرید)، و پیش از ارتقا از Postgres و ClickHouse پشتیبان بگیرید.

### اختیاری: بردن تاریخچه تله‌متری به جلو

گام ۰ **پیش از ارتقا** اجرا می‌شود؛ هر چیزی از گام ۱ به بعد **پس از اینکه ارتقا کاملاً راه افتاد** اجرا می‌شود (جدول‌های تازه و نماهای مادی‌شده‌شان باید موجود باشند). مستقیم روی میزبان ClickHouse خود وصل شوید — پروتکل بومی مهلت HTTP ندارد، پس دستورهای چندساعته اشکالی ندارند:

```bash
clickhouse-client --database oneuptime
```

خوب است پیش از آغاز بدانید:

- اجرای رونوشت در حالی که OneUptime زنده است امن است. تله‌متری تازه مستقل از آن در جدول‌های تازه نوشته می‌شود؛ تاریخچه رونوشت‌شده پشت سرش پر می‌شود.
- در مقیاس بزرگ (صدها گیگابایت) انتظار ساعت‌ها را داشته باشید.
- هر دستوری در پایین یک `insert_deduplication_token` حمل می‌کند، و جدول‌های تازه با پنجره‌ای برای حذف تکرار عرضه می‌شوند — پس **اجرای دوباره دستوری که در میانه راه شکست خورده امن است** (بلوک‌های از پیش درج‌شده رد می‌شوند، از جمله در جمع‌بندی‌های سنجه)، به شرط اینکه در فاصله‌ای معقول دوباره اجرایش کنید. زیر دریافت زنده سنگین، پنجره (آخرین ۱۰٬۰۰۰ بلوک درج به ازای هر جدول) سرانجام توکن‌های کهنه را بیرون می‌اندازد.
- رونوشت گرفتن از سنجه‌ها جمع‌بندی‌های از پیش تجمیع‌شده داشبورد را هم خودکار بازمی‌سازد (هر سطر رونوشت‌شده دوباره به نماهای مادی‌شده جمع‌بندی خوراک می‌دهد) — این کار رونوشت سنجه را از بقیه کندتر می‌کند؛ آخر از همه اجرایش کنید.

#### گام ۰ — پیش از ارتقا، نام جدول‌های کهنه را تغییر دهید

ارتقا جدول‌های کهنه را هنگام راه‌اندازی می‌اندازد، پس نخست آن‌هایی را که می‌خواهید از آن‌ها رونوشت بگیرید از دسترسش بیرون ببرید. OneUptime را بایستانید (استقرار را پایین مقیاس دهید) تا چیزی در آن‌ها ننویسد و نتواند بازشان بسازد، سپس نام‌ها را تغییر دهید — `RENAME TABLE` عملیاتی آنی روی فراداده است، و `IF EXISTS` به دسته اجازه می‌دهد جدول‌هایی را که نصب شما هرگز نداشته رد کند (استقرارهای قدیمی‌تر از میانه 10.0.x ممکن است `AuditLogV1` یا برخی جدول‌های `…V2` را به‌کل نداشته باشند — تاریخچه‌ای از آن نوع برای رونوشت گرفتن نیست):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

سپس ارتقا دهید و پیش از ادامه بگذارید OneUptime کاملاً راه بیفتد.

> اگر پس از تغییر نام به v10 بازگردید (v10 هنگام راه‌اندازی جدول‌های خالی با نام‌های کهنه را بازمی‌سازد)، پیش از راه‌اندازی دوباره v10 نام جدول‌های `_backup` را به نام‌های اصلی‌شان بازگردانید — وگرنه تله‌متری دریافت‌شده در طول بازگشت در جدول‌های بازساخته فرود می‌آید و در ارتقای نهایی انداخته می‌شود.

#### گام ۱ — پارتیشن‌های مبدأ را فهرست کنید

هر جدول کهنه‌ای حداکثر ۱۶ پارتیشن دارد. برای هر جدول مبدأ:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### گام ۲ — دستور رونوشت را تولید کنید

مجموعه ستون‌ها می‌تواند میان نصب‌ها اندکی فرق کند (استقرارهای قدیمی‌تر ممکن است ستون‌های تازه‌افزوده را نداشته باشند)، پس به‌جای کپی‌چسباندن دستوری ثابت، آن را از طرحواره زنده خودتان تولید کنید. در بند `WITH` مقدار `src` و `dst` را روی یکی از جفت‌جدول‌های جدول بالا بگذارید (مبدأ پسوند `_backup` را از گام ۰ حمل می‌کند)، و اجرا کنید:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

دستور تولیدشده فقط ستون‌هایی را رونوشت می‌کند که هر دو جدول مشترک دارند (ستون‌های تازه پیش‌فرض‌هایشان را می‌گیرند)، `serviceId`/`serviceType` را در حین کار تغییر نام می‌دهد، سطرها را قطعی مرتب می‌کند تا تلاش دوباره بلوک‌هایی یکسان و قابل حذف تکرار تولید کند، و محدودیت‌های زمان اجرا و شمار پارتیشن را که دستوری به این اندازه لازم دارد برمی‌دارد.

#### گام ۳ — یک پارتیشن در هر بار اجرایش کنید

دستور تولیدشده را بردارید و `{PARTITION}` را (دو بار پدیدار می‌شود — در `WHERE` و در توکن) با هر شناسه پارتیشن از گام ۱ جایگزین کنید. دستورها را یکی‌یکی اجرا کنید، سپس گام‌های ۱ تا ۳ را برای هر جفت‌جدول تکرار کنید.

> یادداشت: اگر جدول مبدئی در گام ۰ رد شد چون روی نصب شما وجود نداشت، گام ۱ برای آن جفت با `UNKNOWN_TABLE` شکست می‌خورد — صرفاً از آن جفت بگذرید؛ تاریخچه‌ای از آن نوع برای رونوشت گرفتن نیست.

اگر دستوری در میانه راه شکست خورد، **همان** دستور را بی‌درنگ دوباره اجرا کنید — بلوک‌های از پیش تثبیت‌شده حذف تکرار می‌شوند. اگر خیلی دیرتر دوباره اجرا می‌کنید، نخست شمار سطرها را مقایسه کنید (گام ۵).

#### گام ۴ (اختیاری) — تاریخچه جمع‌بندی سنجه به ازای هر میزبان

سطرهای خام سنجه که رونوشت شده‌اند جمع‌بندی‌های سطح سرویس را خودکار بازمی‌سازند، اما جمع‌بندی **به ازای هر میزبان** را نه (سطرهای کهنه کلید موجودیت میزبان ندارند). جدول جمع‌بندی کهنه که در گام ۰ تغییر نام داد تنها منبع این تاریخچه است؛ با محاسبه کلید تازه از نام میزبان آن را به جلو ببرید:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

بند `ORDER BY` مهم است: باعث می‌شود اجرای دوباره بلوک‌های درج یکسانی تولید کند تا توکن حذف تکرار بتواند بشناسدشان. بدون آن، تلاش دوباره می‌توانست بی‌صدا رد یا دوبار شمرده شود. (حالت مرزی: نام‌های میزبانی که `\`، `|` یا `=` دارند — که نویسه‌های مجاز نام میزبان در RFC-1123 نیستند — کلیدی متفاوت با آنچه برنامه محاسبه می‌کند می‌دهند؛ مگر بدانید چنین میزبان‌هایی دارید، نادیده‌اش بگیرید.)

#### گام ۵ — تأیید کنید

مجموع‌ها را به ازای هر جفت‌جدول مقایسه کنید (جدول تازه سطرهای پس از ارتقا را هم دارد، پس باید بزرگ‌تر یا برابر با کهنه باشد):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### گام ۶ — پشتیبان‌ها را بیندازید

جدول‌های تغییرنام‌یافته TTL نگهداشتشان را نگه می‌دارند، پس خودشان تخلیه و کوچک می‌شوند — اما وقتی از رونوشت راضی شدید، برای بازپس گرفتن بی‌درنگ دیسک بیندازیدشان:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(‏`max_table_size_to_drop = 0` محافظت ۵۰ گیگابایتی کارساز در برابر انداختن را برای همان یک دستور برمی‌دارد.)

> نکته: مانند هر ارتقای اصلی دیگری، نخست در محیط آزمایشی بیازمایید و پیش از تکیه کردن به رونوشت در تولید، تأیید کنید تله‌متری به جدول‌های تازه جاری است.

## ارتقا از OneUptime 9 → 10

هیچ تغییری که به اقدام دستی نیاز داشته باشد نیست. صرفاً فرایند استاندارد ارتقا را دنبال کنید.

## ارتقا از OneUptime 8 → 9

نمودار Helm دیگر منبع Ingress‏ Kubernetes را تأمین نمی‌کند. OneUptime کانتینر دروازه ورودی‌ای عرضه می‌کند که از پیش TLS را پایان می‌دهد، دامنه‌های صفحه وضعیت را مدیریت می‌کند و ترافیک سکو را مسیریابی می‌کند، پس دیگر کنترلر ingress خوشه لازم نیست.

- پیش از ارتقا هر بازنویسی `oneuptimeIngress` را از پرونده‌های سفارشی `values.yaml` خود بردارید. آن کلیدها اکنون نادیده گرفته می‌شوند و اگر سر جایشان بمانند خطای اعتبارسنجی می‌سازند.
- مطمئن شوید `nginx.service.type` بازتاب می‌دهد که می‌خواهید دروازه ورودی همراه را چگونه در معرض بگذارید (برای نمونه `LoadBalancer`، `NodePort` یا `ClusterIP` با متعادل‌کننده بار بیرونی).
- تأیید کنید هر رکورد DNSای برای صفحه‌های وضعیت یا میزبان‌های اصلی هنوز به Service یا متعادل‌کننده باری اشاره می‌کند که جلوی دروازه ورودی OneUptime می‌ایستد.
- پس از ارتقا، تأیید کنید گواهی‌های TLS از راه دروازه توکار به تمدید شدن ادامه می‌دهند و دامنه‌های صفحه وضعیت درست تفکیک می‌شوند.

## ارتقا از OneUptime 7 → 8

اگر روی Kubernetes اجرا می‌کنید، تغییرهای شکننده مهمی هست:

- به‌خاطر [تغییرهای پروانه Bitnami](https://github.com/bitnami/charts/issues/35164) دیگر از نمودارهای Bitnami برای Postgres، ‏Redis و ClickHouse استفاده نمی‌کنیم
- این تغییرها با گذشته سازگار نیستند. باید ساختار تازه را در `values.yaml` نمودار Helm دنبال کنید.
- پیش از ارتقا از داده‌تان (Postgres، ‏ClickHouse و هر حجم ماندگاری) پشتیبان بگیرید.

> نکته: نخست ارتقا را در محیط آزمایشی بیازمایید. پیش از ارتقای تولید تأیید کنید بارهای کاری‌تان سالم‌اند و داده دست‌نخورده است.
