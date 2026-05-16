# SCIM (System for Cross-domain Identity Management)

OneUptime поддерживает протокол SCIM v2.0 для автоматизированного создания и отзыва прав доступа пользователей. SCIM позволяет поставщикам удостоверений (IdP), таким как Azure AD, Okta и другим корпоративным системам управления удостоверениями, автоматически управлять доступом пользователей к проектам и страницам статуса OneUptime.

## Обзор

Интеграция SCIM предоставляет следующие преимущества:

- **Автоматическое создание пользователей**: Автоматически создавать пользователей в OneUptime при их назначении в вашем IdP
- **Автоматический отзыв прав доступа**: Автоматически удалять пользователей из OneUptime при снятии с них назначения в вашем IdP
- **Синхронизация атрибутов пользователей**: Поддерживать актуальность информации о пользователях между вашим IdP и OneUptime
- **Централизованное управление доступом**: Управлять доступом к OneUptime из существующей системы управления удостоверениями

## SCIM для проектов

Проектный SCIM позволяет поставщикам удостоверений управлять членами команды в проектах OneUptime.

### Настройка проектного SCIM

1. **Перейдите в настройки проекта**
   - Откройте ваш проект OneUptime
   - Перейдите в **Project Settings** > **Team** > **SCIM**

2. **Настройте параметры SCIM**
   - Включите **Auto Provision Users**, чтобы автоматически добавлять пользователей при их назначении в вашем IdP
   - Включите **Auto Deprovision Users**, чтобы автоматически удалять пользователей при снятии назначения в вашем IdP
   - Выберите **Default Teams**, в которые должны добавляться новые пользователи
   - Скопируйте **SCIM Base URL** и **Bearer Token** для настройки вашего IdP

3. **Настройте поставщик удостоверений**
   - Используйте SCIM Base URL: `https://oneuptime.com/scim/v2/{scimId}`
   - Настройте аутентификацию на основе токена bearer с предоставленным токеном
   - Сопоставьте атрибуты пользователей (email обязателен)

### Конечные точки проектного SCIM

- **Service Provider Config**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /scim/v2/{scimId}/Users`
- **Get User**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /scim/v2/{scimId}/Users`
- **Update User**: `PUT /scim/v2/{scimId}/Users/{userId}` или `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **List Groups**: `GET /scim/v2/{scimId}/Groups`
- **Get Group**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Create Group**: `POST /scim/v2/{scimId}/Groups`
- **Update Group**: `PUT /scim/v2/{scimId}/Groups/{groupId}` или `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Delete Group**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### Жизненный цикл пользователей проектного SCIM

1. **Назначение пользователя в IdP**: Когда пользователь назначается в OneUptime в вашем IdP
2. **Создание через SCIM**: IdP обращается к SCIM API OneUptime для создания пользователя
3. **Членство в команде**: Пользователь автоматически добавляется в настроенные команды по умолчанию
4. **Предоставление доступа**: Пользователь теперь может получить доступ к проекту OneUptime
5. **Снятие назначения**: Когда назначение пользователя снимается в IdP
6. **Отзыв прав через SCIM**: IdP обращается к SCIM API OneUptime для удаления пользователя
7. **Отзыв доступа**: Пользователь теряет доступ к проекту

## SCIM для страниц статуса

SCIM страниц статуса позволяет поставщикам удостоверений управлять подписчиками на закрытые страницы статуса.

### Настройка SCIM для страниц статуса

1. **Перейдите в настройки страницы статуса**
   - Откройте вашу страницу статуса OneUptime
   - Перейдите в **Status Page Settings** > **Private Users** > **SCIM**

2. **Настройте параметры SCIM**
   - Включите **Auto Provision Users**, чтобы автоматически добавлять подписчиков при их назначении в вашем IdP
   - Включите **Auto Deprovision Users**, чтобы автоматически удалять подписчиков при снятии назначения в вашем IdP
   - Скопируйте **SCIM Base URL** и **Bearer Token** для настройки вашего IdP

3. **Настройте поставщик удостоверений**
   - Используйте SCIM Base URL: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - Настройте аутентификацию на основе токена bearer с предоставленным токеном
   - Сопоставьте атрибуты пользователей (email обязателен)

### Конечные точки SCIM для страниц статуса

- **Service Provider Config**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /status-page-scim/v2/{scimId}/Users`
- **Get User**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /status-page-scim/v2/{scimId}/Users`
- **Update User**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` или `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Жизненный цикл пользователей SCIM для страниц статуса

