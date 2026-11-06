# Formatos de salida

La CLI imprime una tabla cuando usted lee su respuesta en una terminal, y JSON cuando la lee un script u otro programa. Elija el formato de cualquier comando con `-o` o `--output`, o pida JSON con `--json`.

:::cards
- [Cómo se elige el formato](#cómo-se-elige-el-formato): Una terminal recibe una tabla, una tubería recibe JSON.
- [Tabla](#tabla): Seis columnas, cada valor cortado a 60 caracteres.
- [JSON](#json): Cada campo, completo, para scripts, jq y agentes de IA.
- [Ancho](#ancho): Una tabla con todas las columnas.
:::

## Cómo se elige el formato

```mermaid title="Qué formato imprime un comando"
flowchart TB
    O{"¿Se indica -o<br/>o --output?"} -->|"sí"| F["Ese formato:<br/>table, json o wide"]
    O -->|"no"| T{"¿La salida es<br/>una terminal?"}
    T -->|"sí"| TB["table"]
    T -->|"no: una tubería<br/>o un archivo"| J["json"]
```

| Formato | Qué imprime | Ideal para |
| --- | --- | --- |
| `table` | Una tabla de hasta seis columnas; un solo registro como una fila por campo | Leer en una terminal |
| `json` | La respuesta tal como la envió OneUptime, con sangría de dos espacios | Scripts, `jq` y archivos |
| `wide` | Una tabla con una columna por cada campo | Comparar muchos campos de un vistazo |

`-o` y `--json` funcionan en cada comando, en cualquier parte de la línea de comandos. Un comando que imprime registros elige su formato como muestra el diagrama. Un comando cuya respuesta es una frase, como `delete` o `acknowledge`, imprime la frase, igual en una terminal que en una tubería, salvo que `-o json` o `--json` pida JSON. Cualquier otro valor de `-o` se rechaza antes de enviar una solicitud:

```text
error: option '-o, --output <format>' argument 'yaml' is invalid. Allowed choices are json, table, wide.
```

## Tabla

Una tabla es el formato predeterminado en una terminal. `oneuptime resources --type analytics`, por ejemplo, imprime esta:

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

Para una lista de registros, una tabla muestra hasta seis columnas: primero `_id`, `name`, `title`, `status`, `createdAt` y `updatedAt`, las que tengan los registros, y después los siguientes campos de los registros por orden. Las columnas se toman del primer registro. Un valor de más de 60 caracteres se corta a sus 57 primeros, seguidos de `...`.

Un solo registro, como lo imprimen `get` y `create`, es una tabla de dos columnas: el nombre del campo y su valor, una fila por campo.

OneUptime envía las fechas y los ID de otros registros como objetos, como `{"_type":"DateTime","value":"2026-10-14T09:12:44.000Z"}`, y una tabla los muestra como ese texto. Su valor está en `value`: consulte [JSON](#json).

## JSON

JSON es la respuesta tal como la envió OneUptime, con sangría de dos espacios: una lista es un array de registros, y un solo registro es un objeto.

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

Un registro tiene cada campo que la clave puede leer; este se ha recortado a cuatro. El `_id` propio de un registro es texto, y los demás ID y las fechas son objetos cuyo `value` los contiene:

```bash
oneuptime incident list -o json | jq -r '.[] | "\(.createdAt.value)  \(.title)"'
```

Cuando la salida no es una terminal, como en `oneuptime incident list | jq '.[].title'`, la CLI imprime JSON sin `-o json`. Escriba `-o json` en los scripts de todos modos, para que no dependan de ello.

`--json` es lo mismo que `-o json`. Un comando cuya respuesta es una frase responde entonces con un objeto: `delete` con el `_id` del registro y `"deleted": true`, `acknowledge` con el estado `state` en el que está el registro. Si se pide JSON, un error es un único objeto en la salida de error estándar, con las mismas claves cada vez, y `exitCode` es el código con el que termina el comando:

```bash
oneuptime incident get 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11 --json
```

```json
{"error":{"message":"API error (404): Incident not found.","status":404,"exitCode":3,"hint":"`oneuptime incident list` shows the ones this key may read."}}
```

## Ancho

`-o wide` es una tabla con una columna por cada campo de los registros. Cada valor se sigue cortando a 60 caracteres, y los registros tienen muchos campos, así que una tabla ancha es muy ancha: recórrala con `less -S`.

```bash
oneuptime incident list -o wide | less -S
```

## Colores

Los encabezados de las tablas son cian; los mensajes son verdes cuando algo funcionó, azules para la información, amarillos para las advertencias y para lo que hacer ante un error, y rojos para los errores. Desactive los colores con `--no-color`, o dando cualquier valor a `NO_COLOR`:

```bash
oneuptime incident list --no-color
NO_COLOR=1 oneuptime incident list
```

## Qué imprime cada comando

Los registros y los recuentos van a la salida estándar, y los errores y las advertencias a la salida de error estándar, así que una tubería lee solo la respuesta.

| Comando | En una tabla | En JSON |
| --- | --- | --- |
| Un `list` que no encuentra nada | `No results found.` | `[]` |
| Un `get` o un `create` | Una fila por campo | El registro |
| Un `count` | El número | El número |
| Un `update` | Una línea vacía | `{}` |
| Un `delete` | `Monitor <id> deleted successfully.` | El `_id` del registro y `"deleted": true` |
| Un `acknowledge`, `resolve`, `start` o `end` | `Incident <id> acknowledged: it is in Acknowledged now.` | El `_id` del registro, la `action`, si cambió (`changed`) y su `state` |
| Un error | El error, y luego qué hacer | `{"error": {...}}`, en la salida de error estándar |

## Próximos pasos

:::cards
- [Scripts y CI/CD](/docs/cli/scripting): Leer el JSON con jq en scripts y pipelines.
- [Operaciones de recursos](/docs/cli/resource-operations): Las operaciones cuyas respuestas son estas.
- [Referencia de comandos](/docs/cli/command-reference): Cada comando y cada opción.
:::
