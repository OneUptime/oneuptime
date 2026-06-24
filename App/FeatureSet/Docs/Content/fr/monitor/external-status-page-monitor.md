# Moniteur de page de statut externe

La surveillance des pages de statut externes vous permet de surveiller les pages de statut de tiers et d'être alerté lorsque les services dont vous dépendez subissent des pannes ou des dégradations de performances. OneUptime vérifie périodiquement les pages de statut externes (telles que AWS, GCP, Azure, GitHub, OpenAI, Anthropic, et plus encore) et évalue leur statut.

## Vue d'ensemble

Les moniteurs de pages de statut externes vérifient la santé des services dont vous dépendez en interrogeant leurs pages de statut publiques. Cela vous permet de :

- Surveiller la disponibilité des services tiers dont dépend votre application
- Être alerté lorsque les fournisseurs en amont subissent des pannes
- Suivre les statuts des composants individuels (ex. : « AWS EC2 us-east-1 »)
- Limiter la surveillance à un seul groupe de composants (ex. : uniquement les « APIs » d'OpenAI), afin que des incidents sans rapport ailleurs sur la page ne déclenchent pas votre moniteur
- Détecter les dégradations de performances avant qu'elles n'impactent vos utilisateurs
- Corréler vos propres incidents avec les problèmes des fournisseurs en amont

## Fournisseurs pris en charge

OneUptime prend en charge la surveillance des pages de statut via les méthodes suivantes :

| Type de fournisseur      | Description                                                            |
| ------------------------ | --------------------------------------------------------------------- |
| **Auto** (par défaut)    | Détecte automatiquement le format de la page de statut                |
| **Atlassian Statuspage** | Pages de statut alimentées par Atlassian Statuspage (API JSON)        |
| **incident.io**          | Pages de statut alimentées par incident.io (ex. `https://status.openai.com`) |
| **RSS**                  | Pages de statut fournissant un flux RSS                               |
| **Atom**                 | Pages de statut fournissant un flux Atom                              |

### Détection automatique

Lorsque défini sur **Auto**, OneUptime tente de détecter automatiquement le format de la page de statut, dans cet ordre :

1. D'abord, il essaie l'API de page de statut incident.io (`/proxy/<host>`)
2. Ensuite, il essaie l'API JSON Atlassian Statuspage (`/api/v2/status.json`, `/api/v2/components.json` et `/api/v2/incidents/unresolved.json`)
3. En cas d'échec, il tente d'analyser la page comme un flux RSS ou Atom
4. En dernier recours, il effectue une vérification d'accessibilité HTTP de base

> **Note :** incident.io est vérifié en premier car certaines pages de statut incident.io (telles que `https://status.openai.com`) exposent également un point de terminaison limité compatible Atlassian qui omet les groupes de composants et les incidents actifs. Vérifier incident.io en premier garantit l'utilisation des données plus riches et tenant compte des groupes.

## Création d'un moniteur de page de statut externe

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Page de statut externe** comme type de moniteur
4. Entrez l'URL de la page de statut que vous souhaitez surveiller
5. Sélectionnez optionnellement un type de fournisseur spécifique (ou laissez sur **Auto**)
6. Entrez optionnellement un **groupe de composants** pour limiter la surveillance à un groupe tel que « APIs »
7. Entrez optionnellement un **nom de composant** pour filtrer sur un seul composant (au sein du groupe, si un groupe est défini)
8. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### URL de la page de statut

Entrez l'URL de la page de statut externe que vous souhaitez surveiller. Pour les sites alimentés par Atlassian Statuspage et incident.io, il s'agit généralement de l'URL racine (ex. : `https://status.example.com`). Pour les flux RSS/Atom, entrez directement l'URL du flux.

### Type de fournisseur

Sélectionnez le type de fournisseur pour la page de statut. Utilisez **Auto** (par défaut) pour laisser OneUptime détecter le format automatiquement, ou spécifiez **Atlassian Statuspage**, **incident.io**, **RSS** ou **Atom** si vous le connaissez.

### Filtre de groupe de composants

Si la page de statut organise ses composants en groupes, vous pouvez limiter le moniteur à un seul groupe. Par exemple, sur `https://status.openai.com`, entrer `APIs` limite le moniteur aux services API d'OpenAI.

Lorsqu'un groupe de composants est défini, le **nombre d'incidents actifs** et le **statut global** sont calculés en utilisant uniquement les composants de ce groupe — un incident affectant un groupe sans rapport (par exemple, ChatGPT) ne déclenchera pas un moniteur limité au groupe « APIs ».

Le filtrage par groupe de composants est pris en charge pour les fournisseurs **Atlassian Statuspage** et **incident.io**. (Les flux RSS/Atom n'exposent pas de groupes de composants.)

### Filtre de nom de composant

Si la page de statut rapporte plusieurs composants, vous pouvez optionnellement spécifier un nom de composant pour surveiller uniquement ce composant spécifique. Par exemple, pour surveiller uniquement AWS EC2 dans us-east-1, vous entreriez `EC2 us-east-1` (le nom exact du composant tel qu'affiché sur la page de statut).

Lorsqu'un groupe de composants est également défini, le filtre de nom de composant est appliqué **au sein** de ce groupe, ce qui vous permet de cibler un seul composant à l'intérieur d'un groupe plus large. Lorsqu'aucun des deux filtres n'est spécifié, tous les composants concernés sont surveillés.

### Options avancées

#### Délai d'attente

Le temps maximum (en millisecondes) à attendre pour une réponse de la page de statut. La valeur par défaut est 10000ms (10 secondes).

#### Tentatives

Le nombre de fois à réessayer la requête en cas d'échec. La valeur par défaut est 3 tentatives.

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand le service externe est considéré comme en ligne ou hors ligne en fonction de :

- **En ligne** — Si la page de statut est accessible et retourne des données de statut
- **Statut global** — L'indicateur de statut global de la page de statut (ex. : `operational`, `degraded_performance`, `partial_outage`, `major_outage`)
- **Statut du composant** — Le statut des composants concernés (en respectant les filtres de groupe de composants / nom de composant)
- **Incidents actifs** — Le nombre d'incidents actifs actuellement signalés sur la page de statut (limité au groupe de composants / composant lorsqu'un filtre est défini)
- **Temps de réponse** — Le temps nécessaire pour récupérer les données de la page de statut

### Critères par défaut

Par défaut, OneUptime initialise les critères en fonction de ce qui importe réellement pour une page de statut — ses incidents actifs et la santé de ses composants, plutôt que sa simple accessibilité :

- Le moniteur est marqué **Opérationnel** lorsqu'il n'y a aucun incident actif dans le périmètre concerné.
- Le moniteur est marqué **Hors ligne** (et un incident est créé) lorsqu'il y a au moins un incident actif dans le périmètre concerné, ou lorsqu'un composant concerné signale `degraded_performance`, `partial_outage`, `major_outage` ou `full_outage`.

Comme le nombre d'incidents actifs et les statuts des composants respectent les filtres de groupe de composants / nom de composant, ces critères par défaut ciblent automatiquement uniquement les composants qui vous intéressent.

## URLs de pages de statut populaires

Voici une liste organisée d'URLs de pages de statut de services populaires que vous pouvez surveiller :

| Service                      | URL de la page de statut                      |
| ---------------------------- | --------------------------------------------- |
| AWS                          | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform        | `https://status.cloud.google.com`             |
| Microsoft Azure              | `https://status.azure.com`                    |
| GitHub                       | `https://www.githubstatus.com`                |
| OpenAI                       | `https://status.openai.com`                   |
| Anthropic                    | `https://status.anthropic.com`                |
| Cloudflare                   | `https://www.cloudflarestatus.com`            |
| Datadog                      | `https://status.datadoghq.com`                |
| PagerDuty                    | `https://status.pagerduty.com`                |
| Twilio                       | `https://status.twilio.com`                   |
| Stripe                       | `https://status.stripe.com`                   |
| Slack                        | `https://status.slack.com`                    |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com`                |
| Vercel                       | `https://www.vercel-status.com`               |
| Netlify                      | `https://www.netlifystatus.com`               |
| DigitalOcean                 | `https://status.digitalocean.com`             |
| Heroku                       | `https://status.heroku.com`                   |
| MongoDB Atlas                | `https://status.cloud.mongodb.com`            |
| Fastly                       | `https://status.fastly.com`                   |
| New Relic                    | `https://status.newrelic.com`                 |
| Sentry                       | `https://status.sentry.io`                    |
| CircleCI                     | `https://status.circleci.com`                 |

> **Remarque :** Beaucoup d'entre eux utilisent Atlassian Statuspage ou incident.io, donc le type de fournisseur **Auto** les détectera automatiquement.

## Modèles d'incidents et d'alertes

Lors de la création d'incidents ou d'alertes à partir de moniteurs de pages de statut externes, vous pouvez utiliser les variables de modèle suivantes :

| Variable                  | Description                                                  |
| ------------------------- | ------------------------------------------------------------ |
| `{{isOnline}}`            | Si la page de statut est en ligne (true/false)               |
| `{{responseTimeInMs}}`    | Temps de réponse en millisecondes                            |
| `{{failureCause}}`        | Raison de l'échec, le cas échéant                            |
| `{{overallStatus}}`       | La valeur de l'indicateur de statut global                   |
| `{{activeIncidentCount}}` | Nombre d'incidents actifs (limité au filtre, le cas échéant) |
| `{{componentStatuses}}`   | Tableau JSON des statuts des composants (`name`, `status`, `description`, `groupName`) |
| `{{provider}}`            | Fournisseur détecté (Atlassian Statuspage, incident.io, RSS, Atom) |
| `{{componentGroup}}`      | Groupe de composants auquel le moniteur est limité, le cas échéant |
| `{{componentName}}`       | Composant auquel le moniteur est limité, le cas échéant      |

## Meilleures pratiques

- **Utilisez le type de fournisseur Auto** sauf si vous connaissez le format exact — la détection automatique fonctionne bien pour la plupart des pages de statut
- **Limitez à un groupe de composants** si vous ne dépendez que d'une partie d'un fournisseur (ex. : uniquement les « APIs » d'OpenAI), afin que des incidents sans rapport ne créent pas de bruit
- **Surveillez des composants spécifiques** si vous ne dépendez que de certains services (ex. : une région AWS spécifique)
- **Configurez la corrélation des incidents** — lorsque vos moniteurs détectent des problèmes et que la page de statut en amont signale également des problèmes, cela aide à identifier les causes racines plus rapidement
- **Combinez avec d'autres moniteurs** — associez les moniteurs de pages de statut externes à vos propres moniteurs API/site web pour une visibilité complète
