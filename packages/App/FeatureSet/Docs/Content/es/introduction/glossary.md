# Glosario

Cada palabra que usa OneUptime, en una o dos frases, con los otros nombres que recibe y la página que la trata a fondo. Las palabras están agrupadas en el orden en que te las encuentras: el primer grupo es el ciclo que sigue todo proyecto, y el último reúne las palabras que significan más de una cosa.

:::cards
- [Para empezar](#para-empezar): El ciclo que sigue todo proyecto, desde un monitor hasta un aviso y una página de estado.
- [Lo que vigilas](#lo-que-vigilas): Servicios, hosts, clústeres, nubes y los objetivos que les fijas.
- [Trabajar en un problema](#trabajar-en-un-problema): Estados, gravedades, propietarios y etiquetas, y los otros tipos de problema.
- [Telemetría y paneles](#telemetría-y-paneles): Lo que envían tus sistemas, y dónde lo consultas.
- [Automatización e IA](#automatización-e-ia): Lo que se ejecuta solo, y lo que hace OneUptime AI.
- [Lo que instalas, y las claves](#lo-que-instalas-y-las-claves): Los agentes que ejecutas, y la clave que usa cada uno.
- [Palabras con más de un significado](#palabras-con-más-de-un-significado): Regla, rol, recurso, ajustes y las demás palabras con varias funciones.
:::

## Para empezar

### Proyecto

Donde vive todo lo que configuras: monitores, incidentes, guardias, páginas de estado, telemetría y ajustes. Nada de un proyecto es visible en otro, y a la mayoría de las empresas les basta con uno.

Consulta [Conceptos básicos](/docs/introduction/core-concepts#proyectos-y-personas).

### Cuenta

Tú: el correo y la contraseña con los que inicias sesión, tu nombre, tu zona horaria y tu idioma. Una cuenta puede pertenecer a tantos proyectos como quieras.

Consulta [Su cuenta](/docs/introduction/your-account).

### Equipo

Un grupo de personas de un proyecto, cuyos permisos deciden lo que pueden hacer sus miembros. Cada proyecto nuevo empieza con tres equipos: Owners, Admin y Members. Invita a las personas en **Usuarios** y agrúpalas en **Equipos**.

Consulta [Usuarios, equipos y permisos](/docs/permissions/index).

### Monitor

Comprueba una cosa que ejecutas, como un sitio web, una API, un servidor o un clúster de Kubernetes, y decide si funciona. Cuando sus criterios coinciden, cambia su estado y puede declarar un incidente o crear una alerta.

Consulta [Crear un monitor](/docs/monitor/create-monitor).

### Criterios

Las reglas de un monitor: qué significa cada resultado de una comprobación. Se evalúan en orden, y el primero que coincide puede cambiar el estado del monitor, declarar un incidente, crear una alerta o las tres cosas.

Otros nombres: **Criterios de monitoreo**, **Criterios del monitor**, **Pasos del monitor**. Consulta [Criterios y estados](/docs/monitor/criteria-and-statuses).

### Estado del monitor

Cómo está un monitor en este momento. Cada proyecto nuevo tiene tres estados de monitor, **Operativo**, **Degradado** y **Sin conexión**, y puedes añadir los tuyos.

Consulta [Criterios y estados](/docs/monitor/criteria-and-statuses).

### Sonda

Una máquina que ejecuta las comprobaciones de los monitores según una programación: pide una página, llama a una API o hace ping a un host. OneUptime Cloud ejecuta sondas en varias regiones, y una sonda personalizada que ejecutas dentro de tu propia red comprueba lo que solo esa red puede alcanzar.

Otros nombres: **Sondas personalizadas**. Consulta [Sondas personalizadas](/docs/probe/custom-probe).

### Incidente

Un problema que afecta a tus usuarios, como una caída o una ralentización, y el registro con el que trabaja tu equipo mientras dura. Puede avisar a quien esté de guardia y aparecer en tus páginas de estado.

Consulta [Visión general de los incidentes](/docs/incidents/index).

### Alerta

Un problema que tu equipo debe revisar antes de que los usuarios lo noten, como un disco que se llena o un certificado a punto de caducar. Puede avisar a quien esté de guardia, pero nunca aparece en una página de estado.

Consulta [Visión general de las alertas](/docs/alerts/index).

### Episodio

Un grupo de incidentes relacionados, o de alertas relacionadas, que tu equipo trabaja como uno solo, con un único conjunto de propietarios y un único estado. Las reglas de agrupación deciden qué entra en cada uno.

Otros nombres: **Episodio de incidente**, **Episodio de alerta**. Consulta [Episodios](/docs/incidents/episodes).

### Política de guardia

Decide a quién se avisa sobre un incidente, una alerta o un episodio, y quién va después si nadie lo reconoce. Sus niveles son reglas de escalado.

Otros nombres: **Guardia**, `OnCallDutyPolicy`. Consulta [Políticas de guardia](/docs/on-call/policies).

### Regla de escalado

Un nivel de una política de guardia: a quién se avisa, y cuánto se espera a que alguien lo reconozca antes de avisar al siguiente nivel. Un nivel puede avisar a personas, a equipos o a una programación de guardia.

Consulta [Reglas de escalado](/docs/on-call/escalation-rules).

### Programación de guardia

Quién está de guardia en cada momento: las personas se turnan, y cada una pasa el relevo a la siguiente. Una regla de escalado que avisa a una programación avisa a quien esté de guardia en ella.

Otros nombres: **Rotación**, **Programación de la política de guardia**. Consulta [Programaciones de guardia](/docs/on-call/schedules).

### Capa

Una rotación dentro de una programación de guardia: quién se turna, cada cuánto se hace el relevo y qué horas cubre. Avisa la capa más alta en la que hay alguien de guardia, así que la rotación principal va arriba y la cobertura de respaldo debajo.

Consulta [Programaciones de guardia](/docs/on-call/schedules#capas).

### Método de notificación

Una dirección en la que OneUptime puede localizarte dentro de un proyecto: una dirección de correo, un número de teléfono para SMS o llamadas, tu cuenta de Slack o de Microsoft Teams, o la aplicación de OneUptime en tu teléfono. Cada persona añade los suyos en **Ajustes de usuario**.

Consulta [Métodos de notificación](/docs/notifications/notification-methods).

### Cómo contactarme

Tus propias reglas para que te avisen: cuáles de tus métodos de notificación prueba un aviso, y al cabo de cuánto tiempo. Una escalera cubre cada incidente, alerta y episodio, y una gravedad puede tener sus propias reglas. Cada persona define las suyas en **Ajustes de usuario**.

Otros nombres: **Reglas de guardia personales**. Consulta [Cómo contactarme](/docs/notifications/on-call-rules).

### Página de estado

Una página que muestra a tus clientes si tus servicios funcionan, y los incidentes y mantenimientos que les afectan. Puede ser pública, o privada para las personas que dejes entrar.

Consulta [Visión general de las páginas de estado](/docs/status-pages/index).

### Suscriptor

Alguien que sigue una página de estado por correo, SMS, Slack, Microsoft Teams o webhook, y recibe aviso cuando un incidente o un mantenimiento en ella empieza, cambia y termina.

Consulta [Suscriptores y anuncios](/docs/status-pages/subscribers).

### Mantenimiento programado

Trabajo previsto, anunciado con antelación. Cada evento de mantenimiento pasa por los estados del mantenimiento **Programado**, **En curso**, **Finalizado** y **Completado**, y las páginas de estado en las que se muestra informan de él a visitantes y suscriptores.

Otros nombres: **Evento de mantenimiento programado**, **Evento programado**, **Evento**. Consulta [Visión general del mantenimiento programado](/docs/scheduled-maintenance/index).

### Telemetría

Lo que tus sistemas envían a OneUptime: registros, métricas, trazas, excepciones y perfiles. Las aplicaciones la envían con OpenTelemetry, y los agentes de OneUptime la envían desde hosts, clústeres y el resto de la infraestructura, cada uno con una clave de ingesta.

Consulta [OpenTelemetry](/docs/telemetry/open-telemetry).

## Lo que vigilas

### Grupo de monitores

Varios monitores reunidos en un solo estado, el peor de todos ellos, con su propia disponibilidad. Una página de estado puede mostrar todo el grupo como una sola fila. Activa los grupos de monitores en **Ajustes del proyecto → Avanzado → Feature flags**.

Consulta [Grupos de monitores](/docs/monitor/monitor-groups).

### Servicio

Una aplicación o un microservicio que ejecutas. OneUptime añade uno la primera vez que llega su telemetría, con el nombre de su `service.name`, y reúne en una sola página sus registros, trazas, métricas, excepciones, incidentes y propietarios.

Otros nombres: **Catálogo de servicios**, **Servicio de telemetría**. Consulta [Servicios](/docs/telemetry/services).

### Host

Una máquina Linux, Windows o macOS que envía sus métricas, procesos, registros y estados de servicio a través del OpenTelemetry Collector. **Añadir host** instala el colector con un solo comando, y OneUptime mantiene su configuración al día.

Consulta [Hosts](/docs/telemetry/hosts).

### Kubernetes

Tus clústeres de Kubernetes, con sus nodos, pods, cargas de trabajo, eventos y registros, enviados por el agente de Kubernetes que instalas con Helm.

Consulta [Agente de Kubernetes](/docs/telemetry/kubernetes-agent).

### Infraestructura

El grupo del menú con las máquinas y plataformas que ejecutas: Hosts, Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Cabinas de almacenamiento, Red e IoT. Un agente o una conexión rellena cada una, y cada una indica cómo está cada máquina, clúster o dispositivo que contiene.

Consulta [Hosts](/docs/telemetry/hosts).

### Red

Tus switches, routers, cortafuegos, puntos de acceso y cualquier otra cosa con una dirección en tu red, hable SNMP o no.

Consulta [Monitor de dispositivos de red](/docs/monitor/network-device-monitor).

### Nube

Tus cuentas de AWS, suscripciones de Azure y proyectos de Google Cloud, conectados desde el panel. OneUptime enumera todos sus recursos, lee sus métricas clave y registra lo que ha cambiado en ellos.

Consulta [Conectar una cuenta en la nube](/docs/telemetry/cloud-accounts).

### Plataformas de aplicaciones

Las aplicaciones que ejecutas en plataformas gestionadas como Amazon ECS y Fargate, Google Cloud Run y Azure App Service. Cada lugar donde se ejecutan es un entorno en la nube, que OneUptime crea la primera vez que llega su telemetría.

Otros nombres: **Entorno en la nube**. Consulta [Entornos en la nube](/docs/telemetry/cloud-environments).

### Serverless

Tus funciones serverless, como AWS Lambda, Google Cloud Functions y Azure Functions, listadas con sus trazas, registros y métricas en cuanto llegan sus datos de OpenTelemetry.

Otros nombres: **Funciones serverless**. Consulta [Funciones serverless](/docs/telemetry/serverless-functions).

### Bases de datos

Cada base de datos que consultan tus aplicaciones, reconstruida a partir de tus trazas, de las métricas propias de la base de datos y de las demás fuentes que OneUptime puede leer, con el estado de su motor.

Consulta [Bases de datos](/docs/telemetry/databases).

### Colas

Las colas y los temas de mensajes que usan tus servicios, como Apache Kafka, RabbitMQ y Amazon SQS, a partir de tus trazas y de las métricas de tus brokers.

Consulta [Colas](/docs/telemetry/queues).

### Monitoreo de usuarios reales

Lo que viven las personas reales en tus aplicaciones web y móviles: cargas de página, solicitudes, errores y Core Web Vitals, informados por la propia aplicación y no por una sonda.

Consulta [Visión general de RUM](/docs/rum/index).

### Inventario

Una sola lista de todo lo que OneUptime sabe de tu infraestructura: servicios, hosts, objetos de Kubernetes, máquinas virtuales, dispositivos de red, recursos en la nube y las cosas que no envían ninguna telemetría. Casi todo se rellena solo.

Consulta [Visión general del inventario](/docs/inventory/overview).

### Topología

Un mapa de cómo se conectan tus sistemas, qué servicios llaman a cuáles y qué se ejecuta dónde, trazado a partir de la telemetría que ya envías.

Consulta [Topología](/docs/telemetry/topology).

### SLO

Un objetivo de fiabilidad para lo que monitorizas, como estar disponible el 99,9 % del tiempo durante 30 días. OneUptime mide cada SLO con sus monitores cada 5 minutos.

Otros nombres: **Objetivo de nivel de servicio**. Consulta [Visión general de los SLO](/docs/slo/introduction).

### Presupuesto de errores

El tiempo de inactividad que permite el objetivo de un SLO: al 99,9 % durante 30 días, 43 minutos y 12 segundos. Con mucho margen puedes arriesgarte; con poco, frena e invierte en estabilidad.

Consulta [Presupuestos de errores](/docs/slo/error-budget).

## Trabajar en un problema

### Estado

En qué punto de tu respuesta está un incidente o una alerta. Cada proyecto nuevo empieza con **Identificado**, **Reconocido** y **Resuelto**: reconocer indica que alguien se está ocupando y evita que se avise al siguiente nivel de escalado, y resolver lo cierra.

Otros nombres: **Estado del incidente**, **Estado de la alerta**. Consulta [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

### Gravedad

Cuánto importa un incidente o una alerta. Un proyecto nuevo empieza con Critical Incident, Major Incident y Minor Incident para los incidentes, y **Alta** y **Baja** para las alertas; cámbiales el nombre o el color, o añade las tuyas.

Otros nombres: **Gravedad del incidente**, **Gravedad de la alerta**. Consulta [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

### Propietario

Una persona o un equipo responsable de un registro, como un monitor, un incidente o una página de estado. Los propietarios reciben aviso cuando le pasa algo a lo que es suyo.

Consulta [Reglas de etiquetas y propietarios](/docs/configuration/label-and-owner-rules).

### Etiqueta

Una marca, como Production o Checkout, que pones a monitores, incidentes, páginas de estado y la mayoría de los demás registros para filtrarlos y agruparlos. Los permisos de un equipo pueden limitarse a los registros con ciertas etiquetas.

Consulta [Reglas de etiquetas y propietarios](/docs/configuration/label-and-owner-rules).

### Excepción

Un error que lanza tu código. OneUptime agrupa cada aparición del mismo error en una sola excepción, con su traza de pila, su tendencia y las solicitudes en las que ocurrió.

Otros nombres: **Seguimiento de excepciones**, `/telemetry-exception`. Consulta [Excepciones](/docs/telemetry/exceptions).

### Hallazgos de IA

Problemas que OneUptime encuentra en tu telemetría antes de que nada avise: excepciones nuevas o en aumento, picos de registros de error, trazas más lentas, desviaciones de métricas y despliegues que empeoraron las cosas. Los hallazgos nunca avisan a nadie ni abren incidentes; esperan en una bandeja de entrada hasta que alguien los mira. La página **Análisis** de la sección de IA de un producto o de un registro es lo que OneUptime AI aprendió allí.

Otros nombres: **Análisis**. Consulta [AI SRE](/docs/ai/ai-sre#hallazgos-detección-proactiva).

### Eventos de seguridad

El SIEM de OneUptime: los eventos de seguridad de tus registros, de tus herramientas de seguridad y de cualquier otra cosa que envíes, guardados con un mismo formato junto a tu telemetría, con reglas de detección que encuentran amenazas en ellos.

Otros nombres: **SIEM**. Consulta [Eventos de seguridad (SIEM)](/docs/telemetry/security-events).

### Caso de seguridad

Algo que merece la pena investigar, procedente de reglas de detección, de inteligencia de amenazas o de un producto de seguridad conectado, con todas las detecciones sobre el mismo usuario, host o dirección agrupadas en él. Los analistas trabajan los casos en una cola, y los playbooks responden a ellos.

Otros nombres: **Caso**. Consulta [Casos de seguridad y playbooks (SOAR)](/docs/telemetry/security-cases).

## Telemetría y paneles

### Registros

Las líneas que escriben tus servicios, hosts y agentes, que buscas en el explorador de registros y vigilas con un monitor de registros.

Consulta [Explorador de registros](/docs/telemetry/logs-explorer).

### Métricas

Los números que tus servicios y tu infraestructura informan a lo largo del tiempo, como recuentos de solicitudes, latencia, CPU y profundidad de cola.

Consulta [Explorador de métricas](/docs/telemetry/metrics-explorer).

### Trazas

El recorrido de una solicitud a través de tus servicios, paso a paso. Cada paso es un span, con su duración y su resultado.

Consulta [Explorador de trazas](/docs/telemetry/traces-explorer).

### Perfiles

Cómo gasta tu aplicación el tiempo de CPU y la memoria, función por función, enviado por un perfilador que envía los datos a la API compatible con Pyroscope de OneUptime.

Otros nombres: **Perfiles de rendimiento**, **Perfilado continuo**. Consulta [Perfiles](/docs/telemetry/profiles).

### IA / LLM

Las conversaciones de tus aplicaciones y agentes de IA: cada llamada a un modelo, con sus tokens, coste, latencia, prompt y respuesta, construida a partir de los spans de OpenTelemetry que envía tu aplicación.

Otros nombres: **Observabilidad de IA / LLM**. Consulta [Observabilidad de IA / LLM](/docs/telemetry/ai-llm-observability).

### Observabilidad de datos

Vigila las tablas de tus bases de datos y almacenes de datos, y te avisa cuando sus datos llegan tarde, faltan o son incorrectos, y de qué ejecución, despliegue o tabla viene el problema.

Consulta [Vista general de Observabilidad de datos](/docs/data-observability/index).

### Seguridad de datos

Encuentra los datos sensibles que guarda tu empresa, en buckets en la nube, bases de datos, almacenes de datos y la telemetría que envías, y te dice qué falla en cómo se guardan.

Consulta [Vista general de Seguridad de datos](/docs/data-security/index).

### Panel

Una página de widgets que organizas tú mismo: gráficos de tus métricas, registros y trazas, listas de incidentes y monitores, tus SLO y mucho más. Un panel es privado para tu proyecto hasta que lo compartes.

Consulta [Visión general de los paneles](/docs/dashboards/index).

### Panel público

Un panel compartido mediante un enlace público, para personas que no inician sesión en tu proyecto. Protégelo con una contraseña, limítalo a ciertas direcciones IP o alójalo en tu propio dominio.

Consulta [Compartir y paneles públicos](/docs/dashboards/sharing).

## Automatización e IA

### Flujo de trabajo

Una automatización sin código: bloques en un lienzo que se ejecutan cuando salta su disparador, como publicar en Slack cuando se declara un incidente, o llamar a otra herramienta.

Consulta [Visión general de los flujos de trabajo](/docs/workflows/index).

### Runbook

Un procedimiento de respuesta reutilizable: pasos manuales y automatizados que tu equipo ejecuta sobre un incidente, una alerta o un evento de mantenimiento, a mano o cuando coincide una regla de runbook.

Consulta [Visión general de los Runbooks](/docs/runbooks/index).

### Playbook

Los pasos que responden a un caso de seguridad, como preservar las pruebas, avisar a quien esté de guardia o suspender a un usuario, ejecutados solos o con un clic.

Otros nombres: **Playbook de seguridad**. Consulta [Casos de seguridad y playbooks (SOAR)](/docs/telemetry/security-cases#playbooks).

### Regla de IA

Decide qué incidentes o alertas nuevos investiga y corrige OneUptime AI, y cómo. Sin ninguna regla de IA los investiga todos, así que la mayoría de los proyectos no necesitan ninguna.

Otros nombres: **Regla de corrección automática**. Consulta [AI SRE](/docs/ai/ai-sre#qué-incidentes-se-investigan-y-se-corrigen).

### OneUptime AI

El ingeniero de fiabilidad de sitios con IA de OneUptime: investiga cada nuevo incidente y cada nueva alerta en toda tu telemetría y publica lo que ha encontrado en su cronología. El interruptor **Habilitar IA** de **Ajustes del proyecto** lo desactiva por completo.

Otros nombres: **AI SRE**. Consulta [AI SRE](/docs/ai/ai-sre).

### Preguntar a la IA

Un chat sobre los datos de tu proyecto. Consulta tus registros, trazas, métricas, incidentes, monitores y más, y responde con una cita para cada afirmación.

Otros nombres: **Chat**. Consulta [Preguntar a la IA](/docs/ai/ask-ai).

### Código

Donde pides a OneUptime AI que trabaje en tus repositorios, como se lo pedirías a un agente de programación: corregir un error, escribir pruebas o hacer un cambio, y recibir de vuelta una pull request.

Otros nombres: **Tareas**. Consulta [Código](/docs/ai/ai-agent).

### Formulario

Una página que cualquiera con su enlace puede rellenar, sin cuenta. Cada envío crea un incidente, para informar de un problema, o un evento de mantenimiento programado, para solicitar un cambio.

Consulta [Visión general de los formularios](/docs/forms/index).

## Lo que instalas, y las claves

### Agente de infraestructura

El servicio `oneuptime-infrastructure-agent` que hay detrás de un monitor de servidor / VM: informa de la CPU, la memoria, los discos y los procesos de una máquina cada 30 segundos, firmado con la clave secreta del monitor.

Consulta [Monitor de servidor / VM](/docs/monitor/server-monitor).

### Agente de Kubernetes

Un chart de Helm que recoge las métricas, los eventos y los registros de pods de un clúster y, con eBPF, sus trazas, y los envía con una clave de ingesta.

Consulta [Agente de Kubernetes](/docs/telemetry/kubernetes-agent).

### OpenTelemetry Collector

El agente de código abierto que recibe, procesa y envía telemetría. **Añadir host** lo instala en una máquina, el agente de Docker es uno, y tus propios colectores envían a OneUptime con una clave de ingesta.

Otros nombres: **Recolector**. Consulta [Hosts](/docs/telemetry/hosts) y [Colector OpenTelemetry en el host](/docs/telemetry/host-otel-collector).

### Runner

Un pequeño proceso que ejecutas en tu propia infraestructura y que ejecuta los pasos de JavaScript, Bash, SSH y kubectl de tus runbooks. Se conecta hacia OneUptime con su propio Runner ID y su propia clave.

Otros nombres: **Agentes de runbook**. Consulta [Agentes de runbook](/docs/runbooks/agents).

### Clave de ingesta

La clave que permite a algo enviar telemetría a tu proyecto: aplicaciones con OpenTelemetry, colectores y agentes. Va en la cabecera `x-oneuptime-token`, y una clave de API del proyecto no sirve en su lugar.

Otros nombres: **Clave de ingesta de telemetría**, `oneuptime.apiKey`. Consulta [Claves de ingesta](/docs/telemetry/ingestion-keys).

### Clave de API

Una clave que permite a un script, la CLI, Terraform o un asistente de IA leer y cambiar tu proyecto a través de la API, con los permisos que le des. Crea una en **Ajustes del proyecto → Avanzado → Claves de API**.

Consulta [Usuarios, equipos y permisos](/docs/permissions/index#claves-de-api).

## Palabras con más de un significado

### Regla

Muchas cosas en OneUptime son reglas, y cada una toma una decisión por ti: a quién se avisa (**Reglas de guardia**, **Reglas de escalado**), quién es propietario de los registros nuevos y cómo se etiquetan (**Reglas del propietario**, **Reglas de etiquetas**), qué va junto (**Reglas de agrupación**) y qué hace OneUptime AI (**Reglas de IA**). Las reglas propias de un monitor son sus criterios.

Consulta [Conceptos básicos](/docs/introduction/core-concepts#los-tipos-de-regla).

### Rol

Cuatro cosas distintas: los permisos que concede un equipo, como Project Owner o Project Admin; un **Rol personalizado** que compones a partir de permisos; un **Rol de incidente**, el papel que alguien desempeña en un incidente; y un **Rol del dispositivo de red**, lo que hace un dispositivo de tu red.

Consulta [Usuarios, equipos y permisos](/docs/permissions/index).

### Recurso

Casi siempre, la infraestructura que registra OneUptime, como hosts, clústeres, bases de datos y recursos en la nube. Los **Recursos afectados** de un incidente son los monitores y la infraestructura a los que afecta, los recursos de una página de estado son los monitores y grupos que muestra, y los atributos de recurso de OpenTelemetry dicen de dónde vino la telemetría.

Consulta [Visión general del inventario](/docs/inventory/overview).

### Ajustes

Cada nivel tiene los suyos: **Ajustes del proyecto** para todo el proyecto, **Ajustes de usuario** para cómo te contacta OneUptime, y los **Ajustes** propios de un producto en su menú lateral, como los estados y las plantillas de incidentes en **Incidentes**. Los ajustes de un servidor autoalojado están en el Admin Dashboard.

Consulta [Ajustes del proyecto](/docs/configuration/project-settings).

### Política

Casi siempre una **Política de guardia**: a quién se avisa, y quién va después. Una política de llamadas entrantes da a tu equipo un número de teléfono que llama a quien esté de guardia, y una política de presupuesto de errores deja por escrito qué hace tu equipo cuando se agota el presupuesto de un SLO.

Consulta [Políticas de guardia](/docs/on-call/policies).

### Plantilla

Un punto de partida guardado: una plantilla de monitor crea monitores, las plantillas de incidentes y alertas rellenan los registros nuevos, las plantillas de notas y de informes post mortem inician lo que escribes, y las plantillas de paneles construyen los widgets de un panel.

Consulta [Plantillas de monitor](/docs/monitor/monitor-templates).

### Espacio de trabajo

Un espacio de trabajo de Slack o Microsoft Teams que conectas a OneUptime en **Conexiones del espacio de trabajo**, para publicar actualizaciones en tus canales y actuar sobre incidentes desde el chat. Lo que otras herramientas llaman espacio de trabajo es un proyecto en OneUptime.

Consulta [Slack](/docs/workspace-connections/slack).

### Agente

Un programa que instalas y que informa a OneUptime o actúa en su nombre: los agentes de infraestructura, de Kubernetes y de Docker envían lo que recogen, un Runner ejecuta pasos de runbook, y un agente de IA permite a OneUptime AI examinar un clúster o un host. Las tareas que le das a **Código** son tareas de un agente de IA.

Consulta [¿Cuál uso?](/docs/introduction/which-one#sonda-agente-colector-o-runner).

### Reglas de guardia

En **Incidentes** y **Alertas**, las reglas de guardia eligen las políticas de guardia que ejecuta un incidente o una alerta nuevos. Las reglas propias de cada persona sobre cómo le llega un aviso también se llamaban reglas de guardia: ahora son **Cómo contactarme**, en **Ajustes de usuario**.

Consulta [Configuración y automatización de incidentes](/docs/incidents/settings#reglas-de-guardia-de-incidentes) y [Cómo contactarme](/docs/notifications/on-call-rules).

### Ajustes de notificaciones

En **Ajustes de usuario**, qué actualizaciones te llegan sobre lo que es tuyo, y por qué canales. Los interruptores del proyecto para SMS y llamadas, su saldo de mensajería y su propio SMTP y Twilio también se llamaban ajustes de notificaciones: ahora son **Canales de notificación**, en **Ajustes del proyecto**.

Consulta [Ajustes de notificaciones](/docs/notifications/notification-settings).

## Próximos pasos

:::cards
- [¿Cuál uso?](/docs/introduction/which-one): Incidente o alerta, flujo de trabajo o runbook, y las demás cosas que se parecen, lado a lado.
- [Conceptos básicos](/docs/introduction/core-concepts): Cómo se relacionan las piezas, en una sola página.
- [Inicio rápido](/docs/introduction/quickstart): Pon estas palabras en práctica en quince minutos.
:::
