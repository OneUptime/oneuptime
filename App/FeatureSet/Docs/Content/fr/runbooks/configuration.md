# Configuration & sécurité des runbooks

## Comment Bash et JavaScript s'exécutent réellement

Les étapes Bash et JavaScript **ne s'exécutent jamais sur le Worker OneUptime**. Elles sont envoyées comme jobs à un [Agent de runbook](/docs/runbooks/agents) spécifique — un petit processus que vous installez sur un hôte de votre propre infrastructure.

Le modèle de dispatch :

1. L'auteur de l'étape choisit un Agent de runbook dans le menu déroulant au moment de rédiger l'étape.
2. Quand l'étape s'exécute, le Worker insère une ligne dans `RunbookAgentJob` avec `targetAgentId` défini sur l'ID de cet agent et un statut `Pending`.
3. Cet agent spécifique (et seulement lui) réclame atomiquement le job, exécute le script localement — Bash via `bash -c <script>`, JavaScript dans un bac à sable `isolated-vm` — et renvoie le résultat.
4. Le Worker reprend le runbook avec le résultat.

Il n'y a plus de drapeau d'environnement `RUNBOOK_BASH_ENABLED`. Que les étapes Bash ou JavaScript fonctionnent dans un déploiement dépend entièrement de la présence d'au moins un Agent de runbook connecté dans le projet.

## Plafonds de sortie et timeouts

- Sortie par étape : **50&nbsp;KB**. Toute sortie plus longue est tronquée avec un marqueur.
- Execution timeout par défaut par étape : **30 secondes** pour JavaScript, Bash et HTTP. Configurable par étape.
- **Claim timeout** par étape pour les étapes Bash et JavaScript : **2 minutes** — combien de temps le Worker attend que l'agent sélectionné récupère le job avant de le faire échouer.

## Permissions

Les permissions de runbook vivent dans le groupe de permissions `Runbook` :

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gérer les modèles de runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — démarrer, valider et lire les exécutions.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gérer les règles d'auto-déclenchement.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gérer les Agents de runbook qui exécutent les étapes Bash et JavaScript dans votre propre infrastructure.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (rôles) — à attribuer à une équipe pour accorder respectivement le contrôle total, l'usage quotidien ou un accès en lecture seule. `RunbookAdmin` regroupe toutes les permissions granulaires ci-dessus.

## File & worker

Les exécutions de runbook tournent sur la file BullMQ `Runbook`. La concurrence du worker est de 25 — ajustez selon votre déploiement si vous avez beaucoup d'exécutions simultanées.

Quand une étape manuelle est validée via l'API, l'exécution est remise en file pour reprendre à l'étape suivante. Cela maintient le worker chaud pour la suite du runbook.

## Notes de durcissement

- **JavaScript et Bash** tournent sur un hôte d'Agent de runbook que vous contrôlez, pas sur le Worker OneUptime. JavaScript est encapsulé dans un bac à sable `isolated-vm` avec le préambule habituel (rompt les chaînes de prototypes, supprime `Function`/`eval`, gèle les prototypes natifs). Bash tourne via `bash -c` avec application du timeout sur l'agent.
- Les **étapes HTTP** utilisent un validateur de statut permissif, donc une réponse 4xx ou 5xx est enregistrée comme étape échouée plutôt que levée. La sortie capturée reflète ainsi ce que la cible a réellement renvoyé.
- **L'authentification d'agent** se fait par ID + clé secrète, posés sur le conteneur de l'agent comme variables d'environnement. Côté serveur, l'identité faisant foi de l'agent vient de la ligne en base indexée par l'ID/clé présenté — les clients ne peuvent pas se faire passer pour un autre agent, même avec une clé compromise.

## Tables de base de données

- `Runbook` — modèle (nom, slug, description, isEnabled, JSON des étapes).
- `RunbookExecution` — une ligne par exécution, avec des clés étrangères nullables `incidentId`, `alertId` et `scheduledMaintenanceId` et un tableau JSON `stepExecutions` qui prend en snapshot les étapes et l'état par étape.
- `RunbookRule` — règles d'auto-déclenchement avec discriminateur `triggerEntityType` (Incident, Alert, ScheduledMaintenance) et une relation many-to-many vers les runbooks à démarrer.
- `RunbookAgent` — une ligne par agent installé : nom, clé secrète, `lastAlive`, `connectionStatus`, infos d'hôte.
- `RunbookAgentJob` — une ligne par étape Bash ou JavaScript envoyée : `targetAgentId` (l'agent que l'auteur de l'étape a choisi), type d'étape, script, statut (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), claim deadline, lease, sortie, code de sortie.

## Conseils opérationnels

- **Assurez-vous que l'agent que vous sélectionnez sur une étape est en bonne santé.** Si vous avez besoin de redondance, lancez un second agent et répartissez vos étapes entre eux, ou gardez un runbook de secours qui cible l'autre agent.
- **Capturez des URL, pas des blobs.** Si une étape génère plus de quelques Ko, écrivez-les dans S3 ou votre pile de logs et retournez l'URL.
- **L'idempotence compte.** Les étapes automatisées (HTTP, JavaScript, Bash) peuvent tourner plusieurs fois si le worker redémarre en pleine étape ou si le lease d'un agent expire alors qu'un script tourne encore ; concevez-les pour qu'une nouvelle tentative soit sans risque.
