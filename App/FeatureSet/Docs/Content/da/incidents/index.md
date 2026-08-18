# Hændelser – Oversigt

En hændelse i OneUptime er den registrering, dit team samles om, når noget går i stykker. Den bærer et nummer, en titel, en alvorsgrad, en aktuel tilstand, de ressourcer den påvirker, og alt hvad dit team skriver ned undervejs — noter, grundårsag, afhjælpningstrin og et feed, der kun kan tilføjes til, over hvem der gjorde hvad.

Hændelser er det, der forvandler en monitor, som bliver rød, til en koordineret respons. At erklære en hændelse tilkalder den rigtige vagtrotation, tilføjer ejere, der får besked om hver ændring, starter runbooks og — hvis du vil — offentliggør udfaldet på din offentlige statusside, så kunderne holder op med at oprette sager for at spørge, om I allerede ved det.

Du kan erklære en hændelse i hånden klokken 3 om natten, eller lade en monitor erklære den for dig i det øjeblik, dens kriterier matcher. Uanset hvad er hændelsen det samme objekt, med den samme livscyklus og det samme papirspor til sidst.

## I et hurtigt overblik

- **Top-niveau funktion** — **Hændelser** i dashboardets venstre navigation, på `/dashboard/{projectId}/incidents`.
- **Tre forudoprettede tilstande** — **Identified**, **Bekræftet** og **Løst** oprettes for hvert nyt projekt. Du kan tilføje dine egne; de tre forudoprettede kan omdøbes og få nye farver, men aldrig slettes.
- **Tre forudoprettede alvorsgrader** — **Critical Incident**, **Major Incident** og **Minor Incident**. Alvorsgrad er en etiket med en farve og en rækkefølge — den bærer ingen adfærd i sig selv.
- **Fire veje ind** — guiden **Erklær hændelse**, **Opret fra skabelon**, en monitor-kriterieregel eller `POST /api/incident`.
- **Nummereret per projekt** — hver hændelse får et hændelsesnummer, vist som `#42` som standard eller med dit eget præfiks, som `INC-42`.
- **To slags noter** — private noter (interne noter) til dit team, offentlige noter til statussideabonnenter.
- **Indstillinger ligger under Hændelser, ikke Projektindstillinger** — tilstande, alvorsgrader, skabeloner, brugerdefinerede felter og regelmotorerne findes alle på **Hændelser → Indstillinger** og **Hændelser → Regler**.

## Nøglebegreber

En håndfuld ord dukker op på alle de andre sider i dette afsnit. Få styr på dem først.

| Begreb                 | Betydning                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hændelse**           | Selve registreringen — titel, beskrivelse, alvorsgrad, aktuel tilstand, berørte ressourcer og alt, hvad der skrives på den under responsen.          |
| **Hændelsestilstand**  | Hvor hændelsen er i sin livscyklus. En projektafgrænset række med et navn, en farve og `order`, plus de flag, der giver den betydning.              |
| **Hændelsesalvor**     | Hvor slemt det er. En projektafgrænset række med et navn, en farve og `order`. Rent en klassifikation — intet i produktet behandler én alvorsgrad særligt. |
| **Hændelsesnummer**    | En tæller per projekt vist som `#42`, eller med et præfiks, du konfigurerer, som `INC-42`.                                                          |
| **Berørte ressourcer** | De monitorer, værter, Kubernetes-klynger, Docker-værter, tjenester og anden infrastruktur, du knytter til hændelsen.                                |
| **Offentlig note**     | En opdatering skrevet til statussidens læsere og abonnenter. Den vises på statussidens tidslinje.                                                   |
| **Privat note**        | En intern note (modellen `IncidentInternalNote`) til responsteamet. Den når aldrig frem til en statusside.                                          |
| **Ejer**               | En bruger eller et team med ansvar for hændelsen. Ejere får besked, når den oprettes, når der skrives noter, og når tilstanden ændres.              |
| **Hændelsesfeed**      | Den tidslinje over aktivitet på hændelsens **Oversigt**, der kun kan tilføjes til, og som registrerer tilstandsændringer, noter, ejerændringer, regelkørsler og notifikationer. |
| **Tilstandstidslinje** | Registreringen af hvilken tilstand hændelsen var i, hvornår og hvor længe — med abonnentnotifikationsstatus for hver overgang.                      |

