# Lequel choisir ?

Certaines choses se ressemblent dans OneUptime. Cette page met chaque groupe côte à côte, avec ce à quoi sert chacun, pour que vous choisissiez le bon du premier coup. Chaque tableau tient sur un écran, et sa première colonne ouvre la page qui traite ce choix en détail.

:::cards
- [Incident, alerte ou autre type de problème ?](#incident-alerte-ou-autre-type-de-problème): Ce que devient un problème dans OneUptime.
- [Workflow, runbook, playbook ou règle IA ?](#workflow-runbook-playbook-ou-règle-ia): Avec quoi automatiser.
- [Groupe de moniteurs, service ou étiquette ?](#groupe-de-moniteurs-service-ou-étiquette): Comment regrouper ce que vous surveillez.
- [Sonde, agent, collecteur ou agent Runbook ?](#sonde-agent-collecteur-ou-agent-runbook): Quoi installer, et la clé que chacun utilise.
- [Tableau de bord, tableau de bord public ou page de statut ?](#tableau-de-bord-tableau-de-bord-public-ou-page-de-statut): Quoi partager, et avec qui.
:::

## Incident, alerte ou autre type de problème ?

La plupart des problèmes sont un incident ou une alerte : choisissez selon qui le problème touche. Les autres sont des enregistrements que OneUptime tient pour vous, et chacun d'eux peut mener à un incident ou à une alerte.

| Enregistrement | Ce que c'est | Quand l'utiliser |
| --- | --- | --- |
| [Incident](/docs/incidents/index) | Un problème qui touche vos utilisateurs. Il peut alerter la personne d'astreinte et apparaître sur vos pages de statut. | Les clients le remarquent, ou vont bientôt le remarquer : une panne, un ralentissement, un paiement qui échoue. |
| [Alerte](/docs/alerts/index) | Un problème pour votre équipe. Elle peut alerter la personne d'astreinte, mais n'apparaît jamais sur une page de statut. | Votre équipe doit agir avant que les utilisateurs ne remarquent quoi que ce soit : un disque qui se remplit, un certificat sur le point d'expirer. |
| [Épisode](/docs/incidents/episodes) | Un groupe d'incidents liés, ou d'alertes liées, traités comme un seul. | Une même cause a déclenché de nombreux incidents ou alertes. Les règles de regroupement ouvrent des épisodes pour vous. |
| [Exception](/docs/telemetry/exceptions) | Toutes les occurrences d'une erreur que lève votre code, regroupées, avec sa trace de pile. | Vous voulez corriger un bug. Un moniteur d'exceptions peut créer une alerte ou un incident quand les erreurs grimpent en flèche. |
| [Analyse IA](/docs/ai/ai-sre#analyses-détection-proactive) | Un problème que OneUptime a trouvé dans votre télémétrie avant que quoi que ce soit n'alerte, comme un pic de journaux d'erreur. | Vous voulez être prévenu tôt. Une analyse n'alerte jamais personne et n'ouvre jamais d'incident : elle attend dans une boîte de réception. |
| [Dossier de sécurité](/docs/telemetry/security-cases) | Une menace qui mérite une enquête, avec toutes les détections portant sur le même utilisateur, hôte ou adresse. | Votre équipe de sécurité enquête. **Déclarer un incident** sur un dossier ouvre un incident quand des utilisateurs sont touchés. |

Une alerte peut être liée à l'incident dont elle s'avère faire partie : commencer par une alerte ne fait donc rien perdre.

## Workflow, runbook, playbook ou règle IA ?

Tous les quatre peuvent s'exécuter tout seuls. Choisissez selon ce sur quoi ils agissent et qui a écrit les étapes.

| Outil | Ce qu'il fait | Quand l'utiliser |
| --- | --- | --- |
| [Workflow](/docs/workflows/index) | Des blocs sur un canevas qui s'exécutent quand leur déclencheur se produit : un incident est créé, une planification arrive à échéance, un autre outil appelle une URL. | Vous voulez relier OneUptime à d'autres outils, ou agir sur ses enregistrements, sans écrire de code. |
| [Runbook](/docs/runbooks/index) | Votre procédure de réponse sous forme d'étapes, des checklists manuelles aux scripts, requêtes HTTP et kubectl, exécutée sur un incident, une alerte ou un événement de maintenance. | Les intervenants doivent suivre les mêmes étapes à chaque fois. Les règles de runbook lancent un runbook sur les incidents qui correspondent. |
| [Playbook](/docs/telemetry/security-cases#playbooks) | Des étapes qui répondent à un dossier de sécurité : préserver les preuves, alerter la personne d'astreinte, suspendre un utilisateur. | Votre équipe de sécurité répond au même type de menace de la même façon à chaque fois. |
| [Règle IA](/docs/ai/ai-sre#quels-incidents-sont-investigués-et-corrigés) | Décide quels nouveaux incidents et alertes OneUptime AI examine et corrige, et si elle demande d'abord. | OneUptime AI ne doit travailler que sur certains incidents, ou corriger sans demander. Sans règle, elle les examine tous. |

## Groupe de moniteurs, service ou étiquette ?

Tous les trois rassemblent des choses, pour des lecteurs différents. Ils fonctionnent aussi ensemble : les moniteurs d'un service peuvent former un groupe de moniteurs, et tous peuvent porter la même étiquette.

| Choix | Ce que c'est | Quand l'utiliser |
| --- | --- | --- |
| [Groupe de moniteurs](/docs/monitor/monitor-groups) | Plusieurs moniteurs réunis en un seul statut, le pire d'entre eux, avec sa propre disponibilité. | Les clients doivent voir une seule ligne sur une page de statut pour quelque chose fait de plusieurs moniteurs, comme Checkout. |
| [Service](/docs/telemetry/services) | Une application que OneUptime a trouvée dans votre télémétrie, avec ses journaux, traces, métriques, incidents et propriétaires sur une seule page. | Vous voulez tout ce qui concerne une application au même endroit. Il apparaît tout seul à partir de son `service.name`. |
| [Étiquette](/docs/configuration/label-and-owner-rules) | Un mot-clé que vous posez sur les moniteurs et la plupart des autres enregistrements. Un enregistrement peut en porter plusieurs. | Vous voulez filtrer des listes, limiter les autorisations d'une équipe ou cibler des enregistrements dans des règles. |

Les groupes de moniteurs sont désactivés au départ : activez-les sous **Paramètres du projet → Avancé → Drapeaux de fonctionnalités**.

## Sonde, agent, collecteur ou agent Runbook ?

L'essentiel de OneUptime ne nécessite aucune installation : n'installez quelque chose que pour atteindre ce que OneUptime ne voit pas de l'extérieur. Chaque élément se connecte en sortie, avec un type de clé qui lui est propre.

| À installer | Ce qu'il fait | Quand l'installer | Clé utilisée |
| --- | --- | --- | --- |
| [Sonde personnalisée](/docs/probe/custom-probe) | Exécute les vérifications de vos moniteurs depuis l'intérieur de votre réseau. | Ce que vous vérifiez se trouve derrière votre pare-feu. Les sondes de OneUptime vérifient ce qui est public. | Son propre ID de sonde et sa propre clé |
| [Agent d'infrastructure](/docs/monitor/server-monitor) | Rapporte le CPU, la mémoire, les disques et les processus d'une machine à un moniteur Serveur / VM. | Vous voulez un moniteur pour un serveur, avec des critères sur ses valeurs. | La clé secrète du moniteur |
| [OpenTelemetry Collector](/docs/telemetry/hosts) | Envoie les métriques, journaux et processus d'une machine. **Ajouter un hôte** l'installe en une seule commande. | Vous voulez une machine sous **Hôtes**, avec sa télémétrie. | Une clé d'ingestion |
| [Agent Kubernetes](/docs/telemetry/kubernetes-agent) | Collecte les métriques, événements, journaux et traces d'un cluster. Vous l'installez avec Helm. | Vous exploitez Kubernetes. | Une clé d'ingestion |
| [Agent Runbook](/docs/runbooks/agents) | Exécute des étapes de runbook, comme Bash, SSH et kubectl, dans votre infrastructure. | Vos runbooks doivent atteindre vos propres hôtes et clusters. | Son propre ID d'agent Runbook et sa propre clé |

### Clé d'ingestion ou clé API ?

| Clé | Ce qu'elle permet | Où la créer |
| --- | --- | --- |
| [Clé d'ingestion](/docs/telemetry/ingestion-keys) | Envoyer de la télémétrie dans le projet, et rien d'autre. | **Paramètres du projet → Télémétrie & APM → Clés d'ingestion** |
| [Clé API](/docs/permissions/index#clés-dapi) | Lire et modifier le projet via l'API, la CLI, Terraform ou un assistant IA, avec les autorisations que vous lui donnez. | **Paramètres du projet → Avancé → Clés API** |

Aucune ne fonctionne à la place de l'autre.

## Tableau de bord, tableau de bord public ou page de statut ?

Choisissez selon qui doit le voir.

| Partage | Qui le voit | Quand l'utiliser |
| --- | --- | --- |
| [Tableau de bord](/docs/dashboards/index) | Les personnes qui se connectent à votre projet. | Votre équipe suit des graphiques et des listes : un écran d'astreinte, la vue propre à une équipe. |
| [Tableau de bord public](/docs/dashboards/sharing) | Toute personne disposant du lien, sauf si vous ajoutez un mot de passe, le limitez à certaines adresses IP ou l'hébergez sur votre propre domaine. | Des personnes extérieures au projet doivent voir vos graphiques, comme un partenaire ou un écran au mur. |
| [Page de statut](/docs/status-pages/index) | Vos clients, en public, ou seulement les utilisateurs privés que vous y admettez. | Les clients veulent savoir si vos services fonctionnent, et être prévenus des incidents et des maintenances. |

Une page de statut parle en incidents et avec les noms que vous donnez à vos moniteurs ; un tableau de bord montre les chiffres qui se cachent derrière.

## Étapes suivantes

:::cards
- [Glossaire](/docs/introduction/glossary): Chaque mot qu'utilise OneUptime, en une phrase ou deux.
- [Concepts clés](/docs/introduction/core-concepts): Comment les éléments s'articulent, sur une seule page.
- [Démarrage rapide](/docs/introduction/quickstart): Un moniteur, une alerte d'astreinte et une page de statut en quinze minutes.
:::
