# Explorateur de métriques

Les métriques sont les nombres que vos services et votre infrastructure rapportent dans le temps : nombres de requêtes, latences, CPU, profondeur de file d'attente. L'explorateur de métriques liste chaque métrique que votre projet reçoit, représente n'importe laquelle en graphique, les combine avec des formules et transforme un graphique en moniteur ou en widget de tableau de bord.

:::cards
- [Trouver une métrique](#trouver-une-métrique): Chercher dans la liste des noms de métriques.
- [Représenter une métrique](#représenter-une-métrique): Agréger, filtrer et regrouper une requête.
- [Combiner des requêtes avec une formule](#combiner-des-requêtes-avec-une-formule): Taux d'erreur et autres ratios.
- [Utiliser ce que vous avez représenté](#utiliser-ce-que-vous-avez-représenté): Un moniteur, un widget de tableau de bord ou un lien.
- [Améliorer les métriques et ajouter celles qui manquent avec l'IA](#améliorer-les-métriques-et-ajouter-celles-qui-manquent-avec-lia): Des pull requests qui corrigent vos métriques et ajoutent celles qui manquent à un service.
:::

## Comment fonctionne l'explorateur

L'explorateur a deux niveaux. L'onglet **Lecteur** liste les métriques que votre projet reçoit. Cliquez sur l'une d'elles, et l'explorateur de métriques s'ouvre avec une requête pour elle : une métrique, sa façon d'être agrégée, filtrée et regroupée. Chaque requête est une variable, `a`, `b` et ainsi de suite, qu'une formule peut utiliser.

```mermaid title="Des requêtes de métriques à un graphique, un moniteur ou un tableau de bord"
flowchart TB
    a["Requête a : requêtes,<br/>agrégées par Sum"] --> f["Formule :<br/>$b / $a * 100"]
    b["Requête b : erreurs,<br/>agrégées par Sum"] --> f
    f --> chart["Graphique : taux<br/>d'erreur en pourcentage"]
    chart --> monitor["Un moniteur de<br/>métriques"]
    chart --> dash["Un widget de<br/>tableau de bord"]
```

L'explorateur a cinq onglets :

| Onglet | À quoi il sert |
| --- | --- |
| **Lecteur** | La liste des métriques, chacune avec un petit graphique et sa dernière valeur. Il s'ouvre sur la dernière heure. |
| **Analyses** | Quels services rapportent des métriques, et combien. |
| **IA** | Les problèmes qu'OneUptime trouve dans vos métriques (trop de valeurs, des buckets d'histogramme qui ne conviennent pas, des métriques manquantes), et ce qu'OneUptime AI en a fait. Voir [Améliorer les métriques et ajouter celles qui manquent avec l'IA](#améliorer-les-métriques-et-ajouter-celles-qui-manquent-avec-lia). |
| **Guide de configuration** | Comment envoyer des métriques avec OpenTelemetry, avec l'une de vos clés d'ingestion. |
| **Paramètres** | **Règles de pipeline** et **Règles d'enregistrement** : ce qui arrive aux métriques à leur arrivée. |

## Avant de commencer

- **Des métriques qui arrivent.** Envoyez-les avec [OpenTelemetry](/docs/telemetry/open-telemetry), ou depuis un agent comme le [collecteur OpenTelemetry pour hôte](/docs/telemetry/host-otel-collector) ou l'[agent Kubernetes](/docs/telemetry/kubernetes-agent).
- **Un rôle qui peut lire la télémétrie.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member ou Telemetry Viewer, ou un rôle personnalisé avec la permission Read Telemetry Service Metrics. Voir [Télémétrie](/docs/permissions/index#télémétrie) pour savoir quelles métriques il lit.

## Trouver une métrique

Ouvrez **Produits → Observabilité → Métriques**. Le **Lecteur** liste chaque métrique que votre projet a reçue, par nom, chacune avec un petit graphique de la plage de temps et sa dernière valeur.

- Cherchez des noms avec des mots seuls ou `name:`, par exemple `name:http.server` trouve `http.server.request.duration`. Voir [Syntaxe de recherche](/docs/telemetry/search-syntax#métriques).
- Filtrez par **Service** dans la barre latérale pour ne voir que les métriques d'un service.
- Cliquez sur une métrique pour la représenter dans l'explorateur de métriques.

## Représenter une métrique

:::steps
### Ouvrir la métrique

Cliquez sur la métrique dans le **Lecteur**. L'explorateur s'ouvre avec une requête, `a`, pour la plage de temps et les filtres de la liste.

### Choisir comment l'agréger

Sous **Agréger par**, choisissez comment les valeurs de chaque point du graphique sont combinées : Avg, la valeur par défaut, Sum, Min, Max, Count, ou un centile, P50, P75, P90, P95 ou P99. Le centile d'une métrique histogramme, comme une durée de requête, est calculé à partir de ses buckets.

### La filtrer et la regrouper

Ouvrez **Filtres et regroupement**. **Filtrer par attributs** garde les points de données dont les attributs correspondent, comme une `http.route` précise, et **Regrouper par** trace une ligne par valeur des attributs choisis, comme une ligne par hôte.

### Ajuster le graphique

Ouvrez **Paramètres d'affichage** pour choisir le **Type de graphique** (ligne, aire ou barres), tracer un **Warning Threshold** et un **Seuil critique** sur le graphique, ou activer **Convertir en taux par seconde**.
:::

> [!TIP]
> Un compteur qui ne fait que croître, comme `system.disk.io`, se lit mieux comme un taux. Activez **Convertir en taux par seconde** pour tracer la vitesse à laquelle il change plutôt que son cumul ; l'explorateur le suggère quand il repère un tel compteur.

Chaque requête trace son propre graphique. Pour tracer une requête sur le même graphique que la précédente, activez **Overlay with previous query** dans ses **Paramètres d'affichage**.

## Combiner des requêtes avec une formule

:::steps
### Ajouter les requêtes

Cliquez sur **Ajouter une métrique** pour chaque métrique dont vous avez besoin. Les nouvelles requêtes sont `b`, `c` et ainsi de suite.

### Ajouter une formule

Cliquez sur **Ajouter une formule** et écrivez la **Formule** avec les variables des requêtes, les opérateurs `+`, `-`, `*`, `/`, `%` et `^`, et des parenthèses. Pour un taux d'erreur en pourcentage, écrivez `$b / $a * 100`.
:::

Une variable s'écrit avec ou sans son `$`, en majuscules ou en minuscules. Une formule qui nomme une requête que vous n'avez pas définie le signale au lieu de tracer.

## Explorer autour d'un graphique

Les boutons au-dessus des graphiques agissent sur la plage de temps que vous regardez :

| Bouton | Ce qu'il fait |
| --- | --- |
| **Journaux** | Ouvre l'[Explorateur de journaux](/docs/telemetry/logs-explorer) sur cette plage de temps et vos filtres. |
| **Traces** | Ouvre l'[Explorateur de traces](/docs/telemetry/traces-explorer) sur cette plage de temps et vos filtres. |
| **Investiguer** | Ouvre un panneau latéral avec les journaux, les traces et les exceptions de cette plage de temps. |
| **Événements** | Marque les incidents et les alertes de cette plage de temps sur les graphiques. |
| **Comparer** | Trace la période précédente en pointillés sur chaque graphique, pour voir ce qui a changé. |

Faites glisser la souris sur un graphique pour zoomer sur un moment, et double-cliquez pour dézoomer : voir [Zoomer sur une plage temporelle](/docs/telemetry/charts-and-time-ranges).

## Utiliser ce que vous avez représenté

- **Actions → Créer un moniteur à partir de cette vue** ouvre un nouveau moniteur de métriques avec ces requêtes et ces formules déjà remplies. Voir [Surveillance des métriques](/docs/monitor/metrics-monitor).
- **Actions → Ajouter au tableau de bord** ajoute le graphique au tableau de bord de votre choix. Il vous faut la permission de modifier ce tableau de bord.
- **Copier le lien** copie un lien vers exactement cette vue : requêtes, formules et plage de temps.
- **Saved Views** garde la vue sous un nom pour tout le projet. Le **Lecteur** a ses propres vues enregistrées, pour sa recherche et ses filtres. Les vues enregistrées fonctionnent comme dans l'[Explorateur de journaux](/docs/telemetry/logs-explorer#enregistrer-une-vue).

## Analyses des métriques

L'onglet **Analyses** compte les métriques d'une plage de temps : **Métriques actives**, **Services de reporting** et la moyenne par service. Il range les métriques par catégories, et liste les services qui les rapportent.

## Améliorer les métriques et ajouter celles qui manquent avec l'IA

Chaque heure, OneUptime parcourt les métriques que vos services ont envoyées dans la dernière heure à la recherche de celles qui enregistrent trop de valeurs, des histogrammes dont les buckets ne conviennent pas et des services chargés qui n'envoient aucune métrique. Il enregistre ce qu'il trouve comme analyses IA, avec les preuves. OneUptime AI examine ensuite chacune d'elles et ouvre une pull request pour la corriger. Rien n'est jamais fusionné : votre équipe relit chaque pull request.

OneUptime lit de près les 10 métriques pour lesquelles vos services ont envoyé le plus de points de données dans l'heure, chacune avec au moins 1 000 points, et enregistre trois sortes de constats :

| Constat | Quand OneUptime l'enregistre | La pull request |
| --- | --- | --- |
| **Cardinalité élevée** | Un attribut que le code pose sur l'une de ces métriques a pris 1 000 valeurs ou plus dans l'heure, comme des identifiants d'utilisateur ou des URL complètes, si bien que chaque valeur est une série à part. Ou 50 noms de métriques ou plus d'un service sont un même nom avec un identifiant différent. | Cesse d'enregistrer la valeur sur la métrique, ou retire les identifiants de ses noms. |
| **Buckets d'histogramme incorrects** | L'une de ces métriques est un histogramme qui a enregistré 1 000 valeurs ou plus, dont 90 % ou plus sont tombées dans son plus petit bucket ou au-dessus du plus grand, ou il n'a aucun bucket, si bien que ses percentiles ne peuvent pas être distingués. | Donne à l'histogramme des buckets adaptés à ses valeurs, ou corrige son unité. |
| **Métriques manquantes** | Un service a envoyé 1 000 spans ou plus dans l'heure et n'a jamais envoyé de métrique. | Ajoute en métriques le nombre de requêtes, les erreurs et la durée de ses opérations les plus actives. |

Un constat ne stocke jamais les valeurs d'un attribut : seulement le nom de l'attribut, le nombre de valeurs qu'il a prises et leur forme.

### L'activer

**Métriques → IA → Paramètres** contient l'interrupteur **Améliorer les métriques et ajouter celles qui manquent**, activé pour les nouveaux projets. Avec **Activer l'IA** désactivé, les problèmes de vos métriques sont toujours trouvés, mais OneUptime AI n'en fait rien. Pour ouvrir des pull requests, OneUptime AI a besoin d'un dépôt connecté dans [Code](/docs/ai/ai-agent) : la page indique d'abord ce qui manque. Le code de chaque dépôt est modifié sur le Runner que le dépôt choisit dans Code.

OneUptime AI ouvre de lui-même au plus 5 pull requests par jour (UTC), une par constat, et jamais plus que la limite de pull requests IA ouvertes d'un dépôt.

### Règles IA

Sans règle, OneUptime AI examine immédiatement chaque problème qu'il trouve dans vos métriques et ouvre une pull request pour chacun de ceux qu'il peut corriger. Les **Règles IA** sous **Plus de paramètres** restreignent cela, en trois étapes :

| Étape | Ce qu'elle décide |
| --- | --- |
| **Correspondance** | Quels services : ceux choisis, ceux qui portent certaines étiquettes, ou ceux dont le nom correspond à un motif. |
| **Investiguer** | **Immédiatement**, ou **Seulement s'il est encore trouvé après une attente** : un problème qui disparaît pendant l'attente n'est pas examiné. |
| **Correction** | **Ne pas corriger**, **Demander avant de corriger** ou **Corriger sans demander**. Demander d'abord laisse la pull request à une personne : le constat propose **Corriger avec l'IA**. |

Sous **Plus de champs**, une règle choisit les dépôts de code, les serveurs MCP et le fournisseur de LLM qu'OneUptime AI peut utiliser pour elle. Si rien n'est choisi, il peut tous les utiliser, ainsi que le fournisseur de LLM par défaut du projet.

### Voir ce qu'il a fait

- **Métriques → IA → Analyses** liste ce qu'OneUptime a trouvé, chaque constat avec ses preuves et **Ouvrir dans Métriques**, qui ouvre sa métrique pour son service, de l'heure où il a été trouvé. Un service sans métriques propose plutôt **Ouvrir dans Traces** : les spans que ses métriques mesureraient.
- **Métriques → IA → Journaux** liste chaque investigation et chaque pull request, de la plus récente à la plus ancienne, avec l'état de chacune et ce que chaque investigation a trouvé.
- Dans Code, la tâche indique qu'OneUptime l'a lancée, avec un lien vers son constat, et la pull request explique pourquoi elle a été ouverte.

## Ce qui arrive aux métriques à leur arrivée

**Métriques → Paramètres → Règles de pipeline** modifie les métriques à leur arrivée, avant leur stockage. Les règles s'exécutent dans l'ordre de la liste, que vous changez en les faisant glisser ; une règle propre à un service passe avant les règles valables pour tous les services.

| Type de règle | Ce qu'il fait |
| --- | --- |
| Filtre (liste d'autorisation) | Garde seulement les points de données qui correspondent, et écarte le reste. |
| Supprimer | Écarte les points de données qui correspondent. |
| Renommer la métrique | Renomme la métrique. |
| Renommer l'attribut | Renomme la clé d'un attribut sur les points de données qui correspondent. |
| Ajouter un attribut | Ajoute un attribut aux points de données qui correspondent. |
| Supprimer l'attribut | Retire un attribut, par exemple un attribut aux valeurs trop nombreuses pour être utile. |
| Masquer l'attribut | Remplace la valeur d'un attribut par un espace réservé. |
| Échantillon | Garde un pourcentage des points de données qui correspondent. |

**Métriques → Paramètres → Règles d'enregistrement** calcule chaque minute de nouvelles métriques à partir d'autres métriques. Voir [Règles d'enregistrement de journaux](/docs/telemetry/log-recording-rules) pour le fonctionnement des règles d'enregistrement.

## Dépannage

:::details Le graphique d'un compteur ne fait que monter
C'est un compteur cumulatif. Activez **Convertir en taux par seconde** dans les **Paramètres d'affichage** de la requête.
:::

:::details La liste indique qu'aucune métrique n'a été trouvée
Effacez d'abord votre recherche et vos puces de filtre. Si la liste reste vide, aucune métrique n'a encore atteint OneUptime : comparez votre configuration avec le **Guide de configuration**.
:::

:::details Les métriques d'un service manquent
Filtrez le **Lecteur** sur ce **Service** et élargissez la plage de temps. Si elles manquent encore, la portée de votre rôle exclut peut-être ce service : voir [Télémétrie](/docs/permissions/index#télémétrie).
:::

## Étapes suivantes

:::cards
- [Surveillance des métriques](/docs/monitor/metrics-monitor): Être alerté quand une métrique franchit un seuil.
- [Créer un tableau de bord](/docs/dashboards/authoring): Placer vos graphiques côte à côte.
- [Syntaxe de recherche](/docs/telemetry/search-syntax): Chaque filtre que comprend la zone de recherche.
:::
