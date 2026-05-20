# Configuration et sécurité

Cette page rassemble les paramètres et les limites de sécurité qu'il vaut la peine de connaître avant de pointer un workflow vers du trafic de production.

## Activer / désactiver

Chaque workflow a un drapeau **isEnabled** dans **Settings**. Les workflows désactivés ne se déclenchent jamais — les événements de modèle, les webhooks et les exécutions planifiées sont ignorés. Les nouveaux workflows sont livrés désactivés.

Traitez-le comme votre interrupteur « prêt pour la prod » :

1. Construisez le workflow.
2. Cliquez sur **Run Manually** avec une charge utile représentative.
3. Vérifiez **Logs** — confirmez que chaque nœud a pris le port que vous attendiez.
4. Activez **isEnabled**.

Désactiver un workflow n'affecte pas les exécutions déjà en cours ; cela empêche seulement de nouvelles d'être créées.

## Propriété et étiquettes

- **Owners** — les utilisateurs et équipes listés comme propriétaires reçoivent un accès basé sur les permissions et (optionnellement) des notifications lorsque le workflow échoue. Configurez sous **Settings → Owners**.
- **Labels** — étiquettes plusieurs-à-plusieurs pour organiser les workflows. Filtrez la liste des workflows par étiquette. Utile quand un projet a des dizaines de workflows organisés par équipe, par intégration ou par environnement.
- **Label rules** — sous **Workflows → Settings → Label Rules**, appliquez automatiquement des étiquettes aux nouveaux workflows en fonction de correspondances regex sur le nom ou la description.
- **Owner rules** — sous **Workflows → Settings → Owner Rules**, attribuez automatiquement des propriétaires aux nouveaux workflows.

## Secrets

Les variables globales peuvent être marquées comme **secret**. La valeur est chiffrée au repos, en écriture seule dans l'interface après l'enregistrement et masquée des journaux d'exécution (remplacée par `[REDACTED]`).

Utilisez des variables secrètes pour :

- Clés d'API pour les intégrations sortantes.
- Jetons Bearer.
- Clés de signature de webhook.
- Toute valeur qu'un attaquant avec accès en lecture à un workflow ne devrait pas voir.

Ne collez pas un secret directement dans l'argument d'un composant — les références comme `Authorization: Bearer eyJh...` apparaissent dans le JSON du workflow et dans les journaux d'exécution en clair. Référencez `{{variable.MY_SECRET}}` à la place.

## Timeout d'exécution

Chaque exécution a une durée maximale. Si une exécution n'a pas terminé dans le timeout, elle est marquée `Timeout` et tout composant en cours est annulé. La valeur par défaut est généreuse (minutes, pas secondes) — voir la configuration d'environnement du worker pour la valeur exacte dans votre installation.

La plupart des composants ont leurs propres timeouts par appel à l'intérieur du timeout d'exécution — par exemple, le composant API abandonnera une requête sortante bloquée bien avant que toute l'exécution ne le fasse.

## Limite de récursion

Le composant **Execute Workflow** laisse un workflow en appeler un autre. Pour empêcher les boucles incontrôlées où A appelle B qui appelle A indéfiniment, le worker suit la chaîne d'appels et arrête une chaîne qui dépasse une profondeur fixe (typiquement un petit nombre comme 5). L'exécution terminale est marquée `Error` avec un message clair sur la limite de récursion.

Si vous avez un besoin légitime pour une longue chaîne (par exemple, une marche récursive de dossiers qui traite un niveau par exécution), refactorisez-la en un seul workflow qui itère en interne via **Custom Code** — ce motif n'est pas soumis à la limite de chaîne.

## Sécurité des webhooks

Les déclencheurs webhook exposent une URL HTTPS unique. Quiconque apprend l'URL peut la frapper. Pour vous défendre contre les appelants accidentels ou hostiles :

- Traitez l'URL comme un secret partagé. Ne la collez pas dans un chat public ni ne la commitez dans un dépôt public.
- Pour les workflows à haute valeur, demandez au système appelant d'inclure un secret partagé en en-tête (par exemple, `X-Webhook-Token`) et validez-le dans un nœud **Conditions** avant de faire quoi que ce soit de destructif. Définissez le jeton attendu comme variable globale secrète.
- Pour les workflows à très haute valeur, préférez un déclencheur d'événement de modèle et une étape d'import manuelle au lieu d'un webhook public.

## Trafic réseau sortant

Les composants API et autres composants de style HTTP envoient des requêtes depuis le réseau du Workflow Worker OneUptime. Si vous auto-hébergez OneUptime, le réseau sortant du worker est de votre ressort — assurez-vous qu'il peut atteindre les API tierces que vous appelez. Si vous utilisez OneUptime Cloud, notre plage IP sortante est publiée dans [Adresses IP](/docs/configuration/ip-addresses) afin que vous puissiez la mettre sur liste blanche du côté récepteur.

## Permissions

Les workflows sont des ressources de première classe soumises au contrôle d'accès basé sur les rôles au niveau du projet :

- `CreateWorkflow`, `ReadWorkflow`, `EditWorkflow`, `DeleteWorkflow` — les quatre permissions CRUD sur les modèles de workflow.
- `RunWorkflow` — nécessaire pour cliquer sur **Run Manually** ou pour dispatcher un workflow via l'API.
- `ReadWorkflowLog` — nécessaire pour voir la page **Runs & Logs**.
- `ReadWorkflowVariable`, `CreateWorkflowVariable`, `EditWorkflowVariable`, `DeleteWorkflowVariable` — contrôle sur la liste des variables globales.

La plupart des ingénieurs devraient avoir create/edit/read sur les workflows mais pas sur les variables. Réservez l'accès en édition des variables aux personnes qui gèrent les secrets de votre projet.

## Quotas

OneUptime Cloud plafonne le nombre d'exécutions par mois par projet sur les plans plus petits. Le plafond est affiché sur **Project Settings → Billing**. Quand vous l'atteignez, les nouveaux déclencheurs sont rejetés (et enregistrés avec une raison « quota dépassé » sur le workflow concerné) jusqu'au prochain cycle de facturation. Les installations auto-hébergées ne sont pas soumises à un quota.

## Ce pour quoi les workflows ne sont *pas* bons

Quelques motifs pour lesquels vous devriez vous tourner vers un autre outil :

- **Calcul de longue durée** — les workflows sont orientés vers la glu entre systèmes, pas vers le traitement de gros ensembles de données. Exécutez le travail lourd dans votre propre infrastructure et utilisez un workflow pour le lancer.
- **Workflows à état qui s'étendent sur des minutes/heures** — une seule exécution est censée se terminer rapidement. Si vous avez besoin de « faire la chose A, puis attendre deux heures, puis faire la chose B », modélisez l'attente comme un planificateur externe qui poste de nouveau vers un déclencheur webhook.
- **Réponse aux incidents étape par étape avec des checkpoints humains** — c'est à cela que servent les [Runbooks](/docs/runbooks/index). Utilisez un workflow s'il n'y a pas d'humain dans la boucle ; utilisez un runbook s'il y en a.

## Où lire ensuite

- [Présentation des workflows](/docs/workflows/index) — la carte conceptuelle.
- [Composants](/docs/workflows/components) — détails des arguments pour chaque action.
- [Runbooks](/docs/runbooks/index) — quand utiliser un runbook à la place.
