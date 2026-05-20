# Présentation des workflows

Les workflows sont le constructeur d'automatisation visuel de OneUptime. Glissez un déclencheur sur un canevas, reliez-le à une chaîne d'actions — appels HTTP, messages Slack, extraits JavaScript, branches conditionnelles, requêtes de base de données — et vous obtenez une automatisation qui s'exécute chaque fois qu'un événement dans OneUptime (ou dans le monde extérieur) se déclenche.

Si les runbooks sont des listes de contrôle pour les humains pendant un incident, les workflows sont des tâches d'arrière-plan pour votre projet — ils s'exécutent sans surveillance, ils réagissent à des événements et ils relient OneUptime au reste de votre stack.

## En un coup d'œil

- **Fonctionnalité de premier niveau** dans le tableau de bord OneUptime, sous **Workflows**.
- **Trois styles de déclencheurs** : Manuel, Planifié (cron), Webhook — plus un **déclencheur d'événement de modèle** qui se déclenche lorsqu'une entité OneUptime (incident, alerte, monitor, status page, etc.) est créée, modifiée ou supprimée.
- **Canevas visuel** : glissez des nœuds depuis une palette de composants, connectez les ports de sortie aux ports d'entrée.
- **Automatisation mixte** : requêtes HTTP, messages Slack / Discord / Microsoft Teams / Telegram, JavaScript personnalisé, analyse JSON, conditionnels, e-mail, appels de sous-workflows et opérations CRUD sur les modèles OneUptime.
- **Variables globales** : secrets et configurations à l'échelle du projet que vous référencez depuis n'importe quel workflow sans copier-coller.
- **Exécutions et journaux** : chaque exécution est enregistrée avec son statut, son timing et la sortie de chaque étape.

## Pourquoi utiliser des workflows ?

La plupart des équipes se tournent vers les workflows lorsqu'elles veulent :

- **Connecter OneUptime à un autre système** — publier un incident vers PagerDuty, dupliquer une alerte dans Jira, pinguer un webhook dans votre stack.
- **Réagir aux événements OneUptime** — quand un incident `Sev 1` s'ouvre, alerter le manager d'astreinte *et* créer un ticket Linear *et* verrouiller un feature flag.
- **Planifier des tâches récurrentes** — toutes les cinq minutes, interroger une API interne et écrire le résultat dans un système externe.
- **Recevoir des données depuis l'extérieur de OneUptime** — un webhook depuis un système CI déclenche une chaîne de mises à jour OneUptime.
- **Réutiliser de petits morceaux de logique de glu** — un workflow en appelle un autre, ainsi les motifs communs vivent à un seul endroit.

## Concepts clés

