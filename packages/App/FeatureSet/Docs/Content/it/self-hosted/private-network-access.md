# Accesso alla rete privata

OneUptime rifiuta di inviare certe richieste in uscita a host che si risolvono in un intervallo privato, di loopback o link-local. Se hai provato a puntare un workflow verso uno strumento interno, hai visto il messaggio:

> Webhook URL resolves to a private, loopback, or link-local address and is not allowed

Questo comportamento predefinito è corretto per il prodotto ospitato, dove chiunque può registrarsi e la destinazione di un webhook è un input non attendibile. Su un'istanza self-hosted però ostacola una cosa ordinaria: inviare un avviso a un Mattermost, un Jira o un sistema di ticketing self-hosted che esiste solo nella tua rete.

Questa pagina spiega come consentirlo, in modo deliberato e circoscritto. Lo decidono tre interruttori, ciascuno per il proprio tipo di connessione, e si configurano su macchine diverse:

| Che cosa vuoi raggiungere internamente | Dove si trova l'impostazione | Predefinito su un'installazione self-hosted |
| --- | --- | --- |
| Workflow, webhook di progetto, webhook utente della reperibilità | L'ambiente del **server API** | Indirizzi privati rifiutati |
| Sorgenti dati, provider di LLM, server SMTP, discovery OIDC e altre connessioni | L'ambiente del **server API** | Indirizzi privati consentiti |
| **Monitor** API, Website, External Status Page e Custom JavaScript Code | L'ambiente proprio della **sonda** | Indirizzi privati rifiutati |

```mermaid title="Tre interruttori, ciascuno per il proprio tipo di connessione"
flowchart TB
    subgraph Server["Il server OneUptime"]
        direction TB
        Webhooks["Workflow e webhook"]
        Outbound["Sorgenti dati, provider di LLM,<br/>SMTP e altre connessioni"]
    end
    subgraph Probe["Ogni sonda"]
        Monitors["Monitor API, Website,<br/>External Status Page e<br/>Custom JavaScript Code"]
    end
    Private["La tua rete privata"]
    Webhooks -->|"disattivato per impostazione predefinita"| Private
    Outbound -->|"attivo per impostazione predefinita"| Private
    Monitors -->|"disattivato per impostazione predefinita"| Private
```

I tipi di monitor nativi di rete, come Ping, Port, Certificato SSL, DNS, DNSSEC, SNMP / Dispositivo di rete, Query SQL, Salute del database, Synthetic e Network Path, usano i propri trasporti. L'impostazione di questa pagina regola i trasporti HTTP che restituiscono a un progetto contenuti di risposta arbitrari: i monitor API, Website, External Status Page e Custom JavaScript Code.

