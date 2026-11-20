# Cloudflare

Importeer in de beveiligingsgebeurtenissen van OneUptime wat de firewall van [Cloudflare](https://www.cloudflare.com) aan de edge deed: de aanvragen die de beheerde en eigen WAF-regels, de rate limiting, de IP Access Rules, het botbeheer en de HTTP-DDoS-bescherming hebben geblokkeerd, uitgedaagd of vastgelegd. Elke aanvraag staat naast de eigen aanvragen van je app, zodat een zaak zegt wat Cloudflare tegenhield en wat je app toch bereikte. OneUptime leest ze met een API-token dat alleen kan lezen, en verandert niets in Cloudflare.

:::cards
- [De verbinding instellen](#de-verbinding-instellen): Een API-token met twee leesrechten, en het formulier van de verbinding.
- [Wat er wordt geïmporteerd](#wat-er-wordt-geïmporteerd): Welke gebeurtenissen, en hoe elke gebeurtenis een beveiligingsgebeurtenis wordt.
- [Hoe pollen werkt](#hoe-pollen-werkt): Het venster dat elke opvraging leest, en waarom het 10 minuten overlapt.
- [Problemen oplossen](#problemen-oplossen): Wat elke fout betekent en wat je moet wijzigen.
:::

## Hoe het werkt

```mermaid title="Van een aanvraag waar Cloudflare op reageerde tot een beveiligingsgebeurtenis"
flowchart TB
    edge["De firewall van<br/>Cloudflare reageert<br/>op een aanvraag"] --> poll["OneUptime vraagt op<br/>in het interval van<br/>de verbinding"]
    poll --> zones["Het leest de<br/>firewallgebeurtenissen<br/>van elke zone sinds<br/>de vorige keer"]
    zones --> event["Elke wordt<br/>opgeslagen als<br/>HTTP Activity-<br/>gebeurtenis"]
```

Elke minuut vraagt OneUptime elke ingeschakelde verbinding op waarvan het opvraaginterval verstreken is. Een opvraging somt de zones van het account op, leest uit de settings-node van de GraphQL Analytics API wat het abonnement van elke zone toestaat, en leest de firewallgebeurtenissen van elke zone sinds de vorige opvraging uit de dataset `firewallEventsAdaptive` ([Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)), de oudste eerst. Elke gebeurtenis wordt opgeslagen als [OCSF](https://schema.ocsf.io/)-gebeurtenis HTTP Activity.

## Voordat je begint

- In OneUptime de rol Projecteigenaar, Projectbeheerder of Beveiligingsbeheerder. Beveiligingslid en Beveiligingskijker zien verbindingen en hun runhistorie, maar kunnen ze niet wijzigen.
- Een Cloudflare-gebruiker die API-tokens kan maken voor de zones van het account.
- Zones waarvan het verkeer via Cloudflare loopt: hun DNS-records worden geproxied.
- Uitgaand HTTPS van de OneUptime-app en de workers naar `api.cloudflare.com`.

## De verbinding instellen

De verbinding leest met een [API-token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), nooit met een Global API Key: een token is beperkt tot het account en zijn zones, en je kunt het afzonderlijk intrekken. Het heeft twee [rechten](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) nodig, allebei alleen-lezen:

| Recht | Wat OneUptime ermee leest |
| --- | --- |
| `Zone > Zone > Read` | De zones, met hun accounts en abonnementen. |
| `Zone > Analytics > Read` | De firewallgebeurtenissen van elke zone, via de GraphQL Analytics API. |

:::steps
### Een API-token maken

1. Open in het Cloudflare-dashboard **My Profile → API Tokens**, selecteer **Create Token** en kies **Create Custom Token**.
2. Noem het `oneuptime-security-events`. Voeg onder **Permissions** `Zone > Zone > Read` en `Zone > Analytics > Read` toe.
3. Neem onder **Zone Resources** alle zones van het account op, of de zones die je wilt importeren.
4. Selecteer **Continue to summary**, dan **Create Token**, en kopieer het token. Cloudflare toont het maar één keer.

### De verbinding toevoegen in OneUptime

Open **Producten → Beveiligingsgebeurtenissen → Verbindingen** (`/dashboard/{projectId}/security-events/connections`), klik op **Verbinding toevoegen**, kies **Cloudflare** onder **Cloudbeveiliging** en klik op **Volgende**. Plak het token in **API-token**. OneUptime somt dan de accounts en zones op die het token kan lezen: kies het **Account**, en laat bij **Zones** **Alle zones** staan, of kies de zones die je wilt importeren.

### Testen voordat je opslaat

Klik op **Deze instellingen testen** onder **Testen voor het opslaan**. De test controleert elk recht met de waarden in het formulier, noemt elk recht dat ontbreekt en slaat niets op. Klik daarna op **Volgende**, geef de verbinding een **Naam** en maak hem aan.
:::

| Instelling | Wat je invult |
| --- | --- |
| **Account** | Het Cloudflare-account dat gelezen wordt, gekozen uit de accounts die je API-token leest. Een token dat één account leest, kiest het voor je. |
| **Zones** | Optioneel. Leeg leest elke actieve zone van het account, ook zones die later worden toegevoegd. Eén verbinding leest hooguit 50 zones. |
| **API-token** | Alleen het token, zonder `Bearer`. Het wordt versleuteld, nooit door de API teruggegeven en nooit meer getoond. Vervang het met **Inloggegevens bijwerken** bij de verbinding. |

De stap **Opvragen** heeft ook een optionele **Beschrijving**, het **Opvraaginterval (minuten)**, een geheel getal van `1` tot `1440` dat begint bij `5`, en **Ingeschakeld**, dat aan begint. De gebeurtenissen van Cloudflare zijn aanvragen, geen meldingen, dus vraagt het formulier niet naar **Zaken openen vanaf**: zaken komen van de detectieregels die ze lezen.

### Schrijftoegang is een aparte keuze

Deze verbinding verandert nooit iets in Cloudflare. Daar adressen blokkeren is een aparte toestemming, die schrijfrechten nodig heeft: `Account > Account Filter Lists > Edit` voor de lijsten, `Zone > Zone WAF > Edit` op elke zone waarin geblokkeerd wordt, en `Account > Account Firewall Access Rules > Edit` bij abonnementen zonder genoeg lijsten. Voeg ze pas aan het token toe als je blokkeren inschakelt.

## Wat er wordt geïmporteerd

Elke gebeurtenis heeft de leverancier `Cloudflare` en het product `Cloudflare WAF`, en is een gebeurtenis HTTP Activity (`4002`).

| Veld van Cloudflare | In de beveiligingsgebeurtenis |
| --- | --- |
| `clientIP` | Het principal-IP, en `client.address` |
| `clientRequestHTTPHost`, `clientRequestPath`, `clientRequestQuery` | De doelhost, de doelresource (het pad en de query), en `url.original` |
| `clientRequestHTTPMethodName`, `userAgent` | De activiteit, `http.request.method` en `user_agent.original` |
| `action` | De status, en `oneuptime.edge.action` |
| `source`, `ruleId`, `description` | De regel-ID, de regelnaam, en `cloudflare.source` |
| `rayName`, `clientCountryName`, `clientAsn` | `cloudflare.ray_id`, `cloudflare.client.country` en `cloudflare.client.asn` |
| `sampleInterval` | `oneuptime.edge.sample_interval` |

| Wat Cloudflare deed | Status | `oneuptime.edge.action` | Uitkomst van de aanvraag | Ernst |
| --- | --- | --- | --- | --- |
| Geblokkeerd, de verbinding gesloten, of een uitdaging mislukt | Blocked, of Dropped bij een gesloten verbinding | `blocked` | Rejected | Low |
| Beantwoord met een beheerde, JS- of interactieve uitdaging | Challenge | `challenged` | Rejected | Low |
| Een doorstane uitdaging, of een bezoeker die er al een had doorstaan | Allowed | `passed-challenge` | Geen | Informational |
| Vastgelegd en doorgelaten | Logged | `logged` | De statuscode van de oorsprong | Medium; High als de oorsprong faalde; Low als die de aanvraag afwees |
| Doorgelaten door een eigen skip- of allow-regel | Allowed | `let-through` | De statuscode van de oorsprong | Zoals bij een vastgelegde aanvraag |

Een aanvraag die een van je eigen skip- of allow-regels doorliet, wordt alleen geïmporteerd als ze een aanval bevat (SQL-injectie, path traversal of een Log4Shell-lookup), of als de WAF attack score van Cloudflare haar zo inschat. De rest is verkeer dat je bewust toestaat, zoals je monitors: elke run telt het en laat het weg.

Cloudflare neemt steekproeven uit de gebeurtenissen van een drukke zone. Elke gebeurtenis houdt haar steekproefinterval, het aantal soortgelijke aanvragen waarvoor ze staat, en elk aantal dat OneUptime daaruit maakt zegt *ongeveer*.

De gebeurtenissen verschijnen in Gebeurtenissen, in Campagnes (aanvalsaanvragen per adres), in het entiteitsrisico en in detectieregels. Een zaak over een adres toont onder **Aan de edge** in haar impact wat Cloudflare met de aanvragen van het adres deed, naast wat je app bereikte. De Cloudflare-regels van de regelbibliotheek lezen ze zoals ze hier worden geïmporteerd: veel treffers van beheerde regels vanaf één adres, een adres dat een uitdaging doorstond en daarna aanvallen stuurde, en een aanval die Cloudflare doorliet en die je app bereikte.

## Grenzen per abonnement

Elk abonnement heeft firewallgebeurtenissen via de API. **What each zone's plan gives**, in **Verbinding testen**, leest de eigen grenzen van elke zone bij Cloudflare.

| Abonnement | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Bewaarde firewallgebeurtenissen | 31 dagen | 31 dagen | 31 dagen | 31 dagen |
| Langste query | 30 dagen | 30 dagen | 30 dagen | 31 dagen |

Logpush van Cloudflare kan ook firewallgebeurtenissen versturen, op elk abonnement sinds 30 september 2026, met prijzen naar gebruik. Deze verbinding vraagt in plaats daarvan op, dus heeft ze niets nodig naast de twee leesrechten.

## Hoe pollen werkt

- **Gebeurtenissen worden gelezen op het moment dat ze aan de edge gebeurden.** De analysegegevens van Cloudflare zijn een minuut of twee na de aanvraag op te vragen.
- **De eerste poll kijkt 24 uur terug**, zodat een nieuwe verbinding meteen haar recente gebeurtenissen toont.
- **Elke latere opvraging begint 10 minuten vóór de opgeslagen cursor**, zodat een gebeurtenis die Cloudflare laat leesbaar maakt bij de volgende opvraging wordt gelezen, en duplicaten binnen het project worden weggelaten op de Ray ID van elke gebeurtenis.
- **Een poll leest hooguit 24 uur voorbij de cursor.** Een verbinding waarvan de cursor achterliep, haalt de achterstand in met een reeks vensters van 24 uur.
- **De zones worden om de beurt gelezen**, een pagina van hooguit 2.000 gebeurtenissen elk, zodat een drukke zone een opvraging niet kan opmaken voordat een rustige gelezen is.
- **De rate limits van Cloudflare worden gerespecteerd.** Cloudflare staat 1.200 REST-aanvragen en 300 GraphQL-query's in vijf minuten toe. Een `429` die vraagt om 30 seconden of minder te wachten, wordt afgewacht en opnieuw gevraagd; een langere stopt de opvraging, en de volgende gaat verder.
- **Een zone die het token niet kan lezen, houdt niets op.** De andere zones worden geïmporteerd, de run is **Gedeeltelijk**, en de waarschuwing noemt de zone. Geef het token daar `Zone > Analytics > Read` en gebruik daarna **Dit tijdsbereik importeren** om het venster terug te halen.
- **Een mislukte run verandert niets.** Na een netwerkfout, of een foutstatus van Cloudflare, blijven de cursor en de lengte van het venster zoals ze waren, en leest de volgende opvraging hetzelfde venster opnieuw. De enige uitzondering is een aanvraag die een time-out kreeg: de cursor blijft, maar het volgende venster is half zo lang, want een venster dat te zwaar is om op tijd te antwoorden zou bij elke poging een time-out krijgen.

### Wanneer een venster meer bevat dan één poll kan lezen

Een opvraging verstuurt hooguit 120 aanvragen, leest hooguit 20.000 gebeurtenissen en stopt na 4 minuten. Gebeurtenissen worden de oudste eerst gelezen, dus als een budget een opvraging stopt, is de run **Gedeeltelijk** en gaat de volgende opvraging verder vanaf de oudste gebeurtenis tot waar de onafgemaakte zones gelezen zijn. Als niet elke zone één keer gelezen kon worden, maakt OneUptime in plaats daarvan het venster korter:

1. **Verkleinen.** De volgende opvraging leest een half zo lang venster, vanaf hetzelfde beginpunt, en halveert opnieuw tot een venster volledig gelezen wordt, tot één minuut. De waarschuwing van de run zegt het: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Gebeurtenissen die al uit het langere venster zijn geïmporteerd, worden als duplicaten overgeslagen.
2. **Weer groeien.** Nadat een venster volledig is gelezen, gaat de cursor naar het einde ervan, en is het volgende venster weer twee keer zo lang, tot 24 uur.
3. **Voorbij één minuut gaan.** Als zelfs één minuut meer bevat dan een opvraging kan lezen, gaat het opvragen er voorbij, zodat nieuwere gebeurtenissen blijven binnenkomen. De run blijft **Gedeeltelijk**, en **Laatste fout** luidt `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importeer die minuut met **Dit tijdsbereik importeren** om terug te halen wat één run kan lezen.

Het **Opvraaginterval (minuten)** wijzigen verandert hier niets aan: het bepaalt hoe vaak een poll begint, niet waar zijn venster begint.

### Uitvoeren, bekijken en importeren op verzoek

Klik op **Diagnose** bij een verbinding om haar recente runs te zien en er met de hand mee te werken. Iedereen die de verbinding kan wijzigen, kan deze acties starten; iedereen die haar kan zien, kan de historie lezen.

- **Nu uitvoeren** start meteen een poll, met de gewone cursor, ook als de verbinding niet **Ingeschakeld** is.
- **Voorbeeld van firewallgebeurtenissen** leest een tijdsbereik van hooguit 7 dagen en importeert niets.
- **Dit tijdsbereik importeren** importeert na je bevestiging een bereik van hooguit 7 dagen, zonder de cursor te verplaatsen. Al geïmporteerde gebeurtenissen worden overgeslagen. Cloudflare bewaart firewallgebeurtenissen 31 dagen.
- **Diagnose kopiëren** bij een run kopieert het rapport ervan voor support. Het bevat nooit referenties.

## Verbinding testen

**Verbinding testen** op de rij van een verbinding, en **Deze instellingen testen** in het formulier, draaien in het API-proces, niet in een achtergrondworker, zodat een test ook antwoordt wanneer de workers het probleem zijn. Hij voert deze controles uit, in volgorde:

| Controle | Wat ze controleert |
| --- | --- |
| **Configuratie** | Het token, het account en de zones zijn goed gevormd. Als dit mislukt, wordt niets benaderd. |
| **Verify the API token** | Cloudflare accepteert het token, van een gebruiker of van het account zelf, en het is actief. Een token dat binnen 14 dagen verloopt, is een waarschuwing. |
| **List the zones** | Het token heeft `Zone > Zone > Read`: het somt de zones van het account op, en elke gekozen zone. |
| **Read firewall events** | Het token heeft `Zone > Analytics > Read` op elke zone. Een fout noemt de zones waar het ontbreekt. |
| **What each zone's plan gives** | Hoe lang het abonnement van elke zone firewallgebeurtenissen bewaart, en hoe lang één query mag zijn. Een zone waarvan het abonnement er geen heeft, is een waarschuwing. |
| **Firewall events available to import** | Ongeveer hoeveel gebeurtenissen de laatste 24 uur en de laatste 7 dagen bevatten. Geen is een waarschuwing. |
| **Background workers**, **Poll scheduler**, **Security event storage** | De kant van OneUptime zelf: een proces neemt de jobs van de Worker-wachtrij af, de poll-job draait elke minuut en de opslag van beveiligingsgebeurtenissen antwoordt. |
| **Geplande opvraging** | Voor een opgeslagen verbinding: pollen staat aan, geen run zit vast in afwachting van een worker en polls draaien op tijd. |

Elk verzoek in een test heeft een deadline van 20 seconden. Een test importeert nooit iets en verplaatst nooit de cursor, en elke mislukte controle zegt wat je moet wijzigen.

## Problemen oplossen

De **Laatste fout** van de verbinding bewaart de volledige foutmelding, met afgeschermde inloggegevens. Als een verbinding een fout heeft, selecteer je **Fout bekijken** in haar kolom **Acties** om hem te lezen, en **Fout kopiëren** in het dialoogvenster om hem te kopiëren. Elke melding noemt de aanvraag die mislukte, en citeert de eigen reden van Cloudflare.

:::details De laatste fout luidt `Invalid API Token (1000)`
Cloudflare kent het token niet: het is verwijderd, vernieuwd of nooit volledig geplakt. Een Global API Key wordt geweigerd voordat hij wordt verstuurd. Maak een token zoals hierboven en sla het op met **Inloggegevens bijwerken**.
:::

:::details De laatste fout luidt `Unauthorized to access requested resource (9109)`
Het token kan geen zones opsommen. Geef het `Zone > Zone > Read`, met de zones die je wilt importeren onder **Zone Resources**.
:::

:::details De laatste fout luidt `cannot read the analytics of`
Het token mist `Zone > Analytics > Read` op de zones die de melding noemt. Voeg het daar toe en gebruik daarna **Dit tijdsbereik importeren** om terug te halen wat niet is geïmporteerd.
:::

:::details De laatste fout luidt `rate limit`
Iets anders dat dezelfde Cloudflare-gebruiker gebruikt, heeft zijn quotum opgemaakt. Het opvragen gaat vanzelf verder zodra de vijf minuten voorbij zijn; geef OneUptime een token van een eigen gebruiker om het quotum gescheiden te houden.
:::

:::details Laatste fout zegt `did not complete`
De aanvraag kreeg geen antwoord: een time-out, een naam die niet wordt omgezet, of een geweigerd adres. Controleer of de OneUptime-app en de workers `api.cloudflare.com` kunnen bereiken, via elke proxy die je gebruikt.
:::

:::details Een zaak toont de acties van Cloudflare, maar geen enkele aanvraag van het adres in je app
Achter Cloudflare ziet je app de adressen van Cloudflare, tenzij hij dat van de bezoeker uit de header `CF-Connecting-IP` leest. Schrijf dat adres als `client.address` in je logs en traces, zodat OneUptime de aanvragen van je app kan koppelen aan het adres waar Cloudflare op reageerde.
:::

:::details De test slaagt, maar Last Polled is Never
De poll-job heeft nog nooit gedraaid. Lees de controles **Background workers** en **Poll scheduler**. Op een zelf gehoste installatie is de gebruikelijke oorzaak `DISABLE_QUEUE_WORKERS=true` op de app, zonder aparte worker-deployment die de jobs afneemt: zet het op `false`, of draai de worker-deployment (Helm: `worker.enabled: true`, dat standaard `false` is).
:::

## Volgende stappen

:::cards
- [Beveiligingsgebeurtenissen](/docs/telemetry/security-events): Zoeken, correleren en waarschuwen op wat je importeert.
- [Beveiligingszaken](/docs/telemetry/security-cases): Zie wat Cloudflare deed, naast wat je app bereikte.
- [Overzicht van integraties](/docs/integrations/index): De andere tools die je kunt koppelen.
:::
