# Escalatieregels

Een bereikbaarheidsbeleid roept mensen op in niveaus. Elke escalatieregel is één niveau: wie wordt opgeroepen en hoe lang er wordt gewacht tot iemand bevestigt voordat het volgende niveau wordt opgeroepen. De regels van een beleid staan op volgorde op de pagina **Escalatieregels** ervan.

```mermaid title="Een bereikbaarheidsbeleid roept niveau na niveau op tot iemand bevestigt"
flowchart TB
    trigger["Incident of waarschuwing"] --> level1["Level 1 roept op"]
    level1 --> ack1{"Op tijd<br/>bevestigd?"}
    ack1 -->|"Ja"| stop["Het oproepen stopt"]
    ack1 -->|"Nee"| level2["Level 2 roept op"]
    level2 --> ack2{"Op tijd<br/>bevestigd?"}
    ack2 -->|"Ja"| stop
    ack2 -->|"Nee, laatste niveau"| repeat{"Het beleid herhalen?"}
    repeat -->|"Ja"| level1
    repeat -->|"Nee"| done["Het beleid stopt"]
```

:::cards
- [Wie als eerste wordt opgeroepen](#wie-als-eerste-wordt-opgeroepen): Maak een beleid met zijn eerste niveau.
- [Een escalatieregel toevoegen](#een-escalatieregel-toevoegen): Voeg het volgende niveau toe, stap voor stap.
- [Hoe de niveaus mensen oproepen](#hoe-de-niveaus-mensen-oproepen): Timing, herhalingen en hoe iedere persoon wordt bereikt.
- [API en Terraform](#regels-maken-met-de-api-of-terraform): Maak beleid en regels als code.
:::

## Wie als eerste wordt opgeroepen

Wanneer u op de pagina **Bereikbaarheidsbeleid** een bereikbaarheidsbeleid maakt, vraagt het formulier om de **Naam** en **Wie wordt als eerste opgeroepen?**. De vraag gebruikt dezelfde kiezer als **Op de hoogte stellen**: bereikbaarheidsschema's, teams en personen, zoveel als nodig. Wie u kiest, vormt de eerste escalatieregel van het beleid, **Level 1**, die **30 minuten** op een bevestiging wacht voordat het volgende niveau wordt opgeroepen.

:::steps
1. Ga naar **Bereikbaarheidsdienst** > **Bereikbaarheidsbeleid** en klik op **Bereikbaarheidsbeleid aanmaken**.
2. Vul een **Naam** in.
3. Klik onder **Wie wordt als eerste opgeroepen?** op **Ontvanger toevoegen** en kies de bereikbaarheidsschema's, teams en personen die als eerste worden opgeroepen.
4. Klik op **Bereikbaarheidsbeleid aanmaken**. Het nieuwe beleid opent daarna op de pagina **Escalatieregels** ervan, waar u meer niveaus kunt toevoegen.
:::

**Wie wordt als eerste opgeroepen?** is optioneel. Laat u het leeg, dan begint het beleid zonder escalatieregels: het roept niemand op totdat u er een toevoegt, en het overzicht ervan meldt dat. De beschrijving en de labels staan onder **Meer velden**. De vraag wordt alleen gesteld aan wie escalatieregels mag toevoegen.

## Een escalatieregel toevoegen

:::steps
### Open de escalatieregels van het beleid

Open het bereikbaarheidsbeleid, kies **Escalatieregels** in het zijmenu ervan en klik op **Escalatieregel toevoegen**. Het dialoogvenster is één korte pagina.

### Kies wie op de hoogte wordt gesteld

Klik onder **Op de hoogte stellen** op **Ontvanger toevoegen**, zoek en kies zoveel bereikbaarheidsschema's, teams en personen als dit niveau moet oproepen. Voeg er minstens één toe.

| Ontvanger | Wie wordt opgeroepen wanneer het niveau wordt uitgevoerd |
| --- | --- |
| Een **bereikbaarheidsschema** | Wie er dienst in heeft wanneer het niveau wordt uitgevoerd, niet een vaste persoon. |
| Een **team** | Elk lid van het team. |
| Een **persoon** | Die persoon, rechtstreeks. |

### Stel in hoe lang er wordt gewacht

**Escaleren na (in minuten)** is hoe lang er op een bevestiging wordt gewacht voordat het volgende niveau wordt opgeroepen. Het begint op **30 minuten**; pas het aan wat bij het niveau past.

### Geef de regel een naam, als u wilt

Al het andere staat onder **Meer velden**, ingeklapt tot u het opent:

- **Naam**: optioneel. Een regel zonder naam is genoemd naar zijn niveau: de eerste regel van een beleid is **Level 1**, de tweede **Level 2**, enzovoort. Het naamveld toont de naam die de regel krijgt.
- **Beschrijving**: optionele notities, zoals wie dit niveau oproept en waarom.

Ingeklapt noemt de kop van **Meer velden** de twee en toont welke de regel heeft: een beschrijving, of een eigen naam.

### Maak de regel aan

Klik op **Create Rule**. De regel wordt onder de andere toegevoegd, als het volgende niveau van het beleid.
:::

## Hoe de niveaus mensen oproepen

Wanneer een incident of waarschuwing het beleid bereikt, roept **Level 1** meteen zijn ontvangers op. Als niemand binnen de wachttijd bevestigt, wordt **Level 2** opgeroepen, enzovoort de lijst af. Is de wachttijd van het laatste niveau verstreken zonder bevestiging, dan begint het beleid opnieuw bij **Level 1** als het **Herhaalbeleid** (onder de regels) herhalen voorschrijft, zo vaak als dat toestaat, en anders stopt het. Het incident of de waarschuwing bevestigen of oplossen stopt het oproepen op elk niveau.

Een incident, waarschuwing of episode die al bevestigd of opgelost wordt aangemaakt — achteraf vastgelegd — voert geen enkel beleid uit: niemand wordt opgeroepen, en de feed meldt dat, met de namen van het beleid erbij. Zie [Al bevestigd of opgelost gemeld](/docs/incidents/declaring-incidents#al-bevestigd-of-opgelost-gemeld).

Om een beleid te herhalen, klikt u op **Bewerken** op de kaart **Herhaalbeleid**, zet u **Repeat if no one acknowledges** aan en stelt u **Number of times to repeat** in.

### Het escalatieoverzicht

Het overzicht boven aan de pagina **Escalatieregels** toont de hele ladder: wanneer elk niveau wordt opgeroepen, wie het oproept en wat er na het laatste gebeurt. Een niveau waarvan niet alle ontvangers kunnen worden opgeroepen, meldt dat op zijn kaart; klik op het label om te zien wie en waarom.

### Hoe iedere persoon wordt bereikt

Iedere persoon die een niveau oproept, wordt bereikt zoals diens eigen bereikbaarheidsregels voorschrijven: **Gebruikersinstellingen** > **Bereikbaarheidsregels**, met een tabblad voor incidenten, incidentepisodes, waarschuwingen en waarschuwingsepisodes, en per ernst een kaart die laat zien welke meldingsmethode na hoeveel tijd wordt geprobeerd. Een projectbeheerder kan de regels van een lid bekijken en wijzigen onder **Gebruikers** > het lid > **Bereikbaarheidsregels**.

```mermaid title="Wie een niveau oproept en hoe iedere persoon wordt bereikt"
flowchart TB
    subgraph notify["Op de hoogte stellen"]
        direction LR
        schedule["Bereikbaarheidsschema"]
        team["Team"]
        user["Persoon"]
    end
    schedule -->|"wie er dienst heeft"| person["Opgeroepen persoon"]
    team -->|"elk lid"| person
    user -->|"rechtstreeks"| person
    person --> rules["Diens bereikbaarheidsregels"]
    rules --> methods["Diens meldingsmethoden"]
```

Een override die voor een persoon geldt, stuurt diens oproepen naar de persoon die hem of haar vervangt.

Elk bericht is er een dat de provider aanneemt, dus een oproep gaat altijd de deur uit. Zoveel draagt elk kanaal:

| Kanaal | Het langste bericht dat het draagt |
| --- | --- |
| SMS | 1.600 tekens |
| Telefoonoproep | Wat in het belscript van 4.000 tekens van Twilio past |
| Pushmelding | 4 KB, waarvan titel, tekst en gegevens samen hooguit 3 KB innemen |
| WhatsApp | 1.024 tekens |
| Telegram | 4.096 tekens |

Een langer bericht, met een lange titel of een lange beschrijving die een sjabloon erin heeft gezet, wordt ingekort en eindigt met een opmerking dat de volledige tekst in OneUptime staat: "… (truncated — see OneUptime for the full text)". De tekst van een WhatsApp-bericht is een vast sjabloon, dus daar worden in plaats daarvan de langste waarden ingekort, elk eindigend op "…". De links in een bericht worden nooit ingekort.

### Wanneer een oproep niet wordt verstuurd

Een oproep die niet wordt verstuurd, zegt waarom in de **Bereikbaarheidslogboeken** van de persoon (Gebruikersinstellingen): de rij toont **Fout**, en het statusbericht geeft de reden. Hij blijft niet meer op **Sending** staan. Het bericht zegt een van deze dingen:

- het saldo van het project kon hem niet betalen, en wie saldo kan toevoegen;
- het kanaal staat uit in het project, en wie het kan aanzetten.

De eigenaren van het project krijgen daar één keer een e-mail over, totdat het saldo is aangevuld of het kanaal weer aan staat.

Op OneUptime Cloud wordt elke SMS, oproep, WhatsApp- en Telegram-bericht betaald uit het saldo van het project op **Projectinstellingen > Meldingen > Meldingsinstellingen**: de exacte kosten gaan van het saldo af wanneer de provider het bericht aanneemt, hoeveel berichten er ook tegelijk uitgaan.

- Staat **Automatisch bijvullen** daar aan, dan voegt het bericht dat het saldo onder de drempel aantreft eerst het bedrag toe waarop automatisch bijvullen is ingesteld, en belast daarvoor de kaart van het project; berichten die het saldo op hetzelfde moment laag aantreffen, belasten de kaart één keer.
- Mislukt die betaling (er is geen betaalmethode of de kaart is geweigerd), dan probeert automatisch bijvullen de kaart een uur later opnieuw, en **Meldingsinstellingen** meldt dat tot dan bovenaan. Handmatig saldo toevoegen, of automatisch bijvullen opnieuw opslaan, probeert het meteen.
- Oproepen blijven uitgaan op het resterende saldo zolang automatisch bijvullen de kaart niet kan belasten.

> [!IMPORTANT]
> SMS, telefoonoproepen, WhatsApp en Telegram staan uit in een nieuw project: op OneUptime Cloud wordt elk bericht betaald uit het saldo van het project, en een zelfgehoste installatie heeft eerst een Twilio-account of een ingestelde Telegram-bot nodig. Zolang een kanaal uit staat, kan niemand in het project er een methode op toevoegen. Alleen een projecteigenaar of iemand met de rol **Billing Admin** of de machtiging **Manage Billing** kan er een aanzetten, in de kaart **Meldingskanalen** onder **Projectinstellingen > Meldingen > Meldingsinstellingen** — een projectbeheerder kan dat niet. Alle anderen krijgen overal waar een kanaal uit staat precies te horen wie het kan aanzetten: boven hun eigen lijst met methoden op dat kanaal, op hun installatiechecklist en in het bericht dat ze krijgen wanneer iets het kanaal nodig heeft.

## Regels bewerken, herordenen en verwijderen

De kaart van elke regel heeft **Edit rule**, en een **⋯**-menu met de andere acties:

- **Edit rule** opent hetzelfde dialoogvenster van één pagina, ingevuld met de regel zoals die is: de ontvangers, de wachttijd, en de naam en beschrijving onder **Meer velden**. Voeg ontvangers toe of verwijder ze en klik op **Wijzigingen opslaan**. Wordt de naam leeggemaakt, dan krijgt de regel weer de naam van zijn niveau.
- **Move up** en **Move down** in het **⋯**-menu van een regel wijzigen het niveau. Een regel die naar zijn niveau is genoemd, houdt een naam die bij zijn plaats past: wanneer **Level 3** voorbij **Level 2** omhoog gaat, wisselen beide van naam. Een naam die u zelf koos, zoals **Managers**, blijft hetzelfde waar de regel ook heen gaat.
- **Delete rule** vraagt eerst om bevestiging en zegt wie het niveau oproept. Verwijdert u een niveau, dan schuiven de niveaus eronder omhoog, en regels die naar hun niveau zijn genoemd, worden mee hernoemd.

## Regels maken met de API of Terraform

Escalatieregels zijn de resource `/api/on-call-duty-policy-escalation-rule`; de personen, teams en schema's die een regel oproept, zijn de resources `/api/on-call-duty-policy-escalation-rule-user`, `-team` en `-schedule`.

- Een regel die zonder `name` wordt gemaakt, wordt net als in het dashboard naar zijn niveau genoemd: **Level 3** voor een regel die het derde niveau van zijn beleid wordt. De Terraform-resource voor escalatieregels vraagt nog steeds om een naam.
- `escalateAfterInMinutes` heeft buiten het dashboard geen standaardwaarde. Een regel die zonder deze waarde wordt gemaakt, wacht niet: het volgende niveau wordt opgeroepen zodra dit niveau is uitgevoerd. Stel de waarde expliciet in — het dashboard stelt 30 voor.
- Een regel die wordt gemaakt met `onCallSchedules`, `teams` of `users` (lijsten met id's) in de `miscDataProps`, krijgt die ontvangers; zo stuurt de kiezer **Op de hoogte stellen** van het dashboard ze mee. Een regel die zonder deze lijsten wordt gemaakt, roept niemand op totdat u ontvangers toevoegt via de resources hierboven.
- Regels die naar hun niveau zijn genoemd, worden hernoemd wanneer u regels in het dashboard verplaatst of verwijdert. Wijzigt u `order` via de API of Terraform, dan verandert alleen de volgorde.
- Een bereikbaarheidsbeleid dat via `/api/on-call-duty-policy` wordt gemaakt met `onCallSchedules`, `teams` of `users` (lijsten met id's) in de `miscDataProps`, krijgt net als in het dashboard zijn eerste escalatieregel: **Level 1**, die hen oproept, met een `escalateAfterInMinutes` van 30. Elke id moet bij het project horen en de aanroeper moet escalatieregels mogen maken; anders wordt het beleid niet gemaakt. Een beleid dat zonder deze lijsten wordt gemaakt, heeft zoals voorheen geen regels; de Terraform-resource voor beleid stuurt ze niet mee.

```bash
curl -X POST https://oneuptime.com/api/on-call-duty-policy \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "projectId": "<project-id>",
      "name": "Production on-call"
    },
    "miscDataProps": {
      "onCallSchedules": ["<schedule-id>"],
      "users": ["<user-id>"]
    }
  }'
```

## Volgende stappen

:::cards
- [Bereikbaarheidsschema's](/docs/on-call/schedules): Bouw de roosters die een niveau oproept.
- [Tijdlijn van bereikbaarheidsschema's](/docs/on-call/schedule-timeline): Bekijk wie er dienst heeft in alle schema's, en vind dekkingsgaten.
- [Beleid voor inkomende oproepen](/docs/on-call/incoming-call-policy): Laat bellers de dienstdoende engineer per telefoon bereiken.
:::
