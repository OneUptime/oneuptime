# Guide d'installation iOS

Installez OneUptime comme application native sur votre iPhone ou iPad pour une surveillance transparente en déplacement.

## Méthodes d'installation

### Méthode 1 : Safari (Recommandée)

Safari offre la meilleure expérience PWA sur les appareils iOS.

1. **Ouvrir OneUptime dans Safari**
   - Lancez Safari sur votre appareil iOS
   - Accédez à l'URL de votre instance OneUptime
   - Attendez le chargement complet de la page
   - Assurez-vous d'être connecté à votre compte OneUptime

2. **Accéder au menu Partager**
   - Appuyez sur le **bouton Partager** (carré avec flèche pointant vers le haut) dans la barre d'outils inférieure
   - Faites défiler les options de partage pour trouver « Ajouter à l'écran d'accueil »

3. **Ajouter à l'écran d'accueil**
   - Appuyez sur **« Ajouter à l'écran d'accueil »**
   - Personnalisez le nom de l'application (par défaut : « OneUptime »)
   - Appuyez sur **« Ajouter »** dans le coin supérieur droit

4. **Lancer l'application**
   - Trouvez l'icône OneUptime sur votre écran d'accueil
   - Appuyez pour lancer en mode application plein écran

### Méthode 2 : Navigateur Chrome

Chrome fonctionne bien, mais Safari est recommandé pour la meilleure expérience PWA iOS.

1. **Ouvrir OneUptime dans Chrome**
   - Lancez le navigateur Chrome
   - Accédez à votre instance OneUptime
   - Autorisez le chargement complet de la page

