# Guida all'Installazione su Android

Installa OneUptime come app nativa sul tuo dispositivo Android per la migliore esperienza di monitoraggio.

## Metodi di Installazione

### Metodo 1: Browser Chrome (Consigliato)

1. **Apri OneUptime in Chrome**
   - Avvia Google Chrome sul tuo dispositivo Android
   - Naviga all'URL della tua istanza OneUptime
   - Attendi il caricamento completo della pagina

2. **Prompt di Installazione**
   - Cerca il banner "Aggiungi alla schermata Home" in basso
   - Tocca "Installa" o "Aggiungi alla schermata Home"
   - Se non vedi il prompt, tocca il menu a tre punti (⋮) nell'angolo in alto a destra

3. **Installazione Manuale tramite Menu**
   - Tocca il menu Chrome (tre punti)
   - Seleziona "Aggiungi alla schermata Home" o "Installa app"
   - Personalizza il nome dell'app se desiderato
   - Tocca "Aggiungi" per confermare

4. **Avvia l'App**
   - Trova l'icona di OneUptime nella schermata Home o nel cassetto delle app
   - Tocca per avviare l'app in modalità schermo intero

### Metodo 2: Samsung Internet

1. **Apri OneUptime**
   - Avvia il browser Samsung Internet
   - Vai alla tua istanza OneUptime
   - Attendi il caricamento completo della pagina

2. **Aggiungi alla Schermata Home**
   - Tocca il pulsante del menu (tre linee)
   - Seleziona "Aggiungi pagina a" → "Schermata Home"
   - Inserisci il nome dell'app e tocca "Aggiungi"

3. **Avvia**
   - Trova l'icona dell'app nella schermata Home
   - Tocca per aprire OneUptime in modalità app

### Metodo 3: Firefox

1. **Apri OneUptime**
   - Avvia il browser Firefox
   - Naviga all'URL di OneUptime
   - Consenti il caricamento completo della pagina

2. **Installa**
   - Tocca il menu a tre punti
   - Seleziona "Installa" (se disponibile)
   - Oppure seleziona "Aggiungi alla schermata Home"
   - Conferma l'installazione

### Opzioni di Personalizzazione

### Nome dell'App
- Durante l'installazione, puoi personalizzare il nome dell'app
- Predefinito: "OneUptime"
- Consigliato: Mantieni "OneUptime" o aggiungi il nome della tua azienda

### Impostazioni delle Notifiche
1. **Concedi i Permessi**
   - Consenti le notifiche quando richiesto
   - Vai su Impostazioni → App → OneUptime → Notifiche
   - Abilita tutte le categorie di notifiche per la migliore esperienza

2. **Personalizza gli Avvisi**
   - Configura quali incidenti attivano le notifiche
   - Imposta i livelli di priorità delle notifiche
   - Scegli le preferenze di suono e vibrazione

## Risoluzione dei Problemi

### Problemi di Installazione

**"Aggiungi alla schermata Home" non appare:**
```
1. Svuota la cache e i cookie del browser
2. Assicurati di essere su HTTPS (connessione sicura)
3. Attendi 2-3 minuti sulla pagina prima di cercare il prompt
4. Controlla se i requisiti PWA sono soddisfatti nella tua istanza OneUptime
```

**L'installazione fallisce:**
```
1. Libera spazio di archiviazione (necessari almeno 50MB)
2. Aggiorna il tuo browser all'ultima versione
3. Riavvia il browser e riprova
4. Prova un browser diverso (Chrome consigliato)
```

**L'icona dell'app non appare:**
```
1. Controlla la schermata Home e il cassetto delle app
2. Cerca nella sezione "Aggiunte di recente"
3. Cerca "OneUptime" nel cassetto delle app
4. Reinstalla se necessario
```

### Problemi con le Notifiche

**Notifiche non ricevute:**
```
1. Controlla i permessi delle notifiche:
   - Impostazioni → App → OneUptime → Autorizzazioni → Notifiche
2. Assicurati che le notifiche siano abilitate nella dashboard di OneUptime
3. Controlla le impostazioni Non Disturbare
4. Verifica che le impostazioni di ottimizzazione della batteria non blocchino OneUptime
```

**Notifiche ritardate:**
```
1. Disabilita l'ottimizzazione della batteria per OneUptime:
   - Impostazioni → App → OneUptime → Batteria → Ottimizza utilizzo batteria
2. Consenti l'attività in background
3. Controlla le impostazioni del risparmio dati
```

## Disinstallazione

### Rimuovi l'App
1. **Tieni premuta** l'icona di OneUptime nella schermata Home
2. Seleziona **"Disinstalla"** o trascina nel cestino
3. Conferma la rimozione

### Metodo Alternativo
1. Vai su **Impostazioni → App**
2. Trova **"OneUptime"**
3. Tocca **"Disinstalla"**
4. Conferma la rimozione

## Aggiornamenti e Manutenzione

### Aggiornamenti Automatici
OneUptime PWA si aggiorna automaticamente:
- **Aggiornamenti Automatici**: L'app si aggiorna quando la visiti mentre sei online
- **Nessun Aggiornamento Manuale**: A differenza delle app negli store, non è richiesta alcuna azione dell'utente
- **Aggiornamenti Istantanei**: Le nuove funzionalità sono disponibili immediatamente
- **Sicurezza di Rollback**: Gli aggiornamenti non riusciti possono essere rapidamente ripristinati

## Configurazione Avanzata

### Opzioni Sviluppatore
Per gli utenti avanzati che vogliono ispezionare la PWA:
1. Abilita le Opzioni Sviluppatore in Android
2. Connetti al computer con ADB
3. Usa Chrome DevTools per il debugging remoto

### Configurazione di Rete
- Configura la VPN se accedi a un'istanza OneUptime interna
- Configura le impostazioni del proxy se richiesto dalla tua organizzazione
- Assicurati che il firewall consenta le risorse PWA

## Best Practice

### Per Prestazioni Ottimali
1. **Primo Avvio**: Sempre online per la configurazione iniziale
2. **Uso Regolare**: Apri l'app regolarmente per mantenere la cache aggiornata
3. **Gestione dello Spazio**: Mantieni spazio libero sufficiente
4. **Rete**: Usa il Wi-Fi per l'installazione iniziale e i principali aggiornamenti

### Raccomandazioni di Sicurezza
1. **Solo HTTPS**: Installa solo da istanze OneUptime sicure
2. **URL Ufficiali**: Verifica di installare dall'URL ufficiale OneUptime della tua organizzazione
3. **Autorizzazioni**: Concedi solo le autorizzazioni necessarie
4. **Aggiornamenti**: Mantieni aggiornati il tuo sistema operativo Android e i browser
