# FAQ e Risoluzione dei Problemi

Domande frequenti e soluzioni per le App Mobile e Desktop di OneUptime (PWA).

## FAQ Generali

### Cos'è una Progressive Web App (PWA)?

Una Progressive Web App è un'applicazione web che utilizza le moderne tecnologie web per offrire esperienze simili a quelle delle app native. Le PWA possono essere installate direttamente dai browser senza app store, funzionano offline, inviano notifiche push e si integrano con il sistema operativo del tuo dispositivo.

### Perché OneUptime non usa gli app store tradizionali?

OneUptime usa la tecnologia PWA perché offre diversi vantaggi:
- **Aggiornamenti Istantanei**: Nessuna attesa per l'approvazione dell'app store o aggiornamenti manuali
- **Cross-Platform**: Un unico codebase funziona su tutti i dispositivi
- **Nessun Limite di Dimensione**: Funzionalità complete senza restrizioni di dimensione
- **Distribuzione Diretta**: Installa direttamente dalla tua istanza OneUptime
- **Sempre Aggiornata**: Gli utenti hanno sempre la versione più recente
- **Sicurezza**: Gli stessi vantaggi di sicurezza delle applicazioni web


### Quanto spazio occupa la PWA di OneUptime?

- **Installazione Iniziale**: 10-20MB
- **Crescita della Cache**: 50-100MB con uso regolare
- **Cache Massima**: Tipicamente limitata a 200MB dai browser
- **Pulizia Automatica**: I browser gestiscono automaticamente lo spazio di archiviazione

### La PWA di OneUptime supporta le notifiche push?

Sì, la PWA di OneUptime supporta notifiche push ricche:
- **Avvisi Incidenti**: Notifiche di incidenti in tempo reale
- **Aggiornamenti di Stato**: Avvisi di cambio di stato del monitor
- **Trigger Personalizzati**: Configura le regole di notifica
- **Contenuto Ricco**: Immagini, azioni e informazioni dettagliate
- **Aggiornamenti Badge**: Conteggio non letto sull'icona dell'app

## FAQ sull'Installazione

### Perché non vedo il pulsante "Installa"?

Cause comuni e soluzioni:
1. **Compatibilità del Browser**: Usa Chrome, Edge o Safari
2. **HTTPS Richiesto**: Assicurati che l'istanza OneUptime usi HTTPS
3. **Requisiti PWA**: Il server deve soddisfare i requisiti del manifest PWA
4. **Problemi di Cache**: Svuota la cache del browser e ricarica
5. **Già Installata**: L'app potrebbe essere già installata
6. **Tempo di Attesa**: Alcuni browser necessitano di 30+ secondi sulla pagina

### Posso installare su più dispositivi?

Sì! Puoi installare la PWA di OneUptime su:
- Dispositivi illimitati per utente
- Più browser sullo stesso dispositivo
- Diversi sistemi operativi
- Dispositivi condivisi/famiglia (con account separati)

### Come aggiorno l'app installata?

La PWA di OneUptime si aggiorna automaticamente:
- **Aggiornamenti Automatici**: L'app si aggiorna quando la visiti mentre sei online
- **Aggiornamenti in Background**: Gli aggiornamenti vengono scaricati in background
- **Disponibilità Immediata**: Le nuove funzionalità sono disponibili istantaneamente
- **Nessuna Azione dell'Utente**: A differenza delle app negli store, non sono necessari aggiornamenti manuali

### Posso personalizzare il nome dell'app durante l'installazione?

Sì, durante l'installazione puoi:
- Cambiare il nome dell'app (predefinito: "OneUptime")
- Aggiungere il nome della tua organizzazione
- Usare una convenzione di denominazione personalizzata
- Modificare l'etichetta dell'icona (dipende dalla piattaforma)

### Come disinstallo la PWA di OneUptime?

La disinstallazione varia a seconda della piattaforma:

**Android:**
- Tieni premuta l'icona dell'app → Disinstalla
- Impostazioni → App → OneUptime → Disinstalla

**iOS:**
- Tieni premuta l'icona dell'app → Rimuovi app → Elimina app

