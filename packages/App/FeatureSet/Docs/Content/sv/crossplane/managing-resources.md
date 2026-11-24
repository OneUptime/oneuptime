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

`status.atProvider` visar posten så som OneUptime har den, med dess `id`. Ett fält som du utelämnar och som OneUptime fyller i, till exempel ett standardvärde, kopieras till `spec.forProvider` när posten har skapats, så att nästa kontroll inte hittar något att ändra. Ett fält som OneUptime själv håller uppdaterat, eller som OneUptime också ändrar, kopieras aldrig: se [Fält som OneUptime håller uppdaterade](#fält-som-oneuptime-håller-uppdaterade).

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

Postens sida **Utvecklare → Crossplane** i instrumentpanelen skriver det här manifestet åt dig, med postens ID, och ett som tar över posten med dess fält som de är. `oneuptime <resource> list` listar ID:na för ett slags post med [OneUptimes CLI](/docs/cli/resource-operations#lista-poster). När resursen är redo visar `status.atProvider` posten. För att hantera den från och med då skriver du dess fält i `spec.forProvider` och sätter `managementPolicies` till `["*"]`.

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

Providern kontrollerar varje resurs mot dess post var 10:e minut och återställer allt som någon har ändrat i OneUptime, utom i ett fält som OneUptime också ändrar (se nedan). För att kontrollera oftare ger du providern en körtidskonfiguration med `--poll`:

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

För att låta instrumentpanelen äga ett fält efter att posten har skapats skriver du det i `spec.initProvider` i stället för `spec.forProvider`: posten skapas med det, och providern kopierar det aldrig till `spec.forProvider` eller återställer det. Det fungerar för varje valfritt fält; ett fält som posten behöver, till exempel en monitors `name`, hör hemma i `spec.forProvider`. För att låta instrumentpanelen äga hela posten lämnar du `Update` utanför resursens hanteringspolicyer: `["Observe", "Create", "Delete", "LateInitialize"]`.

### Fält som OneUptime håller uppdaterade

Vissa fält håller OneUptime själv uppdaterade, andra ändrar OneUptime också, och providern låter OneUptimes ändringar vara: den kopierar aldrig de här fälten till `spec.forProvider` och återställer dem aldrig.

- Ett fält som bara OneUptime skriver, till exempel när en telemetrimonitor senast kördes (`telemetryMonitorLastMonitorAt`) eller hur många noder ett Kubernetes-kluster har (`nodeCount`), finns bara i `status.atProvider`.
- Ett fält som en post startar med, till exempel en monitors `currentMonitorStatusId` eller en incidents `currentIncidentStateId`, kan anges för att skapa posten, i `spec.initProvider` eller `spec.forProvider`. Därefter ändrar OneUptime det, så som en monitors kontroller ändrar dess status, och `status.atProvider` visar var det står nu.
- Ett fält som både du och OneUptime ändrar, till exempel en posts `labels`, som etikettregler lägger till etiketter i, ett undantags `isResolved` eller en nätverksenhets `siteId`, som upptäckten flyttar, skriver du själv i `spec.forProvider`. Providern skickar det för att skapa posten, och igen varje gång värdet i manifestet ändras, och låter en ändring som OneUptime gör däremellan vara. En lista som `labels` behåller de element som OneUptime har lagt till, får tillbaka ett element som står i manifestet men som någon har tagit bort, och förlorar ett element som du tar bort ur manifestet.

`kubectl explain` säger det i beskrivningen av varje fält som en post startar med eller som OneUptime också ändrar. En resurs vars `spec.forProvider` en tidigare version av providern fyllde med de här fälten slutar av sig själv att kämpa mot OneUptime, utan att du behöver redigera något.

Providern sparar i resursens annotering `crossplane.oneuptime.com/last-applied` vad ett manifest senast satte i de fält som OneUptime också ändrar. I en lista som en tidigare version av providern fyllde, till exempel `labels`, blir ett element som du tar bort kvar i posten som OneUptimes eget; ett element som står i manifestet efter att du har ändrat listan för första gången är ditt och tas bort ur posten när du tar bort det.

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
