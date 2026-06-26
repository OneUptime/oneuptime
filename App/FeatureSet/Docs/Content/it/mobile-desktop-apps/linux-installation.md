# Guida all'Installazione su Linux

Installa OneUptime come applicazione desktop sulle distribuzioni Linux per un monitoraggio e una gestione degli incidenti completi.

## Metodi di Installazione

### Metodo 1: Google Chrome/Chromium (Consigliato)

Chrome e Chromium offrono la migliore esperienza PWA su Linux con integrazione nativa del desktop.

#### Passaggi di Installazione PWA:

1. **Apri OneUptime in Chrome/Chromium**

   - Avvia il tuo browser
   - Naviga all'URL della tua istanza OneUptime
   - Accedi al tuo account OneUptime
   - Attendi il caricamento completo della pagina

2. **Installa la PWA**

   - Cerca l'**icona di installazione** (⊞) nella barra degli indirizzi
   - Clicca su **"Installa OneUptime"**
   - Oppure usa il **menu Chrome** (⋮) → **Altri strumenti** → **Crea scorciatoia**

3. **Opzioni di Installazione**

   - Seleziona **"Apri come finestra"** per un'esperienza app nativa
   - Personalizza il nome dell'app se desiderato
   - Scegli la creazione di una scorciatoia sul desktop
   - Clicca su **"Installa"** o **"Crea"**

4. **Avvia l'App**
   - Trova OneUptime nel launcher delle applicazioni
   - Oppure usa la scorciatoia sul desktop
   - L'app si apre in una finestra dedicata

### Metodo 2: Firefox

Firefox supporta l'installazione PWA su Linux con integrazione di base del desktop.

1. **Installazione PWA**:
   - Apri OneUptime in Firefox
   - Cerca il banner o il prompt di installazione
   - Clicca su **"Installa"** quando disponibile
   - Nota: Integrazione desktop limitata rispetto a Chrome

### Metodo 3: Microsoft Edge

Edge è disponibile su Linux e offre un buon supporto PWA.

1. **Installa la PWA**: Segui gli stessi passaggi del metodo Chrome

## Aggiornamenti e Manutenzione

### Aggiornamenti Automatici

La PWA di OneUptime si aggiorna automaticamente:

- Gli aggiornamenti si applicano quando il browser aggiorna l'app
- Gli aggiornamenti critici di sicurezza vengono distribuiti immediatamente
- Non è richiesto alcun intervento manuale

## Disinstallazione

### Rimozione Specifica per Browser

```bash
# Gestione PWA Chrome
google-chrome chrome://apps/

# Rimuovi tutti i dati del browser relativi a OneUptime
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```

## Aggiornamenti e Manutenzione

### Aggiornamenti Automatici

La PWA di OneUptime si aggiorna automaticamente:

- Gli aggiornamenti si applicano quando il browser aggiorna l'app
- Gli aggiornamenti critici di sicurezza vengono distribuiti immediatamente
- Non è richiesto alcun intervento manuale
