# Indstillinger og automatisering

Hændelseskonfiguration bor ikke i Projektindstillinger. Den bor inde i selve hændelsesområdet, under **Hændelser → Indstillinger** og **Hændelser → Regler**, på ruter der begynder med `/dashboard/{projectId}/incidents/settings/`. Hvis du har ledt igennem **Projektindstillinger** efter hændelsesskabeloner eller brugerdefinerede felter, er det derfor, du ikke kunne finde dem.

Både sektionen **Regler** og sektionen **Indstillinger** i hændelsernes sidemenu er sammenklappet som standard, så du skal folde dem ud, før punkterne nedenfor dukker op. Alt her er projektafgrænset: skabeloner, roller, brugerdefinerede felter og regler hører til ét projekt og gælder for hver hændelse, der erklæres i det.

Denne side er referencen for den konfiguration — hvad hver side rummer, og hvilken del af den der kører automatisk i det øjeblik, en hændelse oprettes.

## Hvor hændelsesindstillinger bor

Åbn **Hændelser** i venstre navigation, og fold derefter **Indstillinger** ud nederst i sidemenuen.

| Side                            | Hvad du gør der                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Hændelsesstatus**             | Tilføj, omdøb, giv nye farver og omarrangér de tilstande, en hændelse bevæger sig igennem.             |
| **Hændelsesalvor**              | Tilføj, omdøb, giv nye farver og omarrangér alvorsniveauer.                                            |
| **Hændelsesskabeloner**         | Forudfyld en hel hændelse — titel, beskrivelse, ressourcer, vagtpolitikker, ejere, etiketter.          |
| **Noteskabeloner**              | Genbrugelig tekst til offentlige og private noter.                                                     |
| **Postmortem-skabeloner**       | Genbrugelige postmortem-strukturer.                                                                    |
| **Brugerdefinerede felter**     | Definér ekstra felter, der optræder på hver hændelse.                                                  |
| **Hændelsesroller**             | Definér de roller, du tildeler respondere til, såsom Hændelsesleder.                                   |
| **Flere indstillinger**         | Nummerpræfikserne for hændelser og hændelsesepisoder.                                                  |

