# Hjelp og støtte

Rett hjelpen OneUptime tilbyr, mot ditt eget team: støtteadressen, chatten og hjelpesiden folk ser, hvor **Gi tilbakemelding** sendes, hva enkel pålogging sier til noen som trenger en invitasjon, og oppfordringene til å laste ned mobilappen. Hver av dem kan beholde OneUptimes egen, peke på en adresse eller lenke du har, eller skjules.

:::cards
- [Endre hvor hjelpen går](#endre-hvor-hjelpen-går): Én side i Admin Dashboard.
- [Hva hver innstilling endrer](#hva-hver-innstilling-endrer): Hvert sted, standarden og valgene.
- [Gi tilbakemelding](#gi-tilbakemelding): Hvor det folk skriver, sendes.
- [Påloggingsmeldingen](#påloggingsmeldingen): Hvem man skal be om en invitasjon.
- [Angi dem i konfigurasjonen din](#angi-dem-i-konfigurasjonen-din): Helm-verdier eller `config.env`, for en ny server.
:::

## Endre hvor hjelpen går

:::steps
### Åpne Hjelp og støtte
Åpne **Innstillinger** i Admin Dashboard, og deretter **Hjelp og støtte** i sidemenyen.

### Endre et sted
Velg **Endre** ved siden av det, velg **Standard**, en egen adresse eller lenke, eller **Skjul den**, og velg deretter **Lagre**. **Be om demo** og **Rapporter en feil eller be om en funksjon** er brytere som lagres så snart du slår dem av eller på.

### Sjekk hva folk ser
Hjelpemenyen og påloggingsskjermen forhåndsvises ved siden av innstillingene sine. Folk ser en endring neste gang de åpner en side.
:::

Så lenge du ikke endrer et sted, viser det det OneUptime alltid har vist, så en server som aldri åpner siden, ser nøyaktig ut som før.

## Hva hver innstilling endrer

| Innstilling | Hvor folk ser den | Standard | Egen |
| --- | --- | --- | --- |
| **Støtte-e-post** | Hjelp › **Støtte-e-post**, **Kontakt støtte** på siden som ikke ble funnet, konto-e-poster, og adressen en feilskjerm ber folk sende en støttepakke til | `support@oneuptime.com` | En e-postadresse |
| **Chat** | Hjelp › **Chat på Slack**, og chatlenken øverst i API-referansen | OneUptimes fellesskap på Slack | En lenke. En Slack- eller Microsoft Teams-lenke beholder navnet sitt; alle andre heter **Chat med støtte** |
| **Be om demo** | Hjelp › **Be om demo** | Vist | Bare skjult |
| **Gi tilbakemelding** | Hjelp › **Gi tilbakemelding**, og **Gi tilbakemelding** i Søk | Administratorene av denne serveren | En e-postadresse, eller din egen side |
| **Hjelp og støtte** | **Hjelp og støtte** i bunnteksten, **Kontakt** på påloggingssidene, og **Brukerstøtte** øverst i API-referansen | `https://oneuptime.com/support` | En lenke |
| **Rapporter en feil eller be om en funksjon** | Bunnen av produktmenyen, den offentlige GitHub-saken som tilbys etter tilbakemelding, og GitHub-lenkene i dokumentasjonen og API-referansen | Vist | Bare skjult |
| **Last ned mobilappen** | **Slik når man meg**, vaktoppsettet, et nytt medlems første steg på Hjem, og **Mobilapper** i **Prosjektinnstillinger** | App Store og Google Play | Din egen side, for eksempel bedriftsportalen i enhetsadministrasjonen din |
| **Melding til personer som trenger en invitasjon** | Skjermene for enkel pålogging som sier «You need to be invited.» og «No project access.» | OneUptimes setning | Dine egne ord |

Alle innstillinger unntatt meldingen kan også skjules. En lenke begynner med `https://`, `http://` eller `mailto:`. Alle andre typer lenker, deriblant `javascript:`, avvises av siden og igjen av serveren.

Admin Dashboards egen hjelpemeny, bunntekst og produktmeny beholder OneUptimes lenker: de er for administratorene av denne serveren, som får hjelp med serveren fra OneUptime.

### Konto-e-poster

På en selvhostet server avslutter konto-e-poster, som en invitasjon eller en endret e-postadresse, med å vise folk til administratoren av denne serveren, aldri til OneUptimes støtte. Med en egen støtteadresse nevner de den, som en lenke: «Trenger du hjelp? Skriv til it-help@example.com.» På standard, eller skjult, lyder de som de alltid har gjort.

### Dokumentasjonen og API-referansen

Dokumentasjonen og API-referansen denne serveren viser, følger de samme innstillingene. Med **Rapporter en feil eller be om en funksjon** skjult lenker ingen side til GitHub, og **Var denne siden nyttig?** spørres bare der svaret lagres eller sendes. Topplinjen i API-referansen viser chatten og hjelpesiden du har valgt, eller ingen av dem når de er skjult.

### Hvem kan lese lenkene dine

Støtteadressen og lenken **Hjelp og støtte** vises også på påloggingssidene, så alle som kan åpne de sidene, kan lese dem. En chatlenke og mobilappens side sendes bare til folk som er pålogget: en chatlenke er ofte en invitasjon inn i arbeidsområdet ditt. Av samme grunn viser dokumentasjonen og API-referansen, som alle kan lese, en egen chatlenke bare til noen som er pålogget denne serveren.

## Gi tilbakemelding

| Valg | Hva som skjer |
| --- | --- |
| **Standard** | Som alltid: sendt på e-post til **E-post for administratorvarslinger** som er angitt under **Innstillinger** › **E-poster**, eller lagret for administratorene av denne serveren i **Tilbakemeldinger** når det ikke finnes noen. På OneUptime Cloud går den til OneUptime-teamet. |
| **En e-postadresse** | Sendt dit på e-post via e-postinnstillingene på denne serveren, med personens navn og e-postadresse, så teamet ditt kan svare. Personen får en kopi. |
| **Din egen side** | **Gi tilbakemelding** åpner den i en ny fane, for eksempel skjemaet til brukerstøtten din. Ingenting sendes fra OneUptime. |
| **Skjul «Gi tilbakemelding»** | **Gi tilbakemelding** tilbys ingen steder. |

Så lenge serveren ikke kan sende e-post, skjuler et valg av en e-postadresse **Gi tilbakemelding** i stedet for å ta imot en melding som ikke kan nå teamet ditt, og innstillingssiden sier fra om det. Sett opp e-post under **Innstillinger** › **E-poster**, så kommer **Gi tilbakemelding** tilbake av seg selv.

Spørsmålene OneUptime stiller, for eksempel hvor enkelt et veiledet oppsett var, er ikke **Gi tilbakemelding**: svarene blir værende i **Tilbakemeldinger**, der **Spør hvordan det gikk** slår dem av.

## Påloggingsmeldingen

Serverens egen enkle pålogging avviser to typer personer: noen uten konto, når leverandøren ikke oppretter noen («You need to be invited.»), og noen med en konto som ikke er i noe prosjekt («No project access.»). Begge trenger en invitasjon, så begge skjermene viser meldingen din, med hvem de skal spørre og hvordan de når vedkommende:

```text
Ask the IT service desk to invite you to OneUptime:
it-help@example.com or https://help.example.com/oneuptime
```

- Meldingen er ren tekst på opptil 1000 tegn og kan ikke inneholde `<` eller `>`.
- Hver linje er et avsnitt, og lenker og e-postadresser i den blir lenker.
- Skjermens tittel forblir som den er, og mobilappen viser de samme ordene.

## Oppfordringene til mobilappen

Med din egen side peker hver oppfordring til å laste ned mobilappen dit: én QR-kode for siden din, navngitt etter adressen, og stegene nevner fortsatt adressen til denne serveren, som appen skal koble til. Skjult finnes det ingen oppfordring i det hele tatt:

- **Last ned mobilappen** forsvinner fra et nytt medlems første steg på Hjem, som fortsatt fullføres når personen kan nås og et testoppkall har nådd vedkommende.
- **Slik når man meg** og vaktoppsettet tilbyr bare nettlesere.
- **Mobilapper** forsvinner fra **Prosjektinnstillinger**.
- Overalt der OneUptime ramser opp måtene å nå noen på, som i de veiledede oppsettene, på Hjem, i et teams samsvarsregler og i Spør AI, nevner det ikke lenger appen blant dem.

## Angi dem i konfigurasjonen din

En server som er installert med Helm eller Docker Compose, kan starte med disse innstillingene allerede på plass. Angi dem i `helpAndSupport`-verdiene i Helm-chartet, eller i `config.env` for Docker Compose:

```yaml
helpAndSupport:
  supportEmail: it-help@example.com
  chat: https://example.slack.com/archives/C024BE91L
  requestDemo: hidden
  gitHub: hidden
  inviteMessage: |
    Ask the IT service desk to invite you to OneUptime:
    it-help@example.com
```

| Helm-verdi | `config.env` | Hva den tar |
| --- | --- | --- |
| `supportEmail` | `HELP_AND_SUPPORT_SUPPORT_EMAIL` | En e-postadresse, eller `hidden` |
| `chat` | `HELP_AND_SUPPORT_CHAT` | En lenke, eller `hidden` |
| `requestDemo` | `HELP_AND_SUPPORT_REQUEST_DEMO` | `shown` eller `hidden` |
| `giveFeedback` | `HELP_AND_SUPPORT_GIVE_FEEDBACK` | En e-postadresse, en lenke, eller `hidden` |
| `helpLink` | `HELP_AND_SUPPORT_HELP_LINK` | En lenke, eller `hidden` |
| `gitHub` | `HELP_AND_SUPPORT_GITHUB` | `shown` eller `hidden` |
| `mobileApp` | `HELP_AND_SUPPORT_MOBILE_APP` | En lenke, eller `hidden` |
| `inviteMessage` | `HELP_AND_SUPPORT_INVITE_MESSAGE` | Ren tekst |

- De leses når serveren starter, bare så lenge ingenting er lagret under **Hjelp og støtte**. Fra da av er det siden som har innstillingene: en endring som gjøres der, beholdes, og en omstart setter den aldri tilbake.
- En verdi som endres i konfigurasjonen senere, tas ikke i bruk, og serverens logg sier fra. Endre den på siden.
- Hver verdi kontrolleres slik siden kontrollerer den. En verdi som ville blitt avvist, som en `javascript:`-lenke, utelates, og siden og serverens logg sier hvorfor. De andre angis likevel.
- La en verdi stå tom for å beholde OneUptimes standard. `true` og `false` virker også for de to bryterne.
- Siden markerer hver innstilling som kom fra konfigurasjonen din, til du endrer den.

## Neste steg

:::cards
- [Global SSO](/docs/identity/global-sso): Serverens egen enkle pålogging.
- [Øktlengde](/docs/self-hosted/session-length): Hvor lenge folk forblir pålogget.
:::
