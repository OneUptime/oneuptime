# Vue d'ensemble de Crossplane

Le fournisseur Crossplane de OneUptime gère votre projet OneUptime depuis Kubernetes. Déclarez les moniteurs, les pages de statut, les politiques d'astreinte, les équipes, les étiquettes et les autres enregistrements de votre projet sous forme de ressources Kubernetes, et Crossplane maintient votre projet conforme à ce qu'elles décrivent : il crée ce qui est nouveau, modifie ce que vous changez, rétablit ce que quelqu'un a changé ailleurs, et supprime ce que vous retirez. Argo CD, Flux et tout autre outil qui applique des manifestes les appliquent aussi. Il fonctionne avec OneUptime Cloud et avec une instance OneUptime auto-hébergée.

:::cards
- [Comment fonctionne le fournisseur](#comment-fonctionne-le-fournisseur): Les types de ressources, les namespaces, et la clé API derrière eux.
- [Installer le fournisseur](#installer-le-fournisseur): Le paquet, et la version à choisir.
- [Donner votre clé API au fournisseur](#donner-votre-clé-api-au-fournisseur): Un Secret et un ProviderConfig dans votre namespace.
- [Créer vos premières ressources](#créer-vos-premières-ressources): Un moniteur, l'étiquette qu'il porte et les statuts qu'il définit.
:::

## Comment fonctionne le fournisseur

Le fournisseur est un paquet Crossplane. Une fois installé, il ajoute au groupe d'API `crossplane.oneuptime.com` un type de ressource pour chaque type d'enregistrement de l'API de OneUptime : `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` et plus de 400 autres. Chaque ressource de ces types vit dans un namespace et représente un enregistrement de votre projet. Le fournisseur lit et modifie l'enregistrement par l'API REST de OneUptime, avec une clé API de votre projet, et écrit ce qu'il trouve dans le statut de la ressource.

Le fournisseur est généré à partir du [fournisseur Terraform](/docs/terraform/index), version après version : chacun de ses types de ressources est une ressource du fournisseur Terraform, avec les mêmes champs et, en coulisse, les mêmes requêtes à l'API.

## Avant de commencer

- **Crossplane 2.0 ou plus récent.** Les ressources du fournisseur vivent dans des namespaces, une nouveauté de Crossplane 2. La documentation de Crossplane explique comment l'installer dans votre cluster.
- **Une clé API de votre projet.** Le [Démarrage rapide](/docs/terraform/quick-start#créer-une-clé-api-du-projet) de Terraform montre comment en créer une dans **Paramètres du projet → Avancé → Clés API**. La clé détermine à quel projet appartiennent les ressources et ce que le fournisseur peut y modifier.
- **Sur OneUptime Cloud, l'offre Growth ou supérieure.** Les clés API d'un projet ne fonctionnent qu'avec elle.

## Installer le fournisseur

Installez le paquet avec un `Provider` :

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

Quand `INSTALLED` et `HEALTHY` indiquent tous deux `True`, le fournisseur fonctionne. Le même paquet est disponible sur Docker Hub, sous le nom `docker.io/oneuptime/provider-oneuptime`.

### Choisir une version

Les versions du paquet sont celles de OneUptime : `{{CROSSPLANE_PROVIDER_VERSION}}` est généré à partir de cette version de OneUptime, celle qui sert cette page. Sur OneUptime Cloud, utilisez la plus récente. Sur une instance OneUptime auto-hébergée, utilisez la version de votre instance, pour que le fournisseur connaisse les mêmes champs que l'API de votre instance.

### N'activer que les types de ressources que vous utilisez

Le chart Helm de Crossplane active par défaut chaque type de ressource de chaque fournisseur (sa valeur `provider.defaultActivations`), soit, pour ce fournisseur, plus de 400 définitions de ressources personnalisées. Pour n'activer que les types que vous utilisez, installez Crossplane avec `--set provider.defaultActivations={}` et nommez ces types dans une politique :

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

## Donner votre clé API au fournisseur

Placez la clé dans un Secret du namespace où vivront vos ressources, et faites pointer vers ce Secret un `ProviderConfig` du même namespace. Créer le Secret avec `kubectl` garde la clé hors de vos fichiers :

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

Un `ProviderConfig` ne lit que les Secrets de son propre namespace : la clé d'un namespace ne peut donc pas être utilisée depuis un autre. Chaque ressource nomme son `ProviderConfig` dans `spec.providerConfigRef`.

### Utiliser une instance OneUptime auto-hébergée

Donnez au `ProviderConfig` l'adresse de votre instance OneUptime dans `url`, sans `/api` :

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

### Partager une clé entre namespaces

Un `ClusterProviderConfig` lit un Secret de n'importe quel namespace, et les ressources de tous les namespaces peuvent le nommer. Utilisez-en un quand une seule équipe gère la clé pour tout le cluster :

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

Une ressource le nomme avec `kind: ClusterProviderConfig` dans son `providerConfigRef`. Le Secret contient la clé seule, ou un JSON qui indique aussi l'adresse : `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. Une `url` dans le `ClusterProviderConfig` l'emporte sur celle du JSON. Un `ClusterProviderConfig` peut aussi lire la clé dans une variable d'environnement ou dans un fichier du pod du fournisseur, avec `source: Environment` ou `source: Filesystem`.

## Créer vos premières ressources

Un moniteur de votre page d'accueil, avec une étiquette, qui définit les statuts **Hors ligne** et **Opérationnel** de votre projet.

:::steps
### Observer les statuts qu'il définit

Comme OneUptime a créé les statuts de votre projet en même temps que le projet, ils sont observés plutôt que créés : le fournisseur les lit par leur ID et ne les modifie ni ne les supprime jamais. `oneuptime monitor-status list --fields _id,name` liste leurs ID, avec la [CLI de OneUptime](/docs/cli/resource-operations#lister-des-enregistrements).

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

### Créer l'étiquette et le moniteur

Le moniteur désigne l'étiquette et les statuts par leur nom Kubernetes, et le fournisseur renseigne leurs ID :

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

### Les voir dans OneUptime

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

Quand `SYNCED` et `READY` indiquent `True`, l'enregistrement est dans votre projet. `EXTERNAL-NAME` est son ID dans OneUptime.
:::

## Prochaines étapes

- [Gérer les ressources](/docs/crossplane/managing-resources) explique les types de ressources et leurs champs, les références, l'import de ce que vous avez déjà, les secrets que crée OneUptime, et ce qu'il faut regarder quand une ressource n'est pas prête.
- Le [Guide complet](/docs/terraform/complete-guide) de Terraform décrit les ressources et leurs champs, que partagent les types de ressources du fournisseur.
