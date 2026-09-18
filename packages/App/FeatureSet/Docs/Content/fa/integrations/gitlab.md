# یکپارچه‌سازی GitLab

هنگام ساخت یک حادثه در OneUptime، به‌صورت خودکار یک issue در [GitLab](https://gitlab.com) باز کنید — تا پیگیری مهندسی در همان پروژه‌ای ثبت شود که مالک سرویس تحت تأثیر است.

این یکپارچه‌سازی **خروجی** است: OneUptime [REST API مربوط به GitLab](https://docs.gitlab.com/ee/api/issues.html) را فراخوانی می‌کند. از یک **[گردش کاری](/docs/workflows/index)** در OneUptime با تریگر **Incident → On Create** و یک **مؤلفه API** استفاده می‌کند. روی GitLab.com و GitLab خودمدیریت یکسان کار می‌کند.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## پیش‌نیازها

- یک پروژه GitLab و **Project ID** آن (در صفحه نمای کلی پروژه، زیر نام پروژه نمایش داده می‌شود).
- یک توکن دسترسی که بتواند issue بسازد — یک **Project**، **Group** یا **Personal Access Token** با دامنه `api`: **Settings → Access Tokens**.
- یک پروژه OneUptime که در آن بتوانید گردش کاری بسازید.

## گام ۱ — ذخیره توکن

1. به **Workflows → Global Variables → Create** بروید.
2. نام آن را `GITLAB_TOKEN` بگذارید، توکن را در آن بگذارید و **Is Secret** را روشن کنید.

## گام ۲ — ساخت گردش کاری

1. **Workflows → Create Workflow** را باز کنید، نامش را `Incidents → GitLab Issues` بگذارید و **Builder** را باز کنید.
2. یک تریگر **Incident** با تنظیم **On Create** اضافه کنید. نامش را به `Incident` تغییر دهید.
3. یک بلوک **API** متصل به تریگر اضافه کنید:

   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues` _(به‌جای `12345678` شناسه پروژه خود را بگذارید؛ برای نسخه خودمدیریت، از میزبان خودتان استفاده کنید)_
   - **Headers**:

     ```text
     PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "description": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": "incident,oneuptime"
     }
     ```

4. **Save** بزنید، فعالش کنید و یک حادثه آزمایشی بسازید. دیدن `201 Created` در گزارش‌های گردش کاری یعنی issue ساخته شده است؛ بدنه پاسخ شامل `iid` و `web_url` آن است.

## نکته‌ها

- **GitLab خودمدیریت**: به‌جای `https://gitlab.com` نشانی نمونه خود را بگذارید؛ مسیر `/api/v4/...` تغییری نمی‌کند.
- **مسیر پروژه به‌جای شناسه**: می‌توانید به‌جای شناسه عددی، مسیر را با URL-encode بگذارید — برای نمونه `group%2Fproject`.
- **مسئول / موعد**: `"assignee_ids": [42]` یا `"due_date": "2026-01-31"` را به بدنه اضافه کنید.
- **پیوند برگشتی**: مقدار `{{CreateIssue.response-body.web_url}}` را بخوانید و با یک بلوک **Update Incident** روی حادثه ذخیره کنید.

## رفع اشکال

- **`401`** — توکن نامعتبر یا منقضی است، یا دامنه `api` را ندارد.
- **`404`** — شناسه پروژه نادرست است، یا توکن به یک پروژه خصوصی دسترسی ندارد.
- **`400`** — فیلدی الزامی جا افتاده یا بدشکل است؛ `title` الزامی است.

## در ادامه چه بخوانیم

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوها و راهنمای سریع احراز هویت.
- [GitHub](/docs/integrations/github) — همین ایده برای GitHub.
- [مؤلفه API](/docs/workflows/components#api) — خواندن بدنه پاسخ.
