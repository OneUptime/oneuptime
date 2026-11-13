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

Allez dans **Moniteurs** et cliquez sur **Créer un moniteur**. Ou bien, sur la page d'une exception, cliquez sur **Créer un moniteur** à côté de **Résoudre** : le nouveau moniteur surveille d'emblée le type de cette exception dans son service, et alerte quand elle se reproduit.

### Choisir Exceptions

Sous **Type de moniteur**, cliquez sur **Plus de types de moniteurs** et choisissez **Exceptions** sous **Télémétrie**, ou tapez `exceptions` dans le champ de recherche. Saisissez un **Nom**, puis cliquez sur **Suivant**.

### Choisir ce dont le moniteur vous informe

Sous **De quoi ce moniteur doit-il vous informer ?**, choisissez **Toute exception** ou **Trop d'exceptions**. Chaque choix remplit la règle, que vous pouvez modifier plus bas. Choisissez **Autre chose** pour la configurer vous-même. **Une nouvelle exception**, **Une exception résolue revient** et **Pic d'exceptions** alertent sur une exception vue pour la première fois, sur une exception revenue après que vous l'avez résolue, et sur une hausse bien au-dessus de ce qui est normal pour cette heure de la semaine.

### Choisir les exceptions à compter

Dans **Exceptions à surveiller**, renseignez **Le message contient**, **Types d'exception** et **Environnements**. Un filtre laissé vide correspond à toutes les exceptions. **Exceptions correspondantes**, sous les filtres, montre les exceptions qu'ils sélectionnent en ce moment.

### Affiner (facultatif)

Ouvrez **Plus de champs** pour filtrer par service de télémétrie ou entité d'infrastructure, ou pour compter aussi les exceptions résolues et archivées.

### Dire quand alerter

Dans **Quand alerter**, choisissez une **Condition**, le **Nombre d'exceptions** et une **Fenêtre de temps**. La phrase en dessous redit la règle en termes simples. Le graphique sous cette phrase compte les exceptions correspondantes dans chaque fenêtre au cours des dernières heures, trace le nombre de la règle sous forme de ligne et indique combien de fois la règle aurait alerté. Son bouton propose un nombre que la règle n'aurait pas dépassé sur cette période. **Alerter sur** choisit ce que la règle compare : **Exceptions**, **Nouvelles exceptions**, **Exceptions revenues** ou **Une hausse par rapport à l'habitude**. Le graphique n'est tracé que pour **Exceptions**. Avec **Anormalement haut**, que configure **Pic d'exceptions**, il n'y a aucun nombre à saisir : choisissez plutôt une **Sensibilité**.

### Choisir ce qui se passe

Dans **Ce qui se passe**, choisissez **Créer une alerte**, **Déclarer un incident** ou **Les deux**, puis donnez-lui un titre et une gravité. Tant que la règle correspond, le moniteur affiche le statut indiqué sous **Plus de champs** ; quand elle ne correspond plus, le moniteur revient à son statut par défaut et l'alerte ou l'incident se résout de lui-même.

### Créer le moniteur

Cliquez sur **Créer un moniteur**. Le moniteur s'ouvre sur sa page **Vue d'ensemble**, et sa première évaluation a lieu dans la minute.
:::

## Ce qu'il interroge

| Champ | Ce qu'il sélectionne | Par défaut |
| --- | --- | --- |
| **Le message contient** | Les exceptions dont le message contient ce texte, sans tenir compte de la casse. | Vide : toutes les exceptions |
| **Types d'exception** | Les exceptions de l'un de ces types, séparés par des virgules, comme `TypeError, NullReferenceException`. Le nom du type doit correspondre exactement. | Vide : tous les types |
| **Environnements** | Les exceptions de l'un de ces environnements, séparés par des virgules – voir [Environnements](#environnements). | Vide : tous les environnements |
| **Fenêtre de temps** (dans **Quand alerter**) | Les exceptions des 5 dernières secondes jusqu'aux 24 dernières heures. | **Dernières 5 minutes** |
| **Filtrer par service** (sous **Plus de champs**) | Les exceptions de l'un des services choisis. | Vide : tous les services |
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
- **Des occurrences, pas des types d'exception.** Le moniteur compte chaque fois qu'une exception correspondante s'est produite dans la **Fenêtre de temps**. Une exception levée 40 fois compte pour 40.
- **Les exceptions résolues et archivées sont écartées.** Sauf si vous activez **Inclure les exceptions résolues** ou **Inclure les exceptions archivées**, les occurrences d'une exception que vous avez marquée comme résolue ou archivée ne comptent pas. Marquer une exception comme résolue peut donc fermer l'incident qu'elle a ouvert. Quand une exception résolue se reproduit, elle repasse automatiquement en non résolue et est de nouveau comptée.
- **Aucune exception, c'est un décompte de 0.**
- **L'indisponibilité d'OneUptime lui-même n'est pas un silence.** Tant que la fenêtre de temps contient une période où OneUptime lui-même ne recevait pas de données – il redémarrait, était mis à jour ou rattrapait un retard –, la vérification attend : le statut ne change pas, et aucun incident ni aucune alerte n'est ouvert ni résolu. Voir [Quand OneUptime ne reçoit pas de données](/docs/monitor/when-oneuptime-is-not-receiving).
- **Les critères de haut en bas.** Le premier critère qui correspond décide ; placez donc le plus grave en premier.

