# Primeros pasos

OneUptime es una plataforma de observabilidad de código abierto. Comprueba que tus sitios web, API y servidores funcionan, recoge los registros, las métricas y las trazas que envían tus aplicaciones, avisa a quien esté de guardia cuando algo falla e informa a tus clientes en una página de estado. Todo ocurre en un solo producto: la herramienta que detecta un problema es la misma que avisa a tu equipo. Úsalo en OneUptime Cloud o ejecútalo en tus propios servidores.

## ¿Qué quieres hacer?

:::cards
- [Saber cuándo tu sitio web o tu API deja de funcionar](/docs/guides/website-down): Compruébalo desde sondas de todo el mundo y recibe un correo o un aviso cuando falle.
- [Recibir avisos por llamada, SMS o push, y escalar](/docs/guides/paging): Avisa a quien esté de guardia, y a la siguiente persona si nadie responde.
- [Publicar una página de estado en tu propio dominio](/docs/guides/status-page): Cuenta a tus clientes lo que pasa, en una dirección propia.
- [Enviar registros, métricas y trazas](/docs/telemetry/open-telemetry): Envía la telemetría de tus aplicaciones con OpenTelemetry, busca en ella y recibe alertas sobre ella.
- [Monitorizar un servidor](/docs/telemetry/hosts): Añade un host con un comando y vigila su CPU, su memoria y sus discos.
- [Monitorizar un clúster de Kubernetes](/docs/telemetry/kubernetes-agent): Instala el agente con Helm y vigila cada nodo y cada pod.
- [Incorporar a tu equipo](/docs/permissions/index): Invita a personas, organízalas en equipos y decide quién puede hacer qué.
- [Llevar un incidente desde el primer aviso hasta el informe post mortem](/docs/incidents/index): Decláralo, trabaja en él con tu equipo, mantén informados a tus clientes y aprende de él.
:::

## ¿Eres nuevo en OneUptime?

:::cards
- [Inicio rápido](/docs/introduction/quickstart): Monitorizar un sitio web, recibir un aviso cuando falle y publicar una página de estado.
- [Conceptos básicos](/docs/introduction/core-concepts): Las pocas ideas sobre las que se construye todo lo demás, y cómo se relacionan.
- [Glosario](/docs/introduction/glossary): Cada palabra que usa OneUptime, en una o dos frases, con sus otros nombres.
- [¿Cuál uso?](/docs/introduction/which-one): Incidente o alerta, flujo de trabajo o runbook, y las demás cosas que se parecen, lado a lado.
:::

¿Ejecutas OneUptime en tus propios servidores? Sigue primero la [Guía de autoalojamiento](/docs/installation/self-hosting-guide): te lleva de un servidor vacío a uno que envía correos y avisa a las personas.

## Si vienes de otra herramienta

**Ajustes del proyecto → Avanzado → Importar desde otra herramienta** lee tu configuración en otra herramienta, con una clave de API o, en el caso de Uptime Kuma, un archivo. Te muestra lo que ha encontrado y crea lo que marques. Nada cambia en la otra herramienta, y volver a ejecutar la importación nunca crea nada dos veces.

¿Ya envías telemetría con Prometheus, un cliente de Loki, un reenviador de Splunk, el Datadog Agent o un SDK de Sentry? Consérvalo y apúntalo a OneUptime con una clave de ingesta: [Prometheus, Loki, Splunk, Datadog & Sentry](/docs/telemetry/compatible-endpoints) explica cómo.

:::details Las once herramientas desde las que importa
| Si vienes de | Lo que OneUptime lee |
| --- | --- |
| [Opsgenie](/docs/moving-to-oneuptime/opsgenie) | Usuarios, equipos, programaciones, escalados y servicios |
| [PagerDuty](/docs/moving-to-oneuptime/pagerduty) | Usuarios, equipos, programaciones, políticas de escalado y servicios |
| [incident.io](/docs/moving-to-oneuptime/incident-io) | Usuarios, equipos, programaciones, rutas de escalado, servicios y ajustes de incidentes |
| [Splunk On-Call](/docs/moving-to-oneuptime/splunk-on-call) | Usuarios, equipos, rotaciones y políticas de escalado |
| [Grafana OnCall](/docs/moving-to-oneuptime/grafana-oncall) | Usuarios, equipos, programaciones y cadenas de escalado |
| [UptimeRobot](/docs/moving-to-oneuptime/uptimerobot) | Monitores y páginas de estado públicas |
| [Atlassian Statuspage](/docs/moving-to-oneuptime/atlassian-statuspage) | Páginas, sus componentes y grupos, y suscriptores por correo |
| [Better Stack](/docs/moving-to-oneuptime/better-stack) | Monitores, heartbeats, páginas de estado y suscriptores por correo |
| [Pingdom](/docs/moving-to-oneuptime/pingdom) | Comprobaciones de disponibilidad |
| [StatusCake](/docs/moving-to-oneuptime/statuscake) | Comprobaciones de disponibilidad, SSL y heartbeat |
| [Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) | Monitores, desde una copia de seguridad o la página de métricas |
:::

