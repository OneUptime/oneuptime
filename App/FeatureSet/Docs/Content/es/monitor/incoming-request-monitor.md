# Monitor de solicitudes entrantes

Un monitor de solicitudes entrantes te da una URL a la que otros sistemas envían solicitudes HTTP. OneUptime evalúa cada solicitud contra tus criterios y puede cambiar el estado del monitor, declarar incidentes y avisar a tu turno de guardia.

Cubre dos tareas distintas:

- **Monitorización por latido** — un trabajo cron, un worker o un dispositivo llama a la URL según una programación, y OneUptime abre un incidente cuando los latidos dejan de llegar.
- **Recibir alertas de otro sistema** — Prometheus Alertmanager, Grafana o cualquier otra cosa que pueda hacer POST de JSON envía alertas, y OneUptime convierte cada una en un incidente con escalado de guardia y resolución automática al recuperarse.

Ambas usan el mismo tipo de monitor. Lo que las separa son los criterios que configuras.

## Información general

Los monitores de solicitudes entrantes proporcionan una URL única a la que llaman tus servicios. Esto te permite:

- Monitorizar trabajos cron y tareas programadas
- Verificar que los workers en segundo plano están en marcha
- Monitorizar servicios detrás de cortafuegos que no se pueden alcanzar desde fuera
- Recibir alertas de Prometheus Alertmanager, Grafana y otros sistemas de alertado
- Seguir señales de latido de cualquier sistema con capacidad HTTP

## Creación de un monitor de solicitudes entrantes

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **Solicitud entrante** como tipo de monitor
4. Se generan una **Clave secreta** y una URL para este monitor
5. Abre el monitor y haz clic en **Documentation** en el menú izquierdo para copiar la URL
6. Configura tu servicio para que envíe solicitudes a esa URL
7. Configura los criterios de monitorización como se describe más abajo

## La URL de la solicitud

Tu monitor tiene una URL única con el formato:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Sustituye `https://oneuptime.com` por la URL de tu instancia de OneUptime si es autoalojada.

Envía solicitudes **GET** o **POST** a esta URL. HEAD se acepta y se trata como GET. Otros métodos devuelven 404. La clave secreta de la ruta es la única credencial: no hace falta ninguna cabecera ni token.

> **Warning:** Cualquiera que conozca esta URL puede marcar el monitor como sano, así que trátala como un secreto. Cada cabecera que envíes se almacena en el monitor y es visible para cualquiera que pueda leerlo: no envíes claves de API ni tokens en cabeceras a este endpoint.

OneUptime responde de inmediato con un `200` vacío y procesa la solicitud en una cola. Esa respuesta se escribe antes de que ocurra ninguna validación, así que un `200` **no** confirma que la solicitud se haya aceptado: una clave secreta incorrecta, un monitor borrado y un monitor deshabilitado también devuelven `200`. Consulta la línea de tiempo del propio monitor para confirmar que las solicitudes están llegando.

### Envío de un cuerpo de solicitud

Si quieres referirte a campos dentro del cuerpo — `{{requestBody.status}}` en el título de un incidente, una ruta JSON en el agrupamiento de incidentes o un criterio de tipo JavaScript Expression — envía `Content-Type: application/json`, que es el formato que esta documentación asume en todo momento. Un cuerpo `application/x-www-form-urlencoded` también se analiza, pero solo en campos planos de nivel superior. Cualquier otro tipo de contenido, o ninguno, no se analiza y toda referencia a `requestBody` se resuelve en nada.

Se aceptan cuerpos de hasta 50 MB. No comprimas el cuerpo con `Content-Encoding: gzip`; se almacena sin analizar y las rutas dentro de él no se resolverán.

### Envío de un latido

#### Usando curl

```bash
# Solicitud GET simple
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# Solicitud POST con cuerpo personalizado
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Desde un trabajo cron

```bash
# Agregar al crontab para enviar un latido cada 5 minutos
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### Desde el código de la aplicación

