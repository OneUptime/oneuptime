# CrowdStrike Falcon

Importeer waarschuwingen van [CrowdStrike Falcon](https://www.crowdstrike.com/platform/), uit detecties op endpoints, identiteiten en cloud, in de beveiligingsgebeurtenissen van OneUptime. Daar doorzoek je ze naast je logs, traces en metrics, correleer je ze met elke andere bron en roep je de dienst op voor de waarschuwingen die ertoe doen. OneUptime leest ze via de Falcon Alerts API met een API-client die jij maakt, en schrijft nooit naar Falcon.

:::cards
- [De verbinding instellen](#de-verbinding-instellen): Een API-client met één bereik, en het formulier van de verbinding.
- [Wat er wordt geïmporteerd](#wat-er-wordt-geïmporteerd): Hoe elke Falcon-waarschuwing een beveiligingsgebeurtenis wordt.
- [Hoe pollen werkt](#hoe-pollen-werkt): Het venster dat elke poll leest, en wat een drukke CID daarmee doet.
- [Problemen oplossen](#problemen-oplossen): Wat elke fout betekent en wat je moet wijzigen.
:::

## Hoe het werkt

```mermaid title="Van een Falcon-waarschuwing naar een beveiligingsgebeurtenis"
flowchart TB
    falcon["Falcon geeft een<br/>waarschuwing"] --> poll["OneUptime pollt<br/>volgens het interval<br/>van de verbinding"]
    poll --> token["Het meldt zich aan<br/>met je API-client"]
    token --> list["Het toont de<br/>waarschuwingen die<br/>sinds de vorige keer<br/>zijn gemaakt"]
    list --> event["Elk wordt opgeslagen<br/>als Detection Finding"]
```

Elke minuut pollt OneUptime elke ingeschakelde verbinding waarvan het pollinterval is verstreken. Een poll meldt zich met de ID en het geheim van de API-client aan bij je Falcon-cloud, vraagt de Alerts API om de waarschuwingen die sinds de vorige poll zijn gemaakt, en slaat elk op als een [OCSF](https://schema.ocsf.io/)-gebeurtenis Detection Finding (klasse `2004`). Detectieregels, monitoren en dashboards behandelen die daarna als een beveiligingsgebeurtenis uit elke andere bron.

## Voordat je begint

- In OneUptime de rol Project Owner, Project Admin of Security Admin. Security Member en Security Viewer zien verbindingen en hun runhistorie, maar kunnen ze niet wijzigen.
- Een Falcon-klant-ID (CID), en een gebruiker van de Falcon-console die API-clients mag beheren: de rol Falcon Administrator, of een aangepaste rol met de machtiging API clients and keys.
- Uitgaand HTTPS van de OneUptime-app en -workers naar de API-host van je Falcon-cloud, vermeld onder **Falcon cloud** hieronder.

## De verbinding instellen

:::steps
### Een API-client maken

1. Open in de Falcon-console **Support and resources → API clients and keys** en selecteer **Create API client**.
2. Geef hem een naam, bijvoorbeeld `OneUptime security events`. Zet onder **API scopes** **Alerts → Read** aan en laat elk ander bereik uit: de verbinding schrijft nooit naar Falcon.
3. Maak de client aan. Falcon toont zijn client-ID, zijn geheim en zijn basis-URL één keer. Kopieer alle drie nu: het geheim kan later opnieuw worden ingesteld, maar wordt nooit meer getoond.

### Je Falcon-cloud vinden

De basis-URL die Falcon toonde, vertelt je in welke cloud je CID zit. De pagina **API clients and keys** toont die ook, naast elke client. Een client uit de ene cloud wordt door de andere geweigerd.

| Basis-URL die Falcon toont | Falcon-cloud |
| --- | --- |
| `https://api.crowdstrike.com` | US-1 |
| `https://api.us-2.crowdstrike.com` | US-2 |
| `https://api.eu-1.crowdstrike.com` | EU-1 |
| `https://api.laggar.gcw.crowdstrike.com` | US-GOV-1 |

### De verbinding toevoegen in OneUptime

Open **Producten → Security Events → Verbindingen** (`/dashboard/{projectId}/security-events/connections`), klik op **Verbinding toevoegen**, kies **CrowdStrike Falcon** en klik op **Volgende**. Vul de instellingen uit de tabel hieronder in, klik op **Volgende** en plak het geheim in **Clientgeheim**.

### Testen voordat je opslaat

Klik op **Deze instellingen testen** onder **Testen voor het opslaan**. De test meldt zich aan en leest waarschuwingen met de waarden uit het formulier, en slaat niets op, dus de verkeerde cloud of een ontbrekend bereik komt aan het licht voordat de verbinding bestaat. Klik daarna op **Volgende**, geef de verbinding een **Naam** en maak haar aan.
:::

| Instelling | Wat je invult |
| --- | --- |
| **Client-ID** | De ID van de API-client, zoals Falcon die toonde toen je de client maakte. |
| **Falcon cloud** | De cloud van je CID: **US-1 (api.crowdstrike.com)**, **US-2 (api.us-2.crowdstrike.com)**, **EU-1 (api.eu-1.crowdstrike.com)** of **US-GOV-1 (api.laggar.gcw.crowdstrike.com)**. Elk verzoek gaat naar de API-host van die cloud. |
| **Clientgeheim** | Het geheim van de API-client. Het wordt versleuteld, nooit door de API teruggegeven en nooit meer getoond. Vervang het met **Inloggegevens bijwerken** op de verbinding. |

De stap **Opvragen** heeft ook een optionele **Beschrijving**, het **Opvraaginterval (minuten)**, een geheel getal van `1` tot `1440` dat begint op `5`, en **Ingeschakeld**, dat aan begint. Een verbinding die niet is ingeschakeld, kan nog steeds worden getest en met de hand worden gepold.

## Wat er wordt geïmporteerd

De verbinding leest de waarschuwingen van Falcon: wat de Falcon-console toont onder **Endpoint security → Endpoint detections** en **Next-Gen SIEM → Alerts**, van elk product dat ze geeft. Elke waarschuwing wordt één gebeurtenis Detection Finding (OCSF-klasse `2004`), met leverancier `CrowdStrike` en product `Falcon`:

| Falcon-veld | OneUptime-kolom |
| --- | --- |
| `composite_id` | Gebeurtenis-UID, waarop ook duplicaten worden verwijderd |
| `created_timestamp` | Tijd van de gebeurtenis |
| `display_name`, of `name` | Regelnaam |
| `pattern_id` | Regel-ID |
| `description`, of de regelnaam | Bericht |
| `severity_name`, of `severity` van 0 tot 100 | Ernst |
| `status`, zoals `new`, `in_progress` of `closed` | Status |
| `tactic_id`, `technique_id` | MITRE ATT&CK-tactieken en -technieken |
| `device.hostname`, `device.local_ip`, `user_name`, `filename` of `cmdline` | Host, IP, gebruiker en proces van de actor |
| `device.hostname`, `device.local_ip`, `device.external_ip`, `user_name`, `sha256` | Observables |
| Al het andere, zoals `device.platform_name`, `falcon_host_link`, `product` en `timestamp` | `attributes`, plat gemaakt tot sleutels met punten |

De tijd van de gebeurtenis is met opzet het moment waarop Falcon de waarschuwing maakte: de tijd van het gedrag erachter, `timestamp`, blijft in `attributes.timestamp`.

## Hoe pollen werkt

- **De aanmaaktijd is de cursor.** Waarschuwingen worden getoond op `created_timestamp`, nooit op de tijd van het gedrag erachter. Falcon kan een waarschuwing lang na de activiteit die ze beschrijft geven, en een cursor op activiteitstijd zou elke zo'n waarschuwing overslaan.
- **De eerste poll kijkt 24 uur terug**, zodat een nieuwe verbinding meteen haar recente waarschuwingen toont.
- **Elke volgende poll begint 1 minuut voor de opgeslagen cursor**, zodat een waarschuwing die op de grens van twee vensters is gemaakt nooit wordt gemist.
- **Een poll leest hooguit 24 uur voorbij de cursor.** Een verbinding waarvan de cursor achterliep, haalt de achterstand in met een reeks vensters van 24 uur.
- **Duplicaten worden verwijderd op `composite_id`** binnen het project, zodat de overlap en een herhaald venster een waarschuwing nooit twee keer opslaan.
- **Elk venster kost** één tokenverzoek, dat de hele levensduur van het token meegaat, en daarna één waarschuwingsquery en één ophaalverzoek per 1.000 waarschuwingen, elk met een eigen time-out.

### Wanneer een venster meer bevat dan één poll kan lezen

Een poll stuurt hooguit 20 verzoeken. Met één tokenverzoek en twee verzoeken per 1.000 waarschuwingen leest hij hooguit 9.000 waarschuwingen. Wanneer een venster er meer bevat, is de run **Gedeeltelijk**, met een waarschuwing zoals:

```text
Stopped after 19 requests before reading the whole window. Alerts are read oldest first; every alert created before 2026-09-14T08:12:44.995Z was read.
```

De waarschuwingsquery is gesorteerd op `created_timestamp`, de oudste eerst, dus OneUptime zet de cursor op de aanmaaktijd van de laatst gelezen waarschuwing, en de volgende poll begint daar met dezelfde vensterlengte, vanaf offset `0`. Een drukke CID haalt zo ongeveer 9.000 waarschuwingen per poll in, in plaats van dezelfde opnieuw te lezen. De waarschuwingen die op datzelfde moment zijn gemaakt, worden twee keer gelezen, en de duplicaatcontrole verwijdert de tweede kopie.

De waarschuwingsquery van Falcon kan niet verder pagineren dan 10.000 resultaten (`limit` plus `offset`). De verzoekgrens stopt een run bij 9.000 waarschuwingen, vóór dat plafond. Als het plafond ooit een lezing stopt, gebeurt hetzelfde: de run is **Gedeeltelijk**, de cursor gaat naar de laatst gelezen waarschuwing en de volgende query begint weer bij offset `0`.

Wanneer een run helemaal niet voorbij de opgeslagen cursor komt, bijvoorbeeld omdat meer dan 9.000 waarschuwingen de overlapminuut delen, maakt OneUptime het venster in plaats daarvan korter:

1. **Verkleinen.** De volgende poll leest een venster dat half zo lang is, vanaf hetzelfde beginpunt, en blijft halveren tot een venster volledig wordt gelezen, tot één minuut. De waarschuwing van de run zegt het: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.`
2. **Weer groeien.** Nadat een venster volledig is gelezen, is het volgende weer twee keer zo lang, tot 24 uur.
3. **Voorbij één minuut gaan.** Als zelfs één minuut meer bevat dan een poll kan lezen, gaat het pollen eraan voorbij, zodat nieuwere waarschuwingen blijven binnenkomen. De run blijft **Gedeeltelijk**, en **Laatste fout** luidt `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importeer die minuut met **Import this time range** om terug te halen wat één run kan lezen.

Een run die volledig mislukt, met een fout van Falcon, behoudt de cursor en de vensterlengte, en de volgende poll leest hetzelfde venster opnieuw. De enige uitzondering is een verzoek dat een time-out kreeg: de cursor blijft staan, maar het volgende venster is half zo lang, omdat een venster dat te zwaar is om op tijd te beantwoorden bij elke poging een time-out zou krijgen. Het **Opvraaginterval (minuten)** wijzigen verandert hier niets aan: het bepaalt hoe vaak een poll start, niet waar zijn venster begint.

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
| **Configuratie** | **Client-ID**, **Falcon cloud** en **Clientgeheim** zijn aanwezig en goed gevormd. Er wordt niets benaderd als dit mislukt. |
| **Authenticate with CrowdStrike Falcon** | `POST /oauth2/token` met de ID en het geheim van de API-client, op de host van je cloud, geeft een token terug. |
| **Read alerts from the Falcon Alerts API** | Een waarschuwingsquery voor één waarschuwing (`limit=1`) over de afgelopen 24 uur wordt geaccepteerd, wat het bereik **Alerts → Read** bewijst. |
| **Alerts available to import** | Hoeveel waarschuwingen in de afgelopen 24 uur en de afgelopen 7 dagen zijn gemaakt. Geen in 7 dagen is een waarschuwing, geen fout: pollen importeert nieuwe waarschuwingen zodra Falcon ze maakt. |
| **Background workers**, **Poll scheduler**, **Security event storage** | De kant van OneUptime zelf: een proces neemt de jobs van de Worker-wachtrij af, de poll-job draait elke minuut en de opslag van beveiligingsgebeurtenissen antwoordt. |
| **Scheduled polling** | Voor een opgeslagen verbinding: pollen staat aan, geen run zit vast in afwachting van een worker en polls draaien op tijd. |

Elk verzoek in een test heeft een deadline van 20 seconden. Een test importeert nooit iets en verplaatst nooit de cursor, en elke mislukte controle zegt wat je moet wijzigen. **Rapport kopiëren** kopieert de controlelijst als JSON, zonder referenties of tokens.

## Problemen oplossen

De **Laatste fout** van de verbinding, en elke mislukte controle, bewaren de volledige foutmelding, met referenties gemaskeerd, achter een voorvoegsel dat de mislukte stap noemt. Wanneer een verbinding een fout heeft, selecteer je **Fout bekijken** in haar kolom **Acties** om hem te lezen, en **Fout kopiëren** in het dialoogvenster om hem te kopiëren. Lees eerst het voorvoegsel.

:::details Last Error begint met `CrowdStrike Falcon token request`
- `CrowdStrike Falcon token request failed (HTTP 401)` of `(HTTP 403)`: Falcon weigerde de ID en het geheim van de API-client, voordat de Alerts API werd benaderd. Controleer of **Falcon cloud** de cloud van je CID is, omdat een client uit een andere cloud hier wordt geweigerd, of **Client-ID** die van de client is, en of **Clientgeheim** het geheim is dat ermee is uitgegeven. Is het geheim kwijt, stel het dan opnieuw in in de Falcon-console en sla het op met **Inloggegevens bijwerken**.
- `CrowdStrike Falcon token request returned ...`: Falcon antwoordde met iets onbruikbaars, een body die geen JSON is of geen `access_token` heeft. Dat is meestal een proxy of gateway ertussen, niet de referenties.
:::

:::details Last Error begint met `CrowdStrike Falcon alerts`
- `CrowdStrike Falcon alerts query failed (HTTP 403)`: het token werd geaccepteerd, maar de API-client heeft geen bereik **Alerts → Read**. Zet het voor de client aan onder **API clients and keys** en sla op. Het geldt voor het volgende token, dus test na een minuut opnieuw.
- `CrowdStrike Falcon alerts query failed (HTTP 401)`: de Alerts API weigerde het token, wat bijna altijd betekent dat **Falcon cloud** niet de cloud is die de client heeft uitgegeven.
- `CrowdStrike Falcon alerts query failed (HTTP 429)` of `CrowdStrike Falcon alerts fetch failed (HTTP 429)`: Falcon beperkt de snelheid van deze API-client. De HTTP-client van OneUptime bewaart bij een fout geen antwoordheaders, dus het bericht eindigt meestal met `the X-RateLimit-RetryAfter header was not available` in plaats van hem te citeren. Geplande polls proberen het vanzelf opnieuw. Blijft het gebeuren, geef OneUptime dan een eigen API-client, in plaats van een die met andere tools wordt gedeeld.
- `CrowdStrike Falcon alerts query failed (HTTP 400)`: Falcon weigerde de query. De verbinding stuurt een vast FQL-filter op `created_timestamp`, dus kopieer het rapport en stuur het naar de support van OneUptime.
- `CrowdStrike Falcon alerts query returned ...` of `CrowdStrike Falcon alerts fetch returned ...`: Falcon antwoordde `200`, met een body die geen JSON is, of niet in een vorm die de verbinding kent. Dit wordt gemeld in plaats van als een leeg venster te worden opgevat, zodat de cursor nooit voorbij waarschuwingen gaat die niemand heeft gelezen.
- `CrowdStrike Falcon alerts fetch failed (HTTP ...)`: de waarschuwingen werden getoond, maar het ophalen ervan mislukte, om dezelfde redenen als bij de query. Een `403` hier betekent dat het bereik tussen de twee aanroepen is verwijderd.
:::

:::details Last Error zegt dat het verzoek niet kon worden voltooid
`CrowdStrike Falcon token request could not be completed`, `CrowdStrike Falcon alerts query could not be completed` en `CrowdStrike Falcon alerts fetch could not be completed` betekenen dat er niets terugkwam: een time-out, een DNS-fout of geblokkeerd uitgaand verkeer. Controleer uitgaand HTTPS van de OneUptime-app en -workers naar de API-host van je cloud, zoals `api.crowdstrike.com`.
:::

:::details Last Error noemt een onbekende cloud
`CrowdStrike Falcon cloud "..." is not one of us-1, us-2, eu-1, us-gov-1` betekent dat de opgeslagen cloud er niet een is die de verbinding kent. Bewerk de verbinding en kies een cloud uit de lijst.
:::

:::details Een run is Partial
- `Stopped after 19 requests before reading the whole window`: het venster bevatte meer dan de 9.000 waarschuwingen die één run leest. Er gaat niets verloren: de volgende poll begint na de laatst gelezen waarschuwing. Een verbinding die poll na poll **Gedeeltelijk** blijft, haalt een achterstand in, en haar **Laatst opgevraagd** en **Laatst geïmporteerde gebeurtenis** blijven doorschuiven. Het aantal kan iets boven 19 liggen als het token tijdens de run werd vernieuwd.
- `Falcon returned alerts out of created_timestamp order, so this run cannot name a point to resume from.`: de query negeerde de volgorde van oud naar nieuw, dus de run kan de cursor niet op zijn laatste waarschuwing zetten, en de volgende poll leest in plaats daarvan een korter venster. Gebeurt het steeds weer, stuur dan het rapport van de run naar de support van OneUptime.
- `More records were created in the one minute from ... than one poll can read`: het pollen ging voorbij die minuut. Importeer haar met **Import this time range** in **Diagnose**. Een import leest net zoveel als een poll.
:::

:::details Last Polled is Never en Last Error is leeg
Er is geen poll gedraaid, dus er heeft niets Falcon bereikt. **Verbinding testen** toont het als een mislukte controle **Background workers** of **Poll scheduler**. Op een zelf gehoste installatie is de gebruikelijke oorzaak `DISABLE_QUEUE_WORKERS=true` op de app, zonder aparte worker-deployment die de jobs afneemt: zet het op `false`, of draai de worker-deployment (Helm: `worker.enabled: true`).
:::

:::details De test slaagt, maar er verschijnen geen gebeurtenissen
Lees **Alerts available to import**: een waarschuwing daar betekent dat Falcon in de afgelopen 7 dagen geen waarschuwingen heeft gemaakt, dus er valt nog niets te importeren. Open anders **Diagnose**, controleer het venster en de aantallen van de laatste poll, en gebruik **View events in this time range** bij een run om het tijdsbereik te openen van de waarschuwingen die hij importeerde.
:::

## Wat je krijgt

- **Zoeken.** Filter Falcon-waarschuwingen op ernst, status, MITRE-tactiek, host, gebruiker of elke observable in de verkenner van beveiligingsgebeurtenissen, naast de logs en metrics van die host.
- **Correlatie.** De hostnamen, IP's, gebruikers en bestandshashes van elke waarschuwing worden geïndexeerd als observables, dus één zoekopdracht vindt alles wat een host noemt, uit elke bron.
- **Detectieregels.** Sigma-regels die volgens een schema over je beveiligingsgebeurtenissen draaien, en waarschuwingen openen die de dienst oproepen.
- **Monitoren.** Monitoren voor beveiligingsgebeurtenissen tellen overeenkomende gebeurtenissen, en openen boven een drempel incidenten of waarschuwingen.

Beveiligingsgebeurtenissen worden gefactureerd zoals de rest van je telemetrie, per opgenomen GB. Zie [Prijzen](https://oneuptime.com/pricing).

## Volgende stappen

:::cards
- [Beveiligingsgebeurtenissen](/docs/telemetry/security-events): Zoeken, correleren en waarschuwen op wat je importeert.
- [Microsoft Defender XDR](/docs/integrations/microsoft-defender-xdr): Importeer ook de waarschuwingen van de Defender-workloads van Microsoft.
- [Rollen](/docs/permissions/reference#rollen): Wat de Security-rollen kunnen zien en wijzigen.
- [Overzicht van integraties](/docs/integrations/index): De andere tools die je kunt koppelen.
:::
