# Variabler & filtre

En variabel gjør ett enkelt dashbord om til en mal. Legg til en `service`-variabel på dashbordet ditt, og de samme diagrammene rendres på nytt for `checkout`, `payments` eller `search` — seerne velger fra en nedtrekksliste øverst i stedet for at du bygger tre nesten identiske dashbord.

## Variabeltyper

Legg til variabler under **Dashbord → Innstillinger → Variabler**. Hver variabel har et navn (brukt som `{{name}}` i widgetene dine), en valgfri etikett og en type.

### Egendefinert liste

En statisk nedtrekksliste. Du skriver inn alternativene selv.

Bruk den når: valgene er små og faste. `environment` med verdiene `prod, staging, dev`. `region` med verdiene `us-east-1, eu-west-1, ap-south-1`.

### Spørring

Alternativene kommer fra en spørring mot dataene dine.

Bruk den når: valgene endres over tid og du vil at nedtrekkslisten skal følge med. "Hver kunde-ID sett i de siste 24 timene." Spørringen kjøres mot prosjektets data og resultatene blir nedtrekkslisten.

### Tekst-inndata

Et fritekstfelt. Det seeren skriver blir brukt.

Bruk den når: du vil at dashbordet skal fungere som et søkeverktøy. Filtrer etter IP-adresse, forespørsel-ID eller en hvilken som helst annen fritekstverdi.

### Telemetri-attributt

Alternativene er de distinkte verdiene av et attributt i telemetrien din over dashbordets tidsperiode.

Konfigurer **attributt-nøkkelen** (for eksempel `service.name`, `host.name`, `k8s.cluster.name`). Nedtrekkslisten fylles med hver distinkt verdi sett i loggene, metrikkene og sporingene dine.

Bruk den når: valgene matcher taggene du allerede sender med telemetrien din. Dette er den vanligste typen fordi den oppdateres automatisk — når du sender en ny tjeneste merket `service.name = inventory`, dukker det navnet opp i nedtrekkslisten uten at du redigerer dashbordet.

## Fler-valg

Hver variabel kan tillate flere valg. Når det er på, kan seeren velge én eller flere verdier; dashbordet filtrerer til hvilken som helst av dem.

Bruk fler-valg når: du vil sammenligne "checkout og payments sammen" uten å forlate dashbordet. Unngå det når matematikken ikke fungerer på tvers av valgte verdier (for eksempel å beregne gjennomsnitt av gjennomsnitt).

## Standardverdier

Hver variabel kan ha en standardverdi. Dashbordet rendres med standardverdien til seeren endrer den. For offentlige dashbord er standarden det besøkende ser først.

## Hvordan bruke en variabel i en widget

Hvor enn en widget tar et filter — en metrikks `WHERE`, en listes filter, en loggstrøms attributt-match — kan du bruke `{{variable_name}}`.

For eksempel et diagram filtrert etter tjeneste:

```
service.name = '{{service}}'
```

Når nedtrekkslisten er satt til `checkout`, filtrerer diagrammet til checkout-tjenesten. Når seeren bytter til `payments`, rendres diagrammet på nytt for payments.

For **Telemetri-attributt**-variabler vet OneUptime hvilket attributt variabelen mapper til og bruker filteret på hver widget som bruker det samme attributtet — du trenger ikke redigere hver widget for hånd.

## Tidsperiode

Dashbordets header har en global tidsperiode. Hver metrikk-widget spør mot dette vinduet. Alternativer:

- **Forhåndsinnstillinger** — siste time, 24 timer, 7 dager, 30 dager, 90 dager (avhengig av dataoppbevaringen din).
- **Egendefinert** — velg et start- og sluttidspunkt.

Tidsperioden er en del av dashbordets URL — å dele URL-en deler vinduet. Nyttig under en hendelse: fest tidsperioden til "10:00–10:30 UTC i dag" og lim inn lenken i hendelseskanalen.

## Oppdateringsintervall

Ved siden av tidsperioden, velg hvor ofte widgets spør på nytt:

- **Av** — widgets spør én gang når siden lastes.
- **5s / 10s / 30s / 1m / 5m / 15m** — auto-oppdatering.

Auto-oppdatering er bra for en vegg-TV eller en live hendelsesvisning. La det være av når du undersøker slik at visningen står stille mens du ser.

## Sette det sammen

Et tjeneste-malet dashbord har vanligvis:

1. En `service`-variabel av typen **Telemetri-attributt** for `service.name`. Standard: den tjenesten du følger mest med på. Fler-valg av (slik at diagrammer alltid viser én om gangen).
2. En `environment`-variabel av typen **Egendefinert liste**. Standard: `prod`.
3. En `cluster`-variabel av typen **Telemetri-attributt** for `k8s.cluster.name`. Fler-valg på (slik at du kan sammenligne på tvers av klynger).
4. Widgets som refererer til disse variablene i filtrene sine.

Resultatet: ett dashbord, hver tjeneste dekket, tre nedtrekkslister øverst.

## Hvor du leser videre

- [Widgets](/docs/dashboards/widgets) — hvordan hver widget bruker et filter.
- [Deling & offentlige dashbord](/docs/dashboards/sharing) — variabler og delte lenker.
- [Lage et dashbord](/docs/dashboards/authoring) — lerret-mekanikken.
