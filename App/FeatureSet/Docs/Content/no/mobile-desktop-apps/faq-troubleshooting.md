# Vanlige spørsmål og feilsøking

Vanlige spørsmål og løsninger for OneUptime mobil- og skrivebordsapper.

## Hvordan distribuerer OneUptime appene sine?

- **Mobil (iOS og Android):** OneUptime leverer en native app som heter **OneUptime On-Call**. Den er publisert i [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) og [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). En signert [APK-nedlasting](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) er også tilgjengelig for Android-enheter uten Google Play.
- **Skrivebord (Windows, macOS, Linux):** OneUptimes nettbaserte dashbord er en progressiv nettapp (PWA). Du kan installere det som en skrivebordsapplikasjon direkte fra en Chromium-basert nettleser eller Safari — ingen butikkonto kreves.

## Vanlige spørsmål om mobilappen

### Hvilke enheter støttes?

- **iOS:** iPhone eller iPad med iOS 15.0 eller nyere.
- **Android:** Telefoner og nettbrett med Android 8.0 (Oreo) eller nyere.

### Er appen gratis?

Ja. OneUptime On-Call-appen er gratis å installere. Du logger inn med din eksisterende OneUptime-konto.

### Kan jeg bruke appen med en selvhostet OneUptime-instans?

Ja. Ved første oppstart spør appen om en **server-URL**. Skriv inn URL-en til din selvhostede instans (for eksempel `https://oneuptime.example.com`). Appen validerer at serveren er tilgjengelig før du kan logge inn.

For push-varsler på selvhostede instanser, følg [Push-varsler](/docs/self-hosted/push-notifications)-veiledningen.

### Hvordan leveres oppdateringer?

- **iOS:** Gjennom App Store. Aktiver automatiske oppdateringer i **Innstillinger → App Store**, eller oppdater manuelt fra App Store-profilen din.
- **Android (Google Play):** Automatiske oppdateringer er aktivert som standard.
- **Android (APK-sideload):** Last ned og installer den nyeste APK-en fra GitHub Releases-lenken over.

### Hvorfor mottar jeg ikke push-varsler?

Mobil push-levering bruker APNs (iOS) og FCM (Android) via Expo Push. Kontroller følgende:

1. Varsler er aktivert på OS-nivå for **OneUptime On-Call**.
2. Batterioptimalisering er deaktivert og bakgrunnsaktivitet er tillatt (Android).
3. Ikke forstyrr- eller Fokus-modi er av, eller appen er på unntakslisten.
4. Du er logget inn — push-tokenet registreres hos serveren først etter at du har logget inn.
5. **Kun selvhostet:** Push-varsler er konfigurert på OneUptime-instansen din. Se [Push-varsler](/docs/self-hosted/push-notifications)-veiledningen.

### Er dataene på telefonen min sikre?

- All API-trafikk bruker HTTPS.
- Tilgangs- og fornyelsestokener lagres i enhetens sikre nøkkellager (Keychain på iOS, Keystore på Android).
- Du kan kreve opplåsing med Face ID / Touch ID / fingeravtrykk fra **Innstillinger**-skjermen i appen.

### Kan jeg installere appen på flere enheter?

Ja. Logg inn med samme OneUptime-konto på så mange enheter du trenger. Hver enhet mottar sine egne push-varsler.

### Hvordan avinstallerer jeg?

- **iOS:** Trykk og hold på ikonet → **Fjern app** → **Slett app**.
- **Android:** Trykk og hold på ikonet → **Avinstaller**, eller **Innstillinger → Apper → OneUptime On-Call → Avinstaller**.

OneUptime-kontoen og dataene dine lagres på serveren og fjernes ikke når du avinstallerer appen.

## Vanlige spørsmål om skrivebordsappen (PWA)

### Hva er en progressiv nettapp (PWA)?

En progressiv nettapp er en nettapplikasjon som kan installeres som en native skrivebordsapp. Når den er installert, kjører den i sitt eget vindu, har sitt eget ikon i appstarteren din, og kan levere skrivebordsvarsler — uten å gå gjennom Windows Store, Mac App Store eller andre distribusjonskanaler.

### Hvorfor bruker skrivebordsappen PWA-teknologi?

