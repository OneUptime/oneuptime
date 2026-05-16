# Runbooks – Översikt

Runbooks är återanvändbara svarsprocedurer — ordnade listor över manuella eller automatiserade steg — som du kopplar till incidenter, larm eller planerade underhåll. De förvandlar ad hoc-Slack-trådar i stil med "vad gör vi nu?" till något en kollega kan ta upp kallt klockan 3 på natten.

## I korthet

- **Toppnivåfunktion** i OneUptime-dashboarden under **Analys & Automatisering → Runbooks**.
- **Fyra stegtyper**: manuell checklista, JavaScript (sandlåda) och Bash (båda körs på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur), HTTP-begäran.
- **Tre sätt att utlösa**: regler som matchar incidenter/larm/planerade underhåll, eller den manuella knappen "Kör runbook" på vilken händelse som helst.
- **Snapshot-semantik**: när ett runbook startar kopieras dess steg till körningen. Att senare redigera mallen ändrar aldrig en pågående körning.
- **Komplett revisionsspår**: status, utdata, felmeddelande och varaktighet för varje steg sparas på körningen för alltid.

## Varför använda runbooks?

Incidentrespons är ofta skillnaden mellan en minuts störning och flera timmars avbrott. Runbooks hjälper dig att:

- **Kodifiera tyst kunskap** — svaret på "vad gör vi när kön svämmar över?" ligger på en plats teamet hittar.
- **Sänka den genomsnittliga återställningstiden (MTTR)** — automatiserade steg körs på sekunder; manuella steg tar bort beslutsförlamning.
- **Granska responshandlingar** — varje utfört steg, varje utdata, varje klick från respondern registreras på körningen.
- **Göra juniorer handlingskraftiga** — de kan köra ett runbook med trygghet i stället för att ringa en senior klockan 3.
- **Skriva postmortem från data, inte minne** — den infrysta körningen är en exakt återgivning av vad som hände.

## Nyckelbegrepp

Några begrepp återkommer i resten av runbook-dokumentationen. Få ordning på dem först:

| Begrepp | Innebörd |
| --- | --- |
| **Runbook** | Mallen. En namngiven, återanvändbar procedur med en ordnad lista över steg och en `isEnabled`-flagga. |
| **Steg** | Ett objekt i ett runbook. Har en typ (Manuell / JavaScript / HTTP / Bash), en titel, en beskrivning och typspecifik konfiguration. |
| **Runbook-regel** | Ett mönster som automatiskt kopplar ett eller flera runbooks till incidenter, larm eller planerade underhåll när titel eller beskrivning matchar en regex. |
| **Körning** | En enskild körning av ett runbook. Skapas när en regel utlöses, när någon klickar "Kör runbook" på en händelse, eller när någon klickar "Kör nu" på själva runbooken. Innehåller en snapshot av stegen och status/utdata per steg. |
| **Snapshot** | Den infrysta kopian av runbookens steg som lever på varje körning. Låter dig redigera mallen senare utan att skriva om historiken. |

## Ett runbooks livscykel

1. **Skriva** — Skapa ett runbook, blanda manuella, JavaScript-, HTTP- och Bash-steg. Spara.
2. **(Valfritt) Lägg till en regel** — I inställningarna för Incidenter, Larm eller Planerade underhåll säger du till OneUptime att starta detta runbook när en händelses titel eller beskrivning matchar en regex.
3. **Utlösa** — Antingen utlöses regeln automatiskt när en matchande händelse skapas, eller så klickar en responder manuellt **Kör runbook** på händelsen.
4. **Köra** — En ny körning skapas med en snapshot av stegen. Automatiserade steg körs på Runbook-workern; körningen pausas vid varje manuellt steg tills någon kryssar av det.
5. **Granska** — Körningen finns kvar för alltid på händelsens **Runbooks**-flik och i runbookens körningslista. Utdata, fel och tider per steg bevaras för postmortem.

## När du använder vilken stegtyp

En snabb beslutsguide. Den långa genomgången finns i [Skriva ett runbook](/docs/runbooks/authoring).

| Stegtyp | Använd när… | Exempel |
| --- | --- | --- |
| **Manuell** | En människa måste verifiera något, göra en bedömning eller utföra en handling som OneUptime inte kan observera. | "Bekräfta trafik i sekundär region på load balancer-dashboarden." |
| **JavaScript** | Du behöver en liten, inneslutna beräkning — fråga en konfig-tjänst, transformera en payload, köra logik före nästa steg. Körs i sandlåda på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur. | Räkna ut nuvarande replikalag och avgör om du går vidare. |
| **HTTP-begäran** | Du anropar ett befintligt API — din egen admin-endpoint, en molnleverantör, PagerDuty, Slack. | `POST` till din failover-orkestrator. |
| **Bash** | Du behöver köra shell-kommandon på din egen infrastruktur — starta om en tjänst, köra `kubectl`, anropa ett deploy-skript. Kräver en [Runbook-agent](/docs/runbooks/agents) installerad i din miljö. | Starta om en tjänst, `kubectl rollout restart`, kör ett återställningsskript. |

