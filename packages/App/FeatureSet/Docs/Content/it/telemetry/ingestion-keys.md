# Chiavi di acquisizione

Una chiave di acquisizione collega la vostra telemetria al vostro progetto. Applicazioni, OpenTelemetry Collector e agenti la inviano con ogni richiesta, e OneUptime archivia i loro log, tracce e metriche nel progetto a cui la chiave appartiene. Questa pagina mostra come creare una chiave, quale tipo scegliere e come tenere al sicuro le chiavi.

:::cards
- [Creare una chiave di acquisizione](#creare-una-chiave-di-acquisizione): Un nome, un tipo e un segreto da copiare.
- [Server o Browser](#server-o-browser): Il tipo di chiave che serve a un mittente.
- [Proteggere una chiave Browser](#proteggere-una-chiave-browser): Origini, un solo nome di servizio e un limite.
- [Ruotare, disattivare o eliminare una chiave](#ruotare-disattivare-o-eliminare-una-chiave): Cosa fare quando una chiave trapela.
:::

## Come viene verificata una chiave

Ogni richiesta porta il segreto della chiave, di solito in un'intestazione `x-oneuptime-token`. OneUptime cerca la chiave, verifica che possa ancora inviare e solo allora accetta i dati nel progetto della chiave.

```mermaid title="Che cosa verifica OneUptime prima di accettare la telemetria"
flowchart TB
    request["Una richiesta con<br/>x-oneuptime-token"] --> known{"Nota, abilitata,<br/>non scaduta?"}
    known -->|"Sì"| origin{"Origine consentita,<br/>per una chiave<br/>Browser?"}
    origin -->|"Sì"| limit{"Sotto il suo limite?"}
    limit -->|"Sì"| accepted["Accettata nel<br/>progetto della chiave"]
    known -->|"No"| refused["Rifiutata, con uno<br/>stato che dice<br/>il perché"]
    origin -->|"No"| refused
    limit -->|"No"| refused
```

- **La chiave decide il progetto.** Non inviate mai un ID di progetto: i dati inviati con una chiave finiscono nel progetto a cui la chiave appartiene.
- **Le modifiche raggiungono ogni server entro un minuto.** Disattivare una chiave, reimpostarne il segreto o cambiarne le origini, la scadenza o il limite ha effetto entro un minuto circa.
- **Una chiave Server è una password.** Chiunque la possieda può inviare telemetria nel vostro progetto. Conservatela tra i segreti dei vostri server, mai nel controllo di versione né in una pagina web.

## Server o Browser

Scegliete il tipo in base a dove vivrà la chiave. Il tipo non si può cambiare dopo la creazione della chiave.

| | **Server** | **Browser** |
| --- | --- | --- |
| Per | Applicazioni, collector e agenti su macchine che gestite | Pagine web, e React Native Session Replay |
| Invia | Ogni tipo di telemetria, a ogni endpoint | Tracce, log, metriche e Session Replay |
| È un segreto | Sì: tenetela sui vostri server | No: chiunque visualizzi la pagina può leggerla |
| Origini | Non verificate | Sono accettate solo le origini elencate |
| Richieste al minuto | Nessun limite, a meno che non ne impostiate uno | 6.000, a meno che non impostiate un altro limite |

Ovunque altrove OneUptime rifiuta una chiave Browser, ad esempio su gRPC e MQTT, per i profili, Syslog, Fluent Bit e Fluentd, e per il caricamento delle source map. Per passare un mittente all'altro tipo, create una chiave di quel tipo, spostate il mittente su di essa, poi eliminate la vecchia chiave.

## Prima di iniziare

- **Un ruolo che gestisce le chiavi di acquisizione.** Project Owner o Project Admin, oppure un ruolo personalizzato con il permesso Create Telemetry Ingestion Key. I ruoli Telemetry non includono le chiavi di acquisizione.
- **Su OneUptime Cloud, un metodo di pagamento.** La telemetria si paga in base all'uso, quindi un progetto sul piano Free ha bisogno di un metodo di pagamento prima di poter creare una chiave. La finestra di creazione termina allora con un passaggio **Fatturazione** che mostra i prezzi.

## Creare una chiave di acquisizione

:::steps
### Aprire le chiavi di acquisizione

Andate in **Impostazioni del progetto → Telemetria e APM → Chiavi di acquisizione**. **Telemetria e APM** parte compresso nel menu laterale: fateci clic per aprirlo. L'elenco mostra di ogni chiave le colonne **Nome**, **Tipo**, **Last Used** e **Descrizione**.

### Dare un nome alla chiave e sceglierne il tipo

Fate clic su **Crea chiave di ingestione**. La finestra parte con il nome **Chiave server** e il tipo **Server**. Scegliete il **Tipo di chiave** e rinominate la chiave in base a chi la userà, ad esempio `checkout-collector`. Una **Descrizione** si trova in **Avanzato**.

### Aggiungere le origini di una chiave Browser

Una chiave **Browser** chiede le sue **Origini consentite** al passaggio successivo, **Impostazioni del browser**, con il suo **Nome del servizio fissato** in **Avanzato**. Vedete [Proteggere una chiave Browser](#proteggere-una-chiave-browser).

### Creare la chiave e copiarne il segreto

Fate clic su **Crea chiave di ingestione**. Si apre la pagina della chiave: copiate la sua **Chiave segreta** e datela ai vostri mittenti.
:::

La **Guida alla configurazione** di ogni prodotto inizia con **Scegli una chiave di ingestione**, che elenca le chiavi che quella guida può usare e ne crea una sul posto. Gli snippet della guida contengono poi quella chiave.

## Inviare telemetria con la chiave

I mittenti mettono il segreto in un'intestazione `x-oneuptime-token`:

```text
x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_KEY
```

- Gli SDK OpenTelemetry la leggono da `OTEL_EXPORTER_OTLP_HEADERS`. Vedete la [guida rapida di OpenTelemetry](/docs/telemetry/open-telemetry#avvio-rapido).
- Su OTLP/gRPC, va nei metadati `x-oneuptime-token`.
- Un dispositivo MQTT la invia come password. Vedete [Dispositivi IoT](/docs/telemetry/iot-devices).
- OneUptime legge la chiave anche da un'intestazione `x-oneuptime-ingestion-key` o `x-oneuptime-service-token`, che alcune configurazioni più vecchie inviano.

## Proteggere una chiave Browser

Una chiave Browser sta nella vostra pagina, dove chiunque può copiarla. Queste impostazioni limitano ciò che una copia può fare. Cambiatele nella pagina della chiave con **Modifica: Telemetria Ingestione Key**.

| Impostazione | Che cosa fa |
| --- | --- |
| **Origini consentite** | Le sole origini da cui la chiave è accettata. Una richiesta da qualsiasi altra origine, o senza alcuna intestazione `Origin`, viene rifiutata. Una chiave Browser deve conservarne almeno una. |
| **Nome del servizio fissato** | Archivia tutto ciò che la chiave invia su OTLP/HTTP sotto quest'unico servizio, qualunque `service.name` abbia impostato il mittente. Una copia della chiave può allora scrivere solo in quel servizio. |
| **Requests Per Minute Limit** | Il numero massimo di richieste per cui la chiave è accettata ogni minuto, condiviso da tutti i visitatori. Una chiave Browser ne riceve 6.000 se lasciate il campo vuoto. |
| **Scade il** | La data dopo la quale la chiave viene rifiutata, così una copia pubblicata smette di funzionare. |

Un'origine è uno schema, un host e una porta facoltativa: `https://app.example.com` non copre `https://app.example.com:8443`. Un `*.` iniziale copre ogni sottodominio, ma non il dominio stesso. React Native Session Replay invia un'identità `app://` esatta, che non accetta caratteri jolly:

```json
[
  "https://app.example.com",
  "https://*.example.com",
  "app://com.example.mobile"
]
```

Il [Catalogo servizi](/docs/telemetry/services#come-un-servizio-entra-nel-catalogo) mostra come un nome fissato decide il servizio. Il Runner e l'agente IA dell'agent Kubernetes, e gli agenti IA dell'infrastruttura, non si registrano con una chiave fissata: date loro una chiave Server senza nome fissato.

## Ruotare, disattivare o eliminare una chiave

La pagina di una chiave mostra il suo **Stato**, la sua **Chiave segreta** dietro **Click to reveal**, e il suo **Last Used At**: l'ultima volta che OneUptime ha accettato dati inviati con essa.

| Per | Fate questo | Che cosa vedono i mittenti |
| --- | --- | --- |
| Fermare subito una chiave, potendo annullare in seguito | Fate clic su **Modifica: Telemetria Ingestione Key**, aprite **Accesso e limiti** e disattivate **Abilitato**. Lo stato indica **Disabled — telemetry refused**. | `422` finché non la riattivate |
| Sostituire un segreto trapelato | Fate clic su **Reimposta la chiave segreta** e confermate. La chiave mantiene le sue impostazioni e riceve un nuovo segreto. | `401` finché non inviano il nuovo segreto |
| Fermare una chiave per sempre | Fate clic su **Elimina: Telemetria Ingestione Key** in fondo alla sua pagina. | `401` |

Per cambiare un segreto senza perdere dati, create una seconda chiave, spostate i mittenti su di essa ed eliminate la vecchia chiave quando il suo **Last Used At** smette di muoversi. **Last Used At** si aggiorna ogni pochi minuti, non a ogni richiesta.

## Risoluzione dei problemi

Una richiesta rifiutata riceve uno stato e una frase che dice il perché.

| Risposta | Che cosa significa |
| --- | --- |
| `401` con `Missing ingestion token` | La richiesta non ha una chiave. Inviatela in `x-oneuptime-token`. |
| `401` con `Invalid ingestion token` | Nessuna chiave ha questo segreto: è stato digitato male, reimpostato o eliminato. |
| `401` con `This telemetry ingestion key expired.` | La sua data **Scade il** è passata. Impostate una data successiva, o usate un'altra chiave. |
| `402` con `Add a payment method` | Su OneUptime Cloud, il progetto è sul piano Free e non ha ancora un metodo di pagamento. |
| `422` con `This telemetry ingestion key has been disabled.` | Qualcuno ha disattivato **Abilitato**. |
| `422` con `A browser ingestion key cannot be used for` | Una chiave Browser ha raggiunto un endpoint che accetta solo chiavi Server. |
| `422` con `did not send an Origin header` | Una chiave Browser è stata inviata da fuori un browser. Lì usate una chiave Server. |
| `422` con `is not allowed for this browser ingestion key` | L'origine della pagina non è in **Origini consentite**. |
| `422` con `is pinned to a single service` | Una chiave con un **Nome del servizio fissato** è stata usata per registrare un agente. Usate una chiave Server senza nome fissato. |
| `429` con `Too many telemetry requests for this ingestion key` | La chiave ha raggiunto il suo **Requests Per Minute Limit**. Gli esportatori riprovano dopo il tempo indicato da `Retry-After`. |

Per le altre risposte che un esportatore OTLP può ricevere, vedete [Risposte](/docs/telemetry/open-telemetry#risposte).

:::details I dati arrivano ancora un minuto dopo che ho disattivato la chiave
Ogni server OneUptime conserva ciò che sa di una chiave per al massimo un minuto, quindi una modifica li raggiunge tutti entro un minuto circa. Le richieste successive vengono rifiutate.
:::

:::details Una chiave Browser funziona sul mio portatile ma non in produzione
Un'origine include il suo schema e la sua porta. `http://localhost:3000` e `https://app.example.com` sono origini diverse: elencate ognuna di quelle da cui la pagina viene servita.
:::

:::details Last Used At indica ancora Mai
Nulla ha inviato dati con questa chiave da quando OneUptime ha iniziato a registrarne l'uso. Verificate che i vostri mittenti abbiano il segreto di questa chiave e che le loro richieste raggiungano OneUptime.
:::

## Passaggi successivi

:::cards
- [OpenTelemetry](/docs/telemetry/open-telemetry): Inviate tracce, metriche e log con la vostra chiave.
- [Catalogo servizi](/docs/telemetry/services): Vedete i servizi sotto cui è archiviata la vostra telemetria.
- [Conservazione dei dati](/docs/telemetry/data-retention): Decidete per quanto tempo vengono conservati i dati.
- [Filtri di scarto e regole di mascheramento](/docs/telemetry/drop-filters-and-scrub-rules): Scartate o mascherate i dati prima che vengano salvati.
:::
