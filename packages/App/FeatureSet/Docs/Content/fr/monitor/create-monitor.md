# Créer un moniteur

Un moniteur vérifie quelque chose que vous exploitez, par exemple un site web, une API, un hôte ou un cluster Kubernetes, et vous prévient quand cela cesse de fonctionner. **Créer un moniteur** demande d'abord quoi surveiller, puis quoi vérifier, puis à quelle fréquence. Tout, sauf le type, le nom et ce qu'il faut vérifier, part de valeurs par défaut adaptées à la plupart des moniteurs.

## Informations sur le moniteur

Allez dans **Moniteurs** et cliquez sur **Créer un moniteur**. La première question est le **Type de moniteur** : que voulez-vous surveiller ?

- Les six types que la plupart des gens créent viennent en premier : **Website**, **API**, **Ping**, **Port**, **SSL Certificate** et **Requête entrante**, pour les signaux de vie des tâches cron et des webhooks.
- **Plus de types de moniteurs** liste tous les autres types sous leur catégorie, par exemple **Infrastructure** (Kubernetes, Docker, Host) et **Télémétrie** (Journaux, Métriques, Traces). **Manuel**, un moniteur dont vous fixez vous-même le statut, se trouve sous **Autre**.
- Ou tapez dans la zone de recherche. Elle connaît les mots que vous utilisez déjà, comme `k8s`, `postgres`, `heartbeat` ou `tls`, et **Entrée** choisit le premier résultat.

Le type choisi se réduit à une ligne. Cliquez sur **Modifier** pour en choisir un autre ; appuyez sur **Échap** pendant le choix pour garder le type que vous aviez.

Remplissez ensuite le champ **Nom**. Il sert dans les alertes et dans les titres des incidents. **Description** et **Étiquettes** sont facultatifs et attendent sous **Plus de champs**.

Un moniteur **Manuel** n'a besoin de rien d'autre : **Créer un moniteur** se trouve donc sur cette étape.

## Critères

Cette étape commence par ce qu'il faut vérifier. Pour un site web, c'est son URL, avec un exemple dans le champ ; les autres types demandent un hôte, une requête, un cluster ou un filtre de journaux. **Tester le moniteur** lance la vérification une fois avant que vous enregistriez.

En dessous, les **Critères du moniteur** décident quand le moniteur change de statut, déclare un incident ou crée une alerte. Un nouveau moniteur part de critères adaptés à la plupart des moniteurs, chacun replié sur une ligne qui dit ce qu'il vérifie et ce qu'il fait. Par exemple, un nouveau moniteur de site web est marqué hors ligne et déclare un incident quand le site ne répond pas ou répond avec un code de statut d'erreur. Cliquez sur un critère pour l'ouvrir et le modifier. **Ajouter un critère** en ajoute un, ouvert et prêt à remplir.

Rien sur cette étape n'est signalé comme manquant avant que vous cliquiez sur **Suivant**.

## Sondes et intervalle

Les moniteurs vérifiés par des sondes se terminent par cette étape : Website, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, Domain, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code et External Status Page. Les **Sondes** sont les machines qui exécutent les vérifications, et les sondes par défaut de votre projet sont déjà sélectionnées. L'**Intervalle de surveillance** commence à **Toutes les 5 minutes**. Cliquez sur **Créer un moniteur**.

Tous les autres types se créent depuis l'étape **Critères**.

## Partir d'un modèle ou d'un lien

Un modèle de moniteur, et les liens qui créent un moniteur ailleurs dans OneUptime (sur un graphique de métrique, un équipement réseau ou une règle de détection), ouvrent **Créer un moniteur** avec le type déjà choisi et le reste rempli. Cliquez sur **Modifier** pour choisir un autre type. Le formulaire d'un modèle utilise le même sélecteur de type : voir [Modèles de moniteur](/docs/monitor/monitor-templates).
