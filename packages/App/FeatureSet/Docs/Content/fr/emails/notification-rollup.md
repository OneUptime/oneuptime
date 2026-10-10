# Regroupement des notifications

Quand quelque chose tourne vraiment mal, cela arrive rarement une seule fois. Un lien amont instable fait tomber quarante moniteurs, quarante incidents sont déclarés, acquittés puis résolus, et chaque propriétaire reçoit un e-mail à chaque étape : deux cents messages dans une seule boîte, et plus personne ne les lit.

OneUptime regroupe automatiquement ces rafales en un seul e-mail. C'est activé pour tout le monde et il n'y a rien à configurer — mais si vous préférez recevoir chaque notification dans son propre e-mail, vous pouvez [désactiver le regroupement pour vous-même](#désactiver-le-regroupement-pour-vous-même), projet par projet.

:::cards
- [Fonctionnement](#fonctionnement): Quatre e-mails partent tout de suite, le reste arrive ensemble.
- [Ce qui n'est jamais regroupé](#ce-qui-nest-jamais-regroupé): Alertes d'astreinte, e-mails de sécurité, de facturation et aux abonnés.
- [Désactiver le regroupement](#désactiver-le-regroupement-pour-vous-même): Recevoir à nouveau chaque notification dans son propre e-mail.
- [Moins d'e-mails de routine](#réduire-encore): Couper les e-mails d'information en une seule fois.
:::

## Fonctionnement

Chaque e-mail de notification de propriétaire que vous recevez est décompté d'un petit budget, tenu par projet, par destinataire, par adresse e-mail et par **catégorie** de ressource — incidents, alertes, moniteurs, maintenances planifiées, pages de statut, sondes, SLO, etc.

```mermaid title="Comment un e-mail de notification de propriétaire est distribué"
flowchart TB
    N["E-mail de notification de propriétaire"] --> O{"Regroupement activé<br/>pour vous ?"}
    O -->|"Non"| S["Envoyé tout de suite"]
    O -->|"Oui"| C{"Cinquième ou plus dans cette<br/>catégorie en 30 minutes ?"}
    C -->|"Non"| S
    C -->|"Oui"| H["Retenu"]
    H -->|"Environ 5 minutes plus tard"| R["Un e-mail de regroupement<br/>pour le projet"]
```

- Les **quatre premiers** e-mails d'une catégorie dans une fenêtre de trente minutes sont envoyés immédiatement, exactement comme avant. Même objet, même modèle, mêmes liens.
- Le **cinquième et tous les suivants** dans cette fenêtre sont retenus.
- Environ cinq minutes plus tard, tout ce qui a été retenu pour vous dans ce projet — toutes catégories confondues — arrive en **un seul** e-mail qui liste ce qui s'est passé, avec un lien vers chaque ressource.

Le regroupement inclut les notifications auxquelles vous êtes encore abonné au moment de l'envoi. Si vous désactivez l'e-mail d'un événement pendant que ses notifications sont en file d'attente, ces notifications sont retirées du regroupement. Réactiver l'e-mail plus tard ne renvoie pas ces mises à jour ignorées.

Sous le seuil, la fonctionnalité ne fait rien du tout. Un projet qui produit trois e-mails de propriétaire par jour envoie toujours ces trois e-mails séparément.

## À quoi ressemble l'e-mail de regroupement

La ligne d'objet vous indique l'ampleur _et la nature_ de la tempête avant même que vous l'ouvriez :

```text
[Acme Production] 112 notifications: 63 Monitors, 41 Incidents, 6 Alerts +2 more
```

À l'intérieur, une carte de synthèse donne le total, la période couverte par le regroupement et la répartition par catégorie. En dessous, les notifications sont groupées en une section par catégorie, la plus urgente d'abord — incidents, puis alertes, puis les moniteurs et sondes qui les ont détectés — pour que la première chose sous la synthèse soit aussi la première qui mérite un clic.

Chaque section contient une ligne par ressource plutôt qu'une ligne par événement :

- **Les lignes montrent où une ressource en est arrivée.** Si un incident a été créé, puis acquitté, puis résolu, c'est une seule ligne dans son dernier état, ce qui rend le regroupement _plus_ à jour que ne l'auraient été trois e-mails séparés.
- **Les totaux concordent.** Chaque ligne porte l'heure de sa dernière mise à jour, et une ligne qui en a absorbé plusieurs indique combien, si bien que les sections et la carte de synthèse donnent toujours le même total.
- **La gravité et l'état sont affichés.** Les cartes d'alerte et d'incident affichent la gravité et l'état de leur dernière notification, noms personnalisés compris. Les anciennes notifications en file d'attente sans ces informations apparaissent quand même, sans les libellés manquants.

Les heures sont affichées en UTC, avec la date en plus dès qu'un regroupement couvre plus d'une journée.

![Un e-mail de regroupement contenant quinze notifications](/docs/static/images/NotificationRollupEmail.png)

## Ce qui n'est jamais regroupé

Le regroupement ne touche que les notifications de propriétaire et de membre — la famille « quelque chose dont vous êtes responsable a changé ». Il ne peut rien atteindre d'autre, car il se trouve dans le seul chemin de code que prennent ces notifications, et aucune autre.

Jamais retardé, et jamais décompté :

| Catégorie | Exemples |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Alertes d'astreinte | Chaque appel d'une politique d'escalade et chaque demande d'acquittement |
| Horaires d'astreinte | « Vous êtes d'astreinte maintenant », « vous êtes le prochain d'astreinte », « votre garde commence bientôt », « votre garde a été réattribuée » |
| Sécurité du compte | Réinitialisation du mot de passe, vérification de l'e-mail, mot de passe modifié, code de secours à deux facteurs utilisé ou régénéré |
| Avis administratifs sur votre compte | Un administrateur a modifié vos méthodes de notification ou vos règles d'astreinte |
| Facturation et solde | Factures, abonnement impayé, « nous n'avons pu alerter personne car la carte a été refusée » |
| Santé de l'instance | Avertissements Postgres, Valkey et ClickHouse envoyés aux administrateurs de l'instance |
| Abonnés des pages de statut | Chaque e-mail que votre page de statut envoie à vos propres abonnés |
| Violations de SLA | Envoyées immédiatement, même si elles réutilisent le type de notification « incident créé » |

Seul l'e-mail est concerné. Les SMS, appels téléphoniques, notifications push, WhatsApp, Telegram, Slack, Microsoft Teams et webhooks sont distribués immédiatement, exactement comme avant — y compris pour les notifications dont l'e-mail a été retenu.

## Limites

| Limite | Valeur |
| --- | --- |
| Notifications dans un e-mail de regroupement | Au plus **500**. Le surplus reste en file d'attente et part avec le regroupement suivant, au plus cinq minutes plus tard. |
| Lignes affichées dans un e-mail de regroupement | Au plus **100**. Les lignes sont regroupées par ressource, soit 100 ressources distinctes ; au-delà, l'e-mail indique les totaux complets et renvoie vers le projet. |
| E-mails de regroupement à un destinataire pour un projet | Au plus **12** par heure. |
| Délai ajouté à une notification retenue | Environ six minutes, au pire. |

Le plafond horaire est appliqué par la base de données, pas par un minuteur, il tient donc même pendant une tempête qui dure des heures.

## Désactiver le regroupement pour vous-même

Certains apprécient le regroupement. D'autres classent chaque notification à son arrivée, ou confient la boîte de réception à un outil qui le fait, et un e-mail de regroupement casse ce fonctionnement. Le regroupement peut donc être désactivé, par personne et par projet.

:::steps
### Ouvrir les préférences e-mail

Dans le projet, allez dans **Paramètres utilisateur → Préférences e-mail** — la page vers laquelle renvoie le bas de chaque e-mail de regroupement.

### Désactiver le récapitulatif par e-mail

Dans la carte **Récapitulatif par e-mail**, désactivez l'interrupteur. L'enregistrement est automatique, et la carte affiche alors « Désactivé : chaque notification arrive dans son propre e-mail, immédiatement. »
:::

Une fois désactivé, chaque e-mail de notification de propriétaire et de membre de ce projet vous est de nouveau envoyé séparément et immédiatement : même objet, même modèle, mêmes liens, sans seuil ni attente de cinq minutes. Ce qui était déjà en file d'attente pour vous au moment de la désactivation arrive encore en un dernier regroupement quelques minutes plus tard ; tout ce qui suit arrive un par un.

L'interrupteur est **à vous seul et limité à un projet**. Le désactiver ne change rien à ce que reçoivent vos collègues, et ne s'applique pas aux autres projets — ainsi, le projet de production bruyant peut continuer à regrouper pendant que le projet interne calme laisse tout passer, ou l'inverse. Il est activé pour tout le monde jusqu'à ce que chacun le désactive.

Ce qu'il ne touche **pas** :

- **Les notifications que vous recevez.** C'est le réglage par type d'événement et par canal sous **Paramètres utilisateur → Paramètres de notification**, sur la page voisine. Le regroupement et cet interrupteur ne changent que le nombre d'e-mails dans lesquels ces notifications sont réunies.
- **Les alertes d'astreinte et les e-mails de garde**, **les e-mails de sécurité du compte**, **les e-mails de facturation**, les avertissements de santé de l'instance et les e-mails aux abonnés des pages de statut. Rien de tout cela n'est jamais regroupé, donc désactiver le regroupement n'y change rien — voir [Ce qui n'est jamais regroupé](#ce-qui-nest-jamais-regroupé).
- **Tous les autres canaux.** Les SMS, appels, push, WhatsApp, Telegram, Slack, Microsoft Teams et webhooks sont déjà immédiats.

## Réduire encore

Le regroupement réunit les mises à jour de routine ; vous pouvez aussi ne plus recevoir la plupart d'entre elles.

:::steps
### Ouvrir les préférences depuis un e-mail de regroupement

Ouvrez le lien vers les préférences en bas d'un e-mail de regroupement, ou allez dans **Paramètres utilisateur → Préférences e-mail**.

### Choisir Reduce routine emails

Dans la carte **Moins d'e-mails de routine**, sélectionnez **Reduce routine emails**. Une fois la modification enregistrée, la carte indique **E-mails de routine désactivés.**
:::

Cela désactive pour vous, dans le projet en cours, ces e-mails d'information :

- Les notes publiées sur les incidents, alertes, épisodes et maintenances planifiées.
- Les avis vous indiquant que vous avez été ajouté comme propriétaire d'une ressource.
- Les nouveaux moniteurs et pages de statut.
- Les incidents ou alertes ajoutés à des épisodes existants.
- L'ajout à une politique d'astreinte ou le retrait de celle-ci.

Vos choix existants pour la création d'incidents et d'alertes, les changements d'état, les rappels, les affectations d'incidents, la santé des moniteurs et les gardes d'astreinte sont conservés, et aucun e-mail que vous aviez désactivé n'est réactivé. Les alertes d'astreinte, les autres canaux de distribution, les e-mails de compte, de facturation et aux abonnés des pages de statut ne sont pas concernés.

Les modifications sont enregistrées ensemble. Vérifiez les interrupteurs par événement sous **Paramètres utilisateur → Paramètres de notification** pour réactiver un e-mail en particulier. Ces préférences s'appliquent aussi aux notifications en attente d'un regroupement ; un e-mail déjà envoyé ne peut pas être rappelé. Le récapitulatif par e-mail reste un réglage distinct qui gère le regroupement des événements que vous conservez.

## Dépannage

:::details Un e-mail de notification est arrivé avec quelques minutes de retard
C'était le cinquième e-mail ou plus de sa catégorie en trente minutes : il a donc été retenu, puis envoyé dans un regroupement environ cinq minutes plus tard. Cherchez un e-mail de regroupement du même projet : la notification y figure sur une ligne. Les alertes d'astreinte et les autres canaux n'ont pas été retardés.
:::

:::details J'ai désactivé le regroupement et j'ai quand même reçu un e-mail de regroupement
Les notifications déjà en file d'attente pour vous au moment de la désactivation arrivent en un dernier regroupement quelques minutes plus tard. Tout ce qui suit arrive e-mail par e-mail.
:::

:::details Une mise à jour attendue manque dans un e-mail de regroupement
Chaque ligne montre une ressource dans son dernier état : un incident créé, acquitté puis résolu forme donc une seule ligne, avec le nombre de mises à jour qu'elle a absorbées. Une notification est aussi retirée si vous avez désactivé l'e-mail de cet événement sous **Paramètres utilisateur → Paramètres de notification** pendant qu'elle était en file d'attente.
:::

## Étapes suivantes

:::cards
- [Configuration SMTP](/docs/emails/smtp): Envoyer les e-mails de OneUptime par votre propre serveur de messagerie.
- [Règles d'escalade](/docs/on-call/escalation-rules): Comment les alertes d'astreinte atteignent les personnes, sans jamais être regroupées.
:::
