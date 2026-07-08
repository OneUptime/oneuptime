<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/README.zh-CN.md">简体中文</a> ·
  <a href="/README.zh-TW.md">繁體中文</a> ·
  <a href="/README.ja.md">日本語</a> ·
  <a href="/README.ko.md">한국어</a> ·
  <a href="/README.es.md">Español</a> ·
  <a href="/README.fr.md">Français</a> ·
  <a href="/README.de.md">Deutsch</a> ·
  <a href="/README.pt.md">Português</a> ·
  <a href="/README.it.md">Italiano</a> ·
  <a href="/README.ru.md">Русский</a> ·
  <a href="/README.hi.md">हिन्दी</a> ·
  <a href="/README.nl.md">Nederlands</a> ·
  <a href="/README.da.md">Dansk</a> ·
  <a href="/README.sv.md">Svenska</a> ·
  <a href="/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="Logo de OneUptime" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>Una plataforma de código abierto para disponibilidad, incidentes, guardias, páginas de estado, registros, trazas, métricas y APM.</h3>

  <p>Monitoreo, StatusPage, Guardias, Incidentes, Registros y APM: reemplaza toda una estantería de herramientas SaaS con una sola plataforma que puedes autoalojar gratis.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="Licencia"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Versión"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Estrellas"></a>
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

  <a href="https://oneuptime.com"><b>🚀 Prueba OneUptime Cloud — plan gratis para siempre, sin tarjeta de crédito →</b></a>
</div>

<br/>

<div align="center">
  <img alt="Panel de OneUptime" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## Reemplaza toda tu pila de observabilidad

OneUptime reúne el monitoreo, las alertas, la respuesta a incidentes y la observabilidad en una única aplicación de código abierto, para que dejes de pagar por (y ensamblar) una docena de herramientas separadas.

| En lugar de… | Usa OneUptime para… |
|---|---|
| Pingdom / UptimeRobot | **Monitoreo de disponibilidad** — comprobaciones de sitios web, API, ping, puertos, SSL, DNS y sintéticas desde todo el mundo |
| StatusPage.io | **Páginas de estado** — páginas de estado públicas y privadas con marca propia y suscriptores |
| PagerDuty / Opsgenie | **Guardias y alertas** — horarios, políticas de escalado, SMS / llamada / push / Slack |
| Incident.io | **Gestión de incidentes** — declara, clasifica, comunica y realiza análisis post mortem |
| Datadog / New Relic | **APM y métricas** — trazas, paneles y rendimiento de servicios |
| Loggly | **Gestión de registros** — recopila, busca y genera alertas sobre los registros |
| Sentry | **Seguimiento de errores** — excepciones con trazas de pila completas y contexto |

Todo ello es **100 % de código abierto (Apache 2.0)** y gratis para autoalojar.

---

<a name="quick-start"></a>

## ⚡ Inicio rápido

### ☁️ OneUptime Cloud — la vía fácil

Sin configuración, siempre actualizado y financia el proyecto de código abierto.

