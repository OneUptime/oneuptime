# Een workflow maken

Om een workflow te maken open je **Workflows** en klik je op **Workflow maken**. Een wizard met de titel **Create a workflow** loodst je erdoorheen: eerst **Start from** — kies **Start from scratch** of een van de sjablonen — dan **Naam**, en tot slot een stap **Configureren**, die alleen verschijnt wanneer het gekozen sjabloon om eigen instellingen vraagt.

Zodra hij bestaat, open je **Bouwer** in het linkermenu. Dat is het canvas waarop je de workflow ontwerpt.

## Het canvas

Een workflow die je vanaf nul begint, opent met één gestippeld blok met de tekst **Please click here to add trigger**. Dat blok is het startpunt — klik erop om een trigger te kiezen. Een workflow uit een sjabloon opent met de blokken al op hun plek.

Elke workflow heeft precies één **trigger** bovenaan. Al het andere is een **component** dat iets doet. Voeg je een tweede trigger toe, dan vervangt die de eerste; verwijder je de laatste, dan komt het gestippelde blok terug.

Blokken toevoegen:

- **De trigger** — klik op het gestippelde blok. Er opent een paneel met de titel **Add Trigger**.
- **Al het andere** — klik op **Component toevoegen** in de werkbalk boven het canvas. Hetzelfde paneel opent, nu met de titel **Component toevoegen**.

In beide panelen kun je zoeken — druk op `/` om naar het zoekveld te springen — en alles staat gegroepeerd per categorie. Selecteer één blok en klik op **Add to Workflow**.

Nieuwe blokken landen altijd op dezelfde plek op het canvas, dus een nieuw blok kan boven op iets vallen wat je al had neergezet. Sleep het vrij; het canvas klikt onderweg vast op een raster. Blokposities worden bewaard, dus de volgende persoon ziet dezelfde indeling als jij achterliet.

Wijzigingen worden automatisch opgeslagen. Een pil in de werkbalk houdt dat bij: **Saving…** zolang de wijziging onderweg is, daarna **Opgeslagen**, of **Kon niet opslaan** als het misging. Er is geen opslaanknop en geen aparte publicatiestap.

## Wat er op een blok staat

| Veld                          | Wat het doet                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (onder **ID**) | De korte id die op het blok staat, zoals `log-1`. Andere blokken verwijzen hiermee naar dit blok, dus hernoemen breekt elke `{{local.components.…}}`-verwijzing die ernaartoe wijst. De kop van het blok is de eigen naam van het component en kun je niet wijzigen. |
| **Instellingen**              | Wat het blok nodig heeft om zijn werk te doen — een URL, een Slack-kanaal, een berichttekst. Optionele velden dragen het label **(Optional)**; al het andere is verplicht. Minder gebruikte instellingen zitten achter een uitklapbare **Geavanceerd**. |
| **Input**                     | De stip op de bovenrand, waar lijnen vanaf eerdere blokken binnenkomen. Triggers hebben er geen — er draait niets vóór hen.                                                                                  |
| **Outputs**                   | De stippen langs de onderrand, met hun label er net boven, waar lijnen naar de volgende blokken vertrekken. Veel blokken hebben aparte uitgangen **Succes** en **Fout**, zodat je beide gevallen kunt afhandelen. |

## Blokken verbinden

Sleep van een stip onderaan het ene blok omlaag naar de stip bovenaan het volgende. De lijn die je trekt, bepaalt wat er daarna draait.

- Verbind je vanaf **Succes**, dan draait het volgende blok alleen als het vorige lukte.
- Verbind je vanaf **Fout**, dan draait het volgende blok alleen als het vorige mislukte.
- Verbind je een uitgang niet, dan houdt dat pad daar simpelweg op.

Je kunt één uitgang met meerdere blokken verbinden. Ze draaien allemaal — maar na elkaar, in één wachtrij, niet parallel. Reken niet op de volgorde tussen takken, en ga er niet van uit dat ze in de tijd overlappen. Elk blok draait hooguit één keer per run, dus een lijn terug naar een eerder blok laat dat blok niet nog eens draaien.

## Een blok instellen

Klik op een blok om zijn instellingen in een dialoogvenster te openen. Elke instelling heeft het passende soort invoer — tekstvelden, keuzelijsten, code-editors, schakelaars, enzovoort. Vul het in en klik op **Opslaan**.

In datzelfde venster vind je ook:

- **Verwijderen** — haal dit blok weg.
- **Run just this step** — draai alleen dit ene blok, zonder de rest van de workflow. Waarden die het uit andere stappen zou lezen, komen leeg binnen, en alles wat het verstuurt, schrijft of verwijdert gebeurt echt.
- **Documentatie**, **Inputs**, **Outputs** en **Returns** — referentiekaarten met wat dit blok verwacht en oplevert.

