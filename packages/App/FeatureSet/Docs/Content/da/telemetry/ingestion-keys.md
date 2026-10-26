# Indtagelsesnøgler

En indtagelsesnøgle forbinder din telemetri med dit projekt. Applikationer, OpenTelemetry Collectors og agenter sender den med hver anmodning, og OneUptime lægger deres protokoller, spor og metrikker i det projekt, nøglen tilhører. Denne side viser, hvordan du opretter en nøgle, hvilken type du skal vælge, og hvordan du holder nøgler sikre.

:::cards
- [Opret en indtagelsesnøgle](#opret-en-indtagelsesnøgle): Et navn, en type og en hemmelighed at kopiere.
- [Server eller Browser](#server-eller-browser): Hvilken slags nøgle en afsender har brug for.
- [Lås en browsernøgle ned](#lås-en-browsernøgle-ned): Origins, ét tjenestenavn og en grænse.
- [Udskift, slå fra eller slet en nøgle](#udskift-slå-fra-eller-slet-en-nøgle): Hvad du gør, når en nøgle lækker.
:::

## Sådan kontrolleres en nøgle

Hver anmodning bærer nøglens hemmelighed, normalt i en `x-oneuptime-token`-header. OneUptime slår nøglen op, kontrollerer, at den stadig må sende, og først da accepterer den dataene i nøglens projekt.

```mermaid title="Hvad OneUptime kontrollerer, før det accepterer telemetri"
flowchart TB
    request["En anmodning med<br/>x-oneuptime-token"] --> known{"Kendt, aktiveret,<br/>ikke udløbet?"}
    known -->|"Ja"| origin{"Tilladt origin, for<br/>en browsernøgle?"}
    origin -->|"Ja"| limit{"Under sin grænse?"}
    limit -->|"Ja"| accepted["Accepteret i<br/>nøglens projekt"]
    known -->|"Nej"| refused["Afvist, med en<br/>status, der siger<br/>hvorfor"]
    origin -->|"Nej"| refused
    limit -->|"Nej"| refused
```

- **Nøglen bestemmer projektet.** Du sender aldrig et projekt-ID: data, der sendes med en nøgle, havner i det projekt, nøglen tilhører.
- **Ændringer når ud til alle servere inden for et minut.** At slå en nøgle fra, nulstille dens hemmelighed eller ændre dens origins, udløb eller grænse træder i kraft inden for cirka et minut.
- **En servernøgle er en adgangskode.** Alle, der har den, kan sende telemetri til dit projekt. Opbevar den i dine serveres hemmeligheder, aldrig i versionsstyring eller på en webside.

## Server eller Browser

Vælg typen efter, hvor nøglen skal ligge. Typen kan ikke ændres, efter at nøglen er oprettet.

| | **Server** | **Browser** |
| --- | --- | --- |
| Til | Applikationer, collectors og agenter på maskiner, du driver | Websider, og React Native Session Replay |
| Sender | Alle slags telemetri, til alle endpoints | Spor, protokoller, metrikker og Session Replays |
| En hemmelighed | Ja: hold den på dine servere | Nej: alle, der ser siden, kan læse den |
| Origins | Kontrolleres ikke | Kun de angivne origins accepteres |
| Anmodninger pr. minut | Ingen grænse, medmindre du angiver en | 6.000, medmindre du angiver en anden grænse |

Alle andre steder afviser OneUptime en browsernøgle, for eksempel over gRPC og MQTT, for profiler, Syslog, Fluent Bit og Fluentd, og for upload af source maps. For at flytte en afsender til den anden type skal du oprette en nøgle af den type, skifte afsenderen over til den og derefter slette den gamle nøgle.

## Før du begynder

- **En rolle, der administrerer indtagelsesnøgler.** Project Owner eller Project Admin, eller en brugerdefineret rolle med tilladelsen Create Telemetry Ingestion Key. Telemetry-rollerne omfatter ikke indtagelsesnøgler.
- **På OneUptime Cloud, en betalingsmetode.** Telemetri faktureres efter forbrug, så et projekt på Free-abonnementet skal have en betalingsmetode, før det kan oprette en nøgle. Oprettelsesdialogen slutter så med et trin **Fakturering**, der viser priserne.

## Opret en indtagelsesnøgle

:::steps
### Åbn indtagelsesnøgler

Gå til **Projektindstillinger → Telemetri og APM → Indtagelsesnøgler**. **Telemetri og APM** starter sammenklappet i sidemenuen: klik på den for at åbne den. Listen viser for hver nøgle kolonnerne **Navn**, **Type**, **Last Used** og **Beskrivelse**.

### Navngiv nøglen, og vælg dens type

Klik på **Opret ingestion-nøgle**. Dialogen starter med navnet **Servernøgle** og typen **Server**. Vælg **Nøgletype**, og omdøb nøglen efter det, der skal bruge den, for eksempel `checkout-collector`. En **Beskrivelse** ligger under **Avanceret**.

### Tilføj en browsernøgles origins

En **Browser**-nøgle beder om sine **Tilladte oprindelser** i det næste trin, **Browserindstillinger**, med sit **Fastgjort tjenestenavn** under **Avanceret**. Se [Lås en browsernøgle ned](#lås-en-browsernøgle-ned).

### Opret nøglen, og kopiér dens hemmelighed

Klik på **Opret ingestion-nøgle**. Nøglens egen side åbner: kopiér dens **Hemmelig nøgle**, og giv den til dine afsendere.
:::

Hvert produkts **Opsætningsvejledning** starter med **Vælg en ingestion-nøgle**, som viser de nøgler, vejledningen kan bruge, og opretter en på stedet. Kodestumperne i vejledningen indeholder derefter den nøgle.

## Send telemetri med nøglen

Afsendere lægger hemmeligheden i en `x-oneuptime-token`-header:

```text
x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_KEY
```

- OpenTelemetry-SDK'er læser den fra `OTEL_EXPORTER_OTLP_HEADERS`. Se [OpenTelemetry-kvikstarten](/docs/telemetry/open-telemetry#kom-hurtigt-i-gang).
- Over OTLP/gRPC går den i `x-oneuptime-token`-metadataene.
- En MQTT-enhed sender den som sin adgangskode. Se [IoT-enheder](/docs/telemetry/iot-devices).
- OneUptime læser også nøglen fra en `x-oneuptime-ingestion-key`- eller `x-oneuptime-service-token`-header, som nogle ældre opsætninger sender.

## Lås en browsernøgle ned

En browsernøgle ligger i din side, hvor alle kan kopiere den. Disse indstillinger begrænser, hvad en kopi kan gøre. Ændr dem på nøglens side med **Rediger Telemetri Ingestion Key**.

| Indstilling | Hvad den gør |
| --- | --- |
| **Tilladte oprindelser** | De eneste origins, nøglen accepteres fra. En anmodning fra enhver anden origin, eller helt uden `Origin`-header, afvises. En browsernøgle skal beholde mindst én. |
| **Fastgjort tjenestenavn** | Lægger alt, hvad nøglen sender over OTLP/HTTP, under denne ene tjeneste, uanset hvilket `service.name` afsenderen har sat. En kopi af nøglen kan så kun skrive til den tjeneste. |
| **Requests Per Minute Limit** | Det største antal anmodninger, nøglen accepteres for hvert minut, delt af alle besøgende. En browsernøgle får 6.000, når du lader feltet stå tomt. |
| **Udløber den** | Datoen, hvorefter nøglen afvises, så en offentliggjort kopi holder op med at virke. |

En origin er et skema, en vært og en valgfri port: `https://app.example.com` dækker ikke `https://app.example.com:8443`. Én indledende `*.` dækker alle underdomæner, men ikke selve domænet. React Native Session Replay sender en præcis `app://`-identitet, som ikke tager noget jokertegn:

```json
[
  "https://app.example.com",
  "https://*.example.com",
  "app://com.example.mobile"
]
```

[Tjenestekataloget](/docs/telemetry/services#sådan-kommer-en-tjeneste-ind-i-kataloget) viser, hvordan et fastlåst navn bestemmer tjenesten. Kubernetes-agentens Runner og AI-agent og infrastrukturens AI-agenter registrerer sig ikke med en fastlåst nøgle: giv dem en servernøgle uden fastlåst navn.

## Udskift, slå fra eller slet en nøgle

En nøgles side viser dens **Status**, dens **Hemmelig nøgle** bag **Click to reveal** og dens **Last Used At**: sidste gang OneUptime accepterede data, der blev sendt med den.

| For at | Gør dette | Hvad afsendere ser |
| --- | --- | --- |
| Stoppe en nøgle med det samme og kunne fortryde det senere | Klik på **Rediger Telemetri Ingestion Key**, åbn **Adgang og grænser**, og slå **Aktiveret** fra. Statussen viser **Disabled — telemetry refused**. | `422`, indtil du slår den til igen |
| Erstatte en lækket hemmelighed | Klik på **Nulstil hemmelig nøgle**, og bekræft. Nøglen beholder sine indstillinger og får en ny hemmelighed. | `401`, indtil de sender den nye hemmelighed |
| Stoppe en nøgle for altid | Klik på **Slet Telemetri Ingestion Key** nederst på dens side. | `401` |

For at skifte en hemmelighed uden at miste data skal du oprette en ny nøgle, flytte dine afsendere over til den og slette den gamle nøgle, når dens **Last Used At** holder op med at ændre sig. **Last Used At** opdateres hvert par minutter, ikke ved hver anmodning.

## Fejlfinding

En afvist anmodning får en status og en sætning, der siger hvorfor.

| Svar | Hvad det betyder |
| --- | --- |
| `401` med `Missing ingestion token` | Anmodningen har ingen nøgle. Send den i `x-oneuptime-token`. |
| `401` med `Invalid ingestion token` | Ingen nøgle har denne hemmelighed: den er tastet forkert, nulstillet eller slettet. |
| `401` med `This telemetry ingestion key expired.` | Dens **Udløber den** er passeret. Angiv en senere dato, eller brug en anden nøgle. |
| `402` med `Add a payment method` | På OneUptime Cloud er projektet på Free-abonnementet og har endnu ingen betalingsmetode. |
| `422` med `This telemetry ingestion key has been disabled.` | Nogen har slået **Aktiveret** fra. |
| `422` med `A browser ingestion key cannot be used for` | En browsernøgle nåede et endpoint, der kun tager servernøgler. |
| `422` med `did not send an Origin header` | En browsernøgle blev sendt uden for en browser. Brug en servernøgle der. |
| `422` med `is not allowed for this browser ingestion key` | Sidens origin er ikke i **Tilladte oprindelser**. |
| `422` med `is pinned to a single service` | En nøgle med et **Fastgjort tjenestenavn** blev brugt til at registrere en agent. Brug en servernøgle uden fastlåst navn. |
| `429` med `Too many telemetry requests for this ingestion key` | Nøglen nåede sin **Requests Per Minute Limit**. Eksportører prøver igen efter `Retry-After`-tiden. |

For de andre svar, en OTLP-eksportør kan få, se [Svar](/docs/telemetry/open-telemetry#svar).

:::details Der kommer stadig data et minut efter, at jeg slog nøglen fra
Hver OneUptime-server husker, hvad den ved om en nøgle, i op til et minut, så en ændring når ud til dem alle inden for cirka et minut. Anmodninger derefter afvises.
:::

:::details En browsernøgle virker på min bærbare, men ikke i produktion
En origin omfatter sit skema og sin port. `http://localhost:3000` og `https://app.example.com` er forskellige origins: angiv hver enkelt, siden serveres fra.
:::

:::details Last Used At siger stadig Aldrig
Intet har sendt data med denne nøgle, siden OneUptime begyndte at registrere brugen af den. Kontrollér, at dine afsendere har denne nøgles hemmelighed, og at deres anmodninger når frem til OneUptime.
:::

## Næste skridt

:::cards
- [OpenTelemetry](/docs/telemetry/open-telemetry): Send spor, metrikker og protokoller med din nøgle.
- [Tjenestekatalog](/docs/telemetry/services): Se de tjenester, din telemetri lægges under.
- [Dataopbevaring](/docs/telemetry/data-retention): Bestem, hvor længe dataene opbevares.
- [Drop-filtre og scrub-regler](/docs/telemetry/drop-filters-and-scrub-rules): Kassér eller maskér data, før de gemmes.
:::
