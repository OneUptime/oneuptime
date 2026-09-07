# Accès aux intégrations depuis les réseaux privés

Une instance OneUptime auto-hébergée peut envoyer des requêtes à Twilio et Microsoft tout en restant inaccessible à leurs services cloud. La connexion VPN d'un employé ne donne accès au réseau privé à aucun de ces fournisseurs. Utilisez le [guide de configuration Twilio](/docs/self-hosted/twilio-integration) et le [guide de configuration Teams](/docs/self-hosted/microsoft-teams-integration) avec les étapes réseau ci-dessous.

## Dans quel sens l'accès est-il nécessaire ?

| Fonctionnalité | De OneUptime au fournisseur | Du fournisseur à OneUptime |
| --- | --- | --- |
| Envoyer un SMS ou diffuser une simple alerte vocale sortante | HTTPS | Inutile pour soumettre le SMS ou diffuser les instructions vocales fournies directement |
| Mises à jour de livraison des SMS, actions au clavier vocal, routage des appels entrants | HTTPS | Callbacks requis ; voir les routes dans le guide Twilio |
| Notifications Teams | HTTPS vers les API Microsoft | Requis pour l'intégration complète du bot, notamment la découverte des conversations |
| Commandes Teams, boutons des cartes, événements d'installation dans les conversations | HTTPS | `POST /api/microsoft-bot/messages` |

