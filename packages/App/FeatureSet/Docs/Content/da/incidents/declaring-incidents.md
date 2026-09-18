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

Åbn **Hændelser → Alle hændelser**, og klik **Erklær hændelse** øverst til højre på listen **Hændelser**. Det fører dig til et kort med titlen **Erklær ny hændelse**, som fordeler formularen over fem trin: **Hændelsesdetaljer**, **Berørte ressourcer**, **Hændelsesroller**, **Vagt** og **Mere**. Indsend-knappen til sidst hedder også **Erklær hændelse**.

Kun det første trin har påkrævede felter. Har du travlt, så udfyld **Hændelsesdetaljer** og indsend — du kan knytte ressourcer, tildele roller og tilføje vagtpolitikker fra hændelsens egne sider bagefter.

### Trin 1 — Hændelsesdetaljer

- **Titel** — påkrævet. Den etlinjes opsummering, alle vil se på listen, i Slack og — hvis hændelsen er synlig — på din statusside. Pladsholder: `Incident Title`.
- **Beskrivelse** — valgfri, skrevet i Markdown. Det er dette felt, der vises på statussiden, så skriv det til kunderne frem for til dit team. Du kan redigere det senere fra **Beskrivelse** i hændelsens sidemenu.
- **Erklæret den** — påkrævet i formularen, sat til nu som standard. Det er tidsstemplet, alle varigheder på hændelsen måles fra, så sæt det tilbage i tid, hvis du registrerer noget, der begyndte tidligere.
- **Hændelsesalvor** — påkrævet. En af de alvorsgrader, der er konfigureret for dit projekt; nye projekter får **Critical Incident**, **Major Incident** og **Minor Incident** oprettet fra start.
- **Hændelsesstatus** — valgfri. Lad den være, og hændelsen lander i den tilstand, der er flagget `isCreatedState`, hvilket nye projekter opretter som **Identified**. Sæt den kun, hvis du registrerer en hændelse, der allerede var længere fremme.

**Hvis rullemenuen for tilstand driller.** Har dit projekt ingen tilstand med flaget `isCreatedState`, fejler oprettelseskaldet og beder dig tilføje en oprettet hændelsestilstand fra indstillingerne. Det sker normalt kun i et projekt, hvis tilstande er blevet redigeret kraftigt — se [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities).

### Trin 2 — Berørte ressourcer

