# Abonnees en aankondigingen

Een statuspagina is een plek waar mensen naartoe gaan. Abonnees zijn de mensen die dat liever niet doen — ze geven je één keer een e-mailadres, een telefoonnummer, een Slack-webhook of een HTTP-endpoint, en daarna komen jouw updates naar hen toe.

Aankondigingen zijn de andere helft van datzelfde werk. Een monitor kan je bezoekers vertellen dat de checkout 500's teruggeeft; geen enkele monitor kan hun vertellen dat je zaterdag databases migreert, dat een externe leverancier een slechte dag heeft, of dat het incident waarover ze gisteren lazen volledig is afgerond. Aankondigingen zijn het vrijetekstkanaal voor alles wat je checks niet kunnen zien, en ze gaan uit naar dezelfde abonneelijst.

Deze pagina behandelt beide: de vijf abonnementskanalen en hoe bezoekers zich aanmelden, waarover abonnees zelf kunnen kiezen bericht te krijgen, de dubbele opt-in en het afmelden, en hoe je aankondigingen schrijft, inplant en in sjablonen giet.

## Abonnementskanalen

Een statuspagina ondersteunt vijf kanalen, elk met een eigen schakelaar op de statuspagina. Ga naar **Statuspagina's → jouw pagina → Abonnees → Abonneeinstellingen**:

- **E-mailabonnees inschakelen** (`enableEmailSubscribers`) — standaard aan. Al het andere staat uit tot je het aanzet.
- **SMS-abonnees inschakelen** (`enableSmsSubscribers`) — standaard uit.
- **Slack-abonnees inschakelen** (`enableSlackSubscribers`) — standaard uit.
- **Microsoft Teams-abonnees inschakelen** (`enableMicrosoftTeamsSubscribers`) — standaard uit.
- **Webhook-abonnees inschakelen** (`enableWebhookSubscribers`) — standaard uit.

Elk kanaal krijgt bovendien een eigen lijst in het zijmenu van de statuspagina, onder **Abonnees**: **E-mail-abonnees**, **SMS-abonnees**, **Slack-abonnees**, **MS Teams-abonnees** en **Webhook-abonnees**. Daar zie je wie zich heeft aangemeld, voeg je iemand met de hand toe, of laat je bij een bepaalde abonnee onder **Notities** (`internalNote`) een aantekening voor jezelf achter.

**Eén schakelaar is niet genoeg.** Het item **Abonneren** in de navigatiebalk van de statuspagina verschijnt pas wanneer **Abonneepagina weergeven** (`showSubscriberPageOnStatusPage`) aan staat *én* er minstens één kanaal is ingeschakeld. Zet je **E-mailabonnees inschakelen** aan maar laat je **Abonneepagina weergeven** uit, dan kunnen bezoekers het formulier nergens bereiken.

Dezelfde vijf schakelaars staan een tweede keer in de kaart **Abonneeinstellingen** op **Geavanceerde instellingen**, naast **Abonneepagina weergeven**. Eronder zitten dezelfde kolommen — kies één scherm en blijf daar, en houd het bij voorkeur op de aparte pagina **Abonneeinstellingen**, want daar staat de rest van de abonneeconfiguratie ook.

## Wat een bezoeker op de pagina Abonneren ziet

De pagina **Abonneren** heeft een submenu met één tabblad per ingeschakeld kanaal — **E-mail**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — gekoppeld aan `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` en `/subscribe/webhooks`. Elk tabblad vraagt alleen het hoognodige:

- **E-mail** — kop **Abonneren via e-mail**, één veld **Uw e-mailadres** met de placeholder `abonnee@bedrijf.nl`.
- **SMS** — kop **Abonneren via SMS**, één veld **Uw telefoonnummer** met de placeholder `+31612345678`.
- **Slack** — kop **Abonneren via Slack**, met **Slack-werkruimtenaam** (gebruikt voor validatie) en **URL van inkomende Slack-webhook**, placeholder `https://hooks.slack.com/services/...`.
- **MS Teams** — kop **Abonneren via Microsoft Teams**, met **Naam Microsoft Teams-werkruimte** en **URL van inkomende Microsoft Teams-webhook**, placeholder `https://outlook.office.com/webhook/...`.
- **Webhooks** — kop **Abonneren via webhook**, één veld **Webhook-URL**. Bij elke gebeurtenis op de statuspagina gaat daar een JSON-`POST`-verzoek naartoe.

