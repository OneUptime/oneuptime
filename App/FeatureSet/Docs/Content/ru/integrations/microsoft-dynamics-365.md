# Интеграция с Microsoft Dynamics 365

Открывайте **Case** (обращение) в [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) при каждом объявлении инцидента OneUptime, держите это обращение в согласии с ходом инцидента и позвольте Dynamics возвращать изменения обращения обратно в OneUptime — и всё это одним [рабочим процессом](/docs/workflows/index). Никакого специального блока для Dynamics ставить не нужно: OneUptime общается с **Dataverse Web API** через [компонент API](/docs/workflows/components#api), а Dynamics отвечает через [триггер Webhook](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Эта страница охватывает оба направления. Соберите сначала исходящую половину — именно ей нужна настройка Microsoft Entra ID, а как только она заработает, входящая половина сводится к одному потоку.

## Предварительные требования

- Среда **Dynamics 365**, содержащая таблицу **Case**. Обращения приходят из Dynamics 365 Customer Service; в среде Dataverse без неё нет таблицы `incident`, в которую можно писать.
- **Конечная точка Web API** этой среды. Её адрес есть в [Power Platform admin center](https://admin.powerplatform.microsoft.com/) в разделе **Settings → Developer resources** вашей среды либо в **make.powerapps.com → Settings → Developer resources**. Выглядит она как `https://yourorg.crm.dynamics.com/api/data/v9.2/` — сегмент региона различается (`crm` для Северной Америки, `crm2` для Южной Америки, `crm7` для Японии и так далее).
- Права на регистрацию приложения в **Microsoft Entra ID** и на создание **application user** в среде Dynamics. Обычно это два разных администратора.
- Проект OneUptime, в котором вы можете создавать рабочие процессы и глобальные переменные.

> Всё, что ниже, использует имена таблиц Dataverse, а не подписи на формах Dynamics. Обращение — это таблица **`incident`**, её коллекция в URL — **`incidents`**, первичный ключ — **`incidentid`**, а колонка заголовка — **`title`**. Номер обращения, который вы видите в интерфейсе, — это **`ticketnumber`**.

## Шаг 1 — Зарегистрируйте приложение в Microsoft Entra ID

OneUptime аутентифицируется как приложение, а не как человек, поэтому используется поток OAuth 2.0 **client credentials**.

1. Войдите в [портал Azure](https://portal.azure.com) администратором того же тенанта, что и ваша среда Dynamics, и откройте **Microsoft Entra ID**.
2. Перейдите в **App registrations → New registration**. Дайте регистрации имя, например `OneUptime Integration`, оставьте **Supported account types** на значении **Accounts in this organizational directory only** и выберите **Register**.
3. На странице **Overview** приложения скопируйте **Application (client) ID** и **Directory (tenant) ID**.
4. Перейдите в **Certificates & secrets → Client secrets → New client secret**. Скопируйте **Value** секрета — не его ID — прежде чем уйти со страницы. Больше его не покажут. Клиентский секрет живёт максимум 24 месяца, поэтому запишите дату истечения там, где вы её увидите.

Две вещи, которые здесь добавляют, хотя они не нужны:

- **Никаких API permissions.** В потоке client credentials нет вошедшего пользователя, поэтому делегированные разрешения ничего не дают. `user_impersonation` в разделе **Dataverse** — делегированное разрешение, и оно только для интерактивных приложений. Microsoft Entra ID спокойно выдаст токен для Dataverse вообще без настроенных разрешений: доступ решается на стороне Dynamics, на Шаге 2.
- **Никакого согласия администратора.** По той же причине.

Для промышленных приложений Microsoft предпочитает сертификат клиентскому секрету. Этот вариант требует, чтобы вызывающая сторона сама собирала и подписывала JWT-утверждение, а рабочий процесс так не умеет, поэтому клиентский секрет здесь — практичный выбор; обращайтесь с ним соответственно: держите его в секретной переменной и меняйте до истечения срока.

## Шаг 2 — Создайте application user в Dynamics

Это тот шаг, который пропускают, и его пропуск даёт самый запутанный сбой во всей интеграции: запрос токена проходит успешно, а затем каждый вызов Dataverse падает с `403 Forbidden` и кодом ошибки `0x80072560` — *«The user isn't a member of the organization»*. Entra ID выдаёт токен, ничего не зная о Dynamics; Dynamics затем ищет строку пользователя, соответствующую приложению, и не находит её.

1. Откройте [Power Platform admin center](https://admin.powerplatform.microsoft.com/) и выберите **Manage → Environments**, затем вашу среду.
2. Выберите **Settings → Users + permissions → Application users**.
3. Выберите **+ New app user**, затем **+ Add an app**, выберите регистрацию из Шага 1 и нажмите **Add**.
4. Выберите **Business unit**, введите **Email address**, затем воспользуйтесь значком редактирования рядом с **Security roles**.
5. Назначьте **пользовательскую** роль безопасности с правами на создание, чтение и запись в таблице **Case**. Application user нельзя выдать одну из встроенных ролей — Microsoft требует пользовательскую. Если подходящей роли нет, скопируйте существующую и урежьте её.
6. Выберите **Save**, затем **Create**.

В одной среде на одну регистрацию приложения может приходиться только один application user. Application users не лицензируются и не подпадают под правила членства в группах безопасности среды.

## Шаг 3 — Сохраните учётные данные в OneUptime

Перейдите в **Рабочие процессы → Глобальные переменные → Создать** и добавьте следующие, включив **Секрет** там, где отмечено:

| Имя                      | Значение                                                    | Секрет |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | Directory (tenant) ID из Шага 1                             | Нет    |
| `DYNAMICS_CLIENT_ID`     | Application (client) ID из Шага 1                           | Нет    |
| `DYNAMICS_CLIENT_SECRET` | **Value** клиентского секрета из Шага 1                     | Да     |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — без косой черты в конце | Нет    |

Вставляйте клиентский секрет ровно в том виде, в каком его выдал Entra ID. OneUptime сам кодирует тело формы, поэтому не кодируйте секрет для URL вручную.

Ссылайтесь на любую из них в блоке как `{{global.variables.DYNAMICS_CLIENT_ID}}`. О том, как секреты вычищаются из журналов запусков, читайте в [Переменных](/docs/workflows/variables).

## Шаг 4 — Получите токен доступа

Каждый запуск получает собственный токен. Токены живут 60–90 минут, а поток client credentials никогда не выдаёт refresh-токен, поэтому кешировать и обновлять нечего: один лишний HTTP-вызов на запуск — это вся цена.

1. Откройте **Рабочие процессы → Создать рабочий процесс**, назовите его `Incidents → Dynamics 365` и откройте **Конструктор**.
2. Нажмите на пунктирную заглушку, добавьте триггер **On Create Incident** и в его поле **Select Fields** запросите колонки, которые хотите отправлять:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Оставьте его **Identifier** равным `incident-on-create-1`.

3. Нажмите **Добавить компонент**, добавьте блок **API Post (JSON)**, соедините с ним точку **Success** триггера и откройте его настройки. Задайте **Identifier** значение `get-token`, затем:

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

**Пишите имя заголовка как `Content-Type`, ровно с таким регистром букв.** Именно оно говорит OneUptime отправить тело как form post, а не как JSON, — а это единственная форма, которую принимает конечная точка токенов Microsoft. `content-type` в нижнем регистре не совпадает, запрос уходит как JSON и возвращается с `400`.

Значением `scope` должен быть URL вашей среды с добавленным `/.default` — это форма для конфиденциального клиента. Неверный URL среды здесь — обычная причина ошибки `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.

Теперь токен доступен последующим блокам как:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## Шаг 5 — Создайте обращение

Добавьте второй блок **API Post (JSON)**, соедините с ним точку **Success** блока `get-token` и задайте **Identifier** значение `create-case`.

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

Замените GUID учётной записи на ту учётную запись, которой принадлежат эти обращения. **`customerid` действительно обязателен для обращения** — это одна из колонок, которые Dataverse требует при любой программной записи, поэтому создание без неё отклоняется. Поскольку она может указывать либо на account, либо на contact, вы никогда не пишете `customerid@odata.bind`; вы пишете `customerid_account@odata.bind` или `customerid_contact@odata.bind`, и эти имена чувствительны к регистру. `title` обязателен иначе: на нём настаивают формы Dynamics, а API — нет, но отправляйте его всё равно.

Именно `Prefer: return=representation` делает всё это пригодным для рабочего процесса. Без него успешное создание отвечает `204 No Content` и кладёт URI новой записи в заголовок ответа `OData-EntityId`, из которого вам потом пришлось бы выковыривать GUID. С ним ответ приходит как `201 Created` и несёт саму запись, так что следующий блок может прочитать:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

Теперь включите рабочий процесс — **Обзор → Редактировать рабочий процесс → Включено**, — объявите тестовый инцидент и прочитайте запуск в разделе **Запуски и журналы**. Блок `create-case` должен показать `201` и тело с новым `incidentid`. Изменения на холсте сохраняются сами; кнопки сохранения нет.

### Сопоставление серьёзности и статуса

Dynamics поставляется с `severitycode`, у которого всего один вариант — «Default Value», — так что готовой шкалы серьёзности для сопоставления нет. Используйте вместо неё **`prioritycode`** и ветвитесь блоком **If / Else** по `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`, если хотите разные приоритеты для разных уровней серьёзности.

| Колонка          | Значения                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` High, `2` Normal, `3` Low                                                                                                     |
| `caseorigincode` | `1` Phone, `2` Email, `3` Web, `2483` Facebook, `3986` Twitter, `700610000` IoT                                                   |
| `casetypecode`   | `1` Question, `2` Problem, `3` Request                                                                                            |
| `statecode`      | `0` Active, `1` Resolved, `2` Cancelled                                                                                           |
| `statuscode`     | `1` In Progress, `2` On Hold, `3` Waiting for Details, `4` Researching, `5` Problem Solved, `6` Cancelled, `1000` Information Provided, `2000` Merged |

`statuscode` настраивается, поэтому тенант мог добавить собственные значения. Отправляйте целые числа, а не подписи.

## Шаг 6 — Сделайте инцидент и обращение находимыми друг из друга

Что бы вы ни делали дальше — комментировали, разрешали, синхронизировали обратно, — одна из двух систем должна хранить идентификатор другой. Положите его на сторону Dynamics.

Добавьте в таблицу Case колонку типа **single line of text**, например `new_oneuptimeincidentid`, и задавайте её при создании обращения:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

Тогда любой последующий рабочий процесс сможет найти обращение фильтром:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

Если объявить эту колонку **alternate key** таблицы Case, поиск можно вообще пропустить и делать `PATCH` прямо на `incidents(new_oneuptimeincidentid='<id>')` — это upsert, который создаёт обращение, если его нет, и обновляет, если оно есть. Ключ должен достроиться (его состояние становится **Active**), прежде чем им можно пользоваться, а значения альтернативного ключа не могут содержать `/ < > * % & : \ ? + #`. Идентификатор OneUptime — обычный UUID, так что он безопасен.

Обратное направление — хранение идентификатора обращения Dynamics в инциденте OneUptime — тоже работает, через блок **Update One Incident**, пишущий в `customFields`. С ним нужна осторожность: `customFields` — единая JSON-колонка, поэтому запись в неё заменяет все значения пользовательских полей этого инцидента, а не только ваше. Хранение связи на стороне Dynamics полностью снимает этот вопрос.

## Шаг 7 — Закрывайте обращение, когда инцидент разрешён

Соберите это **вторым** рабочим процессом, чтобы сбой здесь не мог помешать открытию обращений.

1. **Создать рабочий процесс**, назовите его `Incident resolved → Close Dynamics case` и добавьте триггер **On Update Incident**.
2. В поле **Listen on** триггера укажите `{"currentIncidentStateId": true}`, чтобы рабочий процесс просыпался только на смену состояния, а не на каждое изменение. В **Select Fields** запросите `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Добавьте блок **If / Else**. **Input 1** — `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** — `==`, **Input 2** — `Resolved` или то, как называется состояние «разрешён» в вашем проекте. См. [Состояния и уровни серьёзности инцидентов](/docs/incidents/states-and-severities).
4. Из ветки **Yes** повторите блок `get-token` из Шага 4.
5. Добавьте блок **API Get (JSON)**, задайте его **Identifier** значение `find-case` и укажите ему URL с `$filter` из Шага 6. Запрос к Dataverse отвечает массивом `value`, а ссылка в рабочем процессе умеет обращаться к элементу массива по индексу в квадратных скобках, поэтому идентификатор обращения — `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`.
6. Добавьте блок **API Post (JSON)**, который закрывает обращение:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: те же, что на Шаге 5, минус `Prefer`.
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

     `Status` — это значение `statuscode` в состоянии Resolved; `5` — это *Problem Solved*.

     **Проверьте это тело на собственной среде, прежде чем на него полагаться.** `CloseIncident` принимает два параметра, `IncidentResolution` и `Status`, но Microsoft не публикует для него HTTP-примера — все официальные образцы написаны на C#. Показанная выше структура — общепринятый перевод. Если ваша среда её отвергает, попробуйте указывать обращение обычным свойством `"incidentid": "<the case id>"` вместо формы `@odata.bind` — именно так на существующую запись ссылаются другие примеры действий Microsoft.

**Почему бы просто не сделать `PATCH` обращения на `statecode: 1`?** Можно — Microsoft документирует `PATCH` полей `statecode` и `statuscode` как эквивалент в Web API для старого сообщения SetState, и это правильный инструмент для перевода обращения между активными статусами. Чего он не делает — так это не создаёт активность **Case Resolution**, которая должна быть у разрешённого обращения в Dynamics 365 Customer Service, и он будет отвергнут напрямую в среде, где администратор настроил собственные переходы статусов. Для разрешения используйте `CloseIncident`; `PATCH` — для всего остального. И всякий раз, когда вы всё же пишете `statecode`, задавайте `statuscode` в том же запросе — иначе Dynamics молча применит статус по умолчанию для этого состояния.

`CloseIncident` приходит из Dynamics 365 Customer Service, а не из базового Dataverse, и в справочнике действий Dataverse его нет. Если он возвращает `404`, убедитесь, что он существует в вашей среде, запросив `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` и поискав там `CloseIncident`.

Для всего, что меньше закрытия обращения, — заметки, повышения приоритета, смены заголовка — используйте блок **API Patch (JSON)** на `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` с заголовком `If-Match: *`, который не даёт случайному upsert создать новое обращение. Отправляйте только те колонки, которые меняете.

## Входящее направление — из Dynamics 365 в OneUptime

Теперь в обратную сторону: кто-то закрывает обращение в Dynamics или агент добавляет заметку, и OneUptime должен об этом узнать.

### Сначала соберите принимающий рабочий процесс

1. **Создать рабочий процесс**, назовите его `Dynamics 365 → OneUptime` и добавьте триггер **Webhook**.
2. Откройте **Настройки** этого рабочего процесса и скопируйте **секретный ключ вебхука**. Ваш URL:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   В self-hosted-установке подставьте собственный хост. Относитесь к этому URL как к паролю — кто им владеет, тот может запустить рабочий процесс. Ключ можно сбросить на той же странице.

3. Добавьте блок **If / Else**, который проверяет общий секрет прежде, чем произойдёт что-либо ещё. **Input 1** — `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** — `==`, **Input 2** — `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}`, значение, которое вы придумываете сами и сохраняете как секретную глобальную переменную.
4. Из ветки **Yes** добавьте блок **Update One Incident**:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: то, что изменение обращения должно означать в OneUptime, — смена состояния, заметка, метка.

   Чтобы перевести инцидент в состояние, вам понадобится идентификатор этого состояния: блок **Find One Incident State** с запросом `{"name": "Resolved"}` даст вам `{{local.components.incident-state-find-one-1.returnValues.model._id}}` для записи в `currentIncidentStateId`.

Оставьте его включённым и готовым. Теперь дайте Dynamics, куда обращаться.

### Вариант A — поток Power Automate (рекомендуется)

Это путь, по которому стоит пойти большинству команд: полезная нагрузка под вашим контролем, и устанавливать ничего не нужно.

1. В [Power Automate](https://make.powerautomate.com) создайте **Automated cloud flow**.
2. Триггер: **Microsoft Dataverse → When a row is added, modified or deleted**.

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — любой более узкий вариант срабатывает только на строки, принадлежащие вам или вашему подразделению.
   - **Select columns**: `statecode,statuscode`. Это фильтр только для обновлений, и его стоит задать правильно. Колонки-подстановки здесь не поддерживаются, и никогда не перечисляйте колонку, которая присутствует в каждом обновлении (например, первичный ключ), иначе поток будет срабатывать при каждом сохранении.

3. Добавьте **Microsoft Dataverse → Get a row by ID**, таблица `Cases`, идентификатор строки — из триггера, а в **Select columns** — `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`.

   Этот второй вызов оправдывает свою цену. При обновлении триггер несёт только изменившиеся колонки, поэтому идентификаторов, по которым вам нужно сопоставлять, там может попросту не быть.

4. Добавьте встроенное действие **HTTP**:

   - **Method**: `POST`
   - **URI**: URL вебхука OneUptime из предыдущего раздела
   - **Headers**: `Content-Type: application/json` и `X-OneUptime-Secret: <the same secret>`
   - **Body**: соберите его из выходов *Get a row by ID*, например

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. Сохраните и включите поток.

Что стоит знать, прежде чем выбрать этот путь:

- **Коннектор Microsoft Dataverse — премиальный.** Для автоматизированного потока лицензия нужна только владельцу потока, а не всем, кого касается обращение, — но истёкшая лицензия владельца незаметно останавливает поток.
- Триггеры Dataverse работают **по push, а не по опросу**: Dynamics регистрирует обратный вызов и вызывает его. Обычно доставка занимает секунды; всё, что больше пяти минут, означает, что асинхронная служба перегружена, — это видно в разделе **Settings → System Jobs** в admin center.
- Пользовательские заголовки не теряются. Power Automate вырезает из действий HTTP несколько стандартных семейств заголовков (большинство `Accept-*` и `Content-*`, `Host`, `Origin`, `Cookie`), но ваш собственный заголовок вроде `X-OneUptime-Secret` проходит насквозь.
- Поток должен находиться в той же среде, что и таблица, за которой он следит.
- Запросы учитываются в квоте запросов Power Platform вашего тенанта, а троттлинг коннектора проявляется как `429` внутри запуска потока.

### Вариант B — нативный вебхук Dataverse

Если Power Automate недоступен, Dataverse может обращаться к OneUptime напрямую. Зарегистрируйте конечную точку с помощью [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook): **Register New WebHook**, укажите URL OneUptime, выберите аутентификацию **HttpHeader** и добавьте `X-OneUptime-Secret` со своим секретом. Затем зарегистрируйте шаг на таблице **incident** для сообщения **Update**, ограничив **Filtering Attributes** нужными вам колонками, стадия **PostOperation**, режим выполнения **Asynchronous**.

Идите этим путём с открытыми глазами:

- **Только порты 80 и 443.** Self-hosted OneUptime на любом другом порту зарегистрировать не получится.
- **Dataverse не проверяет ваш секрет.** Он отправляет заголовок; отклонять запрос, который его не несёт, — целиком забота вашего рабочего процесса, и именно для этого в принимающем рабочем процессе стоит блок **If / Else**.
- **Полезная нагрузка — не дружелюбный JSON-объект.** Это сериализованный `RemoteExecutionContext`, в котором `InputParameters` — это *массив* пар `{key, value}`, а изменённая строка лежит под ключом `Target` со своими колонками в ещё одном массиве `Attributes`. Готовьтесь добавить блок **Run Custom JavaScript**, чтобы разложить это в плоскую структуру, прежде чем это сможет прочитать что-то ещё.
- **При обновлении включаются только изменённые колонки**, поэтому регистрируйте **Post Image**, если вам нужен `ticketnumber` или ваша колонка с идентификатором OneUptime.
- **Свыше 256 КБ самое интересное вырезается**: `InputParameters`, `PreEntityImages` и `PostEntityImages` пропадают, а запрос несёт заголовок `x-ms-dynamics-msg-size-exceeded`. `PrimaryEntityId` и `PrimaryEntityName` остаются, так что запасной вариант — прочитать строку обратно через Web API.
- **Доставка почти не прощает ошибок.** Dataverse ждёт `2xx` 60 секунд и повторяет ровно один раз, только для `502`, `503` и `504`. Всё остальное — включая `500` с вашей стороны — не повторяется; это оседает как неудавшийся System Job.
- Выбирайте **Asynchronous**. Синхронный шаг блокирует сохранение агента на вашей конечной точке, а если транзакция затем откатится, запрос уже ушёл и отозвать его нельзя.

У классических фоновых процессов Dynamics вообще нет шага HTTP или вебхука, поэтому третьим вариантом они здесь не являются.

## То же самое для оповещений

Всё написанное выше построено вокруг инцидентов, потому что это самый частый случай, но с оповещениями всё работает точно так же — замените тип записи, и больше ничего не изменится:

| Инцидент                                                     | Оповещение                                          |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

У рабочего процесса ровно один триггер, поэтому под инциденты и оповещения нужно по отдельному рабочему процессу. Если оба делают одно и то же, соберите половину для Dynamics один раз и вызывайте её из обоих компонентом **Execute Workflow**.

## Устранение неполадок

Сначала прочитайте отказавший блок в разделе **Запуски и журналы** — обе конечные точки Microsoft возвращают поясняющее JSON-тело, а компонент API сохраняет его в `response-body`.

**Запрос токена падает с `400` и `invalid_request` или сообщением о неподдерживаемом типе гранта.** Заголовок `Content-Type` записан не ровно как `Content-Type: application/x-www-form-urlencoded`, поэтому тело ушло как JSON. Проверьте регистр букв.

**`400` с `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** Значение `scope` не равно URL вашей среды плюс `/.default`. Скопируйте URL из **Developer resources** и уберите завершающую косую черту и любой путь `/api/data/...`.

**`401 Unauthorized` от Dynamics.** Заголовок `Authorization` отсутствует, повреждён или токен истёк посреди запуска. Он должен читаться как `Bearer <token>` с одним пробелом.

**`403 Forbidden` с `0x80072560`, «The user isn't a member of the organization».** Шаг 2 пропущен либо application user привязан к другой регистрации приложения. С токеном всё в порядке, а вот пользователя на стороне Dynamics нет.

**`403 Forbidden` с ошибкой привилегий.** Application user существует, но его пользовательской роли безопасности не хватает прав Create, Read или Write на таблице **Case**.

**`400 Bad Request` с упоминанием клиента.** `customerid` обязателен. Задайте `customerid_account@odata.bind` или `customerid_contact@odata.bind`, написанные в точности так, с URI, начинающимся с косой черты, например `/accounts(<guid>)`.

**`404 Not Found` на `/CloseIncident`.** Это действие относится к Dynamics 365 Customer Service. Поищите его в `$metadata` вашей среды, прежде чем считать доступным.

**`412 Precondition Failed` с `DuplicateRecord`.** Сработало правило обнаружения дубликатов. Либо сузьте правило, либо перестаньте отправлять поле, по которому оно срабатывает.

**`429 Too Many Requests`.** Лимиты защиты службы Dataverse — примерно 6 000 запросов и 20 минут времени выполнения на пользователя в любом пятиминутном окне, на каждый веб-сервер. В ответе приходит `Retry-After` в секундах. Если рабочий процесс работает всплесками, поставьте в него блок **Delay** или перенесите работу в рабочий процесс по расписанию, который обрабатывает пакетами.

**В OneUptime ничего не приходит.** Отправьте запрос на URL вебхука сами через `curl` и проверьте **Запуски и журналы** рабочего процесса. Если ваш собственный запрос появляется, а запрос Dynamics — нет, проблема выше по цепочке: для Power Automate смотрите историю запусков самого потока, для нативного вебхука — **Settings → System Jobs** с фильтром по сбоям.

**Рабочий процесс запускается, но инцидент не меняется.** Блок **Update One Incident** сообщает `Items Updated: 0`, когда запрос ничего не нашёл, — это успех, а не ошибка. Проверьте, что идентификатор в полезной нагрузке — это идентификатор инцидента OneUptime и что вы запрашиваете по `_id`.

## Что читать дальше

- [Обзор интеграций](/docs/integrations/index) — входящий и исходящий паттерны и шпаргалка по аутентификации.
- [Jira](/docs/integrations/jira) — та же двусторонняя сборка для Jira.
- [Обзор рабочих процессов](/docs/workflows/index) и [Создание рабочего процесса](/docs/workflows/authoring) — холст, идентификаторы и включение рабочего процесса.
- [Компоненты](/docs/workflows/components) — блоки API, If / Else и компоненты данных OneUptime.
- [Переменные](/docs/workflows/variables) — секреты и чтение вывода одного блока следующим.
- [Конфигурация и безопасность](/docs/workflows/configuration) — безопасность вебхуков и исходящий сетевой доступ.
- [IP-адреса](/docs/configuration/ip-addresses) — исходящие диапазоны OneUptime, если Dynamics стоит за списком разрешённых адресов.
