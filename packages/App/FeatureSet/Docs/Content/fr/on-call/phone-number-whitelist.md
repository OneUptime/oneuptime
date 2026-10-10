# Liste blanche de numéros

Sur OneUptime Cloud, les SMS et les appels d'astreinte proviennent des numéros ci-dessous. Ajoutez-les à la liste d'autorisation de votre téléphone pour qu'une alerte ne soit jamais bloquée, rendue silencieuse ou classée comme spam.

## Numéros de OneUptime Cloud

| Numéro | Pays |
| --- | --- |
| +13022917020 | États-Unis (US) |
| +447427817020 | Royaume-Uni (UK) |

## Autoriser les numéros sur votre téléphone

:::steps
1. Enregistrez les deux numéros dans les contacts de votre téléphone sous un seul contact, par exemple « OneUptime ».
2. Si vous utilisez Ne pas déranger, un mode Concentration ou un autre mode silencieux, autorisez les appels et les messages de ce contact.
3. Si une application de filtrage des appels ou du spam, ou la protection anti-spam de votre opérateur, est active, marquez aussi les deux numéros comme fiables à cet endroit.
:::

> [!TIP]
> Ajouter ou vérifier votre numéro de téléphone dans **Paramètres utilisateur** > **Méthodes de notification** vous envoie un code depuis ces numéros : c'est un moyen rapide de vérifier qu'ils passent.

## Quand les alertes viennent d'autres numéros

Vos alertes proviennent d'autres numéros que ceux ci-dessus lorsque :

- **Votre projet utilise son propre compte Twilio.** Lorsqu'un projet a une configuration Twilio définie par défaut pour le projet (**Paramètres du projet** > **Notifications** > **Paramètres de notification** > **Configuration Twilio**), les SMS et appels destinés aux membres du projet passent par ce compte, depuis ses numéros de téléphone. Mettez plutôt ces numéros en liste blanche.
- **Vous utilisez une installation auto-hébergée.** Les SMS et les appels proviennent des numéros Twilio configurés par votre administrateur : la configuration Twilio par défaut du projet, ou celle de toute l'installation sous **Admin Dashboard** > **Paramètres** > **Appel et SMS**. Demandez à votre administrateur quels numéros mettre en liste blanche.

## Étapes suivantes

:::cards
- [Règles d'escalade](/docs/on-call/escalation-rules): Comment chaque personne alertée par un niveau est jointe, et dans quel ordre.
- [Plannings d'astreinte](/docs/on-call/schedules): Décider qui est d'astreinte, et quand.
- [Intégration Twilio pour les SMS et la voix](/docs/self-hosted/twilio-integration): Utiliser votre propre compte et vos propres numéros Twilio sur une installation auto-hébergée.
:::
