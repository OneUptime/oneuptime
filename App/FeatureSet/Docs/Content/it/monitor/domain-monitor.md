# Monitor di Dominio

Il monitoraggio di dominio ti consente di monitorare lo stato di registrazione e la scadenza dei tuoi nomi di dominio. OneUptime esegue periodicamente ricerche WHOIS per tracciare lo stato del tuo dominio e avvisarti prima che scada.

## Panoramica

I monitor di dominio interrogano i dati WHOIS per i tuoi domini per tracciare i dettagli di registrazione. Questo ti consente di:

- Monitorare le date di scadenza del dominio
- Rilevare domini scaduti o prossimi alla scadenza
- Tracciare le informazioni sul registrar del dominio
- Verificare la configurazione dei nameserver
- Monitorare i codici di stato del dominio

## Creazione di un Monitor di Dominio

1. Vai su **Monitor** nella Dashboard di OneUptime
2. Clicca su **Crea Monitor**
3. Seleziona **Domain** come tipo di monitor
4. Inserisci il nome del dominio che vuoi monitorare
5. Configura i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### Impostazioni di Base

| Campo        | Descrizione                                  | Obbligatorio |
| ------------ | -------------------------------------------- | ------------ |
| Nome Dominio | Il dominio da monitorare (es. `example.com`) | Sì           |

### Impostazioni Avanzate

| Campo        | Descrizione                               | Predefinito |
| ------------ | ----------------------------------------- | ----------- |
| Timeout (ms) | Tempo di attesa per una risposta WHOIS    | 10000       |
| Tentativi    | Numero di tentativi in caso di fallimento | 3           |

## Criteri di Monitoraggio

Puoi configurare criteri per determinare quando il tuo dominio è considerato online, degradato o offline in base a:

### Tipi di Controllo Disponibili

| Tipo di Controllo      | Descrizione                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| Domain Expires In Days | Numero di giorni fino alla scadenza della registrazione del dominio |
| Domain Registrar       | Il nome del registrar del dominio                                   |
| Domain Name Server     | Hostname dei nameserver per il dominio                              |
| Domain Status Code     | Codici di stato WHOIS del dominio                                   |
| Domain Is Expired      | Se il dominio è scaduto                                             |

### Tipi di Filtro

Per **Domain Is Expired**:

- **True** — Il dominio è scaduto
- **False** — Il dominio non è scaduto

Per **Domain Expires In Days**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

Per **Domain Registrar**, **Domain Name Server** e **Domain Status Code**:

- **Contains** — Il valore contiene il testo specificato
- **Not Contains** — Il valore non contiene il testo specificato
- **Starts With** — Il valore inizia con il testo specificato
- **Ends With** — Il valore termina con il testo specificato
- **Equal To** — Il valore corrisponde esattamente
- **Not Equal To** — Il valore non corrisponde

### Esempi di Criteri

#### Avvisa se il dominio scade entro 30 giorni

- **Controlla Su**: Domain Expires In Days
- **Tipo di Filtro**: Less Than
- **Valore**: 30

#### Segna come offline se il dominio è scaduto

- **Controlla Su**: Domain Is Expired
- **Tipo di Filtro**: True

#### Verifica che i nameserver siano corretti

- **Controlla Su**: Domain Name Server
- **Tipo di Filtro**: Contains
- **Valore**: `ns1.example.com`

## Best Practice

1. **Imposta avvisi anticipati** — Configura avvisi di degradazione a 60 giorni e avvisi di offline a 14 giorni prima della scadenza
2. **Monitora tutti i domini critici** — Includi i domini principali, i sottodomini registrati separatamente e qualsiasi dominio usato per email o API
3. **Traccia i cambiamenti di registrar** — Monitora il campo registrar per rilevare trasferimenti di dominio non autorizzati
