# Segreti Monitor

È possibile usare i segreti per archiviare informazioni sensibili da utilizzare nei controlli di monitoraggio. I segreti sono crittografati e archiviati in modo sicuro.

### Aggiunta di un Segreto

Per aggiungere un segreto, accedere a Dashboard OneUptime -> Impostazioni Progetto -> Segreti Monitor -> Crea Segreto Monitor.

![Crea Segreto](/docs/static/images/CreateMonitorSecret.png)

È possibile selezionare quali monitor hanno accesso al segreto. In questo caso è stato aggiunto il segreto `ApiKey` e sono stati selezionati i monitor che vi possono accedere.

**Nota importante**: I segreti sono crittografati e archiviati in modo sicuro. Se si perde il segreto, sarà necessario crearne uno nuovo. Non è possibile visualizzare o aggiornare il segreto dopo che è stato salvato.

### Utilizzo di un Segreto

È possibile usare i segreti nei seguenti tipi di monitoraggio:

- API (nelle intestazioni della richiesta, nel corpo della richiesta e nell'URL)
- Sito Web, IP, Porta, Ping, Certificato SSL (nell'URL)
- Monitor Sintetico, Monitor Codice Personalizzato (nel codice)
- Monitor SNMP (nella stringa community, nella chiave auth SNMPv3 e nella chiave priv)

![Uso Segreto](/docs/static/images/UsingMonitorSecret.png)

Per usare un segreto, aggiungere `{{monitorSecrets.NOME_SEGRETO}}` nel campo in cui si vuole usare il segreto. Ad esempio, in questo caso è stato aggiunto `{{monitorSecrets.ApiKey}}` nel campo Intestazione Richiesta.

I segreti vengono iniettati sul probe prima dell'esecuzione degli script dei monitor Sintetici o Codice Personalizzato, quindi i riferimenti come `{{monitorSecrets.ApiKey}}` si risolvono nel valore decriptato all'interno dello script in esecuzione.

### Permessi Segreto Monitor

È possibile selezionare quali monitor hanno accesso al segreto. È anche possibile aggiornare i permessi in qualsiasi momento. Quindi, se si vuole aggiungere un nuovo monitor con accesso al segreto, è possibile farlo aggiornando i permessi.
