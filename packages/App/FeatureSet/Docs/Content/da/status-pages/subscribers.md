# Abonnenter og meddelelser

En statusside er et sted, folk går hen. Abonnenter er dem, der helst vil slippe for det — de afleverer en e-mailadresse, et telefonnummer, en Slack-webhook eller et HTTP-endpoint én gang, og derefter kommer dine opdateringer til dem.

Meddelelser er den anden halvdel af samme opgave. En monitor kan fortælle dine besøgende, at checkout svarer med 500-fejl; ingen monitor kan fortælle dem, at I flytter databaser på lørdag, at en tredjepartsudbyder har en dårlig dag, eller at den hændelse, de læste om i går, nu er helt lukket. Meddelelser er fritekstkanalen til alt det, dine tjek ikke kan se, og de går ud til den samme abonnentliste.

Denne side dækker begge dele: de fem abonnementskanaler og hvordan besøgende tilmelder sig, hvad abonnenter selv kan vælge at høre om, forløbet for dobbelt bekræftelse og afmelding, og hvordan meddelelser skrives, planlægges og gemmes som skabeloner.

## Abonnementskanaler

En statusside understøtter fem kanaler, hver med sin egen kontakt på statussiden. Gå til **Statussider → din side → Abonnenter → Abonnementsindstillinger**:

- **Aktivér e-mailabonnenter** (`enableEmailSubscribers`) — slået til som standard. Alt det øvrige er slået fra, indtil du selv tænder for det.
- **Aktivér SMS-abonnenter** (`enableSmsSubscribers`) — slået fra som standard.
- **Aktivér Slack-abonnenter** (`enableSlackSubscribers`) — slået fra som standard.
- **Aktivér Microsoft Teams-abonnenter** (`enableMicrosoftTeamsSubscribers`) — slået fra som standard.
- **Aktivér webhook-abonnenter** (`enableWebhookSubscribers`) — slået fra som standard.

Hver kanal får også sin egen liste i statussidens sidemenu under **Abonnenter**: **E-mail-abonnenter**, **SMS-abonnenter**, **Slack-abonnenter**, **MS Teams-abonnenter** og **Webhook-abonnenter**. Det er dér, du ser hvem der er tilmeldt, tilføjer nogen manuelt eller efterlader dig selv en **Noter**-note (`internalNote`) på en bestemt abonnent.

**Én kontakt er ikke nok.** Punktet **Abonner** i statussidens navigationslinje dukker først op, når **Vis abonnentside** (`showSubscriberPageOnStatusPage`) er slået til *og* mindst én kanal er aktiveret. Slår du **Aktivér e-mailabonnenter** til, men lader **Vis abonnentside** stå slukket, har besøgende ingen vej til formularen.

De samme fem kontakter optræder en gang til i kortet **Abonnementsindstillinger** på **Avancerede indstillinger**, side om side med **Vis abonnentside**. Det er de samme kolonner nedenunder — vælg én skærm og bliv på den, og hold dig helst til den dedikerede side **Abonnementsindstillinger**, for det er dér, resten af abonnentopsætningen bor.

## Hvad en besøgende ser på Abonner-siden

Siden **Abonner** har en undermenu med én fane per aktiveret kanal — **E-mail**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — som svarer til `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` og `/subscribe/webhooks`. Hver fane beder kun om det, den har brug for:

- **E-mail** — overskriften **Abonner via e-mail** og ét felt, **Din e-mail**, med pladsholderen `abonnent@firma.dk`.
- **SMS** — overskriften **Abonner via SMS** og ét felt, **Dit telefonnummer**, med pladsholderen `+4512345678`.
- **Slack** — overskriften **Abonner via Slack**, med **Slack-arbejdsområdets navn** (bruges til validering) og **URL til indgående webhook for Slack**, pladsholder `https://hooks.slack.com/services/...`.
- **MS Teams** — overskriften **Abonner via Microsoft Teams**, med **Microsoft Teams-arbejdsområdets navn** og **URL til indgående webhook for Microsoft Teams**, pladsholder `https://outlook.office.com/webhook/...`.
- **Webhooks** — overskriften **Abonner via webhook** og ét felt, **Webhook-URL**. Der sendes en JSON-`POST`-anmodning til den ved hver statussidehændelse.

