# Triggere

En trigger er den første blok i et workflow — den afgør, hvornår workflowet kører. Hvert workflow har præcis én trigger. Du vælger mellem fire slags.

## Manual

Kør workflowet, når det passer dig, ved at klikke **Kør arbejdsgang** på siden **Bygger**, udfylde triggerens felter og bekræfte med **Run Workflow Manually**. Manual-triggeren tager imod en JSON-payload, som resten af workflowet kan læse.

Godt til: automatik med ét klik, som du gerne vil have en knap til — "rotér denne nøgle" eller "send en testadvarsel".

**Output**: den JSON, du indsatte, eller et tomt objekt, hvis du ikke indsatte noget.

## Schedule

Kør workflowet efter en gentagende tidsplan ved hjælp af et cron-udtryk.

Godt til: natlig oprydning, synkronisering hver time, ugentlige rapporter.

**Indstilling**: et cron-udtryk. Et par almindelige:

- `0 * * * *` — hver time, på hele timeslag.
- `*/5 * * * *` — hvert 5. minut.
- `0 9 * * 1` — hver mandag kl. 9.00.

Er systemet kortvarigt utilgængeligt, bliver kørslen taget op, så snart det er oppe igen — du behøver ikke bekymre dig om oversprungne tikker ved korte udfald.

## Webhook

OneUptime opretter en unik URL. Alt, der rammer den URL, starter workflowet. Anmodningens headere, query-parametre og body sendes med ind.

Godt til: at modtage data ind i OneUptime fra et andet værktøj — CI/CD-callbacks, advarsler fra anden overvågning, tilmeldinger i dit CRM.

**Output**:

- **Request Headers** — alle headere fra den indgående anmodning.
- **Request Query Params** — den fortolkede query-streng.
- **Request Body** — den fortolkede body (eller den rå tekst, hvis det ikke er JSON).

URL'en accepterer både `GET` og `POST`. Kalderen får en hurtig kvittering — selve workflowet kører i baggrunden.

Behandl URL'en som en adgangskode. Alle, der har den, kan starte dit workflow.

## OneUptime-begivenhedstriggere

Næsten alt i OneUptime — monitorer, hændelser, advarsler, planlagt vedligeholdelse, statussider, vagtpolitikker, teams — kan udløse et workflow. Hver af dem tilbyder tre begivenheder:

- **On Create** — udløses, når der tilføjes en ny.
- **On Update** — udløses, når en ændres.
- **On Delete** — udløses, når en slettes.

Sådan bygger du "når X sker i OneUptime, så gør Y" uden at skulle tjekke efter i en løkke.

Hele posten sendes videre til den næste blok. Triggeren **Incident → On Create** sender for eksempel den nye hændelse videre, så den næste blok kan læse dens titel, beskrivelse, alvorsgrad og alle andre felter.

### De begivenheder, teams bruger mest

- **Incident** — reagér, når en hændelse åbnes, opdateres (kvitteres, løses) eller slettes.
- **Alert** — de samme tre for advarsler.
- **Monitor** — reagér, når en monitor tilføjes, redigeres eller fjernes.
- **Scheduled Maintenance** — annoncér automatisk et vedligeholdelsesvindue, når det planlægges.
- **Status Page Subscriber** — byd en, der abonnerer på en statusside, velkommen.
- **On-Call Duty Policy** — synkronisér ændringer i vagtplanen til et andet vagtsystem.

Søg i panelet **Add Trigger** på navn for at finde den, du skal bruge.

## Hvilken trigger skal jeg vælge?

| Hvis du vil…                          | Vælg                    |
| ------------------------------------- | ----------------------- |
| Klikke på en knap for at køre workflowet | **Manual**           |
| Køre efter en gentagende tidsplan     | **Schedule**            |
| Lade et andet system skubbe data ind  | **Webhook**             |
| Reagere på noget inde i OneUptime     | **OneUptime-begivenhed** |

Et workflow kan kun have én trigger. Har du brug for to måder at starte den samme automatik på, så byg den fælles logik i ét workflow og kald det fra to tynde "wrapper"-workflows med komponenten **Execute Workflow**.

## Hvor du kan læse videre

- [Workflow-komponenter](/docs/workflows/components) — de handlinger, du tilføjer efter triggeren.
- [Workflow-variabler](/docs/workflows/variables) — sådan læser du triggerens output fra senere blokke.
- [Workflow-kørsler & logfiler](/docs/workflows/runs-and-logs) — sådan bekræfter du, at din trigger blev udløst.
