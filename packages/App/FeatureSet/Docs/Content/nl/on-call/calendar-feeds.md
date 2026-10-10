# Agendafeeds

Agendafeeds zetten je bereikbaarheidsdiensten in de agenda waar je toch al naar kijkt. OneUptime publiceert een geheime iCalendar-link (`.ics`) voor elke persoon, elk rooster en elk project; Google Agenda, Outlook, Apple Agenda, Thunderbird en elke andere app die zich via een URL op een agenda kan abonneren, haalt die link regelmatig op en toont één afspraak per dienst. Er wordt niets geïnstalleerd en er wordt geen account gekoppeld: de link is de hele integratie.

```mermaid title="Agenda-apps halen een geheime link op; sommige vanaf hun eigen servers"
flowchart TB
    subgraph links["Geheime .ics-links"]
        direction LR
        personal["Persoonlijke feed"]
        schedule["Roosterfeed"]
        project["Projectfeed"]
    end
    shifts["Roosters, rotaties<br/>en overrides"] --> links
    links -->|"opgehaald vanaf hun servers"| serverApps["Google Agenda, Outlook op het web"]
    links -->|"opgehaald vanaf je apparaat"| deviceApps["Apple Agenda, Thunderbird, klassieke Outlook"]
```

> [!NOTE]
> Een geabonneerde agenda is bedoeld voor **planning**. Agenda-apps halen feeds op in hun eigen tempo — Google Agenda maar eens per 8 tot 24 uur — dus een ruil die een uur voor een dienst wordt gemaakt, bereikt je via de eigen herinneringen, meldingen over hertoewijzing en oproepen van OneUptime, niet via de agenda.

## Wat je krijgt

- Eén afspraak per dienst, met de titel `On-call · <Schedule>` (met ` · <Policy>` erachter wanneer het rooster aan precies één escalatiebeleid is gekoppeld) in je persoonlijke feed en `<Name> · On-call · <Schedule>` in een gedeelde feed. De beschrijving noemt wie er dienst heeft, het rooster en de tijdzone ervan, de laag, de dienst in de zone van het rooster, in UTC en in jouw zone, welk escalatiebeleid jou via dit rooster oproept, en een link naar het rooster in het dashboard.
- Overrides worden gevolgd. Wanneer iemand je vervangt, gaat de afspraak naar die persoon (`(covering for <Name>)` wordt toegevoegd) en blijft het dezelfde afspraak in je agenda-app, dus wordt hij bijgewerkt in plaats van verdubbeld. Een gedeeltelijke override splitst de dienst in aansluitende afspraken.
- Standaard twee dagen geschiedenis en 90 dagen vooruit. Je kunt dit verruimen tot 60 dagen terug en 180 dagen vooruit; een feed die meer dan 5.000 afspraken zou bevatten, wordt ingekort en meldt dat in de beschrijving van de agenda.
- Afspraken zijn gemarkeerd als vrij (`TRANSP:TRANSPARENT`), dus een geabonneerde feed blokkeert nooit je beschikbaarheid, en niets is gemarkeerd als privé, dus een gedeelde teamagenda toont de titels aan iedereen die hem kan zien.
- Tijden worden in UTC verstuurd en door je agenda-app omgerekend; de beschrijving vermeldt de kloktijd in de zone van het rooster en in de jouwe. Stel je eigen tijdzone in als **Tijdzone** op je **Profiel** (je foto rechtsboven in het dashboard), en die van het rooster in de kaart **Schedule timezone** op de pagina **Lagen** ervan. Een rooster zonder tijdzone wordt uitgerekend in de zone van de server, net als bij het oproepen, en de afspraak meldt dat.

Vaste toewijzingen — een gebruiker of team die rechtstreeks in een regel van een escalatiebeleid staat — hebben geen begin of einde en verschijnen in geen enkele feed. Op OneUptime Cloud volgen feeds hetzelfde abonnement als bereikbaarheidsschema's (Growth); een project onder dat abonnement krijgt een lege agenda in plaats van een fout.

## Drie soorten links

| Link | Wie maakt hem | Wat hij bevat | Waar |
| --- | --- | --- | --- |
| **Persoonlijke feed** | Elke gebruiker, één per project | Jouw diensten in elk rooster van dat project, plus de diensten waarin je iemand vervangt (optioneel) | **Gebruikersinstellingen** > **Agenda** > **Agendafeed** |
| **Roosterfeed** | Iedereen die het rooster mag bewerken; iedereen die het mag lezen, mag de link kopiëren | De diensten van iedereen in één rooster, met optionele afspraken voor dekkingsgaten | De pagina van het rooster, kaart **Abonneren op dit rooster** |
| **Projectfeed** | Iedereen die bereikbaarheidsschema's mag bewerken; iedereen die ze mag lezen, mag de link kopiëren | De diensten van iedereen in elk rooster van het project, met optionele afspraken voor dekkingsgaten | **Bereikbaarheidsdienst** > **Agendafeeds** |

De links zien er zo uit:

```text
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

> [!WARNING]
> Het token van 43 tekens in het pad is het enige inloggegeven — er komt geen login, cookie of API-sleutel aan te pas. Behandel elk van deze links als een wachtwoord.

## Je persoonlijke feed

Persoonlijke feeds zijn per project: een tweede project krijgt een tweede link en een tweede agenda.

:::steps
### Open je agendafeed

Open **Gebruikersinstellingen** > **Agenda** > **Agendafeed** in het project waarvan je de diensten wilt. **Agenda** is een sectie van het zijmenu die ingeklapt begint.

### Genereer de link

Klik op **Agendalink genereren**. De kaart **Abonneren op uw oproepdiensten** biedt nu één manier om je te abonneren:

- **Toevoegen aan uw agenda**: **Google Agenda** opent Google Agenda, dat vraagt of de agenda moet worden toegevoegd. **Apple Agenda / Outlook** opent de `webcal://`-vorm van de link in de app waarmee je computer of telefoon zich abonneert: Apple Agenda op een Mac, iPhone of iPad, Outlook op Windows.
- **Of kopieer de link**: **Link kopiëren** kopieert de `https://`-link voor elke andere app die zich via een URL op een agenda kan abonneren. De link blijft verborgen op de pagina tot je klikt om hem te tonen.

### Abonneer je op de link

Volg de stappen voor je app onder "Abonneren in je agenda-app" hieronder. Je diensten verschijnen als afspraken zodra de app de link de volgende keer ophaalt: zie "Hoe vaak agenda's verversen".
:::

### Instellingen van de feed

Klik op **Instellingen bewerken** op de kaart **Instellingen agendafeed** om te wijzigen wat de link bevat:

| Instelling | Wat het doet |
| --- | --- |
| **Diensten opnemen die ik voor anderen overneem** | Standaard aan. Voegt de diensten toe die een override je geeft in roosters waarvan je anders geen lid bent. |
| **Dagen aan eerdere diensten** | Hoe ver de agenda terugreikt (standaard 2, hooguit 60). |
| **Dagen vooruit** | Hoe ver de agenda vooruitreikt (standaard 90, tussen 7 en 180). |

De statusregel toont wanneer de link voor het laatst is opgehaald, door welke agenda-app, hoe vaak, en de laatste vier tekens van het token, zodat je links uit elkaar kunt houden. Heeft na twee dagen niets de link opgehaald, dan vraagt de pagina of de server vanaf internet bereikbaar is (zie Probleemoplossing).

### De link beheren

| Actie | Wat er gebeurt |
| --- | --- |
| **Link opnieuw genereren** | Maakt een nieuw token aan. Elke app die op de oude link is geabonneerd, wordt niet meer bijgewerkt: 30 dagen lang levert de oude link een lege agenda, zodat die apps hun kopie leegmaken, daarna geeft hij 404. Abonneer je opnieuw met de nieuwe link. |
| **Uitschakelen** | Houdt de link, maar levert een lege agenda tot je hem weer inschakelt. |
| **Verwijderen** | Verwijdert de link. Apps die hem nog ophalen, krijgen 404 en blijven tonen wat ze het laatst hebben opgehaald — schakel hem eerst uit als je wilt dat ze leeglopen. |

### Komende diensten en vervanging

De pagina toont ook je **Upcoming shifts** (de komende 30 dagen) en de kaart **Herinner mij vóór diensten**, die verderop wordt beschreven. Elk van je eigen diensten heeft een link **Vervanging regelen**: die opent de overrides van gebruikers in het project van de dienst, met een nieuwe override die al voor die dienst is ingevuld, met jou als **Wie is afwezig?** en de tijden van de dienst als **Begint** en **Eindigt** (vanaf nu, als de dienst al is begonnen), zodat alleen **Wie vervangt?** nog overblijft. De override stuurt al je oproepen in die tijd naar de persoon die je vervangt, vanuit elk bereikbaarheidsbeleid; een dienst die alleen binnen één beleid bestaat, wordt in plaats daarvan op de pagina met overrides van gebruikers van dat beleid vervangen. Een dienst waarin jij iemand anders vervangt, heeft geen **Vervanging regelen**: overrides worden niet aan elkaar gekoppeld, dus vervanging voor een vervanging zou niets veranderen.

Dezelfde persoonlijke link, gefilterd op één rooster met `?schedule=<id>`, wordt op de pagina van elk rooster aangeboden als **Alleen mijn diensten in dit rooster**, en de bereikbaarheidsbanner en de pagina **Mijn bereikbaarheidsbeleid** hebben een link **Uw diensten aan uw agenda toevoegen** naar de pagina hierboven.

### In de mobiele app

In de mobiele app: **On-Call** > **Add shifts to my calendar** (ook onder **Settings** > **Calendar feed**), met één link per project. Op de iPhone opent **Open in Calendar** het ingebouwde abonneervenster. Op Android kun je je op de telefoon niet op een URL abonneren, dus het scherm biedt **Share link** en **Copy https link** en vraagt je de link op een computer toe te voegen, waarna hij naar de telefoon synchroniseert. De lijst **Your shifts** in de app komt uit dezelfde gegevens en heeft dezelfde actie **Get cover**.

## Abonneren in je agenda-app

Gebruik **Google Agenda** of **Apple Agenda / Outlook** in OneUptime waar je app een knop heeft; elke andere app neemt de `https://`-link die **Link kopiëren** je geeft. "https- en webcal-links" hieronder legt de twee vormen uit.