## De tre tilstande, OneUptime opretter for hvert projekt

Når et projekt oprettes, opretter OneUptime præcis tre hændelsestilstande, i denne rækkefølge:

| Tilstand         | Rækkefølge | Farve             | Betydning                                                                    |
| ---------------- | ---------- | ----------------- | ---------------------------------------------------------------------------- |
| **Identified**   | 1          | Rød (`#fd625e`)   | Den tilstand en helt ny hændelse lander i. Dette er den oprettede tilstand.  |
| **Bekræftet**    | 2          | Gul (`#ffbf53`)   | Nogen har taget hændelsen op og arbejder på den.                            |
| **Løst**         | 3          | Grøn (`#2ab57d`)  | Hændelsen er ovre. At løse den er det, der fjerner den fra din statusside.  |

Navnene er blot etiketter — det, der faktisk driver adfærden, er tre booleans på tilstandsrækken: `isCreatedState`, `isAcknowledgedState` og `isResolvedState`. Kun én tilstand per projekt forventes at bære hvert flag.

Den skelnen betyder mere, end den lyder til:

- `isCreatedState` bestemmer, hvor en ny hændelse starter. Hvis ingen tilstand udtrykkeligt vælges ved oprettelse, leder OneUptime efter projektets oprettede tilstand og bruger den.
- `isAcknowledgedState` og `isResolvedState` driver knapperne **Acknowledge** og **Løs** i hændelsens sidehoved, de to statistikfelter på hændelsens **Oversigt** og tællemærket **Aktive hændelser** i sidemenuen.
- **Aktive hændelser** er defineret rent som "den aktuelle tilstand er ikke den løste tilstand". Enhver brugerdefineret tilstand, du tilføjer, er derfor aktiv, medmindre den er den løste.

**Bemærk navngivningen.** Den første forudoprettede tilstand hedder **Identified**, selvom flere beskrivelser inde i produktet stadig kalder den den oprettede tilstand. Hvis du leder efter "Created" i dit projekts tilstandsliste, er det rækken ved navn **Identified**.

Du kan tilføje dine egne tilstande på **Hændelser → Indstillinger → Hændelsesstatus**. Nye tilstande føjes til slutningen af den ordnede liste, og du kan trække for at ændre rækkefølgen. De tre flagbærende tilstande kan ikke slettes — OneUptime blokerer det — men du kan omdøbe dem og give dem nye farver, hvilket er grunden til, at brugerfladen læser tilstandsnavne dynamisk.

Rækkefølge håndhæves, den er ikke kosmetisk: en hændelse kan ikke flytte til en tilstand, der ligger tidligere i rækkefølgen end dens nuværende.

Alle detaljer findes i [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).

## De tre alvorsgrader, OneUptime opretter for hvert projekt

Hvert nyt projekt får også tre alvorsgrader:

| Alvorsgrad            | Rækkefølge | Farve                | Betydning                                                        |
| --------------------- | ---------- | -------------------- | ---------------------------------------------------------------- |
| **Critical Incident** | 1          | Bordeaux (`#b70400`) | Meget høj kundepåvirkning, kræver øjeblikkelig respons.          |
| **Major Incident**    | 2          | Rød (`#fd625e`)      | Betydelig påvirkning, kræver normalt øjeblikkelig respons.       |
| **Minor Incident**    | 3          | Gul (`#ffbf53`)      | Lav påvirkning, håndteres normalt inden for arbejdstiden.        |

De fulde forudoprettede beskrivelser findes i [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).

Alvorsgrader har `name`, `description`, `color` og `order` og intet andet. Der er ingen flag, og ingen kodesti behandler "Critical Incident" anderledes end nogen anden række. Alvorsgrad er, hvordan mennesker triagerer, og den er tilgængelig som matchkriterium, når du skriver vagtregler — men at vælge en alvorsgrad tilkalder ikke i sig selv nogen.

Redigér eller tilføj alvorsgrader på **Hændelser → Indstillinger → Hændelsesalvor**.

## En hændelses liv

### 1. Den bliver erklæret

Fire veje fører til det samme objekt:

