# Crossplane – Overzicht

De Crossplane-provider van OneUptime beheert je OneUptime-project vanuit Kubernetes. Beschrijf monitoren, statuspagina's, bereikbaarheidsbeleid, teams, labels en de andere records van je project als Kubernetes-resources, en Crossplane houdt je project zoals die resources het beschrijven: het maakt aan wat nieuw is, wijzigt wat je bewerkt, maakt ongedaan wat iemand elders heeft gewijzigd en verwijdert wat je weghaalt. Argo CD, Flux en elke andere tool die manifesten toepast, passen ook deze resources toe. De provider werkt met OneUptime Cloud en met een zelf gehoste OneUptime.

:::cards
- [Hoe de provider werkt](#hoe-de-provider-werkt): Resourcetypes, namespaces en de API-sleutel erachter.
- [De provider installeren](#de-provider-installeren): Het pakket, en welke versie je kiest.
- [De provider je API-sleutel geven](#de-provider-je-api-sleutel-geven): Een Secret en een ProviderConfig in je namespace.
- [Je eerste resources aanmaken](#je-eerste-resources-aanmaken): Een monitor, het label dat hij draagt en de statussen die hij instelt.
:::

## Hoe de provider werkt

De provider is een Crossplane-pakket. Eenmaal geïnstalleerd voegt hij aan de API-groep `crossplane.oneuptime.com` een resourcetype toe voor elk soort record van de OneUptime-API: `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` en meer dan 400 andere. Elke resource van deze types leeft in een namespace en staat voor één record van je project. De provider leest en wijzigt het record via de REST API van OneUptime, met een API-sleutel van je project, en schrijft wat hij vindt naar de status van de resource.

De provider wordt release voor release gemaakt uit de [Terraform-provider](/docs/terraform/index): zijn resourcetypes zijn de resources van de Terraform-provider, met dezelfde velden en dezelfde API-verzoeken erachter.

## Voordat je begint

- **Crossplane 2.0 of hoger.** De resources van de provider leven in namespaces, en dat kan pas sinds Crossplane 2. De documentatie van Crossplane zelf laat zien hoe je Crossplane in je cluster installeert.
- **Een API-sleutel van je project.** De [Snelle start](/docs/terraform/quick-start#een-api-sleutel-voor-het-project-aanmaken) van Terraform laat zien hoe je er een aanmaakt in **Projectinstellingen → Geavanceerd → API-sleutels**. De sleutel bepaalt bij welk project de resources horen en wat de provider erin mag wijzigen.
- **Op OneUptime Cloud het Growth-abonnement of hoger.** De API-sleutels van een project werken alleen daarmee.

## De provider installeren

Installeer het pakket met een `Provider`:

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

Wanneer `INSTALLED` en `HEALTHY` allebei `True` tonen, draait de provider. Hetzelfde pakket staat ook op Docker Hub, als `docker.io/oneuptime/provider-oneuptime`.

### Een versie kiezen

De versies van het pakket zijn die van OneUptime: `{{CROSSPLANE_PROVIDER_VERSION}}` is gemaakt uit die release van OneUptime, de release waarop deze pagina draait. Gebruik op OneUptime Cloud de nieuwste versie. Gebruik op een zelf gehoste OneUptime de versie van je OneUptime, zodat de provider dezelfde velden kent als de API van je OneUptime.

### Alleen de resourcetypes activeren die je gebruikt

De Helm-chart van Crossplane activeert standaard elk resourcetype van elke provider (de waarde `provider.defaultActivations`), en voor deze provider zijn dat meer dan 400 custom resource definitions. Om alleen de resourcetypes te activeren die je gebruikt, installeer je Crossplane met `--set provider.defaultActivations={}` en noem je de resourcetypes in een beleid:

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

## De provider je API-sleutel geven

Zet de sleutel in een Secret van de namespace waarin je resources komen te staan, en laat een `ProviderConfig` van die namespace ernaar verwijzen. Als je het Secret met `kubectl` aanmaakt, blijft de sleutel buiten je bestanden:

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

Een `ProviderConfig` leest alleen Secrets van zijn eigen namespace, dus de sleutel van de ene namespace kan niet vanuit een andere worden gebruikt. Elke resource noemt zijn `ProviderConfig` in `spec.providerConfigRef`.

### Een zelf gehoste OneUptime gebruiken

Geef de `ProviderConfig` het adres van je OneUptime als `url`, zonder `/api`:

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

### Eén sleutel delen tussen namespaces

Een `ClusterProviderConfig` leest een Secret uit elke namespace, en resources uit elke namespace mogen ernaar verwijzen. Gebruik er een wanneer één team de sleutel voor het hele cluster beheert:

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

Een resource verwijst ernaar met `kind: ClusterProviderConfig` in zijn `providerConfigRef`. Het Secret bevat alleen de sleutel, of JSON die ook het adres noemt: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. Een `url` in de `ClusterProviderConfig` gaat voor die in de JSON. Een `ClusterProviderConfig` kan de sleutel ook lezen uit een omgevingsvariabele of een bestand in de pod van de provider, met `source: Environment` of `source: Filesystem`.

## Je eerste resources aanmaken

Een monitor voor je homepage die een label draagt en de statussen **Offline** en **Operationeel** van je project instelt.

:::steps
### De statussen observeren die hij instelt

OneUptime heeft de statussen van je project samen met het project gemaakt, dus ze worden geobserveerd in plaats van aangemaakt: de provider leest ze via hun ID's en wijzigt of verwijdert ze nooit. `oneuptime monitor-status list --fields _id,name` toont met de [OneUptime-CLI](/docs/cli/resource-operations#records-tonen) de ID's.

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

### Het label en de monitor aanmaken

De monitor verwijst naar het label en de statussen via hun Kubernetes-namen, en de provider vult hun ID's in:

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

### Ze in OneUptime bekijken

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

Wanneer `SYNCED` en `READY` `True` tonen, staat het record in je project. `EXTERNAL-NAME` is het ID ervan in OneUptime.
:::

## Volgende stappen

- [Resources beheren](/docs/crossplane/managing-resources) behandelt de resourcetypes en hun velden, verwijzingen, het importeren van wat je al hebt, de Secrets die OneUptime maakt, en waar je naar kijkt wanneer een resource niet gereed is.
- De [Volledige handleiding](/docs/terraform/complete-guide) van Terraform beschrijft de resources en hun velden, en de resourcetypes van de provider hebben dezelfde.
