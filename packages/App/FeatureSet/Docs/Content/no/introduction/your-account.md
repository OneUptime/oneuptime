# Kontoen din

Kontoen din er hvordan OneUptime kjenner deg: e-posten og passordet du logger inn med, navnet, tidssonen og språket ditt, og det som beskytter innloggingen din. Én konto kan høre til mange prosjekter, og disse innstillingene følger deg inn i hvert av dem. Hvordan OneUptime når deg, og når du varsles, stiller du inn i hvert prosjekt under **Brukerinnstillinger**.

```mermaid title="Det som hører til kontoen din, og det hvert prosjekt tar vare på for deg"
flowchart TB
    account["Kontoen din:<br/>innlogging og profil"] --> projectA["Prosjekt A"]
    account --> projectB["Prosjekt B"]
    projectA --> settingsA["Brukerinnstillinger i A:<br/>hvordan du varsles"]
    projectB --> settingsB["Brukerinnstillinger i B:<br/>hvordan du varsles"]
```

:::cards
- [Profilen din](#profilen-din): Navnet, e-posten, tidssonen, språket og bildet ditt.
- [Logg inn trygt](#logg-inn-trygt): Passordet ditt, innloggingslenker, passnøkler og totrinnsbekreftelse.
- [Prosjektene dine](#prosjektene-dine): Bytt prosjekt, opprett et, og godta invitasjoner.
- [Brukerinnstillinger](#det-hvert-prosjekt-tar-vare-på-for-deg): Hvordan OneUptime når deg i hvert prosjekt.
:::

## Brukermenyen

Klikk på bildet ditt øverst til høyre i dashbordet.

| Punkt | Hva det gjør |
| --- | --- |
| **Profil** | Åpner **Brukerprofil**: navnet, e-posten, tidssonen, språket og bildet ditt, og sikkerheten rundt innloggingen. |
| **Admin-innstillinger** | Åpner Admin Dashboard. Bare hovedadministratorer på en selvhostet installasjon ser det. |
| **Tema** | Velger dashbordets tema: **Lyst**, **Mørkt** eller **System**, som er lyst eller mørkt etter hvordan enheten din er stilt inn. |
| **Logg ut** | Logger deg ut. |

**Brukerprofil** har sin egen sidemeny. **Grunnleggende** inneholder **Oversikt** og **Profilbilde**. **Sikkerhet** og **Faresone** er slått sammen: klikk på tittelen til en del for å åpne den.

## Profilen din

:::steps
### Åpne profilen din

Klikk på bildet ditt øverst til høyre, og velg **Profil**. Siden **Oversikt** åpnes på kortet **Grunnleggende informasjon**: navnet, e-posten, tidssonen og språket ditt.

### Rediger opplysningene dine

Klikk på **Rediger Bruker**, og endre det du trenger:

- **E-post**: adressen du logger inn med. Endrer du den, bekrefter du den nye adressen på nytt.
- **Fullt navn**: navnet teamet ditt ser overalt i OneUptime.
- **Tidssone**: tidssonen dashbordet viser og leser tider i, og den som brukes for tidene i varsler til deg.
- **Språk**: språket i dashbordet i alle nettlesere du logger inn i, og i vakttilkallingene dine. Ikke valgt: tilkallingene er på engelsk, og dashbordet følger nettleseren din.

Klikk på **Lagre endringer**.

### Legg til et bilde

Velg **Profilbilde**, klikk på **Update Profile Picture**, og last opp et bilde. Det vises i brukermenyen din og ved siden av navnet ditt i lister over personer.
:::

> [!NOTE]
> Første gang du logger inn i en nettleser, lagrer OneUptime nettleserens tidssone på profilen din. Logger du senere inn der nettleseren har en annen tidssone, spør dashbordet om det skal **Oppdater tidssone**. Lukk spørsmålet, så spør det ikke igjen for den tidssonen.

## Logg inn trygt

Utvid **Sikkerhet** i sidemenyen til **Brukerprofil**. Delen har tre sider.

| Side | Hva den brukes til |
| --- | --- |
| **Passordadministrasjon** | Angi et nytt passord. |
| **Passkeys** | Logg inn uten passord, med fingeravtrykk, ansikt, skjermlås eller en sikkerhetsnøkkel. |
| **Two-factor authentication** | Be om et andre steg etter passordet eller en lenke på e-post: en kode fra en app, eller en sikkerhetsnøkkel. |

### Bytt passord

:::steps
1. Åpne **Sikkerhet → Passordadministrasjon**.
2. Skriv inn det nye passordet i **Passord** og igjen i **Bekreft passord**. Det må være minst 6 tegn langt.
3. Klikk på **Oppdater passord**.
:::

Et nytt passord logger alle enheter ut av kontoen din, og enhver tilbakestillingslenke eller innloggingslenke som allerede er sendt, slutter å virke.

### Legg til en passnøkkel

:::steps
1. Åpne **Sikkerhet → Passkeys**, og klikk på **Add Passkey**.
2. Gi den et navn du kjenner igjen, for eksempel enheten eller passordbehandleren din, og klikk på **Create Passkey**.
3. Følg nettleserens melding for å lagre passnøkkelen.
:::

Neste gang velger du **Logg inn med en passnøkkel** på innloggingssiden.

### Logg inn med en lenke på e-post

Du kan logge inn med en lenke i stedet for passordet. Det er ingenting å sette opp.

:::steps
1. Velg **Send meg en innloggingslenke** på innloggingssiden.
2. Skriv inn e-postadressen din, og klikk på **Send meg en innloggingslenke**. Siden viser deretter **Sjekk e-posten din**.
3. Åpne lenken i e-posten, og klikk på **Logg inn**.
:::

Lenken virker én gang, i 15 minutter, og en nyere lenke erstatter den. Du kan åpne den på en annen enhet, og da er du logget inn der. Hvis du bruker totrinnsbekreftelse, ber OneUptime fortsatt om det andre steget ditt.

> [!NOTE]
> Hovedadministratorer på en selvhostet installasjon kan slå av innloggingslenker med **La folk logge inn med en lenke på e-post**, under **Admin Dashboard > Innstillinger > Autentisering**. Lenker som allerede er sendt, slutter da å virke. Så lenge serveren krever SSO, tilbyr innloggingssiden bare SSO.

### Slå på totrinnsbekreftelse

Totrinnsbekreftelse gjelder når du logger inn med passordet ditt eller en lenke på e-post. Legg først til et andre steg, og slå den deretter på.

:::steps
### Legg til en autentiseringsapp

Åpne **Sikkerhet → Two-factor authentication**. Under **Authenticator apps** legger du til en app og gir den et navn. Skann QR-koden med en app som 1Password, Google Authenticator eller Microsoft Authenticator, skriv inn den sekssifrede koden den viser, og klikk på **Verify and finish**. Vil du heller bruke en USB- eller NFC-nøkkel, legger du den til under **Security keys**.

### Ta vare på reservekodene dine

Første gang du legger til en app, en nøkkel eller en passnøkkel, viser OneUptime **Your backup codes**. Hver kode logger deg inn én gang hvis du mister appen eller nøkkelen. Kopier eller last dem ned, kryss av for at du har tatt vare på dem, og klikk på **Ferdig**.

### Slå den på

Øverst på siden klikker du på **Enable two-factor authentication** og bekrefter. Kortet viser nå **Aktivert**. Fra neste innlogging med passord eller en lenke på e-post ber OneUptime om det andre steget ditt.
:::

> [!TIP]
> Holder reservekodene på å ta slutt? **Regenerate codes** på samme side gir deg et nytt sett, og de gamle kodene slutter å virke med en gang.

## Prosjektene dine

Du kan høre til så mange prosjekter du vil. Prosjektvelgeren øverst til venstre i dashbordet viser dem: velg ett for å bytte.

- **Opprett et prosjekt**: åpne prosjektvelgeren, og klikk på **Opprett nytt prosjekt**. På en selvhostet installasjon kan administratoren forbeholde oppretting av prosjekter for administratorer.
- **Godta en invitasjon**: når noen inviterer deg, viser klokken øverst til høyre den ventende invitasjonen og åpner **Prosjektinvitasjoner**. Der velger du **Godta** eller **Avvis**.
- **Forlat et prosjekt**: be noen som administrerer prosjektets brukere om å fjerne deg, med **Fjern fra prosjekt** på prosjektets side **Brukere**.

## Det hvert prosjekt tar vare på for deg

**Brukerinnstillinger**, til høyre i linjen under topplinjen, er bare dine, og hvert prosjekt har sine egne. Åpne dem i hvert prosjekt der du har vakt.

| Side | Hva den brukes til | Les mer |
| --- | --- | --- |
| **Oppsettsjekkliste** | Leder deg gjennom alt nedenfor, og viser hva som gjenstår. | |
| **Varselmetoder** | E-postene, telefonnumrene, appene og webhookene OneUptime kan nå deg på. E-posten du logger inn med, legges til for deg. | |
| **Slik når man meg** | Hvilken metode som brukes, og etter hvor lang tid, når en vaktpolicy varsler deg. | [Eskaleringsregler](/docs/on-call/escalation-rules) |
| **Varselinnstillinger** | Hvilke oppdateringer om hendelser, varsler, monitorer og mer du får, og på hvilken kanal. | |
| **E-postinnstillinger** | Hvor mange e-poster du får: én om gangen, eller samlet. | [Varseloppsummering](/docs/emails/notification-rollup) |
| **Vaktlogger** | Hvert varsel sendt til deg, og hva som skjedde med det. | |
| **Innkommende telefonnumre** | Nummeret en policy for innkommende anrop ringer deg på. | [Policy for innkommende anrop](/docs/on-call/incoming-call-policy) |
| **Kalenderfeed** | Vaktene dine i Google Calendar, Apple Calendar eller Outlook. | [Kalenderfeeder](/docs/on-call/calendar-feeds) |

## Språk og tema

Temaet ditt lagres i nettleseren din, så still det inn på nytt i en annen nettleser eller på en annen enhet. Språket ditt lagres på kontoen så snart du velger det, og alle nettlesere du logger inn i, starter på det. De beholdes når du logger ut, så på en delt datamaskin starter neste person med innstillingene dine.

- **Språk**: dashbordet starter på nettleserens språk. Bruk språkmenyen nederst på hver side for å bytte. Valget ditt lagres på kontoen, som **Språk** på profilen din, og OneUptime skriver vakttilkallingene dine på det. Se [Språket i tilkallingene dine](/docs/notifications/index#språket-i-tilkallingene-dine). Denne dokumentasjonen har sin egen språkmeny øverst.
- **Tema**: velg **Lyst**, **Mørkt** eller **System** i brukermenyen. **System** er lyst eller mørkt etter hvordan enheten din er stilt inn, og skifter med den; alle nettlesere starter med det. Påloggingssidene bruker samme tema.

## Slett kontoen din

Åpne **Faresone → Slett konto**. Du kan bare slette kontoen når du ikke er med i noe prosjekt: siden viser prosjektene du fortsatt er med i. Forlat dem først, klikk så på **Slett konto**, og bekreft. Sletting av kontoen er permanent og kan ikke angres.

## Feilsøking

:::details Jeg fikk ikke e-posten for å bekrefte adressen min
Logger du inn på nytt, sendes en ny lenke: sjekk også søppelpostmappen. Kan du ikke logge inn, bruk **Glemt passord?** på innloggingssiden. Tilbakestillingslenken bekrefter også adressen din.
:::

:::details Jeg har mistet autentiseringsappen min
Ved det andre steget av innloggingen velger du **Mistet tilgangen til autentiseringsappen din?** og skriver inn en av reservekodene dine. Åpne deretter **Sikkerhet → Two-factor authentication**, og legg til den nye appen. Uten reservekoder ber du en administrator av OneUptime-installasjonen din om å tilbakestille totrinnsbekreftelsen på kontoen din.
:::

:::details Innloggingen ber meg vente før jeg prøver en ny kode
Etter fem feil koder på rad venter hver neste kode før den blir sjekket: ett minutt, så to, så fire og så videre, opptil en time. OneUptime teller feil koder for kontoen din uansett hvor de skrives inn, sender deg en e-post når ventetidene begynner, og begynner å telle på nytt når du skriver inn en riktig kode. Vent og prøv igjen, logg inn med en sikkerhetsnøkkel, eller velg **Mistet tilgangen til autentiseringsappen din?** og skriv inn en reservekode. Hvis det ikke var du som skrev inn de kodene, kjenner noen passordet ditt eller kan lese e-posten din, og e-posten OneUptime har sendt deg, sier hvilket av dem. Hvis de kan lese e-posten din, må du først endre passordet til e-postkontoen din og fjerne all videresending du ikke har satt opp selv: et nytt OneUptime-passord alene hindrer dem ikke i å be om en ny innloggingslenke. Tilbakestill deretter passordet ditt med **Glemt passord?** på innloggingssiden, som avslutter ventetiden og gjør enhver innloggingslenke som allerede er sendt, ugyldig.
:::

:::details Tidene i dashbordet er en time feil
Dashbordet viser tider i **Tidssone** fra profilen din, ikke i datamaskinens. Sjekk den under **Brukerprofil → Oversikt**.
:::

## Neste steg

:::cards
- [Startside og snarveier](/docs/introduction/home): Finn frem i dashbordet.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Hvordan en vaktpolicy varsler deg.
- [Brukere, team og tillatelser](/docs/permissions/index): Hva som avgjør hva du kan gjøre i et prosjekt.
- [SSO](/docs/identity/sso): Logg inn gjennom identitetsleverandøren til bedriften din.
:::
