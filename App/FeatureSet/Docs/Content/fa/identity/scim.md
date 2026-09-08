# ‏SCIM (سامانه مدیریت هویت میان‌دامنه‌ای)

‏OneUptime از پروتکل SCIM نسخه ۲٫۰ برای تأمین و لغو تأمین خودکار کاربر پشتیبانی می‌کند. SCIM به ارائه‌دهندگان هویت (IdP) مانند Azure AD، ‏Okta و دیگر سامانه‌های هویتی سازمانی امکان می‌دهد دسترسی کاربر به پروژه‌ها و صفحه‌های وضعیت OneUptime را خودکار مدیریت کنند.

## نمای کلی

یکپارچه‌سازی SCIM این مزایا را فراهم می‌کند:

- **تأمین خودکار کاربر**: وقتی کاربران در IdP شما تخصیص می‌یابند، خودکار در OneUptime ساخته می‌شوند
- **لغو تأمین خودکار کاربر**: وقتی کاربران در IdP شما از تخصیص درمی‌آیند، خودکار از OneUptime برداشته می‌شوند
- **همگام‌سازی ویژگی کاربر**: اطلاعات کاربر را میان IdP و OneUptime همگام نگه می‌دارد
- **مدیریت متمرکز دسترسی**: دسترسی به OneUptime را از سامانه مدیریت هویت موجودتان مدیریت کنید

## ‏SCIM برای پروژه‌ها

‏SCIM پروژه به ارائه‌دهندگان هویت امکان می‌دهد اعضای تیم را درون پروژه‌های OneUptime مدیریت کنند.

### برپا کردن SCIM پروژه

1. **رفتن به تنظیمات پروژه**

   - به پروژه OneUptime خود بروید
   - به **Project Settings** > **Security** > **SCIM** بروید

2. **پیکربندی تنظیمات SCIM**

   - **Auto Provision Users** را فعال کنید تا کاربران وقتی در IdP شما تخصیص می‌یابند خودکار افزوده شوند
   - **Auto Deprovision Users** را فعال کنید تا کاربران وقتی در IdP شما از تخصیص درمی‌آیند خودکار برداشته شوند
   - **Default Teams**ای را که کاربران تازه باید به آن‌ها افزوده شوند برگزینید
   - **SCIM Base URL** و **Bearer Token** را برای پیکربندی IdP خود کپی کنید

3. **پیکربندی ارائه‌دهنده هویت شما**
   - نشانی پایه SCIM را به کار ببرید: `https://oneuptime.com/scim/v2/{scimId}`
   - احراز هویت توکن bearer را با توکن داده‌شده پیکربندی کنید
   - ویژگی‌های کاربر را نگاشت کنید (ایمیل الزامی است)

### نقطه‌های پایانی SCIM پروژه

- **Service Provider Config**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /scim/v2/{scimId}/Users`
- **Get User**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /scim/v2/{scimId}/Users`
- **Update User**: `PUT /scim/v2/{scimId}/Users/{userId}` یا `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **List Groups**: `GET /scim/v2/{scimId}/Groups`
- **Get Group**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Create Group**: `POST /scim/v2/{scimId}/Groups`
- **Update Group**: `PUT /scim/v2/{scimId}/Groups/{groupId}` یا `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Delete Group**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### چرخه زندگی کاربر در SCIM پروژه

1. **تخصیص کاربر در IdP**: وقتی کاربری در IdP شما به OneUptime تخصیص می‌یابد
2. **تأمین SCIM**: ‏IdP ‏API ‏SCIM در OneUptime را برای ساخت کاربر فرا می‌خواند
3. **عضویت تیمی**: کاربر خودکار به تیم‌های پیش‌فرض پیکربندی‌شده افزوده می‌شود
4. **اعطای دسترسی**: کاربر اکنون می‌تواند به پروژه OneUptime دسترسی داشته باشد
5. **لغو تخصیص کاربر**: وقتی کاربر در IdP از تخصیص درمی‌آید
6. **لغو تأمین SCIM**: ‏IdP ‏API ‏SCIM در OneUptime را برای برداشتن کاربر فرا می‌خواند
7. **ابطال دسترسی**: کاربر دسترسی به پروژه را از دست می‌دهد

