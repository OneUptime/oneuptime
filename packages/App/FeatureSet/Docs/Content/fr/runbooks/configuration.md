# Configuration & sécurité des runbooks

Voici la référence pour les opérateurs et les responsables de la sécurité : où s'exécute chaque type d'étape, les limites et les délais auxquels une étape est soumise, qui peut faire quoi, et comment les runbooks sont durcis.

:::cards
- [Où s'exécute chaque type d'étape](#où-sexécute-chaque-type-détape): Le Worker, un agent Runbook ou une personne.
- [Plafonds de sortie et délais](#plafonds-de-sortie-et-délais): Chaque limite à laquelle une étape est soumise.
- [Autorisations](#autorisations): Les autorisations granulaires, les trois rôles de runbook, et les runbooks qu'un rôle atteint.
- [Notes de durcissement](#notes-de-durcissement): Bac à sable, accès réseau et authentification des agents Runbook.
:::

## Où s'exécute chaque type d'étape

```mermaid title="Quelles étapes s'exécutent où"
flowchart TB
    subgraph ou["OneUptime"]
        worker["Worker"]
        onworker["Étapes de<br/>requête HTTP<br/>Étapes IA"]
    end
    subgraph yours["Votre infrastructure"]
        runner["Agent Runbook"]
        onrunner["Étapes JavaScript<br/>et Bash<br/>Étapes SSH<br/>et kubectl"]
    end
    person["Une personne"]
    worker --> onworker
    worker -->|"Étapes<br/>Manual et<br/>approbations"| person
    worker --->|"met en file<br/>une tâche<br/>pour l'agent<br/>de l'étape"| runner
    runner --> onrunner
```

| Type d'étape | S'exécute sur | Comment |
| --- | --- | --- |
| Manual | Une personne | L'exécution attend que quelqu'un termine ou ignore l'étape. |
| JavaScript | Un agent Runbook | Dans un bac à sable `isolated-vm`. |
| HTTP request | Le Worker OneUptime | Un appel HTTP sortant. |
| Bash | Un agent Runbook | `bash -c <script>`. |
| SSH | Un agent Runbook | Une connexion SSH qui exécute le script avec bash sur la machine, connectée avec une [variable](/docs/runbooks/variables) secrète. |
| kubectl | Un agent Runbook | `bash -c <script>`, avec `KUBECONFIG` pointant vers le cluster. |
| AI | Le Worker OneUptime | Un appel au fournisseur LLM du projet. |

## Comment les étapes des agents Runbook sont envoyées

Les étapes JavaScript, Bash, SSH et kubectl **ne s'exécutent jamais sur le Worker OneUptime**. Elles sont envoyées comme tâches à un [agent de runbook](/docs/runbooks/agents) précis : un petit processus que vous installez sur un hôte de votre propre infrastructure. Une étape qui n'en choisit aucun va à l'[agent Runbook par défaut du projet](/docs/runbooks/agents#lagent-runbook-par-défaut-du-projet), s'il en a un ; une étape JavaScript va sinon aux [agents Runbook globaux](/docs/runbooks/agents#agents-runbook-globaux) qu'OneUptime fait tourner pour chaque projet.

Le modèle d'envoi :

1. L'auteur de l'étape de runbook choisit un agent Runbook dans la liste déroulante en écrivant l'étape.
2. Quand l'étape s'exécute, le Worker insère une ligne dans `RunnerJob` dont `targetAgentId` vaut l'ID de cet agent, ou celui de l'agent par défaut du projet pour une étape qui n'en a choisi aucun, et dont le statut est `Pending`. Une étape JavaScript qui n'en a choisi aucun, dans un projet sans agent par défaut qui utilise les agents globaux, reçoit plutôt `runsOnGlobalRunner`.
3. Cet agent précis (et lui seul) prend la tâche en charge de façon atomique, l'exécute localement — Bash et kubectl via `bash -c <script>`, JavaScript dans un bac à sable `isolated-vm`, SSH par une connexion à la machine, chacun avec les variables qu'il nomme insérées — et renvoie le résultat. N'importe quel agent global peut prendre en charge une tâche avec `runsOnGlobalRunner`.
4. Le Worker reprend le runbook avec le résultat.

Il n'existe plus d'indicateur d'environnement `RUNBOOK_BASH_ENABLED`. Le fonctionnement de ces étapes dans un déploiement dépend uniquement de la présence, dans le projet, d'un agent Runbook connecté avec **Exécute les runbooks** activé. Une étape JavaScript fonctionne aussi sur un agent Runbook global.

## Plafonds de sortie et délais

| Limite | Valeur | S'applique à |
| --- | --- | --- |
| Sortie par étape | **50 Ko**. Une sortie plus longue est coupée avec un marqueur. | Chaque étape automatisée |
| Délai d'exécution | **30 secondes** par défaut | Étapes JavaScript, Bash, SSH et kubectl |
| Délai de la requête | **30 secondes** par défaut | Étapes de requête HTTP |
| Délai de prise en charge | **2 minutes** par défaut : combien de temps le Worker attend que l'agent choisi prenne la tâche en charge avant de la faire échouer | Étapes JavaScript, Bash, SSH et kubectl |
| Plage des délais | **1 seconde à 1 heure** | Chaque délai |
| Attente d'une personne | Aucune limite | Étapes Manual et approbations |

Réglez les délais étape par étape, sous **Plus de champs** de l'étape, sur la page **Étapes** du runbook ; laissez un champ vide pour garder la valeur par défaut. Une valeur hors plage est ramenée dans la plage à l'exécution de l'étape, pour qu'une configuration mal saisie ne puisse ni désactiver le délai ni occuper indéfiniment un emplacement du Worker.

## Autorisations

Les autorisations des runbooks se trouvent dans le groupe d'autorisations `Runbook` :

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gérer les modèles de runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `DeleteRunbookExecution`, `ReadRunbookExecution` — lancer, cocher, supprimer et lire les exécutions.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gérer les règles de déclenchement automatique.
- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — gérer les agents Runbook qui exécutent les étapes dans votre propre infrastructure. (Elles s'appelaient `*RunbookAgent` avant le renommage en Runner ; les attributions existantes ont été migrées, il n'y a donc rien à réattribuer.)
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (rôles) — `RunbookAdmin` construit les runbooks, leurs règles et les agents sur lesquels ils tournent, et les exécute. `RunbookMember` ouvre les runbooks et leurs exécutions et les exécute — il lance une exécution, termine ou ignore ses étapes et l'annule — mais ne crée, ne modifie ni ne supprime aucun runbook ni aucun agent. `RunbookViewer` lit les runbooks et leurs exécutions et n'exécute rien. `RunbookAdmin` regroupe toutes les autorisations granulaires ci-dessus.

Un rôle exécute les runbooks que sa portée atteint. Une attribution `RunbookMember`, `RunbookAdmin` ou `ProjectMember` limitée à certaines étiquettes lance et fait avancer les exécutions des runbooks qui portent ces étiquettes, une attribution limitée à **Owned** celles des runbooks dont son équipe est propriétaire, et le blocage d'une étiquette par une équipe lui retire ces runbooks. `CreateRunbookExecution` et `EditRunbookExecution` portent sur les exécutions, qui n'ont pas d'étiquettes : elles atteignent donc tous les runbooks du projet. L'approbation d'une suggestion de remédiation qui lance un runbook est vérifiée de la même façon.

La planification et le webhook d'un runbook démarrent des exécutions sans personne présente : configurer l'un ou l'autre demande donc l'autorisation de modifier le runbook et de l'exécuter, tout comme voir son URL de webhook. Les désactiver ne demande que l'autorisation de le modifier. Voir [Déclencheurs de runbook](/docs/runbooks/triggers#qui-peut-configurer-les-déclencheurs).

Les variables de runbook sont hors de `RunbookAdmin`, qui ne fait que les lire, pour les choisir dans les étapes qu'il écrit. Gérer les variables demande `ProjectOwner` ou `ProjectAdmin`, ou les autorisations `CreateRunbookSecret`, `EditRunbookSecret`, `DeleteRunbookSecret` et `ReadRunbookSecret` : les autorisations des secrets de runbook, qui ont gardé leur nom quand les secrets sont devenus des variables. Voir [Variables de runbook](/docs/runbooks/variables).

Les règles de propriétaire et d'étiquettes sous **Runbooks → Paramètres** sont elles aussi en dehors de `RunbookAdmin`. Les gérer demande `ProjectOwner` ou `ProjectAdmin`, ou les autorisations `CreateRunbookOwnerRule` et `CreateRunbookLabelRule` avec leurs équivalents de modification, de suppression et de lecture.

Pour la façon dont les rôles et les autorisations granulaires se combinent, voir [Utilisateurs, équipes et autorisations](/docs/permissions/index).

## File & worker

Les exécutions de runbook tournent dans la file BullMQ `Runbook`. Chaque processus Worker exécute jusqu'à 25 exécutions à la fois ; ce nombre est fixé dans le code, pas par une variable d'environnement.

Quand une étape manuelle est cochée via l'API, l'exécution est remise en file pour continuer à l'étape suivante. Elle attend en `Scheduled` qu'un Worker la reprenne, et une exécution en file n'échoue jamais pour cause d'attente.

## Notes de durcissement

- **JavaScript, Bash, SSH et kubectl** s'exécutent sur un hôte d'agent Runbook que vous contrôlez, pas sur le Worker OneUptime. JavaScript tourne dans un isolat `isolated-vm` distinct avec 128 Mo de mémoire et sans accès au système de fichiers ni aux processus de l'agent ; il peut faire des requêtes HTTP avec `axios`, mais les requêtes vers les réseaux privés et les adresses de bouclage et de lien local sont refusées. Bash s'exécute via `bash -c`, avec un délai appliqué sur l'agent. Une étape JavaScript qui n'en choisit aucun s'exécute sur l'agent Runbook par défaut du projet ou, s'il n'y en a pas, sur un agent Runbook global.
- **Les étapes SSH** ne se connectent que si la machine présente l'une des clés d'hôte que l'étape indique. Une étape qui n'en indique aucune accepte toute clé, et sa sortie nomme celle que la machine a présentée, à indiquer dans l'étape.
- **Les étapes HTTP** utilisent une validation de statut permissive : une réponse 4xx ou 5xx est enregistrée comme étape en échec au lieu de lever une exception, et la sortie capturée reflète ce que le service distant a vraiment renvoyé. Les redirections ne sont pas suivies. Le Worker n'appelle jamais d'adresses de bouclage ou de lien local, comme un point de métadonnées cloud ; sur OneUptime Cloud, il refuse aussi les adresses de réseau privé, et un OneUptime auto-hébergé les refuse avec `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`.
- **Les étapes IA** ne voient jamais les notes privées d'incident ni les messages Slack et Microsoft Teams, et la sortie des étapes précédentes est analysée à la recherche de secrets, qui sont masqués avant d'atteindre le modèle. Les images intégrées et les longues données encodées sont laissées hors du prompt. Voir [AI](/docs/runbooks/authoring#ai).
- **Agents Runbook globaux** : ils n'exécutent que des étapes JavaScript, chacune dans un bac à sable créé pour cette étape et jeté après elle, qui n'atteint que les adresses publiques d'Internet, pendant 5 minutes au plus, et au plus trois étapes d'un même projet à la fois. Ils ne reçoivent que les variables secrètes du projet propre à l'étape qui sont activées pour les agents globaux ; celui qui est fourni détient sa propre clé et rien d'autre du serveur. Voir [Agents Runbook globaux](/docs/runbooks/agents#agents-runbook-globaux).
- **L'authentification des agents Runbook** se fait par ID et clé secrète, définis sur le conteneur de l'agent comme variables d'environnement. Côté serveur, l'identité de référence de l'agent provient de la ligne de base de données correspondant à l'ID et à la clé présentés : un client ne peut pas se faire passer pour un autre agent, même avec une clé compromise.
- **Les variables secrètes** sont chiffrées au repos, jamais renvoyées par l'API, et remises uniquement aux agents Runbook qu'elles listent, quand ceux-ci prennent en charge une étape qui les nomme. Une variable secrète est aussi remise à un agent Runbook global qui prend en charge une étape du propre projet de la variable, quand la variable autorise les agents globaux. L'agent Runbook remplace chaque secret remis à une étape par `[REDACTED]` dans ce que l'étape affiche, et OneUptime le fait de nouveau avant de stocker la sortie. Une étape de requête HTTP, que OneUptime envoie lui-même, reçoit chaque secret de son propre projet qu'elle nomme, et les masque dans la réponse qu'elle enregistre.

## Tables de la base de données

| Table | Ce qu'elle contient |
| --- | --- |
| `Runbook` | Le modèle : nom, slug, description, `isEnabled`, étiquettes et les étapes en JSON. |
| `RunbookExecution` | Une ligne par exécution, avec les clés étrangères facultatives `incidentId`, `alertId` et `scheduledMaintenanceId` et un tableau JSON `stepExecutions` qui fige les étapes et l'état de chacune. |
| `RunbookRule` | Les règles de déclenchement automatique, avec un discriminant `triggerEntityType` (Incident, Alert, ScheduledMaintenance), une relation plusieurs-à-plusieurs vers les runbooks à lancer, et ce sur quoi elles portent : une colonne JSON `criteria` (les conditions) plus des liens plusieurs-à-plusieurs vers les moniteurs, les gravités d'incident, les gravités d'alerte, les étiquettes et les étiquettes de moniteur, ainsi que des modèles de titre, de description, de nom de moniteur et de description de moniteur. |
| `Runner` | Une ligne par agent Runbook installé : nom, clé secrète, `lastAlive`, `connectionStatus`, informations d'hôte et capacités. Un agent global a `isGlobalRunner` défini et aucun projet ; l'agent par défaut du projet a `isProjectDefault` défini. |
| `RunnerJob` | Une ligne par étape envoyée à un agent Runbook : `targetAgentId` (l'agent choisi par l'auteur de l'étape), type d'étape, script ou charge utile, statut (`Pending` → `Claimed` → `Running` → `Succeeded`, `Failed`, `TimedOut` ou `Cancelled`), échéance de prise en charge, bail, sortie et code de sortie. `runsOnGlobalRunner` marque une étape que n'importe quel agent global peut prendre en charge. |
| `RunbookVariable` | Les variables de runbook : les variables globales du projet, et celles propres à un runbook, qui le nomment dans `runbookId` ; la valeur d'un secret chiffrée, et les agents Runbook qui peuvent recevoir un secret. |

## Conseils d'exploitation

- **Assurez-vous que l'agent Runbook choisi pour une étape est en bonne santé.** Si vous avez besoin de redondance, faites tourner un second agent et répartissez vos étapes entre les deux, ou gardez un runbook de secours qui vise l'autre agent.
- **Capturez des URL, pas des blobs.** Si une étape produit plus de quelques Ko de sortie, écrivez-la dans un stockage objet ou votre pile de journalisation et renvoyez l'URL.
- **L'idempotence compte.** Une étape de requête HTTP ou IA s'exécute de nouveau si le Worker redémarre au milieu de l'étape et que l'exécution reprend. Une étape sur un agent Runbook est envoyée au plus une fois par exécution, mais un script peut s'être exécuté en partie avant un échec, et vous pouvez relancer le runbook. Concevez des étapes qui peuvent être rejouées sans risque.

## Prochaines étapes

:::cards
- [Agents de runbook](/docs/runbooks/agents): Installer, exploiter et dépanner les agents Runbook.
- [Variables de runbook](/docs/runbooks/variables): Les valeurs et secrets qu'utilisent les étapes, et les agents Runbook qui les reçoivent.
- [Utilisateurs, équipes et autorisations](/docs/permissions/index): Comment les rôles, les étiquettes et les équipes décident qui exécute quoi.
:::
