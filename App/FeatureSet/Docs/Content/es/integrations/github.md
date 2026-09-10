# Integración con GitHub

Abre automáticamente un issue de [GitHub](https://github.com) cuando se crea un incidente en OneUptime — para que el seguimiento del trabajo de ingeniería quede en el repositorio que aloja el servicio afectado.

Esta integración es **saliente**: OneUptime llama a la [API REST de GitHub](https://docs.github.com/en/rest/issues/issues). Usa un **[Workflow](/docs/workflows/index)** de OneUptime con un disparador **Incident → On Create** y un **componente API**.

> **¿Buscas la conexión más profunda con GitHub?** OneUptime también tiene una integración nativa de **GitHub App** para conectar repositorios de código (usada por el agente de IA y las funciones de código). Puedes hablar con esa app en tu repositorio: menciónala en un issue o en un pull request e implementa, modifica o revisa; consulta [Trabajar con OneUptime desde GitHub](/docs/ai/github-app), y [Integración con GitHub (autohospedado)](/docs/self-hosted/github-integration) para instalarla. Esta página trata específicamente de _registrar issues a partir de incidentes_.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## Prerrequisitos

- Un repositorio de GitHub donde quieras registrar issues.
- Un token que pueda crear issues:

  - Un **PAT de grano fino** con alcance a ese repositorio con **Issues: Read and write**, o
  - un **PAT clásico** con el alcance `repo`.

  Crea uno en [github.com/settings/tokens](https://github.com/settings/tokens).

- Un proyecto de OneUptime donde puedas crear workflows.

## Paso 1 — Guardar el token

1. Ve a **Flujos de trabajo → Variables Globales → Crear**.
2. Nómbrala `GITHUB_TOKEN`, pega el token y activa **Is Secret**.

## Paso 2 — Construir el workflow

1. Abre **Flujos de trabajo → Crear flujo de trabajo**, nómbralo `Incidents → GitHub Issues` y abre el **Constructor**.
2. Añade un disparador **Incident** configurado en **On Create**. Renómbralo `Incident`.
3. Añade un bloque **API** conectado al disparador:

   - **Method**: `POST`
   - **URL**: `https://api.github.com/repos/tu-org/tu-repo/issues`
   - **Headers**:

     ```text
     Authorization: Bearer {{variable.GITHUB_TOKEN}}
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     User-Agent: OneUptime
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "body": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": ["incident", "oneuptime"]
     }
     ```

4. **Guarda**, habilita y crea un incidente de prueba. Un `201 Created` en los registros del workflow significa que el issue fue creado; el cuerpo de la respuesta contiene su `number` y `html_url`.

## Consejos

- **GitHub Enterprise Server**: usa `https://tu-host/api/v3/repos/{owner}/{repo}/issues`.
- **Asignados / hito**: añade `"assignees": ["octocat"]` o `"milestone": 3` al cuerpo.
- **Enlazar de vuelta**: lee `{{CreateIssue.response-body.html_url}}` y guárdalo en el incidente con un bloque **Update Incident**.

## Solución de problemas

- **`401`** — el token es incorrecto o ha caducado. Los tokens de grano fino deben conceder explícitamente el repositorio y el permiso de **Issues**.
- **`403` / límite de tasa** — incluye la cabecera `User-Agent` (GitHub rechaza solicitudes sin ella) y comprueba que no estés en el límite de tasa.
- **`404`** — la ruta `owner/repo` es incorrecta, o el token no puede ver un repositorio privado.
- **`422`** — una etiqueta que no existe está bien (GitHub crea las etiquetas referenciadas), pero un cuerpo malformado no lo está — comprueba tu JSON.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — patrones y la guía de autenticación.
- [GitLab](/docs/integrations/gitlab) — la misma idea para GitLab.
- [Integración con GitHub (autohospedado)](/docs/self-hosted/github-integration) — la conexión nativa de GitHub App.
- [Trabajar con OneUptime desde GitHub](/docs/ai/github-app) — dar órdenes a la GitHub App desde un issue o un pull request.

## Acceso a la red para despliegues autoalojados

El flujo de creación de issues de esta página necesita resolución DNS y HTTPS saliente (TCP 443) desde OneUptime a `api.github.com`. No requiere llamadas de retorno entrantes de GitHub. [GitHub REST API](https://docs.github.com/en/rest/issues/issues#create-an-issue).

Para las conexiones salientes, las llamadas de retorno entrantes y los despliegues privados, consulte la sección de acceso a la red de la [Integración con GitHub](/docs/self-hosted/github-integration).
