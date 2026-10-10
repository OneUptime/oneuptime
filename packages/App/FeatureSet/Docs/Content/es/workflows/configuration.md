# Configuración y seguridad del flujo de trabajo

Lo que debes saber antes de poner un flujo de trabajo frente a tráfico real: cómo activarlo con seguridad, quién puede hacer qué, cómo se mantienen privados los secretos y las URL, qué pueden cambiar los pasos de un flujo de trabajo y los límites dentro de los que trabaja cada ejecución.

:::cards
- [Pasar a producción](#activar-o-desactivar-un-flujo-de-trabajo): Prueba con Ejecutar flujo de trabajo y después deja el flujo de trabajo activado.
- [Permisos](#permisos): Los roles de flujo de trabajo y los permisos individuales que hay detrás.
- [Qué pueden hacer los pasos](#qué-pueden-hacer-los-pasos-de-un-flujo-de-trabajo): Los pasos actúan como Project Admin del proyecto del flujo de trabajo.
- [Límites](#límites-del-plan): Ejecuciones por plan, duración de una ejecución y llamadas entre flujos de trabajo.
:::

## Activar o desactivar un flujo de trabajo

Cada flujo de trabajo tiene un interruptor **Habilitado** en la parte superior de su **Constructor** y en su página **Vista general**. Cuando está desactivado, el flujo de trabajo no se ejecuta: las llamadas de webhook, el correo entrante, las horas programadas y los eventos de OneUptime se ignoran, igual que **Ejecutar flujo de trabajo** y **Ejecutar solo este paso**. Los flujos de trabajo nuevos empiezan deshabilitados.

Usa este interruptor como tu señal de «listo para salir»:

:::steps
1. Construye el flujo de trabajo.
2. Haz clic en **Ejecutar flujo de trabajo** en el **Constructor** con valores realistas. Un flujo de trabajo deshabilitado no puede ejecutarse ni siquiera a mano, así que el Constructor pide activarlo primero: haz clic en **Activar y ejecutar**.
3. Abre la ejecución y comprueba que cada bloque fue adonde esperabas. Consulta [Ejecuciones](/docs/workflows/runs-and-logs).
4. Deja **Habilitado** activado si está listo. Si no lo está, desactívalo hasta que lo esté: mientras está activado, su disparador salta con eventos reales.
:::

Desactivar un flujo de trabajo impide que empiecen ejecuciones nuevas. Una ejecución que ya está en curso termina, pero una ejecución que espera en un bloque **Sleep** se cancela al despertar.

## Archivar un flujo de trabajo

Archiva un flujo de trabajo que ya no necesitas pero que quieres conservar. Un flujo de trabajo archivado:

- **Nunca se ejecuta**, con ningún disparador. Las ejecuciones manuales y **Ejecutar solo este paso**, las llamadas de webhook, las programaciones, los eventos de OneUptime, el correo entrante y los pasos **Execute Workflow** de otros flujos de trabajo se rechazan. Una llamada de webhook a un flujo de trabajo archivado recibe un error que dice que el flujo de trabajo está archivado.
- **Detiene las ejecuciones que esperan.** Una ejecución que duerme en un paso **Sleep** se cancela al despertar, y una ejecución que estaba en cola pero aún no había empezado termina con "Workflow was archived before this run started, so it did not run."
- **Sale de la lista de flujos de trabajo.** Lo encontrarás en **Flujos de trabajo → Avanzado → Archivado**.
- **Lo conserva todo.** Sus pasos, variables, propietarios, etiquetas e historial de ejecuciones se quedan como estaban.

Para archivar un flujo de trabajo, ábrelo, ve a **Ajustes** y haz clic en **Archivar**. Para archivar varios, selecciónalos en la lista **Flujos de trabajo** y elige **Archivar**.

Para recuperar un flujo de trabajo, abre **Flujos de trabajo → Avanzado → Archivado**, selecciónalo y elige **Desarchivar**, o ábrelo y haz clic en **Desarchivar** en el banner de la parte superior de sus páginas.

Archivar y el interruptor **Habilitado** son independientes. Archivar no toca el interruptor, así que un flujo de trabajo que estaba activado vuelve a ejecutarse en cuanto se desarchiva, y uno que estaba desactivado sigue así. La página **Archivado** muestra cuál es cuál en su columna **Al desarchivarse**.

Un flujo de trabajo exportado nunca lleva su estado de archivado, así que una copia importada nunca está archivada.

## Propietarios y etiquetas

| Qué                         | Dónde                                                      | Qué hace                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Propietarios**            | La página **Propietarios** del flujo de trabajo            | Los usuarios y equipos responsables del flujo de trabajo. Un rol limitado a lo que posee su equipo llega a los flujos de trabajo que posee ese equipo. |
| **Etiquetas**               | La página **Vista general** del flujo de trabajo           | Etiquetas para agrupar flujos de trabajo, por equipo, integración o entorno. Filtra la lista **Flujos de trabajo** por etiqueta, y limita un rol a algunas etiquetas. |
| **Reglas de etiquetas**     | **Flujos de trabajo → Ajustes → Reglas de etiquetas**      | Etiqueta automáticamente los flujos de trabajo nuevos según patrones de su nombre o su descripción.                                                  |
| **Reglas del propietario**  | **Flujos de trabajo → Ajustes → Reglas del propietario**   | Asigna automáticamente propietarios a los flujos de trabajo nuevos.                                                                                  |

Consulta [Reglas de etiquetas y de propietarios](/docs/configuration/label-and-owner-rules) para ver cómo coinciden las reglas.

## Secretos

Marca una variable como **secreta** si contiene algo sensible: su valor se borra entonces de los registros de ejecución y de las trazas de los pasos. El valor de ninguna variable se puede volver a leer una vez guardado, sea secreta o no, ni en el panel ni a través de la API, y una variable que se vuelve secreta lo sigue siendo.

Usa variables secretas para:

- Claves de API de servicios externos.
- Tokens de autenticación.
- Claves de firma de webhooks.
- Cualquier cosa que no quieras que vea alguien con acceso de solo lectura.

No pegues un secreto directamente en un bloque: valores como `Authorization: Bearer eyJh...` acaban visibles en el flujo de trabajo y en los registros. Usa `{{global.variables.MY_SECRET}}` en su lugar.

Si el secreto es un token de acceso OAuth que caduca, convierte la variable en una [variable OAuth 2.0](/docs/workflows/variables#variables-oauth-20-tokens-que-se-renuevan-solos). OneUptime obtiene entonces el token de tu proveedor de identidad y lo renueva siempre que un flujo de trabajo va a usar uno caducado. Las variables OAuth 2.0 siempre son secretas, y sus credenciales se cifran en la base de datos.

## Exportar e importar flujos de trabajo

Puedes mover un flujo de trabajo entre proyectos, o entre una instalación autoalojada y OneUptime Cloud, como un archivo JSON.

:::tabs
@tab Exportar
Abre el flujo de trabajo, ve a **Ajustes** y haz clic en **Exportar Flujo de trabajo**. Para poner varios flujos de trabajo en un mismo archivo, selecciónalos en la lista **Flujos de trabajo** y elige **Exportar JSON**.
@tab Importar
En la lista **Flujos de trabajo**, haz clic en **Importar JSON** y elige un archivo exportado desde cualquier proyecto de OneUptime. Un flujo de trabajo cuyo nombre ya tiene el proyecto se importa con "(Imported)" detrás de su nombre.
:::

El archivo contiene el nombre del flujo de trabajo, su descripción, su estado de activación y su grafo. A propósito, no contiene:

- **La clave secreta del webhook.** Se genera una nueva al crear el flujo de trabajo, así que un flujo de trabajo importado tiene otra URL de webhook: cópiala del disparador Webhook del flujo de trabajo nuevo. Todo lo que llamaba al original tiene que apuntar al nuevo.
- **La dirección de correo entrante.** Un flujo de trabajo importado con un disparador Incoming Email recibe una dirección propia: cópiala del disparador del flujo de trabajo nuevo. Todo lo que escribía al original tiene que recibir la dirección nueva.
- **Las variables globales.** Un bloque que lee `{{global.variables.MY_SECRET}}` conserva esa referencia, pero el valor no está en el archivo. Crea las variables en el proyecto de destino antes de ejecutar el flujo de trabajo importado.
- **Los propietarios y las etiquetas.** Las reglas de etiquetas y de propietarios de tu proyecto se aplican al flujo de trabajo importado, igual que si lo hubieras creado a mano.

Un flujo de trabajo importado siempre se crea **deshabilitado**, aunque estuviera habilitado donde se exportó: su grafo puede apuntar a monitores, políticas de guardia u otros flujos de trabajo que no existen en el proyecto de destino. Revísalo, actívalo, pruébalo con **Ejecutar flujo de trabajo** y después déjalo activado. Duplicar un flujo de trabajo se comporta igual, así que una copia nunca empieza a saltar junto al original antes de que la hayas editado.

Como el grafo viaja tal cual, todo lo que se escribió directamente en un bloque viaja con él. Esa es la razón práctica para guardar las credenciales en variables secretas: exportar un flujo de trabajo con un token escrito a mano entrega ese token a quien reciba el archivo.

## Seguridad de los webhooks

Los disparadores webhook te dan una URL única. Cualquiera que conozca la URL puede llamarla. Para protegerte de llamadas accidentales o no deseadas:

- Trata la URL como una contraseña. No la compartas en público ni la subas a un repositorio público. El disparador Webhook oculta la clave secreta de la URL hasta que haces clic en **Mostrar**, y **Copiar URL** copia la URL sin mostrarla.
- Si la URL se filtra, haz clic en el disparador Webhook en el **Constructor** y después en **Restablecer URL**. El flujo de trabajo recibe una URL nueva y la antigua deja de funcionar al instante.
- Si el disparador dice que su URL termina con el ID del flujo de trabajo, restablécela. Los flujos de trabajo creados antes de que las URL de webhook tuvieran una clave secreta propia usan en su lugar el ID del flujo de trabajo, y cualquiera que pueda abrir el flujo de trabajo puede verlo.
- Para flujos de trabajo sensibles, pide al sistema que llama que envíe un token compartido en una cabecera (como `X-Webhook-Token`) y compruébalo con un bloque **If / Else** antes de hacer nada importante. Guarda el token esperado como variable secreta.
- Para flujos de trabajo muy sensibles, prefiere un disparador de eventos de OneUptime y un paso de importación manual en lugar de un webhook público.

Solo las personas que pueden editar el flujo de trabajo — **Project Owner**, **Project Admin**, **Workflow Admin** o **Edit Workflow** — pueden ver o restablecer su URL de webhook. Cualquiera que tenga la URL puede iniciar el flujo de trabajo desde cualquier lugar, sin iniciar sesión, así que todos los demás ven una nota que dice a quién pedírsela. Eso incluye a un **Workflow Member**, que ejecuta el flujo de trabajo a mano desde el **Constructor**.

## Seguridad del correo entrante

El disparador Incoming Email da al flujo de trabajo una dirección propia, y cualquiera que conozca la dirección puede escribirle. La parte anterior a la `@` es la clave secreta del flujo de trabajo, así que trata la dirección como una contraseña:

- No la publiques ni la pongas en un repositorio público. El disparador oculta la clave hasta que haces clic en **Mostrar**, y **Copiar dirección** copia la dirección sin mostrarla.
- Si la dirección se filtra, haz clic en el disparador Incoming Email en el **Constructor** y después en **Restablecer dirección**. El flujo de trabajo recibe una dirección nueva, y el correo a la antigua se ignora a partir de entonces.
- Cualquiera puede poner cualquier remitente en un correo, así que **From** no prueba quién lo envió. Antes de que un flujo de trabajo haga algo importante, comprueba algo que solo sepa el remitente real — un token en el asunto o en una cabecera — con un bloque **If / Else**. Guarda el token esperado como variable secreta.
- La clave se oculta en todo lo que recibe la ejecución — **To**, **CC**, las cabeceras y los cuerpos —, porque el registro de la ejecución es visible para cualquiera que pueda leer las ejecuciones del flujo de trabajo.

Solo las personas que pueden editar el flujo de trabajo — **Project Owner**, **Project Admin**, **Workflow Admin** o **Edit Workflow** — pueden ver o restablecer su dirección. Todos los demás ven una nota que dice a quién pedírsela.

## Acceso de red saliente

Los bloques API y los demás bloques HTTP hacen sus solicitudes desde OneUptime, y el bloque IRC se conecta desde OneUptime al puerto del servidor de IRC. Si te autoalojas, asegúrate de que tu instalación puede llegar a los servicios a los que llamas. Si usas OneUptime Cloud, nuestros rangos de IP salientes aparecen en [Direcciones IP](/docs/configuration/ip-addresses) para que puedas permitirlos en el otro extremo.

Las direcciones a las que puede llegar un bloque dependen del bloque:

| Bloques                                                     | Loopback, enlace local, metadatos de la nube                                 | Direcciones de red privada                                                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Los bloques **API** y las solicitudes de **Run Custom JavaScript** | Rechazadas, a menos que el host exacto figure en `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Rechazadas, a menos que un administrador autoalojado las permita con `ALLOW_PRIVATE_NETWORK_WEBHOOKS` o `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Send Email**, **IRC** y las URL de token de OAuth 2.0     | Rechazadas                                                                   | Rechazadas en OneUptime Cloud. Permitidas en una instalación autoalojada, a menos que `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` sea `true`     |
| Slack, Microsoft Teams, Discord y Telegram                  | Rechazadas                                                                   | Rechazadas: cada uno solo envía a las direcciones de su propio servicio                                                                   |

Consulta [Acceso a redes privadas](/docs/self-hosted/private-network-access) para ver cómo un administrador autoalojado las abre.

## Componentes de IA

**Generate Text with AI** envía una solicitud a un LLM: el proveedor de LLM predeterminado del proyecto, o el proveedor global de la instalación cuando el proyecto no tiene ninguno. Configura los proveedores en **Ajustes del proyecto → IA → Proveedores de LLM**, y nunca pongas la clave de API de un proveedor ni un endpoint propio en un flujo de trabajo.

Lo que recibe el proveedor, y lo que el modelo puede hacer con ello:

- **Solo lo que pones en el bloque.** OneUptime envía una instrucción de seguridad fija y, después, las **System Instructions**, el **Prompt** y el **Context** del bloque, con sus referencias rellenadas. **Context** va al final, después de un marcador, y la instrucción de seguridad le dice al modelo que todo lo que va después del marcador son datos no fiables, incluso un texto que parezca instrucciones.
- **Nada más.** Los datos del disparador, el historial del flujo de trabajo, las salidas de otros bloques, los registros del proyecto, la telemetría y los secretos nunca se adjuntan. Solo salen de OneUptime cuando haces referencia a ellos en uno de esos tres ajustes.
- **Texto, y ninguna herramienta.** El modelo no puede consultar OneUptime, hacer solicitudes HTTP ni cambiar datos. Los parámetros adicionales de un proveedor solo dejan pasar una lista permitida de campos de ajuste de la generación: no pueden sustituir los mensajes, añadir herramientas, búsqueda web u otras fuentes de datos, pedir algo distinto de texto o varias respuestas, activar el streaming, hacer que el proveedor conserve la solicitud ni subir el límite de salida del bloque. Los campos que OneUptime no conoce se descartan.
- **El modelo lo elige tu administrador.** Si la generación tiene que quedarse sin conexión, elige un modelo que no busque nada por su cuenta en el lado del proveedor.

Lo que se registra:

- El registro de la ejecución oculta las **System Instructions**, el **Prompt**, el **Context** y la **Response** del bloque. Los bloques posteriores pueden seguir usándolos durante la ejecución, y un bloque en el que insertes uno lo registra según sus propias reglas, así que insertarlo es una decisión de mostrarlo.
- El proveedor, el modelo, el número de tokens, el **LLM Log ID** y un mensaje de error seguro siguen visibles, para la operación y la facturación. El error en bruto de un proveedor se mantiene fuera de todos los registros, porque un proveedor puede repetir en él la solicitud.
- Cada llamada aparece en **Ajustes del proyecto → IA → Registros de IA** con su proveedor, modelo, estado, tokens, coste y facturación, sin el prompt, la respuesta ni el error en bruto.

Lo que necesita el bloque, y lo que cuesta:

- **Habilitar IA** tiene que estar activado, en **Ajustes del proyecto → IA → Funciones de IA**. En OneUptime Cloud, el proyecto también necesita el plan Growth o superior y una suscripción pagada. Las instalaciones autoalojadas sin facturación no tienen restricción de plan.
- Las llamadas a través de un proveedor global de pago usan los créditos de IA del proyecto.
- Cada llamada cuenta para los [límites diarios de IA propios del proyecto](/docs/ai/ai-sre#the-projects-own-daily-limits), cuando un propietario del proyecto los define. Cuando se alcanza un límite, el bloque toma **Error** sin contactar con el modelo, hasta la medianoche UTC.

| Límite                                                       | Valor                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **System Instructions**, **Prompt** y **Context** juntos     | 50.000 caracteres                                                         |
| **Temperature**                                              | De `0` a `1`                                                              |
| **Maximum Output Tokens**                                    | De `1` a `4096`, `1024` por defecto                                       |
| Una solicitud                                                | Un solo intento, de 60 segundos como máximo                               |
| Llamadas simultáneas                                         | 3 por proyecto. Las demás toman **Error**, y una ejecución posterior puede volver a intentarlo. |

Los fallos de validación, configuración, acceso, límite, créditos, simultaneidad, proveedor y tiempo de espera toman todos el camino **Error**, con el motivo en **Error**. Conecta ese camino antes de que el flujo de trabajo pase a producción.

> [!WARNING]
> Cada valor al que haces referencia son datos que envías al proveedor. No pongas una variable secreta en el prompt ni en el contexto a menos que el proveedor esté aprobado para recibirla. Un proveedor local autoalojado como Ollama mantiene las solicitudes dentro de tu propia infraestructura; un proveedor alojado las recibe según sus propias condiciones de tratamiento de datos.

## Permisos

Los flujos de trabajo respetan el control de acceso basado en roles de tu proyecto. Los tres roles de flujo de trabajo:

- **Workflow Admin** — construye flujos de trabajo: los crea, cambia, ejecuta y elimina, y gestiona las variables que usan.
- **Workflow Member** — los usa: abre los flujos de trabajo y sus ejecuciones, y ejecuta un flujo de trabajo a mano con **Ejecutar flujo de trabajo**. Un miembro no puede crear, cambiar ni eliminar un flujo de trabajo, ni ejecutar uno de sus pasos por separado.
- **Workflow Viewer** — lee los flujos de trabajo y sus ejecuciones.

**Project Owner** y **Project Admin** pueden hacer todo lo que puede hacer un Workflow Admin. **Project Member** puede crear y eliminar flujos de trabajo, pero no cambiarlos ni ejecutarlos.

Los permisos individuales, para un equipo o una clave de API que necesita exactamente una cosa:

- **Create / Read / Edit / Delete Workflow** — los permisos básicos sobre el propio flujo de trabajo. Cambiar un flujo de trabajo, incluido activarlo, desactivarlo o archivarlo, requiere **Edit Workflow**; **Delete Workflow** solo elimina.
- **Edit Workflow** — también es lo que hace falta para ejecutar un paso por separado con **Ejecutar solo este paso**, y para ver o restablecer la URL de webhook y la dirección de correo entrante de un flujo de trabajo. Ejecutar un flujo de trabajo completo a mano requiere **Edit Workflow**, **Workflow Admin** o **Workflow Member**.
- **Read Workflow Log** — necesario para ver las ejecuciones.
- **Create / Read / Edit / Delete Workflow Variables** — gestionar las variables globales y del flujo de trabajo.

Una ejecución manual solo llega a los flujos de trabajo que puedes abrir: un rol limitado a algunas etiquetas, o a los flujos de trabajo que posee tu equipo, solo ejecuta esos. Quien no puede ejecutar un flujo de trabajo ve **Ejecutar flujo de trabajo** en gris, con el motivo en su tooltip.

Da **Workflow Admin** a las personas que construyen la automatización, y **Workflow Member** a las que solo la ponen en marcha. Reserva el acceso de edición de variables a las personas que gestionan los secretos de tu proyecto. Consulta [Usuarios, equipos y permisos](/docs/permissions/index) para ver cómo se conceden los roles.

## Qué pueden hacer los pasos de un flujo de trabajo

Los pasos que leen y cambian registros de OneUptime — los componentes Find, Create, Update y Delete, y los disparadores On Create, On Update y On Delete — actúan como **Project Admin** del proyecto del flujo de trabajo. Lo haya construido quien lo haya construido, un paso pasa las mismas comprobaciones que pasa un Project Admin en el panel y en la API:

- **Solo el proyecto del propio flujo de trabajo.** Un paso lee y escribe los registros del proyecto al que pertenece el flujo de trabajo y de ningún otro, y un Update nunca mueve un registro a otro proyecto.
- **Solo lo que puede hacer un Project Admin.** Un paso solo puede conceder los permisos de equipo y de clave de API que tiene el propio Project Admin, así que no puede dar **Project Owner** ni permisos de facturación o de eliminación del proyecto, y no puede añadir a alguien a un equipo cuyos permisos van más allá de los de un Project Admin, como el equipo de propietarios. Un paso no puede leer quién creó una sonda o un agente de IA, algo que solo ven los propietarios del proyecto.
- **No la lectura de las credenciales de runbook.** Un Project Admin puede leer las credenciales de runbook, pero eso no se le presta a un paso. Cuando un cambio requiere esa lectura — dejar que OneUptime AI ejecute sus comandos sin preguntar, activar **Ejecuta comandos de remediación con IA** para un Runner, asignar una credencial SSH a un Runner que ejecuta los comandos de OneUptime AI o nombrar una credencial de runbook, por ejemplo en los pasos de un runbook —, se pregunta en su lugar por la persona que guardó por última vez los pasos del flujo de trabajo, y el paso se rechaza a menos que esa persona pueda leer las credenciales de runbook (**Read Runbook Credential**, o un Project Owner o Project Admin). OneUptime registra a esa persona cuando alguien crea el flujo de trabajo y cada vez que alguien guarda sus pasos; cambiar el nombre del flujo de trabajo, cambiar sus etiquetas o activarlo o desactivarlo conserva a quien guardó sus pasos por última vez. Guardar sus pasos con una clave de API no registra a nadie, así que los pasos del flujo de trabajo no pueden hacer estos cambios hasta que una persona los guarde.
- **Solo lo que incluye tu plan.** En OneUptime Cloud, un paso que crea o cambia algo que tu plan no incluye se rechaza indicando el plan que necesita, igual que en el panel. Las instalaciones autoalojadas sin facturación no tienen límites de plan.
- **Nada de lo que OneUptime se reserva.** Esto se rechaza a todo el mundo, flujos de trabajo incluidos:
  - editar o eliminar una entrada del historial (los historiales de incidentes, alertas, episodios, monitores, políticas de guardia y mantenimientos programados);
  - escribir un registro de notificaciones (los registros de SMS, llamadas, correo, WhatsApp, Telegram, notificaciones push, webhooks y mensajes del espacio de trabajo);
  - los valores que OneUptime define a medida que ocurren las cosas: si el CNAME de un dominio personalizado está verificado, los interruptores de protección de un equipo (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), qué rol de incidente es el principal y si se puede eliminar, si se ha notificado a un propietario o a un miembro, las horas y el número de recordatorios, quién está de guardia ahora y después en un calendario, el progreso de una ejecución de guardia, la tasa de consumo y el presupuesto de error actuales de un SLO, un monitor pausado por un incidente o un mantenimiento, el token de restablecimiento de contraseña y el último inicio de sesión de un usuario privado de una página de estado, los datos que un servicio informa sobre sí mismo (versión, entorno de ejecución, nube) y la última ejecución de una regla de detección o de una fuente de amenazas;
  - declarar un incidente a partir de una plantilla enviando `createdIncidentTemplateId` a **Create One Incident** — elige en su lugar la plantilla en el ajuste **Incident Template** del paso: el paso declara entonces el incidente a partir de ella, como Project Admin, y registra la plantilla;
  - cambiar a qué registro pertenece un registro después de crearlo, como el monitor al que corresponde una fila de propietario o el incidente en el que está una nota.
- **Como nadie.** Un registro que crea un flujo de trabajo no nombra a ningún creador, y el registro de auditoría nombra el flujo de trabajo, con el nombre que tenía en ese momento, como autor del cambio.

Cuando una comprobación rechaza un paso, el paso toma su salida **Error** sin hacer el cambio rechazado, y el registro de la ejecución nombra el paso y el motivo con palabras sencillas, por ejemplo *"Create One Team Permission" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Léelo en las [Ejecuciones](/docs/workflows/runs-and-logs) del flujo de trabajo. Un paso Create Many crea sus registros de uno en uno y se detiene en el primero rechazado: los registros que creó antes de ese se conservan.

Los pasos que hablan con otros sistemas — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Custom Code y Generate Text with AI — no leen ni cambian registros de OneUptime, así que nada de esto les afecta.

## Límites del plan

En OneUptime Cloud, los flujos de trabajo necesitan el plan Growth o superior, y cada plan permite un número de ejecuciones en cualquier periodo de 30 días:

| Plan       | Ejecuciones en los últimos 30 días |
| ---------- | ---------------------------------- |
| Growth     | 500                                |
| Scale      | 2.000                              |
| Enterprise | Sin límite práctico                |

La ventana es móvil: cada ejecución que registra el proyecto, a mano o desde un disparador, cuenta durante 30 días. En los planes Growth y Scale, la página **Flujos de trabajo** muestra una tarjeta **Ejecuciones del flujo de trabajo** con cuántas ha usado el proyecto. Una vez alcanzado el límite, las ejecuciones nuevas se registran con el estado **Execution Exceeded Current Plan** y no se ejecutan, y lo mismo ocurre mientras la suscripción está impagada. Las instalaciones autoalojadas sin facturación no tienen límite.

## Cuánto puede durar una ejecución

| Límite                                                       | Predeterminado     | Ajuste autoalojado              |
| ------------------------------------------------------------ | ------------------ | ------------------------------- |
| Una ejecución, desde su inicio o desde que despierta tras un **Sleep** | 2 minutos | `WORKFLOW_TIMEOUT_IN_MS`        |
| Un bloque **Run Custom JavaScript**                          | 5 segundos         | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| Un bloque **Sleep**                                          | 30 días como máximo | —                              |

El ejecutor comprueba el plazo antes y después de cada bloque, y marca una ejecución vencida como **Timeout** en cuanto recupera el control. No puede interrumpir un bloque a mitad, así que los bloques que esperan a la red tienen sus propios límites de tiempo: una solicitud de Generate Text with AI desiste a los 60 segundos como máximo, y una solicitud de token de OAuth 2.0 a los 20. Una espera en un bloque **Sleep** no cuenta para el tiempo de una ejecución: la ejecución se aparta y recibe 2 minutos nuevos al despertar.

## Límite al llamar a otros flujos de trabajo

El componente **Execute Workflow** permite que un flujo de trabajo inicie otro. Para evitar bucles en los que el flujo de trabajo A inicia B, que vuelve a iniciar A, una cadena de flujos de trabajo que se inician unos a otros se rechaza cuando volvería a un flujo de trabajo que ya está en ella, o cuando superaría los 10 flujos de trabajo de profundidad. El bloque **Execute Workflow** toma entonces su salida **Error**, y el error muestra la cadena.

Si de verdad necesitas una cadena larga (como un trabajo que procesa un elemento por ejecución), suele ser más sencillo hacer el bucle dentro de un solo flujo de trabajo con **Run Custom JavaScript**.

## Cuándo un flujo de trabajo no es la herramienta adecuada

Algunos casos en los que conviene recurrir a otra cosa:

- **Cálculo pesado o grandes volúmenes de datos** — los flujos de trabajo están pensados para un trabajo de enlace ligero, no para procesar números a gran escala. Ejecuta el trabajo pesado en tu propia infraestructura y deja que un flujo de trabajo lo lance.
- **Cálculo activo de larga duración** — una ejecución tiene 2 minutos por defecto. Para una espera pasiva como «haz A, espera dos horas, haz B», usa el componente **Sleep**; aparta la ejecución y la reanuda más tarde sin ocupar un worker.
- **Respuesta a incidentes paso a paso con personas en el proceso** — para eso están los [Runbooks](/docs/runbooks/index). Los flujos de trabajo son para la automatización sin supervisión.

## Siguientes pasos

:::cards
- [Visión general de los flujos de trabajo](/docs/workflows/index): La visión de conjunto y un primer flujo de trabajo de principio a fin.
- [Componentes](/docs/workflows/components): Lo que necesita cada bloque, lo que devuelve y adónde puede llegar.
- [Runbooks](/docs/runbooks/index): Cuando las personas tienen que tomar las decisiones por el camino.
:::
