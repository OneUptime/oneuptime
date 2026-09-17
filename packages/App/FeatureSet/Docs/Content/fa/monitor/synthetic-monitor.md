# مانیتور مصنوعی

مانیتورینگ مصنوعی راهی برای زیر نظر گرفتن پیش‌دستانه برنامه‌هایتان با شبیه‌سازی تعامل کاربر است. می‌توانید مانیتوری مصنوعی بسازید تا دسترس‌پذیری و کارایی برنامه‌هایتان را از جاهای مختلف دنیا بررسی کند.

#### نمونه

نمونه زیر نشان می‌دهد چگونه از یک مانیتور مصنوعی استفاده کنید:

```javascript
// Objects available in the context of the script are:

// - axios: Axios module to make HTTP requests
// - page: OneUptime's secure Playwright-compatible page facade
// - browserType: Browser type in the current run context - Chromium or Firefox
// - screenSizeType: Screen size type in the current run context - Mobile, Tablet, Desktop

// You can use these objects to interact with the browser and make HTTP requests.

await page.goto("https://playwright.dev/");

// The commonly used Page, Locator, Frame, and BrowserContext APIs are supported.

// Here are some of the variables that you can use in the context of the monitored object:

console.log(browserType); // This will list the browser type in the current run context - Chromium or Firefox

console.log(screenSizeType); // This will list the screen size type in the current run context - Mobile, Tablet, Desktop

// Playwright page object belongs to that specific browser context, so you can use it to interact with the browser.

// To take screenshots, assign them to the `screenshots` object that is provided
// in the script context. Screenshots captured this way are preserved even if the
// script later throws — useful for debugging failed runs.

screenshots["screenshot-name"] = await page.screenshot(); // you can save multiple screenshots and have them with different names.

// when you want to return a value, use return statement with data as a prop.

// To log data, use console.log
// console.log('Hello World');

// You can access the browser context via page.context() if needed (for example, to create a new page or dealing with popups).

return {
  data: "Hello World",
};
```

### استفاده از Playwright

ما برای شبیه‌سازی تعامل کاربر از Playwright استفاده می‌کنیم. مقدار `page` نمایی امن و سازگار با Playwright برای صفحه‌ای است که برای این اجرا ساخته شده است. متدهای رایج `Page`، `Locator`، `Frame`، `ElementHandle`، `JSHandle`، `Request`، `Response`، صفحه‌کلید، ماوس و بافتار مرورگر در دسترس‌اند. این شامل پیمایش، مکان‌یاب‌ها، کلیک‌ها، ورودی فرم، ارزیابی صفحه، پاپ‌آپ‌ها، صفحه‌های اضافی، بازرسی پاسخ و عکس صفحه است.

اسکریپت‌های مصنوعی درون فرایند Node.js پروب اجرا نمی‌شوند. مقادیر به‌صورت داده کپی‌شده یا قابلیت‌های مبهم و محدود به اجرا از مرز زمان اجرا می‌گذرند. APIهایی که از آن مرز می‌گریزند عمداً در دسترس نیستند: متدهای راه‌اندازی یا اتصال مرورگر، نشست‌های CDP، مسیردهی درخواست، اتصال‌های در معرض قرارگرفته، فیلدهای خصوصی Playwright، و هر گزینه‌ای که مسیری از سامانه فایل میزبان را می‌خواند یا می‌نویسد. بنابراین `page.context().browser()` در دسترس نیست. توابع ارزیابی که به متدهایی مانند `page.evaluate()` داده می‌شوند در صفحه مرورگر زیر نظر اجرا می‌شوند، هرگز در فرایند پروب.

هر اجرا می‌تواند تا هشت صفحه به کار ببرد. عکس تمام‌صفحه و خروجی PDF در دسترس نیستند؛ عکس دیدگاه همچنان پشتیبانی می‌شود و رفتار نگهداری شواهد شکست را که پایین‌تر توضیح داده شده حفظ می‌کند.

گزاره‌های تابعی برای متدهای انتظار رویداد، درخواست، پاسخ و نشانی از مرز ایزوله‌سازی نمی‌گذرند. به‌جایش از تطبیق‌دهنده‌های رشته‌ای یا عبارت باقاعده، مکان‌یاب‌ها، یا نظرسنجی صریح استفاده کنید.

شنونده‌های رویداد Playwright (`page.on(...)`، `page.once(...)`) هم نمی‌توانند از مرز ایزوله‌سازی بگذرند و فراخوانی‌شان با خطایی روشن شکست می‌خورد. برای گفت‌وگوها و پاپ‌آپ‌ها از `page.waitForEvent(...)` استفاده کنید، یا از انتظار پاسخ و درخواست با تطبیق‌دهنده‌های رشته‌ای یا عبارت باقاعده. دسترسی‌های همگام به فریم (`page.frames()`، `page.mainFrame()`، `page.frame(...)`) و `page.request.*` هم در دسترس نیستند — برای iframeها از `page.frameLocator(...)` و برای درخواست‌های HTTP از سراسری `axios` استفاده کنید. متدهای `page.waitForNavigation(...)`، `page.setDefaultTimeout(...)` و `page.setDefaultNavigationTimeout(...)` پشتیبانی می‌شوند.

