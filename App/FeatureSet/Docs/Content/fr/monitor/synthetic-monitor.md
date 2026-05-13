# Moniteur synthétique

La surveillance synthétique est une méthode de surveillance proactive de vos applications en simulant les interactions des utilisateurs. Vous pouvez créer un moniteur synthétique pour vérifier la disponibilité et les performances de vos applications depuis différents emplacements dans le monde.

#### Exemple

L'exemple suivant montre comment utiliser un moniteur synthétique :

```javascript

// Les objets disponibles dans le contexte du script sont :

// - axios : module Axios pour effectuer des requêtes HTTP
// - page : objet Page Playwright pour interagir avec le navigateur
// - browserType : type de navigateur dans le contexte d'exécution actuel - Chromium, Firefox, Webkit
// - screenSizeType : type de taille d'écran dans le contexte d'exécution actuel - Mobile, Tablet, Desktop

// Vous pouvez utiliser ces objets pour interagir avec le navigateur et effectuer des requêtes HTTP.

await page.goto('https://playwright.dev/');

// Documentation Playwright ici : https://playwright.dev/docs/intro

// Voici quelques-unes des variables que vous pouvez utiliser dans le contexte de l'objet surveillé :

console.log(browserType) // Cela affichera le type de navigateur dans le contexte d'exécution actuel - Chromium, Firefox, Webkit

console.log(screenSizeType) // Cela affichera le type de taille d'écran dans le contexte d'exécution actuel - Mobile, Tablet, Desktop

// L'objet page Playwright appartient à ce contexte de navigateur spécifique, vous pouvez donc l'utiliser pour interagir avec le navigateur.

// Pour prendre des captures d'écran, assignez-les à l'objet `screenshots` fourni
// dans le contexte du script. Les captures d'écran capturées de cette façon sont préservées même si le
// script lève une erreur par la suite — utile pour déboguer les exécutions échouées.

screenshots['nom-capture'] = await page.screenshot(); // vous pouvez sauvegarder plusieurs captures d'écran avec des noms différents.

// lorsque vous souhaitez retourner une valeur, utilisez l'instruction return avec data comme prop.

// Pour journaliser des données, utilisez console.log
// console.log('Hello World');

// Vous pouvez accéder au contexte du navigateur via page.context() si nécessaire (par exemple, pour créer une nouvelle page ou gérer des popups).


return {
    data: 'Hello World'
};
```

### Utilisation de Playwright

Nous utilisons Playwright pour simuler les interactions des utilisateurs. Vous pouvez utiliser l'objet `page` de Playwright pour interagir avec le navigateur et effectuer des actions comme cliquer sur des boutons, remplir des formulaires et prendre des captures d'écran.

### Captures d'écran

Un objet `screenshots` prédéclaré est disponible dans le contexte du script. Assignez-y des captures d'écran à tout moment dans le script — ces captures d'écran sont préservées **même si le script lève une erreur** (y compris les échecs d'assertion, les délais d'attente ou les erreurs inattendues), vous pouvez donc voir exactement à quoi ressemblait la page lors de l'échec de l'exécution. Les captures d'écran apparaissent dans le tableau de bord OneUptime pour cette exécution de moniteur spécifique.

```javascript

// Capturez les captures d'écran via le canal secondaire `screenshots` — elles sont préservées en cas de succès et d'échec.

await page.goto('https://app.example.com/login');
screenshots['page-connexion'] = await page.screenshot();

await page.fill('#email', 'user@example.com');
await page.fill('#password', 'wrong');
await page.click('button[type=submit]');

// Si l'assertion suivante lève une erreur, la capture d'écran `page-connexion` ci-dessus est toujours préservée.
await page.waitForSelector('.dashboard', { timeout: 5000 });

screenshots['tableau-de-bord'] = await page.screenshot();

return {
    data: 'Connexion réussie'
};

```

#### Retourner des captures d'écran (héritage)

Pour des raisons de compatibilité descendante, vous pouvez également retourner des captures d'écran depuis le script dans le cadre de la valeur de retour. Les captures d'écran retournées de cette façon ne sont préservées **que** lorsque le script se termine normalement — elles sont perdues si le script lève une erreur. Préférez le modèle de canal secondaire ci-dessus lorsque vous souhaitez des preuves des échecs.

```javascript
// Modèle héritage — captures d'écran uniquement préservées lors d'un retour réussi.
const screenshots = {};
screenshots['nom-capture'] = await page.screenshot();

return {
    data: 'Hello World',
    screenshots: screenshots
};
```


### Utilisation des secrets de moniteur

#### Ajouter un secret

Pour ajouter un secret, veuillez aller dans le tableau de bord OneUptime -> Paramètres du projet -> Secrets de moniteur -> Créer un secret de moniteur.

![Créer un secret](/docs/static/images/CreateMonitorSecret.png)

Vous pouvez sélectionner quels moniteurs ont accès au secret. Dans ce cas, nous avons ajouté le secret `ApiKey` et sélectionné des moniteurs pour y avoir accès.

**Remarque importante** : Les secrets sont chiffrés et stockés de manière sécurisée. Si vous perdez le secret, vous devrez créer un nouveau secret. Vous ne pouvez pas visualiser ou mettre à jour le secret après son enregistrement.

#### Utiliser un secret

Pour utiliser les secrets de moniteur dans le script, vous pouvez utiliser l'objet `monitorSecrets` dans le contexte du script. Vous pouvez l'utiliser pour accéder aux secrets que vous avez ajoutés au moniteur.

