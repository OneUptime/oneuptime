# Pipeline dei log

Le pipeline dei log trasformano i log mentre OneUptime li acquisisce, prima che vengano memorizzati. Una pipeline ha un **filtro** che decide a quali log si applica e un elenco ordinato di **processori** che modificano ciascuno quei log: estrarre campi dal messaggio, correggere la gravità, rinominare un attributo o contrassegnare il log con una categoria.

Le pipeline si trovano in **Registri → Impostazioni → Pipeline**.

:::cards
- [Come viene eseguita una pipeline](#come-viene-eseguita-una-pipeline): Dove si collocano le pipeline nell'acquisizione e in quale ordine vengono eseguite.
- [Creare una pipeline](#creare-una-pipeline): Selezionare alcuni log e aggiungere loro dei processori.
- [Key=Value Parser](#keyvalue-parser): Trasformare le righe di firewall e logfmt in attributi.
- [Esempio: firewall Sophos XGS](#esempio-firewall-sophos-xgs): Analizzare il syslog di un firewall dall'inizio alla fine.
:::

## Come viene eseguita una pipeline

Le pipeline vengono eseguite su ogni log che OneUptime acquisisce, che si tratti di log OpenTelemetry, syslog o Fluentd, dopo i filtri di scarto e le regole di oscuramento, e prima che il log venga memorizzato:

```mermaid title="Dove vengono eseguite le pipeline durante l'acquisizione di un log"
flowchart TB
    arrive["Arriva il log"] --> drop{"Corrisponde a un<br/>filtro di scarto?"}
    drop -->|"sì"| discarded["Scartato"]
    drop -->|"no"| scrub["Le regole di oscuramento<br/>mascherano i dati"]
    scrub --> filter{"Il filtro della pipeline<br/>successiva corrisponde?"}
    filter -->|"sì"| processors["Eseguire i suoi processori in ordine"]
    filter -->|"no"| more{"Altre pipeline?"}
    processors --> more
    more -->|"sì"| filter
    more -->|"no"| stored["Il log viene memorizzato"]
```

- **Le pipeline vengono eseguite in ordine**: quello dell'elenco, che cambiate trascinando le righe. Una pipeline tocca solo i log a cui corrisponde il suo filtro, e viene eseguita ogni pipeline il cui filtro corrisponde, non solo la prima.
- **Anche i processori vengono eseguiti in ordine**, e ciascuno vede ciò che ha prodotto il precedente, quindi un parser deve venire prima di un processore che legge i campi che estrae. Anche il filtro di una pipeline successiva vede ciò che le pipeline precedenti hanno cambiato.
- **L'elaborazione avviene all'acquisizione.** La modifica di una pipeline riguarda i log che arrivano dopo, entro circa un minuto; i log già memorizzati non vengono rielaborati.
- **Un processore non scarta né svuota mai un log.** Una riga che un parser non riesce a leggere passa invariata. Per scartare log, usate **Registri → Impostazioni → Filtri di scarto**.
- **Vengono eseguiti solo pipeline e processori abilitati.** Disattivatene uno nella sua pagina per metterlo in pausa senza perderne la configurazione.

## Tipi di processore

| Processore | Cosa fa |
| --- | --- |
| Grok Parser | Estrae campi da una riga di forma fissa (una riga di accesso nginx) con un modello con nome. |
| Key=Value Parser | Divide una riga di coppie `key=value` (Sophos XGS, Fortinet, logfmt) in attributi, in qualsiasi ordine. |
| Rimappatore di gravità | Associa un livello grezzo come `warn`, letto da un attributo, alla gravità standard del log. |
| Rimappatore di attributi | Rinomina o copia un attributo, per esempio `src_ip` in `source_ip`. |
| Processore di categoria | Contrassegna un log con un nome di categoria quando corrisponde a un filtro, per esempio «Payment Error». |

## Prima di iniziare

- Log che arrivano in OneUptime, tramite [OpenTelemetry](/docs/telemetry/open-telemetry), [syslog](/docs/telemetry/syslog), [Fluentd](/docs/telemetry/fluentd) o una sonda.
- Il permesso di modificare le pipeline. Proprietari e amministratori del progetto lo hanno; tutti gli altri hanno bisogno dei permessi **Create Log Pipeline** e **Create Log Pipeline Processor**.

## Creare una pipeline

:::steps
### Creare la pipeline

Andate in **Registri → Impostazioni → Pipeline** e fate clic su **Crea: Pipeline registri**. Assegnatele un **Nome**, per esempio *Analizzare i log del firewall*, e createla. Si apre la pagina della pipeline.

### Scegliere a quali log si applica

In **Condizioni di filtro**, fate clic su **Modifica** e aggiungete condizioni su **Gravità**, **Corpo del log**, **ID servizio** o un attributo personalizzato. Collegatele con **Tutte le condizioni** o **Almeno una condizione**, poi fate clic su **Salva modifiche**. Una pipeline senza condizioni si applica a ogni log.

### Aggiungere processori

In **Processori**, fate clic su **Aggiungi processore**, inserite un **Nome del processore**, scegliete un **Tipo di processore** e compilatene le impostazioni. I parser Grok e Key=Value hanno un tester: incollate una riga di esempio per vedere cosa estrarrebbero. Fate clic su **Crea processore**.

### Metterli in ordine

Trascinate i processori per cambiare l'ordine in cui vengono eseguiti, e trascinate allo stesso modo le pipeline nell'elenco **Pipeline**. I nuovi log vengono elaborati entro circa un minuto.
:::

### Condizioni di filtro

Ogni condizione confronta un campo con un valore. Dietro il generatore, il filtro è una query come `severityText = 'Error' AND body LIKE 'timeout'`, che **Preview query** mostra.

| Operatore | Nella query | Note |
| --- | --- | --- |
| è uguale a | `=` | Esatto e sensibile a maiuscole e minuscole. |
| non è uguale a | `!=` | Esatto e sensibile a maiuscole e minuscole. |
| contiene | `LIKE` | Ignora maiuscole e minuscole. `%` nel valore è un carattere jolly. |
| è uno di | `IN` | Un elenco di valori esatti separati da virgole. |

I valori di gravità sono `Fatal`, `Error`, `Warning`, `Information`, `Debug`, `Trace` e `Unspecified`, quindi `severityText = 'Error'` corrisponde e `'ERROR'` non corrisponderà mai. Un attributo personalizzato si scrive `attributes.<key>`, per esempio `attributes.networkDevice.name = 'hq-firewall'`.

## Key=Value Parser

Firewall e altri apparati di rete registrano ogni evento come una riga di coppie `key=value`. Quali campi abbia una riga, e in che ordine, dipende dall'evento, quindi nessun singolo modello grok può descriverli. Il Key=Value Parser non ne ha bisogno: percorre la riga e trasforma ogni coppia che trova in un attributo del log, qualunque sia l'ordine. Una volta diventati attributi, potete cercarli e filtrarli, usarli in un [monitor log](/docs/monitor/logs-monitor) e ricevere un avviso per ogni tunnel, interfaccia o utente con [Raggruppa per](/docs/monitor/logs-monitor).

### Configurazione

| Impostazione | Predefinito | Descrizione |
| --- | --- | --- |
| Source Field | `body` | Il campo da analizzare: `body` per il messaggio del log, o un attributo come `attributes.raw_line`. |
| Target Prefix | nessuno | Uno spazio dei nomi per le chiavi estratte. `sophos` memorizza `con_name` come `sophos.con_name`. Viene aggiunto un separatore a meno che il prefisso non finisca già con `.`, `_`, `-` o `:`. |
| Pair Delimiter | qualsiasi spazio | Ciò che separa una coppia dalla successiva. Lasciatelo vuoto per Sophos, Fortinet e logfmt; impostate `,`, `;` o `\|` per altri formati. |
| Key-Value Delimiter | `=` | Ciò che separa una chiave dal suo valore, per esempio `:` per `status:up`. |
| Sovrascrivi in caso di conflitto | disattivato | Se una chiave può sostituire un attributo che il log ha già. Disattivato per impostazione predefinita: le chiavi vengono dalla riga stessa, quindi altrimenti una riga potrebbe riscrivere attributi impostati all'acquisizione, come il dispositivo da cui proviene. |

I due delimitatori devono essere diversi, non devono contenersi a vicenda e non possono contenere virgolette o barre rovesciate; ciascuno è lungo al massimo 8 caratteri. Il modulo del processore lo verifica prima del salvataggio, e il suo tester, **Test With a Sample Line**, mostra esattamente gli attributi che una riga di esempio produrrebbe.

### Regole di analisi

- **I valori tra virgolette** conservano spazi e delimitatori: `message="IPSec Connection HQ-Branch1 terminated"` è un unico valore. Funzionano sia le virgolette doppie sia quelle singole, e `\"` dentro un valore è una virgoletta letterale. Una virgoletta mai chiusa (una riga troncata da un limite di dimensione del syslog) arriva fino alla fine della riga.
- **I valori senza virgolette** arrivano fino al delimitatore di coppia successivo, quindi `url=https://example.com/?a=b` conserva il suo `=`.
- **I valori vuoti** (`key=` e `key=""`) vengono memorizzati come stringhe vuote.
- **I valori sono sempre testo.** `latency=11` viene memorizzato come `"11"`, come una cattura grok senza tipo.
- **Le chiavi** iniziano con una lettera o un trattino basso e contengono lettere, cifre e `. _ - @`. Il testo prima della prima coppia, come un'intestazione syslog RFC 3164, e le parole isolate senza delimitatore vengono saltati. Una priorità syslog attaccata alla prima chiave (`<30>device_name="SFW"`) viene rimossa e la chiave conservata.
- **Una chiave ripetuta conserva il primo valore**; i successivi vengono ignorati.
- **Limiti:** una riga più lunga di 32 KiB non viene analizzata, da una riga si prendono al massimo 100 coppie, le chiavi più lunghe di 256 caratteri vengono saltate e i valori più lunghi di 4096 caratteri vengono troncati.

### Esempio: firewall Sophos XGS

Quando un firewall Sophos XGS invia syslog a una [sonda](/docs/monitor/network-device-monitor), ogni messaggio viene memorizzato come log del dispositivo di rete, con il messaggio syslog come corpo. Per analizzarlo:

:::steps
#### Creare una pipeline per il firewall

Andate in **Registri → Impostazioni → Pipeline** e create una pipeline. Assegnatele un filtro che corrisponda ai log del firewall, per esempio l'attributo personalizzato `networkDevice.name` è uguale a `hq-firewall` (`attributes.networkDevice.name = 'hq-firewall'`), oppure **Corpo del log** contiene `log_component=` per includere ogni riga Sophos.

#### Aggiungere il parser

Aprite la pipeline e fate clic su **Aggiungi processore**. Scegliete **Key=Value Parser**, lasciate **Source Field** su `body` e impostate **Target Prefix** su `sophos` (facoltativo, ma tiene insieme i campi del firewall).

#### Provarlo e salvarlo

Incollate una riga del firewall in **Test With a Sample Line** per controllare il risultato, poi fate clic su **Crea processore**.
:::

Un evento IPsec di Sophos:

```text
device_name="SFW" timestamp="2024-05-02T11:03:12+0200" device_model="XGS2100" device_serial_id="X1234" log_id="010101600001" log_type="Event" log_component="IPSec" log_subtype="System" severity="Information" con_name="HQ-Branch1" src_ip="10.171.4.117" dst_ip="10.171.4.118" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."
```

diventa questi attributi (tra gli altri):

| Attributo | Valore |
| --- | --- |
| `sophos.log_component` | `IPSec` |
| `sophos.con_name` | `HQ-Branch1` |
| `sophos.status` | `Terminated` |
| `sophos.src_ip` | `10.171.4.117` |
| `sophos.message` | `IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated.` |

Una riga SLA SD-WAN ha altri campi in un altro ordine, e lo stesso processore la gestisce:

```text
log_id=158825619025 log_type="SD-WAN" log_component="SLA" profile_name="Branch-Internet" gw_name="WAN2" latency=11 jitter=2 packet_loss=0 gw_status="up" sla_status="SLA met"
```

dà `sophos.gw_name = WAN2`, `sophos.latency = 11`, `sophos.packet_loss = 0`, `sophos.gw_status = up` e `sophos.sla_status = SLA met`. Le versioni più vecchie di SFOS registrano un formato precedente (`device="SFW" date=2017-01-31 time=18:02:03 timezone="IST" ... connectionname="Tunnel A"`); viene analizzato allo stesso modo, con il nome del tunnel in `connectionname` invece che in `con_name`.

Per trasformare quelle righe SLA in metriche di latenza, jitter e perdita di pacchetti per gateway, vedete l'esempio in [Regole di registrazione dei log](/docs/telemetry/log-recording-rules).

### Esempio: Fortinet FortiGate

I log di FortiGate usano lo stesso stile:

```text
date=2024-01-01 time=10:00:00 devname="FG100" logid="0100032001" type="event" subtype="vpn" level="notice" action="tunnel-down" vpntunnel="HQ-to-Branch2" msg="IPsec tunnel down"
```

Con le impostazioni predefinite e un prefisso `fortigate` si ottiene `fortigate.devname = FG100`, `fortigate.subtype = vpn`, `fortigate.action = tunnel-down`, `fortigate.vpntunnel = HQ-to-Branch2` e `fortigate.time = 10:00:00`: i due punti di un orario fanno parte del valore, non sono un delimitatore.

### Un avviso per ogni tunnel

Con i campi analizzati, un [monitor log](/docs/monitor/logs-monitor) può contare i guasti e aprire un avviso separato per ogni tunnel: filtrate su `sophos.log_component` = `IPSec` con un corpo che contiene `terminated`, e raggruppate per `sophos.con_name`. Vedete [Avvisi per gruppo](/docs/monitor/logs-monitor).

## Grok Parser

Estrae campi strutturati da una riga di forma fissa. Un modello grok è un'espressione regolare con riferimenti con nome: `%{IPV4:client_ip}` significa «trova un indirizzo IPv4 e memorizzalo come `client_ip`». Il modello non deve coprire l'intera riga, e una riga che non corrisponde resta invariata.

| Impostazione | Predefinito | Descrizione |
| --- | --- | --- |
| **Source Field** | `body` | Il campo da analizzare, come per il Key=Value Parser. |
| **Target Prefix** | nessuno | Uno spazio dei nomi per i campi estratti, aggiunto nello stesso modo. |
| **Grok Pattern** | — | Il modello. Il modulo elenca i modelli con nome disponibili. |

Una cattura viene memorizzata come testo, a meno che non le diate un tipo: `%{NUMBER:status:int}` la memorizza come numero. I tipi sono `int`, `long`, `float`, `double`, `boolean` e `string`. Verificate un modello su una riga di esempio in **Test Your Pattern** prima di salvarlo.

| Corpo del log | Modello | Attributi aggiunti |
| --- | --- | --- |
| `10.0.1.5 - GET /health 200` | `%{IPV4:client_ip} - %{WORD:method} %{NOTSPACE:path} %{NUMBER:status:int}` | client_ip, method, path, status |

Usate invece il Key=Value Parser quando la riga è fatta di coppie `key=value` il cui ordine cambia.

## Rimappatore di gravità

Legge un valore grezzo da un attributo e lo associa a una gravità standard. Impostate **Attributo di origine** sull'attributo che contiene il livello (`level` per impostazione predefinita), poi aggiungete delle **Mappature**: ciascuna associa un valore emesso dalla vostra applicazione, come `warn`, a una gravità, come Warning. La corrispondenza ignora maiuscole e minuscole. Un valore senza mappatura lascia invariata la gravità del log.

## Rimappatore di attributi

Sposta il valore di un attributo (**Chiave di origine**) in un altro (**Chiave di destinazione**), per esempio `src_ip` in `source_ip`.

| Impostazione | Predefinito | Effetto |
| --- | --- | --- |
| **Conserva sorgente** | disattivato | Disattivato rinomina l'attributo: la chiave di origine viene rimossa. Attivato lo copia e conserva la chiave di origine. |
| **Sovrascrivi in caso di conflitto** | attivato | Attivato sostituisce la destinazione se esiste già. Disattivato lascia invariata la destinazione e salta la rimappatura. |

## Processore di categoria

Valuta in ordine un elenco di regole e memorizza in un attributo di destinazione il nome della prima regola il cui filtro corrisponde, così potete trovare in una volta sola tutti i log «Payment Error». Impostate **Attributo di destinazione** (`category` per impostazione predefinita), poi aggiungete delle **Regole di categoria**: un **Category name** e le condizioni in **When logs match**. Vince la prima regola che corrisponde; un log che non ne soddisfa nessuna resta invariato.

## Passaggi successivi

:::cards
- [Monitor log](/docs/monitor/logs-monitor): Ricevere avvisi sugli attributi che le vostre pipeline estraggono.
- [Regole di registrazione dei log](/docs/telemetry/log-recording-rules): Trasformare i campi dei log analizzati in metriche.
- [Syslog](/docs/telemetry/syslog): Inviare a OneUptime il syslog di firewall e server.
- [Sintassi di ricerca](/docs/telemetry/search-syntax): Cercare sui nuovi attributi nell'explorer dei log.
:::
