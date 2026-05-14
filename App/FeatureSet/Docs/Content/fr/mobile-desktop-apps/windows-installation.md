# Guide d'installation Windows

Installez OneUptime comme application de bureau sur Windows pour une surveillance et une gestion des incidents complètes.


## Méthodes d'installation

### Méthode 1 : Microsoft Edge (Recommandée)

Edge offre la meilleure intégration PWA Windows avec des fonctionnalités natives.

1. **Ouvrir OneUptime dans Edge**
   - Lancez le navigateur Microsoft Edge
   - Accédez à l'URL de votre instance OneUptime
   - Connectez-vous à votre compte OneUptime
   - Attendez le chargement complet de la page

2. **Installer l'application**
   - Recherchez l'**icône d'installation** (⊞) dans la barre d'adresse
   - Cliquez sur le bouton **« Installer OneUptime »**
   - Ou cliquez sur le **menu à trois points** → **Applications** → **Installer ce site comme application**

3. **Personnaliser l'installation**
   - **Nom de l'application** : Modifiez si souhaité (par défaut : OneUptime)
   - **Menu Démarrer** : Choisissez d'ajouter au menu Démarrer
   - **Barre des tâches** : Option d'épingler à la barre des tâches
   - **Bureau** : Créer un raccourci sur le bureau

4. **Terminer l'installation**
   - Cliquez sur **« Installer »** pour terminer
   - OneUptime s'ouvrira dans sa propre fenêtre
   - Trouvez-le dans le menu Démarrer sous les applications installées

### Méthode 2 : Google Chrome

Chrome offre une excellente prise en charge PWA avec une riche intégration au bureau.

1. **Ouvrir OneUptime dans Chrome**
   - Lancez Google Chrome
   - Accédez à votre instance OneUptime
   - Assurez-vous d'être connecté
   - Autorisez le chargement complet de la page

2. **Installer via la barre d'adresse**
   - Recherchez l'**icône d'installation** (⊞) dans la barre d'adresse
   - Cliquez sur **« Installer OneUptime »**
   - Ou utilisez le menu : **trois points** → **Plus d'outils** → **Créer un raccourci**

3. **Options d'installation**
   - Cochez **« Ouvrir comme fenêtre »** pour une expérience similaire à une application
   - Personnalisez le nom de l'application si souhaité
   - Cliquez sur **« Installer »** ou **« Créer »**

4. **Lancer l'application**
   - Trouvez OneUptime dans le menu Démarrer de Windows
   - Ou lancez depuis le raccourci sur le bureau
   - L'application s'ouvre dans une fenêtre dédiée

### Méthode 3 : Firefox

Firefox prend en charge l'installation PWA avec une intégration de bureau basique.

1. **Ouvrir OneUptime dans Firefox**
   - Lancez le navigateur Firefox
   - Accédez à l'URL OneUptime
   - Complétez le processus de connexion

2. **Installer la PWA**
   - Recherchez l'**invite d'installation** ou la bannière
   - Ou cliquez sur **menu** → **Installer**
   - Si disponible, cliquez sur **« Ajouter à l'écran d'accueil »** ou équivalent


### Configuration du démarrage
1. **Démarrage automatique** : Configurez OneUptime pour démarrer avec Windows
   - Clic droit sur la barre des tâches → Gestionnaire des tâches → Démarrage
   - Activez OneUptime si souhaité
2. **Taille par défaut** : Définissez la taille et la position de fenêtre préférées

### Paramètres de notification
1. **Notifications Windows**
   - Paramètres → Système → Notifications et actions
   - Trouvez OneUptime et configurez les préférences d'alerte
   - Activez les notifications de bannière pour les incidents

2. **Assistance à la concentration**
   - Configurez les paramètres Ne pas déranger
   - Autorisez les notifications critiques OneUptime
   - Définissez les niveaux de priorité pour les différents types d'alerte

## Dépannage

### Problèmes d'installation

**Le bouton d'installation n'apparaît pas :**
```
Solutions :
1. Assurez-vous d'utiliser Edge ou Chrome (navigateurs recommandés)
2. Vérifiez la connexion HTTPS à l'instance OneUptime
3. Videz le cache et les cookies du navigateur
4. Mettez à jour le navigateur vers la dernière version
5. Vérifiez si les exigences PWA sont satisfaites sur le serveur
6. Désactivez temporairement les extensions du navigateur
```

**L'installation échoue ou plante :**
```
Solutions :
1. Exécutez le navigateur en tant qu'administrateur
2. Vérifiez les paramètres de contrôle de compte d'utilisateur Windows (UAC)
3. Assurez-vous d'avoir suffisamment d'espace disque (minimum 100 Mo)
4. Désactivez temporairement le logiciel antivirus
5. Effacez complètement les données du navigateur
6. Redémarrez Windows et réessayez
```

**L'application n'apparaît pas dans le menu Démarrer :**
```
Solutions :
1. Recherchez « OneUptime » dans la recherche Windows
2. Vérifiez si installé sous un nom différent
3. Regardez dans la section « Récemment ajoutés »
4. Réinstallez en vous assurant que « Ajouter au menu Démarrer » est coché
5. Créez manuellement un raccourci si nécessaire
```

### Problèmes de notification

**Les notifications Windows ne fonctionnent pas :**
```
Solutions :
1. Paramètres Windows → Système → Notifications et actions
2. Activez les notifications pour OneUptime
3. Vérifiez les paramètres Assistance à la concentration
4. Assurez-vous des permissions de notification dans OneUptime
5. Testez avec une notification simple d'abord
```

## Désinstallation

### Suppression complète
1. **Méthode Paramètres Windows**
   - Paramètres → Applications → Applications et fonctionnalités
   - Recherchez « OneUptime »
   - Cliquez et sélectionnez « Désinstaller »

2. **Méthode navigateur**
   - Ouvrez Edge/Chrome
   - Accédez à edge://apps/ ou chrome://apps/
   - Trouvez OneUptime
   - Cliquez sur les options → Désinstaller

3. **Méthode menu Démarrer**
   - Clic droit sur OneUptime dans le menu Démarrer
   - Sélectionnez « Désinstaller »
   - Confirmez la suppression


## Mises à jour et maintenance

### Mises à jour automatiques
- La PWA OneUptime se met à jour automatiquement lorsqu'elle est en ligne
- Aucune intervention manuelle requise
- Les mises à jour s'appliquent immédiatement au redémarrage
- Les correctifs critiques sont déployés instantanément
