# مشترکان و اعلامیه‌ها

صفحه وضعیت جایی است که آدم‌ها به آن می‌روند. مشترکان کسانی‌اند که ترجیح می‌دهند مجبور نباشند — یک بار نشانی ایمیل، شماره تلفن، وب‌هوک Slack یا نقطه پایانی HTTPای به شما می‌دهند، و پس از آن به‌روزرسانی‌های شما نزدشان می‌آید.

اعلامیه‌ها نیمه دیگر همان کارند. مانیتوری می‌تواند به بازدیدکنندگانتان بگوید پرداخت خطای ۵۰۰ برمی‌گرداند؛ هیچ مانیتوری نمی‌تواند بگوید شنبه پایگاه‌های داده را مهاجرت می‌دهید، ارائه‌دهنده‌ای شخص ثالث روز بدی دارد، یا حادثه‌ای که دیروز درباره‌اش خواندند کاملاً بسته شده است. اعلامیه‌ها کانال متن آزاد برای هر چیزی هستند که بررسی‌های شما نمی‌بینند، و به همان فهرست مشترکان پخش می‌شوند.

این صفحه هر دو را پوشش می‌دهد: پنج کانال اشتراک و اینکه بازدیدکنندگان چگونه ثبت‌نام می‌کنند، مشترکان چه چیزی را می‌توانند برای شنیدن برگزینند، جریان دوگام تأیید و لغو اشتراک، و اینکه اعلامیه‌ها چگونه نوشته، زمان‌بندی و قالب‌بندی می‌شوند.

## کانال‌های اشتراک

صفحه وضعیت از پنج کانال پشتیبانی می‌کند، که هرکدام کلید خودشان را روی صفحه وضعیت دارند. به **Status Pages → صفحه شما → Subscribers → Subscriber Settings** بروید:

- **Enable Email Subscribers** (`enableEmailSubscribers`) — به‌طور پیش‌فرض روشن. باقی همه‌چیز تا وقتی روشنشان نکنید خاموش‌اند.
- **Enable SMS Subscribers** (`enableSmsSubscribers`) — به‌طور پیش‌فرض خاموش.
- **Enable Slack Subscribers** (`enableSlackSubscribers`) — به‌طور پیش‌فرض خاموش.
- **Enable Microsoft Teams Subscribers** (`enableMicrosoftTeamsSubscribers`) — به‌طور پیش‌فرض خاموش.
- **Enable Webhook Subscribers** (`enableWebhookSubscribers`) — به‌طور پیش‌فرض خاموش.

هر کانالی فهرست خودش را هم در منوی کناری صفحه وضعیت زیر **Subscribers** می‌گیرد: **Email Subscribers**، **SMS Subscribers**، **Slack Subscribers**، **MS Teams Subscribers** و **Webhook Subscribers**. آنجاست که می‌بینید چه کسی ثبت‌نام کرده، کسی را دستی می‌افزایید، یا روی مشترکی مشخص برای خودتان مدخل **Notes** (`internalNote`) می‌گذارید.

**یک کلید بس نیست.** آیتم **Subscribe** در نوار پیمایش صفحه وضعیت فقط وقتی پدیدار می‌شود که **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) روشن باشد *و* دست‌کم یک کانال فعال باشد. اگر **Enable Email Subscribers** را روشن کنید اما **Show Subscriber Page** را خاموش بگذارید، بازدیدکنندگان راهی به فرم ندارند.

همان پنج کلید بار دومی درون کارت **Subscriber Settings** روی **Advanced Settings**، در کنار **Show Subscriber Page**، پدیدار می‌شوند. زیرشان همان ستون‌هایند — یک صفحه را برگزینید و رویش بمانید، و صفحه اختصاصی **Subscriber Settings** را ترجیح دهید چون باقی پیکربندی مشترکان آنجا زندگی می‌کند.

## بازدیدکننده در صفحه Subscribe چه می‌بیند

صفحه **Subscribe** زیرمنویی با یک زبانه به ازای هر کانال فعال دارد — **Email**، **SMS**، **Slack**، **MS Teams**، **Webhooks** — که به `/subscribe/email`، `/subscribe/sms`، `/subscribe/slack`، `/subscribe/microsoft-teams` و `/subscribe/webhooks` نگاشت می‌شوند. هر زبانه‌ای کمینه آنچه لازم دارد را می‌پرسد:

- **Email** — سرتیتر **Subscribe by Email**، یک فیلد **Your Email** با جانگهدار `subscriber@company.com`.
- **SMS** — سرتیتر **Subscribe by SMS**، یک فیلد **Your Phone Number** با جانگهدار `+11234567890`.
- **Slack** — سرتیتر **Subscribe by Slack**، با **Slack Workspace Name** (برای اعتبارسنجی به کار می‌رود) و **Slack Incoming Webhook URL**، جانگهدار `https://hooks.slack.com/services/...`.
- **MS Teams** — سرتیتر **Subscribe by Microsoft Teams**، با **Microsoft Teams Workspace Name** و **Microsoft Teams Incoming Webhook URL**، جانگهدار `https://outlook.office.com/webhook/...`.
- **Webhooks** — سرتیتر **Subscribe by Webhook**، یک فیلد **Webhook URL**. در هر رویداد صفحه وضعیت درخواستی `POST` از نوع JSON به آن فرستاده می‌شود.

دکمه ثبت **Subscribe** خوانده می‌شود، و ثبت‌نام موفق پیام *You have been subscribed successfully.* را نشان می‌دهد. صفحه تقسیم **New Subscription** / **Manage Existing Subscription** را هم دارد، پس کسی که از پیش مشترک شده می‌تواند بدون گشتن دنبال ایمیلی قدیمی به ترجیحاتش برگردد.

## اجازه دادن به مشترکان برای برگزیدن منابع و نوع رویداد

به‌طور پیش‌فرض مشترک هر چیزی را روی صفحه می‌گیرد. دو کلید در کارت **Advanced Subscriber Settings** این را تغییر می‌دهند:

- **Allow Subscribers to Choose Resources** (`allowSubscribersToChooseResources`) — به‌طور پیش‌فرض خاموش. روشنش کنید و فرم اشتراک کلید **Subscribe to All Resources** می‌گیرد؛ پاکش کنید و **Select Resources to Subscribe** پدیدار می‌شود تا بازدیدکننده منابع منفرد را برگزیند.
- **Allow Subscribers to Choose Event Types** (`allowSubscribersToChooseEventTypes`) — به‌طور پیش‌فرض خاموش. همان شکل: کلید **Subscribe to All Event Types**، و **Select Event Types to Subscribe** زیرش وقتی پاک شود.

نوع رویدادها `Incident`، `Announcement` و `Scheduled Event` هستند.

انتخاب‌ها روی رکورد مشترک به‌صورت **Is Subscribed to All Resources** (`isSubscribedToAllResources`، پیش‌فرض درست)، **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`، پیش‌فرض درست)، **Subscribed to Resources** و **Subscribed to Event Types** می‌نشینند.

خوب برای: صفحه‌ای که چند محصول را پوشش می‌دهد. مشتری‌ای که فقط API شما را به کار می‌برد نمی‌خواهد هر بار که سایت بازاریابی می‌لرزد فراخوانده شود — بگذارید خودشان فهرست را تنگ کنند به‌جای اینکه تماشا کنید کلاً لغو اشتراک می‌کنند.

همان کارت **Subscriber Timezones** را هم حمل می‌کند.

## تأیید دوگام ایمیل

مشترکان ایمیلی همیشه تأیید می‌کنند. وقتی مشترکی با نشانی ایمیل ساخته می‌شود و از پیش تأییدشده ساخته نشده باشد، **Is Subscription Confirmed** (`isSubscriptionConfirmed`) به `false` وادار می‌شود و **Subscription Confirmation Token** شش‌رقمی‌ای تولید می‌شود. آنگاه OneUptime پیوند تأییدی به شکل `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}` ایمیل می‌کند. بازدیدکننده روی صفحه **Confirm Subscription** می‌نشیند و پس از انجام شدنش پیام *Subscription confirmed successfully* را می‌بیند.

مشترکان پیامک، Slack، ‏Microsoft Teams و وب‌هوک این را رد می‌کنند — با `isSubscriptionConfirmed` که از پیش `true` است ساخته می‌شوند.

**تأییدنشده یعنی خاموش.** پرس‌وجویی که مشترکان را برای اعلانی می‌گیرد بر `isUnsubscribed: false` و `isSubscriptionConfirmed: true` می‌پالاید. نشانی ایمیلی که هرگز روی پیوند کلیک نکرده در فهرست **Email Subscribers** شما می‌نشیند و چیزی نمی‌گیرد. اگر کسی قسم می‌خورد مشترک است اما چیزی نمی‌شنود، نخست همان ستون را بررسی کنید.

کلیدی برای خاموش کردن تأیید ایمیل وجود ندارد — برای هر کسی که از راه صفحه وضعیت ثبت‌نام می‌کند بی‌قید و شرط است. ستونی جدا به ازای هر مشترک، **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`، پیش‌فرض درست)، ایمیل «شما مشترک شدید» را که پس از تأیید مشترک بیرون می‌رود کنترل می‌کند.

