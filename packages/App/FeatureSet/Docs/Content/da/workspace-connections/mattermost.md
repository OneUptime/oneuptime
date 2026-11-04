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

- **Projektets forbindelse**, lavet én gang: en botkonto på din Mattermost-server, i det team, OneUptime slår op i. Den slår beskederne op, opretter kanalerne og tilføjer folk til dem.
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

Føj botten til det team, OneUptime skal slå op i, ligesom du ville tilføje en person: **Main Menu** > **Invite People**, og invitér `@oneuptime`. OneUptime opretter kun kanaler og slår kun op i det team.

### Forbind projektet

Gå i OneUptime til **Projektindstillinger** > **Arbejdsområde** > **Mattermost**, og klik på **Forbind med Mattermost**. Angiv din servers adresse, for eksempel `https://chat.example.com`, og bottens adgangstoken. OneUptime kontrollerer tokenet hos din server, før den gemmer noget. Hvis botten er i mere end ét team, spørger OneUptime, hvilket den skal slå op i. Indtil et workspace er forbundet, indeholder sektionen **Arbejdsområde** i menuerne Hændelser, Advarsler, Planlagt vedligeholdelse, Monitorer og Vagtordning **Forbind et arbejdsområde**, som også fører hertil.

### Tilføj en notifikationsregel

