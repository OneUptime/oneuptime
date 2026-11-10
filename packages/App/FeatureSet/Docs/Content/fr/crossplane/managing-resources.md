# Gérer les ressources

Cette page traite des ressources du fournisseur une fois les premières en service : comment les types de ressources et leurs champs sont nommés, comment les ressources se réfèrent les unes aux autres, comment reprendre ce que votre projet a déjà, les secrets que crée OneUptime, ce que deviennent les modifications faites en dehors de Kubernetes, et ce qu'il faut regarder quand une ressource n'est pas prête. Pour installer le fournisseur et créer vos premières ressources, commencez par la [Vue d'ensemble de Crossplane](/docs/crossplane/index).

:::cards
- [Types de ressources et champs](#types-de-ressources-et-champs): Les ressources Terraform dont ils sont issus, et la façon dont ils sont nommés.
- [Faire référence à d'autres ressources](#faire-référence-à-dautres-ressources): Des noms au lieu d'ID, à tous les niveaux des étapes d'un moniteur.
- [Importer ce que vous avez déjà](#importer-ce-que-vous-avez-déjà): Observer un enregistrement par son ID, puis en prendre la gestion.
- [Dépanner une ressource](#dépanner-une-ressource): Ses conditions, ses événements et les journaux du fournisseur.
:::

## Types de ressources et champs

Chaque ressource du [fournisseur Terraform](/docs/terraform/index) devient un type de ressource, nommé en CamelCase : `oneuptime_status_page` devient `StatusPage`, et `oneuptime_on_call_policy` devient `OnCallPolicy`. Un nom qui se terminerait par Spec, Status ou List se voit ajouter Definition, si bien que `oneuptime_monitor_status` devient `MonitorStatusDefinition`. Quelques-uns de ces types :

| Type de ressource | Représente | Ressource Terraform |
| --- | --- | --- |
| `Monitor` | Un moniteur | `oneuptime_monitor` |
| `StatusPage` | Une page de statut | `oneuptime_status_page` |
| `OnCallPolicy` | Une politique d'astreinte | `oneuptime_on_call_policy` |
| `Team` | Une équipe | `oneuptime_team` |
| `Label` | Une étiquette | `oneuptime_label` |
| `IncidentSeverity` | Une gravité d'incident | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | Un statut de moniteur | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | Une clé d'ingestion de télémétrie | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` liste chaque type de ressource que votre cluster a activé.

Les champs d'un type de ressource sont les arguments de la ressource Terraform, en camelCase, sous `spec.forProvider` : `monitoring_interval` devient `monitoringInterval`. Un champ que Terraform écrit avec `jsonencode()` prend une chaîne JSON. `kubectl explain` décrit chaque champ comme le fait le fournisseur Terraform, et le [Guide complet](/docs/terraform/complete-guide) de Terraform montre comment ils s'utilisent :

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` montre l'enregistrement tel que OneUptime le connaît, avec son `id`. Un champ que vous omettez et que OneUptime renseigne, comme une valeur par défaut, est copié dans `spec.forProvider` après la création de l'enregistrement, pour que la vérification suivante ne trouve rien à modifier.

## Faire référence à d'autres ressources

Chaque champ qui contient l'ID d'un autre enregistrement accepte aussi une référence à la ressource qui représente cet enregistrement. `<field>Ref` nomme une ressource du même namespace, et `<field>Selector` en choisit une par ses labels Kubernetes. Une liste d'ID, comme `labels`, accepte `labelsRefs` et `labelsSelector`. Le fournisseur attend que la ressource référencée existe dans OneUptime, puis renseigne son ID.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

Les références vont jusque dans les étapes d'un moniteur : le statut d'un critère (`monitorStatusIdRef`), et la gravité, les équipes propriétaires, les politiques d'astreinte et les étiquettes des incidents et des alertes qu'il crée (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`). Il n'existe pas de type de ressource pour une personne : un champ désigne quelqu'un par son ID d'utilisateur, comme le fait `ownerUserIds`, et beaucoup de types acceptent aussi son adresse e-mail, comme `TeamMember` le fait avec `userEmail` ([Personnes et équipes](/docs/terraform/people-and-teams)).

## Importer ce que vous avez déjà

Une ressource qui observe un enregistrement le lit par son ID et ne le modifie ni ne le supprime jamais. Indiquez l'ID comme nom externe de la ressource, et `Observe` comme sa seule politique de gestion :

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

L'ID de l'enregistrement figure dans le bloc `import` qu'écrit sa page **Développeurs → Terraform** dans le tableau de bord, et `oneuptime <resource> list` liste les ID d'un type d'enregistrement avec la [CLI de OneUptime](/docs/cli/resource-operations#lister-des-enregistrements). Une fois la ressource prête, `status.atProvider` montre l'enregistrement. Pour le gérer à partir de là, écrivez ses champs dans `spec.forProvider` et réglez `managementPolicies` sur `["*"]`.

## Secrets

### Secrets créés par OneUptime

Certains enregistrements s'accompagnent d'un secret que crée OneUptime, comme celui d'une clé d'ingestion de télémétrie. Le fournisseur ne le place jamais dans la ressource : il l'écrit dans un Secret du namespace de la ressource, nommé par `writeConnectionSecretToRef`, sous `attribute.` suivi du nom de l'attribut Terraform :

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

Supprimer la ressource supprime aussi le Secret.

### Secrets que vous fournissez

Un champ qui contient un secret, comme la phrase secrète de la clé client TLS d'une étape de moniteur, accepte un Secret du namespace de la ressource au lieu d'une valeur : `tlsClientKeyPassphraseSecretRef`, avec le `name` et la `key` du Secret.

## Modifications faites en dehors de Kubernetes

Le fournisseur compare chaque ressource à son enregistrement toutes les 10 minutes et rétablit ce que quelqu'un a modifié dans OneUptime. Pour vérifier plus souvent, donnez au fournisseur une configuration d'exécution avec `--poll` :

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

Pour que le tableau de bord garde la main sur un champ après la création de l'enregistrement, écrivez-le dans `spec.initProvider` au lieu de `spec.forProvider` : il sert à créer l'enregistrement et n'est jamais rétabli. Pour que le tableau de bord garde la main sur tout l'enregistrement, retirez `Update` de ses politiques de gestion : `["Observe", "Create", "Delete", "LateInitialize"]`.

## Supprimer une ressource

Supprimer une ressource supprime son enregistrement dans OneUptime. Pour conserver l'enregistrement, retirez `Delete` des politiques de gestion de la ressource avant de la supprimer : `["Observe", "Create", "Update", "LateInitialize"]`. Une ressource qui ne fait qu'observer ne supprime jamais son enregistrement.

## Dépanner une ressource

`kubectl -n team-a get managed` montre `SYNCED` et `READY` pour chaque ressource. Quand l'un des deux n'est pas `True`, les conditions et les événements de la ressource disent pourquoi, avec la réponse de OneUptime quand l'API a refusé une requête :

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| Ce qui est indiqué | Ce qu'il faut vérifier |
| --- | --- |
| `cannot read the API key` | Le Secret, ou la clé qu'il contient, que nomme le `ProviderConfig`. |
| `cannot get referenced ProviderConfig` | La ressource nomme un `ProviderConfig` que son namespace n'a pas. Utilisez `kind: ClusterProviderConfig` pour en désigner un à l'échelle du cluster. |
| Une référence qui ne peut pas être résolue | La ressource qu'elle nomme est absente du namespace, ou pas encore prête. |
| Une erreur de l'API de OneUptime | Les permissions de la clé API, et la valeur du champ que nomme l'erreur. |

Les journaux du fournisseur en disent plus, et plus encore avec `--debug` ajouté à ses `args`, comme `--poll` ci-dessus :

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## Vérifier le paquet

À chaque version, le paquet est signé sans clé avec cosign de Sigstore, comme les images de OneUptime. Pour vérifier un paquet avant de l'installer :

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
