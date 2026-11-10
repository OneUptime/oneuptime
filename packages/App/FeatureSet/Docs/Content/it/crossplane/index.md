# Panoramica di Crossplane

Il provider Crossplane di OneUptime gestisce il tuo progetto OneUptime da Kubernetes. Dichiara monitor, pagine di stato, politiche di reperibilità, team, etichette e gli altri record del progetto come risorse Kubernetes, e Crossplane mantiene il progetto così come lo descrivono le risorse: crea ciò che è nuovo, aggiorna ciò che modifichi, ripristina ciò che qualcuno ha cambiato altrove ed elimina ciò che rimuovi. Anche Argo CD, Flux e qualsiasi altro strumento che applica manifest possono applicarle. Il provider funziona con OneUptime Cloud e con un'istanza OneUptime self-hosted.

:::cards
- [Come funziona il provider](#come-funziona-il-provider): I kind, i namespace e la chiave API che c'è dietro.
- [Installare il provider](#installare-il-provider): Il pacchetto e la versione da scegliere.
- [Dare al provider la chiave API](#dare-al-provider-la-chiave-api): Un Secret e un ProviderConfig nel tuo namespace.
- [Creare le prime risorse](#creare-le-prime-risorse): Un monitor, l'etichetta che porta e gli stati che imposta.
:::

## Come funziona il provider

Il provider è un pacchetto Crossplane. Una volta installato, aggiunge al gruppo API `crossplane.oneuptime.com` un kind per ogni tipo di record dell'API di OneUptime: `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` e oltre 400 altri. Ogni risorsa di questi kind vive in un namespace e rappresenta un record del tuo progetto. Il provider legge e modifica il record tramite l'API REST di OneUptime, con una chiave API del tuo progetto, e scrive ciò che trova nello stato della risorsa.

Il provider è generato dal [provider Terraform](/docs/terraform/index), release dopo release: i suoi kind sono le risorse del provider Terraform, con gli stessi campi e le stesse richieste all'API che ci sono dietro.

## Prima di iniziare

- **Crossplane 2.0 o successivo.** Le risorse del provider vivono nei namespace, una novità di Crossplane 2. La documentazione di Crossplane mostra come installarlo nel tuo cluster.
- **Una chiave API del tuo progetto.** L'[Avvio rapido](/docs/terraform/quick-start#creare-una-chiave-api-del-progetto) di Terraform mostra come crearne una in **Impostazioni del progetto → Avanzato → Chiavi API**. La chiave decide a quale progetto appartengono le risorse e cosa il provider può modificare al suo interno.
- **Su OneUptime Cloud, il piano Growth o superiore.** Le chiavi API di un progetto funzionano solo con quello.

## Installare il provider

Installa il pacchetto con un `Provider`:

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

Quando `INSTALLED` e `HEALTHY` indicano entrambi `True`, il provider è in esecuzione. Lo stesso pacchetto è disponibile anche su Docker Hub, con il nome `docker.io/oneuptime/provider-oneuptime`.

### Scegliere una versione

Le versioni del pacchetto sono quelle di OneUptime: `{{CROSSPLANE_PROVIDER_VERSION}}` è generato da quella release di OneUptime, la stessa che serve questa pagina. Su OneUptime Cloud, usa la più recente. Su un'istanza OneUptime self-hosted, usa la versione della tua istanza, così il provider conosce gli stessi campi dell'API della tua istanza.

### Attivare solo i kind che usi

Il chart Helm di Crossplane attiva per impostazione predefinita ogni kind di ogni provider (il suo valore `provider.defaultActivations`), che per questo provider significa oltre 400 definizioni di risorse personalizzate. Per attivare solo i kind che usi, installa Crossplane con `--set provider.defaultActivations={}` ed elenca i kind in una politica:

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

## Dare al provider la chiave API

Metti la chiave in un Secret del namespace in cui vivranno le tue risorse, e fai puntare a quel Secret un `ProviderConfig` dello stesso namespace. Creando il Secret con `kubectl`, la chiave resta fuori dai tuoi file:

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

Un `ProviderConfig` legge solo i Secret del proprio namespace, quindi la chiave di un namespace non può essere usata da un altro. Ogni risorsa indica il proprio `ProviderConfig` in `spec.providerConfigRef`.

### Usare un'istanza OneUptime self-hosted

Indica nel `ProviderConfig` l'indirizzo della tua istanza OneUptime come `url`, senza `/api`:

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

### Condividere una chiave tra più namespace

Un `ClusterProviderConfig` legge un Secret di qualsiasi namespace, e le risorse di ogni namespace possono indicarlo. Usalo quando un solo team si occupa della chiave per l'intero cluster:

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

Una risorsa lo indica con `kind: ClusterProviderConfig` nel suo `providerConfigRef`. Il Secret contiene solo la chiave, oppure un JSON che indica anche l'indirizzo: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. Un `url` nel `ClusterProviderConfig` ha la precedenza su quello del JSON. Un `ClusterProviderConfig` può anche leggere la chiave da una variabile d'ambiente o da un file del pod del provider, con `source: Environment` o `source: Filesystem`.

## Creare le prime risorse

Un monitor della tua homepage, con un'etichetta, che imposta gli stati **Offline** e **Operativo** del tuo progetto.

:::steps
### Osservare gli stati che imposta

OneUptime ha creato gli stati del tuo progetto insieme al progetto, quindi vengono osservati anziché creati: il provider li legge tramite i loro ID e non li modifica né li elimina mai. `oneuptime monitor-status list --fields _id,name` elenca gli ID, con la [CLI di OneUptime](/docs/cli/resource-operations#elencare-i-record).

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

### Creare l'etichetta e il monitor

Il monitor fa riferimento all'etichetta e agli stati con i loro nomi Kubernetes, e il provider ne inserisce gli ID:

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

### Vederli in OneUptime

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

Quando `SYNCED` e `READY` indicano `True`, il record è nel tuo progetto. `EXTERNAL-NAME` è il suo ID in OneUptime.
:::

## Prossimi passi

- [Gestire le risorse](/docs/crossplane/managing-resources) spiega i kind e i loro campi, i riferimenti, come importare ciò che hai già, i segreti che OneUptime genera e cosa controllare quando una risorsa non è pronta.
- La [Guida completa di Terraform](/docs/terraform/complete-guide) descrive le risorse e i loro campi, che i kind del provider condividono.
