# Inntaksnøkler

En inntaksnøkkel kobler telemetrien din til prosjektet ditt. Applikasjoner, OpenTelemetry Collectors og agenter sender den med hver forespørsel, og OneUptime legger loggene, sporene og målingene deres i prosjektet nøkkelen tilhører. Denne siden viser hvordan du oppretter en nøkkel, hvilken type du skal velge, og hvordan du holder nøkler trygge. Se [Hvilken skal jeg bruke?](/docs/introduction/which-one#inntaksnøkkel-eller-api-nøkkel) for å skille en inntaksnøkkel fra en API-nøkkel.

:::cards
- [Opprett en inntaksnøkkel](#opprett-en-inntaksnøkkel): Et navn, en type og en hemmelighet å kopiere.
- [Server, Browser eller Mobil](#server-browser-eller-mobil): Hvilken type nøkkel en avsender trenger.
- [Lås ned en nettlesernøkkel](#lås-ned-en-nettlesernøkkel): Origins, ett tjenestenavn og en grense.
- [Bytt ut, slå av eller slett en nøkkel](#bytt-ut-slå-av-eller-slett-en-nøkkel): Hva du gjør når en nøkkel lekker.
:::

## Slik kontrolleres en nøkkel

Hver forespørsel bærer nøkkelens hemmelighet, vanligvis i en `x-oneuptime-token`-header. OneUptime slår opp nøkkelen, kontrollerer at den fortsatt kan sende, og først da godtar den dataene i nøkkelens prosjekt.

```mermaid title="Hva OneUptime kontrollerer før det godtar telemetri"
flowchart TB
    request["En forespørsel med<br/>x-oneuptime-token"] --> known{"Kjent, aktivert,<br/>ikke utløpt?"}
    known -->|"Ja"| origin{"Tillatt origin, for<br/>en nettlesernøkkel?"}
    origin -->|"Ja"| limit{"Under grensen sin?"}
    limit -->|"Ja"| accepted["Godtatt i<br/>nøkkelens prosjekt"]
    known -->|"Nei"| refused["Avvist, med en<br/>status som sier<br/>hvorfor"]
    origin -->|"Nei"| refused
    limit -->|"Nei"| refused
```

- **Nøkkelen bestemmer prosjektet.** Du sender aldri en prosjekt-ID: data som sendes med en nøkkel, havner i prosjektet nøkkelen tilhører.
- **Endringer når alle servere innen noen sekunder.** Å slå av en nøkkel, tilbakestille hemmeligheten eller endre origins, utløp eller grense trer i kraft på alle servere innen noen sekunder.
- **En nøkkel kan ha egne budsjetter.** Et daglig budsjett og en hastighet per sekund for hvert signal, innenfor prosjektets: se [Inntaksbudsjetter](/docs/telemetry/ingestion-budgets).
- **En servernøkkel er et passord.** Alle som har den, kan sende telemetri til prosjektet ditt. Oppbevar den blant serverens hemmeligheter, aldri i versjonskontroll, på en nettside eller i en mobilapp.

## Server, Browser eller Mobil

Velg typen etter hvor nøkkelen skal ligge. Typen kan ikke endres etter at nøkkelen er opprettet.

| | **Server** | **Nettleser** | **Mobil** |
| --- | --- | --- | --- |
| For | Applikasjoner, collectors og agenter på maskiner du drifter | Nettsider | Én iOS-, Android- eller React Native-app |
| Sender | All slags telemetri, til alle endepunkter | Spor, logger, målinger, Session Replays og [Sentry-hendelser](/docs/telemetry/compatible-endpoints#sentry-sdk-er) | Den appens spor, logger og målinger, over OTLP/HTTP, og dens Session Replays |
| En hemmelighet | Ja: hold den på serverne dine | Nei: alle som ser siden, kan lese den | Nei: alle som har appen, kan kopiere den |
| Origins | Kontrolleres ikke | Bare de oppførte origins godtas | En forespørsel fra en nettside avvises |
| Forespørsler per minutt | Ingen grense, med mindre du setter en | 6 000, med mindre du setter en annen grense | 6 000, med mindre du setter en annen grense |

Alle andre steder avviser OneUptime en nettlesernøkkel, for eksempel over gRPC og MQTT, for profiler, Syslog, Fluent Bit og Fluentd, og for opplasting av source maps, og en mobilnøkkel overalt unntatt for OTLP-spor, -logger og -målinger over HTTP og appens Session Replays. For å flytte en avsender til en annen type oppretter du en nøkkel av den typen, bytter avsenderen over til den og sletter deretter den gamle nøkkelen.

## Før du begynner

- **En rolle som administrerer inntaksnøkler.** Prosjekteier eller Prosjektadministrator, eller en egendefinert rolle med tillatelsen Create Ingestion Key. Telemetry-rollene omfatter ikke inntaksnøkler.
- **På OneUptime Cloud, en betalingsmåte.** Telemetri faktureres etter bruk, så et prosjekt på Free-abonnementet trenger en betalingsmåte før det kan opprette en nøkkel. Opprettelsesdialogen ender da med et trinn **Fakturering** som viser prisene.

## Opprett en inntaksnøkkel

:::steps
### Åpne inntaksnøkler

Gå til **Prosjektinnstillinger → Telemetri og APM → Inntaksnøkler**. **Telemetri og APM** starter sammenslått i sidemenyen: klikk på den for å åpne den. Listen viser for hver nøkkel kolonnene **Navn**, **Type**, **Sist brukt** og **Beskrivelse**.

### Gi nøkkelen et navn, og velg type

Klikk på **Opprett inntaksnøkkel**. Dialogen starter med navnet **Servernøkkel** og typen **Server**. Velg **Nøkkeltype**, og gi nøkkelen nytt navn etter det som skal bruke den, for eksempel `checkout-collector`. En **Beskrivelse** ligger under **Avansert**.

### Legg til origins for en nettlesernøkkel eller appen for en mobilnøkkel

En **Nettleser**-nøkkel ber om sine **Tillatte opprinnelser** i neste trinn, **Nettleserinnstillinger**, med sitt **Festet tjenestenavn** under **Avansert**. Se [Lås ned en nettlesernøkkel](#lås-ned-en-nettlesernøkkel). En **Mobil**-nøkkel ber i stedet om sitt **Festet tjenestenavn** på den første siden: `service.name` for appen den følger med i.

### Opprett nøkkelen, og kopier hemmeligheten

Klikk på **Opprett inntaksnøkkel**. Nøkkelens egen side åpnes: kopier **Hemmelig nøkkel**, og gi den til avsenderne dine.
:::

Hvert produkts **Oppsettveiledning** starter med **Velg en inntaksnøkkel**, som viser nøklene veiledningen kan bruke, og oppretter en på stedet. Kodesnuttene i veiledningen inneholder deretter den nøkkelen.

## Send telemetri med nøkkelen

Avsendere legger hemmeligheten i en `x-oneuptime-token`-header:

```text
x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_KEY
```

- OpenTelemetry-SDK-er leser den fra `OTEL_EXPORTER_OTLP_HEADERS`. Se [OpenTelemetry-hurtigstarten](/docs/telemetry/open-telemetry#hurtigstart).
- Over OTLP/gRPC går den i `x-oneuptime-token`-metadataene.
- En MQTT-enhet sender den som passordet sitt. Se [IoT-enheter](/docs/telemetry/iot-devices).
- OneUptime leser også nøkkelen fra en `x-oneuptime-ingestion-key`- eller `x-oneuptime-service-token`-header, som enkelte eldre oppsett sender.

## Lås ned en nettlesernøkkel

En nettlesernøkkel ligger i siden din, der alle kan kopiere den. Alt den sender, lagres som en nettleser-RUM-applikasjon, aldri som en vert, en klynge, en skyressurs, en database eller en backend-tjeneste: Av ressursen en avsender setter, beholder nøkkelen bare det en side sier om seg selv, som attributtene `service.*`, `browser.*` og `user_agent.*` og etikettene `oneuptime.label.*`. Disse innstillingene begrenser hva en kopi kan gjøre. Endre dem på nøkkelens side med **Rediger Inntaksnøkkel**.

| Innstilling | Hva den gjør |
| --- | --- |
| **Tillatte opprinnelser** | De eneste origins nøkkelen godtas fra. En forespørsel fra en hvilken som helst annen origin, eller helt uten `Origin`-header, avvises. En nettlesernøkkel må beholde minst én. |
| **Festet tjenestenavn** | Legger alt nøkkelen sender over OTLP/HTTP, under denne ene applikasjonen, uansett hvilket `service.name` avsenderen har satt. En kopi av nøkkelen kan da bare skrive til den applikasjonen. |
| **Grense for forespørsler per minutt** | Det største antallet forespørsler nøkkelen godtas for hvert minutt, delt av alle besøkende. En nettlesernøkkel får 6 000 når du lar feltet stå tomt. |
| **Utløper** | Datoen nøkkelen avvises etter, slik at en publisert kopi slutter å virke. |

En origin er et skjema, en vert og en valgfri port: `https://app.example.com` dekker ikke `https://app.example.com:8443`. Én innledende `*.` dekker alle underdomener, men ikke selve domenet. React Native Session Replay med en nettlesernøkkel sender en eksakt `app://`-identitet, som ikke tar noe jokertegn:

```json
[
  "https://app.example.com",
  "https://*.example.com",
  "app://com.example.mobile"
]
```

[Tjenester](/docs/telemetry/services#slik-kommer-en-tjeneste-inn-i-katalogen) viser hvordan et fastlåst navn bestemmer tjenesten. Kubernetes-agentens Runner og AI-agent, og infrastrukturens AI-agenter, registrerer seg ikke med en fastlåst nøkkel: gi dem en servernøkkel uten fastlåst navn.

## Hva en mobilnøkkel begrenser

En mobilnøkkel følger med i appen din, og alle som har appen, kan kopiere den. Disse grensene holder hver kopi til appen nøkkelen ble laget for:

- **Den skriver bare som én app.** Alt den sender, arkiveres under dens **Festet tjenestenavn** som en mobil RUM-applikasjon, uansett hvilken tjeneste eller vert avsenderen oppgir. En kopi kan ikke skrive i backend-tjenestene, vertene eller klyngene dine.
- **Den sender bare den appens telemetri.** OTLP-spor, -logger og -målinger over HTTP og appens Session Replays fra React Native-opptakeren dens, med nøkkelens **Festet tjenestenavn** som `appIdentifier`. Den avvises over gRPC og MQTT, for en annen apps Session Replays, profiler og source maps, på alle andre endepunkter og fra enhver nettside.
- **Den har en hastighetsgrense.** 6 000 forespørsler per minutt for alle kopier samlet, med mindre du setter dens **Grense for forespørsler per minutt**.
- **Du kan stoppe den.** Slå av **Aktivert**, eller sett **Utløper**, og hver kopi avvises i løpet av sekunder.

Hva den ikke kan hindre: Den som har appen din, kan fortsatt sende oppdiktede spor, logger, målinger og Session Replays for den ene appen, opp til nøkkelens grense, til du slår av nøkkelen eller den utløper. Bytt nøkkelen med utgivelsene dine, så en gammel kopi slutter å virke med sin versjon.

## Bytt ut, slå av eller slett en nøkkel

En nøkkels side viser **Status**, **Hemmelig nøkkel** bak **Klikk for å vise**, og **Sist brukt den**: siste gang OneUptime godtok data som ble sendt med den.

| For å | Gjør dette | Hva avsendere ser |
| --- | --- | --- |
| Stoppe en nøkkel med en gang, og kunne angre senere | Klikk på **Rediger Inntaksnøkkel**, åpne **Tilgang og grenser**, og slå av **Aktivert**. Statusen viser **Disabled — telemetry refused**. | `422` til du slår den på igjen |
| Erstatte en lekket hemmelighet | Klikk på **Tilbakestill hemmelig nøkkel**, og bekreft. Nøkkelen beholder innstillingene sine og får en ny hemmelighet. | `401` til de sender den nye hemmeligheten |
| Stoppe en nøkkel for godt | Klikk på **Slett Inntaksnøkkel** nederst på siden dens. | `401` |

For å bytte en hemmelighet uten å miste data oppretter du en ny nøkkel, flytter avsenderne dine over til den og sletter den gamle nøkkelen når **Sist brukt den** for den slutter å endre seg. **Sist brukt den** oppdateres hvert par minutter, ikke ved hver forespørsel.

## Feilsøking

En avvist forespørsel får en status og en setning som sier hvorfor.

Nøkkelens side teller også: **Avvist telemetri** viser hva som er avvist fra nøkkelen de siste 30 dagene, hvorfor, på hvilket endepunkt, hvor mange forespørsler og når. En manglende eller feilskrevet nøkkel hører ikke til noe prosjekt, så ingenting teller den.

| Svar | Hva det betyr |
| --- | --- |
| `401` med `Missing ingestion token` | Forespørselen har ingen nøkkel. Send den i `x-oneuptime-token`. |
| `401` med `Invalid ingestion token` | Ingen nøkkel har denne hemmeligheten: den er skrevet feil, tilbakestilt eller slettet. |
| `401` med `This telemetry ingestion key expired.` | Datoen i **Utløper** er passert. Sett en senere dato, eller bruk en annen nøkkel. |
| `402` med `Add a payment method` | På OneUptime Cloud er prosjektet på Free-abonnementet og har ingen betalingsmåte ennå. |
| `422` med `This telemetry ingestion key has been disabled.` | Noen har slått av **Aktivert**. |
| `422` med `A browser ingestion key cannot be used for` | En nettlesernøkkel nådde et endepunkt som bare tar servernøkler. |
| `422` med `did not send an Origin header` | En nettlesernøkkel ble sendt fra utenfor en nettleser. Bruk en mobilnøkkel i en mobilapp og en servernøkkel alle andre steder. |
| `422` med `A mobile ingestion key cannot be used for` | En mobilnøkkel nådde et annet endepunkt enn OTLP-spor, -logger og -målinger over HTTP og Session Replay, for eksempel gRPC eller profiler. |
| `422` med `A mobile ingestion key can send session replays only` | En mobilnøkkel sendte opptaket til en nettside, eller til en annen app. Gi React Native-opptakeren nøkkelens **Festet tjenestenavn** som `appIdentifier`. |
| `422` med `A mobile ingestion key cannot be used from a web page` | En mobilnøkkel ble sendt fra en nettleser. Bruk en nettlesernøkkel på en nettside. |
| `422` med `is not allowed for this browser ingestion key` | Sidens origin står ikke i **Tillatte opprinnelser**. |
| `422` med `is pinned to a single service` | En nøkkel med et **Festet tjenestenavn** ble brukt til å registrere en agent. Bruk en servernøkkel uten fastlåst navn. |
| `429` med `Too many telemetry requests for this ingestion key` | Nøkkelen nådde sin **Grense for forespørsler per minutt**. Eksportører prøver igjen etter `Retry-After`-tiden. |

For de andre svarene en OTLP-eksportør kan få, se [Svar](/docs/telemetry/open-telemetry#svar).

:::details Det kommer fortsatt data etter at jeg slo av nøkkelen
Hver OneUptime-server sjekker minst én gang i sekundet om en nøkkel er endret, så en endring når alle innen noen sekunder, og forespørsler etter det avvises. Mens en server ikke får kontakt med OneUptimes hurtigbuffer, kan den gå ut fra det den visste om nøkkelen i opptil ett minutt. En MQTT-klient som koblet til med nøkkelen, kobles fra innen noen sekunder.
:::

:::details En nettlesernøkkel virker på den bærbare maskinen min, men ikke i produksjon
En origin omfatter skjema og port. `http://localhost:3000` og `https://app.example.com` er forskjellige origins: før opp hver origin siden serveres fra.
:::

:::details Last Used At sier fortsatt Aldri
Ingenting har sendt data med denne nøkkelen siden OneUptime begynte å registrere bruken av den. Kontroller at avsenderne dine har denne nøkkelens hemmelighet, og at forespørslene deres når OneUptime.
:::

## Neste steg

:::cards
- [OpenTelemetry](/docs/telemetry/open-telemetry): Send spor, målinger og logger med nøkkelen din.
- [Tjenester](/docs/telemetry/services): Se tjenestene telemetrien din legges under.
- [Dataoppbevaring](/docs/telemetry/data-retention): Bestem hvor lenge dataene oppbevares.
- [Drop-filtre og scrub-regler](/docs/telemetry/drop-filters-and-scrub-rules): Forkast eller masker data før de lagres.
- [Inntaksbudsjetter](/docs/telemetry/ingestion-budgets): Begrens hvor mye hver nøkkel kan sende på en dag.
:::
