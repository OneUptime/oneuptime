# Integración con GitLab

Abre automáticamente un issue de [GitLab](https://gitlab.com) cuando se crea un incidente en OneUptime — para que el seguimiento del trabajo de ingeniería quede en el proyecto que aloja el servicio afectado.

Esta integración es **saliente**: OneUptime llama a la [API REST de GitLab](https://docs.gitlab.com/ee/api/issues.html). Usa un **[Workflow](/docs/workflows/index)** de OneUptime con un disparador **Incident → On Create** y un **componente API**. Funciona igual en GitLab.com y en GitLab autogestionado.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## Prerrequisitos

- Un proyecto de GitLab y su **ID de Proyecto** (que aparece en la página de resumen del proyecto, bajo el nombre del proyecto).
- Un token de acceso que pueda crear issues — un **Project**, **Group** o **Personal Access Token** con el alcance `api`: **Settings → Access Tokens**.
- Un proyecto de OneUptime donde puedas crear workflows.

## Paso 1 — Guardar el token

1. Ve a **Workflows → Global Variables → Create**.
2. Nómbrala `GITLAB_TOKEN`, pega el token y activa **Is Secret**.

## Paso 2 — Construir el workflow

1. Abre **Workflows → Create Workflow**, nómbralo `Incidents → GitLab Issues` y abre el **Builder**.
2. Añade un disparador **Incident** configurado en **On Create**. Renómbralo `Incident`.
3. Añade un bloque **API** conectado al disparador:

   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues` _(reemplaza `12345678` con tu ID de Proyecto; para autogestionado, usa tu propio host)_
   - **Headers**:

     ```text
     PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "description": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": "incident,oneuptime"
     }
     ```

4. **Guarda**, habilita y crea un incidente de prueba. Un `201 Created` en los registros del workflow significa que el issue fue creado; el cuerpo de la respuesta contiene su `iid` y `web_url`.

## Consejos

- **GitLab autogestionado**: reemplaza `https://gitlab.com` con la URL de tu instancia; la ruta `/api/v4/...` se mantiene igual.
- **Ruta del proyecto en lugar del ID**: puedes codificar en URL la ruta — p. ej. `grupo%2Fproyecto` — en lugar del ID numérico.
- **Asignado / fecha de vencimiento**: añade `"assignee_ids": [42]` o `"due_date": "2026-01-31"` al cuerpo.
- **Enlazar de vuelta**: lee `{{CreateIssue.response-body.web_url}}` y guárdalo en el incidente con un bloque **Update Incident**.

## Solución de problemas

- **`401`** — el token es inválido o ha caducado, o le falta el alcance `api`.
- **`404`** — el ID de Proyecto es incorrecto, o el token no puede acceder a un proyecto privado.
- **`400`** — falta un campo obligatorio o está malformado; `title` es obligatorio.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — patrones y la guía de autenticación.
- [GitHub](/docs/integrations/github) — la misma idea para GitHub.
- [Componente API](/docs/workflows/components#api) — lectura del cuerpo de la respuesta.
