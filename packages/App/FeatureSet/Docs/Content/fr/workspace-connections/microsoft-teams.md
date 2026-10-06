# Connecter OneUptime à Microsoft Teams

### Étapes pour connecter OneUptime à Microsoft Teams

1. **Créer un compte sur OneUptime**

   - Visitez [OneUptime.com](https://oneuptime.com) et créez un compte.
   - Une fois le compte créé, créez un nouveau projet.

2. **Connecter Microsoft Teams au projet OneUptime**

   - Accédez à **Paramètres du projet** > **Microsoft Teams** dans votre projet OneUptime.
   - Suivez les instructions pour connecter votre compte Microsoft Teams au projet OneUptime.

3. **Configurer les notifications d'incidents**

   - Après avoir connecté votre compte Microsoft Teams, allez dans **Page des incidents** > **Microsoft Teams**.
   - Ajoutez des règles pour envoyer des notifications d'incidents à Microsoft Teams. Par exemple, vous pouvez créer une règle qui publie des messages dans un canal Teams lorsqu'un incident est créé.

4. **Configurer les notifications d'alertes et de maintenance planifiée**
   - Des règles similaires peuvent être appliquées aux alertes et à la maintenance planifiée en accédant à leurs pages respectives et en configurant les règles souhaitées.

## Tester une règle

**Tester la règle** sur la ligne d'une règle publie un message de test de cette règle dans les canaux qu'elle nomme, pour que vous le voyiez arriver. Si la règle crée un canal pour chaque événement, le test en crée un aussi et y invite les personnes de la règle.

Comme **Envoyer le test** à côté d'un canal dans **Paramètres du projet** > **Workspace** > **Microsoft Teams**, il faut la permission de créer des règles de notification : **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** ou **Create Workspace Notification Rule** et **Read Workspace Notification Rule** dans un rôle personnalisé. Pour quelqu'un qui peut seulement voir les règles, comme un **Viewer**, **Tester la règle** est verrouillé, et son infobulle dit ce qu'il faut ; l'API refuse son test avec « You do not have permission to send test notifications in this project. » Sur OneUptime Cloud, tester une règle demande le forfait **Growth**, comme en ajouter une.

## Résumés

L'onglet **Summary** de **Incidents** > **Workspace** > **Microsoft Teams** (et celui d'**Alertes**) publie un récapitulatif régulier dans les canaux que vous indiquez : le nombre d'incidents ou d'alertes, la rapidité avec laquelle ils ont été acquittés et résolus, et une liste avec des liens. Un nouveau résumé part chaque semaine et couvre les 7 derniers jours. Laissez **Envoyer le premier rapport à** vide, et le premier part à 09:00 au début de la semaine, du jour ou du mois suivant ; le formulaire indique quand.

Un résumé suit l'horloge de son **Fuseau horaire**, qui est d'abord le vôtre. Il y garde son heure toute l'année : un résumé réglé sur 09:00 à Berlin part toujours à 09:00, heure de Berlin, après le changement d'heure, et les dates de son message sont aussi celles de Berlin. Via l'API, envoyez `timezone` sous la forme d'un nom de fuseau horaire IANA, par exemple `Europe/Berlin`. Un résumé créé sans fuseau horaire prend celui du profil de son créateur, ou UTC lorsqu'une clé d'API le crée.

## Accès réseau pour les déploiements auto-hébergés

Pour les connexions sortantes, les rappels entrants et les déploiements privés, consultez la section sur l’accès réseau du [Intégration Microsoft Teams](/docs/self-hosted/microsoft-teams-integration).
