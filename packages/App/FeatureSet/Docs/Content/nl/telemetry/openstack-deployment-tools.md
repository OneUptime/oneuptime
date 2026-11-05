# OpenStack per implementatietool

Niemand draait "OpenStack". Men draait een tool die het uitrolt, en elke tool heeft zijn eigen paden, zijn eigen logboeken en zijn eigen idee van wat er al draait. Deze pagina is wat de installatiegids in OneUptime voor elk ervan zegt: open **OpenStack → Alle clouds**, verbind een cloud en beantwoord **Hoe rolt u OpenStack uit?**

:::cards
- [Hoe ver elke gids is getest](#hoe-ver-elke-gids-is-getest): Lees dit eerst. Die van Kolla-Ansible en die van OpenStack-Ansible zijn op echte uitrollen uitgevoerd. De andere niet.
- [Doorsturen wat al afgaat](#doorsturen-wat-al-afgaat): Incidenten vanaf het eerste uur, zonder agent.
- [Kolla-Ansible](#kolla-ansible): Lees de exporters die het al draait.
- [OpenStack-Ansible](#openstack-ansible): Journald-logboeken en overrides in `user_variables.yml`.
- [OpenStack-Helm](#openstack-helm): Een sonde, en voor Atmosphere de Kubernetes-agent.
- [Canonical Sunbeam](#canonical-sunbeam): De Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): De OpenShift-preset en Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): De alerts van StackLight.
- [De exporter gebruiken die u al draait](#de-exporter-gebruiken-die-u-al-draait): Waar de pagina's op 1.7.0 het zonder moeten stellen.
:::

## Hoe ver elke gids is getest

Elk pad, elke poort en elke variabele hieronder is gelezen uit de eigen broncode of documentatie van de tool. De testopstelling die de fixtures van OneUptime opneemt, rolt ook Kolla-Ansible en OpenStack-Ansible uit op een CI-runner en voert daar de eigen commando's van hun gidsen uit, met een stand-in voor OneUptime die bewaart wat de agent verstuurt. Dus geen enkele gids hier heeft vanaf een echte uitrol van zijn tool gerapporteerd aan een draaiende OneUptime. Waartegen elk is gecontroleerd:

| Tool | Gelezen uit | Echt uitgevoerd |
| --- | --- | --- |
| Kolla-Ansible | De broncode, op master en `stable/2026.1` | De commando's van deze gids, op een echte all-in-one op `stable/2026.1` met Open vSwitch: de agent op de eerste credential, zonder Docker, op de eigen exporter van Kolla-Ansible en op uw eigen exporter in de vastgezette versie en in 1.7.0, de exporter op de tweede credential, de doelen gelezen uit de echte `prometheus.yml`, en het logboekprofiel. Met Memcached daar echt gestopt postte zijn Alertmanager een firing-webhook en daarna een resolved-webhook, en wat die postte, naar een draaiende OneUptime gestuurd, opende één incident op de juiste cloud en op geen enkele andere, en sloot het |
| OpenStack-Ansible | De broncode en documentatie | De commando's van deze gids, op een echte all-in-one op `stable/2026.1`, in LXC-containers: de agent op de eerste credential, de exporter op de tweede met zijn beleidsoverschrijvingen, de RabbitMQ- en HAProxy-instellingen met de agent die elk las, en het logboekprofiel op het journal |
| OpenStack-Helm | De chartwaarden | De sonde en de Kubernetes-agent, elk afzonderlijk |
| Atmosphere | De documentatie en broncode | De sonde en de Kubernetes-agent, elk afzonderlijk |
| Canonical Sunbeam | De documentatie van Canonical en de broncode van de charms | Niets op Sunbeam. De eigen documentatie van Sunbeam noemt de exporter-charm niet |
| Red Hat OpenStack on OpenShift | De broncode van de Telemetry Operator | De OpenShift-preset en de exporter van Ceilometer, elk afzonderlijk |
| Mirantis MOSK | De documentatie van Mirantis, waarvan de voorbeelden andere receivers tonen in plaats van een webhook | Niets op MOSK |

Wat **Wie wat deed** in elke gids aanzet, is opgenomen op DevStack, op elke release die de testopstelling draait, en op geen van deze tools. Waar elke tool het neerzet, is gelezen uit de broncode of documentatie van die tool.

Daarnaast is het hele pad uitgevoerd op een live OneUptime, gestart zoals Docker Compose hem start, met zijn app en sonde gebouwd uit deze code, en op een echte DevStack in plaats van een van deze tools. De agent, geïnstalleerd met de commando's uit zijn documentatie, registreerde de cloud vanaf zijn eerste gegevens, en elke instantie, elk volume en elke hypervisor had een rij met de status die de cloud zelf eraan gaf. Toen `nova-compute` echt was gestopt, ging zijn rij op down, opende een monitor uit het sjabloon Compute Service Down 746 seconden later één incident met de host erin, en werd het 48 seconden nadat de service weer startte opgelost. De sonde van een project verbond dezelfde cloud via de eigen routes van het dashboard en las zijn rijen terug, en de 114 spans van een ondertekende boot kwamen binnen via zijn services, vanuit het traceprofiel.

Los daarvan zijn wat een echte agent en een echte Alertmanager hadden verstuurd opgenomen op DevStack en in een testcluster, niet op een cloud die een van deze tools had uitgerold. Verstuurd naar een live OneUptime opende de afgaande webhook één incident op de juiste cloud en op geen andere, opende dezelfde webhook opnieuw niets, en loste de resolved-webhook het op.

## Doorsturen wat al afgaat

Elke tool met een Alertmanager kan vandaag incidenten krijgen: een alert die afgaat wordt een incident, met on-call en statuspagina's vanaf het eerste uur, en het wordt opgelost wanneer de alert dat doet. Er hoeft niets te worden geïnstalleerd, en dit werkt naast al het andere op deze pagina.

:::steps
### De monitor maken

Maak een monitor van het type Incoming Request zoals [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#waarschuwingen-ontvangen-met-een-monitor) beschrijft, en kopieer zijn **Heartbeat URL**. Dat is het adres `<secret key>` in de receiver van elke tool hieronder.

### Aan de cloud koppelen

Open **Overzicht → Gekoppelde resources** van de monitor en voeg de OpenStack-cloud toe. Elk incident staat dan op de pagina **Incidenten** van die cloud: de eigen instellingen van een Incoming Request-monitor noemen geen cloud, dus de Alertmanager van elke cloud heeft een eigen monitor nodig. De cloud verschijnt in die lijst zodra zijn eerste gegevens binnenkomen, dus doe dit na de stappen hieronder, of voeg de cloud eerst toe onder **OpenStack → Alle clouds**.
:::

Van Alertmanager is opgenomen dat hij in precies deze vorm post in `Tests/Ops/openstack-e2e`, in de versie die Kolla-Ansible vastzet, en de opname wordt afgespeeld via de echte evaluator: één incident per alert, opgelost door zijn eigen status `resolved`.

## Kolla-Ansible

Met `enable_prometheus` aan in `/etc/kolla/globals.yml`, wat Kolla-Ansible uit laat tot u het instelt, draait het Prometheus, Alertmanager en een exporter voor alles onder de cloud, en levert het geen alertregels mee. Deze gids leest wat die draaien in plaats van een tweede exemplaar te starten.

### Doorsturen wat afgaat op Kolla-Ansible

Alleen als u eigen regels hebt geschreven: Kolla-Ansible levert er geen mee, dus niets gaat af totdat `/etc/kolla/config/prometheus/*.rules` er bevat. Schrijf op de host waarvandaan u uitrolt `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, dat Kolla-Ansible leest in plaats van zijn eigen bestand, en pas het toe:

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

### De credential op Kolla-Ansible

Meld u aan als admin met `source /etc/kolla/admin-openrc.sh`, dat `kolla-ansible post-deploy` schrijft.

- **Volledige weergave** vereist één wijziging, aan Cinder. De sjablonen van Kolla-Ansible stellen `service_type` al in onder `[keystone_authtoken]` op Nova, Neutron, Glance en Placement, maar zijn Cinder zegt `volume` en zijn catalogus zegt `block-storage`, en keystonemiddleware weigert een credential die door toegangsregels is beperkt met een `401` tenzij de twee overeenkomen. Voeg `service_type = block-storage` toe onder `[keystone_authtoken]` in `/etc/kolla/config/cinder.conf` en voer daarna `kolla-ansible reconfigure -i <inventory> --tags cinder` uit.
- **Alleen infrastructuur** neemt zijn overrides op `/etc/kolla/config/nova/policy.yaml`, en hetzelfde voor `neutron`, `keystone` en `placement`, samengevoegd met wat er al staat. Pas ze toe met `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.

### Bewaken waar de cloud van Kolla-Ansible op draait

Op de host die Prometheus van Kolla-Ansible draait, leest dit zijn doelen uit het bestand dat Kolla-Ansible heeft gerenderd, en print ze als instellingen voor de agent:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Voeg wat het print toe aan de `.env` van de agent en voer dan `docker compose up -d` uit in de map van de agent. Elke exporter luistert op het API-netwerk, dus de machine van de agent heeft daar een route naartoe nodig. De kaart **Controlevlak** van de cloud meldt dan hoe elk ervan eraan toe is, en zegt duidelijk welke niet worden bewaakt.

| Leest | Poort | Instelling |
| --- | --- | --- |
| De Prometheus-plugin van RabbitMQ | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| De eigen exporter van HAProxy | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, voor OVN en Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **De databases van OVN:** Kolla-Ansible draait openstack-network-exporter vanaf 2026.1, alleen op compute- en netwerknodes, en een OVN-database wordt gelezen van de host waarop hij draait. Als uw controlenodes geen van beide zijn, voeg ze dan in uw inventory toe onder `[prometheus-openstack-network-exporter:children]` en configureer opnieuw, anders worden de Northbound- en Southbound-databases weergegeven als niet bewaakt.
- **Vóór 2026.1** is er geen netwerkexporter, dus OVN en Open vSwitch worden weergegeven als niet bewaakt.

### Servicelogboeken op Kolla-Ansible

Het logboekprofiel van de agent draait op elke node en leest de bestanden van Kolla-Ansible. Het is wat een regel aan de pagina's van de cloud koppelt:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Ook de eigen Fluentd van Kolla kan doorsturen, met een output in `/etc/kolla/config/fluentd/output/*.conf` zoals [Fluentd](/docs/telemetry/fluentd) beschrijft, maar die records komen onder de naam van een service in **Logboeken** terecht, en niet op de pagina's van de cloud.

### Wie wat deed op Kolla-Ansible

Het auditspoor van Keystone en het auditfilter op elke API, naar [Beveiligingsgebeurtenissen](/docs/telemetry/openstack#wie-deed-wat). Elk schrijft naar het eigen logboek van de service, zonder consument op de bus. OneUptime leest ze daar zodra **Beveiligingsgebeurtenissen in uw logboeken vinden** aanstaat, onder **Beveiligingsgebeurtenissen → Verbindingen**. Het logboekprofiel van de agent leest beide uit `/var/log/kolla`.

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

Dit verstuurt een regel voor elke aanmelding, die **OpenStack-admincredential gebruikt vanaf een nieuw adres** leest. Om alleen mislukte aanmeldingen te versturen, voegt u `identity.authenticate.success` toe aan `notification_opt_out`, en die detectie leest dan wat het auditfilter zag.

Voor wie wat deed via Nova, Neutron, Cinder en Glance heeft het auditfilter een instelling nodig, die in één keer in de configuratie van elke service komt:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

Het heeft ook een paste-bestand nodig, en de configtaken van Kolla-Ansible kopiëren voor deze services geen paste-bestand. Zet het uwe op elke API-host en mount het over dat in de image met `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` en `glance_api_extra_volumes` in `globals.yml`. De mapbestanden van pyCADF staan in de image in `/var/lib/kolla/venv/etc/pycadf`. [Wie wat deed](/docs/telemetry/openstack#het-auditfilter-aanzetten) bevat de regels van het filter.

## OpenStack-Ansible

OpenStack-Ansible bewaart de logboeken van zijn services in journald en draait geen eigen Prometheus, dus de agent is de weg erin, en de logboeken hebben een eigen pad.

### De credential op OpenStack-Ansible

Meld u aan als admin vanuit de utility-container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, daarna `. ~/openrc`. Daar staat geen `curl`, dat de commando's hieronder gebruiken, dus voer daar eerst `apt-get install -y curl` uit.

- **Volledige weergave** vereist één wijziging, aan Cinder. De rollen van OpenStack-Ansible stellen `service_type` al in onder `[keystone_authtoken]`, maar zijn Cinder zegt `volumev3` en zijn catalogus zegt `block-storage`, en keystonemiddleware weigert een credential die door toegangsregels is beperkt met een `401` tenzij de twee overeenkomen. Stel `service_type: block-storage` in onder `keystone_authtoken` in `cinder_cinder_conf_overrides` in `/etc/openstack_deploy/user_variables.yml` en voer daarna `openstack-ansible openstack.osa.cinder --tags cinder-config` uit.
- **Alleen infrastructuur** neemt zijn overrides als `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` en `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Pas elk toe met een eigen playbook en tag, zoals `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Er later een weghalen laat een leeg bestand achter in plaats van geen, zodat niets faalt.

### Bewaken waar de cloud van OpenStack-Ansible op draait

OpenStack-Ansible draait hiervoor geen exporters, dus alleen wat u aanzet wordt bewaakt.

**RabbitMQ:** zet de Prometheus-plugin aan en noem daarna het adres van elke container op `15692` als `OPENSTACK_RABBITMQ_TARGETS` in de `.env` van de agent:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** zijn exporter staat uit, en zijn stats-listener staat op `127.0.0.1` met TLS, wat de agent niet kan lezen. Zet hem aan waar de agent erbij kan en noem dat adres op `1936` als `OPENSTACK_HAPROXY_TARGETS`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB en Memcached:** OpenStack-Ansible levert voor geen van beide een exporter mee. Draai [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) en [memcached_exporter](https://github.com/prometheus/memcached_exporter) zelf en noem ze `OPENSTACK_MARIADB_TARGETS` en `OPENSTACK_MEMCACHED_TARGETS`, of laat ze weg: de kaart **Controlevlak** van de cloud meldt dan dat ze niet worden bewaakt, in plaats van dat ze in orde zijn.

### Servicelogboeken op OpenStack-Ansible

Uit journald, op elke host die een service draait: containers geven hun journals door aan de host.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

Dit draait het logboekprofiel van de agent als systemd-service en leest `/var/log/journal/`, waar de journals van de containers van OpenStack-Ansible aankomen.

### Wie wat deed op OpenStack-Ansible

Het auditspoor van Keystone en het auditfilter op elke API, naar [Beveiligingsgebeurtenissen](/docs/telemetry/openstack#wie-deed-wat). Elk schrijft naar het eigen logboek van de service, zonder consument op de bus. OneUptime leest ze daar zodra **Beveiligingsgebeurtenissen in uw logboeken vinden** aanstaat, onder **Beveiligingsgebeurtenissen → Verbindingen**. Het logboekprofiel van de agent leest beide uit het journal.

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

Dit verstuurt een regel voor elke aanmelding, die **OpenStack-admincredential gebruikt vanaf een nieuw adres** leest. Om alleen mislukte aanmeldingen te versturen, voegt u `identity.authenticate.success` toe aan `notification_opt_out`, en die detectie leest dan wat het auditfilter zag. Een tweede waarde van `notification_opt_out` gaat erin als YAML-set, zoals [zijn config_template](https://docs.openstack.org/ansible-config_template/latest/) een herhaalde sleutel schrijft.

Voor wie wat deed via Nova, Neutron, Cinder en Glance neemt elke API de instelling van het filter in zijn conf-overrides, en het filter in zijn paste-overrides, met `audit` direct na `authtoken` en het contextfilter dat erop volgt in elke pipeline. Die van Nova, en hetzelfde in `neutron_neutron_conf_overrides` en `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` en `cinder_api_paste_ini_overrides`, en `glance_glance_api_conf_overrides` en `glance_glance_api_paste_ini_overrides`:

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

OpenStack-Helm biedt charts voor Prometheus, Alertmanager en exporters, en of ze draaien is aan u. Het controlevlak draait in Kubernetes, dus een sonde leest de API's en de Kubernetes-agent ziet de pods.

### Doorsturen wat afgaat op OpenStack-Helm

Als u zijn prometheus-alertmanager-chart draait, voeg dan de receiver toe onder `conf.alertmanager` in de waarden van de chart en stuur uw route ernaartoe:

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

### De API's lezen en de pods zien op OpenStack-Helm

Open **OpenStack → Alle clouds**, klik op **Cloud verbinden** en geef het het adres van Keystone, een application credential en de te gebruiken sonde. Een sonde spreekt alleen HTTPS met een cloud. Volg daarna **Kubernetes → Documentatie** voor het cluster waarop de charts draaien: de pods, hun logboeken en hun nodes bereiken de Kubernetes-pagina's.

Om de logboeken van die services ook op de pagina **Logboeken** van deze cloud te hebben, elke stacktrace als één record, noemt u de cloud in de waarden van de agent, met de namespaces waarin de services draaien:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Wie wat deed op OpenStack-Helm

Het auditspoor van Keystone en het auditfilter op elke API, naar [Beveiligingsgebeurtenissen](/docs/telemetry/openstack#wie-deed-wat). Elk schrijft naar het eigen logboek van de service, zonder consument op de bus. OneUptime leest ze daar zodra **Beveiligingsgebeurtenissen in uw logboeken vinden** aanstaat, onder **Beveiligingsgebeurtenissen → Verbindingen**. De Kubernetes-agent leest beide uit de logboeken van de pods, met de cloud genoemd in zijn waarden.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

Dit verstuurt een regel voor elke aanmelding, die **OpenStack-admincredential gebruikt vanaf een nieuw adres** leest. Om alleen mislukte aanmeldingen te versturen, voegt u `identity.authenticate.success` toe aan `notification_opt_out`, en die detectie leest dan wat het auditfilter zag.

De `logging.conf` van een chart houdt de root-logger op `WARNING`, en de log-driver schrijft onder een eigen logger, dus zonder logger ervoor wordt niets geschreven. Een lijst in values vervangt die van de chart, dus `keys` bevat wat die van de chart heeft, plus dit:

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

Voor wie wat deed via Nova, Neutron en Cinder hebben hun charts in `conf.paste` het auditfilter al in elke pipeline, en moet worden verteld waar het moet schrijven. Elk heeft dezelfde logger nodig, in `conf.logging`. De chart van Glance heeft de map, maar noch het filter noch een plek ervoor in zijn pipelines: voeg beide toe aan zijn `conf.paste`.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere draait kube-prometheus-stack met eigen alertregels, en Loki met Vector voor logboeken. Stuur eerst de alerts door, daarna leest een sonde de API's en ziet de Kubernetes-agent de pods.

### Doorsturen wat afgaat op Atmosphere

Atmosphere levert alertregels mee die echte mensen hebben gepaged, dus dit werkt vanaf het eerste uur. Voeg de receiver toe aan uw Atmosphere-configuratie, naast de receivers die u al hebt, en rol het uit:

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

### De API's lezen en de pods zien op Atmosphere

Open **OpenStack → Alle clouds**, klik op **Cloud verbinden** en geef het het adres van Keystone, een application credential en de te gebruiken sonde. Een sonde spreekt alleen HTTPS met een cloud. Volg daarna **Kubernetes → Documentatie** voor het cluster waarop Atmosphere draait.

Om de logboeken van die services ook op de pagina **Logboeken** van deze cloud te hebben, elke stacktrace als één record, noemt u de cloud in de waarden van de agent, met de namespaces waarin de services draaien:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Wie wat deed op Atmosphere

Het auditspoor van Keystone en het auditfilter op elke API, naar [Beveiligingsgebeurtenissen](/docs/telemetry/openstack#wie-deed-wat). Elk schrijft naar het eigen logboek van de service, zonder consument op de bus. OneUptime leest ze daar zodra **Beveiligingsgebeurtenissen in uw logboeken vinden** aanstaat, onder **Beveiligingsgebeurtenissen → Verbindingen**. De Kubernetes-agent leest beide uit de logboeken van de pods, met de cloud genoemd in zijn waarden.

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

Dit verstuurt een regel voor elke aanmelding, die **OpenStack-admincredential gebruikt vanaf een nieuw adres** leest. Om alleen mislukte aanmeldingen te versturen, voegt u `identity.authenticate.success` toe aan `notification_opt_out`, en die detectie leest dan wat het auditfilter zag.

Voor wie wat deed via Nova, Neutron en Cinder hebben de charts die Atmosphere uitrolt het auditfilter al in elke pipeline, en moet worden verteld waar het moet schrijven, in `nova_helm_values`, `neutron_helm_values` en `cinder_helm_values`. De chart van Glance heeft noch het filter noch een plek ervoor in zijn pipelines: voeg beide toe aan zijn `conf.paste`, in `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam kan de Canonical Observability Stack uitrollen, met `sunbeam enable observability embedded`. Canonical heeft ook een charm `openstack-exporter`, die de agent kan lezen als u hem draait. De eigen documentatie van Sunbeam noemt die charm niet, en niets hier is op Sunbeam uitgevoerd.

### Doorsturen wat afgaat op Sunbeam

Als u de Canonical Observability Stack draait, geef zijn Alertmanager dan een configuratie met de receiver erin:

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

### De exporter-charm

Als u de charm `openstack-exporter` van Canonical draait, kan de agent hem lezen zonder eigen credential. Hij beantwoordt één cloud op `/metrics`, op poort `9180` tenzij u zijn instelling `port` hebt gewijzigd. Zoek zijn adres met `juju status openstack-exporter`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Welke reeksen hij meldt hangt af van de exporter-release in zijn snap, die hier niet is opgenomen: `bash troubleshoot.sh` meldt of hij de cloud leest.

### Servicelogboeken op Sunbeam

Met observability aan bevat de Loki van de stack de logboeken van de services. OneUptime kan Loki niet lezen, en het logboekprofiel van de agent is niet geprobeerd op de charms van Sunbeam, dus niets hier verzamelt ze al.

### Wie wat deed op Sunbeam

Nog niet. De charms van Sunbeam schrijven de configuratie van elke service vanuit hun eigen sjablonen, en zijn Keystone-charm heeft geen instelling voor waar notificaties heen gaan. Dus noch het auditspoor van Keystone noch het auditfilter kan van buiten de charm worden aangezet, en niets hier bereikt Beveiligingsgebeurtenissen.

## Red Hat OpenStack on OpenShift

De Telemetry Operator draait de Prometheus-exporter van Ceilometer en een monitoringstack met Alertmanager op OpenShift. De OpenShift-preset van de Kubernetes-agent bewaakt het controlevlak, en de exporter van Ceilometer meldt wat de computenodes doen.

### Doorsturen wat afgaat op Red Hat OpenStack on OpenShift

Als `MetricStorage` `alertingEnabled` heeft en u regels hebt geschreven of toegepast, pas dan een receiver toe die de monitoringstack oppikt:

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

### De API's lezen, en het controlevlak

Open **OpenStack → Alle clouds**, klik op **Cloud verbinden** en geef het het adres van Keystone, een application credential en de te gebruiken sonde. Een sonde spreekt alleen HTTPS met een cloud. Volg daarna **Kubernetes → Documentatie** op het cluster dat het controlevlak draait, met **Red Hat OpenShift** gekozen, wat `preset=openshift` instelt.

Om de logboeken van die services ook op de pagina **Logboeken** van deze cloud te hebben, elke stacktrace als één record, noemt u de cloud in de waarden van de agent, met de namespaces waarin de services draaien:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### De computenodes lezen via Ceilometer

Een sonde meldt wat is toegewezen, niet wat bezig is. Draai voor het lezen van het echte gebruik de agent op een machine die de computenodes kan bereiken, met `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` die elke node noemt op de poort van Ceilometer, `9101`.

### Wie wat deed op Red Hat OpenStack on OpenShift

Het auditspoor van Keystone en het auditfilter op elke API, naar [Beveiligingsgebeurtenissen](/docs/telemetry/openstack#wie-deed-wat). Elk schrijft naar het eigen logboek van de service, zonder consument op de bus. OneUptime leest ze daar zodra **Beveiligingsgebeurtenissen in uw logboeken vinden** aanstaat, onder **Beveiligingsgebeurtenissen → Verbindingen**. De Kubernetes-agent leest beide uit de logboeken van de pods, met de cloud genoemd in zijn waarden.

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

Dit verstuurt een regel voor elke aanmelding, die **OpenStack-admincredential gebruikt vanaf een nieuw adres** leest. Om alleen mislukte aanmeldingen te versturen, voegt u `identity.authenticate.success` toe aan `notification_opt_out`, en die detectie leest dan wat het auditfilter zag.

Voor wie wat deed via Nova en Neutron neemt elk de instelling van het filter in zijn `customServiceConfig`, en zijn paste-bestand in `defaultConfigOverwrite`. De operators van Cinder en Glance nemen geen paste-bestand, dus niets hier bereikt ze.

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

StackLight bewaakt de services van OpenStack, MariaDB, Memcached, RabbitMQ en libvirt al, met eigen alertregels. Stuur eerst de alerts door, daarna leest een sonde de API's.

### Doorsturen wat afgaat op Mirantis MOSK

StackLight levert alertregels mee, dus dit werkt vanaf het eerste uur. Voeg de receiver en zijn route toe aan uw StackLight-waarden. De documentatie van Mirantis toont andere receivers in plaats van een webhook, en dit is niet uitgevoerd op MOSK:

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

### De API's lezen

Open **OpenStack → Alle clouds**, klik op **Cloud verbinden** en geef het het adres van Keystone, een application credential en de te gebruiken sonde. Een sonde spreekt alleen HTTPS met een cloud.

### Wie wat deed op Mirantis MOSK

Voor wie wat deed via Nova, Neutron, Cinder en Glance heeft MOSK een eigen instelling, met het auditfilter al op zijn plaats. Met de log-driver schrijft elke service naar zijn standaarduitvoer, en de Kubernetes-agent leest dat uit de logboeken van de pods, met de cloud genoemd in zijn waarden. Elk schrijft naar het eigen logboek van de service, zonder consument op de bus. OneUptime leest ze daar zodra **Beveiligingsgebeurtenissen in uw logboeken vinden** aanstaat, onder **Beveiligingsgebeurtenissen → Verbindingen**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

Die instelling omvat Keystone niet. Zijn eigen auditspoor neemt `spec:services`, wat Mirantis niet valideert en waarvoor het geen verantwoordelijkheid neemt, dus weeg dit af tegen uw supportcontract:

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

Dit verstuurt een regel voor elke aanmelding, die **OpenStack-admincredential gebruikt vanaf een nieuw adres** leest. Om alleen mislukte aanmeldingen te versturen, voegt u `identity.authenticate.success` toe aan `notification_opt_out`, en die detectie leest dan wat het auditfilter zag.

## De exporter gebruiken die u al draait

Geen credential en niets nieuws om te draaien: de agent kan een exporter lezen die u al hebt. Hoe, hangt af van hoe hij is gestart.

- **Met `--multi-cloud`,** zoals die van de agent zelf draait: stel `OPENSTACK_EXPORTER_ADDRESS` in, en de agent vraagt hem om één service tegelijk op `/probe`.
- **Zonder,** zoals die van Kolla-Ansible en de charm van Canonical draaien: hij heeft geen `/probe`, dus stel `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` in, en de agent vraagt hem om alles in één keer op `/metrics`, elke 2 minuten.

Op Kolla-Ansible is dat zijn interne VIP op `9198`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Die rondgang komt bovenop de eigen Prometheus van Kolla-Ansible die elke minuut vraagt. Kolla-Ansible zet exporter 1.7.0 vast, en zijn antwoord zegt ook minder dan de exporter die de agent vastzet. Dit is waar de pagina's het op vijf echte clouds zonder moesten stellen, en een test houdt het aan die opnames:

| Mist | Omdat | Wat het kost |
| --- | --- | --- |
| Alles van Cinder | Hij vraagt de catalogus om `volumev3` en vindt zoiets niet waar Cinder zich registreert als `block-storage` | **Volumes** en **Opslagpools** blijven leeg, en **Services** heeft geen Block Storage API, `cinder-volume` of `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** en **Volume Stuck** blijven stil |
| Hoeveel instanties een hypervisor bevat, en zijn aggregaten | De lijst met hypervisors van Nova faalt op de nieuwste microversie, waar Kolla-Ansible om vraagt | Die twee op **Hypervisors**, en wat een verloren host zegt mee te nemen. Zijn vCPU's, geheugen en schijf zijn er nog steeds: ze komen van Placement |
| Domeinen | Hij heeft zo'n reeks niet | **Domeinen** blijft leeg |
| De status, zichtbaarheid en aanmaakdatum van een image | Hij heeft zulke labels niet | Die kolommen op **Images**. **Image Stuck** blijft stil, dus een image die op weg naar `active` vastzit, blijft onopgemerkt |
| De MTU van een netwerk | Hij heeft zo'n label niet | Die regel op de pagina van een netwerk |

Als u die nodig hebt, gebruik dan in plaats daarvan de eigen exporter van de agent. U kunt later van gedachten veranderen: een cloud behoudt zijn naam, wie hem ook leest.
