# Ressourcen verwalten

Diese Seite behandelt die Ressourcen des Providers, sobald die ersten laufen: wie Ressourcentypen und Felder benannt sind, wie Ressourcen aufeinander verweisen, wie Sie übernehmen, was Ihr Projekt schon hat, die Secrets, die OneUptime erzeugt, was mit Änderungen außerhalb von Kubernetes geschieht und worauf Sie achten sollten, wenn eine Ressource nicht bereit ist. Um den Provider zu installieren und Ihre ersten Ressourcen anzulegen, beginnen Sie mit der [Crossplane-Übersicht](/docs/crossplane/index).

:::cards
- [Ressourcentypen und Felder](#ressourcentypen-und-felder): Die Terraform-Ressourcen, aus denen sie erzeugt werden, und wie sie benannt sind.
- [Auf andere Ressourcen verweisen](#auf-andere-ressourcen-verweisen): Namen statt IDs, in jeder Tiefe der Schritte eines Monitors.
- [Importieren, was Sie schon haben](#importieren-was-sie-schon-haben): Einen Datensatz über seine ID beobachten und ihn dann übernehmen.
- [Probleme mit einer Ressource beheben](#probleme-mit-einer-ressource-beheben): Bedingungen und Ereignisse der Ressource und die Logs des Providers.
:::

## Ressourcentypen und Felder

Jede Ressource des [Terraform-Providers](/docs/terraform/index) ist ein Ressourcentyp, in CamelCase benannt: `oneuptime_status_page` wird zu `StatusPage` und `oneuptime_on_call_policy` zu `OnCallPolicy`. Ein Name, der auf Spec, Status oder List enden würde, bekommt Definition angehängt, also wird `oneuptime_monitor_status` zu `MonitorStatusDefinition`. Einige der Ressourcentypen:

| Ressourcentyp | Datensatz | Terraform-Ressource |
| --- | --- | --- |
| `Monitor` | Ein Monitor | `oneuptime_monitor` |
| `StatusPage` | Eine Statusseite | `oneuptime_status_page` |
| `OnCallPolicy` | Eine Bereitschaftsrichtlinie | `oneuptime_on_call_policy` |
| `Team` | Ein Team | `oneuptime_team` |
| `Label` | Eine Beschriftung | `oneuptime_label` |
| `IncidentSeverity` | Ein Vorfallsschweregrad | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | Ein Monitorstatus | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | Ein Telemetrie-Ingestion-Schlüssel | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` listet jeden Ressourcentyp auf, den Ihr Cluster aktiviert hat.

Die Felder eines Ressourcentyps sind die Argumente der Terraform-Ressource, in camelCase, unter `spec.forProvider`: `monitoring_interval` wird zu `monitoringInterval`. Ein Feld, das Terraform mit `jsonencode()` schreibt, erwartet einen JSON-String. `kubectl explain` beschreibt jedes Feld so, wie der Terraform-Provider es tut, und die [Vollständige Anleitung](/docs/terraform/complete-guide) für Terraform zeigt, wie sie verwendet werden:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` zeigt den Datensatz so, wie OneUptime ihn hat, mit seiner `id`. Ein Feld, das Sie weglassen und das OneUptime ausfüllt, etwa mit einem Standardwert, wird nach dem Anlegen des Datensatzes in `spec.forProvider` übernommen, damit die nächste Prüfung nichts zu ändern findet.

## Auf andere Ressourcen verweisen

Jedes Feld, das die ID eines anderen Datensatzes enthält, akzeptiert auch einen Verweis auf die Ressource, die für diesen Datensatz steht. `<field>Ref` nennt eine Ressource desselben Namespaces, und `<field>Selector` wählt eine über ihre Kubernetes-Labels aus. Eine Liste von IDs, etwa `labels`, akzeptiert `labelsRefs` und `labelsSelector`. Der Provider wartet, bis die Ressource, auf die verwiesen wird, in OneUptime existiert, und trägt dann ihre ID ein.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

Verweise reichen auch in die Schritte eines Monitors hinein: der Status eines Kriteriums (`monitorStatusIdRef`) sowie Schweregrad, Eigentümerteams, Bereitschaftsrichtlinien und Beschriftungen der Vorfälle und Warnungen, die es auslöst (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`). Für Personen gibt es keinen Ressourcentyp: Ein Feld nennt jemanden über seine Benutzer-ID, wie `ownerUserIds`, und viele Ressourcentypen akzeptieren daneben auch die E-Mail-Adresse der Person, wie `TeamMember` in `userEmail` ([Personen und Teams](/docs/terraform/people-and-teams)).

## Importieren, was Sie schon haben

Eine Ressource, die einen Datensatz beobachtet, liest ihn über seine ID und ändert oder löscht ihn nie. Setzen Sie die ID als externen Namen der Ressource und `Observe` als ihre einzige Verwaltungsrichtlinie:

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

Die ID des Datensatzes steht im `import`-Block, den seine Seite **Entwickler → Terraform** im Dashboard schreibt, und `oneuptime <resource> list` listet mit der [OneUptime-CLI](/docs/cli/resource-operations#datensätze-auflisten) die IDs einer Art von Datensatz auf. Sobald die Ressource bereit ist, zeigt `status.atProvider` den Datensatz. Um ihn von da an zu verwalten, schreiben Sie seine Felder in `spec.forProvider` und setzen `managementPolicies` auf `["*"]`.

## Secrets

### Secrets, die OneUptime erzeugt

Manche Datensätze haben ein Geheimnis, das OneUptime erzeugt, etwa das eines Telemetrie-Ingestion-Schlüssels. Der Provider legt es nie in der Ressource ab: Er schreibt es in ein Secret im Namespace der Ressource, das `writeConnectionSecretToRef` benennt, unter `attribute.` und dem Namen des Terraform-Attributs:

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

Wenn Sie die Ressource löschen, wird auch das Secret gelöscht.

### Secrets, die Sie angeben

Ein Feld, das ein Geheimnis enthält, etwa die Passphrase des TLS-Client-Schlüssels eines Monitor-Schritts, erwartet statt eines Werts ein Secret aus dem Namespace der Ressource: `tlsClientKeyPassphraseSecretRef`, mit `name` und `key` des Secrets.

## Änderungen außerhalb von Kubernetes

Der Provider gleicht alle 10 Minuten jede Ressource mit ihrem Datensatz ab und macht rückgängig, was jemand in OneUptime geändert hat. Um häufiger zu prüfen, geben Sie dem Provider eine Laufzeitkonfiguration mit `--poll`:

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

Um ein Feld nach dem Anlegen des Datensatzes dem Dashboard zu überlassen, schreiben Sie es in `spec.initProvider` statt in `spec.forProvider`: Es wird zum Anlegen des Datensatzes verwendet und nie zurückgesetzt. Um den ganzen Datensatz dem Dashboard zu überlassen, lassen Sie `Update` aus den Verwaltungsrichtlinien der Ressource weg: `["Observe", "Create", "Delete", "LateInitialize"]`.

## Eine Ressource löschen

Wenn Sie eine Ressource löschen, wird ihr Datensatz in OneUptime gelöscht. Um den Datensatz zu behalten, lassen Sie `Delete` aus den Verwaltungsrichtlinien der Ressource weg, bevor Sie sie löschen: `["Observe", "Create", "Update", "LateInitialize"]`. Eine Ressource, die nur beobachtet, löscht ihren Datensatz nie.

## Probleme mit einer Ressource beheben

`kubectl -n team-a get managed` zeigt `SYNCED` und `READY` jeder Ressource. Ist bei einer Ressource eines davon nicht `True`, sagen ihre Bedingungen und Ereignisse, warum, samt der Antwort von OneUptime, wenn die API eine Anfrage abgelehnt hat:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| Meldung | Was Sie prüfen sollten |
| --- | --- |
| `cannot read the API key` | Das Secret, das die `ProviderConfig` nennt, oder den Schlüssel darin. |
| `cannot get referenced ProviderConfig` | Die Ressource nennt eine `ProviderConfig`, die es in ihrem Namespace nicht gibt. Verwenden Sie `kind: ClusterProviderConfig` für eine Konfiguration des ganzen Clusters. |
| Ein Verweis, der sich nicht auflösen lässt | Die Ressource, die er nennt, fehlt im Namespace oder ist noch nicht bereit. |
| Ein Fehler der OneUptime-API | Die Berechtigungen des API-Schlüssels und den Wert des Felds, das der Fehler nennt. |

Die Logs des Providers verraten mehr, und noch mehr, wenn Sie `--debug` zu seinen `args` hinzufügen, so wie oben `--poll`:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## Das Paket verifizieren

Jedes Release signiert das Paket schlüssellos mit cosign von Sigstore, so wie es auch die Images von OneUptime signiert. So prüfen Sie ein Paket, bevor Sie es installieren:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
