# Observabilidad de IA / LLM con OneUptime

Lee cada conversación que tuvo tu IA, vuelve a reproducirla tal como ocurrió y entérate cuando responde mal. Todo funciona sobre OpenTelemetry estándar, sin SDK propietario: si tu aplicación emite spans con las **convenciones semánticas GenAI** de OpenTelemetry (`gen_ai.*`), OneUptime los convierte en conversaciones, alertas, uso y costos.

## Lo que obtienes

Abre **IA / LLM** en la barra de navegación, bajo Observabilidad:

- **Conversaciones** — cada conversación que tuvo tu IA: lo que preguntó la gente, lo que respondió la IA, las herramientas que usó y lo que salió mal. Sobre la lista hay cinco cifras: conversaciones, respuestas de la IA, cuántas necesitan atención, costo y cuánto tarda normalmente una respuesta. Abre una conversación para leerla o volver a reproducirla.
- **Llamadas** — cada llamada de LLM, embedding, agente y herramienta, filtrable por servicio, proveedor, modelo, operación, persona y equipo. Haz clic en una llamada para abrirla en el visor de trazas.
- **Uso** — las llamadas, los tokens y el costo de un periodo, y quién gasta qué: empleados, equipos, modelos, proveedores y aplicaciones ordenados por gasto.
- **Alertas** — alertas listas para usar para cuando la IA responde mal, y tus monitores de IA / LLM.
- **Presupuestos** — límites de costo diarios, publicados como métricas sobre las que alertar.
- **Precios** — tus propios precios por modelo, para los modelos que el catálogo integrado no conoce.
- **Configuración** — los cinco pasos de abajo, con el endpoint de tu proyecto.

En el visor de trazas, el span de cada llamada a la IA también tiene un panel **IA / LLM** con el modelo, el número de tokens, el costo, los parámetros de la solicitud, y el prompt y la respuesta.

## Paso 1 — Envía tus llamadas a la IA

Crea una clave de ingesta de telemetría: abre **Ajustes del proyecto → Telemetría y APM → Claves de ingesta** y haz clic en **Crear clave de ingesta**. Tu aplicación envía la clave como cabecera OTLP. (Consulta la [guía de OpenTelemetry](/docs/telemetry/open-telemetry) para ver capturas de pantalla.)

Después instrumenta tu aplicación con cualquier biblioteca GenAI de OpenTelemetry:

- **OpenLLMetry** (Traceloop) — OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI y más.
- **OpenInference** (Arize) — OpenAI, LangChain, LlamaIndex, DSPy y más.
- El **Vercel AI SDK**, o las **instrumentaciones de OpenTelemetry** para OpenAI, Anthropic y Gemini.

¿Enrutas tu tráfico de LLM a través de un gateway como **LiteLLM** o **Portkey**? Exporta las trazas desde el gateway en lugar de instrumentar cada aplicación — consulta [Observar gateways de IA](/docs/telemetry/ai-gateways). ¿Buscas los asistentes de programación que usan tus ingenieros — Claude Code, Cursor, Codex, Gemini CLI, Copilot? Exportan su propio OpenTelemetry y no necesitan nada de ti: consulta [Observabilidad de asistentes de programación con IA](/docs/telemetry/ai-coding-assistants).

### Python (OpenLLMetry)

```bash
pip install traceloop-sdk opentelemetry-exporter-otlp
```

```python
from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",   # or your self-hosted host + /otlp
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

# Your normal OpenAI / Anthropic / LangChain calls are now traced automatically.
```

### Node.js / TypeScript (OpenLLMetry)

```bash
npm install @traceloop/node-server-sdk
```

```ts
import * as traceloop from "@traceloop/node-server-sdk";

traceloop.initialize({
  appName: "my-ai-agent",
  baseUrl: "https://oneuptime.com/otlp", // or your self-hosted host + /otlp
  headers: { "x-oneuptime-token": "YOUR_INGESTION_TOKEN" },
});
```

### Variables de entorno de OpenTelemetry sin más

Si instrumentas con un SDK nativo de OpenTelemetry, apunta el exportador OTLP a OneUptime:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

¿Alojas OneUptime tú mismo? Sustituye `https://oneuptime.com/otlp` por `https://YOUR-ONEUPTIME-HOST/otlp`.

## Paso 2 — Registra lo que se dijo

