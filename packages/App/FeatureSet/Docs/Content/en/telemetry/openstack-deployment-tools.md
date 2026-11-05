# OpenStack by Deployment Tool

Nobody runs "OpenStack". They run a tool that deploys it, and each tool has its own paths, its own logs and its own idea of what is already running. This page is what the setup guide in OneUptime says for each one: open **OpenStack → All Clouds**, connect a cloud, and answer **How do you deploy OpenStack?**

:::cards
- [How far each guide has been tested](#how-far-each-guide-has-been-tested): Read this first. None has been followed end to end on a real deployment.
- [Forward what is already firing](#forward-what-is-already-firing): Incidents from the first hour, with no agent.
- [Kolla-Ansible](#kolla-ansible): Read the exporters it already runs.
- [OpenStack-Ansible](#openstack-ansible): Journald logs, and overrides in `user_variables.yml`.
- [OpenStack-Helm](#openstack-helm) and [Atmosphere](#atmosphere): A probe, and the Kubernetes agent.
- [Canonical Sunbeam](#canonical-sunbeam): The Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): The OpenShift preset, and Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): StackLight's alerts.
- [Use the exporter you already run](#use-the-exporter-you-already-run): What the pages go without on 1.7.0.
:::

## How far each guide has been tested

Every path, port and variable below was read from the tool's own source or docs. The rig that records OneUptime's fixtures deploys DevStack, not these tools, so no guide here has been followed end to end on a real deployment of its tool. What each has been checked against:

| Tool | Read from | Run for real |
| --- | --- | --- |
| Kolla-Ansible | Its source, at master and `stable/2026.1` | Its exporters at the versions it pins, in real clusters and on a real cloud, failing and recovering, with Alertmanager posting to a webhook. What it posted then opened and resolved an incident on the right cloud, on a running OneUptime |
| OpenStack-Ansible | Its source and docs | The agent and its logs profile, on a cloud this tool did not deploy |
| OpenStack-Helm | Its chart values | The probe and the Kubernetes agent, each on its own |
| Atmosphere | Its docs and source | The probe and the Kubernetes agent, each on its own |
| Canonical Sunbeam | Canonical's docs, and its charms' source | Nothing on Sunbeam. Sunbeam's own docs do not mention the exporter charm |
| Red Hat OpenStack on OpenShift | The Telemetry Operator's source | The OpenShift preset and Ceilometer's exporter, each on its own |
| Mirantis MOSK | Mirantis's docs, whose examples show other receivers rather than a webhook | Nothing on MOSK |

What each guide's **Who did what** turns on was recorded on DevStack, on every release the rig runs, and on none of these tools. Where each tool takes it was read from that tool's source or docs.

One part of this has run on a live OneUptime, started as Docker Compose starts it, with its app built from this code. It was sent what a real agent and a real Alertmanager had sent: each cloud registered from its first data and filled 60 rows of inventory across 14 kinds, the firing webhook opened one incident on the right cloud and on no other, the same webhook again opened nothing, and the resolved webhook resolved it. What it was sent was recorded on DevStack and in a test cluster, not on a cloud any of these tools deployed, and no guide's commands ran against it.

## Forward what is already firing

Any tool with an Alertmanager can have incidents today: an alert that fires becomes an incident, with on-call and status pages from the first hour, and it resolves when the alert does. There is nothing to install, and this works alongside everything else on this page.

:::steps
### Make the monitor

Make an Incoming Request monitor as [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) says, and copy its **Heartbeat URL**. That is the `<secret key>` address in each tool's receiver below.

### Put it on the cloud

Open the monitor's **Overview → Linked Resources** and add the OpenStack cloud. Each incident is then on that cloud's **Incidents** page: an Incoming Request monitor's own settings name no cloud, so each cloud's Alertmanager needs a monitor of its own. The cloud shows up in that list once its first data arrives, so do this after the steps below, or add the cloud under **OpenStack → All Clouds** first.
:::

Alertmanager is recorded posting to this exact shape in `Tests/Ops/openstack-e2e`, at the version Kolla-Ansible pins, and the recording replays through the real evaluator: one incident per alert, resolved by its own `resolved` status.

## Kolla-Ansible

With `enable_prometheus` on in `/etc/kolla/globals.yml`, which Kolla-Ansible leaves off until you set it, it runs Prometheus, Alertmanager and an exporter for each thing under the cloud, and ships no alert rules. This guide reads what those run rather than starting a second copy.

### Forward what is firing on Kolla-Ansible

Only if you wrote your own rules: Kolla-Ansible ships none, so nothing fires until `/etc/kolla/config/prometheus/*.rules` holds some. On the host you deploy from, write `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, which Kolla-Ansible reads in place of its own, and apply it:

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

### The credential on Kolla-Ansible

Log in as an admin with `source /etc/kolla/admin-openrc.sh`, which `kolla-ansible post-deploy` writes.

- **Full view** needs no change to any service: Kolla-Ansible's templates already set `service_type` under `[keystone_authtoken]` on Nova, Neutron, Cinder, Glance and Placement. Its Cinder says `volume`, which the access rules also carry.
- **Infrastructure only** takes its overrides at `/etc/kolla/config/nova/policy.yaml`, and the same for `neutron`, `keystone` and `placement`, merged with anything already there. Apply them with `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.

### Watch what Kolla-Ansible's cloud stands on

On the host that runs Kolla-Ansible's Prometheus, this reads its targets from the file Kolla-Ansible rendered, and prints them as settings for the agent:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Add what it prints to the agent's `.env`, then run `docker compose up -d` in the agent's folder. Each exporter listens on the API network, so the agent's machine needs a route there. The cloud's **Control Plane** card then says how each one is, and says plainly which ones are not watched.

| Reads | Port | Setting |
| --- | --- | --- |
| RabbitMQ's Prometheus plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| HAProxy's own exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, for OVN and Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **OVN's databases:** Kolla-Ansible runs openstack-network-exporter from 2026.1, on compute and network nodes only, and an OVN database is read from the host it runs on. If your control nodes are neither, add them under `[prometheus-openstack-network-exporter:children]` in your inventory and reconfigure, or the Northbound and Southbound databases read as not watched.
- **Before 2026.1** there is no network exporter, so OVN and Open vSwitch read as not watched.

### Service logs on Kolla-Ansible

The agent's logs profile runs on each node, and reads Kolla-Ansible's files. It is what joins a line to the cloud's pages:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Kolla's own Fluentd can forward too, with an output in `/etc/kolla/config/fluentd/output/*.conf` as [Fluentd](/docs/telemetry/fluentd) describes, but those records reach **Logs** under a service's name, and not the cloud's pages.

### Who did what on Kolla-Ansible

Keystone's audit trail and the audit filter on each API, into [Security Events](/docs/telemetry/openstack#who-did-what). Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from `/var/log/kolla`.

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

This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.

For who did what through Nova, Neutron, Cinder and Glance, the audit filter needs a setting, which goes in every service's config at once:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

It also needs a paste file, and Kolla-Ansible's config tasks copy no paste file for these services. Put yours on each API host, and mount it over the one in the image with `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` and `glance_api_extra_volumes` in `globals.yml`. pyCADF's map files are in `/var/lib/kolla/venv/etc/pycadf` in the image. [Who did what](/docs/telemetry/openstack#turn-on-the-audit-filter) has the filter's lines.

## OpenStack-Ansible

OpenStack-Ansible keeps its services' logs in journald and runs no Prometheus of its own, so the agent is the way in, and the logs have a path of their own.

### The credential on OpenStack-Ansible

Log in as an admin from the utility container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, then `. ~/openrc`.

- **Full view** needs no change to any service: OpenStack-Ansible's roles already set `service_type` under `[keystone_authtoken]`. Its Cinder says `volumev3`, which the access rules also carry.
- **Infrastructure only** takes its overrides as `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` and `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Apply each with its own playbook and tag, such as `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Taking one out later leaves an empty file behind rather than none, so nothing fails.

### Watch what OpenStack-Ansible's cloud stands on

OpenStack-Ansible runs no exporters for these, so only what you turn on is watched.

**RabbitMQ:** turn on its Prometheus plugin, then name each container's address on `15692` as `OPENSTACK_RABBITMQ_TARGETS` in the agent's `.env`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** its exporter is off, and its stats listener is on `127.0.0.1` with TLS, which the agent cannot read. Turn it on where the agent can, then name that address on `1936` as `OPENSTACK_HAPROXY_TARGETS`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB and Memcached:** OpenStack-Ansible ships no exporter for either. Run [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) and [memcached_exporter](https://github.com/prometheus/memcached_exporter) yourself and name them as `OPENSTACK_MARIADB_TARGETS` and `OPENSTACK_MEMCACHED_TARGETS`, or leave them out: the cloud's **Control Plane** card then says they are not watched, rather than that they are fine.

### Service logs on OpenStack-Ansible

From journald, on each host that runs a service: containers pass their journals through to the host.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

This runs the agent's logs profile as a systemd service, and reads `/var/log/journal/`, where OpenStack-Ansible's containers' journals arrive.

### Who did what on OpenStack-Ansible

Keystone's audit trail and the audit filter on each API, into [Security Events](/docs/telemetry/openstack#who-did-what). Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from the journal.

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

This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw. A second value of `notification_opt_out` goes in as a YAML set, as [its config_template](https://docs.openstack.org/ansible-config_template/latest/) writes a repeated key.

For who did what through Nova, Neutron, Cinder and Glance, each API takes the filter's setting in its conf overrides, and the filter in its paste overrides, with `audit` right after `authtoken` and the context filter that follows it in each pipeline. Nova's, and the same in `neutron_neutron_conf_overrides` and `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` and `cinder_api_paste_ini_overrides`, and `glance_glance_api_conf_overrides` and `glance_glance_api_paste_ini_overrides`:

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

OpenStack-Helm offers charts for Prometheus, Alertmanager and exporters, and whether they are running is up to you. Its control plane runs in Kubernetes, so a probe reads the APIs and the Kubernetes agent sees the pods.

### Forward what is firing on OpenStack-Helm

If you run its prometheus-alertmanager chart, add the receiver under `conf.alertmanager` in the chart's values, and send your route to it:

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

### Read the APIs and see the pods on OpenStack-Helm

Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. Then follow **Kubernetes → Documentation** for the cluster the charts run on: its pods, their logs and their nodes reach the Kubernetes pages.

To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Who did what on OpenStack-Helm

Keystone's audit trail and the audit filter on each API, into [Security Events](/docs/telemetry/openstack#who-did-what). Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.

A chart's `logging.conf` keeps the root logger at `WARNING`, and the log driver writes under a logger of its own, so without one for it nothing is written. A list in values replaces the chart's, so `keys` holds what the chart's has, plus this:

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

For who did what through Nova, Neutron and Cinder, their charts' `conf.paste` already has the audit filter in each pipeline, and it needs telling where to write. Each needs the same logger, in `conf.logging`. Glance's chart has the map, and neither the filter nor a place for it in its pipelines: add both to its `conf.paste`.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere runs kube-prometheus-stack with its own alert rules, and Loki with Vector for logs. Forward its alerts first, then a probe reads the APIs and the Kubernetes agent sees the pods.

### Forward what is firing on Atmosphere

Atmosphere ships alert rules that have paged real people, so this works from the first hour. Add the receiver to your Atmosphere configuration, beside whichever receivers you already have, and deploy it:

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

### Read the APIs and see the pods on Atmosphere

Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. Then follow **Kubernetes → Documentation** for the cluster Atmosphere runs on.

To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Who did what on Atmosphere

Keystone's audit trail and the audit filter on each API, into [Security Events](/docs/telemetry/openstack#who-did-what). Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.

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

This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.

For who did what through Nova, Neutron and Cinder, the charts Atmosphere deploys already have the audit filter in each pipeline, and it needs telling where to write, in `nova_helm_values`, `neutron_helm_values` and `cinder_helm_values`. Glance's chart has neither the filter nor a place for it in its pipelines: add both to its `conf.paste`, in `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam can deploy the Canonical Observability Stack, with `sunbeam enable observability embedded`. Canonical also has an `openstack-exporter` charm, which the agent can read if you run it. Sunbeam's own docs do not mention that charm, and nothing here has been run on Sunbeam.

### Forward what is firing on Sunbeam

If you run the Canonical Observability Stack, give its Alertmanager a configuration with the receiver in it:

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

### The exporter charm

If you run Canonical's `openstack-exporter` charm, the agent can read it with no credential of its own. It answers one cloud on `/metrics`, on port `9180` unless you changed its `port` setting. Find its address with `juju status openstack-exporter`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Which series it says depends on the exporter release in its snap, which was not recorded here: `bash troubleshoot.sh` says whether it reads the cloud.

### Service logs on Sunbeam

With observability on, the stack's Loki holds the services' logs. OneUptime has no way to read Loki, and the agent's logs profile has not been tried on Sunbeam's charms, so nothing here collects them yet.

### Who did what on Sunbeam

Not yet. Sunbeam's charms write each service's configuration from their own templates, and its Keystone charm has no setting for where notifications go. So neither Keystone's audit trail nor the audit filter can be turned on from outside the charm, and nothing here reaches Security Events.

## Red Hat OpenStack on OpenShift

Its Telemetry Operator runs Ceilometer's Prometheus exporter and a monitoring stack with Alertmanager on OpenShift. The Kubernetes agent's OpenShift preset watches the control plane, and Ceilometer's exporter says what the compute nodes are doing.

### Forward what is firing on Red Hat OpenStack on OpenShift

If `MetricStorage` has `alertingEnabled` and you wrote or applied rules, apply a receiver the monitoring stack picks up:

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

### Read the APIs, and the control plane

Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. Then follow **Kubernetes → Documentation** on the cluster that runs the control plane, with **Red Hat OpenShift** picked, which sets `preset=openshift`.

To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Read the compute nodes through Ceilometer

A probe says what is allocated, not what is busy. To read real usage, run the agent on a machine that can reach the compute nodes, with `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` naming each node on Ceilometer's port, `9101`.

### Who did what on Red Hat OpenStack on OpenShift

Keystone's audit trail and the audit filter on each API, into [Security Events](/docs/telemetry/openstack#who-did-what). Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.

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

This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.

For who did what through Nova and Neutron, each takes the filter's setting in its `customServiceConfig`, and its paste file in `defaultConfigOverwrite`. Cinder's and Glance's operators take no paste file, so nothing here reaches them.

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

StackLight already watches OpenStack's services, MariaDB, Memcached, RabbitMQ and libvirt, with its own alert rules. Forward its alerts first, then a probe reads the APIs.

### Forward what is firing on Mirantis MOSK

StackLight ships alert rules, so this works from the first hour. Add the receiver and its route to your StackLight values. Mirantis's docs show other receivers rather than a webhook, and this has not been run on MOSK:

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

### Read the APIs

Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud.

### Who did what on Mirantis MOSK

For who did what through Nova, Neutron, Cinder and Glance, MOSK has a setting of its own, with the audit filter already in place. With the log driver, each service writes to its standard output, and the Kubernetes agent reads that from the pods' logs, with the cloud named in its values. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

That setting does not cover Keystone. Its own audit trail takes `spec:services`, which Mirantis does not validate and takes no responsibility for, so weigh this with your support contract:

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

This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.

## Use the exporter you already run

No credential and nothing new to run: the agent can read an exporter you already have. How depends on how it was started.

- **With `--multi-cloud`,** as the agent's own runs: set `OPENSTACK_EXPORTER_ADDRESS`, and the agent asks it for one service at a time on `/probe`.
- **Without it,** as Kolla-Ansible's and Canonical's charm run: it has no `/probe`, so set `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`, and the agent asks it for everything at once on `/metrics`, every 2 minutes.

On Kolla-Ansible that is its internal VIP on `9198`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

That walk is on top of Kolla-Ansible's own Prometheus asking every minute. Kolla-Ansible pins exporter 1.7.0, and its answer also says less than the exporter the agent pins. This is what the pages went without on five real clouds, and a test holds it to those recordings:

| Goes without | Because | What it costs |
| --- | --- | --- |
| Everything of Cinder's | It asks the catalog for `volumev3`, and finds no such thing where Cinder registers as `block-storage` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, `cinder-volume` or `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |
| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |
| Domains | It has no such series | **Domains** stays empty |
| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to `active` goes unnoticed |
| A network's MTU | It has no such label | That line on a network's page |

If you need those, use the agent's own exporter instead. You can change your mind later: a cloud keeps its name whichever reads it.
