# Vue d'ensemble des Runbooks

Un runbook est une procédure de réponse réutilisable : une liste ordonnée d'étapes manuelles et automatisées que vous exécutez sur un incident, une alerte ou un événement de maintenance planifiée. Il transforme le fil « on fait quoi maintenant ? » en une checklist que toute personne d'astreinte peut suivre à 3 h du matin, avec les scripts, les appels d'API et les approbations déjà écrits. Les runbooks s'adressent aux ingénieurs d'astreinte qui répondent aux incidents et aux équipes plateforme qui automatisent cette réponse.

:::cards
- [Rédiger un runbook](/docs/runbooks/authoring): Créer un runbook et écrire ses étapes.
- [Règles de runbook](/docs/runbooks/rules): Démarrer des runbooks sur les nouveaux incidents, alertes et événements de maintenance.
- [Exécuter un runbook](/docs/runbooks/running): Lancer une exécution, terminer et approuver ses étapes, l'annuler.
- [Déclencheurs de runbook](/docs/runbooks/triggers): Exécuter un runbook selon une planification, ou depuis un autre outil via son URL de webhook.
- [Variables de runbook](/docs/runbooks/variables): Les hôtes, clés, mots de passe et kubeconfigs que vos étapes utilisent par leur nom.
- [Agents de runbook](/docs/runbooks/agents): Installer l'agent Runbook qui exécute vos scripts dans votre propre infrastructure.
:::

## Comment un runbook s'exécute

```mermaid title="D'un déclencheur à un résultat enregistré"
flowchart TB
    subgraph triggers["Ce qui lance une exécution"]
        direction LR
        rule["Règle de<br/>runbook"]
        manual["Exécuter le<br/>Runbook sur<br/>un événement"]
        runnow["Run Now sur<br/>le runbook"]
    end
    rule --> execution["Exécution :<br/>un instantané<br/>des étapes"]
    manual --> execution
    runnow --> execution
    execution --> worker["Le Worker<br/>OneUptime<br/>traite les<br/>étapes dans<br/>l'ordre"]
    worker -->|"Étape Manual<br/>ou approbation"| person["Attend une<br/>personne"]
    worker -->|"Étapes<br/>HTTP et IA"| onworker["S'exécute<br/>sur le Worker"]
    worker -->|"JavaScript,<br/>Bash, SSH,<br/>kubectl"| runner["Agent Runbook<br/>dans votre<br/>infrastructure"]
    person --> record["Statut, sortie<br/>et erreurs<br/>enregistrés"]
    onworker --> record
    runner --> record
    record --> history["Page Runbooks<br/>de l'événement<br/>et Exécutions<br/>du runbook"]
```

Chaque exécution d'un runbook est une **exécution**. Au démarrage, les étapes du runbook y sont copiées, et OneUptime les traite dans l'ordre. Une étape Manual, ou une étape qui exige une approbation, met l'exécution en pause jusqu'à ce que quelqu'un agisse.

Les étapes HTTP et IA s'exécutent sur le Worker OneUptime. Les étapes Bash, SSH et kubectl s'exécutent sur un [agent Runbook](/docs/runbooks/agents) que vous installez dans votre propre infrastructure, de sorte que ces scripts ne s'exécutent jamais sur les serveurs d'OneUptime. Une étape JavaScript s'exécute elle aussi sur l'un de vos agents ou, si elle n'en choisit aucun et que le projet n'a pas d'[agent Runbook par défaut](/docs/runbooks/agents#lagent-runbook-par-défaut-du-projet), sur un [agent Runbook global](/docs/runbooks/agents#agents-runbook-globaux), dans un bac à sable qui n'atteint qu'Internet. Le statut, la sortie et le message d'erreur de chaque étape sont enregistrés sur l'exécution, qui reste attachée à l'incident, à l'alerte ou à l'événement pour lequel elle a tourné.

## Concepts clés