**Hændelsesstatus** og **Hændelsesalvor** er dækket i dybden i [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — resten af denne side tager over fra **Hændelsesskabeloner**.

Fold **Regler** ud, og du får otte sider mere: **Grupperingsregler**, **Vagtregler**, **Ejerregler**, **Runbook-regler**, **Privatlivsregler**, **Etiketregler**, **SLA-regler** og **Reminder Rules**. Dem dækker vi længere nede.

## Hændelsesskabeloner

En hændelsesskabelon er et gemt skelet af en hændelse. I stedet for at taste den samme titel, den samme monitorliste og den samme vagtpolitik ind hver gang betalingsklyngen vakler, gemmer du det én gang og erklærer ud fra det.

Gå til **Hændelser → Indstillinger → Hændelsesskabeloner** (`/dashboard/{projectId}/incidents/settings/templates`). Kortet hedder **Hændelsesskabeloner**. At oprette en fører dig gennem en sekstrins-guide:

- **Skabeloninformation** — **Skabelonnavn** og **Skabelonbeskrivelse**. Disse navngiver selve skabelonen; de optræder aldrig på hændelsen.
- **Hændelsesdetaljer** — **Titel**, **Beskrivelse** (Markdown), **Hændelsesalvor** og **Indledende hændelsestilstand**. **Indledende hændelsestilstand** er valgfri og starter tom; dens muligheder er listet i tilstandsrækkefølge. Lad den stå tom, og hændelser fra denne skabelon lander i projektets oprettede tilstand.
- **Berørte ressourcer** — de monitorer, værter, klynger og tjenester, hændelsen skal knyttes til, plus **Skift overvågningsstatus til**.
- **Vagt** — **Vagtpolitik**, de politikker der skal udføres, når en hændelse oprettet fra denne skabelon erklæres.
- **Ejere** — **Ejer - Teams** og **Ejer - Brugere**.
- **Etiketter** — **Etiketter**.

Et par hurtige regler:

- Skabelonlisten viser kun **Navn** og **Beskrivelse**. Rækker kan ikke redigeres eller slettes fra listen — åbn en skabelon (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) for at ændre den.
- Skabeloner understøtter JSON-import og -eksport, så du kan flytte en mellem projekter.
- Tomtilstanden lyder "No incident templates found."

### Hvordan en skabelon anvendes

Der er to veje, og de opfører sig ens.

- **Fra dashboardet** — knappen **Opret fra skabelon** på listen over hændelser åbner en vælger **Vælg hændelsesskabelon**, og erklæringssiden læser skabelonen fra query string-parameteren `incidentTemplateId` og forudfylder derefter formularen med skabelonen plus dens ejerteams og ejerbrugere.
- **Fra API'et** — send `createdIncidentTemplateId` på `POST /api/incident`, og serveren udfylder hændelsen fra skabelonen.

Det vigtige er flettereglen: **en skabelon udfylder kun et felt, du lod stå udefineret**. Titel, beskrivelse, hændelsesalvor, indledende hændelsestilstand, monitorstatussen bag **Skift overvågningsstatus til**, monitorer, værter, Kubernetes-klynger, Docker-værter, Podman-værter, tjenester, vagtpolitikker og etiketter kopieres kun fra skabelonen, når kalderen eller formularen ikke leverede noget. Alt, du sætter udtrykkeligt, vinder altid.

**Dialogen ved tom tilstand peger det forkerte sted hen.** Hvis du endnu ikke har skabeloner, viser knappen **Opret fra skabelon** en dialog **No Incident Templates**. Dens tekst peger på Projektindstillinger, men knappen ruter til **Hændelser → Indstillinger → Hændelsesskabeloner** — det er den rigtige placering.

## Noteskabeloner

Noteskabeloner giver respondere færdig tekst til hændelsesopdateringer, så en statussideopdatering klokken 3 om natten ikke skrives fra bunden af en, der er halvt vågen.

Gå til **Hændelser → Indstillinger → Noteskabeloner** (`/dashboard/{projectId}/incidents/settings/note-templates`). Kortet hedder **Skabeloner til offentlige eller private noter for hændelser** — ét bibliotek betjener begge notetyper. Oprettelsesformularen har to trin:

- **Skabeloninformation** — **Skabelonnavn** og **Skabelonbeskrivelse**, begge påkrævede.
- **Notedetaljer** — selve notens brødtekst, i Markdown, påkrævet.

Ligesom hændelsesskabeloner oprettes og vises rækker frem for at blive redigeret inline; åbn en skabelon for at ændre den.

Noteskabeloner dukker op, hvor du faktisk har brug for dem: bekræftelsesdialogerne **Acknowledge Incident** og **Resolve Incident** tilbyder begge **Vælg noteskabelon** ved siden af feltet **Offentlig note**. Se [Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) for hvordan offentlige og private noter adskiller sig.

## Postmortem-skabeloner

En postmortem-skabelon er skelettet af den opsamling, du producerer efter en hændelse — dine overskrifter, dine spørgsmål, dine faste punkter — så hver gennemgang i projektet følger den samme form.

Gå til **Hændelser → Indstillinger → Postmortem-skabeloner** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). Kortet hedder **Postmortem-skabeloner**. Oprettelsesformularen har to trin:

- **Skabeloninformation** — **Skabelonnavn** og **Skabelonbeskrivelse**, begge påkrævede.
- **Postmortem-detaljer** — **Postmortem-skabelon**, selve brødteksten, i Markdown, påkrævet.

