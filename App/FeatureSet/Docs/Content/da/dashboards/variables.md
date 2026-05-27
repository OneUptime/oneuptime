# Variabler & filtre

En variabel forvandler et enkelt dashboard til en skabelon. Tilføj en `service`-variabel til dit dashboard, og de samme diagrammer rendres igen for `checkout`, `payments` eller `search` — besøgende vælger fra en dropdown i toppen i stedet for, at du bygger tre næsten ens dashboards.

## Variabeltyper

Tilføj variabler under **Dashboard → Settings → Variables**. Hver variabel har et navn (brugt som `{{name}}` i dine widgets), en valgfri label og en type.

### Custom List

En statisk dropdown. Du skriver selv mulighederne.

Brug den, når: valgene er små og faste. `environment` med værdierne `prod, staging, dev`. `region` med værdierne `us-east-1, eu-west-1, ap-south-1`.

### Query

Mulighederne kommer fra en forespørgsel mod dine data.

Brug den, når: valgene ændrer sig over tid, og du vil have dropdownen til at følge med. "Hvert kunde-ID set i de seneste 24 timer." Forespørgslen kører mod dit projekts data, og resultaterne bliver dropdownen.

### Text Input

Et fritekst-felt. Det den besøgende skriver, bruges.

Brug den, når: du vil have dashboardet til at fungere som et søgeværktøj. Filtrér efter IP-adresse, request-ID eller enhver anden fritekstværdi.

### Telemetry Attribute

Mulighederne er de forskellige værdier af en attribut i din telemetri over dashboardets tidsinterval.

Konfigurér **attribute key** (for eksempel `service.name`, `host.name`, `k8s.cluster.name`). Dropdownen fyldes med hver forskellig værdi set i dine logs, metrikker og traces.

Brug den, når: valgene matcher de tags, du allerede sender med din telemetri. Dette er den mest almindelige type, fordi den opdaterer sig automatisk — når du udruller en ny service tagget `service.name = inventory`, dukker det navn op i dropdownen, uden at du redigerer dashboardet.

## Multi-select

Hver variabel kan tillade flere valg. Når slået til, kan den besøgende vælge en eller flere værdier; dashboardet filtrerer til en hvilken som helst af dem.

Brug multi-select, når: du vil sammenligne "checkout og payments sammen" uden at forlade dashboardet. Undgå det, når matematikken ikke virker på tværs af valgte værdier (for eksempel at tage gennemsnit af gennemsnit).

## Standardværdier

Hver variabel kan have en standard. Dashboardet rendres med standarden, indtil den besøgende ændrer den. For offentlige dashboards er standarden det, besøgende ser først.

## Sådan bruger du en variabel i en widget

Hvor end en widget tager et filter — en metriks `WHERE`, en listes filter, en log-streams attribut-match — kan du bruge `{{variable_name}}`.

For eksempel et diagram filtreret efter service:

```
service.name = '{{service}}'
```

Når dropdownen er sat til `checkout`, filtrerer diagrammet til checkout-servicen. Når den besøgende skifter til `payments`, rendres diagrammet igen for payments.

For **Telemetry Attribute**-variabler ved OneUptime, hvilken attribut variablen er knyttet til, og anvender filteret på hver widget, der bruger samme attribut — du behøver ikke at redigere hver widget i hånden.

## Tidsinterval

Dashboardets header har et globalt tidsinterval. Hver metrik-widget forespørger mod dette vindue. Muligheder:

- **Forudindstillinger** — sidste time, 24 timer, 7 dage, 30 dage, 90 dage (afhængigt af din datalagring).
- **Brugerdefineret** — vælg en start- og sluttid.

Tidsintervallet er en del af dashboardets URL — at dele URL'en deler vinduet. Nyttigt under en hændelse: fastgør tidsintervallet til "10:00–10:30 UTC i dag", og indsæt linket i hændelseskanalen.

## Refresh-interval

Ved siden af tidsintervallet vælger du, hvor ofte widgets re-forespørger:

- **Off** — widgets forespørger én gang, når siden indlæses.
- **5s / 10s / 30s / 1m / 5m / 15m** — auto-refresh.

Auto-refresh er godt til en vægmonteret skærm eller en live-hændelsesvisning. Lad det være slukket, når du undersøger, så visningen holder sig stille, mens du kigger.

## Sat sammen

Et service-skabelonbaseret dashboard har typisk:

1. En `service`-variabel af typen **Telemetry Attribute** for `service.name`. Standard: din mest overvågede service. Multi-select fra (så diagrammer altid viser én ad gangen).
2. En `environment`-variabel af typen **Custom List**. Standard: `prod`.
3. En `cluster`-variabel af typen **Telemetry Attribute** for `k8s.cluster.name`. Multi-select til (så du kan sammenligne på tværs af clusters).
4. Widgets, der refererer til disse variabler i deres filtre.

Resultatet: ét dashboard, hver service dækket, tre dropdowns i toppen.

## Læs videre

- [Widgets](/docs/dashboards/widgets) — hvordan hver widget bruger et filter.
- [Deling & offentlige dashboards](/docs/dashboards/sharing) — variabler og delte links.
- [Opret et dashboard](/docs/dashboards/authoring) — lærredsmekanikken.
