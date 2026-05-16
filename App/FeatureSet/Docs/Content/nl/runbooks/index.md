# Runbooks – Overzicht

Runbooks zijn herbruikbare responseprocedures — geordende lijsten van handmatige of geautomatiseerde stappen — die je koppelt aan incidenten, alerts of geplande onderhoudsmomenten. Ze veranderen ad-hoc Slack-threads van het type "wat doen we nu?" in iets dat een collega om 3 uur 's nachts koud kan oppikken.

## In één oogopslag

- **Top-level functie** in het OneUptime-dashboard onder **Analyse & Automatisering → Runbooks**.
- **Vier staptypen**: handmatige checklist, JavaScript (sandbox) en Bash (beide draaien op een [Runbook-agent](/docs/runbooks/agents) in je eigen infrastructuur), HTTP-verzoek.
- **Drie triggerpaden**: regels die overeenkomen met incidenten/alerts/gepland onderhoud, of de handmatige knop "Runbook uitvoeren" op elk event.
- **Snapshot-semantiek**: zodra een runbook start, worden zijn stappen naar de uitvoering gekopieerd. Het sjabloon later bewerken verandert nooit een lopende uitvoering.
- **Volledig auditspoor**: status, uitvoer, foutmelding en duur van elke stap worden voor altijd in de uitvoering bewaard.

## Waarom runbooks gebruiken?

Incidentrespons is vaak het verschil tussen een minuutje storing en een uitval van uren. Runbooks helpen je om:

- **Stille kennis vast te leggen** — het antwoord op "wat doen we als de wachtrij vol loopt?" staat ergens waar je team het kan vinden.
- **De gemiddelde hersteltijd (MTTR) te verlagen** — geautomatiseerde stappen lopen in seconden; handmatige stappen halen besluiteloosheid weg.
- **Responsacties te auditen** — elke uitgevoerde stap, elke uitvoer, elke klik van de responder wordt geregistreerd op de uitvoering.
- **Junioren handelingsbekwaam te maken** — ze kunnen een runbook met vertrouwen draaien in plaats van om 3 uur 's nachts een senior te bellen.
- **Postmortems uit data te schrijven, niet uit herinnering** — de vastgelegde uitvoering is een bevroren weergave van wat er werkelijk gebeurde.

## Sleutelbegrippen

Een paar begrippen komen telkens terug in de overige runbookdocumentatie. Maak die eerst helder:

| Begrip | Betekenis |
| --- | --- |
| **Runbook** | Het sjabloon. Een benoemde, herbruikbare procedure met een geordende lijst stappen en een `isEnabled`-vlag. |
| **Stap** | Eén item in een runbook. Heeft een type (Handmatig / JavaScript / HTTP / Bash), een titel, een beschrijving en typespecifieke configuratie. |
| **Runbook-regel** | Een patroon dat één of meer runbooks automatisch koppelt aan incidenten, alerts of gepland onderhoud zodra titel of beschrijving op een regex matchen. |
| **Uitvoering** | Eén run van een runbook. Wordt aangemaakt als een regel afgaat, als iemand "Runbook uitvoeren" op een event klikt, of als iemand op "Nu uitvoeren" klikt op het runbook zelf. Bevat een snapshot van de stappen en de status/uitvoer per stap. |
| **Snapshot** | De bevroren kopie van de stappen van het runbook die op elke uitvoering leeft. Hiermee kun je het sjabloon later bewerken zonder de geschiedenis te herschrijven. |

## De levenscyclus van een runbook

1. **Schrijven** — Maak een runbook, mix Handmatige, JavaScript-, HTTP- en Bash-stappen. Bewaar.
2. **(Optioneel) Regel toevoegen** — Bij de instellingen van Incidenten, Alerts of Gepland Onderhoud zeg je OneUptime dit runbook te starten zodra de titel of beschrijving van een event op een regex matcht.
3. **Triggeren** — Of de regel slaat automatisch aan bij een passend event, of een responder klikt handmatig **Runbook uitvoeren** op het event.
4. **Uitvoeren** — Een nieuwe uitvoering ontstaat met een snapshot van de stappen. Geautomatiseerde stappen draaien in de Runbook-worker; de uitvoering pauzeert bij elke handmatige stap totdat iemand hem aftikt.
5. **Auditen** — De uitvoering blijft voor altijd op het **Runbooks**-tabblad van het event en in de uitvoeringenlijst van het runbook. Uitvoer, fouten en tijden per stap blijven bewaard voor de postmortem.

## Welk staptype voor welk doel

Een snelle keuzehulp. De uitgebreide uitleg staat in [Een runbook schrijven](/docs/runbooks/authoring).

| Staptype | Gebruik wanneer… | Voorbeeld |
| --- | --- | --- |
| **Handmatig** | Een mens iets moet verifiëren, beoordelen of een actie moet uitvoeren die OneUptime niet kan waarnemen. | "Bevestig in het load balancer-dashboard dat verkeer naar de secundaire regio is verplaatst." |
| **JavaScript** | Je hebt een kleine, ingesloten berekening nodig — een config-service raadplegen, een payload transformeren, logica draaien vóór de volgende stap. Draait gesandboxed op een [Runbook-agent](/docs/runbooks/agents) in je eigen infrastructuur. | Huidige replicatievertraging berekenen en beslissen of je doorgaat. |
| **HTTP-verzoek** | Je roept een bestaande API aan — je eigen admin-endpoint, een cloudleverancier, PagerDuty, Slack. | `POST` naar je failover-orchestrator. |
| **Bash** | Je moet shell-commando's draaien in je eigen infrastructuur — een service herstarten, `kubectl` draaien, een deploy-script aanroepen. Vereist een [Runbook-agent](/docs/runbooks/agents) in je omgeving. | Service herstarten, `kubectl rollout restart`, een recovery-script draaien. |

