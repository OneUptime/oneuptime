# Waarschuwingsstatussen en ernstniveaus

Elke waarschuwing heeft een **status**, hoe ver je team ermee is, en een **ernst**, hoeveel ze ertoe doet. Statussen bepalen wat OneUptime doet: wie nog wordt opgeroepen, wat als actief telt, wanneer een episode wordt opgelost. Ernstniveaus rangschikken waarschuwingen, en regels kunnen erop matchen. Deze pagina is voor iedereen die ze instelt, of zich afvraagt waarom een waarschuwing wel of niet iemand opriep.

:::cards
- [De vooraf aangemaakte statussen](#de-vooraf-aangemaakte-statussen): Identified, Bevestigd en Opgelost, en wat elk doet.
- [Eigen statussen toevoegen](#eigen-statussen-toevoegen): Een stap van jezelf, zoals "In onderzoek".
- [Een waarschuwing door haar statussen bewegen](#een-waarschuwing-door-haar-statussen-bewegen): Elke manier waarop een status verandert.
- [Ernstniveaus](#de-vooraf-aangemaakte-ernstniveaus): High en Low, en je eigen toevoegen.
:::

## Hoe het werkt

De waarschuwingsstatussen van een project vormen één geordende lijst, en waarschuwingen gaan er alleen omlaag in. Waar een status staat, bepaalt waarvoor een waarschuwing erin telt: nog niet bevestigd, bevestigd of opgelost. Waarschuwingsepisoden doorlopen dezelfde lijst.

```mermaid title="Waarschuwingen gaan alleen omlaag in de lijst; waar een status staat, bepaalt waarvoor hij telt"
flowchart TB
    subgraph open["Telt als<br/>niet bevestigd"]
        identified["Identified"]
    end
    subgraph working["Telt als<br/>bevestigd"]
        acknowledged["Bevestigd"]
        investigating["In onderzoek<br/>(eigen)"]
    end
    subgraph done["Telt als<br/>opgelost"]
        resolved["Opgelost"]
        closed["Gesloten<br/>(eigen)"]
    end
    identified --> acknowledged
    acknowledged --> investigating
    investigating --> resolved
    resolved --> closed
    identified -. "overslaan" .-> resolved
```

Het model `AlertState` heeft `name`, `description`, `color` en `order`, plus drie vlaggen: `isCreatedState`, `isAcknowledgedState` en `isResolvedState`. OneUptime leest de vlaggen en de volgorde, nooit de naam, dus je kunt **Opgelost** hernoemen naar "Gesloten" zonder dat er iets kapotgaat. Het model `AlertSeverity` heeft `name`, `description`, `color` en `order`, en geen vlaggen.

> [!TIP]
> Beide lijsten staan onder **Waarschuwingen → Instellingen**, dat in het zijmenu ingeklapt begint: klap **Instellingen** uit om **Status waarschuwing** en **Ernst van waarschuwing** te vinden.

## De vooraf aangemaakte statussen

Elk nieuw project begint met drie waarschuwingsstatussen, in deze volgorde:

| Status           | `order` | Vlag                  | Kleur     | Wat het betekent                                  |
| ---------------- | ------- | --------------------- | --------- | ------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | De status waarin nieuwe waarschuwingen beginnen.  |
| **Bevestigd**    | `2`     | `isAcknowledgedState` | `#ffbf53` | Iemand is ermee bezig, en het oproepen stopt.     |
| **Opgelost**     | `3`     | `isResolvedState`     | `#2ab57d` | De waarschuwing is voorbij en telt niet meer als actief. |

De drie statussen met een vlag hebben het label **Ingebouwd** op de instellingenpagina. Je kunt ze hernoemen, een andere kleur geven en verslepen, maar ze houden hun volgorde, aangemaakt voor bevestigd voor opgelost, en ze kunnen niet worden verwijderd: hun **Verwijderen** blijft vergrendeld en zegt waarom.

## Wat elke vlag doet

| Vlag                  | Wat OneUptime ermee doet                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Nieuwe waarschuwingen beginnen hier wanneer niemand een andere status kiest: elke waarschuwing die een monitor aanmaakt, en elke waarschuwing die wordt aangemaakt met **Initiële status** leeg. |
| `isAcknowledgedState` | **Bevestigen** zet een waarschuwing hier. In deze status of elke status erna telt de waarschuwing als bevestigd: haar bereikbaarheidsbeleid stopt met oproepen en **Bevestigen** wordt niet meer aangeboden. |
| `isResolvedState`     | **Oplossen** zet een waarschuwing hier. In deze status of elke status erna telt de waarschuwing als opgelost: ze verlaat **Actieve waarschuwingen**, haar herinneringen stoppen en haar episode kan worden opgelost. |

## Eigen statussen toevoegen

Een status die je toevoegt, is een stap die je team doorloopt en die de drie vooraf aangemaakte statussen niet benoemen: "In onderzoek", "Beperkt", "Gesloten".

:::steps
### De statuslijst openen

Ga naar **Waarschuwingen → Instellingen → Status waarschuwing**. De kaart **Waarschuwing Statussen** toont je statussen in hun volgorde. Elke rij toont haar kleur en naam, waarvoor een waarschuwing erin **Telt als**, en haar beschrijving.

### De status aanmaken

Klik op **Status waarschuwing aanmaken** en vul **Naam**, **Beschrijving** en **Kleur** in. De kleur is al gekozen: een die nog geen andere status gebruikt. De nieuwe status wordt net boven de opgeloste status toegevoegd, zodat hij waarschuwingen actief houdt.

### Op zijn plek slepen

Sleep een rij aan haar handgreep om haar te verplaatsen; de nieuwe volgorde wordt opgeslagen zodra je loslaat. De kolom **Telt als** volgt: boven de bevestigde status is een waarschuwing **Niet bevestigd**, vanaf die status omlaag **Bevestigd**, en vanaf de opgeloste status omlaag **Opgelost**.
:::

Een status die je toevoegt, heeft geen vlag, dus zijn plek is zijn betekenis. Zet een stap voor beperking tussen **Bevestigd** en **Opgelost**, en een stap voor triage boven **Bevestigd**. Een status onder **Opgelost** telt overal als opgelost.

Je zet een waarschuwing in een eigen status via het menu **⋯** in de kop van de waarschuwing, onder **Status wijzigen naar**, dat elke status na de huidige toont. De bevestiging heet **Waarschuwing markeren als {{state}}**, met de naam van de status erin.

> [!NOTE]
> In OneUptime Cloud vraagt het toevoegen of wijzigen van waarschuwingsstatussen en ernstniveaus het abonnement **Growth** of hoger. Elk abonnement kan ze lezen, gebruiken en een toegevoegde status verwijderen.

## De volgorde wordt afgedwongen

Elke statuswijziging van een waarschuwing wordt aan de lijst getoetst, wie haar ook uitvoert: het dashboard, Slack, Microsoft Teams, de API, Terraform, een workflow of OneUptime zelf.

- **Stappen terug worden geweigerd**, met een bericht dat beide statussen noemt: "Alert cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of alert states."
- **Een overgang naar de status waarin ze al staat, wordt geweigerd**: "Alert state cannot be same as previous state."
- **Keuzelijsten bieden alleen de statussen na de huidige aan**, zodat niemand een overgang krijgt aangeboden die zou worden geweigerd.

Voor waarschuwingsepisoden geldt dezelfde lijst, met hun eigen berichten ("Episode cannot transition to …"). De enige stap terug omhoog in de lijst is die van OneUptime zelf: een groeperingsregel die een onlangs opgeloste episode heropent. Om een per ongeluk gezette status te herstellen, verwijder je de rij ervan op de pagina **Statustijdlijn** van de waarschuwing; de waarschuwing gaat terug naar de status van haar nieuwste overgebleven rij.

## De vooraf aangemaakte ernstniveaus

Elk nieuw project begint met twee ernstniveaus voor waarschuwingen, het ernstigste eerst:

| Ernst    | `order` | Kleur     | Vooraf ingestelde beschrijving                                                    |
| -------- | ------- | --------- | --------------------------------------------------------------------------------- |
| **High** | `1`     | `#b70400` | Issues causing very high impact to customers. Immediate attention is required.    |
| **Low**  | `2`     | `#ffbf53` | Issues causing low impact to customers.                                           |

Incidenten beginnen met drie ernstniveaus en waarschuwingen met twee. Wanneer het sjabloon van een monitoraanbeveling **Kritiek** of **Warning** zegt, koppelt OneUptime dat aan je eerste en tweede ernstniveau voor waarschuwingen, in een nieuw project **High** en **Low**.

## Ernstniveaus bewerken

Ga naar **Waarschuwingen → Instellingen → Ernst van waarschuwing**. De kaart **Waarschuwing Ernsten** toont ze met de ernstigste eerst; sleep een rij om haar rang te wijzigen. **Ernst van waarschuwing aanmaken** voegt er een toe aan het einde van de lijst, als minst ernstige, met dezelfde **Naam**, **Beschrijving** en **Kleur** als een status.

De rang bepaalt welk ernstniveau wint waar OneUptime ze vergelijkt: de ernst van een episode stijgt tot die van de ernstigste waarschuwing die zich erbij voegt. Ernstniveaus hebben geen vlaggen en geen verwijderslot: elk ernstniveau kan worden verwijderd, ook de twee vooraf aangemaakte.

Een ernstniveau roept op zichzelf niemand op. Om op ernst op te roepen, voeg je een bereikbaarheidsregel toe waarvan de **Waarschuwing Ernsten** erop overeenkomen: zie [Waarschuwingsregels en instellingen](/docs/alerts/settings). Een wijziging van de ernst van een waarschuwing schrijft een vermelding in haar feed en matcht haar herinneringsregel opnieuw.

## Een status of ernst archiveren

Archiveer een status of ernst die uw team niet meer moet gebruiken, in plaats van die te verwijderen. Archiveren wijzigt geen enkele waarschuwing. Een status verwijderen haalt zijn rijen uit de geschiedenis van elke waarschuwing, en een ernst kan niet worden verwijderd zolang waarschuwingen die hebben.

- **Archiveren** staat in het menu **⋯** van de rij. Het vraagt eerst om bevestiging en toont de regels, metingen, monitorcriteria en workflows die zijn ingesteld om de waarde te gebruiken: die blijven hem gebruiken tot u ze wijzigt.
- **Niemand kan hem nog kiezen.** **Status wijzigen**, de kop van de waarschuwing, Slack, Microsoft Teams, regels en monitorcriteria laten hem weg. De API, Terraform en MCP weigeren hem, met de naam van de waarde en waar u hem uit het archief haalt.
- **Waarschuwingen behouden hem.** Een waarschuwing die hem heeft, behoudt hem bij elke latere bewerking, de statustijdlijn toont hem nog, en u kunt er nog steeds op filteren.
- **Gearchiveerde waarden staan apart**, in de ingeklapte sectie **Gearchiveerde statussen van waarschuwingen** of **Gearchiveerde ernstniveaus van waarschuwingen** onder de tabel, met wie elke waarde heeft gearchiveerd en wanneer. **Uit archief halen** zet er een terug zoals hij was.
- **Sommige kunnen niet worden gearchiveerd.** De aangemaakte, bevestigde en opgeloste status, en de laatste niet-gearchiveerde ernst van het project. Hun **Archiveren** is vergrendeld, met de reden.

**Verwijderen** zegt eerst wat het zou doen. Zolang waarschuwingen of episodes de waarde hebben, wordt het verwijderen geweigerd en toont het dialoogvenster ze. Anders toont het wat het verwijderen zou wijzigen en biedt het **In plaats daarvan archiveren** aan.

## Een waarschuwing door haar statussen bewegen

| Manier               | Waar                                                                                      | Wat er wordt gevraagd                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Knoppen in de kop** | De kop van de waarschuwing: **Bevestigen**, **Oplossen** en **Status wijzigen naar** in het menu **⋯** | Een korte bevestiging, **Waarschuwing bevestigen**, **Waarschuwing oplossen** of **Waarschuwing markeren als {{state}}**, met een optionele notitie onder **Privénotitie toevoegen**. |
| **State timeline**   | **Statustijdlijn** in het zijmenu van de waarschuwing                                     | Een rij die je met de hand toevoegt, met **Waarschuwingsstatus** en **Begint op**.                                                    |
| **Rij in de lijst** | Het menu **⋯** op de rij van een waarschuwing in de lijst met waarschuwingen: **Bevestigen**, **Oplossen** en **Status wijzigen** | De bevestiging uit de kop, met de naam van de waarschuwing. Een waarschuwing die een andere wijziging intussen verder heeft gezet, blijft zoals ze is, en het venster zegt waarom. |
| **Bulkwijziging**    | **Bevestigen**, **Oplossen** of **Status wijzigen** op een selectie in de lijst met waarschuwingen                        | De status, en één privénotitie die aan elke waarschuwing wordt toegevoegd. Waarschuwingen die al in of na die status staan, worden overgeslagen. |
| **Automatisch**      | Een monitor, een episode, een gekoppeld incident of je eigen code                         | **Waarschuwing automatisch oplossen** in de criteria van een monitor, een statuswijziging van een episode, de incidentschakelaars op [Gekoppelde waarschuwingen](/docs/incidents/linked-alerts) of een rij die wordt aangemaakt via `/api/alert-state-timeline`. |

De kop biedt **Bevestigen** en **Oplossen** zolang de waarschuwing nog niet is bevestigd, en daarna alleen **Oplossen**. Een opgeloste waarschuwing toont geen van beide. Wie met zijn rol de status van de waarschuwing niet mag wijzigen, ziet de knoppen vergrendeld en geen menu met andere statussen: wijs er een aan en je ziet welke rechten dat zouden toestaan.

## Wat bevestigen doet

Een waarschuwing is bevestigd vanaf het moment dat ze naar je bevestigde status gaat, of naar een status daarna, een opgeloste meegerekend. Dan:

- **Het oproepen voor haar stopt.** Haar bereikbaarheidsbeleid roept het volgende niveau niet op.
- **Bevestigen wordt niet meer aangeboden**, niet in de kop en niet in Slack en Microsoft Teams, waar opnieuw bevestigen wordt geweigerd met "Alert is already acknowledged." of "Alert is already resolved." Wie daarna zijn oproep beantwoordt, krijgt de oproep bevestigd, en de waarschuwing blijft waar ze is.
- **De tijd tot bevestiging ligt vast**, vanaf de eerste zo'n overgang: de eerste tegel van **Overzicht**, en een meting die eindigt wanneer **De waarschuwing wordt bevestigd**.

## Wat oplossen doet

Een waarschuwing is opgelost wanneer ze naar je opgeloste status gaat, of naar een status daarna. Dan:

- **Ze verlaat Actieve waarschuwingen**, en de telling in het zijmenu.
- **Haar herinneringen stoppen**, wat haar herinneringsregel ook zegt.
- **Haar episode kan worden opgelost.** Een episode wordt vanzelf opgelost zodra elke waarschuwing erin is opgelost. Zie [Waarschuwingsepisoden en groeperingsregels](/docs/alerts/episodes).
- **Haar monitor kan een nieuwe waarschuwing aanmaken.** Een criterium houdt één open waarschuwing tegelijk aan; zodra die is opgelost, opent de volgende overeenkomst een nieuwe.

Doorgaan van **Opgelost** naar een status daarna, "Gesloten" bijvoorbeeld, verandert hier niets aan: de waarschuwing was al opgelost.

## De statustijdlijn

De pagina **Statustijdlijn** van een waarschuwing is het verslag van elke status waarin ze heeft gestaan. De kaart, **Statustijdlijn**, tekent ze als tijdlijn: een balk met elke status zo lang als die duurde, en daaronder elke wijziging, de nieuwste eerst. **Tabel**, in de kop van de kaart, toont ze in plaats daarvan als rijen, met **Waarschuwingsstatus**, **Begint op**, **Eindigt op** en **Duur**.

- **Oorzaak bekijken** toont de hoofdoorzaak die bij die wijziging is vastgelegd.
- **Logboeken bekijken** toont wat OneUptime vastlegde toen de waarschuwing veranderde, zoals de monitorcontrole die de wijziging veroorzaakte.

Rijen kunnen worden toegevoegd en verwijderd, maar niet bewerkt, en een waarschuwing houdt er altijd minstens één. Wie de nieuwste rij verwijdert, zet de waarschuwing terug in de status van de rij ervoor.

> [!WARNING]
> Een rij verwijderen herschrijft de geschiedenis van de waarschuwing en elke meting die eruit is berekend. Gebruik het om een fout te herstellen, niet om op te ruimen.

## De lijst Actieve waarschuwingen

**Waarschuwingen → Actieve waarschuwingen** bevat elke waarschuwing waarvan de status boven je opgeloste status staat, en niets anders beslist dat: niet de ernst, niet de leeftijd, niet of iemand haar heeft bevestigd. De rode badge ernaast in het zijmenu telt dezelfde waarschuwingen.

Een eigen status boven **Opgelost** houdt waarschuwingen dus in de lijst, en een eronder haalt ze eruit, zoals oplossen doet. **Actieve episodes** werkt op dezelfde manier voor episodes.

## Volgende stappen

:::cards
- [Waarschuwingen – Overzicht](/docs/alerts/index): Waar waarschuwingen vandaan komen en hoe je team ermee werkt.
- [Waarschuwingsepisoden en groeperingsregels](/docs/alerts/episodes): Hoe de status van een episode haar waarschuwingen beweegt.
- [Waarschuwingsregels en instellingen](/docs/alerts/settings): Oproepen en herinneren op ernst.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities): Dezelfde levenscyclus, voor incidenten.
:::
