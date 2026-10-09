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
| OneUptime → relais par défaut | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | Push mobile sans `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | Push mobile direct avec `EXPO_ACCESS_TOKEN`. |
| OneUptime → service push du navigateur | Endpoint HTTPS de l’abonnement push | HTTPS / généralement TCP 443 | Web Push. |
| Application mobile ou navigateur → OneUptime | Votre nom d’hôte OneUptime | HTTPS / TCP 443 | Connexion, enregistrement de l’appareil et ouverture des liens. |

Si vous modifiez `PUSH_NOTIFICATION_RELAY_URL`, autorisez son nom d’hôte et son port configuré. Un relais personnalisé doit implémenter l’API de relais OneUptime. Les valeurs et le choix du mode figurent dans la [configuration](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) et le [service push OneUptime](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts) ; [Expo](https://docs.expo.dev/push-notifications/sending-notifications/) décrit l’endpoint direct. OneUptime lit les accusés de livraison auprès du relais à la même adresse, avec `/receipts` à la place de `/send`. Un relais sans cette route continue de livrer les push ; un appareil dont l'application a été supprimée n'est alors repéré que lorsqu'un push ultérieur vers lui est refusé.

Pour Web Push, autorisez les hôtes réels des endpoints des navigateurs utilisés. OneUptime accepte `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` et `push.apple.com`, avec leurs sous-domaines, notamment `updates.push.services.mozilla.com` et `web.push.apple.com`. L’[abonnement du navigateur](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) fournit la destination. Autoriser uniquement Expo ou le relais ne suffit pas pour Web Push.

Autorisez DNS et TLS sortant depuis le processus OneUptime qui envoie les notifications. Son magasin de certificats doit valider le certificat de destination ; les proxies doivent transmettre les requêtes API sans authentification interactive. Les fournisseurs push n’appellent aucun webhook sur OneUptime. Le serveur peut rester privé si les appareils y accèdent par VPN ou une autre connexion privée. Sans accès au relais ou aux services push externes, la livraison est impossible.

Les appareils ont leurs propres besoins réseau. iOS utilise APNs, généralement TCP 5223 avec TCP 443 en secours ; consultez les plages actuelles d’[Apple](https://support.apple.com/en-us/102266). Android utilise FCM sur TCP 5228–5230 et 443 ; consultez les hôtes et règles actuels de [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Ces ports ne doivent pas être ouverts en entrée sur OneUptime : le serveur utilise le relais ou Expo pour le push mobile, pas directement APNs/FCM.

Vérifiez DNS et HTTPS depuis le conteneur ou pod émetteur vers la destination du mode choisi. Envoyez ensuite un test depuis **User Settings > Notification Methods > Push** et confirmez sa réception sur un appareil enregistré. Testez chaque navigateur séparément pour Web Push. Consultez les erreurs du relais, d’Expo ou de web-push dans les journaux OneUptime ; une requête acceptée par l’API ne confirme pas la livraison à l’appareil. Pour les push mobiles, OneUptime lit aussi l'accusé de livraison d'Expo environ 15 minutes après chaque push : un push qui n'a jamais atteint l'appareil apparaît alors comme non livré dans le journal push et, pour une alerte d'astreinte, dans la chronologie d'astreinte.

## Dépannage

### Les notifications push n'arrivent pas

- Assurez-vous que l'application mobile a été compilée avec EAS Build (Expo Go ne prend pas en charge les notifications push)
- Vérifiez que le périphérique est enregistré dans la table `UserPush` de votre base de données
- Consultez les journaux du serveur OneUptime pour les erreurs de l'API Expo Push
- Confirmez que le périphérique dispose d'une connexion Internet active et que les permissions de notification sont activées
- Vérifiez **User Settings > Notification Methods > Push** : un appareil marqué **Ne reçoit pas de notifications** a cessé de les recevoir et doit être enregistré de nouveau (voir ci-dessous)

### Push marqués « non livrés »

Qu'Expo accepte un push ne signifie pas qu'il a atteint l'appareil : Apple ou Google peuvent encore le refuser. OneUptime lit l'accusé de livraison de chaque push mobile environ 15 minutes après l'envoi, via le relais push lorsque `EXPO_ACCESS_TOKEN` n'est pas défini. Lorsque l'accusé signale une erreur, le journal push et la chronologie d'astreinte de l'alerte passent de envoyé à **Push notification not delivered**, avec le code d'erreur d'Expo :

- `DeviceNotRegistered` : l'application mobile a été supprimée de l'appareil, ou son jeton push n'est plus valide. Voir la section suivante.
- `MessageRateExceeded` : trop de notifications ont été envoyées à l'appareil en peu de temps. Les push suivants vers lui sont envoyés normalement.
- `MessageTooBig` : la notification dépassait la taille acceptée par les services push. OneUptime raccourcit les notifications pour qu'elles tiennent, cela ne devrait donc pas arriver ; signalez-le si c'est le cas.
- `InvalidCredentials` ou `MismatchSenderId` : les identifiants push du projet Expo qui a envoyé le push ne sont pas valides. Avec `EXPO_ACCESS_TOKEN`, vérifiez les identifiants push de votre projet Expo ; avec le relais par défaut, contactez le support OneUptime.

Lorsqu'Expo refuse un push d'emblée, le journal push en indique la raison immédiatement. Via le relais push, c'est aussi le cas : le relais transmet le code d'erreur d'Expo au lieu de répondre par une erreur serveur.

### Erreurs « DeviceNotRegistered » dans les journaux

Expo signale `DeviceNotRegistered` lorsque l'application mobile a été supprimée de l'appareil ou que le jeton push de l'appareil n'est plus valide. Il le signale généralement dans l'accusé de livraison d'un push, que OneUptime lit environ 15 minutes après l'envoi, et refuse parfois le push d'emblée. Dans les deux cas, OneUptime cesse d'envoyer à cet appareil. Il est marqué comme ne recevant plus de notifications plutôt que supprimé, de sorte que ses règles de notification sont conservées, et le journal push ainsi que la chronologie d'astreinte de l'alerte qui n'est pas arrivée indiquent pourquoi. **User Settings > Notification Methods > Push** l'affiche comme **Ne reçoit pas de notifications**. Les autres appareils et méthodes de notification de son propriétaire continuent d'être alertés.

Pour rétablir l'appareil, ouvrez l'application mobile dessus en étant connecté. L'application s'enregistre de nouveau, ce qui renouvelle son jeton push auprès d'Expo, et l'appareil reçoit de nouveau les notifications avec ses règles. Si l'application a été supprimée, réinstallez-la et connectez-vous. L'accusé d'un push envoyé avant que l'application ne se réenregistre ne marque pas l'appareil. Lorsqu'une application mobile à jour est installée sur un nouveau téléphone à partir d'une sauvegarde de l'ancien, elle indique à OneUptime le jeton push qu'elle avait auparavant, et l'appareil de l'ancien téléphone passe au nouveau avec ses règles.

Via le relais push (sans `EXPO_ACCESS_TOKEN`), cela fonctionne de la même manière : le relais signale `DeviceNotRegistered` lorsqu'il envoie un push, et lit les accusés de livraison que votre instance lui demande.

## Support

Si vous rencontrez des problèmes avec les notifications push, veuillez :

1. Consulter la section de dépannage ci-dessus
2. Examiner les journaux de OneUptime pour les messages d'erreur détaillés
3. Nous contacter à [hello@oneuptime.com](mailto:hello@oneuptime.com)
