# Crossplane – Oversigt

OneUptimes Crossplane-provider administrerer dit OneUptime-projekt fra Kubernetes. Beskriv monitorer, statussider, vagtpolitikker, teams, etiketter og de andre poster i dit projekt som Kubernetes-ressourcer, så sørger Crossplane for, at dit projekt er, som de beskriver det: den opretter det, der er nyt, ændrer det, du redigerer, gendanner det, som nogen har ændret et andet sted, og sletter det, du fjerner. Argo CD, Flux og alle andre værktøjer, der anvender manifester, kan også anvende dem. Den virker med OneUptime Cloud og med en selv-hostet OneUptime.

:::cards
- [Sådan virker provideren](#sådan-virker-provideren): Typer, namespaces og API-nøglen bag dem.
- [Installér provideren](#installér-provideren): Pakken, og hvilken version du skal vælge.
- [Giv den din API-nøgle](#giv-den-din-api-nøgle): En Secret og en ProviderConfig i dit namespace.
- [Opret dine første ressourcer](#opret-dine-første-ressourcer): En monitor, den etiket, den bærer, og de statusser, den sætter.
:::

## Sådan virker provideren

Provideren er en Crossplane-pakke. Når den er installeret, tilføjer den en type til API-gruppen `crossplane.oneuptime.com` for hver slags post i OneUptime-API'et: `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` og over 400 andre. Hver ressource af disse typer ligger i et namespace og står for én post i dit projekt. Provideren læser og ændrer posten via OneUptimes REST API med en API-nøgle til dit projekt og skriver det, den finder, i ressourcens status.

Provideren er lavet ud fra [Terraform-provideren](/docs/terraform/index), udgivelse for udgivelse: dens typer er Terraform-providerens ressourcer, med de samme felter og de samme API-anmodninger bag dem.

## Før du begynder

- **Crossplane 2.0 eller nyere.** Providerens ressourcer ligger i namespaces, noget, der kom med Crossplane 2. Crossplanes egen dokumentation viser, hvordan du installerer Crossplane i din klynge.
- **En API-nøgle til dit projekt.** [Hurtig start til Terraform](/docs/terraform/quick-start#opret-en-api-nøgle-til-projektet) viser, hvordan du opretter en under **Projektindstillinger → Avanceret → API-nøgler**. Nøglen afgør, hvilket projekt ressourcerne hører til, og hvad provideren må ændre i det.
- **På OneUptime Cloud abonnementet Growth eller højere.** Et projekts API-nøgler virker kun på det.

## Installér provideren

Installér pakken med en `Provider`:

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

Når både `INSTALLED` og `HEALTHY` viser `True`, kører provideren. Den samme pakke findes på Docker Hub som `docker.io/oneuptime/provider-oneuptime`.

### Vælg en version

Pakkens versioner følger OneUptimes: `{{CROSSPLANE_PROVIDER_VERSION}}` er lavet ud fra netop den udgivelse af OneUptime, som leverer denne side. På OneUptime Cloud skal du bruge den nyeste. På en selv-hostet OneUptime skal du bruge samme version som din OneUptime, så provideren kender de samme felter som din OneUptimes API.

### Aktivér kun de typer, du bruger

Crossplanes Helm-chart aktiverer som standard alle typer fra alle providere (chartets værdi `provider.defaultActivations`), hvilket for denne provider er over 400 custom resource definitions. For kun at aktivere de typer, du bruger, skal du installere Crossplane med `--set provider.defaultActivations={}` og angive typerne i en aktiveringspolitik:

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

## Giv den din API-nøgle

Læg nøglen i en Secret i det namespace, dine ressourcer skal ligge i, og lad en `ProviderConfig` i samme namespace pege på den. Opretter du denne Secret med `kubectl`, holder du nøglen ude af dine filer:

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

En `ProviderConfig` læser kun Secrets i sit eget namespace, så nøglen i ét namespace kan ikke bruges fra et andet. Hver ressource angiver sin `ProviderConfig` i `spec.providerConfigRef`.

### Brug en selv-hostet OneUptime

Angiv adressen på din OneUptime som `url` i `ProviderConfig`, uden `/api`:

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

### Del én nøgle på tværs af namespaces

En `ClusterProviderConfig` læser en Secret i et hvilket som helst namespace, og ressourcer i alle namespaces kan angive den. Brug en, når ét team tager sig af nøglen for hele klyngen:

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

En ressource angiver den med `kind: ClusterProviderConfig` i sin `providerConfigRef`. Denne Secret indeholder enten kun nøglen eller JSON, der også angiver adressen: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. En `url` i `ClusterProviderConfig` har forrang for adressen i JSON. En `ClusterProviderConfig` kan også læse nøglen fra en miljøvariabel eller en fil i providerens pod med `source: Environment` eller `source: Filesystem`.

## Opret dine første ressourcer

En monitor, der overvåger din forside og har en etiket. Den sætter dit projekts statusser **Offline** og **I drift**.

:::steps
### Observér de statusser, den sætter

OneUptime oprettede dit projekts statusser sammen med projektet, så de observeres i stedet for at blive oprettet: provideren læser dem via deres ID'er og ændrer eller sletter dem aldrig. `oneuptime monitor-status list --fields _id,name` viser ID'erne med [OneUptime-CLI'en](/docs/cli/resource-operations#vis-poster).

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

### Opret etiketten og monitoren

Monitoren angiver etiketten og statusserne ved deres Kubernetes-navne, og provideren udfylder deres ID'er:

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

Når `SYNCED` og `READY` viser `True`, er posten i dit projekt. `EXTERNAL-NAME` er dens ID i OneUptime.
:::

## Næste skridt

- [Administrer ressourcer](/docs/crossplane/managing-resources) forklarer typerne og deres felter, referencer, import af det, du allerede har, de hemmeligheder, OneUptime genererer, og hvad du skal se efter, når en ressource ikke er klar.
- [Komplet vejledning til Terraform](/docs/terraform/complete-guide) beskriver ressourcerne og deres felter, som providerens typer deler.