## ‏SCIM برای صفحه‌های وضعیت

‏SCIM صفحه وضعیت به ارائه‌دهندگان هویت امکان می‌دهد مشترکان صفحه‌های وضعیت خصوصی را مدیریت کنند.

### برپا کردن SCIM صفحه وضعیت

1. **رفتن به تنظیمات صفحه وضعیت**

   - به صفحه وضعیت OneUptime خود بروید
   - به **Status Page** > **Security** > **SCIM** بروید

2. **پیکربندی تنظیمات SCIM**

   - **Auto Provision Users** را فعال کنید تا مشترکان وقتی در IdP شما تخصیص می‌یابند خودکار افزوده شوند
   - **Auto Deprovision Users** را فعال کنید تا مشترکان وقتی در IdP شما از تخصیص درمی‌آیند خودکار برداشته شوند
   - **SCIM Base URL** و **Bearer Token** را برای پیکربندی IdP خود کپی کنید

3. **پیکربندی ارائه‌دهنده هویت شما**
   - نشانی پایه SCIM را به کار ببرید: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - احراز هویت توکن bearer را با توکن داده‌شده پیکربندی کنید
   - ویژگی‌های کاربر را نگاشت کنید (ایمیل الزامی است)

### نقطه‌های پایانی SCIM صفحه وضعیت

- **Service Provider Config**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /status-page-scim/v2/{scimId}/Users`
- **Get User**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /status-page-scim/v2/{scimId}/Users`
- **Update User**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` یا `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### چرخه زندگی کاربر در SCIM صفحه وضعیت

1. **تخصیص کاربر در IdP**: وقتی کاربری در IdP شما به صفحه وضعیت OneUptime تخصیص می‌یابد
2. **تأمین SCIM**: ‏IdP ‏API ‏SCIM در OneUptime را برای ساخت مشترک فرا می‌خواند
3. **اعطای دسترسی**: کاربر اکنون می‌تواند به صفحه وضعیت خصوصی دسترسی داشته باشد
4. **لغو تخصیص کاربر**: وقتی کاربر در IdP از تخصیص درمی‌آید
5. **لغو تأمین SCIM**: ‏IdP ‏API ‏SCIM در OneUptime را برای برداشتن مشترک فرا می‌خواند
6. **ابطال دسترسی**: کاربر دسترسی به صفحه وضعیت را از دست می‌دهد

## پیکربندی ارائه‌دهنده هویت

### Microsoft Entra ID (پیش‌تر Azure AD)

‏Microsoft Entra ID مدیریت هویت در سطح سازمانی با توانایی‌های استوار تأمین SCIM فراهم می‌کند. این گام‌های تفصیلی را برای پیکربندی تأمین SCIM با OneUptime دنبال کنید.

#### پیش‌نیازها

- مستأجری در Microsoft Entra ID با پروانه Premium P1 یا P2 (برای تأمین خودکار الزامی است)
- حسابی در OneUptime با طرح Scale یا بالاتر
- دسترسی مدیر به هر دوی Microsoft Entra ID و OneUptime

#### گام ۱: گرفتن پیکربندی SCIM از OneUptime

1. به داشبورد OneUptime خود وارد شوید
2. به **Project Settings** > **Security** > **SCIM** بروید
3. روی **Create SCIM Configuration** کلیک کنید
4. نامی دوستانه وارد کنید (برای نمونه «Microsoft Entra ID Provisioning»)
5. این گزینه‌ها را پیکربندی کنید:
   - **Auto Provision Users**: برای ساخت خودکار کاربران فعال کنید
   - **Auto Deprovision Users**: برای برداشتن خودکار کاربران فعال کنید
   - **Default Teams**: تیم‌هایی را که کاربران تازه باید به آن‌ها افزوده شوند برگزینید
   - **Enable Push Groups**: اگر می‌خواهید عضویت تیمی را از راه گروه‌های Entra ID مدیریت کنید فعالش کنید
