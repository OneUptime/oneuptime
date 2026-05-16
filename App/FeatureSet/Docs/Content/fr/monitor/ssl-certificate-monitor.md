# Moniteur de certificat SSL

La surveillance des certificats SSL vous permet de surveiller la validité et l'expiration des certificats SSL/TLS de vos sites web et services. OneUptime vérifie périodiquement vos certificats et vous alerte avant leur expiration ou si des problèmes sont détectés.

## Vue d'ensemble

Les moniteurs de certificats SSL se connectent à vos points d'accès HTTPS et inspectent le certificat SSL/TLS. Cela vous permet de :

- Surveiller les dates d'expiration des certificats
- Détecter les certificats expirés ou sur le point d'expirer
- Identifier les certificats auto-signés
- Vérifier la validité des certificats
- Prévenir les pannes de service causées par des certificats expirés

## Création d'un moniteur de certificat SSL

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Certificat SSL** comme type de moniteur
4. Entrez l'URL du point d'accès HTTPS à vérifier
5. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### URL

Entrez l'URL HTTPS complète du point d'accès dont vous souhaitez surveiller le certificat SSL (ex. : `https://example.com` ou `https://example.com:8443`).

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand le statut de votre certificat est considéré comme en ligne, dégradé ou hors ligne en fonction de :

### Types de vérifications disponibles

| Type de vérification | Description |
|----------------------|-------------|
| En ligne | Si le serveur est accessible |
| Certificat valide | Si le certificat est valide (non expiré, non auto-signé) |
| Certificat auto-signé | Si le certificat est auto-signé |
| Certificat expiré | Si le certificat a expiré |
| Certificat non valide | Si le certificat est invalide |
| Expire en heures | Nombre d'heures avant l'expiration du certificat |
| Expire en jours | Nombre de jours avant l'expiration du certificat |
| Délai d'attente de la requête | Si la connexion a expiré |

### Types de filtres

Pour **En ligne**, **Certificat valide**, **Certificat auto-signé**, **Certificat expiré**, **Certificat non valide** et **Délai d'attente de la requête** :

- **Vrai** — La condition est vraie
- **Faux** — La condition est fausse

Pour **Expire en heures** et **Expire en jours** :

- **Supérieur à** — L'expiration est à plus du nombre spécifié
- **Inférieur à** — L'expiration est à moins du nombre spécifié
- **Supérieur ou égal à** — L'expiration est à au moins le nombre spécifié
- **Inférieur ou égal à** — L'expiration est à au plus le nombre spécifié
- **Égal à** — L'expiration correspond exactement
- **Différent de** — L'expiration ne correspond pas

### Exemples de critères

#### Marquer comme dégradé si le certificat expire dans 30 jours

- **Vérifier sur** : Expire en jours
- **Type de filtre** : Inférieur à
- **Valeur** : 30

#### Marquer comme hors ligne si le certificat est expiré

- **Vérifier sur** : Certificat expiré
- **Type de filtre** : Vrai

#### Alerter si le certificat est auto-signé

- **Vérifier sur** : Certificat auto-signé
- **Type de filtre** : Vrai

#### Marquer comme hors ligne si le certificat est invalide

- **Vérifier sur** : Certificat non valide
- **Type de filtre** : Vrai

## Meilleures pratiques

1. **Définir plusieurs seuils** — Utilisez le statut dégradé à 30 jours et hors ligne à 7 jours avant l'expiration pour vous donner le temps de renouveler
2. **Surveiller tous les points d'accès** — Si vous avez plusieurs domaines ou sous-domaines, créez un moniteur pour chacun
3. **Inclure les ports non standard** — N'oubliez pas les services exécutant HTTPS sur des ports non standard
4. **Surveiller après le renouvellement** — Après avoir renouvelé un certificat, vérifiez que le moniteur confirme sa validité
