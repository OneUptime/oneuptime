# Monitor Porta

Il monitoraggio delle porte consente di monitorare la disponibilità di porte TCP o UDP specifiche su un host. OneUptime tenta periodicamente di connettersi alla porta specificata e verifica che sia aperta e reattiva.

## Panoramica

I monitor porta verificano se una porta di rete specifica accetta connessioni. Questo consente di:

- Monitorare la disponibilità del servizio su porte specifiche
- Tracciare i tempi di risposta della porta
- Verificare che servizi come database, server di posta e server applicativi siano in esecuzione
- Rilevare interruzioni del servizio prima che impattino gli utenti

## Creazione di un Monitor Porta

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Porta** come tipo di monitor
4. Inserire l'hostname o l'indirizzo IP e il numero di porta
5. Configurare i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### Hostname o Indirizzo IP

Inserire l'hostname o l'indirizzo IP dell'host di destinazione (ad es. `example.com` o `192.168.1.1`).

### Porta

Inserire il numero di porta da monitorare (1–65535). Esempi comuni:

| Porta | Servizio |
|------|---------|
| 22 | SSH |
| 25 | SMTP |
| 80 | HTTP |
| 443 | HTTPS |
| 3306 | MySQL |
| 5432 | PostgreSQL |
| 6379 | Redis |
| 27017 | MongoDB |

## Criteri di Monitoraggio

È possibile configurare criteri per determinare quando la porta è considerata online, degradata o offline in base a:

### Tipi di Controllo Disponibili

| Tipo di Controllo | Descrizione |
|------------|-------------|
| È Online | Se la porta è aperta e accetta connessioni |
| Tempo di Risposta (in ms) | Tempo per stabilire una connessione in millisecondi |
| Richiesta Timeout | Se il tentativo di connessione è andato in timeout |

### Tipi di Filtro

Per **È Online** e **Richiesta Timeout**:

- **Vero** — La condizione è vera
- **Falso** — La condizione è falsa

Per **Tempo di Risposta**:

- **Maggiore Di** — Il tempo di risposta supera una soglia
- **Minore Di** — Il tempo di risposta è inferiore a una soglia
- **Maggiore o Uguale a** — Il tempo di risposta è pari o superiore a una soglia
- **Minore o Uguale a** — Il tempo di risposta è pari o inferiore a una soglia
- **Uguale a** — Il tempo di risposta corrisponde esattamente
- **Diverso da** — Il tempo di risposta non corrisponde
- **Valuta Nel Tempo** — Valuta usando aggregazione (Media, Somma, Massimo, Minimo, Tutti i Valori, Qualsiasi Valore) su una finestra temporale

### Criteri di Esempio

#### Considerare offline se la porta è chiusa

- **Controlla Su**: È Online
- **Tipo Filtro**: Falso

#### Avviso se il tempo di connessione supera 500ms

- **Controlla Su**: Tempo di Risposta (in ms)
- **Tipo Filtro**: Maggiore Di
- **Valore**: 500

#### Considerare degradato se la connessione è lenta

- **Controlla Su**: Tempo di Risposta (in ms)
- **Tipo Filtro**: Maggiore Di
- **Valore**: 200
