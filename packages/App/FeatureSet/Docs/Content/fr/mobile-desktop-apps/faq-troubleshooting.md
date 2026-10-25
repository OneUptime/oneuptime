# FAQ et dépannage

Réponses aux questions fréquentes sur les applications mobile et de bureau de OneUptime, et solutions à ce qui se passe mal le plus souvent : la connexion, les notifications qui n'arrivent pas, et un téléphone qui doit se réenregistrer.

:::cards
- [Questions sur l'application mobile](#questions-sur-lapplication-mobile): Appareils, projets, auto-hébergement et sécurité.
- [Questions sur l'application de bureau](#questions-sur-lapplication-de-bureau): Ce qu'est l'application de bureau, et ce qu'elle ne peut pas faire.
- [Quand un téléphone doit se réenregistrer](#quand-un-téléphone-doit-se-réenregistrer): Pourquoi un téléphone ne reçoit plus d'alertes, et comment il revient.
- [Dépannage](#dépannage): Problèmes de connexion, de notifications et d'installation.
:::

## Questions sur l'application mobile

:::details L'application est-elle gratuite ?
Oui. OneUptime On-Call est gratuite sur l'App Store, sur Google Play et sous forme d'APK sur GitHub. Vous vous connectez avec votre compte OneUptime.
:::

:::details Sur quels téléphones et tablettes fonctionne-t-elle ?
Sur les iPhone et iPad sous iOS ou iPadOS 16.4 ou version ultérieure, et sur les téléphones et tablettes Android sous Android 7.0 ou version ultérieure.
:::

:::details Fonctionne-t-elle avec un OneUptime auto-hébergé ?
Oui. Saisissez l'adresse `https://` de votre OneUptime au démarrage de l'application, ou touchez **Change Server** sur l'écran de connexion. Par défaut, votre serveur envoie les alertes aux téléphones par le relais push de OneUptime : il n'a donc besoin d'aucun compte Apple, Google ou Expo : voir [Notifications push](/docs/self-hosted/push-notifications).
:::

:::details Puis-je l'utiliser avec plusieurs projets ?
Oui. L'application enregistre le téléphone dans chaque projet dont vous êtes membre, pour que chaque projet puisse vous alerter. Elle affiche un projet à la fois : touchez le nom du projet en haut d'un écran pour en changer.
:::

:::details Puis-je me connecter sur plusieurs téléphones ?
Oui. Chaque téléphone ou tablette est un appareil push à part entière, avec ses propres règles d'astreinte et son propre réglage d'alertes critiques.
:::

:::details Que puis-je faire dans l'application ?
- **Home** : ce qui demande votre attention dans le projet : incidents et alertes actifs, dossiers de sécurité ouverts si votre rôle vous permet de les voir, moniteurs en difficulté et événements groupés.
- **Monitors** : tous les moniteurs, filtrés par état, avec leurs détails.
- **Inbox** : incidents et alertes, et les épisodes qui les regroupent. Ouvrez-en un pour choisir **Acknowledge**, **Resolve** ou **Add Note**. Si votre rôle vous permet de voir les dossiers de sécurité du projet, **Security** liste ceux qui sont ouverts : ouvrez-en un pour choisir **Approve** ou **Reject** sur une étape de playbook en attente d'approbation, prendre le dossier en charge avec **Assign to me** ou choisir **Close case**.
- **On-Call** : si vous êtes d'astreinte et jusqu'à quand, qui l'est aussi, les alertes qui vous ont été envoyées, et **Cover for me**, qui confie vos alertes à un collègue pour un temps.
- **Settings** : vos projets et l'authentification unique, l'apparence, les alertes critiques et le son d'alarme, **Biometrics Login**, votre flux de calendrier d'astreinte, et **Log Out**.

Tout le reste se trouve dans le tableau de bord.
:::

:::details Puis-je accuser réception d'une alerte depuis la notification ?
Non. Touchez la notification : l'application ouvre l'incident, l'alerte, l'épisode ou le dossier de sécurité concerné, dans le bon projet, et vous en accusez réception là. Si l'application est verrouillée ou si vous êtes déconnecté, elle ouvre l'alerte dès que vous êtes connecté.
:::

:::details Ma connexion est-elle sûre sur le téléphone ?
L'application ne parle à votre OneUptime qu'en HTTPS. Votre connexion est gardée dans le stockage propre de l'application sur le téléphone, et **Log Out** la supprime et ferme aussi la session sur le serveur. Activez **Biometrics Login** pour que l'application demande votre visage, votre empreinte ou votre code à chaque démarrage.
:::

:::details L'application fonctionne-t-elle hors ligne ?
Non. Sans connexion, elle affiche **No internet connection** en haut de l'écran, et reprend dès que la connexion revient.
:::

## Questions sur l'application de bureau

:::details Qu'est-ce que l'application de bureau ?
Le tableau de bord OneUptime, installé depuis votre navigateur comme une application : une fenêtre à lui, une icône dans le menu Démarrer, le Dock ou votre lanceur, et des notifications. Elle fait tout ce que fait le tableau de bord, puisque c'est le tableau de bord.
:::

:::details Pourquoi n'est-elle dans aucun store ?
Elle n'en a pas besoin. L'application charge le tableau de bord depuis votre OneUptime à chaque ouverture : c'est donc toujours la version que fait tourner votre OneUptime, sous Windows, macOS et Linux de la même façon, sans rien à mettre à jour.
:::

:::details Peut-elle me réveiller comme le téléphone ?
Non. Les navigateurs ne peuvent pas outrepasser Ne pas déranger ou un mode de concentration : une notification de bureau n'est donc pas plus forte que ce que l'ordinateur permet. Pour les alertes qui doivent vous réveiller, utilisez l'application mobile avec les alertes critiques.
:::

:::details Fonctionne-t-elle hors ligne ?
Non. Elle a besoin d'une connexion à votre OneUptime, comme le tableau de bord dans un onglet du navigateur.
:::

## Quand un téléphone doit se réenregistrer

OneUptime envoie les alertes d'un téléphone par Expo, qui les confie à Apple ou Google. Quand Expo indique que le téléphone n'est plus joignable, OneUptime cesse de lui envoyer quoi que ce soit, jusqu'à ce que l'application le réenregistre.

```mermaid title="Comment un téléphone cesse de recevoir des alertes, et comment il revient"
flowchart TB
    Registered["Le téléphone est<br/>enregistré, et les<br/>alertes l'atteignent"]
    Gone["Expo le signale disparu :<br/>un push est refusé,<br/>ou son reçu le dit environ<br/>15 minutes après"]
    Marked["OneUptime le marque Ne<br/>reçoit pas de notifications<br/>et cesse d'envoyer ;<br/>ses règles restent"]
    Open["Vous ouvrez l'application<br/>en étant connecté"]
    Renewed["L'application se<br/>réenregistre,<br/>renouvelle son jeton<br/>push, et les alertes<br/>l'atteignent à nouveau"]
    Registered --> Gone --> Marked --> Open --> Renewed
```

Expo signale un téléphone disparu quand l'application en a été supprimée, ou quand son jeton push n'est plus valide. Le téléphone n'est pas supprimé : **Paramètres utilisateur → Méthodes de notification**, dans l'onglet **Push Notifications**, l'affiche comme **Ne reçoit pas de notifications**, et la chronologie d'astreinte d'une alerte qui ne l'a pas atteint dit pourquoi. Vos autres téléphones et méthodes de notification sont alertés comme d'habitude.

L'application enregistre le téléphone à chaque démarrage, quand vous vous connectez, et quand vous y revenez, au plus une fois toutes les cinq minutes. L'enregistrement redemande le jeton push à Expo, ce qui le renouvelle, et le téléphone reçoit de nouveau les alertes avec les règles qu'il avait.

| Ce qui s'est passé | Que faire | Ce que fait OneUptime |
| --- | --- | --- |
| L'application est toujours installée | Ouvrez-la en étant connecté | Le téléphone reçoit de nouveau les notifications, avec ses règles |
| Vous avez réinstallé l'application sur un iPhone ou un iPad | Installez-la et connectez-vous | La même entrée revient généralement, avec ses règles |
| Vous avez réinstallé l'application sur Android | Installez-la, connectez-vous, et supprimez l'ancienne entrée | Une nouvelle entrée avec les règles par défaut ; l'ancienne reste marquée |
| Un nouveau téléphone, configuré à partir d'une sauvegarde de l'ancien | Ouvrez l'application sur le nouveau téléphone | Si l'entrée de l'ancien téléphone est marquée, le nouveau la reprend, avec ses règles ; sinon, le nouveau téléphone obtient sa propre entrée |
| Un nouveau téléphone, configuré de zéro | Connectez-vous, et supprimez l'ancienne entrée | Une nouvelle entrée avec les règles par défaut |
| Vous vous êtes déconnecté de l'application | Reconnectez-vous | La déconnexion a retiré le téléphone et ses règles ; il revient avec les règles par défaut |

Un navigateur peut lui aussi cesser de recevoir des notifications, quand son abonnement push expire. Le tableau de bord le renouvelle quand il le peut ; si le navigateur reste marqué, enregistrez-le de nouveau avec **Enregistrer l'appareil** dans ce navigateur.

## Dépannage

### Connexion

:::details « Could not connect to the server »
L'application n'a pas pu joindre `https://<your-oneuptime>/api/status`. Vérifiez l'adresse, y compris `https://` : l'application ne se connecte pas en HTTP simple. Si votre OneUptime est sur un réseau privé, connectez d'abord le téléphone à ce réseau, par votre VPN par exemple. Ouverte dans le navigateur du téléphone, cette adresse affiche `{"status":"ok"}` quand le téléphone peut joindre OneUptime.
:::

:::details « No SSO configuration found for the email »
Aucun des projets dont cet e-mail est membre n'a configuré l'authentification unique, ou l'e-mail n'a pas de compte sur ce OneUptime. Vérifiez l'e-mail, ou connectez-vous avec votre mot de passe. Les fournisseurs que votre administrateur a configurés pour toute l'installation sont listés avant le champ e-mail.
:::

:::details Une clé de sécurité est votre seul second facteur
L'application ne peut pas utiliser de clé de sécurité. Connectez-vous avec l'un de vos codes de secours, ou ajoutez une application d'authentification à votre compte dans le tableau de bord : voir [Activer l'authentification à deux facteurs](/docs/introduction/your-account#activer-lauthentification-à-deux-facteurs).
:::

:::details La connexion par clé d'accès échoue
Les clés d'accès demandent une adresse de votre OneUptime qui commence par `https://`, et une clé d'accès ajoutée pour ce OneUptime : voir [Ajouter une clé d'accès](/docs/introduction/your-account#ajouter-une-clé-daccès). Pour utiliser un autre serveur, touchez **Change Server** sur l'écran de connexion.
:::

### Notifications

:::details Aucune notification sur le téléphone
- Vérifiez que le téléphone autorise les notifications de OneUptime On-Call, et que Ne pas déranger ou un mode de concentration ne les retient pas.
- Dans **Paramètres utilisateur → Méthodes de notification**, onglet **Push Notifications**, vérifiez que le téléphone est listé, et envoyez-lui une **Notification de test**.
- S'il est marqué **Ne reçoit pas de notifications**, ouvrez l'application en étant connecté : voir [Quand un téléphone doit se réenregistrer](#quand-un-téléphone-doit-se-réenregistrer).
- Vérifiez vos règles d'astreinte sous **Paramètres utilisateur → Règles d'astreinte** : elles décident quelles alertes atteignent quelle méthode.
- Sur un OneUptime auto-hébergé, vérifiez que le serveur joint son relais push : voir [Notifications push](/docs/self-hosted/push-notifications#accès-réseau).
:::

:::details Les alertes arrivent en retard sur Android
Réglez l'utilisation de la batterie de l'application sur **Sans restriction** dans les paramètres d'Android pour OneUptime On-Call, et excluez l'application de toute liste d'économie de batterie : voir [Éviter que les alertes arrivent en retard](/docs/mobile-desktop-apps/android-installation#éviter-que-les-alertes-arrivent-en-retard).
:::

:::details Les alertes critiques ne sonnent pas malgré le mode silencieux
Ouvrez **Settings** dans l'application : la ligne sous **Critical On-Call Alerts** indique ce qui manque sur ce téléphone. Vérifiez ensuite, sous **Paramètres utilisateur → Règles d'astreinte**, que la règle d'astreinte qui a envoyé l'alerte est réglée sur **Alerte critique**, et non sur **Standard**. Chaque téléphone a son propre interrupteur.
:::

### Application de bureau

:::details Pas d'icône d'installation dans la barre d'adresse
Installez depuis une page du tableau de bord une fois connecté, en `https://`, dans Edge ou Chrome, ou dans Safari sur macOS Sonoma 14 ou version ultérieure. Si l'icône n'apparaît pas, le menu du navigateur installe aussi l'application : voir [Installation Windows](/docs/mobile-desktop-apps/windows-installation#installer-lapplication).
:::

:::details Pas de notifications sur le bureau
Enregistrez le navigateur sous **Paramètres utilisateur → Méthodes de notification**, onglet **Push Notifications**, avec **Enregistrer l'appareil**, autorisez les notifications quand on vous le demande, et vérifiez les réglages de notification de l'ordinateur lui-même. Un OneUptime auto-hébergé a besoin de ses clés VAPID pour les notifications du navigateur.
:::

## Obtenir de l'aide

Si quelque chose ici ne correspond pas à ce que vous voyez, [ouvrez une issue sur GitHub](https://github.com/OneUptime/oneuptime/issues) avec la version de votre application, en bas de son écran **Settings**, et la plateforme que vous utilisez.

## Étapes suivantes

:::cards
- [Vue d'ensemble des applications](/docs/mobile-desktop-apps/index): Quelle application utiliser, et comment elles joignent OneUptime.
- [Installation Android](/docs/mobile-desktop-apps/android-installation): Installer et configurer l'application sur Android.
- [Installation iOS](/docs/mobile-desktop-apps/ios-installation): Installer et configurer l'application sur un iPhone ou un iPad.
- [Notifications push](/docs/self-hosted/push-notifications): Comment un OneUptime auto-hébergé envoie les alertes, et les erreurs d'Expo.
:::