Chaque changement de statut est enregistré, avec sa raison, dans la **Chronologie de statut** du moniteur.

## Critères

Les critères d'un moniteur d'exceptions ont quatre sortes de **Type de filtre** : **Nombre d'exceptions**, le nombre d'exceptions qui ont correspondu dans la fenêtre, ainsi que **Nouvelles exceptions**, **Exceptions en régression** et **Augmentation des exceptions (en %)**, décrits plus bas. **Quand alerter** configure un critère, dont la **Condition** est **Plus de**, **Au moins**, **Moins de**, **Au plus**, **Exactement**, **Anormalement haut**, **Anormalement bas** ou **Anormalement haut ou bas**. Pour plusieurs critères, ou un critère avec plus d'un filtre, cliquez sur **Modifier en critères personnalisés** sous **Plus de champs** dans **Ce qui se passe** : chaque critère y a une **Condition de filtre** et une **Valeur**.

| Condition de filtre | Correspond quand le nombre d'exceptions est… |
| --- | --- |
| **Supérieur à** | au-dessus de la valeur |
| **Supérieur ou égal à** | égal ou supérieur à la valeur |
| **Inférieur à** | en dessous de la valeur |
| **Inférieur ou égal à** | égal ou inférieur à la valeur |
| **Égal à** | exactement la valeur |
| **Différent de** | tout sauf la valeur |
| **Anormalement élevé** | au-dessus de la plage attendue pour cette heure de la semaine |
| **Anormalement bas** | en dessous de cette plage |
| **Anormal** | hors de cette plage, dans un sens ou dans l'autre |

