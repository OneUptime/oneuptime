# Agents de Runbook

Un **Agent de Runbook** est un petit processus auto-hébergé qui exécute les étapes Bash *et* JavaScript de vos runbooks **dans votre propre infrastructure**. Le Worker OneUptime n'exécute jamais vos scripts — il les met en file d'attente, et un Agent de Runbook que vous avez installé dans votre environnement les récupère, les exécute et renvoie le résultat.

JavaScript tourne toujours dans un bac à sable `isolated-vm` ; la différence est que ce bac à sable vit sur votre hôte agent et non sur le nôtre.

Cette page explique comment installer un agent, y router des étapes Bash et JavaScript et l'exploiter au quotidien.

## Pourquoi les agents existent

Les versions précédentes d'OneUptime exécutaient les étapes Bash et JavaScript sur le Worker. JavaScript était en bac à sable (`isolated-vm`), Bash non. Les deux posaient problème pour tout ce qui dépasse un déploiement self-hosted single-tenant :

- **Frontière de confiance.** Quiconque pouvait écrire un runbook pouvait exécuter du code sur le Worker, avec accès aux variables d'environnement et au système de fichiers du Worker. Le bac à sable JavaScript bloquait l'évident mais ne pouvait pas empêcher un utilisateur déterminé de sonder ce qui était accessible depuis notre réseau.
- **Portée.** La plupart des étapes utiles veulent agir sur l'infrastructure du *client* (« redémarrer ce service », « kubectl sur notre cluster », « rechercher un enregistrement dans notre BDD interne ») — pas sur celle d'OneUptime.

Les Agents de Runbook inversent ce schéma. Les étapes Bash et JavaScript ne tournent pas chez nous. Elles tournent sur un hôte que vous contrôlez, et c'est vous qui décidez ce que cet hôte peut faire.

## Comment ça marche

1. Vous créez un Agent de Runbook dans OneUptime. OneUptime génère un ID et une clé secrète.
2. Vous lancez le conteneur de l'agent sur un hôte de votre infrastructure avec cet ID/clé et votre URL OneUptime.
3. L'agent demande à OneUptime toutes les quelques secondes : « du travail pour moi ? »
4. Quand une étape Bash ou JavaScript s'exécute, le Worker insère une ligne de job marquée du **Tag d'Agent** de l'étape et d'un type d'étape (Bash ou JavaScript), et son statut passe à `Pending`.
5. N'importe quel agent en bonne santé du même projet portant ce tag réclame le job (de façon atomique — jamais deux agents n'exécutent le même job), l'exécute localement — `bash -c <script>` pour Bash, un bac à sable `isolated-vm` pour JavaScript — capture le résultat et le renvoie.
6. Le Worker reprend le runbook avec le résultat.

L'agent n'a besoin que de **HTTPS sortant** vers votre instance OneUptime. Il n'accepte aucune connexion entrante.

## Installer un agent

### 1. Créer l'enregistrement de l'agent

Allez dans **Runbooks → Agents → Créer**. Remplissez :

| Champ | Notes |
| --- | --- |
| **Nom** | Un nom parlant — souvent `où-il-tourne-et-ce-qu-il-peut-faire`, par ex. `prod-eu-west-1`. |
| **Description** | Optionnel. Une phrase sur ce que cet hôte peut atteindre. Votre vous futur vous remerciera. |
| **Tags** | Séparés par des virgules. Les étapes Bash et JavaScript ciblent un tag ; tout agent du projet avec ce tag peut les exécuter. Motifs courants : `prod`, `staging`, `eu-west-1`, `db-host`. |

### 2. Copier la commande d'installation

Après création, cliquez sur **Afficher les instructions d'installation** dans la ligne de l'agent. Vous verrez une commande `docker run` préremplie avec l'ID et la clé de cet agent. **Sauvegardez la clé maintenant** — vous pouvez la réinitialiser plus tard, mais vous ne pourrez pas revoir la même valeur après fermeture de la fenêtre.

### 3. L'exécuter sur un hôte de votre infrastructure

