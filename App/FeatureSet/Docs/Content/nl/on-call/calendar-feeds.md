# Agendafeeds (piketdiensten in Google Agenda, Outlook en Apple Agenda)

Agendafeeds zetten je piketdiensten in de agenda waar je toch al naar kijkt. OneUptime publiceert een geheime iCalendar-link (`.ics`) per persoon, per rooster en per project; Google Agenda, Outlook, Apple Agenda, Thunderbird en elke andere app die zich via een URL op een agenda kan abonneren, halen die link periodiek op en tonen één afspraak per dienst. Er wordt niets geïnstalleerd en er wordt geen account gekoppeld: de link is de hele integratie.

> **Note:** Een geabonneerde agenda is bedoeld voor **planning**. Agenda-apps halen feeds in hun eigen tempo opnieuw op — Google Agenda slechts elke 8 tot 24 uur —, dus een ruil die een uur voor een dienst wordt gedaan bereikt je via de eigen herinneringen, hertoewijzingsberichten en pagermeldingen van OneUptime, niet via de agenda.

## Wat je krijgt

- Eén afspraak per dienst, met de titel `On-call · <Schedule>` in je persoonlijke feed en `<Name> · On-call · <Schedule>` in een gedeelde feed. De omschrijving vermeldt wie piket heeft, het rooster en zijn tijdzone, de laag, de dienst in de tijdzone van het rooster, in UTC en in de jouwe, via welke escalatiebeleidsregels je via dit rooster wordt opgeroepen, en een link naar het rooster in het dashboard.
- Overrides worden gerespecteerd. Als iemand voor je invalt, gaat de afspraak naar die persoon (`(covering for <Name>)` wordt toegevoegd) en blijft het dezelfde afspraak in je agenda-app, zodat hij ter plekke wordt bijgewerkt in plaats van gedupliceerd. Een gedeeltelijke override splitst de dienst in aansluitende afspraken.
- Standaard twee dagen geschiedenis en 90 dagen vooruit. Je kunt dit verruimen tot 60 dagen terug en 180 dagen vooruit; een feed die meer dan 5.000 afspraken zou bevatten wordt ingekort en meldt dat in de agendabeschrijving.
- Afspraken zijn gemarkeerd als vrij (`TRANSP:TRANSPARENT`), dus een geabonneerde feed blokkeert nooit je beschikbaarheid, en niets is als privé gemarkeerd, zodat een gedeelde teamagenda de titels toont aan iedereen die hem kan zien.
- Tijden worden in UTC verzonden en door je agenda-app omgerekend; de omschrijving noemt de kloktijd in de tijdzone van het rooster en in de jouwe. Stel je eigen tijdzone in onder **Gebruikersinstellingen** > **Profiel** en die van het rooster op zijn tabblad **Instellingen**. Een rooster zonder tijdzone wordt berekend in de tijdzone van de server, net als bij het oproepen, en de afspraak vermeldt dat.

Vaste toewijzingen — een gebruiker of team dat rechtstreeks in een regel van een escalatiebeleid staat — hebben geen begin of einde en verschijnen in geen enkele feed. In OneUptime Cloud volgen feeds hetzelfde abonnement als piketroosters (Growth); een project onder dat abonnement krijgt een lege agenda in plaats van een fout.

## Drie soorten links

| Link                  | Wie maakt hem                                                                           | Wat hij bevat                                                                                        | Waar                                                          |
| --------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Persoonlijke feed** | Elke gebruiker, één per project                                                         | Je diensten op elk rooster in dat project, plus de diensten waarin je voor iemand invalt (optioneel) | **Gebruikersinstellingen** > **Agendafeed**                   |
| **Roosterfeed**       | Iedereen die het rooster mag bewerken; iedereen die het mag lezen mag de link kopiëren  | Ieders diensten op één rooster, met optionele afspraken voor dekkingsgaten                           | De pagina van het rooster, kaart **Abonneren op dit rooster** |
| **Projectfeed**       | Iedereen die piketroosters mag bewerken; iedereen die ze mag lezen mag de link kopiëren | Ieders diensten op elk rooster in het project, met optionele afspraken voor dekkingsgaten            | **Piket** > **Agendafeeds**                                   |

De links zien er zo uit:

```
https://<jouw host>/api/on-call-calendar/user/<token>/shifts.ics
https://<jouw host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<jouw host>/api/on-call-calendar/project/<token>/project.ics
```

Het token van 43 tekens in het pad is de enige inloggegevens — er komt geen login, cookie of API-sleutel aan te pas. Behandel elk van deze links als een wachtwoord.

## Je persoonlijke feed

1. Open **Gebruikersinstellingen** > **Agendafeed** in het project waarvan je de diensten wilt. Persoonlijke feeds zijn per project: een tweede project krijgt een tweede link en een tweede agenda.
2. Klik op **Agendalink genereren**. De kaart **Abonneer je op je piketdiensten** toont nu de `https://`-link en drie knoppen:
   - **Google Agenda** opent Google Agenda met de link al ingevuld.
   - **Apple / andere apps** opent de `webcals://`-vorm van de link, die macOS, iOS en de meeste desktop-apps rechtstreeks aan hun abonneerdialoog doorgeven.
   - **Webcal-link kopiëren** kopieert diezelfde `webcal(s)://`-link — degene die klassiek Outlook voor Windows nodig heeft.
3. Abonneer je in je agenda-app volgens de stappen per app hieronder.

Instellingen op dezelfde kaart:

- **Diensten meenemen die ik voor anderen overneem** (standaard aan) voegt de diensten toe die een override je geeft op roosters waarvan je verder geen lid bent.
- **Dagen eerdere diensten** (standaard 2, maximaal 60) en **Dagen vooruit** (standaard 90, tussen 7 en 180).

De statusregel toont wanneer de link voor het laatst is opgehaald, door welke agenda-app, hoe vaak, en de laatste vier tekens van het token zodat je links uit elkaar kunt houden. Als na twee dagen niets de link heeft opgehaald, vraagt de pagina of de server vanaf internet bereikbaar is (zie Problemen oplossen).

De pagina toont ook je **Komende diensten** (de volgende 30 dagen), elk met een link **Vervanging regelen** die de gebruikersoverrides vooraf ingevuld voor die dienst opent, en de kaart **Herinner me voor diensten** die verderop wordt beschreven.

Acties:

- **Link opnieuw genereren** maakt een nieuw token. Elke app die op de oude link is geabonneerd stopt met bijwerken: 30 dagen lang levert de oude link een lege agenda zodat die apps hun kopie wissen, daarna geeft hij 404. Abonneer je opnieuw met de nieuwe link.
- **Uitschakelen** houdt de link, maar levert een lege agenda totdat je hem weer inschakelt.
- **Verwijderen** verwijdert de link. Apps die hem nog opvragen krijgen 404 en blijven tonen wat ze het laatst hebben opgehaald — schakel eerst uit als je wilt dat ze leeglopen.

Dezelfde persoonlijke link, gefilterd op één rooster met `?schedule=<id>`, wordt op elke roosterpagina aangeboden als **Alleen mijn diensten op dit rooster**, en de piketbanner en de pagina **Mijn piketbeleid** hebben een link **Je diensten aan je agenda toevoegen** naar de bovenstaande pagina.

In de mobiele app: **Piket** > **Diensten aan mijn agenda toevoegen** (ook onder **Instellingen** > **Agendafeed**), met één link per project. Op de iPhone opent **Openen in Agenda** het systeemeigen abonneerblad. Op Android is er geen manier om je op de telefoon op een URL te abonneren, dus het scherm biedt **Link delen** en **https-link kopiëren** en vraagt je de link op een computer toe te voegen, waarna hij naar de telefoon synchroniseert. De lijst **Jouw diensten** in de app komt uit dezelfde gegevens en heeft dezelfde actie **Vervanging regelen**.

## Abonneren in je agenda-app

Gebruik de `https://`-link tenzij de app om `webcal` vraagt; de sectie over schema's hieronder legt het verschil uit.

### Google Agenda (web)

1. Klik in Google Agenda op het web naast **Andere agenda's** op **+** > **Via URL**.
2. Plak de `https://`-link en klik op **Agenda toevoegen**. De knop **Google Agenda** in OneUptime doet hetzelfde met de link al ingevuld.

