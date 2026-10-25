# Casos de seguridad y playbooks (SOAR)

Eventos de seguridad convierte en casos lo que encuentran tus reglas de detección, tu inteligencia de amenazas y tus productos de seguridad conectados: un caso por cada asunto que merece una investigación, con todas las detecciones sobre el mismo usuario, host o dirección agrupadas en él. Los analistas gestionan los casos en una cola, y los playbooks responden a ellos, por sí solos o con un clic.

:::cards
- [De dónde vienen los casos](#de-dónde-vienen-los-casos): Reglas de detección, inteligencia de amenazas, productos conectados y personas.
- [Gestionar un caso](#gestionar-un-caso): Asígnalo, investiga sus entidades y ciérralo con un veredicto.
- [Prioridades y estados de los casos](#prioridades-y-estados-de-los-casos): Cámbiales el nombre, el color y el orden, y añade los tuyos.
- [Notificaciones](#notificaciones): A quién se avisa de un caso nuevo, de una asignación y de un paso que espera aprobación.
- [Playbooks](#playbooks): Pasos que se ejecutan sobre un caso, con aprobación donde importa.
- [La vista general](#la-vista-general): Lo que necesita atención ahora y la rapidez con que se gestionan los casos.
:::

## Cómo funciona

```mermaid title="De una detección a un caso cerrado"
flowchart TB
    subgraph sources["Detecciones"]
        direction LR
        rules["Reglas de<br/>detección"] ~~~ intel["Inteligencia<br/>de amenazas"] ~~~ products["Productos<br/>conectados"]
    end
    sources --> group{"¿Un caso abierto sobre<br/>la misma entidad?"}
    group -->|"Sí"| join["La detección<br/>se suma a él"]
    group -->|"No"| open["Se abre un<br/>caso nuevo"]
    join --> playbooks["Se ejecutan<br/>los playbooks"]
    open --> playbooks
    playbooks --> work["Un analista<br/>gestiona el caso"]
    work --> close["Cerrado con un veredicto"]
```

Abre **Productos → Eventos de seguridad → Casos de seguridad → Casos abiertos** para la cola. **Asignados a mí**, **Sin asignar**, **Casos cerrados** y **Todos los casos** son páginas propias a su lado, y cada una lista los casos que dice su nombre.

## Antes de empezar

Los permisos sobre casos y playbooks dependen de los tres roles de seguridad. Project Owner y Project Admin pueden hacerlo todo.

| Rol | Qué puede hacer |
| --- | --- |
| Security Admin | Todo, incluido eliminar casos y configurar playbooks |
| Security Member | Abrir, asignar, cambiar y cerrar casos, escribir notas, ejecutar playbooks y aprobar o rechazar sus pasos |
| Security Viewer | Leer casos, detecciones, notas, playbooks y sus ejecuciones |

Cada uno de estos permisos también se puede conceder por separado, desde crear un caso hasta aprobar los pasos de un playbook; consulta [Referencia de permisos](/docs/permissions/reference).

## De dónde vienen los casos

| Origen | Abre un caso cuando | Cómo desactivarlo |
| --- | --- | --- |
| Reglas de detección | Una regla coincide | **Open a Case on Match**, en el paso **Al coincidir** de la regla |
| Inteligencia de amenazas | Un evento nombra un indicador conocido | **Open a Case on Match**, en el paso **Al coincidir** del feed |
| Productos conectados | Se importa una alerta propia del producto con un nivel igual o superior al umbral de la conexión | **Open Cases From** con el valor **Nunca**, en el paso **Sondeo** de la conexión |
| Personas | Alguien abre uno desde **Casos de seguridad**, o con **Open Case** en el panel de un evento | No se puede desactivar |

Todos los orígenes están activados por defecto. Una conexión abre casos para **Alta y superior** salvo que elijas otro nivel; las alertas por debajo de ese nivel se siguen importando como eventos.

### Cómo se agrupan las detecciones

Una detección trata sobre una entidad: el valor por el que agrupa su regla, como la dirección IP de una regla de fuerza bruta, o el indicador que nombra una coincidencia de inteligencia de amenazas. Una detección sin entidad queda aislada.

- Cuando ya hay un caso abierto sobre esa entidad, la detección se suma a él. Las entidades y el mapeo de ATT&CK del caso crecen, y su prioridad sube hasta la de la detección, nunca baja.
- Cuando no lo hay, se abre un caso nuevo, con el nombre de la detección y con la prioridad de esta.
- Una detección que se vuelve a disparar incrementa el recuento de su fila en lugar de añadir otra.

La prioridad de un caso se deriva de la gravedad de la detección, en la prioridad predefinida del proyecto para ese nivel, sea cual sea el nombre que le hayas dado:

| Gravedad | Prioridad |
| --- | --- |
| Critical o Fatal | Critical |
| High | High |
| Medium, Unknown u Other | Medium |
| Low | Low |
| Informational | Informational |

## Gestionar un caso

Los casos de un proyecto nuevo pasan por cuatro estados, a los que puedes cambiar el nombre y añadir otros (consulta [Prioridades y estados de los casos](#prioridades-y-estados-de-los-casos)). Un caso puede saltarse alguno, como un falso positivo que se cierra directamente desde Nuevo, y se puede reabrir.

| Estado | Significado |
| --- | --- |
| Nuevo | Nadie lo ha revisado todavía |
| Investigando | Alguien está averiguando qué pasó |
| Contenido | La amenaza ya no puede causar daño; queda pendiente la limpieza |
| Cerrado | Terminado, con un veredicto sobre lo que era |

Un caso tiene su propio menú lateral, como un incidente, y cada parte del caso es una página propia:

| Sección del menú lateral | Páginas |
| --- | --- |
| **Vista general** | **Vista general**, **Cronología** |
| **Investigación** | **Detecciones**, **Entidades**, **Ejecuciones de playbooks** |
| **Notas** | **Notas privadas** |
| **Avanzado** | **Registros de auditoría**, **Eliminar caso**, plegados hasta que haces clic en **Avanzado** |

Cada página mantiene arriba la cabecera del caso: su número, prioridad, estado y título, **Asignarme**, **Run Playbook**, **Declarar incidente** y **Close Case**, y, en el menú ⋯ junto a ellos, **Establecer prioridad**, **Editar caso** y **Eliminar caso**. Así el caso se puede gestionar desde cualquiera de sus páginas, y un enlace al caso sigue abriendo su **Vista general**.

- **Vista general**: la descripción, las etiquetas y los pasos de estado del caso, quién lo tiene y qué lo abrió, y sus cifras: cuántas detecciones tiene, cuánto tiempo lleva abierto y cuánto se tardó en reconocerlo y en contenerlo.
- **OneUptime AI**, en la **Vista general**: lo que OneUptime AI ha sacado del caso, la prioridad y el playbook que sugiere, y la evidencia que hay detrás. Consulta [OneUptime AI en la seguridad](/docs/telemetry/security-ai).
- **MITRE ATT&CK**, en la **Vista general**: las tácticas y técnicas a las que corresponden sus detecciones, cada una enlazada a su página en attack.mitre.org.
- **Cronología**: todo lo que le pasó al caso, con quién lo hizo.
- **Detecciones**: lo que se disparó para abrir el caso o sumarse a él, cuántas veces y el último evento coincidente.
- **Entidades**: los usuarios, hosts y direcciones de los que trata el caso, con su actividad en todos tus eventos de seguridad de los últimos 7 días. Cada una se abre en **Correlacionar**.
- **Ejecuciones de playbooks**: lo que hizo cada playbook en el caso, paso a paso, y los pasos que esperan aprobación. Mientras haya ejecuciones esperando, el menú muestra cuántas junto a **Ejecuciones de playbooks**.
- **Notas privadas**: lo que el equipo escribió sobre el caso.
- **Registros de auditoría**: cada cambio hecho en el caso y quién lo hizo. Consulta [Registros de auditoría](/docs/configuration/audit-logs).
- **Eliminar caso**: elimina para siempre el caso, con sus detecciones, notas, cronología y ejecuciones de playbooks. Para conservar el registro, ciérralo con un veredicto.

Para gestionar varios casos a la vez, selecciónalos en la cola y usa **Asignarme**, **Change Status** o **Change Priority**.

### Cerrar un caso

**Close Case** pide un veredicto y una nota de cierre opcional:

| Veredicto | Significado |
| --- | --- |
| Verdadero positivo | Hubo realmente actividad maliciosa o no autorizada |
| Positivo benigno | La actividad era real pero esperada, como una prueba de penetración o una tarea de administración |
| Falso positivo | La detección se equivocó: la regla o los datos interpretaron mal una actividad normal |
| Indeterminado | No había información suficiente para saberlo |

Los veredictos se cuentan en la vista general. Una regla cuyos casos se cierran una y otra vez como falso positivo es una regla que hay que ajustar.

Un caso abierto a partir de alertas de Google SecOps también las cierra en Google SecOps, con el veredicto y la nota de cierre, cuando su conexión tiene activado **Cerrar las alertas cuando se cierra su caso**: consulta [Google SecOps](/docs/integrations/google-secops#cerrar-las-alertas-cuando-se-cierra-su-caso).

### Declarar un incidente

**Declarar incidente** abre un incidente de OneUptime para el caso, con la gravedad que elijas, y enlaza los dos en ambos sentidos: la descripción del incidente nombra el caso, y la cabecera del caso enlaza al incidente. A partir de ahí toman el relevo la guardia, las páginas de estado y el postmortem. Requiere un rol que pueda tanto gestionar casos como crear incidentes.

## Prioridades y estados de los casos

Cada proyecto tiene sus propias prioridades y estados de caso, en **Productos → Eventos de seguridad → Ajustes → Prioridades de casos** y **Estados de casos**. Cámbiales el nombre o el color, arrástralos a otro orden y añade los tuyos, como un estado «Triaje» o una prioridad «Emergencia» por encima de **Crítico**. Un nombre nuevo se ve en todas partes a la vez: en la cola, en las páginas de los casos y en la vista general, en las notificaciones, en Slack y Microsoft Teams, y en los mensajes de los playbooks.

Algunos son predefinidos, porque OneUptime lee lo que significan. Se les puede cambiar el nombre y el color, pero no eliminarlos ni archivarlos, y conservan su orden:

| Predefinido | Qué hace OneUptime con él |
| --- | --- |
| El estado nuevo | Los casos nuevos empiezan en él |
| El estado reconocido | Al llegar a él se registra cuándo se reconoció el caso, y **Reabrir** devuelve a él un caso cerrado |
| El estado contenido | Al llegar a él se registra cuándo se contuvo el caso |
| El estado cerrado | **Close Case** lleva un caso a él, con un veredicto |
| Las prioridades Crítico, Alta, Medium, Low e Informativos | Una detección abre su caso en la prioridad de su gravedad, y un caso que abre una persona empieza en Medium |

- El lugar de un estado decide qué cuenta un caso que está en él, como muestra la columna **Cuenta como**: desde el estado reconocido hacia abajo, reconocido; desde el estado contenido hacia abajo, contenido; desde el estado cerrado hacia abajo, cerrado. Un estado que añades se coloca justo encima del estado cerrado, y pasar un caso a un estado que lo cierra pide antes un veredicto.
- El puesto de una prioridad es su urgencia, la más urgente primero: **For Cases At Least**, las opciones de notificación y las reglas de Slack y Microsoft Teams leen este orden. Una prioridad que añades va al final, y la columna **Gravedad de la detección** muestra qué detecciones abren sus casos en cada prioridad predefinida.

Para dejar de usar un estado o una prioridad propios, usa **Archivar** en su fila. Nadie puede volver a elegirlo, y la API, Terraform y MCP lo rechazan, pero los casos que lo tienen lo conservan, y puedes seguir filtrando por él. Los valores archivados aparecen en la sección plegada **Estados de caso archivados** o **Prioridades de caso archivadas** bajo la tabla, donde **Desarchivar** devuelve uno. **Eliminar** se rechaza mientras haya casos con el valor o un playbook que parta de la prioridad.

## Notificaciones

OneUptime avisa a las personas de tres cosas de un caso. Nadie tiene que configurar nada: un proyecto que solo hizo clic en **Activar lo recomendado** se entera de sus casos de prioridad Alta y Crítica por correo y por push.

| Notificación | A quién se avisa | Por defecto |
| --- | --- | --- |
| Nuevo caso de seguridad | Todas las personas que pueden ver los casos del proyecto, cuando un caso se abre o sube de prioridad, a partir de la prioridad que eligieron | Por correo y por push, para los casos de prioridad Alta y Crítica |
| Caso de seguridad asignado a mí | La persona a la que está asignado el caso y los miembros del equipo al que está asignado | Por correo y por push |
| Paso de playbook esperando mi aprobación | Las personas del caso que pueden aprobar el paso: la persona a la que está asignado y los miembros de su equipo. Si ninguna de ellas puede aprobarlo, todas las personas del proyecto que pueden hacerlo | Por correo y por push |

- Solo se avisa a las personas que pueden ver el caso: Project Owner, Project Admin y los roles Security Admin, Security Member y Security Viewer. A un rol limitado a algunas etiquetas solo se le avisa de los casos con esas etiquetas.
- A nadie se le avisa de lo que hizo: quien abre un caso a mano, lo asigna o inicia una ejecución no recibe una notificación de ello.
- Cada persona se entera de un caso una sola vez. Un caso que se abre con prioridad Medium y después sube a Crítico llega, al subir, a las personas que eligieron Alta y Crítica o Solo Crítica, y no otra vez a las que eligieron Media y superior, que ya se enteraron cuando se abrió.
- El ataque de prueba de **Enviar un ataque de prueba** abre un caso que no avisa a nadie.
- Un caso Crítico y un paso que espera aprobación se envían al instante, nunca se retienen en un [resumen de correos](/docs/emails/notification-rollup).
- La **Cronología** del caso indica a quién se avisó y cuándo.

### Elegir de qué se te avisa

Cada persona elige por sí misma, en **Ajustes de usuario → Ajustes de notificaciones → Seguridad**: los canales de cada notificación (correo, SMS, llamada, push, Telegram, Slack, Microsoft Teams o webhook) y, en **Nuevo caso de seguridad**, la prioridad a partir de la cual se le avisa:

| Opción | Avisa de los casos de prioridad |
| --- | --- |
| Solo Crítica | Crítico |
| Alta y superior | Crítico y Alta (la opción predeterminada) |
| Media y superior | Crítico, Alta y Medium |
| Baja y superior | Todas menos Informativos |
| Todos los casos | Todas |

Las opciones siguen las prioridades de caso del proyecto, con sus propios nombres: estas son las de un proyecto nuevo.

No se envían mensajes de WhatsApp para los casos de seguridad. Una notificación push abre la app de OneUptime, y su enlace abre el caso en el navegador.

### Publicar en canales de Slack y Microsoft Teams

Para publicar en un canal, añade una regla en **Productos → Eventos de seguridad → Espacio de trabajo → Slack** (o **Microsoft Teams**). Si no hay ninguno de los dos conectado, la única entrada de la sección es **Conectar Slack o Teams**. Una regla nombra los canales en los que publicar (y, en Microsoft Teams, los chats) y, si quieres, los casos a los que se aplica:

| Condición | Coincide con |
| --- | --- |
| Prioridad del caso de seguridad | Una de las prioridades de caso del proyecto, como Crítico o Alta |
| Título del caso de seguridad, Descripción del caso de seguridad | Un texto que el título o la descripción del caso contiene, por el que empieza o con el que termina |
| Estado del caso de seguridad | Uno de los estados de caso del proyecto, como Nuevo o Cerrado |
| Origen del caso de seguridad | Regla de detección, Inteligencia de amenazas, Connected Product o Manual |
| Etiquetas del caso de seguridad | Las etiquetas del caso |

Cada una de las tres notificaciones se publica en los canales de todas las reglas con las que coincide el caso en ese momento. Una regla en la que **Prioridad del caso de seguridad** contiene cualquiera de **Crítico** y **Alta** publica los casos de prioridad Alta y Crítico en cuanto se abren, y un caso Medium cuando sube a Alta. Un caso de seguridad nunca tiene un canal propio.

## Playbooks

Un playbook es una lista de pasos que se ejecutan sobre un caso. Crea uno en **Productos → Eventos de seguridad → Playbooks**, a partir de una plantilla o desde cero, y añade sus pasos en su página. Un proyecto sin playbooks ve las plantillas en lugar de una lista vacía; en cuanto hay playbooks, **Crear desde plantilla** en la lista las abre, con **Añadido** en las que el proyecto ya tiene.

### Cuándo se ejecuta un playbook

| Ejecuciones | Cuándo |
| --- | --- |
| Caso abierto | Una vez, al abrirse un caso |
| Detección añadida | Cada vez que una detección nueva se suma a un caso abierto |
| Clasificado como probablemente malicioso | Una vez, cuando la clasificación de OneUptime AI lee el caso como Probablemente malicioso |
| Manual | Solo cuando alguien lo ejecuta desde un caso |

Cualquier playbook habilitado también se puede ejecutar a mano, con **Run Playbook** en un caso. Un playbook que se ejecuta por sí solo se puede acotar:

- **For Cases At Least**: solo los casos de esta prioridad o superior.
- **Only For Detections From**: solo cuando la detección que originó el caso procede de este origen.
- **Only For These Detection Rules**: solo cuando procede de una de estas reglas.

Un playbook deshabilitado no se ejecuta ni por sí solo ni a mano.

### Pasos

| Categoría | Paso | Qué hace |
| --- | --- | --- |
| Caso | Assign the case | Asigna el caso a una persona, a un equipo o a ambos |
| Caso | Set the priority | Sube o baja la prioridad del caso |
| Caso | Set the status | Pasa el caso a otro estado del proyecto, con el veredicto que elijas cuando ese estado lo cierra |
| Caso | Add a note | Escribe una nota en el caso, como una lista de comprobación para el analista |
| Caso | Add labels | Pone etiquetas al caso |
| Investigación | Check entities against threat intel | Busca cada entidad en tu inteligencia de amenazas y puede subir la prioridad si hay una coincidencia |
| Investigación | Look up entity activity | Cuenta los eventos de seguridad de cada entidad en una ventana reciente y anota el resultado en el caso |
| Notificación | Email people | Envía por email a usuarios y equipos un resumen del caso, con un enlace a él |
| Notificación | Post to Slack | Publica un resumen del caso en un canal de Slack |
| Notificación | Post to Microsoft Teams | Publica un resumen del caso en un canal de Microsoft Teams |
| Escalado | Page on-call | Ejecuta una política de guardia |
| Escalado | Declarar un incidente | Abre un incidente de OneUptime vinculado al caso |
| Contención | Suspend the user in Okta | Suspende en Okta al usuario del que trata el caso |
| Contención | End the user's Okta sessions | Cierra la sesión en Okta del usuario del que trata el caso y revoca sus tokens |
| Contención | Contain the host in CrowdStrike | Aplica la contención de red al host del que trata el caso con CrowdStrike Falcon |
| Contención | Isolate the device in Microsoft Defender | Aísla el host del que trata el caso con Microsoft Defender for Endpoint |
| Contención | Unsuspend the user in Okta | Levanta en Okta la suspensión del usuario del que trata el caso |
| Contención | Lift containment in CrowdStrike | Levanta la contención de red que CrowdStrike Falcon aplica al host del que trata el caso |
| Contención | Release the device in Microsoft Defender | Libera del aislamiento en Microsoft Defender for Endpoint al host del que trata el caso |
| Automatización | Send a webhook | Envía el caso como JSON a una URL |
| Automatización | Run a workflow | Inicia un flujo de trabajo de OneUptime con el caso como entrada |

Un playbook tiene como máximo 25 pasos. Se ejecutan en orden, cada uno cuando ha terminado el anterior. Además, cada paso puede:

- **Needs Approval**: detener la ejecución antes del paso hasta que alguien lo apruebe en el caso. Los cuatro pasos que dejan a alguien sin acceso siempre se detienen, salvo que un Security Admin lo desactive.
- **Only If Threat Intel Matched**: omitir el paso salvo que un paso **Check entities against threat intel** anterior de la misma ejecución haya encontrado un indicador conocido.
- **Carry On If It Fails**: ejecutar el paso siguiente aunque este falle. Si está desactivado, un paso fallido detiene la ejecución.

### Contención

Los pasos de contención actúan a través de una [conexión de eventos de seguridad](/docs/telemetry/security-events#conectar-un-producto-de-seguridad) con el producto, y esa conexión necesita algo más que acceso de lectura:

| Paso | Conexión | Necesita |
| --- | --- | --- |
| Suspend the user in Okta, End the user's Okta sessions, Unsuspend the user in Okta | Okta System Log | Un token de API con permiso para gestionar usuarios |
| Contain the host in CrowdStrike, Lift containment in CrowdStrike | CrowdStrike Falcon | Un cliente de API con permiso de escritura en el ámbito Hosts |
| Isolate the device in Microsoft Defender, Release the device in Microsoft Defender | Microsoft Defender XDR | Una aplicación con el permiso Machine.Isolate |

Un paso de contención solo actúa sobre los usuarios o hosts de los que trata el caso, nunca sobre todos los que el caso nombra:

- El valor por el que se agrupa una detección del caso, como la cuenta por la que agrupa una regla de viaje imposible, o el host que nombra la alerta de un producto conectado.
- Un usuario o host del caso que tu inteligencia de amenazas conoce como indicador.

Un caso agrupado por una dirección, como un ataque de fuerza bruta contra tu VPN, no trata de ninguno de los dos: sus pasos de contención se omiten, y la cuenta contra la que lo intentó y la puerta de enlace que alcanzó quedan intactas. Un paso actúa como máximo sobre 10 usuarios o hosts. Busca cada uno en el producto por su nombre e indica en la ejecución qué hizo con cada uno: hecho, ya hecho, no encontrado, rechazado o protegido.

#### Entidades protegidas

**Protected Entities**, en **Playbooks** en el menú, lista los usuarios y hosts a los que ningún playbook aplica contención, como las cuentas de acceso de emergencia, los controladores de dominio y las puertas de enlace VPN. Un valor coincide sin distinguir mayúsculas de minúsculas, y `*` representa cualquier secuencia de caracteres: `svc-*` protege todas las cuentas de servicio. Un paso informa de un usuario o host protegido como protegido y no lo toca. La lista la mantienen los Security Admins.

#### Aprobación

Los cuatro pasos que dejan a alguien sin acceso esperan aprobación. Solo un Security Admin puede desactivar **Needs Approval** en uno de ellos, y OneUptime registra quién lo hizo. La aprobación lista en **Act On** los usuarios o hosts sobre los que actuaría el paso, todos marcados: desmarca los que deba dejar intactos. Los protegidos no se ofrecen. Quien inició una ejecución no puede aprobar sus pasos: lo hace otra persona, aunque sí puede rechazarlos.

#### Deshacer

Los pasos para deshacer actúan sobre los usuarios o hosts de los que trata el caso, igual que los pasos que deshacen. Cuando la ejecución se ha detenido, un usuario o host contenido tiene además un botón propio en su paso: **Unsuspend**, **Lift Containment** o **Liberar**. El cierre de una sesión de Okta no se puede deshacer. Cada reversión se guarda en la cronología del caso y en el registro de auditoría del proyecto.

### Mensajes

Una nota, un email, una publicación de Slack y una de Teams pueden usar los valores del caso:

| Marcador de posición | Se convierte en |
| --- | --- |
| `{{case.number}}` | El número del caso, como CASE-42 |
| `{{case.title}}` | El título del caso |
| `{{case.priority}}` | La prioridad del caso, tal como la llama tu proyecto, como High |
| `{{case.status}}` | El estado del caso, tal como lo llama tu proyecto, como Investigating |
| `{{case.assignee}}` | A quién está asignado el caso |
| `{{case.url}}` | Un enlace al caso en OneUptime |
| `{{case.entities}}` | Los usuarios, hosts y direcciones de los que trata el caso |
| `{{case.detections}}` | Cuántas detecciones contiene el caso |

Un email o una publicación sin mensaje propio envía un resumen del caso.

### Ejecuciones y aprobaciones

Cada ejecución aparece, paso a paso, en su caso y en **Productos → Eventos de seguridad → Playbooks → Ejecuciones de playbooks**:

| Estado de la ejecución | Significado |
| --- | --- |
| En cola | Esperando a un worker |
| En ejecución | Ejecutando sus pasos |
| Esperando aprobación | Retenida antes de un paso que necesita aprobación |
| Completado con éxito | Todos los pasos se ejecutaron o se omitieron |
| Fallido | Un paso falló y la ejecución se detuvo |
| Cancelado | Alguien la canceló o rechazó un paso |

Un paso que espera aprobación muestra **Approve** y **Rechazar** en la ejecución, con un comentario opcional. Aprobar hace que la ejecución continúe desde ese paso; rechazar la termina. La decisión, quién la tomó y su comentario se guardan en el paso, en la cronología del caso y en el registro de auditoría del proyecto. **Esperando aprobación**, en **Playbooks** en el menú, lista las ejecuciones que esperan una decisión y las cuenta; **Ejecuciones de playbooks** lista todas las ejecuciones. En **Ejecuciones de playbooks** y en la página de un playbook, cada ejecución es una línea que dice hasta dónde llegó, o el paso en el que se detuvo; **Mostrar pasos** abre sus pasos. Una ejecución que espera aprobación se abre sola.

Una ejecución que deja de recibir noticias de su worker, por ejemplo tras un reinicio, se retoma: una ejecución en cola vuelve a ponerse en cola a los 2 minutos, y una ejecución que lleva 30 minutos sin dar señales se marca como fallida.

## La vista general

El producto se abre en **Productos → Eventos de seguridad → Vista general**:

- Los casos abiertos asignados a ti, los casos abiertos que nadie ha tomado todavía y los pasos de playbook que esperan aprobación; cada uno abre la página que los lista.
- **Tiempo medio de reconocimiento**, **Tiempo medio de contención** y **Tiempo medio de cierre**, sobre los casos abiertos en los últimos 30 días: desde que se abre un caso hasta que alguien se hace cargo de él (se asigna a una persona o pasa a un estado que cuenta como reconocido), hasta que pasa a un estado que cuenta como contenido y hasta que pasa a uno que cuenta como cerrado. Un caso que sigue esperando no cuenta en la media.
- Los casos abiertos cada día durante 30 días, por prioridad, y las detecciones generadas cada día durante 14 días, por origen.
- Los casos abiertos por prioridad y por estado, los veredictos de los últimos 30 días, las tácticas de ATT&CK detrás de los casos, las detecciones que más se dispararon y las entidades que nombran más hallazgos.

Encima, una franja muestra cómo está configurada la seguridad: sus orígenes, detecciones, casos y playbooks, cada uno con sus cifras. Un proyecto que aún no la ha configurado ve allí **Activar lo recomendado** y **Enviar un ataque de prueba**; consulte [Primeros pasos con la seguridad](/docs/telemetry/security-getting-started). Cuando nada necesita a nadie, la página dice **Todo tranquilo**, y los gráficos aparecen en cuanto hay algo que representar.

## Encontrar amenazas

- **Entidades** clasifica los usuarios, hosts, direcciones y hashes que más nombran tus hallazgos, en el último día, semana o mes, y busca cualquier valor en 30 días de eventos. Selecciona una entidad para abrirla en **Correlacionar**.
- **Rule Library** tiene reglas de detección listas para usar, para amenazas de identidad, endpoints, nube, red, web y Kubernetes. Cada una es una regla Sigma escrita para los campos a los que se normaliza cada origen conectado. Su fila dice qué encuentra, las tácticas y técnicas de MITRE ATT&CK con las que está etiquetada, los eventos que lee y si llegó alguno en los últimos 7 días (**Recibidos** o **No recibidos**), y su gravedad. Filtra la lista por categoría, por los datos que leen las reglas y por si ya las has añadido, o búscala por nombre, técnica de ATT&CK o gravedad; la dirección de la página conserva los filtros. Selecciona una regla para ver sus detalles: cómo empezar a enviar los eventos que lee, cómo se ejecuta y su regla Sigma. **Añadir** la crea como una regla de detección tuya, activada y que abre casos en lugar de alertas; cámbiala en **Reglas de detección** como cualquier otra. Las reglas marcadas como **Recomendadas** encuentran amenazas en datos que OneUptime ya tiene, y un botón añade las que aún no tiene.
- **ATT&CK Coverage** lista las tácticas de MITRE ATT&CK, cada una con cuántas de sus técnicas cubren tus reglas habilitadas y para cuántas más tiene reglas la **Rule Library**. Abre una táctica para ver sus técnicas, o cambia a **Matriz** para ver la matriz entera. Selecciona una técnica para ver las reglas de la biblioteca que la cubren y abrir la **Rule Library** con ellas.

## Automatizar

- **Flujos de trabajo**: un caso o una nota puede iniciar un flujo de trabajo cuando se crea, se actualiza o se elimina. Un paso **Run a workflow** inicia un flujo de trabajo cuyo desencadenante es un webhook.
- **API**: los casos, las notas, las detecciones, los playbooks, las ejecuciones, las entidades protegidas y las prioridades y estados de caso tienen la misma API REST que el resto de OneUptime, en `/security-case`, `/security-case-note`, `/security-detection`, `/security-playbook`, `/security-playbook-run`, `/security-protected-entity`, `/security-case-priority` y `/security-case-status`. Consulta [Referencia de la API](/docs/api-reference/api-reference).
- Agentes de IA: el servidor MCP tiene herramientas para casos, notas, detecciones, playbooks y prioridades y estados de caso. Consulta [Servidor MCP](/docs/ai/mcp-server).
- Terraform: los recursos `oneuptime_security_case_priority` y `oneuptime_security_case_status` mantienen como código las prioridades y estados de un proyecto.

## Solución de problemas

:::details Una regla coincide, pero no se abre ningún caso
Comprueba **Open a Case on Match** en el paso **Al coincidir** de la regla. Una detección sobre una entidad que ya tiene un caso abierto se suma a ese caso en lugar de abrir otro: búscala en **Detecciones** dentro del caso abierto.
:::

:::details No se avisó a nadie de un caso
Mira la **Cronología** del caso, que indica a quién se notificó. Una notificación **Nuevo caso de seguridad** va a las personas cuya prioridad elegida alcanza el caso, así que un caso Medium no avisa a nadie que haya mantenido la opción predeterminada, **Alta y superior**. Comprueba que las personas que deberían enterarse pueden ver los casos de seguridad (con un rol de seguridad, o como Project Owner o Project Admin) y que tienen la notificación activada en **Ajustes de usuario → Ajustes de notificaciones → Seguridad**.
:::

:::details Un playbook no se ejecutó
Comprueba que está habilitado, que su ajuste **Disparador** encaja (con Caso abierto se ejecuta una sola vez, al abrirse un caso) y que el caso cumple sus ajustes **For Cases At Least**, **Only For Detections From** y **Only For These Detection Rules**. Un caso abierto a mano no tiene detección, así que un playbook limitado a un origen o a unas reglas no se ejecuta sobre él.
:::

:::details Falló un paso de contención
Abre la ejecución en el caso: el paso indica, para cada usuario o host, si el producto lo rechazó, no lo encontró o no se pudo contactar con él. Comprueba que la credencial de la conexión tiene permiso para hacer el cambio, y usa **Probar conexión** en su fila.
:::

:::details Se omitió un paso de contención
El caso no trata de ningún usuario ni host, solo de una dirección, por ejemplo, o todos los usuarios o hosts de los que trata están protegidos. Abre la ejecución en el caso: el paso indica el motivo.
:::

:::details No se puede eliminar ni archivar un estado o una prioridad
Uno predefinido se puede renombrar y cambiar de color, pero nunca eliminar ni archivar: su **Archivar** está bloqueado, con el motivo. Uno propio no se puede eliminar mientras haya casos que lo tengan o un playbook que parta de él: pasa antes los casos a otro, o archívalo.
:::

## Próximos pasos

:::cards
- [Eventos de seguridad](/docs/telemetry/security-events): Envía eventos, escribe reglas de detección y conecta productos de seguridad.
- [Inteligencia de amenazas](/docs/telemetry/threat-intelligence): Coteja tus eventos con feeds STIX/TAXII.
- [OneUptime AI en la seguridad](/docs/telemetry/security-ai): Clasificar casos, redactar reglas de detección y preguntar sobre la seguridad, con IA.
- [Referencia de permisos](/docs/permissions/reference): Los roles de seguridad y lo que puede hacer cada uno.
:::
