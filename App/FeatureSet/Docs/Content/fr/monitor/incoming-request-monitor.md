# Moniteur de requêtes entrantes

Un moniteur de requêtes entrantes vous donne une URL vers laquelle d'autres systèmes envoient des requêtes HTTP. OneUptime évalue chaque requête selon vos critères et peut changer le statut du moniteur, déclarer des incidents et alerter votre rotation d'astreinte.

Il couvre deux tâches distinctes :

- **Surveillance par signal de vie** — une tâche cron, un worker ou un appareil appelle l'URL selon une planification, et OneUptime ouvre un incident lorsque les signaux cessent d'arriver.
- **Réception d'alertes d'un autre système** — Prometheus Alertmanager, Grafana, ou tout ce qui peut envoyer du JSON en POST pousse des alertes, et OneUptime transforme chacune d'elles en incident, avec escalade d'astreinte et résolution automatique à la reprise.

Les deux utilisent le même type de moniteur. Ce qui les distingue, ce sont les critères que vous configurez.

## Vue d'ensemble

Les moniteurs de requêtes entrantes fournissent une URL unique que vos services appellent. Cela vous permet de :

- Surveiller les tâches cron et les tâches planifiées
- Vérifier que les workers en arrière-plan tournent
- Surveiller des services derrière un pare-feu, inaccessibles depuis l'extérieur
- Recevoir des alertes de Prometheus Alertmanager, Grafana et d'autres systèmes d'alerting
- Suivre les signaux de vie de n'importe quel système capable de faire du HTTP

## Création d'un moniteur de requêtes entrantes

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Requête entrante** comme type de moniteur
4. Une **Clé secrète** et une URL sont générées pour ce moniteur
5. Ouvrez le moniteur et cliquez sur **Documentation** dans le menu de gauche pour copier l'URL
6. Configurez votre service pour qu'il envoie des requêtes vers cette URL
7. Configurez les critères de surveillance comme décrit ci-dessous

## L'URL de requête

Votre moniteur dispose d'une URL unique au format :

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Remplacez `https://oneuptime.com` par l'URL de votre instance OneUptime si vous l'hébergez vous-même.

Envoyez des requêtes **GET** ou **POST** vers cette URL. HEAD est accepté et traité comme GET. Les autres méthodes renvoient 404. La clé secrète dans le chemin est la seule information d'authentification — aucun en-tête ni jeton n'est requis.

> **Warning:** Toute personne connaissant cette URL peut marquer le moniteur comme sain : traitez-la comme un secret. Chaque en-tête que vous envoyez est stocké sur le moniteur et visible par quiconque peut le lire — n'envoyez pas de clés d'API ni de jetons dans les en-têtes vers cet endpoint.

OneUptime répond immédiatement par un `200` vide et traite la requête via une file d'attente. Cette réponse est écrite avant toute validation : un `200` n'est donc **pas** la confirmation que la requête a été acceptée — une mauvaise clé secrète, un moniteur supprimé et un moniteur désactivé renvoient eux aussi `200`. Consultez la chronologie du moniteur pour confirmer que les requêtes arrivent bien.

### Envoi d'un corps de requête

Si vous voulez adresser des champs à l'intérieur du corps — `{{requestBody.status}}` dans un titre d'incident, un chemin JSON dans le regroupement d'incidents, ou un critère JavaScript Expression — envoyez `Content-Type: application/json` : c'est le format que cette documentation suppose partout. Un corps `application/x-www-form-urlencoded` est également analysé, mais uniquement en champs plats de premier niveau. Tout autre type de contenu, ou aucun, n'est pas analysé et chaque référence à `requestBody` ne se résout sur rien.

Les corps jusqu'à 50 Mo sont acceptés. Ne compressez pas le corps avec `Content-Encoding: gzip` ; il est stocké non analysé et les chemins qui y mènent ne se résoudront pas.

### Envoi d'un signal de vie

#### Avec curl

```bash
# Requête GET simple
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# Requête POST avec corps personnalisé
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Depuis une tâche cron

```bash
# Ajouter au crontab pour envoyer un signal de vie toutes les 5 minutes
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### Depuis le code d'application

