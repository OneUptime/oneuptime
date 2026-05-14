# Entrée de requêtes entrantes

Une sonde personnalisée peut optionnellement exécuter un **écouteur HTTP entrant** qui accepte les appels `heartbeat` et `incoming-request` depuis l'intérieur de votre réseau privé et les transmet à OneUptime. Cela permet aux services qui **n'ont pas d'accès Internet sortant** de tout de même rapporter à un [Moniteur de requêtes entrantes](/docs/monitor/incoming-request-monitor) en envoyant la requête à une sonde sur le réseau local plutôt que directement à `oneuptime.com`.

## Vue d'ensemble

Lorsque `PROBE_INGRESS_PORT` est défini, la sonde lie un écouteur HTTP supplémentaire sur ce port. L'écouteur accepte les mêmes chemins d'URL `secretkey` que les points d'accès publics OneUptime :

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

La sonde proxy ensuite la requête vers votre instance OneUptime, en préservant la méthode, le corps et les en-têtes de requête (moins les en-têtes hop-by-hop tels que `Host`, `Connection`, `Content-Length`, etc.). La sonde attache automatiquement un en-tête `OneUptime-Probe-Id` afin que la requête soit attribuée à la sonde de transmission.

L'écouteur s'exécute sur un **port dédié**, séparé des points d'accès internes de statut/métriques de la sonde, vous pouvez donc l'exposer à votre réseau privé sans rien exposer d'autre.

## Quand l'utiliser

Utilisez l'écouteur d'entrée lorsque :

- Vos services s'exécutent dans un segment réseau isolé sans accès HTTPS sortant
- Vous avez besoin de garder tout le trafic de surveillance au sein de votre VPC / réseau sur site
- Vous souhaitez un seul point de sortie — la sonde — autorisé à atteindre OneUptime
- Vous avez déjà déployé une [sonde personnalisée](/docs/probe/custom-probe) et souhaitez la réutiliser pour les signaux de vie entrants

Si vos services peuvent déjà atteindre `https://oneuptime.com` (ou votre URL auto-hébergée) directement, vous **n'avez pas** besoin de cette fonctionnalité — appelez directement l'URL de signal de vie depuis le service.

## Activer l'écouteur d'entrée

Définissez `PROBE_INGRESS_PORT` sur le port sur lequel vous souhaitez que l'écouteur se lie. Toute valeur supérieure à `0` active l'écouteur ; laisser non défini (ou `0`) le désactive.

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

Si vous n'utilisez pas `--network host`, publiez le port d'entrée explicitement :

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

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
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

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
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

Les services internes peuvent alors envoyer des signaux de vie à `http://oneuptime-probe-ingress.<espace-de-noms>.svc.cluster.local:3875/heartbeat/<clé-secrète>`.

## Envoi de requêtes à la sonde

Remplacez l'URL publique de signal de vie :

```
https://oneuptime.com/heartbeat/<clé-secrète>
```

par l'URL d'entrée de la sonde :

```
http://<hôte-sonde>:<PROBE_INGRESS_PORT>/heartbeat/<clé-secrète>
```

Le chemin, la méthode, le corps et les en-têtes sont par ailleurs identiques, donc tout code client existant n'a besoin que de changer l'URL de base.

### Exemples

```bash
# Signal de vie GET
curl http://probe.internal:3875/heartbeat/VOTRE_CLÉ_SECRÈTE

# Signal de vie POST avec corps JSON
curl -X POST http://probe.internal:3875/heartbeat/VOTRE_CLÉ_SECRÈTE \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Tâche cron
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/VOTRE_CLÉ_SECRÈTE > /dev/null
```

## Comportement de transmission

