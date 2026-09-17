# Hændelser – Oversigt

En hændelse i OneUptime er den optegnelse, dit team samler sig om, når noget går i stykker. Den bærer et nummer, en titel, en alvorsgrad, en aktuel tilstand, de ressourcer den rammer, og alt det dit team skriver ned undervejs — noter, grundårsag, afhjælpende skridt og et feed, der kun kan tilføjes til, over hvem der gjorde hvad.

Hændelser er det, der gør en monitor, som bliver rød, til en koordineret indsats. At erklære en tilkalder den rigtige vagtrotation, tilføjer ejere, der får besked om hver ændring, sætter runbooks i gang og — hvis du vil det — slår udfaldet op på din offentlige statusside, så kunderne holder op med at oprette sager for at spørge, om I allerede ved det.

Du kan erklære en hændelse i hånden klokken tre om natten, eller lade en monitor erklære den for dig i det øjeblik dens kriterier matcher. Uanset hvad er hændelsen det samme objekt, med den samme livscyklus og det samme papirspor til sidst.

## Kort fortalt

- **Funktion på øverste niveau** — **Hændelser** i dashboardets venstre navigation, på `/dashboard/{projectId}/incidents`.
- **Tre forudoprettede tilstande** — **Identified**, **Bekræftet** og **Løst** oprettes for hvert nyt projekt. Du kan tilføje dine egne; de tre forudoprettede kan omdøbes og få nye farver, men aldrig slettes.
- **Tre forudoprettede alvorsgrader** — **Critical Incident**, **Major Incident** og **Minor Incident**. Alvorsgrad er en etiket med en farve og en rækkefølge — den har ingen adfærd i sig selv.
- **Fire veje ind** — guiden **Erklær hændelse**, **Opret fra skabelon**, en regel i en monitors kriterier eller `POST /api/incident`.
- **Nummereret per projekt** — hver hændelse får et hændelsesnummer, som standard vist som `#42` eller med dit eget præfiks, f.eks. `INC-42`.
- **To slags noter** — private noter (interne noter) til dit team, offentlige noter til statussidens abonnenter.
- **Indstillingerne bor under Hændelser, ikke under Projektindstillinger** — tilstande, alvorsgrader, skabeloner, brugerdefinerede felter og regelmotorerne ligger alle under **Hændelser → Indstillinger** og **Hændelser → Regler**.

## Nøglebegreber

En håndfuld ord går igen på alle de øvrige sider i dette afsnit. Få styr på dem først.

| Begreb                     | Hvad det betyder                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hændelse**               | Selve optegnelsen — titel, beskrivelse, alvorsgrad, aktuel tilstand, berørte ressourcer og alt det, der skrives på den under indsatsen.               |
| **Hændelsestilstand**      | Hvor hændelsen er i sin livscyklus. En projektafgrænset række med navn, farve og `order`, plus de flag der giver den betydning.                       |
| **Hændelsesalvorsgrad**    | Hvor slemt det er. En projektafgrænset række med navn, farve og `order`. Rent klassifikation — intet i produktet behandler én alvorsgrad særligt.     |
| **Hændelsesnummer**        | En tæller per projekt, vist som `#42` — eller med et præfiks, du konfigurerer, som `INC-42`.                                                          |
| **Berørte ressourcer**     | De monitorer, værter, Kubernetes-klynger, Docker-værter, tjenester og anden infrastruktur, du knytter til hændelsen.                                  |
| **Offentlig note**         | En opdatering skrevet til statussidens læsere og abonnenter. Den vises på statussidens tidslinje.                                                     |
| **Privat note**            | En intern note (modellen `IncidentInternalNote`) til det team, der håndterer sagen. Den når aldrig ud på en statusside.                               |
| **Ejer**                   | En bruger eller et team med ansvar for hændelsen. Ejere får besked, når den oprettes, når der skrives noter, og når tilstanden ændrer sig.            |
| **Hændelsesfeed**          | Den aktivitetstidslinje på hændelsens **Oversigt**, der kun kan tilføjes til, og som registrerer tilstandsskift, noter, ejerændringer, regelkørsler og notifikationer. |
| **Tilstandstidslinje**     | Optegnelsen over hvilken tilstand hændelsen var i, hvornår og hvor længe — med abonnentnotifikationsstatus for hver overgang.                         |

