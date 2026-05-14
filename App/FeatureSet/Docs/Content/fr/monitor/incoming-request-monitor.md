# Moniteur de requêtes entrantes

La surveillance des requêtes entrantes (également connue sous le nom de surveillance de signal de vie) vous permet de surveiller les services en leur demandant d'envoyer des requêtes HTTP périodiques à OneUptime. Au lieu que OneUptime contacte votre service, votre service envoie un signal à OneUptime pour confirmer qu'il fonctionne.

## Vue d'ensemble

Les moniteurs de requêtes entrantes fournissent une URL webhook unique que vos services appellent selon un calendrier. Cela vous permet de :

- Surveiller les tâches cron et les tâches planifiées
- Vérifier que les workers en arrière-plan fonctionnent
- Surveiller les services derrière des pare-feux qui ne peuvent pas être atteints de l'extérieur
- Intégrer avec des outils de surveillance tiers
- Suivre les signaux de vie de tout système capable d'effectuer des requêtes HTTP

## Création d'un moniteur de requêtes entrantes

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Requête entrante** comme type de moniteur
4. Une **Clé secrète** et une URL de signal de vie seront générées pour ce moniteur
5. Configurez votre service pour envoyer des requêtes à l'URL de signal de vie
6. Configurez les critères de surveillance selon vos besoins

## URL de signal de vie

Une fois créé, votre moniteur aura une URL de signal de vie unique au format :

```
https://oneuptime.com/heartbeat/VOTRE_CLÉ_SECRÈTE
```

Votre service doit envoyer des requêtes HTTP **GET** ou **POST** à cette URL à intervalles réguliers.

### Envoi d'un signal de vie

#### Avec curl

```bash
# Requête GET simple
curl https://oneuptime.com/heartbeat/VOTRE_CLÉ_SECRÈTE

# Requête POST avec corps personnalisé
curl -X POST https://oneuptime.com/heartbeat/VOTRE_CLÉ_SECRÈTE \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Depuis une tâche cron

```bash
# Ajouter au crontab pour envoyer un signal de vie toutes les 5 minutes
*/5 * * * * curl -s https://oneuptime.com/heartbeat/VOTRE_CLÉ_SECRÈTE > /dev/null
```

#### Depuis le code d'application

```javascript
// Exemple Node.js
const https = require('https');
https.get('https://oneuptime.com/heartbeat/VOTRE_CLÉ_SECRÈTE');
```

```python
# Exemple Python
import requests
requests.get('https://oneuptime.com/heartbeat/VOTRE_CLÉ_SECRÈTE')
```

Remplacez `https://oneuptime.com` par l'URL de votre instance OneUptime si elle est auto-hébergée.

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand votre service est considéré comme en ligne, dégradé ou hors ligne en fonction de :

### Types de vérifications disponibles

| Type de vérification | Description |
|----------------------|-------------|
| Requête entrante | Si un signal de vie a été reçu dans une fenêtre temporelle |
| Corps de la requête | Contenu du corps de la requête envoyé avec le signal de vie |
| En-tête de la requête | Nom d'un en-tête de requête spécifique |
| Valeur de l'en-tête de la requête | Valeur d'un en-tête de requête spécifique |

### Types de filtres

Pour **Requête entrante** :

- **Reçu en minutes** — Un signal de vie a été reçu dans le nombre de minutes spécifié
- **Non reçu en minutes** — Aucun signal de vie n'a été reçu dans le nombre de minutes spécifié

Pour **Corps de la requête**, **En-tête de la requête** et **Valeur de l'en-tête de la requête** :

- **Contient** — La valeur contient le texte spécifié
- **Ne contient pas** — La valeur ne contient pas le texte spécifié

### Exemples de critères

#### Marquer comme hors ligne si aucun signal de vie en 10 minutes

- **Vérifier sur** : Requête entrante
- **Type de filtre** : Non reçu en minutes
- **Valeur** : 10

#### Marquer comme dégradé en fonction du contenu du corps de la requête

- **Vérifier sur** : Corps de la requête
- **Type de filtre** : Contient
- **Valeur** : `"status": "degraded"`

## Meilleures pratiques

1. **Définir la fenêtre temporelle de manière appropriée** — Si votre tâche cron s'exécute toutes les 5 minutes, définissez le seuil « Non reçu en minutes » à 10–15 minutes pour permettre les délais occasionnels
2. **Inclure des données significatives** — Envoyez des informations de statut dans le corps de la requête afin de pouvoir configurer des critères granulaires
3. **Utiliser POST pour les données enrichies** — Utilisez des requêtes POST avec des corps JSON lorsque vous avez besoin d'envoyer des informations de statut détaillées
4. **Surveiller le moniteur** — Assurez-vous que le service envoyant les signaux de vie dispose d'une gestion des erreurs appropriée afin que les requêtes de signal de vie échouées ne passent pas inaperçues