De meeste tekstvelden accepteren variabelen — zo stroomt data van het ene blok naar het volgende. Typ de syntaxis niet met de hand, maar gebruik de waardekiezer in de editor: die bouwt een correcte verwijzing uit het blok en het veld dat je aanwijst. Zie [Workflow-variabelen](/docs/workflows/variables).

## Controles tijdens het bouwen

De Bouwer controleert bij elke wijziging de hele graaf en meldt wat hij vindt in een pil in de werkbalk. Klik op de pil om **Problems with this workflow** te openen: daar staat elk probleem, met een sprong naar het blok dat het veroorzaakt. Blokken met een probleem krijgen ook een rode badge op het canvas.

Hij vangt de fouten die anders onzichtbaar blijven tot een run misgaat — geen trigger, twee blokken met dezelfde id, een punt in een id, een blok waar niets naartoe loopt, een verplichte instelling die leeg bleef, ongeldige JSON, spaties binnen `{{ }}`, en verwijzingen naar een stap of retourwaarde die niet bestaat.

Eén ding kan hij niet controleren: of een variabelenaam bestaat. Een hernoemde variabele merk je pas in het runlogboek.

## Je eerste workflow

De snelste manier om het canvas te leren kennen:

1. Klik op het gestippelde blok, kies **Manual** in het paneel **Add Trigger** en klik op **Add to Workflow**.
2. Klik op **Component toevoegen**, kies **Log** (onder **Utils**) en klik op **Add to Workflow**. Sleep het nieuwe blok weg bij de trigger en verbind daarna de stip **Execute** van de trigger met de invoerstip van het Log-blok.
3. Open het Log-blok en zet zijn **Waarde** op `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` is de **Identifier** van de trigger, te zien op het triggerblok — controleer of die klopt.
4. Ga naar **Overzicht**, klik op **Workflow bewerken** op de kaart **Workflow-details** en zet **Ingeschakeld** aan. Een uitgeschakelde workflow kan helemaal niet draaien, ook niet met de hand.
5. Terug in de **Bouwer** klik je op **Workflow uitvoeren**, zet je `{ "name": "Ada" }` in het veld **JSON**, klik je op **Run Workflow Manually** en bevestig je met **Run**.
6. Er opent vanzelf een paneel **Workflow Run** dat de uitvoering volgt. Het logboek toont `Value:` gevolgd door `Hello from Ada`.

Die cyclus — toevoegen, verbinden, instellen, draaien, het logboek lezen — is hoe je elke workflow bouwt.

## Hem aanzetten

Nieuwe workflows beginnen uitgeschakeld, en dat geldt ook voor elke workflow die je dupliceert of importeert.

De schakelaar **Ingeschakeld** staat op de pagina **Overzicht** van de workflow, in de kaart **Workflow-details** — niet op de pagina Instellingen. Diezelfde kaart toont de huidige stand als een groene pil **Ingeschakeld** of een rode pil **Uitgeschakeld**.

Een uitgeschakelde workflow kan helemaal niet draaien. Handmatige uitvoeringen worden net zo goed geweigerd met "This workflow is not enabled" als getriggerde, dus de volgorde is: zet hem aan, test hem met **Workflow uitvoeren**, lees het runlogboek, en zet **Ingeschakeld** weer uit als je nog niet klaar bent om zijn trigger te laten afgaan. Wil je één blok testen zonder het geheel te draaien, gebruik dan **Run just this step** in de instellingen van dat blok.

Wil je een workflow pauzeren zonder hem te verwijderen, zet **Ingeschakeld** dan uit. Er starten geen nieuwe uitvoeringen. Een run die al bezig is, maakt hij af, maar een run die geparkeerd staat op een **Sleep**-blok wordt bij het ontwaken geannuleerd en als fout vastgelegd.

## Opruimen

- Sleep blokken om ze te verplaatsen. De indeling wordt bewaard.
- Wil je een lijn verwijderen, sleep dan een van de uiteinden van de stip af en laat het los op leeg canvas.
- Wil je een blok verwijderen, klik het dan aan en gebruik **Verwijderen** onderaan zijn instellingenvenster. Een blok of lijn selecteren en op Backspace drukken werkt ook.
- Eén los blok dupliceren kan niet. **Duplicate Workflow** op de pagina **Instellingen** van de workflow kopieert het geheel, en de kopie komt uitgeschakeld binnen.
- Stapel blokken van boven naar beneden, zodat ze lezen in de richting waarin ze draaien — invoer zit op de bovenrand, uitgangen op de onderrand, dus de stroom loopt vanzelf omlaag.

## Waar je verder kunt lezen

- [Workflow-triggers](/docs/workflows/triggers) — de vier manieren waarop een workflow kan starten.
- [Workflow-componenten](/docs/workflows/components) — elk blok dat je kunt toevoegen.
- [Workflow-variabelen](/docs/workflows/variables) — data verplaatsen tussen blokken.
- [Workflow-uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — nagaan wat er gebeurd is.
