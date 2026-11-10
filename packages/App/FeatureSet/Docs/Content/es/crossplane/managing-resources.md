# Gestionar recursos

Esta página trata de los recursos del proveedor una vez que los primeros están en marcha: cómo se nombran los tipos y los campos, cómo los recursos hacen referencia unos a otros, cómo incorporar lo que su proyecto ya tiene, los Secrets que crea OneUptime, qué pasa con los cambios hechos fuera de Kubernetes y qué revisar cuando un recurso no está listo. Para instalar el proveedor y crear sus primeros recursos, empiece por la [Visión general de Crossplane](/docs/crossplane/index).

:::cards
- [Tipos y campos](#tipos-y-campos): Los recursos de Terraform a partir de los que se generan, y cómo se nombran.
- [Hacer referencia a otros recursos](#hacer-referencia-a-otros-recursos): Nombres en lugar de ID, a cualquier profundidad de los pasos de un monitor.
- [Importar lo que ya tiene](#importar-lo-que-ya-tiene): Observe un registro por su ID y luego pase a gestionarlo.
- [Solucionar problemas de un recurso](#solucionar-problemas-de-un-recurso): Sus condiciones, sus eventos y los logs del proveedor.
:::

## Tipos y campos

Cada recurso del [proveedor de Terraform](/docs/terraform/index) es un tipo, con nombre en CamelCase: `oneuptime_status_page` es `StatusPage`, y `oneuptime_on_call_policy` es `OnCallPolicy`. A un nombre que terminaría en Spec, Status o List se le añade Definition, así que `oneuptime_monitor_status` es `MonitorStatusDefinition`. Algunos de los tipos:

| Tipo | Registro que representa | Recurso de Terraform |
| --- | --- | --- |
| `Monitor` | Un monitor | `oneuptime_monitor` |
| `StatusPage` | Una página de estado | `oneuptime_status_page` |
| `OnCallPolicy` | Una política de guardia | `oneuptime_on_call_policy` |
| `Team` | Un equipo | `oneuptime_team` |
| `Label` | Una etiqueta | `oneuptime_label` |
| `IncidentSeverity` | Una severidad de incidente | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | Un estado de monitor | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | Una clave de ingesta de telemetría | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` muestra todos los tipos que su clúster tiene activados.

Los campos de un tipo son los argumentos del recurso de Terraform, en camelCase, bajo `spec.forProvider`: `monitoring_interval` es `monitoringInterval`. Un campo que Terraform escribe con `jsonencode()` toma una cadena JSON. `kubectl explain` describe cada campo igual que el proveedor de Terraform, y la [Guía completa de Terraform](/docs/terraform/complete-guide) muestra cómo se usan:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` muestra el registro tal como lo tiene OneUptime, con su `id`. Un campo que usted omite y que OneUptime rellena, como un valor predeterminado, se copia en `spec.forProvider` después de crear el registro, para que la siguiente comprobación no encuentre nada que cambiar.

## Hacer referencia a otros recursos

Cada campo que contiene el ID de otro registro acepta también una referencia al recurso que lo representa. `<field>Ref` nombra un recurso del mismo espacio de nombres, y `<field>Selector` elige uno por sus etiquetas de Kubernetes. Una lista de ID, como `labels`, acepta `labelsRefs` y `labelsSelector`. El proveedor espera a que el recurso referenciado exista en OneUptime, y luego rellena su ID.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

Las referencias llegan también a los pasos de un monitor: el estado de un criterio (`monitorStatusIdRef`), y la severidad, los equipos propietarios, las políticas de guardia y las etiquetas de los incidentes y alertas que crea (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`). No hay ningún tipo para una persona: un campo identifica a alguien por su ID de usuario, como hace `ownerUserIds`, y muchos tipos aceptan además su dirección de correo electrónico, como hace `TeamMember` en `userEmail` ([Personas y equipos](/docs/terraform/people-and-teams)).

## Importar lo que ya tiene

Un recurso que observa un registro lo lee por su ID y nunca lo cambia ni lo elimina. Ponga el ID como nombre externo del recurso, y `Observe` como su única política de gestión:

```yaml title="team.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Team
metadata:
  name: sre
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the team's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

El ID del registro está en el bloque `import` que escribe su página **Desarrolladores → Terraform** en el panel, y `oneuptime <resource> list` muestra los ID de un tipo de registro con la [CLI de OneUptime](/docs/cli/resource-operations#listar-registros). Cuando el recurso está listo, `status.atProvider` muestra el registro. Para gestionarlo a partir de entonces, escriba sus campos en `spec.forProvider` y establezca `managementPolicies` en `["*"]`.

## Secrets

### Secrets que crea OneUptime

Algunos registros vienen con un secreto que crea OneUptime, como el de una clave de ingesta de telemetría. El proveedor nunca lo pone en el recurso: lo escribe en un Secret del espacio de nombres del recurso, con el nombre que indica `writeConnectionSecretToRef`, bajo la clave `attribute.` seguida del nombre del atributo de Terraform:

```yaml title="telemetry-key.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: TelemetryIngestionKey
metadata:
  name: collector
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  writeConnectionSecretToRef:
    name: collector-telemetry-key
  forProvider:
    name: Collector
```

```bash
kubectl -n team-a get secret collector-telemetry-key -o jsonpath='{.data.attribute\.secret_key}' | base64 -d
```

Eliminar el recurso elimina también el Secret.

### Secrets que usted proporciona

Un campo que contiene un secreto, como la frase de contraseña de la clave de cliente TLS de un paso de monitor, acepta un Secret del espacio de nombres del recurso en lugar de un valor: `tlsClientKeyPassphraseSecretRef`, con el `name` y la `key` del Secret.

## Cambios hechos fuera de Kubernetes

El proveedor compara cada recurso con su registro cada 10 minutos y revierte lo que alguien haya cambiado en OneUptime. Para comprobarlo con más frecuencia, dé al proveedor una configuración de ejecución con `--poll`:

```yaml title="runtime-config.yaml"
apiVersion: pkg.crossplane.io/v1beta1
kind: DeploymentRuntimeConfig
metadata:
  name: oneuptime
spec:
  deploymentTemplate:
    spec:
      selector: {}
      template:
        spec:
          containers:
            - name: package-runtime
              args:
                - --poll=1m
---
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
  runtimeConfigRef:
    name: oneuptime
```

Para que el panel controle un campo una vez creado el registro, escríbalo en `spec.initProvider` en lugar de en `spec.forProvider`: se usa para crear el registro, y el proveedor nunca lo restablece. Para que el panel controle todo el registro, deje `Update` fuera de sus políticas de gestión: `["Observe", "Create", "Delete", "LateInitialize"]`.

## Eliminar un recurso

Eliminar un recurso elimina su registro en OneUptime. Para conservar el registro, deje `Delete` fuera de las políticas de gestión del recurso antes de eliminarlo: `["Observe", "Create", "Update", "LateInitialize"]`. Un recurso que solo observa nunca elimina su registro.

## Solucionar problemas de un recurso

`kubectl -n team-a get managed` muestra las columnas `SYNCED` y `READY` de cada recurso. Cuando alguna no es `True`, las condiciones y los eventos del recurso indican el motivo, con la respuesta de OneUptime cuando la API rechazó una solicitud:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| Qué dice | Qué comprobar |
| --- | --- |
| `cannot read the API key` | El Secret, o la clave dentro de él, que indica el `ProviderConfig`. |
| `cannot get referenced ProviderConfig` | El recurso indica un `ProviderConfig` que su espacio de nombres no tiene. Use `kind: ClusterProviderConfig` para uno del clúster. |
| Una referencia que no se puede resolver | El recurso al que apunta no está en el espacio de nombres, o aún no está listo. |
| Un error de la API de OneUptime | Los permisos de la clave de API, y el valor del campo que nombra el error. |

Los logs del proveedor dan más detalles, y aún más con `--debug` añadido a sus `args`, igual que `--poll` más arriba:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## Verificar el paquete

En cada versión, el paquete se firma sin clave (keyless) con cosign de Sigstore, igual que las imágenes de OneUptime. Para comprobar un paquete antes de instalarlo:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
