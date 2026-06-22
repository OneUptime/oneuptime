# Création dynamique de modèles d'incidents et d'alertes

Vous pouvez utiliser la même syntaxe d'espace réservé `{{variable}}` que celle utilisée par les expressions JavaScript dans les critères de moniteur pour remplir dynamiquement le titre, la description et les notes de remédiation des incidents et des alertes lorsqu'ils sont créés automatiquement à partir des critères de moniteur.

## Types de moniteurs pris en charge et variables

Les types de moniteurs suivants prennent en charge la création dynamique de modèles avec leurs variables respectives :

- **Moniteurs de sites Web et API** : données de réponse, en-têtes, codes de statut, temps d'exécution
- **Moniteurs de requêtes entrantes** : données de requête, en-têtes, méthodes, temps d'exécution
- **Moniteurs Ping** : statut de connectivité, temps de réponse, causes d'échec
- **Moniteurs de ports** : connectivité des ports, temps de réponse, statut de délai d'attente
- **Moniteurs IP** : accessibilité des IP, temps de ping, informations d'échec
- **Moniteurs de certificats SSL** : détails du certificat, statut de validation, informations d'expiration
- **Moniteurs de serveurs/VM** : métriques système (CPU, mémoire, disque), processus, nom d'hôte
- **Moniteurs synthétiques** : résultats d'exécution de scripts, captures d'écran, détails du navigateur
- **Moniteurs de code JavaScript personnalisé** : résultats d'exécution, temps d'exécution, messages d'erreur
- **Moniteurs SNMP** : statut du périphérique, temps de réponse, valeurs OID

> **Remarque** : Les moniteurs de journaux, traces et métriques ne prennent pas actuellement en charge la création de modèles d'incidents/alertes car ils utilisent des mécanismes de déclenchement différents.

## Types de moniteurs pris en charge et variables

### Moniteurs de sites Web et API

| Variable             | Description                                                                               | Type                 |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------- |
| `responseBody`       | L'objet corps de la réponse. Si HTML/XML, c'est une chaîne. Si JSON, c'est un objet JSON. | `string` ou `JSON`   |
| `responseHeaders`    | L'objet en-têtes de la réponse (clés en minuscules).                                      | `Dictionary<string>` |
| `responseStatusCode` | Le code de statut HTTP de la réponse.                                                     | `number`             |
| `responseTimeInMs`   | Le temps de réponse en millisecondes.                                                     | `number`             |
| `isOnline`           | Si le moniteur est considéré comme en ligne.                                              | `boolean`            |

### Moniteurs de requêtes entrantes

| Variable                    | Description                                                    | Type                 |
| --------------------------- | -------------------------------------------------------------- | -------------------- |
| `requestBody`               | L'objet corps de la requête.                                   | `string` ou `JSON`   |
| `requestHeaders`            | L'objet en-têtes de la requête (clés en minuscules).           | `Dictionary<string>` |
| `requestMethod`             | La méthode HTTP de la requête entrante (GET, POST, etc.).      | `string`             |
| `incomingRequestReceivedAt` | La date et l'heure auxquelles la requête entrante a été reçue. | `Date`               |

### Moniteurs Ping

| Variable           | Description                                     | Type      |
| ------------------ | ----------------------------------------------- | --------- |
| `isOnline`         | Si la cible ping est considérée comme en ligne. | `boolean` |
| `responseTimeInMs` | Le temps de réponse ping en millisecondes.      | `number`  |
| `failureCause`     | La raison de l'échec si le ping a échoué.       | `string`  |
| `isTimeout`        | Si la requête ping a expiré.                    | `boolean` |

### Moniteurs de ports

| Variable           | Description                                               | Type      |
| ------------------ | --------------------------------------------------------- | --------- |
| `isOnline`         | Si le port est considéré comme en ligne/accessible.       | `boolean` |
| `responseTimeInMs` | Le temps de réponse de la connexion en millisecondes.     | `number`  |
| `failureCause`     | La raison de l'échec si la vérification du port a échoué. | `string`  |
| `isTimeout`        | Si la connexion au port a expiré.                         | `boolean` |

### Moniteurs IP

| Variable           | Description                                          | Type      |
| ------------------ | ---------------------------------------------------- | --------- |
| `isOnline`         | Si l'adresse IP est considérée comme en ligne.       | `boolean` |
| `responseTimeInMs` | Le temps de réponse ping en millisecondes.           | `number`  |
| `failureCause`     | La raison de l'échec si la vérification IP a échoué. | `string`  |
| `isTimeout`        | Si la requête ping IP a expiré.                      | `boolean` |

### Moniteurs de certificats SSL

