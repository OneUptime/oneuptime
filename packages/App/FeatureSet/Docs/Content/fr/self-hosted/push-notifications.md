# Notifications push

Les notifications push natives (iOS/Android) utilisent **Expo Push**. Les instances auto-hébergées utilisent par défaut le relais OneUptime et doivent pouvoir le joindre en sortie.

## Fonctionnement

L’application mobile OneUptime enregistre un Expo Push Token auprès du backend. Celui-ci envoie les notifications via le relais OneUptime, ou directement à Expo si `EXPO_ACCESS_TOKEN` est configuré. Expo les transmet à Apple APNs ou Google FCM pour livraison à l’appareil.

Les notifications push Web continuent d'utiliser les clés VAPID et le protocole Web Push.

## Configuration auto-hébergée

Aucun identifiant Expo n’est nécessaire sur le serveur avec l’application mobile officielle et le relais par défaut. Pour un envoi direct, configurez `EXPO_ACCESS_TOKEN` avec les identifiants du projet Expo de votre application. Web Push nécessite `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT`.

## Accès réseau

| Sens | Destination | Protocole / port | Nécessaire pour |
| --- | --- | --- | --- |
| OneUptime → relais par défaut | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | Push mobile sans `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | Push mobile direct avec `EXPO_ACCESS_TOKEN`. |
| OneUptime → service push du navigateur | Endpoint HTTPS de l’abonnement push | HTTPS / généralement TCP 443 | Web Push. |
| Application mobile ou navigateur → OneUptime | Votre nom d’hôte OneUptime | HTTPS / TCP 443 | Connexion, enregistrement de l’appareil et ouverture des liens. |

Si vous modifiez `PUSH_NOTIFICATION_RELAY_URL`, autorisez son nom d’hôte et son port configuré. Un relais personnalisé doit implémenter l’API de relais OneUptime. Les valeurs et le choix du mode figurent dans la [configuration](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) et le [service push OneUptime](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts) ; [Expo](https://docs.expo.dev/push-notifications/sending-notifications/) décrit l’endpoint direct.

Pour Web Push, autorisez les hôtes réels des endpoints des navigateurs utilisés. OneUptime accepte `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` et `push.apple.com`, avec leurs sous-domaines, notamment `updates.push.services.mozilla.com` et `web.push.apple.com`. L’[abonnement du navigateur](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) fournit la destination. Autoriser uniquement Expo ou le relais ne suffit pas pour Web Push.

Autorisez DNS et TLS sortant depuis le processus OneUptime qui envoie les notifications. Son magasin de certificats doit valider le certificat de destination ; les proxies doivent transmettre les requêtes API sans authentification interactive. Les fournisseurs push n’appellent aucun webhook sur OneUptime. Le serveur peut rester privé si les appareils y accèdent par VPN ou une autre connexion privée. Sans accès au relais ou aux services push externes, la livraison est impossible.

Les appareils ont leurs propres besoins réseau. iOS utilise APNs, généralement TCP 5223 avec TCP 443 en secours ; consultez les plages actuelles d’[Apple](https://support.apple.com/en-us/102266). Android utilise FCM sur TCP 5228–5230 et 443 ; consultez les hôtes et règles actuels de [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Ces ports ne doivent pas être ouverts en entrée sur OneUptime : le serveur utilise le relais ou Expo pour le push mobile, pas directement APNs/FCM.

Vérifiez DNS et HTTPS depuis le conteneur ou pod émetteur vers la destination du mode choisi. Envoyez ensuite un test depuis **User Settings > Notification Methods > Push** et confirmez sa réception sur un appareil enregistré. Testez chaque navigateur séparément pour Web Push. Consultez les erreurs du relais, d’Expo ou de web-push dans les journaux OneUptime ; une requête acceptée par l’API ne confirme pas la livraison à l’appareil.

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
