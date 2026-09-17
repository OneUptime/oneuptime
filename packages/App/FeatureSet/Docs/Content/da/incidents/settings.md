# Indstillinger og automatisering

Hændelseskonfiguration bor ikke i Projektindstillinger. Den bor inde i selve Hændelser-produktområdet, under **Hændelser → Indstillinger** og **Hændelser → Regler**, på ruter der begynder med `/dashboard/{projectId}/incidents/settings/`. Hvis du har finkæmmet **Projektindstillinger** efter hændelsesskabeloner eller brugerdefinerede felter, er det derfor, du ikke kunne finde dem.

Både **Regler**- og **Indstillinger**-sektionen i hændelsernes sidemenu er sammenklappet som standard, så du skal folde dem ud, før punkterne nedenfor dukker op. Alt her er projektafgrænset: skabeloner, roller, brugerdefinerede felter og regler hører til ét projekt og gælder for hver eneste hændelse, der erklæres i det.

Denne side er referencen for den konfiguration — hvad hver side rummer, og hvad af det der kører af sig selv i det øjeblik, en hændelse oprettes.

## Hvor hændelsesindstillinger bor

Åbn **Hændelser** i venstre navigation, og fold så **Indstillinger** ud nederst i sidemenuen.

| Side                     | Hvad du gør der                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Hændelsesstatus**      | Tilføj, omdøb, giv nye farver og omarranger de tilstande, en hændelse bevæger sig igennem.                  |
| **Hændelsesalvor**       | Tilføj, omdøb, giv nye farver og omarranger alvorsgrader.                                                   |
| **Hændelsesskabeloner**  | Udfyld en hel hændelse på forhånd — titel, beskrivelse, ressourcer, vagtpolitikker, ejere, etiketter.       |
| **Noteskabeloner**       | Genbrugelig tekst til offentlige og private noter.                                                          |
| **Postmortem-skabeloner** | Genbrugelige postmortem-strukturer.                                                                        |
| **Brugerdefinerede felter** | Definér ekstra felter, der vises på hver eneste hændelse.                                                |
| **Hændelsesroller**      | Definér de roller, du sætter folk på, for eksempel Incident Commander.                                      |
| **Flere indstillinger**  | Nummerpræfikserne for hændelser og hændelsesepisoder.                                                       |

