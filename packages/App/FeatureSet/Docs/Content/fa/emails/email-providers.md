# ارائه‌دهندگان ایمیل

ایمیل‌های OneUptime را به‌جای یک سرور SMTP از راه API مبتنی بر HTTPS یک ارائه‌دهندهٔ ایمیل بفرستید: Amazon SES، SendGrid، Mailgun، Postmark یا Resend. یک پروژه یکی از آن‌ها را برای یک پیکربندی SMTP برمی‌گزیند، و یک نصب خودمیزبان می‌تواند همهٔ ایمیل‌های خودش را از راه یکی از آن‌ها بفرستد. API از راه HTTPS روی پورت ۴۴۳ در دسترس است، پس ایمیل از شبکه‌هایی که پورت‌های SMTP را مسدود می‌کنند هم بیرون می‌رود، و کلید هر ارائه‌دهنده رمزگذاری‌شده ذخیره می‌شود.

:::cards
- [Amazon SES](#amazon-ses): یک کلید دسترسی IAM، یا نقش IAM خود سرور، و منطقه‌ای که فرستندهٔ شما در آن تأیید شده است.
- [SendGrid](#sendgrid): یک کلید API با دسترسی Mail Send.
- [Mailgun](#mailgun): یک کلید API، دامنهٔ ارسال و منطقهٔ آن.
- [Postmark](#postmark): توکن API سرور.
- [Resend](#resend): یک کلید API با دسترسی فرستادن.
- [متغیرهای محیطی](#تعیین-ایمیل-سرور-با-متغیرهای-محیطی): ایمیل یک سرور خودمیزبان را از values در Helm یا `config.env` تعیین کنید.
- [عیب‌یابی](#عیبیابی): رد شدن از سوی هر ارائه‌دهنده چه معنایی دارد.
:::

## انتخاب ارائه‌دهنده

:::tabs
@tab پروژه
در **تنظیمات پروژه** > **اعلان‌ها** > **کانال‌های اعلان**، **تنظیمات بیشتر** را باز کنید و در کارت **پیکربندی‌های SMTP سفارشی** روی **ساخت پیکربندی SMTP** کلیک کنید. در گام **ارائه‌دهنده**، یک **نام** وارد کنید و ارائه‌دهنده را برگزینید. گام بعدی تنظیمات همان ارائه‌دهنده را می‌پرسد، و گام **فرستنده** نیز **ایمیل فرستنده** و **نام فرستنده** را. پس از ذخیره، با **ارسال ایمیل آزمایشی** در ردیف پیکربندی بررسی کنید که کار می‌کند.
@tab نمونهٔ خودمیزبان
در Admin Dashboard، **تنظیمات** را باز کنید، سپس **اعلان‌ها** > **ایمیل‌ها** را. در کارت **تنظیمات سرور ایمیل**، روی **ویرایش سرور** کلیک کنید و ارائه‌دهنده را به‌عنوان **نوع سرور ایمیل** برگزینید. کارت ارائه‌دهنده زیر آن پدیدار می‌شود، مانند **تنظیمات Amazon SES**: روی دکمهٔ ویرایش آن، مانند **ویرایش Amazon SES**، کلیک کنید و تنظیمات ارائه‌دهنده و گام **فرستنده** را پر کنید. تا وقتی همهٔ آنچه لازم است پر نشده، کارت می‌گوید چه چیزی کم است، و هر ایمیل با نام تنظیمی که باید پر شود رد می‌شود. سروری که از روی کد مستقر می‌شود می‌تواند آن‌ها را به‌جای آن با متغیرهای محیطی تعیین کند: [تعیین ایمیل سرور با متغیرهای محیطی](#تعیین-ایمیل-سرور-با-متغیرهای-محیطی) را ببینید.
:::

| ارائه‌دهنده | چه چیزی می‌خواهد | OneUptime به کجا می‌فرستد |
| --- | --- | --- |
| Amazon SES | شناسه کلید دسترسی، کلید دسترسی محرمانه، منطقه | `https://email.<region>.amazonaws.com` (SES API v2) |
| SendGrid | کلید API | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | کلید API، دامنه، منطقه | `https://api.mailgun.net` یا `https://api.eu.mailgun.net` |
| Postmark | توکن API سرور | `https://api.postmarkapp.com/email` |
| Resend | کلید API | `https://api.resend.com/emails` |

هر ایمیل همراه با بخش متنی‌اش فرستاده می‌شود، و تصویرهایش (لوگوی OneUptime، نماگرفت‌ها) به‌صورت پیوست‌های درون‌خطی. وقتی یک ارائه‌دهنده سرعت فرستادن شما را محدود می‌کند، یا در سمت خودش با خطا روبه‌رو می‌شود، OneUptime پس از مدت انتظاری که ارائه‌دهنده می‌خواهد دوباره تلاش می‌کند؛ هر رد دیگری، همراه با پاسخ ارائه‌دهنده، در گزارش‌های اعلان نگه داشته می‌شود.

## Amazon SES

:::steps
### فرستنده را تأیید کنید

در [کنسول Amazon SES](https://console.aws.amazon.com/ses/)، در منطقه‌ای که از آن خواهید فرستاد، نشانی‌ای را که از آن می‌فرستید یا دامنهٔ آن را زیر **Identities** تأیید کنید. تا وقتی حساب شما در سندباکس SES است، هر گیرنده را هم تأیید کنید، یا دسترسی محیط تولید را درخواست کنید.

### یک کلید دسترسی بسازید

برای OneUptime یک کاربر IAM با سیاستی بسازید که `ses:SendEmail` را روی هویت شما مجاز می‌کند، سپس برای آن کاربر یک کلید دسترسی بسازید:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:123456789012:identity/example.com"
    }
  ]
}
```

یک نصب خودمیزبان روی AWS می‌تواند از کلید بگذرد و به‌جای آن، با همین سیاست، [با نقش IAM سرور وارد شود](#ورود-با-نقش-iam-سرور).

### گام Amazon SES را پر کنید

**شناسه کلید دسترسی** و **کلید دسترسی محرمانه** را وارد کنید، و در **منطقه** همان منطقه‌ای را بگذارید که هویت شما در آن تأیید شده است، مانند `us-east-1`.
:::

### ورود با نقش IAM سرور

یک نصب خودمیزبان روی AWS می‌تواند ایمیل‌های خودش را با نقش IAM که AWS به سرور می‌دهد بفرستد، بی‌آنکه کلید دسترسی‌ای در OneUptime نگهداری شود: اعتبارنامه‌هایی که AWS می‌دهد ظرف چند ساعت منقضی می‌شوند، و OneUptime پیش از آن اعتبارنامه‌های تازه می‌گیرد. این فقط برای ایمیل‌های خود سرور است. پیکربندی Amazon SES یک پروژه همیشه با کلید دسترسی وارد می‌شود، چون نقش سرور هویت AWS خود سرور است، نه هویت یک پروژه.

سیاست بالا را به نقش بدهید، سپس OneUptime را با آن نقش اجرا کنید:

:::tabs
@tab Amazon EKS
با نقش‌های IAM برای حساب‌های سرویس، نقش را با یک سیاست اعتماد برای ارائه‌دهندهٔ OIDC کلاستر خود بسازید، و بگذارید چارت Helm یک حساب سرویس با ARN نقش بسازد. پادهای app و worker در OneUptime با آن اجرا می‌شوند:

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

با EKS Pod Identity، به‌جای آن یک پیوند Pod Identity میان نقش و همان حساب سرویس بسازید، و annotation را حذف کنید.
@tab Amazon ECS
نقش را به‌عنوان **Task role** در تعریف تسک OneUptime تنظیم کنید.
@tab Amazon EC2
نقش را به‌عنوان پروفایل اینستنس به اینستنس متصل کنید. اگر OneUptime در Docker روی اینستنس اجرا می‌شود، محدودیت hop متادیتای اینستنس را به 2 برسانید تا کانتینرها به آن دسترسی داشته باشند:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

سپس در Admin Dashboard روی **ویرایش Amazon SES** کلیک کنید، **نقش IAM این سرور** را به‌عنوان **نوع احراز هویت** برگزینید، و **منطقه** را وارد کنید. ذخیره کردن آن هر کلید دسترسی‌ای را که پیش‌تر نگهداری شده بود حذف می‌کند.

OneUptime اعتبارنامه‌های سرور را همان‌جایی می‌جوید که SDKهای AWS می‌جویند، به این ترتیب: `AWS_ACCESS_KEY_ID` و `AWS_SECRET_ACCESS_KEY` در محیط آن، یک توکن هویت وب (`AWS_ROLE_ARN` و `AWS_WEB_IDENTITY_TOKEN_FILE`)، نقطهٔ پایانی اعتبارنامه‌های کانتینر در Amazon ECS و EKS Pod Identity، و سپس سرویس متادیتای اینستنس EC2 (IMDSv2).

## SendGrid

در SendGrid، **Settings > API Keys** را باز کنید و کلیدی با دسترسی **Mail Send** بسازید، و نشانی‌ای را که از آن می‌فرستید (Single Sender Verification) یا دامنهٔ آن را (Domain Authentication) تأیید کنید. کلید را به‌عنوان **کلید API** در گام **SendGrid** وارد کنید.

## Mailgun

در Mailgun، دامنهٔ ارسال خود را بیفزایید و تأیید کنید، مانند `mg.example.com`، سپس یک کلید ارسال برای آن بسازید، یا از کلید API حساب خود استفاده کنید. در گام **Mailgun**، **کلید API** و **دامنه** را وارد کنید، و در **منطقه** همان منطقه‌ای را برگزینید که دامنه در آن ساخته شده است: `EU` برای دامنه‌ای در منطقهٔ EU در Mailgun، و `US` برای بقیه. **ایمیل فرستنده** باید نشانی‌ای در همان دامنه باشد. یک دامنهٔ سندباکس فقط به گیرندگان مجاز خود می‌فرستد.

## Postmark

در Postmark، سروری را که ایمیل می‌فرستد باز کنید، سپس زبانهٔ **API Tokens** آن را، و توکن API سرور را کپی کنید: با توکن حساب نمی‌توان ایمیل فرستاد. آن را به‌عنوان **توکن API سرور** در گام **Postmark** وارد کنید. **ایمیل فرستنده** باید یک امضای فرستندهٔ تأییدشده باشد، یا نشانی‌ای در یک دامنهٔ تأییدشده. تا وقتی Postmark حساب شما را نپذیرفته است، فقط به نشانی‌هایی در دامنهٔ خود شما می‌فرستد.

## Resend

در Resend، دامنهٔ خود را زیر **Domains** بیفزایید و تأیید کنید، سپس زیر **API Keys** یک کلید API با دسترسی فرستادن بسازید. آن را به‌عنوان **کلید API** در گام **Resend** وارد کنید، و **ایمیل فرستنده** را نشانی‌ای در دامنهٔ تأییدشدهٔ خود بگذارید. دامنهٔ آزمایشی خود Resend فقط به نشانی خود شما می‌فرستد.

## تعیین ایمیل سرور با متغیرهای محیطی

یک سرور خودمیزبان که از روی کد مستقر می‌شود می‌تواند از همان ابتدا ایمیل بفرستد، بی‌آنکه چیزی دستی تنظیم شود: تنظیمات ایمیل آن را با متغیرهای محیطی تعیین کنید، از Terraform یا هر چیزی که OneUptime را مستقر می‌کند. وقتی `GLOBAL_EMAIL_SERVER_TYPE` تعیین شده باشد، سرور ایمیل‌های خودش را همان‌طور که متغیرها توصیف می‌کنند می‌فرستد. تنظیماتی که در Admin Dashboard زیر **تنظیمات** و سپس **اعلان‌ها** > **ایمیل‌ها** ذخیره شده‌اند استفاده نمی‌شوند، و آن صفحه این تنظیمات را فقط‌خواندنی نشان می‌دهد، هر فیلد همراه با متغیری که آن را تعیین می‌کند. برای آنکه ایمیل را به‌جای آن در Admin Dashboard تنظیم کنید، `GLOBAL_EMAIL_SERVER_TYPE` را خالی بگذارید. پیکربندی‌های SMTP پروژه‌ها تغییری نمی‌کنند.

| متغیر | مقدار Helm | چه چیزی در آن است |
| --- | --- | --- |
| `GLOBAL_EMAIL_SERVER_TYPE` | `email.serverType` | `custom-smtp`، `sendgrid`، `amazon-ses`، `mailgun`، `postmark` یا `resend`. تنها وقتی تعیین شده باشد، OneUptime متغیرهای دیگر را می‌خواند |
| `GLOBAL_EMAIL_FROM_EMAIL` | `email.fromEmail` | نشانی‌ای که هر ایمیل از آن فرستاده می‌شود |
| `GLOBAL_EMAIL_FROM_NAME` | `email.fromName` | نامی که هر ایمیل با آن فرستاده می‌شود. برای `custom-smtp` و `sendgrid` لازم است |
| `GLOBAL_EMAIL_SMTP_TRANSPORT` | `email.smtp.transport` | `smtp` (وقتی خالی است هم همین)، یا `microsoft-graph` برای فرستادن از راه Microsoft Graph با برنامهٔ OAuth |
| `GLOBAL_EMAIL_SMTP_HOST` | `email.smtp.host` | سرور ایمیل، مانند `smtp.example.com` |
| `GLOBAL_EMAIL_SMTP_PORT` | `email.smtp.port` | درگاه آن، مانند `587` |
| `GLOBAL_EMAIL_SMTP_REQUIRE_TLS` | `email.smtp.requireTls` | `true` برای فرستادن فقط از راه اتصال رمزگذاری‌شده با گواهی معتبر، یا `false` (وقتی خالی است هم همین) |
| `GLOBAL_EMAIL_SMTP_AUTH_TYPE` | `email.smtp.authType` | `username-and-password` (وقتی خالی است هم همین)، `oauth` یا `none` |
| `GLOBAL_EMAIL_SMTP_USERNAME` | `email.smtp.username` | صندوق پستی‌ای که با آن وارد می‌شود، برای `oauth` هم. آن را همراه با گذرواژه خالی بگذارید تا بدون ورود فرستاده شود |
| `GLOBAL_EMAIL_SMTP_PASSWORD` | `email.smtp.password`، یا یک Secret که در `email.existingSecret.name` نام برده شده | گذرواژهٔ آن |
| `GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE` | `email.smtp.oauth.providerType` | `client-credentials` (وقتی خالی است هم همین) یا `jwt-bearer` |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID` | `email.smtp.oauth.clientId` | شناسهٔ کلاینت برنامهٔ OAuth |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET` | `email.smtp.oauth.clientSecret`، یا یک Secret که در `email.existingSecret.name` نام برده شده | رمز کلاینت آن؛ برای `jwt-bearer`، کلید خصوصی آن در قالب PEM |
| `GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL` | `email.smtp.oauth.tokenUrl` | نشانی توکن آن |
| `GLOBAL_EMAIL_SMTP_OAUTH_SCOPE` | `email.smtp.oauth.scope` | scope آن |
| `GLOBAL_EMAIL_SENDGRID_API_KEY` | `email.sendgrid.apiKey`، یا یک Secret که در `email.existingSecret.name` نام برده شده | کلید API سرویس SendGrid |
| `GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE` | `email.amazonSes.authenticationType` | `access-key` (وقتی خالی است هم همین)، یا `server-iam-role` برای ورود با نقش IAM سرور |
| `GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID` | `email.amazonSes.accessKeyId` | شناسهٔ کلید دسترسی |
| `GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY` | `email.amazonSes.secretAccessKey`، یا یک Secret که در `email.existingSecret.name` نام برده شده | کلید دسترسی مخفی آن |
| `GLOBAL_EMAIL_AMAZON_SES_REGION` | `email.amazonSes.region` | منطقه‌ای که فرستندهٔ شما در آن تأیید شده، مانند `us-east-1` |
| `GLOBAL_EMAIL_MAILGUN_API_KEY` | `email.mailgun.apiKey`، یا یک Secret که در `email.existingSecret.name` نام برده شده | کلید API سرویس Mailgun |
| `GLOBAL_EMAIL_MAILGUN_DOMAIN` | `email.mailgun.domain` | دامنهٔ ارسال، مانند `mg.example.com` |
| `GLOBAL_EMAIL_MAILGUN_REGION` | `email.mailgun.region` | `us` (وقتی خالی است هم همین) یا `eu` |
| `GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN` | `email.postmark.serverToken`، یا یک Secret که در `email.existingSecret.name` نام برده شده | توکن API سرور در Postmark |
| `GLOBAL_EMAIL_RESEND_API_KEY` | `email.resend.apiKey`، یا یک Secret که در `email.existingSecret.name` نام برده شده | کلید API سرویس Resend |

تنها متغیرهایی به کار می‌روند که نوع سرور می‌خواند: متغیرهای `GLOBAL_EMAIL_SMTP_` برای `custom-smtp`، و متغیرهای خود هر ارائه‌دهنده برای همان ارائه‌دهنده. لاگ سرور و Admin Dashboard هر متغیر دیگری را که تعیین شده، به‌عنوان استفاده‌نشده نام می‌برند.

با Helm آن‌ها را زیر `email` در values خود تعیین کنید. برای آنکه گذرواژه یا کلید در valuesی که Helm با هر release ذخیره می‌کند نماند، آن را در یک Secret از آنِ خودتان بگذارید و همان Secret را در `email.existingSecret.name` نام ببرید. چارت آن را از کلیدی می‌خواند که در `email.existingSecret.key` نام برده شده، وگرنه از کلیدی که به نام آن است: `smtpPassword`، `smtpOAuthClientSecret`، `sendgridApiKey`، `amazonSesSecretAccessKey`، `mailgunApiKey`، `postmarkServerToken` یا `resendApiKey`.

```bash
kubectl create secret generic oneuptime-email --namespace oneuptime \
  --from-literal=smtpPassword=YOUR_SMTP_PASSWORD
```

```yaml
email:
  serverType: custom-smtp
  fromEmail: alerts@example.com
  fromName: OneUptime
  smtp:
    host: smtp.example.com
    port: 587
    requireTls: true
    username: alerts@example.com
  existingSecret:
    name: oneuptime-email
```

چارت مقدارهای دیگر `email` را بدون `email.serverType`، تنظیماتی را بدون گذرواژه یا کلیدی که می‌خوانند، گذرواژه یا کلیدی را که هم در values و هم در یک Secret داده شده، و Secretی را که تنظیمات چیزی از آن نمی‌خوانند، نمی‌پذیرد. با Terraform همین مقدارها را روی یک `helm_release` تعیین کنید و گذرواژه یا کلید را به‌عنوان مقداری حساس بدهید.

با Docker Compose، تنظیمات `GLOBAL_EMAIL_` را در `config.env` تعیین کنید و سپس `npm run start` را اجرا کنید تا کانتینرها دوباره ساخته شوند.

OneUptime متغیرها را هنگام شروع می‌خواند. اگر یکی از آن‌ها نادرست باشد، مثلاً درگاهی که عدد نیست یا گذرواژه‌ای که داده نشده، سرور تا وقتی درست نشده هیچ ایمیلی نمی‌فرستد؛ لاگ سرور، تنظیمات ایمیل در Admin Dashboard و چک‌لیست `/admin/setup` نام متغیر را می‌گویند. گذرواژه‌ها و کلیدها هرگز نشان داده نمی‌شوند. برای تغییر تنظیمات، متغیرها را تغییر دهید و OneUptime را دوباره راه‌اندازی کنید: Admin Dashboard آن‌ها را تغییر نمی‌دهد.

## عیب‌یابی

ایمیل آزمایشی‌ای که فرستاده نشود، دلیلش را می‌گوید. برای هر ایمیل دیگر، زبانهٔ **ایمیل** در **تنظیمات پروژه** > **اعلان‌ها** > **گزارش‌های اعلان** را باز کنید و در ردیف آن **مشاهده پیام وضعیت** را برگزینید.

:::details "Amazon SES needs a verified identity in …"
**ایمیل فرستنده**، یا دامنهٔ آن، در منطقه‌ای که در پیکربندی تنظیم شده تأیید نشده است، یا حساب در سندباکس SES است و گیرنده تأیید نشده است. آن را در همان منطقه تأیید کنید، یا دسترسی محیط تولید را درخواست کنید.
:::

:::details "Amazon SES does not recognize the access key" یا "did not accept the request's signature"
**شناسه کلید دسترسی** را بررسی کنید، و اینکه کلید در IAM فعال است، و اینکه **کلید دسترسی محرمانه** همانی است که همراه آن ساخته شده است. وقتی ساعت سرور نادرست باشد هم امضا رد می‌شود.
:::

:::details "The access key may not send with Amazon SES"
سیاست کاربر IAM اجازهٔ `ses:SendEmail` را روی هویت شما نمی‌دهد. سیاست بالا را بیفزایید.
:::

:::details "This server has no AWS credentials"
سرور با نقش IAM خود وارد می‌شود، اما AWS هیچ اعتبارنامه‌ای به آن نمی‌دهد. آن را با نقش اجرا کنید، همان‌طور که [ورود با نقش IAM سرور](#ورود-با-نقش-iam-سرور) نشان می‌دهد، سپس پادها یا تسک‌های OneUptime را دوباره راه‌اندازی کنید: هر پاد تنظیمات نقش خود را هنگام شروع می‌گیرد. در Docker روی Amazon EC2، پیام همچنین می‌گوید چه زمانی محدودیت hop متادیتای اینستنس بیش از حد پایین است.
:::

:::details "This server's IAM role may not send with Amazon SES" یا "did not let this server assume the role"
سیاست نقش اجازهٔ `ses:SendEmail` را روی هویت شما نمی‌دهد: سیاست بالا را بیفزایید. یا روی Amazon EKS، سیاست اعتماد نقش اجازهٔ `sts:AssumeRoleWithWebIdentity` را برای ارائه‌دهندهٔ OIDC کلاستر شما و حساب سرویس OneUptime نمی‌دهد.
:::

:::details "Mailgun has no domain … in its US region"
دامنه در منطقه‌ای که پیکربندی به آن می‌فرستد نیست. **دامنه** را بررسی کنید، و اگر دامنه در منطقهٔ EU ساخته شده است، **منطقه** را روی `EU` بگذارید.
:::

:::details "is not a confirmed sender signature in Postmark" یا "is not a verified domain in Resend"
**ایمیل فرستنده** را در داشبورد ارائه‌دهنده به‌عنوان فرستنده تأیید کنید، یا دامنهٔ آن را تأیید کنید.
:::

:::details "did not accept the API key" یا "did not accept the server API token"
کلید روی پیکربندی را بررسی کنید: کلید SendGrid به دسترسی Mail Send نیاز دارد، کلید ارسال Mailgun فقط برای دامنهٔ خودش کار می‌کند، Postmark به توکن سرور نیاز دارد، و کلید Resend به دسترسی فرستادن.
:::

## گام‌های بعدی

:::cards
- [SMTP](/docs/emails/smtp): به‌جای آن از راه سرور ایمیل خودتان یا Microsoft 365 بفرستید.
- [مشترکان و اعلامیه‌ها](/docs/status-pages/subscribers): با پیکربندی SMTP پروژه به مشترکان صفحهٔ وضعیت ایمیل بفرستید.
:::
