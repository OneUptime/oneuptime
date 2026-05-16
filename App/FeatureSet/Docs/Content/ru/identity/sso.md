# SSO (Single Sign-On)

OneUptime поддерживает единый вход (SSO) на основе SAML 2.0 для корпоративной аутентификации. SSO позволяет членам вашей команды входить в OneUptime с использованием корпоративного поставщика удостоверений (IdP), обеспечивая централизованное управление доступом и повышенную безопасность.

## Обзор

Интеграция SSO предоставляет следующие преимущества:

- **Централизованная аутентификация**: Пользователи входят с существующими корпоративными учётными данными
- **Повышенная безопасность**: Используйте многофакторную аутентификацию и политики безопасности вашего IdP
- **Упрощённое управление пользователями**: Управляйте доступом из существующей системы управления удостоверениями
- **Устранение усталости от паролей**: Пользователям не нужно запоминать отдельный пароль OneUptime

## Настройка SSO

1. **Перейдите в настройки проекта**
   - Откройте ваш проект OneUptime
   - Перейдите в **Project Settings** > **Authentication** > **SSO**

2. **Создайте конфигурацию SSO**
   - Нажмите **Create SSO**
   - Введите **Name** для конфигурации SSO (например, "Keycloak SAML" или "Okta SAML")
   - Введите **Sign On URL** от вашего поставщика удостоверений
   - Введите **Issuer** (Entity ID) от вашего поставщика удостоверений
   - Вставьте **Public Certificate** от вашего поставщика удостоверений
   - Выберите **Signature Algorithm** (например, `RSA-SHA-256`)
   - Выберите **Digest Algorithm** (например, `SHA256`)

3. **Получите метаданные SSO OneUptime**
   - После сохранения нажмите кнопку **View SSO Config**
   - Скопируйте **Identifier (Entity ID)** — он нужен для настройки вашего IdP
   - Скопируйте **Reply URL (Assertion Consumer Service URL)** — он нужен для настройки вашего IdP

## Конфигурация Keycloak SAML

Keycloak — популярное решение с открытым исходным кодом для управления удостоверениями и доступом. Следуйте этим шагам для настройки Keycloak в качестве SAML-поставщика удостоверений для OneUptime.

### Предварительные требования

- Работающий экземпляр Keycloak с настроенным realm
- Права администратора в Keycloak и OneUptime
- Аккаунт OneUptime с поддержкой SSO

### Шаг 1: Настройка SSO в OneUptime

