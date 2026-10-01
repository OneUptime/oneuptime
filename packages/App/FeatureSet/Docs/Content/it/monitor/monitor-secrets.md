# Segreti Monitor

È possibile usare i segreti per archiviare informazioni sensibili da utilizzare nei controlli di monitoraggio. I segreti sono crittografati e archiviati in modo sicuro.

### Aggiunta di un Segreto

Per aggiungere un segreto, accedere a Dashboard OneUptime -> Monitor -> Impostazioni -> Segreti -> Crea Segreto Monitor.

![Crea Segreto](/docs/static/images/CreateMonitorSecret.png)

Assegna al segreto un nome e un valore, quindi scegli nel passaggio **Accesso** quali monitor possono usarlo. In questo caso abbiamo aggiunto un segreto `ApiKey`.

**Nota importante**: I segreti sono crittografati e archiviati in modo sicuro. Il valore non viene più mostrato dopo il salvataggio: né nella tabella, né nel modulo di modifica, né tramite API. Se perdi il valore, dovrai recuperarlo dalla sua origine e reinserirlo. Per ruotare un segreto usa il pulsante **Aggiorna valore segreto** sulla sua riga; non serve eliminarlo e ricrearlo.

### Scegliere quali monitor possono usare un segreto

Ogni segreto ha una di queste tre opzioni di accesso:

- **Tutti i monitor**: ogni monitor del progetto può usare il segreto, compresi quelli che creerai in seguito. Usala per una credenziale condivisa da molti monitor.
- **Monitor specifici**: solo i monitor che scegli possono usare il segreto. È l'opzione predefinita, e i segreti creati prima che esistessero queste opzioni funzionano così.
- **Monitor con etichette**: i monitor che hanno almeno una delle etichette che scegli possono usare il segreto. Aggiungere una di queste etichette a un monitor gli dà accesso, e rimuovere l'etichetta gli toglie l'accesso alla successiva esecuzione del monitor.

Puoi cambiare l'opzione in qualsiasi momento con **Modifica** sulla riga del segreto. Viene conservato solo l'elenco dell'opzione scelta: passare a **Tutti i monitor** svuota gli elenchi di monitor ed etichette del segreto, e passare tra **Monitor specifici** e **Monitor con etichette** svuota l'elenco che lasci.

Un segreto non è mai disponibile per i monitor di un altro progetto.

Chiunque possa modificare un monitor che ha accesso a un segreto può inviare quel segreto a qualsiasi destinazione a cui il monitor si collega. Con **Tutti i monitor**, si tratta di chiunque possa creare o modificare monitor nel progetto. Con **Monitor con etichette**, include anche chiunque possa aggiungere una di quelle etichette a un monitor.

Nell'API, l'opzione di accesso è il campo `monitorAccess`: `All Monitors`, `Specific Monitors` o `Monitors With Labels`. I campi `monitors` e `labels` contengono gli elenchi. Un segreto creato senza `monitorAccess` riceve `Specific Monitors`.

### Utilizzo di un Segreto

È possibile usare i segreti nei seguenti tipi di monitoraggio:

- API (nelle intestazioni della richiesta, nel corpo della richiesta e nell'URL)
- Sito Web, IP, Porta, Ping, Certificato SSL (nell'URL)
- Monitor Sintetico, Monitor Codice Personalizzato (nel codice)
- Monitor SNMP (nella stringa community, nella chiave auth SNMPv3 e nella chiave priv)

![Uso Segreto](/docs/static/images/UsingMonitorSecret.png)

Per usare un segreto, aggiungere `{{monitorSecrets.NOME_SEGRETO}}` nel campo in cui si vuole usare il segreto. Ad esempio, in questo caso è stato aggiunto `{{monitorSecrets.ApiKey}}` nel campo Intestazione Richiesta.

I segreti vengono iniettati sul probe prima dell'esecuzione degli script dei monitor Sintetici o Codice Personalizzato, quindi i riferimenti come `{{monitorSecrets.ApiKey}}` si risolvono nel valore decriptato all'interno dello script in esecuzione.

Se un monitor fa riferimento a un segreto che non può usare, il riferimento resta invariato e non viene sostituito con il valore.

Quando testi un monitor prima di salvarlo, vengono inseriti solo i segreti disponibili per **Tutti i monitor**, perché un nuovo monitor non è in nessun elenco e non ha ancora etichette. Dopo il salvataggio, i test usano tutti i segreti a cui il monitor ha accesso.