Google haalt de feed op **vanaf de servers van Google**, ruwweg elke 8 tot 24 uur en soms langer. Er is geen vernieuwknop voor geabonneerde agenda's, en Google negeert de vernieuwhints in de feed. De naam en tijdzone van de agenda worden **alleen bij het eerste abonneren** gelezen: een rooster later hernoemen hernoemt de agenda in Google niet — verwijder hem en voeg hem opnieuw toe als de naam belangrijk is. Google laat herinneringen in agendabestanden vallen; stel dus standaardmeldingen voor die agenda in bij de Google-instellingen, of beter, gebruik de eigen herinneringen van OneUptime. Meldt Google dat de URL niet kon worden opgehaald, controleer dan of je de `https://`-vorm hebt geplakt en niet `webcal://`, en voeg `?nocache=1` toe om hem opnieuw te laten kijken (OneUptime negeert onbekende queryparameters, de feed zelf verandert niet). De Google Agenda-app op Android en iOS kan zich niet via een URL abonneren; voeg de link op een computer toe en hij verschijnt op de telefoon.

### Outlook op het web en Outlook.com

1. Open **Agenda** > **Agenda toevoegen** > **Abonneren vanaf web**.
2. Plak de `https://`-link, geef de agenda een naam en klik op **Importeren**.

Outlook haalt op **vanaf de servers van Microsoft**: ongeveer elke 3 uur voor Outlook.com en elke 4 tot 6 uur voor werk- en schoolaccounts, soms meer dan een dag. Het interval ligt vast en er is geen handmatige vernieuwing. Abonneer je hier in plaats van in de desktop-app als je de agenda ook op je telefoon en in Outlook op het web wilt — abonnementen die in klassiek Outlook voor Windows zijn gemaakt blijven op die pc. Het nieuwe Outlook voor Windows en Outlook voor Mac gebruiken dezelfde dialoog **Agenda toevoegen** > **Abonneren vanaf web**.

### Klassiek Outlook voor Windows

1. Klik in OneUptime op **Webcal-link kopiëren**.
2. Open in Outlook **Bestand** > **Accountinstellingen** > **Accountinstellingen** > **Internetagenda's** > **Nieuw**, plak de `webcals://`-link en klik op **Toevoegen**. Een `webcal`-link in een browser openen werkt ook op een pc waarop Outlook is geïnstalleerd; zonder Outlook heeft Windows geen `webcal`-handler.

Open **niet** de `https://…/shifts.ics`-link zelf in klassiek Outlook: die importeert een eenmalige momentopname die nooit wordt bijgewerkt. Alleen `webcal://` en `webcals://` maken een abonnement.

De feed wordt vernieuwd bij **Verzenden/ontvangen** (F9, of het interval onder Groepen voor verzenden/ontvangen). De instellingen van het abonnement hebben een selectievakje **Bijwerklimiet**: aangevinkt vernieuwt Outlook niet sneller dan het interval dat de uitgever voorstelt. OneUptime stelt één uur voor (`X-PUBLISHED-TTL:PT1H`), dus de feed wordt ongeveer elk uur vernieuwd. Feeds zonder die hint worden nooit vernieuwd zolang het vakje is aangevinkt; die van OneUptime bevatten hem, dus je kunt het vakje aan laten. Klassiek Outlook haalt de feed op **vanaf je pc** en controleert het certificaat van de server.

### Apple Agenda op macOS

1. Klik op **Apple / andere apps** in OneUptime, of kies in Agenda **Archief** > **Nieuw agenda-abonnement** en plak de link.
2. Stel in het abonneerblad **Automatisch vernieuwen** in — elke 5 minuten, 15 minuten, uur, dag of week (elk uur is standaard) — en kies **iCloud** onder **Locatie** zodat de agenda ook op je iPhone en iPad verschijnt en in dat tempo blijft vernieuwen.

macOS haalt de feed op **vanaf je Mac**, dus het werkt voor een installatie in een privénetwerk zolang de Mac erbij kan. Een zelfondertekend of intern-CA-certificaat moet eerst in de macOS-sleutelhanger vertrouwd worden. **Verwijder meldingen** staat in dat blad standaard aangevinkt; dat maakt hier niets uit omdat de feed geen alarmen bevat.

### iPhone en iPad

