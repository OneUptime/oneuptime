# Guide d'installation iOS

Installez l'application iOS native **OneUptime On-Call** depuis l'Apple App Store sur votre iPhone ou iPad.

## Prérequis

- iPhone ou iPad exécutant **iOS 15.0 ou une version ultérieure**
- Un compte OneUptime actif (ou l'URL de votre instance OneUptime auto-hébergée)
- Une connexion Internet pour la connexion et la réception des notifications push

## Installer depuis l'App Store

1. **Ouvrez l'App Store** sur votre iPhone ou iPad.
2. Appuyez sur l'onglet **Rechercher** et recherchez **« OneUptime On-Call »**, ou ouvrez ce lien sur votre appareil :
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. Appuyez sur **Obtenir**, puis authentifiez-vous avec Face ID, Touch ID ou votre mot de passe Apple ID.
4. Une fois l'installation terminée, appuyez sur **Ouvrir** ou lancez **OneUptime On-Call** depuis votre écran d'accueil.

## Premier lancement et connexion

1. **URL du serveur**
   - Si vous utilisez OneUptime Cloud, laissez la valeur par défaut `https://oneuptime.com`.
   - Si vous auto-hébergez, saisissez l'URL de votre instance OneUptime (par exemple `https://oneuptime.example.com`).
   - L'application vérifie que le serveur est joignable avant de continuer.
2. **Connexion**
   - Saisissez l'adresse e-mail et le mot de passe de votre compte OneUptime.
   - Vous pouvez éventuellement activer **Face ID** ou **Touch ID** pour des déverrouillages plus rapides lors des lancements suivants.
3. **Autoriser les notifications**
   - Lorsque vous y êtes invité, appuyez sur **Autoriser** afin que l'application puisse délivrer les notifications d'astreinte, les alertes d'incident et les acquittements.

## Notifications push

Les notifications push sont délivrées via le service Apple Push Notification (APNs) à travers Expo Push. Pour vous assurer que les notifications d'astreinte vous parviennent de manière fiable :

1. Allez dans **Réglages → Notifications → OneUptime On-Call**.
2. Activez **Autoriser les notifications**, **Sons**, **Pastilles** et la diffusion sur **Écran verrouillé / Bannières / Centre de notifications**.
3. Réglez le **Regroupement des notifications** sur **Automatique**.
4. Si vous êtes d'astreinte, désactivez le **Mode économie d'énergie** pendant votre garde et évitez de forcer la fermeture de l'application — iOS peut retarder la diffusion en arrière-plan si l'application est forcée à se fermer.
5. Ajoutez **OneUptime On-Call** à tous les modes **Concentration** dans lesquels vous souhaitez continuer à recevoir les notifications d'astreinte.

## Mises à jour

L'application est mise à jour via l'App Store :

- Ouvrez l'**App Store**, appuyez sur votre photo de profil, faites défiler jusqu'à **OneUptime On-Call** et appuyez sur **Mettre à jour**.
- Ou activez **Réglages → App Store → Mises à jour des apps** pour installer les mises à jour automatiquement.

## Désinstaller

1. **Appuyez longuement** sur l'icône **OneUptime On-Call** de votre écran d'accueil.
2. Appuyez sur **Supprimer l'app → Supprimer l'app**.
3. Confirmez en appuyant sur **Supprimer**.

Votre compte OneUptime et vos plannings d'astreinte sont stockés côté serveur et ne sont pas supprimés lorsque vous désinstallez l'application.

## Dépannage

**L'App Store indique que l'application n'est « Pas disponible dans votre région » :**
- L'application est publiée sur l'App Store mondial. Si elle n'apparaît pas dans votre région, contactez le [support](mailto:support@oneuptime.com).

**« Erreur réseau » lors de la connexion :**
- Vérifiez que l'**URL du serveur** est correcte et accessible depuis votre appareil.
- Si vous êtes sur un réseau d'entreprise ou un VPN, assurez-vous que l'instance OneUptime est accessible.
- Vérifiez que le serveur est servi via HTTPS avec un certificat valide.

**Vous ne recevez pas les notifications push :**
- Ouvrez **Réglages → Notifications → OneUptime On-Call** et confirmez que les notifications sont autorisées.
- Désactivez **Ne pas déranger** ou ajoutez OneUptime On-Call à la liste d'autorisation de votre mode Concentration actif.
- Déconnectez-vous et reconnectez-vous pour actualiser le jeton push enregistré auprès du serveur.
- Utilisateurs auto-hébergés : confirmez que les notifications push sont configurées sur votre instance OneUptime (consultez le guide [Notifications push](/docs/self-hosted/push-notifications) pour l'auto-hébergement).

**Face ID / Touch ID ne fonctionne pas :**
- Assurez-vous que la biométrie est enregistrée dans **Réglages → Face ID et code** ou **Réglages → Touch ID et code**.
- Réactivez le déverrouillage biométrique depuis l'écran **Paramètres** à l'intérieur de l'application OneUptime On-Call.

**L'application plante au lancement :**
- Mettez à jour vers la dernière version depuis l'App Store.
- Redémarrez votre appareil.
- Si le problème persiste, supprimez et réinstallez l'application, puis reconnectez-vous.

## Support

Si vous avez encore besoin d'aide, contactez-nous via votre tableau de bord OneUptime ou ouvrez un ticket sur notre [dépôt GitHub](https://github.com/OneUptime/oneuptime).
