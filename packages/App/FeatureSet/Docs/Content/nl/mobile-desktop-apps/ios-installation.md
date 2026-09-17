# iOS Installatiehandleiding

Installeer de **OneUptime On-Call** native iOS app vanuit de Apple App Store op uw iPhone of iPad.

## Vereisten

- iPhone of iPad met **iOS 15.0 of later**
- Een actief OneUptime account (of de URL van uw zelf-gehoste OneUptime instantie)
- Internetverbinding voor het inloggen en het ontvangen van pushmeldingen

## Installeren vanuit de App Store

1. **Open de App Store** op uw iPhone of iPad.
2. Tik op het tabblad **Zoeken** en zoek naar **"OneUptime On-Call"**, of open deze link op uw apparaat:
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. Tik op **Download**, en verifieer vervolgens met Face ID, Touch ID of uw Apple ID wachtwoord.
4. Zodra de app is geïnstalleerd, tikt u op **Open** of start u **OneUptime On-Call** vanaf uw beginscherm.

## Eerste Start en Inloggen

1. **Server URL**
   - Als u OneUptime Cloud gebruikt, laat dan de standaardwaarde `https://oneuptime.com` staan.
   - Als u zelf host, voer dan de URL van uw OneUptime instantie in (bijv. `https://oneuptime.example.com`).
   - De app controleert of de server bereikbaar is voordat u doorgaat.
2. **Inloggen**
   - Voer het e-mailadres en wachtwoord van uw OneUptime account in.
   - Schakel optioneel **Face ID** of **Touch ID** in voor snellere ontgrendelingen bij latere starts.
3. **Meldingen Toestaan**
   - Tik op **Toestaan** wanneer daarom wordt gevraagd, zodat de app oproepen voor wachtdiensten, incidentmeldingen en bevestigingen kan afleveren.

## Pushmeldingen

Pushmeldingen worden afgeleverd via de Apple Push Notification service (APNs) via Expo Push. Om ervoor te zorgen dat oproepen u betrouwbaar bereiken:

1. Ga naar **Instellingen → Berichtgeving → OneUptime On-Call**.
2. Schakel **Sta berichtgeving toe**, **Geluiden**, **Badges**, en aflevering op **Toegangsscherm / Banner / Berichtencentrum** in.
3. Stel **Groepering van berichten** in op **Automatisch**.
4. Als u dienst hebt, schakel dan **Energiebesparingsmodus** uit tijdens uw dienst en vermijd het geforceerd afsluiten van de app — iOS kan de aflevering op de achtergrond vertragen als de app geforceerd is afgesloten.
5. Voeg **OneUptime On-Call** toe aan alle **Focus** modi waarin u nog steeds oproepen wilt ontvangen.

## Updates

De app wordt bijgewerkt via de App Store:

- Open de **App Store**, tik op uw profielfoto, scroll naar **OneUptime On-Call** en tik op **Werk bij**.
- Of schakel **Instellingen → App Store → App-updates** in om updates automatisch te installeren.

## Verwijderen

1. **Houd ingedrukt** op het **OneUptime On-Call** pictogram op uw beginscherm.
2. Tik op **Verwijder app → Verwijder app**.
3. Bevestig door op **Verwijderen** te tikken.

Uw OneUptime account en wachtdienstroosters worden aan de serverkant opgeslagen en worden niet verwijderd wanneer u de app verwijdert.

## Probleemoplossing

**De App Store geeft aan dat de app "Niet beschikbaar in uw regio" is:**

- De app is gepubliceerd in de wereldwijde App Store. Als deze niet in uw regio verschijnt, neem dan contact op met [support](mailto:support@oneuptime.com).

**"Netwerkfout" bij het inloggen:**

- Controleer of de **Server URL** correct is en bereikbaar is vanaf uw apparaat.
- Als u zich op een bedrijfsnetwerk of VPN bevindt, zorg er dan voor dat de OneUptime instantie toegankelijk is.
- Bevestig dat de server via HTTPS met een geldig certificaat wordt aangeboden.

**Geen pushmeldingen ontvangen:**

- Open **Instellingen → Berichtgeving → OneUptime On-Call** en bevestig dat meldingen zijn toegestaan.
- Schakel **Niet storen** uit of voeg OneUptime On-Call toe aan de lijst met toegestane apps van uw actieve Focus modus.
- Log uit en log opnieuw in om het push-token dat bij de server is geregistreerd te vernieuwen.
- Zelf-gehoste gebruikers: bevestig dat pushmeldingen zijn geconfigureerd op uw OneUptime instantie (zie de zelf-gehoste handleiding [Pushmeldingen](/docs/self-hosted/push-notifications)).

**Face ID / Touch ID werkt niet:**

- Zorg ervoor dat biometrische gegevens zijn ingeschreven in **Instellingen → Face ID en toegangscode** of **Instellingen → Touch ID en toegangscode**.
- Schakel biometrische ontgrendeling opnieuw in vanuit het scherm **Instellingen** binnen de OneUptime On-Call app.

**App crasht bij het opstarten:**

- Werk bij naar de nieuwste versie via de App Store.
- Start uw apparaat opnieuw op.
- Als het probleem aanhoudt, verwijder de app en installeer deze opnieuw, en log dan opnieuw in.

## Ondersteuning

Als u nog hulp nodig hebt, neem dan contact op via uw OneUptime dashboard of open een issue op onze [GitHub repository](https://github.com/OneUptime/oneuptime).
