# Workflows – Overzicht

Met Workflows automatiseer je taken in OneUptime zonder code te schrijven. Voeg een paar blokken toe aan een canvas, verbind ze met elkaar, en je hebt automatisering die draait zodra er iets gebeurt — een incident wordt geopend, een schema gaat af, of een andere tool stuurt gegevens naar OneUptime.

Zie workflows als achtergrondhulpjes voor je project: ze reageren op gebeurtenissen, praten met andere tools, en houden dingen stilletjes synchroon terwijl jij je op je werk richt.

## Wat je kunt doen met workflows

- **OneUptime koppelen aan je andere tools** — stuur incidenten naar Slack, maak Jira-tickets aan, post naar een webhook in je stack.
- **Reageren op wat er in OneUptime gebeurt** — wanneer een kritiek incident wordt aangemaakt, breng je het piketteam automatisch op de hoogte en open je automatisch een ticket.
- **Taken op een schema laten draaien** — elke vijf minuten, elke nacht, elke maandagochtend.
- **Gegevens van buitenaf ontvangen** — laat andere systemen via een unieke URL gegevens naar OneUptime pushen.
- **Veelgebruikte automatisering hergebruiken** — bouw het één keer, roep het aan vanuit elke andere workflow.

## Hoe een workflow werkt

Elke workflow bestaat uit drie onderdelen:

1. **Een trigger** — wat de workflow start. Dit kan een handmatige knop zijn, een schema, een inkomende webhook, of een gebeurtenis in OneUptime (zoals een nieuw incident).
2. **Een of meer componenten** — wat de workflow doet. Stuur een bericht, doe een HTTP-aanroep, voer een snelle controle uit, splits op basis van een voorwaarde.
3. **Verbindingen ertussen** — je trekt lijnen van het ene blok naar het volgende om de volgorde te bepalen.

Je bouwt dit allemaal visueel op een canvas. Voor de meeste workflows is geen code nodig, al kun je een stukje JavaScript toevoegen wanneer je dat nodig hebt.

## Kernbegrippen

| Term                     | Betekenis                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| **Workflow**             | De hele automatisering — een naam, een canvas, en een schakelaar om hem aan of uit te zetten.    |
| **Trigger**              | Het eerste blok. Het bepaalt wanneer de workflow draait. Elke workflow heeft precies één trigger. |
| **Component**            | Een actieblok — stuurt een bericht, doet een aanvraag, controleert een voorwaarde.               |
| **Run**                  | Eén uitvoering van de workflow. Opgeslagen met tijdstempels en de uitvoer van elk blok.          |
| **Globale variabele**    | Een waarde (zoals een API-sleutel) die je één keer opslaat en in elke workflow hergebruikt.       |

## Waar je workflows vindt in OneUptime

Open **Workflows** in de linkernavigatie. Die sectie bevat:

- **Workflows** — je lijst met workflows. Maak een nieuwe aan of open een bestaande.
- **Globale variabelen** — waarden die worden gedeeld tussen al je workflows.
- **Runs & logboeken** — uitvoeringsgeschiedenis van elke workflow in je project.

Open een enkele workflow en het eigen linkermenu bevat:

- **Overzicht** — naam, beschrijving, labels, en de schakelaar **Ingeschakeld**.
- **Bouwer** — het canvas waar je de workflow ontwerpt.
- **Workflow-variabelen** — waarden die alleen voor deze ene workflow gelden.
- **Runs & logboeken** — elke run van deze workflow, met details.
- **Instellingen** — webhookgeheim, dupliceren en exporteren.

## Je eerste workflow bouwen

1. **Aanmaken** — kies een startpunt en geef je workflow een naam.
2. **Kies een trigger** — handmatig, gepland, webhook, of een gebeurtenis vanuit OneUptime.
3. **Componenten toevoegen** — voeg acties toe aan het canvas en verbind ze.
4. **Zet hem aan** — schakel **Ingeschakeld** in op de pagina **Overzicht**. Een uitgeschakelde workflow kan helemaal niet draaien, ook niet met de hand.
5. **Testen** — klik op **Workflow uitvoeren** in de Bouwer en volg het runlogboek.

## Een kort voorbeeld

Stel dat je in Slack wilt posten zodra er een kritiek incident wordt aangemaakt:

1. Maak een workflow aan met de naam "Kritieke incidenten naar Slack."
2. Kies de trigger **On Create Incident**.
3. Voeg een blok **If / Else** toe. Stel het in om te controleren of de incidenttitel "Sev 1" bevat.
4. Voeg vanuit de tak **Yes** een **Slack**-blok toe. Kies het kanaal en schrijf het bericht.
5. Zet de workflow aan.

De volgende keer dat iemand een incident opent met "Sev 1" in de titel, licht Slack op.

## Hoe workflows aansluiten op de rest van OneUptime

- **Monitors** signaleren het probleem. **Incidenten** leggen het vast. **Workflows** reageren erop.
- **Runbooks** zijn stapsgewijze handleidingen voor mensen. Workflows zijn onbemande automatisering. Gebruik een runbook wanneer een mens beslissingen moet nemen; gebruik een workflow wanneer de stappen automatisch zijn.
- **Workspaceverbindingen** (Slack, Teams) zijn waar workflows hun berichten naartoe sturen.

## Waar je verder kunt lezen

- [Een workflow maken](/docs/workflows/authoring) — bouwen op het canvas.
- [Workflow-triggers](/docs/workflows/triggers) — de verschillende manieren waarop een workflow kan starten.
- [Workflow-componenten](/docs/workflows/components) — de bouwblokken die je kunt toevoegen.
- [Workflow-variabelen](/docs/workflows/variables) — waarden gebruiken tussen blokken en workflows.
- [Workflow-uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — nagaan wat er gebeurd is.
- [Workflow-configuratie en veiligheid](/docs/workflows/configuration) — instellingen die het waard zijn om te kennen.
