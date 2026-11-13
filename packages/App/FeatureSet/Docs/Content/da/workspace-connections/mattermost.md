# Mattermost

Forbind OneUptime med din Mattermost-server for at slå hændelser, advarsler, episoder, planlagt vedligeholdelse, monitorer og vagtopdateringer op i dine kanaler, give hver hændelse sin egen kanal og lade responders bekræfte, løse, tilføje noter og ændre tilstand uden at forlade Mattermost.

:::cards
- [Forbind Mattermost](#forbind-mattermost): Opret en botkonto til OneUptime, og forbind derefter projektet med dens token.
- [Forbind din egen konto](#forbind-din-egen-mattermost-konto): Knyt din Mattermost-konto til din OneUptime-konto.
- [Notifikationsregler](#notifikationsregler): Bestem, hvilke begivenheder der slås op hvor, og hvilke der får deres egen kanal.
- [Hvem der er i en posts kanal](#hvem-der-er-i-en-posts-kanal): Se, hvem der er i den, deltag, og tilføj personer, fra postens side.
- [Handl fra Mattermost](#handl-på-hændelser-advarsler-og-begivenheder-fra-mattermost): Knapperne i OneUptimes beskeder.
- [Netværk og selvhosting](#netværk-og-selvhosting): Hvad hver server skal kunne nå.
:::

## Sådan virker det

```mermaid title="Fra en begivenhed i OneUptime til en besked i Mattermost"
flowchart TB
    event["En hændelse, advarsel eller begivenhed<br/>oprettes eller ændres"] --> rules{"Notifikationsregler<br/>hvis betingelser passer"}
    rules -->|"En kanal<br/>for hver"| own["En kanal for sig selv,<br/>med dens folk tilføjet, efterhånden som de kommer til"]
    rules -->|"Skriv i eksisterende kanaler"| existing["Dine eksisterende kanaler"]
    own --> message["En besked med knapper"]
    existing --> message
    message -->|"En responder trykker på én"| change["Ændringen sker i OneUptime,<br/>som den responder"]
```

To forbindelser får det til at virke:

- **Projektets forbindelse**, lavet én gang: en botkonto på din Mattermost-server, i de teams, OneUptime slår op i. Den slår beskederne op, opretter kanalerne og tilføjer folk til dem.
- **Hver persons egen forbindelse**: personens Mattermost-konto knyttet til personens OneUptime-konto. Knapper handler som den person, med personens rettigheder i projektet.

Ét Mattermost-team kan være forbundet til mere end ét projekt, for eksempel produktion og staging. En knap handler i projektet for den post, dens besked handler om.

## Før du begynder

- **En rolle, der må forbinde projektet:** **Projektejer**, **Projektadministrator** eller **Projektmedlem**. At afbryde forbindelsen kræver **Projektejer** eller **Projektadministrator**.
- **En Mattermost-server**, hvor du må oprette en botkonto, eller en Mattermost-administrator, der kan oprette en for dig. Både Mattermost Cloud og selvhostet Mattermost virker.
- **Growth-planen på OneUptime Cloud** til notifikationsregler og opsummeringer.

OneUptime behøver ikke at have noget sat op på sin egen server til Mattermost: hvert projekt medbringer sin egen Mattermost-server og botkonto.

## Forbind Mattermost

:::steps
### Opret en botkonto i Mattermost

Åbn **System Console** > **Integrations** > **Bot Accounts** i Mattermost, og sørg for, at **Enable Bot Account Creation** er slået til. Gå derefter til **Integrations** > **Bot Accounts** > **Add Bot Account**, giv den navnet `oneuptime`, og gem. Mattermost viser bottens adgangstoken én gang: kopiér det.

### Føj botten til dit team

Føj botten til hvert team, OneUptime skal slå op i, ligesom du ville tilføje en person: **Main Menu** > **Invite People**, og invitér `@oneuptime`. OneUptime opretter kun kanaler og slår kun op i de teams, botten er medlem af.

### Forbind projektet

Gå i OneUptime til **Projektindstillinger** > **Arbejdsområde** > **Mattermost**, og klik på **Forbind med Mattermost**. Angiv din servers adresse, for eksempel `https://chat.example.com`, og bottens adgangstoken. OneUptime kontrollerer tokenet hos din server, før den gemmer noget. Hvis botten er i mere end ét team, spørger OneUptime, hvilket af dem der er standardteamet: det team, en notifikationsregel, der ikke nævner et team, opretter sine kanaler i. Indtil et workspace er forbundet, indeholder sektionen **Arbejdsområde** i menuerne Hændelser, Advarsler, Planlagt vedligeholdelse, Monitorer og Vagt **Forbind et arbejdsområde**, som også fører hertil.

### Tilføj en notifikationsregel

Gå til **Hændelser** > **Arbejdsområde** > **Mattermost**, og opret en regel. For eksempel en, der opretter en Mattermost-kanal for hver ny hændelse med alle, der arbejder på den. Se [Notifikationsregler](#notifikationsregler).
:::

Bottens adgangstoken gemmes kun på OneUptime-serveren, krypteret sammen med projektets andre hemmeligheder, og vises aldrig igen. Serveradressen, teamene og bottens brugernavn vises for alle i projektet på Mattermost-indstillingssiden.

Et projekt er forbundet med én Mattermost-server. For at flytte det til en anden server skal du først afbryde forbindelsen: **Projektindstillinger** > **Arbejdsområde** > **Mattermost**, derefter **⋯** > **Afbryd forbindelsen til Mattermost**. At afbryde forbindelsen fjerner også tilknytningen af hvert medlems egen Mattermost-konto, deres Mattermost-notifikationsmetoder og de vagtregler, der bruger dem. Dine notifikationsregler og opsummeringer bevares, til du forbinder igen.

## Mere end ét team

OneUptime virker i hvert team på din Mattermost-server, som botten er medlem af:

1. Føj i Mattermost botten til hvert team, der skal bruge OneUptime, ligesom du ville tilføje en person: åbn teamet, og derefter **Main Menu** > **Invite People**.
2. Kortet **Mattermost-teams** under **Projektindstillinger** > **Arbejdsområde** > **Mattermost** viser disse teams, standardteamet først. Klik på **Opdater**, når du har føjet botten til et nyt team.

- **Hvilket team en regel bruger.** Notifikationsregler vælger det **Mattermost-team**, deres kanaler ligger i. Står feltet tomt, opretter reglen sin kanal i standardteamet og leder først dér efter de kanaler, den nævner, og derefter i bottens andre teams.
- **Hvilket team en opsummering bruger.** Opsummeringer, på fanen **Oversigt** i **Hændelser** og **Advarsler**, vælger også det **Mattermost-team**, deres kanaler ligger i. Står feltet tomt, leder en opsummering først efter sine kanaler i standardteamet og derefter i bottens andre teams.
- **Standardteamet.** Det er det team, du forbandt projektet med. **Gør til standard** på kortet gør et andet team til standard, for en rolle, der må forbinde projektet.
- **Hvor OneUptime virker.** Knapperne i OneUptimes beskeder og de formularer, de åbner, virker i hvert af disse teams. I et team, botten er fjernet fra, siger en knap kun, at teamet ikke længere er forbundet.
- **Et standardteam, botten er fjernet fra.** Kortet siger det. Tilføj botten igen i Mattermost, eller gør et andet team til standard.
- **Et team, en regel nævner, som botten er fjernet fra.** Regelens kort siger det, og reglen bruger ikke et andet team i stedet. Tilføj botten til teamet igen i Mattermost, eller vælg et andet team i reglen: dens formular viser stadig det gamle valg, så du kan ændre det.

## Forbind din egen Mattermost-konto

Mattermost har ikke noget login, OneUptime kan sende dig til, så OneUptimes bot sender i stedet din Mattermost-konto en direkte besked med et link:

:::steps
1. Gå til **Brugerindstillinger** > **Arbejdsområde** > **Mattermost**. OneUptime leder efter den Mattermost-konto, der har din e-mailadresse. Finder den en, så klik på **Send link til @your-username**. Hvis ikke, så klik på **Send mig et link**, og angiv dit Mattermost-brugernavn.
2. Åbn den direkte besked fra OneUptime-botten i Mattermost, og klik på **Connect my account**.
3. Linket åbner OneUptime, som forbinder din konto.
:::

Åbn linket i den samme browser, som du bad om det i: det virker kun der, kun én gang og kun i 15 minutter. Det beviser, at den, der bad om det, har begge konti, så ingen kan forbinde en andens Mattermost-konto. Hvis du ikke bad om et link, så ignorer det: intet forbindes, før det åbnes i den browser, der bad om det.

Din kontos forbindelse hører til dette projekt. I et andet projekt, der er forbundet med det samme Mattermost-team, skal du også forbinde den der.

## Bliv tilkaldt i Mattermost

For at blive tilkaldt via direkte besked, når du har vagt, tilføjer du Mattermost som en af dine notifikationsmetoder:

:::steps
1. Forbind din egen Mattermost-konto (se [Forbind din egen Mattermost-konto](#forbind-din-egen-mattermost-konto)).
2. Gå til **Brugerindstillinger** > **Notifikationsmetoder**, åbn fanen **Arbejdsområdeapps**, og klik på **Tilføj Mattermost-konto**.
3. Klik på **Send Test Message** i dens række. Beskeden ankommer som en direkte besked fra projektets bot.
:::

At tilføje den sætter den straks ind i dine vagtregler, så tilkald når dig i Mattermost fra da af. Ændr, hvilke tilkald den får, under **Brugerindstillinger** > **Sådan når man mig**. Hvert tilkald har et link til at bekræfte det og et til at eskalere det. Hvis du afbryder forbindelsen til din Mattermost-konto, fjernes denne metode og de vagtregler, der bruger den.

## Notifikationsregler

En notifikationsregel siger, hvilke begivenheder der slås op i Mattermost, og hvor. Hvert produkt har sine egne regler, under **Arbejdsområde** > **Mattermost** i sin menu: **Hændelser** (med **Hændelsesepisoder** og en fane **Oversigt**), **Advarsler** (med **Advarselsepisoder** og **Oversigt**), **Planlagt vedligeholdelse**, **Monitorer**, **Vagt**, **Sikkerhedshændelser** og **SLOs**. De virker som Slacks: se [Notifikationsregler](/docs/workspace-connections/slack#notifikationsregler) for betingelser, destinationer og hvem der kommer med i en kanal.

En kanal, som en regel opretter, får navn efter sin post: hændelse INC-42 får `inc-42`. Mattermost tager små bogstaver, tal, `-` og `_`, op til 64 tegn, med et bogstav eller et tal først og sidst, og regelformularen viser navnet, mens du skriver. Findes der allerede en kanal med det navn, fx en arkiveret, tilføjer OneUptime `-2`, `-3` og så videre. En privat hændelse, advarsel eller episode får en privat kanal.

For at slå op i en eksisterende kanal angiver du dens navn, som det står i kanalens adresse, for eksempel `incidents` for `chat.example.com/team/channels/incidents`, eller dens visningsnavn. OneUptime melder sig selv ind i en offentlig kanal første gang, den slår op der. Føj botten til en privat kanal i Mattermost, før en regel slår op i den. Når botten er i mere end ét team, vælger en regel også det team, dens kanaler ligger i: se [Mere end ét team](#mere-end-ét-team).

Folk kommer med i en regels kanal via den Mattermost-konto, de har forbundet, eller ellers via den Mattermost-konto, der har deres e-mailadresse, når din server viser e-mailadresser for botten (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). OneUptime nævner dem, den ikke kunne tilføje, i én besked i kanalen, med et link til at forbinde deres konto.

En hændelse, advarsel, episode eller planlagt vedligeholdelse med sin egen kanal har **Åbn i Mattermost** i toppen af sin side i OneUptime, ved siden af tilstandsknapperne. Den åbner kanalen i en ny fane, på din Mattermost-server. En post med to egne kanaler viser dem begge under knappen. En post, der også har kanaler i Slack eller Microsoft Teams, har i stedet én knap, **Åbn kanal**, der viser dem alle. De eksisterende kanaler, dine regler slår op i, tilbydes ikke.

**Test regel** i en regels række slår en testbesked for den regel op i de kanaler, den nævner, ligesom for Slack.

OneUptimes beskeder underretter ingen gennem det, de citerer: et navn eller en beskrivelse, der indeholder `@channel`, `@here` eller `@someone`, vises, som det er skrevet, og pinger ingen.

## Hvem der er i en posts kanal

En hændelse, advarsel, episode eller planlagt vedligeholdelse med sin egen Mattermost-kanal har kortet **Mattermost-kanal** på sin side i OneUptime. Kortet viser kanalen, som et link, der åbner den på din Mattermost-server, om den er privat, og hvem der er i den, dig først. Fra kortet, uden en Mattermost-administrator:

- **Deltag i kanal** tilføjer dig, når du ikke er i kanalen.
- **Tilføj personer** åbner en liste over projektets personer og teams: vælg en person for at tilføje personen, eller et team for at tilføje alle i det.

OneUptimes bot tilføjer dem, ligesom den tilføjer personerne i en regels kanal. Botten bliver i de kanaler, den opretter, så det virker også for en privat kanal, som alle har forladt. En post, der også har kanaler i Slack eller Microsoft Teams, viser dem alle på ét kort **Chatkanaler**.

- **Hvem der må tilføje personer.** Den, der må redigere posten: **Projektejer**, **Projektadministrator**, **Projektmedlem**, **Hændelsesadministrator** og **Hændelsesmedlem** for en hændelse, eller **Edit Incident** i en brugerdefineret rolle, og den samme tilladelse for en advarsel, en episode eller en begivenhed (for eksempel **Edit Alert**). Alle andre ser, hvem der er i kanalen, og hvordan de kommer ind.
- **Hvem der kan tilføjes.** En person, OneUptime kan finde i Mattermost, via den konto, personen har forbundet, eller ellers via e-mailadressen, når din server viser e-mailadresser til botten, og som er i kanalens team. En gæstekonto i det team kan også tilføjes: Mattermost lader en kanals medlemmer tilføje gæster. Kortet nævner dem, det ikke kunne tilføje, og hvorfor.
- **Hvad der registreres.** Hvem der blev tilføjet, og af hvem, i postens feed (**Kanalmedlem tilføjet**) og under **Projektindstillinger** > **Notifikationer** > **Notifikationslogs** på fanen **Arbejdsområde**.
- **En arkiveret kanal.** Kortet viser stadig, hvem der er i den, og tilføjer ingen, før kanalen er gendannet fra arkivet i Mattermost.
- **En kanal, botten er fjernet fra.** Mattermost viser kun en kanals personer til nogen, der er i den, også for en offentlig kanal, så kortet siger, at det ikke kan se kanalen. En i kanalen kan tilføje botten igen i Mattermost. OneUptime deltager også selv i en offentlig kanal igen, næste gang det slår op der.
- **At fjerne nogen.** OneUptime tilføjer kun: fjern nogen fra kanalen i Mattermost.

## Handl på hændelser, advarsler og begivenheder fra Mattermost

OneUptimes beskeder har knapper og en menu **More actions** til det, færre har brug for. Hver af dem handler som dig, med dine rettigheder i projektet, og svarer i en besked, kun du kan se.

| Post | Knapper og menu |
| --- | --- |
| **Hændelse** | **Acknowledge**, **Resolve**, **Add Note** og i menuen **Change Severity** og **Change State** |
| **Advarsel** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Hændelsesepisode, advarselsepisode** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Planlagt vedligeholdelse** | **Mark as Ongoing**, **Mark as Complete**, **Add Note**, **Change State** |

**Add Note**, **Change State**, **Change Severity** og **Execute On-Call Policy** åbner en formular i Mattermost. En note på en hændelse eller en planlagt vedligeholdelsesbegivenhed kan være offentlig, vist på statussiden, eller privat; en note på en privat hændelse er altid privat, og på en advarsel også altid privat. Hver besked har også et link, der åbner dens post i OneUptime, til alt andet. Når projektets offentlige noter kræver godkendelse, venter en offentlig note fra formularen på den, og en besked, kun du ser, siger, hvem den venter på: se [Godkendelse af offentlige noter](/docs/incidents/notes-owners-and-feed#godkendelse-af-offentlige-noter).

Hvis din Mattermost-konto ikke er forbundet endnu, siger en knap det, med et link til **Brugerindstillinger** > **Arbejdsområde** > **Mattermost**. Forbind din konto, og tryk så på knappen igen.

Hvert tryk registreres under **Projektindstillinger** > **Notifikationer** > **Notifikationslogs** på fanen **Arbejdsområde**, med hvem der trykkede.

## Godkend en offentlig note

Når projektets offentlige noter kræver godkendelse, og du slår Mattermost til for **Godkendelse af offentlige noter** i dine notifikationsindstillinger, kommer hver offentlig note, der venter på et trin, du godkender, til dine direkte beskeder med OneUptimes bot: hvem der sendte den, hvilket trin den venter på, noten, **Approve**, **Reject** og et link til noten i OneUptime. **Approve** godkender den for det trin; på det sidste trin hedder den **Approve and publish**, og noten offentliggøres med det samme. **Reject** åbner en formular, der spørger hvorfor: en begrundelse er påkrævet, og notens forfatter ser den. Knapperne handler som dig, efter de samme regler som i OneUptime, og svarer i en besked, som kun du ser. Et tryk, efter at en anden har afgjort, eller efter at noten eller dens trin er ændret, afgør intet og siger, hvad der skete. Når noten er afgjort, ændres hver godkenders besked om den, også din, så den siger, hvad der skete: godkendt for sit trin og hvem den nu venter på, offentliggjort, afvist, ændret eller sendt til godkendelse igen, offentliggjort uden godkendelse eller slettet. Den beholder sit link til noten i OneUptime, og **Approve** og **Reject** er væk. Hvis din Mattermost-konto ikke er forbundet, så forbind den under **Brugerindstillinger** > **Arbejdsområde** > **Mattermost**, og tryk så på knappen igen. Når godkendelsestrinnene ændres, mens en note venter, ændres din besked om den også, hvis noten ikke længere venter på dit trin, eller du ikke længere bliver spurgt, og dem, den nu venter på, får deres egen besked. Se [Godkendelse af offentlige noter](/docs/incidents/notes-owners-and-feed#godkendelse-af-offentlige-noter).

## Netværk og selvhosting

To servere taler med hinanden:

- **OneUptime kalder din Mattermost-server** for at slå op, oprette kanaler og tilføje folk. På OneUptime Cloud skal din Mattermost-server kunne nås fra internettet. En selvhostet OneUptime kan nå en Mattermost-server på et privat netværk, når den, der driver OneUptime, tillader private adresser med `ALLOW_PRIVATE_NETWORK_WEBHOOKS` eller `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`. OneUptime kalder aldrig en adresse på sin egen maskine eller en cloudmetadata-adresse og følger aldrig en omdirigering.
- **Din Mattermost-server kalder OneUptime**, når nogen trykker på en knap eller sender en formular: `https://<your OneUptime>/api/mattermost/interactive` og `/api/mattermost/dialog`. Hvis OneUptimes adresse er privat, så tilføj dens vært under **System Console** > **Environment** > **Developer** > **Allow untrusted internal connections to** i Mattermost, ellers virker knapperne ikke.

Hver knap, OneUptime slår op, bærer en signatur, der kontrolleres, når der trykkes på den, for det Mattermost-team, den blev slået op i: et tryk, OneUptime ikke har signeret, eller et, der sendes fra et andet team, gør intet.

## Fejlfinding

| Hvad du ser | Hvad du skal gøre |
| --- | --- |
| **Mattermost did not accept the access token** | Kopiér bottens token igen. Mattermost viser det kun én gang: opret et nyt under **Integrations** > **Bot Accounts**, hvis du får brug for det. |
| **The bot account is not a member of any team** | Føj botten til dit team i Mattermost, og forbind så igen. |
| Et team, du har føjet botten til, står ikke på kortet **Mattermost-teams** | Klik på **Opdater** på kortet. |
| **OneUptime's bot is not a member of this Mattermost team** | Du har valgt et team, botten har forladt. Føj botten til det i Mattermost, og klik så på **Opdater**. |
| **OneUptime's bot may not create channels in the Mattermost team this rule names** | Føj botten til det team i Mattermost, eller vælg et andet team i reglen. |
| **OneUptime's bot is not a member of the Mattermost team chosen for the channel** | Føj botten til det team i Mattermost, eller vælg et andet team i reglen. |
| **OneUptime's bot is no longer a member of the project's default Mattermost team** | Tilføj botten til det team igen i Mattermost, eller gør et andet team til standard. |
| **OneUptime could not reach the Mattermost server** | Tjek adressen, og at OneUptime kan nå den. Se [Netværk og selvhosting](#netværk-og-selvhosting). |
| **The bot is not a member of the private Mattermost channel** | Føj botten til kanalen i Mattermost. |
| En knap gør intet, eller Mattermost siger, at den ikke kunne fuldføre handlingen | Mattermost kan ikke nå OneUptime. Se [Netværk og selvhosting](#netværk-og-selvhosting). |
| Der kommer ingen direkte besked med dit link | Tjek brugernavnet, og at botten er i et team, du er med i. |
| Kanalkortet siger, at OneUptime ikke kan se kanalen | Kanalen er slettet, eller botten er fjernet fra den. Hvis den stadig findes, kan en i kanalen tilføje botten igen i Mattermost. |
| Kanalkortet siger, at en person ikke er i Mattermost-teamet | Tilføj personen i Mattermost til kanalens team, og tilføj vedkommende derefter igen. |