Gå til **Hændelser** > **Arbejdsområde** > **Mattermost**, og opret en regel. For eksempel en, der opretter en Mattermost-kanal for hver ny hændelse med alle, der arbejder på den. Se [Notifikationsregler](#notifikationsregler).
:::

Bottens adgangstoken gemmes kun på OneUptime-serveren, krypteret sammen med projektets andre hemmeligheder, og vises aldrig igen. Serveradressen, teamet og bottens brugernavn vises for alle i projektet på Mattermost-indstillingssiden.

Et projekt er forbundet med ét Mattermost-team. For at flytte det til et andet team eller en anden server skal du først afbryde forbindelsen: **Projektindstillinger** > **Arbejdsområde** > **Mattermost**, derefter **⋯** > **Afbryd forbindelsen til Mattermost**. At afbryde forbindelsen fjerner også tilknytningen af hvert medlems egen Mattermost-konto. Dine notifikationsregler og opsummeringer bevares, til du forbinder igen.

## Forbind din egen Mattermost-konto

Mattermost har ikke noget login, OneUptime kan sende dig til, så OneUptimes bot sender i stedet din Mattermost-konto en direkte besked med et link:

:::steps
1. Gå til **Brugerindstillinger** > **Arbejdsområde** > **Mattermost**. OneUptime leder efter den Mattermost-konto, der har din e-mailadresse. Finder den en, så klik på **Send link til @your-username**. Hvis ikke, så klik på **Send mig et link**, og angiv dit Mattermost-brugernavn.
2. Åbn den direkte besked fra OneUptime-botten i Mattermost, og klik på **Connect my account**.
3. Linket åbner OneUptime, som forbinder din konto.
:::

Åbn linket i den samme browser, som du bad om det i: det virker kun der, kun én gang og kun i 15 minutter. Det beviser, at den, der bad om det, har begge konti, så ingen kan forbinde en andens Mattermost-konto. Hvis du ikke bad om et link, så ignorer det: intet forbindes, før det åbnes i den browser, der bad om det.

Din kontos forbindelse hører til dette projekt. I et andet projekt, der er forbundet med det samme Mattermost-team, skal du også forbinde den der.

## Notifikationsregler

En notifikationsregel siger, hvilke begivenheder der slås op i Mattermost, og hvor. Hvert produkt har sine egne regler, under **Arbejdsområde** > **Mattermost** i sin menu: **Hændelser** (med **Hændelse Episoder** og en fane **Oversigt**), **Advarsler** (med **Advarsel Episoder** og **Oversigt**), **Planlagt vedligeholdelse**, **Monitorer**, **Vagtordning** og **Sikkerhedshændelser**. De virker som Slacks: se [Notifikationsregler](/docs/workspace-connections/slack#notifikationsregler) for betingelser, destinationer og hvem der kommer med i en kanal.

En kanal, som en regel opretter, får navn efter sin post: hændelse INC-42 får `inc-42`. Mattermost tager små bogstaver, tal, `-` og `_`, op til 64 tegn, med et bogstav eller et tal først og sidst, og regelformularen viser navnet, mens du skriver. Findes der allerede en kanal med det navn, fx en arkiveret, tilføjer OneUptime `-2`, `-3` og så videre. En privat hændelse, advarsel eller episode får en privat kanal.

For at slå op i en eksisterende kanal angiver du dens navn, som det står i kanalens adresse, for eksempel `incidents` for `chat.example.com/team/channels/incidents`, eller dens visningsnavn. OneUptime melder sig selv ind i en offentlig kanal første gang, den slår op der. Føj botten til en privat kanal i Mattermost, før en regel slår op i den.

Folk kommer med i en regels kanal via den Mattermost-konto, de har forbundet, eller ellers via den Mattermost-konto, der har deres e-mailadresse, når din server viser e-mailadresser for botten (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). OneUptime nævner dem, den ikke kunne tilføje, i én besked i kanalen, med et link til at forbinde deres konto.

En hændelse, advarsel, episode eller planlagt vedligeholdelse med sin egen kanal har **Åbn i Mattermost** i toppen af sin side i OneUptime, ved siden af tilstandsknapperne. Den åbner kanalen i en ny fane, på din Mattermost-server. En post med to egne kanaler viser dem begge under knappen. En post, der også har kanaler i Slack eller Microsoft Teams, har i stedet én knap, **Åbn kanal**, der viser dem alle. De eksisterende kanaler, dine regler slår op i, tilbydes ikke.

**Testregel** i en regels række slår en testbesked for den regel op i de kanaler, den nævner, ligesom for Slack.

OneUptimes beskeder underretter ingen gennem det, de citerer: et navn eller en beskrivelse, der indeholder `@channel`, `@here` eller `@someone`, vises, som det er skrevet, og pinger ingen.

## Hvem der er i en posts kanal

En hændelse, advarsel, episode eller planlagt vedligeholdelse med sin egen Mattermost-kanal har kortet **Mattermost-kanal** på sin side i OneUptime. Kortet viser kanalen, som et link, der åbner den på din Mattermost-server, om den er privat, og hvem der er i den, dig først. Fra kortet, uden en Mattermost-administrator:

- **Deltag i kanal** tilføjer dig, når du ikke er i kanalen.
- **Tilføj personer** åbner en liste over projektets personer og teams: vælg en person for at tilføje personen, eller et team for at tilføje alle i det.

OneUptimes bot tilføjer dem, ligesom den tilføjer personerne i en regels kanal. Botten bliver i de kanaler, den opretter, så det virker også for en privat kanal, som alle har forladt. En post, der også har kanaler i Slack eller Microsoft Teams, viser dem alle på ét kort **Chatkanaler**.

- **Hvem der må tilføje personer.** Den, der må redigere posten: **Projektejer**, **Projektadministrator**, **Projektmedlem**, **Hændelsesadministrator** og **Hændelsesmedlem** for en hændelse, eller **Edit Incident** i en brugerdefineret rolle, og den samme tilladelse for en advarsel, en episode eller en begivenhed (for eksempel **Edit Alert**). Alle andre ser, hvem der er i kanalen, og hvordan de kommer ind.
- **Hvem der kan tilføjes.** En person, OneUptime kan finde i Mattermost, via den konto, personen har forbundet, eller ellers via e-mailadressen, når din server viser e-mailadresser til botten, og som er i det team, projektet er forbundet med. En gæstekonto i det team kan også tilføjes: Mattermost lader en kanals medlemmer tilføje gæster. Kortet nævner dem, det ikke kunne tilføje, og hvorfor.
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

**Add Note**, **Change State**, **Change Severity** og **Execute On-Call Policy** åbner en formular i Mattermost. En note på en hændelse eller en planlagt vedligeholdelsesbegivenhed kan være offentlig, vist på statussiden, eller privat; en note på en privat hændelse er altid privat, og på en advarsel også altid privat. Hver besked har også et link, der åbner dens post i OneUptime, til alt andet.

Hvis din Mattermost-konto ikke er forbundet endnu, siger en knap det, med et link til **Brugerindstillinger** > **Arbejdsområde** > **Mattermost**. Forbind din konto, og tryk så på knappen igen.

Hvert tryk registreres under **Projektindstillinger** > **Notifikationer** > **Notifikationslogs** på fanen **Arbejdsområde**, med hvem der trykkede.

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
| **OneUptime could not reach the Mattermost server** | Tjek adressen, og at OneUptime kan nå den. Se [Netværk og selvhosting](#netværk-og-selvhosting). |
| **The bot is not a member of the private Mattermost channel** | Føj botten til kanalen i Mattermost. |
| En knap gør intet, eller Mattermost siger, at den ikke kunne fuldføre handlingen | Mattermost kan ikke nå OneUptime. Se [Netværk og selvhosting](#netværk-og-selvhosting). |
| Der kommer ingen direkte besked med dit link | Tjek brugernavnet, og at botten er i et team, du er med i. |
| Kanalkortet siger, at OneUptime ikke kan se kanalen | Kanalen er slettet, eller botten er fjernet fra den. Hvis den stadig findes, kan en i kanalen tilføje botten igen i Mattermost. |
| Kanalkortet siger, at en person ikke er i Mattermost-teamet | Tilføj personen i Mattermost til det team, projektet er forbundet med, og tilføj vedkommende derefter igen. |
