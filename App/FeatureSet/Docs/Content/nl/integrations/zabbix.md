# Zabbix-integratie

[Zabbix](https://www.zabbix.com) bewaakt je servers en netwerk; OneUptime verzorgt je incidentrespons, oncall en statuspagina's. Verbind de twee en elk Zabbix-probleem wordt automatisch een OneUptime-incident — zodat de juiste mensen worden gepaged en je statuspagina actueel blijft.

Deze integratie is **inbound**: Zabbix stuurt problemen naar OneUptime. Ze maakt gebruik van een Zabbix **webhook media type** aan de ene kant en een OneUptime **[Workflow](/docs/workflows/index)** aan de andere kant. Geen plugins, geen extra services.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## Hoe het werkt

1. Een Zabbix-trigger gaat naar **PROBLEM**.
2. Een Zabbix **action** vertelt het **OneUptime** media type om het event te sturen.
3. Het script van het media type POST een kleine JSON-payload naar een OneUptime-workflow-URL.
4. De workflow leest de payload en maakt een incident aan (en lost het optioneel op wanneer Zabbix herstelt).

## Vereisten

- Een Zabbix-server die jij beheert (deze handleiding is geschreven voor **Zabbix 6.0 LTS / 7.0 LTS**; het webhook media type werkt hetzelfde op 5.0+).
- Je Zabbix-server moet je OneUptime-instantie via HTTPS kunnen bereiken.
- Een OneUptime-project waar je workflows kunt aanmaken.

## Deel 1 — Bouw de OneUptime-workflow

Doe dit eerst, want je hebt de webhook-URL nodig die het genereert.

1. Open **Workflows → Create Workflow**. Geef het de naam `Zabbix → Incidents` en open het tabblad **Builder**.
2. Sleep een **Webhook**-trigger op het canvas. Klik erop en **kopieer de unieke URL** die verschijnt. Bewaar deze goed — iedereen die hem heeft kan de workflow starten. Hernoem het blok naar `Zabbix` zodat variabelen er netjes uitzien.
3. Sleep een **Conditions**-blok op het canvas en verbind de uitvoer van de trigger ermee. Configureer:
   - **Left value**: `{{Zabbix.Request Body.status}}`
   - **Operator**: `==`
   - **Right value**: `1`  *(Zabbix stuurt `1` voor een probleem, `0` voor herstel)*
4. Sleep een **Create Incident**-blok en verbind het met de **Yes**-uitvoer van het Conditions-blok. Vul in:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: kies de gewenste OneUptime-incidentseverity (je kunt dit later verfijnen met meer Conditions-takken die Zabbix-severities mappen).
5. Sla op. Laat **Enabled** voorlopig *uit* — je zet het aan na een test.

> **Tip:** Door de Zabbix `event_id` in de beschrijving (of een incidentlabel) te zetten, kun je dit incident later terugvinden als je het automatisch wilt oplossen bij herstel. Zie [Automatisch oplossen](#automatisch-oplossen-optioneel).

## Deel 2 — Configureer Zabbix

### Stap 1: Maak het OneUptime-media-type aan

1. Ga in Zabbix naar **Alerts → Media types** (op oudere versies: **Administration → Media types**).
2. Klik op **Create media type** en stel **Type** in op **Webhook**.
3. **Name**: `OneUptime`.
4. Voeg deze **Parameters** toe (klik op *Add* voor elk). Ze mappen Zabbix-[macro's](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) naar een overzichtelijke payload:

   | Name | Value |
   | --- | --- |
   | `url` | `{ALERT.SENDTO}` |
   | `event_id` | `{EVENT.ID}` |
   | `event_name` | `{EVENT.NAME}` |
   | `event_value` | `{EVENT.VALUE}` |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host` | `{HOST.NAME}` |
   | `event_date` | `{EVENT.DATE}` |
   | `event_time` | `{EVENT.TIME}` |

5. Plak dit in het veld **Script**:

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader('Content-Type: application/json');

   var payload = {
     source: 'zabbix',
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw 'OneUptime responded with HTTP ' + request.getStatus() + ': ' + response;
   }

   return 'OK';
   ```

6. Klik op het tabblad **Message templates** en voeg een sjabloon toe voor **Problem** en **Problem recovery** (de body mag leeg zijn — de payload wordt in het script samengesteld). Dit is vereist zodat Zabbix het media type voor die eventtypes gebruikt.
7. Klik op **Add** om het media type op te slaan.

### Stap 2: Maak een gebruiker aan om de webhook te dragen

Zabbix stuurt notificaties *naar een gebruiker*. Maak een aparte aan zodat de integratie makkelijk te vinden en uit te schakelen is.

1. Ga naar **Users → Users → Create user**. Geef hem de naam `OneUptime Webhook`, geef hem een rol die notificaties kan ontvangen (bijv. **User role**), en voeg hem toe aan een gebruikersgroep.
2. Klik op het tabblad **Media** op **Add**:
   - **Type**: `OneUptime`
   - **Send to**: plak de **workflow-webhook-URL** die je in Deel 1 hebt gekopieerd.
   - **When active** / severities: laat de standaardwaarden staan (of beperk tot de severities die je wilt).
3. Klik op **Add** en **Update**.

### Stap 3: Stuur problemen naar OneUptime met een action

1. Ga naar **Alerts → Actions → Trigger actions → Create action**.
2. **Name**: `Notify OneUptime`.
3. **Conditions** (optioneel): beperk de scope — bijvoorbeeld *Trigger severity >= Warning*. Laat leeg om alles te sturen.
4. Voeg op het tabblad **Operations** een operatie toe die naar **User: OneUptime Webhook** stuurt via het **OneUptime** media type.
5. Om incidenten later bij herstel op te lossen, vul je ook de **Recovery operations** in met dezelfde gebruiker/media.
6. Klik op **Add** om op te slaan en zorg dat de action **Enabled** is.

## Deel 3 — Test het

1. Zet in de OneUptime-workflow **Enabled** aan.
2. Trigger in Zabbix een testprobleem — verlaag bijvoorbeeld tijdelijk een triggerdrempel, of gebruik een testitem dat naar een probleemstatus omslaat.
3. Open het tabblad **Logs** van je workflow. Je ziet een run met de Zabbix-payload, het Conditions-blok dat het **Yes**-pad neemt, en het incident dat wordt aangemaakt.
4. Controleer **Incidents** in OneUptime — je Zabbix-probleem is nu een incident.

Als er niets binnenkomt, zie [Probleemoplossing](#probleemoplossing).

## Automatisch oplossen (optioneel)

De bovenstaande basisworkflow *opent* incidenten. Om ze ook te *sluiten* wanneer Zabbix herstelt:

1. Zorg dat je Zabbix-action **Recovery operations** heeft geconfigureerd (Stap 3 hierboven) zodat herstelgebeurtenissen ook worden verstuurd. Bij herstel komt `status` binnen als `0`.
2. Voeg in de workflow een tweede **Conditions**-tak toe: links `{{Zabbix.Request Body.status}}`, operator `==`, rechts `0`.
3. Voeg vanuit de **Yes**-uitvoer een **Find Incident**-blok toe dat het eerder aangemaakte open incident opzoekt — match op de Zabbix `event_id` die je in de beschrijving of een label hebt opgeslagen.
4. Verbind dat met een **Update Incident**-blok en zet het incident op je *opgeloste* status.

Omdat oplossing afhangt van hoe je incidentstatussen in je project modelleert, houd je het **aanmaken**-pad als betrouwbare kern en voeg je het oplossen-pad toe zodra je hebt bevestigd dat events correct doorstromen. Zie [Componenten → OneUptime-datacomponenten](/docs/workflows/components#oneuptime-data-components).

## Zabbix-severities mappen (optioneel)

Zabbix-severities (`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`) komen binnen als `{{Zabbix.Request Body.severity}}`. Om ze te mappen naar OneUptime-incidentseverities voeg je **Conditions**-takken toe vóór **Create Incident** — routeer bijvoorbeeld `Disaster` en `High` naar een "Kritiek"-incident en al het andere naar "Groot". Bouw één **Create Incident**-blok per tak.

## Probleemoplossing

**De workflow draait nooit.**
- Bevestig dat de schakelaar **Enabled** van de workflow aanstaat.
- Bevestig vanaf de Zabbix-server dat hij de URL kan bereiken: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. Je zou een snelle bevestiging moeten krijgen.
- Controleer **Reports → Action log** in Zabbix op afleverfouten.

**Zabbix meldt een scriptfout.**
- Open het media type en gebruik **Test** om een voorbeeldpayload te sturen. Zabbix toont de uitvoer van het script of de gegooid fout.
- Een niet-2xx-respons van OneUptime wordt zichtbaar gemaakt door de `throw` in het script — controleer of de workflow-URL precies klopt.

**Het incident is aangemaakt maar velden zijn leeg.**
- Open het tabblad **Logs** van de workflow en bekijk de triggeruitvoer. Bevestig dat de veldnamen onder **Request Body** overeenkomen met wat je verwijst (`name`, `host`, `severity`, `status`, `event_id`).
- Een ontbrekend veld levert een lege string op in plaats van een fout — zie [Variabelen → Valkuilen](/docs/workflows/variables#gotchas).

**Alles vuurt twee keer.**
- Je hebt waarschijnlijk zowel een probleemoperatie als een escalatiestap die naar hetzelfde media stuurt. Controleer de **Operations**-stappen van de action.

## Beveiligingsnotities

- Behandel de workflow-webhook-URL als een wachtwoord. Als hij uitlekt, verwijder dan de trigger en maak een nieuwe aan om de URL te roteren.
- Beperk de condities van de Zabbix-action zodat je alleen de severities doorstuurt die een incident rechtvaardigen.
- Als je OneUptime self-hosted achter een firewall draait, sta dan het egress-IP van je Zabbix-server toe om hem via HTTPS te bereiken.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — de inbound/outbound-patronen.
- [Webhook trigger](/docs/workflows/triggers#webhook) — hoe de ontvangende URL werkt.
- [Componenten](/docs/workflows/components) — Conditions, Create Incident en meer.
- [Variabelen](/docs/workflows/variables) — de Zabbix-payload lezen in latere blokken.