| Terme | Signification |
| --- | --- |
| **Runbook** | Le modèle. Une procédure nommée et réutilisable, avec une liste ordonnée d'étapes et un interrupteur **Exécuter ce runbook**. |
| **Étape** | Un élément d'un runbook. Elle a un type (Manual, JavaScript, HTTP request, Bash, SSH, kubectl ou AI), un titre, une description et des réglages propres à son type. |
| **Règle de runbook** | Une règle qui attache automatiquement un ou plusieurs runbooks aux incidents, alertes ou événements de maintenance planifiée qui remplissent ses conditions : leurs moniteurs, leur gravité, leurs étiquettes, les étiquettes de leurs moniteurs, leur titre ou leur description. |
| **Exécution** | Une exécution d'un runbook. Elle est créée quand une règle se déclenche, quand quelqu'un clique sur **Exécuter le Runbook** sur un événement, ou quand quelqu'un clique sur **Run Now** sur le runbook lui-même. Elle contient un instantané des étapes ainsi que le statut et la sortie de chaque étape. |
| **Instantané** | La copie figée des étapes du runbook qui vit sur chaque exécution. Vous pouvez modifier le runbook plus tard sans réécrire l'historique des exécutions passées. |
| **Agent Runbook** | Un petit agent que vous faites tourner sur un hôte de votre propre infrastructure. Il exécute les étapes JavaScript, Bash, SSH et kubectl qui le désignent. Aussi appelé Runner. Un agent Runbook global, l'un de ceux qu'OneUptime fait tourner pour chaque projet, exécute les étapes JavaScript qui n'en nomment aucun, sauf si le projet a un agent Runbook par défaut. |
| **Variable** | Une valeur que les étapes utilisent par son nom, comme un hôte ou une URL : `{{global.variables.NAME}}` pour une variable du projet, que chaque runbook peut utiliser, ou `{{local.variables.NAME}}` pour une variable propre au runbook. |
| **Secret** | Une variable dont la valeur est chiffrée au repos, n'est plus jamais affichée et est masquée dans ce que les étapes affichent, comme une clé SSH, un mot de passe, un kubeconfig ou un jeton d'API. Remis uniquement aux agents Runbook que vous autorisez à l'utiliser ; les agents Runbook globaux ne le reçoivent que si vous les y autorisez. |

## Types d'étapes

Choisissez le type qui convient à chaque étape. [Rédiger un runbook](/docs/runbooks/authoring) détaille les réglages de chaque type.

| Type d'étape | S'exécute sur | À utiliser quand… | Exemple |
| --- | --- | --- | --- |
| **Manual** | Une personne | Un humain doit vérifier quelque chose, trancher, ou agir là où OneUptime ne le peut pas. | « Confirmer que le trafic est passé dans la région secondaire. » |
| **JavaScript** | Un agent Runbook | Vous avez besoin d'un petit calcul isolé, dans un bac à sable. | Calculer le retard de réplication et décider de continuer ou non. |
| **HTTP request** | Le Worker OneUptime | Vous appelez une API existante : un fournisseur cloud, PagerDuty, un webhook Slack, votre propre service. | `POST` vers votre orchestrateur de bascule. |
| **Bash** | Un agent Runbook | Vous avez besoin de commandes shell sur votre propre infrastructure. | Lancer un script de reprise, ou interroger avec `curl` un service que seul votre réseau atteint. |
| **SSH** | Un agent Runbook | Vous avez besoin d'un script bash sur une machine distante, connecté avec une variable secrète. | Redémarrer un service sur un serveur web. |
| **kubectl** | Un agent Runbook | Vous avez besoin de commandes kubectl sur un cluster. | Redémarrer `checkout-api` dans `production`, puis attendre ses nouveaux pods. |
| **AI** | Le Worker OneUptime | Vous voulez une analyse, un résumé ou un avis en cours d'exécution, fourni par le fournisseur LLM de votre projet. | « Examine les diagnostics ci-dessus. La bascule est-elle sûre ? » |

Un runbook peut tous les mélanger. La force des runbooks est d'entremêler des vérifications humaines, de l'automatisation et de l'analyse par IA.

## Ce qui lance une exécution

