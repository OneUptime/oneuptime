<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/translations/README.zh-CN.md">简体中文</a> ·
  <a href="/translations/README.zh-TW.md">繁體中文</a> ·
  <a href="/translations/README.ja.md">日本語</a> ·
  <a href="/translations/README.ko.md">한국어</a> ·
  <a href="/translations/README.es.md">Español</a> ·
  <a href="/translations/README.fr.md">Français</a> ·
  <a href="/translations/README.de.md">Deutsch</a> ·
  <a href="/translations/README.pt.md">Português</a> ·
  <a href="/translations/README.it.md">Italiano</a> ·
  <a href="/translations/README.ru.md">Русский</a> ·
  <a href="/translations/README.hi.md">हिन्दी</a> ·
  <a href="/translations/README.nl.md">Nederlands</a> ·
  <a href="/translations/README.da.md">Dansk</a> ·
  <a href="/translations/README.sv.md">Svenska</a> ·
  <a href="/translations/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="Logo de OneUptime" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Observabilidad agéntica: una plataforma de código abierto para disponibilidad, incidentes, guardias, páginas de estado, registros, trazas, métricas y APM.</h3>

  <p><b>Cuando algo falla, sé el primero en enterarte y el más rápido en solucionarlo.</b></p>

  <p>OneUptime reemplaza toda una estantería de herramientas SaaS con una sola plataforma que puedes alojar por tu cuenta de forma gratuita. Detecta la caída, avisa a la persona adecuada, actualiza tu página de estado, encuentra la causa raíz e incluso abre el PR con la solución.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Sitio web</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Documentación</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>Inicio rápido</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Precios</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>Contribuir</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 Prueba OneUptime Cloud: plan gratis para siempre, sin tarjeta de crédito →</b></a>
</div>

<br/>

<div align="center">
  <img alt="Centro de mando de OneUptime durante un incidente en vivo" width="92%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/hero-command-center.png"/>
</div>

---

## Reemplaza todo tu stack de observabilidad

OneUptime reúne monitoreo, alertas, respuesta a incidentes y observabilidad en una sola aplicación de código abierto, para que dejes de pagar por (y de ensamblar) una docena de herramientas distintas.

| En lugar de… | Usa OneUptime para… |
|---|---|
| Pingdom / UptimeRobot | **Monitoreo de disponibilidad**: verificaciones de sitios web, API, ping, puertos, SSL, DNS y comprobaciones sintéticas desde todo el mundo |
| StatusPage.io | **Páginas de estado**: páginas de estado públicas y privadas con marca propia y suscriptores |
| PagerDuty / Opsgenie | **Guardias y alertas**: horarios, políticas de escalado, SMS / llamada / notificaciones push / Slack |
| Incident.io | **Gestión de incidentes**: declara, clasifica, comunica y haz post-mortem |
| Datadog / New Relic | **APM y métricas**: trazas, paneles y rendimiento de servicios |
| Loggly | **Gestión de registros**: recopila, busca y genera alertas sobre los registros |
| Sentry | **Seguimiento de errores**: excepciones con trazas de pila completas y contexto |

Todo ello es **100 % de código abierto (Apache 2.0)** y gratis para alojar por tu cuenta.

---

<details>
<summary><b>🌙 Un incidente, gestionado de principio a fin</b></summary>

<br/>

Son las 2:47 a. m. El proceso de pago empieza a agotar el tiempo de espera. Esto es lo que hace OneUptime antes de que la mayoría de las herramientas siquiera dispararan la primera alerta, y lo que las capturas de pantalla de abajo muestran realmente.

### 1 · Detectar — *saberlo en segundos*

Sondas en varias regiones detectan que la latencia del pago supera con creces tu umbral de 5 s y abren un incidente automáticamente, antes de que tus clientes pulsen actualizar.

![Detectar — el monitoreo global capta la degradación de la API de pago](/Home/Static/img/readme/detect.png?raw=true)

