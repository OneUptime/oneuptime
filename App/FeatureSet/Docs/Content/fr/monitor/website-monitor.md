# Moniteur de site Web

La surveillance de site Web vous permet de surveiller la disponibilité, les performances et la réponse de tout site Web ou page Web. OneUptime envoie périodiquement des requêtes HTTP à l'URL de votre site Web et vérifie si elle répond correctement.

## Vue d'ensemble

Les moniteurs de site Web vérifient vos pages Web en effectuant des requêtes HTTP et en évaluant les réponses. Cela vous permet de :

- Surveiller la disponibilité et le temps de fonctionnement du site Web
- Suivre les temps de réponse et les performances
- Vérifier les codes de statut HTTP
- Vérifier les en-têtes de réponse
- Détecter les pannes avant vos utilisateurs

## Création d'un moniteur de site Web

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Site Web** comme type de moniteur
4. Entrez l'URL du site Web que vous souhaitez surveiller
5. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### URL du site Web

Entrez l'URL complète du site Web que vous souhaitez surveiller, y compris le protocole (ex. : `https://example.com`).

### Espaces réservés d'URL dynamiques

Lors de la surveillance d'URL derrière des CDN ou des proxys de mise en cache, le moniteur peut recevoir une réponse mise en cache au lieu de contacter le serveur d'origine. Pour invalider le cache à chaque vérification, vous pouvez utiliser des espaces réservés d'URL dynamiques qui sont remplacés par une valeur unique à chaque requête de surveillance.

#### Espaces réservés pris en charge

| Espace réservé | Description | Exemple de valeur |
|----------------|-------------|-------------------|
| `{{timestamp}}` | Remplacé par l'horodatage Unix actuel (secondes) | `1719500000` |
| `{{random}}` | Remplacé par une chaîne unique aléatoire | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Exemple

Configurez l'URL de votre moniteur avec un espace réservé :

```
https://example.com/health?cb={{timestamp}}
```

À chaque vérification de surveillance, l'URL devient :

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

Vous pouvez également utiliser `{{random}}` pour une chaîne unique à chaque requête :

```
https://example.com/health?nocache={{random}}
```

### Options avancées

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

Vous pouvez configurer des critères pour déterminer quand votre site Web est considéré comme en ligne, dégradé ou hors ligne en fonction de :

- **Code de statut de réponse** — Vérifier si le code de statut HTTP correspond aux valeurs attendues (ex. : 200, 301)
- **Temps de réponse** — Surveiller si le temps de réponse dépasse un seuil
- **Corps de la réponse** — Vérifier si le corps de la réponse contient ou correspond à un contenu spécifique
- **En-têtes de réponse** — Vérifier que des en-têtes de réponse spécifiques sont présents ou correspondent aux valeurs attendues