1. **Назначение пользователя в IdP**: Когда пользователь назначается на страницу статуса OneUptime в вашем IdP
2. **Создание через SCIM**: IdP обращается к SCIM API OneUptime для создания подписчика
3. **Предоставление доступа**: Пользователь теперь может получить доступ к закрытой странице статуса
4. **Снятие назначения**: Когда назначение пользователя снимается в IdP
5. **Отзыв прав через SCIM**: IdP обращается к SCIM API OneUptime для удаления подписчика
6. **Отзыв доступа**: Пользователь теряет доступ к странице статуса

## Настройка поставщиков удостоверений

### Microsoft Entra ID (ранее Azure AD)

Microsoft Entra ID предоставляет корпоративное управление удостоверениями с надёжными возможностями SCIM-provisioning. Следуйте этим подробным шагам для настройки SCIM-provisioning с OneUptime.

#### Предварительные требования

- Клиент Microsoft Entra ID с лицензией Premium P1 или P2 (требуется для автоматического provisioning)
- Аккаунт OneUptime с планом Scale или выше
- Права администратора в Microsoft Entra ID и OneUptime

#### Шаг 1: Получение конфигурации SCIM из OneUptime

1. Войдите в панель управления OneUptime
2. Перейдите в **Project Settings** > **Team** > **SCIM**
3. Нажмите **Create SCIM Configuration**
4. Введите понятное имя (например, "Microsoft Entra ID Provisioning")
5. Настройте следующие параметры:
   - **Auto Provision Users**: Включите для автоматического создания пользователей
   - **Auto Deprovision Users**: Включите для автоматического удаления пользователей
   - **Default Teams**: Выберите команды, в которые должны добавляться новые пользователи
   - **Enable Push Groups**: Включите, если хотите управлять членством в команде через группы Entra ID
6. Сохраните конфигурацию
7. Скопируйте **SCIM Base URL** и **Bearer Token** — они понадобятся для Entra ID

#### Шаг 2: Создание корпоративного приложения в Microsoft Entra ID

