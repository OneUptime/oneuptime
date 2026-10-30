# Hosts

Voeg met één opdracht een Linux-, Windows- of macOS-machine toe aan OneUptime. De opdracht installeert de OpenTelemetry Collector op de host, en OneUptime stuurt de collector zijn configuratie en houdt die actueel: er is geen `config.yaml` om te schrijven, naar elke host te kopiëren of gelijk te houden. Om te wijzigen wat je hosts verzamelen, bewerk je één keer een collectorconfiguratie, en elke host waarvoor die geldt krijgt de wijziging binnen een minuut.

:::cards
- [Een host toevoegen](#een-host-toevoegen): Eén opdracht op Linux, Windows of macOS.
- [Wijzigen wat hosts verzamelen](#wijzigen-wat-hosts-verzamelen): Collectorconfiguraties per systeem en label, met elke versie bewaard.
- [De collector van een host controleren](#de-collector-van-een-host-controleren): De configuratie die hij uitvoert, de versie ervan en waarom een configuratie niet startte.
- [Wat een configuratie mag](#wat-een-configuratie-mag): De host lezen en alleen naar deze OneUptime sturen.
:::

## Hoe het werkt

De opdracht installeert twee programma's uit de releases van de OpenTelemetry Collector, elk gecontroleerd tegen de SHA-256 die de release publiceert: `otelcol-contrib`, de collector die de host leest, en `opampsupervisor`, die de collector uitvoert en op de configuratie houdt die OneUptime via OpAMP stuurt, het OpenTelemetry Agent Management Protocol. Beide draaien als de service `oneuptime-collector`.

```mermaid title="Eén opdracht, daarna houdt OneUptime de host geconfigureerd"
flowchart TB
    command["De installatieopdracht<br/>op de host"] --> supervisor["opampsupervisor"]
    supervisor -->|"vraagt om zijn configuratie<br/>elke 30 seconden"| oneuptime["OneUptime"]
    oneuptime -->|"de configuratie die<br/>de host uitvoert"| supervisor
    supervisor --> collector["otelcol-contrib"]
    collector -->|"OTLP via HTTPS"| oneuptime
```

De supervisor vraagt OneUptime ongeveer elke 30 seconden om de configuratie van de host, met je ingestiesleutel, en meldt welke configuratie de host uitvoert en of die is gestart. De host wordt onder **Hosts** geregistreerd zodra de supervisor voor het eerst verbinding maakt, met de naam van de machine, en zijn pagina's vullen zich naarmate zijn metrics en logs binnenkomen.

Elke host voert één configuratie uit, gekozen in deze volgorde:

| De host voert uit | Wanneer |
| --- | --- |
| De configuratie die op zijn pagina **Collector** voor hem is gekozen | Iemand heeft er een gekozen. |
| De eerste van de **Collectorconfiguraties** die voor hem geldt | Een configuratie geldt als die voor het systeem van de host is en, als ze labels noemt, de host er een van heeft. |
| De standaard van OneUptime voor zijn systeem | Er geldt geen configuratie. |

De standaard van OneUptime leest op elk systeem CPU, geheugen, schijven, bestandssystemen, netwerk en processen; op Linux de journal en systemd-units, waar de host ze heeft; op Windows de gebeurtenislogboeken System, Application en Security en de Windows-services; en op macOS de installatie- en wifi-logs in `/var/log`. Ze laat de bestandssystemen weg die bewust vol zijn, zoals snap-pakketten en `/dev` op macOS, zodat die het sjabloon High Filesystem Usage nooit blijvend laten afgaan. Ze volgt de releases van OneUptime, zodat een host op de standaard de verbeteringen van OneUptime daaraan krijgt.

## Voordat je begint

- Een ingestiesleutel. **Host toevoegen** maakt er een voor je aan, of kies er een die je hebt gemaakt onder **Projectinstellingen → Telemetrie & APM → Ingestiesleutels**.
- Beheerdersrechten op de host: `sudo` op Linux en macOS, PowerShell als administrator op Windows.
- Linux met systemd, Windows 10 of Windows Server 2019 en later, of macOS op Apple silicon of Intel.
- Uitgaand HTTPS van de host naar je OneUptime-URL, rechtstreeks of via een proxy.

## Een host toevoegen

:::steps
### Open Host toevoegen

Open **Producten → Infrastructuur → Hosts** en kies **Host toevoegen**. Kies wat er op de host draait: Linux, Windows of macOS. De nodes van een Kubernetes-cluster worden in plaats daarvan bewaakt door de [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

### Kies een ingestiesleutel

Kies een sleutel, of maak er een aan in het dialoogvenster. De opdracht hieronder vult hem in.

### Voer de opdracht uit op de host

Kopieer de opdracht uit het dialoogvenster en voer hem uit op de host. Dat duurt ongeveer een minuut. Dit zijn dezelfde opdrachten, met je OneUptime-URL en sleutel in plaats van de voorbeelden:

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

Elke OneUptime serveert zijn eigen installatieprogramma's, zodat een zelf gehoste OneUptime het installatieprogramma van zijn eigen release uitdeelt: vervang `https://oneuptime.com` op beide plaatsen door je URL.

### Wacht op de host

De laatste stap van het dialoogvenster meldt wanneer de host verbinding maakt, met een link ernaartoe. In de lijst staat hij als **Wordt gestart** tot zijn eerste metrics binnenkomen, meestal binnen een minuut, en daarna als verbonden, met zijn collector **Actief**. De pagina **Topologie** van de host tekent op één kaart wat erop draait, wat hem aanroept en wat hij aanroept: zie [Topologie](/docs/telemetry/topology#de-eigen-kaart-van-een-resource-openen).
:::

## Hosts labelen

Voeg labels toe aan de opdracht, en de host heeft ze vanaf het moment dat hij verbinding maakt:

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

`env=production` wordt het label `env:production`. Labels worden toegevoegd, nooit verwijderd: voer de opdracht opnieuw uit met een ander label en de host heeft ze allebei. Je kunt hosts ook labelen in de lijst **Hosts** of met **Labelregels**. Een collectorconfiguratie die labels noemt, is alleen voor hosts met een van die labels, zodat dezelfde opdracht met andere labels elke groep hosts een eigen configuratie geeft.

## Wijzigen wat hosts verzamelen

:::steps
### Maak een collectorconfiguratie

Open **Producten → Infrastructuur → Hosts → Collectorconfiguraties** en kies **Collectorconfiguratie aanmaken**. Geef haar een naam, het systeem van de hosts waarvoor ze is en, om er maar een deel van te bereiken, hun labels. Haar configuratie begint als de standaard van OneUptime voor dat systeem.

### Bewerk haar config.yaml

Kies op de pagina van de configuratie **Configuratie bewerken**, wijzig de YAML en sla op. OneUptime controleert hem eerst en weigert een configuratie die het niet kan versturen, met de reden: zie [Wat een configuratie mag](#wat-een-configuratie-mag).

### Zie haar de hosts bereiken

Elke opgeslagen wijziging is een nieuwe versie, en de hosts waarvoor ze geldt krijgen haar binnen een minuut. De lijst **Hosts** van de configuratie toont elke host, de status van zijn collector en de versie die hij uitvoert.
:::

Een host voert de eerste configuratie in de lijst uit die voor hem geldt: sleep de rijen in **Collectorconfiguraties** om de volgorde te wijzigen. Zet de nauwste configuraties bovenaan, zoals een voor webservers met `env:production`, en brede, zoals een voor elke Linux-host, daaronder. De kaart **Standaarden van OneUptime** onder de lijst toont wat een host uitvoert als er geen configuratie geldt.

### Versies en terugzetten

De lijst **Versies** van een configuratie bewaart elke opgeslagen wijziging, de nieuwste eerst, met wie haar opsloeg en wanneer. Kies **Bekijken** om een versie te lezen, en **Terugzetten** om haar opnieuw naar de hosts te sturen: ze wordt opgeslagen als een nieuwe versie die zegt welke ze terugzette, zodat de lijst altijd vertelt wat elke host kreeg.

### Kies een configuratie voor één host

Kies op de pagina **Collector** van een host **Configuratie wijzigen** en kies een configuratie voor alleen deze host. Configuraties voor het systeem van de host en voor elk systeem worden aangeboden. Kies Automatisch om de host terug te geven aan de lijst. Een host waarvan de gekozen configuratie wordt verwijderd, gaat vanzelf terug naar de lijst.

### Als een configuratie niet start

De supervisor controleert een nieuwe configuratie met de collector voordat hij erop overschakelt, en gaat terug naar de laatste configuratie die werkte als er een niet start. De host blijft al die tijd versturen. Zijn pagina **Collector** toont **Configuratie mislukt** met de reden van de collector, zoals een logbestand dat de collector niet mag lezen, en OneUptime stuurt die configuratie pas opnieuw naar de host als ze verandert. Als je de oorzaak op de host hebt opgelost, kies je **Opnieuw proberen** om haar nog een keer te sturen.

## Wat een configuratie mag

Een configuratie die OneUptime stuurt, draait op elke host waarvoor ze geldt, dus OneUptime controleert haar bij elke opslag en weigert er een die een regel breekt:

| Regel | Waarom |
| --- | --- |
| Alleen de receivers, processors, exporters, extensions en connectors op de lijst van OneUptime | Ze leest de host en de services erop. Een component die programma's uitvoert of inloggegevens van een cloud of cluster leest, staat niet op de lijst. |
| Gegevens verlaten de host alleen via de exporter `otlp_http`, naar `${env:ONEUPTIME_URL}/otlp` met de header `x-oneuptime-token: ${env:ONEUPTIME_INGESTION_KEY}` | Elke host stuurt naar deze OneUptime, met de sleutel waarmee hij is geïnstalleerd. Geen configuratie bevat een sleutel. |
| `${env:NAME}` is de enige `${...}` die ze mag gebruiken | Een `${file:...}` of `${https:...}` zou op elke host worden gelezen en kan worden doorgestuurd. |
| Geen instelling die een programma uitvoert of een bestand verstuurt dat ze leest, zoals `journalctl_path` van journald | Een configuratie mag niet verder reiken dan de host lezen. |

Een configuratie kan toch een zijn die een host niet kan uitvoeren, zoals een receiver voor een ander systeem of een logbestand dat daar niet bestaat. De collector op elke host controleert dat voordat hij overschakelt, zoals [Als een configuratie niet start](#als-een-configuratie-niet-start) beschrijft.

## De collector van een host controleren

Open de host en zijn pagina **Collector**. Die toont hoe de collector ervoor staat, de configuratie die hij uitvoert en **Waarom deze configuratie**, de versie die hij uitvoert, zijn **Laatste melding** en zijn **Collectorrelease**. Onder **Op de host** staan de opdrachten om hem te controleren vanuit een shell op de host: of zijn service draait, zijn log en een herstart.

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

Op Linux draait de collector als de onbevoegde gebruiker `oneuptime-collector`, in de groepen `systemd-journal` en `adm`, zodat hij de journal en de logs in `/var/log` kan lezen. Op macOS draait hij als root, zoals launchd-daemons, en op Windows als LocalSystem, zodat hij elk gebeurtenislogboek en elke Windows-service kan lezen.

## Handmatig ingerichte hosts

Een host waarvan je de collector zelf hebt geïnstalleerd, met de handleiding [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector), blijft melden zoals voorheen, en OneUptime stuurt hem geen configuratie. Om hem over te dragen, open je de pagina **Collector** van de host: de opdracht daar voegt `--replace-existing` toe, dat de handmatig geïnstalleerde collector (de service `otelcol-contrib`) stopt en uitschakelt, zodat de host niet dubbel meldt. De host behoudt zijn naam, zijn geschiedenis en zijn labels.

## Installatieopties

Voer de opdracht opnieuw uit om een van deze te wijzigen, of om over te stappen op een nieuwere release: ze vervangt wat ze installeerde en laat de host in OneUptime zoals hij is.

| Linux en macOS | Windows | Wat het doet |
| --- | --- | --- |
| `--url URL` | `-Url URL` | Waar OneUptime is. |
| `--key KEY` | `-Key KEY` | Een telemetrie-ingestiesleutel van je project. |
| `--label KEY=VALUE` | `-Label KEY=VALUE` | Labelt de host. Herhaal het voor meer labels; op Windows som je ze op met komma's. |
| `--env NAME=VALUE` | `-EnvVar NAME=VALUE` | Geeft de collector een omgevingsvariabele, voor configuraties die `${env:NAME}` lezen. |
| `--version VERSION` | `-Version VERSION` | De collectorrelease die wordt geïnstalleerd, standaard 0.161.0. |
| `--download-url URL` | `-DownloadUrl URL` | Downloadt de releases van een mirror met dezelfde mappenstructuur als die van GitHub. |
| `--proxy URL` | `-Proxy URL` | Stuurt de downloads en al het verkeer van de collector via een HTTP-proxy. |
| `--replace-existing` | `-ReplaceExisting` | Stopt en schakelt een handmatig geïnstalleerde collector uit. |
| `--uninstall` | `-Uninstall` | Verwijdert de collector en alles wat de opdracht installeerde. |

## Verwijderen

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

De host blijft met zijn geschiedenis in OneUptime: archiveer of verwijder hem in de lijst **Hosts**.

## Problemen oplossen

:::details De opdracht meldt dat OneUptime de sleutel weigerde
HTTP `401`: de sleutel is fout, verlopen of verwijderd. HTTP `422`: hij is uitgeschakeld, een browsersleutel of vastgezet op één service. Kies in **Host toevoegen** een ingeschakelde serversleutel en voer de opdracht opnieuw uit: ze vervangt de sleutel op de host.
:::

:::details De host verschijnt niet
Controleer of de host je OneUptime-URL via HTTPS bereikt, en lees daarna het log van de collector met de opdracht voor zijn systeem in [De collector van een host controleren](#de-collector-van-een-host-controleren).
:::

:::details De host meldt dat zijn configuratie mislukte
Zijn pagina **Collector** toont waarom de configuratie niet startte. De host blijft de laatste configuratie uitvoeren die werkte, en krijgt de mislukte opnieuw als de configuratie verandert of als je **Opnieuw proberen** kiest.
:::

:::details De host toont 'Rapporteert niet'
OneUptime heeft al meer dan 15 minuten niets gehoord van de supervisor van de host. Controleer of de service `oneuptime-collector` draait en of de host OneUptime nog bereikt.
:::

## Volgende stappen

:::cards
- [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector): Installeer de collector in plaats daarvan zelf en schrijf zelf zijn configuratie.
- [Hostmonitor](/docs/monitor/host-monitor): Krijg meldingen over wat je hosts rapporteren.
- [Ingestiesleutels](/docs/telemetry/ingestion-keys): Maak, beperk en roteer de sleutels waarmee hosts versturen.
- [Kubernetes Agent](/docs/telemetry/kubernetes-agent): Bewaak de nodes en workloads van een cluster.
:::
