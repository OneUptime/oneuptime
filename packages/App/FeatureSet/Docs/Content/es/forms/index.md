# Visión general de los formularios

Un formulario es una página que cualquiera con su enlace puede rellenar, sin una cuenta de OneUptime. Cada envío crea algo en tu proyecto: un **incidente**, para avisos de problemas, o un **evento de mantenimiento programado**, para solicitudes de cambio y de mantenimiento. Construyes las preguntas del formulario en un editor de arrastrar y soltar, decides cómo las respuestas se convierten en el registro y compartes el enlace con las personas que deben usarlo.

Usa un formulario cuando quienes detectan un problema, o necesitan un cambio, no son quienes gestionan tus incidentes y mantenimientos: agentes de soporte, compañeros de otro departamento, el responsable de una tienda, el equipo de operaciones de un cliente. Abren el enlace, responden a tus preguntas y pulsan **Enviar**. Tu equipo recibe un incidente o un evento normal, con las respuestas en sus campos y una nota privada que registra quién lo envió.

:::cards
- [Crear tu primer formulario](#crear-tu-primer-formulario): De un formulario en blanco a un enlace que puedes compartir.
- [Crear un formulario](/docs/forms/building): Preguntas, tipos de respuesta, preguntas ocultas, plantillas y marca.
- [Lo que crea un envío](/docs/forms/on-submit): Cómo las respuestas y los ajustes se convierten en un incidente o un evento de mantenimiento.
- [Compartir y seguridad](/docs/forms/sharing-and-security): El enlace, la lista de IP permitidas, los límites de frecuencia y la solución de problemas.
:::

## Cómo funciona un formulario

```mermaid title="De un formulario rellenado a un incidente o un evento de mantenimiento"
flowchart TB
    submitter["Alguien con el enlace,<br/>sin cuenta"] --> page["La página del formulario"]
    page -->|Enviar| checks["Protecciones y<br/>comprobación de respuestas"]
    checks --> submission["Envío, guardado<br/>con el formulario"]
    submission --> target{"Cada envío crea"}
    target -->|Incidente| incident["Incidente, oculto<br/>en las páginas de estado"]
    target -->|Mantenimiento programado| event["Evento de mantenimiento,<br/>oculto salvo que se indique"]
    incident --> response["Se ejecutan las políticas<br/>de guardia y las reglas"]
    incident --> note["Nota privada: quién lo envió,<br/>otras respuestas"]
    event --> note
```

Cada solicitud pasa primero por las protecciones del formulario: su propia página, los límites de frecuencia, la lista de IP permitidas y el captcha. Un envío cuyas respuestas encajan se guarda y crea un registro, rellenado a partir de las respuestas, de los ajustes de **Al enviar** del formulario y, en un incidente, de su plantilla de incidente. Nada de lo que crea llega a una página de estado hasta que tu equipo lo decide.

## De un vistazo

- **Un producto propio**: **Formularios** está en el menú de productos, en `/dashboard/{projectId}/forms`. Cada formulario tiene su propio enlace, como `https://oneuptime.com/accounts/form/<share-key>` en OneUptime Cloud.
- **Sin cuenta**: cualquiera con el enlace puede abrir el formulario y enviarlo, sin iniciar sesión.
- **Un editor, no una página de ajustes**: añade tus propias preguntas (respuestas cortas, párrafos, desplegables, fechas, casillas y más), los campos de lo que crea el formulario (título, descripción, severidad, monitores, etiquetas, inicio y fin), tus campos personalizados y el nombre y el correo de quien envía. Arrástralos para ordenarlos, previsualiza el formulario y guárdalo.
- **Tú decides de dónde sale cada valor**: la página **Al enviar** enumera cada campo del nuevo incidente o evento junto a su origen: una respuesta, un valor predeterminado, un ajuste que se aplica siempre o la plantilla de incidente.
- **Oculto hasta que alguien lo publica**: los incidentes de un formulario nunca se muestran en las páginas de estado ni se envían a los suscriptores cuando se declaran; los eventos de mantenimiento tampoco, salvo que el formulario lo indique.
- **Protegido por capas**: un interruptor **Acepta envíos**, una **Lista de IP permitidas** opcional, el rechazo de solicitudes de otros sitios web, límites de frecuencia, el captcha de la instancia y límites de tamaño en cada respuesta.
- **Cada envío se conserva**: la página **Envíos** de cada formulario, y **Formularios → Envíos** para todos ellos, enumeran las respuestas y enlazan a lo que creó cada envío.
- **Tu propia marca**: sube un logotipo para la parte superior de la página del formulario y un favicon para la pestaña del navegador, en la sección **Marca** de la página **Construir**. Hasta entonces, el formulario muestra los de OneUptime.
- **Plantillas para los casos habituales**: guarda conjuntos de respuestas con nombre, como **Caída de la aplicación** o **Mantenimiento planificado**, y la gente elige uno en la parte superior del formulario para rellenarlo, o abre su propio enlace. Cada plantilla puede además hacer una pregunta obligatoria, opcional u oculta para su caso. Un solo formulario, y un solo marcador, sirve a todo un equipo.
- **Preguntas ocultas**: oculta una pregunta que nadie debería tener que responder, como la descripción del incidente, y deja que cada plantilla la responda, o que la haga, en los casos que la necesitan.
- **Duplicar formulario**: empieza un formulario para otro equipo a partir de uno que funciona, con sus preguntas, plantillas y ajustes.

## Qué puede crear un formulario

Al crear un formulario eliges qué **Cada envío crea**. Puedes cambiarlo después en la página **Al enviar** del formulario.

| Cada envío crea | Úsalo para | Qué ocurre |
| --- | --- | --- |
| **Incidente** | Avisos de problemas | Se declara un incidente al momento, así que tus políticas de guardia y tus reglas se ejecutan y se avisa a las personas de guardia. No aparece en las páginas de estado hasta que alguien que responde lo publica. |
| **Mantenimiento programado** | Solicitudes de cambio y de mantenimiento | Se programa un evento de mantenimiento para la ventana que pide quien envía. Salvo que el formulario diga lo contrario, no aparece en sus páginas de estado ni avisa a ningún suscriptor. |

Los formularios empiezan con estos dos, y llegarán más tipos de registro.

## Antes de empezar

- **Un plan que incluya formularios.** En OneUptime Cloud, los formularios necesitan el plan **Growth** o superior. Consulta [Plan](#plan).
- **Permiso para crear formularios.** **Create Form** corresponde a los propietarios y administradores del proyecto, y a los roles a los que se lo des. Consulta [Permisos](#permisos).
- **Para un formulario de incidentes, una severidad.** Cada incidente necesita una: de una pregunta, de los ajustes del formulario o de su plantilla de incidente. Sin ella, se rechaza cada envío. Consulta [Lo que crea un envío](/docs/forms/on-submit#how-a-submission-becomes-an-incident).

## Crear tu primer formulario

:::steps
### Crear el formulario

Abre **Formularios** desde el menú de productos y haz clic en **Crear formulario**. Dale un nombre al formulario (el título de su página pública, único en el proyecto), elige qué **Cada envío crea** y, si quieres, una descripción en Markdown, que se muestra en la parte superior de la página pública.

### Construir sus preguntas

El formulario se abre en su página **Construir**, ya preguntando un título, una descripción y quién envía (y, en un formulario de mantenimiento, cuándo empieza y termina el mantenimiento). Añade, quita y reordena preguntas, y luego haz clic en **Guardar cambios**. Consulta [Crear un formulario](/docs/forms/building).

### Decidir qué crea un envío

En **Al enviar**, comprueba cómo un envío se convierte en un incidente o un evento, y haz clic en **Editar configuración** para darle valores predeterminados: una severidad, una plantilla de incidente, monitores y etiquetas que se adjuntan siempre, propietarios a los que avisar. Consulta [Lo que crea un envío](/docs/forms/on-submit).

### Añadir plantillas si la gente informa de los mismos casos

En **Plantillas**, guarda una plantilla para cada caso que se informa a menudo: el formulario las muestra sobre sus preguntas, se rellena con la elegida y hace las preguntas como dice esa plantilla; una pregunta que necesita un caso puede ser obligatoria en su plantilla y estar oculta en las demás. Consulta [Plantillas](/docs/forms/building#templates).

### Compartir el enlace

En **Compartir**, copia el enlace y envíalo a las personas que deben usar el formulario. Consulta [Compartir y seguridad](/docs/forms/sharing-and-security).
:::

> [!IMPORTANT]
> Un formulario nuevo **Acepta envíos** en cuanto se crea, pero nadie puede llegar a él hasta que compartes su enlace. Configura primero sus preguntas y sus protecciones.

## Las páginas de un formulario

| Página | Qué contiene |
| --- | --- |
| **Construir** | El nombre y la descripción del formulario, su **Marca** (logotipo y favicon, plegados) y el editor: sus preguntas, la paleta de preguntas y **Vista previa**. |
| **Plantillas** | Conjuntos de respuestas con nombre desde los que se puede empezar el formulario, cómo hace las preguntas cada uno, el que se abre por defecto y el enlace propio de cada uno. |
| **Al enviar** | Qué crea cada envío y cómo se rellena cada uno de sus campos. **Editar configuración** cambia los valores predeterminados y lo que se aplica siempre. |
| **Compartir** | **Acepta envíos**, el **Enlace para compartir**, el mensaje que se muestra tras enviar y la **Lista de IP permitidas**. |
| **Envíos** | Cada envío hecho con el formulario, el más reciente primero, con sus respuestas y lo que creó. |
| **Duplicar formulario** | En **Avanzado**: una copia del formulario, con nombre puesto por ti, con sus preguntas, plantillas, ajustes de Al enviar, marca, mensaje de agradecimiento y lista de IP permitidas, y un enlace propio. La copia empieza desactivada y se abre en su editor. |
| **Eliminar formulario** | La eliminación del formulario, en **Avanzado**. Sus envíos se eliminan con él; los incidentes y eventos que creó, no. |

La sección **Desarrolladores** del menú del formulario contiene sus páginas de Terraform, API y asistente de IA, como cualquier otro recurso.

## Formularios y plantillas de incidentes

Una plantilla y un formulario te ahorran escribir dos veces el mismo incidente, pero sirven a personas distintas:

| | Plantilla de incidente | Formulario |
| --- | --- | --- |
| Quién la usa | Tu equipo, con sesión iniciada en OneUptime | Cualquiera con el enlace, sin cuenta |
| Dónde | **Crear desde plantilla** en la lista de incidentes | Una página propia, en el enlace del formulario |
| Qué se puede cambiar | Cada campo del incidente, antes de declararlo | Solo las respuestas a las preguntas que elegiste |
| Qué se ve | Tus monitores, políticas, propietarios y cada campo | El nombre, la descripción y las preguntas del formulario, y solo las opciones que decidiste ofrecer |
| Páginas de estado | Lo que digan la plantilla y el formulario de declaración | Oculto hasta que alguien que responde publica el incidente |

Funcionan juntos. Dale a un formulario de incidentes una **Plantilla de incidente** en su página **Al enviar**, y cada incidente que declare se declarará a partir de esa plantilla: construye la plantilla con lo que tu equipo necesita en el incidente, y el formulario con lo que quieres preguntar a quien envía.

## Envíos

La página **Envíos** de un formulario enumera cada envío hecho con él, el más reciente primero, con **Enviado el**, **Enviado por** (el nombre y el correo que dio quien envía, o **Anónimo**) y **Creado**, un enlace al incidente o evento que creó. **Ver respuestas** muestra cada respuesta tal como la dio quien envía. **Formularios → Envíos** enumera los envíos de todos los formularios del proyecto.

Los envíos los escribe el formulario, nunca una persona, y no se pueden editar. Eliminar uno quita de la lista sus respuestas y el nombre y el correo de quien envió; el incidente o evento que creó se queda, y también la nota privada que lleva, que repite los datos de quien envió y las respuestas. Cuando se elimina el incidente o el evento, su envío se queda y su columna **Creado** indica **Eliminado desde entonces**.

> [!WARNING]
> Cuando eliminas los datos personales de alguien, no basta con eliminar el envío: edita o elimina también la nota privada del incidente o evento que creó.

## Permisos

Los formularios permiten que personas ajenas a tu equipo creen incidentes y eventos de mantenimiento en tu proyecto, así que los gestionan los propietarios y administradores del proyecto, y los roles a los que des los permisos **Form**. Están en el grupo **Form** de la [Referencia de permisos](/docs/permissions/reference):

| Permiso | Qué permite | Quién lo tiene por defecto |
| --- | --- | --- |
| **Create Form** | Crear formularios y duplicarlos. | Project Owner, Project Admin |
| **Edit Form** | Cambiar un formulario: sus preguntas, su marca, sus plantillas, sus ajustes de Al enviar, **Acepta envíos**, su enlace y su **Lista de IP permitidas**. | Project Owner, Project Admin |
| **Delete Form** | Eliminar un formulario, y con él sus envíos. | Project Owner, Project Admin |
| **Read Form** | Ver los formularios, sus preguntas, sus ajustes y sus enlaces. | Los anteriores, más Project Member, Viewer y los roles de incidentes y de mantenimiento programado |
| **Read Form Submission** | Ver los envíos y sus respuestas. | Project Owner, Project Admin |
| **Delete Form Submission** | Eliminar envíos. | Project Owner, Project Admin |

Los envíos contienen lo que escribieron desconocidos (nombres, direcciones de correo y respuestas que quizá nunca lleguen al registro), así que solo los ven los propietarios y administradores del proyecto, salvo que concedas **Read Form Submission**. Quien puede leer un formulario puede ver y compartir su enlace. Enviar un formulario no necesita ningún permiso. Para ver cómo se combinan los roles y los permisos granulares, consulta [Usuarios, equipos y permisos](/docs/permissions/index).

## Plan

En OneUptime Cloud, los formularios necesitan el plan **Growth** o superior, y la **Lista de IP permitidas** de un formulario necesita **Scale**, tanto si se define al crear el formulario como si se edita después. Los enlaces de un proyecto por debajo del plan **Growth**, o cuya suscripción está impagada, muestran el mensaje de «no disponible», y no se crea nada.

## Formularios mediante la API

Los formularios son un recurso normal de la API en `/api/form`, y sus envíos en `/api/form-submission`, que puedes leer y eliminar pero no crear ni editar. La [referencia de la API](/reference) contiene la forma completa de las solicitudes y las respuestas.

### Preguntas y ajustes

Las preguntas de un formulario son su columna `fields`, una lista JSON en el orden en que el formulario las hace, y sus ajustes de Al enviar son sus `targetSettings`:

```json
{
  "data": {
    "targetType": "Incident",
    "fields": [
      {
        "id": "what",
        "source": "TargetField",
        "targetField": "title",
        "label": "What is wrong?",
        "isRequired": true
      },
      {
        "id": "office",
        "source": "Question",
        "type": "Dropdown",
        "label": "Which office are you in?",
        "dropdownOptions": "Berlin\nLondon",
        "isRequired": false
      },
      {
        "id": "email",
        "source": "Submitter",
        "submitterField": "Email",
        "label": "Your Email",
        "isRequired": true
      }
    ],
    "targetSettings": {
      "incidentSeverityId": "<severity-id>",
      "labelIds": ["<label-id>"]
    }
  }
}
```

Cada pregunta tiene su propio `id` (letras, dígitos, `-` y `_`), una `source`, un `label`, y opcionalmente `helpText` e `isRequired`:

| `source` | Qué pregunta |
| --- | --- |
| `Question` | Una pregunta propia del formulario, que se responde según su `type`: `Text`, `LongText`, `Markdown`, `Number`, `Dropdown`, `MultiSelectDropdown`, `Boolean`, `Date` o `DateTime`. Un desplegable enumera sus `dropdownOptions`, una por línea. |
| `TargetField` | Un campo de lo que crea el formulario, nombrado por `targetField`: `title`, `description`, `incidentSeverityId`, `monitors`, `labels` e `impactStartedAt` para un incidente; `title`, `description`, `startsAt`, `endsAt`, `monitors`, `statusPages` y `labels` para un evento de mantenimiento. Un campo que se responde eligiendo enumera los registros que ofrece en `allowedOptionIds`. |
| `TargetCustomField` | Uno de los campos personalizados del incidente o del evento, nombrado por `customFieldId`. |
| `Submitter` | El `Name` o el `Email` de quien envía, nombrado por `submitterField`. |

Una pregunta con `isHidden` en `true` no se muestra en la página pública, nunca es obligatoria y solo se responde desde la plantilla que nombra un envío, salvo que esa plantilla la haga. `isRequired` e `isHidden` son el valor predeterminado del formulario; cada plantilla puede hacer una pregunta a su manera.

### Plantillas en la API

Las plantillas de un formulario son su columna `templates`, una lista JSON en el orden en que el formulario las muestra. Cada plantilla tiene su propio `id` (letras, dígitos, `-` y `_`), un `name` de hasta 100 caracteres, único en el formulario, y `answers` indexadas por id de pregunta, cada una tal como la envía un envío: texto, un número, `true` o `false`, el valor de una opción o una lista de valores para una selección múltiple. `isDefault` en `true` la convierte en la plantilla con la que se abre el formulario; un formulario tiene como mucho una, y hasta 50 plantillas.

`fieldSettings`, indexado también por id de pregunta, dice cómo hace la plantilla una pregunta: `Required`, `Optional` o `Hidden`. Una pregunta que no enumera (o que enumera como `null`) se hace como la hace el formulario, y las preguntas `startsAt` y `endsAt` de un evento de mantenimiento solo pueden ser `Required`:

```json
{
  "data": {
    "templates": [
      {
        "id": "outage",
        "name": "Application Outage",
        "isDefault": true,
        "answers": {
          "what": "The application is down",
          "office": "Berlin"
        },
        "fieldSettings": {
          "office": "Required",
          "email": "Optional"
        }
      }
    ]
  }
}
```

Las preguntas, las plantillas y los ajustes se comprueban cada vez que se guardan (desde el panel, la API, Terraform o un workflow), y una lista que incumple una regla se rechaza con un mensaje que nombra lo que está mal. `shareKey`, la clave del enlace del formulario, la define OneUptime al crear el formulario, y cambiarla es lo que hace **Restablecer enlace**.

### Marca en la API

La marca de un formulario son sus `logoFileId`, `logoAltText` y `faviconFileId`. Sube primero la imagen con `POST /api/file`, en el proyecto del formulario (con una clave de API de ese proyecto, o con sesión iniciada como miembro y su id en la cabecera `tenantid`), enviando su `name`, su `fileType`, como `image/png`, y los bytes en base64 en `file`, y establece el `_id` que devuelve. Una subida a un proyecto del que no eres miembro se rechaza con "You can upload files only to a project you are a member of." Toda subida es privada: OneUptime define `isPublic`, diga lo que diga la solicitud. Cada imagen se comprueba al guardar el formulario: debe haberse subido en el proyecto del formulario, y un logotipo debe ser una imagen PNG, JPEG, GIF, WebP o SVG de 512 KB como máximo, y un favicon una de esas o un ICO de 128 KB como máximo. Establece un id en `null` para volver a los de OneUptime. Consulta [Marca](/docs/forms/building#branding).

### Leer los envíos

Para enumerar los envíos de un formulario:

```bash
curl -X POST https://oneuptime.com/api/form-submission/get-list \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "formId": "<form-id>" },
    "select": { "submitterName": true, "submitterEmail": true, "answers": true, "incidentId": true, "scheduledMaintenanceId": true, "createdAt": true },
    "limit": 50,
    "skip": 0
  }'
```

### Workflows

Los formularios tienen los componentes de workflow generados: **On Create Form**, **On Update Form**, etc. Para actuar sobre lo que creó un formulario, usa **On Create Incident** u **On Create Scheduled Maintenance**.

### Los endpoints propios de la página pública

La página pública habla con dos rutas que no necesitan clave de API: `GET /api/form/public/<shareKey>`, que devuelve el nombre, la descripción y las preguntas del formulario (y su logotipo, el texto alternativo del logotipo y su favicon, las imágenes en base64, cuando los tiene, y sus plantillas, con sus respuestas a las preguntas que hace la página), y `POST /api/form/public/<shareKey>/submit`, que lo envía, nombrando en `templateId` la plantilla desde la que empezó quien envía. Son los endpoints propios de la página, no una API sobre la que construir: cada llamada pasa por las protecciones del formulario (consulta [Compartir y seguridad](/docs/forms/sharing-and-security)) y cambian con la página. Para crear incidentes desde tu propio código, usa `POST /api/incident` con una clave de API: consulta [Declarar un incidente](/docs/incidents/declaring-incidents).

## Dónde están tus formularios de incidentes

Los formularios sustituyen a los **Incident Forms** que estaban en **Incidentes → Ajustes → Formularios**. Cada formulario de incidentes se trasladó al actualizar, con el mismo enlace y los mismos envíos:

- Sus preguntas pasaron a ser las del editor: el título, la descripción salvo que estuviera oculta, la severidad cuando quien enviaba podía elegirla, cada campo personalizado que pedía (en el orden de los campos personalizados), y **Your Name** y **Your Email**, obligatorios salvo que el formulario permitiera avisos anónimos.
- Su severidad y su plantilla de incidente pasaron a ser sus valores predeterminados de **Al enviar**.
- Su interruptor **Habilitado**, su mensaje de éxito y su **Lista de IP permitidas** no cambian, y tampoco su enlace: los enlaces antiguos `/accounts/incident-form/<share-key>` abren el formulario en su nueva dirección.
- Los permisos **Incident Form** pasaron a ser los permisos **Form**, para cada equipo y clave de API que los tenía.

Las páginas antiguas del panel redirigen a las nuevas.

## Próximos pasos

:::cards
- [Crear un formulario](/docs/forms/building): Preguntas, tipos de respuesta, campos vinculados, campos personalizados y la vista previa.
- [Lo que crea un envío](/docs/forms/on-submit): Cómo las respuestas y los ajustes de Al enviar se convierten en un incidente o un evento de mantenimiento.
- [Compartir y seguridad](/docs/forms/sharing-and-security): El enlace, la lista de IP permitidas, los límites de frecuencia, el captcha y la solución de problemas.
- [Declarar un incidente](/docs/incidents/declaring-incidents): Las otras formas de declarar incidentes.
:::
