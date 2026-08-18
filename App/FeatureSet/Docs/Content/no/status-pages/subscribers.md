# Abonnenter og kunngjøringer

En statusside er et sted folk må oppsøke. Abonnentene er de som helst slipper — de gir deg en e-postadresse, et telefonnummer, en Slack-webhook eller et HTTP-endepunkt én gang, og etter det kommer oppdateringene dine til dem.

Kunngjøringer er den andre halvdelen av den samme jobben. En overvåking kan fortelle de besøkende at kassen svarer med 500-feil; ingen overvåking kan fortelle dem at du migrerer databaser på lørdag, at en tredjepartsleverandør har en dårlig dag, eller at hendelsen de leste om i går er ferdig lukket. Kunngjøringer er fritekstkanalen for alt sjekkene dine ikke ser, og de går ut til den samme abonnentlisten.

Denne siden dekker begge deler: de fem abonnementskanalene og hvordan besøkende melder seg på, hva abonnenter kan velge å høre om, flytene for bekreftelse og avmelding, og hvordan kunngjøringer skrives, planlegges og males.

## Abonnementskanaler

En statusside støtter fem kanaler, hver med sin egen bryter på statussiden. Gå til **Statussider → siden din → Abonnenter → Abonnentsinnstillinger**:

- **Aktiver e-postabonnenter** (`enableEmailSubscribers`) — på som standard. Alt annet er av til du slår det på.
- **Aktiver SMS-abonnenter** (`enableSmsSubscribers`) — av som standard.
- **Aktiver Slack-abonnenter** (`enableSlackSubscribers`) — av som standard.
- **Aktiver Microsoft Teams-abonnenter** (`enableMicrosoftTeamsSubscribers`) — av som standard.
- **Aktiver webhook-abonnenter** (`enableWebhookSubscribers`) — av som standard.

Hver kanal får også sin egen liste i sidemenyen på statussiden under **Abonnenter**: **E-postabonnenter**, **SMS-abonnenter**, **Slack-abonnenter**, **MS Teams-abonnenter** og **Webhook-abonnenter**. Det er der du ser hvem som har meldt seg på, legger til noen manuelt, eller legger igjen en **Notater**-oppføring (`internalNote`) på en bestemt abonnent.

**Én bryter er ikke nok.** Punktet **Abonner** i navigasjonslinjen på statussiden dukker bare opp når **Vis abonnentside** (`showSubscriberPageOnStatusPage`) er på *og* minst én kanal er aktivert. Slår du på **Aktiver e-postabonnenter**, men lar **Vis abonnentside** stå av, har de besøkende ingen vei fram til skjemaet.

De samme fem bryterne dukker opp en gang til i kortet **Abonnentsinnstillinger** på **Avanserte innstillinger**, ved siden av **Vis abonnentside**. Det er de samme kolonnene under panseret — velg ett skjermbilde og hold deg der, og bruk helst den egne siden **Abonnentsinnstillinger**, siden det er der resten av abonnentoppsettet ligger.

## Hva en besøkende ser på abonnementssiden

Siden **Abonner** har en undermeny med én fane per aktivert kanal — **E-post**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — knyttet til `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` og `/subscribe/webhooks`. Hver fane spør om det minste den trenger:

- **E-post** — overskriften **Abonner via e-post**, ett felt **Din e-post** med plassholderen `subscriber@company.com`.
- **SMS** — overskriften **Abonner via SMS**, ett felt **Ditt telefonnummer** med plassholderen `+11234567890`.
- **Slack** — overskriften **Abonner via Slack**, med **Navn på Slack-arbeidsområde** (brukes til validering) og **URL for innkommende webhook for Slack**, plassholder `https://hooks.slack.com/services/...`.
- **MS Teams** — overskriften **Abonner via Microsoft Teams**, med **Navn på Microsoft Teams-arbeidsområde** og **URL for innkommende webhook for Microsoft Teams**, plassholder `https://outlook.office.com/webhook/...`.
- **Webhooks** — overskriften **Abonner via webhook**, ett felt **Webhook-URL**. En JSON-`POST`-forespørsel sendes dit ved hver hendelse på statussiden.

