# Managing Resources

This page covers the provider's resources once the first ones are running: how kinds and fields are named, how resources refer to each other, how to bring in what your project already has, the Secrets OneUptime makes, what happens to changes made outside Kubernetes, and what to look at when a resource is not ready. To install the provider and create your first resources, start with the [Crossplane Overview](/docs/crossplane/index).

:::cards
- [Kinds and fields](#kinds-and-fields): The Terraform resources they are made from, and how they are named.
- [Refer to other resources](#refer-to-other-resources): Names instead of IDs, at any depth of a monitor's steps.
- [Import what you already have](#import-what-you-already-have): Observe a record by its ID, then take it over.
- [Troubleshoot a resource](#troubleshoot-a-resource): Its conditions, its events and the provider's logs.
:::

## Kinds and fields

Each resource of the [Terraform provider](/docs/terraform/index) is a kind, named in CamelCase: `oneuptime_status_page` is `StatusPage`, and `oneuptime_on_call_policy` is `OnCallPolicy`. A name that would end in Spec, Status or List gets Definition added, so `oneuptime_monitor_status` is `MonitorStatusDefinition`. Some of the kinds:

| Kind | A record of | Terraform resource |
| --- | --- | --- |
| `Monitor` | A monitor | `oneuptime_monitor` |
| `StatusPage` | A status page | `oneuptime_status_page` |
| `OnCallPolicy` | An on-call policy | `oneuptime_on_call_policy` |
| `Team` | A team | `oneuptime_team` |
| `Label` | A label | `oneuptime_label` |
| `IncidentSeverity` | An incident severity | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | A monitor status | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | A telemetry ingestion key | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` lists every kind your cluster has activated.

A kind's fields are the Terraform resource's arguments, in camelCase, under `spec.forProvider`: `monitoring_interval` is `monitoringInterval`. A field that Terraform writes with `jsonencode()` takes a JSON string. `kubectl explain` describes each field as the Terraform provider does, and the [Terraform Complete Guide](/docs/terraform/complete-guide) shows how they are used:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` shows the record as OneUptime has it, with its `id`. A field you leave out that OneUptime fills in, such as a default, is copied into `spec.forProvider` after the record is created, so that the next check finds nothing to change.

## Refer to other resources

Each field that holds the ID of another record also takes a reference to the resource that stands for it. `<field>Ref` names a resource of the same namespace, and `<field>Selector` picks one by its Kubernetes labels. A list of IDs, such as `labels`, takes `labelsRefs` and `labelsSelector`. The provider waits until the resource referred to exists in OneUptime, then fills in its ID.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

References reach into a monitor's steps too: a criterion's status (`monitorStatusIdRef`), and the severity, owner teams, on-call policies and labels of the incidents and alerts it creates (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`). There is no kind for a person: a field names someone by their user ID, as `ownerUserIds` does, and many kinds take their email address beside it, as `TeamMember` does in `userEmail` ([People and Teams](/docs/terraform/people-and-teams)).

## Import what you already have

A resource that observes a record reads it by its ID and never changes or deletes it. Set the ID as the resource's external name, and `Observe` as its only management policy:

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

The record's ID is in the `import` block its **Developer → Terraform** page writes in the dashboard, and `oneuptime <resource> list` lists the IDs of a kind of record with the [OneUptime CLI](/docs/cli/resource-operations#list-records). Once the resource is ready, `status.atProvider` shows the record. To manage it from then on, write its fields in `spec.forProvider` and set `managementPolicies` to `["*"]`.

## Secrets

### Secrets OneUptime makes

Some records come with a secret that OneUptime makes, such as a telemetry ingestion key's. The provider never puts one in the resource: it writes it to a Secret in the resource's namespace, named by `writeConnectionSecretToRef`, under `attribute.` and the Terraform attribute's name:

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

Deleting the resource deletes the Secret too.

### Secrets you give

A field that holds a secret, such as the passphrase of a monitor step's TLS client key, takes a Secret of the resource's namespace instead of a value: `tlsClientKeyPassphraseSecretRef`, with the Secret's `name` and `key`.

## Changes made outside Kubernetes

The provider checks every resource against its record every 10 minutes and puts back whatever someone changed in OneUptime. To check more often, give the provider a runtime configuration with `--poll`:

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

To let the dashboard own a field after the record is created, write it in `spec.initProvider` instead of `spec.forProvider`: it is used to create the record and never put back. To let the dashboard own the whole record, leave `Update` out of its management policies: `["Observe", "Create", "Delete", "LateInitialize"]`.

## Delete a resource

Deleting a resource deletes its record in OneUptime. To keep the record, leave `Delete` out of the resource's management policies before you delete it: `["Observe", "Create", "Update", "LateInitialize"]`. A resource that only observes never deletes its record.

## Troubleshoot a resource

`kubectl -n team-a get managed` shows each resource's `SYNCED` and `READY`. When one is not `True`, its conditions and events say why, with OneUptime's answer when the API refused a request:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| What it says | What to check |
| --- | --- |
| `cannot read the API key` | The Secret, or the key in it, that the `ProviderConfig` names. |
| `cannot get referenced ProviderConfig` | The resource names a `ProviderConfig` its namespace does not have. Use `kind: ClusterProviderConfig` for one of the cluster. |
| A reference that cannot be resolved | The resource it names is missing from the namespace, or not ready yet. |
| An error from the OneUptime API | The API key's permissions, and the value of the field the error names. |

The provider's logs say more, and more again with `--debug` added to its `args`, as `--poll` is above:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## Verify the package

Each release signs the package with Sigstore's cosign, keyless, as it signs OneUptime's images. To check a package before you install it:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
