# Monitor Richiesta In Entrata

Un Monitor Richiesta In Entrata ti fornisce un URL a cui altri sistemi inviano richieste HTTP. OneUptime valuta ogni richiesta rispetto ai tuoi criteri e può cambiare lo stato del monitor, dichiarare incidenti e allertare il tuo turno di reperibilità.

Copre due compiti diversi:

- **Monitoraggio heartbeat** — un cron job, un worker o un dispositivo chiama l'URL secondo una pianificazione, e OneUptime apre un incidente quando gli heartbeat smettono di arrivare.
- **Ricezione di allarmi da un altro sistema** — Prometheus Alertmanager, Grafana o qualsiasi altra cosa in grado di fare POST di JSON invia allarmi, e OneUptime trasforma ciascuno di essi in un incidente con escalation di reperibilità e risoluzione automatica al ripristino.

Entrambi usano lo stesso tipo di monitor. A distinguerli sono i criteri che configuri.

## Panoramica

I Monitor Richiesta In Entrata forniscono un URL univoco che i tuoi servizi chiamano. Questo ti consente di:

- Monitorare cron job e attività pianificate
- Verificare che i worker in background siano attivi
- Monitorare servizi dietro firewall non raggiungibili dall'esterno
- Ricevere allarmi da Prometheus Alertmanager, Grafana e altri sistemi di alerting
- Tracciare segnali heartbeat da qualsiasi sistema in grado di fare HTTP

## Creazione di un Monitor Richiesta In Entrata

1. Vai su **Monitor** nella dashboard di OneUptime
2. Fai clic su **Crea monitor**
3. Seleziona **Richiesta in entrata** come tipo di monitor
4. Per questo monitor vengono generati una **Chiave segreta** e un URL
5. Apri il monitor e fai clic su **Documentation** nel menu di sinistra per copiare l'URL
6. Configura il tuo servizio per inviare richieste a quell'URL
7. Configura i criteri di monitoraggio come descritto di seguito

## L'URL della richiesta

Il tuo monitor ha un URL univoco nel formato:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Sostituisci `https://oneuptime.com` con l'URL della tua istanza OneUptime se è self-hosted.

Invia richieste **GET** o **POST** a questo URL. HEAD è accettato e trattato come GET. Altri metodi restituiscono 404. La chiave segreta nel percorso è l'unica credenziale: non serve alcun header né token.

> **Warning:** Chiunque conosca questo URL può marcare il monitor come sano, quindi trattalo come un segreto. Ogni header che invii viene memorizzato sul monitor ed è visibile a chiunque possa leggerlo — non inviare chiavi API o token negli header verso questo endpoint.

OneUptime risponde subito con un `200` vuoto ed elabora la richiesta in coda. Quella risposta viene scritta prima di qualunque validazione, quindi un `200` **non** conferma che la richiesta sia stata accettata: una chiave segreta sbagliata, un monitor eliminato e un monitor disabilitato restituiscono anch'essi `200`. Controlla la timeline del monitor stesso per confermare che le richieste stiano arrivando.

### Invio di un corpo della richiesta

Se vuoi indirizzare campi all'interno del corpo — `{{requestBody.status}}` nel titolo di un incidente, un percorso JSON nel raggruppamento degli incidenti o un criterio JavaScript Expression — invia `Content-Type: application/json`: è il formato che questa documentazione presuppone ovunque. Anche un corpo `application/x-www-form-urlencoded` viene analizzato, ma solo in campi piatti di primo livello. Qualsiasi altro content type, o nessuno, non viene analizzato e ogni riferimento a `requestBody` non si risolve in nulla.

Sono accettati corpi fino a 50 MB. Non comprimere il corpo con `Content-Encoding: gzip`; viene memorizzato non analizzato e i percorsi al suo interno non si risolveranno.

### Invio di un Heartbeat

#### Utilizzando curl

```bash
# Semplice richiesta GET
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# Richiesta POST con corpo personalizzato
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Da un cron job

```bash
# Aggiungere al crontab per inviare heartbeat ogni 5 minuti
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### Dal codice applicativo

