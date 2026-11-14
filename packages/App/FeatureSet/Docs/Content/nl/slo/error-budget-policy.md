# Foutbudgetbeleid

Een foutbudgetbeleid legt vast wat uw team heeft afgesproken te doen terwijl het foutbudget van een SLO opraakt, zoals riskante wijzigingen nakijken zodra de helft op is, of releases bevriezen zodra alles op is. OneUptime zet de SLO in het niveau van het beleid dat zijn budget heeft bereikt, toont de afspraak van het team voor dat niveau op de pagina's van de SLO, kan een waarschuwing geven of een incident melden wanneer de SLO een niveau binnengaat, plaatst elke niveauwijziging in de kanalen die u kiest in Slack, Microsoft Teams of Mattermost, en laat uw CI/CD-pipelines weten of ze releases moeten tegenhouden. Het is de praktijk van het foutbudgetbeleid uit het [Google SRE Workbook](https://sre.google/workbook/error-budget-policy/).

:::cards
- [Hoe niveaus werken](#hoe-niveaus-werken): Welk niveau geldt, en wanneer de SLO het verlaat.
- [Een beleid instellen](#een-beleid-instellen): Begin met het aanbevolen beleid of schrijf uw eigen niveaus.
- [Waarschuwingen en incidenten](#waarschuwingen-en-incidenten): Waarschuw uw team wanneer de SLO een niveau binnengaat.
- [Berichten plaatsen in Slack, Microsoft Teams en Mattermost](#berichten-plaatsen-in-slack-microsoft-teams-en-mattermost): Laat een kanaal weten wanneer een SLO een niveau binnengaat, zonder iemand te waarschuwen.
- [Implementatiepoort](#implementatiepoort): Houd releases vanuit CI/CD tegen zolang een niveau implementaties bevriest.
- [Het niveau via de API lezen](#het-niveau-via-de-api-lezen): Controleer het niveau vanuit CI en scripts.
:::

## Hoe niveaus werken

Een beleid is een reeks niveaus. Elk niveau heeft drie velden:

| Veld | Wat het bevat |
| --- | --- |
| **Naam** | Hoe het team het niveau noemt, bijvoorbeeld "Reliability first". |
| **Drempel voor resterend budget (%)** | Het deel van het resterende foutbudget waarop of waaronder het niveau geldt. Van 0 tot 100, decimalen toegestaan. Elk niveau van een SLO heeft een eigen drempel. |
| **Wat we doen** | Wat het team heeft afgesproken te doen zolang de SLO in het niveau zit, in Markdown. Verplicht, tot 10.000 tekens. |

Een niveau geldt zolang het resterende budget op of onder zijn drempel ligt, dus een niveau op 0% is het niveau van een opgebruikt budget. Als meerdere niveaus gelden, zit de SLO in het niveau met de laagste drempel: het ernstigste. Als er geen geldt, zit de SLO in geen enkel niveau. Met niveaus op 50%, 25% en 0% zit een SLO met nog 30% van zijn budget in het niveau van 50%, en een SLO met nog 10% in het niveau van 25%.

Een niveau kan ook implementaties bevriezen zolang de SLO erin zit: zie [Implementatiepoort](#implementatiepoort).

### Een niveau binnengaan en verlaten

Het niveau volgt het resterende budget zoals de status van de SLO dat doet:

- Een niveau binnengaan gebeurt meteen: de evaluatie die het budget op of onder de drempel van een niveau vindt, zet de SLO in dat niveau. Een budget dat in één keer onder meerdere drempels zakt, gaat direct naar het ernstigste niveau.
- Een niveau verlaten voor een minder ernstig niveau wacht tot het budget duidelijk terug is. Een niveau op 0% wordt verlaten zodra er weer 2% van het budget over is. Elk ander niveau wordt verlaten zodra het budget 5 punten boven zijn drempel ligt.

Een niveau op 0% beweegt dus mee met de status **Budget uitgeput**, en een niveau op de risicodrempel van de SLO met **Risico**: zie [Statuswijzigingen en de risicodrempel](/docs/slo/error-budget#statuswijzigingen-en-de-risicodrempel). Een rollend venster dat rond een drempel schommelt, laat het niveau niet heen en weer springen.

```mermaid title="Hoe een SLO door het aanbevolen beleid gaat"
stateDiagram-v2
    state "Geen niveau" as None
    state "Caution" as Caution
    state "Reliability first" as First
    state "Budget exhausted" as Exhausted
    None --> Caution: nog 50% of minder
    Caution --> First: nog 25% of minder
    First --> Exhausted: nog 0% of minder
    Exhausted --> First: weer 2% over
    First --> Caution: weer 30% over
    Caution --> None: weer 55% over
```

## Een beleid instellen

U hebt toestemming nodig om niveaus van het foutbudgetbeleid van SLO's aan te maken.

:::steps
### Foutbudgetbeleid openen

Open de SLO en ga naar **Foutbudgetbeleid** in de sectie **Regels** van het zijmenu. De pagina toont de niveaus van de SLO, elk met zijn naam, het resterende budget waarop het geldt en wat het team doet.

### Beginnen met het aanbevolen beleid

Zolang de SLO geen niveaus heeft, biedt de pagina **Aanbevolen beleid gebruiken** aan. Klik erop, controleer de drie niveaus die worden getoond en bevestig. Pas daarna de tekst van elk niveau aan tot de eigen afspraak van uw team.

### Of zelf een niveau toevoegen

Klik op **SLO-foutbudgetbeleidsniveau aanmaken**. Vul een **Naam** en een **Drempel voor resterend budget (%)** in, en schrijf de afspraak van het team in **Wat we doen**. Zet **Implementaties bevriezen** aan als pipelines releases moeten tegenhouden zolang de SLO in het niveau zit.

### Kiezen wat het niveau geeft

Een niveau legt de afspraak vast en toont die. Om ook iemand te waarschuwen wanneer de SLO het niveau binnengaat, opent u de ingeklapte instellingen voor waarschuwing en incident en zet u een waarschuwing, een incident of beide aan. Beide staan standaard uit. Zie [Waarschuwingen en incidenten](#waarschuwingen-en-incidenten).
:::

Een niveau toevoegen, bewerken of verwijderen werkt meteen: OneUptime evalueert de SLO binnen ongeveer een minuut opnieuw. Ligt het budget al op of onder de drempel van een niveau, dan komt de SLO in dat niveau, en geeft het niveau wat het moet geven. Een niveau uitzetten of verwijderen lost op wat het gaf, en de SLO gaat naar het niveau waarin zijn budget ligt. De waarschuwing of het incident van een niveau uitzetten lost die waarschuwing of dat incident op.

### Het aanbevolen beleid

**Aanbevolen beleid gebruiken** voegt drie niveaus toe, op de helft van het budget, een kwart en nul, met deze Engelse tekst:

| Niveau | Geldt bij | Wat het team doet | Implementaties |
| --- | --- | --- | --- |
| **Caution** | Nog 50% of minder over | Half of the error budget is spent. Review risky changes before they ship, and find out what has been spending the budget. | Toegestaan |
| **Reliability first** | Nog 25% of minder over | Reliability comes first. Only reliability improvements and critical fixes ship until the budget recovers. | Toegestaan |
| **Budget exhausted** | Nog 0% of minder over | The error budget is spent. Freeze non-critical releases: only fixes for this SLO's reliability and security fixes ship until the budget is back. | Bevroren |

Geen van hen geeft een waarschuwing of meldt een incident totdat u dat aanzet. **Budget exhausted** bevriest implementaties, zoals de afspraak ervan zegt, en de bevestiging geeft dat aan: zie [Implementatiepoort](#implementatiepoort). Niveaus die zijn toegevoegd voordat de poort bestond, bevriezen niets totdat u het bevriezen aanzet. Alleen de niveaus die de SLO niet heeft, worden toegevoegd: een niveau met dezelfde naam, of met dezelfde drempel, telt als aanwezig, of het nu aan of uit staat. Er twee keer om vragen, vanuit een tweede tabblad of via de API, voegt dus niets dubbel toe. Kan een van de niveaus niet worden toegevoegd, dan wordt er geen enkel toegevoegd: de SLO blijft zoals hij was, en u kunt het opnieuw proberen. Elk niveau dat zo wordt toegevoegd, wordt in de auditlogboeken van de SLO vastgelegd als toegevoegd door u.

## Waar het niveau verschijnt

- Het **Overzicht** van de SLO toont het niveau waarin hij zit en wat het team daar heeft afgesproken, zodat iedereen die de SLO opent de afspraak ziet die nu geldt. Zolang het niveau implementaties bevriest, toont een rode badge onder zijn naam sinds wanneer.
- De grafiek **Burn-down van foutbudget** tekent een lijn met label op de drempel van elk niveau, naast die van de risicodrempel.
- De **Feed** van de SLO plaatst elke niveauwijziging: het niveau dat de SLO verliet en het niveau waarin hij kwam, het resterende budget, wat het team in het nieuwe niveau heeft afgesproken, en of de wijziging implementaties bevroor of weer toestond.
- De kanalen in Slack, Microsoft Teams en Mattermost die uw regels noemen, krijgen hetzelfde bericht: zie [Berichten plaatsen in Slack, Microsoft Teams en Mattermost](#berichten-plaatsen-in-slack-microsoft-teams-en-mattermost).
- De **Auditlogboeken** van de SLO leggen elke niveauwijziging, en elke keer dat implementaties worden bevroren of weer toegestaan, vast als een wijziging die OneUptime zelf heeft gedaan, en tonen die dus alleen met **Systeemgebeurtenissen opslaan** aan: zie [Auditlogboeken aanzetten](/docs/slo/feed-and-audit-logs#auditlogboeken-aanzetten). Het toevoegen, bewerken en verwijderen van een niveau wordt vastgelegd op naam van de persoon die het deed.
- De lees-API van de SLO geeft het niveau terug, en of implementaties zijn toegestaan: zie [Het niveau via de API lezen](#het-niveau-via-de-api-lezen) en [Implementatiepoort](#implementatiepoort).

## Waarschuwingen en incidenten

Elk niveau kan een waarschuwing geven, een incident melden of beide wanneer de SLO het binnengaat. Ze hebben de opties van de waarschuwing en het incident van een regel voor verbruikssnelheid: ernst, bereikbaarheidsbeleid, sjablonen voor titel, beschrijving en herstelnotities, privacy, automatisch oplossen, labels, eigenaar-teams en -gebruikers, en de eigenaren van de SLO als eigenaren toevoegen. Zie [Wat een regel meldt](/docs/slo/burn-rate-alerts#wat-een-regel-meldt). Beide staan standaard uit, dus een niveau waarschuwt niemand totdat u er een aanzet.

- Een ernstiger niveau binnengaan lost op wat het vorige niveau gaf, wat de instelling voor automatisch oplossen ervan ook zegt, omdat het nieuwe niveau het vervangt. Zo zijn hooguit de waarschuwing en het incident van één niveau tegelijk open, en horen ze bij het niveau waarin de SLO zit.
- Herstellen naar een minder ernstig niveau, of uit elk niveau, lost ze op als automatisch oplossen voor het niveau aan staat, wat standaard zo is. Met automatisch oplossen uit blijven ze open totdat iemand ze oplost.
- Er is geen onderdrukking van nieuwe meldingen. Een niveau geeft pas weer iets nadat de SLO het duidelijk heeft verlaten en het opnieuw is binnengegaan, dus het kan niet flapperen. Lost iemand met de hand op wat het gaf terwijl de SLO nog in het niveau zit, dan blijft dat opgelost.
- Zolang een monitor van de SLO in gepland onderhoud is, geven niveaus niets. Het niveau zelf verandert wel, en wat open is, wordt nog steeds opgelost. Zit de SLO nog in het niveau als het onderhoud eindigt, dan geeft het niveau dan wat het moet geven.

Net als bij een regel voor verbruikssnelheid vermeldt een waarschuwing of incident dat een niveau geeft de SLO onder **Getroffen resources**, en een incident verschijnt nooit op statuspagina's. De feed van de SLO plaatst elk ervan, en wanneer het wordt opgelost.

### Wat ze zeggen

De titel, de beschrijving en de herstelnotities van een niveau accepteren sjabloonvariabelen, net als die van een regel: zie [Wat elke waarschuwing en elk incident zegt](/docs/slo/burn-rate-alerts#wat-elke-waarschuwing-en-elk-incident-zegt). De velden van een niveau bieden de variabelen van de SLO en zijn budget aan, en drie van het niveau zelf: `{{sloName}}`, `{{sloId}}`, `{{sloLink}}`, `{{sloStatus}}`, `{{policyTier}}`, `{{policyTierThresholdPercentage}}`, `{{policyTierWhatWeDo}}`, `{{targetPercentage}}`, `{{currentSliPercentage}}`, `{{errorBudgetRemainingPercentage}}`, `{{errorBudgetRemaining}}`, `{{errorBudgetRemainingMinutes}}` en `{{windowDescription}}`. De eigen variabelen van een regel, zoals `{{ruleName}}` en de verbruikssnelheden, worden niet aangeboden en blijven leeg in de sjablonen van een niveau.

De drie niveauvariabelen werken ook in de sjablonen van regels voor verbruikssnelheid:

| Variabele | Wat ze bevat |
| --- | --- |
| `{{policyTier}}` | De naam van het niveau waarin de SLO na de evaluatie zit, of `None` als hij in geen enkel niveau zit. |
| `{{policyTierThresholdPercentage}}` | De drempel van dat niveau, zoals `25`. Leeg als de SLO in geen enkel niveau zit. |
| `{{policyTierWhatWeDo}}` | Wat het team in dat niveau heeft afgesproken. Leeg als de SLO in geen enkel niveau zit. |

Een niveau waarvan de titel leeg blijft, gebruikt de ingebouwde titel:

```text
SLO error budget policy: {{sloName}} — {{policyTier}}
```

De ingebouwde beschrijving noemt het niveau, zet het resterende budget af tegen de drempel van het niveau en zegt wat het team daarin heeft afgesproken.

## Berichten plaatsen in Slack, Microsoft Teams en Mattermost

Een regel kan elke wijziging in het foutbudgetbeleid van een SLO plaatsen in de kanalen in Slack, Microsoft Teams of Mattermost die uw team leest, zonder iemand te waarschuwen: wanneer de SLO een niveau binnengaat, herstelt naar een minder ernstig niveau of elk niveau verlaat, en wanneer zijn implementaties worden bevroren of weer toegestaan. Elke regel kiest de SLO's en de wijzigingen die hij plaatst. Koppel eerst de workspace aan het project: zie [Slack](/docs/workspace-connections/slack), [Microsoft Teams](/docs/workspace-connections/microsoft-teams) of [Mattermost](/docs/workspace-connections/mattermost).

:::steps
### De sectie Werkruimte van SLO's openen

Ga naar **SLOs** → **Werkruimte** → **Slack**, of **Microsoft Teams**, of **Mattermost**. De sectie **Werkruimte** toont alleen de chatworkspaces die uw project heeft gekoppeld.

### Een regel aanmaken

Klik op **Meldingsregel voor SLO's aanmaken** en geef de regel een **Regelnaam**. Laat onder **Welke SLO's** de keuze **Alle SLO's** staan, of kies **Alleen SLO's die aan de voorwaarden voldoen** en voeg voorwaarden toe: zie [Waarvoor een regel geldt](#waarvoor-een-regel-geldt).

### Kiezen waar de regel plaatst

Vul onder **Daarna, in Slack** de kanalen in waarin de regel plaatst. Kies in Microsoft Teams een team en zijn kanalen, of chats waaraan de OneUptime-app is toegevoegd. Een SLO krijgt geen eigen kanaal, dus een regel plaatst alleen in kanalen en chats die u al hebt.
:::

Het bericht beschrijft de wijziging in de woorden van de **Feed** van de SLO: het niveau dat de SLO verliet en het niveau waarin hij kwam, wat er met de implementaties gebeurde, het resterende foutbudget, de drempel van het nieuwe niveau en wat het team daar heeft afgesproken, zoals het team het heeft geschreven. Een vermelding in die afspraak, zoals `<!channel>`, wordt als tekst geplaatst en geeft niemand een melding.

- Een wijziging wordt één keer geplaatst, nadat de evaluatie die haar veroorzaakte is opgeslagen. Een evaluatie die niet wordt opgeslagen, plaatst niets, en de volgende plaatst de wijziging.
- Er wordt niets geplaatst zolang de SLO in zijn niveau blijft, hoe lang het budget ook rond een drempel schommelt: zie [Een niveau binnengaan en verlaten](#een-niveau-binnengaan-en-verlaten).
- **Implementaties bevriezen** aan- of uitzetten voor het niveau waarin de SLO zit, plaatst een eigen bericht.
- Een SLO die gepauzeerd, verkeerd geconfigureerd, uitgeschakeld of gearchiveerd is, houdt zijn niveau en plaatst niets.
- Een bericht dat niet kan worden verzonden, wordt gelogd, en de evaluatie, de feed van de SLO en wat het niveau geeft, gaan zonder dat bericht door.

### Waarvoor een regel geldt

| Voorwaarde | Waarvoor ze geldt |
| --- | --- |
| **SLOs** | De SLO's die u kiest, of elke SLO behalve die. |
| **SLO-labels** | De labels van de SLO: een van de labels die u kiest, ze allemaal, of geen ervan. |
| **SLO-naam** | De naam van de SLO: wel of niet gelijk aan uw tekst, wel of niet met die tekst erin, of beginnend of eindigend met die tekst. |
| **Wijziging in foutbudgetbeleid** | Wat er veranderde: **Strenger niveau binnengegaan**, **Hersteld naar een minder streng niveau**, **Alle niveaus verlaten**, **Implementaties bevroren** of **Implementaties weer toegestaan**. |
| **Eigenaar van SLO** | De mensen en teams die als eigenaren van de SLO zijn vastgelegd: een van degenen die u kiest, of geen ervan. Lid zijn van een team dat eigenaar is van de SLO telt niet. |

Een niveauwijziging die implementaties bevroor, of weer toestond, is één bericht dat voor beide wijzigingen telt. Een regel voor **Implementaties bevroren** plaatst dus ook de wijziging waarmee de SLO een niveau binnenging dat ze bevriest: een releasekanaal hoort van elke bevriezing.

## Als het budget niet wordt gemeten

- Een SLO die **Gepauzeerd** of **Verkeerd geconfigureerd** is, meet geen budget, dus zijn niveau blijft waar het was, en wat het niveau gaf, blijft open totdat er weer wordt gemeten. Regels voor verbruikssnelheid lossen dan juist op wat ze open hebben.
- De evaluatie van de SLO uitzetten, of de SLO archiveren, lost op wat zijn niveaus gaven. Het niveau waarin de SLO zit, blijft zoals het was.
- De SLO verwijderen verwijdert zijn niveaus en lost op wat ze gaven.
- In elk van deze gevallen houdt de SLO het antwoord dat hij over implementaties gaf, omdat hij zijn niveau houdt: zie [Implementatiepoort](#implementatiepoort).

## Implementatiepoort

Een niveau kan implementaties bevriezen. Zolang de SLO in een niveau zit waarvoor **Implementaties bevriezen** aan staat, is het veld `deploymentsAllowed` van de SLO `false`, zodat een CI/CD-pipeline die het vóór een release controleert, die release tegenhoudt. Anders is het `true`: als de SLO geen beleid heeft, zolang zijn budget boven elk niveau ligt, en in een niveau dat geen implementaties bevriest. Het niveau **Budget exhausted** van het aanbevolen beleid bevriest implementaties.

:::steps
### Implementaties bevriezen aanzetten

Open het **Foutbudgetbeleid** van de SLO, bewerk het niveau, zet **Implementaties bevriezen** aan en sla op. De kolom **Implementaties** van het niveau in de tabel toont **Bevroren**.

### De pipeline een sleutel geven

Maak een [API-sleutel](/docs/api-reference/api-reference) van het project aan die de SLO kan lezen, en bewaar hem als geheim van de pipeline met de naam `ONEUPTIME_API_KEY`.

### De SLO controleren vóór de release

Voeg de controle hieronder toe als stap vóór de stap die implementeert, met de ID van de SLO in plaats van `<slo-id>`.
:::

:::tabs
@tab Shell
```bash
ALLOWED=$(curl -sS -X POST 'https://oneuptime.com/api/service-level-objective/<slo-id>/get-item' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{ "select": { "deploymentsAllowed": true } }' | jq -r '.deploymentsAllowed')
[ "$ALLOWED" = "true" ]
```
@tab GitHub Actions
```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Stop while the error budget policy freezes deployments
        env:
          ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
          SLO_ID: <slo-id>
        run: |
          SLO=$(curl -sS -X POST "https://oneuptime.com/api/service-level-objective/$SLO_ID/get-item" \
            -H "ApiKey: $ONEUPTIME_API_KEY" \
            -H 'Content-Type: application/json' \
            -d '{ "select": { "deploymentsAllowed": true, "currentErrorBudgetPolicyTierName": true } }')
          if [ "$(echo "$SLO" | jq -r '.deploymentsAllowed')" != "true" ]; then
            echo "Not deploying: $SLO"
            exit 1
          fi
      - name: Deploy
        run: ./deploy.sh
```
@tab GitLab CI
```yaml title=".gitlab-ci.yml"
error-budget-gate:
  stage: test
  image: alpine:3.20
  variables:
    SLO_ID: <slo-id>
  before_script:
    - apk add --no-cache curl jq
  script:
    - >
      SLO=$(curl -sS -X POST "https://oneuptime.com/api/service-level-objective/$SLO_ID/get-item"
      -H "ApiKey: $ONEUPTIME_API_KEY"
      -H 'Content-Type: application/json'
      -d '{ "select": { "deploymentsAllowed": true, "currentErrorBudgetPolicyTierName": true } }')
    - echo "$SLO"
    - test "$(echo "$SLO" | jq -r '.deploymentsAllowed')" = "true"
```
:::

De controle slaagt alleen als het antwoord `true` is. Een bevroren SLO, een antwoord zonder het veld (de sleutel kan de SLO niet lezen, of de ID klopt niet) en helemaal geen antwoord stoppen elk de stap, zodat een pipeline nooit een release uitbrengt op een antwoord dat hij niet heeft gekregen. In GitLab CI draait de job in de fase test, dus een bevroren SLO houdt de fase deploy daarna tegen; voeg `ONEUPTIME_API_KEY` toe als gemaskeerde CI/CD-variabele. Gebruik op een zelfgehoste installatie het eigen adres van die installatie in plaats van oneuptime.com.

De SLO antwoordt met twee velden, gelezen met de eigen leestoestemming van de SLO:

| Veld | Wat het bevat |
| --- | --- |
| `deploymentsAllowed` | `false` zolang de SLO in een niveau zit dat implementaties bevriest, anders `true`. |
| `deploymentsFrozenAt` | Wanneer de implementaties werden bevroren. Leeg zolang ze zijn toegestaan. |

Hoe het antwoord verandert:

- Implementaties worden bevroren door de evaluatie die de SLO in een niveau zet dat ze bevriest, en weer toegestaan door de evaluatie die hem eruit haalt, met de eigen herstelmarges van het niveau: zie [Een niveau binnengaan en verlaten](#een-niveau-binnengaan-en-verlaten). Van het ene bevriezende niveau naar het andere blijven ze bevroren, en `deploymentsFrozenAt` houdt zijn tijdstip.
- **Implementaties bevriezen** aan- of uitzetten voor het niveau waarin de SLO zit, werkt binnen ongeveer een minuut. Om een release uit te brengen voordat het budget is hersteld, zet u het bevriezen uit: de wijziging wordt in de auditlogboeken van de SLO vastgelegd op uw naam.
- Een SLO die **Gepauzeerd** of **Verkeerd geconfigureerd** is, houdt het antwoord dat hij had, zoals hij ook zijn niveau houdt: een onderhoudsvenster dat elke monitor pauzeert, heft geen bevriezing op en start er ook geen. Een uitgeschakelde of gearchiveerde SLO wordt helemaal niet geëvalueerd, dus ook die houdt zijn antwoord.
- Zolang implementaties bevroren zijn, toont het **Overzicht** van de SLO sinds wanneer, en zegt zijn **Feed** wanneer ze worden bevroren en weer toegestaan.

## Het niveau via de API lezen

De eigen lees-API van de SLO geeft het niveau terug waarin hij zit, zodat een CI-taak of een script het kan controleren voordat het iets doet, bijvoorbeeld voor een release. Alle drie de velden zijn leeg zolang de SLO in geen enkel niveau zit:

| Veld | Wat het bevat |
| --- | --- |
| `currentErrorBudgetPolicyTierId` | De ID van het niveau. |
| `currentErrorBudgetPolicyTierName` | De naam van het niveau. |
| `currentErrorBudgetPolicyTierEnteredAt` | Wanneer de SLO het niveau binnenging. |

Ze worden gelezen met de eigen leestoestemming van de SLO, dezelfde die zijn budget ook nodig heeft. Bijvoorbeeld met een [API-sleutel](/docs/api-reference/api-reference) van het project:

```bash
curl -X POST 'https://oneuptime.com/api/service-level-objective/<slo-id>/get-item' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{ "select": { "name": true, "errorBudgetRemainingPercentage": true, "currentErrorBudgetPolicyTierName": true, "currentErrorBudgetPolicyTierEnteredAt": true } }'
```

De niveaus zelf zijn een eigen resource, `/api/service-level-objective-error-budget-policy-tier`, met de verzoeken om op te sommen, te lezen, aan te maken, te wijzigen en te verwijderen die elke resource heeft. Nog twee verzoeken dienen het aanbevolen beleid. Beide nemen `{ "serviceLevelObjectiveId": "..." }` aan en antwoorden met de niveaus in `tiers`:

| Verzoek | Wat het doet |
| --- | --- |
| `POST /api/service-level-objective-error-budget-policy-tier/recommended-policy` | Somt de aanbevolen niveaus op die de SLO mist. Het schrijft niets. |
| `POST /api/service-level-objective-error-budget-policy-tier/recommended-policy/add` | Voegt ze toe en somt op wat het heeft toegevoegd. Opnieuw vragen voegt niets toe. |

## Machtigingen

| Machtiging | Laat een rol |
| --- | --- |
| **Read SLO Error Budget Policy Tier** | De niveaus van een SLO zien. |
| **Create SLO Error Budget Policy Tier** | Niveaus toevoegen, met de hand of met **Aanbevolen beleid gebruiken**. |
| **Edit SLO Error Budget Policy Tier** | Niveaus wijzigen, en ze aan- of uitzetten. |
| **Delete SLO Error Budget Policy Tier** | Niveaus verwijderen. |

Deze machtigingen staan in de SLO-groep van een rol. De rollen Project Owner en Project Admin hebben ze allemaal, en de rollen Project Member en Viewer kunnen niveaus lezen.

## Nog niet beschikbaar

Sommige onderdelen van een foutbudgetbeleid zijn nog niet beschikbaar: een eigen workflowtrigger per niveau, een beleid dat meerdere SLO's delen, een niveau bevestigen of er een uitzondering op maken, en niveaus die de looptijd van het budget volgen in plaats van het resterende budget. OneUptime houdt een release niet zelf tegen: een pipeline die `deploymentsAllowed` controleert, doet dat, zoals [Implementatiepoort](#implementatiepoort) laat zien.

## Volgende stappen

:::cards
- [Foutbudgetten](/docs/slo/error-budget): Wat het budget is, en hoe de status het volgt.
- [Waarschuwingen en incidenten voor verbruikssnelheid](/docs/slo/burn-rate-alerts): Waarschuw uw team wanneer het budget te snel opbrandt.
- [SLO-feed en auditlogboeken](/docs/slo/feed-and-audit-logs): Elke niveauwijziging en wat de niveaus gaven.
:::
