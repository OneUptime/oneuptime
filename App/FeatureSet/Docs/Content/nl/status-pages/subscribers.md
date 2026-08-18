# Abonnees en aankondigingen

Een statuspagina is een plek waar mensen naartoe gaan. Abonnees zijn de mensen die dat liever niet hoeven te doen — ze geven je eenmalig een e-mailadres, een telefoonnummer, een Slack-webhook of een HTTP-eindpunt, en daarna komen je updates naar hen toe.

Aankondigingen zijn de andere helft van dezelfde taak. Een monitor kan je bezoekers vertellen dat de kassa 500's retourneert; geen enkele monitor kan hen vertellen dat je op zaterdag databases migreert, dat een externe provider een slechte dag heeft, of dat het incident waarover ze gisteren lazen volledig is afgesloten. Aankondigingen zijn het vrije-tekstkanaal voor alles wat je checks niet kunnen zien, en ze worden verspreid naar dezelfde abonneelijst.

Deze pagina behandelt beide: de vijf abonnementskanalen en hoe bezoekers zich aanmelden, waar abonnees voor kunnen kiezen, de dubbele opt-in- en afmeldflows, en hoe aankondigingen worden geschreven, gepland en gesjabloneerd.

## Abonnementskanalen

Een statuspagina ondersteunt vijf kanalen, elk met een eigen schakelaar op de statuspagina. Ga naar **Statuspagina's → jouw pagina → Abonnees → Abonneeinstellingen**:

- **Enable Email Subscribers** (`enableEmailSubscribers`) — standaard aan. Al het andere staat uit totdat je het inschakelt.
- **Enable SMS Subscribers** (`enableSmsSubscribers`) — standaard uit.
- **Enable Slack Subscribers** (`enableSlackSubscribers`) — standaard uit.
- **Enable Microsoft Teams Subscribers** (`enableMicrosoftTeamsSubscribers`) — standaard uit.
- **Enable Webhook Subscribers** (`enableWebhookSubscribers`) — standaard uit.

Elk kanaal krijgt ook zijn eigen lijst in het zijmenu van de statuspagina onder **Abonnees**: **E-mail-abonnees**, **SMS-abonnees**, **Slack-abonnees**, **MS Teams-abonnees** en **Webhook-abonnees**. Daar bekijk je wie er is aangemeld, voeg je iemand handmatig toe, of laat je jezelf een **Notes**-item (`internalNote`) achter bij een bepaalde abonnee.

**Eén schakelaar is niet genoeg.** Het item **Subscribe** in de navigatiebalk van de statuspagina verschijnt alleen wanneer **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) aan staat *en* minstens één kanaal is ingeschakeld. Als je **Enable Email Subscribers** aanzet maar **Show Subscriber Page** uit laat staan, hebben bezoekers geen manier om het formulier te bereiken.

Dezelfde vijf schakelaars verschijnen een tweede keer in de kaart **Abonneeinstellingen** op **Geavanceerde instellingen**, naast **Show Subscriber Page**. Het zijn onderliggend dezelfde kolommen — kies één scherm en blijf daarbij, en geef de voorkeur aan de eigen pagina **Abonneeinstellingen**, aangezien daar de rest van de abonneeconfiguratie zich bevindt.

## Wat een bezoeker ziet op de Subscribe-pagina

De pagina **Subscribe** heeft een submenu met één tabblad per ingeschakeld kanaal — **Email**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — gekoppeld aan `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` en `/subscribe/webhooks`. Elk tabblad vraagt het minimum dat het nodig heeft:

- **Email** — kop **Subscribe by Email**, één veld **Your Email** met de placeholder `subscriber@company.com`.
- **SMS** — kop **Subscribe by SMS**, één veld **Your Phone Number** met de placeholder `+11234567890`.
- **Slack** — kop **Subscribe by Slack**, met **Slack Workspace Name** (gebruikt voor validatie) en **Slack Incoming Webhook URL**, placeholder `https://hooks.slack.com/services/...`.
- **MS Teams** — kop **Subscribe by Microsoft Teams**, met **Microsoft Teams Workspace Name** en **Microsoft Teams Incoming Webhook URL**, placeholder `https://outlook.office.com/webhook/...`.
- **Webhooks** — kop **Subscribe by Webhook**, één veld **Webhook URL**. Bij elke statuspaginagebeurtenis wordt er een JSON `POST`-verzoek naartoe gestuurd.