### 2 · Responder — *la persona adecuada, avisada*

Se llama, se envía un mensaje de texto y una notificación push al ingeniero de guardia de la política de Payments, escalando automáticamente al respaldo hasta que alguien lo confirma.

![Responder — el incidente se enruta a la guardia y se confirma](/Home/Static/img/readme/respond.png?raw=true)

### 3 · Comunicar — *los clientes al tanto*

Tu página de estado se actualiza sola y se notifica a cada suscriptor por correo electrónico y SMS: nadie tiene que redactar la actualización a mano.

![Comunicar — la página de estado pública se actualiza y notifica a los suscriptores](/Home/Static/img/readme/communicate.png?raw=true)

### 4 · Diagnosticar — *la causa raíz, encontrada*

Las trazas, los registros y las métricas se correlacionan hasta el span exacto: un `SELECT … FOR UPDATE` lento sobre `orders`, atascado por un índice que falta.

![Diagnosticar — la cascada de trazas identifica el span lento de la base de datos](/Home/Static/img/readme/diagnose.png?raw=true)

### 5 · Auto-corregir — *la solución, redactada por ti*

El agente de IA abre una solicitud de incorporación de cambios con la solución, vinculada al incidente y con las pruebas en verde: tú la revisas y la fusionas. Como un SRE que nunca duerme.

![Auto-corregir — el agente de IA abre una solicitud de incorporación de cambios con la solución](/Home/Static/img/readme/autofix.png?raw=true)

</details>

---

<a name="quick-start"></a>

## ⚡ Inicio rápido

### ☁️ OneUptime Cloud — la forma fácil

Cero configuración, siempre actualizado, y financia el proyecto de código abierto.

