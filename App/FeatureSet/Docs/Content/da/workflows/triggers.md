# Triggers

En trigger er den første blok i en arbejdsgang — den bestemmer, hvornår arbejdsgangen kører. Hver arbejdsgang har præcis én trigger. Du vælger mellem fire slags.

## Manual

Kør arbejdsgangen efter behov ved at klikke på **Run Workflow** på siden **Builder**, udfylde triggerens felter og bekræfte med **Run Workflow Manually**. Triggeren Manual tager en JSON-nyttelast, som resten af arbejdsgangen kan læse.

Godt til: automatiseringer med ét klik, du vil have en knap til, som "rotér denne nøgle" eller "send en testalarm."

**Output**: den JSON, du indsatte, eller et tomt objekt, hvis du ikke gjorde.

## Schedule

Kør arbejdsgangen på en gentagende tidsplan ved hjælp af et cron-udtryk.

Godt til: natlig oprydning, timelig synkronisering, ugentlige rapporter.

**Setting**: et cron-udtryk. Nogle almindelige eksempler:

- `0 * * * *` — hver time, på hele timen.
- `*/5 * * * *` — hvert 5. minut.
- `0 9 * * 1` — hver mandag klokken 9:00.

Hvis systemet er kortvarigt utilgængeligt, bliver kørslen samlet op, så snart det kommer sig igen — du behøver ikke bekymre dig om forpassede tikninger ved korte nedbrud.

## Webhook

OneUptime opretter en unik URL. Alt, der rammer den URL, starter arbejdsgangen. Headers, forespørgselsparametre og body fra anmodningen sendes med.

Godt til: at modtage data ind i OneUptime fra et andet værktøj — CI/CD-callbacks, alarmer fra anden overvågning, tilmeldinger i dit CRM.

**Output**:

- **Request Headers** — alle headers fra den indkommende anmodning.
- **Request Query Params** — den parsede forespørgselsstreng.
- **Request Body** — den parsede body (eller rå tekst, hvis det ikke er JSON).

URL'en accepterer både `GET` og `POST`. Kalderen får en hurtig kvittering — selve arbejdsgangen kører i baggrunden.

Behandl URL'en som en adgangskode. Alle, der har den, kan starte din arbejdsgang.

## OneUptime-hændelsestriggere

Næsten alt i OneUptime — overvågninger, hændelser, alarmer, planlagt vedligeholdelse, statussider, vagtpolitikker, teams — kan udløse en arbejdsgang. Hver af dem tilbyder tre hændelser:

- **On Create** — udløses, når en ny oprettes.
- **On Update** — udløses, når en ændres.
- **On Delete** — udløses, når en slettes.

Sådan bygger du "når X sker i OneUptime, gør Y" uden at skulle tjekke ting i en løkke.

Den fulde post sendes til den næste blok. For eksempel sender triggeren **Incident → On Create** den nye hændelse videre, så den næste blok kan læse dens titel, beskrivelse, alvorsgrad og alle andre felter.

### Hændelser de fleste teams bruger

- **Incident** — reagér, når en hændelse åbnes, opdateres (bekræftes, løses) eller slettes.
- **Alert** — de samme tre for alarmer.
- **Monitor** — reagér, når en overvågning tilføjes, redigeres eller fjernes.
- **Scheduled Maintenance** — annoncér automatisk et vedligeholdelsesvindue, når det planlægges.
- **Status Page Subscriber** — byd nogen velkommen, når de abonnerer på en statusside.
- **On-Call Duty Policy** — synkronisér ændringer i vagtplanen til et andet rostersystem.

Søg i panelet **Add Trigger** efter navn for at finde den, du vil have.

## Hvilken trigger skal jeg bruge?

| Hvis du vil…                                | Vælg                |
| -------------------------------------------- | -------------------- |
| Klikke på en knap for at køre arbejdsgangen  | **Manual**           |
| Køre på en gentagende tidsplan               | **Schedule**         |
| Lade et andet system sende data ind          | **Webhook**          |
| Reagere på noget inde i OneUptime            | **OneUptime event**  |

En arbejdsgang kan kun have én trigger. Hvis du har brug for to måder at starte den samme automatisering på, skal du bygge den fælles logik i én arbejdsgang og kalde den fra to tynde "wrapper"-arbejdsgange ved hjælp af komponenten **Execute Workflow**.

## Hvor du kan læse videre

- [Komponenter](/docs/workflows/components) — de handlinger, du tilføjer efter triggeren.
- [Variabler](/docs/workflows/variables) — læsning af triggerens output fra senere blokke.
- [Kørsler og logs](/docs/workflows/runs-and-logs) — bekræft, at din trigger blev udløst.
