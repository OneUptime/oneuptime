# Uitzonderingen-monitor

Een uitzonderingen-monitor telt binnen een tijdvenster de uitzonderingen die uw services aan OneUptime melden en die aan uw filters voldoen (bericht, uitzonderingstype, omgeving, service). Wanneer het aantal aan uw criteria voldoet, wijzigt hij de status van de monitor, maakt hij een waarschuwing aan of meldt hij een incident. Gebruik hem om gewaarschuwd te worden voor elke nieuwe crash in productie, voor één uitzonderingstype, of voor een plotselinge toename van fouten.

:::cards
- [De monitor maken](#een-uitzonderingen-monitor-maken): Kies welke uitzonderingen u telt en wanneer u wordt gewaarschuwd.
- [Omgevingen](#omgevingen): Beperk de monitor tot `production`.
- [Hoe hij wordt geëvalueerd](#hoe-hij-wordt-geëvalueerd): Wat er wordt geteld, en wat het oplossen van een uitzondering doet.
- [Criteria](#criteria): De voorwaarden en de standaardwaarden.
:::

## Hoe het werkt

```mermaid title="Elke minuut telt en controleert een uitzonderingen-monitor"
flowchart TB
    App["Uw services"] -->|OpenTelemetry| Store[("Uitzonderingen in OneUptime")]
    Store --> Skip["Opgeloste en gearchiveerde<br/>uitzonderingen weglaten"]
    Skip --> Count["Overeenkomende uitzonderingen tellen<br/>in het tijdvenster"]
    Count --> Check{"Criteria vervuld?"}
    Check -->|"Eerste overeenkomst"| Act["Status wijzigen,<br/>waarschuwing of incident"]
    Check -->|Geen| Default["Standaardstatus"]
```

Elke minuut telt OneUptime de uitzonderingen die aan de filters van de monitor voldoen en binnen het tijdvenster zijn opgetreden, en laat daarbij de uitzonderingen weg die u als opgelost hebt gemarkeerd of hebt gearchiveerd. Dat aantal vergelijkt het van boven naar beneden met de criteria van de monitor, en het eerste criterium dat overeenkomt, bepaalt wat er gebeurt. Komt er geen overeen, dan gaat de monitor terug naar zijn standaardstatus.

## Voordat u begint

- Uw services sturen uitzonderingen naar OneUptime via OpenTelemetry. Zie [OpenTelemetry](/docs/telemetry/open-telemetry).
- Om een monitor tot een omgeving te beperken, moeten uw services het resource-attribuut `deployment.environment` instellen.

## Een uitzonderingen-monitor maken

:::steps
### Een nieuwe monitor beginnen

Ga naar **Monitoren** en klik op **Monitor maken**. Of klik op de pagina van een uitzondering op **Monitor maken** naast **Oplossen**: de nieuwe monitor bewaakt vanaf het begin het type van die uitzondering in zijn service, en waarschuwt wanneer die opnieuw optreedt.

### Exceptions kiezen

Klik onder **Monitortype** op **Meer monitortypen** en kies **Uitzonderingen** onder **Telemetrie**, of typ `exceptions` in het zoekvak. Vul een **Naam** in en klik dan op **Volgende**.

### Kiezen waarover de monitor u informeert

Kies onder **Waarover moet deze monitor je informeren?** voor **Elke uitzondering** of **Te veel uitzonderingen**. Elke keuze vult de regel in, die u verderop kunt wijzigen. Kies **Iets anders** om hem zelf in te stellen. **Een nieuwe uitzondering**, **Een opgeloste uitzondering komt terug** en **Uitzonderingen pieken** waarschuwen bij een uitzondering die voor het eerst wordt gezien, bij een die terugkwam nadat u haar had opgelost, en bij een stijging ver boven wat normaal is voor dat uur van de week.

### De te tellen uitzonderingen kiezen

Stel in **Te bewaken uitzonderingen** de velden **Bericht bevat**, **Uitzonderingstypen** en **Omgevingen** in. Een filter dat u leeg laat, komt met elke uitzondering overeen. **Overeenkomende uitzonderingen** onder de filters toont de uitzonderingen waarmee ze nu overeenkomen.

### Verder verfijnen (optioneel)

Open **Meer velden** om te filteren op telemetrieservice of infrastructuurentiteit, of om ook opgeloste en gearchiveerde uitzonderingen te tellen.

### Zeggen wanneer er gewaarschuwd wordt

Kies in **Wanneer waarschuwen** een **Voorwaarde**, het **Aantal uitzonderingen** en een **Tijdvenster**. De zin eronder zegt de regel in gewone woorden terug. De grafiek daaronder telt de overeenkomende uitzonderingen in elk venster van de afgelopen uren, tekent het getal van de regel als lijn en zegt hoe vaak de regel zou hebben gewaarschuwd. De knop ervan stelt een getal voor dat de regel in die tijd niet zou hebben overschreden. **Waarschuwen bij** kiest wat de regel vergelijkt: **Uitzonderingen**, **Nieuwe uitzonderingen**, **Teruggekomen uitzonderingen** of **Een stijging boven het gewone**. De grafiek wordt alleen voor **Uitzonderingen** getekend. Met **Ongewoon hoog**, zoals **Uitzonderingen pieken** instelt, valt er geen getal in te vullen: kies in plaats daarvan een **Gevoeligheid**.

### Kiezen wat er gebeurt

Kies in **Wat er gebeurt** voor **Een waarschuwing maken**, **Een incident melden** of **Beide**, en geef het een titel en een ernst. Zolang de regel overeenkomt, toont de monitor de status onder **Meer velden**; komt hij niet meer overeen, dan gaat de monitor terug naar zijn standaardstatus en lost de waarschuwing of het incident zichzelf op.

### De monitor maken

Klik op **Monitor maken**. De monitor opent op zijn pagina **Overzicht**, en zijn eerste evaluatie volgt binnen een minuut.
:::

## Wat hij opvraagt

| Veld | Waarmee het overeenkomt | Standaard |
| --- | --- | --- |
| **Bericht bevat** | Uitzonderingen waarvan het bericht deze tekst bevat, zonder onderscheid tussen hoofd- en kleine letters. | Leeg: elke uitzondering |
| **Uitzonderingstypen** | Uitzonderingen van een van deze typen, gescheiden door komma's, zoals `TypeError, NullReferenceException`. De typenaam moet precies overeenkomen. | Leeg: elk type |
| **Omgevingen** | Uitzonderingen uit een van deze omgevingen, gescheiden door komma's (zie [Omgevingen](#omgevingen)). | Leeg: elke omgeving |
| **Tijdvenster** (in **Wanneer waarschuwen**) | Uitzonderingen van de laatste 5 seconden tot de laatste 24 uur. | **Laatste 5 minuten** |
| **Filteren op service** (onder **Meer velden**) | Uitzonderingen van een van de gekozen services. | Leeg: elke service |
| **Filteren op infrastructuurentiteit** (onder **Meer velden**) | Uitzonderingen van een van de gekozen hosts, pods, containers en andere entiteiten. | Leeg: elke entiteit |
| **Opgeloste uitzonderingen opnemen** (onder **Meer velden**) | Ook uitzonderingen tellen die als opgelost zijn gemarkeerd. | Uit |
| **Gearchiveerde uitzonderingen opnemen** (onder **Meer velden**) | Ook gearchiveerde uitzonderingen tellen. | Uit |

Alle filters die u instelt, moeten overeenkomen voordat een uitzondering wordt geteld.

### Omgevingen

Omgevingen komen uit het OpenTelemetry-resource-attribuut `deployment.environment` van elke uitzondering, dezelfde waarde waarop de uitzonderingenverkenner filtert met `env:production`. Vul één omgeving in, of meerdere gescheiden door komma's; een uitzondering wordt geteld wanneer haar omgeving met een ervan overeenkomt.

De vergelijking is exact en hoofdlettergevoelig: `production` komt niet overeen met `Production` of `prod`. Uitzonderingen zonder omgeving worden niet geteld wanneer dit filter is ingesteld. Laat het leeg om uitzonderingen uit elke omgeving te tellen, ook die zonder omgeving.

Het omgevingsfilter wordt met elk ander filter gecombineerd, dus een monitor die beperkt is tot één telemetrieservice en `production` telt alleen de productie-uitzonderingen van die service.

Wanneer u de monitor via de API maakt, stelt u `environments` in de `exceptionMonitor` van de stap in op een lijst met omgevingsnamen:

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

## Hoe hij wordt geëvalueerd

- **Elke minuut.** Een uitzonderingen-monitor wordt niet door sondes gecontroleerd, dus hij heeft geen interval om in te stellen en geen pagina **Sondes en interval**.
- **Voorvallen, geen uitzonderingstypen.** De monitor telt elke keer dat een overeenkomende uitzondering binnen het **Tijdvenster** is opgetreden. Eén uitzondering die 40 keer wordt gegooid, telt als 40.
- **Opgeloste en gearchiveerde uitzonderingen worden weggelaten.** Tenzij u **Opgeloste uitzonderingen opnemen** of **Gearchiveerde uitzonderingen opnemen** inschakelt, tellen de voorvallen van een uitzondering die u als opgelost hebt gemarkeerd of hebt gearchiveerd niet mee. Een uitzondering als opgelost markeren kan dus het incident sluiten dat ze opende. Wanneer een opgeloste uitzondering opnieuw optreedt, wordt ze automatisch weer onopgelost en opnieuw geteld.
- **Geen uitzonderingen is een aantal van 0.**
- **De onderbreking van OneUptime zelf is geen stilte.** Zolang het tijdvenster tijd bevat waarin OneUptime zelf geen gegevens ontving (het startte opnieuw, werd geüpgraded of werkte een achterstand weg), wacht de controle: de status verandert niet, en er wordt geen incident of waarschuwing geopend of opgelost. Zie [Als OneUptime geen gegevens ontvangt](/docs/monitor/when-oneuptime-is-not-receiving).
- **Criteria van boven naar beneden.** Het eerste criterium dat overeenkomt, beslist, dus zet het ernstigste bovenaan.

Elke statuswijziging wordt, met de reden ervan, vastgelegd op de **Statustijdlijn** van de monitor.

## Criteria

De criteria van een uitzonderingen-monitor hebben vier soorten **Filtertype**: **Aantal uitzonderingen**, het aantal uitzonderingen dat in het venster overeenkwam, en **Nieuwe uitzonderingen**, **Opnieuw opgetreden uitzonderingen** en **Toename van uitzonderingen (in %)**, die hieronder worden beschreven. **Wanneer waarschuwen** stelt één criterium in, met als **Voorwaarde** **Meer dan**, **Minstens**, **Minder dan**, **Hoogstens**, **Precies**, **Ongewoon hoog**, **Ongewoon laag** of **Ongewoon hoog of laag**. Voor meerdere criteria, of één met meer dan één filter, klikt u op **Bewerken als eigen criteria** onder **Meer velden** in **Wat er gebeurt**: elk criterium daar heeft een **Filtervoorwaarde** en een **Waarde**.

| Filtervoorwaarde | Komt overeen wanneer het aantal uitzonderingen… |
| --- | --- |
| **Groter dan** | boven de waarde ligt |
| **Groter dan of gelijk aan** | gelijk is aan de waarde of hoger |
| **Kleiner dan** | onder de waarde ligt |
| **Kleiner dan of gelijk aan** | gelijk is aan de waarde of lager |
| **Gelijk aan** | precies de waarde is |
| **Niet gelijk aan** | alles behalve de waarde is |
| **Afwijkend hoog** | boven het verwachte bereik voor dit uur van de week ligt |
| **Afwijkend laag** | onder dat bereik ligt |
| **Afwijkend** | buiten dat bereik ligt, in welke richting ook |

De anomaliecondities hebben geen **Waarde**. Kies een **Gevoeligheid** (Laag, Gemiddeld, de standaard, of Hoog) en, in de eigen criteria, een **Baseline-venster** van 14 (de standaard), 28, 60 of 90 dagen. Alleen **Aantal uitzonderingen** heeft ze: zie [Pieken ten opzichte van wat normaal is](#pieken-ten-opzichte-van-wat-normaal-is).

Een uitzonderingen-monitor die in Monitor maken is aangemaakt, begint met de regel van wat u onder **Waarover moet deze monitor je informeren?** hebt gekozen:

| Keuze | Regel | Wat er gebeurt |
| --- | --- | --- |
| **Elke uitzondering** | **Meer dan** `0` in **Laatste 5 minuten** | Maakt een waarschuwing, die zichzelf oplost |
| **Te veel uitzonderingen** | **Meer dan** `20` in **Laatste 5 minuten** | Maakt een waarschuwing, die zichzelf oplost |
| **Een nieuwe uitzondering** | **Nieuwe uitzonderingen**: **Meer dan** `0` in **Laatste 10 minuten** | Maakt een waarschuwing, die zichzelf oplost |
| **Een opgeloste uitzondering komt terug** | **Teruggekomen uitzonderingen**: **Meer dan** `0` in **Laatste 10 minuten** | Maakt een waarschuwing, die zichzelf oplost |
| **Uitzonderingen pieken** | **Ongewoon hoog** in **Laatste 15 minuten** | Maakt een waarschuwing, die zichzelf oplost |

Een uitzonderingen-monitor die via de API of Terraform zonder criteria is aangemaakt, begint met deze criteria:

| Criterium | Filter | Effect |
| --- | --- | --- |
| Check if … has exceptions | **Aantal uitzonderingen** **Groter dan** `0` | Zet de monitor offline en meldt een incident, dat automatisch wordt opgelost |
| Check if … has no exceptions | **Aantal uitzonderingen** **Gelijk aan** `0` | Zet de monitor online |

## Nieuwe, teruggekomen en piekende uitzonderingen

Naast hoeveel uitzonderingen er waren, kan een uitzonderingen-monitor waarschuwen bij waar een error tracker mee begint. Elk wordt alleen gelezen wanneer een criterium het controleert.

| Filtertype | Wat het telt in het venster |
| --- | --- |
| **Nieuwe uitzonderingen** | Overeenkomende uitzonderingen die voor het eerst zijn gezien en niet opgelost of gearchiveerd zijn. |
| **Opnieuw opgetreden uitzonderingen** | Overeenkomende uitzonderingen die u hebt opgelost, die terugkwamen en nog open zijn. |
| **Toename van uitzonderingen (in %)** | Hoeveel het aantal overeenkomende uitzonderingen boven het gewone ligt: de dag voor het venster, per venster van dezelfde lengte, minstens één. Tien uitzonderingen na een rustige dag geven 900%. |

Nieuwe en teruggekomen uitzonderingen worden gefilterd op service, uitzonderingstype, omgeving en bericht, en ook op infrastructuurentiteit: een uitzondering telt mee wanneer een van haar voorvallen in het venster van een van de gekozen entiteiten kwam.

## Pieken ten opzichte van wat normaal is

**Uitzonderingen pieken** vergelijkt het venster met dezelfde uren van de weken ervoor, niet met een vast getal. Een piek op maandagochtend is normaal op een maandagochtend, hetzelfde aantal om 3 uur op een zondag niet, en een trage stijging over meerdere dagen is te zien zodra die het bereik van vorige week verlaat.

| Instelling | Wat het doet | Standaard |
| --- | --- | --- |
| **Gevoeligheid** | Hoe ver buiten het gebruikelijke bereik een venster moet liggen: 4 standaardafwijkingen bij Laag, 3 bij Gemiddeld, 2 bij Hoog. | Gemiddeld |
| **Baseline-venster** (onder **Meer velden**) | Van hoeveel geschiedenis wordt geleerd: 14, 28, 60 of 90 dagen. | 14 dagen |
| **Standaardafwijkingen** (onder **Meer velden**) | Een eigen getal in plaats van wat **Gevoeligheid** instelt. | Leeg |
| **Minimum aantal uitzonderingen** (onder **Meer velden**) | Het kleinste aantal uitzonderingen in een venster dat kan waarschuwen: 20 bij Laag, 10 bij Gemiddeld, 5 bij Hoog. | Leeg |

- **Het gebruikt uw filters.** De geschiedenis wordt gelezen met de filters van de monitor zelf, dus een monitor op één uitzonderingstype wordt vergeleken met de geschiedenis van dat type, en opgeloste en gearchiveerde uitzonderingen blijven bij beide buiten beschouwing.
- **Rustige tijd telt mee.** Een venster zonder uitzonderingen hoort bij wat normaal is, dus het bereik van een rustige service blijft klein. De eerste paar uitzonderingen waarschuwen niet, door **Minimum aantal uitzonderingen**, en een echte uitbarsting wel.
- **Een nieuwe service wacht.** Tot een service twee weken geschiedenis heeft, leert het criterium nog en gaat het niet af, hoeveel uitzonderingen er ook zijn. De geschiedenis gaat alleen zo ver terug als OneUptime uitzonderingen bewaart: 15 dagen tenzij u dat hebt gewijzigd, en een service die korter dan twee weken wordt bewaard, heeft nooit genoeg.
- **De waarschuwing zegt waarom.** Ze noemt het verwachte bereik en hoe ver het venster daarbuiten lag. Elke controle schrijft hetzelfde op de **Statustijdlijn**, of dat ze nog leert.

## Uitgewerkt voorbeeld: alleen uitzonderingen uit productie

U wilt een incident telkens wanneer de API in productie een uitzondering gooit, en niets voor staging. U kiest **Elke uitzondering**, zet **Omgevingen** op `production`, laat het **Tijdvenster** op **Laatste 5 minuten** staan en kiest **Een incident melden** onder **Wat er gebeurt**. In de laatste vijf minuten:

| Uitzonderingen | Omgeving | Toestand | Geteld? |
| --- | --- | --- | --- |
| `TypeError` × 3 | `production` | Actief | Ja: 3 |
| `TypeError` × 40 | `staging` | Actief | Nee: andere omgeving |
| `TimeoutError` × 2 | geen | Actief | Nee: geen omgeving |
| `NullReferenceException` × 4 | `production` | Opgelost nadat ze optraden | Nee: opgelost |

Het **Aantal uitzonderingen** is 3, dus **Meer dan** `0` komt overeen: de monitor gaat offline en er wordt een incident gemeld. Zodra er vijf minuten voorbij zijn zonder actieve productie-uitzondering, komt de regel niet meer overeen, gaat de monitor terug naar zijn standaardstatus en lost het incident zichzelf op.

## Problemen oplossen

:::details Uitzonderingen verschijnen in de verkenner, maar de monitor telt 0
Vergelijk de waarde van **Omgevingen** met het filter `env:` van de verkenner: de vergelijking is exact en hoofdlettergevoelig, en uitzonderingen zonder omgeving worden weggelaten wanneer het filter is ingesteld. Controleer daarna of die uitzonderingen zijn opgelost of gearchiveerd. Open de pagina **Criteria** van de monitor (onder **Configuratie**) en klik op **Criteria bewerken**: **Overeenkomende uitzonderingen** toont wat de filters selecteren.
:::

:::details Het incident werd opgelost toen ik de uitzondering oploste
Dat is de bedoeling. Opgeloste uitzonderingen worden niet geteld, dus het aantal daalde en het criterium kwam niet meer overeen. Treedt de uitzondering opnieuw op, dan wordt ze weer onopgelost en opnieuw geteld. Schakel **Opgeloste uitzonderingen opnemen** in om ze hoe dan ook te tellen.
:::

:::details Een filter op uitzonderingstype komt nergens mee overeen
**Uitzonderingstypen** worden exact vergeleken met de typenaam waarmee de uitzondering is gemeld, zoals `TypeError`. Kopieer het type uit de uitzonderingenverkenner.
:::

:::details Een regel voor pieken in uitzonderingen waarschuwt nooit
Kijk op de **Statustijdlijn**: daar staat het verwachte bereik, het aantal dat nodig is om te waarschuwen, of dat de regel nog leert. Een service heeft twee weken geschiedenis nodig, dus een bewaartermijn onder twee weken laat haar blijven leren. Blijft het aantal onder **Minimum aantal uitzonderingen**, verlaag dat dan onder **Meer velden** of kies een hogere **Gevoeligheid**.
:::

## Volgende stappen

:::cards
- [Traces-monitor](/docs/monitor/traces-monitor): Word gewaarschuwd voor mislukte spans en endpoints.
- [Logs-monitor](/docs/monitor/logs-monitor): Word gewaarschuwd op het volume en de inhoud van logs.
- [Incident- en waarschuwingstemplates](/docs/monitor/incident-alert-templating): Schrijf bruikbare titels en beschrijvingen voor waarschuwingen.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Stuur uitzonderingen naar OneUptime.
:::
