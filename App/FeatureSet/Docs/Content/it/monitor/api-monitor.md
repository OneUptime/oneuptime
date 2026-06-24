# Monitor API

Il monitoraggio API ti consente di monitorare la disponibilità, le prestazioni e la correttezza delle tue API HTTP/REST. OneUptime invia periodicamente richieste HTTP agli endpoint della tua API e valuta le risposte in base ai criteri configurati.

## Panoramica

I monitor API effettuano richieste HTTP ai tuoi endpoint e controllano le risposte. Questo ti consente di:

- Monitorare l'uptime e la disponibilità delle API
- Monitorare i tempi di risposta e le prestazioni
- Verificare i codici di stato HTTP e i body delle risposte
- Validare gli header delle risposte
- Testare diversi metodi HTTP (GET, POST, PUT, DELETE, ecc.)
- Inviare header e body delle richieste personalizzati

## Creazione di un Monitor API

1. Vai su **Monitor** nella Dashboard di OneUptime
2. Clicca su **Crea Monitor**
3. Seleziona **API** come tipo di monitor
4. Inserisci l'URL dell'API e configura le impostazioni della richiesta
5. Configura i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### URL API

Inserisci l'URL completo dell'endpoint API che vuoi monitorare (es. `https://api.example.com/v1/health`).

### Segnaposto URL Dinamici

Quando si monitorano API dietro CDN o proxy di caching, il monitor potrebbe ricevere una risposta cached invece di raggiungere il server di origine. Per aggirare la cache ad ogni controllo, puoi usare segnaposto URL dinamici che vengono sostituiti con un valore univoco ad ogni richiesta di monitoraggio.

#### Segnaposto Supportati

| Segnaposto      | Descrizione                                         | Valore di Esempio                  |
| --------------- | --------------------------------------------------- | ---------------------------------- |
| `{{timestamp}}` | Sostituito con il timestamp Unix corrente (secondi) | `1719500000`                       |
| `{{random}}`    | Sostituito con una stringa univoca casuale          | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Esempio

Configura l'URL del tuo monitor con un segnaposto:

```
https://api.example.com/health?cb={{timestamp}}
```

Ad ogni controllo di monitoraggio, l'URL diventa:

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

Puoi anche usare `{{random}}` per una stringa univoca ad ogni richiesta:

```
https://api.example.com/health?nocache={{random}}
```

### Tipo di Richiesta API

Seleziona il metodo HTTP per la richiesta:

- **GET** (predefinito)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### Opzioni Avanzate

#### Header della Richiesta

Aggiungi header HTTP personalizzati alla richiesta. Questo è utile per token di autenticazione, specifiche del tipo di contenuto e altri header specifici dell'API.

Puoi usare i [Segreti del Monitor](/docs/monitor/monitor-secrets) nei valori degli header per archiviare in modo sicuro dati sensibili come le chiavi API.

#### Body della Richiesta (JSON)

Per le richieste POST, PUT e PATCH, puoi specificare un body della richiesta JSON. Puoi usare i [Segreti del Monitor](/docs/monitor/monitor-secrets) anche nel body della richiesta.

#### Non Seguire i Reindirizzamenti

Per impostazione predefinita, OneUptime segue i reindirizzamenti HTTP (301, 302, ecc.). Abilita questa opzione se vuoi monitorare la risposta di reindirizzamento stessa piuttosto che la destinazione finale.

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** _(optional)_ — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## Criteri di Monitoraggio

Puoi configurare criteri per determinare quando la tua API è considerata online, degradata o offline in base a:

- **Codice di Stato della Risposta** - Controlla se il codice di stato HTTP corrisponde ai valori attesi (es. 200, 201)
- **Tempo di Risposta** - Monitora se il tempo di risposta supera una soglia
- **Body della Risposta** - Controlla se il body della risposta contiene o corrisponde a contenuto specifico
- **Header della Risposta** - Verifica che specifici header di risposta siano presenti o corrispondano ai valori attesi
- **Espressione JavaScript** - Scrivi espressioni personalizzate per valutare la risposta. Vedi [Espressioni JavaScript](/docs/monitor/javascript-expression) per i dettagli.
