# FAQ et Dépannage

Questions fréquemment posées et solutions pour les applications mobiles et de bureau OneUptime (PWA).

## FAQ général

### Qu'est-ce qu'une Progressive Web App (PWA) ?

Une Progressive Web App est une application web qui utilise les technologies web modernes pour offrir des expériences similaires à celles des applications natives. Les PWA peuvent être installées directement depuis les navigateurs sans passer par les boutiques d'applications, fonctionnent hors ligne, envoient des notifications push et s'intègrent au système d'exploitation de votre appareil.

### Pourquoi OneUptime n'utilise-t-il pas les boutiques d'applications traditionnelles ?

OneUptime utilise la technologie PWA car elle offre plusieurs avantages :
- **Mises à jour instantanées** : Pas d'attente pour l'approbation des boutiques d'applications ni de mises à jour manuelles
- **Multiplateforme** : Un seul code base fonctionne sur tous les appareils
- **Aucune limite de taille de téléchargement** : Fonctionnalités complètes sans restrictions de taille
- **Distribution directe** : Installez directement depuis votre instance OneUptime
- **Toujours à jour** : Les utilisateurs ont toujours la dernière version
- **Sécurité** : Mêmes avantages de sécurité que les applications web


### Combien d'espace de stockage utilise la PWA OneUptime ?

- **Installation initiale** : 10-20 Mo
- **Croissance du cache** : 50-100 Mo avec une utilisation régulière
- **Cache maximum** : Généralement limité à 200 Mo par les navigateurs
- **Nettoyage automatique** : Les navigateurs gèrent automatiquement le stockage

### La PWA OneUptime prend-elle en charge les notifications push ?

Oui, la PWA OneUptime prend en charge les notifications push enrichies :
- **Alertes d'incident** : Notifications d'incident en temps réel
- **Mises à jour de statut** : Alertes de changement de statut des moniteurs
- **Déclencheurs personnalisés** : Configurez des règles de notification
- **Contenu enrichi** : Images, actions et informations détaillées
- **Mises à jour des badges** : Nombre de messages non lus sur l'icône de l'application

## FAQ sur l'installation

### Pourquoi ne vois-je pas le bouton « Installer » ?

Raisons courantes et solutions :
1. **Compatibilité du navigateur** : Utilisez Chrome, Edge ou Safari
2. **HTTPS requis** : Assurez-vous que l'instance OneUptime utilise HTTPS
3. **Exigences PWA** : Le serveur doit satisfaire les exigences du manifeste PWA
4. **Problèmes de cache** : Videz le cache du navigateur et rechargez
5. **Déjà installé** : L'application est peut-être déjà installée
6. **Temps d'attente** : Certains navigateurs ont besoin de 30+ secondes sur la page

### Puis-je installer sur plusieurs appareils ?

Oui ! Vous pouvez installer la PWA OneUptime sur :
- Un nombre illimité d'appareils par utilisateur
- Plusieurs navigateurs sur le même appareil
- Différents systèmes d'exploitation
- Des appareils partagés/familiaux (avec des comptes séparés)

### Comment mettre à jour l'application installée ?

La PWA OneUptime se met à jour automatiquement :
- **Mises à jour automatiques** : L'application se met à jour lorsque vous la visitez en ligne
- **Mises à jour en arrière-plan** : Les mises à jour se téléchargent en arrière-plan
- **Disponibilité immédiate** : Les nouvelles fonctionnalités sont disponibles instantanément
- **Aucune action requise** : Contrairement aux applications de boutique, aucune mise à jour manuelle n'est nécessaire

### Puis-je personnaliser le nom de l'application lors de l'installation ?

Oui, lors de l'installation, vous pouvez :
- Modifier le nom de l'application (par défaut : « OneUptime »)
- Ajouter le nom de votre organisation
- Utiliser une convention de nommage personnalisée
- Modifier l'étiquette de l'icône (selon la plateforme)

### Comment désinstaller la PWA OneUptime ?

La désinstallation varie selon la plateforme :

**Android :**
- Appui long sur l'icône → Désinstaller
- Paramètres → Applications → OneUptime → Désinstaller

