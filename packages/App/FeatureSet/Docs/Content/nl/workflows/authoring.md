# Een workflow maken

Om een workflow te maken open je **Workflows** en klik je op **Workflow maken**. Het venster **Een workflow maken** vraagt eerst hoe je wilt beginnen en daarna om een naam. Een sjabloon dat eigen instellingen nodig heeft, zoals een Slack-webhook-URL, vraagt daar in nog een stap om.

Kies hoe je begint:

- **Vanaf nul beginnen**, bovenaan het venster, geeft je een leeg canvas. Hier beginnen de meeste workflows.
- **Of begin met een sjabloon** toont een paar sjablonen onder **Aanbevolen**. Voor de rest kies je naast het zoekvak een categorie, zoals **Incidenten**, **Monitoren** of **Jira**, of **Alle sjablonen**, of je typt in **Sjablonen zoeken…**. Elk woord dat je typt moet overeenkomen.

Klik op een sjabloon om te zien wat het doet: de trigger, de blokken waaruit het bestaat en de instellingen waar het om vraagt. Klik daarna op **Dit sjabloon gebruiken**, of dubbelklik op het sjabloon. In het zoekvak kiezen de pijltjestoetsen een sjabloon en gebruikt **Enter** het. `/` brengt je terug naar het zoekvak.

Workflows worden uitgeschakeld aangemaakt, dus er wordt niets uitgevoerd tot je ze inschakelt. Een nieuwe workflow opent in de **Bouwer**, het canvas waarop je hem ontwerpt.

## Het canvas

Een workflow die je vanaf nul begint, opent met één gestippeld blok met de tekst **Choose what starts this workflow**. Dat blok is het startpunt — klik erop om een trigger te kiezen. Een workflow uit een sjabloon opent met de blokken al op hun plek.

Elke workflow heeft precies één **trigger** bovenaan. Al het andere is een **component** dat iets doet. Voeg je een tweede trigger toe, dan vervangt die de eerste; verwijder je de laatste, dan komt het gestippelde blok terug.

Blokken toevoegen:

- **De trigger** — klik op het gestippelde blok. Er opent een paneel met de titel **Add Trigger**.
- **Al het andere** — klik op **Component toevoegen** in de werkbalk boven het canvas. Hetzelfde paneel opent, nu met de titel **Component toevoegen**.

Beide panelen openen met de blokken die de meeste workflows gebruiken, onder **Popular**, gevolgd door de andere ingebouwde blokken. Klik onder **OneUptime resources** op een resource zoals **Incident** om te zien wat je ermee kunt doen; **Browse all resources** toont ze allemaal. Of zoek: typ een paar woorden, zoals `create incident`, en de beste match staat bovenaan. Druk op `/` om naar het zoekveld te springen, op de pijltjestoetsen om door de resultaten te gaan en op **Enter** om het gemarkeerde blok toe te voegen. Een klik op een blok voegt het toe.

Een nieuw blok landt onder het onderste blok op het canvas, en een nieuwe trigger neemt bovenaan de plek van de oude in. Het nieuwe blok is geselecteerd, en landt het buiten beeld, dan schuift het canvas precies ver genoeg op om het te tonen. De instellingen gaan niet vanzelf open: klik op het blok wanneer je het wilt instellen. Zolang de verplichte instellingen leeg zijn, staat er **Click to set up** op het blok. Sleep blokken waarheen je wilt; het canvas klikt onderweg vast op een raster. Blokposities worden bewaard, dus de volgende persoon ziet dezelfde indeling als jij achterliet.

Wijzigingen worden automatisch opgeslagen. Een pil in de werkbalk houdt dat bij: **Saving…** zolang de wijziging onderweg is, daarna **Opgeslagen**, of **Kon niet opslaan** als het misging. Er is geen opslaanknop en geen aparte publicatiestap.

## Wat er op een blok staat