Les conditions d'anomalie ne prennent pas de **Valeur**. Choisissez une **Sensibilité** – Faible, Moyen (la valeur par défaut) ou Élevé – et, dans les critères personnalisés, une **Fenêtre de référence** de 14 (la valeur par défaut), 28, 60 ou 90 jours. Seul **Nombre d'exceptions** les a : voir [Les pics par rapport à la normale](#les-pics-par-rapport-à-la-normale).

Un moniteur d'exceptions créé dans « Créer un moniteur » commence avec la règle correspondant à ce que vous avez choisi sous **De quoi ce moniteur doit-il vous informer ?** :

| Choix | Règle | Ce qui se passe |
| --- | --- | --- |
| **Toute exception** | **Plus de** `0` sur **Dernières 5 minutes** | Crée une alerte, qui se résout d'elle-même |
| **Trop d'exceptions** | **Plus de** `20` sur **Dernières 5 minutes** | Crée une alerte, qui se résout d'elle-même |
| **Une nouvelle exception** | **Nouvelles exceptions**: **Plus de** `0` sur **Dernières 10 minutes** | Crée une alerte, qui se résout d'elle-même |
| **Une exception résolue revient** | **Exceptions revenues**: **Plus de** `0` sur **Dernières 10 minutes** | Crée une alerte, qui se résout d'elle-même |
| **Pic d'exceptions** | **Anormalement haut** sur **Dernières 15 minutes** | Crée une alerte, qui se résout d'elle-même |

Un moniteur d'exceptions créé via l'API ou Terraform sans critères commence avec ces critères :

| Critère | Filtre | Effet |
| --- | --- | --- |
| Check if … has exceptions | **Nombre d'exceptions** **Supérieur à** `0` | Passe le moniteur hors ligne et déclare un incident, résolu automatiquement |
| Check if … has no exceptions | **Nombre d'exceptions** **Égal à** `0` | Passe le moniteur en ligne |

## Exceptions nouvelles, revenues et en hausse

Au-delà du nombre d'exceptions, un moniteur d'exceptions peut alerter sur ce qu'un outil de suivi des erreurs met en avant. Chacun n'est lu que lorsqu'un critère le vérifie.

| Type de filtre | Ce qu'il compte dans la fenêtre |
| --- | --- |
| **Nouvelles exceptions** | Les exceptions correspondantes vues pour la première fois, ni résolues ni archivées. |
| **Exceptions en régression** | Les exceptions correspondantes que vous avez résolues, revenues et toujours ouvertes. |
| **Augmentation des exceptions (en %)** | De combien le nombre d'exceptions correspondantes dépasse l'habitude : la veille de la fenêtre, par fenêtre de même durée, au moins une. Dix exceptions après une journée calme donnent 900 %. |

Les exceptions nouvelles et revenues sont filtrées par service, type d'exception, environnement et message, et aussi par entité d'infrastructure : une exception compte quand l'une de ses occurrences dans la fenêtre vient de l'une des entités choisies.

## Les pics par rapport à la normale

**Pic d'exceptions** compare la fenêtre aux mêmes heures des semaines précédentes, et non à un nombre fixe. Un pic du lundi matin est normal un lundi matin, le même nombre à 3 h un dimanche ne l'est pas, et une lente montée sur plusieurs jours se voit dès qu'elle sort de la plage de la semaine dernière.

| Réglage | Ce qu'il fait | Valeur par défaut |
| --- | --- | --- |
| **Sensibilité** | À quelle distance de la plage habituelle une fenêtre doit se trouver : 4 écarts types en Faible, 3 en Moyen, 2 en Élevé. | Moyen |
| **Fenêtre de référence** (sous **Plus de champs**) | La quantité d'historique dont apprendre : 14, 28, 60 ou 90 jours. | 14 jours |
| **Écarts types** (sous **Plus de champs**) | Un nombre à vous à la place de ce que fixe **Sensibilité**. | Vide |
| **Minimum d'exceptions** (sous **Plus de champs**) | Le plus petit nombre d'exceptions dans une fenêtre pouvant alerter : 20 en Faible, 10 en Moyen, 5 en Élevé. | Vide |

- **Il utilise vos filtres.** L'historique est lu avec les filtres du moniteur, donc un moniteur sur un type d'exception est comparé à l'historique de ce type, et les exceptions résolues et archivées sont laissées de côté des deux côtés.
- **Le calme compte.** Une fenêtre sans exception fait partie de la normale, donc la plage d'un service calme reste petite. Ses premières exceptions n'alertent pas, à cause de **Minimum d'exceptions**, et une vraie rafale alerte.
- **Un nouveau service attend.** Tant qu'un service n'a pas deux semaines d'historique, le critère apprend encore et ne se déclenche pas, quel que soit le nombre d'exceptions levées. L'historique ne remonte que jusqu'où OneUptime conserve les exceptions : 15 jours sauf si vous avez changé cela, et un service conservé moins de deux semaines n'en a jamais assez.
- **L'alerte dit pourquoi.** Elle nomme la plage attendue et à quelle distance de celle-ci se trouvait la fenêtre. Chaque vérification écrit la même chose dans la **Chronologie de statut**, ou qu'elle apprend encore.

## Exemple : seulement les exceptions de production

Vous voulez un incident chaque fois que l'API lève une exception en production, et rien pour la préproduction. Vous choisissez **Toute exception**, réglez **Environnements** sur `production`, gardez la **Fenêtre de temps** sur **Dernières 5 minutes**, et choisissez **Déclarer un incident** sous **Ce qui se passe**. Sur les cinq dernières minutes :

| Exceptions | Environnement | État | Comptée ? |
| --- | --- | --- | --- |
| `TypeError` × 3 | `production` | Active | Oui : 3 |
| `TypeError` × 40 | `staging` | Active | Non : un autre environnement |
| `TimeoutError` × 2 | aucun | Active | Non : pas d'environnement |
| `NullReferenceException` × 4 | `production` | Résolue après les occurrences | Non : résolue |

Le **Nombre d'exceptions** vaut 3, donc **Plus de** `0` correspond : le moniteur passe hors ligne et un incident est déclaré. Une fois cinq minutes passées sans exception de production active, la règle ne correspond plus, le moniteur revient à son statut par défaut et l'incident se résout de lui-même.

## Dépannage

:::details Des exceptions apparaissent dans l'explorateur, mais le moniteur compte 0
Comparez la valeur de **Environnements** au filtre `env:` de l'explorateur : la correspondance est exacte et sensible à la casse, et les exceptions sans environnement sont écartées quand le filtre est défini. Vérifiez ensuite si ces exceptions sont résolues ou archivées. Ouvrez la page **Critères** du moniteur (sous **Configuration**) et cliquez sur **Modifier les critères** : **Exceptions correspondantes** montre ce que les filtres sélectionnent.
:::

:::details L'incident s'est résolu quand j'ai résolu l'exception
C'est le comportement attendu. Les exceptions résolues ne sont pas comptées : le décompte a baissé et le critère a cessé de correspondre. Si l'exception se reproduit, elle repasse en non résolue et est de nouveau comptée. Activez **Inclure les exceptions résolues** pour les compter malgré tout.
:::

:::details Un filtre de type d'exception ne sélectionne rien
Les **Types d'exception** sont comparés exactement au nom de type avec lequel l'exception a été signalée, comme `TypeError`. Copiez le type depuis l'explorateur d'exceptions.
:::

:::details Une règle de pic d'exceptions n'alerte jamais
Consultez la **Chronologie de statut** : elle indique la plage attendue, le nombre requis pour alerter, ou que la règle apprend encore. Un service a besoin de deux semaines d'historique, donc une conservation inférieure à deux semaines le fait rester en apprentissage. Si le nombre reste sous **Minimum d'exceptions**, baissez-le sous **Plus de champs**, ou choisissez une **Sensibilité** plus élevée.
:::

## Étapes suivantes

:::cards
- [Surveillance des traces](/docs/monitor/traces-monitor): Alerter sur les spans et les endpoints en échec.
- [Surveillance des journaux](/docs/monitor/logs-monitor): Alerter sur le volume et le contenu des journaux.
- [Modèles d'incident et d'alerte](/docs/monitor/incident-alert-templating): Écrire des titres et des descriptions d'alerte utiles.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Envoyer des exceptions à OneUptime.
:::
