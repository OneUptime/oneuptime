# OpenStack per driftsättningsverktyg

Ingen kör "OpenStack". De kör ett verktyg som driftsätter det, och varje verktyg har sina egna sökvägar, sina egna loggar och sin egen uppfattning om vad som redan körs. Den här sidan är vad installationsguiden i OneUptime säger för vart och ett: öppna **OpenStack → All Clouds**, anslut ett moln och svara på **Hur driftsätter du OpenStack?**

:::cards
- [Hur långt varje guide har testats](#hur-långt-varje-guide-har-testats): Läs detta först. Kolla-Ansibles och OpenStack-Ansibles har körts på riktiga driftsättningar. De andra har inte körts.
- [Vidarebefordra det som redan larmar](#vidarebefordra-det-som-redan-larmar): Incidenter från första timmen, utan agent.
- [Kolla-Ansible](#kolla-ansible): Läs de exportrar den redan kör.
- [OpenStack-Ansible](#openstack-ansible): Journald-loggar och åsidosättningar i `user_variables.yml`.
- [OpenStack-Helm](#openstack-helm) och [Atmosphere](#atmosphere): En sond och Kubernetes-agenten.
- [Canonical Sunbeam](#canonical-sunbeam): Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): OpenShift-förvalet och Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): StackLights larm.
- [Använd den exporter du redan kör](#använd-den-exporter-du-redan-kör): Vad sidorna går miste om i 1.7.0.
:::

## Hur långt varje guide har testats

Varje sökväg, port och variabel nedan lästes ur verktygets egen källkod eller dokumentation. Testriggen som spelar in OneUptimes fixturer driftsätter också Kolla-Ansible och OpenStack-Ansible på en CI-runner och kör deras guiders egna kommandon där, med en stand-in för OneUptime som behåller det agenten skickar. Så ingen guide här har rapporterat till en körande OneUptime från en riktig driftsättning av sitt verktyg. Det här har var och en kontrollerats mot:

| Verktyg | Läst ur | Körd på riktigt |
| --- | --- | --- |
| Kolla-Ansible | Dess källkod, vid master och `stable/2026.1` | Den här guidens kommandon, på en riktig allt-i-ett vid `stable/2026.1` med Open vSwitch: agenten på varje inloggningsuppgift, utan Docker, på Kolla-Ansibles egen exporter och på din egen vid den fästa versionen och vid 1.7.0, målen lästa ur dess riktiga `prometheus.yml`, och logginställningen. En del höll inte: med Memcached och nova-compute stoppade där postade dess Alertmanager ingenting, så inget larm har gått från en Kolla-Ansible-stack till OneUptime. Det Alertmanager postar vid den version den fäster, inspelat i ett testkluster, öppnade och löste en incident på rätt moln i en körande OneUptime |
| OpenStack-Ansible | Dess källkod och dokumentation | Den här guidens kommandon, på en riktig allt-i-ett vid `stable/2026.1`, i LXC-containrar: agenten på den första inloggningsuppgiften, exportern på den andra med dess policyöverskrivningar, inställningarna för RabbitMQ och HAProxy med agenten som läste var och en, och loggprofilen på journalen |
| OpenStack-Helm | Dess chartvärden | Sonden och Kubernetes-agenten, var för sig |
| Atmosphere | Dess dokumentation och källkod | Sonden och Kubernetes-agenten, var för sig |
| Canonical Sunbeam | Canonicals dokumentation, och dess charms källkod | Ingenting på Sunbeam. Sunbeams egen dokumentation nämner inte exportercharmen |
| Red Hat OpenStack on OpenShift | Telemetry Operators källkod | OpenShift-förvalet och Ceilometers exporter, var för sig |
| Mirantis MOSK | Mirantis dokumentation, vars exempel visar andra mottagare i stället för en webhook | Ingenting på MOSK |

Vad varje guides **Vem gjorde vad** slår på spelades in på DevStack, på varje version testriggen kör, och på inget av dessa verktyg. Var varje verktyg tar det lästes ur det verktygets källkod eller dokumentation.

Vid sidan av detta har hela vägen körts på en levande OneUptime, startad som Docker Compose startar den, med dess app och sond byggda från den här koden, och på en riktig DevStack i stället för något av dessa verktyg. Agenten, installerad med sin dokumentations kommandon, registrerade molnet från sin första data, och varje instans, volym och hypervisor hade en rad med den status som molnet självt gav den. När `nova-compute` verkligen stoppades gick dess rad ner, en monitor från mallen Compute Service Down öppnade en incident som nämnde värden 746 sekunder senare, och den löstes 48 sekunder efter att tjänsten startat igen. Ett projekts sond anslöt samma moln genom instrumentpanelens egna rutter och läste tillbaka dess rader, och 114 spann från en signerad start kom fram över dess tjänster, från spårprofilen.

Separat spelades det en riktig agent och en riktig Alertmanager hade skickat in på DevStack och i ett testkluster, inte på ett moln som något av dessa verktyg driftsatt. Skickad till en levande OneUptime öppnade den utlösta webhooken en incident på rätt moln och inget annat, samma webhook igen öppnade ingenting, och den lösta webhooken löste den.

## Vidarebefordra det som redan larmar

Varje verktyg med en Alertmanager kan få incidenter redan i dag: ett larm som utlöses blir en incident, med jour och statussidor från första timmen, och den löses när larmet gör det. Det finns inget att installera, och detta fungerar vid sidan av allt annat på den här sidan.

:::steps
### Skapa monitorn

Skapa en monitor av typen Incoming Request enligt [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#ta-emot-larm-med-en-monitor) och kopiera dess **Heartbeat URL**. Det är adressen `<secret key>` i varje verktygs mottagare nedan.

### Lägg den på molnet

Öppna monitorns **Översikt → Länkade resurser** och lägg till OpenStack-molnet. Varje incident finns då på det molnets sida **Incidenter**: en Incoming Request-monitors egna inställningar nämner inget moln, så varje moln med Alertmanager behöver en egen monitor. Molnet dyker upp i den listan när dess första data kommer fram, så gör detta efter stegen nedan, eller lägg till molnet under **OpenStack → All Clouds** först.
:::

Alertmanager är inspelad när den postar i exakt den här formen i `Tests/Ops/openstack-e2e`, vid den version Kolla-Ansible fäster, och inspelningen spelas upp genom den riktiga utvärderaren: en incident per larm, löst av sin egen status `resolved`.

## Kolla-Ansible

Med `enable_prometheus` påslaget i `/etc/kolla/globals.yml`, vilket Kolla-Ansible lämnar avstängt tills du slår på det, kör det Prometheus, Alertmanager och en exporter för varje sak under molnet, och levererar inga larmregler. Den här guiden läser det de kör i stället för att starta en andra kopia.

### Vidarebefordra det som larmar på Kolla-Ansible

Bara om du skrev egna regler: Kolla-Ansible levererar inga, så ingenting larmar förrän `/etc/kolla/config/prometheus/*.rules` innehåller några. Skriv `/etc/kolla/config/prometheus/prometheus-alertmanager.yml` på värden du driftsätter från, som Kolla-Ansible läser i stället för sin egen, och tillämpa den:

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

### Inloggningsuppgiften på Kolla-Ansible

Logga in som admin med `source /etc/kolla/admin-openrc.sh`, som `kolla-ansible post-deploy` skriver.

- **Full vy** kräver en ändring, i Cinder. Kolla-Ansibles mallar anger redan `service_type` under `[keystone_authtoken]` på Nova, Neutron, Glance och Placement, men dess Cinder anger `volume` och dess katalog anger `block-storage`, och keystonemiddleware nekar en inloggningsuppgift som begränsas av åtkomstregler med `401` om de två inte stämmer överens. Lägg till `service_type = block-storage` under `[keystone_authtoken]` i `/etc/kolla/config/cinder.conf` och kör sedan `kolla-ansible reconfigure -i <inventory> --tags cinder`.
- **Endast infrastruktur** tar sina åsidosättningar i `/etc/kolla/config/nova/policy.yaml`, och likadant för `neutron`, `keystone` och `placement`, sammanslagna med det som redan finns där. Tillämpa dem med `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.

### Bevaka det Kolla-Ansibles moln vilar på

På värden som kör Kolla-Ansibles Prometheus läser detta dess mål ur filen Kolla-Ansible renderade och skriver ut dem som inställningar för agenten:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Lägg det som skrivs ut i agentens `.env` och kör sedan `docker compose up -d` i agentens mapp. Varje exporter lyssnar på API-nätverket, så agentens maskin behöver en rutt dit. Molnets kort **Kontrollplan** anger sedan hur var och en mår, och säger rakt ut vilka som inte bevakas.

| Läser | Port | Inställning |
| --- | --- | --- |
| RabbitMQs Prometheus-plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| HAProxys egen exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, för OVN och Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **OVN:s databaser:** Kolla-Ansible kör openstack-network-exporter från 2026.1, bara på compute- och nätverksnoder, och en OVN-databas läses från värden den körs på. Om dina kontrollnoder inte är någon av dem, lägg till dem under `[prometheus-openstack-network-exporter:children]` i din inventarie och konfigurera om, annars visas Northbound- och Southbound-databaserna som inte bevakade.
- **Före 2026.1** finns ingen nätverksexporter, så OVN och Open vSwitch visas som inte bevakade.

### Tjänstloggar på Kolla-Ansible

Agentens loggprofil körs på varje nod och läser Kolla-Ansibles filer. Det är den som kopplar en rad till molnets sidor:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Kollas egen Fluentd kan också vidarebefordra, med en utdata i `/etc/kolla/config/fluentd/output/*.conf` som [Fluentd](/docs/telemetry/fluentd) beskriver, men de posterna hamnar i **Loggar** under en tjänsts namn, och inte på molnets sidor.

### Vem gjorde vad på Kolla-Ansible

Keystones granskningsspår och granskningsfiltret på varje API, in i [Security Events](/docs/telemetry/openstack#vem-gjorde-vad). Var och en skriver till tjänstens egen logg, utan någon konsument på bussen. OneUptime läser dem därifrån när **Hitta säkerhetshändelser i dina loggar** är på, under **Security Events → Anslutningar**. Agentens loggprofil läser båda från `/var/log/kolla`.

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

Detta skickar en rad för varje inloggning, som **OpenStack admin credential used from a new address** läser. För att bara skicka misslyckade inloggningar, lägg till `identity.authenticate.success` i `notification_opt_out`, så läser den detekteringen det granskningsfiltret såg.

För vem som gjorde vad genom Nova, Neutron, Cinder och Glance behöver granskningsfiltret en inställning, som läggs i varje tjänsts konfiguration på en gång:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

Det behöver också en paste-fil, och Kolla-Ansibles konfigurationsuppgifter kopierar ingen paste-fil för de här tjänsterna. Lägg din på varje API-värd och montera den över den i avbildningen med `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` och `glance_api_extra_volumes` i `globals.yml`. pyCADF:s kartfiler finns i `/var/lib/kolla/venv/etc/pycadf` i avbildningen. [Vem gjorde vad](/docs/telemetry/openstack#slå-på-granskningsfiltret) har filtrets rader.

## OpenStack-Ansible

OpenStack-Ansible håller sina tjänsters loggar i journald och kör ingen egen Prometheus, så agenten är vägen in, och loggarna har en egen väg.

### Inloggningsuppgiften på OpenStack-Ansible

Logga in som admin från utility-containern: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, därefter `. ~/openrc`. Den har ingen `curl`, som kommandona nedan använder, så kör `apt-get install -y curl` där först.

- **Full vy** kräver en ändring, i Cinder. OpenStack-Ansibles roller anger redan `service_type` under `[keystone_authtoken]`, men dess Cinder anger `volumev3` och dess katalog anger `block-storage`, och keystonemiddleware nekar en inloggningsuppgift som begränsas av åtkomstregler med `401` om de två inte stämmer överens. Ange `service_type: block-storage` under `keystone_authtoken` i `cinder_cinder_conf_overrides` i `/etc/openstack_deploy/user_variables.yml` och kör sedan `openstack-ansible openstack.osa.cinder --tags cinder-config`.
- **Endast infrastruktur** tar sina åsidosättningar som `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` och `placement_policy_overrides` i `/etc/openstack_deploy/user_variables.yml`. Tillämpa var och en med sin egen playbook och tagg, till exempel `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Att ta bort en senare lämnar kvar en tom fil i stället för ingen, så ingenting fallerar.

### Bevaka det OpenStack-Ansibles moln vilar på

OpenStack-Ansible kör inga exportrar för dessa, så bara det du slår på bevakas.

**RabbitMQ:** slå på dess Prometheus-plugin och ange sedan varje containers adress på `15692` som `OPENSTACK_RABBITMQ_TARGETS` i agentens `.env`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** dess exporter är avstängd, och dess statistiklyssnare ligger på `127.0.0.1` med TLS, vilket agenten inte kan läsa. Slå på den där agenten når den och ange sedan den adressen på `1936` som `OPENSTACK_HAPROXY_TARGETS`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB och Memcached:** OpenStack-Ansible levererar ingen exporter för någon av dem. Kör [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) och [memcached_exporter](https://github.com/prometheus/memcached_exporter) själv och ange dem som `OPENSTACK_MARIADB_TARGETS` och `OPENSTACK_MEMCACHED_TARGETS`, eller lämna dem utanför: molnets kort **Kontrollplan** säger då att de inte bevakas, i stället för att de mår bra.

### Tjänstloggar på OpenStack-Ansible

Från journald, på varje värd som kör en tjänst: containrar skickar vidare sina journaler till värden.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

Detta kör agentens loggprofil som en systemd-tjänst och läser `/var/log/journal/`, dit OpenStack-Ansibles containrars journaler kommer.

### Vem gjorde vad på OpenStack-Ansible

Keystones granskningsspår och granskningsfiltret på varje API, in i [Security Events](/docs/telemetry/openstack#vem-gjorde-vad). Var och en skriver till tjänstens egen logg, utan någon konsument på bussen. OneUptime läser dem därifrån när **Hitta säkerhetshändelser i dina loggar** är på, under **Security Events → Anslutningar**. Agentens loggprofil läser båda från journalen.

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

Detta skickar en rad för varje inloggning, som **OpenStack admin credential used from a new address** läser. För att bara skicka misslyckade inloggningar, lägg till `identity.authenticate.success` i `notification_opt_out`, så läser den detekteringen det granskningsfiltret såg. Ett andra värde för `notification_opt_out` anges som en YAML-mängd, så som [dess config_template](https://docs.openstack.org/ansible-config_template/latest/) skriver en upprepad nyckel.

För vem som gjorde vad genom Nova, Neutron, Cinder och Glance tar varje API filtrets inställning i sina conf-åsidosättningar, och filtret i sina paste-åsidosättningar, med `audit` direkt efter `authtoken` och kontextfiltret som följer efter det i varje pipeline. Novas, och samma i `neutron_neutron_conf_overrides` och `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` och `cinder_api_paste_ini_overrides`, samt `glance_glance_api_conf_overrides` och `glance_glance_api_paste_ini_overrides`:

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

OpenStack-Helm erbjuder charts för Prometheus, Alertmanager och exportrar, och om de körs är upp till dig. Dess kontrollplan körs i Kubernetes, så en sond läser API:erna och Kubernetes-agenten ser poddarna.

### Vidarebefordra det som larmar på OpenStack-Helm

Om du kör dess chart prometheus-alertmanager, lägg till mottagaren under `conf.alertmanager` i chartens värden och skicka din rutt till den:

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

### Läs API:erna och se poddarna på OpenStack-Helm

Öppna **OpenStack → All Clouds**, klicka på **Anslut moln** och ge det Keystones adress, en applikationsuppgift och den sond som ska användas. En sond talar bara HTTPS med ett moln. Följ sedan **Kubernetes → Dokumentation** för klustret som charts körs på: dess poddar, deras loggar och deras noder når Kubernetes-sidorna.

För att även ha de tjänsternas loggar på det här molnets sida **Loggar**, med varje stackspårning som en post, ange molnets namn i agentens värden, med de namnrymder dess tjänster körs i:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Vem gjorde vad på OpenStack-Helm

Keystones granskningsspår och granskningsfiltret på varje API, in i [Security Events](/docs/telemetry/openstack#vem-gjorde-vad). Var och en skriver till tjänstens egen logg, utan någon konsument på bussen. OneUptime läser dem därifrån när **Hitta säkerhetshändelser i dina loggar** är på, under **Security Events → Anslutningar**. Kubernetes-agenten läser båda från poddarnas loggar, med molnet angivet i sina värden.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

Detta skickar en rad för varje inloggning, som **OpenStack admin credential used from a new address** läser. För att bara skicka misslyckade inloggningar, lägg till `identity.authenticate.success` i `notification_opt_out`, så läser den detekteringen det granskningsfiltret såg.

En charts `logging.conf` håller rotloggaren på `WARNING`, och logdrivrutinen skriver under en egen loggare, så utan en för den skrivs ingenting. En lista i värden ersätter chartens, så `keys` innehåller det chartens har, plus detta:

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

För vem som gjorde vad genom Nova, Neutron och Cinder har deras charts `conf.paste` redan granskningsfiltret i varje pipeline, och det behöver få veta var det ska skriva. Var och en behöver samma loggare, i `conf.logging`. Glances chart har kartan, men varken filtret eller en plats för det i sina pipelines: lägg till båda i dess `conf.paste`.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere kör kube-prometheus-stack med egna larmregler, och Loki med Vector för loggar. Vidarebefordra först dess larm, därefter läser en sond API:erna och Kubernetes-agenten ser poddarna.

### Vidarebefordra det som larmar på Atmosphere

Atmosphere levererar larmregler som har kallat ut riktiga människor, så detta fungerar från första timmen. Lägg till mottagaren i din Atmosphere-konfiguration, bredvid de mottagare du redan har, och driftsätt den:

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

### Läs API:erna och se poddarna på Atmosphere

Öppna **OpenStack → All Clouds**, klicka på **Anslut moln** och ge det Keystones adress, en applikationsuppgift och den sond som ska användas. En sond talar bara HTTPS med ett moln. Följ sedan **Kubernetes → Dokumentation** för klustret Atmosphere körs på.

För att även ha de tjänsternas loggar på det här molnets sida **Loggar**, med varje stackspårning som en post, ange molnets namn i agentens värden, med de namnrymder dess tjänster körs i:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Vem gjorde vad på Atmosphere

Keystones granskningsspår och granskningsfiltret på varje API, in i [Security Events](/docs/telemetry/openstack#vem-gjorde-vad). Var och en skriver till tjänstens egen logg, utan någon konsument på bussen. OneUptime läser dem därifrån när **Hitta säkerhetshändelser i dina loggar** är på, under **Security Events → Anslutningar**. Kubernetes-agenten läser båda från poddarnas loggar, med molnet angivet i sina värden.

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

Detta skickar en rad för varje inloggning, som **OpenStack admin credential used from a new address** läser. För att bara skicka misslyckade inloggningar, lägg till `identity.authenticate.success` i `notification_opt_out`, så läser den detekteringen det granskningsfiltret såg.

För vem som gjorde vad genom Nova, Neutron och Cinder har de charts Atmosphere driftsätter redan granskningsfiltret i varje pipeline, och det behöver få veta var det ska skriva, i `nova_helm_values`, `neutron_helm_values` och `cinder_helm_values`. Glances chart har varken filtret eller en plats för det i sina pipelines: lägg till båda i dess `conf.paste`, i `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam kan driftsätta Canonical Observability Stack, med `sunbeam enable observability embedded`. Canonical har också en charm `openstack-exporter`, som agenten kan läsa om du kör den. Sunbeams egen dokumentation nämner inte den charmen, och inget här har körts på Sunbeam.

### Vidarebefordra det som larmar på Sunbeam

Om du kör Canonical Observability Stack, ge dess Alertmanager en konfiguration med mottagaren i:

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

### Exportercharmen

Om du kör Canonicals charm `openstack-exporter` kan agenten läsa den utan någon egen inloggningsuppgift. Den svarar för ett moln på `/metrics`, på port `9180` om du inte ändrade dess inställning `port`. Hitta dess adress med `juju status openstack-exporter`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Vilka serier den levererar beror på den exporterversion som finns i dess snap, vilket inte spelades in här: `bash troubleshoot.sh` säger om den läser molnet.

### Tjänstloggar på Sunbeam

Med observability påslaget håller stackens Loki tjänsternas loggar. OneUptime kan inte läsa Loki, och agentens loggprofil har inte provats på Sunbeams charms, så ingenting här samlar in dem ännu.

### Vem gjorde vad på Sunbeam

Ännu inte. Sunbeams charms skriver varje tjänsts konfiguration från sina egna mallar, och dess Keystone-charm har ingen inställning för vart notifieringar går. Så varken Keystones granskningsspår eller granskningsfiltret kan slås på utifrån charmen, och ingenting här når Security Events.

## Red Hat OpenStack on OpenShift

Dess Telemetry Operator kör Ceilometers Prometheus-exporter och en övervakningsstack med Alertmanager på OpenShift. Kubernetes-agentens OpenShift-förval bevakar kontrollplanet, och Ceilometers exporter säger vad compute-noderna gör.

### Vidarebefordra det som larmar på Red Hat OpenStack on OpenShift

Om `MetricStorage` har `alertingEnabled` och du skrev eller tillämpade regler, tillämpa en mottagare som övervakningsstacken plockar upp:

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

### Läs API:erna och kontrollplanet

Öppna **OpenStack → All Clouds**, klicka på **Anslut moln** och ge det Keystones adress, en applikationsuppgift och den sond som ska användas. En sond talar bara HTTPS med ett moln. Följ sedan **Kubernetes → Dokumentation** på klustret som kör kontrollplanet, med **Red Hat OpenShift** valt, vilket anger `preset=openshift`.

För att även ha de tjänsternas loggar på det här molnets sida **Loggar**, med varje stackspårning som en post, ange molnets namn i agentens värden, med de namnrymder dess tjänster körs i:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Läs compute-noderna genom Ceilometer

En sond säger vad som är allokerat, inte vad som är upptaget. För att läsa verklig användning, kör agenten på en maskin som når compute-noderna, med `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` som anger varje nod på Ceilometers port, `9101`.

### Vem gjorde vad på Red Hat OpenStack on OpenShift

Keystones granskningsspår och granskningsfiltret på varje API, in i [Security Events](/docs/telemetry/openstack#vem-gjorde-vad). Var och en skriver till tjänstens egen logg, utan någon konsument på bussen. OneUptime läser dem därifrån när **Hitta säkerhetshändelser i dina loggar** är på, under **Security Events → Anslutningar**. Kubernetes-agenten läser båda från poddarnas loggar, med molnet angivet i sina värden.

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

Detta skickar en rad för varje inloggning, som **OpenStack admin credential used from a new address** läser. För att bara skicka misslyckade inloggningar, lägg till `identity.authenticate.success` i `notification_opt_out`, så läser den detekteringen det granskningsfiltret såg.

För vem som gjorde vad genom Nova och Neutron tar var och en filtrets inställning i sin `customServiceConfig`, och sin paste-fil i `defaultConfigOverwrite`. Cinders och Glances operatorer tar ingen paste-fil, så ingenting här når dem.

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

StackLight bevakar redan OpenStacks tjänster, MariaDB, Memcached, RabbitMQ och libvirt, med egna larmregler. Vidarebefordra först dess larm, därefter läser en sond API:erna.

### Vidarebefordra det som larmar på Mirantis MOSK

StackLight levererar larmregler, så detta fungerar från första timmen. Lägg till mottagaren och dess rutt i dina StackLight-värden. Mirantis dokumentation visar andra mottagare i stället för en webhook, och detta har inte körts på MOSK:

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

### Läs API:erna

Öppna **OpenStack → All Clouds**, klicka på **Anslut moln** och ge det Keystones adress, en applikationsuppgift och den sond som ska användas. En sond talar bara HTTPS med ett moln.

### Vem gjorde vad på Mirantis MOSK

För vem som gjorde vad genom Nova, Neutron, Cinder och Glance har MOSK en egen inställning, med granskningsfiltret redan på plats. Med logdrivrutinen skriver varje tjänst till sin standardutdata, och Kubernetes-agenten läser den från poddarnas loggar, med molnet angivet i sina värden. Var och en skriver till tjänstens egen logg, utan någon konsument på bussen. OneUptime läser dem därifrån när **Hitta säkerhetshändelser i dina loggar** är på, under **Security Events → Anslutningar**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

Den inställningen täcker inte Keystone. Dess eget granskningsspår tar `spec:services`, som Mirantis inte validerar och inte tar ansvar för, så väg detta mot ditt supportavtal:

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

Detta skickar en rad för varje inloggning, som **OpenStack admin credential used from a new address** läser. För att bara skicka misslyckade inloggningar, lägg till `identity.authenticate.success` i `notification_opt_out`, så läser den detekteringen det granskningsfiltret såg.

## Använd den exporter du redan kör

Ingen inloggningsuppgift och inget nytt att köra: agenten kan läsa en exporter du redan har. Hur beror på hur den startades.

- **Med `--multi-cloud`,** som agentens egen körs: ange `OPENSTACK_EXPORTER_ADDRESS`, så frågar agenten den efter en tjänst i taget på `/probe`.
- **Utan den,** som Kolla-Ansibles och Canonicals charm körs: den har ingen `/probe`, så ange `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`, så frågar agenten den efter allt på en gång på `/metrics`, var 2:a minut.

På Kolla-Ansible är det dess interna VIP på `9198`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Den genomgången kommer utöver att Kolla-Ansibles egen Prometheus frågar varje minut. Kolla-Ansible fäster exporter 1.7.0, och dess svar säger också mindre än exportern agenten fäster. Det här är vad sidorna gick miste om på fem riktiga moln, och ett test håller det mot de inspelningarna:

| Går miste om | Därför att | Vad det kostar |
| --- | --- | --- |
| Allt som rör Cinder | Den frågar katalogen efter `volumev3` och hittar ingen sådan där Cinder registrerar sig som `block-storage` | **Volymer** och **Lagringspooler** förblir tomma, och **Tjänster** har inget Block Storage API, `cinder-volume` eller `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** och **Volume Stuck** förblir tysta |
| Hur många instanser en hypervisor håller, och dess aggregat | Novas lista över hypervisorer fallerar vid den nyaste mikroversionen, som Kolla-Ansible ber om | Dessa två på **Hypervisorer**, och vad en förlorad värd säger att den drar med sig. Dess vCPU:er, minne och disk finns kvar: de kommer från Placement |
| Domäner | Den har ingen sådan serie | **Domäner** förblir tom |
| En avbildnings status, synlighet och skapandedatum | Den har inga sådana etiketter | Dessa kolumner på **Avbildningar**. **Image Stuck** förblir tyst, så en avbildning som fastnat på väg mot `active` går obemärkt förbi |
| Ett nätverks MTU | Den har ingen sådan etikett | Den raden på ett nätverks sida |

Om du behöver dessa, använd agentens egen exporter i stället. Du kan ändra dig senare: ett moln behåller sitt namn oavsett vilken som läser det.
