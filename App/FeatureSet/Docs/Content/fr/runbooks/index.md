# Vue d'ensemble des Runbooks

Les runbooks sont des procédures de réponse réutilisables — des listes ordonnées d'étapes manuelles ou automatisées — que vous attachez aux incidents, alertes ou événements de maintenance planifiée. Ils transforment les discussions Slack ad hoc « qu'est-ce qu'on fait maintenant ? » en quelque chose qu'un collègue peut reprendre à 3 h du matin sans contexte préalable.

## En un coup d'œil

- **Fonctionnalité de premier niveau** dans le tableau de bord OneUptime, sous **Analyse & Automatisation → Runbooks**.
- **Quatre types d'étapes** : liste manuelle, JavaScript (en bac à sable) et Bash (tous deux tournent sur un [Agent de runbook](/docs/runbooks/agents) dans votre propre infrastructure), requête HTTP.
- **Trois voies de déclenchement** : règles qui correspondent à des incidents/alertes/maintenances planifiées, ou bouton manuel « Exécuter le runbook » sur tout événement.
- **Sémantique de snapshot** : au démarrage d'un runbook, ses étapes sont copiées dans l'exécution. Modifier le modèle ensuite ne change jamais une exécution en cours.
- **Piste d'audit complète** : le statut, la sortie, le message d'erreur et la durée de chaque étape sont conservés à jamais sur l'exécution.

## Pourquoi utiliser des runbooks ?

La gestion des incidents fait souvent la différence entre une panne d'une minute et une indisponibilité de plusieurs heures. Les runbooks vous aident à :

- **Codifier la connaissance tacite** — la réponse à « que faire quand la file s'accumule ? » se trouve à un endroit où votre équipe peut la consulter.
- **Réduire le temps moyen de récupération (MTTR)** — les étapes automatisées s'exécutent en secondes ; les étapes manuelles éliminent la paralysie décisionnelle.
- **Auditer les actions de réponse** — chaque étape exécutée, chaque sortie, chaque clic du répondeur est enregistré dans l'exécution.
- **Rendre les juniors autonomes** — ils peuvent exécuter un runbook avec confiance plutôt que d'appeler un senior à 3 h du matin.
- **Écrire les postmortems à partir des données, pas de la mémoire** — l'exécution capturée est un enregistrement figé de ce qui s'est réellement passé.

## Concepts clés

Quelques termes reviennent dans toute la documentation runbook. Clarifions-les d'abord :

| Terme | Signification |
| --- | --- |
| **Runbook** | Le modèle. Une procédure nommée et réutilisable, avec une liste ordonnée d'étapes et un drapeau `isEnabled`. |
| **Étape** | Un élément d'un runbook. Possède un type (Manuelle / JavaScript / HTTP / Bash), un titre, une description et une configuration spécifique au type. |
| **Règle de runbook** | Un motif qui attache automatiquement un ou plusieurs runbooks à des incidents, alertes ou maintenances planifiées lorsque leur titre ou description correspond à une expression régulière. |
| **Exécution** | Une exécution d'un runbook. Créée lorsqu'une règle se déclenche, lorsqu'on clique « Exécuter le runbook » sur un événement, ou lorsqu'on clique « Exécuter maintenant » sur le runbook lui-même. Contient un snapshot des étapes ainsi que le statut et la sortie de chaque étape. |
| **Snapshot** | La copie figée des étapes du runbook qui vit sur chaque exécution. Permet de modifier le modèle plus tard sans réécrire l'historique. |

## Le cycle de vie d'un runbook

