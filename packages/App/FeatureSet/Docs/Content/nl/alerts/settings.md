# Waarschuwingsregels en instellingen

De configuratie van waarschuwingen staat binnen **Waarschuwingen**, niet in **Projectinstellingen**: de regels die op elke nieuwe waarschuwing werken, en de instellingen die elke waarschuwing in het project vormgeven. Deze pagina is het naslagwerk voor elk ervan, en voor wat er vanzelf draait wanneer een waarschuwing wordt aangemaakt.

:::cards
- [De regels die een nieuwe waarschuwing doorloopt](#de-regels-die-een-nieuwe-waarschuwing-doorloopt): Op volgorde, en wat elk doet.
- [Bereikbaarheidsregels](#bereikbaarheidsregels): De juiste mensen oproepen zonder elke keer een beleid te kiezen.
- [Herinneringsregels](#herinneringsregels): Eigenaren herinneren zolang een waarschuwing open blijft.
- [Instellingen](#instellingen): Notitie-sjablonen, aangepaste velden, metingen, lidmaatschap van episodes, nummering en gegevensbewaring.
:::

## Waar de instellingen voor waarschuwingen staan

Open **Waarschuwingen** via het menu **Producten** in de bovenste balk. De secties **Regels** en **Instellingen** van het zijmenu beginnen ingeklapt, dus klap ze eerst uit. Elke pagina hier geldt voor het hele project, op adressen die beginnen met `/dashboard/{projectId}/alerts/settings/`.

| Regelpagina                 | Wat ze doet                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| **Groeperingsregels**       | Brengt samenhangende waarschuwingen onder in episodes. Zie [Waarschuwingsepisoden en groeperingsregels](/docs/alerts/episodes). |
| **Bereikbaarheidsregels**   | Voert bereikbaarheidsbeleid uit voor overeenkomende waarschuwingen en episodes.                |
| **Incidentregels** | Meldt een incident vanuit overeenkomende waarschuwingen, meteen of zodra een waarschuwing onopgelost blijft. |
| **Eigenaarsregels**         | Voegt eigenaren toe aan overeenkomende waarschuwingen en episodes.                             |
| **Runbook-regels**          | Start runbooks voor overeenkomende waarschuwingen.                                             |
| **Privacyregels**           | Maakt overeenkomende waarschuwingen en episodes privé.                                         |
| **Labelregels**             | Voegt labels toe aan overeenkomende waarschuwingen en episodes.                                |
| **Herinneringsregels**          | Herinnert eigenaren met een interval zolang een waarschuwing open is.                          |

De sectie **Instellingen** bevat **Status waarschuwing** en **Ernst van waarschuwing**, beschreven op [Waarschuwingsstatussen en ernstniveaus](/docs/alerts/states-and-severities), en daarna **Notitie-sjablonen**, **Aangepaste velden**, **Metingen**, **Lidmaatschap van episodes**, **Nummering** en **Gegevensbewaring**, hieronder beschreven.

Nog twee secties werken op waarschuwingen. **Waarschuwingen → AI → Instellingen** bepaalt wat OneUptime AI zelf doet: **Nieuwe waarschuwingen onderzoeken**, aan voor nieuwe projecten, en **Nieuwe waarschuwingen automatisch herstellen**, uit tot je het aanzet. Zie [AI SRE](/docs/ai/ai-sre). **Waarschuwingen → Werkruimte** bevat de Slack- en Microsoft Teams-regels die waarschuwingen en episodes in kanalen plaatsen, en het tabblad **Samenvatting**. Zie [Slack](/docs/workspace-connections/slack).

## De regels die een nieuwe waarschuwing doorloopt

```mermaid title="De regels die een nieuwe waarschuwing doorloopt, op volgorde"
flowchart TB
    subgraph shape["Wie haar ziet en bezit"]
        direction LR
        privacy["Privacyregels"] --> owner["Eigenaarsregels"]
    end
    subgraph more["Wat ze meekrijgt"]
        direction LR
        label["Labelregels"] --> oncall["Bereikbaarheidsregels"]
    end
    subgraph page["Wat ze start"]
        direction LR
        runbook["Runbook-regels"] --> execute["Beleid draait"]
    end
    subgraph follow["Daarna"]
        direction LR
        grouping["Groeperingsregels"] --> reminder["Herinneringsregels"]
    end
    shape --> more
    more --> page
    page --> follow
```

De regels verschillen in hoe meerdere overeenkomsten worden afgehandeld:

- **Groeperingsregels**, **Incidentregels** en **Herinneringsregels** worden van boven naar beneden in hun lijst gecontroleerd, en de eerste overeenkomst wint. Sleep een regel om haar plek te wijzigen; een nieuwe regel komt aan het einde.
- **Bereikbaarheidsregels**, **Eigenaarsregels**, **Labelregels**, **Privacyregels** en **Runbook-regels** werken allemaal wanneer ze overeenkomen. Bereikbaarheidsbeleid, eigenaren en labels die meerdere regels toevoegen, worden één keer toegevoegd.

**Bereikbaarheidsregels**, **Eigenaarsregels**, **Labelregels** en **Privacyregels** hebben twee tabbladen: **Waarschuwingsregels**, voor waarschuwingen, en **Episoderegels**, die op dezelfde manier op elke nieuwe waarschuwingsepisode werken. Een nieuwe regel begint ingeschakeld; zet **Ingeschakeld** uit in haar bewerkformulier om haar te pauzeren, en de lijst toont per regel een groen **Ingeschakeld** of een rood **Uitgeschakeld**.

De meeste regels werken op waarschuwingen en episodes die na het opslaan worden aangemaakt. Om een eigenaars-, label- of privacyregel toe te passen op wat je al hebt, gebruik je **Nu uitvoeren**: zie [Regels uitvoeren op bestaande resources](/docs/configuration/run-rules-now). Herinneringsregels zijn de uitzondering: als je er een opslaat, wordt elke open waarschuwing opnieuw gematcht.

### Voorwaarden

De voorwaarden van een regel bepalen op welke waarschuwingen ze werkt, en lezen als zinnen: "Als **Waarschuwingstitel** `database` bevat", "En **Monitorlabels** heeft een van *Production*". Een regel zonder voorwaarden komt overeen met elke waarschuwing.

| Voorwaarde                                                    | Vergelijkt met                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Monitoren**, **Ernstniveaus van waarschuwingen**, **Waarschuwingslabels**, **Monitorlabels** | **Heeft een van**, **Heeft alle** of **Heeft geen van** de waarden die je kiest.                 |
| **Waarschuwingstitel**, **Waarschuwingsbeschrijving**, **Monitornaam**, **Monitorbeschrijving** | **Bevat**, **Bevat niet**, **Is gelijk aan**, **Is niet gelijk aan**, **Begint met**, **Eindigt met**, zonder op hoofdletters te letten, of **Komt overeen met patroon** en **Komt niet overeen met patroon**, voor een reguliere expressie of een `*`-jokerteken. |

Met twee of meer voorwaarden kies je **Voldoet aan alle**, waarbij elke voorwaarde moet gelden, of **Voldoet aan één**, waarbij één genoeg is. Episoderegels matchen in plaats daarvan op de ernst, labels, titel en beschrijving van een episode.

## Bereikbaarheidsregels

**Waarschuwingen → Regels → Bereikbaarheidsregels** maakt oproepen automatisch. Elke overeenkomende regel voegt haar beleid toe aan de nieuwe waarschuwing, en de waarschuwing voert het uit samen met het beleid dat ze al had, elk één keer.

:::steps
### De waarschuwingen kiezen

Klik op **Alert On-Call Rule aanmaken**. Bij **Overeenkomst** komt **Alle waarschuwingen**, waar een nieuwe regel mee begint, overeen met elke nieuwe waarschuwing. Om de regel in te perken, kies **Alleen waarschuwingen die aan de voorwaarden voldoen** en voeg de voorwaarden toe waaraan een waarschuwing moet voldoen.

### Het beleid kiezen

Kies bij **Bereikbaarheidsbeleid** het **Bereikbaarheidsbeleid** dat de regel oproept. De **Naam** volgt dat, zoals "Platform on-call oproepen", totdat je zelf een naam typt, en een **Beschrijving** wacht onder **Meer velden**. Maak daarna de regel aan.
:::

Een ernstniveau roept op zichzelf niemand op: een bereikbaarheidsregel die op **Ernstniveaus van waarschuwingen** matcht, is de manier om "roep het databaseteam op bij elke High-waarschuwing" in te stellen. Om te zien wat er voor één waarschuwing draaide, open je haar pagina **Bereikbaarheidsuitvoeringen**. Elke persoon wordt daarna bereikt zoals die het heeft ingesteld onder **Gebruikersinstellingen → Hoe ik bereikbaar ben**, op het tabblad **Waarschuwingen**; zie [Escalatieregels](/docs/on-call/escalation-rules).

Een regel roept op zodra een waarschuwing erop past. Om de regel in plaats daarvan op werktijden te laten wachten, beantwoord je **Wanneer moet deze regel oproepen?** onder **Meer velden** met **Alleen tijdens werktijden**. De **Werktijden** beginnen op maandag tot en met vrijdag, 09:00 tot 17:00, in je eigen tijdzone: kies andere dagen, een andere **Starttijd** of **Eindtijd**, of een andere **Tijdzone**, en een zin onder de keuze zegt wat er gebeurt. In de lijst toont de regel zijn tijden onder zijn naam. Een waarschuwing die buiten die tijden past, krijgt een uitvoering die wacht en niemand oproept; zodra de werktijden beginnen, roept het beleid zijn eerste escalatieregel op en escaleert het zoals gewoonlijk. Wordt de waarschuwing eerst bevestigd of opgelost, dan wordt niemand opgeroepen. Verandert de waarschuwing terwijl ze wacht en past ze nu op een regel die direct oproept, bijvoorbeeld omdat haar ernstniveau is verhoogd, dan begint de uitvoering meteen met oproepen, en de feed van de waarschuwing zegt waarom. Twee regels die hetzelfde beleid oproepen, roepen het op zodra een van beide het toelaat: een regel voor je hoogste ernstniveaus die direct oproept, naast een regel voor de rest die op werktijden wacht, houdt de nachten rustig.

Een regel roept de mensen van zijn beleid op om te reageren: wie de oproep bevestigt, bevestigt de waarschuwing. Om een team op de hoogte te houden terwijl een ander reageert, beantwoord je **De mensen van dit beleid oproepen als** onder **Meer velden** met **Waarnemers**. Hun oproep zegt dat ze waarnemers zijn, en wie hem bevestigt, zegt daarmee alleen dat hij hem heeft gezien: de waarschuwing wordt niet bevestigd en geen andere oproep stopt. Hun oproep loopt door tot een van hen antwoordt of de waarschuwing is opgelost, en in de lijst zegt de regel onder zijn naam dat hij als waarnemers oproept. Beleid dat de ene passende regel oproept om te reageren en een andere als waarnemers, roept op om te reageren.

Een regel kan bij teams horen. **Verantwoordelijke teams**, onder **Meer velden**, beperkt hem tot de teams die u kiest: alleen hun leden en projectbeheerders kunnen hem bewerken of verwijderen, en alle anderen die regels zien, zien hem alleen-lezen. Een regel die bij geen enkel team hoort, kan worden gewijzigd door iedereen die bereikbaarheidsregels mag bewerken, en ook episoderegels kunnen bij teams horen. Zie [Regels die bij teams horen](/docs/permissions/index#regels-die-bij-teams-horen).

## Incidentregels

**Waarschuwingen → Regels → Incidentregels** maakt vanzelf incidenten van waarschuwingen. De eerste regel die bij een nieuwe waarschuwing past, van boven naar beneden in de lijst, meldt er een incident uit, zoals **Incident melden** op de pagina van de waarschuwing zou doen, en koppelt de waarschuwing eraan.

:::steps
### De waarschuwingen uitkiezen

Onder **Overeenkomst** past **Alle waarschuwingen**, waarmee een nieuwe regel begint, op elke nieuwe waarschuwing. Om die te beperken kies je **Alleen waarschuwingen die aan de voorwaarden voldoen** en voeg je de voorwaarden toe waaraan een waarschuwing moet voldoen.

### Het incident beschrijven

Kies onder **Incident** de **Ernst van incident**, of laat die leeg om elk incident de ernst te geven die bij die van zijn waarschuwing past. Zet **Declare After (Minutes)** boven 0 om het incident alleen te melden als de waarschuwing dan nog steeds niet is opgelost. De **Naam** van de regel volgt de ernst, zoals "Declare SEV1 incidents", totdat je een eigen naam typt. Maak daarna de regel aan.
:::

Het incident neemt de titel, beschrijving, monitor, getroffen resources en labels van de waarschuwing over, en is privé als de waarschuwing dat is. Daarna draaien de eigen regels van het incident zoals bij elk nieuw incident, dus de bereikbaarheidsregels van het incident bepalen wie wordt opgeroepen. Een waarschuwing die is opgelost voordat de wachttijd om is, wordt nooit een incident, en een waarschuwing die al aan een incident is gekoppeld, blijft zoals ze is. **Tonen op statuspagina's**, onder **Meer velden**, bepaalt of het incident verschijnt op de statuspagina's die zijn monitor tonen.

## Eigenaars- en labelregels

**Eigenaarsregels** voegen eigenaar-gebruikers en -teams toe aan nieuwe waarschuwingen die overeenkomen, en **Labelregels** voegen labels toe. Een regel aanmaken gaat in twee stappen: **Overeenkomst**, de voorwaarden, en daarna **Eigenaren** of **Labels**, wat de regel toevoegt. De **Naam** van de regel volgt wat je kiest tot je zelf een naam typt.

- **Een regel kan overnemen.** Ingeklapt onder **Eigenaren overnemen** of **Labels overnemen** geven zes schakelaars de eigenaren of labels door van de monitor, hosts, Kubernetes-clusters, Docker-hosts, Podman-hosts en services van de waarschuwing. Episoderegels hebben zulke schakelaars niet. **Eigenaren overnemen** van een eigenaarsregel eindigt met **Team van de maker**: van de teams die daar staan, wordt elk team waarin de persoon zit die de waarschuwing aanmaakt, ook eigenaar.
- **Een nieuwe regel moet iets toevoegen**: kies minstens één eigenaar of label, of zet een schakelaar aan. Bij een eigenaarsregel voor incidenten of waarschuwingen is een team onder **Team van de maker** ook genoeg.
- **Eigenaren op de hoogte stellen**, onder **Meer velden** van een eigenaarsregel, bepaalt of de toegevoegde mensen worden ingelicht.

[Label- en eigenaarsregels](/docs/configuration/label-and-owner-rules) behandelt het formulier stap voor stap, voor elk soort resource.

## Privacy- en runbook-regels

**Privacyregels** maken overeenkomende nieuwe waarschuwingen privé, voordat er iets anders draait: alleen hun eigenaren en de beheerders en eigenaren van het project kunnen ze zien. Een regel heeft twee stappen: **Overeenkomst**, de waarschuwingen die ze privé maakt, en dan **Naam**, al ingevuld als "Waarschuwingen privé maken". Zie [Privéwaarschuwingen](/docs/alerts/index#privéwaarschuwingen).

**Runbook-regels** starten een runbook wanneer een nieuwe waarschuwing overeenkomt, tenzij de waarschuwing opgelost werd aangemaakt. Zie [Runbook-regels](/docs/runbooks/rules).

## Herinneringsregels

**Waarschuwingen → Regels → Herinneringsregels** herinnert de eigenaren van een waarschuwing zolang ze open blijft. Elke nieuwe waarschuwing krijgt de eerste regel die overeenkomt, van boven naar beneden in de lijst.

:::steps
### Kiezen voor welke waarschuwingen je herinnert

Klik op **Alert Reminder Rule aanmaken**. Laat bij **Overeenkomst** de keuze **Alle waarschuwingen** staan om voor elke waarschuwing te herinneren, of kies **Alleen waarschuwingen die aan de voorwaarden voldoen** en dan de **Ernstniveaus van waarschuwingen** en **Labels** waarvoor ze geldt.

### Het interval instellen

Stel bij **Herinneringen** het **Herinneringsinterval (minuten)** in, hoe vaak eigenaren worden herinnerd, en **Herinneringen stoppen wanneer**: **Opgelost**, de standaard, of **Bevestigd**. De **Naam** volgt beide, zoals "Elke 30 minuten herinneren tot opgelost", totdat je zelf een naam typt. Maak daarna de regel aan.
:::

Eigenaren krijgen elke herinnering als **Waarschuwingsherinnering**, dat standaard per e-mail aan staat. De regel van een waarschuwing wordt opnieuw gematcht wanneer haar ernst of labels veranderen. Om de herinneringen voor één waarschuwing te stoppen, zet je **Herinneringen sturen** uit op haar pagina **Instellingen**; dat wordt opgeslagen zodra je de schakelaar omzet.

## Instellingen

### Notitie-sjablonen

**Waarschuwingen → Instellingen → Notitie-sjablonen** bevat kant-en-klare tekst voor privénotities. De kaart **Privénotitiesjablonen voor waarschuwingen** toont ze; **Notitiesjabloon voor waarschuwingen aanmaken** vraagt om een **Sjabloonnaam**, een **Sjabloonbeschrijving** en de **Notitie**. Een sjabloon wordt aangeboden wanneer iemand een privénotitie schrijft bij een waarschuwing of een episode, en wanneer iemand er een bevestigt of oplost, en de tekst kan worden bewerkt voordat ze wordt geplaatst. Notitie-sjablonen voor waarschuwingen zijn platte tekst: anders dan notitie-sjablonen voor incidenten vullen ze geen variabelen in.

### Aangepaste velden

**Waarschuwingen → Instellingen → Aangepaste velden** voegt je eigen velden toe aan elke waarschuwing, zoals een klantniveau of een ticketverwijzing. Vul ze in op de pagina **Aangepaste velden** van een waarschuwing, of via de API als `customFields`. Een veld kan zijn waarde kopiëren uit een aangepast veld van de monitor in plaats van te worden ingetypt: zie [Velden die uit een monitor worden gekopieerd](/docs/incidents/settings#velden-die-uit-een-monitor-worden-gekopieerd), wat voor waarschuwingen op dezelfde manier werkt.

### Metingen

**Waarschuwingen → Instellingen → Metingen** meet hoe lang dingen duren bij elke waarschuwing. Kies **Tijd tot bevestiging** of **Tijd tot oplossing**, of twee eigen momenten, zoals wanneer **De waarschuwing wordt aangemaakt** en wanneer ze een status binnengaat die je kiest. Elke meting wordt op de pagina van de waarschuwing getoond en in grafieken weergegeven als `oneuptime.alert.measurement.<key>`. Zie [Metingen](/docs/incidents/settings#metingen), wat voor waarschuwingen op dezelfde manier werkt.

**Tijd tot bevestiging na de oproep** telt vanaf **Iemand wordt voor het eerst opgeroepen**, wanneer een bereikbaarheidsbeleid of een directe oproep voor het eerst iemand over de waarschuwing op de hoogte bracht, in plaats van vanaf het moment dat ze werd aangemaakt: een waarschuwing die 's nachts ontstaat en waarvoor pas 's ochtends wordt opgeroepen, krijgt de nacht niet aangerekend. Een waarschuwing waarvoor niemand werd opgeroepen, heeft geen waarde. Zie [Tijd tot bevestiging na de oproep](/docs/incidents/settings#tijd-tot-bevestiging-na-de-oproep).

### Lidmaatschap van episodes

**Waarschuwingen → Instellingen → Lidmaatschap van episodes** bepaalt of een waarschuwing in meer dan één episode kan zitten. Zet **Een waarschuwing kan maar in één episode zitten** aan, en een waarschuwing die in een episode zit, wordt aan geen andere toegevoegd, niet vanuit het dashboard en niet via de API, een workflow of een groeperingsregel, totdat ze uit die episode is gehaald. De schakelaar staat uit tot je hem aanzet, en alleen Project Owners en Project Admins kunnen hem wijzigen. Aanzetten haalt geen enkele waarschuwing uit een episode. Zie [Eén episode per incident](/docs/incidents/episodes#eén-episode-per-incident), wat voor waarschuwingen op dezelfde manier werkt.

### Nummering

**Waarschuwingen → Instellingen → Nummering** stelt de tekst voor waarschuwings- en episodenummers in: `ALT-` en `AE-` in een nieuw project, of `#` zonder voorvoegsel. **Bijwerken** opent **Nummervoorvoegsel voor waarschuwing** en **Nummervoorvoegsel voor waarschuwingsepisode**, met een voorbeeld terwijl je typt. Alleen waarschuwingen en episodes die daarna worden aangemaakt, krijgen het nieuwe voorvoegsel. De regels voor een voorvoegsel staan op [Nummervoorvoegsels](/docs/incidents/settings#nummervoorvoegsels).

De kaart **Volgend nummer** eronder stelt het nummer in dat de volgende waarschuwing en de volgende episode krijgen, om de nummers van een andere tool voort te zetten: **Bijwerken** opent **Volgend waarschuwingsnummer** en **Volgend waarschuwingsepisodenummer**, elk hoger dan het hoogste tot nu toe. Zie [Volgende nummers](/docs/incidents/settings#volgende-nummers).

### Gegevensbewaring

**Waarschuwingen → Instellingen → Gegevensbewaring** verwijdert waarschuwingen zodra ze lang genoeg zijn opgelost, zoals [Gegevensbewaring](/docs/incidents/settings#gegevensbewaring) dat voor incidenten doet. De kaart **Opgeloste waarschuwingen** vraagt om **Verwijderen na**, **Nooit** tot je een periode kiest, en vraagt om bevestiging voordat er meer wordt verwijderd, met **Oude waarschuwingen verwijderen**. Een waarschuwing blijft zolang ze niet is opgelost, zolang ze in een episode zit die nog open is of korter geleden is opgelost, en zolang een incident waaraan ze is gekoppeld blijft. Alleen Project Owners en Project Admins kunnen dit wijzigen; in de API is het `alertRetentionInDays` van het project.

> [!NOTE]
> In OneUptime Cloud vragen notitie-sjablonen en aangepaste velden het abonnement **Growth** of hoger.

## Workflows

Elk waarschuwingsmodel heeft workflowtriggers en -acties die naar het model zijn genoemd: **On Create Alert**, **On Update Alert**, **On Create or Update Alert** en **On Delete Alert**, hetzelfde voor **Waarschuwingsepisode**, **Statustijdlijn van waarschuwing** en de andere, en acties zoals **Create One Alert** en **Update One Alert**. De definities van aangepaste velden voor waarschuwingen zijn de enige uitzondering: ze hebben geen workflowtriggers. Zie [Workflows – Overzicht](/docs/workflows/index).

## Wie dit kan wijzigen

Regels, aangepaste velden en metingen vragen een Project Owner of Project Admin, of een aangepaste rol met de eigen machtiging van die regel. **Waarschuwingslid** werkt met waarschuwingen en episodes, hun notities, eigenaren en statustijdlijnen, en notitie-sjablonen, en **Waarschuwingsbeheerder** beheert daarnaast waarschuwingsstatussen en ernstniveaus. Zie [Gebruikers, teams en machtigingen](/docs/permissions/index).

## Volgende stappen

:::cards
- [Waarschuwingsepisoden en groeperingsregels](/docs/alerts/episodes): De groeperingsregels, uitgebreid.
- [Escalatieregels](/docs/on-call/escalation-rules): Wat er gebeurt zodra een bereikbaarheidsregel een beleid uitvoert.
- [Label- en eigenaarsregels](/docs/configuration/label-and-owner-rules): Het regelformulier, stap voor stap.
- [AI SRE](/docs/ai/ai-sre): Nieuwe waarschuwingen vanzelf onderzoeken en herstellen.
:::
