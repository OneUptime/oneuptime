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
- [De volgende persoon in de rotatie](#escaleren-naar-de-volgende-persoon-in-de-rotatie): Roep de back-up van wie dienst heeft op, uit dezelfde rotatie.
- [Een oproep escaleren](#een-oproep-escaleren): Kunt u een oproep niet aannemen? Laat meteen het volgende niveau oproepen.
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
| De **Volgende in de rotatie** van een schema | De persoon na wie er dienst in heeft, uit dezelfde rotatie. Zie [Escaleren naar de volgende persoon in de rotatie](#escaleren-naar-de-volgende-persoon-in-de-rotatie). |
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

Klik op **Regel maken**. De regel wordt onder de andere toegevoegd, als het volgende niveau van het beleid.
:::

## Hoe de niveaus mensen oproepen

Wanneer een incident of waarschuwing het beleid bereikt, roept **Level 1** meteen zijn ontvangers op. Als niemand binnen de wachttijd bevestigt, wordt **Level 2** opgeroepen, enzovoort de lijst af. Is de wachttijd van het laatste niveau verstreken zonder bevestiging, dan begint het beleid opnieuw bij **Level 1** als het **Herhaalbeleid** (onder de regels) herhalen voorschrijft, zo vaak als dat toestaat, en anders stopt het. Het incident of de waarschuwing bevestigen of oplossen stopt het oproepen op elk niveau. Wie wordt opgeroepen en de oproep niet kan aannemen, kan hem escaleren, en het volgende niveau wordt zonder wachten opgeroepen: zie [Een oproep escaleren](#een-oproep-escaleren).

Een incident, waarschuwing of episode die al bevestigd of opgelost wordt aangemaakt — achteraf vastgelegd — voert geen enkel beleid uit: niemand wordt opgeroepen, en de feed meldt dat, met de namen van het beleid erbij. Zie [Al bevestigd of opgelost gemeld](/docs/incidents/declaring-incidents#al-bevestigd-of-opgelost-gemeld).

Om een beleid te herhalen, klikt u op **Bewerken** op de kaart **Herhaalbeleid**, kiest u **Opnieuw beginnen bij Level 1** en vult u **Hoe vaak nog?** in.

### Het escalatieoverzicht

Het overzicht boven aan de pagina **Escalatieregels** toont de hele ladder: wanneer elk niveau wordt opgeroepen, wie het oproept en wat er na het laatste gebeurt. Een niveau waarvan niet alle ontvangers kunnen worden opgeroepen, meldt dat op zijn kaart; klik op het label om te zien wie en waarom.

### Hoe iedere persoon wordt bereikt

Iedere persoon die een niveau oproept, wordt bereikt zoals diens eigen bereikbaarheidsregels voorschrijven: **Gebruikersinstellingen** > **Bereikbaarheidsregels**, met een tabblad voor incidenten, incidentepisodes, waarschuwingen en waarschuwingsepisodes, en per ernst een kaart die laat zien welke meldingsmethode na hoeveel tijd wordt geprobeerd. Een projectbeheerder kan de regels van een lid bekijken en wijzigen onder **Gebruikers** > het lid > **Bereikbaarheidsregels**. Zie [Persoonlijke bereikbaarheidsregels](/docs/notifications/on-call-rules).

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

Een override die voor een persoon geldt, stuurt diens oproepen naar de persoon die hem of haar vervangt. Een override die niemand als vervanger noemt, slaat de persoon over: die krijgt geen oproepen, de uitvoering van het beleid vermeldt dat die afwezig is en tot wanneer, en in een bereikbaarheidsschema gaat elke beurt van die persoon naar de volgende persoon in de rotatie. Zie [Gebruikersoverschrijvingen](/docs/on-call/user-overrides).

Elk bericht is er een dat de provider aanneemt, dus een oproep gaat altijd de deur uit. Zoveel draagt elk kanaal:

| Kanaal | Het langste bericht dat het draagt |
| --- | --- |
| SMS | 1.600 tekens |
| Telefoonoproep | Wat in het belscript van 4.000 tekens van Twilio past |
| Pushmelding | 4 KB, waarvan titel, tekst en gegevens samen hooguit 3 KB innemen |
| WhatsApp | 1.024 tekens |
| Telegram | 4.096 tekens |

Een langer bericht, met een lange titel of een lange beschrijving die een sjabloon erin heeft gezet, wordt ingekort en eindigt met een opmerking dat de volledige tekst in OneUptime staat: "… (truncated — see OneUptime for the full text)". De tekst van een WhatsApp-bericht is een vast sjabloon, dus daar worden in plaats daarvan de langste waarden ingekort, elk eindigend op "…". De links in een bericht worden nooit ingekort.

### Wat de sms van een oproep zegt

Een sms wordt verstuurd, en betaald, in delen van 160 tekens. Een oproep per sms is zo geschreven dat hij waar het kan in één deel past, en zegt alleen wat u nodig hebt op een vergrendelde telefoon: wie hem stuurt, wat er is gebeurd en de ene link om de oproep te bevestigen of te escaleren. Op een telefoon ziet hij er zo uit:

```text
OneUptime: Critical Incident INC-42 in Acme Prod: Checkout API is down.
Ack or escalate: https://oneuptime.com/l/XJlaZRsd
```

Hij noemt de ernst en wat er is gebeurd (een incident, een waarschuwing of een episode van een van beide), het nummer, het project en de titel, in die volgorde. Als niet alles in één deel past:

1. Eerst wordt het project weggelaten.
2. Daarna wordt de titel ingekort, en eindigt hij op `...`.

De ernst, het nummer en de link worden nooit ingekort. Een titel houdt minstens 20 tekens: past zelfs dat niet, bijvoorbeeld bij een heel lang adres of een heel lange productnaam, dan neemt de sms een tweede deel en zegt hij alles.

Roept een beleid opnieuw op omdat een bevestigd incident of een bevestigde waarschuwing nog steeds niet is opgelost, dan zegt de sms dat na het nummer en het project, en ook die woorden worden nooit ingekort:

```text
OneUptime: Critical Incident INC-42 in Acme Prod is still not resolved:
Checkout API is down. Ack or escalate: https://oneuptime.com/l/XJlaZRsd
```

Eén teken buiten het eenvoudige alfabet van sms'jes laat het hele bericht in delen van 70 tekens vertrekken. Daarom worden gekrulde aanhalingstekens en gedachtestreepjes geschreven als `"`, `'` en `-`, `…` als `...`, en verliezen letters als `ç` en `ł` hun accenten; emoji worden weggelaten. Een titel in een ander schrift, zoals Japans of Russisch, wordt verstuurd zoals hij is geschreven, en neemt twee delen of meer.

De andere sms'jes die OneUptime u stuurt, bijvoorbeeld over een wijziging in een incident waarvan u eigenaar bent of het begin van uw dienst, beginnen ook met `OneUptime:` en eindigen met `Turn off in User Settings > Notification Settings.`, een zin die wordt weggelaten als de sms juist daardoor in één deel past.

### Wanneer een oproep niet wordt verstuurd

Een oproep die niet wordt verstuurd, zegt waarom in de **Bereikbaarheidslogboeken** van de persoon (Gebruikersinstellingen): de rij toont **Fout**, en het statusbericht geeft de reden. Hij blijft niet meer op **Bezig met verzenden** staan. Het bericht zegt een van deze dingen:

- het saldo van het project kon hem niet betalen, en wie saldo kan toevoegen;
- het kanaal staat uit in het project, en wie het kan aanzetten.

De eigenaren van het project krijgen daar één keer een e-mail over, totdat het saldo is aangevuld of het kanaal weer aan staat.

Op OneUptime Cloud wordt elke SMS, oproep, WhatsApp- en Telegram-bericht betaald uit het saldo van het project op **Projectinstellingen > Meldingen > Meldingsinstellingen**: de exacte kosten gaan van het saldo af wanneer de provider het bericht aanneemt, hoeveel berichten er ook tegelijk uitgaan.

- Staat **Automatisch bijvullen** daar aan, dan voegt het bericht dat het saldo onder de drempel aantreft eerst het bedrag toe waarop automatisch bijvullen is ingesteld, en belast daarvoor de kaart van het project; berichten die het saldo op hetzelfde moment laag aantreffen, belasten de kaart één keer.
- Mislukt die betaling (er is geen betaalmethode of de kaart is geweigerd), dan probeert automatisch bijvullen de kaart een uur later opnieuw, en **Meldingsinstellingen** meldt dat tot dan bovenaan. Handmatig saldo toevoegen, of automatisch bijvullen opnieuw opslaan, probeert het meteen.
- Oproepen blijven uitgaan op het resterende saldo zolang automatisch bijvullen de kaart niet kan belasten.

> [!IMPORTANT]
> SMS, telefoonoproepen, WhatsApp en Telegram staan uit in een nieuw project: op OneUptime Cloud wordt elk bericht betaald uit het saldo van het project, en een zelfgehoste installatie heeft eerst een Twilio-account of een ingestelde Telegram-bot nodig. Zolang een kanaal uit staat, kan niemand in het project er een methode op toevoegen. Alleen een projecteigenaar of iemand met de rol **Factureringsbeheerder** of de machtiging **Manage Billing** kan er een aanzetten, in de kaart **Meldingskanalen** onder **Projectinstellingen > Meldingen > Meldingsinstellingen** — een projectbeheerder kan dat niet. Alle anderen krijgen overal waar een kanaal uit staat precies te horen wie het kan aanzetten: boven hun eigen lijst met methoden op dat kanaal, op hun installatiechecklist en in het bericht dat ze krijgen wanneer iets het kanaal nodig heeft.

## Escaleren naar de volgende persoon in de rotatie

Een niveau kan de volgende persoon in de rotatie van een bereikbaarheidsschema oproepen: de persoon na wie er dienst in heeft. Zo kan een beleid eerst wie dienst heeft oproepen, dan diens back-up uit dezelfde rotatie en dan een team of een manager, allemaal vanuit één schema.

| Niveau | Op de hoogte stellen | Wie wordt opgeroepen |
| --- | --- | --- |
| **Level 1** | Het schema Payments primary | Wie er dienst in heeft, bijvoorbeeld Alex |
| **Level 2** | De **Volgende in de rotatie** van hetzelfde schema | De persoon na Alex in de rotatie, bijvoorbeeld Sam |
| **Level 3** | Het team Platform | Elk lid van het team |

:::steps
1. Zorg dat het eerste niveau van het beleid, **Level 1**, het bereikbaarheidsschema op de hoogte stelt.
2. Klik op **Escalatieregel toevoegen**, dan op **Ontvanger toevoegen**, en kies hetzelfde schema onder **Volgende in de rotatie**. Stel **Escaleren na (in minuten)** in en klik op **Regel maken**.
3. Voeg nog een niveau toe voor het team of de manager die het daarna moet horen.
:::

De volgende persoon wordt bepaald wanneer het niveau wordt uitgevoerd, op basis van het schema zoals het dan is:

- Het is de persoon na wie er dienst heeft, in de volgorde waarin de mensen van de rotatie elkaar afwisselen. Na de laatste persoon komt weer de eerste.
- Afwezige mensen worden overgeslagen, of iemand hen nu vervangt of niet, en ook wie dienst heeft in de plaats van iemand anders.
- Het is altijd iemand uit dezelfde rotatie: bij meerdere lagen de laag waar wie dienst heeft uit komt. Een rotatie met verder niemand erin, of waarin alle anderen afwezig zijn, heeft geen volgende persoon; het niveau roept daar dan niemand op en meldt dat.
- Heeft er in het schema helemaal niemand dienst, dan is er ook geen volgende persoon, en wordt het niveau een paar minuten lang opnieuw geprobeerd, net als bij het schema zelf.

Het bericht van de uitvoering in Slack en Microsoft Teams, de feed van het incident en de **Tijdlijn van de uitvoering** vermelden wie als volgende in de rotatie is opgeroepen, en uit welk schema: "Sam Lee (next in the Payments primary rotation)".

> [!TIP]
> Eén schema is genoeg: er is geen tweede back-upschema dat gelijk moet lopen met het eerste, en de afwezigheid die de mensen erin boeken, telt voor beide niveaus.

## Een oproep escaleren

Wie wordt opgeroepen en de oproep niet kan aannemen, omdat diegene slaapt, in een vliegtuig zit of al aan een ander incident werkt, kan de oproep escaleren in plaats van hem te laten uitgaan. Het beleid roept dan meteen het volgende niveau op, zonder het **Escaleren na (in minuten)** van het niveau af te wachten, en diegene wordt er niet meer over opgeroepen.

```mermaid title="Een oproep escaleren brengt het beleid meteen naar het volgende niveau"
flowchart TB
    page["Level 1 roept Alex op"] --> take{"Kan Alex hem<br/>aannemen?"}
    take -->|"Ja"| ack["Alex bevestigt:<br/>het oproepen stopt"]
    take -->|"Nee"| pass["Alex escaleert hem"]
    pass --> others{"Wordt er op Level 1<br/>nog iemand opgeroepen?"}
    others -->|"Ja"| wait["Het beleid wacht<br/>op hen, zoals eerst"]
    others -->|"Nee"| next["Level 2 wordt<br/>nu opgeroepen"]
```

Elke oproep kunt u escaleren vanaf de plek waar hij u bereikte:

| Waar | Zo escaleert u hem |
| --- | --- |
| E-mail | De knop **Escalate**, dan **Escalate** op de pagina die hij opent |
| Sms en WhatsApp | De link in het bericht opent de bevestigingspagina, waarop ook **Escalate** staat |
| Telegram, Slack en Microsoft Teams | De link "Can't take it? Escalate", dan **Escalate** op de pagina die hij opent |
| Telefoongesprek | Druk op 2. Het gesprek vertelt daarna wat er is gebeurd |
| Pushmelding | Tik erop: het incident, de waarschuwing of de episode opent in de OneUptime On-Call-app, met **Escalate** eronder |
| OneUptime | **Escaleren** bovenaan het incident, de waarschuwing of de episode, na de statusknoppen |

Elke manier behalve het telefoongesprek vraagt het eerst en vertelt wat er gaat gebeuren, zoals "This will immediately page Platform leads (Level 2 of 3), without waiting."; in een telefoongesprek is op 2 drukken het antwoord. Alleen wie wordt opgeroepen, kan de oproep escaleren: de knop in OneUptime verschijnt alleen voor diegene, en de link in een bericht escaleert alleen de oproep waarover het bericht ging, voor de persoon naar wie het ging, gedurende 7 dagen.

Wat er daarna gebeurt, hangt af van wie er nog meer wordt opgeroepen:

- Anderen op hetzelfde niveau worden nog opgeroepen: het beleid wacht op hen, zoals eerst. Het gaat verder wanneer de wachttijd van het niveau verstrijkt, of zodra de laatste van hen de oproep ook escaleert.
- Er is op het niveau niemand anders meer over: het volgende niveau wordt meteen opgeroepen.
- Het was het laatste niveau: als het **Herhaalbeleid** herhalen voorschrijft, begint het beleid meteen opnieuw bij **Level 1**. Anders stopt het oproepen, en moet iemand het oppakken.

Een oproep escaleren bevestigt hem niet: het incident of de waarschuwing wacht nog steeds tot iemand bevestigt, en wie de oproep escaleerde, kan hem nog zelf bevestigen. Deze uitvoering roept diegene er niet meer over op: een later niveau, of een herhaling, dat diegene noemt, slaat diegene over. Zodra iedereen die zij opriep de oproep heeft geëscaleerd en er niemand meer op te roepen is, stopt het oproepen, en de feed van het incident vermeldt dat.

Een oproep die een workflow rechtstreeks naar mensen stuurt, heeft geen niveaus: als u hem escaleert, wordt u niet meer opgeroepen, en zodra iedereen die hij opriep hem heeft geëscaleerd, stopt het oproepen.

Elke keer dat een oproep wordt geëscaleerd, wordt dat vastgelegd. De **Tijdlijn van de uitvoering** markeert de regel van de persoon als **Geëscaleerd**, de feed van het incident zegt "Alex Kim escalated the page from on-call policy Payments at Level 1 of 3.", het bericht van de uitvoering in Slack en Microsoft Teams vermeldt dat diegene hem heeft geëscaleerd, en de **Bereikbaarheidslogboeken** van diegene tonen de oproep als **Geëscaleerd**.

## Regels bewerken, herordenen en verwijderen

De kaart van elke regel heeft **Regel bewerken**, en een **⋯**-menu met de andere acties:

- **Regel bewerken** opent hetzelfde dialoogvenster van één pagina, ingevuld met de regel zoals die is: de ontvangers, de wachttijd, en de naam en beschrijving onder **Meer velden**. Voeg ontvangers toe of verwijder ze en klik op **Wijzigingen opslaan**. Wordt de naam leeggemaakt, dan krijgt de regel weer de naam van zijn niveau.
- **Omhoog** en **Omlaag** in het **⋯**-menu van een regel wijzigen het niveau. Een regel die naar zijn niveau is genoemd, houdt een naam die bij zijn plaats past: wanneer **Level 3** voorbij **Level 2** omhoog gaat, wisselen beide van naam. Een naam die u zelf koos, zoals **Managers**, blijft hetzelfde waar de regel ook heen gaat.
- **Regel verwijderen** vraagt eerst om bevestiging en zegt wie het niveau oproept. Verwijdert u een niveau, dan schuiven de niveaus eronder omhoog, en regels die naar hun niveau zijn genoemd, worden mee hernoemd.

## Regels maken met de API of Terraform

Escalatieregels zijn de resource `/api/on-call-duty-policy-escalation-rule`; de personen, teams en schema's die een regel oproept, zijn de resources `/api/on-call-duty-policy-escalation-rule-user`, `-team` en `-schedule`.

- Een regel die zonder `name` wordt gemaakt, wordt net als in het dashboard naar zijn niveau genoemd: **Level 3** voor een regel die het derde niveau van zijn beleid wordt. De Terraform-resource voor escalatieregels vraagt nog steeds om een naam.
- `escalateAfterInMinutes` heeft buiten het dashboard geen standaardwaarde. Een regel die zonder deze waarde wordt gemaakt, wacht niet: het volgende niveau wordt opgeroepen zodra dit niveau is uitgevoerd. Stel de waarde expliciet in — het dashboard stelt 30 voor.
- Een regel die wordt gemaakt met `onCallSchedules`, `teams` of `users` (lijsten met id's) in de `miscDataProps`, krijgt die ontvangers; zo stuurt de kiezer **Op de hoogte stellen** van het dashboard ze mee. Een regel die zonder deze lijsten wordt gemaakt, roept niemand op totdat u ontvangers toevoegt via de resources hierboven.
- Een regel die wordt gemaakt met `nextInRotationSchedules` (een lijst met schema-id's) in de `miscDataProps`, roept de volgende persoon in de rotatie van elk van die schema's op. Op de resource `-schedule` doet een rij met `pageNextInRotation` op `true` hetzelfde; die waarde wordt gezet wanneer de rij wordt gemaakt.
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
