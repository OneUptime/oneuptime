# Runbooks – Overzicht

Runbooks zijn herbruikbare responsprocedures — geordende lijsten van handmatige of geautomatiseerde stappen — die je koppelt aan incidenten, alerts of geplande onderhoudsmomenten. Ze veranderen ad-hoc "wat doen we nu?"-Slack-threads in iets dat een collega om 3 uur 's nachts koud kan oppikken.

## In één oogopslag

- **Top-level feature** in het OneUptime-dashboard onder **Analytics & Automation → Runbooks**.
- **Vier staptypes**: Handmatige checklist, JavaScript (in sandbox) en Bash (beide draaien op een [Runbook-agent](/docs/runbooks/agents) in je eigen infrastructuur), HTTP-verzoek.
- **Drie triggerpaden**: regels die matchen op incidenten/alerts/gepland onderhoud, of een handmatige "Runbook uitvoeren"-knop op elk event.
- **Snapshot-semantiek**: zodra een runbook start, worden zijn stappen naar de uitvoering gekopieerd. Het later bewerken van de template wijzigt nooit een lopende run.
- **Volledig audit-spoor**: status, output, foutmelding en duur van elke stap worden voor altijd op de uitvoering vastgelegd.

## Waarom runbooks gebruiken?

Incidentafhandeling is vaak het verschil tussen een storing van één minuut en een uitval van meerdere uren. Runbooks helpen je:

- **Tribal knowledge vastleggen** — het "wat te doen als de wachtrij vol loopt" staat ergens waar je team het kan vinden.
- **Mean Time to Recovery (MTTR) verlagen** — geautomatiseerde stappen draaien in seconden; handmatige stappen halen beslissingsverlamming weg.
- **Responsacties auditen** — elke uitgevoerde stap, elke output, elke klik van een responder wordt vastgelegd op de uitvoering.
- **Junior engineers snel aan het werk krijgen** — ze kunnen met vertrouwen een runbook draaien in plaats van om 3 uur 's nachts een senior te pagen.
- **Post-mortems uit data schrijven, niet uit het geheugen** — de vastgelegde uitvoering is een bevroren record van precies wat er gebeurd is.

## Kernbegrippen

Een paar termen komen telkens terug in de rest van de runbook-docs. Krijg deze eerst helder:

| Term              | Betekenis                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runbook**       | De template. Een benoemde, herbruikbare procedure met een geordende staplijst en een `isEnabled`-vlag.                                                                                                                                         |
| **Stap**          | Eén item in een runbook. Heeft een type (Handmatig / JavaScript / HTTP / Bash), een titel, een beschrijving en typespecifieke configuratie.                                                                                                    |
| **Runbook-regel** | Een patroon dat één of meer runbooks automatisch koppelt aan incidenten, alerts of geplande onderhoudsmomenten wanneer hun titel of beschrijving matcht met een regex.                                                                         |
| **Uitvoering**    | Eén run van een runbook. Wordt aangemaakt wanneer een regel afgaat, iemand op "Runbook uitvoeren" klikt op een event, of iemand op "Nu uitvoeren" klikt op het runbook zelf. Bevat een snapshot van de stappen en de status / output per stap. |
| **Snapshot**      | De bevroren kopie van de stappen van het runbook die op elke uitvoering leeft. Hiermee kun je de template later bewerken zonder de geschiedenis te herschrijven.                                                                               |

## De levenscyclus van een runbook