- **I hånden** — fra listen over hændelser klikker du **Erklær hændelse**. Det åbner guiden **Erklær ny hændelse**, fem trin lang: **Hændelsesdetaljer**, **Berørte ressourcer**, **Hændelsesroller**, **Vagt**, **Mere**.
- **Fra en skabelon** — klik **Opret fra skabelon** og vælg en gemt **Hændelse Skabelon**. Skabeloner forudfylder titel, beskrivelse, alvorsgrad, starttilstand, ressourcer, vagtpolitikker, ejere og etiketter.
- **Fra en monitor** — en monitor-kriterieregel med "erklær en hændelse"-kontakten slået til opretter hændelsen automatisk i det øjeblik, dens filtre matcher. Titler og beskrivelser dér understøtter `{{variable}}`-skabeloner.
- **Over API'et** — `POST /api/incident` med en API-nøgle. Serveren udfylder `declaredAt`, den oprettede tilstand og hændelsesnummeret for dig.

Se [Opret en hændelse](/docs/incidents/declaring-incidents) for gennemgangen felt for felt.

### 2. De rigtige mennesker finder ud af det

Ved oprettelse kører OneUptime den automatisering, du har konfigureret: etiketregler, vagtregler, ejerregler og runbook-regler. Alle vagtpolitikker knyttet til hændelsen — manuelt, fra en skabelon eller flettet ind af en matchende vagtregel — udføres parallelt.

Ejere får besked via e-mail, SMS, opkald, push og WhatsApp, afhængigt af hver brugers egne notifikationspræferencer. Hvis en hændelse slet ingen ejere har, falder notifikationen tilbage til projektejerne i stedet for at blive tabt.

Hvis hændelsen er synlig på en statusside, og abonnentnotifikationer er aktiveret, får abonnenterne det også at vide. Notifikationer er cron-drevne og kører hvert minut, så forvent op til cirka et minuts forsinkelse frem for øjeblikkelig afsendelse.

### 3. Dit team arbejder på den

Respondere bekræfter hændelsen, knytter berørte ressourcer til, kører runbooks, tildeler hændelsesroller og skriver ting ned, efterhånden som de finder ud af dem — private noter til teamet, offentlige noter til kunderne, plus siderne **Grundårsag** og **Afhjælpning**, når billedet bliver klarere. Alt, hvad de gør, lander i **Hændelse Feed** på siden **Oversigt**.

### 4. Den bliver løst

Et klik på **Løs** flytter hændelsen til den løste tilstand, stempler tilstandstidslinjen, stopper varighedsuret og fjerner hændelsen fra den aktive sektion på enhver statusside, den blev vist på. Intet andet skal ændres, for at det sker — flaget for den løste tilstand er det, statussidens forespørgsel kigger på.

Derefter kan du skrive en postmortem og eventuelt offentliggøre den på statussiden.

## Hvor hændelser bor i dashboardet

Åbn **Hændelser** i venstre navigation. Sidemenuen er organiseret i sektioner:

| Sektion            | Hvad du gør der                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Oversigt**       | **Alle hændelser** og **Aktive hændelser** — sidstnævnte bærer et rødt mærke med antallet af hændelser, der ikke er i den løste tilstand.                                  |
| **Episoder**       | Hændelsesepisoder, en separat grupperingsfunktion med sine egne sider.                                                                                                     |
| **AI**             | **Undersøgelse** og **Afhjælpning** — indstillinger for automatisk undersøgelse og auto-afhjælpning.                                                                       |
| **Arbejdsområde**  | **Slack**- og **Microsoft Teams**-forbindelser for hændelser.                                                                                                              |
| **Regler**         | Regelmotorerne: **Grupperingsregler**, **Vagtregler**, **Ejerregler**, **Runbook-regler**, **Privatlivsregler**, **Etiketregler**, **SLA-regler**, **Reminder Rules**.      |
| **Indstillinger**  | **Hændelsesstatus**, **Hændelsesalvor**, **Hændelsesskabeloner**, **Noteskabeloner**, **Postmortem-skabeloner**, **Brugerdefinerede felter**, **Hændelsesroller**, **Flere indstillinger**. |

**Regler** og **Indstillinger** er sammenklappet som standard — fold dem ud for at finde de sider, resten af denne dokumentation henviser til. Hændelseskonfiguration ligger ikke under Projektindstillinger; det hele bor her.

