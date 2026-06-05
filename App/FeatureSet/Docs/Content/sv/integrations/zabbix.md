# Zabbix-integration

[Zabbix](https://www.zabbix.com) övervakar dina servrar och nätverk; OneUptime hanterar din incidenthantering, jour och statussidor. Anslut de två och varje Zabbix-problem blir automatiskt en OneUptime-incident — så att rätt personer larmas och din statussida förblir korrekt.

Den här integrationen är **inkommande**: Zabbix skickar problem till OneUptime. Den använder en Zabbix **webhook-mediatyp** på ena sidan och ett OneUptime **[Arbetsflöde](/docs/workflows/index)** på den andra. Inga plugins, inga extra tjänster.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## Hur det fungerar

1. En Zabbix-utlösare ändras till **PROBLEM**.
2. En Zabbix **action** uppmanar **OneUptime**-mediatypen att skicka händelsen.
3. Mediatypens skript POSTar en liten JSON-payload till en OneUptime-arbetsflödes-URL.
4. Arbetsflödet läser payload:en och skapar en incident (och löser den, valfritt, när Zabbix återhämtar sig).

## Förutsättningar

- En Zabbix-server du administrerar (den här guiden är skriven för **Zabbix 6.0 LTS / 7.0 LTS**; webhook-mediatypen fungerar likadant på 5.0+).
- Din Zabbix-server måste kunna nå din OneUptime-instans via HTTPS.
- Ett OneUptime-projekt där du kan skapa arbetsflöden.

## Del 1 — Bygg OneUptime-arbetsflödet

Gör detta först, eftersom du behöver webhook-URL:en det genererar.

1. Öppna **Workflows → Create Workflow**. Namnge det `Zabbix → Incidents` och öppna fliken **Builder**.
2. Dra en **Webhook**-utlösare till arbetsytan. Klicka på den och **kopiera den unika URL:en** den visar. Håll den säker — vem som helst med den kan starta arbetsflödet. Byt namn på blocket till `Zabbix` så att variabler ser bra ut.
3. Dra ett **Conditions**-block till arbetsytan och koppla utlösarens utdata till det. Konfigurera:
   - **Left value**: `{{Zabbix.Request Body.status}}`
   - **Operator**: `==`
   - **Right value**: `1`  *(Zabbix skickar `1` för ett problem, `0` för återhämtning)*
4. Dra ett **Create Incident**-block och koppla det till **Conditions**-blockets **Yes**-utdata. Fyll i:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: välj den OneUptime-incidentallvarlighetsgrad du vill ha (du kan förfina detta senare med fler **Conditions**-grenar som mappar Zabbix-allvarlighetsgrader).
5. Spara. Lämna **Enabled** *av* tills vidare — du slår på det efter ett test.

> **Tips:** Att lägga Zabbix `event_id` i beskrivningen (eller en incidentetikett) gör att du kan hitta den här incidenten igen senare om du vill lösa den automatiskt vid återhämtning. Se [Automatisk lösning](#automatisk-losning-valfritt).

## Del 2 — Konfigurera Zabbix

### Steg 1: Skapa OneUptime-mediatypen

1. Gå i Zabbix till **Alerts → Media types** (i äldre versioner: **Administration → Media types**).
2. Klicka på **Create media type** och ange **Type** som **Webhook**.
3. **Name**: `OneUptime`.
4. Lägg till dessa **Parameters** (klicka på *Add* för var och en). Dessa mappar Zabbix [makron](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) till en ren payload:

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

5. Klistra in detta i fältet **Script**:

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

6. Klicka på fliken **Message templates** och lägg till en mall för **Problem** och **Problem recovery** (bodyn kan vara tom — payload:en byggs i skriptet). Detta krävs för att Zabbix ska använda mediatypen för dessa händelsetyper.
7. Klicka **Add** för att spara mediatypen.

### Steg 2: Skapa en användare att bära webhooken

Zabbix skickar notifieringar *till en användare*. Skapa en dedikerad sådan så att integrationen är lätt att hitta och inaktivera.

1. Gå till **Users → Users → Create user**. Namnge den `OneUptime Webhook`, ge den en roll som kan ta emot notifieringar (t.ex. **User role**) och lägg till den i en användargrupp.
2. På fliken **Media**, klicka **Add**:
   - **Type**: `OneUptime`
   - **Send to**: klistra in **arbetsflödets webhook-URL** som du kopierade i Del 1.
   - **When active** / allvarlighetsgrader: lämna standardinställningarna (eller begränsa till de allvarlighetsgrader du bryr dig om).
3. Klicka **Add** och **Update**.

### Steg 3: Skicka problem till OneUptime med en action

1. Gå till **Alerts → Actions → Trigger actions → Create action**.
2. **Name**: `Notify OneUptime`.
3. **Conditions** (valfritt): begränsa det — till exempel *Trigger severity >= Warning*. Lämna tomt för att skicka allt.
4. På fliken **Operations**, lägg till en åtgärd som skickar till **User: OneUptime Webhook** via mediatypen **OneUptime**.
5. Om du vill lösa incidenter vid återhämtning senare, fyll även i **Recovery operations** med samma användare/media.
6. Klicka **Add** för att spara och kontrollera att åtgärden är **Enabled**.

## Del 3 — Testa det

1. Tillbaka i OneUptime-arbetsflödet, slå på **Enabled**.
2. Utlös ett testproblem i Zabbix — till exempel, sänk temporärt ett utlösartröskel, eller använd ett testobjekt som slår om till ett problemtillstånd.
3. Öppna arbetsflödets flik **Logs**. Du bör se en körning med Zabbix-payload:en, **Conditions**-blocket som tar **Yes**-vägen och incidenten som skapas.
4. Kontrollera **Incidents** i OneUptime — ditt Zabbix-problem är nu en incident.

Om ingenting anländer, se [Felsökning](#felsökning).

## Automatisk lösning (valfritt)

Det grundläggande arbetsflödet ovan *öppnar* incidenter. För att även *stänga* dem när Zabbix återhämtar sig:

1. Kontrollera att din Zabbix-action har **Recovery operations** konfigurerade (Steg 3 ovan) så att återhämtningshändelser skickas också. Vid återhämtning anländer `status` som `0`.
2. I arbetsflödet, lägg till en andra **Conditions**-gren: vänster `{{Zabbix.Request Body.status}}`, operator `==`, höger `0`.
3. Från dess **Yes**-utdata, lägg till ett **Find Incident**-block som letar upp den öppna incident du skapade tidigare — matcha på Zabbix `event_id` som du lagrade i beskrivningen eller en etikett.
4. Koppla det till ett **Update Incident**-block och flytta incidenten till ditt *löst*-tillstånd.

Eftersom lösning beror på hur du modellerar incidenttillstånd i ditt projekt, behåll **skapa**-vägen som det pålitliga kärnan och lägg till lösningsvägen när du bekräftat att händelser flödar korrekt. Se [Komponenter → OneUptime-datakomponenter](/docs/workflows/components#oneuptime-data-components).

## Mappa Zabbix-allvarlighetsgrader (valfritt)

Zabbix-allvarlighetsgrader (`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`) anländer som `{{Zabbix.Request Body.severity}}`. För att mappa dem till OneUptime-incidentallvarlighetsgrader, lägg till **Conditions**-grenar före **Create Incident** — till exempel, dirigera `Disaster` och `High` till en "Critical"-incident och allt annat till "Major". Bygg ett **Create Incident**-block per gren.

## Felsökning

**Arbetsflödet körs aldrig.**
- Bekräfta att arbetsflödets **Enabled**-växel är på.
- Bekräfta från Zabbix-servern att den kan nå URL:en: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. Du bör få en snabb bekräftelse.
- Kontrollera **Reports → Action log** i Zabbix för leveransfel.

**Zabbix rapporterar ett skriptfel.**
- Öppna mediatypen och använd **Test** för att skicka en exempelpayload. Zabbix visar skriptets utdata eller det kastade felet.
- Ett icke-2xx-svar från OneUptime visas av `throw` i skriptet — kontrollera att arbetsflödets URL är exakt rätt.

**Incidenten skapas men fälten är tomma.**
- Öppna arbetsflödets flik **Logs** och granska utlösarens utdata. Bekräfta att fältnamnen under **Request Body** matchar vad du refererar till (`name`, `host`, `severity`, `status`, `event_id`).
- Ett saknat fält löser till en tom sträng snarare än ett fel — se [Variabler → Fallgropar](/docs/workflows/variables#gotchas).

**Allt utlöses dubbelt.**
- Du har förmodligen både ett problemsteg och ett eskaleringssteg som skickar till samma media. Kontrollera åtgärdens **Operations**-steg.

## Säkerhetsnoteringar

- Behandla arbetsflödets webhook-URL som ett lösenord. Om den läcker, radera utlösaren och skapa en ny för att rotera URL:en.
- Begränsa Zabbix-åtgärdens villkor så att du bara vidarebefordrar de allvarlighetsgrader som motiverar en incident.
- Om du kör OneUptime egenhostat bakom en brandvägg, tillåt din Zabbix-servers utgående IP att nå det via HTTPS.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — de inkommande/utgående mönstren.
- [Webhook-utlösare](/docs/workflows/triggers#webhook) — hur den mottagande URL:en fungerar.
- [Komponenter](/docs/workflows/components) — Conditions, Create Incident med mera.
- [Variabler](/docs/workflows/variables) — läsa Zabbix-payload:en i senare block.
