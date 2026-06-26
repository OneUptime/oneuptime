# Moniteur de serveur / VM

La surveillance des serveurs et des VM vous permet de surveiller la santé et les performances de vos serveurs, machines virtuelles et autres infrastructures en installant un agent léger qui rapporte les métriques système à OneUptime.

## Vue d'ensemble

Les moniteurs de serveur utilisent un agent d'infrastructure installé sur vos serveurs pour collecter et rapporter les métriques système. Cela vous permet de :

- Surveiller la disponibilité et le temps de fonctionnement du serveur
- Suivre l'utilisation du CPU, de la mémoire et du disque
- Surveiller les processus en cours d'exécution
- Définir des alertes basées sur les seuils d'utilisation des ressources
- Détecter les problèmes d'infrastructure avant qu'ils n'impactent vos services

## Création d'un moniteur de serveur

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Serveur / VM** comme type de moniteur
4. Une **Clé secrète** sera générée pour ce moniteur — vous en aurez besoin pour configurer l'agent
5. Suivez les instructions d'installation pour configurer l'agent sur votre serveur

## Installation de l'agent d'infrastructure

L'agent d'infrastructure OneUptime est un démon léger basé sur Go qui collecte les métriques système et les envoie à OneUptime toutes les 30 secondes. Il prend en charge Linux, macOS et Windows.

### Linux / macOS

```bash
# Installer l'agent
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# Configurer l'agent
sudo oneuptime-infrastructure-agent configure --secret-key=VOTRE_CLÉ_SECRÈTE --oneuptime-url=https://oneuptime.com

# Démarrer l'agent
sudo oneuptime-infrastructure-agent start
```

Remplacez `VOTRE_CLÉ_SECRÈTE` par la clé secrète affichée dans les paramètres de votre moniteur, et `https://oneuptime.com` par l'URL de votre instance OneUptime si elle est auto-hébergée.

### Windows

1. Téléchargez le dernier agent depuis [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest)
   - `oneuptime-infrastructure-agent_windows_amd64.zip` pour les systèmes x64
   - `oneuptime-infrastructure-agent_windows_arm64.zip` pour les systèmes ARM64
2. Extrayez le fichier zip
3. Ouvrez l'invite de commandes en tant qu'administrateur et exécutez :

```bash
# Configurer l'agent
oneuptime-infrastructure-agent configure --secret-key=VOTRE_CLÉ_SECRÈTE --oneuptime-url=https://oneuptime.com

# Démarrer l'agent
oneuptime-infrastructure-agent start
```

### Prise en charge du proxy

Si votre serveur se connecte à Internet via un proxy, vous pouvez configurer l'agent pour l'utiliser :

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=VOTRE_CLÉ_SECRÈTE --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Commandes de l'agent

L'agent d'infrastructure prend en charge les commandes suivantes :

| Commande    | Description                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `configure` | Configurer l'agent avec votre clé secrète et l'URL OneUptime                                              |
| `start`     | Démarrer le service de l'agent                                                                            |
| `stop`      | Arrêter le service de l'agent                                                                             |
| `restart`   | Redémarrer le service de l'agent                                                                          |
| `status`    | Afficher le statut actuel du service                                                                      |
| `logs`      | Afficher les journaux de l'agent (utilisez `-n` pour le nombre de lignes, `-f` pour suivre en temps réel) |
| `uninstall` | Désinstaller le service de l'agent                                                                        |

## Métriques collectées

L'agent collecte les métriques suivantes de votre serveur :

### CPU

- **Pourcentage d'utilisation CPU** — Utilisation globale du CPU en pourcentage
- **Cœurs CPU** — Nombre de cœurs CPU

### Mémoire

- **Mémoire totale** — Mémoire totale disponible
- **Mémoire utilisée** — Mémoire actuellement utilisée
- **Mémoire libre** — Mémoire libre disponible
- **Pourcentage d'utilisation mémoire** — Utilisation de la mémoire en pourcentage

### Disque

Pour chaque disque/volume monté :

- **Espace disque total** — Capacité totale du disque
- **Espace disque utilisé** — Espace actuellement utilisé
- **Espace disque libre** — Espace libre disponible
- **Pourcentage d'utilisation du disque** — Utilisation du disque en pourcentage
- **Chemin du disque** — Chemin de montage du disque

### Processus

- **Nom du processus** — Nom du processus en cours d'exécution
- **Identifiant du processus (PID)** — Identifiant du processus
- **Commande du processus** — Commande complète utilisée pour démarrer le processus

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand votre serveur est considéré comme en ligne, dégradé ou hors ligne.

### Types de vérifications disponibles