## مدیریت و لغو اشتراک

هر ایمیل مشترکی پیوند لغو اشتراکی به شکل `{statusPageUrl}/update-subscription/{statusPageSubscriberId}` حمل می‌کند. آن صفحه با عنوان **Update Subscription** است و به بازدیدکننده می‌گوید می‌تواند آنجا ترجیحاتش را به‌روزرسانی کند یا لغو اشتراک کند. این‌ها را دارد:

- هر انتخابگر منبع و نوع رویدادی که صفحه اجازه می‌دهد.
- کلید **Unsubscribe**، که به‌عنوان لغو اشتراک از همه منابع توصیف شده است. مقدار **Is Unsubscribed** (`isUnsubscribed`، پیش‌فرض نادرست) را می‌نویسد.
- دکمه ثبتی که **Update Subscription** خوانده می‌شود؛ ذخیره پیام *Your changes have been saved.* را نشان می‌دهد.

کسی که پیوند را گم کرده از **Manage Existing Subscription** در صفحه **Subscribe** استفاده می‌کند و **Send Management Link** را می‌زند. OneUptime پاسخ می‌دهد که ایمیلی با پیوند فرستاده شده و اگر نرسید پوشه هرزنامه را بررسی کنند.

نقطه‌های پایانی پشت همه این‌ها `POST .../subscribe/:statusPageId`، `POST .../manage-subscription/:statusPageId`، `POST .../get-subscription/:statusPageId/:subscriberId` و `PUT .../update-subscription/:statusPageId/:subscriberId` هستند.

لغو اشتراک به‌جای حذف سطری، پرچمی را می‌چرخاند، پس رکورد با **Is Unsubscribed** تنظیم‌شده در فهرست کانال می‌ماند — وقتی بعداً باید توضیح دهید چرا نشانی مشخصی دیگر نامه نمی‌گیرد مفید است.

## مشترکان درباره چه چیزی خبردار می‌شوند

مشترکان درباره سه نوع رویداد بالا می‌شنوند، اما هر منبعی کلید خودش را دارد، پس چیزی تصادفی فرستاده نمی‌شود.

### اعلان اعلامیه