Abonnementen die op het apparaat zelf zijn gemaakt vernieuwen volgens **Instellingen** > **Agenda** > **Accounts** > **Nieuwe gegevens** — standaard **Automatisch**, wat vooral ophaalt tijdens het opladen via wifi. Voor betrouwbare vernieuwing abonneer je je op een Mac met **iCloud** als locatie, of stel je **Nieuwe gegevens** in op een vast interval. Om je op het apparaat te abonneren tik je op **Openen in Agenda** in de mobiele app van OneUptime, of ga je naar **Instellingen** > **Agenda** > **Accounts** > **Voeg account toe** > **Anders** > **Voeg agenda-abonnement toe** en plak je de link.

### Thunderbird

Kies **Bestand** > **Nieuw** > **Agenda** > **Op het netwerk** > **iCalendar (ICS)**, plak de `https://`-link en kies een vernieuwinterval in de eigenschappen van de agenda: 1, 5, 15, 30 of 60 minuten. Thunderbird haalt op **vanaf je computer** en moet het certificaat van de server vertrouwen.

### Fastmail, Proton en andere diensten

Fastmail vernieuwt ruwweg elk uur en **schakelt een abonnement uit na vijf opeenvolgende mislukte ophaalpogingen**; gebeurt dat, voeg het dan opnieuw toe zodra de server weer gezond is. Proton Calendar vernieuwt elke 4 tot 16 uur en weigert zeer grote feeds — verlaag **Dagen vooruit** als hij klaagt. Confluence Team Calendars accepteert de roosterfeed; de limiet van 28 tekens voor agendanamen wordt gerespecteerd.

### Android

