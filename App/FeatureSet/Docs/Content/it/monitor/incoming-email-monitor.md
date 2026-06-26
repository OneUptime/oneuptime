# Monitor Email In Entrata

Il Monitor Email In Entrata consente di creare e risolvere avvisi in base alle email inviate a indirizzi email univoci specifici per monitor. Questo è utile per integrare sistemi legacy, strumenti di avviso di terze parti o qualsiasi servizio in grado di inviare notifiche via email.

## Come Funziona

1. Quando si crea un Monitor Email In Entrata, OneUptime genera un indirizzo email univoco per quel monitor
2. Qualsiasi email inviata a quell'indirizzo viene ricevuta e valutata in base ai criteri configurati
3. In base ai criteri, OneUptime può creare nuovi avvisi o risolvere quelli esistenti

Questo è un modo efficace per integrare i sistemi di avviso basati su email con il flusso di gestione degli incidenti di OneUptime.

## Creazione di un Monitor Email In Entrata

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Email In Entrata** come tipo di monitor
4. Configurare le impostazioni del monitor:
   - **Nome:** Un nome descrittivo per il monitor
   - **Descrizione:** Lo scopo di questo monitor
5. Configurare i **Criteri di Creazione Avvisi** (condizioni che creano avvisi)
6. Configurare i **Criteri di Risoluzione Avvisi** (condizioni che risolvono gli avvisi)
7. Fare clic su **Crea**

Dopo la creazione, verrà visualizzato l'indirizzo email univoco per questo monitor nella pagina dei dettagli del monitor.

## Formato dell'Indirizzo Email

Ogni Monitor Email In Entrata riceve un indirizzo email univoco nel formato:

```
monitor-{chiave-segreta}@{dominio-inbound}
```

Ad esempio: `monitor-abc123def456@inbound.yourdomain.com`

È possibile copiare questo indirizzo dalla pagina dei dettagli del monitor e configurare i propri sistemi esterni per inviare email a tale indirizzo.

## Campi Criteri Disponibili

È possibile creare criteri basati sui seguenti campi dell'email:

| Campo              | Descrizione                                                   |
| ------------------ | ------------------------------------------------------------- |
| **Oggetto Email**  | La riga dell'oggetto dell'email in entrata                    |
| **Email Da**       | L'indirizzo email del mittente                                |
| **Corpo Email**    | Il contenuto testuale del corpo dell'email                    |
| **Email A**        | L'indirizzo email del destinatario                            |
| **Email Ricevuta** | Criteri basati sul tempo per quando le email vengono ricevute |

## Tipi di Filtro Disponibili

### Filtri Stringa (Oggetto, Da, Corpo, A)

| Filtro           | Descrizione                                           | Esempio                            |
| ---------------- | ----------------------------------------------------- | ---------------------------------- |
| **Contiene**     | Il campo contiene il testo specificato                | Oggetto contiene "CRITICO"         |
| **Non Contiene** | Il campo non contiene il testo specificato            | Oggetto non contiene "TEST"        |
| **Uguale a**     | Il campo corrisponde esattamente al testo specificato | Da uguale a "avvisi@servizio.com"  |
| **Diverso da**   | Il campo non corrisponde al testo specificato         | Oggetto diverso da "OK"            |
| **Inizia Con**   | Il campo inizia con il testo specificato              | Oggetto inizia con "[AVVISO]"      |
| **Termina Con**  | Il campo termina con il testo specificato             | Oggetto termina con "- Produzione" |
| **È Vuoto**      | Il campo è vuoto                                      | Corpo è vuoto                      |
| **Non È Vuoto**  | Il campo ha contenuto                                 | Oggetto non è vuoto                |

### Filtri Basati sul Tempo (Email Ricevuta)

| Filtro                     | Descrizione                             | Esempio                         |
| -------------------------- | --------------------------------------- | ------------------------------- |
| **Ricevuta In Minuti**     | L'email è stata ricevuta entro X minuti | Email ricevuta in 30 minuti     |
| **Non Ricevuta In Minuti** | Nessuna email ricevuta in X minuti      | Email non ricevuta in 60 minuti |

## Configurazioni di Esempio

### Esempio 1: Creazione Avviso per Email Critiche

**Criteri di Creazione Avvisi:**

- Oggetto Email **Contiene** "CRITICO"
- OPPURE Oggetto Email **Contiene** "AVVISO"
- OPPURE Oggetto Email **Contiene** "ERRORE"

**Criteri di Risoluzione Avvisi:**

- Oggetto Email **Contiene** "RISOLTO"
- OPPURE Oggetto Email **Contiene** "OK"
- OPPURE Oggetto Email **Contiene** "RECUPERATO"

### Esempio 2: Monitoraggio di un Mittente Specifico

**Criteri di Creazione Avvisi:**

- Email Da **Uguale a** "monitoraggio@sistema-legacy.com"
- E Oggetto Email **Contiene** "Fallito"

**Criteri di Risoluzione Avvisi:**

