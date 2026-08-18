# Abonnenter og kunngjøringer

En statusside er et sted folk går til. Abonnenter er de som helst slipper å gjøre det — de gir deg en e-postadresse, et telefonnummer, en Slack-webhook eller et HTTP-endepunkt én gang, og deretter kommer oppdateringene dine til dem.

Kunngjøringer er den andre halvdelen av den samme jobben. En overvåking kan fortelle de besøkende at kassen returnerer 500-feil; ingen overvåking kan fortelle dem at dere migrerer databaser på lørdag, at en tredjepartsleverandør har en dårlig dag, eller at hendelsen de leste om i går er fullstendig avsluttet. Kunngjøringer er fritekstkanalen for alt sjekkene dine ikke kan se, og de går ut til den samme abonnentlisten.

Denne siden dekker begge deler: de fem abonnementskanalene og hvordan de besøkende melder seg på, hva abonnenter kan velge å høre om, flytene for dobbel bekreftelse og avmelding, og hvordan kunngjøringer skrives, planlegges og males.

## Abonnementskanaler

En statusside støtter fem kanaler, hver med sin egen bryter på statussiden. Gå til **Statussider → siden din → Abonnenter → Abonnentsinnstillinger**:

- **Aktiver e-postabonnenter** (`enableEmailSubscribers`) — på som standard. Alt annet er av til du slår det på.
- **Aktiver SMS-abonnenter** (`enableSmsSubscribers`) — av som standard.
- **Aktiver Slack-abonnenter** (`enableSlackSubscribers`) — av som standard.
- **Aktiver Microsoft Teams-abonnenter** (`enableMicrosoftTeamsSubscribers`) — av som standard.
- **Aktiver webhook-abonnenter** (`enableWebhookSubscribers`) — av som standard.

Hver kanal får også sin egen liste i statussidens sidemeny under **Abonnenter**: **E-postabonnenter**, **SMS-abonnenter**, **Slack-abonnenter**, **MS Teams-abonnenter** og **Webhook-abonnenter**. Det er der du ser på hvem som har meldt seg på, legger til noen for hånd, eller legger igjen en **Notater**-oppføring (`internalNote`) på en bestemt abonnent.

**Én bryter er ikke nok.** Elementet **Subscribe** i statussidens navigasjonslinje vises bare når **Vis abonnentside** (`showSubscriberPageOnStatusPage`) er på *og* minst én kanal er aktivert. Hvis du slår på **Aktiver e-postabonnenter** men lar **Vis abonnentside** stå av, har de besøkende ingen måte å nå skjemaet på.

De samme fem bryterne dukker opp en gang til inne i kortet **Abonnentsinnstillinger** på **Avanserte innstillinger**, ved siden av **Vis abonnentside**. De er de samme kolonnene under panseret — velg ett skjermbilde og hold deg til det, og foretrekk den dedikerte siden **Abonnentsinnstillinger** siden det er der resten av abonnentkonfigurasjonen bor.

## Hva en besøkende ser på Subscribe-siden

Siden **Subscribe** har en undermeny med én fane per aktivert kanal — **E-post**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — tilordnet `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` og `/subscribe/webhooks`. Hver fane spør om det minimale den trenger:

- **E-post** — overskrift **Subscribe by Email**, ett felt **Your Email** med plassholderen `subscriber@company.com`.
- **SMS** — overskrift **Subscribe by SMS**, ett felt **Your Phone Number** med plassholderen `+11234567890`.
- **Slack** — overskrift **Subscribe by Slack**, med **Navn på Slack-arbeidsområde** (brukt til validering) og **URL for innkommende webhook for Slack**, plassholder `https://hooks.slack.com/services/...`.
- **MS Teams** — overskrift **Subscribe by Microsoft Teams**, med **Navn på Microsoft Teams-arbeidsområde** og **URL for innkommende webhook for Microsoft Teams**, plassholder `https://outlook.office.com/webhook/...`.
- **Webhooks** — overskrift **Subscribe by Webhook**, ett felt **Webhook-URL**. En JSON-`POST`-forespørsel sendes til den ved hver statussidehendelse.

