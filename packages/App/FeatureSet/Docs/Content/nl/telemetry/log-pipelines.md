# Logboekpipelines

Logboekpipelines bewerken logboeken terwijl OneUptime ze opneemt, nog voordat ze worden opgeslagen. Een pipeline heeft een **filter** dat bepaalt op welke logboeken hij van toepassing is en een geordende lijst **processors** die die logboeken elk aanpassen: velden uit het bericht halen, de ernst corrigeren, een attribuut hernoemen of het logboek van een categorie voorzien.

Pipelines staan onder **Logboeken → Instellingen → Pipelines**.

:::cards
- [Hoe een pipeline draait](#hoe-een-pipeline-draait): Waar pipelines in de opname zitten en in welke volgorde ze draaien.
- [Een pipeline maken](#een-pipeline-maken): Logboeken selecteren en er processors aan toevoegen.
- [Key=Value Parser](#keyvalue-parser): Firewall- en logfmt-regels omzetten in attributen.
- [Voorbeeld: Sophos XGS-firewall](#voorbeeld-sophos-xgs-firewall): Firewall-syslog van begin tot eind parsen.
:::

## Hoe een pipeline draait

Pipelines draaien op elk logboek dat OneUptime opneemt, of het nu OpenTelemetry-logboeken, syslog of Fluentd zijn, na de drop-filters en scrubregels en voordat het logboek wordt opgeslagen:

```mermaid title="Waar pipelines draaien terwijl een logboek wordt opgenomen"
flowchart TB
    arrive["Logboek komt binnen"] --> drop{"Komt een drop-filter overeen?"}
    drop -->|"ja"| discarded["Weggegooid"]
    drop -->|"nee"| scrub["Scrubregels maskeren gegevens"]
    scrub --> filter{"Komt het filter van de<br/>volgende pipeline overeen?"}
    filter -->|"ja"| processors["Zijn processors op volgorde uitvoeren"]
    filter -->|"nee"| more{"Meer pipelines?"}
    processors --> more
    more -->|"ja"| filter
    more -->|"nee"| stored["Logboek wordt opgeslagen"]
```

- **Pipelines draaien op volgorde**: de volgorde van de lijst, die u wijzigt door rijen te slepen. Een pipeline raakt alleen de logboeken waarop zijn filter overeenkomt, en elke pipeline waarvan het filter overeenkomt draait, niet alleen de eerste.
- **Ook processors draaien op volgorde**, en elke processor ziet wat de vorige heeft gemaakt; een parser moet dus vóór een processor staan die de velden leest die de parser eruit haalt. Ook het filter van een latere pipeline ziet wat eerdere pipelines hebben veranderd.
- **De verwerking gebeurt bij de opname.** Een wijziging aan een pipeline geldt voor logboeken die daarna binnenkomen, binnen ongeveer een minuut; al opgeslagen logboeken worden niet opnieuw verwerkt.
- **Een processor gooit nooit een logboek weg en maakt het nooit leeg.** Een regel die een parser niet kan lezen, gaat ongewijzigd door. Gebruik **Logboeken → Instellingen → Drop-filters** om logboeken weg te gooien.
- **Alleen ingeschakelde pipelines en processors draaien.** Schakel er een uit op zijn pagina om hem te pauzeren zonder zijn instellingen te verliezen.

## Processortypen

| Processor | Wat hij doet |
| --- | --- |
| Grok Parser | Haalt velden uit een regel met een vaste vorm (een nginx-toegangsregel) met een benoemd patroon. |
| Key=Value Parser | Splitst een regel van `key=value`-paren (Sophos XGS, Fortinet, logfmt) in attributen, in willekeurige volgorde. |
| Ernst-hertoewijzer | Zet een ruw niveau zoals `warn` uit een attribuut om naar de standaardernst van het logboek. |
| Attribuut-hertoewijzer | Hernoemt of kopieert een attribuut, bijvoorbeeld `src_ip` naar `source_ip`. |
| Categorieverwerker | Voorziet een logboek van een categorienaam als het op een filter overeenkomt, bijvoorbeeld "Payment Error". |

## Voordat u begint

- Logboeken die in OneUptime binnenkomen, via [OpenTelemetry](/docs/telemetry/open-telemetry), [syslog](/docs/telemetry/syslog), [Fluentd](/docs/telemetry/fluentd) of een probe.
- Toestemming om pipelines te wijzigen. Projecteigenaren en beheerders hebben die; alle anderen hebben de machtigingen **Create Log Pipeline** en **Create Log Pipeline Processor** nodig.

## Een pipeline maken

:::steps
### De pipeline aanmaken

Ga naar **Logboeken → Instellingen → Pipelines** en klik op **Logboek Pipeline aanmaken**. Geef hem een **Naam**, zoals *Firewall-logboeken parsen*, en maak hem aan. De pagina van de pipeline opent.

### Kiezen op welke logboeken hij van toepassing is

Klik onder **Filtervoorwaarden** op **Bewerken** en voeg voorwaarden toe op **Ernst**, **Logtekst**, **Service-ID** of een eigen attribuut. Verbind ze met **Alle voorwaarden** of **Een van de voorwaarden** en klik op **Wijzigingen opslaan**. Een pipeline zonder voorwaarden geldt voor elk logboek.

### Processors toevoegen

Klik onder **Processors** op **Processor toevoegen**, vul een **Processornaam** in, kies een **Processortype** en vul de instellingen in. De Grok- en Key=Value-parsers hebben een tester: plak een voorbeeldregel om te zien wat ze eruit zouden halen. Klik op **Processor aanmaken**.

### Ze op volgorde zetten

Sleep processors om de volgorde te wijzigen waarin ze draaien, en sleep pipelines op dezelfde manier in de lijst **Pipelines**. Nieuwe logboeken worden binnen ongeveer een minuut verwerkt.
:::

### Filtervoorwaarden

Elke voorwaarde vergelijkt een veld met een waarde. Achter de bouwer is het filter een query zoals `severityText = 'Error' AND body LIKE 'timeout'`, die **Preview query** toont.

| Operator | In de query | Opmerkingen |
| --- | --- | --- |
| is gelijk aan | `=` | Exact en hoofdlettergevoelig. |
| is niet gelijk aan | `!=` | Exact en hoofdlettergevoelig. |
| bevat | `LIKE` | Negeert hoofdletters. `%` in de waarde is een jokerteken. |
| is een van | `IN` | Een door komma's gescheiden lijst van exacte waarden. |

De ernstwaarden zijn `Fatal`, `Error`, `Warning`, `Information`, `Debug`, `Trace` en `Unspecified`, dus `severityText = 'Error'` komt overeen en `'ERROR'` nooit. Een eigen attribuut schrijft u als `attributes.<key>`, bijvoorbeeld `attributes.networkDevice.name = 'hq-firewall'`.

## Key=Value Parser

Firewalls en andere netwerkapparaten loggen elke gebeurtenis als één regel van `key=value`-paren. Welke velden een regel heeft, en in welke volgorde, hangt af van de gebeurtenis, dus geen enkel grok-patroon kan ze beschrijven. De Key=Value Parser heeft er geen nodig: hij loopt de regel door en maakt van elk gevonden paar een logboekattribuut, ongeacht de volgorde. Als attributen kunt u erop zoeken en filteren, ze gebruiken in een [logs-monitor](/docs/monitor/logs-monitor) en per tunnel, interface of gebruiker één keer waarschuwen met [Groeperen op](/docs/monitor/logs-monitor#waarschuwingen-per-groep-group-by).

### Configuratie

| Instelling | Standaard | Beschrijving |
| --- | --- | --- |
| Source Field | `body` | Het veld om te parsen: `body` voor het logbericht, of een attribuut zoals `attributes.raw_line`. |
| Target Prefix | geen | Een naamruimte voor de geëxtraheerde sleutels. `sophos` slaat `con_name` op als `sophos.con_name`. Er wordt een scheidingsteken toegevoegd, tenzij het voorvoegsel al op `.`, `_`, `-` of `:` eindigt. |
| Pair Delimiter | elke witruimte | Wat het ene paar van het volgende scheidt. Laat het leeg voor Sophos, Fortinet en logfmt; gebruik `,`, `;` of `\|` voor andere formaten. |
| Key-Value Delimiter | `=` | Wat een sleutel van zijn waarde scheidt, bijvoorbeeld `:` voor `status:up`. |
| Overschrijven bij conflict | uit | Of een sleutel een attribuut mag vervangen dat het logboek al heeft. Standaard uit: de sleutels komen uit de regel zelf, dus anders zou een regel attributen kunnen overschrijven die bij de opname zijn gezet, zoals het apparaat waar hij vandaan kwam. |

De twee scheidingstekens moeten verschillen, mogen elkaar niet bevatten en mogen geen aanhalingstekens of backslashes bevatten; elk is hoogstens 8 tekens lang. Het processorformulier controleert dit vóór het opslaan, en de tester ervan, **Test With a Sample Line**, toont precies welke attributen een voorbeeldregel zou opleveren.

### Parseerregels

- **Waarden tussen aanhalingstekens** behouden hun spaties en scheidingstekens: `message="IPSec Connection HQ-Branch1 terminated"` is één waarde. Dubbele en enkele aanhalingstekens werken allebei, en `\"` binnen een waarde is een letterlijk aanhalingsteken. Een aanhalingsteken dat nooit wordt gesloten (een regel die door een syslog-groottelimiet is afgekapt) loopt door tot het einde van de regel.
- **Waarden zonder aanhalingstekens** lopen tot het volgende paarscheidingsteken, dus `url=https://example.com/?a=b` behoudt zijn `=`.
- **Lege waarden** (`key=` en `key=""`) worden als lege tekenreeksen opgeslagen.
- **Waarden zijn altijd tekst.** `latency=11` wordt opgeslagen als `"11"`, net als een grok-vangst zonder type.
- **Sleutels** beginnen met een letter of underscore en bevatten letters, cijfers en `. _ - @`. Tekst vóór het eerste paar, zoals een syslog-header volgens RFC 3164, en losse woorden zonder scheidingsteken worden overgeslagen. Een syslog-prioriteit die aan de eerste sleutel vastzit (`<30>device_name="SFW"`), wordt verwijderd en de sleutel behouden.
- **Een herhaalde sleutel behoudt zijn eerste waarde**; latere worden genegeerd.
- **Limieten:** een regel langer dan 32 KiB wordt niet geparst, uit één regel worden hoogstens 100 paren genomen, sleutels langer dan 256 tekens worden overgeslagen en waarden langer dan 4096 tekens worden ingekort.

### Voorbeeld: Sophos XGS-firewall

Wanneer een Sophos XGS-firewall syslog naar een [probe](/docs/monitor/network-device-monitor) stuurt, wordt elk bericht opgeslagen als logboek van het netwerkapparaat, met het syslog-bericht als tekst. Zo parset u het:

:::steps
#### Een pipeline voor de firewall maken

Ga naar **Logboeken → Instellingen → Pipelines** en maak een pipeline aan. Geef hem een filter dat op de logboeken van de firewall overeenkomt, bijvoorbeeld het eigen attribuut `networkDevice.name` is gelijk aan `hq-firewall` (`attributes.networkDevice.name = 'hq-firewall'`), of **Logtekst** bevat `log_component=` om elke Sophos-regel te raken.

#### De parser toevoegen

Open de pipeline en klik op **Processor toevoegen**. Kies **Key=Value Parser**, laat **Source Field** op `body` staan en zet **Target Prefix** op `sophos` (optioneel, maar het houdt de velden van de firewall bij elkaar).

#### Testen en opslaan

Plak een regel van de firewall in **Test With a Sample Line** om het resultaat te controleren, en klik daarna op **Processor aanmaken**.
:::

Een Sophos IPsec-gebeurtenis:

```text
device_name="SFW" timestamp="2024-05-02T11:03:12+0200" device_model="XGS2100" device_serial_id="X1234" log_id="010101600001" log_type="Event" log_component="IPSec" log_subtype="System" severity="Information" con_name="HQ-Branch1" src_ip="10.171.4.117" dst_ip="10.171.4.118" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."
```

wordt deze attributen (onder andere):

| Attribuut | Waarde |
| --- | --- |
| `sophos.log_component` | `IPSec` |
| `sophos.con_name` | `HQ-Branch1` |
| `sophos.status` | `Terminated` |
| `sophos.src_ip` | `10.171.4.117` |
| `sophos.message` | `IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated.` |

Een SD-WAN SLA-regel heeft andere velden in een andere volgorde, en dezelfde processor verwerkt hem:

```text
log_id=158825619025 log_type="SD-WAN" log_component="SLA" profile_name="Branch-Internet" gw_name="WAN2" latency=11 jitter=2 packet_loss=0 gw_status="up" sla_status="SLA met"
```

geeft `sophos.gw_name = WAN2`, `sophos.latency = 11`, `sophos.packet_loss = 0`, `sophos.gw_status = up` en `sophos.sla_status = SLA met`. Oudere SFOS-versies loggen een verouderd formaat (`device="SFW" date=2017-01-31 time=18:02:03 timezone="IST" ... connectionname="Tunnel A"`); dat wordt op dezelfde manier geparst, met de tunnelnaam in `connectionname` in plaats van `con_name`.

Hoe u die SLA-regels omzet in metrieken voor latentie, jitter en pakketverlies per gateway, ziet u in het voorbeeld bij [Opnameregels voor logboeken](/docs/telemetry/log-recording-rules).

### Voorbeeld: Fortinet FortiGate

FortiGate-logboeken volgen dezelfde stijl:

```text
date=2024-01-01 time=10:00:00 devname="FG100" logid="0100032001" type="event" subtype="vpn" level="notice" action="tunnel-down" vpntunnel="HQ-to-Branch2" msg="IPsec tunnel down"
```

Met de standaardinstellingen en een voorvoegsel `fortigate` levert dit `fortigate.devname = FG100`, `fortigate.subtype = vpn`, `fortigate.action = tunnel-down`, `fortigate.vpntunnel = HQ-to-Branch2` en `fortigate.time = 10:00:00` op: de dubbele punten in een tijdstip horen bij de waarde, het zijn geen scheidingstekens.

### Eén keer per tunnel waarschuwen

Met de geparste velden kan een [logs-monitor](/docs/monitor/logs-monitor) de storingen tellen en voor elke tunnel een aparte waarschuwing openen: filter op `sophos.log_component` = `IPSec` met een tekst die `terminated` bevat, en groepeer op `sophos.con_name`. Zie [Waarschuwingen per groep](/docs/monitor/logs-monitor#waarschuwingen-per-groep-group-by).

## Grok Parser

Haalt gestructureerde velden uit een regel met een vaste vorm. Een grok-patroon is een reguliere expressie met benoemde verwijzingen: `%{IPV4:client_ip}` betekent "zoek een IPv4-adres en sla het op als `client_ip`". Het patroon hoeft niet de hele regel te dekken, en een regel die niet overeenkomt, blijft ongewijzigd.

| Instelling | Standaard | Beschrijving |
| --- | --- | --- |
| **Source Field** | `body` | Het veld om te parsen, net als bij de Key=Value Parser. |
| **Target Prefix** | geen | Een naamruimte voor de geëxtraheerde velden, op dezelfde manier toegevoegd. |
| **Grok Pattern** | — | Het patroon. Het formulier somt de beschikbare benoemde patronen op. |

Een vangst wordt als tekst opgeslagen, tenzij u er een type aan geeft: `%{NUMBER:status:int}` slaat hem op als getal. De typen zijn `int`, `long`, `float`, `double`, `boolean` en `string`. Controleer een patroon met een voorbeeldregel in **Test Your Pattern** voordat u het opslaat.

| Logtekst | Patroon | Toegevoegde attributen |
| --- | --- | --- |
| `10.0.1.5 - GET /health 200` | `%{IPV4:client_ip} - %{WORD:method} %{NOTSPACE:path} %{NUMBER:status:int}` | client_ip, method, path, status |

Gebruik in plaats daarvan de Key=Value Parser wanneer de regel bestaat uit `key=value`-paren waarvan de volgorde wisselt.

## Ernst-hertoewijzer

Leest een ruwe waarde uit een attribuut en zet die om naar een standaardernst. Zet **Bronattribuut** op het attribuut dat het niveau bevat (standaard `level`) en voeg dan **Toewijzingen** toe: elk koppelt een waarde die uw applicatie uitstuurt, zoals `warn`, aan een ernst, zoals Warning. Het vergelijken negeert hoofdletters. Een waarde zonder toewijzing laat de ernst van het logboek zoals die was.

## Attribuut-hertoewijzer

Verplaatst de waarde van het ene attribuut (**Bronsleutel**) naar een ander (**Doelsleutel**), bijvoorbeeld `src_ip` naar `source_ip`.

| Instelling | Standaard | Effect |
| --- | --- | --- |
| **Bron behouden** | uit | Uit hernoemt het attribuut: de bronsleutel wordt verwijderd. Aan kopieert het en behoudt de bronsleutel. |
| **Overschrijven bij conflict** | aan | Aan vervangt het doel als het al bestaat. Uit laat het doel met rust en slaat de hertoewijzing over. |

## Categorieverwerker

Evalueert een lijst regels op volgorde en slaat de naam van de eerste regel waarvan het filter overeenkomt op in een doelattribuut, zodat u in één keer alle "Payment Error"-logboeken vindt. Stel **Doelattribuut** in (standaard `category`) en voeg dan **Categorieregels** toe: een **Category name** en de voorwaarden onder **When logs match**. De eerste overeenkomende regel wint; een logboek dat op geen enkele overeenkomt, blijft ongewijzigd.

## Volgende stappen

:::cards
- [Logs-monitor](/docs/monitor/logs-monitor): Waarschuwen op de attributen die uw pipelines eruit halen.
- [Opnameregels voor logboeken](/docs/telemetry/log-recording-rules): Geparste logboekvelden omzetten in metrieken.
- [Syslog](/docs/telemetry/syslog): Syslog van firewalls en servers naar OneUptime sturen.
- [Zoeksyntaxis](/docs/telemetry/search-syntax): Op de nieuwe attributen zoeken in de logboekverkenner.
:::
