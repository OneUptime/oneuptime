# Integrazione Email In Entrata SendGrid

Il **Monitor Email In Entrata** di OneUptime consente di creare e risolvere avvisi in base alle email inviate a indirizzi email univoci specifici per monitor. Questo è utile per integrarsi con sistemi legacy, strumenti di avviso o qualsiasi servizio in grado di inviare email.

Questa guida spiega come configurare SendGrid Inbound Parse per inoltrare le email in entrata alla propria istanza self-hosted di OneUptime.

## Prerequisiti

- Un account SendGrid (il livello gratuito funziona)
- Un dominio di cui si è proprietari con accesso alle impostazioni DNS
- La propria istanza OneUptime deve essere accessibile pubblicamente (affinché SendGrid possa inviare webhook)

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

| Tipo | Host/Nome | Priorità | Valore |
|------|-----------|----------|-------|
| MX | inbound | 10 | mx.sendgrid.net |

**Esempio:** Se il proprio dominio è `example.com` e si usa `inbound.example.com`:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**Nota:** Le modifiche DNS possono richiedere fino a 48 ore per propagarsi, ma tipicamente si completano entro poche ore.

### Fase 3: Verificare il Dominio in SendGrid (Opzionale ma Consigliato)

Per una migliore consegnabilità e per evitare che le email vengano contrassegnate come spam:

1. Accedere alla propria [Dashboard SendGrid](https://app.sendgrid.com)
2. Accedere a **Impostazioni** > **Autenticazione Mittente**
3. Fare clic su **Autentica il Tuo Dominio**
4. Seguire i prompt per aggiungere i record DNS richiesti (record CNAME per DKIM)

### Fase 4: Configurare SendGrid Inbound Parse

1. Accedere alla propria [Dashboard SendGrid](https://app.sendgrid.com)
2. Navigare a **Impostazioni** > **Inbound Parse**
3. Fare clic su **Aggiungi Host & URL**
4. Configurare quanto segue:

| Campo | Valore |
|-------|-------|
| **Dominio di Ricezione** | Il proprio sottodominio inbound (ad es. `inbound.vostrodominio.com`) |
| **URL di Destinazione** | `https://vostro-dominio-oneuptime.com/incoming-email/sendgrid/VOSTRO_SEGRETO` |
| **Controlla le email in entrata per spam** | Opzionale - abilitare se desiderato |
| **Invia messaggio MIME completo** | Lasciare deselezionato (non richiesto) |
| **POST del messaggio MIME completo** | Lasciare deselezionato (non richiesto) |

5. Fare clic su **Aggiungi**

### Fase 5: Configurare le Variabili d'Ambiente di OneUptime

#### Docker Compose

Aggiungere queste variabili d'ambiente al file `config.env`:

```bash
# Configurazione Email In Entrata
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.vostrodominio.com
# INBOUND_EMAIL_WEBHOOK_SECRET=vostro-segreto-opzionale  # Opzionale: per sicurezza aggiuntiva
```

#### Kubernetes con Helm

Aggiungere questi dati al file `values.yaml`:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.vostrodominio.com"
  # webhookSecret: "vostro-segreto-opzionale"  # Opzionale
```

**Importante:** Riavviare il server OneUptime dopo aver aggiunto queste variabili d'ambiente.

### Fase 6: Creare un Monitor Email In Entrata

1. Accedere al proprio Dashboard OneUptime
2. Navigare a **Monitor** > **Crea Monitor**
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

| Variabile | Descrizione | Obbligatorio | Predefinito |
|----------|-------------|----------|---------|
| `INBOUND_EMAIL_PROVIDER` | Il provider di email in entrata da usare | Sì | - |
| `INBOUND_EMAIL_DOMAIN` | Il sottodominio configurato per le email in entrata | Sì | - |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Segreto per validare le richieste webhook. Quando impostato, aggiungere questo segreto all'URL webhook: `/incoming-email/sendgrid/VOSTRO_SEGRETO` | No | - |

## Criteri Email Supportati

Quando si configura il proprio Monitor Email In Entrata, è possibile creare criteri basati su:

| Campo | Descrizione | Filtri Disponibili |
|-------|-------------|-------------------|
| **Oggetto Email** | La riga dell'oggetto dell'email | Contiene, Non Contiene, Uguale a, Diverso da, Inizia Con, Termina Con, È Vuoto, Non È Vuoto |
| **Email Da** | L'indirizzo email del mittente | Contiene, Non Contiene, Uguale a, Diverso da, Inizia Con, Termina Con, È Vuoto, Non È Vuoto |
| **Corpo Email** | Il corpo testuale dell'email | Contiene, Non Contiene, Uguale a, Diverso da, Inizia Con, Termina Con, È Vuoto, Non È Vuoto |
| **Email A** | L'indirizzo email del destinatario | Contiene, Non Contiene, Uguale a, Diverso da, Inizia Con, Termina Con, È Vuoto, Non È Vuoto |
| **Email Ricevuta** | Tempo dall'ultima email ricevuta | Ricevuta In Minuti, Non Ricevuta In Minuti |

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
   - Cercare le richieste webhook nei log del servizio ProbeIngest
   - Verificare eventuali messaggi di errore

### Webhook Falliti

1. **Assicurarsi che OneUptime sia accessibile pubblicamente:**
   - L'URL del webhook deve essere raggiungibile da Internet
   - Testare con: `curl -X POST https://vostro-dominio-oneuptime.com/incoming-email/sendgrid`

2. **Controllare le regole del firewall:**
   - Consentire il traffico HTTPS in entrata dagli intervalli IP di SendGrid

3. **Verificare il certificato SSL:**
   - SendGrid richiede un certificato SSL valido
   - I certificati autofirmati potrebbero causare problemi

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

| Provider | Stato |
|----------|--------|
| SendGrid | Supportato |
| Haraka (Self-hosted) | Pianificato |

Se si necessita del supporto per un provider diverso, contattarci o inviare una richiesta di funzionalità.

## Supporto

In caso di problemi con l'integrazione SendGrid Email In Entrata:

1. Controllare la sezione di risoluzione dei problemi sopra
2. Esaminare i log di OneUptime per messaggi di errore dettagliati
3. Contattarci all'indirizzo [hello@oneuptime.com](mailto:hello@oneuptime.com)

Accogliamo con piacere i feedback per migliorare questa integrazione!