Send-knappen leser **Subscribe**, og en vellykket påmelding viser *You have been subscribed successfully.* Siden bærer også en todeling **New Subscription** / **Manage Existing Subscription**, så noen som allerede har abonnert kan komme tilbake til preferansene sine uten å lete etter en gammel e-post.

## Å la abonnenter velge ressurser og hendelsestyper

Som standard får en abonnent alt på siden. To brytere i kortet **Avanserte abonnentinnstillinger** endrer det:

- **Tillat abonnenter å velge ressurser** (`allowSubscribersToChooseResources`) — av som standard. Slå den på, så vokser abonnementsskjemaet med en bryter **Abonner på alle ressurser**; fjern den, så dukker **Velg ressurser å abonnere på** opp så den besøkende kan plukke enkeltressurser.
- **Tillat abonnenter å velge hendelsestyper** (`allowSubscribersToChooseEventTypes`) — av som standard. Samme form: en bryter **Abonner på alle hendelsestyper**, og **Velg hendelsestyper å abonnere på** under når den fjernes.

Hendelsestypene er `Incident`, `Announcement` og `Scheduled Event`.

Valgene havner på abonnentposten som **Is Subscribed to All Resources** (`isSubscribedToAllResources`, standard sann), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, standard sann), **Subscribed to Resources** og **Subscribed to Event Types**.

Bra for: en side som dekker flere produkter. En kunde som bare bruker API-et ditt, vil ikke ha en varsling hver gang markedsføringssiden vakler — la dem snevre inn listen selv heller enn å se på at de melder seg helt av.

Det samme kortet bærer også **Tidssoner for abonnenter**.

## Dobbel bekreftelse for e-post

E-postabonnenter bekrefter alltid. Når en abonnent opprettes med en e-postadresse og ikke ble opprettet som allerede bekreftet, tvinges **Is Subscription Confirmed** (`isSubscriptionConfirmed`) til `false` og et sekssifret **Subscription Confirmation Token** genereres. OneUptime sender så en bekreftelseslenke formet som `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. Den besøkende lander på en side **Confirm Subscription** og ser, når det går gjennom, *Subscription confirmed successfully*.

Abonnenter på SMS, Slack, Microsoft Teams og webhook hopper over dette — de opprettes med `isSubscriptionConfirmed` allerede satt til `true`.

**Ubekreftet betyr stille.** Spørringen som henter abonnenter for et varsel, filtrerer på `isUnsubscribed: false` og `isSubscriptionConfirmed: true`. En e-postadresse som aldri klikket på lenken, blir liggende i listen **E-postabonnenter** og mottar ingenting. Hvis noen sverger på at de abonnerer men ikke hører noe, sjekk den kolonnen først.

Det finnes ingen bryter for å slå av e-postbekreftelse — den er ubetinget for alle som melder seg på gjennom statussiden. En separat kolonne per abonnent, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, standard sann), styrer «du har abonnert»-e-posten som går ut når en abonnent først er bekreftet.

## Å administrere og avslutte et abonnement

Hver abonnent-e-post bærer en avmeldingslenke på formen `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Den siden har tittelen **Update Subscription** og forteller den besøkende at de kan oppdatere preferansene sine eller melde seg av der. Den rommer:

- Hvilke ressurs- og hendelsestypevelgere siden nå enn tillater.
- En bryter **Avslutt abonnement**, beskrevet som å melde seg av alle ressurser. Den skriver **Er avmeldt** (`isUnsubscribed`, standard usann).
- En send-knapp som leser **Update Subscription**; å lagre viser *Your changes have been saved.*

Noen som mistet lenken, bruker **Manage Existing Subscription** på siden **Subscribe** og trykker **Send Management Link**. OneUptime svarer at en e-post med lenken er sendt, og at man skal sjekke søppelpostmappen hvis den ikke kommer.

Endepunktene bak alt dette er `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` og `PUT .../update-subscription/:statusPageId/:subscriberId`.

Å melde seg av vipper et flagg i stedet for å slette en rad, så posten blir værende i kanallisten med **Er avmeldt** satt — nyttig når du senere må forklare hvorfor en bestemt adresse sluttet å motta e-post.

## Hva abonnenter blir varslet om