:::details Lo que OneUptime sustituye
| Capacidad | Qué hace | Sustituye a herramientas como |
| --- | --- | --- |
| Monitorización de disponibilidad | Comprueba la disponibilidad y el tiempo de respuesta desde ubicaciones de todo el mundo. | Pingdom, UptimeRobot |
| Páginas de estado | Muestra a los clientes el estado actual y el historial de tus servicios. | Atlassian Statuspage |
| Gestión de incidentes | Lleva los incidentes de principio a fin, con notas, propietarios y una cronología. | incident.io |
| Guardias y alertas | Programa los turnos de guardia y escala hasta que alguien responde. | PagerDuty, Opsgenie |
| Gestión de registros | Recoge, busca y visualiza registros. | Loggly |
| Flujos de trabajo | Automatiza acciones y conecta OneUptime con las herramientas que ya usas. | Zapier |
| Monitorización del rendimiento de aplicaciones | Sigue las trazas, los tiempos de respuesta, el rendimiento y las tasas de error. | New Relic, Datadog |
| Seguimiento de errores | Agrupa las excepciones con sus trazas de pila y su contexto. | Sentry |
:::

## Cómo encaja todo en OneUptime

Todo empieza con algo que vigilas. Un monitor lo comprueba según una programación o lee la telemetría que envía. Cuando se cumplen los criterios del monitor, OneUptime declara un incidente o crea una alerta, avisa a quien esté de guardia y muestra el incidente en tu página de estado si así lo quieres.

```mermaid title="De una comprobación fallida a un equipo avisado y una página de estado actualizada"
flowchart TB
    probes["Las sondas comprueban<br/>tus sitios y API"] --> monitors["Monitores"]
    telemetry["Tus aplicaciones y agentes<br/>envían telemetría"] --> monitors
    monitors -->|"criterios cumplidos"| problems["Incidentes y alertas"]
    problems --> oncall["Las políticas de guardia<br/>avisan a tu equipo"]
    problems --> status["Las páginas de estado<br/>informan a tus clientes"]
```

- Un **incidente** es un problema que afecta a tus usuarios. Puede avisar a quien esté de guardia y aparecer en tu página de estado.
- Una **alerta** es un problema que tu equipo debe revisar antes de que los usuarios lo noten. También puede avisar a quien esté de guardia, pero nunca aparece en una página de estado.

[Conceptos básicos](/docs/introduction/core-concepts) explica cada pieza en unas pocas frases.

## Explorar la documentación

La documentación está organizada como la barra lateral, en nueve secciones. Elige la parte que necesites.

:::details Monitorización
:::cards
- [Monitores](/docs/monitor/create-monitor): Comprobar sitios web, API, puertos, DNS, servidores NTP, certificados y más desde sondas de todo el mundo.
- [Monitores de infraestructura](/docs/monitor/host-monitor): Vigilar servidores, Kubernetes, Docker, VMware, dispositivos de red y almacenamiento.
- [Monitores de telemetría](/docs/monitor/logs-monitor): Alertar sobre los registros, las métricas, las trazas, las excepciones y los perfiles que envías.
- [SLO](/docs/slo/introduction): Seguir objetivos de fiabilidad, presupuestos de error y tasas de consumo.
- [Sondas](/docs/probe/custom-probe): Ejecutar comprobaciones desde dentro de tu propia red.
- [Cuando OneUptime no recibe datos](/docs/monitor/when-oneuptime-is-not-receiving): Por qué un hueco del lado de OneUptime nunca cuenta como tu tiempo de inactividad.
:::
:::

:::details Respuesta a incidentes
:::cards
- [Incidentes](/docs/incidents/index): Declarar, coordinar y resolver incidentes, con una cronología completa.
- [Alertas](/docs/alerts/index): Revisa los problemas antes de que tus usuarios los noten y agrupa el ruido en episodios.
- [Guardia](/docs/on-call/index): Políticas, reglas de escalado, rotaciones y a quién se avisa y cuándo.
- [Notificaciones](/docs/notifications/index): Cómo te contacta OneUptime: tus métodos, reglas de guardia y ajustes de notificaciones.
- [Páginas de estado](/docs/status-pages/index): Mantener informados a tus clientes en páginas de estado públicas o privadas.
- [Mantenimiento programado](/docs/scheduled-maintenance/index): Anunciar trabajos planificados y pausar los monitores que afectan.
- [Conexiones con espacios de trabajo](/docs/workspace-connections/slack): Trabajar en los incidentes desde Slack y Microsoft Teams.
:::
:::

