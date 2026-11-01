# Værter

Tilføj en Linux-, Windows- eller macOS-maskine til OneUptime med én kommando. Kommandoen installerer OpenTelemetry Collector på værten, og OneUptime sender collectoren dens konfiguration og holder den opdateret: Der er ingen `config.yaml` at skrive, kopiere til hver vært eller holde i takt. For at ændre, hvad dine værter indsamler, redigerer du en collector-konfiguration én gang, og hver vært, den gælder for, får ændringen inden for et minut.

:::cards
- [Tilføj en vært](#tilføj-en-vært): Én kommando på Linux, Windows eller macOS.
- [Skift, hvad værter indsamler](#skift-hvad-værter-indsamler): Collector-konfigurationer efter system og etiket, med hver version gemt.
- [Tjek en værts collector](#tjek-en-værts-collector): Den konfiguration, den kører, dens version, og hvorfor en konfiguration ikke startede.
- [Hvad en konfiguration må](#hvad-en-konfiguration-må): Læse værten og kun sende til denne OneUptime.
:::

## Sådan fungerer det

Kommandoen installerer to programmer fra OpenTelemetry Collectors udgivelser, hver kontrolleret mod den SHA-256, som udgivelsen offentliggør: `otelcol-contrib`, collectoren der læser værten, og `opampsupervisor`, som kører collectoren og holder den på den konfiguration, OneUptime sender via OpAMP, OpenTelemetry Agent Management Protocol. Begge kører som tjenesten `oneuptime-collector`.

```mermaid title="Én kommando, derefter holder OneUptime værten konfigureret"
flowchart TB
    command["Installationskommandoen<br/>på værten"] --> supervisor["opampsupervisor"]
    supervisor -->|"beder om sin konfiguration<br/>hvert 30. sekund"| oneuptime["OneUptime"]
    oneuptime -->|"den konfiguration,<br/>værten kører"| supervisor
    supervisor --> collector["otelcol-contrib"]
    collector -->|"OTLP over HTTPS"| oneuptime
```

Supervisoren beder OneUptime om værtens konfiguration cirka hvert 30. sekund med din indtagelsesnøgle og rapporterer, hvilken konfiguration værten kører, og om den startede. Værten registreres under **Værter**, når supervisoren første gang forbinder, med maskinens navn, og dens sider fyldes ud, efterhånden som dens målinger og logs ankommer.

Hver vært kører én konfiguration, valgt i denne rækkefølge:

| Værten kører | Hvornår |
| --- | --- |
| Den konfiguration, der er valgt til den på dens side **Collector** | Nogen har valgt en. |
| Den første af **Collector-konfigurationer**, der gælder for den | En konfiguration gælder, når den er til værtens system og, hvis den nævner etiketter, værten har en af dem. |
| OneUptimes standard for dens system | Ingen konfiguration gælder. |

OneUptimes standard læser CPU, hukommelse, diske, filsystemer, netværk og processer på alle systemer; journalen og systemd-enheder på Linux, hvor værten har dem; hændelseslogfilerne System, Application og Security og Windows-tjenester på Windows; og installations- og Wi-Fi-logfilerne i `/var/log` på macOS. Den udelader de filsystemer, der er fulde med vilje, som snap-pakker og `/dev` på macOS, så de aldrig får skabelonen High Filesystem Usage til at blive ved med at udløses. Den følger OneUptimes udgivelser, så en vært på standarden får OneUptimes forbedringer af den.

## Før du starter

- En indtagelsesnøgle. **Tilføj vært** opretter en til dig, eller vælg en, du har oprettet under **Projektindstillinger → Telemetri og APM → Indtagelsesnøgler**.
- Administratorrettigheder på værten: `sudo` på Linux og macOS, PowerShell kørt som administrator på Windows.
- Linux med systemd, Windows 10 eller Windows Server 2019 og nyere, eller macOS på Apple silicon eller Intel.
- Udgående HTTPS fra værten til din OneUptime-URL, direkte eller via en proxy.

## Tilføj en vært

:::steps
### Åbn Tilføj vært

Åbn **Produkter → Infrastruktur → Værter**, og vælg **Tilføj vært**. Vælg, hvad værten kører: Linux, Windows eller macOS. Noderne i en Kubernetes-klynge overvåges i stedet af [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

### Vælg en indtagelsesnøgle

Vælg en nøgle, eller opret en fra dialogen. Kommandoen nedenfor indsætter den.

### Kør kommandoen på værten

Kopiér kommandoen fra dialogen, og kør den på værten. Det tager cirka et minut. Det er de samme kommandoer med din OneUptime-URL og nøgle i stedet for eksemplerne:

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

Hver OneUptime leverer sine egne installationsprogrammer, så en selvhostet OneUptime udleverer installationsprogrammet fra sin egen udgivelse: Erstat `https://oneuptime.com` med din URL begge steder.

### Vent på værten

Dialogens sidste trin viser, når værten forbinder, med et link til den. På listen vises den som **Starter**, indtil dens første målinger ankommer, normalt inden for et minut, og derefter som forbundet, med sin collector **Kører**. Værtens side **Topologi** tegner på ét kort, hvad der kører på den, hvad der kalder den, og hvad den kalder: se [Topologi](/docs/telemetry/topology#åbn-en-ressources-eget-kort).
:::

## Sæt etiketter på værter

Føj etiketter til kommandoen, så har værten dem fra det øjeblik, den forbinder:

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

`env=production` bliver til etiketten `env:production`. Etiketter tilføjes og fjernes aldrig: Kør kommandoen igen med en anden etiket, og værten har begge. Du kan også sætte etiketter på værter på listen **Værter** eller med **Etiketregler**. En collector-konfiguration, der nævner etiketter, gælder kun for værter med en af dem, så den samme kommando med forskellige etiketter giver hver gruppe af værter sin egen konfiguration.

## Skift, hvad værter indsamler

:::steps
### Opret en collector-konfiguration

Åbn **Produkter → Infrastruktur → Værter → Collector-konfigurationer**, og vælg **Opret Collector-konfiguration**. Giv den et navn, systemet for de værter, den er til, og deres etiketter, hvis den kun skal nå nogle af dem. Dens konfiguration starter som OneUptimes standard for det system.

### Rediger dens config.yaml

Vælg **Rediger konfiguration** på konfigurationens side, ændr YAML-koden, og gem. OneUptime kontrollerer den først og afviser en konfiguration, den ikke kan sende, med en begrundelse: se [Hvad en konfiguration må](#hvad-en-konfiguration-må).

### Se den nå værterne

Hver gemt ændring er en ny version, og de værter, den gælder for, får den inden for et minut. Konfigurationens liste **Værter** viser hver vært, dens collectors tilstand og den version, den kører.
:::

En vært kører den første konfiguration på listen, der gælder for den: Træk rækkerne under **Collector-konfigurationer** for at ændre rækkefølgen. Sæt de smalleste konfigurationer først, f.eks. en til webservere med `env:production`, og brede, f.eks. en til alle Linux-værter, efter dem. Kortet **OneUptime-standarder** under listen viser, hvad en vært kører, når ingen konfiguration gælder.

### Versioner og gendannelse

En konfigurations liste **Versioner** gemmer hver gemt ændring, nyeste først, med hvem der gemte den og hvornår. Vælg **Vis** for at læse en version og **Gendan** for at sende den til værterne igen: Den gemmes som en ny version, der siger, hvilken den gendannede, så listen altid fortæller, hvad hver vært fik sendt.

### Vælg en konfiguration til én vært

Vælg **Skift konfiguration** på en værts side **Collector**, og vælg en konfiguration kun til denne vært. Konfigurationer til værtens system og til alle systemer tilbydes. Vælg Automatisk for at give værten tilbage til listen. En vært, hvis valgte konfiguration slettes, går selv tilbage til listen.

### Når en konfiguration ikke starter

Supervisoren kontrollerer en ny konfiguration med collectoren, før den skifter til den, og går tilbage til den seneste konfiguration, der fungerede, når en ikke starter. Værten bliver ved med at sende hele tiden. Dens side **Collector** viser **Konfiguration mislykkedes** med collectorens begrundelse, f.eks. en logfil, collectoren ikke må læse, og OneUptime sender ikke den konfiguration til værten igen, før den ændres. Når du har rettet årsagen på værten, skal du vælge **Prøv igen** for at sende den en gang til.

## Hvad en konfiguration må

En konfiguration, som OneUptime sender, kører på hver vært, den gælder for, så OneUptime kontrollerer den, hver gang den gemmes, og afviser en, der bryder en regel:

| Regel | Hvorfor |
| --- | --- |
| Kun de receivers, processors, exporters, extensions og connectors, der er på OneUptimes liste | Den læser værten og tjenesterne på den. En komponent, der kører programmer eller læser cloud- eller klyngelegitimationsoplysninger, er ikke på listen. |
| Data forlader kun værten gennem exporteren `otlp_http`, til `${env:ONEUPTIME_URL}/otlp` med headeren `x-oneuptime-token: ${env:ONEUPTIME_INGESTION_KEY}` | Hver vært sender til denne OneUptime med den nøgle, den blev installeret med. Ingen konfiguration indeholder en nøgle. |
| `${env:NAME}` er den eneste `${...}`, den må bruge | En `${file:...}` eller `${https:...}` ville blive læst på hver vært og kunne sendes videre. |
| Ingen indstilling, der kører et program eller sender en fil, den læser, f.eks. journalds `journalctl_path` | En konfiguration må ikke nå længere end til at læse værten. |

En konfiguration kan stadig være en, som en vært ikke kan køre, f.eks. en receiver til et andet system eller en logfil, der ikke findes der. Collectoren på hver vært kontrollerer det, før den skifter, som [Når en konfiguration ikke starter](#når-en-konfiguration-ikke-starter) beskriver.

## Tjek en værts collector

Åbn værten og dens side **Collector**. Den viser, hvordan collectoren har det, den konfiguration, den kører, og **Hvorfor denne konfiguration**, den version, den kører, dens **Seneste rapport** og dens **Collector-udgivelse**. Under **På værten** står kommandoerne til at tjekke den fra en shell på værten: om dens tjeneste kører, dens log og en genstart.

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

På Linux kører collectoren som den uprivilegerede bruger `oneuptime-collector`, i grupperne `systemd-journal` og `adm`, så den kan læse journalen og logfilerne i `/var/log`. På macOS kører den som root, som launchd-dæmoner gør, og på Windows som LocalSystem, så den kan læse alle hændelseslogfiler og Windows-tjenester.

## Værter sat op manuelt

En vært, hvis collector du selv har installeret med vejledningen [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector), bliver ved med at rapportere som før, og OneUptime sender den ingen konfiguration. For at overdrage den skal du åbne værtens side **Collector**: Dens kommando tilføjer `--replace-existing`, som stopper og deaktiverer den manuelt installerede collector (tjenesten `otelcol-contrib`), så værten ikke rapporterer to gange. Værten beholder sit navn, sin historik og sine etiketter.

## Installationsindstillinger

Kør kommandoen igen for at ændre nogen af disse eller for at skifte til en nyere udgivelse: Den erstatter det, den installerede, og beholder værten, som den er i OneUptime.

| Linux og macOS | Windows | Hvad den gør |
| --- | --- | --- |
| `--url URL` | `-Url URL` | Hvor OneUptime er. |
| `--key KEY` | `-Key KEY` | En telemetri-indtagelsesnøgle fra dit projekt. |
| `--label KEY=VALUE` | `-Label KEY=VALUE` | Sætter en etiket på værten. Gentag den for flere etiketter; på Windows angives de med kommaer. |
| `--env NAME=VALUE` | `-EnvVar NAME=VALUE` | Giver collectoren en miljøvariabel til konfigurationer, der læser `${env:NAME}`. |
| `--version VERSION` | `-Version VERSION` | Den collector-udgivelse, der installeres, som standard 0.161.0. |
| `--download-url URL` | `-DownloadUrl URL` | Henter udgivelserne fra et spejl med samme mappestruktur som GitHubs. |
| `--proxy URL` | `-Proxy URL` | Sender overførslerne og al collectorens trafik gennem en HTTP-proxy. |
| `--replace-existing` | `-ReplaceExisting` | Stopper og deaktiverer en manuelt installeret collector. |
| `--uninstall` | `-Uninstall` | Fjerner collectoren og alt, hvad kommandoen installerede. |

## Afinstallér

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

Værten bliver i OneUptime med sin historik: Arkivér eller slet den på listen **Værter**.

## Fejlfinding

:::details Kommandoen siger, at OneUptime afviste nøglen
HTTP `401`: Nøglen er forkert, er udløbet eller blev slettet. HTTP `422`: Den er deaktiveret, er en browsernøgle eller er låst til én tjeneste. Vælg en aktiveret servernøgle i **Tilføj vært**, og kør kommandoen igen: Den erstatter nøglen på værten.
:::

:::details Værten dukker ikke op
Tjek, at værten kan nå din OneUptime-URL over HTTPS, og læs derefter collectorens log med kommandoen til dens system under [Tjek en værts collector](#tjek-en-værts-collector).
:::

:::details Værten siger, at dens konfiguration mislykkedes
Dens side **Collector** viser, hvorfor konfigurationen ikke startede. Værten bliver ved med at køre den seneste konfiguration, der fungerede, og får den mislykkede igen, når konfigurationen ændres, eller når du vælger **Prøv igen**.
:::

:::details Værten viser "Rapporterer ikke"
OneUptime har ikke hørt fra værtens supervisor i mere end 15 minutter. Tjek, at tjenesten `oneuptime-collector` kører, og at værten stadig kan nå OneUptime.
:::

## Næste trin

:::cards
- [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector): Installer i stedet collectoren selv, og skriv selv dens konfiguration.
- [Værtsmonitor](/docs/monitor/host-monitor): Få besked om det, dine værter rapporterer.
- [Indtagelsesnøgler](/docs/telemetry/ingestion-keys): Opret, afgræns og rotér de nøgler, værter sender med.
- [Kubernetes Agent](/docs/telemetry/kubernetes-agent): Overvåg en klynges noder og arbejdsbelastninger.
:::
