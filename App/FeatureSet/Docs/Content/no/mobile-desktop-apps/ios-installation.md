# Installasjonsveiledning for iOS

Installer den native iOS-appen **OneUptime On-Call** fra Apple App Store på din iPhone eller iPad.

## Krav

- iPhone eller iPad med **iOS 15.0 eller nyere**
- En aktiv OneUptime-konto (eller URL-en til din selvhostede OneUptime-instans)
- Internett-tilkobling for å logge inn og motta push-varsler

## Installer fra App Store

1. **Åpne App Store** på din iPhone eller iPad.
2. Trykk på **Søk**-fanen og søk etter **«OneUptime On-Call»**, eller åpne denne lenken på enheten din:
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. Trykk **Hent**, og autentiser deretter med Face ID, Touch ID eller Apple ID-passordet ditt.
4. Når appen er installert, trykk **Åpne** eller start **OneUptime On-Call** fra startskjermen.

## Første oppstart og innlogging

1. **Server-URL**
   - Hvis du bruker OneUptime Cloud, behold standardverdien `https://oneuptime.com`.
   - Hvis du selvhoster, oppgi URL-en til OneUptime-instansen din (f.eks. `https://oneuptime.example.com`).
   - Appen verifiserer at serveren er tilgjengelig før du går videre.
2. **Logg inn**
   - Skriv inn e-postadressen og passordet for OneUptime-kontoen din.
   - Aktiver eventuelt **Face ID** eller **Touch ID** for raskere opplåsing ved senere oppstart.
3. **Tillat varsler**
   - Når du blir bedt om det, trykk **Tillat** slik at appen kan levere vakttilkallinger, hendelsesvarsler og bekreftelser.

## Push-varsler

Push-varsler leveres gjennom Apple Push Notification service (APNs) via Expo Push. For å sikre at tilkallinger når deg pålitelig:

1. Gå til **Innstillinger → Varsler → OneUptime On-Call**.
2. Aktiver **Tillat varsler**, **Lyder**, **Symboler** og levering på **Låsskjerm / Banner / Varselsenter**.
3. Sett **Varselsgruppering** til **Automatisk**.
4. Hvis du er på vakt, deaktiver **Lavstrømmodus** under skiftet ditt og unngå å tvinge appen til å avslutte — iOS kan forsinke bakgrunnslevering hvis appen er tvunget til å lukke.
5. Legg til **OneUptime On-Call** i alle **Fokus**-modi der du fortsatt vil motta tilkallinger.

## Oppdateringer

Appen oppdateres gjennom App Store:

- Åpne **App Store**, trykk på profilbildet ditt, bla til **OneUptime On-Call** og trykk **Oppdater**.
- Eller aktiver **Innstillinger → App Store → Appoppdateringer** for å installere oppdateringer automatisk.

## Avinstaller

1. **Trykk og hold** på **OneUptime On-Call**-ikonet på startskjermen.
2. Trykk **Fjern app → Slett app**.
3. Bekreft ved å trykke **Slett**.

OneUptime-kontoen din og vaktplanene dine lagres på serversiden og fjernes ikke når du avinstallerer appen.

## Feilsøking

**App Store sier at appen er «Ikke tilgjengelig i din region»:**
- Appen er publisert i den globale App Store. Hvis den ikke vises i din region, kontakt [brukerstøtten](mailto:support@oneuptime.com).

**«Nettverksfeil» ved innlogging:**
- Bekreft at **server-URL** er korrekt og kan nås fra enheten din.
- Hvis du er på et bedriftsnettverk eller VPN, forsikre deg om at OneUptime-instansen er tilgjengelig.
- Bekreft at serveren leveres over HTTPS med et gyldig sertifikat.

**Mottar ikke push-varsler:**
- Åpne **Innstillinger → Varsler → OneUptime On-Call** og bekreft at varsler er tillatt.
- Deaktiver **Ikke forstyrr** eller legg OneUptime On-Call til på tillatelseslisten for den aktive Fokus-modusen.
- Logg ut og logg inn igjen for å fornye push-tokenet som er registrert hos serveren.
- Selvhostede brukere: bekreft at push-varsler er konfigurert på OneUptime-instansen din (se den selvhostede [Push-varsler](/docs/self-hosted/push-notifications)-veiledningen).

**Face ID / Touch ID fungerer ikke:**
- Forsikre deg om at biometri er registrert i **Innstillinger → Face ID og kode** eller **Innstillinger → Touch ID og kode**.
- Aktiver biometrisk opplåsing på nytt fra **Innstillinger**-skjermen inne i OneUptime On-Call-appen.

**Appen krasjer ved oppstart:**
- Oppdater til nyeste versjon fra App Store.
- Start enheten på nytt.
- Hvis problemet vedvarer, slett og installer appen på nytt, og logg deretter inn igjen.

## Brukerstøtte

Hvis du fortsatt trenger hjelp, ta kontakt via OneUptime-dashbordet eller opprett en sak i [GitHub-repositoriet vårt](https://github.com/OneUptime/oneuptime).