| Variable             | Description                                           | Type      |
| -------------------- | ----------------------------------------------------- | --------- |
| `isOnline`           | Si la vérification du certificat SSL a réussi.        | `boolean` |
| `isSelfSigned`       | Si le certificat SSL est auto-signé.                  | `boolean` |
| `createdAt`          | La date de création du certificat SSL.                | `Date`    |
| `expiresAt`          | La date d'expiration du certificat SSL.               | `Date`    |
| `commonName`         | Le nom commun (CN) du certificat.                     | `string`  |
| `organizationalUnit` | L'unité organisationnelle (OU) du certificat.         | `string`  |
| `organization`       | L'organisation (O) du certificat.                     | `string`  |
| `locality`           | La localité (L) du certificat.                        | `string`  |
| `state`              | L'état/province (ST) du certificat.                   | `string`  |
| `country`            | Le pays (C) du certificat.                            | `string`  |
| `serialNumber`       | Le numéro de série du certificat.                     | `string`  |
| `fingerprint`        | L'empreinte SHA-1 du certificat.                      | `string`  |
| `fingerprint256`     | L'empreinte SHA-256 du certificat.                    | `string`  |
| `failureCause`       | La raison de l'échec si la vérification SSL a échoué. | `string`  |

### Moniteurs de serveurs/VM

| Variable                     | Description                                                                  | Type            |
| ---------------------------- | ---------------------------------------------------------------------------- | --------------- |
| `hostname`                   | Le nom d'hôte du serveur surveillé.                                          | `string`        |
| `requestReceivedAt`          | La date et l'heure auxquelles la requête du moniteur de serveur a été reçue. | `Date`          |
| `cpuUsagePercent`            | Le pourcentage d'utilisation CPU.                                            | `number`        |
| `cpuCores`                   | Le nombre de cœurs CPU.                                                      | `number`        |
| `memoryUsagePercent`         | Le pourcentage d'utilisation de la mémoire.                                  | `number`        |
| `memoryFreePercent`          | Le pourcentage de mémoire libre.                                             | `number`        |
| `memoryTotalBytes`           | La mémoire totale en octets.                                                 | `number`        |
| `diskMetrics`                | Tableau des métriques de disque pour tous les disques montés.                | `Array<Object>` |
| `diskMetrics[].diskPath`     | Le chemin du point de montage du disque.                                     | `string`        |
| `diskMetrics[].usagePercent` | Le pourcentage d'utilisation du disque pour ce point de montage.             | `number`        |
| `diskMetrics[].freePercent`  | Le pourcentage d'espace libre du disque pour ce point de montage.            | `number`        |
| `diskMetrics[].totalBytes`   | L'espace disque total en octets pour ce point de montage.                    | `number`        |
| `processes`                  | Tableau des processus en cours d'exécution sur le serveur.                   | `Array<Object>` |
| `processes[].pid`            | L'identifiant du processus.                                                  | `number`        |
| `processes[].name`           | Le nom du processus.                                                         | `string`        |
| `processes[].command`        | La commande utilisée pour démarrer le processus.                             | `string`        |
| `failureCause`               | La raison de l'échec si la vérification du serveur a échoué.                 | `string`        |

### Moniteurs synthétiques

Les moniteurs synthétiques exécutent le même script sur plusieurs navigateurs (Chromium, Firefox, Webkit) et tailles d'écran (mobile, tablette, bureau), produisant une réponse par configuration. Chaque exécution est exposée via le tableau `syntheticResponses` — accédez à une exécution spécifique par index (`{{syntheticResponses[0].browserType}}`) ou itérez avec `{{#each syntheticResponses}}`.

| Variable                                 | Description                                                                                                     | Type                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `failureCause`                           | La raison de l'échec si la vérification synthétique a échoué.                                                   | `string`                                |
| `syntheticResponses`                     | Tableau contenant une entrée par combinaison navigateur/taille d'écran contre laquelle le script a été exécuté. | `Array<Object>`                         |
| `syntheticResponses[].executionTimeInMs` | Temps d'exécution en millisecondes pour cette exécution.                                                        | `number`                                |
| `syntheticResponses[].result`            | Le résultat retourné par cette exécution.                                                                       | `string`, `number`, `boolean` ou `JSON` |
| `syntheticResponses[].scriptError`       | Toute erreur survenue lors de cette exécution.                                                                  | `string`                                |
| `syntheticResponses[].logMessages`       | Messages de journalisation générés lors de cette exécution.                                                     | `Array<string>`                         |
| `syntheticResponses[].screenshots`       | Captures d'écran prises lors de cette exécution.                                                                | `Object`                                |
| `syntheticResponses[].browserType`       | Navigateur utilisé pour cette exécution.                                                                        | `string`                                |
| `syntheticResponses[].screenSizeType`    | Taille d'écran utilisée pour cette exécution.                                                                   | `string`                                |

