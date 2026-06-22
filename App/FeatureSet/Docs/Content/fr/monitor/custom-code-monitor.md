# Moniteur de code personnalisé

Le moniteur de code personnalisé vous permet d'écrire des scripts personnalisés pour surveiller vos applications. Vous pouvez utiliser cette fonctionnalité pour surveiller vos applications d'une manière qui n'est pas possible avec les moniteurs existants. Par exemple, vous pouvez avoir des requêtes API en plusieurs étapes.

#### Exemple

L'exemple suivant montre comment utiliser un moniteur de code personnalisé :

```javascript
// You can use axios module.

await axios.get("https://api.example.com/");

// Axios Documentation here: https://axios-http.com/docs/intro

return {
  data: "Hello World", // return any data you like here.
};
```

### Utilisation des secrets de moniteur

#### Ajouter un secret

Pour ajouter un secret, accédez au Tableau de bord OneUptime -> Paramètres du projet -> Secrets de moniteur -> Créer un secret de moniteur.

![Créer un secret](/docs/static/images/CreateMonitorSecret.png)

Vous pouvez sélectionner quels moniteurs ont accès au secret. Dans ce cas, nous avons ajouté le secret `ApiKey` et sélectionné des moniteurs pour y avoir accès.

**Remarque** : Les secrets sont chiffrés et stockés en toute sécurité. Si vous perdez le secret, vous devrez en créer un nouveau. Vous ne pouvez pas afficher ou mettre à jour le secret après sa sauvegarde.

#### Utiliser un secret

Pour utiliser les secrets de moniteur dans le script, vous pouvez utiliser l'objet `monitorSecrets` dans le contexte du script. Vous pouvez l'utiliser pour accéder aux secrets que vous avez ajoutés au moniteur.

```javascript
// if your secret is of type string then you need to wrap it in quotes
let stringSecret = '{{monitorSecrets.StringSecret}}';

// if your secret is of type number or boolean then you can use it directly
let numberSecret = {{monitorSecrets.NumberSecret}};

// if your secret is of type boolean then you can use it directly
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// you can even console log to see if the secrets is being fetched correctly
console.log(stringSecret);
```

### Métriques personnalisées

Vous pouvez capturer des métriques personnalisées depuis votre script en utilisant la fonction `oneuptime.captureMetric()`. Ces métriques sont stockées dans OneUptime et peuvent être représentées sur des tableaux de bord à l'aide de l'Explorateur de métriques.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (chaîne, requis) : Le nom de la métrique (par ex. `"api.response.time"`). Il sera stocké avec le préfixe `custom.monitor.` automatiquement.
- `value` (nombre, requis) : La valeur numérique de la métrique.
- `attributes` (objet, facultatif) : Paires clé-valeur pour le contexte supplémentaire.

#### Exemple

```javascript
const response = await axios.get("https://api.example.com/health");

// Capture a simple metric
oneuptime.captureMetric("api.response.time", response.data.latency);

// Capture a metric with attributes
oneuptime.captureMetric("api.queue.depth", response.data.queueDepth, {
  region: "us-east-1",
  environment: "production",
});

return {
  data: response.data,
};
```

Une fois capturées, ces métriques apparaissent dans l'Explorateur de métriques sous des noms comme `custom.monitor.api.response.time`. Vous pouvez les ajouter aux graphiques du tableau de bord, configurer des alertes et filtrer par moniteur, sonde ou tout attribut personnalisé que vous avez fourni.

**Limites :**

- Maximum de 100 métriques par exécution de script.
- Les noms de métriques sont limités à 200 caractères.
- Les valeurs doivent être numériques.

### Modules disponibles dans le script

- `axios` : Vous pouvez utiliser ce module pour effectuer des requêtes HTTP. C'est un client HTTP basé sur les promesses pour le navigateur et Node.js.
- `crypto` : Vous pouvez utiliser ce module pour effectuer des opérations cryptographiques. C'est un module Node.js intégré qui fournit des fonctionnalités cryptographiques.
- `console.log` : Vous pouvez utiliser ce module pour journaliser des données dans la console. Ceci est utile à des fins de débogage.
- `oneuptime.captureMetric` : Vous pouvez l'utiliser pour capturer des métriques personnalisées depuis votre script. Voir la section Métriques personnalisées ci-dessus.
- `http` : Vous pouvez utiliser ce module pour effectuer des requêtes HTTP. C'est un module Node.js intégré.
- `https` : Vous pouvez utiliser ce module pour effectuer des requêtes HTTPS. C'est un module Node.js intégré.

### Points à considérer

- Vous pouvez utiliser `console.log` pour journaliser les données dans la console. Celles-ci seront disponibles dans la section journaux du moniteur (Sondes > Afficher les journaux).
- Vous pouvez retourner des données depuis le script en utilisant l'instruction `return`.
- C'est un script JavaScript, vous pouvez donc utiliser toutes les fonctionnalités JavaScript dans le script.
- Le délai d'attente du script est de 2 minutes. Si le script prend plus de 2 minutes, il sera interrompu.
