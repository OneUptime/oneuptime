# 按部署工具划分的 OpenStack

没有人是直接运行“OpenStack”的。他们运行的是部署它的工具，而每种工具都有自己的路径、自己的日志，以及对“已经在运行什么”的自己的理解。本页就是 OneUptime 的设置指南对每种工具所说的内容：打开 **OpenStack → 所有云**，连接云，然后回答 **您如何部署 OpenStack？**

:::cards
- [各指南的测试程度](#各指南的测试程度): 请先阅读此节。Kolla-Ansible 和 OpenStack-Ansible 的指南都已在真实部署上运行过。其他的尚未运行。
- [转发已经触发的告警](#转发已经触发的告警): 从第一个小时起就有事件，无需代理。
- [Kolla-Ansible](#kolla-ansible): 读取它已在运行的导出器。
- [OpenStack-Ansible](#openstack-ansible): Journald 日志，以及 `user_variables.yml` 中的覆盖设置。
- [OpenStack-Helm](#openstack-helm): 针对 OpenStack-Helm 和 Atmosphere：一个探测器，以及 Kubernetes 代理。
- [Canonical Sunbeam](#canonical-sunbeam): Canonical Observability Stack。
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): OpenShift 预设，以及 Ceilometer。
- [Mirantis MOSK](#mirantis-mosk): StackLight 的告警。
- [使用您已在运行的导出器](#使用您已在运行的导出器): 在 1.7.0 上页面缺少哪些内容。
:::

## 各指南的测试程度

下面的每个路径、端口和变量都读自该工具自己的源码或文档。记录 OneUptime 测试夹具的测试台还会在 CI 运行器上部署 Kolla-Ansible 和 OpenStack-Ansible，并在其上运行它们指南中的命令，用一个替代 OneUptime 的桩来保存代理发送的内容。因此，这里没有任何一份指南曾从其工具的真实部署向运行中的 OneUptime 上报过数据。各自的验证情况如下：

| 工具 | 读自 | 实际运行 |
| --- | --- | --- |
| Kolla-Ansible | 其源码，位于 master 和 `stable/2026.1` | 本指南的命令，在使用 Open vSwitch 的 `stable/2026.1` 真实 all-in-one 上运行：每种凭据下的代理、不使用 Docker、使用 Kolla-Ansible 自己的导出器以及在固定版本和 1.7.0 上使用您自己的导出器、从其真实 `prometheus.yml` 读取的目标，以及日志配置。有一部分未能成立：在那里停掉 Memcached 和 nova-compute 后，其 Alertmanager 没有发送任何内容，因此还没有任何告警从 Kolla-Ansible 栈到达过 OneUptime。在测试集群中记录的、它所固定版本的 Alertmanager 发送的内容，确实在运行中的 OneUptime 上针对正确的云打开并解决了一个事件 |
| OpenStack-Ansible | 其源码和文档 | 本指南的命令，在 LXC 容器中运行的 `stable/2026.1` 真实 all-in-one 上：第一个凭据上的代理、第二个凭据上带其策略覆盖的导出器、代理读取各项的 RabbitMQ 和 HAProxy 设置，以及读取 journal 的日志配置 |
| OpenStack-Helm | 其 chart 的 values | 探测器和 Kubernetes 代理，各自独立运行 |
| Atmosphere | 其文档和源码 | 探测器和 Kubernetes 代理，各自独立运行 |
| Canonical Sunbeam | Canonical 的文档，以及其 charm 的源码 | 在 Sunbeam 上没有运行过任何内容。Sunbeam 自己的文档没有提到导出器 charm |
| Red Hat OpenStack on OpenShift | Telemetry Operator 的源码 | OpenShift 预设和 Ceilometer 的导出器，各自独立运行 |
| Mirantis MOSK | Mirantis 的文档，其示例展示的是其他接收器而不是 webhook | 在 MOSK 上没有运行过任何内容 |

每份指南中 **谁做了什么** 所启用的内容，是在 DevStack 上、测试台运行的每个版本上记录的，而不是在这些工具中的任何一个上。每种工具在哪里启用它，则读自该工具的源码或文档。

除此之外，整条路径还在一个运行中的 OneUptime 上运行过，它以 Docker Compose 的方式启动，其应用和探测器由这份代码构建，而且是在真实的 DevStack 上而非这些工具中的任何一个上。按其文档中的命令安装的代理，从第一批数据起就注册了这个云，每个实例、卷和 Hypervisor 都有一行，状态就是云本身给出的状态。在真正停止 `nova-compute` 后，它的那一行变为宕机，来自 Compute Service Down 模板的监控器在 746 秒后打开了一个指明该主机的事件，并在服务重新启动 48 秒后将其解决。某个项目的探测器通过仪表板自己的路由连接了同一个云并读回了它的各行，一次带签名的启动在各服务间产生的 114 个 span 也通过追踪配置到达了。

另外，真实代理和真实 Alertmanager 发送过的内容，是在 DevStack 和测试集群中记录的，而不是在这些工具中任何一个部署的云上。发送到运行中的 OneUptime 后，触发的 webhook 在正确的云上、且只在该云上打开了一个事件，再次发送同一个 webhook 没有打开任何新事件，而已解决的 webhook 则解决了该事件。

## 转发已经触发的告警

任何带有 Alertmanager 的工具今天就可以拥有事件：触发的告警会变成事件，从第一个小时起就具备值班和状态页，并在告警解除时自动解决。无需安装任何东西，并且这与本页的其他所有内容并行工作。

:::steps
### 创建监控器

按 [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#用监视器接收告警) 的说明创建一个 Incoming Request 监控器，并复制它的 **Heartbeat URL**。这就是下面每种工具的接收器中的 `<secret key>` 地址。

### 将它关联到云

打开监控器的 **概览 → 已关联资源**，添加该 OpenStack 云。之后每个事件都出现在该云的 **事件** 页面上：Incoming Request 监控器自身的设置不指明任何云，因此每个云的 Alertmanager 都需要一个专属的监控器。该云在其首批数据到达后才会出现在列表中，所以请在完成下面的步骤之后再做这一步，或先在 **OpenStack → 所有云** 下添加该云。
:::

Alertmanager 已按这个确切的格式发送请求，记录于 `Tests/Ops/openstack-e2e` 中，使用的是 Kolla-Ansible 所固定的版本，且该记录通过真实的评估器回放：每个告警一个事件，由它自己的 `resolved` 状态解决。

## Kolla-Ansible

在 `/etc/kolla/globals.yml` 中开启 `enable_prometheus`（Kolla-Ansible 在您设置之前默认关闭它）后，它会运行 Prometheus、Alertmanager，并为云之下的每一部分运行一个导出器，但不附带任何告警规则。本指南读取这些已在运行的组件，而不是再启动一份副本。

### 在 Kolla-Ansible 上转发正在触发的告警

仅当您编写了自己的规则时：Kolla-Ansible 不附带任何规则，因此在 `/etc/kolla/config/prometheus/*.rules` 中有规则之前不会有任何告警触发。在您用来部署的主机上编写 `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`，Kolla-Ansible 会读取它而不是自己的配置，然后应用：

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

### Kolla-Ansible 上的凭据

使用 `source /etc/kolla/admin-openrc.sh` 以管理员身份登录，该文件由 `kolla-ansible post-deploy` 写入。

- **完整视图** 需要更改一处，即 Cinder。Kolla-Ansible 的模板已在 Nova、Neutron、Glance 和 Placement 的 `[keystone_authtoken]` 下设置了 `service_type`，但它的 Cinder 写的是 `volume`，而它的目录写的是 `block-storage`，除非两者一致，否则 keystonemiddleware 会以 `401` 拒绝受访问规则限制的凭据。请在 `/etc/kolla/config/cinder.conf` 的 `[keystone_authtoken]` 下添加 `service_type = block-storage`，然后运行 `kolla-ansible reconfigure -i <inventory> --tags cinder`。
- **仅基础设施** 的覆盖设置位于 `/etc/kolla/config/nova/policy.yaml`，`neutron`、`keystone` 和 `placement` 同理，并与其中已有的内容合并。用 `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement` 应用它们。

### 监视 Kolla-Ansible 的云所依赖的组件

在运行 Kolla-Ansible 的 Prometheus 的主机上，下面的命令会从 Kolla-Ansible 渲染出的文件中读取它的目标，并将其输出为代理的设置：

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

将输出的内容添加到代理的 `.env` 中，然后在代理的文件夹中运行 `docker compose up -d`。每个导出器都监听在 API 网络上，因此代理所在的机器需要有到那里的路由。云的 **控制平面** 卡片随后会说明每个组件的状态，并明确指出哪些没有被监视。

| 读取 | 端口 | 设置 |
| --- | --- | --- |
| RabbitMQ 的 Prometheus 插件 | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| HAProxy 自带的导出器 | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter，用于 OVN 和 Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **OVN 的数据库：** 从 2026.1 起，Kolla-Ansible 只在计算节点和网络节点上运行 openstack-network-exporter，而 OVN 数据库只能从其所在的主机读取。如果您的控制节点既不是计算节点也不是网络节点，请在清单中的 `[prometheus-openstack-network-exporter:children]` 下添加它们并重新配置，否则 Northbound 和 Southbound 数据库会显示为未被监视。
- **2026.1 之前** 没有网络导出器，因此 OVN 和 Open vSwitch 会显示为未被监视。

### Kolla-Ansible 上的服务日志

代理的日志配置运行在每个节点上，并读取 Kolla-Ansible 的文件。它能把每一行日志与云的页面关联起来：

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Kolla 自带的 Fluentd 也可以转发，按 [Fluentd](/docs/telemetry/fluentd) 的描述在 `/etc/kolla/config/fluentd/output/*.conf` 中添加一个输出，但这些记录会以服务名称进入 **日志**，而不会进入云的页面。

### Kolla-Ansible 上的谁做了什么

Keystone 的审计轨迹和每个 API 上的审计过滤器，进入[安全事件](/docs/telemetry/openstack#谁做了什么)。它们各自写入服务自己的日志，总线上没有消费者。开启 **在日志中查找安全事件**（位于 **安全事件 → 连接** 下）后，OneUptime 会从那里读取它们。代理的日志配置从 `/var/log/kolla` 读取这两者。

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

这样每次登录都会发送一行，**从新地址使用 OpenStack 管理员凭据** 会读取它。如果只想发送失败的登录，请将 `identity.authenticate.success` 添加到 `notification_opt_out`，此后该检测读取的就是审计过滤器看到的内容。

对于通过 Nova、Neutron、Cinder 和 Glance 完成的操作，审计过滤器需要一项设置，它会一次写入每个服务的配置中：

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

它还需要一个 paste 文件，而 Kolla-Ansible 的配置任务不会为这些服务复制任何 paste 文件。请把您自己的文件放在每个 API 主机上，并通过 `globals.yml` 中的 `nova_api_extra_volumes`、`neutron_server_extra_volumes`、`cinder_api_extra_volumes` 和 `glance_api_extra_volumes` 将其挂载到镜像内的同名文件之上。pyCADF 的映射文件位于镜像中的 `/var/lib/kolla/venv/etc/pycadf`。[谁做了什么](/docs/telemetry/openstack#开启审计过滤器)中有过滤器的各行配置。

## OpenStack-Ansible

OpenStack-Ansible 把其服务的日志保存在 journald 中，自身不运行 Prometheus，因此接入的方式是代理，而日志有自己的路径。

### OpenStack-Ansible 上的凭据

在 utility 容器中以管理员身份登录：`lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`，然后执行 `. ~/openrc`。其中没有下面命令要用的 `curl`，因此请先在那里运行 `apt-get install -y curl`。

- **完整视图** 需要更改一处，即 Cinder。OpenStack-Ansible 的角色已在 `[keystone_authtoken]` 下设置了 `service_type`，但它的 Cinder 写的是 `volumev3`，而它的目录写的是 `block-storage`，除非两者一致，否则 keystonemiddleware 会以 `401` 拒绝受访问规则限制的凭据。请在 `/etc/openstack_deploy/user_variables.yml` 的 `cinder_cinder_conf_overrides` 中，于 `keystone_authtoken` 下设置 `service_type: block-storage`，然后运行 `openstack-ansible openstack.osa.cinder --tags cinder-config`。
- **仅基础设施** 的覆盖设置是 `/etc/openstack_deploy/user_variables.yml` 中的 `nova_policy_overrides`、`neutron_policy_overrides`、`keystone_policy_overrides` 和 `placement_policy_overrides`。用各自的 playbook 和标签应用每一项，例如 `openstack-ansible openstack.osa.nova --tags nova-policy-override`。之后移除某一项时会留下一个空文件而不是没有文件，因此不会出错。

### 监视 OpenStack-Ansible 的云所依赖的组件

OpenStack-Ansible 不为这些组件运行任何导出器，因此只有您开启的才会被监视。

**RabbitMQ：** 开启它的 Prometheus 插件，然后在代理的 `.env` 中将每个容器在 `15692` 上的地址写为 `OPENSTACK_RABBITMQ_TARGETS`：

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy：** 它的导出器是关闭的，其统计监听器位于 `127.0.0.1` 并使用 TLS，代理无法读取。请在代理可以访问的地方开启它，然后将该地址在 `1936` 上的端点写为 `OPENSTACK_HAPROXY_TARGETS`：

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB 和 Memcached：** OpenStack-Ansible 不为两者提供导出器。请自行运行 [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) 和 [memcached_exporter](https://github.com/prometheus/memcached_exporter)，并把它们写为 `OPENSTACK_MARIADB_TARGETS` 和 `OPENSTACK_MEMCACHED_TARGETS`，或者不管它们：云的 **控制平面** 卡片随后会说明它们没有被监视，而不是说它们正常。

### OpenStack-Ansible 上的服务日志

从 journald 读取，在每个运行服务的主机上执行：容器会把它们的 journal 传递给主机。

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

这会把代理的日志配置作为 systemd 服务运行，并读取 `/var/log/journal/`，OpenStack-Ansible 容器的 journal 就汇集在那里。

### OpenStack-Ansible 上的谁做了什么

Keystone 的审计轨迹和每个 API 上的审计过滤器，进入[安全事件](/docs/telemetry/openstack#谁做了什么)。它们各自写入服务自己的日志，总线上没有消费者。开启 **在日志中查找安全事件**（位于 **安全事件 → 连接** 下）后，OneUptime 会从那里读取它们。代理的日志配置从 journal 读取这两者。

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

这样每次登录都会发送一行，**从新地址使用 OpenStack 管理员凭据** 会读取它。如果只想发送失败的登录，请将 `identity.authenticate.success` 添加到 `notification_opt_out`，此后该检测读取的就是审计过滤器看到的内容。`notification_opt_out` 的第二个值要写成 YAML 集合，正如[它的 config_template](https://docs.openstack.org/ansible-config_template/latest/) 写入重复键的方式。

对于通过 Nova、Neutron、Cinder 和 Glance 完成的操作，每个 API 在其 conf 覆盖中接受过滤器的设置，在其 paste 覆盖中接受过滤器本身，其中 `audit` 紧跟在 `authtoken` 之后，以及每条管道中紧随其后的 context 过滤器之前。下面是 Nova 的，Neutron 的写在 `neutron_neutron_conf_overrides` 和 `neutron_api_paste_ini_overrides` 中，Cinder 的写在 `cinder_cinder_conf_overrides` 和 `cinder_api_paste_ini_overrides` 中，Glance 的写在 `glance_glance_api_conf_overrides` 和 `glance_glance_api_paste_ini_overrides` 中，写法相同：

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

OpenStack-Helm 提供 Prometheus、Alertmanager 和导出器的 chart，是否运行它们由您决定。它的控制平面运行在 Kubernetes 中，因此由探测器读取 API，由 Kubernetes 代理查看 pod。

### 在 OpenStack-Helm 上转发正在触发的告警

如果您运行它的 prometheus-alertmanager chart，请在 chart 的 values 中的 `conf.alertmanager` 下添加接收器，并把您的路由指向它：

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

### 在 OpenStack-Helm 上读取 API 并查看 pod

打开 **OpenStack → 所有云**，点击 **连接云**，提供 Keystone 的地址、应用凭据和要使用的探测器。探测器只通过 HTTPS 与云通信。然后针对 chart 所运行的集群，按 **Kubernetes → 文档** 操作：其 pod、日志和节点会进入 Kubernetes 页面。

若要让这些服务的日志也出现在该云的 **日志** 页面上，并且每个堆栈跟踪作为一条记录，请在代理的 values 中指定云的名称，以及其服务所运行的命名空间：

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### OpenStack-Helm 上的谁做了什么

Keystone 的审计轨迹和每个 API 上的审计过滤器，进入[安全事件](/docs/telemetry/openstack#谁做了什么)。它们各自写入服务自己的日志，总线上没有消费者。开启 **在日志中查找安全事件**（位于 **安全事件 → 连接** 下）后，OneUptime 会从那里读取它们。Kubernetes 代理从 pod 的日志中读取这两者，云的名称在其 values 中指定。

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

这样每次登录都会发送一行，**从新地址使用 OpenStack 管理员凭据** 会读取它。如果只想发送失败的登录，请将 `identity.authenticate.success` 添加到 `notification_opt_out`，此后该检测读取的就是审计过滤器看到的内容。

chart 的 `logging.conf` 将根日志记录器保持在 `WARNING`，而 log 驱动写入的是它自己的日志记录器，所以如果没有为它配置，就不会写入任何内容。values 中的列表会替换 chart 自带的列表，所以 `keys` 要包含 chart 原有的内容，再加上下面这些：

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

对于通过 Nova、Neutron 和 Cinder 完成的操作，它们 chart 的 `conf.paste` 已在每条管道中包含审计过滤器，只需要告诉它写到哪里。每个都需要在 `conf.logging` 中配置同样的日志记录器。Glance 的 chart 有映射文件，但管道中既没有过滤器，也没有放置它的位置：请把两者都添加到它的 `conf.paste`。

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere 运行带有自己告警规则的 kube-prometheus-stack，并用 Loki 和 Vector 处理日志。先转发它的告警，然后由探测器读取 API，由 Kubernetes 代理查看 pod。

### 在 Atmosphere 上转发正在触发的告警

Atmosphere 附带的告警规则曾真正呼叫过值班人员，因此从第一个小时起就有效。把接收器添加到您的 Atmosphere 配置中，放在您已有的其他接收器旁边，然后部署：

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

### 在 Atmosphere 上读取 API 并查看 pod

打开 **OpenStack → 所有云**，点击 **连接云**，提供 Keystone 的地址、应用凭据和要使用的探测器。探测器只通过 HTTPS 与云通信。然后针对 Atmosphere 所运行的集群，按 **Kubernetes → 文档** 操作。

若要让这些服务的日志也出现在该云的 **日志** 页面上，并且每个堆栈跟踪作为一条记录，请在代理的 values 中指定云的名称，以及其服务所运行的命名空间：

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Atmosphere 上的谁做了什么

Keystone 的审计轨迹和每个 API 上的审计过滤器，进入[安全事件](/docs/telemetry/openstack#谁做了什么)。它们各自写入服务自己的日志，总线上没有消费者。开启 **在日志中查找安全事件**（位于 **安全事件 → 连接** 下）后，OneUptime 会从那里读取它们。Kubernetes 代理从 pod 的日志中读取这两者，云的名称在其 values 中指定。

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

这样每次登录都会发送一行，**从新地址使用 OpenStack 管理员凭据** 会读取它。如果只想发送失败的登录，请将 `identity.authenticate.success` 添加到 `notification_opt_out`，此后该检测读取的就是审计过滤器看到的内容。

对于通过 Nova、Neutron 和 Cinder 完成的操作，Atmosphere 部署的 chart 已在每条管道中包含审计过滤器，只需要在 `nova_helm_values`、`neutron_helm_values` 和 `cinder_helm_values` 中告诉它写到哪里。Glance 的 chart 管道中既没有过滤器，也没有放置它的位置：请把两者都添加到 `glance_helm_values` 中它的 `conf.paste`。

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam 可以通过 `sunbeam enable observability embedded` 部署 Canonical Observability Stack。Canonical 还提供一个 `openstack-exporter` charm，如果您运行它，代理可以读取。Sunbeam 自己的文档没有提到这个 charm，而且这里的任何内容都没有在 Sunbeam 上运行过。

### 在 Sunbeam 上转发正在触发的告警

如果您运行 Canonical Observability Stack，请给它的 Alertmanager 一份包含该接收器的配置：

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

### 导出器 charm

如果您运行 Canonical 的 `openstack-exporter` charm，代理无需自己的凭据即可读取它。它在 `/metrics` 上应答一个云，端口为 `9180`，除非您更改了它的 `port` 设置。用 `juju status openstack-exporter` 查找它的地址：

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

它提供哪些序列取决于其 snap 中导出器的版本，这里没有记录：`bash troubleshoot.sh` 会说明它是否读取了该云。

### Sunbeam 上的服务日志

开启可观测性后，栈中的 Loki 保存着各服务的日志。OneUptime 无法读取 Loki，而代理的日志配置也没有在 Sunbeam 的 charm 上试过，因此这里目前还不能收集它们。

### Sunbeam 上的谁做了什么

暂不支持。Sunbeam 的 charm 通过自己的模板写入每个服务的配置，而它的 Keystone charm 没有设置通知发往何处的选项。因此无法在 charm 之外开启 Keystone 的审计轨迹或审计过滤器，这里的任何内容都不会到达安全事件。

## Red Hat OpenStack on OpenShift

它的 Telemetry Operator 在 OpenShift 上运行 Ceilometer 的 Prometheus 导出器和带有 Alertmanager 的监控栈。Kubernetes 代理的 OpenShift 预设监视控制平面，而 Ceilometer 的导出器说明计算节点在做什么。

### 在 Red Hat OpenStack on OpenShift 上转发正在触发的告警

如果 `MetricStorage` 的 `alertingEnabled` 已开启，并且您编写或应用了规则，请应用一个监控栈能够识别的接收器：

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

### 读取 API 和控制平面

打开 **OpenStack → 所有云**，点击 **连接云**，提供 Keystone 的地址、应用凭据和要使用的探测器。探测器只通过 HTTPS 与云通信。然后针对运行控制平面的集群，按 **Kubernetes → 文档** 操作，并选择 **Red Hat OpenShift**，这会设置 `preset=openshift`。

若要让这些服务的日志也出现在该云的 **日志** 页面上，并且每个堆栈跟踪作为一条记录，请在代理的 values 中指定云的名称，以及其服务所运行的命名空间：

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### 通过 Ceilometer 读取计算节点

探测器只能说明分配了多少，而不能说明有多忙。要读取真实用量，请在能访问计算节点的机器上运行代理，并通过 `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` 指定每个节点上 Ceilometer 的端口 `9101`。

### Red Hat OpenStack on OpenShift 上的谁做了什么

Keystone 的审计轨迹和每个 API 上的审计过滤器，进入[安全事件](/docs/telemetry/openstack#谁做了什么)。它们各自写入服务自己的日志，总线上没有消费者。开启 **在日志中查找安全事件**（位于 **安全事件 → 连接** 下）后，OneUptime 会从那里读取它们。Kubernetes 代理从 pod 的日志中读取这两者，云的名称在其 values 中指定。

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

这样每次登录都会发送一行，**从新地址使用 OpenStack 管理员凭据** 会读取它。如果只想发送失败的登录，请将 `identity.authenticate.success` 添加到 `notification_opt_out`，此后该检测读取的就是审计过滤器看到的内容。

对于通过 Nova 和 Neutron 完成的操作，两者都在各自的 `customServiceConfig` 中接受过滤器的设置，并在 `defaultConfigOverwrite` 中接受其 paste 文件。Cinder 和 Glance 的 operator 不接受 paste 文件，因此这里的内容无法到达它们。

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

StackLight 已经用它自己的告警规则监视着 OpenStack 的服务、MariaDB、Memcached、RabbitMQ 和 libvirt。先转发它的告警，然后由探测器读取 API。

### 在 Mirantis MOSK 上转发正在触发的告警

StackLight 附带告警规则，因此从第一个小时起就有效。把接收器及其路由添加到您的 StackLight values 中。Mirantis 的文档展示的是其他接收器而不是 webhook，这一做法尚未在 MOSK 上运行过：

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

### 读取 API

打开 **OpenStack → 所有云**，点击 **连接云**，提供 Keystone 的地址、应用凭据和要使用的探测器。探测器只通过 HTTPS 与云通信。

### Mirantis MOSK 上的谁做了什么

对于通过 Nova、Neutron、Cinder 和 Glance 完成的操作，MOSK 有自己的设置，审计过滤器已经就位。使用 log 驱动时，每个服务写入其标准输出，Kubernetes 代理从 pod 的日志中读取，云的名称在其 values 中指定。它们各自写入服务自己的日志，总线上没有消费者。开启 **在日志中查找安全事件**（位于 **安全事件 → 连接** 下）后，OneUptime 会从那里读取它们。

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

该设置不涵盖 Keystone。它自己的审计轨迹要通过 `spec:services` 设置，Mirantis 不对此进行验证，也不承担任何责任，因此请结合您的支持合同来权衡：

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

这样每次登录都会发送一行，**从新地址使用 OpenStack 管理员凭据** 会读取它。如果只想发送失败的登录，请将 `identity.authenticate.success` 添加到 `notification_opt_out`，此后该检测读取的就是审计过滤器看到的内容。

## 使用您已在运行的导出器

无需凭据，也无需运行任何新东西：代理可以读取您已有的导出器。具体方式取决于它的启动方式。

- **使用 `--multi-cloud`** 时（代理自带的导出器就是这样运行的）：设置 `OPENSTACK_EXPORTER_ADDRESS`，代理会在 `/probe` 上一次向它请求一项服务。
- **不使用它** 时（Kolla-Ansible 和 Canonical 的 charm 就是这样运行的）：它没有 `/probe`，因此请设置 `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`，代理会每 2 分钟在 `/metrics` 上一次性向它请求全部内容。

在 Kolla-Ansible 上，这是它在 `9198` 上的内部 VIP：

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

这一遍遍历是在 Kolla-Ansible 自己的 Prometheus 每分钟查询的基础上额外进行的。Kolla-Ansible 固定使用导出器 1.7.0，其应答包含的内容也少于代理所固定的导出器。下面是页面在五个真实云上缺少的内容，并且有测试将其与那些记录对照：

| 缺少 | 原因 | 影响 |
| --- | --- | --- |
| Cinder 的全部内容 | 它向目录请求 `volumev3`，而 Cinder 注册为 `block-storage` 的地方找不到这种服务 | **卷** 和 **存储池** 保持为空，**服务** 中没有块存储 API、`cinder-volume` 或 `cinder-scheduler`。**块存储 API 宕机**、**块存储服务宕机**、**存储池警告**、**存储池严重**、**处于错误状态的卷** 和 **卷卡住** 不会触发 |
| Hypervisor 上有多少实例及其聚合 | Nova 的 Hypervisor 列表在 Kolla-Ansible 所请求的最新微版本下失败 | **Hypervisor** 上的这两项，以及丢失主机时它所连带的内容。它的 vCPU、内存和磁盘仍然存在：这些来自 Placement |
| 域 | 它没有这样的序列 | **域名** 保持为空 |
| 镜像的状态、可见性和创建日期 | 它没有这样的标签 | **镜像** 上的这些列。**镜像卡住** 不会触发，因此卡在变为 `active` 途中的镜像不会被发现 |
| 网络的 MTU | 它没有这样的标签 | 网络页面上的那一行 |

如果您需要这些，请改用代理自己的导出器。您以后可以改变主意：无论由哪个读取，云都保留它的名称。