**→ [Regístrate gratis en oneuptime.com](https://oneuptime.com)**

### 🐳 Autoalojamiento con Docker Compose

Todo lo que necesitas en un único servidor (Debian / Ubuntu / RHEL, Docker + Docker Compose). Ideal para homelabs y equipos pequeños: incluso funciona una Raspberry Pi.

```bash
# 1. Clona la rama de lanzamiento
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Crea tu configuración (luego edítala: ¡establece secretos fuertes y aleatorios!)
cp config.example.env config.env

# 3. Inicia todo
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

## ✨ Funcionalidades

| | Funcionalidad | Qué hace |
|---|---|---|
| 📊 | **Monitoreo de disponibilidad** | Monitores de sitios web, API, IP, puertos, SSL, DNS y sintéticos desde múltiples regiones globales. |
| 📋 | **Páginas de estado** | Páginas de estado con marca propia hermosas, historial de incidentes, mantenimiento programado y notificaciones a suscriptores. |
| 🚨 | **Gestión de incidentes** | Flujo de incidentes de principio a fin: declara, asigna, comunica, resuelve y ejecuta análisis post mortem. |
| 📞 | **Guardias y alertas** | Horarios de guardia y políticas de escalado con alertas por SMS, llamada telefónica, push, correo electrónico y Slack. |
| 📝 | **Gestión de registros** | Ingiere, almacena, busca y genera alertas sobre los registros mediante OpenTelemetry. |
| 🔍 | **APM y trazas** | Trazas distribuidas, spans y paneles de rendimiento para encontrar rutas lentas y cuellos de botella. |
| 📈 | **Métricas y paneles** | Paneles personalizados sobre tu telemetría: crea las vistas que tu equipo necesita. |
| 🐛 | **Seguimiento de errores** | Captura excepciones con trazas de pila completas, contexto y seguimiento de versiones. |
| ⚡ | **Flujos de trabajo** | Automatiza e integra con Slack, Jira, GitHub, Microsoft Teams y más de 5000 aplicaciones. |
| 🤖 | **Copiloto de IA** | Un agente siempre activo que encuentra anomalías en registros, trazas y métricas, detecta causas raíz y abre PR con correcciones. |

### 🖥️ Monitoreo de infraestructura

Incorpora agentes **basados en OpenTelemetry** de copiar y pegar para vigilar todo aquello sobre lo que se ejecutan tus servicios, con plantillas de alerta listas para usar incluidas:

- **Servidores y VM** — CPU, memoria, disco, red, procesos y registros de Linux, macOS y Windows. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — un solo `helm install` incluye métricas de nodos/pods/contenedores/clúster, eventos, registros y trazas eBPF y mapas de servicios. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — un único agente descubre automáticamente cada contenedor y envía métricas y registros. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — el mismo descubrimiento automático de un solo agente a través del socket compatible con Docker de Podman. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — nodos, VM, contenedores, almacenamiento, estado de HA, cobertura de copias de seguridad y salud de la replicación. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — salud del clúster, previsiones de capacidad y visibilidad de OSD/pool/PG/monitor. [Documentación →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 Ver las capturas de pantalla</b></summary>
<br/>

**Monitoreo de disponibilidad**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**Páginas de estado**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**Gestión de incidentes**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**Guardias y alertas**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**Gestión de registros**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**Monitoreo del rendimiento de aplicaciones**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**Flujos de trabajo**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 Community frente a Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Ideal para** | Autoalojadores y equipos pequeños | Equipos regulados que necesitan soporte premium |
| **Costo** | Gratis y de código abierto | [Contacta con ventas](mailto:sales@oneuptime.com) |
| **Funcionalidades** | Conjunto completo de funcionalidades | Conjunto completo de funcionalidades + imágenes reforzadas, soporte prioritario, funcionalidades personalizadas y residencia de datos |

---

## 💡 ¿Por qué OneUptime?

Nuestra misión es simple: **reducir el tiempo de inactividad y ayudar a que más productos tengan éxito.** En lugar de improvisar la unión de siete proveedores, obtienes una única plataforma que te ayuda a entender *por qué* fallan las cosas, responder a los incidentes con rapidez y reducir el trabajo operativo tedioso, totalmente de código abierto, para que seas dueño de tus datos y tu pila.

---

<a name="contributing"></a>

## 🤝 Contribuir

Damos la bienvenida a contribuciones de todos los tamaños. Empieza aquí:

- 🐛 **[Incidencias abiertas](https://github.com/OneUptime/oneuptime/issues)** — toma una, o [crea una nueva](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Ayuda a escribir pruebas](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** para el código base
- 🧑‍💻 **[Guía de desarrollo local](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** para ponerte en marcha
- 📖 Lee las **[pautas de contribución](CONTRIBUTING.md)**
- 💬 Charla con nosotros en el **[Slack para desarrolladores](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** o en el **[Slack de la comunidad](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Apoya el proyecto

Si OneUptime te resulta útil:

- ⭐ **Dale una estrella a este repositorio** — realmente ayuda a que otros nos encuentren
- 💵 **[Patrocínanos](https://github.com/sponsors/OneUptime)** — cada dólar impulsa nuevas funcionalidades
- 🛍️ **[Consigue algo de merchandising](https://shop.oneuptime.com)** — todas las ganancias financian el desarrollo de código abierto

---

## 📄 Licencia

OneUptime se distribuye bajo la [Apache License 2.0](LICENSE).

<div align="center">
  <sub>Hecho con ❤️ por el equipo de <a href="https://oneuptime.com">OneUptime</a> y sus <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">colaboradores</a>.</sub>
</div>