| Terme | Signification |
| --- | --- |
| **Workflow** | Le canevas. Un graphe nommé et réutilisable de déclencheurs et de composants avec un drapeau `isEnabled`. |
| **Déclencheur** | Le nœud qui démarre une exécution de workflow. Manuel, Planifié, Webhook ou un événement de modèle. Chaque workflow a exactement un déclencheur. |
| **Composant** | Un nœud qui fait un travail — un appel HTTP, un message Slack, un extrait JavaScript, un conditionnel, etc. |
| **Port** | Une prise d'entrée ou de sortie sur un nœud. Les composants ont des ports de sortie comme `success` et `error` ; vous connectez un port au port d'entrée du nœud suivant. |
| **Exécution / Journal** | Une exécution d'un workflow. Contient l'horodatage, le statut (Running, Success, Failed, Timeout) et la sortie capturée de chaque nœud qui s'est exécuté. |
| **Variable globale** | Une valeur nommée (souvent un secret ou une clé d'API) définie une fois au niveau du projet et référencée depuis n'importe quel workflow par `{{variable.NAME}}`. |
| **Variable locale** | Une valeur à portée d'une seule exécution de workflow — typiquement la valeur de retour d'un nœud antérieur, référencée par `{{ComponentId.portName}}`. |

## Où vivent les workflows dans le tableau de bord

| Page | Ce que vous y faites |
| --- | --- |
| **Workflows** | Parcourir, créer et rechercher des modèles de workflow. |
| **Onglet Builder d'un workflow** | Le canevas glisser-déposer. Ajoutez des nœuds, connectez les ports, configurez les arguments. |
| **Onglet Logs d'un workflow** | Chaque exécution de ce workflow avec des filtres par statut et par plage temporelle. Cliquez sur une exécution pour voir la sortie par nœud. |
| **Onglet Settings d'un workflow** | Renommer, activer/désactiver, modifier la description, gérer les étiquettes, supprimer. |
| **Workflows → Global Variables** | Définir les valeurs à l'échelle du projet référencées depuis n'importe quel workflow. Marquez une valeur comme secret pour la masquer dans l'interface après l'enregistrement. |
| **Workflows → Runs & Logs** | Historique d'exécution à l'échelle du projet sur tous les workflows. |

## Le cycle de vie d'un workflow

1. **Rédiger** — Créez un workflow, déposez un déclencheur sur le canevas, glissez les composants dont vous avez besoin, connectez-les et configurez chacun.
2. **Activer** — Les workflows sont livrés désactivés. Basculez l'interrupteur dans Settings une fois confiant que le câblage est correct.
3. **Déclencher** — Manuel : cliquez sur **Run Manually** avec une charge utile JSON optionnelle. Planifié : cron se déclenche. Webhook : un système externe fait un `POST` vers l'URL du workflow. Événement de modèle : quelqu'un (ou un autre workflow) crée/modifie/supprime un monitor, un incident, une alerte, etc.
4. **Exécuter** — Le Workflow Worker parcourt le graphe dans l'ordre. Chaque composant lit ses arguments (valeurs littérales ou variables interpolées), fait son travail, écrit sa valeur de retour et choisit un port de sortie. Le nœud suivant se déclenche.
5. **Auditer** — L'exécution apparaît dans **Logs**. Le statut, la durée totale, la sortie par composant et toute erreur sont conservés pendant toute la durée de vie du projet.

## Un exemple détaillé

Objectif : lorsqu'un incident est créé avec `Sev 1` dans le titre, publier dans un canal Slack et ouvrir un ticket dans votre outil d'administration interne.

**1. Créez un workflow** nommé « Sev 1 fan-out ».

**2. Déposez un déclencheur.** Choisissez le déclencheur **Incident → On Create** depuis la palette. Le déclencheur expose le nouvel incident comme valeur de retour.

**3. Déposez un composant Conditional.** Connectez le port de sortie du déclencheur à son entrée. Définissez la condition : `{{Incident.title}}` *contient* `Sev 1`.

**4. Depuis le port `yes` du Conditional, déposez un composant Slack.** Canal : `#incident-room`. Corps du message : `Sev 1 declared: {{Incident.title}} — {{Incident.dashboardUrl}}`.

**5. Depuis le même port `yes` (en parallèle), déposez un composant API.** `POST` vers `https://admin.internal/incidents`. Corps : un petit objet JSON construit à partir de l'incident.

**6. Activez le workflow.** Ouvrez un incident intitulé « Sev 1 — checkout 500s » dans un autre onglet. En quelques secondes, le message Slack arrive et une nouvelle exécution apparaît sous **Logs** avec la sortie de chaque nœud capturée.

## Comment les workflows s'intègrent au reste de OneUptime

- **Les monitors** détectent les problèmes ; **les incidents/alertes** les enregistrent ; **les workflows** y réagissent — publient des messages, ouvrent des tickets, lancent des automatisations.
- **Les runbooks** sont des procédures de réponse pour les humains (avec des étapes de script optionnelles). Les workflows sont des automatisations d'arrière-plan sans surveillance. Ils sont complémentaires — une étape de runbook peut faire un `POST` vers un déclencheur webhook d'un workflow.
- **Les connexions d'espace de travail** (Slack, Microsoft Teams) sont les destinations typiques des notifications de workflow.
- **Les tableaux de bord** sont des vues en lecture seule ; les workflows sont le côté écriture — ils mettent à jour l'état OneUptime, appellent des API externes et déplacent des données.

## Où lire ensuite

- [Créer un workflow](/docs/workflows/authoring) — construire un workflow sur le canevas, configurer les nœuds, câbler les ports.
- [Déclencheurs](/docs/workflows/triggers) — Manuel, Planifié, Webhook et déclencheurs d'événements de modèle en détail.
- [Composants](/docs/workflows/components) — le catalogue des actions et comment configurer chacune.
- [Variables](/docs/workflows/variables) — variables globales, variables locales et fonctionnement de l'interpolation.
- [Exécutions et journaux](/docs/workflows/runs-and-logs) — lecture de l'historique d'exécution, débogage des échecs.
- [Configuration et sécurité](/docs/workflows/configuration) — activation/désactivation, propriété, étiquettes, secrets, limites de récursion.