Les [paramètres d'accès aux réseaux privés](/docs/self-hosted/private-network-access) contrôlent les requêtes sortantes de OneUptime vers les services internes. Activer `ALLOW_PRIVATE_NETWORK_WEBHOOKS` ne rend pas OneUptime accessible à Twilio ou Teams.

## Production : publier une passerelle vers le déploiement privé

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
Passerelle publique (proxy inverse ou répartiteur de charge)
          | Connexion privée ; uniquement les routes de callback
          v
Ingress OneUptime privé -> Application OneUptime
```

1. **Choisissez un nom d'hôte**, par exemple `oneuptime.example.com`. Publiez des enregistrements DNS publics pointant vers une passerelle accessible depuis Internet. Les adresses IP privées et les noms DNS exclusivement internes sont inaccessibles aux fournisseurs. Avec un DNS scindé, les employés peuvent résoudre le même nom vers l'ingress privé et continuer à utiliser le tableau de bord via le VPN. L'ingress privé doit également servir HTTPS avec un certificat valide pour ce nom d'hôte.
2. **Connectez la passerelle à OneUptime.** Placez-la dans une DMZ avec une route vers l'ingress privé, ou utilisez une passerelle publique connectée via votre propre VPN site à site ou liaison privée. Autorisez le trafic de la passerelle vers l'ingress sur le port du service en amont. Pour Kubernetes/Portainer, un service privé `ClusterIP` ne suffit pas : la passerelle a besoin d'un ingress/contrôleur ou d'une autre destination accessible. Gardez les bases de données et les autres services internes privés.
3. **Terminez HTTPS sur le port 443** avec un certificat reconnu publiquement et une chaîne intermédiaire complète. Autorisez le trafic TCP entrant sur le port 443 de la passerelle. Installer un certificat ou modifier le DNS ne crée pas à lui seul la route vers la destination privée.
4. **Transmettez uniquement les chemins de callback requis**, figurant dans le tableau du guide Twilio, ainsi que `/api/microsoft-bot/messages` pour Teams. Faites-les passer par l'ingress OneUptime, qui associe déjà `/notification` à l'application. Conservez la méthode, le chemin d'origine, la chaîne de requête, le corps, `Authorization` et `X-Twilio-Signature`. Conservez le `Host` public et définissez des en-têtes de confiance `X-Forwarded-Host` et `X-Forwarded-Proto: https` sur la passerelle. Ne supprimez pas `/api` et n'ajoutez pas de redirections. Refusez les autres chemins sur la passerelle publique ; les employés peuvent utiliser l'ingress privé pour le tableau de bord et les callbacks de connexion par navigateur.
5. **Préservez l'authentification des callbacks.** Exemptez ces routes du SSO par navigateur, des CAPTCHA et des pages de connexion du proxy, que les fournisseurs ne peuvent pas franchir. OneUptime valide toujours ses jetons de callback, les signatures Twilio sur les routes d'appels entrants et l'authentification Bot Framework. Ne supprimez pas ces contrôles. Autorisez l'accès à l'origine uniquement depuis votre passerelle et les clients internes autorisés, et masquez les jetons de callback dans les journaux. Twilio décrit cette [architecture de proxy en DMZ et la sécurité des webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
6. **Définissez l'URL canonique de OneUptime** avant de configurer l'une ou l'autre intégration :

   Docker Compose, dans `config.env` :

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Valeurs Helm/Portainer :

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Ces paramètres contrôlent les URL générées ; ils ne configurent ni DNS, ni TLS, ni accès au pare-feu. Appliquez la configuration Compose ou la mise à jour de la release Helm et attendez le redémarrage de l'application. OneUptime ne propose pas de nom d'hôte distinct pour les callbacks Twilio. Si le nom d'hôte change, mettez à jour les webhooks existants des numéros Twilio, le point de terminaison de messagerie Azure Bot et les URI de redirection de l'inscription d'application, puis téléchargez et chargez à nouveau le manifeste Teams.

## Accès sortant et restrictions IP

Autorisez la résolution DNS et le HTTPS sortant depuis l'application OneUptime. Twilio recommande l'accès à `*.twilio.com`, car ses adresses API changent ; consultez les [recommandations Twilio sur les adresses IP](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Teams utilise `graph.microsoft.com`, `login.microsoftonline.com`, les points de terminaison d'authentification et de canal Bot Framework, ainsi que l'URL du service de connecteur de la conversation. Utilisez les [recommandations de pare-feu Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) et examinez le trafic bloqué pendant les tests ; ces exemples ne constituent pas une liste exhaustive de domaines.

N'utilisez pas les plages SIP/média Twilio ni les plages média des clients Teams comme listes d'autorisation des sources de webhooks. Les adresses ordinaires des webhooks Twilio sont dynamiques ; les éditions Twilio éligibles proposent [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy), qui nécessite une configuration distincte avec Twilio. Les recommandations de pare-feu Microsoft avertissent que les listes fixes d'adresses IP entrantes pour Bot Framework ne sont pas prises en charge. Authentifiez les callbacks dans l'application au lieu de supposer qu'une adresse IP source fixe établit l'identité.

## Tests et déploiements sans accès entrant

Depuis un réseau extérieur à votre VPN, vérifiez le DNS public et TLS, puis contrôlez la route Teams :

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

Sur les versions actuelles de OneUptime, attendez-vous à `405 Method Not Allowed` avec `Allow: POST`. Cela confirme que la requête GET a atteint la route, pas qu'une requête POST authentifiée du bot fonctionnera. Les anciennes versions peuvent renvoyer l'erreur JSON 404 de OneUptime ; examinez le corps de la réponse et les journaux du proxy. Des erreurs TLS, des délais d'attente dépassés ou une page d'erreur HTML du proxy indiquent des problèmes de certificat ou de routage.

Un GET de navigateur ne teste pas un callback POST Twilio. Envoyez un véritable SMS de test, vérifiez sa mise à jour de livraison, répondez à un appel d'incident de test et utilisez son action au clavier, puis envoyez un message au bot Teams et appuyez sur un bouton de carte. Rapprochez les diagnostics de livraison du fournisseur des journaux de la passerelle et de l'application, en masquant les jetons. La réussite de l'envoi sortant ne prouve pas à elle seule que les callbacks fonctionnent.

Pour le développement, Twilio documente les [tests via un tunnel](https://www.twilio.com/docs/usage/webhooks/webhooks-overview) et Microsoft le [débogage local de Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug). Transmettez un tunnel HTTPS public vers un proxy n'autorisant que les routes requises, configurez le nom d'hôte obtenu comme ci-dessus et arrêtez le tunnel après les tests. Un tunnel expose toujours un point de terminaison entrant ; il ne rend pas le déploiement isolé physiquement du réseau.

Si votre politique interdit toute connectivité entrante, la soumission de SMS et la lecture simple d'instructions vocales fournies directement peuvent fonctionner avec le HTTPS sortant. En revanche, les callbacks de livraison, les actions au clavier, le routage des appels entrants et l'intégration complète du bot Teams ne le peuvent pas. Les points de terminaison privés Azure Bot pour Direct Line ne résolvent pas la connectivité Teams : le [guide d'isolation réseau Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) indique que désactiver l'accès public supprime les autres canaux, dont Teams. Un déploiement entièrement déconnecté ne peut pas utiliser ces intégrations cloud.
