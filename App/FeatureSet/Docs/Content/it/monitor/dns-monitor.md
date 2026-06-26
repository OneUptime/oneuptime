# Monitor DNS

Il monitoraggio DNS ti consente di monitorare lo stato e la correttezza della risoluzione DNS per i tuoi domini. OneUptime interroga periodicamente i record DNS e valida le risposte rispetto ai criteri configurati.

## Panoramica

I monitor DNS interrogano i server DNS per tipi di record specifici e valutano i risultati. Questo ti consente di:

- Monitorare la disponibilità del servizio DNS
- Verificare che i record DNS restituiscano i valori corretti
- Monitorare i tempi di risposta della risoluzione DNS
- Validare la configurazione DNSSEC
- Rilevare problemi di propagazione DNS o hijacking

## Creazione di un Monitor DNS

1. Vai su **Monitor** nella Dashboard di OneUptime
2. Clicca su **Crea Monitor**
3. Seleziona **DNS** come tipo di monitor
4. Inserisci il nome del dominio e il tipo di record da interrogare
5. Configura i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### Impostazioni di Base

| Campo          | Descrizione                                                                                      | Obbligatorio |
| -------------- | ------------------------------------------------------------------------------------------------ | ------------ |
| Nome Dominio   | Il dominio da interrogare (es. `example.com`)                                                    | Sì           |
| Tipo di Record | Il tipo di record DNS da interrogare                                                             | Sì           |
| Server DNS     | Server DNS personalizzato da usare (es. `8.8.8.8`). Lasciare vuoto per il predefinito di sistema | No           |

### Tipi di Record Supportati

| Tipo di Record | Descrizione                                   |
| -------------- | --------------------------------------------- |
| A              | Record di indirizzo IPv4                      |
| AAAA           | Record di indirizzo IPv6                      |
| CNAME          | Record di nome canonico (alias)               |
| MX             | Record di scambio di posta                    |
| NS             | Record di nameserver                          |
| TXT            | Record di testo (SPF, DKIM, ecc.)             |
| SOA            | Record di Start of Authority                  |
| PTR            | Record puntatore (DNS inverso)                |
| SRV            | Record di localizzazione del servizio         |
| CAA            | Record di Certificate Authority Authorization |

### Impostazioni Avanzate

| Campo        | Descrizione                               | Predefinito |
| ------------ | ----------------------------------------- | ----------- |
| Porta        | Numero di porta DNS                       | 53          |
| Timeout (ms) | Tempo di attesa per una risposta          | 5000        |
| Tentativi    | Numero di tentativi in caso di fallimento | 3           |

## Criteri di Monitoraggio

Puoi configurare criteri per determinare quando il tuo DNS è considerato online, degradato o offline in base a:

### Tipi di Controllo Disponibili

| Tipo di Controllo         | Descrizione                                   |
| ------------------------- | --------------------------------------------- |
| DNS Is Online             | Se il server DNS risponde alle query          |
| DNS Response Time (in ms) | Tempo di risposta della query in millisecondi |
| DNS Record Exists         | Se esistono record DNS per la query           |
| DNS Record Value          | Il valore restituito da un record DNS         |
| DNSSEC Is Valid           | Se la validazione DNSSEC è superata           |

### Tipi di Filtro

Per **DNS Is Online**, **DNS Record Exists** e **DNSSEC Is Valid**:

- **True** — La condizione è vera
- **False** — La condizione è falsa

Per **DNS Response Time**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

Per **DNS Record Value**:

- **Contains** — Il valore del record contiene il testo specificato
- **Not Contains** — Il valore del record non contiene il testo specificato
- **Starts With** — Il valore del record inizia con il testo specificato
- **Ends With** — Il valore del record termina con il testo specificato
- **Equal To** — Il valore del record corrisponde esattamente
- **Not Equal To** — Il valore del record non corrisponde

### Esempi di Criteri

#### Controlla se il DNS si sta risolvendo

- **Controlla Su**: DNS Is Online
- **Tipo di Filtro**: True

#### Verifica che il record A punti all'IP corretto

- **Controlla Su**: DNS Record Value
- **Tipo di Filtro**: Equal To
- **Valore**: `93.184.216.34`

#### Avvisa se la risposta DNS è lenta

- **Controlla Su**: DNS Response Time (in ms)
- **Tipo di Filtro**: Greater Than
- **Valore**: 500

#### Verifica che DNSSEC sia valido

- **Controlla Su**: DNSSEC Is Valid
- **Tipo di Filtro**: True