Du anvender en fra hændelsen, ikke fra indstillingerne. Åbn en hændelse, vælg **Postmortem** i dens sidemenu (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`), og brug **Anvend skabelon**. Det åbner en dialog **Anvend postmortem-skabelon** med en rullemenu **Vælg skabelon**; at vælge en indlæser skabelonens brødtekst i editoren **Postmortem-note**, hvor du redigerer den, før du gemmer. Hændelsesepisoder har den samme **Postmortem**-side og trækker på det samme skabelonbibliotek.

## Brugerdefinerede felter

Brugerdefinerede felter lader dig bære dine egne metadata på hver hændelse — et internt tjenestenavn, en reference til en ændringssag, et kundeniveau.

Gå til **Hændelser → Indstillinger → Brugerdefinerede felter** (`/dashboard/{projectId}/incidents/settings/custom-fields`). Siden hedder **Brugerdefinerede hændelsesfelter**. Hver definition har:

- **Feltnavn** — påkrævet, mindst to tegn. Pladsholderen foreslår et slug-agtigt navn såsom `internal-service`.
- **Feltbeskrivelse** — valgfri.
- **Felttype** — påkrævet. Dette vælger, hvordan data indtastes. Rullemenutyper kræver også, at deres muligheder listes.
- **Rullemenuindstillinger** — de værdier, der optræder i rullemenuen, hver med en valgfri farve.

Definitionerne bor i deres egen model; værdierne bor på selve hændelsen i kolonnen `customFields`. På en enkelt hændelse udfylder du dem fra **Brugerdefinerede felter** i hændelsens sidemenu (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Ét hul værd at kende.** Definitioner af brugerdefinerede hændelsesfelter er den eneste del af hændelsesfamilien uden workflow-triggere — se workflow-afsnittet nedenfor.

## Hændelsesroller

Hændelsesroller er de navngivne opgaver, du tildeler folk under en respons. Definér dem på **Hændelser → Indstillinger → Hændelsesroller** (`/dashboard/{projectId}/incidents/settings/roles`); kortets beskrivelse giver Hændelsesleder og Responder som eksempler.

Roller er kun definitioner. Du tildeler folk til dem per hændelse — erklæringsguiden har et trin **Hændelsesroller** med et felt **Tildel hændelsesroller**, og hver hændelse har en side **Roller** i sin sidemenu.

## Nummerpræfikser

Hver hændelse får et nummer. Som standard vises det som `#42`. Hvis dit team siger "INC-42" højt, så få produktet til at sige det samme.

Gå til **Hændelser → Indstillinger → Flere indstillinger** (`/dashboard/{projectId}/incidents/settings/more`). Kortet er **Talpræfiks** og rummer to felter på projektet:

- **Nummerpræfiks for hændelse** — op til 20 tegn, pladsholder `INC-`. Sæt det, og hændelse `#42` vises som `INC-42`.
- **Nummerpræfiks for hændelsesepisode** — samme idé for numre på hændelsesepisoder, pladsholder `IE-`.

Lad et af dem stå tomt for at beholde standardpræfikset `#`; det tomme felt viser `# (default)`. Gem med **Opdater**. Den præfiksede værdi gemmes på hændelsen som `incidentNumberWithPrefix`, som er det, listen over hændelser og hændelsens sidehoved viser.

## Regler, der kører når en hændelse oprettes

**Hændelser → Regler** rummer otte regelmotorer. De gør alle det samme job — kigger på en hændelse i det øjeblik, den oprettes, og handler, hvis den matcher — men de adskiller sig i, hvad de gør, og i hvordan flere matchende regler afgøres.

- **Grupperingsregler** — grupperer relaterede hændelser i episoder. Regler evalueres i prioritetsrækkefølge; lavere prioritetsnumre kommer først.
- **Vagtregler** — udfører vagtpolitikker for matchende hændelser. Dækket i detaljer nedenfor.
- **Ejerregler** — tildeler ejere automatisk.
- **Runbook-regler** — starter et [runbook](/docs/runbooks/index), når en hændelse matcher.
- **Privatlivsregler** — afgør, om en matchende hændelse er privat.
- **Etiketregler** — anvender etiketter automatisk.
- **SLA-regler** — sporer responstider og løsningstider. Regler evalueres i rækkefølge; lavere rækkefølgenumre kommer først.
- **Reminder Rules** — minder periodisk hændelsens ejere om den, mens en hændelse stadig er åben. Regler evalueres i rækkefølge, og den første matchende regel vinder.

**Rækkefølgesemantikken er ikke ensartet.** Grupperingsregler, SLA-regler og Reminder Rules evalueres i rækkefølge. Vagtregler gør ikke — hver matchende regel udløses. Gå ikke ud fra, at én model gælder for alle otte.

Siderne **Vagtregler**, **Ejerregler**, **Etiketregler** og **Privatlivsregler** har faner — en fane **Incident Rules** og en fane **Episode Rules**, hver med sin egen tabel. Konfigurér fanen **Incident Rules**, medmindre du specifikt mener episoder. **Grupperingsregler**, **Runbook-regler**, **SLA-regler** og **Reminder Rules** er enkelttabeller.

## Vagtregler for hændelser

**Hændelser → Regler → Vagtregler** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) er dér, hvor du gør tilkaldelse automatisk. Kortet, **Hændelsesvagtregler**, beskriver regler, der automatisk udfører vagtpolitikker, når matchende hændelser oprettes. Siden har to faner: **Incident Rules** og **Episode Rules**.

Oprettelsesformularen har tre trin:

- **Grundlæggende oplysninger** — **Navn** (pladsholderen foreslår noget i stil med at tilkalde databaseteamet ved enhver DB-hændelse), **Beskrivelse** og en kontakt **Aktiveret**. Listen viser en grøn **Aktiveret**- eller rød **Deaktiveret**-pille per regel.
- **Matchkriterier** — **Monitorer**, **Hændelse Alvorligheder**, **Hændelsesetiketter**, **Overvågningsetiketter**, plus felter til regulære udtryk uden forskel på store og små bogstaver for hændelsens titel, hændelsens beskrivelse, monitorens navn og monitorens beskrivelse.
- **Vagtpolitikker** — de politikker, denne regel udfører.

### Hvordan matchning afgøres

De regler, siden selv leveres med, er værd at få ind under huden:

- En regel matcher kun, når **alle** de kriterier, du har udfyldt, går igennem. Kriterier, du lod stå tomme, springes over, ikke fejles.
- Inden for et enkelt listekriterium — **Monitorer**, **Hændelse Alvorligheder**, **Hændelsesetiketter**, **Overvågningsetiketter** — er matchning "en hvilken som helst af".
- Mønsterfelterne er regulære udtryk uden forskel på store og små bogstaver.
- **Alle matchende regler udløses.** Der er ingen prioritet og ingen kortslutning.
- Det sæt af politikker, der faktisk udføres, er foreningen af hver matchende regels politikker plus eventuelle politikker knyttet til hændelsen manuelt eller af en skabelon, renset for dubletter så hver politik kører højst én gang.

Alvorsgrad er et matchkriterium her og ingen andre steder. Der er intet vagtfelt på en hændelsesalvorsgrad — at vælge "Critical Incident" tilkalder ikke i sig selv nogen. Hvis du vil have alvorsgrad til at drive tilkaldelse, så skriv en vagtregel, der matcher på den.

## At knytte vagtpolitikker direkte

Regler er ikke den eneste vej. Hver hændelse bærer sin egen liste over vagtpolitikker, som vises som feltet **Vagtpolitik** på trinnet **Vagt** i erklæringsguiden og på trinnet **Vagt** i en hændelsesskabelon. Feltets beskrivelse siger det lige ud: dette er de vagtpolitikker, der skal udføres, når denne hændelse oprettes.

Når en hændelse oprettes, kører OneUptime etiketregler, derefter vagtregler (som fletter deres matchende politikker ind i hændelsens liste), derefter runbook-regler — og hvis den resulterende liste ikke er tom, udføres hver politik i den. Udførelser kører parallelt og afgøres uafhængigt, så at én politik fejler, stopper ikke de andre. Hver udførelse mærkes med den hændelse, der udløste den, og med notifikationshændelsestypen for hændelse oprettet.

For at se, hvad der skete, skal du åbne hændelsen og vælge **Vagtudførelser** i dens sidemenu (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## At drive hændelser fra workflows

Workflow-triggere til hændelser er ikke håndskrevne — OneUptime genererer dem ud fra datamodellerne, så hver model i hændelsesfamilien får komponenterne **On Create X**, **On Update X** og **On Delete X**, navngivet efter modellens ental. De tre vigtigste er **On Create Incident**, **On Update Incident** og **On Delete Incident**, og de bor i kategorien **Incident** i panelet **Tilføj komponent** på `/dashboard/{projectId}/workflows`.

Den samme generering giver dig triggere til selve konfigurationen: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** med flere. Hver model får også tilsvarende handlingskomponenter — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** og deres flerrækkes-modstykker — så en trigger og en handling med lignende navne ligger side om side i samme kategori. **On Create Incident** starter et workflow; **Create One Incident** åbner en hændelse.

Et par detaljer, der betyder noget, når du kobler disse sammen:

- **On Update X** tager et valgfrit argument **Listen on**, der indsnævrer triggeren til opdateringer, som rører bestemte felter. Lad det stå tomt for at udløse ved enhver ændring. Hvis en opdatering ankommer uden en registrering af, hvilke felter der flyttede sig, springes filteret over, og workflowet kører alligevel.
- **On Create X** og **On Update X** tager begge et påkrævet argument **Select Fields**; **On Delete X** tager ingen argumenter.
- Alle tre eksponerer en enkelt udgangsport **Succes**, og hver accepterer et ID-argument, så du kan køre workflowet i hånden mod én registrering.
- Navnene kommer fra modellens entalsnavn, ikke fra dens tabelnavn — hvilket er grunden til, at du ser **On Create Incident Team Owner** og **On Create Incident User Owner** frem for tabelformede navne.
- Der er ingen triggere til definitioner af brugerdefinerede hændelsesfelter. Den model er det ene medlem af hændelsesfamilien med workflows deaktiveret.

For at bygge resten af workflowet, se [Opret et workflow](/docs/workflows/authoring) og [Variabler](/docs/workflows/variables).

## Læs videre

- [Hændelser – Oversigt](/docs/incidents/index) — hvordan hændelsesfunktionen hænger sammen.
- [Opret en hændelse](/docs/incidents/declaring-incidents) — erklæringsguiden, skabelonerne og API'et.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — indstillingssiderne for tilstand og alvorsgrad, og hvad flagene gør.
- [Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) — hvor noteskabeloner bliver brugt.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — hvem der hører om en hændelse uden for dit team.
- [Workflows – Oversigt](/docs/workflows/index) — at automatisere oven på hændelses-triggere.
- [Runbooks – Oversigt](/docs/runbooks/index) — de procedurer, runbook-regler knytter.
