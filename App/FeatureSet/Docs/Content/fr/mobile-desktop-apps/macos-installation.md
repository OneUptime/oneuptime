# Guide d'installation macOS

Installez OneUptime comme application de bureau native sur macOS pour une surveillance et une gestion des incidents transparentes.

## Méthodes d'installation

### Méthode 1 : Safari (Recommandée pour macOS)

Safari offre une excellente intégration PWA avec les fonctionnalités natives de macOS.

1. **Ouvrir OneUptime dans Safari**
   - Lancez le navigateur Safari
   - Accédez à l'URL de votre instance OneUptime
   - Connectez-vous à votre compte OneUptime
   - Attendez le chargement complet de la page

2. **Installer la PWA**
   - Cliquez sur **Fichier** dans la barre de menus
   - Sélectionnez **« Ajouter au Dock »** (macOS Sonoma+)
   - Ou recherchez l'**icône d'installation** dans la barre d'adresse
   - Alternativement : **Fichier** → **« Ajouter à l'écran d'accueil »** (macOS plus ancien)

3. **Personnaliser l'installation**
   - **Nom de l'application** : Modifiez si souhaité (par défaut : OneUptime)
   - **Dock** : Choisissez d'ajouter au Dock
   - **Launchpad** : Ajoutez au Launchpad pour un accès facile

4. **Lancer l'application**
   - Trouvez OneUptime dans le Dock, Launchpad ou le dossier Applications
   - Cliquez pour lancer dans une fenêtre dédiée
   - L'application fonctionne indépendamment du navigateur Safari

### Méthode 2 : Google Chrome

Chrome offre une robuste prise en charge PWA avec une excellente intégration au bureau.

1. **Ouvrir OneUptime dans Chrome**
   - Lancez Google Chrome
   - Accédez à votre instance OneUptime
   - Assurez-vous d'être connecté
   - Autorisez le chargement complet de la page

2. **Installer via le menu**
   - Recherchez l'**icône d'installation** (⊞) dans la barre d'adresse
   - Cliquez sur **« Installer OneUptime »**
   - Ou utilisez le **menu Chrome** → **Plus d'outils** → **Créer un raccourci**

3. **Options d'installation**
   - Cochez **« Ouvrir comme fenêtre »** pour une expérience d'application native
   - Personnalisez le nom de l'application si nécessaire
   - Cliquez sur **« Installer »** ou **« Créer »**

4. **Accéder à l'application**
   - Trouvez OneUptime dans le dossier Applications
   - Ou accédez via la recherche Spotlight
   - Épinglez au Dock pour un accès rapide

### Méthode 3 : Microsoft Edge

Edge offre une solide prise en charge PWA avec une bonne intégration macOS.

1. **Ouvrir OneUptime dans Edge**
   - Lancez Microsoft Edge
   - Accédez à l'URL OneUptime
   - Complétez le processus de connexion

2. **Installer l'application**
   - Cliquez sur le **menu à trois points** → **Applications** → **Installer ce site comme application**
   - Ou recherchez l'invite d'installation dans la barre d'adresse
   - Personnalisez le nom de l'application si souhaité
   - Cliquez sur **« Installer »**

### Options de personnalisation

### Dock et Launchpad
1. **Position dans le Dock** : Faites glisser OneUptime vers la position préférée dans le Dock
2. **Taille dans le Dock** : Redimensionnez l'icône dans les préférences du Dock
3. **Organisation Launchpad** : Créez un dossier d'applications de surveillance
4. **Notifications de badge** : Affiche le nombre d'incidents sur l'icône du Dock

### Barre de menus et notifications
1. **Centre de notifications**
   - Préférences système → Notifications → OneUptime
   - Configurez les styles d'alerte et la livraison
   - Définissez les niveaux de priorité pour les différents types d'incidents

2. **Intégration de la barre de menus**
   - Barre de menus native pour les PWA Safari
   - Éléments de menu personnalisés pour les actions fréquentes
   - Raccourcis clavier pour les tâches courantes

## Dépannage

### Problèmes d'installation

**« Ajouter au Dock » non disponible dans Safari :**
```
Solutions :
1. Assurez-vous d'être sous macOS Sonoma (14.0) ou version ultérieure
2. Mettez à jour Safari vers la dernière version
3. Essayez l'alternative : Fichier → Ajouter à l'écran d'accueil
4. Videz le cache Safari et réessayez
5. Utilisez Chrome ou Edge comme alternative
```

