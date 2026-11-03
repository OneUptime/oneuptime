# Mattermost

Koble OneUptime til Mattermost-serveren din for å publisere hendelser, varsler, episoder, planlagt vedlikehold, monitorer og vaktoppdateringer i kanalene dine, gi hver hendelse sin egen kanal og la responders bekrefte, løse, legge til notater og endre tilstand uten å forlate Mattermost.

:::cards
- [Koble til Mattermost](#koble-til-mattermost): Opprett en botkonto for OneUptime, og koble deretter til prosjektet med tokenet.
- [Koble til din egen konto](#koble-til-din-egen-mattermost-konto): Koble Mattermost-kontoen din til OneUptime-kontoen din.
- [Varslingsregler](#varslingsregler): Bestem hvilke hendelser som publiseres hvor, og hvilke som får sin egen kanal.
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

- **Prosjektets tilkobling**, gjort én gang: en botkonto på Mattermost-serveren din, i teamet OneUptime publiserer i. Den publiserer meldingene, oppretter kanalene og legger til folk i dem.
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

Legg til boten i teamet OneUptime skal publisere i, slik du ville lagt til en person: **Main Menu** > **Invite People**, og inviter `@oneuptime`. OneUptime oppretter kanaler og publiserer bare i det teamet.

### Koble til prosjektet

Gå til **Prosjektinnstillinger** > **Arbeidsområde** > **Mattermost** i OneUptime, og klikk på **Koble til Mattermost**. Skriv inn adressen til serveren din, for eksempel `https://chat.example.com`, og tilgangstokenet til boten. OneUptime sjekker tokenet mot serveren din før den lagrer noe. Hvis boten er i mer enn ett team, spør OneUptime hvilket den skal publisere i.

### Legg til en varslingsregel

Gå til **Hendelser** > **Arbeidsområde** > **Mattermost**, og opprett en regel. For eksempel en som oppretter en Mattermost-kanal for hver nye hendelse med alle som jobber med den. Se [Varslingsregler](#varslingsregler).
:::

Tilgangstokenet til boten lagres bare på OneUptime-serveren, kryptert sammen med prosjektets andre hemmeligheter, og vises aldri igjen. Serveradressen, teamet og brukernavnet til boten vises for alle i prosjektet, på innstillingssiden for Mattermost.

Et prosjekt er koblet til ett Mattermost-team. For å flytte det til et annet team, eller en annen server, kobler du det først fra: **Prosjektinnstillinger** > **Arbeidsområde** > **Mattermost**, deretter **⋯** > **Koble fra Mattermost**. Å koble fra kobler også fra hvert medlems egen Mattermost-konto. Varslingsreglene og sammendragene dine beholdes til du kobler til igjen.

## Koble til din egen Mattermost-konto

Mattermost har ingen pålogging OneUptime kan sende deg til, så OneUptime-boten sender i stedet Mattermost-kontoen din en direktemelding med en lenke:

:::steps
1. Gå til **Brukerinnstillinger** > **Arbeidsområde** > **Mattermost**. OneUptime ser etter Mattermost-kontoen med e-postadressen din. Hvis den finner en, klikker du på **Send lenke til @your-username**. Hvis ikke, klikker du på **Send meg en lenke** og skriver inn Mattermost-brukernavnet ditt.
2. Åpne direktemeldingen fra OneUptime-boten i Mattermost, og klikk på **Connect my account**.
3. Lenken åpner OneUptime, som kobler til kontoen din.
:::

Åpne lenken i den samme nettleseren som du ba om den i: den virker bare der, bare én gang og bare i 15 minutter. Det beviser at den som ba om den, har begge kontoene, så ingen kan koble til Mattermost-kontoen til noen andre. Hvis du ikke ba om en lenke, ignorerer du den: ingenting kobles til før den åpnes i nettleseren som ba om den.

Tilkoblingen til kontoen din hører til dette prosjektet. I et annet prosjekt som er koblet til det samme Mattermost-teamet, kobler du den til der også.

## Varslingsregler

En varslingsregel sier hvilke hendelser som publiseres i Mattermost, og hvor. Hvert produkt har sine egne regler, under **Arbeidsområde** > **Mattermost** i sin meny: **Hendelser** (med **Hendelse Episoder** og en fane **Sammendrag**), **Varsler** (med **Varsel Episoder** og **Sammendrag**), **Planlagt vedlikehold**, **Monitorer**, **Vakttjeneste** og **Sikkerhetshendelser**. De fungerer som Slacks: se [Varslingsregler](/docs/workspace-connections/slack#varslingsregler) for betingelser, mål og hvem som blir med i en kanal.

En kanal som en regel oppretter, får navn etter posten sin: hendelse INC-42 får `inc-42`. Mattermost tar små bokstaver, tall, `-` og `_`, opptil 64 tegn, med en bokstav eller et tall først og sist, og regelskjemaet viser navnet mens du skriver. Finnes det allerede en kanal med det navnet, for eksempel en arkivert, legger OneUptime til `-2`, `-3` og så videre. En privat hendelse, et privat varsel eller en privat episode får en privat kanal.

For å publisere i en eksisterende kanal skriver du inn navnet slik det står i adressen til kanalen, for eksempel `incidents` for `chat.example.com/team/channels/incidents`, eller visningsnavnet. OneUptime blir selv med i en offentlig kanal første gang den publiserer der. Legg til boten i en privat kanal i Mattermost før en regel publiserer i den.

Folk blir med i kanalen til en regel gjennom Mattermost-kontoen de har koblet til, eller ellers gjennom Mattermost-kontoen med e-postadressen deres, når serveren din viser e-postadresser til boten (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). OneUptime nevner dem den ikke kunne legge til, i én melding i kanalen, med en lenke for å koble til kontoen.

**Testregel** i en regels rad publiserer en testmelding for den regelen i kanalene den nevner, slik den gjør for Slack.

Meldingene fra OneUptime varsler ingen gjennom det de siterer: et navn eller en beskrivelse som inneholder `@channel`, `@here` eller `@someone`, vises slik det er skrevet, og pinger ingen.

## Handle på hendelser, varsler og begivenheter fra Mattermost

Meldingene fra OneUptime har knapper, og en meny **More actions** for det færre trenger. Hver av dem handler som deg, med dine tillatelser i prosjektet, og svarer i en melding bare du ser.

| Post | Knapper og meny |
| --- | --- |
| **Hendelse** | **Acknowledge**, **Resolve**, **Add Note**, og i menyen **Change Severity** og **Change State** |
| **Varsel** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Hendelsesepisode, varselepisode** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Planlagt vedlikehold** | **Mark as Ongoing**, **Mark as Complete**, **Add Note**, **Change State** |

**Add Note**, **Change State**, **Change Severity** og **Execute On-Call Policy** åpner et skjema i Mattermost. Et notat på en hendelse eller en planlagt vedlikeholdsbegivenhet kan være offentlig, vist på statussiden, eller privat; et notat på en privat hendelse er alltid privat, og på et varsel også alltid privat. Hver melding har også en lenke som åpner posten i OneUptime, for alt annet.

Hvis Mattermost-kontoen din ikke er koblet til ennå, sier en knapp fra om det, med en lenke til **Brukerinnstillinger** > **Arbeidsområde** > **Mattermost**. Koble til kontoen din, og trykk deretter på knappen igjen.

Hvert trykk registreres under **Prosjektinnstillinger** > **Varsler** > **Varsellogger**, på fanen **Arbeidsområde**, med hvem som trykket.

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
| **OneUptime could not reach the Mattermost server** | Sjekk adressen, og at OneUptime kan nå den. Se [Nettverk og selvhosting](#nettverk-og-selvhosting). |
| **The bot is not a member of the private Mattermost channel** | Legg til boten i kanalen i Mattermost. |
| En knapp gjør ingenting, eller Mattermost sier at den ikke kunne fullføre handlingen | Mattermost når ikke OneUptime. Se [Nettverk og selvhosting](#nettverk-og-selvhosting). |
| Ingen direktemelding med lenken din kommer frem | Sjekk brukernavnet, og at boten er i et team du er med i. |
