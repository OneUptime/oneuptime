<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a>&nbsp;·
  <a href="/Docs/translations/README.zh-CN.md">简&#8288;体&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.zh-TW.md">繁&#8288;體&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.ja.md">日&#8288;本&#8288;語</a>&nbsp;·
  <a href="/Docs/translations/README.ko.md">한&#8288;국&#8288;어</a>&nbsp;·
  <a href="/Docs/translations/README.es.md">Español</a>&nbsp;·
  <a href="/Docs/translations/README.fr.md">Français</a>&nbsp;·
  <a href="/Docs/translations/README.de.md">Deutsch</a>&nbsp;·
  <a href="/Docs/translations/README.pt.md">Português</a>&nbsp;·
  <a href="/Docs/translations/README.it.md">Italiano</a>&nbsp;·
  <a href="/Docs/translations/README.ru.md">Русский</a>&nbsp;·
  <a href="/Docs/translations/README.hi.md">हिन्दी</a>&nbsp;·
  <a href="/Docs/translations/README.fa.md">فارسی</a>&nbsp;·
  <a href="/Docs/translations/README.nl.md">Nederlands</a>&nbsp;·
  <a href="/Docs/translations/README.da.md">Dansk</a>&nbsp;·
  <a href="/Docs/translations/README.sv.md">Svenska</a>&nbsp;·
  <a href="/Docs/translations/README.no.md">Norsk</a>
</p>

<p align="center">
  <a href="https://oneuptime.com"><picture><source media="(prefers-color-scheme: dark)" srcset="/packages/App/FeatureSet/Docs/Static/images/logo-dark.svg"><img alt="OneUptime" width="42%" src="/packages/App/FeatureSet/Docs/Static/images/logo-light.svg"></picture></a>
</p>

<p align="center">
  <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise%20%28ee%2F%29-1a73e8" alt="License"></a>
  <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
</p>

OneUptime es una plataforma de observabilidad de código abierto. Comprueba que tus sitios web, API y servidores funcionan, recoge los registros, las métricas y las trazas que envían tus aplicaciones, avisa a quien esté de guardia cuando algo falla e informa a tus clientes en una página de estado. Todo ocurre en un solo producto: la herramienta que detecta un problema es la misma que avisa a tu equipo.

