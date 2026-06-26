# Variabler & filter

En variabel förvandlar en enskild instrumentpanel till en mall. Lägg till en `service`-variabel i din instrumentpanel och samma diagram renderas om för `checkout`, `payments` eller `search` — tittare väljer från en rullgardinsmeny högst upp istället för att du bygger tre nästan identiska instrumentpaneler.

## Variabeltyper

Lägg till variabler under **Dashboard → Settings → Variables**. Varje variabel har ett namn (används som `{{name}}` i dina widgetar), en valfri etikett och en typ.

### Custom List

En statisk rullgardinsmeny. Du skriver alternativen själv.

Använd den när: valen är få och fasta. `environment` med värdena `prod, staging, dev`. `region` med värdena `us-east-1, eu-west-1, ap-south-1`.

### Query

Alternativen kommer från en fråga mot din data.

Använd den när: valen ändras över tid och du vill att rullgardinsmenyn ska hänga med. "Varje kund-ID som setts de senaste 24 timmarna." Frågan körs mot ditt projekts data och resultaten blir rullgardinsmenyn.

### Text Input

Ett fritt textfält. Vad tittaren än skriver används.

Använd den när: du vill att instrumentpanelen ska fungera som ett sökverktyg. Filtrera efter IP-adress, request-ID eller något annat fritt värde.

### Telemetry Attribute

Alternativen är de unika värdena av ett attribut i din telemetri över instrumentpanelens tidsintervall.

Konfigurera **attributnyckeln** (till exempel `service.name`, `host.name`, `k8s.cluster.name`). Rullgardinsmenyn fylls med varje unikt värde som setts i dina loggar, mätvärden och traces.

Använd den när: valen matchar taggarna du redan skickar med din telemetri. Detta är den vanligaste typen eftersom den uppdateras automatiskt — när du skeppar en ny tjänst taggad `service.name = inventory` dyker det namnet upp i rullgardinsmenyn utan att du redigerar instrumentpanelen.

## Multi-select

Varje variabel kan tillåta flera val. När det är på kan tittaren välja ett eller flera värden; instrumentpanelen filtrerar till något av dem.

Använd multi-select när: du vill jämföra "checkout och payments tillsammans" utan att lämna instrumentpanelen. Undvik det när matematiken inte fungerar över valda värden (till exempel medelvärde av medelvärden).

## Standardvärden

Varje variabel kan ha ett standardvärde. Instrumentpanelen renderas med standardvärdet tills tittaren ändrar det. För offentliga instrumentpaneler är standardvärdet vad besökare ser först.

## Hur du använder en variabel i en widget

Var som helst en widget tar ett filter — ett mätvärdes `WHERE`, en listas filter, en loggströms attributmatchning — kan du använda `{{variable_name}}`.

Till exempel ett diagram filtrerat efter tjänst:

```
service.name = '{{service}}'
```

När rullgardinsmenyn är inställd på `checkout` filtrerar diagrammet till checkout-tjänsten. När tittaren byter till `payments` renderas diagrammet om för payments.

För **Telemetry Attribute**-variabler vet OneUptime vilket attribut variabeln mappar till och tillämpar filtret på varje widget som använder samma attribut — du behöver inte redigera varje widget för hand.

## Tidsintervall

Instrumentpanelens sidhuvud har ett globalt tidsintervall. Varje mätvärdeswidget frågar mot detta fönster. Alternativ:

- **Förinställningar** — senaste timmen, 24 timmar, 7 dagar, 30 dagar, 90 dagar (beroende på din datakvarhållning).
- **Anpassat** — välj en start- och sluttid.

Tidsintervallet är en del av instrumentpanelens URL — att dela URL:en delar fönstret. Användbart under en incident: fäst tidsintervallet till "10:00–10:30 UTC idag" och klistra in länken i incidentkanalen.

## Uppdateringsintervall

Bredvid tidsintervallet, välj hur ofta widgetar frågar om data:

- **Av** — widgetar frågar en gång när sidan laddas.
- **5s / 10s / 30s / 1m / 5m / 15m** — automatisk uppdatering.

Automatisk uppdatering är bra för en vägghängd skärm eller en live-incidentvy. Lämna den av när du felsöker så att vyn ligger stilla medan du tittar.

## Sätta ihop det

En tjänstemallad instrumentpanel har vanligtvis:

1. En `service`-variabel av typen **Telemetry Attribute** för `service.name`. Standard: din mest bevakade tjänst. Multi-select av (så att diagrammen alltid visar en åt gången).
2. En `environment`-variabel av typen **Custom List**. Standard: `prod`.
3. En `cluster`-variabel av typen **Telemetry Attribute** för `k8s.cluster.name`. Multi-select på (så att du kan jämföra över kluster).
4. Widgetar som refererar till dessa variabler i sina filter.

Resultatet: en instrumentpanel, varje tjänst täckt, tre rullgardinsmenyer högst upp.

## Läs vidare

- [Widgetar](/docs/dashboards/widgets) — hur varje widget använder ett filter.
- [Delning & offentliga instrumentpaneler](/docs/dashboards/sharing) — variabler och delade länkar.
- [Skapa en instrumentpanel](/docs/dashboards/authoring) — arbetsytans mekanik.