**La PWA ne s'installe pas ou plante :**
```
Solutions :
1. Vérifiez la compatibilité de la version macOS
2. Assurez-vous d'avoir suffisamment d'espace disque (100 Mo+)
3. Mettez à jour le navigateur vers la dernière version
4. Videz le cache et les cookies du navigateur
5. Désactivez temporairement les extensions du navigateur
6. Redémarrez le Mac et réessayez l'installation
```

**L'application n'apparaît pas dans les Applications :**
```
Solutions :
1. Vérifiez Launchpad pour l'icône OneUptime
2. Recherchez avec Spotlight (⌘+Espace)
3. Regardez dans la section de gestion PWA du navigateur
4. Réessayez l'installation avec un autre navigateur
5. Vérifiez si installé sous un nom différent
```

### Problèmes de notification

**Les notifications macOS ne fonctionnent pas :**
```
Solutions :
1. Préférences système → Notifications → OneUptime
2. Activez « Autoriser les notifications »
3. Définissez un style d'alerte approprié (bannières/alertes)
4. Vérifiez les paramètres Ne pas déranger
5. Vérifiez les paramètres de notification OneUptime
6. Accordez les permissions de notification lorsque vous y êtes invité
```

## Désinstallation

### Suppression complète
1. **Méthode du dossier Applications**
   - Ouvrez le dossier Applications
   - Trouvez OneUptime
   - Faites glisser vers la corbeille ou clic droit → Mettre à la corbeille

2. **Méthode du Dock**
   - Clic droit sur OneUptime dans le Dock
   - Sélectionnez « Options » → « Supprimer du Dock »
   - Puis supprimez du dossier Applications

3. **Gestion PWA du navigateur**
   - **Chrome** : chrome://apps/ → Trouvez OneUptime → Supprimer
   - **Edge** : edge://apps/ → Trouvez OneUptime → Désinstaller
   - **Safari** : Pas de page de gestion dédiée

### Suppression propre des données associées :

```bash
# Effacer les données PWA Safari (données générales du site web)
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# Effacer les données PWA Chrome
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# Effacer les données PWA Edge
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## Mises à jour et maintenance

### Mises à jour automatiques
- La PWA OneUptime se met à jour automatiquement lorsqu'elle est en ligne
- Aucune mise à jour de l'App Store requise
- Nouvelles fonctionnalités disponibles immédiatement
- Mises à jour critiques appliquées instantanément

### Programme de maintenance
Maintenance régulière pour des performances optimales :

**Hebdomadaire :**
- Redémarrez l'application OneUptime
- Videz le cache du navigateur si vous rencontrez des problèmes
- Vérifiez les mises à jour macOS

**Mensuel :**
- Vérifiez l'utilisation du stockage et nettoyez si nécessaire
- Mettez à jour les navigateurs s'ils ne se mettent pas à jour automatiquement
- Vérifiez que les paramètres de notification fonctionnent toujours

## Intégration avec les fonctionnalités macOS

### Intégration de l'application Raccourcis
Créez des raccourcis personnalisés pour OneUptime :
1. Ouvrez l'application **Raccourcis**
2. Créez un **Nouveau raccourci**
3. Ajoutez l'action **« Ouvrir l'application »**
4. Sélectionnez **OneUptime**
5. Ajoutez à Siri pour l'activation vocale

### Intégration Terminal
Gérez OneUptime via Terminal :

```bash
# Créer un alias pour lancer OneUptime rapidement
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# Fonction pour vérifier si OneUptime est en cours d'exécution
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## Sécurité et confidentialité

### Fonctionnalités de sécurité macOS
1. **Gatekeeper** : Assurez-vous que les installations PWA proviennent de sources fiables
2. **Protection de l'intégrité du système** : Protège les fichiers système
3. **FileVault** : Chiffrez le disque pour la protection des données
4. **Keychain** : Stockage sécurisé des identifiants

### Bonnes pratiques
1. **Mises à jour régulières** : Maintenez macOS et les navigateurs à jour
2. **Authentification forte** : Utilisez Touch ID/Face ID lorsque disponible
3. **Sécurité réseau** : Utilisez un VPN pour l'accès à la surveillance à distance
4. **Sauvegarde des données** : Les sauvegardes régulières Time Machine incluent les données PWA
5. **Révision des permissions** : Révisez régulièrement les permissions accordées
