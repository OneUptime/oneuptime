# Vue d'ensemble des applications

OneUptime a une application pour votre téléphone et une pour votre ordinateur. **OneUptime On-Call**, pour iPhone, iPad et Android, vous alerte quand vous êtes d'astreinte et vous permet d'accuser réception et de résoudre où que vous soyez. Sous Windows, macOS et Linux, le tableau de bord OneUptime s'installe depuis votre navigateur comme une application de bureau, avec sa propre fenêtre. Les deux fonctionnent avec OneUptime Cloud et avec un OneUptime que vous hébergez vous-même.

:::cards
- [Choisir une application](#choisir-une-application): À quoi sert chaque application, côte à côte.
- [Comment les applications joignent OneUptime](#comment-les-applications-joignent-oneuptime): Le chemin de la connexion et des alertes d'astreinte.
- [Obtenir l'application mobile](#obtenir-lapplication-mobile): Depuis l'App Store, Google Play ou GitHub.
- [Obtenir l'application de bureau](#obtenir-lapplication-de-bureau): Installer le tableau de bord depuis Edge, Chrome ou Safari.
:::

## Choisir une application

|  | Application mobile | Application de bureau |
| --- | --- | --- |
| Ce que c'est | OneUptime On-Call, une application native pour iPhone, iPad et Android | Le tableau de bord OneUptime, installé depuis votre navigateur |
| Où l'obtenir | L'App Store, Google Play, ou un APK sur GitHub | Votre propre OneUptime : il n'y a rien à télécharger |
| Alertes d'astreinte | Notifications push, qui peuvent sonner malgré le mode silencieux et Ne pas déranger | Notifications du navigateur, une fois le navigateur enregistré |
| Ce que vous pouvez faire | Incidents, alertes, dossiers de sécurité, moniteurs et qui est d'astreinte ; accuser réception, résoudre, approuver des étapes de playbook et ajouter des notes | Tout ce que fait le tableau de bord |
| Mises à jour | Depuis le store, ou en installant un APK plus récent | À chaque ouverture, elle charge le tableau de bord depuis votre OneUptime |
| Fonctionne sur | iOS 16.4 ou version ultérieure, Android 7.0 ou version ultérieure | Windows, macOS et Linux, avec Edge ou Chrome, ou Safari sur macOS Sonoma 14 ou version ultérieure |

Vous pouvez utiliser les deux : gardez l'application de bureau ouverte au travail, et laissez le téléphone vous réveiller la nuit.

## Comment les applications joignent OneUptime

```mermaid title="Comment les alertes d'astreinte joignent votre téléphone et votre ordinateur"
flowchart TB
    OneUptime["Votre OneUptime :<br/>Cloud ou auto-hébergé"]
    Expo["Service push d'Expo,<br/>puis Apple ou Google"]
    WebPush["Le service push<br/>de votre navigateur"]
    Phone["OneUptime On-Call<br/>sur votre téléphone"]
    Desktop["L'application de bureau<br/>sur votre ordinateur"]
    OneUptime -->|"vers un téléphone"| Expo
    OneUptime -->|"vers un navigateur<br/>enregistré"| WebPush
    Expo -->|"notification push"| Phone
    WebPush -->|"notification"| Desktop
```

L'application mobile se connecte à votre OneUptime et enregistre le téléphone dans chaque projet dont vous êtes membre. Dès lors, OneUptime envoie les notifications push du téléphone, dont les alertes d'astreinte, par le service push d'Expo, qui les confie à Apple ou Google pour la livraison. Par défaut, un OneUptime auto-hébergé les envoie par le relais push de OneUptime : il n'a donc besoin d'aucun compte Apple, Google ou Expo à lui : voir [Notifications push](/docs/self-hosted/push-notifications).

L'application de bureau est le tableau de bord lui-même, dans sa propre fenêtre. Elle affiche des notifications une fois que vous avez enregistré son navigateur pour les notifications push : les pages Windows, macOS et Linux montrent comment.

## Avant de commencer

- Un compte dans un projet OneUptime. Pour être alerté, vous devez aussi être d'astreinte : voir [Règles d'escalade](/docs/on-call/escalation-rules).
- L'adresse de votre OneUptime. Sur OneUptime Cloud, c'est `https://oneuptime.com` ; un OneUptime auto-hébergé a la sienne, par exemple `https://oneuptime.example.com`.
- Votre OneUptime servi en HTTPS. L'application mobile ne se connecte pas en HTTP simple, et les navigateurs n'affichent des notifications, et Edge et Chrome n'installent des applications, que pour des sites en HTTPS.

## Obtenir l'application mobile

:::steps
### Installer OneUptime On-Call
Obtenez-la depuis l'[App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) sur un iPhone ou un iPad, ou depuis [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall) sur Android. Pour un téléphone Android sans Google Play, installez plutôt l'[APK](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk). Les mêmes liens se trouvent dans le tableau de bord, sous **Paramètres du projet → Notifications → Applications mobiles**.

### La connecter à votre OneUptime
Ouvrez l'application, gardez `https://oneuptime.com` pour OneUptime Cloud ou saisissez l'adresse de votre propre OneUptime, puis connectez-vous avec votre mot de passe, une clé d'accès ou l'authentification unique.

### Autoriser les notifications
Autorisez-les quand le téléphone le demande. L'application enregistre le téléphone dans chacun de vos projets, et vos alertes d'astreinte commencent à lui parvenir.
:::

Chaque étape en détail, avec ce qu'il faut vérifier ensuite : [Installation Android](/docs/mobile-desktop-apps/android-installation) et [Installation iOS](/docs/mobile-desktop-apps/ios-installation).

## Obtenir l'application de bureau

:::steps
### Ouvrir votre tableau de bord
Connectez-vous à votre OneUptime dans Microsoft Edge ou Google Chrome, ou dans Safari sur un Mac.

### L'installer
Dans Edge ou Chrome, cliquez sur l'icône d'installation à droite de la barre d'adresse. Dans Safari, choisissez **Fichier → Ajouter au Dock**.

### L'ouvrir comme toute autre application
Elle s'ouvre dans sa propre fenêtre, depuis le menu Démarrer, le Dock ou votre lanceur d'applications.
:::

Chaque navigateur pas à pas : [Installation Windows](/docs/mobile-desktop-apps/windows-installation), [Installation macOS](/docs/mobile-desktop-apps/macos-installation) et [Installation Linux](/docs/mobile-desktop-apps/linux-installation).

## Étapes suivantes

:::cards
- [Installation Android](/docs/mobile-desktop-apps/android-installation): Installer l'application sur Android, se connecter et vérifier que les alertes arrivent.
- [Installation iOS](/docs/mobile-desktop-apps/ios-installation): Installer l'application sur un iPhone ou un iPad et activer les alertes critiques.
- [Installation Windows](/docs/mobile-desktop-apps/windows-installation): Installer le tableau de bord depuis Edge ou Chrome.
- [Installation macOS](/docs/mobile-desktop-apps/macos-installation): Ajouter le tableau de bord au Dock depuis Safari, Chrome ou Edge.
- [Installation Linux](/docs/mobile-desktop-apps/linux-installation): Installer le tableau de bord depuis Chrome, Chromium ou Edge.
- [FAQ et dépannage](/docs/mobile-desktop-apps/faq-troubleshooting): Réponses, solutions, et que faire quand un téléphone ne reçoit plus d'alertes.
:::
