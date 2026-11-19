# Din konto

Din konto er den måde, OneUptime kender dig på: den e-mail og adgangskode, du logger ind med, dit navn, din tidszone og dit sprog, og det, der beskytter dit login. Én konto kan høre til mange projekter, og disse indstillinger følger dig ind i hvert af dem. Hvordan OneUptime kontakter dig, og hvornår du bliver tilkaldt, indstilles i hvert projekt under **Brugerindstillinger**.

```mermaid title="Det, der hører til din konto, og det, hvert projekt gemmer for dig"
flowchart TB
    account["Din konto:<br/>login og profil"] --> projectA["Projekt A"]
    account --> projectB["Projekt B"]
    projectA --> settingsA["Brugerindstillinger i A:<br/>hvordan du tilkaldes"]
    projectB --> settingsB["Brugerindstillinger i B:<br/>hvordan du tilkaldes"]
```

:::cards
- [Din profil](#din-profil): Dit navn, din e-mail, din tidszone, dit sprog og dit billede.
- [Log sikkert ind](#log-sikkert-ind): Din adgangskode, login-links, adgangsnøgler og tofaktorgodkendelse.
- [Dine projekter](#dine-projekter): Skift projekt, opret et, og accepter invitationer.
- [Brugerindstillinger](#det-hvert-projekt-gemmer-for-dig): Hvordan OneUptime kontakter dig i hvert projekt.
:::

## Brugermenuen

Klik på dit billede øverst til højre i dashboardet.

| Punkt | Hvad det gør |
| --- | --- |
| **Profil** | Åbner **Brugerprofil**: dit navn, din e-mail, din tidszone, dit sprog, dit billede og sikkerheden ved dit login. |
| **Admin-indstillinger** | Åbner Admin Dashboard. Kun hovedadministratorer på en selvhostet installation ser det. |
| **Tema** | Vælger dashboardets tema: **Lyst**, **Mørkt** eller **System**, som er lyst eller mørkt, alt efter hvordan din enhed er indstillet. |
| **Log ud** | Logger dig ud, med det samme på alle OneUptime-servere. Hvor din administrator har sat det op, logger den dig også ud af din identitetsudbyder. |

**Brugerprofil** har sin egen sidemenu. **Grundlæggende** indeholder **Oversigt** og **Profilbillede**. **Sikkerhed** og **Farezone** er foldet sammen: klik på et afsnits titel for at åbne det.

## Din profil

:::steps
### Åbn din profil

Klik på dit billede øverst til højre, og vælg **Profil**. Siden **Oversigt** åbner på kortet **Grundlæggende oplysninger**: dit navn, din e-mail, din tidszone og dit sprog.

### Rediger dine oplysninger

Klik på **Rediger Bruger**, og ret det, du har brug for:

- **E-mail**: den adresse, du logger ind med. Hvis du ændrer den, bekræfter du den nye adresse igen.
- **Fulde navn**: det navn, dit team ser overalt i OneUptime.
- **Tidszone**: den tidszone, dashboardet viser og læser tider i, og den, der bruges til tiderne i notifikationer til dig.
- **Sprog**: sproget i dashboardet i alle browsere, du logger ind i, og i dine vagttilkald. Ikke valgt: dine tilkald er på engelsk, og dashboardet følger din browser.

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
| **Adgangsnøgler** | Log ind uden adgangskode, med dit fingeraftryk, dit ansigt, din skærmlås eller en sikkerhedsnøgle. |
| **Tofaktorgodkendelse** | Bed om et andet trin efter din adgangskode eller et link sendt på e-mail: en kode fra en app eller en sikkerhedsnøgle. |

### Skift din adgangskode

:::steps
1. Åbn **Sikkerhed → Adgangskodeadministration**.
2. Indtast den nye adgangskode i **Ny adgangskode** og igen i **Bekræft adgangskode**. Den skal være mindst 15 tegn lang og må ikke være forudsigelig, som en almindelig adgangskode eller et gentaget mønster: nogle få ord, der ikke har noget med hinanden at gøre, fungerer godt. Tjeklisten under feltet krydser hvert punkt af, mens du skriver.
3. Klik på **Opdater adgangskode**.
:::

En ny adgangskode logger alle enheder ud af din konto, og ethvert nulstillingslink eller login-link, der allerede er sendt, holder op med at virke.

Alle sider, der angiver en adgangskode, kræver det samme: tilmelding, nulstillingslinket fra **Glemt adgangskode?**, denne side og en serveradministrators **Angiv adgangskode**. En adgangskode, du har angivet før denne regel, virker fortsat, indtil du ændrer den.

### Tilføj en adgangsnøgle

:::steps
1. Åbn **Sikkerhed → Adgangsnøgler**, og klik på **Tilføj adgangsnøgle**.
2. Giv den et navn, du kan genkende, for eksempel din enhed eller din adgangskodeadministrator, og klik på **Opret adgangsnøgle**.
3. Følg din browsers anvisning for at gemme adgangsnøglen.
:::

Næste gang vælger du **Flere måder at logge ind på** → **Log ind med en adgangsnøgle** på loginsiden.

### Log ind med et link sendt på e-mail

Du kan logge ind med et link i stedet for din adgangskode. Der er intet at sætte op.

:::steps
1. Vælg **Flere måder at logge ind på** → **Send mig et login-link** på loginsiden.
2. Indtast din e-mailadresse, og klik på **Send mig et login-link**. Siden viser derefter **Tjek din e-mail**.
3. Åbn linket i e-mailen, og klik på **Log ind**.
:::

Linket virker én gang, i 15 minutter, og et nyere link erstatter det. Du kan åbne det på en anden enhed, og så er du logget ind dér. Hvis du bruger tofaktorgodkendelse, beder OneUptime stadig om dit andet trin.

> [!NOTE]
> Hovedadministratorer på en selvhostet installation kan slå login-links fra med **Lad folk logge ind med et link sendt på e-mail** under **Admin Dashboard > Indstillinger > Godkendelse**. Links, der allerede er sendt, holder så op med at virke. Så længe serveren kræver SSO, tilbyder loginsiden kun SSO.

### Slå tofaktorgodkendelse til

Tofaktorgodkendelse gælder, når du logger ind med din adgangskode eller et link i en e-mail. Den slås først til, når dit andet trin virker, så den beder aldrig om et trin, du ikke har.

:::steps
### Vælg dit andet trin

Åbn **Sikkerhed → Tofaktorgodkendelse** og klik på **Aktivér tofaktorgodkendelse**. Vælg **Godkendelsesapp** eller **Sikkerhedsnøgle**, og klik på **Fortsæt**.

### Opsæt det

For en godkendelsesapp scanner du QR-koden med en app som 1Password, Google Authenticator eller Microsoft Authenticator, indtaster den 6-cifrede kode, den viser, og klikker på **Bekræft og afslut**. En USB- eller NFC-nøgle giver du et navn og følger din browsers vejledning. Tofaktorgodkendelse er derefter slået til, og kortet viser **Aktiveret**. Fra dit næste login med adgangskode eller et link i en e-mail beder OneUptime om dit andet trin.

### Gem dine backupkoder

Første gang du tilføjer en app, en nøgle eller en adgangsnøgle, viser OneUptime **Dine backupkoder**. Hver kode logger dig ind én gang, hvis du mister din app eller nøgle. Kopiér eller download dem, sæt flueben ved, at du har gemt dem, og klik på **Færdig**.
:::

Har du allerede en app under **Godkendelsesapps** eller en nøgle under **Sikkerhedsnøgler**, beder **Aktivér tofaktorgodkendelse** dig bare om at bekræfte. Mens den er slået til, kan din sidste app, nøgle eller adgangsnøgle ikke fjernes: Tilføj først en anden, eller slå tofaktorgodkendelse fra. Viser kortet **Opsætning mangler**, er tofaktorgodkendelse slået til, uden at noget er opsat, ofte fordi en administrator har krævet det: Klik på **Afslut opsætningen**, ellers bliver du bedt om det ved dit næste login.

> [!TIP]
> Er du ved at løbe tør for backupkoder? **Generér nye koder** på samme side giver dig et nyt sæt, og de gamle koder holder op med at virke med det samme.

### Når din organisation styrer dit login

På en server, der kræver single sign-on, logger du kun ind gennem din organisations identitetsudbyder, fx Okta eller Microsoft Entra ID, og OneUptime opsætter ingen adgangskode, adgangsnøgle eller tofaktorgodkendelse for dig. **Brugerprofil** har så ingen sektion **Sikkerhed**, og dens **Oversigt** nævner din udbyder under **Single sign-on**. Skift din adgangskode og dit andet trin hos din identitetsudbyder. Det, du har opsat før, forbliver gemt: Det virker først igen, hvis serveren holder op med at kræve single sign-on. Hovedadministratorer beholder deres egne indstillinger under **Sikkerhed**.

## Dine projekter

Du kan høre til så mange projekter, du vil. Projektvælgeren øverst til venstre i dashboardet viser dem: vælg et for at skifte.

- **Opret et projekt**: åbn projektvælgeren, og klik på **Opret nyt projekt**. På en selvhostet installation kan administratoren forbeholde oprettelse af projekter til administratorer.
- **Accepter en invitation**: når nogen inviterer dig, viser klokken øverst til højre den ventende invitation og åbner **Projektinvitationer**. Der vælger du **Accepter** eller **Afvis**.
- **Forlad et projekt**: bed en, der administrerer projektets brugere, om at fjerne dig med **Fjern fra projekt** på projektets side **Brugere**.

## Det, hvert projekt gemmer for dig

**Brugerindstillinger**, til højre i bjælken under topbjælken, er kun dine, og hvert projekt har sine egne. Åbn dem i hvert projekt, hvor du har vagt. De åbner på **Opsætningstjekliste**, så længe noget mangler at blive sat op, og på **Notifikationsmetoder**, når intet væsentligt mangler.

| Side | Hvad den bruges til | Læs mere |
| --- | --- | --- |
| **Opsætningstjekliste** | Fører dig gennem alt nedenfor og viser, hvad der mangler. | |
| **Notifikationsmetoder** | De e-mails, telefonnumre, apps og webhooks, OneUptime kan kontakte dig på. Din login-e-mail tilføjes for dig. | |
| **Sådan når man mig** | Hvilken metode der bruges, og efter hvor lang tid, når en vagtpolitik tilkalder dig. | [Eskaleringsregler](/docs/on-call/escalation-rules) |
| **Notifikationsindstillinger** | Hvilke opdateringer om hændelser, advarsler, monitorer og meget mere du får, og på hvilken kanal. | |
| **E-mailindstillinger** | Hvor mange e-mails du får: én ad gangen eller samlet. | [Notifikationsoversigt](/docs/emails/notification-rollup) |
| **Vagtlogs** | Hvert tilkald, der er sendt til dig, og hvad der skete med det. | |
| **Indgående telefonnumre** | Det nummer, en politik for indgående opkald ringer til dig på. | [Politik for indgående opkald](/docs/on-call/incoming-call-policy) |
| **Kalenderfeed** | Dine vagter i Google Calendar, Apple Calendar eller Outlook. | [Kalenderfeeds](/docs/on-call/calendar-feeds) |

## Sprog og tema

Dit tema gemmes i din browser, så indstil det igen i en anden browser eller på en anden enhed. Dit sprog gemmes på din konto, så snart du vælger det, og alle browsere, du logger ind i, starter på det. De bevares, når du logger ud, så på en delt computer starter den næste person med dine indstillinger.

- **Sprog**: dashboardet starter på din browsers sprog. Brug sprogmenuen nederst på hver side for at skifte. Dit valg gemmes på din konto, ligesom **Sprog** på din profil, og OneUptime skriver dine vagttilkald på det. Se [Sproget i dine tilkald](/docs/notifications/index#sproget-i-dine-tilkald). Denne dokumentation har sin egen sprogmenu øverst.
- **Tema**: vælg **Lyst**, **Mørkt** eller **System** i brugermenuen. **System** er lyst eller mørkt, alt efter hvordan din enhed er indstillet, og skifter med den; alle browsere starter med det. Login-siderne bruger samme tema.

## Slet din konto

Åbn **Farezone → Slet konto**. Du kan kun slette din konto, når du ikke er med i noget projekt: siden viser de projekter, du stadig er med i. Forlad dem først, klik så på **Slet konto**, og bekræft. Sletning af din konto er permanent og kan ikke fortrydes.

## Fejlfinding

:::details Jeg har ikke fået e-mailen til at bekræfte min adresse
Logger du ind igen, sendes et nyt link: tjek også din spam-mappe. Kan du ikke logge ind, så brug **Glemt adgangskode?** på loginsiden. Nulstillingslinket bekræfter også din adresse.
:::

:::details Jeg har mistet min godkendelsesapp
Ved det andet trin af login vælger du **Mistet adgangen til din autentifikator-app?** og indtaster en af dine backupkoder. Åbn derefter **Sikkerhed → Tofaktorgodkendelse**, og tilføj din nye app. Uden backupkoder beder du en administrator af din OneUptime-installation om at nulstille tofaktorgodkendelsen på din konto.
:::

:::details Login beder mig vente, før jeg prøver en ny kode
Efter fem forkerte koder i træk venter hver næste kode, før den bliver tjekket: et minut, så to, så fire og så videre, op til en time. OneUptime tæller forkerte koder for din konto, uanset hvor de indtastes, sender dig en e-mail, når ventetiderne begynder, og tæller forfra, når du indtaster en rigtig kode. Vent og prøv igen, log ind med en sikkerhedsnøgle, eller vælg **Mistet adgangen til din autentifikator-app?** og indtast en backupkode. Hvis det ikke var dig, der indtastede de koder, kender nogen din adgangskode eller kan læse din e-mail, og den e-mail, OneUptime har sendt dig, fortæller hvilket af delene. Hvis de kan læse din e-mail, skal du først ændre adgangskoden til din e-mailkonto og fjerne enhver videresendelse, du ikke selv har sat op: en ny OneUptime-adgangskode alene forhindrer dem ikke i at bede om et nyt login-link. Nulstil derefter din adgangskode med **Glemt adgangskode?** på loginsiden, hvilket afslutter ventetiden og ugyldiggør ethvert login-link, der allerede er sendt.
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