Lancez la commande Docker sur n'importe quel hôte de votre environnement qui peut :

- atteindre votre instance OneUptime en HTTPS, et
- faire ce que vous voulez que vos étapes Bash fassent (SSH vers d'autres hôtes, `kubectl`, accès base de données, etc.).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.votre-domaine.com \
  -d oneuptime/runbook-agent:release
```

### 4. Vérifier que l'agent est connecté

Retournez à **Runbooks → Agents**. En environ 60 secondes, la ligne de l'agent doit passer à `Connected` avec un horodatage **Last seen** récent. Si elle reste `Disconnected` :

- Vérifiez les logs du conteneur (`docker logs oneuptime-runbook-agent`) pour des erreurs d'auth ou de réseau.
- Vérifiez que l'hôte atteint votre URL OneUptime avec `curl`.
- Vérifiez que l'ID et la clé ont été copiés sans espaces.

## Tags et routage

Les tags sont la façon dont une étape Bash ou JavaScript trouve un agent. Quelques motifs :

- **Un tag par environnement.** Taggez l'agent prod `prod`, celui de staging `staging`. Les étapes Bash ciblant `prod` ne tournent que sur prod.
- **Un tag par région.** `eu-west-1`, `us-east-1`. Utile quand une étape doit tourner près de la ressource qu'elle touche.
- **Plusieurs agents, même tag.** Lancez deux agents tous deux taggés `prod`. L'un ou l'autre peut réclamer un job — vous obtenez de la haute dispo et pouvez faire des redémarrages glissants sans casser les runbooks.
- **Plusieurs tags par agent.** Un agent dans votre cluster prod EU pourrait porter `prod`, `eu-west-1` et `kubernetes`. Les étapes Bash peuvent cibler n'importe lequel.

Les étapes Bash et JavaScript **doivent** chacune spécifier exactement un tag d'agent. Le ciblage multi-tag (tourner sur tout agent ayant `prod` AND `db`) est sur la feuille de route, pas dans cette version.

## Pointer une étape vers un agent

Dans votre runbook, ajoutez une étape Bash ou JavaScript. Le formulaire vous demande un **Agent Tag** :

- Saisissez le tag correspondant aux agent(s) sur lesquels la faire tourner.
- Écrivez votre script dans l'éditeur en dessous.

Quand le runbook tourne et atteint l'étape, le Worker met en file un job avec ce tag et ce type d'étape. S'il existe au moins un agent sain portant ce tag, le job est réclamé en quelques secondes et exécuté. Bash est exécuté via `bash -c` ; JavaScript tourne dans un bac à sable `isolated-vm` sur l'agent (pas de système de fichiers, pas de réseau, pas de `Function`/`eval`).

## Notes opérationnelles

### Timeouts

Deux timeouts s'appliquent à chaque étape Bash ou JavaScript :

| Timeout | Défaut | Effet |
| --- | --- | --- |
| **Claim timeout** | 2 minutes | Combien de temps le Worker attend qu'*un* agent réclame le job. Si personne ne le prend à temps, l'étape échoue avec `TimedOut` et le runbook continue (ou s'arrête, selon **Continuer en cas d'échec**). |
| **Execution timeout** | 30 secondes | Combien de temps l'agent laisse tourner le script avant de le terminer. Configurable par étape. (Bash reçoit `SIGKILL` ; l'isolate JavaScript est démantelé.) |

La fenêtre d'attente totale du Worker est `claim timeout + execution timeout + quelques secondes de marge`. Choisissez des valeurs qui correspondent à l'étape.

### Lease et heartbeat

Quand un agent réclame un job, il reçoit un lease court (30 secondes par défaut). Pendant que le script tourne, l'agent renouvelle le lease toutes les 10 secondes. Si l'agent meurt ou perd le réseau au milieu du script, le lease expire et le Worker marque le job `TimedOut` au lieu d'attendre indéfiniment.

Les processus fils Bash ne sont **pas** annulés automatiquement quand le lease expire (un isolate JavaScript est également laissé à terminer s'il le fait jamais) — mais le Worker arrête d'attendre, et l'agent ne pourra plus soumettre de résultat une fois qu'un autre claim a pris la relève. Concevez les scripts comme rejouables si vous tenez à du « exactly-once ».

### Aucun agent en ligne

Si aucun agent sain portant le tag de l'étape n'est en ligne au moment où elle s'exécute, le job reste `Pending` jusqu'à l'expiration du claim timeout, puis échoue avec un message clair (« no agent claimed the job »). La page Agents est l'endroit où vous confirmez votre couverture avant de lancer un runbook pour de vrai.

### Plafond de sortie

stdout + stderr combinés sont plafonnés à **50 Ko** par étape. Une sortie plus longue est tronquée avec un marqueur. S'il vous faut le log complet, écrivez-le vers S3 ou votre puits de logs depuis le script et `echo`ez l'URL.

### Annulation

Annuler une exécution de runbook (depuis la vue d'exécution ou l'API) marque immédiatement tous ses jobs Bash `Pending`/`Claimed`/`Running` comme `Cancelled`. Un agent déjà au milieu du script terminera son travail, mais son résultat ne sera pas accepté par le serveur.

### Concurrence

Chaque agent traite un job à la fois par défaut. Pour en autoriser plus, positionnez `RUNBOOK_AGENT_CONCURRENCY` sur le conteneur de l'agent — mais rappelez-vous que l'agent partage l'hôte avec tout ce qui y vit déjà.

## Variables d'environnement

L'agent les lit au démarrage :

| Variable | Requise | Défaut | Notes |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | oui | — | URL de base de votre instance OneUptime, par ex. `https://oneuptime.votre-domaine.com`. |
| `RUNBOOK_AGENT_ID` | oui | — | L'UUID affiché dans le modal de configuration de l'agent. |
| `RUNBOOK_AGENT_KEY` | oui | — | Le secret affiché dans le modal de configuration de l'agent. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | non | `5000` | Fréquence à laquelle l'agent demande de nouveaux jobs. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | non | `60000` | Fréquence à laquelle l'agent signale qu'il est vivant. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | non | `10000` | Fréquence à laquelle l'agent renouvelle le lease d'un job en cours. |
| `RUNBOOK_AGENT_CONCURRENCY` | non | `1` | Nombre maximum de jobs simultanés sur cet agent. |

## Faire tourner la clé d'un agent

Si une clé fuite, ouvrez l'agent dans OneUptime et réinitialisez sa clé. L'ancienne cesse immédiatement de fonctionner. Mettez à jour le conteneur de l'agent avec la nouvelle clé et redémarrez-le.

## Permissions

La gestion des agents vit sous le groupe de permissions Runbooks existant :

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gérer les enregistrements d'agents.
- `RunbookAdmin` (rôle) — regroupe tout ce qui précède.

Les permissions pour *déclencher* un runbook (et donc dispatcher des étapes Bash) restent `CreateRunbookExecution` / `EditRunbookExecution`.

## API exposée aux agents

Pour les curieux — l'agent utilise ces endpoints, montés sous `/runbook-agent-ingest`. Ils sont authentifiés par l'ID + la clé de l'agent dans le corps JSON (ou les en-têtes `x-agent-id` / `x-agent-key`).

| Endpoint | Rôle |
| --- | --- |
| `POST /heartbeat` | Vivacité ; met à jour `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`. |
| `POST /claim-next-job` | Réclame atomiquement le plus ancien job `Pending` dont le tag correspond à l'un des tags de cet agent. Retourne `{ job: null }` si rien à faire. |
| `POST /job/:jobId/heartbeat` | Renouvelle le lease du job. Retourne 404 dès que le lease a expiré ou que le job est terminal. |
| `POST /job/:jobId/result` | Soumet le résultat final. Ignoré si le lease est déjà passé à un autre. |

Vous ne devriez pas avoir à les appeler à la main — l'agent fourni le fait. Ils sont documentés ici pour le cas où vous voudriez construire votre propre agent parce que le nôtre ne vous convient pas.