Knappen hedder **Abonner**, og en vellykket tilmelding viser *Du er blevet tilmeldt.* Siden rummer også en opdeling i **Nyt abonnement** og **Administrer eksisterende abonnement**, så en, der allerede har abonneret, kan komme tilbage til sine indstillinger uden at lede efter en gammel e-mail.

## Lad abonnenter vælge ressourcer og hændelsestyper

Som udgangspunkt får en abonnent alt på siden. To kontakter i kortet **Avancerede abonnentindstillinger** ændrer det:

- **Tillad abonnenter at vælge ressourcer** (`allowSubscribersToChooseResources`) — slået fra som standard. Slå den til, og abonnementsformularen får en kontakt, **Abonner på alle ressourcer**; ryd den, og **Vælg ressourcer at abonnere på** kommer frem, så den besøgende kan plukke enkelte ressourcer.
- **Tillad abonnenter at vælge begivenhedstyper** (`allowSubscribersToChooseEventTypes`) — slået fra som standard. Samme form: en kontakt, **Abonner på alle hændelsestyper**, og **Vælg hændelsestyper at abonnere på** nedenunder, når den ryddes.

Hændelsestyperne er `Incident`, `Announcement` og `Scheduled Event`.

Valgene lander på abonnentposten som **Is Subscribed to All Resources** (`isSubscribedToAllResources`, standard true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, standard true), **Subscribed to Resources** og **Subscribed to Event Types**.

Godt til: en side, der dækker flere produkter. En kunde, der kun bruger dit API, gider ikke en besked, hver gang marketingsitet vakler — lad dem selv skære listen til i stedet for at se dem afmelde sig helt.

Det samme kort rummer også **Tidszoner for abonnenter**.

## Dobbelt bekræftelse på e-mail

E-mailabonnenter bekræfter altid. Når en abonnent oprettes med en e-mailadresse og ikke allerede er oprettet som bekræftet, tvinges **Is Subscription Confirmed** (`isSubscriptionConfirmed`) til `false`, og der genereres et sekscifret **Subscription Confirmation Token**. OneUptime sender så et bekræftelseslink af formen `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. Den besøgende lander på siden **Bekræft abonnement** og ser, når det er gået igennem, *Abonnement bekræftet*.

Abonnenter via SMS, Slack, Microsoft Teams og webhook springer dette over — de oprettes med `isSubscriptionConfirmed` sat til `true` fra start.

**Ubekræftet betyder tavs.** Forespørgslen, der henter abonnenter til en notifikation, filtrerer på `isUnsubscribed: false` og `isSubscriptionConfirmed: true`. En e-mailadresse, der aldrig klikkede på linket, bliver liggende i din liste **E-mail-abonnenter** og modtager ingenting. Sværger nogen på, at de er tilmeldt, men intet hører, så tjek den kolonne først.

Der findes ingen kontakt til at slå e-mailbekræftelsen fra — den gælder betingelsesløst for alle, der tilmelder sig via statussiden. En separat kolonne per abonnent, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, standard true), styrer den "du er tilmeldt"-e-mail, der sendes, når en abonnent er bekræftet.

## Administrer og opsig et abonnement

Hver abonnent-e-mail bærer et afmeldingslink af formen `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Den side hedder **Opdater abonnement** og fortæller den besøgende, at de kan ændre deres indstillinger eller afmelde sig dér. Den rummer:

- De vælgere til ressourcer og hændelsestyper, siden nu tillader.
- En kontakt, **Afmeld**, beskrevet som afmelding fra alle ressourcer. Den skriver **Er afmeldt** (`isUnsubscribed`, standard false).
- En knap, der hedder **Opdater abonnement**; gemmer du, vises *Dine ændringer er blevet gemt.*

Har nogen mistet linket, bruger de **Administrer eksisterende abonnement** på siden **Abonner** og trykker **Send administrationslink**. OneUptime svarer, at en e-mail med linket er sendt, og at man skal tjekke spam-mappen, hvis den ikke dukker op.

Endepunkterne bag det hele er `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` og `PUT .../update-subscription/:statusPageId/:subscriberId`.

En afmelding vender et flag i stedet for at slette en række, så posten bliver liggende i kanallisten med **Er afmeldt** sat — nyttigt, når du senere skal forklare, hvorfor en bestemt adresse holdt op med at få post.

## Hvad abonnenter får besked om

