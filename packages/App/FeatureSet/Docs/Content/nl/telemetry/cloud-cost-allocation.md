# Toewijzing van cloudkosten

Kostengroepen beantwoorden de eerste vraag bij elke maandelijkse cloudrekening: wie heeft het uitgegeven? Een **kostenweergave** zoals "Op team" of "Op kostenplaats" deelt de uitgaven van je gekoppelde accounts met regels in bij **kostengroepen**, zonder iets dubbel te tellen. Wat geen regel neemt, blijft zichtbaar als niet-toegewezen uitgaven, en gedeelde kosten worden over de groepen verdeeld. Je vindt ze onder **Cloud → Uitgaven → Kostengroepen**.

:::cards
- [Een weergave maken](#een-weergave-maken): Op team uit de eigenaren die je al hebt ingesteld, op een tag, of je eigen groepen.
- [De regels van een groep schrijven](#de-regels-van-een-groep-schrijven): Accounts, services, tags, eigenaarsteams, labels en meer.
- [Niet-toegewezen uitgaven](#niet-toegewezen-uitgaven): Wat geen regel neemt, en één klik om het in te delen.
- [Gedeelde kosten](#gedeelde-kosten): Een supportplan of een gedeeld cluster, verdeeld over de groepen.
:::

## Hoe het werkt

```mermaid title="Van de kosten van je clouds naar de uitgaven van elke groep"
flowchart TB
    costs["Dagelijkse kosten<br/>van je clouds"] --> rules{"De eerste groep<br/>waarvan de regels<br/>op de kosten passen"}
    rules --> groups["Uitgaven per groep"]
    rules --> unallocated["Niet toegewezen"]
    groups --> shared["Gedeelde groepen<br/>verdeeld over de rest"]
    items["Eigen posten"] --> groups
    shared --> charged["Wat elke groep<br/>wordt aangerekend"]
```

- **De eerste groep die past, neemt de kosten.** De groepen van een weergave hebben een volgorde, en elke kostenpost valt in de eerste groep waarvan de regels erop van toepassing zijn, zodat niets dubbel wordt geteld. De groepen en de niet-toegewezen uitgaven tellen altijd op tot het totaal van de periode.
- **Regels lezen alles wat een kostenpost draagt.** Het account, de cloud, de service, de regio, de resource en zijn tags, en wat OneUptime van de resource weet: zijn eigenaarsteams, zijn labels, zijn App Platforms-omgeving en app.
- **Alles wordt berekend wanneer je kijkt.** Er wordt niets per kostenpost opgeslagen. Een regel die je wijzigt, deelt elke maand die OneUptime bewaart opnieuw in, tot 400 dagen terug, zonder te wachten.
- **Meerdere weergaven kunnen dezelfde uitgaven indelen.** "Op team" en "Op kostenplaats" delen elk alles in, op hun eigen manier.

## Voordat je begint

- **Kosten die worden gelezen.** [Koppel een cloudaccount](/docs/telemetry/cloud-accounts) en laat het [zijn kosten lezen](/docs/telemetry/cloud-costs).
- **Tags of eigenaren, als je die wilt.** Regels op tags hebben kosten nodig die ze dragen; zet bij AWS [Kosten per resource](/docs/telemetry/cloud-costs#kosten-per-resource) aan. Eigenaarsteams komen van de eigenaren van elke resource, met de hand ingesteld of via [eigenaarsregels](/docs/configuration/label-and-owner-rules).

## Een weergave maken

Open **Cloud → Uitgaven → Kostengroepen**. Een project zonder weergave krijgt drie manieren om te beginnen:

| Begin | Wat het maakt |
| --- | --- |
| **Op team, uit eigenaren** | Een groep voor elk team dat cloudresources bezit, gekoppeld aan het team. |
| **Op een tag** | Een groep voor elke waarde van een tag die je kosten dragen, zoals `team` of `cost-center`. |
| **Eigen groepen** | Een lege weergave. Je schrijft zelf de regels van elke groep. |

OneUptime maakt de groepen van een weergave op tag of op eigenaarsteam wanneer je hem opslaat, en daarna elk uur zodra er nieuwe tagwaarden en eigenaren verschijnen. Je kunt die groepen hernoemen, aan een team koppelen of delen. Hun regels blijven die van OneUptime. Om de ontbrekende groepen nu te maken, open je de weergave en klik je op **Groepen nu maken**.

## De regels van een groep schrijven

Open een weergave en dan **Kostengroep aanmaken** onder **Groepen**. Een kostenpost hoort bij de groep als **een** van de regels erop van toepassing is, en een regel is van toepassing als **alle** voorwaarden kloppen. Een voorwaarde vergelijkt iets wat een kostenpost draagt met de waarden die je kiest of typt:

| Veld | Wat het leest |
| --- | --- |
| **Tag** | De waarde van een tag, via de sleutel van de tag. **is ingesteld** en **is niet ingesteld** vragen of de kostenpost hem draagt. |
| **Account** | Het gekoppelde account waaraan de kostenpost wordt gefactureerd. |
| **Eigenaarsteam** | De teams die de resource in OneUptime bezitten. |
| **Service** | De service, zoals de facturering van je cloud hem noemt. |
| **Label** | De labels van de resource, of van zijn account, in OneUptime. |
| **Regio** | De regio. Laat de waarde leeg voor een globale service. |
| **Cloud** | AWS, Azure of Google Cloud. |
| **Resource** | De resource, zoals je cloud hem noemt. |
| **App Platforms-omgeving** en **App** | Wat een omgeving of een app in rekening wordt gebracht, zoals **Cloud → Uitgaven → Kosten** het telt. |
| **Kubernetes-naamruimte** en **Kubernetes-cluster** | De naamruimten van een cluster, als een gedeelde groep erover wordt verdeeld. Zie [Kubernetes-clusters](#kubernetes-clusters). |

Tekst wordt vergeleken zonder op hoofdletters te letten: `Payments` en `payments` zijn één team. De sleutel van een tag wordt vergeleken zoals hij geschreven is, zoals je clouds hem bewaren.

Een groep **Betalingen** met drie regels neemt bijvoorbeeld een kostenpost die getagd is met `team: payments`, **of** gefactureerd aan het account payments, **of** eigendom is van het team Betalingen.

### De volgorde van de groepen

Sleep de groepen onder **Groepen** om hun volgorde te wijzigen. Een groep waarvan een eerdere groep de regels al dekt, kan nooit een kostenpost nemen, en zijn rij zegt welke groep alles neemt. Een groep waarvan de regels ook kosten treffen die een eerdere groep neemt, zegt hoeveel daarvan hij krijgt.

### Resources met meerdere eigenaarsteams

Een resource van twee teams wordt gelijk over hen verdeeld: de helft van elk team gaat afzonderlijk door de regels. Een regel die niets over eigenaren vraagt, zoals een tag of een account, neemt nog steeds de hele kostenpost. Een helft waarvan het team geen groep heeft, blijft niet toegewezen.

## Niet-toegewezen uitgaven

De pagina van een weergave toont wat nog geen regel neemt: de services, accounts, tagwaarden en eigenaarsteams waaruit het bestaat, de duurste eerst. Klik ernaast op **Aan groep toevoegen** om er een regel voor aan een groep toe te voegen, of aan een nieuwe groep. De kosten gaan meteen naar de groep, ook die van eerdere maanden.

## Gedeelde kosten

Een supportplan, een gedeeld cluster of een netwerkhub is van iedereen. Maak er een eigen groep van, zet dan onder **Meer velden** **Gedeeld** aan en kies hoe de kosten over de andere groepen van de weergave worden verdeeld:

| Verdeling | Hoe |
| --- | --- |
| **Verdelen naar aandeel in de uitgaven** | Elke groep neemt zijn aandeel in de clouduitgaven van de andere groepen in die maand. Een maand waarin ze niets uitgaven, wordt gelijk verdeeld. |
| **Gelijk verdelen** | Hetzelfde bedrag voor elke groep. |
| **Verdelen volgens vaste percentages** | De percentages die je voor elke groep instelt, samen 100. |
| **Verdelen per Kubernetes-naamruimte** | Wat elke naamruimte van een cluster die maand kostte. Zie hieronder. |

De kosten van een gedeelde groep worden dag voor dag verdeeld met de aandelen van elke maand, zodat een maand dezelfde cijfers geeft, per dag of per maand gelezen. Niet-toegewezen uitgaven krijgen nooit een aandeel.

### Kubernetes-clusters

De nodes van een cluster worden door je cloud gefactureerd, terwijl de eigen kostenengine van het cluster zegt wat elke naamruimte gebruikte. Zo reken je elk team zijn workloads in een gedeeld cluster aan:

1. Maak een groep waarvan de regels op de nodes van het cluster passen, bijvoorbeeld **Tag** `eks:cluster-name` **is een van** `prod`.
2. Zet **Gedeeld** aan, kies **Verdelen per Kubernetes-naamruimte** en selecteer het **Kubernetes-cluster**.
3. Geef de groepen van de teams regels die de labels van de naamruimten lezen, die als tags tellen. Bijvoorbeeld **Tag** `team` **is een van** `payments`, of **Kubernetes-naamruimte** **begint met** `payments-`.

Elke maand worden de kosten van de nodes verdeeld naar wat elke naamruimte kostte in de [kostenengine](/docs/telemetry/kubernetes-cost) van het cluster, en het deel van elke naamruimte gaat naar de eerste groep waarvan de regels erop passen. Ongebruikte capaciteit, en een naamruimte die geen groep neemt, blijven bij de groep van het cluster. De eigen geprijsde kosten van het cluster worden nooit bij je rekening opgeteld, zodat niets dubbel wordt geteld.

## Eigen posten

Voeg onder **Cloud → Uitgaven → Kostengroepen → Eigen posten** een afschrijving of creditering toe die niet op de rekeningen van je clouds staat: een deel van een supportcontract, een bedrijfskorting, een interne opslag of een platformvergoeding.

- **Eenmalig of elke maand.** Een maandelijkse post wordt over de dagen van elke maand verdeeld, zodat een deel van een maand zijn deel krijgt.
- **Op een account of een groep.** Een post die aan een account is toegevoegd, gaat door de regels van elke weergave zoals de kosten van het account. Een post die aan een groep is toegevoegd, gaat er direct naartoe.
- **Altijd apart.** Elk cijfer houdt posten apart van wat de clouds factureerden, zodat de eigen cijfers van de clouds blijven kloppen met hun consoles.

## De uitgaven van elke groep bekijken

- **Cloud → Uitgaven → Kosten**: kies onder **Waar het geld naartoe gaat** **Kostengroepen** en een weergave. De uitgaven van elke groep, vergeleken met de periode ervoor.
- **De pagina van een weergave**: wat elke groep in rekening is gebracht, met zijn gedeelde kosten, wat geen regel neemt, en **CSV downloaden** voor de doorbelasting van de maand.
- **De pagina van een groep**: de uitgaven dag voor dag, de services, resources en accounts die hem het meest worden aangerekend, en zijn regels. Hij toont alleen de uitgaven van die groep, dus koppel de groep aan zijn **Team** en stuur het team de pagina: iedereen die de clouduitgaven mag lezen, kan hem openen.

## API, CLI en MCP

Weergaven, groepen en posten zijn API-resources (`cloud-cost-view`, `cloud-cost-group`, `cloud-cost-line-item`), met CLI-opdrachten en MCP-tools zoals elke resource. De regels van een groep zijn JSON:

```json
[
  { "conditions": [{ "field": "tag", "key": "team", "operator": "is", "values": ["payments"] }] },
  { "conditions": [{ "field": "ownerTeam", "operator": "is", "values": ["<team ID>"] }] }
]
```

Om te lezen wat een weergave toewijst, voor hele UTC-dagen van `startDate` tot `endDate`:

```bash
curl -X POST "https://oneuptime.com/api/cloud-cost-view/<view ID>/allocation" \
  -H "apikey: <API key>" -H "tenantid: <project ID>" -H "Content-Type: application/json" \
  -d '{"startDate": "2026-11-01", "endDate": "2026-11-30", "currency": "USD"}'
```

Het antwoord bevat de `total` van elke groep en waaruit die bestaat (`cloud`, `lineItems`, `sharedIn`, `sharedOut`), de cijfers per dag of per maand, de periode ervoor, en waaruit de niet-toegewezen uitgaven bestaan. `POST /cloud-cost-group/<group ID>/spend` antwoordt voor één groep.

## Limieten

- Een weergave bevat hoogstens 500 groepen. Een weergave op tag maakt groepen voor de 500 duurste waarden.
- Een groep heeft hoogstens 25 regels, een regel 20 voorwaarden en een voorwaarde 200 waarden.
- Kosten worden 400 dagen bewaard, dus een weergave leest hoogstens 400 dagen.

## Problemen oplossen

:::details Een groep krijgt niets
De regels passen misschien nog op geen enkele kostenpost, of een eerdere groep neemt alle kosten waarop ze passen. Zijn rij onder **Groepen** noemt dan die groep: sleep deze erboven, of beperk de regels van de eerdere groep.
:::

:::details Een kostenpost staat in de verkeerde groep
Een kostenpost valt in de eerste groep waarvan de regels erop van toepassing zijn. Sleep de groep waar hij bij hoort boven de groep die hem neemt, of beperk de regels van die groep.
:::

:::details Een regel op een tag past op niets
Een kostenpost houdt de tags die hij had toen hij werd gelezen: de labels van een factureringsexport van Google Cloud, anders de tags van de resource waaraan hij wordt gefactureerd, wat bij AWS [Kosten per resource](/docs/telemetry/cloud-costs#kosten-per-resource) vereist. De sleutel van een tag wordt vergeleken zoals hij geschreven is.
:::

:::details Een weergave op tag of op eigenaarsteam mist een groep
OneUptime maakt de ontbrekende groepen elk uur: één voor elke tagwaarde van de kosten van de afgelopen 400 dagen, of voor elk team dat cloudresources bezit, tot 500 groepen. Klik op de pagina van de weergave op **Groepen nu maken** om ze meteen te maken.
:::

:::details De cijfers laten een account weg
De cijfers van een weergave staan in de valuta waarin de meeste van je accounts worden gefactureerd. Een account dat in een andere wordt gefactureerd, blijft erbuiten, net als een post in een andere valuta.
:::

## Volgende stappen

:::cards
- [Cloudkosten en besparingen](/docs/telemetry/cloud-costs): Wat je gekoppelde accounts kosten, en hoe je minder uitgeeft.
- [Label- en eigenaarsregels](/docs/configuration/label-and-owner-rules): Geef resources eigenaarsteams en labels die de regels lezen.
- [Kubernetes-kostenobservability](/docs/telemetry/kubernetes-cost): Wat elke Kubernetes-workload kost.
:::