Send-knappen heter **Abonner**, og en vellykket påmelding viser *Du er abonnert.* Siden har også en todeling mellom **Nytt abonnement** og **Administrer eksisterende abonnement**, slik at noen som allerede abonnerer, finner tilbake til innstillingene sine uten å lete etter en gammel e-post.

## La abonnentene velge ressurser og hendelsestyper

Som standard får en abonnent alt på siden. To brytere i kortet **Avanserte abonnentinnstillinger** endrer det:

- **Tillat abonnenter å velge ressurser** (`allowSubscribersToChooseResources`) — av som standard. Slår du den på, får abonnementsskjemaet en bryter for **Abonner på alle ressurser**; skru den av, og **Velg ressurser å abonnere på** dukker opp så den besøkende kan plukke enkeltressurser.
- **Tillat abonnenter å velge hendelsestyper** (`allowSubscribersToChooseEventTypes`) — av som standard. Samme form: en bryter for **Abonner på alle hendelsestyper**, og **Velg hendelsestyper å abonnere på** under når den skrus av.

Hendelsestypene er `Incident`, `Announcement` og `Scheduled Event`.

Valgene havner på abonnentoppføringen som **Is Subscribed to All Resources** (`isSubscribedToAllResources`, standard true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, standard true), **Subscribed to Resources** og **Subscribed to Event Types**.

Bra for: en side som dekker flere produkter. En kunde som bare bruker API-et ditt, vil ikke ha en melding hver gang markedsføringssiden vakler — la dem heller snevre inn listen selv enn å se på at de melder seg av alt.

Det samme kortet bærer også **Tidssoner for abonnenter**.

## Dobbel bekreftelse på e-post

E-postabonnenter bekrefter alltid. Når en abonnent opprettes med en e-postadresse og ikke ble opprettet ferdig bekreftet, tvinges **Is Subscription Confirmed** (`isSubscriptionConfirmed`) til `false`, og et sekssifret **Subscription Confirmation Token** genereres. OneUptime sender så en bekreftelseslenke på formen `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. Den besøkende havner på en **Bekreft abonnement**-side og ser *Abonnement bekreftet* når det går gjennom.

Abonnenter på SMS, Slack, Microsoft Teams og webhook hopper over dette — de opprettes med `isSubscriptionConfirmed` allerede satt til `true`.

**Ubekreftet betyr taus.** Spørringen som henter abonnenter til et varsel, filtrerer på `isUnsubscribed: false` og `isSubscriptionConfirmed: true`. En e-postadresse som aldri klikket på lenken, blir liggende i listen **E-postabonnenter** og mottar ingenting. Sverger noen på at de abonnerer, men aldri hører noe, er det den kolonnen du sjekker først.

Det finnes ingen bryter for å slå av e-postbekreftelsen — den gjelder ubetinget for alle som melder seg på via statussiden. En egen kolonne per abonnent, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, standard true), styrer «du abonnerer nå»-e-posten som går ut idet en abonnent er bekreftet.

## Å administrere og avslutte et abonnement

Hver e-post til abonnenter bærer en avmeldingslenke på formen `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Den siden heter **Oppdater abonnement** og forteller den besøkende at innstillingene kan endres eller abonnementet avsluttes der. Den inneholder:

- De velgerne for ressurser og hendelsestyper som siden tillater.
- En bryter for **Avslutt abonnement**, beskrevet som å melde seg av alle ressurser. Den skriver **Er avmeldt** (`isUnsubscribed`, standard false).
- En send-knapp merket **Oppdater abonnement**; lagring viser *Endringene dine er lagret.*

Den som har mistet lenken, bruker **Administrer eksisterende abonnement** på siden **Abonner** og trykker **Send administrasjonslenke**. OneUptime svarer at en e-post med lenken er sendt, og at man bør sjekke søppelpostmappen hvis den ikke dukker opp.

Endepunktene bak alt dette er `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` og `PUT .../update-subscription/:statusPageId/:subscriberId`.

Avmelding vender et flagg i stedet for å slette en rad, så oppføringen blir stående i kanallisten med **Er avmeldt** satt — nyttig når du senere må forklare hvorfor en bestemt adresse sluttet å motta e-post.

## Hva abonnentene blir varslet om

Abonnentene hører om de tre hendelsestypene over, men hver kilde har sin egen bryter, så ingenting sendes ved et uhell.

