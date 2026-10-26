# Ofte stillede spørgsmål og fejlfinding

Svar på almindelige spørgsmål om OneUptimes mobil- og desktop-apps, og løsninger på det, der oftest går galt: login, notifikationer, der ikke kommer frem, og en telefon, der skal registreres igen.

:::cards
- [Spørgsmål om mobilappen](#spørgsmål-om-mobilappen): Enheder, projekter, selv-hosting og sikkerhed.
- [Spørgsmål om desktop-appen](#spørgsmål-om-desktop-appen): Hvad desktop-appen er, og hvad den ikke kan.
- [Når en telefon skal registreres igen](#når-en-telefon-skal-registreres-igen): Hvorfor en telefon holder op med at få alarmer, og hvordan den kommer tilbage.
- [Fejlfinding](#fejlfinding): Problemer med login, notifikationer og installation.
:::

## Spørgsmål om mobilappen

:::details Er appen gratis?
Ja. OneUptime On-Call er gratis i App Store, på Google Play og som APK på GitHub. Du logger ind med din OneUptime-konto.
:::

:::details Hvilke telefoner og tablets kører den på?
iPhones og iPads med iOS eller iPadOS 16.4 eller nyere, og Android-telefoner og -tablets med Android 7.0 eller nyere.
:::

:::details Virker den med et selv-hostet OneUptime?
Ja. Indtast dit OneUptimes `https://`-adresse, når appen starter, eller tryk på **Change Server** på loginskærmen. Som standard sender din server alarmer til telefoner gennem OneUptimes push-relæ, så den behøver ingen konto hos Apple, Google eller Expo: se [Push-notifikationer](/docs/self-hosted/push-notifications).
:::

:::details Kan jeg bruge den med flere projekter?
Ja. Appen registrerer telefonen i hvert projekt, du er medlem af, så hvert projekt kan tilkalde dig. Den viser ét projekt ad gangen: tryk på projektets navn øverst på en skærm for at skifte.
:::

:::details Kan jeg logge ind på mere end én telefon?
Ja. Hver telefon eller tablet er sin egen push-enhed, med sine egne vagtregler og sin egen indstilling for kritiske advarsler.
:::

:::details Hvad kan jeg gøre i appen?
- **Home**: hvad der kræver opmærksomhed i projektet: aktive hændelser og advarsler, åbne sikkerhedssager, hvis din rolle giver dig adgang til dem, monitorer med problemer og grupperede hændelser.
- **Monitors**: alle monitorer, filtreret efter tilstand, med deres detaljer.
- **Inbox**: hændelser og advarsler, og de episoder, der grupperer dem. Åbn en for at bruge **Acknowledge**, **Resolve** eller **Add Note**. Giver din rolle dig adgang til projektets sikkerhedssager, viser **Security** de åbne: åbn en for at bruge **Approve** eller **Reject** på et playbook-trin, der venter på godkendelse, tage sagen med **Assign to me** eller bruge **Close case**.
- **On-Call**: om du har vagt og til hvornår, hvem der ellers har, de alarmer, der er sendt til dig, og **Cover for me**, som giver dine alarmer videre til en kollega i et stykke tid.
- **Settings**: dine projekter og single sign-on, udseendet, kritiske advarsler og alarmlyden, **Biometrics Login**, dit vagtkalenderfeed og **Log Out**.

Alt andet finder du i dashboardet.
:::

:::details Kan jeg kvittere for en alarm fra notifikationen?
Nej. Tryk på notifikationen: appen åbner den hændelse, advarsel, episode eller sikkerhedssag, den handler om, i det rigtige projekt, og du kvitterer dér. Er appen låst, eller er du logget ud, åbner den alarmen, så snart du er inde.
:::

:::details Er mit login sikkert på telefonen?
Appen taler kun med dit OneUptime over HTTPS. Dit login gemmes i appens eget lager på telefonen, og **Log Out** sletter det og logger også sessionen ud på serveren. Slå **Biometrics Login** til, så appen spørger om dit ansigt, dit fingeraftryk eller din kode, hver gang den starter.
:::

:::details Virker appen offline?
Nej. Uden forbindelse viser den **No internet connection** øverst på skærmen og fortsætter, så snart forbindelsen er tilbage.
:::

## Spørgsmål om desktop-appen

:::details Hvad er desktop-appen?
OneUptime-dashboardet, installeret fra din browser som en app: sit eget vindue, et ikon i menuen Start, i Dock eller i din appstarter, og notifikationer. Den kan alt, hvad dashboardet kan, fordi den er dashboardet.
:::

:::details Hvorfor er den ikke i en appbutik?
Det behøver den ikke. Appen henter dashboardet fra dit OneUptime, hver gang den åbner, så den er altid den version, dit OneUptime kører, på Windows, macOS og Linux ens, uden noget at opdatere.
:::

:::details Kan den vække mig som telefonen?
Nej. Browsere kan ikke tilsidesætte Forstyr ikke eller et Fokus, så en desktop-notifikation er kun så høj, som computeren tillader. Brug mobilappen med kritiske advarsler til alarmer, der skal vække dig.
:::

:::details Virker den offline?
Nej. Den kræver forbindelse til dit OneUptime, ligesom dashboardet i en browserfane.
:::

## Når en telefon skal registreres igen

OneUptime sender en telefons alarmer gennem Expo, som giver dem videre til Apple eller Google. Når Expo siger, at telefonen ikke længere kan nås, holder OneUptime op med at sende til den, indtil appen registrerer den igen.

```mermaid title="Sådan holder en telefon op med at få alarmer, og sådan kommer den tilbage"
flowchart TB
    Registered["Telefonen er registreret,<br/>og alarmer når den"]
    Gone["Expo melder den væk:<br/>et push afvises, eller<br/>dets kvittering siger det<br/>cirka 15 minutter senere"]
    Marked["OneUptime markerer<br/>den Modtager ikke<br/>notifikationer og holder<br/>op med at sende;<br/>reglerne bliver"]
    Open["Du åbner appen,<br/>mens du er logget ind"]
    Renewed["Appen registrerer<br/>sig igen, fornyer<br/>sit push-token, og<br/>alarmer når den igen"]
    Registered --> Gone --> Marked --> Open --> Renewed
```

Expo melder en telefon væk, når appen er fjernet fra den, eller når dens push-token ikke længere er gyldigt. Telefonen slettes ikke: **Brugerindstillinger → Notifikationsmetoder** viser den på fanen **Push Notifications** som **Modtager ikke notifikationer**, og vagttidslinjen for en alarm, der ikke nåede den, siger hvorfor. Dine andre telefoner og notifikationsmetoder bliver tilkaldt som sædvanlig.

Appen registrerer telefonen, hver gang den starter, når du logger ind, og når du vender tilbage til den, højst én gang hvert femte minut. Registreringen beder Expo om push-tokenet igen, hvilket fornyer det, og telefonen får alarmer igen med de regler, den havde.

| Hvad der skete | Hvad du gør | Hvad OneUptime gør |
| --- | --- | --- |
| Appen er stadig installeret | Åbn den, mens du er logget ind | Telefonen får notifikationer igen, med sine regler |
| Du har geninstalleret appen på en iPhone eller iPad | Installer den, og log ind | Som regel kommer den samme post tilbage, med sine regler |
| Du har geninstalleret appen på Android | Installer den, log ind, og slet den gamle post | En ny post med standardreglerne; den gamle forbliver markeret |
| En ny telefon, sat op fra en sikkerhedskopi af den gamle | Åbn appen på den nye telefon | Er den gamle telefons post markeret, overtager den nye den, med sine regler; ellers får den nye telefon sin egen post |
| En ny telefon, sat op fra bunden | Log ind, og slet den gamle post | En ny post med standardreglerne |
| Du loggede ud af appen | Log ind igen | Udlogningen fjernede telefonen og dens regler; den kommer tilbage med standardreglerne |

En browser kan også holde op med at få notifikationer, når dens push-abonnement udløber. Dashboardet fornyer det, når det kan; forbliver browseren markeret, så registrer den igen med **Registrer enhed** i den browser.

## Fejlfinding

### Login

:::details »Could not connect to the server«
Appen kunne ikke nå `https://<your-oneuptime>/api/status`. Tjek adressen, inklusive `https://`: appen forbinder ikke over almindelig HTTP. Er dit OneUptime på et privat netværk, så forbind telefonen til det først, for eksempel via dit VPN. Åbnet i telefonens browser viser den adresse `{"status":"ok"}`, når telefonen kan nå OneUptime.
:::

:::details »No SSO configuration found for the email«
Ingen af de projekter, den e-mail er medlem af, har sat single sign-on op, eller e-mailen har ingen konto på dette OneUptime. Tjek e-mailen, eller log ind med din adgangskode. Udbydere, som din administrator har sat op for hele installationen, står før e-mailfeltet.
:::

:::details En sikkerhedsnøgle er din eneste anden faktor
Appen kan ikke bruge en sikkerhedsnøgle. Log ind med en af dine backupkoder, eller tilføj en godkendelsesapp til din konto i dashboardet: se [Slå totrinsgodkendelse til](/docs/introduction/your-account#slå-totrinsgodkendelse-til).
:::

:::details Login med adgangsnøgle mislykkes
Adgangsnøgler kræver, at dit OneUptimes adresse starter med `https://`, og en adgangsnøgle, du har tilføjet til dette OneUptime: se [Tilføj en adgangsnøgle](/docs/introduction/your-account#tilføj-en-adgangsnøgle). Tryk på **Change Server** på loginskærmen for at bruge en anden server.
:::

### Notifikationer

:::details Ingen notifikationer på telefonen
- Tjek, at telefonen tillader notifikationer fra OneUptime On-Call, og at Forstyr ikke eller et Fokus ikke holder dem tilbage.
- Tjek under **Brugerindstillinger → Notifikationsmetoder** på fanen **Push Notifications**, at telefonen står på listen, og send den en **Testnotifikation**.
- Er den markeret som **Modtager ikke notifikationer**, så åbn appen, mens du er logget ind: se [Når en telefon skal registreres igen](#når-en-telefon-skal-registreres-igen).
- Tjek dine vagtregler under **Brugerindstillinger → Vagtregler**: de bestemmer, hvilke alarmer der når hvilken metode.
- På et selv-hostet OneUptime skal du tjekke, at serveren kan nå sit push-relæ: se [Push-notifikationer](/docs/self-hosted/push-notifications#netværksadgang).
:::

:::details Alarmer kommer for sent på Android
Sæt appens batteriforbrug til **Ubegrænset** i Androids indstillinger for OneUptime On-Call, og hold appen uden for enhver batteribesparelsesliste: se [Undgå, at alarmer kommer for sent](/docs/mobile-desktop-apps/android-installation#undgå-at-alarmer-kommer-for-sent).
:::

:::details Kritiske advarsler ringer ikke igennem lydløs
Åbn **Settings** i appen: linjen under **Critical On-Call Alerts** siger, hvad der mangler på den telefon. Tjek derefter under **Brugerindstillinger → Vagtregler**, at den vagtregel, der sendte alarmen, er sat til **Kritisk advarsel**, ikke **Normal**. Hver telefon har sin egen kontakt.
:::

### Desktop-app

:::details Intet installationsikon i adresselinjen
Installer fra en dashboardside efter login, over `https://`, i Edge eller Chrome, eller i Safari på macOS Sonoma 14 eller nyere. Vises ikonet ikke, installerer browserens menu også appen: se [Windows-installation](/docs/mobile-desktop-apps/windows-installation#installer-appen).
:::

:::details Ingen desktop-notifikationer
Registrer browseren under **Brugerindstillinger → Notifikationsmetoder** på fanen **Push Notifications** med **Registrer enhed**, tillad notifikationer, når du bliver spurgt, og tjek computerens egne notifikationsindstillinger. Et selv-hostet OneUptime kræver sine VAPID-nøgler til browsernotifikationer.
:::

## Få hjælp

Hvis noget her ikke passer med det, du ser, så [opret et issue på GitHub](https://github.com/OneUptime/oneuptime/issues) med din apps version, nederst på dens skærm **Settings**, og den platform, du bruger.

## Næste trin

:::cards
- [Apps – Oversigt](/docs/mobile-desktop-apps/index): Hvilken app du skal bruge, og hvordan apps når OneUptime.
- [Android-installation](/docs/mobile-desktop-apps/android-installation): Installer og opsæt appen på Android.
- [iOS-installation](/docs/mobile-desktop-apps/ios-installation): Installer og opsæt appen på en iPhone eller iPad.
- [Push-notifikationer](/docs/self-hosted/push-notifications): Sådan sender et selv-hostet OneUptime alarmer, og Expos fejl.
:::
