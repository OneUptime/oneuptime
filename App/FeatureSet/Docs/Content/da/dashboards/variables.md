# Dashboard-variabler & filtre

En variabel forvandler et enkelt dashboard til en skabelon. Definér en `service`-variabel, og det samme diagram rendres igen for `checkout`, `payments` og `search` — vælg fra en dropdown i toppen i stedet for at bygge tre næsten ens dashboards.

Denne side dækker de fire variabel-typer, hvordan deres værdier injiceres i widget-forespørgsler, samt det globale tidsinterval og de opdateringsstyringer, der ligger ved siden af dem.

## Variabel-typer

Tilføj variabler under **Dashboard → Settings → Variables**. Hver har et navn (refereret som `{{name}}` i widget-forespørgsler), en valgfri etiket og en type.

### Brugerdefineret liste

En statisk drop-down. Du leverer en kommasepareret liste af værdier; den, der ser, vælger en.

Brug den, når: mængden af valg er lille, fast og kun meningsfuld for dit team. `environment` med værdierne `prod, staging, dev`. `region` med værdierne `us-east-1, eu-west-1, ap-south-1`.

### Forespørgsel

Mulighederne for drop-downen beregnes af en ClickHouse-forespørgsel ved rendering-tid.

Brug den, når: valgene er dynamiske og lever i din telemetri. "Hvert kunde-ID, der har logget på inden for de seneste 24 timer" via `SELECT DISTINCT customer_id FROM ...`. Forespørgslen kører mod dit projekts data; behandl resultatet som upålideligt input, selvom det er dine egne data.

### Tekstindtastning

Et frit tekstfelt. Hvad end den, der ser, taster, injiceres.

Brug den, når: du vil have, at dashboardet skal opføre sig som et søgeværktøj. Et "filtrér efter IP" eller "filtrér efter request-ID"-dashboard.

### Telemetri-attribut

Mulighederne er de unikke værdier af en OpenTelemetry-attributnøgle på tværs af dit projekts telemetri, over dashboardets tidsinterval.

Konfigurér **attributnøglen** (f.eks. `k8s.cluster.name`, `service.name`, `host.name`). Widgeten henter unikke værdier fra logs / metrikker / traces og tilbyder dem som en drop-down.

Brug den, når: valgene præcis er de entiteter, du allerede har tagget din telemetri med. Klyngenavn, servicenavn, region, kunde-ID, deployment-miljø — alt, du allerede sender som en OpenTelemetry-ressource- eller span-attribut.

Dette er den mest almindelige variabel-type for service-orienterede dashboards, fordi den auto-opdaterer: når du udsender en ny service tagget `service.name = inventory`, dukker den værdi op i dropdownen, uden at nogen redigerer dashboardet.

## Multi-select

Hver variabel kan konfigureres som **multi-select**. Når den er slået til, vælger den, der ser, en eller flere værdier; dashboardet filtrerer til `value IN (...)` i stedet for `value = ...`.

Brug multi-select, når: du vil kigge på "checkout + payments sammen" uden at forlade dashboardet. Undgå det, når diagrammets matematik ikke går op på tværs af valgte værdier — f.eks. at gennemsnitsberegne gennemsnit.

## Standardværdier

Hver variabel tager en valgfri standard. Dashboardet rendres med standarden, indtil den, der ser, ændrer dropdownen. For offentlige dashboards er standarden, hvad besøgende lander på.

## Hvordan interpolation virker

Hvor som helst en widget-forespørgsel tager et streng-filter — en metrik-forespørgsels `WHERE`-klausul, en liste-widgets filter, et log-streams attribut-match — kan du referere `{{variable_name}}`.

For eksempel kunne et Charts metrik-forespørgsel være:

```
SELECT avg(latency_ms) FROM spans WHERE service.name = '{{service}}'
```

Når `service` er sat til `checkout`, kører forespørgslen med `service.name = 'checkout'`. Når den, der ser, skifter til `payments`, kører forespørgslen igen med `service.name = 'payments'`.

For **Telemetri-attribut**-variabler specifikt kender OneUptime attributnøglen og injicerer filteret i hver widget, der nævner samme attribut — du skal ikke håndredigere hver widgets forespørgsel, når variablen ændres. Det er magien, der får service-skabelongjorte dashboards til at virke ud af boksen.

## Tidsinterval

Dashboardets header har en global **tidsinterval**-vælger. Hver metrik-widget forespørger mod dette vindue. Valg:

- **Presets** — seneste 1 time, 24 timer, 7 dage, 30 dage, 90 dage (afhængigt af din bevaring).
- **Brugerdefineret interval** — vælg start- og slut-tidsstempler.

Tidsintervallet er en del af dashboardets URL — at dele URL'en deler vinduet. Det er praktisk under en hændelse: fasthold tidsintervallet til "10:00–10:30 UTC i dag", og del linket i hændelseskanalen.

## Opdateringsinterval

Ved siden af tidsintervallet vælger du, hvor ofte widgets gen-forespørger:

- **Off** — widgets forespørger én gang ved load.
- **5s / 10s / 30s / 1m / 5m / 15m** — auto-opdatering.

Auto-opdatering er praktisk for en vægmonteret skærm og en visning af en igangværende hændelse. Til ad hoc-undersøgelser: lad det være slukket, så visningen forbliver stabil, mens du scroller.

## Sæt det sammen

Et service-skabelongjort dashboard har typisk:

1. En `service`-variabel af typen **Telemetri-attribut** bundet til `service.name`. Standard: din mest overvågede service. Multi-select: fra (så diagrammer altid viser én service ad gangen).
2. En `environment`-variabel af typen **Brugerdefineret liste**. Standard: `prod`.
3. En `cluster`-variabel af typen **Telemetri-attribut** bundet til `k8s.cluster.name`. Multi-select: til (så du kan rulle op på tværs af klynger).
4. Dashboardets widgets refererer disse variabler i deres filtre.

Resultatet: ét dashboard, hele flådens dækning, et par drop-downs i toppen.

## Læs videre

- [Dashboard-widgets](/docs/dashboards/widgets) — hvordan hver widget forbruger et filter.
- [Deling & offentlige dashboards](/docs/dashboards/sharing) — variabler i URL'er, inklusive deres værdier for delte links.
- [Opret et dashboard](/docs/dashboards/authoring) — lærreds-mekanikken.
