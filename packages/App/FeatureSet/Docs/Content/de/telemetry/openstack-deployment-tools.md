# OpenStack nach Bereitstellungswerkzeug

Niemand betreibt „OpenStack“. Man betreibt ein Tool, das es bereitstellt, und jedes Tool hat seine eigenen Pfade, seine eigenen Protokolle und seine eigene Vorstellung davon, was schon läuft. Diese Seite gibt wieder, was die Einrichtungsanleitung in OneUptime für jedes davon sagt: Öffnen Sie **OpenStack → Dokumentation** und beantworten Sie **Wie stellen Sie OpenStack bereit?**

:::cards
- [Wie weit jede Anleitung getestet wurde](#wie-weit-jede-anleitung-getestet-wurde): Lesen Sie das zuerst. Die für Kolla-Ansible wurde auf einer echten Bereitstellung ausgeführt, bis auf eine Warnung. Die für OpenStack-Ansible wurde teilweise ausgeführt. Die anderen nicht.
- [Weiterleiten, was bereits ausgelöst wird](#weiterleiten-was-bereits-ausgelöst-wird): Vorfälle ab der ersten Stunde, ohne Agent.
- [Kolla-Ansible](#kolla-ansible): Die Exporter lesen, die es bereits betreibt.
- [OpenStack-Ansible](#openstack-ansible): Journald-Protokolle und Overrides in `user_variables.yml`.
- [OpenStack-Helm](#openstack-helm): Eine Sonde und der Kubernetes-Agent, ebenso bei [Atmosphere](#atmosphere).
- [Canonical Sunbeam](#canonical-sunbeam): Der Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): Das OpenShift-Preset und Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): Die Warnungen von StackLight.
- [Den Exporter verwenden, den Sie bereits betreiben](#den-exporter-verwenden-den-sie-bereits-betreiben): Worauf die Seiten mit 1.7.0 verzichten.
:::

## Wie weit jede Anleitung getestet wurde

Jeder Pfad, jeder Port und jede Variable unten wurde aus dem Quellcode oder den Dokumenten des jeweiligen Tools gelesen. Die Anleitungen von Kolla-Ansible und OpenStack-Ansible wurden außerdem auf echten Bereitstellungen befolgt, mit ihren eigenen Befehlen und einem Platzhalter für OneUptime, der festhält, was der Agent sendet. Keine Anleitung hier hat also von einer echten Bereitstellung ihres Tools aus an ein laufendes OneUptime berichtet. Wogegen jede geprüft wurde:

| Tool | Gelesen aus | Echt ausgeführt |
| --- | --- | --- |
| Kolla-Ansible | Sein Quellcode, bei master und `stable/2026.1` | Die Befehle dieser Anleitung, auf einem echten All-in-One bei `stable/2026.1` mit Open vSwitch: der Agent mit der Credential für die Vollansicht, ohne Docker, mit dem eigenen Exporter von Kolla-Ansible und mit Ihrem eigenen in der angepinnten Version und in 1.7.0, der Exporter des Agents mit der Credential „Nur Infrastruktur“, die Ziele aus seiner echten `prometheus.yml` gelesen, und das Logs-Profil. Bei dort wirklich angehaltenem Memcached sendete sein Alertmanager einen Firing-Webhook und danach einen Resolved-Webhook, und was er sendete, an ein laufendes OneUptime geschickt, öffnete einen Vorfall in der richtigen Cloud und in keiner anderen und löste ihn auf |
| OpenStack-Ansible | Sein Quellcode und seine Dokumente | Die Befehle dieser Anleitung, auf einem echten All-in-One bei `stable/2026.1`, in LXC-Containern: der Agent mit der Credential für die Vollansicht, der Exporter des Agents mit der Credential „Nur Infrastruktur“ samt seinen Policy-Überschreibungen, die RabbitMQ- und HAProxy-Einstellungen, die der Agent jeweils las, und das Logs-Profil auf dem Journal |
| OpenStack-Helm | Seine Chart-Werte | Nichts auf OpenStack-Helm. Die Sonde und der Kubernetes-Agent wurden jeweils für sich getestet |
| Atmosphere | Seine Dokumente und sein Quellcode | Nichts auf Atmosphere. Die Sonde und der Kubernetes-Agent wurden jeweils für sich getestet |
| Canonical Sunbeam | Die Dokumente von Canonical und der Quellcode seiner Charms | Nichts auf Sunbeam. Die eigenen Dokumente von Sunbeam erwähnen den Exporter-Charm nicht |
| Red Hat OpenStack on OpenShift | Der Quellcode des Telemetry Operators | Nichts auf der Distribution von Red Hat. Das OpenShift-Preset und der Exporter von Ceilometer wurden jeweils für sich getestet |
| Mirantis MOSK | Die Dokumente von Mirantis, deren Beispiele andere Empfänger statt eines Webhooks zeigen | Nichts auf MOSK |

Was **Wer was getan hat** in jeder Anleitung voraussetzt, wurde auf DevStack aufgezeichnet und auf keinem dieser Tools. Wo jedes Tool es aufnimmt, wurde aus dem Quellcode oder den Dokumenten dieses Tools gelesen.

Daneben ist der gesamte Weg auf einem laufenden OneUptime gelaufen, gestartet so, wie Docker Compose es startet, und auf einem echten DevStack statt auf einem dieser Tools. Der Agent, mit den Befehlen seiner Dokumente installiert, hat die Cloud aus seinen ersten Daten registriert, und jede Instanz, jedes Volume und jeder Hypervisor hatte eine Zeile mit dem Status, den die Cloud selbst angab. Bei wirklich angehaltenem `nova-compute` ging seine Zeile auf ausgefallen, ein Monitor aus der Vorlage Compute Service Down öffnete etwa 12 Minuten später einen Vorfall, der den Host nannte, und er wurde innerhalb einer Minute nach dem erneuten Start des Dienstes aufgelöst. Die Sonde eines Projekts verband dieselbe Cloud über die eigenen Routen des Dashboards und las ihre Zeilen zurück, und die 114 Spans eines signierten Boots kamen über seine Dienste hinweg an, aus dem Traces-Profil.

Getrennt davon wurde aufgezeichnet, was ein echter Agent auf DevStack gesendet hat und was der Alertmanager von Kolla-Ansible gepostet hat, und dann an ein laufendes OneUptime gesendet: Der Webhook für „firing“ öffnete einen Vorfall in der richtigen Cloud und in keiner anderen, derselbe Webhook noch einmal öffnete nichts, und der Webhook für „resolved“ löste ihn auf.

## Weiterleiten, was bereits ausgelöst wird

Jedes Tool mit einem Alertmanager kann schon heute Vorfälle haben: Eine ausgelöste Warnung wird zu einem Vorfall, mit Rufbereitschaft und Statusseiten ab der ersten Stunde, und er wird aufgelöst, wenn die Warnung es wird. Es gibt nichts zu installieren, und das funktioniert neben allem anderen auf dieser Seite.

:::steps
### Den Monitor erstellen

Erstellen Sie einen Monitor vom Typ Incoming Request, wie [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#warnungen-mit-einem-monitor-empfangen) es beschreibt, und kopieren Sie seine **Heartbeat-URL**. Das ist die Adresse `<secret key>` im Empfänger jedes Tools unten.

### Ihn der Cloud zuordnen

Öffnen Sie **Übersicht → Verknüpfte Ressourcen** des Monitors und fügen Sie die OpenStack-Cloud hinzu. Jeder Vorfall steht dann auf der Seite **Vorfälle** dieser Cloud: Die eigenen Einstellungen eines Incoming-Request-Monitors nennen keine Cloud, daher braucht der Alertmanager jeder Cloud einen eigenen Monitor. Die Cloud erscheint in dieser Liste, sobald ihre ersten Daten eintreffen, tun Sie dies also nach den Schritten unten, oder fügen Sie die Cloud zuerst unter **OpenStack → Alle Clouds** hinzu.
:::

Alertmanager wurde in der Version, die Kolla-Ansible anpinnt, aufgezeichnet, wie er in genau dieser Form sendet, und was er sendete, öffnete auf einem laufenden OneUptime einen Vorfall, den sein eigener Status `resolved` auflöste.

## Kolla-Ansible

Mit `enable_prometheus` in `/etc/kolla/globals.yml`, was Kolla-Ansible ausgeschaltet lässt, bis Sie es setzen, betreibt es Prometheus, Alertmanager und einen Exporter für alles unter der Cloud und liefert keine Warnregeln mit. Diese Anleitung liest, was diese betreiben, statt eine zweite Kopie zu starten.

### Weiterleiten, was bei Kolla-Ansible ausgelöst wird

Nur wenn Sie eigene Regeln geschrieben haben: Kolla-Ansible liefert keine mit, daher wird nichts ausgelöst, bis `/etc/kolla/config/prometheus/*.rules` welche enthält. Schreiben Sie auf dem Host, von dem aus Sie bereitstellen, `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, die Kolla-Ansible anstelle seiner eigenen liest, und wenden Sie sie an:

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

### Die Credential bei Kolla-Ansible

Melden Sie sich mit `source /etc/kolla/admin-openrc.sh` als Admin an, was `kolla-ansible post-deploy` schreibt.

- **Vollansicht** braucht eine Änderung, an Cinder. Die Templates von Kolla-Ansible setzen `service_type` unter `[keystone_authtoken]` bei Nova, Neutron, Glance und Placement bereits, aber sein Cinder sagt `volume`, und sein Katalog sagt `block-storage`, und keystonemiddleware weist eine durch Zugriffsregeln eingeschränkte Zugangsdaten-Kennung mit einem `401` ab, wenn beide nicht übereinstimmen. Fügen Sie `service_type = block-storage` unter `[keystone_authtoken]` in `/etc/kolla/config/cinder.conf` hinzu und führen Sie dann `kolla-ansible reconfigure -i <inventory> --tags cinder` aus.
- **Nur Infrastruktur** nimmt seine Overrides unter `/etc/kolla/config/nova/policy.yaml` auf, und ebenso für `neutron`, `keystone` und `placement`, zusammengeführt mit allem, was dort schon steht. Wenden Sie sie mit `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement` an.

### Beobachten, worauf die Cloud von Kolla-Ansible aufbaut

Auf dem Host, der das Prometheus von Kolla-Ansible betreibt, liest dies seine Ziele aus der Datei, die Kolla-Ansible gerendert hat, und gibt sie als Einstellungen für den Agent aus:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Fügen Sie, was es ausgibt, zur `.env` des Agents hinzu und führen Sie dann `docker compose up -d` im Ordner des Agents aus. Jeder Exporter lauscht im API-Netzwerk, daher braucht der Rechner des Agents eine Route dorthin. Die Karte **Steuerungsebene** der Cloud sagt dann, wie es jedem geht, und sagt unmissverständlich, welche nicht beobachtet werden.

| Liest | Port | Einstellung |
| --- | --- | --- |
| Das Prometheus-Plugin von RabbitMQ | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| Der eigene Exporter von HAProxy | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, für OVN und Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **Die Datenbanken von OVN:** Kolla-Ansible betreibt openstack-network-exporter ab 2026.1, nur auf Compute- und Netzwerk-Nodes, und eine OVN-Datenbank wird von dem Host gelesen, auf dem sie läuft. Sind Ihre Control-Nodes keines von beidem, fügen Sie sie in Ihrem Inventory unter `[prometheus-openstack-network-exporter:children]` hinzu und konfigurieren Sie neu, sonst gelten die Northbound- und Southbound-Datenbank als nicht beobachtet.
- **Vor 2026.1** gibt es keinen Netzwerk-Exporter, daher gelten OVN und Open vSwitch als nicht beobachtet.

### Dienstprotokolle bei Kolla-Ansible

Das Logs-Profil des Agents läuft auf jedem Node und liest die Dateien von Kolla-Ansible. Es verbindet eine Zeile mit den Seiten der Cloud:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Auch das Fluentd von Kolla kann weiterleiten, mit einer Ausgabe in `/etc/kolla/config/fluentd/output/*.conf`, wie [Fluentd](/docs/telemetry/fluentd) es beschreibt, doch diese Einträge erreichen **Protokolle** unter dem Namen eines Dienstes und nicht die Seiten der Cloud.

### Wer was getan hat bei Kolla-Ansible

Der Audit-Trail von Keystone und der Audit-Filter jeder API, in die [Sicherheitsereignisse](/docs/telemetry/openstack#wer-was-getan-hat). Jeder schreibt in das eigene Protokoll des Dienstes, ohne Konsumenten am Bus. OneUptime liest sie von dort, sobald **Sicherheitsereignisse in Ihren Protokollen finden** aktiviert ist, unter **Sicherheitsereignisse → Verbindungen**. Das Logs-Profil des Agents liest beide aus `/var/log/kolla`.

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

Das sendet eine Zeile pro Anmeldung, die **OpenStack admin credential used from a new address** liest. Um nur fehlgeschlagene Anmeldungen zu senden, fügen Sie `identity.authenticate.success` zu `notification_opt_out` hinzu, und diese Erkennung liest dann, was der Audit-Filter gesehen hat.

Für Wer-was-getan-hat über Nova, Neutron, Cinder und Glance braucht der Audit-Filter eine Einstellung, die in die Konfiguration jedes Dienstes auf einmal gehört:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

Er braucht außerdem eine Paste-Datei, und die Konfigurationsaufgaben von Kolla-Ansible kopieren für diese Dienste keine. Legen Sie Ihre auf jedem API-Host ab und mounten Sie sie mit `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` und `glance_api_extra_volumes` in `globals.yml` über die im Image. Die Map-Dateien von pyCADF liegen im Image unter `/var/lib/kolla/venv/etc/pycadf`. [Wer was getan hat](/docs/telemetry/openstack#den-audit-filter-einschalten) enthält die Zeilen des Filters.

## OpenStack-Ansible

OpenStack-Ansible hält die Protokolle seiner Dienste in journald und betreibt kein eigenes Prometheus, daher ist der Agent der Weg hinein, und die Protokolle haben einen eigenen Pfad.

### Die Credential bei OpenStack-Ansible

Melden Sie sich im Utility-Container als Admin an: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, dann `. ~/openrc`. Er hat kein `curl`, das die Befehle unten verwenden, führen Sie dort daher zuerst `apt-get install -y curl` aus.

- **Vollansicht** braucht eine Änderung, an Cinder. Die Rollen von OpenStack-Ansible setzen `service_type` unter `[keystone_authtoken]` bereits, aber sein Cinder sagt `volumev3`, und sein Katalog sagt `block-storage`, und keystonemiddleware weist eine durch Zugriffsregeln eingeschränkte Zugangsdaten-Kennung mit einem `401` ab, wenn beide nicht übereinstimmen. Setzen Sie `service_type: block-storage` unter `keystone_authtoken` in `cinder_cinder_conf_overrides` in `/etc/openstack_deploy/user_variables.yml` und führen Sie dann `openstack-ansible openstack.osa.cinder --tags cinder-config` aus.
- **Nur Infrastruktur** nimmt seine Overrides als `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` und `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml` auf. Wenden Sie jeden mit seinem eigenen Playbook und Tag an, etwa `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Das spätere Entfernen eines Overrides hinterlässt eine leere Datei statt keiner, sodass nichts fehlschlägt.

### Beobachten, worauf die Cloud von OpenStack-Ansible aufbaut

OpenStack-Ansible betreibt dafür keine Exporter, daher wird nur beobachtet, was Sie einschalten.

**RabbitMQ:** Schalten Sie sein Prometheus-Plugin ein und nennen Sie dann die Adresse jedes Containers auf `15692` als `OPENSTACK_RABBITMQ_TARGETS` in der `.env` des Agents:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** Sein Exporter ist aus, und sein Stats-Listener liegt auf `127.0.0.1` mit TLS, was der Agent nicht lesen kann. Schalten Sie ihn dort ein, wo der Agent ihn erreicht, und nennen Sie dann diese Adresse auf `1936` als `OPENSTACK_HAPROXY_TARGETS`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB und Memcached:** OpenStack-Ansible liefert für keines einen Exporter mit. Betreiben Sie [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) und [memcached_exporter](https://github.com/prometheus/memcached_exporter) selbst und nennen Sie sie als `OPENSTACK_MARIADB_TARGETS` und `OPENSTACK_MEMCACHED_TARGETS`, oder lassen Sie sie weg: Die Karte **Steuerungsebene** der Cloud sagt dann, dass sie nicht beobachtet werden, statt dass es ihnen gut geht.

### Dienstprotokolle bei OpenStack-Ansible

Aus journald, auf jedem Host, der einen Dienst betreibt: Container reichen ihre Journale an den Host durch.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

Das führt das Logs-Profil des Agents als systemd-Dienst aus und liest `/var/log/journal/`, wo die Journale der Container von OpenStack-Ansible ankommen.

### Wer was getan hat bei OpenStack-Ansible

Der Audit-Trail von Keystone und der Audit-Filter jeder API, in die [Sicherheitsereignisse](/docs/telemetry/openstack#wer-was-getan-hat). Jeder schreibt in das eigene Protokoll des Dienstes, ohne Konsumenten am Bus. OneUptime liest sie von dort, sobald **Sicherheitsereignisse in Ihren Protokollen finden** aktiviert ist, unter **Sicherheitsereignisse → Verbindungen**. Das Logs-Profil des Agents liest beide aus dem Journal.

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

Das sendet eine Zeile pro Anmeldung, die **OpenStack admin credential used from a new address** liest. Um nur fehlgeschlagene Anmeldungen zu senden, fügen Sie `identity.authenticate.success` zu `notification_opt_out` hinzu, und diese Erkennung liest dann, was der Audit-Filter gesehen hat. Ein zweiter Wert für `notification_opt_out` kommt als YAML-Set hinein, so wie [sein config_template](https://docs.openstack.org/ansible-config_template/latest/) einen wiederholten Schlüssel schreibt.

Für Wer-was-getan-hat über Nova, Neutron, Cinder und Glance nimmt jede API die Einstellung des Filters in ihren Conf-Overrides und den Filter in ihren Paste-Overrides auf, mit `audit` direkt nach `authtoken` und dem Context-Filter, der in jeder Pipeline darauf folgt. Das von Nova, und dasselbe in `neutron_neutron_conf_overrides` und `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` und `cinder_api_paste_ini_overrides` sowie `glance_glance_api_conf_overrides` und `glance_glance_api_paste_ini_overrides`:

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

OpenStack-Helm bietet Charts für Prometheus, Alertmanager und Exporter, und ob sie laufen, liegt bei Ihnen. Seine Steuerungsebene läuft in Kubernetes, daher liest eine Sonde die APIs und der Kubernetes-Agent sieht die Pods.

### Weiterleiten, was bei OpenStack-Helm ausgelöst wird

Wenn Sie sein Chart prometheus-alertmanager betreiben, fügen Sie den Empfänger unter `conf.alertmanager` in den Werten des Charts hinzu und senden Sie Ihre Route dorthin:

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

### Die APIs lesen und die Pods sehen bei OpenStack-Helm

Öffnen Sie **OpenStack → Alle Clouds**, klicken Sie auf **Cloud verbinden** und geben Sie die Adresse von Keystone, eine Application Credential und die zu verwendende Sonde an. Eine Sonde spricht mit einer Cloud ausschließlich über HTTPS. Folgen Sie dann **Kubernetes → Dokumentation** für den Cluster, auf dem die Charts laufen: Seine Pods, deren Protokolle und seine Nodes erreichen die Kubernetes-Seiten.

Damit die Protokolle dieser Dienste auch auf der Seite **Protokolle** dieser Cloud stehen, jeder Stack-Trace als ein Eintrag, nennen Sie die Cloud in den Werten des Agents, zusammen mit den Namespaces, in denen ihre Dienste laufen:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Wer was getan hat bei OpenStack-Helm

Der Audit-Trail von Keystone und der Audit-Filter jeder API, in die [Sicherheitsereignisse](/docs/telemetry/openstack#wer-was-getan-hat). Jeder schreibt in das eigene Protokoll des Dienstes, ohne Konsumenten am Bus. OneUptime liest sie von dort, sobald **Sicherheitsereignisse in Ihren Protokollen finden** aktiviert ist, unter **Sicherheitsereignisse → Verbindungen**. Der Kubernetes-Agent liest beide aus den Protokollen der Pods, mit der in seinen Werten genannten Cloud.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

Das sendet eine Zeile pro Anmeldung, die **OpenStack admin credential used from a new address** liest. Um nur fehlgeschlagene Anmeldungen zu senden, fügen Sie `identity.authenticate.success` zu `notification_opt_out` hinzu, und diese Erkennung liest dann, was der Audit-Filter gesehen hat.

Die `logging.conf` eines Charts hält den Root-Logger bei `WARNING`, und der Log-Treiber schreibt unter einem eigenen Logger, sodass ohne einen dafür nichts geschrieben wird. Eine Liste in den Werten ersetzt die des Charts, daher enthält `keys`, was die des Charts hat, plus dies:

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

Für Wer-was-getan-hat über Nova, Neutron und Cinder hat das `conf.paste` ihrer Charts den Audit-Filter bereits in jeder Pipeline, und ihm muss nur gesagt werden, wohin er schreiben soll. Jeder braucht denselben Logger in `conf.logging`. Das Chart von Glance hat die Map, aber weder den Filter noch einen Platz dafür in seinen Pipelines: Fügen Sie beides zu seinem `conf.paste` hinzu.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere betreibt kube-prometheus-stack mit eigenen Warnregeln sowie Loki mit Vector für Protokolle. Leiten Sie zuerst seine Warnungen weiter, dann liest eine Sonde die APIs und der Kubernetes-Agent sieht die Pods.

### Weiterleiten, was bei Atmosphere ausgelöst wird

Atmosphere liefert Warnregeln mit, die schon echte Menschen alarmiert haben, daher funktioniert das ab der ersten Stunde. Fügen Sie den Empfänger zu Ihrer Atmosphere-Konfiguration hinzu, neben den Empfängern, die Sie schon haben, und stellen Sie sie bereit:

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

### Die APIs lesen und die Pods sehen bei Atmosphere

Öffnen Sie **OpenStack → Alle Clouds**, klicken Sie auf **Cloud verbinden** und geben Sie die Adresse von Keystone, eine Application Credential und die zu verwendende Sonde an. Eine Sonde spricht mit einer Cloud ausschließlich über HTTPS. Folgen Sie dann **Kubernetes → Dokumentation** für den Cluster, auf dem Atmosphere läuft.

Damit die Protokolle dieser Dienste auch auf der Seite **Protokolle** dieser Cloud stehen, jeder Stack-Trace als ein Eintrag, nennen Sie die Cloud in den Werten des Agents, zusammen mit den Namespaces, in denen ihre Dienste laufen:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Wer was getan hat bei Atmosphere

Der Audit-Trail von Keystone und der Audit-Filter jeder API, in die [Sicherheitsereignisse](/docs/telemetry/openstack#wer-was-getan-hat). Jeder schreibt in das eigene Protokoll des Dienstes, ohne Konsumenten am Bus. OneUptime liest sie von dort, sobald **Sicherheitsereignisse in Ihren Protokollen finden** aktiviert ist, unter **Sicherheitsereignisse → Verbindungen**. Der Kubernetes-Agent liest beide aus den Protokollen der Pods, mit der in seinen Werten genannten Cloud.

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

Das sendet eine Zeile pro Anmeldung, die **OpenStack admin credential used from a new address** liest. Um nur fehlgeschlagene Anmeldungen zu senden, fügen Sie `identity.authenticate.success` zu `notification_opt_out` hinzu, und diese Erkennung liest dann, was der Audit-Filter gesehen hat.

Für Wer-was-getan-hat über Nova, Neutron und Cinder haben die Charts, die Atmosphere bereitstellt, den Audit-Filter bereits in jeder Pipeline, und ihm muss nur gesagt werden, wohin er schreiben soll, in `nova_helm_values`, `neutron_helm_values` und `cinder_helm_values`. Das Chart von Glance hat weder den Filter noch einen Platz dafür in seinen Pipelines: Fügen Sie beides zu seinem `conf.paste` hinzu, in `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam kann den Canonical Observability Stack mit `sunbeam enable observability embedded` bereitstellen. Canonical hat außerdem einen Charm `openstack-exporter`, den der Agent lesen kann, wenn Sie ihn betreiben. Die eigenen Dokumente von Sunbeam erwähnen diesen Charm nicht, und nichts hier wurde auf Sunbeam ausgeführt.

### Weiterleiten, was bei Sunbeam ausgelöst wird

Wenn Sie den Canonical Observability Stack betreiben, geben Sie seinem Alertmanager eine Konfiguration mit dem Empfänger darin:

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

### Der Exporter-Charm

Wenn Sie den Charm `openstack-exporter` von Canonical betreiben, kann der Agent ihn ohne eigene Credential lesen. Er beantwortet eine Cloud unter `/metrics`, auf Port `9180`, sofern Sie seine Einstellung `port` nicht geändert haben. Seine Adresse finden Sie mit `juju status openstack-exporter`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Welche Serien er liefert, hängt vom Exporter-Release in seinem Snap ab, das hier nicht aufgezeichnet wurde: `bash troubleshoot.sh` sagt, ob er die Cloud liest.

### Dienstprotokolle bei Sunbeam

Bei eingeschalteter Observability enthält das Loki des Stacks die Protokolle der Dienste. OneUptime kann Loki nicht lesen, und das Logs-Profil des Agents wurde mit den Charms von Sunbeam nicht ausprobiert, daher erfasst hier noch nichts diese.

### Wer was getan hat bei Sunbeam

Noch nicht. Die Charms von Sunbeam schreiben die Konfiguration jedes Dienstes aus eigenen Templates, und sein Keystone-Charm hat keine Einstellung dafür, wohin Benachrichtigungen gehen. Daher lässt sich weder der Audit-Trail von Keystone noch der Audit-Filter von außerhalb des Charms einschalten, und nichts hier erreicht die Sicherheitsereignisse.

## Red Hat OpenStack on OpenShift

Sein Telemetry Operator betreibt den Prometheus-Exporter von Ceilometer und einen Monitoring-Stack mit Alertmanager auf OpenShift. Das OpenShift-Preset des Kubernetes-Agents beobachtet die Steuerungsebene, und der Exporter von Ceilometer sagt, was die Compute-Nodes tun.

### Weiterleiten, was bei Red Hat OpenStack on OpenShift ausgelöst wird

Wenn `MetricStorage` `alertingEnabled` hat und Sie Regeln geschrieben oder angewendet haben, wenden Sie einen Empfänger an, den der Monitoring-Stack aufnimmt:

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

### Die APIs und die Steuerungsebene lesen

Öffnen Sie **OpenStack → Alle Clouds**, klicken Sie auf **Cloud verbinden** und geben Sie die Adresse von Keystone, eine Application Credential und die zu verwendende Sonde an. Eine Sonde spricht mit einer Cloud ausschließlich über HTTPS. Folgen Sie dann **Kubernetes → Dokumentation** auf dem Cluster, der die Steuerungsebene betreibt, mit gewähltem **Red Hat OpenShift**, was `preset=openshift` setzt.

Damit die Protokolle dieser Dienste auch auf der Seite **Protokolle** dieser Cloud stehen, jeder Stack-Trace als ein Eintrag, nennen Sie die Cloud in den Werten des Agents, zusammen mit den Namespaces, in denen ihre Dienste laufen:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Die Compute-Nodes über Ceilometer lesen

Eine Sonde sagt, was zugewiesen ist, nicht, was ausgelastet ist. Um die echte Nutzung zu lesen, betreiben Sie den Agent auf einem Rechner, der die Compute-Nodes erreichen kann, mit `OPENSTACK_CEILOMETER_EXPORTER_TARGETS`, das jeden Node auf dem Port von Ceilometer, `9101`, nennt.

### Wer was getan hat bei Red Hat OpenStack on OpenShift

Der Audit-Trail von Keystone und der Audit-Filter jeder API, in die [Sicherheitsereignisse](/docs/telemetry/openstack#wer-was-getan-hat). Jeder schreibt in das eigene Protokoll des Dienstes, ohne Konsumenten am Bus. OneUptime liest sie von dort, sobald **Sicherheitsereignisse in Ihren Protokollen finden** aktiviert ist, unter **Sicherheitsereignisse → Verbindungen**. Der Kubernetes-Agent liest beide aus den Protokollen der Pods, mit der in seinen Werten genannten Cloud.

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

Das sendet eine Zeile pro Anmeldung, die **OpenStack admin credential used from a new address** liest. Um nur fehlgeschlagene Anmeldungen zu senden, fügen Sie `identity.authenticate.success` zu `notification_opt_out` hinzu, und diese Erkennung liest dann, was der Audit-Filter gesehen hat.

Für Wer-was-getan-hat über Nova und Neutron nimmt jeder die Einstellung des Filters in seinem `customServiceConfig` auf und seine Paste-Datei in `defaultConfigOverwrite`. Die Operatoren von Cinder und Glance nehmen keine Paste-Datei an, daher erreicht sie hier nichts.

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

StackLight beobachtet mit eigenen Warnregeln bereits die Dienste von OpenStack, MariaDB, Memcached, RabbitMQ und libvirt. Leiten Sie zuerst seine Warnungen weiter, dann liest eine Sonde die APIs.

### Weiterleiten, was bei Mirantis MOSK ausgelöst wird

StackLight liefert Warnregeln mit, daher funktioniert das ab der ersten Stunde. Fügen Sie den Empfänger und seine Route zu Ihren StackLight-Werten hinzu. Die Dokumente von Mirantis zeigen andere Empfänger statt eines Webhooks, und das wurde nicht auf MOSK ausgeführt:

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

### Die APIs lesen

Öffnen Sie **OpenStack → Alle Clouds**, klicken Sie auf **Cloud verbinden** und geben Sie die Adresse von Keystone, eine Application Credential und die zu verwendende Sonde an. Eine Sonde spricht mit einer Cloud ausschließlich über HTTPS.

### Wer was getan hat bei Mirantis MOSK

Für Wer-was-getan-hat über Nova, Neutron, Cinder und Glance hat MOSK eine eigene Einstellung, mit bereits vorhandenem Audit-Filter. Mit dem Log-Treiber schreibt jeder Dienst auf seine Standardausgabe, und der Kubernetes-Agent liest das aus den Protokollen der Pods, mit der in seinen Werten genannten Cloud. Jeder schreibt in das eigene Protokoll des Dienstes, ohne Konsumenten am Bus. OneUptime liest sie von dort, sobald **Sicherheitsereignisse in Ihren Protokollen finden** aktiviert ist, unter **Sicherheitsereignisse → Verbindungen**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

Diese Einstellung deckt Keystone nicht ab. Sein eigener Audit-Trail nimmt `spec:services` auf, was Mirantis nicht validiert und wofür es keine Verantwortung übernimmt, wägen Sie das daher mit Ihrem Supportvertrag ab:

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

Das sendet eine Zeile pro Anmeldung, die **OpenStack admin credential used from a new address** liest. Um nur fehlgeschlagene Anmeldungen zu senden, fügen Sie `identity.authenticate.success` zu `notification_opt_out` hinzu, und diese Erkennung liest dann, was der Audit-Filter gesehen hat.

## Den Exporter verwenden, den Sie bereits betreiben

Keine Credential und nichts Neues zu betreiben: Der Agent kann einen Exporter lesen, den Sie schon haben. Wie, hängt davon ab, wie er gestartet wurde.

- **Mit `--multi-cloud`,** wie der Exporter des Agents selbst läuft: Setzen Sie `OPENSTACK_EXPORTER_ADDRESS`, und der Agent fragt ihn unter `/probe` jeweils nach einem Dienst.
- **Ohne es,** wie der von Kolla-Ansible und der Charm von Canonical laufen: Er hat kein `/probe`, setzen Sie daher `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`, und der Agent fragt ihn alle 2 Minuten unter `/metrics` nach allem auf einmal.

Bei Kolla-Ansible ist das seine interne VIP auf `9198`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Dieses Lesen kommt zusätzlich dazu, dass das Prometheus von Kolla-Ansible selbst jede Minute fragt. Kolla-Ansible pinnt Exporter 1.7.0, und seine Antwort sagt auch weniger als der Exporter, den der Agent anpinnt. Das ist es, worauf die Seiten bei fünf echten Clouds verzichten mussten, und ein Test hält es an diesen Aufzeichnungen fest:

| Fehlt | Weil | Was es kostet |
| --- | --- | --- |
| Alles von Cinder | Er fragt den Katalog nach `volumev3` und findet nichts dergleichen, wo sich Cinder als `block-storage` registriert | **Volumes** und **Speicherpools** bleiben leer, und **Dienste** hat keine Block Storage API, kein `cinder-volume` und keinen `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** und **Volume Stuck** bleiben still |
| Wie viele Instanzen ein Hypervisor enthält, und seine Aggregate | Die Liste der Hypervisoren von Nova schlägt bei der neuesten Microversion fehl, die Kolla-Ansible anfordert | Diese beiden auf **Hypervisoren**, und was ein verlorener Host nach sich zieht. Seine vCPUs, sein Speicher und sein Datenträger sind weiterhin da: Sie kommen von Placement |
| Domänen | Er hat keine solche Serie | **Domänen** bleibt leer |
| Status, Sichtbarkeit und Erstellungsdatum eines Images | Er hat keine solchen Labels | Diese Spalten auf **Images**. **Image Stuck** bleibt still, sodass ein Image, das auf dem Weg zu `active` hängt, unbemerkt bleibt |
| Die MTU eines Netzwerks | Er hat kein solches Label | Diese Zeile auf der Seite eines Netzwerks |

Wenn Sie diese brauchen, verwenden Sie stattdessen den eigenen Exporter des Agents. Sie können Ihre Meinung später ändern: Eine Cloud behält ihren Namen, egal wer sie liest.
