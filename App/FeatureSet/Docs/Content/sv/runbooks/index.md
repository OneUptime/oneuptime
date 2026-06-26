# Runbooks – Översikt

Runbooks är återanvändbara svarsprocedurer — ordnade listor över manuella eller automatiserade steg — som du kopplar till incidenter, larm eller planerade underhåll. De förvandlar ad hoc-Slack-trådar i stil med "vad gör vi nu?" till något en kollega kan ta upp kallt klockan 3 på natten.

## I korthet

- **Toppnivåfunktion** i OneUptime-dashboarden under **Analytics & Automation → Runbooks**.
- **Fyra stegtyper**: Manuell checklista, JavaScript (sandboxat) och Bash (båda körs på en [Runbook-agent](/docs/runbooks/agents) inuti din egen infrastruktur), HTTP-förfrågan.
- **Tre triggervägar**: regler som matchar incidenter/larm/planerat underhåll, eller en manuell "Kör runbook"-knapp på vilket event som helst.
- **Snapshot-semantik**: när ett runbook startar kopieras dess steg in på körningen. Att senare redigera mallen muterar aldrig en pågående körning.
- **Fullt audit-spår**: varje stegs status, utdata, felmeddelande och tidsåtgång registreras för alltid på körningen.

## Varför använda runbooks?

Incidenthantering är ofta skillnaden mellan en blixt på en minut och ett flertimmars avbrott. Runbooks hjälper dig att:

- **Kodifiera stammkunskap** — det "vad man gör när kön svämmar över" bor någonstans där ditt team kan hitta det.
- **Minska Mean Time to Recovery (MTTR)** — automatiserade steg körs på sekunder; manuella steg tar bort beslutsförlamning.
- **Granska svarsåtgärder** — varje körda steg, varje utdata, varje klick från en svarare registreras på körningen.
- **Få juniora ingenjörer i arbete snabbt** — de kan köra ett runbook med tillförsikt i stället för att paga en senior klockan 3 på natten.
- **Skriva post-mortems från data, inte från minnet** — den registrerade körningen är ett fryst protokoll över exakt vad som hände.

## Nyckelbegrepp

Några termer återkommer i resten av runbook-dokumenten. Få ordning på dessa först:

| Term              | Betydelse                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runbook**       | Mallen. En namngiven, återanvändbar procedur med en ordnad steglista och en `isEnabled`-flagga.                                                                                                                   |
| **Steg**          | Ett objekt i ett runbook. Har en typ (Manuell / JavaScript / HTTP / Bash), en titel, en beskrivning och typspecifik konfiguration.                                                                                |
| **Runbook-regel** | Ett mönster som automatiskt kopplar ett eller flera runbooks till incidenter, larm eller planerade underhåll när deras titel eller beskrivning matchar en regex.                                                  |
| **Körning**       | En körning av ett runbook. Skapas när en regel utlöses, någon klickar "Kör runbook" på ett event, eller någon klickar "Kör nu" på själva runbooket. Innehåller ett snapshot av stegen och status/utdata per steg. |
| **Snapshot**      | Den frysta kopian av runbookets steg som lever på varje körning. Låter dig redigera mallen senare utan att skriva om historien.                                                                                   |

## Ett runbooks livscykel

1. **Författa** — Skapa ett runbook och lägg in en mix av Manuella, JavaScript-, HTTP- och Bash-steg. Spara.
2. **(Valfritt) Lägg till en regel** — Tala om för OneUptime i inställningarna för Incidenter, Larm eller Planerat underhåll att detta runbook ska starta så snart titeln eller beskrivningen på ett event matchar en regex.
3. **Trigga** — Antingen utlöses regeln automatiskt när ett matchande event skapas, eller så klickar en svarare manuellt på **Kör runbook** på eventet.
4. **Köra** — En ny körning skapas med ett snapshot av stegen. Automatiserade steg körs inline på Runbook-workern; körningen pausar vid varje manuellt steg tills någon bockar av det.
5. **Granska** — Körningen stannar för alltid på eventets **Runbooks**-flik och på runbookets **Executions**-lista. Per-steg utdata, fel och tider bevaras för post-mortem.

## När ska man använda vilken stegtyp

En snabb beslutsguide. Den längre genomgången finns i [Skriva ett runbook](/docs/runbooks/authoring).

| Stegtyp            | Sträck dig efter den när…                                                                                                                                                                                            | Exempel                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Manuell**        | En människa måste verifiera något, göra en bedömning eller utföra en åtgärd som OneUptime inte kan observera.                                                                                                        | "Bekräfta sekundärregion-trafik på load balancer-dashboarden."                   |
| **JavaScript**     | Du behöver en liten, avgränsad beräkning — fråga en konfigurationstjänst, transformera en payload, köra logik före nästa steg. Körs sandboxat på en [Runbook-agent](/docs/runbooks/agents) i din egen infrastruktur. | Beräkna nuvarande replica-lag och avgöra om man ska fortsätta.                   |
| **HTTP-förfrågan** | Du anropar ett befintligt API — din egen admin-endpoint, en molnleverantör, PagerDuty, Slack.                                                                                                                        | `POST` till din failover-orchestrator.                                           |
| **Bash**           | Du behöver köra shell-kommandon på din egen infrastruktur — starta om en tjänst, anropa `kubectl`, anropa ett deploy-skript. Kräver en [Runbook-agent](/docs/runbooks/agents) installerad i din miljö.               | Starta om en tjänst, köra `kubectl rollout restart`, exec:a ett recovery-skript. |

