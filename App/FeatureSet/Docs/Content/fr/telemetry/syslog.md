# Envoyer des données Syslog à OneUptime

## Vue d'ensemble

Le service d'ingestion OpenTelemetry accepte désormais les charges utiles Syslog natives. Vous pouvez transférer des messages depuis n'importe quelle source compatible RFC3164 ou RFC5424 directement vers OneUptime via HTTPS. OneUptime analyse la priorité syslog, la facilité, la gravité, les données structurées et le corps du message avant de tout stocker sous forme de journaux consultables.

## Prérequis

- **Jeton d'ingestion de télémétrie** — créez-en un depuis _Paramètres du projet → Clés d'ingestion de télémétrie_ et copiez la valeur `x-oneuptime-token`.
- **Redirecteur Syslog** — tout outil capable d'envoyer des requêtes HTTP POST (par exemple `curl`, `rsyslog` via `omhttp`, ou `syslog-ng` avec le plugin de destination HTTP).
- **Nom du service (optionnel)** — définissez l'en-tête `x-oneuptime-service-name` pour regrouper les journaux entrants sous un service de télémétrie spécifique. Lorsqu'il est omis, OneUptime utilise par défaut l'`APP-NAME` syslog, le nom d'hôte ou `Syslog`.

## Point d'accès

```
POST https://oneuptime.com/syslog/v1/logs
```

- Remplacez `oneuptime.com` par votre hôte si vous auto-hébergez OneUptime.
- Incluez toujours l'en-tête `x-oneuptime-token` dans la requête.

## Corps de la requête

Envoyez des chaînes Syslog délimitées par des sauts de ligne ou une charge utile JSON avec un tableau `messages`. Les formats RFC3164 (BSD) et RFC5424 sont tous deux pris en charge.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### Types de contenu pris en charge

- `application/json` — recommandé.
- `text/plain` — messages séparés par des sauts de ligne.
- `application/octet-stream` — charges utiles brutes. La compression Gzip (`Content-Encoding: gzip`) est également acceptée.

## Test rapide avec curl

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: VOTRE_CLÉ_TELEMETRIE" \
  -H "x-oneuptime-service-name: web-production" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## Transfert depuis rsyslog

1. Installez le module de sortie HTTP :
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. Ajoutez la destination à `/etc/rsyslog.d/oneuptime.conf` :

   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: VOTRE_CLÉ_TELEMETRIE"
     header="x-oneuptime-service-name: demo-rsyslog"
     template="OneUptimeJson"
   )
   ```

3. Redémarrez rsyslog :
   ```bash
   sudo systemctl restart rsyslog
   ```

## Cas d'utilisation courants que nous observons déjà

### 1. Appareils réseau et de sécurité

La plupart des équipements réseau exposent encore les changements de configuration, les correspondances ACL et les détections de menaces exclusivement via syslog. Pointez votre relais existant (Palo Alto, Fortinet, Cisco ASA, Juniper, pfSense, et plus) directement vers OneUptime, ou conservez un relais interne et transmettez via HTTPS :

```bash
# Extrait rsyslog qui regroupe les messages en JSON et les envoie à OneUptime
module(load="omhttp")

template(name="OneUptimeJSON" type="list") {
  constant(value="{\"messages\":[\"")
  property(name="rawmsg")
  constant(value="\"]}")
}

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: pare-feu-perimetre"
  template="OneUptimeJSON"
)
```

### 2. Serveurs Linux et tâches cron

De nombreuses tâches cron et démons hérités enregistrent encore uniquement via la facilité kernel/syslog. Le transfert de `/var/log/syslog` ou des entrées journald maintient les traces opérationnelles en un seul endroit. Les hôtes Systemd peuvent compter sur le pont journald → syslog :

```bash
# /etc/rsyslog.d/oneuptime.conf
module(load="imjournal" StateFile="imjournal.state")
module(load="omhttp")

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: flotte-linux"
  template="OneUptimeJSON"
)
```

Comme nous mappons les codes de gravité, vous pouvez alerter sur `syslog.severity.name = "error"` ou trancher par `syslog.hostname` pour isoler rapidement les boîtes bruyantes.

### 3. Contrôleurs d'entrée Kubernetes et nœuds périphériques

Si vous exécutez déjà Fluent Bit ou Fluentd, gardez-les pour les journaux de conteneurs et ajoutez un récepteur syslog léger pour les hôtes ou appareils en périphérie. L'entrée `syslog` de Fluent Bit se couple avec la sortie HTTP :

```ini
[INPUT]
    Name              syslog
    Mode              tcp
    Listen            0.0.0.0
    Port              5140

[OUTPUT]
    Name              http
    Match             *
    Host              oneuptime.com
    Port              443
    URI               /syslog/v1/logs
    Format            json
    json_date_key     time
    Header            Content-Type application/json
    Header            x-oneuptime-token <TOKEN>
    Header            x-oneuptime-service-name ingress-periphere
    tls               On
```

Cette configuration vous permet d'ingérer du syslog depuis des workers bare-metal ou des équilibreurs de charge matériels sans créer une autre pile de journalisation.

### 4. Archives de conformité sans l'attente

Besoin de conserver les journaux de pare-feu pour PCI ou SOX ? Envoyez-les directement à OneUptime, appliquez une longue politique de rétention au service de télémétrie et exportez vers le stockage froid depuis un seul endroit. Plus d'exportation depuis plusieurs relais syslog.

## Attributs analysés

OneUptime ajoute automatiquement les attributs suivants à chaque entrée de journal :

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (données structurées RFC5424 aplaties)
- `syslog.raw` (message original pour la traçabilité)

Ces attributs deviennent consultables dans l'explorateur Télémétrie → Journaux.

## Dépannage

- **HTTP 401 ou résultats vides** — vérifiez que l'en-tête `x-oneuptime-token` appartient au projet recevant les journaux.
- **Aucun journal n'apparaît** — confirmez que le corps de la requête contient réellement des lignes syslog. Les corps vides sont rejetés avec HTTP 400.
- **Nom de service inattendu** — définissez `x-oneuptime-service-name` pour remplacer la logique de détection par défaut.
- **Grandes rafales** — le regroupement jusqu'à 1 000 lignes par requête est pris en charge. Les rafales plus importantes sont mises en file d'attente et traitées de manière asynchrone.
