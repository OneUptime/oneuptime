# Premiers pas

OneUptime est une plateforme d'observabilité open source. Elle vérifie que vos sites web, vos API et vos serveurs fonctionnent, collecte les journaux, les métriques et les traces que vos applications envoient, alerte la personne d'astreinte quand quelque chose tombe en panne et informe vos clients sur une page de statut. Tout se passe dans un seul produit : l'outil qui remarque un problème est celui qui alerte votre équipe. Utilisez OneUptime Cloud, ou exécutez OneUptime sur vos propres serveurs.

Commencez ici :

:::cards
- [Démarrage rapide](/docs/introduction/quickstart): Surveiller un site web, être alerté en cas de panne et publier une page de statut.
- [Concepts clés](/docs/introduction/core-concepts): Les quelques idées sur lesquelles tout repose, et comment elles s'articulent.
- [Page d'accueil et raccourcis](/docs/introduction/home): Se repérer dans le tableau de bord, et les touches qui vous épargnent des clics.
- [Votre compte](/docs/introduction/your-account): Votre profil, votre mot de passe, vos clés d'accès et l'authentification à deux facteurs.
:::

## Comment OneUptime s'articule

Tout commence par quelque chose que vous surveillez. Un moniteur le vérifie selon un calendrier, ou lit la télémétrie qu'il envoie. Quand les critères du moniteur sont remplis, OneUptime déclare un incident ou crée une alerte, alerte la personne d'astreinte et affiche l'incident sur votre page de statut si vous le souhaitez.

```mermaid title="D'une vérification échouée à une équipe alertée et une page de statut à jour"
flowchart TB
    probes["Les sondes vérifient<br/>vos sites et API"] --> monitors["Moniteurs"]
    telemetry["Vos applications et agents<br/>envoient de la télémétrie"] --> monitors
    monitors -->|"critères remplis"| problems["Incidents et alertes"]
    problems --> oncall["Les politiques d'astreinte<br/>alertent votre équipe"]
    problems --> status["Les pages de statut<br/>informent vos clients"]
```

- Un **incident** est un problème qui touche vos utilisateurs. Il peut alerter la personne d'astreinte et apparaître sur votre page de statut.
- Une **alerte** est un problème que votre équipe doit examiner avant que les utilisateurs ne le remarquent. Elle peut aussi alerter la personne d'astreinte, mais n'apparaît jamais sur une page de statut.

[Concepts clés](/docs/introduction/core-concepts) explique chacun de ces éléments en quelques phrases.

## Explorer la documentation

La documentation est organisée comme la barre latérale, en neuf sections. Choisissez la partie dont vous avez besoin.

### Surveillance

:::cards
- [Moniteurs](/docs/monitor/create-monitor): Vérifier des sites web, des API, des ports, le DNS, des serveurs NTP, des certificats et plus encore, depuis des sondes du monde entier.
- [Moniteurs d'infrastructure](/docs/monitor/server-monitor): Surveiller des serveurs, Kubernetes, Docker, VMware, des équipements réseau et du stockage.
- [Moniteurs de télémétrie](/docs/monitor/logs-monitor): Alerter sur les journaux, les métriques, les traces, les exceptions et les profils que vous envoyez.
- [SLO](/docs/slo/introduction): Suivre des objectifs de fiabilité, des budgets d'erreur et des taux de consommation.
- [Sondes](/docs/probe/custom-probe): Exécuter des vérifications depuis votre propre réseau.
- [Quand OneUptime ne reçoit pas de données](/docs/monitor/when-oneuptime-is-not-receiving): Pourquoi une interruption côté OneUptime ne compte jamais comme votre indisponibilité.
:::

### Réponse aux incidents

:::cards
- [Incidents](/docs/incidents/index): Déclarer, coordonner et résoudre des incidents, avec une chronologie complète.
- [Astreinte](/docs/on-call/schedules): Rotations, règles d'escalade, et qui est alerté et quand.
- [Pages de statut](/docs/status-pages/index): Tenir vos clients informés sur des pages de statut publiques ou privées.
- [Connexions aux espaces de travail](/docs/workspace-connections/slack): Traiter les incidents depuis Slack et Microsoft Teams.
:::

### Observabilité

:::cards
- [Télémétrie](/docs/telemetry/open-telemetry): Envoyer des journaux, des métriques et des traces avec OpenTelemetry, et les rechercher.
- [Agents d'infrastructure](/docs/telemetry/kubernetes-agent): Installer les agents pour Kubernetes, les hôtes, Docker, Proxmox, VMware et plus encore.
- [Cloud](/docs/telemetry/cloud-environments): Observer ECS, Cloud Run, Azure Container Apps et d'autres plateformes gérées.
- [Observabilité de l'IA](/docs/telemetry/ai-llm-observability): Suivre les conversations de votre IA, et être prévenu quand elle répond mal.
- [Sécurité](/docs/telemetry/security-events): Collecter des événements de sécurité et du renseignement sur les menaces.
- [Real User Monitoring](/docs/rum/index): Mesurer ce que vivent vos vrais utilisateurs, avec les Core Web Vitals et la relecture de session.
- [Tableaux de bord](/docs/dashboards/index): Construire des tableaux de bord à partir de vos métriques, journaux et moniteurs.
- [Inventaire](/docs/inventory/overview): Voir chaque service, hôte et équipement que OneUptime connaît.
:::

### Automatisation et IA

:::cards
- [Runbooks](/docs/runbooks/index): Transformer vos procédures d'intervention en étapes que votre équipe peut exécuter.
- [Formulaires](/docs/forms/index): Permettre à chacun de signaler un problème via un formulaire qui ouvre un incident.
- [Workflows](/docs/workflows/index): Automatiser des actions quand quelque chose se produit dans OneUptime.
- [IA](/docs/ai/ai-sre): Laisser OneUptime AI enquêter sur les incidents et les alertes, et l'interroger sur vos systèmes.
:::

### Intégrations

:::cards
- [Intégrations](/docs/integrations/index): Connecter Jira, ServiceNow, Grafana, Datadog, Huntress, des outils SIEM, Discord, Telegram, IRC et plus encore.
:::

### Développeurs

:::cards
- [Référence de l'API](/docs/api-reference/api-reference): Automatiser OneUptime avec son API REST.
- [CLI](/docs/cli/index): Gérer OneUptime depuis votre terminal et votre CI.
- [Fournisseur Terraform](/docs/terraform/index): Gérer les moniteurs, les pages de statut et l'astreinte en tant que code.
:::

### Administration

:::cards
- [Utilisateurs et autorisations](/docs/permissions/index): Inviter des personnes, organiser des équipes et contrôler ce qu'elles peuvent faire.
- [Identité](/docs/identity/sso): Se connecter avec l'authentification unique SAML ou OIDC, et provisionner les utilisateurs avec SCIM.
- [Configuration](/docs/configuration/label-and-owner-rules): Étiqueter les ressources et leur attribuer des propriétaires automatiquement.
- [E-mails](/docs/emails/smtp): Envoyer les e-mails de OneUptime via votre propre serveur SMTP.
- [Applications mobiles et de bureau](/docs/mobile-desktop-apps/index): Être alerté et répondre sur iOS, Android, macOS, Windows et Linux.
:::

### Auto-hébergement

:::cards
- [Installation](/docs/installation/docker-compose): Installer, dimensionner et mettre à jour votre propre OneUptime.
- [Configuration auto-hébergée](/docs/self-hosted/architecture): Architecture, intégrations et fonctionnalités Enterprise pour votre propre installation.
:::

## Venir d'un autre outil

### Apporter votre configuration

**Paramètres du projet → Importer depuis un autre outil** lit votre configuration dans un autre outil, avec une clé d'API ou, pour Uptime Kuma, un fichier. Il vous montre ce qu'il a trouvé et crée ce que vous cochez. Rien ne change dans l'autre outil, et relancer l'import ne crée jamais rien en double.

| Vous venez de | Ce que OneUptime lit |
| --- | --- |
| [Opsgenie](/docs/moving-to-oneuptime/opsgenie) | Utilisateurs, équipes, plannings, escalades et services |
| [PagerDuty](/docs/moving-to-oneuptime/pagerduty) | Utilisateurs, équipes, plannings, politiques d'escalade et services |
| [incident.io](/docs/moving-to-oneuptime/incident-io) | Utilisateurs, équipes, plannings, chemins d'escalade, services et paramètres d'incident |
| [Splunk On-Call](/docs/moving-to-oneuptime/splunk-on-call) | Utilisateurs, équipes, rotations et politiques d'escalade |
| [Grafana OnCall](/docs/moving-to-oneuptime/grafana-oncall) | Utilisateurs, équipes, plannings et chaînes d'escalade |
| [UptimeRobot](/docs/moving-to-oneuptime/uptimerobot) | Moniteurs et pages de statut publiques |
| [Atlassian Statuspage](/docs/moving-to-oneuptime/atlassian-statuspage) | Pages, leurs composants et groupes, et abonnés par e-mail |
| [Better Stack](/docs/moving-to-oneuptime/better-stack) | Moniteurs, heartbeats, pages de statut et abonnés par e-mail |
| [Pingdom](/docs/moving-to-oneuptime/pingdom) | Vérifications de disponibilité |
| [StatusCake](/docs/moving-to-oneuptime/statuscake) | Vérifications de disponibilité, SSL et heartbeat |
| [Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) | Moniteurs, depuis une sauvegarde ou la page de métriques |

### Ce que OneUptime remplace

| Fonctionnalité | Ce qu'elle fait | Remplace des outils comme |
| --- | --- | --- |
| Surveillance de disponibilité | Vérifie la disponibilité et le temps de réponse depuis des sites du monde entier. | Pingdom, UptimeRobot |
| Pages de statut | Montre aux clients l'état actuel et l'historique de vos services. | Atlassian Statuspage |
| Gestion des incidents | Mène les incidents du début à la fin, avec des notes, des propriétaires et une chronologie. | incident.io |
| Astreinte et alertes | Planifie les gardes d'astreinte et escalade jusqu'à ce que quelqu'un réponde. | PagerDuty, Opsgenie |
| Gestion des journaux | Collecte, recherche et visualise les journaux. | Loggly |
| Workflows | Automatise des actions et connecte OneUptime aux outils que vous utilisez déjà. | Zapier |
| Surveillance des performances applicatives | Suit les traces, les temps de réponse, le débit et les taux d'erreur. | New Relic, Datadog |
| Suivi des erreurs | Regroupe les exceptions avec leurs traces de pile et leur contexte. | Sentry |

## Étapes suivantes

:::cards
- [Démarrage rapide](/docs/introduction/quickstart): Configurer votre premier moniteur, votre première politique d'astreinte et votre première page de statut.
- [Concepts clés](/docs/introduction/core-concepts): Apprendre les mots que toutes les autres pages utilisent.
- [Page d'accueil et raccourcis](/docs/introduction/home): Trouver n'importe quelle page, paramètre ou action dans le tableau de bord.
- [Docker Compose](/docs/installation/docker-compose): Exécuter OneUptime sur votre propre serveur.
:::