De submitknop luidt **Subscribe**, en een geslaagde aanmelding toont *You have been subscribed successfully.* De pagina heeft ook een splitsing **New Subscription** / **Manage Existing Subscription**, zodat iemand die al is geabonneerd terug kan naar zijn voorkeuren zonder een oude e-mail te hoeven opzoeken.

## Abonnees resources en gebeurtenistypen laten kiezen

Standaard krijgt een abonnee alles op de pagina. Twee schakelaars in de kaart **Advanced Subscriber Settings** veranderen dat:

- **Allow Subscribers to Choose Resources** (`allowSubscribersToChooseResources`) — standaard uit. Zet je dit aan, dan krijgt het abonneeformulier een schakelaar **Subscribe to All Resources**; wis je die, dan verschijnt **Select Resources to Subscribe** zodat de bezoeker afzonderlijke resources kan kiezen.
- **Allow Subscribers to Choose Event Types** (`allowSubscribersToChooseEventTypes`) — standaard uit. Dezelfde vorm: een schakelaar **Subscribe to All Event Types**, en daaronder **Select Event Types to Subscribe** wanneer die is gewist.

De gebeurtenistypen zijn `Incident`, `Announcement` en `Scheduled Event`.

De keuzes komen terecht op het abonneerecord als **Is Subscribed to All Resources** (`isSubscribedToAllResources`, standaard true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, standaard true), **Subscribed to Resources** en **Subscribed to Event Types**.

Goed voor: een pagina die meerdere producten dekt. Een klant die alleen je API gebruikt, wil geen melding elke keer dat de marketingsite wiebelt — laat ze zelf de lijst versmallen in plaats van toe te kijken hoe ze zich helemaal afmelden.

Dezelfde kaart bevat ook **Subscriber Timezones**.

## Dubbele opt-in voor e-mail

E-mailabonnees bevestigen altijd. Wanneer een abonnee wordt aangemaakt met een e-mailadres en niet al bevestigd is aangemaakt, wordt **Is Subscription Confirmed** (`isSubscriptionConfirmed`) geforceerd op `false` gezet en wordt er een zescijferig **Subscription Confirmation Token** gegenereerd. OneUptime mailt vervolgens een bevestigingslink in de vorm `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. De bezoeker komt terecht op een pagina **Confirm Subscription** en ziet, zodra dit lukt, *Subscription confirmed successfully*.

SMS-, Slack-, Microsoft Teams- en webhookabonnees slaan dit over — zij worden aangemaakt met `isSubscriptionConfirmed` al ingesteld op `true`.

**Onbevestigd betekent stil.** De query die abonnees ophaalt voor een melding filtert op `isUnsubscribed: false` en `isSubscriptionConfirmed: true`. Een e-mailadres dat nooit op de link heeft geklikt, blijft in je lijst **E-mail-abonnees** staan en ontvangt niets. Als iemand zweert dat hij geabonneerd is maar niets hoort, controleer dan eerst die kolom.

Er is geen schakelaar om e-mailbevestiging uit te zetten — dit is onvoorwaardelijk voor iedereen die zich via de statuspagina aanmeldt. Een aparte kolom per abonnee, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, standaard true), bepaalt de "je bent geabonneerd"-e-mail die wordt verstuurd zodra een abonnee is bevestigd.

## Een abonnement beheren en opzeggen

Elke abonnee-e-mail bevat een afmeldlink in de vorm `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Die pagina heet **Update Subscription** en vertelt de bezoeker dat hij daar zijn voorkeuren kan bijwerken of zich kan afmelden. De pagina bevat:

- Welke resource- en gebeurtenistype-kiezers de pagina ook toestaat.
- Een schakelaar **Unsubscribe**, beschreven als afmelden van alle resources. Deze schrijft **Is Unsubscribed** (`isUnsubscribed`, standaard false).
- Een submitknop met de tekst **Update Subscription**; opslaan toont *Your changes have been saved.*

Iemand die de link kwijt is, gebruikt **Manage Existing Subscription** op de pagina **Subscribe** en drukt op **Send Management Link**. OneUptime antwoordt dat er een e-mail met de link is verstuurd en dat je de spamfolder moet controleren als die niet aankomt.

De eindpunten achter dit alles zijn `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` en `PUT .../update-subscription/:statusPageId/:subscriberId`.

