# Sonde personalizzate

Una sonda personalizzata è un piccolo agente che esegui nella tua rete. Controlla i monitor a cui la aggiungi, come siti web interni, API e server dietro il tuo firewall, e invia i risultati a OneUptime. Apre solo connessioni in uscita, via HTTPS, quindi nulla nella tua rete deve accettare connessioni da Internet.

:::cards
- [Come funziona](#come-funziona): Cosa fa la sonda e come OneUptime sa che è in funzione.
- [Installare una sonda](#installare-una-sonda): Crearla in OneUptime, avviarla con Docker, Docker Compose o Kubernetes e aggiungerla ai monitor.
- [Variabili d'ambiente](#variabili-dambiente): Ogni impostazione che la sonda legge, con il suo valore predefinito.
- [Diagnosticare una sonda disconnessa](#diagnosticare-una-sonda-disconnessa): Trovare dove si fermano le richieste della sonda a OneUptime.
:::

## Come funziona

```mermaid title="Cosa fa una sonda personalizzata"
sequenceDiagram
    participant P as Sonda personalizzata
    participant S as I tuoi servizi
    participant O as OneUptime
    P->>O: Sono in funzione (ogni minuto)
    P->>O: Quali miei monitor sono in scadenza?
    O-->>P: I monitor da controllare
    P->>S: Controllare ciascuno
    P->>O: Inviare i risultati
    O->>O: Aggiornare lo stato, aprire incidenti o avvisi
```

- **La sonda si connette verso l'esterno.** Ogni richiesta va dalla sonda a `ONEUPTIME_URL` via HTTPS. Niente deve raggiungere la sonda dall'esterno della tua rete.
- **Controlla solo i propri monitor.** La sonda chiede a OneUptime i monitor a cui è aggiunta, controlla ciascuno quando è il momento e restituisce il risultato. OneUptime decide in base ai risultati se lo stato di un monitor cambia.
- **OneUptime verifica che sia in funzione.** Ogni richiesta della sonda conta come segno di vita, e la sonda ne invia almeno una al minuto. Dopo circa tre minuti senza nessuna, la sonda mostra **Disconnesso** e i suoi proprietari vengono avvisati. Una sonda senza proprietari avvisa i proprietari del progetto.

## Prima di iniziare

- **Il piano Growth, su OneUptime Cloud.** Serve per creare una sonda. Un'installazione self-hosted non ha limiti di piano.
- **Il permesso di creare sonde.** Ce l'hanno i proprietari, gli amministratori e i membri del progetto, e anche chiunque abbia un ruolo che permette di creare sonde.
- **Una macchina nella rete da monitorare.** Le servono Docker, Docker Compose o Kubernetes, un percorso verso i servizi che la sonda controllerà e HTTPS in uscita verso `ONEUPTIME_URL`.

## Installare una sonda

:::steps
### Creare la sonda

Apri **Monitor → Impostazioni → Sonde** e fai clic su **Crea: Sonda**. Dalle un **Nome** e una **Descrizione**: sono obbligatori entrambi. **Altri campi** contiene il **Logo della sonda**, **Abilita automaticamente il monitoraggio sui nuovi monitor**, che sceglie questa sonda per ogni nuovo monitor che crei, e le **Etichette**.

### Copiare ID e chiave

La sonda ha bisogno del suo ID e della sua chiave per connettersi. Per copiarli, apri il menu della sonda nella tabella **Sonde personalizzate** e scegli **Mostra ID e chiave**. Chiunque veda la tabella può copiare l'ID di una sonda; la chiave viene mostrata solo ai proprietari e agli amministratori del progetto, che vedono **Mostra ID e chiave** dove gli altri vedono **Mostra ID**.

I proprietari e gli amministratori del progetto possono anche fare clic sulla sonda: la scheda **Set up your Custom Probe** della sua pagina mostra il comando Docker con ID e chiave già inseriti.

### Avviare la sonda

Avviala sulla macchina scelta, con l'ID e la chiave della sonda. Se ospiti OneUptime in proprio, imposta `ONEUPTIME_URL` sull'URL della tua installazione invece di `https://oneuptime.com`.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

Poi avviala con `docker compose up -d`.
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

Poi applicala con `kubectl apply -f oneuptime-probe.yaml`.
:::

La rete dell'host (`--network host`, `network_mode: host`) permette alla sonda di usare la rete dell'host stesso, IPv6 compreso. Leggi [Monitorare destinazioni IPv6](#monitorare-destinazioni-ipv6) prima di avviarla senza la rete dell'host.

### Verificare che si connetta

Entro un paio di minuti, lo **Stato** della sonda nella tabella **Sonde personalizzate** indica **Connesso**. Se indica ancora **Disconnesso**, il log della sonda dice perché: vedi [Diagnosticare una sonda disconnessa](#diagnosticare-una-sonda-disconnessa).

### Far controllare un monitor dalla sonda

Una sonda controlla solo i monitor a cui è aggiunta. Un nuovo monitor sceglie le sue sonde nel passaggio **Sonde e intervallo** di **Crea monitor**. Per un monitor esistente, aprilo e vai su **Configurazione → Sonde e intervallo**. La pagina ha tre schede:

- **Intervallo di monitoraggio**: ogni quanto ciascuna sonda del monitor lo controlla. Scegli un intervallo e viene salvato subito. I monitor sintetici, Custom Code e di certificato SSL sono offerti ogni 5 minuti o più; uno che ha già un intervallo più breve, o una pianificazione impostata tramite l'API, la mantiene e la mostra nell'elenco.
- **Sonde**: fai clic su **Aggiungi sonda** e scegli la tua sonda personalizzata. Perché una sonda smetta di controllare questo monitor, disattivala con **Modifica** nel menu della riga, oppure elimina la riga.
- **Accordo tra sonde**: quante sonde del monitor devono vedere lo stesso risultato prima che il suo stato cambi, inserito nella frase «Cambia lo stato di questo monitor quando ... sonde concordano». Lascia la casella vuota per tutte. Partecipano solo le sonde attive e connesse, quindi anche un numero più alto significa tutte. Il numero viene salvato quando lasci la casella o premi **Enter**.

I monitor che le sonde non controllano (Manuale, Richiesta in arrivo, Email in arrivo, Server, Dispositivo di rete e i monitor di telemetria) non hanno la pagina Sonde e intervallo.
:::

> [!TIP]
> Una sonda che deve controllare indirizzi privati, come `http://10.0.0.5/health`, ha bisogno di `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`. Le sonde rifiutano gli indirizzi privati finché non li consenti: vedi [Accesso alla rete privata](/docs/self-hosted/private-network-access).

## Connettersi tramite un proxy

Se la sonda deve passare da un proxy per raggiungere OneUptime o i siti che controlla, dalle l'indirizzo del proxy:

| Variabile | Cosa fa |
| --- | --- |
| `HTTPS_PROXY_URL` | Il proxy per gli indirizzi HTTPS, tra cui OneUptime stesso e la maggior parte dei siti. |
| `HTTP_PROXY_URL` | Il proxy per gli indirizzi HTTP semplici. |
| `NO_PROXY` | Host che la sonda raggiunge direttamente, separati da virgole. |

Scrivi l'indirizzo di un proxy come `http://proxy.example.com:8080`, oppure `http://username:password@proxy.example.com:8080` quando chiede nome utente e password. La maggior parte dei proxy serve entrambi i tipi di indirizzo, quindi imposta entrambe le variabili sullo stesso URL.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```
:::

Cosa passa dal proxy:

- **Le richieste della sonda stessa a OneUptime.**
- **I controlli HTTP dei monitor**: monitor Website, API, External Status Page, Custom Code, di certificato SSL, sintetici e di dominio. I monitor di certificato SSL e sintetici usano `HTTPS_PROXY_URL`, oppure `HTTP_PROXY_URL` quando è impostata solo quella.
- **Non gli altri controlli.** Ping, Port, DNS, SNMP e gli altri controlli che non sono HTTP si connettono direttamente.

Una voce di `NO_PROXY` è un nome host (`api.internal`), un dominio con un punto iniziale o `*.` per tutti i nomi sotto di esso (`.internal.example.com`), l'uno o l'altro con una `:port`, oppure `*` per tutto. Gli intervalli di IP non vengono letti: elenca ogni indirizzo. Funzionano anche i nomi in minuscolo `http_proxy`, `https_proxy` e `no_proxy`, e anche `HTTP_PROXY` e `HTTPS_PROXY`.

## Monitorare destinazioni IPv6

Una sonda può monitorare una destinazione IPv6 solo se la sua rete ha IPv6:

- **Docker con `--network host`, o Compose con `network_mode: host`** (le configurazioni sopra): la sonda condivide la rete dell'host, quindi ha IPv6 esattamente quando ce l'ha l'host.
- **Una rete bridge di Docker** (quella che ottieni senza la rete dell'host): niente IPv6, a meno che IPv6 non sia attivato per quella rete (vedi sotto).
- **Kubernetes**: i pod hanno IPv6 solo su un cluster dual-stack o solo IPv6.

Per verificarlo, fai ping a un indirizzo IPv6 pubblico dall'interno della sonda:

:::tabs
@tab Docker
```bash
docker exec oneuptime-probe ping -6 -c 1 2001:4860:4860::8888
```
@tab Kubernetes
```bash
kubectl exec deploy/oneuptime-probe -- ping -6 -c 1 2001:4860:4860::8888
```
:::

`1 received` significa che la sonda raggiunge le destinazioni IPv6. Se la sonda non ha IPv6 utilizzabile, `ping` fallisce subito e l'errore dice perché:

| Errore | Cosa significa |
| --- | --- |
| `Network is unreachable` | La rete della sonda non ha una route IPv6: una rete bridge di Docker senza IPv6, un cluster Kubernetes solo IPv4 o un host senza connettività IPv6. |
| `Cannot assign requested address` | IPv6 è disattivato nel namespace di rete della sonda. Controlla `net.ipv6.conf.all.disable_ipv6` e `net.ipv6.conf.lo.disable_ipv6`: `cat /proc/sys/net/ipv6/conf/all/disable_ipv6` nella sonda stampa `1` quando è disattivato. Con la rete dell'host sono le impostazioni dell'host. |
| `Address family not supported by protocol` | Il kernel è stato avviato con `ipv6.disable=1`, quindi la macchina non ha affatto IPv6. Rimuovilo dalla riga di comando del kernel e riavvia, oppure esegui la sonda su un'altra macchina. |

In ognuno di questi casi non è stato inviato nulla alla destinazione, quindi la sonda non può sapere se è attiva. Il controllo fallisce comunque, ma il motivo del fallimento di un monitor Ping indica la sonda invece di dire che la destinazione non ha risposto:

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

Il percorso di rete registrato con il fallimento dice `Traceroute could not run: this probe cannot send IPv6 traffic (...)`. Correggi la rete della sonda o sposta il monitor su una sonda che ha IPv6.

### IPv6 senza la rete dell'host

Se non puoi usare la rete dell'host, collega la sonda a una rete Docker con IPv6 attivato. L'host stesso ha comunque bisogno di IPv6.

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 e successivi scelgono una sottorete IPv6 per la rete e mascherano l'IPv6 in uscita della sonda dietro l'indirizzo dell'host. Le versioni precedenti richiedono una sottorete IPv6 esplicita (per esempio `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`) e `"ip6tables": true` con `"experimental": true` in `/etc/docker/daemon.json`. Con Docker Compose, rimuovi `network_mode: host` e imposta `enable_ipv6: true` sulla rete della sonda.

## Ricerche dei nomi NetBIOS nelle scansioni di rilevamento

Una [scansione di rilevamento della rete](/docs/monitor/network-device-monitor) con **Cerca i nomi Windows (NetBIOS)** attivato invia dalla sonda query di nome NetBIOS (NBSTAT) a ogni host che non ha un nome di sistema SNMP. Per le scansioni che lo usano, consenti questo traffico:

- **Quali host vengono interrogati:** gli host rilevati che non hanno né un nome di sistema SNMP né un nome DNS inverso (PTR), e solo a indirizzi privati (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) o di NAT carrier-grade (`100.64.0.0/10`). Gli indirizzi pubblici non vengono mai interrogati, e un host la cui ricerca DNS inversa dalla sonda ha restituito un nome non riceve mai una query. Un host la cui ricerca è fallita, è scaduta o è stata saltata quando il budget di tempo delle ricerche si è esaurito può comunque essere interrogato, anche se ha un record PTR.
- **In uscita:** UDP da una porta di origine effimera (casuale, alta) della sonda verso la porta UDP 137 di quegli host. Le impostazioni del proxy qui sopra non si applicano.
- **In entrata:** le risposte, dalla porta UDP 137 di ciascun host verso quella porta effimera. Un firewall stateful le consente automaticamente. Senza di esse, gli host continuano a essere chiamati con il loro indirizzo IP.

La ricerca non richiede capability aggiuntive del container e funziona dalla rete dei pod di Kubernetes. Interroga al massimo 2.000 host per scansione (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` porta il limite a 4.000), invia un'altra query a ogni host che non risponde, distribuisce le query a circa 100 al secondo e si ferma a un limite di tempo dimensionato su quel lavoro - circa 54 secondi per una ricerca completa di 2.000 host, e mai più di due minuti. Le sonde globali non inviano mai query NetBIOS, qualunque cosa dica la scansione, quindi esegui da una sonda personalizzata le scansioni che hanno bisogno dei nomi NetBIOS. L'opzione è attiva per le nuove scansioni. Le query NBSTAT verso molti host possono far scattare le regole di rilevamento delle intrusioni, quindi disattivala nelle scansioni delle reti dove conta, oppure avvisa prima il tuo team di sicurezza.

## Variabili d'ambiente

La sonda legge le sue impostazioni dal proprio ambiente all'avvio: modificane una, poi riavvia la sonda. Un numero che la sonda non riesce a leggere, o che esce dall'intervallo ammesso da una variabile, viene ignorato e si usa il valore predefinito; i limiti della cattura di pacchetti vengono invece riportati nel loro intervallo.

### Obbligatorie

| Variabile | Cos'è |
| --- | --- |
| `PROBE_KEY` | La chiave della sonda, da **Mostra ID e chiave**. Senza di essa la sonda si ferma all'avvio. |
| `PROBE_ID` | L'ID della sonda, da **Mostra ID e chiave**. Senza di esso la sonda si ferma all'avvio. |
| `ONEUPTIME_URL` | Dove si trova OneUptime: `https://oneuptime.com`, o l'URL della tua installazione. Senza di esso la sonda si ferma all'avvio. |

### Controllo dei monitor

| Variabile | Predefinito | Cosa fa |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | Quanti lotti di monitor la sonda controlla contemporaneamente. |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | Quanti monitor contiene un lotto. |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | Nuovi tentativi dopo il primo tentativo di un controllo fallito, usati quando un passaggio non imposta il proprio numero, quindi fino a 4 tentativi. `0` disattiva i nuovi tentativi. |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | Scadenza per controllare un monitor, dopo la quale il controllo viene abbandonato e ripetuto al ciclo successivo. Il valore predefinito cresce quando si alza il timeout degli script sintetici, così uno script non viene mai interrotto. |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Timeout degli script dei monitor sintetici, in millisecondi. |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | Impostala su `true` per eseguire Chromium, nei monitor sintetici, nella sua sandbox. Attivala solo quando il container della sonda gira con un profilo seccomp che consente la sandbox, come quello di Playwright: senza, Chromium non può avviarsi. Finché è disattivata, la sonda scrive un avviso nel log all'avvio. |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Timeout degli script dei monitor Custom Code, in millisecondi. |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | Impostala su `true` per permettere ai monitor Website, API, External Status Page e Custom Code di questa sonda di raggiungere indirizzi privati. Vedi [Accesso alla rete privata](/docs/self-hosted/private-network-access). |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | Quanti dispositivi di rete la sonda interroga contemporaneamente. Aumentala per una sonda che interroga molti dispositivi. |

I limiti entro cui gira un monitor sintetico (quanti contemporaneamente, la loro memoria e il loro disco) sono nella pagina [Monitor sintetico](/docs/monitor/synthetic-monitor).

### Comunicazione con OneUptime

| Variabile | Predefinito | Cosa fa |
| --- | --- | --- |
| `HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY` | nessuno | Le impostazioni del proxy: vedi [Connettersi tramite un proxy](#connettersi-tramite-un-proxy). |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | Scadenza di ogni richiesta che la sonda invia a OneUptime. |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | Registrare un avviso per le richieste a OneUptime più lente di così. |

### Rilevamento della rete

| Variabile | Predefinito | Cosa fa |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90 minuti) | Scadenza di un passaggio di rilevamento della rete, dopo la quale viene abbandonato e la scansione risulta fallita. |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | Ogni quanto un passaggio di rilevamento in corso carica gli host trovati fin lì, così una scansione lunga mostra i progressi e i suoi dispositivi possono essere importati prima che finisca. Minimo `5000`. |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | Numero fisso di indirizzi che un passaggio di rilevamento sonda contemporaneamente. Lasciala non impostata (o a `0`) per dimensionarlo in base alla destinazione della scansione, che è ciò che vuoi a meno che il container della sonda non sia insolitamente piccolo o insolitamente grande. |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | Limite di tempo, in millisecondi, per cercare i nomi DNS inversi (PTR) degli host trovati da un passaggio. Vedi sotto. |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | Quanti host può interrogare la ricerca NetBIOS di una scansione. Vedi sotto. |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | Numero massimo di scansioni di rilevamento indipendenti in esecuzione contemporaneamente su questa sonda, da 1 a 16. Vedi sotto. |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`: lasciala non impostata (o a `0`) per dimensionare il limite in base al numero di host: 60 secondi fino a circa 860 host, crescendo fino a un massimo di 10 minuti. Puoi impostarla da 1000 a 1200000. Gli host che le ricerche non raggiungono in tempo non ottengono un nome DNS inverso (vengono elencati per indirizzo IP, a meno che SNMP o NetBIOS non li nomini), e il messaggio di stato della scansione dice quanti ne sono stati persi. Una ricerca che scade o fallisce viene ripetuta una volta finché dura il limite, interrogando a turno ciascuno dei server dei nomi della sonda. Alzala per una rete grande dietro un server DNS lento.

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`: per le scansioni con i nomi NetBIOS attivati, la ricerca interroga ogni host senza nome di sistema SNMP, prima quelli senza nome DNS inverso. Lasciala non impostata (o a `0`) per mantenere il tetto integrato di 2.000; puoi impostarla da 1 a 4000. Gli host oltre il tetto non vengono interrogati, e il messaggio di stato della scansione dice quanti. Alzarla allunga anche la ricerca (il suo limite di tempo ne dipende: circa 104 secondi con 4.000 host) e mette in rete più datagrammi NBSTAT, che le regole di rilevamento delle intrusioni tengono d'occhio.

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS`: la sonda cerca un'altra scansione in attesa ogni minuto finché ha capacità, così una scansione lunga non blocca tutte le altre. Quando tutti gli slot sono occupati, le scansioni in più restano in attesa finché uno slot non si libera. Ogni scansione ha la propria concorrenza di host, quindi l'uso delle risorse cresce con entrambe le impostazioni; abbassa uno dei due limiti per i container piccoli. Impostala su 1 per eseguire le scansioni una dopo l'altra.

Aggiorna il server OneUptime prima di aggiornare le sonde personalizzate per usare il rilevamento in parallelo. Il server deve poter escludere le scansioni che la sonda sta ancora eseguendo, così la modifica di una scansione in corso mette in coda in sicurezza la sua nuova configurazione. Quando colleghi una sonda aggiornata a un server più vecchio, imposta `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1` finché il server non viene aggiornato.

### Cattura di pacchetti

| Variabile | Predefinito | Cosa fa |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | disattivata | Impostala su `true` per permettere a chi ha il permesso di avviare catture di pacchetti su questa sonda dalla dashboard. Le catture richiedono anche la rete dell'host e la capability `NET_RAW`. Vedi [Cattura di pacchetti](/docs/probe/packet-capture). |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | La cattura di pacchetti più lunga che questa sonda esegue, da 5 a 1800. |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | Il file di cattura più grande che questa sonda crea, da 1 a 25. |

### Su cosa è in ascolto la sonda

Una sonda apre solo connessioni in uscita, a meno che tu non attivi un listener, o ne mantenga uno attivo per impostazione predefinita:

| Listener | Impostazione | Predefinito | Per saperne di più |
| --- | --- | --- | --- |
| Richieste in arrivo e heartbeat | `PROBE_INGRESS_PORT` | Disattivato | [Ingress richieste in arrivo](/docs/probe/incoming-request-ingress) |
| Trap SNMP | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | Attivo, UDP 162 | [Monitor dispositivi di rete](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | Disattivato, UDP 5140 | [Guide per fornitore di rete](/docs/monitor/network-vendor-guides) |
| NetFlow, IPFIX e sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | Attivo, UDP 2055, 4739 e 6343 | [Traffico di rete](/docs/monitor/network-traffic) |
| Controlli di salute | `PORT` | Attivo, TCP 3874 | `/status/live` e `/status/ready` |

In un container, una porta è raggiungibile da altre macchine solo con la rete dell'host o se la pubblichi.

Il ricevitore syslog inoltra al massimo `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` messaggi al minuto, `600` per impostazione predefinita, scarta il resto e scrive nel log quanti ne ha scartati.

`PROBE_NAME` e `PROBE_DESCRIPTION` vengono letti solo dalle sonde che si registrano da sole con `REGISTER_PROBE_KEY`, come le sonde che un'installazione self-hosted esegue per tutti i progetti. Una sonda personalizzata prende nome e descrizione dalla dashboard.

## Risoluzione dei problemi

### Diagnosticare una sonda disconnessa

Una sonda viene segnalata come `Disconnected` quando le sue richieste a OneUptime smettono di andare a buon fine. Il log della sonda dice dove si è bloccata ogni richiesta fallita, quindi raramente devi tirare a indovinare.

:::steps
#### Leggere il blocco dell'ambiente stampato all'avvio

Ogni sonda stampa all'avvio un blocco JSON con l'URL di OneUptime che usa, la scadenza delle sue richieste, le impostazioni del proxy, i resolver DNS ereditati, la versione di Node e del sistema operativo, e se la verifica TLS è stata disattivata. Allega questo blocco ogni volta che segnali un problema.

#### Trovare il rapporto di errore

Ogni richiesta fallita a OneUptime registra un blocco con `stalledAt` e `whatThisMeans`. `stalledAt` è la fase che la richiesta non ha mai superato:

| `stalledAt` | Cosa significa |
| --- | --- |
| `SocketAssignment` | Niente è uscito dalla macchina. Il pool di socket era saturo, oppure un proxy configurato non ha mai completato il suo tunnel CONNECT. |
| `TcpConnect` | La macchina ha inviato SYN e non ha ricevuto nulla: un firewall o un dispositivo di sicurezza scarta i pacchetti, oppure l'host non è raggiungibile. |
| `TlsHandshake` | TCP si è connesso, TLS non si è mai concluso. Di solito un dispositivo intermedio che ispeziona il TLS. |
| `RequestSend` | Connesso, ma la richiesta non è mai stata scritta per intero: l'altra parte ha smesso di leggere. |
| `WaitingForServerResponse` | La richiesta è stata consegnata e il server non ha restituito nulla. **La rete della sonda va bene**: controlla il server OneUptime, il suo bilanciatore di carico e il suo reverse proxy. |
| `ResponseBody` | Il server ha iniziato a rispondere e si è bloccato a metà. |
| `Unknown` | La sonda non è riuscita a capire dove si è fermata la richiesta. Leggi poi l'autotest di connettività, più sotto. |

Lo stesso blocco riporta anche `deadlineOverrunInMs`. Se una scadenza di 45000ms ha richiesto molto più di 45000ms di tempo reale, era bloccato il processo stesso della sonda: controlla `probeProcess.eventLoopMaxDriftInMs` nel blocco prima di indagare sulla rete.

#### Leggere l'autotest di connettività

Dopo tre errori consecutivi la sonda testa lo stesso server uno strato alla volta (DNS, poi TCP, poi TLS, poi un vero scambio HTTP) e registra ogni fase con i suoi tempi. La prima fase che fallisce è la tua risposta. Quando è configurato un proxy, la sonda testa il tratto fino al proxy, perché è l'unico tratto che fa davvero. Il test viene eseguito al massimo una volta ogni cinque minuti.

#### Tenere d'occhio le richieste lente prima che falliscano

Le richieste che vanno a buon fine ma durano più di `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` vengono registrate con la loro durata. Una sonda che inizia a registrare richieste da 20 secondi si sta avvicinando alla scadenza di 45 secondi.
:::

Sul lato server di OneUptime, anche una richiesta della sonda a cui si risponde lentamente, o che la sonda ha abbandonato prima che fosse inviata una risposta, viene registrata, con l'id della sonda. Quei due log insieme dicono da quale lato della connessione sta il problema.

### Altri problemi

:::details La sonda si ferma subito dopo l'avvio
Il suo log dice cosa manca: `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set` oppure `PROBE_ID or REGISTER_PROBE_KEY should be set`. Se tutte e tre sono impostate ma ID e chiave non corrispondono a nessuna sonda, la sonda tenta 10 volte, a 30 secondi di distanza, poi si ferma con `Unable to register probe after 10 attempts`. Copia di nuovo ID e chiave con **Mostra ID e chiave**.
:::

:::details La sonda funzionava finché qualcuno non ne ha reimpostato la chiave
**Reimposta la chiave della sonda**, nella pagina della sonda, crea una nuova chiave e quella vecchia smette subito di funzionare. Copia la nuova chiave con **Mostra ID e chiave**, impostala come `PROBE_KEY` e riavvia la sonda.
:::

:::details Un monitor dice di non poter raggiungere un indirizzo privato
Le sonde rifiutano gli indirizzi privati finché non li consenti. Imposta `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` sulla sonda e riavviala: vedi [Accesso alla rete privata](/docs/self-hosted/private-network-access).
:::

Se hai ancora problemi, apri una issue su [GitHub](https://github.com/oneuptime/oneuptime) o [contatta il supporto](https://oneuptime.com/support).

## Prossimi passi

:::cards
- [Creare un monitor](/docs/monitor/create-monitor): Scegliere cosa controllare e quali sonde lo controllano.
- [Ingress richieste in arrivo](/docs/probe/incoming-request-ingress): Far inviare heartbeat tramite la sonda ai servizi senza accesso a Internet.
- [Cattura di pacchetti](/docs/probe/packet-capture): Catturare dalla dashboard il traffico che vede la sonda.
- [Accesso alla rete privata](/docs/self-hosted/private-network-access): Far controllare indirizzi privati a una sonda.
:::