Du kan blanda alla fyra i ett enda runbook — runbooks styrka är att varva mänsklig verifiering med automation.

## Var runbooks bor i dashboarden

| Sida                                                                      | Vad du gör där                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Analytics & Automation → Runbooks**                                     | Bläddra, skapa och redigera runbook-mallar.                                               |
| **Ett runbooks Steps-flik**                                               | Författa och omordna steglistan.                                                          |
| **Ett runbooks Executions-flik**                                          | Se varje körning av detta runbook med statusfilter.                                       |
| **Ett runbooks "Kör nu"-knapp**                                           | Starta en ad hoc-körning som inte är kopplad till något event.                            |
| **Incidents / Alerts / Scheduled Maintenance → Settings → Runbook Rules** | Skapa auto-triggerreglerna per entitetstyp.                                               |
| **En incident / ett larm / ett underhåll → Runbooks-flik**                | Se körningar kopplade till detta event och klicka **Kör runbook** för en manuell körning. |

## Vanliga användningsfall

Några mönster vi ser team använda runbooks för:

- **Databas-failover** — Fånga nuvarande status med JavaScript, be jour-DBA:n bekräfta replicans hälsa (Manuell), anropa orchestrator-API:t (HTTP), bocka av "DNS uppdaterad" (Manuell), posta klart-meddelande till Slack (HTTP).
- **Cache-tömning** — Ett enskilt HTTP-steg plus ett Manuellt "bekräfta att cache hit rate återhämtar sig på dashboarden".
- **Kund-påverkande incident** — Manuellt: "Posta statussideuppdatering." HTTP: "Notifiera CS-teamet i #customer-incidents." JavaScript: "Hämta lista över påverkade konton från intern API."
- **Pre-flight för planerat underhåll** — JavaScript: snapshot av nuvarande mätvärden. Manuellt: "Bekräfta förändringsfönster med intressenter." HTTP: aktivera underhållsläge på load balancern.
- **Always-run-hygien** — En regel med tomt titelmönster som fångar systemstatus vid varje incident, oavsett vad — perfekt för post-mortems.

## Ett genomarbetat exempel

Anta att du vill att varje incident med "db-primary" i titeln automatiskt sparkar igång ett femstegs DB-failover-runbook.

**1. Skapa runbooket.** Under **Runbooks → Skapa runbook**, namnge det "DB primary failover" och lägg till dessa steg:

| #   | Typ        | Titel                                             |
| --- | ---------- | ------------------------------------------------- |
| 1   | JavaScript | Fånga pre-failover replica-lag                    |
| 2   | Manuell    | Bekräfta replicans hälsa i DBA-dashboard          |
| 3   | HTTP       | `POST` till failover-orchestrator                 |
| 4   | Manuell    | Verifiera att skrivningar nu går till nya primary |
| 5   | HTTP       | Posta klart-meddelande till `#db-incidents` Slack |

**2. Lägg till en regel.** Under **Incidents → Settings → Runbook Rules**, skapa:

```
Title Pattern:  ^db-primary
Runbooks:       [DB primary failover]
```

**3. Trigga.** Ett monitorlarm öppnar incident `INC-4821 · db-primary connection timeout`. Regeln matchar, en körning skapas, och:

- Steg 1 (JavaScript) körs omedelbart på workern — dess `return { lagMs: 412 }`-värde fångas.
- Steg 2 (Manuellt) pausar körningen. Jouren ser en "Väntar på dig"-etikett på incidentsidan, klickar på dashboarden och bockar av steget.
- Steg 3 (HTTP) körs så snart steg 2 är avbockat — `POST`-svarsbodyn fångas.
- Steg 4 (Manuellt) pausar igen.
- Steg 5 (HTTP) körs och körningen avslutas.

**4. Granska.** Körningen stannar på incidentens **Runbooks**-flik. Varje stegs utdata är ett klick bort. När du skriver post-mortemen nästa vecka behöver du inte fråga "vad gav det skriptet tillbaka?" — det står där.

## Hur runbooks passar in med resten av OneUptime

- **Monitorer** öppnar incidenter och larm; **runbook-regler** förvandlar dessa events till runbook-körningar. Tillsammans bildar de en sluten loop: upptäcka → trigga → svara → registrera.
- **Workspace-anslutningar** (Slack, Microsoft Teams) är ett naturligt mål för runbook-HTTP-steg — posta statusuppdateringar, notifiera kanaler.
- **Statussidor** uppdateras ofta som ett manuellt steg i ett kund-påverkande runbook.
- **Beredskapsscheman** bestämmer vem som pagas; runbooks bestämmer vad den personen gör så snart hen är vaken.

## Var läsa vidare

- [Skriva ett runbook](/docs/runbooks/authoring) — skapa runbooks, de fyra stegtyperna och vad varje gör.
- [Runbook-regler](/docs/runbooks/rules) — koppla runbooks automatiskt till incidenter, larm och planerade underhåll.
- [Köra ett runbook](/docs/runbooks/running) — manuella triggers, körningsvyn och hur manuella steg samspelar med automatiserade.
- [Runbook-agenter](/docs/runbooks/agents) — installera agenterna som kör Bash-steg inuti din egen infrastruktur.
- [Runbook-konfiguration & säkerhet](/docs/runbooks/configuration) — utdatatak, behörigheter, härdningsnoteringar.
