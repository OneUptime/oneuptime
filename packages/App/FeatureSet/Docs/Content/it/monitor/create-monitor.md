# Creare un monitor

Un monitor controlla qualcosa che gestisci, come un sito web, un'API, un host o un cluster Kubernetes, e ti avvisa quando smette di funzionare. **Crea monitor** chiede prima cosa monitorare, poi cosa controllare, poi ogni quanto. Tutto, tranne il tipo, il nome e cosa controllare, parte da valori predefiniti adatti alla maggior parte dei monitor.

## Informazioni sul monitor

Vai su **Monitor** e fai clic su **Crea monitor**. La prima domanda è il **Tipo di monitor**: cosa vuoi monitorare?

- I sei tipi che si creano più spesso vengono per primi: **Website**, **API**, **Ping**, **Porta**, **SSL Certificate** e **Incoming Request**, per gli heartbeat di cron job e webhook.
- **Altri tipi di monitor** elenca tutti gli altri tipi sotto la loro categoria, come **Infrastruttura** (Kubernetes, Docker, Host) e **Telemetria** (Registri, Metriche, Tracce). **Manual**, un monitor di cui imposti tu lo stato, si trova sotto **Other**.
- Oppure scrivi nella casella di ricerca. Conosce le parole che usi già, come `k8s`, `postgres`, `heartbeat` o `tls`, e **Invio** sceglie il primo risultato.

Il tipo scelto si riduce a una riga. Fai clic su **Cambia** per sceglierne un altro; premi **Esc** durante la scelta per tenere il tipo che avevi.

Poi compila il **Nome**. Viene usato negli avvisi e nei titoli degli incidenti. **Descrizione** ed **Etichette** sono facoltativi e aspettano sotto **Altri campi**.

Un monitor **Manual** non ha bisogno d'altro, quindi **Crea monitor** si trova in questo passaggio.

## Criteri

Questo passaggio si apre su cosa controllare. Per un sito web è il suo URL, con un esempio nella casella; gli altri tipi chiedono un host, una query, un cluster o un filtro dei log. **Testa il monitor** esegue il controllo una volta prima di salvare.

Sotto, i **Criteri del monitor** decidono quando il monitor cambia stato, dichiara un incidente o crea un avviso. Un nuovo monitor parte da criteri adatti alla maggior parte dei monitor, ciascuno ripiegato su una riga che dice cosa controlla e cosa fa. Per esempio, un nuovo monitor di un sito web viene segnato offline e dichiara un incidente quando il sito non risponde o risponde con un codice di stato di errore. Fai clic su un criterio per aprirlo e modificarlo. **Aggiungi criteri** ne aggiunge uno, aperto e pronto da compilare.

In questo passaggio nulla viene segnato come mancante finché non fai clic su **Avanti**.

## Sonde e intervallo

I monitor controllati dalle sonde terminano con questo passaggio: Website, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, Domain, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code ed External Status Page. Le **Sonde** sono le macchine che eseguono i controlli, e le sonde predefinite del progetto sono già selezionate. L'**Intervallo di monitoraggio** parte da **Ogni 5 minuti**. Fai clic su **Crea monitor**.

Tutti gli altri tipi si creano dal passaggio **Criteri**.

## Partire da un modello o da un link

Un modello di monitor, e i link che creano un monitor altrove in OneUptime (su un grafico di metriche, un dispositivo di rete o una regola di rilevamento), aprono **Crea monitor** con il tipo già scelto e il resto compilato. Fai clic su **Cambia** per scegliere un altro tipo. Il modulo di un modello usa lo stesso selettore di tipo: vedi [Modelli di monitor](/docs/monitor/monitor-templates).
