# Конфигурация SMTP

OneUptime поддерживает отправку электронной почты через пользовательские SMTP-серверы с тремя методами аутентификации:

- **Имя пользователя и пароль** — традиционная SMTP-аутентификация
- **OAuth 2.0** — современная аутентификация для Microsoft 365 и Google Workspace
- **Нет** — для серверов-ретрансляторов, не требующих аутентификации

В этом руководстве описывается настройка аутентификации OAuth 2.0 для Microsoft 365 и Google Workspace.

## Аутентификация OAuth 2.0

OAuth 2.0 обеспечивает более безопасный способ аутентификации на почтовых серверах, особенно для корпоративных сред, где отключена базовая аутентификация. OneUptime поддерживает два типа предоставления OAuth:

- **Client Credentials** — используется Microsoft 365 и большинством OAuth-провайдеров
- **JWT Bearer** — используется сервисными аккаунтами Google Workspace

### Обязательные поля для OAuth

При настройке SMTP с аутентификацией OAuth в OneUptime вам потребуется:

| Поле                    | Описание                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| **Hostname**            | Адрес SMTP-сервера                                                                       |
| **Port**                | Порт SMTP (обычно 587 для STARTTLS или 465 для неявного TLS)                             |
| **Username**            | Адрес электронной почты для отправки                                                     |
| **Authentication Type** | Выберите "OAuth"                                                                         |
| **OAuth Provider Type** | Выберите "Client Credentials" для Microsoft 365 или "JWT Bearer" для Google Workspace    |
| **Client ID**           | Application/Client ID от вашего OAuth-провайдера (для Google: email сервисного аккаунта) |
| **Client Secret**       | Секрет клиента от вашего OAuth-провайдера (для Google: закрытый ключ)                    |
| **Token URL**           | URL конечной точки токена OAuth                                                          |
| **Scope**               | Необходимые области действия OAuth для доступа к SMTP                                    |

---

## Конфигурация Microsoft 365

Для использования OAuth с Microsoft 365/Exchange Online необходимо зарегистрировать приложение в Microsoft Entra (Azure AD) и настроить соответствующие разрешения.

### Шаг 1: Регистрация приложения в Microsoft Entra