:::tabs
@tab Google Agenda
1. Klik op **Google Agenda** in OneUptime. Google Agenda opent en vraagt of de agenda moet worden toegevoegd; klik op **Toevoegen**.
2. Of klik in Google Agenda op het web naast **Andere agenda's** op **+** > **Via URL**, plak de link (**Link kopiëren** in OneUptime) en klik op **Agenda toevoegen**.

De knop **Google Agenda** opent de pagina van Google om een agenda via een URL toe te voegen, `https://calendar.google.com/calendar/r?cid=` gevolgd door de `webcal://`-vorm van de link, procentgecodeerd. Die pagina neemt alleen de `webcal://`-vorm aan: met de `https://`-vorm erin antwoordt Google "Unable to add calendar. Check the URL." **Via URL** neemt beide vormen aan.

Google haalt de feed op **vanaf de servers van Google**, dus de OneUptime-server moet vanaf internet bereikbaar zijn — OneUptime Cloud is dat altijd; zie voor een zelfgehoste installatie Probleemoplossing. De eerste keer ophalen gebeurt meestal binnen enkele minuten na het abonneren; daarna ververst Google ongeveer elke 8 tot 24 uur, soms langer. Er is geen verversknop voor geabonneerde agenda's, en Google negeert de verversingshints in de feed. De statusregel op de feedpagina meldt **Laatst opgehaald … door Google Calendar** zodra Google de link heeft gelezen.

De naam en de tijdzone van de agenda worden **alleen bij het eerste abonnement** gelezen: een rooster later hernoemen hernoemt de agenda in Google niet — verwijder hem en voeg hem opnieuw toe als de naam belangrijk is. Google laat herinneringen in agendabestanden vallen, dus stel standaardmeldingen voor die agenda in bij de instellingen van Google, of beter: gebruik de eigen herinneringen van OneUptime. Google onthoudt een adres dat het niet kon lezen: voeg na het verhelpen van de oorzaak de link opnieuw toe met `?nocache=1` erachter (OneUptime negeert onbekende queryparameters, dus de feed zelf verandert niet) of genereer de link opnieuw. De Google Agenda-app op Android en iOS kan zich niet via een URL abonneren; voeg de link op een computer toe en hij verschijnt op de telefoon.
@tab Outlook op het web
1. Open **Agenda** > **Agenda toevoegen** > **Abonneren vanaf internet**.
2. Plak de `https://`-link (**Link kopiëren** in OneUptime), geef de agenda een naam en klik op **Importeren**.

Dit werkt hetzelfde in Outlook.com, Outlook op het web voor werk- en schoolaccounts, de nieuwe Outlook voor Windows en Outlook voor Mac. Outlook haalt op **vanaf de servers van Microsoft**: ongeveer elke 3 uur voor Outlook.com en elke 4 tot 6 uur voor werk- en schoolaccounts, soms meer dan een dag. Het interval staat vast en er is geen handmatige verversing.

Abonneer je hier in plaats van in de desktopapp als je de agenda ook op je telefoon en in Outlook op het web wilt hebben — abonnementen die in de klassieke Outlook voor Windows zijn gemaakt, blijven op die pc.
@tab Klassieke Outlook voor Windows
1. Klik op een pc waarop Outlook is geïnstalleerd op **Apple Agenda / Outlook** in OneUptime. Windows geeft de `webcal://`-link door aan Outlook, dat vraagt of de internetagenda moet worden toegevoegd. Zonder Outlook heeft Windows geen `webcal`-handler.
2. Of open in Outlook **Bestand** > **Accountinstellingen** > **Accountinstellingen** > **Internetagenda's** > **Nieuw**, plak de link (**Link kopiëren** in OneUptime) en klik op **Toevoegen**.

Open de `https://…/shifts.ics`-link zelf **niet** in de klassieke Outlook: dat importeert een eenmalige momentopname die nooit wordt bijgewerkt. De `webcal://`-link openen, of het adres onder **Internetagenda's** toevoegen, maakt een abonnement aan.

De feed wordt ververst bij **Verzenden/ontvangen** (F9, of het interval onder Groepen voor verzenden/ontvangen). De instellingen van het abonnement hebben een selectievakje **Updatelimiet**: als het is aangevinkt, ververst Outlook niet vaker dan het interval dat de uitgever voorstelt. OneUptime stelt één uur voor (`X-PUBLISHED-TTL:PT1H`), dus de feed ververst ongeveer elk uur. Feeds zonder die hint verversen nooit zolang het vakje is aangevinkt; die van OneUptime hebben hem, dus je kunt het vakje aan laten. De klassieke Outlook haalt de feed op **vanaf je pc** en controleert het certificaat van de server.
@tab Apple Agenda (macOS)
1. Klik op **Apple Agenda / Outlook** in OneUptime, of kies in Agenda **Archief** > **Nieuw agenda-abonnement** en plak de link.
2. Stel in het abonneervenster **Vernieuw automatisch** in — elke 5 minuten, 15 minuten, uur, dag of week (elk uur is de standaard) — en kies **iCloud** onder **Locatie**, zodat de agenda ook op je iPhone en iPad verschijnt en volgens dat schema blijft verversen.