### Moniteurs de code JavaScript personnalisé

| Variable            | Description                                                              | Type                                    |
| ------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| `executionTimeInMs` | Le temps nécessaire pour exécuter le code personnalisé en millisecondes. | `number`                                |
| `result`            | Le résultat retourné par le code personnalisé.                           | `string`, `number`, `boolean` ou `JSON` |
| `scriptError`       | Toute erreur survenue lors de l'exécution du code.                       | `string`                                |
| `logMessages`       | Tableau des messages de journalisation générés lors de l'exécution.      | `Array<string>`                         |

### Moniteurs SNMP

| Variable               | Description                                                    | Type                 |
| ---------------------- | -------------------------------------------------------------- | -------------------- |
| `isOnline`             | Si le périphérique SNMP est en ligne et répond.                | `boolean`            |
| `responseTimeInMs`     | Le temps de réponse de la requête SNMP en millisecondes.       | `number`             |
| `failureCause`         | La raison de l'échec si la requête SNMP a échoué.              | `string`             |
| `isTimeout`            | Si la requête SNMP a expiré.                                   | `boolean`            |
| `oidResponses`         | Tableau d'objets de réponse OID avec oid, nom, valeur et type. | `Array<Object>`      |
| `oidResponses[].oid`   | L'OID qui a été interrogé.                                     | `string`             |
| `oidResponses[].name`  | Le nom convivial de l'OID (si fourni).                         | `string`             |
| `oidResponses[].value` | La valeur retournée par l'OID.                                 | `string` ou `number` |
| `oidResponses[].type`  | Le type de données SNMP de la valeur.                          | `string`             |
| `{{OID_NAME}}`         | Accès direct à la valeur OID par nom (ex. : `{{sysUpTime}}`).  | `string` ou `number` |

## Utilisation de base

Dans le formulaire d'incident/alerte à l'intérieur d'une instance de critère de moniteur, vous pouvez écrire :

```
L'API a retourné {{responseStatusCode}} en {{responseTimeInMs}}ms
```

Si le code de statut de réponse du moniteur est `502` et le temps est `842`, le titre stocké devient :

```
L'API a retourné 502 en 842ms
```

L'accès JSON imbriqué fonctionne de la même manière que les expressions JavaScript :

```
ID du problème : {{responseBody.error.id}}
Message : {{responseBody.error.message}}
```

L'indexation des tableaux est prise en charge :

```
Premier utilisateur : {{responseBody.users[0].name}}
```

Si un chemin n'existe pas, il se résout en une chaîne vide par défaut.

## Utilisation avancée

### Accès aux éléments de tableau

```
Utilisation du premier disque : {{diskMetrics[0].usagePercent}}%
Dernier processus : {{processes[-1].name}}
```

### Accès aux objets imbriqués

```
Message d'erreur : {{responseBody.error.details.message}}
Emplacement du serveur : {{sslCertificate.locality}} {{sslCertificate.country}}
```

### Itération sur les tableaux avec `{{#each}}`

Vous pouvez itérer sur des tableaux en utilisant la syntaxe de bloc `{{#each chemin}}...{{/each}}`. Cela est utile lorsque les données contiennent une liste d'éléments et que vous souhaitez inclure chacun d'eux dans la description de votre incident ou de votre alerte.

**Syntaxe :**

```
{{#each tableauChemin}}
  ...corps utilisant {{propriété}} de chaque élément...
{{/each}}
```

Dans le corps de la boucle :

- `{{nomDePropriété}}` se résout relativement à l'élément de tableau courant
- L'accès par notation point `{{propriété.imbriquée}}` fonctionne sur l'élément courant
- `{{@index}}` se résout vers l'index à base zéro de l'itération courante
- `{{this}}` se résout vers la valeur de l'élément courant (utile pour les tableaux de chaînes/nombres)
- Les variables non trouvées sur l'élément courant reviennent à la carte de stockage parente

**Exemple — Requête entrante avec tableau d'alertes (ex. : webhooks Grafana) :**

Si le corps de votre requête entrante ressemble à :

```json
{
  "status": "firing",
  "alerts": [
    { "status": "firing", "labels": { "label": "Coralpay" } },
    { "status": "firing", "labels": { "label": "capitecpay" } },
    { "status": "resolved", "labels": { "label": "capricorn" } }
  ]
}
```

Vous pouvez écrire un modèle comme :

```
Étiquettes d'alertes :
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

Ce qui produit :

```
Étiquettes d'alertes :
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**Exemple — Métriques de disque du serveur :**

```
Utilisation des disques :
{{#each diskMetrics}}
- {{diskPath}} : {{usagePercent}}% utilisé
{{/each}}
```

**Exemple — Utilisation de `{{@index}}` :**

