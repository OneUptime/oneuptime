# Moniteur de port

La surveillance des ports vous permet de surveiller la disponibilité de ports TCP ou UDP spécifiques sur un hôte. OneUptime tente périodiquement de se connecter au port spécifié et vérifie s'il est ouvert et réactif.

## Vue d'ensemble

Les moniteurs de ports testent si un port réseau spécifique accepte des connexions. Cela vous permet de :

- Surveiller la disponibilité des services sur des ports spécifiques
- Suivre les temps de réponse des ports
- Vérifier que des services comme les bases de données, les serveurs de messagerie et les serveurs d'applications fonctionnent
- Détecter les pannes de service avant qu'elles n'impactent les utilisateurs

## Création d'un moniteur de port

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Port** comme type de moniteur
4. Entrez le nom d'hôte ou l'adresse IP et le numéro de port
5. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### Nom d'hôte ou adresse IP

Entrez le nom d'hôte ou l'adresse IP de l'hôte cible (ex. : `example.com` ou `192.168.1.1`).

### Port

Entrez le numéro de port à surveiller (1–65535). Exemples courants :

| Port | Service |
|------|---------|
| 22 | SSH |
| 25 | SMTP |
| 80 | HTTP |
| 443 | HTTPS |
| 3306 | MySQL |
| 5432 | PostgreSQL |
| 6379 | Redis |
| 27017 | MongoDB |

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand votre port est considéré comme en ligne, dégradé ou hors ligne en fonction de :

### Types de vérifications disponibles

| Type de vérification | Description |
|----------------------|-------------|
| En ligne | Si le port est ouvert et accepte des connexions |
| Temps de réponse (en ms) | Temps pour établir une connexion en millisecondes |
| Délai d'attente de la requête | Si la tentative de connexion a expiré |

### Types de filtres

Pour **En ligne** et **Délai d'attente de la requête** :

- **Vrai** — La condition est vraie
- **Faux** — La condition est fausse

Pour **Temps de réponse** :

- **Supérieur à** — Le temps de réponse dépasse un seuil
- **Inférieur à** — Le temps de réponse est en dessous d'un seuil
- **Supérieur ou égal à** — Le temps de réponse est au-dessus ou égal à un seuil
- **Inférieur ou égal à** — Le temps de réponse est en dessous ou égal à un seuil
- **Égal à** — Le temps de réponse correspond exactement
- **Différent de** — Le temps de réponse ne correspond pas
- **Évaluer dans le temps** — Évaluer en utilisant l'agrégation (Moyenne, Somme, Maximum, Minimum, Toutes les valeurs, N'importe quelle valeur) sur une fenêtre temporelle

### Exemples de critères

#### Marquer comme hors ligne si le port est fermé

- **Vérifier sur** : En ligne
- **Type de filtre** : Faux

#### Alerter si le temps de connexion dépasse 500ms

- **Vérifier sur** : Temps de réponse (en ms)
- **Type de filtre** : Supérieur à
- **Valeur** : 500

#### Marquer comme dégradé si la connexion est lente

- **Vérifier sur** : Temps de réponse (en ms)
- **Type de filtre** : Supérieur à
- **Valeur** : 200