De verzendknop heet **Abonneren**, en na een geslaagde aanmelding verschijnt *U bent succesvol geabonneerd.* De pagina kent ook een splitsing **Nieuw abonnement** / **Bestaand abonnement beheren**, zodat wie al geabonneerd is bij zijn voorkeuren komt zonder een oude e-mail te hoeven opzoeken.

## Abonnees zelf resources en gebeurtenistypen laten kiezen

Standaard krijgt een abonnee alles wat op de pagina staat. Twee schakelaars in de kaart **Geavanceerde abonnee-instellingen** veranderen dat:

- **Abonnees toestaan resources te kiezen** (`allowSubscribersToChooseResources`) — standaard uit. Zet je hem aan, dan krijgt het aanmeldformulier er een schakelaar **Abonneren op alle bronnen** bij; haal je die weg, dan verschijnt **Selecteer bronnen om op te abonneren** zodat de bezoeker afzonderlijke resources kan aanvinken.
- **Abonnees toestaan gebeurtenistypen te kiezen** (`allowSubscribersToChooseEventTypes`) — standaard uit. Zelfde patroon: een schakelaar **Abonneren op alle gebeurtenistypen**, met daaronder **Selecteer gebeurtenistypen om op te abonneren** zodra je die uitzet.

De gebeurtenistypen zijn `Incident`, `Announcement` en `Scheduled Event`.

De keuzes belanden op het abonneerecord als **Is Subscribed to All Resources** (`isSubscribedToAllResources`, standaard true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, standaard true), **Subscribed to Resources** en **Subscribed to Event Types**.

Handig voor: een pagina die meerdere producten dekt. Een klant die alleen je API gebruikt, zit niet te wachten op een melding elke keer dat de marketingsite hapert — laat hem de lijst zelf versmallen in plaats van toe te kijken hoe hij zich helemaal afmeldt.

Dezelfde kaart bevat ook **Tijdzones abonnee**.

## Dubbele opt-in bij e-mail

E-mailabonnees bevestigen altijd. Wordt er een abonnee met een e-mailadres aangemaakt die niet meteen al als bevestigd is aangemaakt, dan gaat **Is Subscription Confirmed** (`isSubscriptionConfirmed`) verplicht op `false` en wordt er een **Subscription Confirmation Token** van zes cijfers gegenereerd. OneUptime mailt vervolgens een bevestigingslink in de vorm `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. De bezoeker komt op een pagina **Abonnement bevestigen** terecht en ziet, zodra het gelukt is, *Abonnement succesvol bevestigd*.

Abonnees via SMS, Slack, Microsoft Teams en webhook slaan dit over — die worden aangemaakt met `isSubscriptionConfirmed` al op `true`.

**Niet bevestigd betekent stil.** De query die abonnees ophaalt voor een melding filtert op `isUnsubscribed: false` en `isSubscriptionConfirmed: true`. Een e-mailadres dat nooit op de link heeft geklikt, blijft in je lijst **E-mail-abonnees** staan en krijgt niets. Zweert iemand dat hij geabonneerd is maar hoort hij niets, kijk dan eerst naar die kolom.

Er is geen schakelaar om de e-mailbevestiging uit te zetten — voor iedereen die zich via de statuspagina aanmeldt, geldt hij onvoorwaardelijk. Een aparte kolom per abonnee, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, standaard true), bepaalt of de "je bent geabonneerd"-e-mail uitgaat zodra een abonnee bevestigd is.

## Een abonnement beheren en opzeggen

Elke e-mail aan een abonnee bevat een afmeldlink in de vorm `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Die pagina heet **Abonnement bijwerken** en vertelt de bezoeker dat hij daar zijn voorkeuren kan bijwerken of zich kan afmelden. Erop staan:

- De keuzelijsten voor resources en gebeurtenistypen die de pagina toestaat.
- Een schakelaar **Afmelden**, omschreven als afmelden van alle bronnen. Die schrijft **Is afgemeld** (`isUnsubscribed`, standaard false).
- Een verzendknop met de tekst **Abonnement bijwerken**; na opslaan verschijnt *Uw wijzigingen zijn opgeslagen.*

Wie de link kwijt is, gebruikt **Bestaand abonnement beheren** op de pagina **Abonneren** en klikt op **Beheerlink verzenden**. OneUptime meldt dan dat er een e-mail met de link onderweg is, en dat je de spammap moet controleren als hij niet aankomt.

De endpoints achter dit alles zijn `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` en `PUT .../update-subscription/:statusPageId/:subscriberId`.

Afmelden zet een vlag om in plaats van een rij te verwijderen, dus het record blijft in de kanaallijst staan met **Is afgemeld** aan — handig wanneer je later moet uitleggen waarom een bepaald adres geen mail meer kreeg.