macOS haalt de feed op **vanaf je Mac**, dus het werkt voor een installatie op een privénetwerk zolang de Mac die kan bereiken. Een zelfondertekend certificaat of een certificaat van een interne CA moet eerst in de macOS-sleutelhanger worden vertrouwd. **Verwijder meldingen** is in dat venster standaard aangevinkt; hier maakt het niets uit, omdat de feed geen alarmen bevat.
@tab iPhone en iPad
Om je op het apparaat te abonneren, tik je op **Open in Calendar** in de mobiele app van OneUptime, of ga je naar **Instellingen** > **Agenda** > **Accounts** > **Voeg account toe** > **Andere** > **Voeg agenda-abonnement toe** en plak je de link.

Abonnementen die op het apparaat zelf zijn gemaakt, verversen volgens **Instellingen** > **Agenda** > **Accounts** > **Nieuwe gegevens** — standaard **Automatisch**, wat vooral ophaalt tijdens het opladen via wifi. Voor betrouwbaar verversen abonneer je je op een Mac met **iCloud** als locatie, of stel je **Nieuwe gegevens** in op een vast interval.
@tab Thunderbird
Kies **Bestand** > **Nieuw** > **Agenda** > **Op het netwerk** > **iCalendar (ICS)**, plak de `https://`-link en kies in de eigenschappen van de agenda een verversingsinterval: 1, 5, 15, 30 of 60 minuten. Thunderbird haalt op **vanaf je computer** en moet het certificaat van de server vertrouwen.
@tab Android
De Google Agenda-app en Samsung Agenda kunnen zich allebei niet op een URL abonneren. Voeg de `https://`-link op een computer aan Google Agenda toe (**Andere agenda's** > **+** > **Via URL**); de agenda synchroniseert daarna naar de telefoon, samen met al het andere in dat Google-account. De mobiele app van OneUptime op Android biedt **Share link** en **Copy https link** precies hiervoor.
@tab Andere diensten
Fastmail ververst ongeveer elk uur en **schakelt een abonnement uit na vijf mislukte pogingen op rij**; voeg het in dat geval opnieuw toe zodra de server weer gezond is. Proton Calendar ververst elke 4 tot 16 uur en weigert zeer grote feeds — verlaag **Dagen vooruit** als het klaagt. Confluence Team Calendars neemt de roosterfeed aan; de limiet van 28 tekens voor agendanamen wordt gerespecteerd.
:::

## Hoe vaak agenda's verversen

| Agenda-app | Gebruikelijke verversing | Haalt op vanaf | Opmerkingen |
| --- | --- | --- | --- |
| Google Agenda (Via URL) | 8–24 uur, soms langer | Servers van Google | Geen handmatige verversing; negeert verversingshints; naam en tijdzone alleen bij het eerste abonnement gelezen |
| Outlook.com | Ongeveer 3 uur | Servers van Microsoft | Vast; kan meer dan 24 uur zijn |
| Outlook op het web (werk, school) | Ongeveer 4–6 uur | Servers van Microsoft | Vast; niet door de gebruiker in te stellen |
| Klassieke Outlook voor Windows | Bij Verzenden/ontvangen; ongeveer elk uur met **Updatelimiet** | Je pc | Abonneer je via de `webcal`-link; synchroniseert niet naar telefoon of web |
| Apple Agenda (macOS) | 5 minuten tot wekelijks, standaard elk uur | Je Mac | Bewaar in iCloud om iPhone en iPad te bereiken |
| Apple Agenda (alleen iOS) | Volgens **Nieuwe gegevens**, afhankelijk van de batterij | Je telefoon | Abonneer je voor betrouwbaarheid op een Mac |
| Thunderbird | 1–60 minuten | Je computer | |
| Fastmail | Ongeveer elk uur | Servers van Fastmail | Uitgeschakeld na vijf mislukte pogingen |
| Proton Calendar | 4–16 uur | Servers van Proton | Weigert grote feeds |

OneUptime levert zelf verse gegevens: een wijziging aan een laag, een rotatie, een override of een koppeling aan een beleid maakt de feed meteen ongeldig, en antwoorden worden hooguit vijf minuten gecachet. Het wachten dat je ziet, komt van de agenda-app, niet van de server. OneUptime stelt via `REFRESH-INTERVAL` en `X-PUBLISHED-TTL` voor om elk uur te verversen; alleen de klassieke Outlook neemt die hint over, en alleen met **Updatelimiet** aan — Apple Agenda, Thunderbird en de rest verversen met het interval dat je per agenda instelt.

## https- en webcal-links

Beide wijzen naar dezelfde feed. `webcal://` is de link met een ander schema, zodat het besturingssysteem een agenda-app opent in plaats van een browser; de app haalt de feed daarna op via `https://` wanneer de server https levert, zoals Apple Agenda en Google Agenda doen.

- **Link kopiëren** geeft de `https://`-vorm. **Via URL** van Google Agenda, Outlook op het web, Thunderbird en Fastmail nemen die aan.
- **Apple Agenda / Outlook** opent de `webcal://`-vorm: Apple Agenda en de klassieke Outlook voor Windows abonneren zich daarmee. In de klassieke Outlook is het openen van de `https://`-vorm in plaats daarvan een eenmalige import.
- **Google Agenda** stopt de `webcal://`-vorm in de link van Google om via een URL toe te voegen, de enige vorm die die pagina aanneemt.
- OneUptime deelt geen `webcals://` meer uit: iOS opent het niet ("het adres is ongeldig"), en Google neemt het ook niet aan. Een agenda waarop je je al met een `webcals://`-link hebt geabonneerd, blijft werken.
- Draait je installatie nog op gewone `http`, dan wordt de feed onversleuteld opgehaald, token inbegrepen, en toont het dashboard een waarschuwing naast de link; schakel over op `https` voordat je links breed deelt.

Feed-URL's sturen nooit door. Ze antwoorden `200` op welk schema OneUptime ook bereikt, omdat de app niet kan zien welk schema de agenda-app gebruikte wanneer TLS ervoor eindigt — op OneUptime Cloud, of achter je eigen load balancer of CDN — en een doorverwijzing daar terugwijst naar dezelfde URL. Stuur gewone `http` door naar `https` op de proxy die TLS afhandelt, de enige hop die het weet.

## Herinneringen en meldingen over hertoewijzing

Agenda-apps bezorgen geen alarmen uit geabonneerde feeds — Google laat ze vallen, Apple verwijdert ze standaard, Outlook vlakt ze af — dus OneUptime stuurt zijn eigen.

:::steps
1. Open **Gebruikersinstellingen** > **Agenda** > **Agendafeed**.
2. Kies op de kaart **Herinner mij vóór diensten** hoe lang van tevoren: **1 week**, **1 dag**, **1 uur**, **15 min** of, met **Aangepast**, een eigen waarde tussen 15 minuten en 14 dagen. Je kunt er meerdere tegelijk kiezen.
3. Kies hoe herinneringen je bereiken onder **Voordat mijn oproepdienst begint** op **Gebruikersinstellingen** > **Meldingsinstellingen** (tabblad Bereikbaarheid). E-mail en push staan standaard aan.
:::

Elke herinnering wordt één keer per dienst verstuurd. Het bericht noemt het rooster, het beleid waarmee het oproept en de begintijd in jouw tijdzone.

- Een dienst die door een late override binnen een van je herinneringstijden valt — iemand geeft je een dienst 20 minuten voordat die begint — krijgt meteen één inhaalherinnering.
- Wordt een dienst waarvoor je een herinnering kreeg aan iemand anders gegeven, dan krijg je **Mijn komende oproepdienst wordt opnieuw toegewezen**, een apart soort gebeurtenis, zodat die apart kan worden gedempt.
- Herinneringen worden nooit verstuurd nadat een dienst is begonnen, en nooit voor roosters die aan geen enkel escalatiebeleid zijn gekoppeld, omdat die niemand kunnen oproepen.
- Op WhatsApp komt een herinnering binnen via het vooraf goedgekeurde bereikbaarheidssjabloon van Meta, dat het rooster en het escalatiebeleid noemt en naar het rooster linkt maar de begintijd niet bevat, en dat WhatsApp alleen in het Engels levert. Voor meldingen over hertoewijzing is er geen goedgekeurd WhatsApp-sjabloon, dus die bereiken je in plaats daarvan via je andere kanalen.

## Gedeelde links voor een rooster of een project

Een gedeelde link hoort bij het **project**, niet bij wie hem heeft gekopieerd, en hij toont de namen van mensen, nooit hun e-mailadressen. Zet de roosterlink in een gedeelde teamagenda — Google, Outlook of Confluence — en één abonnement bedient het hele team.

### Roosterfeed

Op de pagina van een rooster heeft de kaart **Abonneren op dit rooster** twee helften: **Alleen mijn diensten in dit rooster** (je persoonlijke link met een roosterfilter) en **Diensten van iedereen in dit rooster (gedeelde teamlink)**. Iedereen met de machtiging **Bewerken** op roosters kan **Gedeelde link publiceren** gebruiken, of de link met **Link opnieuw genereren** vernieuwen of met **Uitschakelen** uitzetten; iedereen die het rooster mag lezen, mag hem kopiëren. De kaart toont wanneer de link voor het laatst is vernieuwd.

### Projectfeed

**Bereikbaarheidsdienst** > **Agendafeeds** bevat de kaart **Diensten van iedereen in dit project (gedeelde link)** — één gedeelde link voor elk rooster in het project — met dezelfde acties voor publiceren, opnieuw genereren en uitschakelen, en een link naar de pagina van je persoonlijke feed.

### Instellingen van gedeelde links

Klik op **Instellingen bewerken** op de kaart **Instellingen gedeelde link**:

| Instelling | Wat het doet |
| --- | --- |
| **Dekkingsgaten tonen** | Standaard uit. Voegt een afspraak `No coverage · <Schedule>` toe overal waar een laag _bedoeld_ is om te dekken maar niemand dienst heeft: een lege laag, een laag waarvan de begindatum in de toekomst ligt, lagen die niet op elkaar aansluiten, of elk gat in een rooster van 24×7. Uren buiten kantoortijd van een rooster voor kantoortijden worden nooit gemeld, en er worden hooguit 100 gat-afspraken uitgegeven, oudste eerst. |
| **Minimaal te tonen gat (minuten)** | Standaard 60. Verbergt kortere gaten. |
| **Opnieuw genereren wanneer iemand het project verlaat** | Standaard uit. Genereert de link automatisch opnieuw wanneer iemand zijn laatste team in het project verlaat, zodat de agenda van een oud-collega niet meer wordt bijgewerkt. Alle anderen moeten zich daarna opnieuw abonneren, daarom moet je het zelf aanzetten. |
| **Dagen aan eerdere diensten**, **Dagen vooruit** | Zoals bij de persoonlijke feed. |

Vernieuw een gedeelde link wanneer iemand die hem had vertrekt, of zet de automatische vernieuwing hierboven aan.

Wanneer iemand zijn laatste team in een project verlaat, verwijdert OneUptime die persoon ook uit de roosterlagen en escalatieregels van dat project, verwijdert de lopende en toekomstige overrides van dat project waarin die persoon staat (als vervangen persoon of als vervanger), schakelt zijn persoonlijke feed voor het project uit en verwijdert zijn herinneringen daar. Een persoonlijke link toont alleen diensten zolang de eigenaar lid van het project is: dat wordt bij elke keer ophalen van de link gecontroleerd, dus wie is vertrokken krijgt een lege agenda, en de lijst met komende diensten in de mobiele app bevat alleen de projecten waarvan die persoon nog lid is.

## Afspraken in detail

- Elke dienst heeft een vaste identiteit die bestaat uit het rooster en het begin van de dienst, dus dezelfde dienst is dezelfde afspraak in je persoonlijke feed, in de roosterfeed en nadat je een link opnieuw genereert. Agenda-apps werken hem bij; een wijziging verhoogt het volgnummer van de afspraak.
- Een override die de hele dienst ruilt, houdt de afspraak en wijzigt de persoon; een override voor een deel van een dienst levert drie aansluitende afspraken op, bijvoorbeeld A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Wanneer een rooster aan twee of meer escalatiebeleiden is gekoppeld en een override maar voor één ervan geldt, verschillen de opgeroepen mensen per beleid. De feed toont dat in plaats van het te verbergen: de dienst houdt zijn afspraak voor de persoon die de andere beleiden oproepen, met een opmerking die het beleid noemt dat iemand anders oproept, en de vervanger krijgt een extra afspraak met de titel `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Diensten in het verleden hebben in hun beschrijving de regel "Past shifts reflect the current rotation, not who was actually paged".
- Een rooster dat aan geen enkel escalatiebeleid is gekoppeld, wordt nog steeds getoond, met een opmerking dat het niemand zal oproepen.

## Planning, geen audit

De feed toont de rotatie **zoals die nu is ingesteld**, ook voor dagen in het verleden: een override die achteraf wordt ingevoerd, herschrijft de geschiedenis in de agenda. Voor de uren die echt in bereikbaarheid zijn doorgebracht, eerlijkheidsbeoordelingen en vergoedingen gebruik je **Bereikbaarheidsdienst** > **Rapporten** > **Bereikbaarheidstijd gebruiker**, dat wordt opgebouwd uit wat de pager echt heeft gedaan.

## Beveiliging

- Het token in de link is het enige inloggegeven. Iedereen die de link heeft, ziet de diensten — namen, roosters, beleid — totdat hij opnieuw wordt gegenereerd. Plak links niet in chatkanalen of tickets; heeft een team een agenda nodig, deel dan de rooster- of projectlink in plaats van je persoonlijke.
- Links zijn per project. Een uitgelekte persoonlijke link stelt de diensten van één project bloot, niet van elk project waarvan je lid bent.
- Een link opnieuw genereren zet het oude token in een respijtperiode van 30 dagen (lege agenda, daarna 404). **Uitschakelen** levert een lege agenda. Een onbekende of verlopen link geeft een kale 404 zonder hint. Lege agenda's laten geabonneerde apps hun kopie leegmaken; een 404 laat ze die bewaren, daarom leveren uitschakelen en opnieuw genereren lege agenda's.
- Tokens worden gehasht opgeslagen; de kopie op de instellingenpagina is versleuteld met `ENCRYPTION_SECRET`. Stel die variabele op een zelfgehoste installatie in op een echt geheim — de server waarschuwt bij het opstarten wanneer hij niet is ingesteld of nog een van de plaatshouders is die deze repository meelevert (`secret`, of de `please-change-this-to-random-value` die `config.example.env` instelt). Wijzig je hem later, dan biedt de pagina **Link opnieuw genereren** aan, omdat de opgeslagen kopie niet meer kan worden gelezen; de feed blijft werken tot je dat doet.
- Feedantwoorden zijn gemarkeerd met `Cache-Control: private`, worden uitgesloten van zoekmachines (`X-Robots-Tag: noindex`) en hebben een snelheidslimiet per link en per clientadres.

De eigen Nginx van OneUptime houdt feedverzoeken uit zijn logboeken:

```nginx title="default.conf.template"
location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
    access_log off;
    error_log /dev/null crit;
    proxy_max_temp_file_size 0;
    ...
}
```

Zo komt een token nooit in een logbestand naast een clientadres terecht; de applicatie logt hem ook nooit. `access_log off` laat de regel per verzoek vallen, `error_log` laat de regels vallen die Nginx schrijft wanneer ophalen bij de upstream mislukt — zonder dat wordt het token vastgelegd van elke client die tijdens een herstart ophaalt — en `proxy_max_temp_file_size 0` houdt een grote feed uit een tijdelijk bestand.

> [!WARNING]
> **Elke proxy, WAF of CDN die je vóór OneUptime draait, logt nog steeds de volledige URI, in zijn toegangslogboek en in zijn foutenlogboek,** tenzij je hem anders configureert — controleer dat voordat je feeds uitrolt.

## Configuratie bij zelf hosten

Er hoeft niets te worden aangezet: feeds werken op elke installatie. Vier omgevingsvariabelen bepalen ze, in te stellen in `config.env` voor Docker Compose of onder `onCallCalendarFeed` in de Helm-values (zie de [configuratiereferentie](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) van de chart):

| Variabele | Helm-value | Standaard | Effect |
| --- | --- | --- | --- |
| `DISABLE_ON_CALL_CALENDAR_FEED` | `onCallCalendarFeed.disabled` | `false` | Noodschakelaar. Elke feed-URL antwoordt `503` met `Retry-After: 3600`; geabonneerde apps houden hun kopie en proberen het later opnieuw. Er wordt niets verwijderd. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS` | `onCallCalendarFeed.rateLimit.windowSeconds` | `60` | Lengte van het venster voor de snelheidslimiet. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60` | Hoe vaak één link per venster vanaf één clientadres mag worden opgehaald. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perIpPerWindow` | `3000` | Hoe vaak één clientadres per venster over alle links heen mag ophalen — het plafond voor een heel kantoor achter één adres. |

