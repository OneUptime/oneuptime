# CLI di OneUptime

La CLI di OneUptime è un'interfaccia a riga di comando per gestire le risorse OneUptime direttamente dal terminale. Supporta operazioni CRUD complete su monitor, incidenti, avvisi, pagine di stato e altro ancora.

## Funzionalità

- **Supporto multi-ambiente** con contesti denominati per produzione, staging e sviluppo
- **Auto-discovery** delle risorse disponibili dalla tua istanza OneUptime
- **Autenticazione flessibile** tramite flag CLI, variabili d'ambiente o contesti salvati
- **Formattazione dell'output intelligente** con modalità di visualizzazione JSON, tabella e wide
- **Programmabile** per pipeline CI/CD e flussi di lavoro di automazione

## Installazione

```bash
npm install -g @oneuptime/cli
```

## Avvio Rapido

```bash
# Autentica con la tua istanza OneUptime
oneuptime login <your-api-key> https://oneuptime.com

# Elenca i tuoi monitor
oneuptime monitor list

# Visualizza un incidente specifico
oneuptime incident get <incident-id>

# Vedi tutte le risorse disponibili
oneuptime resources
```

## Documentazione

| Guida                                                | Descrizione                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| [Autenticazione](./authentication.md)                | Login, contesti e gestione delle credenziali                |
| [Operazioni sulle Risorse](./resource-operations.md) | Operazioni CRUD su monitor, incidenti, avvisi e altro       |
| [Formati di Output](./output-formats.md)             | Modalità di output JSON, tabella e wide                     |
| [Scripting e CI/CD](./scripting.md)                  | Automazione, variabili d'ambiente e utilizzo nelle pipeline |
| [Riferimento Comandi](./command-reference.md)        | Riferimento completo per tutti i comandi e le opzioni       |

## Opzioni Globali

Questi flag possono essere usati con qualsiasi comando:

| Flag                    | Descrizione                                       |
| ----------------------- | ------------------------------------------------- |
| `--api-key <key>`       | Sostituisce la chiave API per questo comando      |
| `--url <url>`           | Sostituisce l'URL dell'istanza per questo comando |
| `--context <name>`      | Usa un contesto denominato specifico              |
| `-o, --output <format>` | Formato di output: `json`, `table`, `wide`        |
| `--no-color`            | Disabilita l'output colorato                      |
| `--help`                | Mostra la guida del comando                       |
| `--version`             | Mostra la versione della CLI                      |

## Ottenere Aiuto

```bash
# Guida generale
oneuptime --help

# Guida per un comando specifico
oneuptime monitor --help
oneuptime monitor list --help
```
