# Din konto

Din konto er den måde, OneUptime kender dig på: den e-mail og adgangskode, du logger ind med, dit navn og din tidszone, og det, der beskytter dit login. Én konto kan høre til mange projekter, og disse indstillinger følger dig ind i hvert af dem. Hvordan OneUptime kontakter dig, og hvornår du bliver tilkaldt, indstilles i hvert projekt under **Brugerindstillinger**.

```mermaid title="Det, der hører til din konto, og det, hvert projekt gemmer for dig"
flowchart TB
    account["Din konto:<br/>login og profil"] --> projectA["Projekt A"]
    account --> projectB["Projekt B"]
    projectA --> settingsA["Brugerindstillinger i A:<br/>hvordan du tilkaldes"]
    projectB --> settingsB["Brugerindstillinger i B:<br/>hvordan du tilkaldes"]
```

:::cards
- [Din profil](#din-profil): Dit navn, din e-mail, din tidszone og dit billede.
- [Log sikkert ind](#log-sikkert-ind): Din adgangskode, adgangsnøgler og totrinsgodkendelse.
- [Dine projekter](#dine-projekter): Skift projekt, opret et, og accepter invitationer.
- [Brugerindstillinger](#det-hvert-projekt-gemmer-for-dig): Hvordan OneUptime kontakter dig i hvert projekt.
:::

## Brugermenuen

Klik på dit billede øverst til højre i dashboardet.

| Punkt | Hvad det gør |
| --- | --- |
| **Profil** | Åbner **Brugerprofil**: dit navn, din e-mail, din tidszone, dit billede og sikkerheden ved dit login. |
| **Admin-indstillinger** | Åbner Admin Dashboard. Kun hovedadministratorer på en selvhostet installation ser det. |
| **Mørkt tema** | Skifter dashboardet til dets mørke tema. I det mørke tema hedder punktet **Lyst tema**. |
| **Log ud** | Logger dig ud. |

**Brugerprofil** har sin egen sidemenu. **Grundlæggende** indeholder **Oversigt** og **Profilbillede**. **Sikkerhed** og **Farezone** er foldet sammen: klik på et afsnits titel for at åbne det.

## Din profil

:::steps
### Åbn din profil

Klik på dit billede øverst til højre, og vælg **Profil**. Siden **Oversigt** åbner på kortet **Grundlæggende oplysninger**: dit navn, din e-mail og din tidszone.

### Rediger dine oplysninger

Klik på **Rediger Bruger**, og ret det, du har brug for:

- **E-mail**: den adresse, du logger ind med. Hvis du ændrer den, bekræfter du den nye adresse igen.
- **Fulde navn**: det navn, dit team ser overalt i OneUptime.
- **Tidszone**: den tidszone, dashboardet viser og læser tider i, og den, der bruges til tiderne i notifikationer til dig.

Klik på **Gem ændringer**.

### Tilføj et billede

Vælg **Profilbillede**, klik på **Update Profile Picture**, og upload et billede. Det vises i din brugermenu og ved siden af dit navn i lister over personer.
:::

> [!NOTE]
> Første gang du logger ind i en browser, gemmer OneUptime browserens tidszone på din profil. Logger du senere ind, hvor browseren har en anden tidszone, spørger dashboardet, om det skal **Opdater tidszone**. Luk spørgsmålet, så spørger det ikke igen for den tidszone.

## Log sikkert ind

Fold **Sikkerhed** ud i sidemenuen i **Brugerprofil**. Afsnittet har tre sider.

| Side | Hvad den bruges til |
| --- | --- |
| **Adgangskodeadministration** | Sæt en ny adgangskode. |
| **Passkeys** | Log ind uden adgangskode, med dit fingeraftryk, dit ansigt, din skærmlås eller en sikkerhedsnøgle. |
| **Two-factor authentication** | Bed om et andet trin efter din adgangskode: en kode fra en app eller en sikkerhedsnøgle. |

### Skift din adgangskode

:::steps
1. Åbn **Sikkerhed → Adgangskodeadministration**.
2. Indtast den nye adgangskode i **Adgangskode** og igen i **Bekræft adgangskode**. Den skal være mindst 6 tegn lang.
3. Klik på **Opdater adgangskode**.
:::

### Tilføj en adgangsnøgle

:::steps
1. Åbn **Sikkerhed → Passkeys**, og klik på **Add Passkey**.
2. Giv den et navn, du kan genkende, for eksempel din enhed eller din adgangskodeadministrator, og klik på **Create Passkey**.
3. Følg din browsers anvisning for at gemme adgangsnøglen.
:::

Næste gang vælger du **Log ind med en adgangsnøgle** på loginsiden.

### Slå totrinsgodkendelse til

Totrinsgodkendelse gælder, når du logger ind med din adgangskode. Tilføj først et andet trin, og slå den så til.

:::steps
### Tilføj en godkendelsesapp

Åbn **Sikkerhed → Two-factor authentication**. Under **Authenticator apps** tilføjer du en app og giver den et navn. Scan QR-koden med en app som 1Password, Google Authenticator eller Microsoft Authenticator, indtast den sekscifrede kode, den viser, og klik på **Verify and finish**. Vil du hellere bruge en USB- eller NFC-nøgle, tilføjer du den under **Security keys**.

### Gem dine backupkoder

Første gang du tilføjer en app, en nøgle eller en adgangsnøgle, viser OneUptime **Your backup codes**. Hver kode logger dig ind én gang, hvis du mister din app eller nøgle. Kopiér eller download dem, sæt flueben ved, at du har gemt dem, og klik på **Færdig**.

### Slå den til

Øverst på siden klikker du på **Enable two-factor authentication** og bekræfter. Kortet viser nu **Aktiveret**. Fra dit næste login med adgangskode beder OneUptime om dit andet trin.
:::

> [!TIP]
> Er du ved at løbe tør for backupkoder? **Regenerate codes** på samme side giver dig et nyt sæt, og de gamle koder holder op med at virke med det samme.

## Dine projekter

Du kan høre til så mange projekter, du vil. Projektvælgeren øverst til venstre i dashboardet viser dem: vælg et for at skifte.

- **Opret et projekt**: åbn projektvælgeren, og klik på **Opret nyt projekt**. På en selvhostet installation kan administratoren forbeholde oprettelse af projekter til administratorer.
- **Accepter en invitation**: når nogen inviterer dig, viser klokken øverst til højre den ventende invitation og åbner **Projektinvitationer**. Der vælger du **Accepter** eller **Reject**.
- **Forlad et projekt**: bed en, der administrerer projektets brugere, om at fjerne dig med **Fjern fra projekt** på projektets side **Brugere**.

## Det, hvert projekt gemmer for dig

**Brugerindstillinger**, til højre i bjælken under topbjælken, er kun dine, og hvert projekt har sine egne. Åbn dem i hvert projekt, hvor du har vagt.

| Side | Hvad den bruges til | Læs mere |
| --- | --- | --- |
| **Opsætningstjekliste** | Fører dig gennem alt nedenfor og viser, hvad der mangler. | |
| **Notifikationsmetoder** | De e-mails, telefonnumre, apps og webhooks, OneUptime kan kontakte dig på. Din login-e-mail tilføjes for dig. | |
| **Vagtregler** | Hvilken metode der bruges, og efter hvor lang tid, når en vagtpolitik tilkalder dig. | [Eskaleringsregler](/docs/on-call/escalation-rules) |
| **Notifikationsindstillinger** | Hvilke opdateringer om hændelser, advarsler, monitorer og meget mere du får, og på hvilken kanal. | |
| **E-mailindstillinger** | Hvor mange e-mails du får: én ad gangen eller samlet. | [Notifikationsoversigt](/docs/emails/notification-rollup) |
| **Vagtlogs** | Hvert tilkald, der er sendt til dig, og hvad der skete med det. | |
| **Indgående telefonnumre** | Det nummer, en politik for indgående opkald ringer til dig på. | [Politik for indgående opkald](/docs/on-call/incoming-call-policy) |
| **Kalenderfeed** | Dine vagter i Google Calendar, Apple Calendar eller Outlook. | [Kalenderfeeds](/docs/on-call/calendar-feeds) |

## Sprog og tema

Begge gemmes i din browser, ikke på din konto, så indstil dem igen i en anden browser eller på en anden enhed.

- **Sprog**: dashboardet starter på din browsers sprog. Brug sprogmenuen nederst på hver side for at skifte. Denne dokumentation har sin egen sprogmenu øverst.
- **Tema**: vælg **Mørkt tema** i brugermenuen. Dashboardet starter i det lyse tema.

## Slet din konto

Åbn **Farezone → Slet konto**. Du kan kun slette din konto, når du ikke er med i noget projekt: siden viser de projekter, du stadig er med i. Forlad dem først, klik så på **Slet konto**, og bekræft. Sletning af din konto er permanent og kan ikke fortrydes.

## Fejlfinding

:::details Jeg har ikke fået e-mailen til at bekræfte min adresse
Logger du ind igen, sendes et nyt link: tjek også din spam-mappe. Kan du ikke logge ind, så brug **Glemt adgangskode?** på loginsiden. Nulstillingslinket bekræfter også din adresse.
:::

:::details Jeg har mistet min godkendelsesapp
Ved det andet trin af login vælger du **Mistet adgangen til din autentifikator-app?** og indtaster en af dine backupkoder. Åbn derefter **Sikkerhed → Two-factor authentication**, og tilføj din nye app. Uden backupkoder beder du en administrator af din OneUptime-installation om at nulstille totrinsgodkendelsen på din konto.
:::

:::details Tiderne i dashboardet er en time forkerte
Dashboardet viser tider i den **Tidszone**, der står på din profil, ikke din computers. Tjek den under **Brugerprofil → Oversigt**.
:::

## Næste trin

:::cards
- [Startside og genveje](/docs/introduction/home): Find rundt i dashboardet.
- [Eskaleringsregler](/docs/on-call/escalation-rules): Hvordan en vagtpolitik tilkalder dig.
- [Brugere, teams og tilladelser](/docs/permissions/index): Hvad der bestemmer, hvad du må i et projekt.
- [SSO](/docs/identity/sso): Log ind via din virksomheds identitetsudbyder.
:::
