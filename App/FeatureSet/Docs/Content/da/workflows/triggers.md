# Triggere

En trigger er den første blok i et workflow — den bestemmer, hvornår workflowet kører. Hvert workflow har præcis én trigger. Du vælger mellem fire slags.

## Manuel

Kør workflowet on demand ved at klikke **Run Manually** på workflow-siden. Du kan indsætte en JSON-payload, som resten af workflowet kan læse.

God til: ét-klik-automatiseringer, du gerne vil have en knap til, såsom "roter denne nøgle" eller "send en testalarm."

**Output**: den JSON, du indsatte, eller et tomt objekt, hvis du ikke gjorde.

## Tidsplan

Kør workflowet på en gentagen tidsplan ved hjælp af et cron-udtryk.

God til: natlig oprydning, synkronisering hver time, ugentlige rapporter.

**Indstilling**: et cron-udtryk. Et par almindelige:

- `0 * * * *` — hver time, på timen.
- `*/5 * * * *` — hvert 5. minut.
- `0 9 * * 1` — hver mandag kl. 9:00.

Hvis systemet er kortvarigt utilgængeligt, samles kørslen op, så snart det kommer sig igen — du behøver ikke bekymre dig om missede tick'er ved korte udfald.

## Webhook

OneUptime opretter en unik URL. Alt, der rammer den URL, starter workflowet. Anmodningens headers, query-parametre og body sendes med ind.

God til: at modtage data ind i OneUptime fra et andet værktøj — CI/CD-callbacks, alarmer fra anden overvågning, tilmeldinger i dit CRM.

**Output**:

- **Request Headers** — alle headers fra den indkommende anmodning.
- **Request Query Params** — den parsede querystreng.
- **Request Body** — den parsede body (eller den rå tekst, hvis det ikke er JSON).

URL'en accepterer både `GET` og `POST`. Kalderen får en hurtig bekræftelse — selve workflowet kører i baggrunden.

Behandl URL'en som en adgangskode. Enhver, der har den, kan starte dit workflow.

## OneUptime event-triggere

Næsten alt i OneUptime — monitorer, hændelser, alarmer, planlagt vedligeholdelse, statussider, vagtpolitikker, teams — kan udløse et workflow. Hver enkelt tilbyder tre events:

- **On Create** — udløses, når en ny tilføjes.
- **On Update** — udløses, når en ændres.
- **On Delete** — udløses, når en slettes.

Sådan bygger du "når X sker i OneUptime, så gør Y" uden at skulle tjekke ting i en løkke.

Hele posten sendes videre til den næste blok. For eksempel sender triggeren **Incident → On Create** den nye hændelse, så den næste blok kan læse dens titel, beskrivelse, alvorlighed og ethvert andet felt.

### Events som teams bruger mest

- **Incident** — reagér, når en hændelse åbnes, opdateres (bekræftes, løses) eller slettes.
- **Alert** — samme tre for alarmer.
- **Monitor** — reagér, når en monitor tilføjes, redigeres eller fjernes.
- **Scheduled Maintenance** — annoncér automatisk et vedligeholdelsesvindue, når det planlægges.
- **Status Page Subscriber** — byd nogen velkommen, der tilmelder sig en statusside.
- **On-Call Duty Policy** — synkronisér vagtplansændringer til et andet roster-system.

Søg i trigger-paletten efter navn for at finde den, du vil have.

## Hvilken trigger skal jeg bruge?

| Hvis du vil…                             | Vælg                |
| ---------------------------------------- | ------------------- |
| Klikke på en knap for at køre workflowet | **Manual**          |
| Køre på en gentagen tidsplan             | **Schedule**        |
| Lade et andet system skubbe data ind     | **Webhook**         |
| Reagere på noget inde i OneUptime        | **OneUptime event** |

Et workflow kan kun have én trigger. Hvis du har brug for to måder at starte den samme automatisering på, så byg den fælles logik i ét workflow og kald det fra to tynde "wrapper"-workflows ved hjælp af komponenten **Execute Workflow**.

## Læs videre

- [Komponenter](/docs/workflows/components) — de handlinger, du tilføjer efter triggeren.
- [Variabler](/docs/workflows/variables) — at læse trigger-output fra senere blokke.
- [Kørsler & logfiler](/docs/workflows/runs-and-logs) — bekræft at din trigger udløstes.
