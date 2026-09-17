# Applications mobiles et de bureau OneUptime

OneUptime propose deux façons d'utiliser la plateforme en dehors de votre navigateur :

- **Applications mobiles natives** pour iOS et Android, publiées sur l'**Apple App Store** et **Google Play**. Elles vous transmettent les notifications d'astreinte, les alertes d'incident et les actions d'acquittement directement sur votre téléphone.
- **Applications de bureau installables** pour Windows, macOS et Linux, livrées sous forme d'Application Web Progressive (PWA) installée directement depuis votre navigateur. Elles offrent au tableau de bord OneUptime sa propre fenêtre, son icône et sa surface de notifications sur votre ordinateur.

## Mobile (Applications natives)

L'application **OneUptime On-Call** est une application native développée avec React Native. Elle est distribuée via les stores officiels afin que vous puissiez bénéficier de mises à jour automatiques, de notifications push et du déverrouillage biométrique.

- **iOS** — [Télécharger sur l'App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391). Nécessite iOS 15.0 ou une version ultérieure. Consultez le [Guide d'installation iOS](./ios-installation.md).
- **Android** — [Disponible sur Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Nécessite Android 8.0 ou une version ultérieure. Un [téléchargement APK](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) direct est également disponible pour les appareils sans Google Play. Consultez le [Guide d'installation Android](./android-installation.md).

## Bureau (Application Web Progressive)

Le tableau de bord web de OneUptime est une Application Web Progressive, ce qui vous permet de l'installer comme une application de bureau depuis un navigateur moderne, sans passer par un store.

- [Installation sous Windows](./windows-installation.md)
- [Installation sous macOS](./macos-installation.md)
- [Installation sous Linux](./linux-installation.md)

### Premiers pas sur le bureau

1. Ouvrez votre instance OneUptime dans un navigateur basé sur Chromium (Chrome, Edge) ou Safari.
2. Recherchez le bouton **Installer** dans la barre d'adresse ou dans **Fichier → Ajouter au Dock / Applications → Installer ce site en tant qu'application**.
3. Lancez l'application installée depuis votre menu Démarrer, votre Launchpad ou votre lanceur d'applications.

### Dépannage sur le bureau

**L'option d'installation n'apparaît pas :**

- Assurez-vous d'utiliser un navigateur pris en charge.
- Vérifiez que votre instance OneUptime est servie via HTTPS.
- Actualisez la page ou videz le cache de votre navigateur.

**Les notifications push ne fonctionnent pas :**

- Accordez les autorisations de notification lorsque le navigateur vous y invite.
- Vérifiez les paramètres de notification de votre système d'exploitation pour le navigateur.
- Utilisateurs auto-hébergés : confirmez que les notifications push sont configurées sur votre instance OneUptime.

## Support

- Problèmes spécifiques au mobile : consultez les guides d'installation [iOS](./ios-installation.md) ou [Android](./android-installation.md).
- Problèmes spécifiques au bureau : consultez les guides d'installation [Windows](./windows-installation.md), [macOS](./macos-installation.md) ou [Linux](./linux-installation.md).
- Questions générales : consultez la page [FAQ et Dépannage](./faq-troubleshooting.md).
- Signalez les bugs ou les demandes de fonctionnalités sur notre [dépôt GitHub](https://github.com/OneUptime/oneuptime).
