# Agents de runbook

Un **agent de runbook**, que le tableau de bord appelle **Agent Runbook** (le Runner), est un petit processus auto-hébergé qui exécute les étapes JavaScript, Bash, SSH et kubectl de vos runbooks **dans votre propre infrastructure**. Le Worker OneUptime n'exécute jamais vos scripts : il les met en file, et l'agent Runbook choisi par l'auteur de l'étape prend chacun en charge, l'exécute et renvoie le résultat. Cette page s'adresse à qui installe et exploite les agents Runbook. Une étape qui ne choisit aucun agent s'exécute sur l'[agent Runbook par défaut du projet](#lagent-runbook-par-défaut-du-projet), si vous en avez défini un ; une étape JavaScript s'exécute sinon sur un [agent Runbook global](#agents-runbook-globaux), l'un de ceux qu'OneUptime fait tourner pour chaque projet.

:::cards
- [Installer un agent Runbook](#installer-un-agent-runbook): Du tableau de bord à un conteneur connecté, en cinq étapes.
- [Diriger une étape vers un agent Runbook](#diriger-une-étape-vers-un-agent-runbook): Lier une étape à l'agent Runbook qui doit l'exécuter.
- [L'agent Runbook par défaut du projet](#lagent-runbook-par-défaut-du-projet): L'agent Runbook sur lequel s'exécute une étape ou un dépôt de code qui n'en choisit aucun.
- [Agents Runbook globaux](#agents-runbook-globaux): Les agents qu'OneUptime fait tourner pour chaque projet, et ce qu'ils exécutent.
- [Délais](#délais): Délais de prise en charge et d'exécution, et leur interaction.
- [Variables d'environnement](#variables-denvironnement): Ce que lit le conteneur au démarrage.
:::

## Fonctionnement

```mermaid title="Ce qui circule sur le réseau entre un agent Runbook et OneUptime"
flowchart TB
    subgraph cloud["OneUptime"]
        direction LR
        worker["Le Worker met l'étape en file"]
        ingest["API des agents Runbook"]
    end
    subgraph yours["Votre infrastructure"]
        direction LR
        runner["Conteneur de l'agent Runbook"]
        targets["Hôtes, clusters, services internes"]
    end
    worker --> ingest
    runner -->|"HTTPS sortant, ID et clé de l'agent"| ingest
    ingest -->|"Tâche prise en charge, avec ses secrets"| runner
    runner -->|"Script, SSH ou API Kubernetes"| targets
```

1. Vous créez un agent Runbook dans OneUptime. OneUptime génère pour lui un ID et une clé secrète.
2. Vous lancez le conteneur de l'agent sur un hôte de votre infrastructure, avec cet ID, cette clé et l'URL de votre OneUptime.
3. L'agent demande du travail à OneUptime toutes les 5 secondes, et signale qu'il est vivant toutes les 60 secondes.
4. Quand vous écrivez une étape JavaScript, Bash, SSH ou kubectl, vous choisissez l'agent Runbook dans une liste déroulante, sous **Plus de champs** de l'étape. L'étape est liée à cet agent. Une étape qui n'en choisit aucun s'exécute sur l'agent Runbook par défaut du projet, si vous en avez défini un, et une étape JavaScript sinon sur **Agent Runbook global**.
5. Quand l'étape s'exécute, le Worker met en file une tâche dont `targetAgentId` désigne cet agent. Seul cet agent peut la prendre en charge.
6. L'agent exécute la tâche localement — `bash -c <script>` pour Bash et kubectl, un bac à sable `isolated-vm` pour JavaScript, une connexion SSH qui exécute le script avec bash sur la machine —, capture le résultat, y masque les secrets de l'étape et le renvoie. Le Worker reprend le runbook avec ce résultat.

L'agent n'a besoin que de **HTTPS sortant** vers votre instance OneUptime. Il n'accepte aucune connexion entrante.

Un agent Runbook ne détient que son ID et sa clé. Il reçoit tout le reste avec la tâche qu'il prend en charge : un script, dans lequel sont insérées les [variables de runbook](/docs/runbooks/variables) qu'il nomme, et la clé ou le mot de passe d'une étape SSH ou le kubeconfig d'une étape kubectl. Il ne reçoit un secret que si ce secret l'y autorise. C'est pourquoi quiconque détient la clé d'un agent peut agir en son nom : traitez la clé comme les secrets qu'il peut utiliser.

## Pourquoi les scripts s'exécutent sur un agent Runbook

Exécuter les scripts sur le Worker OneUptime posait deux problèmes :

- **Frontière de confiance.** Quiconque pouvait rédiger un runbook pouvait exécuter du code sur le Worker, avec accès à tout ce que le Worker pouvait joindre.
- **Portée.** La plupart des étapes utiles agissent sur _votre_ infrastructure (« redémarrer ce service », « chercher un enregistrement dans notre base interne »), pas sur celle d'OneUptime.

Avec les agents Runbook, ces étapes s'exécutent sur un hôte que vous contrôlez, et vous décidez de ce que cet hôte peut faire. Les étapes de requête HTTP et IA s'exécutent toujours sur le Worker, car elles n'ont besoin de rien dans votre réseau.

## Agents Runbook globaux

Les agents Runbook globaux sont les agents qu'OneUptime fait tourner pour chaque projet. Une étape JavaScript qui ne choisit aucun agent à elle s'exécute sur l'un d'eux, sauf si le projet a un [agent Runbook par défaut](#lagent-runbook-par-défaut-du-projet), ce qui vous permet de l'écrire avant d'installer quoi que ce soit. **Runbooks → Agents de runbook** les liste sous **Agents Runbook globaux**, au-dessus de vos propres agents, et la liste déroulante **Agent Runbook** d'une étape JavaScript propose **Agent Runbook global** en premier, ou juste après l'agent Runbook par défaut du projet. La liste déroulante d'une étape Bash, SSH ou kubectl l'affiche en dernier, grisé, avec **N'exécute que les étapes JavaScript.** Ces étapes s'exécutent sur un agent à vous, dans votre réseau, jamais sur un agent que tous les projets partagent.

| | Agent Runbook global | Votre propre agent |
| --- | --- | --- |
| Étapes qu'il exécute | JavaScript | JavaScript, Bash, SSH et kubectl |
| Ce qu'une étape peut atteindre | Les adresses publiques d'Internet | Ce que son hôte peut atteindre |
| Durée maximale d'une étape | 5 minutes | 1 heure |
| Variables secrètes | Celles que vous laissez utiliser aux agents globaux | Celles qui le listent |
| Commandes Bash de OneUptime AI | Jamais | Pour les règles IA qui le choisissent |
| Corrections de code de OneUptime AI | Ouvertes pour relecture sans être compilées ni testées | Compilées et testées avant l'ouverture de la pull request |

Un agent Runbook global exécute les étapes de nombreux projets, c'est pourquoi chaque étape est tenue à l'écart de toutes les autres :

- Chaque étape s'exécute dans son propre bac à sable `isolated-vm`, créé pour cette étape et jeté après elle : pas de fichiers, pas de processus, pas de variables d'environnement, et rien de conservé d'une étape à l'autre.
- Ses requêtes HTTP n'atteignent que les adresses publiques d'Internet, jamais une adresse privée, de bouclage ou de lien local ni un point de terminaison de métadonnées cloud, si bien qu'un agent global n'atteint jamais votre réseau.
- Il ne reçoit une variable secrète que lorsque son réglage **Les agents Runbook globaux peuvent l'utiliser** est activé, et seulement pour une étape du propre projet de la variable.
- Un projet exécute au plus trois étapes à la fois sur les agents globaux, si bien qu'aucun projet ne les garde pour lui seul.

Un agent Runbook global prend aussi en charge les corrections de code de OneUptime AI, dans chaque dépôt de code qui travaille sur **Agent Runbook global**. Il écrit chaque correction et ouvre la pull request, mais n'exécute aucune commande, pas même les commandes de préparation, de compilation et de test du dépôt, si bien que la pull request indique que sa vérification a été ignorée. Il n'atteint que des serveurs Git sur Internet, en HTTPS, sauf sur un OneUptime auto-hébergé, où il peut aussi atteindre les serveurs Git privés que le serveur lui-même peut atteindre. Il n'agit que pour les corrections qu'il prend, et ne reçoit le jeton d'un dépôt que pendant qu'il y travaille sur une correction. Le jeton d'un dépôt GitHub n'atteint que ce seul dépôt et est révoqué à la fin de la correction.

Choisissez l'un de vos propres agents pour une étape qui doit atteindre votre réseau, ou pour garder l'étape sur des hôtes que vous contrôlez. Pour garder chaque étape sur vos propres agents, désactivez **Utiliser les agents Runbook globaux** en bas de **Runbooks → Agents de runbook**. Une étape JavaScript qui ne choisit aucun agent s'exécute alors sur l'agent Runbook par défaut du projet ou, s'il n'y en a pas, échoue, en le disant, jusqu'à ce qu'elle choisisse l'un des vôtres ; une étape qui choisit l'un de vos agents le garde dans tous les cas. Un dépôt de code qui ne choisit aucun agent dans ses paramètres dans Code travaille lui aussi sur l'agent Runbook par défaut du projet ou, s'il n'y en a pas, sur un agent Runbook global, et a besoin de l'un des vôtres tant que l'option est désactivée ; voir [Code](/docs/ai/ai-agent#choisir-le-runner-du-dépôt).

### D'où viennent les agents Runbook globaux

Sur OneUptime Cloud, c'est OneUptime qui les fait tourner. Une installation auto-hébergée en fait tourner un à elle par défaut, comme elle fait tourner ses propres sondes globales : le service `global-runner` dans Docker Compose et le déploiement `globalRunner` dans le chart Helm. Il détient sa propre clé, `GLOBAL_RUNNER_KEY`, et rien d'autre du serveur.

Un administrateur principal peut en ajouter d'autres, pour exécuter des étapes et des corrections de code depuis d'autres hôtes : dans le tableau de bord d'administration, ouvrez **Paramètres**, puis **Agents Runbook globaux**, créez-en un, puis exécutez la commande que donne son **Afficher l'ID et la clé** sur un hôte qui atteint Internet.

Pour désactiver celui qui est fourni, définissez `GLOBAL_RUNNER_REPLICAS=0` dans le `config.env` de Docker Compose, ou `globalRunner.enabled` à `false` dans le chart Helm. Sans aucun agent global, **Runbooks → Agents de runbook** ne liste que vos propres agents, et chaque étape JavaScript et chaque dépôt de code en choisit un.

## Avant de commencer

- **Un hôte avec Docker** dans votre infrastructure, qui joint l'URL de votre OneUptime en HTTPS ainsi que les systèmes sur lesquels agissent vos étapes.
- **Un rôle qui crée des agents Runbook.** Project Owner, Project Admin, Project Member et Runbook Admin peuvent en créer un. Seuls un Project Owner, un Project Admin ou un Runbook Admin voient la clé d'un agent, que contient la commande d'installation.

## Installer un agent Runbook

### 1. Créer l'enregistrement de l'agent

Allez dans **Runbooks → Agents de runbook** et créez un nouvel agent. Cliquez sur **Créer : Agent Runbook** et remplissez ses champs, tous sur une seule page :

| Champ | Où | Notes |
| --- | --- | --- |
| **Nom** | Sur la page | Un nom parlant, en général l'endroit où il tourne et ce qu'il peut joindre, par exemple `prod-eu-west-1`. C'est ce que vous choisissez quand vous écrivez une étape. |
| **Description** | Sur la page | Facultatif. Une phrase sur ce que cet hôte peut joindre. |
| **Exécute les runbooks** | Sous **Plus de champs** | Activé par défaut. Permet à cet agent de prendre des étapes de runbook. |
| **Étiquettes** | Sous **Plus de champs** | Facultatif. |

Un agent Runbook prend en compte un changement de ses capacités à son prochain heartbeat ; inutile de le redémarrer. L'IA n'est pas une capacité. Un dépôt de code choisit, dans ses paramètres dans Code, l'agent sur lequel l'IA y travaille, et la page de l'agent liste les dépôts qui le choisissent. Une règle IA choisit l'agent sur lequel OneUptime AI exécute ses commandes : c'est ce choix qui permet aux commandes de OneUptime AI de s'exécuter sur l'agent. La page de l'agent liste aussi les règles IA qui le choisissent.

### 2. Copier la commande d'installation

Sur la ligne de l'agent, cliquez sur **Afficher les instructions de configuration**. La boîte de dialogue **Configuration de l'agent Runbook** montre une commande `docker run` préremplie avec l'ID et la clé de cet agent. La même commande figure sur la page de l'agent, sous **Instructions de configuration**.

Seuls un Project Owner, un Project Admin ou un Runbook Admin peuvent lire la clé. Les autres voient « Vous n'avez pas l'autorisation d'afficher la clé de cet agent Runbook » à la place de la commande.

### 3. La lancer sur un hôte de votre infrastructure

Lancez la commande sur un hôte de votre environnement qui peut :

- joindre votre instance OneUptime en HTTPS, et
- faire ce dont vos étapes ont besoin, par exemple joindre d'autres hôtes en SSH, appeler le serveur API d'un cluster ou parler à une base de données.

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

### 4. Vérifier que l'agent est connecté

Revenez dans **Runbooks → Agents de runbook**. Moins d'une minute après le démarrage du conteneur, le **Statut** de l'agent doit indiquer **Connecté**, avec une valeur récente dans **Dernière fois vu**. Sur la page de l'agent, la carte **Statut de l'agent Runbook** montre sa **Version de l'agent Runbook** et son **Hôte**. S'il reste **Jamais connecté** ou **Déconnecté**, voir [Dépannage](#dépannage).

### 5. Garder l'agent à jour

Quand un agent tourne dans une version plus ancienne que votre OneUptime, un signe d'avertissement apparaît à côté de sa **Version de l'agent Runbook** sur sa page. Sélectionnez-le pour voir comment le mettre à jour : récupérer la nouvelle image et supprimer le conteneur, puis relancer la commande d'installation de l'étape 2. Un agent installé par le chart de l'agent Kubernetes se met à jour avec le chart.

```bash
docker pull oneuptime/runner:release
docker rm -f oneuptime-runner
```

## Diriger une étape vers un agent Runbook

:::steps
### Ajouter une étape qui s'exécute sur un agent Runbook

Dans les **Étapes** de votre runbook, ajoutez une étape JavaScript, Bash, SSH ou kubectl.

### Choisir l'agent Runbook

Ouvrez **Plus de champs** de l'étape : sa liste déroulante **Agent Runbook** affiche chaque agent du projet, et s'il est connecté, et la ligne repliée nomme l'agent sur lequel l'étape s'exécute. Si le projet n'en a encore aucun, l'étape le dit et vous renvoie à **Runbooks › Runners**. Le premier choix est ce sur quoi s'exécute une étape qui ne choisit aucun agent : l'[agent Runbook par défaut du projet](#lagent-runbook-par-défaut-du-projet), marqué **Par défaut du projet**, ou sinon, pour une étape JavaScript, **Agent Runbook global**.

### Enregistrer les étapes

Cliquez sur **Enregistrer les étapes**. Quand une exécution atteint l'étape, le Worker met en file une tâche pour l'ID de cet agent, et seul cet agent peut la prendre en charge. Une étape sur **Agent Runbook global** attend l'agent global qui se libère.
:::

Bash est exécuté avec `bash -c`. JavaScript s'exécute dans un bac à sable `isolated-vm` sur l'agent, sans accès au système de fichiers ni aux processus ; il peut appeler des API HTTP publiques avec `axios`, mais pas des adresses d'un réseau privé. Une étape SSH ou kubectl se connecte avec une [variable de runbook](/docs/runbooks/variables) secrète, qui doit lister l'agent Runbook de l'étape sous **Vos agents Runbook qui peuvent l'utiliser**.

Besoin de plus d'un agent ? Créez-les, puis dirigez chaque étape vers celui qui convient. Pour la redondance, faites tourner un second agent et répartissez vos étapes entre les deux, ou gardez un runbook de secours dont les étapes visent l'autre agent.

## L'agent Runbook par défaut du projet

Un projet peut faire de l'un de ses propres agents Runbook son agent par défaut, comme il fait d'une configuration Twilio sa configuration par défaut. Chaque étape de runbook qui ne choisit aucun agent s'exécute alors sur lui : les étapes Bash, SSH et kubectl, et les étapes JavaScript, qui s'exécuteraient sinon sur un agent Runbook global. L'IA de chaque dépôt de code qui ne choisit aucun agent dans ses paramètres dans Code y travaille aussi.

Pour faire d'un agent l'agent par défaut, allez dans **Runbooks → Agents de runbook**, ouvrez le menu **⋯** sur la ligne de l'agent, cliquez sur **Définir par défaut pour le projet**, puis confirmez dans la boîte de dialogue. Ou ouvrez l'agent et, sur sa carte **Valeur par défaut du projet**, activez **Utiliser par défaut pour le projet**. La liste marque l'agent par défaut **Par défaut du projet**, à côté de son nom, tout comme la liste déroulante **Agent Runbook** d'une étape, sur son premier choix. Un projet a un seul agent par défaut : faire d'un autre agent l'agent par défaut le remplace. **Ne plus utiliser par défaut pour le projet**, dans le même menu, ou l'interrupteur sur la page de l'agent, cesse de l'utiliser.

Où s'exécute une étape qui ne choisit aucun agent :

| Le projet | Une étape JavaScript | Une étape Bash, SSH ou kubectl |
| --- | --- | --- |
| A un agent par défaut | L'agent par défaut | L'agent par défaut |
| N'en a pas, et utilise les agents Runbook globaux | Un agent Runbook global | Nulle part : l'étape échoue, en disant qu'elle n'a pas d'agent |
| N'en a pas, et n'utilise pas les agents Runbook globaux | Nulle part : l'étape échoue, en le disant | Nulle part : l'étape échoue, en disant qu'elle n'a pas d'agent |

Une étape qui a choisi un agent le garde, quel que soit l'agent par défaut, et une étape JavaScript peut toujours choisir elle-même **Agent Runbook global**. Définir un agent par défaut ne modifie aucune étape enregistrée.

L'agent par défaut est l'un des agents propres au projet qui exécute les étapes de runbook : pas un agent Runbook global, pas l'agent dans le cluster que l'agent Kubernetes a installé, et pas un agent dont **Exécute les runbooks** est désactivé. Tant qu'un agent est l'agent par défaut, son **Exécute les runbooks** reste activé. Quand l'agent par défaut n'est pas connecté, la liste déroulante d'une étape le dit, et une étape sur lui l'attend, comme pour tout agent, jusqu'à l'expiration de son délai de prise en charge.

Les étapes de runbook et les dépôts de code qui ne choisissent aucun agent utilisent l'agent par défaut, et le suivent quand un autre agent devient celui par défaut. Une règle IA choisit son propre agent, et une nouvelle règle démarre sur l'agent par défaut.

## Notes d'exploitation

### Délais

Deux délais s'appliquent à chaque étape qui s'exécute sur un agent Runbook :

| Délai | Valeur par défaut | Ce qu'il contrôle |
| --- | --- | --- |
| **Délai de prise en charge** | 2 minutes | Combien de temps le Worker attend que l'agent choisi prenne la tâche en charge. Si l'agent ne la prend pas à temps, l'étape échoue pour dépassement de délai et le runbook continue (ou s'arrête, selon **Continuer en cas d'échec**). |
| **Délai d'exécution** | 30 secondes | Combien de temps l'agent laisse l'étape tourner avant de l'arrêter. Bash reçoit `SIGKILL` ; le bac à sable de JavaScript est détruit. |

Les deux se configurent par étape. Ouvrez **Runbooks › votre runbook › Étapes**, dépliez l'étape et réglez **Délai d'exécution** et **Délai de prise en charge** (en secondes) sous ses **Plus de champs**. Laissez un champ vide pour garder la valeur par défaut. Chacun accepte de 1 seconde à 1 heure ; les valeurs hors de cette plage sont ramenées dans la plage à l'exécution de l'étape.

La fenêtre d'attente globale du Worker est `claim timeout + execution timeout + a few seconds`. Choisissez des valeurs adaptées à l'étape.

Deux points à garder en tête si vous réduisez le délai de prise en charge :

- L'agent demande du travail à chaque cycle d'interrogation (`ONEUPTIME_RUNNER_POLL_INTERVAL_MS`, 5 secondes par défaut). Un délai de prise en charge plus court qu'un cycle peut expirer avant qu'un agent parfaitement sain ait même vu la tâche, et l'étape échoue alors avec le même message qu'avec un agent hors ligne.
- Un agent exécute une tâche à la fois par défaut (`ONEUPTIME_RUNNER_CONCURRENCY`). Pendant qu'une longue étape l'occupe, les autres étapes dirigées vers le même agent épuisent leurs propres délais de prise en charge. Si vous portez un délai d'exécution à plusieurs minutes, augmentez d'autant le délai de prise en charge des étapes qui partagent cet agent, ou donnez-leur un autre agent.

### Bail et heartbeat

```mermaid title="Une tâche entre OneUptime et son agent Runbook"
sequenceDiagram
    participant O as OneUptime
    participant R as Agent Runbook
    O->>O: Mettre en file une tâche pour cet agent
    R->>O: Prendre en charge la tâche suivante
    O-->>R: La tâche, avec un bail de 30 secondes
    loop Toutes les 10 secondes pendant l'exécution
        R->>O: Renouveler le bail
    end
    R->>O: Envoyer le résultat
    O->>O: Enregistrer la sortie et poursuivre l'exécution
```

Quand un agent prend une tâche en charge, il obtient un bail court (30 secondes par défaut). Pendant l'exécution de l'étape, l'agent renouvelle le bail toutes les 10 secondes. Si l'agent meurt ou perd le réseau au milieu d'un script, le bail expire et le Worker marque la tâche `TimedOut` au lieu d'attendre indéfiniment.

Les processus enfants de Bash ne sont **pas** annulés automatiquement à l'expiration du bail (un bac à sable JavaScript est lui aussi laissé finir, s'il finit), mais le Worker cesse de les attendre, et l'agent ne peut plus soumettre de résultat une fois qu'une autre prise en charge a pris le relais. Concevez des scripts qui peuvent être relancés sans risque si l'exécution unique compte pour vous.

### Si le Worker OneUptime redémarre au milieu d'une étape

Une exécution de runbook tourne sur un seul Worker du début à la fin, donc un déploiement ou un plantage peut l'interrompre pendant qu'une étape est en cours. La suite dépend de la reprise ou non de l'exécution :

- **Elle reprend.** Le Worker qui la reprend trouve la tâche que votre étape a déjà créée et **s'y rattache**. Il attend cette tâche au lieu d'envoyer une seconde copie du script à votre agent. Si l'agent avait déjà terminé, le résultat enregistré est utilisé tel quel. Une étape est envoyée à un agent au plus une fois par exécution.
- **Elle ne reprend pas.** Si l'exécution n'est jamais reprise, un balayage la marque `Failed` une fois qu'elle a dépassé la fenêtre de prise en charge et d'exécution configurée pour son étape en cours, avec un message qui nomme cette étape. Une exécution ne reste jamais bloquée en `Running`.

La seule chose que ce mécanisme ne peut pas dire, c'est jusqu'où un script est allé avant la disparition du Worker. Une étape qui était en cours est signalée en échec avec une note indiquant qu'elle a pu s'exécuter partiellement : vérifiez le système cible avant de relancer le runbook.

### Aucun agent en ligne

Si l'agent choisi est hors ligne quand l'étape s'exécute, la tâche attend en `Pending` jusqu'à l'expiration du délai de prise en charge, puis l'étape échoue avec "No runbook agent picked up this step before the wait window expired." La page **Agents de runbook** est l'endroit où vérifier la couverture avant d'exécuter un runbook en situation réelle. Une étape sur un agent Runbook global échoue plutôt avec "No global Runner picked up this step before the wait window expired."

### Plafond de sortie

stdout et stderr réunis sont plafonnés à **50 Ko** par étape. Une sortie plus longue est coupée avec un marqueur. Si vous avez besoin d'un journal complet, écrivez-le depuis le script dans votre stockage de journaux ou un stockage objet et affichez l'URL avec `echo`.

### Annulation

Annuler une exécution de runbook, depuis la page d'exécution ou l'API, marque aussitôt toutes ses tâches `Pending`, `Claimed` et `Running` comme `Cancelled`. Un agent déjà au milieu d'un script termine son travail, mais le serveur n'accepte pas son résultat, et aucune étape suivante du runbook n'est envoyée.

### Concurrence

Chaque agent exécute une tâche à la fois par défaut. Pour en permettre davantage, définissez `ONEUPTIME_RUNNER_CONCURRENCY` sur le conteneur, mais n'oubliez pas que l'agent partage l'hôte avec tout ce qui y tourne déjà.

## Variables d'environnement

L'agent lit ces variables au démarrage :

| Variable | Obligatoire | Valeur par défaut | Notes |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | oui | — | URL de base de votre instance OneUptime, par exemple `https://oneuptime.yourdomain.com`. |
| `ONEUPTIME_RUNNER_ID` | oui | — | L'ID de l'agent, tiré de sa commande d'installation. |
| `ONEUPTIME_RUNNER_KEY` | oui | — | La clé secrète de l'agent, tirée de sa commande d'installation. |
| `ONEUPTIME_RUNNER_POLL_INTERVAL_MS` | non | `5000` | La fréquence à laquelle l'agent demande de nouvelles tâches. Une valeur inférieure à `1000` revient à la valeur par défaut. |
| `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS` | non | `60000` | La fréquence à laquelle l'agent signale qu'il est vivant. Une valeur inférieure à `5000` revient à la valeur par défaut. |
| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` | non | `10000` | La fréquence à laquelle l'agent renouvelle le bail d'une tâche en cours. Une valeur inférieure à `1000` revient à la valeur par défaut. |
| `ONEUPTIME_RUNNER_CONCURRENCY` | non | `1` | Nombre maximal de tâches simultanées sur cet agent. |
| `ONEUPTIME_RUNNER_ENABLE_RUNBOOKS` | non | — | Mettez `false` pour que cet agent ne prenne plus d'étapes de runbook, quoi qu'indique le tableau de bord. Ne peut que désactiver la capacité. |
| `ONEUPTIME_RUNNER_ENABLE_CODE_FIXES` | non | — | Mettez `false` pour que cet agent ne prenne plus de corrections de code par IA, même pour un dépôt de code qui le choisit. |
| `ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS` | non | — | Mettez `false` pour que cet agent n'exécute plus de commandes de remédiation IA, quoi qu'indique le tableau de bord. |

## Faire tourner la clé d'un agent

Si une clé fuite, réinitialisez-la. L'ancienne clé cesse aussitôt de fonctionner.

:::steps
### Réinitialiser la clé

Ouvrez l'agent depuis **Runbooks → Agents de runbook**, cliquez sur **Réinitialiser la clé de l'agent Runbook** et confirmez. L'agent ne se connecte plus tant qu'il n'a pas la nouvelle clé.

### Lancer le conteneur avec la nouvelle clé

Copiez la nouvelle commande depuis les **Instructions de configuration** de l'agent, supprimez l'ancien conteneur et lancez la nouvelle commande sur le même hôte :

```bash
docker rm -f oneuptime-runner
```

### Vérifier qu'il se reconnecte

Dans **Runbooks → Agents de runbook**, le **Statut** de l'agent repasse à **Connecté** en moins d'une minute.
:::

## Autorisations

La gestion des agents relève du groupe d'autorisations Runbooks existant :

- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — gérer les enregistrements des agents.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (rôles) — `RunbookAdmin` construit les runbooks, leurs règles et les agents sur lesquels ils tournent, et les exécute. `RunbookMember` ouvre les runbooks et leurs exécutions et les exécute — il lance une exécution, termine ou ignore ses étapes et l'annule — mais ne crée, ne modifie ni ne supprime aucun runbook ni aucun agent. `RunbookViewer` lit les runbooks et leurs exécutions et n'exécute rien. `RunbookAdmin` regroupe toutes les autorisations granulaires ci-dessus.
- Les agents Runbook globaux n'appartiennent à aucun projet : seul un administrateur principal en ajoute, en modifie ou en supprime, dans le tableau de bord d'administration. Quiconque peut lire les agents d'un projet les voit, et désactiver **Utiliser les agents Runbook globaux** demande l'autorisation de modifier le projet.

Déclencher un runbook (et donc envoyer ses étapes aux agents) demande un rôle qui exécute les runbooks — `ProjectOwner`, `ProjectAdmin`, `ProjectMember`, `RunbookAdmin` ou `RunbookMember` — ou `CreateRunbookExecution` ; terminer, ignorer ou annuler une exécution accepte aussi `EditRunbookExecution`. Un rôle n'exécute que les runbooks que sa portée atteint.

La clé d'un agent n'est lisible que par les Project Owners, les Project Admins et les Runbook Admins.

## API côté agent

Pour les curieux : l'agent utilise ces points de terminaison, montés sous `/runner-ingest`. Le chemin d'avant la fusion, `/runbook-agent-ingest`, est toujours servi pour les agents qui n'ont pas encore été redéployés, donc mettre à jour le serveur ne les casse pas. Ils sont authentifiés par l'ID et la clé de l'agent dans le corps JSON (`agentId` et `agentKey`), ou dans les en-têtes `x-agent-id` et `x-agent-key`.

| Point de terminaison | Rôle |
| --- | --- |
| `POST /heartbeat` | Signe de vie. Met à jour la dernière heure de contact, la version et les informations d'hôte de l'agent, et renvoie les capacités que le projet lui accorde. |
| `POST /claim-next-job` | Prendre en charge de façon atomique la plus ancienne tâche `Pending` destinée à l'ID de cet agent. Renvoie `{ job: null }` quand il n'y a rien à faire. Un agent global prend plutôt en charge la plus ancienne étape qui attend n'importe quel agent global. |
| `POST /job/:jobId/heartbeat` | Rafraîchir le bail de la tâche. Renvoie 404 une fois le bail expiré ou la tâche terminée. |
| `POST /job/:jobId/result` | Soumettre le résultat final. Ignoré si le bail est déjà passé à autre chose. |
| `POST /disconnect` | Se déconnecter lors d'un arrêt propre. |

Vous ne devriez pas avoir à les appeler à la main : le conteneur de l'agent le fait. Ils sont documentés ici pour que vous puissiez construire votre propre agent si vous avez une contrainte à laquelle le nôtre ne répond pas.

## Dépannage

:::details L'agent reste Jamais connecté ou Déconnecté
- Consultez les journaux du conteneur avec `docker logs oneuptime-runner` à la recherche d'erreurs d'authentification ou de réseau.
- Vérifiez que l'hôte joint l'URL de votre OneUptime, par exemple avec `curl`.
- Vérifiez que l'ID et la clé ont été copiés sans espaces, et que `ONEUPTIME_URL` est l'adresse à laquelle vous ouvrez OneUptime.

**Jamais connecté** signifie que l'agent ne s'est jamais signalé. **Déconnecté** signifie qu'il l'a fait, mais pas dans les 5 dernières minutes.
:::

:::details Les étapes échouent avec "No runbook agent picked up this step before the wait window expired."
L'agent de l'étape n'a pas pris la tâche en charge dans son délai de prise en charge. Vérifiez que l'agent est **Connecté**, que **Exécute les runbooks** est activé pour lui, et qu'il n'est pas occupé par une longue étape : il exécute une tâche à la fois, sauf si vous augmentez `ONEUPTIME_RUNNER_CONCURRENCY`. Un délai de prise en charge plus court que l'intervalle d'interrogation échoue de la même façon.
:::

:::details Les étapes échouent avec "The runbook agent stopped responding while this step was running."
L'agent a pris la tâche en charge, puis a cessé de renouveler son bail : il a planté, redémarré ou perdu le réseau. Vérifiez qu'il est en ligne, puis vérifiez le système cible avant de relancer le runbook.
:::

:::details L'agent journalise "No capability is enabled"
Toutes les capacités sont désactivées pour cet agent. Activez **Exécute les runbooks** sur la page de l'agent dans OneUptime. Il prend en compte le changement à son prochain heartbeat.
:::

:::details Une étape échoue parce que son agent Runbook n'a pas le droit d'utiliser une variable secrète
L'étape nomme une variable secrète qui n'autorise pas son agent Runbook, donc l'agent ne l'a pas reçue et l'étape n'a pas été exécutée. L'erreur nomme le secret et ce qu'il faut changer. Sous **Runbooks → Paramètres → Variables globales**, ou sous **Paramètres → Variables** du runbook, ajoutez l'agent sous **Vos agents Runbook qui peuvent l'utiliser**, ou activez **Les agents Runbook globaux peuvent l'utiliser** pour une étape sur un agent Runbook global. Ou choisissez un agent que le secret autorise.
:::

:::details Une étape kubectl échoue parce que son agent Runbook est trop ancien
L'étape a échoué avec "This kubectl step runs a script, and this Runner is too old to run one, so it was not run." Un agent Runbook plus ancien que les scripts kubectl ne peut pas en exécuter. Une étape Kubernetes transformée en script kubectl lors de la mise à niveau s'exécute toujours sur lui, comme l'action avec laquelle elle a été écrite, jusqu'à ce que son script ou son kubeconfig soit modifié. Mettez l'agent à jour, comme le montre [Garder l'agent à jour](#5-garder-lagent-à-jour), puis relancez le runbook.
:::

## Prochaines étapes

:::cards
- [Rédiger un runbook](/docs/runbooks/authoring): Écrire les étapes qui s'exécutent sur votre agent Runbook.
- [Variables de runbook](/docs/runbooks/variables): Les valeurs et secrets que vos étapes utilisent, et les agents Runbook qui les reçoivent.
- [Configuration & sécurité des runbooks](/docs/runbooks/configuration): Limites, autorisations et durcissement.
:::
