# یکپارچه‌سازی Jira

هر بار که حادثه‌ای در OneUptime اعلام می‌شود یک issue در [Jira](https://www.atlassian.com/software/jira) باز کنید، همگام با حرکت حادثه به‌روزش نگه دارید، و بگذارید Jira تغییرهای وضعیت را به OneUptime پس بفرستد — همه‌اش با یک [گردش کاری](/docs/workflows/index). بلوکی ویژه Jira برای نصب در کار نیست: OneUptime با [مؤلفه API](/docs/workflows/components#api) به API REST مربوط به Jira فراخوان می‌زند، و Jira به یک [تریگر وب‌هوک](/docs/workflows/triggers#webhook) فراخوان بازگشتی می‌دهد.

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

این صفحه هر دو سو را می‌سازد. هر چیزی تا بخش ورودی برای **Jira Cloud** نوشته شده است؛ بخشی نزدیک پایان فهرست می‌کند چه چیزی روی **Jira Data Center** فرق می‌کند.

> Atlassian دارد چیزها را در Jira Cloud بازنام‌گذاری می‌کند: در بیشتر رابط کاربری، **project** حالا **space** است و **issue** شده **work item**. مستأجرها روی هر دو واژگان‌اند، پس هرجا پایین‌تر واژه‌ها مهم باشند هر دو را می‌یابید.

## پیش‌نیازها

- سایتی از Jira Cloud (`https://your-domain.atlassian.net`) و پروژه‌ای که issueها در آن ثبت شوند. **project key** آن را یادداشت کنید — همان `OPS` در `OPS-1234`.
- حساب Jiraای که بتواند در آن پروژه issue بسازد، و یک **API token** برایش از [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). به‌جای حساب یک شخص، حساب سرویس به کار برید — issueهایی که این‌گونه ساخته می‌شوند به مالک توکن منتسب می‌شوند.
- دسترسی ساخت قواعد خودکارسازی در آن پروژه، برای نیمه ورودی.
- پروژه‌ای در OneUptime که در آن بتوانید گردش کاری و متغیر سراسری بسازید.

## گام ۱ — ذخیره اعتبارنامه‌های Jira به‌عنوان راز

API REST مربوط به Jira Cloud احراز هویت **Basic** می‌گیرد که از ایمیل حساب Atlassian شما و یک توکن API ساخته می‌شود و با هم base64 می‌شوند.

1. یک بار `email:api_token` را رمزگذاری کنید:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   از `printf` استفاده کنید، نه `echo`. ‏`echo` یک خط جدید می‌افزاید، آن خط جدید همراه باقی چیزها رمزگذاری می‌شود، و Jira به دلایلی که در رشته چسبانده‌شده شما نامرئی‌اند پاسخ `401` می‌دهد.

2. در OneUptime به **Workflows → Global Variables → Create** بروید. نامش را `JIRA_AUTH` بگذارید، رشته base64 را به‌عنوان **Content** بچسبانید، و **Secret** را روشن کنید.
3. متغیر دومی، غیرمحرمانه، به نام `JIRA_URL` بیفزایید که `https://your-domain.atlassian.net` را بدون اسلش پایانی نگه می‌دارد.

حالا هر بلوکی می‌تواند `Basic {{global.variables.JIRA_AUTH}}` را به‌عنوان هدر `Authorization` خود به کار برد، و توکن هرگز در گردش کاری یا گزارش‌های اجرای آن پدیدار نمی‌شود. [متغیرها](/docs/workflows/variables) را ببینید.

دو نکته درباره توکن‌های API مربوط به Atlassian که سرانجام یقه یکپارچه‌سازی‌ای را که کسی حواسش به آن نیست می‌گیرند:

- **منقضی می‌شوند.** توکن‌ها با طول عمر یک روز تا یک سال ساخته می‌شوند، به‌طور پیش‌فرض یک سال، و تازه‌سازی‌ای در کار نیست — توکن منقضی باید دستی در همان صفحه جایگزین و دوباره در `JIRA_AUTH` رمزگذاری شود. تاریخ انقضا را جایی در تقویمی بگذارید. وقتی گردش کاری‌ای که ماه‌ها کار کرده شروع به پاسخ دادن `401` می‌کند، دلیلش همین است.
- **توکن دامنه‌دار نشانی پایه دیگری می‌خواهد.** صفحه توکن علاوه بر **Create API token** کلاسیک، **Create API token with scopes** را هم پیشنهاد می‌دهد. توکن‌های دامنه‌دار گزینه امن‌ترند، اما نشانی‌شان سایت شما نیست: به `https://api.atlassian.com/ex/jira/<cloudId>` می‌روند، پس `JIRA_URL` به‌جایش همان می‌شود، و هر مسیری پایین‌تر بدون تغییر از آن آویزان می‌شود. مقدار `cloudId` شما در JSONای است که در `https://your-domain.atlassian.net/_edge/tenant_info` نشسته. توکن دامنه‌داری که به `your-domain.atlassian.net` فرستاده شود صرفاً شکست می‌خورد.

اگر سازمان شما روی مدیریت متمرکز کاربر در Atlassian است، گزینه سومی هست که مسئله انقضا را دور می‌زند: [اعتبارنامه OAuth 2.0 برای حساب سرویس](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/). به‌جای توکن، شناسه و راز کارخواه به شما می‌دهد، و گردش کاری در آغاز هر اجرا آن‌ها را با توکن دسترسی کوته‌عمری معاوضه می‌کند — همان شکل دوبلوکی‌ای که صفحه [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) به کار می‌برد، با بلوکی از نوع **API Post (JSON)** که توکن را می‌گیرد و هر چیزی پس از آن `Bearer <token>` می‌فرستد. هیچ‌چیزی لازم نیست یک سال بعد دستی جایگزین شود. صفحه Atlassian درخواست توکن را دقیق دارد؛ نشانی پایه API برابر `https://api.atlassian.com` است.

## گام ۲ — باز کردن یک issue در Jira برای هر حادثه

1. **Workflows → Create Workflow** را باز کنید، نامش را `Incidents → Jira` بگذارید، و **Builder** را باز کنید.
2. روی بلوک جانگهدار خط‌چین کلیک کنید و تریگر **On Create Incident** را بیفزایید. در **Select Fields** آن، ستون‌هایی را که می‌خواهید بفرستید بخواهید:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   مقدار **Identifier** آن را همان `incident-on-create-1` بگذارید — این همان نامی است که بلوک‌های بعدی با آن به آن ارجاع می‌دهند.

3. روی **Add Component** کلیک کنید، بلوکی از نوع **API Post (JSON)** بیفزایید، و از نقطه **Success** تریگر به نقطه ورودی بلوک تازه بکشید. بازش کنید، **Identifier** آن را `create-issue` بگذارید، و پرش کنید:

   - **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**:

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**:

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   مقدار `OPS` را با project key خودتان و `Bug` را با نوع issueای که در آن پروژه وجود دارد جایگزین کنید. هر دو را می‌توان با شناسه هم داد — `{"id": "10000"}` — که همان چیزی است که نمونه‌های خود Atlassian به کار می‌برند و اگر دو نوع issue در سایتتان هم‌نام باشند باید ترجیحش دهید. فراخوان‌های `createmeta` پایین‌تر همان شناسه‌ها را به دستتان می‌دهند.

توضیح سنگین به نظر می‌رسد چون API نسخه v3 در Jira Cloud متن غنی را به‌صورت **Atlassian Document Format** می‌گیرد — درختی از سند، نه رشته‌ای. شکل بالا کمینه سند معتبر است: یک پاراگراف که یک گره متنی را نگه می‌دارد. همین درباره `environment` و هر فیلد سفارشی متنی چندخطی صدق می‌کند؛ فیلدهای سفارشی متنی تک‌خطی هنوز رشته ساده می‌گیرند.

حالا گردش کاری را از **Overview → Edit Workflow → Enabled** روشن کنید، حادثه‌ای آزمایشی اعلام کنید، و **Runs & Logs** را باز کنید. بلوک `create-issue` باید `201` و بدنه‌ای شامل `id`، `key` و `self` مربوط به issue تازه نشان دهد. تغییرهای روی بوم خودشان را ذخیره می‌کنند — دکمه Save در کار نیست، و گردش کاری غیرفعال اصلاً نمی‌تواند اجرا شود، حتی دستی.

کلید issue تازه برای هر بلوکی پس از این در دسترس است:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### پر کردن فیلدهای بیشتر

چند افزودنی رایج درون `fields`:

- **Priority** — ‏`"priority": { "id": "20000" }`، با شناسه اولویتی از سایت خودتان. برای نگاشتن شدت‌های OneUptime روی اولویت‌های Jira، بلوکی از نوع **If / Else** میان تریگر و بلوک API بگذارید و روی `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` شاخه بزنید.
- **Assignee** — ‏`"assignee": { "id": "<accountId>" }`. ‏Jira Cloud افراد را با شناسه حساب Atlassian می‌شناسد؛ `username` و `userKey` سال‌ها پیش از API ابری برداشته شدند.
- **Labels** — ‏`"labels": ["oneuptime", "sev1"]`، آرایه‌ای تخت از رشته‌ها. برچسب‌ها نمی‌توانند فاصله داشته باشند.
- **Components** — ‏`"components": [{ "id": "10000" }]`.
- **Custom fields** — ‏`"customfield_10034": "..."`، با شناسه خودِ فیلد. شکل مقدار از نوع فیلد پیروی می‌کند: تک‌گزینه‌ای `{"value": "red"}` می‌گیرد، چندگزینه‌ای آرایه‌ای از شناسه‌ها، و فیلد متنی چندخطی سندی از نوع Atlassian Document Format.

برای یافتن اینکه پروژه‌ای واقعاً چه چیزی می‌خواهد، به‌جای حدس زدن از Jira بپرسید. نوع‌های issue در پروژه‌ای را فهرست کنید، سپس فیلدهای یکی از آن‌ها را:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

فراخوان دوم هر فیلدی را که آن نوع issue می‌پذیرد، اینکه کدامشان الزامی‌اند، و شناسه‌های دقیق `customfield_NNNNN` را فهرست می‌کند. برای خواندن شناسه‌ها از روی issueای که از پیش دارید، آن را با `?expand=names` بگیرید.

## گام ۳ — بردن شناسه حادثه به درون Jira

هر دو نیمه یک هم‌گام‌سازی دوسویه به این نیاز دارند که یکی از سامانه‌ها شناسه دیگری را نگه دارد، و Jira جای بهتری برای نگه داشتنش است: ستون `customFields` در OneUptime یک JSON یکپارچه و یگانه است، پس نوشتن یک مقدار از گردش کاری هر فیلد سفارشی روی آن حادثه را جایگزین می‌کند.

**با کمک مدیر Jira.** فیلد سفارشی متنی کوتاهی — نامش را *OneUptime Incident ID* بگذارید — به صفحه ساختِ آن پروژه بیفزایید، شناسه‌اش را با `createmeta` بیابید، و کنار باقی چیزها تنظیمش کنید:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**بدون او.** به‌جایش در برچسبی بگذاریدش. برچسب‌ها فاصله نمی‌گیرند، و شناسه OneUptime یک UUID ساده است، پس `oneuptime-<id>` برچسبی معتبر است:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

آنگاه گردش کاری ورودی باید آن برچسب را از فهرست بیرون بکشد، که چند خط در بلوکی از نوع **Run Custom JavaScript** است. اگر بتوانید فیلد سفارشی داشته باشید، مرتب‌تر است.

حالا که اینجایید، ارزشش را دارد که روی issue در Jira پیوندی به حادثه بگذارید. بلوکی از نوع **API Post (JSON)** پس از `create-issue`، نشانه‌رفته به `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`، با:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

به هر کسی در Jira مسیری یک‌کلیکی برای بازگشت می‌دهد. برای این کار `projectId` را به **Select Fields** تریگر بیفزایید. مقدار `globalId` همان چیزی است که تکرار فراخوان را بی‌خطر می‌کند: Jira به‌جای افزودن پیوندی دوم، پیوندی را که از پیش آن شناسه را حمل می‌کند به‌روز می‌کند. چون به‌روزرسانی هر چیزی را هم که جا بگذارید تهی می‌کند، همیشه کل `object` را بفرستید، نه وصله‌ای از آن.

## گام ۴ — دیدگاه گذاشتن و گذار دادن همگام با حرکت حادثه

این را به‌عنوان گردش کاری **دوم** بسازید، تا شکستی اینجا هرگز نتواند جلوی باز شدن issueها را بگیرد.

1. **Create Workflow** را بزنید، نامش را `Incident updates → Jira` بگذارید، و تریگر **On Update Incident** را بیفزایید.
2. در **Listen on** مقدار `{"currentIncidentStateId": true}` را بگذارید. آنگاه تریگر به‌جای هر ویرایشی فقط برای تغییرهای وضعیت شلیک می‌کند. در **Select Fields** مقدار `{"_id": true, "currentIncidentState": {"name": true}}` را بخواهید.
3. بلوکی از نوع **If / Else** بیفزایید: **Input 1** برابر `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`، **Operator** برابر `==`، **Input 2** برابر `Resolved` — یا هر نامی که وضعیت برطرف‌شده پروژه شما دارد. [وضعیت‌ها و شدت‌های حادثه](/docs/incidents/states-and-severities) را ببینید.

از شاخه **Yes** نخست باید issueای را که در گام ۲ باز کردید بیابید. با شناسه‌ای که در گام ۳ ذخیره کردید آن را از Jira بخواهید، با بلوکی از نوع **API Post (JSON)** که **Identifier** آن `find-issue` است:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  اگر به‌جای برچسب از فیلد سفارشی استفاده کرده‌اید، بند به `cf[10050] ~ \"...\"` با شناسه فیلد خودتان تبدیل می‌شود.

آنگاه شناسه issue برابر `{{local.components.find-issue.returnValues.response-body.issues[0].id}}` است، و هر نقطه پایانی پایین‌تر، شناسه را به همان راحتیِ کلید می‌پذیرد.

سه نکته درباره این نقطه پایانی ارزش دانستن دارند. **مقدار JQL را POST کنید، در نشانی نگذاریدش** — رشته پرس‌وجویی که درون مقداری `=` داشته باشد در راه بیرون رفتن از گردش کاری بریده می‌شود، و JQL چیزی جز نشانه `=` نیست. **پرس‌وجو باید کران‌دار باشد**: یک `order by key desc` برهنه با `400` رد می‌شود، و به همین دلیل بند `project =` آنجاست. و `/rest/api/3/search/jql` نقطه پایانی جاری است — `/rest/api/3/search` قدیمی‌تر منسوخ شده و رو به برچیده شدن است، پس سراغش نروید.

**گذاشتن دیدگاه** یک بلوک تنهای **API Post (JSON)** به `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment` است، با بدنه‌ای از نوع Atlassian Document Format درست مانند توضیح:

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**جابه‌جا کردن issue** دو فراخوان می‌گیرد، چون گذار با شناسه‌ای شناخته می‌شود که میان گردش‌های کاری Jira و، روی برخی تخته‌ها، میان issueها فرق می‌کند.

1. بلوکی از نوع **API Get (JSON)** روی `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` گذارهای در دسترس *از وضعیت کنونی issue* را برمی‌گرداند، هرکدام با یک `id` و یک `name`، و شیء `to`ای که وضعیت مقصد را نام می‌برد.
2. بلوکی از نوع **API Post (JSON)** به همان نشانی یکی را انجام می‌دهد:

   ```json
   { "transition": { "id": "31" } }
   ```

گذار موفق `204` بدون بدنه پاسخ می‌دهد. اگر ترجیح می‌دهید فهرست را هنگام اجرا نخوانید، یک بار دستی برای issueای در وضعیت درست فراخوانش کنید و شناسه را کدسخت کنید — فقط یادتان باشد به آن گردش کاری Jira گره خورده است، پس مدیری که گردش کاری Jira را ویرایش کند می‌تواند بی‌سروصدا خرابش کند.

## ورودی — از Jira به OneUptime

حالا سوی دیگر: کسی issue را به Done می‌برد، و حادثه OneUptime باید دنبالش برود.

### نخست گردش کاری گیرنده را بسازید

1. **Create Workflow** را بزنید، نامش را `Jira → OneUptime` بگذارید، و تریگر **Webhook** را بیفزایید.
2. مسیر **Settings** آن گردش کاری را باز کنید و **Webhook Secret Key** را کپی کنید. نشانی شما این است:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   نصب‌های خودمیزبان از میزبان خودشان استفاده می‌کنند. با این نشانی مثل گذرواژه رفتار کنید — هر کسی که آن را داشته باشد می‌تواند گردش کاری را شروع کند — و اگر لو رفت کلید را از همان صفحه بازنشانی کنید.

3. بلوکی از نوع **If / Else** بیفزایید که پیش از اجرای هر چیز دیگری رازی مشترک را بررسی کند. **Input 1** برابر `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}` است، **Operator** برابر `==`، و **Input 2** برابر `{{global.variables.JIRA_WEBHOOK_SECRET}}` — مقداری که خودتان ابداع می‌کنید و به‌عنوان متغیر سراسری محرمانه ذخیره می‌کنید.
4. از شاخه **Yes**، بلوکی از نوع **Update One Incident** بیفزایید:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: آنچه تغییر Jira باید اینجا معنا بدهد — معمولاً تغییری در وضعیت.

   جابه‌جا کردن حادثه به شناسه وضعیت مقصد نیاز دارد، که بلوکی از نوع **Find One Incident State** با پرس‌وجوی `{"name": "Resolved"}` آن را به‌صورت `{{local.components.incident-state-find-one-1.returnValues.model._id}}` به شما می‌دهد. آن را در `currentIncidentStateId` بنویسید.

گردش کاری را فعال بگذارید. حالا چیزی به Jira بدهید که فرا بخواند.

### رویداد را از قاعده خودکارسازی Jira بفرستید

1. در Jira، قواعد خودکارسازی پروژه را باز کنید: روی مستأجرهای تازه‌تر **Space settings → Automation**، روی قدیمی‌ترها **Project settings → Automation**. برای قاعده‌ای که چند پروژه را در بر می‌گیرد از **Settings → System → Global automation** استفاده کنید، که به دسترسی سراسری *Administer Jira* نیاز دارد.
2. **Create rule** را بزنید، و تریگر **Work item transitioned** را برگزینید — روی مستأجرهای قدیمی‌تر **Issue transitioned**. طوری تنظیمش کنید که وقتی وضعیت *به* **Done** می‌رود اجرا شود.

   از این تریگر استفاده کنید، نه *Work item updated*: تریگر به‌روزرسانی عمداً تغییرهای وضعیت را کنار می‌گذارد.

3. کنش **Send web request** را بیفزایید و پیکربندی‌اش کنید:

   - **Web request URL**: نشانی وب‌هوک OneUptime از بالا.
   - **HTTP method**: `POST`
   - **Headers**: ‏`Content-Type` / `application/json`، و `X-OneUptime-Secret` / راز مشترک شما. روی مقدار راز از گزینه **Hide** استفاده کنید تا ویرایشگران دیگرِ قاعده نتوانند بخوانندش — توجه کنید که پنهان‌سازی برای آن مقدار برگشت‌ناپذیر است، و مقادیر پنهان اگر قاعده خروجی گرفته یا تکثیر شود از دست می‌روند.
   - **Web request body**: مقدار **Custom format**، تا شکلش را خودتان کنترل کنید:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     اگر در گام ۳ به‌جای فیلد سفارشی از برچسب استفاده کرده‌اید، `"labels": "{{issue.labels}}"` را بفرستید و شناسه را سمت OneUptime با بلوکی از نوع **Run Custom JavaScript** بیرون بکشید.

4. قاعده را روشن کنید، issueای آزمایشی را به Done ببرید، و هر دو سو را بررسی کنید: گزارش ممیزی خود قاعده در Jira، و **Runs & Logs** در OneUptime.

نکته‌هایی که پیش از تکیه کردن بر این ارزش دانستن دارند:

- **درگاه مقصد محدود است.** کنش Send web request فقط به درگاه‌های ۸۰، ۸۰۸۰، ۴۴۳، ۶۰۱۷، ۸۴۴۳، ۸۴۴۴، ۷۹۹۰، ۸۰۹۰، ۸۰۸۵، ۸۰۶۰، ۸۹۰۰ و ۹۹۰۰ می‌رسد. ‏OneUptime Cloud روی ۴۴۳ است؛ نصبی خودمیزبان روی درگاهی نامتعارف را نمی‌توان این‌گونه فرا خواند.
- **امضای درخواست در کار نیست.** کنش گزینه HMAC ندارد، پس رازی مشترک در هدری روی HTTPS همان سازوکاری است که Atlassian مستند می‌کند. بررسی **If / Else** در گام ۳ گردش کاری گیرنده همان چیزی است که این را ارزشمند می‌کند.
- **اجراهای قاعده کنتور می‌خورند.** ‏Jira Cloud اجراهای موفق قاعده را در برابر سهمیه‌ای ماهانه می‌شمارد که به طرح شما بستگی دارد — ۱۰۰ روی Free، ۱۷۰۰ روی Standard، ۱۰۰۰ × کاربران روی Premium، و بی‌حد روی Enterprise. قاعده‌ای که در پروژه‌ای شلوغ روی هر گذاری شلیک کند روی هم جمع می‌شود.
- **مقادیر برایتان URL-encode نمی‌شوند.** این فقط وقتی مهم است که بدنه‌ای فرم‌رمزگذاری‌شده بفرستید؛ JSON بالا اشکالی ندارد.
- **Atlassian بازه‌های خروج خود را منتشر می‌کند** در [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com)، اگر نصب OneUptime شما پشت فهرست مجاز نشسته باشد. تغییر می‌کنند، پس به‌جای سنجاق کردن نشانی‌ها خوراک را پیمایش کنید.

### یا به‌جایش از وب‌هوک Jira استفاده کنید

مدیر Jira می‌تواند وب‌هوکی را مستقیم زیر **Settings → System → Advanced → WebHooks** ثبت کند، و رویدادهایی را که باید فرستاده شوند و اختیاراً پرس‌وجویی JQL که باریک کند کدام issueها آن را شلیک کنند برگزیند. در مقایسه با قاعده خودکارسازی:

- محموله از آنِ خود Jira است، نه شما: `webhookEvent`، `issue_event_type_name`، کل `issue`، و `changelog`ای که آرایه `items` آن پیش‌وپس هر فیلد تغییریافته را نگه می‌دارد. برای تغییر وضعیت، مدخلی را می‌خواهید که `field` آن `status` است. خواندن آن درون گردش کاری معمولاً یعنی بلوکی از نوع **Run Custom JavaScript**.
- وب‌هوک‌ها **می‌توانند** امضا شوند — به وب‌هوک رازی بدهید و Jira هدر `X-Hub-Signature` را می‌فرستد که HMACی از بدنه درخواست را نگه می‌دارد — اما گردش کاری نمی‌تواند بررسی‌اش کند. امضا دقیقاً همان بایت‌هایی را می‌پوشاند که Jira فرستاده است، و تریگر Webhook بدنه‌ای را به گردش کاری می‌دهد که از پیش به JSON تجزیه شده، پس چیزی برای درهم‌سازی نمی‌ماند. اگر می‌خواهید درخواست احراز هویت شود، به‌جایش از قاعده خودکارسازی با هدر راز مشترک استفاده کنید.
- نشانی باید HTTPS باشد روی درگاهی از فهرست خود Jira، که *همان* فهرستی نیست که کنش خودکارسازی به کار می‌برد — درگاه ۸۰ اینجا مجاز نیست.
- تحویل تا پنج بار با پس‌کشیدی پنج تا پانزده دقیقه‌ای دوباره تلاش می‌شود، پس گردش کاری شما باید تاب بیاورد که همان رویداد دو بار برسد.

وب‌هوک‌هایی که برنامه‌ای از راه `/rest/api/3/webhook` ثبت می‌کند باز چیز دیگری‌اند: مگر تازه‌سازی شوند، ۳۰ روز پس از ثبت منقضی می‌شوند. آن‌هایی که بالا مدیر ثبت می‌کند منقضی نمی‌شوند.

## Jira Data Center

‏Jira خودمدیریت با مشتی جایگزینی به همان شکل کار می‌کند. **Jira Server** در فوریه ۲۰۲۴ به پایان پشتیبانی رسید و هیچ رفعی نمی‌گیرد، پس Data Center را هدف خودمدیریت بگیرید.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — روی Data Center نسخه v3ای در کار نیست                    |
| `description` به‌صورت سندی از نوع Atlassian Document Format | `description` به‌صورت رشته‌ای ساده در نشانه‌گذاری ویکی               |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| توکن API از id.atlassian.com                      | **Profile → Personal access tokens → Create token** روی حساب Jira خودتان     |
| کنش خودکارسازی **Send web request**               | کنش خودکارسازی **Send outgoing web request**                                 |

پس بلوک create-issue به `POST`ی به `/rest/api/2/issue` تبدیل می‌شود با:

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

که قالب‌بندی‌اش ساده‌تر است — بدون درخت سند.

تفاوت‌های دیگری که باید برایشان برنامه بریزید:

- **توکن‌های دسترسی شخصی** از Jira Core و Jira Software نسخه 8.14 و Jira Service Management نسخه 4.15 وجود دارند. منقضی می‌شوند — به‌طور پیش‌فرض ۳۶۵ روز — و رابط کاربری پنج روز مانده یکی را *Expires soon* علامت می‌زند. احراز هویت Basic با نام کاربری و گذرواژه هنوز روی Data Center کار می‌کند، اما چند ورود ناموفق CAPTCHAیی را راه می‌اندازد که دسترسی حساب به API REST را به‌کل قفل می‌کند تا انسانی در مرورگری پاکش کند، که راه بدی برای کشف یک غلط تایپی است. توکن را ترجیح دهید.
- **خودکارسازی همراه بسته است** از Jira Data Center نسخه 10.0 به بعد. پیش از آن، برنامه Automation for Jira بود که جدا نصب می‌شد. درخواست خروجی‌اش مهلت پیش‌فرض ۳۰۰۰ میلی‌ثانیه دارد، که با ویژگی `outgoing.webhook.timeout.ms` قابل تنظیم است.
- **وب‌هوک‌ها** در **Administration → System → Advanced → WebHooks** ثبت می‌شوند، و محدودسازی با JQL پشتیبانی می‌شود. آن پالایه‌ها را باریک نگه دارید: Jira مقدار JQL هر وب‌هوک ثبت‌شده‌ای را روی همان نخی می‌سنجد که رویداد را برانگیخته است، پس دوجینی پالایه شل، همان کنش کاربری‌ای را که راه‌شان انداخته کند می‌کند.
- **از Data Center نسخه 10.0 تحویل وب‌هوک ناهمگام است** و گزینه همگامی در کار نیست، پس رویدادها می‌توانند بی‌ترتیب برسند. گردش کاری گیرنده را خودتوان بسازید.
- **Jira نسخه 10 نشانه `$` را از متغیرهای نشانی وب‌هوک حذف کرد** — ‏`${issue.id}` شد `{issue.id}` — و منبع REST وب‌هوک را از `/rest/webhooks/1.0/webhook` به `/rest/jira-webhook/1.0/webhooks` جابه‌جا کرد.

## همین کار برای هشدارها

هر چیزی که بالا آمد گرد حادثه‌ها نوشته شده چون حالت رایج همان است، اما هشدارها یکسان کار می‌کنند — نوع رکورد را عوض کنید و هیچ‌چیز دیگری تغییر نمی‌کند:

| حادثه                                    | هشدار                                       |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`، `currentIncidentState`، `incidentSeverity` | `alertNumber`، `currentAlertState`، `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

هر گردش کاری دقیقاً یک تریگر دارد، پس حادثه‌ها و هشدارها هرکدام به گردش کاری خودشان نیاز دارند. اگر آن دو قرار باشد همان کار را بکنند، نیمه Jira را یک بار بسازید و از هر دو با مؤلفه **Execute Workflow** فرا بخوانیدش.

## رفع اشکال

نخست بلوک شکست‌خورده را در **Runs & Logs** باز کنید. ‏Jira بدنه‌ای JSON برمی‌گرداند که دقیقاً آنچه را رد کرده نام می‌برد، و مؤلفه API آن را در `response-body` نگه می‌دارد.

**‏`401 Unauthorized`.** مقدار `email:api_token` را با `printf` دوباره رمزگذاری کنید و `JIRA_AUTH` را به‌روز کنید؛ خط جدید پایانی از `echo` علت معمول است. سپس تأیید کنید حسابی که مالک توکن است می‌تواند در آن پروژه issue بسازد. روی Data Center بررسی کنید که `Bearer` می‌فرستید، نه `Basic`.

**‏`400 Bad Request`ای که فیلدی را نام می‌برد.** نوع issue در پروژه وجود ندارد، یا پروژه فیلدی الزامی دارد که شما نمی‌فرستید. فراخوان‌های `createmeta` بالا را روی همان پروژه و نوع issue اجرا کنید و مقایسه کنید.

**‏`400`ای که از `description` گله می‌کند.** روی Cloud نسخه v3، توضیح باید سندی از نوع Atlassian Document Format باشد، نه رشته‌ای. یا سندی را که بالا نشان داده شد بفرستید، یا آن بلوک را به `/rest/api/2/issue` عوض کنید و متن ساده بفرستید.

**‏`404 Not Found`.** نشانی پایه و نسخه API را بررسی کنید — `/rest/api/3/...` روی Cloud، ‏`/rest/api/2/...` روی Data Center.

**‏`429 Too Many Requests`.** ‏Jira دارد نرخ را محدود می‌کند. پاسخ، `Retry-After` را بر حسب ثانیه و `RateLimit-Reason`ای را که می‌گوید به کدام حد خورده‌اید حمل می‌کند. نوشتن‌ها روی یک issue یگانه سخت محدود شده‌اند — در حدود بیست‌تا در دو ثانیه — پس گردش کاری‌ای که پشت سر هم دیدگاه می‌گذارد و گذار می‌دهد می‌تواند تنها روی همان یک issue به آن بخورد. بلوکی از نوع **Delay** میان فراخوان‌ها بگذارید، یا کار انبوه را به گردش کاری زمان‌بندی‌شده ببرید.

**فراخوان گذار `400` برمی‌گرداند.** شناسه گذار از وضعیت *کنونی* issue معتبر نیست. برای آن issue مسیر `/transitions` را بگیرید و شناسه‌ای از پاسخ به کار برید.

**قاعده خودکارسازی موفق نشان داده می‌شود اما چیزی به OneUptime نمی‌رسد.** نخست درگاه را بررسی کنید — فهرست محدود بالا را ببینید. سپس خودتان با `curl` درخواستی به نشانی وب‌هوک بفرستید و ببینید در **Runs & Logs** پدیدار می‌شود یا نه؛ اگر مال شما می‌رسد و مال Jira نمی‌رسد، مشکل سمت Jira است.

**گردش کاری اجرا می‌شود اما حادثه تغییر نمی‌کند.** بلوکی از نوع **Update One Incident** وقتی پرس‌وجویش با چیزی نخواند `Items Updated: 0` گزارش می‌دهد، و آن موفقیت به شمار می‌آید، نه خطا. بررسی کنید شناسه‌ای که در محموله است واقعاً شناسه حادثه OneUptime باشد و اینکه دارید `_id` را پرس‌وجو می‌کنید.

**ارجاعی از نوع `{{...}}` عیناً در issueای در Jira پدیدار می‌شود.** ارجاع حل‌نشده به‌جای خالی شدن به‌صورت متن رد می‌شود. گزارش اجرا هر ارجاعی را که حل نشده نام می‌برد — معمولاً شناسه بلوکی که غلط تایپ شده یا متغیری که بازنام‌گذاری شده است.

## در ادامه چه بخوانیم

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوهای ورودی و خروجی، و راهنمای سریع احراز هویت.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — همین ساخت دوسویه در برابر Dynamics.
- [نمای کلی گردش‌های کاری](/docs/workflows/index) و [نوشتن یک گردش کاری](/docs/workflows/authoring) — بوم، شناسه‌ها، و روشن کردن گردش کاری.
- [مؤلفه‌ها](/docs/workflows/components) — بلوک‌های API، ‏If / Else، و مؤلفه‌های داده OneUptime.
- [متغیرها](/docs/workflows/variables) — رازها، و خواندن خروجی یک بلوک از بلوک بعدی.
- [پیکربندی و ایمنی](/docs/workflows/configuration) — امنیت وب‌هوک و دسترسی خروج شبکه.
- [ServiceNow](/docs/integrations/servicenow) و [PagerDuty](/docs/integrations/pagerduty) — همین الگوی خروجی برای ابزارهای دیگر.
