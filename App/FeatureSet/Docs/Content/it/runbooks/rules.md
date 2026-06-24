# Regole di runbook

Le regole di runbook collegano automaticamente i runbook quando viene creato un **incidente**, un **allarme** o un **evento di manutenzione programmata**. Si gestiscono dal menu Impostazioni di ciascuna entità:

- Incidenti → Impostazioni → **Regole di runbook**
- Allarmi → Impostazioni → **Regole di runbook**
- Manutenzione programmata → Impostazioni → **Regole di runbook**

Le tre pagine modificano lo stesso modello di regole sottostante — sono solo filtrate per mostrare le regole di quel tipo di entità.

## Anatomia di una regola

| Campo                   | Scopo                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| **Nome**                | Etichetta breve e leggibile. Compare nei log di audit.                                            |
| **Descrizione**         | Contesto opzionale per i colleghi.                                                                |
| **Abilitata**           | Toggle per sospendere una regola senza cancellarla.                                               |
| **Title Pattern**       | Regex case-insensitive confrontata col titolo dell'entità. Vuoto = qualsiasi titolo.              |
| **Description Pattern** | Regex case-insensitive confrontata con la descrizione dell'entità. Vuoto = qualsiasi descrizione. |
| **Runbook da avviare**  | Uno o più runbook da lanciare quando la regola scatta.                                            |

## Semantica del matching

Una regola corrisponde quando **tutti i criteri specificati passano**. I criteri vuoti vengono saltati, quindi:

- Una regola senza pattern impostati gira su ogni evento del suo tipo (una regola globale "esegui sempre").
- Una regola con solo un pattern di titolo scatta su eventi il cui titolo combacia con quella regex.
- Più regole possono corrispondere allo stesso evento — ogni match scatta, e l'unione dei loro runbook viene eseguita (ogni runbook ottiene la propria esecuzione).

## Esempio: failover DB per incidenti di database

```
Name:           Start DB failover for DB incidents
Trigger:        Incident
Title Pattern:  (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:       [DB failover playbook, Notify DBA team]
```

Questo creerà due esecuzioni di runbook ogni volta che viene creato un incidente con "db", "database", "postgres", ecc. nel titolo.

## Esempio: regola di igiene "esegui sempre"

```
Name:                 Always-run pre-flight check
Trigger:              Incident
Title Pattern:        (empty)
Description Pattern:  (empty)
Runbooks:             [Capture pre-incident state]
```

Scatta su ogni incidente — utile per catturare snapshot dello stato del sistema, metriche di pagina, ecc.

## Cosa succede quando una regola scatta

1. Il runbook viene caricato.
2. I suoi passi vengono **snapshottati** su una nuova esecuzione di runbook.
3. L'esecuzione viene messa in coda al worker della coda Runbook.
4. L'esecuzione viene legata all'entità sorgente — appare sulla pagina dell'incidente, allarme o manutenzione programmata e nell'elenco Esecuzioni del runbook.

Puoi vedere tutte le esecuzioni scatenate da regole in **Runbook → Esecuzioni**, filtrate per stato, runbook o data.

## Runbook disabilitati

Se una regola fa riferimento a un runbook con `isEnabled = false`, la regola corrisponde comunque ma l'esecuzione viene saltata. Riabilita il runbook per ripristinare il flusso.

## Testare una regola

Prima di affidarti a una regola in produzione, crea un incidente (o allarme) di test con un titolo che corrisponde al pattern e conferma che partano i runbook attesi. Le regole sono valutate al momento della creazione — modificare il titolo di un incidente in seguito non riattiva le regole.
