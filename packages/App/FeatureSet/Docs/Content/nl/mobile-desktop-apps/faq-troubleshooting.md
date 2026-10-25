# Veelgestelde vragen en probleemoplossing

Antwoorden op veelgestelde vragen over de mobiele en desktop-apps van OneUptime, en oplossingen voor wat het vaakst misgaat: het aanmelden, meldingen die niet aankomen en een telefoon die zich opnieuw moet registreren.

:::cards
- [Vragen over de mobiele app](#vragen-over-de-mobiele-app): Apparaten, projecten, zelf hosten en beveiliging.
- [Vragen over de desktop-app](#vragen-over-de-desktop-app): Wat de desktop-app is, en wat hij niet kan.
- [Wanneer een telefoon zich opnieuw moet registreren](#wanneer-een-telefoon-zich-opnieuw-moet-registreren): Waarom een telefoon geen oproepen meer krijgt, en hoe hij terugkomt.
- [Probleemoplossing](#probleemoplossing): Problemen met aanmelden, meldingen en installeren.
:::

## Vragen over de mobiele app

:::details Is de app gratis?
Ja. OneUptime On-Call is gratis in de App Store, op Google Play en als APK op GitHub. U meldt zich aan met uw OneUptime-account.
:::

:::details Op welke telefoons en tablets draait hij?
Op iPhones en iPads met iOS of iPadOS 16.4 of nieuwer, en op Android-telefoons en -tablets met Android 7.0 of nieuwer.
:::

:::details Werkt hij met een zelf gehost OneUptime?
Ja. Voer het `https://`-adres van uw OneUptime in wanneer de app start, of tik op het aanmeldscherm op **Change Server**. Standaard stuurt uw server oproepen naar telefoons via de push-relay van OneUptime, en heeft dus geen account bij Apple, Google of Expo nodig: zie [Pushmeldingen](/docs/self-hosted/push-notifications).
:::

:::details Kan ik hem met meerdere projecten gebruiken?
Ja. De app registreert de telefoon in elk project waarvan u lid bent, zodat elk project u kan oproepen. Hij toont één project tegelijk: tik bovenaan een scherm op de naam van het project om te wisselen.
:::

:::details Kan ik me op meer dan één telefoon aanmelden?
Ja. Elke telefoon of tablet is een eigen pushapparaat, met eigen bereikbaarheidsregels en een eigen instelling voor kritieke meldingen.
:::

:::details Wat kan ik in de app doen?
- **Home**: wat in het project aandacht nodig heeft: actieve incidenten en waarschuwingen, open beveiligingszaken als uw rol u ze laat zien, monitors met problemen en gegroepeerde gebeurtenissen.
- **Monitors**: alle monitors, gefilterd op gezondheid, met hun details.
- **Inbox**: incidenten en waarschuwingen, en de episodes die ze groeperen. Open er een om **Acknowledge**, **Resolve** of **Add Note** te gebruiken. Laat uw rol u de beveiligingszaken van het project zien, dan toont **Security** de open zaken: open er een om **Approve** of **Reject** te gebruiken voor een playbookstap die op goedkeuring wacht, de zaak op te pakken met **Assign to me** of **Close case** te gebruiken.
- **On-Call**: of u dienst hebt en tot wanneer, wie nog meer, de oproepen die naar u gingen, en **Cover for me**, dat uw oproepen een tijdje aan een collega overdraagt.
- **Settings**: uw projecten en single sign-on, het uiterlijk, kritieke meldingen en het alarmgeluid, **Biometrics Login**, uw agendafeed voor diensten, en **Log Out**.

Al het andere vindt u in het dashboard.
:::

:::details Kan ik een oproep vanuit de melding bevestigen?
Nee. Tik op de melding: de app opent het incident, de waarschuwing, de episode of de beveiligingszaak waar het om gaat, in het juiste project, en daar bevestigt u. Is de app vergrendeld of bent u afgemeld, dan opent hij de oproep zodra u binnen bent.
:::

:::details Is mijn aanmelding veilig op de telefoon?
De app praat met uw OneUptime alleen via HTTPS. Uw aanmelding wordt bewaard in de eigen opslag van de app op de telefoon, en **Log Out** wist haar en meldt de sessie ook op de server af. Schakel **Biometrics Login** in om de app bij elke start om uw gezicht, vingerafdruk of toegangscode te laten vragen.
:::

:::details Werkt de app offline?
Nee. Zonder verbinding toont hij bovenaan het scherm **No internet connection**, en gaat hij verder zodra de verbinding terug is.
:::

## Vragen over de desktop-app

:::details Wat is de desktop-app?
Het OneUptime-dashboard, vanuit uw browser als app geïnstalleerd: een eigen venster, een pictogram in het menu Start, het Dock of uw app-starter, en meldingen. Hij doet alles wat het dashboard doet, omdat hij het dashboard is.
:::

:::details Waarom staat hij in geen enkele store?
Dat hoeft niet. De app laadt het dashboard bij elke start van uw OneUptime, dus hij is altijd de versie die uw OneUptime draait, op Windows, macOS en Linux gelijk, zonder dat er iets bij te werken is.
:::

:::details Kan hij me wekken zoals de telefoon?
Nee. Browsers kunnen Niet storen of een Focus niet negeren, dus een desktopmelding klinkt niet harder dan de computer toestaat. Gebruik voor oproepen die u moeten wekken de mobiele app met kritieke meldingen.
:::

:::details Werkt hij offline?
Nee. Hij heeft een verbinding met uw OneUptime nodig, net als het dashboard in een browsertabblad.
:::

## Wanneer een telefoon zich opnieuw moet registreren

OneUptime stuurt de oproepen van een telefoon via Expo, dat ze aan Apple of Google doorgeeft. Wanneer Expo zegt dat de telefoon niet meer bereikbaar is, stuurt OneUptime er niets meer naartoe, tot de app hem opnieuw registreert.

```mermaid title="Hoe een telefoon geen oproepen meer krijgt, en hoe hij terugkomt"
flowchart TB
    Registered["De telefoon is<br/>geregistreerd, en<br/>oproepen bereiken hem"]
    Gone["Expo meldt hem weg: een<br/>push wordt geweigerd, of<br/>zijn ontvangstbewijs zegt<br/>het zo'n 15 minuten later"]
    Marked["OneUptime markeert<br/>hem als Ontvangt geen<br/>meldingen en stopt met<br/>sturen; zijn regels blijven"]
    Open["U opent de app terwijl<br/>u bent aangemeld"]
    Renewed["De app registreert zich<br/>opnieuw, vernieuwt zijn<br/>pushtoken, en oproepen<br/>bereiken hem weer"]
    Registered --> Gone --> Marked --> Open --> Renewed
```

Expo meldt een telefoon weg wanneer de app ervan is verwijderd, of wanneer zijn pushtoken niet meer geldig is. De telefoon wordt niet verwijderd: **Gebruikersinstellingen → Meldingsmethoden** toont hem op het tabblad **Push Notifications** als **Ontvangt geen meldingen**, en de dienstentijdlijn van een oproep die hem niet bereikte, zegt waarom. Uw andere telefoons en meldingsmethoden worden zoals altijd opgeroepen.

De app registreert de telefoon bij elke start, wanneer u zich aanmeldt, en wanneer u naar de app terugkeert, hooguit eens per vijf minuten. Bij het registreren vraagt de app Expo opnieuw om het pushtoken, wat het vernieuwt, en de telefoon krijgt weer oproepen met de regels die hij had.

| Wat er gebeurde | Wat te doen | Wat OneUptime doet |
| --- | --- | --- |
| De app is nog geïnstalleerd | Open hem terwijl u bent aangemeld | De telefoon krijgt weer meldingen, met zijn regels |
| U hebt de app op een iPhone of iPad opnieuw geïnstalleerd | Installeer hem en meld u aan | Meestal komt dezelfde vermelding terug, met haar regels |
| U hebt de app op Android opnieuw geïnstalleerd | Installeer hem, meld u aan en verwijder de oude vermelding | Een nieuwe vermelding met de standaardregels; de oude blijft gemarkeerd |
| Een nieuwe telefoon, ingesteld vanuit een back-up van de oude | Open de app op de nieuwe telefoon | Is de vermelding van de oude telefoon gemarkeerd, dan neemt de nieuwe die over, met haar regels; anders krijgt de nieuwe telefoon een eigen vermelding |
| Een nieuwe telefoon, vanaf nul ingesteld | Meld u aan en verwijder de oude vermelding | Een nieuwe vermelding met de standaardregels |
| U hebt zich in de app afgemeld | Meld u opnieuw aan | Afmelden haalde de telefoon en zijn regels weg; hij komt terug met de standaardregels |

Ook een browser kan stoppen met meldingen ontvangen, wanneer zijn pushabonnement verloopt. Het dashboard vernieuwt het als het kan; blijft de browser gemarkeerd, registreer hem dan opnieuw met **Apparaat registreren** in die browser.

## Probleemoplossing

### Aanmelden

:::details „Could not connect to the server”
De app kon `https://<your-oneuptime>/api/status` niet bereiken. Controleer het adres, inclusief `https://`: de app maakt geen verbinding via gewoon HTTP. Staat uw OneUptime in een privénetwerk, verbind de telefoon er dan eerst mee, bijvoorbeeld via uw VPN. Geopend in de browser van de telefoon toont dat adres `{"status":"ok"}` als de telefoon OneUptime kan bereiken.
:::

:::details „No SSO configuration found for the email”
Geen van de projecten waarvan dat e-mailadres lid is, heeft single sign-on ingesteld, of het e-mailadres heeft geen account op dit OneUptime. Controleer het e-mailadres, of meld u aan met uw wachtwoord. Providers die uw beheerder voor de hele installatie heeft ingesteld, staan vóór het e-mailveld.
:::

:::details Een beveiligingssleutel is uw enige tweede factor
De app kan geen beveiligingssleutel gebruiken. Meld u aan met een van uw back-upcodes, of voeg in het dashboard een authenticator-app aan uw account toe: zie [Tweestapsverificatie inschakelen](/docs/introduction/your-account#tweestapsverificatie-inschakelen).
:::

:::details Aanmelden met een passkey mislukt
Passkeys vereisen dat het adres van uw OneUptime met `https://` begint, en een passkey die u voor dit OneUptime hebt toegevoegd: zie [Een passkey toevoegen](/docs/introduction/your-account#een-passkey-toevoegen). Tik op het aanmeldscherm op **Change Server** om een andere server te gebruiken.
:::

### Meldingen

:::details Geen meldingen op de telefoon
- Controleer of de telefoon meldingen van OneUptime On-Call toestaat, en of Niet storen of een Focus ze niet tegenhoudt.
- Controleer in **Gebruikersinstellingen → Meldingsmethoden**, tabblad **Push Notifications**, of de telefoon in de lijst staat, en stuur hem een **Testmelding**.
- Is hij gemarkeerd als **Ontvangt geen meldingen**, open dan de app terwijl u bent aangemeld: zie [Wanneer een telefoon zich opnieuw moet registreren](#wanneer-een-telefoon-zich-opnieuw-moet-registreren).
- Controleer uw bereikbaarheidsregels onder **Gebruikersinstellingen → Bereikbaarheidsregels**: die bepalen welke oproepen welke methode bereiken.
- Controleer bij een zelf gehost OneUptime of de server zijn push-relay bereikt: zie [Pushmeldingen](/docs/self-hosted/push-notifications#netwerktoegang).
:::

:::details Oproepen komen op Android te laat aan
Zet het batterijgebruik van de app in de Android-instellingen voor OneUptime On-Call op **Onbeperkt**, en laat de app buiten elke lijst voor batterijbesparing: zie [Voorkomen dat oproepen te laat aankomen](/docs/mobile-desktop-apps/android-installation#voorkomen-dat-oproepen-te-laat-aankomen).
:::

:::details Kritieke meldingen klinken niet door de stille modus heen
Open in de app **Settings**: de regel onder **Critical On-Call Alerts** zegt wat er op die telefoon ontbreekt. Controleer daarna onder **Gebruikersinstellingen → Bereikbaarheidsregels** of de bereikbaarheidsregel die de oproep stuurde op **Kritieke waarschuwing** staat, niet op **Normaal**. Elke telefoon heeft een eigen schakelaar.
:::

### Desktop-app

:::details Geen installatiepictogram in de adresbalk
Installeer vanaf een dashboardpagina na het aanmelden, via `https://`, in Edge of Chrome, of in Safari op macOS Sonoma 14 of nieuwer. Verschijnt het pictogram niet, dan installeert ook het menu van de browser de app: zie [Windows-installatie](/docs/mobile-desktop-apps/windows-installation#de-app-installeren).
:::

:::details Geen desktopmeldingen
Registreer de browser onder **Gebruikersinstellingen → Meldingsmethoden**, tabblad **Push Notifications**, met **Apparaat registreren**, sta meldingen toe wanneer erom wordt gevraagd, en controleer de meldingsinstellingen van de computer zelf. Een zelf gehost OneUptime heeft zijn VAPID-sleutels nodig voor browsermeldingen.
:::

## Hulp krijgen

Klopt hier iets niet met wat u ziet, [open dan een issue op GitHub](https://github.com/OneUptime/oneuptime/issues) met de versie van uw app, onderaan het scherm **Settings**, en het platform dat u gebruikt.

## Volgende stappen

:::cards
- [Apps – Overzicht](/docs/mobile-desktop-apps/index): Welke app u gebruikt, en hoe de apps OneUptime bereiken.
- [Android-installatie](/docs/mobile-desktop-apps/android-installation): De app op Android installeren en instellen.
- [iOS-installatie](/docs/mobile-desktop-apps/ios-installation): De app op een iPhone of iPad installeren en instellen.
- [Pushmeldingen](/docs/self-hosted/push-notifications): Hoe een zelf gehost OneUptime oproepen stuurt, en de fouten van Expo.
:::