1. **Schrijven** — Maak een runbook aan en zet er een mix van Handmatige, JavaScript-, HTTP- en Bash-stappen in. Opslaan.
2. **(Optioneel) Een regel toevoegen** — Vertel OneUptime in de instellingen van Incidenten, Alerts of Gepland Onderhoud om dit runbook te starten zodra de titel of beschrijving van een event matcht met een regex.
3. **Triggeren** — Of de regel gaat automatisch af bij het aanmaken van een passend event, of een responder klikt handmatig op **Runbook uitvoeren** op het event.
4. **Uitvoeren** — Er wordt een nieuwe uitvoering aangemaakt met een snapshot van de stappen. Geautomatiseerde stappen draaien inline op de Runbook-worker; de uitvoering pauzeert bij elke handmatige stap totdat iemand hem afvinkt.
5. **Auditeren** — De uitvoering blijft voor altijd op het **Runbooks**-tabblad van het event en op de **Executions**-lijst van het runbook staan. Output, fouten en timings per stap worden bewaard voor de post-mortem.

## Wanneer welk staptype gebruiken

Een snelle beslissingsgids. De langere uitleg staat in [Een runbook schrijven](/docs/runbooks/authoring).

| Staptype         | Grijp hiernaar wanneer…                                                                                                                                                                                                                          | Voorbeeld                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **Handmatig**    | Een mens moet iets verifiëren, een afweging maken of een actie uitvoeren die OneUptime niet kan observeren.                                                                                                                                      | "Bevestig secundaire-regioverkeer op het load-balancer-dashboard."                        |
| **JavaScript**   | Je hebt een kleine, afgesloten berekening nodig — een configuratieservice bevragen, een payload transformeren, logica draaien vóór de volgende stap. Draait in sandbox op een [Runbook-agent](/docs/runbooks/agents) in je eigen infrastructuur. | Huidige replica-lag berekenen en beslissen of doorgegaan wordt.                           |
| **HTTP-verzoek** | Je roept een bestaande API aan — je eigen admin-endpoint, een cloudprovider, PagerDuty, Slack.                                                                                                                                                   | `POST` naar je failover-orchestrator.                                                     |
| **Bash**         | Je moet shell-commando's draaien op je eigen infrastructuur — een service herstarten, `kubectl` aanroepen, een deploy-script aanroepen. Vereist een [Runbook-agent](/docs/runbooks/agents) die in je omgeving is geïnstalleerd.                  | Een service herstarten, `kubectl rollout restart` draaien, een recovery-script aanroepen. |

Je kunt alle vier mixen in één runbook — de kracht van runbooks is dat je menselijke verificatie afwisselt met automatisering.

## Waar runbooks leven in het dashboard

| Pagina                                                                    | Wat je daar doet                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Analytics & Automation → Runbooks**                                     | Runbook-templates doorbladeren, aanmaken en bewerken.                                                       |
| **Het Steps-tabblad van een runbook**                                     | De staplijst schrijven en herordenen.                                                                       |
| **Het Executions-tabblad van een runbook**                                | Elke run van dit runbook zien met statusfilters.                                                            |
| **De "Nu uitvoeren"-knop van een runbook**                                | Een ad-hoc uitvoering starten die niet aan een event hangt.                                                 |
| **Incidents / Alerts / Scheduled Maintenance → Settings → Runbook Rules** | De auto-trigger-regels per entiteitstype aanmaken.                                                          |
| **Een incident / alert / onderhoudsmoment → Runbooks-tabblad**            | De uitvoeringen zien die aan dit event hangen, en klikken op **Runbook uitvoeren** voor een handmatige run. |

## Veelvoorkomende use cases

Een paar patronen waarvoor we teams runbooks zien gebruiken:

- **Database-failover** — Huidige status vastleggen met JavaScript, de dienstdoende DBA vragen om replicagezondheid te bevestigen (Handmatig), de orchestrator-API aanroepen (HTTP), "DNS bijgewerkt" afvinken (Handmatig), all-clear naar Slack posten (HTTP).
- **Cache flush** — Eén enkele HTTP-stap plus een Handmatige "bevestig dat de cache-hit rate herstelt op het dashboard".
- **Klant-impacterend incident** — Handmatig: "Statuspagina-update posten." HTTP: "CS-team in #customer-incidents informeren." JavaScript: "Lijst van getroffen accounts uit de interne API ophalen."
- **Pre-flight bij gepland onderhoud** — JavaScript: snapshot van huidige metrics. Handmatig: "Onderhoudsvenster bevestigen met stakeholders." HTTP: onderhoudsmodus aanzetten op de load balancer.
- **Always-run hygiëne** — Een regel met een leeg titelpatroon die bij elk incident de systeemstatus vastlegt, ongeacht wat — geweldig voor post-mortems.

