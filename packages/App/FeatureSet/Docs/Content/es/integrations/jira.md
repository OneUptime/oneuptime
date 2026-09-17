# Integración con Jira

Abre un issue de [Jira](https://www.atlassian.com/software/jira) cada vez que se declara un incidente en OneUptime, mantenlo al día a medida que el incidente avanza y deja que Jira envíe los cambios de estado de vuelta a OneUptime — todo con un [Workflow](/docs/workflows/index). No hay ningún bloque específico de Jira que instalar: OneUptime llama a la API REST de Jira con el [componente API](/docs/workflows/components#api), y Jira responde llamando a un [disparador Webhook](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Esta página construye ambas direcciones. Todo lo anterior a la sección de entrada está escrito para **Jira Cloud**; una sección cerca del final enumera lo que cambia en **Jira Data Center**.

> Atlassian ha ido renombrando cosas en Jira Cloud: un **project** ahora es un **space** en buena parte de la interfaz, y un **issue** es un **work item**. Hay tenants con ambos vocabularios, así que allí donde la terminología importa encontrarás las dos formas más abajo.

## Prerrequisitos

- Un sitio de Jira Cloud (`https://your-domain.atlassian.net`) y un proyecto donde registrar los issues. Anota su **project key** — el `OPS` de `OPS-1234`.
- Una cuenta de Jira que pueda crear issues en ese proyecto y un **API token** para ella, obtenido en [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Usa una cuenta de servicio en lugar de la de una persona — los issues creados así se atribuyen al propietario del token.
- Permiso para crear reglas de automatización en ese proyecto, para la mitad entrante.
- Un proyecto de OneUptime donde puedas crear workflows y variables globales.

## Paso 1 — Guardar las credenciales de Jira como secreto

La API REST de Jira Cloud usa **Basic auth**, construida a partir del correo de tu cuenta de Atlassian y un API token, codificados juntos en base64.

1. Codifica `email:api_token` una sola vez:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   Usa `printf`, no `echo`. `echo` añade un salto de línea, ese salto de línea se codifica junto con todo lo demás y Jira responde `401` por motivos que son invisibles en la cadena que pegaste.

2. En OneUptime, ve a **Flujos de trabajo → Variables Globales → Crear**. Nómbrala `JIRA_AUTH`, pega la cadena en base64 como **Content** y activa **Secret**.
3. Añade una segunda variable, no secreta, `JIRA_URL` con el valor `https://your-domain.atlassian.net` sin barra final.

Cualquier bloque puede usar ahora `Basic {{global.variables.JIRA_AUTH}}` como cabecera `Authorization`, y el token nunca aparece en el workflow ni en sus registros de ejecución. Consulta [Variables](/docs/workflows/variables).

Dos cosas sobre los API tokens de Atlassian que acabarán mordiendo a una integración que nadie está vigilando:

- **Caducan.** Los tokens se crean con una vigencia de entre un día y un año, un año por defecto, y no hay refresco — un token caducado hay que reemplazarlo a mano en la misma página y volver a codificarlo en `JIRA_AUTH`. Apunta la fecha de caducidad en algún calendario. Cuando un workflow que ha funcionado durante meses empieza a responder `401`, esta es la razón.
- **Un token con scopes necesita una URL base distinta.** La página de tokens ofrece **Create API token with scopes** además del clásico **Create API token**. Los tokens con scopes son la opción más segura, pero no se dirigen a tu sitio: van a `https://api.atlassian.com/ex/jira/<cloudId>`, así que `JIRA_URL` pasa a ser eso, y todas las rutas de más abajo cuelgan de ahí sin cambios. Tu `cloudId` está en el JSON de `https://your-domain.atlassian.net/_edge/tenant_info`. Un token con scopes enviado a `your-domain.atlassian.net` simplemente falla.

Si tu organización usa la gestión centralizada de usuarios de Atlassian, hay una tercera opción que evita el problema de la caducidad: una [credencial OAuth 2.0 para una cuenta de servicio](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/). Te da un client id y un secreto en lugar de un token, y un workflow los intercambia por un token de acceso de corta duración al principio de cada ejecución — la misma estructura de dos bloques que usa la página de [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365), con un bloque **API Post (JSON)** que obtiene el token y todo lo posterior enviando `Bearer <token>`. No hay nada que reemplazar a mano un año después. La página de Atlassian tiene la petición de token exacta; la URL base de la API es `https://api.atlassian.com`.

## Paso 2 — Abrir un issue de Jira para cada incidente

1. Abre **Flujos de trabajo → Crear flujo de trabajo**, nómbralo `Incidents → Jira` y abre el **Constructor**.
2. Haz clic en el bloque de marcador de posición punteado y añade el disparador **On Create Incident**. En su **Select Fields**, pide las columnas que quieras enviar:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Deja su **Identifier** como `incident-on-create-1` — ese es el nombre con el que lo referencian los bloques posteriores.

3. Haz clic en **Añadir componente**, añade un bloque **API Post (JSON)** y arrastra desde el punto **Success** del disparador hasta el punto de entrada del nuevo bloque. Ábrelo, pon su **Identifier** en `create-issue` y rellena:

   - **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**:

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**:

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   Sustituye `OPS` por tu project key y `Bug` por un tipo de issue que exista en ese proyecto. Ambos pueden indicarse también por id — `{"id": "10000"}` — que es lo que usan los propios ejemplos de Atlassian y lo que deberías preferir si dos tipos de issue de tu sitio comparten nombre. Las llamadas a `createmeta` de más abajo te dan esos ids.

La descripción parece pesada porque la API v3 de Jira Cloud recibe el texto enriquecido como **Atlassian Document Format** — un árbol de documento, no una cadena. La estructura anterior es el documento válido mínimo: un párrafo que contiene un nodo de texto. Lo mismo aplica a `environment` y a cualquier campo personalizado de texto multilínea; los campos personalizados de texto de una sola línea siguen aceptando una cadena simple.

Ahora enciende el workflow desde **Vista General → Editar flujo de trabajo → Habilitado**, declara un incidente de prueba y abre **Ejecuciones y Registros**. El bloque `create-issue` debería mostrar un `201` y un cuerpo que contiene el `id`, la `key` y el `self` del nuevo issue. Los cambios en el lienzo se guardan solos — no hay botón de guardar, y un workflow deshabilitado no puede ejecutarse de ninguna manera, ni siquiera a mano.

La key del nuevo issue está disponible para cualquier bloque posterior a este:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### Rellenar más campos

Algunas adiciones habituales dentro de `fields`:

- **Priority** — `"priority": { "id": "20000" }`, usando un id de prioridad de tu sitio. Para mapear las gravedades de OneUptime sobre las prioridades de Jira, pon un bloque **If / Else** entre el disparador y el bloque API y ramifica sobre `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`.
- **Assignee** — `"assignee": { "id": "<accountId>" }`. Jira Cloud identifica a las personas por su account id de Atlassian; `username` y `userKey` se eliminaron de la API de Cloud hace años.
- **Labels** — `"labels": ["oneuptime", "sev1"]`, un array plano de cadenas. Las labels no pueden contener espacios.
- **Components** — `"components": [{ "id": "10000" }]`.
- **Custom fields** — `"customfield_10034": "..."`, usando el id propio del campo. La forma del valor depende del tipo del campo: un select simple acepta `{"value": "red"}`, un multiselect un array de ids, y un campo de texto multilínea un documento en Atlassian Document Format.

Para averiguar qué exige realmente un proyecto, pregúntaselo a Jira en lugar de adivinar. Lista los tipos de issue de un proyecto y luego los campos de uno de ellos:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

La segunda llamada lista todos los campos que acepta ese tipo de issue, cuáles son obligatorios y los ids `customfield_NNNNN` exactos. Para leer los ids de un issue que ya tienes, recupéralo con `?expand=names`.

## Paso 3 — Llevar el id del incidente a Jira

Las dos mitades de una sincronización bidireccional necesitan que un sistema guarde el identificador del otro, y Jira es el mejor sitio para guardarlo: la columna `customFields` de OneUptime es un único blob JSON, así que escribir un valor desde un workflow reemplaza todos los campos personalizados de ese incidente.

**Con un administrador de Jira.** Añade un campo personalizado de texto corto — llámalo *OneUptime Incident ID* — a la pantalla de creación del proyecto, averigua su id con `createmeta` y ponlo junto a todo lo demás:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**Sin él.** Ponlo en una label. Las labels no admiten espacios, y un id de OneUptime es un UUID simple, así que `oneuptime-<id>` es una label válida:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

El workflow entrante tendrá entonces que extraer esa label de la lista, lo que son un par de líneas en un bloque **Run Custom JavaScript**. El campo personalizado es más limpio si puedes tener uno.

Ya que estás aquí, merece la pena añadir en el issue de Jira un enlace de vuelta al incidente. Un bloque **API Post (JSON)** después de `create-issue`, apuntado a `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`, con:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

da a todo el mundo en Jira un camino de vuelta con un solo clic. Para esto, añade `projectId` a los **Select Fields** del disparador. El `globalId` es lo que hace que la llamada sea segura de repetir: Jira actualiza el enlace que ya lleva ese id en lugar de añadir un segundo. Como una actualización también deja a nulo lo que omitas, envía siempre el `object` completo, no un parche de él.

## Paso 4 — Comentar y transicionar a medida que avanza el incidente

Construye esto como un **segundo** workflow, para que un fallo aquí nunca pueda impedir que se abran issues.

1. **Crear flujo de trabajo**, nómbralo `Incident updates → Jira` y añade el disparador **On Update Incident**.
2. En **Listen on**, pon `{"currentIncidentStateId": true}`. Así el disparador solo se dispara con los cambios de estado en lugar de con cada edición. En **Select Fields**, pide `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Añade un bloque **If / Else**: **Input 1** `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** `==`, **Input 2** `Resolved` — o como se llame el estado resuelto de tu proyecto. Consulta [Estados y gravedades de incidentes](/docs/incidents/states-and-severities).

Desde la rama **Sí** primero tienes que encontrar el issue que abriste en el Paso 2. Pídeselo a Jira por el id que guardaste en el Paso 3, con un bloque **API Post (JSON)** cuyo **Identifier** sea `find-issue`:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  Si usaste un campo personalizado en lugar de una label, la cláusula pasa a ser `cf[10050] ~ \"...\"` con el id de tu propio campo.

El id del issue es entonces `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`, y todos los endpoints de abajo aceptan un id igual de bien que una key.

Hay tres cosas de este endpoint que conviene saber. **Envía el JQL en el cuerpo, no lo pongas en la URL** — una cadena de consulta que contenga `=` dentro de un valor se trunca al salir de un workflow, y el JQL no es más que signos `=`. **La consulta debe estar acotada**: un simple `order by key desc` se rechaza con `400`, que es la razón de que esté la cláusula `project =`. Y `/rest/api/3/search/jql` es el endpoint actual — el antiguo `/rest/api/3/search` está obsoleto y en vías de desaparición, así que no recurras a él.

**Dejar un comentario** es un único bloque **API Post (JSON)** hacia `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment`, con un cuerpo en Atlassian Document Format igual que la descripción:

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**Mover el issue** requiere dos llamadas, porque una transición se identifica por un id que varía entre workflows y, en algunos tableros, entre issues.

1. Un bloque **API Get (JSON)** sobre `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` devuelve las transiciones disponibles *desde el estado actual del issue*, cada una con un `id` y un `name`, y un objeto `to` que nombra el estado al que lleva.
2. Un bloque **API Post (JSON)** a la misma URL ejecuta una:

   ```json
   { "transition": { "id": "31" } }
   ```

Una transición correcta responde `204` sin cuerpo. Si prefieres no leer la lista en tiempo de ejecución, llámala una vez a mano para un issue en el estado adecuado y fija el id en el código — recuerda solo que está atado a ese workflow, así que un administrador que edite el workflow de Jira puede romperlo en silencio.

## Entrante — de Jira a OneUptime

Ahora la otra dirección: alguien mueve el issue a Done y el incidente de OneUptime debería seguirlo.

### Construye primero el workflow receptor

1. **Crear flujo de trabajo**, nómbralo `Jira → OneUptime` y añade el disparador **Webhook**.
2. Abre los **Ajustes** de ese workflow y copia la **Clave secreta del webhook**. Tu URL es:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Las instalaciones autoalojadas usan su propio host. Trata la URL como una contraseña —cualquiera que la tenga puede arrancar el workflow— y restablece la clave desde esa misma página si se filtra.

3. Añade un bloque **If / Else** que compruebe un secreto compartido antes de que se ejecute cualquier otra cosa. **Input 1** es `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** es `{{global.variables.JIRA_WEBHOOK_SECRET}}` — un valor que inventas y guardas como variable global secreta.
4. Desde la rama **Sí**, añade un bloque **Update One Incident**:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: lo que el cambio en Jira deba significar aquí — normalmente un cambio de estado.

   Mover un incidente necesita el id del estado de destino, que un bloque **Find One Incident State** con la consulta `{"name": "Resolved"}` te dará como `{{local.components.incident-state-find-one-1.returnValues.model._id}}`. Escribe eso en `currentIncidentStateId`.

Deja el workflow habilitado. Ahora dale a Jira algo a lo que llamar.

### Enviar el evento desde una regla de automatización de Jira

1. En Jira, abre las reglas de automatización del proyecto: **Space settings → Automation** en los tenants más nuevos, **Project settings → Automation** en los más antiguos. Para una regla que abarque varios proyectos usa **Settings → System → Global automation**, que necesita el permiso global *Administer Jira*.
2. **Create rule** y elige el disparador **Work item transitioned** — **Issue transitioned** en los tenants más antiguos. Configúralo para que se ejecute cuando el estado pase *a* **Done**.

   Usa este disparador, no *Work item updated*: el disparador de actualización excluye deliberadamente los cambios de estado.

3. Añade la acción **Send web request** y configúrala:

   - **Web request URL**: la URL del webhook de OneUptime de más arriba.
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`, y `X-OneUptime-Secret` / tu secreto compartido. Usa la opción **Hide** en el valor del secreto para que otros editores de reglas no puedan leerlo — ten en cuenta que ocultarlo es irreversible para ese valor, y que los valores ocultos se pierden si la regla se exporta o se duplica.
   - **Web request body**: **Custom format**, para que controles tú la forma:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     Si en el Paso 3 usaste una label en lugar de un campo personalizado, envía `"labels": "{{issue.labels}}"` y extrae el id con un bloque **Run Custom JavaScript** del lado de OneUptime.

4. Activa la regla, mueve un issue de prueba a Done y comprueba ambos lados: el propio registro de auditoría de la regla en Jira y **Ejecuciones y Registros** en OneUptime.

Cosas que conviene saber antes de depender de esto:

- **El puerto de destino está restringido.** Send web request solo alcanza los puertos 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900 y 9900. OneUptime Cloud está en el 443; una instalación autoalojada en un puerto inusual no puede ser llamada así.
- **No hay firma de las peticiones.** La acción no tiene opción de HMAC, así que un secreto compartido en una cabecera sobre HTTPS es el mecanismo que documenta Atlassian. La comprobación **If / Else** del Paso 3 del workflow receptor es lo que hace que eso valga la pena.
- **Las ejecuciones de reglas se contabilizan.** Jira Cloud cuenta las ejecuciones correctas de reglas contra una cuota mensual que depende de tu plan — 100 en Free, 1.700 en Standard, 1.000 × usuarios en Premium, ilimitadas en Enterprise. Una regla que se dispara en cada transición de un proyecto con mucho movimiento suma rápido.
- **Los valores no se codifican para URL** por ti. Eso solo importa si envías un cuerpo con codificación de formulario; el JSON de arriba está bien.
- **Atlassian publica sus rangos de salida** en [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com) por si tu instalación de OneUptime está detrás de una lista de permitidos. Cambian, así que consulta el feed periódicamente en lugar de fijar direcciones.

### O usa un webhook de Jira en su lugar

Un administrador de Jira puede registrar un webhook directamente en **Settings → System → Advanced → WebHooks**, eligiendo los eventos a enviar y, opcionalmente, una consulta JQL que acote qué issues lo disparan. Comparado con una regla de automatización:

- La carga útil es la de Jira, no la tuya: `webhookEvent`, `issue_event_type_name`, el `issue` completo y un `changelog` cuyo array `items` contiene el antes y el después de cada campo modificado. Para un cambio de estado te interesa la entrada donde `field` es `status`. Leer eso dentro de un workflow suele implicar un bloque **Run Custom JavaScript**.
- Los webhooks **sí** pueden firmarse —le das un secreto al webhook y Jira envía una cabecera `X-Hub-Signature` con un HMAC del cuerpo de la petición— pero un workflow no puede comprobarlo. La firma cubre los bytes exactos que envió Jira, y el disparador Webhook le entrega al workflow un cuerpo que ya ha sido parseado a JSON, así que no queda nada que hashear. Si quieres que la petición esté autenticada, usa una regla de automatización con una cabecera de secreto compartido.
- La URL debe ser HTTPS en un puerto de la propia lista de Jira, que *no* es la misma lista que usa la acción de automatización — aquí el puerto 80 no está permitido.
- La entrega se reintenta hasta cinco veces con una espera de entre cinco y quince minutos, así que tu workflow debe tolerar que el mismo evento llegue dos veces.

Los webhooks registrados por una app mediante `/rest/api/3/webhook` son otra cosa distinta: caducan 30 días después de su registro salvo que se refresquen. Los registrados por un administrador, los de arriba, no caducan.

## Jira Data Center

Jira autogestionado funciona igual con un puñado de sustituciones. **Jira Server** dejó de tener soporte en febrero de 2024 y no recibe correcciones, así que trata Data Center como el objetivo autogestionado.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — no hay v3 en Data Center                                 |
| `description` como documento de Atlassian Document Format | `description` como cadena simple en wiki markup                      |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| API token desde id.atlassian.com                  | **Profile → Personal access tokens → Create token** en tu propia cuenta de Jira |
| Acción de automatización **Send web request**     | Acción de automatización **Send outgoing web request**                       |

Así que el bloque de creación del issue pasa a ser un `POST` a `/rest/api/2/issue` con:

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

que es más sencillo de plantillar — sin árbol de documento.

Otras diferencias que conviene prever:

- **Los personal access tokens** existen desde Jira Core y Jira Software 8.14 y Jira Service Management 4.15. Caducan —365 días por defecto— y la interfaz marca uno como *Expires soon* cinco días antes. La autenticación básica con usuario y contraseña sigue funcionando en Data Center, pero unos pocos inicios de sesión fallidos activan un CAPTCHA que deja la cuenta completamente fuera de la API REST hasta que una persona lo resuelve en un navegador, que es una mala forma de descubrir una errata. Es preferible un token.
- **La automatización viene incluida** desde Jira Data Center 10.0. Antes de eso era la app Automation for Jira, que se instalaba aparte. Su petición saliente tiene un tiempo de espera predeterminado de 3000 ms, ajustable con la propiedad `outgoing.webhook.timeout.ms`.
- **Los webhooks** se registran en **Administration → System → Advanced → WebHooks**, y se admite acotarlos con JQL. Mantén esos filtros estrechos: Jira evalúa el JQL de cada webhook registrado en el hilo que lanzó el evento, así que una docena de filtros laxos ralentizan la acción del usuario que los disparó.
- **Desde Data Center 10.0 la entrega de webhooks es asíncrona** y no hay opción síncrona, así que los eventos pueden llegar desordenados. Haz que el workflow receptor sea idempotente.
- **Jira 10 eliminó el `$` de las variables de las URL de webhook** — `${issue.id}` pasó a ser `{issue.id}` — y movió el recurso REST de webhooks de `/rest/webhooks/1.0/webhook` a `/rest/jira-webhook/1.0/webhooks`.

## Hacer lo mismo con las alertas

Todo lo anterior está escrito alrededor de incidentes porque es el caso habitual, pero las alertas funcionan igual — cambia el tipo de registro y nada más cambia:

| Incidente                                | Alerta                                      |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

Un workflow tiene exactamente un disparador, así que los incidentes y las alertas necesitan un workflow cada uno. Si ambos harían el mismo trabajo, construye la mitad de Jira una sola vez y llámala desde los dos con el componente **Execute Workflow**.

## Solución de problemas

Abre primero el bloque que falla en **Ejecuciones y Registros**. Jira devuelve un cuerpo JSON que nombra exactamente lo que rechazó, y el componente API lo conserva en `response-body`.

**`401 Unauthorized`.** Vuelve a codificar `email:api_token` con `printf` y actualiza `JIRA_AUTH`; un salto de línea final procedente de `echo` es la causa habitual. Después confirma que la cuenta propietaria del token puede crear issues en ese proyecto. En Data Center, comprueba que estás enviando `Bearer`, no `Basic`.

**`400 Bad Request` nombrando un campo.** El tipo de issue no existe en el proyecto, o el proyecto tiene un campo obligatorio que no estás enviando. Ejecuta las llamadas a `createmeta` de más arriba contra ese proyecto y ese tipo de issue y compara.

**`400` quejándose de `description`.** En la v3 de Cloud la descripción debe ser un documento en Atlassian Document Format, no una cadena. O envías el documento mostrado arriba, o cambias ese bloque a `/rest/api/2/issue` y envías texto plano.

**`404 Not Found`.** Comprueba la URL base y la versión de la API — `/rest/api/3/...` en Cloud, `/rest/api/2/...` en Data Center.

**`429 Too Many Requests`.** Jira está limitando la tasa. La respuesta lleva `Retry-After` en segundos y un `RateLimit-Reason` que nombra qué límite has alcanzado. Las escrituras sobre un mismo issue están muy acotadas —del orden de veinte en dos segundos— así que un workflow que comenta y transiciona en rápida sucesión puede activarlo con un solo issue. Pon un bloque **Delay** entre las llamadas, o traslada el trabajo masivo a un workflow programado.

**La llamada de transición devuelve `400`.** El id de transición no es válido desde el estado *actual* del issue. Recupera `/transitions` para ese issue y usa un id de la respuesta.

**La regla de automatización aparece como correcta pero no llega nada a OneUptime.** Comprueba primero el puerto — consulta la lista restringida de arriba. Después envía tú mismo una petición a la URL del webhook con `curl` y mira si aparece en **Ejecuciones y Registros**; si la tuya llega y la de Jira no, el problema está del lado de Jira.

**El workflow se ejecuta pero el incidente no cambia.** Un bloque **Update One Incident** informa de `Items Updated: 0` cuando su consulta no encontró nada, y eso cuenta como éxito, no como error. Comprueba que el id de la carga útil es realmente el id del incidente de OneUptime y que estás consultando `_id`.

**Una referencia `{{...}}` aparece literalmente en un issue de Jira.** Una referencia sin resolver se pasa tal cual como texto en lugar de vaciarse. El registro de la ejecución nombra cualquier referencia que no se resolvió — normalmente un identificador de bloque mal escrito o una variable renombrada.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — los patrones entrante y saliente, y la guía de autenticación rápida.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — la misma construcción bidireccional contra Dynamics.
- [Resumen de Workflows](/docs/workflows/index) y [Crear un flujo de trabajo](/docs/workflows/authoring) — el lienzo, los identificadores y cómo encender un workflow.
- [Componentes](/docs/workflows/components) — los bloques API, If / Else y los componentes de datos de OneUptime.
- [Variables](/docs/workflows/variables) — secretos, y lectura de la salida de un bloque desde el siguiente.
- [Configuración y seguridad](/docs/workflows/configuration) — seguridad de los webhooks y acceso de red saliente.
- [ServiceNow](/docs/integrations/servicenow) y [PagerDuty](/docs/integrations/pagerduty) — el mismo patrón saliente para otras herramientas.