Ook van belang:

- **`HOST` en `HTTP_PROTOCOL`** bouwen de links. Is `HOST` leeg of `localhost`, of is `HTTP_PROTOCOL` `http`, dan toont de feedpagina een waarschuwing en werken de links niet van buitenaf. Is `HOST` een privéadres — `10.x`, `172.16–31.x`, `192.168.x`, een naam zonder punt zoals een containernaam, of een naam onder `.internal`, `.local`, `.lan` en dergelijke — dan zegt de pagina dat Google Agenda en Outlook op het web de link niet kunnen bereiken; apps op een computer in hetzelfde netwerk kunnen dat nog wel.
- **`TRUSTED_PROXY_HOPS`** bepaalt welk adres de limiet per adres telt. De standaard `1` klopt voor de standaardopzet van Docker Compose en Helm; tel er één bij op voor elke eigen proxy — een CDN, WAF of load balancer — die iets aan `X-Forwarded-For` toevoegt, anders lijkt elke agendaclient hetzelfde adres en delen ze één budget. Zie [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) in de documentatie van de chart.
- **Redis** ondersteunt de caches en de snelheidsbegrenzer. Beide vallen netjes terug: zonder Redis worden feeds nog steeds opgebouwd, alleen langzamer, en de begrenzer laat verzoeken door.
- In de gesplitste modus van de Helm-chart (`worker.enabled: true`) worden feeds op de API-laag opgebouwd, dus dimensioneer die laag voor een piek van agendaclients die aan het begin van het uur ophalen.
- De uitzondering voor het Nginx-toegangslogboek hierboven maakt deel uit van de meegeleverde `packages/Nginx/default.conf.template`; behoud die als je de template aanpast.