## De tre tilstande OneUptime opretter i hvert projekt

Når et projekt oprettes, opretter OneUptime præcis tre hændelsestilstande, i denne rækkefølge:

| Tilstand         | Rækkefølge | Farve             | Hvad den betyder                                                            |
| ---------------- | ---------- | ----------------- | --------------------------------------------------------------------------- |
| **Identified**   | 1          | Rød (`#fd625e`)   | Den tilstand en helt ny hændelse lander i. Det er den oprettede tilstand.    |
| **Bekræftet**    | 2          | Gul (`#ffbf53`)   | Nogen har taget hændelsen på sig og arbejder på den.                        |
| **Løst**         | 3          | Grøn (`#2ab57d`)  | Hændelsen er ovre. At løse den er det, der tager den af din statusside.     |

Navnene er kun etiketter — det, der faktisk styrer adfærden, er tre booleans på tilstandsrækken: `isCreatedState`, `isAcknowledgedState` og `isResolvedState`. Kun én tilstand per projekt forventes at bære hvert flag.

Den skelnen betyder mere, end den lyder til:

- `isCreatedState` afgør, hvor en ny hændelse starter. Vælges der ingen tilstand udtrykkeligt ved oprettelsen, finder OneUptime projektets oprettede tilstand og bruger den.
- `isAcknowledgedState` og `isResolvedState` driver knapperne **Acknowledge** og **Løs** i hændelsens sidehoved, de to nøgletalsfelter på hændelsens **Oversigt** og tælleren **Aktive hændelser** i sidemenuen.
- **Aktive hændelser** er defineret udelukkende som "den aktuelle tilstand er ikke den løste tilstand". Enhver egen tilstand, du tilføjer, er derfor aktiv, medmindre den er den løste.

**Bemærk navngivningen.** Den første forudoprettede tilstand hedder **Identified**, selv om flere beskrivelser inde i produktet stadig kalder den den oprettede tilstand. Leder du efter "Created" i dit projekts tilstandsliste, er det rækken, der hedder **Identified**.

Du kan tilføje dine egne tilstande under **Hændelser → Indstillinger → Hændelsesstatus**. Nye tilstande føjes til slutningen af den ordnede liste, og du kan trække dem på plads. De tre flagbærende tilstande kan ikke slettes — OneUptime blokerer det — men du kan omdøbe dem og give dem nye farver, og derfor læser brugerfladen tilstandsnavne dynamisk.

Rækkefølgen håndhæves, den er ikke kosmetik: en hændelse kan ikke flyttes til en tilstand, der ligger tidligere i rækkefølgen end dens nuværende.

Alle detaljer står i [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).

## De tre alvorsgrader OneUptime opretter i hvert projekt

Hvert nyt projekt får også tre alvorsgrader:

| Alvorsgrad            | Rækkefølge | Farve                | Hvad den betyder                                             |
| --------------------- | ---------- | -------------------- | ------------------------------------------------------------ |
| **Critical Incident** | 1          | Bordeaux (`#b70400`) | Meget stor kundepåvirkning, kræver øjeblikkelig indsats.     |
| **Major Incident**    | 2          | Rød (`#fd625e`)      | Betydelig påvirkning, kræver som regel øjeblikkelig indsats. |
| **Minor Incident**    | 3          | Gul (`#ffbf53`)      | Lille påvirkning, klares normalt i arbejdstiden.             |

De fulde forudoprettede beskrivelser findes i [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).

Alvorsgrader har `name`, `description`, `color` og `order` og intet andet. Der er ingen flag, og ingen kodesti behandler "Critical Incident" anderledes end nogen anden række. Alvorsgrad er den måde, mennesker triagerer på, og den kan bruges som matchkriterium, når du skriver vagtregler — men at vælge en alvorsgrad tilkalder ikke i sig selv nogen.

Rediger eller tilføj alvorsgrader under **Hændelser → Indstillinger → Hændelsesalvor**.

## En hændelses liv

### 1. Den bliver erklæret

Fire veje fører til det samme objekt:

