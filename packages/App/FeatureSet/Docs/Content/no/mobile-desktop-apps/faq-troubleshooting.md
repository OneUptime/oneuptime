# Vanlige spørsmål og feilsøking

Svar på vanlige spørsmål om OneUptimes mobil- og skrivebordsapper, og løsninger på det som oftest går galt: innlogging, varsler som ikke kommer frem, og en telefon som må registreres på nytt.

:::cards
- [Spørsmål om mobilappen](#spørsmål-om-mobilappen): Enheter, prosjekter, selvdrift og sikkerhet.
- [Spørsmål om skrivebordsappen](#spørsmål-om-skrivebordsappen): Hva skrivebordsappen er, og hva den ikke kan.
- [Når en telefon må registreres på nytt](#når-en-telefon-må-registreres-på-nytt): Hvorfor en telefon slutter å få varsler, og hvordan den kommer tilbake.
- [Feilsøking](#feilsøking): Problemer med innlogging, varsler og installasjon.
:::

## Spørsmål om mobilappen

:::details Er appen gratis?
Ja. OneUptime On-Call er gratis i App Store, på Google Play og som APK på GitHub. Du logger inn med OneUptime-kontoen din.
:::

:::details Hvilke telefoner og nettbrett kjører den på?
iPhone og iPad med iOS eller iPadOS 16.4 eller nyere, og Android-telefoner og -nettbrett med Android 7.0 eller nyere.
:::

:::details Fungerer den med et selvdriftet OneUptime?
Ja. Skriv inn `https://`-adressen til ditt OneUptime når appen starter, eller trykk på **Change Server** på innloggingsskjermen. Som standard sender serveren din varsler til telefoner gjennom OneUptimes push-relé, så den trenger ingen konto hos Apple, Google eller Expo: se [Push-varsler](/docs/self-hosted/push-notifications).
:::

:::details Kan jeg bruke den med flere prosjekter?
Ja. Appen registrerer telefonen i hvert prosjekt du er medlem av, så hvert prosjekt kan varsle deg. Den viser ett prosjekt om gangen: trykk på prosjektets navn øverst på en skjerm for å bytte.
:::

:::details Kan jeg logge inn på mer enn én telefon?
Ja. Hver telefon eller hvert nettbrett er en egen push-enhet, med egne vaktregler og egen innstilling for kritiske varsler.
:::

:::details Hva kan jeg gjøre i appen?
- **Home**: hva som trenger oppmerksomhet i prosjektet: aktive hendelser og varsler, åpne sikkerhetssaker hvis rollen din gir deg tilgang til dem, monitorer med problemer og grupperte hendelser.
- **Monitors**: alle monitorer, filtrert etter tilstand, med detaljene sine.
- **Inbox**: hendelser og varsler, og episodene som grupperer dem. Åpne en for å bruke **Acknowledge**, **Resolve** eller **Add Note**. Gir rollen din deg tilgang til prosjektets sikkerhetssaker, viser **Security** de åpne: åpne en for å bruke **Approve** eller **Reject** på et playbook-steg som venter på godkjenning, ta saken med **Assign to me** eller bruke **Close case**.
- **On-Call**: om du har vakt og til når, hvem andre som har det, varslene som er sendt til deg, og **Cover for me**, som gir varslene dine videre til en kollega en stund.
- **Settings**: prosjektene dine og single sign-on, utseendet, kritiske varsler og alarmlyden, **Biometrics Login**, vaktkalenderfeeden din og **Log Out**.

Alt annet finner du i dashbordet.
:::

:::details Kan jeg bekrefte et varsel fra varslingen?
Nei. Trykk på varslingen: appen åpner hendelsen, varselet, episoden eller sikkerhetssaken den gjelder, i riktig prosjekt, og du bekrefter der. Er appen låst, eller er du logget ut, åpner den varselet så snart du er inne.
:::

:::details Er innloggingen min trygg på telefonen?
Appen snakker med ditt OneUptime bare over HTTPS. Innloggingen din lagres i appens eget lager på telefonen, og **Log Out** sletter den og logger også ut økten på serveren. Slå på **Biometrics Login**, så spør appen om ansiktet ditt, fingeravtrykket ditt eller koden din hver gang den starter.
:::

:::details Fungerer appen uten nett?
Nei. Uten tilkobling viser den **No internet connection** øverst på skjermen og fortsetter så snart tilkoblingen er tilbake.
:::

## Spørsmål om skrivebordsappen

:::details Hva er skrivebordsappen?
OneUptime-dashbordet, installert fra nettleseren som en app: eget vindu, et ikon i Start-menyen, i Dock eller i appstarteren, og varsler. Den gjør alt dashbordet gjør, fordi den er dashbordet.
:::

:::details Hvorfor ligger den ikke i en appbutikk?
Det trenger den ikke. Appen henter dashbordet fra ditt OneUptime hver gang den åpnes, så den er alltid versjonen ditt OneUptime kjører, på Windows, macOS og Linux likt, uten noe å oppdatere.
:::

:::details Kan den vekke meg som telefonen?
Nei. Nettlesere kan ikke overstyre Ikke forstyrr eller et Fokus, så et skrivebordsvarsel er bare så høyt som datamaskinen tillater. Bruk mobilappen med kritiske varsler for varsler som må vekke deg.
:::

:::details Fungerer den uten nett?
Nei. Den trenger en tilkobling til ditt OneUptime, som dashbordet i en nettleserfane.
:::

## Når en telefon må registreres på nytt

OneUptime sender en telefons varsler gjennom Expo, som gir dem videre til Apple eller Google. Når Expo sier at telefonen ikke lenger kan nås, slutter OneUptime å sende til den, til appen registrerer den på nytt.

```mermaid title="Slik slutter en telefon å få varsler, og slik kommer den tilbake"
flowchart TB
    Registered["Telefonen er registrert,<br/>og varsler når den"]
    Gone["Expo melder den borte:<br/>et push avvises,<br/>eller kvitteringen sier det<br/>rundt 15 minutter senere"]
    Marked["OneUptime merker<br/>den Mottar ikke varsler<br/>og slutter å sende;<br/>reglene blir værende"]
    Open["Du åpner appen<br/>mens du er logget inn"]
    Renewed["Appen registrerer<br/>seg på nytt, fornyer<br/>push-tokenet, og<br/>varsler når den igjen"]
    Registered --> Gone --> Marked --> Open --> Renewed
```

Expo melder en telefon borte når appen er fjernet fra den, eller når push-tokenet ikke lenger er gyldig. Telefonen slettes ikke: **Brukerinnstillinger → Varselmetoder** viser den på fanen **Push Notifications** som **Mottar ikke varsler**, og vakttidslinjen for et varsel som ikke nådde den, sier hvorfor. De andre telefonene og varselmetodene dine varsles som vanlig.

Appen registrerer telefonen hver gang den starter, når du logger inn, og når du går tilbake til den, høyst én gang hvert femte minutt. Registreringen ber Expo om push-tokenet på nytt, noe som fornyer det, og telefonen får varsler igjen med reglene den hadde.

| Hva som skjedde | Hva du gjør | Hva OneUptime gjør |
| --- | --- | --- |
| Appen er fortsatt installert | Åpne den mens du er logget inn | Telefonen får varsler igjen, med reglene sine |
| Du installerte appen på nytt på en iPhone eller iPad | Installer den, og logg inn | Som regel kommer den samme oppføringen tilbake, med reglene sine |
| Du installerte appen på nytt på Android | Installer den, logg inn, og slett den gamle oppføringen | En ny oppføring med standardreglene; den gamle forblir merket |
| En ny telefon, satt opp fra en sikkerhetskopi av den gamle | Åpne appen på den nye telefonen | Er den gamle telefonens oppføring merket, overtar den nye den, med reglene sine; ellers får den nye telefonen en egen oppføring |
| En ny telefon, satt opp fra bunnen | Logg inn, og slett den gamle oppføringen | En ny oppføring med standardreglene |
| Du logget ut av appen | Logg inn igjen | Utloggingen fjernet telefonen og reglene; den kommer tilbake med standardreglene |

En nettleser kan også slutte å få varsler, når push-abonnementet utløper. Dashbordet fornyer det når det kan; forblir nettleseren merket, registrerer du den på nytt med **Registrer enhet** i den nettleseren.

## Feilsøking

### Innlogging

:::details «Could not connect to the server»
Appen nådde ikke `https://<your-oneuptime>/api/status`. Sjekk adressen, inkludert `https://`: appen kobler ikke til over vanlig HTTP. Er ditt OneUptime på et privat nettverk, kobler du telefonen til det først, for eksempel via VPN. Åpnet i telefonens nettleser viser den adressen `{"status":"ok"}` når telefonen når OneUptime.
:::

:::details «No SSO configuration found for the email»
Ingen av prosjektene den e-postadressen er medlem av, har satt opp single sign-on, eller e-postadressen har ingen konto på dette OneUptime. Sjekk e-postadressen, eller logg inn med passordet ditt. Leverandører som administratoren din har satt opp for hele installasjonen, står foran e-postfeltet.
:::

:::details En sikkerhetsnøkkel er din eneste andre faktor
Appen kan ikke bruke en sikkerhetsnøkkel. Logg inn med en av reservekodene dine, eller legg til en autentiseringsapp på kontoen din i dashbordet: se [Slå på tofaktorautentisering](/docs/introduction/your-account#slå-på-totrinnsbekreftelse).
:::

:::details Innlogging med tilgangsnøkkel mislykkes
Tilgangsnøkler krever at adressen til ditt OneUptime begynner med `https://`, og en tilgangsnøkkel du har lagt til for dette OneUptime: se [Legg til en tilgangsnøkkel](/docs/introduction/your-account#legg-til-en-passnøkkel). Trykk på **Change Server** på innloggingsskjermen for å bruke en annen server.
:::

### Varsler

:::details Ingen varsler på telefonen
- Sjekk at telefonen tillater varsler fra OneUptime On-Call, og at Ikke forstyrr eller et Fokus ikke holder dem tilbake.
- Sjekk under **Brukerinnstillinger → Varselmetoder**, på fanen **Push Notifications**, at telefonen står i listen, og send den et **Testvarsel**.
- Er den merket **Mottar ikke varsler**, åpner du appen mens du er logget inn: se [Når en telefon må registreres på nytt](#når-en-telefon-må-registreres-på-nytt).
- Sjekk vaktreglene dine under **Brukerinnstillinger → Vaktregler**: de bestemmer hvilke varsler som når hvilken metode.
- På et selvdriftet OneUptime sjekker du at serveren når push-reléet sitt: se [Push-varsler](/docs/self-hosted/push-notifications#nettverkstilgang).
:::

:::details Varsler kommer for sent på Android
Sett appens batteribruk til **Ubegrenset** i Android-innstillingene for OneUptime On-Call, og hold appen utenfor enhver batterisparingsliste: se [Unngå at varsler kommer for sent](/docs/mobile-desktop-apps/android-installation#unngå-at-varsler-kommer-for-sent).
:::

:::details Kritiske varsler ringer ikke gjennom lydløs
Åpne **Settings** i appen: linjen under **Critical On-Call Alerts** sier hva som mangler på den telefonen. Sjekk deretter under **Brukerinnstillinger → Vaktregler** at vaktregelen som sendte varselet, er satt til **Kritisk varsel**, ikke **Normal**. Hver telefon har sin egen bryter.
:::

### Skrivebordsapp

:::details Ingen installeringsikon i adresselinjen
Installer fra en dashbordside etter innlogging, over `https://`, i Edge eller Chrome, eller i Safari på macOS Sonoma 14 eller nyere. Vises ikke ikonet, installerer også nettleserens meny appen: se [Windows-installasjon](/docs/mobile-desktop-apps/windows-installation#installer-appen).
:::

:::details Ingen skrivebordsvarsler
Registrer nettleseren under **Brukerinnstillinger → Varselmetoder**, på fanen **Push Notifications**, med **Registrer enhet**, tillat varsler når du blir spurt, og sjekk datamaskinens egne varslingsinnstillinger. Et selvdriftet OneUptime trenger VAPID-nøklene sine for nettleservarsler.
:::

## Få hjelp

Stemmer noe her ikke med det du ser, [åpner du et issue på GitHub](https://github.com/OneUptime/oneuptime/issues) med appens versjon, nederst på skjermen **Settings**, og plattformen du bruker.

## Neste trinn

:::cards
- [Apper – Oversikt](/docs/mobile-desktop-apps/index): Hvilken app du skal bruke, og hvordan appene når OneUptime.
- [Android-installasjon](/docs/mobile-desktop-apps/android-installation): Installer og sett opp appen på Android.
- [iOS-installasjon](/docs/mobile-desktop-apps/ios-installation): Installer og sett opp appen på en iPhone eller iPad.
- [Push-varsler](/docs/self-hosted/push-notifications): Slik sender et selvdriftet OneUptime varsler, og Expos feil.
:::
