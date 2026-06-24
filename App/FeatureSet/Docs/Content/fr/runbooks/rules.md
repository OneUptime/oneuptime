# Règles de runbook

Les règles de runbook attachent automatiquement des runbooks lorsqu'un **incident**, une **alerte** ou un **événement de maintenance planifiée** est créé. Elles se gèrent depuis le menu Paramètres de chaque entité :

- Incidents → Paramètres → **Règles de runbook**
- Alertes → Paramètres → **Règles de runbook**
- Maintenance planifiée → Paramètres → **Règles de runbook**

Les trois pages éditent le même modèle de règle sous-jacent — elles sont simplement filtrées pour ne montrer que les règles du type d'entité concerné.

## Anatomie d'une règle

| Champ                    | Rôle                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Nom**                  | Libellé court et lisible. Affiché dans les journaux d'audit.                                            |
| **Description**          | Contexte facultatif pour les coéquipiers.                                                               |
| **Activée**              | Bouton pour suspendre une règle sans la supprimer.                                                      |
| **Motif de titre**       | Regex insensible à la casse comparée au titre de l'entité. Vide = tout titre correspond.                |
| **Motif de description** | Regex insensible à la casse comparée à la description de l'entité. Vide = toute description correspond. |
| **Runbooks à lancer**    | Un ou plusieurs runbooks à démarrer lorsque la règle se déclenche.                                      |

## Sémantique de correspondance

Une règle correspond quand **tous les critères spécifiés sont remplis**. Les critères vides sont ignorés :

- Une règle sans aucun motif s'applique à chaque événement de son type (règle « toujours exécuter » globale).
- Une règle avec uniquement un motif de titre se déclenche pour les événements dont le titre correspond.
- Plusieurs règles peuvent correspondre au même événement — chaque correspondance se déclenche, et l'union de leurs runbooks tourne (chaque runbook a sa propre exécution).

## Exemple : bascule DB pour les incidents de base de données

```
Nom :              Démarrer la bascule DB pour les incidents DB
Déclencheur :      Incident
Motif de titre :   (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks :         [Playbook de bascule DB, Notifier l'équipe DBA]
```

Cela crée deux exécutions de runbook chaque fois qu'un incident avec « db », « database », « postgres », etc. dans son titre est créé.

## Exemple : règle d'hygiène toujours-exécutée

```
Nom :                       Vérification pré-vol à chaque incident
Déclencheur :               Incident
Motif de titre :            (vide)
Motif de description :      (vide)
Runbooks :                  [Capturer l'état pré-incident]
```

Se déclenche pour chaque incident — utile pour capturer des snapshots de l'état système, des métriques de page, etc.

## Ce qui se passe quand une règle se déclenche

1. Le runbook est chargé.
2. Ses étapes sont **prises en snapshot** dans une nouvelle exécution.
3. L'exécution est mise en file sur le worker Runbook.
4. L'exécution est liée à l'entité source — elle apparaît sur la page de l'incident, de l'alerte ou de la maintenance, et dans la liste des exécutions du runbook.

Vous voyez toutes les exécutions déclenchées par règle dans **Runbooks → Exécutions**, filtrables par statut, runbook ou date.

## Runbooks désactivés

Si une règle référence un runbook avec `isEnabled = false`, la règle correspond toujours mais l'exécution est ignorée. Réactivez le runbook pour reprendre.

## Tester une règle

Avant de vous appuyer sur une règle en production, créez un incident (ou une alerte) de test dont le titre correspond au motif et vérifiez que les runbooks attendus se déclenchent. Les règles sont évaluées au moment de la création — modifier ensuite le titre d'un incident ne redéclenche pas les règles.
