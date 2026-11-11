# ¿Cuál uso?

Algunas cosas en OneUptime se parecen. Esta página pone cada conjunto lado a lado, con para qué sirve cada una, para que elijas la correcta a la primera. Cada tabla cabe en una pantalla, y su primera columna abre la página que trata esa opción a fondo.

:::cards
- [¿Incidente, alerta u otro tipo de problema?](#incidente-alerta-u-otro-tipo-de-problema): En qué se convierte un problema en OneUptime.
- [¿Flujo de trabajo, runbook, playbook o regla de IA?](#flujo-de-trabajo-runbook-playbook-o-regla-de-ia): Con qué automatizar.
- [¿Grupo de monitores, servicio o etiqueta?](#grupo-de-monitores-servicio-o-etiqueta): Cómo agrupar lo que monitorizas.
- [¿Sonda, agente, colector o Runner?](#sonda-agente-colector-o-runner): Qué instalar, y la clave que usa cada uno.
- [¿Panel, panel público o página de estado?](#panel-panel-público-o-página-de-estado): Qué compartir, y con quién.
:::

## ¿Incidente, alerta u otro tipo de problema?

La mayoría de los problemas son un incidente o una alerta: elige según a quién afecta el problema. Los demás son registros que OneUptime guarda por ti, y cada uno de ellos puede dar lugar a un incidente o a una alerta.

| Registro | Qué es | Úsalo cuando |
| --- | --- | --- |
| [Incidente](/docs/incidents/index) | Un problema que afecta a tus usuarios. Puede avisar a quien esté de guardia y aparecer en tus páginas de estado. | Los clientes lo notan, o pronto lo notarán: una caída, una ralentización, un pago que falla. |
| [Alerta](/docs/alerts/index) | Un problema para tu equipo. Puede avisar a quien esté de guardia, pero nunca aparece en una página de estado. | Tu equipo debe actuar antes de que los usuarios lo noten: un disco que se llena, un certificado a punto de caducar. |
| [Episodio](/docs/incidents/episodes) | Un grupo de incidentes relacionados, o de alertas relacionadas, que se trabajan como uno solo. | Una sola causa generó muchos incidentes o alertas. Las reglas de agrupación abren episodios por ti. |
| [Excepción](/docs/telemetry/exceptions) | Todas las apariciones de un mismo error que lanza tu código, agrupadas, con su traza de pila. | Quieres corregir un error. Un monitor de excepciones puede generar una alerta o un incidente cuando los errores se disparan. |
| [Hallazgo de IA](/docs/ai/ai-sre#hallazgos-detección-proactiva) | Un problema que OneUptime encontró en tu telemetría antes de que nada avisara, como un pico de registros de error. | Quieres avisos tempranos. Un hallazgo nunca avisa a nadie ni abre un incidente: espera en una bandeja de entrada. |
| [Caso de seguridad](/docs/telemetry/security-cases) | Una amenaza que merece la pena investigar, con todas las detecciones sobre el mismo usuario, host o dirección. | Tu equipo de seguridad investiga. **Declarar incidente** en un caso abre un incidente cuando hay usuarios afectados. |

Una alerta puede vincularse al incidente del que resultó formar parte, así que empezar con una alerta no te hace perder nada.

## ¿Flujo de trabajo, runbook, playbook o regla de IA?

Los cuatro pueden ejecutarse solos. Elige según sobre qué actúan y quién escribió los pasos.

| Herramienta | Qué hace | Úsalo cuando |
| --- | --- | --- |
| [Flujo de trabajo](/docs/workflows/index) | Bloques en un lienzo que se ejecutan cuando salta su disparador: se crea un incidente, vence una programación, otra herramienta llama a una URL. | Quieres conectar OneUptime con otras herramientas, o actuar sobre sus registros, sin escribir código. |
| [Runbook](/docs/runbooks/index) | Tu procedimiento de respuesta en forma de pasos, desde listas de comprobación manuales hasta scripts, solicitudes HTTP y kubectl, ejecutados sobre un incidente, una alerta o un evento de mantenimiento. | Quienes responden deben seguir los mismos pasos cada vez. Las reglas de runbook inician un runbook en los incidentes que coinciden. |
| [Playbook](/docs/telemetry/security-cases#playbooks) | Pasos que responden a un caso de seguridad: preservar las pruebas, avisar a quien esté de guardia, suspender a un usuario. | Tu equipo de seguridad responde al mismo tipo de amenaza de la misma forma cada vez. |
| [Regla de IA](/docs/ai/ai-sre#qué-incidentes-se-investigan-y-se-corrigen) | Decide qué incidentes y alertas nuevos investiga y corrige OneUptime AI, y si pregunta antes. | OneUptime AI debe trabajar solo en algunos incidentes, o corregir sin preguntar. Sin ninguna regla, los investiga todos. |

## ¿Grupo de monitores, servicio o etiqueta?

Los tres reúnen cosas, para lectores distintos. También funcionan juntos: los monitores de un servicio pueden formar un grupo de monitores, y todos ellos pueden llevar la misma etiqueta.

| Opción | Qué es | Úsalo cuando |
| --- | --- | --- |
| [Grupo de monitores](/docs/monitor/monitor-groups) | Varios monitores reunidos en un solo estado, el peor de todos ellos, con su propia disponibilidad. | Los clientes deben ver una sola fila en una página de estado para algo formado por varios monitores, como Checkout. |
| [Servicio](/docs/telemetry/services) | Una aplicación que OneUptime encontró en tu telemetría, con sus registros, trazas, métricas, incidentes y propietarios en una sola página. | Quieres todo lo de una aplicación en un solo lugar. Aparece solo a partir de su `service.name`. |
| [Etiqueta](/docs/configuration/label-and-owner-rules) | Una marca que pones a monitores y a la mayoría de los demás registros. Un registro puede llevar muchas. | Quieres filtrar listas, limitar los permisos de un equipo o seleccionar registros en las reglas. |

Los grupos de monitores empiezan desactivados: actívalos en **Ajustes del proyecto → Avanzado → Feature flags**.

## ¿Sonda, agente, colector o Runner?

La mayor parte de OneUptime no requiere instalar nada: instala algo solo para llegar a lo que OneUptime no puede ver desde fuera. Cada pieza se conecta hacia fuera, con una clave de su propio tipo.

| Instalación | Qué hace | Instálalo cuando | Clave que usa |
| --- | --- | --- | --- |
| [Sonda personalizada](/docs/probe/custom-probe) | Ejecuta las comprobaciones de tus monitores desde dentro de tu red. | Lo que compruebas está detrás de tu cortafuegos. Las sondas propias de OneUptime comprueban lo que es público. | Su propio ID de sonda y su clave |
| [Agente de infraestructura](/docs/monitor/server-monitor) | Informa de la CPU, la memoria, los discos y los procesos de una máquina a un monitor de servidor / VM. | Quieres un monitor de un servidor, con criterios sobre sus cifras. | La clave secreta del monitor |
| [OpenTelemetry Collector](/docs/telemetry/hosts) | Envía las métricas, los registros y los procesos de una máquina. **Añadir host** lo instala con un solo comando. | Quieres una máquina en **Hosts**, con su telemetría. | Una clave de ingesta |
| [Agente de Kubernetes](/docs/telemetry/kubernetes-agent) | Recoge las métricas, los eventos, los registros y las trazas de un clúster. Lo instalas con Helm. | Usas Kubernetes. | Una clave de ingesta |
| [Runner](/docs/runbooks/agents) | Ejecuta pasos de runbook, como Bash, SSH y kubectl, dentro de tu infraestructura. | Tus runbooks necesitan llegar a tus propios hosts y clústeres. | Su propio Runner ID y su clave |

### ¿Clave de ingesta o clave de API?

| Clave | Qué te permite hacer | Dónde la creas |
| --- | --- | --- |
| [Clave de ingesta](/docs/telemetry/ingestion-keys) | Enviar telemetría al proyecto, y nada más. | **Ajustes del proyecto → Telemetría y APM → Claves de ingesta** |
| [Clave de API](/docs/permissions/index#claves-de-api) | Leer y cambiar el proyecto a través de la API, la CLI, Terraform o un asistente de IA, con los permisos que le des. | **Ajustes del proyecto → Avanzado → Claves de API** |

Ninguna de las dos sirve en lugar de la otra.

## ¿Panel, panel público o página de estado?

Elige según quién deba verlo.

| Compartir | Quién lo ve | Úsalo cuando |
| --- | --- | --- |
| [Panel](/docs/dashboards/index) | Las personas que inician sesión en tu proyecto. | Tu equipo sigue gráficos y listas: una pantalla de guardia, la vista propia de un equipo. |
| [Panel público](/docs/dashboards/sharing) | Cualquiera con su enlace, salvo que añadas una contraseña, lo limites a ciertas direcciones IP o lo alojes en tu propio dominio. | Personas ajenas al proyecto deben ver tus gráficos, como un socio o una pantalla en la pared. |
| [Página de estado](/docs/status-pages/index) | Tus clientes, en público, o solo los usuarios privados que dejes entrar. | Los clientes quieren saber si tus servicios funcionan, y que se les avise de incidentes y mantenimientos. |

Una página de estado habla en incidentes y con los nombres que das a tus monitores; un panel muestra las cifras que hay detrás.

## Próximos pasos

:::cards
- [Glosario](/docs/introduction/glossary): Cada palabra que usa OneUptime, en una o dos frases.
- [Conceptos básicos](/docs/introduction/core-concepts): Cómo se relacionan las piezas, en una sola página.
- [Inicio rápido](/docs/introduction/quickstart): Un monitor, un aviso y una página de estado en quince minutos.
:::