```javascript
// si votre secret est de type string, vous devez l'entourer de guillemets
let secretString = '{{monitorSecrets.StringSecret}}';

// si votre secret est de type number ou boolean, vous pouvez l'utiliser directement
let secretNombre = {{monitorSecrets.NumberSecret}};

// si votre secret est de type boolean, vous pouvez l'utiliser directement
let secretBooleen = {{monitorSecrets.BooleanSecret}};

// vous pouvez même utiliser console.log pour vérifier si le secret est correctement récupéré
console.log(secretString); 
```

### Métriques personnalisées

Vous pouvez capturer des métriques personnalisées depuis votre script en utilisant la fonction `oneuptime.captureMetric()`. Ces métriques sont stockées dans OneUptime et peuvent être représentées graphiquement sur des tableaux de bord via le Metric Explorer.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (string, obligatoire) : Le nom de la métrique (ex. : `"dashboard.load.time"`). Il sera stocké avec le préfixe `custom.monitor.` automatiquement.
- `value` (number, obligatoire) : La valeur numérique de la métrique.
- `attributes` (object, optionnel) : Paires clé-valeur pour un contexte supplémentaire.

#### Exemple

```javascript
await page.goto('https://app.example.com');

const startTime = Date.now();
await page.waitForSelector('#dashboard-loaded');
const loadTime = Date.now() - startTime;

// Capturer le temps de chargement de la page comme métrique personnalisée
oneuptime.captureMetric('dashboard.load.time', loadTime, {
    page: 'dashboard'
});

screenshots['tableau-de-bord'] = await page.screenshot();

return {
    data: { loadTime }
};
```

Une fois capturées, ces métriques apparaissent dans le Metric Explorer sous des noms comme `custom.monitor.dashboard.load.time`. Vous pouvez les ajouter à des graphiques de tableau de bord, configurer des alertes et filtrer par moniteur, sonde, type de navigateur, taille d'écran ou tout attribut personnalisé que vous avez fourni.

**Limites :**
- Maximum 100 métriques par exécution de script.
- Les noms de métriques sont limités à 200 caractères.
- Les valeurs doivent être numériques.

### Modules disponibles dans le script
- `page` : Vous pouvez utiliser ce module pour interagir avec le navigateur. Il s'agit d'un objet Page Playwright qui vous permet d'effectuer des actions comme cliquer sur des boutons, remplir des formulaires et prendre des captures d'écran. Vous pouvez accéder au contexte du navigateur via `page.context()` si nécessaire (par exemple, pour créer une nouvelle page ou gérer des popups).
- `screenshots` : Un objet prédéclaré auquel vous assignez des captures d'écran (ex. : `screenshots['page-connexion'] = await page.screenshot()`). Les captures d'écran assignées ici sont préservées même si le script lève une erreur par la suite.
- `axios` : Vous pouvez utiliser ce module pour effectuer des requêtes HTTP. Il s'agit d'un client HTTP basé sur les promesses pour le navigateur et Node.js.
- `crypto` : Vous pouvez utiliser ce module pour effectuer des opérations cryptographiques. Il s'agit d'un module Node.js intégré qui fournit des fonctionnalités cryptographiques incluant un ensemble d'enveloppes pour les fonctions de hachage, HMAC, chiffrement, déchiffrement, signature et vérification d'OpenSSL.
- `console.log` : Vous pouvez utiliser ce module pour journaliser des données dans la console. Cela est utile à des fins de débogage.
- `oneuptime.captureMetric` : Vous pouvez l'utiliser pour capturer des métriques personnalisées depuis votre script. Voir la section Métriques personnalisées ci-dessus.
- `http` : Vous pouvez utiliser ce module pour effectuer des requêtes HTTP. Il s'agit d'un module Node.js intégré qui fournit un client et un serveur HTTP.
- `https` : Vous pouvez utiliser ce module pour effectuer des requêtes HTTPS. Il s'agit d'un module Node.js intégré qui fournit un client et un serveur HTTPS.

### Points à considérer

- L'objet `page` est l'interface principale pour interagir avec le navigateur. Il provient de la classe Page de Playwright. Vous pouvez accéder au contexte du navigateur via `page.context()` si nécessaire.
- Vous pouvez utiliser `console.log` pour journaliser les données dans la console. Cela sera disponible dans la section des journaux du moniteur.
- Vous pouvez retourner les données du script en utilisant l'instruction `return`. Assignez les captures d'écran à l'objet `screenshots` fourni pour qu'elles soient préservées même si le script lève une erreur.
- Vous pouvez utiliser les variables `browserType` et `screenSizeType` pour obtenir le type de navigateur et le type de taille d'écran dans le contexte d'exécution actuel. N'hésitez pas à les utiliser dans votre script si vous le souhaitez.
- Il s'agit d'un script JavaScript, vous pouvez donc utiliser toutes les fonctionnalités JavaScript dans le script.
- Vous pouvez utiliser le module `axios` pour effectuer des requêtes HTTP dans le script. Vous pouvez l'utiliser pour effectuer des appels API depuis le script.
- Si vous utilisez oneuptime.com, vous aurez toujours la dernière version de Playwright et des navigateurs disponibles dans le contexte du script. Si vous auto-hébergez, veuillez vous assurer de mettre à jour les sondes pour avoir la dernière version de Playwright et des navigateurs.
- Le délai d'attente pour le script est de 2 minutes. Si le script prend plus de 2 minutes, il sera arrêté.
