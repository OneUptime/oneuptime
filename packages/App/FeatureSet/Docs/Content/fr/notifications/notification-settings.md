# Paramètres de notification

Les paramètres de notification décident quelles nouvelles vous parviennent sur les éléments dont vous êtes propriétaire, comme un incident, un moniteur ou une page de statut, et sur vos propres permanences d'astreinte, et par quels canaux. Ils ne vous alertent jamais : alerter est le rôle de vos règles d'astreinte. Vous les réglez dans **Paramètres utilisateur → Paramètres de notification**, avec un interrupteur par événement et par canal.

:::cards
- [Fonctionnement des paramètres](#fonctionnement-des-paramètres): Un interrupteur par événement et par canal, envoyé à chaque méthode vérifiée.
- [Changer un paramètre](#changer-un-paramètre): Trois clics, enregistrés aussitôt.
- [Ce qui est activé pour un nouveau membre](#ce-qui-est-activé-pour-un-nouveau-membre): Les valeurs par défaut, onglet par onglet.
- [Moins d'e-mails](#moins-de-mails): Regrouper les rafales, ou laisser tomber les e-mails de routine.
:::

## Fonctionnement des paramètres

```mermaid title="Une nouvelle sur un élément qui vous appartient, et où elle va"
flowchart TB
    event["Une nouvelle, comme<br/>une note sur votre<br/>incident"] --> setting["Votre paramètre<br/>pour cet événement"]
    setting -->|"e-mail activé"| emails["Chaque adresse<br/>e-mail vérifiée"]
    setting -->|"tout désactivé"| nothing["Rien n'est envoyé"]
```

- Chaque ligne est un événement, et chaque colonne un canal : E-mail, SMS, Appel, Push, WhatsApp, Telegram, Slack et Microsoft Teams, et Webhook. Slack et Microsoft Teams ne sont des colonnes que si le projet les a connectés.
- Un canal activé envoie à chaque méthode vérifiée que vous avez dessus dans ce projet, pas à une seule.
- Un canal activé sans méthode vérifiée derrière lui n'envoie rien. **Your setup checklist** le signale sous **Staying informed**.
- Une nouvelle va aux propriétaires de l'élément : les personnes nommées comme propriétaires, et les membres de ses équipes propriétaires. Quand un élément n'a pas de propriétaire, elle va plutôt aux propriétaires du projet. Un événement indiquant que vous avez été ajouté comme propriétaire ne va qu'à la personne ajoutée.
- Les dossiers de sécurité n'ont pas de propriétaire. Un nouveau dossier va à toutes les personnes qui peuvent voir les dossiers du projet, à partir de la priorité que chacune choisit, et un dossier attribué aux personnes à qui il est attribué. Voir [Dossiers de sécurité](/docs/telemetry/security-cases#notifications).
- Chaque e-mail aux propriétaires se termine par un lien "Manage notification preferences" qui ramène à cette page.

## Changer un paramètre

:::steps
### Ouvrir vos paramètres

Allez dans **Paramètres utilisateur → Paramètres de notification**. Les onglets sont **Incidents**, **Alertes**, **Surveillance**, **Pages de statut**, **Maintenance planifiée**, **Astreinte** et **Sécurité**.

### Trouver l'événement

Chaque onglet contient une ou plusieurs cartes, comme **Épisodes d'incident** dans l'onglet **Incidents**. Chaque ligne est un événement, avec une phrase qui dit quand il est envoyé.

### Cliquer sur un canal

Cliquez sur le cercle d'un canal pour l'activer, et de nouveau pour le désactiver. Une coche signifie activé. Les changements sont enregistrés automatiquement.
:::

## Ce qui est activé pour un nouveau membre

Quand vous rejoignez un projet, ces événements sont activés, par e-mail. Tout le reste démarre désactivé, et n'envoie rien tant que vous n'activez pas un canal.

| Onglet | Activés par e-mail | Désactivés tant que vous ne les activez pas |
| --- | --- | --- |
| **Incidents** | **Incident créé**, **État de l'incident modifié**, **Rappel d'incident**, **SLA d'incident non respecté**, **Épisode d'incident créé**, **État de l'épisode d'incident modifié**, **Incident ajouté à l'épisode d'incident** | **Note d'incident publiée**, **Ajouté comme propriétaire de l'incident**, **Affecté à un incident**, **Note d'épisode d'incident publiée**, **Ajouté comme propriétaire de l'épisode d'incident** |
| **Alertes** | **Alerte créée**, **État de l'alerte modifié**, **Rappel d'alerte**, **Épisode d'alerte créé**, **État de l'épisode d'alerte modifié**, **Alerte ajoutée à l'épisode d'alerte** | **Note d'alerte publiée**, **Ajouté comme propriétaire de l'alerte**, **Note d'épisode d'alerte publiée**, **Ajouté comme propriétaire de l'épisode d'alerte** |
| **Surveillance** | **Statut de la sonde modifié pour votre moniteur**, **Le moniteur n'a aucune sonde active**, **SLO status changed**, **Ajouté comme propriétaire du SLO**, **Exception qui m'est attribuée**, **Statut de la sonde modifié**, **Ajouté comme propriétaire de la sonde** | **Moniteur créé**, **Statut du moniteur modifié**, **Ajouté comme propriétaire du moniteur**, **Statut de l'agent IA modifié**, **Ajouté comme propriétaire de l'agent IA** |
| **Pages de statut** | Aucun | **Page de statut créée**, **Annonce de page de statut publiée**, **Ajouté comme propriétaire de la page de statut** |
| **Maintenance planifiée** | **Rappel de maintenance** | **Événement de maintenance créé**, **État de la maintenance modifié**, **Note de maintenance publiée**, **Ajouté comme propriétaire de la maintenance** |
| **Astreinte** | **Vous prenez l'astreinte**, **Vous êtes le prochain d'astreinte**, **Vous quittez l'astreinte**, **Ajouté à la politique d'astreinte**, **Retiré de la politique d'astreinte**, **Appel manqué**, et aussi par push : **Avant le début de ma permanence d'astreinte**, **Ma prochaine permanence d'astreinte est réattribuée** | Aucun |
| **Sécurité** | Aussi par push : **Nouveau dossier de sécurité** (dossiers de priorité Élevé et Critique), **Dossier de sécurité qui m'est attribué**, **Étape de playbook en attente de mon approbation**, **Objectif de réponse d'un dossier de sécurité**, **Tâche d'un dossier de sécurité qui m'est attribuée**, **Une chasse a trouvé des événements de sécurité** | Aucun |

> [!IMPORTANT]
> **Statut du moniteur modifié** démarre désactivé. Pour savoir quand un moniteur dont vous êtes propriétaire tombe ou revient, activez-le dans l'onglet **Surveillance**.

## Vos permanences

L'onglet **Astreinte** parle de vous, pas des éléments dont vous êtes propriétaire :

- **Vous prenez l'astreinte**, **Vous êtes le prochain d'astreinte** et **Vous quittez l'astreinte** suivent vos tours dans les plannings d'astreinte dont vous faites partie.
- **Ajouté à la politique d'astreinte** et **Retiré de la politique d'astreinte** vous disent quand une politique d'astreinte commence ou cesse de vous nommer.
- **Avant le début de ma permanence d'astreinte** envoie des rappels aux moments que vous choisissez dans **Paramètres utilisateur → Calendrier → Flux de calendrier**, et **Ma prochaine permanence d'astreinte est réattribuée** vous dit quand quelqu'un d'autre couvre une permanence dont vous aviez reçu un rappel. Voir [Flux de calendrier](/docs/on-call/calendar-feeds#rappels-et-avis-de-réaffectation).
- **Appel manqué**, dans la carte **Politiques d'appels entrants**, dit aux propriétaires d'une politique d'appels entrants qu'un appelant n'a joint personne. Voir [Politique d'appels entrants](/docs/on-call/incoming-call-policy#appels-manqués).

## Dossiers de sécurité

L'onglet **Sécurité** parle des dossiers de sécurité que vous pouvez voir :

- **Nouveau dossier de sécurité** a une priorité sous son nom : la priorité minimale des dossiers qui vous sont notifiés. Elle vaut **Élevé et au-dessus**, sauf si vous choisissez **Critique uniquement**, **Moyen et au-dessus**, **Faible et au-dessus** ou **Tous les dossiers**.
- **Dossier de sécurité qui m'est attribué** suit les dossiers qui vous sont attribués, à vous ou aux équipes dont vous faites partie.
- **Étape de playbook en attente de mon approbation** vous demande d'approuver ou de rejeter une étape de playbook sur un dossier où vous pouvez donner votre approbation.

Voir [Dossiers de sécurité](/docs/telemetry/security-cases#notifications).

## Moins d'e-mails

Ces interrupteurs décident quelles nouvelles vous parviennent, pas combien d'e-mails elles représentent. **Paramètres utilisateur → Préférences e-mail** a deux cartes pour cela, toutes deux pour vous seul, dans ce projet :

- **Récapitulatif par e-mail** regroupe une rafale de nouvelles en un seul e-mail : les premières arrivent toujours une par une, et le reste ensemble quelques minutes plus tard.
- **Moins d'e-mails de routine** désactive, avec **Reduce routine emails**, les e-mails sur les notes, les nouveaux propriétaires, les nouveaux moniteurs et pages de statut, les ajouts aux épisodes et les changements de politique d'astreinte.

Voir [Regroupement des notifications](/docs/emails/notification-rollup).

## Dépannage

:::details Un interrupteur est activé, mais rien n'arrive
Vérifiez que vous avez une méthode vérifiée sur ce canal dans **Paramètres utilisateur → Méthodes de notification**. Pour les SMS, les appels, WhatsApp et Telegram, le projet doit aussi avoir activé le canal.
:::

:::details Je suis propriétaire d'un moniteur, mais je ne sais jamais quand il tombe
**Statut du moniteur modifié** démarre désactivé. Activez-y un canal, dans l'onglet **Surveillance**.
:::

:::details Je reçois encore des e-mails après avoir tout désactivé
Les alertes suivent vos règles d'astreinte, pas ces interrupteurs, et les e-mails de connexion, de sécurité et de facturation ne sont pas des nouvelles sur des éléments. Chaque projet a ses propres paramètres, vérifiez donc le projet d'où vient l'e-mail. Voir [Règles d'astreinte personnelles](/docs/notifications/on-call-rules).
:::

## Étapes suivantes

:::cards
- [Méthodes de notification](/docs/notifications/notification-methods): Ajoutez les méthodes auxquelles vos paramètres envoient.
- [Règles d'astreinte personnelles](/docs/notifications/on-call-rules): Décidez comment une alerte vous parvient.
- [Regroupement des notifications](/docs/emails/notification-rollup): Moins d'e-mails, mais plus complets, pendant une rafale.
- [Comment OneUptime vous joint](/docs/notifications/index): Comment les méthodes, les règles et les paramètres s'articulent.
:::