```javascript
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Ejemplo en Python
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo se considera que tu servicio está en línea, degradado o fuera de línea. Cada filtro de criterio tiene un **Filter Type** (qué mirar), una **Filter Condition** (cómo compararlo) y un **Value**.

### Filter Types disponibles

| Filter Type           | Comprueba                                                   | Notas                                                                                      |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Incoming Request      | Si se recibió una solicitud dentro de una ventana de tiempo | La única comprobación que puede dispararse cuando no llega nada                            |
| Request Body          | El cuerpo de la solicitud                                   | Coincidencia por subcadena. Los cuerpos de objeto se comparan como JSON compacto           |
| Request Header        | Los nombres de las cabeceras de la solicitud                | Coincidencia exacta con un nombre de cabecera, en minúsculas                               |
| Request Header Value  | Los valores de las cabeceras de la solicitud                | Coincidencia exacta con un valor de cabecera, en minúsculas                                |
| JavaScript Expression | Cualquier expresión sobre `requestBody` y `requestHeaders`  | La opción más flexible — ver [Expresiones JavaScript](/docs/monitor/javascript-expression) |

### Filter Conditions

Cada Filter Type ofrece su propio conjunto de condiciones.

Para **Incoming Request** (reproducidas aquí con la ortografía del panel):

- **Recieved In Minutes** — se recibió una solicitud dentro del número de minutos indicado
- **Not Recieved In Minutes** — no se recibió ninguna solicitud dentro del número de minutos indicado

Para **Request Body**, **Request Header** y **Request Header Value**: **Contains** y **Not Contains**.

Para **JavaScript Expression**: **Evaluates To True**.

> **Note:** Los nombres y los valores de las cabeceras se pasan a minúsculas antes de comparar, y la coincidencia es contra el nombre o el valor completo, no una subcadena. Escribe `content-type`, no `Content-Type`, y `application/json`, no `application/JSON`. Solo **Request Body** hace una verdadera coincidencia por subcadena.

Los cuerpos de objeto se comparan como JSON compacto sin espacios, así que un filtro **Request Body** / **Contains** debe escribirse `"status":"firing"` — copiar `"status": "firing"` de una carga útil formateada no coincidirá jamás.

### Ejemplos de criterios

#### Marcar como fuera de línea si no hay latido en 10 minutos

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### Marcar como degradado según el contenido del cuerpo de la solicitud

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** Un monitor solo se reevalúa en segundo plano si al menos uno de sus criterios comprueba **Incoming Request**. Un monitor cuyos criterios solo comprueban Request Body, Request Header o una JavaScript Expression se evalúa cuando llega una solicitud y en ningún otro momento, así que nunca puede pasar a fuera de línea por sí solo. Si quieres una alarma por latido ausente, necesitas un criterio **Incoming Request**.

Ten en cuenta además que un monitor que nunca ha recibido una solicitud se trata como si su momento de creación fuera la última solicitud. Un criterio "Not Recieved In Minutes: 10" en un monitor recién creado se dispara 10 minutos después de crearlo, aunque nunca se haya conectado el emisor.

## Recibir alertas de otro sistema

Alertmanager, Grafana y herramientas similares envían por POST un documento JSON que describe una o varias alertas. Por defecto, un criterio abre **un** incidente, así que una carga útil con cinco alertas produciría un solo incidente. El agrupamiento de incidentes cambia eso: extrae un valor de la carga útil y abre **un incidente separado por cada valor distinto**, y todos pueden estar abiertos a la vez.

### Activar el agrupamiento de incidentes

Abre el criterio, despliega **Settings** y activa **Group incidents and alerts by a payload field**. Aparecen cuatro campos:

| Campo                              | Ejemplo                                  | Qué hace                                                                                  |
| ---------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | La ruta cuyos valores distintos separan los incidentes                                    |
| Field that signals recovery        | `requestBody.alerts[*].status`           | La ruta que se comprueba para decidir que una alerta se ha recuperado                     |
| Value that means recovered         | `resolved`                               | El valor exacto que marca la recuperación                                                 |
| Max incidents per request          | `100` (por defecto)                      | Límite de seguridad para que un campo de alta cardinalidad no abra incidentes sin control |

### Sintaxis de las rutas

Las rutas deben empezar por el prefijo literal `requestBody.`. Una ruta sin él — `alerts[*].labels.alertname` — no coincide con nada, y en silencio. La envoltura `{{ }}` es opcional: `requestBody.status` y `{{requestBody.status}}` se comportan igual.

- `[*]` se despliega sobre un array — un incidente por cada valor **distinto**. Dos elementos que produzcan el mismo valor se funden en un solo incidente, y el estado firing/resolved de ese incidente se toma del **primer** elemento coincidente. **Solo el primer `[*]` de una ruta es un comodín**; `requestBody.groups[*].alerts[*].name` no coincide con nada.
- `[0]` y `[last]` seleccionan un único elemento, y pueden ir después de un `[*]`.
- Los valores de objeto y de array, las cadenas vacías y los nulos se omiten. `0` y `false` son claves válidas.

### La resolución está guiada por eventos

Un webhook describe solo lo que hay en esa carga útil, así que OneUptime nunca resuelve un incidente porque su clave haya dejado de aparecer. Un incidente se resuelve únicamente cuando una carga útil dice explícitamente que esa clave se recuperó. Deben cumplirse dos cosas:

1. **Field that signals recovery** y **Value that means recovered** están definidos y coinciden con la carga útil. La comparación es exacta y distingue mayúsculas de minúsculas: `Resolved` no coincide con `resolved`.
2. El incidente del criterio tiene **Auto Resolve Incident** activado, bajo **Advanced Options** en el formulario del incidente. Sin eso, los eventos de recuperación que coincidan se ignoran y los incidentes siguen abiertos. (Lo mismo aplica a las alertas y a **Auto Resolve Alert**.)

**Max incidents per request** limita la extracción, no solo la creación. Las claves más allá del límite también son invisibles para la recuperación, así que en una carga útil con más claves distintas que el límite, una alerta que informe `resolved` más allá de él no cerrará su incidente.

> **Warning:** Si **Field that signals recovery** contiene `[*]` pero **Open a separate incident for each…** no, nunca se resolverá nada. Usa `[*]` en ambos o en ninguno. Una ruta de recuperación sin `[*]` se evalúa contra toda la carga útil, así que un `status: resolved` a nivel de carga útil resuelve todas las claves de esa carga útil, incluidas las alertas cuyo propio estado sigue siendo firing.

### Dar nombre a los incidentes

La clave de agrupamiento se expone a las plantillas de incidentes y alertas como una variable con el nombre del **último segmento de la ruta**:

| Ruta                                     | Variable          |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

La carga útil completa está disponible junto a ella, así que un título de incidente `{{alertname}}` y una descripción que use `{{requestBody.commonAnnotations.summary}}` funcionan ambos. Ver [Plantillas dinámicas de incidentes y alertas](/docs/monitor/incident-alert-templating).

> **Warning:** El nombre de la variable forma parte de la identidad que OneUptime usa para emparejar un evento de recuperación con un incidente abierto. Cambiar la ruta de agrupamiento por otra con un último segmento distinto deja huérfanos todos los incidentes que estén abiertos bajo la ruta antigua: ya no se pueden resolver automáticamente y hay que cerrarlos a mano.

Ten en cuenta que `[*]` funciona **solo** en los dos campos de ruta de agrupamiento. En cualquier otro sitio no se resuelve, y un marcador sin resolver se imprime **literalmente** en lugar de vaciarse: un título `{{requestBody.alerts[*].labels.alertname}}` se muestra con las llaves incluidas. Un título `{{requestBody.alerts[0].annotations.summary}}` sí se resuelve, pero siempre lee la primera alerta de la carga útil, no aquella para la que se abrió este incidente. Prefiere la variable de agrupamiento más los campos compartidos `commonAnnotations` de la carga útil.

### Ejemplo completo

Para una configuración completa de Alertmanager, ver [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager). Para Grafana, ver [Grafana](/docs/integrations/grafana).

## Buenas prácticas

1. **Ajusta bien la ventana de tiempo** — Si tu trabajo cron se ejecuta cada 5 minutos, pon el umbral "Not Recieved In Minutes" en 10–15 minutos para tolerar retrasos ocasionales
2. **Incluye datos significativos** — Envía información de estado en el cuerpo de la solicitud para poder definir criterios granulares
3. **Usa POST con `Content-Type: application/json`** — todo lo que lee dentro del cuerpo depende de ello
4. **No mezcles las dos tareas en un mismo monitor** — un monitor que recibe alertas guiadas por eventos no tiene una cadencia regular, así que un criterio "Not Recieved In Minutes" en él oscilará. Usa un monitor aparte para el interruptor de hombre muerto
5. **Monitoriza el monitor** — Asegúrate de que el servicio que envía las solicitudes tenga un manejo de errores adecuado para que las solicitudes fallidas no pasen desapercibidas

## Dónde seguir leyendo

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — una configuración completa de alertado entrante
- [Grafana](/docs/integrations/grafana) — lo mismo, para el alertado de Grafana
- [Plantillas dinámicas de incidentes y alertas](/docs/monitor/incident-alert-templating) — todas las variables disponibles en títulos y descripciones
- [Expresiones JavaScript](/docs/monitor/javascript-expression) — sintaxis de expresiones y reglas de comillas
