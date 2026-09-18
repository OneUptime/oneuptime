# Moniteur IP

La surveillance IP vous permet de surveiller la disponibilité et la réactivité de toute adresse IPv4 ou IPv6. OneUptime teste périodiquement la connectivité vers l'adresse IP cible et signale son statut.

## Vue d'ensemble

Les moniteurs IP vérifient qu'une adresse IP spécifique est accessible et réactive. Cela vous permet de :

- Surveiller la disponibilité des adresses IPv4 et IPv6
- Suivre les temps de réponse et la latence
- Détecter les problèmes de connectivité réseau
- Vérifier que les points d'accès d'infrastructure sont accessibles

## Création d'un moniteur IP

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **IP** comme type de moniteur
4. Entrez l'adresse IP que vous souhaitez surveiller
5. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### Adresse IP

Entrez l'adresse IPv4 ou IPv6 que vous souhaitez surveiller (ex. : `192.168.1.1` ou `2001:db8::1`). La valeur doit être un format d'adresse IP valide.

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand votre adresse IP est considérée comme en ligne, dégradée ou hors ligne en fonction de :

### Types de vérifications disponibles

| Type de vérification          | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| En ligne                      | Si l'adresse IP est accessible                              |
| Temps de réponse (en ms)      | Temps de réponse en millisecondes                           |
| Perte de paquets (en %)       | Pourcentage de requêtes ICMP echo restées sans réponse      |
| Gigue (en ms)                 | Écart-type des temps d'aller-retour sur les paquets envoyés |
| Délai d'attente de la requête | Si la requête a expiré                                      |

### Types de filtres

Pour **En ligne** et **Délai d'attente de la requête** :

- **Vrai** — La condition est vraie
- **Faux** — La condition est fausse

Pour **Temps de réponse**, **Perte de paquets** et **Gigue** :

- **Supérieur à** — Le temps de réponse dépasse un seuil
- **Inférieur à** — Le temps de réponse est en dessous d'un seuil
- **Supérieur ou égal à** — Le temps de réponse est au-dessus ou égal à un seuil
- **Inférieur ou égal à** — Le temps de réponse est en dessous ou égal à un seuil

**Évaluer ce critère sur une période** est une case à cocher du formulaire de critères, et non une condition de filtre. Activez-la pour comparer une agrégation — choisie sous **Évaluer** (Moyenne, Somme, Maximum, Minimum, Toutes les valeurs, N'importe quelle valeur) sur la fenêtre définie par **Sur les dernières (en minutes)** — au lieu de la valeur du dernier contrôle.

### Exemples de critères

#### Marquer comme hors ligne si l'IP est inaccessible

- **Vérifier sur** : En ligne
- **Type de filtre** : Faux

#### Alerter si la latence dépasse 100ms

- **Vérifier sur** : Temps de réponse (en ms)
- **Type de filtre** : Supérieur à
- **Valeur** : 100