| Veld                          | Wat het doet                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (onder **ID**) | De korte id die op het blok staat, zoals `log-1`. Andere blokken verwijzen hiermee naar dit blok, dus hernoemen breekt elke `{{local.components.…}}`-verwijzing die ernaartoe wijst. De kop van het blok is de eigen naam van het component en kun je niet wijzigen. |
| **Instellingen**              | Wat het blok nodig heeft om zijn werk te doen — een URL, een Slack-kanaal, een berichttekst. Optionele velden dragen het label **(Optional)**; al het andere is verplicht. Minder gebruikte instellingen zijn ingeklapt onder **Meer velden**; de kop noemt ze en toont welke ingesteld zijn. |
| **Input**                     | De stip op de bovenrand, waar lijnen vanaf eerdere blokken binnenkomen. Triggers hebben er geen — er draait niets vóór hen.                                                                                  |
| **Outputs**                   | De stippen langs de onderrand, met hun label er net boven, waar lijnen naar de volgende blokken vertrekken. Veel blokken hebben aparte uitgangen **Succes** en **Fout**, zodat je beide gevallen kunt afhandelen. |

## Blokken verbinden

Sleep van een stip onderaan het ene blok omlaag naar de stip bovenaan het volgende. De lijn die je trekt, bepaalt wat er daarna draait.

- Verbind je vanaf **Succes**, dan draait het volgende blok alleen als het vorige lukte.
- Verbind je vanaf **Fout**, dan draait het volgende blok alleen als het vorige mislukte.
- Verbind je een uitgang niet, dan houdt dat pad daar simpelweg op.

Je kunt één uitgang met meerdere blokken verbinden. Ze draaien allemaal — maar na elkaar, in één wachtrij, niet parallel. Reken niet op de volgorde tussen takken, en ga er niet van uit dat ze in de tijd overlappen. Elk blok draait hooguit één keer per run, dus een lijn terug naar een eerder blok laat dat blok niet nog eens draaien.

## Een blok instellen

Klik op een blok om zijn instellingen in een dialoogvenster te openen (of ga er met **Tab** naartoe en druk op **Enter**). Elke instelling heeft het passende soort invoer — tekstvelden, keuzelijsten, code-editors, schakelaars, enzovoort. Vul het in en klik op **Opslaan**.

In datzelfde venster vind je ook:

- **Verwijderen** — haal dit blok weg.
- **Run just this step** — draai alleen dit ene blok, zonder de rest van de workflow. Waarden die het uit andere stappen zou lezen, komen leeg binnen, en alles wat het verstuurt, schrijft of verwijdert gebeurt echt.
- **Documentatie**, **Inputs**, **Outputs** en **Returns** — referentiekaarten met wat dit blok verwacht en oplevert.

De meeste tekstvelden accepteren variabelen — zo stroomt data van het ene blok naar het volgende. Typ de syntaxis niet met de hand, maar gebruik de waardekiezer in de editor: die bouwt een correcte verwijzing uit het blok en het veld dat je aanwijst. Zie [Workflow-variabelen](/docs/workflows/variables).

## Controles tijdens het bouwen

De Bouwer controleert bij elke wijziging de hele graaf en meldt wat hij vindt in een pil in de werkbalk. Klik op de pil om **Problems with this workflow** te openen: daar staat elk probleem, met een sprong naar het blok dat het veroorzaakt. Op het canvas staat **Click to set up** op een blok waarvan de verplichte instellingen nog leeg zijn, en een blok met een ander probleem krijgt een badge in de hoek: rood voor een fout, oranje voor een waarschuwing. Houd de muis boven de badge om te lezen wat er mis is.

Hij vangt de fouten die anders onzichtbaar blijven tot een run misgaat — geen trigger, twee blokken met dezelfde id, een punt in een id, een blok waar niets naartoe loopt, een verplichte instelling die leeg bleef, ongeldige JSON, spaties binnen `{{ }}`, en verwijzingen naar een stap of retourwaarde die niet bestaat.

Eén ding kan hij niet controleren: of een variabelenaam bestaat. Een hernoemde variabele merk je pas in het runlogboek.

## Je eerste workflow

De snelste manier om het canvas te leren kennen:

1. Klik op het gestippelde blok en daarna op **Manual** in het paneel **Add Trigger**.
2. Klik op **Component toevoegen** en daarna op **Log** onder **Popular**. Het nieuwe blok landt onder de trigger. Verbind de stip **Execute** van de trigger met de invoerstip van het Log-blok.
3. Klik op het Log-blok, waar **Click to set up** op staat, en zet zijn **Waarde** op `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` is de **Identifier** van de trigger, te zien op het triggerblok — controleer of die klopt.
4. Zet **Ingeschakeld** aan, bovenaan de Bouwer. Een uitgeschakelde workflow kan helemaal niet draaien, ook niet met de hand; sla je deze stap over, dan vraagt **Workflow uitvoeren** eerst of hij aan moet.
5. Terug in de **Bouwer** klik je op **Workflow uitvoeren**, zet je `{ "name": "Ada" }` in het veld **JSON**, klik je op **Run Workflow Manually** en bevestig je met **Run**.
6. Er opent vanzelf een paneel **Workflow Run** dat de uitvoering volgt. Het logboek toont `Value:` gevolgd door `Hello from Ada`.

