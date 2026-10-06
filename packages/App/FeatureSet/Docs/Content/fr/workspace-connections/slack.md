# Connecter OneUptime à Slack

### Étapes pour connecter OneUptime à Slack

1. **Créer un compte sur OneUptime**

   - Visitez [OneUptime.com](https://oneuptime.com) et créez un compte.
   - Une fois le compte créé, créez un nouveau projet.

2. **Connecter Slack au projet OneUptime**

   - Accédez à **Paramètres du projet** > **Slack** dans votre projet OneUptime.
   - Suivez les instructions pour connecter votre compte Slack au projet OneUptime.

3. **Configurer les notifications d'incidents**

   - Après avoir connecté votre compte Slack, allez dans **Page des incidents** > **Slack**.
   - Ajoutez des règles pour envoyer des notifications d'incidents à Slack. Par exemple, vous pouvez créer une règle qui crée un nouveau canal Slack et invite les propriétaires d'incidents lorsqu'un incident est créé.

4. **Configurer les notifications d'alertes et de maintenance planifiée**
   - Des règles similaires peuvent être appliquées aux alertes et à la maintenance planifiée en accédant à leurs pages respectives et en configurant les règles souhaitées.

## Tester une règle

**Tester la règle** sur la ligne d'une règle publie un message de test de cette règle dans les canaux qu'elle nomme, pour que vous le voyiez arriver. Si la règle crée un canal pour chaque événement, le test en crée un aussi et y invite les personnes de la règle.

Comme **Envoyer le test** à côté d'un canal dans **Paramètres du projet** > **Workspace** > **Slack**, il faut la permission de créer des règles de notification : **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** ou **Create Workspace Notification Rule** dans un rôle personnalisé. Quelqu'un qui peut seulement voir les règles, comme un **Viewer**, est informé qu'il n'a pas la permission d'envoyer des notifications de test. Sur OneUptime Cloud, tester une règle demande le forfait **Growth**, comme en ajouter une.

## Accès réseau pour les déploiements auto-hébergés

Pour les connexions sortantes, les rappels entrants et les déploiements privés, consultez la section sur l’accès réseau du [Intégration Slack](/docs/self-hosted/slack-integration).
