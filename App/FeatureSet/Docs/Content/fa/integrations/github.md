# یکپارچه‌سازی GitHub

هنگام ساخت یک حادثه در OneUptime، به‌صورت خودکار یک issue در [GitHub](https://github.com) باز کنید — تا پیگیری مهندسی در همان مخزنی دنبال شود که مالک سرویس تحت تأثیر است.

این یکپارچه‌سازی **خروجی** است: OneUptime [REST API مربوط به GitHub](https://docs.github.com/en/rest/issues/issues) را فراخوانی می‌کند. از یک **[گردش کاری](/docs/workflows/index)** در OneUptime با تریگر **Incident → On Create** و یک **مؤلفه API** استفاده می‌کند.

> **دنبال اتصال عمیق‌تر GitHub هستید؟** OneUptime یک یکپارچه‌سازی بومی **GitHub App** هم برای وصل کردن مخازن کد دارد (که عامل هوش مصنوعی و قابلیت‌های کد از آن استفاده می‌کنند). آن با متغیرهای محیطی پیکربندی می‌شود، نه با گردش کاری — [یکپارچه‌سازی GitHub (خودمیزبان)](/docs/self-hosted/github-integration) را ببینید. این صفحه به‌طور مشخص درباره _ثبت issue از روی حادثه_ است.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## پیش‌نیازها

- یک مخزن GitHub که می‌خواهید issueها در آن ثبت شوند.
- توکنی که بتواند issue بسازد:

  - یک **PAT دقیق (fine-grained)** محدود به آن مخزن با دسترسی **Issues: Read and write**، یا
  - یک **PAT کلاسیک** با دامنه `repo`.

  یکی را در [github.com/settings/tokens](https://github.com/settings/tokens) بسازید.

- یک پروژه OneUptime که در آن بتوانید گردش کاری بسازید.

## گام ۱ — ذخیره توکن

1. به **Workflows → Global Variables → Create** بروید.
2. نام آن را `GITHUB_TOKEN` بگذارید، توکن را در آن بگذارید و **Is Secret** را روشن کنید.

## گام ۲ — ساخت گردش کاری

1. **Workflows → Create Workflow** را باز کنید، نامش را `Incidents → GitHub Issues` بگذارید و **Builder** را باز کنید.
2. یک تریگر **Incident** با تنظیم **On Create** اضافه کنید. نامش را به `Incident` تغییر دهید.
3. یک بلوک **API** متصل به تریگر اضافه کنید:

   - **Method**: `POST`
   - **URL**: `https://api.github.com/repos/your-org/your-repo/issues`
   - **Headers**:

     ```text
     Authorization: Bearer {{variable.GITHUB_TOKEN}}
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     User-Agent: OneUptime
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "body": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": ["incident", "oneuptime"]
     }
     ```

4. **Save** بزنید، فعالش کنید و یک حادثه آزمایشی بسازید. دیدن `201 Created` در گزارش‌های گردش کاری یعنی issue ساخته شده است؛ بدنه پاسخ شامل `number` و `html_url` آن است.

## نکته‌ها

- **GitHub Enterprise Server**: از `https://your-host/api/v3/repos/{owner}/{repo}/issues` استفاده کنید.
- **مسئولان / نقطه عطف**: `"assignees": ["octocat"]` یا `"milestone": 3` را به بدنه اضافه کنید.
- **پیوند برگشتی**: مقدار `{{CreateIssue.response-body.html_url}}` را بخوانید و با یک بلوک **Update Incident** روی حادثه ذخیره کنید.

## رفع اشکال

- **`401`** — توکن نادرست یا منقضی است. توکن‌های دقیق باید صریحاً به مخزن و دسترسی **Issues** اجازه بدهند.
- **`403` / محدودیت نرخ** — هدر `User-Agent` را بگنجانید (GitHub درخواست‌های بدون آن را رد می‌کند) و بررسی کنید که به محدودیت نرخ نخورده باشید.
- **`404`** — مسیر `owner/repo` نادرست است، یا توکن یک مخزن خصوصی را نمی‌بیند.
- **`422`** — برچسبی که وجود ندارد اشکالی ندارد (GitHub برچسب‌های ارجاع‌شده را می‌سازد)، اما بدنه بدشکل مشکل‌ساز است — JSON خود را بررسی کنید.

## در ادامه چه بخوانیم

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوها و راهنمای سریع احراز هویت.
- [GitLab](/docs/integrations/gitlab) — همین ایده برای GitLab.
- [یکپارچه‌سازی GitHub (خودمیزبان)](/docs/self-hosted/github-integration) — اتصال بومی GitHub App.