## Waarover abonnees bericht krijgen

Abonnees horen over de drie gebeurtenistypen hierboven, maar elke bron heeft een eigen schakelaar, zodat er niets per ongeluk uitgaat.

### Meldingen bij aankondigingen

De aankondiging zelf draagt **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), op het aanmaakformulier zichtbaar als het vinkje **Statuspagina-abonnees op de hoogte stellen** en standaard aan. Noemt de aankondiging monitoren onder **Getroffen monitoren (optioneel)**, dan beperkt de melding zich tot die monitoren; laat je het leeg, dan krijgen alle abonnees bericht.

### Geplande onderhoudsgebeurtenissen

Een geplande onderhoudsgebeurtenis heeft een eigen set abonneekolommen: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, plus **Subscriber notifications before the event** en **Next subscriber notification before the event at?** voor waarschuwingen vooraf. **Statuspagina's** op de gebeurtenis bepaalt op welke pagina's ze verschijnt, en **Should be visible on status page?** bepaalt of ze überhaupt verschijnt.

### Incidenten

`Incident` is het derde gebeurtenistype. Wat een incident überhaupt op een statuspagina brengt — welke resources het raakt en welke statussen het zichtbaar houden — staat in [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

De sectie **Meldingslogboeken** in het zijmenu van de statuspagina (`{id}/notification-logs`) is de plek waar je kijkt wanneer je wilt zien wat de pagina daadwerkelijk heeft verstuurd.

## Meldingssjablonen aanpassen

De kaart **Meldingssjablonen** op **Abonneeinstellingen** toont de sjablonen die deze statuspagina gebruikt, met de kolommen **Sjabloonnaam**, **Gebeurtenistype** en **Meldingsmethode** — zo varieer je de formulering per gebeurtenistype en per kanaal, in plaats van één huisbericht voor alles te accepteren.

Projectbrede sjablonen staan een niveau hoger, bij **Statuspagina's → Instellingen → Abonnee-sjablonen**, naast **Aankondigings-sjablonen**.

## E-mailvoettekst, eigen SMTP en Twilio

Drie andere kaarten op **Abonneeinstellingen** bepalen hoe abonneeberichten je project verlaten:

- **Instellingen e-mailvoettekst** — met **Aangepaste e-mailvoettekst inschakelen** en **Voettekst e-mailmelding abonnee** zet je je eigen voettekst onder e-mails aan abonnees.
- **Aangepaste SMTP** — **Aangepaste SMTP-configuratie** stuurt abonnee-e-mail via je eigen mailserver in plaats van via de standaardserver.
- **Twilio-configuratie** — **Twilio-configuratie** is het Twilio-account dat voor SMS-abonnees wordt gebruikt.

Een eigen SMTP is het waard om vroeg te regelen als je e-mailabonnees hebt: mail die van je eigen domein komt, wordt veel minder snel weggefilterd en veel eerder vertrouwd door de klant die hem om 2 uur 's nachts leest.

## Aankondigingen

Een aankondiging is een record op projectniveau (het model `StatusPageAnnouncement`) dat je uitwaaiert naar een of meer statuspagina's, eventueel beperkt tot specifieke monitoren, met een venster waarin ze wordt getoond.

Je maakt er een aan via **Statuspagina's → Meer → Aankondigingen**, of via **Aankondigingen** in het zijmenu van een afzonderlijke statuspagina. Het aanmaakformulier is een wizard van vier stappen:

1. **Basisinformatie** — **Aankondigingstitel** (verplicht, minstens twee tekens), **Beschrijving** (Markdown, optioneel) en **Bijlagen** voor bestanden die bij de aankondiging op de statuspagina beschikbaar moeten zijn.
2. **Statuspagina's** — **Aankondiging weergeven op deze statuspagina's**, een verplichte meerkeuzelijst. Eén aankondiging kan meerdere pagina's tegelijk raken.
3. **Getroffen middelen** — **Getroffen monitoren (optioneel)**. Selecteer je er geen, dan krijgen alle abonnees bericht.
4. **Schema en instellingen** — **Aankondiging beginnen weer te geven om** (verplicht, standaard nu), **Stop met tonen aankondiging om** (optioneel) en **Statuspagina-abonnees op de hoogte stellen** (standaard aan).

Bezoekers lezen aankondigingen op `/announcements`, opgesplitst in **Actieve aankondigingen** en **Vorige aankondigingen**, elk met een stempel **Aangekondigd op**. Aankondigingen die nu live zijn, staan bovendien vastgezet boven aan de overzichtspagina. Is er niets te tonen, dan leest de pagina *Geen aankondigingen*, met de opmerking dat er tot nu toe niets is geplaatst.

Bijlagen worden geserveerd via `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, achter dezelfde leescontrole als de statuspagina zelf — een bijlage op een private pagina blijft dus privé.

## Hoe de planning van aankondigingen werkt

**Show At** (`showAnnouncementAt`) en **End At** (`endAnnouncementAt`) sturen alles aan, maar de overzichtspagina en de aankondigingenlijst stellen elk een andere vraag, en dat verschil laat mensen struikelen.

- **De overzichtspagina** toont een aankondiging wanneer `showAnnouncementAt` in het verleden ligt en `endAnnouncementAt` in de toekomst ligt of leeg is.
- **De lijst `/announcements`** toont aankondigingen waarvan `showAnnouncementAt` binnen **Aankondigingsgeschiedenis weergeven (in dagen)** (`showAnnouncementHistoryInDays`, standaard 14) valt, en splitst ze daarna aan de clientkant in actief en verlopen.

Twee gevolgen waarop je maar beter kunt anticiperen:

- **Een aankondiging zonder einddatum verloopt nooit.** Laat **Stop met tonen aankondiging om** leeg en ze blijft onbeperkt boven aan de overzichtspagina staan. Zet een einddatum op alles wat tijdgebonden is.
- **Een oude maar nog actieve aankondiging kan uit de lijst verdwijnen.** Is ze langer dan `showAnnouncementHistoryInDays` geleden begonnen, dan valt ze van `/announcements` af terwijl ze op het overzicht blijft staan. Verruim het geschiedenisvenster als je langlopende mededelingen gebruikt.

Of aankondigingen überhaupt verschijnen, bepaalt de kaart **Aankondigingsinstellingen** op **Geavanceerde instellingen**: **Aankondigingen weergeven** (`showAnnouncementsOnStatusPage`, standaard true) en **Aankondigingsgeschiedenis weergeven (in dagen)** (standaard 14). Staat **Aankondigingen weergeven** uit, dan weigert het endpoint voor aankondigingen het verzoek regelrecht.

## Aankondigingssjablonen

Plaats je steeds hetzelfde soort bericht — een maandelijkse onderhoudswaarschuwing, een terugkerende storing bij een derde partij — leg het dan van tevoren vast. **Statuspagina's → Instellingen → Aankondigings-sjablonen** bewaart het model `StatusPageAnnouncementTemplate`, en het formulier vraagt om **Sjabloonnaam**, **Sjabloonbeschrijving**, **Aankondigingstitel**, **Beschrijving**, **Aankondiging weergeven op deze statuspagina's**, **Getroffen monitoren (optioneel)** en **Abonnees op de hoogte stellen** — zo maak je de verspreiding en de meldkeuze één keer in plaats van elke keer opnieuw.

## Webhook-abonnees en SSRF-bescherming

Webhook-abonnees krijgen bij elke gebeurtenis op de statuspagina een JSON-`POST`-verzoek, waarmee ze de eenvoudigste manier zijn om statuspagina-updates naar een eigen systeem te sluizen — een chatbot, een intern dashboard, een ticketwachtrij.

Omdat abonneren een publieke handeling is op een publieke pagina, bewaakt OneUptime het doeladres:

- Een gewone **Webhook-URL** wordt gevalideerd voordat hij wordt geaccepteerd, en privé-, loopback-, link-local- en cloud-metadata-adressen worden geweigerd. Je kunt een abonnement dus niet richten op iets binnen het eigen netwerk van de OneUptime-installatie.
- Een **URL van inkomende Slack-webhook** moet beginnen met `https://hooks.slack.com/services/`.

Wordt een webhook-abonnement bij aanmelding geweigerd, kijk dan eerst of het adres intern of misvormd is.

## Waar je verder kunt lezen

- [Statuspagina's – Overzicht](/docs/status-pages/index) — wat een statuspagina is en hoe die is opgebouwd.
- [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups) — de monitoren en groepen waaruit abonnees kunnen kiezen.
- [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains) — eigen domeinen, logo's en de uitstraling van de pagina waarnaar je e-mails linken.
- [Publieke API](/docs/status-pages/public-api) — statuspaginagegevens programmatisch uitlezen.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities) — wat een incident op een statuspagina zet en wat het er weer af haalt.
- [Incidentinstellingen en automatisering](/docs/incidents/settings) — de projectbrede regels achter incidentcommunicatie.