6. پیکربندی را ذخیره کنید
7. **SCIM Base URL** و **Bearer Token** را کپی کنید — برای Entra ID لازمشان خواهید داشت

#### گام ۲: ساخت برنامه سازمانی در Microsoft Entra ID

1. به [مرکز مدیریت Microsoft Entra](https://entra.microsoft.com) وارد شوید
2. به **Identity** > **Applications** > **Enterprise applications** بروید
3. روی **+ New application** کلیک کنید
4. روی **+ Create your own application** کلیک کنید
5. نامی وارد کنید (برای نمونه «OneUptime»)
6. گزینه **Integrate any other application you don't find in the gallery (Non-gallery)** را برگزینید
7. روی **Create** کلیک کنید

#### گام ۳: پیکربندی تأمین SCIM

1. در برنامه سازمانی OneUptime خود، به **Provisioning** بروید
2. روی **Get started** کلیک کنید
3. مقدار **Provisioning Mode** را روی **Automatic** بگذارید
4. زیر **Admin Credentials**:
   - **Tenant URL**: نشانی پایه SCIM را از OneUptime وارد کنید (برای نمونه `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Secret Token**: توکن Bearer را از OneUptime وارد کنید
5. برای تأیید پیکربندی روی **Test Connection** کلیک کنید
6. روی **Save** کلیک کنید

#### گام ۴: پیکربندی نگاشت ویژگی‌ها

1. در بخش Provisioning روی **Mappings** کلیک کنید
2. روی **Provision Azure Active Directory Users** کلیک کنید
3. نگاشت ویژگی‌های زیر را پیکربندی کنید:

| ویژگی Azure AD | ویژگی SCIM در OneUptime | الزامی |
| ------------------------------------------------------------- | ------------------------------ | ----------- |
| `userPrincipalName` | `userName` | بله |
| `mail` | `emails[type eq "work"].value` | توصیه‌شده |
| `displayName` | `displayName` | توصیه‌شده |
| `givenName` | `name.givenName` | اختیاری |
| `surname` | `name.familyName` | اختیاری |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | توصیه‌شده |

4. هر نگاشتی را که لازم نیست بردارید تا تأمین ساده شود
5. روی **Save** کلیک کنید

#### گام ۵: پیکربندی تأمین گروه (اختیاری)

اگر **Push Groups** را در OneUptime فعال کرده‌اید:

1. به **Mappings** برگردید
2. روی **Provision Azure Active Directory Groups** کلیک کنید
3. با گذاشتن **Enabled** روی **Yes** تأمین گروه را فعال کنید
4. نگاشت ویژگی‌های زیر را پیکربندی کنید:

| ویژگی Azure AD | ویژگی SCIM در OneUptime |
| ------------------ | ------------------------ |
| `displayName` | `displayName` |
| `members` | `members` |

5. روی **Save** کلیک کنید

#### گام ۶: تخصیص کاربران و گروه‌ها

1. در برنامه سازمانی OneUptime خود به **Users and groups** بروید
2. روی **+ Add user/group** کلیک کنید
3. کاربران و/یا گروه‌هایی را که می‌خواهید به OneUptime تأمین شوند برگزینید
4. روی **Assign** کلیک کنید

#### گام ۷: آغاز تأمین

1. به **Provisioning** > **Overview** بروید
2. روی **Start provisioning** کلیک کنید
3. چرخه تأمین اولیه آغاز می‌شود (نخستین همگام‌سازی می‌تواند تا ۴۰ دقیقه طول بکشد)
4. **Provisioning logs** را برای هر خطایی بپایید

#### رفع اشکال Microsoft Entra ID

- **آزمون اتصال شکست می‌خورد**: تأیید کنید نشانی پایه SCIM پیشوند `/api/identity` را دربر دارد و توکن Bearer درست است
- **کاربران تأمین نمی‌شوند**: بررسی کنید کاربران به برنامه تخصیص یافته‌اند و نگاشت ویژگی‌ها درست است
- **خطاهای تأمین**: برای پیام‌های خطای مشخص، Provisioning logs را در Entra ID مرور کنید
- **تأخیر همگام‌سازی**: تأمین اولیه می‌تواند تا ۴۰ دقیقه طول بکشد؛ همگام‌سازی‌های بعدی هر ۴۰ دقیقه رخ می‌دهند

---

### Okta

‏Okta مدیریت هویت انعطاف‌پذیر با پشتیبانی عالی از SCIM فراهم می‌کند. این گام‌های تفصیلی را برای پیکربندی تأمین SCIM با OneUptime دنبال کنید.

#### پیش‌نیازها

- مستأجری در Okta با توانایی تأمین (قابلیت Lifecycle Management)
- حسابی در OneUptime با طرح Scale یا بالاتر
- دسترسی مدیر به هر دوی Okta و OneUptime

#### گام ۱: گرفتن پیکربندی SCIM از OneUptime

1. به داشبورد OneUptime خود وارد شوید
2. به **Project Settings** > **Security** > **SCIM** بروید
3. روی **Create SCIM Configuration** کلیک کنید
4. نامی دوستانه وارد کنید (برای نمونه «Okta Provisioning»)
5. این گزینه‌ها را پیکربندی کنید:
   - **Auto Provision Users**: برای ساخت خودکار کاربران فعال کنید
   - **Auto Deprovision Users**: برای برداشتن خودکار کاربران فعال کنید
   - **Default Teams**: تیم‌هایی را که کاربران تازه باید به آن‌ها افزوده شوند برگزینید
   - **Enable Push Groups**: اگر می‌خواهید عضویت تیمی را از راه گروه‌های Okta مدیریت کنید فعالش کنید
6. پیکربندی را ذخیره کنید
7. **SCIM Base URL** و **Bearer Token** را کپی کنید — برای Okta لازمشان خواهید داشت

#### گام ۲: ساخت یا پیکربندی برنامه Okta

**اگر برنامه SSO موجودی دارید:**

1. به کنسول مدیریت Okta خود وارد شوید
2. به **Applications** > **Applications** بروید
3. برنامه OneUptime موجودتان را بیابید و برگزینید

**اگر برنامه‌ای تازه می‌سازید:**

1. به کنسول مدیریت Okta خود وارد شوید
2. به **Applications** > **Applications** بروید
3. روی **Create App Integration** کلیک کنید
4. گزینه **SAML 2.0** را برگزینید و **Next** را بزنید
5. نام برنامه را «OneUptime» بگذارید
6. پیکربندی SAML را کامل کنید (به مستندات SSO مراجعه کنید)
7. روی **Finish** کلیک کنید

#### گام ۳: فعال کردن تأمین SCIM

1. در برنامه OneUptime خود به زبانه **General** بروید
2. در بخش **App Settings** روی **Edit** کلیک کنید
3. زیر **Provisioning**، گزینه **SCIM** را برگزینید
4. روی **Save** کلیک کنید
5. زبانه تازه‌ای به نام **Provisioning** پدیدار می‌شود

#### گام ۴: پیکربندی اتصال SCIM

1. به زبانه **Provisioning** بروید
2. در نوار کناری چپ روی **Integration** کلیک کنید
3. روی **Configure API Integration** کلیک کنید
4. گزینه **Enable API integration** را تیک بزنید
5. این‌ها را پیکربندی کنید:
   - **SCIM connector base URL**: نشانی پایه SCIM را از OneUptime وارد کنید (برای نمونه `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Unique identifier field for users**: مقدار `userName` را وارد کنید
   - **Supported provisioning actions**: کنش‌هایی را که می‌خواهید فعال کنید برگزینید:
     - Import New Users and Profile Updates
     - Push New Users
     - Push Profile Updates
     - Push Groups (اگر تأمین گروه‌محور به کار می‌برید)
   - **Authentication Mode**: گزینه **HTTP Header** را برگزینید
   - **Authorization**: مقدار `Bearer {your-bearer-token}` را وارد کنید (با توکن واقعی جایگزین کنید)
6. برای تأیید اتصال روی **Test API Credentials** کلیک کنید
7. روی **Save** کلیک کنید

#### گام ۵: پیکربندی تأمین به برنامه

1. در زبانه **Provisioning**، در نوار کناری چپ روی **To App** کلیک کنید
2. روی **Edit** کلیک کنید
3. این گزینه‌ها را فعال کنید:
   - **Create Users**: برای تأمین کاربران تازه فعال کنید
   - **Update User Attributes**: برای همگام‌سازی تغییر ویژگی‌ها فعال کنید
   - **Deactivate Users**: برای لغو تأمین کاربران هنگام خارج شدن از تخصیص فعال کنید
4. روی **Save** کلیک کنید

#### گام ۶: پیکربندی نگاشت ویژگی‌ها

1. به **Attribute Mappings** بروید
2. نگاشت‌های زیر را تأیید یا پیکربندی کنید:

| ویژگی Okta | ویژگی SCIM در OneUptime | جهت |
| ------------------ | ------------------------------- | ----------- |
| `userName` | `userName` | ‏Okta به برنامه |
| `user.email` | `emails[primary eq true].value` | ‏Okta به برنامه |
| `user.firstName` | `name.givenName` | ‏Okta به برنامه |
| `user.lastName` | `name.familyName` | ‏Okta به برنامه |
| `user.displayName` | `displayName` | ‏Okta به برنامه |

3. هر نگاشت غیرضروری را بردارید
4. اگر تغییری دادید روی **Save** کلیک کنید

#### گام ۷: پیکربندی Push Groups (اختیاری)

اگر **Push Groups** را در OneUptime فعال کرده‌اید:

1. به زبانه **Push Groups** بروید
2. روی **+ Push Groups** کلیک کنید
3. گزینه **Find groups by name** یا **Find groups by rule** را برگزینید
4. گروه‌هایی را که می‌خواهید بفرستید جستجو و برگزینید
5. روی **Save** کلیک کنید

#### گام ۸: تخصیص کاربران

1. به زبانه **Assignments** بروید
2. روی **Assign** > **Assign to People** یا **Assign to Groups** کلیک کنید
3. کاربران یا گروه‌هایی را که می‌خواهید تأمین شوند برگزینید
4. برای هر انتخابی **Assign** را بزنید
5. روی **Done** کلیک کنید

#### گام ۹: تأیید تأمین

1. در کنسول مدیریت Okta به **Reports** > **System Log** بروید
2. رویدادهای مربوط به برنامه OneUptime خود را بپالایید
3. تأیید کنید رویدادهای تأمین موفق‌اند
4. ‏OneUptime را بررسی کنید تا ساخته شدن کاربران تأیید شود

#### رفع اشکال Okta

- **آزمون اعتبارنامه‌های API شکست می‌خورد**: تأیید کنید نشانی پایه SCIM و توکن Bearer درست‌اند
- **کاربران تأمین نمی‌شوند**: مطمئن شوید کاربران به برنامه تخصیص یافته‌اند و تأمین فعال است
- **کاربران تکراری**: مطمئن شوید ویژگی `userName` یکتاست و درست به ایمیل نگاشت می‌شود
- **شکست فرستادن گروه**: تأیید کنید گروه‌ها وجود دارند و عضویت درست دارند
- **خطای ۴۰۱ Unauthorized**: توکن Bearer را در OneUptime دوباره تولید کنید و Okta را به‌روزرسانی کنید

---

### دیگر ارائه‌دهندگان هویت

پیاده‌سازی SCIM در OneUptime از مشخصات SCIM نسخه ۲٫۰ پیروی می‌کند و باید با هر ارائه‌دهنده هویت سازگاری کار کند. گام‌های کلی پیکربندی:

1. **نشانی پایه SCIM**: `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (برای پروژه‌ها) یا `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (برای صفحه‌های وضعیت)
2. **احراز هویت**: توکن HTTP Bearer
3. **ویژگی الزامی کاربر**: `userName` (باید نشانی ایمیل معتبری باشد)
4. **عملیات پشتیبانی‌شده**: GET، ‏POST، ‏PUT، ‏PATCH، ‏DELETE برای Users و Groups

#### نقطه‌های پایانی پشتیبانی‌شده SCIM

| نقطه پایانی | متدها | توضیح |
| ------------------------ | ----------------------- | ------------------------------------------------ |
| `/ServiceProviderConfig` | GET | توانایی‌های کارساز SCIM |
| `/Schemas` | GET | طرحواره‌های منبع در دسترس |
| `/ResourceTypes` | GET | نوع‌های منبع در دسترس |
| `/Users` | GET، POST | فهرست کردن و ساخت کاربران |
| `/Users/{id}` | GET، PUT، PATCH، DELETE | مدیریت کاربران منفرد |
| `/Groups` | GET، POST | فهرست کردن و ساخت گروه/تیم (فقط SCIM پروژه) |
| `/Groups/{id}` | GET، PUT، PATCH، DELETE | مدیریت گروه‌های منفرد (فقط SCIM پروژه) |

#### طرحواره کاربر در SCIM

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "user@example.com",
  "name": {
    "givenName": "John",
    "familyName": "Doe",
    "formatted": "John Doe"
  },
  "displayName": "John Doe",
  "emails": [
    {
      "value": "user@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "active": true
}
```

#### طرحواره گروه در SCIM

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    {
      "value": "user-id-here",
      "display": "user@example.com"
    }
  ]
}
```

## پرسش‌های پرتکرار

### وقتی تأمین کاربری لغو می‌شود چه رخ می‌دهد؟

وقتی تأمین کاربری لغو می‌شود (یا با درخواست DELETE یا با گذاشتن `active: false`)، از تیم‌هایی که در تنظیمات SCIM پیکربندی شده‌اند برداشته می‌شود. خود حساب کاربر در OneUptime می‌ماند اما دسترسی به پروژه را از دست می‌دهد.

### آیا می‌توانم SCIM را بدون SSO به کار ببرم؟

بله، SCIM و SSO قابلیت‌های مستقلی‌اند. می‌توانید SCIM را برای تأمین کاربر به کار ببرید در حالی که کاربران با گذرواژه OneUptime خود یا هر روش احراز هویت دیگری وارد می‌شوند.

### با کاربرانی که از پیش در OneUptime هستند چه کنم؟

وقتی SCIM می‌کوشد کاربری را بسازد که از پیش وجود دارد (تطبیق بر پایه ایمیل)، OneUptime به‌جای ساختن کاربری تکراری صرفاً او را به تیم‌های پیش‌فرض پیکربندی‌شده می‌افزاید.

### تفاوت تیم‌های پیش‌فرض و Push Groups چیست؟

- **تیم‌های پیش‌فرض**: همه کاربرانی که از راه SCIM تأمین می‌شوند به همان تیم‌های از پیش تعریف‌شده افزوده می‌شوند
- **Push Groups**: عضویت تیمی را ارائه‌دهنده هویت شما مدیریت می‌کند، که به کاربران مختلف امکان می‌دهد بر پایه عضویت گروهی در IdP در تیم‌های مختلفی باشند

### همگام‌سازی تأمین هر چند وقت رخ می‌دهد؟

این به ارائه‌دهنده هویت شما بستگی دارد:

- **Microsoft Entra ID**: همگام‌سازی اولیه می‌تواند تا ۴۰ دقیقه طول بکشد، همگام‌سازی‌های بعدی هر ۴۰ دقیقه
- **Okta**: برای بیشتر عملیات تقریباً بی‌درنگ، با همگام‌سازی‌های کامل دوره‌ای
