# Abonnenter og meddelelser

En statusside er et sted, folk går hen. Abonnenter er de mennesker, der helst vil slippe for det — de giver dig en e-mailadresse, et telefonnummer, en Slack-webhook eller et HTTP-endpoint én gang, og derefter kommer dine opdateringer til dem.

Meddelelser er den anden halvdel af det samme job. En monitor kan fortælle dine besøgende, at kassen returnerer 500'ere; ingen monitor kan fortælle dem, at I migrerer databaser på lørdag, at en tredjepartsudbyder har en dårlig dag, eller at den hændelse, de læste om i går, er helt lukket. Meddelelser er fritekstkanalen til alt det, dine tjek ikke kan se, og de spredes ud til den samme abonnentliste.

Denne side dækker begge dele: de fem abonnementskanaler og hvordan besøgende tilmelder sig, hvad abonnenter kan vælge at høre om, dobbelt opt-in- og afmeldingsflowene, og hvordan meddelelser skrives, planlægges og skabeloniseres.

## Abonnementskanaler

En statusside understøtter fem kanaler, hver med sin egen kontakt på statussiden. Gå til **Statussider → din side → Abonnenter → Abonnementsindstillinger**:

- **Aktivér e-mailabonnenter** (`enableEmailSubscribers`) — slået til som standard. Alt andet er slået fra, indtil du slår det til.
- **Aktivér SMS-abonnenter** (`enableSmsSubscribers`) — slået fra som standard.
- **Aktivér Slack-abonnenter** (`enableSlackSubscribers`) — slået fra som standard.
- **Aktivér Microsoft Teams-abonnenter** (`enableMicrosoftTeamsSubscribers`) — slået fra som standard.
- **Aktivér webhook-abonnenter** (`enableWebhookSubscribers`) — slået fra som standard.

Hver kanal får også sin egen liste i statussidens sidemenu under **Abonnenter**: **E-mail-abonnenter**, **SMS-abonnenter**, **Slack-abonnenter**, **MS Teams-abonnenter** og **Webhook-abonnenter**. Det er dér, du kigger på, hvem der er tilmeldt, tilføjer nogen i hånden, eller efterlader dig selv et **Noter**-punkt (`internalNote`) på en bestemt abonnent.

**Én kontakt er ikke nok.** Punktet **Subscribe** i statussidens navigationslinje vises kun, når **Vis abonnentside** (`showSubscriberPageOnStatusPage`) er slået til *og* mindst én kanal er aktiveret. Hvis du slår **Aktivér e-mailabonnenter** til, men lader **Vis abonnentside** være slået fra, har besøgende ingen måde at nå formularen på.

De samme fem kontakter optræder en ekstra gang inde i kortet **Abonnementsindstillinger** på **Avancerede indstillinger**, sammen med **Vis abonnentside**. Det er de samme kolonner underneden — vælg én skærm og bliv på den, og foretræk den dedikerede side **Abonnementsindstillinger**, da det er dér, resten af abonnentkonfigurationen bor.

## Hvad en besøgende ser på abonnementssiden

Siden **Subscribe** har en undermenu med én fane per aktiveret kanal — **E-mail**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — knyttet til `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` og `/subscribe/webhooks`. Hver fane beder om det minimum, den har brug for:

- **E-mail** — overskrift **Subscribe by Email**, ét felt **Your Email** med pladsholderen `subscriber@company.com`.
- **SMS** — overskrift **Subscribe by SMS**, ét felt **Your Phone Number** med pladsholderen `+11234567890`.
- **Slack** — overskrift **Subscribe by Slack**, med **Slack-arbejdsområdets navn** (bruges til validering) og **URL til indgående webhook for Slack**, pladsholder `https://hooks.slack.com/services/...`.
- **MS Teams** — overskrift **Subscribe by Microsoft Teams**, med **Microsoft Teams-arbejdsområdets navn** og **URL til indgående webhook for Microsoft Teams**, pladsholder `https://outlook.office.com/webhook/...`.
- **Webhooks** — overskrift **Subscribe by Webhook**, ét felt **Webhook-URL**. En JSON-`POST`-anmodning sendes til den ved hver statusside-begivenhed.