**Windows:**
- Impostazioni → App → OneUptime → Disinstalla
- Clic destro sulla voce nel Menu Start → Disinstalla

**macOS:**
- Trascina dalla cartella Applicazioni al Cestino
- Clic destro sull'icona nel Dock → Rimuovi

**Linux:**
- Rimuovi dal launcher delle applicazioni
- Elimina il file .desktop


## FAQ sulle Notifiche

### Perché non ricevo le notifiche?

Problemi comuni con le notifiche e soluzioni:

**Controlla i Permessi:**
```
1. Permessi di notifica del browser abilitati
2. Permessi di notifica del sistema operativo
3. Impostazioni di notifica di OneUptime configurate
4. Modalità Non Disturbare disabilitata
```

**Specifico per Piattaforma:**
- **Android**: Controlla le impostazioni di ottimizzazione della batteria
- **iOS**: Verifica le impostazioni delle notifiche nell'app Impostazioni
- **Windows**: Controlla le impostazioni Focus Assist
- **macOS**: Verifica i permessi del centro notifiche
- **Linux**: Controlla lo stato del daemon delle notifiche

### Posso personalizzare i suoni delle notifiche?

Opzioni di personalizzazione delle notifiche:
- **Suoni di Sistema**: Usa le impostazioni dei suoni di notifica del sistema operativo
- **Impostazioni Browser**: Configura nelle preferenze di notifica del browser
- **Impostazioni OneUptime**: Imposta le preferenze di notifica nella dashboard
- **Livelli di Priorità**: Configura suoni diversi per diversi livelli di gravità

### Come disabilito temporaneamente le notifiche?

Disabilitazione temporanea delle notifiche:
- **Non Disturbare**: Abilita la modalità DND del sistema
- **Impostazioni Browser**: Disabilita temporaneamente le notifiche del sito
- **Dashboard OneUptime**: Metti in pausa le notifiche nelle impostazioni
- **Modalità Focus**: Usa le modalità focus/concentrazione del sistema operativo

## FAQ sulla Sicurezza

### La PWA di OneUptime è sicura?

Funzionalità e considerazioni sulla sicurezza:
- **Crittografia HTTPS**: Tutti i dati trasmessi in modo sicuro
- **Same-Origin Policy**: Si applicano le restrizioni di sicurezza del browser
- **Ambiente Sandbox**: Esegue nella sandbox di sicurezza del browser
- **Aggiornamenti Regolari**: Patch di sicurezza applicate automaticamente
- **Nessun Accesso Root**: Accesso limitato al sistema rispetto alle app native


*Nota: I dati sensibili sono crittografati e seguono gli standard di sicurezza del browser.*

### Posso usare la PWA di OneUptime su reti aziendali?

Considerazioni sulla rete aziendale:
- **Regole Firewall**: Assicura accesso HTTPS (porta 443)
- **Configurazione Proxy**: Configura le impostazioni proxy del browser
- **Fiducia dei Certificati**: Installa i certificati aziendali se necessario
- **Accesso VPN**: Usa la VPN per l'accesso remoto
- **Policy di Sicurezza**: Rispetta i requisiti di sicurezza IT

## Risoluzione dei Problemi

### Problemi di Installazione

**Problema**: Il pulsante di installazione non appare
```
Soluzioni:
1. Attendi 30+ secondi sulla pagina OneUptime
2. Aggiorna la pagina e attendi di nuovo
3. Svuota la cache e i cookie del browser
4. Prova un browser diverso (Chrome/Edge consigliato)
5. Verifica la connessione HTTPS (controlla l'icona del lucchetto)
6. Controlla se è già installata
```

**Problema**: L'installazione fallisce o va in crash
```
Soluzioni:
1. Assicurati di avere spazio di archiviazione sufficiente (100MB+)
2. Chiudi altre schede e applicazioni del browser
3. Aggiorna il browser all'ultima versione
4. Disabilita temporaneamente le estensioni del browser
5. Prova l'installazione in modalità privata/anonima
6. Riavvia il browser e riprova
```