```javascript
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Esempio Python
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## Criteri di Monitoraggio

Puoi configurare criteri per stabilire quando il tuo servizio è considerato online, degradato o offline. Ogni filtro di criterio ha un **Filter Type** (cosa guardare), una **Filter Condition** (come confrontarlo) e un **Value**.

### Filter Type disponibili

| Filter Type           | Controlla                                                      | Note                                                                                          |
| --------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Incoming Request      | Se è stata ricevuta una richiesta entro una finestra temporale | L'unico controllo che può scattare quando non arriva nulla                                    |
| Request Body          | Il corpo della richiesta                                       | Corrispondenza per sottostringa. I corpi oggetto vengono confrontati come JSON compatto       |
| Request Header        | I nomi degli header della richiesta                            | Corrispondenza esatta con un nome di header, in minuscolo                                     |
| Request Header Value  | I valori degli header della richiesta                          | Corrispondenza esatta con un valore di header, in minuscolo                                   |
| JavaScript Expression | Qualsiasi espressione su `requestBody` e `requestHeaders`      | L'opzione più flessibile — vedi [Espressioni JavaScript](/docs/monitor/javascript-expression) |

### Filter Condition

Ogni Filter Type offre il proprio insieme di condizioni.

Per **Incoming Request** (riportate qui con l'ortografia della dashboard):

- **Recieved In Minutes** — una richiesta è stata ricevuta entro il numero di minuti indicato
- **Not Recieved In Minutes** — nessuna richiesta è stata ricevuta entro il numero di minuti indicato

Per **Request Body**, **Request Header** e **Request Header Value**: **Contains** e **Not Contains**.

Per **JavaScript Expression**: **Evaluates To True**.

> **Note:** I nomi e i valori degli header vengono portati in minuscolo prima del confronto, e la corrispondenza è sull'intero nome o valore, non su una sottostringa. Scrivi `content-type`, non `Content-Type`, e `application/json`, non `application/JSON`. Solo **Request Body** esegue una vera corrispondenza per sottostringa.

I corpi oggetto vengono confrontati come JSON compatto senza spazi, quindi un filtro **Request Body** / **Contains** va scritto `"status":"firing"` — copiare `"status": "firing"` da un payload formattato non corrisponderà mai.

### Criteri di Esempio

#### Considerare offline se nessun heartbeat in 10 minuti

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### Considerare degradato in base al contenuto del corpo della richiesta

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** Un monitor viene rivalutato in background solo se almeno uno dei suoi criteri controlla **Incoming Request**. Un monitor i cui criteri controllano solo Request Body, Request Header o una JavaScript Expression viene valutato all'arrivo di una richiesta e in nessun altro momento — quindi non può mai andare offline da solo. Se vuoi un allarme per heartbeat mancante, ti serve un criterio **Incoming Request**.

Nota inoltre che un monitor che non ha mai ricevuto una richiesta viene trattato come se il suo momento di creazione fosse l'ultima richiesta. Un criterio "Not Recieved In Minutes: 10" su un monitor appena creato scatta 10 minuti dopo la creazione, anche se il mittente non è mai stato collegato.

## Ricezione di allarmi da un altro sistema

Alertmanager, Grafana e strumenti simili inviano in POST un documento JSON che descrive uno o più allarmi. Per impostazione predefinita un criterio apre **un** incidente, quindi un payload con cinque allarmi produrrebbe un solo incidente. Il raggruppamento degli incidenti cambia questo: estrae un valore dal payload e apre **un incidente separato per ogni valore distinto**, e tutti possono essere aperti contemporaneamente.

### Attivare il raggruppamento degli incidenti

Apri il criterio, espandi **Settings** e attiva **Group incidents and alerts by a payload field**. Compaiono quattro campi:

| Campo                              | Esempio                                  | Cosa fa                                                                                 |
| ---------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | Il percorso i cui valori distinti separano gli incidenti                                |
| Field that signals recovery        | `requestBody.alerts[*].status`           | Il percorso controllato per decidere che un allarme è rientrato                         |
| Value that means recovered         | `resolved`                               | Il valore esatto che segnala il ripristino                                              |
| Max incidents per request          | `100` (predefinito)                      | Limite di sicurezza perché un campo ad alta cardinalità non apra incidenti senza limite |

### Sintassi dei percorsi

I percorsi devono iniziare con il prefisso letterale `requestBody.`. Un percorso privo di esso — `alerts[*].labels.alertname` — non corrisponde a nulla, in silenzio. L'involucro `{{ }}` è facoltativo: `requestBody.status` e `{{requestBody.status}}` si comportano in modo identico.

- `[*]` si espande su un array — un incidente per ogni valore **distinto**. Due elementi che producono lo stesso valore si fondono in un unico incidente, e lo stato firing/resolved di quell'incidente viene preso dal **primo** elemento corrispondente. **Solo il primo `[*]` di un percorso è un carattere jolly**; `requestBody.groups[*].alerts[*].name` non corrisponde a nulla.
- `[0]` e `[last]` selezionano un singolo elemento e possono seguire un `[*]`.
- I valori oggetto e array, le stringhe vuote e i null vengono saltati. `0` e `false` sono chiavi valide.

### La risoluzione è guidata dagli eventi

Un webhook descrive solo ciò che sta in quel payload, quindi OneUptime non risolve mai un incidente perché la sua chiave ha smesso di comparire. Un incidente viene risolto solo quando un payload dichiara esplicitamente che quella chiave è rientrata. Devono valere due cose insieme:

1. **Field that signals recovery** e **Value that means recovered** sono impostati e corrispondono al payload. Il confronto è esatto e distingue maiuscole e minuscole — `Resolved` non corrisponde a `resolved`.
2. L'incidente del criterio ha **Auto Resolve Incident** attivo, sotto **Advanced Options** nel modulo dell'incidente. Senza di esso, gli eventi di ripristino corrispondenti vengono ignorati e gli incidenti restano aperti. (Lo stesso vale per gli avvisi e **Auto Resolve Alert**.)

**Max incidents per request** limita l'estrazione, non solo la creazione. Le chiavi oltre il limite sono invisibili anche al ripristino, quindi in un payload con più chiavi distinte del limite un allarme che riporta `resolved` oltre di esso non chiuderà il proprio incidente.

> **Warning:** Se **Field that signals recovery** contiene `[*]` ma **Open a separate incident for each…** no, non si risolverà mai nulla. Usa `[*]` in entrambi, oppure in nessuno dei due. Un percorso di ripristino senza `[*]` viene valutato sull'intero payload, quindi uno `status: resolved` a livello di payload risolve ogni chiave di quel payload — inclusi gli allarmi il cui stato è ancora firing.

### Dare un nome agli incidenti

La chiave di raggruppamento viene esposta ai modelli di incidenti e avvisi come variabile con il nome dell'**ultimo segmento del percorso**:

| Percorso                                 | Variabile         |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

Il payload completo resta disponibile accanto a essa, quindi un titolo di incidente `{{alertname}}` e una descrizione che usa `{{requestBody.commonAnnotations.summary}}` funzionano entrambi. Vedi [Modelli dinamici di incidenti e avvisi](/docs/monitor/incident-alert-templating).

> **Warning:** Il nome della variabile fa parte dell'identità che OneUptime usa per abbinare un evento di ripristino a un incidente aperto. Cambiare il percorso di raggruppamento con uno che ha un ultimo segmento diverso rende orfani tutti gli incidenti attualmente aperti sotto il vecchio percorso: non possono più essere risolti automaticamente e vanno chiusi a mano.

Nota che `[*]` funziona **solo** nei due campi del percorso di raggruppamento. Altrove non si risolve, e un segnaposto non risolto viene stampato **alla lettera** anziché svuotato — un titolo `{{requestBody.alerts[*].labels.alertname}}` compare con le parentesi graffe incluse. Un titolo `{{requestBody.alerts[0].annotations.summary}}` si risolve, ma legge sempre il primo allarme del payload, non quello per cui questo incidente è stato aperto. Preferisci la variabile di raggruppamento insieme ai campi condivisi `commonAnnotations` del payload.

### Esempio completo

Per una configurazione Alertmanager completa, vedi [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager). Per Grafana, vedi [Grafana](/docs/integrations/grafana).

## Buone Pratiche

1. **Imposta correttamente la finestra temporale** — Se il tuo cron job gira ogni 5 minuti, imposta la soglia "Not Recieved In Minutes" tra 10 e 15 minuti per tollerare ritardi occasionali
2. **Includi dati significativi** — Invia informazioni di stato nel corpo della richiesta così da poter impostare criteri granulari
3. **Usa POST con `Content-Type: application/json`** — tutto ciò che legge dentro il corpo dipende da questo
4. **Non mescolare i due compiti su un unico monitor** — un monitor che riceve allarmi guidati da eventi non ha una cadenza regolare, quindi un criterio "Not Recieved In Minutes" su di esso oscillerà. Usa un monitor separato per l'interruttore dell'uomo morto
5. **Monitora il monitor** — Assicurati che il servizio che invia le richieste gestisca correttamente gli errori, così che le richieste fallite non passino inosservate

## Dove leggere poi

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — una configurazione completa di alerting in entrata
- [Grafana](/docs/integrations/grafana) — lo stesso, per l'alerting di Grafana
- [Modelli dinamici di incidenti e avvisi](/docs/monitor/incident-alert-templating) — tutte le variabili disponibili in titoli e descrizioni
- [Espressioni JavaScript](/docs/monitor/javascript-expression) — sintassi delle espressioni e regole sulle virgolette