:::cards
- [Webhook e workflow](#webhook-e-workflow): Consenti a un webhook di pubblicare nella tua rete.
- [Altre connessioni in uscita](#altre-connessioni-in-uscita): Sorgenti dati, provider di LLM e server di posta.
- [Sonde e monitor](#sonde-e-monitor): Lascia che una sonda controlli siti privati.
- [Verificare che funzioni](#verificare-che-funzioni): Leggi quale interruttore nomina un rifiuto.
:::

## Che cosa è bloccato e che cosa si può sbloccare

Le destinazioni bloccate si dividono in due livelli.

| Livello | Intervalli | Si può consentire? |
| --- | --- | --- |
| **Privato** | RFC-1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), CGNAT (`100.64.0.0/10`), IPv6 unique-local (`fc00::/7`) e site-local (`fec0::/10`) | Sì |
| **Vietato** | Loopback (`127.0.0.0/8`, `::1`), l'indirizzo non specificato, link-local (`169.254.0.0/16`, `fe80::/10`), multicast, riservato, broadcast, e i nomi `localhost` e `metadata.google.internal` | Solo nominando l'host o il CIDR esatto nella allowlist dei webhook. Mai per i monitor. |

L'endpoint dei metadati del cloud `169.254.169.254` si trova nel livello vietato per un motivo. Su una VM cloud consegna le credenziali IAM dell'istanza a qualsiasi cosa possa fare una richiesta HTTP dalla macchina, quindi nessuna impostazione generale lo aprirà mai.

Le scritture IPv6 che contengono una destinazione IPv4 – IPv4-mapped (`::ffff:10.0.0.5`), NAT64, 6to4, Teredo – vengono classificate in base all'indirizzo IPv4 che raggiungono, quindi non si possono usare per far passare un indirizzo vietato attraverso un'autorizzazione del livello privato.

## Webhook e workflow

Queste destinazioni sono coperte, perché la destinazione è un URL scritto da un membro autenticato del tuo progetto:

- I componenti **API** dei workflow (GET / POST / PUT / PATCH / DELETE)
- Le richieste HTTP effettuate dal componente di workflow **Custom JavaScript**
- Le notifiche webhook del progetto (incidenti, avvisi, monitor, reperibilità, manutenzione programmata, eventi delle pagine di stato)
- I **webhook utente** della reperibilità

**Non** sono coperti, e non lo saranno mai: i **webhook degli iscritti alle pagine di stato**. Qualsiasi visitatore di una pagina di stato pubblica può registrarne uno, quindi allentare questa destinazione permetterebbe a chiunque su internet di far inviare al tuo server delle POST nella tua rete privata. Non è configurabile.

Le connessioni in uscita che non sono webhook – sorgenti dati esterne, provider di LLM, server SMTP (le impostazioni SMTP di un progetto e il componente di workflow **Email**), endpoint dei token OAuth SMTP, discovery OIDC e passaggi HTTP dei runbook – sono regolate separatamente, da `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES`, e consentono già gli intervalli privati sulle installazioni self-hosted. Vedi [Altre connessioni in uscita](#altre-connessioni-in-uscita).

### Configurare il server API

Imposta una o entrambe queste variabili sul server API e riavvialo. Sono disattivate per impostazione predefinita, quindi un'istanza che non ne imposta nessuna si comporta esattamente come prima.

| Variabile | Valore Helm | Che cosa consente |
| --- | --- | --- |
| `ALLOW_PRIVATE_NETWORK_WEBHOOKS` | `webhooks.allowPrivateNetwork` | L'intero livello privato, quando vale `true`. |
| `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | `webhooks.privateNetworkAllowlist` | Gli host e i CIDR che nomina, qualunque sia il loro livello. |

:::tabs
@tab Docker Compose
```bash title="config.env"
ALLOW_PRIVATE_NETWORK_WEBHOOKS=true
PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=mattermost.internal,*.svc.cluster.local,10.20.0.0/16
```
@tab Kubernetes
```yaml title="values.yaml"
webhooks:
  allowPrivateNetwork: true
  privateNetworkAllowlist: "mattermost.internal,10.20.0.0/16"
```
:::

Con Docker Compose, `config.env` ha una riga `ALLOW_PRIVATE_NETWORK_WEBHOOKS=false`: modificala invece di aggiungerne una seconda, poi esegui `npm run start`. Su Kubernetes, aggiorna la release.

Le voci della allowlist possono essere separate da virgole, spazi o a capo, e ciascuna può essere:

- un nome host – `mattermost.internal`
- un carattere jolly – `*.svc.cluster.local` (corrisponde ai sottodomini, non al suffisso da solo)
- un indirizzo IPv4 o IPv6 – `10.20.30.40`, `fd00::1`
- un CIDR – `10.20.0.0/16`, `fd12:3456::/32`

Schema, porta, percorso o informazioni utente di una voce vengono rimossi, quindi incollare l'URL del webhook che hai già funziona.

Un nome host indicato nella allowlist è considerato attendibile **senza controllo DNS**: è proprio per questo che lo si nomina, dato che ci si aspetta che si risolva in qualcosa che la blocklist rifiuterebbe. Una voce di indirizzo viene confrontata con il letterale nell'URL e con ogni indirizzo che il DNS restituisce per esso.

> [!CAUTION]
> **Non inserire mai `169.254.169.254`, né alcun intervallo che lo contenga, nella allowlist.** Su una VM cloud, questo dà a ogni membro del progetto le credenziali IAM della tua istanza.

## Altre connessioni in uscita

Una seconda protezione copre le connessioni in uscita la cui destinazione è scelta da un membro del progetto ma che non sono webhook:

- sorgenti dati esterne (connessioni PostgreSQL, MySQL, SQL Server, ClickHouse, Elasticsearch e API REST), connessioni di eventi di sicurezza come Splunk e feed di threat intel
- provider di LLM, compreso un Ollama o vLLM self-hosted
- server SMTP – le impostazioni SMTP di un progetto e il componente di workflow **Email** – e gli URL dei token OAuth di SMTP e dei workflow
- la discovery OIDC per il single sign-on
- la verifica dei domini personalizzati di pagine di stato e dashboard
- i passaggi HTTP dei runbook
- l'URL dell'API di Grafana OnCall da cui legge un'importazione (**Impostazioni del progetto** > **Base** > **Importa da un altro strumento**)

Questa protezione funziona al contrario rispetto alle impostazioni dei webhook. Su un'installazione self-hosted **consente** il livello privato per impostazione predefinita, perché il database, il server di posta o il server dei modelli a cui si collegano di solito si trovano nella tua rete. Il livello vietato – loopback, link-local e l'endpoint dei metadati del cloud – viene rifiutato in ogni caso, e non esiste una allowlist per esso.

`DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` la rende più restrittiva. Impostala su `true` per rifiutare il livello privato anche per queste connessioni, per esempio quando i progetti della tua istanza appartengono a persone che non dovrebbero raggiungere la tua rete interna:

:::tabs
@tab Docker Compose
```bash title="config.env"
DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true
```
@tab Kubernetes
```yaml title="values.yaml"
outboundConnections:
  blockPrivateNetwork: true
```
:::

Questa impostazione non si applica a un provider di LLM globale, che configura un amministratore invece di un progetto (con le variabili `GLOBAL_LLM_PROVIDER_*`, il valore `vllm.globalProvider` del chart Helm, oppure nel Pannello amministratore in **Impostazioni** > **Fornitori LLM globali**): un provider del genere può comunque raggiungere indirizzi privati, anche se loopback e link-local restano rifiutati anche per lui.

Solo il valore esatto `true` la attiva. Su un'istanza con `BILLING_ENABLED=true` è sempre attiva, qualunque cosa imposti. Non cambia quali destinazioni consentono le impostazioni dei webhook sopra o l'impostazione delle sonde sotto; ogni barriera si configura per conto suo. Cambia invece come vengono formulati i rifiuti, anche per webhook e richieste dei workflow: se è attiva, un nome host rifiutato viene segnalato senza dire in che cosa si è risolto (vedi [Verificare che funzioni](#verificare-che-funzioni)).

Con Docker Compose, `config.env` ha una riga `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=false` (aggiungila se il tuo `config.env` è precedente). Cambia quella riga in `true` invece di aggiungerne una seconda, poi esegui `npm run start` perché i container vengano ricreati con il nuovo valore; `docker compose restart` non rilegge `config.env`. Su Kubernetes, impostala nel file dei valori e aggiorna la release; il chart la passa ai pod dell'applicazione e del worker.

Se è attiva, un nome host rifiutato viene segnalato senza dire in che cosa si è risolto, per esempio _"LLM provider host ollama.internal could not be reached."_ Un nome che non si risolve affatto riceve lo stesso messaggio, così i membri del progetto non possono usare questi campi per scoprire quali nomi interni esistono. Un indirizzo scritto come IP viene comunque nominato insieme al motivo, per esempio _"LLM provider host 10.0.4.12 is not allowed: private network address."_ Con `LOG_LEVEL=DEBUG`, l'applicazione registra l'indirizzo in cui si è risolto ogni nome rifiutato.

## Sonde e monitor

Sono interessati quattro tipi di monitor: **API**, **Sito web**, **External Status Page** e **Custom JavaScript Code**. Su una sonda standard possono raggiungere destinazioni HTTP(S) pubbliche, ma rifiutano lo spazio di indirizzi privato. I monitor API, Website ed External Status Page convalidano e fissano i risultati DNS per ogni connessione e riconvalidano ogni reindirizzamento; Custom JavaScript Code applica la stessa politica sugli indirizzi nel ponte della sua sandbox.

L'interruttore viene letto dal **processo della sonda nel proprio ambiente**, non in quello del server API, e ogni sonda lo legge: quelle incluse con Docker Compose, quelle distribuite dal chart Helm e qualsiasi [sonda personalizzata](/docs/probe/custom-probe) che esegui tu. Chi distribuisce una sonda ne controlla l'ambiente ed è chi sa quale rete quella sonda può vedere: una sonda personalizzata di solito è un'altra macchina, spesso gestita da un'altra persona, e non legge mai la configurazione del server API.

:::tabs
@tab Docker Compose
`config.env` ha già una riga `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=false`: cambia quella riga in `true` invece di aggiungerne una seconda, perché quando una variabile compare due volte vince la riga successiva. Poi esegui `npm run start`, che ricrea i container con il nuovo valore; `docker compose restart` non rilegge `config.env`. Ogni sonda inclusa legge quella stessa riga, quindi vale per `probe-1` e, dove il tuo stack esegue una seconda sonda, per `probe-2`.

```bash title="config.env"
PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true
```
@tab Kubernetes
Impostala per ogni sonda nel file dei valori e aggiorna la release. Ogni voce sotto `probes:` è una sonda separata, quindi impostala su ognuna di quelle che devono raggiungere indirizzi privati:

```yaml title="values.yaml"
probes:
  one:
    allowPrivateNetworkMonitors: true
```
:::

Su una sonda personalizzata, imposta `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` nell'ambiente proprio di quella sonda e riavviala. Il valore deve essere esattamente `true`; qualsiasi altro, come `TRUE` o `1`, lascia l'interruttore disattivato, e la sonda lo segnala con un avviso all'avvio, qualunque sia il valore di `LOG_LEVEL`.

Le sonde incluse sono **sonde globali**: si registrano con il `REGISTER_PROBE_KEY` dell'istanza, e ogni progetto dell'istanza può selezionarle. Attivare l'interruttore su una sonda inclusa permette quindi ai monitor di **ogni progetto dell'istanza** di raggiungere indirizzi privati attraverso di essa. Di solito è ciò che vuole un'installazione per un solo team. Dove i progetti non devono condividere questa portata – team separati o clienti che ospiti –, lascialo disattivato sulle sonde incluse e distribuisci invece una sonda privata (personalizzata) dentro ogni rete, attivata solo lì.

C'è un'eccezione. Una sonda che si registra con `REGISTER_PROBE_KEY` e ha `BILLING_ENABLED=true` nel proprio ambiente – una sonda globale del prodotto ospitato con registrazione aperta, dove chiunque può registrarsi e tutti i progetti condividono le sonde globali – resta solo pubblica anche con l'interruttore attivo, e registra all'avvio un avviso che non ne tiene conto. Le sonde incluse con Docker Compose e il chart Helm ricevono automaticamente il `BILLING_ENABLED` dell'istanza; dallo a qualsiasi altra sonda `REGISTER_PROBE_KEY` che esegui per un'istanza del genere. Una sonda non può sapere in nessun altro modo di essere globale, quindi una sonda globale creata nel Pannello amministratore ed eseguita con `PROBE_ID` e `PROBE_KEY` rispetta l'interruttore come una privata: non attivarlo lì se i progetti non devono condividere la rete di quella sonda. Una sonda privata rispetta l'interruttore su qualsiasi istanza.

Ogni sonda registra all'avvio la propria politica effettiva sulla rete privata: se il monitoraggio della rete privata è attivo o disattivato, e perché. Un valore di cui non si tiene conto, e una sonda globale che l'interruttore apre a ogni progetto, vengono registrati come avvisi a qualsiasi `LOG_LEVEL`. La normale riga attivo o disattivato, e il JSON «Probe environment» che registra la stessa decisione sotto `privateNetworkMonitors`, vengono registrati a `LOG_LEVEL=INFO`, il valore predefinito del chart Helm; Docker Compose viene distribuito con `LOG_LEVEL=ERROR`, quindi imposta `LOG_LEVEL=INFO` per vederli lì. Controlla prima quel log quando un monitor su una sonda che hai appena modificato viene ancora rifiutato.

Attivarlo **non** apre loopback, link-local né l'endpoint dei metadati del cloud. Questi restano rifiutati su ogni sonda, il che conta soprattutto per le sonde eseguite in una rete che non appartiene all'autore del monitor.

> [!WARNING]
> Lascialo disattivato sulle sonde che gestisci per conto di altre persone.

## Verificare che funzioni

Esegui di nuovo il workflow o il monitor. Se viene ancora rifiutato, il messaggio di errore nomina quale barriera è chiusa:

- _"...points to a private network address and is not allowed. Self-hosted instances can allow this by setting `ALLOW_PRIVATE_NETWORK_WEBHOOKS`..."_ – manca l'impostazione del server API.
- _"...private network address... Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it."_ – una sonda privata (personalizzata) ha eseguito il monitor, e il suo interruttore è disattivato. Nota che si imposta sulla sonda, non sul server API.
- _"...private network address... Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it (probes.<name>.allowPrivateNetworkMonitors in the Helm chart). This is a global probe, so that allows it for every project on this instance; otherwise, select a private probe deployed on that network."_ – una sonda inclusa (globale) ha eseguito il monitor, e il suo interruttore è disattivato. Attivalo per quella sonda come descritto sopra se ogni progetto dell'istanza può raggiungere quella rete; altrimenti seleziona una sonda privata sul monitor.
- _"...Global probes cannot monitor private network addresses. Deploy and select a private probe for this target."_ – una sonda globale con `BILLING_ENABLED=true` nel proprio ambiente ha eseguito il monitor. Le sonde globali registrate automaticamente restano lì solo pubbliche, qualunque cosa dica il loro interruttore; distribuisci una sonda privata dentro la rete della destinazione e selezionala sul monitor.
- _"Monitor target host ... could not be reached."_ – un monitor API, Website o External Status Page la cui destinazione è un **nome host** lo segnala sia quando il nome si risolve in un indirizzo rifiutato sia quando il DNS fallisce, così un monitor non può essere usato per mappare quali nomi interni esistono. I dettagli dell'errore mostrati con esso citano `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` in entrambi i casi; non dicono quale si è verificato. Se il nome punta a un indirizzo privato, controlla nel log di avvio della sonda la sua politica sulla rete privata; se è disattivata, la soluzione è la stessa dei messaggi sopra. Con `LOG_LEVEL=DEBUG`, la sonda registra anche il motivo esatto di ogni nome rifiutato.
- _"Request URL could not be reached."_ – la stessa regola per un monitor **Custom JavaScript Code**: uno script che richiede un **nome host** riceve questo messaggio sia quando il nome si risolve in un indirizzo rifiutato sia quando il DNS fallisce. Con `LOG_LEVEL=DEBUG`, la sonda registra il motivo esatto.
- _"Webhook URL could not be reached."_ oppure, da un workflow, _"Request URL could not be reached."_ – l'istanza gira con `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (o `BILLING_ENABLED=true`), quindi un **nome host** rifiutato non viene spiegato: o si è risolto in un indirizzo rifiutato o non si è risolto affatto. Con `LOG_LEVEL=DEBUG`, l'applicazione o il worker registrano quale dei due, e l'indirizzo.
- _"...points to a private, loopback, or link-local address and is not allowed."_ – la destinazione è nel livello vietato. Per un webhook, nomina l'host o il CIDR esatto in `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` se ne hai davvero bisogno. Per un monitor non c'è deroga.
- _"...hostname could not be resolved via DNS."_ – il container non riesce a risolvere il nome. Verifica che condivida una rete con la destinazione.

## Note sulla sicurezza

Aprire questo accesso cambia davvero ciò che la tua istanza OneUptime può essere indotta a raggiungere, quindi vale la pena farlo in modo deliberato:

- **Preferisci la allowlist all'interruttore generale.** Nominare `mattermost.internal` è un'autorizzazione molto più piccola che aprire ogni indirizzo RFC-1918.
- **Chiunque possa creare un workflow o un monitor API, Website, External Status Page o Custom JavaScript Code può raggiungere tutto ciò che hai consentito.** Tratta di conseguenza l'appartenenza a quei progetti.
- **Il corpo della risposta torna indietro.** Un componente API di un workflow restituisce lo stato, le intestazioni e il corpo nel log del workflow, quindi un host consentito è leggibile, non solo scrivibile.
- **I reindirizzamenti non vengono mai seguiti** nelle richieste dei webhook, quindi un host pubblico consentito non può rimbalzare il server su uno interno con un secondo salto.
- **Limita per sonda anziché a livello di istanza quando puoi.** Una sonda distribuita dentro una rete è un'autorizzazione più ristretta che aprire il traffico in uscita del server API.

## Passaggi successivi

:::cards
- [Sonde personalizzate](/docs/probe/custom-probe): Esegui una sonda dentro la rete che deve controllare.
- [Configurazione dei workflow](/docs/workflows/configuration): Che cosa possono raggiungere e fare i passaggi di un workflow.
- [Provider di LLM](/docs/ai/llm-provider): Collega OneUptime AI a un modello nella tua rete.
- [Architettura](/docs/self-hosted/architecture): Quale parte di un'installazione self-hosted effettua ciascuna connessione.
:::
