# Surveillance des exceptions

Un moniteur d'exceptions compte, sur une fenêtre de temps, les exceptions que vos services signalent à OneUptime et qui correspondent à vos filtres – message, type d'exception, environnement, service. Quand ce nombre remplit vos critères, il change le statut du moniteur, crée une alerte ou déclare un incident. Servez-vous-en pour alerter sur tout nouveau plantage en production, sur un type d'exception précis ou sur une hausse soudaine des erreurs.

:::cards
- [Créer le moniteur](#créer-un-moniteur-dexceptions): Choisir les exceptions à compter et quand alerter.
- [Environnements](#environnements): Restreindre le moniteur à `production`.
- [Comment il est évalué](#comment-il-est-évalué): Ce qui est compté, et ce que fait la résolution d'une exception.
- [Critères](#critères): Les conditions et les valeurs par défaut.
:::

## Fonctionnement

```mermaid title="Chaque minute, un moniteur d'exceptions compte et vérifie"
flowchart TB
    App["Vos services"] -->|OpenTelemetry| Store[("Exceptions dans OneUptime")]
    Store --> Skip["Écarter les exceptions<br/>résolues et archivées"]
    Skip --> Count["Compter les exceptions correspondantes<br/>dans la fenêtre de temps"]
    Count --> Check{"Critères remplis ?"}
    Check -->|"Première correspondance"| Act["Changer le statut,<br/>alerte ou incident"]
    Check -->|Aucun| Default["Statut par défaut"]
```

Chaque minute, OneUptime compte les exceptions qui correspondent aux filtres du moniteur et se sont produites dans sa fenêtre de temps, en écartant celles que vous avez marquées comme résolues ou archivées. Il compare ce nombre aux critères du moniteur de haut en bas, et le premier critère qui correspond décide de ce qui se passe. Si aucun ne correspond, le moniteur revient à son statut par défaut.

## Avant de commencer

- Vos services envoient des exceptions à OneUptime via OpenTelemetry. Voir [OpenTelemetry](/docs/telemetry/open-telemetry).
- Pour restreindre un moniteur à un environnement, vos services doivent définir l'attribut de ressource `deployment.environment`.

## Créer un moniteur d'exceptions

:::steps
### Commencer un nouveau moniteur

Allez dans **Moniteurs** et cliquez sur **Créer un moniteur**.

### Choisir Exceptions

Sous **Type de moniteur**, cliquez sur **Plus de types de moniteurs** et choisissez **Exceptions** sous **Télémétrie**, ou tapez `exceptions` dans le champ de recherche. Saisissez un **Nom**, puis cliquez sur **Suivant**.

### Choisir les exceptions à compter

Dans **Configuration du moniteur d'exceptions**, renseignez **Filtrer le message d'exception**, **Types d'exception**, **Environnements** et **Surveiller les exceptions pendant (durée)**. Un filtre laissé vide correspond à toutes les exceptions. **Aperçu des exceptions**, sous les filtres, montre les exceptions qu'ils sélectionnent en ce moment.

### Affiner (facultatif)

Ouvrez **Plus de champs** pour filtrer par service de télémétrie ou entité d'infrastructure, ou pour compter aussi les exceptions résolues et archivées.

### Définir les critères

La carte **Critères du moniteur** commence avec deux critères : hors ligne, avec un incident, quand une exception correspond ; en ligne quand aucune ne correspond. Adaptez-les à ce sur quoi vous voulez alerter – voir [Critères](#critères).

### Créer le moniteur

Cliquez sur **Créer un moniteur**. Le moniteur s'ouvre sur sa page **Vue d'ensemble**, et sa première évaluation a lieu dans la minute.
:::

## Ce qu'il interroge

| Champ | Ce qu'il sélectionne | Par défaut |
| --- | --- | --- |
| **Filtrer le message d'exception** | Les exceptions dont le message contient ce texte, sans tenir compte de la casse. | Vide : toutes les exceptions |
| **Types d'exception** | Les exceptions de l'un de ces types, séparés par des virgules, comme `TypeError, NullReferenceException`. Le nom du type doit correspondre exactement. | Vide : tous les types |
| **Environnements** | Les exceptions de l'un de ces environnements, séparés par des virgules – voir [Environnements](#environnements). | Vide : tous les environnements |
| **Surveiller les exceptions pendant (durée)** | Les exceptions des 5 dernières secondes jusqu'aux 24 dernières heures. | **Dernière minute** |
| **Filtrer par service de télémétrie** (sous **Plus de champs**) | Les exceptions de l'un des services choisis. | Vide : tous les services |
| **Filtrer par entité d'infrastructure** (sous **Plus de champs**) | Les exceptions de l'un des hôtes, pods, conteneurs et autres entités choisis. | Vide : toutes les entités |
| **Inclure les exceptions résolues** (sous **Plus de champs**) | Compter aussi les exceptions marquées comme résolues. | Désactivé |
| **Inclure les exceptions archivées** (sous **Plus de champs**) | Compter aussi les exceptions archivées. | Désactivé |

Tous les filtres que vous définissez doivent correspondre pour qu'une exception soit comptée.

### Environnements

Les environnements proviennent de l'attribut de ressource OpenTelemetry `deployment.environment` de chaque exception, la même valeur que l'explorateur d'exceptions filtre avec `env:production`. Saisissez un environnement, ou plusieurs séparés par des virgules ; une exception est comptée quand son environnement correspond à l'un d'eux.

La correspondance est exacte et sensible à la casse : `production` ne correspond pas à `Production` ni à `prod`. Les exceptions sans environnement ne sont pas comptées quand ce filtre est défini. Laissez-le vide pour compter les exceptions de tous les environnements, y compris celles qui n'en ont pas.

Le filtre d'environnement se combine avec tous les autres filtres : un moniteur restreint à un service de télémétrie et à `production` ne compte que les exceptions de production de ce service.

Quand vous créez le moniteur via l'API, définissez `environments` dans le `exceptionMonitor` de l'étape comme une liste de noms d'environnements :

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

## Comment il est évalué

- **Chaque minute.** Un moniteur d'exceptions n'est pas vérifié par des sondes ; il n'a donc pas d'intervalle à régler ni de page **Sondes et intervalle**.
- **Des occurrences, pas des types d'exception.** Le moniteur compte chaque fois qu'une exception correspondante s'est produite dans la durée **Surveiller les exceptions pendant (durée)**. Une exception levée 40 fois compte pour 40.
- **Les exceptions résolues et archivées sont écartées.** Sauf si vous activez **Inclure les exceptions résolues** ou **Inclure les exceptions archivées**, les occurrences d'une exception que vous avez marquée comme résolue ou archivée ne comptent pas. Marquer une exception comme résolue peut donc fermer l'incident qu'elle a ouvert. Quand une exception résolue se reproduit, elle repasse automatiquement en non résolue et est de nouveau comptée.
- **Aucune exception, c'est un décompte de 0.**
- **L'indisponibilité d'OneUptime lui-même n'est pas un silence.** Tant que la fenêtre de temps contient une période où OneUptime lui-même ne recevait pas de données – il redémarrait, était mis à jour ou rattrapait un retard –, la vérification attend : le statut ne change pas, et aucun incident ni aucune alerte n'est ouvert ni résolu. Voir [Quand OneUptime ne reçoit pas de données](/docs/monitor/when-oneuptime-is-not-receiving).
- **Les critères de haut en bas.** Le premier critère qui correspond décide ; placez donc le plus grave en premier.

Chaque changement de statut est enregistré, avec sa raison, dans la **Chronologie de statut** du moniteur.

## Critères

Les critères d'un moniteur d'exceptions ont un seul **Type de filtre** : **Exception Count**, le nombre d'exceptions qui ont correspondu dans la fenêtre. Choisissez une **Condition de filtre** et une **Valeur**.

| Condition de filtre | Correspond quand le nombre d'exceptions est… |
| --- | --- |
| **Greater Than** | au-dessus de la valeur |
| **Greater Than Or Equal To** | égal ou supérieur à la valeur |
| **Less Than** | en dessous de la valeur |
| **Less Than Or Equal To** | égal ou inférieur à la valeur |
| **Equal To** | exactement la valeur |
| **Not Equal To** | tout sauf la valeur |

Les décomptes d'exceptions n'ont pas de conditions d'anomalie : il n'existe pas de référence à laquelle les comparer.

Un nouveau moniteur d'exceptions commence avec ces critères :

| Critère | Filtre | Effet |
| --- | --- | --- |
| Check if … has exceptions | **Exception Count** **Greater Than** `0` | Passe le moniteur hors ligne et déclare un incident, résolu automatiquement |
| Check if … has no exceptions | **Exception Count** **Equal To** `0` | Passe le moniteur en ligne |

## Exemple : seulement les exceptions de production

Vous voulez un incident chaque fois que l'API lève une exception en production, et rien pour la préproduction. Vous réglez **Environnements** sur `production` et **Surveiller les exceptions pendant (durée)** sur **Dernières 5 minutes**, et gardez les critères par défaut. Sur les cinq dernières minutes :

| Exceptions | Environnement | État | Comptée ? |
| --- | --- | --- | --- |
| `TypeError` × 3 | `production` | Active | Oui : 3 |
| `TypeError` × 40 | `staging` | Active | Non : un autre environnement |
| `TimeoutError` × 2 | aucun | Active | Non : pas d'environnement |
| `NullReferenceException` × 4 | `production` | Résolue après les occurrences | Non : résolue |

L'**Exception Count** vaut 3, donc **Greater Than** `0` correspond : le moniteur passe hors ligne et un incident est déclaré. Une fois cinq minutes passées sans exception de production active, le critère en ligne correspond et l'incident se résout de lui-même.

## Dépannage

:::details Des exceptions apparaissent dans l'explorateur, mais le moniteur compte 0
Comparez la valeur de **Environnements** au filtre `env:` de l'explorateur : la correspondance est exacte et sensible à la casse, et les exceptions sans environnement sont écartées quand le filtre est défini. Vérifiez ensuite si ces exceptions sont résolues ou archivées. Ouvrez la page **Critères** du moniteur (sous **Configuration**) et cliquez sur **Modifier les critères de surveillance** : **Aperçu des exceptions** montre ce que les filtres sélectionnent.
:::

:::details L'incident s'est résolu quand j'ai résolu l'exception
C'est le comportement attendu. Les exceptions résolues ne sont pas comptées : le décompte a baissé et le critère a cessé de correspondre. Si l'exception se reproduit, elle repasse en non résolue et est de nouveau comptée. Activez **Inclure les exceptions résolues** pour les compter malgré tout.
:::

:::details Un filtre de type d'exception ne sélectionne rien
Les **Types d'exception** sont comparés exactement au nom de type avec lequel l'exception a été signalée, comme `TypeError`. Copiez le type depuis l'explorateur d'exceptions.
:::

## Étapes suivantes

:::cards
- [Surveillance des traces](/docs/monitor/traces-monitor): Alerter sur les spans et les endpoints en échec.
- [Surveillance des journaux](/docs/monitor/logs-monitor): Alerter sur le volume et le contenu des journaux.
- [Modèles d'incident et d'alerte](/docs/monitor/incident-alert-templating): Écrire des titres et des descriptions d'alerte utiles.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Envoyer des exceptions à OneUptime.
:::
