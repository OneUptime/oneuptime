# Waarschuwingen en incidenten voor verbruikssnelheid

Foutbudgetten vertellen u waar u staat; regels voor verbruikssnelheid vertellen u wanneer u uit bed moet. Als een SLO zijn foutbudget snel genoeg uitgeeft om ertoe te doen, geeft een regel voor verbruikssnelheid een waarschuwing, meldt hij een incident of allebei, met uw eigen titel en beschrijving, ernst, eigenaren, labels, escalatie naar de dienstdoende en meldingen in de werkruimte.

:::cards
- [Hoe een regel beslist](#hoe-een-regel-beslist-af-te-gaan): Twee vensters, allebei boven de drempel.
- [Standaardregels](#standaardregels): Fast burn en Slow burn, afgestemd op het venster van de SLO.
- [Een regel maken](#een-regel-maken-of-bewerken): Vijf stappen op de pagina Burn Rate Rules van de SLO.
- [Sjabloonvariabelen](#wat-elke-waarschuwing-en-elk-incident-zegt): Schrijf uw eigen titels en beschrijvingen.
:::

## Wat verbruikssnelheid betekent

De verbruikssnelheid is hoe snel u het foutbudget uitgeeft, vergeleken met een gelijkmatig tempo:

```text
burn rate = (share of time that was bad) ÷ (share of time the target allows to be bad)
```

Bij een verbruikssnelheid van 1 geeft u het budget precies over het venster uit en haalt u het doel zonder iets over te houden. Hogere getallen maken het eerder op. Voor een SLO van 99,9% over 30 dagen:

| Verbruikssnelheid, als die aanhoudt | Budget op na |
| --- | --- |
| 1 | 30 dagen |
| 2 | 15 dagen |
| 6 | 5 dagen |
| 14.4 | ongeveer 2 dagen (50 uur) |

De verbruikssnelheid hangt niet af van hoeveel budget er over is. Ze beantwoordt "hoe erg is het nu?", en dat is wat u moet weten om te beslissen of u iemand oproept.

## Hoe een regel beslist af te gaan

OneUptime controleert elke ingeschakelde regel voor verbruikssnelheid bij elke evaluatie van de SLO, elke 5 minuten. Elke regel meet de verbruikssnelheid over twee vensters en gaat alleen af als beide op of boven zijn drempel zitten:

- Het **lange venster** (bijvoorbeeld 1 uur) laat zien dat het verbruik aanhoudt en ertoe doet, en niet één mislukte controle is.
- Het **korte venster** (bijvoorbeeld 5 minuten) laat zien dat het nog steeds gebeurt. Zonder dat venster zou een piek van een uur geleden blijven waarschuwen, lang nadat alles hersteld is.

Dat is het patroon met meerdere vensters en meerdere verbruikssnelheden uit het Google SRE Workbook, en wat OneUptime voor u instelt.

```mermaid title="Wat een regel voor verbruikssnelheid bij elke evaluatie doet"
flowchart TB
    start["De SLO wordt geëvalueerd"] --> long(["Lang venster<br/>op of boven<br/>de drempel?"])
    long -->|"Nee"| recover["Open items oplossen,<br/>als automatisch<br/>oplossen aan staat"]
    long -->|"Ja"| short(["Kort venster<br/>op of boven<br/>de drempel?"])
    short -->|"Nee"| hold["Open laten wat<br/>open staat"]
    short -->|"Ja"| fire["Waarschuwing geven,<br/>incident melden<br/>of allebei"]
```

Een regel kan pas afgaan als de SLO een volledig lang venster aan bewakingsgeschiedenis heeft: anders zou de allereerste mislukte controle van een monitor, gedeeld door een paar minuten geschiedenis, een enorme verbruikssnelheid opleveren. Een nieuwe SLO kan zijn regel **Fast burn** dus niet in het eerste uur laten afgaan, en zijn regel **Slow burn** niet in de eerste zes. Heeft een SLO later niet meer zoveel geschiedenis, bijvoorbeeld nadat zijn monitoren zijn vervangen door nieuwe, dan lost de regel op wat hij had geopend in plaats van het te laten hangen. Een regel gaat ook niet af terwijl een van de monitoren van de SLO in gepland onderhoud is: zie [Gepland onderhoud](#gepland-onderhoud).

## Standaardregels

Elke nieuwe SLO krijgt twee regels voor verbruikssnelheid. Voor een venster van 30 dagen:

| Regel | Drempel | Lang venster | Kort venster | Gaat af als |
| --- | --- | --- | --- | --- |
| **Fast burn** | 14.4× | 1 uur | 5 minuten | Ongeveer 2% van het budget in een uur opgaat: het zou in ongeveer 2 dagen op zijn. |
| **Slow burn** | 6× | 6 uur | 30 minuten | Ongeveer 5% van het budget in zes uur opgaat: het zou in ongeveer 5 dagen op zijn. |

De drempels van 14.4× en 6× zijn berekend voor een budget van 30 dagen, dus OneUptime stemt ze af op het venster van uw SLO. Elke regel betekent altijd "2% van het budget in 1 uur" of "5% van het budget in 6 uur":

| Venster van de SLO | Drempel Fast burn | Drempel Slow burn |
| --- | --- | --- |
| 7 dagen | 3.36× | 1.4× |
| 28 dagen | 13.44× | 5.6× |
| 30 dagen | 14.4× | 6× |
| 90 dagen | 43.2× | 18× |

SLO's met een kalendermaand krijgen de waarden van 30 dagen. Beide regels geven een waarschuwing met de hoogste waarschuwingsernst van het project, met de standaardtitel en -beschrijving, lossen die automatisch op en voegen geen eigenaren of labels toe. Ze melden geen incidenten, dus een upgrade van OneUptime begint nooit voor u incidenten te melden. Bewerk ze, verwijder ze of voeg uw eigen regels toe.

## Een regel maken of bewerken

U hebt toestemming nodig om SLO-regels voor verbruikssnelheid aan te maken.

:::steps
### Burn Rate Rules openen

Open de SLO, ga naar **Burn Rate Rules** en klik op **SLO Burn Rate Rule aanmaken**, of bewerk een van de standaardregels.

### De regel een naam geven

Vul onder **Rule** een **Naam** in, zoals "Fast burn". **Ingeschakeld** staat aan.

### Het verbruiksvenster instellen

Stel onder **Burn Window** de **Burn Rate Threshold** in (bijvoorbeeld `14.4`), de **Long Window (Minutes)** en de **Short Window (Minutes)**, en eventueel de **Re-fire Suppression (Minutes)**.

### Kiezen wat hij meldt

Zet onder **What It Declares** **Waarschuwing maken**, **Incident melden** of allebei aan. **Add SLO Owners as Owners** maakt de eigenaren van de SLO ook eigenaar van alles wat de regel aanmaakt.

### De waarschuwing en het incident beschrijven

De stappen **Waarschuwing** en **Incident** verschijnen alleen voor wat de regel meldt. Elk heeft een titel en een ernst, en ingeklapte secties: **Beschrijving**, **Eigendom & labels**, **Bereikbaarheid** en **Meer velden**, met automatisch oplossen, privacy en herstelnotities. Nieuwe regels beginnen met de standaardtitel en -beschrijving, klaar om te bewerken. Klik in de laatste stap op **SLO Burn Rate Rule aanmaken**.
:::

OneUptime controleert de getallen van een regel als u hem opslaat:

| Instelling | Moet zijn |
| --- | --- |
| **Burn Rate Threshold** | Groter dan 0. |
| **Short Window (Minutes)** | Groter dan 0. |
| **Long Window (Minutes)** | Langer dan het korte venster. |
| **Re-fire Suppression (Minutes)** | 0 of meer. Leeg betekent de lengte van het lange venster. |

Een regel moet een waarschuwing maken, een incident melden of allebei: een regel waarbij beide uit staan, wordt geweigerd, omdat hij bij elke evaluatie zou worden gecontroleerd zonder ooit iets te melden.

De regeltabel toont voor elke regel de drempel, de vensters en de onderdrukking, wat hij meldt (en of de waarschuwing of het incident alleen met de hand wordt opgelost, of privé is), de ernstniveaus, het bereikbaarheidsbeleid, de eigenaren en de labels.

> [!TIP]
> Een goed begin: houd de twee standaardregels, stuur de regel voor snel verbruik met een hoge ernst naar uw bereikbaarheidsbeleid dat mensen oproept, en laat de regel voor langzaam verbruik een waarschuwing met lagere ernst geven voor kantooruren. Werkt uw team met incidenten, zet dan **Incident melden** aan op de regel voor snel verbruik, en zet daar **Waarschuwing maken** uit als u niet allebei wilt krijgen.

## Wat een regel meldt

|  | **Waarschuwing maken** | **Incident melden** |
| --- | --- | --- |
| Bij het begin | Aan | Uit |
| Wat het is | Het lichte signaal: komt in de lijst met waarschuwingen. | Het zware signaal: krijgt een incidentnummer en start het hele responsproces. |
| Titel en beschrijving | Eigen, of de standaardtekst | Eigen, of de standaardtekst |
| Ernst | **Ernst van waarschuwing**: de hoogste van het project als leeg | **Ernst van incident**: de hoogste van het project als leeg |
| Escalatie | **Alert On-Call Duty Policies** | **Incident On-Call Duty Policies** |
| Eigenaren en labels | **Eigenaren van de waarschuwing** en **Waarschuwingslabels** | **Eigenaren van het incident** en **Incident-labels** |
| Privé | Uit | Uit |
| Automatisch oplossen | Aan | Aan |
| Statuspagina's | Nooit gepubliceerd | Nooit gepubliceerd |

Omdat elk apart wordt ingesteld, kunt u een korte waarschuwing naar het rooster van het verantwoordelijke team sturen en een uitgebreid incident naar uw rooster voor grote incidenten. Ze leven ook apart: elk wordt op zichzelf ontdubbeld, opgelost en onderdrukt, dus het incident oplossen zet de onderdrukking van de waarschuwing niet terug, en andersom.

### De SLO is een getroffen resource

Elke waarschuwing en elk incident dat een regel voor verbruikssnelheid aanmaakt, toont zijn SLO onder **Getroffen resources** en linkt ernaartoe. Het filter **Getroffen resources** van de lijsten met waarschuwingen en incidenten beperkt ze tot één SLO, en de pagina's **Waarschuwingen** en **Incidenten** van de SLO tonen ze, met badges in het zijmenu die de open items tellen. OneUptime legt deze koppeling zelf, en het bewerken van de waarschuwing of het incident haalt haar nooit weg.

### Incidenten voor verbruikssnelheid blijven intern

Een foutbudget dat snel opraakt, is een signaal voor engineering, geen gemelde storing. Een incident voor verbruikssnelheid wordt nooit op statuspagina's getoond en informeert nooit abonnees van statuspagina's. Het is ook niet aan monitoren gekoppeld, omdat het oplossen ervan anders precies de statusgeschiedenis van de monitoren zou herschrijven waaruit de SLO wordt gemeten.

Lost u zo'n incident met de hand op, dan meldt niets het opnieuw totdat het verbruik is hersteld en de regel echt weer afgaat, zodat u nooit tegen de regel hoeft te vechten terwijl u aan een incident werkt.

## Wat elke waarschuwing en elk incident zegt

Nieuwe regels beginnen met de standaardtitel en -beschrijving, zowel bij de waarschuwing als bij het incident. Maak een titel of beschrijving leeg om terug te gaan naar de standaardtekst. De standaardtitel is:

```text
SLO burn rate: {{sloName}} — {{ruleName}}
```

De standaardbeschrijving noemt de regel, geeft de verbruikssnelheid van beide vensters tegenover de drempel en het resterende foutbudget.

Om uw eigen tekst te schrijven, gebruikt u sjabloonvariabelen in de titel, de beschrijving en de herstelnotities. Elk van die velden toont ze onder **Sjabloonvariabelen**: klik op een variabele om haar op de cursor in te voegen, of typ `{{` in het veld en kies er een. De beschrijving en de herstelnotities hebben ook **Variabele invoegen** in hun werkbalk. De variabelen worden ingevuld als de regel afgaat:

| Variabele | Wat erin staat | Voorbeeld |
| --- | --- | --- |
| `{{sloName}}` | Naam van de SLO. | `Checkout availability` |
| `{{sloId}}` | ID van de SLO. | `b7f4c2d8-1f3e-4a5b-9c6d-7e8f9a0b1c2d` |
| `{{sloLink}}` | Link naar de SLO in het OneUptime-dashboard. | `https://oneuptime.com/dashboard/project-id/slos/slo-id` |
| `{{sloStatus}}` | Status van de SLO na deze evaluatie. | `At Risk` |
| `{{ruleName}}` | Naam van de regel voor verbruikssnelheid die afging. | `Fast burn` |
| `{{burnRateThreshold}}` | De drempel voor verbruikssnelheid van de regel (een veelvoud van het houdbare tempo). | `14.4` |
| `{{longWindowBurnRate}}` | Verbruikssnelheid gemeten over het lange venster van de regel. | `21.5` |
| `{{shortWindowBurnRate}}` | Verbruikssnelheid gemeten over het korte venster van de regel. | `36` |
| `{{longWindowInMinutes}}` | Lengte van het lange venster van de regel, in minuten. | `60` |
| `{{shortWindowInMinutes}}` | Lengte van het korte venster van de regel, in minuten. | `5` |
| `{{targetPercentage}}` | Het doel van de SLO, als percentage. | `99.9` |
| `{{currentSliPercentage}}` | De SLI gemeten over het compliancevenster van de SLO, als percentage. | `99.87` |
| `{{errorBudgetRemainingPercentage}}` | Aandeel van het foutbudget dat nog beschikbaar is, als percentage. Negatief als het budget is overschreden. | `42.5` |
| `{{errorBudgetRemaining}}` | Foutbudget dat nog beschikbaar is, als duur. Begint met een minteken als het budget is overschreden. | `18m 22s` |
| `{{errorBudgetRemainingMinutes}}` | Foutbudget dat nog beschikbaar is, in minuten. | `18.37` |
| `{{windowDescription}}` | Het compliancevenster van de SLO, in woorden. | `rolling 30-day window` |

Zo wordt de titel `{{ruleName}}: {{sloName}} is burning {{longWindowBurnRate}}x` bijvoorbeeld `Fast burn: Checkout availability is burning 21.5x`.

:::details Hoe variabelen worden ingevuld
- Getallen worden afgerond op twee decimalen.
- Spaties binnen de accolades zijn geen probleem: `{{ sloName }}` werkt.
- Een verkeerd gespelde variabele blijft precies zoals ze is, zodat een typfout in de waarschuwing zichtbaar wordt in plaats van stilletjes te verdwijnen.
- Titels mogen 500 tekens lang zijn, beschrijvingen en herstelnotities 50.000. Een titel die na het invullen van variabelen langer is dan 500 tekens, wordt op één regel gezet en met een beletselteken ingekort, zodat de waarschuwing of het incident toch wordt aangemaakt.
- Kan de link naar de SLO niet worden opgebouwd als de regel afgaat, dan blijft `{{sloLink}}` leeg en wordt de waarschuwing of het incident toch aangemaakt.
:::

## Eigenaren, labels en privacy

- **Eigenaren van de waarschuwing** en **Eigenaren van het incident** zijn mensen en teams, gekozen uit één lijst met **Eigenaar toevoegen**. Ze worden toegevoegd aan de waarschuwing of het incident zodra die wordt aangemaakt, en krijgen een melding. Mensen moeten lid van het project zijn.
- **Add SLO Owners as Owners** voegt ook de eigenaren van de SLO, zijn eigenaarsgebruikers en de leden van zijn eigenaarsteams, toe aan alles wat de regel aanmaakt. De eigenaren van de SLO horen al over de statuswijzigingen van de SLO zelf, dus dit kan ze twee keer informeren. Het staat standaard uit.
- Elke eigenaar wordt één keer toegevoegd: een gebruiker die al eigenaar van de waarschuwing of het incident is, bijvoorbeeld via de eigenaarsregels van het project, of die in een toegevoegd eigenaarsteam zit, wordt niet nog eens toegevoegd.
- **Waarschuwingslabels** en **Incident-labels** worden aan de waarschuwing of het incident toegevoegd, zodat filters, eigenaarsregels en meldingsregels voor de werkruimte erop kunnen letten.
- Een privé-waarschuwing of -incident is alleen zichtbaar voor de eigenaren, projectbeheerders en projecteigenaren.

Labels, eigenaarsteams en bereikbaarheidsbeleid moeten bij het project van de SLO horen.

## Oplossen en onderdrukken van nieuwe meldingen

- **Oplossen volgt het lange venster.** Met automatisch oplossen aan (de standaard) lost OneUptime de waarschuwing en het incident van een regel op zodra de verbruikssnelheid van het lange venster onder de drempel zakt. Oplossen op het korte venster zou heen en weer springen: een terugkerende storing zou na vijf rustige minuten worden opgelost en de hele nacht opnieuw mensen oproepen.
- **Automatisch oplossen uit.** Zet **Waarschuwing automatisch oplossen** of **Incident automatisch oplossen** uit en dat record blijft open tot iemand het oplost, ook nadat het verbruik is hersteld. De regel opent er geen tweede bovenop, en zodra het met de hand is opgelost en het lange venster onder de drempel zit, kan de regel na zijn onderdrukking weer afgaan.
- **Onderdrukking van nieuwe meldingen.** Nadat een record is opgelost, meldt de regel dat soort record niet opnieuw tijdens de onderdrukkingsperiode, standaard de lengte van het lange venster. Zo krijgt een systeem dat herstelt de tijd om te herstellen zonder mensen op te roepen voor de ruis die overblijft.

Sommige wijzigingen lossen altijd op wat een regel heeft geopend, wat de instellingen voor automatisch oplossen ook zeggen, zodat niets blijft escaleren voor een regel die het niet meer kan rechtvaardigen:

- **Waarschuwing maken** of **Incident melden** uitzetten sluit wat die uitvoer had geopend;
- de regel uitzetten of verwijderen;
- de evaluatie van de SLO uitzetten, de SLO archiveren of verwijderen;
- de SLO die naar **Gepauzeerd** of **Misconfigured** gaat, omdat hij dan niets meet;
- de regel die zijn drempel of vensters kwijtraakt, of de SLO die geen volledig lang venster aan geschiedenis meer heeft.

## Gepland onderhoud

Terwijl een monitor van de SLO in een lopend gepland onderhoud zit, geven zijn regels voor verbruikssnelheid geen waarschuwingen en melden ze geen incidenten: gepland werk mag niemand oproepen. Wat de regels al hadden geopend, wordt nog steeds gewoon opgelost. De tijd telt nog steeds mee voor het foutbudget, volgens de downtime-statussen van de SLO.

## De feed van de SLO

De **Feed** van de SLO publiceert elke waarschuwing die een regel geeft en elk incident dat hij meldt, met een link en de verbruikssnelheden die het verklaren, en wanneer elk wordt opgelost, automatisch of met de hand. Een record dat de regel weer oppakt omdat het nog open was, wordt niet twee keer gepubliceerd. Het aanmaken, bewerken en verwijderen van een regel wordt ook gepubliceerd, en vastgelegd in de **Auditlogboeken** van de SLO. Zie [SLO-feed en auditlogboeken](/docs/slo/feed-and-audit-logs).

## Problemen oplossen

:::details Een regel ging niet af direct nadat de SLO was aangemaakt
Een regel gaat pas af als de SLO een volledig lang venster aan bewakingsgeschiedenis heeft: een uur voor de standaardregel voor snel verbruik, zes uur voor die voor langzaam verbruik.
:::

:::details Een waarschuwing werd opgelost terwijl de storing nog bezig was
Automatisch oplossen volgt het lange venster: zodra de verbruikssnelheid van het lange venster onder de drempel zakt, wordt de waarschuwing opgelost. Geef de regel een langer lang venster, of zet **Waarschuwing automatisch oplossen** uit en los de waarschuwing met de hand op.
:::

:::details Niets ging af tijdens gepland onderhoud
Regels voor verbruikssnelheid blijven stil terwijl een van de monitoren van de SLO in een lopend gepland onderhoud zit. De downtime telt nog steeds mee voor het budget.
:::

:::details Is er een minimaal aantal metingen?
Niet voor SLO's die worden gemeten aan de beschikbaarheid van monitoren. Beschikbaarheid wordt in seconden gemeten, dus elke seconde van het venster is een meting en er is geen geval met weinig verkeer om tegen te beschermen. Een minimaal aantal metingen doet er alleen toe voor op gebeurtenissen gebaseerde SLI's, die nog niet beschikbaar zijn.
:::

## Volgende stappen

:::cards
- [Foutbudgetten](/docs/slo/error-budget): Wat het budget is en hoelang het meegaat.
- [Escalatieregels](/docs/on-call/escalation-rules): Wie wordt opgeroepen, en in welke volgorde.
- [SLO-feed en auditlogboeken](/docs/slo/feed-and-audit-logs): Elke waarschuwing en elk incident dat een regel geeft.
:::