2. **Ajouter à l'écran d'accueil**
   - Appuyez sur le **menu à trois points** (plus d'options)
   - Sélectionnez **« Ajouter à l'écran d'accueil »**
   - Personnalisez le nom de l'application si souhaité
   - Appuyez sur **« Ajouter »**

### Méthode 3 : Autres navigateurs

Firefox, Edge et d'autres navigateurs prennent en charge l'installation PWA de base :

1. **Ouvrir OneUptime**
   - Lancez votre navigateur préféré
   - Accédez à l'URL OneUptime
   - Attendez le chargement complet de la page

2. **Rechercher l'option d'installation**
   - Vérifiez le menu du navigateur pour « Ajouter à l'écran d'accueil » ou « Installer »
   - Suivez les invites d'installation spécifiques au navigateur

### Options de personnalisation

### Icône et nom de l'application
- **Nom personnalisé** : Modifiez lors de l'installation ou ultérieurement
- **Placement de l'icône** : Organisez dans des dossiers ou des pages spécifiques de l'écran d'accueil
- **Notifications de badge** : Affiche le nombre d'incidents non lus

### Configuration des notifications
1. **Activer les notifications**
   - Lorsque vous y êtes invité, appuyez sur **« Autoriser »** pour les notifications
   - Ou accédez à Paramètres → Notifications → OneUptime
   - Activez tous les types de notifications pour une surveillance complète

2. **Personnaliser les styles d'alerte**
   - **Écran verrouillé** : Affiche les alertes d'incident sur l'appareil verrouillé
   - **Style de bannière** : Choisissez des bannières temporaires ou persistantes
   - **Sons** : Personnalisez les sons de notification et les vibrations
   - **Alertes critiques** : Activez pour les incidents de haute priorité (nécessite une permission)

## Dépannage

### Problèmes d'installation

**« Ajouter à l'écran d'accueil » non visible :**
```
Solutions :
1. Assurez-vous d'utiliser Safari (meilleure compatibilité)
2. Actualisez la page et attendez 30 secondes
3. Vérifiez que vous êtes sur la bonne URL OneUptime
4. Vérifiez la connexion HTTPS (regardez l'icône du cadenas)
5. Videz le cache Safari : Paramètres → Safari → Effacer l'historique et les données de sites
```

**L'installation est terminée mais aucune icône n'apparaît :**
```
Solutions :
1. Vérifiez toutes les pages de l'écran d'accueil
2. Regardez dans la Bibliothèque d'applications (faites glisser à gauche au-delà de la dernière page)
3. Utilisez la recherche Spotlight pour trouver « OneUptime »
4. Redémarrez l'appareil et vérifiez à nouveau
5. Réinstallez si nécessaire
```

**L'application plante au lancement :**
```
Solutions :
1. Forcez la fermeture et rouvrez l'application
2. Redémarrez votre appareil iOS
3. Effacez le cache Safari et réinstallez
4. Assurez-vous que la version iOS est 11.3 ou supérieure
5. Libérez de l'espace de stockage sur l'appareil
```

### Problèmes de notification

**Vous ne recevez pas les notifications push :**
```
Vérifiez ces paramètres :
1. Paramètres → Notifications → OneUptime → Autoriser les notifications
2. Paramètres → Temps d'écran → Contenu et restrictions → Applications autorisées
3. Paramètres Ne pas déranger
4. Vérifiez les paramètres de notification dans le tableau de bord OneUptime
5. Déconnectez-vous et reconnectez-vous à OneUptime
```

**Notifications retardées ou manquées :**
```
Solutions :
1. Gardez l'application en cours d'exécution en arrière-plan (ne la forcez pas à se fermer)
2. Désactivez le mode économie d'énergie pendant la surveillance critique
3. Vérifiez l'actualisation en arrière-plan : Paramètres → Général → Actualisation des applications en arrière-plan
4. Assurez-vous d'avoir suffisamment d'espace de stockage disponible
```

## Désinstallation

### Supprimer de l'écran d'accueil
1. **Appui long** sur l'icône de l'application OneUptime
2. Appuyez sur **« Supprimer l'application »**
3. Sélectionnez **« Supprimer l'application »**
4. Confirmez la suppression

### Méthode alternative
1. Accédez à **Paramètres → Général → Stockage iPhone**
2. Trouvez **OneUptime** dans la liste des applications
3. Appuyez sur **« Supprimer l'application »**
4. Confirmez la suppression

## Mises à jour et maintenance

### Mises à jour automatiques
- La PWA OneUptime se met à jour automatiquement lorsqu'elle est en ligne
- Aucune mise à jour de l'App Store requise
- Nouvelles fonctionnalités disponibles immédiatement après le déploiement du serveur
- Mises à jour de sécurité critiques appliquées instantanément

## Installation spécifique à l'iPad

### Expérience iPad améliorée
1. **Interface plus grande** : Mises en page optimisées pour les tailles d'écran iPad
2. **Multi-fenêtres** : Exécutez plusieurs fenêtres OneUptime simultanément
3. **Raccourcis clavier** : Prise en charge complète des claviers externes
4. **Glisser-déposer** : Déplacez des données entre OneUptime et d'autres applications

### Étapes d'installation iPad
Identiques à l'installation iPhone, avec des considérations supplémentaires :
- Utilisez le mode paysage pour une vue optimale du tableau de bord
- Envisagez la configuration en vue partagée avec d'autres applications de productivité
- Configurez les raccourcis clavier pour les actions courantes

## Intégration Apple Watch

Bien que OneUptime n'ait pas d'application watchOS dédiée, vous pouvez :
- **Recevoir des notifications** : Les alertes d'incident apparaissent sur Apple Watch
- **Actions rapides** : Accusez réception des incidents depuis les notifications de la montre
- **Intégration Siri** : Demandez à Siri l'état du système (si configuré)

## Configuration avancée

### Intégration avec l'application Raccourcis
Créez des raccourcis Siri personnalisés pour OneUptime :
1. Ouvrez l'application **Raccourcis**
2. Créez un **Nouveau raccourci**
3. Ajoutez l'action **« Ouvrir l'application »**
4. Sélectionnez **OneUptime**
5. Ajoutez une phrase vocale comme « Vérifier l'état du système »

### Modes de concentration
Intégrez OneUptime avec les modes de concentration iOS :
1. **Paramètres → Concentration**
2. Sélectionnez ou créez un mode de concentration
3. **Applications → Ajouter des applications → OneUptime**
4. Configurez le comportement des notifications pour différents états de concentration

## Bonnes pratiques

### Recommandations de sécurité
1. **Vérifiez l'URL** : Installez uniquement depuis l'instance OneUptime officielle de votre organisation
2. **HTTPS uniquement** : Assurez-vous d'une connexion sécurisée (vérifiez l'icône du cadenas)
3. **Mises à jour régulières** : Maintenez iOS à jour pour les correctifs de sécurité
4. **Permissions d'application** : N'accordez que les permissions nécessaires

### Optimisation des performances
1. **Installation Wi-Fi** : Utilisez le Wi-Fi pour l'installation initiale et les mises à jour importantes
2. **Actualisation en arrière-plan** : Activez pour les notifications en temps opportun
3. **Gestion du stockage** : Maintenez un espace libre adéquat
4. **Redémarrage régulier** : Redémarrez l'application chaque semaine pour des performances optimales

### Bonnes pratiques de surveillance
1. **Notifications critiques** : Activez uniquement pour les alertes de haute priorité
2. **Plusieurs appareils** : Installez à la fois sur iPhone et iPad pour la redondance
3. **Accès de l'équipe** : Partagez le guide d'installation avec les membres de l'équipe
4. **Tests** : Testez régulièrement la livraison des notifications et la fonctionnalité hors ligne
