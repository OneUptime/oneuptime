# Monitor IP

Il monitoraggio IP consente di monitorare la disponibilità e la reattività di qualsiasi indirizzo IPv4 o IPv6. OneUptime verifica periodicamente la connettività all'indirizzo IP di destinazione e ne segnala lo stato.

## Panoramica

I monitor IP verificano che un indirizzo IP specifico sia raggiungibile e reattivo. Questo consente di:

- Monitorare la disponibilità di indirizzi IPv4 e IPv6
- Tracciare i tempi di risposta e la latenza
- Rilevare problemi di connettività di rete
- Verificare che gli endpoint dell'infrastruttura siano raggiungibili

## Creazione di un Monitor IP

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **IP** come tipo di monitor
4. Inserire l'indirizzo IP da monitorare
5. Configurare i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### Indirizzo IP

Inserire l'indirizzo IPv4 o IPv6 da monitorare (ad es. `192.168.1.1` o `2001:db8::1`). Il valore deve essere in un formato di indirizzo IP valido.

## Criteri di Monitoraggio

È possibile configurare criteri per determinare quando l'indirizzo IP è considerato online, degradato o offline in base a:

### Tipi di Controllo Disponibili

| Tipo di Controllo         | Descrizione                         |
| ------------------------- | ----------------------------------- |
| È Online                  | Se l'indirizzo IP è raggiungibile   |
| Tempo di Risposta (in ms) | Tempo di risposta in millisecondi   |
| Richiesta Timeout         | Se la richiesta è andata in timeout |

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

#### Considerare offline se l'IP non è raggiungibile

- **Controlla Su**: È Online
- **Tipo Filtro**: Falso

#### Avviso se la latenza supera 100ms

- **Controlla Su**: Tempo di Risposta (in ms)
- **Tipo Filtro**: Maggiore Di
- **Valore**: 100
