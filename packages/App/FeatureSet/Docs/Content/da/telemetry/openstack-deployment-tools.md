# OpenStack efter udrulningsværktøj

Ingen kører "OpenStack". De kører et værktøj, der udruller det, og hvert værktøj har sine egne stier, sine egne logs og sin egen opfattelse af, hvad der allerede kører. Denne side er det, opsætningsguiden i OneUptime siger for hvert enkelt: åbn **OpenStack → Dokumentation** og besvar **Hvordan udruller du OpenStack?**

:::cards
- [Hvor langt hver guide er testet](#hvor-langt-hver-guide-er-testet): Læs dette først. Kolla-Ansibles og OpenStack-Ansibles er kørt på rigtige udrulninger. De andre er ikke.
- [Videresend det, der allerede udløser](#videresend-det-der-allerede-udløser): Hændelser fra den første time, uden agent.
- [Kolla-Ansible](#kolla-ansible): Læs de eksportører, det allerede kører.
- [OpenStack-Ansible](#openstack-ansible): Journald-logs og tilsidesættelser i `user_variables.yml`.
- [OpenStack-Helm og Atmosphere](#openstack-helm): En sonde og Kubernetes-agenten.
- [Canonical Sunbeam](#canonical-sunbeam): Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): OpenShift-forudindstillingen og Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): StackLights advarsler.
- [Brug den eksportør, du allerede kører](#brug-den-eksportør-du-allerede-kører): Hvad siderne går uden på 1.7.0.
:::

## Hvor langt hver guide er testet

Hver sti, port og variabel nedenfor er læst fra værktøjets egen kildekode eller dokumentation. Kolla-Ansibles og OpenStack-Ansibles guides er også fulgt på rigtige udrulninger, med deres egne kommandoer og en stand-in for OneUptime, der gemmer det, agenten sender. Så ingen guide her har rapporteret til en kørende OneUptime fra en rigtig udrulning af sit værktøj. Hvad hver er kontrolleret mod:

| Værktøj | Læst fra | Kørt for alvor |
| --- | --- | --- |
| Kolla-Ansible | Dets kildekode, på master og `stable/2026.1` | Denne guides kommandoer, på en rigtig all-in-one på `stable/2026.1` med Open vSwitch: agenten på legitimationen **Fuld visning**, uden Docker, på Kolla-Ansibles egen eksportør og på din egen i den fastlåste version og i 1.7.0, agentens eksportør på legitimationen **Kun infrastruktur**, målene læst fra dens rigtige `prometheus.yml`, og logprofilen. Med Memcached reelt stoppet dér postede dens Alertmanager en udløst webhook og derefter en løst, og det, den postede, sendt til en kørende OneUptime, åbnede én hændelse på den rigtige cloud og ingen anden, og løste den |
| OpenStack-Ansible | Dets kildekode og dokumentation | Denne guides kommandoer, på en rigtig all-in-one på `stable/2026.1`, i LXC-containere: agenten på legitimationen **Fuld visning**, agentens eksportør på legitimationen **Kun infrastruktur** med dens politiktilsidesættelser, RabbitMQ- og HAProxy-indstillingerne med agenten, der læser hver af dem, og logprofilen på journalen |
| OpenStack-Helm | Dets chart-værdier | Intet på OpenStack-Helm. Sonden og Kubernetes-agenten blev hver for sig testet |
| Atmosphere | Dets dokumentation og kildekode | Intet på Atmosphere. Sonden og Kubernetes-agenten blev hver for sig testet |
| Canonical Sunbeam | Canonicals dokumentation og dets charms' kildekode | Intet på Sunbeam. Sunbeams egen dokumentation nævner ikke eksportør-charmen |
| Red Hat OpenStack on OpenShift | Telemetry Operators kildekode | Intet på Red Hats distribution. OpenShift-forudindstillingen og Ceilometers eksportør blev hver for sig testet |
| Mirantis MOSK | Mirantis' dokumentation, hvis eksempler viser andre modtagere frem for en webhook | Intet på MOSK |

Det, hver guides **Hvem gjorde hvad** bygger på, blev optaget på DevStack og på ingen af disse værktøjer. Hvor hvert værktøj placerer det, er læst fra det værktøjs kildekode eller dokumentation.

Ved siden af er hele stien kørt på en levende OneUptime, startet som Docker Compose starter den, på en rigtig DevStack frem for nogen af disse værktøjer. Agenten, installeret med dens dokumentations kommandoer, registrerede clouden ud fra sine første data, og hver instans, diskenhed og hypervisor havde en række med den status, clouden selv gav den. Med `nova-compute` rent faktisk stoppet gik dens række ned, en monitor fra skabelonen Compute Service Down åbnede én hændelse, der navngav værten, omkring 12 minutter senere, og den blev løst inden for et minut, efter at tjenesten startede igen. Et projekts sonde tilsluttede den samme cloud gennem dashboardets egne ruter og læste dens rækker tilbage, og 114 spans fra en signeret opstart ankom på tværs af dens tjenester, fra trace-profilen.

Særskilt blev det, en rigtig agent sendte på DevStack, og det, Kolla-Ansibles Alertmanager postede, optaget og derefter sendt til en levende OneUptime: den udløsende webhook åbnede én hændelse på den rigtige cloud og på ingen anden, den samme webhook igen åbnede intet, og den løste webhook løste den.

## Videresend det, der allerede udløser

Ethvert værktøj med en Alertmanager kan få hændelser i dag: en advarsel, der udløses, bliver til en hændelse, med vagtplan og statussider fra den første time, og den løses, når advarslen gør. Der er intet at installere, og dette virker side om side med alt andet på denne side.

:::steps
### Opret monitoren

Opret en Incoming Request-monitor, som [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#modtag-advarsler-med-en-monitor) beskriver, og kopiér dens **Heartbeat URL**. Det er adressen `<secret key>` i hvert værktøjs modtager nedenfor.

### Sæt den på clouden

Åbn monitorens **Oversigt → Tilknyttede ressourcer**, og tilføj OpenStack-clouden. Hver hændelse står så på den clouds side **Hændelser**: en Incoming Request-monitors egne indstillinger nævner ingen cloud, så hver clouds Alertmanager har brug for en monitor for sig. Clouden dukker op på listen, når dens første data ankommer, så gør dette efter trinene nedenfor, eller tilføj clouden under **OpenStack → Alle clouds** først.
:::

Alertmanager, i den version Kolla-Ansible fastlåser, er optaget i at poste i netop denne form, og det, den postede, åbnede én hændelse på en kørende OneUptime, som dens egen `resolved`-status løste.

## Kolla-Ansible

Med `enable_prometheus` slået til i `/etc/kolla/globals.yml`, som Kolla-Ansible lader være slået fra, indtil du sætter den, kører den Prometheus, Alertmanager og en eksportør for hver ting under clouden og leverer ingen advarselsregler. Denne guide læser det, de kører, frem for at starte en anden kopi.

### Videresend det, der udløser, på Kolla-Ansible

Kun hvis du skrev dine egne regler: Kolla-Ansible leverer ingen, så intet udløses, før `/etc/kolla/config/prometheus/*.rules` rummer nogle. På den vært, du udruller fra, skriv `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, som Kolla-Ansible læser i stedet for sin egen, og anvend den:

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

### Legitimationen på Kolla-Ansible

Log ind som admin med `source /etc/kolla/admin-openrc.sh`, som `kolla-ansible post-deploy` skriver.

- **Fuld visning** kræver én ændring, i Cinder. Kolla-Ansibles skabeloner sætter allerede `service_type` under `[keystone_authtoken]` på Nova, Neutron, Glance og Placement, men dens Cinder siger `volume`, og dens katalog siger `block-storage`, og keystonemiddleware afviser en legitimation, der er begrænset af adgangsregler, med en `401`, medmindre de to stemmer overens. Tilføj `service_type = block-storage` under `[keystone_authtoken]` i `/etc/kolla/config/cinder.conf`, og kør derefter `kolla-ansible reconfigure -i <inventory> --tags cinder`.
- **Kun infrastruktur** tager sine tilsidesættelser i `/etc/kolla/config/nova/policy.yaml` og det samme for `neutron`, `keystone` og `placement`, flettet med det, der allerede er der. Anvend dem med `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.

### Overvåg det, Kolla-Ansibles cloud står på

På den vært, der kører Kolla-Ansibles Prometheus, læser dette dens mål fra den fil, Kolla-Ansible har genereret, og udskriver dem som indstillinger til agenten:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Tilføj det, den udskriver, til agentens `.env`, og kør derefter `docker compose up -d` i agentens mappe. Hver eksportør lytter på API-netværket, så agentens maskine skal have en rute dertil. Cloudens kort **Kontrolplan** siger så, hvordan hver enkelt har det, og siger tydeligt, hvilke der ikke overvåges.

| Læser | Port | Indstilling |
| --- | --- | --- |
| RabbitMQs Prometheus-plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| HAProxys egen eksportør | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, til OVN og Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **OVNs databaser:** Kolla-Ansible kører openstack-network-exporter fra 2026.1, kun på compute- og netværksnoder, og en OVN-database læses fra den vært, den kører på. Hvis dine kontrolnoder ikke er nogen af delene, så tilføj dem under `[prometheus-openstack-network-exporter:children]` i din inventory og kør reconfigure, ellers læses Northbound- og Southbound-databaserne som ikke overvåget.
- **Før 2026.1** findes der ingen netværkseksportør, så OVN og Open vSwitch læses som ikke overvåget.

### Tjenestelogs på Kolla-Ansible

Agentens logprofil kører på hver node og læser Kolla-Ansibles filer. Det er den, der forbinder en linje med cloudens sider:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Kollas egen Fluentd kan også videresende, med et output i `/etc/kolla/config/fluentd/output/*.conf`, som [Fluentd](/docs/telemetry/fluentd) beskriver, men de poster når **Protokoller** under en tjenestes navn og ikke cloudens sider.

### Hvem gjorde hvad på Kolla-Ansible

Keystones revisionsspor og revisionsfilteret på hvert API, ind i [Sikkerhedshændelser](/docs/telemetry/openstack#hvem-gjorde-hvad). Hver skriver til tjenestens eget log, uden nogen forbruger på bussen. OneUptime læser dem derfra, når **Find sikkerhedshændelser i dine logs** er slået til, under **Sikkerhedshændelser → Forbindelser**. Agentens logprofil læser begge fra `/var/log/kolla`.

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

Dette sender en linje for hvert login, som **OpenStack-admin-legitimation brugt fra en ny adresse** læser. For kun at sende mislykkede logins skal du tilføje `identity.authenticate.success` til `notification_opt_out`, og den detektion læser så det, revisionsfilteret så.

For hvem der gjorde hvad gennem Nova, Neutron, Cinder og Glance kræver revisionsfilteret en indstilling, som kommer i hver tjenestes konfiguration på én gang:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

Det kræver også en paste-fil, og Kolla-Ansibles konfigurationsopgaver kopierer ingen paste-fil til disse tjenester. Læg din på hver API-vært, og monter den over den i imaget med `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` og `glance_api_extra_volumes` i `globals.yml`. pyCADF's map-filer ligger i `/var/lib/kolla/venv/etc/pycadf` i imaget. [Hvem gjorde hvad](/docs/telemetry/openstack#slå-revisionsfilteret-til) har filterets linjer.

## OpenStack-Ansible

OpenStack-Ansible opbevarer sine tjenesters logs i journald og kører ingen egen Prometheus, så agenten er vejen ind, og logsene har en sti for sig.

### Legitimationen på OpenStack-Ansible

Log ind som admin fra utility-containeren: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, derefter `. ~/openrc`. Den har ingen `curl`, som kommandoerne nedenfor bruger, så kør `apt-get install -y curl` dér først.

- **Fuld visning** kræver én ændring, i Cinder. OpenStack-Ansibles roller sætter allerede `service_type` under `[keystone_authtoken]`, men dens Cinder siger `volumev3`, og dens katalog siger `block-storage`, og keystonemiddleware afviser en legitimation, der er begrænset af adgangsregler, med en `401`, medmindre de to stemmer overens. Sæt `service_type: block-storage` under `keystone_authtoken` i `cinder_cinder_conf_overrides` i `/etc/openstack_deploy/user_variables.yml`, og kør derefter `openstack-ansible openstack.osa.cinder --tags cinder-config`.
- **Kun infrastruktur** tager sine tilsidesættelser som `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` og `placement_policy_overrides` i `/etc/openstack_deploy/user_variables.yml`. Anvend hver med sit eget playbook og tag, f.eks. `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Hvis du fjerner en senere, efterlades en tom fil frem for ingen, så intet fejler.

### Overvåg det, OpenStack-Ansibles cloud står på

OpenStack-Ansible kører ingen eksportører til disse, så kun det, du slår til, overvåges.

**RabbitMQ:** slå dens Prometheus-plugin til, og angiv derefter hver containers adresse på `15692` som `OPENSTACK_RABBITMQ_TARGETS` i agentens `.env`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** dens eksportør er slået fra, og dens stats-lytter ligger på `127.0.0.1` med TLS, som agenten ikke kan læse. Slå den til, hvor agenten kan, og angiv derefter den adresse på `1936` som `OPENSTACK_HAPROXY_TARGETS`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB og Memcached:** OpenStack-Ansible leverer ingen eksportør til nogen af dem. Kør selv [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) og [memcached_exporter](https://github.com/prometheus/memcached_exporter), og angiv dem som `OPENSTACK_MARIADB_TARGETS` og `OPENSTACK_MEMCACHED_TARGETS`, eller udelad dem: cloudens kort **Kontrolplan** siger så, at de ikke overvåges, frem for at de er i orden.

### Tjenestelogs på OpenStack-Ansible

Fra journald, på hver vært der kører en tjeneste: containere sender deres journaler videre til værten.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

Dette kører agentens logprofil som en systemd-tjeneste og læser `/var/log/journal/`, hvor OpenStack-Ansibles containeres journaler ankommer.

### Hvem gjorde hvad på OpenStack-Ansible

Keystones revisionsspor og revisionsfilteret på hvert API, ind i [Sikkerhedshændelser](/docs/telemetry/openstack#hvem-gjorde-hvad). Hver skriver til tjenestens eget log, uden nogen forbruger på bussen. OneUptime læser dem derfra, når **Find sikkerhedshændelser i dine logs** er slået til, under **Sikkerhedshændelser → Forbindelser**. Agentens logprofil læser begge fra journalen.

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

Dette sender en linje for hvert login, som **OpenStack-admin-legitimation brugt fra en ny adresse** læser. For kun at sende mislykkede logins skal du tilføje `identity.authenticate.success` til `notification_opt_out`, og den detektion læser så det, revisionsfilteret så. En anden værdi af `notification_opt_out` kommer ind som et YAML-sæt, som [dens config_template](https://docs.openstack.org/ansible-config_template/latest/) skriver en gentaget nøgle.

For hvem der gjorde hvad gennem Nova, Neutron, Cinder og Glance tager hvert API filterets indstilling i sine conf-tilsidesættelser og filteret i sine paste-tilsidesættelser, med `audit` lige efter `authtoken` og kontekstfilteret, der følger efter det, i hver pipeline. Novas, og det samme i `neutron_neutron_conf_overrides` og `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` og `cinder_api_paste_ini_overrides` samt `glance_glance_api_conf_overrides` og `glance_glance_api_paste_ini_overrides`:

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

OpenStack-Helm tilbyder charts til Prometheus, Alertmanager og eksportører, og om de kører, er op til dig. Dets kontrolplan kører i Kubernetes, så en sonde læser API'erne, og Kubernetes-agenten ser pod'erne.

### Videresend det, der udløser, på OpenStack-Helm

Hvis du kører dets prometheus-alertmanager-chart, så tilføj modtageren under `conf.alertmanager` i chartets værdier, og send din rute til den:

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

### Læs API'erne, og se pod'erne på OpenStack-Helm

Åbn **OpenStack → Alle clouds**, klik på **Tilslut cloud**, og giv den Keystones adresse, en applikationslegitimation og den sonde, der skal bruges. En sonde taler kun HTTPS med en cloud. Følg derefter **Kubernetes → Dokumentation** for den klynge, chartene kører på: dens pod'er, deres logs og deres noder når Kubernetes-siderne.

For også at få de tjenesters logs på denne clouds side **Protokoller**, hver stack trace som én post, skal du navngive clouden i agentens værdier, med de namespaces, dens tjenester kører i:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Hvem gjorde hvad på OpenStack-Helm

Keystones revisionsspor og revisionsfilteret på hvert API, ind i [Sikkerhedshændelser](/docs/telemetry/openstack#hvem-gjorde-hvad). Hver skriver til tjenestens eget log, uden nogen forbruger på bussen. OneUptime læser dem derfra, når **Find sikkerhedshændelser i dine logs** er slået til, under **Sikkerhedshændelser → Forbindelser**. Kubernetes-agenten læser begge fra pod'ernes logs, med clouden navngivet i dens værdier.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

Dette sender en linje for hvert login, som **OpenStack-admin-legitimation brugt fra en ny adresse** læser. For kun at sende mislykkede logins skal du tilføje `identity.authenticate.success` til `notification_opt_out`, og den detektion læser så det, revisionsfilteret så.

Et charts `logging.conf` holder rodloggeren på `WARNING`, og log-driveren skriver under en logger for sig, så uden en til den skrives intet. En liste i values erstatter chartets, så `keys` rummer det, chartets har, plus dette:

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

For hvem der gjorde hvad gennem Nova, Neutron og Cinder har deres charts' `conf.paste` allerede revisionsfilteret i hver pipeline, og det skal have at vide, hvor det skal skrive. Hver skal bruge den samme logger i `conf.logging`. Glances chart har map'et og hverken filteret eller en plads til det i sine pipelines: tilføj begge til dens `conf.paste`.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere kører kube-prometheus-stack med sine egne advarselsregler og Loki med Vector til logs. Videresend først dens advarsler, så læser en sonde API'erne, og Kubernetes-agenten ser pod'erne.

### Videresend det, der udløser, på Atmosphere

Atmosphere leverer advarselsregler, der har tilkaldt rigtige mennesker, så dette virker fra den første time. Tilføj modtageren til din Atmosphere-konfiguration ved siden af de modtagere, du allerede har, og udrul den:

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

### Læs API'erne, og se pod'erne på Atmosphere

Åbn **OpenStack → Alle clouds**, klik på **Tilslut cloud**, og giv den Keystones adresse, en applikationslegitimation og den sonde, der skal bruges. En sonde taler kun HTTPS med en cloud. Følg derefter **Kubernetes → Dokumentation** for den klynge, Atmosphere kører på.

For også at få de tjenesters logs på denne clouds side **Protokoller**, hver stack trace som én post, skal du navngive clouden i agentens værdier, med de namespaces, dens tjenester kører i:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Hvem gjorde hvad på Atmosphere

Keystones revisionsspor og revisionsfilteret på hvert API, ind i [Sikkerhedshændelser](/docs/telemetry/openstack#hvem-gjorde-hvad). Hver skriver til tjenestens eget log, uden nogen forbruger på bussen. OneUptime læser dem derfra, når **Find sikkerhedshændelser i dine logs** er slået til, under **Sikkerhedshændelser → Forbindelser**. Kubernetes-agenten læser begge fra pod'ernes logs, med clouden navngivet i dens værdier.

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

Dette sender en linje for hvert login, som **OpenStack-admin-legitimation brugt fra en ny adresse** læser. For kun at sende mislykkede logins skal du tilføje `identity.authenticate.success` til `notification_opt_out`, og den detektion læser så det, revisionsfilteret så.

For hvem der gjorde hvad gennem Nova, Neutron og Cinder har de charts, Atmosphere udruller, allerede revisionsfilteret i hver pipeline, og det skal have at vide, hvor det skal skrive, i `nova_helm_values`, `neutron_helm_values` og `cinder_helm_values`. Glances chart har hverken filteret eller en plads til det i sine pipelines: tilføj begge til dens `conf.paste`, i `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam kan udrulle Canonical Observability Stack med `sunbeam enable observability embedded`. Canonical har også en `openstack-exporter`-charm, som agenten kan læse, hvis du kører den. Sunbeams egen dokumentation nævner ikke den charm, og intet her er kørt på Sunbeam.

### Videresend det, der udløser, på Sunbeam

Hvis du kører Canonical Observability Stack, så giv dens Alertmanager en konfiguration med modtageren i:

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

### Eksportør-charmen

Hvis du kører Canonicals `openstack-exporter`-charm, kan agenten læse den uden nogen egen legitimation. Den svarer for én cloud på `/metrics`, på port `9180`, medmindre du har ændret dens `port`-indstilling. Find dens adresse med `juju status openstack-exporter`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Hvilke serier den udsender, afhænger af eksportørudgaven i dens snap, som ikke blev optaget her: `bash troubleshoot.sh` siger, om den læser clouden.

### Tjenestelogs på Sunbeam

Med observability slået til rummer stakkens Loki tjenesternes logs. OneUptime kan ikke læse Loki, og agentens logprofil er ikke prøvet på Sunbeams charms, så intet her indsamler dem endnu.

### Hvem gjorde hvad på Sunbeam

Ikke endnu. Sunbeams charms skriver hver tjenestes konfiguration fra deres egne skabeloner, og dens Keystone-charm har ingen indstilling for, hvor notifikationer skal hen. Så hverken Keystones revisionsspor eller revisionsfilteret kan slås til uden for charmen, og intet her når Sikkerhedshændelser.

## Red Hat OpenStack on OpenShift

Dens Telemetry Operator kører Ceilometers Prometheus-eksportør og en monitoreringsstak med Alertmanager på OpenShift. Kubernetes-agentens OpenShift-forudindstilling overvåger kontrolplanet, og Ceilometers eksportør siger, hvad compute-noderne laver.

### Videresend det, der udløser, på Red Hat OpenStack on OpenShift

Hvis `MetricStorage` har `alertingEnabled`, og du skrev eller anvendte regler, så anvend en modtager, monitoreringsstakken opfanger:

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

### Læs API'erne og kontrolplanet

Åbn **OpenStack → Alle clouds**, klik på **Tilslut cloud**, og giv den Keystones adresse, en applikationslegitimation og den sonde, der skal bruges. En sonde taler kun HTTPS med en cloud. Følg derefter **Kubernetes → Dokumentation** på den klynge, der kører kontrolplanet, med **Red Hat OpenShift** valgt, hvilket sætter `preset=openshift`.

For også at få de tjenesters logs på denne clouds side **Protokoller**, hver stack trace som én post, skal du navngive clouden i agentens værdier, med de namespaces, dens tjenester kører i:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Læs compute-noderne gennem Ceilometer

En sonde siger, hvad der er allokeret, ikke hvad der er optaget. For at læse det reelle forbrug skal du køre agenten på en maskine, der kan nå compute-noderne, med `OPENSTACK_CEILOMETER_EXPORTER_TARGETS`, der navngiver hver node på Ceilometers port, `9101`.

### Hvem gjorde hvad på Red Hat OpenStack on OpenShift

Keystones revisionsspor og revisionsfilteret på hvert API, ind i [Sikkerhedshændelser](/docs/telemetry/openstack#hvem-gjorde-hvad). Hver skriver til tjenestens eget log, uden nogen forbruger på bussen. OneUptime læser dem derfra, når **Find sikkerhedshændelser i dine logs** er slået til, under **Sikkerhedshændelser → Forbindelser**. Kubernetes-agenten læser begge fra pod'ernes logs, med clouden navngivet i dens værdier.

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

Dette sender en linje for hvert login, som **OpenStack-admin-legitimation brugt fra en ny adresse** læser. For kun at sende mislykkede logins skal du tilføje `identity.authenticate.success` til `notification_opt_out`, og den detektion læser så det, revisionsfilteret så.

For hvem der gjorde hvad gennem Nova og Neutron tager hver filterets indstilling i sin `customServiceConfig` og sin paste-fil i `defaultConfigOverwrite`. Cinders og Glances operatorer tager ingen paste-fil, så intet her når dem.

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

StackLight overvåger allerede OpenStacks tjenester, MariaDB, Memcached, RabbitMQ og libvirt med sine egne advarselsregler. Videresend først dens advarsler, så læser en sonde API'erne.

### Videresend det, der udløser, på Mirantis MOSK

StackLight leverer advarselsregler, så dette virker fra den første time. Tilføj modtageren og dens rute til dine StackLight-værdier. Mirantis' dokumentation viser andre modtagere frem for en webhook, og dette er ikke kørt på MOSK:

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

### Læs API'erne

Åbn **OpenStack → Alle clouds**, klik på **Tilslut cloud**, og giv den Keystones adresse, en applikationslegitimation og den sonde, der skal bruges. En sonde taler kun HTTPS med en cloud.

### Hvem gjorde hvad på Mirantis MOSK

For hvem der gjorde hvad gennem Nova, Neutron, Cinder og Glance har MOSK en indstilling for sig, med revisionsfilteret allerede på plads. Med log-driveren skriver hver tjeneste til sin standardoutput, og Kubernetes-agenten læser det fra pod'ernes logs, med clouden navngivet i dens værdier. Hver skriver til tjenestens eget log, uden nogen forbruger på bussen. OneUptime læser dem derfra, når **Find sikkerhedshændelser i dine logs** er slået til, under **Sikkerhedshændelser → Forbindelser**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

Den indstilling dækker ikke Keystone. Dens eget revisionsspor tager `spec:services`, som Mirantis ikke validerer og ikke påtager sig ansvar for, så afvej dette mod din supportaftale:

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

Dette sender en linje for hvert login, som **OpenStack-admin-legitimation brugt fra en ny adresse** læser. For kun at sende mislykkede logins skal du tilføje `identity.authenticate.success` til `notification_opt_out`, og den detektion læser så det, revisionsfilteret så.

## Brug den eksportør, du allerede kører

Ingen legitimation og intet nyt at køre: agenten kan læse en eksportør, du allerede har. Hvordan afhænger af, hvordan den blev startet.

- **Med `--multi-cloud`,** som agentens egen kører: sæt `OPENSTACK_EXPORTER_ADDRESS`, og agenten spørger den om én tjeneste ad gangen på `/probe`.
- **Uden den,** som Kolla-Ansibles og Canonicals charm kører: den har ingen `/probe`, så sæt `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`, og agenten spørger den om alt på én gang på `/metrics`, hvert 2. minut.

På Kolla-Ansible er det dens interne VIP på `9198`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Den aflæsning kommer oven i Kolla-Ansibles egen Prometheus, der spørger hvert minut. Kolla-Ansible fastlåser eksportør 1.7.0, og dens svar siger også mindre end den eksportør, agenten fastlåser. Dette er, hvad siderne gik uden på fem rigtige clouds, og en test holder det op mod de optagelser:

| Går uden | Fordi | Hvad det koster |
| --- | --- | --- |
| Alt fra Cinder | Den beder kataloget om `volumev3` og finder intet sådant, hvor Cinder er registreret som `block-storage` | **Diskenheder** og **Lagerpuljer** forbliver tomme, og **Tjenester** har ingen Block Storage API, `cinder-volume` eller `cinder-scheduler`. **Block Storage API nede**, **Block Storage-tjeneste nede**, **Lagerpulje advarsel**, **Lagerpulje kritisk**, **Diskenheder i fejl** og **Diskenhed sidder fast** forbliver tavse |
| Hvor mange instanser en hypervisor rummer, og dens aggregater | Novas liste over hypervisorer fejler ved den nyeste mikroversion, som Kolla-Ansible beder om | De to på **Hypervisorer** og det, en tabt vært siger, den tager med sig. Dens vCPU'er, hukommelse og disk er der stadig: de kommer fra Placement |
| Domæner | Den har ingen sådan serie | **Domæner** forbliver tom |
| Et billedes status, synlighed og oprettelsesdato | Den har ingen sådanne labels | Disse kolonner på **Billeder**. **Billede sidder fast** forbliver tavs, så et billede, der sidder fast på vej til `active`, går ubemærket hen |
| Et netværks MTU | Den har ingen sådan label | Den linje på et netværks side |

Hvis du har brug for dem, så brug agentens egen eksportør i stedet. Du kan ombestemme dig senere: en cloud beholder sit navn, uanset hvem der læser den.
