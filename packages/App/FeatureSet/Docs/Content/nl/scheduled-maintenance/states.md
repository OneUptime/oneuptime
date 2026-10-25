# Onderhoudsstatussen

Elke geplande onderhoudsgebeurtenis staat in één **status**: hoe ver het werk is, van gepland tot goedgekeurd. Statussen bepalen wat OneUptime met de gebeurtenis doet: wanneer haar monitoren niet meer worden gecontroleerd, wat je statuspagina's tonen, wanneer haar herinneringen stoppen. Deze pagina behandelt de vier statussen waarmee elk project begint, wat een gebeurtenis tussen hen verplaatst en hoe je eigen stappen toevoegt.

:::cards
- [De standaardstatussen](#de-standaardstatussen): Gepland, Lopend, Beëindigd en Voltooid.
- [Wat een gebeurtenis verplaatst](#wat-een-gebeurtenis-verplaatst): De klok, de kop, de tijdlijn, chat en de API.
- [Eigen statussen](#eigen-statussen): Een stap voordat het werk begint, of een controle erna.
- [De statustijdlijn](#de-statustijdlijn): Elke status waarin een gebeurtenis heeft gestaan, en hoe je die corrigeert.
:::

## Hoe het werkt

De onderhoudsstatussen van een project vormen één geordende lijst, en gebeurtenissen gaan er alleen naar beneden in. Waar een status staat, bepaalt wat een gebeurtenis erin telt als: wachtend op de start, lopend of voorbij.

```mermaid title="Gebeurtenissen gaan alleen omlaag in de lijst; de plaats van een status bepaalt wat die telt als"
flowchart TB
    subgraph waiting["Wacht op de start"]
        scheduled["Gepland"]
        confirmed["Bevestigd<br/>(eigen)"]
    end
    subgraph progress["Lopend"]
        ongoing["Lopend"]
        verifying["Controleren<br/>(eigen)"]
    end
    subgraph over["Voorbij"]
        ended["Beëindigd"]
        completed["Voltooid"]
    end
    scheduled --> confirmed
    confirmed -->|"haar Begint op"| ongoing
    ongoing --> verifying
    verifying -->|"haar Eindigt op"| ended
    ended --> completed
```

Het model `ScheduledMaintenanceState` heeft `name`, `description`, `color` en `order`, plus vier vlaggen: `isScheduledState`, `isOngoingState`, `isEndedState` en `isResolvedState`. OneUptime leest de vlaggen en de volgorde, nooit de naam, dus je kunt **Voltooid** hernoemen naar 'Goedgekeurd' zonder dat er iets stukgaat.

> [!TIP]
> De lijst staat onder **Geplande onderhoud → Instellingen → Status gebeurtenis**. **Instellingen** is in het zijmenu eerst ingeklapt: klap het eerst uit.

## De standaardstatussen

Elk nieuw project begint met vier onderhoudsstatussen, in deze volgorde:

| Status        | `order` | Vlag               | Kleur     | Wat het betekent                                               |
| ------------- | ------- | ------------------ | --------- | -------------------------------------------------------------- |
| **Gepland**   | `1`     | `isScheduledState` | `#000000` | Elke nieuwe gebeurtenis begint hier en wacht op haar starttijd. |
| **Lopend**    | `2`     | `isOngoingState`   | `#ffbf53` | Het werk is bezig, en de monitoren van de gebeurtenis worden niet gecontroleerd. |
| **Beëindigd** | `3`     | `isEndedState`     | `#4a4a4a` | Het venster is voorbij, en de controles hervatten.             |
| **Voltooid**  | `4`     | `isResolvedState`  | `#2ab57d` | Iemand heeft het werk goedgekeurd, en de herinneringen aan de eigenaren stoppen. |

De vier gemarkeerde statussen dragen het label **Ingebouwd** op de instellingenpagina. Je kunt ze hernoemen, een andere kleur geven en verslepen, maar ze houden hun volgorde en kunnen niet worden verwijderd: hun **Verwijderen** blijft vergrendeld, en zegt waarom.

**Beëindigd** en **Voltooid** zijn allebei voorbij. Het verschil is wie de gebeurtenis verplaatst: OneUptime zet haar op **Beëindigd** op haar **Eindigt op**, en een persoon, een chatknop of de API zet haar op **Voltooid** zodra het werk is gecontroleerd.

## Wat een gebeurtenis verplaatst

| Manier           | Waar                                                                                        | Wat het vraagt                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **De klok**      | Een taak die elke minuut draait                                                             | Niets: op **Begint op** zet ze een wachtende gebeurtenis op **Lopend**, en op **Eindigt op** een lopende op **Beëindigd**. |
| **De kop**       | Het **Overzicht** van de gebeurtenis: de knoppen **Markeren als {{state}}**, en **Change state to** in het menu **⋯** | Een kort dialoogvenster, **Gepland onderhoud markeren als {{state}}**, met **Statuspagina-abonnees op de hoogte stellen** en een optionele notitie onder **Openbare notitie toevoegen**. |
| **De tijdlijn**  | **Statustijdlijn** in het zijmenu van de gebeurtenis                                        | Een rij die je met de hand toevoegt, met **Status van geplande onderhoud** en **Begint op**.                    |
| **Een rij in de lijst** | Het menu **⋯** op de rij van een gebeurtenis in de lijst met gebeurtenissen: de stappen **Markeren als {{state}}** en **Status wijzigen** | Het dialoogvenster uit de kop, met de naam van de gebeurtenis. Een gebeurtenis die een andere wijziging intussen verder heeft gezet, blijft zoals ze is, en het venster zegt waarom. |
| **Bulkwijziging** | **Markeren als {{state}}** of **Status wijzigen** op een selectie in de lijst met gebeurtenissen                         | De status, en één openbare notitie die aan elke gebeurtenis wordt toegevoegd. Gebeurtenissen die al op die status of verder staan, worden overgeslagen. |
| **Chat**         | De knoppen in de Slack- en Microsoft Teams-berichten van de gebeurtenis                     | Dezelfde wijziging, uitgevoerd als jij. Zie [Slack](/docs/workspace-connections/slack#handelen-op-incidenten-waarschuwingen-en-gebeurtenissen-vanuit-slack). |
| **De API**       | Een rij aangemaakt op `/api/scheduled-maintenance-state-timeline`                           | De status, en of abonnees bericht krijgen.                                                                      |

De knoppen van de kop zijn naar je statussen genoemd. Zolang de gebeurtenis wacht, biedt de kop er twee: één die haar start, genoemd naar je lopende status, en één die haar beëindigt, genoemd naar je beëindigde status. Zolang de gebeurtenis loopt, alleen de tweede. Het menu **⋯** toont elke andere status na de huidige.

## Wat starten en beëindigen doen

Een gebeurtenis start wanneer ze van een status waarin ze wacht naar **Lopend** gaat, of rechtstreeks naar een eigen status tussen **Lopend** en **Beëindigd**. Dan:

- **Haar monitoren worden niet meer gecontroleerd** en gaan naar haar **Monitorstatus wijzigen naar**, als ze die heeft. Een monitor die je tijdens het werk aan de gebeurtenis toevoegt, verandert ook.
- **Haar statuspagina's tonen haar als lopend**, en haar abonnees krijgen bericht: op tijd als **Wanneer de gebeurtenis begint** aanstaat, en met de hand zoals **Statuspagina-abonnees op de hoogte stellen** in het dialoogvenster zegt.
- **Haar eigenaren krijgen bericht**, als ze de melding over statuswijzigingen hebben aangezet, en de gebeurtenis verschijnt onder **Lopende gebeurtenissen**.

Een gebeurtenis eindigt wanneer ze van een status waarin ze loopt naar **Beëindigd**, **Voltooid** of een eigen status na **Beëindigd** gaat. Dan worden haar monitoren weer gecontroleerd en gaan ze terug naar 'operationeel', tenzij een andere lopende gebeurtenis ze nog vasthoudt, en haar abonnees krijgen op dezelfde manier bericht: op tijd als **Wanneer de gebeurtenis eindigt** aanstaat, en met de hand zoals het dialoogvenster zegt.

Doorgaan van **Lopend** naar 'Controleren', of van **Beëindigd** naar **Voltooid**, start of beëindigt niets opnieuw: de gebeurtenis was al begonnen, of al geëindigd.

## De klok in de kop

Vóór de start telt de kop af; terwijl de gebeurtenis loopt, telt hij hoe lang ze al loopt; zodra ze voorbij is, zegt hij hoe lang ze duurde. Wanneer de gebeurtenis een grens met meer dan twee minuten mist, zegt een oranje melding dat:

- **Start overdue**: de gebeurtenis wacht na haar **Begint op** nog steeds.
- **Overrunning**: de gebeurtenis loopt na haar **Eindigt op** nog steeds.

De melding noemt de geplande tijd en de status die de gebeurtenis nog niet heeft bereikt. Vlak na een grens heeft de taak die gebeurtenissen verplaatst misschien nog niet gedraaid, dus de kop controleert de volgende minuten vanzelf opnieuw en toont de nieuwe status zonder te herladen.

## De volgorde wordt afgedwongen

Elke statuswijziging wordt tegen de lijst gecontroleerd, wie haar ook doet: het dashboard, Slack, Microsoft Teams, de API, Terraform, een workflow of OneUptime zelf.

- **Terugstappen worden geweigerd**, met een bericht dat beide statussen noemt: "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states."
- **Naar de status gaan waarin ze al staat, wordt geweigerd**: "Scheduled Maintenance state cannot be same as previous state."
- **Keuzelijsten bieden alleen de statussen na de huidige aan**, zodat niemand een wijziging krijgt aangeboden die zou worden geweigerd.

Om een per ongeluk gezette status te corrigeren, verwijder je de rij ervan op de pagina **Statustijdlijn** van de gebeurtenis; de gebeurtenis gaat terug naar de status van de rij ervoor.

## Eigen statussen

Een status die je toevoegt, is een stap die je team doorloopt en die de vier standaardstatussen niet noemen: 'Bevestigd' voordat het werk begint, 'Controleren' erna.

:::steps
### De statuslijst openen

Ga naar **Geplande onderhoud → Instellingen → Status gebeurtenis**. De kaart **Gepland Onderhoud Statussen** toont je statussen in hun volgorde. Elke rij toont haar kleur en naam, wat een gebeurtenis erin telt als (kolom **Telt als**) en haar beschrijving.

### De status aanmaken

Klik op **Gepland Onderhoud Status aanmaken** en vul de **Naam**, de **Beschrijving** en de **Kleur** in. De nieuwe status wordt net boven de voltooide status toegevoegd.

### Hem op zijn plaats slepen

Sleep een rij aan haar greep om haar te verplaatsen; de nieuwe volgorde wordt opgeslagen zodra je loslaat. De kolom **Telt als** volgt de plaats waar je haar neerzet.
:::

Een status die je toevoegt, heeft geen vlag, dus zijn plaats is wat hij betekent:

| Waar je hem plaatst                     | Een gebeurtenis erin                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tussen **Gepland** en **Lopend**        | Wacht op haar **Begint op**, zoals in **Gepland**, en start van daaruit op tijd.                                 |
| Tussen **Lopend** en **Beëindigd**      | Loopt, zoals in **Lopend**: haar monitoren blijven ongecontroleerd, en ze eindigt op haar **Eindigt op**.        |
| Tussen **Beëindigd** en **Voltooid**    | Is voorbij, maar nog niet voltooid: herinneringen die tot de voltooiing lopen, gaan door.                        |
| Onder **Voltooid**                      | Is voltooid, zoals in **Voltooid**.                                                                              |

Houd je statussen onder **Gepland**: elke nieuwe gebeurtenis begint daar, en een gebeurtenis gaat nooit terug omhoog in de lijst, dus een status erboven wordt nooit bereikt. Je zet een gebeurtenis in een eigen status via het menu **⋯** in haar kop, onder **Change state to**.

> [!NOTE]
> In OneUptime Cloud vraagt het toevoegen of wijzigen van onderhoudsstatussen het abonnement **Growth** of hoger. Elk abonnement kan ze lezen, gebruiken en een status die je hebt toegevoegd verwijderen.

## Een status archiveren

Archiveer een eigen status die uw team niet meer moet gebruiken, in plaats van die te verwijderen. Archiveren wijzigt geen enkele gebeurtenis: een gebeurtenis in die status blijft erin en gaat gewoon verder, en de statustijdlijn toont hem nog.

- **Archiveren** staat in het menu **⋯** van de rij. Het vraagt eerst om bevestiging en toont de metingen en workflows die zijn ingesteld om de status te gebruiken.
- **Niemand kan hem nog kiezen.** De kop van de gebeurtenis, **Status wijzigen**, Slack en Microsoft Teams laten hem weg, en de API, Terraform en MCP weigeren hem. U kunt gebeurtenissen er nog steeds op filteren.
- **Gearchiveerde statussen staan apart**, in de ingeklapte sectie **Gearchiveerde statussen van gepland onderhoud** onder de tabel. **Uit archief halen** zet er een terug zoals hij was.
- **De vier ingebouwde statussen kunnen niet worden gearchiveerd**: OneUptime zet gebeurtenissen erin. Hun **Archiveren** is vergrendeld, met de reden.

## De statustijdlijn

De pagina **Statustijdlijn** van de gebeurtenis is het overzicht van elke status waarin ze heeft gestaan. Haar kaart, **Statustijdlijn**, tekent ze als tijdlijn: een band met elke status zo lang als die duurde, en daaronder elke wijziging, de nieuwste eerst. **Tabel**, in de kop van de kaart, toont ze in plaats daarvan als rijen, met **Status van geplande onderhoud**, **Begint op**, **Eindigt op**, **Duur**, of abonnees bericht moesten krijgen en hoe hun melding verliep.

In het dashboard kunnen rijen worden toegevoegd en verwijderd, maar niet bewerkt, en een gebeurtenis houdt er altijd minstens één. Via de API kan de `startsAt` van een rij worden gecorrigeerd, en elke meting die uit de tijdlijn wordt berekend, volgt die. Als je de nieuwste rij verwijdert, gaat de gebeurtenis terug naar de status van de rij ervoor.

> [!WARNING]
> Een rij verwijderen herschrijft de geschiedenis van de gebeurtenis en elke meting die daaruit is berekend. Gebruik het om een fout te corrigeren, niet om op te ruimen.

## Probleemoplossing

:::details De kop toont Start overdue
De gebeurtenis wacht meer dan twee minuten na haar **Begint op** nog steeds, dus de taak die gebeurtenissen start, heeft haar nog niet verplaatst. Start haar zelf met de knop in de kop: een start met de hand doet alles wat de taak doet, ook met haar monitoren.
:::

:::details Een gebeurtenis kan niet terug naar een status waarin ze stond
Statussen gaan alleen omlaag in de lijst. Verwijder op de pagina **Statustijdlijn** van de gebeurtenis de rijen na de status die je wilt, de nieuwste eerst.
:::

:::details De voltooide status ontbreekt bij de knoppen van de kop
De knoppen van de kop starten en beëindigen de gebeurtenis. Voltooien staat in het menu **⋯**, onder **Change state to**.
:::

## Volgende stappen

:::cards
- [Geplande onderhoud – Overzicht](/docs/scheduled-maintenance/index): Waar alles staat, en wat een gebeurtenis beïnvloedt.
- [Onderhoudsgebeurtenissen maken](/docs/scheduled-maintenance/creating-events): Het formulier, veld voor veld.
- [Onderhoudsregels en instellingen](/docs/scheduled-maintenance/settings): Eigenaren herinneren tot een gebeurtenis voltooid is.
- [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities): Dezelfde geordende lijst, voor incidenten.
:::