1. Войдите в панель управления OneUptime
2. Перейдите в **Project Settings** > **Authentication** > **SSO**
3. Нажмите **Create SSO** и заполните следующее:
   - **Name**: Описательное имя (например, `my-project-oneuptime`)
   - **Sign On URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Issuer**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Certificate**: See [Step 2](#step-2-get-the-keycloak-certificate) below
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. Сохраните конфигурацию

### Шаг 2: Получение сертификата Keycloak

1. В Keycloak перейдите в настройки вашего клиента
2. Нажмите **Export** (или перейдите на вкладку **Keys** в зависимости от версии Keycloak)
3. В экспортированном JSON-файле найдите ключ с `certificate` в названии
4. Скопируйте значение сертификата и вставьте его в OneUptime в следующем формате:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### Шаг 3: Настройка клиента Keycloak

1. В Keycloak перейдите в **Clients** в вашем realm
2. Создайте нового клиента или отредактируйте существующий
3. Установите **Client Protocol** на `saml`
4. Установите **Client ID** в значение **Identifier (Entity ID)** из **View SSO Config** OneUptime
5. Установите **Valid Redirect URIs** на ваш URL OneUptime
6. Установите **Root URL** на базовый URL OneUptime
7. Вставьте **Reply URL (Assertion Consumer Service URL)** из OneUptime в поле **Assertion Consumer Service POST Binding URL**

### Шаг 4: Настройка параметров клиента Keycloak

1. Отключите **Signing keys config** (на вкладке Keys)
2. Установите **Name ID Format** на `email`
3. Убедитесь, что опция **Force Name ID Format** включена, чтобы Keycloak всегда отправлял email в качестве Name ID

### Шаг 5: Проверка конфигурации

1. Сохраните все настройки в Keycloak и OneUptime
2. Попробуйте войти в OneUptime через SSO
3. Вы должны быть перенаправлены на страницу входа Keycloak и обратно в OneUptime после успешной аутентификации

### Устранение неполадок Keycloak

- **Ошибка входа с ошибкой подписи**: Убедитесь, что сертификат скопирован правильно, включая строки `BEGIN CERTIFICATE` и `END CERTIFICATE`
- **Ошибка Name ID**: Убедитесь, что **Name ID Format** установлен на `email` в Keycloak
- **Цикл перенаправления**: Проверьте, что **Valid Redirect URIs** и **Assertion Consumer Service POST Binding URL** настроены правильно
- **Сертификат не найден**: Убедитесь, что вы экспортируете из правильного клиента в правильном realm

---

## Конфигурация Microsoft Entra ID (ранее Azure AD / Active Directory) SAML

Microsoft Entra ID — облачная служба управления удостоверениями и доступом Microsoft. Следуйте этим шагам для настройки Entra ID в качестве SAML-поставщика удостоверений для OneUptime.

### Предварительные требования

- Клиент Microsoft Entra ID (любой уровень, поддерживающий корпоративные приложения с SAML SSO)
- Права администратора в Microsoft Entra ID и OneUptime
- Аккаунт OneUptime с поддержкой SSO

### Шаг 1: Настройка SSO в OneUptime

1. Войдите в панель управления OneUptime
2. Перейдите в **Project Settings** > **Authentication** > **SSO**
3. Нажмите **Create SSO** и заполните следующее:
   - **Name**: Описательное имя (например, `Azure AD SAML`)
   - **Sign On URL**: Получите из Entra ID на [шаге 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime)
   - **Issuer**: Получите из Entra ID на [шаге 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime)
   - **Certificate**: Получите из Entra ID на [шаге 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime)
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. Нажмите **View SSO Config** и скопируйте **Identifier (Entity ID)** и **Reply URL (Assertion Consumer Service URL)** — они понадобятся для Entra ID

### Шаг 2: Создание корпоративного приложения в Microsoft Entra ID

1. Войдите в [центр администрирования Microsoft Entra](https://entra.microsoft.com)
2. Перейдите в **Identity** > **Applications** > **Enterprise applications**
3. Нажмите **+ New application**
4. Нажмите **+ Create your own application**
5. Введите имя (например, "OneUptime")
6. Выберите **Integrate any other application you don't find in the gallery (Non-gallery)**
7. Нажмите **Create**

### Шаг 3: Настройка SAML SSO в Entra ID

1. В вашем новом корпоративном приложении перейдите в **Single sign-on**
2. Выберите **SAML** в качестве метода единого входа
3. В **Basic SAML Configuration** нажмите **Edit** и установите:
   - **Identifier (Entity ID)**: Вставьте **Identifier (Entity ID)** из **View SSO Config** OneUptime
   - **Reply URL (Assertion Consumer Service URL)**: Вставьте **Reply URL** из **View SSO Config** OneUptime
4. Нажмите **Save**
5. В разделе **SAML Certificates**:
   - Скачайте **Certificate (Base64)**
   - Откройте скачанный файл сертификата в текстовом редакторе и скопируйте содержимое
6. В разделе **Set up OneUptime** скопируйте:
   - **Login URL** — вставьте как **Sign On URL** в OneUptime
   - **Azure AD Identifier** — вставьте как **Issuer** в OneUptime
7. Вернитесь в OneUptime, вставьте сертификат и URL, затем сохраните

### Шаг 4: Настройка атрибутов и утверждений пользователей

1. На странице конфигурации SAML нажмите **Edit** в **Attributes & Claims**
2. Убедитесь, что настроены следующие утверждения:

| Имя утверждения | Значение |
|-----------|-------|
| `Unique User Identifier (Name ID)` | `user.userprincipalname` или `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname` | `user.givenname` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname` | `user.surname` |

3. Установите **Name identifier format** на `Email address`
4. Нажмите **Save**

### Шаг 5: Назначение пользователей и групп

1. В вашем корпоративном приложении перейдите в **Users and groups**
2. Нажмите **+ Add user/group**
3. Выберите пользователей и/или группы, которым хотите предоставить доступ через SSO
4. Нажмите **Assign**

### Шаг 6: Проверка конфигурации

1. Сохраните все настройки в Entra ID и OneUptime
2. Попробуйте войти в OneUptime через SSO
3. Вы должны быть перенаправлены на страницу входа Microsoft и обратно в OneUptime после успешной аутентификации

### Устранение неполадок Microsoft Entra ID

- **Ошибка AADSTS700016**: Identifier (Entity ID) в Entra ID не совпадает с OneUptime — убедитесь, что оба значения идентичны
- **Ошибка сертификата**: Убедитесь, что вы скачали сертификат в формате **Base64** (не raw/binary) и включили строки `BEGIN CERTIFICATE` / `END CERTIFICATE`
- **Пользователь не назначен**: Пользователи должны быть явно назначены корпоративному приложению перед входом через SSO
- **Несовпадение Name ID**: Убедитесь, что утверждение Name ID установлено на адрес электронной почты, совпадающий с email пользователя в OneUptime

---

## Конфигурация Okta SAML

Okta — широко используемая платформа удостоверений, предоставляющая надёжные возможности SAML SSO. Следуйте этим шагам для настройки Okta в качестве SAML-поставщика удостоверений для OneUptime.

### Предварительные требования

- Организация Okta с правами администратора
- Аккаунт OneUptime с поддержкой SSO

### Шаг 1: Настройка SSO в OneUptime

1. Войдите в панель управления OneUptime
2. Перейдите в **Project Settings** > **Authentication** > **SSO**
3. Нажмите **Create SSO** и заполните следующее:
   - **Name**: Описательное имя (например, `Okta SAML`)
   - **Sign On URL**: Получите из Okta на [шаге 3](#step-3-copy-okta-saml-metadata-to-oneuptime)
   - **Issuer**: Получите из Okta на [шаге 3](#step-3-copy-okta-saml-metadata-to-oneuptime)
   - **Certificate**: Получите из Okta на [шаге 3](#step-3-copy-okta-saml-metadata-to-oneuptime)
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. Нажмите **View SSO Config** и скопируйте **Identifier (Entity ID)** и **Reply URL (Assertion Consumer Service URL)** — они понадобятся для Okta

### Шаг 2: Создание SAML-приложения в Okta

1. Войдите в консоль администратора Okta
2. Перейдите в **Applications** > **Applications**
3. Нажмите **Create App Integration**
4. Выберите **SAML 2.0** и нажмите **Next**
5. Введите "OneUptime" в качестве **App name** и нажмите **Next**
6. В разделе **SAML Settings** настройте:
   - **Single sign-on URL**: Вставьте **Reply URL (Assertion Consumer Service URL)** из **View SSO Config** OneUptime
   - **Audience URI (SP Entity ID)**: Вставьте **Identifier (Entity ID)** из **View SSO Config** OneUptime
   - **Name ID format**: Выберите `EmailAddress`
   - **Application username**: Выберите `Email`
7. Нажмите **Next**, затем выберите **I'm an Okta customer adding an internal app** и нажмите **Finish**

### Шаг 3: Копирование метаданных Okta SAML в OneUptime

1. В вашем приложении Okta перейдите на вкладку **Sign On**
2. В разделе **SAML Signing Certificates** найдите активный сертификат и нажмите **Actions** > **View IdP metadata**
3. Из метаданных XML или со вкладки **Sign On**:
   - Скопируйте **Sign On URL** (также называемый **Identity Provider Single Sign-On URL**) — вставьте как **Sign On URL** в OneUptime
   - Скопируйте **Issuer** (также называемый **Identity Provider Issuer**) — вставьте как **Issuer** в OneUptime
4. Скачайте сертификат подписи:
   - В разделе **SAML Signing Certificates** нажмите **Actions** > **Download certificate** для активного сертификата
   - Откройте скачанный файл `.cert` в текстовом редакторе и скопируйте содержимое
   - Вставьте сертификат в OneUptime (включая строки `BEGIN CERTIFICATE` и `END CERTIFICATE`)
5. Сохраните конфигурацию SSO OneUptime

### Шаг 4: Настройка атрибутных утверждений (необязательно)

1. В приложении Okta перейдите на вкладку **General**
2. Нажмите **Edit** в разделе **SAML Settings** и нажмите **Next**, чтобы перейти к параметрам SAML
3. В разделе **Attribute Statements** добавьте:

| Имя | Значение |
|------|-------|
| `email` | `user.email` |
| `firstName` | `user.firstName` |
| `lastName` | `user.lastName` |

4. Нажмите **Next**, затем **Finish**

### Шаг 5: Назначение пользователей и групп

1. В вашем приложении Okta перейдите на вкладку **Assignments**
2. Нажмите **Assign** > **Assign to People** или **Assign to Groups**
3. Выберите пользователей или группы, которым хотите предоставить доступ через SSO
4. Нажмите **Assign** для каждого выбора, затем нажмите **Done**

### Шаг 6: Проверка конфигурации

1. Сохраните все настройки в Okta и OneUptime
2. Попробуйте войти в OneUptime через SSO
3. Вы должны быть перенаправлены на страницу входа Okta и обратно в OneUptime после успешной аутентификации

### Устранение неполадок Okta

- **404 или неверный SSO URL**: Убедитесь, что **Single sign-on URL** в Okta точно совпадает с **Reply URL** из OneUptime
- **Несовпадение Audience**: Убедитесь, что **Audience URI** в Okta точно совпадает с **Identifier (Entity ID)** из OneUptime
- **Ошибка сертификата**: Убедитесь, что вы скачали сертификат для **активного** сертификата подписи, а не неактивного
- **Пользователь не назначен**: Пользователи должны быть назначены приложению Okta перед входом через SSO
- **Ошибка Name ID**: Убедитесь, что **Name ID format** установлен на `EmailAddress`, а **Application username** — на `Email`

---

## Другие поставщики удостоверений

Реализация SSO в OneUptime использует протокол SAML 2.0 и должна работать с любым совместимым поставщиком удостоверений. Общие шаги настройки:

1. В OneUptime создайте конфигурацию SSO и запишите **Identifier (Entity ID)** и **Reply URL (Assertion Consumer Service URL)** из кнопки **View SSO Config**
2. В вашем поставщике удостоверений создайте SAML-приложение, используя:
   - **Assertion Consumer Service URL / Reply URL**: Из конфигурации SSO OneUptime
   - **Entity ID / Audience URI**: Из конфигурации SSO OneUptime
   - **Name ID Format**: Адрес электронной почты
3. От вашего поставщика удостоверений скопируйте в OneUptime:
   - **Sign On URL** (конечная точка SSO)
   - **Issuer** (Entity ID IdP)
   - **Public Certificate** (сертификат подписи X.509)
4. Установите **Signature Algorithm** на `RSA-SHA-256` и **Digest Algorithm** на `SHA256`

## Примечания об SSO и ролях

OneUptime в настоящее время не поддерживает сопоставление ролей SAML от вашего поставщика удостоверений. Управление доступом на основе ролей необходимо настраивать отдельно в **Project Settings** > **SSO** OneUptime, где вы можете назначать роли по умолчанию для пользователей SSO.