Selve listen over hændelser viser **Hændelsesnummer**, **Titel**, **Tilstand**, **Alvorlighed**, **Berørte ressourcer**, **Erklæret**, **Varighed**, **Etiketter** og **Ejere**, med en masse-handling **Skift tilstand** til at lukke flere på én gang.

## Hvad hver side på en hændelse viser

Åbn en hændelse, og du får en sidemenu til venstre, grupperet sådan her:

- **Oversigt** — kortet **Hændelsesdetaljer** (titel, alvorsgrad, etiketter, hændelsesnummer, erklæret den, erklæret af, vagtpolitikker), et kort med **Berørte ressourcer** og **Hændelse Feed**. Over dem statistikfelter for tid til bekræftelse, tid til løsning og samlet **Varighed**.
- **Tilstandstidslinje** — hver tilstand hændelsen har været i, med **Begynder den**, **Slutter den**, **Varighed** og abonnentnotifikationsstatus for hver overgang. **Vis årsag** og **Vis logge** forklarer, hvorfor hver ændring skete.
- **SLA** — SLA-sporing for denne hændelse.
- **Beskrivelse**, **Grundårsag**, **Afhjælpning** — tre markdown-sider. Beskrivelsen er den, der vises på din statusside.
- **Runbooks** — runbook-kørsler knyttet til denne hændelse.
- **Postmortem** — opsamlingen, som du eventuelt kan offentliggøre på statussiden.
- **Roller**, **Vagtudførelser**, **Ejere** — hvem der er på den, hvilke politikker der blev udløst, og hvem der får besked.
- **Notifikationslogs**, **AI-logs**, **Auditlogs** — hvad der blev sendt, og hvad der blev ændret.
- **Private noter** og **Offentlige noter** — under sektionen **Noter** i sidemenuen.
- **Brugerdefinerede felter**, **Indstillinger**, **Slet hændelse** — under **Avanceret**. Siden **Indstillinger** rummer **Synlig på statussiden**, **Privat hændelse** og kortet **Reminders**.

[Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) dækker samarbejdssiderne i dybden.

## Hvordan hændelser passer sammen med resten af OneUptime

- **Monitorer opdager problemet; hændelser registrerer det.** En monitor-kriterieregel kan erklære en hændelse automatisk og forudfylde titel, alvorsgrad, vagtpolitikker, ejere, etiketter og afhjælpningsnoter. Se [Hændelse- og advarselsskabeloner](/docs/monitor/incident-alert-templating) for de variabler, der er tilgængelige dér.
- **Vagtpolitikker står for tilkaldelsen.** Knyt politikker på trinnet **Vagt** i erklæringsguiden, på en skabelon eller gennem **Hændelser → Regler → Vagtregler**. Hver matchende regel udløses — det udførte sæt er foreningen af alle match plus alt, der er knyttet direkte, uden dubletter.
- **Runbooks fortæller folk, hvad de skal gøre.** Runbook-regler knytter automatisk en procedure, når en matchende hændelse oprettes, og respondere kan starte en i hånden fra hændelsen. Se [Runbooks – Oversigt](/docs/runbooks/index).
- **Statussider fortæller kunderne det.** En hændelse vises på en statussides aktive liste, når siden har hændelser aktiveret, hændelsen er markeret som synlig på statussiden, og dens aktuelle tilstand ikke er den løste tilstand. Private hændelser er altid skjult fra alle statussider. Se [Statussider – Oversigt](/docs/status-pages/index).
- **Workflows automatiserer omkring den.** Triggerne **On Create Incident**, **On Update Incident** og **On Delete Incident** lader dig bygge no-code-automatisering oven på hændelsens livscyklus. Se [Workflows – Oversigt](/docs/workflows/index).

## Læs videre

- [Opret en hændelse](/docs/incidents/declaring-incidents) — guiden, skabelonerne, monitor-kriterierne og API'et.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — tilstandsflagene, brugerdefinerede tilstande og alvorsklassifikation.
- [Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) — offentlige og private noter, ejere og aktivitetsfeedet.
- [Hændelsesindstillinger og automatisering](/docs/incidents/settings) — skabeloner, brugerdefinerede felter, nummerpræfikser og regelmotorerne.
- [Statussider – Oversigt](/docs/status-pages/index) — hvordan hændelser når frem til dine kunder.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — hvem der får besked, når en hændelse flytter sig.