## Probleemoplossing

:::details Google Agenda meldt "Unable to add calendar. Check the URL."
Oudere versies van OneUptime zetten de `https://`-vorm van de link in de knop **Google Agenda**, en de pagina van Google om via een URL toe te voegen neemt alleen de `webcal://`-vorm aan. Laad de feedpagina opnieuw en klik nogmaals op **Google Agenda**, of voeg de link toe onder **Andere agenda's** > **+** > **Via URL**.
:::

:::details Google Agenda toont de agenda, maar geen diensten
Controleer eerst de statusregel op de feedpagina. **Laatst opgehaald … door Google Calendar** betekent dat Google de link heeft gelezen: open de link in een browser en kijk wat hij levert — een lege agenda noemt zijn reden in `X-WR-CALDESC` (zie "De agenda is leeg" hieronder).

**Nog niet opgehaald** betekent dat Google hem niet kon lezen: vanaf een machine buiten je netwerk moet `curl -sI <link>` meteen `200` antwoorden met `Content-Type: text/calendar`. Een doorverwijzing, een inlogpagina, een firewall of een botcontrole vóór OneUptime houdt de ophaler van Google tegen; dat deed in oudere versies van OneUptime ook een doorverwijzingslus, op installaties met `PROVISION_SSL=true` waarvan TLS vóór Nginx eindigt. Zodra hij `200` antwoordt, voeg je de link opnieuw toe met `?nocache=1` erachter, zodat Google hem opnieuw leest.
:::