- **Umiddelbare oppdateringer** — appen holdes synkronisert med OneUptime-instansen din i det øyeblikket du distribuerer.
- **Ingen butikkonto kreves** — installer direkte fra en hvilken som helst moderne nettleser.
- **Felles kodebase** — det samme dashbordet kjører på Windows, macOS og Linux.

### Hvorfor vises ikke «Install»-knappen?

1. Bruk en Chromium-basert nettleser (Chrome, Edge, Brave, Arc) eller Safari (macOS Sonoma+).
2. Bekreft at OneUptime-instansen din leveres over HTTPS med et gyldig sertifikat.
3. Tøm nettleserens hurtigbuffer og last inn på nytt.
4. Appen kan allerede være installert — sjekk Programmer / Start-menyen.

### Hvordan oppdaterer jeg skrivebordsappen?

PWA-en oppdateres automatisk hver gang du åpner den mens du er tilkoblet. For å tvinge frem en oppdatering, last inn vinduet på nytt med **Ctrl+R** (Windows/Linux) eller **Cmd+R** (macOS).

### Hvordan avinstallerer jeg skrivebords-PWA-en?

- **Windows:** **Innstillinger → Apper → OneUptime → Avinstaller**, eller høyreklikk på Start-menyoppføringen.
- **macOS:** Dra appen fra **Programmer** til papirkurven, eller høyreklikk på Dock-ikonet og velg **Fjern**.
- **Linux:** Bruk avinstalleringsalternativet i appstarteren din, eller fjern den relevante `.desktop`-filen.

## Feilsøking

### Problemer med mobilappen

**Appen logger ikke inn / «Nettverksfeil»:**
- Bekreft at **server-URL** er korrekt og kan nås fra telefonen din.
- Sjekk at telefonen er koblet til internett.
- For selvhostede instanser bak en VPN, sørg for at VPN-en er aktiv.

**Push-varsler er forsinket eller mangler (Android):**
- Deaktiver batterioptimalisering: **Innstillinger → Apper → OneUptime On-Call → Batteri → Ubegrenset**.
- Deaktiver Datasparing for appen.
- På Samsung-enheter, slå av **Enhetspleie → Batteri → Grenser for bakgrunnsbruk** for OneUptime On-Call.

**Push-varsler er forsinket eller mangler (iOS):**
- Unngå å tvinge appen til å avslutte — iOS kan stanse bakgrunnslevering.
- Deaktiver Lavstrømmodus mens du er på vakt.
- Legg OneUptime On-Call til på tillatelseslisten for en aktiv Fokus-modus.

**Face ID / Touch ID / fingeravtrykk fungerer ikke:**
- Forsikre deg om at biometri er registrert i OS-innstillingene dine.
- Aktiver biometrisk opplåsing på nytt fra **Innstillinger**-skjermen inne i OneUptime On-Call-appen.

### Problemer med skrivebordsappen (PWA)

**Installeringsknappen mangler:**
- Bruk en støttet nettleser (Chromium-basert eller Safari på macOS Sonoma+).
- Forsikre deg om at OneUptime-instansen leveres over HTTPS.
- Vent til siden er ferdig lastet, og sjekk deretter adressefeltet for installeringsikonet.

**Skrivebordsvarsler vises ikke:**
- Tillat varsler når nettleseren ber om det.
- Sjekk OS-varselinnstillingene (Windows Focus Assist, macOS Varsler, varslingsdemon på Linux).
- For selvhostede instanser, sørg for at konfigurasjonen for [Push-varsler](/docs/self-hosted/push-notifications) er fullført.

**Appen viser ikke nyeste data:**
- Last inn på nytt med **Ctrl+R** / **Cmd+R**.
- Lukk og åpne vinduet på nytt.
- Sjekk nettverkstilkoblingen din.

## Brukerstøtte

Hvis du fortsatt trenger hjelp:

- Mobil: se installasjonsveiledningene for [iOS](./ios-installation.md) eller [Android](./android-installation.md).
- Skrivebord: se installasjonsveiledningene for [Windows](./windows-installation.md), [macOS](./macos-installation.md) eller [Linux](./linux-installation.md).
- Opprett en sak i [OneUptime GitHub-repositoriet](https://github.com/OneUptime/oneuptime).
- Kontakt brukerstøtte gjennom OneUptime-dashbordet.