داده بازگشتی از اسکریپت پیش از ذخیره شدن به JSON سریال می‌شود: در اشیا و آرایه‌های ساده، `NaN` و `Infinity` به `null` تبدیل می‌شوند، ویژگی‌های `undefined` و توابع کنار گذاشته می‌شوند، و اشیای `Date` به رشته‌های ISO تبدیل می‌شوند — همان‌گونه که `JSON.stringify` با آن‌ها رفتار می‌کند. نمونه‌های کلاس و دیگر اشیای غیرساده کلاً کنار گذاشته می‌شوند.

دسترسی‌های مرورگر به موقعیت جغرافیایی و اعلان‌ها محدود است. دسترسی‌های تخته‌گیره، دوربین، میکروفن، MIDI، قلم‌های محلی و دیگر دستگاه‌های میزبان برای اسکریپت‌های مانیتور در دسترس نیستند.

### عکس‌های صفحه

شیئی از پیش اعلام‌شده به نام `screenshots` در بافتار اسکریپت در دسترس است. در هر نقطه‌ای از اسکریپت عکس‌ها را به آن تخصیص دهید — این عکس‌ها **حتی اگر اسکریپت خطا پرتاب کند** ثبت می‌شوند (از جمله شکست ادعاها، اتمام مهلت‌ها یا خطاهای غیرمنتظره)، پس می‌توانید ببینید هنگام شکست اجرا صفحه دقیقاً چه شکلی بوده است. عکس‌های ثبت‌شده در داشبورد OneUptime برای همان اجرای مانیتور پدیدار می‌شوند.

```javascript
// Capture screenshots via the `screenshots` side-channel — they are preserved on both success and failure.

await page.goto("https://app.example.com/login");
screenshots["login-page"] = await page.screenshot();

await page.fill("#email", "user@example.com");
await page.fill("#password", "wrong");
await page.click("button[type=submit]");

// If the next assertion throws, the `login-page` screenshot above is still captured.
await page.waitForSelector(".dashboard", { timeout: 5000 });

screenshots["dashboard"] = await page.screenshot();

return {
  data: "Login succeeded",
};
```

#### برگرداندن عکس‌ها (قدیمی)

برای سازگاری با گذشته، می‌توانید عکس‌ها را به‌عنوان بخشی از مقدار بازگشتی از اسکریپت هم برگردانید. عکس‌هایی که این‌گونه برگردانده می‌شوند **فقط** وقتی ثبت می‌شوند که اسکریپت عادی کامل شود — اگر اسکریپت خطا پرتاب کند از دست می‌روند. وقتی شواهد شکست می‌خواهید، الگوی کانال جانبی بالا را ترجیح دهید.

```javascript
// Legacy pattern — screenshots only captured on successful return.
const screenshots = {};
screenshots["screenshot-name"] = await page.screenshot();

return {
  data: "Hello World",
  screenshots: screenshots,
};
```

### استفاده از اسرار مانیتور

#### افزودن یک راز

برای افزودن راز، لطفاً به داشبورد OneUptime → Monitors → Settings → Secrets → Create Monitor Secret بروید.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

می‌توانید برگزینید کدام مانیتورها به راز دسترسی داشته باشند. در این حالت راز `ApiKey` را افزودیم و مانیتورهایی را برای دسترسی به آن برگزیدیم.

**لطفاً توجه کنید**: اسرار رمزگذاری و امن ذخیره می‌شوند. اگر رازی را گم کنید، باید راز تازه‌ای بسازید. پس از ذخیره نمی‌توانید راز را ببینید یا به‌روزرسانی کنید.

#### استفاده از یک راز

برای استفاده از اسرار مانیتور در اسکریپت، می‌توانید در بافتار اسکریپت از شیء `monitorSecrets` استفاده کنید. با آن می‌توانید به اسراری که به مانیتور افزوده‌اید دسترسی داشته باشید.

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

### سنجه‌های سفارشی

می‌توانید با تابع `oneuptime.captureMetric()` سنجه‌های سفارشی را از اسکریپتتان ثبت کنید. این سنجه‌ها در OneUptime ذخیره می‌شوند و می‌توان با Metric Explorer روی داشبوردها ترسیمشان کرد.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (رشته، الزامی): نام سنجه (برای نمونه `"dashboard.load.time"`). به‌طور خودکار با پیشوند `custom.monitor.` ذخیره می‌شود.
- `value` (عدد، الزامی): مقدار عددی سنجه.
- `attributes` (شیء، اختیاری): جفت‌های کلید-مقدار برای زمینه بیشتر.

#### نمونه

```javascript
await page.goto("https://app.example.com");

const startTime = Date.now();
await page.waitForSelector("#dashboard-loaded");
const loadTime = Date.now() - startTime;

// Capture page load time as a custom metric
oneuptime.captureMetric("dashboard.load.time", loadTime, {
  page: "dashboard",
});

screenshots["dashboard"] = await page.screenshot();

return {
  data: { loadTime },
};
```