:::details Niets heeft de link opgehaald, of "Kan de URL niet ophalen"
Google Agenda, Outlook op het web, Fastmail en Proton halen op **vanaf hun eigen servers**, dus de OneUptime-host moet vanaf het openbare internet bereikbaar zijn met een certificaat dat zij vertrouwen. Een installatie op een privénetwerk, achter een VPN of met een interne certificeringsinstantie is voor hen onbereikbaar, wat je ook plakt.

Apple Agenda, Thunderbird en de klassieke Outlook halen op vanaf het apparaat, dus ze werken overal waar het apparaat het dashboard kan openen — nadat het certificaat op dat apparaat is vertrouwd als het zelfondertekend is. De statusregel op de feedpagina vertelt of iets de link al heeft opgehaald; `curl -I` op de link vanaf buiten je netwerk is de snelste controle:

```bash
curl -I "https://<your host>/api/on-call-calendar/user/<token>/shifts.ics"
```

OneUptime privénetwerken laten _bereiken_ — [Toegang tot privénetwerk](/docs/self-hosted/private-network-access) — is iets anders en helpt hier niet.
:::

:::details De agenda is verouderd
Lees eerst de verversingstabel: voor Google is de vertraging normaal. Om Google opnieuw te laten kijken, verwijder je de agenda en voeg je hem opnieuw toe, of zet je `?nocache=1` achter de link (onbekende parameters worden genegeerd, dus de feed verandert niet, maar Google behandelt hem als nieuw). Druk in de klassieke Outlook op F9 en controleer de instelling **Updatelimiet**. Gebruik in Apple Agenda **Weergave** > **Vernieuw agenda's**. Is een wijziging op dezelfde dag belangrijk, vertrouw dan op de herinneringen en meldingen over hertoewijzing van OneUptime in plaats van op de agenda.
:::

