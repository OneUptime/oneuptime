# Runbook-triggers

Een runbook kan vanzelf starten: volgens een schema, of wanneer een ander hulpmiddel zijn webhook-URL aanroept. Gebruik een schema voor routinewerk, zoals een nachtelijke opschoning of een wekelijkse certificaatcontrole, en de webhook om een runbook te starten vanuit een alarmsysteem, een CI-pipeline of een script. Beide stel je in op de pagina **Triggers** van het runbook.

:::cards
- [Uitvoeren volgens een schema](#uitvoeren-volgens-een-schema): Om de paar minuten, elke dag, op dagen van de week, of een cron-expressie.
- [De webhook aanroepen](#de-webhook-aanroepen): Een uitvoering starten met een POST-verzoek naar de URL van het runbook.
- [Waarden die een webhook-aanroep verstuurt](#waarden-die-een-webhook-aanroep-verstuurt): Hoe de stappen de JSON lezen die een aanroeper verstuurt.
- [Problemen oplossen](#problemen-oplossen): Een schema dat niet draait, een aanroep die wordt geweigerd.
:::

## Hoe een trigger een uitvoering start

```mermaid title="Van een schema of een webhook-aanroep naar een uitvoering"
flowchart TB
    subgraph starts["Wat de uitvoering start"]
        direction LR
        schedule["Het schema: een<br/>tijdstip komt"]
        webhook["De webhook: een<br/>POST naar zijn URL"]
    end
    schedule --> checks["Het runbook staat<br/>aan en heeft stappen"]
    webhook --> checks
    checks --> execution["Uitvoering, gemarkeerd<br/>als Schedule of Webhook"]
    execution --> worker["De OneUptime Worker<br/>voert de stappen uit"]
```

Een trigger start een uitvoering zoals **Nu uitvoeren** dat doet: de uitvoering loopt door de huidige stappen van het runbook en hangt aan geen enkel incident, geen waarschuwing en geen gepland onderhoudsevenement. Elke uitvoering legt vast wat haar startte. De **Uitvoeringen** van het runbook en **Runbooks → Uitvoeringen** tonen dat onder **Geactiveerd door**, met wanneer een geplande uitvoering gepland stond of het adres dat de webhook aanriep, en op beide lijsten kun je erop filteren.

## Voordat je begint

- Een runbook met minstens één stap, waarvan de schakelaar **Dit runbook uitvoeren** aan staat, op de pagina **Instellingen**.
- Toestemming om het runbook te bewerken en uit te voeren. Zie [Wie triggers mag instellen](#wie-triggers-mag-instellen).

## Uitvoeren volgens een schema

:::steps
### De pagina Triggers van het runbook openen
Open het runbook via **Runbooks** en klik in het zijmenu op **Instellingen → Triggers**. **Instellingen** is eerst ingeklapt: klik erop om **Triggers** te tonen.

### Het schema instellen
Klik op **Schema instellen**. Kies onder **Wanneer het draait** een optie bij **Herhalen** en wat die nodig heeft. Het dialoogvenster zegt het schema in één zin, zoals "Draait elke werkdag om 09:00", en toont de volgende uitvoeringen terwijl je het wijzigt.

### De tijdzone controleren
**Tijdzone** begint bij die van jou. De tijden van het schema gelden volgens de klok van deze zone.

### Opslaan
Klik op **Schema opslaan**. Het schema wordt ingeschakeld, en de kaart toont het in één zin met de **Volgende uitvoeringen**.
:::

| **Herhalen** | Wat je kiest | Bijvoorbeeld |
| --- | --- | --- |
| **Om de paar minuten** | **Elke**: 1, 2, 3, 4, 5, 6, 10, 12, 15, 20 of 30 minuten | Elke 15 minuten |
| **Om de paar uur** | **Elke**: 1, 2, 3, 4, 6, 8 of 12 uur, en **Minuten na het hele uur** | Elke 2 uur op :30 |
| **Elke dag** | **Tijdstip** | Elke dag om 09:00 |
| **Op gekozen dagen** | **Op deze dagen**, met **Werkdagen** en **Elke dag** als snelkoppelingen, en **Tijdstip** | Elke werkdag om 09:00 |
| **Aangepast (cron-expressie)** | **Cron-expressie** | `0 2 1 * *`: om 02:00 op de 1e van elke maand |

Een cron-expressie heeft vijf velden: minuut, uur, dag van de maand, maand en dag van de week. Runbooks draaien hooguit één keer per minuut, dus er is geen veld voor seconden. Het dialoogvenster legt een expressie uit die het niet kan lezen, of een die nooit draait, zoals `0 0 31 2 *`, en slaat niets op tot hij kan draaien.

De kaart toont daarna het schema, de volgende drie uitvoeringen volgens de klok van de zone, wat het doet als er nog een uitvoering loopt of een tijdstip is gemist, en de **Laatste geplande uitvoering** met **Uitvoering bekijken**. **Schema bewerken** opent hetzelfde dialoogvenster, en de schakelaar **Uitvoeren volgens dit schema** pauzeert het schema zonder het kwijt te raken.

### Als er nog een uitvoering loopt

Een uitvoering loopt nog zolang ze in de wachtrij staat, bezig is of wacht tot iemand een stap voltooit of goedkeurt, hoe ze ook gestart is. De instelling **Als er nog een uitvoering loopt** van het schema, in het dialoogvenster ingeklapt onder **Meer velden**, bepaalt wat een tijdstip doet dat dan komt:

| Instelling | Wat er gebeurt |
| --- | --- |
| **Dat tijdstip overslaan** (standaard) | Er start niets. Het schema wacht op het volgende tijdstip. |
| **Uitvoeren zodra die klaar is** | Eén uitvoering wacht en start wanneer de lopende uitvoering klaar is. Andere tijdstippen die intussen komen, starten niets. |

### Als OneUptime een tijdstip heeft gemist

Lag OneUptime op een gepland tijdstip plat of werd het bijgewerkt, dan is het tijdstip gemist zodra het meer dan 5 minuten te laat is. **Als OneUptime een tijdstip heeft gemist** bepaalt wat er gebeurt als OneUptime terug is:

| Instelling | Wat er gebeurt |
| --- | --- |
| **Eén keer uitvoeren zodra OneUptime terug is** (standaard) | Eén uitvoering start, hoeveel tijdstippen er ook gemist zijn, gemarkeerd als "Eén keer uitgevoerd om tijdstippen in te halen die OneUptime miste". |
| **De gemiste tijdstippen overslaan** | Er start niets tot het volgende tijdstip. |

Tijdstippen die verstrijken terwijl het schema of het runbook uitstaat, zijn niet gemist: zet je een van beide weer aan, dan gaat het verder vanaf het volgende tijdstip.

### Tijdzones en zomertijd

De tijden gelden het hele jaar volgens de klok van de zone. Een schema voor 09:00 in Europe/London draait in de winter en in de zomer om 09:00 Londense tijd. In de nacht waarin de klok vooruit gaat, draait een tijdstip dat die nacht niet bestaat een uur later op de klok. Gaat de klok terug en komt een uur twee keer, dan draait een schema dat elk uur draait in beide, en elk ander schema één keer, in het eerste.

## De webhook aanroepen

:::steps
### De webhook inschakelen
Zet op de pagina **Triggers** van het runbook **Uitvoeren wanneer deze URL wordt aangeroepen** aan. Het runbook krijgt een eigen URL.

### De URL kopiëren
De **Webhook-URL** is gemaskeerd: klik op **Tonen** om hem te zien, of op **URL kopiëren** om hem helemaal te kopiëren. **Uitproberen** heeft een `curl`-opdracht om mee te beginnen.

### Hem aanroepen vanuit je hulpmiddel
Stuur een `POST`-verzoek naar de URL, met een JSON-object als body, of zonder body:

```bash
curl -X POST "https://oneuptime.com/runbook/webhook/RUNBOOK_ID/SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"host": "web-1", "reason": "Disk almost full"}'
```

### De uitvoering controleren
Het antwoord noemt de gestarte uitvoering: `{"runbookExecutionId": "...", "status": "Scheduled"}`. De uitvoering staat bij de **Uitvoeringen** van het runbook, waar **Geactiveerd door** **Webhook** zegt, en haar pagina toont onder **Invoer** wat de aanroep verstuurde.
:::

**Testverzoek verzenden** stuurt een `POST` met een body die je zelf schrijft naar de URL, zoals een ander hulpmiddel zou doen, en linkt naar de gestarte uitvoering. Het is een echte uitvoering van het runbook.

### Wat een aanroep als antwoord krijgt

| Antwoord | Wanneer |
| --- | --- |
| `200` | De uitvoering is gestart. De body noemt haar. |
| `400` | De body is geen JSON-object, is meer dan 32 niveaus diep genest of bevat een NUL-teken, of het runbook heeft geen stappen. |
| `403` | De webhook of het runbook staat uit. |
| `404` | Op deze URL antwoordt geen runbook-webhook: de runbook-ID of de sleutel klopt niet, of de URL is opnieuw ingesteld. |
| `405` | Het verzoek is een `GET`. Een `GET` start nooit een uitvoering, dus een linkvoorbeeld in een chat-app kan hem niet per ongeluk uitvoeren. |
| `413` | De body is groter dan 64 KB. |
| `429` | De webhook startte 30 uitvoeringen in de laatste minuut, 10 van zijn uitvoeringen lopen nog, of één adres deed meer dan 120 aanroepen naar runbook-webhooks in een minuut, of de adressen van één IPv6-/64 samen meer dan 1200. De header `Retry-After` zegt wanneer je het opnieuw kunt proberen, waar dat kan. |
| `503` | OneUptime kan aanroepen nu niet tellen. Probeer het over een minuut opnieuw. |

Een geweigerde aanroep start niets, en de body zegt in één zin waarom, zoals "This runbook is turned off, so it was not started. Turn it on with Run this runbook, under the runbook's Settings."

### De URL geheim houden

De URL bevat de geheime sleutel van het runbook: iedereen die hem heeft, kan het runbook starten. De sleutel bestaat uit 43 willekeurige tekens, wordt in constante tijd vergeleken, en een verkeerde sleutel krijgt hetzelfde antwoord als wanneer het runbook niet zou bestaan.

Lekt de URL uit, klik dan op **URL opnieuw instellen**. Het runbook krijgt een nieuwe URL en de oude werkt meteen niet meer, dus geef de nieuwe aan elk hulpmiddel dat hem aanroept. Als je de webhook uit- en weer aanzet, blijft de URL dezelfde.

## Waarden die een webhook-aanroep verstuurt

De waarden op het hoogste niveau van de body worden de invoer van de uitvoering. Ze bereiken de stappen als gegevens, nooit als tekst die in een script of opdracht wordt geplakt:

| Staptype | Hoe het de invoer leest |
| --- | --- |
| Bash en kubectl | Omgevingsvariabelen: één `ONEUPTIME_INPUT_<NAME>` voor elke waarde op het hoogste niveau, `ONEUPTIME_INPUTS` met het hele object als JSON en `ONEUPTIME_TRIGGER` met wat de uitvoering startte, zoals `Webhook` of `Schedule`. |
| JavaScript | `args.inputs`, het object zoals verstuurd, en `args.trigger`. |
| AI | In de prompt, gemarkeerd als gegevens van buiten OneUptime, wanneer **Triggercontext opnemen** aan staat. |
| HTTP request en SSH | Helemaal niet. Hun URL, script en doel zijn wat in het runbook staat, en niets wat een aanroeper verstuurt verandert ze. |

De naam van een variabele is de naam van de waarde in hoofdletters, waarbij elk teken dat geen letter of cijfer is als `_` wordt geschreven: `host-name` wordt `ONEUPTIME_INPUT_HOST_NAME`. Tekst wordt doorgegeven zoals hij is, getallen en `true` of `false` zoals geschreven, en objecten en lijsten als JSON. Een stap krijgt hooguit 100 van deze variabelen, en een naam van meer dan 100 tekens wordt er geen; elke waarde staat nog steeds in `ONEUPTIME_INPUTS`. Elke naam begint met `ONEUPTIME_`, dus een aanroeper kan `PATH` of een andere variabele die de Runner leest niet instellen.

Een aanroeper bepaalt deze waarden, dus controleer ze voordat je ernaar handelt:

```bash
set -euo pipefail
case "$ONEUPTIME_INPUT_HOST" in
  web-1|web-2|web-3) ;;
  *) echo "Unknown host: $ONEUPTIME_INPUT_HOST"; exit 1 ;;
esac
curl -fsS -X POST "http://$ONEUPTIME_INPUT_HOST.internal:8080/restart"
```

```javascript
const host = args.inputs.host;
if (!["web-1", "web-2", "web-3"].includes(host)) {
  throw new Error(`Unknown host: ${host}`);
}
console.log(`Started by ${args.trigger} for ${host}`);
return { host };
```

## Wie triggers mag instellen

Een schema of een webhook start uitvoeringen zonder dat er iemand bij is, dus er een instellen vraagt toestemming om het runbook te bewerken en uit te voeren: Project Owner, Project Admin of Runbook Admin, of **Edit Runbook** samen met Project Member, Runbook Member of **Create Runbook Execution**. De labels waartoe een rol beperkt is tellen mee, zoals bij **Nu uitvoeren**. De webhook-URL zien of opnieuw instellen vraagt hetzelfde.

Een schema of een webhook uitzetten start niets en vraagt dus alleen toestemming om het runbook te bewerken. Wie het runbook mag bewerken maar niet uitvoeren, ziet de pagina **Triggers** met **Schema instellen** vergrendeld, en krijgt te horen wie de webhook-URL kan zien.

## Problemen oplossen

:::details Er draait niets volgens het schema
Het runbook staat uit of heeft geen stappen: de kaart zegt welke van de twee. Zet **Dit runbook uitvoeren** aan op de pagina **Instellingen** van het runbook, of voeg stappen toe op de pagina **Stappen**. Zegt de kaart dat het schema gepauzeerd is, zet dan **Uitvoeren volgens dit schema** aan.
:::

:::details Een gepland tijdstip startte niets
Er liep nog een uitvoering en het schema slaat zulke tijdstippen over, of OneUptime miste het tijdstip en het schema slaat gemiste tijdstippen over. Zie [Als er nog een uitvoering loopt](#als-er-nog-een-uitvoering-loopt) en [Als OneUptime een tijdstip heeft gemist](#als-oneuptime-een-tijdstip-heeft-gemist).
:::

:::details Een schema opslaan mislukt met "You do not have permission to set up this runbook's schedule or webhook."
Een trigger instellen vraagt toestemming om het runbook uit te voeren én te bewerken. Vraag om Runbook Admin, of om Runbook Member of **Create Runbook Execution** naast **Edit Runbook**.
:::

:::details Een aanroep krijgt als antwoord "No runbook webhook answers at this URL."
De URL is opnieuw ingesteld of verkeerd gekopieerd. Kopieer hem opnieuw van de pagina **Triggers** van het runbook.
:::

:::details Een aanroep krijgt als antwoord "This runbook's webhook is turned off, so the runbook was not started."
Zet **Uitvoeren wanneer deze URL wordt aangeroepen** aan op de pagina **Triggers** van het runbook. De URL is dezelfde als voorheen.
:::

## Volgende stappen

:::cards
- [Een runbook uitvoeren](/docs/runbooks/running): Wat een uitvoering toont, en hoe je haar verder helpt.
- [Een runbook schrijven](/docs/runbooks/authoring): De stappen schrijven die een trigger uitvoert.
- [Runbook-configuratie & veiligheid](/docs/runbooks/configuration): Limieten, rechten en beveiliging.
:::
