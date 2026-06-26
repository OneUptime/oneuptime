# Integración con Jira

Abre automáticamente un issue de [Jira](https://www.atlassian.com/software/jira) cada vez que se crea un incidente en OneUptime — para que el trabajo de ingeniería se registre donde tus desarrolladores ya trabajan, con un enlace de vuelta al incidente.

Esta integración es **saliente**: OneUptime llama a la API REST de Jira. Usa un **[Workflow](/docs/workflows/index)** de OneUptime con un disparador **Incident → On Create** y un **componente API**. Puedes añadir opcionalmente una ruta **entrante** para que cerrar el issue de Jira resuelva el incidente de OneUptime.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## Prerrequisitos

- Un sitio de Jira Cloud (`https://tu-dominio.atlassian.net`) y un proyecto donde registrar issues — anota su **clave de proyecto** (p. ej. `OPS`).
- Una cuenta de Jira que pueda crear issues, y un **token de API** para ella desde [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- Un proyecto de OneUptime donde puedas crear workflows.

> ¿Usas **Jira Data Center / Server** (autogestionado)? El proceso es idéntico — usa tu propia URL base y un [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) con una cabecera de autenticación `Bearer` en lugar de autenticación básica. El endpoint `/rest/api/2/issue` acepta una descripción en texto plano, lo que simplifica las plantillas.

## Paso 1 — Guardar tus credenciales de Jira como secreto

Jira Cloud usa **autenticación básica** con tu email y token de API, codificados en base64.

1. Codifica en base64 `email:api_token` una vez. En macOS/Linux:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. En OneUptime, ve a **Workflows → Global Variables → Create**.
3. Nómbrala `JIRA_AUTH`, pega la cadena en base64 como valor y activa **Is Secret**.

Ahora puedes usar `Basic {{variable.JIRA_AUTH}}` como cabecera de autenticación y el token nunca aparece en el workflow ni en sus registros.

## Paso 2 — Construir el workflow

1. Abre **Workflows → Create Workflow**, nómbralo `Incidents → Jira` y abre el **Builder**.
2. Arrastra un disparador **Incident** al lienzo y elige el evento **On Create**. Renómbralo `Incident`.
3. Arrastra un bloque **API** y conecta el disparador a él. Configura:

   - **Method**: `POST`
   - **URL**: `https://tu-dominio.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 usa el Formato de Documento de Atlassian para la descripción):

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   Reemplaza `OPS` con la clave de tu proyecto y `Bug` con un tipo de issue que exista en ese proyecto.

4. **Guarda.** Deja el workflow deshabilitado hasta que lo hayas probado.

## Paso 3 — Probarlo

1. Activa **Enabled** en el workflow.
2. Crea un incidente de prueba en OneUptime (o provócalo desde un monitor).
3. Abre la pestaña **Logs** del workflow. El bloque **API** debería mostrar un estado `201` y un cuerpo de respuesta que contiene la `key` del nuevo issue (por ejemplo `OPS-1234`).
4. Comprueba Jira — el issue está ahí.

Si el bloque API devuelve un error, expándelo en los registros — la respuesta de Jira explica exactamente qué campo rechazó. Consulta [Solución de problemas](#solución-de-problemas).

## Paso 4 — Enlazar el incidente de vuelta al issue (recomendado)

Es útil guardar la clave del issue de Jira en el incidente para que la gente pueda saltar entre ellos.

- La respuesta del bloque API está disponible como `{{CreateIssue.response-body.key}}` (si nombraste el bloque `CreateIssue`).
- Añade un bloque **Update Incident** después y escribe la clave en una etiqueta, un campo personalizado o una nota del incidente.

Esto también hace posible la sincronización bidireccional opcional que se describe a continuación.

## Sincronización bidireccional (opcional)

Para resolver el incidente de OneUptime cuando alguien cierra el issue de Jira, añade un workflow **entrante**:

1. Crea un segundo workflow que comience con un disparador **Webhook** y copia su URL.
2. En Jira, ve a **Project settings → Automation → Create rule**:

   - **Trigger**: _Issue transitioned_ a **Done** (o _Issue resolved_).
   - **Action**: _Send web request_ → método `POST`, URL = la URL del webhook de tu workflow, el cuerpo incluye la clave del issue y el ID del incidente de OneUptime, p. ej.:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. En el workflow, usa un bloque **Find Incident** para localizar el incidente por la clave guardada, luego un bloque **Update Incident** para moverlo a tu estado resuelto.

Si guardaste la clave de Jira en el incidente en el Paso 4, la coincidencia es sencilla. Consulta [Componentes → Componentes de datos de OneUptime](/docs/workflows/components#oneuptime-data-components).

## Personalizar el issue

Algunos ajustes comunes al cuerpo del bloque API:

- **Priority** — añade `"priority": { "name": "High" }` dentro de `fields`. Puedes ramificar sobre `{{Incident.incidentSeverity.name}}` con **Conditions** para mapear las gravedades de OneUptime a las prioridades de Jira.
- **Labels** — añade `"labels": ["oneuptime", "incident"]`.
- **Assignee** — añade `"assignee": { "id": "<accountId>" }` (Jira Cloud usa IDs de cuenta, no nombres de usuario).
- **Custom fields** — añade `"customfield_XXXXX": "..."` usando el ID del campo de tu administrador de Jira.

Para descubrir los nombres exactos de los campos que espera un proyecto, llama al endpoint `GET /rest/api/3/issue/createmeta` de Jira una vez desde tu navegador o con `curl`.

## Solución de problemas

**`401 Unauthorized`.**

- Vuelve a codificar `email:api_token` y actualiza la variable `JIRA_AUTH`. Un salto de línea al final es la causa habitual — usa `printf` (no `echo`) al codificar.
- Confirma que la cuenta propietaria del token de API puede crear issues en el proyecto.

**`400 Bad Request` mencionando un campo.**

- El tipo de issue o un campo requerido es incorrecto. Comprueba el nombre del **tipo de issue** del proyecto y si tiene campos personalizados obligatorios. Usa `createmeta` (arriba) para ver qué es obligatorio.

**`404 Not Found`.**

- Comprueba la URL base y que estés usando `/rest/api/3/issue` (Cloud) o `/rest/api/2/issue` (Server/Data Center).

**La descripción aparece en una sola línea o se ve rara.**

- La v3 requiere el Formato de Documento de Atlassian que se muestra arriba. Si prefieres enviar texto plano, usa el endpoint `/rest/api/2/issue` con `"description": "{{Incident.description}}"` como cadena simple.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — los patrones entrante/saliente y la guía de autenticación.
- [Componente API](/docs/workflows/components#api) — métodos, cabeceras y lectura de la respuesta.
- [Variables](/docs/workflows/variables) — secretos y campos de incidente.
- [PagerDuty](/docs/integrations/pagerduty) y [ServiceNow](/docs/integrations/servicenow) — el mismo patrón saliente para otras herramientas.
