# Configuration et sécurité

Cette page couvre les paramètres et les limites de sécurité qu'il convient de connaître avant de mettre un workflow en production.

## Activer ou désactiver un workflow

Chaque workflow possède un interrupteur **Enabled** dans **Settings**. Lorsqu'il est désactivé, le workflow ne s'exécute pas — les appels webhook, les heures planifiées et les événements OneUptime sont tous ignorés. Les nouveaux workflows démarrent désactivés.

Utilisez cet interrupteur comme votre porte « prêt à partir » :

1. Construisez le workflow.
2. Cliquez sur **Run Manually** avec une charge utile réaliste.
3. Vérifiez les **Logs** — assurez-vous que chaque bloc a pris le chemin attendu.
4. Activez **Enabled**.

Désactiver un workflow n'arrête pas les exécutions déjà en cours ; cela empêche simplement de nouvelles exécutions de démarrer.

## Propriétaires et étiquettes

- **Propriétaires** — les utilisateurs et équipes listés comme propriétaires ont accès au workflow et peuvent choisir de recevoir des notifications lorsqu'il échoue. Définissez-les sous **Settings → Owners**.
- **Étiquettes** — des balises pour regrouper les workflows. La liste des workflows vous permet de filtrer par étiquette, ce qui facilite grandement la navigation dans un projet chargé. Pratique lorsque vous avez des workflows organisés par équipe, par intégration ou par environnement.
- **Règles d'étiquettes** — sous **Workflows → Settings → Label Rules**, appliquez automatiquement des étiquettes aux nouveaux workflows en fonction de motifs dans le nom ou la description.
- **Règles de propriétaires** — sous **Workflows → Settings → Owner Rules**, attribuez automatiquement des propriétaires aux nouveaux workflows.

## Secrets

Marquez une variable globale comme **secret** si elle contient quelque chose de sensible. La valeur est chiffrée, masquée dans l'interface après enregistrement et masquée dans les journaux d'exécution (affichée comme `[REDACTED]`).

Utilisez des variables secrètes pour :

- Les clés d'API de services externes.
- Les jetons d'authentification.
- Les clés de signature de webhooks.
- Tout ce que vous ne voudriez pas voir par quelqu'un disposant d'un accès en lecture seule.

Ne collez pas un secret directement dans un bloc — des valeurs comme `Authorization: Bearer eyJh...` finiraient visibles dans le workflow et dans les journaux. Utilisez plutôt `{{variable.MY_SECRET}}`.

## Durée maximale d'une exécution

Chaque exécution a une durée maximale. Si une exécution n'est pas terminée à temps, elle est marquée **Timeout** et le bloc en cours est annulé. La valeur par défaut est généreuse — suffisante pour les appels HTTP habituels et les chaînes de blocs.

Les blocs individuels ont leurs propres limites de temps à l'intérieur de cette enveloppe — par exemple, un bloc API abandonne une requête sortante bloquée bien avant que l'exécution entière n'expire.

## Limite sur l'appel d'autres workflows

Le composant **Execute Workflow** permet à un workflow d'en appeler un autre. Pour éviter les boucles accidentelles où le workflow A appelle B qui rappelle A, il existe une limite sur la profondeur de la chaîne. Une exécution qui dépasse cette limite se termine par une erreur claire.

Si vous avez un véritable besoin d'une longue chaîne (comme une tâche qui traite un élément par exécution), il est généralement plus simple de faire la boucle à l'intérieur d'un seul workflow avec **Custom Code**.

## Sécurité des webhooks

Les déclencheurs webhook vous fournissent une URL unique. Toute personne qui connaît l'URL peut l'appeler. Pour vous protéger des appelants accidentels ou indésirables :

- Traitez l'URL comme un mot de passe. Ne la partagez pas publiquement et ne la versionnez pas dans un dépôt public.
- Pour les workflows sensibles, demandez au système appelant d'envoyer un jeton partagé dans un en-tête (comme `X-Webhook-Token`) et vérifiez-le avec un bloc **Conditions** avant de faire quoi que ce soit d'important. Enregistrez le jeton attendu comme variable secrète.
- Pour les workflows très sensibles, préférez un déclencheur d'événement OneUptime et une étape d'importation manuelle plutôt qu'un webhook public.

## Accès réseau sortant

Les blocs API et autres blocs HTTP effectuent leurs requêtes depuis OneUptime. Si vous hébergez OneUptime vous-même, assurez-vous que votre installation peut atteindre les services que vous appelez. Si vous utilisez OneUptime Cloud, nos plages d'IP sortantes sont listées dans [Adresses IP](/docs/configuration/ip-addresses) pour que vous puissiez les autoriser de l'autre côté.

## Permissions

Les workflows respectent le contrôle d'accès basé sur les rôles de votre projet. Les permissions pertinentes :

- **Create / Read / Edit / Delete Workflow** — les permissions de base sur le workflow lui-même.
- **Run Workflow** — nécessaire pour cliquer sur **Run Manually** ou déclencher un workflow via l'API.
- **Read Workflow Log** — nécessaire pour consulter les exécutions.
- **Read / Create / Edit / Delete Workflow Variable** — contrôle sur la liste des variables globales.

La plupart des ingénieurs devraient avoir create/edit/read sur les workflows mais pas sur les variables. Réservez l'accès en édition des variables aux personnes qui gèrent les secrets de votre projet.

## Limites de plan

OneUptime Cloud limite le nombre d'exécutions par mois sur les plans inférieurs. Votre limite actuelle est affichée sous **Project Settings → Billing**. Lorsque vous l'atteignez, les nouveaux déclencheurs sont rejetés jusqu'au cycle de facturation suivant. Les installations auto-hébergées n'ont pas cette limite.

## Quand les workflows ne sont pas le bon outil

Quelques cas où vous devriez vous tourner vers autre chose :

- **Calculs lourds ou grands ensembles de données** — les workflows sont conçus pour du travail de liaison léger, pas pour des calculs intensifs. Exécutez le travail lourd dans votre propre infrastructure et laissez un workflow le déclencher.
- **Processus longs qui s'étalent sur des heures** — une exécution unique est censée se terminer rapidement. Si vous avez besoin de « faire A, attendre deux heures, faire B », utilisez un planificateur externe qui renvoie un webhook à OneUptime au bon moment.
- **Réponse à incident pas à pas avec des humains dans la boucle** — c'est à cela que servent les [Runbooks](/docs/runbooks/index). Les workflows sont pour l'automatisation sans surveillance.

## Pour aller plus loin

- [Présentation des workflows](/docs/workflows/index) — la vue d'ensemble.
- [Composants](/docs/workflows/components) — référence bloc par bloc.
- [Runbooks](/docs/runbooks/index) — quand utiliser un runbook à la place.
