## Configuration des sondes personnalisées

Vous pouvez configurer des sondes personnalisées à l'intérieur de votre réseau pour surveiller les ressources de votre réseau privé ou les ressources situées derrière votre pare-feu.

Pour commencer, vous devez créer une sonde personnalisée dans vos Paramètres du projet > Sonde. Une fois que vous avez créé la sonde personnalisée sur votre tableau de bord OneUptime, vous devriez avoir le `PROBE_ID` et le `PROBE_KEY`.

### Déployer la sonde

#### Docker

Pour exécuter une sonde, veuillez vous assurer que Docker est installé. Vous pouvez exécuter une sonde personnalisée en utilisant :

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Si vous auto-hébergez OneUptime, vous pouvez modifier `ONEUPTIME_URL` pour pointer vers votre instance auto-hébergée personnalisée.

##### Configuration du proxy

Si votre sonde doit passer par un serveur proxy pour atteindre OneUptime ou surveiller des ressources externes, vous pouvez configurer les paramètres de proxy en utilisant ces variables d'environnement :

```
# Pour un proxy HTTP
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Pour un proxy HTTPS
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Avec authentification par proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

Vous pouvez également exécuter la sonde en utilisant docker-compose. Créez un fichier `docker-compose.yml` avec le contenu suivant :

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

##### Avec configuration du proxy

Si vous avez besoin d'utiliser un serveur proxy, vous pouvez ajouter des variables d'environnement de proxy :

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      # Configuration du proxy (optionnel)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # Pour un proxy avec authentification :
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

Puis exécutez la commande suivante :

```
docker compose up -d
```

Si vous auto-hébergez OneUptime, vous pouvez modifier `ONEUPTIME_URL` pour pointer vers votre instance auto-hébergée personnalisée.

#### Kubernetes

Vous pouvez également exécuter la sonde en utilisant Kubernetes. Créez un fichier `oneuptime-probe.yaml` avec le contenu suivant :

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

##### Avec configuration du proxy

Si vous avez besoin d'utiliser un serveur proxy, vous pouvez ajouter des variables d'environnement de proxy :

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            # Configuration du proxy (optionnel)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # Pour un proxy avec authentification, utilisez :
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

Puis exécutez la commande suivante :

```bash
kubectl apply -f oneuptime-probe.yaml
```

Si vous auto-hébergez OneUptime, vous pouvez modifier `ONEUPTIME_URL` pour pointer vers votre instance auto-hébergée personnalisée.

### Variables d'environnement

La sonde prend en charge les variables d'environnement suivantes :

#### Variables obligatoires

- `PROBE_KEY` - La clé de sonde depuis votre tableau de bord OneUptime
- `PROBE_ID` - L'ID de sonde depuis votre tableau de bord OneUptime
- `ONEUPTIME_URL` - L'URL de votre instance OneUptime (par défaut : https://oneuptime.com)

#### Variables optionnelles

- `HTTP_PROXY_URL` - URL du serveur proxy HTTP pour les requêtes HTTP
- `HTTPS_PROXY_URL` - URL du serveur proxy HTTP pour les requêtes HTTPS
- `NO_PROXY` - Hôtes ou domaines séparés par des virgules qui doivent contourner le proxy
- `PROBE_NAME` - Nom personnalisé pour la sonde
- `PROBE_DESCRIPTION` - Description de la sonde
- `PROBE_MONITORING_WORKERS` - Nombre de workers de surveillance (par défaut : 1)
- `PROBE_MONITOR_FETCH_LIMIT` - Nombre de moniteurs à récupérer à la fois (par défaut : 10)
- `PROBE_MONITOR_RETRY_LIMIT` - Nombre de tentatives pour les moniteurs échoués (par défaut : 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Délai d'attente pour les scripts de moniteur synthétique en millisecondes (par défaut : 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Délai d'attente pour les scripts de moniteur de code personnalisé en millisecondes (par défaut : 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` - Délai limite pour chaque requête que la sonde envoie à OneUptime (par défaut : 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` - Consigner un avertissement pour les requêtes vers OneUptime plus lentes que cette valeur (par défaut : 10000)

#### Configuration du proxy

La sonde prend en charge les serveurs proxy HTTP et HTTPS. Lorsqu'elle est configurée, la sonde achemine tout le trafic de surveillance via les serveurs proxy spécifiés. Vous pouvez également fournir une liste `NO_PROXY` séparée par des virgules pour contourner le proxy pour les hôtes ou réseaux internes.

**Format de l'URL du proxy :**

```
http://[username:password@]proxy.server.com:port
```

**Exemples :**

- Proxy de base : `http://proxy.example.com:8080`
- Avec authentification : `http://username:password@proxy.example.com:8080`

**Fonctionnalités prises en charge :**

- Prise en charge des proxys HTTP et HTTPS
- Authentification par proxy (nom d'utilisateur/mot de passe)
- Basculement automatique entre les proxys HTTP et HTTPS
- Contournement sélectif du proxy avec `NO_PROXY`
- Fonctionne avec tous les types de moniteurs (site Web, API, SSL, synthétique, etc.)

**Remarque :** Les variables d'environnement standard (`HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY`) et leurs variantes en minuscules (`http_proxy`, `https_proxy`, `no_proxy`) sont toutes deux prises en charge pour la compatibilité.

### Vérification

Si la sonde fonctionne correctement, elle doit apparaître comme `Connected` sur votre tableau de bord OneUptime. Si elle n'apparaît pas comme connectée, vous devez vérifier les journaux du conteneur. Si vous avez encore des difficultés, veuillez créer un ticket sur [GitHub](https://github.com/oneuptime/oneuptime) ou [contacter le support](https://oneuptime.com/support).

### Diagnostic d'une sonde déconnectée

Une sonde est signalée comme `Disconnected` lorsque ses requêtes vers OneUptime cessent d'aboutir. Le journal de la sonde indique où chaque requête en échec s'est bloquée, vous avez donc rarement besoin de deviner.

**1. Lisez le bloc d'environnement affiché au démarrage.** Chaque sonde affiche au démarrage un unique bloc JSON contenant l'URL OneUptime qu'elle utilise, son délai limite de requête, ses paramètres de proxy, les résolveurs DNS dont elle a hérité, la version de Node et du système d'exploitation, et si la vérification TLS a été désactivée. Joignez ce bloc chaque fois que vous signalez un problème.

**2. Repérez le rapport d'échec.** Chaque requête en échec vers OneUptime consigne un bloc contenant `stalledAt` et `whatThisMeans`. `stalledAt` correspond à la phase que la requête n'a jamais dépassée :

| `stalledAt` | Ce que cela signifie |
| --- | --- |
| `SocketAssignment` | Rien n'a quitté la machine. Le pool de sockets était saturé, ou un proxy configuré n'a jamais terminé son tunnel CONNECT. |
| `TcpConnect` | La machine a envoyé un SYN et n'a rien reçu en retour — un pare-feu ou un équipement de sécurité rejette les paquets, ou l'hôte est injoignable. |
| `TlsHandshake` | La connexion TCP est établie, mais TLS n'a jamais abouti. Il s'agit généralement d'un boîtier intermédiaire qui inspecte le trafic TLS. |
| `RequestSend` | Connexion établie, mais la requête n'a jamais été écrite entièrement — l'extrémité distante a cessé de lire. |
| `WaitingForServerResponse` | La requête a bien été transmise et le serveur n'a rien renvoyé. **Le réseau de la sonde fonctionne correctement** — vérifiez le serveur OneUptime, son équilibreur de charge et son reverse proxy. |
| `ResponseBody` | Le serveur a commencé à répondre puis s'est bloqué en cours de route. |

Le même bloc indique également `deadlineOverrunInMs`. Si un délai limite de 45000 ms a pris bien plus de 45000 ms de temps réel, c'est le processus de la sonde lui-même qui était bloqué — vérifiez `probeProcess.eventLoopMaxDriftInMs` dans le bloc avant d'enquêter sur le réseau.

**3. Lisez l'auto-test de connectivité.** Après trois échecs consécutifs, la sonde teste le même serveur couche par couche — le DNS, puis TCP, puis TLS, puis un véritable aller-retour HTTP — et consigne chaque étape avec sa durée. La première étape qui échoue vous donne la réponse. Lorsqu'un proxy est configuré, la sonde teste le saut vers le proxy, car c'est le seul saut qu'elle effectue réellement.

**4. Surveillez les requêtes lentes avant qu'elles ne deviennent des échecs.** Les requêtes qui aboutissent mais qui prennent plus de temps que `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` sont consignées avec leur durée écoulée. Une sonde qui commence à consigner des requêtes de 20 secondes est en passe de dépasser le délai limite de 45 secondes.

Du côté du serveur OneUptime, une requête de sonde à laquelle il est répondu lentement — ou que la sonde a abandonnée avant qu'une réponse ne soit envoyée — y est également consignée, avec l'identifiant de la sonde. Ensemble, ces deux journaux vous indiquent de quel côté de la connexion se situe le problème.
