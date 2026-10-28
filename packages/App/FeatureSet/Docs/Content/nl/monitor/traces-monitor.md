# Traces-monitor

Een traces-monitor telt binnen een tijdvenster de spans die uw services naar OneUptime sturen en die aan uw filters voldoen (span-naam, status, service, attributen). Wanneer het aantal aan uw criteria voldoet, wijzigt hij de status van de monitor, maakt hij een waarschuwing aan of meldt hij een incident. Gebruik hem om gewaarschuwd te worden voor mislukte verzoeken naar een endpoint, een piek in fout-spans, of een service die geen traces meer stuurt.

:::cards
- [De monitor maken](#een-traces-monitor-maken): Kies welke spans u telt en wanneer u wordt gewaarschuwd.
- [Span-statuscodes](#span-statuscodes): Wat OK, ERROR en UNSET betekenen, en waarop u filtert.
- [Hoe hij wordt geëvalueerd](#hoe-hij-wordt-geëvalueerd): Het tijdvenster, de telling en de cyclus van één minuut.
- [Criteria](#criteria): Drempels, anomaliedetectie en de standaardwaarden.
:::

## Hoe het werkt

```mermaid title="Elke minuut telt en controleert een traces-monitor"
flowchart TB
    App["Uw services"] -->|OpenTelemetry| Store[("Spans in OneUptime")]
    Store --> Count["Overeenkomende spans tellen<br/>in het tijdvenster"]
    Count --> Check{"Criteria vervuld?"}
    Check -->|"Eerste overeenkomst"| Act["Status wijzigen,<br/>waarschuwing of incident"]
    Check -->|Geen| Default["Standaardstatus"]
```

Elke minuut telt OneUptime de spans die aan de filters van de monitor voldoen en binnen het tijdvenster zijn begonnen. Dat aantal vergelijkt het van boven naar beneden met de criteria van de monitor, en het eerste criterium dat overeenkomt, bepaalt wat er gebeurt. Komt er geen overeen, dan gaat de monitor terug naar zijn standaardstatus.

## Voordat u begint

- Uw services sturen traces naar OneUptime via OpenTelemetry. Zie [OpenTelemetry](/docs/telemetry/open-telemetry).
- Zoek in de traceverkenner de exacte naam op van de span die u wilt bewaken: span-namen worden door uw instrumentatie bepaald, bijvoorbeeld `POST /api/checkout` of `GET`.

## Een traces-monitor maken

:::steps
### Een nieuwe monitor beginnen

Ga naar **Monitoren** en klik op **Monitor maken**. Of filter in de traceverkenner de spans waarover u geïnformeerd wilt worden en klik in de werkbalk op **Create monitor**: de nieuwe monitor bewaakt vanaf het begin de services, de statussen, de spannaam en de attributen van de verkenner.

### Traces kiezen

Klik onder **Monitortype** op **Meer monitortypen** en kies **Traces** onder **Telemetrie**, of typ `traces` in het zoekvak. Vul een **Naam** in en klik dan op **Volgende**.

### Kiezen waarover de monitor u informeert

Kies onder **Waarover moet deze monitor je informeren?** voor **Te veel mislukte verzoeken** of **Verzoeken blijven weg**. Elke keuze vult de te bewaken spans en de regel in, die u verderop kunt wijzigen. Kies **Iets anders** om ze zelf in te stellen.

### De te tellen spans kiezen

Stel in **Te bewaken spans** de velden **Span-status** en **Spannaam bevat** in. Een filter dat u leeg laat, komt met elke span overeen. **Overeenkomende spans** onder de filters toont de spans waarmee ze nu overeenkomen.

### Verder verfijnen (optioneel)

Open **Meer velden** om te filteren op telemetrieservice, infrastructuurentiteit of attribuut.

### Zeggen wanneer er gewaarschuwd wordt

Kies in **Wanneer waarschuwen** een **Voorwaarde**, het **Aantal spans** en een **Tijdvenster**. De zin eronder zegt de regel in gewone woorden terug. De grafiek daaronder telt de overeenkomende spans in elk venster van de afgelopen uren, tekent het getal van de regel als lijn en zegt hoe vaak de regel zou hebben gewaarschuwd. De knop ervan stelt een getal voor dat de regel in die tijd niet zou hebben overschreden.

### Kiezen wat er gebeurt

Kies in **Wat er gebeurt** voor **Een waarschuwing maken**, **Een incident melden** of **Beide**, en geef het een titel en een ernst. Zolang de regel overeenkomt, toont de monitor de status onder **Meer velden**; komt hij niet meer overeen, dan gaat de monitor terug naar zijn standaardstatus en lost de waarschuwing of het incident zichzelf op.

### De monitor maken

Klik op **Monitor maken**. De monitor opent op zijn pagina **Overzicht**, en zijn eerste evaluatie volgt binnen een minuut.
:::

> [!TIP]
> Om te horen wanneer een AI-functie slecht antwoordt (mislukte, geweigerde, afgebroken, lege, gemarkeerde of trage antwoorden), kiest u in plaats daarvan **AI / LLM** onder **Telemetrie**. Die monitor leest de AI-aanroepen in uw traces voor u, zonder span-filters die u moet schrijven. Zie [AI- / LLM-observability](/docs/telemetry/ai-llm-observability#een-melding-krijgen-wanneer-de-ai-slecht-antwoordt).

## Wat hij opvraagt

| Veld | Waarmee het overeenkomt | Standaard |
| --- | --- | --- |
| **Span-status** | Spans met een van de gekozen statussen: **Niet ingesteld**, **Ok** of **Fout**. | Leeg: elke status |
| **Spannaam bevat** | Spans waarvan de naam deze tekst bevat, zonder onderscheid tussen hoofd- en kleine letters. | Leeg: elke span |
| **Tijdvenster** (in **Wanneer waarschuwen**) | Spans die zijn begonnen in de laatste 5 seconden tot de laatste 24 uur. | **Laatste 5 minuten** |
| **Filteren op telemetrieservice** (onder **Meer velden**) | Spans van een van de gekozen services. | Leeg: elke service |
| **Filteren op infrastructuurentiteit** (onder **Meer velden**) | Spans van een van de gekozen hosts, pods, containers en andere entiteiten. | Leeg: elke entiteit |
| **Filteren op attributen** (onder **Meer velden**) | Spans waarvan de attributen aan elke voorwaarde voldoen. Elke voorwaarde heeft een eigen operator, zoals "is gelijk aan" of "bevat". | Leeg: geen voorwaarde |

Alle filters die u instelt, moeten overeenkomen voordat een span wordt geteld.

### Span-statuscodes

- **OK** — De bewerking is expliciet als geslaagd gemarkeerd, door applicatiecode of een trace-pipeline
- **ERROR** — De bewerking heeft een fout ondervonden
- **UNSET** — Er is geen foutstatus ingesteld. Dit is de standaardstatus van OpenTelemetry

UNSET betekent niet dat er gegevens ontbreken. OpenTelemetry-instrumentatie stelt ERROR in wanneer een bewerking mislukt en laat geslaagde spans op UNSET staan, dus bij een gezonde dienst zijn de meeste spans UNSET. OneUptime toont ze in het groen als "Unset (no error)". Het vastleggen van een uitzondering verandert de status van een span niet, dus een UNSET-span kan toch uitzonderingen bevatten; die worden bij de span vermeld. Filter op ERROR om meldingen te ontvangen bij fouten. Selecteer zowel OK als UNSET om alle spans te tellen die niet zijn mislukt.

Als u wilt dat geslaagde verzoeken als OK worden weergegeven, voeg dan onder **Traces > Instellingen > Pipelines** een trace-pipeline toe met de filtervoorwaarde **Status = Niet ingesteld** en een **Status-hertoewijzer** die waarden van `http.response.status_code`, zoals `200`, toewijst aan Ok.

## Hoe hij wordt geëvalueerd

- **Elke minuut.** Een traces-monitor wordt niet door sondes gecontroleerd, dus hij heeft geen interval om in te stellen en geen pagina **Sondes en interval**.
- **Eén getal per evaluatie.** De monitor telt de spans die aan elk filter voldoen en binnen het **Tijdvenster** vóór de evaluatie zijn begonnen. Met **Laatste 5 minuten** kijkt elke evaluatie vijf minuten terug, dus de vensters van opeenvolgende evaluaties overlappen.
- **Geen spans is een aantal van 0.** Een service die geen traces meer stuurt, levert 0 op, en daar zoekt **Verzoeken blijven weg** naar.
- **De onderbreking van OneUptime zelf is geen stilte.** Zolang het tijdvenster tijd bevat waarin OneUptime zelf geen gegevens ontving (het startte opnieuw, werd geüpgraded of werkte een achterstand weg), wacht de controle: de status verandert niet, en er wordt geen incident of waarschuwing geopend of opgelost. Zie [Als OneUptime geen gegevens ontvangt](/docs/monitor/when-oneuptime-is-not-receiving).
- **Criteria van boven naar beneden.** Het eerste criterium dat overeenkomt, beslist, dus zet het ernstigste bovenaan.

Elke statuswijziging wordt, met de reden ervan, vastgelegd op de **Statustijdlijn** van de monitor.

## Criteria

De criteria van een traces-monitor hebben één **Filtertype**: **Span Count**, het aantal spans dat in het venster overeenkwam. **Wanneer waarschuwen** stelt één criterium in, met als **Voorwaarde** **Meer dan**, **Minstens**, **Minder dan**, **Hoogstens**, **Precies**, **Ongewoon hoog**, **Ongewoon laag** of **Ongewoon hoog of laag**. Voor meerdere criteria, of één met meer dan één filter, klikt u op **Bewerken als eigen criteria** onder **Meer velden** in **Wat er gebeurt**: elk criterium daar heeft een **Filtervoorwaarde** en, bij een drempelvoorwaarde, een **Waarde**.

| Filtervoorwaarde | Komt overeen wanneer het aantal spans… |
| --- | --- |
| **Groter dan** | boven de waarde ligt |
| **Groter dan of gelijk aan** | gelijk is aan de waarde of hoger |
| **Kleiner dan** | onder de waarde ligt |
| **Kleiner dan of gelijk aan** | gelijk is aan de waarde of lager |
| **Gelijk aan** | precies de waarde is |
| **Anomalously High** | boven het verwachte bereik voor dit uur van de week ligt |
| **Anomalously Low** | onder dat bereik ligt |
| **Anomalous** | buiten dat bereik ligt, in welke richting ook |

De anomaliecondities hebben geen **Waarde**. Kies een **Gevoeligheid** (Laag, Gemiddeld, de standaard, of Hoog) en, in de eigen criteria, een **Baseline-venster** van 14 (de standaard), 28, 60 of 90 dagen. OneUptime zet het aantal om in een tempo per minuut en vergelijkt dat met hetzelfde uur van de week over dat venster. De baseline omvat alleen de services en span-statussen van de monitor: de filters op spannaam en attributen horen er niet bij. Zolang dat uur van de week te weinig geschiedenis heeft, is het criterium nog aan het leren en gaat het niet af.

Een traces-monitor die in Monitor maken is aangemaakt, begint met de regel van wat u onder **Waarover moet deze monitor je informeren?** hebt gekozen:

| Keuze | Regel | Wat er gebeurt |
| --- | --- | --- |
| **Te veel mislukte verzoeken** | **Span-status** **Fout**, **Meer dan** `10` in **Laatste 5 minuten** | Maakt een waarschuwing, die zichzelf oplost |
| **Verzoeken blijven weg** | **Precies** `0` in **Laatste 10 minuten** | Meldt een incident, dat zichzelf oplost |

Een traces-monitor die via de API of Terraform zonder criteria is aangemaakt, begint met deze criteria:

| Criterium | Filter | Effect |
| --- | --- | --- |
| Check if … is offline | **Span Count** **Gelijk aan** `0` | Zet de monitor offline en meldt een incident, dat automatisch wordt opgelost |
| Check if … is online | **Span Count** **Groter dan** `0` | Zet de monitor online |

## Uitgewerkt voorbeeld: mislukte checkout-verzoeken

In vijf minuten legt de checkout-service 1.200 spans vast met de naam `POST /api/checkout`: 1.150 UNSET, 20 OK en 30 ERROR. Dezelfde monitor telt heel verschillende aantallen, afhankelijk van **Span-status**:

| Span-status | Span Count | Wat het meet |
| --- | --- | --- |
| **Fout** | 30 | Verzoeken die mislukten |
| **Ok** | 20 | Alleen de verzoeken die uw code als geslaagd markeerde |
| **Niet ingesteld** en **Ok** | 1.170 | Elk verzoek dat niet mislukte |
| Leeg | 1.200 | Elk verzoek |

Om opgeroepen te worden wanneer in vijf minuten meer dan 10 checkout-verzoeken mislukken:

- **Spannaam bevat**: `POST /api/checkout`
- **Tijdvenster**: **Laatste 5 minuten**
- **Span-status**: **Fout**
- **Wanneer waarschuwen**: **Meer dan** `10`
- **Wat er gebeurt**: **Een incident melden**

Met 30 mislukte verzoeken komt de regel overeen en wordt het incident gemeld. Zodra er vijf minuten voorbij zijn met 10 of minder mislukkingen, komt de regel niet meer overeen, is de monitor weer online en lost het incident zichzelf op.

## Problemen oplossen

:::details De monitor telt geen spans voor mijn endpoint
**Spannaam bevat** wordt vergeleken met de naam van de span, en instrumentatie noemt server-spans vaak naar de route (`POST /api/checkout`) of alleen naar de methode (`GET`). Zoek de exacte naam op in de traceverkenner. Open daarna de pagina **Criteria** van de monitor (onder **Configuratie**) en klik op **Edit Monitoring Criteria**: **Overeenkomende spans** toont waarmee de filters nu overeenkomen.
:::

:::details Geslaagde verzoeken worden niet geteld wanneer ik op Ok filter
De meeste instrumentatie laat geslaagde spans op UNSET staan, niet op OK (zie [Span-statuscodes](#span-statuscodes)). Selecteer zowel **Niet ingesteld** als **Ok**, of voeg de trace-pipeline toe die daar wordt beschreven.
:::

:::details Een span heeft een uitzondering, maar wordt niet als fout geteld
Het vastleggen van een uitzondering verandert de status van een span niet. Filter op **Fout**, of gebruik een [uitzonderingen-monitor](/docs/monitor/exceptions-monitor) om gewaarschuwd te worden voor de uitzonderingen zelf.
:::

:::details Een anomaliecriterium gaat nooit af
Het is nog aan het leren: het uur van de week waarmee het vergelijkt, heeft binnen het **Baseline-venster** nog niet genoeg geschiedenis.
:::

## Volgende stappen

:::cards
- [Uitzonderingen-monitor](/docs/monitor/exceptions-monitor): Word gewaarschuwd voor de uitzonderingen die uw services vastleggen.
- [Logs-monitor](/docs/monitor/logs-monitor): Word gewaarschuwd op het volume en de inhoud van logs.
- [Zoeksyntaxis](/docs/telemetry/search-syntax): Vind span-namen en -statussen in de traceverkenner.
- [Incident- en waarschuwingstemplates](/docs/monitor/incident-alert-templating): Schrijf bruikbare titels en beschrijvingen voor waarschuwingen.
:::
