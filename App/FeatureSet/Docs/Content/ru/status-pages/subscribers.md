# Подписчики и объявления

Страница статуса — это место, куда люди заходят. Подписчики — это те, кто предпочёл бы этого не делать: они один раз оставляют вам email-адрес, номер телефона, webhook Slack или HTTP-эндпоинт, и после этого ваши обновления приходят к ним сами.

Объявления — вторая половина той же задачи. Монитор может сообщить вашим посетителям, что checkout возвращает 500-е ошибки; ни один монитор не сообщит им, что в субботу вы мигрируете базы данных, что у стороннего провайдера плохой день или что инцидент, о котором они читали вчера, полностью закрыт. Объявления — это канал свободного текста для всего, что ваши проверки не видят, и они рассылаются тому же списку подписчиков.

Эта страница охватывает оба аспекта: пять каналов подписки и то, как посетители на них подписываются, что подписчики могут выбрать для получения, потоки двойного подтверждения (double opt-in) и отписки, а также как объявления пишутся, планируются и оформляются по шаблонам.

## Каналы подписки

Страница статуса поддерживает пять каналов, у каждого свой переключатель на странице статуса. Перейдите в **Status Pages → ваша страница → Subscribers → Subscriber Settings**:

- **Enable Email Subscribers** (`enableEmailSubscribers`) — включён по умолчанию. Всё остальное выключено, пока вы не включите это.
- **Enable SMS Subscribers** (`enableSmsSubscribers`) — по умолчанию выключен.
- **Enable Slack Subscribers** (`enableSlackSubscribers`) — по умолчанию выключен.
- **Enable Microsoft Teams Subscribers** (`enableMicrosoftTeamsSubscribers`) — по умолчанию выключен.
- **Enable Webhook Subscribers** (`enableWebhookSubscribers`) — по умолчанию выключен.

У каждого канала также есть свой список в боковом меню страницы статуса под **Subscribers**: **Email Subscribers**, **SMS Subscribers**, **Slack Subscribers**, **MS Teams Subscribers** и **Webhook Subscribers**. Именно там вы смотрите, кто подписан, добавляете кого-то вручную или оставляете себе запись **Notes** (`internalNote`) у конкретного подписчика.

**Одного переключателя недостаточно.** Пункт **Subscribe** в навигационной панели страницы статуса появляется, только когда **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) включён *и* включён хотя бы один канал. Если вы включите **Enable Email Subscribers**, но оставите **Show Subscriber Page** выключенным, у посетителей не будет способа добраться до формы.

Те же пять переключателей появляются второй раз внутри карточки **Subscriber Settings** на **Advanced Settings**, рядом с **Show Subscriber Page**. Под капотом это те же самые столбцы — выберите один экран и придерживайтесь его, предпочтительно отдельную страницу **Subscriber Settings**, поскольку именно там находится остальная часть настроек подписчиков.

## Что видит посетитель на странице Subscribe

У страницы **Subscribe** есть подменю с одной вкладкой на каждый включённый канал — **Email**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — сопоставленные с `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` и `/subscribe/webhooks`. Каждая вкладка запрашивает минимум необходимого:

- **Email** — заголовок **Subscribe by Email**, одно поле **Your Email** с плейсхолдером `subscriber@company.com`.
- **SMS** — заголовок **Subscribe by SMS**, одно поле **Your Phone Number** с плейсхолдером `+11234567890`.
- **Slack** — заголовок **Subscribe by Slack**, с **Slack Workspace Name** (используется для проверки) и **Slack Incoming Webhook URL**, плейсхолдер `https://hooks.slack.com/services/...`.
- **MS Teams** — заголовок **Subscribe by Microsoft Teams**, с **Microsoft Teams Workspace Name** и **Microsoft Teams Incoming Webhook URL**, плейсхолдер `https://outlook.office.com/webhook/...`.
- **Webhooks** — заголовок **Subscribe by Webhook**, одно поле **Webhook URL**. На него отправляется JSON-запрос `POST` при каждом событии страницы статуса.

