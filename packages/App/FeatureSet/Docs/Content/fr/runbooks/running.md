# Exécuter un runbook

Il existe trois façons de créer une exécution de runbook :

1. **Automatiquement via une règle** — voir [Règles de runbook](/docs/runbooks/rules).
2. **Manuellement depuis la page du runbook** — cliquez sur **Exécuter maintenant** depuis la vue d'ensemble d'un runbook. Non rattaché à un incident, une alerte ou une maintenance.
3. **Manuellement depuis le flux d'une entité** — cliquez sur **Exécuter le Runbook** sur un incident, une alerte ou une maintenance planifiée. L'exécution est rattachée à cette entité.

## La vue d'exécution

Ouvrez n'importe quelle exécution pour voir sa liste de contrôle. Chaque étape affiche :

- **Pastille de statut** — En attente, En cours, En attente de vous, Terminée, Sautée, Échouée.
- **Titre et description** — copiés depuis le runbook au moment de l'exécution.
- **Sortie** (repliable) — stdout, valeurs de retour, réponses HTTP.
- **Message d'erreur** si l'étape a échoué.
- Sur l'étape où l'exécution attend : **Marquer comme terminé** (une étape manuelle) ou **Approuver et continuer** (une étape avec **Exiger une approbation**), et **Ignorer**.
- Tant que l'exécution est en pause, **Ignorer** sur les étapes automatisées suivantes qui n'exigent pas d'approbation.

Tant que l'exécution n'est pas terminale, la page rafraîchit toutes les 3 secondes ; vous voyez donc les étapes automatisées s'achever quasiment en temps réel.

## Terminer, approuver et ignorer des étapes

Seule l'étape où l'exécution attend peut être marquée comme terminée, approuvée ou ignorée pour poursuivre l'exécution. Une étape manuelle ou une étape avec **Exiger une approbation** ne peut être ni validée ni ignorée avant que l'exécution ne l'atteigne — son rôle est d'arrêter l'exécution, elle n'accepte donc une décision qu'une fois l'exécution arrivée jusqu'à elle (pour une approbation, une fois que l'étape s'est exécutée et que vous pouvez voir sa sortie).

Tant que l'exécution est en pause, vous pouvez aussi ignorer une étape automatisée suivante qui n'exige pas d'approbation, pour qu'elle ne s'exécute pas quand l'exécution reprendra. L'exécution reste en pause sur l'étape qui vous attend. Il n'est pas possible d'ignorer une étape pendant que des étapes s'exécutent — attendez que l'exécution se mette en pause, ou annulez-la. Chaque étape enregistre qui l'a terminée ou ignorée.

## Alterner étapes manuelles et automatisées

Le flux classique :

1. **Étape de script** : capturer l'état système, écrire dans S3.
2. **Étape manuelle** : « Notifier les clients via la bannière de la page de statut. » Le répondeur valide.
3. **Étape HTTP** : alerter le DBA via PagerDuty.
4. **Étape manuelle** : « Confirmer que la DB secondaire est devenue primaire. » Le répondeur valide.
5. **Étape de script** : envoyer le message « tout est rétabli » dans Slack.

Les étapes 2 et 4 mettent l'exécution en pause jusqu'à validation. Les étapes 1, 3, 5 s'exécutent automatiquement. L'ensemble du déroulé est une seule exécution, une seule timeline, une seule source de vérité.

## Annuler une exécution

Cliquez sur **Annuler l'exécution** depuis la page. L'étape courante (s'il y en a) se termine ; les suivantes ne démarrent pas. Le statut passe à `Cancelled`.

## Conservation des sorties

La sortie par étape est plafonnée à **50 Ko** pour empêcher des scripts emballés de gonfler la base. Si vous avez besoin d'artefacts plus volumineux, écrivez-les depuis le script dans S3 ou un logger et stockez l'URL dans la valeur de retour.

## Relancer un runbook

Une exécution de runbook est un enregistrement unique et immuable. Pour relancer, recliquez sur **Exécuter maintenant** — cela crée une nouvelle exécution avec un snapshot frais des étapes actuelles du runbook. L'exécution d'origine reste intacte pour la piste d'audit.

## Retrouver les exécutions passées

Chaque runbook a un onglet **Exécutions** listant tous ses passages, avec des filtres par statut, plage de dates et entité source. Sur un incident, une alerte ou une maintenance, l'onglet **Runbooks** affiche les exécutions rattachées à cette entité.