- **I hånden** — klik **Erklær hændelse** på listen over hændelser. Det åbner guiden **Erklær ny hændelse**, som er fem trin lang: **Hændelsesdetaljer**, **Berørte ressourcer**, **Hændelsesroller**, **Vagt**, **Mere**.
- **Fra en skabelon** — klik **Opret fra skabelon** og vælg en gemt **Hændelsesskabelon**. Skabeloner forudfylder titel, beskrivelse, alvorsgrad, starttilstand, ressourcer, vagtpolitikker, ejere og etiketter.
- **Fra en monitor** — en regel i en monitors kriterier med "erklær en hændelse" slået til opretter hændelsen automatisk i det øjeblik dens filtre matcher. Titler og beskrivelser dér understøtter skabeloner med `{{variable}}`.
- **Via API'et** — `POST /api/incident` med en API-nøgle. Serveren udfylder `declaredAt`, den oprettede tilstand og hændelsesnummeret for dig.

Se [Opret en hændelse](/docs/incidents/declaring-incidents) for gennemgangen felt for felt.

### 2. De rigtige folk får det at vide

Ved oprettelsen kører OneUptime den automatisering, du har sat op: etiketregler, vagtregler, ejerregler og runbook-regler. Alle vagtpolitikker, der er knyttet til hændelsen — manuelt, fra en skabelon eller flettet ind af en matchende vagtregel — udføres parallelt.

Ejere får besked via e-mail, SMS, opkald, push og WhatsApp, afhængigt af hver brugers egne notifikationspræferencer. Har en hændelse slet ingen ejere, går notifikationen videre til projektets ejere i stedet for at blive droppet.

Er hændelsen synlig på en statusside, og er abonnentnotifikationer slået til, får abonnenterne det også at vide. Notifikationerne er cron-drevne og kører hvert minut, så regn med op mod et minuts forsinkelse frem for øjeblikkelig afsendelse.

### 3. Dit team arbejder på den

Respondere bekræfter hændelsen, knytter berørte ressourcer til, kører runbooks, tildeler hændelsesroller og skriver ting ned, efterhånden som de bliver klogere — private noter til teamet, offentlige noter til kunderne, plus siderne **Grundårsag** og **Afhjælpning**, når billedet klarner. Alt, hvad de gør, lander i **Hændelse Feed** på siden **Oversigt**.

### 4. Den bliver løst

Et klik på **Løs** flytter hændelsen til den løste tilstand, stempler tilstandstidslinjen, stopper varighedsuret og fjerner hændelsen fra den aktive sektion på enhver statusside, den blev vist på. Der skal ikke ændres andet, for at det sker — det er flaget for løst tilstand, statussidens forespørgsel kigger på.

Derefter kan du skrive en postmortem og eventuelt offentliggøre den på statussiden.

## Hvor hændelser bor i dashboardet

Åbn **Hændelser** i venstre navigation. Sidemenuen er delt op i sektioner:

| Sektion            | Hvad du gør der                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Oversigt**       | **Alle hændelser** og **Aktive hændelser** — sidstnævnte har et rødt mærke med antallet af hændelser, der ikke er i den løste tilstand.                                 |
| **Episoder**       | Hændelsesepisoder, en separat grupperingsfunktion med sine egne sider.                                                                                                  |
| **AI**             | **Undersøgelse** og **Afhjælpning** — indstillinger for automatisk undersøgelse og automatisk afhjælpning.                                                              |
| **Arbejdsområde**  | **Slack**- og **Microsoft Teams**-forbindelser til hændelser.                                                                                                           |
| **Regler**         | Regelmotorerne: **Grupperingsregler**, **Vagtregler**, **Ejerregler**, **Runbook-regler**, **Privatlivsregler**, **Etiketregler**, **SLA-regler**, **Reminder Rules**.   |
| **Indstillinger**  | **Hændelsesstatus**, **Hændelsesalvor**, **Hændelsesskabeloner**, **Noteskabeloner**, **Postmortem-skabeloner**, **Brugerdefinerede felter**, **Hændelsesroller**, **Flere indstillinger**. |

**Regler** og **Indstillinger** er sammenklappet som standard — fold dem ud for at finde de sider, resten af denne dokumentation henviser til. Hændelseskonfiguration ligger ikke under Projektindstillinger; det hele bor her.

