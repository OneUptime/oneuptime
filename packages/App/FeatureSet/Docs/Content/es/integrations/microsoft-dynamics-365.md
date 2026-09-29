# Integración con Microsoft Dynamics 365

Abre un **Case** en [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) cada vez que se declara un incidente en OneUptime, mantén ese caso al día a medida que el incidente avanza y deja que Dynamics envíe los cambios del caso de vuelta a OneUptime — todo con un [Workflow](/docs/workflows/index). No hay ningún bloque específico de Dynamics que instalar: OneUptime habla con la **Dataverse Web API** mediante el [componente API](/docs/workflows/components#api), y Dynamics responde a través de un [disparador Webhook](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Esta página cubre ambas direcciones. Construye primero la mitad saliente — es la que necesita la configuración de Microsoft Entra ID, y una vez que funciona la mitad entrante es un único flujo.

## Prerrequisitos

- Un entorno de **Dynamics 365** que contenga la tabla **Case**. Los casos vienen de Dynamics 365 Customer Service; un entorno de Dataverse sin él no tiene ninguna tabla `incident` donde escribir.
- El **Web API endpoint** del entorno. Lo encuentras en el [Power Platform admin center](https://admin.powerplatform.microsoft.com/), bajo **Settings → Developer resources** de tu entorno, o en **make.powerapps.com → Settings → Developer resources**. Tiene el aspecto de `https://yourorg.crm.dynamics.com/api/data/v9.2/` — el segmento de región varía (`crm` para Norteamérica, `crm2` para Sudamérica, `crm7` para Japón, y así sucesivamente).
- Permisos para registrar una aplicación en **Microsoft Entra ID** y para crear un **application user** en el entorno de Dynamics. Normalmente son dos administradores distintos.
- Un proyecto de OneUptime donde puedas crear workflows y variables globales.

> Todo lo que viene a continuación usa los nombres de tabla de Dataverse, no las etiquetas de los formularios de Dynamics. Un caso es la tabla **`incident`**, su colección en una URL es **`incidents`**, su clave primaria es **`incidentid`** y su columna de título es **`title`**. El número de caso que ves en la interfaz es **`ticketnumber`**.

## Paso 1 — Registrar una aplicación en Microsoft Entra ID

OneUptime se autentica como una aplicación, no como una persona, así que usa el flujo **client credentials** de OAuth 2.0.

1. Inicia sesión en el [portal de Azure](https://portal.azure.com) como administrador del mismo tenant que tu entorno de Dynamics y abre **Microsoft Entra ID**.
2. Ve a **App registrations → New registration**. Ponle un nombre como `OneUptime Integration`, deja **Supported account types** en **Accounts in this organizational directory only** y selecciona **Register**.
3. Desde la página **Overview** de la aplicación, copia el **Application (client) ID** y el **Directory (tenant) ID**.
4. Ve a **Certificates & secrets → Client secrets → New client secret**. Copia el **Value** del secreto —no su ID— antes de salir de la página. No se vuelve a mostrar nunca. Un client secret puede vivir como mucho 24 meses, así que anota la caducidad en algún sitio donde vayas a verla.

Dos cosas que la gente añade aquí y que no necesitas:

- **Ningún API permission.** En el flujo de client credentials no hay usuario con sesión iniciada, así que los permisos delegados no hacen nada. `user_impersonation` bajo **Dataverse** es un permiso delegado y solo sirve para aplicaciones interactivas. Microsoft Entra ID emitirá tan tranquilo un token para Dataverse sin ningún permiso configurado — el acceso se decide del lado de Dynamics, en el Paso 2.
- **Ningún paso de consentimiento de administrador.** Por la misma razón.

Microsoft prefiere un certificado a un client secret para aplicaciones de producción. Esa opción requiere que quien llama construya y firme él mismo un JWT de aserción, cosa que un workflow no puede hacer, así que un client secret es la opción práctica aquí — trátalo en consecuencia: guárdalo en una variable secreta y rótalo antes de que caduque.

## Paso 2 — Crear el application user en Dynamics

Este es el paso que se salta la gente, y saltárselo produce el fallo más confuso de toda esta integración: la petición del token funciona, y luego todas las llamadas a Dataverse fallan con `403 Forbidden` y el código de error `0x80072560` — *"The user isn't a member of the organization."* Entra ID emite el token sin saber nada de Dynamics; Dynamics busca entonces una fila de usuario que corresponda a la aplicación, y no la hay.

1. Abre el [Power Platform admin center](https://admin.powerplatform.microsoft.com/) y selecciona **Manage → Environments**, y luego tu entorno.
2. Selecciona **Settings → Users + permissions → Application users**.
3. Selecciona **+ New app user**, luego **+ Add an app**, elige el registro del Paso 1 y selecciona **Add**.
4. Elige una **Business unit**, introduce una **Email address** y usa después el icono de edición junto a **Security roles**.
5. Asigna un rol de seguridad **personalizado** con privilegios de creación, lectura y escritura sobre la tabla **Case**. A un application user no se le puede dar uno de los roles integrados — Microsoft exige uno personalizado. Si no tienes un rol adecuado, copia uno existente y recórtalo.
6. Selecciona **Save** y luego **Create**.

Solo puedes tener un application user por aplicación registrada en un entorno. Los application users no consumen licencia y están exentos de las reglas de pertenencia al grupo de seguridad del entorno.

## Paso 3 — Guardar las credenciales en OneUptime

Ve a **Flujos de trabajo → Variables Globales → Crear** y añade estas, activando **Secret** en las marcadas:

| Nombre                   | Valor                                                       | Secreto |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | El Directory (tenant) ID del Paso 1                         | No     |
| `DYNAMICS_CLIENT_ID`     | El Application (client) ID del Paso 1                       | No     |
| `DYNAMICS_CLIENT_SECRET` | El **Value** del client secret del Paso 1                   | Sí     |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — sin barra final        | No     |

Pega el client secret exactamente como te lo dio Entra ID. OneUptime codifica el cuerpo del formulario por ti, así que no lo codifiques para URL a mano.

Referencia cualquiera de ellas desde un bloque con `{{global.variables.DYNAMICS_CLIENT_ID}}`. Consulta [Variables](/docs/workflows/variables) para ver cómo se depuran los secretos de los registros de ejecución.

## Paso 4 — Obtener un token de acceso

Cada ejecución obtiene su propio token. Los tokens duran de 60 a 90 minutos y el flujo de client credentials nunca emite un refresh token, así que no hay nada que cachear ni nada que renovar — una llamada HTTP extra por ejecución es todo el coste.

1. Abre **Flujos de trabajo → Crear flujo de trabajo**, nómbralo `Incidents → Dynamics 365` y abre el **Constructor**.
2. Haz clic en el marcador de posición punteado, añade el disparador **On Create Incident** y en su **Select Fields** pide las columnas que quieras enviar:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Deja su **Identifier** como `incident-on-create-1`.

3. Haz clic en **Añadir componente**, añade un bloque **API Post (JSON)**, conecta a él el punto **Success** del disparador y abre sus ajustes. Pon su **Identifier** en `get-token` y después:

   - **URL**: `https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**:

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**:

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**Escribe el nombre de la cabecera como `Content-Type`, con esa capitalización exacta.** Es lo que le indica a OneUptime que envíe el cuerpo como un form post en lugar de como JSON, que es la única forma que acepta el endpoint de token de Microsoft. `content-type` en minúsculas no coincide, y la petición sale como JSON y vuelve con `400`.

El `scope` debe ser la URL de tu entorno seguida de `/.default` — esa es la forma de cliente confidencial. Una URL de entorno equivocada aquí es la causa habitual de `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.

El token queda ahora disponible aguas abajo como:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## Paso 5 — Crear el caso

Añade un segundo bloque **API Post (JSON)**, conecta a él el punto **Success** de `get-token` y pon su **Identifier** en `create-case`.

- **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**:

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**:

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

Sustituye el GUID de la cuenta por la cuenta a la que pertenecen estos casos. **`customerid` es realmente obligatorio en un caso** — es una de las columnas que Dataverse impone en cualquier escritura programática, así que una creación sin ella se rechaza. Como puede apuntar tanto a una cuenta como a un contacto, nunca escribes `customerid@odata.bind`; escribes `customerid_account@odata.bind` o `customerid_contact@odata.bind`, y esos nombres distinguen mayúsculas y minúsculas. `title` es obligatorio de otra manera: los formularios de Dynamics lo exigen, la API no, así que envíalo de todos modos.

`Prefer: return=representation` es lo que hace esto utilizable desde un workflow. Sin ello, una creación correcta responde `204 No Content` y pone el URI del nuevo registro en una cabecera de respuesta `OData-EntityId`, de la que tendrías que extraer un GUID. Con ello, la respuesta es `201 Created` y lleva el propio registro, de modo que el siguiente bloque puede leer:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

Ahora enciende el workflow —**Vista General → Editar flujo de trabajo → Habilitado**—, declara un incidente de prueba y lee la ejecución en **Ejecuciones y Registros**. El bloque `create-case` debería mostrar un `201` y un cuerpo que contiene el nuevo `incidentid`. Los cambios en el lienzo se guardan solos; no hay botón de guardar.

### Mapear gravedad y estado

Dynamics trae `severitycode` con una sola opción, "Default Value", así que no hay una escala de gravedad lista para usar sobre la que mapear. Usa **`prioritycode`** en su lugar, y ramifica con un bloque **If / Else** sobre `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` si quieres prioridades por gravedad.

| Columna          | Valores                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` Alta, `2` Normal, `3` Baja                                                                                                    |
| `caseorigincode` | `1` Teléfono, `2` Correo electrónico, `3` Web, `2483` Facebook, `3986` Twitter, `700610000` IoT                                   |
| `casetypecode`   | `1` Pregunta, `2` Problema, `3` Solicitud                                                                                         |
| `statecode`      | `0` Activo, `1` Resuelto, `2` Cancelado                                                                                           |
| `statuscode`     | `1` En curso, `2` En espera, `3` Esperando detalles, `4` Investigando, `5` Problema resuelto, `6` Cancelado, `1000` Información proporcionada, `2000` Combinado |

`statuscode` es personalizable, así que un tenant puede haber añadido sus propios valores. Envía enteros, no etiquetas.

## Paso 6 — Mantener el incidente y el caso localizables entre sí

Todo lo que hagas después —comentar, resolver, sincronizar de vuelta— necesita que uno de los dos sistemas guarde el identificador del otro. Ponlo del lado de Dynamics.

Añade una columna de **texto de una sola línea** a la tabla Case, por ejemplo `new_oneuptimeincidentid`, y establécela al crear el caso:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

Después, cualquier workflow posterior puede encontrar el caso con un filtro:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

Si defines esa columna como **alternate key** en la tabla Case, puedes saltarte la búsqueda por completo y hacer un `PATCH` directo a `incidents(new_oneuptimeincidentid='<id>')` — un upsert que crea el caso si no existe y lo actualiza si existe. La clave tiene que terminar de construirse (su estado pasa a **Active**) antes de poder usarse, y los valores de una alternate key no pueden contener `/ < > * % & : \ ? + #`. Un id de OneUptime es un UUID simple, así que es seguro.

La dirección inversa —guardar el id del caso de Dynamics en el incidente de OneUptime— también funciona, usando un bloque **Update One Incident** que escriba en `customFields`. Ten cuidado con eso: `customFields` es una única columna JSON, así que escribirla reemplaza todos los valores de campos personalizados de ese incidente, no solo el tuyo. Mantener el vínculo del lado de Dynamics evita eso por completo.

## Paso 7 — Resolver el caso cuando se resuelve el incidente

Construye esto como un **segundo** workflow para que un fallo aquí no pueda impedir que se abran casos.

1. **Crear flujo de trabajo**, nómbralo `Incident resolved → Close Dynamics case` y añade el disparador **On Update Incident**.
2. En el **Listen on** del disparador, pon `{"currentIncidentStateId": true}` para que el workflow solo despierte con los cambios de estado en lugar de con cada edición. En **Select Fields**, pide `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Añade un bloque **If / Else**. **Input 1** es `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** es `==`, **Input 2** es `Resolved` — o como se llame el estado resuelto de tu proyecto. Consulta [Estados y gravedades de incidentes](/docs/incidents/states-and-severities).
4. Desde la rama **Sí**, repite el bloque `get-token` del Paso 4.
5. Añade un bloque **API Get (JSON)**, pon su **Identifier** en `find-case` y dale la URL con `$filter` del Paso 6. Una consulta de Dataverse responde con un array `value`, y una referencia de workflow puede indexar dentro de un array con corchetes, así que el id del caso es `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`.
6. Añade un bloque **API Post (JSON)** que cierre el caso:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: los mismos que en el Paso 5, menos `Prefer`.
   - **Request Body**:

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` es un valor de `statuscode` dentro del estado Resuelto — `5` es *Problema resuelto*.

     **Prueba este cuerpo contra tu propio entorno antes de depender de él.** `CloseIncident` recibe dos parámetros, `IncidentResolution` y `Status`, pero Microsoft no publica ningún ejemplo HTTP para él — todas las muestras oficiales son de C#. La forma anterior es la traducción convencional. Si tu entorno la rechaza, prueba a identificar el caso con una propiedad `"incidentid": "<the case id>"` simple en lugar de la forma `@odata.bind`, que es como los demás ejemplos de acciones de Microsoft referencian un registro existente.

**¿Por qué no hacer simplemente un `PATCH` del caso a `statecode: 1`?** Puedes — Microsoft documenta un `PATCH` de `statecode` y `statuscode` como el equivalente en la Web API del antiguo mensaje SetState, y es la herramienta adecuada para mover un caso entre estados activos. Lo que no hace es crear la actividad **Case Resolution** que se espera que tenga un caso resuelto en Dynamics 365 Customer Service, y será rechazado sin más en un entorno donde un administrador haya configurado transiciones de estado personalizadas. Usa `CloseIncident` para resolver; usa `PATCH` para todo lo demás. Y siempre que escribas `statecode`, establece `statuscode` en la misma petición — de lo contrario Dynamics aplica en silencio el `statuscode` predeterminado de ese `statecode`.

`CloseIncident` viene de Dynamics 365 Customer Service y no de Dataverse base, y no aparece en la referencia de acciones de Dataverse. Si devuelve `404`, confirma que existe en tu entorno recuperando `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` y buscando `CloseIncident`.

Para cualquier cosa que no llegue a cerrar el caso —una nota, una subida de prioridad, un cambio de título— usa un bloque **API Patch (JSON)** contra `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` con una cabecera `If-Match: *`, que impide que un upsert accidental cree un caso nuevo. Envía solo las columnas que estés cambiando.

## Entrante — de Dynamics 365 a OneUptime

Ahora la otra dirección: alguien cierra el caso en Dynamics, o un agente añade una nota, y OneUptime debería enterarse.

### Construye primero el workflow receptor

1. **Crear flujo de trabajo**, nómbralo `Dynamics 365 → OneUptime` y añade el disparador **Webhook**.
2. Abre los **Ajustes** de ese workflow y copia la **Clave secreta del webhook**. Tu URL es:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   En una instalación autoalojada, sustituye por tu propio host. Trata la URL como una contraseña — cualquiera que la tenga puede arrancar el workflow. Puedes restablecer la clave desde esa misma página.

3. Añade un bloque **If / Else** que compruebe un secreto compartido antes de que ocurra cualquier otra cosa. **Input 1** es `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — un valor que inventas y guardas como variable global secreta.
4. Desde la rama **Sí**, añade un bloque **Update One Incident**:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: lo que el cambio del caso deba significar en OneUptime — un cambio de estado, una nota, una etiqueta.

   Para mover el incidente a un estado necesitarás el id de ese estado: un bloque **Find One Incident State** con la consulta `{"name": "Resolved"}` te da `{{local.components.incident-state-find-one-1.returnValues.model._id}}` para escribirlo en `currentIncidentStateId`.

Déjalo habilitado y listo. Ahora dale a Dynamics algo a lo que llamar.

### Opción A — un flujo de Power Automate (recomendado)

Este es el camino que deberían tomar la mayoría de los equipos: controlas la carga útil y no hay nada que instalar.

1. En [Power Automate](https://make.powerautomate.com), crea un **Automated cloud flow**.
2. Disparador: **Microsoft Dataverse → When a row is added, modified or deleted**.

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — cualquier cosa más estrecha solo se dispara para las filas de tu propiedad o de tu business unit.
   - **Select columns**: `statecode,statuscode`. Este es un filtro solo para actualizaciones y merece la pena acertar con él. Aquí no se admiten columnas de búsqueda, y nunca listes una columna que esté presente en todas las actualizaciones (como la clave primaria) o el flujo se disparará en cada guardado.

3. Añade **Microsoft Dataverse → Get a row by ID**, tabla `Cases`, id de fila desde el disparador, y un **Select columns** de `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`.

   Esta segunda llamada vale lo que cuesta. En una actualización el disparador solo lleva las columnas que cambiaron, así que los identificadores con los que necesitas hacer coincidir pueden sencillamente no estar ahí.

4. Añade la acción integrada **HTTP**:

   - **Method**: `POST`
   - **URI**: la URL del webhook de OneUptime de más arriba
   - **Headers**: `Content-Type: application/json` y `X-OneUptime-Secret: <the same secret>`
   - **Body**: constrúyelo a partir de las salidas de *Get a row by ID*, por ejemplo

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. Guarda y activa el flujo.

Conviene saber antes de comprometerte con este camino:

- El **conector de Microsoft Dataverse es premium.** Para un flujo automatizado solo el propietario del flujo necesita la licencia, no todos los que tocan el caso — pero si la licencia del propietario caduca, el flujo se detiene en silencio.
- Los disparadores de Dataverse son **push, no sondeo** — Dynamics registra una devolución de llamada y la dispara. La entrega suele darse en segundos; cualquier cosa que pase de cinco minutos significa que el servicio asíncrono está saturado, lo que puedes ver en **Settings → System Jobs** del admin center.
- Las cabeceras personalizadas sobreviven. Power Automate elimina varias familias de cabeceras estándar de las acciones HTTP (la mayoría de las cabeceras `Accept-*` y `Content-*`, `Host`, `Origin`, `Cookie`), pero una cabecera propia como `X-OneUptime-Secret` se pasa tal cual.
- El flujo debe vivir en el mismo entorno que la tabla que vigila.
- Las peticiones cuentan contra la asignación de peticiones de Power Platform de tu tenant, y la limitación del conector se manifiesta como un `429` dentro de la ejecución del flujo.

### Opción B — un webhook nativo de Dataverse

Si Power Automate no está disponible, Dataverse puede llamar a OneUptime directamente. Registra el endpoint con la [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook): **Register New WebHook**, dale la URL de OneUptime, elige la autenticación **HttpHeader** y añade `X-OneUptime-Secret` con tu secreto. Después registra un paso sobre la tabla **incident** para el mensaje **Update**, con **Filtering Attributes** limitados a las columnas que te importan, etapa **PostOperation**, modo de ejecución **Asynchronous**.

Toma este camino con los ojos abiertos:

- **Solo los puertos 80 y 443.** Un OneUptime autoalojado en cualquier otro puerto no puede registrarse.
- **Dataverse no verifica tu secreto.** Envía la cabecera; rechazar una petición que no la lleve es tarea exclusiva de tu workflow — que es para lo que está el bloque **If / Else** del workflow receptor.
- **La carga útil no es un objeto JSON amigable.** Es un `RemoteExecutionContext` serializado, en el que `InputParameters` es un *array* de pares `{key, value}` y la fila modificada está bajo la clave `Target` con sus columnas en otro array `Attributes`. Cuenta con añadir un bloque **Run Custom JavaScript** para aplanarlo antes de que nada más pueda leerlo.
- **Solo se incluyen las columnas modificadas** en una actualización, así que registra una **Post Image** si necesitas `ticketnumber` o tu columna de id de OneUptime.
- **Por encima de 256 KB se eliminan las partes interesantes** — `InputParameters`, `PreEntityImages` y `PostEntityImages` desaparecen, y la petición lleva una cabecera `x-ms-dynamics-msg-size-exceeded`. `PrimaryEntityId` y `PrimaryEntityName` sobreviven, así que la alternativa es volver a leer la fila a través de la Web API.
- **La entrega es casi implacable.** Dataverse espera 60 segundos por un `2xx` y reintenta exactamente una vez, solo para `502`, `503` y `504`. Cualquier otra cosa —incluido un `500` de tu lado— no se reintenta; acaba como un System Job fallido.
- Elige **Asynchronous**. Un paso síncrono bloquea el guardado del agente en tu endpoint, y si la transacción se revierte después, la petición ya ha salido y no puede retirarse.

Los workflows clásicos en segundo plano de Dynamics no tienen ningún paso de HTTP ni de webhook, así que no son una tercera opción aquí.

## Hacer lo mismo con las alertas

Todo lo anterior está escrito alrededor de incidentes porque es el caso habitual, pero las alertas funcionan igual — cambia el tipo de registro y nada más cambia:

| Incidente                                                    | Alerta                                              |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

Un workflow tiene exactamente un disparador, así que los incidentes y las alertas necesitan un workflow cada uno. Si ambos harían el mismo trabajo, construye la mitad de Dynamics una sola vez y llámala desde los dos con el componente **Execute Workflow**.

## Solución de problemas

Lee primero el bloque que falla en **Ejecuciones y Registros** — ambos endpoints de Microsoft devuelven un cuerpo JSON explicativo, y el componente API lo conserva en `response-body`.

**La petición del token falla con `400` e `invalid_request` o un tipo de concesión no admitido.** La cabecera `Content-Type` no es exactamente `Content-Type: application/x-www-form-urlencoded`, así que el cuerpo salió como JSON. Revisa la capitalización.

**`400` con `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** El `scope` no es la URL de tu entorno más `/.default`. Copia la URL de **Developer resources** y quita cualquier barra final y cualquier ruta `/api/data/...`.

**`401 Unauthorized` desde Dynamics.** La cabecera `Authorization` falta, está mal formada, o el token ha caducado a mitad de la ejecución. Debe decir `Bearer <token>` con un solo espacio.

**`403 Forbidden` con `0x80072560`, "The user isn't a member of the organization".** El Paso 2 se saltó o el application user está vinculado a un registro de aplicación distinto. El token está bien; el usuario del lado de Dynamics no está ahí.

**`403 Forbidden` con un error de privilegios.** El application user existe pero su rol de seguridad personalizado no tiene Create, Read o Write sobre **Case**.

**`400 Bad Request` mencionando al cliente.** `customerid` es obligatorio. Establece `customerid_account@odata.bind` o `customerid_contact@odata.bind`, escrito exactamente así, con un URI con barra inicial como `/accounts(<guid>)`.

**`404 Not Found` en `/CloseIncident`.** La acción es una acción de Dynamics 365 Customer Service. Busca la acción en el `$metadata` de tu entorno antes de dar por hecho que está disponible.

**`412 Precondition Failed` con `DuplicateRecord`.** Ha coincidido una regla de detección de duplicados. O acotas la regla, o dejas de enviar el campo con el que coincide.

**`429 Too Many Requests`.** Los límites de protección del servicio de Dataverse — aproximadamente 6.000 peticiones y 20 minutos de tiempo de ejecución por usuario en cualquier ventana de cinco minutos, por servidor web. La respuesta lleva un `Retry-After` en segundos. Si un workflow está haciendo ráfagas, ponle un bloque **Delay** o traslada el trabajo a un workflow programado que agrupe.

**No llega nada del lado de OneUptime.** Envía tú mismo una petición a la URL del webhook con `curl` y comprueba las **Ejecuciones y Registros** del workflow. Si tu propia petición aparece y la de Dynamics no, el problema está aguas arriba: para Power Automate, mira el historial de ejecuciones del propio flujo; para un webhook nativo, mira **Settings → System Jobs** filtrado por fallos.

**El workflow se ejecuta pero el incidente no cambia.** Un bloque **Update One Incident** informa de `Items Updated: 0` cuando la consulta no encontró nada — eso es un éxito, no un error. Comprueba que el id de la carga útil es el id del incidente de OneUptime y que estás consultando `_id`.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — los patrones entrante y saliente, y la guía de autenticación rápida.
- [Jira](/docs/integrations/jira) — la misma construcción bidireccional contra Jira.
- [Resumen de Workflows](/docs/workflows/index) y [Crear un flujo de trabajo](/docs/workflows/authoring) — el lienzo, los identificadores y cómo encender un workflow.
- [Componentes](/docs/workflows/components) — los bloques API, If / Else y los componentes de datos de OneUptime.
- [Variables](/docs/workflows/variables) — secretos, y lectura de la salida de un bloque desde el siguiente.
- [Configuración y seguridad](/docs/workflows/configuration) — seguridad de los webhooks y acceso de red saliente.
- [Direcciones IP](/docs/configuration/ip-addresses) — los rangos salientes de OneUptime, por si Dynamics está detrás de una lista de permitidos.
