# Moniteur API

La surveillance API vous permet de contrôler la disponibilité, les performances et l'exactitude de vos API HTTP/REST. OneUptime envoie périodiquement des requêtes HTTP à vos points de terminaison API et évalue les réponses selon vos critères configurés.

## Aperçu

Les moniteurs API effectuent des requêtes HTTP vers vos points de terminaison et vérifient les réponses. Cela vous permet de :

- Surveiller la disponibilité et l'accessibilité des API
- Suivre les temps de réponse et les performances
- Vérifier les codes de statut HTTP et les corps de réponse
- Valider les en-têtes de réponse
- Tester différentes méthodes HTTP (GET, POST, PUT, DELETE, etc.)
- Envoyer des en-têtes et corps de requête personnalisés

## Création d'un moniteur API

1. Accédez à **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **API** comme type de moniteur
4. Saisissez l'URL de l'API et configurez les paramètres de requête
5. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### URL de l'API

Saisissez l'URL complète du point de terminaison API que vous souhaitez surveiller (par ex., `https://api.example.com/v1/health`).

### Espaces réservés d'URL dynamiques

Lors de la surveillance d'API derrière des CDN ou des proxys de mise en cache, le moniteur peut recevoir une réponse mise en cache au lieu d'atteindre le serveur d'origine. Pour contourner le cache à chaque vérification, vous pouvez utiliser des espaces réservés d'URL dynamiques qui sont remplacés par une valeur unique à chaque requête de surveillance.

#### Espaces réservés pris en charge

| Espace réservé | Description | Valeur exemple |
|----------------|-------------|----------------|
| `{{timestamp}}` | Remplacé par l'horodatage Unix actuel (secondes) | `1719500000` |
| `{{random}}` | Remplacé par une chaîne unique aléatoire | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Exemple

Configurez l'URL de votre moniteur avec un espace réservé :

```
https://api.example.com/health?cb={{timestamp}}
```

À chaque vérification de surveillance, l'URL devient :

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

Vous pouvez également utiliser `{{random}}` pour une chaîne unique à chaque requête :

```
https://api.example.com/health?nocache={{random}}
```

### Type de requête API

Sélectionnez la méthode HTTP pour la requête :

- **GET** (par défaut)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### Options avancées

#### En-têtes de requête

Ajoutez des en-têtes HTTP personnalisés à la requête. Cela est utile pour les jetons d'authentification, les spécifications de type de contenu et d'autres en-têtes spécifiques à l'API.

Vous pouvez utiliser les [Secrets de moniteur](/docs/monitor/monitor-secrets) dans les valeurs d'en-tête pour stocker en toute sécurité les données sensibles comme les clés API.

#### Corps de requête (JSON)

Pour les requêtes POST, PUT et PATCH, vous pouvez spécifier un corps de requête JSON. Vous pouvez également utiliser les [Secrets de moniteur](/docs/monitor/monitor-secrets) dans le corps de requête.

#### Ne pas suivre les redirections

Par défaut, OneUptime suit les redirections HTTP (301, 302, etc.). Activez cette option si vous souhaitez surveiller la réponse de redirection elle-même plutôt que la destination finale.

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** *(optional)* — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand votre API est considérée comme en ligne, dégradée ou hors ligne en fonction de :

- **Code de statut de réponse** — Vérifiez si le code de statut HTTP correspond aux valeurs attendues (par ex., 200, 201)
- **Temps de réponse** — Surveillez si le temps de réponse dépasse un seuil
- **Corps de réponse** — Vérifiez si le corps de réponse contient ou correspond à un contenu spécifique
- **En-têtes de réponse** — Vérifiez que des en-têtes de réponse spécifiques sont présents ou correspondent aux valeurs attendues
- **Expression JavaScript** — Écrivez des expressions personnalisées pour évaluer la réponse. Voir [Expressions JavaScript](/docs/monitor/javascript-expression) pour les détails.
