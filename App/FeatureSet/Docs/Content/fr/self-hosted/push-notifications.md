# Notifications push

Les notifications push natives (iOS/Android) sont alimentées par **Expo Push** et ne nécessitent **aucune configuration côté serveur** pour les instances auto-hébergées.

## Fonctionnement

L'application mobile OneUptime enregistre un jeton Expo Push auprès du backend. Lorsque le backend doit envoyer une notification, il envoie une requête POST à l'API publique Expo Push, qui achemine le message vers Apple APNs ou Google FCM au nom de l'application.

Les notifications push Web continuent d'utiliser les clés VAPID et le protocole Web Push.

## Configuration auto-hébergée

Aucune configuration de notification push n'est requise. Le binaire de l'application mobile gère automatiquement tout l'enregistrement de la plateforme via l'infrastructure push d'Expo.

## Dépannage

### Les notifications push n'arrivent pas

- Assurez-vous que l'application mobile a été compilée avec EAS Build (Expo Go ne prend pas en charge les notifications push)
- Vérifiez que le périphérique est enregistré dans la table `UserPush` de votre base de données
- Consultez les journaux du serveur OneUptime pour les erreurs de l'API Expo Push
- Confirmez que le périphérique dispose d'une connexion Internet active et que les permissions de notification sont activées

### Erreurs « DeviceNotRegistered » dans les journaux

Le jeton Expo Push n'est plus valide. Cela signifie généralement que l'application a été désinstallée ou que l'utilisateur a révoqué les permissions de notification. Le jeton sera nettoyé automatiquement.

## Support

Si vous rencontrez des problèmes avec les notifications push, veuillez :

1. Consulter la section de dépannage ci-dessus
2. Examiner les journaux de OneUptime pour les messages d'erreur détaillés
3. Nous contacter à [hello@oneuptime.com](mailto:hello@oneuptime.com)