Indsend-knappen hedder **Subscribe**, og en vellykket tilmelding viser *You have been subscribed successfully.* Siden bærer også en opdeling i **New Subscription** / **Manage Existing Subscription**, så en, der allerede har abonneret, kan komme tilbage til sine præferencer uden at lede efter en gammel e-mail.

## At lade abonnenter vælge ressourcer og hændelsestyper

Som standard får en abonnent alt på siden. To kontakter i kortet **Avancerede abonnentindstillinger** ændrer det:

- **Tillad abonnenter at vælge ressourcer** (`allowSubscribersToChooseResources`) — slået fra som standard. Slå den til, og abonnementsformularen får en kontakt **Abonner på alle ressourcer**; ryd den, og **Vælg ressourcer at abonnere på** dukker op, så den besøgende kan vælge enkelte ressourcer.
- **Tillad abonnenter at vælge begivenhedstyper** (`allowSubscribersToChooseEventTypes`) — slået fra som standard. Samme form: en kontakt **Abonner på alle hændelsestyper**, og **Vælg hændelsestyper at abonnere på** nedenunder, når den ryddes.

Hændelsestyperne er `Incident`, `Announcement` og `Scheduled Event`.

Valgene lander på abonnentens registrering som **Is Subscribed to All Resources** (`isSubscribedToAllResources`, standard sand), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, standard sand), **Subscribed to Resources** og **Subscribed to Event Types**.

Godt til: en side, der dækker flere produkter. En kunde, der kun bruger dit API, vil ikke tilkaldes, hver gang marketingwebstedet vakler — lad dem selv indsnævre listen frem for at se dem afmelde sig helt.

Det samme kort bærer også **Tidszoner for abonnenter**.

## Dobbelt opt-in for e-mail

E-mailabonnenter bekræfter altid. Når en abonnent oprettes med en e-mailadresse og ikke blev oprettet som allerede bekræftet, tvinges **Is Subscription Confirmed** (`isSubscriptionConfirmed`) til `false`, og en sekscifret **Subscription Confirmation Token** genereres. OneUptime sender derefter en bekræftelseslink-e-mail i formen `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. Den besøgende lander på en side **Confirm Subscription** og ser, når det er gået igennem, *Subscription confirmed successfully*.

Abonnenter via SMS, Slack, Microsoft Teams og webhook springer dette over — de oprettes med `isSubscriptionConfirmed` allerede sat til `true`.

**Ubekræftet betyder tavs.** Forespørgslen, der henter abonnenter til en notifikation, filtrerer på `isUnsubscribed: false` og `isSubscriptionConfirmed: true`. En e-mailadresse, der aldrig klikkede på linket, vil ligge i din liste over **E-mail-abonnenter** og modtage ingenting. Hvis nogen sværger på, at de abonnerer, men intet hører, så tjek den kolonne først.

Der er ingen kontakt til at slå e-mailbekræftelse fra — den er ubetinget for alle, der tilmelder sig gennem statussiden. En separat kolonne per abonnent, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, standard sand), styrer den "du har abonneret"-e-mail, der går ud, når først en abonnent er bekræftet.

## At administrere og opsige et abonnement

Hver abonnent-e-mail bærer et afmeldingslink i formen `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Den side hedder **Update Subscription** og fortæller den besøgende, at de kan opdatere deres præferencer eller afmelde sig dér. Den rummer:

- De ressource- og hændelsestypevælgere, siden nu tillader.
- En kontakt **Afmeld**, beskrevet som at afmelde sig fra alle ressourcer. Den skriver **Er afmeldt** (`isUnsubscribed`, standard falsk).
- En indsend-knap, der hedder **Update Subscription**; at gemme viser *Your changes have been saved.*

En, der har mistet linket, bruger **Manage Existing Subscription** på siden **Subscribe** og trykker **Send Management Link**. OneUptime svarer, at en e-mail med linket er sendt, og at man skal tjekke spam-mappen, hvis den ikke kommer frem.

Endpointene bag alt dette er `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` og `PUT .../update-subscription/:statusPageId/:subscriberId`.

At afmelde sig vender et flag frem for at slette en række, så registreringen bliver i kanallisten med **Er afmeldt** sat — nyttigt når du senere skal forklare, hvorfor en bestemt adresse holdt op med at modtage post.

## Hvad abonnenter får besked om