**Hændelsesstatus** og **Hændelsesalvor** er gennemgået i dybden på [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — resten af denne side tager over fra **Hændelsesskabeloner**.

Fold **Regler** ud, og du får otte sider mere: **Grupperingsregler**, **Vagtregler**, **Ejerregler**, **Runbook-regler**, **Privatlivsregler**, **Etiketregler**, **SLA-regler** og **Reminder Rules**. Dem tager vi længere nede.

## Hændelsesskabeloner

En hændelsesskabelon er et gemt skelet af en hændelse. I stedet for at taste den samme titel, den samme monitorliste og den samme vagtpolitik ind hver gang betalingsklyngen vakler, gemmer du det én gang og erklærer ud fra det.

Gå til **Hændelser → Indstillinger → Hændelsesskabeloner** (`/dashboard/{projectId}/incidents/settings/templates`). Kortet hedder **Hændelsesskabeloner**. At oprette én fører dig gennem en guide på seks trin:

- **Skabeloninformation** — **Skabelonnavn** og **Skabelonbeskrivelse**. De navngiver selve skabelonen; de havner aldrig på hændelsen.
- **Hændelsesdetaljer** — **Titel**, **Beskrivelse** (Markdown), **Hændelsesalvor** og **Indledende hændelsestilstand**. **Indledende hændelsestilstand** er valgfri og starter tom; mulighederne står i tilstandsrækkefølge. Lad den stå tom, og hændelser fra denne skabelon lander i projektets oprettede tilstand.
- **Berørte ressourcer** — de monitorer, hosts, klynger og tjenester, hændelsen skal knyttes til, plus **Skift overvågningsstatus til**.
- **Vagt** — **Vagtpolitik**, altså de politikker der skal udføres, når en hændelse oprettet fra denne skabelon erklæres.
- **Ejere** — **Ejer - Teams** og **Ejer - Brugere**.
- **Etiketter** — **Etiketter**.

Et par hurtige regler:

- Skabelonlisten viser kun **Navn** og **Beskrivelse**. Rækker kan hverken redigeres eller slettes fra listen — åbn en skabelon (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) for at ændre den.
- Skabeloner understøtter JSON-import og -eksport, så du kan flytte en fra ét projekt til et andet.
- Tomme-tilstanden lyder "Ingen hændelsesskabeloner fundet."

### Sådan bliver en skabelon anvendt

Der er to veje, og de opfører sig ens.

- **Fra dashboardet** — knappen **Opret fra skabelon** på listen over hændelser åbner vælgeren **Vælg hændelsesskabelon**, og erklæringssiden læser skabelonen fra forespørgselsparameteren `incidentTemplateId` og udfylder så formularen på forhånd med skabelonen plus dens ejer-teams og ejer-brugere.
- **Fra API'et** — send `createdIncidentTemplateId` med i `POST /api/incident`, så udfylder serveren hændelsen fra skabelonen.

Det vigtige er sammenfletningsreglen: **en skabelon udfylder kun et felt, du har ladet være udefineret**. Titel, beskrivelse, hændelsesalvor, indledende hændelsestilstand, monitorstatussen bag **Skift overvågningsstatus til**, monitorer, hosts, Kubernetes-klynger, Docker-hosts, Podman-hosts, tjenester, vagtpolitikker og etiketter kopieres kun fra skabelonen, når kalderen eller formularen ikke har angivet noget. Det, du sætter udtrykkeligt, vinder altid.

**Dialogen i tomme-tilstanden peger det forkerte sted hen.** Har du ingen skabeloner endnu, viser knappen **Opret fra skabelon** en **No Incident Templates**-dialog. Teksten peger på Projektindstillinger, men knappen ruter til **Hændelser → Indstillinger → Hændelsesskabeloner** — det er den rigtige placering.

## Noteskabeloner

Noteskabeloner giver beredskabsfolkene færdig tekst til hændelsesopdateringer, så en statussideopdatering klokken tre om natten ikke skal skrives fra bunden af en, der er halvvågen.

Gå til **Hændelser → Indstillinger → Noteskabeloner** (`/dashboard/{projectId}/incidents/settings/note-templates`). Kortet hedder **Skabeloner til offentlige eller private noter for hændelser** — ét bibliotek dækker begge notetyper. Opret-formularen har to trin:

- **Skabeloninformation** — **Skabelonnavn** og **Skabelonbeskrivelse**, begge påkrævede.
- **Notedetaljer** — selve noteteksten, i Markdown, påkrævet.

Som med hændelsesskabeloner oprettes og åbnes rækker frem for at blive redigeret på listen; åbn en skabelon for at ændre den.

Noteskabeloner dukker op dér, hvor du reelt har brug for dem: bekræftelsesdialogerne **Acknowledge Incident** og **Resolve Incident** tilbyder begge **Vælg noteskabelon** ved siden af feltet **Offentlig note**. Se [Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) for forskellen på offentlige og private noter.

## Postmortem-skabeloner

En postmortem-skabelon er skelettet til den evaluering, du skriver efter en hændelse — dine overskrifter, dine spørgsmål, dine faste punkter — så hver gennemgang i projektet har den samme form.

Gå til **Hændelser → Indstillinger → Postmortem-skabeloner** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). Kortet hedder **Postmortem-skabeloner**. Opret-formularen har to trin:

- **Skabeloninformation** — **Skabelonnavn** og **Skabelonbeskrivelse**, begge påkrævede.
- **Postmortem-detaljer** — **Postmortem-skabelon**, altså selve teksten, i Markdown, påkrævet.