- Email Da **Uguale a** "monitoraggio@sistema-legacy.com"
- E Oggetto Email **Contiene** "Successo"

### Esempio 3: Monitor Heartbeat (Nessuna Email = Avviso)

**Criteri di Creazione Avvisi:**

- Email Ricevuta **Non Ricevuta In Minuti** con valore `60`

Questo crea un avviso se non viene ricevuta nessuna email per 60 minuti - utile per monitorare processi pianificati o batch che dovrebbero inviare email di completamento.

**Criteri di Risoluzione Avvisi:**

- Email Ricevuta **Ricevuta In Minuti** con valore `5`

Questo risolve l'avviso quando viene ricevuta un'email.

## Casi d'Uso

### Integrazione con Sistemi Legacy

Molti sistemi più vecchi supportano solo avvisi basati su email. Usare il Monitor Email In Entrata per:

- Convertire gli avvisi email in incidenti OneUptime
- Risolvere automaticamente gli incidenti quando arrivano email di recupero
- Centralizzare gli avvisi da più sistemi legacy

### Monitoraggio di Servizi di Terze Parti

Integrazione con servizi che inviano notifiche via email:

- Avvisi del provider cloud (AWS, GCP, Azure)
- Strumenti di scansione della sicurezza
- Notifiche di completamento backup
- Avvisi di scadenza certificato SSL

### Monitoraggio di Job Pianificati

Monitorare job batch e attività pianificate:

- Creare avvisi se le email di completamento non vengono ricevute puntualmente
- Tracciare i fallimenti dei job tramite email di notifica degli errori
- Monitorare i completamenti delle pipeline dati

### Aggregazione di Avvisi Multi-Vendor

Consolidare gli avvisi da più strumenti di monitoraggio:

- Ricevere avvisi da Nagios, Zabbix o altri strumenti tramite email
- Unificare la gestione degli incidenti in OneUptime
- Mantenere un'unica fonte di verità per tutti gli avvisi

## Variabili Template

Quando si configurano i template degli incidenti, è possibile usare queste variabili dalle email in entrata:

| Variabile             | Descrizione                        |
| --------------------- | ---------------------------------- |
| `{{emailSubject}}`    | L'oggetto dell'email ricevuta      |
| `{{emailFrom}}`       | L'indirizzo email del mittente     |
| `{{emailTo}}`         | L'indirizzo email del destinatario |
| `{{emailBody}}`       | Il corpo testuale dell'email       |
| `{{emailReceivedAt}}` | Quando è stata ricevuta l'email    |

## Visualizzazione Riepilogo Monitor

Il riepilogo del monitor mostra:

- **Ultima Email Ricevuta Alle:** Quando è stata ricevuta l'email più recente
- **Da:** Il mittente dell'ultima email
- **Oggetto:** La riga dell'oggetto dell'ultima email
- **Intestazioni Email:** Intestazioni complete dell'ultima email (espandibile)
- **Corpo Email:** Contenuto dell'ultima email (espandibile)

## Configurazione Self-Hosted

Se si ospita OneUptime autonomamente, è necessario configurare un provider di email in entrata. Attualmente supportato:

- **SendGrid Inbound Parse** - Vedere [Integrazione Email In Entrata SendGrid](/docs/self-hosted/sendgrid-inbound-email) per le istruzioni di configurazione

## Considerazioni

- **Sicurezza dell'Indirizzo Email:** L'indirizzo email del monitor contiene una chiave segreta. Trattarla come una password e non condividerla pubblicamente.
- **Dimensione dell'Email:** Le email molto grandi (con allegati grandi) potrebbero essere troncate o rifiutate dal provider email.
- **Tempo di Elaborazione:** Le email vengono elaborate in modo asincrono. Potrebbero trascorrere alcuni secondi tra l'invio di un'email e la creazione dell'avviso.
- **Insensibilità alle Maiuscole:** Tutti i confronti tra stringhe (Contiene, Uguale a, ecc.) non distinguono tra maiuscole e minuscole.
- **Testo Normale:** I criteri sul corpo dell'email usano la versione in testo normale. La formattazione HTML viene rimossa.

## Risoluzione dei Problemi

### Email Non Ricevute

1. Verificare che l'indirizzo email sia corretto (controllare errori di battitura)
2. Verificare che l'email non venga bloccata dai filtri antispam
3. Verificare che il provider di email in entrata sia configurato correttamente
4. Controllare i log di OneUptime per eventuali messaggi di errore

### Avvisi Non Creati

1. Verificare che i criteri corrispondano al contenuto dell'email
2. Verificare che il monitor non sia disabilitato
3. Esaminare i log di valutazione nei dettagli del monitor
4. Testare con corrispondenze di stringa esatte prima di usare la corrispondenza per pattern

### Avvisi Non Risolti

1. Verificare che i criteri di risoluzione corrispondano all'email di recupero
2. Assicurarsi che esista un avviso attivo da risolvere
3. Verificare che l'email di risoluzione venga inviata allo stesso indirizzo del monitor
