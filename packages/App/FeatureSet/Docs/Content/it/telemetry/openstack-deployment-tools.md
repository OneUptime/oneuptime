# OpenStack per strumento di distribuzione

Nessuno esegue "OpenStack". Si esegue uno strumento che lo distribuisce, e ogni strumento ha i propri percorsi, i propri log e la propria idea di cosa sia già in esecuzione. Questa pagina riporta ciò che la guida di configurazione in OneUptime dice per ciascuno: apri **OpenStack → All Clouds**, connetti un cloud e rispondi a **Come distribuisci OpenStack?**

:::cards
- [Fino a che punto è stata testata ogni guida](#fino-a-che-punto-è-stata-testata-ogni-guida): leggi prima questa. Quella di Kolla-Ansible è stata eseguita su una distribuzione reale, tranne l'avviso. Quella di OpenStack-Ansible è stata eseguita in parte. Le altre no.
- [Inoltra ciò che sta già scattando](#inoltra-ciò-che-sta-già-scattando): incidenti fin dalla prima ora, senza agente.
- [Kolla-Ansible](#kolla-ansible): leggi gli exporter che già esegue.
- [OpenStack-Ansible](#openstack-ansible): log di journald e override in `user_variables.yml`.
- [OpenStack-Helm](#openstack-helm) e [Atmosphere](#atmosphere): una sonda e l'agente Kubernetes.
- [Canonical Sunbeam](#canonical-sunbeam): il Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): il preset OpenShift e Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): gli avvisi di StackLight.
- [Usa l'exporter che già esegui](#usa-lexporter-che-già-esegui): cosa manca alle pagine con la 1.7.0.
:::

## Fino a che punto è stata testata ogni guida

Ogni percorso, porta e variabile qui sotto è stato letto dal sorgente o dalla documentazione dello strumento stesso. Il banco di prova che registra le fixture di OneUptime distribuisce anche Kolla-Ansible e OpenStack-Ansible su un runner CI, ed esegue lì i comandi delle rispettive guide, con un sostituto di OneUptime che conserva ciò che l'agente invia. Quindi nessuna guida qui ha mai riportato a un OneUptime in esecuzione da una distribuzione reale del proprio strumento. Ecco rispetto a cosa è stata verificata ciascuna:

| Strumento | Letto da | Eseguito davvero |
| --- | --- | --- |
| Kolla-Ansible | Il suo sorgente, a master e `stable/2026.1` | I comandi di questa guida, su un all-in-one reale a `stable/2026.1` con Open vSwitch: l'agente su ogni credenziale, senza Docker, sull'exporter di Kolla-Ansible e sul tuo alla versione fissata e alla 1.7.0, i target letti dal suo vero `prometheus.yml`, e il profilo dei log. Una parte non ha retto: con Memcached e nova-compute fermati lì, il suo Alertmanager non ha inviato nulla, quindi nessun avviso è mai arrivato da uno stack Kolla-Ansible a OneUptime. Ciò che Alertmanager invia alla versione che fissa, registrato in un cluster di test, ha aperto e risolto un incidente sul cloud giusto su un OneUptime in esecuzione |
| OpenStack-Ansible | Il suo sorgente e la documentazione | Un vero all-in-one a `stable/2026.1`, in container LXC, dove le impostazioni di RabbitMQ e HAProxy di questa guida sono state applicate con i suoi comandi e ogni exporter ha risposto, e il suo profilo dei log ha letto il journal. I suoi passaggi dell'agente non sono stati eseguiti su di esso: l'agente e il suo profilo dei log sono stati eseguiti su un cloud che questo strumento non aveva distribuito |
| OpenStack-Helm | I valori dei suoi chart | La sonda e l'agente Kubernetes, ciascuno per conto suo |
| Atmosphere | La sua documentazione e il sorgente | La sonda e l'agente Kubernetes, ciascuno per conto suo |
| Canonical Sunbeam | La documentazione di Canonical e il sorgente dei suoi charm | Nulla su Sunbeam. La documentazione di Sunbeam non menziona il charm dell'exporter |
| Red Hat OpenStack on OpenShift | Il sorgente del Telemetry Operator | Il preset OpenShift e l'exporter di Ceilometer, ciascuno per conto suo |
| Mirantis MOSK | La documentazione di Mirantis, i cui esempi mostrano altri receiver anziché un webhook | Nulla su MOSK |

Ciò che attiva **Chi ha fatto cosa** di ogni guida è stato registrato su DevStack, su ogni release che il banco di prova esegue, e su nessuno di questi strumenti. Dove ogni strumento lo porta è stato letto dal sorgente o dalla documentazione di quello strumento.

Oltre a questi, l'intero percorso è stato eseguito su un OneUptime attivo, avviato come lo avvia Docker Compose, con la sua app e la sua sonda compilate da questo codice, e su un vero DevStack anziché su uno di questi strumenti. L'agente, installato con i comandi della sua documentazione, ha registrato il cloud dai suoi primi dati, e ogni istanza, volume e hypervisor aveva una riga con lo stato che gli dava il cloud stesso. Con `nova-compute` realmente fermato, la sua riga è passata a down, un monitor del modello Compute Service Down ha aperto un incidente che nomina l'host 746 secondi dopo, ed è stato risolto 48 secondi dopo il riavvio del servizio. La sonda di un progetto ha connesso lo stesso cloud attraverso le route della dashboard e ne ha riletto le righe, e i 114 span di un avvio firmato sono arrivati attraverso i suoi servizi, dal profilo delle tracce.

Separatamente, ciò che un vero agente e un vero Alertmanager avevano inviato è stato registrato su DevStack e in un cluster di test, non su un cloud distribuito da uno di questi strumenti. Inviato a un OneUptime attivo, il webhook di firing ha aperto un solo incidente sul cloud giusto e su nessun altro, lo stesso webhook di nuovo non ha aperto nulla, e il webhook di resolved lo ha risolto.

## Inoltra ciò che sta già scattando

Qualsiasi strumento con un Alertmanager può avere incidenti da subito: un avviso che scatta diventa un incidente, con reperibilità e pagine di stato fin dalla prima ora, e si risolve quando si risolve l'avviso. Non c'è nulla da installare, e funziona insieme a tutto il resto in questa pagina.

:::steps
### Crea il monitor

Crea un monitor Incoming Request come indica [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#ricevere-gli-avvisi-con-un-monitor), e copia il suo **Heartbeat URL**. È l'indirizzo `<secret key>` nel receiver di ogni strumento qui sotto.

### Collegalo al cloud

Apri **Overview → Linked Resources** del monitor e aggiungi il cloud OpenStack. Ogni incidente compare poi nella pagina **Incidenti** di quel cloud: le impostazioni di un monitor Incoming Request non nominano nessun cloud, quindi l'Alertmanager di ogni cloud ha bisogno di un monitor proprio. Il cloud compare in quell'elenco quando arrivano i suoi primi dati, quindi fallo dopo i passaggi qui sotto, oppure aggiungi prima il cloud in **OpenStack → All Clouds**.
:::

Alertmanager è registrato mentre invia esattamente questa struttura in `Tests/Ops/openstack-e2e`, alla versione fissata da Kolla-Ansible, e la registrazione viene riprodotta nel vero valutatore: un incidente per avviso, risolto dal proprio stato `resolved`.

## Kolla-Ansible

Con `enable_prometheus` attivo in `/etc/kolla/globals.yml`, che Kolla-Ansible lascia disattivato finché non lo imposti, esegue Prometheus, Alertmanager e un exporter per ogni elemento sotto il cloud, e non fornisce regole di avviso. Questa guida legge ciò che quelli eseguono anziché avviarne una seconda copia.

### Inoltra ciò che sta scattando su Kolla-Ansible

Solo se hai scritto regole tue: Kolla-Ansible non ne fornisce nessuna, quindi nulla scatta finché `/etc/kolla/config/prometheus/*.rules` non ne contiene. Sull'host da cui esegui la distribuzione, scrivi `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, che Kolla-Ansible legge al posto del proprio, e applicalo:

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

### La credenziale su Kolla-Ansible

Accedi come admin con `source /etc/kolla/admin-openrc.sh`, che `kolla-ansible post-deploy` scrive.

- **Vista completa** non richiede modifiche a nessun servizio: i template di Kolla-Ansible impostano già `service_type` sotto `[keystone_authtoken]` su Nova, Neutron, Cinder, Glance e Placement. Il suo Cinder dice `volume`, che le regole di accesso includono anch'esse.
- **Solo infrastruttura** prende i suoi override in `/etc/kolla/config/nova/policy.yaml`, e lo stesso per `neutron`, `keystone` e `placement`, uniti a ciò che c'è già. Applicali con `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.

### Osserva ciò su cui poggia il cloud di Kolla-Ansible

Sull'host che esegue il Prometheus di Kolla-Ansible, questo legge i suoi target dal file che Kolla-Ansible ha generato e li stampa come impostazioni per l'agente:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Aggiungi ciò che stampa al `.env` dell'agente, poi esegui `docker compose up -d` nella cartella dell'agente. Ogni exporter è in ascolto sulla rete delle API, quindi la macchina dell'agente ha bisogno di una route verso di essa. La scheda **Piano di controllo** del cloud dice poi come sta ciascuno, e dice chiaramente quali non sono osservati.

| Legge | Porta | Impostazione |
| --- | --- | --- |
| Il plugin Prometheus di RabbitMQ | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| L'exporter proprio di HAProxy | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, per OVN e Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **I database di OVN:** Kolla-Ansible esegue openstack-network-exporter dalla 2026.1, solo sui nodi compute e di rete, e un database OVN viene letto dall'host su cui gira. Se i tuoi nodi di controllo non sono né l'uno né l'altro, aggiungili sotto `[prometheus-openstack-network-exporter:children]` nel tuo inventario e riconfigura, altrimenti i database Northbound e Southbound risultano non osservati.
- **Prima della 2026.1** non c'è nessun network exporter, quindi OVN e Open vSwitch risultano non osservati.

### Log dei servizi su Kolla-Ansible

Il profilo dei log dell'agente gira su ogni nodo e legge i file di Kolla-Ansible. È ciò che collega una riga alle pagine del cloud:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Anche il Fluentd di Kolla può inoltrare, con un output in `/etc/kolla/config/fluentd/output/*.conf` come descrive [Fluentd](/docs/telemetry/fluentd), ma quei record arrivano in **Registri** sotto il nome di un servizio, e non nelle pagine del cloud.

### Chi ha fatto cosa su Kolla-Ansible

L'audit trail di Keystone e il filtro di audit su ogni API, in [Eventi di sicurezza](/docs/telemetry/openstack#chi-ha-fatto-cosa). Ciascuno scrive nel log del proprio servizio, senza nessun consumer sul bus. OneUptime li legge da lì una volta attivata l'opzione **Trova eventi di sicurezza nei tuoi log**, sotto **Eventi di sicurezza → Connessioni**. Il profilo dei log dell'agente legge entrambi da `/var/log/kolla`.

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

Questo invia una riga per ogni login, che **OpenStack admin credential used from a new address** legge. Per inviare solo i login falliti, aggiungi `identity.authenticate.success` a `notification_opt_out`, e quel rilevamento legge allora ciò che ha visto il filtro di audit.

Per sapere chi ha fatto cosa attraverso Nova, Neutron, Cinder e Glance, il filtro di audit richiede un'impostazione, che va nella configurazione di ogni servizio in una volta sola:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

Richiede anche un file paste, e i task di configurazione di Kolla-Ansible non copiano nessun file paste per questi servizi. Mettilo tu su ogni host API e montalo sopra quello nell'immagine con `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` e `glance_api_extra_volumes` in `globals.yml`. I file di mappa di pyCADF sono in `/var/lib/kolla/venv/etc/pycadf` nell'immagine. [Chi ha fatto cosa](/docs/telemetry/openstack#attiva-il-filtro-di-audit) contiene le righe del filtro.

## OpenStack-Ansible

OpenStack-Ansible conserva i log dei suoi servizi in journald e non esegue un Prometheus proprio, quindi la via d'accesso è l'agente, e i log hanno un percorso a sé.

### La credenziale su OpenStack-Ansible

Accedi come admin dal container utility: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, poi `. ~/openrc`. Non ha `curl`, che i comandi qui sotto usano, quindi esegui prima lì `apt-get install -y curl`.

- **Vista completa** non richiede modifiche a nessun servizio: i ruoli di OpenStack-Ansible impostano già `service_type` sotto `[keystone_authtoken]`. Il suo Cinder dice `volumev3`, che le regole di accesso includono anch'esse.
- **Solo infrastruttura** prende i suoi override come `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` e `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Applica ciascuno con il proprio playbook e tag, come `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Rimuoverne uno in seguito lascia un file vuoto anziché nessuno, quindi nulla fallisce.

### Osserva ciò su cui poggia il cloud di OpenStack-Ansible

OpenStack-Ansible non esegue exporter per questi, quindi viene osservato solo ciò che attivi.

**RabbitMQ:** attiva il suo plugin Prometheus, poi indica l'indirizzo di ogni container sulla `15692` come `OPENSTACK_RABBITMQ_TARGETS` nel `.env` dell'agente:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** il suo exporter è disattivato, e il suo listener delle statistiche è su `127.0.0.1` con TLS, che l'agente non può leggere. Attivalo dove l'agente può raggiungerlo, poi indica quell'indirizzo sulla `1936` come `OPENSTACK_HAPROXY_TARGETS`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB e Memcached:** OpenStack-Ansible non fornisce nessun exporter per nessuno dei due. Esegui tu [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) e [memcached_exporter](https://github.com/prometheus/memcached_exporter) e indicali come `OPENSTACK_MARIADB_TARGETS` e `OPENSTACK_MEMCACHED_TARGETS`, oppure escludili: la scheda **Piano di controllo** del cloud dice allora che non sono osservati, anziché che stanno bene.

### Log dei servizi su OpenStack-Ansible

Da journald, su ogni host che esegue un servizio: i container passano i loro journal all'host.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

Questo esegue il profilo dei log dell'agente come servizio systemd e legge `/var/log/journal/`, dove arrivano i journal dei container di OpenStack-Ansible.

### Chi ha fatto cosa su OpenStack-Ansible

L'audit trail di Keystone e il filtro di audit su ogni API, in [Eventi di sicurezza](/docs/telemetry/openstack#chi-ha-fatto-cosa). Ciascuno scrive nel log del proprio servizio, senza nessun consumer sul bus. OneUptime li legge da lì una volta attivata l'opzione **Trova eventi di sicurezza nei tuoi log**, sotto **Eventi di sicurezza → Connessioni**. Il profilo dei log dell'agente legge entrambi dal journal.

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

Questo invia una riga per ogni login, che **OpenStack admin credential used from a new address** legge. Per inviare solo i login falliti, aggiungi `identity.authenticate.success` a `notification_opt_out`, e quel rilevamento legge allora ciò che ha visto il filtro di audit. Un secondo valore di `notification_opt_out` va inserito come insieme YAML, come [il suo config_template](https://docs.openstack.org/ansible-config_template/latest/) scrive una chiave ripetuta.

Per sapere chi ha fatto cosa attraverso Nova, Neutron, Cinder e Glance, ogni API prende l'impostazione del filtro nei suoi conf override, e il filtro nei suoi paste override, con `audit` subito dopo `authtoken` e il filtro di contesto che lo segue in ogni pipeline. Quello di Nova, e lo stesso in `neutron_neutron_conf_overrides` e `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` e `cinder_api_paste_ini_overrides`, e `glance_glance_api_conf_overrides` e `glance_glance_api_paste_ini_overrides`:

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

OpenStack-Helm offre chart per Prometheus, Alertmanager ed exporter, e se siano in esecuzione dipende da te. Il suo piano di controllo gira in Kubernetes, quindi una sonda legge le API e l'agente Kubernetes vede i pod.

### Inoltra ciò che sta scattando su OpenStack-Helm

Se esegui il suo chart prometheus-alertmanager, aggiungi il receiver sotto `conf.alertmanager` nei valori del chart, e indirizza la tua route verso di esso:

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

### Leggi le API e vedi i pod su OpenStack-Helm

Apri **OpenStack → All Clouds**, fai clic su **Connetti cloud** e indica l'indirizzo di Keystone, una application credential e la sonda da usare. Una sonda parla con un cloud solo in HTTPS. Poi segui **Kubernetes → Documentazione** per il cluster su cui girano i chart: i suoi pod, i loro log e i suoi nodi arrivano alle pagine Kubernetes.

Per avere i log di quei servizi anche nella pagina **Registri** di questo cloud, con ogni stack trace in un unico record, indica il cloud nei valori dell'agente, con i namespace in cui girano i suoi servizi:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Chi ha fatto cosa su OpenStack-Helm

L'audit trail di Keystone e il filtro di audit su ogni API, in [Eventi di sicurezza](/docs/telemetry/openstack#chi-ha-fatto-cosa). Ciascuno scrive nel log del proprio servizio, senza nessun consumer sul bus. OneUptime li legge da lì una volta attivata l'opzione **Trova eventi di sicurezza nei tuoi log**, sotto **Eventi di sicurezza → Connessioni**. L'agente Kubernetes legge entrambi dai log dei pod, con il cloud indicato nei suoi valori.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

Questo invia una riga per ogni login, che **OpenStack admin credential used from a new address** legge. Per inviare solo i login falliti, aggiungi `identity.authenticate.success` a `notification_opt_out`, e quel rilevamento legge allora ciò che ha visto il filtro di audit.

Il `logging.conf` di un chart tiene il root logger a `WARNING`, e il driver dei log scrive sotto un logger proprio, quindi senza uno per esso non viene scritto nulla. Una lista nei valori sostituisce quella del chart, quindi `keys` contiene ciò che contiene quella del chart, più questo:

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

Per sapere chi ha fatto cosa attraverso Nova, Neutron e Cinder, il `conf.paste` dei loro chart ha già il filtro di audit in ogni pipeline, e bisogna solo dirgli dove scrivere. Ciascuno richiede lo stesso logger, in `conf.logging`. Il chart di Glance ha la mappa, ma né il filtro né un posto per esso nelle sue pipeline: aggiungi entrambi al suo `conf.paste`.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere esegue kube-prometheus-stack con le proprie regole di avviso, e Loki con Vector per i log. Inoltra prima i suoi avvisi, poi una sonda legge le API e l'agente Kubernetes vede i pod.

### Inoltra ciò che sta scattando su Atmosphere

Atmosphere fornisce regole di avviso che hanno chiamato persone reali, quindi funziona fin dalla prima ora. Aggiungi il receiver alla configurazione di Atmosphere, accanto ai receiver che hai già, e distribuiscila:

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

### Leggi le API e vedi i pod su Atmosphere

Apri **OpenStack → All Clouds**, fai clic su **Connetti cloud** e indica l'indirizzo di Keystone, una application credential e la sonda da usare. Una sonda parla con un cloud solo in HTTPS. Poi segui **Kubernetes → Documentazione** per il cluster su cui gira Atmosphere.

Per avere i log di quei servizi anche nella pagina **Registri** di questo cloud, con ogni stack trace in un unico record, indica il cloud nei valori dell'agente, con i namespace in cui girano i suoi servizi:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Chi ha fatto cosa su Atmosphere

L'audit trail di Keystone e il filtro di audit su ogni API, in [Eventi di sicurezza](/docs/telemetry/openstack#chi-ha-fatto-cosa). Ciascuno scrive nel log del proprio servizio, senza nessun consumer sul bus. OneUptime li legge da lì una volta attivata l'opzione **Trova eventi di sicurezza nei tuoi log**, sotto **Eventi di sicurezza → Connessioni**. L'agente Kubernetes legge entrambi dai log dei pod, con il cloud indicato nei suoi valori.

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

Questo invia una riga per ogni login, che **OpenStack admin credential used from a new address** legge. Per inviare solo i login falliti, aggiungi `identity.authenticate.success` a `notification_opt_out`, e quel rilevamento legge allora ciò che ha visto il filtro di audit.

Per sapere chi ha fatto cosa attraverso Nova, Neutron e Cinder, i chart che Atmosphere distribuisce hanno già il filtro di audit in ogni pipeline, e bisogna solo dirgli dove scrivere, in `nova_helm_values`, `neutron_helm_values` e `cinder_helm_values`. Il chart di Glance non ha né il filtro né un posto per esso nelle sue pipeline: aggiungi entrambi al suo `conf.paste`, in `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam può distribuire il Canonical Observability Stack, con `sunbeam enable observability embedded`. Canonical ha anche un charm `openstack-exporter`, che l'agente può leggere se lo esegui. La documentazione di Sunbeam non menziona quel charm, e nulla qui è stato eseguito su Sunbeam.

### Inoltra ciò che sta scattando su Sunbeam

Se esegui il Canonical Observability Stack, dai al suo Alertmanager una configurazione che contenga il receiver:

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

### Il charm dell'exporter

Se esegui il charm `openstack-exporter` di Canonical, l'agente può leggerlo senza una credenziale propria. Risponde per un solo cloud su `/metrics`, sulla porta `9180` a meno che tu non abbia cambiato la sua impostazione `port`. Trova il suo indirizzo con `juju status openstack-exporter`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Quali serie riporta dipende dalla release dell'exporter nel suo snap, che qui non è stata registrata: `bash troubleshoot.sh` dice se legge il cloud.

### Log dei servizi su Sunbeam

Con l'osservabilità attiva, il Loki dello stack contiene i log dei servizi. OneUptime non ha modo di leggere Loki, e il profilo dei log dell'agente non è stato provato sui charm di Sunbeam, quindi per ora nulla qui li raccoglie.

### Chi ha fatto cosa su Sunbeam

Non ancora. I charm di Sunbeam scrivono la configurazione di ogni servizio dai propri template, e il suo charm Keystone non ha un'impostazione per dove vanno le notifiche. Quindi né l'audit trail di Keystone né il filtro di audit possono essere attivati dall'esterno del charm, e nulla qui arriva a Eventi di sicurezza.

## Red Hat OpenStack on OpenShift

Il suo Telemetry Operator esegue l'exporter Prometheus di Ceilometer e uno stack di monitoraggio con Alertmanager su OpenShift. Il preset OpenShift dell'agente Kubernetes osserva il piano di controllo, e l'exporter di Ceilometer dice cosa stanno facendo i nodi compute.

### Inoltra ciò che sta scattando su Red Hat OpenStack on OpenShift

Se `MetricStorage` ha `alertingEnabled` e hai scritto o applicato delle regole, applica un receiver che lo stack di monitoraggio recepisca:

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

### Leggi le API e il piano di controllo

Apri **OpenStack → All Clouds**, fai clic su **Connetti cloud** e indica l'indirizzo di Keystone, una application credential e la sonda da usare. Una sonda parla con un cloud solo in HTTPS. Poi segui **Kubernetes → Documentazione** sul cluster che esegue il piano di controllo, con **Red Hat OpenShift** selezionato, che imposta `preset=openshift`.

Per avere i log di quei servizi anche nella pagina **Registri** di questo cloud, con ogni stack trace in un unico record, indica il cloud nei valori dell'agente, con i namespace in cui girano i suoi servizi:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Leggi i nodi compute tramite Ceilometer

Una sonda dice cosa è allocato, non cosa è occupato. Per leggere l'utilizzo reale, esegui l'agente su una macchina che possa raggiungere i nodi compute, con `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` che nomina ogni nodo sulla porta di Ceilometer, `9101`.

### Chi ha fatto cosa su Red Hat OpenStack on OpenShift

L'audit trail di Keystone e il filtro di audit su ogni API, in [Eventi di sicurezza](/docs/telemetry/openstack#chi-ha-fatto-cosa). Ciascuno scrive nel log del proprio servizio, senza nessun consumer sul bus. OneUptime li legge da lì una volta attivata l'opzione **Trova eventi di sicurezza nei tuoi log**, sotto **Eventi di sicurezza → Connessioni**. L'agente Kubernetes legge entrambi dai log dei pod, con il cloud indicato nei suoi valori.

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

Questo invia una riga per ogni login, che **OpenStack admin credential used from a new address** legge. Per inviare solo i login falliti, aggiungi `identity.authenticate.success` a `notification_opt_out`, e quel rilevamento legge allora ciò che ha visto il filtro di audit.

Per sapere chi ha fatto cosa attraverso Nova e Neutron, ciascuno prende l'impostazione del filtro nel proprio `customServiceConfig`, e il proprio file paste in `defaultConfigOverwrite`. Gli operator di Cinder e Glance non accettano nessun file paste, quindi nulla qui li raggiunge.

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

StackLight osserva già i servizi di OpenStack, MariaDB, Memcached, RabbitMQ e libvirt, con le proprie regole di avviso. Inoltra prima i suoi avvisi, poi una sonda legge le API.

### Inoltra ciò che sta scattando su Mirantis MOSK

StackLight fornisce regole di avviso, quindi funziona fin dalla prima ora. Aggiungi il receiver e la sua route ai valori di StackLight. La documentazione di Mirantis mostra altri receiver anziché un webhook, e questo non è stato eseguito su MOSK:

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

### Leggi le API

Apri **OpenStack → All Clouds**, fai clic su **Connetti cloud** e indica l'indirizzo di Keystone, una application credential e la sonda da usare. Una sonda parla con un cloud solo in HTTPS.

### Chi ha fatto cosa su Mirantis MOSK

Per sapere chi ha fatto cosa attraverso Nova, Neutron, Cinder e Glance, MOSK ha un'impostazione propria, con il filtro di audit già presente. Con il driver dei log, ogni servizio scrive sul proprio standard output, e l'agente Kubernetes lo legge dai log dei pod, con il cloud indicato nei suoi valori. Ciascuno scrive nel log del proprio servizio, senza nessun consumer sul bus. OneUptime li legge da lì una volta attivata l'opzione **Trova eventi di sicurezza nei tuoi log**, sotto **Eventi di sicurezza → Connessioni**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

Quell'impostazione non copre Keystone. Il suo audit trail usa `spec:services`, che Mirantis non convalida e di cui non si assume alcuna responsabilità, quindi valutalo in base al tuo contratto di supporto:

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

Questo invia una riga per ogni login, che **OpenStack admin credential used from a new address** legge. Per inviare solo i login falliti, aggiungi `identity.authenticate.success` a `notification_opt_out`, e quel rilevamento legge allora ciò che ha visto il filtro di audit.

## Usa l'exporter che già esegui

Nessuna credenziale e nulla di nuovo da eseguire: l'agente può leggere un exporter che hai già. Come dipende da come è stato avviato.

- **Con `--multi-cloud`,** come eseguono quelli dell'agente stesso: imposta `OPENSTACK_EXPORTER_ADDRESS`, e l'agente gli chiede un servizio alla volta su `/probe`.
- **Senza,** come eseguono quello di Kolla-Ansible e il charm di Canonical: non ha `/probe`, quindi imposta `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`, e l'agente gli chiede tutto in una volta su `/metrics`, ogni 2 minuti.

Su Kolla-Ansible è il suo VIP interno sulla `9198`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Quella lettura si aggiunge al Prometheus di Kolla-Ansible che interroga ogni minuto. Kolla-Ansible fissa la versione 1.7.0 dell'exporter, e la sua risposta dice anche meno dell'exporter che l'agente fissa. Questo è ciò che mancava alle pagine su cinque cloud reali, e un test lo confronta con quelle registrazioni:

| Cosa manca | Perché | Cosa costa |
| --- | --- | --- |
| Tutto ciò che riguarda Cinder | Chiede al catalogo `volumev3` e non lo trova dove Cinder si registra come `block-storage` | **Volumi** e **Pool di archiviazione** restano vuoti, e **Servizi** non ha Block Storage API, `cinder-volume` né `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** e **Volume Stuck** restano silenziosi |
| Quante istanze contiene un hypervisor, e i suoi aggregati | L'elenco degli hypervisor di Nova fallisce alla microversion più recente, che Kolla-Ansible richiede | Quei due elementi in **Hypervisor**, e ciò che dice un host perso che si porta dietro. Le sue vCPU, memoria e disco ci sono ancora: vengono da Placement |
| Domini | Non ha nessuna serie del genere | **Domini** resta vuoto |
| Stato, visibilità e data di creazione di un'immagine | Non ha nessuna etichetta del genere | Quelle colonne in **Immagini**. **Image Stuck** resta silenzioso, quindi un'immagine bloccata nel passaggio a `active` passa inosservata |
| L'MTU di una rete | Non ha nessuna etichetta del genere | Quella riga nella pagina di una rete |

Se ti servono, usa invece l'exporter dell'agente. Puoi cambiare idea in seguito: un cloud mantiene il suo nome qualunque cosa lo legga.