1. **Rédiger** — Créez un runbook, mélangez des étapes Manuelles, JavaScript, HTTP et Bash. Enregistrez.
2. **(Optionnel) Ajouter une règle** — Depuis les paramètres des Incidents, Alertes ou Maintenances Planifiées, dites à OneUptime de démarrer ce runbook chaque fois que le titre ou la description d'un événement correspond à une regex.
3. **Déclencher** — Soit la règle se déclenche automatiquement lors de la création d'un événement correspondant, soit un répondeur clique manuellement **Exécuter le runbook** sur l'événement.
4. **Exécuter** — Une nouvelle exécution est créée avec un snapshot des étapes. Les étapes automatisées s'exécutent en ligne sur le worker Runbook ; l'exécution se met en pause à chaque étape manuelle jusqu'à ce que quelqu'un la valide.
5. **Auditer** — L'exécution reste à jamais sur l'onglet **Runbooks** de l'événement et sur la liste **Exécutions** du runbook. La sortie, les erreurs et les temps de chaque étape sont préservés pour le postmortem.

## Quand utiliser quel type d'étape

Un guide rapide de décision. La présentation complète se trouve dans [Rédiger un runbook](/docs/runbooks/authoring).

| Type d'étape | À utiliser quand… | Exemple |
| --- | --- | --- |
| **Manuelle** | Un humain doit vérifier quelque chose, porter un jugement ou effectuer une action que OneUptime ne peut pas observer. | « Confirmer que le trafic est basculé sur la région secondaire dans le tableau du load balancer. » |
| **JavaScript** | Vous avez besoin d'un petit calcul contenu — interroger un service de configuration, transformer une charge utile, exécuter une logique avant l'étape suivante. Tourne en bac à sable sur un [Agent de runbook](/docs/runbooks/agents) dans votre propre infrastructure. | Calculer le retard de réplication actuel et décider si l'on continue. |
| **Requête HTTP** | Vous appelez une API existante — votre endpoint d'administration, un fournisseur cloud, PagerDuty, Slack. | `POST` vers votre orchestrateur de bascule. |
| **Bash** | Vous devez exécuter des commandes shell sur votre propre infrastructure — redémarrer un service, lancer `kubectl`, appeler un script de déploiement. Nécessite un [Agent de runbook](/docs/runbooks/agents) installé dans votre environnement. | Redémarrer un service, `kubectl rollout restart`, exécuter un script de récupération. |

Vous pouvez mélanger les quatre types dans un même runbook — la force des runbooks réside dans l'entrelacement de la vérification humaine et de l'automatisation.

## Où vivent les runbooks dans le tableau de bord

| Page | Ce que vous y faites |
| --- | --- |
| **Analyse & Automatisation → Runbooks** | Parcourir, créer et modifier les modèles de runbook. |
| **Onglet Étapes d'un runbook** | Rédiger et réorganiser la liste d'étapes. |
| **Onglet Exécutions d'un runbook** | Voir chaque exécution de ce runbook avec des filtres par statut. |
| **Bouton « Exécuter maintenant » d'un runbook** | Lancer une exécution ad hoc qui n'est attachée à aucun événement. |
| **Incidents / Alertes / Maintenances Planifiées → Paramètres → Règles de runbook** | Créer les règles de déclenchement automatique par type d'entité. |
| **Un incident / alerte / événement de maintenance → Onglet Runbooks** | Voir les exécutions attachées à cet événement et cliquer **Exécuter le runbook** pour un lancement manuel. |

## Cas d'usage courants

Quelques motifs vers lesquels les équipes se tournent pour les runbooks :

- **Bascule de base de données** — Capturer l'état actuel avec JavaScript, demander au DBA on-call de confirmer la santé du réplica (Manuelle), appeler l'API de l'orchestrateur (HTTP), valider « DNS mis à jour » (Manuelle), poster un tout-clair sur Slack (HTTP).
- **Vidage de cache** — Une seule étape HTTP plus une étape manuelle « confirmer que le taux de hits de cache remonte sur le tableau de bord ».
- **Incident impactant les clients** — Manuelle : « Publier une mise à jour de la status page ». HTTP : « Prévenir l'équipe CS dans #customer-incidents ». JavaScript : « Récupérer la liste des comptes affectés depuis l'API interne ».
- **Pré-vol pour maintenance planifiée** — JavaScript : snapshot des métriques actuelles. Manuelle : « Confirmer la fenêtre de changement avec les parties prenantes ». HTTP : activer le mode maintenance sur le load balancer.
- **Hygiène déclenchée systématiquement** — Une règle avec un motif de titre vide qui capture l'état du système à chaque incident — parfait pour les postmortems.