خودِ اعلامیه **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`) را حمل می‌کند، که روی فرم ساخت به‌صورت جعبه انتخاب **Notify Status Page Subscribers** در معرض است و پیش‌فرضش روشن. اگر اعلامیه زیر **Monitors affected (Optional)** مانیتورهایی را نام ببرد، اعلان به همان مانیتورها محدود می‌شود؛ خالی بگذاریدش و به همه مشترکان خبر داده می‌شود.

### رویدادهای نگهداری زمان‌بندی‌شده

رویداد نگهداری زمان‌بندی‌شده مجموعه ستون‌های مشترک خودش را دارد: **Should subscribers be notified when event is created?**، **Should subscribers be notified when event is changed to ongoing?**، **Should subscribers be notified when event is changed to ended?**، به‌علاوه **Subscriber notifications before the event** و **Next subscriber notification before the event at?** برای هشدارهای پیشاپیش. مقدار **Status Pages** روی رویداد تصمیم می‌گیرد روی کدام صفحه‌ها پدیدار شود، و **Should be visible on status page?** تصمیم می‌گیرد اصلاً پدیدار شود یا نه.

### حادثه‌ها

`Incident` سومین نوع رویداد است. اینکه اصلاً چه چیزی حادثه‌ای را به صفحه وضعیت می‌رساند — کدام منابع را لمس می‌کند و کدام وضعیت‌ها آن را دیده نگه می‌دارند — در [وضعیت‌ها و شدت‌های حادثه](/docs/incidents/states-and-severities) پوشش داده شده است.

بخش **Notification Logs** در منوی کناری صفحه وضعیت (`{id}/notification-logs`) جایی است که وقتی لازم دارید ببینید صفحه واقعاً چه فرستاده به آن می‌روید.

## سفارشی‌سازی قالب‌های اعلان

کارت **Notification Templates** روی **Subscriber Settings** قالب‌هایی را که این صفحه وضعیت به کار می‌برد فهرست می‌کند، با ستون‌های **Template Name**، **Event Type** و **Notification Method** — پس می‌توانید به‌جای پذیرفتن یک پیام خانگی برای همه‌چیز، عبارت‌بندی را به ازای هر نوع رویداد و هر کانال تغییر دهید.

قالب‌های سطح پروژه یک سطح بالاتر، در **Status Pages → Settings → Subscriber Templates**، کنار **Announcement Templates** زندگی می‌کنند.

## پاورقی ایمیل، SMTP سفارشی و Twilio

سه کارت دیگر روی **Subscriber Settings** کنترل می‌کنند پیام‌های مشترکان چگونه پروژه شما را ترک کنند:

- **Email Footer Settings** — گزینه‌های **Enable Custom Email Footer Text** و **Subscriber Email Notification Footer Text** پاورقی خودتان را روی ایمیل‌های مشترکان می‌گذارند.
- **Custom SMTP** — گزینه **Custom SMTP Config** ایمیل مشترکان را به‌جای پیش‌فرض از راه کارساز نامه خودتان می‌فرستد.
- **Twilio Config** — گزینه **Twilio Config** حساب Twilioای است که برای مشترکان پیامک به کار می‌رود.

اگر مشترک ایمیلی دارید، SMTP سفارشی زود انجام دادنش می‌ارزد: نامه‌ای که از دامنه خودتان می‌آید بسیار کمتر پالوده می‌شود، و مشتری‌ای که ساعت دو بامداد می‌خواندش بسیار بیشتر به آن اعتماد می‌کند.

## اعلامیه‌ها

اعلامیه رکوردی در سطح پروژه است (مدل `StatusPageAnnouncement`) که به یک یا چند صفحه وضعیت پخشش می‌کنید، اختیاراً محدود به مانیتورهای مشخص، با پنجره‌ای که در آن نشان داده می‌شود.

یکی را از **Status Pages → More → Announcements**، یا از **Announcements** در منوی کناری صفحه وضعیتی منفرد می‌سازید. فرم ساخت جادوگری چهارگامی است:

1. **Basic Information** — **Announcement Title** (الزامی، دست‌کم دو نویسه)، **Description** (مارک‌داون، اختیاری) و **Attachments** برای فایل‌هایی که باید همراه اعلامیه روی صفحه وضعیت در دسترس باشند.
2. **Status Pages** — گزینه **Show announcement on these status pages**، چندانتخابی الزامی. یک اعلامیه می‌تواند هم‌زمان چند صفحه را نشانه بگیرد.
3. **Resources Affected** — گزینه **Monitors affected (Optional)**. اگر هیچ‌کدام را برنگزینید، به همه مشترکان خبر داده می‌شود.
4. **Schedule & Settings** — گزینه‌های **Start Showing Announcement At** (الزامی، پیش‌فرض حالا)، **End Showing Announcement At** (اختیاری) و **Notify Status Page Subscribers** (به‌طور پیش‌فرض روشن).

بازدیدکنندگان اعلامیه‌ها را در `/announcements` می‌خوانند، که به **Active Announcements** و **Past Announcements** تقسیم شده و هرکدام با **Announced at** مهر خورده‌اند. اعلامیه‌هایی که هم‌اکنون زنده‌اند بالای صفحه نمای کلی هم سنجاق می‌شوند. وقتی چیزی برای نشان دادن نباشد، صفحه *No Announcement* را با یادداشتی می‌خواند که تاکنون چیزی منتشر نشده است.

پیوست‌ها از `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId` سرو می‌شوند، پشت همان بررسی خواندنی که خود صفحه وضعیت دارد — پس پیوستی روی صفحه‌ای خصوصی خصوصی می‌ماند.

## زمان‌بندی اعلامیه چگونه کار می‌کند

مقادیر **Show At** (`showAnnouncementAt`) و **End At** (`endAnnouncementAt`) همه‌چیز را می‌رانند، اما صفحه نمای کلی و فهرست اعلامیه‌ها پرسش‌های متفاوتی می‌پرسند، و تفاوت آدم‌ها را می‌لغزاند.

- **صفحه نمای کلی** اعلامیه‌ای را وقتی نشان می‌دهد که `showAnnouncementAt` در گذشته باشد و `endAnnouncementAt` یا در آینده باشد یا خالی.
- **فهرست `/announcements`** اعلامیه‌هایی را نشان می‌دهد که `showAnnouncementAt` آن‌ها در **Show Announcement History (in days)** (`showAnnouncementHistoryInDays`، پیش‌فرض ۱۴) می‌افتد، سپس در سمت کلاینت به فعال و گذشته تقسیمشان می‌کند.

دو پیامد که برنامه‌ریزی برایشان می‌ارزد:

- **اعلامیه‌ای بدون تاریخ پایان هرگز منقضی نمی‌شود.** گزینه **End Showing Announcement At** را خالی بگذارید و بی‌پایان به صفحه نمای کلی سنجاق می‌ماند. روی هر چیزی که زمان‌بند دارد تاریخ پایانی بگذارید.
- **اعلامیه‌ای قدیمی اما هنوز فعال می‌تواند از فهرست ناپدید شود.** اگر بیش از `showAnnouncementHistoryInDays` پیش آغاز شده باشد، از `/announcements` می‌افتد در حالی که روی نمای کلی می‌ماند. اگر اطلاعیه‌های طولانی‌مدت نگه می‌دارید پنجره تاریخچه را بالا ببرید.

اینکه اصلاً اعلامیه‌ها پدیدار شوند یا نه با کارت **Announcement Settings** روی **Advanced Settings** کنترل می‌شود: **Show Announcements** (`showAnnouncementsOnStatusPage`، پیش‌فرض درست) و **Show Announcement History (in days)** (پیش‌فرض ۱۴). با خاموش بودن **Show Announcements**، نقطه پایانی اعلامیه‌ها درخواست را یکسره رد می‌کند.

## قالب‌های اعلامیه

اگر مدام همان نوع اطلاعیه را منتشر می‌کنید — یادآوری ماهانه نگهداری، تنزل تکرارشونده شخص ثالثی — از پیش قوطی‌اش کنید. بخش **Status Pages → Settings → Announcement Templates** مدل `StatusPageAnnouncementTemplate` را ذخیره می‌کند، و فرمش **Template Name**، **Template Description**، **Announcement Title**، **Description**، **Show announcement on these status pages**، **Monitors affected (Optional)** و **Notify Subscribers** را می‌پرسد، پس پخش و تصمیم اعلان یک بار گرفته می‌شوند نه هر بار.

## مشترکان وب‌هوک و محافظت در برابر SSRF

مشترکان وب‌هوک در هر رویداد صفحه وضعیت درخواستی `POST` از نوع JSON می‌گیرند، که آن‌ها را به آسان‌ترین راه لوله‌کشی به‌روزرسانی‌های صفحه وضعیت به سامانه خودتان تبدیل می‌کند — یک چت‌بات، داشبوردی داخلی، صفی از تیکت‌ها.

چون مشترک شدن عملیاتی عمومی روی صفحه‌ای عمومی است، OneUptime از هدف محافظت می‌کند:

- **Webhook URL** عمومی پیش از پذیرفته شدن اعتبارسنجی می‌شود، و نشانی‌های خصوصی، بازگشتی، محلی-پیوند و فراداده ابری رد می‌شوند. نمی‌توانید اشتراکی را به چیزی درون شبکه خود استقرار OneUptime نشانه بگیرید.
- **Slack Incoming Webhook URL** باید با `https://hooks.slack.com/services/` آغاز شود.