Du kan blanda alla fyra i ett enda runbook — runbookens styrka är att fläta in mänsklig verifikation med automation.

## Var runbooks bor i dashboarden

| Sida | Vad du gör där |
| --- | --- |
| **Analys & Automatisering → Runbooks** | Bläddra, skapa och redigera runbook-mallar. |
| **Steg-fliken på ett runbook** | Skriva och omordna steglistan. |
| **Körningar-fliken på ett runbook** | Se varje körning av detta runbook med statusfilter. |
| **Knappen "Kör nu" på ett runbook** | Starta en ad hoc-körning som inte är kopplad till någon händelse. |
| **Incidenter / Larm / Planerade underhåll → Inställningar → Runbook-regler** | Skapa de automatiska utlösningsreglerna per entitetstyp. |
| **En incident / larm / underhållshändelse → Runbooks-flik** | Se körningar kopplade till händelsen och klicka **Kör runbook** för en manuell körning. |

## Vanliga användningsfall

Några mönster där team gärna tar till runbooks:

- **Database-failover** — Fånga aktuellt läge med JavaScript, be jourhavande DBA bekräfta replikahälsa (Manuell), anropa orkestrator-API (HTTP), kryssa "DNS uppdaterat" (Manuell), posta "allt klart" på Slack (HTTP).
- **Tömma cache** — Ett HTTP-steg plus ett Manuellt "bekräfta att cache-träffrekvensen återhämtar sig på dashboarden".
- **Kundpåverkande incident** — Manuell: "Posta uppdatering på statussidan." HTTP: "Meddela CS-teamet i #customer-incidents." JavaScript: "Hämta lista över drabbade konton från internt API."
- **Pre-flight för planerat underhåll** — JavaScript: snapshot av aktuella mätvärden. Manuell: "Bekräfta ändringsfönster med intressenter." HTTP: aktivera underhållsläge på load balancern.
- **Always-on hygienregel** — En regel med tomt titelmönster som fångar systemtillstånd vid varje incident — guld värt för postmortem.

## Ett genomarbetat exempel

Anta att du vill att varje incident med "db-primary" i titeln automatiskt ska starta ett fem-stegs DB-failover-runbook.

**1. Skapa runbooket.** Under **Runbooks → Skapa runbook** kallar du det "DB primary failover" och lägger till dessa steg:

| # | Typ | Titel |
| --- | --- | --- |
| 1 | JavaScript | Fånga replikalag före failover |
| 2 | Manuell | Bekräfta replikahälsa i DBA-dashboarden |
| 3 | HTTP | `POST` till failover-orkestrator |
| 4 | Manuell | Verifiera att skrivningar går till nya primary |
| 5 | HTTP | Posta "allt klart" i Slack `#db-incidents` |

**2. Lägg till en regel.** Under **Incidenter → Inställningar → Runbook-regler** skapar du:

```
Titelmönster:  ^db-primary
Runbooks:      [DB primary failover]
```

**3. Utlösning.** Ett monitor-larm öppnar incidenten `INC-4821 · db-primary connection timeout`. Regeln matchar, en körning skapas, och:

- Steg 1 (JavaScript) körs omedelbart på workern — dess `return { lagMs: 412 }`-värde fångas.
- Steg 2 (Manuell) pausar körningen. Jouren ser en "Väntar på dig"-markering på incidentsidan, kollar dashboarden och kryssar i steget.
- Steg 3 (HTTP) går så snart steg 2 är ikryssat — `POST`-svarsbodyn fångas.
- Steg 4 (Manuell) pausar igen.
- Steg 5 (HTTP) körs och körningen avslutas.

**4. Granska.** Körningen ligger kvar på incidentens **Runbooks**-flik. Utdata för varje steg är ett klick bort. När du skriver postmortem nästa vecka slipper du fråga "vad returnerade det där skriptet?" — det står där.

## Hur runbooks passar in i resten av OneUptime

- **Monitorer** öppnar incidenter och larm; **runbook-regler** förvandlar dessa händelser till runbook-körningar. Tillsammans bildar de en sluten slinga: upptäcka → utlösa → svara → registrera.
- **Workspace-kopplingar** (Slack, Microsoft Teams) är ett naturligt mål för HTTP-steg — posta statusuppdateringar, meddela kanaler.
- **Statussidor** uppdateras ofta som ett manuellt steg i ett kundpåverkande runbook.
- **Jourscheman** avgör vem som larmas; runbooks avgör vad personen gör när hen är vaken.

## Läs vidare

- [Skriva ett runbook](/docs/runbooks/authoring) — skapa runbooks, de fyra stegtyperna och vad de gör.
- [Runbook-regler](/docs/runbooks/rules) — koppla runbooks automatiskt till incidenter, larm och planerade underhåll.
- [Köra ett runbook](/docs/runbooks/running) — manuella utlösare, körningsvyn och hur manuella steg samspelar med automatiserade.
- [Runbook-agenter](/docs/runbooks/agents) — installera agenterna som kör Bash-steg i din egen infrastruktur.
- [Konfiguration & säkerhet](/docs/runbooks/configuration) — utdatagränser, rättigheter, härdningsnoteringar.
