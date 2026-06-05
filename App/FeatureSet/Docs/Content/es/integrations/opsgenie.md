# Integración con Opsgenie

Crea una alerta de [Opsgenie](https://www.atlassian.com/software/opsgenie) cada vez que se crea un incidente en OneUptime, y ciérrala cuando OneUptime lo resuelva.

Esta integración es **saliente**: OneUptime llama a la [API de alertas de Opsgenie](https://docs.opsgenie.com/docs/alert-api). Usa un **[Workflow](/docs/workflows/index)** de OneUptime con un disparador **Incident → On Create** y un **componente API**.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## Prerrequisitos

- Una **clave de API** de Opsgenie de una integración de tipo API: **Settings → Integrations → Add → API**. Copia la clave.
- Conoce tu región. El host de API predeterminado es `https://api.opsgenie.com`; las cuentas de la UE usan `https://api.eu.opsgenie.com`.
- Un proyecto de OneUptime donde puedas crear workflows.

## Paso 1 — Guardar la clave de API

1. Ve a **Workflows → Global Variables → Create**.
2. Nómbrala `OPSGENIE_KEY`, pega la clave de API y activa **Is Secret**.

## Paso 2 — Construir el workflow de "crear alerta"

1. Abre **Workflows → Create Workflow**, nómbralo `Incidents → Opsgenie` y abre el **Builder**.
2. Añade un disparador **Incident** configurado en **On Create**. Renómbralo `Incident`.
3. Añade un bloque **API** conectado al disparador:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts`  *(usa `api.eu.opsgenie.com` para la UE)*
   - **Headers**:

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   El **`alias`** vincula esta alerta de Opsgenie al incidente de OneUptime para poder cerrarla más adelante por alias. Ten en cuenta que el esquema de autenticación de Opsgenie es la palabra literal `GenieKey` seguida de un espacio y tu clave.
4. **Guarda**, habilita y crea un incidente de prueba. Una respuesta `202 Accepted` en los registros del workflow significa que Opsgenie ha encolado la alerta.

## Paso 3 — Cerrar al resolver en OneUptime (recomendado)

1. Crea un **segundo** workflow llamado `Close Opsgenie` con un disparador **Incident → On Update**.
2. Añade un bloque **Conditions** que compruebe que el incidente ya está resuelto (ramifica sobre `{{Incident.currentIncidentState.name}}`).
3. Desde **Yes**, añade un bloque **API**:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**: el mismo `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**: `{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie busca la alerta por alias y la cierra.

## Mapeo de prioridades (opcional)

Las prioridades de Opsgenie van de `P1` a `P5`. Mapéalas desde las gravedades de OneUptime con ramas **Conditions** sobre `{{Incident.incidentSeverity.name}}` antes del bloque API.

## Solución de problemas

- **`401`/`403`** — clave incorrecta, host de región equivocado, o la integración no tiene permiso para crear alertas. Confirma que estás usando una clave de integración **API** y el host `api`/`api.eu` correspondiente.
- **El cierre devuelve `404`** — el `alias` en la llamada de cierre debe coincidir exactamente con el de la llamada de creación, y `identifierType=alias` debe estar en la cadena de consulta.
- **No ocurre nada** — confirma que el workflow está **Enabled**.

## Dónde seguir leyendo

- [Resumen de Integraciones](/docs/integrations/index) — patrones y la guía de autenticación.
- [PagerDuty](/docs/integrations/pagerduty) — la misma idea para PagerDuty.
- [On Call](/docs/on-call/incoming-call-policy) — la escalación integrada de OneUptime.
