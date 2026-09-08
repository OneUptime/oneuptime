# ‏SSO (ورود یکپارچه)

‏OneUptime از ورود یکپارچه (SSO) مبتنی بر SAML 2.0 برای احراز هویت سازمانی پشتیبانی می‌کند. SSO به اعضای تیم شما امکان می‌دهد با ارائه‌دهنده هویت (IdP) سازمانتان به OneUptime وارد شوند، و مدیریت متمرکز دسترسی و امنیت بیشتری فراهم می‌کند.

## نمای کلی

یکپارچه‌سازی SSO این مزایا را فراهم می‌کند:

- **احراز هویت متمرکز**: کاربران با اعتبارنامه‌های سازمانی موجودشان وارد می‌شوند
- **امنیت بیشتر**: از احراز هویت چندعاملی و سیاست‌های امنیتی IdP خود بهره ببرید
- **مدیریت ساده‌تر کاربر**: دسترسی را از سامانه مدیریت هویت موجودتان مدیریت کنید
- **خستگی کمتر از گذرواژه**: کاربران لازم نیست گذرواژه جداگانه‌ای برای OneUptime به یاد بسپارند

## برپا کردن SSO

1. **رفتن به تنظیمات پروژه**

   - به پروژه OneUptime خود بروید
   - به **Project Settings** > **Security** > **SSO** بروید

2. **ساخت پیکربندی SSO**

   - روی **Create SSO** کلیک کنید
   - **Name**ای برای پیکربندی SSO وارد کنید (برای نمونه «Keycloak SAML» یا «Okta SAML»)
   - **Sign On URL** را از ارائه‌دهنده هویت خود وارد کنید
   - **Issuer** (شناسه موجودیت) را از ارائه‌دهنده هویت خود وارد کنید
   - **Public Certificate** را از ارائه‌دهنده هویت خود بچسبانید
   - **Signature Algorithm** را برگزینید (برای نمونه `RSA-SHA-256`)
   - **Digest Algorithm** را برگزینید (برای نمونه `SHA256`)

3. **گرفتن فراداده SSO از OneUptime**
   - پس از ذخیره، روی دکمه **View SSO Config** کلیک کنید
   - **Identifier (Entity ID)** را کپی کنید — این در پیکربندی IdP شما لازم است
   - **Reply URL (Assertion Consumer Service URL)** را کپی کنید — این در پیکربندی IdP شما لازم است

## پیکربندی SAML در Keycloak

‏Keycloak راه‌حل متن‌باز و محبوبی برای مدیریت هویت و دسترسی است. این گام‌ها را برای پیکربندی Keycloak به‌عنوان ارائه‌دهنده هویت SAML برای OneUptime دنبال کنید.

### پیش‌نیازها

- نمونه‌ای در حال اجرا از Keycloak با قلمرویی پیکربندی‌شده
- دسترسی مدیر به هر دوی Keycloak و OneUptime
- حسابی در OneUptime با پشتیبانی SSO

### گام ۱: پیکربندی SSO در OneUptime

