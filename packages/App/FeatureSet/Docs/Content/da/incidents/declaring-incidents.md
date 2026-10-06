# Opret en hændelse

At erklære en hændelse er det øjeblik, hvor OneUptime begynder at føre regnskab. Der oprettes en optegnelse, den får stemplet et nummer, vagtpolitikker udløses, og — medmindre du siger fra — hører abonnenterne på din statusside om det. Alt andet i hændelsens livscyklus hænger på den første skrivning.

Der er fire måder, en hændelse kommer ind i OneUptime på, og de ender alle det samme sted: en række i tabellen `Incident` med en alvorsgrad, en aktuel tilstand og en liste over berørte ressourcer. Forskellen er kun, hvem der udfylder felterne — dig klokken tre om natten, en gemt skabelon, en monitors kriterier eller din egen kode, der kalder API'et.

Denne side gennemgår alle fire, felt for felt, og dækker derefter, hvad serveren udfylder for dig, og hvad der sættes i gang i det øjeblik hændelsen findes.

## Fire måder at erklære en hændelse på

| Hvis du vil…                                                    | Vælg                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Åbne en hændelse i hånden og udfylde det hele                    | Guiden **Erklær hændelse**                                                  |
| Åbne en tilbagevendende slags hændelse med felterne forudfyldt   | **Opret fra skabelon**                                                      |
| Åbne en automatisk, når en monitors kontroller fejler            | Et monitorkriteriefilter med **When filters match, declare an incident.**   |
| Åbne en fra din egen kode, et script eller et andet værktøj      | `POST /api/incident`                                                        |

Alle fire skriver den samme model, så en hændelse åbnet af en sonde ser præcis ud som en, en responder åbnede i hånden — bortset fra et par bogholderikolonner, serveren sætter på de automatiske.

## At erklære en i hånden

Åbn **Hændelser → Alle hændelser**, og klik på **Erklær hændelse** øverst til højre i listen **Hændelser**. Det fører dig til et kort med titlen **Erklær ny hændelse**, der fordeler formularen over tre trin: **Hændelsesdetaljer**, **Berørte ressourcer** og **Vagt og roller**, og derefter en opsummering til gennemsyn. Når dit projekt beder om nogle af sine brugerdefinerede hændelsesfelter ved oprettelse, kommer et fjerde trin, **Detaljer**, lige efter **Berørte ressourcer**.

Kun det første trin har obligatoriske felter, plus ethvert brugerdefineret felt, dine administratorer har markeret som **Påkrævet ved oprettelse**. Du kan også tilknytte ressourcer, tilføje vagtpolitikker og tildele roller bagefter, fra hændelsens egne sider. Hvert trin før opsummeringen har en almindelig **Næste**, og **Erklær hændelse** findes i opsummeringen, det sidste trin.

**Flere felter.** De indstillinger, som de fleste hændelser aldrig har brug for, venter foldet sammen under overskriften **Flere felter** i slutningen af deres trin; klik på den for at åbne dem. Sammenfoldet nævner overskriften, hvad den indeholder, og viser hver angivet indstilling med dens værdi — angivet af en skabelon, for eksempel — og den åbner sig selv, når noget i den skal rettes. Opsummeringen viser kun en sammenfoldet indstilling, når den er angivet, undtagen **Underret statussideabonnenter**, som den altid viser, med hvem der får besked.

### Trin 1 — Hændelsesdetaljer

- **Titel** — påkrævet. Resuméet på én linje, som alle ser i listen, i Slack og, hvis hændelsen er synlig, på din statusside.
- **Hændelsesalvor** — påkrævet. En af de alvorsgrader, der er konfigureret for dit projekt.
- **Beskrivelse** — valgfri, skrevet i Markdown. Det er det, statussiden viser, så skriv den til kunderne og ikke til dit team.

Under **Flere felter**:

- **Erklæret den** — starter i det øjeblik, du åbnede siden. Al varighed på hændelsen måles herfra; tilbagedater den for at registrere en hændelse, der begyndte tidligere.
- **Indledende tilstand** — valgfri, og tom til at begynde med. Efterlades den tom, starter hændelsen i den tilstand, der har flaget `isCreatedState`, eller i skabelonens indledende tilstand. Vælg kun en senere tilstand for at registrere en hændelse, der allerede er kvitteret eller løst.
- **Etiketter** — valgfri. Etiketter samler relaterede hændelser, og et team, der er begrænset til etiketter, ser kun de hændelser, der bærer en af dets etiketter.
- **Privat hændelse** — slået fra som standard (`isPrivate`). En privat hændelse er kun synlig for sine ejere, projektadministratorer og projektejere, og den er skjult på alle statussider.

