# Guida all'Installazione su macOS

Installa OneUptime come applicazione desktop nativa su macOS per un monitoraggio e una gestione degli incidenti fluidi.

## Metodi di Installazione

### Metodo 1: Safari (Consigliato per macOS)

Safari offre un'eccellente integrazione PWA con le funzionalità native di macOS.

1. **Apri OneUptime in Safari**
   - Avvia il browser Safari
   - Naviga all'URL della tua istanza OneUptime
   - Accedi al tuo account OneUptime
   - Attendi il caricamento completo della pagina

2. **Installa la PWA**
   - Clicca su **File** nella barra dei menu
   - Seleziona **"Aggiungi al Dock"** (macOS Sonoma+)
   - Oppure cerca l'**icona di installazione** nella barra degli indirizzi
   - In alternativa: **File** → **"Aggiungi alla schermata Home"** (macOS precedenti)

3. **Personalizza l'Installazione**
   - **Nome App**: Modifica se desiderato (predefinito: OneUptime)
   - **Dock**: Scegli di aggiungere al Dock
   - **Launchpad**: Aggiungi al Launchpad per un accesso facile

4. **Avvia l'App**
   - Trova OneUptime nel Dock, nel Launchpad o nella cartella Applicazioni
   - Clicca per avviare in una finestra dedicata
   - L'app si esegue indipendentemente dal browser Safari

### Metodo 2: Google Chrome

Chrome offre un robusto supporto PWA con un'eccellente integrazione desktop.

1. **Apri OneUptime in Chrome**
   - Avvia Google Chrome
   - Vai alla tua istanza OneUptime
   - Assicurati di aver effettuato l'accesso
   - Consenti il caricamento completo della pagina

2. **Installa tramite Menu**
   - Cerca l'**icona di installazione** (⊞) nella barra degli indirizzi
   - Clicca su **"Installa OneUptime"**
   - Oppure usa il **menu Chrome** → **Altri strumenti** → **Crea scorciatoia**

3. **Opzioni di Installazione**
   - Seleziona **"Apri come finestra"** per un'esperienza app nativa
   - Personalizza il nome dell'app se necessario
   - Clicca su **"Installa"** o **"Crea"**

4. **Accedi all'App**
   - Trova OneUptime nella cartella Applicazioni
   - Oppure accedi tramite la ricerca Spotlight
   - Aggiungi al Dock per un accesso rapido

### Metodo 3: Microsoft Edge

Edge fornisce un solido supporto PWA con una buona integrazione macOS.

1. **Apri OneUptime in Edge**
   - Avvia Microsoft Edge
   - Naviga all'URL di OneUptime
   - Completa il processo di accesso

2. **Installa l'App**
   - Clicca sul **menu a tre punti** → **App** → **Installa questo sito come app**
   - Oppure cerca il prompt di installazione nella barra degli indirizzi
   - Personalizza il nome dell'app se desiderato
   - Clicca su **"Installa"**

### Opzioni di Personalizzazione

### Dock e Launchpad
1. **Posizione nel Dock**: Trascina OneUptime nella posizione preferita nel Dock
2. **Dimensione nel Dock**: Ridimensiona l'icona nelle preferenze del Dock
3. **Organizzazione nel Launchpad**: Crea una cartella per le app di monitoraggio
4. **Notifiche Badge**: Mostra il conteggio degli incidenti sull'icona nel Dock

### Barra dei Menu e Notifiche
1. **Centro Notifiche**
   - Preferenze di Sistema → Notifiche → OneUptime
   - Configura gli stili degli avvisi e la consegna
   - Imposta i livelli di priorità per diversi tipi di incidenti

2. **Integrazione con la Barra dei Menu**
   - Barra dei menu nativa per le PWA Safari
   - Voci di menu personalizzate per le azioni frequenti
   - Scorciatoie da tastiera per le attività comuni

## Risoluzione dei Problemi

### Problemi di Installazione

