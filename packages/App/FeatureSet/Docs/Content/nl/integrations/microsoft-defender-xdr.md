# Microsoft Defender XDR

Importeer de waarschuwingen van elke [Microsoft Defender XDR](https://learn.microsoft.com/en-us/defender-xdr/)-workload, van endpoints, identiteiten, e-mail en cloud-apps, in de beveiligingsgebeurtenissen van OneUptime. Daar doorzoek je ze naast je logs, traces en metrics, correleer je ze met elke andere bron en roep je de dienst op voor de waarschuwingen die ertoe doen. OneUptime leest ze via de beveiligings-API van Microsoft Graph met een app-registratie die jij maakt: er is geen agent, playbook of Sentinel-werkruimte nodig.

:::cards
- [De verbinding instellen](#de-verbinding-instellen): Een app-registratie, één machtiging en het formulier van de verbinding.
- [Wat er wordt geïmporteerd](#wat-er-wordt-geïmporteerd): Hoe elke Defender-waarschuwing een beveiligingsgebeurtenis wordt.
- [Hoe pollen werkt](#hoe-pollen-werkt): Het venster dat elke poll leest, en wat een drukke tenant daarmee doet.
- [Problemen oplossen](#problemen-oplossen): Wat elke fout betekent en wat je moet wijzigen.
:::

## Hoe het werkt

```mermaid title="Van een Defender-waarschuwing naar een beveiligingsgebeurtenis"
flowchart TB
    defender["Een Defender-<br/>workload geeft een<br/>waarschuwing"] --> poll["OneUptime pollt<br/>volgens het interval<br/>van de verbinding"]
    poll --> token["Het meldt zich aan<br/>als je app-registratie"]
    token --> list["Het toont de<br/>waarschuwingen die<br/>sinds de vorige keer<br/>zijn gemaakt"]
    list --> event["Elk wordt opgeslagen<br/>als Detection Finding"]
```

Elke minuut pollt OneUptime elke ingeschakelde verbinding waarvan het pollinterval is verstreken. Een poll meldt zich als je app-registratie aan bij Microsoft Entra ID, vraagt Microsoft Graph om de waarschuwingen die sinds de vorige poll zijn gemaakt ([List alerts_v2](https://learn.microsoft.com/en-us/graph/api/security-list-alerts_v2)), en slaat elk op als een [OCSF](https://schema.ocsf.io/)-gebeurtenis Detection Finding (klasse `2004`). Detectieregels, monitoren en dashboards behandelen die daarna als een beveiligingsgebeurtenis uit elke andere bron.

## Voordat je begint

- In OneUptime de rol Project Owner, Project Admin of Security Admin. Security Member en Security Viewer zien verbindingen en hun runhistorie, maar kunnen ze niet wijzigen.
- Een Microsoft Entra-tenant met een licentie voor Microsoft Defender XDR: elke Defender-workload die is toegevoegd aan de Microsoft Defender-portal, zoals Defender for Endpoint, for Identity, for Office 365 of for Cloud Apps.
- Een Entra-rol die toepassingen mag registreren, zoals Toepassingsbeheerder, en een Globale beheerder of Beheerder met bevoorrechte rol om beheerderstoestemming te verlenen.
- Uitgaand HTTPS van de OneUptime-app en -workers naar `login.microsoftonline.com` en `graph.microsoft.com`, of naar `login.microsoftonline.us` en `graph.microsoft.us` voor Azure Government.

## De verbinding instellen

De verbinding meldt zich aan met de [OAuth 2.0-flow voor clientreferenties](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow): als toepassing, nooit als persoon, met één toepassingsmachtiging.

:::steps
### Een toepassing registreren

1. Meld je aan bij de [Azure-portal](https://portal.azure.com) en open **Microsoft Entra ID**.
2. Ga naar **App registrations → New registration**. Noem hem `OneUptime Security Events`, laat **Supported account types** op **Accounts in this organizational directory only** staan, laat de omleidings-URI leeg en selecteer **Register**.
3. Kopieer op de pagina **Overview** van de app de **Applicatie-ID (client)** en de **Directory-ID (tenant)**.

### Hem waarschuwingen laten lezen

1. Ga naar **API permissions → Add a permission → Microsoft Graph → Application permissions**, kies `SecurityAlert.Read.All` en selecteer **Add permissions**. Het is de machtiging met de minste rechten die de aanroep [List alerts_v2](https://learn.microsoft.com/en-us/graph/api/security-list-alerts_v2#permissions) voor een toepassing accepteert: voeg `SecurityAlert.ReadWrite.All` niet toe.
2. Selecteer **Grant admin consent for** je tenant en bevestig. De status van de machtiging moet **Granted** zijn: zonder toestemming wordt elke leesactie geweigerd met `403`.

### Een clientgeheim maken

Ga naar **Certificates & secrets → Client secrets → New client secret**, kies wanneer het verloopt en selecteer **Add**. Kopieer de **Value** van het geheim, niet de **Secret ID**, voordat je de pagina verlaat: die wordt nooit meer getoond.

Noteer wanneer het geheim verloopt. Op die dag stopt het pollen met `Microsoft Defender XDR token request failed (HTTP 401)` tot je het vervangt met **Inloggegevens bijwerken**.

### De verbinding toevoegen in OneUptime

Open **Producten → Security Events → Verbindingen** (`/dashboard/{projectId}/security-events/connections`), klik op **Verbinding toevoegen**, kies **Microsoft Defender XDR** onder **EDR / XDR** en klik op **Volgende**. Vul de instellingen uit de tabel hieronder in, klik op **Volgende** en plak de waarde van het geheim in **Clientgeheim**.

### Testen voordat je opslaat

Klik op **Deze instellingen testen** onder **Testen voor het opslaan**. De test meldt zich aan en leest waarschuwingen met de waarden uit het formulier, en slaat niets op, dus een verkeerd geheim of een ontbrekende toestemming komt aan het licht voordat de verbinding bestaat. Klik daarna op **Volgende**, geef de verbinding een **Naam** en maak haar aan.
:::

| Instelling | Waar je haar vindt |
| --- | --- |
| **Directory-ID (tenant)** | De pagina **Overview** van de app. De GUID van de tenant, of een geverifieerd domein zoals `contoso.onmicrosoft.com`. |
| **Applicatie-ID (client)** | De pagina **Overview** van de app. De GUID van de app die `SecurityAlert.Read.All` heeft. |
| **Cloud** | **Openbare Azure-cloud**, die ook Microsoft 365 GCC bedient, of **Azure Government (VS)** voor GCC High (`login.microsoftonline.us` en `graph.microsoft.us`). Microsoft 365 DoD en de 21Vianet-cloud in China worden niet ondersteund. |
| **Clientgeheim** | De **Value** van het geheim. Het wordt versleuteld, nooit door de API teruggegeven en nooit meer getoond. Vervang het met **Inloggegevens bijwerken** op de verbinding. |

De stap **Opvragen** heeft ook een optionele **Beschrijving**, het **Opvraaginterval (minuten)**, een geheel getal van `1` tot `1440` dat begint op `5`, en **Ingeschakeld**, dat aan begint.

## Wat er wordt geïmporteerd

Elke [waarschuwing](https://learn.microsoft.com/en-us/graph/api/resources/security-alert) van Defender XDR wordt één gebeurtenis Detection Finding (OCSF-klasse `2004`), met leverancier `Microsoft` en product `Microsoft Defender XDR`, toegeschreven aan de telemetrieservice `Microsoft Defender XDR`:

| OCSF-kolom | Veld van de waarschuwing |
| --- | --- |
| `eventUid` | `id`, de ID van de Graph-waarschuwing, waarop ook duplicaten worden verwijderd |
| `time` | `firstActivityDateTime`, of `createdDateTime` als die ontbreekt |
| `message`, `ruleName` | `title` |
| `ruleId` | `detectorId`, of `alertPolicyId` als die ontbreekt |
| `severityName` | `severity`: `informational`, `low`, `medium` of `high`, en `unknown` blijft Unknown |
| `statusName` | `status`: `new` wordt New, `inProgress` In Progress, `resolved` Resolved |
| `mitreTechniques` | `mitreTechniques` |
| `mitreTactics` | `categories` of `category`, als het een ATT&CK-tactiek is: `CredentialAccess` wordt `TA0006`. Andere categorieën blijven in `attributes`. |
| `principalHost`, `principalUser`, `principalIp`, `principalProcess` | De `evidence` met de rol `source`, `attacker` of `compromised`, anders de eerste van elk soort |
| `processName`, `processPath`, `processCommandLine`, `parentProcessName`, `parentProcessPath` | Het procesbewijs waar `principalProcess` uit komt: de `imageFile`, `processCommandLine` en `parentProcessImageFile` ervan. Graph geeft geen opdrachtregel van het bovenliggende proces. |
| `targetHost`, `targetUser`, `targetIp`, `targetResource` | De `evidence` met een doelrol, zoals `destination` of `attacked`. URL's, postvakken en cloudresources vullen `targetResource`. |
| `observables` | Elke hostnaam, IP, gebruiker, bestandsnaam, SHA-1 en SHA-256, URL, domein, postvak en resource-ID in `evidence` |
| `attributes` | De hele waarschuwing, plat gemaakt tot sleutels met punten zoals `evidence.0.hostName`, `serviceSource` en `incidentId` |

Waarschuwingen van elke `serviceSource` worden geïmporteerd, ook die van Microsoft Sentinel zodra Sentinel met de Defender-portal is verbonden. Incidenten worden niet geïmporteerd, maar elke waarschuwing behoudt haar `incidentId` en `incidentWebUrl` in `attributes`.

## Hoe pollen werkt

Elke poll toont de waarschuwingen die in zijn venster zijn gemaakt, 100 per pagina, en volgt de `@odata.nextLink` van Graph tot hij het hele venster heeft gelezen:

```text
GET https://graph.microsoft.com/v1.0/security/alerts_v2?$filter=createdDateTime ge {start} and createdDateTime lt {end}&$top=100
```

- **De aanmaaktijd is de cursor.** Defender maakt een waarschuwing vaak uren na haar `firstActivityDateTime`, en een cursor op activiteitstijd zou elke zo'n waarschuwing overslaan.
- **De eerste poll kijkt 24 uur terug**, zodat een nieuwe verbinding meteen haar recente waarschuwingen toont.
- **Elke volgende poll begint 1 minuut voor de opgeslagen cursor**, zodat een waarschuwing die op de grens van twee vensters is gemaakt twee keer wordt gelezen en één keer geïmporteerd.
- **Een poll leest hooguit 24 uur voorbij de cursor.** Een verbinding waarvan de cursor achterliep, terwijl de workers stillagen of de tenant werd beperkt, haalt de achterstand in met een reeks vensters van 24 uur.
- **Duplicaten worden verwijderd op de `id` van de waarschuwing** binnen de gebeurtenissen van het project van `Microsoft` / `Microsoft Defender XDR`, zodat de overlap, een herhaald venster en een import een waarschuwing nooit twee keer opslaan.
- **Een mislukte run verandert niets.** Na een netwerkfout, of een foutstatus van Graph, blijven de cursor en de vensterlengte zoals ze waren, en leest de volgende poll hetzelfde venster opnieuw. De enige uitzondering is een verzoek dat een time-out kreeg: de cursor blijft staan, maar het volgende venster is half zo lang, omdat een venster dat te zwaar is om op tijd te beantwoorden bij elke poging een time-out zou krijgen.

### Wanneer een venster meer bevat dan één poll kan lezen

Een poll leest hooguit 20 pagina's van 100 waarschuwingen: 2.000 waarschuwingen. Wanneer die grens hem vóór het einde van zijn venster stopt, is de run **Gedeeltelijk**, met deze waarschuwing:

```text
Stopped after 20 alerts requests (the per-run request limit) before reading the whole window. Microsoft Graph lists alerts newest first and documents no way to sort them oldest first, so this run cannot name a point to resume from.
```

[List alerts_v2](https://learn.microsoft.com/en-us/graph/api/security-list-alerts_v2) documenteert `$filter`, `$top`, `$skip` en `$count`, maar niet `$orderby`, en geeft de nieuwste waarschuwingen eerst terug. De 2.000 waarschuwingen die een gestopte run las, zijn de nieuwste van zijn venster, dus de cursor daar voorbij zetten zou de oudere overslaan die hij nooit bereikte. OneUptime maakt het venster in plaats daarvan korter:

1. **Verkleinen.** De volgende poll leest een venster dat half zo lang is, vanaf hetzelfde beginpunt, en blijft halveren tot een venster volledig wordt gelezen, tot één minuut. De waarschuwing van de run zegt het: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Waarschuwingen die al uit het langere venster zijn geïmporteerd, worden als duplicaten overgeslagen.
2. **Weer groeien.** Nadat een venster volledig is gelezen, gaat de cursor naar het einde ervan, en is het volgende venster weer twee keer zo lang, tot 24 uur.
3. **Voorbij één minuut gaan.** Als zelfs één minuut meer dan 2.000 waarschuwingen bevat, gaat het pollen eraan voorbij, zodat nieuwere waarschuwingen blijven binnenkomen. De run blijft **Gedeeltelijk**, en **Laatste fout** luidt `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importeer die minuut met **Import this time range** om terug te halen wat één run kan lezen.

Een run die om een andere reden **Gedeeltelijk** is, zoals een waarschuwing die niet als beveiligingsgebeurtenis kon worden gelezen, wordt op dezelfde manier opnieuw geprobeerd, vanaf hetzelfde beginpunt. Het **Opvraaginterval (minuten)** wijzigen verandert hier niets aan: het bepaalt hoe vaak een poll start, niet waar zijn venster begint.

### Uitvoeren, bekijken en importeren op verzoek

Klik op **Diagnose** bij een verbinding om haar recente runs te zien en er met de hand mee te werken. Iedereen die de verbinding kan wijzigen, kan deze acties starten; iedereen die haar kan zien, kan de historie lezen.

- **Nu uitvoeren** start meteen een poll, met de gewone cursor, ook als de verbinding niet **Ingeschakeld** is.
- **Preview alerts** leest een tijdsbereik van maximaal 7 dagen en importeert niets.
- **Import this time range** importeert een bereik van maximaal 7 dagen, nadat je bevestigt, zonder de cursor te verplaatsen. Al geïmporteerde waarschuwingen worden overgeslagen.
- **Copy diagnostics** bij een run kopieert het rapport ervan voor support. Het bevat nooit referenties.

## Verbinding testen

**Verbinding testen** op de rij van een verbinding, en **Deze instellingen testen** in het formulier, draaien in het API-proces, niet in een achtergrondworker, zodat een test ook antwoordt wanneer de workers het probleem zijn. Hij voert deze controles uit, in volgorde:

| Controle | Wat ze controleert |
| --- | --- |
| **Configuratie** | De vier instellingen zijn aanwezig en goed gevormd. Er wordt niets benaderd als dit mislukt. |
| **Authenticate with Microsoft Entra** | Microsoft Entra ID geeft een token voor Microsoft Graph uit, in de cloud die je hebt gekozen. Dit mislukt bij een verkeerd of verlopen geheim, een verkeerde tenant- of client-ID, of de verkeerde cloud. |
| **Read alerts from Microsoft Graph** | Eén waarschuwing die in de afgelopen 24 uur is gemaakt, kan worden gelezen (`$top=1`). Een `403` hier is de ontbrekende machtiging `SecurityAlert.Read.All`, de ontbrekende beheerderstoestemming of een tenant zonder Defender XDR. |
| **Alerts available to import** | Hoeveel waarschuwingen in de afgelopen 24 uur en de afgelopen 7 dagen zijn gemaakt, één pagina van 100 voor elk, dus `100+` betekent meer. Geen in 7 dagen is een waarschuwing, geen fout. |
| **Background workers**, **Poll scheduler**, **Security event storage** | De kant van OneUptime zelf: een proces neemt de jobs van de Worker-wachtrij af, de poll-job draait elke minuut en de opslag van beveiligingsgebeurtenissen antwoordt. |
| **Scheduled polling** | Voor een opgeslagen verbinding: pollen staat aan, geen run zit vast in afwachting van een worker en polls draaien op tijd. |

Elk verzoek in een test heeft een deadline van 20 seconden. Een test importeert nooit iets en verplaatst nooit de cursor, en elke mislukte controle zegt wat je moet wijzigen.

## Problemen oplossen

De **Laatste fout** van de verbinding bewaart de volledige foutmelding, met referenties gemaskeerd, achter een voorvoegsel dat de mislukte stap noemt. Wanneer een verbinding een fout heeft, selecteer je **Fout bekijken** in haar kolom **Acties** om hem te lezen, en **Fout kopiëren** in het dialoogvenster om hem te kopiëren. Lees eerst het voorvoegsel.

:::details Last Error begint met `Microsoft Defender XDR token request`
- `Microsoft Defender XDR token request failed (HTTP ...)`: Microsoft Entra ID weigerde een token uit te geven, dus Graph is nooit benaderd. Het bericht eindigt met een hint, op basis van de `error`-code van Entra:
  - `invalid_client` (`AADSTS7000215`): het geheim is verkeerd, verlopen of hoort bij een andere app. Maak een nieuw geheim onder **Certificates & secrets** en sla het op met **Inloggegevens bijwerken**.
  - `unauthorized_client` (`AADSTS700016`): de **Applicatie-ID (client)** staat niet in die **Directory-ID (tenant)**, of **Cloud** is verkeerd.
  - `AADSTS90002`: die tenant bestaat niet.
  - `invalid_scope`: het Graph-bereik bestaat niet in de cloud die je hebt gekozen. Controleer **Cloud**.
- `Microsoft Defender XDR token request returned ...`: Microsoft Entra ID antwoordde met iets onbruikbaars, een body die geen JSON is of geen `access_token` heeft. Dat is meestal een proxy of gateway ertussen, niet de referenties.
- `Microsoft Defender XDR token request did not complete: ...`: het tokeneindpunt was niet bereikbaar, of antwoordde niet op tijd. Controleer uitgaand HTTPS van de OneUptime-app en -workers naar `login.microsoftonline.com`, of `login.microsoftonline.us`.
:::

:::details Last Error begint met `Microsoft Defender XDR alerts request`
- `Microsoft Defender XDR alerts request failed (HTTP ...)`: Graph weigerde de waarschuwingen te tonen. Het bericht noemt de foutcode van Graph, en een hint:
  - `403` (`Authorization_RequestDenied`): `SecurityAlert.Read.All` of de beheerderstoestemming ervoor ontbreekt, of de tenant heeft geen licentie voor Defender XDR. Toestemming heeft een paar minuten nodig om actief te worden.
  - `401` (`InvalidAuthenticationToken`) nadat een token is uitgegeven: **Cloud** past meestal niet bij de tenant.
  - `429` (`TooManyRequests`): Graph beperkt de app, en de volgende poll leest hetzelfde venster opnieuw. Het bericht kan de `Retry-After` van Graph niet citeren, omdat de HTTP-client van OneUptime bij een fout geen antwoordheaders bewaart. Blijft het gebeuren, verhoog dan het **Opvraaginterval (minuten)**.
  - `5xx`: een probleem aan de kant van Graph. De volgende poll probeert het opnieuw.
  - `400`: Graph wilde de query niet uitvoeren, die OneUptime opbouwt en niet je instellingen. Kopieer het bericht voor de support van OneUptime.
- `Microsoft Defender XDR alerts request returned ...`: Graph antwoordde `200`, maar met iets wat de connector niet kon gebruiken: een body die geen JSON is, geen lijst `value`, of een `@odata.nextLink` die geen `https://`-link op de Graph-host van je cloud is. Zo'n link wordt geweigerd, zodat het token nooit ergens anders heen gaat. Dit wordt gemeld in plaats van als een leeg venster te worden opgevat, zodat de cursor nooit voorbij waarschuwingen gaat die niemand heeft gelezen.
- `Microsoft Defender XDR alerts request did not complete: ...`: Graph was niet bereikbaar, of antwoordde niet op tijd: 60 seconden voor een poll, 20 voor een test. Controleer uitgaand HTTPS naar `graph.microsoft.com`, of `graph.microsoft.us`.
:::

:::details De test slaagt, maar Last Polled is Never
De poll-job heeft nog nooit gedraaid. Lees de controles **Background workers** en **Poll scheduler**. Op een zelf gehoste installatie is de gebruikelijke oorzaak `DISABLE_QUEUE_WORKERS=true` op de app, zonder aparte worker-deployment die de jobs afneemt: zet het op `false`, of draai de worker-deployment (Helm: `worker.enabled: true`, dat standaard `false` is).
:::

:::details Polls slagen, maar een waarschuwing die je kent ontbreekt
Vergelijk de `createdDateTime` van de waarschuwing in de Defender-portal met het venster van de run in **Diagnose**: vensters gaan uit van de aanmaaktijd, niet van de activiteitstijd.

- Een waarschuwing die is gemaakt voordat de verbinding bestond, is ouder dan de eerste terugblik van 24 uur. Importeer haar met **Import this time range**.
- Een **Gedeeltelijk** run werd gestopt door de grens van 2.000 waarschuwingen. De volgende poll leest een korter venster vanaf hetzelfde begin, dus de waarschuwing wordt geïmporteerd zodra een venster dat haar bevat volledig is gelezen.
- Als **Laatste fout** een minuut noemt waar het pollen voorbij is gegaan, importeer die minuut dan met **Import this time range**.
:::

:::details Dezelfde waarschuwing verschijnt twee keer
De overlap van 1 minuut is niet de oorzaak: de tweede lezing telt als duplicaat en wordt niet opgeslagen. Er zijn twee gebeurtenissen met dezelfde `eventUid` onder verschillende producten geïmporteerd, zoals dezelfde waarschuwing die ook via een Microsoft Sentinel-verbinding binnenkomt. Duplicaten worden per leverancier en product verwijderd.
:::

## Wat je krijgt

- **Zoeken.** Filter Defender-waarschuwingen op ernst, status, MITRE-techniek, host, gebruiker, IP of elke observable in de verkenner van beveiligingsgebeurtenissen, naast de logs en metrics van die host.
- **Correlatie.** Het bewijs van elke waarschuwing, de apparaten, gebruikers, IP's, bestanden en URL's, wordt geïndexeerd als observables, dus één zoekopdracht vindt alles wat een host noemt, uit elke bron.
- **Detectieregels.** Sigma-regels die volgens een schema over je beveiligingsgebeurtenissen draaien, en waarschuwingen openen die de dienst oproepen.
- **Monitoren.** Monitoren voor beveiligingsgebeurtenissen tellen overeenkomende gebeurtenissen, en openen boven een drempel incidenten of waarschuwingen.

Beveiligingsgebeurtenissen worden gefactureerd zoals de rest van je telemetrie, per opgenomen GB. Zie [Prijzen](https://oneuptime.com/pricing).

## Volgende stappen

:::cards
- [Beveiligingsgebeurtenissen](/docs/telemetry/security-events): Zoeken, correleren en waarschuwen op wat je importeert.
- [Microsoft Sentinel](/docs/integrations/microsoft-sentinel): Importeer ook de incidenten van een Sentinel-werkruimte.
- [Rollen](/docs/permissions/reference#rollen): Wat de Security-rollen kunnen zien en wijzigen.
- [Overzicht van integraties](/docs/integrations/index): De andere tools die je kunt koppelen.
:::
