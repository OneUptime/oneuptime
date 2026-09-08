# Integrazione Email In Entrata SendGrid

Il **Monitor Email In Entrata** di OneUptime consente di creare e risolvere avvisi in base alle email inviate a indirizzi email univoci specifici per monitor. Questo è utile per integrarsi con sistemi legacy, strumenti di avviso o qualsiasi servizio in grado di inviare email.

Questa guida spiega come configurare SendGrid Inbound Parse per inoltrare le email in entrata alla propria istanza self-hosted di OneUptime.

## Prerequisiti

- Un account SendGrid con accesso a Inbound Parse
- Un dominio di cui si è proprietari con accesso alle impostazioni DNS
- Un endpoint HTTPS pubblico che inoltri i webhook SendGrid a OneUptime

## Accesso alla rete

Inbound Parse richiede che SendGrid avvii una connessione verso OneUptime. Consentire solo traffico Internet in uscita non è sufficiente.

| Direzione | Destinazione | Protocollo / porta | Scopo |
| --- | --- | --- | --- |
| SendGrid → OneUptime | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` | HTTPS / TCP 443 | Consegnare email analizzate tramite POST multipart. |
| Server di posta mittenti → SendGrid | `mx.sendgrid.net`, tramite il record MX pubblico del dominio ricevente | SMTP / TCP 25 | Ricevere email su SendGrid, non sul server OneUptime. |
| OneUptime → SendGrid, solo con invio email configurato separatamente | `api.sendgrid.com` | HTTPS / TCP 443 | Inviare notifiche tramite Mail Send API. |

Pubblica il DNS dell’hostname del webhook e usa un certificato pubblicamente attendibile. Un’installazione privata può esporre solo questa route tramite un reverse proxy o gateway pubblico che raggiunga OneUptime internamente. Conserva percorso, segreto, tipo di contenuto e corpo multipart; consenti POST senza login interattivo o verifiche del browser. OneUptime non richiede un servizio SMTP in ascolto in ingresso. Consulta la [configurazione SendGrid](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook).

Imposta `INBOUND_EMAIL_WEBHOOK_SECRET` su un valore casuale robusto e sostituisci `YOUR_SECRET` con tale valore. L’ultimo segmento è obbligatorio. OneUptime lo confronta con il segreto configurato; lasciare la variabile vuota disabilita il controllo. Mantieni privati l’URL completo e gli indirizzi dei monitor, anche nei log del proxy. OneUptime attualmente non valida gli header firmati Inbound Parse né i token OAuth di SendGrid. Se necessari, falli verificare da un gateway prima dell’inoltro, seguendo la [documentazione di sicurezza SendGrid](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks).

SendGrid non fornisce un elenco statico affidabile degli IP di origine di Inbound Parse. Gli IP di invio email e gli indirizzi risolti per `mx.sendgrid.net` non sono una lista consentita dei webhook. Segui le [indicazioni firewall di SendGrid](https://support.sendgrid.com/hc/en-us/articles/44375457225371-How-to-Configure-Firewall-Settings-for-SendGrid-Webhook-and-Inbound-Parse-IPs).

Inbound Parse è indipendente dall’invio email. La ricezione non richiede chiamate all’API SendGrid. Per inviare notifiche con SendGrid, consenti DNS e HTTPS in uscita verso `api.sendgrid.com`; [Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send) non richiede callback in ingresso per l’invio. Con SMTP, consenti il server e la porta configurati in OneUptime.

Verifica il record MX pubblico, invia un’email a un monitor di prova e conferma l’arrivo del webhook e la creazione o risoluzione dell’avviso. Un POST vuoto o una prova di invio in uscita non verifica Inbound Parse.

## Come Funziona

1. Si crea un **Monitor Email In Entrata** in OneUptime
2. OneUptime genera un indirizzo email univoco per quel monitor (ad es. `monitor-abc123@inbound.vostrodominio.com`)
3. Quando viene inviata un'email a quell'indirizzo, SendGrid la riceve e la inoltra a OneUptime tramite webhook
4. OneUptime valuta l'email in base ai criteri configurati per creare o risolvere avvisi

## Istruzioni di Configurazione

### Fase 1: Scegliere il Dominio Email In Entrata

Sarà necessario un sottodominio dedicato alla ricezione di email in entrata. Si consiglia di usare un sottodominio come:

- `inbound.vostrodominio.com`
- `email.vostrodominio.com`
- `monitor.vostrodominio.com`

Questo sottodominio verrà usato esclusivamente per le email del monitor OneUptime.

### Fase 2: Configurare il Record MX DNS

Aggiungere un record MX alla propria configurazione DNS per instradare le email per il sottodominio inbound a SendGrid.

| Tipo | Host/Nome | Priorità | Valore          |
| ---- | --------- | -------- | --------------- |
| MX   | inbound   | 10       | mx.sendgrid.net |

**Esempio:** Se il proprio dominio è `example.com` e si usa `inbound.example.com`:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**Nota:** Le modifiche DNS possono richiedere fino a 48 ore per propagarsi, ma tipicamente si completano entro poche ore.

### Passaggio 3: Autenticare il dominio in SendGrid

Il dominio ricevente deve appartenere a uno dei tuoi [domini autenticati in SendGrid](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/inbound-parse):

1. Accedere alla propria [Dashboard SendGrid](https://app.sendgrid.com)
2. Accedere a **Impostazioni** > **Autenticazione Mittente**
3. Fare clic su **Autentica il Tuo Dominio**
4. Seguire i prompt per aggiungere i record DNS richiesti (record CNAME per DKIM)

### Fase 4: Configurare SendGrid Inbound Parse

1. Accedere alla propria [Dashboard SendGrid](https://app.sendgrid.com)
2. Navigare a **Impostazioni** > **Inbound Parse**
3. Fare clic su **Aggiungi Host & URL**
4. Configurare quanto segue:

| Campo                                      | Valore                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| **Dominio di Ricezione**                   | Il proprio sottodominio inbound (ad es. `inbound.vostrodominio.com`)          |
| **URL di Destinazione**                    | `https://vostro-dominio-oneuptime.com/incoming-email/sendgrid/VOSTRO_SEGRETO` |
| **Controlla le email in entrata per spam** | Opzionale - abilitare se desiderato                                           |
| **Invia messaggio MIME completo**          | Lasciare deselezionato (non richiesto)                                        |
| **POST del messaggio MIME completo**       | Lasciare deselezionato (non richiesto)                                        |