Noch de Google Agenda-app, noch Samsung Agenda kan zich op een URL abonneren. Voeg de `https://`-link op een computer toe aan Google Agenda (**Andere agenda's** > **+** > **Via URL**); de agenda synchroniseert dan met al het andere in dat Google-account naar de telefoon. De mobiele app van OneUptime op Android biedt precies hiervoor **Link delen** en **https-link kopiëren**.

## Hoe vaak agenda's vernieuwen

| Agenda-app                        | Typische vernieuwing                                            | Haalt op vanaf        | Opmerkingen                                                                                      |
| --------------------------------- | --------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| Google Agenda (Via URL)           | 8–24 uur, soms langer                                           | Servers van Google    | Geen handmatige vernieuwing; negeert hints; naam en tijdzone alleen bij eerste abonneren gelezen |
| Outlook.com                       | Ongeveer 3 uur                                                  | Servers van Microsoft | Vast; kan 24 uur overschrijden                                                                   |
| Outlook op het web (werk, school) | Ongeveer 4–6 uur                                                | Servers van Microsoft | Vast; geen gebruikerscontrole                                                                    |
| Klassiek Outlook voor Windows     | Bij Verzenden/ontvangen; ongeveer elk uur met **Bijwerklimiet** | Je pc                 | Heeft een `webcal`-link nodig; synchroniseert niet naar telefoon of web                          |
| Apple Agenda (macOS)              | 5 minuten tot wekelijks, standaard elk uur                      | Je Mac                | Bewaar in iCloud om iPhone en iPad te bereiken                                                   |
| Apple Agenda (alleen iOS)         | Volgens **Nieuwe gegevens**, beperkt door batterij              | Je telefoon           | Abonneer je op een Mac voor betrouwbaarheid                                                      |
| Thunderbird                       | 1–60 minuten                                                    | Je computer           |                                                                                                  |
| Fastmail                          | Ongeveer elk uur                                                | Servers van Fastmail  | Uitgeschakeld na vijf mislukte ophaalpogingen                                                    |
| Proton Calendar                   | 4–16 uur                                                        | Servers van Proton    | Weigert grote feeds                                                                              |

OneUptime zelf levert verse gegevens: een wijziging aan een laag, een rotatie, een override of een beleidskoppeling maakt de feed meteen ongeldig, en antwoorden worden hooguit vijf minuten gecachet. De wachttijd die je ziet is die van de agenda-app, niet van de server. OneUptime stelt via `REFRESH-INTERVAL` en `X-PUBLISHED-TTL` een uurlijkse vernieuwing voor; alleen klassiek Outlook en Apple Agenda nemen die hint over.

## https, webcal en webcals

Alle drie wijzen naar dezelfde feed. `webcal://` en `webcals://` zijn de `http://`- en `https://`-link met een hernoemd schema, zodat het besturingssysteem een agenda-app opent in plaats van een browser; `webcals` is de versleutelde variant en is wat OneUptime aanbiedt als `HTTP_PROTOCOL` op `https` staat.

- Google Agenda, Outlook op het web, Thunderbird en Fastmail willen de `https://`-vorm.
- Apple Agenda en klassiek Outlook voor Windows abonneren zich vanaf een `webcal(s)://`-link; in klassiek Outlook is de `https://`-vorm een eenmalige import.
- `webcal://` zonder de `s` is onversleuteld en stuurt het token bij elke ophaalactie in klare tekst. Draait je installatie nog op gewoon `http`, dan toont het dashboard een waarschuwing naast de link; stap over op `https` voordat je links breed deelt.

## Herinneringen en hertoewijzingsberichten

Agenda-apps leveren geen alarmen uit geabonneerde feeds — Google laat ze vallen, Apple verwijdert ze standaard, Outlook maakt ze plat —, dus OneUptime stuurt zijn eigen herinneringen.

Onder **Gebruikersinstellingen** > **Agendafeed** laat de kaart **Herinner me voor diensten** je voorlooptijden kiezen: **1 week**, **1 dag**, **1 uur**, **15 min** of een eigen waarde tussen 15 minuten en 14 dagen, meerdere tegelijk. Elke herinnering wordt eenmaal per dienst verzonden via de bezorgmethoden die je hebt gekozen voor **Voordat mijn piketdienst begint** onder **Gebruikersinstellingen** > **Meldingsinstellingen** (tabblad Piket; e-mail en push staan standaard aan). Het bericht noemt het rooster, het beleid waarlangs het oproept en de begintijd in jouw tijdzone.

- Een dienst die door een late override binnen een van je voorlooptijden valt — iemand geeft je 20 minuten voor het begin een dienst — krijgt meteen één inhaalherinnering.
- Als een dienst waarvoor je herinnerd bent aan iemand anders wordt gegeven, krijg je **Mijn komende piketdienst is opnieuw toegewezen**, een apart gebeurtenistype dat afzonderlijk kan worden gedempt.
- Herinneringen worden nooit verzonden nadat een dienst is begonnen, en nooit voor roosters die aan geen enkel escalatiebeleid zijn gekoppeld, omdat die niemand kunnen oproepen.

## Gedeelde links voor een rooster of een project

Een gedeelde link is van het **project**, niet van degene die hem heeft gekopieerd, en toont namen van mensen, nooit hun e-mailadressen.

**Roosterfeed.** Op de pagina van een rooster heeft de kaart **Abonneren op dit rooster** twee helften: **Alleen mijn diensten op dit rooster** (je persoonlijke link met een roosterfilter) en **Ieders diensten op dit rooster (gedeelde teamlink)**. Iedereen met de machtiging **Bewerken** op roosters kan **Gedeelde link publiceren**, hem **Opnieuw genereren** of **Uitschakelen**; iedereen die het rooster mag lezen kan hem kopiëren. De kaart toont wanneer de link voor het laatst is geroteerd.

**Projectfeed.** **Piket** > **Agendafeeds** bevat de kaart **Ieders diensten in dit project (gedeelde link)** — één gedeelde link die elk rooster in het project dekt — met dezelfde acties voor publiceren, opnieuw genereren en uitschakelen, en een link naar je persoonlijke feedpagina.

Instellingen op beide:

- **Dekkingsgaten tonen** (standaard uit) voegt een afspraak `No coverage · <Schedule>` toe overal waar een laag _hoort_ te dekken maar niemand piket heeft: een lege laag, een laag met een begindatum in de toekomst, lagen die niet op elkaar aansluiten, of elk gat in een 24×7-rooster. De uren buiten kantoortijd van een kantoorurenrooster worden nooit gemeld. **Minimaal te tonen gat (minuten)** (standaard 60) verbergt kortere gaten; er worden hooguit 100 gatafspraken uitgegeven, de oudste eerst.
- **Opnieuw genereren wanneer iemand het project verlaat** (standaard uit) genereert de link automatisch opnieuw wanneer iemand zijn laatste team in het project verlaat, zodat de agenda van een oud-collega stopt met bijwerken. Alle anderen moeten zich daarna opnieuw abonneren, daarom is het opt-in.
- **Dagen eerdere diensten** en **Dagen vooruit**, zoals bij de persoonlijke feed.

Zet de roosterlink in een gedeelde teamagenda — Google, Outlook of Confluence — en één abonnement bedient het hele team. Roteer hem als iemand die hem had vertrekt, of schakel de automatische rotatie hierboven in.

Wanneer iemand zijn laatste team in een project verlaat, verwijdert OneUptime die persoon ook uit de roosterlagen en escalatieregels van dat project, schakelt zijn persoonlijke feed voor het project uit en verwijdert zijn herinneringen daar.

## Afspraken in detail

- Elke dienst heeft een stabiele identiteit die uit het rooster en het begin van de dienst bestaat, zodat dezelfde dienst dezelfde afspraak is in je persoonlijke feed, in de roosterfeed en na het opnieuw genereren van een link. Agenda-apps werken hem ter plekke bij; een wijziging verhoogt het volgnummer van de afspraak.
- Een override die de hele dienst ruilt behoudt de afspraak en wisselt de persoon; een override die een deel van een dienst dekt levert drie aansluitende afspraken op, bijvoorbeeld A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Wanneer een rooster aan twee of meer escalatiebeleidsregels is gekoppeld en een override slechts op één daarvan van toepassing is, verschillen de opgeroepen personen per beleid. De feed toont dit in plaats van het te verbergen: de dienst behoudt zijn afspraak voor de persoon die door de andere beleidsregels wordt opgeroepen, met een notitie die het beleid noemt dat iemand anders oproept, en de invaller krijgt een extra afspraak met de titel `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Diensten in het verleden dragen in hun omschrijving de regel "Past shifts reflect the current rotation, not who was actually paged".
- Een rooster dat aan geen enkel escalatiebeleid is gekoppeld wordt toch getoond, met een notitie dat het niemand zal oproepen.

## Planning, geen audit

De feed toont de rotatie **zoals hij nu is geconfigureerd**, ook voor voorbije dagen: een achteraf ingevoerde override herschrijft de geschiedenis in de agenda. Voor werkelijk gemaakte piketuren, eerlijkheidscontroles en vergoeding gebruik je **Piket** > **Rapporten** > **Pikettijd per gebruiker**, dat wordt geschreven op basis van wat de pager daadwerkelijk heeft gedaan.

## Beveiliging

- Het token in de link is de enige inloggegevens. Iedereen die de link heeft ziet de diensten — namen, roosters, beleid — totdat hij opnieuw wordt gegenereerd. Plak links niet in chatkanalen of tickets; als een team een agenda nodig heeft, deel dan de rooster- of projectlink in plaats van je persoonlijke.
- Links zijn per project. Een gelekte persoonlijke link legt de diensten van één project bloot, niet van elk project waar je bij hoort.
- **Opnieuw genereren** zet het oude token in een respijtperiode van 30 dagen (lege agenda, daarna 404). **Uitschakelen** levert een lege agenda. Een onbekende of verlopen link geeft een kale 404 zonder aanwijzing. Lege agenda's laten geabonneerde apps hun kopie wissen; een 404 laat ze die houden, en daarom leveren uitschakelen en opnieuw genereren lege agenda's.
- Tokens worden gehasht opgeslagen; de kopie die op de instellingenpagina wordt getoond is versleuteld met `ENCRYPTION_SECRET`. Geef die variabele op een zelfgehoste installatie een echt geheim — de server waarschuwt bij het opstarten wanneer hij niet is ingesteld of nog letterlijk `secret` is. Wijzig je hem later, dan biedt de pagina **Link opnieuw genereren** omdat de opgeslagen kopie niet meer leesbaar is; de feed blijft werken totdat je dat doet.
- Feedantwoorden zijn gemarkeerd met `Cache-Control: private`, uitgesloten van zoekmachines (`X-Robots-Tag: noindex`) en per link en per clientadres in snelheid beperkt.
- De eigen Nginx van OneUptime schrijft feedverzoeken niet naar zijn toegangslog:

  ```
  location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
      access_log off;
      ...
  }
  ```

  zodat een token nooit naast een clientadres in een logbestand belandt; de applicatie logt het evenmin. **Elke proxy, WAF of CDN die je vóór OneUptime plaatst logt nog steeds de volledige URI** tenzij je hem anders configureert — controleer dat voordat je feeds uitrolt.

## Zelfgehoste configuratie

Er hoeft niets te worden ingeschakeld: feeds werken op elke installatie. Vier omgevingsvariabelen sturen ze aan, ingesteld in `config.env` voor Docker Compose of onder `onCallCalendarFeed` in de Helm-waarden (zie de [configuratiereferentie](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) van de chart):

| Variabele                                               | Helm-waarde                                      | Standaard | Effect                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISABLE_ON_CALL_CALENDAR_FEED`                         | `onCallCalendarFeed.disabled`                    | `false`   | Noodschakelaar. Elke feed-URL antwoordt `503` met `Retry-After: 3600`; geabonneerde apps houden hun kopie en proberen het later opnieuw. Er wordt niets verwijderd. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS`       | `onCallCalendarFeed.rateLimit.windowSeconds`     | `60`      | Lengte van het snelheidsbeperkingsvenster.                                                                                                                          |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60`      | Ophaalacties die één link vanaf één clientadres per venster mag doen.                                                                                               |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`    | `onCallCalendarFeed.rateLimit.perIpPerWindow`    | `3000`    | Ophaalacties die één clientadres over alle links per venster mag doen — het plafond voor een heel kantoor achter één adres.                                         |

Ook relevant:

- **`HOST` en `HTTP_PROTOCOL`** bouwen de links. Als `HOST` leeg of `localhost` is, of `HTTP_PROTOCOL` op `http` staat, toont de feedpagina een waarschuwing en werken de links van buitenaf niet.
- **`TRUSTED_PROXY_HOPS`** bepaalt welk adres de limiet per adres telt. De standaard `1` klopt voor de standaardopstellingen van Docker Compose en Helm; tel er één bij op voor elke eigen proxy — een CDN, WAF of loadbalancer — die aan `X-Forwarded-For` toevoegt, anders lijkt elke agendaclient hetzelfde adres en delen ze allemaal één budget. Zie [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) in de chartdocumentatie.
- **Redis** draagt de caches en de snelheidsbeperker. Beide degraderen netjes: zonder Redis worden feeds nog steeds gerenderd, alleen langzamer, en laat de beperker verzoeken door.
- In de gesplitste modus van de Helm-chart (`worker.enabled: true`) worden feeds op de API-laag gerenderd; dimensioneer die laag voor een piek van agendaclients die op het hele uur ophalen.
- De hierboven getoonde uitzondering op de Nginx-toegangslog maakt deel uit van het meegeleverde `Nginx/default.conf.template`; behoud hem als je de template aanpast.

## Problemen oplossen

**Niets heeft de link opgehaald, of "Kon de URL niet ophalen".** Google Agenda, Outlook op het web, Fastmail en Proton halen op **vanaf hun eigen servers**, dus de OneUptime-host moet vanaf het openbare internet bereikbaar zijn met een certificaat dat zij vertrouwen. Een installatie in een privénetwerk, achter een VPN of met een interne certificaatautoriteit is voor hen onbereikbaar, wat je ook plakt. Apple Agenda, Thunderbird en klassiek Outlook halen op vanaf het apparaat en werken dus overal waar het apparaat het dashboard kan openen — na het vertrouwen van het certificaat op dat apparaat als het zelfondertekend is. De statusregel van de feedpagina vertelt je of iets de link al heeft opgehaald; `curl -I` op de link van buiten je netwerk is de snelste controle. OneUptime privénetwerken laten _bereiken_ — [Toegang tot privénetwerken](/docs/self-hosted/private-network-access) — is een andere kwestie en helpt hier niet.

**De agenda is verouderd.** Lees eerst de vernieuwtabel: bij Google is de vertraging normaal. Om Google opnieuw te laten kijken, verwijder je de agenda en voeg je hem opnieuw toe, of voeg je `?nocache=1` aan de link toe (onbekende parameters worden genegeerd, de feed is hetzelfde maar Google behandelt hem als nieuw). Druk in klassiek Outlook op F9 en controleer de instelling **Bijwerklimiet**. Gebruik in Apple Agenda **Weergave** > **Vernieuw agenda's**. Als een wijziging van dezelfde dag belangrijk is, vertrouw dan op de herinneringen en hertoewijzingsberichten van OneUptime in plaats van op de agenda.

**De agenda is leeg.** Een lege agenda is opzettelijk. Het betekent dat de link is uitgeschakeld, een oude link is binnen zijn respijtperiode van 30 dagen na opnieuw genereren, het project onder het abonnement zit dat piketroosters bevat, of dat je op geen enkel rooster in dat project meer staat. Open de link in een browser: de agendabeschrijving (`X-WR-CALDESC`) noemt de reden.

**404.** De link is onbekend, verwijderd, of zijn respijtperiode is voorbij. Genereer een nieuwe en abonneer je opnieuw.

**503.** Ofwel `DISABLE_ON_CALL_CALENDAR_FEED` is ingesteld, ofwel de server is bezet: er worden hooguit enkele feeds tegelijk gerenderd, en een rooster dat zeer lang duurt om te berekenen wordt afgebroken. Wanneer een eerdere kopie van de feed bestaat, levert de server die in plaats daarvan met een `Warning: 110`-header; een 503 betekent dus dat er niets was om op terug te vallen. Clients houden hun laatste kopie en proberen het na het `Retry-After`-interval opnieuw. Fastmail schakelt een abonnement uit na vijf mislukkingen op rij; voeg het opnieuw toe zodra de server gezond is. De metriek `oncall_calendar_render_duration_ms` laat beheerders zien welke feeds traag zijn.

**429 of "te veel verzoeken".** Veel clients achter één adres — een kantoor-NAT, een VPN-gateway — delen het budget per adres. Verhoog `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` en controleer `TRUSTED_PROXY_HOPS`: staat die te laag, dan wordt elke client aan je eigen proxy toegeschreven en delen ze allemaal één budget.

**Certificaatfouten in Apple Agenda, Thunderbird of Outlook.** Deze apps controleren TLS op het apparaat. Importeer je interne CA in de vertrouwensopslag van het apparaat — de macOS-sleutelhanger, de Windows-certificaatopslag, het certificaatbeheer van Thunderbird — of gebruik een publiek vertrouwd certificaat. Serverside ophalers zoals Google en Microsoft kunnen niet worden aangezet een privé-CA te vertrouwen.

**De tijden kloppen niet.** Alle tijden in het bestand zijn UTC; de agenda-app rekent om naar zijn eigen tijdzone. Lijken diensten met een vast aantal uren verschoven, controleer dan de tijdzone van het rooster (tabblad **Instellingen**) en je eigen tijdzone (**Gebruikersinstellingen** > **Profiel**). Een rooster zonder tijdzone wordt in de tijdzone van de server berekend en de afspraak vermeldt dat.

**De feed zegt dat hij is ingekort.** Meer dan 5.000 afspraken vielen binnen het venster. Verlaag **Dagen vooruit**, of abonneer je op **Alleen mijn diensten op dit rooster** in plaats van op een heel project.

**Google toont een oude agendanaam.** Google leest de naam alleen bij het eerste abonneren; verwijder de agenda en voeg hem opnieuw toe.

**De instellingenpagina zegt dat de link opnieuw moet worden gegenereerd.** `ENCRYPTION_SECRET` is gewijzigd sinds de link is gemaakt, dus de server kan hem niet meer tonen. Het bestaande abonnement blijft werken; opnieuw genereren geeft je een link die je weer kunt kopiëren en trekt de oude na 30 dagen in.

**Er ontbreekt een dienst in mijn feed.** Alleen roosterdiensten verschijnen; directe gebruikers- of teamtoewijzingen in een beleidsregel zijn vast en hebben geen afspraken. Een dienst die iemand anders via een override heeft overgenomen verdwijnt uit je feed omdat hij nu in de zijne staat. Schakel **Diensten meenemen die ik voor anderen overneem** in om diensten te zien die je via overrides hebt gekregen op roosters waarvan je geen lid bent.
