# Variabler & filter

En variabel förvandlar en enskild instrumentpanel till en mall. Definiera en `service`-variabel och samma diagram renderas om för `checkout`, `payments` och `search` — välj från en rullgardinsmeny högst upp istället för att bygga tre nästan identiska instrumentpaneler.

Den här sidan täcker de fyra variabeltyperna, hur deras värden injiceras i widget-frågor, och de globala kontrollerna för tidsintervall och uppdatering som sitter bredvid dem.

## Variabeltyper

Lägg till variabler under **Dashboard → Settings → Variables**. Var och en har ett namn (refereras som `{{name}}` i widget-frågor), en valfri etikett och en typ.

### Custom List

En statisk rullgardinsmeny. Du anger en kommaseparerad lista med värden; tittaren väljer en.

Använd den när: uppsättningen val är liten, fast och bara meningsfull för ditt team. `environment` med värdena `prod, staging, dev`. `region` med värdena `us-east-1, eu-west-1, ap-south-1`.

### Query

Alternativen för rullgardinsmenyn beräknas av en ClickHouse-fråga vid renderingstillfället.

Använd den när: valen är dynamiska och bor i din telemetri. "Varje kund-ID som har loggat in under de senaste 24 timmarna" via `SELECT DISTINCT customer_id FROM ...`. Frågan körs mot ditt projekts data; behandla resultatet som obetrodd indata även om det är din egen data.

### Text Input

Ett fritext-fält. Vad än tittaren skriver injiceras.

Använd den när: du vill att instrumentpanelen ska bete sig som ett sökverktyg. En "filtrera efter IP"- eller "filtrera efter request-ID"-instrumentpanel.

### Telemetry Attribute

Alternativen är de distinkta värdena för en OpenTelemetry-attributnyckel över ditt projekts telemetri, över instrumentpanelens tidsintervall.

Konfigurera **attributnyckeln** (t.ex. `k8s.cluster.name`, `service.name`, `host.name`). Widgeten hämtar distinkta värden från loggar / mätvärden / traces och erbjuder dem som en rullgardinsmeny.

Använd den när: valen är exakt de entiteter du redan har taggat din telemetri med. Klusternamn, tjänstnamn, region, kund-ID, deployment-miljö — vad som helst du redan skickar som en OpenTelemetry-resurs eller span-attribut.

Det här är den vanligaste variabeltypen för tjänstorienterade instrumentpaneler eftersom den auto-uppdateras: när du shippar en ny tjänst taggad `service.name = inventory` dyker det värdet upp i rullgardinsmenyn utan att någon redigerar instrumentpanelen.

## Flerval

Varje variabel kan konfigureras som **multi-select**. När på, plockar tittaren ett eller flera värden; instrumentpanelen filtrerar till `value IN (...)` istället för `value = ...`.

Använd flerval när: du vill titta på "checkout + payments tillsammans" utan att lämna instrumentpanelen. Undvik det när diagram-matematiken inte går ihop över valda värden — t.ex. att medelvärdesberäkna medelvärden.

## Standardvärden

Varje variabel tar ett valfritt standardvärde. Instrumentpanelen renderas med standardvärdet tills tittaren ändrar rullgardinsmenyn. För offentliga instrumentpaneler är standardvärdet det besökare landar på.

## Hur interpolation fungerar

Var som helst där en widget-fråga tar ett strängfilter — en metric-frågas `WHERE`-sats, en listwidgets filter, en loggströms attributmatchning — kan du referera till `{{variable_name}}`.

Till exempel kan en Charts metric-fråga vara:

```
SELECT avg(latency_ms) FROM spans WHERE service.name = '{{service}}'
```

När `service` är satt till `checkout` körs frågan med `service.name = 'checkout'`. När tittaren växlar till `payments` körs frågan om med `service.name = 'payments'`.

För **Telemetry Attribute**-variabler specifikt vet OneUptime attributnyckeln och injicerar filtret i varje widget som nämner samma attribut — du behöver inte handredigera varje widgets fråga när variabeln ändras. Det är magin som får tjänstmallade instrumentpaneler att fungera direkt.

## Tidsintervall

Instrumentpanelens sidhuvud har en global **tidsintervalls-väljare**. Varje metric-widget frågar mot detta fönster. Val:

- **Förinställningar** — Senaste 1 timme, 24 timmar, 7 dagar, 30 dagar, 90 dagar (beroende på din retention).
- **Anpassat intervall** — välj start- och slut-tidsstämplar.

Tidsintervallet är en del av instrumentpanelens URL — att dela URL:en delar fönstret. Det är bekvämt under en incident: pinna tidsintervallet till "10:00–10:30 UTC idag" och dela länken i incidentkanalen.

## Uppdateringsintervall

Bredvid tidsintervallet, välj hur ofta widgetar ska omfrågas:

- **Av** — widgetar frågar en gång vid laddning.
- **5s / 10s / 30s / 1m / 5m / 15m** — autouppdatering.

Autouppdatering är bekvämt för en väggmonterad skärm och en aktuell-incident-vy. För ad hoc-undersökningar, lämna det av så att vyn förblir stabil medan du scrollar.

## Sätta ihop det

En tjänstmallad instrumentpanel har typiskt:

1. En `service`-variabel av typen **Telemetry Attribute** bunden till `service.name`. Standard: din mest bevakade tjänst. Multi-select: av (så att diagram alltid visar en tjänst i taget).
2. En `environment`-variabel av typen **Custom List**. Standard: `prod`.
3. En `cluster`-variabel av typen **Telemetry Attribute** bunden till `k8s.cluster.name`. Multi-select: på (så att du kan rulla upp över kluster).
4. Instrumentpanelens widgetar refererar till dessa variabler i sina filter.

Resultatet: en instrumentpanel, hela flottans täckning, några rullgardinsmenyer högst upp.

## Var läsa vidare

- [Widgetar](/docs/dashboards/widgets) — hur varje widget konsumerar ett filter.
- [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing) — variabler i URL:er, inklusive deras värden för delade länkar.
- [Skapa en instrumentpanel](/docs/dashboards/authoring) — arbetsytans mekanik.
