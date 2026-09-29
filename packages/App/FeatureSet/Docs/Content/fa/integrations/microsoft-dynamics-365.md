# یکپارچه‌سازی Microsoft Dynamics 365

هر بار که حادثه‌ای در OneUptime اعلام می‌شود یک **Case** در [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) باز کنید، آن case را همگام با حرکت حادثه به‌روز نگه دارید، و بگذارید Dynamics تغییرهای case را به OneUptime پس بفرستد — همه با یک [گردش کاری](/docs/workflows/index). بلوکی ویژه Dynamics برای نصب وجود ندارد: OneUptime با [مؤلفه API](/docs/workflows/components#api) با **Dataverse Web API** حرف می‌زند، و Dynamics از راه یک [تریگر وب‌هوک](/docs/workflows/triggers#webhook) پاسخ می‌دهد.

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

این صفحه هر دو جهت را پوشش می‌دهد. نخست نیمه خروجی را بسازید — همان است که به راه‌اندازی Microsoft Entra ID نیاز دارد، و وقتی کار کرد نیمه ورودی تنها یک flow است.

## پیش‌نیازها

- یک محیط **Dynamics 365** که جدول **Case** را داشته باشد. Caseها از Dynamics 365 Customer Service می‌آیند؛ محیط Dataverseای که آن را نداشته باشد جدول `incident`ای برای نوشتن ندارد.
- **نقطه پایانی Web API** آن محیط. آن را در [مرکز مدیریت Power Platform](https://admin.powerplatform.microsoft.com/) زیر **Settings → Developer resources** محیطتان بیابید، یا در **make.powerapps.com → Settings → Developer resources**. چیزی شبیه `https://yourorg.crm.dynamics.com/api/data/v9.2/` است — بخش منطقه فرق می‌کند (`crm` برای آمریکای شمالی، `crm2` برای آمریکای جنوبی، `crm7` برای ژاپن، و همین‌طور ادامه).
- دسترسی برای ثبت یک برنامه در **Microsoft Entra ID** و ساخت یک **application user** در محیط Dynamics. این‌ها معمولاً کار دو مدیر متفاوت‌اند.
- یک پروژه OneUptime که در آن بتوانید گردش کاری و متغیر سراسری بسازید.

> هر چه پایین می‌آید نام‌های جدول Dataverse را به کار می‌برد، نه برچسب‌های روی فرم‌های Dynamics. یک case همان جدول **`incident`** است، مجموعه‌اش در یک نشانی **`incidents`**، کلید اصلی‌اش **`incidentid`** و ستون عنوانش **`title`** است. شماره caseای که در رابط کاربری می‌بینید **`ticketnumber`** است.

## گام ۱ — ثبت یک برنامه در Microsoft Entra ID

‏OneUptime به‌عنوان یک برنامه احراز هویت می‌کند، نه به‌عنوان یک شخص، پس جریان **client credentials** در OAuth 2.0 را به کار می‌برد.

1. با حساب مدیر همان tenantی که محیط Dynamics شما در آن است به [پورتال Azure](https://portal.azure.com) وارد شوید و **Microsoft Entra ID** را باز کنید.
2. به **App registrations → New registration** بروید. نامی مانند `OneUptime Integration` بگذارید، **Supported account types** را روی **Accounts in this organizational directory only** رها کنید و **Register** را بزنید.
3. از صفحه **Overview** برنامه، مقدارهای **Application (client) ID** و **Directory (tenant) ID** را کپی کنید.
4. به **Certificates & secrets → Client secrets → New client secret** بروید. پیش از آنکه صفحه را ترک کنید **Value** آن راز را کپی کنید — نه شناسه‌اش را. دیگر هرگز نشان داده نمی‌شود. یک client secret دست‌بالا ۲۴ ماه عمر می‌کند، پس تاریخ انقضا را جایی یادداشت کنید که ببینیدش.

دو چیزی که مردم اینجا می‌افزایند و شما لازمشان ندارید:

- **هیچ API permissionای.** در جریان client credentials کاربر واردشده‌ای وجود ندارد، پس دسترسی‌های واگذارشده (delegated) هیچ کاری نمی‌کنند. مقدار `user_impersonation` زیر **Dataverse** دسترسی‌ای واگذارشده است و فقط به کار برنامه‌های تعاملی می‌آید. Microsoft Entra ID با کمال میل بدون هیچ دسترسی پیکربندی‌شده‌ای توکنی برای Dataverse صادر می‌کند — دسترسی سمت Dynamics و در گام ۲ تصمیم‌گیری می‌شود.
- **هیچ گام admin consentای.** به همان دلیل.

‏Microsoft برای برنامه‌های عملیاتی گواهی را به client secret ترجیح می‌دهد. آن گزینه از فراخوان می‌خواهد خودش یک ادعای JWT بسازد و امضا کند، کاری که از گردش کاری برنمی‌آید، پس اینجا client secret گزینه عملی است — با آن همان‌طور رفتار کنید: در متغیری محرمانه نگهش دارید و پیش از انقضا بچرخانیدش.

## گام ۲ — ساخت application user در Dynamics

این همان گامی است که از قلم می‌افتد، و افتادنش گیج‌کننده‌ترین شکست کل این یکپارچه‌سازی را می‌سازد: درخواست توکن موفق می‌شود، و سپس هر فراخوان Dataverse با `403 Forbidden` و کد خطای `0x80072560` شکست می‌خورد — *«The user isn't a member of the organization.»* ‏Entra ID توکن را بدون آنکه چیزی از Dynamics بداند صادر می‌کند؛ Dynamics آنگاه دنبال سطر کاربری می‌گردد که با آن برنامه بخواند، و چنین سطری نیست.

1. [مرکز مدیریت Power Platform](https://admin.powerplatform.microsoft.com/) را باز کنید و **Manage → Environments** و سپس محیطتان را انتخاب کنید.
2. گزینه **Settings → Users + permissions → Application users** را انتخاب کنید.
3. روی **+ New app user** و سپس **+ Add an app** بزنید، ثبت گام ۱ را برگزینید و **Add** را انتخاب کنید.
4. یک **Business unit** برگزینید، یک **Email address** وارد کنید، سپس از نماد ویرایش کنار **Security roles** استفاده کنید.
5. نقش امنیتی **سفارشی**ای با دسترسی ساخت، خواندن و نوشتن روی جدول **Case** بدهید. به یک application user نمی‌توان یکی از نقش‌های توکار را داد — Microsoft نقشی سفارشی می‌خواهد. اگر نقش مناسبی ندارید، یکی از نقش‌های موجود را کپی کنید و بتراشیدش.
6. گزینه **Save** و سپس **Create** را بزنید.

در هر محیط، به ازای هر برنامه ثبت‌شده فقط می‌توانید یک application user داشته باشید. application userها مجوز (license) نمی‌گیرند و از قواعد عضویت گروه امنیتی آن محیط معاف‌اند.

## گام ۳ — ذخیره اعتبارنامه‌ها در OneUptime

به **Workflows → Global Variables → Create** بروید و این‌ها را بیفزایید، و برای آن‌هایی که علامت خورده‌اند **Secret** را روشن کنید:

| نام                     | مقدار                                                       | محرمانه |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | مقدار Directory (tenant) ID از گام ۱                       | خیر     |
| `DYNAMICS_CLIENT_ID`     | مقدار Application (client) ID از گام ۱                     | خیر     |
| `DYNAMICS_CLIENT_SECRET` | مقدار **Value** مربوط به client secret از گام ۱            | بله     |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — بدون اسلش پایانی      | خیر     |

‏client secret را دقیقاً همان‌طور که Entra ID به شما داد بچسبانید. OneUptime بدنه فرم را برایتان کدگذاری می‌کند، پس دستی URL-encode‌اش نکنید.

از درون یک بلوک با `{{global.variables.DYNAMICS_CLIENT_ID}}` به هر کدامشان ارجاع دهید. برای اینکه ببینید رازها چگونه از گزارش‌های اجرا پاک می‌شوند [متغیرها](/docs/workflows/variables) را ببینید.

## گام ۴ — گرفتن توکن دسترسی

هر اجرا توکن خودش را می‌گیرد. توکن‌ها ۶۰ تا ۹۰ دقیقه عمر می‌کنند و جریان client credentials هرگز توکن تازه‌سازی صادر نمی‌کند، پس نه چیزی برای انباشتن هست و نه چیزی برای تمدید — یک فراخوان HTTP اضافه در هر اجرا تمام هزینه است.

1. گزینه **Workflows → Create Workflow** را باز کنید، نامش را `Incidents → Dynamics 365` بگذارید و **Builder** را باز کنید.
2. روی جانگهدار خط‌چین کلیک کنید، تریگر **On Create Incident** را بیفزایید، و در **Select Fields** آن، ستون‌هایی را که می‌خواهید بفرستید بخواهید:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   مقدار **Identifier** آن را همان `incident-on-create-1` رها کنید.

3. روی **Add Component** کلیک کنید، بلوکی از نوع **API Post (JSON)** بیفزایید، نقطه **Success** تریگر را به آن وصل کنید و تنظیماتش را باز کنید. مقدار **Identifier** آن را `get-token` بگذارید، سپس:

   - **URL**: `https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**:

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**:

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**نام هدر را `Content-Type` بنویسید، دقیقاً با همین بزرگ‌نویسی.** همین است که به OneUptime می‌گوید بدنه را به‌جای JSON به‌صورت فرم بفرستد، که تنها شکلی است که نقطه پایانی توکن Microsoft می‌پذیرد. مقدار `content-type` با حروف کوچک نمی‌خواند، و درخواست به‌صورت JSON بیرون می‌رود و با `400` برمی‌گردد.

مقدار `scope` باید نشانی محیط شما و پس از آن `/.default` باشد — شکل کارخواه محرمانه همین است. نشانی اشتباه محیط در اینجا علت معمول `AADSTS70011: The provided value for the input parameter 'scope' is not valid` است.

توکن حالا در پایین‌دست با این ارجاع در دسترس است:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## گام ۵ — ساخت case

بلوک دومی از نوع **API Post (JSON)** بیفزایید، نقطه **Success** بلوک `get-token` را به آن وصل کنید و **Identifier** آن را `create-case` بگذارید.

- **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**:

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**:

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

مقدار GUID حساب را با حسابی که این caseها به آن تعلق دارند جایگزین کنید. **‏`customerid` واقعاً روی یک case الزامی است** — یکی از ستون‌هایی است که Dataverse در هر نوشتن برنامه‌ای اعمال می‌کند، پس ساختی بدون آن رد می‌شود. چون می‌تواند هم به یک account اشاره کند و هم به یک contact، هرگز `customerid@odata.bind` نمی‌نویسید؛ `customerid_account@odata.bind` یا `customerid_contact@odata.bind` می‌نویسید، و این نام‌ها به بزرگی و کوچکی حروف حساس‌اند. مقدار `title` الزامی از گونه‌ای دیگر است: فرم‌های Dynamics بر آن پافشاری می‌کنند، API نه، پس به هر حال بفرستیدش.

‏`Prefer: return=representation` همان چیزی است که این را از درون یک گردش کاری قابل استفاده می‌کند. بدون آن، ساخت موفق با `204 No Content` پاسخ می‌دهد و نشانی رکورد تازه را در هدر پاسخ `OData-EntityId` می‌گذارد، که آنگاه باید GUID را از دلش بیرون بکشید. با آن، پاسخ `201 Created` است و خود رکورد را حمل می‌کند، پس بلوک بعدی می‌تواند این‌ها را بخواند:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

حالا گردش کاری را روشن کنید — **Overview → Edit Workflow → Enabled** — یک حادثه آزمایشی اعلام کنید، و اجرا را زیر **Runs & Logs** بخوانید. بلوک `create-case` باید `201` و بدنه‌ای شامل `incidentid` تازه نشان دهد. تغییرها روی بوم خودشان ذخیره می‌شوند؛ دکمه Save وجود ندارد.

### نگاشت شدت و وضعیت

‏Dynamics ستون `severitycode` را با تنها یک گزینه، «Default Value»، عرضه می‌کند، پس مقیاس شدت آماده‌ای برای نگاشت روی آن وجود ندارد. به‌جایش از **`prioritycode`** استفاده کنید، و اگر اولویت به ازای هر شدت می‌خواهید با بلوکی از نوع **If / Else** روی `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` شاخه بزنید.

| ستون           | مقادیر                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` High، `2` Normal، `3` Low                                                                                                     |
| `caseorigincode` | `1` Phone، `2` Email، `3` Web، `2483` Facebook، `3986` Twitter، `700610000` IoT                                                   |
| `casetypecode`   | `1` Question، `2` Problem، `3` Request                                                                                            |
| `statecode`      | `0` Active، `1` Resolved، `2` Cancelled                                                                                           |
| `statuscode`     | `1` In Progress، `2` On Hold، `3` Waiting for Details، `4` Researching، `5` Problem Solved، `6` Cancelled، `1000` Information Provided، `2000` Merged |

‏`statuscode` قابل سفارشی‌سازی است، پس ممکن است یک tenant مقادیر خودش را افزوده باشد. عدد صحیح بفرستید، نه برچسب.

## گام ۶ — کاری کنید که حادثه و case از روی هم پیدا شوند

هر کاری که بعداً بکنید — نظر گذاشتن، برطرف کردن، همگام‌سازی برگشتی — نیاز دارد یکی از این دو سامانه شناسه دیگری را نگه دارد. آن را سمت Dynamics بگذارید.

ستونی از نوع **single line of text** به جدول Case بیفزایید، برای نمونه `new_oneuptimeincidentid`، و هنگام ساخت case مقدارش را بگذارید:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

آنگاه هر گردش کاری بعدی می‌تواند case را با یک پالایه پیدا کند:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

اگر آن ستون را به‌عنوان **alternate key** روی جدول Case تعریف کنید، می‌توانید جست‌وجو را به‌کل کنار بگذارید و مستقیم روی `incidents(new_oneuptimeincidentid='<id>')` عملیات `PATCH` بزنید — یک upsert که اگر case نباشد می‌سازدش و اگر باشد به‌روزرسانی‌اش می‌کند. کلید باید ساخته شدنش تمام شود (وضعیتش **Active** شود) تا بتوان به کارش برد، و مقدار alternate key نمی‌تواند `/ < > * % & : \ ? + #` داشته باشد. شناسه OneUptime یک UUID ساده است، پس امن است.

جهت برعکس — ذخیره شناسه case مربوط به Dynamics روی حادثه OneUptime — هم کار می‌کند، با بلوکی از نوع **Update One Incident** که در `customFields` می‌نویسد. مراقبش باشید: `customFields` یک ستون JSON یگانه است، پس نوشتن در آن مقدار هر فیلد سفارشی آن حادثه را جایگزین می‌کند، نه فقط مال شما را. نگه داشتن پیوند سمت Dynamics این را به‌کل کنار می‌زند.

## گام ۷ — برطرف کردن case وقتی حادثه برطرف می‌شود

این را به‌عنوان گردش کاری **دوم** بسازید تا شکستی در اینجا نتواند جلوی باز شدن caseها را بگیرد.

1. گزینه **Create Workflow** را بزنید، نامش را `Incident resolved → Close Dynamics case` بگذارید و تریگر **On Update Incident** را بیفزایید.
2. در **Listen on** تریگر، مقدار `{"currentIncidentStateId": true}` را بگذارید تا گردش کاری فقط برای تغییر وضعیت بیدار شود، نه برای هر ویرایشی. در **Select Fields**، مقدار `{"_id": true, "currentIncidentState": {"name": true}}` را بخواهید.
3. بلوکی از نوع **If / Else** بیفزایید. مقدار **Input 1** برابر `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`، **Operator** برابر `==` و **Input 2** برابر `Resolved` است — یا هر نامی که وضعیت برطرف‌شده پروژه شما دارد. [وضعیت‌ها و شدت‌ها](/docs/incidents/states-and-severities) را ببینید.
4. از شاخه **Yes**، بلوک `get-token` گام ۴ را تکرار کنید.
5. بلوکی از نوع **API Get (JSON)** بیفزایید، **Identifier** آن را `find-case` بگذارید و نشانی `$filter` گام ۶ را به آن بدهید. پرس‌وجوی Dataverse با آرایه‌ای به نام `value` پاسخ می‌دهد، و ارجاع گردش کاری می‌تواند با کروشه در یک آرایه نمایه بگیرد، پس شناسه case برابر `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}` است.
6. بلوکی از نوع **API Post (JSON)** بیفزایید که case را ببندد:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: همان‌های گام ۵، منهای `Prefer`.
   - **Request Body**:

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     ‏`Status` مقداری از `statuscode` در وضعیت Resolved است — `5` یعنی *Problem Solved*.

     **پیش از آنکه به این بدنه تکیه کنید، آن را روی محیط خودتان بیازمایید.** ‏`CloseIncident` دو پارامتر می‌گیرد، `IncidentResolution` و `Status`، اما Microsoft هیچ نمونه HTTPای برایش منتشر نکرده — همه نمونه‌های رسمی به C# هستند. شکل بالا برگردان متعارف آن است. اگر محیط شما ردش کرد، به‌جای شکل `@odata.bind` سعی کنید case را با ویژگی ساده `"incidentid": "<the case id>"` مشخص کنید، که همان راهی است که دیگر نمونه‌های کنش Microsoft با آن به رکوردی موجود ارجاع می‌دهند.

**چرا با `PATCH` مقدار `statecode: 1` را روی case نگذاریم؟** می‌توانید — Microsoft عملیات `PATCH` روی `statecode` و `statuscode` را به‌عنوان معادل Web API برای پیام قدیمی‌تر SetState مستند می‌کند، و برای جابه‌جا کردن یک case میان وضعیت‌های فعال ابزار درستی است. آنچه نمی‌کند ساختن فعالیت **Case Resolution** است که از یک case برطرف‌شده در Dynamics 365 Customer Service انتظار می‌رود، و در محیطی که مدیری گذارهای وضعیت سفارشی پیکربندی کرده باشد یکسره رد می‌شود. برای برطرف کردن از `CloseIncident` استفاده کنید؛ برای باقی همه‌چیز از `PATCH`. و هر وقت `statecode` را می‌نویسید، `statuscode` را هم در همان درخواست بگذارید — وگرنه Dynamics بی‌سروصدا وضعیت پیش‌فرض آن حالت را اعمال می‌کند.

‏`CloseIncident` به‌جای Dataverse پایه از Dynamics 365 Customer Service می‌آید، و در مرجع کنش‌های Dataverse فهرست نشده است. اگر `404` برگرداند، با گرفتن `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` و جست‌وجوی `CloseIncident` در آن تأیید کنید که در محیط شما وجود دارد.

برای هر چیزی کمتر از بستن case — یک یادداشت، بالا بردن اولویت، تغییر عنوان — از بلوکی از نوع **API Patch (JSON)** روی `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` با هدر `If-Match: *` استفاده کنید، که جلوی ساختن case تازه به دست یک upsert تصادفی را می‌گیرد. فقط ستون‌هایی را بفرستید که تغییرشان می‌دهید.

## ورودی — از Dynamics 365 به OneUptime

حالا جهت دیگر: کسی case را در Dynamics می‌بندد، یا کارشناسی یادداشتی می‌افزاید، و OneUptime باید بداند.

### نخست گردش کاری گیرنده را بسازید

1. گزینه **Create Workflow** را بزنید، نامش را `Dynamics 365 → OneUptime` بگذارید و تریگر **Webhook** را بیفزایید.
2. صفحه **Settings** آن گردش کاری را باز کنید و **Webhook Secret Key** را کپی کنید. نشانی شما این است:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   در نصب خودمیزبان، میزبان خودتان را جایش بگذارید. با این نشانی مانند یک گذرواژه رفتار کنید — هر کسی که داشته باشدش می‌تواند گردش کاری را راه بیندازد. می‌توانید کلید را از همان صفحه بازنشانی کنید.

3. بلوکی از نوع **If / Else** بیفزایید که پیش از هر اتفاق دیگری رازی مشترک را بررسی کند. مقدار **Input 1** برابر `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`، **Operator** برابر `==` و **Input 2** برابر `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` است — مقداری که خودتان ابداع می‌کنید و به‌عنوان متغیر سراسری محرمانه ذخیره می‌کنید.
4. از شاخه **Yes**، بلوکی از نوع **Update One Incident** بیفزایید:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: هر چه که تغییر case باید در OneUptime معنا بدهد — تغییر وضعیت، یک یادداشت، یک برچسب.

   برای بردن حادثه به یک وضعیت، به شناسه آن وضعیت نیاز دارید: بلوکی از نوع **Find One Incident State** با پرس‌وجوی `{"name": "Resolved"}` مقدار `{{local.components.incident-state-find-one-1.returnValues.model._id}}` را به شما می‌دهد تا در `currentIncidentStateId` بنویسید.

آن را فعال و آماده رها کنید. حالا به Dynamics چیزی بدهید که فرا بخواند.

### گزینه الف — یک flow در Power Automate (توصیه‌شده)

این همان مسیری است که بیشتر تیم‌ها باید بروند: محموله را شما کنترل می‌کنید، و چیزی برای نصب نیست.

1. در [Power Automate](https://make.powerautomate.com) یک **Automated cloud flow** بسازید.
2. تریگر: **Microsoft Dataverse → When a row is added, modified or deleted**.

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — هر چیز تنگ‌تری فقط برای سطرهایی شلیک می‌کند که مالکشان شما یا واحد کسب‌وکارتان است.
   - **Select columns**: `statecode,statuscode`. این پالایه‌ای فقط برای Update است و ارزش دارد درست تنظیمش کنید. ستون‌های lookup اینجا پشتیبانی نمی‌شوند، و هرگز ستونی را فهرست نکنید که در هر به‌روزرسانی حاضر است (مانند کلید اصلی)، وگرنه flow در هر ذخیره شلیک می‌کند.

3. کنش **Microsoft Dataverse → Get a row by ID** را با جدول `Cases`، شناسه سطر از تریگر، و **Select columns** برابر `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid` بیفزایید.

   این فراخوان دوم ارزش هزینه‌اش را دارد. در یک به‌روزرسانی، تریگر فقط ستون‌هایی را حمل می‌کند که تغییر کرده‌اند، پس شناسه‌هایی که برای تطبیق لازم دارید ممکن است اصلاً آنجا نباشند.

4. کنش توکار **HTTP** را بیفزایید:

   - **Method**: `POST`
   - **URI**: نشانی وب‌هوک OneUptime از بالا
   - **Headers**: مقدارهای `Content-Type: application/json` و `X-OneUptime-Secret: <the same secret>`
   - **Body**: آن را از خروجی‌های *Get a row by ID* بسازید، برای نمونه

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. ذخیره کنید و flow را روشن کنید.

پیش از آنکه به این مسیر متعهد شوید، دانستن این‌ها می‌ارزد:

- **کانکتور Microsoft Dataverse پولی (premium) است.** برای یک flow خودکار فقط مالک flow به مجوز نیاز دارد، نه هر کسی که case با او سروکار پیدا می‌کند — اما منقضی شدن مجوز مالک بی‌سروصدا flow را می‌خواباند.
- تریگرهای Dataverse **فشاری‌اند، نه پیمایشی** — Dynamics یک فراخوان برگشتی ثبت می‌کند و شلیکش می‌کند. تحویل معمولاً ظرف چند ثانیه است؛ هر چیزی بیش از پنج دقیقه یعنی سرویس ناهمگام پشت صف مانده، که در مرکز مدیریت زیر **Settings → System Jobs** می‌بینیدش.
- هدرهای سفارشی جان به در می‌برند. Power Automate چند خانواده هدر استاندارد را از کنش‌های HTTP می‌تراشد (بیشتر هدرهای `Accept-*` و `Content-*`، و `Host`، `Origin`، `Cookie`)، اما هدری از آنِ خودتان مانند `X-OneUptime-Secret` رد می‌شود و می‌رسد.
- ‏flow باید در همان محیطی زندگی کند که جدولِ زیر نظرش در آن است.
- درخواست‌ها از سهمیه درخواست Power Platform در tenant شما کم می‌شوند، و محدودسازی کانکتور به‌صورت `429` درون اجرای flow نمایان می‌شود.

### گزینه ب — یک وب‌هوک بومی Dataverse

اگر Power Automate در دسترس نیست، Dataverse می‌تواند مستقیم OneUptime را فرا بخواند. نقطه پایانی را با [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook) ثبت کنید: **Register New WebHook** را بزنید، نشانی OneUptime را بدهید، احراز هویت **HttpHeader** را برگزینید و `X-OneUptime-Secret` را با راز خودتان بیفزایید. سپس روی جدول **incident** گامی برای پیام **Update** ثبت کنید، با **Filtering Attributes** محدود به ستون‌هایی که برایتان مهم‌اند، مرحله **PostOperation** و حالت اجرای **Asynchronous**.

این مسیر را با چشم باز بروید:

- **فقط درگاه‌های ۸۰ و ۴۴۳.** نصب خودمیزبان OneUptime روی هر درگاه دیگری قابل ثبت نیست.
- **‏Dataverse راز شما را وارسی نمی‌کند.** هدر را می‌فرستد؛ رد کردن درخواستی که آن را حمل نمی‌کند تماماً کار گردش کاری شماست — و بلوک **If / Else** در گردش کاری گیرنده برای همین است.
- **محموله شیء JSON دوستانه‌ای نیست.** یک `RemoteExecutionContext` سریال‌شده است، که در آن `InputParameters` یک *آرایه* از جفت‌های `{key, value}` است و سطر تغییریافته زیر کلید `Target` می‌نشیند و ستون‌هایش در آرایه‌ای دیگر به نام `Attributes` هستند. انتظار داشته باشید بلوکی از نوع **Run Custom JavaScript** بیفزایید تا پیش از آنکه چیز دیگری بتواند بخواندش صافش کند.
- در یک به‌روزرسانی **فقط ستون‌های تغییریافته گنجانده می‌شوند**، پس اگر `ticketnumber` یا ستون شناسه OneUptime‌تان را لازم دارید یک **Post Image** ثبت کنید.
- **بالای ۲۵۶ کیلوبایت بخش‌های جالب تراشیده می‌شوند** — مقدارهای `InputParameters`، `PreEntityImages` و `PostEntityImages` همه می‌روند، و درخواست هدر `x-ms-dynamics-msg-size-exceeded` را حمل می‌کند. مقدارهای `PrimaryEntityId` و `PrimaryEntityName` جان به در می‌برند، پس راه بازگشت این است که سطر را از راه Web API دوباره بخوانید.
- **تحویل تقریباً نابخشوده است.** ‏Dataverse ۶۰ ثانیه منتظر یک `2xx` می‌ماند و دقیقاً یک بار دوباره تلاش می‌کند، آن هم فقط برای `502`، `503` و `504`. هر چیز دیگری — از جمله `500` از سمت شما — دوباره تلاش نمی‌شود؛ به‌صورت یک System Job شکست‌خورده می‌نشیند.
- گزینه **Asynchronous** را برگزینید. گامی همگام، ذخیره کارشناس را پشت نقطه پایانی شما می‌بندد، و اگر تراکنش پس از آن برگردانده شود درخواست از پیش بیرون رفته و پس گرفتنی نیست.

گردش‌های کاری پس‌زمینه کلاسیک Dynamics اصلاً گام HTTP یا وب‌هوک ندارند، پس اینجا گزینه سومی نیستند.

## همین کار برای هشدارها

هر چه بالا آمد گرد حادثه‌ها نوشته شده چون حالت رایج همان است، اما هشدارها یکسان کار می‌کنند — نوع رکورد را عوض کنید و هیچ‌چیز دیگری تغییر نمی‌کند:

| حادثه                                                     | هشدار                                               |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`، `currentIncidentState`، `incidentSeverity`  | `alertNumber`، `currentAlertState`، `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

هر گردش کاری دقیقاً یک تریگر دارد، پس حادثه‌ها و هشدارها هرکدام به یک گردش کاری نیاز دارند. اگر قرار است هر دو همان کار را بکنند، نیمه Dynamics را یک بار بسازید و از هر دو با مؤلفه **Execute Workflow** فرا بخوانیدش.

## رفع اشکال

نخست بلوک شکست‌خورده را در **Runs & Logs** بخوانید — هر دو نقطه پایانی Microsoft بدنه JSON توضیحی برمی‌گردانند، و مؤلفه API آن را در `response-body` نگه می‌دارد.

**درخواست توکن با `400` و `invalid_request` یا نوع grant پشتیبانی‌نشده شکست می‌خورد.** هدر `Content-Type` دقیقاً `Content-Type: application/x-www-form-urlencoded` نیست، پس بدنه به‌صورت JSON بیرون رفته است. بزرگ‌نویسی را بررسی کنید.

**‏`400` با `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** مقدار `scope` نشانی محیط شما به‌علاوه `/.default` نیست. نشانی را از **Developer resources** کپی کنید و هر اسلش پایانی و هر مسیر `/api/data/...` را بیندازید.

**‏`401 Unauthorized` از Dynamics.** هدر `Authorization` یا نیست، یا بدشکل است، یا توکن در میانه اجرا منقضی شده است. باید `Bearer <token>` با یک فاصله تنها باشد.

**‏`403 Forbidden` با `0x80072560`، «The user isn't a member of the organization».** گام ۲ از قلم افتاده یا application user به ثبت برنامه دیگری بسته شده است. توکن سالم است؛ کاربر سمت Dynamics آنجا نیست.

**‏`403 Forbidden` با خطای دسترسی.** ‏application user وجود دارد اما نقش امنیتی سفارشی‌اش Create، Read یا Write روی **Case** را ندارد.

**‏`400 Bad Request` که به customer اشاره می‌کند.** مقدار `customerid` الزامی است. یکی از `customerid_account@odata.bind` یا `customerid_contact@odata.bind` را دقیقاً با همین املا بگذارید، با نشانی‌ای که با اسلش شروع می‌شود، مانند `/accounts(<guid>)`.

**‏`404 Not Found` روی `/CloseIncident`.** این کنش، کنشی از Dynamics 365 Customer Service است. پیش از آنکه فرض کنید در دسترس است، `$metadata` محیطتان را دنبالش بگردید.

**‏`412 Precondition Failed` با `DuplicateRecord`.** قاعده‌ای برای تشخیص رکورد تکراری خوانده است. یا قاعده را تنگ‌تر کنید یا فرستادن فیلدی را که روی آن تطبیق می‌دهد بس کنید.

**‏`429 Too Many Requests`.** محدودیت‌های محافظت از سرویس Dataverse — تقریباً ۶٬۰۰۰ درخواست و ۲۰ دقیقه زمان اجرا به ازای هر کاربر در هر پنجره پنج‌دقیقه‌ای، به ازای هر کارساز وب. پاسخ یک `Retry-After` بر حسب ثانیه حمل می‌کند. اگر گردش کاری‌ای انفجاری کار می‌کند، بلوکی از نوع **Delay** در آن بگذارید یا کار را به گردش کاری زمان‌بندی‌شده‌ای ببرید که دسته‌ای عمل می‌کند.

**هیچ‌چیز به سمت OneUptime نمی‌رسد.** خودتان با `curl` درخواستی به نشانی وب‌هوک بفرستید و **Runs & Logs** گردش کاری را بررسی کنید. اگر درخواست خودتان پیدا شد و درخواست Dynamics نه، مشکل بالادست است: برای Power Automate، تاریخچه اجرای خود flow را ببینید؛ برای وب‌هوک بومی، **Settings → System Jobs** پالوده روی شکست‌ها را ببینید.

**گردش کاری اجرا می‌شود اما حادثه تغییر نمی‌کند.** بلوک **Update One Incident** وقتی پرس‌وجو با چیزی نخواند `Items Updated: 0` گزارش می‌دهد — این موفقیت است، نه خطا. بررسی کنید شناسه درون محموله همان شناسه حادثه OneUptime باشد و اینکه دارید `_id` را پرس‌وجو می‌کنید.

## در ادامه چه بخوانیم

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوهای ورودی و خروجی، و برگه تقلب احراز هویت.
- [Jira](/docs/integrations/jira) — همین ساختِ دوجهته روی Jira.
- [نمای کلی گردش‌های کاری](/docs/workflows/index) و [ساخت یک گردش کاری](/docs/workflows/authoring) — بوم، شناسه‌ها، و روشن کردن یک گردش کاری.
- [مؤلفه‌ها](/docs/workflows/components) — بلوک‌های API، بلوک If / Else، و مؤلفه‌های داده OneUptime.
- [متغیرها](/docs/workflows/variables) — رازها، و خواندن خروجی یک بلوک از بلوک بعدی.
- [پیکربندی و ایمنی](/docs/workflows/configuration) — امنیت وب‌هوک و دسترسی شبکه خروجی.
- [نشانی‌های IP](/docs/configuration/ip-addresses) — بازه‌های خروجی OneUptime، اگر Dynamics پشت یک فهرست مجاز نشسته باشد.
