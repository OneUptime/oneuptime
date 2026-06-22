# Een workflow maken

Om een workflow te maken, open je **Workflows → Create Workflow**, geef je hem een naam en klik je op het **Builder**-tabblad. Je ziet een leeg canvas waarop je de automatisering bouwt.

## Het canvas

De Builder is een drag-and-drop-canvas. Je voegt blokken toe vanuit het palet aan de zijkant, verbindt ze met lijnen en klikt op elk blok om te configureren wat het doet. Wijzigingen worden automatisch opgeslagen — een indicator bovenaan laat zien wanneer ze opgeslagen zijn.

Elke workflow begint met één **trigger** aan het begin. Al het andere is een **component** dat iets doet.

## Wat er op een blok staat

| Veld         | Wat het doet                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Titel**    | De naam die op het canvas wordt weergegeven. Hernoem hem om complexe workflows beter leesbaar te maken.                                                                              |
| **Settings** | Wat het blok nodig heeft om zijn werk te doen — een URL, een Slack-kanaal, een berichttekst, enz. Verplichte velden zijn gemarkeerd met een asterisk.                                |
| **Input**    | De stip aan de linkerkant waar lijnen binnenkomen van eerdere blokken.                                                                                                               |
| **Outputs**  | De stippen aan de rechterkant waar lijnen vertrekken naar de volgende blokken. Veel blokken hebben aparte **success**- en **error**-outputs zodat je beide gevallen kunt afhandelen. |

## Blokken verbinden

Sleep van de output-stip van een blok naar de input-stip van het volgende blok. De lijn die je trekt bepaalt wat er als volgende draait.

- Als je vanuit **success** verbindt, draait het volgende blok alleen wanneer het vorige is geslaagd.
- Als je vanuit **error** verbindt, draait het volgende blok alleen wanneer het vorige is gefaald.
- Als je een output niet verbindt, stopt dat pad gewoon.

Je kunt één output met meerdere blokken verbinden. Die draaien vanaf dat punt allemaal tegelijk.

## Een blok configureren

Klik op een blok om zijn instellingen aan de zijkant te openen. Elke instelling heeft het juiste soort invoer — tekstvelden, dropdowns, code-editors, toggles, enzovoort.

De meeste tekstvelden accepteren variabelen — zo stroomt data van het ene blok naar het volgende. Zie [Variabelen](/docs/workflows/variables) voor de syntax.

## Je eerste workflow

De snelste manier om een gevoel voor het canvas te krijgen:

1. Sleep een **Manual**-trigger op het canvas.
2. Sleep een **Log**-component (onder **Utils**) ernaast. Verbind de trigger met de Log-component.
3. Typ in het berichtveld van het Log-blok `Hello from {{Manual.JSON.name}}`.
4. Sla op en schakel de workflow in.
5. Klik op **Run Manually**, plak `{ "name": "Ada" }` als input en verstuur.
6. Open het **Logs**-tabblad. De nieuwste run laat `Hello from Ada` zien.

Die cyclus — slepen, verbinden, configureren, draaien, log controleren — is hoe je elke workflow bouwt.

## Opslaan en aanzetten

Het canvas slaat op terwijl je werkt. Er is geen aparte "publish"-stap.

Maar een workflow draait pas echt wanneer **Enabled** aanstaat in Settings. Nieuwe workflows starten uitgeschakeld. Gebruik die schakelaar als je vangnet — bouw het, test met **Run Manually**, controleer de logs en zet hem dan aan.

Om een workflow te pauzeren zonder hem te verwijderen, zet je **Enabled** uit. Runs die al bezig zijn worden afgerond; er starten geen nieuwe.

## Opruimen

- Sleep blokken om ze te verplaatsen. De layout wordt opgeslagen zodat de volgende persoon dezelfde indeling ziet.
- Rechtsklik op een lijn om hem te verwijderen. Rechtsklik op een blok om het te verwijderen of te dupliceren.
- Voor brede workflows: leg ze van links naar rechts uit, zodat ze in de richting lezen waarin ze draaien.

## Waar verder lezen

- [Triggers](/docs/workflows/triggers) — de vier manieren waarop een workflow kan starten.
- [Componenten](/docs/workflows/components) — elk blok dat je kunt toevoegen.
- [Variabelen](/docs/workflows/variables) — data tussen blokken verplaatsen.
- [Uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — controleren wat er is gebeurd.
