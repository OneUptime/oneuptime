# Monitor SNMP

Il monitoraggio SNMP (Simple Network Management Protocol) consente di monitorare dispositivi di rete come switch, router, firewall e altra infrastruttura di rete interrogando OID SNMP (Object Identifier).

## Panoramica

I monitor SNMP interrogano i dispositivi di rete per informazioni di gestione specifiche usando gli OID. Questo consente di:

- Monitorare la disponibilità e la salute dei dispositivi
- Tracciare le statistiche delle interfacce (traffico, errori, stato)
- Monitorare le metriche di sistema (CPU, memoria, uptime)
- Controllare OID personalizzati specifici del vendor
- Impostare avvisi basati sui valori OID

## Creazione di un Monitor SNMP

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **SNMP** come tipo di monitor
4. Configurare le impostazioni SNMP come descritto di seguito

## Opzioni di Configurazione

### Impostazioni Base

| Campo | Descrizione | Obbligatorio |
|-------|-------------|----------|
| Versione SNMP | Versione del protocollo: v1, v2c o v3 | Sì |
| Hostname/IP | L'hostname o l'indirizzo IP del dispositivo SNMP | Sì |
| Porta | Porta SNMP (predefinito: 161) | Sì |

### Autenticazione

#### SNMP v1/v2c

Per SNMP v1 e v2c, è necessario fornire solo una stringa community:

| Campo | Descrizione | Obbligatorio |
|-------|-------------|----------|
| Stringa Community | La stringa community SNMP (ad es. "public") | Sì |

#### SNMP v3

SNMPv3 fornisce sicurezza avanzata con autenticazione e crittografia:

| Campo | Descrizione | Obbligatorio |
|-------|-------------|----------|
| Livello di Sicurezza | noAuthNoPriv, authNoPriv o authPriv | Sì |
| Nome Utente | Nome utente SNMPv3 | Sì |
| Protocollo Auth | MD5, SHA, SHA256 o SHA512 | Se authNoPriv o authPriv |
| Chiave Auth | Password di autenticazione | Se authNoPriv o authPriv |
| Protocollo Priv | DES, AES o AES256 | Se authPriv |
| Chiave Priv | Password di privacy/crittografia | Se authPriv |

### OID da Monitorare

Aggiungere gli OID da interrogare sul dispositivo. Per ciascun OID è possibile specificare:

| Campo | Descrizione | Obbligatorio |
|-------|-------------|----------|
| OID | L'OID numerico (ad es. 1.3.6.1.2.1.1.1.0) | Sì |
| Nome | Un nome descrittivo per l'OID (ad es. sysDescr) | No |
| Descrizione | Una descrizione di cosa rappresenta questo OID | No |

### Template OID Comuni

OneUptime fornisce template per OID comunemente monitorati:

#### System MIB

| OID | Nome | Descrizione |
|-----|------|-------------|
| 1.3.6.1.2.1.1.1.0 | sysDescr | Descrizione del Sistema |
| 1.3.6.1.2.1.1.3.0 | sysUpTime | Uptime del Sistema (in tick) |
| 1.3.6.1.2.1.1.5.0 | sysName | Nome del Sistema |
| 1.3.6.1.2.1.1.6.0 | sysLocation | Posizione del Sistema |
| 1.3.6.1.2.1.1.4.0 | sysContact | Contatto del Sistema |

#### Interface MIB

| OID | Nome | Descrizione |
|-----|------|-------------|
| 1.3.6.1.2.1.2.1.0 | ifNumber | Numero di Interfacce di Rete |
| 1.3.6.1.2.1.2.2.1.8.X | ifOperStatus | Stato Operativo Interfaccia (X = indice interfaccia) |
| 1.3.6.1.2.1.2.2.1.10.X | ifInOctets | Byte in Entrata (X = indice interfaccia) |
| 1.3.6.1.2.1.2.2.1.16.X | ifOutOctets | Byte in Uscita (X = indice interfaccia) |

#### Host Resources MIB

| OID | Nome | Descrizione |
|-----|------|-------------|
| 1.3.6.1.2.1.25.1.1.0 | hrSystemUptime | Uptime del Sistema Host |
| 1.3.6.1.2.1.25.1.5.0 | hrSystemNumUsers | Numero di Utenti |
| 1.3.6.1.2.1.25.1.6.0 | hrSystemProcesses | Numero di Processi in Esecuzione |
| 1.3.6.1.2.1.25.3.3.1.2.X | hrProcessorLoad | Carico CPU (X = indice processore) |

### Impostazioni Avanzate

| Campo | Descrizione | Predefinito |
|-------|-------------|---------|
| Timeout | Tempo di attesa per una risposta (ms) | 5000 |
| Tentativi | Numero di tentativi in caso di errore | 3 |

