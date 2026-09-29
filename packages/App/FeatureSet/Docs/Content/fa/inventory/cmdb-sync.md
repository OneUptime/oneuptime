# صادر کردن موجودی به یک CMDB

## نمای کلی

اگر از پیش CMDB یا دفتر ثبت دارایی‌ای اجرا می‌کنید، OneUptime نمی‌کوشد جایش را بگیرد. آنچه OneUptime دارد و CMDB معمولاً ندارد، تصویری پیوسته مشاهده‌شده از آن چیزی است که واقعاً در حال اجراست — کشف‌شده از تله‌متری و از پیمایشگرهایی که از پیش شبکه و حساب‌های ابری شما را می‌پایند، و بدون اینکه کسی نگهش دارد تازه می‌شود.

این صفحه دستور کار کشیدن آن تصویر به سامانه ثبت خودتان است.

## چه می‌توانید بکشید

سه منبع REST، همه با نقطه‌های پایانی استاندارد CRUD:

| منبع | نقطه پایانی | چه نگه می‌دارد |
| -------- | -------- | ------------- |
| آیتم موجودی | `/api/inventory-item` | یک سطر به ازای هر چیزی در املاک |
| تعریف فیلدهای سفارشی | `/api/inventory-item-custom-field` | واژگان فیلد خود پروژه شما |
| روابط | `/api/inventory-item-relationship` | یال‌های جهت‌دار میان آیتم‌ها |

ستون‌های مفید روی یک آیتم موجودی:

| ستون | معنا |
| ------ | ------- |
| `_id` | شناسه OneUptime — به‌عنوان ارجاع بیرونی‌تان به کارش ببرید |
| `entityType` | `host`، `k8s.pod`، `network.device`، `appliance`، … |
| `entityKey` | درهم‌سازی پایدار هویت. از تغییر نام جان به در می‌برد، پس کلید هم‌بستگی بهتری است |
| `displayName` | نام خوانا برای انسان |
| `source` | `discovered`، `inventory` یا `manual` |
| `description` | متن آزاد |
| `identifyingAttributes` | مجموعه ویژگی تغییرناپذیری که هویت این چیز را تعریف می‌کند |
| `descriptiveAttributes` | فراداده مشاهده‌شده تغییرپذیر — برچسب ایمیج، نسخه، IP |
| `customFields` | فیلدهای خودتان، کلیدخورده بر پایه نام فیلد |
| `resourceType` / `resourceId` | اشاره‌گر به رکورد غنی‌تر OneUptime، وقتی وجود داشته باشد |
| `firstSeenAt` / `lastSeenAt` | پنجره مشاهده |
| `isArchived` | اینکه از فهرست زنده بیرون برده شده یا نه |

## احراز هویت

زیر **Project Settings → API Keys** کلید APIای بسازید و به آن **Read Telemetry Service** بدهید. موجودی به‌جای داشتن خانواده دسترسی خودش، خانواده دسترسی تله‌متری را بازاستفاده می‌کند، پس همان یک دسترسی چیزی است که صادرات فقط‌خواندنی لازم دارد.

آن را به‌صورت دو هدر بفرستید:

```
apikey: <your-api-key>
projectid: <your-project-id>
```

## کشیدن فهرست

به نقطه پایانی فهرست با ستون‌هایی که می‌خواهید `POST` کنید. فیلد `select` الزامی است — API فقط آنچه را می‌خواهید برمی‌گرداند.

```bash
curl -X POST 'https://oneuptime.com/api/inventory-item/get-list' \
  -H 'apikey: YOUR_API_KEY' \
  -H 'projectid: YOUR_PROJECT_ID' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": { "isArchived": false },
    "select": {
      "_id": true,
      "entityType": true,
      "entityKey": true,
      "displayName": true,
      "source": true,
      "customFields": true,
      "descriptiveAttributes": true,
      "lastSeenAt": true
    },
    "sort": { "displayName": "ASC" },
    "limit": 100,
    "skip": 0
  }'
```

با افزایش `skip` صفحه‌بندی کنید تا وقتی سطرهای کمتری از `limit` خود بگیرید.

### فقط دستگاه‌های شبکه

با `entityType` تنگ کنید:

```bash
curl -X POST 'https://oneuptime.com/api/inventory-item/get-list' \
  -H 'apikey: YOUR_API_KEY' \
  -H 'projectid: YOUR_PROJECT_ID' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": { "entityType": "network.device", "isArchived": false },
    "select": { "_id": true, "entityKey": true, "displayName": true, "customFields": true },
    "limit": 100,
    "skip": 0
  }'
```

جزئیات سخت‌افزاری کشف‌شده — فروشنده، مدل، شماره سریال، سفت‌افزار، سایت — روی خود رکورد Network Device زندگی می‌کند. برای آن `resourceId` را تا `/api/network-device/:id/get-item` دنبال کنید، یا مستقیم `/api/network-device/get-list` را بکشید.

### به‌صورت CSV

هر نقطه پایانی فهرستی با `?output-type=csv` به‌جای JSON، ‏CSV برمی‌گرداند:

```bash
curl -X POST 'https://oneuptime.com/api/inventory-item/get-list?output-type=csv' \
  -H 'apikey: YOUR_API_KEY' \
  -H 'projectid: YOUR_PROJECT_ID' \
  -H 'Content-Type: application/json' \
  -d '{ "query": {}, "select": { "displayName": true, "entityType": true, "customFields": true }, "limit": 500, "skip": 0 }' \
  -o inventory.csv
```

فهرست موجودی در داشبورد به همین شکل صادر می‌کند، از جمله هر ستون فیلد سفارشی‌ای که روشن کرده‌اید.

## هم‌بسته کردن با CMDB شما

از **`entityKey`** استفاده کنید، نه `displayName`. درهم‌سازی ویژگی‌های شناسه‌بخش آن چیز است، پس از تغییر نام و بازبرچسب‌گذاری جان به در می‌برد — میزبانی که برچسبش عوض می‌شود همان کلید را نگه می‌دارد، در حالی که نام نمایشی‌اش تغییر می‌کند. مقدار `_id` به همان اندازه پایدار است و اگر همیشه فقط با یک پروژه حرف می‌زنید ساده‌ترین کلید خارجی است.

تاریخ‌ها در `customFields` رشته‌های ISO-8601 با منطقه UTC هستند، و صادرات CSV آن‌ها را به همان شکل می‌نویسد نه به شکل انسانی‌شده‌ای که در رابط کاربری نشان داده می‌شود، پس بدون شگفتی تفکیک وارد می‌شوند.

## تازه نگه داشتنش

خوراک تغییری وجود ندارد. نقطه پایانی فهرست را با هر فاصله‌ای که مناسبتان است پیمایش کنید و روی `entityKey` تفاوت بگیرید. فیلد `lastSeenAt` به شما می‌گوید چیزی آخرین بار کی مشاهده شده، که معمولاً ارزان‌ترین راه یافتن آن چیزی است که از اجرای پیشین شما ساکت شده است.

سطرهایی که میان اجراها ناپدید می‌شوند یا کهنه شده‌اند (آیتمی کشف‌شده که از پنجره نگهداشتش هم ساکت‌تر مانده) یا رکورد مالکشان حذف شده است. سطرهایی که مقادیر فیلد سفارشی حمل می‌کنند به‌جای حذف بایگانی می‌شوند، پس اگر می‌خواهید ببینید چه چیزی بازنشسته شده بدون از دست دادن داده دارایی پیوستش، با `"isArchived": true` پرس‌وجو کنید.

## بازنویسی

همان نقطه‌های پایانی نوشتن هم می‌پذیرند، پس یکپارچه‌سازی‌ای می‌تواند مقادیری را به `customFields` بفرستد — برای نمونه مهر زدن برچسب دارایی‌ای که CMDB شما از پیش مالکش است روی آیتم متناظر در OneUptime. برای این کار به کلید **Edit Telemetry Service** بدهید.

می‌توانید برای چیزهایی که OneUptime نمی‌تواند ببیندشان هم آیتم بسازید، با `POST /api/inventory-item` و `entityType` برابر `external.service`، `external.database` یا `appliance`، به‌علاوه یک `displayName`. OneUptime کلید هویت را برایتان مشتق می‌کند؛ آن سطرها هرگز منقضی نمی‌شوند.