## Un exemple détaillé

Supposons que vous vouliez que chaque incident contenant « db-primary » dans le titre déclenche automatiquement un runbook de bascule DB en cinq étapes.

**1. Créer le runbook.** Sous **Runbooks → Créer un runbook**, nommez-le « Bascule DB primary » et ajoutez ces étapes :

| # | Type | Titre |
| --- | --- | --- |
| 1 | JavaScript | Capturer le retard de réplication avant bascule |
| 2 | Manuelle | Confirmer la santé du réplica dans le tableau DBA |
| 3 | HTTP | `POST` vers l'orchestrateur de bascule |
| 4 | Manuelle | Vérifier que les écritures vont vers le nouveau primary |
| 5 | HTTP | Poster le tout-clair dans `#db-incidents` sur Slack |

**2. Ajouter une règle.** Sous **Incidents → Paramètres → Règles de runbook**, créez :

```
Motif de titre : ^db-primary
Runbooks :      [Bascule DB primary]
```

**3. Déclencher.** Une alerte de monitor ouvre l'incident `INC-4821 · db-primary connection timeout`. La règle correspond, une exécution est créée, et :

- L'étape 1 (JavaScript) s'exécute immédiatement sur le worker — sa valeur `return { lagMs: 412 }` est capturée.
- L'étape 2 (Manuelle) met l'exécution en pause. L'on-call voit une étiquette « En attente de vous » sur la page de l'incident, vérifie le tableau de bord et valide l'étape.
- L'étape 3 (HTTP) s'exécute dès que l'étape 2 est validée — le corps de réponse du `POST` est capturé.
- L'étape 4 (Manuelle) met en pause à nouveau.
- L'étape 5 (HTTP) s'exécute et l'exécution se termine.

**4. Auditer.** L'exécution reste sur l'onglet **Runbooks** de l'incident. La sortie de chaque étape est à un clic. Quand vous écrirez le postmortem la semaine prochaine, vous n'aurez pas à demander « qu'a renvoyé ce script ? » — c'est juste là.

## Comment les runbooks s'intègrent au reste de OneUptime

- **Les monitors** ouvrent des incidents et alertes ; **les règles de runbook** transforment ces événements en exécutions. Ensemble, ils forment une boucle fermée : détecter → déclencher → répondre → enregistrer.
- **Les connexions d'espace de travail** (Slack, Microsoft Teams) sont une cible naturelle pour les étapes HTTP des runbooks — publier des mises à jour, prévenir des canaux.
- **Les status pages** sont fréquemment mises à jour comme étape manuelle dans un runbook impactant les clients.
- **Les plannings on-call** décident de qui est appelé ; les runbooks décident de ce que cette personne fait une fois réveillée.

## Où lire ensuite

- [Rédiger un runbook](/docs/runbooks/authoring) — créer des runbooks, les quatre types d'étapes et ce que chacun fait.
- [Règles de runbook](/docs/runbooks/rules) — attacher automatiquement des runbooks aux incidents, alertes et maintenances planifiées.
- [Exécuter un runbook](/docs/runbooks/running) — déclenchements manuels, vue d'exécution et interaction entre étapes manuelles et automatisées.
- [Agents de runbook](/docs/runbooks/agents) — installer les agents qui exécutent les étapes Bash dans votre propre infrastructure.
- [Configuration & sécurité](/docs/runbooks/configuration) — limites de sortie, permissions, notes de durcissement.