## Criteri di Monitoraggio

È possibile impostare criteri per controllare le risposte SNMP e attivare avvisi o incidenti.

### Tipi di Controllo Disponibili

| Tipo di Controllo | Descrizione |
|------------|-------------|
| Dispositivo SNMP È Online | Verificare se il dispositivo risponde alle query SNMP |
| Tempo di Risposta SNMP | Verificare il tempo di risposta della query in millisecondi |
| Valore OID SNMP | Verificare il valore restituito da un OID specifico |
| OID SNMP Esiste | Verificare se un OID restituisce un valore (non null) |

### Criteri di Esempio

#### Verificare se il dispositivo è online
- **Controlla Su**: Dispositivo SNMP È Online
- **Tipo Filtro**: Vero

#### Avviso se il tempo di risposta supera la soglia
- **Controlla Su**: Tempo di Risposta SNMP (in ms)
- **Tipo Filtro**: Maggiore Di
- **Valore**: 1000

#### Verificare lo stato dell'interfaccia
- **Controlla Su**: Valore OID SNMP
- **OID**: 1.3.6.1.2.1.2.2.1.8.1
- **Tipo Filtro**: Uguale a
- **Valore**: 1 (1 = up, 2 = down)

#### Verificare la soglia di carico CPU
- **Controlla Su**: Valore OID SNMP
- **OID**: 1.3.6.1.2.1.25.3.3.1.2.1
- **Tipo Filtro**: Maggiore Di
- **Valore**: 80

## Uso dei Segreti Monitor

Per motivi di sicurezza, è possibile archiviare informazioni sensibili come le stringhe community e le credenziali SNMPv3 come segreti.

### Aggiunta di un Segreto

1. Accedere a **Impostazioni Progetto** -> **Segreti Monitor** -> **Crea Segreto Monitor**
2. Aggiungere il proprio segreto (ad es. stringa community o password SNMPv3)
3. Selezionare i monitor SNMP che devono avere accesso a questo segreto

### Uso dei Segreti nella Configurazione SNMP

Usare la sintassi `{{monitorSecrets.NOME_SEGRETO}}` in qualsiasi campo sensibile:

- **Stringa Community**: `{{monitorSecrets.SnmpCommunity}}`
- **Chiave Auth SNMPv3**: `{{monitorSecrets.SnmpAuthKey}}`
- **Chiave Priv SNMPv3**: `{{monitorSecrets.SnmpPrivKey}}`

## Variabili Template per gli Avvisi

Quando si creano template di incidenti o avvisi, è possibile usare le seguenti variabili:

| Variabile | Descrizione |
|----------|-------------|
| `{{isOnline}}` | Se il dispositivo è online (true/false) |
| `{{responseTimeInMs}}` | Tempo di risposta alla query in millisecondi |
| `{{failureCause}}` | Messaggio di errore se la query è fallita |
| `{{oidResponses}}` | Array di oggetti risposta OID |
| `{{OID_NAME}}` | Valore di un OID specifico per nome (ad es. `{{sysUpTime}}`) |

## Risoluzione dei Problemi

### Problemi Comuni

#### Il dispositivo non risponde
- Verificare che l'IP/hostname del dispositivo sia corretto
- Verificare che SNMP sia abilitato sul dispositivo
- Verificare che le regole del firewall consentano il traffico UDP sulla porta 161
- Confermare che la stringa community sia corretta

#### Errori di autenticazione (v3)
- Verificare nome utente, protocollo auth e chiave auth
- Assicurarsi che il livello di sicurezza corrisponda alla configurazione del dispositivo
- Verificare che il protocollo priv e la chiave siano corretti per il livello authPriv

#### OID non trovato
- Verificare che l'OID sia supportato dal proprio dispositivo
- Verificare se l'OID richiede il caricamento di una MIB specifica
- Provare a interrogare l'OID direttamente usando gli strumenti snmpget/snmpwalk

### Test della Connettività SNMP

Prima di configurare il monitoraggio, è possibile testare la connettività SNMP usando strumenti a riga di comando:

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## Buone Pratiche

1. **Usare SNMPv3 quando possibile** - Fornisce autenticazione e crittografia per una maggiore sicurezza
2. **Archiviare le credenziali come segreti** - Non codificare mai le stringhe community o le password
3. **Monitorare solo gli OID essenziali** - Interrogare solo ciò che è necessario per ridurre il sovraccarico di rete
4. **Impostare timeout appropriati** - I dispositivi di rete possono avere tempi di risposta variabili
5. **Usare nomi OID descrittivi** - Rende più facile comprendere i messaggi di avviso
6. **Testare prima di distribuire** - Verificare la connettività SNMP prima di creare monitor
