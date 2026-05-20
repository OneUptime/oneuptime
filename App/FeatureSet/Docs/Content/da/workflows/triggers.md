# Workflow-triggere

En trigger er startnoden i et workflow. Den har ingen input-port — eksekveringen begynder her. OneUptime understøtter fire triggerfamilier; hvert workflow bruger præcis én.

## Manuel

Kør et workflow on-demand ved at klikke **Run Manually** på workflow-siden. Du kan indsætte en valgfri JSON-payload, som workflowet kan læse som `{{Manual.JSON}}`.

Brug dette, når du vil have en knap, der udløser et stykke automatisering — et ét-kliks "rotér on-call-nøglen" eller "genopbyg søgeindekset", som ikke har brug for en tilbagevendende tidsplan eller en event til at udløse den.

**Argumenter**: ingen.

**Returværdier**:

| Navn | Type | Beskrivelse |
| --- | --- | --- |
| `JSON` | JSON | Den JSON-payload, der blev leveret ved kørselstid, eller et tomt objekt. |

## Tidsplan

Kør et workflow på en cron-tidsplan. Konfigurér kadencen med et standard cron-udtryk.

Brug dette til tilbagevendende job: natlig oprydning, time-synkronisering, ugentlig eksport.

**Argumenter**:

| Navn | Type | Beskrivelse |
| --- | --- | --- |
| `Schedule at` | CronTab | Standard 5-felts cron-udtryk. For eksempel kører `0 * * * *` på toppen af hver time, `*/5 * * * *` hvert femte minut. |

**Returværdier**:

| Navn | Type | Beskrivelse |
| --- | --- | --- |
| `executedAt` | Date | Det planlagte køretidspunkt. |

Planlagte workflows kører på Workflow Workeren i projektets region. Hvis workeren er kortvarigt utilgængelig, sendes kørslen videre, når den kommer tilbage — du behøver ikke gardere dig mod missede tick ved korte udfald.

## Webhook

Eksponér en unik HTTPS-URL, som et eksternt system `POST`er til. Anmodningens headers, query-parametre og body eksponeres som returværdier, som nedstrøms komponenter kan læse.

Brug dette til at modtage data *ind* i OneUptime fra et tredjepartssystem: CI/CD-callbacks, alarmer fra et andet monitoreringsværktøj, kundetilmeldinger i dit CRM.

**Argumenter**: ingen. URL'en allokeres automatisk, når workflowet gemmes, og vises på trigger-noden. Behandl den som en hemmelighed — enhver med URL'en kan udløse workflowet.

**Returværdier**:

| Navn | Type | Beskrivelse |
| --- | --- | --- |
| `Request Headers` | JSON | Alle headers fra den indkommende HTTP-anmodning. |
| `Request Query Params` | JSON | Parset query-streng. |
| `Request Body` | JSON | Parset anmodningsbody. Hvis bodyen ikke er gyldigt JSON, ankommer den som en streng under `raw`-nøglen. |

Webhooken accepterer `GET` og `POST`. Svaret til kalderen er en `200 OK` med en JSON-kvittering, så snart kørslen er sat i kø — selve workflowet kører asynkront, så forvent ikke at læse resultatet af nedstrøms komponenter i HTTP-svaret.

## Model-event-triggere

Næsten enhver OneUptime-entitet — monitorer, hændelser, alarmer, planlagte vedligeholdsevents, statussider, on-call-policies, teams, telemetri-services og mange flere — eksponerer tre triggere:

- **On Create** — udløses, når en ny post af denne type oprettes.
- **On Update** — udløses, når en eksisterende post ændres. Triggeren eksponerer både gamle og nye værdier.
- **On Delete** — udløses, når en post slettes.

Det er sådan, du bygger "når X sker i OneUptime, så gør Y"-automatisering uden polling.

Selve modellen eksponeres som en returværdi med de samme feltnavne, du ser på ressourcen. For eksempel returnerer **Incident → On Create**-triggeren det fulde `Incident`-objekt, så nedstrøms noder kan læse `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` osv.

**Argumenter**: typisk ingen for create/delete. Update-triggere kan lade dig indsnævre de felter, du vil reagere på, så du ikke udløses ved kosmetiske ændringer.

**Returværdier** (varierer pr. model):

| Navn | Type | Beskrivelse |
| --- | --- | --- |
| Model-felter | (varierer) | Hver kolonne på entiteten — navn, status, tidsstempler, fremmednøgler. |
| `previous` (kun Update) | JSON | Posten, som den var før ændringen. |

### Almindelige model-triggere

En ikke-udtømmende liste over de model-events, teams oftest griber til:

- **Incident** — `On Create`, `On Update` (brug til at reagere på tilstandsændringer som Acknowledged eller Resolved), `On Delete`.
- **Alert** — samme tre events på alarm-modellen.
- **Monitor** — reagér når en monitor tilføjes, redigeres eller fjernes; kombinér med betingelser for kun at handle på produktionsmonitorer.
- **Scheduled Maintenance** — automatisér nedstrøms udmeldinger, når et vedligeholdsvindue oprettes, eller dets tilstand ændres.
- **Status Page Subscriber** — udløs et velkomstforløb, når nogen abonnerer.
- **On-Call Duty Policy** — synkronisér tidsplanændringer til en ekstern oversigt.

Hvis modellen er eksponeret i OneUptime-API'en, kan den næsten med sikkerhed udløse et workflow — søg i trigger-paletten på entitetsnavn.

## Vælg den rigtige trigger

| Hvis du vil… | Brug |
| --- | --- |
| Bygge en knap på et workflow, som nogen klikker på | **Manuel** |
| Køre et job hvert N. minut/time/dag | **Tidsplan** |
| Lade et eksternt system pushe data ind i OneUptime | **Webhook** |
| Reagere på noget, der sker *inde i* OneUptime | **Model-event** |

Workflows kan kun have én trigger. Hvis du har brug for to forskellige startsignaler til at dele størstedelen af logikken, så fold de fælles trin ud i ét workflow og kald det fra to tynde "wrapper"-workflows ved hjælp af komponenten **Execute Workflow** (se [Workflow-komponenter](/docs/workflows/components)).

## Læs videre

- [Workflow-komponenter](/docs/workflows/components) — handlingerne, du kobler efter triggeren.
- [Workflow-variabler](/docs/workflows/variables) — hvordan du læser triggerens returværdier fra nedstrøms noder.
- [Workflow-kørsler & logfiler](/docs/workflows/runs-and-logs) — hvordan du bekræfter, at din trigger udløses.
