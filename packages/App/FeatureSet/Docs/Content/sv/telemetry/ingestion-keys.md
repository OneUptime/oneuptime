# Intagningsnycklar

En intagningsnyckel kopplar din telemetri till ditt projekt. Applikationer, OpenTelemetry Collectors och agenter skickar den med varje begäran, och OneUptime lägger deras loggar, spår och mätvärden i det projekt som nyckeln tillhör. Den här sidan visar hur du skapar en nyckel, vilken typ du ska välja och hur du håller nycklar säkra. För att skilja en intagningsnyckel från en API-nyckel, se [Vilken ska jag använda?](/docs/introduction/which-one#intagningsnyckel-eller-api-nyckel).

:::cards
- [Skapa en intagningsnyckel](#skapa-en-intagningsnyckel): Ett namn, en typ och en hemlighet att kopiera.
- [Server, Browser eller Mobil](#server-browser-eller-mobil): Vilken sorts nyckel en avsändare behöver.
- [Lås ned en webbläsarnyckel](#lås-ned-en-webbläsarnyckel): Ursprung, ett tjänstnamn och en gräns.
- [Byt ut, stäng av eller ta bort en nyckel](#byt-ut-stäng-av-eller-ta-bort-en-nyckel): Vad du gör när en nyckel läcker.
:::

## Så kontrolleras en nyckel

Varje begäran bär nyckelns hemlighet, oftast i en `x-oneuptime-token`-header. OneUptime slår upp nyckeln, kontrollerar att den fortfarande får skicka och tar först då emot data i nyckelns projekt.

```mermaid title="Vad OneUptime kontrollerar innan det tar emot telemetri"
flowchart TB
    request["En begäran med<br/>x-oneuptime-token"] --> known{"Känd, aktiverad,<br/>inte utgången?"}
    known -->|"Ja"| origin{"Tillåtet ursprung,<br/>för en<br/>webbläsarnyckel?"}
    origin -->|"Ja"| limit{"Under sin gräns?"}
    limit -->|"Ja"| accepted["Godkänd i<br/>nyckelns projekt"]
    known -->|"Nej"| refused["Avvisad, med en<br/>status som säger<br/>varför"]
    origin -->|"Nej"| refused
    limit -->|"Nej"| refused
```

- **Nyckeln bestämmer projektet.** Du skickar aldrig ett projekt-ID: data som skickas med en nyckel hamnar i det projekt som nyckeln tillhör.
- **Ändringar når alla servrar inom några sekunder.** Att stänga av en nyckel, återställa dess hemlighet eller ändra dess ursprung, utgång eller gräns får effekt på alla servrar inom några sekunder.
- **En nyckel kan ha egna budgetar.** En daglig budget och en hastighet per sekund för varje signal, inom projektets: se [Intagningsbudgetar](/docs/telemetry/ingestion-budgets).
- **En servernyckel är ett lösenord.** Den som har den kan skicka telemetri till ditt projekt. Förvara den bland dina servrars hemligheter, aldrig i versionshantering, på en webbsida eller i en mobilapp.

## Server, Browser eller Mobil

Välj typ efter var nyckeln ska finnas. Typen kan inte ändras efter att nyckeln har skapats.

| | **Server** | **Webbläsare** | **Mobil** |
| --- | --- | --- | --- |
| För | Applikationer, collectors och agenter på maskiner du driver | Webbsidor | En iOS-, Android- eller React Native-app |
| Skickar | All sorts telemetri, till alla endpoints | Spår, loggar, mätvärden, Session Replays och [Sentry-händelser](/docs/telemetry/compatible-endpoints#sentry-sdker) | Den appens spår, loggar och mätvärden, över OTLP/HTTP, och dess Session Replays |
| En hemlighet | Ja: håll den på dina servrar | Nej: alla som ser sidan kan läsa den | Nej: alla som har appen kan kopiera den |
| Ursprung | Kontrolleras inte | Bara de angivna ursprungen godkänns | En begäran från en webbsida avvisas |
| Begäranden per minut | Ingen gräns, om du inte anger en | 6 000, om du inte anger en annan gräns | 6 000, om du inte anger en annan gräns |

Överallt annars avvisar OneUptime en webbläsarnyckel, till exempel över gRPC och MQTT, för profiler, Syslog, Fluent Bit och Fluentd, och för uppladdning av source maps, och en mobilnyckel överallt utom för OTLP-spår, -loggar och -mätvärden över HTTP och dess apps Session Replays. För att flytta en avsändare till en annan typ skapar du en nyckel av den typen, byter avsändaren till den och tar sedan bort den gamla nyckeln.

## Innan du börjar

- **En roll som hanterar intagningsnycklar.** Projektägare eller Projektadministratör, eller en anpassad roll med behörigheten Create Ingestion Key. Telemetry-rollerna omfattar inte intagningsnycklar.
- **På OneUptime Cloud, en betalningsmetod.** Telemetri faktureras efter användning, så ett projekt på Free-planen behöver en betalningsmetod innan det kan skapa en nyckel. Dialogrutan för att skapa slutar då med ett steg **Fakturering** som visar priserna.

## Skapa en intagningsnyckel

:::steps
### Öppna intagningsnycklar

Gå till **Projektinställningar → Telemetri och APM → Intagningsnycklar**. **Telemetri och APM** är först hopfälld i sidomenyn: klicka på den för att öppna den. Listan visar för varje nyckel kolumnerna **Namn**, **Typ**, **Senast använd** och **Beskrivning**.

### Namnge nyckeln och välj dess typ

Klicka på **Skapa intagningsnyckel**. Dialogrutan börjar med namnet **Servernyckel** och typen **Server**. Välj **Nyckeltyp** och byt namn på nyckeln efter det som ska använda den, till exempel `checkout-collector`. En **Beskrivning** finns under **Avancerad**.

### Lägg till en webbläsarnyckels ursprung eller en mobilnyckels app

En **Webbläsare**-nyckel ber om sina **Tillåtna ursprung** i nästa steg, **Webbläsarinställningar**, med sitt **Fäst tjänstnamn** under **Avancerad**. Se [Lås ned en webbläsarnyckel](#lås-ned-en-webbläsarnyckel). En **Mobil**-nyckel ber i stället om sitt **Fäst tjänstnamn** på den första sidan: `service.name` för appen som den följer med i.

### Skapa nyckeln och kopiera dess hemlighet

Klicka på **Skapa intagningsnyckel**. Nyckelns egen sida öppnas: kopiera dess **Hemlig nyckel** och ge den till dina avsändare.
:::

Varje produkts **Installationsguide** börjar med **Välj en intagningsnyckel**, som listar de nycklar guiden kan använda och skapar en på plats. Kodsnuttarna i guiden innehåller sedan den nyckeln.

## Skicka telemetri med nyckeln

Avsändare lägger hemligheten i en `x-oneuptime-token`-header:

```text
x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_KEY
```

- OpenTelemetry-SDK:er läser den från `OTEL_EXPORTER_OTLP_HEADERS`. Se [snabbstarten för OpenTelemetry](/docs/telemetry/open-telemetry#snabbstart).
- Över OTLP/gRPC går den i `x-oneuptime-token`-metadatan.
- En MQTT-enhet skickar den som sitt lösenord. Se [IoT-enheter](/docs/telemetry/iot-devices).
- OneUptime läser också nyckeln från en `x-oneuptime-ingestion-key`- eller `x-oneuptime-service-token`-header, som vissa äldre installationer skickar.

## Lås ned en webbläsarnyckel

En webbläsarnyckel finns i din sida, där vem som helst kan kopiera den. Allt den skickar lagras som en webbläsar-RUM-applikation, aldrig som en värd, ett kluster, en molnresurs, en databas eller en backend-tjänst: av resursen som en avsändare sätter behåller nyckeln bara det som en sida säger om sig själv, som attributen `service.*`, `browser.*` och `user_agent.*` och etiketterna `oneuptime.label.*`. De här inställningarna begränsar vad en kopia kan göra. Ändra dem på nyckelns sida med **Redigera Intagningsnyckel**.

| Inställning | Vad den gör |
| --- | --- |
| **Tillåtna ursprung** | De enda ursprung som nyckeln godkänns från. En begäran från något annat ursprung, eller helt utan `Origin`-header, avvisas. En webbläsarnyckel måste behålla minst ett. |
| **Fäst tjänstnamn** | Lägger allt som nyckeln skickar över OTLP/HTTP under den här enda applikationen, oavsett vilket `service.name` avsändaren har satt. En kopia av nyckeln kan då bara skriva till den applikationen. |
| **Gräns för förfrågningar per minut** | Det största antalet begäranden som nyckeln godkänns för varje minut, delat av alla besökare. En webbläsarnyckel får 6 000 när du lämnar fältet tomt. |
| **Upphör** | Datumet då nyckeln börjar avvisas, så att en publicerad kopia slutar fungera. |

Ett ursprung är ett schema, en värd och en valfri port: `https://app.example.com` täcker inte `https://app.example.com:8443`. Ett inledande `*.` täcker alla underdomäner, men inte själva domänen. React Native Session Replay med en webbläsarnyckel skickar en exakt `app://`-identitet, som inte tar något jokertecken:

```json
[
  "https://app.example.com",
  "https://*.example.com",
  "app://com.example.mobile"
]
```

[Tjänster](/docs/telemetry/services#så-hamnar-en-tjänst-i-katalogen) visar hur ett fastlåst namn bestämmer tjänsten. Kubernetes-agentens Runner och AI-agent, och infrastrukturens AI-agenter, registrerar sig inte med en fastlåst nyckel: ge dem en servernyckel utan fastlåst namn.

## Vad en mobilnyckel begränsar

En mobilnyckel följer med i din app, och alla som har appen kan kopiera den. De här gränserna håller varje kopia till appen som nyckeln skapades för:

- **Den skriver bara som en app.** Allt den skickar arkiveras under dess **Fäst tjänstnamn** som en mobil RUM-applikation, oavsett vilken tjänst eller värd avsändaren anger. En kopia kan inte skriva i dina backend-tjänster, värdar eller kluster.
- **Den skickar bara den appens telemetri.** OTLP-spår, -loggar och -mätvärden över HTTP och appens Session Replays från dess React Native-inspelare, med nyckelns **Fäst tjänstnamn** som `appIdentifier`. Den avvisas över gRPC och MQTT, för en annan apps Session Replays, profiler och source maps, på alla andra endpoints och från alla webbsidor.
- **Den har en hastighetsgräns.** 6 000 begäranden per minut för alla kopior tillsammans, om du inte anger dess **Gräns för förfrågningar per minut**.
- **Du kan stoppa den.** Stäng av **Aktiverad**, eller ange **Upphör**, så avvisas varje kopia inom några sekunder.

Vad den inte kan förhindra: Den som har din app kan fortfarande skicka påhittade spår, loggar, mätvärden och Session Replays för den enda appen, upp till nyckelns gräns, tills du stänger av nyckeln eller den upphör. Byt nyckeln med dina releaser, så att en gammal kopia slutar fungera med sin version.

## Byt ut, stäng av eller ta bort en nyckel

En nyckels sida visar dess **Status**, dess **Hemlig nyckel** bakom **Klicka för att visa** och dess **Senast använd den**: senaste gången OneUptime tog emot data som skickades med den.

| För att | Gör så här | Vad avsändare ser |
| --- | --- | --- |
| Stoppa en nyckel direkt, och kunna ångra det senare | Klicka på **Redigera Intagningsnyckel**, öppna **Åtkomst och gränser** och stäng av **Aktiverad**. Statusen visar **Disabled — telemetry refused**. | `422` tills du slår på den igen |
| Ersätta en läckt hemlighet | Klicka på **Återställ hemlig nyckel** och bekräfta. Nyckeln behåller sina inställningar och får en ny hemlighet. | `401` tills de skickar den nya hemligheten |
| Stoppa en nyckel för gott | Klicka på **Ta bort Intagningsnyckel** längst ned på dess sida. | `401` |

För att byta en hemlighet utan att förlora data skapar du en andra nyckel, flyttar dina avsändare till den och tar bort den gamla nyckeln när dess **Senast använd den** slutar ändras. **Senast använd den** uppdateras med några minuters mellanrum, inte vid varje begäran.

## Felsökning

En avvisad begäran får en status och en mening som säger varför.

Nyckelns sida räknar också: **Avvisad telemetri** visar vad som avvisats från nyckeln de senaste 30 dagarna, varför, på vilken slutpunkt, hur många begäranden och när. En saknad eller felskriven nyckel hör inte till något projekt, så inget räknar den.

| Svar | Vad det betyder |
| --- | --- |
| `401` med `Missing ingestion token` | Begäran har ingen nyckel. Skicka den i `x-oneuptime-token`. |
| `401` med `Invalid ingestion token` | Ingen nyckel har den här hemligheten: den är felskriven, återställd eller borttagen. |
| `401` med `This telemetry ingestion key expired.` | Dess **Upphör** har passerats. Ange ett senare datum, eller använd en annan nyckel. |
| `402` med `Add a payment method` | På OneUptime Cloud är projektet på Free-planen och har ännu ingen betalningsmetod. |
| `422` med `This telemetry ingestion key has been disabled.` | Någon har stängt av **Aktiverad**. |
| `422` med `A browser ingestion key cannot be used for` | En webbläsarnyckel nådde en endpoint som bara tar servernycklar. |
| `422` med `did not send an Origin header` | En webbläsarnyckel skickades utanför en webbläsare. Använd en mobilnyckel i en mobilapp och en servernyckel överallt annars. |
| `422` med `A mobile ingestion key cannot be used for` | En mobilnyckel nådde en annan endpoint än OTLP-spår, -loggar och -mätvärden över HTTP och Session Replay, till exempel gRPC eller profiler. |
| `422` med `A mobile ingestion key can send session replays only` | En mobilnyckel skickade en webbsidas inspelning, eller en annan apps. Ge React Native-inspelaren nyckelns **Fäst tjänstnamn** som `appIdentifier`. |
| `422` med `A mobile ingestion key cannot be used from a web page` | En mobilnyckel skickades från en webbläsare. Använd en webbläsarnyckel på en webbsida. |
| `422` med `is not allowed for this browser ingestion key` | Sidans ursprung finns inte i **Tillåtna ursprung**. |
| `422` med `is pinned to a single service` | En nyckel med ett **Fäst tjänstnamn** användes för att registrera en agent. Använd en servernyckel utan fastlåst namn. |
| `429` med `Too many telemetry requests for this ingestion key` | Nyckeln nådde sin **Gräns för förfrågningar per minut**. Exportörer försöker igen efter `Retry-After`-tiden. |

För de andra svar som en OTLP-exportör kan få, se [Svar](/docs/telemetry/open-telemetry#svar).

:::details Data kommer fortfarande in efter att jag stängde av nyckeln
Varje OneUptime-server kontrollerar minst en gång i sekunden om en nyckel har ändrats, så en ändring når alla inom några sekunder och begäranden efter det avvisas. Medan en server inte når OneUptimes cache kan den utgå från det den visste om nyckeln i upp till en minut. En MQTT-klient som anslöt med nyckeln kopplas bort inom några sekunder.
:::

:::details En webbläsarnyckel fungerar på min bärbara dator men inte i produktion
Ett ursprung omfattar sitt schema och sin port. `http://localhost:3000` och `https://app.example.com` är olika ursprung: ange vart och ett som sidan serveras från.
:::

:::details Last Used At säger fortfarande Aldrig
Inget har skickat data med den här nyckeln sedan OneUptime började registrera användningen av den. Kontrollera att dina avsändare har den här nyckelns hemlighet och att deras begäranden når OneUptime.
:::

## Nästa steg

:::cards
- [OpenTelemetry](/docs/telemetry/open-telemetry): Skicka spår, mätvärden och loggar med din nyckel.
- [Tjänster](/docs/telemetry/services): Se tjänsterna som din telemetri läggs under.
- [Datalagring](/docs/telemetry/data-retention): Bestäm hur länge data sparas.
- [Drop-filter och scrub-regler](/docs/telemetry/drop-filters-and-scrub-rules): Kassera eller maskera data innan den lagras.
- [Intagningsbudgetar](/docs/telemetry/ingestion-budgets): Begränsa hur mycket varje nyckel får skicka under en dag.
:::
