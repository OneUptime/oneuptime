# Drop-filtre og scrub-regler

Drop-filtre og scrub-regler virker på loggene og spansene dine mens de kommer inn, før noe blir lagret. Et drop-filter kaster postene du aldri trenger, eller beholder bare et utvalg av dem. En scrub-regel maskerer personopplysninger og hemmeligheter, som e-postadresser, kortnumre og passord, slik at de aldri når lagringen din.

:::cards
- [Hvor de kjører](#hvor-de-kjører): Før pipelines, før lagring.
- [Forkast poster eller ta utvalg](#forkast-poster-eller-ta-utvalg): Velg poster, og forkast dem eller behold en andel.
- [Rens sensitive data](#rens-sensitive-data): Sladd, masker eller hash det et mønster finner.
- [Se hva et filter forkastet](#se-hva-et-filter-forkastet): Tellere på hvert filter.
:::

## Hvor de kjører

Logger har sine under **Logger → Innstillinger**, og spans under **Spor → Innstillinger**. Når en post kommer inn, kjører OneUptime dem i denne rekkefølgen:

```mermaid title="Hva som skjer med en loggpost eller et span når den kommer inn"
flowchart TB
    arrive["En loggpost eller<br/>et span kommer inn"] --> drop{"Forkaster et<br/>drop-filter den?"}
    drop -->|"Ja"| gone["Forkastet:<br/>aldri lagret"]
    drop -->|"Nei"| scrub["Scrub-regler<br/>maskerer det<br/>de finner"]
    scrub --> pipelines["Pipelines endrer<br/>posten"]
    pipelines --> stored["Lagret, klar<br/>til søk"]
```

- **De virker bare på nye poster.** En regel du oppretter eller endrer, gjelder for poster som kommer inn omtrent ett minutt senere. Poster som allerede er lagret, endres ikke.
- **En forkastet post er borte.** Ingen søk, grafer, monitorer eller opptaksregler ser den noen gang, og det lages ikke noe unntak fra den. På OneUptime Cloud blir den heller ikke fakturert.
- **Hver liste kjører i rekkefølge.** Dra radene i en liste for å endre rekkefølgen. Bare aktiverte filtre og regler kjører.

Drop-filtre og scrub-regler for logger gjelder like mye for logger fra OpenTelemetry, Syslog, Fluent Bit og Fluentd. [Loggpipelines](/docs/telemetry/log-pipelines) forklarer trinnet etter dem.

## Før du begynner

- **Logger eller spans som kommer inn.** Se [OpenTelemetry](/docs/telemetry/open-telemetry).
- **En rolle som endrer telemetriinnstillinger.** Prosjekteier eller Prosjektadministrator, eller en egendefinert rolle med tillatelsen for det du endrer, som Create Log Drop Filter eller Create Trace Scrub Rule. Telemetry-rollene kan se filtre og regler, men ikke endre dem.

## Forkast poster eller ta utvalg

:::steps
### Åpne drop-filtre

Gå til **Logger → Innstillinger → Drop-filtre**, eller til **Spor → Innstillinger → Drop-filtre** for spans.

### Velg postene

Klikk på **Opprett Logg Drop Filter**, eller på **Opprett Trase-droppfilter** for spans. Under **Treff** gir du filteret et **Navn**, og deretter bygger du **Filterspørring**: et felt, en operator og en verdi for hver betingelse, og om **Alle betingelser** eller **En av betingelsene** må stemme. Klikk på **Neste**.

### Velg handlingen

Under **Handling** beholder du **Forkast** for å kaste hver post som stemmer, eller velger **Eksempel** og fyller inn **Prøveprosent** som skal beholdes, fra 1 til 99. Opprett deretter filteret.
:::

Filteret begynner å forkaste innen ett minutt. For å lagre det uten å forkaste noe ennå slår du av **Aktivert** under **Avansert** før du oppretter det.

> [!WARNING]
> En forkastet post kan ikke hentes tilbake. Hold spørringen til et filter smal, og følg med på **Forkastet**-telleren etter at du har opprettet det.

Et filter kan teste disse feltene, og alle attributter med **Custom Attribute...**:

| Poster | Felt |
| --- | --- |
| Logger | **Alvorlighetsgrad**, **Loggtekst**, **Tjeneste-ID** |
| Spans | **Span-navn**, **Span-type**, **Status**, **Statusmelding**, **Tjeneste-ID**, **Har unntak**, **Er rotspenn** |

| Operator | Treffer |
| --- | --- |
| **er lik** | Den eksakte verdien, med store og små bokstaver: `Debug` treffer, `DEBUG` gjør det ikke. |
| **er ikke lik** | Alt unntatt den eksakte verdien. |
| **inneholder** | Verdien hvor som helst i feltet, uavhengig av store og små bokstaver. En `%` i verdien er et jokertegn. |
| **er en av** | Én av en liste med eksakte verdier, skilt med komma. |

**Preview query** viser spørringen betingelsene danner. Denne forkaster debuglinjene fra en helsesjekk:

```text
severityText = 'Debug' AND body LIKE 'healthcheck'
```

Utvalget avgjøres post for post: med en **Prøveprosent** på 10 beholdes omtrent én av ti poster som stemmer. Filtrene kjører i listens rekkefølge, og det første som forkaster en post, avgjør; en post som et utvalg beholder, går videre til neste filter.

## Rens sensitive data

:::steps
### Åpne scrub-regler

Gå til **Logger → Innstillinger → Scrub-regler**, eller til **Spor → Innstillinger → Scrub-regler** for spans.

### Velg hva som skal finnes

Klikk på **Opprett Logg Scrub Regel**, eller på **Opprett Trace Scrub Regel** for spans, og velg en **Mønstertype**. Regelen får navn etter den, for eksempel **Masker e-postadresser**, til du skriver inn et eget navn. For **Egendefinert regex** fyller du også inn **Egendefinert regex-mønster**.

### Velg hvordan det skal renses

Under **Avansert** velger du **Maskeringshandling** og **Felt som skal renses**, eller lar dem stå som de er: en ny regel erstatter hvert treff med `[REDACTED]`, uansett hvor det står i posten. Opprett deretter regelen.
:::

| Mønstertype | Hva den finner |
| --- | --- |
| **E-postadresse** | E-postadresser, som `jane@example.com` |
| **Kredittkortnummer** | Seksten sifre i grupper på fire, som `4111 1111 1111 1111` |
| **SSN (personnummer)** | Amerikanske personnumre (Social Security), som `123-45-6789` |
| **Telefonnummer** | Nordamerikanske telefonnumre, som `555-123-4567` |
| **IP-adresse** | Offentlige IPv4- og IPv6-adresser, som `203.0.113.7` eller `2001:db8::1`, men ikke private, loopback- eller link-local-adresser |
| **Sensitive attributtnøkler** | Hele verdien av alle attributter med en nøkkel som ser hemmelig ut, som `password`, `token`, `api_key`, `authorization` eller `cookie` |
| **Egendefinert regex** | Ditt eget regulære uttrykk, skrevet uten skråstreker eller flagg, og sammenlignet med forskjell på store og små bokstaver |

| Maskeringshandling | Hva et treff blir |
| --- | --- |
| **Sladd** | `[REDACTED]`, standardvalget |
| **Maske** | For det meste skjult: en e-postadresse beholder første bokstav og slutten av domenet, et kort-, telefon- eller personnummer de fire siste sifrene, og et egendefinert treff eller en hemmelig verdi første og siste tegn. En IP-adresse skjules helt. |
| **Hash** | Et token som er unikt for prosjektet ditt, det samme for den samme verdien hver gang, slik at gjentakelser fortsatt kan telles, men ingen kan regne seg tilbake til verdien |

For eksempel lagrer en **E-postadresse**-regel denne loggteksten:

```text
Payment failed for jane@example.com
```

som én av disse, avhengig av **Maskeringshandling**:

```text
Redact: Payment failed for [REDACTED]
Mask:   Payment failed for j***@***.com
Hash:   Payment failed for [HASHED:5e29db14e508e09a]
```

**Felt som skal renses** er **Begge (brødtekst og attributter)** for en loggregel, med mindre du velger **Kun brødtekst** eller **Kun attributter**, og **Alle (navn, attributter og hendelser)** for en span-regel, med mindre du velger **Bare spennavn**, **Kun attributter** eller **Kun hendelsesattributter**. Attributtene til et spans lenker renses sammen med spanets egne attributter, og **Alle (navn, attributter og hendelser)** renser også et spans statusmelding og navnene på hendelsene dets. En **Sensitive attributtnøkler**-regel leser nøkler og renser derfor alltid verdiene under dem: i attributter og i en loggposts JSON-brødtekst.

- **En IP-adresseregel skjuler adressene som er personopplysninger.** Det er offentlige IPv4- og IPv6-adresser, uansett hvordan de er skrevet: forkortet, som `2001:db8::1`, i hakeparenteser med en port, som `[2001:db8::1]:443`, som beholder parentesene og porten, med en sone, som `2001:db8::2%eth0`, som beholder sonen, eller en IPv4-adresse skrevet som IPv6, som `::ffff:203.0.113.7`, som skjules helt. Den beholder private, loopback- og link-local-adresser, som `10.0.0.12`, `127.0.0.1` og `fe80::1`, og skyens metadataadresse `169.254.169.254` i URL-en til en forespørsel, der [Sikkerhetshendelser](/docs/telemetry/security-events) ser etter forfalskede forespørsler fra serveren. For å skjule interne adresser også, legg til en regel med **Egendefinert regex** for dem, som `\b(?:\d{1,3}\.){3}\d{1,3}\b` for alle IPv4-adresser.
- **Et hash-token tilhører prosjektet ditt.** Det lages med en nøkkel som tilhører prosjektet ditt, avledet fra installasjonens `ENCRYPTION_SECRET`, så den samme verdien har et annet token i et annet prosjekt, og ingen som leser et token, kan regne seg tilbake til verdien eller hashe en gjetning for å sammenligne. En IP-adresse har ett token uansett hvordan den er skrevet: `::ffff:203.0.113.7` og `203.0.113.7` deler ett. Poster som ble lagret før tokens hadde en nøkkel, inneholder tokens på 8 tegn, som `[HASHED:8c87b489]`, som er ulike dagens på 16 tegn: Søk etter begge til disse postene når slutten av oppbevaringen. Endrer du `ENCRYPTION_SECRET`, endres alle tokens, og på en selvhostet installasjon er tokens bare så hemmelige som den.
- **Sikkerhetshendelser kan fortsatt navngi en hashet IP-adresse.** Når [Sikkerhetshendelser](/docs/telemetry/security-events) leser loggene eller sporene dine, lagrer en IP-adresseregel som hasher, også hver adresse den skjuler, ved siden av tokenet, i et lager som bare skanningene til Sikkerhetshendelser leser: Ingen side, søk, eksport, API eller AI-verktøy kan lese det. Så et angrep fra en adresse som loggene dine bare viser som et token, navngir likevel adressen, og saken sier hvilken adresse som skal blokkeres. Hver adresse lagres til 30 dager etter at den sist ble sett. En regel som sletter eller maskerer adressen, lagrer ingenting, så Sikkerhetshendelser sier da at en scrub-regel skjulte adressen, slik den gjør for et token som er eldre enn 30 dager eller laget før tokener hadde en nøkkel.
- **Lister og nestede verdier leses også.** En regel leser hver tekst i en liste, en liste av lister eller en nøkkel-verdi-liste, som verdiene til en HTTP-header, og beholder verdiens form: tall og sann eller usann forblir som de er. En **Sensitive attributtnøkler**-regel leser også nøklene inne i en verdi, så `password` inne i en nøkkel-verdi-liste skjules også. Brødteksten i en loggpost som sendes som et map eller en liste, lagres som JSON-teksten sin, og en **Sensitive attributtnøkler**-regel leser nøklene i den, som i en brødtekst skrevet som JSON. En mønsterregel holder en slik brødtekst som JSON, og også et attributt skrevet som JSON, som meldingene i et AI-kall: Den leser teksten slik programmet ditt skrev den, med en escape-sekvens som `\n` lest som linjeskiftet den står for, og erstatter det den finner bare inne i tekstene og tallene.
- **JSON i en tekst leses også.** En tekst som selv er JSON, som et attributt `http.request.body` som inneholder `{"password":"hunter2"}`, eller `log`-linjen til en Fluentd-post inne i brødteksten til en loggpost, leses som JSON, opptil 4 nivåer med JSON inni hverandre, og dypere som tekst. En **Sensitive attributtnøkler**-regel skjuler verdiene under nøklene i den som ser hemmelige ut, og ingenting annet: Tallene, mellomrommene og de andre tekstene forblir slik programmet ditt skrev dem. En tekst som bare ligner JSON, som `{token}`, blir stående som den er.
- **En verdi som er for stor til å leses element for element, leses som tekst.** En verdi som er nestet mer enn 32 nivåer dypt, eller som ville tatt en post over 10 000 verdier inne i listene og mapene sine, leses og lagres som JSON-teksten sin. En mønsterregel renser det den finner i den teksten, og en **Sensitive attributtnøkler**-regel skjuler hele verdien når et ord som `password` eller `token` står i den. I brødteksten til en loggpost, og i JSON i en tekst, leses bare delen utenfor disse grensene som tekst: Resten leses fortsatt nøkkel for nøkkel.
- **Unntak kommer fra den rensede posten.** Et unntak som finnes i en loggpost, lages etter rensingen, og reglene som renser span-hendelser, renser også unntakene som er registrert på dem.
- **De rå kopiene av en syslog-linje skjuler det reglene skjulte i delene av den.** Syslog beholder de strukturerte dataene til en RFC 5424-linje slik de kom, i `syslog.structured.raw`, og syslog sendt over HTTP beholder hele linjen i `syslog.raw`. Hver kopi settes sammen på nytt av det reglene lot være igjen av feltene i headeren, hver parameter i de strukturerte dataene og meldingen, og reglene leser den deretter slik de leser et hvilket som helst attributt. Så et passord som en **Sensitive attributtnøkler**-regel skjuler i `syslog.structured.auth_1.password`, eller en adresse som en **Kun brødtekst**-regel skjuler i meldingen, er også skjult i kopiene, skrevet slik RFC 5424 skriver en verdi: `password="[REDACTED\]"`. En linje der reglene ikke endrer noe, beholder kopiene sine slik den kom.
- **En posts økt-ID beholdes.** En **Sensitive attributtnøkler**-regel skjuler en påloggingsøkt, som en `session_id`, en `sessionid` eller en informasjonskapsel, men beholder `session.id` når den inneholder økten loggposten eller spannet hører til: den tilfeldige ID-en som [Session Replay](/docs/telemetry/session-replay) arkiverer posten under, og som posten uansett beholder som sin økt. Samtale-ID-en til et AI-kall beholdes på samme måte. Ikke send hemmeligheten til en påloggingsøkt som `session.id`.
- **Session Replays renses også.** Scrub-regler for logger kjører også over Session Replay-opptak, i tillegg til maskeringen opptakeren gjør i nettleseren.
- **Regler kjører i listens rekkefølge.** Hver regel ser det reglene før den etterlot.
- **Et egendefinert mønster tar tid i forhold til posten.** Det beholder JavaScripts syntaks og svar, lookaheads og lookbehinds medregnet, uansett hvordan det er skrevet. En tilbakereferanse, som `\1`, kan ikke kjøres på den måten: en regel med en slik avvises når du lagrer den, slik et mønster som er for stort til å kjøres også gjør. Hvis det å finne hvert treff ville kreve at en lang verdi ble lest om og om igjen, renser regelen hele verdien. Et prosjekts drop-filtre, scrub-regler og pipelines deler også en arbeidskvote for hver bunt det sender, i forhold til buntens størrelse og nok til at dusinvis av egendefinerte mønstre kan lese hver verdi. Når mønstrene deres trenger mer, renser en egendefinert scrub-regel hele verdien, og et filter som ikke kan besvares, gjelder ikke for posten.

## Se hva et filter forkastet

Listen **Drop-filtre** viser for hvert filter **Forkastet**-telleren og når det sist forkastet noe, **Last Dropped**. **Nothing dropped yet** betyr at det aldri har truffet. Et filters egen side viser det samme under **Aktivitet**, oppdatert innen ett minutt etter en forkasting. Kortet **Filterbetingelser** viser hva det velger, og du kan endre betingelsene der.

## Feilsøking

:::details Et drop-filter forkaster ingenting
**er lik**, **er ikke lik** og **er en av** sammenligner eksakt tekst, inkludert store og små bokstaver. Alvorlighetsgradene heter `Information` og `Warning`, ikke `INFO` eller `WARN`. Kontroller at filteret er aktivert, og vent ett minutt etter en endring.
:::

:::details Logger jeg ventet, mangler
Se på **Forkastet**-telleren og tidspunktet for **Last Dropped** for hvert drop-filter. Slå av **Aktivert** på det du mistenker, og de neste loggene kommer inn igjen.
:::

:::details En egendefinert scrub-regel sier Maskerer ingenting
Mønsteret er tomt, ikke et gyldig regulært uttrykk eller kan ikke kjøres, for eksempel fordi det har en tilbakereferanse som `\1`, så den renser ingenting. Rediger regelen, og gi den et mønster som treffer minst ett tegn.
:::

:::details Gamle poster viser fortsatt dataene en ny regel renser
Scrub-regler virker når poster kommer inn. Poster som ble lagret før regelen, beholder det de hadde, til oppbevaringen deres utløper. Se [Dataoppbevaring](/docs/telemetry/data-retention).
:::

## Neste steg

:::cards
- [Loggpipelines](/docs/telemetry/log-pipelines): Tolk og berik loggene du beholder.
- [Loggutforsker](/docs/telemetry/logs-explorer): Søk i det som ble lagret.
- [Sporutforsker](/docs/telemetry/traces-explorer): Følg spansene du beholder.
- [Dataoppbevaring](/docs/telemetry/data-retention): Bestem hvor lenge de oppbevares.
:::
