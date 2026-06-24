# Integración con ServiceNow

Abre automáticamente un incidente de [ServiceNow](https://www.servicenow.com) cada vez que se crea un incidente en OneUptime — para que la gestión de servicios y la monitorización estén sincronizadas.

Esta integración es **saliente**: OneUptime llama a la [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html) de ServiceNow. Usa un **[Workflow](/docs/workflows/index)** de OneUptime con un disparador **Incident → On Create** y un **componente API**.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## Prerrequisitos

- Una instancia de ServiceNow (`https://tu-instancia.service-now.com`).
- Un usuario de ServiceNow con los roles `rest_api_explorer` / `itil` (o permisos suficientes para crear registros de `incident`). La autenticación básica con las credenciales de este usuario es el comienzo más sencillo; se recomienda OAuth para producción.
- Un proyecto de OneUptime donde puedas crear workflows.

## Paso 1 — Guardar las credenciales como secreto

La Table API de ServiceNow acepta **autenticación básica**.

1. Codifica en base64 `usuario:contraseña` una vez:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. En OneUptime, ve a **Workflows → Global Variables → Create**, nómbrala `SERVICENOW_AUTH`, pega la cadena en base64 y activa **Is Secret**.

## Paso 2 — Construir el workflow

1. Abre **Workflows → Create Workflow**, nómbralo `Incidents → ServiceNow` y abre el **Builder**.
2. Añade un disparador **Incident** configurado en **On Create**. Renómbralo `Incident`.
3. Añade un bloque **API** conectado al disparador:

   - **Method**: `POST`
   - **URL**: `https://tu-instancia.service-now.com/api/now/table/incident`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**:

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   `correlation_id` mantiene un vínculo con el incidente de OneUptime — útil si más adelante añades un paso de resolución. Los valores de `urgency`/`impact` de ServiceNow usan `1` (alto), `2` (medio), `3` (bajo).

4. **Guarda**, habilita y crea un incidente de prueba. Una respuesta `201 Created` en los registros del workflow devuelve el `sys_id` y el `number` del nuevo registro (por ejemplo `INC0012345`).

## Paso 3 — Resolver al resolver en OneUptime (opcional)

1. Crea un **segundo** workflow con un disparador **Incident → On Update** y un bloque **Conditions** que compruebe que el incidente está resuelto.
2. Para actualizar el registro correcto de ServiceNow necesitas su `sys_id`. Puedes guardarlo en el incidente de OneUptime en el Paso 2 (lee `{{CreateRecord.response-body.result.sys_id}}` y escríbelo en una etiqueta con **Update Incident**), o busca el registro primero con un `GET` en `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}`.
3. Añade un bloque **API**: **Method** `PATCH`, **URL** `https://tu-instancia.service-now.com/api/now/table/incident/<sys_id>`, cuerpo `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = Resuelto en el flujo de trabajo ITIL predeterminado).

## Solución de problemas

- **`401`** — vuelve a codificar `usuario:contraseña` con `printf` (no `echo`, que añade un salto de línea) y actualiza `SERVICENOW_AUTH`.
- **`403`** — el usuario no tiene permisos para escribir en la tabla `incident`; añade el rol `itil`.
- **`400`** — un nombre de campo o valor es incorrecto para las personalizaciones de tu instancia. Comprueba los nombres de campo en **System Definition → Tables → incident**.
- **La instancia rechaza la llamada** — algunas instancias restringen la Table API; confirma que REST está habilitado y que tu IP no está bloqueada por una ACL.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — patrones y la guía de autenticación.
- [Jira](/docs/integrations/jira) — el mismo patrón saliente para Jira.
- [Componente API](/docs/workflows/components#api) — lectura del cuerpo de la respuesta.
