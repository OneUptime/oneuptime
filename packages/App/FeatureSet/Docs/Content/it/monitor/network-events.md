# Eventi di rete (syslog e trap SNMP)

I router, i firewall, gli switch e gli access point dicono nel proprio syslog cosa accade loro: un collegamento è caduto, un tunnel si è interrotto, un firewall è andato in failover, qualcuno ha effettuato l'accesso. Ogni fornitore lo dice a modo suo. Punta il loro syslog verso una sonda OneUptime e le pagine **Eventi** mostrano cosa è successo con le stesse parole, chiunque abbia prodotto il dispositivo, e ti avvisano quando succede di nuovo.

C'è una pagina Eventi in due posti:

- **Rete** -> **Eventi**: tutta la rete, gli eventi di ogni dispositivo in un'unica pagina, e ogni indirizzo che invia syslog senza essere ancora un dispositivo.
- La scheda **Eventi** di un dispositivo: ciò che quel dispositivo ha segnalato.

## Cosa mostra la pagina Eventi

- Gli eventi dell'intervallo di tempo, dal più recente. Ogni riga dice cosa è successo, su quale dispositivo, a cosa - l'interfaccia, il tunnel, il gateway - e con le parole del dispositivo stesso.
- **Problemi**, **Ripristini** e **Informativi**, ciascuno con quanti ce ne sono nell'intervallo di tempo. Fai clic su uno per vedere solo quelli.
- Il selettore **Tutti gli eventi** e, nella pagina della rete, il selettore **All devices** restringono ulteriormente l'elenco. L'intervallo di tempo e i filtri sono conservati nell'indirizzo della pagina, quindi un link apre esattamente la stessa vista.
- Fai clic su un evento per aprirlo: quando è successo, cosa riguarda, il messaggio così come lo ha inviato il dispositivo, e ogni attributo che OneUptime ne ha ricavato.
- **Crea avviso** propone gli avvisi che la maggior parte delle reti vuole, e **Crea avviso per questo evento** ne crea uno per l'evento che hai aperto. Vedi [Avvisi](#avvisi).

Un evento è un log. Tutto ciò che c'è nella pagina Eventi si può anche cercare, mettere in un grafico e usare per gli avvisi da **Registri**: un evento è un log il cui attributo `event.domain` è `network`, con ciò che è successo in `event.name`.

## Cosa legge OneUptime

Il syslog in formato RFC 3164 e RFC 5424 e il Common Event Format (CEF) vengono letti da qualsiasi prodotto. In più, OneUptime sa cosa scrivono questi prodotti:

| Fornitore | Prodotti | Eventi letti | Attributi |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | Interfacce, Dispositivi, Alta disponibilità, VPN, Routing, Hardware, Switching, Accessi | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | Interfacce, Dispositivi, Alta disponibilità, VPN, WAN, Accessi | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | Interfacce, Dispositivi, Alta disponibilità, VPN, WAN, Hardware, Accessi | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | Interfacce, Dispositivi, Alta disponibilità, Routing, Hardware, Switching, Accessi | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | Interfacce, Routing | `extreme.*` |
| HPE Aruba Networking | AOS-CX | Interfacce, Hardware | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | Interfacce | `aruba.*` |
| MikroTik | RouterOS | Interfacce, Dispositivi, Accessi | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | Dispositivi, VPN, Wi-Fi | `cambium.*` |
| Ubiquiti | UniFi Network | Dispositivi, WAN, Switching, Accessi, Wi-Fi | `cef.*` |
| Qualsiasi | Dispositivi basati su Linux (kernel, hostapd, OpenSSH, Dropbear) | Interfacce, Accessi, Wi-Fi | - |

