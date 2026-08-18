# Een workflow maken

Om een workflow te maken, open je **Workflows** en klik je op **Create Workflow**. Een wizard genaamd **Create a workflow** leidt je erdoorheen: eerst **Start from** — kies **Start from scratch** of een van de sjablonen — dan **Name**, en tot slot een stap **Configure**, die alleen verschijnt wanneer het gekozen sjabloon om eigen instellingen vraagt.

Eenmaal aangemaakt, open je **Bouwer** in het linkermenu. Dat is het canvas waar je de workflow ontwerpt.

## Het canvas

Een workflow die vanaf nul begint, opent met één gestippeld blok met de tekst **Please click here to add trigger**. Dat blok is het startpunt — klik erop om een trigger te kiezen. Een workflow die is aangemaakt vanuit een sjabloon, opent met zijn blokken al op hun plek.

Elke workflow heeft precies één **trigger** bovenaan. Al het andere is een **component** dat iets doet. Een tweede trigger toevoegen vervangt de eerste, en de laatste verwijderen zet de gestippelde placeholder terug.

Blokken toevoegen:

- **De trigger** — klik op het gestippelde placeholderblok. Een paneel getiteld **Add Trigger** opent.
- **Al het andere** — klik op **Add Component** in de werkbalk boven het canvas. Hetzelfde paneel opent, nu getiteld **Add Component**.

Beide panelen zijn doorzoekbaar — druk op `/` om naar het zoekvak te springen — en gegroepeerd per categorie. Selecteer één blok en klik op **Add to Workflow**.

Nieuwe blokken belanden altijd op dezelfde plek op het canvas, dus een nieuwe kan boven op iets vallen dat je al had geplaatst. Sleep hem vrij; het canvas klikt vast op een raster terwijl je bezig bent. Blokposities worden opgeslagen, zodat de volgende persoon dezelfde indeling ziet die jij hebt achtergelaten.

Wijzigingen worden automatisch opgeslagen. Een pil in de werkbalk houdt dat bij: **Saving…** terwijl de wijziging onderweg is, dan **Saved**, of **Could not save** als het niet lukte. Er is geen Opslaan-knop en geen aparte publicatiestap.

## Wat er op een blok staat

| Veld                          | Wat het doet                                                                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (onder **ID**) | De korte id die op het blok wordt getoond, zoals `log-1`. Zo verwijzen andere blokken naar dit blok, dus als je het hernoemt, breekt elke verwijzing `{{local.components.…}}` die ernaar wijst. De koptekst van het blok is de eigen naam van het component en kan niet worden gewijzigd. |
| **Settings**                  | Wat het blok nodig heeft om zijn werk te doen — een URL, een Slack-kanaal, een berichttekst. Optionele velden zijn gelabeld **(Optional)**; al het andere is verplicht. Minder gebruikte instellingen zitten achter een uitklapper **Advanced**. |
| **Input**                     | De stip aan de bovenrand, waar lijnen binnenkomen vanaf eerdere blokken. Triggers hebben er geen — er draait niets vóór hen.                                                                              |
| **Outputs**                   | De stippen langs de onderrand, gelabeld er net boven, waar lijnen naar de volgende blokken vertrekken. Veel blokken hebben aparte uitgangen **Success** en **Error**, zodat je beide gevallen kunt afhandelen. |

## Blokken verbinden

Sleep vanaf een stip aan de onderkant van het ene blok naar de stip aan de bovenkant van het volgende. De lijn die je trekt bepaalt wat er hierna draait.

- Als je verbindt vanaf **Success**, draait het volgende blok alleen wanneer het eerdere blok slaagde.
- Als je verbindt vanaf **Error**, draait het volgende blok alleen wanneer het eerdere blok mislukte.
- Als je een uitgang niet verbindt, stopt dat pad daar gewoon.

Je kunt één uitgang met meerdere blokken verbinden. Ze draaien allemaal — maar na elkaar, in één wachtrij, niet parallel. Vertrouw niet op de volgorde tussen takken, en reken er niet op dat ze in de tijd overlappen. Elk blok draait hoogstens één keer per run, dus een lus terug naar een eerder blok laat dat blok niet twee keer draaien.

## Een blok configureren

Klik op een blok om zijn instellingen te openen in een dialoogvenster. Elke instelling heeft het juiste type invoerveld — tekstvelden, dropdowns, code-editors, schakelaars, enzovoort. Vul het in en klik op **Opslaan**.

In hetzelfde dialoogvenster vind je ook:

- **Delete** — verwijder dit blok.
- **Run just this step** — voer alleen dit ene blok uit, zonder de rest van de workflow. Waarden die het van andere stappen zou hebben gelezen, komen leeg binnen, en alles wat het verstuurt, schrijft of verwijdert gebeurt echt.
- **Documentation**, **Inputs**, **Outputs** en **Returns** — referentiekaarten voor wat dit blok verwacht en oplevert.

