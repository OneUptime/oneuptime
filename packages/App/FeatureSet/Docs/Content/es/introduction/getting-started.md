# Primeros pasos

OneUptime es una plataforma de observabilidad de código abierto. Comprueba que tus sitios web, API y servidores funcionan, recoge los registros, las métricas y las trazas que envían tus aplicaciones, avisa a quien esté de guardia cuando algo falla e informa a tus clientes en una página de estado. Todo ocurre en un solo producto: la herramienta que detecta un problema es la misma que avisa a tu equipo. Úsalo en OneUptime Cloud o ejecútalo en tus propios servidores.

Empieza aquí:

:::cards
- [Inicio rápido](/docs/introduction/quickstart): Monitorizar un sitio web, recibir un aviso cuando falle y publicar una página de estado.
- [Conceptos básicos](/docs/introduction/core-concepts): Las pocas ideas sobre las que se construye todo lo demás, y cómo se relacionan.
- [Página de inicio y atajos](/docs/introduction/home): Orientarte en el panel, y las teclas que te ahorran clics.
- [Su cuenta](/docs/introduction/your-account): Tu perfil, tu contraseña, tus llaves de acceso y la autenticación de dos factores.
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

### Monitorización

:::cards
- [Monitores](/docs/monitor/create-monitor): Comprobar sitios web, API, puertos, DNS, servidores NTP, certificados y más desde sondas de todo el mundo.
- [Monitores de infraestructura](/docs/monitor/server-monitor): Vigilar servidores, Kubernetes, Docker, VMware, dispositivos de red y almacenamiento.
- [Monitores de telemetría](/docs/monitor/logs-monitor): Alertar sobre los registros, las métricas, las trazas, las excepciones y los perfiles que envías.
- [SLO](/docs/slo/introduction): Seguir objetivos de fiabilidad, presupuestos de error y tasas de consumo.
- [Sondas](/docs/probe/custom-probe): Ejecutar comprobaciones desde dentro de tu propia red.
- [Cuando OneUptime no recibe datos](/docs/monitor/when-oneuptime-is-not-receiving): Por qué un hueco del lado de OneUptime nunca cuenta como tu tiempo de inactividad.
:::

### Respuesta a incidentes

:::cards
- [Incidentes](/docs/incidents/index): Declarar, coordinar y resolver incidentes, con una cronología completa.
- [Guardia](/docs/on-call/schedules): Rotaciones, reglas de escalado y a quién se avisa y cuándo.
- [Páginas de estado](/docs/status-pages/index): Mantener informados a tus clientes en páginas de estado públicas o privadas.
- [Conexiones con espacios de trabajo](/docs/workspace-connections/slack): Trabajar en los incidentes desde Slack y Microsoft Teams.
:::

### Observabilidad

:::cards
- [Telemetría](/docs/telemetry/open-telemetry): Enviar registros, métricas y trazas con OpenTelemetry, y buscar en ellos.
- [Agentes de infraestructura](/docs/telemetry/kubernetes-agent): Instalar los agentes para Kubernetes, hosts, Docker, Proxmox, VMware y más.
- [Nube](/docs/telemetry/cloud-environments): Observar ECS, Cloud Run, Azure Container Apps y otras plataformas gestionadas.
- [Observabilidad de IA](/docs/telemetry/ai-llm-observability): Seguir las conversaciones de tu IA y enterarte cuando responde mal.
- [Seguridad](/docs/telemetry/security-events): Recoger eventos de seguridad e inteligencia de amenazas.
- [Real User Monitoring](/docs/rum/index): Medir lo que viven los usuarios reales, con Core Web Vitals y la reproducción de sesiones.
- [Paneles](/docs/dashboards/index): Crear paneles a partir de tus métricas, registros y monitores.
- [Inventario](/docs/inventory/overview): Ver cada servicio, host y dispositivo que OneUptime conoce.
:::

### Automatización e IA

:::cards
- [Runbooks](/docs/runbooks/index): Convertir los procedimientos de respuesta en pasos que tu equipo puede ejecutar.
- [Formularios](/docs/forms/index): Permitir que cualquiera informe de un problema mediante un formulario que abre un incidente.
- [Flujos de trabajo](/docs/workflows/index): Automatizar acciones cuando ocurre algo en OneUptime.
- [IA](/docs/ai/ai-sre): Dejar que OneUptime AI investigue incidentes y alertas, y preguntarle por tus sistemas.
:::

### Integraciones

:::cards
- [Integraciones](/docs/integrations/index): Conectar Jira, ServiceNow, Grafana, Datadog, Huntress, herramientas SIEM, Discord, Telegram, IRC y más.
:::

### Desarrolladores

:::cards
- [Referencia de la API](/docs/api-reference/api-reference): Automatizar OneUptime con su API REST.
- [CLI](/docs/cli/index): Gestionar OneUptime desde tu terminal y tu CI.
- [Proveedor de Terraform](/docs/terraform/index): Gestionar monitores, páginas de estado y guardias como código.
:::

### Administración

:::cards
- [Usuarios y permisos](/docs/permissions/index): Invitar a personas, organizar equipos y controlar lo que pueden hacer.
- [Identidad](/docs/identity/sso): Iniciar sesión con inicio de sesión único SAML u OIDC, y aprovisionar usuarios con SCIM.
- [Configuración](/docs/configuration/label-and-owner-rules): Etiquetar recursos y asignarles propietarios automáticamente.
- [Correos electrónicos](/docs/emails/smtp): Enviar el correo de OneUptime a través de tu propio servidor SMTP.
- [Aplicaciones móviles y de escritorio](/docs/mobile-desktop-apps/index): Recibir avisos y responder en iOS, Android, macOS, Windows y Linux.
:::

### Autoalojamiento

:::cards
- [Instalación](/docs/installation/docker-compose): Instalar, dimensionar y actualizar tu propio OneUptime.
- [Configuración autoalojada](/docs/self-hosted/architecture): Arquitectura, integraciones y funciones Enterprise para tu propia instalación.
:::

## Si vienes de otra herramienta

### Trae tu configuración contigo

**Ajustes del proyecto → Importar desde otra herramienta** lee tu configuración en otra herramienta, con una clave de API o, en el caso de Uptime Kuma, un archivo. Te muestra lo que ha encontrado y crea lo que marques. Nada cambia en la otra herramienta, y volver a ejecutar la importación nunca crea nada dos veces.

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

### Lo que OneUptime sustituye

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

## Próximos pasos

:::cards
- [Inicio rápido](/docs/introduction/quickstart): Configurar tu primer monitor, tu primera política de guardia y tu primera página de estado.
- [Conceptos básicos](/docs/introduction/core-concepts): Aprender las palabras que usan todas las demás páginas.
- [Página de inicio y atajos](/docs/introduction/home): Encontrar cualquier página, ajuste o acción en el panel.
- [Docker Compose](/docs/installation/docker-compose): Ejecutar OneUptime en tu propio servidor.
:::