1. به داشبورد OneUptime خود وارد شوید
2. به **Project Settings** > **Security** > **SSO** بروید
3. روی **Create SSO** کلیک کنید و این‌ها را پر کنید:
   - **Name**: نامی توصیفی (برای نمونه `my-project-oneuptime`)
   - **Sign On URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Issuer**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Certificate**: [گام ۲](#step-2-get-the-keycloak-certificate) پایین را ببینید
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. پیکربندی را ذخیره کنید

### گام ۲: گرفتن گواهی Keycloak

1. در Keycloak به پیکربندی کلاینت خود بروید
2. روی **Export** کلیک کنید (یا بسته به نسخه Keycloak به زبانه **Keys** بروید)
3. در فایل JSON صادرشده، کلیدی را که `certificate` در نامش هست بیابید
4. مقدار گواهی را کپی کنید و در OneUptime در این قالب بچسبانید:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### گام ۳: پیکربندی کلاینت Keycloak

1. در Keycloak، در قلمرو خود به **Clients** بروید
2. کلاینتی تازه بسازید یا موجودی را ویرایش کنید
3. مقدار **Client Protocol** را روی `saml` بگذارید
4. مقدار **Client ID** را روی مقدار **Identifier (Entity ID)** از **View SSO Config** در OneUptime بگذارید
5. مقدار **Valid Redirect URIs** را روی نشانی OneUptime خود بگذارید
6. مقدار **Root URL** را روی نشانی پایه OneUptime خود بگذارید
7. مقدار **Reply URL (Assertion Consumer Service URL)** از OneUptime را در فیلد **Assertion Consumer Service POST Binding URL** بچسبانید

### گام ۴: پیکربندی تنظیمات کلاینت Keycloak

1. گزینه **Signing keys config** را غیرفعال کنید (زیر زبانه Keys)
2. مقدار **Name ID Format** را روی `email` بگذارید
3. مطمئن شوید گزینه **Force Name ID Format** فعال است تا Keycloak همیشه ایمیل را به‌عنوان Name ID بفرستد

### گام ۵: تأیید پیکربندی

1. همه تنظیمات را در هر دوی Keycloak و OneUptime ذخیره کنید
2. بکوشید با SSO به OneUptime وارد شوید
3. باید به صفحه ورود Keycloak هدایت شوید و پس از احراز هویت موفق به OneUptime برگردید

### رفع اشکال Keycloak

- **ورود با خطای امضا شکست می‌خورد**: مطمئن شوید گواهی درست کپی شده، از جمله خط‌های `BEGIN CERTIFICATE` و `END CERTIFICATE`
- **خطای Name ID**: تأیید کنید **Name ID Format** در Keycloak روی `email` باشد
- **حلقه هدایت**: بررسی کنید **Valid Redirect URIs** و **Assertion Consumer Service POST Binding URL** درست پیکربندی شده باشند
- **گواهی یافت نشد**: مطمئن شوید از کلاینت درست در قلمرو درست صادر می‌کنید

---

## پیکربندی SAML در Microsoft Entra ID (پیش‌تر Azure AD / Active Directory)

‏Microsoft Entra ID سرویس ابری مایکروسافت برای مدیریت هویت و دسترسی است. این گام‌ها را برای پیکربندی Entra ID به‌عنوان ارائه‌دهنده هویت SAML برای OneUptime دنبال کنید.

### پیش‌نیازها

- مستأجری در Microsoft Entra ID (هر رده‌ای که از برنامه‌های سازمانی با SSO از نوع SAML پشتیبانی کند)
- دسترسی مدیر به هر دوی Microsoft Entra ID و OneUptime
- حسابی در OneUptime با پشتیبانی SSO

### گام ۱: پیکربندی SSO در OneUptime

1. به داشبورد OneUptime خود وارد شوید
2. به **Project Settings** > **Security** > **SSO** بروید
3. روی **Create SSO** کلیک کنید و این‌ها را پر کنید:
   - **Name**: نامی توصیفی (برای نمونه `Azure AD SAML`)
   - **Sign On URL**: این را در [گام ۳](#step-3-configure-saml-sso-in-entra-id) از Entra ID می‌گیرید
   - **Issuer**: این را در [گام ۳](#step-3-configure-saml-sso-in-entra-id) از Entra ID می‌گیرید
   - **Certificate**: این را در [گام ۳](#step-3-configure-saml-sso-in-entra-id) از Entra ID می‌گیرید
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. روی **View SSO Config** کلیک کنید و **Identifier (Entity ID)** و **Reply URL (Assertion Consumer Service URL)** را کپی کنید — برای Entra ID لازمشان خواهید داشت

### گام ۲: ساخت برنامه سازمانی در Microsoft Entra ID

1. به [مرکز مدیریت Microsoft Entra](https://entra.microsoft.com) وارد شوید
2. به **Identity** > **Applications** > **Enterprise applications** بروید
3. روی **+ New application** کلیک کنید
4. روی **+ Create your own application** کلیک کنید
5. نامی وارد کنید (برای نمونه «OneUptime»)
6. گزینه **Integrate any other application you don't find in the gallery (Non-gallery)** را برگزینید
7. روی **Create** کلیک کنید

### گام ۳: پیکربندی SSO از نوع SAML در Entra ID

1. در برنامه سازمانی تازه‌تان، به **Single sign-on** بروید
2. گزینه **SAML** را به‌عنوان روش ورود یکپارچه برگزینید
3. در **Basic SAML Configuration** روی **Edit** کلیک کنید و تنظیم کنید:
   - **Identifier (Entity ID)**: مقدار **Identifier (Entity ID)** از **View SSO Config** در OneUptime را بچسبانید
   - **Reply URL (Assertion Consumer Service URL)**: مقدار **Reply URL** از **View SSO Config** در OneUptime را بچسبانید
4. روی **Save** کلیک کنید
5. در بخش **SAML Certificates**:
   - **Certificate (Base64)** را دانلود کنید
   - فایل گواهی دانلودشده را در ویرایشگر متن باز کنید و محتوایش را کپی کنید
6. در بخش **Set up OneUptime**، این‌ها را کپی کنید:
   - **Login URL** — این را به‌عنوان **Sign On URL** در OneUptime بچسبانید
   - **Azure AD Identifier** — این را به‌عنوان **Issuer** در OneUptime بچسبانید
7. به OneUptime برگردید و گواهی و نشانی‌ها را بچسبانید، سپس ذخیره کنید

### گام ۴: پیکربندی ویژگی‌ها و ادعاهای کاربر

1. در صفحه پیکربندی SAML، روی **Edit** در **Attributes & Claims** کلیک کنید
2. مطمئن شوید ادعاهای زیر پیکربندی شده‌اند:

| نام ادعا | مقدار |
| -------------------------------------------------------------------- | --------------------------------------- |
| `Unique User Identifier (Name ID)` | `user.userprincipalname` یا `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname` | `user.givenname` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname` | `user.surname` |

3. مقدار **Name identifier format** را روی `Email address` بگذارید
4. روی **Save** کلیک کنید

### گام ۵: تخصیص کاربران و گروه‌ها

1. در برنامه سازمانی خود به **Users and groups** بروید
2. روی **+ Add user/group** کلیک کنید
3. کاربران و/یا گروه‌هایی را که می‌خواهید دسترسی SSO بگیرند برگزینید
4. روی **Assign** کلیک کنید

### گام ۶: تأیید پیکربندی

1. همه تنظیمات را در هر دوی Entra ID و OneUptime ذخیره کنید
2. بکوشید با SSO به OneUptime وارد شوید
3. باید به صفحه ورود مایکروسافت هدایت شوید و پس از احراز هویت موفق به OneUptime برگردید

### رفع اشکال Microsoft Entra ID

- **خطای AADSTS700016**: مقدار Identifier (Entity ID) در Entra ID با OneUptime نمی‌خواند — تأیید کنید هر دو مقدار یکسان باشند
- **خطای گواهی**: مطمئن شوید گواهی **Base64** را دانلود کرده‌اید (نه قالب خام/دودویی) و خط‌های `BEGIN CERTIFICATE` / `END CERTIFICATE` را گنجانده‌اید
- **کاربر تخصیص نیافته**: کاربران پیش از ورود از راه SSO باید صریح به برنامه سازمانی تخصیص یابند
- **ناسازگاری Name ID**: مطمئن شوید ادعای Name ID روی نشانی ایمیلی تنظیم شده که با ایمیل کاربر در OneUptime می‌خواند

---

## پیکربندی SAML در Okta

‏Okta پلتفرم هویتی پرکاربردی است که قابلیت‌های استوار SSO از نوع SAML فراهم می‌کند. این گام‌ها را برای پیکربندی Okta به‌عنوان ارائه‌دهنده هویت SAML برای OneUptime دنبال کنید.

### پیش‌نیازها

- سازمانی در Okta با دسترسی مدیر
- حسابی در OneUptime با پشتیبانی SSO

### گام ۱: پیکربندی SSO در OneUptime

1. به داشبورد OneUptime خود وارد شوید
2. به **Project Settings** > **Security** > **SSO** بروید
3. روی **Create SSO** کلیک کنید و این‌ها را پر کنید:
   - **Name**: نامی توصیفی (برای نمونه `Okta SAML`)
   - **Sign On URL**: این را در [گام ۳](#step-3-copy-okta-saml-metadata-to-oneuptime) از Okta می‌گیرید
   - **Issuer**: این را در [گام ۳](#step-3-copy-okta-saml-metadata-to-oneuptime) از Okta می‌گیرید
   - **Certificate**: این را در [گام ۳](#step-3-copy-okta-saml-metadata-to-oneuptime) از Okta می‌گیرید
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. روی **View SSO Config** کلیک کنید و **Identifier (Entity ID)** و **Reply URL (Assertion Consumer Service URL)** را کپی کنید — برای Okta لازمشان خواهید داشت

### گام ۲: ساخت برنامه SAML در Okta

1. به کنسول مدیریت Okta خود وارد شوید
2. به **Applications** > **Applications** بروید
3. روی **Create App Integration** کلیک کنید
4. گزینه **SAML 2.0** را برگزینید و **Next** را بزنید
5. نام برنامه را «OneUptime» بگذارید و **Next** را بزنید
6. در بخش **SAML Settings** پیکربندی کنید:
   - **Single sign-on URL**: مقدار **Reply URL (Assertion Consumer Service URL)** از **View SSO Config** در OneUptime را بچسبانید
   - **Audience URI (SP Entity ID)**: مقدار **Identifier (Entity ID)** از **View SSO Config** در OneUptime را بچسبانید
   - **Name ID format**: گزینه `EmailAddress` را برگزینید
   - **Application username**: گزینه `Email` را برگزینید
7. روی **Next** کلیک کنید، سپس **I'm an Okta customer adding an internal app** را برگزینید و **Finish** را بزنید

### گام ۳: کپی کردن فراداده SAML از Okta به OneUptime

1. در برنامه Okta خود به زبانه **Sign On** بروید
2. در بخش **SAML Signing Certificates**، گواهی فعال را بیابید و روی **Actions** > **View IdP metadata** کلیک کنید
3. از XML فراداده، یا از جزئیات زبانه **Sign On**:
   - **Sign On URL** را کپی کنید (که **Identity Provider Single Sign-On URL** هم نامیده می‌شود) — این را به‌عنوان **Sign On URL** در OneUptime بچسبانید
   - **Issuer** را کپی کنید (که **Identity Provider Issuer** هم نامیده می‌شود) — این را به‌عنوان **Issuer** در OneUptime بچسبانید
4. گواهی امضا را دانلود کنید:
   - در بخش **SAML Signing Certificates**، برای گواهی فعال روی **Actions** > **Download certificate** کلیک کنید
   - فایل `.cert` دانلودشده را در ویرایشگر متن باز کنید و محتوایش را کپی کنید
   - گواهی را در OneUptime بچسبانید (از جمله خط‌های `BEGIN CERTIFICATE` و `END CERTIFICATE`)
5. پیکربندی SSO در OneUptime را ذخیره کنید

### گام ۴: پیکربندی بیانیه‌های ویژگی (اختیاری)

1. در برنامه Okta به زبانه **General** بروید
2. در بخش **SAML Settings** روی **Edit** کلیک کنید و **Next** را بزنید تا به تنظیمات SAML برسید
3. در بخش **Attribute Statements** این‌ها را بیفزایید:

| نام | مقدار |
| ----------- | ---------------- |
| `email` | `user.email` |
| `firstName` | `user.firstName` |
| `lastName` | `user.lastName` |

4. روی **Next** و سپس **Finish** کلیک کنید

### گام ۵: تخصیص کاربران و گروه‌ها

1. در برنامه Okta خود به زبانه **Assignments** بروید
2. روی **Assign** > **Assign to People** یا **Assign to Groups** کلیک کنید
3. کاربران یا گروه‌هایی را که می‌خواهید دسترسی SSO بگیرند برگزینید
4. برای هر انتخابی **Assign** را بزنید، سپس **Done** را کلیک کنید

### گام ۶: تأیید پیکربندی

1. همه تنظیمات را در هر دوی Okta و OneUptime ذخیره کنید
2. بکوشید با SSO به OneUptime وارد شوید
3. باید به صفحه ورود Okta هدایت شوید و پس از احراز هویت موفق به OneUptime برگردید

### رفع اشکال Okta

- **‏۴۰۴ یا نشانی SSO نامعتبر**: تأیید کنید **Single sign-on URL** در Okta دقیقاً با **Reply URL** از OneUptime بخواند
- **ناسازگاری Audience**: مطمئن شوید **Audience URI** در Okta دقیقاً با **Identifier (Entity ID)** از OneUptime می‌خواند
- **خطای گواهی**: مطمئن شوید گواهی امضای **فعال** را دانلود کرده‌اید، نه غیرفعالی را
- **کاربر تخصیص نیافته**: کاربران پیش از ورود از راه SSO باید به برنامه Okta تخصیص یابند
- **خطای Name ID**: تأیید کنید **Name ID format** روی `EmailAddress` و **Application username** روی `Email` باشد

---

## دیگر ارائه‌دهندگان هویت

پیاده‌سازی SSO در OneUptime پروتکل SAML 2.0 را به کار می‌برد و باید با هر ارائه‌دهنده هویت سازگاری کار کند. گام‌های کلی پیکربندی این‌هایند:

1. در OneUptime پیکربندی SSOای بسازید و **Identifier (Entity ID)** و **Reply URL (Assertion Consumer Service URL)** را از دکمه **View SSO Config** یادداشت کنید
2. در ارائه‌دهنده هویت خود، برنامه‌ای SAML بسازید با:
   - **Assertion Consumer Service URL / Reply URL**: از پیکربندی SSO در OneUptime
   - **Entity ID / Audience URI**: از پیکربندی SSO در OneUptime
   - **Name ID Format**: نشانی ایمیل
3. از ارائه‌دهنده هویت خود، این‌ها را در OneUptime کپی کنید:
   - **Sign On URL** (نقطه پایانی SSO)
   - **Issuer** (شناسه موجودیت IdP)
   - **Public Certificate** (گواهی امضای X.509)
4. مقدار **Signature Algorithm** را روی `RSA-SHA-256` و **Digest Algorithm** را روی `SHA256` بگذارید

## یادداشت‌هایی درباره SSO و نقش‌ها

‏OneUptime در حال حاضر از نگاشت نقش‌های SAML از ارائه‌دهنده هویت شما پشتیبانی نمی‌کند. دسترسی نقش‌محور باید جداگانه در **Project Settings** > **Security** > **SSO** در OneUptime پیکربندی شود، جایی که می‌توانید نقش‌های پیش‌فرض را به کاربران SSO تخصیص دهید.
