# Monitor Sito Web

Il monitoraggio del sito web consente di monitorare la disponibilità, le prestazioni e la risposta di qualsiasi sito web o pagina web. OneUptime invia periodicamente richieste HTTP all'URL del sito web e verifica che risponda correttamente.

## Panoramica

I monitor sito web verificano le pagine web effettuando richieste HTTP e valutando le risposte. Questo consente di:

- Monitorare l'uptime e la disponibilità del sito web
- Tracciare i tempi di risposta e le prestazioni
- Verificare i codici di stato HTTP
- Controllare le intestazioni della risposta
- Rilevare i tempi di inattività prima degli utenti

## Creazione di un Monitor Sito Web

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Sito Web** come tipo di monitor
4. Inserire l'URL del sito web da monitorare
5. Configurare i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### URL del Sito Web

Inserire l'URL completo del sito web da monitorare, incluso il protocollo (ad es. `https://example.com`).

### Segnaposto URL Dinamici

Quando si monitorano URL dietro CDN o proxy di cache, il monitor potrebbe ricevere una risposta dalla cache invece di raggiungere il server originale. Per invalidare la cache ad ogni controllo, è possibile usare segnaposto URL dinamici che vengono sostituiti con un valore univoco ad ogni richiesta di monitoraggio.

#### Segnaposto Supportati

| Segnaposto | Descrizione | Valore Esempio |
|-------------|-------------|---------------|
| `{{timestamp}}` | Sostituito con il timestamp Unix corrente (secondi) | `1719500000` |
| `{{random}}` | Sostituito con una stringa univoca casuale | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Esempio

Configurare l'URL del monitor con un segnaposto:

```
https://example.com/health?cb={{timestamp}}
```

Ad ogni controllo di monitoraggio, l'URL diventa:

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

È anche possibile usare `{{random}}` per una stringa univoca ad ogni richiesta:

```
https://example.com/health?nocache={{random}}
```

### Opzioni Avanzate

#### Non Seguire i Redirect

Per impostazione predefinita, OneUptime segue i redirect HTTP (301, 302, ecc.). Abilitare questa opzione se si vuole monitorare la risposta di redirect stessa piuttosto che la destinazione finale.

## Criteri di Monitoraggio

È possibile configurare criteri per determinare quando il sito web è considerato online, degradato o offline in base a:

- **Codice di Stato della Risposta** - Verificare se il codice di stato HTTP corrisponde ai valori attesi (ad es. 200, 301)
- **Tempo di Risposta** - Monitorare se il tempo di risposta supera una soglia
- **Corpo della Risposta** - Verificare se il corpo della risposta contiene o corrisponde a contenuto specifico
- **Intestazioni della Risposta** - Verificare che specifiche intestazioni di risposta siano presenti o corrispondano ai valori attesi