Abonnenter hører om de tre hændelsestyper ovenfor, men hver kilde har sin egen kontakt, så intet sendes ved et uheld.

### Notifikationer om meddelelser

Selve meddelelsen bærer **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), eksponeret på oprettelsesformularen som afkrydsningsfeltet **Underret statussideabonnenter** og slået til som standard. Hvis meddelelsen nævner monitorer under **Berørte overvågninger (valgfrit)**, afgrænses notifikationen til de monitorer; lad det stå tomt, og alle abonnenter får besked.

### Planlagte vedligeholdelsesbegivenheder

En planlagt vedligeholdelsesbegivenhed har sit eget sæt abonnentkolonner: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, plus **Subscriber notifications before the event** og **Next subscriber notification before the event at?** til varsler i forvejen. **Statussider** på begivenheden bestemmer, hvilke sider den vises på, og **Should be visible on status page?** bestemmer, om den overhovedet vises.

### Hændelser

`Incident` er den tredje hændelsestype. Hvad der overhovedet får en hændelse til at nå en statusside — hvilke ressourcer den rører, og hvilke tilstande der holder den synlig — er dækket i [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).

Sektionen **Notifikationslogs** i statussidens sidemenu (`{id}/notification-logs`) er dér, du går hen, når du har brug for at se, hvad siden faktisk sendte.

## At tilpasse notifikationsskabeloner

Kortet **Notifikationsskabeloner** på **Abonnementsindstillinger** lister de skabeloner, denne statusside bruger, med kolonnerne **Skabelonnavn**, **Begivenhedstype** og **Notifikationsmetode** — så du kan variere ordlyden per hændelsestype og per kanal frem for at acceptere én husbesked til alt.

Projektbrede skabeloner bor ét niveau op, på **Statussider → Indstillinger → Abonnementsskabeloner**, ved siden af **Meddelelsesskabeloner**.

## E-mailsidefod, brugerdefineret SMTP og Twilio

Tre kort mere på **Abonnementsindstillinger** styrer, hvordan abonnentbeskeder forlader dit projekt:

- **Indstillinger for e-mailsidefod** — **Aktivér brugerdefineret tekst i e-mailsidefod** og **Sidefodstekst til e-mailnotifikationer for abonnenter** sætter din egen sidefod på abonnent-e-mails.
- **Brugerdefineret SMTP** — **Brugerdefineret SMTP-konfiguration** sender abonnent-e-mail gennem din egen mailserver i stedet for standarden.
- **Twilio-konfiguration** — **Twilio-konfiguration** er den Twilio-konto, der bruges til SMS-abonnenter.

Brugerdefineret SMTP er værd at gøre tidligt, hvis du har e-mailabonnenter: post, der kommer fra dit eget domæne, er langt mindre tilbøjelig til at blive filtreret og langt mere tilbøjelig til at blive stolet på af den kunde, der læser den klokken 2 om natten.

## Meddelelser

En meddelelse er en registrering på projektniveau (modellen `StatusPageAnnouncement`), som du spreder ud til en eller flere statussider, eventuelt afgrænset til bestemte monitorer, med et vindue hvori den vises.

Du opretter en fra **Statussider → Mere → Meddelelser**, eller fra **Meddelelser** i en individuel statussides sidemenu. Oprettelsesformularen er en firetrins-guide:

1. **Grundlæggende oplysninger** — **Meddelelsestitel** (påkrævet, mindst to tegn), **Beskrivelse** (Markdown, valgfri) og **Vedhæftninger** til filer, der skal være tilgængelige sammen med meddelelsen på statussiden.
2. **Statussider** — **Vis meddelelse på disse statussider**, et påkrævet multivalg. Én meddelelse kan ramme flere sider på én gang.
3. **Berørte ressourcer** — **Berørte overvågninger (valgfrit)**. Hvis du ikke vælger nogen, får alle abonnenter besked.
4. **Tidsplan og indstillinger** — **Begynd at vise meddelelse den** (påkrævet, standard nu), **Stop visning af meddelelse kl.** (valgfri) og **Underret statussideabonnenter** (slået til som standard).

