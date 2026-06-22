# Workflows – Overzicht

Met workflows automatiseer je taken in OneUptime zonder code te schrijven. Sleep een paar blokken op een canvas, verbind ze met elkaar en je hebt automatisering die afgaat zodra er iets gebeurt — er wordt een incident geopend, een schedule gaat af, of een andere tool stuurt data naar OneUptime.

Zie workflows als achtergrondhelpers voor je project: ze reageren op events, praten met andere tools en houden dingen stilletjes synchroon terwijl jij je op je werk concentreert.

## Wat je met workflows kunt doen

- **Koppel OneUptime aan je andere tools** — stuur incidenten naar Slack, maak Jira-tickets aan, post naar een webhook in je stack.
- **Reageer op wat er in OneUptime gebeurt** — wanneer er een kritiek incident wordt aangemaakt, breng je het oncall-team automatisch op de hoogte en open je een ticket.
- **Voer taken uit op een schema** — elke vijf minuten, elke nacht, elke maandagochtend.
- **Ontvang data van buitenaf** — laat andere systemen data naar OneUptime sturen via een unieke URL.
- **Hergebruik veelvoorkomende automatisering** — bouw het één keer, roep het aan vanuit elke andere workflow.

## Hoe een workflow werkt

Elke workflow bestaat uit drie delen:

1. **Een trigger** — wat de workflow start. Dit kan een handmatige knop zijn, een schedule, een inkomende webhook of een event in OneUptime (zoals een nieuw incident).
2. **Eén of meer componenten** — wat de workflow doet. Een bericht versturen, een HTTP-aanroep doen, een snelle check uitvoeren, vertakken op basis van een voorwaarde.
3. **Verbindingen daartussen** — je trekt lijnen van het ene blok naar het volgende om de volgorde te bepalen.

Dit alles bouw je visueel op een canvas. Voor de meeste workflows is geen code nodig, al kun je een stukje JavaScript invoegen wanneer dat nodig is.

## Kernbegrippen

| Term                  | Betekenis                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| **Workflow**          | De hele automatisering — een naam, een canvas en een schakelaar om hem aan of uit te zetten.      |
| **Trigger**           | Het eerste blok. Het bepaalt wanneer de workflow draait. Elke workflow heeft precies één trigger. |
| **Component**         | Een actieblok — verstuurt een bericht, doet een verzoek, controleert een voorwaarde.              |
| **Run**               | Eén uitvoering van de workflow. Opgeslagen met tijdstippen en de output van elk blok.             |
| **Globale variabele** | Een waarde (zoals een API-sleutel) die je één keer opslaat en in elke workflow hergebruikt.       |

## Waar je workflows in OneUptime vindt

Open **Workflows** in de linkernavigatie. Vanaf daar:

- **Workflows** — je lijst met workflows. Maak een nieuwe aan of open een bestaande.
- **Builder-tabblad** — het canvas waar je de workflow ontwerpt.
- **Logs-tabblad** — elke run van deze workflow, met details.
- **Settings-tabblad** — naam, beschrijving, eigenaren, labels, in-/uitschakelen.
- **Global Variables** — waarden die je deelt over al je workflows.
- **Runs & Logs** — uitvoeringsgeschiedenis voor elke workflow in je project.

## Je eerste workflow bouwen

1. **Aanmaken** — geef je workflow een naam en een korte beschrijving.
2. **Trigger kiezen** — handmatig, gepland, webhook of een event uit OneUptime.
3. **Componenten toevoegen** — sleep acties op het canvas en verbind ze.
4. **Testen** — klik op **Run Manually** en kijk in de logs wat er gebeurt.
5. **Inschakelen** — zet de schakelaar **Enabled** om in Settings als je er klaar voor bent.

## Een snel voorbeeld

Stel dat je in Slack wilt posten zodra er een kritiek incident wordt aangemaakt:

1. Maak een workflow aan met de naam "Critical incidents to Slack".
2. Kies de trigger **Incident → On Create**.
3. Voeg een **Conditions**-blok toe. Stel het in om te controleren of de incidenttitel "Sev 1" bevat.
4. Voeg vanuit de **Yes**-tak een **Slack**-blok toe. Kies het kanaal en schrijf het bericht.
5. Zet de workflow aan.

De volgende keer dat iemand een incident opent met "Sev 1" in de titel, licht Slack op.

## Hoe workflows passen bij de rest van OneUptime

- **Monitors** signaleren het probleem. **Incidenten** registreren het. **Workflows** reageren erop.
- **Runbooks** zijn stap-voor-stap-gidsen voor mensen. Workflows zijn onbeheerde automatisering. Gebruik een runbook wanneer een mens beslissingen moet nemen; gebruik een workflow wanneer de stappen automatisch zijn.
- **Workspace-verbindingen** (Slack, Teams) zijn waar workflows hun berichten naartoe sturen.

## Waar verder lezen

- [Een workflow maken](/docs/workflows/authoring) — bouwen op het canvas.
- [Triggers](/docs/workflows/triggers) — de verschillende manieren waarop een workflow kan starten.
- [Componenten](/docs/workflows/components) — de bouwstenen die je kunt toevoegen.
- [Variabelen](/docs/workflows/variables) — waarden gebruiken over blokken en workflows heen.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — controleren wat er is gebeurd.
- [Configuratie en veiligheid](/docs/workflows/configuration) — instellingen die de moeite waard zijn om te kennen.
