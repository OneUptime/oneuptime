# Guide d'installation Linux

Installez OneUptime comme application de bureau sur les distributions Linux pour une surveillance et une gestion des incidents complètes.

## Méthodes d'installation

### Méthode 1 : Google Chrome/Chromium (Recommandée)

Chrome et Chromium offrent la meilleure expérience PWA Linux avec une intégration native au bureau.

#### Étapes d'installation PWA :
1. **Ouvrir OneUptime dans Chrome/Chromium**
   - Lancez votre navigateur
   - Accédez à l'URL de votre instance OneUptime
   - Connectez-vous à votre compte OneUptime
   - Attendez le chargement complet de la page

2. **Installer la PWA**
   - Recherchez l'**icône d'installation** (⊞) dans la barre d'adresse
   - Cliquez sur **« Installer OneUptime »**
   - Ou utilisez le **menu Chrome** (⋮) → **Plus d'outils** → **Créer un raccourci**

3. **Options d'installation**
   - Cochez **« Ouvrir comme fenêtre »** pour une expérience d'application native
   - Personnalisez le nom de l'application si souhaité
   - Choisissez de créer un raccourci sur le bureau
   - Cliquez sur **« Installer »** ou **« Créer »**

4. **Lancer l'application**
   - Trouvez OneUptime dans le lanceur d'applications
   - Ou utilisez le raccourci sur le bureau
   - L'application s'ouvre dans une fenêtre dédiée

### Méthode 2 : Firefox

Firefox prend en charge l'installation PWA sur Linux avec une intégration de bureau basique.

1. **Installation PWA** :
   - Ouvrez OneUptime dans Firefox
   - Recherchez la bannière ou l'invite d'installation
   - Cliquez sur **« Installer »** lorsque disponible
   - Remarque : Intégration de bureau limitée par rapport à Chrome

### Méthode 3 : Microsoft Edge

Edge est disponible sur Linux et offre une bonne prise en charge PWA.

1. **Installer la PWA** : Suivez les mêmes étapes que la méthode Chrome


## Mises à jour et maintenance

### Mises à jour automatiques
La PWA OneUptime se met à jour automatiquement :
- Les mises à jour s'appliquent lorsque le navigateur actualise l'application
- Les mises à jour de sécurité critiques sont déployées immédiatement
- Aucune intervention manuelle n'est requise


## Désinstallation


### Suppression spécifique au navigateur
```bash
# Gestion PWA Chrome
google-chrome chrome://apps/

# Supprimer toutes les données de navigateur liées à OneUptime
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```

## Mises à jour et maintenance

### Mises à jour automatiques
La PWA OneUptime se met à jour automatiquement :
- Les mises à jour s'appliquent lorsque le navigateur actualise l'application
- Les mises à jour de sécurité critiques sont déployées immédiatement
- Aucune intervention manuelle n'est requise