Afmelden zet een vlag om in plaats van een rij te verwijderen, dus het record blijft in de kanaallijst staan met **Is Unsubscribed** ingesteld — handig wanneer je later moet uitleggen waarom een bepaald adres geen mail meer ontving.

## Waarover abonnees worden geïnformeerd

Abonnees horen over de drie bovenstaande gebeurtenistypen, maar elke bron heeft zijn eigen schakelaar, zodat er niets per ongeluk wordt verstuurd.

### Meldingen bij aankondigingen

De aankondiging zelf bevat **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), op het aanmaakformulier weergegeven als het selectievakje **Notify Status Page Subscribers**, standaard aan. Als de aankondiging monitoren noemt onder **Monitors affected (Optional)**, wordt de melding beperkt tot die monitoren; laat je het leeg, dan worden alle abonnees geïnformeerd.

### Geplande onderhoudsevenementen

Een gepland onderhoudsevenement heeft zijn eigen set abonneekolommen: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, plus **Subscriber notifications before the event** en **Next subscriber notification before the event at?** voor waarschuwingen vooraf. **Status Pages** op het evenement bepaalt op welke pagina's het verschijnt, en **Should be visible on status page?** bepaalt of het überhaupt verschijnt.

### Incidenten

`Incident` is het derde gebeurtenistype. Wat een incident in de eerste plaats op een statuspagina laat verschijnen — welke resources het raakt en welke statussen het zichtbaar houden — wordt behandeld in [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

De sectie **Notification Logs** in het zijmenu van de statuspagina (`{id}/notification-logs`) is waar je terechtkunt wanneer je wilt zien wat de pagina daadwerkelijk heeft verstuurd.

## Meldingssjablonen aanpassen

De kaart **Notification Templates** op **Subscriber Settings** toont de sjablonen die deze statuspagina gebruikt, met de kolommen **Template Name**, **Event Type** en **Notification Method** — zo kun je de bewoording variëren per gebeurtenistype en per kanaal in plaats van voor alles één huisboodschap te accepteren.

Projectbrede sjablonen bevinden zich één niveau hoger, bij **Status Pages → Settings → Subscriber Templates**, naast **Announcement Templates**.

## E-mailfooter, aangepaste SMTP en Twilio

Nog drie kaarten op **Subscriber Settings** bepalen hoe abonneeberichten je project verlaten:

- **Email Footer Settings** — **Enable Custom Email Footer Text** en **Subscriber Email Notification Footer Text** plaatsen je eigen footer op abonnee-e-mails.
- **Custom SMTP** — **Custom SMTP Config** verstuurt abonnee-e-mail via je eigen mailserver in plaats van de standaard.
- **Twilio Config** — **Twilio Config** is het Twilio-account dat wordt gebruikt voor SMS-abonnees.

Aangepaste SMTP is de moeite waard om vroeg te doen als je e-mailabonnees hebt: mail die van je eigen domein komt, wordt veel minder snel gefilterd en veel eerder vertrouwd door de klant die er om 2 uur 's nachts naar kijkt.

## Aankondigingen

Een aankondiging is een projectniveau-record (het model `StatusPageAnnouncement`) dat je verspreidt naar één of meer statuspagina's, optioneel beperkt tot specifieke monitoren, met een venster waarin het wordt weergegeven.

Je maakt er een aan vanuit **Status Pages → More → Announcements**, of vanuit **Announcements** in het zijmenu van een individuele statuspagina. Het aanmaakformulier is een wizard met vier stappen:

1. **Basic Information** — **Announcement Title** (verplicht, minimaal twee tekens), **Description** (Markdown, optioneel) en **Attachments** voor bestanden die samen met de aankondiging beschikbaar moeten zijn op de statuspagina.
2. **Status Pages** — **Show announcement on these status pages**, een verplichte multiselect. Eén aankondiging kan meerdere pagina's tegelijk targeten.
3. **Resources Affected** — **Monitors affected (Optional)**. Selecteer je er geen, dan worden alle abonnees geïnformeerd.
4. **Schedule & Settings** — **Start Showing Announcement At** (verplicht, standaard nu), **End Showing Announcement At** (optioneel) en **Notify Status Page Subscribers** (standaard aan).

Bezoekers lezen aankondigingen op `/announcements`, opgesplitst in **Active Announcements** en **Past Announcements**, elk voorzien van een stempel **Announced at**. Momenteel actieve aankondigingen worden ook bovenaan de overzichtspagina vastgezet. Als er niets te tonen is, toont de pagina *No Announcement* met de opmerking dat er tot nu toe nog niets is geplaatst.

Bijlagen worden geserveerd vanaf `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, achter dezelfde leescontrole als de statuspagina zelf — zodat een bijlage op een privépagina privé blijft.

## Hoe de planning van aankondigingen werkt

**Show At** (`showAnnouncementAt`) en **End At** (`endAnnouncementAt`) sturen alles aan, maar de overzichtspagina en de lijst met aankondigingen stellen verschillende vragen, en dat verschil is waar mensen over struikelen.

- **De overzichtspagina** toont een aankondiging wanneer `showAnnouncementAt` in het verleden ligt en `endAnnouncementAt` óf in de toekomst óf leeg is.
- **De lijst `/announcements`** toont aankondigingen waarvan `showAnnouncementAt` binnen **Show Announcement History (in days)** valt (`showAnnouncementHistoryInDays`, standaard 14), en splitst ze vervolgens clientseitig op in actief en verlopen.

Twee gevolgen om rekening mee te houden:

- **Een aankondiging zonder einddatum verloopt nooit.** Laat **End Showing Announcement At** leeg en de aankondiging blijft voor onbepaalde tijd vastgepind op de overzichtspagina. Stel een einddatum in voor alles wat tijdgebonden is.
- **Een oude maar nog actieve aankondiging kan uit de lijst verdwijnen.** Als deze meer dan `showAnnouncementHistoryInDays` geleden is begonnen, valt hij weg uit `/announcements` terwijl hij op de overzichtspagina blijft staan. Verhoog het geschiedenisvenster als je langlopende meldingen bijhoudt.

Of aankondigingen überhaupt verschijnen, wordt bepaald door de kaart **Announcement Settings** op **Advanced Settings**: **Show Announcements** (`showAnnouncementsOnStatusPage`, standaard true) en **Show Announcement History (in days)** (standaard 14). Met **Show Announcements** uit weigert het aankondigingen-eindpunt het verzoek volledig.

## Aankondigingssjablonen

Als je herhaaldelijk hetzelfde soort melding plaatst — een maandelijkse aankondiging voor onderhoud, een terugkerende storing bij een externe partij — zet het dan vooraf klaar. **Status Pages → Settings → Announcement Templates** bewaart het model `StatusPageAnnouncementTemplate`, en het formulier vraagt om **Template Name**, **Template Description**, **Announcement Title**, **Description**, **Show announcement on these status pages**, **Monitors affected (Optional)** en **Notify Subscribers**, zodat de verspreiding en de meldingsbeslissing één keer worden genomen in plaats van elke keer opnieuw.

## Webhookabonnees en SSRF-bescherming

Webhookabonnees ontvangen bij elke statuspaginagebeurtenis een JSON `POST`-verzoek, wat ze de eenvoudigste manier maakt om statuspagina-updates door te sluizen naar een eigen systeem — een chatbot, een intern dashboard, een ticketingwachtrij.

Omdat aanmelden een publieke handeling is op een publieke pagina, beschermt OneUptime het doel:

- Een generieke **Webhook URL** wordt gevalideerd voordat deze wordt geaccepteerd, en private, loopback-, link-local- en cloud-metadata-adressen worden geweigerd. Je kunt een abonnement niet richten op iets binnen het eigen netwerk van de OneUptime-installatie.
- Een **Slack Incoming Webhook URL** moet beginnen met `https://hooks.slack.com/services/`.

Als een webhookabonnement bij aanmelding wordt geweigerd, is een interne of onjuist gevormde URL het eerste om te controleren.

## Waar je hierna kunt lezen

- [Statuspagina's – Overzicht](/docs/status-pages/index) — wat een statuspagina is en hoe deze is opgebouwd.
- [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups) — de monitoren en groepen waaruit abonnees kunnen kiezen.
- [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains) — aangepaste domeinen, logo's en de uitstraling van de pagina waar je e-mails naar linken.
- [Public API](/docs/status-pages/public-api) — statuspaginagegevens programmatisch uitlezen.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — wat een incident op een statuspagina zet en wat het eraf haalt.
- [Incidentinstellingen en automatisering](/docs/incidents/settings) — de projectbrede regels achter incidentcommunicatie.
