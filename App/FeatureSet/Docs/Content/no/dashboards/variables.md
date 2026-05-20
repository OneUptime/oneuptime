# Variabler & filtre

En variabel gjør et enkelt dashbord om til en mal. Definer en `service`-variabel, og det samme diagrammet rendres på nytt for `checkout`, `payments` og `search` — velg fra en nedtrekksmeny øverst i stedet for å bygge tre nesten identiske dashbord.

Denne siden dekker de fire variabeltypene, hvordan verdiene deres injiseres i widget-spørringer, og de globale tidsperiode- og oppdateringskontrollene som sitter ved siden av dem.

## Variabeltyper

Legg til variabler under **Dashbord → Innstillinger → Variabler**. Hver har et navn (referert som `{{name}}` i widget-spørringer), en valgfri etikett og en type.

### Custom List

En statisk nedtrekksmeny. Du leverer en kommaseparert liste med verdier; seeren velger én.

Bruk den når: settet med valg er lite, fast og meningsfullt kun for teamet ditt. `environment` med verdier `prod, staging, dev`. `region` med verdier `us-east-1, eu-west-1, ap-south-1`.

### Query

Alternativene for nedtrekksmenyen beregnes av en ClickHouse-spørring ved render-tid.

Bruk den når: valgene er dynamiske og lever i telemetrien din. "Hver kunde-ID som har logget de siste 24 timene" via `SELECT DISTINCT customer_id FROM ...`. Spørringen kjører mot prosjektets data; behandle resultatet som ikke-betrodd input selv om det er dine egne data.

### Text Input

Et fritekstfelt. Det seeren skriver injiseres.

Bruk den når: du vil at dashbordet skal fungere som et søkeverktøy. Et "filtrer etter IP"- eller "filtrer etter forespørsels-ID"-dashbord.

### Telemetry Attribute

Alternativene er de distinkte verdiene av en OpenTelemetry-attributtnøkkel på tvers av prosjektets telemetri, over dashbordets tidsperiode.

Konfigurer **attributtnøkkelen** (f.eks. `k8s.cluster.name`, `service.name`, `host.name`). Widgeten henter distinkte verdier fra logger / metrikker / sporinger og tilbyr dem som en nedtrekksmeny.

Bruk den når: valgene er nøyaktig de entitetene du allerede har tagget telemetrien din med. Klyngenavn, tjenestenavn, region, kunde-ID, distribusjonsmiljø — alt du allerede sender som en OpenTelemetry-ressurs eller span-attributt.

Dette er den vanligste variabeltypen for tjenesteorienterte dashbord fordi den auto-oppdateres: når du leverer en ny tjeneste tagget `service.name = inventory`, dukker den verdien opp i nedtrekksmenyen uten at noen redigerer dashbordet.

## Flervalg

Hver variabel kan konfigureres til **flervalg**. Når på velger seeren én eller flere verdier; dashbordet filtrerer til `value IN (...)` i stedet for `value = ...`.

Bruk flervalg når: du vil se på "checkout + payments sammen" uten å forlate dashbordet. Unngå det når diagram-matematikken ikke går opp på tvers av valgte verdier — f.eks. å gjennomsnittsberegne gjennomsnitt.

## Standardverdier

Hver variabel tar en valgfri standard. Dashbordet rendres med standarden til seeren endrer nedtrekksmenyen. For offentlige dashbord er standarden det besøkende lander på.

## Hvordan interpolering fungerer

Hvor som helst en widget-spørring tar et strengfilter — en metrikkspørrings `WHERE`-klausul, en liste-widgets filter, en loggstrøms attributt-treff — kan du referere `{{variable_name}}`.

For eksempel kan et Charts metrikkspørring være:

```
SELECT avg(latency_ms) FROM spans WHERE service.name = '{{service}}'
```

Når `service` er satt til `checkout`, kjører spørringen med `service.name = 'checkout'`. Når seeren bytter til `payments`, kjøres spørringen på nytt med `service.name = 'payments'`.

For **Telemetry Attribute**-variabler spesifikt kjenner OneUptime attributtnøkkelen og injiserer filteret inn i hver widget som nevner samme attributt — du trenger ikke å håndredigere hver widgets spørring når variabelen endres. Dette er magien som gjør at tjeneste-malede dashbord fungerer rett ut av boksen.

## Tidsperiode

Dashbord-toppen har en global **tidsperiode**-velger. Hver metrikk-widget spør mot dette vinduet. Valg:

- **Forhåndsinnstillinger** — Siste 1 time, 24 timer, 7 dager, 30 dager, 90 dager (avhengig av oppbevaringen din).
- **Egendefinert periode** — velg start- og slutt-tidsstempler.

Tidsperioden er en del av dashbordets URL — å dele URL-en deler vinduet. Dette er praktisk under en hendelse: fest tidsperioden til "10:00–10:30 UTC i dag" og del lenken i hendelseskanalen.

## Oppdateringsintervall

Ved siden av tidsperioden, velg hvor ofte widgets spør på nytt:

- **Av** — widgets spør én gang ved lasting.
- **5s / 10s / 30s / 1m / 5m / 15m** — auto-oppdatering.

Auto-oppdatering er praktisk for en veggmontert skjerm og en nåværende-hendelse-visning. For ad-hoc undersøkelse, la den være av slik at visningen forblir stabil mens du blar.

## Sette det sammen

Et tjeneste-malet dashbord har typisk:

1. En `service`-variabel av typen **Telemetry Attribute** bundet til `service.name`. Standard: din mest overvåkede tjeneste. Flervalg: av (slik at diagrammer alltid viser én tjeneste om gangen).
2. En `environment`-variabel av typen **Custom List**. Standard: `prod`.
3. En `cluster`-variabel av typen **Telemetry Attribute** bundet til `k8s.cluster.name`. Flervalg: på (slik at du kan rulle opp på tvers av klynger).
4. Dashbordets widgets refererer disse variablene i filtrene sine.

Resultatet: ett dashbord, hele flåtens dekning, noen få nedtrekksmenyer øverst.

## Les videre

- [Widgets](/docs/dashboards/widgets) — hvordan hver widget konsumerer et filter.
- [Deling & offentlige dashbord](/docs/dashboards/sharing) — variabler i URL-er, inkludert verdiene deres for delte lenker.
- [Opprette et dashbord](/docs/dashboards/authoring) — lerretsmekanikken.
