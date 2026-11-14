# Glossaire

Chaque mot qu'utilise OneUptime, en une phrase ou deux, avec les autres noms qu'il porte et la page qui le traite en détail. Les mots sont regroupés dans l'ordre où vous les rencontrez : le premier groupe est la boucle que suit chaque projet, et le dernier réunit les mots qui ont plus d'un sens.

:::cards
- [Pour commencer](#pour-commencer): La boucle que suit chaque projet, du moniteur à l'alerte de la personne d'astreinte et à la page de statut.
- [Ce que vous surveillez](#ce-que-vous-surveillez): Services, hôtes, clusters, clouds et les objectifs que vous leur fixez.
- [Traiter un problème](#traiter-un-problème): États, gravités, propriétaires et étiquettes, et les autres types de problèmes.
- [Télémétrie et tableaux de bord](#télémétrie-et-tableaux-de-bord): Ce que vos systèmes envoient, et où vous le consultez.
- [Automatisation et IA](#automatisation-et-ia): Ce qui s'exécute tout seul, et ce que fait OneUptime AI.
- [Ce que vous installez, et les clés](#ce-que-vous-installez-et-les-clés): Les agents que vous exécutez, et la clé que chacun utilise.
- [Les mots à plusieurs sens](#les-mots-à-plusieurs-sens): Règle, rôle, ressource, paramètres et les autres mots à plusieurs usages.
:::

## Pour commencer

### Projet

L'endroit où vit tout ce que vous configurez : moniteurs, incidents, astreinte, pages de statut, télémétrie et paramètres. Rien de ce qui se trouve dans un projet n'est visible dans un autre, et la plupart des entreprises n'en ont besoin que d'un seul.

Voir [Concepts clés](/docs/introduction/core-concepts#projets-et-personnes).

### Compte

Vous : l'adresse e-mail et le mot de passe avec lesquels vous vous connectez, votre nom, votre fuseau horaire et votre langue. Un compte peut appartenir à autant de projets que vous voulez.

Voir [Votre compte](/docs/introduction/your-account).

### Équipe

Un groupe de personnes dans un projet, dont les autorisations décident de ce que ses membres peuvent faire. Chaque nouveau projet commence avec trois équipes : Owners, Admin et Members. Invitez des personnes sous **Utilisateurs**, et regroupez-les sous **Équipes**.

Voir [Utilisateurs, équipes et autorisations](/docs/permissions/index).

### Moniteur

Vérifie une chose que vous exploitez, comme un site web, une API, un serveur ou un cluster Kubernetes, et décide si elle fonctionne. Quand ses critères correspondent, il change de statut et peut déclarer un incident ou créer une alerte.

Voir [Créer un moniteur](/docs/monitor/create-monitor).

### Critères

Les règles d'un moniteur : ce que signifie chaque résultat de vérification. Ils sont examinés dans l'ordre, et le premier qui correspond peut changer le statut du moniteur, déclarer un incident, créer une alerte, ou les trois.

Autres noms : **Critères de surveillance**, **Critères du moniteur**, **Étapes du moniteur**. Voir [Critères et statuts](/docs/monitor/criteria-and-statuses).

### Statut du moniteur

Où en est un moniteur en ce moment. Chaque nouveau projet a trois statuts de moniteur, **Opérationnel**, **Dégradé** et **Hors ligne**, et vous pouvez ajouter les vôtres.

Voir [Critères et statuts](/docs/monitor/criteria-and-statuses).

### Sonde

Une machine qui exécute les vérifications des moniteurs selon un calendrier : elle demande une page, appelle une API ou envoie un ping à un hôte. OneUptime Cloud exécute des sondes dans plusieurs régions, et une sonde personnalisée que vous exécutez dans votre propre réseau vérifie ce que seul ce réseau peut atteindre.

Autres noms : **Sondes personnalisées**. Voir [Sondes personnalisées](/docs/probe/custom-probe).

### Incident

Un problème qui touche vos utilisateurs, comme une panne ou un ralentissement, et l'enregistrement à partir duquel votre équipe travaille tant qu'il dure. Il peut alerter la personne d'astreinte et apparaître sur vos pages de statut.

Voir [Vue d'ensemble des incidents](/docs/incidents/index).

### Alerte

Un problème que votre équipe doit examiner avant que les utilisateurs ne le remarquent, comme un disque qui se remplit ou un certificat sur le point d'expirer. Elle peut alerter la personne d'astreinte, mais elle n'apparaît jamais sur une page de statut.

Voir [Vue d'ensemble des alertes](/docs/alerts/index).

### Épisode

Un groupe d'incidents liés, ou d'alertes liées, que votre équipe traite comme un seul, avec un seul ensemble de propriétaires et un seul état. Des règles de regroupement décident de ce qui appartient à chacun.

Autres noms : **Épisode d'incident**, **Épisode d'alerte**. Voir [Épisodes](/docs/incidents/episodes).

### Politique d'astreinte

Décide de qui est alerté pour un incident, une alerte ou un épisode, et de qui vient ensuite si personne ne prend en compte. Ses niveaux sont des règles d'escalade.

Autres noms : **Astreinte**, `OnCallDutyPolicy`. Voir [Politiques d'astreinte](/docs/on-call/policies).

### Règle d'escalade

Un niveau d'une politique d'astreinte : qui est alerté, et combien de temps attendre que quelqu'un prenne en compte avant d'alerter le niveau suivant. Un niveau peut alerter des personnes, des équipes ou un planning d'astreinte.

Voir [Règles d'escalade](/docs/on-call/escalation-rules).

### Planning d'astreinte

Qui est d'astreinte à chaque instant : les personnes se relaient, et chacune passe le relais à la suivante. Une règle d'escalade qui alerte un planning alerte la personne qui y est d'astreinte.

Autres noms : **Rotation**, **Planning de la politique d'astreinte**. Voir [Plannings d'astreinte](/docs/on-call/schedules).

### Couche

Une rotation au sein d'un planning d'astreinte : les personnes qui se relaient, la fréquence des passations et les heures couvertes. C'est la couche la plus haute où quelqu'un est d'astreinte qui alerte : placez la rotation principale en haut et la couverture de secours en dessous.

Voir [Plannings d'astreinte](/docs/on-call/schedules#couches).

### Méthode de notification

Une adresse à laquelle OneUptime peut vous joindre dans un projet : une adresse e-mail, un numéro de téléphone pour les SMS ou les appels, votre compte Slack ou Microsoft Teams, ou l'application OneUptime sur votre téléphone. Chaque personne ajoute les siennes sous **Paramètres utilisateur**.

Voir [Méthodes de notification](/docs/notifications/notification-methods).

### Comment me joindre

Vos propres règles pour être appelé : quelles méthodes de notification une alerte essaie, et au bout de combien de temps. Une seule échelle couvre chaque incident, alerte et épisode, et une gravité peut avoir ses propres règles. Chaque personne règle les siennes sous **Paramètres utilisateur**.

Autres noms : **Règles d'astreinte personnelles**. Voir [Comment me joindre](/docs/notifications/on-call-rules).

### Page de statut

Une page qui montre à vos clients si vos services fonctionnent, ainsi que les incidents et les maintenances qui les touchent. Elle peut être publique, ou privée pour les personnes que vous y admettez.

Voir [Vue d'ensemble des pages de statut](/docs/status-pages/index).

### Abonné

Quelqu'un qui suit une page de statut par e-mail, SMS, Slack, Microsoft Teams ou webhook, et qui est prévenu quand un incident ou une maintenance qui y figure commence, évolue et se termine.

Voir [Abonnés et annonces](/docs/status-pages/subscribers).

### Maintenance planifiée

Des travaux prévus, annoncés à l'avance. Chaque événement de maintenance passe par les états de la maintenance **Planifié**, **En cours**, **Terminé** et **Achevé**, et les pages de statut sur lesquelles il est affiché en informent les visiteurs et les abonnés.

Autres noms : **Événement de maintenance planifiée**, **Événement planifié**, **Événement**. Voir [Vue d'ensemble de la maintenance planifiée](/docs/scheduled-maintenance/index).

### Télémétrie

Ce que vos systèmes envoient à OneUptime : journaux, métriques, traces, exceptions et profils. Les applications l'envoient avec OpenTelemetry, et les agents de OneUptime l'envoient depuis des hôtes, des clusters et le reste de votre infrastructure, chacun avec une clé d'ingestion.

Voir [OpenTelemetry](/docs/telemetry/open-telemetry).

## Ce que vous surveillez

### Groupe de moniteurs

Plusieurs moniteurs réunis en un seul statut, le pire d'entre eux, avec sa propre disponibilité. Une page de statut peut afficher tout le groupe sur une seule ligne. Activez les groupes de moniteurs sous **Paramètres du projet → Avancé → Drapeaux de fonctionnalités**.

Voir [Groupes de moniteurs](/docs/monitor/monitor-groups).

### Service

Une application ou un microservice que vous exploitez. OneUptime en ajoute un dès que sa télémétrie arrive pour la première fois, nommé d'après son `service.name`, et réunit ses journaux, traces, métriques, exceptions, incidents et propriétaires sur une seule page.

Autres noms : **Catalogue de services**, **Service de télémétrie**. Voir [Services](/docs/telemetry/services).

### Hôte

Une machine Linux, Windows ou macOS qui envoie ses métriques, processus, journaux et états de services via l'OpenTelemetry Collector. **Ajouter un hôte** installe le collecteur en une seule commande, et OneUptime maintient sa configuration à jour.

Voir [Hôtes](/docs/telemetry/hosts).

### Kubernetes

Vos clusters Kubernetes, avec leurs nœuds, pods, charges de travail, événements et journaux, envoyés par l'agent Kubernetes que vous installez avec Helm.

Voir [Agent Kubernetes](/docs/telemetry/kubernetes-agent).

### Infrastructure

Le groupe du menu qui réunit les machines et les plateformes que vous exploitez : Hôtes, Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Baies de stockage, Réseau et IoT. Un agent ou une connexion alimente chacun d'eux, et chacun indique comment se porte chaque machine, cluster ou appareil qu'il contient.

Voir [Hôtes](/docs/telemetry/hosts).

### Réseau

Vos commutateurs, routeurs, pare-feu, points d'accès et tout ce qui a une adresse sur votre réseau, qu'il parle SNMP ou non.

Voir [Surveillance des équipements réseau](/docs/monitor/network-device-monitor).

### Cloud

Vos comptes AWS, abonnements Azure et projets Google Cloud, connectés depuis le tableau de bord. OneUptime liste chaque ressource qu'ils contiennent, lit leurs métriques clés et consigne ce qui y a changé.

Voir [Connecter un compte cloud](/docs/telemetry/cloud-accounts).

### Plateformes d'applications

Les applications que vous exécutez sur des plateformes gérées comme Amazon ECS et Fargate, Google Cloud Run et Azure App Service. Chaque endroit où elles s'exécutent est un environnement cloud, que OneUptime crée dès que sa télémétrie arrive pour la première fois.

Autres noms : **Environnement cloud**. Voir [Environnements cloud](/docs/telemetry/cloud-environments).

### Serverless

Vos fonctions serverless, comme AWS Lambda, Google Cloud Functions et Azure Functions, listées avec leurs traces, journaux et métriques dès que leurs données OpenTelemetry arrivent.

Autres noms : **Fonctions serverless**. Voir [Fonctions serverless](/docs/telemetry/serverless-functions).

### Bases de données

Chaque base de données qu'interrogent vos applications, reconstituée à partir de vos traces, des métriques propres à la base et des autres sources que OneUptime sait lire, avec l'état de son moteur.

Voir [Bases de données](/docs/telemetry/databases).

### Files d'attente

Les files de messages et les topics qu'utilisent vos services, comme Apache Kafka, RabbitMQ et Amazon SQS, à partir de vos traces et des métriques de vos brokers.

Voir [Files d'attente](/docs/telemetry/queues).

### Surveillance des utilisateurs réels

Ce que vivent de vraies personnes dans vos applications web et mobiles : chargements de pages, requêtes, erreurs et Core Web Vitals, rapportés par l'application elle-même plutôt que par une sonde.

Voir [Vue d'ensemble du RUM](/docs/rum/index).

### Inventaire

Une liste unique de tout ce que OneUptime sait de votre parc : services, hôtes, objets Kubernetes, machines virtuelles, équipements réseau, ressources cloud, et même ce qui n'envoie aucune télémétrie. L'essentiel se remplit tout seul.

Voir [Vue d'ensemble de l'inventaire](/docs/inventory/overview).

### Topologie

Une carte de la façon dont vos systèmes sont reliés, quels services appellent lesquels et ce qui tourne où, dessinée à partir de la télémétrie que vous envoyez déjà.

Voir [Topologie](/docs/telemetry/topology).

### SLO

Un objectif de fiabilité pour ce que vous surveillez, par exemple disponible 99,9 % du temps sur 30 jours. OneUptime mesure chaque SLO à partir de ses moniteurs toutes les 5 minutes.

Autres noms : **Objectif de niveau de service**. Voir [Vue d'ensemble des SLO](/docs/slo/introduction).

### Budget d'erreur

Le temps d'indisponibilité que permet l'objectif d'un SLO : à 99,9 % sur 30 jours, 43 minutes et 12 secondes. S'il en reste beaucoup, vous pouvez prendre des risques ; s'il en reste peu, ralentissez et investissez dans la stabilité.

Voir [Budgets d'erreur](/docs/slo/error-budget).

## Traiter un problème

### État

Où en est un incident ou une alerte dans votre réponse. Chaque nouveau projet commence avec **Identifié**, **Pris en compte** et **Résolu** : la prise en compte indique que quelqu'un s'en occupe et empêche d'alerter le niveau d'escalade suivant, et la résolution clôt le problème.

Autres noms : **État de l'incident**, **État de l'alerte**. Voir [États et sévérités des incidents](/docs/incidents/states-and-severities).

### Gravité

L'importance d'un incident ou d'une alerte. Un nouveau projet commence avec Critical Incident, Major Incident et Minor Incident pour les incidents, et **Élevé** et **Faible** pour les alertes ; renommez-les, changez leur couleur ou ajoutez les vôtres.

Autres noms : **Gravité de l'incident**, **Gravité de l'alerte**. Voir [États et sévérités des incidents](/docs/incidents/states-and-severities).

### Propriétaire

Une personne ou une équipe responsable d'un enregistrement, comme un moniteur, un incident ou une page de statut. Les propriétaires sont prévenus quand il arrive quelque chose à ce qui leur appartient.

Voir [Règles d'étiquettes et de propriétaires](/docs/configuration/label-and-owner-rules).

### Étiquette

Un mot-clé, comme Production ou Checkout, que vous posez sur les moniteurs, les incidents, les pages de statut et la plupart des autres enregistrements pour les filtrer et les regrouper. Les autorisations d'une équipe peuvent être limitées aux enregistrements portant certaines étiquettes.

Voir [Règles d'étiquettes et de propriétaires](/docs/configuration/label-and-owner-rules).

### Exception

Une erreur que lève votre code. OneUptime regroupe chaque occurrence d'une même erreur en une seule exception, avec sa trace de pile, son évolution et les requêtes dans lesquelles elle s'est produite.

Autres noms : **Suivi des exceptions**, `/telemetry-exception`. Voir [Exceptions](/docs/telemetry/exceptions).

### Analyses IA

Les problèmes que OneUptime trouve dans votre télémétrie avant que quoi que ce soit n'alerte : exceptions nouvelles ou en forte hausse, pics de journaux d'erreur, traces plus lentes, dérive de métriques et déploiements qui ont aggravé les choses. Les analyses n'alertent jamais personne et n'ouvrent jamais d'incident ; elles attendent dans une boîte de réception que quelqu'un les consulte. La page **Analyses** de la section IA d'un produit ou d'un enregistrement montre ce que OneUptime AI y a appris.

Autres noms : **Analyses**. Voir [AI SRE](/docs/ai/ai-sre#analyses-détection-proactive).

### Événements de sécurité

Le SIEM de OneUptime : les événements de sécurité issus de vos journaux, de vos outils de sécurité et de tout ce que vous envoyez d'autre, conservés sous une même forme à côté de votre télémétrie, avec des règles de détection qui y repèrent les menaces.

Autres noms : **SIEM**. Voir [Événements de sécurité (SIEM)](/docs/telemetry/security-events).

### Dossier de sécurité

Une chose qui mérite une enquête, issue de règles de détection, de renseignements sur les menaces ou d'un produit de sécurité connecté, où sont regroupées toutes les détections portant sur le même utilisateur, hôte ou adresse. Les analystes traitent les dossiers dans une file, et les playbooks y répondent.

Autres noms : **Dossier**. Voir [Dossiers de sécurité et playbooks (SOAR)](/docs/telemetry/security-cases).

## Télémétrie et tableaux de bord

### Journaux

Les lignes qu'écrivent vos services, hôtes et agents, que vous recherchez dans l'explorateur de journaux et surveillez avec un moniteur de journaux.

Voir [Explorateur de journaux](/docs/telemetry/logs-explorer).

### Métriques

Les nombres que vos services et votre infrastructure rapportent au fil du temps, comme le nombre de requêtes, la latence, le CPU et la profondeur des files.

Voir [Explorateur de métriques](/docs/telemetry/metrics-explorer).

### Traces

Le chemin d'une requête à travers vos services, étape par étape. Chaque étape est un span, avec sa durée et son résultat.

Voir [Explorateur de traces](/docs/telemetry/traces-explorer).

### Profils

La façon dont votre application dépense son temps CPU et sa mémoire, fonction par fonction, envoyée par un profileur qui pousse ses données vers l'API compatible Pyroscope de OneUptime.

Autres noms : **Profils de performance**, **Profilage continu**. Voir [Profils](/docs/telemetry/profiles).

### IA / LLM

Les conversations de vos applications et agents d'IA : chaque appel de modèle, avec ses tokens, son coût, sa latence, son prompt et sa réponse, reconstitué à partir des spans OpenTelemetry qu'envoie votre application.

Autres noms : **Observabilité IA / LLM**. Voir [Observabilité IA / LLM](/docs/telemetry/ai-llm-observability).

### Observabilité des données

Surveille les tables de vos bases de données et entrepôts de données, et vous prévient quand leurs données sont en retard, manquantes ou erronées, en indiquant l'exécution, le déploiement ou la table qui en est la cause.

Voir [Vue d'ensemble de l'Observabilité des données](/docs/data-observability/index).

### Sécurité des données

Trouve les données sensibles que conserve votre entreprise, dans les buckets cloud, les bases de données, les entrepôts de données et la télémétrie que vous envoyez, et vous dit ce qui ne va pas dans leur conservation.

Voir [Vue d'ensemble de Sécurité des données](/docs/data-security/index).

### Tableau de bord

Une page de widgets que vous disposez vous-même : graphiques de vos métriques, journaux et traces, listes d'incidents et de moniteurs, vos SLO et plus encore. Un tableau de bord reste privé à votre projet jusqu'à ce que vous le partagiez.

Voir [Présentation des tableaux de bord](/docs/dashboards/index).

### Public Dashboard

Un tableau de bord partagé par un lien public, pour les personnes qui ne se connectent pas à votre projet. Protégez-le par un mot de passe, limitez-le à certaines adresses IP ou hébergez-le sur votre propre domaine.

Voir [Partage et tableaux de bord publics](/docs/dashboards/sharing).

## Automatisation et IA

### Flux de travail

Une automatisation sans code : des blocs sur un canevas qui s'exécutent quand leur déclencheur se produit, par exemple pour publier dans Slack quand un incident est déclaré, ou pour appeler un autre outil.

Voir [Présentation des workflows](/docs/workflows/index).

### Runbook

Une procédure de réponse réutilisable : des étapes manuelles et automatisées que votre équipe exécute sur un incident, une alerte ou un événement de maintenance, à la main ou quand une règle de runbook correspond.

Voir [Vue d'ensemble des Runbooks](/docs/runbooks/index).

### Playbook

Les étapes qui répondent à un dossier de sécurité, comme préserver les preuves, alerter la personne d'astreinte ou suspendre un utilisateur, exécutées toutes seules ou d'un clic.

Autres noms : **Playbook de sécurité**. Voir [Dossiers de sécurité et playbooks (SOAR)](/docs/telemetry/security-cases#playbooks).

### Règle IA

Décide quels nouveaux incidents ou alertes OneUptime AI examine et corrige, et comment. Sans règle IA, elle les examine tous, si bien que la plupart des projets n'en ont besoin d'aucune.

Autres noms : **Règle de remédiation automatique**. Voir [AI SRE](/docs/ai/ai-sre#quels-incidents-sont-investigués-et-corrigés).

### OneUptime AI

L'IA de OneUptime qui joue le rôle d'ingénieur en fiabilité des sites : elle enquête sur chaque nouvel incident et chaque nouvelle alerte à travers votre télémétrie et publie ce qu'elle a trouvé dans leur chronologie. L'interrupteur **Activer l'IA** dans les **Paramètres du projet** la désactive entièrement.

Autres noms : **AI SRE**. Voir [AI SRE](/docs/ai/ai-sre).

### Demander à l'IA

Un chat sur les données de votre projet. Il interroge vos journaux, traces, métriques, incidents, moniteurs et plus encore, et répond en citant une source pour chaque affirmation.

Autres noms : **Chat**. Voir [Demander à l'IA](/docs/ai/ask-ai).

### Code

L'endroit où vous demandez à OneUptime AI de travailler dans vos dépôts, comme vous le demanderiez à un agent de code : corriger un bug, écrire des tests ou apporter une modification, et recevoir une pull request en retour.

Autres noms : **Tâches**. Voir [Code](/docs/ai/ai-agent).

### Formulaire

Une page que toute personne disposant de son lien peut remplir, sans compte. Chaque soumission crée un incident, pour un signalement de problème, ou un événement de maintenance, pour une demande de changement.

Voir [Vue d'ensemble des formulaires](/docs/forms/index).

## Ce que vous installez, et les clés

### Agent d'infrastructure

Le service `oneuptime-infrastructure-agent` derrière un moniteur Serveur / VM : il rapporte toutes les 30 secondes le CPU, la mémoire, les disques et les processus d'une machine, signés avec la clé secrète du moniteur.

Voir [Surveillance de serveur / VM](/docs/monitor/server-monitor).

### Agent Kubernetes

Un chart Helm qui collecte les métriques, les événements et les journaux de pods d'un cluster et, avec eBPF, ses traces, puis les envoie avec une clé d'ingestion.

Voir [Agent Kubernetes](/docs/telemetry/kubernetes-agent).

### OpenTelemetry Collector

L'agent open source qui reçoit, traite et envoie la télémétrie. **Ajouter un hôte** l'installe sur une machine, l'agent Docker en est un, et vos propres collecteurs envoient à OneUptime avec une clé d'ingestion.

Autres noms : **Collecteur**. Voir [Hôtes](/docs/telemetry/hosts) et [Collecteur OpenTelemetry sur l'hôte](/docs/telemetry/host-otel-collector).

### Agent Runbook

Un petit processus que vous exécutez dans votre propre infrastructure et qui exécute les étapes JavaScript, Bash, SSH et kubectl de vos runbooks. Il se connecte en sortie à OneUptime avec son propre identifiant d'agent Runbook et sa propre clé.

Autres noms : **Agents de runbook**. Voir [Agents de runbook](/docs/runbooks/agents).

### Clé d'ingestion

La clé qui permet à quelque chose d'envoyer de la télémétrie dans votre projet : applications avec OpenTelemetry, collecteurs et agents. Elle va dans l'en-tête `x-oneuptime-token`, et une clé API de projet ne fonctionne pas à sa place.

Autres noms : **Clé d'ingestion de télémétrie**, `oneuptime.apiKey`. Voir [Clés d'ingestion](/docs/telemetry/ingestion-keys).

### Clé API

Une clé qui permet à un script, à la CLI, à Terraform ou à un assistant IA de lire et de modifier votre projet via l'API, avec les autorisations que vous lui donnez. Créez-en une sous **Paramètres du projet → Avancé → Clés API**.

Voir [Utilisateurs, équipes et autorisations](/docs/permissions/index#clés-dapi).

## Les mots à plusieurs sens

### Règle

Beaucoup de choses dans OneUptime sont des règles, et chacune prend une décision pour vous : qui est alerté (**Règles d'astreinte**, **Règles d'escalade**), à qui appartiennent les nouveaux enregistrements et comment ils sont étiquetés (**Règles de propriétaire**, **Règles d'étiquettes**), ce qui va ensemble (**Règles de regroupement**) et ce que fait OneUptime AI (**Règles IA**). Les règles propres à un moniteur sont ses critères.

Voir [Concepts clés](/docs/introduction/core-concepts#les-types-de-règles).

### Rôle

Quatre choses différentes : les autorisations qu'accorde une équipe, comme Project Owner ou Project Admin ; un **Rôle personnalisé** que vous composez à partir d'autorisations ; un **Rôle d'incident**, le rôle que joue quelqu'un dans un incident ; et un **Rôle d'équipement réseau**, ce que fait un appareil sur votre réseau.

Voir [Utilisateurs, équipes et autorisations](/docs/permissions/index).

### Ressource

Le plus souvent, l'infrastructure que OneUptime recense, comme les hôtes, les clusters, les bases de données et les ressources cloud. Les **Ressources affectées** d'un incident sont les moniteurs et l'infrastructure qu'il touche, les ressources d'une page de statut sont les moniteurs et les groupes qu'elle affiche, et les attributs de ressource d'OpenTelemetry indiquent d'où vient la télémétrie.

Voir [Vue d'ensemble de l'inventaire](/docs/inventory/overview).

### Paramètres

Chaque niveau a les siens : les **Paramètres du projet** pour tout le projet, les **Paramètres utilisateur** pour la façon dont OneUptime vous joint, et les **Paramètres** propres à un produit dans son menu latéral, comme les états et les modèles d'incident sous **Incidents**. Les paramètres d'un serveur auto-hébergé se trouvent dans l'Admin Dashboard.

Voir [Paramètres du projet](/docs/configuration/project-settings).

### Politique

Le plus souvent une **Politique d'astreinte** : qui est alerté, et qui vient ensuite. Une politique d'appels entrants donne à votre équipe un numéro de téléphone qui sonne chez la personne d'astreinte, et une politique de budget d'erreur consigne ce que fait votre équipe quand le budget d'un SLO s'épuise.

Voir [Politiques d'astreinte](/docs/on-call/policies).

### Modèle

Un point de départ enregistré : un modèle de moniteur crée des moniteurs, les modèles d'incident et d'alerte remplissent les nouveaux enregistrements, les modèles de note et de post-mortem amorcent ce que vous écrivez, et les modèles de tableau de bord construisent les widgets d'un tableau de bord.

Voir [Modèles de moniteur](/docs/monitor/monitor-templates).

### Espace de travail

Un espace de travail Slack ou Microsoft Teams que vous connectez à OneUptime sous **Connexions de l'espace de travail**, pour publier des mises à jour dans vos canaux et agir sur les incidents depuis le chat. Ce que certains autres outils appellent un espace de travail est un projet dans OneUptime.

Voir [Slack](/docs/workspace-connections/slack).

### Agent

Un programme que vous installez et qui rend compte à OneUptime ou agit pour lui : les agents d'infrastructure, Kubernetes et Docker envoient ce qu'ils collectent, un agent Runbook exécute les étapes de runbook, et un agent IA permet à OneUptime AI d'examiner un cluster ou un hôte. Les tâches que vous confiez à **Code** sont des tâches d'agent IA.

Voir [Lequel choisir ?](/docs/introduction/which-one#sonde-agent-collecteur-ou-agent-runbook).

### Règles d'astreinte

Sous **Incidents** et **Alertes**, les règles d'astreinte choisissent les politiques d'astreinte qu'exécute un nouvel incident ou une nouvelle alerte. Les propres règles d'une personne, qui décident comment une alerte lui parvient, s'appelaient aussi règles d'astreinte : elles s'appellent désormais **Comment me joindre**, sous **Paramètres utilisateur**.

Voir [Paramètres et automatisation des incidents](/docs/incidents/settings#règles-dastreinte-des-incidents) et [Comment me joindre](/docs/notifications/on-call-rules).

### Paramètres de notification

Sous **Paramètres utilisateur**, les mises à jour qui vous parviennent sur ce qui vous appartient, et par quels canaux. Les interrupteurs du projet pour les SMS et les appels, son solde de messagerie et son propre SMTP et Twilio s'appelaient aussi paramètres de notification : ils s'appellent désormais **Canaux de notification**, sous **Paramètres du projet**.

Voir [Paramètres de notification](/docs/notifications/notification-settings).

## Étapes suivantes

:::cards
- [Lequel choisir ?](/docs/introduction/which-one): Incident ou alerte, workflow ou runbook, et les autres sosies côte à côte.
- [Concepts clés](/docs/introduction/core-concepts): Comment les éléments s'articulent, sur une seule page.
- [Démarrage rapide](/docs/introduction/quickstart): Mettre ces mots en pratique en quinze minutes.
:::
