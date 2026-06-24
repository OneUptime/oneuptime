# FAQ et Dépannage

Foire aux questions et solutions pour les applications mobiles et de bureau OneUptime.

## Comment OneUptime distribue-t-il ses applications ?

- **Mobile (iOS et Android) :** OneUptime fournit une application native appelée **OneUptime On-Call**. Elle est publiée sur l'[Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) et [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Un [téléchargement APK](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) signé est également disponible pour les appareils Android sans Google Play.
- **Bureau (Windows, macOS, Linux) :** Le tableau de bord web de OneUptime est une Application Web Progressive (PWA). Vous pouvez l'installer comme une application de bureau directement depuis un navigateur basé sur Chromium ou Safari — aucun compte de store n'est requis.

## FAQ Application mobile

### Quels appareils sont pris en charge ?

- **iOS :** iPhone ou iPad exécutant iOS 15.0 ou une version ultérieure.
- **Android :** Téléphones et tablettes exécutant Android 8.0 (Oreo) ou une version ultérieure.

### L'application est-elle gratuite ?

Oui. L'application OneUptime On-Call est gratuite à installer. Vous vous connectez avec votre compte OneUptime existant.

### Puis-je utiliser l'application avec une instance OneUptime auto-hébergée ?

Oui. Au premier lancement, l'application demande une **URL du serveur**. Saisissez l'URL de votre instance auto-hébergée (par exemple, `https://oneuptime.example.com`). L'application vérifie que le serveur est joignable avant de vous permettre de vous connecter.

Pour les notifications push sur les instances auto-hébergées, suivez le guide [Notifications push](/docs/self-hosted/push-notifications).

### Comment les mises à jour sont-elles diffusées ?

- **iOS :** Via l'App Store. Activez les mises à jour automatiques dans **Réglages → App Store**, ou mettez à jour manuellement depuis votre profil App Store.
- **Android (Google Play) :** Les mises à jour automatiques sont activées par défaut.
- **Android (APK installé manuellement) :** Téléchargez et installez le dernier APK depuis le lien GitHub Releases ci-dessus.

### Pourquoi ne reçois-je pas les notifications push ?

Les notifications push mobiles utilisent APNs (iOS) et FCM (Android) à travers Expo Push. Vérifiez les points suivants :

1. Les notifications sont activées au niveau du système d'exploitation pour **OneUptime On-Call**.
2. L'optimisation de la batterie est désactivée et l'activité en arrière-plan est autorisée (Android).
3. Les modes Do Not Disturb ou Concentration sont désactivés, ou l'application figure dans la liste des exceptions.
4. Vous êtes connecté — le jeton push n'est enregistré auprès du serveur qu'après votre connexion.
5. **Auto-hébergement uniquement :** Les notifications push sont configurées sur votre instance OneUptime. Consultez le guide [Notifications push](/docs/self-hosted/push-notifications).

### Les données sur mon téléphone sont-elles sécurisées ?

- Tout le trafic API utilise HTTPS.
- Les jetons d'accès et de rafraîchissement sont stockés dans le coffre-fort sécurisé de l'appareil (Keychain sur iOS, Keystore sur Android).
- Vous pouvez exiger un déverrouillage par Face ID / Touch ID / empreinte digitale depuis l'écran **Paramètres** dans l'application.

### Puis-je installer l'application sur plusieurs appareils ?

Oui. Connectez-vous avec le même compte OneUptime sur autant d'appareils que nécessaire. Chaque appareil reçoit ses propres notifications push.

### Comment désinstaller ?

- **iOS :** Appui long sur l'icône → **Supprimer l'app** → **Supprimer l'app**.
- **Android :** Appui long sur l'icône → **Désinstaller**, ou **Paramètres → Applications → OneUptime On-Call → Désinstaller**.

Votre compte OneUptime et vos données sont stockés sur le serveur et ne sont pas supprimés lorsque vous désinstallez l'application.

## FAQ Application de bureau (PWA)

### Qu'est-ce qu'une Application Web Progressive (PWA) ?

Une Application Web Progressive est une application web qui peut être installée comme une application native de bureau. Une fois installée, elle s'exécute dans sa propre fenêtre, dispose de sa propre icône dans votre lanceur et peut diffuser des notifications de bureau — sans passer par le Windows Store, le Mac App Store ou tout autre canal de distribution.

### Pourquoi l'application de bureau utilise-t-elle la technologie PWA ?