Du anvender en skabelon fra hændelsen, ikke fra indstillingerne. Åbn en hændelse, vælg **Postmortem** i dens sidemenu (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`), og brug **Anvend skabelon**. Det åbner dialogen **Anvend postmortem-skabelon** med en **Vælg skabelon**-rulleliste; vælger du en, indlæses skabelonteksten i editoren **Postmortem-note**, hvor du redigerer den, før du gemmer. Hændelsesepisoder har den samme **Postmortem**-side og trækker på det samme skabelonbibliotek.

## Brugerdefinerede felter

Brugerdefinerede felter lader dig bære dine egne metadata på hver eneste hændelse — et internt tjenestenavn, en reference til en ændringssag, et kundeniveau.

Gå til **Hændelser → Indstillinger → Brugerdefinerede felter** (`/dashboard/{projectId}/incidents/settings/custom-fields`). Siden hedder **Brugerdefinerede hændelsesfelter**. Hver definition har:

- **Feltnavn** — påkrævet, mindst to tegn. Pladsholderen foreslår et slug-agtigt navn som `internal-service`.
- **Feltbeskrivelse** — valgfri.
- **Felttype** — påkrævet. Den afgør, hvordan data indtastes. Rullelistetyper skal desuden have deres muligheder listet.
- **Rullemenuindstillinger** — de værdier, der vises i rullelisten, hver med en valgfri farve.

Definitionerne bor i deres egen model; værdierne bor på selve hændelsen i kolonnen `customFields`. På en enkelt hændelse udfylder du dem fra **Brugerdefinerede felter** i hændelsens sidemenu (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Ét hul, du bør kende.** Definitioner af brugerdefinerede hændelsesfelter er den eneste del af hændelsesfamilien uden workflow-triggere — se workflow-afsnittet nedenfor.

## Hændelsesroller

Hændelsesroller er de navngivne opgaver, du sætter folk på under en indsats. Definér dem under **Hændelser → Indstillinger → Hændelsesroller** (`/dashboard/{projectId}/incidents/settings/roles`); kortets beskrivelse nævner Incident Commander og Responder som eksempler.

Roller er kun definitioner. Du sætter folk på dem per hændelse — erklæringsguiden har et **Hændelsesroller**-trin med feltet **Tildel hændelsesroller**, og hver hændelse har en **Roller**-side i sin sidemenu.

## Nummerpræfikser

Hver hændelse får et nummer. Som standard vises det som `#42`. Hvis dit team siger "INC-42" højt, så få produktet til at sige det samme.

Gå til **Hændelser → Indstillinger → Flere indstillinger** (`/dashboard/{projectId}/incidents/settings/more`). Kortet hedder **Talpræfiks** og rummer to felter på projektet:

- **Nummerpræfiks for hændelse** — op til 20 tegn, pladsholder `INC-`. Sæt det, og hændelse `#42` vises som `INC-42`.
- **Nummerpræfiks for hændelsesepisode** — samme idé for numre på hændelsesepisoder, pladsholder `IE-`.

Lad et af felterne stå tomt for at beholde standardpræfikset `#`; det tomme felt viser `# (default)`. Gem med **Opdater**. Den præfiksede værdi gemmes på hændelsen som `incidentNumberWithPrefix`, og det er den, listen over hændelser og hændelsens sidehoved viser.

## Regler, der kører når en hændelse oprettes

**Hændelser → Regler** rummer otte regelmotorer. De laver alle det samme stykke arbejde — kigger på en hændelse i det øjeblik den oprettes, og handler hvis den matcher — men de er forskellige i, hvad de gør, og i hvordan flere matchende regler afgøres.

- **Grupperingsregler** — grupperer beslægtede hændelser i episoder. Regler evalueres i prioritetsrækkefølge; lave prioritetsnumre kommer først.
- **Vagtregler** — udfører vagtpolitikker for matchende hændelser. Gennemgået i detaljer nedenfor.
- **Ejerregler** — tildeler ejere automatisk.
- **Runbook-regler** — starter et [runbook](/docs/runbooks/index), når en hændelse matcher.
- **Privatlivsregler** — afgør, om en matchende hændelse er privat.
- **Etiketregler** — sætter etiketter på automatisk.
- **SLA-regler** — sporer svar- og løsningstider. Regler evalueres i rækkefølge; lave rækkefølgenumre kommer først.
- **Reminder Rules** — minder med jævne mellemrum hændelsens ejere om den, så længe den stadig er åben. Regler evalueres i rækkefølge, og den første regel, der matcher, vinder.

**Rækkefølgesemantikken er ikke ens overalt.** Grupperingsregler, SLA-regler og Reminder Rules evalueres i rækkefølge. Vagtregler gør ikke — hver regel, der matcher, udløses. Gå ikke ud fra, at én model gælder for alle otte.

Siderne **Vagtregler**, **Ejerregler**, **Etiketregler** og **Privatlivsregler** har faner — en **Incident Rules**-fane og en **Episode Rules**-fane, hver med sin egen tabel. Konfigurér **Incident Rules**-fanen, medmindre du udtrykkeligt mener episoder. **Grupperingsregler**, **Runbook-regler**, **SLA-regler** og **Reminder Rules** er enkeltstående tabeller.

## Vagtregler for hændelser

**Hændelser → Regler → Vagtregler** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) er dér, du gør tilkaldelse automatisk. Kortet **Hændelsesvagtregler** beskriver regler, der automatisk udfører vagtpolitikker, når matchende hændelser oprettes. Siden har to faner: **Incident Rules** og **Episode Rules**.

Opret-formularen har tre trin:

- **Grundlæggende oplysninger** — **Navn** (pladsholderen foreslår noget i retning af at tilkalde databaseteamet ved enhver DB-hændelse), **Beskrivelse** og en **Aktiveret**-kontakt. Listen viser en grøn **Aktiveret**- eller rød **Deaktiveret**-plakat per regel.
- **Matchkriterier** — **Monitorer**, **Hændelse Alvorligheder**, **Hændelsesetiketter**, **Overvågningsetiketter** samt felter til regulære udtryk uden forskel på store og små bogstaver for hændelsens titel, hændelsens beskrivelse, monitorens navn og monitorens beskrivelse.
- **Vagtpolitikker** — de politikker, denne regel udfører.

### Sådan afgøres et match

De regler, siden selv leverer, er værd at have på rygraden:

- En regel matcher kun, når **alle** de kriterier, du har udfyldt, går igennem. Kriterier, du har ladet være tomme, springes over — de fejler ikke.
- Inden for ét enkelt listekriterium — **Monitorer**, **Hændelse Alvorligheder**, **Hændelsesetiketter**, **Overvågningsetiketter** — er matchning et hvilket-som-helst-af.
- Mønsterfelterne er regulære udtryk uden forskel på store og små bogstaver.
- **Alle regler, der matcher, udløses.** Der er hverken prioritet eller kortslutning.
- Det sæt af politikker, der reelt udføres, er foreningsmængden af alle matchende reglers politikker plus de politikker, der er knyttet til hændelsen i hånden eller af en skabelon, uden dubletter, så hver politik kører højst én gang.

Alvorsgrad er et matchkriterium her og ingen andre steder. Der er ikke noget vagtfelt på en hændelsesalvorsgrad — at vælge "Critical Incident" tilkalder ikke i sig selv nogen. Vil du have alvorsgrad til at drive tilkaldelse, så skriv en vagtregel, der matcher på den.

## At knytte vagtpolitikker direkte

Regler er ikke den eneste vej. Hver hændelse bærer sin egen liste af vagtpolitikker, som vises som feltet **Vagtpolitik** på **Vagt**-trinnet i erklæringsguiden og på **Vagt**-trinnet i en hændelsesskabelon. Feltets beskrivelse siger det rent ud: det er de vagtpolitikker, der skal udføres, når denne hændelse oprettes.

Når en hændelse oprettes, kører OneUptime etiketregler, så vagtregler (som fletter deres matchende politikker ind i hændelsens liste) og så runbook-regler — og er den resulterende liste ikke tom, udføres hver politik i den. Udførelserne kører parallelt og afgøres uafhængigt af hinanden, så at én politik fejler, stopper ikke de andre. Hver udførelse mærkes med den hændelse, der udløste den, og med notifikationsbegivenhedstypen for oprettet hændelse.

For at se, hvad der skete, åbner du hændelsen og vælger **Vagtudførelser** i dens sidemenu (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## At drive hændelser fra workflows

Workflow-triggere for hændelser er ikke håndskrevne — OneUptime genererer dem ud fra datamodellerne, så hver model i hændelsesfamilien får komponenterne **On Create X**, **On Update X** og **On Delete X**, navngivet efter modellens navn i ental. De tre vigtigste er **On Create Incident**, **On Update Incident** og **On Delete Incident**, og du finder dem under kategorien **Hændelse** i panelet **Tilføj komponent** på `/dashboard/{projectId}/workflows`.

Den samme generering giver dig triggere til selve konfigurationen: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** med flere. Hver model får også tilsvarende handlingskomponenter — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** og deres flerrækkede modstykker — så en trigger og en handling med lignende navne står side om side i den samme kategori. **On Create Incident** starter et workflow; **Create One Incident** opretter en hændelse.

Et par detaljer, der betyder noget, når du kobler det hele sammen:

- **On Update X** tager et valgfrit **Listen on**-argument, der indsnævrer triggeren til opdateringer, som rører bestemte felter. Lad det stå tomt for at udløse ved enhver ændring. Kommer en opdatering ind uden en registrering af, hvilke felter der flyttede sig, springes filteret over, og workflowet kører alligevel.
- **On Create X** og **On Update X** tager begge et påkrævet **Select Fields**-argument; **On Delete X** tager ingen argumenter.
- Alle tre har én enkelt **Succes**-udgang, og hver af dem tager et ID-argument, så du kan køre workflowet i hånden mod én enkelt post.
- Navnene kommer fra modellens navn i ental, ikke fra dens tabelnavn — derfor ser du **On Create Incident Team Owner** og **On Create Incident User Owner** frem for tabelformede navne.
- Der er ingen triggere for definitioner af brugerdefinerede hændelsesfelter. Den model er det ene medlem af hændelsesfamilien, hvor workflows er slået fra.

Se [Opret et workflow](/docs/workflows/authoring) og [Variabler](/docs/workflows/variables) for at bygge resten af workflowet.

## Hvor du kan læse videre

- [Hændelser – Oversigt](/docs/incidents/index) — hvordan hændelsesfunktionen hænger sammen.
- [Opret en hændelse](/docs/incidents/declaring-incidents) — erklæringsguiden, skabelonerne og API'et.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — indstillingssiderne for tilstande og alvorsgrader, og hvad flagene gør.
- [Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) — hvor noteskabeloner bliver brugt.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — hvem der hører om en hændelse uden for dit eget team.
- [Workflows – Oversigt](/docs/workflows/index) — automatisering oven på hændelsestriggere.
- [Runbooks – Oversigt](/docs/runbooks/index) — de procedurer, runbook-regler hægter på.
