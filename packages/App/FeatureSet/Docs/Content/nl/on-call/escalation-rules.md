# Escalatieregels

Een bereikbaarheidsbeleid roept mensen op in niveaus. Elke escalatieregel is één niveau: wie wordt opgeroepen en hoe lang er wordt gewacht tot iemand bevestigt voordat het volgende niveau wordt opgeroepen. De regels van een beleid staan op volgorde op de pagina **Escalatieregels** ervan.

## Wie als eerste wordt opgeroepen

Wanneer u op de pagina **Bereikbaarheidsbeleid** een bereikbaarheidsbeleid maakt, vraagt het formulier om de **Naam** en **Wie wordt als eerste opgeroepen?**. De vraag gebruikt dezelfde kiezer als **Op de hoogte stellen**: bereikbaarheidsschema's, teams en personen, zoveel als nodig. Wie u kiest, vormt de eerste escalatieregel van het beleid, **Level 1**, die **30 minuten** op een bevestiging wacht voordat het volgende niveau wordt opgeroepen. Het nieuwe beleid opent daarna op de pagina **Escalatieregels** ervan, waar u meer niveaus kunt toevoegen.

**Wie wordt als eerste opgeroepen?** is optioneel. Laat u het leeg, dan begint het beleid zonder escalatieregels: het roept niemand op totdat u er een toevoegt, en het overzicht ervan meldt dat. De beschrijving en de labels staan onder **Geavanceerd**. De vraag wordt alleen gesteld aan wie escalatieregels mag toevoegen.

## Een escalatieregel toevoegen

Open het bereikbaarheidsbeleid, kies **Escalatieregels** in het zijmenu en klik op **Escalatieregel toevoegen**. Het dialoogvenster is één korte pagina met twee vragen:

- **Op de hoogte stellen** — wie op dit niveau wordt opgeroepen. Eén kiezer omvat bereikbaarheidsschema's, teams en personen: klik op **Ontvanger toevoegen**, zoek en kies er zoveel als nodig. Er is er minstens één nodig.
  - Een **bereikbaarheidsschema** roept op wie er dienst heeft wanneer het niveau wordt uitgevoerd, niet een vaste persoon.
  - Een **team** roept elk lid van het team op.
  - Een **persoon** wordt rechtstreeks opgeroepen.
- **Escaleren na (in minuten)** — hoe lang er op een bevestiging wordt gewacht voordat het volgende niveau wordt opgeroepen. Het begint op **30 minuten**; pas het aan het niveau aan.

Al het andere staat onder **Geavanceerd**, ingeklapt tot u het opent:

- **Naam** — optioneel. Een regel zonder naam is genoemd naar zijn niveau: de eerste regel van een beleid is **Level 1**, de tweede **Level 2**, enzovoort. Het naamveld toont de naam die de regel krijgt.
- **Beschrijving** — optionele notities, zoals wie dit niveau oproept en waarom.

De kop van **Geavanceerd** toont **Ingesteld** wanneer de regel een beschrijving of een eigen naam heeft.

## Hoe de niveaus mensen oproepen

Wanneer een incident of waarschuwing het beleid bereikt, roept **Level 1** meteen zijn ontvangers op. Als niemand binnen de wachttijd bevestigt, wordt **Level 2** opgeroepen, enzovoort de lijst af. Is de wachttijd van het laatste niveau verstreken zonder bevestiging, dan begint het beleid opnieuw bij **Level 1** als het **Herhaalbeleid** (onder de regels) herhalen voorschrijft, zo vaak als dat toestaat, en anders stopt het.

Het overzicht boven aan de pagina **Escalatieregels** toont de hele ladder: wanneer elk niveau wordt opgeroepen, wie het oproept en wat er na het laatste gebeurt. Een niveau waarvan niet alle ontvangers kunnen worden opgeroepen, meldt dat op zijn kaart; klik op het label om te zien wie en waarom.

Hoe iedere persoon die een niveau oproept wordt bereikt, bepalen diens eigen bereikbaarheidsregels: **Gebruikersinstellingen** > **Bereikbaarheidsregels**, met een tabblad voor incidenten, incidentepisodes, waarschuwingen en waarschuwingsepisodes, en per ernst een kaart die laat zien welke meldingsmethode na hoeveel tijd wordt gebruikt. Een projectbeheerder kan de regels van een lid bekijken en wijzigen onder **Gebruikers** > het lid > **Bereikbaarheidsregels**.

## Regels bewerken, herordenen en verwijderen

- **Edit rule** opent hetzelfde dialoogvenster van één pagina, ingevuld met de regel zoals die is: de ontvangers, de wachttijd, en de naam en beschrijving onder **Geavanceerd**. Voeg ontvangers toe of verwijder ze en sla op. Wordt de naam leeggemaakt, dan krijgt de regel weer de naam van zijn niveau.
- **Move up** en **Move down** in het **⋯**-menu van een regel wijzigen het niveau. Een regel die naar zijn niveau is genoemd, houdt een naam die bij zijn plaats past: wanneer **Level 3** voorbij **Level 2** omhoog gaat, wisselen beide van naam. Een naam die u zelf koos, zoals **Managers**, blijft hetzelfde waar de regel ook heen gaat.
- **Delete rule** vraagt eerst om bevestiging en zegt wie het niveau oproept. Verwijdert u een niveau, dan schuiven de niveaus eronder omhoog en worden regels die naar hun niveau zijn genoemd, mee hernoemd.

## Regels maken met de API of Terraform

Escalatieregels zijn de resource `/api/on-call-duty-policy-escalation-rule`; de personen, teams en schema's die een regel oproept, zijn de resources `/api/on-call-duty-policy-escalation-rule-user`, `-team` en `-schedule`.

- Een regel die zonder `name` wordt gemaakt, wordt net als in het dashboard naar zijn niveau genoemd: **Level 3** voor een regel die het derde niveau van zijn beleid wordt. De Terraform-resource voor escalatieregels vraagt nog steeds om een naam.
- `escalateAfterInMinutes` heeft buiten het dashboard geen standaardwaarde. Een regel die zonder deze waarde wordt gemaakt, wacht niet: het volgende niveau wordt opgeroepen zodra dit niveau is uitgevoerd. Stel de waarde expliciet in — het dashboard stelt 30 voor.
- Regels die naar hun niveau zijn genoemd, worden hernoemd wanneer u regels in het dashboard verplaatst of verwijdert. Wijzigt u `order` via de API of Terraform, dan verandert alleen de volgorde.
- Een bereikbaarheidsbeleid dat via `/api/on-call-duty-policy` wordt gemaakt met `onCallSchedules`, `teams` of `users` (lijsten met id's) in de `miscDataProps`, krijgt net als in het dashboard zijn eerste escalatieregel: **Level 1**, die hen oproept, met een `escalateAfterInMinutes` van 30. Elke id moet bij het project horen en de aanroeper moet escalatieregels mogen maken; anders wordt het beleid niet gemaakt. Een beleid dat zonder deze lijsten wordt gemaakt, heeft zoals voorheen geen regels; de Terraform-resource voor beleid stuurt ze niet mee.