5. Fare clic su **Aggiungi**

### Fase 5: Configurare le Variabili d'Ambiente di OneUptime

#### Docker Compose

Aggiungere queste variabili d'ambiente al file `config.env`:

```bash
# Configurazione Email In Entrata
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.vostrodominio.com
INBOUND_EMAIL_WEBHOOK_SECRET=replace-with-a-strong-random-secret
```

#### Kubernetes con Helm

Aggiungere questi dati al file `values.yaml`:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.vostrodominio.com"
  webhookSecret: "replace-with-a-strong-random-secret"
```

Usa lo stesso segreto nella destinazione del passaggio 4 e riavvia OneUptime dopo la modifica della configurazione.

### Fase 6: Creare un Monitor Email In Entrata

1. Accedere al proprio Dashboard OneUptime
2. Navigare a **Monitor** > **Crea monitor**
3. Selezionare **Email In Entrata** come tipo di monitor
4. Configurare il monitor:
   - **Nome:** Dare al monitor un nome descrittivo
   - **Descrizione:** Descrivere lo scopo di questo monitor
5. Configurare i **Criteri di Creazione Avvisi** (quando creare un avviso):
   - Esempio: Oggetto Email contiene "AVVISO" o "CRITICO"
6. Configurare i **Criteri di Risoluzione Avvisi** (quando risolvere un avviso):
   - Esempio: Oggetto Email contiene "RISOLTO" o "OK"
7. Fare clic su **Crea**

Dopo la creazione, verrà visualizzato l'indirizzo email univoco per questo monitor (ad es. `monitor-abc123def456@inbound.vostrodominio.com`).

### Fase 7: Testare l'Integrazione

1. Copiare l'indirizzo email del monitor dal Dashboard OneUptime
2. Inviare un'email di test a quell'indirizzo con un oggetto che corrisponde ai criteri di avviso
3. Verificare nel Dashboard OneUptime:
   - Che l'email sia stata ricevuta (visibile nel Riepilogo Monitor)
   - Che sia stato creato un avviso (se i criteri corrispondono)

## Riferimento Variabili d'Ambiente

| Variabile                      | Descrizione                                                                                                                                       | Obbligatorio | Predefinito |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------- |
| `INBOUND_EMAIL_PROVIDER`       | Il provider di email in entrata da usare                                                                                                          | Sì           | -           |
| `INBOUND_EMAIL_DOMAIN`         | Il sottodominio configurato per le email in entrata                                                                                               | Sì           | -           |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Confrontato con l’ultimo segmento di `/incoming-email/sendgrid/YOUR_SECRET`. Configuralo per endpoint pubblici; un valore vuoto disabilita la verifica. | Consigliato | - |

## Criteri Email Supportati

Quando si configura il proprio Monitor Email In Entrata, è possibile creare criteri basati su:

| Campo                  | Descrizione                        | Filtri Disponibili                                                                          |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| **Oggetto dell'email** | La riga dell'oggetto dell'email    | Contiene, Non Contiene, Uguale a, Diverso da, Inizia Con, Termina Con, È Vuoto, Non È Vuoto |
| **Email mittente**     | L'indirizzo email del mittente     | Contiene, Non Contiene, Uguale a, Diverso da, Inizia Con, Termina Con, È Vuoto, Non È Vuoto |
| **Corpo Email**        | Il corpo testuale dell'email       | Contiene, Non Contiene, Uguale a, Diverso da, Inizia Con, Termina Con, È Vuoto, Non È Vuoto |
| **Email A**            | L'indirizzo email del destinatario | Contiene, Non Contiene, Uguale a, Diverso da, Inizia Con, Termina Con, È Vuoto, Non È Vuoto |
| **Email Ricevuta**     | Tempo dall'ultima email ricevuta   | Ricevuta In Minuti, Non Ricevuta In Minuti                                                  |

## Casi d'Uso di Esempio

### Avvisi da Sistemi Legacy

Molti sistemi legacy possono inviare solo avvisi via email. Creare un Monitor Email In Entrata per:

- Creare avvisi OneUptime quando il sistema legacy invia email `[CRITICO]`
- Risolvere gli avvisi quando vengono ricevute email `[RISOLTO]`

### Integrazione con Servizi di Terze Parti

Integrarsi con servizi che inviano notifiche via email:

- Strumenti di monitoraggio privi di integrazioni API
- Notifiche dei provider cloud
- Strumenti di scansione della sicurezza

### Heartbeat via Email

Usare i criteri "Email Ricevuta" per assicurarsi di ricevere email periodiche:

- Creare un avviso se non viene ricevuta nessuna email in 60 minuti
- Utile per monitorare job batch o attività pianificate che inviano email di completamento

## Risoluzione dei Problemi

### Email Non Ricevute

1. **Controllare la propagazione DNS:**

   ```bash
   dig MX inbound.vostrodominio.com
   ```

   Dovrebbe restituire `mx.sendgrid.net`

2. **Verificare le impostazioni SendGrid Inbound Parse:**

   - Accedere alla Dashboard SendGrid
   - Accedere a Impostazioni > Inbound Parse
   - Verificare che il dominio e l'URL webhook siano corretti

3. **Controllare i log di OneUptime:**
   - Cerca i webhook delle email in ingresso nei log dell’applicazione OneUptime (Telemetry / ProbeIngest).
   - Verificare eventuali messaggi di errore

### Webhook Falliti

- L’URL HTTPS completo, incluso il segreto, deve essere raggiungibile da Internet. Senza l’ultimo segmento non corrisponde alla route.
- Consenti POST senza reindirizzamenti al login o verifiche interattive del browser. Gli IP di invio email SendGrid non sono un elenco delle origini dei webhook.
- Usa un certificato pubblicamente attendibile con la catena completa. Verifica la consegna come indicato in Accesso alla rete.

### Il Monitor Non Crea Avvisi

1. **Verificare la configurazione dei criteri:**

   - Controllare che i criteri di creazione avvisi corrispondano al contenuto dell'email
   - Testare con stringhe esatte prima di usare la corrispondenza per pattern

2. **Controllare lo stato del monitor:**

   - Assicurarsi che il monitor non sia disabilitato
   - Verificare che il tipo di monitor sia "Email In Entrata"

3. **Esaminare il Riepilogo Monitor:**
   - Controllare se l'email è stata ricevuta ed elaborata
   - Esaminare i log di valutazione per i dettagli sulla corrispondenza dei criteri

### Log di Consegna Webhook SendGrid

Per verificare se SendGrid sta inviando correttamente i webhook:

1. Purtroppo, SendGrid non fornisce log dettagliati per Inbound Parse
2. Controllare i log del server OneUptime per le richieste webhook in entrata
3. Usare uno strumento come [RequestBin](https://requestbin.com) per testare temporaneamente la consegna dei webhook

## Buone Pratiche di Sicurezza

1. **Usare HTTPS:** Usare sempre HTTPS per l'endpoint webhook
2. **Webhook Secret:** Configurare `INBOUND_EMAIL_WEBHOOK_SECRET` e includerlo nell'URL webhook (ad es. `/incoming-email/sendgrid/vostro-segreto`) per validazione aggiuntiva
3. **Verifica Dominio:** Verificare il proprio dominio in SendGrid per una migliore sicurezza email
4. **Limitare l'Accesso:** Creare monitor solo per fonti email attendibili
5. **Monitorare i Log:** Esaminare regolarmente i log email in entrata per attività sospette

## Provider Alternativi

OneUptime è progettato per supportare più provider di email in entrata. Attualmente supportati:

| Provider             | Stato       |
| -------------------- | ----------- |
| SendGrid             | Supportato  |
| Haraka (Self-hosted) | Pianificato |

Se si necessita del supporto per un provider diverso, contattarci o inviare una richiesta di funzionalità.

## Supporto

In caso di problemi con l'integrazione SendGrid Email In Entrata:

1. Controllare la sezione di risoluzione dei problemi sopra
2. Esaminare i log di OneUptime per messaggi di errore dettagliati
3. Contattarci all'indirizzo [hello@oneuptime.com](mailto:hello@oneuptime.com)

Accogliamo con piacere i feedback per migliorare questa integrazione!