Je kunt alle vier in één runbook combineren — de kracht van runbooks is het verweven van menselijke verificatie en automatisering.

## Waar runbooks in het dashboard wonen

| Pagina | Wat je er doet |
| --- | --- |
| **Analyse & Automatisering → Runbooks** | Door runbook-sjablonen bladeren, ze aanmaken en bewerken. |
| **Stappen-tabblad van een runbook** | De stappenlijst schrijven en herordenen. |
| **Uitvoeringen-tabblad van een runbook** | Elke run van dit runbook bekijken met statusfilters. |
| **Knop "Nu uitvoeren" van een runbook** | Een ad-hoc uitvoering starten die niet aan een event hangt. |
| **Incidenten / Alerts / Gepland Onderhoud → Instellingen → Runbook-regels** | De automatische triggerregels per entiteitstype aanmaken. |
| **Een incident / alert / onderhoudsevent → Runbooks-tabblad** | De aan dit event gekoppelde uitvoeringen zien en **Runbook uitvoeren** klikken voor een handmatige run. |

## Veelvoorkomende toepassingen

Een paar patronen waar teams runbooks voor inzetten:

- **Database failover** — Met JavaScript de huidige toestand vastleggen, de dienstdoende DBA de replicagezondheid laten bevestigen (Handmatig), de orchestrator-API aanroepen (HTTP), "DNS bijgewerkt" aftikken (Handmatig), het sein-veilig op Slack posten (HTTP).
- **Cache leegmaken** — Eén HTTP-stap plus een Handmatig "bevestig dat de cache-hitrate herstelt op het dashboard".
- **Incident met klantimpact** — Handmatig: "Update plaatsen op de statuspagina." HTTP: "CS-team informeren in #customer-incidents." JavaScript: "Lijst van getroffen accounts ophalen via de interne API."
- **Pre-flight voor gepland onderhoud** — JavaScript: huidige metrics in een snapshot zetten. Handmatig: "Wijzigingsvenster bevestigen met belanghebbenden." HTTP: onderhoudsmodus aanzetten op de load balancer.
- **Altijd-uitvoeren hygiëne** — Een regel met leeg titelpatroon die bij elk incident de systeemtoestand vastlegt — goud voor postmortems.

## Een uitgewerkt voorbeeld

Stel dat je wilt dat elk incident met "db-primary" in de titel automatisch een vijf-staps DB-failover-runbook start.

**1. Maak het runbook.** Onder **Runbooks → Runbook aanmaken** noem je het "DB primary failover" en voeg je deze stappen toe:

| # | Type | Titel |
| --- | --- | --- |
| 1 | JavaScript | Replicatievertraging vóór failover vastleggen |
| 2 | Handmatig | Replicagezondheid in DBA-dashboard bevestigen |
| 3 | HTTP | `POST` naar failover-orchestrator |
| 4 | Handmatig | Verifiëren dat schrijfacties naar de nieuwe primary gaan |
| 5 | HTTP | Sein-veilig posten op Slack `#db-incidents` |

**2. Voeg een regel toe.** Onder **Incidenten → Instellingen → Runbook-regels** maak je:

```
Titelpatroon:  ^db-primary
Runbooks:      [DB primary failover]
```

**3. Trigger.** Een monitor-alert opent incident `INC-4821 · db-primary connection timeout`. De regel matcht, een uitvoering ontstaat, en:

- Stap 1 (JavaScript) draait direct op de worker — `return { lagMs: 412 }` wordt vastgelegd.
- Stap 2 (Handmatig) pauzeert de run. De dienstdoende ziet "Wacht op jou" op de incidentpagina, kijkt in het dashboard en tikt de stap af.
- Stap 3 (HTTP) start zodra stap 2 is afgetikt — de body van de `POST`-respons wordt vastgelegd.
- Stap 4 (Handmatig) pauzeert opnieuw.
- Stap 5 (HTTP) draait en de uitvoering eindigt.

**4. Auditen.** De uitvoering blijft op het **Runbooks**-tabblad van het incident staan. De uitvoer van elke stap is één klik weg. Als je volgende week de postmortem schrijft, hoef je niet te vragen "wat gaf dat script terug?" — het staat er gewoon.

## Hoe runbooks bij de rest van OneUptime passen

- **Monitors** openen incidenten en alerts; **runbook-regels** zetten die events om in runbook-uitvoeringen. Samen vormen ze een gesloten lus: detecteren → triggeren → reageren → vastleggen.
- **Workspace-koppelingen** (Slack, Microsoft Teams) zijn een natuurlijk doel voor HTTP-stappen — statusupdates plaatsen, kanalen informeren.
- **Statuspagina's** worden vaak via een handmatige stap in een klantgericht runbook bijgewerkt.
- **Wachtdienstplanningen** bepalen wie wordt gepiept; runbooks bepalen wat die persoon doet zodra hij wakker is.

## Verder lezen

- [Een runbook schrijven](/docs/runbooks/authoring) — runbooks aanmaken, de vier staptypen en wat elk doet.
- [Runbook-regels](/docs/runbooks/rules) — runbooks automatisch koppelen aan incidenten, alerts en gepland onderhoud.
- [Een runbook uitvoeren](/docs/runbooks/running) — handmatige triggers, het uitvoeringsoverzicht en hoe handmatige stappen samenwerken met geautomatiseerde.
- [Runbook-agents](/docs/runbooks/agents) — de agents installeren die Bash-stappen in je eigen infrastructuur uitvoeren.
- [Configuratie & veiligheid](/docs/runbooks/configuration) — uitvoerlimieten, rechten, hardening-notities.