### Varsler om kunngjøringer

Selve kunngjøringen bærer **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), som i opprettelsesskjemaet vises som avkrysningsboksen **Varsle statussideabonnenter** og står på som standard. Navngir kunngjøringen overvåkinger under **Berørte overvåkinger (valgfritt)**, avgrenses varselet til de overvåkingene; la feltet stå tomt, så varsles alle abonnenter.

### Planlagte vedlikeholdshendelser

En planlagt vedlikeholdshendelse har sitt eget sett med abonnentkolonner: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, pluss **Subscriber notifications before the event** og **Next subscriber notification before the event at?** for forhåndsvarsler. **Statussider** på hendelsen avgjør hvilke sider den vises på, og **Should be visible on status page?** avgjør om den vises i det hele tatt.

### Hendelser

`Incident` er den tredje hendelsestypen. Hva som gjør at en hendelse i det hele tatt når fram til en statusside — hvilke ressurser den berører og hvilke tilstander som holder den synlig — dekkes i [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

Seksjonen **Varsellogger** i sidemenyen på statussiden (`{id}/notification-logs`) er der du går når du trenger å se hva siden faktisk sendte.

## Å tilpasse varselmaler

Kortet **Varselmaler** på **Abonnentsinnstillinger** lister opp malene denne statussiden bruker, med kolonnene **Malnavn**, **Hendelsestype** og **Varselmetode** — så du kan variere ordlyden per hendelsestype og per kanal i stedet for å godta én husmelding for alt.

Maler for hele prosjektet ligger ett nivå opp, under **Statussider → Innstillinger → Abonnentmaler**, ved siden av **Kunngjøringsmaler**.

## E-postbunntekst, egendefinert SMTP og Twilio

Tre kort til på **Abonnentsinnstillinger** styrer hvordan meldinger til abonnenter forlater prosjektet ditt:

- **Innstillinger for e-postbunntekst** — **Aktiver egendefinert e-postbunntekst** og **Bunntekst for e-postvarsel til abonnenter** setter din egen bunntekst på e-post til abonnenter.
- **Egendefinert SMTP** — **Egendefinert SMTP-konfigurasjon** sender abonnent-e-post gjennom din egen e-postserver i stedet for standarden.
- **Twilio-konfigurasjon** — **Twilio-konfigurasjon** er Twilio-kontoen som brukes for SMS-abonnenter.

Egendefinert SMTP er verdt å gjøre tidlig hvis du har e-postabonnenter: e-post som kommer fra ditt eget domene, blir langt sjeldnere filtrert bort, og er langt lettere å stole på for kunden som leser den klokken to om natten.

## Kunngjøringer

En kunngjøring er en oppføring på prosjektnivå (modellen `StatusPageAnnouncement`) som du sprer til én eller flere statussider, eventuelt avgrenset til bestemte overvåkinger, med et vindu den vises i.

Du oppretter en fra **Statussider → Mer → Kunngjøringer**, eller fra **Kunngjøringer** i sidemenyen til en enkelt statusside. Opprettelsesskjemaet er en veiviser i fire trinn:

1. **Grunnleggende informasjon** — **Kunngjøringstittel** (påkrevd, minst to tegn), **Beskrivelse** (Markdown, valgfritt) og **Vedlegg** for filer som skal være tilgjengelige sammen med kunngjøringen på statussiden.
2. **Statussider** — **Vis kunngjøring på disse statussidene**, et påkrevd flervalg. Én kunngjøring kan treffe flere sider samtidig.
3. **Berørte ressurser** — **Berørte overvåkinger (valgfritt)**. Velger du ingen, varsles alle abonnenter.
4. **Tidsplan og innstillinger** — **Begynn å vise kunngjøring fra** (påkrevd, standard nå), **Slutt å vise kunngjøring kl.** (valgfritt) og **Varsle statussideabonnenter** (på som standard).

Besøkende leser kunngjøringer på `/announcements`, delt i **Aktive kunngjøringer** og **Tidligere kunngjøringer**, hver stemplet med **Kunngjort den**. Kunngjøringer som er aktive akkurat nå, festes i tillegg øverst på oversiktssiden. Når det ikke er noe å vise, står det *Ingen kunngjøringer* på siden, med merknaden om at ingen er publisert så langt.

Vedlegg serveres fra `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, bak den samme lesesjekken som statussiden selv — så et vedlegg på en privat side forblir privat.

## Slik fungerer planlegging av kunngjøringer

**Show At** (`showAnnouncementAt`) og **End At** (`endAnnouncementAt`) styrer alt, men oversiktssiden og kunngjøringslisten stiller hvert sitt spørsmål, og forskjellen feller folk.

- **Oversiktssiden** viser en kunngjøring når `showAnnouncementAt` ligger i fortiden og `endAnnouncementAt` enten ligger i framtiden eller er tom.
- **Listen `/announcements`** viser kunngjøringer der `showAnnouncementAt` faller innenfor **Vis kunngjøringshistorikk (i dager)** (`showAnnouncementHistoryInDays`, standard 14), og deler dem så i aktive og tidligere på klientsiden.

To konsekvenser det er verdt å planlegge rundt:

- **En kunngjøring uten sluttdato utløper aldri.** Lar du **Slutt å vise kunngjøring kl.** stå tom, blir den værende festet til oversiktssiden på ubestemt tid. Sett en sluttdato på alt som er tidsbegrenset.
- **En gammel, men fortsatt aktiv kunngjøring kan forsvinne fra listen.** Startet den for mer enn `showAnnouncementHistoryInDays` siden, faller den ut av `/announcements` samtidig som den blir stående på oversikten. Øk historikkvinduet hvis du har varsler som løper lenge.

Om kunngjøringer vises i det hele tatt, styres av kortet **Kunngjøringsinnstillinger** på **Avanserte innstillinger**: **Vis kunngjøringer** (`showAnnouncementsOnStatusPage`, standard true) og **Vis kunngjøringshistorikk (i dager)** (standard 14). Med **Vis kunngjøringer** av avviser kunngjøringsendepunktet forespørselen på flekken.

## Kunngjøringsmaler

Publiserer du den samme typen melding gang på gang — et månedlig vedlikeholdsvarsel, en tilbakevendende tredjepartsdegradering — så lag den ferdig på forhånd. **Statussider → Innstillinger → Kunngjøringsmaler** lagrer modellen `StatusPageAnnouncementTemplate`, og skjemaet der spør etter **Malnavn**, **Malbeskrivelse**, **Kunngjøringstittel**, **Beskrivelse**, **Vis kunngjøring på disse statussidene**, **Berørte overvåkinger (valgfritt)** og **Varsle abonnenter**, slik at spredningen og varslingsvalget gjøres én gang i stedet for hver gang.

## Webhook-abonnenter og SSRF-beskyttelse

Webhook-abonnenter mottar en JSON-`POST`-forespørsel ved hver hendelse på statussiden, og det gjør dem til den enkleste måten å føre statussideoppdateringer inn i et system du eier selv — en chatbot, et internt dashbord, en sakskø.

Fordi det å abonnere er en offentlig handling på en offentlig side, vokter OneUptime målet:

- En vanlig **Webhook-URL** valideres før den godtas, og private adresser, loopback, link-local og skymetadata-adresser avvises. Du kan ikke peke et abonnement mot noe inne i OneUptime-installasjonens eget nettverk.
- En **URL for innkommende webhook for Slack** må begynne med `https://hooks.slack.com/services/`.

Blir et webhook-abonnement avvist ved påmelding, er en intern eller feilformet URL det første du bør se på.

## Hvor du leser videre

- [Statussider – Oversikt](/docs/status-pages/index) — hva en statusside er og hvordan den er satt sammen.
- [Statusside – ressurser og grupper](/docs/status-pages/resources-and-groups) — overvåkingene og gruppene abonnentene kan velge mellom.
- [Statusside – merkevare og domener](/docs/status-pages/branding-and-domains) — egendefinerte domener, logoer og utseendet på siden e-postene dine lenker til.
- [Offentlig API](/docs/status-pages/public-api) — å lese statussidedata programmatisk.
- [Hendelsestilstander og alvorlighetsgrader](/docs/incidents/states-and-severities) — hva som setter en hendelse på en statusside og hva som tar den av igjen.
- [Hendelsesinnstillinger og automatisering](/docs/incidents/settings) — reglene på prosjektnivå bak hendelseskommunikasjon.