```
Processus :
{{#each processes}}
{{@index}}. {{name}} (PID : {{pid}})
{{/each}}
```

**Exemple — Tableau primitif avec `{{this}}` :**

```
Messages de journalisation :
{{#each logMessages}}
- {{this}}
{{/each}}
```

**Exemple — Boucles imbriquées :**

Vous pouvez imbriquer des blocs `{{#each}}` pour les tableaux multi-niveaux :

```
{{#each requestBody.groups}}
Groupe : {{name}}
{{#each members}}
  - {{id}} : {{role}}
{{/each}}
{{/each}}
```

> **Remarque** : Si le chemin ne se résout pas en tableau, le bloc entier `{{#each}}...{{/each}}` est supprimé de la sortie. Les tableaux vides ne produisent aucune sortie pour le bloc.

## Exemples

### Titre d'incident du moniteur de site Web/API

```
Latence élevée : {{responseTimeInMs}}ms (> seuil)
```

### Description d'incident du moniteur de site Web/API

```
### Erreur API
Statut : **{{responseStatusCode}}**
Latence : **{{responseTimeInMs}}ms**
Extrait du corps : `{{responseBody.error.message}}`
```

### Titre d'alerte de requête entrante

```
Mauvaise requête entrante : méthode={{requestMethod}} auth={{requestHeaders.authorization}}
```

### Titre d'alerte de certificat SSL

```
Certificat SSL expirant : {{commonName}} expire le {{expiresAt}}
```

### Description d'alerte du moniteur de serveur

```
### Alerte serveur : {{hostname}}
Utilisation CPU : **{{cpuUsagePercent}}%**
Utilisation mémoire : **{{memoryUsagePercent}}%**
Utilisation du premier disque : **{{diskMetrics[0].usagePercent}}%**
Dernière vérification : {{requestReceivedAt}}
```

### Titre d'alerte du moniteur Ping

```
Échec du ping pour la cible : {{failureCause}} ({{responseTimeInMs}}ms)
```

### Description d'alerte du moniteur de port

```
Problème de connectivité du port
Statut du port cible : {{isOnline}}
Temps de réponse : {{responseTimeInMs}}ms
Cause de l'échec : {{failureCause}}
```

### Alerte du moniteur synthétique

Accéder à une exécution navigateur/taille d'écran spécifique par index :

```
Première exécution : {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Résultat : {{syntheticResponses[0].result}} en {{syntheticResponses[0].executionTimeInMs}}ms
```

Itérer sur chaque combinaison navigateur/taille d'écran avec `{{#each}}` :

```
### Résultats du moniteur synthétique
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}** : {{result}} en {{executionTimeInMs}}ms
  - Erreur de script : {{scriptError}}
  - Premier journal : {{logMessages[0]}}
{{/each}}
```

### Alerte du moniteur de code personnalisé

```
Exécution du code personnalisé : {{executionTimeInMs}}ms
Sortie du journal : {{logMessages[0]}}
```

### Titre d'alerte du moniteur SNMP

```
Périphérique SNMP hors ligne : {{failureCause}} ({{responseTimeInMs}}ms)
```

### Description d'alerte du moniteur SNMP

```
### Alerte du périphérique SNMP
Statut : **{{isOnline}}**
Temps de réponse : **{{responseTimeInMs}}ms**
Temps de fonctionnement du système : {{sysUpTime}}
Nom du système : {{sysName}}
Première valeur OID : {{oidResponses[0].value}}
```

### Requête entrante avec boucle de tableau (webhook Grafana)

Titre :

```
[{{requestBody.status}}] {{requestBody.receiver}}
```

Description :

```
### Alertes de {{requestBody.receiver}}

{{#each requestBody.alerts}}
**Alerte {{@index}}** : {{labels.alertname}}
- Étiquette : {{labels.label}}
- Statut : {{status}}
- Valeurs : {{valueString}}
- Source : {{generatorURL}}
{{/each}}
```

### Moniteur de serveur avec boucle de disques

Description :

```
### Alerte serveur : {{hostname}}
Utilisation CPU : **{{cpuUsagePercent}}%**
Utilisation mémoire : **{{memoryUsagePercent}}%**

**Utilisation des disques :**
{{#each diskMetrics}}
- {{diskPath}} : {{usagePercent}}% utilisé ({{freePercent}}% libre)
{{/each}}

**Processus en cours d'exécution :**
{{#each processes}}
- [{{pid}}] {{name}} : {{command}}
{{/each}}
```

### Moniteur SNMP avec boucle OID

Description :

```
### Statut du périphérique SNMP
En ligne : {{isOnline}}
Réponse : {{responseTimeInMs}}ms

**Valeurs OID :**
{{#each oidResponses}}
- {{name}} ({{oid}}) : {{value}}
{{/each}}
```
