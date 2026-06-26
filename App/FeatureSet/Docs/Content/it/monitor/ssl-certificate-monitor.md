# Monitor Certificato SSL

Il monitoraggio dei certificati SSL consente di monitorare la validità e la scadenza dei certificati SSL/TLS sui propri siti web e servizi. OneUptime controlla periodicamente i certificati e invia avvisi prima che scadano o se vengono rilevati problemi.

## Panoramica

I monitor per certificati SSL si connettono agli endpoint HTTPS e ispezionano il certificato SSL/TLS. Questo consente di:

- Monitorare le date di scadenza dei certificati
- Rilevare certificati scaduti o in prossima scadenza
- Identificare certificati autofirmati
- Verificare la validità dei certificati
- Prevenire interruzioni del servizio causate da certificati scaduti

## Creazione di un Monitor Certificato SSL

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Certificato SSL** come tipo di monitor
4. Inserire l'URL dell'endpoint HTTPS da controllare
5. Configurare i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### URL

Inserire l'URL HTTPS completo dell'endpoint il cui certificato SSL si vuole monitorare (ad es. `https://example.com` o `https://example.com:8443`).

## Criteri di Monitoraggio

È possibile configurare criteri per determinare quando lo stato del certificato è considerato online, degradato o offline in base a:

### Tipi di Controllo Disponibili

| Tipo di Controllo       | Descrizione                                               |
| ----------------------- | --------------------------------------------------------- |
| È Online                | Se il server è raggiungibile                              |
| Certificato Valido      | Se il certificato è valido (non scaduto, non autofirmato) |
| Certificato Autofirmato | Se il certificato è autofirmato                           |
| Certificato Scaduto     | Se il certificato è scaduto                               |
| Certificato Non Valido  | Se il certificato non è valido                            |
| Scade In Ore            | Numero di ore alla scadenza del certificato               |
| Scade In Giorni         | Numero di giorni alla scadenza del certificato            |
| Richiesta Timeout       | Se la connessione è andata in timeout                     |

### Tipi di Filtro

Per **È Online**, **Certificato Valido**, **Certificato Autofirmato**, **Certificato Scaduto**, **Certificato Non Valido** e **Richiesta Timeout**:

- **Vero** — La condizione è vera
- **Falso** — La condizione è falsa

Per **Scade In Ore** e **Scade In Giorni**:

- **Maggiore Di** — La scadenza è a più del valore specificato
- **Minore Di** — La scadenza è a meno del valore specificato
- **Maggiore o Uguale a** — La scadenza è pari o superiore al valore specificato
- **Minore o Uguale a** — La scadenza è pari o inferiore al valore specificato
- **Uguale a** — La scadenza corrisponde esattamente
- **Diverso da** — La scadenza non corrisponde

### Criteri di Esempio

#### Considerare degradato se il certificato scade entro 30 giorni

- **Controlla Su**: Scade In Giorni
- **Tipo Filtro**: Minore Di
- **Valore**: 30

#### Considerare offline se il certificato è scaduto

- **Controlla Su**: Certificato Scaduto
- **Tipo Filtro**: Vero

#### Avviso se il certificato è autofirmato

- **Controlla Su**: Certificato Autofirmato
- **Tipo Filtro**: Vero

#### Considerare offline se il certificato non è valido

- **Controlla Su**: Certificato Non Valido
- **Tipo Filtro**: Vero

## Buone Pratiche

1. **Impostare soglie multiple** — Usare lo stato degradato a 30 giorni e offline a 7 giorni prima della scadenza per avere il tempo di rinnovare
2. **Monitorare tutti gli endpoint** — Se si hanno più domini o sottodomini, creare un monitor per ciascuno
3. **Includere le porte non standard** — Non dimenticare i servizi HTTPS in esecuzione su porte non standard
4. **Monitorare dopo il rinnovo** — Dopo aver rinnovato un certificato, verificare che il monitor confermi che è valido