:::details De agenda is leeg
Een lege agenda is opzettelijk. Het betekent dat de link is uitgeschakeld, een oude link is binnen zijn respijtperiode van 30 dagen na opnieuw genereren, het project onder het abonnement zit dat bereikbaarheidsschema's bevat, of dat je in dat project in geen enkel rooster meer staat. Open de link in een browser: de agendabeschrijving (`X-WR-CALDESC`) noemt de reden. Als je het project hebt verlaten, blijft de link leeg: hij toont alleen diensten zolang je lid bent.
:::

:::details De link geeft 404
De link is onbekend, is verwijderd, of zijn respijtperiode is afgelopen. Genereer een nieuwe en abonneer je opnieuw.
:::

:::details De link geeft 503
Ofwel `DISABLE_ON_CALL_CALENDAR_FEED` is ingesteld, ofwel de server heeft het druk: er worden hooguit een paar feeds tegelijk opgebouwd, en een rooster dat heel lang duurt om uit te rekenen, wordt afgebroken. Bestaat er een eerdere kopie van de feed, dan levert de server die in plaats daarvan, met een header `Warning: 110`, dus een 503 betekent dat er niets was om op terug te vallen. Clients houden hun laatste kopie en proberen het opnieuw na het interval van `Retry-After`. Fastmail schakelt een abonnement uit na vijf mislukkingen op rij; voeg het opnieuw toe zodra de server weer gezond is. De metriek `oncall_calendar_render_duration_ms` laat beheerders zien welke feeds traag zijn.
:::

:::details 429 of "too many requests"
Veel clients achter één adres — een kantoor-NAT, een VPN-gateway — delen het budget per adres. Verhoog `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` en controleer `TRUSTED_PROXY_HOPS`: is die te laag, dan wordt elke client aan je eigen proxy toegeschreven en delen ze allemaal één budget.
:::

:::details Certificaatfouten in Apple Agenda, Thunderbird of Outlook
Deze apps controleren TLS op het apparaat. Importeer je interne CA in de vertrouwensopslag van het apparaat — de macOS-sleutelhanger, het Windows-certificaatarchief, de certificaatbeheerder van Thunderbird — of gebruik een openbaar vertrouwd certificaat. Ophalers aan de serverkant, zoals die van Google en Microsoft, zijn niet zover te krijgen dat ze een privé-CA vertrouwen.
:::

:::details Tijden kloppen niet
Alle tijden in het bestand zijn UTC; de agenda-app rekent ze om naar zijn eigen zone. Lijken diensten met een vaste afwijking verschoven, controleer dan de tijdzone van het rooster (**Schedule timezone** op de pagina **Lagen** ervan) en je eigen (**Tijdzone** op je **Profiel**). Een rooster zonder tijdzone wordt uitgerekend in de zone van de server, en de afspraak meldt dat.
:::

:::details De feed meldt dat hij is ingekort
Er vielen meer dan 5.000 afspraken binnen het venster. Verlaag **Dagen vooruit**, of abonneer je op **Alleen mijn diensten in dit rooster** in plaats van op een heel project.
:::

:::details Google toont een oude agendanaam
Google leest de naam alleen bij het eerste abonnement; verwijder de agenda en voeg hem opnieuw toe.
:::

:::details De instellingenpagina meldt dat de link opnieuw moet worden gegenereerd
`ENCRYPTION_SECRET` is gewijzigd sinds de link is gemaakt, dus de server kan hem niet meer tonen. Het bestaande abonnement blijft werken; opnieuw genereren geeft je een link die je weer kunt kopiëren en trekt de oude na 30 dagen in.
:::

:::details Er ontbreekt een dienst in mijn feed
Alleen diensten uit roosters verschijnen; rechtstreekse toewijzingen van gebruikers of teams in een beleidsregel zijn vast en hebben geen afspraken. Een dienst die iemand anders via een override heeft overgenomen, verdwijnt uit jouw feed, omdat hij nu in die van de ander staat. Zet **Diensten opnemen die ik voor anderen overneem** aan om diensten te zien die je via overrides hebt gekregen in roosters waarvan je geen lid bent.
:::

## Volgende stappen

:::cards
- [Bereikbaarheidsschema's](/docs/on-call/schedules): Stel de rotaties in die je feeds tonen.
- [Tijdlijn van bereikbaarheidsschema's](/docs/on-call/schedule-timeline): Bekijk alle roosters naast elkaar in het dashboard.
- [Escalatieregels](/docs/on-call/escalation-rules): Koppel roosters aan beleid, zodat hun diensten mensen oproepen.
:::