Кнопка отправки называется **Subscribe**, а успешная подписка показывает *You have been subscribed successfully.* На странице также есть разделение **New Subscription** / **Manage Existing Subscription**, так что тот, кто уже подписан, может вернуться к своим настройкам, не разыскивая старое письмо.

## Разрешение подписчикам выбирать ресурсы и типы событий

По умолчанию подписчик получает всё, что есть на странице. Два переключателя в карточке **Advanced Subscriber Settings** меняют это:

- **Allow Subscribers to Choose Resources** (`allowSubscribersToChooseResources`) — по умолчанию выключен. Включите его, и в форме подписки появится переключатель **Subscribe to All Resources**; снимите его, и появится **Select Resources to Subscribe**, чтобы посетитель мог выбрать отдельные ресурсы.
- **Allow Subscribers to Choose Event Types** (`allowSubscribersToChooseEventTypes`) — по умолчанию выключен. Та же структура: переключатель **Subscribe to All Event Types**, и **Select Event Types to Subscribe** под ним, когда он снят.

Типы событий: `Incident`, `Announcement` и `Scheduled Event`.

Выборы записываются в запись подписчика как **Is Subscribed to All Resources** (`isSubscribedToAllResources`, по умолчанию true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, по умолчанию true), **Subscribed to Resources** и **Subscribed to Event Types**.

Полезно для: страницы, охватывающей несколько продуктов. Клиент, который использует только ваш API, не хочет получать письмо каждый раз, когда шатается маркетинговый сайт — позвольте ему самому сузить список, а не наблюдать, как он полностью отписывается.

Та же карточка содержит и **Subscriber Timezones**.

## Двойное подтверждение (double opt-in) для email

Email-подписчики всегда подтверждают подписку. Когда подписчик создаётся с email-адресом и не был создан уже подтверждённым, **Is Subscription Confirmed** (`isSubscriptionConfirmed`) принудительно устанавливается в `false`, и генерируется шестизначный **Subscription Confirmation Token**. Затем OneUptime отправляет письмо со ссылкой подтверждения вида `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. Посетитель попадает на страницу **Confirm Subscription** и, как только всё проходит успешно, видит *Subscription confirmed successfully*.

Подписчики SMS, Slack, Microsoft Teams и webhook пропускают это — они создаются уже с `isSubscriptionConfirmed`, установленным в `true`.

**Неподтверждённый — значит молчащий.** Запрос, который выбирает подписчиков для уведомления, фильтрует по `isUnsubscribed: false` и `isSubscriptionConfirmed: true`. Email-адрес, который никогда не нажал ссылку, будет сидеть в вашем списке **Email Subscribers** и ничего не получать. Если кто-то клянётся, что подписан, но ничего не получает, сначала проверьте этот столбец.

Переключателя, чтобы отключить подтверждение email, нет — оно безусловно для всех, кто подписывается через страницу статуса. Отдельный столбец на уровне подписчика, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, по умолчанию true), управляет письмом «вы подписались», которое отправляется, как только подписчик подтверждён.

## Управление и отмена подписки

Каждое письмо подписчику содержит ссылку отписки вида `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Эта страница называется **Update Subscription** и сообщает посетителю, что он может обновить свои настройки или отписаться там. На ней есть:

- Любые селекторы ресурсов и типов событий, которые разрешены на странице.
- Переключатель **Unsubscribe**, описанный как отписка от всех ресурсов. Он записывает **Is Unsubscribed** (`isUnsubscribed`, по умолчанию false).
- Кнопка отправки **Update Subscription**; при сохранении показывается *Your changes have been saved.*

Тот, кто потерял ссылку, использует **Manage Existing Subscription** на странице **Subscribe** и нажимает **Send Management Link**. OneUptime отвечает, что письмо со ссылкой отправлено, и просит проверить папку со спамом, если оно не приходит.

Эндпоинты, стоящие за всем этим: `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` и `PUT .../update-subscription/:statusPageId/:subscriberId`.

