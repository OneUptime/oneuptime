# Regole di runbook

Le regole di runbook collegano automaticamente i runbook quando viene creato un **incidente**, un **allarme** o un **evento di manutenzione programmata**. Si gestiscono dal menu Impostazioni di ciascuna entità:

- Incidenti → Impostazioni → **Regole di runbook**
- Allarmi → Impostazioni → **Regole di runbook**
- Manutenzione programmata → Impostazioni → **Regole di runbook**

Tutte e tre le pagine modificano lo stesso modello di regola sottostante — sono semplicemente filtrate per mostrare solo le regole del tipo di entità corrispondente.

## Anatomia di una regola

| Campo | Funzione |
| --- | --- |
| **Nome** | Etichetta breve e leggibile. Compare nei log di audit. |
| **Descrizione** | Contesto facoltativo per il team. |
| **Abilitata** | Interruttore per sospendere una regola senza cancellarla. |
| **Pattern titolo** | Regex case-insensitive confrontata con il titolo dell'entità. Vuoto = qualsiasi titolo corrisponde. |
| **Pattern descrizione** | Regex case-insensitive confrontata con la descrizione dell'entità. Vuoto = qualsiasi descrizione corrisponde. |
| **Runbook da avviare** | Uno o più runbook da lanciare quando la regola scatta. |

## Semantica della corrispondenza

Una regola corrisponde quando **tutti i criteri specificati sono soddisfatti**. I criteri vuoti vengono saltati:

- Una regola senza pattern si applica a ogni evento del suo tipo (regola globale "esegui sempre").
- Una regola con solo un pattern di titolo scatta per gli eventi il cui titolo corrisponde alla regex.
- Più regole possono corrispondere allo stesso evento — ogni corrispondenza scatta e si esegue l'unione dei loro runbook (ogni runbook ottiene la sua esecuzione).

## Esempio: failover DB per incidenti di base dati

```
Nome:              Avvia failover DB per incidenti DB
Trigger:           Incidente
Pattern titolo:    (?:^|\b)(db|database|postgres|mysql|mongo)
Runbook:           [Playbook failover DB, Avvisa team DBA]
```

Crea due esecuzioni di runbook ogni volta che viene creato un incidente con "db", "database", "postgres", ecc. nel titolo.

## Esempio: regola di igiene sempre attiva

```
Nome:                       Controllo pre-volo a ogni incidente
Trigger:                    Incidente
Pattern titolo:             (vuoto)
Pattern descrizione:        (vuoto)
Runbook:                    [Cattura stato pre-incidente]
```

Scatta a ogni incidente — utile per catturare snapshot dello stato di sistema, metriche di pagina ecc.

## Cosa succede quando una regola scatta

1. Il runbook viene caricato.
2. I suoi passi vengono copiati come **snapshot** in una nuova esecuzione di runbook.
3. L'esecuzione viene messa in coda sul worker Runbook.
4. L'esecuzione è collegata all'entità d'origine — appare sulla pagina dell'incidente, dell'allarme o della manutenzione e nell'elenco delle esecuzioni del runbook.

Vedi tutti i lanci scatenati da regole in **Runbook → Esecuzioni**, filtrabili per stato, runbook o data.

## Runbook disabilitati

Se una regola fa riferimento a un runbook con `isEnabled = false`, la regola corrisponde comunque ma l'esecuzione viene saltata. Riabilita il runbook per ripristinare il flusso.

## Testare una regola

Prima di fare affidamento su una regola in produzione, crea un incidente (o allarme) di test con un titolo che corrisponde al pattern e verifica che i runbook attesi scattino. Le regole sono valutate al momento della creazione — modificare in seguito il titolo di un incidente non riattiva le regole.
