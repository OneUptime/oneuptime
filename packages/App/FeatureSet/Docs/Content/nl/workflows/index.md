# Workflows – Overzicht

Met workflows automatiseer je taken in OneUptime zonder code te schrijven. Zet een paar blokken op een canvas, verbind ze met elkaar, en je hebt automatisering die draait zodra er iets gebeurt — een incident gaat open, een schema gaat af, of een andere tool stuurt gegevens naar OneUptime.

Zie workflows als achtergrondhulpjes voor je project: ze reageren op gebeurtenissen, praten met andere tools en houden stilletjes alles gelijk terwijl jij je op je eigen werk richt.

## Wat je met workflows kunt doen

- **Verbind OneUptime met je andere tools** — stuur incidenten naar Slack, maak Jira-tickets aan, plaats iets op een webhook in je eigen stack.
- **Reageer op wat er in OneUptime gebeurt** — wordt er een kritiek incident aangemaakt, waarschuw dan het piketteam en open automatisch een ticket.
- **Draai taken volgens een schema** — elke vijf minuten, elke nacht, elke maandagochtend.
- **Ontvang gegevens van buiten** — laat andere systemen data naar OneUptime sturen via een unieke URL.
- **Hergebruik veelvoorkomende automatisering** — bouw het één keer en roep het aan vanuit elke andere workflow.

## Hoe een workflow werkt

Elke workflow bestaat uit drie delen:

1. **Een trigger** — wat de workflow start. Dat kan een handmatige knop zijn, een schema, een inkomende webhook, of een gebeurtenis in OneUptime (zoals een nieuw incident).
2. **Een of meer componenten** — wat de workflow doet. Een bericht sturen, een HTTP-aanroep doen, een snelle controle uitvoeren, vertakken op basis van een voorwaarde.
3. **Verbindingen ertussen** — je trekt lijnen van het ene blok naar het volgende om de volgorde te bepalen.

Dit alles bouw je visueel op een canvas. Voor de meeste workflows komt er geen code aan te pas, al kun je er een stukje JavaScript aan toevoegen wanneer dat nodig is.

## Kernbegrippen

| Begrip              | Wat het betekent                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Workflow**        | De hele automatisering — een naam, een canvas en een schakelaar om hem aan of uit te zetten.  |
| **Trigger**         | Het eerste blok. Het bepaalt wanneer de workflow draait. Elke workflow heeft precies één trigger. |
| **Component**       | Een actieblok — stuurt een bericht, doet een verzoek, controleert een voorwaarde.             |
| **Run**             | Eén uitvoering van de workflow. Bewaard met tijdstempels en de uitvoer van elk blok.          |
| **Globale variabele** | Een waarde (zoals een API-sleutel) die je één keer opslaat en in elke workflow hergebruikt.  |

## Waar je workflows vindt in OneUptime

Open **Workflows** in de linkernavigatie. Die sectie bevat:

- **Workflows** — je lijst met workflows. Maak een nieuwe aan of open een bestaande.
- **Globale variabelen** — waarden die je deelt over al je workflows.
- **Runs & logboeken** — de uitvoeringsgeschiedenis van elke workflow in je project.

Open je één workflow, dan bevat het eigen linkermenu:

- **Overzicht** — naam, beschrijving, labels en de schakelaar **Ingeschakeld**.
- **Bouwer** — het canvas waarop je de workflow ontwerpt.
- **Workflow-variabelen** — waarden die alleen voor deze ene workflow gelden.
- **Runs & logboeken** — elke uitvoering van deze workflow, met details.
- **Instellingen** — webhook-secret, dupliceren en exporteren.

## Je eerste workflow bouwen

1. **Aanmaken** — kies een startpunt en geef je workflow een naam.
2. **Kies een trigger** — handmatig, gepland, webhook, of een gebeurtenis uit OneUptime.
3. **Voeg componenten toe** — zet acties op het canvas en verbind ze.
4. **Zet hem aan** — schakel **Ingeschakeld** in op de pagina **Overzicht**. Een uitgeschakelde workflow kan helemaal niet draaien, ook niet met de hand.
5. **Test** — klik op **Workflow uitvoeren** in de Bouwer en kijk mee in het runlogboek.

## Een kort voorbeeld

Stel dat je in Slack wilt posten zodra er een kritiek incident wordt aangemaakt:

1. Maak een workflow met de naam "Kritieke incidenten naar Slack".
2. Kies de trigger **On Create Incident**.
3. Voeg een blok **If / Else** toe. Stel het zo in dat het controleert of de incidenttitel "Sev 1" bevat.
4. Voeg vanaf de tak **Yes** een **Slack**-blok toe. Kies het kanaal en schrijf het bericht.
5. Zet de workflow aan.

De eerstvolgende keer dat iemand een incident opent met "Sev 1" in de titel, licht Slack op.

## Hoe workflows passen bij de rest van OneUptime

- **Monitoren** signaleren het probleem. **Incidenten** leggen het vast. **Workflows** reageren erop.
- **Runbooks** zijn stap-voor-stap-gidsen voor mensen. Workflows zijn onbemande automatisering. Gebruik een runbook wanneer een mens moet beslissen; gebruik een workflow wanneer de stappen vanzelf gaan.
- **Workspace-verbindingen** (Slack, Teams) zijn de plek waar workflows hun berichten naartoe sturen.

## Waar je verder kunt lezen

- [Een workflow maken](/docs/workflows/authoring) — bouwen op het canvas.
- [Workflow-triggers](/docs/workflows/triggers) — de verschillende manieren waarop een workflow kan starten.
- [Workflow-componenten](/docs/workflows/components) — de bouwblokken die je kunt toevoegen.
- [Workflow-variabelen](/docs/workflows/variables) — waarden gebruiken tussen blokken en workflows.
- [Workflow-uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — nagaan wat er gebeurd is.
- [Workflow-configuratie en veiligheid](/docs/workflows/configuration) — instellingen die het waard zijn om te kennen.