:::details Observabilidad
:::cards
- [Telemetría](/docs/telemetry/open-telemetry): Enviar registros, métricas y trazas con OpenTelemetry, y buscar en ellos.
- [Agentes de infraestructura](/docs/telemetry/hosts): Añadir un host con un comando e instalar los agentes para Kubernetes, Docker, Proxmox, VMware y más.
- [Plataformas de aplicaciones](/docs/telemetry/cloud-environments): Monitorizar las aplicaciones que ejecuta en ECS y Fargate, Cloud Run, App Service y otras plataformas gestionadas.
- [Nube](/docs/telemetry/cloud-accounts): Conectar sus cuentas de AWS, Azure y Google Cloud y monitorizar cada recurso que contienen.
- [Observabilidad de IA](/docs/telemetry/ai-llm-observability): Seguir las conversaciones de tu IA y enterarte cuando responde mal.
- [Seguridad](/docs/telemetry/security-events): Recoger eventos de seguridad e inteligencia de amenazas.
- [Seguridad de datos](/docs/data-security/index): Encontrar los datos sensibles de tus buckets, bases de datos y telemetría, y corregir cómo se guardan.
- [Observabilidad de datos](/docs/data-observability/index): Sepa cuándo los datos de sus bases de datos y almacenes de datos llegan tarde, son incorrectos o están rotos, y qué ejecución, despliegue o tabla está detrás.
- [Real User Monitoring](/docs/rum/index): Medir lo que viven los usuarios reales, con Core Web Vitals y la reproducción de sesiones.
- [Paneles](/docs/dashboards/index): Crear paneles a partir de tus métricas, registros y monitores.
- [Inventario](/docs/inventory/overview): Ver cada servicio, host y dispositivo que OneUptime conoce.
:::
:::

:::details Automatización e IA
:::cards
- [Runbooks](/docs/runbooks/index): Convertir los procedimientos de respuesta en pasos que tu equipo puede ejecutar.
- [Formularios](/docs/forms/index): Permitir que cualquiera informe de un problema mediante un formulario que abre un incidente.
- [Flujos de trabajo](/docs/workflows/index): Automatizar acciones cuando ocurre algo en OneUptime.
- [IA](/docs/ai/ai-sre): Dejar que OneUptime AI investigue incidentes y alertas, y preguntarle por tus sistemas.
:::
:::

:::details Integraciones
:::cards
- [Integraciones](/docs/integrations/index): Conectar Jira, ServiceNow, Grafana, Datadog, Huntress, herramientas SIEM, Discord, Telegram, IRC y más.
:::
:::

:::details Desarrolladores
:::cards
- [Referencia de la API](/docs/api-reference/api-reference): Automatizar OneUptime con su API REST.
- [CLI](/docs/cli/index): Gestionar OneUptime desde tu terminal y tu CI.
- [Proveedor de Terraform](/docs/terraform/index): Gestionar monitores, páginas de estado y guardias como código.
- [Proveedor de Crossplane](/docs/crossplane/index): Gestionar su proyecto desde Kubernetes con Crossplane.
:::
:::

:::details Administración
:::cards
- [Usuarios y permisos](/docs/permissions/index): Invitar a personas, organizar equipos y controlar lo que pueden hacer.
- [Identidad](/docs/identity/sso): Iniciar sesión con inicio de sesión único SAML u OIDC, y aprovisionar usuarios con SCIM.
- [Configuración](/docs/configuration/label-and-owner-rules): Etiquetar recursos y asignarles propietarios automáticamente.
- [Correos electrónicos](/docs/emails/smtp): Enviar el correo de OneUptime a través de tu propio servidor SMTP.
- [Aplicaciones móviles y de escritorio](/docs/mobile-desktop-apps/index): Recibir avisos y responder en iOS, Android, macOS, Windows y Linux.
:::
:::

:::details Autoalojamiento
:::cards
- [Instalación](/docs/installation/self-hosting-guide): Instalar, dimensionar y actualizar tu propio OneUptime.
- [Configuración autoalojada](/docs/self-hosted/architecture): Arquitectura, integraciones y funciones Enterprise para tu propia instalación.
:::
:::

## Próximos pasos

:::cards
- [Inicio rápido](/docs/introduction/quickstart): Configurar tu primer monitor, tu primera política de guardia y tu primera página de estado.
- [Conceptos básicos](/docs/introduction/core-concepts): Aprender las palabras que usan todas las demás páginas.
- [Página de inicio y atajos](/docs/introduction/home): Encontrar cualquier página, ajuste o acción en el panel.
- [Docker Compose](/docs/installation/docker-compose): Ejecutar OneUptime en tu propio servidor.
:::