1. Войдите в [центр администрирования Microsoft Entra](https://entra.microsoft.com)
2. Перейдите в **Identity** > **Applications** > **Enterprise applications**
3. Нажмите **+ New application**
4. Нажмите **+ Create your own application**
5. Введите имя (например, "OneUptime")
6. Выберите **Integrate any other application you don't find in the gallery (Non-gallery)**
7. Нажмите **Create**

#### Шаг 3: Настройка SCIM-provisioning

1. В вашем корпоративном приложении OneUptime перейдите в **Provisioning**
2. Нажмите **Get started**
3. Установите **Provisioning Mode** на **Automatic**
4. В разделе **Admin Credentials**:
   - **Tenant URL**: Введите SCIM Base URL из OneUptime (например, `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Secret Token**: Введите Bearer Token из OneUptime
5. Нажмите **Test Connection** для проверки конфигурации
6. Нажмите **Save**

#### Шаг 4: Настройка сопоставления атрибутов

1. В разделе Provisioning нажмите **Mappings**
2. Нажмите **Provision Azure Active Directory Users**
3. Настройте следующие сопоставления атрибутов:

| Атрибут Azure AD | Атрибут SCIM OneUptime | Обязательный |
|-------------------|-------------------------|----------|
| `userPrincipalName` | `userName` | Да |
| `mail` | `emails[type eq "work"].value` | Рекомендуется |
| `displayName` | `displayName` | Рекомендуется |
| `givenName` | `name.givenName` | Необязательно |
| `surname` | `name.familyName` | Необязательно |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | Рекомендуется |

4. Удалите ненужные сопоставления для упрощения provisioning
5. Нажмите **Save**

#### Шаг 5: Настройка provisioning групп (необязательно)

Если вы включили **Push Groups** в OneUptime:

1. Вернитесь в **Mappings**
2. Нажмите **Provision Azure Active Directory Groups**
3. Включите provisioning групп, установив **Enabled** на **Yes**
4. Настройте следующие сопоставления атрибутов:

| Атрибут Azure AD | Атрибут SCIM OneUptime |
|-------------------|-------------------------|
| `displayName` | `displayName` |
| `members` | `members` |

5. Нажмите **Save**

#### Шаг 6: Назначение пользователей и групп

1. В вашем корпоративном приложении OneUptime перейдите в **Users and groups**
2. Нажмите **+ Add user/group**
3. Выберите пользователей и/или группы, которых хотите предоставить в OneUptime
4. Нажмите **Assign**

#### Шаг 7: Запуск provisioning

1. Перейдите в **Provisioning** > **Overview**
2. Нажмите **Start provisioning**
3. Начнётся начальный цикл provisioning (для первой синхронизации может потребоваться до 40 минут)
4. Следите за **Provisioning logs** на предмет ошибок

#### Устранение неполадок Microsoft Entra ID

- **Тест подключения не проходит**: Убедитесь, что SCIM Base URL включает префикс `/api/identity` и Bearer Token указан верно
- **Пользователи не создаются**: Убедитесь, что пользователи назначены на приложение и сопоставления атрибутов настроены верно
- **Ошибки provisioning**: Просмотрите журналы provisioning в Entra ID для получения конкретных сообщений об ошибках
- **Задержки синхронизации**: Начальный provisioning может занять до 40 минут; последующие синхронизации происходят каждые 40 минут

---

### Okta

Okta предоставляет гибкое управление удостоверениями с отличной поддержкой SCIM. Следуйте этим подробным шагам для настройки SCIM-provisioning с OneUptime.

#### Предварительные требования

- Клиент Okta с возможностями provisioning (функция Lifecycle Management)
- Аккаунт OneUptime с планом Scale или выше
- Права администратора в Okta и OneUptime

#### Шаг 1: Получение конфигурации SCIM из OneUptime

1. Войдите в панель управления OneUptime
2. Перейдите в **Project Settings** > **Team** > **SCIM**
3. Нажмите **Create SCIM Configuration**
4. Введите понятное имя (например, "Okta Provisioning")
5. Настройте следующие параметры:
   - **Auto Provision Users**: Включите для автоматического создания пользователей
   - **Auto Deprovision Users**: Включите для автоматического удаления пользователей
   - **Default Teams**: Выберите команды, в которые должны добавляться новые пользователи
   - **Enable Push Groups**: Включите, если хотите управлять членством в команде через группы Okta
6. Сохраните конфигурацию
7. Скопируйте **SCIM Base URL** и **Bearer Token** — они понадобятся для Okta

#### Шаг 2: Создание или настройка приложения Okta

**При наличии существующего SSO-приложения:**
1. Войдите в консоль администратора Okta
2. Перейдите в **Applications** > **Applications**
3. Найдите и выберите существующее приложение OneUptime

**При создании нового приложения:**
1. Войдите в консоль администратора Okta
2. Перейдите в **Applications** > **Applications**
3. Нажмите **Create App Integration**
4. Выберите **SAML 2.0** и нажмите **Next**
5. Введите "OneUptime" в качестве имени приложения
6. Завершите конфигурацию SAML (см. документацию по SSO)
7. Нажмите **Finish**

#### Шаг 3: Включение SCIM-provisioning

1. В вашем приложении OneUptime перейдите на вкладку **General**
2. В разделе **App Settings** нажмите **Edit**
3. В разделе **Provisioning** выберите **SCIM**
4. Нажмите **Save**
5. Появится новая вкладка **Provisioning**

#### Шаг 4: Настройка подключения SCIM

1. Перейдите на вкладку **Provisioning**
2. Нажмите **Integration** на левой боковой панели
3. Нажмите **Configure API Integration**
4. Отметьте **Enable API integration**
5. Настройте следующее:
   - **SCIM connector base URL**: Введите SCIM Base URL из OneUptime (например, `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Unique identifier field for users**: Введите `userName`
   - **Supported provisioning actions**: Выберите действия, которые хотите включить:
     - Import New Users and Profile Updates
     - Push New Users
     - Push Profile Updates
     - Push Groups (если используется provisioning на основе групп)
   - **Authentication Mode**: Выберите **HTTP Header**
   - **Authorization**: Введите `Bearer {your-bearer-token}` (замените на реальный токен)
6. Нажмите **Test API Credentials** для проверки подключения
7. Нажмите **Save**

#### Шаг 5: Настройка provisioning для приложения

1. На вкладке **Provisioning** нажмите **To App** на левой боковой панели
2. Нажмите **Edit**
3. Включите следующие опции:
   - **Create Users**: Включите для создания новых пользователей
   - **Update User Attributes**: Включите для синхронизации изменений атрибутов
   - **Deactivate Users**: Включите для отзыва прав пользователей при снятии назначения
4. Нажмите **Save**

#### Шаг 6: Настройка сопоставления атрибутов

1. Прокрутите вниз до **Attribute Mappings**
2. Проверьте или настройте следующие сопоставления:

| Атрибут Okta | Атрибут SCIM OneUptime | Направление |
|---------------|-------------------------|-----------|
| `userName` | `userName` | Okta to App |
| `user.email` | `emails[primary eq true].value` | Okta to App |
| `user.firstName` | `name.givenName` | Okta to App |
| `user.lastName` | `name.familyName` | Okta to App |
| `user.displayName` | `displayName` | Okta to App |

3. Удалите ненужные сопоставления
4. Нажмите **Save**, если вносили изменения

#### Шаг 7: Настройка Push Groups (необязательно)

Если вы включили **Push Groups** в OneUptime:

1. Перейдите на вкладку **Push Groups**
2. Нажмите **+ Push Groups**
3. Выберите **Find groups by name** или **Find groups by rule**
4. Найдите и выберите группы, которые хотите передать
5. Нажмите **Save**

#### Шаг 8: Назначение пользователей

1. Перейдите на вкладку **Assignments**
2. Нажмите **Assign** > **Assign to People** или **Assign to Groups**
3. Выберите пользователей или группы для provisioning
4. Нажмите **Assign** для каждого выбора
5. Нажмите **Done**

#### Шаг 9: Проверка provisioning

1. Перейдите в **Reports** > **System Log** в консоли администратора Okta
2. Фильтруйте события, связанные с вашим приложением OneUptime
3. Убедитесь, что события provisioning успешны
4. Проверьте в OneUptime, что пользователи созданы

#### Устранение неполадок Okta

- **Тест учётных данных API не проходит**: Убедитесь, что SCIM Base URL и Bearer Token указаны верно
- **Пользователи не создаются**: Убедитесь, что пользователи назначены на приложение и provisioning включён
- **Дублирующиеся пользователи**: Убедитесь, что атрибут `userName` уникален и правильно сопоставлен с email
- **Ошибки Push Groups**: Убедитесь, что группы существуют и имеют правильный состав
- **Ошибка: 401 Unauthorized**: Перегенерируйте Bearer Token в OneUptime и обновите его в Okta

---

### Другие поставщики удостоверений

Реализация SCIM в OneUptime следует спецификации SCIM v2.0 и должна работать с любым совместимым поставщиком удостоверений. Общие шаги настройки:

1. **SCIM Base URL**: `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (для проектов) или `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (для страниц статуса)
2. **Аутентификация**: HTTP Bearer Token
3. **Обязательный атрибут пользователя**: `userName` (должен быть действительным адресом электронной почты)
4. **Поддерживаемые операции**: GET, POST, PUT, PATCH, DELETE для Users и Groups

#### Поддерживаемые конечные точки SCIM

| Конечная точка | Методы | Описание |
|----------|---------|-------------|
| `/ServiceProviderConfig` | GET | Возможности SCIM-сервера |
| `/Schemas` | GET | Доступные схемы ресурсов |
| `/ResourceTypes` | GET | Доступные типы ресурсов |
| `/Users` | GET, POST | Список и создание пользователей |
| `/Users/{id}` | GET, PUT, PATCH, DELETE | Управление отдельными пользователями |
| `/Groups` | GET, POST | Список и создание групп/команд (только проектный SCIM) |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE | Управление отдельными группами (только проектный SCIM) |

#### Схема пользователя SCIM

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

#### Схема группы SCIM

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

## Часто задаваемые вопросы

### Что происходит при отзыве прав пользователя?

При отзыве прав пользователя (либо через DELETE-запрос, либо установкой `active: false`) он удаляется из команд, настроенных в параметрах SCIM. Сам аккаунт пользователя остаётся в OneUptime, но теряет доступ к проекту.

### Можно ли использовать SCIM без SSO?

Да, SCIM и SSO — это независимые функции. Вы можете использовать SCIM для provisioning пользователей, позволяя им входить с паролем OneUptime или любым другим методом аутентификации.

### Как обрабатываются пользователи, уже существующие в OneUptime?

Когда SCIM пытается создать пользователя, который уже существует (совпадение по email), OneUptime просто добавит его в настроенные команды по умолчанию вместо создания дублирующего пользователя.

### В чём разница между командами по умолчанию и Push Groups?

- **Default Teams**: Все пользователи, созданные через SCIM, добавляются в одни и те же предопределённые команды
- **Push Groups**: Членство в команде управляется вашим поставщиком удостоверений, что позволяет разным пользователям быть в разных командах в зависимости от членства в группах IdP

### Как часто происходит синхронизация provisioning?

Это зависит от вашего поставщика удостоверений:
- **Microsoft Entra ID**: Начальная синхронизация может занять до 40 минут, последующие синхронизации — каждые 40 минут
- **Okta**: Почти в реальном времени для большинства операций, с периодическими полными синхронизациями