**"Aggiungi al Dock" non disponibile in Safari:**
```
Soluzioni:
1. Assicurati di avere macOS Sonoma (14.0) o successivo
2. Aggiorna Safari all'ultima versione
3. Prova l'alternativa: File → Aggiungi alla schermata Home
4. Svuota la cache di Safari e riprova
5. Usa Chrome o Edge come alternativa
```

**La PWA non si installa o va in crash:**
```
Soluzioni:
1. Controlla la compatibilità della versione macOS
2. Assicurati di avere spazio sufficiente su disco (100MB+)
3. Aggiorna il browser all'ultima versione
4. Svuota la cache e i cookie del browser
5. Disabilita temporaneamente le estensioni del browser
6. Riavvia il Mac e riprova l'installazione
```

**L'app non appare in Applicazioni:**
```
Soluzioni:
1. Controlla il Launchpad per l'icona di OneUptime
2. Cerca con Spotlight (⌘+Spazio)
3. Cerca nella sezione di gestione PWA del browser
4. Prova a reinstallare con un browser diverso
5. Controlla se installata con un nome diverso
```

### Problemi con le Notifiche

**Le notifiche macOS non funzionano:**
```
Soluzioni:
1. Preferenze di Sistema → Notifiche → OneUptime
2. Abilita "Consenti notifiche"
3. Imposta lo stile degli avvisi appropriato (banner/avvisi)
4. Controlla le impostazioni Non Disturbare
5. Verifica le impostazioni di notifica di OneUptime
6. Concedi i permessi di notifica quando richiesto
```

## Disinstallazione

### Rimozione Completa
1. **Metodo Cartella Applicazioni**
   - Apri la cartella Applicazioni
   - Trova OneUptime
   - Trascina nel Cestino o clic destro → Sposta nel Cestino

2. **Metodo Dock**
   - Clic destro su OneUptime nel Dock
   - Seleziona "Opzioni" → "Rimuovi dal Dock"
   - Poi elimina dalla cartella Applicazioni

3. **Gestione PWA del Browser**
   - **Chrome**: chrome://apps/ → Trova OneUptime → Rimuovi
   - **Edge**: edge://apps/ → Trova OneUptime → Disinstalla
   - **Safari**: Nessuna pagina di gestione dedicata

### Disinstallazione Completa
Rimuovi tutti i dati associati:

```bash
# Svuota i dati PWA Safari (dati generali del sito web)
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# Svuota i dati PWA Chrome
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# Svuota i dati PWA Edge
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## Aggiornamenti e Manutenzione

### Aggiornamenti Automatici
- La PWA di OneUptime si aggiorna automaticamente quando online
- Non sono richiesti aggiornamenti dall'App Store
- Nuove funzionalità disponibili immediatamente
- Aggiornamenti critici applicati istantaneamente

### Programma di Manutenzione
Manutenzione regolare per prestazioni ottimali:

**Settimanale:**
- Riavvia l'app OneUptime
- Svuota la cache del browser in caso di problemi
- Controlla gli aggiornamenti macOS

**Mensile:**
- Esamina l'utilizzo dello spazio e pulisci se necessario
- Aggiorna i browser se non si aggiornano automaticamente
- Verifica che le impostazioni delle notifiche funzionino ancora

## Integrazione con le Funzionalità macOS

### Integrazione con l'App Shortcuts
Crea scorciatoie personalizzate per OneUptime:
1. Apri l'app **Shortcuts**
2. Crea **Nuova Scorciatoia**
3. Aggiungi l'azione **"Apri app"**
4. Seleziona **OneUptime**
5. Aggiungi a Siri per l'attivazione vocale

### Integrazione con Terminal
Gestisci OneUptime tramite Terminal:

```bash
# Crea un alias per avviare rapidamente OneUptime
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# Funzione per verificare se OneUptime è in esecuzione
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## Sicurezza e Privacy

### Best Practice
1. **Aggiornamenti Regolari**: Mantieni macOS e i browser aggiornati
2. **Autenticazione Robusta**: Usa Touch ID/Face ID quando disponibile
3. **Sicurezza di Rete**: Usa la VPN per l'accesso remoto al monitoraggio
4. **Revisione dei Permessi**: Esamina regolarmente i permessi concessi