| Comment | Où | L'exécution est attachée à |
| --- | --- | --- |
| Une règle de runbook | **Incidents**, **Alertes** ou **Maintenance planifiée** → **Règles** → **Règles de runbook** | Le nouvel incident, la nouvelle alerte ou le nouvel événement |
| **Exécuter le Runbook** | La page **Runbooks** d'un incident, d'une alerte ou d'un événement de maintenance planifiée | Cet événement |
| **Run Now** | La page **Vue d'ensemble** du runbook | Rien : une exécution ponctuelle |
| Une règle IA | Voir [AI SRE](/docs/ai/ai-sre) | L'incident ou l'alerte |
| La planification du runbook | La page **Déclencheurs** du runbook, voir [Déclencheurs de runbook](/docs/runbooks/triggers#exécuter-selon-une-planification) | Rien : une exécution sans surveillance |
| Un appel à l'URL de webhook du runbook | La page **Déclencheurs** du runbook, voir [Déclencheurs de runbook](/docs/runbooks/triggers#appeler-le-webhook) | Rien : l'exécution conserve les valeurs envoyées par l'appel |

Un runbook dont l'interrupteur **Exécuter ce runbook** est désactivé, sur sa page **Paramètres**, n'est lancé par aucun de ces moyens. Les exécutions déjà démarrées continuent.

## Où se trouvent les runbooks dans le tableau de bord

Runbooks se trouve sous **Produits**, dans le groupe **Tableaux de bord et automatisation**.

| Page | Ce que vous y faites |
| --- | --- |
| **Produits → Runbooks** | Parcourir, créer et ouvrir des runbooks. |
| Les **Étapes** d'un runbook | Écrire et réordonner ses étapes, puis **Save Steps**. |
| La **Vue d'ensemble** d'un runbook | Voir sa dernière exécution et ses résultats, et cliquer sur **Run Now**. |
| Les **Exécutions** d'un runbook | Toutes les exécutions de ce runbook, filtrées par statut ou date de début. |
| Les **Déclencheurs** d'un runbook | L'exécuter selon une [planification](/docs/runbooks/triggers#exécuter-selon-une-planification), ou depuis un autre outil via son [URL de webhook](/docs/runbooks/triggers#appeler-le-webhook). |
| Les **Variables** d'un runbook | Gérer les [variables](/docs/runbooks/variables) que seules les étapes de ce runbook utilisent. |
| Les **Propriétaires** d'un runbook | Ajouter les personnes et les équipes qui en sont responsables. |
| Les **Paramètres** d'un runbook | Désactiver **Exécuter ce runbook** sans supprimer le runbook. |
| **Runbooks → Exécutions** | Toutes les exécutions de tous les runbooks du projet. |
| **Runbooks → Agents de runbook** | Installer les [agents Runbook](/docs/runbooks/agents) sur lesquels s'exécutent les étapes de vos runbooks. |
| **Runbooks → Paramètres** | Gérer, sous **Variables globales**, les variables que chaque runbook peut [utiliser](/docs/runbooks/variables), ainsi que les **Règles de propriétaire** et les **Règles d'étiquettes** qui ajoutent des propriétaires et des étiquettes aux nouveaux runbooks. |
| **Incidents / Alertes / Maintenance planifiée → Règles → Règles de runbook** | Créer les règles qui lancent des runbooks automatiquement. |
| Un incident, une alerte ou un événement de maintenance → **Runbooks** | Voir les exécutions qui y sont attachées, et cliquer sur **Exécuter le Runbook** pour en lancer une. |

Le menu latéral d'un runbook regroupe ses pages ainsi. Seule **Basique** est ouverte au départ : cliquez sur le titre d'une section pour l'ouvrir. Une section s'ouvre d'elle-même sur toute page qu'elle contient.

| Section | Pages |
| --- | --- |
| **Basique** | **Vue d'ensemble**, **Étapes** |
| **Journaux** | **Exécutions** |
| **Propriétaires** | **Propriétaires** |
| **Paramètres** | **Déclencheurs**, **Variables**, **Paramètres** |
| **Développeurs** | **Terraform**, **API**, **Assistants IA** |
| **Avancé** | **Journaux d'audit**, **Supprimer le runbook** |

## Un exemple complet

Supposons que chaque incident dont le titre contient « db-primary » doive lancer un runbook de bascule de base de données en cinq étapes.

:::steps
### Créer le runbook

Sous **Runbooks**, cliquez sur **Créer : Runbook** et nommez-le « DB primary failover ». Il s'ouvre sur **Étapes** : ajoutez ces étapes, puis cliquez sur **Save Steps** :

| # | Type | Titre |
| --- | --- | --- |
| 1 | JavaScript | Relever le retard de réplication avant la bascule |
| 2 | Manual | Confirmer dans le tableau de bord DBA que le réplica est sain |
| 3 | HTTP request | `POST` vers l'orchestrateur de bascule |
| 4 | Manual | Vérifier que les écritures vont vers le nouveau primaire |
| 5 | HTTP request | Publier la fin d'alerte dans `#db-incidents` sur Slack |

### Ajouter une règle

Sous **Incidents → Règles → Règles de runbook**, créez une règle avec une condition et le runbook à lancer :

```text
Conditions:  Incident Title starts with db-primary
Runbooks:    [DB primary failover]
```

### La laisser tourner

Un moniteur ouvre l'incident `INC-4821 · db-primary connection timeout`. La règle correspond et une exécution démarre :

- L'étape 1 (JavaScript) s'exécute sur l'agent Runbook que vous avez choisi pour elle. Sa valeur de retour, par exemple `{ lagMs: 412 }`, est capturée. Une étape qui ne choisit aucun agent s'exécute sur l'agent Runbook par défaut du projet ou, s'il n'y en a pas, sur un agent Runbook global.
- L'étape 2 (Manual) met l'exécution en pause, qui affiche **En attente de votre part**. La personne d'astreinte vérifie le tableau de bord et clique sur **Marquer comme terminé**.
- L'étape 3 (HTTP request) s'exécute, et la réponse au `POST` est capturée.
- L'étape 4 (Manual) remet l'exécution en pause jusqu'à ce que quelqu'un la termine.
- L'étape 5 (HTTP request) s'exécute, et l'exécution passe à **Achevé**.

### L'examiner

L'exécution reste sur la page **Runbooks** de l'incident. Quand vous rédigez le postmortem, la sortie, l'erreur et le minutage de chaque étape sont à un clic.
:::

## Cas d'usage courants

- **Bascule de base de données** : capturer l'état avec JavaScript, demander au DBA d'astreinte de confirmer la santé du réplica (Manual), appeler l'orchestrateur (HTTP request), confirmer le DNS (Manual), publier la fin d'alerte (HTTP request).
- **Vidage de cache** : une requête HTTP, puis une étape Manual « confirmer que le taux de succès du cache se rétablit ».
- **Incident avec impact client** : Manual « publier une mise à jour sur la page de statut », une requête HTTP pour prévenir l'équipe support, JavaScript pour récupérer la liste des comptes touchés.
- **Vérification avant une maintenance planifiée** : relever des métriques, confirmer la fenêtre de changement avec les parties prenantes (Manual), activer le mode maintenance sur le répartiteur de charge (HTTP request).
- **Diagnostiquer, puis corriger** : une étape Bash collecte des diagnostics, une étape IA les lit et recommande une correction, et une étape kubectl avec **Exiger une approbation** ne redémarre la charge de travail qu'une fois qu'une personne l'a approuvée.
- **Hygiène systématique** : une règle sans condition qui capture l'état du système à chaque incident, pour le postmortem.

## Comment les runbooks s'intègrent au reste d'OneUptime

- Les **moniteurs** ouvrent des incidents et des alertes, et les **règles de runbook** les transforment en exécutions de runbook : détecter, déclencher, répondre, enregistrer.
- Les **[politiques d'astreinte](/docs/on-call/schedules)** décident qui est alerté. Les runbooks décident de ce que cette personne fait une fois réveillée.
- Les **[connexions d'espace de travail](/docs/workspace-connections/slack)** comme Slack et Microsoft Teams sont des cibles naturelles pour des étapes de requête HTTP qui publient des mises à jour.
- Les **[pages de statut](/docs/status-pages/index)** sont souvent mises à jour par une étape Manual d'un runbook orienté client.

## Prochaines étapes

:::cards
- [Rédiger un runbook](/docs/runbooks/authoring): Créer votre premier runbook et ses étapes.
- [Agents de runbook](/docs/runbooks/agents): Installer un agent Runbook avant d'écrire une étape Bash, SSH ou kubectl.
- [Règles de runbook](/docs/runbooks/rules): Lancer des runbooks automatiquement à la création d'incidents.
- [Configuration & sécurité des runbooks](/docs/runbooks/configuration): Limites, délais, autorisations et durcissement.
:::