Puedes usarlo en [OneUptime Cloud](https://oneuptime.com) o ejecutarlo en tus propios servidores.

<p align="center">
  <img alt="OneUptime durante un incidente: su cronología, quién está de guardia, la página de estado y la investigación de OneUptime AI" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## Qué hace

- **[Monitorización](https://oneuptime.com/docs/es/monitor/create-monitor)**: Comprobar sitios web, API, puertos, DNS y certificados desde sondas de todo el mundo o desde dentro de tu propia red. OneUptime también vigila servidores, Kubernetes, Docker, VMware, bases de datos y dispositivos de red.
- **[Incidentes y guardias](https://oneuptime.com/docs/es/incidents/index)**: Trabajar cada incidente en una sola cronología. Avisar a quien esté de guardia por llamada, SMS, correo electrónico, push, Slack o Microsoft Teams, y escalar hasta que alguien responda.
- **[Páginas de estado](https://oneuptime.com/docs/es/status-pages/index)**: Mantener informados a tus clientes en páginas de estado públicas o privadas, y anunciar allí el mantenimiento programado.
- **[Registros, métricas y trazas](https://oneuptime.com/docs/es/telemetry/open-telemetry)**: Enviarlos con OpenTelemetry, buscar en ellos y crear paneles. Las excepciones, los perfiles, el Real User Monitoring y los eventos de seguridad están en el mismo lugar.
- **[Flujos de trabajo y runbooks](https://oneuptime.com/docs/es/workflows/index)**: Automatizar el trabajo rutinario y conectar Jira, ServiceNow y las demás herramientas que tu equipo ya usa.
- **[OneUptime AI](https://oneuptime.com/docs/es/ai/ai-sre)**: Investiga los incidentes y las alertas nuevos y publica un análisis de causa raíz con citas. Cuando activas la corrección, puede abrir un pull request con una corrección para que tu equipo la revise.
- **[API, CLI y Terraform](https://oneuptime.com/docs/es/api-reference/api-reference)**: Automatizar OneUptime desde tus scripts y tu CI, y gestionar monitores, páginas de estado y guardias como código.

Todo lo demás está en la [documentación](https://oneuptime.com/docs/es/introduction/getting-started).

## Primeros pasos

### OneUptime Cloud

[Regístrate](https://oneuptime.com/accounts/register) y crea un proyecto. El plan gratuito no necesita tarjeta de crédito.

### Alojarlo por tu cuenta con Docker Compose

Necesitas un servidor Linux con al menos 8 GB de memoria, y Docker, Docker Compose, Git y Node.js.

Antes del paso 3, define `HOST` en `config.env` con el nombre de dominio o la dirección IP que se usará para llegar a OneUptime, sin `http://`. Deja `localhost` solo para probar OneUptime en tu propio ordenador.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config, with a random value for every secret
cp config.example.env config.env
while grep -q "please-change-this-to-random-value" config.env; do
  sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$(openssl rand -hex 32)/}" config.env
done

# 3. Start everything
npm start
```

Cuando `npm start` muestre **OneUptime is up!**, abre `http://localhost`, o la dirección de tu servidor, y regístrate. La primera cuenta pasa a ser la administradora de la instancia.

La [guía de Docker Compose](https://oneuptime.com/docs/es/installation/docker-compose) cubre el tamaño del servidor, HTTPS, las copias de seguridad y las actualizaciones.

### Kubernetes con Helm

Para producción a gran escala, o alta disponibilidad, instala el chart de Helm. Pon en `host` el nombre de dominio o la dirección IP con la que se accederá a OneUptime:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

El [README del chart](/HelmChart/Public/oneuptime/README.md) cubre el almacenamiento, HTTPS, las bases de datos y las actualizaciones.

## Community y Enterprise

- **Community Edition**: Gratuita y de código abierto, con todo lo anterior, incluido el inicio de sesión único SAML y OIDC.
- **Enterprise Edition**: Añade el aprovisionamiento SCIM, los registros de auditoría, el cumplimiento de equipos y los paneles de salud de la instancia, con soporte prioritario. El uso en producción requiere una licencia: [contacta con ventas](mailto:sales@oneuptime.com).

La documentación [compara las dos ediciones](https://oneuptime.com/docs/es/self-hosted/enterprise).

## Obtener ayuda

- Haz preguntas en la [comunidad de OneUptime en Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA).
- Informa de errores y pide funciones en los [issues de GitHub](https://github.com/OneUptime/oneuptime/issues).
- Informa de una vulnerabilidad de seguridad en privado, como explica [SECURITY.md](/.github/SECURITY.md).
- Para todo lo demás, escribe a [support@oneuptime.com](mailto:support@oneuptime.com).

## Contribuir

Las correcciones de errores, las funciones, la documentación y las pruebas son bienvenidas. La [guía de desarrollo local](https://oneuptime.com/docs/es/installation/local-development) explica cómo ejecutar OneUptime desde el código fuente, y las [pautas de contribución](/.github/CONTRIBUTING.md) explican cómo funcionan los pull requests y las licencias. Los issues con la etiqueta [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) son un buen punto de partida.

Si OneUptime te resulta útil, dale una estrella a este repositorio o [patrocina el proyecto](https://github.com/sponsors/OneUptime).

## Licencia

OneUptime es de código abierto bajo la [Apache License 2.0](/LICENSE), salvo el directorio [`ee/`](/ee). Ese directorio contiene la Enterprise Edition y se distribuye bajo la [OneUptime Enterprise License](/ee/LICENSE). La imagen de la Community Edition no contiene código de `ee/`. El archivo [`LICENSE`](/LICENSE) de la raíz del repositorio establece esta división.