Abonnenter hører om de tre hendelsestypene over, men hver kilde har sin egen bryter, så ingenting sendes ved et uhell.

### Kunngjøringsvarsler

Selve kunngjøringen bærer **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), eksponert i opprettelsesskjemaet som avkrysningsboksen **Varsle statussideabonnenter** og på som standard. Hvis kunngjøringen navngir overvåkinger under **Berørte overvåkinger (valgfritt)**, avgrenses varselet til de overvåkingene; la det stå tomt, så varsles alle abonnenter.

### Planlagte vedlikeholdshendelser

En planlagt vedlikeholdshendelse har sitt eget sett med abonnentkolonner: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, pluss **Subscriber notifications before the event** og **Next subscriber notification before the event at?** for varsler på forhånd. **Statussider** på hendelsen avgjør hvilke sider den vises på, og **Should be visible on status page?** avgjør om den vises i det hele tatt.

### Hendelser

`Incident` er den tredje hendelsestypen. Hva som får en hendelse til å nå en statusside i utgangspunktet — hvilke ressurser den berører og hvilke tilstander som holder den synlig — dekkes i [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

Seksjonen **Varsellogger** i statussidens sidemeny (`{id}/notification-logs`) er dit du går når du trenger å se hva siden faktisk sendte.

## Å tilpasse varselmaler

Kortet **Varselmaler** på **Abonnentsinnstillinger** lister malene denne statussiden bruker, med kolonnene **Malnavn**, **Hendelsestype** og **Varselmetode** — så du kan variere ordlyden per hendelsestype og per kanal heller enn å godta én husmelding for alt.

Maler for hele prosjektet bor ett nivå opp, på **Statussider → Innstillinger → Abonnentmaler**, ved siden av **Kunngjøringsmaler**.

## E-postbunntekst, egendefinert SMTP og Twilio

Tre kort til på **Abonnentsinnstillinger** styrer hvordan abonnentmeldinger forlater prosjektet ditt:

- **Innstillinger for e-postbunntekst** — **Aktiver egendefinert e-postbunntekst** og **Bunntekst for e-postvarsel til abonnenter** setter din egen bunntekst på abonnent-e-poster.
- **Egendefinert SMTP** — **Egendefinert SMTP-konfigurasjon** sender abonnent-e-post gjennom din egen e-postserver i stedet for standarden.
- **Twilio-konfigurasjon** — **Twilio-konfigurasjon** er Twilio-kontoen som brukes for SMS-abonnenter.

Egendefinert SMTP er verdt å gjøre tidlig hvis du har e-postabonnenter: e-post som kommer fra ditt eget domene er langt mindre sannsynlig å bli filtrert, og langt mer sannsynlig å bli stolt på av kunden som leser den klokken to om natten.

## Kunngjøringer

En kunngjøring er en post på prosjektnivå (modellen `StatusPageAnnouncement`) som du sprer til én eller flere statussider, eventuelt avgrenset til bestemte overvåkinger, med et vindu den vises i.

Du oppretter én fra **Statussider → Mer → Kunngjøringer**, eller fra **Kunngjøringer** i sidemenyen til en enkelt statusside. Opprettelsesskjemaet er en fire-trinns veiviser:

1. **Grunnleggende informasjon** — **Kunngjøringstittel** (obligatorisk, minst to tegn), **Beskrivelse** (Markdown, valgfri) og **Vedlegg** for filer som skal være tilgjengelige sammen med kunngjøringen på statussiden.
2. **Statussider** — **Vis kunngjøring på disse statussidene**, et obligatorisk flervalg. Én kunngjøring kan rettes mot flere sider om gangen.
3. **Berørte ressurser** — **Berørte overvåkinger (valgfritt)**. Hvis du ikke velger noen, varsles alle abonnenter.
4. **Tidsplan og innstillinger** — **Begynn å vise kunngjøring fra** (obligatorisk, med nå som standard), **Slutt å vise kunngjøring kl.** (valgfri) og **Varsle statussideabonnenter** (på som standard).

De besøkende leser kunngjøringer på `/announcements`, delt i **Active Announcements** og **Past Announcements**, hver stemplet med **Announced at**. Kunngjøringer som er aktive akkurat nå, festes også øverst på oversiktssiden. Når det ikke er noe å vise, leser siden *No Announcement* med notisen om at ingen har blitt lagt ut så langt.

Vedlegg serveres fra `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, bak den samme lesesjekken som statussiden selv — så et vedlegg på en privat side forblir privat.

## Hvordan planlegging av kunngjøringer fungerer

**Show At** (`showAnnouncementAt`) og **End At** (`endAnnouncementAt`) driver alt, men oversiktssiden og kunngjøringslisten stiller forskjellige spørsmål, og forskjellen feller folk.

- **Oversiktssiden** viser en kunngjøring når `showAnnouncementAt` er i fortiden og `endAnnouncementAt` enten er i fremtiden eller tom.
- **Listen `/announcements`** viser kunngjøringer hvis `showAnnouncementAt` faller innenfor **Vis kunngjøringshistorikk (i dager)** (`showAnnouncementHistoryInDays`, standard 14), og deler dem så på klientsiden i aktive og tidligere.

To konsekvenser det er verdt å planlegge rundt:

- **En kunngjøring uten sluttdato utløper aldri.** La **Slutt å vise kunngjøring kl.** stå tom, så blir den festet til oversiktssiden på ubestemt tid. Sett en sluttdato på alt som er tidsbegrenset.
- **En gammel, men fortsatt aktiv kunngjøring kan forsvinne fra listen.** Hvis den startet for mer enn `showAnnouncementHistoryInDays` siden, faller den ut av `/announcements` mens den blir værende på oversikten. Øk historikkvinduet hvis du har langvarige notiser.

Om kunngjøringer vises i det hele tatt, styres av kortet **Kunngjøringsinnstillinger** på **Avanserte innstillinger**: **Vis kunngjøringer** (`showAnnouncementsOnStatusPage`, standard sann) og **Vis kunngjøringshistorikk (i dager)** (standard 14). Med **Vis kunngjøringer** av avviser kunngjøringsendepunktet forespørselen fullstendig.

## Kunngjøringsmaler

Hvis du legger ut den samme typen notis gjentatte ganger — et månedlig vedlikeholdsvarsel, en tilbakevendende tredjepartsforringelse — lag den ferdig på forhånd. **Statussider → Innstillinger → Kunngjøringsmaler** lagrer modellen `StatusPageAnnouncementTemplate`, og skjemaet spør om **Malnavn**, **Malbeskrivelse**, **Kunngjøringstittel**, **Beskrivelse**, **Vis kunngjøring på disse statussidene**, **Berørte overvåkinger (valgfritt)** og **Varsle abonnenter**, så spredningen og varslingsbeslutningen tas én gang i stedet for hver gang.

## Webhook-abonnenter og SSRF-beskyttelse

Webhook-abonnenter mottar en JSON-`POST`-forespørsel ved hver statussidehendelse, noe som gjør dem til den enkleste måten å pipe statussideoppdateringer inn i et system du eier — en chatbot, et internt dashbord, en sakskø.

Fordi det å abonnere er en offentlig operasjon på en offentlig side, vokter OneUptime målet:

- En generisk **Webhook-URL** valideres før den godtas, og private adresser, loopback-adresser, link-local-adresser og skymetadata-adresser avvises. Du kan ikke peke et abonnement mot noe inne i OneUptime-oppsettets eget nettverk.
- En **URL for innkommende webhook for Slack** må begynne med `https://hooks.slack.com/services/`.

Hvis et webhook-abonnement avvises ved påmelding, er en intern eller feilformet URL det første du bør sjekke.

## Hvor du leser videre

- [Statussider – Oversikt](/docs/status-pages/index) — hva en statusside er og hvordan den er satt sammen.
- [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups) — overvåkingene og gruppene abonnenter kan velge mellom.
- [Statusside – merkevare og domener](/docs/status-pages/branding-and-domains) — egendefinerte domener, logoer og utseendet på siden e-postene dine lenker til.
- [Offentlig API](/docs/status-pages/public-api) — å lese statussidedata programmatisk.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — hva som setter en hendelse på en statusside og hva som tar den av.
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings) — reglene på prosjektnivå bak hendelseskommunikasjon.