1. Войдите в [центр администрирования Microsoft Entra](https://entra.microsoft.com)
2. Перейдите в **Identity** > **Applications** > **App registrations**
3. Нажмите **New registration**
4. Введите имя приложения (например, "OneUptime SMTP")
5. Для **Supported account types** выберите "Accounts in this organizational directory only"
6. Оставьте **Redirect URI** пустым (не требуется для потока client credentials)
7. Нажмите **Register**

После регистрации запишите следующие значения со страницы **Overview**:

- **Application (client) ID** — это ваш Client ID
- **Directory (tenant) ID** — понадобится для Token URL

### Шаг 2: Создание секрета клиента

1. В регистрации вашего приложения перейдите в **Certificates & secrets**
2. Нажмите **New client secret**
3. Добавьте описание и выберите срок действия
4. Нажмите **Add**
5. **Немедленно скопируйте значение секрета** — оно больше не будет показано

### Шаг 3: Добавление разрешений SMTP API

1. Перейдите в **API permissions**
2. Нажмите **Add a permission**
3. Выберите **APIs my organization uses**
4. Найдите и выберите **Office 365 Exchange Online**
5. Выберите **Application permissions**
6. Найдите и отметьте **SMTP.SendAsApp**
7. Нажмите **Add permissions**
8. Нажмите **Grant admin consent for [your organization]** (требуются права администратора)

### Шаг 4: Регистрация субъекта-службы в Exchange Online

Прежде чем ваше приложение сможет отправлять электронные письма, необходимо зарегистрировать субъект-службу в Exchange Online и предоставить разрешения на почтовый ящик.

1. Установите модуль PowerShell Exchange Online:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Подключитесь к Exchange Online:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. Зарегистрируйте субъект-службу (используйте Object ID из **Enterprise Applications**, а не App Registrations):

```powershell
# Найдите Object ID в Microsoft Entra > Enterprise Applications > Your App > Object ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. Предоставьте субъекту-службе разрешение на отправку от имени конкретного почтового ящика:

```powershell
# Предоставьте субъекту-службе полный доступ к почтовому ящику
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **Примечание:** Используйте `Add-MailboxPermission` (не `Add-RecipientPermission`). `Add-RecipientPermission` предоставляет только `SendAs` для получателя и недостаточна для того, чтобы субъект-служба мог отправлять почту через SMTP с OAuth — при отправке возникнет ошибка аутентификации/разрешений. `Add-MailboxPermission` с `FullAccess` — это команда, которая действительно работает.

### Шаг 5: Настройка в OneUptime

В OneUptime создайте или отредактируйте конфигурацию SMTP со следующими настройками:

| Поле                | Значение                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Hostname            | `smtp.office365.com`                                                                                 |
| Port                | `587`                                                                                                |
| Username            | Адрес электронной почты, для которого вы предоставили разрешения (например, `sender@yourdomain.com`) |
| Authentication Type | `OAuth`                                                                                              |
| OAuth Provider Type | `Client Credentials`                                                                                 |
| Client ID           | Ваш Application (client) ID из шага 1                                                                |
| Client Secret       | Значение секрета из шага 2                                                                           |
| Token URL           | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`                                    |
| Scope               | `https://outlook.office365.com/.default`                                                             |
| From Email          | То же, что и Username                                                                                |
| Secure (TLS)        | Включено                                                                                             |

Замените `<tenant-id>` на ваш Directory (tenant) ID из шага 1.

---

## Конфигурация Google Workspace

Google Workspace требует **сервисного аккаунта** с делегированием полномочий в масштабе домена для отправки писем от имени пользователей. Это необходимо, поскольку SMTP-серверы Google не поддерживают прямой поток OAuth с учётными данными клиента для Gmail.

### Предварительные требования

- Аккаунт Google Workspace (не обычный Gmail — потребительские аккаунты Gmail не поддерживают это)
- Доступ суперадминистратора к консоли администратора Google Workspace
- Доступ к консоли Google Cloud

### Шаг 1: Создание проекта Google Cloud

1. Перейдите в [консоль Google Cloud](https://console.cloud.google.com)
2. Нажмите на раскрывающийся список проектов и выберите **New Project**
3. Введите имя проекта и нажмите **Create**
4. Выберите ваш новый проект

### Шаг 2: Включение Gmail API

1. Перейдите в **APIs & Services** > **Library**
2. Найдите "Gmail API"
3. Нажмите **Gmail API**, затем **Enable**

### Шаг 3: Создание сервисного аккаунта

1. Перейдите в **APIs & Services** > **Credentials**
2. Нажмите **Create Credentials** > **Service account**
3. Введите имя и описание сервисного аккаунта
4. Нажмите **Create and Continue**
5. Пропустите необязательные шаги и нажмите **Done**

### Шаг 4: Создание ключей сервисного аккаунта

1. Нажмите на только что созданный сервисный аккаунт
2. Перейдите на вкладку **Keys**
3. Нажмите **Add Key** > **Create new key**
4. Выберите **JSON** и нажмите **Create**
5. Надёжно сохраните скачанный JSON-файл — он содержит:
   - `client_id` — ваш Client ID
   - `private_key` — ваш Client Secret (закрытый ключ)

### Шаг 5: Включение делегирования полномочий в масштабе домена

1. В деталях сервисного аккаунта нажмите **Show Advanced Settings**
2. Запишите **Client ID** (числовой ID)
3. Отметьте **Enable Google Workspace Domain-wide Delegation**
4. Нажмите **Save**

### Шаг 6: Авторизация сервисного аккаунта в консоли администратора Google Workspace

1. Войдите в [консоль администратора Google Workspace](https://admin.google.com)
2. Перейдите в **Security** > **Access and data control** > **API Controls**
3. Нажмите **Manage Domain Wide Delegation**
4. Нажмите **Add new**
5. Введите **Client ID** из шага 5
6. Для **OAuth Scopes** введите: `https://mail.google.com/`
7. Нажмите **Authorize**

Примечание: Распространение делегирования может занять от нескольких минут до 24 часов.

### Шаг 7: Настройка в OneUptime

В OneUptime создайте или отредактируйте конфигурацию SMTP со следующими настройками:

| Поле                | Значение                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostname            | `smtp.gmail.com`                                                                                                                                              |
| Port                | `587`                                                                                                                                                         |
| Username            | Адрес электронной почты Google Workspace для отправки (например, `notifications@yourdomain.com`). Этот пользователь будет олицетворяться сервисным аккаунтом. |
| Authentication Type | `OAuth`                                                                                                                                                       |
| OAuth Provider Type | `JWT Bearer`                                                                                                                                                  |
| Client ID           | `client_email` из вашего JSON сервисного аккаунта (например, `your-service@your-project.iam.gserviceaccount.com`)                                             |
| Client Secret       | `private_key` из вашего JSON сервисного аккаунта (весь ключ, включая `-----BEGIN PRIVATE KEY-----` и `-----END PRIVATE KEY-----`)                             |
| Token URL           | `https://oauth2.googleapis.com/token`                                                                                                                         |
| Scope               | `https://mail.google.com/`                                                                                                                                    |
| From Email          | То же, что и Username                                                                                                                                         |
| Secure (TLS)        | Включено                                                                                                                                                      |

**Важно:** Для Google (JWT Bearer) Client ID — это **email сервисного аккаунта** (`client_email`), а НЕ числовой `client_id`. Сервисный аккаунт будет олицетворять пользователя, указанного в поле Username, для отправки писем.

---

## Устранение неполадок

### Microsoft 365

| Проблема                                        | Решение                                                                                      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| "Authentication unsuccessful"                   | Убедитесь, что субъект-служба зарегистрирован в Exchange и имеет разрешения на почтовый ящик |
| "AADSTS700016: Application not found"           | Проверьте, что Client ID указан правильно и приложение существует в вашем клиенте            |
| "AADSTS7000215: Invalid client secret"          | Перегенерируйте секрет клиента — возможно, его срок действия истёк                           |
| "The mailbox is not enabled for this operation" | Выполните `Add-MailboxPermission` для предоставления доступа к почтовому ящику               |

### Google Workspace

| Проблема                                            | Решение                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| "invalid_grant"                                     | Убедитесь, что делегирование полномочий в масштабе домена правильно настроено и распространилось |
| "unauthorized_client"                               | Проверьте, что Client ID авторизован в консоли администратора Google Workspace                   |
| "access_denied"                                     | Убедитесь, что область `https://mail.google.com/` авторизована                                   |
| "Domain policy has disabled third-party Drive apps" | Включите доступ к API в консоли администратора Google Workspace > Security > API Controls        |

### Общие вопросы

- **Тестирование конфигурации**: Используйте кнопку "Send Test Email" в OneUptime для проверки настройки
- **Проверка логов**: Просмотрите логи OneUptime для получения подробных сообщений об ошибках
- **Кэширование токенов**: OneUptime кэширует OAuth-токены и автоматически обновляет их до истечения срока действия

---

## Рекомендации по безопасности

1. **Регулярно ротируйте секреты**: Установите напоминания в календаре для ротации секретов клиента до истечения их срока действия
2. **Используйте выделенные сервисные аккаунты**: Создайте отдельные учётные данные для OneUptime вместо совместного использования с другими приложениями
3. **Принцип наименьших привилегий**: Предоставляйте только минимально необходимые разрешения (SMTP.SendAsApp для Microsoft, область mail.google.com для Google)
4. **Мониторинг использования**: Проверяйте журналы электронной почты и входы в систему OAuth-приложений на предмет подозрительной активности
5. **Безопасное хранение**: Никогда не фиксируйте секреты клиента в системе контроля версий

---

## Дополнительные ресурсы

### Microsoft 365

- [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace

- [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)
