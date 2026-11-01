# Explorateur de traces

L'explorateur de traces retrouve les requêtes qui ont traversé vos services : les lentes, celles qui ont échoué, celles qui ont touché le compte d'un client précis. Cherchez et filtrez les spans que vos services envoient, puis ouvrez une trace pour voir chaque étape de la requête en cascade, en graphique en flammes ou en carte des services.

:::cards
- [Trouver une requête](#trouver-une-requête): Chercher des spans, puis filtrer par service, statut ou type.
- [Lire une trace](#lire-une-trace): Où le temps est passé, et quelle étape a échoué.
- [Représenter vos spans en graphiques](#représenter-vos-spans-en-graphiques): Nombres de requêtes et temps de réponse, regroupés à votre façon.
- [Analyses des traces](#analyses-des-traces): Taux d'erreur, latence et requêtes les plus lentes.
- [Trouver et corriger les opérations lentes ou en échec avec l'IA](#trouver-et-corriger-les-opérations-lentes-ou-en-échec-avec-lia): Des pull requests qui les corrigent, et ajoutent le traçage qui manque à une trace.
:::

## Traces et spans

Une trace est une requête sur son chemin à travers votre système. Chaque étape qu'elle franchit, comme un gestionnaire HTTP, une requête en base de données ou un appel à un autre service, est un span, et les spans s'imbriquent dans les spans qui les ont lancés. Le premier span d'une trace, sans parent, est son span racine : le point d'entrée de la requête.

```mermaid title="Une requête est une trace de spans imbriqués"
flowchart TB
    root["Span racine :<br/>POST /checkout"] --> auth["Span : vérifier<br/>la session"]
    root --> pay["Span : débiter<br/>la carte"]
    pay --> sql["Span : INSERT<br/>INTO orders"]
    pay --> call["Span : appeler le<br/>prestataire de paiement"]
```

Chaque ligne de l'explorateur est un span. Par défaut, la liste affiche les **Entry spans**, les spans où une requête ou un message entre dans un service : une requête apparaît donc une fois pour chaque service qu'elle atteint, tandis que les requêtes en base et les appels internes restent hors de la liste. Pour lister une ligne par requête, choisissez **Root spans** sous **Catégorie de span** dans la barre latérale ; pour lister chaque opération, choisissez **All spans**.

L'explorateur a cinq onglets :

| Onglet | À quoi il sert |
| --- | --- |
| **Lecteur** | Chercher et filtrer des spans, et ouvrir leurs traces. Il s'ouvre sur la dernière heure, les plus récents d'abord, 50 spans par page. |
| **Analyses** | Débits de requêtes, taux d'erreur et latence par service, et les requêtes qui méritent un coup d'œil. |
| **IA** | Les opérations lentes ou en échec et le traçage manquant qu'OneUptime trouve dans vos traces, et ce qu'OneUptime AI en a fait. Voir [Trouver et corriger les opérations lentes ou en échec avec l'IA](#trouver-et-corriger-les-opérations-lentes-ou-en-échec-avec-lia). |
| **Guide de configuration** | Comment envoyer des traces avec OpenTelemetry, avec l'une de vos [clés d'ingestion](/docs/telemetry/ingestion-keys). |
| **Paramètres** | Ce qui arrive aux spans à leur arrivée : **Pipelines**, **Filtres de suppression**, **Règles de masquage** et **Règles d'enregistrement**. |

## Avant de commencer

- **Des traces qui arrivent.** Instrumentez vos services avec [OpenTelemetry](/docs/telemetry/open-telemetry). L'onglet **Guide de configuration** montre le code pour votre langage.
- **Un rôle qui peut lire la télémétrie.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member ou Telemetry Viewer, ou un rôle personnalisé avec la permission Read Telemetry Service Traces. Sa portée décide de quels spans vous voyez : voir [Télémétrie](/docs/permissions/index#télémétrie).

## Trouver une requête

:::steps
### Ouvrir le Lecteur

Ouvrez **Produits → Observabilité → Traces**. Le **Lecteur** liste les spans de la dernière heure, les plus récents d'abord, chacun avec son statut, son service, son nom et sa durée.

### Choisir la plage de temps

Choisissez une plage dans le sélecteur de temps, ou faites glisser la souris sur le graphique au-dessus de la liste pour zoomer sur un pic. Double-cliquez sur le graphique pour dézoomer. Voir [Zoomer sur une plage temporelle](/docs/telemetry/charts-and-time-ranges).

### Chercher

Tapez une requête et appuyez sur Entrée, par exemple `service:checkout status:error duration:>500`. Les mots seuls cherchent dans les noms de span, et `@key:value` cherche dans un attribut comme `@http.route:/orders`. Voir [Syntaxe de recherche](/docs/telemetry/search-syntax#traces).

### Affiner avec des filtres

Cliquez sur une valeur de la barre latérale **Filtres** pour l'ajouter comme puce. La barre latérale filtre par **Service**, par l'hôte, le cluster ou l'autre ressource qui a envoyé le span, par **Statut**, **Catégorie de span**, **Possède une exception**, **Type de span**, **Nom du span**, **Instance de service** et **Nom de l'hôte**.

### Ouvrir un span

Cliquez sur une ligne pour la déplier : ses attributs, et les journaux et exceptions qu'elle a enregistrés. Cliquez sur **See full trace** pour ouvrir toute sa trace.
:::

Votre recherche, vos puces et la plage de temps sont gardées dans l'adresse de la page : un rafraîchissement, un favori ou un lien partagé ouvre les mêmes spans.

## Lire une trace

La page d'une trace commence par les chiffres de la requête :

| Chiffre | Ce que c'est |
| --- | --- |
| Durée | Le temps qu'a pris toute la requête. |
| Spans | Le nombre de spans de la trace. |
| Services | Le nombre de services que la requête a traversés. |
| Erreurs | Le nombre de spans terminés avec un statut d'erreur. Cliquez dessus pour n'afficher qu'eux. |
| Profondeur | La plus longue chaîne de spans imbriqués. |

En dessous, choisissez l'une des quatre vues :

| Vue | Ce qu'elle montre |
| --- | --- |
| **Cascade** | Chaque span sur une ligne de temps, imbriqué sous le span qui l'a lancé. Activez **Chemin critique** pour mettre en évidence la chaîne de spans qui a déterminé la durée de la requête. |
| **Graphique en flammes** | Le même arbre en barres empilées, où les barres les plus larges ont pris le plus de temps. |
| **Carte des services** | Les services que la requête a traversés, et les appels entre eux. |
| **Opérations** | Une ligne par service et nom de span, avec ses appels, ses erreurs, son temps propre et son temps total. Une opération appelée 10 fois ou plus depuis un même span parent est signalée : souvent une requête N+1 ou une boucle qu'on pourrait regrouper. |

Cliquez sur un span dans n'importe quelle vue pour ouvrir son panneau, avec des onglets pour ses attributs, ses événements, ses journaux, ses exceptions et ses liens, ainsi que son profil ou son appel LLM s'il en a un. Cherchez parmi les spans de la trace par nom, ID ou service avec la zone de recherche à côté des vues (appuyez sur `/`), et activez **Erreurs uniquement** pour ne garder que les spans en échec.

Une grande trace charge 500 spans à la fois. Cliquez sur le bouton en bas de la trace pour en charger davantage, ou tous.

> [!TIP]
> **Accélérer avec l'IA** n'apparaît que sur une trace qui vaut d'être corrigée : une trace avec une requête N+1, des appels faits les uns après les autres qui pourraient s'exécuter en parallèle, ou un appel qui prend l'essentiel de la requête, quand cela coûte un temps réel (100 ms ou plus pour les appels ensemble, 500 ms ou plus pour un seul appel, et au moins un dixième de la requête). Il indique ce qu'il a trouvé, par exemple « La même requête de base de données s'est exécutée 40 fois dans ReportService.build », et lance une tâche IA qui ouvre une pull request pour le corriger. Quand plusieurs dépôts sont connectés et qu'aucun ne correspond au service ou au code de la trace, il demande d'abord quel dépôt contient le code. Une fois qu'une correction de la trace a fait son travail, la trace renvoie vers sa tâche au lieu d'en proposer une seconde. Quand autre chose empêche l'IA de travailler, comme le forfait, des crédits IA épuisés ou aucun Runner en ligne, la trace indique quoi, avec le lien qui le règle. Voir [Code](/docs/ai/ai-agent).

## Représenter vos spans en graphiques

Le graphique au-dessus de la liste trace le nombre de spans dans le temps, réparti par statut. Choisissez une autre mesure dans l'en-tête du graphique pour tracer à la place leur temps de réponse moyen, médian (P50) ou P95.

Pour aller plus loin, passez la liste de **Spans** à **Analytique**. Choisissez une série temporelle, un classement ou un tableau ; mesurez des nombres de requêtes, des nombres d'erreurs ou des temps de réponse (moyenne, P50, P90, P95, P99, minimum ou maximum) ; et regroupez par nom de span, service, statut, type de span ou n'importe quel attribut, puis par un second champ. Un classement ou un tableau montre les 5 à 100 premiers groupes.

## Suivre, enregistrer et partager

- Cliquez sur **En pause** au-dessus de la liste pour activer les mises à jour en direct. Le bouton affiche alors **En direct**, et la liste cherche de nouveaux spans toutes les 10 secondes. Cliquez de nouveau pour mettre en pause.
- **Vues enregistrées** garde une recherche, ses filtres et la plage de temps sous un nom, pour tout le projet. Les vues enregistrées fonctionnent comme dans l'[Explorateur de journaux](/docs/telemetry/logs-explorer#enregistrer-une-vue).
- Les boutons **Journaux** et **Métriques** ouvrent ces explorateurs sur la même fenêtre de temps, avec autant de votre filtrage qu'ils peuvent en utiliser. Pointez un bouton pour voir ce qu'il ne peut pas reprendre.

## Analyses des traces

L'onglet **Analyses** résume les requêtes d'une plage de temps :

- le nombre de requêtes, le taux d'erreur, et la latence P50, P95 et P99 ;
- un tableau de santé de vos services, trié par taux d'erreur, pour que les services qui demandent de l'attention viennent en premier ;
- les requêtes en échec les plus récentes, et les plus lentes.

Limitez-le à certains services avec la liste déroulante à côté du sélecteur de temps.

## Trouver et corriger les opérations lentes ou en échec avec l'IA

Chaque heure, OneUptime parcourt les traces de la dernière heure de chaque service à la recherche d'opérations lentes, qui échouent ou dont les traces ne disent pas pourquoi, et enregistre ce qu'il trouve comme analyses IA, avec les preuves. OneUptime AI examine ensuite chacune d'elles et ouvre une pull request pour la corriger. Rien n'est jamais fusionné : votre équipe relit chaque pull request.

Une opération, ce sont les spans d'un même nom dans un service, comme `GET /orders`. OneUptime lit un service dès qu'il a envoyé au moins 100 spans dans la dernière heure, et enregistre trois sortes de constats :

| Constat | Quand OneUptime l'enregistre | La pull request |
| --- | --- | --- |
| **Opération lente** | Le P99 de l'opération est de 1 seconde ou plus sur au moins 20 spans, et sa requête la plus lente répète un motif qui coûte du temps réel : le même appel fait encore et encore, des appels faits l'un après l'autre qui pourraient s'exécuter en parallèle, ou un appel qui prend l'essentiel de la requête. | Rend l'opération plus rapide. |
| **Opération en échec** | Au moins 20 spans de l'opération ont échoué, 5 % ou plus d'entre eux, et les échecs les plus récents disent pourquoi, avec une exception ou un message d'erreur. | Corrige la cause de l'échec. |
| **Traçage manquant** | Les traces ne disent pas pourquoi : chacun des 500 spans ou plus d'un service était la racine de sa trace, sans aucun span du service en dessous, une requête lente a passé 60 % ou plus de son temps (et 500 ms ou plus) dans un span sous lequel rien n'est tracé, ou les échecs d'une opération n'ont enregistré ni message d'erreur ni exception. | Ajoute le traçage qui manque. |

OneUptime AI n'ouvre de lui-même la pull request d'une opération en échec qu'une fois qu'il a trouvé le code en cause. Un échec qui vient d'ailleurs, comme une dépendance en panne, n'obtient aucune pull request, sauf si quelqu'un en demande une avec **Corriger avec l'IA**.

### L'activer

**Traces → IA → Paramètres** contient l'interrupteur **Trouver et corriger les opérations lentes ou en échec**, activé pour les nouveaux projets. Avec **Activer l'IA** désactivé, les opérations lentes ou en échec sont toujours trouvées, mais OneUptime AI n'en fait rien. Pour ouvrir des pull requests, OneUptime AI a besoin d'un dépôt connecté dans [Code](/docs/ai/ai-agent) : la page indique d'abord ce qui manque. Le code de chaque dépôt est modifié sur le Runner que le dépôt choisit dans Code.

OneUptime AI ouvre de lui-même au plus 5 pull requests par jour (UTC), une par constat, et jamais plus que la limite de pull requests IA ouvertes d'un dépôt.

### Règles IA

Sans règle, OneUptime AI examine immédiatement chaque problème qu'il trouve dans vos traces et ouvre une pull request pour chacun de ceux qu'il peut corriger. Les **Règles IA** sous **Plus de paramètres** restreignent cela, en trois étapes :

| Étape | Ce qu'elle décide |
| --- | --- |
| **Correspondance** | Quels services : ceux choisis, ceux qui portent certaines étiquettes, ou ceux dont le nom correspond à un motif. |
| **Investiguer** | **Immédiatement**, ou **Seulement s'il est encore trouvé après une attente** : un problème qui disparaît pendant l'attente n'est pas examiné. |
| **Correction** | **Ne pas corriger**, **Demander avant de corriger** ou **Corriger sans demander**. Demander d'abord laisse la pull request à une personne : le constat propose **Corriger avec l'IA**. |

Sous **Plus de champs**, une règle choisit les dépôts de code, les serveurs MCP et le fournisseur de LLM qu'OneUptime AI peut utiliser pour elle. Si rien n'est choisi, il peut tous les utiliser, ainsi que le fournisseur de LLM par défaut du projet.

### Voir ce qu'il a fait

- **Traces → IA → Analyses** liste ce qu'OneUptime a trouvé, chaque constat avec ses preuves et **Ouvrir dans Traces**, qui ouvre les spans concernés, de l'heure où il a été trouvé, dans le **Lecteur**. Sur une opération en échec, **Créer un moniteur** configure un moniteur de traces sur ses spans en échec.
- **Traces → IA → Journaux** liste chaque investigation et chaque pull request, de la plus récente à la plus ancienne, avec l'état de chacune et ce que chaque investigation a trouvé.
- Dans Code, la tâche indique qu'OneUptime l'a lancée, avec un lien vers son constat, et la pull request explique pourquoi elle a été ouverte.

## Ce qui arrive aux spans à leur arrivée

L'onglet **Paramètres** contient les règles que OneUptime applique aux spans à leur arrivée, comme pour les journaux. Elles agissent sur les spans qui arrivent ensuite, pas sur ceux déjà stockés. La durée de conservation de chaque span est elle aussi décidée à son arrivée : voir [Rétention des données](/docs/telemetry/data-retention).

| Règle | Ce qu'elle fait |
| --- | --- |
| **Filtres de suppression** | Écarter les spans que vous ne voulez pas garder, ou n'en garder qu'un échantillon. Voir [Supprimer ou échantillonner des enregistrements](/docs/telemetry/drop-filters-and-scrub-rules#supprimer-ou-échantillonner-des-enregistrements). |
| **Règles de masquage** | Masquer les données sensibles dans les attributs des spans. Voir [Masquer les données sensibles](/docs/telemetry/drop-filters-and-scrub-rules#masquer-les-données-sensibles). |
| **Pipelines** | Modifier et enrichir les spans : chaque pipeline retient des spans avec un filtre, puis exécute ses processeurs dans l'ordre. |
| **Règles d'enregistrement** | Transformer chaque minute les nombres de spans, les nombres d'erreurs et les durées en nouvelles métriques. Voir [Règles d'enregistrement de journaux](/docs/telemetry/log-recording-rules). |

## Dépannage

:::details Une trace indique qu'aucun span n'a été trouvé
Les spans arrivent en général dans la minute qui suit la fin de la requête. Cliquez sur **Actualiser** sur la page de la trace pour vérifier de nouveau.
:::

:::details Certains spans sont au premier niveau de la cascade
Ils nomment un span parent que OneUptime n'a pas reçu, souvent parce que le service qui a écrit le parent n'envoie pas encore ses traces à OneUptime. Instrumentez aussi ce service.
:::

:::details La liste montre bien plus de lignes que de requêtes
Chaque ligne est un span, pas une requête : avec **Entry spans**, la valeur par défaut, une requête apparaît une fois pour chaque service qu'elle atteint, et avec **All spans**, une fois pour chaque opération. Choisissez **Root spans** sous **Catégorie de span** dans la barre latérale pour lister une ligne par requête.
:::

## Étapes suivantes

:::cards
- [Syntaxe de recherche](/docs/telemetry/search-syntax): Chaque filtre que comprend la zone de recherche.
- [Surveillance des traces](/docs/monitor/traces-monitor): Être alerté des requêtes en échec ou lentes.
- [Suivi des exceptions](/docs/telemetry/exceptions): Trier les erreurs que vos spans enregistrent.
- [Explorateur de journaux](/docs/telemetry/logs-explorer): Lire les lignes de journal qu'une requête a écrites.
:::
