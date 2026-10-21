# Traffico di rete (NetFlow, IPFIX e sFlow)

Router, firewall e switch possono descrivere il traffico che li attraversa come **record di flusso**: chi ha parlato con chi, con quale protocollo e quali porte, attraverso quali interfacce e con quanti byte. Indirizza questa esportazione verso una sonda OneUptime e le pagine **Traffico** mostrano dove va il tuo traffico: gli indirizzi, le conversazioni, le applicazioni e le interfacce più attivi, su qualsiasi intervallo di tempo.

Una pagina Traffico esiste in tre punti:

- **Rete** -> **Traffico**: tutta la rete, i flussi di ogni dispositivo in una sola pagina e ogni indirizzo che invia flussi senza essere ancora un dispositivo.
- La pagina **Traffico** di un sito: i dispositivi di quel sito.
- La scheda **Traffico** di un dispositivo: quel dispositivo, con le sue interfacce. Le catture di pacchetti eseguite sulla sonda del dispositivo sono elencate sotto i flussi, per quando ti servono i pacchetti stessi.

## Cosa mostra la pagina Traffico

- Quattro numeri per l'intervallo: **Traffico** (byte), la velocità **Media** e di **Picco**, e **Flussi** (quanti record di flusso hanno inviato i dispositivi).
- **Traffico nel tempo**, in bit al secondo. Trascina sul grafico per ingrandire un tratto; fai doppio clic su di esso, o usa **Reimposta zoom**, per tornare indietro.
- **Sorgenti principali** e **Destinazioni principali**: i dieci indirizzi che hanno inviato e ricevuto di più.
- **Applicazioni principali**: il traffico per protocollo e porta di servizio, con il nome del servizio che di solito si trova su quella porta (HTTPS è la porta TCP 443).
- **Interfacce principali** nella pagina di un dispositivo: cosa è entrato e uscito da ogni interfaccia, con nome e velocità dalla scansione SNMP del dispositivo. **Dispositivi principali** nella pagina di un sito e in quella della rete.
- **Conversazioni principali**: le dieci coppie di indirizzi più attive, disegnate come diagramma dai mittenti ai destinatari, oppure come elenco.

Fai clic su una riga - un indirizzo, un'applicazione, un'interfaccia, un dispositivo, una banda del diagramma - e tutta la pagina si restringe a quel traffico. Un chip sopra la pagina dice a cosa è ristretta; fai clic sulla sua x per allargarla di nuovo. **Trova un indirizzo IP** restringe la pagina al traffico verso o da un indirizzo. L'intervallo di tempo e i filtri sono conservati nell'indirizzo della pagina, quindi un link apre esattamente la stessa vista.

## Come arrivano qui i flussi

Ogni sonda esegue un raccoglitore di flussi. Ascolta su tre porte UDP, e ogni porta legge ogni formato:

| Porta    | Di solito usata per         |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

La sonda decodifica i record, rimoltiplica i conteggi campionati per il tasso di campionamento, somma ogni pochi secondi i record di una stessa conversazione e li invia a OneUptime. Ogni record viene associato a un dispositivo in base all'indirizzo da cui il suo dispositivo lo invia - per sFlow, l'indirizzo dell'agente nel datagramma:

1. un dispositivo interrogato dalla sonda il cui hostname è quell'indirizzo (o si risolve in esso), o che lo elenca in **Altri indirizzi** nella sua pagina **Impostazioni**;
2. sulla tua sonda (personalizzata), qualsiasi dispositivo del progetto con quell'indirizzo come hostname o tra i suoi altri indirizzi;
3. altrimenti, sulla tua sonda, i flussi vengono conservati per la pagina Traffico della rete, in **Mittenti di flussi**, finché non indichi a quale dispositivo appartengono. Una sonda globale li scarta.

I flussi sono conservati per 30 giorni, e una pagina mostra al massimo 31 giorni.

## Configurazione