- **Berørte ressourcer** — ét enkelt søgefelt, der knytter monitorer, værter, Kubernetes-klynger, Docker-værter, Podman-værter og tjenester. Under motorhjelmen er de separate relationer på hændelsen (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` med flere), men formularen samler dem i én vælger.
- **Skift overvågningsstatus til** — valgfri. Vælger en monitorstatus, der sættes på hver monitor knyttet til hændelsen, så det at erklære hændelsen og markere monitorerne som forringede er én handling frem for to.

**Knyt monitorer, også når det føles overflødigt.** Forbindelsen mellem en hændelse og en statusside går gennem hændelsens monitorer: en statusside viser en hændelse, når en af sidens ressourcer er en af hændelsens monitorer. En notifikation om tilstandsskift til abonnenter springes helt over, når hændelsen ingen monitorer har knyttet. Se [Statusside – ressourcer og grupper](/docs/status-pages/resources-and-groups).

### Trin 3 — Hændelsesroller

- **Tildel hændelsesroller** — tildel teammedlemmer til de roller, dit projekt definerer. Nogle roller kan rumme mere end én bruger.

Rollerne selv konfigureres under **Hændelser → Indstillinger → Hændelsesroller**, hvor du definerer de roller, der kan tildeles under indsatsen — Hændelsesleder, Indsatsansvarlig og hvad din proces ellers kræver. Springer du dette trin over, tildeles der automatisk en Hændelsesleder ved det første tilstandsskift, hvis ingen har rollen endnu.

### Trin 4 — Vagt

- **Vagtpolitik** — et multivalg af de vagtpolitikker, der skal udføres, når hændelsen oprettes. Det svarer til `onCallDutyPolicies` på hændelsen.

Det er det eneste sted, en vagtpolitik knyttes direkte til en hændelse. Alvorsgrader bærer ikke en vagtpolitik — alvorsgrad er en etiket, og den påvirker kun tilkaldelse som *matchkriterium* inde i en vagtregel. Regler konfigureret under **Hændelser → Regler → Vagtregler** lægger deres politikker oven på det, du vælger her; det endelige sæt, der kører, er foreningsmængden af begge uden dubletter.

### Trin 5 — Mere

- **Etiketter** — valgfri og en avanceret funktion: det er teammedlemmer med adgang til disse etiketter, der kan tilgå hændelsen.
- **Underret statussideabonnenter** — afkrydsningsfelt, slået til som standard. Styrer, om abonnenter får en e-mail om, at hændelsen er oprettet (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Slå det fra for intern støj, du stadig vil have registreret.
- **Privat hændelse** — afkrydsningsfelt, slået fra som standard (`isPrivate`). En privat hændelse er kun synlig for dens ejerbrugere, medlemmerne af dens ejerteams, projektadministratorer og projektejere — og den er skjult fra alle statussider uanset alle andre indstillinger. Listen over hændelser markerer dem med en rød **Private**-plakette.

Flaget **Should be visible on status page?** (`isVisibleOnStatusPage`) findes ikke i guiden; det er sat til sand som standard. Ændr det bagefter fra **Indstillinger** i hændelsens sidemenu, hvor det hedder **Synlig på statussiden**.

## At erklære fra en skabelon

Erklærer du hele tiden den samme slags hændelse — det samme titelmønster, den samme alvorsgrad, den samme vagtpolitik — så gem det som en skabelon én gang.

Klik **Opret fra skabelon** (omridsknappen ved siden af **Erklær hændelse**), og en dialog **Create Incident from Template** åbner med en rullemenu **Vælg hændelsesskabelon**. Vælg en skabelon, og oprettelsesformularen åbner forudfyldt; du kan stadig ændre alt, inden du indsender. Har dit projekt endnu ingen skabeloner, får du i stedet dialogen **No Incident Templates** med en knap **Create Template**, der fører dig til **Hændelser → Indstillinger → Hændelsesskabeloner**.

Skabeloner bygges i deres egen sekstrinsguide — **Skabeloninformation**, **Hændelsesdetaljer**, **Berørte ressourcer**, **Vagt**, **Ejere**, **Etiketter** — med disse felter:

| Felt                              | Formål                                                     |
| --------------------------------- | ---------------------------------------------------------- |
| **Skabelonnavn**                  | Sådan kendes skabelonen i vælgeren.                        |
| **Skabelonbeskrivelse**           | En besked til dig selv om, hvornår du skal gribe efter den. |
| **Titel**                         | Titlen, der forudfyldes på hændelsen.                      |
| **Beskrivelse**                   | Markdown-beskrivelse, der forudfyldes på hændelsen.        |
| **Hændelsesalvor**                | Alvorsgraden, der forudfyldes på hændelsen.                |
| **Indledende hændelsestilstand**  | Den tilstand, hændelser fra denne skabelon starter i.      |
| **Berørte ressourcer**            | Monitorer, værter, klynger og tjenester, der skal knyttes. |
| **Skift overvågningsstatus til**  | Monitorstatus, der sættes på de knyttede monitorer.        |
| **Vagtpolitik**                   | Politikker, der udføres, når hændelsen oprettes.           |
| **Ejer - Teams**                  | Teams, der ejer hændelser oprettet fra denne skabelon.     |
| **Ejer - Brugere**                | Brugere, der ejer hændelser oprettet fra denne skabelon.   |
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
- **Avancerede indstillinger → Løs hændelse automatisk** (løser hændelsen automatisk, når kriterierne holder op med at matche), **Vis hændelse på statusside**, **Privat hændelse** og **Afhjælpningsnoter**.

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

Det ændrer du under **Hændelser → Indstillinger → Flere indstillinger**. Kortet **Talpræfiks** har et felt **Nummerpræfiks for hændelse** (op til 20 tegn, pladsholder `INC-`) — sæt det, og den samme hændelse vises som `INC-42`. Lad det stå tomt for at beholde standarden `#`. Kortet rummer også **Nummerpræfiks for hændelsesepisode** til nummerering af episoder.

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
8. **Vagtpolitikker udføres.** Hver politik på hændelsen — valgt i guiden, arvet fra en skabelon eller tilføjet af en regel — udføres parallelt med begivenhedstypen `IncidentCreated`. At én politik fejler, stopper ikke de andre.
9. **Abonnenter sættes i kø**, hvis **Underret statussideabonnenter** blev ladt slået til, og hændelsen er synlig på statussiden. Leveringen håndteres af et baggrundsjob, ikke inline med din anmodning.
10. **Workflows udløses.** Triggeren **On Create Incident** starter alle workflows bygget på den. Se [Workflows – Oversigt](/docs/workflows/index).

Derfra er hændelsen i live: den tæller med i mærket **Aktive hændelser** i hændelsernes sidemenu (enhver tilstand, der ikke er flagget `isResolvedState`, tæller som aktiv), den optræder på de statussider, der bærer en af dens monitorer, og dens **Tilstandstidslinje** begynder at registrere.

## Læs videre

- [Hændelser – Oversigt](/docs/incidents/index) — hvordan hændelsesmodellen hænger sammen.
- [Hændelsestilstande og alvorsgrader](/docs/incidents/states-and-severities) — hvad tilstandsflagene gør, og hvordan du tilføjer dine egne.
- [Hændelsesnoter, ejere og feed](/docs/incidents/notes-owners-and-feed) — offentlige noter, private noter, ejere og aktivitetsfeedet.
- [Hændelsesindstillinger og automatisering](/docs/incidents/settings) — skabeloner, brugerdefinerede felter, roller, regler og workflow-triggere.
- [Abonnenter og meddelelser](/docs/status-pages/subscribers) — hvem der hører om den hændelse, du lige har erklæret.
- [Hændelse- og advarselsskabeloner](/docs/monitor/incident-alert-templating) — de variabler, automatisk erklærede hændelser kan bruge.
