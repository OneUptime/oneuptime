# Configuration & sécurité des runbooks

## Plafonds de sortie

- Sortie par étape : **50 Ko**. Toute sortie plus longue est tronquée avec un marqueur.
- Délai par défaut par étape : **30 secondes** pour JavaScript, Bash et HTTP. Configurable par étape.
- **Claim timeout** par défaut pour les étapes Bash et JavaScript : **2 minutes** — combien de temps le Worker attend qu'un Agent de Runbook prenne le job avant de le faire échouer.

## Permissions

Les permissions de runbook vivent dans le groupe de permissions `Runbook` :

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gérer les modèles de runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — démarrer, valider et lire les exécutions.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gérer les règles d'auto-déclenchement.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gérer les Agents de Runbook qui exécutent les étapes Bash dans votre propre infrastructure.
- `RunbookAdmin` (rôle) — regroupe tout ce qui précède ; à attribuer à une équipe pour lui donner toutes les capacités runbook.

## File & worker

Les exécutions de runbook tournent sur la file BullMQ `Runbook`. La concurrence du worker est de 25 — ajustez selon votre déploiement si vous avez beaucoup d'exécutions simultanées.

Quand une étape manuelle est validée via l'API, l'exécution est remise en file pour reprendre à l'étape suivante. Cela maintient le worker chaud pour la suite du runbook.

## Notes de durcissement

- Les **étapes Bash et JavaScript** ne tournent jamais sur le Worker OneUptime. Elles sont envoyées comme jobs à un [Agent de Runbook](/docs/runbooks/agents) que vous avez installé dans votre propre infrastructure. Le Worker met le job en file avec l'**Agent Tag** et le type d'étape, un agent le réclame atomiquement, l'exécute localement — Bash via `bash -c <script>`, JavaScript dans un bac à sable `isolated-vm` avec le préambule habituel (rompt les chaînes de prototypes, supprime `Function` et `eval`, gèle les prototypes natifs) — et renvoie le résultat. Le processus Worker lui-même n'exécute pas de scripts clients.
- Les **étapes HTTP** utilisent un validateur de statut permissif, donc une réponse 4xx ou 5xx est enregistrée comme étape échouée plutôt que levée. La sortie capturée reflète ainsi ce que la cible a réellement renvoyé.

## Tables de base de données

- `Runbook` — modèle (nom, slug, description, isEnabled, JSON des étapes).
- `RunbookExecution` — une ligne par exécution, avec des clés étrangères nullables `incidentId`, `alertId` et `scheduledMaintenanceId` et un tableau JSON `stepExecutions` qui prend en snapshot les étapes et l'état par étape.
- `RunbookRule` — règles d'auto-déclenchement avec discriminateur `triggerEntityType` (Incident, Alert, ScheduledMaintenance) et une relation many-to-many vers les runbooks à démarrer.
- `RunbookAgent` — une ligne par agent installé : nom, tags, clé secrète, `lastAlive`, `connectionStatus`, infos d'hôte.
- `RunbookAgentJob` — une ligne par étape Bash ou JavaScript envoyée : tag requis, type d'étape, script, statut (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), claim deadline, lease, sortie, code de sortie.

## Conseils opérationnels

- **Faites tourner au moins un agent par tag visé**, idéalement deux pour la haute disponibilité. Avec deux agents portant le même tag, l'un ou l'autre peut réclamer un job — vous pouvez faire des redémarrages glissants sans casser les runbooks.
- **Capturez des URL, pas des blobs.** Si une étape génère plus de quelques Ko, écrivez-les dans S3 ou votre pile de logs et retournez l'URL.
- **L'idempotence compte.** Les étapes automatisées (HTTP, JavaScript, Bash) peuvent tourner plusieurs fois si le worker redémarre en pleine étape ou si le lease d'un agent expire alors qu'un script tourne encore ; concevez-les pour qu'une nouvelle tentative soit sans risque.