De meeste tekstvelden accepteren variabelen — zo stroomt data van het ene blok naar het volgende. Typ de syntax niet met de hand, maar gebruik de waardekiezer in de editor: die bouwt een correcte verwijzing op basis van het blok en veld dat je kiest. Zie [Workflow-variabelen](/docs/workflows/variables).

## Controles terwijl je bouwt

De Bouwer controleert de hele graaf telkens wanneer je iets wijzigt, en meldt wat hij vindt in een pil in de werkbalk. Klik op de pil om **Problems with this workflow** te openen, die elk probleem oplijst en je naar het verantwoordelijke blok springt. Blokken met een probleem dragen ook een rode badge op het canvas.

Het vangt de fouten die anders onzichtbaar blijven tot een run misgaat — geen trigger, twee blokken die een id delen, een punt in een id, een blok waar niets naartoe verbindt, een verplichte instelling die leeg is gelaten, misvormde JSON, spaties binnen `{{ }}`, en verwijzingen naar een stap of retourwaarde die niet bestaat.

Eén ding dat het niet kan controleren: of een variabelenaam bestaat. Een hernoemde variabele komt alleen naar voren in het runlogboek.

## Je eerste workflow

De snelste manier om het gevoel van het canvas te krijgen:

1. Klik op het gestippelde placeholderblok, kies **Manual** in het paneel **Add Trigger**, en klik op **Add to Workflow**.
2. Klik op **Add Component**, kies **Log** (onder **Utils**), en klik op **Add to Workflow**. Sleep het nieuwe blok vrij van de trigger, en verbind dan de stip **Execute** van de trigger met de invoerstip van het Log-blok.
3. Open het Log-blok en stel de **Value** in op `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` is de **Identifier** van de trigger, getoond op het triggerblok — controleer of het overeenkomt.
4. Ga naar **Overzicht**, klik op **Workflow bewerken** op de kaart **Workflow-details**, en schakel **Ingeschakeld** in. Een uitgeschakelde workflow kan helemaal niet draaien, ook niet met de hand.
5. Klik terug op de **Bouwer** op **Workflow uitvoeren**, zet `{ "name": "Ada" }` in het veld **JSON**, klik op **Run Workflow Manually**, en bevestig met **Run**.
6. Er opent vanzelf een paneel **Workflow Run** dat de run volgt. Het logboek toont `Value:` gevolgd door `Hello from Ada`.

Die cyclus — toevoegen, verbinden, configureren, draaien, het logboek lezen — is hoe je elke workflow zult bouwen.

## Hem aanzetten

Nieuwe workflows starten uitgeschakeld, en dat geldt ook voor elke workflow die je dupliceert of importeert.

De schakelaar **Ingeschakeld** staat op de pagina **Overzicht** van de workflow, op de kaart **Workflow-details** — niet op de pagina Instellingen. Dezelfde kaart toont de huidige status als een groene **Enabled**- of rode **Disabled**-pil.

Een uitgeschakelde workflow kan helemaal niet draaien. Handmatige runs worden afgewezen met "This workflow is not enabled", net als getriggerde runs, dus de volgorde is: schakel hem in, test hem met **Workflow uitvoeren**, lees het runlogboek, en zet **Ingeschakeld** weer uit als je nog niet klaar bent om zijn trigger te laten afgaan. Gebruik **Run just this step** in de instellingen van dat blok om één enkel blok te testen zonder het geheel te draaien.

Om een workflow te pauzeren zonder hem te verwijderen, schakel je **Ingeschakeld** uit. Er starten geen nieuwe runs. Een run die halverwege bezig is, maakt zijn werk af, maar een run die geparkeerd staat op een **Sleep**-blok wordt geannuleerd zodra hij wakker wordt en vastgelegd als een fout.

## Opruimen

- Sleep blokken om ze te verplaatsen. De indeling wordt opgeslagen.
- Om een lijn te verwijderen, sleep je een van de uiteinden los van de stip en laat je hem los op leeg canvas.
- Om een blok te verwijderen, klik je erop en gebruik je **Delete** onderaan zijn instellingendialoog. Een blok of lijn selecteren en op Backspace drukken verwijdert het ook.
- Er is geen manier om één enkel blok te dupliceren. **Duplicate Workflow** op de pagina **Instellingen** van de workflow kopieert het geheel, en de kopie belandt uitgeschakeld.
- Stapel blokken van boven naar beneden zodat ze in de richting lezen waarin ze draaien — invoer zit aan de bovenrand, uitvoer aan de onderrand, dus de stroom loopt vanzelf naar beneden.

## Waar je verder kunt lezen

- [Workflow-triggers](/docs/workflows/triggers) — de vier manieren waarop een workflow kan starten.
- [Workflow-componenten](/docs/workflows/components) — elk blok dat je kunt toevoegen.
- [Workflow-variabelen](/docs/workflows/variables) — data verplaatsen tussen blokken.
- [Workflow-uitvoeringen en logboeken](/docs/workflows/runs-and-logs) — nagaan wat er gebeurd is.