Abonnenter hører om de tre hændelsestyper ovenfor, men hver kilde har sin egen kontakt, så intet sendes ved et uheld.

### Notifikationer om meddelelser

Meddelelsen selv bærer **Skal abonnenter på statussiden underrettes?** (`shouldStatusPageSubscribersBeNotified`), som på oprettelsesformularen vises som afkrydsningsfeltet **Underret statussideabonnenter** og er slået til som standard. Nævner meddelelsen monitorer under **Berørte overvågninger (valgfrit)**, afgrænses notifikationen til dem; lad feltet stå tomt, og alle abonnenter får besked.

### Planlagte vedligeholdelsesbegivenheder

En planlagt vedligeholdelsesbegivenhed har sit eget sæt abonnentkolonner: **Skal abonnenter på statussiden underrettes, når denne begivenhed oprettes?**, **Skal abonnenter på statussiden underrettes, når denne begivenheds tilstand ændres til igangværende?**, **Skal abonnenter på statussiden underrettes, når denne begivenheds tilstand ændres til afsluttet?** samt **Subscriber notifications before the event** og **Next subscriber notification before the event at?** til varsler i god tid. **Statussider** på begivenheden afgør, hvilke sider den vises på, og **Should be visible on status page?** afgør, om den overhovedet vises.

### Hændelser

`Incident` er den tredje hændelsestype. Hvad der overhovedet får en hændelse på en statusside — hvilke ressourcer den rører, og hvilke tilstande der holder den synlig — står i [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).

Sektionen **Notifikationslogs** i statussidens sidemenu (`{id}/notification-logs`) er stedet, du går hen, når du har brug for at se, hvad siden faktisk sendte.

## Tilpasning af notifikationsskabeloner

Kortet **Notifikationsskabeloner** på **Abonnementsindstillinger** viser de skabeloner, denne statusside bruger, med kolonnerne **Skabelonnavn**, **Begivenhedstype** og **Notifikationsmetode** — så du kan variere ordlyden per hændelsestype og per kanal i stedet for at nøjes med én husbesked til det hele.

Projektomspændende skabeloner bor et niveau over, under **Statussider → Indstillinger → Abonnementsskabeloner**, ved siden af **Meddelelsesskabeloner**.

## E-mailsidefod, egen SMTP og Twilio

Tre yderligere kort på **Abonnementsindstillinger** styrer, hvordan abonnentbeskeder forlader dit projekt:

- **Indstillinger for e-mailsidefod** — **Aktivér brugerdefineret tekst i e-mailsidefod** og **Sidefodstekst til e-mailnotifikationer for abonnenter** sætter din egen sidefod på abonnent-e-mails.
- **Brugerdefineret SMTP** — **Brugerdefineret SMTP-konfiguration** sender abonnentpost gennem din egen mailserver i stedet for standardserveren.
- **Twilio-konfiguration** — **Twilio-konfiguration** er den Twilio-konto, der bruges til SMS-abonnenter.

Egen SMTP er værd at få på plads tidligt, hvis du har e-mailabonnenter: post fra dit eget domæne bliver langt sjældnere filtreret fra og langt oftere troet på af den kunde, der læser den klokken to om natten.

## Meddelelser

En meddelelse er en post på projektniveau (modellen `StatusPageAnnouncement`), som du breder ud til en eller flere statussider, eventuelt afgrænset til bestemte monitorer, med et vindue, hvor den vises.

Du opretter en fra **Statussider → Mere → Meddelelser**, eller fra **Meddelelser** i en enkelt statussides sidemenu. Oprettelsesformularen er en guide i fire trin:

1. **Grundlæggende oplysninger** — **Meddelelsestitel** (påkrævet, mindst to tegn), **Beskrivelse** (Markdown, valgfri) og **Vedhæftninger** til filer, der skal ligge sammen med meddelelsen på statussiden.
2. **Statussider** — **Vis meddelelse på disse statussider**, en påkrævet flervalgsliste. Én meddelelse kan ramme flere sider på én gang.
3. **Berørte ressourcer** — **Berørte overvågninger (valgfrit)**. Vælger du ingen, får alle abonnenter besked.
4. **Tidsplan og indstillinger** — **Begynd at vise meddelelse den** (påkrævet, står som standard til nu), **Stop visning af meddelelse kl.** (valgfri) og **Underret statussideabonnenter** (slået til som standard).