Una conversación muestra lo que preguntó la gente y lo que respondió la IA cuando tu instrumentación lo registra. OpenLLMetry registra los prompts y las respuestas a menos que lo desactives (`TRACELOOP_TRACE_CONTENT=false`). Las instrumentaciones de OpenTelemetry solo los registran cuando lo pides:

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

Sin ellos, una conversación sigue mostrando sus tiempos, su costo y sus problemas, e indica que su contenido no se registró. Los prompts pueden contener datos sensibles: consulta [Privacidad y redacción](#privacidad-y-redacción) para enmascararlos antes de que se guarden.

## Paso 3 — Agrupa las llamadas en conversaciones

Una aplicación de chat hace una llamada al modelo por turno. Pon `gen_ai.conversation.id` — o `session.id` — con el id de tu chat en cada llamada a la IA, y cada chat aparece como una sola conversación, sin importar cuántas llamadas y trazas haya necesitado. Con OpenLLMetry, defínelo una vez por solicitud como propiedad de asociación:

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

Las llamadas sin id de conversación también aparecen, una solicitud (una traza) cada vez.

## Paso 4 — Indica quién preguntó

Define `user.id` o `user.email` — la propiedad de asociación de arriba define el correo — para ver con quién fue cada conversación, buscar en la lista por persona y ordenar el gasto por empleado en la pestaña Uso. [Atribución a empleados y equipos](#atribución-a-empleados-y-equipos) enumera todas las claves que lee OneUptime.

## Paso 5 — Marca las malas respuestas

OneUptime revisa cada respuesta en cuanto llega y marca lo que salió mal:

| Problema  | Qué significa                                              | Se detecta por                                                                                                                                                                  |
| --------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fallido   | La llamada terminó en un error, así que no llegó respuesta | Estado de span Error, `error.type`, o un motivo de finalización `error`                                                                                                         |
| Rechazado | La IA se negó, o un filtro de seguridad la bloqueó         | Un motivo de finalización de rechazo o de seguridad (`content_filter`, `refusal`, `SAFETY` y similares), un rechazo en la respuesta, o una respuesta que empieza con un rechazo típico en inglés |
| Cortado   | La respuesta se detuvo en el límite de tokens              | Un motivo de finalización `length`, `max_tokens` o `MAX_TOKENS`                                                                                                                 |
| Vacío     | La IA respondió sin texto y sin llamada a herramienta      | Contenido registrado que no contiene nada, o 0 tokens de salida                                                                                                                 |
| Marcado   | Una evaluación que envió tu aplicación dijo que la respuesta era mala | Un evento `gen_ai.evaluation.result`                                                                                                                                 |

Los cuatro primeros no necesitan nada de ti. Para marcar el resto — una respuesta que rechaza tu guardrail, tu eval o tu propio juez LLM —, añade un evento `gen_ai.evaluation.result` al span de la respuesta, con `gen_ai.evaluation.score.label` igual a `fail`:

```python
from opentelemetry import trace

trace.get_current_span().add_event(
    "gen_ai.evaluation.result",
    {
        "gen_ai.evaluation.name": "relevance",
        "gen_ai.evaluation.score.label": "fail",
        "gen_ai.evaluation.explanation": "The answer is about another product.",
    },
)
```

Etiquetas como `incorrect`, `wrong`, `unhelpful`, `toxic`, `unsafe` y `hallucination` también cuentan como fallo. El evento tiene que estar en el span de la respuesta que juzga, mientras ese span está abierto.

OneUptime nunca envía tus conversaciones a otra IA para juzgarlas: cada comprobación lee solo lo que lleva la propia llamada.

## Leer y volver a reproducir una conversación

Una conversación se abre completa, como una aplicación de chat muestra su historial: lo que dijo la persona a la derecha, las respuestas de la IA a la izquierda con su modelo, hora, tokens y costo, las llamadas a herramientas entre ellas, y lo que salió mal marcado donde ocurrió. **Detalles** bajo una respuesta muestra su motivo de finalización y sus evaluaciones, con un enlace a la llamada en Trazas.

La barra de abajo reproduce la conversación tal como la vivió la persona:

- **Volver a reproducir** la reproduce desde el primer mensaje al ritmo en que ocurrió, con «La IA está respondiendo…» contando mientras una respuesta va en camino. Haz clic en la hora de cualquier mensaje para reproducir desde ahí.
- **Saltar esperas**, activado por defecto, acorta los silencios de más de 3 segundos. El botón de velocidad reproduce a 1×, 2×, 4× u 8×.
- **K** reproduce o pausa, **J** o **←** retrocede un mensaje, y **L** o **→** avanza uno.
- La dirección guarda el mensaje en el que se detuvo una reproducción (`?step=`), así que un enlace se abre en ese momento.

## Entérate cuando la IA responde mal

La pestaña **Alertas** ofrece las alertas que quieren la mayoría de las aplicaciones de IA. Al elegir una se abre Crear monitor ya rellenado, donde puedes cambiar cualquier cosa antes de guardar:

| Alerta                      | Cuándo te avisa                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| Las respuestas fallan       | Más del 5 % de las respuestas en 15 minutos fallan, son rechazadas, cortadas, vacías o marcadas |
| Las llamadas a la IA fallan | Más del 10 % de las llamadas al modelo en 5 minutos terminan en error                            |
| La IA se niega a responder  | Más del 5 % de las respuestas en 30 minutos son rechazos                                         |
| Las respuestas se cortan    | 3 o más respuestas en 30 minutos se detienen en el límite de tokens                              |
| Las respuestas se marcan    | Una evaluación marca una respuesta como mala                                                     |
| Las respuestas son lentas   | Más del 10 % de las respuestas en 15 minutos tardan más de 30 segundos                           |
| La IA deja de responder     | La IA no da ninguna respuesta durante 30 minutos                                                 |

Las alertas sobre una proporción también esperan al menos 3 malas respuestas, para que una mala respuesta de cada dos no despierte a nadie.

Cada alerta es un monitor de **IA / LLM**. Sus ajustes indican qué cuenta como mala respuesta — los problemas de arriba, una respuesta más lenta que un límite que tú fijas, o ambos —, qué aplicaciones y qué modelo vigila, y cuánto mira hacia atrás cada comprobación. Debajo, una vista previa muestra lo que contaría el monitor ahora mismo. Sus criterios comparan tres números: la **proporción de malas respuestas** (en %), el **número de malas respuestas** y el **número de respuestas**. Una alerta lista para usar genera una alerta que se resuelve sola y muestra el monitor como Degradado mientras las respuestas son malas; activa su incidente para avisar a alguien.

El gasto lo vigilan los [presupuestos de costo diarios](#presupuestos-de-costo-diarios).

## Atributos que reconoce OneUptime

OneUptime lee primero las convenciones GenAI de OpenTelemetry y recurre a las variantes de OpenLLMetry y OpenInference para que las bibliotecas populares funcionen sin configuración.

| Qué                                 | Atributo principal           | También se acepta                                                                                                                                                                                                                                                         |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proveedor / sistema                 | `gen_ai.provider.name`       | `gen_ai.system` (obsoleto en las convenciones, aún muy emitido), `llm.system`, `llm.provider`                                                                                                                                                                            |
| Operación                           | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                                                                                                             |
| Modelo solicitado                   | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                                                                                                                     |
| Modelo de la respuesta              | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| Tokens de entrada                   | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                                                                                                                         |
| Tokens de salida                    | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                                                                                                             |
| Tokens totales                      | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens`; se derivan de entrada + salida cuando no se informa ninguno                                                                                                                                                            |
| Costo (USD)                         | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total`                                                                                                                                      |
| Nombre del agente                   | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| Nombre de la herramienta            | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| Id de conversación / sesión         | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                                                                                                                        |
| Empleado (quien hizo la llamada)    | `user.id`                    | `enduser.id`, `litellm.metadata.user_api_key_user_id` y `metadata.user_api_key_user_id` (grafías de LiteLLM OTel v2 y v1 — se leen ambas), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| Correo del empleado                 | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                                                                                                            |
| Equipo / centro de costos           | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id` y `litellm.team.id` (LiteLLM OTel v2), `metadata.user_api_key_team_id` (LiteLLM OTel v1), `cursor.team.id`                                                                                   |

Las subclaves de `traceloop.association.properties.*` las **proporciona quien llama**: Traceloop define el prefijo, y tu código aporta lo que va debajo. `gen_ai.usage.total_tokens` y `gen_ai.usage.cost` son claves **de facto**, no convenciones semánticas GenAI — las convenciones no definen ningún atributo de tokens totales ni de costo —, y OneUptime las lee porque las instrumentaciones habituales las emiten. `gen_ai.system` es el predecesor obsoleto de `gen_ai.provider.name` en las propias convenciones; se leen ambos.

**Las tres filas de identidad también se buscan con un prefijo `resource.`.** La ingesta OTLP aplana cada atributo de _recurso_ en el mapa de atributos del span bajo un prefijo `resource.`, así que `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` llega como `resource.team.id`. OneUptime busca primero en toda la lista sin prefijo y después en toda la lista `resource.`, de modo que un atributo de span (que describe una llamada) gana a un atributo de recurso (que describe todo el proceso). Las demás filas solo se buscan por la clave sin prefijo: son valores por llamada.

**El contenido de prompts y respuestas** se lee del evento `gen_ai.client.inference.operation.details`; de los atributos de span `gen_ai.input.messages`, `gen_ai.output.messages` y `gen_ai.system_instructions`; de los eventos por rol **obsoletos** que las instrumentaciones antiguas aún emiten (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`); de los atributos indexados (`gen_ai.prompt.N.content` y `gen_ai.completion.N.content`, y en OpenInference `llm.input_messages.N.message.content` y `llm.output_messages.N.message.content`); y de los arrays de mensajes JSON (`gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`).

### Cómo se calcula el costo

Si tu instrumentación informa un costo (`gen_ai.usage.cost`), OneUptime lo usa tal cual: el valor informado siempre gana. Cuando no se informa ningún costo, OneUptime calcula un **costo estimado en la ingesta** a partir del número de tokens del span y de un catálogo integrado de precios de lista de los modelos habituales de OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova y Meta Llama. Los modelos se reconocen por el prefijo del nombre, así que las instantáneas con fecha como `gpt-4o-2024-08-06` y los ids decorados por el proveedor como `us.anthropic.claude-3-5-sonnet-20241022-v2:0` se resuelven correctamente. Los modelos desconocidos o personalizados nunca se adivinan — su costo se queda en `0` hasta que les pongas un precio en la pestaña **Precios**. Las estimaciones usan precios de lista y no tienen en cuenta descuentos de caché ni por lotes.

¿Alojas OneUptime tú mismo? El catálogo está en `packages/Common/Types/Telemetry/LlmCostCatalog.ts`.

## Atribución a empleados y equipos

«¿Cuál de nuestros ingenieros gastó 4000 $ en Opus el mes pasado?» es una pregunta sobre una persona, y ningún span de LLM la responde a menos que algo en el span nombre a alguien. OneUptime copia al actor humano en columnas consultables durante la ingesta, así que agrupas y filtras por una columna en lugar de escribir búsquedas de atributos.

Las tres filas de identidad de la tabla de arriba son todo el mecanismo; gana la primera clave presente, en el orden indicado. `user.id` va primero porque es la clave canónica de OpenTelemetry para un actor humano y la que conviene estandarizar si defines la identidad tú mismo. **Una excepción: Claude Code** emite `user.id` como un identificador anónimo aleatorio guardado en `~/.claude.json`, no como una persona. Eso es inofensivo en sus puntos de datos de métricas, cuya lista empieza por el correo, pero si activas la beta de trazas de Claude Code, el `user.id` anónimo pasa por delante de `user.email` en los spans: elimina o reasigna `user.id` en un procesador del colector para esa flota. `enduser.id` sigue siendo un atributo activo de las convenciones semánticas y se acepta como alias equivalente. `cursor.user.id` va al final porque es un entero opaco, limitado al equipo, que necesita la API de administración de Cursor para resolverse a una persona.

La identidad solo se lee en spans ya reconocidos como llamadas de LLM: `user.id`, `user.email` y `team.id` son claves genéricas que también llevan los spans del navegador y de backends corrientes. Los **puntos de datos de métricas** llevan una lista más corta que empieza por el correo — `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, con los equipos de `team.id`, `team`, `cost_center`, `department` y `cursor.team.id`, cada uno buscado también con el prefijo `resource.` —, porque las CLI de agentes de programación que emiten métricas sin spans emiten `user.email` de forma nativa. Hoy nada lee la identidad de los **registros de logs**.

### Definir el equipo y el centro de costos

Ninguna instrumentación emite `team.id`, `team`, `cost_center` ni `department`: los define tu organización, normalmente mediante `OTEL_RESOURCE_ATTRIBUTES` en el proceso:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

Llegan a OneUptime como `resource.team.id`, `resource.team`, `resource.cost_center` y `resource.department`, y ambos niveles se reconocen en spans y en puntos de datos de métricas, tanto si tu exportador deja las claves en el bloque de recurso OTLP como si las copia en cada span (Claude Code hace esto último). Un `team.id` sin prefijo definido directamente en un span sigue ganando.

Las grafías de los gateways llegan sin ninguna configuración por tu parte. LiteLLM nombra sus atributos de forma distinta en sus dos modos de OpenTelemetry — el callback `otel` v1 predeterminado usa un prefijo `metadata.` simple (`metadata.user_api_key_user_id`, `metadata.user_api_key_user_email`, `metadata.user_api_key_team_id`), el modo v2 opcional (`LITELLM_OTEL_V2=true`) el espacio de nombres `litellm.` —, y **OneUptime lee ambos**.

### Las claves de cliente se excluyen a propósito

Un span de LLM puede llevar a **dos** personas distintas: el empleado que hizo la llamada y el **cliente** final para quien se hizo. Estas claves llevan al cliente, y OneUptime deliberadamente no lee **ninguna** de ellas en una columna de identidad:

- `gen_ai.user` y `llm.user` — cómo las instrumentaciones reflejan el parámetro de solicitud `user` de OpenAI, que OpenAI documenta como «a stable identifier for your end-users» (ahora obsoleto en favor de `safety_identifier` y `prompt_cache_key`).
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id` y `litellm.end_user.id` — el id explícito de usuario final de LiteLLM en sus tres grafías, distinto del id del propietario de la clave, que **sí** es el empleado y **sí** se lee.

La razón es que la imputación de costos sea correcta: si se lee un id de cliente en la columna de empleado, un bot de soporte que atiende a 40 000 clientes crea 40 000 «empleados» fantasma, mientras que el ingeniero dueño del gasto parece no haber gastado nada. Estos atributos se quedan en el mapa de atributos sin procesar, donde puedes consultarlos directamente.

### Las columnas de identidad se depuran

La columna del correo del empleado contiene datos personales reales. Tus **Reglas de depuración** de telemetría en el ámbito **Atributos** la cubren exactamente igual que al atributo del que se leyó, así que una regla de redacción de correos se aplica también a la columna. Configura las reglas de depuración y los filtros de descarte en **Trazas → Ajustes**.

## Los spans y las métricas son un respaldo, no una suma

**Los spans GenAI son la fuente autorizada. El flujo de métricas solo se consulta cuando el flujo de spans no informó nada, y los dos nunca se suman.** Un span lleva el modelo, los tokens y el costo en una sola fila, así que donde hay spans, responden a cualquier pregunta. Donde no los hay — las CLI de agentes de programación publican _métricas_ de tokens y costo y ningún span GenAI —, el flujo de métricas ocupa su lugar. No se suman porque muchas instrumentaciones emiten ambas señales para la misma llamada (OpenLLMetry es el caso habitual), y sumarlas contaría cada dólar dos veces.

La consecuencia que hay que prever: **en cuanto tus spans GenAI informan una cifra distinta de cero, la aportación de una fuente solo de métricas a esa cifra no aparece.** El respaldo es por cifra y por desglose, no por emisor:

| Dónde                                        | Qué recurre a las métricas                                   | Cuándo                                         |
| -------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| Uso → Tokens de entrada / Tokens de salida   | Totales de tokens de entrada y de salida                     | Ambas sumas de tokens de los spans son 0       |
| Uso → Costo (USD)                            | Costo, en USD y micro-USD, escalado y sumado                 | La suma de costos de los spans es 0            |
| Uso → Llamadas al LLM                        | Nada — solo spans                                            | —                                              |
| Uso → Empleado, Equipo, Modelo               | Solo el costo. Las columnas de llamadas y tokens muestran `—` | Ese desglose no devolvió filas de spans       |
| Uso → Proveedor, Aplicación / Servicio       | Nada — solo spans                                            | —                                              |
| Conversaciones                               | Nada — las conversaciones se construyen a partir de spans    | —                                              |

Proveedor y Aplicación / Servicio no tienen respaldo de métricas porque los contadores de los agentes de programación no llevan ningún atributo de proveedor GenAI y no están vinculados a ningún servicio de telemetría de OneUptime. Siempre que una cifra proviene de métricas, la página la etiqueta **de las métricas de GenAI**, porque una cifra procedente de métricas no tiene filas correspondientes en la lista de Llamadas.

**Si necesitas que el gasto de una herramienta solo de métricas se vea por separado, dale su propio proyecto**, para que su flujo de spans esté realmente vacío y el respaldo entre en juego. Lo mismo vale para los presupuestos: define un presupuesto por servicio en lugar de mezclar servicios que emiten spans con servicios solo de métricas.

## Dashboards y alertas de métricas

Las métricas GenAI llegan como métricas normales de OpenTelemetry, así que puedes crear **dashboards** que representen `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` y el resto, y crear **monitores de métricas** sobre ellas — por ejemplo cuando el p95 de `gen_ai.client.operation.duration` supera un umbral, agrupado por modelo. Consulta [Monitor de métricas](/docs/monitor/metrics-monitor).

## Presupuestos de costo diarios

La pestaña **Presupuestos** fija límites diarios en USD, evaluados sobre el día UTC. Cada 15 minutos un worker en segundo plano suma el costo de los spans de LLM del día (informado o calculado), lo registra en el presupuesto y publica dos métricas de tipo gauge:

| Métrica                             | Significado                                    |
| ----------------------------------- | ---------------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | El gasto del día hasta ahora, en USD           |
| `oneuptime.llm.budget.percent.used` | El gasto como porcentaje del límite diario     |

Ambas llevan los atributos `oneuptime.llm.budget.id` y `oneuptime.llm.budget.name`, además del ámbito de servicio, proveedor y modelo del presupuesto cuando está definido. Filtra los monitores por **`oneuptime.llm.budget.id`**, que es estable; el nombre cambia cuando renombras el presupuesto.

**Para alertar se usa un [Monitor de métricas](/docs/monitor/metrics-monitor) sobre esas métricas.** Para el patrón clásico 80 % / 100 %, crea un monitor sobre `oneuptime.llm.budget.percent.used`, fíltralo por `oneuptime.llm.budget.id` y añade dos criterios: `>= 80` que crea una alerta de advertencia y `>= 100` que crea una crítica. **Pon la ventana móvil del monitor en 30 minutos**: un presupuesto publica un punto cada 15 minutos, así que la ventana predeterminada de 1 minuto encontraría una serie vacía entre dos pasadas.

Los presupuestos pueden limitarse a un servicio de telemetría, a un proveedor de LLM o a un modelo exacto, o abarcar todo el proyecto, y pueden coexistir varios. Un monitor de presupuesto también puede llamar a un Workflow que detenga un agente descontrolado — consulta [Disyuntores para agentes de IA descontrolados](/docs/telemetry/ai-agent-circuit-breaker).

## Privacidad y redacción

Los prompts y las respuestas pueden contener datos sensibles. OneUptime aplica tus **Reglas de depuración** y **Filtros de descarte** de telemetría a los spans de LLM como a cualquier otra traza, así que puedes enmascarar atributos o descartar spans antes de que se guarden; configúralos en **Trazas → Ajustes**. La columna del correo del empleado está cubierta por las mismas reglas — consulta [Las columnas de identidad se depuran](#las-columnas-de-identidad-se-depuran).

Las conversaciones se leen con el mismo permiso que las trazas: quien puede leer las trazas del proyecto puede leer sus conversaciones, y nadie más.

## Relacionado

- [Observabilidad de asistentes de programación con IA](/docs/telemetry/ai-coding-assistants) — la matriz de compatibilidad de Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline y el resto, y cómo funciona el gasto por empleado entre ellos.
- [Monitorizar Claude Code](/docs/telemetry/claude-code)
- [Monitorizar Cursor](/docs/telemetry/cursor)
- [Monitorizar OpenAI Codex CLI](/docs/telemetry/openai-codex)
- [Monitorizar Gemini CLI y GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot)
- [Observar gateways de IA (LiteLLM y Portkey)](/docs/telemetry/ai-gateways)
- [Disyuntores para agentes de IA descontrolados](/docs/telemetry/ai-agent-circuit-breaker)