Un messaggio in uno di questi formati ha i propri campi salvati come attributi sotto il prefisso dell'ultima colonna, quindi `con_name="HQ-Branch1"` su un firewall Sophos è l'attributo `sophos.con_name`. Un messaggio CEF di qualsiasi altro prodotto ha l'intestazione e i campi di estensione salvati sotto `cef.*`. Un messaggio che OneUptime non sa collocare viene comunque salvato come log, con l'intestazione syslog letta; puoi dare tu un nome ai suoi eventi, vedi [I tuoi eventi](#i-tuoi-eventi).

I trap SNMP standard vengono letti come gli stessi eventi: `linkDown` e `linkUp` diventano **Interfaccia non attiva** e **Interfaccia attiva**, `coldStart` e `warmStart` diventano **Dispositivo riavviato**.

## Gli eventi

Ogni messaggio che OneUptime riconosce viene salvato con uno di questi nomi in `event.name`, chiunque abbia prodotto il dispositivo:

| Evento | `event.name` | Tipo | Riguarda |
| --- | --- | --- | --- |
| Interfaccia non attiva | `interface.down` | Problema | `network.interface.name` |
| Interfaccia attiva | `interface.up` | Ripristino | `network.interface.name` |
| Porta disattivata dallo switch | `interface.error_disabled` | Problema | `network.interface.name` |
| Dispositivo riavviato | `device.reboot` | Problema | - |
| Configurazione modificata | `device.config_change` | Informativi | `user.name` |
| Dispositivo offline | `device.offline` | Problema | - |
| Dispositivo online | `device.online` | Ripristino | - |
| Failover | `ha.failover` | Problema | `ha.role` |
| Stato di alta disponibilità cambiato | `ha.state_change` | Informativi | `ha.role` |
| Peer di alta disponibilità non raggiungibile | `ha.peer_down` | Problema | `ha.peer` |
| Peer di alta disponibilità attivo | `ha.peer_up` | Ripristino | `ha.peer` |
| Tunnel VPN non attivo | `vpn.tunnel_down` | Problema | `vpn.tunnel.name` |
| Tunnel VPN attivo | `vpn.tunnel_up` | Ripristino | `vpn.tunnel.name` |
| Vicino di routing non raggiungibile | `routing.neighbor_down` | Problema | `network.peer.address` |
| Vicino di routing attivo | `routing.neighbor_up` | Ripristino | `network.peer.address` |
| Gateway non raggiungibile | `gateway.down` | Problema | `network.gateway.name` |
| Gateway attivo | `gateway.up` | Ripristino | `network.gateway.name` |
| Failover WAN | `wan.failover` | Problema | `network.gateway.name` |
| Collegamento SD-WAN sotto il suo SLA | `sdwan.sla_not_met` | Problema | `network.gateway.name` |
| Collegamento SD-WAN di nuovo entro il suo SLA | `sdwan.sla_met` | Ripristino | `network.gateway.name` |
| Ventola guasta | `hardware.fan_failed` | Problema | `hw.name` |
| Ventola di nuovo funzionante | `hardware.fan_ok` | Ripristino | `hw.name` |
| Alimentatore guasto | `hardware.power_supply_failed` | Problema | `hw.name` |
| Alimentatore di nuovo funzionante | `hardware.power_supply_ok` | Ripristino | `hw.name` |
| Temperatura troppo alta | `hardware.temperature_high` | Problema | - |
| Loop rilevato | `loop.detected` | Problema | `network.interface.name` |
| Cambiamento della topologia spanning tree | `stp.topology_change` | Informativi | - |
| Guasto PoE | `poe.fault` | Problema | `network.interface.name` |
| Accesso non riuscito | `auth.login_failed` | Problema | `user.name` |
| Accesso eseguito | `auth.login_success` | Informativi | `user.name` |
| Client Wi-Fi connesso | `wireless.client_connected` | Informativi | `client.mac` |
| Client Wi-Fi disconnesso | `wireless.client_disconnected` | Informativi | `client.mac` |

L'ultima colonna è l'attributo che dice cosa riguarda l'evento. Non tutti i prodotti segnalano tutti gli eventi: uno switch non ha tunnel VPN, e il syslog di un prodotto dice solo quello che dice.

Ogni evento porta inoltre:

| Attributo | Cosa contiene |
| --- | --- |
| `event.domain` | `network`, su ogni evento di rete |
| `event.kind` | `problem`, `recovery` o `info` |
| `event.category` | `interface`, `device`, `ha`, `vpn`, `routing`, `wan`, `hardware`, `switching`, `security` o `wireless`, sugli eventi qui sopra |
| `event.device` | Quale dispositivo: il suo nome in OneUptime, altrimenti il nome che si dà da solo, altrimenti il suo indirizzo |
| `event.message` | Cosa ha detto il dispositivo, con le sue parole |
| `syslog.vendor`, `syslog.parser` | Nel formato di chi è stato letto il messaggio |

## Come arrivano qui gli eventi

Ogni sonda ascolta il syslog sulla porta 5140, su UDP e su TCP. Su TCP un messaggio è una riga, oppure è preceduto dalla sua lunghezza, come descrive la RFC 6587. La sonda inoltra a OneUptime ciò che sente ogni pochi secondi, e OneUptime associa ogni messaggio a un dispositivo in base all'indirizzo da cui è arrivato:

1. un dispositivo interrogato dalla sonda il cui hostname è quell'indirizzo (o si risolve in esso), o che lo elenca in **Altri indirizzi** nella sua pagina **Impostazioni**;
2. sulla tua sonda (personalizzata), qualsiasi dispositivo del progetto con quell'indirizzo, o con l'hostname riportato nel messaggio quando esattamente un dispositivo ha quel nome;
3. altrimenti, sulla tua sonda, il messaggio viene conservato per la pagina Eventi della rete, in **Invia syslog, non ancora un dispositivo**, finché non indichi a quale dispositivo appartiene. Una sonda globale lo scarta.

Una riga da un indirizzo sconosciuto, senza priorità syslog e che non è un evento, viene considerata rumore e scartata.

Un controller parla per i dispositivi che gestisce: una console UniFi riferisce sui suoi access point e switch. Quando un messaggio di un dispositivo nomina un altro dispositivo con il suo indirizzo MAC, il suo numero di serie, il suo indirizzo o il nome che gli dà il suo controller, l'evento va a quel dispositivo, e il log conserva in `syslog.relay.name` il nome del controller che lo ha inoltrato.

Un log viene salvato all'ora in cui la sonda lo ha ricevuto. Un messaggio che è stato trattenuto - il suo timestamp è in formato RFC 5424, che indica il fuso orario, ed è più vecchio di 5 minuti - mantiene l'ora del dispositivo, fino a 7 giorni indietro. Qualsiasi altro timestamp che si discosta di più di 5 minuti dall'orologio della sonda non viene creduto: il log viene salvato all'ora in cui è stato ricevuto, e l'ora del dispositivo viene conservata in `syslog.deviceTime`.

Il syslog che invii all'[endpoint syslog](/docs/telemetry/syslog) tramite HTTPS viene letto dagli stessi parser. Lì un messaggio diventa un evento di rete quando è nel formato proprio di un fornitore di rete, o quando nomina uno dei tuoi dispositivi di rete con indirizzo MAC, numero di serie, indirizzo o hostname; le righe `sshd` di un server restano semplici log.

## Configurazione

1. **Usa una sonda nella rete del dispositivo.** Il syslog viene inviato dai tuoi dispositivi, quindi hanno bisogno di una [sonda personalizzata](/docs/probe/custom-probe) che possano raggiungere. Una sonda globale su internet pubblico non lo riceverà.
2. **Lascia che il syslog raggiunga la sonda.** Consenti la porta 5140, UDP o TCP, dai dispositivi alla sonda. Una sonda in Docker avviata con la rete dell'host (`--network host`), come mostra la pagina della sonda personalizzata, lo riceve così com'è; senza la rete dell'host, pubblica la porta con `-p 5140:5140/udp -p 5140:5140/tcp`. Per un dispositivo che può inviare solo alla porta 514, pubblicala come `-p 514:5140/udp`, oppure imposta `PROBE_SYSLOG_RECEIVER_PORT=514` su una sonda con la rete dell'host.
3. **Imposta la sonda come server syslog del dispositivo.** I comandi per i dispositivi più comuni sono qui sotto. La pagina **Eventi** mostra gli stessi passaggi finché non arriva il primo messaggio, poi diventa da sola l'elenco.
4. **Controlla l'indirizzo del dispositivo.** I messaggi vengono associati in base all'indirizzo da cui invia il dispositivo. Se invia da una loopback o da un'interfaccia di gestione che non è il suo hostname, aggiungi quell'indirizzo agli **Altri indirizzi** del dispositivo.

Il ricevitore syslog è attivo per impostazione predefinita. Le sue impostazioni sono variabili d'ambiente della sonda:

| Variabile | Cosa fa | Predefinito |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | Impostala su `false` per disattivare il ricevitore syslog | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | La porta, per UDP e TCP | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | Messaggi inoltrati al minuto, su tutti i dispositivi | `600` |

Oltre il limite, la sonda continua a inoltrare i messaggi che legge come eventi di rete, fino ad altrettanti, così una valanga di righe di routine non può soffocare quella che dice che un collegamento è caduto. Una sonda più vecchia di questa funzione ascolta solo se viene avviata con `PROBE_SYSLOG_RECEIVER_ENABLED=true`, e solo su UDP: aggiornala.

### Cisco IOS, IOS XE e NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

La seconda riga invia i messaggi informativi e tutto ciò che è più grave: tra questi ci sono i cambi di stato dei collegamenti, i riavvii e gli accessi. Su NX-OS la riga è `logging server <probe-address> 6 port 5140 use-vrf management`.

### Sophos Firewall

1. Nell'amministrazione web del firewall, apri **System services** > **Log settings** e, in **Syslog servers**, scegli **Add**.
2. Inserisci l'indirizzo IP della sonda e la porta `5140`, e imposta il livello di gravità su **Information**. Vengono letti entrambi i formati di log offerti dal firewall.
3. Di nuovo in **Log settings**, spunta il nuovo server per i log da inviare: almeno gli eventi di sistema, e **SD-WAN** per i cambi di SLA. I log di traffico del firewall sono tanti, quindi lasciali fuori a meno che non ti servano.

### Fortinet FortiGate

```text
config log syslogd setting
    set status enable
    set server "<probe-address>"
    set port 5140
    set mode udp
    set format default
end
```

FortiGate invia ciò che selezionano le sue impostazioni di log. I log degli eventi contengono i tunnel, i collegamenti e i failover; i log di traffico sono tanti, quindi lasciali fuori a meno che non ti servano.

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

Cambia `VR-Default` con il router virtuale attraverso cui si raggiunge la sonda.

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

Su AOS-CX, aggiungi `vrf mgmt` alla riga quando la sonda si raggiunge dalla porta di gestione. Su AOS-Switch la riga è `logging <probe-address> udp 5140`.

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

La prima riga punta l'azione remota integrata del router verso la sonda; le altre scelgono cosa invia. Lascia il formato di log remoto così com'è.

### Ubiquiti UniFi

1. In UniFi Network, apri **Integration** > **System Logging / SIEM** e seleziona **SIEM Server** come destinazione.
2. Inserisci l'indirizzo IP della sonda e la porta `5140`, e scegli le categorie di log da esportare.

La console riferisce sugli access point e sugli switch che gestisce. Gli eventi arrivano sulla pagina di ciascun dispositivo quando il dispositivo è in OneUptime con il suo indirizzo MAC, altrimenti su quella della console.

### Cambium Networks

1. In cnMaestro o nell'interfaccia web dell'access point, apri le impostazioni di sistema e trova i server syslog.
2. Inserisci l'indirizzo IP della sonda come server syslog, con la porta `5140` dove il modulo chiede una porta, e imposta la gravità syslog su **Info**.

Dove non c'è una porta da impostare, l'access point invia alla porta 514: pubblica lì la porta della sonda, come mostra il passaggio 2 di [Configurazione](#configurazione).

### Altri dispositivi

Aggiungi un server syslog remoto sul dispositivo: l'indirizzo IP della sonda, porta 5140, su UDP o TCP, inviando i messaggi informativi e tutto ciò che è più grave. Un dispositivo il cui formato OneUptime non conosce ha comunque i suoi messaggi salvati, e puoi dare tu un nome ai suoi eventi.

## Avvisi

**Crea avviso**, in una pagina Eventi, elenca gli avvisi che la maggior parte delle reti vuole. Ciascuno apre **Crea monitor** già compilato, dove puoi cambiare qualsiasi cosa prima di salvarlo:

| Avviso | Ti avvisa quando | Un avviso per | Si chiude quando |
| --- | --- | --- | --- |
| Un tunnel VPN cade | `vpn.tunnel_down` | dispositivo e tunnel | `vpn.tunnel_up` per quel tunnel |
| Un firewall o uno switch va in failover | `ha.failover` | dispositivo | passano 5 minuti senza un altro |
| Un collegamento WAN cade | `gateway.down` | dispositivo e gateway | `gateway.up` per quel gateway |
| Un vicino di routing cade | `routing.neighbor_down` | dispositivo e vicino | `routing.neighbor_up` per quel vicino |
| Un dispositivo si riavvia | `device.reboot` | dispositivo | passano 5 minuti senza un altro |
| L'hardware si guasta | una ventola, un alimentatore o la temperatura | dispositivo e componente | lo stesso componente viene segnalato di nuovo funzionante |
| Un'interfaccia cade | `interface.down` | dispositivo e interfaccia | `interface.up` per quell'interfaccia |
| Qualcuno continua a non riuscire ad accedere | più di 10 `auth.login_failed` in 5 minuti | dispositivo | passano 5 minuti con 10 o meno |

Ciascuno è un [monitor log](/docs/monitor/logs-monitor) che conta l'evento negli ultimi 5 minuti, con **Group by Attributes** impostato in modo che ogni tunnel, gateway o interfaccia abbia un avviso proprio, e con **Risolto per attributi** impostato sull'evento che dice che il problema è finito. Un avviso così resta aperto finché quell'evento non arriva per lo stesso dispositivo e lo stesso tunnel, per quanto tempo ci voglia; vedi [Risolto da un log](/docs/monitor/logs-monitor#risolto-da-un-log). OneUptime non legge alcun evento che dica che una temperatura è tornata normale, quindi un avviso di temperatura resta aperto finché non lo risolvi.

Dalla scheda **Eventi** di un dispositivo i monitor osservano solo quel dispositivo. Per qualsiasi altro evento, aprine uno nella pagina Eventi e fai clic su **Crea avviso per questo evento**. Per inviare un avviso da qualche parte, o per chiamare qualcuno in reperibilità, aggiungi al monitor una policy di reperibilità o un workflow, come per qualsiasi altro.

## Indirizzi che non sono ancora dispositivi

Il syslog può arrivare prima che il dispositivo che lo invia venga aggiunto a OneUptime. Sulla tua sonda viene conservato, i suoi eventi sono nella pagina Eventi della rete con il nome che il dispositivo si dà da solo, e il suo indirizzo è elencato in **Invia syslog, non ancora un dispositivo**:

- **Aggiungi come dispositivo** apre **Aggiungi dispositivo** con l'indirizzo e la sonda già compilati. I messaggi già arrivati restano nella pagina della rete; quelli nuovi vanno al dispositivo.
- **È uno dei miei dispositivi** aggiunge l'indirizzo agli **Altri indirizzi** di un dispositivo: usalo quando un dispositivo che hai già aggiunto invia da un altro indirizzo, come una loopback. I suoi messaggi vanno a quel dispositivo dal minuto successivo.

Più dispositivi dietro un unico indirizzo NAT condividono quell'indirizzo, quindi i loro messaggi vanno all'unico dispositivo che lo ha, a meno che un messaggio non nomini il proprio dispositivo.

## I tuoi eventi

Un dispositivo il cui formato OneUptime non conosce, o un evento che non legge, richiede una [pipeline dei log](/docs/telemetry/log-pipelines):

1. Crea una pipeline il cui filtro corrisponda ai log del dispositivo, come `attributes.networkDevice.name = 'rack-ups'`.
2. Aggiungi un **Grok Parser** o un **Key=Value Parser** per estrarre dal messaggio i campi che ti servono.
3. Aggiungi un **Processore di categoria** con **Attributo di destinazione** `event.name`, e una regola per evento. Dai a ciascuna un nome come gli eventi qui sopra, in minuscolo con punti o trattini bassi: `ups.on_battery`.

Un log di un dispositivo di rete che porta un nome così diventa un evento di rete: è nelle pagine Eventi, e **Crea avviso per questo evento** funziona su di esso. Per dire cosa riguarda, aggiungi un **Rimappatore di attributi** che copi il tuo campo in uno degli attributi della tabella degli eventi, come `hw.name`. A meno che la tua pipeline non imposti `event.kind` su `problem` o `recovery`, l'evento è elencato sotto **Informativi**. Una regola con il nome di un evento integrato, come `interface.down`, produce l'evento integrato, con il suo tipo e i suoi avvisi.

Una pipeline appartiene al suo progetto. Per usarne una in un altro progetto, creala lì con gli stessi processori.

## Cosa non è incluso

- **Syslog su TLS** (RFC 5425). La sonda accetta UDP e TCP in chiaro; mantieni il percorso tra i dispositivi e la sonda su una rete di cui ti fidi.
- **Condivisione dei parser tra progetti.** Una pipeline non si può ancora esportare e importare.
- **Eventi da trap SNMP diversi dai quattro standard.** I trap propri di un fornitore vengono salvati come log, e gli avvisi su di essi si creano con il criterio **SNMP Trap Received (Trap OID)** del [monitor dispositivi di rete](/docs/monitor/network-device-monitor).
- **Switch Cambium cnMatrix, mobility controller Aruba e FortiGate in modalità CEF.** I loro messaggi vengono salvati e si possono cercare; non se ne ricavano ancora eventi.
- **Una visualizzazione in tempo reale.** La pagina Eventi mostra ciò che era arrivato quando è stata aperta; usa il suo pulsante di aggiornamento, o la visualizzazione in tempo reale di **Registri**.

## Risoluzione dei problemi

Se una pagina Eventi mostra ancora i passaggi di configurazione:

- **La sonda riceve qualcosa?** La pagina Eventi della rete elenca in **Invia syslog, non ancora un dispositivo** ogni indirizzo che ha inviato syslog nell'intervallo di tempo. Se il dispositivo è lì, invia da un indirizzo che non è il suo hostname: aggiungi quell'indirizzo ai suoi **Altri indirizzi**.
- **Firewall e Docker.** Consenti la porta 5140 dal dispositivo alla sonda, e pubblica la porta se la sonda gira in Docker. Molti dispositivi inviano alla porta 514 se non viene detto loro altro.
- **Il log della sonda.** All'avvio la sonda scrive nel log la porta su cui ascolta, o che non è riuscita ad aprirla. Quando scarta messaggi oltre `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`, scrive quanti, una volta al minuto.
- **Una sonda globale.** Un dispositivo interrogato da una sonda globale non può inviarle syslog da una rete privata. Esegui una sonda personalizzata nella rete del dispositivo e sceglila nelle impostazioni del dispositivo.
- **I messaggi arrivano, ma nessun evento.** La pagina lo dice, e ogni messaggio è nella scheda **Registri** del dispositivo. Controlla che il dispositivo invii i messaggi informativi, non solo gli errori, e che il prodotto sia uno di quelli in [Cosa legge OneUptime](#cosa-legge-oneuptime); altrimenti dai un nome ai suoi eventi in una pipeline dei log.
