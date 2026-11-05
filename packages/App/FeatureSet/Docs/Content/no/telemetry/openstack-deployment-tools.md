# OpenStack etter distribusjonsverktøy

Ingen kjører «OpenStack». De kjører et verktøy som distribuerer det, og hvert verktøy har sine egne stier, sine egne logger og sin egen oppfatning av hva som allerede kjører. Denne siden er det oppsettsguiden i OneUptime sier for hvert av dem: åpne **OpenStack → Alle skyer**, koble til en sky og svar på **Hvordan distribuerer du OpenStack?**

:::cards
- [Hvor langt hver guide er testet](#hvor-langt-hver-guide-er-testet): Les dette først. Kolla-Ansibles er kjørt på en ekte distribusjon, bortsett fra et varsel. OpenStack-Ansibles er kjørt delvis. De andre er ikke kjørt.
- [Videresend det som allerede utløses](#videresend-det-som-allerede-utløses): Hendelser fra første time, uten agent.
- [Kolla-Ansible](#kolla-ansible): Les eksportørene den allerede kjører.
- [OpenStack-Ansible](#openstack-ansible): Journald-logger og overstyringer i `user_variables.yml`.
- [OpenStack-Helm](#openstack-helm) og [Atmosphere](#atmosphere): En sonde, og Kubernetes-agenten.
- [Canonical Sunbeam](#canonical-sunbeam): Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): OpenShift-forhåndsvalget og Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): StackLights varsler.
- [Bruk eksportøren du allerede kjører](#bruk-eksportøren-du-allerede-kjører): Hva sidene går uten på 1.7.0.
:::

## Hvor langt hver guide er testet

Hver sti, port og variabel nedenfor er lest fra verktøyets egen kildekode eller dokumentasjon. Riggen som tar opp OneUptimes testdata distribuerer også Kolla-Ansible og OpenStack-Ansible på en CI-runner, og kjører guidenes egne kommandoer der, med en stand-in for OneUptime som beholder det agenten sender. Så ingen guide her har rapportert til en kjørende OneUptime fra en ekte distribusjon av verktøyet sitt. Dette er hva hver er kontrollert mot:

| Verktøy | Lest fra | Kjørt for ekte |
| --- | --- | --- |
| Kolla-Ansible | Kildekoden, på master og `stable/2026.1` | Denne guidens kommandoer, på en ekte all-in-one på `stable/2026.1` med Open vSwitch: agenten på hver legitimasjon, uten Docker, på Kolla-Ansibles egen eksportør og på din egen i den festede versjonen og i 1.7.0, målene lest fra dens ekte `prometheus.yml`, og loggprofilen. Én del holdt ikke: med Memcached og nova-compute stoppet der postet Alertmanager ingenting, så ingen varsel har gått fra en Kolla-Ansible-stack til OneUptime. Det Alertmanager poster i versjonen den fester, tatt opp i en testklynge, åpnet og løste en hendelse på riktig sky i en kjørende OneUptime |
| OpenStack-Ansible | Kildekoden og dokumentasjonen | En ekte all-in-one på `stable/2026.1`, i LXC-containere, der denne guidens RabbitMQ- og HAProxy-innstillinger ble tatt i bruk med dens kommandoer og hver eksportør svarte, og loggprofilen leste journalen. Agentstegene er ikke kjørt på den: agenten og loggprofilen ble kjørt på en sky dette verktøyet ikke distribuerte |
| OpenStack-Helm | Chartenes verdier | Sonden og Kubernetes-agenten, hver for seg |
| Atmosphere | Dokumentasjonen og kildekoden | Sonden og Kubernetes-agenten, hver for seg |
| Canonical Sunbeam | Canonicals dokumentasjon og kildekoden til charmene | Ingenting på Sunbeam. Sunbeams egen dokumentasjon nevner ikke eksportør-charmen |
| Red Hat OpenStack on OpenShift | Telemetry Operators kildekode | OpenShift-forhåndsvalget og Ceilometers eksportør, hver for seg |
| Mirantis MOSK | Mirantis' dokumentasjon, hvis eksempler viser andre mottakere i stedet for en webhook | Ingenting på MOSK |

Det **Hvem gjorde hva** slår på i hver guide ble tatt opp på DevStack, på hver utgave riggen kjører, og på ingen av disse verktøyene. Hvor hvert verktøy tar det, er lest fra det verktøyets kildekode eller dokumentasjon.

Ved siden av dem har hele veien kjørt på en levende OneUptime, startet slik Docker Compose starter den, med app og sonde bygget fra denne koden, og på en ekte DevStack i stedet for noen av disse verktøyene. Agenten, installert med dokumentasjonens kommandoer, registrerte skyen fra de første dataene, og hver instans, hvert volum og hver hypervisor hadde en rad med statusen skyen selv ga den. Med `nova-compute` virkelig stoppet gikk raden ned, en overvåker fra malen Compute Service Down åpnet én hendelse som navnga verten 746 sekunder senere, og den ble løst 48 sekunder etter at tjenesten startet igjen. Et prosjekts sonde koblet til den samme skyen gjennom dashbordets egne ruter og leste radene tilbake, og 114 spenn fra en signert oppstart kom fram på tvers av tjenestene, fra traceprofilen.

Separat ble det en ekte agent og en ekte Alertmanager hadde sendt, tatt opp på DevStack og i en testklynge, ikke på en sky noen av disse verktøyene distribuerte. Sendt til en levende OneUptime åpnet webhooken for utløsning én hendelse på riktig sky og på ingen annen, den samme webhooken igjen åpnet ingenting, og webhooken for løsning løste den.

## Videresend det som allerede utløses

Ethvert verktøy med en Alertmanager kan ha hendelser i dag: et varsel som utløses blir en hendelse, med vaktordning og statussider fra første time, og den løses når varselet gjør det. Det er ingenting å installere, og dette fungerer sammen med alt annet på denne siden.

:::steps
### Lag overvåkeren

Lag en Incoming Request-overvåker slik [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#motta-varsler-med-en-monitor) sier, og kopier dens **Heartbeat URL**. Det er `<secret key>`-adressen i hvert verktøys mottaker nedenfor.

### Legg den på skyen

Åpne overvåkerens **Oversikt → Koblede ressurser** og legg til OpenStack-skyen. Hver hendelse er da på den skyens **Hendelser**-side: en Incoming Request-overvåkers egne innstillinger navngir ingen sky, så hver skys Alertmanager trenger en overvåker for seg. Skyen dukker opp i den listen når de første dataene kommer, så gjør dette etter stegene nedenfor, eller legg til skyen under **OpenStack → Alle skyer** først.
:::

Alertmanager er tatt opp mens den poster i akkurat denne formen i `Tests/Ops/openstack-e2e`, i versjonen Kolla-Ansible fester, og opptaket spilles av gjennom den ekte evaluatoren: én hendelse per varsel, løst av sin egen `resolved`-status.

## Kolla-Ansible

Med `enable_prometheus` på i `/etc/kolla/globals.yml`, som Kolla-Ansible lar stå av til du setter det, kjører den Prometheus, Alertmanager og en eksportør for hver ting under skyen, og leverer ingen varselregler. Denne guiden leser det de kjører i stedet for å starte en andre kopi.

### Videresend det som utløses på Kolla-Ansible

Bare hvis du skrev dine egne regler: Kolla-Ansible leverer ingen, så ingenting utløses før `/etc/kolla/config/prometheus/*.rules` inneholder noen. På verten du distribuerer fra skriver du `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, som Kolla-Ansible leser i stedet for sin egen, og tar den i bruk:

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

### Legitimasjonen på Kolla-Ansible

Logg inn som admin med `source /etc/kolla/admin-openrc.sh`, som `kolla-ansible post-deploy` skriver.

- **Full visning** trenger ingen endring i noen tjeneste: Kolla-Ansibles maler setter allerede `service_type` under `[keystone_authtoken]` på Nova, Neutron, Cinder, Glance og Placement. Dens Cinder sier `volume`, som tilgangsreglene også har med.
- **Kun infrastruktur** tar overstyringene sine i `/etc/kolla/config/nova/policy.yaml`, og det samme for `neutron`, `keystone` og `placement`, slått sammen med det som allerede er der. Ta dem i bruk med `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.

### Overvåk det Kolla-Ansibles sky hviler på

På verten som kjører Kolla-Ansibles Prometheus leser dette målene fra filen Kolla-Ansible har laget, og skriver dem ut som innstillinger for agenten:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Legg det den skriver ut til agentens `.env`, og kjør deretter `docker compose up -d` i agentens mappe. Hver eksportør lytter på API-nettverket, så agentens maskin trenger en rute dit. Skyens **Kontrollplan**-kort sier da hvordan hver av dem har det, og sier tydelig fra om hvilke som ikke overvåkes.

| Leser | Port | Innstilling |
| --- | --- | --- |
| RabbitMQs Prometheus-plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| HAProxys egen eksportør | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, for OVN og Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **OVNs databaser:** Kolla-Ansible kjører openstack-network-exporter fra 2026.1, bare på compute- og nettverksnoder, og en OVN-database leses fra verten den kjører på. Hvis kontrollnodene dine er ingen av delene, legg dem til under `[prometheus-openstack-network-exporter:children]` i inventaret ditt og rekonfigurer, ellers vises Northbound- og Southbound-databasene som ikke overvåket.
- **Før 2026.1** finnes det ingen nettverkseksportør, så OVN og Open vSwitch vises som ikke overvåket.

### Tjenestelogger på Kolla-Ansible

Agentens loggprofil kjører på hver node og leser Kolla-Ansibles filer. Det er den som knytter en linje til skyens sider:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Kollas egen Fluentd kan også videresende, med en utgang i `/etc/kolla/config/fluentd/output/*.conf` slik [Fluentd](/docs/telemetry/fluentd) beskriver, men de postene kommer til **Logger** under en tjenestes navn, og ikke på skyens sider.

### Hvem gjorde hva på Kolla-Ansible

Keystones revisjonsspor og revisjonsfilteret på hvert API, inn i [sikkerhetshendelser](/docs/telemetry/openstack#hvem-gjorde-hva). Hver skriver til tjenestens egen logg, uten noen forbruker på bussen. OneUptime leser dem derfra når **Finn sikkerhetshendelser i loggene dine** er på, under **Sikkerhetshendelser → Tilkoblinger**. Agentens loggprofil leser begge fra `/var/log/kolla`.

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

Dette sender en linje for hver innlogging, som **OpenStack-adminlegitimasjon brukt fra en ny adresse** leser. For å sende bare mislykkede innlogginger legger du til `identity.authenticate.success` i `notification_opt_out`, og den oppdagelsen leser da det revisjonsfilteret så.

For hvem som gjorde hva gjennom Nova, Neutron, Cinder og Glance trenger revisjonsfilteret en innstilling, som settes i alle tjenestenes konfigurasjon på én gang:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

Det trenger også en paste-fil, og Kolla-Ansibles konfigurasjonsoppgaver kopierer ingen paste-fil for disse tjenestene. Legg din på hver API-vert, og monter den over den i imaget med `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` og `glance_api_extra_volumes` i `globals.yml`. pyCADFs kartfiler ligger i `/var/lib/kolla/venv/etc/pycadf` i imaget. [Hvem gjorde hva](/docs/telemetry/openstack#slå-på-revisjonsfilteret) har filterets linjer.

## OpenStack-Ansible

OpenStack-Ansible holder tjenestenes logger i journald og kjører ingen egen Prometheus, så agenten er veien inn, og loggene har en egen vei.

### Legitimasjonen på OpenStack-Ansible

Logg inn som admin fra utility-containeren: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, deretter `. ~/openrc`. Den har ingen `curl`, som kommandoene nedenfor bruker, så kjør `apt-get install -y curl` der først.

- **Full visning** trenger ingen endring i noen tjeneste: OpenStack-Ansibles roller setter allerede `service_type` under `[keystone_authtoken]`. Dens Cinder sier `volumev3`, som tilgangsreglene også har med.
- **Kun infrastruktur** tar overstyringene sine som `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` og `placement_policy_overrides` i `/etc/openstack_deploy/user_variables.yml`. Ta hver i bruk med sin egen playbook og tagg, for eksempel `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Å fjerne en senere etterlater en tom fil i stedet for ingen, så ingenting feiler.

### Overvåk det OpenStack-Ansibles sky hviler på

OpenStack-Ansible kjører ingen eksportører for disse, så bare det du slår på overvåkes.

**RabbitMQ:** slå på Prometheus-pluginen, og oppgi deretter hver containers adresse på `15692` som `OPENSTACK_RABBITMQ_TARGETS` i agentens `.env`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** eksportøren er av, og statistikklytteren ligger på `127.0.0.1` med TLS, som agenten ikke kan lese. Slå den på der agenten kan nå den, og oppgi deretter den adressen på `1936` som `OPENSTACK_HAPROXY_TARGETS`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB og Memcached:** OpenStack-Ansible leverer ingen eksportør for noen av dem. Kjør [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) og [memcached_exporter](https://github.com/prometheus/memcached_exporter) selv og oppgi dem som `OPENSTACK_MARIADB_TARGETS` og `OPENSTACK_MEMCACHED_TARGETS`, eller utelat dem: skyens **Kontrollplan**-kort sier da at de ikke overvåkes, i stedet for at de er i orden.

### Tjenestelogger på OpenStack-Ansible

Fra journald, på hver vert som kjører en tjeneste: containere sender journalene sine videre til verten.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

Dette kjører agentens loggprofil som en systemd-tjeneste, og leser `/var/log/journal/`, dit OpenStack-Ansibles containeres journaler kommer.

### Hvem gjorde hva på OpenStack-Ansible

Keystones revisjonsspor og revisjonsfilteret på hvert API, inn i [sikkerhetshendelser](/docs/telemetry/openstack#hvem-gjorde-hva). Hver skriver til tjenestens egen logg, uten noen forbruker på bussen. OneUptime leser dem derfra når **Finn sikkerhetshendelser i loggene dine** er på, under **Sikkerhetshendelser → Tilkoblinger**. Agentens loggprofil leser begge fra journalen.

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

Dette sender en linje for hver innlogging, som **OpenStack-adminlegitimasjon brukt fra en ny adresse** leser. For å sende bare mislykkede innlogginger legger du til `identity.authenticate.success` i `notification_opt_out`, og den oppdagelsen leser da det revisjonsfilteret så. En andre verdi av `notification_opt_out` settes inn som et YAML-sett, slik [dens config_template](https://docs.openstack.org/ansible-config_template/latest/) skriver en gjentatt nøkkel.

For hvem som gjorde hva gjennom Nova, Neutron, Cinder og Glance tar hvert API filterets innstilling i sine conf-overstyringer, og filteret i sine paste-overstyringer, med `audit` rett etter `authtoken` og kontekstfilteret som følger etter det i hver pipeline. Novas, og det samme i `neutron_neutron_conf_overrides` og `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` og `cinder_api_paste_ini_overrides`, og `glance_glance_api_conf_overrides` og `glance_glance_api_paste_ini_overrides`:

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

OpenStack-Helm tilbyr charts for Prometheus, Alertmanager og eksportører, og om de kjører er opp til deg. Kontrollplanet kjører i Kubernetes, så en sonde leser API-ene og Kubernetes-agenten ser podene.

### Videresend det som utløses på OpenStack-Helm

Hvis du kjører dens prometheus-alertmanager-chart, legg mottakeren under `conf.alertmanager` i chartens verdier, og send ruten din til den:

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

### Les API-ene og se podene på OpenStack-Helm

Åpne **OpenStack → Alle skyer**, klikk **Koble til sky**, og gi den Keystones adresse, en applikasjonslegitimasjon og sonden som skal brukes. En sonde snakker bare HTTPS med en sky. Følg deretter **Kubernetes → Dokumentasjon** for klyngen chartene kjører på: podene, loggene deres og nodene deres kommer til Kubernetes-sidene.

For å få disse tjenestenes logger på denne skyens **Logger**-side også, hver stack trace som én post, navngi skyen i agentens verdier, med navnerommene tjenestene kjører i:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Hvem gjorde hva på OpenStack-Helm

Keystones revisjonsspor og revisjonsfilteret på hvert API, inn i [sikkerhetshendelser](/docs/telemetry/openstack#hvem-gjorde-hva). Hver skriver til tjenestens egen logg, uten noen forbruker på bussen. OneUptime leser dem derfra når **Finn sikkerhetshendelser i loggene dine** er på, under **Sikkerhetshendelser → Tilkoblinger**. Kubernetes-agenten leser begge fra podenes logger, med skyen navngitt i verdiene sine.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

Dette sender en linje for hver innlogging, som **OpenStack-adminlegitimasjon brukt fra en ny adresse** leser. For å sende bare mislykkede innlogginger legger du til `identity.authenticate.success` i `notification_opt_out`, og den oppdagelsen leser da det revisjonsfilteret så.

En charts `logging.conf` holder rotloggeren på `WARNING`, og loggdriveren skriver under en egen logger, så uten en for den skrives ingenting. En liste i verdier erstatter chartens, så `keys` holder det chartens har, pluss dette:

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

For hvem som gjorde hva gjennom Nova, Neutron og Cinder har chartenes `conf.paste` allerede revisjonsfilteret i hver pipeline, og det må få vite hvor det skal skrive. Hver trenger den samme loggeren, i `conf.logging`. Glances chart har kartet, men verken filteret eller et sted for det i pipelinene sine: legg til begge i dens `conf.paste`.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere kjører kube-prometheus-stack med egne varselregler, og Loki med Vector for logger. Videresend varslene først, så leser en sonde API-ene og Kubernetes-agenten ser podene.

### Videresend det som utløses på Atmosphere

Atmosphere leverer varselregler som har tilkalt ekte folk, så dette fungerer fra første time. Legg mottakeren til Atmosphere-konfigurasjonen din, ved siden av de mottakerne du allerede har, og distribuer den:

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

### Les API-ene og se podene på Atmosphere

Åpne **OpenStack → Alle skyer**, klikk **Koble til sky**, og gi den Keystones adresse, en applikasjonslegitimasjon og sonden som skal brukes. En sonde snakker bare HTTPS med en sky. Følg deretter **Kubernetes → Dokumentasjon** for klyngen Atmosphere kjører på.

For å få disse tjenestenes logger på denne skyens **Logger**-side også, hver stack trace som én post, navngi skyen i agentens verdier, med navnerommene tjenestene kjører i:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Hvem gjorde hva på Atmosphere

Keystones revisjonsspor og revisjonsfilteret på hvert API, inn i [sikkerhetshendelser](/docs/telemetry/openstack#hvem-gjorde-hva). Hver skriver til tjenestens egen logg, uten noen forbruker på bussen. OneUptime leser dem derfra når **Finn sikkerhetshendelser i loggene dine** er på, under **Sikkerhetshendelser → Tilkoblinger**. Kubernetes-agenten leser begge fra podenes logger, med skyen navngitt i verdiene sine.

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

Dette sender en linje for hver innlogging, som **OpenStack-adminlegitimasjon brukt fra en ny adresse** leser. For å sende bare mislykkede innlogginger legger du til `identity.authenticate.success` i `notification_opt_out`, og den oppdagelsen leser da det revisjonsfilteret så.

For hvem som gjorde hva gjennom Nova, Neutron og Cinder har chartene Atmosphere distribuerer allerede revisjonsfilteret i hver pipeline, og det må få vite hvor det skal skrive, i `nova_helm_values`, `neutron_helm_values` og `cinder_helm_values`. Glances chart har verken filteret eller et sted for det i pipelinene sine: legg til begge i dens `conf.paste`, i `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam kan distribuere Canonical Observability Stack, med `sunbeam enable observability embedded`. Canonical har også en `openstack-exporter`-charm, som agenten kan lese hvis du kjører den. Sunbeams egen dokumentasjon nevner ikke den charmen, og ingenting her er kjørt på Sunbeam.

### Videresend det som utløses på Sunbeam

Hvis du kjører Canonical Observability Stack, gi Alertmanager en konfigurasjon med mottakeren i:

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

Hvis du kjører Canonicals `openstack-exporter`-charm, kan agenten lese den uten noen egen legitimasjon. Den svarer for én sky på `/metrics`, på port `9180` med mindre du endret dens `port`-innstilling. Finn adressen med `juju status openstack-exporter`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Hvilke serier den sier, avhenger av eksportørutgaven i dens snap, som ikke ble tatt opp her: `bash troubleshoot.sh` sier om den leser skyen.

### Tjenestelogger på Sunbeam

Med observability på holder stackens Loki tjenestenes logger. OneUptime har ingen måte å lese Loki på, og agentens loggprofil er ikke prøvd på Sunbeams charms, så ingenting her samler dem inn ennå.

### Hvem gjorde hva på Sunbeam

Ikke ennå. Sunbeams charms skriver hver tjenestes konfigurasjon fra sine egne maler, og Keystone-charmen har ingen innstilling for hvor varsler skal sendes. Så verken Keystones revisjonsspor eller revisjonsfilteret kan slås på utenfra charmen, og ingenting her når sikkerhetshendelser.

## Red Hat OpenStack on OpenShift

Telemetry Operator kjører Ceilometers Prometheus-eksportør og en overvåkingsstack med Alertmanager på OpenShift. Kubernetes-agentens OpenShift-forhåndsvalg overvåker kontrollplanet, og Ceilometers eksportør sier hva compute-nodene gjør.

### Videresend det som utløses på Red Hat OpenStack on OpenShift

Hvis `MetricStorage` har `alertingEnabled` og du skrev eller tok i bruk regler, ta i bruk en mottaker overvåkingsstacken plukker opp:

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

### Les API-ene og kontrollplanet

Åpne **OpenStack → Alle skyer**, klikk **Koble til sky**, og gi den Keystones adresse, en applikasjonslegitimasjon og sonden som skal brukes. En sonde snakker bare HTTPS med en sky. Følg deretter **Kubernetes → Dokumentasjon** på klyngen som kjører kontrollplanet, med **Red Hat OpenShift** valgt, som setter `preset=openshift`.

For å få disse tjenestenes logger på denne skyens **Logger**-side også, hver stack trace som én post, navngi skyen i agentens verdier, med navnerommene tjenestene kjører i:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Les compute-nodene gjennom Ceilometer

En sonde sier hva som er allokert, ikke hva som er travelt. For å lese den virkelige bruken, kjør agenten på en maskin som kan nå compute-nodene, med `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` som navngir hver node på Ceilometers port, `9101`.

### Hvem gjorde hva på Red Hat OpenStack on OpenShift

Keystones revisjonsspor og revisjonsfilteret på hvert API, inn i [sikkerhetshendelser](/docs/telemetry/openstack#hvem-gjorde-hva). Hver skriver til tjenestens egen logg, uten noen forbruker på bussen. OneUptime leser dem derfra når **Finn sikkerhetshendelser i loggene dine** er på, under **Sikkerhetshendelser → Tilkoblinger**. Kubernetes-agenten leser begge fra podenes logger, med skyen navngitt i verdiene sine.

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

Dette sender en linje for hver innlogging, som **OpenStack-adminlegitimasjon brukt fra en ny adresse** leser. For å sende bare mislykkede innlogginger legger du til `identity.authenticate.success` i `notification_opt_out`, og den oppdagelsen leser da det revisjonsfilteret så.

For hvem som gjorde hva gjennom Nova og Neutron tar hver filterets innstilling i sin `customServiceConfig`, og paste-filen sin i `defaultConfigOverwrite`. Cinders og Glances operatorer tar ingen paste-fil, så ingenting her når dem.

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

StackLight overvåker allerede OpenStacks tjenester, MariaDB, Memcached, RabbitMQ og libvirt, med egne varselregler. Videresend varslene først, så leser en sonde API-ene.

### Videresend det som utløses på Mirantis MOSK

StackLight leverer varselregler, så dette fungerer fra første time. Legg mottakeren og ruten dens til StackLight-verdiene dine. Mirantis' dokumentasjon viser andre mottakere i stedet for en webhook, og dette er ikke kjørt på MOSK:

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

### Les API-ene

Åpne **OpenStack → Alle skyer**, klikk **Koble til sky**, og gi den Keystones adresse, en applikasjonslegitimasjon og sonden som skal brukes. En sonde snakker bare HTTPS med en sky.

### Hvem gjorde hva på Mirantis MOSK

For hvem som gjorde hva gjennom Nova, Neutron, Cinder og Glance har MOSK en egen innstilling, med revisjonsfilteret allerede på plass. Med loggdriveren skriver hver tjeneste til standardutgangen sin, og Kubernetes-agenten leser det fra podenes logger, med skyen navngitt i verdiene sine. Hver skriver til tjenestens egen logg, uten noen forbruker på bussen. OneUptime leser dem derfra når **Finn sikkerhetshendelser i loggene dine** er på, under **Sikkerhetshendelser → Tilkoblinger**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

Den innstillingen dekker ikke Keystone. Dens eget revisjonsspor tar `spec:services`, som Mirantis ikke validerer og ikke tar ansvar for, så vei dette mot supportavtalen din:

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

Dette sender en linje for hver innlogging, som **OpenStack-adminlegitimasjon brukt fra en ny adresse** leser. For å sende bare mislykkede innlogginger legger du til `identity.authenticate.success` i `notification_opt_out`, og den oppdagelsen leser da det revisjonsfilteret så.

## Bruk eksportøren du allerede kjører

Ingen legitimasjon og ingenting nytt å kjøre: agenten kan lese en eksportør du allerede har. Hvordan avhenger av hvordan den ble startet.

- **Med `--multi-cloud`,** slik agentens egen kjører: sett `OPENSTACK_EXPORTER_ADDRESS`, så spør agenten den om én tjeneste om gangen på `/probe`.
- **Uten den,** slik Kolla-Ansibles og Canonicals charm kjører: den har ingen `/probe`, så sett `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`, så spør agenten den om alt på én gang på `/metrics`, hvert 2. minutt.

På Kolla-Ansible er det den interne VIP-en på `9198`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Den gjennomgangen kommer på toppen av at Kolla-Ansibles egen Prometheus spør hvert minutt. Kolla-Ansible fester eksportør 1.7.0, og svaret dens sier også mindre enn eksportøren agenten fester. Dette er hva sidene gikk uten på fem virkelige skyer, og en test holder det opp mot disse opptakene:

| Går uten | Fordi | Hva det koster |
| --- | --- | --- |
| Alt fra Cinder | Den spør katalogen etter `volumev3`, og finner ingenting slikt der Cinder registrerer seg som `block-storage` | **Volumer** og **Lagringspooler** blir tomme, og **Tjenester** har ingen Block Storage API, `cinder-volume` eller `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** og **Volume Stuck** forblir stille |
| Hvor mange instanser en hypervisor holder, og aggregatene dens | Novas liste over hypervisorer feiler på den nyeste mikroversjonen, som Kolla-Ansible ber om | Disse to på **Hypervisorer**, og det en tapt vert sier at den tar med seg. vCPU-ene, minnet og disken er fortsatt der: de kommer fra Placement |
| Domener | Den har ingen slik serie | **Domener** forblir tom |
| Et bildes status, synlighet og opprettelsesdato | Den har ingen slike etiketter | Disse kolonnene på **Bilder**. **Image Stuck** forblir stille, så et bilde som står fast på vei til `active` går ubemerket hen |
| Et nettverks MTU | Den har ingen slik etikett | Den linjen på et nettverks side |

Hvis du trenger disse, bruk agentens egen eksportør i stedet. Du kan ombestemme deg senere: en sky beholder navnet sitt uansett hvem som leser den.