```javascript
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Exemple Python
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand votre service est considéré comme en ligne, dégradé ou hors ligne. Chaque filtre de critère possède un **Filter Type** (ce qu'on regarde), une **Filter Condition** (comment on le compare) et une **Value**.

### Filter Types disponibles

| Filter Type           | Vérifie                                                | Remarques                                                                                    |
| --------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Incoming Request      | Si une requête a été reçue dans une fenêtre de temps   | La seule vérification qui peut se déclencher quand rien n'arrive                             |
| Request Body          | Le corps de la requête                                 | Correspondance par sous-chaîne. Les corps d'objet sont comparés en JSON compact              |
| Request Header        | Les noms des en-têtes de la requête                    | Correspondance exacte avec un nom d'en-tête, en minuscules                                   |
| Request Header Value  | Les valeurs des en-têtes de la requête                 | Correspondance exacte avec une valeur d'en-tête, en minuscules                               |
| JavaScript Expression | Toute expression sur `requestBody` et `requestHeaders` | L'option la plus souple — voir [Expressions JavaScript](/docs/monitor/javascript-expression) |

### Filter Conditions

Chaque Filter Type propose son propre jeu de conditions.

Pour **Incoming Request** (reproduites ici avec l'orthographe du tableau de bord) :

- **Recieved In Minutes** — une requête a été reçue dans le nombre de minutes indiqué
- **Not Recieved In Minutes** — aucune requête n'a été reçue dans le nombre de minutes indiqué

Pour **Request Body**, **Request Header** et **Request Header Value** : **Contains** et **Not Contains**.

Pour **JavaScript Expression** : **Evaluates To True**.

> **Note:** Les noms et les valeurs d'en-tête sont mis en minuscules avant comparaison, et la correspondance porte sur le nom ou la valeur entière, pas sur une sous-chaîne. Écrivez `content-type`, pas `Content-Type`, et `application/json`, pas `application/JSON`. Seul **Request Body** fait une véritable correspondance par sous-chaîne.

Les corps d'objet sont comparés en JSON compact sans espaces : un filtre **Request Body** / **Contains** doit donc s'écrire `"status":"firing"` — copier `"status": "firing"` depuis une charge utile mise en forme ne correspondra jamais.

### Exemples de critères

#### Marquer comme hors ligne si aucun signal de vie en 10 minutes

- **Filter Type** : Incoming Request
- **Filter Condition** : Not Recieved In Minutes
- **Value** : 10

#### Marquer comme dégradé en fonction du contenu du corps de la requête

- **Filter Type** : Request Body
- **Filter Condition** : Contains
- **Value** : `"status":"degraded"`

> **Warning:** Un moniteur n'est réévalué en arrière-plan que si au moins un de ses critères porte sur **Incoming Request**. Un moniteur dont les critères ne vérifient que Request Body, Request Header ou une JavaScript Expression est évalué à l'arrivée d'une requête et à aucun autre moment — il ne peut donc jamais passer hors ligne de lui-même. Si vous voulez une alarme sur signal de vie manquant, il vous faut un critère **Incoming Request**.

Notez également qu'un moniteur qui n'a jamais reçu de requête est traité comme si son heure de création était la dernière requête. Un critère « Not Recieved In Minutes : 10 » sur un moniteur tout neuf se déclenche 10 minutes après sa création, même si l'émetteur n'a jamais été branché.

## Réception d'alertes d'un autre système

Alertmanager, Grafana et les outils similaires envoient en POST un document JSON décrivant une ou plusieurs alertes. Par défaut, un critère ouvre **un** incident : une charge utile portant cinq alertes produirait donc un seul incident. Le regroupement d'incidents change cela : il extrait une valeur de la charge utile et ouvre **un incident distinct par valeur distincte**, tous pouvant être ouverts en même temps.

### Activer le regroupement d'incidents

Ouvrez le critère, dépliez **Settings** et activez **Group incidents and alerts by a payload field**. Quatre champs apparaissent :

| Champ                              | Exemple                                  | Ce qu'il fait                                                                                      |
| ---------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | Le chemin dont les valeurs distinctes séparent les incidents                                       |
| Field that signals recovery        | `requestBody.alerts[*].status`           | Le chemin consulté pour décider qu'une alerte est rétablie                                         |
| Value that means recovered         | `resolved`                               | La valeur exacte qui marque le rétablissement                                                      |
| Max incidents per request          | `100` (par défaut)                       | Garde-fou pour qu'un champ à forte cardinalité ne puisse pas ouvrir un nombre illimité d'incidents |

### Syntaxe des chemins

Les chemins doivent commencer par le préfixe littéral `requestBody.`. Un chemin sans lui — `alerts[*].labels.alertname` — ne correspond à rien, en silence. L'enveloppe `{{ }}` est facultative : `requestBody.status` et `{{requestBody.status}}` se comportent de façon identique.

- `[*]` se déploie sur un tableau — un incident par valeur **distincte**. Deux éléments produisant la même valeur se fondent en un seul incident, et l'état firing/resolved de cet incident est repris du **premier** élément correspondant. **Seul le premier `[*]` d'un chemin est un joker** ; `requestBody.groups[*].alerts[*].name` ne correspond à rien.
- `[0]` et `[last]` sélectionnent un seul élément, et peuvent suivre un `[*]`.
- Les valeurs de type objet et tableau, les chaînes vides et les valeurs nulles sont ignorées. `0` et `false` sont des clés valides.

### La résolution est pilotée par les événements

Un webhook ne décrit que ce qui figure dans cette charge utile : OneUptime ne résout donc jamais un incident parce que sa clé a cessé d'apparaître. Un incident n'est résolu que lorsqu'une charge utile dit explicitement que cette clé est rétablie. Deux conditions doivent être réunies :

1. **Field that signals recovery** et **Value that means recovered** sont renseignés et correspondent à la charge utile. La comparaison est exacte et sensible à la casse — `Resolved` ne correspond pas à `resolved`.
2. L'incident du critère a **Auto Resolve Incident** activé, sous **Advanced Options** dans le formulaire d'incident. Sans cela, les événements de rétablissement correspondants sont ignorés et les incidents restent ouverts. (Il en va de même pour les alertes et **Auto Resolve Alert**.)

**Max incidents per request** plafonne l'extraction, pas seulement la création. Les clés au-delà du plafond sont également invisibles pour le rétablissement : dans une charge utile portant plus de clés distinctes que le plafond, une alerte signalant `resolved` au-delà ne fermera pas son incident.

> **Warning:** Si **Field that signals recovery** contient `[*]` mais pas **Open a separate incident for each…**, rien ne se résoudra jamais. Utilisez `[*]` dans les deux, ou dans aucun. Un chemin de rétablissement sans `[*]` est évalué sur la charge utile entière : un `status: resolved` au niveau de la charge utile résout donc toutes les clés de celle-ci — y compris les alertes dont le statut propre est encore firing.

### Nommer les incidents

La clé de regroupement est exposée aux modèles d'incident et d'alerte sous forme de variable nommée d'après le **dernier segment du chemin** :

| Chemin                                   | Variable          |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

La charge utile complète reste disponible à côté : un titre d'incident `{{alertname}}` et une description référençant `{{requestBody.commonAnnotations.summary}}` fonctionnent tous les deux. Voir [Modèles dynamiques d'incident et d'alerte](/docs/monitor/incident-alert-templating).

> **Warning:** Le nom de la variable fait partie de l'identité que OneUptime utilise pour rattacher un événement de rétablissement à un incident ouvert. Changer le chemin de regroupement pour un chemin dont le dernier segment diffère rend orphelins tous les incidents actuellement ouverts sous l'ancien chemin — ils ne peuvent plus être résolus automatiquement et doivent être fermés à la main.

Notez que `[*]` ne fonctionne **que** dans les deux champs de chemin de regroupement. Ailleurs, il ne se résout pas, et un espace réservé non résolu est affiché **littéralement** plutôt que vidé — un titre `{{requestBody.alerts[*].labels.alertname}}` s'affiche accolades comprises. Un titre `{{requestBody.alerts[0].annotations.summary}}` se résout, mais lit toujours la première alerte de la charge utile, pas celle pour laquelle cet incident a été ouvert. Préférez la variable de regroupement associée aux champs partagés `commonAnnotations` de la charge utile.

### Exemple complet

Pour une configuration Alertmanager complète, voir [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager). Pour Grafana, voir [Grafana](/docs/integrations/grafana).

## Meilleures pratiques

1. **Réglez la fenêtre de temps correctement** — Si votre tâche cron s'exécute toutes les 5 minutes, fixez le seuil « Not Recieved In Minutes » entre 10 et 15 minutes pour tolérer des retards occasionnels
2. **Incluez des données utiles** — Envoyez des informations d'état dans le corps de la requête pour pouvoir définir des critères fins
3. **Utilisez POST avec `Content-Type: application/json`** — tout ce qui lit à l'intérieur du corps en dépend
4. **Ne mélangez pas les deux usages sur un même moniteur** — un moniteur qui reçoit des alertes pilotées par événements n'a pas de cadence régulière : un critère « Not Recieved In Minutes » y oscillera. Utilisez un moniteur distinct pour le dispositif d'homme mort
5. **Surveillez le moniteur** — Assurez-vous que le service qui envoie les requêtes gère correctement les erreurs, pour que les requêtes échouées ne passent pas inaperçues

## Pour aller plus loin

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — une configuration d'alerting entrant complète
- [Grafana](/docs/integrations/grafana) — la même chose, pour l'alerting Grafana
- [Modèles dynamiques d'incident et d'alerte](/docs/monitor/incident-alert-templating) — toutes les variables disponibles dans les titres et les descriptions
- [Expressions JavaScript](/docs/monitor/javascript-expression) — syntaxe des expressions et règles de guillemets