پس از ثبت، این سنجه‌ها در Metric Explorer با نام‌هایی مانند `custom.monitor.dashboard.load.time` پدیدار می‌شوند. می‌توانید آن‌ها را به نمودارهای داشبورد بیفزایید، هشدار برپا کنید، و بر پایه مانیتور، پروب، نوع مرورگر، اندازه صفحه یا هر ویژگی سفارشی‌ای که داده‌اید بپالایید.

**محدودیت‌ها:**

- بیشینه ۱۰۰ سنجه به ازای هر اجرای اسکریپت.
- نام سنجه به ۲۰۰ نویسه محدود است.
- مقادیر باید عددی باشند.

### ماژول‌های در دسترس در اسکریپت

- `page`: نمایی امن و سازگار با Playwright برای تعامل با مرورگر. می‌توانید از راه `page.context()` به بافتار مرورگر اجرا دسترسی داشته باشید تا صفحه بسازید یا با پاپ‌آپ‌ها کار کنید، اما راه‌اندازی/اتصال مرورگر، CDP، مسیردهی، اتصال‌ها، فیلدهای خصوصی و گزینه‌های مسیر میزبان در دسترس نیستند.
- `screenshots`: شیئی از پیش اعلام‌شده که عکس‌ها را به آن تخصیص می‌دهید (برای نمونه `screenshots['login-page'] = await page.screenshot()`). عکس‌های تخصیص‌یافته اینجا حتی اگر اسکریپت بعداً خطا پرتاب کند ثبت می‌شوند.
- `axios`: کلاینتی HTTP مبتنی بر promise که از Axios قابل فراخوانی به‌علاوه `request`، `get`، `head`، `options`، `post`، `put`، `patch`، `delete` و `create` پشتیبانی می‌کند. محدودیت‌های اندازه درخواست، اندازه پاسخ، هدایت و مهلت اعمال می‌شوند؛ حامل‌ها، آداپتورها، سوکت‌ها، عامل‌ها و بازنویسی‌های پراکسی سفارشی در دسترس نیستند.
- `crypto`: پیاده‌سازی کارگر مرورگری از درهم‌سازهای SHA-256، ‏HMAC-SHA-256، ‏`randomBytes`، `randomInt` و `randomUUID`.
- `console.log`: می‌توانید با این ماژول داده را در کنسول گزارش کنید. برای اشکال‌زدایی مفید است.
- `oneuptime.captureMetric`: می‌توانید با این، سنجه‌های سفارشی را از اسکریپتتان ثبت کنید. بخش سنجه‌های سفارشی بالا را ببینید.
- `http`: نمایی بافرشده و فقط-کلاینت برای سازگاری که از `request`، `get` و `Agent` پشتیبانی می‌کند.
- `https`: معادل HTTPS برای نمای فقط-کلاینت `http`.

### چیزهایی که باید در نظر بگیرید

- شیء `page` رابط اصلی تعامل با مرورگر است. عمداً سطحی از Playwright با فهرست مجاز را پیاده می‌کند به‌جای اینکه اشیای خام Playwright یا Node.js را در معرض بگذارد.
- می‌توانید با `console.log` داده را در کنسول گزارش کنید. این در بخش گزارش‌های مانیتور در دسترس خواهد بود.
- می‌توانید با دستور `return` داده را از اسکریپت برگردانید. عکس‌ها را به شیء `screenshots` داده‌شده تخصیص دهید تا حتی اگر اسکریپت خطا پرتاب کند حفظ شوند.
- می‌توانید با متغیرهای `browserType` و `screenSizeType` نوع مرورگر و نوع اندازه صفحه را در بافتار اجرای جاری بگیرید. اگر دوست دارید در اسکریپتتان به کارشان ببرید.
- این اسکریپتی JavaScript است، پس می‌توانید همه قابلیت‌های JavaScript را در آن به کار ببرید.
- می‌توانید با ماژول `axios` در اسکریپت درخواست HTTP بفرستید. با آن می‌توانید از اسکریپت فراخوان API انجام دهید.
- اگر از oneuptime.com استفاده می‌کنید، همیشه آخرین نسخه Playwright و مرورگرها در بافتار اسکریپت در دسترستان خواهد بود. اگر خودمیزبان هستید، لطفاً مطمئن شوید پروب‌ها را به‌روز می‌کنید تا آخرین نسخه Playwright و مرورگرها را داشته باشند.
- مهلت پیش‌فرض اسکریپت ۶۰ ثانیه است و اپراتور پروب می‌تواند پیکربندی‌اش کند. کارگرهای مهلت‌گذشته و همه فرزندان مرورگرشان خاتمه می‌یابند.
- هر اجرا حافظه و ذخیره‌سازی قابل نوشتن مرورگر محدودی دارد. گذشتن از هرکدام آن اجرا را خاتمه می‌دهد و نمایه موقتش را حذف می‌کند؛ اپراتورهای خودمیزبان می‌توانند این سقف‌ها را روی پروب پیکربندی کنند.