Die cyclus — toevoegen, verbinden, instellen, draaien, het logboek lezen — is hoe je elke workflow bouwt.

## Hem aanzetten

Nieuwe workflows beginnen uitgeschakeld, en dat geldt ook voor elke workflow die je dupliceert of importeert. Zolang een workflow uit staat, zegt de Bouwer dat boven het canvas, met een knop **Workflow inschakelen**.

De schakelaar **Ingeschakeld** staat bovenaan de **Bouwer**, naast **Component toevoegen** en **Workflow uitvoeren**. Hij staat ook op de pagina **Overzicht** van de workflow: klik op **Workflow bewerken** op de kaart **Workflow-details**, die de huidige stand toont als een groene pil **Ingeschakeld** of een rode pil **Uitgeschakeld**. Alleen wie de workflow mag bewerken, kan hem aan- of uitzetten; anderen zien de schakelaar grijs.

Een uitgeschakelde workflow kan helemaal niet draaien: zijn trigger wordt genegeerd, en **Workflow uitvoeren** en **Run just this step** ook. Voer je hem, of een van zijn blokken, uit terwijl hij uit staat, dan vraagt de Bouwer in plaats daarvan **Deze workflow inschakelen?**. **Inschakelen en uitvoeren** (of **Inschakelen en stap uitvoeren**) zet de workflow aan en voert daarna uit wat je vroeg, met de waarden die je opgaf. De volgorde is dus: bouw hem, test hem met **Workflow uitvoeren**, lees het runlogboek, en zet **Ingeschakeld** weer uit als je nog niet klaar bent om zijn trigger te laten afgaan. Wil je één blok testen zonder het geheel te draaien, gebruik dan **Run just this step** in de instellingen van dat blok.

Al het andere dat een uitgeschakelde workflow start, wordt met hetzelfde advies afgewezen. Een aanroep van zijn webhook-URL krijgt HTTP 400 en "This workflow is turned off, so it can't run. Turn it on with the Enabled switch at the top of its Builder, then try again." Een **Execute Workflow**-blok dat hem aanroept, neemt zijn **Error**-pad, en de fout noemt de aangeroepen workflow.

Wil je een workflow pauzeren zonder hem te verwijderen, zet **Ingeschakeld** dan uit. Er starten geen nieuwe uitvoeringen. Een run die al bezig is, maakt hij af, maar een run die geparkeerd staat op een **Sleep**-blok wordt bij het ontwaken geannuleerd en als fout vastgelegd.

## Opruimen

- Sleep blokken om ze te verplaatsen. De indeling wordt bewaard.
- Wil je een lijn verwijderen, sleep dan een van de uiteinden van de stip af en laat het los op leeg canvas.
- Wil je een blok verwijderen, klik het dan aan en gebruik **Verwijderen** onderaan zijn instellingenvenster. Een blok of lijn selecteren en op Backspace drukken werkt ook.
- Eén los blok dupliceren kan niet. **Duplicate Workflow** op de pagina **Instellingen** van de workflow kopieert het geheel. De naam van de kopie is al ingevuld, doorgenummerd voorbij de workflows van het project ("Nightly Sync" wordt gekopieerd als "Nightly Sync 2"), en de kopie opent, uitgeschakeld.
- Stapel blokken van boven naar beneden, zodat ze lezen in de richting waarin ze draaien — invoer zit op de bovenrand, uitgangen op de onderrand, dus de stroom loopt vanzelf omlaag.

## Waar je verder kunt lezen

- [Workflow-triggers](/docs/workflows/triggers) — de vier manieren waarop een workflow kan starten.
- [Workflow-componenten](/docs/workflows/components) — elk blok dat je kunt toevoegen.
- [Workflow-variabelen](/docs/workflows/variables) — data verplaatsen tussen blokken.
- [Workflow-uitvoeringen](/docs/workflows/runs-and-logs) — nagaan wat er gebeurd is.
