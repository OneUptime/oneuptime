# Monitor Ping

Il monitoraggio ping consente di monitorare la disponibilità e la reattività di qualsiasi host o indirizzo IP. OneUptime invia periodicamente richieste ping al target e verifica che risponda correttamente.

## Panoramica

I monitor ping testano la connettività di rete di base inviando richieste ping ICMP a un host. Questo consente di:

- Monitorare l'uptime e la disponibilità degli host
- Tracciare la latenza e i tempi di risposta di rete
- Rilevare problemi di connettività prima che impattino i servizi
- Verificare che server e dispositivi di rete siano raggiungibili

## Creazione di un Monitor Ping

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea monitor**
3. Selezionare **Ping** come tipo di monitor
4. Inserire l'hostname o l'indirizzo IP da monitorare
5. Configurare i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### Hostname o Indirizzo IP Ping

Inserire l'hostname o l'indirizzo IP del target da monitorare (ad es. `example.com` o `192.168.1.1`). Sono accettati sia hostname che indirizzi IP.

## Criteri di Monitoraggio

È possibile configurare criteri per determinare quando l'host è considerato online, degradato o offline in base a:

### Tipi di Controllo Disponibili

| Tipo di Controllo           | Descrizione                                                             |
| --------------------------- | ----------------------------------------------------------------------- |
| È Online                    | Se l'host risponde alle richieste ping                                  |
| Tempo di Risposta (in ms)   | Tempo di andata e ritorno della richiesta ping in millisecondi          |
| Perdita di Pacchetti (in %) | Percentuale di richieste ICMP echo rimaste senza risposta               |
| Jitter (in ms)              | Deviazione standard dei tempi di andata e ritorno sui pacchetti inviati |
| Richiesta Timeout           | Se la richiesta ping è andata in timeout                                |

### Tipi di Filtro

Per **È Online** e **Richiesta Timeout**:

- **Vero** — La condizione è vera
- **Falso** — La condizione è falsa

Per **Tempo di Risposta**, **Perdita di Pacchetti** e **Jitter**:

- **Maggiore Di** — Il tempo di risposta supera una soglia
- **Minore Di** — Il tempo di risposta è inferiore a una soglia
- **Maggiore o Uguale a** — Il tempo di risposta è pari o superiore a una soglia
- **Minore o Uguale a** — Il tempo di risposta è pari o inferiore a una soglia

**Valuta questo criterio su un periodo di tempo** è una casella di controllo del modulo dei criteri, non una condizione di filtro. Attivala per confrontare un'aggregazione — scelta in **Valuta** (Media, Somma, Massimo, Minimo, Tutti i Valori, Qualsiasi Valore) sulla finestra impostata in **Per gli ultimi (in minuti)** — invece del valore dell'ultimo controllo.

### Criteri di Esempio

#### Considerare offline se l'host non è raggiungibile

- **Controlla Su**: È Online
- **Tipo di filtro**: Falso

#### Avviso se il tempo di risposta supera 200ms

- **Controlla Su**: Tempo di Risposta (in ms)
- **Tipo di filtro**: Maggiore Di
- **Valore**: 200
