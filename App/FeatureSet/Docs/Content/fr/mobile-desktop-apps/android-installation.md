# Guide d'installation Android

Installez OneUptime comme application native sur votre appareil Android pour la meilleure expérience de surveillance.

## Méthodes d'installation

### Méthode 1 : Navigateur Chrome (Recommandée)

1. **Ouvrir OneUptime dans Chrome**
   - Lancez Google Chrome sur votre appareil Android
   - Accédez à l'URL de votre instance OneUptime
   - Attendez le chargement complet de la page

2. **Invite d'installation**
   - Recherchez la bannière « Ajouter à l'écran d'accueil » en bas
   - Appuyez sur « Installer » ou « Ajouter à l'écran d'accueil »
   - Si vous ne voyez pas l'invite, appuyez sur le menu à trois points (⋮) en haut à droite

3. **Installation manuelle via le menu**
   - Appuyez sur le menu Chrome (trois points)
   - Sélectionnez « Ajouter à l'écran d'accueil » ou « Installer l'application »
   - Personnalisez le nom de l'application si souhaité
   - Appuyez sur « Ajouter » pour confirmer

4. **Lancer l'application**
   - Trouvez l'icône OneUptime sur votre écran d'accueil ou dans le tiroir d'applications
   - Appuyez pour lancer l'application en mode plein écran

### Méthode 2 : Samsung Internet

1. **Ouvrir OneUptime**
   - Lancez le navigateur Samsung Internet
   - Accédez à votre instance OneUptime
   - Attendez le chargement complet de la page

2. **Ajouter à l'écran d'accueil**
   - Appuyez sur le bouton de menu (trois lignes)
   - Sélectionnez « Ajouter la page à » → « Écran d'accueil »
   - Saisissez le nom de l'application et appuyez sur « Ajouter »

3. **Lancer**
   - Trouvez l'icône de l'application sur votre écran d'accueil
   - Appuyez pour ouvrir OneUptime en mode application

### Méthode 3 : Firefox

1. **Ouvrir OneUptime**
   - Lancez le navigateur Firefox
   - Accédez à votre URL OneUptime
   - Laissez la page se charger complètement

2. **Installer**
   - Appuyez sur le menu à trois points
   - Sélectionnez « Installer » (si disponible)
   - Ou sélectionnez « Ajouter à l'écran d'accueil »
   - Confirmez l'installation

### Options de personnalisation

### Nom de l'application
- Lors de l'installation, vous pouvez personnaliser le nom de l'application
- Par défaut : « OneUptime »
- Recommandé : Conservez « OneUptime » ou ajoutez le nom de votre entreprise

### Paramètres de notification
1. **Accorder les permissions**
   - Autorisez les notifications lorsque vous y êtes invité
   - Accédez à Paramètres → Applications → OneUptime → Notifications
   - Activez toutes les catégories de notifications pour la meilleure expérience

2. **Personnaliser les alertes**
   - Configurez quels incidents déclenchent des notifications
   - Définissez les niveaux de priorité des notifications
   - Choisissez les préférences de son et de vibration

## Dépannage

### Problèmes d'installation

**« Ajouter à l'écran d'accueil » n'apparaît pas :**
```
1. Videz le cache et les cookies du navigateur
2. Assurez-vous d'être sur HTTPS (connexion sécurisée)
3. Attendez 2-3 minutes sur la page avant de rechercher l'invite
4. Vérifiez si les exigences PWA sont satisfaites sur votre instance OneUptime
```

**L'installation échoue :**
```
1. Libérez de l'espace de stockage (il faut au moins 50 Mo)
2. Mettez à jour votre navigateur vers la dernière version
3. Redémarrez votre navigateur et réessayez
4. Essayez un autre navigateur (Chrome recommandé)
```

**L'icône de l'application n'apparaît pas :**
```
1. Vérifiez l'écran d'accueil et le tiroir d'applications
2. Regardez dans la section « Récemment ajoutés »
3. Recherchez « OneUptime » dans le tiroir d'applications
4. Réinstallez si nécessaire
```

### Problèmes de notification

**Vous ne recevez pas les notifications :**
```
1. Vérifiez les permissions de notification :
   - Paramètres → Applications → OneUptime → Permissions → Notifications
2. Assurez-vous que les notifications sont activées dans le tableau de bord OneUptime
3. Vérifiez les paramètres Ne pas déranger
4. Vérifiez que les paramètres d'optimisation de la batterie ne bloquent pas OneUptime
```

**Notifications retardées :**
```
1. Désactivez l'optimisation de la batterie pour OneUptime :
   - Paramètres → Applications → OneUptime → Batterie → Optimiser l'utilisation de la batterie
2. Autorisez l'activité en arrière-plan
3. Vérifiez les paramètres d'économiseur de données
```

## Désinstallation

### Supprimer l'application
1. **Appui long** sur l'icône OneUptime sur l'écran d'accueil
2. Sélectionnez **« Désinstaller »** ou faites glisser vers la corbeille
3. Confirmez la suppression

### Méthode alternative
1. Accédez à **Paramètres → Applications**
2. Trouvez **« OneUptime »**
3. Appuyez sur **« Désinstaller »**
4. Confirmez la suppression

## Mises à jour et maintenance

### Mises à jour automatiques
OneUptime PWA se met à jour automatiquement :
- **Mises à jour automatiques** : L'application se met à jour lorsque vous la visitez en ligne
- **Aucune mise à jour manuelle** : Contrairement aux applications du store, aucune action de l'utilisateur n'est requise
- **Mises à jour instantanées** : Les nouvelles fonctionnalités sont disponibles immédiatement
- **Retour en arrière sécurisé** : Les mauvaises mises à jour peuvent être rapidement annulées

## Configuration avancée

### Options développeur
Pour les utilisateurs avancés souhaitant inspecter le PWA :
1. Activez les options développeur sur Android
2. Connectez à un ordinateur avec ADB
3. Utilisez Chrome DevTools pour le débogage à distance

### Configuration réseau
- Configurez un VPN si vous accédez à une instance OneUptime interne
- Configurez les paramètres proxy si requis par votre organisation
- Assurez-vous que le pare-feu autorise les ressources PWA

## Bonnes pratiques

### Pour des performances optimales
1. **Premier lancement** : Toujours en ligne pour la configuration initiale
2. **Utilisation régulière** : Ouvrez l'application régulièrement pour maintenir le cache frais
3. **Gestion du stockage** : Conservez suffisamment d'espace libre
4. **Réseau** : Utilisez le Wi-Fi pour l'installation initiale et les mises à jour importantes

### Recommandations de sécurité
1. **HTTPS uniquement** : Installez uniquement depuis des instances OneUptime sécurisées
2. **URL officielles** : Vérifiez que vous installez depuis l'URL OneUptime officielle de votre organisation
3. **Permissions** : N'accordez que les permissions nécessaires
4. **Mises à jour** : Maintenez votre OS Android et vos navigateurs à jour
