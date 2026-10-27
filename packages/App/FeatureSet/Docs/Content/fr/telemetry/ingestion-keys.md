# Clés d'ingestion

Une clé d'ingestion relie votre télémétrie à votre projet. Les applications, les OpenTelemetry Collectors et les agents l'envoient avec chaque requête, et OneUptime range leurs journaux, leurs traces et leurs métriques dans le projet auquel la clé appartient. Cette page montre comment créer une clé, quel type choisir et comment garder vos clés en sécurité.

:::cards
- [Créer une clé d'ingestion](#créer-une-clé-dingestion): Un nom, un type et un secret à copier.
- [Serveur ou navigateur](#serveur-ou-navigateur): Le type de clé dont un émetteur a besoin.
- [Verrouiller une clé de navigateur](#verrouiller-une-clé-de-navigateur): Des origines, un nom de service et une limite.
- [Renouveler, désactiver ou supprimer une clé](#renouveler-désactiver-ou-supprimer-une-clé): Que faire quand une clé a fuité.
:::

## Comment une clé est vérifiée

Chaque requête porte le secret de la clé, en général dans un en-tête `x-oneuptime-token`. OneUptime retrouve la clé, vérifie qu'elle peut encore envoyer, et seulement alors accepte les données dans le projet de la clé.

```mermaid title="Ce que OneUptime vérifie avant d'accepter de la télémétrie"
flowchart TB
    request["Une requête avec<br/>x-oneuptime-token"] --> known{"Connue, activée,<br/>pas expirée ?"}
    known -->|"Oui"| origin{"Origine autorisée,<br/>pour une clé de<br/>navigateur ?"}
    origin -->|"Oui"| limit{"Sous sa limite ?"}
    limit -->|"Oui"| accepted["Acceptée dans le<br/>projet de la clé"]
    known -->|"Non"| refused["Refusée, avec un<br/>statut qui dit pourquoi"]
    origin -->|"Non"| refused
    limit -->|"Non"| refused
```

- **La clé décide du projet.** Vous n'envoyez jamais d'ID de projet : les données envoyées avec une clé arrivent dans le projet auquel la clé appartient.
- **Les changements atteignent chaque serveur en une minute.** Désactiver une clé, réinitialiser son secret, ou changer ses origines, son expiration ou sa limite prend effet en une minute environ.
- **Une clé de serveur est un mot de passe.** Quiconque l'a peut envoyer de la télémétrie dans votre projet. Gardez-la dans les secrets de vos serveurs, jamais dans le contrôle de version ni dans une page web.

## Serveur ou navigateur

Choisissez le type selon l'endroit où la clé vivra. Le type ne peut plus être changé une fois la clé créée.

| | **Serveur** | **Navigateur** |
| --- | --- | --- |
| Pour | Les applications, les collectors et les agents sur des machines que vous gérez | Les pages web, et React Native Session Replay |
| Envoie | Toute sorte de télémétrie, vers tous les points de terminaison | Des traces, des journaux, des métriques et des Session Replays |
| Un secret | Oui : gardez-la sur vos serveurs | Non : quiconque consulte la page peut la lire |
| Origines | Non vérifiées | Seules les origines listées sont acceptées |
| Requêtes par minute | Pas de limite, sauf si vous en fixez une | 6 000, sauf si vous fixez une autre limite |

Partout ailleurs, OneUptime refuse une clé de navigateur, par exemple sur gRPC et MQTT, pour les profils, Syslog, Fluent Bit et Fluentd, et pour l'envoi de source maps. Pour faire passer un émetteur à l'autre type, créez une clé de ce type, basculez l'émetteur dessus, puis supprimez l'ancienne clé.

## Avant de commencer

- **Un rôle qui gère les clés d'ingestion.** Project Owner ou Project Admin, ou un rôle personnalisé avec la permission Create Telemetry Ingestion Key. Les rôles Telemetry n'incluent pas les clés d'ingestion.
- **Sur OneUptime Cloud, un moyen de paiement.** La télémétrie est facturée à l'usage, donc un projet sur le plan Free a besoin d'un moyen de paiement avant de pouvoir créer une clé. La boîte de dialogue de création se termine alors par une étape **Facturation** qui affiche les tarifs.

## Créer une clé d'ingestion

:::steps
### Ouvrir les clés d'ingestion

Allez dans **Paramètres du projet → Télémétrie & APM → Clés d'ingestion**. **Télémétrie & APM** est replié au départ dans le menu latéral : cliquez dessus pour l'ouvrir. La liste affiche pour chaque clé ses colonnes **Nom**, **Type**, **Dernière utilisation** et **Description**.

### Nommer la clé et choisir son type

Cliquez sur **Créer une clé d'ingestion**. La boîte de dialogue commence avec le nom **Clé serveur** et le type **Serveur**. Choisissez le **Type de clé**, et renommez la clé d'après ce qui l'utilisera, par exemple `checkout-collector`. Une **Description** se trouve sous **Avancé**.

### Ajouter les origines d'une clé de navigateur

Une clé **Navigateur** demande ses **Origines autorisées** à l'étape suivante, **Paramètres du navigateur**, avec son **Nom du service épinglé** sous **Avancé**. Voir [Verrouiller une clé de navigateur](#verrouiller-une-clé-de-navigateur).

### Créer la clé et copier son secret

Cliquez sur **Créer une clé d'ingestion**. La page de la clé s'ouvre : copiez sa **Clé secrète** et donnez-la à vos émetteurs.
:::

Le **Guide de configuration** de chaque produit commence par **Choisir une clé d'ingestion**, qui liste les clés que ce guide peut utiliser et en crée une sur place. Les extraits du guide contiennent ensuite cette clé.

## Envoyer de la télémétrie avec la clé

Les émetteurs placent le secret dans un en-tête `x-oneuptime-token` :

```text
x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_KEY
```

- Les SDK OpenTelemetry le lisent dans `OTEL_EXPORTER_OTLP_HEADERS`. Voir le [démarrage rapide OpenTelemetry](/docs/telemetry/open-telemetry#démarrage-rapide).
- Sur OTLP/gRPC, il va dans les métadonnées `x-oneuptime-token`.
- Un appareil MQTT l'envoie comme mot de passe. Voir [Appareils IoT](/docs/telemetry/iot-devices).
- OneUptime lit aussi la clé dans un en-tête `x-oneuptime-ingestion-key` ou `x-oneuptime-service-token`, que certaines anciennes configurations envoient.

## Verrouiller une clé de navigateur

Une clé de navigateur se trouve dans votre page, où n'importe qui peut la copier. Ces paramètres limitent ce qu'une copie peut faire. Modifiez-les sur la page de la clé avec **Modifier : Clé d'ingestion de télémétrie**.

| Paramètre | Ce qu'il fait |
| --- | --- |
| **Origines autorisées** | Les seules origines depuis lesquelles la clé est acceptée. Une requête depuis toute autre origine, ou sans en-tête `Origin`, est refusée. Une clé de navigateur doit en garder au moins une. |
| **Nom du service épinglé** | Range tout ce que la clé envoie sur OTLP/HTTP sous ce seul service, quel que soit le `service.name` défini par l'émetteur. Une copie de la clé ne peut alors écrire que dans ce service. |
| **Requests Per Minute Limit** | Le nombre maximal de requêtes acceptées pour la clé chaque minute, partagé par tous les visiteurs. Une clé de navigateur en reçoit 6 000 si vous laissez le champ vide. |
| **Expire le** | La date après laquelle la clé est refusée, pour qu'une copie publiée cesse de fonctionner. |

Une origine se compose d'un schéma, d'un hôte et d'un port facultatif : `https://app.example.com` ne couvre pas `https://app.example.com:8443`. Un `*.` en tête couvre tous les sous-domaines, mais pas le domaine lui-même. React Native Session Replay envoie une identité `app://` exacte, qui n'accepte aucun joker :

```json
[
  "https://app.example.com",
  "https://*.example.com",
  "app://com.example.mobile"
]
```

Le [Catalogue de services](/docs/telemetry/services#comment-un-service-entre-dans-le-catalogue) montre comment un nom épinglé décide du service. Le Runner et l'agent IA de l'agent Kubernetes, ainsi que les agents IA d'infrastructure, ne s'enregistrent pas avec une clé épinglée : donnez-leur une clé de serveur non épinglée.

## Renouveler, désactiver ou supprimer une clé

La page d'une clé affiche son **Statut**, sa **Clé secrète** derrière **Cliquez pour afficher**, et sa **Dernière utilisation le** : la dernière fois que OneUptime a accepté des données envoyées avec elle.

| Pour | Faites ceci | Ce que voient les émetteurs |
| --- | --- | --- |
| Arrêter une clé tout de suite, et pouvoir revenir en arrière | Cliquez sur **Modifier : Clé d'ingestion de télémétrie**, ouvrez **Accès et limites** et désactivez **Activé**. Le statut indique **Désactivé — télémétrie refusée**. | `422` jusqu'à ce que vous la réactiviez |
| Remplacer un secret qui a fuité | Cliquez sur **Réinitialiser la clé secrète** et confirmez. La clé garde ses paramètres et reçoit un nouveau secret. | `401` jusqu'à ce qu'ils envoient le nouveau secret |
| Arrêter une clé définitivement | Cliquez sur **Supprimer : Clé d'ingestion de télémétrie** en bas de sa page. | `401` |

Pour changer de secret sans perdre de données, créez une deuxième clé, basculez vos émetteurs dessus, et supprimez l'ancienne clé quand sa **Dernière utilisation le** ne bouge plus. **Dernière utilisation le** est mise à jour toutes les quelques minutes, pas à chaque requête.

## Dépannage

Une requête refusée reçoit un statut et une phrase qui dit pourquoi.

| Réponse | Ce qu'elle signifie |
| --- | --- |
| `401` avec `Missing ingestion token` | La requête n'a pas de clé. Envoyez-la dans `x-oneuptime-token`. |
| `401` avec `Invalid ingestion token` | Aucune clé n'a ce secret : il a été mal saisi, réinitialisé ou supprimé. |
| `401` avec `This telemetry ingestion key expired.` | Sa date **Expire le** est passée. Fixez une date plus lointaine, ou utilisez une autre clé. |
| `402` avec `Add a payment method` | Sur OneUptime Cloud, le projet est sur le plan Free et n'a pas encore de moyen de paiement. |
| `422` avec `This telemetry ingestion key has been disabled.` | Quelqu'un a désactivé **Activé**. |
| `422` avec `A browser ingestion key cannot be used for` | Une clé de navigateur a atteint un point de terminaison qui n'accepte que les clés de serveur. |
| `422` avec `did not send an Origin header` | Une clé de navigateur a été envoyée hors d'un navigateur. Utilisez-y une clé de serveur. |
| `422` avec `is not allowed for this browser ingestion key` | L'origine de la page ne figure pas dans **Origines autorisées**. |
| `422` avec `is pinned to a single service` | Une clé avec un **Nom du service épinglé** a servi à enregistrer un agent. Utilisez une clé de serveur non épinglée. |
| `429` avec `Too many telemetry requests for this ingestion key` | La clé a atteint sa **Requests Per Minute Limit**. Les exportateurs réessaient après le délai `Retry-After`. |

Pour les autres réponses qu'un exportateur OTLP peut recevoir, voir [Réponses](/docs/telemetry/open-telemetry#réponses).

:::details Des données arrivent encore une minute après la désactivation de la clé
Chaque serveur OneUptime garde ce qu'il sait d'une clé pendant une minute au plus, donc un changement les atteint tous en une minute environ. Les requêtes suivantes sont refusées.
:::

:::details Une clé de navigateur fonctionne sur mon portable mais pas en production
Une origine inclut son schéma et son port. `http://localhost:3000` et `https://app.example.com` sont des origines différentes : listez chacune de celles d'où la page est servie.
:::

:::details Dernière utilisation le indique toujours Jamais
Rien n'a envoyé de données avec cette clé depuis que OneUptime enregistre son utilisation. Vérifiez que vos émetteurs ont bien le secret de cette clé, et que leurs requêtes atteignent OneUptime.
:::

## Étapes suivantes

:::cards
- [OpenTelemetry](/docs/telemetry/open-telemetry): Envoyer des traces, des métriques et des journaux avec votre clé.
- [Catalogue de services](/docs/telemetry/services): Voir les services sous lesquels votre télémétrie est rangée.
- [Rétention des données](/docs/telemetry/data-retention): Décider combien de temps les données sont conservées.
- [Filtres de suppression et règles de masquage](/docs/telemetry/drop-filters-and-scrub-rules): Supprimer ou masquer des données avant leur stockage.
:::
