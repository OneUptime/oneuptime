# Déployer OneUptime gratuitement avec Docker Compose

Si vous préférez héberger OneUptime sur votre propre serveur, vous pouvez utiliser Docker Compose pour déployer une instance mono-serveur de OneUptime sur Debian, Ubuntu ou RHEL. Cette option vous donne plus de contrôle et de personnalisation sur votre instance, mais elle nécessite également plus de compétences techniques et de ressources pour le déploiement et la maintenance.

#### Choisir la configuration système requise
Selon votre utilisation et votre budget, vous pouvez choisir parmi différentes configurations système pour votre serveur. Pour des performances optimales, nous suggérons d'utiliser OneUptime avec :

- **Configuration système recommandée**
  - 16 Go de RAM
  - 8 cœurs
  - 400 Go de disque
  - Ubuntu 22.04
  - Docker et Docker Compose installés
- **Configuration minimale / Homelab**
  - Si vous souhaitez exécuter OneUptime pour un usage personnel ou expérimental dans un environnement domestique (certains de nos utilisateurs l'ont même installé sur RaspberryPi), vous pouvez utiliser la configuration homelab :
    - 8 Go de RAM
    - 4 cœurs
    - 20 Go de disque
    - Docker et Docker Compose installés


#### Prérequis pour le déploiement mono-serveur

Tutoriel d'installation : [https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

Avant de commencer le processus de déploiement, assurez-vous d'avoir :

- Un serveur exécutant Debian, Ubuntu ou un dérivé RHEL
- Docker et Docker Compose installés sur votre serveur

Pour installer OneUptime :

```
# Cloner ce dépôt uniquement avec la branche release et accéder au répertoire.
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copier config.example.env vers config.env
cp config.example.env config.env

# IMPORTANT : Modifiez le fichier config.env. Assurez-vous d'avoir des secrets aléatoires.

npm start
```

Si vous n'aimez pas utiliser npm ou ne l'avez pas installé, exécutez plutôt ceci :

```
# Lire les variables d'environnement depuis le fichier config.env et exécuter docker compose up.
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# Utilisez sudo si vous avez des problèmes de permission lors de la liaison de ports.
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```


### Accès à OneUptime

OneUptime devrait fonctionner à l'adresse : http://localhost. Vous devez créer un nouveau compte pour votre instance pour commencer à l'utiliser.

### Configuration des certificats TLS/SSL

OneUptime **ne prend pas en charge** la configuration des certificats SSL/TLS. Vous devez configurer les certificats SSL/TLS vous-même.

Si vous avez besoin d'utiliser des certificats SSL/TLS, suivez ces étapes :

1. Utilisez un proxy inverse comme Nginx ou Caddy.
2. Utilisez Let's Encrypt pour provisionner les certificats.
3. Pointez le proxy inverse vers le serveur OneUptime.
4. Mettez à jour les paramètres suivants :
   - Définissez la variable d'environnement `HTTP_PROTOCOL` sur `https`.
   - Changez la variable d'environnement `HOST` vers le nom de domaine du serveur où le proxy inverse est hébergé.

## Liste de contrôle pour la mise en production

Idéalement, ne déployez pas OneUptime en production avec docker-compose. Nous recommandons fortement d'utiliser Kubernetes. Il existe un chart Helm disponible pour OneUptime [ici](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

Si vous souhaitez tout de même déployer OneUptime en production avec docker-compose, veuillez considérer les points suivants :

- **SSL/TLS** : Configurez des certificats SSL/TLS. OneUptime ne prend pas en charge la configuration des certificats SSL/TLS. Vous devez les configurer vous-même. Veuillez consulter ci-dessus.
- **Secrets** : Assurez-vous d'avoir des secrets aléatoires dans votre fichier `config.env`. Il y a des secrets par défaut dans ce fichier. Veuillez les remplacer par des chaînes longues et aléatoires.
- **Sauvegardes** : Sauvegardez régulièrement vos bases de données (Clickhouse, Postgres). Redis est utilisé comme cache, est sans état et peut être ignoré en toute sécurité.
- **Mises à jour** : Veuillez mettre à jour régulièrement OneUptime. Nous publions des mises à jour chaque jour. Nous vous recommandons de mettre à jour le logiciel au moins une fois par semaine si vous l'exécutez en production.

### Mise à jour de OneUptime

Pour mettre à jour :

```
git checkout release # Assurez-vous d'être sur la branche release.
git pull
npm run update
```

### Points à considérer

- Dans notre configuration Docker, nous utilisons un pilote de journalisation local. OneUptime, en particulier dans les conteneurs de sonde et d'ingestion, génère une quantité substantielle de journaux. Pour éviter que votre stockage ne soit plein, il est crucial de limiter le stockage de journalisation dans Docker. Pour des instructions détaillées sur la façon de procéder, veuillez consulter la documentation officielle de Docker [ici](https://docs.docker.com/config/containers/logging/local/).


### Désinstallation de OneUptime

Pour désinstaller OneUptime, exécutez la commande suivante :

```
npm run down
```

Cela arrêtera et supprimera tous les conteneurs, réseaux et volumes créés par OneUptime. Cela ne supprimera pas le fichier `config.env` ni le dépôt cloné.