Отписка переключает флаг, а не удаляет запись, так что запись остаётся в списке канала с установленным **Is Unsubscribed** — полезно, когда позже нужно объяснить, почему конкретный адрес перестал получать письма.

## О чём подписчики получают уведомления

Подписчики узнают о трёх типах событий, описанных выше, но у каждого источника свой переключатель, так что ничего не отправляется случайно.

### Уведомления об объявлениях

Само объявление несёт **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), представленный в форме создания как чекбокс **Notify Status Page Subscribers**, включённый по умолчанию. Если объявление указывает мониторы в **Monitors affected (Optional)**, уведомление ограничивается этими мониторами; оставьте поле пустым, и уведомление получат все подписчики.

### Плановые события обслуживания

У планового события обслуживания есть собственный набор столбцов подписчиков: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, а также **Subscriber notifications before the event** и **Next subscriber notification before the event at?** для предварительных предупреждений. **Status Pages** у события определяет, на каких страницах оно появляется, а **Should be visible on status page?** определяет, появляется ли оно вообще.

### Инциденты

`Incident` — третий тип события. То, что заставляет инцидент вообще попасть на страницу статуса — какие ресурсы он затрагивает и какие состояния оставляют его видимым, — описано в [Состояния и уровни серьёзности инцидентов](/docs/incidents/states-and-severities).

Раздел **Notification Logs** в боковом меню страницы статуса (`{id}/notification-logs`) — это место, куда вы идёте, когда нужно посмотреть, что страница на самом деле отправила.

## Настройка шаблонов уведомлений

Карточка **Notification Templates** на **Subscriber Settings** перечисляет шаблоны, которые использует эта страница статуса, со столбцами **Template Name**, **Event Type** и **Notification Method** — так что вы можете варьировать формулировку по типу события и по каналу, а не принимать одно общее сообщение для всего.

Общепроектные шаблоны находятся на уровень выше, в **Status Pages → Settings → Subscriber Templates**, рядом с **Announcement Templates**.

## Футер письма, пользовательский SMTP и Twilio

Ещё три карточки на **Subscriber Settings** управляют тем, как сообщения подписчикам покидают ваш проект:

- **Email Footer Settings** — **Enable Custom Email Footer Text** и **Subscriber Email Notification Footer Text** размещают ваш собственный футер в письмах подписчикам.
- **Custom SMTP** — **Custom SMTP Config** отправляет письма подписчикам через ваш собственный почтовый сервер вместо стандартного.
- **Twilio Config** — **Twilio Config** — это аккаунт Twilio, используемый для SMS-подписчиков.

Пользовательский SMTP стоит настроить заранее, если у вас есть email-подписчики: письма, приходящие с вашего собственного домена, гораздо реже попадают под фильтры и гораздо больше внушают доверие клиенту, читающему их в два часа ночи.

## Объявления

Объявление — это запись на уровне проекта (модель `StatusPageAnnouncement`), которую вы рассылаете на одну или несколько страниц статуса, опционально ограничивая её конкретными мониторами, с окном времени, в течение которого она отображается.

Вы создаёте его из **Status Pages → More → Announcements** или из **Announcements** в боковом меню отдельной страницы статуса. Форма создания — четырёхшаговый мастер:

1. **Basic Information** — **Announcement Title** (обязательно, минимум два символа), **Description** (Markdown, необязательно) и **Attachments** для файлов, которые должны быть доступны вместе с объявлением на странице статуса.
2. **Status Pages** — **Show announcement on these status pages**, обязательный мультивыбор. Одно объявление может быть нацелено сразу на несколько страниц.
3. **Resources Affected** — **Monitors affected (Optional)**. Если вы ничего не выберете, уведомление получат все подписчики.
4. **Schedule & Settings** — **Start Showing Announcement At** (обязательно, по умолчанию сейчас), **End Showing Announcement At** (необязательно) и **Notify Status Page Subscribers** (включено по умолчанию).

Посетители читают объявления на `/announcements`, разделённые на **Active Announcements** и **Past Announcements**, каждое отмечено меткой **Announced at**. Текущие активные объявления также закрепляются вверху страницы обзора. Когда показывать нечего, страница отображает *No Announcement* с пометкой, что пока ничего не публиковалось.

