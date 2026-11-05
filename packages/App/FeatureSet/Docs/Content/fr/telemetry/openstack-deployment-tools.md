# OpenStack par outil de déploiement

Personne n'exécute « OpenStack ». On exécute un outil qui le déploie, et chaque outil a ses propres chemins, ses propres journaux et sa propre idée de ce qui tourne déjà. Cette page reprend ce que le guide de configuration de OneUptime dit pour chacun : ouvrez **OpenStack → Tous les clouds**, connectez un cloud et répondez à **Comment déployez-vous OpenStack ?**

:::cards
- [Jusqu'où chaque guide a été testé](#jusquoù-chaque-guide-a-été-testé): À lire en premier. Ceux de Kolla-Ansible et d'OpenStack-Ansible ont été exécutés sur de vrais déploiements. Les autres ne l'ont pas été.
- [Transférer ce qui se déclenche déjà](#transférer-ce-qui-se-déclenche-déjà): Des incidents dès la première heure, sans agent.
- [Kolla-Ansible](#kolla-ansible): Lire les exportateurs qu'il exécute déjà.
- [OpenStack-Ansible](#openstack-ansible): Les journaux de journald, et les surcharges dans `user_variables.yml`.
- [OpenStack-Helm](#openstack-helm): Une sonde, et l'agent Kubernetes, y compris pour Atmosphere.
- [Canonical Sunbeam](#canonical-sunbeam): La Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): Le préréglage OpenShift, et Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): Les alertes de StackLight.
- [Utiliser l'exportateur que vous exécutez déjà](#utiliser-lexportateur-que-vous-exécutez-déjà): Ce dont les pages se passent en 1.7.0.
:::

## Jusqu'où chaque guide a été testé

Chaque chemin, port et variable ci-dessous a été lu dans le code source ou la documentation de l'outil lui-même. Le banc d'essai qui enregistre les fixtures de OneUptime déploie aussi Kolla-Ansible et OpenStack-Ansible sur un runner CI, et y exécute les propres commandes de leurs guides, avec un substitut de OneUptime qui conserve ce que l'agent envoie. Aucun guide d'ici n'a donc rapporté à un OneUptime en fonctionnement depuis un vrai déploiement de son outil. Voici ce contre quoi chacun a été vérifié :

| Outil | Lu dans | Exécuté pour de vrai |
| --- | --- | --- |
| Kolla-Ansible | Son code source, sur master et `stable/2026.1` | Les commandes de ce guide, sur un vrai all-in-one en `stable/2026.1` avec Open vSwitch : l'agent sur chaque identifiant, sans Docker, sur l'exportateur propre à Kolla-Ansible et sur le vôtre à la version épinglée et en 1.7.0, les cibles lues dans son vrai `prometheus.yml`, et le profil de journaux. Une partie n'a pas tenu : avec Memcached et nova-compute arrêtés, son Alertmanager n'a rien envoyé, donc aucune alerte n'est partie d'une pile Kolla-Ansible vers OneUptime. Ce que l'Alertmanager envoie à la version qu'il épingle, enregistré dans un cluster de test, a bien ouvert puis résolu un incident sur le bon cloud dans un OneUptime en fonctionnement |
| OpenStack-Ansible | Son code source et sa documentation | Les commandes de ce guide, sur un vrai all-in-one en `stable/2026.1`, dans des conteneurs LXC : l'agent sur le premier identifiant, l'exportateur sur le second avec ses surcharges de politique, les paramètres RabbitMQ et HAProxy avec l'agent qui lit chacun, et le profil de journaux sur le journal |
| OpenStack-Helm | Les valeurs de ses charts | La sonde et l'agent Kubernetes, chacun séparément |
| Atmosphere | Sa documentation et son code source | La sonde et l'agent Kubernetes, chacun séparément |
| Canonical Sunbeam | La documentation de Canonical, et le code source de ses charms | Rien sur Sunbeam. La documentation propre à Sunbeam ne mentionne pas le charm de l'exportateur |
| Red Hat OpenStack on OpenShift | Le code source du Telemetry Operator | Le préréglage OpenShift et l'exportateur de Ceilometer, chacun séparément |
| Mirantis MOSK | La documentation de Mirantis, dont les exemples montrent d'autres récepteurs plutôt qu'un webhook | Rien sur MOSK |

Ce que **Qui a fait quoi** active dans chaque guide a été enregistré sur DevStack, sur chaque version que le banc d'essai exécute, et sur aucun de ces outils. Là où chaque outil l'active a été lu dans son code source ou sa documentation.

En plus de cela, tout le chemin a été exécuté sur un OneUptime en fonctionnement, démarré comme le démarre Docker Compose, avec son application et sa sonde construites à partir de ce code, et sur un vrai DevStack plutôt que sur l'un de ces outils. L'agent, installé avec les commandes de sa documentation, a enregistré le cloud dès ses premières données, et chaque instance, volume et hyperviseur avait une ligne avec l'état que le cloud lui donnait lui-même. Avec `nova-compute` réellement arrêté, sa ligne est passée en panne, un moniteur du modèle Compute Service Down a ouvert un incident nommant l'hôte 746 secondes plus tard, et il l'a résolu 48 secondes après le redémarrage du service. La sonde d'un projet a connecté le même cloud par les propres routes du tableau de bord et relu ses lignes, et les 114 spans d'un démarrage signé sont arrivés à travers ses services, depuis le profil de traces.

Séparément, ce qu'un vrai agent et un vrai Alertmanager avaient envoyé a été enregistré sur DevStack et dans un cluster de test, pas sur un cloud déployé par l'un de ces outils. Envoyé à un OneUptime en fonctionnement, le webhook de déclenchement a ouvert un incident sur le bon cloud et sur aucun autre, le même webhook de nouveau n'a rien ouvert, et le webhook de résolution l'a résolu.

## Transférer ce qui se déclenche déjà

Tout outil doté d'un Alertmanager peut avoir des incidents dès aujourd'hui : une alerte qui se déclenche devient un incident, avec astreinte et pages de statut dès la première heure, et il se résout quand l'alerte se résout. Il n'y a rien à installer, et cela fonctionne en complément de tout le reste de cette page.

:::steps
### Créer le moniteur

Créez un moniteur Incoming Request comme l'indique [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#recevoir-les-alertes-avec-un-moniteur), et copiez son **URL de heartbeat**. C'est l'adresse `<secret key>` dans le récepteur de chaque outil ci-dessous.

### L'associer au cloud

Ouvrez **Vue d'ensemble → Ressources liées** du moniteur et ajoutez le cloud OpenStack. Chaque incident se trouve alors sur la page **Incidents** de ce cloud : les propres paramètres d'un moniteur Incoming Request ne nomment aucun cloud, donc l'Alertmanager de chaque cloud a besoin de son propre moniteur. Le cloud apparaît dans cette liste dès l'arrivée de ses premières données ; faites donc ceci après les étapes ci-dessous, ou ajoutez d'abord le cloud sous **OpenStack → Tous les clouds**.
:::

Alertmanager est enregistré en train d'envoyer exactement cette forme dans `Tests/Ops/openstack-e2e`, à la version que Kolla-Ansible épingle, et l'enregistrement est rejoué par le véritable évaluateur : un incident par alerte, résolu par son propre statut `resolved`.

## Kolla-Ansible

Avec `enable_prometheus` activé dans `/etc/kolla/globals.yml`, que Kolla-Ansible laisse désactivé tant que vous ne le définissez pas, il exécute Prometheus, Alertmanager et un exportateur pour chaque élément sous le cloud, et ne livre aucune règle d'alerte. Ce guide lit ce que ceux-ci exécutent plutôt que de démarrer une seconde copie.

### Transférer ce qui se déclenche sur Kolla-Ansible

Seulement si vous avez écrit vos propres règles : Kolla-Ansible n'en livre aucune, donc rien ne se déclenche tant que `/etc/kolla/config/prometheus/*.rules` n'en contient pas. Sur l'hôte depuis lequel vous déployez, écrivez `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, que Kolla-Ansible lit à la place du sien, et appliquez-le :

```yaml title="/etc/kolla/config/prometheus/prometheus-alertmanager.yml"
global:
  resolve_timeout: 5m
route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 10s
  group_interval: 5m
  repeat_interval: 3h
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/<secret key>"
        send_resolved: true
templates:
  - '/etc/prometheus/*.tmpl'
```

```bash
kolla-ansible reconfigure -i <inventory> --tags prometheus
```

### L'identifiant sur Kolla-Ansible

Connectez-vous en tant qu'admin avec `source /etc/kolla/admin-openrc.sh`, que `kolla-ansible post-deploy` écrit.

- **Vue complète** demande une modification, sur Cinder. Les modèles de Kolla-Ansible définissent déjà `service_type` sous `[keystone_authtoken]` pour Nova, Neutron, Glance et Placement, mais son Cinder indique `volume` alors que son catalogue indique `block-storage`, et keystonemiddleware refuse avec un `401` un identifiant limité par des règles d'accès si les deux ne concordent pas. Ajoutez `service_type = block-storage` sous `[keystone_authtoken]` dans `/etc/kolla/config/cinder.conf`, puis exécutez `kolla-ansible reconfigure -i <inventory> --tags cinder`.
- **Infrastructure uniquement** prend ses surcharges dans `/etc/kolla/config/nova/policy.yaml`, et de même pour `neutron`, `keystone` et `placement`, fusionnées avec ce qui s'y trouve déjà. Appliquez-les avec `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.

### Surveiller ce sur quoi repose le cloud de Kolla-Ansible

Sur l'hôte qui exécute le Prometheus de Kolla-Ansible, ceci lit ses cibles dans le fichier que Kolla-Ansible a généré, et les affiche sous forme de paramètres pour l'agent :

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Ajoutez ce qu'il affiche au `.env` de l'agent, puis exécutez `docker compose up -d` dans le dossier de l'agent. Chaque exportateur écoute sur le réseau d'API : la machine de l'agent a donc besoin d'une route vers lui. La carte **Plan de contrôle** du cloud indique alors l'état de chacun, et dit clairement lesquels ne sont pas surveillés.

| Lit | Port | Paramètre |
| --- | --- | --- |
| Le plugin Prometheus de RabbitMQ | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| L'exportateur propre à HAProxy | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, pour OVN et Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **Les bases de données d'OVN :** Kolla-Ansible exécute openstack-network-exporter à partir de 2026.1, uniquement sur les nœuds de calcul et de réseau, et une base de données OVN est lue depuis l'hôte sur lequel elle s'exécute. Si vos nœuds de contrôle ne sont ni l'un ni l'autre, ajoutez-les sous `[prometheus-openstack-network-exporter:children]` dans votre inventaire et reconfigurez, sinon les bases Northbound et Southbound apparaissent comme non surveillées.
- **Avant 2026.1**, il n'y a pas d'exportateur réseau : OVN et Open vSwitch apparaissent donc comme non surveillés.

### Journaux des services sur Kolla-Ansible

Le profil de journaux de l'agent s'exécute sur chaque nœud et lit les fichiers de Kolla-Ansible. C'est lui qui rattache une ligne aux pages du cloud :

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Le Fluentd de Kolla peut aussi transférer, avec une sortie dans `/etc/kolla/config/fluentd/output/*.conf` comme le décrit [Fluentd](/docs/telemetry/fluentd), mais ces enregistrements arrivent dans **Journaux** sous le nom d'un service, et non dans les pages du cloud.

### Qui a fait quoi sur Kolla-Ansible

La piste d'audit de Keystone et le filtre d'audit de chaque API, vers les [événements de sécurité](/docs/telemetry/openstack#qui-a-fait-quoi). Chacun écrit dans le journal propre au service, sans consommateur sur le bus. OneUptime les lit à cet endroit dès que **Trouver des événements de sécurité dans vos journaux** est activé, sous **Événements de sécurité → Connexions**. Le profil de journaux de l'agent lit les deux depuis `/var/log/kolla`.

```ini title="/etc/kolla/config/keystone.conf"
[DEFAULT]
notification_format = cadf
notification_opt_out = identity.authenticate.pending

[oslo_messaging_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t keystone
```

Cela envoie une ligne pour chaque connexion, que lit **Identifiant admin OpenStack utilisé depuis une nouvelle adresse**. Pour n'envoyer que les connexions échouées, ajoutez `identity.authenticate.success` à `notification_opt_out`, et cette détection lit alors ce que le filtre d'audit a vu.

Pour savoir qui a fait quoi via Nova, Neutron, Cinder et Glance, le filtre d'audit a besoin d'un paramètre, placé en une fois dans la configuration de chaque service :

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

Il a aussi besoin d'un fichier paste, et les tâches de configuration de Kolla-Ansible ne copient aucun fichier paste pour ces services. Placez le vôtre sur chaque hôte d'API, et montez-le par-dessus celui de l'image avec `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` et `glance_api_extra_volumes` dans `globals.yml`. Les fichiers de correspondance de pyCADF se trouvent dans `/var/lib/kolla/venv/etc/pycadf` dans l'image. [Qui a fait quoi](/docs/telemetry/openstack#activer-le-filtre-daudit) donne les lignes du filtre.

## OpenStack-Ansible

OpenStack-Ansible conserve les journaux de ses services dans journald et n'exécute pas de Prometheus propre : l'agent est donc la voie d'entrée, et les journaux ont leur propre chemin.

### L'identifiant sur OpenStack-Ansible

Connectez-vous en tant qu'admin depuis le conteneur utilitaire : `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, puis `. ~/openrc`. Il n'a pas de `curl`, que les commandes ci-dessous utilisent : exécutez donc d'abord `apt-get install -y curl` à cet endroit.

- **Vue complète** demande une modification, sur Cinder. Les rôles d'OpenStack-Ansible définissent déjà `service_type` sous `[keystone_authtoken]`, mais son Cinder indique `volumev3` alors que son catalogue indique `block-storage`, et keystonemiddleware refuse avec un `401` un identifiant limité par des règles d'accès si les deux ne concordent pas. Définissez `service_type: block-storage` sous `keystone_authtoken` dans `cinder_cinder_conf_overrides` dans `/etc/openstack_deploy/user_variables.yml`, puis exécutez `openstack-ansible openstack.osa.cinder --tags cinder-config`.
- **Infrastructure uniquement** prend ses surcharges sous la forme `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` et `placement_policy_overrides` dans `/etc/openstack_deploy/user_variables.yml`. Appliquez chacune avec son propre playbook et tag, par exemple `openstack-ansible openstack.osa.nova --tags nova-policy-override`. En retirer une plus tard laisse un fichier vide plutôt qu'aucun, de sorte que rien n'échoue.

### Surveiller ce sur quoi repose le cloud d'OpenStack-Ansible

OpenStack-Ansible n'exécute aucun exportateur pour ces éléments : seul ce que vous activez est surveillé.

**RabbitMQ :** activez son plugin Prometheus, puis nommez l'adresse de chaque conteneur sur `15692` comme `OPENSTACK_RABBITMQ_TARGETS` dans le `.env` de l'agent :

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy :** son exportateur est désactivé, et son listener de statistiques est sur `127.0.0.1` avec TLS, ce que l'agent ne peut pas lire. Activez-le là où l'agent peut le joindre, puis nommez cette adresse sur `1936` comme `OPENSTACK_HAPROXY_TARGETS` :

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB et Memcached :** OpenStack-Ansible ne livre d'exportateur ni pour l'un ni pour l'autre. Exécutez vous-même [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) et [memcached_exporter](https://github.com/prometheus/memcached_exporter) et nommez-les comme `OPENSTACK_MARIADB_TARGETS` et `OPENSTACK_MEMCACHED_TARGETS`, ou omettez-les : la carte **Plan de contrôle** du cloud indique alors qu'ils ne sont pas surveillés, plutôt qu'ils vont bien.

### Journaux des services sur OpenStack-Ansible

Depuis journald, sur chaque hôte qui exécute un service : les conteneurs transmettent leurs journaux à l'hôte.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

Cela exécute le profil de journaux de l'agent comme un service systemd, et lit `/var/log/journal/`, où arrivent les journaux des conteneurs d'OpenStack-Ansible.

### Qui a fait quoi sur OpenStack-Ansible

La piste d'audit de Keystone et le filtre d'audit de chaque API, vers les [événements de sécurité](/docs/telemetry/openstack#qui-a-fait-quoi). Chacun écrit dans le journal propre au service, sans consommateur sur le bus. OneUptime les lit à cet endroit dès que **Trouver des événements de sécurité dans vos journaux** est activé, sous **Événements de sécurité → Connexions**. Le profil de journaux de l'agent lit les deux depuis le journal.

```yaml title="/etc/openstack_deploy/user_variables.yml"
keystone_keystone_conf_overrides:
  DEFAULT:
    notification_format: cadf
    notification_opt_out: identity.authenticate.pending
  oslo_messaging_notifications:
    driver: log
```

```bash
openstack-ansible openstack.osa.keystone
```

Cela envoie une ligne pour chaque connexion, que lit **Identifiant admin OpenStack utilisé depuis une nouvelle adresse**. Pour n'envoyer que les connexions échouées, ajoutez `identity.authenticate.success` à `notification_opt_out`, et cette détection lit alors ce que le filtre d'audit a vu. Une deuxième valeur de `notification_opt_out` se place comme un ensemble YAML, de la façon dont [son config_template](https://docs.openstack.org/ansible-config_template/latest/) écrit une clé répétée.

Pour savoir qui a fait quoi via Nova, Neutron, Cinder et Glance, chaque API prend le paramètre du filtre dans ses surcharges de conf, et le filtre dans ses surcharges de paste, avec `audit` juste après `authtoken` et le filtre de contexte qui le suit dans chaque pipeline. Celles de Nova, et les mêmes dans `neutron_neutron_conf_overrides` et `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` et `cinder_api_paste_ini_overrides`, et `glance_glance_api_conf_overrides` et `glance_glance_api_paste_ini_overrides` :

```yaml title="/etc/openstack_deploy/user_variables.yml"
nova_nova_conf_overrides:
  audit_middleware_notifications:
    driver: log
nova_api_paste_ini_overrides:
  "filter:audit":
    paste.filter_factory: keystonemiddleware.audit:filter_factory
    audit_map_file: "/openstack/venvs/nova-{{ nova_venv_tag }}/etc/pycadf/nova_api_audit_map.conf"
```

```bash
openstack-ansible openstack.osa.nova
```

## OpenStack-Helm

OpenStack-Helm propose des charts pour Prometheus, Alertmanager et des exportateurs, et c'est à vous de décider s'ils tournent. Son plan de contrôle s'exécute dans Kubernetes : une sonde lit donc les API et l'agent Kubernetes voit les pods.

### Transférer ce qui se déclenche sur OpenStack-Helm

Si vous exécutez son chart prometheus-alertmanager, ajoutez le récepteur sous `conf.alertmanager` dans les valeurs du chart, et dirigez votre route vers lui :

```yaml title="prometheus-alertmanager values"
conf:
  alertmanager: |
    global:
      resolve_timeout: 5m
    route:
      receiver: oneuptime
      group_by: ["alertname", "instance"]
    receivers:
      - name: oneuptime
        webhook_configs:
          - url: "https://oneuptime.com/heartbeat/<secret key>"
            send_resolved: true
```

### Lire les API et voir les pods sur OpenStack-Helm

Ouvrez **OpenStack → Tous les clouds**, cliquez sur **Connecter le cloud**, et donnez-lui l'adresse de Keystone, un identifiant d'application et la sonde à utiliser. Une sonde ne parle qu'en HTTPS à un cloud. Suivez ensuite **Kubernetes → Documentation** pour le cluster sur lequel s'exécutent les charts : ses pods, leurs journaux et ses nœuds alimentent les pages Kubernetes.

Pour que les journaux de ces services figurent aussi sur la page **Journaux** de ce cloud, chaque trace de pile en un seul enregistrement, nommez le cloud dans les valeurs de l'agent, avec les namespaces dans lesquels s'exécutent ses services :

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Qui a fait quoi sur OpenStack-Helm

La piste d'audit de Keystone et le filtre d'audit de chaque API, vers les [événements de sécurité](/docs/telemetry/openstack#qui-a-fait-quoi). Chacun écrit dans le journal propre au service, sans consommateur sur le bus. OneUptime les lit à cet endroit dès que **Trouver des événements de sécurité dans vos journaux** est activé, sous **Événements de sécurité → Connexions**. L'agent Kubernetes lit les deux depuis les journaux des pods, avec le cloud nommé dans ses valeurs.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

Cela envoie une ligne pour chaque connexion, que lit **Identifiant admin OpenStack utilisé depuis une nouvelle adresse**. Pour n'envoyer que les connexions échouées, ajoutez `identity.authenticate.success` à `notification_opt_out`, et cette détection lit alors ce que le filtre d'audit a vu.

Le `logging.conf` d'un chart maintient le logger racine à `WARNING`, et le pilote de journal écrit sous un logger qui lui est propre : sans logger dédié, rien n'est écrit. Une liste dans les valeurs remplace celle du chart : `keys` contient donc ce que contient celle du chart, plus ceci :

```yaml title="keystone's values.yaml"
conf:
  logging:
    loggers:
      keys:
        - root
        - keystone
        - notifications
    logger_notifications:
      level: INFO
      handlers:
        - stdout
      qualname: oslo.messaging.notification
      propagate: 0
```

Pour savoir qui a fait quoi via Nova, Neutron et Cinder, le `conf.paste` de leurs charts contient déjà le filtre d'audit dans chaque pipeline, et il faut lui indiquer où écrire. Chacun a besoin du même logger, dans `conf.logging`. Le chart de Glance a la correspondance, mais ni le filtre ni une place pour lui dans ses pipelines : ajoutez les deux à son `conf.paste`.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere exécute kube-prometheus-stack avec ses propres règles d'alerte, et Loki avec Vector pour les journaux. Transférez d'abord ses alertes, puis une sonde lit les API et l'agent Kubernetes voit les pods.

### Transférer ce qui se déclenche sur Atmosphere

Atmosphere livre des règles d'alerte qui ont réveillé de vraies personnes : cela fonctionne donc dès la première heure. Ajoutez le récepteur à votre configuration d'Atmosphere, à côté des récepteurs que vous avez déjà, et déployez-la :

```yaml title="Atmosphere configuration"
kube_prometheus_stack_helm_values:
  alertmanager:
    config:
      route:
        receiver: oneuptime
      receivers:
        - name: oneuptime
          webhook_configs:
            - url: "https://oneuptime.com/heartbeat/<secret key>"
              send_resolved: true
```

### Lire les API et voir les pods sur Atmosphere

Ouvrez **OpenStack → Tous les clouds**, cliquez sur **Connecter le cloud**, et donnez-lui l'adresse de Keystone, un identifiant d'application et la sonde à utiliser. Une sonde ne parle qu'en HTTPS à un cloud. Suivez ensuite **Kubernetes → Documentation** pour le cluster sur lequel s'exécute Atmosphere.

Pour que les journaux de ces services figurent aussi sur la page **Journaux** de ce cloud, chaque trace de pile en un seul enregistrement, nommez le cloud dans les valeurs de l'agent, avec les namespaces dans lesquels s'exécutent ses services :

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Qui a fait quoi sur Atmosphere

La piste d'audit de Keystone et le filtre d'audit de chaque API, vers les [événements de sécurité](/docs/telemetry/openstack#qui-a-fait-quoi). Chacun écrit dans le journal propre au service, sans consommateur sur le bus. OneUptime les lit à cet endroit dès que **Trouver des événements de sécurité dans vos journaux** est activé, sous **Événements de sécurité → Connexions**. L'agent Kubernetes lit les deux depuis les journaux des pods, avec le cloud nommé dans ses valeurs.

```yaml title="your inventory's variables"
keystone_helm_values:
  conf:
    keystone:
      DEFAULT:
        notification_format: cadf
        notification_opt_out: identity.authenticate.pending
      oslo_messaging_notifications:
        driver: log
```

Cela envoie une ligne pour chaque connexion, que lit **Identifiant admin OpenStack utilisé depuis une nouvelle adresse**. Pour n'envoyer que les connexions échouées, ajoutez `identity.authenticate.success` à `notification_opt_out`, et cette détection lit alors ce que le filtre d'audit a vu.

Pour savoir qui a fait quoi via Nova, Neutron et Cinder, les charts qu'Atmosphere déploie ont déjà le filtre d'audit dans chaque pipeline, et il faut lui indiquer où écrire, dans `nova_helm_values`, `neutron_helm_values` et `cinder_helm_values`. Le chart de Glance n'a ni le filtre ni une place pour lui dans ses pipelines : ajoutez les deux à son `conf.paste`, dans `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam peut déployer la Canonical Observability Stack, avec `sunbeam enable observability embedded`. Canonical propose aussi un charm `openstack-exporter`, que l'agent peut lire si vous l'exécutez. La documentation propre à Sunbeam ne mentionne pas ce charm, et rien ici n'a été exécuté sur Sunbeam.

### Transférer ce qui se déclenche sur Sunbeam

Si vous exécutez la Canonical Observability Stack, donnez à son Alertmanager une configuration contenant le récepteur :

```yaml title="alertmanager.yaml"
route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/<secret key>"
        send_resolved: true
```

```bash
juju config --model observability alertmanager config_file=@alertmanager.yaml
```

### Le charm de l'exportateur

Si vous exécutez le charm `openstack-exporter` de Canonical, l'agent peut le lire sans identifiant propre. Il répond pour un seul cloud sur `/metrics`, sur le port `9180` sauf si vous avez modifié son paramètre `port`. Trouvez son adresse avec `juju status openstack-exporter` :

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Les séries qu'il expose dépendent de la version de l'exportateur dans son snap, qui n'a pas été enregistrée ici : `bash troubleshoot.sh` indique s'il lit le cloud.

### Journaux des services sur Sunbeam

Avec l'observabilité activée, le Loki de la stack contient les journaux des services. OneUptime n'a aucun moyen de lire Loki, et le profil de journaux de l'agent n'a pas été essayé sur les charms de Sunbeam : rien ici ne les collecte donc encore.

### Qui a fait quoi sur Sunbeam

Pas encore. Les charms de Sunbeam écrivent la configuration de chaque service à partir de leurs propres modèles, et son charm Keystone n'a aucun paramètre pour indiquer où vont les notifications. Ni la piste d'audit de Keystone ni le filtre d'audit ne peuvent donc être activés depuis l'extérieur du charm, et rien ici n'atteint les événements de sécurité.

## Red Hat OpenStack on OpenShift

Son Telemetry Operator exécute l'exportateur Prometheus de Ceilometer et une stack de supervision avec Alertmanager sur OpenShift. Le préréglage OpenShift de l'agent Kubernetes surveille le plan de contrôle, et l'exportateur de Ceilometer indique ce que font les nœuds de calcul.

### Transférer ce qui se déclenche sur Red Hat OpenStack on OpenShift

Si `MetricStorage` a `alertingEnabled` et que vous avez écrit ou appliqué des règles, appliquez un récepteur que la stack de supervision prend en compte :

```yaml title="alertmanager-config.yaml"
apiVersion: monitoring.rhobs/v1alpha1
kind: AlertmanagerConfig
metadata:
  name: oneuptime
  labels:
    service: metricStorage
spec:
  route:
    receiver: oneuptime
    groupBy: ["alertname", "instance"]
  receivers:
    - name: oneuptime
      webhookConfigs:
        - url: "https://oneuptime.com/heartbeat/<secret key>"
          sendResolved: true
```

### Lire les API, et le plan de contrôle

Ouvrez **OpenStack → Tous les clouds**, cliquez sur **Connecter le cloud**, et donnez-lui l'adresse de Keystone, un identifiant d'application et la sonde à utiliser. Une sonde ne parle qu'en HTTPS à un cloud. Suivez ensuite **Kubernetes → Documentation** sur le cluster qui exécute le plan de contrôle, en choisissant **Red Hat OpenShift**, ce qui définit `preset=openshift`.

Pour que les journaux de ces services figurent aussi sur la page **Journaux** de ce cloud, chaque trace de pile en un seul enregistrement, nommez le cloud dans les valeurs de l'agent, avec les namespaces dans lesquels s'exécutent ses services :

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Lire les nœuds de calcul via Ceilometer

Une sonde indique ce qui est alloué, pas ce qui est occupé. Pour lire l'utilisation réelle, exécutez l'agent sur une machine qui peut joindre les nœuds de calcul, avec `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` nommant chaque nœud sur le port de Ceilometer, `9101`.

### Qui a fait quoi sur Red Hat OpenStack on OpenShift

La piste d'audit de Keystone et le filtre d'audit de chaque API, vers les [événements de sécurité](/docs/telemetry/openstack#qui-a-fait-quoi). Chacun écrit dans le journal propre au service, sans consommateur sur le bus. OneUptime les lit à cet endroit dès que **Trouver des événements de sécurité dans vos journaux** est activé, sous **Événements de sécurité → Connexions**. L'agent Kubernetes lit les deux depuis les journaux des pods, avec le cloud nommé dans ses valeurs.

```yaml title="your OpenStackControlPlane"
spec:
  keystone:
    template:
      customServiceConfig: |
        [DEFAULT]
        notification_format = cadf
        notification_opt_out = identity.authenticate.pending
        
        [oslo_messaging_notifications]
        driver = log
```

Cela envoie une ligne pour chaque connexion, que lit **Identifiant admin OpenStack utilisé depuis une nouvelle adresse**. Pour n'envoyer que les connexions échouées, ajoutez `identity.authenticate.success` à `notification_opt_out`, et cette détection lit alors ce que le filtre d'audit a vu.

Pour savoir qui a fait quoi via Nova et Neutron, chacun prend le paramètre du filtre dans son `customServiceConfig`, et son fichier paste dans `defaultConfigOverwrite`. Les opérateurs de Cinder et de Glance n'acceptent aucun fichier paste : rien ici ne les atteint.

```yaml title="your OpenStackControlPlane"
spec:
  nova:
    template:
      apiServiceTemplate:
        customServiceConfig: |
          [audit_middleware_notifications]
          driver = log
```

## Mirantis MOSK

StackLight surveille déjà les services d'OpenStack, MariaDB, Memcached, RabbitMQ et libvirt, avec ses propres règles d'alerte. Transférez d'abord ses alertes, puis une sonde lit les API.

### Transférer ce qui se déclenche sur Mirantis MOSK

StackLight livre des règles d'alerte : cela fonctionne donc dès la première heure. Ajoutez le récepteur et sa route à vos valeurs StackLight. La documentation de Mirantis montre d'autres récepteurs plutôt qu'un webhook, et cela n'a pas été exécuté sur MOSK :

```yaml title="StackLight values"
alertmanagerSimpleConfig:
  genericReceivers:
    - name: oneuptime
      enabled: true
      webhook_configs:
        - url: "https://oneuptime.com/heartbeat/<secret key>"
          send_resolved: true
  genericRoutes:
    - receiver: oneuptime
      enabled: true
      matchers:
        - severity=~"warning|critical"
      continue: true
```

### Lire les API

Ouvrez **OpenStack → Tous les clouds**, cliquez sur **Connecter le cloud**, et donnez-lui l'adresse de Keystone, un identifiant d'application et la sonde à utiliser. Une sonde ne parle qu'en HTTPS à un cloud.

### Qui a fait quoi sur Mirantis MOSK

Pour savoir qui a fait quoi via Nova, Neutron, Cinder et Glance, MOSK a un paramètre qui lui est propre, avec le filtre d'audit déjà en place. Avec le pilote de journal, chaque service écrit sur sa sortie standard, et l'agent Kubernetes la lit depuis les journaux des pods, avec le cloud nommé dans ses valeurs. Chacun écrit dans le journal propre au service, sans consommateur sur le bus. OneUptime les lit à cet endroit dès que **Trouver des événements de sécurité dans vos journaux** est activé, sous **Événements de sécurité → Connexions**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

Ce paramètre ne couvre pas Keystone. Sa propre piste d'audit passe par `spec:services`, que Mirantis ne valide pas et dont il n'assume aucune responsabilité : pesez donc ceci avec votre contrat de support :

```yaml title="your OpenStackDeployment"
spec:
  services:
    identity:
      keystone:
        values:
          conf:
            keystone:
              DEFAULT:
                notification_format: cadf
                notification_opt_out: identity.authenticate.pending
              oslo_messaging_notifications:
                driver: log
```

Cela envoie une ligne pour chaque connexion, que lit **Identifiant admin OpenStack utilisé depuis une nouvelle adresse**. Pour n'envoyer que les connexions échouées, ajoutez `identity.authenticate.success` à `notification_opt_out`, et cette détection lit alors ce que le filtre d'audit a vu.

## Utiliser l'exportateur que vous exécutez déjà

Aucun identifiant et rien de nouveau à exécuter : l'agent peut lire un exportateur que vous avez déjà. La méthode dépend de la façon dont il a été démarré.

- **Avec `--multi-cloud`,** comme l'exécute l'agent lui-même : définissez `OPENSTACK_EXPORTER_ADDRESS`, et l'agent lui demande un service à la fois sur `/probe`.
- **Sans,** comme l'exécutent celui de Kolla-Ansible et le charm de Canonical : il n'a pas de `/probe`, donc définissez `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`, et l'agent lui demande tout en une fois sur `/metrics`, toutes les 2 minutes.

Sur Kolla-Ansible, il s'agit de sa VIP interne sur `9198` :

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Ce parcours s'ajoute au Prometheus propre à Kolla-Ansible, qui interroge toutes les minutes. Kolla-Ansible épingle l'exportateur 1.7.0, et sa réponse en dit aussi moins que l'exportateur épinglé par l'agent. Voici ce dont les pages se sont passées sur cinq vrais clouds, et un test les confronte à ces enregistrements :

| Ce dont on se passe | Parce que | Ce que cela coûte |
| --- | --- | --- |
| Tout ce qui vient de Cinder | Il demande `volumev3` au catalogue, et ne le trouve pas là où Cinder s'enregistre en `block-storage` | **Volumes** et **Pools de stockage** restent vides, et **Services** n'a ni API Block Storage, ni `cinder-volume`, ni `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** et **Volume Stuck** restent silencieux |
| Le nombre d'instances qu'un hyperviseur contient, et ses agrégats | La liste des hyperviseurs de Nova échoue à la microversion la plus récente, que demande Kolla-Ansible | Ces deux éléments sur **Hyperviseurs**, et ce que dit un hôte perdu sur ce qu'il emporte avec lui. Ses vCPU, sa mémoire et son disque sont toujours là : ils viennent de Placement |
| Domaines | Il n'a pas de telle série | **Domaines** reste vide |
| Le statut, la visibilité et la date de création d'une image | Il n'a pas de tels labels | Ces colonnes sur **Images**. **Image Stuck** reste silencieux : une image bloquée en route vers `active` passe donc inaperçue |
| Le MTU d'un réseau | Il n'a pas un tel label | Cette ligne sur la page d'un réseau |

Si vous en avez besoin, utilisez plutôt l'exportateur propre à l'agent. Vous pouvez changer d'avis plus tard : un cloud garde son nom quel que soit celui qui le lit.
