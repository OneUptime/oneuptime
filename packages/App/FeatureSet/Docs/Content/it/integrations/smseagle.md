# Integrazione con SMSEagle

Invia le notifiche degli avvisi come SMS o chiamate tramite [SMSEagle](https://www.smseagle.eu), un gateway SMS hardware installato in sede, nella tua rete. OneUptime ha componenti dei flussi di lavoro **SMSEagle** integrati, quindi la configurazione è rapida.

Questa integrazione è **in uscita**: OneUptime invia i messaggi tramite la [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/).

```text
Avviso OneUptime → On Create  ──►  componente SMSEagle  ──►  SMS o chiamata a un telefono
```

## Passo 1: Crea una chiave API

1. Nella GUI web di SMSEagle, vai su **Settings → API → API v2** e fai clic su **Create API key**.
2. In **Permissions**, consenti **Send SMS** e, se vuoi le chiamate, **Make a TTS Advanced Call**.
3. Copia la chiave. OneUptime la chiama **SMSEagle Access Token**.

## Passo 2: Fai raggiungere il dispositivo a OneUptime

1. Consenti la connessione dal tuo server OneUptime all'indirizzo del dispositivo, ad esempio `https://192.168.0.100`, nei firewall e nelle VPN tra i due.
2. Un dispositivo SMSEagle di solito ha un indirizzo privato, che i flussi di lavoro bloccano per impostazione predefinita. In un'istanza self-hosted, aggiungi l'indirizzo IP o il nome host del dispositivo a `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` sul server API, ad esempio `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, e riavvialo. Vedi [Accesso alle reti private](/docs/self-hosted/private-network-access).

## Passo 3: Salva i segreti

1. In OneUptime, vai su **Flussi di lavoro → Variabili globali → Crea**.
2. Crea `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (segreta) e `ONCALL_PHONE`.

## Passo 4: Costruisci il flusso di lavoro

1. Apri **Flussi di lavoro → Crea flusso di lavoro**, chiamalo `Alerts → SMSEagle` e apri il **Costruttore**.
2. Aggiungi un trigger **Alert** impostato su **On Create**. Rinominalo `Alert`.
3. Aggiungi un componente **Send SMS via SMSEagle** collegato al trigger:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. Fai clic su **Salva**, attivalo e crea un avviso di prova. L'SMS arriva sul telefono.

Il modello **Text a phone via SMSEagle when an alert fires** costruisce lo stesso flusso di lavoro.

## Chiamate invece di SMS

Usa invece **Make a Call via SMSEagle**. Ha le stesse impostazioni più un **Voice ID**, la voce di sintesi vocale del dispositivo, e legge ad alta voce il **Text to Read Out**. La chiave API ha bisogno del permesso **Make a TTS Advanced Call**.

Il modello **Call a phone via SMSEagle when an alert fires** costruisce lo stesso flusso di lavoro con una chiamata.

## Alternativa: il componente API

Funziona anche un blocco **API**:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## Suggerimenti

- Se il dispositivo rifiuta il messaggio, il motivo è nel valore **Error** del componente. Registralo sull'uscita **Errore**.
- Usa **Condizioni** per filtrare per gravità prima dell'invio.
- Per raggiungere più persone, collega più componenti SMSEagle, uno per numero.

## Cosa leggere dopo

- [Panoramica delle integrazioni](/docs/integrations/index): lo schema in uscita.
- [Componenti → SMSEagle](/docs/workflows/components#smseagle): il riferimento del componente.