| Type de vérification                | Description                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| En ligne                            | Si l'agent du serveur rapporte (basé sur le signal de vie)                       |
| Pourcentage d'utilisation CPU       | Pourcentage d'utilisation CPU actuel                                             |
| Pourcentage d'utilisation mémoire   | Pourcentage d'utilisation mémoire actuel                                         |
| Pourcentage d'utilisation du disque | Pourcentage d'utilisation du disque actuel (pour un chemin de disque spécifique) |
| Nom du processus serveur            | Vérifier si un processus avec un nom spécifique est en cours d'exécution         |
| Commande du processus serveur       | Vérifier si un processus avec une commande spécifique est en cours d'exécution   |
| PID du processus serveur            | Vérifier si un processus avec un PID spécifique est en cours d'exécution         |

### Types de filtres

Pour les métriques numériques (CPU, mémoire, disque) :

- **Supérieur à** — La valeur dépasse un seuil
- **Inférieur à** — La valeur est en dessous d'un seuil
- **Supérieur ou égal à** — La valeur est au-dessus ou égale à un seuil
- **Inférieur ou égal à** — La valeur est en dessous ou égale à un seuil
- **Évaluer dans le temps** — Évaluer en utilisant l'agrégation (Moyenne, Somme, Maximum, Minimum, Toutes les valeurs, N'importe quelle valeur) sur une fenêtre temporelle

Pour les vérifications de processus :

- **En cours d'exécution** — Le processus est actuellement en cours d'exécution
- **Non en cours d'exécution** — Le processus n'est pas en cours d'exécution

### Exemples de critères

#### Marquer le serveur comme hors ligne si l'agent arrête de rapporter

- **Vérifier sur** : En ligne
- **Type de filtre** : Faux

#### Alerter quand l'utilisation CPU dépasse 90%

- **Vérifier sur** : Pourcentage d'utilisation CPU
- **Type de filtre** : Supérieur à
- **Valeur** : 90

#### Alerter quand l'utilisation du disque dépasse 85%

- **Vérifier sur** : Pourcentage d'utilisation du disque
- **Chemin du disque** : `/`
- **Type de filtre** : Supérieur à
- **Valeur** : 85

#### Alerter quand l'utilisation mémoire dépasse 80%

- **Vérifier sur** : Pourcentage d'utilisation mémoire
- **Type de filtre** : Supérieur à
- **Valeur** : 80

#### Alerter si un processus critique s'arrête

- **Vérifier sur** : Nom du processus serveur
- **Type de filtre** : Non en cours d'exécution
- **Valeur** : `nginx`

## Dépannage

### L'agent ne rapporte pas

- Vérifiez que l'agent est en cours d'exécution : `sudo oneuptime-infrastructure-agent status`
- Consultez les journaux de l'agent : `sudo oneuptime-infrastructure-agent logs -n 50`
- Confirmez que la clé secrète est correcte
- Assurez-vous que le serveur peut atteindre l'URL de votre instance OneUptime
- Vérifiez que les règles de pare-feu autorisent les connexions HTTPS sortantes

### Utilisation élevée des ressources par l'agent

L'agent est conçu pour être léger. Si vous constatez une utilisation élevée des ressources :

- Redémarrez l'agent : `sudo oneuptime-infrastructure-agent restart`
- Consultez les journaux de l'agent pour les erreurs

### Problèmes de proxy

- Vérifiez que l'URL et le port du proxy sont corrects
- Assurez-vous que le proxy autorise les connexions vers votre instance OneUptime
- Reconfigurez avec : `sudo oneuptime-infrastructure-agent configure --proxy-url=http://proxy:port --secret-key=VOTRE_CLÉ --oneuptime-url=VOTRE_URL`

## Meilleures pratiques

1. **Définir des seuils significatifs** — Configurez des critères de dégradation et de mise hors ligne qui correspondent aux plages de fonctionnement normales de votre serveur
2. **Surveiller les processus critiques** — Utilisez la surveillance des processus pour vous assurer que les services essentiels comme les serveurs web et les bases de données fonctionnent toujours
3. **Surveiller proactivement l'utilisation du disque** — Les problèmes d'espace disque peuvent provoquer des défaillances en cascade dans les applications ; définissez des alertes bien avant que les disques soient pleins
4. **Utiliser « Évaluer dans le temps »** — Pour les métriques comme le CPU qui peuvent avoir des pics brefs, utilisez l'agrégation temporelle pour éviter les fausses alertes
5. **Maintenir l'agent à jour** — Mettez périodiquement à jour l'agent d'infrastructure pour bénéficier des dernières améliorations et corrections
