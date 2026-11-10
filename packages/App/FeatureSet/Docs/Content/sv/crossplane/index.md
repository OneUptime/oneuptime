# Crossplane – Översikt

OneUptimes Crossplane-provider hanterar ditt OneUptime-projekt från Kubernetes. Beskriv monitorer, statussidor, jourpolicyer, team, etiketter och projektets övriga poster som Kubernetes-resurser, så ser Crossplane till att ditt projekt är som de beskriver: den skapar det som är nytt, ändrar det du redigerar, återställer det som någon har ändrat någon annanstans och raderar det du tar bort. Argo CD, Flux och alla andra verktyg som tillämpar manifest kan också tillämpa dem. Den fungerar med OneUptime Cloud och med ett självhostat OneUptime.

:::cards
- [Så fungerar providern](#så-fungerar-providern): Typer, namespaces och API-nyckeln bakom dem.
- [Installera providern](#installera-providern): Paketet, och vilken version du ska välja.
- [Ge den din API-nyckel](#ge-den-din-api-nyckel): En Secret och en ProviderConfig i ditt namespace.
- [Skapa dina första resurser](#skapa-dina-första-resurser): En monitor, etiketten den bär och statusarna den sätter.
:::

## Så fungerar providern

Providern är ett Crossplane-paket. När den är installerad lägger den till en typ i API-gruppen `crossplane.oneuptime.com` för varje slags post i OneUptimes API: `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` och över 400 till. Varje resurs av de här typerna finns i ett namespace och representerar en post i ditt projekt. Providern läser och ändrar posten via OneUptimes REST API, med en API-nyckel till ditt projekt, och skriver det den hittar i resursens status.

Providern byggs från [Terraform-providern](/docs/terraform/index), utgåva för utgåva: dess typer är Terraform-providerns resurser, med samma fält och samma API-begäranden bakom dem.

## Innan du börjar

- **Crossplane 2.0 eller senare.** Providerns resurser finns i namespaces, något som kom med Crossplane 2. Crossplanes egen dokumentation visar hur du installerar Crossplane i ditt kluster.
- **En API-nyckel till ditt projekt.** [Snabbstart för Terraform](/docs/terraform/quick-start#skapa-en-api-nyckel-till-projektet) visar hur du skapar en under **Projektinställningar → Avancerad → API-nycklar**. Nyckeln avgör vilket projekt resurserna hör till och vad providern får ändra i det.
- **På OneUptime Cloud abonnemanget Growth eller högre.** Ett projekts API-nycklar fungerar bara på det.

## Installera providern

Installera paketet med en `Provider`:

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

När både `INSTALLED` och `HEALTHY` visar `True` körs providern. Samma paket finns på Docker Hub som `docker.io/oneuptime/provider-oneuptime`.

### Välj en version

Paketets versioner följer OneUptimes: `{{CROSSPLANE_PROVIDER_VERSION}}` byggs från just den utgåva av OneUptime som levererar den här sidan. På OneUptime Cloud använder du den senaste. På ett självhostat OneUptime använder du samma version som ditt OneUptime, så att providern känner till samma fält som ditt OneUptimes API.

### Aktivera bara de typer du använder

Crossplanes Helm-chart aktiverar som standard alla typer hos alla providrar (chartets värde `provider.defaultActivations`), vilket för den här providern är över 400 custom resource definitions. För att bara aktivera de typer du använder installerar du Crossplane med `--set provider.defaultActivations={}` och anger typerna i en aktiveringspolicy:

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

## Ge den din API-nyckel

Lägg nyckeln i en Secret i det namespace där dina resurser ska finnas, och låt en `ProviderConfig` i samma namespace peka på den. Skapar du denna Secret med `kubectl` hålls nyckeln utanför dina filer:

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

En `ProviderConfig` läser bara Secrets i sitt eget namespace, så nyckeln i ett namespace kan inte användas från ett annat. Varje resurs anger sin `ProviderConfig` i `spec.providerConfigRef`.

### Använd ett självhostat OneUptime

Ange adressen till ditt OneUptime som `url` i `ProviderConfig`, utan `/api`:

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

### Dela en nyckel mellan namespaces

En `ClusterProviderConfig` läser en Secret i vilket namespace som helst, och resurser i alla namespaces får ange den. Använd en när ett enda team tar hand om nyckeln för hela klustret:

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

En resurs anger den med `kind: ClusterProviderConfig` i sin `providerConfigRef`. Denna Secret innehåller bara nyckeln, eller JSON som även anger adressen: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. En `url` i `ClusterProviderConfig` har företräde framför adressen i JSON. En `ClusterProviderConfig` kan också läsa nyckeln från en miljövariabel eller en fil i providerns podd, med `source: Environment` eller `source: Filesystem`.

## Skapa dina första resurser

En monitor som övervakar din startsida och har en etikett. Den sätter ditt projekts statusar **Offline** och **Fungerar**.

:::steps
### Observera statusarna den sätter

OneUptime skapade ditt projekts statusar tillsammans med projektet, så de observeras i stället för att skapas: providern läser dem via deras ID:n och ändrar eller tar aldrig bort dem. `oneuptime monitor-status list --fields _id,name` listar ID:na med [OneUptimes CLI](/docs/cli/resource-operations#lista-poster).

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

### Skapa etiketten och monitorn

Monitorn anger etiketten och statusarna med deras Kubernetes-namn, och providern fyller i deras ID:n:

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

### Se dem i OneUptime

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

När `SYNCED` och `READY` visar `True` finns posten i ditt projekt. `EXTERNAL-NAME` är dess ID i OneUptime.
:::

## Nästa steg

- [Hantera resurser](/docs/crossplane/managing-resources) förklarar typerna och deras fält, referenser, import av det du redan har, hemligheterna som OneUptime genererar och vad du ska titta på när en resurs inte är redo.
- [Komplett guide för Terraform](/docs/terraform/complete-guide) beskriver resurserna och deras fält, som providerns typer delar.