**Hvis rullemenuen for tilstand driller.** Har dit projekt ingen tilstand med flaget `isCreatedState`, fejler oprettelseskaldet og beder dig tilføje en oprettet hændelsestilstand fra indstillingerne. Det sker normalt kun i et projekt, hvis tilstande er blevet redigeret kraftigt — se [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).

### Trin 2 — Berørte ressourcer

Monitorerne kommer først, for sig selv: statussider ser en hændelse gennem dens monitorer, og den status, monitorerne skifter til, står lige under dem.

- **Monitorer** — et søgefelt, der tilknytter de monitorer, hændelsen påvirker (`monitors`). En statusside viser hændelsen og giver sine abonnenter besked, når den viser en af disse monitorer.
- **Skift overvågningsstatus til** — valgfri, og vises først, når mindst én monitor er valgt. Sætter hver monitor i hændelsen til en overvågningsstatus, så det at erklære hændelsen og markere dens monitorer som forringede er én handling. En skabelons status vises, så snart du vælger en monitor; uden nogen valgt monitor gemmes der ingen status.
- **Andre berørte ressourcer** — et andet søgefelt til alt andet, hændelsen påvirker: værter, Kubernetes-klynger, Docker- og Podman-værter, Proxmox-, Ceph- og Docker Swarm-klynger, vCentre, storage-arrays, IoT-flåder, databaser og tjenester. Det er separate relationer på hændelsen (`hosts`, `kubernetesClusters`, `services` med flere).

Hændelsens kort **Berørte ressourcer** spørger på samme måde, når du redigerer det senere.

Under **Flere felter**:

- **Begræns til disse statussider** — valgfri. Efterlades den tom, vises hændelsen på alle statussider, der viser dens monitorer, og giver deres abonnenter besked; med valgte sider kun på dem blandt dem. Se [Én statusside pr. målgruppe](/docs/status-pages/one-status-page-per-audience).
- **Underret statussideabonnenter** — afkrydsningsfelt, slået til som standard (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Under det, og igen i opsummeringen, viser formularen, hvilke statussider der får besked, og hvor mange abonnenter hver har; i opsummeringen viser **Se notifikation** den e-mail, de får. Slå det fra for intern støj, som du alligevel vil have registreret.

**Knyt monitorer, også når det føles overflødigt.** Forbindelsen mellem en hændelse og en statusside går gennem hændelsens monitorer: en statusside viser en hændelse, når en af sidens ressourcer er en af hændelsens monitorer. En notifikation om tilstandsskift til abonnenter springes helt over, når hændelsen ingen monitorer har knyttet. Se [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups).

### Trin 3 — Vagt og roller

- **Vagtpolitik** — et flervalg af de vagtpolitikker, der udføres, når denne hændelse oprettes (`onCallDutyPolicies`).
- **Tildel hændelsesroller** — hvem der tager hver rolle, dit projekt definerer. En rolle markeret som **Primær**, som du lader stå tom, er din: du tager den, når hændelsen erklæres.

Det er det eneste sted, en vagtpolitik knyttes direkte til en hændelse. Alvorsgrader bærer ikke en vagtpolitik — alvorsgrad er en etiket, og den påvirker kun tilkaldelse som *matchkriterium* inde i en vagtregel. Regler konfigureret under **Hændelser → Regler → Vagtregler** lægger deres politikker oven på det, du vælger her; det endelige sæt, der kører, er foreningsmængden af begge uden dubletter.

Selve rollerne konfigureres under **Hændelser → Indstillinger → Hændelsesroller**. Et nyt projekt har én, Incident Commander; tilføj der, hvad din proces ellers har brug for.

Flaget **Should be visible on status page?** (`isVisibleOnStatusPage`) findes ikke i guiden; det er sat til sand som standard. Ændr det bagefter fra **Indstillinger** i hændelsens sidemenu, hvor det hedder **Synlig på statussiden**.

## At erklære fra en skabelon

Erklærer du hele tiden den samme slags hændelse — det samme titelmønster, den samme alvorsgrad, den samme vagtpolitik — så gem det som en skabelon én gang.

Klik **Opret fra skabelon** (omridsknappen ved siden af **Erklær hændelse**), og en dialog **Create Incident from Template** åbner med en rullemenu **Vælg hændelsesskabelon**. Vælg en skabelon, og oprettelsesformularen åbner forudfyldt; du kan stadig ændre alt, inden du indsender. Har dit projekt endnu ingen skabeloner, får du i stedet dialogen **No Incident Templates** med en knap **Create Template**, der fører dig til **Hændelser → Indstillinger → Hændelsesskabeloner**.

Skabeloner bygges med deres egen guide — **Skabeloninformation**, **Hændelsesdetaljer**, **Berørte ressourcer**, **Vagt** — plus trin til brugerdefinerede felter, når dit projekt har dem. Ejere og etiketter ligger under **Flere felter** i slutningen af **Hændelsesdetaljer**. **Berørte ressourcer** spørger som erklæringsformularen — **Monitorer**, så **Skift overvågningsstatus til**, så **Andre berørte ressourcer**, med **Begræns til disse statussider** under **Flere felter** — bortset fra at en skabelon altid spørger om overvågningsstatus: den gælder også de monitorer, der vælges, når en hændelse erklæres ud fra skabelonen. Det er felterne:

| Felt                              | Formål                                                     |
| --------------------------------- | ---------------------------------------------------------- |
| **Skabelonnavn**                  | Sådan kendes skabelonen i vælgeren.                        |
| **Skabelonbeskrivelse**           | En besked til dig selv om, hvornår du skal gribe efter den. |
| **Titel**                         | Titlen, der forudfyldes på hændelsen.                      |
| **Beskrivelse**                   | Markdown-beskrivelse, der forudfyldes på hændelsen.        |
| **Hændelsesalvor**                | Alvorsgraden, der forudfyldes på hændelsen.                |
| **Indledende hændelsestilstand**  | Den tilstand, hændelser fra denne skabelon starter i.      |
| **Monitorer** | Monitorer, der skal tilknyttes. |
| **Skift overvågningsstatus til** | Overvågningsstatus for hændelsens monitorer, også dem, der vælges ved erklæringen. |
| **Andre berørte ressourcer** | Værter, klynger og tjenester, der skal tilknyttes. |
| **Begræns til disse statussider** | Statussider, som hændelsen er begrænset til. |
| **Vagtpolitik**                   | Politikker, der udføres, når hændelsen oprettes.           |
| **Ejere** | Personer og teams, der ejer hændelser oprettet ud fra denne skabelon, valgt fra én liste. |
| **Etiketter**                     | Etiketter, der sættes på hændelsen.                        |

Et par hurtige regler:

- Skabeloner kan ikke redigeres fra skabelonlisten — du opretter en og åbner den så for at ændre den.
- En skabelon udfylder kun et felt, du lod stå tomt. På oprettelsessiden anvendes skabelonen som en forudfyldning, du kan overskrive; på API'et udfylder serveren kun et felt fra skabelonen, når anmodningen lod feltet stå `undefined`. Det, kalderen sendte med, vinder altid.

## At erklære automatisk fra monitorkriterier

De fleste hændelser bør ikke kræve, at et menneske taster dem ind. Slå kontakten **When filters match, declare an incident.** til i en monitors kriterieeditor, og der dukker en sektion **Opret hændelse** op med en knap **Tilføj hændelse** — ét kriteriefilter kan erklære mere end én hændelse.

Hver post har:

- **Hændelsestitel** — understøtter skabeloner; pladsholderen foreslår noget i retning af `{{monitorName}} is down`.
- **Alvorlighed** — påkrævet.
- **Hændelsesbeskrivelse** — også med skabeloner.
- **Vagt → Vagtpolitikker** — politikker, der udføres, når denne hændelse oprettes.
- **Hændelsesroller** — tildel teammedlemmer til roller på forhånd.
- **Ejerskab og etiketter → Ejer-teams**, **Ejer-brugere**, **Etiketter**.
- **Flere felter → Løs hændelse automatisk** (løser hændelsen automatisk, når kriterierne holder op med at matche), **Vis hændelse på statusside**, **Privat hændelse** og **Afhjælpningsnoter**.

Hele listen over de `{{variable}}`-pladsholdere, du kan bruge i titel, beskrivelse og afhjælpningsnoter, står i [Hændelse- og advarselsskabeloner](/docs/monitor/incident-alert-templating).

Hændelser oprettet på denne måde mærkes af serveren: `isCreatedAutomatically` sættes, `createdCriteriaId` registrerer hvilket kriteriefilter der udløste den, og `createdByProbe` registrerer hvilken sonde der så det. Alt andet ved dem opfører sig præcis som ved en håndterklæret hændelse.

## At erklære gennem API'et

Hændelsesmodellen har et almindeligt CRUD-endepunkt, så `POST /api/incident` opretter en. Godkend med en API-nøgle genereret under **Projektindstillinger → API-nøgler**, sendt i headeren `apikey` — nøglen identificerer projektet, så du behøver ikke sende et projekt-id separat.

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

Nyttige felter i anmodningens body:

- `title` — det eneste felt, du reelt skal sende med.
- `declaredAt` — valgfrit her, selv om formularen kræver det. Udelad det, og serveren bruger det aktuelle tidspunkt.
- `incidentSeverityId` og `currentIncidentStateId` — serveren tjekker, at begge hører til samme projekt som API-nøglen, og afviser anmodningen, hvis de ikke gør. Samme kontrol gælder monitorstatussen bag **Skift overvågningsstatus til**.
- `createdIncidentTemplateId` — anvend en gemt skabelon. Alle felter, du udelader, udfyldes fra skabelonen; alle felter, du sender, bevares som de er.

Beslægtede endepunkter er `/api/incident-state`, `/api/incident-severity` og `/api/incident-state-timeline`. Den genererede [API-reference](/reference) har de præcise anmodnings- og svarformater for hver, inklusive hvordan relationsfelter som monitorer udtrykkes.

## Hændelsesnumre og præfikser

Hver hændelse får et fortløbende nummer fra en tæller per projekt, tildelt af serveren ved oprettelsen. To kolonner holder det: `incidentNumber` (det rå heltal) og `incidentNumberWithPrefix` (det, du faktisk ser). Uden et konfigureret præfiks er visningsværdien `#42`.

Det ændrer du under **Hændelser → Indstillinger → Nummerpræfiks**: klik på **Opdater**. Feltet **Nummerpræfiks for hændelse** viser nummeret, mens du skriver: `INC-` giver `INC-42`. Lad det stå tomt for at beholde standarden `#`. Et nyt præfiks gælder hændelser, der erklæres bagefter; eksisterende hændelser beholder deres numre. Samme dialog har **Nummerpræfiks for hændelsesepisode** til nummerering af episoder.

Nummeret optræder som den første kolonne på listen over hændelser, linker til hændelsen og vises som **Hændelsesnummer** på hændelsens **Oversigt**.

## Hvad der sker i det øjeblik en hændelse erklæres

Oprettelseskaldet gør mere end at skrive en række. I rækkefølge:

1. **Serveren udfylder hullerne.** `declaredAt` sættes til nu, den aktuelle tilstand sættes til projektets `isCreatedState`-tilstand, og hændelsesnummeret samt det præfiksede nummer tildeles fra projektets tæller.
2. **En skabelon anvendes**, hvis `createdIncidentTemplateId` blev sendt med — og udfylder kun felter, kalderen lod stå udefinerede.
3. **Privatlivsregler kører** og markerer hændelsen som privat, når en matchende regel siger det. Det er den første regelmotor, der kører, så alt efter den ser den rigtige privatlivsindstilling.
4. **Ejerregler kører** og tilføjer de ejerbrugere og -teams, som matchende regler nævner.
5. **Etiketregler kører** og tilføjer de etiketter, der matcher hændelsen.
6. **Vagtregler kører.** Hver aktiveret regel under **Hændelser → Regler → Vagtregler**, hvis kriterier matcher, føjer sine politikker til hændelsen. Der er ingen prioritetsrækkefølge og ingen kortslutning — alle matchende regler udløses, og politikkerne renses for dubletter.
7. **Runbook-regler kører** og knytter samt starter matchende runbooks. Se [Runbooks](/docs/runbooks/index).
8. **Vagtpolitikker udføres.** Hver politik på hændelsen — valgt i guiden, arvet fra en skabelon eller tilføjet af en regel — udføres parallelt med begivenhedstypen `IncidentCreated`. At én politik fejler, stopper ikke de andre. En hændelse, der erklæres allerede bekræftet eller løst, udfører ingen af dem: ingen tilkaldes, og dens feed siger det og nævner dem ved navn.
9. **Abonnenter sættes i kø**, hvis **Underret statussideabonnenter** blev ladt slået til, og hændelsen er synlig på statussiden. Leveringen håndteres af et baggrundsjob, ikke inline med din anmodning.
10. **Workflows udløses.** Triggeren **On Create Incident** starter alle workflows bygget på den. Se [Workflows – Oversigt](/docs/workflows/index).

Derfra er hændelsen i live: den tæller med i mærket **Aktive hændelser** i hændelsernes sidemenu (enhver tilstand over din løste tilstand tæller som aktiv), den optræder på de statussider, der bærer en af dens monitorer, og dens **Tilstandstidslinje** begynder at registrere.

## Læs videre

- [Hændelser – Oversigt](/docs/incidents/index) — hvordan hændelsesmodellen hænger sammen.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — hvad tilstandsflagene gør, og hvordan du tilføjer dine egne.
- [Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) — offentlige noter, private noter, ejere og aktivitetsfeedet.
- [Hændelsesindstillinger og automatisering](/docs/incidents/settings) — skabeloner, brugerdefinerede felter, roller, regler og workflow-triggere.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — hvem der hører om den hændelse, du lige har erklæret.
- [Hændelse- og advarselsskabeloner](/docs/monitor/incident-alert-templating) — de variabler, automatisk erklærede hændelser kan bruge.