Selve listen over hændelser viser **Hændelsesnummer**, **Titel**, **Tilstand**, **Alvorlighed**, **Berørte ressourcer**, **Erklæret**, **Varighed**, **Etiketter** og **Ejere**, med massehandlingen **Skift tilstand** til at lukke flere på én gang.

## Hvad hver side på en hændelse viser

Åbn en hændelse, og du får en venstre sidemenu, grupperet sådan her:

- **Oversigt** — kortet **Hændelsesdetaljer** (titel, alvorsgrad, etiketter, hændelsesnummer, erklæret hvornår, erklæret af, vagtpolitikker), kortet **Berørte ressourcer** og **Hændelse Feed**. Over dem nøgletalsfelter for tid til bekræftelse, tid til løsning og samlet **Varighed**.
- **Tilstandstidslinje** — hver tilstand hændelsen har været i, med **Begynder den**, **Slutter den**, **Varighed** og abonnentnotifikationsstatus for hver overgang. **Vis årsag** og **Vis logge** forklarer, hvorfor hver ændring skete.
- **SLA** — SLA-sporing for denne hændelse.
- **Beskrivelse**, **Grundårsag**, **Afhjælpning** — tre markdown-sider. Beskrivelsen er den, der vises på din statusside.
- **Runbooks** — runbook-kørsler knyttet til denne hændelse.
- **Postmortem** — opsamlingen, som du kan vælge at offentliggøre på statussiden.
- **Roller**, **Vagtudførelser**, **Ejere** — hvem der er på den, hvilke politikker der udløstes, og hvem der får besked.
- **Notifikationslogs**, **AI-logs**, **Auditlogs** — hvad der blev sendt, og hvad der blev ændret.
- **Offentlige noter** og **Private noter** — under sektionen **Noter** i sidemenuen.
- **Brugerdefinerede felter**, **Indstillinger**, **Slet hændelse** — under **Avanceret**. Siden **Indstillinger** rummer **Synlig på statussiden**, **Privat hændelse** og kortet **Reminders**.

[Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) går i dybden med samarbejdssiderne.

## Hvordan hændelser spiller sammen med resten af OneUptime

- **Monitorer opdager problemet; hændelser registrerer det.** En regel i en monitors kriterier kan erklære en hændelse automatisk og forudfylde titel, alvorsgrad, vagtpolitikker, ejere, etiketter og afhjælpningsnoter. Se [Hændelse- og advarselsskabeloner](/docs/monitor/incident-alert-templating) for de variabler, du kan bruge dér.
- **Vagtpolitikker står for tilkaldelsen.** Knyt politikker på trinnet **Vagt** i erklæringsguiden, på en skabelon eller via **Hændelser → Regler → Vagtregler**. Hver regel, der matcher, udløses — det udførte sæt er foreningsmængden af alle match plus alt, der er knyttet direkte, uden dubletter.
- **Runbooks fortæller folk, hvad de skal gøre.** Runbook-regler knytter automatisk en procedure, når en matchende hændelse oprettes, og respondere kan starte en i hånden fra hændelsen. Se [Runbooks – Oversigt](/docs/runbooks/index).
- **Statussider fortæller kunderne det.** En hændelse vises på en statussides aktive liste, når siden har hændelser slået til, hændelsen er markeret som synlig på statussiden, og dens aktuelle tilstand ikke er den løste. Private hændelser er altid skjult fra alle statussider. Se [Statussider – Oversigt](/docs/status-pages/index).
- **Workflows automatiserer omkring den.** Triggerne **On Create Incident**, **On Update Incident** og **On Delete Incident** lader dig bygge no-code-automatisering oven på hændelsers livscyklus. Se [Workflows – Oversigt](/docs/workflows/index).

## Læs videre

- [Opret en hændelse](/docs/incidents/declaring-incidents) — guiden, skabelonerne, monitorkriterier og API'et.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — tilstandsflagene, egne tilstande og klassifikation efter alvorsgrad.
- [Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) — offentlige og private noter, ejere og aktivitetsfeedet.
- [Hændelsesindstillinger og automatisering](/docs/incidents/settings) — skabeloner, brugerdefinerede felter, nummerpræfikser og regelmotorerne.
- [Statussider – Oversigt](/docs/status-pages/index) — hvordan hændelser når ud til dine kunder.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — hvem der får besked, når en hændelse rykker sig.