**Problema**: L'app si installa ma non appare
```
Soluzioni:
1. Controlla tutte le posizioni del launcher delle app
2. Cerca "OneUptime" nella ricerca del dispositivo
3. Cerca nella sezione di gestione delle app del browser
4. Attendi 1-2 minuti per l'aggiornamento del sistema
5. Riavvia il dispositivo e controlla di nuovo
```

**Problema**: L'app va in crash frequentemente
```
Soluzioni:
1. Aggiorna il browser all'ultima versione
2. Svuota tutti i dati del browser per OneUptime
3. Disabilita le estensioni del browser
4. Controlla lo spazio di archiviazione disponibile
5. Riavvia il sistema operativo
6. Reinstalla la PWA di OneUptime
```

**Problema**: Le notifiche push non funzionano
```
Soluzioni:
1. Controlla i permessi delle notifiche nel browser
2. Verifica le impostazioni delle notifiche di sistema
3. Testa prima con una notifica semplice
4. Svuota i dati delle notifiche e riconcedi i permessi
5. Controlla le impostazioni Non Disturbare/Modalità Focus
6. Verifica la configurazione delle notifiche di OneUptime
```

**Problema**: L'app non sincronizza i dati più recenti
```
Soluzioni:
1. Trascina verso il basso per aggiornare (mobile)
2. Premi Ctrl+F5 (Windows/Linux) o Cmd+R (Mac)
3. Chiudi e riapri l'app
4. Svuota la cache dell'app e ricarica
5. Controlla la connettività di rete
```

### Problemi Specifici per Piattaforma

**Problemi Android:**
```
Problema: L'app non appare nel cassetto delle app
Soluzione: Controlla la sezione "Aggiunte di recente", cerca nel cassetto delle app

Problema: Notifiche ritardate
Soluzione: Disabilita l'ottimizzazione della batteria per l'app browser

Problema: L'app va in crash all'avvio
Soluzione: Svuota i dati dell'app Chrome, riavvia il dispositivo
```

**Problemi iOS:**
```
Problema: Impossibile aggiungere alla schermata Home
Soluzione: Usa il browser Safari, assicurati di avere iOS 11.3+

Problema: Icona dell'app mancante
Soluzione: Controlla tutte le pagine della schermata Home e la Libreria App

Problema: Face ID non funziona
Soluzione: Abilita Face ID per Safari nelle impostazioni
```

**Problemi Windows:**
```
Problema: L'app non appare nel Menu Start
Soluzione: Cerca il nome dell'app, controlla l'elenco delle app installate

Problema: Notifiche non mostrate
Soluzione: Controlla le impostazioni delle notifiche di Windows, abilita per il browser

Problema: Problemi di dimensioni della finestra
Soluzione: Ridimensiona manualmente, l'app ricorderà le dimensioni
```

**Problemi macOS:**
```
Problema: Impossibile installare tramite Safari
Soluzione: Aggiorna a macOS Sonoma+, usa File → Aggiungi al Dock

Problema: App non nella cartella Applicazioni
Soluzione: Controlla Launchpad, usa la ricerca Spotlight

Problema: Notifiche non funzionanti
Soluzione: Controlla Preferenze di Sistema → Notifiche
```

**Problemi Linux:**
```
Problema: Opzione di installazione PWA mancante
Soluzione: Usa Chrome/Chromium, assicurati del supporto dell'ambiente desktop

Problema: Icona non appare nel launcher
Soluzione: Aggiorna il database del desktop, controlla il file .desktop

Problema: Notifiche audio non funzionanti
Soluzione: Controlla PulseAudio, verifica i permessi audio del browser
```

### Messaggi di Errore

**"This site cannot be installed"**
```
Cause:
- L'istanza OneUptime non soddisfa i requisiti PWA
- Manifest dell'app web mancante o non valido
- HTTPS non configurato correttamente
- Il browser non supporta l'installazione PWA

Soluzioni:
- Contatta l'amministratore per verificare la configurazione PWA
- Prova un browser diverso
- Controlla la console del browser per errori dettagliati
```
