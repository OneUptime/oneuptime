# Moniteur Ping

La surveillance par ping vous permet de surveiller la disponibilité et la réactivité de tout hôte ou adresse IP. OneUptime envoie périodiquement des requêtes ping à votre cible et vérifie si elle répond correctement.

## Vue d'ensemble

Les moniteurs ping testent la connectivité réseau de base en envoyant des requêtes ping ICMP à un hôte. Cela vous permet de :

- Surveiller la disponibilité et le temps de fonctionnement de l'hôte
- Suivre la latence réseau et les temps de réponse
- Détecter les problèmes de connectivité avant qu'ils n'impactent vos services
- Vérifier que les serveurs et les périphériques réseau sont accessibles

## Création d'un moniteur Ping

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Ping** comme type de moniteur
4. Entrez le nom d'hôte ou l'adresse IP que vous souhaitez surveiller
5. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### Nom d'hôte ou adresse IP pour le ping

Entrez le nom d'hôte ou l'adresse IP de la cible que vous souhaitez surveiller (ex. : `example.com` ou `192.168.1.1`). Les noms d'hôte et les adresses IP sont tous deux acceptés.

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand votre hôte est considéré comme en ligne, dégradé ou hors ligne en fonction de :

### Types de vérifications disponibles

| Type de vérification | Description |
|----------------------|-------------|
| En ligne | Si l'hôte répond aux requêtes ping |
| Temps de réponse (en ms) | Temps d'aller-retour de la requête ping en millisecondes |
| Délai d'attente de la requête | Si la requête ping a expiré |

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

#### Marquer comme hors ligne si l'hôte est inaccessible

- **Vérifier sur** : En ligne
- **Type de filtre** : Faux

#### Alerter si le temps de réponse dépasse 200ms

- **Vérifier sur** : Temps de réponse (en ms)
- **Type de filtre** : Supérieur à
- **Valeur** : 200
