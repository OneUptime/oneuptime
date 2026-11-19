# Configuración y seguridad del flujo de trabajo

Lo que debes saber antes de poner un flujo de trabajo frente a tráfico real: cómo activarlo con seguridad, quién puede hacer qué, cómo se mantienen privados los secretos y las URL, qué pueden cambiar los pasos de un flujo de trabajo y los límites dentro de los que trabaja cada ejecución.

:::cards
- [Pasar a producción](#activar-o-desactivar-un-flujo-de-trabajo): Prueba con Ejecutar flujo de trabajo mientras está desactivado y después actívalo.
- [Permisos](#permisos): Los roles de flujo de trabajo y los permisos individuales que hay detrás.
- [Qué pueden hacer los pasos](#qué-pueden-hacer-los-pasos-de-un-flujo-de-trabajo): Los pasos actúan como Administrador del proyecto en el proyecto del flujo de trabajo.
- [Límites](#límites-del-plan): Ejecuciones por plan, duración de una ejecución y llamadas entre flujos de trabajo.
:::

## Activar o desactivar un flujo de trabajo

Cada flujo de trabajo tiene un interruptor **Habilitado** en la parte superior de su **Constructor** y en su página **Vista general**. Cuando está desactivado, su disparador queda en pausa: las llamadas de webhook, el correo entrante, las horas programadas, los eventos de OneUptime y los pasos **Ejecutar otro flujo de trabajo** de otros flujos de trabajo no lo inician. **Ejecutar flujo de trabajo** y **Ejecutar solo este paso** sí: una ejecución que inicias tú mismo mientras el flujo de trabajo está desactivado es una **Ejecución de prueba**. Los flujos de trabajo nuevos empiezan deshabilitados.

Usa este interruptor como tu señal de «listo para salir»:

:::steps
1. Construye el flujo de trabajo.
2. Haz clic en **Ejecutar flujo de trabajo** en el **Constructor** con valores realistas, mientras el flujo de trabajo sigue desactivado. La ejecución es una **Ejecución de prueba**: cada bloque se ejecuta de verdad, así que apúntalo primero a un canal de prueba o a un registro de prueba.
3. Abre la ejecución y comprueba que cada bloque fue adonde esperabas. Consulta [Ejecuciones](/docs/workflows/runs-and-logs).
4. Activa **Habilitado** cuando esté listo: a partir de entonces, su disparador salta con eventos reales.
:::

Desactivar un flujo de trabajo impide que su disparador inicie ejecuciones nuevas. Una ejecución que ya está en curso termina, pero una ejecución que inició su disparador y que espera en un bloque **Pausa** se cancela al despertar. Las ejecuciones de prueba continúan. Para activar o desactivar varios a la vez, selecciónalos en la lista **Flujos de trabajo** y elige **Activar** o **Desactivar** en **Acciones masivas**.

## Archivar un flujo de trabajo

Archiva un flujo de trabajo que ya no necesitas pero que quieres conservar. Un flujo de trabajo archivado:

- **Nunca se ejecuta**, con ningún disparador. Las ejecuciones manuales y **Ejecutar solo este paso**, las llamadas de webhook, las programaciones, los eventos de OneUptime, el correo entrante y los pasos **Ejecutar otro flujo de trabajo** de otros flujos de trabajo se rechazan. Una llamada de webhook a un flujo de trabajo archivado recibe un error que dice que el flujo de trabajo está archivado.
- **Detiene las ejecuciones que esperan.** Una ejecución que duerme en un paso **Pausa** se cancela al despertar, y una ejecución que estaba en cola pero aún no había empezado termina con "Workflow was archived before this run started, so it did not run."
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
- **La dirección de correo entrante.** Un flujo de trabajo importado con un disparador Correo entrante recibe una dirección propia: cópiala del disparador del flujo de trabajo nuevo. Todo lo que escribía al original tiene que recibir la dirección nueva.
- **Las variables globales.** Un bloque que lee `{{global.variables.MY_SECRET}}` conserva esa referencia, pero el valor no está en el archivo. Crea las variables en el proyecto de destino antes de ejecutar el flujo de trabajo importado.
- **Los propietarios y las etiquetas.** Las reglas de etiquetas y de propietarios de tu proyecto se aplican al flujo de trabajo importado, igual que si lo hubieras creado a mano.

Un flujo de trabajo importado siempre se crea **disabled**, aunque estuviera habilitado donde se exportó: su grafo puede apuntar a monitores, políticas de guardia u otros flujos de trabajo que no existen en el proyecto de destino. Revísalo, pruébalo con **Ejecutar flujo de trabajo** y después actívalo. Duplicar un flujo de trabajo se comporta igual, así que una copia nunca empieza a saltar junto al original antes de que la hayas editado.

Como el grafo viaja tal cual, todo lo que se escribió directamente en un bloque viaja con él. Esa es la razón práctica para guardar las credenciales en variables secretas: exportar un flujo de trabajo con un token escrito a mano entrega ese token a quien reciba el archivo.

## Seguridad de los webhooks

Los disparadores webhook te dan una URL única. Cualquiera que conozca la URL puede llamarla. Para protegerte de llamadas accidentales o no deseadas:

- Trata la URL como una contraseña. No la compartas en público ni la subas a un repositorio público. El disparador Webhook oculta la clave secreta de la URL hasta que haces clic en **Mostrar**, y **Copiar URL** copia la URL sin mostrarla.
- Si la URL se filtra, haz clic en el disparador Webhook en el **Constructor** y después en **Restablecer URL**. El flujo de trabajo recibe una URL nueva y la antigua deja de funcionar al instante.
- Si el disparador dice que su URL termina con el ID del flujo de trabajo, restablécela. Los flujos de trabajo creados antes de que las URL de webhook tuvieran una clave secreta propia usan en su lugar el ID del flujo de trabajo, y cualquiera que pueda abrir el flujo de trabajo puede verlo.
- Para flujos de trabajo sensibles, pide al sistema que llama que envíe un token compartido en una cabecera (como `X-Webhook-Token`) y compruébalo con un bloque **Si / Si no** antes de hacer nada importante. Guarda el token esperado como variable secreta.
- Para flujos de trabajo muy sensibles, prefiere un disparador de eventos de OneUptime y un paso de importación manual en lugar de un webhook público.

Solo las personas que pueden editar el flujo de trabajo — **Propietario del proyecto**, **Administrador del proyecto**, **Administrador de flujos de trabajo** o **Edit Workflow** — pueden ver o restablecer su URL de webhook. Cualquiera que tenga la URL puede iniciar el flujo de trabajo desde cualquier lugar, sin iniciar sesión, así que todos los demás ven una nota que dice a quién pedírsela. Eso incluye a un **Miembro de flujos de trabajo**, que ejecuta el flujo de trabajo a mano desde el **Constructor**.

## Seguridad del correo entrante

El disparador Correo entrante da al flujo de trabajo una dirección propia, y cualquiera que conozca la dirección puede escribirle. La parte anterior a la `@` es la clave secreta del flujo de trabajo, así que trata la dirección como una contraseña:

- No la publiques ni la pongas en un repositorio público. El disparador oculta la clave hasta que haces clic en **Mostrar**, y **Copiar dirección** copia la dirección sin mostrarla.
- Si la dirección se filtra, haz clic en el disparador Correo entrante en el **Constructor** y después en **Restablecer dirección**. El flujo de trabajo recibe una dirección nueva, y el correo a la antigua se ignora a partir de entonces.
- Cualquiera puede poner cualquier remitente en un correo, así que **De** no prueba quién lo envió. Antes de que un flujo de trabajo haga algo importante, comprueba algo que solo sepa el remitente real — un token en el asunto o en una cabecera — con un bloque **Si / Si no**. Guarda el token esperado como variable secreta.
- La clave se oculta en todo lo que recibe la ejecución — **Para**, **CC**, las cabeceras y los cuerpos —, porque el registro de la ejecución es visible para cualquiera que pueda leer las ejecuciones del flujo de trabajo.

Solo las personas que pueden editar el flujo de trabajo — **Propietario del proyecto**, **Administrador del proyecto**, **Administrador de flujos de trabajo** o **Edit Workflow** — pueden ver o restablecer su dirección. Todos los demás ven una nota que dice a quién pedírsela.

## Acceso de red saliente

Los bloques API y los demás bloques HTTP hacen sus solicitudes desde OneUptime, y el bloque IRC se conecta desde OneUptime al puerto del servidor de IRC. Si te autoalojas, asegúrate de que tu instalación puede llegar a los servicios a los que llamas. Si usas OneUptime Cloud, nuestros rangos de IP salientes aparecen en [Direcciones IP](/docs/configuration/ip-addresses) para que puedas permitirlos en el otro extremo.

Las direcciones a las que puede llegar un bloque dependen del bloque:

| Bloques                                                     | Loopback, enlace local, metadatos de la nube                                 | Direcciones de red privada                                                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Los bloques **API** y **Mattermost**, y las solicitudes de **Ejecutar JavaScript personalizado** | Rechazadas, a menos que el host exacto figure en `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Rechazadas, a menos que un administrador autoalojado las permita con `ALLOW_PRIVATE_NETWORK_WEBHOOKS` o `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Enviar correo**, **IRC** y las URL de token de OAuth 2.0     | Rechazadas                                                                   | Rechazadas en OneUptime Cloud. Permitidas en una instalación autoalojada, a menos que `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` sea `true`     |
| Slack, Microsoft Teams, Discord y Telegram                  | Rechazadas                                                                   | Rechazadas: cada uno solo envía a las direcciones de su propio servicio                                                                   |

Consulta [Acceso a redes privadas](/docs/self-hosted/private-network-access) para ver cómo un administrador autoalojado las abre.

## Componentes de IA

**Generar texto con IA** envía una solicitud a un LLM: el proveedor de LLM predeterminado del proyecto, o el proveedor global de la instalación cuando el proyecto no tiene ninguno. Configura los proveedores en **Ajustes del proyecto → IA → Proveedores de LLM**, y nunca pongas la clave de API de un proveedor ni un endpoint propio en un flujo de trabajo.

Lo que recibe el proveedor, y lo que el modelo puede hacer con ello:

- **Solo lo que pones en el bloque.** OneUptime envía una instrucción de seguridad fija y, después, las **Instrucciones del sistema**, el **Indicación** y el **Contexto** del bloque, con sus referencias rellenadas. **Contexto** va al final, después de un marcador, y la instrucción de seguridad le dice al modelo que todo lo que va después del marcador son datos no fiables, incluso un texto que parezca instrucciones.
- **Nada más.** Los datos del disparador, el historial del flujo de trabajo, las salidas de otros bloques, los registros del proyecto, la telemetría y los secretos nunca se adjuntan. Solo salen de OneUptime cuando haces referencia a ellos en uno de esos tres ajustes.
- **Texto, y ninguna herramienta.** El modelo no puede consultar OneUptime, hacer solicitudes HTTP ni cambiar datos. Los parámetros adicionales de un proveedor solo dejan pasar una lista permitida de campos de ajuste de la generación: no pueden sustituir los mensajes, añadir herramientas, búsqueda web u otras fuentes de datos, pedir algo distinto de texto o varias respuestas, activar el streaming, hacer que el proveedor conserve la solicitud ni subir el límite de salida del bloque. Los campos que OneUptime no conoce se descartan.
- **El modelo lo elige tu administrador.** Si la generación tiene que quedarse sin conexión, elige un modelo que no busque nada por su cuenta en el lado del proveedor.

Lo que se registra:

- El registro de la ejecución oculta las **Instrucciones del sistema**, el **Indicación**, el **Contexto** y la **Respuesta** del bloque. Los bloques posteriores pueden seguir usándolos durante la ejecución, y un bloque en el que insertes uno lo registra según sus propias reglas, así que insertarlo es una decisión de mostrarlo.
- El proveedor, el modelo, el número de tokens, el **ID del registro de LLM** y un mensaje de error seguro siguen visibles, para la operación y la facturación. El error en bruto de un proveedor se mantiene fuera de todos los registros, porque un proveedor puede repetir en él la solicitud.
- Cada llamada aparece en **Ajustes del proyecto → IA → Registros de IA** con su proveedor, modelo, estado, tokens, coste y facturación, sin el prompt, la respuesta ni el error en bruto.

Lo que necesita el bloque, y lo que cuesta:

- **Habilitar IA** tiene que estar activado, en **Ajustes del proyecto → IA → Funciones de IA**. En OneUptime Cloud, el proyecto también necesita el plan Growth o superior y una suscripción pagada. Las instalaciones autoalojadas sin facturación no tienen restricción de plan.
- Las llamadas a través de un proveedor global de pago usan los créditos de IA del proyecto.
- Cada llamada cuenta para los [límites diarios de IA propios del proyecto](/docs/ai/ai-sre#los-límites-diarios-propios-del-proyecto), cuando un Propietario del proyecto los define. Cuando se alcanza un límite, el bloque toma **Error** sin contactar con el modelo, hasta la medianoche UTC.

| Límite                                                       | Valor                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **Instrucciones del sistema**, **Indicación** y **Contexto** juntos     | 50.000 caracteres                                                         |
| **Temperatura**                                              | De `0` a `1`                                                              |
| **Máximo de tokens de salida**                                    | De `1` a `4096`, `1024` por defecto                                       |
| Una solicitud                                                | Un solo intento, de 60 segundos como máximo                               |
| Llamadas simultáneas                                         | 3 por proyecto. Las demás toman **Error**, y una ejecución posterior puede volver a intentarlo. |

Los fallos de validación, configuración, acceso, límite, créditos, simultaneidad, proveedor y tiempo de espera toman todos el camino **Error**, con el motivo en **Error**. Conecta ese camino antes de que el flujo de trabajo pase a producción.

> [!WARNING]
> Cada valor al que haces referencia son datos que envías al proveedor. No pongas una variable secreta en el prompt ni en el contexto a menos que el proveedor esté aprobado para recibirla. Un proveedor local autoalojado como Ollama mantiene las solicitudes dentro de tu propia infraestructura; un proveedor alojado las recibe según sus propias condiciones de tratamiento de datos.

## Permisos

Los flujos de trabajo respetan el control de acceso basado en roles de tu proyecto. Los tres roles de flujo de trabajo:

- **Administrador de flujos de trabajo** — construye flujos de trabajo: los crea, cambia, ejecuta y elimina, y gestiona las variables que usan.
- **Miembro de flujos de trabajo** — los usa: abre los flujos de trabajo y sus ejecuciones, y ejecuta un flujo de trabajo a mano con **Ejecutar flujo de trabajo**. Un miembro no puede crear, cambiar ni eliminar un flujo de trabajo, ni ejecutar uno de sus pasos por separado. El **Constructor** les muestra un flujo de trabajo tal como es, marcado como **Solo lectura**: un paso se abre para leerlo, y nada de lo que hagan ahí se guarda.
- **Visor de flujos de trabajo** — lee los flujos de trabajo y sus ejecuciones.

**Propietario del proyecto** y **Administrador del proyecto** pueden hacer todo lo que puede hacer un Administrador de flujos de trabajo. **Miembro del proyecto** puede crear y eliminar flujos de trabajo, pero no cambiarlos ni ejecutarlos.

Los permisos individuales, para un equipo o una clave de API que necesita exactamente una cosa:

- **Create / Read / Edit / Delete Workflow** — los permisos básicos sobre el propio flujo de trabajo. Cambiar un flujo de trabajo, incluido activarlo, desactivarlo o archivarlo, requiere **Edit Workflow**; **Delete Workflow** solo elimina.
- **Edit Workflow** — también es lo que hace falta para ejecutar un paso por separado con **Ejecutar solo este paso**, y para ver o restablecer la URL de webhook y la dirección de correo entrante de un flujo de trabajo. Ejecutar un flujo de trabajo completo a mano requiere **Edit Workflow**, **Administrador de flujos de trabajo** o **Miembro de flujos de trabajo**.
- **Read Workflow Log** — necesario para ver las ejecuciones.
- **Create / Read / Edit / Delete Workflow Variables** — gestionar las variables globales y del flujo de trabajo.

Una ejecución manual solo llega a los flujos de trabajo que puedes abrir: un rol limitado a algunas etiquetas, o a los flujos de trabajo que posee tu equipo, solo ejecuta esos. Quien no puede ejecutar un flujo de trabajo ve **Ejecutar flujo de trabajo** en gris, con el motivo en su tooltip.

Un flujo de trabajo que se ejecuta como **Propietario del proyecto** o como un rol personalizado solo lo cambian y lo ejecutan manualmente las personas que tienen esos permisos; los demás solo pueden verlo en el **Constructor**. Consulta [Run As](#run-as).

Da **Administrador de flujos de trabajo** a las personas que construyen la automatización, y **Miembro de flujos de trabajo** a las que solo la ponen en marcha. Reserva el acceso de edición de variables a las personas que gestionan los secretos de tu proyecto. Consulta [Usuarios, equipos y permisos](/docs/permissions/index) para ver cómo se conceden los roles.

## Qué pueden hacer los pasos de un flujo de trabajo

Los pasos que leen y cambian registros de OneUptime — los componentes Find, Create, Update y Delete, y los disparadores On Create, On Update, On Create or Update y On Delete — actúan como **Administrador del proyecto** del proyecto del flujo de trabajo. Lo haya construido quien lo haya construido, un paso pasa las mismas comprobaciones que pasa un Administrador del proyecto en el panel y en la API:

- **Solo el proyecto del propio flujo de trabajo.** Un paso lee y escribe los registros del proyecto al que pertenece el flujo de trabajo y de ningún otro, y un Update nunca mueve un registro a otro proyecto.
- **Solo lo que puede hacer un Project Admin.** Un paso no puede hacer lo que solo permiten **Propietario del proyecto** y los permisos de facturación o de eliminación del proyecto, y no puede leer quién creó una sonda o un agente de IA, algo que solo ven los Propietarios del proyecto.
- **No quién tiene acceso.** Con los permisos predeterminados, un paso no crea, cambia ni elimina equipos, miembros de equipo, permisos de equipo ni roles personalizados, aunque un Administrador del proyecto sí pueda. Quien construye un flujo de trabajo decide lo que hacen sus pasos, y puede ser un **Miembro del proyecto**, así que un paso que pudiera hacerlo le daría a quien lo construyó un acceso que no se le dio, como **Administrador del proyecto**. El paso se rechaza, y el registro de la ejecución nombra el permiso que requiere el cambio e indica que elijas **Run As** en los **Ajustes** del flujo de trabajo: un flujo de trabajo que se ejecuta como **Propietario del proyecto**, o como un rol personalizado que tenga ese permiso, puede hacer el cambio (consulta [Run As](#run-as)). Ningún paso de un flujo de trabajo cambia claves de API, el inicio de sesión único ni los ajustes de SCIM, se ejecute como se ejecute. Los disparadores y los pasos Find sobre estos registros siguen funcionando.
- **No la lectura de configuraciones que contienen credenciales.** Un Administrador del proyecto puede leer servidores SMTP, proveedores de llamadas y SMS, credenciales SNMP, conexiones de videollamada y claves de API, pero eso nunca se le presta a un paso, sin importar quién creó o guardó el flujo de trabajo. Un paso no puede nombrar una de estas configuraciones, como el servidor SMTP con el que una página de estado envía correos o la clave de API a la que se concede un permiso. El paso se rechaza, y su registro de ejecución dice que tiene que hacer el cambio una persona que pueda leerlas (el permiso de lectura de ese tipo de configuración, o un Propietario del proyecto o Administrador del proyecto). Un paso que conserva la configuración que un registro ya nombra, o la vacía, no se rechaza.
- **No los incidentes, alertas y episodios privados.** Un Administrador del proyecto ve cualquier incidente, alerta y episodio privado, pero eso nunca se le presta a un paso, quienquiera que haya creado o guardado el flujo de trabajo. Un paso no encuentra ninguno privado, no cambia ninguno ni le añade nada, y un flujo de trabajo no se inicia con uno ni con nada que le pertenezca, ya lo inicie un evento de un registro o **Ejecutar flujo de trabajo**. Quien crea un flujo de trabajo decide adónde va lo que leen sus pasos —un webhook, un correo, un chat, el registro de la ejecución—, y puede ser un **Miembro del proyecto** que no puede ver un registro privado. Consulte [Incidentes, alertas y episodios privados](/docs/permissions/index#incidentes-alertas-y-episodios-privados).
- **Solo lo que incluye tu plan.** En OneUptime Cloud, un paso que crea o cambia algo que tu plan no incluye se rechaza indicando el plan que necesita, igual que en el panel. Las instalaciones autoalojadas sin facturación no tienen límites de plan.
- **Nada de lo que OneUptime se reserva.** Esto se rechaza a todo el mundo, flujos de trabajo incluidos:
  - editar o eliminar una entrada del historial (los historiales de incidentes, alertas, episodios, monitores, políticas de guardia y mantenimientos programados);
  - escribir un registro de notificaciones (los registros de SMS, llamadas, correo, WhatsApp, Telegram, notificaciones push, webhooks y mensajes del espacio de trabajo);
  - los valores que OneUptime define a medida que ocurren las cosas: si el CNAME de un dominio personalizado está verificado, los interruptores de protección de un equipo (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), qué rol de incidente es el principal y si se puede eliminar, si se ha notificado a un propietario o a un miembro, las horas y el número de recordatorios, quién está de guardia ahora y después en un calendario, el progreso de una ejecución de guardia, la tasa de consumo y el presupuesto de error actuales de un SLO, un monitor pausado por un incidente o un evento de mantenimiento, el token de restablecimiento de contraseña y el último inicio de sesión de un usuario privado de una página de estado, los datos que un servicio informa sobre sí mismo (versión, entorno de ejecución, nube) y la última ejecución de una regla de detección o de una fuente de amenazas;
  - declarar un incidente a partir de una plantilla enviando `createdIncidentTemplateId` a **Crear Incidente (individual)** — elige en su lugar la plantilla en el ajuste **Plantilla de incidente** del paso: el paso declara entonces el incidente a partir de ella, como Administrador del proyecto, y registra la plantilla;
  - cambiar a qué registro pertenece un registro después de crearlo, como el monitor al que corresponde una fila de propietario o el incidente en el que está una nota.
- **Como nadie.** Un registro que crea un flujo de trabajo no nombra a ningún creador, y el registro de auditoría nombra el flujo de trabajo, con el nombre que tenía en ese momento, como autor del cambio.

Cuando una comprobación rechaza un paso, el paso toma su salida **Error** sin hacer el cambio rechazado, y el registro de la ejecución nombra el paso y el motivo con palabras sencillas, por ejemplo *"Find One Probe" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Léelo en las [Ejecuciones](/docs/workflows/runs-and-logs) del flujo de trabajo. Un paso Create Many crea sus registros de uno en uno y se detiene en el primero rechazado: los registros que creó antes de ese se conservan.

Los pasos que hablan con otros sistemas — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Mattermost, Custom Code y Generate Text with AI — no leen ni cambian registros de OneUptime, así que nada de esto les afecta.

### Run As

De forma predeterminada, un flujo de trabajo se ejecuta con los permisos anteriores, y la mayoría de los flujos de trabajo nunca necesitan más. Cuando uno lo necesita —por ejemplo, un flujo de trabajo que da un rol personalizado a cada equipo nuevo—, abre sus **Ajustes**, luego **Más ajustes**, y elige **Change Run As**:

- Predeterminado: los permisos anteriores.
- Propietario del proyecto: lo que un **Propietario del proyecto** puede hacer en este proyecto, incluido cambiar quién está en un equipo y lo que un equipo puede hacer. Solo un Propietario del proyecto puede elegirlo.
- Un rol personalizado: exactamente lo que permite uno de los roles personalizados del proyecto. Solo alguien que pudiera dar ese rol a un equipo puede elegirlo.

Se ejecute como se ejecute, un paso nunca lee configuraciones que contienen credenciales, nunca ve incidentes, alertas ni episodios privados y nunca cambia claves de API, el inicio de sesión único ni los ajustes de SCIM. Cuando da a un equipo un permiso o un rol, solo puede dar lo que tiene él mismo, y si le falta algo, el registro de la ejecución nombra el permiso.

Un flujo de trabajo que se ejecuta con más que los permisos predeterminados se ejecuta con los permisos de la persona que se los dio: quien eligió por última vez su **Run As** o guardó sus pasos o sus variables. Para que nadie obtenga a través de él más de lo que tiene:

- Solo las personas que tienen esos permisos pueden cambiarlo a él o sus variables, archivarlo o eliminarlo, ejecutarlo a él o uno de sus pasos manualmente, o ver su URL de webhook y su dirección de correo entrante. Cualquiera que pueda editarlo puede seguir desactivándolo.
- Solo una persona puede darlos, nunca una clave de API.
- Cada ejecución comprueba primero que la persona que los dio todavía los tiene. Si no, la ejecución se detiene antes de su primer paso, y su registro dice por qué y quién puede volver a darlos.
- No lee las variables globales del proyecto, que puede cambiar cualquiera que pueda editar variables de flujos de trabajo.
- El paso **Ejecutar otro flujo de trabajo** de otro flujo de trabajo solo puede iniciarlo si ese flujo de trabajo se ejecuta con los mismos permisos o más.

Cada ejecución registra cómo se ejecutó y con los permisos de quién, lo que se ve en la ventana de la ejecución y en un registro descargado, y el [registro de auditoría](/docs/configuration/audit-logs) registra quién cambió el **Run As** de un flujo de trabajo.

## Límites del plan

En OneUptime Cloud, los flujos de trabajo necesitan el plan Growth o superior, y cada plan permite un número de ejecuciones en cualquier periodo de 30 días:

| Plan       | Ejecuciones en los últimos 30 días |
| ---------- | ---------------------------------- |
| Growth     | 500                                |
| Scale      | 2.000                              |
| Enterprise | Sin límite práctico                |

La ventana es móvil: cada ejecución que registra el proyecto, a mano o desde un disparador, cuenta durante 30 días. En los planes Growth y Scale, la página **Flujos de trabajo** muestra una tarjeta **Ejecuciones del flujo de trabajo** con cuántas ha usado el proyecto. Una vez alcanzado el límite, las ejecuciones nuevas se registran con el estado **La ejecución supera el plan actual** y no se ejecutan, y lo mismo ocurre mientras la suscripción está impagada. Las instalaciones autoalojadas sin facturación no tienen límite. En un plan que no ejecuta flujos de trabajo, el **Constructor** y la página **Flujos de trabajo** lo dicen, con un enlace para mejorar el plan.

## Cuánto puede durar una ejecución

| Límite                                                       | Predeterminado     | Ajuste autoalojado              |
| ------------------------------------------------------------ | ------------------ | ------------------------------- |
| Una ejecución, desde su inicio o desde que despierta tras un **Pausa** | 2 minutos | `WORKFLOW_TIMEOUT_IN_MS`        |
| Un bloque **Ejecutar JavaScript personalizado**                          | 5 segundos         | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| Un bloque **Pausa**                                          | 30 días como máximo | —                              |

El ejecutor comprueba el plazo antes y después de cada bloque, y marca una ejecución vencida como **Tiempo de espera agotado** en cuanto recupera el control. No puede interrumpir un bloque a mitad, así que los bloques que esperan a la red tienen sus propios límites de tiempo: una solicitud de Generate Text with AI desiste a los 60 segundos como máximo, y una solicitud de token de OAuth 2.0 a los 20. Una espera en un bloque **Pausa** no cuenta para el tiempo de una ejecución: la ejecución se aparta y recibe 2 minutos nuevos al despertar.

## Límite al llamar a otros flujos de trabajo

El componente **Ejecutar otro flujo de trabajo** permite que un flujo de trabajo inicie otro. Para evitar bucles en los que el flujo de trabajo A inicia B, que vuelve a iniciar A, una cadena de flujos de trabajo que se inician unos a otros se rechaza cuando volvería a un flujo de trabajo que ya está en ella, o cuando superaría los 10 flujos de trabajo de profundidad. El bloque **Ejecutar otro flujo de trabajo** toma entonces su salida **Error**, y el error muestra la cadena.

Si de verdad necesitas una cadena larga (como un trabajo que procesa un elemento por ejecución), suele ser más sencillo hacer el bucle dentro de un solo flujo de trabajo con **Ejecutar JavaScript personalizado**.

## Cuándo un flujo de trabajo no es la herramienta adecuada

Algunos casos en los que conviene recurrir a otra cosa:

- **Cálculo pesado o grandes volúmenes de datos** — los flujos de trabajo están pensados para un trabajo de enlace ligero, no para procesar números a gran escala. Ejecuta el trabajo pesado en tu propia infraestructura y deja que un flujo de trabajo lo lance.
- **Cálculo activo de larga duración** — una ejecución tiene 2 minutos por defecto. Para una espera pasiva como «haz A, espera dos horas, haz B», usa el componente **Pausa**; aparta la ejecución y la reanuda más tarde sin ocupar un worker.
- **Respuesta a incidentes paso a paso con personas en el proceso** — para eso están los [Runbooks](/docs/runbooks/index). Los flujos de trabajo son para la automatización sin supervisión.

## Siguientes pasos

:::cards
- [Visión general de los flujos de trabajo](/docs/workflows/index): La visión de conjunto y un primer flujo de trabajo de principio a fin.
- [Componentes](/docs/workflows/components): Lo que necesita cada bloque, lo que devuelve y adónde puede llegar.
- [Runbooks](/docs/runbooks/index): Cuando las personas tienen que tomar las decisiones por el camino.
:::
