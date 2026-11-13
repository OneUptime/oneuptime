# Mattermost

Koble OneUptime til Mattermost-serveren din for å publisere hendelser, varsler, episoder, planlagt vedlikehold, monitorer og vaktoppdateringer i kanalene dine, gi hver hendelse sin egen kanal og la responders bekrefte, løse, legge til notater og endre tilstand uten å forlate Mattermost.

:::cards
- [Koble til Mattermost](#koble-til-mattermost): Opprett en botkonto for OneUptime, og koble deretter til prosjektet med tokenet.
- [Koble til din egen konto](#koble-til-din-egen-mattermost-konto): Koble Mattermost-kontoen din til OneUptime-kontoen din.
- [Varslingsregler](#varslingsregler): Bestem hvilke hendelser som publiseres hvor, og hvilke som får sin egen kanal.
- [Hvem som er i kanalen til en post](#hvem-som-er-i-kanalen-til-en-post): Se hvem som er i den, bli med og legg til personer, fra siden til posten.
- [Handle fra Mattermost](#handle-på-hendelser-varsler-og-begivenheter-fra-mattermost): Knappene i meldingene fra OneUptime.
- [Nettverk og selvhosting](#nettverk-og-selvhosting): Hva hver server må kunne nå.
:::

## Slik fungerer det

```mermaid title="Fra en begivenhet i OneUptime til en melding i Mattermost"
flowchart TB
    event["En hendelse, et varsel eller en begivenhet<br/>opprettes eller endres"] --> rules{"Varslingsregler<br/>der betingelsene passer"}
    rules -->|"En kanal<br/>for hver"| own["En egen kanal,<br/>med folkene lagt til etter hvert som de kommer til"]
    rules -->|"Publiser i eksisterende kanaler"| existing["De eksisterende kanalene dine"]
    own --> message["En melding med knapper"]
    existing --> message
    message -->|"En responder trykker på én"| change["Endringen gjøres i OneUptime,<br/>som den responderen"]
```

To tilkoblinger får dette til å fungere:

- **Prosjektets tilkobling**, gjort én gang: en botkonto på Mattermost-serveren din, i teamene OneUptime publiserer i. Den publiserer meldingene, oppretter kanalene og legger til folk i dem.
- **Hver persons egen tilkobling**: personens Mattermost-konto koblet til personens OneUptime-konto. Knapper handler som den personen, med personens tillatelser i prosjektet.

Ett Mattermost-team kan være koblet til mer enn ett prosjekt, for eksempel produksjon og staging. En knapp handler i prosjektet til posten som meldingen dens gjelder.

## Før du begynner

- **En rolle som kan koble til prosjektet:** **Prosjekteier**, **Prosjektadministrator** eller **Prosjektmedlem**. Å koble fra krever **Prosjekteier** eller **Prosjektadministrator**.
- **En Mattermost-server** der du kan opprette en botkonto, eller en Mattermost-administrator som kan opprette en for deg. Både Mattermost Cloud og selvdriftet Mattermost fungerer.
- **Growth-planen på OneUptime Cloud** for varslingsregler og sammendrag.

OneUptime trenger ikke noe oppsett på sin egen server for Mattermost: hvert prosjekt tar med sin egen Mattermost-server og botkonto.

## Koble til Mattermost

:::steps
### Opprett en botkonto i Mattermost

Åpne **System Console** > **Integrations** > **Bot Accounts** i Mattermost, og sørg for at **Enable Bot Account Creation** er slått på. Gå deretter til **Integrations** > **Bot Accounts** > **Add Bot Account**, gi den navnet `oneuptime`, og lagre. Mattermost viser tilgangstokenet til boten én gang: kopier det.

### Legg til boten i teamet ditt

Legg til boten i hvert team OneUptime skal publisere i, slik du ville lagt til en person: **Main Menu** > **Invite People**, og inviter `@oneuptime`. OneUptime oppretter kanaler og publiserer bare i teamene boten er medlem av.

### Koble til prosjektet

Gå til **Prosjektinnstillinger** > **Arbeidsområde** > **Mattermost** i OneUptime, og klikk på **Koble til Mattermost**. Skriv inn adressen til serveren din, for eksempel `https://chat.example.com`, og tilgangstokenet til boten. OneUptime sjekker tokenet mot serveren din før den lagrer noe. Hvis boten er i mer enn ett team, spør OneUptime hvilket som er standardteamet: teamet der en varslingsregel som ikke nevner noe team, oppretter kanalene sine. Til et workspace er koblet til, inneholder seksjonen **Arbeidsområde** i menyene Hendelser, Varsler, Planlagt vedlikehold, Monitorer og Vakt **Koble til et arbeidsområde**, som også fører hit.

### Legg til en varslingsregel

Gå til **Hendelser** > **Arbeidsområde** > **Mattermost**, og opprett en regel. For eksempel en som oppretter en Mattermost-kanal for hver nye hendelse med alle som jobber med den. Se [Varslingsregler](#varslingsregler).
:::

Tilgangstokenet til boten lagres bare på OneUptime-serveren, kryptert sammen med prosjektets andre hemmeligheter, og vises aldri igjen. Serveradressen, teamene og brukernavnet til boten vises for alle i prosjektet, på innstillingssiden for Mattermost.

Et prosjekt er koblet til én Mattermost-server. For å flytte det til en annen server kobler du det først fra: **Prosjektinnstillinger** > **Arbeidsområde** > **Mattermost**, deretter **⋯** > **Koble fra Mattermost**. Å koble fra kobler også fra hvert medlems egen Mattermost-konto, og fjerner Mattermost-varselmetodene deres og vaktreglene som bruker dem. Varslingsreglene og sammendragene dine beholdes til du kobler til igjen.

## Mer enn ett team

OneUptime fungerer i hvert team på Mattermost-serveren din som boten er medlem av:

1. Legg til boten i Mattermost i hvert team som skal bruke OneUptime, slik du ville lagt til en person: åpne teamet, deretter **Main Menu** > **Invite People**.
2. Kortet **Mattermost-team** under **Prosjektinnstillinger** > **Arbeidsområde** > **Mattermost** viser disse teamene, standardteamet først. Klikk på **Oppdater** etter at du har lagt til boten i et nytt team.

- **Hvilket team en regel bruker.** Varslingsregler velger **Mattermost-team** for kanalene sine. Står feltet tomt, oppretter regelen kanalen sin i standardteamet, og leter først der etter kanalene den nevner, deretter i botens andre team.
- **Hvilket team et sammendrag bruker.** Sammendrag, på fanen **Sammendrag** i **Hendelser** og **Varsler**, velger også **Mattermost-team** for kanalene sine. Står feltet tomt, leter et sammendrag først etter kanalene sine i standardteamet, deretter i botens andre team.
- **Standardteamet.** Det er teamet du koblet prosjektet til. **Gjør til standard** på kortet gjør et annet team til standard, for en rolle som kan koble til prosjektet.
- **Hvor OneUptime fungerer.** Knappene i meldingene fra OneUptime, og skjemaene de åpner, fungerer i hvert av disse teamene. I et team boten er fjernet fra, sier en knapp bare at teamet ikke lenger er koblet til.
- **Et standardteam boten er fjernet fra.** Kortet sier fra om det. Legg til boten igjen i Mattermost, eller gjør et annet team til standard.
- **Et team en regel nevner, som boten er fjernet fra.** Kortet til regelen sier fra om det, og regelen bruker ikke et annet team i stedet. Legg boten til i teamet igjen i Mattermost, eller velg et annet team i regelen: skjemaet viser fortsatt det gamle valget, så du kan endre det.

## Koble til din egen Mattermost-konto

Mattermost har ingen pålogging OneUptime kan sende deg til, så OneUptime-boten sender i stedet Mattermost-kontoen din en direktemelding med en lenke:

:::steps
1. Gå til **Brukerinnstillinger** > **Arbeidsområde** > **Mattermost**. OneUptime ser etter Mattermost-kontoen med e-postadressen din. Hvis den finner en, klikker du på **Send lenke til @your-username**. Hvis ikke, klikker du på **Send meg en lenke** og skriver inn Mattermost-brukernavnet ditt.
2. Åpne direktemeldingen fra OneUptime-boten i Mattermost, og klikk på **Connect my account**.
3. Lenken åpner OneUptime, som kobler til kontoen din.
:::

Åpne lenken i den samme nettleseren som du ba om den i: den virker bare der, bare én gang og bare i 15 minutter. Det beviser at den som ba om den, har begge kontoene, så ingen kan koble til Mattermost-kontoen til noen andre. Hvis du ikke ba om en lenke, ignorerer du den: ingenting kobles til før den åpnes i nettleseren som ba om den.

Tilkoblingen til kontoen din hører til dette prosjektet. I et annet prosjekt som er koblet til det samme Mattermost-teamet, kobler du den til der også.

## Bli tilkalt i Mattermost

For å bli tilkalt med direktemelding når du har vakt, legger du til Mattermost som en av varselmetodene dine:

:::steps
1. Koble til din egen Mattermost-konto (se [Koble til din egen Mattermost-konto](#koble-til-din-egen-mattermost-konto)).
2. Gå til **Brukerinnstillinger** > **Varselmetoder**, åpne fanen **Arbeidsområdeapper**, og klikk på **Legg til Mattermost-konto**.
3. Klikk på **Send Test Message** i raden. Meldingen kommer som en direktemelding fra prosjektets bot.
:::

Å legge den til setter den straks inn i vaktreglene dine, så tilkallinger når deg i Mattermost fra da av. Endre hvilke tilkallinger den får, under **Brukerinnstillinger** > **Slik når man meg**. Hver tilkalling har en lenke for å bekrefte den og en for å eskalere den. Når du kobler fra Mattermost-kontoen din, fjernes denne metoden og vaktreglene som bruker den.

## Varslingsregler

En varslingsregel sier hvilke hendelser som publiseres i Mattermost, og hvor. Hvert produkt har sine egne regler, under **Arbeidsområde** > **Mattermost** i sin meny: **Hendelser** (med **Hendelsesepisoder** og en fane **Sammendrag**), **Varsler** (med **Varselsepisoder** og **Sammendrag**), **Planlagt vedlikehold**, **Monitorer**, **Vakt**, **Sikkerhetshendelser** og **SLOs**. De fungerer som Slacks: se [Varslingsregler](/docs/workspace-connections/slack#varslingsregler) for betingelser, mål, oppdateringene en regel publiserer, og hvem som blir med i en kanal.

En kanal som en regel oppretter, får navn etter posten sin: hendelse INC-42 får `inc-42`. Mattermost tar små bokstaver, tall, `-` og `_`, opptil 64 tegn, med en bokstav eller et tall først og sist, og regelskjemaet viser navnet mens du skriver. Finnes det allerede en kanal med det navnet, for eksempel en arkivert, legger OneUptime til `-2`, `-3` og så videre. En privat hendelse, et privat varsel eller en privat episode får en privat kanal.

For å publisere i en eksisterende kanal skriver du inn navnet slik det står i adressen til kanalen, for eksempel `incidents` for `chat.example.com/team/channels/incidents`, eller visningsnavnet. OneUptime blir selv med i en offentlig kanal første gang den publiserer der. Legg til boten i en privat kanal i Mattermost før en regel publiserer i den. Når boten er i mer enn ett team, velger en regel også teamet kanalene dens ligger i: se [Mer enn ett team](#mer-enn-ett-team).

Folk blir med i kanalen til en regel gjennom Mattermost-kontoen de har koblet til, eller ellers gjennom Mattermost-kontoen med e-postadressen deres, når serveren din viser e-postadresser til boten (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). OneUptime nevner dem den ikke kunne legge til, i én melding i kanalen, med en lenke for å koble til kontoen.

En hendelse, et varsel, en episode eller en planlagt vedlikeholdshendelse med sin egen kanal har **Åpne i Mattermost** øverst på siden sin i OneUptime, ved siden av tilstandsknappene. Den åpner kanalen i en ny fane, på Mattermost-serveren din. En post med to egne kanaler viser begge under knappen. En post som også har kanaler i Slack eller Microsoft Teams, har i stedet én knapp, **Åpne kanal**, som viser alle. De eksisterende kanalene reglene dine publiserer i, tilbys ikke.

**Test regel** i en regels rad publiserer en testmelding for den regelen i kanalene den nevner, slik den gjør for Slack.

Meldingene fra OneUptime varsler ingen gjennom det de siterer: et navn eller en beskrivelse som inneholder `@channel`, `@here` eller `@someone`, vises slik det er skrevet, og pinger ingen.

## Hvem som er i kanalen til en post

En hendelse, et varsel, en episode eller en planlagt vedlikeholdshendelse med sin egen Mattermost-kanal har kortet **Mattermost-kanal** på siden sin i OneUptime. Kortet viser kanalen, som en lenke som åpner den på Mattermost-serveren din, om den er privat, og hvem som er i den, deg først. Fra kortet, uten en Mattermost-administrator:

- **Bli med i kanalen** legger deg til når du ikke er i kanalen.
- **Legg til personer** åpner en liste over prosjektets personer og team: velg en person for å legge vedkommende til, eller et team for å legge til alle i det.

OneUptime-boten legger dem til, slik den legger til personene i kanalen til en regel. Boten blir værende i kanalene den oppretter, så dette virker også for en privat kanal som alle har forlatt. En post som også har kanaler i Slack eller Microsoft Teams, viser dem alle på ett kort **Chattekanaler**.

- **Hvem som kan legge til personer.** Den som kan redigere posten: **Prosjekteier**, **Prosjektadministrator**, **Prosjektmedlem**, **Hendelsesadministrator** og **Hendelsesmedlem** for en hendelse, eller **Edit Incident** i en egendefinert rolle, og den samme tillatelsen for et varsel, en episode eller en vedlikeholdshendelse (for eksempel **Edit Alert**). Alle andre ser hvem som er i kanalen, og hvordan de kommer inn.
- **Hvem som kan legges til.** Noen OneUptime finner i Mattermost, gjennom kontoen vedkommende har koblet til, eller ellers gjennom e-postadressen, når serveren din viser e-postadresser til boten, og som er i teamet til kanalen. En gjestekonto i det teamet kan også legges til: Mattermost lar medlemmene i en kanal legge til gjester. Kortet nevner hvem det ikke kunne legge til, og hvorfor.
- **Hva som registreres.** Hvem som ble lagt til, og av hvem, i feeden til posten (**Kanalmedlem lagt til**) og under **Prosjektinnstillinger** > **Varsler** > **Varsellogger**, på fanen **Arbeidsområde**.
- **En arkivert kanal.** Kortet viser fortsatt hvem som er i den, og legger ikke til noen før kanalen er hentet ut av arkivet i Mattermost.
- **En kanal boten er fjernet fra.** Mattermost viser personene i en kanal bare til noen som er i den, også for en offentlig kanal, så kortet sier at det ikke kan se kanalen. Noen i kanalen kan legge til boten igjen i Mattermost. OneUptime blir også selv med i en offentlig kanal igjen neste gang det publiserer der.
- **Å ta noen ut.** OneUptime legger bare til: fjern noen fra kanalen i Mattermost.

## Handle på hendelser, varsler og begivenheter fra Mattermost

Meldingene fra OneUptime har knapper, og en meny **More actions** for det færre trenger. Hver av dem handler som deg, med dine tillatelser i prosjektet, og svarer i en melding bare du ser.

| Post | Knapper og meny |
| --- | --- |
| **Hendelse** | **Acknowledge**, **Resolve**, **Add Note**, og i menyen **Change Severity** og **Change State** |
| **Varsel** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Hendelsesepisode, varselepisode** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Planlagt vedlikehold** | **Mark as Ongoing**, **Mark as Complete**, **Add Note**, **Change State** |

**Add Note**, **Change State**, **Change Severity** og **Execute On-Call Policy** åpner et skjema i Mattermost. Et notat på en hendelse eller en planlagt vedlikeholdsbegivenhet kan være offentlig, vist på statussiden, eller privat; et notat på en privat hendelse er alltid privat, og på et varsel også alltid privat. Hver melding har også en lenke som åpner posten i OneUptime, for alt annet. Når prosjektets offentlige notater krever godkjenning, venter et offentlig notat fra skjemaet på den, og en melding bare du ser, sier hvem det venter på: se [Godkjenning av offentlige notater](/docs/incidents/notes-owners-and-feed#godkjenning-av-offentlige-notater).

Hvis Mattermost-kontoen din ikke er koblet til ennå, sier en knapp fra om det, med en lenke til **Brukerinnstillinger** > **Arbeidsområde** > **Mattermost**. Koble til kontoen din, og trykk deretter på knappen igjen.

Hvert trykk registreres under **Prosjektinnstillinger** > **Varsler** > **Varsellogger**, på fanen **Arbeidsområde**, med hvem som trykket.

## Godkjenne et offentlig notat

Når prosjektets offentlige notater må godkjennes og du slår på Mattermost for **Godkjenning av offentlige notater** i varselinnstillingene dine, kommer hvert offentlige notat som venter på et trinn du godkjenner, til direktemeldingene dine med OneUptimes bot: hvem som sendte det, hvilket trinn det venter på, notatet, **Approve**, **Reject** og en lenke til notatet i OneUptime. **Approve** godkjenner det for det trinnet; på det siste trinnet heter knappen **Approve and publish**, og notatet publiseres med en gang. **Reject** åpner et skjema som spør om begrunnelsen: en begrunnelse er påkrevd, og forfatteren av notatet ser den. Knappene handler som deg, etter de samme reglene som i OneUptime, og svarer i en melding bare du ser. Et trykk etter at noen andre har avgjort, eller etter at notatet eller trinnene er endret, avgjør ingenting og sier hva som skjedde. Når notatet er avgjort, endres meldingen til hver godkjenner om det, også din, så den sier hva som skjedde: godkjent for trinnet sitt og hvem det venter på nå, publisert, avvist, endret eller sendt til godkjenning igjen, publisert uten godkjenning, eller slettet. Den beholder lenken sin til notatet i OneUptime, og **Approve** og **Reject** er borte. Hvis Mattermost-kontoen din ikke er koblet til, kobler du den til under **Brukerinnstillinger** > **Arbeidsområde** > **Mattermost** og trykker så på knappen igjen. Når godkjenningstrinnene endres mens et notat venter, endres også meldingen din om det hvis notatet ikke lenger venter på trinnet ditt, eller du ikke lenger blir spurt, og de det nå venter på, får en egen melding. Se [Godkjenning av offentlige notater](/docs/incidents/notes-owners-and-feed#godkjenning-av-offentlige-notater).

## Nettverk og selvhosting

To servere snakker med hverandre:

- **OneUptime kaller Mattermost-serveren din**, for å publisere, opprette kanaler og legge til folk. På OneUptime Cloud må Mattermost-serveren din kunne nås fra internett. En selvdriftet OneUptime kan nå en Mattermost-server på et privat nettverk når den som drifter OneUptime, tillater private adresser med `ALLOW_PRIVATE_NETWORK_WEBHOOKS` eller `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`. OneUptime kaller aldri en adresse på sin egen maskin eller en skymetadata-adresse, og følger aldri en omdirigering.
- **Mattermost-serveren din kaller OneUptime** når noen trykker på en knapp eller sender inn et skjema: `https://<your OneUptime>/api/mattermost/interactive` og `/api/mattermost/dialog`. Hvis adressen til OneUptime er privat, legger du til verten i **System Console** > **Environment** > **Developer** > **Allow untrusted internal connections to** i Mattermost, ellers virker ikke knappene.

Hver knapp OneUptime publiserer, har en signatur som sjekkes når noen trykker på den, for Mattermost-teamet den ble publisert i: et trykk OneUptime ikke har signert, eller et som er sendt fra et annet team, gjør ingenting.

## Feilsøking

| Hva du ser | Hva du gjør |
| --- | --- |
| **Mattermost did not accept the access token** | Kopier tokenet til boten på nytt. Mattermost viser det bare én gang: opprett et nytt under **Integrations** > **Bot Accounts** om nødvendig. |
| **The bot account is not a member of any team** | Legg til boten i teamet ditt i Mattermost, og koble til på nytt. |
| Et team du har lagt til boten i, står ikke på kortet **Mattermost-team** | Klikk på **Oppdater** på kortet. |
| **OneUptime's bot is not a member of this Mattermost team** | Du valgte et team boten har forlatt. Legg til boten i teamet i Mattermost, og klikk deretter på **Oppdater**. |
| **OneUptime's bot may not create channels in the Mattermost team this rule names** | Legg til boten i det teamet i Mattermost, eller velg et annet team i regelen. |
| **OneUptime's bot is not a member of the Mattermost team chosen for the channel** | Legg til boten i det teamet i Mattermost, eller velg et annet team i regelen. |
| **OneUptime's bot is no longer a member of the project's default Mattermost team** | Legg til boten i det teamet igjen i Mattermost, eller gjør et annet team til standard. |
| **OneUptime could not reach the Mattermost server** | Sjekk adressen, og at OneUptime kan nå den. Se [Nettverk og selvhosting](#nettverk-og-selvhosting). |
| **The bot is not a member of the private Mattermost channel** | Legg til boten i kanalen i Mattermost. |
| En knapp gjør ingenting, eller Mattermost sier at den ikke kunne fullføre handlingen | Mattermost når ikke OneUptime. Se [Nettverk og selvhosting](#nettverk-og-selvhosting). |
| Ingen direktemelding med lenken din kommer frem | Sjekk brukernavnet, og at boten er i et team du er med i. |
| Kanalkortet sier at OneUptime ikke kan se kanalen | Kanalen er slettet, eller boten er fjernet fra den. Hvis den fortsatt finnes, kan noen i kanalen legge til boten igjen i Mattermost. |
| Kanalkortet sier at noen ikke er i Mattermost-teamet | Legg vedkommende i Mattermost til i teamet til kanalen, og legg vedkommende deretter til på nytt. |