اگر اشتراک وب‌هوکی هنگام ثبت‌نام رد شود، نشانی داخلی یا بدشکل نخستین چیزی است که باید بررسی کنید.

## در ادامه چه بخوانیم

- [نمای کلی صفحه‌های وضعیت](/docs/status-pages/index) — صفحه وضعیت چیست و چگونه سرهم می‌شود.
- [منابع و گروه‌های صفحه وضعیت](/docs/status-pages/resources-and-groups) — مانیتورها و گروه‌هایی که مشترکان می‌توانند میانشان برگزینند.
- [برندسازی و دامنه‌های صفحه وضعیت](/docs/status-pages/branding-and-domains) — دامنه سفارشی، نشان‌ها و ظاهر صفحه‌ای که ایمیل‌هایتان به آن پیوند می‌دهند.
- [API عمومی](/docs/status-pages/public-api) — خواندن برنامه‌نویسانه داده صفحه وضعیت.
- [وضعیت‌ها و شدت‌های حادثه](/docs/incidents/states-and-severities) — چه چیزی حادثه‌ای را روی صفحه وضعیت می‌گذارد و چه چیزی برش می‌دارد.
- [تنظیمات و خودکارسازی حادثه](/docs/incidents/settings) — قواعد سطح پروژه پشت ارتباط حادثه.
