# Värdar

Lägg till en Linux-, Windows- eller macOS-dator i OneUptime med ett enda kommando. Kommandot installerar OpenTelemetry Collector på värden, och OneUptime skickar insamlaren dess konfiguration och håller den uppdaterad: Det finns ingen `config.yaml` att skriva, kopiera till varje värd eller hålla i takt. För att ändra vad dina värdar samlar in redigerar du en insamlarkonfiguration en gång, och varje värd som den gäller för får ändringen inom en minut.

:::cards
- [Lägg till en värd](#lägg-till-en-värd): Ett kommando på Linux, Windows eller macOS.
- [Ändra vad värdar samlar in](#ändra-vad-värdar-samlar-in): Insamlarkonfigurationer efter system och etikett, med varje version sparad.
- [Kontrollera en värds insamlare](#kontrollera-en-värds-insamlare): Konfigurationen den kör, dess version och varför en konfiguration inte startade.
- [Vad en konfiguration får göra](#vad-en-konfiguration-får-göra): Läsa värden och bara skicka till den här OneUptime.
:::

## Så fungerar det

Kommandot installerar två program från OpenTelemetry Collectors versioner, båda kontrollerade mot den SHA-256 som versionen publicerar: `otelcol-contrib`, insamlaren som läser värden, och `opampsupervisor`, som kör insamlaren och håller den på den konfiguration som OneUptime skickar via OpAMP, OpenTelemetry Agent Management Protocol. Båda körs som tjänsten `oneuptime-collector`.

```mermaid title="Ett kommando, sedan håller OneUptime värden konfigurerad"
flowchart TB
    command["Installationskommandot<br/>på värden"] --> supervisor["opampsupervisor"]
    supervisor -->|"ber om sin konfiguration<br/>var 30:e sekund"| oneuptime["OneUptime"]
    oneuptime -->|"konfigurationen<br/>som värden kör"| supervisor
    supervisor --> collector["otelcol-contrib"]
    collector -->|"OTLP över HTTPS"| oneuptime
```

Supervisorn ber OneUptime om värdens konfiguration ungefär var 30:e sekund, med din intagningsnyckel, och rapporterar vilken konfiguration värden kör och om den startade. Värden registreras under **Värdar** när supervisorn ansluter första gången, med datorns namn, och dess sidor fylls i allteftersom dess mått och loggar kommer in.

Varje värd kör en konfiguration, vald i den här ordningen:

| Värden kör | När |
| --- | --- |
| Konfigurationen som valts för den på dess sida **Insamlare** | Någon har valt en. |
| Den första av **Insamlarkonfigurationer** som gäller för den | En konfiguration gäller när den är för värdens system och, om den nämner etiketter, värden har någon av dem. |
| OneUptimes standard för dess system | Ingen konfiguration gäller. |

OneUptimes standard läser processor, minne, diskar, filsystem, nätverk och processer på alla system; journalen och systemd-enheter på Linux, där värden har dem; händelseloggarna System, Application och Security och Windows-tjänster på Windows; och installations- och wifi-loggarna i `/var/log` på macOS. Den utelämnar filsystemen som är fulla med avsikt, som snap-paket och `/dev` på macOS, så att de aldrig får mallen High Filesystem Usage att fortsätta utlösas. Den följer OneUptimes versioner, så en värd på standarden får OneUptimes förbättringar av den.

## Innan du börjar

- En intagningsnyckel. **Lägg till värd** skapar en åt dig, eller välj en som du skapat under **Projektinställningar → Telemetri och APM → Intagningsnycklar**.
- Administratörsrättigheter på värden: `sudo` på Linux och macOS, PowerShell som administratör på Windows.
- Linux med systemd, Windows 10 eller Windows Server 2019 och senare, eller macOS på Apple silicon eller Intel.
- Utgående HTTPS från värden till din OneUptime-URL, direkt eller via en proxy.

## Lägg till en värd

:::steps
### Öppna Lägg till värd

Öppna **Produkter → Infrastruktur → Värdar** och välj **Lägg till värd**. Välj vad värden kör: Linux, Windows eller macOS. Noderna i ett Kubernetes-kluster övervakas i stället av [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

### Välj en intagningsnyckel

Välj en nyckel, eller skapa en från dialogrutan. Kommandot nedan fyller i den.

### Kör kommandot på värden

Kopiera kommandot från dialogrutan och kör det på värden. Det tar ungefär en minut. Det här är samma kommandon, med din OneUptime-URL och nyckel i stället för exemplen:

:::tabs
@tab Linux
```bash
curl -fsSL https://oneuptime.com/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --url https://oneuptime.com --key YOUR_INGESTION_KEY
```
@tab macOS
```bash
curl -fsSL https://oneuptime.com/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --url https://oneuptime.com --key YOUR_INGESTION_KEY
```
@tab Windows
```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; & ([scriptblock]::Create((Invoke-RestMethod -Uri 'https://oneuptime.com/docs/static/scripts/host-collector/install.ps1'))) -Url 'https://oneuptime.com' -Key 'YOUR_INGESTION_KEY'
```
:::

Varje OneUptime tillhandahåller sina egna installationsprogram, så en egenvärdad OneUptime delar ut installationsprogrammet från sin egen version: Ersätt `https://oneuptime.com` med din URL på båda ställena.

### Vänta på värden

Dialogrutans sista steg visar när värden ansluter, med en länk till den. I listan visas den som **Startar** tills dess första mått kommer in, oftast inom en minut, och sedan som ansluten, med sin insamlare **Körs**. Värdens sida **Topologi** ritar på en karta vad som körs på den, vad som anropar den och vad den anropar: se [Topologi](/docs/telemetry/topology#öppna-en-resurs-egen-karta).
:::

## Märk värdar

Lägg till etiketter i kommandot, så har värden dem från det ögonblick den ansluter:

:::tabs
@tab Linux
```bash
curl -fsSL https://oneuptime.com/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --url https://oneuptime.com --key YOUR_INGESTION_KEY --label env=production --label team=payments
```
@tab macOS
```bash
curl -fsSL https://oneuptime.com/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --url https://oneuptime.com --key YOUR_INGESTION_KEY --label env=production --label team=payments
```
@tab Windows
```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; & ([scriptblock]::Create((Invoke-RestMethod -Uri 'https://oneuptime.com/docs/static/scripts/host-collector/install.ps1'))) -Url 'https://oneuptime.com' -Key 'YOUR_INGESTION_KEY' -Label 'env=production','team=payments'
```
:::

`env=production` blir etiketten `env:production`. Etiketter läggs till och tas aldrig bort: Kör kommandot igen med en annan etikett, så har värden båda. Du kan också märka värdar i listan **Värdar** eller med **Etikettregler**. En insamlarkonfiguration som nämner etiketter gäller bara värdar med någon av dem, så samma kommando med olika etiketter ger varje grupp av värdar sin egen konfiguration.

## Ändra vad värdar samlar in

:::steps
### Skapa en insamlarkonfiguration

Öppna **Produkter → Infrastruktur → Värdar → Insamlarkonfigurationer** och välj **Skapa Insamlarkonfiguration**. Ge den ett namn, systemet för de värdar den är till för och, för att bara nå några av dem, deras etiketter. Dess konfiguration börjar som OneUptimes standard för det systemet.

### Redigera dess config.yaml

Välj **Redigera konfiguration** på konfigurationens sida, ändra YAML-koden och spara. OneUptime kontrollerar den först och avvisar en konfiguration som den inte kan skicka, med en förklaring: se [Vad en konfiguration får göra](#vad-en-konfiguration-får-göra).

### Se den nå värdarna

Varje sparad ändring är en ny version, och de värdar den gäller för får den inom en minut. Konfigurationens lista **Värdar** visar varje värd, dess insamlares tillstånd och versionen den kör.
:::

En värd kör den första konfigurationen i listan som gäller för den: Dra raderna under **Insamlarkonfigurationer** för att ändra ordningen. Lägg de smalaste konfigurationerna först, till exempel en för webbservrar med `env:production`, och breda, till exempel en för alla Linux-värdar, efter dem. Kortet **OneUptime-standarder** under listan visar vad en värd kör när ingen konfiguration gäller.

### Versioner och återställning

En konfigurations lista **Versioner** sparar varje ändring, nyast först, med vem som sparade den och när. Välj **Visa** för att läsa en version och **Återställ** för att skicka den till värdarna igen: Den sparas som en ny version som anger vilken den återställde, så listan alltid visar vad varje värd fick.

### Välj en konfiguration för en värd

Välj **Byt konfiguration** på en värds sida **Insamlare** och välj en konfiguration bara för den här värden. Konfigurationer för värdens system och för alla system erbjuds. Välj Automatiskt för att ge tillbaka värden till listan. En värd vars valda konfiguration tas bort går själv tillbaka till listan.

### När en konfiguration inte startar

Supervisorn kontrollerar en ny konfiguration med insamlaren innan den byter till den, och går tillbaka till den senaste konfigurationen som fungerade när en inte startar. Värden fortsätter att skicka hela tiden. Dess sida **Insamlare** visar **Konfigurationen misslyckades** med insamlarens förklaring, till exempel en loggfil som insamlaren inte får läsa, och OneUptime skickar inte den konfigurationen till värden igen förrän den ändras. När du har åtgärdat orsaken på värden väljer du **Försök igen** för att skicka den en gång till.

## Vad en konfiguration får göra

En konfiguration som OneUptime skickar körs på varje värd som den gäller för, så OneUptime kontrollerar den varje gång den sparas och avvisar en som bryter mot en regel:

| Regel | Varför |
| --- | --- |
| Bara de receivers, processors, exporters, extensions och connectors som finns på OneUptimes lista | Den läser värden och tjänsterna på den. En komponent som kör program eller läser autentiseringsuppgifter för moln eller kluster finns inte på listan. |
| Data lämnar värden bara via exportören `otlp_http`, till `${env:ONEUPTIME_URL}/otlp` med headern `x-oneuptime-token: ${env:ONEUPTIME_INGESTION_KEY}` | Varje värd skickar till den här OneUptime, med nyckeln den installerades med. Ingen konfiguration innehåller en nyckel. |
| `${env:NAME}` är den enda `${...}` som den får använda | En `${file:...}` eller `${https:...}` skulle läsas på varje värd och kunde skickas vidare. |
| Ingen inställning som kör ett program eller skickar en fil som den läser, till exempel journalds `journalctl_path` | En konfiguration får inte nå längre än att läsa värden. |

En konfiguration kan ändå vara en som en värd inte kan köra, till exempel en receiver för ett annat system eller en loggfil som inte finns där. Insamlaren på varje värd kontrollerar det innan den byter, som [När en konfiguration inte startar](#när-en-konfiguration-inte-startar) beskriver.

## Kontrollera en värds insamlare

Öppna värden och dess sida **Insamlare**. Den visar hur det står till med insamlaren, konfigurationen den kör och **Varför den här konfigurationen**, versionen den kör, dess **Senaste rapport** och dess **Insamlarversion**. Under **På värden** finns kommandona för att kontrollera den från ett skal på värden: om tjänsten körs, dess logg och en omstart.

:::tabs
@tab Linux
```bash
sudo systemctl status oneuptime-collector
sudo journalctl -u oneuptime-collector -n 50
sudo systemctl restart oneuptime-collector
```
@tab macOS
```bash
sudo launchctl print system/com.oneuptime.collector
sudo tail -n 50 /usr/local/oneuptime-collector/log/collector.log
sudo launchctl kickstart -k system/com.oneuptime.collector
```
@tab Windows
```powershell
Get-Service oneuptime-collector
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'oneuptime-collector' } -MaxEvents 50 | Format-List TimeCreated, Message
Restart-Service oneuptime-collector
```
:::

På Linux körs insamlaren som den oprivilegierade användaren `oneuptime-collector`, i grupperna `systemd-journal` och `adm`, så att den kan läsa journalen och loggarna i `/var/log`. På macOS körs den som root, som launchd-daemoner gör, och på Windows som LocalSystem, så att den kan läsa alla händelseloggar och Windows-tjänster.

## Manuellt konfigurerade värdar

En värd vars insamlare du installerade själv, med guiden [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector), fortsätter att rapportera som tidigare, och OneUptime skickar ingen konfiguration till den. För att lämna över den öppnar du värdens sida **Insamlare**: Kommandot där lägger till `--replace-existing`, som stoppar och inaktiverar den manuellt installerade insamlaren (tjänsten `otelcol-contrib`), så att värden inte rapporterar dubbelt. Värden behåller sitt namn, sin historik och sina etiketter.

## Installationsalternativ

Kör kommandot igen för att ändra något av dessa, eller för att gå över till en nyare version: Det ersätter det som det installerade och behåller värden som den är i OneUptime.

| Linux och macOS | Windows | Vad det gör |
| --- | --- | --- |
| `--url URL` | `-Url URL` | Var OneUptime finns. |
| `--key KEY` | `-Key KEY` | En intagningsnyckel för telemetri från ditt projekt. |
| `--label KEY=VALUE` | `-Label KEY=VALUE` | Märker värden. Upprepa det för fler etiketter; på Windows listar du dem med kommatecken. |
| `--env NAME=VALUE` | `-EnvVar NAME=VALUE` | Ger insamlaren en miljövariabel, för konfigurationer som läser `${env:NAME}`. |
| `--version VERSION` | `-Version VERSION` | Den insamlarversion som installeras, 0.161.0 som standard. |
| `--download-url URL` | `-DownloadUrl URL` | Hämtar versionerna från en spegel med samma mappstruktur som GitHubs. |
| `--proxy URL` | `-Proxy URL` | Skickar nedladdningarna och all insamlarens trafik via en HTTP-proxy. |
| `--replace-existing` | `-ReplaceExisting` | Stoppar och inaktiverar en manuellt installerad insamlare. |
| `--uninstall` | `-Uninstall` | Tar bort insamlaren och allt som kommandot installerade. |

## Avinstallera

:::tabs
@tab Linux
```bash
curl -fsSL https://oneuptime.com/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --uninstall
```
@tab macOS
```bash
curl -fsSL https://oneuptime.com/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --uninstall
```
@tab Windows
```powershell
& ([scriptblock]::Create((Invoke-RestMethod -Uri 'https://oneuptime.com/docs/static/scripts/host-collector/install.ps1'))) -Uninstall
```
:::

Värden finns kvar i OneUptime med sin historik: Arkivera eller ta bort den i listan **Värdar**.

## Felsökning

:::details Kommandot säger att OneUptime avvisade nyckeln
HTTP `401`: Nyckeln är fel, har gått ut eller har tagits bort. HTTP `422`: Den är inaktiverad, är en webbläsarnyckel eller är låst till en tjänst. Välj en aktiverad servernyckel i **Lägg till värd** och kör kommandot igen: Det ersätter nyckeln på värden.
:::

:::details Värden visas inte
Kontrollera att värden når din OneUptime-URL över HTTPS och läs sedan insamlarens logg med kommandot för dess system under [Kontrollera en värds insamlare](#kontrollera-en-värds-insamlare).
:::

:::details Värden säger att dess konfiguration misslyckades
Dess sida **Insamlare** visar varför konfigurationen inte startade. Värden fortsätter att köra den senaste konfigurationen som fungerade och får den misslyckade igen när konfigurationen ändras eller när du väljer **Försök igen**.
:::

:::details Värden visar ”Ingen rapportering”
OneUptime har inte hört något från värdens supervisor på mer än 15 minuter. Kontrollera att tjänsten `oneuptime-collector` körs och att värden fortfarande når OneUptime.
:::

## Nästa steg

:::cards
- [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector): Installera insamlaren och skriv dess konfiguration själv i stället.
- [Värdmonitor](/docs/monitor/host-monitor): Få aviseringar om det dina värdar rapporterar.
- [Intagningsnycklar](/docs/telemetry/ingestion-keys): Skapa, avgränsa och rotera nycklarna som värdar skickar med.
- [Kubernetes Agent](/docs/telemetry/kubernetes-agent): Övervaka ett klusters noder och arbetsbelastningar.
:::