Besøgende læser meddelelser på `/announcements`, opdelt i **Active Announcements** og **Past Announcements**, hver stemplet med **Announced at**. Meddelelser, der er live lige nu, fastgøres også øverst på oversigtssiden. Når der intet er at vise, lyder siden *No Announcement* med bemærkningen om, at der endnu ikke er skrevet nogen.

Vedhæftninger serveres fra `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, bag det samme læsetjek som selve statussiden — så en vedhæftning på en privat side forbliver privat.

## Hvordan planlægning af meddelelser fungerer

**Show At** (`showAnnouncementAt`) og **End At** (`endAnnouncementAt`) driver det hele, men oversigtssiden og listen over meddelelser stiller forskellige spørgsmål, og forskellen snyder folk.

- **Oversigtssiden** viser en meddelelse, når `showAnnouncementAt` er i fortiden, og `endAnnouncementAt` enten er i fremtiden eller tom.
- **Listen `/announcements`** viser meddelelser, hvis `showAnnouncementAt` falder inden for **Vis meddelelseshistorik (i dage)** (`showAnnouncementHistoryInDays`, standard 14), og deler dem derefter op i aktive og tidligere på klientsiden.

To konsekvenser værd at planlægge efter:

- **En meddelelse uden slutdato udløber aldrig.** Lad **Stop visning af meddelelse kl.** stå tom, og den forbliver fastgjort til oversigtssiden på ubestemt tid. Sæt en slutdato på alt, der er tidsbegrænset.
- **En gammel, men stadig aktiv meddelelse kan forsvinde fra listen.** Hvis den startede for mere end `showAnnouncementHistoryInDays` siden, falder den af `/announcements`, men bliver på oversigten. Hæv historikvinduet, hvis du har langvarige opslag.

Om meddelelser overhovedet vises, styres af kortet **Meddelelsesindstillinger** på **Avancerede indstillinger**: **Vis meddelelser** (`showAnnouncementsOnStatusPage`, standard sand) og **Vis meddelelseshistorik (i dage)** (standard 14). Med **Vis meddelelser** slået fra afviser meddelelses-endpointet anmodningen fuldstændigt.

## Meddelelsesskabeloner

Hvis du skriver den samme slags opslag gentagne gange — et månedligt varsel om vedligeholdelse, en tilbagevendende tredjepartsforringelse — så lav den på forhånd. **Statussider → Indstillinger → Meddelelsesskabeloner** gemmer modellen `StatusPageAnnouncementTemplate`, og dens formular beder om **Skabelonnavn**, **Skabelonbeskrivelse**, **Meddelelsestitel**, **Beskrivelse**, **Vis meddelelse på disse statussider**, **Berørte overvågninger (valgfrit)** og **Underret abonnenter**, så spredningen og beslutningen om notifikation træffes én gang i stedet for hver gang.

## Webhook-abonnenter og SSRF-beskyttelse

Webhook-abonnenter modtager en JSON-`POST`-anmodning ved hver statusside-begivenhed, hvilket gør dem til den nemmeste måde at føre statussideopdateringer ind i et system, du selv styrer — en chatbot, et internt dashboard, en sagskø.

Fordi det at abonnere er en offentlig handling på en offentlig side, beskytter OneUptime målet:

- En generisk **Webhook-URL** valideres, før den accepteres, og private adresser, loopback-, link-local- og cloud-metadata-adresser afvises. Du kan ikke pege et abonnement mod noget inde i OneUptime-udrulningens eget netværk.
- En **URL til indgående webhook for Slack** skal begynde med `https://hooks.slack.com/services/`.

Hvis et webhook-abonnement afvises ved tilmelding, er en intern eller forkert udformet URL det første, du skal tjekke.

## Læs videre

- [Statussider – Oversigt](/docs/status-pages/index) — hvad en statusside er, og hvordan den er sat sammen.
- [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups) — de monitorer og grupper, abonnenter kan vælge imellem.
- [Statusside – branding og domæner](/docs/status-pages/branding-and-domains) — brugerdefinerede domæner, logoer og udseendet af den side, dine e-mails linker til.
- [Offentlig API](/docs/status-pages/public-api) — at læse statussidedata programmatisk.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — hvad der sætter en hændelse på en statusside, og hvad der fjerner den.
- [Hændelsesindstillinger og automatisering](/docs/incidents/settings) — reglerne på projektniveau bag hændelseskommunikation.