**iOS :**
- Appui long sur l'icône → Supprimer l'application → Supprimer l'application

**Windows :**
- Paramètres → Applications → OneUptime → Désinstaller
- Clic droit sur l'élément du menu Démarrer → Désinstaller

**macOS :**
- Faire glisser du dossier Applications vers la corbeille
- Clic droit sur l'icône du Dock → Supprimer

**Linux :**
- Supprimer du lanceur d'applications
- Supprimer le fichier .desktop


## FAQ sur les notifications

### Pourquoi ne reçois-je pas les notifications ?

Problèmes de notification courants et solutions :

**Vérifier les permissions :**
```
1. Permissions de notification du navigateur activées
2. Permissions de notification du système d'exploitation
3. Paramètres de notification OneUptime configurés
4. Mode Ne pas déranger désactivé
```

**Spécifique à la plateforme :**
- **Android** : Vérifiez les paramètres d'optimisation de la batterie
- **iOS** : Vérifiez les paramètres de notification dans l'application Paramètres
- **Windows** : Vérifiez les paramètres Assistance à la concentration
- **macOS** : Vérifiez les permissions du centre de notifications
- **Linux** : Vérifiez l'état du démon de notification

### Puis-je personnaliser les sons de notification ?

Options de personnalisation des notifications :
- **Sons système** : Utilisez les paramètres de son de notification du système d'exploitation
- **Paramètres du navigateur** : Configurez dans les préférences de notification du navigateur
- **Paramètres OneUptime** : Définissez les préférences de notification dans le tableau de bord
- **Niveaux de priorité** : Configurez différents sons pour les niveaux de gravité

### Comment désactiver temporairement les notifications ?

Désactivation temporaire des notifications :
- **Ne pas déranger** : Activez le mode DND du système
- **Paramètres du navigateur** : Désactivez temporairement les notifications du site
- **Tableau de bord OneUptime** : Mettez en pause les notifications dans les paramètres
- **Modes de concentration** : Utilisez les modes de concentration/concentration du système d'exploitation

## FAQ sur la sécurité

### La PWA OneUptime est-elle sécurisée ?

Fonctionnalités et considérations de sécurité :
- **Chiffrement HTTPS** : Toutes les données transmises en toute sécurité
- **Politique de même origine** : Les restrictions de sécurité du navigateur s'appliquent
- **Environnement sandbox** : S'exécute dans le sandbox de sécurité du navigateur
- **Mises à jour régulières** : Correctifs de sécurité appliqués automatiquement
- **Pas d'accès root** : Accès système limité par rapport aux applications natives


*Remarque : Les données sensibles sont chiffrées et respectent les normes de sécurité des navigateurs.*

### Puis-je utiliser la PWA OneUptime sur des réseaux d'entreprise ?

Considérations pour les réseaux d'entreprise :
- **Règles de pare-feu** : Assurez l'accès HTTPS (port 443)
- **Configuration du proxy** : Configurez les paramètres de proxy du navigateur
- **Confiance des certificats** : Installez les certificats d'entreprise si nécessaire
- **Accès VPN** : Utilisez un VPN pour l'accès à distance
- **Politiques de sécurité** : Respectez les exigences de sécurité informatique

## Dépannage

### Problèmes d'installation

**Problème** : Le bouton d'installation n'apparaît pas
```
Solutions :
1. Attendez 30+ secondes sur la page OneUptime
2. Actualisez la page et attendez à nouveau
3. Videz le cache et les cookies du navigateur
4. Essayez un autre navigateur (Chrome/Edge recommandé)
5. Vérifiez la connexion HTTPS (vérifiez l'icône du cadenas)
6. Vérifiez si déjà installé
```

**Problème** : L'installation échoue ou plante
```
Solutions :
1. Assurez-vous d'avoir suffisamment d'espace de stockage (100 Mo+)
2. Fermez les autres onglets et applications du navigateur
3. Mettez à jour le navigateur vers la dernière version
4. Désactivez temporairement les extensions du navigateur
5. Essayez l'installation en mode privé/incognito
6. Redémarrez le navigateur et réessayez
```

