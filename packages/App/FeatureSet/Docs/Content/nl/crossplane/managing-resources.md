# Resources beheren

Deze pagina behandelt de resources van de provider zodra de eerste draaien: hoe resourcetypes en velden heten, hoe resources naar elkaar verwijzen, hoe je binnenhaalt wat je project al heeft, de Secrets die OneUptime maakt, wat er gebeurt met wijzigingen buiten Kubernetes, en waar je naar kijkt wanneer een resource niet gereed is. Begin met het [Crossplane-overzicht](/docs/crossplane/index) om de provider te installeren en je eerste resources aan te maken.

:::cards
- [Resourcetypes en velden](#resourcetypes-en-velden): De Terraform-resources waaruit ze gemaakt worden, en hoe ze heten.
- [Naar andere resources verwijzen](#naar-andere-resources-verwijzen): Namen in plaats van ID's, op elke diepte van de stappen van een monitor.
- [Importeren wat je al hebt](#importeren-wat-je-al-hebt): Observeer een record via zijn ID en neem het daarna over.
- [Problemen met een resource oplossen](#problemen-met-een-resource-oplossen): De condities en events ervan, en de logs van de provider.
:::

## Resourcetypes en velden

Elke resource van de [Terraform-provider](/docs/terraform/index) is een resourcetype, met een naam in CamelCase: `oneuptime_status_page` wordt `StatusPage`, en `oneuptime_on_call_policy` wordt `OnCallPolicy`. Een naam die op Spec, Status of List zou eindigen, krijgt Definition erachter, dus `oneuptime_monitor_status` wordt `MonitorStatusDefinition`. Enkele van de resourcetypes:

| Resourcetype | Record | Terraform-resource |
| --- | --- | --- |
| `Monitor` | Een monitor | `oneuptime_monitor` |
| `StatusPage` | Een statuspagina | `oneuptime_status_page` |
| `OnCallPolicy` | Een bereikbaarheidsbeleid | `oneuptime_on_call_policy` |
| `Team` | Een team | `oneuptime_team` |
| `Label` | Een label | `oneuptime_label` |
| `IncidentSeverity` | Een ernstniveau van incidenten | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | Een monitorstatus | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | Een telemetrie-ingestiesleutel | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` toont elk resourcetype dat je cluster heeft geactiveerd.

De velden van een resourcetype zijn de argumenten van de Terraform-resource, in camelCase, onder `spec.forProvider`: `monitoring_interval` wordt `monitoringInterval`. Een veld dat Terraform met `jsonencode()` schrijft, verwacht een JSON-string. `kubectl explain` beschrijft elk veld zoals de Terraform-provider dat doet, en de [Volledige handleiding](/docs/terraform/complete-guide) van Terraform laat zien hoe ze worden gebruikt:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` toont het record zoals OneUptime het heeft, met zijn `id`. Een veld dat je weglaat en dat OneUptime invult, bijvoorbeeld met een standaardwaarde, wordt na het aanmaken van het record naar `spec.forProvider` gekopieerd, zodat de volgende controle niets te wijzigen vindt.

## Naar andere resources verwijzen

Elk veld dat het ID van een ander record bevat, accepteert ook een verwijzing naar de resource die voor dat record staat. `<field>Ref` noemt een resource uit dezelfde namespace, en `<field>Selector` kiest er een op basis van zijn Kubernetes-labels. Een lijst van ID's, zoals `labels`, accepteert `labelsRefs` en `labelsSelector`. De provider wacht tot de resource waarnaar verwezen wordt in OneUptime bestaat, en vult dan het ID ervan in.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

Verwijzingen reiken ook tot in de stappen van een monitor: de status van een criterium (`monitorStatusIdRef`), en het ernstniveau, de eigenaarsteams, het bereikbaarheidsbeleid en de labels van de incidenten en waarschuwingen die het aanmaakt (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`). Er is geen resourcetype voor een persoon: een veld noemt iemand via zijn gebruikers-ID, zoals `ownerUserIds` doet, en veel resourcetypes accepteren daarnaast ook het e-mailadres van die persoon, zoals `TeamMember` in `userEmail` ([Mensen en teams](/docs/terraform/people-and-teams)).

## Importeren wat je al hebt

Een resource die een record observeert, leest het via zijn ID en wijzigt of verwijdert het nooit. Stel het ID in als de externe naam van de resource, en `Observe` als het enige beheerbeleid ervan:

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

Het ID van het record staat in het `import`-blok dat de pagina **Ontwikkelaars → Terraform** van het record in het dashboard schrijft, en `oneuptime <resource> list` toont met de [OneUptime-CLI](/docs/cli/resource-operations#records-tonen) de ID's van een soort record. Zodra de resource gereed is, toont `status.atProvider` het record. Om het vanaf dan te beheren, schrijf je de velden ervan in `spec.forProvider` en zet je `managementPolicies` op `["*"]`.

## Secrets

### Secrets die OneUptime maakt

Sommige records hebben een geheim dat OneUptime maakt, zoals dat van een telemetrie-ingestiesleutel. De provider zet zo'n geheim nooit in de resource: hij schrijft het naar een Secret in de namespace van de resource, genoemd in `writeConnectionSecretToRef`, onder `attribute.` en de naam van het Terraform-attribuut:

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

Als je de resource verwijdert, wordt het Secret ook verwijderd.

### Secrets die je zelf opgeeft

Een veld dat een geheim bevat, zoals de wachtwoordzin van de TLS-clientsleutel van een monitorstap, verwacht in plaats van een waarde een Secret uit de namespace van de resource: `tlsClientKeyPassphraseSecretRef`, met de `name` en `key` van het Secret.

## Wijzigingen buiten Kubernetes

De provider vergelijkt elke 10 minuten elke resource met zijn record en maakt ongedaan wat iemand in OneUptime heeft gewijzigd. Om vaker te controleren, geef je de provider een runtimeconfiguratie met `--poll`:

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

Om het dashboard een veld te laten beheren nadat het record is aangemaakt, schrijf je het in `spec.initProvider` in plaats van `spec.forProvider`: het wordt gebruikt om het record aan te maken en daarna nooit teruggezet. Om het dashboard het hele record te laten beheren, laat je `Update` weg uit het beheerbeleid van de resource: `["Observe", "Create", "Delete", "LateInitialize"]`.

## Een resource verwijderen

Een resource verwijderen verwijdert ook het record ervan in OneUptime. Om het record te houden, laat je `Delete` weg uit het beheerbeleid van de resource voordat je hem verwijdert: `["Observe", "Create", "Update", "LateInitialize"]`. Een resource die alleen observeert, verwijdert zijn record nooit.

## Problemen met een resource oplossen

`kubectl -n team-a get managed` toont `SYNCED` en `READY` van elke resource. Als een van beide bij een resource niet `True` is, vertellen de condities en events van die resource waarom, met het antwoord van OneUptime als de API een verzoek weigerde:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| Melding | Wat je moet controleren |
| --- | --- |
| `cannot read the API key` | Het Secret dat de `ProviderConfig` noemt, of de sleutel daarin. |
| `cannot get referenced ProviderConfig` | De resource noemt een `ProviderConfig` die zijn namespace niet heeft. Gebruik `kind: ClusterProviderConfig` voor een configuratie van het hele cluster. |
| Een verwijzing die niet kan worden opgelost | De resource waarnaar ze verwijst, ontbreekt in de namespace of is nog niet gereed. |
| Een fout van de OneUptime-API | De machtigingen van de API-sleutel, en de waarde van het veld dat de fout noemt. |

De logs van de provider vertellen meer, en nog meer als je `--debug` toevoegt aan zijn `args`, zoals `--poll` hierboven:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## Het pakket verifiëren

Elke release ondertekent het pakket sleutelloos met cosign van Sigstore, net als de images van OneUptime. Om een pakket te controleren voordat je het installeert:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