**→ [Regístrate gratis en oneuptime.com](https://oneuptime.com)**

### 🐳 Aloja por tu cuenta con Docker Compose

Todo lo que necesitas en un solo servidor (Debian / Ubuntu / RHEL, Docker + Docker Compose). Ideal para homelabs y equipos pequeños; hasta una Raspberry Pi funciona.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime ya se está ejecutando en **http://localhost**: ábrelo y crea tu primera cuenta.

📖 Guía completa: [Instalación con Docker Compose](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Dimensionamiento y requisitos](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes con Helm — para producción

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Instrucciones completas de instalación y valores en [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **¿Actualizas una instalación existente?** Consulta la [guía de actualización](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Todo lo que incluye

| | Función | Qué hace |
|---|---|---|
| 📊 | **Monitoreo de disponibilidad** | Monitores de sitios web, API, IP, puertos, SSL, DNS y sintéticos desde múltiples regiones globales. |
| 📋 | **Páginas de estado** | Hermosas páginas de estado con marca propia, historial de incidentes, mantenimiento programado y notificaciones a suscriptores. |
| 🚨 | **Gestión de incidentes** | Flujo de incidentes de principio a fin: declara, asigna, comunica, resuelve y ejecuta post-mortems. |
| 📞 | **Guardias y alertas** | Horarios de guardia y políticas de escalado con alertas por SMS, llamada telefónica, push, correo electrónico y Slack. |
| 📝 | **Gestión de registros** | Ingesta, almacena, busca y genera alertas sobre los registros mediante OpenTelemetry. |
| 🔍 | **APM y trazas** | Trazas distribuidas, spans y paneles de rendimiento para encontrar rutas lentas y cuellos de botella. |
| 📈 | **Métricas y paneles** | Paneles personalizados sobre tu telemetría: crea las vistas que tu equipo necesita. |
| 🐛 | **Seguimiento de errores** | Captura excepciones con trazas de pila completas, contexto y seguimiento de versiones. |
| ⚡ | **Flujos de trabajo** | Automatiza e integra con Slack, Jira, GitHub, Microsoft Teams y más de 5000 aplicaciones. |
| 🤖 | **Copiloto de IA** | Un agente siempre activo que encuentra anomalías en registros, trazas y métricas, detecta causas raíz y abre PR con soluciones. |

<details>
<summary><b>⚡ Automatiza el trabajo tedioso</b></summary>

<br/>

Conecta escalados, tickets y notificaciones en un lienzo visual y sin código, o inserta código personalizado. El incidente anterior avisó a la guardia, abrió un ticket en Jira y publicó en Slack sin que nadie moviera un dedo.

![Flujos de trabajo — un lienzo de automatización sin código para el escalado de incidentes](/Home/Static/img/readme/workflows.png?raw=true)

</details>

### 🖥️ Monitoreo de infraestructura

Inserta agentes de copiar y pegar **basados en OpenTelemetry** para vigilar todo aquello sobre lo que se ejecutan tus servicios, con plantillas de alerta listas para usar incluidas:

- **Servidores y VMs**: CPU, memoria, disco, red, procesos y registros de Linux, macOS y Windows. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes**: un solo `helm install` incorpora métricas de nodos/pods/contenedores/clúster, eventos, registros y trazas eBPF y mapas de servicios. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker**: un único agente detecta automáticamente cada contenedor e incorpora métricas y registros. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman**: la misma detección automática de un solo agente a través del socket compatible con Docker de Podman. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox**: nodos, VMs, contenedores, almacenamiento, estado de HA, cobertura de copias de seguridad y salud de la replicación. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph**: salud del clúster, previsiones de capacidad y visibilidad de OSD/pool/PG/monitor. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

---

## 💼 Comunidad vs. Empresarial

| | **Comunidad** | **Empresarial** |
|---|---|---|
| **Ideal para** | Quienes alojan por su cuenta y equipos pequeños | Equipos regulados que necesitan soporte premium |
| **Costo** | Gratis y de código abierto | [Contactar a ventas](mailto:sales@oneuptime.com) |
| **Funciones** | Conjunto completo de funciones | Conjunto completo de funciones + imágenes reforzadas, soporte prioritario, funciones personalizadas y residencia de datos |

---

## 💡 ¿Por qué OneUptime?

Nuestra misión es sencilla: **reducir el tiempo de inactividad y ayudar a que más productos tengan éxito.** En lugar de improvisar uniendo siete proveedores, obtienes una sola plataforma que te ayuda a entender *por qué* se rompen las cosas, a responder a los incidentes con rapidez y a reducir la carga operativa, totalmente de código abierto, para que seas dueño de tus datos y de tu stack.

---

<a name="contributing"></a>

## 🤝 Contribuir

Damos la bienvenida a contribuciones de todos los tamaños. Empieza aquí:

- 🐛 **[Incidencias abiertas](https://github.com/OneUptime/oneuptime/issues)**: toma una, o [crea una nueva](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Ayuda a escribir pruebas](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** para el código base
- 🧑‍💻 **[Guía de desarrollo local](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** para ponerte en marcha
- 📖 Lee las **[pautas de contribución](/CONTRIBUTING.md)**
- 💬 Chatea con nosotros en el **[Slack de desarrolladores](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** o en el **[Slack de la comunidad](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Apoya el proyecto

Si OneUptime te resulta útil:

- ⭐ **Marca este repositorio con una estrella**: de verdad ayuda a que otros nos encuentren
- 💵 **[Patrocínanos](https://github.com/sponsors/OneUptime)**: cada dólar impulsa nuevas funciones
- 🛍️ **[Consigue algo de merch](https://shop.oneuptime.com)**: todos los ingresos financian el desarrollo de código abierto

---

## 📄 Licencia

OneUptime se distribuye bajo la [Apache License 2.0](/LICENSE).

<div align="center">
  <sub>Hecho con ❤️ por el equipo de <a href="https://oneuptime.com">OneUptime</a> y los <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">colaboradores</a>.</sub>
</div>
