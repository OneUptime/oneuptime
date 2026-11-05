# 依部署工具區分的 OpenStack

沒有人是在執行「OpenStack」本身。大家執行的是部署它的工具，而每個工具都有自己的路徑、自己的日誌，以及對已在執行內容的自己的一套認定。本頁就是 OneUptime 的設定指南針對各個工具所說的內容：開啟 **OpenStack → 文件**，然後回答 **您如何部署 OpenStack？**

:::cards
- [各指南測試到什麼程度](#各指南測試到什麼程度): 請先閱讀這一節。Kolla-Ansible 與 OpenStack-Ansible 的指南都已在真實部署上執行過。其他的則尚未。
- [轉發已在觸發的警示](#轉發已在觸發的警示): 從第一個小時起就有事件，無需代理程式。
- [Kolla-Ansible](#kolla-ansible): 讀取它已在執行的匯出器。
- [OpenStack-Ansible](#openstack-ansible): Journald 日誌，以及 `user_variables.yml` 中的覆寫。
- [OpenStack-Helm](#openstack-helm): 與 Atmosphere 相同，探測器與 Kubernetes 代理程式。
- [Canonical Sunbeam](#canonical-sunbeam): Canonical Observability Stack。
- [OpenShift 上的 Red Hat OpenStack](#openshift-上的-red-hat-openstack): OpenShift 預設組態與 Ceilometer。
- [Mirantis MOSK](#mirantis-mosk): StackLight 的警示。
- [使用您已在執行的匯出器](#使用您已在執行的匯出器): 在 1.7.0 上頁面缺少哪些資料。
:::

## 各指南測試到什麼程度

下面的每個路徑、連接埠與變數，都是從該工具自己的原始碼或文件中讀來的。Kolla-Ansible 與 OpenStack-Ansible 的指南也已在真實部署上照做過，使用它們自己的指令，並以替身取代 OneUptime，保留代理程式所傳送的內容。因此這裡沒有任何一份指南，是從該工具的真實部署向正在運行的 OneUptime 回報過。各指南所做過的檢查如下：

| 工具 | 讀取來源 | 實際執行 |
| --- | --- | --- |
| Kolla-Ansible | 其原始碼，位於 master 與 `stable/2026.1` | 本指南的指令，在 `stable/2026.1` 且使用 Open vSwitch 的真實 all-in-one 上執行：**完整檢視**憑證上的代理程式（不使用 Docker）、位於 Kolla-Ansible 自己的匯出器上以及您自己的匯出器上（固定版本與 1.7.0），**僅基礎架構**憑證上的代理程式匯出器，從其真實 `prometheus.yml` 讀取的目標，以及日誌設定檔。在那裡真正停止 Memcached 後，它的 Alertmanager 先送出一個 firing webhook，接著又送出一個 resolved webhook，而它送出的內容被送到運行中的 OneUptime 後，在正確的雲端上開啟了一個事件，且沒有在其他任何雲端上開啟，並將其解決 |
| OpenStack-Ansible | 其原始碼與文件 | 本指南的指令，在 `stable/2026.1` 的真實 all-in-one 上，於 LXC 容器中執行：**完整檢視**憑證上的代理程式、套用其政策覆寫的**僅基礎架構**憑證上的代理程式匯出器、由代理程式讀取各項的 RabbitMQ 與 HAProxy 設定，以及讀取 journal 的日誌設定檔 |
| OpenStack-Helm | 其 chart 的值 | 沒有在 OpenStack-Helm 上測試過。探測器與 Kubernetes 代理程式各自單獨測試過 |
| Atmosphere | 其文件與原始碼 | 沒有在 Atmosphere 上測試過。探測器與 Kubernetes 代理程式各自單獨測試過 |
| Canonical Sunbeam | Canonical 的文件，以及其 charm 的原始碼 | Sunbeam 上沒有任何執行。Sunbeam 自己的文件沒有提到匯出器 charm |
| OpenShift 上的 Red Hat OpenStack | Telemetry Operator 的原始碼 | 沒有在 Red Hat 的發行版上測試過。OpenShift 預設組態與 Ceilometer 的匯出器各自單獨測試過 |
| Mirantis MOSK | Mirantis 的文件，其範例展示的是其他接收器，而非 webhook | MOSK 上沒有任何執行 |

各指南的 **誰做了什麼** 所依賴的設定，是在 DevStack 上錄製的，並沒有在這些工具上錄製。各工具要如何設定，則是從該工具的原始碼或文件中讀來的。

除此之外，整條路徑也已在運行中的 OneUptime 上跑過（以 Docker Compose 的方式啟動），並且是在真實的 DevStack 上，而不是這些工具上。以其文件的指令安裝的代理程式，從第一批資料就註冊了雲端，每個執行個體、磁碟區與虛擬化主機都有一列，狀態就是雲端本身給出的狀態。在實際停止 `nova-compute` 後，它那一列變為停擺，使用 Compute Service Down 範本的監控在約 12 分鐘後開啟了一個指明該主機的事件，並在服務再次啟動後一分鐘內解決。專案的探測器經由儀表板自己的路由連接了同一個雲端，並讀回了它的資料列，而簽署過的開機流程的 114 個 span，則由追蹤設定檔從其各項服務送達。

另外，真實代理程式在 DevStack 上送出的內容，以及 Kolla-Ansible 的 Alertmanager 所送出的內容都已錄製下來，再送到運行中的 OneUptime：觸發的 webhook 對正確的雲端開啟了一個事件，沒有對其他雲端開啟，同一個 webhook 再次送出時沒有開啟任何東西，而已解決的 webhook 則解決了它。

## 轉發已在觸發的警示

任何有 Alertmanager 的工具，今天就可以有事件：觸發的警示會變成事件，從第一個小時起就有待命與狀態頁面，警示解除時事件也隨之解決。不需要安裝任何東西，而且這與本頁其他所有內容並行運作。

:::steps
### 建立監控

依照 [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#用監測器接收警示) 的說明建立一個 Incoming Request 監控，並複製它的 **Heartbeat URL**。這就是下面各工具的接收器中 `<secret key>` 所在的位址。

### 放到雲端上

開啟監控的 **概覽 → 已連結的資源**，並新增該 OpenStack 雲端。之後每個事件都會出現在該雲端的 **事件** 頁面：Incoming Request 監控自己的設定不會指定任何雲端，所以每個雲端的 Alertmanager 都需要自己的監控。雲端要等到第一批資料送達後才會出現在該清單中，因此請在完成下面的步驟之後再做這件事，或先在 **OpenStack → 所有雲端** 下新增該雲端。
:::

版本與 Kolla-Ansible 固定的相同的 Alertmanager，已錄製到以這個確切格式送出，而它送出的內容在運行中的 OneUptime 上開啟了一個事件，並由其自己的 `resolved` 狀態解決。

## Kolla-Ansible

在 `/etc/kolla/globals.yml` 中開啟 `enable_prometheus`（Kolla-Ansible 在您設定之前預設為關閉）後，它會執行 Prometheus、Alertmanager 以及雲端底下每一項東西的匯出器，但不隨附任何警示規則。本指南讀取的是這些已在執行的內容，而不是另外啟動第二份。

### 在 Kolla-Ansible 上轉發觸發中的警示

僅限您自己撰寫規則的情況：Kolla-Ansible 不隨附任何規則，因此在 `/etc/kolla/config/prometheus/*.rules` 有規則之前，不會有任何東西觸發。在您用來部署的主機上，寫入 `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`（Kolla-Ansible 會用它取代自己的），然後套用：

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

### Kolla-Ansible 上的憑證

以管理員身分登入，執行 `source /etc/kolla/admin-openrc.sh`，這個檔案由 `kolla-ansible post-deploy` 寫入。

- **完整檢視** 需要變更一處，在 Cinder。Kolla-Ansible 的範本已在 Nova、Neutron、Glance 與 Placement 的 `[keystone_authtoken]` 下設定了 `service_type`，但它的 Cinder 設為 `volume`，而其目錄寫的是 `block-storage`，除非兩者一致，否則 keystonemiddleware 會以 `401` 拒絕受存取規則限制的憑證。請在 `/etc/kolla/config/cinder.conf` 的 `[keystone_authtoken]` 下加入 `service_type = block-storage`，然後執行 `kolla-ansible reconfigure -i <inventory> --tags cinder`。
- **僅基礎架構** 的覆寫放在 `/etc/kolla/config/nova/policy.yaml`，`neutron`、`keystone` 與 `placement` 同理，並與已存在的內容合併。以 `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement` 套用。

### 監控 Kolla-Ansible 的雲端所依賴的元件

在執行 Kolla-Ansible 的 Prometheus 的主機上，下面的指令會從 Kolla-Ansible 產生的檔案讀取它的目標，並以代理程式設定的形式印出：

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

將它印出的內容加入代理程式的 `.env`，然後在代理程式的資料夾中執行 `docker compose up -d`。每個匯出器都在 API 網路上監聽，因此代理程式所在的機器需要有通往那裡的路由。雲端的 **控制平面** 卡片隨後會說明各個匯出器的狀況，並明確指出哪些沒有被監控。

| 讀取 | 連接埠 | 設定 |
| --- | --- | --- |
| RabbitMQ 的 Prometheus 外掛程式 | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| HAProxy 自己的匯出器 | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter，用於 OVN 與 Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **OVN 的資料庫：** Kolla-Ansible 從 2026.1 起才執行 openstack-network-exporter，且只在運算與網路節點上，而 OVN 資料庫要從它所在的主機讀取。如果您的控制節點兩者都不是，請在清單中的 `[prometheus-openstack-network-exporter:children]` 下加入它們並重新設定，否則 Northbound 與 Southbound 資料庫會顯示為未監控。
- **2026.1 之前** 沒有網路匯出器，因此 OVN 與 Open vSwitch 會顯示為未監控。

### Kolla-Ansible 上的服務日誌

代理程式的日誌設定檔在每個節點上執行，並讀取 Kolla-Ansible 的檔案。它會把一行日誌與雲端的頁面關聯起來：

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Kolla 自己的 Fluentd 也可以轉發，方法是依 [Fluentd](/docs/telemetry/fluentd) 所述，在 `/etc/kolla/config/fluentd/output/*.conf` 中加入輸出，但這些記錄會以服務名稱出現在 **日誌** 中，而不會出現在雲端的頁面上。

### Kolla-Ansible 上的誰做了什麼

Keystone 的稽核軌跡與各個 API 上的稽核篩選器，會進入 [Security Events](/docs/telemetry/openstack#誰做了什麼)。兩者都寫入服務自己的日誌，匯流排上沒有任何消費者。一旦在 **安全事件 → 連線** 下開啟 **在日誌中尋找安全事件**，OneUptime 就會從那裡讀取它們。代理程式的日誌設定檔會從 `/var/log/kolla` 讀取兩者。

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

這會為每次登入送出一行，**從新位址使用 OpenStack 管理員憑證** 會讀取它。若只想送出失敗的登入，請將 `identity.authenticate.success` 加到 `notification_opt_out`，該偵測隨後就會讀取稽核篩選器所看到的內容。

至於透過 Nova、Neutron、Cinder 與 Glance 的誰做了什麼，稽核篩選器需要一項設定，可以一次放進每個服務的設定中：

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

它還需要一個 paste 檔案，而 Kolla-Ansible 的設定任務不會為這些服務複製任何 paste 檔案。請把您自己的檔案放到每個 API 主機上，並用 `globals.yml` 中的 `nova_api_extra_volumes`、`neutron_server_extra_volumes`、`cinder_api_extra_volumes` 與 `glance_api_extra_volumes` 將它掛載到映像中原有檔案的位置。pyCADF 的對應檔案在映像內的 `/var/lib/kolla/venv/etc/pycadf`。篩選器所需的設定行請見[誰做了什麼](/docs/telemetry/openstack#開啟稽核篩選器)。

## OpenStack-Ansible

OpenStack-Ansible 將其服務的日誌保存在 journald，自己不執行任何 Prometheus，因此代理程式是切入點，而日誌有自己的路徑。

### OpenStack-Ansible 上的憑證

從 utility 容器以管理員身分登入：`lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`，然後執行 `. ~/openrc`。它沒有下面指令會用到的 `curl`，所以請先在那裡執行 `apt-get install -y curl`。

- **完整檢視** 需要變更一處，在 Cinder。OpenStack-Ansible 的角色已在 `[keystone_authtoken]` 下設定了 `service_type`，但它的 Cinder 設為 `volumev3`，而其目錄寫的是 `block-storage`，除非兩者一致，否則 keystonemiddleware 會以 `401` 拒絕受存取規則限制的憑證。請在 `/etc/openstack_deploy/user_variables.yml` 的 `cinder_cinder_conf_overrides` 中，於 `keystone_authtoken` 下設定 `service_type: block-storage`，然後執行 `openstack-ansible openstack.osa.cinder --tags cinder-config`。
- **僅基礎架構** 的覆寫寫成 `/etc/openstack_deploy/user_variables.yml` 中的 `nova_policy_overrides`、`neutron_policy_overrides`、`keystone_policy_overrides` 與 `placement_policy_overrides`。以各自的 playbook 與標籤套用，例如 `openstack-ansible openstack.osa.nova --tags nova-policy-override`。之後移除其中一項時，會留下一個空檔案而不是沒有檔案，所以不會有任何失敗。

### 監控 OpenStack-Ansible 的雲端所依賴的元件

OpenStack-Ansible 不為這些元件執行任何匯出器，所以只有您開啟的才會被監控。

**RabbitMQ：** 開啟它的 Prometheus 外掛程式，然後在代理程式的 `.env` 中將每個容器位於 `15692` 的位址指定為 `OPENSTACK_RABBITMQ_TARGETS`：

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy：** 它的匯出器是關閉的，而它的統計監聽器位於 `127.0.0.1` 且使用 TLS，代理程式無法讀取。請在代理程式能連到的位置開啟它，然後將該位址在 `1936` 上的位置指定為 `OPENSTACK_HAPROXY_TARGETS`：

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB 與 Memcached：** OpenStack-Ansible 對兩者都沒有隨附匯出器。請自行執行 [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) 與 [memcached_exporter](https://github.com/prometheus/memcached_exporter)，並將它們指定為 `OPENSTACK_MARIADB_TARGETS` 與 `OPENSTACK_MEMCACHED_TARGETS`，或者不管它們：雲端的 **控制平面** 卡片隨後會說明它們未被監控，而不是說它們一切正常。

### OpenStack-Ansible 上的服務日誌

從 journald 取得，在每個執行服務的主機上進行：容器會將其 journal 傳遞到主機。

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

這會將代理程式的日誌設定檔作為 systemd 服務執行，並讀取 `/var/log/journal/`，OpenStack-Ansible 容器的 journal 就會送到那裡。

### OpenStack-Ansible 上的誰做了什麼

Keystone 的稽核軌跡與各個 API 上的稽核篩選器，會進入 [Security Events](/docs/telemetry/openstack#誰做了什麼)。兩者都寫入服務自己的日誌，匯流排上沒有任何消費者。一旦在 **安全事件 → 連線** 下開啟 **在日誌中尋找安全事件**，OneUptime 就會從那裡讀取它們。代理程式的日誌設定檔會從 journal 讀取兩者。

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

這會為每次登入送出一行，**從新位址使用 OpenStack 管理員憑證** 會讀取它。若只想送出失敗的登入，請將 `identity.authenticate.success` 加到 `notification_opt_out`，該偵測隨後就會讀取稽核篩選器所看到的內容。`notification_opt_out` 的第二個值要以 YAML 集合的形式放入，正如[它的 config_template](https://docs.openstack.org/ansible-config_template/latest/) 寫入重複鍵的方式。

至於透過 Nova、Neutron、Cinder 與 Glance 的誰做了什麼，每個 API 在其 conf 覆寫中接受篩選器的設定，並在其 paste 覆寫中加入篩選器，其中 `audit` 緊接在 `authtoken` 以及各管線中跟在它後面的 context 篩選器之後。以下是 Nova 的，Neutron 的 `neutron_neutron_conf_overrides` 與 `neutron_api_paste_ini_overrides`、Cinder 的 `cinder_cinder_conf_overrides` 與 `cinder_api_paste_ini_overrides`，以及 Glance 的 `glance_glance_api_conf_overrides` 與 `glance_glance_api_paste_ini_overrides` 也是同樣的做法：

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

OpenStack-Helm 提供 Prometheus、Alertmanager 與匯出器的 chart，是否執行則由您決定。它的控制平面在 Kubernetes 中執行，因此探測器讀取 API，而 Kubernetes 代理程式看到 Pod。

### 在 OpenStack-Helm 上轉發觸發中的警示

如果您執行它的 prometheus-alertmanager chart，請在 chart 的值中的 `conf.alertmanager` 下加入接收器，並將您的路由送往它：

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

### 在 OpenStack-Helm 上讀取 API 並查看 Pod

開啟 **OpenStack → 所有雲端**，按一下 **連接雲端**，並提供 Keystone 的位址、應用程式憑證以及要使用的探測器。探測器只會以 HTTPS 與雲端通訊。接著針對 chart 所在的叢集，依照 **Kubernetes → 文件** 操作：它的 Pod、其日誌與其節點會進入 Kubernetes 頁面。

若也希望這些服務的日誌出現在此雲端的 **日誌** 頁面上（每個堆疊追蹤為一筆記錄），請在代理程式的值中指定雲端名稱，以及其服務所在的命名空間：

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### OpenStack-Helm 上的誰做了什麼

Keystone 的稽核軌跡與各個 API 上的稽核篩選器，會進入 [Security Events](/docs/telemetry/openstack#誰做了什麼)。兩者都寫入服務自己的日誌，匯流排上沒有任何消費者。一旦在 **安全事件 → 連線** 下開啟 **在日誌中尋找安全事件**，OneUptime 就會從那裡讀取它們。Kubernetes 代理程式會從 Pod 的日誌讀取兩者，並在其值中指定雲端名稱。

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

這會為每次登入送出一行，**從新位址使用 OpenStack 管理員憑證** 會讀取它。若只想送出失敗的登入，請將 `identity.authenticate.success` 加到 `notification_opt_out`，該偵測隨後就會讀取稽核篩選器所看到的內容。

chart 的 `logging.conf` 將根記錄器保持在 `WARNING`，而日誌驅動程式是寫在它自己的記錄器之下，所以如果沒有為它設定記錄器，就不會寫入任何東西。值中的清單會取代 chart 原有的清單，因此 `keys` 要包含 chart 原有的內容，再加上這些：

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

至於透過 Nova、Neutron 與 Cinder 的誰做了什麼，它們 chart 的 `conf.paste` 已在每條管線中包含稽核篩選器，只需要告訴它寫到哪裡。每個都需要在 `conf.logging` 中設定相同的記錄器。Glance 的 chart 有對應檔案，但管線中既沒有篩選器，也沒有放置它的位置：請將兩者都加到它的 `conf.paste`。

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere 執行 kube-prometheus-stack 與自己的警示規則，並以 Loki 搭配 Vector 處理日誌。請先轉發它的警示，然後由探測器讀取 API，Kubernetes 代理程式查看 Pod。

### 在 Atmosphere 上轉發觸發中的警示

Atmosphere 隨附的警示規則曾真正呼叫過值班人員，所以從第一個小時起就能運作。請把接收器加到您的 Atmosphere 設定中，放在您已有的任何接收器旁邊，然後部署：

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

### 在 Atmosphere 上讀取 API 並查看 Pod

開啟 **OpenStack → 所有雲端**，按一下 **連接雲端**，並提供 Keystone 的位址、應用程式憑證以及要使用的探測器。探測器只會以 HTTPS 與雲端通訊。接著針對 Atmosphere 所在的叢集，依照 **Kubernetes → 文件** 操作。

若也希望這些服務的日誌出現在此雲端的 **日誌** 頁面上（每個堆疊追蹤為一筆記錄），請在代理程式的值中指定雲端名稱，以及其服務所在的命名空間：

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Atmosphere 上的誰做了什麼

Keystone 的稽核軌跡與各個 API 上的稽核篩選器，會進入 [Security Events](/docs/telemetry/openstack#誰做了什麼)。兩者都寫入服務自己的日誌，匯流排上沒有任何消費者。一旦在 **安全事件 → 連線** 下開啟 **在日誌中尋找安全事件**，OneUptime 就會從那裡讀取它們。Kubernetes 代理程式會從 Pod 的日誌讀取兩者，並在其值中指定雲端名稱。

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

這會為每次登入送出一行，**從新位址使用 OpenStack 管理員憑證** 會讀取它。若只想送出失敗的登入，請將 `identity.authenticate.success` 加到 `notification_opt_out`，該偵測隨後就會讀取稽核篩選器所看到的內容。

至於透過 Nova、Neutron 與 Cinder 的誰做了什麼，Atmosphere 部署的 chart 已在每條管線中包含稽核篩選器，只需要在 `nova_helm_values`、`neutron_helm_values` 與 `cinder_helm_values` 中告訴它寫到哪裡。Glance 的 chart 管線中既沒有篩選器，也沒有放置它的位置：請將兩者都加到 `glance_helm_values` 中它的 `conf.paste`。

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam 可以用 `sunbeam enable observability embedded` 部署 Canonical Observability Stack。Canonical 也有 `openstack-exporter` charm，如果您有執行它，代理程式就能讀取。Sunbeam 自己的文件沒有提到這個 charm，這裡的任何內容也都沒有在 Sunbeam 上執行過。

### 在 Sunbeam 上轉發觸發中的警示

如果您執行 Canonical Observability Stack，請給它的 Alertmanager 一份包含該接收器的設定：

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

### 匯出器 charm

如果您執行 Canonical 的 `openstack-exporter` charm，代理程式不需要自己的憑證就能讀取它。它在 `/metrics` 回應一個雲端，連接埠為 `9180`，除非您變更了它的 `port` 設定。用 `juju status openstack-exporter` 找到它的位址：

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

它會提供哪些數列，取決於其 snap 中的匯出器版本，這裡並未記錄：`bash troubleshoot.sh` 會說明它是否讀得到雲端。

### Sunbeam 上的服務日誌

開啟可觀測性後，堆疊的 Loki 會保存各服務的日誌。OneUptime 無法讀取 Loki，而代理程式的日誌設定檔也沒有在 Sunbeam 的 charm 上試過，因此這裡還沒有任何東西會收集它們。

### Sunbeam 上的誰做了什麼

目前還不行。Sunbeam 的 charm 以自己的範本寫入每個服務的設定，而它的 Keystone charm 沒有設定通知送往何處的選項。因此無法從 charm 外部開啟 Keystone 的稽核軌跡或稽核篩選器，這裡的任何東西都不會進入 Security Events。

## OpenShift 上的 Red Hat OpenStack

它的 Telemetry Operator 在 OpenShift 上執行 Ceilometer 的 Prometheus 匯出器，以及帶有 Alertmanager 的監控堆疊。Kubernetes 代理程式的 OpenShift 預設組態會監看控制平面，而 Ceilometer 的匯出器則會說明運算節點正在做什麼。

### 在 OpenShift 上的 Red Hat OpenStack 轉發觸發中的警示

如果 `MetricStorage` 已啟用 `alertingEnabled`，且您撰寫或套用了規則，請套用一個監控堆疊會讀取的接收器：

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

### 讀取 API 與控制平面

開啟 **OpenStack → 所有雲端**，按一下 **連接雲端**，並提供 Keystone 的位址、應用程式憑證以及要使用的探測器。探測器只會以 HTTPS 與雲端通訊。接著針對執行控制平面的叢集，依照 **Kubernetes → 文件** 操作，並選擇 **Red Hat OpenShift**，這會設定 `preset=openshift`。

若也希望這些服務的日誌出現在此雲端的 **日誌** 頁面上（每個堆疊追蹤為一筆記錄），請在代理程式的值中指定雲端名稱，以及其服務所在的命名空間：

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### 透過 Ceilometer 讀取運算節點

探測器只能說明已分配了什麼，無法說明有多忙。若要讀取實際用量，請在可連線到運算節點的機器上執行代理程式，並以 `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` 指定每個節點在 Ceilometer 連接埠 `9101` 上的位址。

### OpenShift 上的 Red Hat OpenStack 的誰做了什麼

Keystone 的稽核軌跡與各個 API 上的稽核篩選器，會進入 [Security Events](/docs/telemetry/openstack#誰做了什麼)。兩者都寫入服務自己的日誌，匯流排上沒有任何消費者。一旦在 **安全事件 → 連線** 下開啟 **在日誌中尋找安全事件**，OneUptime 就會從那裡讀取它們。Kubernetes 代理程式會從 Pod 的日誌讀取兩者，並在其值中指定雲端名稱。

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

這會為每次登入送出一行，**從新位址使用 OpenStack 管理員憑證** 會讀取它。若只想送出失敗的登入，請將 `identity.authenticate.success` 加到 `notification_opt_out`，該偵測隨後就會讀取稽核篩選器所看到的內容。

至於透過 Nova 與 Neutron 的誰做了什麼，每個都在其 `customServiceConfig` 中接受篩選器的設定，並在 `defaultConfigOverwrite` 中接受其 paste 檔案。Cinder 與 Glance 的 operator 不接受 paste 檔案，所以這裡的設定對它們沒有作用。

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

StackLight 已經以自己的警示規則監看 OpenStack 的服務、MariaDB、Memcached、RabbitMQ 與 libvirt。請先轉發它的警示，然後由探測器讀取 API。

### 在 Mirantis MOSK 上轉發觸發中的警示

StackLight 隨附警示規則，所以從第一個小時起就能運作。請把接收器及其路由加到您的 StackLight 值中。Mirantis 的文件展示的是其他接收器，而非 webhook，而這項設定尚未在 MOSK 上執行過：

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

### 讀取 API

開啟 **OpenStack → 所有雲端**，按一下 **連接雲端**，並提供 Keystone 的位址、應用程式憑證以及要使用的探測器。探測器只會以 HTTPS 與雲端通訊。

### Mirantis MOSK 上的誰做了什麼

至於透過 Nova、Neutron、Cinder 與 Glance 的誰做了什麼，MOSK 有自己的設定，稽核篩選器已就位。使用 log 驅動程式時，每個服務都寫到它的標準輸出，而 Kubernetes 代理程式會從 Pod 的日誌讀取，並在其值中指定雲端名稱。各服務都寫入自己的日誌，匯流排上沒有任何消費者。一旦在 **安全事件 → 連線** 下開啟 **在日誌中尋找安全事件**，OneUptime 就會從那裡讀取它們。

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

這項設定不涵蓋 Keystone。它自己的稽核軌跡要透過 `spec:services` 設定，Mirantis 不會驗證它也不負責，所以請對照您的支援合約斟酌：

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

這會為每次登入送出一行，**從新位址使用 OpenStack 管理員憑證** 會讀取它。若只想送出失敗的登入，請將 `identity.authenticate.success` 加到 `notification_opt_out`，該偵測隨後就會讀取稽核篩選器所看到的內容。

## 使用您已在執行的匯出器

不需要憑證，也不需要執行任何新東西：代理程式可以讀取您已有的匯出器。怎麼做取決於它是如何啟動的。

- **使用 `--multi-cloud`**（如代理程式自己執行的那樣）：設定 `OPENSTACK_EXPORTER_ADDRESS`，代理程式會在 `/probe` 上一次向它詢問一項服務。
- **不使用它**（如 Kolla-Ansible 與 Canonical 的 charm 執行的那樣）：它沒有 `/probe`，因此請設定 `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`，代理程式每 2 分鐘會在 `/metrics` 上一次向它詢問全部內容。

在 Kolla-Ansible 上，那就是其內部 VIP 的 `9198`：

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

這樣的讀取是在 Kolla-Ansible 自己的 Prometheus 每分鐘詢問一次之外額外進行的。Kolla-Ansible 固定使用匯出器 1.7.0，它的回應提供的內容也比代理程式固定的匯出器少。以下是在五個真實雲端上頁面所缺少的內容，並有一項測試讓它與那些錄製內容保持一致：

| 缺少的內容 | 原因 | 代價 |
| --- | --- | --- |
| Cinder 的一切 | 它向目錄詢問 `volumev3`，而在 Cinder 註冊為 `block-storage` 的環境中找不到這樣的東西 | **磁碟區** 與 **儲存集區** 維持空白，**服務** 中沒有 Block Storage API、`cinder-volume` 或 `cinder-scheduler`。**Block Storage API 停擺**、**Block Storage 服務停擺**、**儲存集區警告**、**儲存集區嚴重**、**錯誤狀態的磁碟區** 與 **磁碟區卡住** 維持安靜 |
| 虛擬化主機持有多少個執行個體，以及它的主機集合 | Nova 的虛擬化主機清單在最新的 microversion 上會失敗，而 Kolla-Ansible 要求的正是這個版本 | **虛擬化主機** 上的這兩項，以及遺失主機時它所說的連帶損失。它的 vCPU、記憶體與磁碟仍然存在：這些來自 Placement |
| 網域 | 它沒有這樣的數列 | **網域** 維持空白 |
| 映像的狀態、可見性與建立日期 | 它沒有這樣的標籤 | **映像** 上的這些欄位。**映像卡住** 維持安靜，所以卡在變成 `active` 途中的映像不會被注意到 |
| 網路的 MTU | 它沒有這樣的標籤 | 網路頁面上的那一行 |

如果您需要這些，請改用代理程式自己的匯出器。您之後可以改變主意：無論由哪一個讀取，雲端都保留它的名稱。
