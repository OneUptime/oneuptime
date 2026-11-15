# SLO's voor aanvragen en latentie

Een SLO voor aanvragen meet wat uw gebruikers van een service krijgen: het deel van zijn aanvragen dat slaagt, of dat snel genoeg wordt afgehandeld. OneUptime telt ze uit de traces die uw services al sturen, dus u hoeft geen monitor in te stellen: kies de services en een doel, en OneUptime meet ze elke 5 minuten.

:::cards
- [Een SLO voor aanvragen aanmaken](#een-slo-voor-aanvragen-aanmaken): De services, een drempel voor latentie en een doel.
- [Hoe aanvragen worden geteld](#hoe-aanvragen-worden-geteld): Welke spans meetellen, en wanneer.
- [Releasecontroles](/docs/slo/release-checks): Draai een release terug die het foutbudget opbrandt.
:::

## Succes en latentie van aanvragen

| Wat het meet | Een aanvraag is slecht als | Het foutbudget telt |
| --- | --- | --- |
| **Succes van aanvragen** | De span van de aanvraag de status `Error` heeft. Een span zonder status telt als goed, zoals OpenTelemetry het bedoelt. | Mislukte aanvragen |
| **Latentie van aanvragen** | De aanvraag langer duurde dan de **Latentiedrempel (ms)** van de SLO, ongeacht de status. | Trage aanvragen |

De SLI is het deel goede aanvragen in het compliancevenster, en het foutbudget bestaat uit de slechte aanvragen die het doel toestaat: bij 99,9% één op elke 1.000. Een SLO voor latentie telt een aanvraag die snel mislukte als goed, dus meet een belangrijke service op beide manieren: met één SLO die bewaakt dat hij werkt, en één die bewaakt dat hij snel is.

## Zo werkt het

```mermaid title="Van traces naar de status van een SLO voor aanvragen"
flowchart TB
    services["De services van de SLO"] --> spans["Hun entry spans,<br/>uit traces"]
    spans --> steps["Goede en alle aanvragen,<br/>geteld in stappen van 5 minuten"]
    steps --> sli["SLI: aandeel goede aanvragen<br/>in het compliancevenster"]
    sli --> budget["Resterend foutbudget,<br/>in aanvragen"]
    budget --> status["Status: Gezond, Risico<br/>of Budget uitgeput"]
    steps --> burn["Verbruikssnelheid over<br/>de vensters van elke regel"]
    burn --> rules["Waarschuwingen en incidenten<br/>voor uw dienstdoende team"]
```

Een aanvraag is een entry span van een van de services van de SLO: de span waar een aanvraag of een bericht de service binnenkomt, zoals de lijst [Traces](/docs/telemetry/traces-explorer#traces-en-spans) ze standaard toont. Een aanvraag die door twee services van de SLO gaat, telt in elk van beide één keer.

Verder werkt een SLO voor aanvragen zoals elke andere SLO. Zijn status, regels voor verbruikssnelheid, foutbudgetbeleid, eigenaren en meldingen werken hetzelfde, alleen staat zijn foutbudget in aanvragen in plaats van in minuten.

## Voordat u begint

- De services sturen traces naar OneUptime: zie [OpenTelemetry](/docs/telemetry/open-telemetry). Elke service staat in de [servicecatalogus](/docs/telemetry/services) onder zijn `service.name`.
- Een rol die SLO's mag aanmaken: Projecteigenaar, Projectbeheerder of een aangepaste rol met de machtiging Create Service Level Objective.

## Een SLO voor aanvragen aanmaken

:::steps
### SLO's openen

Open **SLOs** via het menu **Producten** in de bovenbalk en klik op **Serviceniveaudoelstelling aanmaken**.

### Kiezen wat de SLO meet

Kies onder **Wat het meet** de optie **Succes van aanvragen** of **Latentie van aanvragen**, en daarna de **Services** waarvan de SLO de aanvragen telt. Stel voor **Latentie van aanvragen** ook de **Latentiedrempel (ms)** in, bijvoorbeeld `300`: een aanvraag die binnen die tijd wordt afgehandeld, telt als snel genoeg. Klik op **Volgende**.

### Een naam en een doel geven

Vul een **Naam** in, bijvoorbeeld "Checkout requests", en een **Doel (%)**: het deel van de aanvragen dat goed moet zijn. Klik op **Serviceniveaudoelstelling aanmaken**.

### De eerste cijfers zien binnenkomen

De eerste evaluatie, binnen 5 minuten, telt de aanvragen van de laatste 6 uur, zodat de SLO meteen cijfers heeft. De evaluaties daarna tellen ook oudere aanvragen, totdat het hele compliancevenster gedekt is.
:::

De eigen pagina **SLOs** van een service toont de SLO's die hem meten, en zijn **Serviceniveaudoelstelling aanmaken** opent hetzelfde formulier met de service al gekozen. Om later te wijzigen wat een SLO meet, welke services hij telt of wat zijn drempel is, opent u zijn **Instellingen** en klikt u op **Bewerken wat het meet**.

## Hoe aanvragen worden geteld

OneUptime telt de goede aanvragen en alle aanvragen van elke SLO in stappen van 5 minuten en bewaart die tellingen, zodat de SLO zijn venster uit zijn eigen tellingen leest in plaats van telkens uit elke span:

- Een stap wordt 2 minuten na zijn einde geteld, zodat spans die laat binnenkomen er nog in vallen, en de volgende evaluatie telt de laatste twee stappen opnieuw voor spans die nog later binnenkomen.
- Een nieuwe SLO begint met de laatste 6 uur. Elke evaluatie daarna telt tot een dag aan oudere aanvragen, de nieuwste eerst, totdat het venster gedekt is.
- Alleen aanvragen die nog binnen uw [bewaartermijn voor telemetrie](/docs/telemetry/data-retention#hoe-lang-telemetrie-wordt-bewaard) vallen, kunnen worden geteld. Getelde stappen worden 400 dagen bewaard, langer dan elk compliancevenster, dus een venster dat langer is dan de bewaartermijn vult zich naarmate de SLO ouder wordt.
- Als u wijzigt wat de SLO meet, zijn services of zijn latentiedrempel, worden zijn aanvragen opnieuw vanaf het begin geteld. Een langer compliancevenster wordt gevuld door verder terug te tellen.

Zolang de tellingen maar een deel van het compliancevenster dekken, zegt het **Overzicht** dat met een indicator **Venster 23% gevuld**, en de tegel **Foutbudget over** herhaalt het onder zijn getal. Beide verdwijnen zodra de tellingen het hele venster dekken.

## Het foutbudget in aanvragen

Het budget bestaat uit de slechte aanvragen die het doel toestaat onder de aanvragen die in het venster zijn geteld, dus het groeit mee met het verkeer: bij 99,9% staat een venster van 2.000.000 aanvragen 2.000 mislukte aanvragen toe. Op het **Overzicht**:

- **Foutbudget over** zegt hoeveel slechte aanvragen er nog over zijn van het totaal, of hoeveel aanvragen de SLO boven het budget zit.
- **Resterende looptijd van budget** zegt hoelang het budget meegaat bij de huidige verbruikssnelheid, zolang het verkeer blijft zoals het was.
- De samenvatting telt de services van de SLO, en een SLO voor latentie toont zijn drempel onder zijn doel.

Waarschuwingen voor verbruikssnelheid, meldingen en de feed noemen het budget ook in aanvragen. De metriek `oneuptime.slo.error.budget.remaining.seconds` wordt voor een SLO voor aanvragen niet verstuurd; zet in plaats daarvan `oneuptime.slo.error.budget.remaining.percent` in een grafiek.

Een SLO voor aanvragen krijgt dezelfde regels **Fast burn**, **Slow burn** en **Slow leak** als elke nieuwe SLO. In een rustig uur met een handvol aanvragen kan één fout al een hoge verbruikssnelheid geven, dus een regel kan vensters met te weinig aanvragen negeren: stel via de API de `minimumSampleCount` van de regel in, en de regel slaat een lang venster met minder aanvragen dan dat aantal over.

## Problemen oplossen

:::details De SLO toont Wachten op aanvragen
Geen van zijn services heeft in het venster al een aanvraag afgehandeld. Controleer of de services traces naar OneUptime sturen en of hun spans entry spans bevatten: een service waarvan alle spans interne spans zijn, heeft geen aanvragen om te tellen.
:::

:::details De SLI veranderde nadat ik de services had gewijzigd
Als u wijzigt wat de SLO meet, zijn services of zijn latentiedrempel, worden zijn aanvragen opnieuw geteld, te beginnen met de laatste 6 uur, dus de SLI en het budget beginnen vanaf daar opnieuw. De indicator **Venster 23% gevuld** laat zien hoeveel van het venster tot nu toe is geteld.
:::

## Volgende stappen

:::cards
- [Releasecontroles](/docs/slo/release-checks): Laat Argo Rollouts, Flagger of een pipeline een release terugdraaien die het budget opbrandt.
- [Waarschuwingen en incidenten voor verbruikssnelheid](/docs/slo/burn-rate-alerts): Waarschuw uw team als het budget te snel opraakt.
- [Foutbudgetbeleid](/docs/slo/error-budget-policy): Spreek af wat het team doet terwijl het budget opraakt.
:::
