# Crossplane – Übersicht

Der Crossplane-Provider von OneUptime verwaltet Ihr OneUptime-Projekt aus Kubernetes heraus. Beschreiben Sie Monitore, Statusseiten, Bereitschaftsrichtlinien, Teams, Beschriftungen und die anderen Datensätze Ihres Projekts als Kubernetes-Ressourcen, und Crossplane hält Ihr Projekt in dem Zustand, den diese Ressourcen beschreiben: Es legt an, was neu ist, ändert, was Sie bearbeiten, macht rückgängig, was jemand anderswo geändert hat, und löscht, was Sie entfernen. Argo CD, Flux und jedes andere Werkzeug, das Manifeste anwendet, wenden auch diese Ressourcen an. Der Provider funktioniert mit OneUptime Cloud und mit einer selbst gehosteten OneUptime-Instanz.

:::cards
- [Wie der Provider arbeitet](#wie-der-provider-arbeitet): Ressourcentypen, Namespaces und der API-Schlüssel dahinter.
- [Den Provider installieren](#den-provider-installieren): Das Paket und die Version, die Sie wählen.
- [Dem Provider Ihren API-Schlüssel geben](#dem-provider-ihren-api-schlüssel-geben): Ein Secret und eine ProviderConfig in Ihrem Namespace.
- [Ihre ersten Ressourcen anlegen](#ihre-ersten-ressourcen-anlegen): Ein Monitor, die Beschriftung, die er trägt, und die Status, die er setzt.
:::

## Wie der Provider arbeitet

Der Provider ist ein Crossplane-Paket. Einmal installiert, fügt er der API-Gruppe `crossplane.oneuptime.com` für jede Art von Datensatz der OneUptime-API einen Ressourcentyp hinzu: `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` und über 400 weitere. Jede Ressource dieser Typen befindet sich in einem Namespace und steht für einen Datensatz Ihres Projekts. Der Provider liest und ändert den Datensatz über die REST API von OneUptime, mit einem API-Schlüssel Ihres Projekts, und schreibt, was er vorfindet, in den Status der Ressource.

Der Provider wird Release für Release aus dem [Terraform-Provider](/docs/terraform/index) erzeugt: Seine Ressourcentypen sind die Ressourcen des Terraform-Providers, mit denselben Feldern und denselben API-Anfragen dahinter.

## Bevor Sie beginnen

- **Crossplane 2.0 oder neuer.** Die Ressourcen des Providers befinden sich in Namespaces, was erst mit Crossplane 2 möglich wurde. Wie Sie Crossplane in Ihrem Cluster installieren, zeigt die Dokumentation von Crossplane selbst.
- **Ein API-Schlüssel Ihres Projekts.** Der [Schnellstart](/docs/terraform/quick-start#einen-api-schlüssel-des-projekts-anlegen) für Terraform zeigt, wie Sie einen unter **Projekteinstellungen → Erweitert → API-Schlüssel** anlegen. Der Schlüssel entscheidet, zu welchem Projekt die Ressourcen gehören und was der Provider darin ändern darf.
- **In OneUptime Cloud der Tarif Growth oder höher.** Die API-Schlüssel eines Projekts funktionieren nur dort.

## Den Provider installieren

Installieren Sie das Paket mit einem `Provider`:

```yaml title="provider.yaml"
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
```

```bash
kubectl apply -f provider.yaml
kubectl get providers.pkg.crossplane.io provider-oneuptime
```

Wenn `INSTALLED` und `HEALTHY` beide `True` anzeigen, läuft der Provider. Dasselbe Paket gibt es auch auf Docker Hub, als `docker.io/oneuptime/provider-oneuptime`.

### Eine Version wählen

Die Versionen des Pakets sind die von OneUptime: `{{CROSSPLANE_PROVIDER_VERSION}}` wird aus diesem Release von OneUptime erzeugt, dem Release, das diese Seite ausliefert. Verwenden Sie bei OneUptime Cloud die neueste Version. Verwenden Sie bei einer selbst gehosteten OneUptime-Instanz die Version Ihrer Instanz, damit der Provider dieselben Felder kennt wie die API Ihrer Instanz.

### Nur die Ressourcentypen aktivieren, die Sie verwenden

Das Helm-Chart von Crossplane aktiviert standardmäßig jeden Ressourcentyp jedes Providers (sein Wert `provider.defaultActivations`), was bei diesem Provider über 400 Custom Resource Definitions sind. Um nur die Ressourcentypen zu aktivieren, die Sie verwenden, installieren Sie Crossplane mit `--set provider.defaultActivations={}` und nennen die Ressourcentypen in einer Richtlinie:

```yaml title="activation-policy.yaml"
apiVersion: apiextensions.crossplane.io/v1alpha1
kind: ManagedResourceActivationPolicy
metadata:
  name: oneuptime
spec:
  activate:
    - monitors.crossplane.oneuptime.com
    - monitorstatusdefinitions.crossplane.oneuptime.com
    - labels.crossplane.oneuptime.com
    - statuspages.crossplane.oneuptime.com
```

## Dem Provider Ihren API-Schlüssel geben

Legen Sie den Schlüssel in einem Secret des Namespaces ab, in dem sich Ihre Ressourcen befinden werden, und lassen Sie eine `ProviderConfig` dieses Namespaces darauf verweisen. Wenn Sie das Secret mit `kubectl` anlegen, bleibt der Schlüssel aus Ihren Dateien heraus:

```bash
kubectl create namespace team-a
kubectl -n team-a create secret generic oneuptime --from-literal=api-key="<your-api-key>"
```

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

Eine `ProviderConfig` liest nur Secrets ihres eigenen Namespaces, sodass der Schlüssel eines Namespaces nicht aus einem anderen heraus verwendet werden kann. Jede Ressource nennt ihre `ProviderConfig` in `spec.providerConfigRef`.

### Eine selbst gehostete OneUptime-Instanz verwenden

Geben Sie der `ProviderConfig` die Adresse Ihrer OneUptime-Instanz als `url`, ohne `/api`:

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  url: https://oneuptime.example.com
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

### Einen Schlüssel über Namespaces hinweg teilen

Eine `ClusterProviderConfig` liest ein Secret aus einem beliebigen Namespace, und Ressourcen aus jedem Namespace dürfen auf sie verweisen. Verwenden Sie eine, wenn ein einzelnes Team den Schlüssel für den ganzen Cluster betreut:

```yaml title="cluster-provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ClusterProviderConfig
metadata:
  name: oneuptime
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: oneuptime
      key: credentials
```

Eine Ressource verweist mit `kind: ClusterProviderConfig` in ihrem Feld `providerConfigRef` auf sie. Das Secret enthält nur den Schlüssel oder JSON, das auch die Adresse nennt: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. Eine `url` in der `ClusterProviderConfig` hat Vorrang vor der im JSON. Eine `ClusterProviderConfig` kann den Schlüssel auch aus einer Umgebungsvariablen oder einer Datei im Pod des Providers lesen, mit `source: Environment` oder `source: Filesystem`.

## Ihre ersten Ressourcen anlegen

Ein Monitor für Ihre Startseite, der eine Beschriftung trägt und die Status **Offline** und **Betriebsbereit** Ihres Projekts setzt.

:::steps
### Die Status beobachten, die er setzt

OneUptime hat die Status Ihres Projekts zusammen mit dem Projekt erstellt, daher werden sie beobachtet statt angelegt: Der Provider liest sie über ihre IDs und ändert oder löscht sie nie. `oneuptime monitor-status list --fields _id,name` listet mit der [OneUptime-CLI](/docs/cli/resource-operations#datensätze-auflisten) die IDs auf.

```yaml title="statuses.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: offline
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Offline status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: operational
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Operational status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

### Die Beschriftung und den Monitor anlegen

Der Monitor nennt die Beschriftung und die Status bei ihren Kubernetes-Namen, und der Provider trägt ihre IDs ein:

```yaml title="homepage.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Label
metadata:
  name: production
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Production
    color: "#16a34a"
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Monitor
metadata:
  name: homepage
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Homepage
    description: Checks that the homepage responds
    monitorType: Website
    monitoringInterval: "*/5 * * * *"
    labelsRefs:
      - name: production
    monitorSteps:
      - monitorDestination: https://example.com
        monitorDestinationType: URL
        requestType: GET
        criteria:
          - name: Offline
            description: The homepage does not respond
            filterCondition: Any
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: offline
            filters:
              - checkOn: Is Online
                filterType: "False"
          - name: Online
            description: The homepage responds
            filterCondition: All
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: operational
            filters:
              - checkOn: Is Online
                filterType: "True"
```

### In OneUptime nachsehen

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

Wenn `SYNCED` und `READY` `True` anzeigen, ist der Datensatz in Ihrem Projekt. `EXTERNAL-NAME` ist seine ID in OneUptime.
:::

## Nächste Schritte

- [Ressourcen verwalten](/docs/crossplane/managing-resources) erklärt die Ressourcentypen und ihre Felder, Verweise, den Import dessen, was Sie schon haben, die Secrets, die OneUptime erzeugt, und worauf Sie achten sollten, wenn eine Ressource nicht bereit ist.
- Die [Vollständige Anleitung](/docs/terraform/complete-guide) für Terraform beschreibt die Ressourcen und ihre Felder, und die Ressourcentypen des Providers haben dieselben.