Вложения отдаются через `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, за той же проверкой доступа на чтение, что и сама страница статуса — так что вложение на приватной странице остаётся приватным.

## Как работает планирование объявлений

**Show At** (`showAnnouncementAt`) и **End At** (`endAnnouncementAt`) определяют всё, но страница обзора и список объявлений задают разные вопросы, и эта разница сбивает с толку.

- **Страница обзора** показывает объявление, когда `showAnnouncementAt` в прошлом, а `endAnnouncementAt` либо в будущем, либо пусто.
- **Список `/announcements`** показывает объявления, у которых `showAnnouncementAt` попадает в **Show Announcement History (in days)** (`showAnnouncementHistoryInDays`, по умолчанию 14), а затем разбивает их на стороне клиента на активные и прошедшие.

Два следствия, которые стоит учитывать заранее:

- **Объявление без даты окончания никогда не истекает.** Оставьте **End Showing Announcement At** пустым, и оно останется закреплённым на странице обзора бессрочно. Устанавливайте дату окончания для всего, что ограничено во времени.
- **Старое, но всё ещё активное объявление может исчезнуть из списка.** Если оно началось раньше, чем `showAnnouncementHistoryInDays` дней назад, оно выпадает из `/announcements`, оставаясь при этом на странице обзора. Увеличьте окно истории, если вы держите долгоживущие уведомления.

Появляются ли объявления вообще, управляется карточкой **Announcement Settings** на **Advanced Settings**: **Show Announcements** (`showAnnouncementsOnStatusPage`, по умолчанию true) и **Show Announcement History (in days)** (по умолчанию 14). При выключенном **Show Announcements** эндпоинт объявлений полностью отклоняет запрос.

## Шаблоны объявлений

Если вы публикуете один и тот же тип уведомления повторно — ежемесячное предупреждение об обслуживании, повторяющуюся деградацию у стороннего сервиса, — заготовьте его заранее. **Status Pages → Settings → Announcement Templates** хранит модель `StatusPageAnnouncementTemplate`, и её форма запрашивает **Template Name**, **Template Description**, **Announcement Title**, **Description**, **Show announcement on these status pages**, **Monitors affected (Optional)** и **Notify Subscribers**, так что решение о рассылке и об уведомлении принимается один раз, а не каждый раз заново.

## Подписчики на webhook и защита от SSRF

Подписчики на webhook получают JSON-запрос `POST` при каждом событии страницы статуса, что делает их самым простым способом передавать обновления страницы статуса в вашу собственную систему — чат-бота, внутренний дашборд, очередь тикетов.

Поскольку подписка — это публичная операция на публичной странице, OneUptime защищает цель:

- Обычный **Webhook URL** проверяется перед принятием, и приватные, loopback, link-local адреса и адреса cloud-metadata отклоняются. Вы не можете направить подписку на что-то внутри собственной сети развёртывания OneUptime.
- **Slack Incoming Webhook URL** должен начинаться с `https://hooks.slack.com/services/`.

Если подписка на webhook отклонена при регистрации, в первую очередь проверьте внутренний или некорректный URL.

## Что читать дальше

- [Обзор страниц статуса](/docs/status-pages/index) — что такое страница статуса и как она устроена.
- [Ресурсы и группы страницы статуса](/docs/status-pages/resources-and-groups) — мониторы и группы, между которыми могут выбирать подписчики.
- [Оформление и домены страницы статуса](/docs/status-pages/branding-and-domains) — пользовательские домены, логотипы и внешний вид страницы, на которую ссылаются ваши письма.
- [Публичный API](/docs/status-pages/public-api) — программное чтение данных страницы статуса.
- [Состояния и уровни серьёзности инцидентов](/docs/incidents/states-and-severities) — что помещает инцидент на страницу статуса и что убирает его оттуда.
- [Настройки и автоматизация инцидентов](/docs/incidents/settings) — правила на уровне проекта, стоящие за коммуникацией по инцидентам.
