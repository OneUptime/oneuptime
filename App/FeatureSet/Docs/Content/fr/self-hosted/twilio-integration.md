# Intégration Twilio pour les SMS et les appels vocaux

OneUptime auto-hébergé utilise votre compte Twilio pour envoyer des alertes par SMS et appel vocal. Vous payez Twilio directement. Configurez les identifiants dans le tableau de bord OneUptime : l'envoi des notifications lit la configuration enregistrée et le chart Helm ne propose aucune valeur d'identifiants Twilio. Une ancienne migration importait `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et `TWILIO_PHONE_NUMBER` ; modifier ces variables ne permet pas de mettre à jour les identifiants d'une installation existante.

## 1. Préparer votre compte Twilio

1. Ouvrez la [console Twilio](https://console.twilio.com/) et récupérez votre **Account SID** et votre **Auth Token**.
2. Obtenez un numéro de téléphone Twilio disposant des fonctionnalités SMS et/ou vocales nécessaires. Utilisez le format E.164, avec l'indicatif du pays, pour les numéros d'expéditeur et de destinataire.
3. Vérifiez le solde du compte, les autorisations des pays de destination et les exigences applicables d'enregistrement des expéditeurs. Les comptes d'essai imposent des restrictions sur les destinataires, les zones géographiques et d'autres aspects qui peuvent empêcher les véritables alertes OneUptime de fonctionner. Consultez la [documentation Twilio sur les comptes et les essais](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account) avant les tests. Utilisez un compte payant en production.

## 2. Enregistrer les identifiants dans OneUptime

Pour un projet :

1. Accédez à **Paramètres du projet > Notifications > Paramètres des notifications**.
2. Dans **Configuration Twilio**, sélectionnez **Créer une configuration Twilio**.
3. Saisissez un nom, le **Twilio Account SID**, le **Twilio Auth Token** et le **Numéro de téléphone Twilio principal**. Vous pouvez ajouter des **Numéros de téléphone Twilio secondaires** pour d'autres pays, séparés par des virgules.
4. Activez **Définir comme valeur par défaut du projet** pour utiliser cette configuration pour les SMS et appels des membres du projet, notamment les notifications d'astreinte. Créer une configuration sans activer cette option ne la sélectionne pas pour ces notifications.
5. Enregistrez. Une seule configuration peut être celle par défaut du projet. Les pages de statut utilisent la configuration explicitement affectée à chaque page.

Pour définir une configuration par défaut pour toute l'installation, un administrateur peut ouvrir **Tableau de bord d'administration > Paramètres > Appels et SMS**, modifier les identifiants et numéros Twilio, puis enregistrer. Les notifications des membres utilisent cette configuration globale lorsque leur projet n'a pas de configuration par défaut. Gardez l'Auth Token confidentiel.

## 3. Configurer l'accès réseau

Un déploiement privé nécessite un accès HTTPS sortant vers Twilio pour soumettre des SMS et des appels. Twilio recommande d'autoriser le HTTPS sortant vers `*.twilio.com`, car ses adresses API sont dynamiques ; consultez les [adresses IP Twilio](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Appliquez cette règle au trafic sortant de l'application OneUptime, y compris aux NetworkPolicies Kubernetes et aux pare-feu externes.

L'accès entrant dépend de la fonctionnalité :

| Fonctionnalité | Twilio doit-il pouvoir joindre OneUptime ? |
| --- | --- |
| Soumission de SMS | Non. Les mises à jour du statut de livraison nécessitent toutefois un callback. |
| Simple appel vocal de test | Non. OneUptime fournit les instructions vocales avec la requête API sortante. |
| Appuyer sur 1 pour acquitter une alerte d'astreinte | Oui. Twilio transmet la saisie au clavier à OneUptime. |
| Politiques d'appels entrants | Oui. Twilio demande les instructions d'appel et signale les résultats de numérotation. |

Pour les callbacks, suivez le guide d'[accès réseau pour Twilio et Microsoft Teams](/docs/self-hosted/integration-network-access) afin de publier les routes HTTPS requises via un ingress ou un proxy inverse, tout en gardant le tableau de bord privé. Un VPN sur l'ordinateur d'un administrateur ne fournit pas de connectivité à Twilio.

Définissez `HOST=oneuptime.example.com` et `HTTP_PROTOCOL=https` dans le fichier `config.env` de Docker Compose, ou `host: oneuptime.example.com` et `httpProtocol: https` dans les valeurs Helm, puis appliquez la modification du déploiement. Remplacez l'exemple par votre domaine. Ces paramètres déterminent les URL générées ; ils ne créent ni enregistrements DNS, ni certificats, ni règles de pare-feu. OneUptime ne propose pas de paramètre de nom d'hôte distinct pour les callbacks Twilio.

Voici les chemins externes passant par la passerelle Nginx de OneUptime ; les paramètres fictifs varient selon la notification :

| Méthode | Chemin | Objectif |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | Statut de livraison des SMS |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Acquittement au clavier |
| POST | `/notification/incoming-call/voice` | Instructions facultatives pour les appels entrants |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Résultats facultatifs du routage des appels entrants |

OneUptime génère automatiquement les URL de SMS et d'acquittement. Ne remplacez pas leurs jetons par une URL de webhook statique. Pour les appels entrants, suivez le guide des [politiques d'appels entrants](/docs/on-call/incoming-call-policy), qui configure le webhook du numéro lorsque vous associez un numéro.

Twilio exige des [URL de webhook accessibles publiquement](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Utilisez un certificat TLS reconnu publiquement et conservez l'hôte, le protocole, le chemin, les paramètres de requête, le corps et l'en-tête `X-Twilio-Signature` d'origine lors du passage par les proxys. Les gestionnaires d'appels entrants valident les signatures Twilio ; la livraison des SMS utilise un jeton d'URL par message et l'acquittement au clavier utilise un jeton de requête signé. N'exposez pas les jetons dans des journaux ou captures d'écran partagés. Consultez la [sécurité des webhooks Twilio](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

## 4. Tester séparément la livraison et les callbacks

1. Utilisez **Envoyer un SMS de test** et **Envoyer un appel de test** dans la configuration Twilio du projet. Confirmez la réception sur le téléphone destinataire.
2. Configurez le contact SMS/appel vérifié de l'utilisateur ainsi que ses règles de notification, puis déclenchez une alerte d'astreinte contrôlée. Appuyez sur 1 et vérifiez l'acquittement dans OneUptime.
3. Vérifiez le statut de livraison du SMS dans OneUptime et les journaux de messages Twilio. Un envoi accepté ne prouve pas la livraison ; [Twilio signale les changements de statut ultérieurs par callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Si l'envoi échoue, vérifiez les identifiants, les fonctionnalités du numéro, les restrictions du compte et la connectivité sortante. Si le message ou l'appel arrive sans mise à jour du statut ou de l'acquittement, examinez l'URL du callback et les journaux de l'ingress public. Le [guide Twilio des échecs de récupération HTTP](https://www.twilio.com/docs/api/errors/11200) aide à diagnostiquer les callbacks inaccessibles, les problèmes TLS et les erreurs HTTP. Un appel de test réussi ne suffit pas à vérifier l'accès aux callbacks.
