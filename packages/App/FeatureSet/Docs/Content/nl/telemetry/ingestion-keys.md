# Ingestiesleutels

Een ingestiesleutel koppelt uw telemetrie aan uw project. Applicaties, OpenTelemetry Collectors en agents sturen hem mee met elk verzoek, en OneUptime zet hun logboeken, traces en metrieken in het project waar de sleutel bij hoort. Deze pagina laat zien hoe u een sleutel aanmaakt, welk type u kiest en hoe u sleutels veilig houdt.

:::cards
- [Een ingestiesleutel aanmaken](#een-ingestiesleutel-aanmaken): Een naam, een type en een geheim om te kopiëren.
- [Server of Browser](#server-of-browser): Welk soort sleutel een afzender nodig heeft.
- [Een browsersleutel afschermen](#een-browsersleutel-afschermen): Origins, één servicenaam en een limiet.
- [Een sleutel vervangen, uitschakelen of verwijderen](#een-sleutel-vervangen-uitschakelen-of-verwijderen): Wat u doet als een sleutel uitlekt.
:::

## Hoe een sleutel wordt gecontroleerd

Elk verzoek draagt het geheim van de sleutel, meestal in een `x-oneuptime-token`-header. OneUptime zoekt de sleutel op, controleert of hij nog mag verzenden, en accepteert pas dan de gegevens in het project van de sleutel.

```mermaid title="Wat OneUptime controleert voordat het telemetrie accepteert"
flowchart TB
    request["Een verzoek met<br/>x-oneuptime-token"] --> known{"Bekend, ingeschakeld,<br/>niet verlopen?"}
    known -->|"Ja"| origin{"Toegestane origin,<br/>voor een<br/>browsersleutel?"}
    origin -->|"Ja"| limit{"Onder de limiet?"}
    limit -->|"Ja"| accepted["Geaccepteerd in het<br/>project van de sleutel"]
    known -->|"Nee"| refused["Geweigerd, met een<br/>status die zegt<br/>waarom"]
    origin -->|"Nee"| refused
    limit -->|"Nee"| refused
```

- **De sleutel bepaalt het project.** U stuurt nooit een project-ID mee: gegevens die met een sleutel worden verzonden, komen terecht in het project waar de sleutel bij hoort.
- **Wijzigingen bereiken elke server binnen een minuut.** Een sleutel uitschakelen, zijn geheim opnieuw instellen of zijn origins, vervaldatum of limiet wijzigen werkt binnen ongeveer een minuut.
- **Een serversleutel is een wachtwoord.** Iedereen die hem heeft, kan telemetrie naar uw project sturen. Bewaar hem in de geheimen van uw servers, nooit in versiebeheer of op een webpagina.

## Server of Browser

Kies het type op basis van waar de sleutel komt te staan. Het type kan niet meer worden gewijzigd nadat de sleutel is aangemaakt.

| | **Server** | **Browser** |
| --- | --- | --- |
| Voor | Applicaties, collectors en agents op machines die u beheert | Webpagina's, en React Native Session Replay |
| Verzendt | Elk soort telemetrie, naar elk endpoint | Traces, logboeken, metrieken en Session Replays |
| Een geheim | Ja: bewaar hem op uw servers | Nee: iedereen die de pagina bekijkt, kan hem lezen |
| Origins | Niet gecontroleerd | Alleen de vermelde origins worden geaccepteerd |
| Verzoeken per minuut | Geen limiet, tenzij u er een instelt | 6.000, tenzij u een andere limiet instelt |

Overal elders weigert OneUptime een browsersleutel, zoals via gRPC en MQTT, voor profielen, Syslog, Fluent Bit en Fluentd, en voor het uploaden van source maps. Om een afzender naar het andere type te verplaatsen, maakt u een sleutel van dat type aan, zet u de afzender daarop over en verwijdert u daarna de oude sleutel.

## Voordat u begint

- **Een rol die ingestiesleutels beheert.** Project Owner of Project Admin, of een aangepaste rol met de machtiging Create Telemetry Ingestion Key. De Telemetry-rollen omvatten geen ingestiesleutels.
- **Op OneUptime Cloud, een betaalmethode.** Telemetrie wordt gefactureerd naar gebruik, dus een project op het Free-abonnement heeft een betaalmethode nodig voordat het een sleutel kan aanmaken. Het dialoogvenster eindigt dan met een stap **Facturering** die de prijzen toont.

## Een ingestiesleutel aanmaken

:::steps
### Ingestiesleutels openen

Ga naar **Projectinstellingen → Telemetrie & APM → Ingestiesleutels**. **Telemetrie & APM** staat in het zijmenu eerst ingeklapt: klik erop om het te openen. De lijst toont per sleutel de kolommen **Naam**, **Type**, **Last Used** en **Beschrijving**.

### De sleutel een naam en een type geven

Klik op **Inname-sleutel aanmaken**. Het dialoogvenster begint met de naam **Serversleutel** en het type **Server**. Kies het **Sleuteltype** en geef de sleutel een naam naar wat hem gaat gebruiken, zoals `checkout-collector`. Een **Beschrijving** staat onder **Geavanceerd**.

### De origins van een browsersleutel toevoegen

Een **Browser**-sleutel vraagt om zijn **Toegestane origins** in de volgende stap, **Browserinstellingen**, met zijn **Vastgezette servicenaam** onder **Geavanceerd**. Zie [Een browsersleutel afschermen](#een-browsersleutel-afschermen).

### De sleutel aanmaken en het geheim kopiëren

Klik op **Inname-sleutel aanmaken**. De pagina van de sleutel opent: kopieer de **Geheime sleutel** en geef die aan uw afzenders.
:::

De **Installatiegids** van elk product begint met **Kies een inname-sleutel**, dat de sleutels toont die die gids kan gebruiken en er ter plekke een aanmaakt. De codefragmenten van de gids bevatten daarna die sleutel.

## Telemetrie met de sleutel verzenden

Afzenders zetten het geheim in een `x-oneuptime-token`-header:

```text
x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_KEY
```

- OpenTelemetry-SDK's lezen hem uit `OTEL_EXPORTER_OTLP_HEADERS`. Zie de [OpenTelemetry-snelstart](/docs/telemetry/open-telemetry#snelstart).
- Via OTLP/gRPC gaat hij in de `x-oneuptime-token`-metadata.
- Een MQTT-apparaat stuurt hem als wachtwoord. Zie [IoT-apparaten](/docs/telemetry/iot-devices).
- OneUptime leest de sleutel ook uit een `x-oneuptime-ingestion-key`- of `x-oneuptime-service-token`-header, die sommige oudere opstellingen sturen.

## Een browsersleutel afschermen

Een browsersleutel staat in uw pagina, waar iedereen hem kan kopiëren. Deze instellingen beperken wat een kopie kan doen. Wijzig ze op de pagina van de sleutel met **Telemetrie Inname Key bewerken**.

| Instelling | Wat ze doet |
| --- | --- |
| **Toegestane origins** | De enige origins waarvandaan de sleutel wordt geaccepteerd. Een verzoek vanaf een andere origin, of helemaal zonder `Origin`-header, wordt geweigerd. Een browsersleutel moet er minstens één houden. |
| **Vastgezette servicenaam** | Zet alles wat de sleutel via OTLP/HTTP verzendt onder deze ene service, welke `service.name` de afzender ook instelde. Een kopie van de sleutel kan dan alleen in die service schrijven. |
| **Requests Per Minute Limit** | Het maximale aantal verzoeken waarvoor de sleutel elke minuut wordt geaccepteerd, gedeeld door alle bezoekers. Een browsersleutel krijgt 6.000 als u het veld leeg laat. |
| **Verloopt om** | De datum waarna de sleutel wordt geweigerd, zodat een gepubliceerde kopie niet meer werkt. |

Een origin is een schema, een host en een optionele poort: `https://app.example.com` dekt `https://app.example.com:8443` niet. Eén `*.` vooraan dekt elk subdomein, maar niet het domein zelf. React Native Session Replay stuurt een exacte `app://`-identiteit, die geen jokerteken toestaat:

```json
[
  "https://app.example.com",
  "https://*.example.com",
  "app://com.example.mobile"
]
```

De [Servicecatalogus](/docs/telemetry/services#hoe-een-service-in-de-catalogus-komt) laat zien hoe een vastgelegde naam de service bepaalt. De Runner en de AI-agent van de Kubernetes-agent, en de AI-agents voor infrastructuur, registreren zich niet met een vastgelegde sleutel: geef ze een serversleutel zonder vastgelegde naam.

## Een sleutel vervangen, uitschakelen of verwijderen

De pagina van een sleutel toont zijn **Status**, zijn **Geheime sleutel** achter **Click to reveal**, en zijn **Last Used At**: de laatste keer dat OneUptime gegevens accepteerde die ermee waren verzonden.

| Om | Doe dit | Wat afzenders zien |
| --- | --- | --- |
| Een sleutel direct te stoppen, en dat later terug te draaien | Klik op **Telemetrie Inname Key bewerken**, open **Toegang en limieten** en zet **Ingeschakeld** uit. De status toont **Disabled — telemetry refused**. | `422` totdat u hem weer aanzet |
| Een uitgelekt geheim te vervangen | Klik op **Geheime sleutel opnieuw instellen** en bevestig. De sleutel houdt zijn instellingen en krijgt een nieuw geheim. | `401` totdat ze het nieuwe geheim sturen |
| Een sleutel voorgoed te stoppen | Klik op **Telemetrie Inname Key verwijderen** onderaan zijn pagina. | `401` |

Om een geheim te wisselen zonder gegevens te verliezen, maakt u een tweede sleutel aan, zet u uw afzenders daarop over en verwijdert u de oude sleutel zodra zijn **Last Used At** niet meer verandert. **Last Used At** wordt om de paar minuten bijgewerkt, niet bij elk verzoek.

## Problemen oplossen

Een geweigerd verzoek krijgt een status en een zin die zegt waarom.

| Antwoord | Wat het betekent |
| --- | --- |
| `401` met `Missing ingestion token` | Het verzoek heeft geen sleutel. Stuur hem mee in `x-oneuptime-token`. |
| `401` met `Invalid ingestion token` | Geen enkele sleutel heeft dit geheim: het is verkeerd getypt, opnieuw ingesteld of verwijderd. |
| `401` met `This telemetry ingestion key expired.` | Zijn **Verloopt om** is verstreken. Stel een latere datum in, of gebruik een andere sleutel. |
| `402` met `Add a payment method` | Op OneUptime Cloud staat het project op het Free-abonnement en heeft het nog geen betaalmethode. |
| `422` met `This telemetry ingestion key has been disabled.` | Iemand heeft **Ingeschakeld** uitgezet. |
| `422` met `A browser ingestion key cannot be used for` | Een browsersleutel bereikte een endpoint dat alleen serversleutels accepteert. |
| `422` met `did not send an Origin header` | Een browsersleutel werd van buiten een browser verzonden. Gebruik daar een serversleutel. |
| `422` met `is not allowed for this browser ingestion key` | De origin van de pagina staat niet in **Toegestane origins**. |
| `422` met `is pinned to a single service` | Een sleutel met een **Vastgezette servicenaam** werd gebruikt om een agent te registreren. Gebruik een serversleutel zonder vastgelegde naam. |
| `429` met `Too many telemetry requests for this ingestion key` | De sleutel bereikte zijn **Requests Per Minute Limit**. Exporters proberen het opnieuw na de `Retry-After`-tijd. |

Voor de andere antwoorden die een OTLP-exporter kan krijgen, zie [Antwoorden](/docs/telemetry/open-telemetry#antwoorden).

:::details Er komen nog gegevens binnen een minuut nadat ik de sleutel uitzette
Elke OneUptime-server onthoudt wat hij over een sleutel weet hooguit een minuut, dus een wijziging bereikt ze allemaal binnen ongeveer een minuut. Verzoeken daarna worden geweigerd.
:::

:::details Een browsersleutel werkt op mijn laptop, maar niet in productie
Een origin omvat zijn schema en poort. `http://localhost:3000` en `https://app.example.com` zijn verschillende origins: vermeld elke origin waarvandaan de pagina wordt geserveerd.
:::

:::details Last Used At zegt nog steeds Nooit
Er zijn met deze sleutel geen gegevens verzonden sinds OneUptime het gebruik ervan begon bij te houden. Controleer of uw afzenders het geheim van deze sleutel hebben, en of hun verzoeken OneUptime bereiken.
:::

## Volgende stappen

:::cards
- [OpenTelemetry](/docs/telemetry/open-telemetry): Verzend traces, metrieken en logboeken met uw sleutel.
- [Servicecatalogus](/docs/telemetry/services): Bekijk de services waaronder uw telemetrie staat.
- [Gegevensbewaring](/docs/telemetry/data-retention): Bepaal hoe lang de gegevens worden bewaard.
- [Drop-filters en scrub-regels](/docs/telemetry/drop-filters-and-scrub-rules): Verwijder of maskeer gegevens voordat ze worden opgeslagen.
:::
