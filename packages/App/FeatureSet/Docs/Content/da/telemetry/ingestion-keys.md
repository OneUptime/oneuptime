# Indtagelsesnøgler

En indtagelsesnøgle forbinder din telemetri med dit projekt. Applikationer, OpenTelemetry Collectors og agenter sender den med hver anmodning, og OneUptime lægger deres protokoller, spor og metrikker i det projekt, nøglen tilhører. Denne side viser, hvordan du opretter en nøgle, hvilken type du skal vælge, og hvordan du holder nøgler sikre. Se [Hvilken skal jeg bruge?](/docs/introduction/which-one#indtagelsesnøgle-eller-api-nøgle) for at kende forskel på en indtagelsesnøgle og en API-nøgle.

:::cards
- [Opret en indtagelsesnøgle](#opret-en-indtagelsesnøgle): Et navn, en type og en hemmelighed at kopiere.
- [Server, Browser eller Mobil](#server-browser-eller-mobil): Hvilken slags nøgle en afsender har brug for.
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
- **Ændringer når ud til alle servere inden for få sekunder.** At slå en nøgle fra, nulstille dens hemmelighed eller ændre dens origins, udløb eller grænse træder i kraft på alle servere inden for få sekunder.
- **En nøgle kan have sine egne budgetter.** Et dagligt budget og en hastighed pr. sekund for hvert signal, inden for dens projekts: se [Indtagelsesbudgetter](/docs/telemetry/ingestion-budgets).
- **En servernøgle er en adgangskode.** Alle, der har den, kan sende telemetri til dit projekt. Opbevar den i dine serveres hemmeligheder, aldrig i versionsstyring, på en webside eller i en mobilapp.

## Server, Browser eller Mobil

Vælg typen efter, hvor nøglen skal ligge. Typen kan ikke ændres, efter at nøglen er oprettet.

| | **Server** | **Browser** | **Mobil** |
| --- | --- | --- | --- |
| Til | Applikationer, collectors og agenter på maskiner, du driver | Websider | Én iOS-, Android- eller React Native-app |
| Sender | Alle slags telemetri, til alle endpoints | Spor, protokoller, metrikker, Session Replays og [Sentry-hændelser](/docs/telemetry/compatible-endpoints#sentry-sdker) | Den apps spor, protokoller og metrikker, over OTLP/HTTP, og dens Session Replays |
| En hemmelighed | Ja: hold den på dine servere | Nej: alle, der ser siden, kan læse den | Nej: alle, der har appen, kan kopiere den |
| Origins | Kontrolleres ikke | Kun de angivne origins accepteres | En anmodning fra en webside afvises |
| Anmodninger pr. minut | Ingen grænse, medmindre du angiver en | 6.000, medmindre du angiver en anden grænse | 6.000, medmindre du angiver en anden grænse |

Alle andre steder afviser OneUptime en browsernøgle, for eksempel over gRPC og MQTT, for profiler, Syslog, Fluent Bit og Fluentd, og for upload af source maps, og en mobilnøgle alle steder undtagen for OTLP-spor, -protokoller og -metrikker over HTTP og dens apps Session Replays. For at flytte en afsender til en anden type skal du oprette en nøgle af den type, skifte afsenderen over til den og derefter slette den gamle nøgle.

## Før du begynder

- **En rolle, der administrerer indtagelsesnøgler.** Projektejer eller Projektadministrator, eller en brugerdefineret rolle med tilladelsen Create Ingestion Key. Telemetry-rollerne omfatter ikke indtagelsesnøgler.
- **På OneUptime Cloud, en betalingsmetode.** Telemetri faktureres efter forbrug, så et projekt på Free-abonnementet skal have en betalingsmetode, før det kan oprette en nøgle. Oprettelsesdialogen slutter så med et trin **Fakturering**, der viser priserne.

## Opret en indtagelsesnøgle

:::steps
### Åbn indtagelsesnøgler

Gå til **Projektindstillinger → Telemetri og APM → Indtagelsesnøgler**. **Telemetri og APM** starter sammenklappet i sidemenuen: klik på den for at åbne den. Listen viser for hver nøgle kolonnerne **Navn**, **Type**, **Sidst brugt** og **Beskrivelse**.

### Navngiv nøglen, og vælg dens type

Klik på **Opret indtagelsesnøgle**. Dialogen starter med navnet **Servernøgle** og typen **Server**. Vælg **Nøgletype**, og omdøb nøglen efter det, der skal bruge den, for eksempel `checkout-collector`. En **Beskrivelse** ligger under **Avanceret**.

### Tilføj en browsernøgles origins eller en mobilnøgles app

En **Browser**-nøgle beder om sine **Tilladte oprindelser** i det næste trin, **Browserindstillinger**, med sit **Fastgjort tjenestenavn** under **Avanceret**. Se [Lås en browsernøgle ned](#lås-en-browsernøgle-ned). En **Mobil**-nøgle beder i stedet om sit **Fastgjort tjenestenavn** på den første side: `service.name` for den app, den følger med i.

### Opret nøglen, og kopiér dens hemmelighed

Klik på **Opret indtagelsesnøgle**. Nøglens egen side åbner: kopiér dens **Hemmelig nøgle**, og giv den til dine afsendere.
:::

Hvert produkts **Opsætningsvejledning** starter med **Vælg en indtagelsesnøgle**, som viser de nøgler, vejledningen kan bruge, og opretter en på stedet. Kodestumperne i vejledningen indeholder derefter den nøgle.

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

En browsernøgle ligger i din side, hvor alle kan kopiere den. Alt, hvad den sender, gemmes som en browser-RUM-applikation, aldrig som en vært, en klynge, en cloudressource, en database eller en backend-tjeneste: Af den ressource, en afsender sætter, beholder nøglen kun det, en side siger om sig selv, såsom attributterne `service.*`, `browser.*` og `user_agent.*` og etiketterne `oneuptime.label.*`. Disse indstillinger begrænser, hvad en kopi kan gøre. Ændr dem på nøglens side med **Rediger Indtagelsesnøgle**.

| Indstilling | Hvad den gør |
| --- | --- |
| **Tilladte oprindelser** | De eneste origins, nøglen accepteres fra. En anmodning fra enhver anden origin, eller helt uden `Origin`-header, afvises. En browsernøgle skal beholde mindst én. |
| **Fastgjort tjenestenavn** | Lægger alt, hvad nøglen sender over OTLP/HTTP, under denne ene applikation, uanset hvilket `service.name` afsenderen har sat. En kopi af nøglen kan så kun skrive til den applikation. |
| **Grænse for anmodninger pr. minut** | Det største antal anmodninger, nøglen accepteres for hvert minut, delt af alle besøgende. En browsernøgle får 6.000, når du lader feltet stå tomt. |
| **Udløber den** | Datoen, hvorefter nøglen afvises, så en offentliggjort kopi holder op med at virke. |

En origin er et skema, en vært og en valgfri port: `https://app.example.com` dækker ikke `https://app.example.com:8443`. Én indledende `*.` dækker alle underdomæner, men ikke selve domænet. React Native Session Replay med en browsernøgle sender en præcis `app://`-identitet, som ikke tager noget jokertegn:

```json
[
  "https://app.example.com",
  "https://*.example.com",
  "app://com.example.mobile"
]
```

[Tjenester](/docs/telemetry/services#sådan-kommer-en-tjeneste-ind-i-kataloget) viser, hvordan et fastlåst navn bestemmer tjenesten. Kubernetes-agentens Runner og AI-agent og infrastrukturens AI-agenter registrerer sig ikke med en fastlåst nøgle: giv dem en servernøgle uden fastlåst navn.

## Hvad en mobilnøgle begrænser

En mobilnøgle følger med i din app, og alle, der har appen, kan kopiere den. Disse grænser holder hver kopi til den app, nøglen blev lavet til:

- **Den skriver kun som én app.** Alt, hvad den sender, arkiveres under dens **Fastgjort tjenestenavn** som en mobil RUM-applikation, uanset hvilken tjeneste eller vært afsenderen angiver. En kopi kan ikke skrive i dine backend-tjenester, værter eller klynger.
- **Den sender kun den apps telemetri.** OTLP-spor, -protokoller og -metrikker over HTTP og appens Session Replays fra dens React Native-optager, med nøglens **Fastgjort tjenestenavn** som `appIdentifier`. Den afvises over gRPC og MQTT, for en anden apps Session Replays, profiler og source maps, på alle andre endpoints og fra enhver webside.
- **Den har en hastighedsgrænse.** 6.000 anmodninger pr. minut for alle kopier tilsammen, medmindre du sætter dens **Grænse for anmodninger pr. minut**.
- **Du kan stoppe den.** Slå **Aktiveret** fra, eller sæt **Udløber den**, og hver kopi afvises inden for få sekunder.

Hvad den ikke kan forhindre: Den, der har din app, kan stadig sende opdigtede spor, protokoller, metrikker og Session Replays for den ene app, op til nøglens grænse, indtil du slår nøglen fra, eller den udløber. Udskift nøglen med dine udgivelser, så en gammel kopi holder op med at virke med sin version.

## Udskift, slå fra eller slet en nøgle

En nøgles side viser dens **Status**, dens **Hemmelig nøgle** bag **Klik for at vise** og dens **Senest brugt den**: sidste gang OneUptime accepterede data, der blev sendt med den.

| For at | Gør dette | Hvad afsendere ser |
| --- | --- | --- |
| Stoppe en nøgle med det samme og kunne fortryde det senere | Klik på **Rediger Indtagelsesnøgle**, åbn **Adgang og grænser**, og slå **Aktiveret** fra. Statussen viser **Disabled — telemetry refused**. | `422`, indtil du slår den til igen |
| Erstatte en lækket hemmelighed | Klik på **Nulstil hemmelig nøgle**, og bekræft. Nøglen beholder sine indstillinger og får en ny hemmelighed. | `401`, indtil de sender den nye hemmelighed |
| Stoppe en nøgle for altid | Klik på **Slet Indtagelsesnøgle** nederst på dens side. | `401` |

For at skifte en hemmelighed uden at miste data skal du oprette en ny nøgle, flytte dine afsendere over til den og slette den gamle nøgle, når dens **Senest brugt den** holder op med at ændre sig. **Senest brugt den** opdateres hvert par minutter, ikke ved hver anmodning.

## Fejlfinding

En afvist anmodning får en status og en sætning, der siger hvorfor.

Nøglens side tæller også med: **Afvist telemetri** viser, hvad der er afvist fra nøglen de seneste 30 dage, hvorfor, på hvilket endpoint, hvor mange anmodninger og hvornår. En manglende eller forkert indtastet nøgle hører ikke til noget projekt, så intet tæller den.

| Svar | Hvad det betyder |
| --- | --- |
| `401` med `Missing ingestion token` | Anmodningen har ingen nøgle. Send den i `x-oneuptime-token`. |
| `401` med `Invalid ingestion token` | Ingen nøgle har denne hemmelighed: den er tastet forkert, nulstillet eller slettet. |
| `401` med `This telemetry ingestion key expired.` | Dens **Udløber den** er passeret. Angiv en senere dato, eller brug en anden nøgle. |
| `402` med `Add a payment method` | På OneUptime Cloud er projektet på Free-abonnementet og har endnu ingen betalingsmetode. |
| `422` med `This telemetry ingestion key has been disabled.` | Nogen har slået **Aktiveret** fra. |
| `422` med `A browser ingestion key cannot be used for` | En browsernøgle nåede et endpoint, der kun tager servernøgler. |
| `422` med `did not send an Origin header` | En browsernøgle blev sendt uden for en browser. Brug en mobilnøgle i en mobilapp og en servernøgle alle andre steder. |
| `422` med `A mobile ingestion key cannot be used for` | En mobilnøgle nåede et andet endpoint end OTLP-spor, -protokoller og -metrikker over HTTP og Session Replay, for eksempel gRPC eller profiler. |
| `422` med `A mobile ingestion key can send session replays only` | En mobilnøgle sendte en websides optagelse eller en anden apps. Giv React Native-optageren nøglens **Fastgjort tjenestenavn** som `appIdentifier`. |
| `422` med `A mobile ingestion key cannot be used from a web page` | En mobilnøgle blev sendt fra en browser. Brug en browsernøgle på en webside. |
| `422` med `is not allowed for this browser ingestion key` | Sidens origin er ikke i **Tilladte oprindelser**. |
| `422` med `is pinned to a single service` | En nøgle med et **Fastgjort tjenestenavn** blev brugt til at registrere en agent. Brug en servernøgle uden fastlåst navn. |
| `429` med `Too many telemetry requests for this ingestion key` | Nøglen nåede sin **Grænse for anmodninger pr. minut**. Eksportører prøver igen efter `Retry-After`-tiden. |

For de andre svar, en OTLP-eksportør kan få, se [Svar](/docs/telemetry/open-telemetry#svar).

:::details Der kommer stadig data, efter at jeg slog nøglen fra
Hver OneUptime-server ser efter ændringer af en nøgle mindst én gang i sekundet, så en ændring når ud til dem alle inden for få sekunder, og anmodninger derefter afvises. Mens en server ikke kan nå OneUptimes cache, kan den gå ud fra det, den vidste om nøglen, i op til et minut. En MQTT-klient, der har forbundet med nøglen, afbrydes inden for få sekunder.
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
- [Tjenester](/docs/telemetry/services): Se de tjenester, din telemetri lægges under.
- [Dataopbevaring](/docs/telemetry/data-retention): Bestem, hvor længe dataene opbevares.
- [Drop-filtre og scrub-regler](/docs/telemetry/drop-filters-and-scrub-rules): Kassér eller maskér data, før de gemmes.
- [Indtagelsesbudgetter](/docs/telemetry/ingestion-budgets): Begræns, hvor meget hver nøgle må sende på en dag.
:::
