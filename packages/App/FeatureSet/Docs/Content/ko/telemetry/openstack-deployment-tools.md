# 배포 도구별 OpenStack

"OpenStack"을 그대로 실행하는 사람은 없습니다. 모두 OpenStack을 배포하는 도구를 실행하며, 도구마다 고유한 경로, 고유한 로그, 이미 실행 중인 것에 대한 고유한 관점이 있습니다. 이 페이지는 OneUptime의 설정 가이드가 각 도구에 대해 안내하는 내용입니다. **OpenStack → All Clouds**를 열고 클라우드를 연결한 뒤 **OpenStack을 어떻게 배포하나요?**에 답하세요.

:::cards
- [각 가이드의 테스트 범위](#각-가이드의-테스트-범위): 먼저 읽어 보세요. Kolla-Ansible 가이드는 알림 단계를 제외하고 실제 배포에서 실행해 보았습니다. OpenStack-Ansible 가이드는 일부만 실행해 보았습니다. 나머지는 실행해 보지 않았습니다.
- [이미 발생 중인 알림 전달](#이미-발생-중인-알림-전달): 에이전트 없이 첫 한 시간부터 인시던트를 받습니다.
- [Kolla-Ansible](#kolla-ansible): 이미 실행 중인 익스포터를 읽습니다.
- [OpenStack-Ansible](#openstack-ansible): Journald 로그와 `user_variables.yml`의 오버라이드.
- [OpenStack-Helm](#openstack-helm) 및 [Atmosphere](#atmosphere): 프로브와 Kubernetes 에이전트.
- [Canonical Sunbeam](#canonical-sunbeam): Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): OpenShift 프리셋과 Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): StackLight의 알림.
- [이미 실행 중인 익스포터 사용](#이미-실행-중인-익스포터-사용): 1.7.0에서 페이지에 나타나지 않는 항목.
:::

## 각 가이드의 테스트 범위

아래의 모든 경로, 포트, 변수는 해당 도구의 소스 또는 문서에서 읽은 것입니다. OneUptime의 픽스처를 기록하는 테스트 환경은 CI 러너에 Kolla-Ansible와 OpenStack-Ansible도 배포하고, 에이전트가 보내는 것을 보관하는 OneUptime 대역(stand-in)을 두고 각 가이드의 명령을 그대로 실행합니다. 따라서 여기에 있는 어떤 가이드도 해당 도구의 실제 배포에서 실행 중인 OneUptime에 보고해 본 적은 없습니다. 각 가이드를 무엇과 대조했는지는 다음과 같습니다.

| 도구 | 읽은 것 | 실제로 실행한 것 |
| --- | --- | --- |
| Kolla-Ansible | master와 `stable/2026.1`의 소스 | `stable/2026.1`에서 Open vSwitch를 사용하는 실제 올인원 환경에서 이 가이드의 명령을 실행했습니다. Docker 없이 각 자격 증명으로 에이전트를, Kolla-Ansible 자체 익스포터와 고정 버전 및 1.7.0의 사용자 익스포터에서, 실제 `prometheus.yml`에서 읽은 대상을, 그리고 로그 프로필을 실행했습니다. 한 부분은 성립하지 않았습니다. Memcached와 nova-compute를 중지했는데도 Alertmanager가 아무것도 전송하지 않았으므로, Kolla-Ansible 스택에서 OneUptime으로 알림이 간 적은 없습니다. Alertmanager가 고정된 버전에서 전송하는 내용을 테스트 클러스터에서 기록해 실행 중인 OneUptime에 보냈을 때는 올바른 클라우드에서 인시던트가 열리고 해결되었습니다 |
| OpenStack-Ansible | 소스와 문서 | `stable/2026.1`의 실제 올인원 환경을 LXC 컨테이너에서 실행했습니다. 이 가이드의 RabbitMQ 및 HAProxy 설정을 해당 명령으로 적용했고 각 익스포터가 응답했으며, 로그 프로필이 저널을 읽었습니다. 에이전트 단계는 이 환경에서 실행하지 않았습니다. 에이전트와 로그 프로필은 이 도구로 배포하지 않은 클라우드에서 실행했습니다 |
| OpenStack-Helm | 차트 값 | 프로브와 Kubernetes 에이전트를 각각 따로 |
| Atmosphere | 문서와 소스 | 프로브와 Kubernetes 에이전트를 각각 따로 |
| Canonical Sunbeam | Canonical의 문서와 charm의 소스 | Sunbeam에서는 아무것도 실행하지 않았습니다. Sunbeam 자체 문서에는 익스포터 charm이 언급되지 않습니다 |
| Red Hat OpenStack on OpenShift | Telemetry Operator의 소스 | OpenShift 프리셋과 Ceilometer의 익스포터를 각각 따로 |
| Mirantis MOSK | Mirantis의 문서. 예제는 웹훅이 아니라 다른 리시버를 보여 줍니다 | MOSK에서는 아무것도 실행하지 않았습니다 |

각 가이드에서 **누가 무엇을 했는지**가 켜는 항목은 테스트 환경이 실행하는 모든 릴리스의 DevStack에서 기록했으며, 이 도구들에서는 기록하지 않았습니다. 각 도구가 이를 어디서 가져오는지는 해당 도구의 소스 또는 문서에서 읽었습니다.

이와 별개로, 전체 경로는 Docker Compose가 시작하는 방식 그대로 시작한 실제 OneUptime(이 코드에서 빌드한 앱과 프로브)과, 이 도구들이 아닌 실제 DevStack에서 실행했습니다. 문서의 명령으로 설치한 에이전트는 첫 데이터로 클라우드를 등록했고, 모든 인스턴스, 볼륨, 하이퍼바이저에 클라우드가 직접 알려 준 상태의 행이 생겼습니다. `nova-compute`를 실제로 중지하자 해당 행이 내려갔고, Compute Service Down 템플릿의 모니터가 746초 뒤 호스트 이름을 담은 인시던트를 하나 열었으며, 서비스를 다시 시작한 지 48초 뒤에 해결되었습니다. 프로젝트의 프로브는 대시보드 자체 경로로 같은 클라우드를 연결해 그 행을 다시 읽었고, 서명된 부팅의 스팬 114개가 트레이스 프로필을 통해 각 서비스에서 도착했습니다.

별도로, 실제 에이전트와 실제 Alertmanager가 보낸 내용을 이 도구들이 배포한 클라우드가 아니라 DevStack과 테스트 클러스터에서 기록했습니다. 실행 중인 OneUptime에 보내자, 발생 웹훅은 올바른 클라우드에서만 인시던트를 하나 열었고, 같은 웹훅을 다시 보내도 아무것도 열리지 않았으며, 해결 웹훅은 인시던트를 해결했습니다.

## 이미 발생 중인 알림 전달

Alertmanager가 있는 도구라면 지금 바로 인시던트를 받을 수 있습니다. 발생한 알림이 인시던트가 되어 첫 한 시간부터 온콜과 상태 페이지를 사용할 수 있고, 알림이 해결되면 인시던트도 해결됩니다. 설치할 것이 없으며 이 페이지의 다른 모든 것과 함께 작동합니다.

:::steps
### 모니터 만들기

[Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#모니터로-알림-받기)의 안내대로 Incoming Request 모니터를 만들고 **Heartbeat URL**을 복사합니다. 이것이 아래 각 도구의 리시버에 있는 `<secret key>` 주소입니다.

### 클라우드에 연결하기

모니터의 **개요 → 연결된 리소스**를 열고 OpenStack 클라우드를 추가합니다. 그러면 각 인시던트가 해당 클라우드의 **인시던트** 페이지에 표시됩니다. Incoming Request 모니터 자체의 설정에는 클라우드가 지정되지 않으므로, 클라우드마다 Alertmanager용 모니터가 따로 필요합니다. 클라우드는 첫 데이터가 도착하면 그 목록에 나타나므로, 아래 단계를 마친 뒤에 하거나 **OpenStack → All Clouds**에서 먼저 클라우드를 추가하세요.
:::

Alertmanager가 정확히 이 형태로 전송하는 것을 Kolla-Ansible가 고정한 버전으로 `Tests/Ops/openstack-e2e`에 기록했으며, 이 기록은 실제 평가기를 통해 재생됩니다. 알림당 인시던트 하나가 열리고, 해당 알림의 `resolved` 상태로 해결됩니다.

## Kolla-Ansible

`/etc/kolla/globals.yml`에서 `enable_prometheus`를 켜면(설정하기 전에는 Kolla-Ansible가 꺼 둡니다) Prometheus, Alertmanager, 클라우드 아래 각 구성 요소의 익스포터가 실행되며 알림 규칙은 제공되지 않습니다. 이 가이드는 두 번째 사본을 시작하는 대신 이미 실행 중인 것을 읽습니다.

### Kolla-Ansible에서 발생 중인 알림 전달

직접 규칙을 작성한 경우에만 해당합니다. Kolla-Ansible는 규칙을 제공하지 않으므로 `/etc/kolla/config/prometheus/*.rules`에 규칙을 넣기 전에는 아무것도 발생하지 않습니다. 배포를 실행하는 호스트에서 `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`을 작성하면 Kolla-Ansible가 자체 파일 대신 이를 읽으며, 이를 적용합니다.

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

### Kolla-Ansible의 자격 증명

`kolla-ansible post-deploy`가 작성하는 `source /etc/kolla/admin-openrc.sh`로 admin으로 로그인합니다.

- **전체 보기**는 어떤 서비스도 변경할 필요가 없습니다. Kolla-Ansible의 템플릿이 이미 Nova, Neutron, Cinder, Glance, Placement의 `[keystone_authtoken]`에 `service_type`을 설정합니다. Cinder는 `volume`으로 설정하며 액세스 규칙에도 이 값이 있습니다.
- **인프라만**은 `/etc/kolla/config/nova/policy.yaml`에 오버라이드를 넣으며, `neutron`, `keystone`, `placement`도 마찬가지로 이미 있는 내용과 병합됩니다. `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`로 적용하세요.

### Kolla-Ansible의 클라우드가 의존하는 것 감시

Kolla-Ansible의 Prometheus를 실행하는 호스트에서 다음을 실행하면 Kolla-Ansible가 렌더링한 파일에서 대상을 읽어 에이전트 설정 형태로 출력합니다.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

출력된 내용을 에이전트의 `.env`에 추가한 뒤 에이전트 폴더에서 `docker compose up -d`를 실행합니다. 각 익스포터는 API 네트워크에서 수신 대기하므로 에이전트의 머신이 그곳으로 가는 경로를 가지고 있어야 합니다. 그러면 클라우드의 **컨트롤 플레인** 카드에 각 항목의 상태가 표시되고, 감시되지 않는 항목은 감시되지 않는다고 분명히 표시됩니다.

| 읽는 대상 | 포트 | 설정 |
| --- | --- | --- |
| RabbitMQ의 Prometheus 플러그인 | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| HAProxy 자체 익스포터 | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| OVN과 Open vSwitch용 openstack-network-exporter | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **OVN의 데이터베이스:** Kolla-Ansible는 2026.1부터 openstack-network-exporter를 컴퓨트 노드와 네트워크 노드에서만 실행하며, OVN 데이터베이스는 그것이 실행되는 호스트에서 읽습니다. 컨트롤 노드가 둘 중 어느 쪽도 아니라면 인벤토리의 `[prometheus-openstack-network-exporter:children]` 아래에 추가하고 reconfigure를 실행하세요. 그렇지 않으면 Northbound와 Southbound 데이터베이스가 감시되지 않는 것으로 표시됩니다.
- **2026.1 이전**에는 네트워크 익스포터가 없으므로 OVN과 Open vSwitch가 감시되지 않는 것으로 표시됩니다.

### Kolla-Ansible의 서비스 로그

에이전트의 로그 프로필은 각 노드에서 실행되며 Kolla-Ansible의 파일을 읽습니다. 로그 줄을 클라우드의 페이지와 연결해 주는 것이 이 프로필입니다.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Kolla 자체의 Fluentd로도 전달할 수 있습니다. [Fluentd](/docs/telemetry/fluentd)에 설명된 대로 `/etc/kolla/config/fluentd/output/*.conf`에 출력을 추가하면 되지만, 그런 레코드는 서비스 이름으로 **로그**에 도착하며 클라우드의 페이지에는 나타나지 않습니다.

### Kolla-Ansible에서 누가 무엇을 했는지

Keystone의 감사 기록과 각 API의 감사 필터를 [보안 이벤트](/docs/telemetry/openstack#누가-무엇을-했는가)로 보냅니다. 각각 서비스 자체의 로그에 기록되며 버스에는 소비자가 없습니다. **로그에서 보안 이벤트 찾기**를 켜면 OneUptime이 **보안 이벤트 → 연결**에서 그곳의 로그를 읽습니다. 에이전트의 로그 프로필은 둘 다 `/var/log/kolla`에서 읽습니다.

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

이렇게 하면 로그인마다 한 줄이 전송되며 **OpenStack admin credential used from a new address**가 이를 읽습니다. 실패한 로그인만 보내려면 `notification_opt_out`에 `identity.authenticate.success`를 추가하세요. 그러면 해당 탐지는 감사 필터가 본 것을 읽습니다.

Nova, Neutron, Cinder, Glance를 통한 작업 내역은 감사 필터에 설정이 필요하며, 이 설정은 모든 서비스의 설정에 한꺼번에 들어갑니다.

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

paste 파일도 필요한데, Kolla-Ansible의 설정 작업은 이 서비스들에 paste 파일을 복사하지 않습니다. 각 API 호스트에 직접 만든 파일을 두고, `globals.yml`의 `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes`, `glance_api_extra_volumes`로 이미지 안의 파일 위에 마운트하세요. pyCADF의 맵 파일은 이미지의 `/var/lib/kolla/venv/etc/pycadf`에 있습니다. 필터의 설정 줄은 [누가 무엇을 했는지](/docs/telemetry/openstack#감사-필터-켜기)에 있습니다.

## OpenStack-Ansible

OpenStack-Ansible는 서비스 로그를 journald에 보관하고 자체 Prometheus를 실행하지 않으므로, 에이전트가 진입 경로이며 로그에는 별도의 경로가 있습니다.

### OpenStack-Ansible의 자격 증명

유틸리티 컨테이너에서 admin으로 로그인합니다. `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`를 실행한 뒤 `. ~/openrc`를 실행하세요. 이 컨테이너에는 아래 명령이 사용하는 `curl`이 없으므로 먼저 `apt-get install -y curl`을 실행하세요.

- **전체 보기**는 어떤 서비스도 변경할 필요가 없습니다. OpenStack-Ansible의 롤이 이미 `[keystone_authtoken]`에 `service_type`을 설정합니다. Cinder는 `volumev3`으로 설정하며 액세스 규칙에도 이 값이 있습니다.
- **인프라만**은 `/etc/openstack_deploy/user_variables.yml`의 `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides`, `placement_policy_overrides`로 오버라이드를 지정합니다. 각각 해당 플레이북과 태그로 적용하세요. 예: `openstack-ansible openstack.osa.nova --tags nova-policy-override`. 나중에 하나를 제거하면 파일이 없어지는 대신 빈 파일이 남으므로 아무것도 실패하지 않습니다.

### OpenStack-Ansible의 클라우드가 의존하는 것 감시

OpenStack-Ansible는 이를 위한 익스포터를 실행하지 않으므로, 켜 둔 것만 감시됩니다.

**RabbitMQ:** Prometheus 플러그인을 켠 다음, 에이전트의 `.env`에 각 컨테이너의 `15692` 주소를 `OPENSTACK_RABBITMQ_TARGETS`로 지정합니다.

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** 익스포터는 꺼져 있고 통계 리스너는 TLS와 함께 `127.0.0.1`에 있어서 에이전트가 읽을 수 없습니다. 에이전트가 접근할 수 있는 곳에서 켠 다음, 그 주소의 `1936` 포트를 `OPENSTACK_HAPROXY_TARGETS`로 지정합니다.

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB와 Memcached:** OpenStack-Ansible는 둘 중 어느 것에도 익스포터를 제공하지 않습니다. [mysqld_exporter](https://github.com/prometheus/mysqld_exporter)와 [memcached_exporter](https://github.com/prometheus/memcached_exporter)를 직접 실행해 `OPENSTACK_MARIADB_TARGETS`와 `OPENSTACK_MEMCACHED_TARGETS`로 지정하거나 생략하세요. 생략하면 클라우드의 **컨트롤 플레인** 카드에 정상이라는 표시 대신 감시되지 않는다고 표시됩니다.

### OpenStack-Ansible의 서비스 로그

서비스를 실행하는 각 호스트의 journald에서 읽습니다. 컨테이너는 저널을 호스트로 전달합니다.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

이 명령은 에이전트의 로그 프로필을 systemd 서비스로 실행하며, OpenStack-Ansible 컨테이너의 저널이 도착하는 `/var/log/journal/`을 읽습니다.

### OpenStack-Ansible에서 누가 무엇을 했는지

Keystone의 감사 기록과 각 API의 감사 필터를 [보안 이벤트](/docs/telemetry/openstack#누가-무엇을-했는가)로 보냅니다. 각각 서비스 자체의 로그에 기록되며 버스에는 소비자가 없습니다. **로그에서 보안 이벤트 찾기**를 켜면 OneUptime이 **보안 이벤트 → 연결**에서 그곳의 로그를 읽습니다. 에이전트의 로그 프로필은 둘 다 저널에서 읽습니다.

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

이렇게 하면 로그인마다 한 줄이 전송되며 **OpenStack admin credential used from a new address**가 이를 읽습니다. 실패한 로그인만 보내려면 `notification_opt_out`에 `identity.authenticate.success`를 추가하세요. 그러면 해당 탐지는 감사 필터가 본 것을 읽습니다. `notification_opt_out`의 두 번째 값은 [config_template](https://docs.openstack.org/ansible-config_template/latest/)이 반복되는 키를 쓰는 방식대로 YAML 집합으로 넣습니다.

Nova, Neutron, Cinder, Glance를 통한 작업 내역은 각 API의 conf 오버라이드에 필터의 설정을, paste 오버라이드에 필터를 넣으며, 각 파이프라인에서 `authtoken` 바로 뒤와 그 뒤에 오는 컨텍스트 필터 앞에 `audit`을 둡니다. 다음은 Nova의 예이며, `neutron_neutron_conf_overrides`와 `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides`와 `cinder_api_paste_ini_overrides`, `glance_glance_api_conf_overrides`와 `glance_glance_api_paste_ini_overrides`에도 같은 방식으로 넣습니다.

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

OpenStack-Helm은 Prometheus, Alertmanager, 익스포터용 차트를 제공하지만 실행 여부는 사용자에게 달려 있습니다. 컨트롤 플레인이 Kubernetes에서 실행되므로 프로브가 API를 읽고 Kubernetes 에이전트가 파드를 봅니다.

### OpenStack-Helm에서 발생 중인 알림 전달

prometheus-alertmanager 차트를 실행한다면 차트 값의 `conf.alertmanager` 아래에 리시버를 추가하고 라우트가 그곳으로 가도록 하세요.

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

### OpenStack-Helm에서 API 읽기와 파드 보기

**OpenStack → All Clouds**를 열고 **클라우드 연결**을 클릭한 뒤 Keystone 주소, 애플리케이션 자격 증명, 사용할 프로브를 입력합니다. 프로브는 클라우드와 HTTPS로만 통신합니다. 그런 다음 차트가 실행되는 클러스터에 대해 **Kubernetes → 문서**를 따르세요. 파드, 파드의 로그, 노드가 Kubernetes 페이지에 표시됩니다.

이 서비스들의 로그도 이 클라우드의 **로그** 페이지에서 보고 스택 트레이스를 레코드 하나로 묶으려면, 에이전트의 값에 클라우드 이름과 서비스가 실행되는 네임스페이스를 지정합니다.

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### OpenStack-Helm에서 누가 무엇을 했는지

Keystone의 감사 기록과 각 API의 감사 필터를 [보안 이벤트](/docs/telemetry/openstack#누가-무엇을-했는가)로 보냅니다. 각각 서비스 자체의 로그에 기록되며 버스에는 소비자가 없습니다. **로그에서 보안 이벤트 찾기**를 켜면 OneUptime이 **보안 이벤트 → 연결**에서 그곳의 로그를 읽습니다. Kubernetes 에이전트는 값에 지정한 클라우드의 파드 로그에서 둘 다 읽습니다.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

이렇게 하면 로그인마다 한 줄이 전송되며 **OpenStack admin credential used from a new address**가 이를 읽습니다. 실패한 로그인만 보내려면 `notification_opt_out`에 `identity.authenticate.success`를 추가하세요. 그러면 해당 탐지는 감사 필터가 본 것을 읽습니다.

차트의 `logging.conf`는 루트 로거를 `WARNING`으로 유지하고 로그 드라이버는 자체 로거 아래에 기록하므로, 그 로거가 없으면 아무것도 기록되지 않습니다. values의 리스트는 차트의 리스트를 대체하므로, `keys`에는 차트에 있는 항목에 다음을 더해 넣습니다.

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

Nova, Neutron, Cinder를 통한 작업 내역은 차트의 `conf.paste`에 이미 각 파이프라인의 감사 필터가 있으므로 어디에 기록할지만 알려 주면 됩니다. 각각 `conf.logging`에 같은 로거가 필요합니다. Glance의 차트에는 맵은 있지만 필터도, 파이프라인에서 필터가 들어갈 자리도 없습니다. 둘 다 `conf.paste`에 추가하세요.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere는 자체 알림 규칙이 있는 kube-prometheus-stack을 실행하고, 로그에는 Vector가 있는 Loki를 사용합니다. 먼저 알림을 전달하고, 이어서 프로브가 API를 읽고 Kubernetes 에이전트가 파드를 봅니다.

### Atmosphere에서 발생 중인 알림 전달

Atmosphere는 실제 사람을 호출해 본 알림 규칙을 제공하므로 첫 한 시간부터 작동합니다. 이미 사용 중인 리시버 옆에 Atmosphere 설정에 리시버를 추가하고 배포하세요.

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

### Atmosphere에서 API 읽기와 파드 보기

**OpenStack → All Clouds**를 열고 **클라우드 연결**을 클릭한 뒤 Keystone 주소, 애플리케이션 자격 증명, 사용할 프로브를 입력합니다. 프로브는 클라우드와 HTTPS로만 통신합니다. 그런 다음 Atmosphere가 실행되는 클러스터에 대해 **Kubernetes → 문서**를 따르세요.

이 서비스들의 로그도 이 클라우드의 **로그** 페이지에서 보고 스택 트레이스를 레코드 하나로 묶으려면, 에이전트의 값에 클라우드 이름과 서비스가 실행되는 네임스페이스를 지정합니다.

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Atmosphere에서 누가 무엇을 했는지

Keystone의 감사 기록과 각 API의 감사 필터를 [보안 이벤트](/docs/telemetry/openstack#누가-무엇을-했는가)로 보냅니다. 각각 서비스 자체의 로그에 기록되며 버스에는 소비자가 없습니다. **로그에서 보안 이벤트 찾기**를 켜면 OneUptime이 **보안 이벤트 → 연결**에서 그곳의 로그를 읽습니다. Kubernetes 에이전트는 값에 지정한 클라우드의 파드 로그에서 둘 다 읽습니다.

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

이렇게 하면 로그인마다 한 줄이 전송되며 **OpenStack admin credential used from a new address**가 이를 읽습니다. 실패한 로그인만 보내려면 `notification_opt_out`에 `identity.authenticate.success`를 추가하세요. 그러면 해당 탐지는 감사 필터가 본 것을 읽습니다.

Nova, Neutron, Cinder를 통한 작업 내역은 Atmosphere가 배포하는 차트에 이미 각 파이프라인의 감사 필터가 있으므로, `nova_helm_values`, `neutron_helm_values`, `cinder_helm_values`에서 어디에 기록할지만 알려 주면 됩니다. Glance의 차트에는 필터도, 파이프라인에서 필터가 들어갈 자리도 없습니다. 둘 다 `glance_helm_values`의 `conf.paste`에 추가하세요.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam은 `sunbeam enable observability embedded`로 Canonical Observability Stack을 배포할 수 있습니다. Canonical에는 `openstack-exporter` charm도 있으며, 이를 실행하면 에이전트가 읽을 수 있습니다. Sunbeam 자체 문서에는 이 charm이 언급되지 않으며, 여기에 있는 어떤 것도 Sunbeam에서 실행해 보지 않았습니다.

### Sunbeam에서 발생 중인 알림 전달

Canonical Observability Stack을 실행한다면 Alertmanager에 리시버가 들어 있는 설정을 지정하세요.

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

### 익스포터 charm

Canonical의 `openstack-exporter` charm을 실행한다면 에이전트가 별도의 자격 증명 없이 읽을 수 있습니다. 이 charm은 클라우드 하나에 대해 `/metrics`로 응답하며, `port` 설정을 바꾸지 않았다면 포트는 `9180`입니다. 주소는 `juju status openstack-exporter`로 확인하세요.

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

어떤 시계열을 제공하는지는 snap에 들어 있는 익스포터 릴리스에 따라 다르며 여기에는 기록하지 않았습니다. `bash troubleshoot.sh`가 클라우드를 읽는지 알려 줍니다.

### Sunbeam의 서비스 로그

observability를 켜면 스택의 Loki가 서비스 로그를 보관합니다. OneUptime은 Loki를 읽을 방법이 없고 에이전트의 로그 프로필은 Sunbeam의 charm에서 시도해 보지 않았으므로, 지금은 여기서 로그를 수집하는 것이 없습니다.

### Sunbeam에서 누가 무엇을 했는지

아직 지원하지 않습니다. Sunbeam의 charm은 자체 템플릿으로 각 서비스의 설정을 작성하며, Keystone charm에는 알림을 보낼 위치에 대한 설정이 없습니다. 따라서 Keystone의 감사 기록도 감사 필터도 charm 밖에서 켤 수 없으며, 여기서는 아무것도 보안 이벤트에 도달하지 않습니다.

## Red Hat OpenStack on OpenShift

Telemetry Operator가 OpenShift에서 Ceilometer의 Prometheus 익스포터와 Alertmanager가 포함된 모니터링 스택을 실행합니다. Kubernetes 에이전트의 OpenShift 프리셋이 컨트롤 플레인을 감시하고, Ceilometer의 익스포터가 컴퓨트 노드의 동작을 알려 줍니다.

### Red Hat OpenStack on OpenShift에서 발생 중인 알림 전달

`MetricStorage`에 `alertingEnabled`가 있고 규칙을 작성했거나 적용했다면, 모니터링 스택이 인식하는 리시버를 적용하세요.

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

### API와 컨트롤 플레인 읽기

**OpenStack → All Clouds**를 열고 **클라우드 연결**을 클릭한 뒤 Keystone 주소, 애플리케이션 자격 증명, 사용할 프로브를 입력합니다. 프로브는 클라우드와 HTTPS로만 통신합니다. 그런 다음 컨트롤 플레인이 실행되는 클러스터에 대해 **Kubernetes → 문서**를 따르고 **Red Hat OpenShift**를 선택하세요. 그러면 `preset=openshift`가 설정됩니다.

이 서비스들의 로그도 이 클라우드의 **로그** 페이지에서 보고 스택 트레이스를 레코드 하나로 묶으려면, 에이전트의 값에 클라우드 이름과 서비스가 실행되는 네임스페이스를 지정합니다.

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Ceilometer로 컴퓨트 노드 읽기

프로브는 할당된 양을 알려 줄 뿐, 실제로 얼마나 바쁜지는 알려 주지 않습니다. 실제 사용량을 읽으려면 컴퓨트 노드에 접근할 수 있는 머신에서 에이전트를 실행하고, `OPENSTACK_CEILOMETER_EXPORTER_TARGETS`에 각 노드를 Ceilometer의 포트 `9101`로 지정하세요.

### Red Hat OpenStack on OpenShift에서 누가 무엇을 했는지

Keystone의 감사 기록과 각 API의 감사 필터를 [보안 이벤트](/docs/telemetry/openstack#누가-무엇을-했는가)로 보냅니다. 각각 서비스 자체의 로그에 기록되며 버스에는 소비자가 없습니다. **로그에서 보안 이벤트 찾기**를 켜면 OneUptime이 **보안 이벤트 → 연결**에서 그곳의 로그를 읽습니다. Kubernetes 에이전트는 값에 지정한 클라우드의 파드 로그에서 둘 다 읽습니다.

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

이렇게 하면 로그인마다 한 줄이 전송되며 **OpenStack admin credential used from a new address**가 이를 읽습니다. 실패한 로그인만 보내려면 `notification_opt_out`에 `identity.authenticate.success`를 추가하세요. 그러면 해당 탐지는 감사 필터가 본 것을 읽습니다.

Nova와 Neutron을 통한 작업 내역은 각각 `customServiceConfig`에 필터의 설정을, `defaultConfigOverwrite`에 paste 파일을 넣습니다. Cinder와 Glance의 오퍼레이터는 paste 파일을 받지 않으므로 여기서는 이들에게 아무것도 도달하지 않습니다.

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

StackLight는 이미 자체 알림 규칙으로 OpenStack 서비스, MariaDB, Memcached, RabbitMQ, libvirt를 감시합니다. 먼저 알림을 전달하고, 이어서 프로브가 API를 읽습니다.

### Mirantis MOSK에서 발생 중인 알림 전달

StackLight는 알림 규칙을 제공하므로 첫 한 시간부터 작동합니다. StackLight values에 리시버와 라우트를 추가하세요. Mirantis의 문서는 웹훅이 아니라 다른 리시버를 보여 주며, 이 설정은 MOSK에서 실행해 보지 않았습니다.

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

### API 읽기

**OpenStack → All Clouds**를 열고 **클라우드 연결**을 클릭한 뒤 Keystone 주소, 애플리케이션 자격 증명, 사용할 프로브를 입력합니다. 프로브는 클라우드와 HTTPS로만 통신합니다.

### Mirantis MOSK에서 누가 무엇을 했는지

Nova, Neutron, Cinder, Glance를 통한 작업 내역에는 MOSK 고유의 설정이 있으며 감사 필터가 이미 적용되어 있습니다. 로그 드라이버를 사용하면 각 서비스가 표준 출력에 기록하고, Kubernetes 에이전트는 값에 지정한 클라우드의 파드 로그에서 이를 읽습니다. 각각 서비스 자체의 로그에 기록되며 버스에는 소비자가 없습니다. **로그에서 보안 이벤트 찾기**를 켜면 OneUptime이 **보안 이벤트 → 연결**에서 그곳의 로그를 읽습니다.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

이 설정은 Keystone에는 적용되지 않습니다. Keystone의 감사 기록은 `spec:services`로 설정하며, Mirantis는 이를 검증하지 않고 책임지지도 않으므로 지원 계약을 고려해 판단하세요.

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

이렇게 하면 로그인마다 한 줄이 전송되며 **OpenStack admin credential used from a new address**가 이를 읽습니다. 실패한 로그인만 보내려면 `notification_opt_out`에 `identity.authenticate.success`를 추가하세요. 그러면 해당 탐지는 감사 필터가 본 것을 읽습니다.

## 이미 실행 중인 익스포터 사용

자격 증명도, 새로 실행할 것도 필요 없습니다. 에이전트는 이미 가지고 있는 익스포터를 읽을 수 있습니다. 방법은 익스포터를 어떻게 시작했는지에 따라 다릅니다.

- **`--multi-cloud`로 시작한 경우**(에이전트 자체 익스포터가 이렇게 실행됩니다): `OPENSTACK_EXPORTER_ADDRESS`를 설정하면 에이전트가 `/probe`로 한 번에 서비스 하나씩 요청합니다.
- **그렇지 않은 경우**(Kolla-Ansible와 Canonical의 charm이 이렇게 실행됩니다): `/probe`가 없으므로 `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`를 설정하면 에이전트가 2분마다 `/metrics`로 모든 것을 한꺼번에 요청합니다.

Kolla-Ansible에서는 내부 VIP의 `9198` 포트입니다.

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

이 순회는 Kolla-Ansible 자체 Prometheus가 매분 요청하는 것에 더해지는 부하입니다. Kolla-Ansible는 익스포터 1.7.0을 고정해 사용하며, 그 응답은 에이전트가 고정한 익스포터보다 적은 내용을 담고 있습니다. 다음은 실제 클라우드 다섯 곳에서 페이지에 나타나지 않은 항목이며, 테스트가 이 기록과 일치하는지 검증합니다.

| 빠지는 것 | 이유 | 영향 |
| --- | --- | --- |
| Cinder의 모든 것 | 카탈로그에서 `volumev3`을 찾는데, Cinder가 `block-storage`로 등록된 곳에는 그런 항목이 없음 | **볼륨**과 **스토리지 풀**이 비어 있고, **서비스**에 Block Storage API, `cinder-volume`, `cinder-scheduler`가 나타나지 않음. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error**, **Volume Stuck** 알림이 발생하지 않음 |
| 하이퍼바이저가 가진 인스턴스 수와 애그리게이트 | Nova의 하이퍼바이저 목록이 Kolla-Ansible가 요청하는 최신 마이크로버전에서 실패함 | **하이퍼바이저**의 해당 두 항목, 그리고 호스트 손실 시 함께 사라지는 항목에 대한 정보. vCPU, 메모리, 디스크는 Placement에서 오므로 계속 표시됨 |
| 도메인 | 해당 시계열이 없음 | **도메인**이 비어 있음 |
| 이미지의 상태, 공개 범위, 생성 날짜 | 해당 레이블이 없음 | **이미지**의 해당 열. **Image Stuck** 알림이 발생하지 않으므로 `active`로 가는 도중에 멈춘 이미지를 알아채지 못함 |
| 네트워크의 MTU | 해당 레이블이 없음 | 네트워크 페이지의 해당 줄 |

이런 항목이 필요하다면 대신 에이전트 자체 익스포터를 사용하세요. 나중에 생각을 바꿀 수도 있습니다. 클라우드는 어느 쪽이 읽든 이름을 그대로 유지합니다.
