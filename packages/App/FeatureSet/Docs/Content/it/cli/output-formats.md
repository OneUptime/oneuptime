# Formati di output

La CLI stampa una tabella quando leggi la sua risposta in un terminale, e JSON quando la legge uno script o un altro programma. Scegli il formato di qualsiasi comando con `-o` o `--output`, oppure chiedi JSON con `--json`.

:::cards
- [Come si sceglie il formato](#come-si-sceglie-il-formato): Un terminale riceve una tabella, una pipe riceve JSON.
- [Tabella](#tabella): Sei colonne, ogni valore tagliato a 60 caratteri.
- [JSON](#json): Ogni campo, intero, per gli script, jq e gli agenti IA.
- [Ampio](#ampio): Una tabella con tutte le colonne.
:::

## Come si sceglie il formato

```mermaid title="Quale formato stampa un comando"
flowchart TB
    O{"È indicato -o<br/>o --output?"} -->|"sì"| F["Quel formato:<br/>table, json o wide"]
    O -->|"no"| T{"L'output è<br/>un terminale?"}
    T -->|"sì"| TB["table"]
    T -->|"no: una pipe<br/>o un file"| J["json"]
```

| Formato | Che cosa stampa | Ideale per |
| --- | --- | --- |
| `table` | Una tabella di al massimo sei colonne; un singolo record come una riga per campo | Leggere in un terminale |
| `json` | La risposta così come OneUptime l'ha inviata, rientrata di due spazi | Script, `jq` e file |
| `wide` | Una tabella con una colonna per ogni campo | Confrontare molti campi a colpo d'occhio |

`-o` e `--json` funzionano su ogni comando, in qualsiasi punto della riga di comando. Un comando che stampa record sceglie il suo formato come mostra il diagramma. Un comando la cui risposta è una frase, come `delete` o `acknowledge`, stampa la frase, sia in un terminale sia in una pipe, a meno che `-o json` o `--json` non chieda JSON. Qualsiasi altro valore di `-o` viene rifiutato prima che una richiesta parta:

```text
error: option '-o, --output <format>' argument 'yaml' is invalid. Allowed choices are json, table, wide.
```

## Tabella

La tabella è il formato predefinito in un terminale. `oneuptime resources --type analytics`, per esempio, stampa questa:

```text
┌────────────────────────────┬────────────────────────────┬─────────────────────────────┬───────────┬─────────────────────────────┐
│ Command                    │ Singular                   │ Plural                      │ Type      │ API Path                    │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ audit-log                  │ Audit Log                  │ Audit Logs                  │ analytics │ /audit-log                  │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ change-event               │ Change Event               │ Change Events               │ analytics │ /change-events              │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ exception-instance         │ Exception Instance         │ Exception Instances         │ analytics │ /exceptions                 │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ kubernetes-cost-allocation │ Kubernetes Cost Allocation │ Kubernetes Cost Allocations │ analytics │ /kubernetes-cost-allocation │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ log                        │ Log                        │ Logs                        │ analytics │ /logs                       │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ metric                     │ Metric                     │ Metrics                     │ analytics │ /metrics                    │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ monitor-log                │ Monitor Log                │ Monitor Logs                │ analytics │ /monitor-log                │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ network-flow               │ Network Flow               │ Network Flows               │ analytics │ /network-flow               │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ profile                    │ Profile                    │ Profiles                    │ analytics │ /profile                    │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ profile-sample             │ ProfileSample              │ ProfileSamples              │ analytics │ /profile-sample             │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ security-event             │ Security Event             │ Security Events             │ analytics │ /security-events            │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ slo-history                │ SLO History                │ SLO History                 │ analytics │ /slo-history                │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ span                       │ Span                       │ Spans                       │ analytics │ /span                       │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ threat-intel-indicator     │ Threat Intel Indicator     │ Threat Intel Indicators     │ analytics │ /threat-intel-indicators    │
└────────────────────────────┴────────────────────────────┴─────────────────────────────┴───────────┴─────────────────────────────┘

Total: 14 resources
```

Per un elenco di record, una tabella mostra al massimo sei colonne: prima `_id`, `name`, `title`, `status`, `createdAt` e `updatedAt`, quelle che i record hanno, poi i campi successivi dei record nell'ordine. Le colonne vengono prese dal primo record. Un valore più lungo di 60 caratteri viene tagliato ai suoi primi 57, seguiti da `...`.

Un singolo record, come lo stampano `get` e `create`, è una tabella di due colonne: il nome del campo e il suo valore, una riga per campo.

OneUptime invia le date e gli ID di altri record come oggetti, come `{"_type":"DateTime","value":"2026-10-14T09:12:44.000Z"}`, e una tabella li mostra come quel testo. Il loro valore è in `value`: vedi [JSON](#json).

## JSON

Il JSON è la risposta così come OneUptime l'ha inviata, rientrata di due spazi: un elenco è un array di record, e un singolo record è un oggetto.

```bash
oneuptime incident list --limit 1 -o json
```

```json
[
  {
    "_id": "6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11",
    "createdAt": {
      "_type": "DateTime",
      "value": "2026-10-14T09:12:44.000Z"
    },
    "title": "Checkout API is down",
    "currentIncidentStateId": {
      "_type": "ObjectID",
      "value": "0b7d5e2c-8f4a-4d1b-9c3e-5a6f7b8c9d0e"
    }
  }
]
```

Un record ha ogni campo che la chiave può leggere; questo è ridotto a quattro. L'`_id` proprio di un record è testo, e gli altri ID e le date sono oggetti il cui `value` li contiene:

```bash
oneuptime incident list -o json | jq -r '.[] | "\(.createdAt.value)  \(.title)"'
```

Quando l'output non è un terminale, come in `oneuptime incident list | jq '.[].title'`, la CLI stampa JSON senza `-o json`. Scrivi comunque `-o json` negli script, così non dipendono da questo.

`--json` è lo stesso di `-o json`. Un comando la cui risposta è una frase risponde invece con un oggetto: `delete` con l'`_id` del record e `"deleted": true`, `acknowledge` con lo stato `state` in cui si trova il record. Quando si chiede JSON, un errore è un singolo oggetto sullo standard error, ogni volta con le stesse chiavi, ed `exitCode` è il codice con cui il comando termina:

```bash
oneuptime incident get 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11 --json
```

```json
{"error":{"message":"API error (404): Incident not found.","status":404,"exitCode":3,"hint":"`oneuptime incident list` shows the ones this key may read."}}
```

## Ampio

`-o wide` è una tabella con una colonna per ogni campo dei record. Ogni valore viene comunque tagliato a 60 caratteri, e i record hanno molti campi, quindi una tabella ampia è molto larga: scorrila con `less -S`.

```bash
oneuptime incident list -o wide | less -S
```

## Colori

Le intestazioni delle tabelle sono ciano; i messaggi sono verdi quando qualcosa ha funzionato, blu per le informazioni, gialli per gli avvisi e per che cosa fare di fronte a un errore, e rossi per gli errori. Disattiva i colori con `--no-color`, oppure impostando `NO_COLOR` a un valore qualsiasi:

```bash
oneuptime incident list --no-color
NO_COLOR=1 oneuptime incident list
```

## Che cosa stampa ogni comando

I record e i conteggi vanno sullo standard output, e gli errori e gli avvisi sullo standard error, così una pipe legge solo la risposta.

| Comando | In una tabella | In JSON |
| --- | --- | --- |
| Un `list` che non trova nulla | `No results found.` | `[]` |
| Un `get` o un `create` | Una riga per campo | Il record |
| Un `count` | Il numero | Il numero |
| Un `update` | Una riga vuota | `{}` |
| Un `delete` | `Monitor <id> deleted successfully.` | L'`_id` del record e `"deleted": true` |
| Un `acknowledge`, `resolve`, `start` o `end` | `Incident <id> acknowledged: it is in Acknowledged now.` | L'`_id` del record, l'`action`, se è cambiato (`changed`) e il suo `state` |
| Un errore | L'errore, poi che cosa fare | `{"error": {...}}`, sullo standard error |

## Passi successivi

:::cards
- [Scripting e CI/CD](/docs/cli/scripting): Leggere il JSON con jq in script e pipeline.
- [Operazioni sulle risorse](/docs/cli/resource-operations): Le operazioni di cui queste sono le risposte.
- [Riferimento dei comandi](/docs/cli/command-reference): Ogni comando e ogni opzione.
:::