1. **Usa una sonda nella rete del dispositivo.** I flussi sono datagrammi UDP inviati dai tuoi dispositivi, quindi hanno bisogno di una [sonda personalizzata](/docs/probe/custom-probe) che possano raggiungere. Una sonda globale su internet pubblico non li riceverà.
2. **Lascia che i datagrammi raggiungano la sonda.** Consenti UDP 2055, 4739 e 6343 dai dispositivi alla sonda. Una sonda in Docker avviata con la rete dell'host (`--network host`), come mostra la pagina della sonda personalizzata, li riceve così com'è; senza la rete dell'host, pubblica le porte con `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp`.
3. **Attiva l'esportazione dei flussi sul dispositivo** e inviala all'indirizzo IP della sonda. I comandi per i dispositivi più comuni sono qui sotto. La scheda **Traffico** del dispositivo mostra gli stessi passaggi con le porte della sonda finché non arriva il primo flusso.
4. **Controlla l'indirizzo del dispositivo.** I record vengono associati in base all'indirizzo da cui invia il dispositivo. Se invia da una loopback o da un'interfaccia di gestione che non è il suo hostname, aggiungi quell'indirizzo agli **Altri indirizzi** del dispositivo.

Il raccoglitore è attivo per impostazione predefinita. Le sue impostazioni sono variabili d'ambiente della sonda:

| Variabile                           | Cosa fa                                                             | Predefinito |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | Impostala su `false` per disattivare il raccoglitore di flussi      | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | La porta NetFlow; `0` smette di ascoltarla                          | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | La porta IPFIX; `0` smette di ascoltarla                            | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | La porta sFlow; `0` smette di ascoltarla                            | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | Datagrammi accettati al minuto, su tutti i dispositivi e le porte   | 6000    |

### Cisco IOS XE (Flexible NetFlow)

Esporta IPFIX verso UDP 4739. Aggiungi l'ultima riga a ogni interfaccia di cui vuoi vedere il traffico: misurare il traffico mentre entra in ogni interfaccia conta ogni conversazione una sola volta.

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS (NetFlow v9)

Esporta NetFlow v9 verso UDP 2055.

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS (sFlow)

Esporta sFlow verso UDP 6343. sFlow campiona un pacchetto ogni N (qui 16384), e le pagine Traffico rimoltiplicano i campioni, quindi i numeri sono stime.

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX e Z

Le appliance MX e i gateway per il lavoro da remoto della serie Z esportano NetFlow v9 dalla dashboard di Meraki:

1. Apri **Network-wide** > **General** e trova **Reporting**.
2. Imposta **NetFlow traffic reporting** su **Enabled: send NetFlow traffic statistics**.
3. Inserisci l'indirizzo IP della sonda come **NetFlow collector IP** e `2055` come **NetFlow collector port**, poi salva.

Un MX o uno Z vede solo il traffico che lo attraversa. Il traffico che uno switch tiene all'interno di una VLAN non lo raggiunge mai, quindi non è nell'esportazione.

### Juniper (J-Flow inline)

Esporta IPFIX verso UDP 4739 dai router MX; usa l'FPC che porta le interfacce che campioni.

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

Esporta NetFlow v9 verso UDP 2055. Da FortiOS 7.2 in poi il raccoglitore è una voce sotto `config collectors` dentro `config system netflow`.

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. In **Device** > **Server Profiles** > **NetFlow**, aggiungi un profilo con l'indirizzo IP della sonda e la porta `2055`, e imposta l'**Active Timeout** a 1 minuto.
2. In **Network** > **Interfaces**, apri ogni interfaccia di cui vuoi vedere il traffico e scegli il profilo come suo **NetFlow Profile** nella scheda **Advanced**.
3. Esegui il commit.

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense e host Linux

Su pfSense, installa il pacchetto **softflowd** e, in **Services** > **softflowd**, scegli le interfacce, inserisci l'indirizzo IP della sonda e la porta `2055`, e scegli NetFlow versione 9. Su un host Linux, esegui softflowd sull'interfaccia di cui vuoi vedere il traffico:

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### Altri dispositivi

Invia NetFlow v5, NetFlow v9 o IPFIX all'indirizzo IP della sonda su UDP 2055 (o 4739), oppure sFlow v5 su UDP 6343. Imposta il timeout attivo dei flussi del dispositivo a 60 secondi e, per NetFlow v9 e IPFIX, invia i suoi template ogni 60 secondi. Le [guide dei produttori di rete](/docs/monitor/network-vendor-guides) coprono Sophos ed Extreme Networks.

## Indirizzi che non sono ancora dispositivi

I flussi possono arrivare prima che il dispositivo che li invia venga aggiunto a OneUptime. Sulla tua sonda vengono conservati, e la pagina Traffico della rete elenca il loro indirizzo in **Mittenti di flussi**, contrassegnato come **Non ancora un dispositivo**:

- **Aggiungi come dispositivo** apre l'aggiunta del dispositivo con l'indirizzo e la sonda già compilati. I flussi già arrivati restano nella pagina della rete; quelli nuovi vanno al dispositivo.
- **È uno dei miei dispositivi** aggiunge l'indirizzo agli **Altri indirizzi** di un dispositivo: usalo quando un dispositivo già aggiunto invia da un altro indirizzo, come una loopback. I suoi flussi vanno a quel dispositivo dal minuto successivo.

Più dispositivi dietro un unico indirizzo NAT condividono quell'indirizzo, quindi i loro flussi vanno all'unico dispositivo che lo possiede.

## Leggere i numeri

- **Campionamento.** Un dispositivo che campiona - sFlow lo fa sempre, NetFlow o IPFIX possono farlo - riporta un pacchetto ogni N. La sonda moltiplica i conteggi per N, quindi la pagina mostra stime, e lo dice sotto i quattro numeri. Sono precise per molto traffico e approssimative per pochi pacchetti.
- **Contato due volte.** Il traffico che attraversa due dispositivi esportatori viene riportato da entrambi. La pagina di un dispositivo lo conta una volta; la pagina di un sito o della rete lo conta una volta per ogni dispositivo che lo ha riportato.
- **Applicazioni.** Un'applicazione è il protocollo e la porta di servizio, con il nome del servizio che di solito si trova su quella porta. Non è un'ispezione approfondita dei pacchetti: HTTPS sulla porta 9443 appare come porta TCP 9443. La porta effimera del client viene tralasciata, quindi mille connessioni di browser verso un server sono un'unica applicazione.
- **Picco** è la velocità del tratto più attivo del grafico, quindi un intervallo più breve, con tratti più brevi, mostra un picco più netto. **Media** sono i byte sull'intero intervallo.
- **Tempo.** Un flusso conta nel tratto in cui è iniziato. Un download lungo viene riportato come più flussi, uno per ogni minuto in cui dura: per questo il timeout attivo dei dispositivi dovrebbe essere di 60 secondi.

## Cosa non è incluso

- **Avvisi sui flussi.** Non esiste ancora un monitor basato sui flussi. Per ricevere un avviso su un collegamento carico, usa gli avvisi di utilizzo delle interfacce del [monitor dei dispositivi di rete](/docs/monitor/network-device-monitor), che leggono SNMP.
- **Nomi delle applicazioni oltre la porta.** Non c'è ispezione approfondita dei pacchetti, e i nomi delle applicazioni Cisco NBAR non vengono letti.
- **L'API della dashboard Meraki.** Le analisi del traffico di Meraki non vengono importate; le appliance MX e Z inviano invece NetFlow alla sonda.
- **Rilevamento delle anomalie** nel traffico.
- **Nomi delle interfacce dai record di flusso.** Nomi e velocità delle interfacce vengono dalla scansione SNMP del dispositivo; un dispositivo non scansionato mostra i numeri delle interfacce.

## Risoluzione dei problemi

Se la pagina Traffico mostra ancora i passaggi di configurazione:

- **La sonda riceve qualcosa?** La pagina Traffico della rete elenca in **Mittenti di flussi** ogni indirizzo che ha inviato flussi nell'ultima ora. Se il dispositivo compare lì come **Non ancora un dispositivo**, invia da un indirizzo che non è il suo hostname: aggiungi quell'indirizzo ai suoi **Altri indirizzi**.
- **Firewall e Docker.** Consenti UDP 2055, 4739 e 6343 dal dispositivo alla sonda, e pubblica le porte se la sonda gira in Docker.
- **Il log della sonda.** Una volta al minuto la sonda registra ciò che non è riuscita a leggere: datagrammi in un formato non supportato (NetFlow v1, v6, v7 o v8, o sFlow precedente alla versione 5), datagrammi malformati, dati in attesa di un template e datagrammi scartati oltre `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`.
- **Template.** NetFlow v9 e IPFIX inviano la struttura dei loro record come template. La sonda trattiene fino a 10 minuti i dati che arrivano prima del loro template; imposta il dispositivo perché invii i template ogni 60 secondi, così la pagina si riempie entro un minuto.
- **Una sonda globale.** Un dispositivo interrogato da una sonda globale non può inviarle flussi da una rete privata. Esegui una sonda personalizzata nella rete del dispositivo e sceglila nelle impostazioni del dispositivo.