## Een uitgewerkt voorbeeld

Stel dat je wilt dat elk incident met "db-primary" in de titel automatisch een vijfstaps DB-failover-runbook start.

**1. Maak het runbook aan.** Onder **Runbooks → Runbook aanmaken**, noem het "DB primary failover" en voeg deze stappen toe:

| #   | Type       | Titel                                               |
| --- | ---------- | --------------------------------------------------- |
| 1   | JavaScript | Pre-failover replica-lag vastleggen                 |
| 2   | Handmatig  | Bevestig replicagezondheid in DBA-dashboard         |
| 3   | HTTP       | `POST` naar failover-orchestrator                   |
| 4   | Handmatig  | Verifieer dat writes nu naar de nieuwe primary gaan |
| 5   | HTTP       | All-clear posten naar `#db-incidents` Slack         |

**2. Voeg een regel toe.** Onder **Incidents → Settings → Runbook Rules** maak je aan:

```
Title Pattern:  ^db-primary
Runbooks:       [DB primary failover]
```

**3. Triggeren.** Een monitoralarm opent incident `INC-4821 · db-primary connection timeout`. De regel matcht, er wordt een uitvoering aangemaakt, en:

- Stap 1 (JavaScript) draait meteen op de worker — zijn `return { lagMs: 412 }`-waarde wordt vastgelegd.
- Stap 2 (Handmatig) pauzeert de run. De dienstdoende ziet een "Wacht op jou"-label op de incidentpagina, klikt op het dashboard en vinkt de stap af.
- Stap 3 (HTTP) draait zodra stap 2 is afgevinkt — de `POST`-responsbody wordt vastgelegd.
- Stap 4 (Handmatig) pauzeert opnieuw.
- Stap 5 (HTTP) draait en de uitvoering eindigt.

**4. Auditeren.** De uitvoering blijft op het **Runbooks**-tabblad van het incident. De output van elke stap is één klik weg. Wanneer je volgende week de post-mortem schrijft, hoef je niet te vragen "wat gaf dat script terug?" — het staat er gewoon.

## Hoe runbooks samen werken met de rest van OneUptime

- **Monitors** openen incidenten en alerts; **runbook-regels** zetten die events om in runbook-uitvoeringen. Samen vormen ze een gesloten lus: detecteren → triggeren → reageren → vastleggen.
- **Workspace-verbindingen** (Slack, Microsoft Teams) zijn een natuurlijk doel voor runbook-HTTP-stappen — status-updates posten, kanalen informeren.
- **Statuspagina's** worden vaak als handmatige stap bijgewerkt in een klant-impacterend runbook.
- **Piketroosters** bepalen wie gepaged wordt; runbooks bepalen wat die persoon doet zodra hij wakker is.

## Waar verder lezen

- [Een runbook schrijven](/docs/runbooks/authoring) — runbooks maken, de vier staptypes en wat elke doet.
- [Runbook-regels](/docs/runbooks/rules) — runbooks automatisch koppelen aan incidenten, alerts en geplande onderhoudsmomenten.
- [Een runbook uitvoeren](/docs/runbooks/running) — handmatige triggers, de uitvoeringsweergave en hoe handmatige stappen samenwerken met geautomatiseerde.
- [Runbook-agents](/docs/runbooks/agents) — de agents installeren die Bash-stappen in je eigen infrastructuur uitvoeren.
- [Runbook-configuratie & veiligheid](/docs/runbooks/configuration) — outputlimieten, rechten, hardening-notities.
