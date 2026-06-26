# Guide d'installation Android

Installez l'application Android native **OneUptime On-Call** depuis le Google Play Store, ou installez le fichier APK directement sur les appareils sans Google Play.

## Prérequis

- Téléphone ou tablette Android exécutant **Android 8.0 (Oreo) ou une version ultérieure**
- Un compte OneUptime actif (ou l'URL de votre instance OneUptime auto-hébergée)
- Une connexion Internet pour la connexion et la réception des notifications push

## Option 1 : Installer depuis Google Play (recommandé)

1. Ouvrez le **Google Play Store** sur votre appareil.
2. Recherchez **« OneUptime On-Call »**, ou ouvrez ce lien sur votre appareil :
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. Appuyez sur **Installer**.
4. Une fois l'installation terminée, appuyez sur **Ouvrir** ou lancez **OneUptime On-Call** depuis votre tiroir d'applications.

## Option 2 : Installer l'APK directement

Pour les appareils sans Google Play (par exemple GrapheneOS, /e/OS ou les appareils Huawei), installez l'APK officiel depuis les GitHub Releases :

1. Sur votre appareil Android, ouvrez ce lien :
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. Lorsque vous y êtes invité, autorisez votre navigateur à installer des applications inconnues :
   **Paramètres → Applications → \[Votre navigateur\] → Installer des applications inconnues → Autoriser depuis cette source**.
3. Ouvrez l'APK téléchargé et appuyez sur **Installer**.
4. Lancez **OneUptime On-Call** depuis votre tiroir d'applications.

L'APK est compilé et signé par OneUptime à partir des mêmes sources que la version du Play Store. Les mises à jour de l'application ne sont pas automatiques lorsque vous installez l'APK manuellement — téléchargez le dernier APK depuis le lien ci-dessus lorsqu'une nouvelle version est publiée.

## Premier lancement et connexion

1. **URL du serveur**
   - Si vous utilisez OneUptime Cloud, laissez la valeur par défaut `https://oneuptime.com`.
   - Si vous auto-hébergez, saisissez l'URL de votre instance OneUptime (par exemple `https://oneuptime.example.com`).
   - L'application vérifie que le serveur est joignable avant de continuer.
2. **Connexion**
   - Saisissez l'adresse e-mail et le mot de passe de votre compte OneUptime.
   - Vous pouvez éventuellement activer le **déverrouillage biométrique** (empreinte digitale) pour des déverrouillages plus rapides lors des lancements suivants.
3. **Autoriser les notifications**
   - Lorsque vous y êtes invité, appuyez sur **Autoriser** afin que l'application puisse délivrer les notifications d'astreinte, les alertes d'incident et les acquittements.

## Notifications push

Les notifications push sont délivrées via Firebase Cloud Messaging (FCM) à travers Expo Push. Pour vous assurer que les notifications d'astreinte vous parviennent de manière fiable pendant votre garde :

1. Ouvrez **Paramètres → Applications → OneUptime On-Call → Notifications** et vérifiez que toutes les catégories sont activées.
2. Ouvrez **Paramètres → Applications → OneUptime On-Call → Batterie** et choisissez **Sans restriction** (ou désactivez l'optimisation de la batterie) afin que le système d'exploitation ne retarde pas les notifications push en arrière-plan.
3. Autorisez l'application à s'exécuter en arrière-plan et désactivez toute restriction « Économiseur de données » la concernant.
4. Si vous utilisez des appareils Samsung, désactivez également **Paramètres → Maintenance de l'appareil → Batterie → Limites d'utilisation en arrière-plan** pour OneUptime On-Call.
5. Ajoutez OneUptime On-Call à toutes les listes d'exceptions de **Do Not Disturb** afin que les notifications continuent à sonner pendant votre garde.

## Mises à jour

**Google Play :**

- Les mises à jour s'installent automatiquement. Pour en déclencher une manuellement, ouvrez **Play Store → Profil → Gérer les applications et l'appareil → Mises à jour disponibles → OneUptime On-Call → Mettre à jour**.

**Installation manuelle de l'APK :**

- Téléchargez à nouveau le dernier APK depuis le lien GitHub Releases ci-dessus et installez-le par-dessus l'application existante — vos données, l'URL du serveur et votre connexion sont préservées.

## Désinstaller

1. **Appuyez longuement** sur l'icône **OneUptime On-Call**, puis appuyez sur **Désinstaller**.
2. Ou ouvrez **Paramètres → Applications → OneUptime On-Call → Désinstaller**.
3. Confirmez pour supprimer l'application.

Votre compte OneUptime et vos plannings d'astreinte sont stockés côté serveur et ne sont pas supprimés lorsque vous désinstallez l'application.

## Dépannage

**« Erreur réseau » lors de la connexion :**

- Vérifiez que l'**URL du serveur** est correcte et accessible depuis votre appareil.
- Si vous êtes sur un réseau d'entreprise ou un VPN, assurez-vous que l'instance OneUptime est accessible.
- Vérifiez que le serveur est servi via HTTPS avec un certificat valide.

**Vous ne recevez pas les notifications push :**

- Vérifiez que les notifications sont activées dans **Paramètres → Applications → OneUptime On-Call → Notifications**.
- Désactivez l'optimisation de la batterie pour OneUptime On-Call (voir Notifications push ci-dessus).
- Assurez-vous que Do Not Disturb est désactivé, ou que OneUptime On-Call figure dans la liste des exceptions.
- Déconnectez-vous et reconnectez-vous pour actualiser le jeton push enregistré auprès du serveur.
- Utilisateurs auto-hébergés : confirmez que les notifications push sont configurées sur votre instance OneUptime (consultez le guide [Notifications push](/docs/self-hosted/push-notifications) pour l'auto-hébergement).

**Le déverrouillage biométrique ne fonctionne pas :**

- Enregistrez une empreinte digitale dans **Paramètres → Sécurité → Empreinte digitale**.
- Réactivez le déverrouillage biométrique depuis l'écran **Paramètres** à l'intérieur de l'application OneUptime On-Call.

**L'installation de l'APK est bloquée :**

- Vous devez accorder au navigateur l'autorisation d'installer des applications inconnues (voir l'Option 2 ci-dessus).
- Certains opérateurs ou profils d'appareils d'entreprise bloquent entièrement l'installation manuelle ; dans ce cas, utilisez plutôt la version Google Play.

**L'application plante au lancement :**

- Mettez à jour vers la dernière version depuis Google Play ou le dernier APK.
- Redémarrez votre appareil.
- Si le problème persiste, désinstallez et réinstallez l'application, puis reconnectez-vous.

## Support

Si vous avez encore besoin d'aide, contactez-nous via votre tableau de bord OneUptime ou ouvrez un ticket sur notre [dépôt GitHub](https://github.com/OneUptime/oneuptime).