- **Réponse synchrone, transmission asynchrone.** La sonde accuse réception de la requête entrante immédiatement avec un `200` et transmet à OneUptime en arrière-plan. Votre service n'a pas à attendre que la transmission se termine.
- **Les en-têtes sont préservés.** Tous les en-têtes sauf les hop-by-hop (`Host`, `Connection`, `Content-Length`, `Transfer-Encoding`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Upgrade`) sont transmis. La sonde ajoute un en-tête `OneUptime-Probe-Id` l'identifiant.
- **Le corps est préservé.** Les charges utiles JSON, encodées en URL et brutes `application/octet-stream` jusqu'à **50 Mo** sont acceptées.
- **Tentatives avec backoff exponentiel.** Si la transmission échoue, la sonde réessaie jusqu'à `PROBE_INGRESS_FORWARD_RETRY_LIMIT` fois avec un backoff exponentiel (2s, 4s, 8s, plafonné à 15s).
- **Sensible au proxy.** Si la sonde elle-même est configurée avec `HTTP_PROXY_URL` / `HTTPS_PROXY_URL`, les requêtes transmises passeront par le proxy.

## Variables d'environnement

| Variable | Par défaut | Description |
|---|---|---|
| `PROBE_INGRESS_PORT` | _non défini_ (désactivé) | Port sur lequel l'écouteur entrant se lie. Toute valeur `> 0` active l'entrée. |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS` | `10000` | Délai d'attente (ms) pour chaque tentative de transmission vers OneUptime. Minimum `1000`. |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3` | Nombre de tentatives avant que la sonde abandonne une transmission. Définir à `0` pour désactiver les tentatives. |

Les variables standard de la sonde (`PROBE_KEY`, `PROBE_ID`, `ONEUPTIME_URL`, variables de proxy) s'appliquent toutes — voir [Sondes personnalisées](/docs/probe/custom-probe) pour la liste complète.

## Considérations de sécurité

- **Le point d'accès est intentionnellement non authentifié** — la clé secrète dans le chemin d'URL *est* l'authentification, comme c'est le cas sur le point d'accès public `oneuptime.com`. Traitez la clé secrète comme un identifiant.
- **Liez à une interface privée uniquement.** L'écouteur d'entrée ne doit pas être accessible depuis Internet public. Utilisez une politique réseau, une règle de pare-feu ou un service `ClusterIP` pour restreindre l'accès.
- **Utilisez la terminaison HTTPS si vous nécessitez le chiffrement en transit.** L'écouteur de la sonde parle du HTTP brut. Placez-le derrière un équilibreur de charge interne / contrôleur d'entrée si vous avez besoin de TLS sur le saut entrant. La jambe de transmission sonde → OneUptime utilise toujours HTTPS (en supposant que `ONEUPTIME_URL` est `https://`).
- **Limites de ressources.** L'écouteur accepte des corps de requête jusqu'à 50 Mo. Si vous avez besoin d'un plafond plus strict, placez un proxy inverse devant.

## Dépannage

- **La sonde journalise `Probe ingress listener started on port <port>` au démarrage** — confirme que l'écouteur est actif. Si vous ne voyez pas cette ligne, `PROBE_INGRESS_PORT` est non défini, `0` ou invalide.
- **`Probe ingress: failed to forward to <url> after N attempts`** — la sonde n'a pas pu atteindre OneUptime. Vérifiez la connectivité sortante de la sonde, les paramètres de proxy et la valeur de `ONEUPTIME_URL`.
- **`Probe ingress: probe ID not available, forwarding without it`** — la sonde ne s'est pas encore enregistrée. La transmission réussit quand même ; le signal de vie ne sera simplement pas attribué à une sonde.
- **Le signal de vie apparaît dans OneUptime mais pas via la sonde** — confirmez que votre service atteint `http://<hôte-sonde>:<port>/...` et non l'URL publique. Une entrée DNS ou `/etc/hosts` mal configurée est la cause habituelle.

## En lien

- [Sondes personnalisées](/docs/probe/custom-probe)
- [Moniteur de requêtes entrantes](/docs/monitor/incoming-request-monitor)
