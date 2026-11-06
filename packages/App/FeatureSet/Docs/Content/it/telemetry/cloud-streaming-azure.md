# Trasmettere metriche e log di Azure Monitor

Una sottoscrizione Azure connessa può trasmettere a OneUptime le sue metriche di Azure Monitor e i log delle risorse. Le impostazioni di diagnostica li inviano a hub eventi della tua sottoscrizione, e OneUptime legge gli hub eventi ogni minuto: le metriche chiave arrivano pochi minuti dopo che Azure Monitor le ha, invece di attendere la lettura successiva della connessione, e i log delle risorse arrivano come log di OneUptime, ciascuno archiviato sotto la risorsa a cui si riferisce. Un solo comando in Azure Cloud Shell configura tutto, e non c'è nulla da eseguire.

:::cards
- [Come funziona](#come-funziona): Le impostazioni di diagnostica inviano a un hub eventi in ogni area, e OneUptime li legge.
- [Configurare la trasmissione](#configurare-la-trasmissione): Scegli cosa trasmettere, attiva la lettura ed esegui un comando.
- [Cosa arriva](#cosa-arriva): Le metriche sulle risorse che misurano, e i log sulle risorse da cui provengono.
- [Cosa crea il comando](#cosa-crea-il-comando): Ogni risorsa e ogni autorizzazione che il comando crea nella tua sottoscrizione.
- [Interrompere la trasmissione](#interrompere-la-trasmissione): Interrompi la lettura, poi elimina ciò che il comando ha creato.
:::

## Come funziona

```mermaid title="Da Azure Monitor a OneUptime"
flowchart TB
    metrics["Metriche di piattaforma"] --> settings["Impostazioni<br/>di diagnostica"]
    logs["Log delle risorse"] --> settings
    settings --> hubs["Un hub eventi<br/>in ogni area"]
    ou["OneUptime"] -->|"legge ogni minuto,<br/>Kafka sulla porta 9093"| hubs
```

- **Un hub eventi in ogni area.** Un'impostazione di diagnostica invia solo a un hub eventi nell'area della sua risorsa, quindi il comando crea un namespace di Event Hubs in ogni area in cui si trovano le tue risorse, tutti in un unico gruppo di risorse, e indirizza l'impostazione di diagnostica di ogni risorsa a quello della sua area.
- **OneUptime li legge.** Azure Monitor invia solo a un hub eventi, a un account di archiviazione o a un'area di lavoro Log Analytics, mai a un tuo indirizzo: un hub eventi letto da OneUptime è la via che non richiede di eseguire nulla da parte tua. OneUptime accede come app della connessione, che può leggere quegli hub eventi e nient'altro.
- **Le letture lasciano le metriche trasmesse al flusso.** Finché il flusso consegna le metriche chiave di un tipo di risorsa in un'area, le letture della connessione smettono di scriverle, così nessun punto dati viene contato due volte. Le letture continuano a trovare le risorse, il loro stato e le loro modifiche, e riprendono le metriche dopo 15 minuti senza eventi.
- **Non si perde nulla mentre OneUptime non può leggere.** Gli eventi attendono negli hub eventi che OneUptime li legga, per tutto il tempo in cui gli hub eventi li conservano, e OneUptime ricorda fin dove ha letto ogni partizione, per riprendere da dove si è fermato.

## Prima di iniziare

- **Una sottoscrizione Azure connessa.** Connettila prima in **Cloud → Collega**: vedi [Collegare un account cloud](/docs/telemetry/cloud-accounts).
- **Un proprietario o un amministratore del progetto.** Solo loro possono attivare la lettura e interrompere la trasmissione.
- **Azure Cloud Shell**, con l'accesso come **Owner** delle sottoscrizioni, o come **Contributor** che sia anche **User Access Administrator**: il comando crea un gruppo di risorse e un'assegnazione di ruolo, e modifica le impostazioni di diagnostica.
- **Una via d'uscita verso Azure, per un OneUptime self-hosted.** OneUptime legge ogni namespace su `<namespace>.servicebus.windows.net` sulla porta 9093, e i namespace accettano connessioni da internet.

## Configurare la trasmissione

:::steps
### Aprire la finestra di trasmissione

Vai su **Cloud → Collega** e, nella riga della sottoscrizione Azure, scegli **Trasmetti metriche e log**.

### Scegliere cosa trasmettere

**Metriche** trasmette ogni metrica chiave di ogni risorsa, minuto per minuto: le metriche con cui OneUptime traccia i grafici e valuta ogni risorsa. **Metriche e log** aggiunge i log propri di ogni risorsa, ogni categoria che Azure conserva per essa, e **Registri** trasmette solo i log delle risorse.

### Attivare la lettura

Scegli **Attiva la lettura**. OneUptime cerca gli hub eventi ogni minuto, e li attende finché il comando non li ha creati.

### Eseguire il comando in Azure Cloud Shell

Copia il comando, eseguilo in Azure Cloud Shell e attendi che finisca. Indica ogni area in cui ha creato un hub eventi, quante risorse vi inviano e quali risorse ha escluso, con il motivo dato da Azure.

### Attendere i primi eventi

La finestra chiede ogni pochi secondi cosa è arrivato. Azure inizia a inviare pochi minuti dopo la fine del comando; la finestra dice allora cosa è arrivato e da dove, e la riga della connessione dice **In trasmissione**.
:::

**Altri campi** contiene il resto:

| Campo | Cosa fa |
| --- | --- |
| **Sottoscrizioni** | Le sottoscrizioni da cui trasmettere: all'inizio, quelle lette dalla connessione. La prima contiene gli hub eventi, e OneUptime li legge lì. Al massimo 50 |
| **Configuralo in un altro modo** | I nomi usati dal comando, per configurare tutto con Terraform o il portale |

Quando la prima sottoscrizione non è quella in cui OneUptime legge gli hub eventi, la finestra lo dice: scegli **Leggili lì** prima di eseguire il comando.

## Cosa arriva

| Cosa | Dove arriva |
| --- | --- |
| Metriche chiave | Sulle risorse cloud che misurano, nelle stesse serie scritte dalle letture della connessione |
| Log delle risorse | In Esplora log, sotto il servizio di telemetria della connessione, con la sottoscrizione, l'area e la categoria come attributi |
| Log di una risorsa che OneUptime conosce | Anche su quella risorsa: la sua pagina in Cloud ottiene una scheda **Registri** |

Il flusso porta le metriche chiave che la connessione legge minuto per minuto. Una metrica che legge con una granularità più ampia, come la capacità usata di un account di archiviazione, resta alle letture. Un log viene archiviato sotto la sua risorsa in base all'ID ARM della risorsa, portato come `cloud.resource_id`, e conserva categoria, operazione, risultato e proprietà come attributi, ad esempio `azure.category`.

Macchine virtuali, set di scalabilità, dischi, interfacce di rete, reti virtuali, endpoint privati, gateway NAT, zone DNS e piani di App Service non inviano log delle risorse propri, quindi le loro pagine non hanno la scheda **Registri**. I log di un account di archiviazione sono quelli dei suoi servizi, e quelli di un'app contenitore quelli del suo ambiente.

## Cosa crea il comando

Il gruppo di risorse si chiama `oneuptime-stream-` seguito dai primi 8 caratteri dell'ID della connessione. Non dà a OneUptime alcun accesso alle tue risorse: l'app della connessione può leggere gli hub eventi, e niente di più.

| Risorsa | Cosa può fare |
| --- | --- |
| Un gruppo di risorse, `oneuptime-stream-<suffix>`, nella prima sottoscrizione | Contiene gli hub eventi, con il tag `oneuptime-connection` che porta l'ID della connessione |
| Un namespace di Event Hubs in ogni area, `oneuptime-<suffix>-<region>`, nel livello Standard con 1 unità elaborata | Riceve ciò che inviano le impostazioni di diagnostica della sua area |
| Un hub eventi in ciascuno, `oneuptime`, con 2 partizioni | Conserva gli eventi finché OneUptime non li legge |
| Il ruolo **Azure Event Hubs Data Receiver** per l'app della connessione, solo sul gruppo di risorse | Permette all'app di leggere gli hub eventi, e nient'altro |
| Un'impostazione di diagnostica su ogni risorsa, `OneUptime-<suffix>` | Invia le metriche, i log o entrambi della risorsa all'hub eventi della sua area |

Una risorsa di un'area globale, come Front Door, invia all'hub eventi della prima area. Una risorsa di cui Azure conserva solo metriche o solo log viene configurata con ciò che ha, e una che ha già 5 impostazioni di diagnostica, il massimo consentito da Azure, viene esclusa. Azure addebita l'unità elaborata di ogni namespace a ore, e gli eventi inviati dalle impostazioni di diagnostica.

## Interrompere la trasmissione

:::steps
### Interrompere la lettura

Nella riga della sottoscrizione in **Cloud → Collega**, scegli **Interrompi la trasmissione**. OneUptime smette subito di leggere gli hub eventi, e la connessione torna a leggere tutte le sue metriche secondo la sua pianificazione. Ciò che è stato letto resta.

### Eliminare ciò che il comando ha creato

Gli hub eventi e le impostazioni di diagnostica restano in Azure, e Azure li addebita, finché non vengono eliminati. La finestra mostra il comando: elimina l'impostazione di diagnostica di ogni risorsa, poi il gruppo di risorse, in qualunque sottoscrizione si trovi.

```bash
oneuptime_stream_stop() {
  local SUB ID N=0
  for SUB in '11111111-aaaa-4aaa-8aaa-111111111111' '22222222-bbbb-4bbb-8bbb-222222222222'; do
    while IFS= read -r ID; do
      if [ -z "$ID" ]; then continue; fi
      az monitor diagnostic-settings delete --name OneUptime-6f1c3a2e --resource "$ID" --output none 2> /dev/null &
      N=$((N + 1))
      if [ $((N % 4)) -eq 0 ]; then wait; fi
    done < <(az resource list --subscription "$SUB" --query "[].id" --output tsv)
  done
  wait
  for SUB in '11111111-aaaa-4aaa-8aaa-111111111111' '22222222-bbbb-4bbb-8bbb-222222222222'; do
    if [ "$(az group exists --subscription "$SUB" --name oneuptime-stream-6f1c3a2e 2> /dev/null)" = true ]; then
      az group delete --subscription "$SUB" --name oneuptime-stream-6f1c3a2e --yes --no-wait && echo "Deleting oneuptime-stream-6f1c3a2e in $SUB."
    fi
  done
}
oneuptime_stream_stop
```
:::

Per cambiare ciò che viene trasmesso, apri di nuovo **Trasmetti metriche e log**, scegli cosa trasmettere ed esegui il nuovo comando: aggiorna ciò che la prima esecuzione ha creato, e non crea nulla due volte.

## Configuralo in un altro modo

Con Terraform o il portale, crea ciò che crea il comando, con questi nomi:

| Impostazione | Valore |
| --- | --- |
| Gruppo di risorse | `oneuptime-stream-<suffix>`, nella sottoscrizione in cui OneUptime legge gli hub eventi |
| Namespace di Event Hubs | `oneuptime-<suffix>-<region>`, uno in ogni area di una risorsa da trasmettere |
| Hub eventi | `oneuptime`, in ogni namespace |
| Impostazione di diagnostica | `OneUptime-<suffix>` su ogni risorsa, verso l'hub eventi della sua area, con la regola `RootManageSharedAccessKey` del namespace |
| Ruolo | **Azure Event Hubs Data Receiver** per l'app della connessione, sul gruppo di risorse |

Poi attiva la lettura, con quella sottoscrizione per prima in **Sottoscrizioni**.

## Risoluzione dei problemi

:::details La finestra continua ad attendere i primi eventi
Verifica che il comando sia terminato e che abbia detto che l'hub eventi di un'area è pronto: `az eventhubs namespace list --resource-group oneuptime-stream-6f1c3a2e` elenca i namespace. Un'impostazione di diagnostica invia solo ciò che Azure Monitor ha, quindi una risorsa che non fa nulla invia poco. Un nuovo ruolo può richiedere qualche minuto per diventare effettivo: fino ad allora, le letture non vedono gli eventi.
:::

:::details La connessione dice Flusso in errore
La finestra e il tooltip della riga dicono perché. Quando l'app non può leggere gli hub eventi, esegui di nuovo il comando: riassegna all'app il suo ruolo. Quando OneUptime non è riuscito a raggiungerli, verifica che i namespace accettino connessioni da internet, e che un OneUptime self-hosted possa raggiungere la porta 9093.
:::

:::details Il comando ha escluso delle risorse
Le elenca, ciascuna con il motivo dato da Azure. Una risorsa di un tipo senza impostazioni di diagnostica non invia nulla, e per una che ha già 5 impostazioni di diagnostica bisogna prima eliminarne una. Poi esegui di nuovo il comando.
:::

## Passaggi successivi

:::cards
- [Collegare un account cloud](/docs/telemetry/cloud-accounts): Cosa legge una connessione, e con quale frequenza.
- [Trasmettere i log di Google Cloud](/docs/telemetry/cloud-streaming-google-cloud): I log di un progetto Google Cloud, inviati tramite Pub/Sub.
- [Trasmettere metriche e log di CloudWatch](/docs/telemetry/cloud-streaming): Quelli di un account AWS, consegnati da Amazon Data Firehose.
- [Esploratore log](/docs/telemetry/logs-explorer): Cerca e filtra ciò che i flussi hanno consegnato.
:::
