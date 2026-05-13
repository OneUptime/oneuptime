# Monitor Richiesta In Entrata

Il monitoraggio delle richieste in entrata (noto anche come monitoraggio heartbeat) consente di monitorare i servizi facendo sì che inviino periodicamente richieste HTTP a OneUptime. Invece che OneUptime raggiunga il servizio, è il servizio stesso a contattare OneUptime per confermare che è in esecuzione.

## Panoramica

I monitor per richieste in entrata forniscono un URL webhook univoco che i propri servizi chiamano secondo una pianificazione. Questo consente di:

- Monitorare cron job e attività pianificate
- Verificare che i worker in background siano in esecuzione
- Monitorare servizi protetti da firewall non raggiungibili dall'esterno
- Integrarsi con strumenti di monitoraggio di terze parti
- Tracciare segnali heartbeat da qualsiasi sistema in grado di fare richieste HTTP

## Creazione di un Monitor Richiesta In Entrata

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Richiesta In Entrata** come tipo di monitor
4. Verrà generata una **Chiave Segreta** e un URL heartbeat per questo monitor
5. Configurare il proprio servizio per inviare richieste all'URL heartbeat
6. Configurare i criteri di monitoraggio secondo necessità

## URL Heartbeat

Una volta creato, il monitor avrà un URL heartbeat univoco nel formato:

```
https://oneuptime.com/heartbeat/VOSTRA_CHIAVE_SEGRETA
```

Il servizio deve inviare richieste HTTP **GET** o **POST** a questo URL a intervalli regolari.

### Invio di un Heartbeat

#### Utilizzando curl

```bash
# Semplice richiesta GET
curl https://oneuptime.com/heartbeat/VOSTRA_CHIAVE_SEGRETA

# Richiesta POST con corpo personalizzato
curl -X POST https://oneuptime.com/heartbeat/VOSTRA_CHIAVE_SEGRETA \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Da un cron job

```bash
# Aggiungere al crontab per inviare heartbeat ogni 5 minuti
*/5 * * * * curl -s https://oneuptime.com/heartbeat/VOSTRA_CHIAVE_SEGRETA > /dev/null
```

#### Dal codice applicativo

```javascript
// Esempio Node.js
const https = require('https');
https.get('https://oneuptime.com/heartbeat/VOSTRA_CHIAVE_SEGRETA');
```

```python
# Esempio Python
import requests
requests.get('https://oneuptime.com/heartbeat/VOSTRA_CHIAVE_SEGRETA')
```

Sostituire `https://oneuptime.com` con l'URL della propria istanza OneUptime se self-hosted.

## Criteri di Monitoraggio

È possibile configurare criteri per determinare quando il servizio è considerato online, degradato o offline in base a:

### Tipi di Controllo Disponibili

| Tipo di Controllo | Descrizione |
|------------|-------------|
| Richiesta In Entrata | Se un heartbeat è stato ricevuto entro una finestra temporale |
| Corpo Richiesta | Contenuto del corpo della richiesta inviata con l'heartbeat |
| Intestazione Richiesta | Nome di un'intestazione di richiesta specifica |
| Valore Intestazione Richiesta | Valore di un'intestazione di richiesta specifica |

### Tipi di Filtro

Per **Richiesta In Entrata**:

- **Ricevuta In Minuti** — Un heartbeat è stato ricevuto entro il numero di minuti specificato
- **Non Ricevuta In Minuti** — Nessun heartbeat ricevuto entro il numero di minuti specificato

Per **Corpo Richiesta**, **Intestazione Richiesta** e **Valore Intestazione Richiesta**:

- **Contiene** — Il valore contiene il testo specificato
- **Non Contiene** — Il valore non contiene il testo specificato

### Criteri di Esempio

#### Considerare offline se nessun heartbeat in 10 minuti

- **Controlla Su**: Richiesta In Entrata
- **Tipo Filtro**: Non Ricevuta In Minuti
- **Valore**: 10

#### Considerare degradato in base al contenuto del corpo della richiesta

- **Controlla Su**: Corpo Richiesta
- **Tipo Filtro**: Contiene
- **Valore**: `"status": "degraded"`

## Buone Pratiche

1. **Impostare la finestra temporale appropriatamente** — Se il cron job viene eseguito ogni 5 minuti, impostare la soglia "Non Ricevuta In Minuti" a 10–15 minuti per consentire eventuali ritardi occasionali
2. **Includere dati significativi** — Inviare informazioni sullo stato nel corpo della richiesta in modo da poter configurare criteri granulari
3. **Usare POST per dati ricchi** — Usare richieste POST con corpo JSON quando è necessario inviare informazioni dettagliate sullo stato
4. **Monitorare il monitor** — Assicurarsi che il servizio che invia gli heartbeat disponga di una corretta gestione degli errori in modo che le richieste heartbeat fallite non passino inosservate
