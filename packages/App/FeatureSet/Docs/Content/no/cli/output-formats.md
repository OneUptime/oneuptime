# Utdataformater

CLI-en skriver ut en tabell når du leser svaret i en terminal, og JSON når et skript eller et annet program leser det. Velg formatet for en hvilken som helst kommando med `-o` eller `--output`, eller be om JSON med `--json`.

:::cards
- [Slik velges formatet](#slik-velges-formatet): En terminal får en tabell, en pipe får JSON.
- [Tabell](#tabell): Seks kolonner, hver verdi kuttet ved 60 tegn.
- [JSON](#json): Hvert felt, helt, for skript, jq og AI-agenter.
- [Bred](#bred): En tabell med alle kolonner.
:::

## Slik velges formatet

```mermaid title="Hvilket format en kommando skriver ut"
flowchart TB
    O{"Er -o eller --output<br/>oppgitt?"} -->|"ja"| F["Det formatet:<br/>table, json eller wide"]
    O -->|"nei"| T{"Er utdataene<br/>en terminal?"}
    T -->|"ja"| TB["table"]
    T -->|"nei: en pipe<br/>eller en fil"| J["json"]
```

| Format | Hva det skriver ut | Best for |
| --- | --- | --- |
| `table` | En tabell med opptil seks kolonner; én post som én rad per felt | Å lese i en terminal |
| `json` | Svaret slik OneUptime sendte det, rykket inn med to mellomrom | Skript, `jq` og filer |
| `wide` | En tabell med en kolonne for hvert felt | Å sammenligne mange felt på et øyeblikk |

`-o` og `--json` virker på hver kommando, hvor som helst på kommandolinjen. En kommando som skriver ut poster, velger format slik diagrammet viser. En kommando der svaret er en setning, for eksempel `delete` eller `acknowledge`, skriver ut setningen, både i en terminal og i en pipe, med mindre `-o json` eller `--json` ber om JSON. Enhver annen verdi av `-o` avvises før en forespørsel sendes:

```text
error: option '-o, --output <format>' argument 'yaml' is invalid. Allowed choices are json, table, wide.
```

## Tabell

En tabell er standard i en terminal. `oneuptime resources --type analytics` skriver for eksempel ut denne:

```text
┌────────────────────────────┬────────────────────────────┬─────────────────────────────┬───────────┬─────────────────────────────┐
│ Command                    │ Singular                   │ Plural                      │ Type      │ API Path                    │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ audit-log                  │ Audit Log                  │ Audit Logs                  │ analytics │ /audit-log                  │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ change-event               │ Change Event               │ Change Events               │ analytics │ /change-events              │
├────────────────────────────┼────────────────────────────┼─────────────────────────────┼───────────┼─────────────────────────────┤
│ cloud-cost                 │ Cloud Cost                 │ Cloud Costs                 │ analytics │ /cloud-cost                 │
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

Total: 15 resources
```

For en liste med poster viser en tabell opptil seks kolonner: først `_id`, `name`, `title`, `status`, `createdAt` og `updatedAt`, de av dem postene har, så postenes neste felt i rekkefølge. Kolonnene hentes fra den første posten. En verdi som er lengre enn 60 tegn, kuttes til de første 57, etterfulgt av `...`.

Én post, slik `get` og `create` skriver den ut, er en tabell med to kolonner: feltets navn og verdien, én rad per felt.

OneUptime sender datoer og ID-ene til andre poster som objekter, for eksempel `{"_type":"DateTime","value":"2026-10-14T09:12:44.000Z"}`, og en tabell viser dem som den teksten. Verdien deres står i `value`: se [JSON](#json).

## JSON

JSON er svaret slik OneUptime sendte det, rykket inn med to mellomrom: en liste er et array med poster, og én post er et objekt.

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

En post har hvert felt nøkkelen kan lese; denne er kuttet ned til fire. En posts egen `_id` er tekst, og de andre ID-ene og datoene er objekter der `value` inneholder dem:

```bash
oneuptime incident list -o json | jq -r '.[] | "\(.createdAt.value)  \(.title)"'
```

Når utdataene ikke er en terminal, som i `oneuptime incident list | jq '.[].title'`, skriver CLI-en ut JSON uten `-o json`. Skriv likevel `-o json` i skript, så de ikke er avhengige av det.

`--json` er det samme som `-o json`. En kommando der svaret er en setning, svarer da med et objekt: `delete` med `_id` til posten og `"deleted": true`, `acknowledge` med tilstanden `state` posten er i. Blir det bedt om JSON, er en feil ett objekt på standard feil, med de samme nøklene hver gang, og `exitCode` er koden kommandoen avslutter med:

```bash
oneuptime incident get 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11 --json
```

```json
{"error":{"message":"API error (404): Incident not found.","status":404,"exitCode":3,"hint":"`oneuptime incident list` shows the ones this key may read."}}
```

## Bred

`-o wide` er en tabell med en kolonne for hvert felt i postene. Hver verdi kuttes fortsatt ved 60 tegn, og poster har mange felt, så en bred tabell er svært bred: bla gjennom den med `less -S`.

```bash
oneuptime incident list -o wide | less -S
```

## Farger

Tabelloverskrifter er cyan; meldinger er grønne når noe lyktes, blå for informasjon, gule for advarsler og for hva du kan gjøre med en feil, og røde for feil. Slå av farger med `--no-color`, eller ved å sette `NO_COLOR` til en hvilken som helst verdi:

```bash
oneuptime incident list --no-color
NO_COLOR=1 oneuptime incident list
```

## Hva hver kommando skriver ut

Poster og antall går til standard utdata, og feil og advarsler til standard feil, så en pipe leser bare svaret.

| Kommando | I en tabell | I JSON |
| --- | --- | --- |
| En `list` som ikke finner noe | `No results found.` | `[]` |
| En `get` eller en `create` | En rad per felt | Posten |
| En `count` | Tallet | Tallet |
| En `update` | En tom linje | `{}` |
| En `delete` | `Monitor <id> deleted successfully.` | `_id` til posten og `"deleted": true` |
| En `acknowledge`, `resolve`, `start` eller `end` | `Incident <id> acknowledged: it is in Acknowledged now.` | `_id` til posten, `action`, om den ble endret (`changed`), og `state` |
| En feil | Feilen, og så hva du kan gjøre med den | `{"error": {...}}`, på standard feil |

## Neste steg

:::cards
- [Skripting og CI/CD](/docs/cli/scripting): Les JSON-en med jq i skript og pipelines.
- [Ressursoperasjoner](/docs/cli/resource-operations): Operasjonene som dette er svarene fra.
- [Kommandoreferanse](/docs/cli/command-reference): Hver kommando og hvert alternativ.
:::
