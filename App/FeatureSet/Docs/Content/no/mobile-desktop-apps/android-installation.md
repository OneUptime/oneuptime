# Installasjonsveiledning for Android

Installer den native Android-appen **OneUptime On-Call** fra Google Play Store, eller sideload APK-en direkte på enheter uten Google Play.

## Krav

- Android-telefon eller -nettbrett med **Android 8.0 (Oreo) eller nyere**
- En aktiv OneUptime-konto (eller URL-en til din selvhostede OneUptime-instans)
- Internett-tilkobling for å logge inn og motta push-varsler

## Alternativ 1: Installer fra Google Play (anbefalt)

1. Åpne **Google Play Store** på enheten din.
2. Søk etter **«OneUptime On-Call»**, eller åpne denne lenken på enheten din:
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. Trykk **Installer**.
4. Når appen er installert, trykk **Åpne** eller start **OneUptime On-Call** fra appskuffen.

## Alternativ 2: Installer APK-en direkte

For enheter uten Google Play (for eksempel GrapheneOS, /e/OS eller Huawei-enheter), installer den offisielle APK-en fra GitHub Releases:

1. På Android-enheten din, åpne denne lenken:
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. Når du blir bedt om det, tillat at nettleseren din installerer ukjente apper:
   **Innstillinger → Apper → \[nettleseren din\] → Installer ukjente apper → Tillat fra denne kilden**.
3. Åpne den nedlastede APK-en og trykk **Installer**.
4. Start **OneUptime On-Call** fra appskuffen.

APK-en er bygget og signert av OneUptime fra samme kildekode som Play Store-utgivelsen. Appoppdateringer er ikke automatiske ved sideloading — last ned den nyeste APK-en fra lenken over når en ny versjon er utgitt.

## Første oppstart og innlogging

1. **Server-URL**
   - Hvis du bruker OneUptime Cloud, behold standardverdien `https://oneuptime.com`.
   - Hvis du selvhoster, oppgi URL-en til OneUptime-instansen din (f.eks. `https://oneuptime.example.com`).
   - Appen verifiserer at serveren er tilgjengelig før du går videre.
2. **Logg inn**
   - Skriv inn e-postadressen og passordet for OneUptime-kontoen din.
   - Aktiver eventuelt **biometrisk opplåsing** (fingeravtrykk) for raskere opplåsing ved senere oppstart.
3. **Tillat varsler**
   - Når du blir bedt om det, trykk **Tillat** slik at appen kan levere vakttilkallinger, hendelsesvarsler og bekreftelser.

## Push-varsler

Push-varsler leveres gjennom Firebase Cloud Messaging (FCM) via Expo Push. For å sikre at tilkallinger når deg pålitelig mens du er på vakt:

1. Åpne **Innstillinger → Apper → OneUptime On-Call → Varsler** og bekreft at alle kategorier er aktivert.
2. Åpne **Innstillinger → Apper → OneUptime On-Call → Batteri** og velg **Ubegrenset** (eller deaktiver batterioptimalisering) slik at operativsystemet ikke forsinker push-meldinger i bakgrunnen.
3. Tillat at appen kjører i bakgrunnen og deaktiver eventuelle «Datasparing»-begrensninger for den.
4. Hvis du bruker Samsung-enheter, slå også av **Innstillinger → Enhetspleie → Batteri → Grenser for bakgrunnsbruk** for OneUptime On-Call.
5. Legg OneUptime On-Call til på eventuelle unntakslister for **Ikke forstyrr** slik at tilkallinger fortsatt ringer under vaktskiftet ditt.

## Oppdateringer

**Google Play:**
- Oppdateringer installeres automatisk. For å utløse en manuelt, åpne **Play Store → Profil → Administrer apper og enhet → Oppdateringer tilgjengelig → OneUptime On-Call → Oppdater**.

**APK-sideload:**
- Last ned den nyeste APK-en på nytt fra GitHub Releases-lenken over og installer over den eksisterende appen — dataene dine, server-URL og innlogging bevares.

## Avinstaller

1. **Trykk og hold** på **OneUptime On-Call**-ikonet, og trykk deretter **Avinstaller**.
2. Eller åpne **Innstillinger → Apper → OneUptime On-Call → Avinstaller**.
3. Bekreft for å fjerne appen.

OneUptime-kontoen din og vaktplanene dine lagres på serversiden og fjernes ikke når du avinstallerer appen.

## Feilsøking

**«Nettverksfeil» ved innlogging:**
- Bekreft at **server-URL** er korrekt og kan nås fra enheten din.
- Hvis du er på et bedriftsnettverk eller VPN, forsikre deg om at OneUptime-instansen er tilgjengelig.
- Bekreft at serveren leveres over HTTPS med et gyldig sertifikat.

**Mottar ikke push-varsler:**
- Bekreft at varsler er aktivert under **Innstillinger → Apper → OneUptime On-Call → Varsler**.
- Deaktiver batterioptimalisering for OneUptime On-Call (se Push-varsler over).
- Forsikre deg om at Ikke forstyrr er av, eller at OneUptime On-Call er på unntakslisten.
- Logg ut og logg inn igjen for å fornye push-tokenet som er registrert hos serveren.
- Selvhostede brukere: bekreft at push-varsler er konfigurert på OneUptime-instansen din (se den selvhostede [Push-varsler](/docs/self-hosted/push-notifications)-veiledningen).

**Biometrisk opplåsing fungerer ikke:**
- Registrer et fingeravtrykk under **Innstillinger → Sikkerhet → Fingeravtrykk**.
- Aktiver biometrisk opplåsing på nytt fra **Innstillinger**-skjermen inne i OneUptime On-Call-appen.

**APK-installasjon blokkert:**
- Du må gi nettleseren tillatelse til å installere ukjente apper (se Alternativ 2 over).
- Enkelte operatører eller bedriftsenhetsprofiler blokkerer sideloading helt; bruk i så fall Google Play-versjonen i stedet.

**Appen krasjer ved oppstart:**
- Oppdater til nyeste versjon fra Google Play eller nyeste APK.
- Start enheten på nytt.
- Hvis problemet vedvarer, avinstaller og installer på nytt, og logg deretter inn igjen.

## Brukerstøtte

Hvis du fortsatt trenger hjelp, ta kontakt via OneUptime-dashbordet eller opprett en sak i [GitHub-repositoriet vårt](https://github.com/OneUptime/oneuptime).
