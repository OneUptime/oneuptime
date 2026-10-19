# Microsoft Sentinel

Importeer de incidenten die je [Microsoft Sentinel](https://learn.microsoft.com/en-us/azure/sentinel/overview)-analyseregels openen in de beveiligingsgebeurtenissen van OneUptime. Daar doorzoek je ze naast je logs, traces en metrics, correleer je ze met elke andere bron en roep je de dienst op voor de incidenten die ertoe doen. OneUptime leest ze met een app-registratie die jij maakt, en verandert niets in Azure.

:::cards
- [De verbinding instellen](#de-verbinding-instellen): Een app-registratie, een rol en het formulier van de verbinding.
- [Wat er wordt geïmporteerd](#wat-er-wordt-geïmporteerd): Hoe elk Sentinel-incident een beveiligingsgebeurtenis wordt.
- [Hoe pollen werkt](#hoe-pollen-werkt): Het venster dat elke poll leest, en wat een drukke werkruimte daarmee doet.
- [Problemen oplossen](#problemen-oplossen): Wat elke fout betekent en wat je moet wijzigen.
:::

## Hoe het werkt

```mermaid title="Van een Sentinel-incident naar een beveiligingsgebeurtenis"
flowchart TB
    rule["Een analyseregel<br/>opent een incident"] --> poll["OneUptime pollt<br/>volgens het interval<br/>van de verbinding"]
    poll --> token["Het meldt zich aan<br/>als je app-registratie"]
    token --> list["Het toont de<br/>incidenten die sinds<br/>de vorige keer<br/>zijn gemaakt"]
    list --> event["Elk wordt opgeslagen<br/>als Incident Finding"]
```

Elke minuut pollt OneUptime elke ingeschakelde verbinding waarvan het pollinterval is verstreken. Een poll meldt zich als je app-registratie aan bij Microsoft Entra ID, vraagt Azure Resource Manager om de incidenten die sinds de vorige poll zijn gemaakt, en slaat elk op als een [OCSF](https://schema.ocsf.io/)-gebeurtenis Incident Finding (klasse `2005`). Detectieregels, monitoren en dashboards behandelen die daarna als een beveiligingsgebeurtenis uit elke andere bron.

## Voordat je begint

- In OneUptime de rol Project Owner, Project Admin of Security Admin. Security Member en Security Viewer zien verbindingen en hun runhistorie, maar kunnen ze niet wijzigen.
- Een Log Analytics-werkruimte met Microsoft Sentinel ingeschakeld, in de openbare cloud van Azure of in Azure Government (US).
- In Microsoft Entra ID het recht om een app-registratie en een clientgeheim te maken.
- Op de resourcegroep met de werkruimte het recht om rollen toe te wijzen, zoals Eigenaar of Beheerder van gebruikerstoegang.

## De verbinding instellen

De verbinding meldt zich aan met de OAuth 2.0-flow voor clientreferenties: als toepassing, nooit als persoon. Haar toegang komt van een Azure-rol, dus de app-registratie heeft geen API-machtigingen nodig.

:::steps
### Een toepassing registreren

1. Meld je aan bij de [Azure-portal](https://portal.azure.com) en open **Microsoft Entra ID**.
2. Ga naar **App registrations → New registration**. Noem hem `OneUptime Sentinel connector`, laat **Supported account types** op **Accounts in this organizational directory only** staan, laat de omleidings-URI leeg en selecteer **Register**.
3. Kopieer op de pagina **Overview** van de app de **Application (client) ID** en de **Directory (tenant) ID**.
4. Ga naar **Certificates & secrets → Client secrets → New client secret**, kies wanneer het verloopt en selecteer **Add**. Kopieer de **Value** van het geheim, niet de **Secret ID**, voordat je de pagina verlaat: die wordt nooit meer getoond.

### Hem incidenten laten lezen

1. Open in de Azure-portal de resourcegroep met je Log Analytics-werkruimte.
2. Selecteer **Access control (IAM) → Add → Add role assignment**.
3. Kies op het tabblad **Role** de rol **Microsoft Sentinel Reader**.
4. Kies op het tabblad **Members** **User, group, or service principal**, klik op **Select members** en kies je app-registratie op naam.
5. Selecteer **Review + assign**.

Met de rol kan de app incidenten lezen (`Microsoft.SecurityInsights/incidents/read`) en niets schrijven. Microsoft raadt aan hem op de resourcegroep toe te wijzen in plaats van op de werkruimte, zodat hij ook de oplossing `SecurityInsights` dekt waaruit de incidenten komen. Een nieuwe toewijzing kan een paar minuten nodig hebben om actief te worden.

### De gegevens van de werkruimte vinden

Open de Log Analytics-werkruimte in de Azure-portal. De pagina **Overview** toont de **Subscription ID**, de **Resource group** en de naam van de werkruimte. De resource-ID van de werkruimte bevat dezelfde drie:

```text
/subscriptions/{Subscription ID}/resourceGroups/{Resource group}/providers/Microsoft.OperationalInsights/workspaces/{Workspace name}
```

### De verbinding toevoegen in OneUptime

Open **Producten → Security Events → Connections** (`/dashboard/{projectId}/security-events/connections`), klik op **Verbinding toevoegen**, kies **Microsoft Sentinel** en klik op **Volgende**. Vul de instellingen uit de tabel hieronder in, klik op **Volgende** en plak de waarde van het geheim in **Client secret**.

### Testen voordat je opslaat

Klik op **Test these settings** onder **Testen voor het opslaan**. De test meldt zich aan en leest incidenten met de waarden uit het formulier, en slaat niets op, dus een verkeerd geheim of een ontbrekende rol komt aan het licht voordat de verbinding bestaat. Klik daarna op **Volgende**, geef de verbinding een **Naam** en maak haar aan.
:::

| Instelling | Waar je haar vindt |
| --- | --- |
| **Directory (tenant) ID** | De pagina **Overview** van de app. De GUID van de tenant, of een geverifieerd domein zoals `contoso.onmicrosoft.com`. |
| **Application (client) ID** | De pagina **Overview** van de app. Een GUID. |
| **Subscription ID** | De pagina **Overview** van de werkruimte. Een GUID. |
| **Resource group** | De pagina **Overview** van de werkruimte. 1 tot 90 letters, cijfers, underscores, koppeltekens, punten of haakjes, niet eindigend op een punt. |
| **Workspace name** | De pagina **Overview** van de werkruimte. 3 tot 90 letters, cijfers of koppeltekens, beginnend en eindigend met een letter of cijfer. |
| **Cloud** | **Azure public cloud** (`login.microsoftonline.com`, `management.azure.com`) of **Azure Government (US)** (`login.microsoftonline.us`, `management.usgovcloudapi.net`). |
| **Client secret** | De **Value** van het geheim. Het wordt versleuteld, nooit door de API teruggegeven en nooit meer getoond. Vervang het met **Update credentials** op de verbinding. |

De stap **Polling** heeft ook een optionele **Beschrijving**, het **Poll Interval (Minutes)**, een geheel getal van `1` tot `1440` dat begint op `5`, en **Ingeschakeld**, dat aan begint.

## Wat er wordt geïmporteerd

Elk Sentinel-incident wordt één gebeurtenis Incident Finding (OCSF-klasse `2005`, activiteit `Create`), toegeschreven aan de telemetrieservice `Microsoft Sentinel`:

| OCSF-kolom | Veld van het Sentinel-incident |
| --- | --- |
| `time` | `properties.createdTimeUtc`, wanneer Sentinel het incident maakte |
| `eventUid` | `name`, de GUID van het incident, waarop ook duplicaten worden verwijderd |
| `message`, `ruleName` | `properties.title` |
| `ruleId` | De regel-GUID aan het einde van de eerste vermelding in `properties.relatedAnalyticRuleIds` |
| `severityName` | `properties.severity`: `High`, `Medium`, `Low` of `Informational` |
| `statusName` | `properties.status`: `New`, `Active` of `Closed` |
| `mitreTactics` | `properties.additionalData.tactics`, als ATT&CK-ID's: `Persistence` wordt `TA0003` |
| `principalUser` | `properties.owner.userPrincipalName`, of `properties.owner.email` |
| `targetResource` | `properties.incidentUrl`, een link naar het incident in de Azure-portal |
| `observables` | De UPN, het e-mailadres en de object-ID van de eigenaar, en de naam van elk label |
| `attributes` | Het hele incident, plat gemaakt tot sleutels met punten zoals `properties.classification` en `properties.firstActivityTimeUtc` |

Gesloten incidenten die in het venster van een poll zijn gemaakt, worden ook geïmporteerd. Filter op `statusName` in de verkenner van beveiligingsgebeurtenissen om alleen open incidenten te zien.

## Hoe pollen werkt

Elke poll toont de incidenten die in zijn venster zijn gemaakt, de oudste eerst, 50 per pagina, en volgt de `nextLink` van de API tot hij het hele venster heeft gelezen:

```text
GET https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{ws}/providers/Microsoft.SecurityInsights/incidents
    ?api-version=2024-03-01
    &$filter=(properties/createdTimeUtc ge {windowStart}) and (properties/createdTimeUtc lt {windowEnd})
    &$orderby=properties/createdTimeUtc asc
    &$top=50
```

- **De aanmaaktijd is de cursor.** Een geplande analyseregel die elk uur draait, opent zijn incident lang na de activiteit die hij opmerkte, en de `firstActivityTimeUtc` van het incident kan uren of dagen eerder liggen. Een cursor op activiteitstijd zou elk zo'n incident overslaan. De activiteitstijden blijven in `attributes`, en de voorbeelden in de diagnose tonen beide.
- **De eerste poll kijkt 24 uur terug**, zodat een nieuwe verbinding meteen haar recente incidenten toont.
- **Elke volgende poll begint 1 minuut voor de opgeslagen cursor**, zodat een incident dat op de grens van twee vensters is gemaakt nooit wordt overgeslagen.
- **Een poll leest hooguit 24 uur voorbij de cursor.** Een verbinding waarvan de cursor achterliep, haalt de achterstand in met een reeks vensters van 24 uur, en haar **Health** toont **Catching up**.
- **Duplicaten worden verwijderd op de GUID van het incident** (`name`) binnen het project, zodat de overlap, een herhaald venster en een import een incident nooit twee keer opslaan.

### Wanneer een venster meer bevat dan één poll kan lezen

Een poll leest hooguit 20 pagina's van 50 incidenten: 1.000 incidenten. Wanneer die grens hem vóór het einde van zijn venster stopt, is de run **Partial**, met een waarschuwing zoals:

```text
Stopped after 20 incidents requests (the per-run request limit) before reading the whole window. Incidents are read oldest first; every incident created before 2026-09-14T08:12:44.000Z was read.
```

Incidenten worden van oud naar nieuw gelezen, dus OneUptime zet de cursor op de aanmaaktijd van het laatst gelezen incident, en de volgende poll begint daar, met dezelfde vensterlengte. Een drukke werkruimte haalt zo ongeveer 1.000 incidenten per poll in, in plaats van dezelfde opnieuw te lezen. De incidenten die op datzelfde moment zijn gemaakt, worden twee keer gelezen, en de duplicaatcontrole verwijdert de tweede kopie.

Wanneer een run helemaal niet voorbij de opgeslagen cursor komt, maakt OneUptime het venster in plaats daarvan korter:

1. **Verkleinen.** De volgende poll leest een venster dat half zo lang is, vanaf hetzelfde beginpunt, en blijft halveren tot een venster volledig wordt gelezen, tot één minuut. De waarschuwing van de run zegt het: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.`
2. **Weer groeien.** Nadat een venster volledig is gelezen, is het volgende weer twee keer zo lang, tot 24 uur.
3. **Voorbij één minuut gaan.** Als zelfs één minuut meer bevat dan een poll kan lezen, gaat het pollen eraan voorbij, zodat nieuwere incidenten blijven binnenkomen. De run blijft **Partial**, en **Laatste fout** luidt `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importeer die minuut met **Import this time range** om terug te halen wat één run kan lezen.

Een run die volledig mislukt, met een fout van Microsoft Entra ID of Azure Resource Manager, behoudt de cursor en de vensterlengte, en de volgende poll leest hetzelfde venster opnieuw. De enige uitzondering is een verzoek dat een time-out kreeg: de cursor blijft staan, maar het volgende venster is half zo lang, omdat een venster dat te zwaar is om op tijd te beantwoorden bij elke poging een time-out zou krijgen. Het **Poll Interval (Minutes)** wijzigen verandert hier niets aan: het bepaalt hoe vaak een poll start, niet waar zijn venster begint.

### Uitvoeren, bekijken en importeren op verzoek

Klik op **Diagnostics** bij een verbinding om haar recente runs te zien en er met de hand mee te werken. Iedereen die de verbinding kan wijzigen, kan deze acties starten; iedereen die haar kan zien, kan de historie lezen.

- **Run now** start meteen een poll, met de gewone cursor, ook als de verbinding niet **Ingeschakeld** is.
- **Preview incidents** leest een tijdsbereik van maximaal 7 dagen en importeert niets.
- **Import this time range** importeert een bereik van maximaal 7 dagen, nadat je bevestigt, zonder de cursor te verplaatsen. Al geïmporteerde incidenten worden overgeslagen.
- **Copy diagnostics** bij een run kopieert het rapport ervan voor support. Het bevat nooit referenties.

## Verbinding testen

**Verbinding testen** op de rij van een verbinding, en **Test these settings** in het formulier, draaien in het API-proces, niet in een achtergrondworker, zodat een test ook antwoordt wanneer de workers het probleem zijn. Hij voert deze controles uit, in volgorde:

| Controle | Wat ze controleert |
| --- | --- |
| **Configuratie** | Elke instelling is aanwezig en goed gevormd. Er wordt niets benaderd als dit mislukt. |
| **Authenticate with Microsoft Entra** | Microsoft Entra ID geeft je app-registratie een token voor Azure Resource Manager. |
| **Read incidents** | Eén incident dat in de afgelopen 24 uur is gemaakt, kan worden gelezen (`$top=1`). Dat bewijst de rol en de gegevens van de werkruimte. |
| **Incidents available to import** | Hoeveel incidenten in de afgelopen 24 uur en de afgelopen 7 dagen zijn gemaakt, één pagina van 50 voor elk, dus `50+` betekent meer. Geen in 7 dagen is een waarschuwing, geen fout. |
| **Background workers**, **Poll scheduler**, **Security event storage** | De kant van OneUptime zelf: een proces neemt de jobs van de Worker-wachtrij af, de poll-job draait elke minuut en de opslag van beveiligingsgebeurtenissen antwoordt. |
| **Scheduled polling** | Voor een opgeslagen verbinding: pollen staat aan, geen run zit vast in afwachting van een worker en polls draaien op tijd. |

Elk verzoek in een test heeft een deadline van 20 seconden. Een test importeert nooit iets en verplaatst nooit de cursor, en elke mislukte controle zegt wat je moet wijzigen.

## Problemen oplossen

De **Laatste fout** van de verbinding bewaart de volledige foutmelding, met referenties gemaskeerd, achter een voorvoegsel dat de mislukte stap noemt. Wanneer een verbinding een fout heeft, selecteer je **Fout bekijken** in haar kolom **Acties** om hem te lezen, en **Fout kopiëren** in het dialoogvenster om hem te kopiëren. Lees eerst het voorvoegsel.

:::details Last Error begint met `Microsoft Sentinel token request`
- `Microsoft Sentinel token request failed (HTTP ...)`: Microsoft Entra ID weigerde een token uit te geven, dus Azure is nooit benaderd. Het bericht citeert de code van Entra:
  - `AADSTS7000215` of `invalid_client`: het **Client secret** is verkeerd of verlopen, of het is de ID van het geheim in plaats van de waarde. Maak een nieuw geheim en sla het op met **Update credentials**.
  - `AADSTS700016` of `unauthorized_client`: de **Application (client) ID** staat niet in de opgegeven **Directory (tenant) ID**. Vergelijk beide met de pagina **Overview** van de app.
  - `AADSTS90002` of `HTTP 404`: die tenant bestaat niet. De **Directory (tenant) ID** is verkeerd, of hij staat in de andere cloud: controleer **Cloud**.
  - `HTTP 429` of `HTTP 5xx`: Microsoft Entra ID beperkt verzoeken of is niet beschikbaar. De volgende poll probeert het opnieuw.
- `Microsoft Sentinel token request returned ...`: Microsoft Entra ID antwoordde met iets onbruikbaars, bijvoorbeeld een body die geen JSON is of geen `access_token` heeft. Dat is meestal een proxy of gateway ertussen.
- `Microsoft Sentinel token request failed:`, zonder status, of `Microsoft Sentinel token request timed out after ... seconds with no response`: het verzoek kreeg geen antwoord. Controleer DNS, TLS en uitgaand HTTPS van de OneUptime-app en -workers naar `login.microsoftonline.com`.
:::

:::details Last Error begint met `Microsoft Sentinel incidents list`
- `Microsoft Sentinel incidents list failed (HTTP ...)`: Azure Resource Manager weigerde het verzoek.
  - `HTTP 401`: hij accepteerde het token niet. Bijna altijd past **Cloud** niet bij de tenant, of is de app-registratie verwijderd. Een token dat tussen twee pagina's verloopt, wordt vanzelf vernieuwd en één keer opnieuw geprobeerd.
  - `HTTP 403` of `AuthorizationFailed`: de app heeft nog geen **Microsoft Sentinel Reader** op de resourcegroep. Wijs die toe en wacht een paar minuten.
  - `HTTP 404`: geen enkele werkruimte heeft die **Subscription ID**, **Resource group** en **Workspace name**, of Microsoft Sentinel is daar niet ingeschakeld. Kopieer ze van de pagina **Overview** van de werkruimte.
  - `HTTP 429` of `HTTP 5xx`: Azure Resource Manager beperkt verzoeken of is niet beschikbaar. De volgende poll probeert het opnieuw.
  - `HTTP 400`: Azure Resource Manager weigerde het verzoek, dat OneUptime opbouwt en niet je instellingen. Stuur het bericht naar de support van OneUptime.
- `Microsoft Sentinel incidents list returned ...`: Azure antwoordde `200`, maar zonder leesbare pagina met incidenten, of met een `nextLink` naar een andere host, die de verbinding weigert zodat het token Azure Resource Manager nooit verlaat. Dit wordt gemeld in plaats van als een leeg venster te worden opgevat, zodat de cursor nooit voorbij incidenten gaat die niemand heeft gelezen.
- `Microsoft Sentinel incidents list failed:`, zonder status, of `Microsoft Sentinel incidents list timed out after ... seconds with no response`: het verzoek kreeg geen antwoord. Controleer uitgaand HTTPS van de OneUptime-workers naar `management.azure.com`, of `management.usgovcloudapi.net`.
:::

:::details Last Polled is Never en Last Error is leeg
Er is voor deze verbinding nog geen poll voltooid. Voer **Verbinding testen** uit: de controles **Background workers** en **Poll scheduler** noemen de oorzaak. Op een zelf gehoste installatie is de gebruikelijke oorzaak `DISABLE_QUEUE_WORKERS=true` op de app, zonder aparte worker-deployment die de jobs afneemt: zet het op `false`, of draai de worker-deployment (Helm: `worker.enabled: true`).
:::

:::details Een run is Partial
- `Stopped after 20 incidents requests (the per-run request limit) before reading the whole window`: het venster bevatte meer dan de 1.000 incidenten die één run leest. Er gaat niets verloren: de volgende poll begint na het laatst gelezen incident. Een verbinding die poll na poll **Partial** blijft, haalt een achterstand in, en haar **Last Polled** en **Last Event Imported** blijven doorschuiven.
- `Microsoft Sentinel returned incidents out of creation-time order, so this run cannot name a point to resume from.`: de API negeerde de volgorde van oud naar nieuw, dus de run kan de cursor niet op zijn laatste incident zetten, en de volgende poll leest in plaats daarvan een korter venster. Gebeurt het steeds weer, stuur dan het rapport van de run naar de support van OneUptime.
- `More records were created in the one minute from ... than one poll can read`: het pollen ging voorbij die minuut. Importeer haar met **Import this time range** in **Diagnostics**. Een import leest net zoveel als een poll.
:::

:::details De test slaagt, maar er wordt niets geïmporteerd
Lees **Incidents available to import** in het rapport van de test. `0` in de afgelopen 7 dagen betekent dat de analyseregels van de werkruimte geen incidenten hebben geopend, en dat is geen fout van de verbinding. Controleer in Microsoft Sentinel of de regels zijn ingeschakeld en incidenten aanmaken.
:::

## Azure Government

Zet **Cloud** op **Azure Government (US)**. De verbinding meldt zich dan aan bij `login.microsoftonline.us` met het bereik `https://management.usgovcloudapi.net/.default`, en leest incidenten uit `management.usgovcloudapi.net`. Al het andere, ook de roltoewijzing, is hetzelfde.

## Wat je krijgt

- **Zoeken.** Filter incidenten op ernst, status, eigenaar, label of tactiek in de verkenner van beveiligingsgebeurtenissen, naast elke andere bron.
- **Correlatie.** De eigenaar en de labels van elk incident worden geïndexeerd als observables, dus één zoekopdracht vindt alles wat ze noemt.
- **Detectieregels.** Sigma-regels die volgens een schema over je beveiligingsgebeurtenissen draaien, en waarschuwingen openen die de dienst oproepen.
- **Monitoren.** Monitoren voor beveiligingsgebeurtenissen tellen overeenkomende gebeurtenissen, zoals nieuwe High-incidenten, en openen boven een drempel incidenten of waarschuwingen.

Beveiligingsgebeurtenissen worden gefactureerd zoals de rest van je telemetrie, per opgenomen GB. Zie [Prijzen](https://oneuptime.com/pricing).

## Volgende stappen

:::cards
- [Beveiligingsgebeurtenissen](/docs/telemetry/security-events): Zoeken, correleren en waarschuwen op wat je importeert.
- [Microsoft Defender XDR](/docs/integrations/microsoft-defender-xdr): Importeer ook de waarschuwingen van elke Defender-workload.
- [Rollen](/docs/permissions/reference#rollen): Wat de Security-rollen kunnen zien en wijzigen.
- [Overzicht van integraties](/docs/integrations/index): De andere tools die je kunt koppelen.
:::