- **Mises à jour instantanées** — l'application reste synchronisée avec votre instance OneUptime dès que vous déployez.
- **Aucun compte de store requis** — installez directement depuis n'importe quel navigateur moderne.
- **Base de code unique** — le même tableau de bord fonctionne sur Windows, macOS et Linux.

### Pourquoi le bouton « Installer » n'apparaît-il pas ?

1. Utilisez un navigateur basé sur Chromium (Chrome, Edge, Brave, Arc) ou Safari (macOS Sonoma+).
2. Vérifiez que votre instance OneUptime est servie via HTTPS avec un certificat valide.
3. Videz le cache de votre navigateur et rechargez la page.
4. L'application est peut-être déjà installée — vérifiez vos Applications / votre menu Démarrer.

### Comment mettre à jour l'application de bureau ?

La PWA se met à jour automatiquement chaque fois que vous l'ouvrez en étant en ligne. Pour forcer une mise à jour, actualisez la fenêtre avec **Ctrl+R** (Windows/Linux) ou **Cmd+R** (macOS).

### Comment désinstaller la PWA de bureau ?

- **Windows :** **Paramètres → Applications → OneUptime → Désinstaller**, ou clic droit sur l'entrée du menu Démarrer.
- **macOS :** Faites glisser l'application depuis **Applications** vers la Corbeille, ou faites un clic droit sur l'icône du Dock et choisissez **Supprimer**.
- **Linux :** Utilisez l'option de désinstallation de votre lanceur d'applications, ou supprimez le fichier `.desktop` correspondant.

## Dépannage

### Problèmes liés à l'application mobile

**L'application ne se connecte pas / « Erreur réseau » :**

- Vérifiez que l'**URL du serveur** est correcte et accessible depuis votre téléphone.
- Vérifiez que votre téléphone est connecté à Internet.
- Pour les instances auto-hébergées derrière un VPN, assurez-vous que le VPN est actif.

**Notifications push retardées ou manquantes (Android) :**

- Désactivez l'optimisation de la batterie : **Paramètres → Applications → OneUptime On-Call → Batterie → Sans restriction**.
- Désactivez l'Économiseur de données pour l'application.
- Sur les appareils Samsung, désactivez **Maintenance de l'appareil → Batterie → Limites d'utilisation en arrière-plan** pour OneUptime On-Call.

**Notifications push retardées ou manquantes (iOS) :**

- Évitez de forcer la fermeture de l'application — iOS peut interrompre la diffusion en arrière-plan.
- Désactivez le Mode économie d'énergie lorsque vous êtes d'astreinte.
- Ajoutez OneUptime On-Call à la liste d'autorisation de tout mode Concentration actif.

**Face ID / Touch ID / empreinte digitale ne fonctionne pas :**

- Assurez-vous que la biométrie est enregistrée dans les paramètres de votre système d'exploitation.
- Réactivez le déverrouillage biométrique depuis l'écran **Paramètres** à l'intérieur de l'application OneUptime On-Call.

### Problèmes liés à l'application de bureau (PWA)

**Bouton d'installation manquant :**

- Utilisez un navigateur pris en charge (basé sur Chromium ou Safari sur macOS Sonoma+).
- Assurez-vous que l'instance OneUptime est servie via HTTPS.
- Attendez que la page finisse de charger, puis vérifiez la présence de l'icône d'installation dans la barre d'adresse.

**Les notifications de bureau n'apparaissent pas :**

- Autorisez les notifications lorsque le navigateur vous le demande.
- Vérifiez les paramètres de notification du système d'exploitation (Assistant de concentration Windows, Notifications macOS, démon de notifications Linux).
- Pour les instances auto-hébergées, assurez-vous que la configuration des [Notifications push](/docs/self-hosted/push-notifications) est terminée.

**L'application n'affiche pas les dernières données :**

- Actualisez avec **Ctrl+R** / **Cmd+R**.
- Fermez et rouvrez la fenêtre.
- Vérifiez votre connexion réseau.

## Support

Si vous avez encore besoin d'aide :

- Mobile : consultez les guides d'installation [iOS](./ios-installation.md) ou [Android](./android-installation.md).
- Bureau : consultez les guides d'installation [Windows](./windows-installation.md), [macOS](./macos-installation.md) ou [Linux](./linux-installation.md).
- Ouvrez un ticket sur le [dépôt GitHub OneUptime](https://github.com/OneUptime/oneuptime).
- Contactez le support via votre tableau de bord OneUptime.
