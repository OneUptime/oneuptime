# Hantera resurser

Den här sidan handlar om providerns resurser när de första är igång: hur typer och fält namnges, hur resurser refererar till varandra, hur du tar in det som ditt projekt redan har, hemligheterna som OneUptime genererar, vad som händer med ändringar som görs utanför Kubernetes och vad du ska titta på när en resurs inte är redo. För att installera providern och skapa dina första resurser börjar du med [Crossplane – Översikt](/docs/crossplane/index).

:::cards
- [Typer och fält](#typer-och-fält): Terraform-resurserna som de byggs från, och hur de namnges.
- [Referera till andra resurser](#referera-till-andra-resurser): Namn i stället för ID:n, hur djupt som helst i en monitors steg.
- [Importera det du redan har](#importera-det-du-redan-har): Observera en post via dess ID och ta sedan över den.
- [Felsök en resurs](#felsök-en-resurs): Dess villkor, dess händelser och providerns loggar.
:::

## Typer och fält

Varje resurs i [Terraform-providern](/docs/terraform/index) är en typ, namngiven i CamelCase: `oneuptime_status_page` är `StatusPage` och `oneuptime_on_call_policy` är `OnCallPolicy`. Ett namn som skulle sluta på Spec, Status eller List får tillägget Definition, så `oneuptime_monitor_status` är `MonitorStatusDefinition`. Några av typerna:

| Typ | Motsvarar | Terraform-resurs |
| --- | --- | --- |
| `Monitor` | En monitor | `oneuptime_monitor` |
| `StatusPage` | En statussida | `oneuptime_status_page` |
| `OnCallPolicy` | En jourpolicy | `oneuptime_on_call_policy` |
| `Team` | Ett team | `oneuptime_team` |
| `Label` | En etikett | `oneuptime_label` |
| `IncidentSeverity` | En allvarlighetsgrad för incidenter | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | En monitorstatus | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | En intagningsnyckel för telemetri | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` listar alla typer som ditt kluster har aktiverat.

En typs fält är Terraform-resursens argument, i camelCase, under `spec.forProvider`: `monitoring_interval` är `monitoringInterval`. Ett fält som Terraform skriver med `jsonencode()` tar en JSON-sträng. `kubectl explain` beskriver varje fält så som Terraform-providern gör, och [Komplett guide för Terraform](/docs/terraform/complete-guide) visar hur de används:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` visar posten så som OneUptime har den, med dess `id`. Ett fält som du utelämnar och som OneUptime fyller i, till exempel ett standardvärde, kopieras till `spec.forProvider` när posten har skapats, så att nästa kontroll inte hittar något att ändra.

## Referera till andra resurser

Varje fält som innehåller ID:t för en annan post tar också en referens till resursen som representerar posten. `<field>Ref` anger en resurs i samma namespace, och `<field>Selector` väljer en efter dess Kubernetes-etiketter. En lista med ID:n, till exempel `labels`, tar `labelsRefs` och `labelsSelector`. Providern väntar tills resursen som det refereras till finns i OneUptime och fyller sedan i dess ID.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

Referenser når också in i en monitors steg: ett kriteriums status (`monitorStatusIdRef`) och allvarlighetsgraden, ägarteamen, jourpolicyerna och etiketterna för de incidenter och larm som det skapar (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`). Det finns ingen typ för en person: ett fält anger en person med användar-ID:t, som `ownerUserIds` gör, och många typer tar e-postadressen bredvid, som `TeamMember` gör i `userEmail` ([Personer och team](/docs/terraform/people-and-teams)).

## Importera det du redan har

En resurs som observerar en post läser den via dess ID och ändrar eller tar aldrig bort den. Ange ID:t som resursens externa namn och `Observe` som dess enda hanteringspolicy:

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

Postens ID står i `import`-blocket som dess sida **Utvecklare → Terraform** skriver i instrumentpanelen, och `oneuptime <resource> list` listar ID:na för ett slags post med [OneUptimes CLI](/docs/cli/resource-operations#lista-poster). När resursen är redo visar `status.atProvider` posten. För att hantera den från och med då skriver du dess fält i `spec.forProvider` och sätter `managementPolicies` till `["*"]`.

## Hemligheter

### Hemligheter som OneUptime genererar

Vissa poster har en hemlighet som OneUptime genererar, till exempel hemligheten i en intagningsnyckel för telemetri. Providern lägger aldrig en sådan i resursen: den skriver den till en Secret i resursens namespace, angiven i `writeConnectionSecretToRef`, under `attribute.` följt av Terraform-attributets namn:

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

När du tar bort resursen tas även denna Secret bort.

### Hemligheter som du anger

Ett fält som innehåller en hemlighet, till exempel lösenfrasen för TLS-klientnyckeln i ett monitorsteg, tar en Secret i resursens namespace i stället för ett värde: `tlsClientKeyPassphraseSecretRef`, med denna Secrets `name` och `key`.

## Ändringar som görs utanför Kubernetes

Providern kontrollerar varje resurs mot dess post var 10:e minut och återställer allt som någon har ändrat i OneUptime. För att kontrollera oftare ger du providern en körtidskonfiguration med `--poll`:

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

För att låta instrumentpanelen äga ett fält efter att posten har skapats skriver du det i `spec.initProvider` i stället för `spec.forProvider`: det används för att skapa posten, och providern återställer det aldrig. För att låta instrumentpanelen äga hela posten lämnar du `Update` utanför resursens hanteringspolicyer: `["Observe", "Create", "Delete", "LateInitialize"]`.

## Ta bort en resurs

När du tar bort en resurs tas dess post i OneUptime bort. För att behålla posten lämnar du `Delete` utanför resursens hanteringspolicyer innan du tar bort den: `["Observe", "Create", "Update", "LateInitialize"]`. En resurs som bara observerar tar aldrig bort sin post.

## Felsök en resurs

`kubectl -n team-a get managed` visar `SYNCED` och `READY` för varje resurs. När någon av dem inte är `True` säger resursens villkor och händelser varför, med OneUptimes svar när API:et har avvisat en begäran:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| Vad som står | Vad du ska kontrollera |
| --- | --- |
| `cannot read the API key` | Den Secret, eller nyckeln i den, som `ProviderConfig` anger. |
| `cannot get referenced ProviderConfig` | Resursen anger en `ProviderConfig` som dess namespace inte har. Använd `kind: ClusterProviderConfig` för en som gäller hela klustret. |
| En referens som inte kan lösas upp | Resursen som den anger saknas i namespacet eller är inte redo än. |
| Ett fel från OneUptimes API | API-nyckelns behörigheter och värdet i fältet som felet nämner. |

Providerns loggar säger mer, och ännu mer med `--debug` tillagt i dess `args`, så som `--poll` är ovan:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## Verifiera paketet

Varje utgåva signerar paketet med Sigstores cosign, nyckellöst, precis som den signerar OneUptimes images. Så kontrollerar du ett paket innan du installerar det:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
