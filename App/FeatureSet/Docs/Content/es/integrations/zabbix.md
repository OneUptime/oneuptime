# Integración con Zabbix

[Zabbix](https://www.zabbix.com) vigila tus servidores y red; OneUptime gestiona la respuesta a incidentes, la guardia y las páginas de estado. Conecta ambos y cada problema de Zabbix se convierte automáticamente en un incidente de OneUptime — para que se notifique a las personas correctas y tu página de estado permanezca actualizada.

Esta integración es **entrante**: Zabbix envía problemas a OneUptime. Usa un **tipo de medio webhook** de Zabbix en un lado y un **[Workflow](/docs/workflows/index)** de OneUptime en el otro. Sin plugins, sin servicios adicionales.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## Cómo funciona

1. Un disparador de Zabbix cambia a **PROBLEM**.
2. Una **acción** de Zabbix le indica al tipo de medio **OneUptime** que envíe el evento.
3. El script del tipo de medio hace un POST de una pequeña carga útil JSON a una URL del workflow de OneUptime.
4. El workflow lee la carga útil y crea un incidente (y, opcionalmente, lo resuelve cuando Zabbix se recupera).

## Prerrequisitos

- Un servidor Zabbix que administres (esta guía está escrita para **Zabbix 6.0 LTS / 7.0 LTS**; el tipo de medio webhook funciona igual en 5.0+).
- Tu servidor Zabbix debe poder llegar a tu instancia de OneUptime por HTTPS.
- Un proyecto de OneUptime donde puedas crear workflows.

## Parte 1 — Construir el workflow de OneUptime

Hazlo primero, porque necesitarás la URL del webhook que genera.

1. Abre **Workflows → Create Workflow**. Nómbralo `Zabbix → Incidents` y abre la pestaña **Builder**.
2. Arrastra un disparador **Webhook** al lienzo. Haz clic en él y **copia la URL única** que aparece. Guárdala bien — cualquiera que la tenga puede iniciar el workflow. Renombra el bloque como `Zabbix` para que las variables queden claras.
3. Arrastra un bloque **Conditions** al lienzo y conecta la salida del disparador a él. Configura:
   - **Valor izquierdo**: `{{Zabbix.Request Body.status}}`
   - **Operador**: `==`
   - **Valor derecho**: `1`  *(Zabbix envía `1` para un problema, `0` para recuperación)*
4. Arrastra un bloque **Create Incident** y conéctalo a la salida **Yes** del bloque Conditions. Rellena:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: elige la gravedad de incidente de OneUptime que prefieras (puedes refinarlo más adelante con más ramas de Conditions que mapeen las gravedades de Zabbix).
5. Guarda. Deja **Enabled** en *desactivado* por ahora — lo activarás después de una prueba.

> **Consejo:** Poner el `event_id` de Zabbix en la descripción (o en una etiqueta del incidente) te permite encontrar este incidente más adelante si quieres resolverlo automáticamente al recuperarse. Consulta [Resolver automáticamente](#resolver-automáticamente-opcional).

## Parte 2 — Configurar Zabbix

### Paso 1: Crear el tipo de medio de OneUptime

1. En Zabbix, ve a **Alerts → Media types** (en versiones anteriores: **Administration → Media types**).
2. Haz clic en **Create media type** y establece **Type** en **Webhook**.
3. **Name**: `OneUptime`.
4. Añade estos **Parameters** (haz clic en *Add* para cada uno). Mapean las [macros](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) de Zabbix en una carga útil limpia:

   | Nombre | Valor |
   | --- | --- |
   | `url` | `{ALERT.SENDTO}` |
   | `event_id` | `{EVENT.ID}` |
   | `event_name` | `{EVENT.NAME}` |
   | `event_value` | `{EVENT.VALUE}` |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host` | `{HOST.NAME}` |
   | `event_date` | `{EVENT.DATE}` |
   | `event_time` | `{EVENT.TIME}` |

5. Pega esto en el campo **Script**:

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader('Content-Type: application/json');

   var payload = {
     source: 'zabbix',
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw 'OneUptime responded with HTTP ' + request.getStatus() + ': ' + response;
   }

   return 'OK';
   ```

6. Haz clic en la pestaña **Message templates** y añade una plantilla para **Problem** y **Problem recovery** (el cuerpo puede estar vacío — la carga útil se construye en el script). Esto es necesario para que Zabbix use el tipo de medio para esos tipos de eventos.
7. Haz clic en **Add** para guardar el tipo de medio.

### Paso 2: Crear un usuario para transportar el webhook

Zabbix envía notificaciones *a un usuario*. Crea uno dedicado para que la integración sea fácil de encontrar y deshabilitar.

1. Ve a **Users → Users → Create user**. Nómbralo `OneUptime Webhook`, dale un rol que pueda recibir notificaciones (p. ej. **User role**) y añádelo a un grupo de usuarios.
2. En la pestaña **Media**, haz clic en **Add**:
   - **Type**: `OneUptime`
   - **Send to**: pega la **URL del webhook del workflow** que copiaste en la Parte 1.
   - **When active** / severidades: deja los valores predeterminados (o restringe a las gravedades que te interesen).
3. Haz clic en **Add** y luego en **Update**.

### Paso 3: Enviar problemas a OneUptime con una acción

1. Ve a **Alerts → Actions → Trigger actions → Create action**.
2. **Name**: `Notify OneUptime`.
3. **Conditions** (opcional): limita el alcance — por ejemplo, *Trigger severity >= Warning*. Déjalo vacío para enviar todo.
4. En la pestaña **Operations**, añade una operación que envíe a **User: OneUptime Webhook** mediante el tipo de medio **OneUptime**.
5. Para resolver incidentes al recuperarse más adelante, rellena también las **Recovery operations** con el mismo usuario/medio.
6. Haz clic en **Add** para guardar y asegúrate de que la acción esté **Enabled**.

## Parte 3 — Probarlo

1. De vuelta en el workflow de OneUptime, activa **Enabled**.
2. En Zabbix, provoca un problema de prueba — por ejemplo, baja temporalmente el umbral de un disparador, o usa un elemento de prueba que cambie a estado de problema.
3. Abre la pestaña **Logs** de tu workflow. Deberías ver una ejecución con la carga útil de Zabbix, el bloque Conditions tomando la ruta **Yes** y el incidente siendo creado.
4. Comprueba **Incidents** en OneUptime — tu problema de Zabbix es ahora un incidente.

Si no llega nada, consulta [Solución de problemas](#solución-de-problemas).

## Resolver automáticamente (opcional)

El workflow principal de arriba *abre* incidentes. Para también *cerrarlos* cuando Zabbix se recupera:

1. Asegúrate de que tu acción de Zabbix tenga **Recovery operations** configuradas (Paso 3 arriba) para que también se envíen los eventos de recuperación. Al recuperarse, `status` llega como `0`.
2. En el workflow, añade una segunda rama **Conditions**: izquierda `{{Zabbix.Request Body.status}}`, operador `==`, derecha `0`.
3. Desde su salida **Yes**, añade un bloque **Find Incident** que busque el incidente abierto que creaste antes — haz coincidir el `event_id` de Zabbix que guardaste en la descripción o en una etiqueta.
4. Conéctalo a un bloque **Update Incident** y mueve el incidente a tu estado *resuelto*.

Dado que la resolución depende de cómo modelices los estados de incidente en tu proyecto, mantén la ruta de **creación** como el núcleo fiable y añade la ruta de resolución una vez que hayas confirmado que los eventos fluyen correctamente. Consulta [Componentes → Componentes de datos de OneUptime](/docs/workflows/components#oneuptime-data-components).

## Mapeo de gravedades de Zabbix (opcional)

Las gravedades de Zabbix (`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`) llegan como `{{Zabbix.Request Body.severity}}`. Para mapearlas a las gravedades de incidente de OneUptime, añade ramas **Conditions** antes de **Create Incident** — por ejemplo, redirige `Disaster` y `High` a un incidente "Critical" y todo lo demás a "Major". Construye un bloque **Create Incident** por rama.

## Solución de problemas

**El workflow nunca se ejecuta.**
- Confirma que el interruptor **Enabled** del workflow esté activado.
- Desde el servidor Zabbix, confirma que puede llegar a la URL: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. Deberías recibir una confirmación rápida.
- Comprueba **Reports → Action log** en Zabbix para ver errores de entrega.

**Zabbix reporta un error de script.**
- Abre el tipo de medio y usa **Test** para enviar una carga útil de muestra. Zabbix muestra la salida del script o el error lanzado.
- Una respuesta no 2xx de OneUptime se muestra mediante el `throw` en el script — comprueba que la URL del workflow sea exactamente correcta.

**El incidente se crea pero los campos están vacíos.**
- Abre la pestaña **Logs** del workflow e inspecciona la salida del disparador. Confirma que los nombres de campo bajo **Request Body** coinciden con lo que referencias (`name`, `host`, `severity`, `status`, `event_id`).
- Un campo faltante se resuelve como cadena vacía en lugar de un error — consulta [Variables → Puntos a tener en cuenta](/docs/workflows/variables#gotchas).

**Todo se dispara dos veces.**
- Probablemente tengas tanto una operación de problema como un paso de escalación enviando al mismo medio. Comprueba los pasos de **Operations** de la acción.

## Notas de seguridad

- Trata la URL del webhook del workflow como una contraseña. Si se filtra, elimina el disparador y crea uno nuevo para rotar la URL.
- Restringe las condiciones de la acción de Zabbix para reenviar solo las gravedades que justifiquen un incidente.
- Si ejecutas OneUptime en modo autohospedado detrás de un firewall, permite que la IP de salida de tu servidor Zabbix lo alcance por HTTPS.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — los patrones entrante/saliente.
- [Disparador Webhook](/docs/workflows/triggers#webhook) — cómo funciona la URL receptora.
- [Componentes](/docs/workflows/components) — Conditions, Create Incident y más.
- [Variables](/docs/workflows/variables) — lectura de la carga útil de Zabbix en bloques posteriores.