Besøgende læser meddelelser på `/announcements`, delt op i **Aktive meddelelser** og **Tidligere meddelelser**, hver stemplet med **Annonceret den**. Meddelelser, der er live lige nu, hænges desuden op øverst på oversigtssiden. Er der intet at vise, står der *Ingen meddelelser* med en note om, at der ikke er offentliggjort nogen endnu.

Vedhæftninger serveres fra `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, bag det samme læsetjek som statussiden selv — så en vedhæftning på en privat side forbliver privat.

## Sådan virker planlægningen af meddelelser

**Show At** (`showAnnouncementAt`) og **End At** (`endAnnouncementAt`) styrer det hele, men oversigtssiden og meddelelseslisten stiller hver sit spørgsmål, og forskellen snyder folk.

- **Oversigtssiden** viser en meddelelse, når `showAnnouncementAt` ligger i fortiden, og `endAnnouncementAt` enten ligger i fremtiden eller er tom.
- **Listen på `/announcements`** viser de meddelelser, hvis `showAnnouncementAt` falder inden for **Vis meddelelseshistorik (i dage)** (`showAnnouncementHistoryInDays`, standard 14), og deler dem så op i aktive og tidligere på klienten.

To konsekvenser, det er værd at planlægge efter:

- **En meddelelse uden slutdato udløber aldrig.** Lad **Stop visning af meddelelse kl.** stå tom, og den bliver hængende på oversigtssiden i det uendelige. Sæt en slutdato på alt, der er tidsbegrænset.
- **En gammel, men stadig aktiv meddelelse kan forsvinde fra listen.** Startede den for mere end `showAnnouncementHistoryInDays` siden, falder den ud af `/announcements`, men bliver på oversigten. Skru historikvinduet op, hvis du kører langvarige opslag.

Om meddelelser overhovedet vises, styres af kortet **Meddelelsesindstillinger** på **Avancerede indstillinger**: **Vis meddelelser** (`showAnnouncementsOnStatusPage`, standard true) og **Vis meddelelseshistorik (i dage)** (standard 14). Er **Vis meddelelser** slået fra, afviser meddelelsesendepunktet anmodningen helt.

## Meddelelsesskabeloner

Slår du den samme slags opslag op igen og igen — et månedligt vedligeholdelsesvarsel, en tilbagevendende forringelse hos en tredjepart — så lav den på forhånd. **Statussider → Indstillinger → Meddelelsesskabeloner** rummer modellen `StatusPageAnnouncementTemplate`, og dens formular beder om **Skabelonnavn**, **Skabelonbeskrivelse**, **Meddelelsestitel**, **Beskrivelse**, **Vis meddelelse på disse statussider**, **Berørte overvågninger (valgfrit)** og **Underret abonnenter**, så både udbredelsen og beslutningen om at underrette træffes én gang i stedet for hver gang.

## Webhook-abonnenter og SSRF-beskyttelse

Webhook-abonnenter modtager en JSON-`POST`-anmodning ved hver statussidehændelse, og det gør dem til den letteste måde at føre statussideopdateringer ind i et system, du selv styrer — en chatbot, et internt dashboard, en sagskø.

Fordi tilmelding er en offentlig handling på en offentlig side, vogter OneUptime på målet:

- En almindelig **Webhook-URL** valideres, før den accepteres, og private adresser, loopback, link-local og cloud-metadata afvises. Du kan ikke pege et abonnement mod noget inde i OneUptime-installationens eget netværk.
- En **URL til indgående webhook for Slack** skal begynde med `https://hooks.slack.com/services/`.

Bliver et webhook-abonnement afvist ved tilmelding, er en intern eller misdannet URL det første, du skal tjekke.

## Hvor du kan læse videre

- [Statussider – Oversigt](/docs/status-pages/index) — hvad en statusside er, og hvordan den er sat sammen.
- [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups) — de monitorer og grupper, abonnenter kan vælge imellem.
- [Statusside – branding og domæner](/docs/status-pages/branding-and-domains) — egne domæner, logoer og udseendet af den side, dine e-mails linker til.
- [Offentlig API](/docs/status-pages/public-api) — læsning af statussidedata programmatisk.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — hvad der sætter en hændelse på en statusside, og hvad der tager den ned igen.
- [Hændelsesindstillinger og automatisering](/docs/incidents/settings) — reglerne på projektniveau bag hændelseskommunikation.