**Problème** : L'application s'installe mais n'apparaît pas
```
Solutions :
1. Vérifiez tous les emplacements du lanceur d'applications
2. Recherchez « OneUptime » dans la recherche de l'appareil
3. Regardez dans la section de gestion des applications du navigateur
4. Attendez 1-2 minutes pour que le système se rafraîchisse
5. Redémarrez l'appareil et vérifiez à nouveau
```

**Problème** : L'application plante fréquemment
```
Solutions :
1. Mettez à jour le navigateur vers la dernière version
2. Effacez toutes les données du navigateur pour OneUptime
3. Désactivez les extensions du navigateur
4. Vérifiez l'espace de stockage disponible
5. Redémarrez le système d'exploitation
6. Réinstallez la PWA OneUptime
```

**Problème** : Les notifications push ne fonctionnent pas
```
Solutions :
1. Vérifiez les permissions de notification dans le navigateur
2. Vérifiez les paramètres de notification système
3. Testez avec une notification simple d'abord
4. Effacez les données de notification et accordez à nouveau les permissions
5. Vérifiez les paramètres Ne pas déranger/Mode de concentration
6. Vérifiez la configuration des notifications OneUptime
```

**Problème** : L'application ne synchronise pas les dernières données
```
Solutions :
1. Tirez vers le bas pour actualiser (mobile)
2. Appuyez sur Ctrl+F5 (Windows/Linux) ou Cmd+R (Mac)
3. Fermez et rouvrez l'application
4. Effacez le cache de l'application et rechargez
5. Vérifiez la connectivité réseau
```

### Problèmes spécifiques à la plateforme

**Problèmes Android :**
```
Problème : L'application n'apparaît pas dans le tiroir d'applications
Solution : Vérifiez la section « Récemment ajoutés », recherchez dans le tiroir

Problème : Notifications retardées
Solution : Désactivez l'optimisation de la batterie pour l'application du navigateur

Problème : L'application plante au démarrage
Solution : Effacez les données de Chrome, redémarrez l'appareil
```

**Problèmes iOS :**
```
Problème : Impossible d'ajouter à l'écran d'accueil
Solution : Utilisez Safari, assurez-vous d'être sous iOS 11.3+

Problème : Icône de l'application manquante
Solution : Vérifiez toutes les pages de l'écran d'accueil et la bibliothèque d'applications

Problème : Face ID ne fonctionne pas
Solution : Activez Face ID pour Safari dans les paramètres
```

**Problèmes Windows :**
```
Problème : L'application n'apparaît pas dans le menu Démarrer
Solution : Recherchez le nom de l'application, vérifiez la liste des applications installées

Problème : Notifications non affichées
Solution : Vérifiez les paramètres de notification Windows, activez pour le navigateur

Problème : Problèmes de dimensionnement des fenêtres
Solution : Redimensionnez manuellement, l'application mémorisera les dimensions
```

**Problèmes macOS :**
```
Problème : Impossible d'installer via Safari
Solution : Mettez à jour vers macOS Sonoma+, utilisez Fichier → Ajouter au Dock

Problème : L'application n'est pas dans le dossier Applications
Solution : Vérifiez Launchpad, utilisez la recherche Spotlight

Problème : Notifications non fonctionnelles
Solution : Vérifiez Préférences système → Notifications
```

**Problèmes Linux :**
```
Problème : Option d'installation PWA manquante
Solution : Utilisez Chrome/Chromium, assurez-vous de la prise en charge de l'environnement de bureau

Problème : Icône non visible dans le lanceur
Solution : Mettez à jour la base de données du bureau, vérifiez le fichier .desktop

Problème : Notifications audio non fonctionnelles
Solution : Vérifiez PulseAudio, vérifiez les permissions audio du navigateur
```

### Messages d'erreur

**« Ce site ne peut pas être installé »**
```
Causes :
- L'instance OneUptime ne satisfait pas les exigences PWA
- Manifeste d'application web manquant ou invalide
- HTTPS non correctement configuré
- Le navigateur ne prend pas en charge l'installation PWA

Solutions :
- Contactez l'administrateur pour vérifier la configuration PWA
- Essayez un autre navigateur
- Vérifiez la console du navigateur pour les erreurs détaillées
```
