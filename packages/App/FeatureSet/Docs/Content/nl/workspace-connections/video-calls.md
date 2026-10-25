# Videogesprekken

Geef elk incident en elke waarschuwing een eigen gesprek. Als een meldingsregel van Slack of Microsoft Teams afgaat voor een nieuw incident of een nieuwe waarschuwing, start OneUptime een speciale vergadering (een Zoom-vergadering, een Google Meet, een Microsoft Teams-vergadering of de huddle van het Slack-kanaal van het incident) en plaatst een knop **Join call** overal waar de updates van het incident naartoe gaan. Responders doen met één klik mee, en niemand hoeft om 3 uur 's nachts een vergadering aan te maken en de link rond te sturen.

:::cards
- [Hoe het werkt](#hoe-het-werkt): Een regel start het gesprek, en responders doen mee vanaf waar ze ook zijn.
- [Koppelen met één klik](#koppelen-met-één-klik): Zoom, Google Meet of Microsoft Teams, door je aan te melden.
- [Providers](#providers): De service-identiteit van je eigen app, een vaste vergaderlink of een Slack-huddle.
- [Een gesprek handmatig starten](#een-gesprek-handmatig-starten): Vanaf de pagina van een incident of een waarschuwing.
- [Transcripties van gesprekken](#transcripties-van-gesprekken): Wat er in het gesprek van een incident is gezegd, en de hoofdoorzaak die OneUptime AI erin leest.
:::

## Hoe het werkt

```mermaid title="Van een meldingsregel naar een knop Join call"
flowchart TB
    declared["Een incident of waarschuwing<br/>wordt gemeld"] --> rule{"Een Slack- of Teams-regel<br/>met een videogesprek klopt"}
    rule --> start["OneUptime start één gesprek<br/>met de koppeling van de regel"]
    start --> posted["Join call geplaatst in zijn kanalen,<br/>zijn feed en op zijn pagina"]
    start -.->|"de provider weigert"| failed["De feed zegt waarom,<br/>het incident gaat door"]
```

:::steps
### Een provider koppelen

Ga naar **Projectinstellingen** > **Werkruimte** > **Video Calls** en koppel Zoom, Google Meet of Microsoft Teams, of voeg een vaste vergaderlink toe. Op OneUptime Cloud is het koppelen van Zoom, Google Meet of Microsoft Teams één klik: meld je aan en sta OneUptime toe vergaderingen aan te maken (zie [Koppelen met één klik](#koppelen-met-één-klik)). Slack-huddles hebben niets meer nodig dan de Slack-koppeling van het project.

### Het aanzetten in een regel

Open een meldingsregel van Slack of Microsoft Teams voor incidenten of waarschuwingen (**Incidenten** > **Werkruimte** > **Slack**, bijvoorbeeld). Zet in de stap **Video Call** van de regel **Start a video call for the incident** aan en kies waar het gesprek plaatsvindt.

### Met één klik meedoen

Als de regel afgaat, start OneUptime één gesprek voor het incident en plaatst het met een knop **Join call** in de kanalen waar de updates van het incident naartoe gaan en in de feed van het incident. De pagina van het incident toont het gesprek in zijn kaart **Video Call** en een knop **Deelnemen aan gesprek** in zijn kop.
:::

De voorwaarden van de regel bepalen welke incidenten een gesprek krijgen. Geef de regel voor een bridge bij alleen Sev1-incidenten een voorwaarde op **Ernst**. Gesprekken starten voor incidenten en waarschuwingen die als lopend worden gemeld. Een incident dat al opgelost werd aangemaakt, krijgt geen gesprek.

### Eén gesprek per incident

Een gesprek wordt één keer per incident gestart voor elke plek waar een gesprek plaatsvindt. Regels die dezelfde koppeling kiezen, delen één gesprek, en een regel start nooit een tweede gesprek voor een incident dat er al een heeft van die koppeling. Regels die verschillende plekken kiezen, starten elk hun eigen gesprek, bijvoorbeeld een Zoom-vergadering voor de responders en de huddle van het Slack-kanaal van het incident.

### Als een gesprek niet kan starten

Een incident melden wacht nooit op een provider van videogesprekken. Het gesprek wordt gestart nadat het incident is aangemaakt, dus een trage of falende provider vertraagt nooit het incident of de oproepen van de bereikbaarheidsdienst.

Als de provider weigert (een verlopen geheim, een ontbrekend recht, een verwijderde host), zegt de feed van het incident dat het gesprek van de regel niet kon worden gestart, met de reden van de provider, zodat responders weten dat ze er een vanaf de pagina van het incident moeten starten. De uitvoering van de regel staat in de meldingslogboeken van de workspace als **Videogesprek starten**, en de rij van de koppeling in **Projectinstellingen** > **Werkruimte** > **Video Calls** toont de fout tot er weer een gesprek start.

### Privé-incidenten

Een vergadering krijgt de naam van het incident waarvoor ze is, met het nummer en de titel, en haar beschrijving linkt terug naar het incident. Bij een privé-incident blijft de titel weg, omdat iedereen die voor de vergadering is uitgenodigd haar naam kan lezen.

## Koppelen met één klik

Op OneUptime Cloud kost het koppelen van Zoom, Google Meet of Microsoft Teams één klik en hoeft er bij de provider niets te worden ingesteld:

:::steps
1. Ga naar **Projectinstellingen** > **Werkruimte** > **Video Calls** en klik op **Koppelen** bij Zoom, Google Meet of Microsoft Teams.
2. Klik op **Continue to Zoom** (of Google, of Microsoft), meld je aan en sta OneUptime toe vergaderingen aan te maken.
3. Je komt terug op de pagina met videogesprekken, met de koppeling gemaakt. **Start a test meeting** controleert haar van begin tot eind; kies de koppeling daarna in een meldingsregel van Slack of Microsoft Teams.
:::

Elke vergadering wordt aangemaakt als het account waarmee je je aanmeldt, dat de host ervan is. Meld je aan met een gedeeld account, zoals incidents@example.com, in plaats van je eigen account, zodat gesprekken blijven starten als mensen vertrekken. De rij van de koppeling toont met welk account ze is aangemeld.

| Provider | Aanmelden met | Wat OneUptime mag doen |
| --- | --- | --- |
| Zoom | Een Zoom-gebruiker. Vergaderingen met een Basic-gebruiker (gratis) als host eindigen na 40 minuten. | Vergaderingen aanmaken voor die gebruiker (`meeting:write:meeting`) en lezen wie het is (`user:read:user`). Voor [transcripties van gesprekken](#transcripties-van-gesprekken) de transcripties van de cloudopnamen van zijn vergaderingen lezen (`cloud_recording:read:list_recording_files`, `cloud_recording:read:meeting_transcript`). |
| Google Meet | Een Google-account dat Google Meet mag gebruiken. | Meet-ruimtes aanmaken als dat account (`meetings.space.created`) en het e-mailadres ervan lezen. |
| Microsoft Teams | Een werk- of schoolaccount met Microsoft Teams. Persoonlijke Microsoft-accounts kunnen geen Teams-vergaderingen aanmaken. | Onlinevergaderingen aanmaken als dat account (het gedelegeerde recht `OnlineMeetings.ReadWrite`) en aangemeld blijven (`offline_access`). Voor het [opnemen en transcriberen van incidentgesprekken](#elk-gesprek-opnemen-en-transcriberen) de vergaderingen in zijn agenda zetten (`Calendars.ReadWrite`) en hun transcripties lezen (`OnlineMeetingTranscript.Read.All`, dat een beheerder goedkeurt). |

Een koppeling die door aanmelden is gemaakt, heeft nog steeds de instellingen die bepalen wie wacht: **Who can join** voor Google Meet en **Who skips the lobby** voor Microsoft Teams. Wijzig ze met **Bewerken** in de rij van de koppeling.

Een Zoom-verbinding die is aangemeld voordat OneUptime transcripties van gesprekken las, start gesprekken zoals voorheen, maar kan hun transcripties pas lezen als ze opnieuw is aangemeld: **Reconnect** op haar rij vraagt Zoom om de rechten voor transcripties.

Een Microsoft Teams-verbinding die is aangemeld terwijl **Incidentgesprekken opnemen en transcriberen** uit stond, start gesprekken zoals voorheen, zonder opname. Zodra die instelling aan staat, vraagt **Reconnect** op haar rij Microsoft ook om de rechten voor de agenda en voor transcripties.

### Aangemeld blijven

OneUptime bewaart het vernieuwingstoken van de aanmelding, versleuteld, en vernieuwt het minstens één keer per week, zodat het nooit verloopt door ongebruik, hoe lang het project ook zonder incident blijft. Als de aanmelding niet meer werkt (het account heeft OneUptime verwijderd, is verwijderd of geschorst, of het beleid van je organisatie vraagt om opnieuw aan te melden), toont de rij van de koppeling **Werkt niet** met de reden op de dag dat OneUptime het merkt, niet bij het volgende incident. **Reconnect** in de rij meldt opnieuw aan.

Koppelingen die met hetzelfde account zijn aangemeld, delen één aanmelding, in elk project: Zoom bewaart maar één aanmelding per account, dus dezelfde Zoom-gebruiker opnieuw koppelen vervangt die voor allemaal.

### Opnieuw koppelen en verwijderen

**Reconnect** in de rij van een koppeling meldt opnieuw aan, als hetzelfde account of een ander. Gebruik het nadat het account OneUptime heeft verwijderd, of om incidentvergaderingen naar een ander account te verplaatsen.

Een koppeling verwijderen trekt de toegang van OneUptime bij Zoom en Google in zodra geen andere koppeling de aanmelding gebruikt. Verwijder OneUptime bij Microsoft onder **My Apps** (myapps.microsoft.com) van het account. OneUptime uit je Zoom-account verwijderen in de Zoom App Marketplace verwijdert de aanmelding uit elke koppeling die met dat account is aangemeld, en die tonen **Werkt niet** tot ze opnieuw zijn gekoppeld.

### Als Microsoft om een beheerder vraagt

Sommige Microsoft 365-organisaties laten alleen beheerders apps goedkeuren. Als Microsoft zegt dat je goedkeuring van een beheerder nodig hebt, vraag dan een Microsoft 365-beheerder om Microsoft Teams te koppelen, of om OneUptime goed te keuren in het [Microsoft Entra-beheercentrum](https://entra.microsoft.com/) onder **Enterprise applications** > **Admin consent requests**. Een project dat zijn Teams-gesprekken opneemt, heeft deze goedkeuring in elke organisatie één keer nodig: alleen een beheerder kan een app transcripties van vergaderingen laten lezen.

### In plaats daarvan je eigen app gebruiken

Om te koppelen met een service-identiteit in plaats van de aanmelding van een persoon — een Zoom-app van het type Server-to-Server OAuth, een Google-serviceaccount met domeinbrede delegatie of een Microsoft Entra-appregistratie — klik je op **Use your own Zoom app** (of Google, of Microsoft) in het dialoogvenster Koppelen. [Providers](#providers) legt ze elk uit. Op een zelf gehoste server zonder ingestelde apps voor koppelen met één klik opent **Koppelen** dit formulier direct; zie [Koppelen met één klik op een zelf gehoste server](#koppelen-met-één-klik-op-een-zelf-gehoste-server) om ze in te stellen.

## Een gesprek handmatig starten

De kaart **Video Call** op de pagina van een incident of waarschuwing heeft **Start call** (of **Start another** zodra er een is). Kies een van de koppelingen van het project, de huddle van het Slack-kanaal van het incident, of plak een eigen vergaderlink. Het gesprek wordt in de kanalen en de feed van het incident geplaatst, net als een gesprek dat een regel start.

**Verwijderen** op de kaart haalt een gesprek van de pagina van het incident. De vergadering zelf wordt niet verwijderd, en iedereen met de link kan er nog steeds aan meedoen.

Gesprekken starten en verwijderen vereist rechten om aan incidenten (of waarschuwingen) te werken: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** of **Incident Member**, of **Create Incident Video Call** en **Delete Incident Video Call** in een aangepaste rol. Iedereen die het incident mag lezen, ziet de gesprekken ervan.

## Transcripties van gesprekken

Wat responders in een gesprek zeggen, wat ze hebben gecontroleerd, wat ze vermoeden en wat ze hebben besloten, is het beste verslag van hoe een incident is aangepakt, en het is weg als het gesprek eindigt. Het gesprek van een incident houdt zijn transcriptie bij, en OneUptime AI leest die op de hoofdoorzaak waar het gesprek naar wijst. Niets wat het leest bereikt het incident voordat een responder het gebruikt.

:::steps
### Haal de transcriptie op na het gesprek

Op de kaart **Video Call** van het incident leest **Ophalen uit Zoom**, **Ophalen uit Google Meet** of **Ophalen uit Microsoft Teams** de transcriptie van een vergadering die OneUptime daar heeft gestart (bij Microsoft Teams een die het heeft gestart terwijl elk gesprek wordt opgenomen en getranscribeerd). Voor elk ander gesprek neemt **Transcriptie toevoegen** het bestand dat de vergadertool heeft opgeslagen (`.vtt`, `.srt` of `.txt`, tot 5 MB) of de geplakte transcriptie. Wordt [elk gesprek opgenomen en getranscribeerd](#elk-gesprek-opnemen-en-transcriberen), dan haalt OneUptime de transcriptie zelf op zodra het gesprek voorbij is.

### OneUptime AI leest het

Binnen een à twee minuten toont de kaart **AI Investigation** van het incident de **Voorgestelde hoofdoorzaak**, gemarkeerd als **Niet bevestigd**, met de regels uit de transcriptie waarop die berust, geciteerd met tijd en spreker. Daaronder, ingeklapt, staat de rest van wat het gesprek zei: bevindingen, verdeeld over **Bevestigd in het gesprek** en **Hypothesen**, dan wat er is geprobeerd, besluiten, vervolgacties en open vragen. Wat OneUptime AI erin heeft gelezen, wordt ook in de feed van het incident geplaatst, en van daaruit in de Slack- en Microsoft Teams-kanalen van het incident.

### Gebruik het, of wijs het af

**Gebruiken als hoofdoorzaak** opent het voorstel, met citaten en al, in de editor van de hoofdoorzaak. Pas aan wat nodig is en sla op: het wordt de hoofdoorzaak van het incident als uw eigen wijziging, vastgelegd in de feed. **Sluiten** legt het voorstel opzij, en **Ongedaan maken** haalt het terug.
:::

OneUptime AI stelt alleen een oorzaak voor als het gesprek er een noemt, met de regels die dat zeggen, en citeert die regels zoals de transcriptie ze bevat. Heeft het gesprek de oorzaak niet vastgesteld, dan zegt de kaart **Er is in het gesprek niet genoeg gezegd om een hoofdoorzaak voor te stellen** in plaats van te gokken.

### Elk gesprek opnemen en transcriberen

Om te zorgen dat niemand eraan hoeft te denken een gesprek op te nemen of de transcriptie ervan op te halen, zet u **Incidentgesprekken opnemen en transcriberen** aan in **Projectinstellingen** > **Werkruimte** > **Video Calls**. Zolang dat aan staat:

- OneUptime vraagt Zoom om elke incidentvergadering die het start, in de cloud op te nemen, Google Meet om die te transcriberen, en Microsoft Teams om die automatisch op te nemen en te transcriberen. Het bericht waarmee het gesprek wordt geplaatst, meldt dat voordat iemand deelneemt.
- Zodra het gesprek voorbij is, haalt OneUptime de transcriptie zelf op, zoals **Ophalen uit Zoom** zou doen, waarna OneUptime AI die leest. Tot dan zegt de kaart **Video Call** dat ze erop wacht.
- Wat OneUptime AI heeft gelezen, gaat naar de feed van het incident en naar de Slack- en Microsoft Teams-kanalen ervan: de voorgestelde hoofdoorzaak, gemarkeerd als niet bevestigd, dan wat er is bevestigd, geprobeerd en besloten, de vervolgacties en de open vragen.
- Wordt het incident opgelost voordat de transcriptie binnen is, dan wacht het automatische postmortem-concept erop, zodat het leest wat er in het gesprek is gezegd: tot zes uur terwijl de aanbieder de transcriptie maakt, en één uur als er nog geen teken van een transcriptie is.

De instelling staat standaard uit, omdat ze mensen opneemt: iedereen in die gesprekken ziet dat ze worden opgenomen of getranscribeerd, dus controleer of uw organisatie dat toestaat. Zoom bewaart alleen een transcriptie als het account in de cloud opneemt met de audiotranscriptie aan, en Google Meet alleen in een Google Workspace-editie die transcripties heeft. Slack-huddles en vergaderlinks worden niet opgenomen, en gesprekken van waarschuwingen evenmin: voeg hun transcripties handmatig toe.

Microsoft laat apps alleen de transcripties lezen van Teams-vergaderingen die in een agenda staan, dus plaatst OneUptime elke incidentvergadering in de agenda van de organisator ervan en zet het automatisch opnemen en transcriberen aan in de opties van de vergadering. Daarvoor heeft de verbinding twee extra Microsoft Graph-rechten nodig, `Calendars.ReadWrite` en `OnlineMeetingTranscript.Read.All`: voeg ze toe aan uw appregistratie (zie [Microsoft Teams](#microsoft-teams)), of gebruik **Reconnect** bij een verbinding die door aanmelden is gemaakt. Het Teams-vergaderbeleid van de organisator moet cloudopnamen, transcriptie en automatisch opnemen toestaan, en uw organisatie mag de toegang van apps tot transcripties niet hebben uitgezet. Een gesprek dat OneUptime niet in de agenda kan plaatsen, start toch, zonder opname, en de kaart **Video Call** ervan zegt waarom.

### Wat elke aanbieder bewaart

| Gesprek | Hoe het zijn transcriptie krijgt | Wat het nodig heeft |
| --- | --- | --- |
| Zoom | **Ophalen uit Zoom** | Een vergadering die in de cloud is opgenomen met de audiotranscriptie aan, of met de vergadersamenvatting van AI Companion aan. De verbinding heeft de scopes voor transcripties nodig (zie [Zoom](#zoom)), en een die daarvoor is aangemeld heeft **Reconnect** nodig. Zoom maakt een transcriptie na de vergadering, meestal binnen twee keer de duur ervan. |
| Google Meet | **Ophalen uit Google Meet** | Transcripties die in het gesprek zijn aangezet, in een Google Workspace-editie die ze heeft. Verder niets in te stellen: OneUptime leest de transcripties van de vergaderingen die het heeft gemaakt. Google houdt een transcriptie 30 dagen leesbaar voor apps. |
| Microsoft Teams | **Ophalen uit Microsoft Teams** | Een vergadering die OneUptime heeft gestart terwijl [elk gesprek wordt opgenomen en getranscribeerd](#elk-gesprek-opnemen-en-transcriberen): Microsoft laat apps alleen de transcripties lezen van vergaderingen die in een agenda staan, en bewaart een vergadering 60 dagen. Voor elke andere Teams-vergadering **Transcriptie toevoegen**: open in Teams de samenvatting van de vergadering, dan de transcriptie, en download die als `.vtt`-bestand. |
| Vergaderlink of Slack-huddle | **Transcriptie toevoegen** | De transcriptie die de vergadertool, of de notities van de huddle, bewaren. |

### Wie wat mag

Een transcriptie ophalen, toevoegen, vervangen en verwijderen, haar opnieuw laten lezen en een voorstel afwijzen vereisen het recht om de gesprekken van het incident te starten: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** of **Incident Member**, of **Create Incident Video Call** in een aangepaste rol. **Gebruiken als hoofdoorzaak** vereist het recht om de hoofdoorzaak van het incident te bewerken. Iedereen die het incident kan lezen, ziet de transcripties van de gesprekken en wat OneUptime AI erin heeft gelezen.

### Wat OneUptime AI leest

Een transcriptie lezen is AI-werk zoals een onderzoek: het draait alleen zolang AI aan staat voor het project, en telt mee voor het AI-gebruik en de daglimieten van het project (zie [Kostenbeheersing](/docs/ai/ai-sre#kostenbeheersing)). Een lange transcriptie wordt in delen gelezen. Staat AI uit, dan blijft de transcriptie bewaard en zegt de kaart dat ze niet is gelezen. Een transcriptie verwijderen verwijdert wat OneUptime AI erin heeft gelezen, en behoudt de hoofdoorzaak van het incident. Een AI-concept van het postmortem leest ook wat er in de gesprekken van het incident is gezegd (zie [Postmortems](/docs/incidents/postmortems)).

## Providers

Deze sectie gaat over het koppelen van een provider met de service-identiteit van je eigen app: een Zoom-app van het type Server-to-Server OAuth, een Google-serviceaccount, een Microsoft Entra-appregistratie. Een service-identiteit hangt nooit af van een persoon, dus ze blijft werken wie er ook vertrekt. Zie [Koppelen met één klik](#koppelen-met-één-klik) om in plaats daarvan door aanmelden te koppelen.

Inloggegevens worden versleuteld opgeslagen en worden nooit door de API teruggegeven. Als je een koppeling bewerkt, behoudt een leeg gelaten inloggegeven het opgeslagen gegeven.

**Start test meeting** in het koppelingsformulier, en **Testen** in de rij van een koppeling, maken een echte vergadering aan met de instellingen van de koppeling en tonen de link ervan. Het is de enige controle die bewijst dat de inloggegevens, het recht aan de kant van de provider en de host samen werken. Er wordt nergens iets geplaatst.

Een provider koppelen vereist **Project Owner**, **Project Admin** of **Settings Admin**, of **Create Video Call Connection** en **Edit Video Call Connection** in een aangepaste rol.

### Zoom

OneUptime maakt voor elk incident een Zoom-vergadering aan via een Zoom-app van het type **Server-to-Server OAuth**, met als host een Zoom-gebruiker met licentie naar keuze.

:::steps
1. Kies in de [Zoom App Marketplace](https://marketplace.zoom.us/) **Develop** > **Build App** en maak een app van het type **Server-to-Server OAuth** aan. Daarvoor is een beheerder van het Zoom-account nodig, of een rol die Server-to-Server OAuth-apps toestaat.
2. Voeg op de pagina **Scopes** van de app **meeting:write:meeting:admin** toe (een vergadering aanmaken voor een gebruiker). Een app die vóór de gedetailleerde scopes is gemaakt, kan in plaats daarvan **meeting:write:admin** gebruiken. Om OneUptime ook [transcripties van gesprekken](#transcripties-van-gesprekken) te laten lezen, voegt u **cloud_recording:read:list_recording_files:admin** en **cloud_recording:read:meeting_transcript:admin** toe (of **recording:read:admin** bij een app die vóór de gedetailleerde scopes is gemaakt).
3. Klik op **Activate** om de app te activeren en kopieer daarna de **Account ID**, de **Client ID** en het **Client secret** van de pagina **App Credentials** naar het koppelingsformulier.
4. Vul de **Meeting host** in: het e-mailadres van een Zoom-gebruiker met licentie, bij voorkeur een serviceaccount zoals incidents@example.com, zodat vergaderingen blijven werken als mensen vertrekken. Vergaderingen met een Basic-gebruiker (gratis) als host eindigen na 40 minuten.
5. Responders doen mee zonder op de host te wachten, omdat de host een serviceaccount is dat nooit meedoet. Zorg dat de instelling **Waiting room** van je Zoom-account niet vergrendeld aan staat, anders komt niemand binnen.
:::

| Veld | Waar je het vindt |
| --- | --- |
| Account ID | De pagina **App Credentials** van de app |
| Client ID | De pagina **App Credentials** van de app |
| Client secret | De pagina **App Credentials** van de app |
| Meeting host | Het e-mailadres van de Zoom-gebruiker met licentie die elke vergadering host |

### Google Meet

OneUptime maakt voor elk incident een Google Meet aan met de Google Meet REST API, via een Google Cloud-serviceaccount dat met domeinbrede delegatie optreedt als een Google Workspace-gebruiker.

:::steps
1. Kies of maak in de [Google Cloud-console](https://console.cloud.google.com/) een project en schakel er de **Google Meet REST API** voor in.
2. Maak onder **IAM & Admin** > **Service accounts** een serviceaccount aan. Open het, ga naar **Keys** > **Add key** > **Create new key**, kies **JSON**, en plak het gedownloade bestand in het koppelingsformulier als de **Service account JSON key**.
3. Open in de [Google Beheerdersconsole](https://admin.google.com/) **Security** > **Access and data control** > **API controls** > **Manage Domain Wide Delegation** en klik op **Add new**. Vul de numerieke **Client ID** van het serviceaccount in en de scope `https://www.googleapis.com/auth/meetings.space.created`.
4. Vul in **Create meetings as** de Google Workspace-gebruiker in als wie het serviceaccount optreedt: een speciaal account zoals incidents@example.com. Elke vergadering is van deze gebruiker.
:::

**Who can join** bepaalt wie meedoet zonder te vragen: met **People in your organization join directly, others ask to join** (de standaard) vragen mensen van buiten je Google Workspace om mee te doen en laat iemand in het gesprek ze toe. Met **Anyone with the link joins directly** wacht niemand.

Domeinbrede delegatie kan een paar minuten nodig hebben om te gaan werken. Als de test vlak na het toevoegen van de delegatie meldt dat Google het serviceaccount niet als de gebruiker liet optreden, wacht dan een paar minuten en test opnieuw.

### Microsoft Teams

OneUptime maakt voor elk incident een Microsoft Teams-vergadering aan met Microsoft Graph, via een Microsoft Entra-appregistratie die vergaderingen organiseert namens een Teams-gebruiker met licentie.

:::steps
1. Open in het [Microsoft Entra-beheercentrum](https://entra.microsoft.com/) **App registrations** > **New registration** en registreer een app voor één tenant. Kopieer de **Directory (tenant) ID** en de **Application (client) ID**.
2. Voeg onder **API permissions** het Microsoft Graph-recht van het type **application** **OnlineMeetings.ReadWrite.All** toe (en, om ook [incidentgesprekken op te nemen en te transcriberen](#elk-gesprek-opnemen-en-transcriberen), **Calendars.ReadWrite** en **OnlineMeetingTranscript.Read.All**) en klik daarna op **Grant admin consent**.
3. Maak onder **Certificates & secrets** een clientgeheim aan en plak de **Value** ervan, niet de Secret ID, in het koppelingsformulier als het **Client secret**.
4. Kies de organisator: een Teams-gebruiker met licentie, bij voorkeur een serviceaccount. Kopieer de **Object ID** ervan uit **Users** in het Entra-beheercentrum naar **Organizer object ID**.
5. Sta de app toe vergaderingen aan te maken voor de organisator met een toegangsbeleid voor toepassingen. Voer in Teams PowerShell, na `Connect-MicrosoftTeams`, de twee onderstaande commando's uit.
:::

```powershell
New-CsApplicationAccessPolicy -Identity OneUptime-Meetings -AppIds "<application-client-id>"
Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "<organizer-object-id>"
```

Het beleid kan tot 30 minuten nodig hebben om van kracht te worden. Tot dan meldt de test dat de app geen vergaderingen mag aanmaken voor de organisator.

Hetzelfde beleid laat de app de transcripties van de vergaderingen van de organisator lezen. Met `Calendars.ReadWrite` kan een app elke agenda in uw organisatie wijzigen: om dat te beperken tot de agenda van de organisator, verleent u het recht met [RBAC voor toepassingen in Exchange Online](https://learn.microsoft.com/exchange/permissions-exo/application-rbac), met de organisator als bereik, in plaats van onder **API permissions**.

**Who skips the lobby** bepaalt wie meedoet zonder te wachten: met **People in your organization skip the lobby** (de standaard) wacht ieder ander in de lobby tot iemand in de vergadering hem toelaat. Met **Everyone skips the lobby** wacht niemand.

### Vergaderlink

Een vaste vergaderlink is dezelfde ruimte voor elk incident: een persoonlijke Zoom-vergaderruimte, een terugkerende Microsoft Teams- of Google Meet-vergadering, een persoonlijke Webex-ruimte of een Jitsi-ruimte. Er wordt per incident niets aangemaakt, dus er valt niets te autoriseren.

:::steps
1. Maak in het hulpmiddel dat je team al gebruikt een vergadering aan die nooit verloopt.
2. Plak de https-deelnamelink ervan in het koppelingsformulier als de **Meeting link**.
:::

Elk incident en elke waarschuwing die met deze koppeling wordt gestart, deelt de ruimte, dus twee gelijktijdige incidenten delen haar ook. Zorg dat de vergadering mensen laat meedoen zonder de host.

### Slack-huddles

Een Slack-regel kan in plaats daarvan de huddle van het Slack-kanaal van het incident starten. Er valt niets te koppelen: kies **Slack huddle** in de stap **Video Call** van de regel.

De huddle vindt plaats in het kanaal dat de regel voor het incident aanmaakt of, als de regel in bestaande kanalen plaatst, in het eerste daarvan. De regel moet dus een kanaal aanmaken of in een bestaand kanaal plaatsen. De knop **Deelnemen aan huddle** opent de huddle van het kanaal in Slack. De eerste responder die hem opent, start de huddle, en iedereen daarna doet mee. Slack biedt een app geen manier om een huddle te starten, dus er zit niemand in de huddle tot iemand hem opent.

Een Slack-huddle is alleen voor Slack-regels. Een Microsoft Teams-regel start zijn gesprekken met een van de koppelingen voor videogesprekken van het project.

## De API gebruiken

Een gesprek is een record bij het incident (`IncidentVideoCall`) of de waarschuwing (`AlertVideoCall`). Maak er een aan met de `_id` van het incident en een van deze:

- `videoCallConnectionId`: start een nieuwe vergadering met die koppeling.
- `provider` ingesteld op `SlackHuddle`: de huddle van het Slack-kanaal van het incident.
- `joinUrl` (en optioneel `title`): een eigen vergaderlink.

```json
{
  "data": {
    "projectId": "<project-id>",
    "incidentId": "<incident-id>",
    "videoCallConnectionId": "<connection-id>"
  }
}
```

`POST /api/video-call-connection/test` start een testvergadering met een opgeslagen koppeling (`{ "connectionId": "..." }`) of met instellingen die nog niet zijn opgeslagen (`{ "provider": "Zoom", "config": { ... }, "secrets": { ... } }`), en geeft de `joinUrl` ervan terug.

De `authMethod` van een koppeling zegt hoe ze zich aanmeldt: `OAuth` voor een koppeling die door aanmelden is gemaakt, `AppCredentials` voor een met de inloggegevens van je eigen app, en niets voor een vergaderlink. Een koppeling die door aanmelden is gemaakt, wordt alleen door aanmelden aangemaakt, in het dashboard. Via de API kun je haar hernoemen en haar `config` wijzigen, en haar `connectedAccount` zegt met welk account ze is aangemeld.

## Koppelen met één klik op een zelf gehoste server

OneUptime Cloud heeft eigen Zoom-, Google- en Microsoft-apps voor koppelen met één klik. Een zelf gehoste server biedt het aan voor elke provider waarvan je de app instelt. Zonder die app opent **Koppelen** het formulier voor je eigen app.

Maak per provider één OAuth-app aan en registreer er deze omleidings-URI in, met de host van je server:

| Provider | Omleidings-URI | Omgevingsvariabelen | Helm-waarden |
| --- | --- | --- | --- |
| Zoom | `https://<host>/api/video-call-oauth/zoom/callback` | `ZOOM_APP_CLIENT_ID`, `ZOOM_APP_CLIENT_SECRET`, `ZOOM_APP_WEBHOOK_SECRET_TOKEN` | `zoomApp.clientId`, `zoomApp.clientSecret`, `zoomApp.webhookSecretToken` |
| Google Meet | `https://<host>/api/video-call-oauth/google-meet/callback` | `GOOGLE_MEET_APP_CLIENT_ID`, `GOOGLE_MEET_APP_CLIENT_SECRET` | `googleMeetApp.clientId`, `googleMeetApp.clientSecret` |
| Microsoft Teams | `https://<host>/api/video-call-oauth/microsoft-teams/callback` | `MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID`, `MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_SECRET` | `microsoftTeamsMeetingsApp.clientId`, `microsoftTeamsMeetingsApp.clientSecret` |

- **Zoom**: kies in de [Zoom App Marketplace](https://marketplace.zoom.us/) **Develop** > **Build App** en maak een **General App** aan, beheerd door gebruikers. Voeg onder **Basic Information** de omleidings-URI toe als OAuth Redirect URL op zowel het tabblad **Development** als **Production** en aan de OAuth-toelatingslijst, en stel op het tabblad **Production** de eindpunt-URL van **Deauthorization Notification** in op `https://<host>/api/video-call-oauth/zoom/events`. Voeg onder **Scopes** `meeting:write:meeting` en `user:read:user` toe. Om het [transcripties van gesprekken](#transcripties-van-gesprekken) te laten lezen, voegt u ook `cloud_recording:read:list_recording_files` en `cloud_recording:read:meeting_transcript` toe. Het **Secret Token** onder **Features** > **Access** is `ZOOM_APP_WEBHOOK_SECRET_TOKEN`. De **Development**-inloggegevens werken alleen voor gebruikers van je eigen Zoom-account; de **Production**-inloggegevens werken voor iedereen zodra Zoom de app heeft beoordeeld en gepubliceerd.
- **Google Meet**: schakel in de [Google Cloud-console](https://console.cloud.google.com/) de **Google Meet REST API** in, stel het OAuth-toestemmingsscherm in (**Google Auth Platform**) met de scopes `openid`, `email` en `https://www.googleapis.com/auth/meetings.space.created`, en maak een OAuth-client van het type **Web application** aan met de omleidings-URI. Publiceer de app naar productie: een app die in de testfase blijft, verliest zijn aanmeldingen na zeven dagen. Google beoordeelt apps die om de Meet-scope vragen; tot dat is gebeurd, zien mensen een waarschuwing voordat ze zich aanmelden.
- **Microsoft Teams**: registreer in het [Microsoft Entra-beheercentrum](https://entra.microsoft.com/) een app voor **Accounts in any organizational directory**, voeg de omleidings-URI toe als **Web**-omleidings-URI, voeg de gedelegeerde Microsoft Graph-rechten `openid`, `profile`, `email`, `offline_access` en `OnlineMeetings.ReadWrite` toe (en daarnaast `Calendars.ReadWrite` en `OnlineMeetingTranscript.Read.All`, waar een project dat [zijn gesprekken opneemt en transcribeert](#elk-gesprek-opnemen-en-transcriberen) om vraagt), en maak een clientgeheim aan. Gebruik een eigen registratie, niet die van de Microsoft Teams-bot (`MICROSOFT_TEAMS_APP_CLIENT_ID`). Zolang de app geen geverifieerde uitgever heeft, hebben de meeste organisaties een beheerder nodig die er toestemming voor geeft.

De client-ID's zijn openbaar: ze worden naar het dashboard gestuurd zodat het weet welke providers met één klik koppelen. Houd de geheimen en het geheime webhooktoken geheim. De worker vernieuwt dagelijks de aanmeldingen die aan de beurt zijn, dus hij heeft dezelfde waarden nodig als de app.

## Problemen oplossen

:::details Er is geen gesprek gestart voor een incident
Controleer of de regel bij het incident paste (**Testregel**), of de stap **Video Call** ervan aanstaat, en of het incident als lopend werd gemeld: een incident dat al opgelost werd aangemaakt, krijgt geen gesprek. Een regel die al een gesprek voor het incident startte met die koppeling, start er geen tweede.
:::

:::details De feed zegt dat het gesprek niet kon worden gestart
De provider weigerde, en de feed geeft de reden. Start intussen een gesprek vanaf de pagina van het incident. Voer daarna **Testen** uit in de rij van de koppeling: dat toont dezelfde reden terwijl je de instelling bij de provider herstelt, zoals een verlopen clientgeheim of een ontbrekend recht.
:::

:::details Een koppeling toont Werkt niet
De aanmelding ervan werkt niet meer: het account heeft OneUptime verwijderd, is verwijderd of geschorst, of moet zich opnieuw aanmelden. Klik op **Reconnect** in de rij. Tot dan kunnen de gesprekken die ze zou moeten starten, niet starten.
:::

:::details Mensen wachten in een lobby of wachtkamer
Wijzig **Who can join** (Google Meet) of **Who skips the lobby** (Microsoft Teams) met **Bewerken** in de rij van de koppeling. Zorg bij Zoom dat de instelling **Waiting room** van het account niet vergrendeld aan staat.
:::

:::details Ophalen uit Zoom vindt geen transcriptie
Zoom bewaart alleen een transcriptie van een vergadering die in de cloud is opgenomen met de audiotranscriptie aan, of met de vergadersamenvatting van AI Companion aan, en maakt die na afloop van de vergadering. De kaart zegt welk geval het is: probeer het later opnieuw, of zet een van beide aan voor uw incidentvergaderingen. Intussen neemt **Transcriptie toevoegen** een transcriptie die u hebt opgeslagen.
:::

:::details De kaart Video Call wacht nog op een transcriptie
Zodra het gesprek voorbij is, vraagt OneUptime Zoom, Google Meet of Microsoft Teams er om de paar minuten om, minder vaak naarmate het gesprek ouder wordt, tot drie dagen na het begin van het gesprek. De transcriptie komt binnen enkele minuten nadat de aanbieder die heeft gemaakt, en Zoom doet er tot ongeveer twee keer de duur van het gesprek over. **Ophalen uit Zoom** vraagt er meteen om. Bewaart de aanbieder geen transcriptie, dan zegt de kaart dat: controleer of het Zoom-account in de cloud opneemt met de audiotranscriptie aan, of uw Google Workspace-editie transcripties heeft, of dat het Teams-vergaderbeleid van de organisator automatisch opnemen toestaat.
:::

:::details Een Microsoft Teams-gesprek is niet opgenomen
OneUptime kon de vergadering niet in de agenda van de organisator ervan plaatsen, dus is het gesprek op de gewone manier gestart, zonder opname, en de kaart **Video Call** zegt waarom. Meestal mist de verbinding `Calendars.ReadWrite` of `OnlineMeetingTranscript.Read.All`: voeg ze toe aan de appregistratie en verleen beheerderstoestemming, of gebruik **Reconnect** bij een verbinding die door aanmelden is gemaakt. Gesprekken die daarna starten, worden opgenomen.
:::

:::details OneUptime AI kon een transcriptie niet lezen
De kaart zegt waarom: AI staat uit voor het project, het project heeft een daglimiet voor AI bereikt, of de AI-aanbieder weigerde. Zodra dat is opgelost, leest **Opnieuw proberen** op de kaart haar opnieuw.
:::

## Volgende stappen

:::cards
- [Slack](/docs/workspace-connections/slack): De regels die gesprekken starten, en de kanalen waarin ze plaatsen.
- [Microsoft Teams](/docs/workspace-connections/microsoft-teams): Dezelfde regels en gesprekken in Microsoft Teams.
- [Microsoft Teams-integratie](/docs/self-hosted/microsoft-teams-integration): De Teams-bot instellen op een zelf gehoste server.
- [Een incident melden](/docs/incidents/declaring-incidents): Wat er gebeurt als een incident begint.
:::
