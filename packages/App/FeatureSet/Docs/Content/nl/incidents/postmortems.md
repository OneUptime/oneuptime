# Postmortem-analyses

Een postmortem is het verslag na een incident: wat er gebeurde, waarom, wat het uw gebruikers kostte en wat er nu verandert. In OneUptime schrijft u het op het incident zelf. Het kan beginnen met uw eigen sjabloon of met een concept van OneUptime AI, en het kan op uw statuspagina worden gepubliceerd als de afsluitende update van het incident. Elk postmortem heeft ook een status, en **Incidenten → Postmortem-analyses** toont het postmortem van elk incident, zodat u ziet welke nog openstaan.

:::cards
- [Een postmortem schrijven](#een-postmortem-schrijven): Op de pagina Postmortem van het incident, in vijf stappen.
- [Beginnen met een sjabloon of een AI-concept](#beginnen-met-een-sjabloon-of-een-ai-concept): Uw eigen opzet, of een die OneUptime AI invult.
- [Het op uw statuspagina publiceren](#het-op-uw-statuspagina-publiceren): Het aan klanten tonen en abonnees één keer informeren.
- [Bijhouden hoe ver elk postmortem is](#bijhouden-hoe-ver-elk-postmortem-is): Niet gestart, Concept, Voltooid of een eigen status.
- [Alle postmortems zien](#alle-postmortems-zien): Filteren op eigenaar, ernst en status om de openstaande te vinden.
- [Actiepunten bijhouden](#actiepunten-bijhouden): Wat het team gaat doen, wie de eigenaar van elk punt is en wat het is geworden.
- [Postmortems van episodes](#postmortems-van-episodes): Eén verslag voor een groep incidenten.
:::

## Hoe een postmortem tot stand komt

Een postmortem heeft drie delen, allemaal op het incident: de notitie, geschreven in Markdown; de bijlagen, zoals schermafbeeldingen en rapporten; en of het op uw statuspagina staat. Ze staan op de pagina **Postmortem** van het incident, onder **Onderzoek** in het zijmenu. Een postmortem heeft ook een status, die zegt hoe ver het is, en eigenaren: die van het incident.

```mermaid title="Van een opgelost incident naar een gepubliceerd postmortem"
flowchart TB
    R["Het incident is opgelost"] --> A["OneUptime AI stelt het op,<br/>als concepten aan staan"]
    R --> W["Of u begint zelf: leeg,<br/>sjabloon of AI"]
    A --> E["Uw team bewerkt het"]
    W --> E
    E --> P{"Publiceren op<br/>de statuspagina?"}
    P -->|"Ja"| S["De statuspagina toont het"]
    S --> N["Abonnees horen<br/>het één keer"]
    P -->|"Nee"| K["Het blijft bij uw team"]
```

## Een postmortem schrijven

:::steps
### Het postmortem openen

Open het incident en klik in het zijmenu onder **Onderzoek** op **Postmortem**. De kaart **Postmortem** toont de **Status** en de **Eigenaren** van het postmortem, de notitie, de bijlagen en of het postmortem op de statuspagina staat. **Eigenaren toevoegen**, naast de eigenaren, maakt een persoon of team uit je project daar meteen eigenaar van het incident.

### Op Postmortem schrijven klikken

Het dialoogvenster **Postmortem schrijven** opent op de eerste stap, **Postmortem**. Zodra het postmortem geschreven is, heet de knop van de kaart **Postmortem-notitie bewerken**, die dezelfde stappen opent.

### De notitie schrijven en bestanden bijvoegen

Schrijf de **Postmortem-notitie** in Markdown: wat er gebeurde, de impact, hoe het werd opgelost en de vervolgacties. Voeg schermafbeeldingen, rapporten of tijdlijnen toe onder **Postmortem-bijlagen**.

### Kiezen of u publiceert

Klik op **Volgende**. In de stap **Statuspagina** staat **Publiceren op statuspagina** uit, dus het postmortem blijft bij uw team. Om het aan klanten te tonen, zie [Het op uw statuspagina publiceren](#het-op-uw-statuspagina-publiceren).

### Het postmortem opslaan

Klik op **Wijzigingen opslaan**. De kaart toont de notitie en de bijlagen. De status van het postmortem gaat van **Niet gestart** naar **Concept**: zie [Hoe een postmortem verschuift](#hoe-een-postmortem-verschuift).
:::

Elke wijziging van de notitie wordt vastgelegd in de feed van het incident, en gepost in het Slack- of Microsoft Teams-kanaal van het incident als het er een heeft. Zolang het postmortem niet is gepubliceerd, hoort geen abonnee van de statuspagina ervan.

Een postmortem schrijven vereist de rol Projecteigenaar, Projectbeheerder, Projectlid, Incidentbeheerder of Incidentlid, of een aangepaste rol met de machtiging Edit Incident. Wie het incident kan lezen, kan ook het postmortem lezen.

## Beginnen met een sjabloon of een AI-concept

Twee knoppen vullen de notitie voor u in. Zolang er niets geschreven is, staan ze naast **Postmortem schrijven**: **Beginnen met sjabloon**, zodra het project een postmortem-sjabloon heeft, en **Generate with AI**. Zodra het postmortem geschreven is, staan ze in het menu **⋯** naast **Postmortem-notitie bewerken**, als **Sjabloon toepassen** en **Generate with AI**. Beide openen dezelfde editor, met de notitie ingevuld en de rest van het postmortem ongewijzigd. Er wordt niets opgeslagen tot u op **Wijzigingen opslaan** klikt, dus lees de notitie eerst na en pas haar aan.

### Een sjabloon toepassen

**Sjabloon toepassen** verschijnt zodra het project een postmortem-sjabloon heeft. Sjablonen maakt u onder **Incidenten → Instellingen → Postmortem-sjablonen**: zie [Postmortem-sjablonen](/docs/incidents/settings#postmortem-sjablonen). In OneUptime Cloud vereisen sjablonen het Growth-abonnement.

Klik op **Beginnen met sjabloon**, of op **Sjabloon toepassen** in het menu **⋯**, kies er een onder **Selecteer sjabloon** in het dialoogvenster **Postmortemsjabloon toepassen** en klik op **Sjabloon toepassen**. Heeft het project maar één sjabloon, dan is dat al gekozen.

### Het met AI genereren

Klik op **Generate with AI**. Het dialoogvenster **Postmortem maken met AI** biedt een opzet aan onder **Selecteer sjabloon**: **Standard Postmortem**, **Detailed Technical Postmortem** of **Brief Postmortem**, daarna uw eigen postmortem-sjablonen. **Template Preview** toont de opzet, en u kunt die wijzigen voordat u genereert.

Klik onderaan het dialoogvenster op **Generate with AI**. OneUptime AI leest het incident (de beschrijving, de oorzaak en de oplossing, de statustijdlijn, de openbare en privénotities, de berichten in het Slack- of Microsoft Teams-kanaal, en wat er in [de gesprekken](/docs/workspace-connections/video-calls#transcripties-van-gesprekken) is gezegd) en schrijft het postmortem in uw opzet. Daarna opent de editor met het resultaat.

Genereren vereist dat AI voor het project is ingeschakeld, onder **Projectinstellingen → AI → AI-functies**, en een LLM-provider: zie [LLM-providers](/docs/ai/llm-provider). Het vereist ook de rol Projecteigenaar of Projectbeheerder, of een aangepaste rol met de machtiging Edit Incident: andere rollen kunnen het postmortem schrijven, maar niet genereren.

### OneUptime AI het laten opstellen wanneer een incident is opgelost

Met **Een postmortem opstellen wanneer een incident is opgelost** aan stelt OneUptime AI het postmortem op telkens wanneer een incident wordt opgelost, slaat het op als notitie en post het in de feed van het incident zodat uw team het kan nakijken. De schakelaar staat onder **Incidenten → AI → Instellingen**, en staat aan voor nieuwe projecten.

- Het vervangt nooit een notitie die al is geschreven.
- Het schrijft nooit in een postmortem dat al is gepubliceerd, waar het concept ongecontroleerd op de statuspagina zou komen.
- Het vereist dat AI voor het project is ingeschakeld, en stopt voor die dag zodra het project zijn dagelijkse AI-limieten bereikt. Zie [Automatisch postmortem](/docs/ai/ai-sre#automatisch-postmortem).
- Is de transcriptie van het gesprek van het incident nog onderweg wanneer het incident wordt opgelost, dan wacht het tot OneUptime AI die heeft gelezen, zodat het concept meeneemt wat er in het gesprek is gezegd: tot zes uur terwijl de aanbieder de transcriptie maakt. Zie [Elk gesprek opnemen en transcriberen](/docs/workspace-connections/video-calls#elk-gesprek-opnemen-en-transcriberen).

#### Kiezen welke incidenten een concept krijgen, en met welk sjabloon

Zonder regel krijgt elk opgelost incident een concept, in de standaardopzet van OneUptime AI. **Postmortem-regels**, onder **Meer instellingen** op dezelfde pagina, veranderen dat:

- Een regel past bij **Alle incidenten**, of bij **Alleen incidenten die aan de voorwaarden voldoen** op monitoren, ernstniveaus, labels, monitorlabels, titel en beschrijving, zoals een AI-regel.
- Zijn **Sjablonen** zijn de postmortem-sjablonen die het concept mag volgen. Zonder sjabloon volgt het concept de standaardopzet; met één dat sjabloon; met meerdere het sjabloon dat volgens OneUptime AI het best bij het incident past. Het bericht van het concept in de feed noemt het sjabloon dat het volgde.
- Zijn **LLM-provider**, onder **Meer velden**, is de provider waarmee OneUptime AI het concept schrijft en het sjabloon ervan kiest. Is er geen gekozen, dan is het de standaardprovider van het project, anders de globale. Het bericht van het concept in de feed noemt de provider die een regel koos, of de provider die in plaats daarvan werd gebruikt, en waarom. Zie [Welke LLM-provider een regel gebruikt](/docs/ai/ai-sre#welke-llm-provider-een-regel-gebruikt).
- De eerste ingeschakelde regel die bij het incident past, beslist, vanaf de bovenkant van de lijst: sleep een regel om zijn plaats te veranderen. Een incident waar geen regel bij past, krijgt geen concept, en zolang de regels niet kunnen worden gelezen, krijgt geen enkel incident er een.
- **Een postmortem opstellen wanneer een incident is opgelost** blijft de enige schakelaar die concepten uitzet. Regels beslissen alleen over de concepten die OneUptime AI uit zichzelf opstelt: **Generate with AI** biedt elke opzet aan, wat de regels ook zeggen.
- Regels aanmaken, bewerken en herschikken vereist de rol Projecteigenaar of Projectbeheerder. In OneUptime Cloud vereisen sjablonen het Growth-abonnement: daaronder beslissen regels nog steeds welke incidenten een concept krijgen, en volgt elk concept de standaardopzet.

## Het op uw statuspagina publiceren

Een gepubliceerd postmortem is de afsluitende update van het incident voor uw klanten: de statuspagina toont de notitie, uitgelicht in de tijdlijn van het incident, met de bijlagen om te downloaden.

:::steps
### De stap Statuspagina openen

Klik op **Postmortem-notitie bewerken** en daarna op **Volgende** om bij de stap **Statuspagina** te komen.

### Publiceren op statuspagina aanzetten

Zet **Publiceren op statuspagina** aan. Er verschijnen nog twee velden: **Abonnees op de hoogte stellen**, dat aan staat, en **Postmortem gepubliceerd op**, dat op nu staat.

### Bepalen wie het hoort, en wanneer het verschijnt

Zet **Abonnees op de hoogte stellen** uit om te publiceren zonder abonnees te informeren. Wijzig **Postmortem gepubliceerd op** om een ander tijdstip naast het postmortem te tonen.

### Publiceren

Klik op **Wijzigingen opslaan**. De kaart toont nu **Postmortem zichtbaar op statuspagina?**, **Abonnees op de hoogte stellen**, **Meldingsstatus abonnee** en **Postmortem gepubliceerd op**.
:::

Wat bepaalt of klanten het zien, en of ze het horen:

- **Het incident moet op de statuspagina staan.** Een statuspagina toont een postmortem alleen bij een incident dat ze toont: **Zichtbaar op statuspagina** aan, en het incident niet privé.
- **De notitie moet iets zeggen.** Een postmortem dat met een lege notitie wordt gepubliceerd, wordt niet getoond, en niemand wordt geïnformeerd.
- **Abonnees worden één keer geïnformeerd**, de eerste keer dat de statuspagina het postmortem toont. Opnieuw opslaan, of bewerken terwijl het gepubliceerd is, werkt de pagina bij zonder iemand te informeren. Het eraf halen en opnieuw publiceren informeert hen opnieuw. Een postmortem dat wordt gepubliceerd terwijl het incident verborgen is, wordt verzonden zodra het incident zichtbaar wordt gemaakt.
- **Abonnees op de hoogte stellen wordt gelezen wanneer de melding uitgaat.** Het aanzetten nadat het postmortem is gepubliceerd, verzendt niets.

**Meldingsstatus abonnee** toont of de melding is verzonden, en biedt **Opnieuw proberen** als die mislukte. Zie [Het postmortem](/docs/status-pages/subscribers#de-postmortem) voor elk geval, en [Opnieuw proberen en opnieuw verzenden](/docs/status-pages/subscribers#opnieuw-proberen-en-opnieuw-verzenden).

**Postmortem gepubliceerd op** is ook het moment waarop het postmortem als gepubliceerd telt voor de meting **Tijd tot postmortem**: zie [Kant-en-klare metingen](/docs/incidents/settings#kant-en-klare-metingen).

## Bijhouden hoe ver elk postmortem is

Het postmortem van elk incident staat in een van de postmortem-statussen van het project, getoond onder **Status** bovenaan de kaart **Postmortem**. Een nieuw project heeft er vier. Een postmortem in **Niet gestart** of **Concept** staat nog open; een in **Voltooid** of **Niet nodig** niet:

| Status | Wat hij betekent | Staat nog open |
| --- | --- | --- |
| **Niet gestart** | Niemand heeft deze postmortem nog geschreven. | Ja |
| **Concept** | De postmortem wordt geschreven. | Ja |
| **Voltooid** | De postmortem is geschreven en klaar. | Nee |
| **Niet nodig** | Dit incident heeft geen postmortem nodig. | Nee |

### Hoe een postmortem verschuift

OneUptime verplaatst een postmortem op drie momenten uit zichzelf:

- Het postmortem van een nieuw incident begint in **Niet gestart**, of in **Concept** als het incident met een notitie wordt gemeld, of in **Voltooid** als die notitie meteen wordt gepubliceerd.
- De eerste notitie van een postmortem in **Niet gestart** verplaatst het naar **Concept**, of iemand haar nu schrijft, een sjabloon toepast of OneUptime AI haar opstelt.
- Publiceren op de statuspagina verplaatst het naar **Voltooid**, tenzij het al klaar is.

Het gaat nooit terug: de notitie leegmaken, of het postmortem van de statuspagina halen, laat de status waar hij is. Een status die iemand in dezelfde opslag kiest, geldt altijd.

### Zelf verplaatsen

Klik op de status, op de pagina **Postmortem** van het incident of in de rij in de lijst met postmortems, en kies er een onder **Postmortem verplaatsen naar**. Het postmortem wordt meteen verplaatst. Een postmortem verplaatsen vereist de rollen die er een schrijven, en iedereen die het incident kan lezen, ziet hoe ver het postmortem is.

### Eigen statussen maken

Heeft uw proces een eigen stap, zoals een beoordeling, voeg er dan een status voor toe. Open **Incidenten → Instellingen → Postmortem-statussen**, klik op **Postmortem-status aanmaken** en geef de status een naam, zoals **Ter beoordeling**, een kleur en een beschrijving. Een nieuwe status komt direct boven **Voltooid**; sleep een status om de plaats ervan te wijzigen.

Waar een status staat, bepaalt waarvoor hij telt, getoond onder **Telt als**: boven **Concept** telt hij als **Niet gestart**, vanaf **Concept** omlaag als **Bezig**, vanaf **Voltooid** omlaag als **Klaar**, en dan staat het niet meer open. **Ter beoordeling**, daartussen, staat nog open; **Niet nodig**, onder **Voltooid**, niet.

**Niet gestart**, **Concept** en **Voltooid** zijn ingebouwd, omdat OneUptime postmortems erin plaatst: u kunt ze een andere naam en kleur geven, maar niet verwijderen of archiveren, en ze houden hun volgorde. Archiveer een status die u niet meer gebruikt via het menu **⋯** van de rij: niemand kan er nog een postmortem naartoe verplaatsen, de postmortems erin blijven tot iemand ze verplaatst, en de lijst filtert er nog steeds op. **Gearchiveerde postmortem-statussen**, ingeklapt onder de tabel, toont ze, met **Uit het archief halen** om er een terug te halen. Statussen maken, bewerken en verwijderen vereist de rol Projecteigenaar, Projectbeheerder of Incidentbeheerder, of een aangepaste rol met de bijbehorende machtiging voor postmortem-statussen.

## Alle postmortems zien

**Incidenten → Postmortem-analyses** toont het postmortem van elk incident in het project, het nieuwste eerst, met de kolommen **Incident**, **Titel**, **Postmortem-status**, **Ernst**, **Eigenaren** en **Verklaard**. **Bekijken** op een rij opent de pagina **Postmortem** van het incident.

Boven de lijst telt een tegel per status de postmortems erin. Klik op een tegel om alleen die te tonen, en klik er nog eens op om ze weer allemaal te tonen.

Filter de lijst met de chips erboven: **Eigenaar**, een persoon of een team; **Ernst**; **Postmortem-status**; **Status incident**; **Labels**; en **Getroffen resources**. Om te zien welke postmortems een team nog schuldig is voor uw ernstigste incidenten, kiest u het team onder **Eigenaar**, de ernst onder **Ernst**, en **Niet gestart** en **Concept** onder **Postmortem-status**. De filters staan in het adres van de pagina, dus u kunt de lijst als bladwijzer opslaan of delen.

Om er veel tegelijk te wijzigen, selecteert u ze en opent u **Bulkacties**: **Postmortem-status wijzigen** verplaatst ze allemaal naar één status, zoals **Niet nodig** voor incidenten die er geen nodig hebben, en **Eigenaar toevoegen** en **Eigenaar verwijderen** wijzigen wie de eigenaar is.

## Actiepunten bijhouden

De actiepunten van een postmortem zijn wat uw team gaat doen zodat het incident niet opnieuw gebeurt. Elk actiepunt wordt op het incident vastgelegd, met een eigenaar, een vervaldatum en een status, zodat geen ervan een regel in de notitie blijft die niemand opvolgt. De kaart **Actiepunten** staat onder de kaart **Postmortem** op de pagina **Postmortem** van het incident.

- Om een actiepunt toe te voegen, typt u het in de regel onder de lijst en klikt u op **Actiepunt toevoegen**.
- Om een actiepunt een eigenaar te geven, kiest u **Aan mij toewijzen** of **Aan iemand anders toewijzen** in het menu **⋯** ervan.
- Om een actiepunt een vervaldatum te geven, kiest u **Actiepunt bewerken** in het menu **⋯** ervan en stelt u de **Vervaldatum** in. Een open actiepunt waarvan de vervaldatum is verstreken, meldt in rood dat het te laat is.
- Om een actiepunt te sluiten, vinkt u het aan zodra het klaar is. **Markeren als ‘Wordt niet gedaan’** in het menu **⋯** ervan sluit het wanneer het team besluit het niet te doen, en **Heropenen** opent het weer. Elk actiepunt vermeldt wie het sloot en wanneer.

De kaart toont hoeveel er klaar zijn, zonder de actiepunten die als **Wordt niet gedaan** zijn gemarkeerd. Het toevoegen, sluiten en overdragen van een actiepunt wordt vastgelegd in de feed van het incident.

### De actiepunten uit uw notitie bijhouden

Het concept van OneUptime AI en elk postmortem-sjabloon eindigen met een sectie met actiepunten: een checklist, of een tabel met de kolommen `Owner` en `Due Date`. Heeft de notitie zo'n sectie, dan noemt de kaart de punten die het incident nog niet bijhoudt, met een knop om ze allemaal bij te houden. Elk punt wordt een actiepunt:

- een aangevinkt vakje wordt een actiepunt dat klaar is;
- een vervaldatum die de notitie als datum schrijft, zoals 2026-11-20, wordt de vervaldatum, in uw tijdzone;
- een punt met de titel van een actiepunt dat al wordt bijgehouden, wordt overgeslagen, zodat opnieuw bijhouden niets toevoegt.

De kop van de sectie kan `Action Items`, `Follow-ups`, `Next Steps` of `How We Prevent It` zijn, of dezelfde woorden in een andere taal van het dashboard.

### Een actiepunt omzetten in een pull request, een test of een monitor

Elk open actiepunt kan via het menu **⋯** ervan worden wat het vraagt:

| Actie | Wat er gebeurt |
| --- | --- |
| **Pull request openen met AI** | OneUptime AI brengt de wijziging aan in een repository die u kiest en opent een pull request ter beoordeling. Het incident en het postmortem ervan gaan mee met het verzoek. |
| **Test schrijven met AI** | OneUptime AI schrijft een test die het incident had ontdekt, in het eigen testframework van de repository, en opent daarmee een pull request. |
| **Monitor maken** | **Monitor maken** opent met de naam van het actiepunt. Zodra de monitor is aangemaakt, verwijst het actiepunt ernaar en is het klaar. |

Het actiepunt toont daarna wat het is geworden: de fase van de taak, zoals **Taak bezig** of **Pull request staat open**, met een link naar de taak in [Code](/docs/ai/ai-agent), en de pull request; of de monitor. Wordt de pull request gemerged, dan is het actiepunt vanzelf klaar, en de feed van het incident meldt dat.

De twee AI-acties vereisen dat AI voor het project is ingeschakeld, en een repository waarin OneUptime AI kan werken. Is er geen verbonden, dan biedt het menu in plaats daarvan **Een repository verbinden** aan. Een verzoek vereist hetzelfde als een verzoek in Code, plus de machtiging om het actiepunt te bewerken.

### Alle actiepunten zien

**Incidenten → Actiepunten** toont de actiepunten van alle postmortems in het hele project, met de eerstvolgende vervaldatum bovenaan, elk met het incident, de eigenaar, de vervaldatum en de status. Filter de lijst op **Status**, **Eigenaar** en **Vervaldatum**, en **Bekijken** op een rij opent de pagina **Postmortem** van het incident.

Actiepunten lezen vereist hetzelfde als het incident lezen. Ze toevoegen, wijzigen en verwijderen vereist de rol Projecteigenaar, Projectbeheerder, Projectlid, Incidentbeheerder of Incidentlid, of een aangepaste rol met de bijbehorende machtiging voor postmortem-actiepunten. De actiepunten van een privé-incident zijn, net als het incident zelf, alleen zichtbaar voor de gebruikers die eigenaar zijn, de leden van de teams die eigenaar zijn, Projectbeheerders en Projecteigenaren.

## Postmortems van episodes

Een incidentepisode heeft ook een pagina **Postmortem**, onder **Onderzoek**: één verslag voor elk incident in de episode. Klik op **Postmortem bewerken** om het te schrijven. **Sjabloon toepassen** en **Generate with AI** werken zoals bij een incident, en de AI leest de episode en de incidenten die erin zitten.

Het postmortem van een episode is alleen de notitie: het heeft geen bijlagen, en geen statuspagina toont het. OneUptime AI stelt er geen uit zichzelf op wanneer een episode wordt opgelost. Genereren vereist de rol Projecteigenaar of Projectbeheerder, of een aangepaste rol met de machtiging Edit Incident Episode. Het heeft ook geen status, en de lijst met postmortems laat het weg.

Waarschuwingen en onderhoudsgebeurtenissen hebben geen postmortem.

## Via de API

Een postmortem is een set velden van het incident, gelezen en geschreven via `/api/incident` zoals de rest van het incident:

| Veld | Wat het is |
| --- | --- |
| `postmortemNote` | De notitie, in Markdown. |
| `showPostmortemOnStatusPage` | Of het postmortem op uw statuspagina's is gepubliceerd. Begint op `false`. |
| `notifySubscribersOnPostmortemPublished` | Of abonnees worden geïnformeerd wanneer het wordt gepubliceerd. Begint op `true`. |
| `postmortemPostedAt` | Het tijdstip dat de statuspagina ernaast toont. |
| `postmortemStatusId` | De status van het postmortem: een van de statussen van het project, onder `/api/incident-postmortem-status`. |

`showPostmortemOnStatusPage` als `true` schrijven over een geschreven `postmortemNote` publiceert het postmortem, zoals het dialoogvenster doet. Dat verplaatst het postmortem ook naar **Voltooid**, tenzij dezelfde schrijfactie `postmortemStatusId` instelt.

De actiepunten van een postmortem zijn eigen records, onder `/api/incident-postmortem-action-item`: elk met `incidentId`, `title`, `description`, `ownerUserId`, `dueDate` en `status` (`Open`, `Done` of `WontDo`). Workflows kunnen starten wanneer er een wordt aangemaakt, gewijzigd of verwijderd.

## Problemen oplossen

:::details Sjabloon toepassen staat niet op de kaart
Het project heeft nog geen postmortem-sjabloon, of uw rol kan ze niet lezen. Maak er een onder **Incidenten → Instellingen → Postmortem-sjablonen**. In OneUptime Cloud vereisen sjablonen het Growth-abonnement.
:::

:::details Generate with AI meldt dat AI uit staat, of dat u de machtiging mist
Zet AI aan onder **Projectinstellingen → AI → AI-functies**. Genereren vereist de rol Projecteigenaar of Projectbeheerder, of een aangepaste rol met de machtiging Edit Incident, ook voor iemand die het postmortem kan bewerken.
:::

:::details Het postmortem staat niet op de statuspagina
Controleer drie dingen: **Publiceren op statuspagina** staat aan, de notitie is niet leeg, en het incident wordt op de statuspagina getoond (**Zichtbaar op statuspagina** aan, en niet privé).
:::

:::details Abonnees zijn niet over het postmortem geïnformeerd
**Abonnees op de hoogte stellen** stond uit bij het publiceren, of het incident is verborgen: dan wordt het verzonden zodra het incident zichtbaar wordt gemaakt. **Meldingsstatus abonnee** op de kaart vertelt welke het was.
:::

:::details Er verscheen geen AI-concept toen het incident werd opgelost
Het incident had al een notitie, het postmortem was al gepubliceerd, er paste geen postmortem-regel bij, of **Een postmortem opstellen wanneer een incident is opgelost** staat uit. AI moet voor het project zijn ingeschakeld, en het project mag zijn dagelijkse AI-limieten niet hebben bereikt. Is de transcriptie van het gesprek van het incident onderweg, dan komt het concept zodra OneUptime AI die heeft gelezen.
:::

:::details De status van een postmortem verschoof niet toen de notitie werd geschreven
Alleen een postmortem in **Niet gestart**, of in een eigen status boven **Concept**, verschuift uit zichzelf, bij de eerste notitie. Een postmortem dat al bezig of klaar is, blijft waar het is, net als een status die iemand in dezelfde opslag koos. Verplaats het zelf via de status: zie [Zelf verplaatsen](#zelf-verplaatsen).
:::

## Volgende stappen

:::cards
- [Incidenten – Overzicht](/docs/incidents/index): De andere pagina's van het incident, van melden tot oplossen.
- [Incidentinstellingen en automatisering](/docs/incidents/settings): Postmortem-sjablonen en de meting van de tijd tot postmortem.
- [Abonnees en aankondigingen](/docs/status-pages/subscribers): Alles wat een statuspagina haar abonnees vertelt.
- [AI SRE](/docs/ai/ai-sre): Wat OneUptime AI uit zichzelf doet na een incident.
:::
