# Escalatieregels

Een bereikbaarheidsbeleid roept mensen op in niveaus. Elke escalatieregel is één niveau: wie wordt opgeroepen en hoe lang er wordt gewacht tot iemand bevestigt voordat het volgende niveau wordt opgeroepen. De regels van een beleid staan op volgorde op de pagina **Escalatieregels** ervan.

## Een escalatieregel toevoegen

Open het bereikbaarheidsbeleid, kies **Escalatieregels** in het zijmenu en klik op **Add Escalation Rule**. Het dialoogvenster is één korte pagina met twee vragen:

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

Wanneer een incident of waarschuwing het beleid bereikt, roept **Level 1** meteen zijn ontvangers op. Als niemand binnen de wachttijd bevestigt, wordt **Level 2** opgeroepen, enzovoort de lijst af. Is de wachttijd van het laatste niveau verstreken zonder bevestiging, dan begint het beleid opnieuw bij **Level 1** als de **Repeat Policy** (onder de regels) herhalen voorschrijft, zo vaak als die toestaat, en anders stopt het.

Het overzicht boven aan de pagina **Escalatieregels** toont de hele ladder: wanneer elk niveau wordt opgeroepen, wie het oproept en wat er na het laatste gebeurt. Een niveau waarvan niet alle ontvangers kunnen worden opgeroepen, meldt dat op zijn kaart; klik op het label om te zien wie en waarom.

## Regels bewerken, herordenen en verwijderen

- **Edit rule** opent hetzelfde dialoogvenster van één pagina, ingevuld met de regel zoals die is: de ontvangers, de wachttijd, en de naam en beschrijving onder **Geavanceerd**. Voeg ontvangers toe of verwijder ze en sla op. Wordt de naam leeggemaakt, dan krijgt de regel weer de naam van zijn niveau.
- **Move up** en **Move down** in het **⋯**-menu van een regel wijzigen het niveau. Een regel die naar zijn niveau is genoemd, houdt een naam die bij zijn plaats past: wanneer **Level 3** voorbij **Level 2** omhoog gaat, wisselen beide van naam. Een naam die u zelf koos, zoals **Managers**, blijft hetzelfde waar de regel ook heen gaat.
- **Delete rule** vraagt eerst om bevestiging en zegt wie het niveau oproept. Verwijdert u een niveau, dan schuiven de niveaus eronder omhoog en worden regels die naar hun niveau zijn genoemd, mee hernoemd.

## Regels maken met de API of Terraform

Escalatieregels zijn de resource `/api/on-call-duty-policy-escalation-rule`; de personen, teams en schema's die een regel oproept, zijn de resources `/api/on-call-duty-policy-escalation-rule-user`, `-team` en `-schedule`.

- Een regel die zonder `name` wordt gemaakt, wordt net als in het dashboard naar zijn niveau genoemd: **Level 3** voor een regel die het derde niveau van zijn beleid wordt. De Terraform-resource voor escalatieregels vraagt nog steeds om een naam.
- `escalateAfterInMinutes` heeft buiten het dashboard geen standaardwaarde. Een regel die zonder deze waarde wordt gemaakt, wacht niet: het volgende niveau wordt opgeroepen zodra dit niveau is uitgevoerd. Stel de waarde expliciet in — het dashboard stelt 30 voor.
- Regels die naar hun niveau zijn genoemd, worden hernoemd wanneer u regels in het dashboard verplaatst of verwijdert. Wijzigt u `order` via de API of Terraform, dan verandert alleen de volgorde.
