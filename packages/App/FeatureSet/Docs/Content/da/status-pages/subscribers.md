# Abonnenter og meddelelser

En statusside er et sted, folk går hen. Abonnenter er dem, der helst vil slippe for det — de afleverer en e-mailadresse, et telefonnummer, en Slack-webhook eller et HTTP-endpoint én gang, og derefter kommer dine opdateringer til dem.

Meddelelser er den anden halvdel af samme opgave. En monitor kan fortælle dine besøgende, at checkout svarer med 500-fejl; ingen monitor kan fortælle dem, at I flytter databaser på lørdag, at en tredjepartsudbyder har en dårlig dag, eller at den hændelse, de læste om i går, nu er helt lukket. Meddelelser er fritekstkanalen til alt det, dine tjek ikke kan se, og de går ud til den samme abonnentliste.

Denne side dækker begge dele: de fem abonnementskanaler og hvordan besøgende tilmelder sig, hvad abonnenter selv kan vælge at høre om, forløbet for dobbelt bekræftelse og afmelding, og hvordan meddelelser skrives, planlægges og gemmes som skabeloner.

## Abonnementskanaler

En statusside understøtter fem kanaler. De og den side, besøgende tilmelder sig på, slås til ét sted: kortet **Kanaler** under **Statussider → din side → Abonnenter → Abonnementsindstillinger**. Hver kontakt gemmes, så snart du slår den om:

- **Vis abonnentside** (`showSubscriberPageOnStatusPage`) — slået til som standard. Sætter punktet **Abonner** i statussidens navigationslinje, hvor besøgende tilmelder sig via kanalerne nedenfor.
- **E-mail** (`enableEmailSubscribers`) — slået til som standard. Alt det øvrige er slået fra, indtil du selv tænder for det.
- **SMS** (`enableSmsSubscribers`) — slået fra som standard. På OneUptime Cloud betales hver SMS af projektets saldo til SMS og opkald, medmindre siden har sin egen **Twilio-konfiguration**. For at slå den til skal **SMS** også være slået til for projektet i kortet **Notifikationskanaler** under **Projektindstillinger > Notifikationer > Notifikationsindstillinger**.
- **Slack** (`enableSlackSubscribers`) — slået fra som standard.
- **Microsoft Teams** (`enableMicrosoftTeamsSubscribers`) — slået fra som standard.
- **Webhook** (`enableWebhookSubscribers`) — slået fra som standard.

Kontakterne bestemmer, hvordan besøgende selv kan tilmelde sig: statussiden afviser en tilmelding via en kanal, der er slået fra. De stopper ikke notifikationer: abonnenter, som dit team tilføjer i dashboardet, via API'et eller med et workflow, får opdateringer, uanset hvilke kanaler der er slået til.

På OneUptime Cloud står planens navn ved siden af en kontakt, som din plan ikke omfatter: **Growth** for **SMS** og **Vis abonnentside**, **Scale** for **Slack**, **Microsoft Teams** og **Webhook**.

Hver kanal får også sin egen liste i statussidens sidemenu under **Abonnenter**: **E-mail-abonnenter**, **SMS-abonnenter**, **Slack-abonnenter**, **MS Teams-abonnenter** og **Webhook-abonnenter**. Det er dér, du ser hvem der er tilmeldt, tilføjer nogen manuelt eller efterlader dig selv en **Noter**-note (`internalNote`) på en bestemt abonnent. Så længe en kanal er slået fra, står det øverst i dens liste, med kanalens kontakt lige ved siden af, så du kan slå den til uden at forlade listen.

**Én kontakt er ikke nok.** Punktet **Abonner** i statussidens navigationslinje dukker først op, når **Vis abonnentside** er slået til *og* mindst én kanal er slået til. Slår du **E-mail** til, men lader **Vis abonnentside** stå slukket, har besøgende ingen vej til formularen.

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

Meddelelsen selv bærer **Skal abonnenter på statussiden underrettes?** (`shouldStatusPageSubscribersBeNotified`), som på oprettelsesformularen vises som afkrydsningsfeltet **Underret statussideabonnenter** under **Tidsplan og notifikationer** og er slået til som standard. Abonnenter hører om den én gang, når meddelelsen begynder at blive vist, så valget træffes ved oprettelsen, og en redigering ændrer det ikke. Nævner meddelelsen monitorer under **Berørte monitorer**, afgrænses notifikationen til dem; lad feltet stå tomt, og alle abonnenter får besked.

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

Du opretter en fra **Statussider → Mere → Meddelelser**, eller fra **Meddelelser** i en enkelt statussides sidemenu. Oprettet fra en statusside er den side allerede valgt, så en titel og en beskrivelse er alt, der skal til, og **Opret meddelelse** fører dig tilbage til sidens liste **Meddelelser** (eller til projektets liste, hvis du fravalgte siden undervejs). Oprettelsesformularen har to trin og derefter en oversigt:

1. **Meddelelse** — **Titel** (påkrævet, mindst to tegn) og **Beskrivelse** (Markdown, påkrævet: det er teksten, folk læser på statussiden). **Vedhæftninger** til filer, der skal ligge sammen med meddelelsen på statussiden, ligger under **Avanceret**.
2. **Statussider** — **Vis meddelelse på disse statussider**, et påkrævet flervalg (én meddelelse kan ramme flere sider på én gang), og **Berørte monitorer**: vælger du ingen, får alle abonnenter besked. Når du har valgt monitorer, foreslår formularen under valget af sider de statussider, der viser dem: "Statussider, der viser de berørte monitorer:" efterfulgt af hver sides navn. Klik på et navn for at tilføje siden, eller på **Tilføj alle**; intet vælges for dig. Herunder er **Tidsplan og notifikationer** foldet sammen til én linje, der siger, hvad der vil ske: "Vises nu og bliver stående, indtil du afslutter den. Abonnenter underrettes, når den begynder at blive vist." Fold den ud for at ændre **Begynd at vise meddelelse den** (som standard nu), **Stop visning af meddelelse kl.** (tomt: meddelelsen bliver stående, indtil du angiver en slutning) eller **Underret statussideabonnenter** (slået til som standard). Linjen følger dine svar. Slutningen skal ligge efter starten og, for en ny meddelelse, stadig ligge ude i fremtiden: en meddelelse, der allerede er slut, ville aldrig blive vist.

Oversigten viser den samme linje. **Opret fra skabelon** udfylder formularen ud fra en skabelon; oprettet fra en statusside bevares skabelonens egne statussider ved siden af den side.

Selve meddelelsens side redigerer den i de samme to trin. **Underret abonnenter om denne opdatering** står under beskrivelsen, og **Tidsplan** rummer start og slutning. At angive en slutning, der er passeret, er måden at tage en meddelelse ned på.

Besøgende læser meddelelser på `/announcements`, delt op i **Aktive meddelelser** og **Tidligere meddelelser**, hver stemplet med **Annonceret den**. Meddelelser, der er live lige nu, hænges desuden op øverst på oversigtssiden. Er der intet at vise, står der *Ingen meddelelser* med en note om, at der ikke er offentliggjort nogen endnu.

Vedhæftninger serveres fra `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, bag det samme læsetjek som statussiden selv — så en vedhæftning på en privat side forbliver privat.

## Sådan virker planlægningen af meddelelser

**Show At** (`showAnnouncementAt`) og **End At** (`endAnnouncementAt`) styrer det hele, men oversigtssiden og meddelelseslisten stiller hver sit spørgsmål, og forskellen snyder folk.

- **Oversigtssiden** viser en meddelelse, når `showAnnouncementAt` ligger i fortiden, og `endAnnouncementAt` enten ligger i fremtiden eller er tom.
- **Listen på `/announcements`** viser de meddelelser, hvis `showAnnouncementAt` falder inden for meddelelsernes historikvindue (`showAnnouncementHistoryInDays`, standard 14), og deler dem så op i aktive og tidligere på klienten.

To konsekvenser, det er værd at planlægge efter:

- **En meddelelse uden slutdato udløber aldrig.** Lad **Stop visning af meddelelse kl.** stå tom, og den bliver hængende på oversigtssiden i det uendelige. Sæt en slutdato på alt, der er tidsbegrænset.
- **En gammel, men stadig aktiv meddelelse kan forsvinde fra listen.** Startede den for mere end `showAnnouncementHistoryInDays` siden, falder den ud af `/announcements`, men bliver på oversigten. Skru historikvinduet op, hvis du kører langvarige opslag.

Om meddelelser overhovedet vises, indstilles i kortet **Hvad din statusside viser** på **Avancerede indstillinger**: **Vis meddelelser** (`showAnnouncementsOnStatusPage`, standard true) og under den **Vis de seneste … dage** (`showAnnouncementHistoryInDays`, standard 14). Er **Vis meddelelser** slået fra, afviser meddelelsesendepunktet anmodningen helt.

## Meddelelsesskabeloner

Slår du den samme slags opslag op igen og igen — et månedligt vedligeholdelsesvarsel, en tilbagevendende forringelse hos en tredjepart — så lav den på forhånd. **Statussider → Indstillinger → Meddelelsesskabeloner** rummer modellen `StatusPageAnnouncementTemplate`. Dens formular går gennem **Skabeloninformation** (**Skabelonnavn**, **Skabelonbeskrivelse**) og derefter meddelelsens egne trin: **Meddelelse** (**Titel**, **Beskrivelse**) og **Statussider** (**Vis meddelelse på disse statussider**, **Berørte monitorer** og **Underret statussideabonnenter**, slået til som standard), så både udbredelsen og beslutningen om at underrette træffes én gang i stedet for hver gang. En skabelon har ingen tidsplan: en meddelelse, der oprettes ud fra den, vises fra oprettelsen, medmindre du ændrer det under **Tidsplan og notifikationer**.

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
