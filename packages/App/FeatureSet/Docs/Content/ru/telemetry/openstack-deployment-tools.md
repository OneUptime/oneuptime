# OpenStack по инструментам развёртывания

Никто не запускает «OpenStack» как таковой. Запускают инструмент, который его разворачивает, и у каждого инструмента свои пути, свои журналы и своё представление о том, что уже работает. На этой странице собрано то, что мастер настройки в OneUptime говорит про каждый из них: откройте **OpenStack → Документация** и ответьте на вопрос **Как вы развёртываете OpenStack?**

:::cards
- [Насколько проверен каждый гайд](#насколько-проверен-каждый-гайд): Прочитайте это первым. Гайды для Kolla-Ansible и OpenStack-Ansible запускались на реальных развёртываниях. Остальные не запускались.
- [Пересылка того, что уже сработало](#пересылка-того-что-уже-сработало): Инциденты с первого часа, без агента.
- [Kolla-Ansible](#kolla-ansible): Чтение экспортёров, которые он уже запускает.
- [OpenStack-Ansible](#openstack-ansible): Журналы journald и переопределения в `user_variables.yml`.
- [OpenStack-Helm](#openstack-helm): Зонд и агент для Kubernetes; то же для Atmosphere.
- [Canonical Sunbeam](#canonical-sunbeam): Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): Пресет для OpenShift и Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): Оповещения StackLight.
- [Используйте экспортёр, который уже работает](#используйте-экспортёр-который-уже-работает): Чего не хватает страницам на версии 1.7.0.
:::

## Насколько проверен каждый гайд

Каждый путь, порт и переменная ниже прочитаны из исходного кода или документации самого инструмента. Гайды Kolla-Ansible и OpenStack-Ansible также выполнялись на реальных развёртываниях, с их собственными командами и заглушкой вместо OneUptime, которая сохраняет то, что отправляет агент. Поэтому ни один гайд здесь не отчитывался в работающий OneUptime с реального развёртывания своего инструмента. С чем сверен каждый:

| Инструмент | Откуда прочитано | Запускалось по-настоящему |
| --- | --- | --- |
| Kolla-Ansible | Его исходный код, в master и `stable/2026.1` | Команды этого гайда, на реальном all-in-one в `stable/2026.1` с Open vSwitch: агент на учётных данных «Полный обзор», без Docker, на собственном экспортёре Kolla-Ansible и на вашем собственном в закреплённой версии и в 1.7.0, экспортёр агента на учётных данных «Только инфраструктура», цели, прочитанные из его настоящего `prometheus.yml`, и профиль журналов. При реально остановленном там Memcached его Alertmanager отправил вебхук firing, а затем resolved, и отправленное, будучи принятым работающим OneUptime, открыло один инцидент на нужном облаке и ни на каком другом, а затем закрыло его |
| OpenStack-Ansible | Его исходный код и документация | Команды этого гайда, на реальном all-in-one в `stable/2026.1`, в контейнерах LXC: агент на учётных данных «Полный обзор», экспортёр агента на учётных данных «Только инфраструктура» с его переопределениями политик, настройки RabbitMQ и HAProxy с агентом, читающим каждую, и профиль журналов на журнале |
| OpenStack-Helm | Значения его чартов | Ничего на OpenStack-Helm. Зонд и агент для Kubernetes проверялись каждый отдельно |
| Atmosphere | Его документация и исходный код | Ничего на Atmosphere. Зонд и агент для Kubernetes проверялись каждый отдельно |
| Canonical Sunbeam | Документация Canonical и исходный код его charms | Ничего на Sunbeam. Собственная документация Sunbeam не упоминает charm экспортёра |
| Red Hat OpenStack on OpenShift | Исходный код Telemetry Operator | Ничего на дистрибутиве Red Hat. Пресет для OpenShift и экспортёр Ceilometer проверялись каждый отдельно |
| Mirantis MOSK | Документация Mirantis, примеры в которой показывают другие получатели, а не webhook | Ничего на MOSK |

То, что включает **Кто что сделал** в каждом гайде, записано на DevStack и ни на одном из этих инструментов. Куда это ведёт каждый инструмент, прочитано из его исходного кода или документации.

Помимо этого, весь путь целиком прошёл на живом OneUptime, запущенном так, как его запускает Docker Compose, на реальном DevStack, а не на каком-либо из этих инструментов. Агент, установленный командами из его документации, зарегистрировал облако по своим первым данным, и у каждого экземпляра, тома и гипервизора появилась строка со статусом, который дало само облако. После настоящей остановки `nova-compute` его строка стала down, монитор из шаблона Compute Service Down примерно через 12 минут открыл один инцидент с названием хоста и закрыл его в течение минуты после того, как служба снова запустилась. Зонд проекта подключил то же облако через собственные маршруты дашборда и прочитал обратно его строки, а 114 спанов подписанной загрузки пришли через его службы из профиля трассировок.

Отдельно то, что прислал настоящий агент на DevStack и что отправил Alertmanager Kolla-Ansible, было записано, а затем отправлено на живой OneUptime: webhook с firing открыл один инцидент на нужном облаке и ни на каком другом, тот же webhook повторно не открыл ничего, а webhook с resolved закрыл его.

## Пересылка того, что уже сработало

Любой инструмент с Alertmanager может получать инциденты уже сегодня: сработавшее оповещение становится инцидентом, с дежурствами и страницами статуса с первого часа, и закрывается, когда закрывается оповещение. Ничего устанавливать не нужно, и это работает вместе со всем остальным на этой странице.

:::steps
### Создайте монитор

Создайте монитор Incoming Request так, как описано в [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#приём-оповещений-монитором), и скопируйте его **Heartbeat URL**. Это адрес `<secret key>` в получателе каждого инструмента ниже.

### Привяжите его к облаку

Откройте **Обзор → Связанные ресурсы** монитора и добавьте облако OpenStack. После этого каждый инцидент появляется на странице **Инциденты** этого облака: собственные настройки монитора Incoming Request не называют никакого облака, поэтому для Alertmanager каждого облака нужен свой монитор. Облако появляется в этом списке, когда приходят его первые данные, поэтому сделайте это после шагов ниже или сначала добавьте облако в **OpenStack → Все облака**.
:::

Alertmanager в версии, которую закрепляет Kolla-Ansible, был записан отправляющим именно в таком формате, и отправленное открыло один инцидент на работающем OneUptime, который закрыл его собственный статус `resolved`.

## Kolla-Ansible

Когда в `/etc/kolla/globals.yml` включён `enable_prometheus` (Kolla-Ansible оставляет его выключенным, пока вы его не задали), он запускает Prometheus, Alertmanager и экспортёр для каждой части под облаком и не поставляет правил оповещений. Этот гайд читает то, что они запускают, а не запускает вторую копию.

### Пересылка сработавшего в Kolla-Ansible

Только если вы написали собственные правила: Kolla-Ansible не поставляет ни одного, поэтому ничего не сработает, пока в `/etc/kolla/config/prometheus/*.rules` их нет. На хосте, с которого вы разворачиваете, напишите `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, который Kolla-Ansible читает вместо своего, и примените его:

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

### Учётные данные в Kolla-Ansible

Войдите как администратор командой `source /etc/kolla/admin-openrc.sh`, который пишет `kolla-ansible post-deploy`.

- **Полный обзор** требует одного изменения, в Cinder. Шаблоны Kolla-Ansible уже задают `service_type` в `[keystone_authtoken]` у Nova, Neutron, Glance и Placement, но его Cinder называется `volume`, а каталог называет его `block-storage`, и keystonemiddleware отклоняет учётные данные, ограниченные правилами доступа, с ошибкой `401`, если эти два значения не совпадают. Добавьте `service_type = block-storage` в `[keystone_authtoken]` в `/etc/kolla/config/cinder.conf`, затем выполните `kolla-ansible reconfigure -i <inventory> --tags cinder`.
- **Только инфраструктура** берёт свои переопределения из `/etc/kolla/config/nova/policy.yaml`, а также для `neutron`, `keystone` и `placement`, объединяя их с тем, что там уже есть. Примените их командой `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.

### Наблюдение за тем, на чём стоит облако Kolla-Ansible

На хосте, где работает Prometheus Kolla-Ansible, эта команда читает его цели из файла, который отрисовал Kolla-Ansible, и выводит их как настройки для агента:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Добавьте выведенное в `.env` агента, затем выполните `docker compose up -d` в папке агента. Каждый экспортёр слушает в сети API, поэтому у машины агента должен быть туда маршрут. Карточка **Плоскость управления** облака затем сообщает состояние каждого и прямо говорит, какие не отслеживаются.

| Что читает | Порт | Настройка |
| --- | --- | --- |
| Плагин Prometheus для RabbitMQ | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| Собственный экспортёр HAProxy | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, для OVN и Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **Базы данных OVN:** Kolla-Ansible запускает openstack-network-exporter начиная с 2026.1, только на вычислительных и сетевых узлах, а база данных OVN читается с хоста, на котором она работает. Если ваши управляющие узлы не относятся ни к тем, ни к другим, добавьте их в `[prometheus-openstack-network-exporter:children]` в своём inventory и выполните reconfigure, иначе базы Northbound и Southbound будут отображаться как не отслеживаемые.
- **До 2026.1** сетевого экспортёра нет, поэтому OVN и Open vSwitch отображаются как не отслеживаемые.

### Журналы служб в Kolla-Ansible

Профиль журналов агента работает на каждом узле и читает файлы Kolla-Ansible. Именно он связывает строку со страницами облака:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Пересылать может и собственный Fluentd Kolla, с выводом в `/etc/kolla/config/fluentd/output/*.conf`, как описано в [Fluentd](/docs/telemetry/fluentd), но такие записи попадают в **Журналы** под именем службы, а не на страницы облака.

### Кто что сделал в Kolla-Ansible

Журнал аудита Keystone и фильтр аудита на каждом API попадают в [События безопасности](/docs/telemetry/openstack#кто-что-сделал). Каждый пишет в собственный журнал службы, без потребителя на шине. OneUptime читает их оттуда, когда включено **Искать события безопасности в логах**, в разделе **События безопасности → Подключения**. Профиль журналов агента читает оба из `/var/log/kolla`.

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

Так отправляется строка на каждый вход, которую читает **OpenStack admin credential used from a new address**. Чтобы отправлять только неудачные входы, добавьте `identity.authenticate.success` в `notification_opt_out`, и тогда это обнаружение будет читать то, что увидел фильтр аудита.

Чтобы узнать, кто что сделал через Nova, Neutron, Cinder и Glance, фильтру аудита нужна настройка, которая задаётся сразу в конфигурации каждой службы:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

Ему также нужен paste-файл, а задачи конфигурации Kolla-Ansible не копируют paste-файл для этих служб. Положите свой на каждый хост API и смонтируйте поверх файла в образе с помощью `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` и `glance_api_extra_volumes` в `globals.yml`. Файлы карт pyCADF находятся в `/var/lib/kolla/venv/etc/pycadf` в образе. Строки фильтра приведены в разделе [Кто что сделал](/docs/telemetry/openstack#включите-фильтр-аудита).

## OpenStack-Ansible

OpenStack-Ansible хранит журналы своих служб в journald и не запускает собственного Prometheus, поэтому путь внутрь ведёт через агент, а у журналов есть свой отдельный путь.

### Учётные данные в OpenStack-Ansible

Войдите как администратор из контейнера utility: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, затем `. ~/openrc`. В нём нет `curl`, который используют команды ниже, поэтому сначала выполните там `apt-get install -y curl`.

- **Полный обзор** требует одного изменения, в Cinder. Роли OpenStack-Ansible уже задают `service_type` в `[keystone_authtoken]`, но его Cinder называется `volumev3`, а каталог называет его `block-storage`, и keystonemiddleware отклоняет учётные данные, ограниченные правилами доступа, с ошибкой `401`, если эти два значения не совпадают. Задайте `service_type: block-storage` в `keystone_authtoken` внутри `cinder_cinder_conf_overrides` в `/etc/openstack_deploy/user_variables.yml`, затем выполните `openstack-ansible openstack.osa.cinder --tags cinder-config`.
- **Только инфраструктура** берёт свои переопределения как `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` и `placement_policy_overrides` в `/etc/openstack_deploy/user_variables.yml`. Применяйте каждое своим playbook и тегом, например `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Если позже убрать одно из них, остаётся пустой файл, а не его отсутствие, поэтому ничего не ломается.

### Наблюдение за тем, на чём стоит облако OpenStack-Ansible

OpenStack-Ansible не запускает для этого экспортёров, поэтому отслеживается только то, что вы включите.

**RabbitMQ:** включите его плагин Prometheus, затем укажите адрес каждого контейнера на порту `15692` как `OPENSTACK_RABBITMQ_TARGETS` в `.env` агента:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** его экспортёр выключен, а listener статистики работает на `127.0.0.1` с TLS, и агент не может его прочитать. Включите его там, где агент достанет, затем укажите этот адрес на порту `1936` как `OPENSTACK_HAPROXY_TARGETS`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB и Memcached:** OpenStack-Ansible не поставляет экспортёра ни для одного из них. Запустите [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) и [memcached_exporter](https://github.com/prometheus/memcached_exporter) самостоятельно и укажите их как `OPENSTACK_MARIADB_TARGETS` и `OPENSTACK_MEMCACHED_TARGETS` либо не указывайте: тогда карточка **Плоскость управления** облака сообщит, что они не отслеживаются, а не что с ними всё в порядке.

### Журналы служб в OpenStack-Ansible

Из journald, на каждом хосте, где работает служба: контейнеры передают свои журналы на хост.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

Это запускает профиль журналов агента как службу systemd и читает `/var/log/journal/`, куда приходят журналы контейнеров OpenStack-Ansible.

### Кто что сделал в OpenStack-Ansible

Журнал аудита Keystone и фильтр аудита на каждом API попадают в [События безопасности](/docs/telemetry/openstack#кто-что-сделал). Каждый пишет в собственный журнал службы, без потребителя на шине. OneUptime читает их оттуда, когда включено **Искать события безопасности в логах**, в разделе **События безопасности → Подключения**. Профиль журналов агента читает оба из журнала.

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

Так отправляется строка на каждый вход, которую читает **OpenStack admin credential used from a new address**. Чтобы отправлять только неудачные входы, добавьте `identity.authenticate.success` в `notification_opt_out`, и тогда это обнаружение будет читать то, что увидел фильтр аудита. Второе значение `notification_opt_out` задаётся как множество YAML, так, как [его config_template](https://docs.openstack.org/ansible-config_template/latest/) записывает повторяющийся ключ.

Чтобы узнать, кто что сделал через Nova, Neutron, Cinder и Glance, каждый API принимает настройку фильтра в своих переопределениях conf, а сам фильтр в переопределениях paste, с `audit` сразу после `authtoken` и контекстного фильтра, который идёт за ним в каждом конвейере. Для Nova так, а те же в `neutron_neutron_conf_overrides` и `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` и `cinder_api_paste_ini_overrides`, а также `glance_glance_api_conf_overrides` и `glance_glance_api_paste_ini_overrides`:

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

OpenStack-Helm предлагает чарты для Prometheus, Alertmanager и экспортёров, а работают ли они, решаете вы. Его плоскость управления работает в Kubernetes, поэтому зонд читает API, а агент для Kubernetes видит поды.

### Пересылка сработавшего в OpenStack-Helm

Если вы запускаете его чарт prometheus-alertmanager, добавьте получателя в `conf.alertmanager` в значениях чарта и направьте на него свой маршрут:

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

### Чтение API и наблюдение за подами в OpenStack-Helm

Откройте **OpenStack → Все облака**, нажмите **Подключить облако** и укажите адрес Keystone, application credential и зонд. Зонд общается с облаком только по HTTPS. Затем следуйте **Kubernetes → Документация** для кластера, на котором работают чарты: его поды, их журналы и его узлы попадают на страницы Kubernetes.

Чтобы журналы этих служб попадали и на страницу **Журналы** этого облака, причём каждый stack trace как одна запись, укажите облако в значениях агента вместе с пространствами имён, в которых работают его службы:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Кто что сделал в OpenStack-Helm

Журнал аудита Keystone и фильтр аудита на каждом API попадают в [События безопасности](/docs/telemetry/openstack#кто-что-сделал). Каждый пишет в собственный журнал службы, без потребителя на шине. OneUptime читает их оттуда, когда включено **Искать события безопасности в логах**, в разделе **События безопасности → Подключения**. Агент для Kubernetes читает оба из журналов подов, если облако названо в его значениях.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

Так отправляется строка на каждый вход, которую читает **OpenStack admin credential used from a new address**. Чтобы отправлять только неудачные входы, добавьте `identity.authenticate.success` в `notification_opt_out`, и тогда это обнаружение будет читать то, что увидел фильтр аудита.

`logging.conf` чарта держит корневой логгер на уровне `WARNING`, а драйвер log пишет под собственным логгером, поэтому без логгера для него ничего не записывается. Список в значениях заменяет список чарта, поэтому `keys` содержит то, что есть в чарте, плюс это:

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

Чтобы узнать, кто что сделал через Nova, Neutron и Cinder: в `conf.paste` их чартов фильтр аудита уже есть в каждом конвейере, и ему нужно указать, куда писать. Каждому нужен тот же логгер в `conf.logging`. В чарте Glance есть карта, но нет ни фильтра, ни места для него в конвейерах: добавьте оба в его `conf.paste`.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere запускает kube-prometheus-stack со своими правилами оповещений, а также Loki с Vector для журналов. Сначала перешлите его оповещения, затем зонд читает API, а агент для Kubernetes видит поды.

### Пересылка сработавшего в Atmosphere

Atmosphere поставляет правила оповещений, которые уже будили реальных людей, поэтому это работает с первого часа. Добавьте получателя в конфигурацию Atmosphere рядом с теми получателями, что у вас уже есть, и разверните её:

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

### Чтение API и наблюдение за подами в Atmosphere

Откройте **OpenStack → Все облака**, нажмите **Подключить облако** и укажите адрес Keystone, application credential и зонд. Зонд общается с облаком только по HTTPS. Затем следуйте **Kubernetes → Документация** для кластера, на котором работает Atmosphere.

Чтобы журналы этих служб попадали и на страницу **Журналы** этого облака, причём каждый stack trace как одна запись, укажите облако в значениях агента вместе с пространствами имён, в которых работают его службы:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Кто что сделал в Atmosphere

Журнал аудита Keystone и фильтр аудита на каждом API попадают в [События безопасности](/docs/telemetry/openstack#кто-что-сделал). Каждый пишет в собственный журнал службы, без потребителя на шине. OneUptime читает их оттуда, когда включено **Искать события безопасности в логах**, в разделе **События безопасности → Подключения**. Агент для Kubernetes читает оба из журналов подов, если облако названо в его значениях.

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

Так отправляется строка на каждый вход, которую читает **OpenStack admin credential used from a new address**. Чтобы отправлять только неудачные входы, добавьте `identity.authenticate.success` в `notification_opt_out`, и тогда это обнаружение будет читать то, что увидел фильтр аудита.

Чтобы узнать, кто что сделал через Nova, Neutron и Cinder: в чартах, которые разворачивает Atmosphere, фильтр аудита уже есть в каждом конвейере, и ему нужно указать, куда писать, в `nova_helm_values`, `neutron_helm_values` и `cinder_helm_values`. В чарте Glance нет ни фильтра, ни места для него в конвейерах: добавьте оба в его `conf.paste`, в `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam может развернуть Canonical Observability Stack командой `sunbeam enable observability embedded`. У Canonical также есть charm `openstack-exporter`, который агент может читать, если вы его запускаете. Собственная документация Sunbeam этот charm не упоминает, и здесь ничего не запускалось на Sunbeam.

### Пересылка сработавшего в Sunbeam

Если вы запускаете Canonical Observability Stack, дайте его Alertmanager конфигурацию с получателем:

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

### Charm экспортёра

Если вы запускаете charm `openstack-exporter` от Canonical, агент может читать его без собственных учётных данных. Он отвечает за одно облако на `/metrics`, на порту `9180`, если вы не изменили его настройку `port`. Адрес найдите командой `juju status openstack-exporter`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Какие ряды он отдаёт, зависит от версии экспортёра в его snap, которая здесь не записывалась: `bash troubleshoot.sh` сообщает, читает ли он облако.

### Журналы служб в Sunbeam

При включённой наблюдаемости журналы служб хранятся в Loki этого стека. OneUptime не умеет читать Loki, а профиль журналов агента на charms Sunbeam не пробовали, поэтому пока здесь их ничто не собирает.

### Кто что сделал в Sunbeam

Пока нет. Charms Sunbeam пишут конфигурацию каждой службы из своих шаблонов, и в charm Keystone нет настройки, куда отправлять уведомления. Поэтому ни журнал аудита Keystone, ни фильтр аудита нельзя включить снаружи charm, и ничто здесь не доходит до событий безопасности.

## Red Hat OpenStack on OpenShift

Его Telemetry Operator запускает экспортёр Prometheus для Ceilometer и стек мониторинга с Alertmanager в OpenShift. Пресет OpenShift агента для Kubernetes следит за плоскостью управления, а экспортёр Ceilometer сообщает, что делают вычислительные узлы.

### Пересылка сработавшего в Red Hat OpenStack on OpenShift

Если у `MetricStorage` включён `alertingEnabled` и вы написали или применили правила, примените получателя, который подхватит стек мониторинга:

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

### Чтение API и плоскости управления

Откройте **OpenStack → Все облака**, нажмите **Подключить облако** и укажите адрес Keystone, application credential и зонд. Зонд общается с облаком только по HTTPS. Затем следуйте **Kubernetes → Документация** для кластера, на котором работает плоскость управления, выбрав **Red Hat OpenShift**, что задаёт `preset=openshift`.

Чтобы журналы этих служб попадали и на страницу **Журналы** этого облака, причём каждый stack trace как одна запись, укажите облако в значениях агента вместе с пространствами имён, в которых работают его службы:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Чтение вычислительных узлов через Ceilometer

Зонд сообщает, что выделено, а не что занято. Чтобы читать реальное использование, запустите агент на машине, которая достаёт до вычислительных узлов, указав в `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` каждый узел на порту Ceilometer, `9101`.

### Кто что сделал в Red Hat OpenStack on OpenShift

Журнал аудита Keystone и фильтр аудита на каждом API попадают в [События безопасности](/docs/telemetry/openstack#кто-что-сделал). Каждый пишет в собственный журнал службы, без потребителя на шине. OneUptime читает их оттуда, когда включено **Искать события безопасности в логах**, в разделе **События безопасности → Подключения**. Агент для Kubernetes читает оба из журналов подов, если облако названо в его значениях.

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

Так отправляется строка на каждый вход, которую читает **OpenStack admin credential used from a new address**. Чтобы отправлять только неудачные входы, добавьте `identity.authenticate.success` в `notification_opt_out`, и тогда это обнаружение будет читать то, что увидел фильтр аудита.

Чтобы узнать, кто что сделал через Nova и Neutron: каждый принимает настройку фильтра в своём `customServiceConfig`, а свой paste-файл в `defaultConfigOverwrite`. Операторы Cinder и Glance не принимают paste-файл, поэтому до них здесь ничего не доходит.

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

StackLight уже следит за службами OpenStack, MariaDB, Memcached, RabbitMQ и libvirt по собственным правилам оповещений. Сначала перешлите его оповещения, затем зонд читает API.

### Пересылка сработавшего в Mirantis MOSK

StackLight поставляет правила оповещений, поэтому это работает с первого часа. Добавьте получателя и его маршрут в значения StackLight. Документация Mirantis показывает другие получатели, а не webhook, и на MOSK это не запускалось:

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

### Чтение API

Откройте **OpenStack → Все облака**, нажмите **Подключить облако** и укажите адрес Keystone, application credential и зонд. Зонд общается с облаком только по HTTPS.

### Кто что сделал в Mirantis MOSK

Чтобы узнать, кто что сделал через Nova, Neutron, Cinder и Glance: у MOSK для этого есть собственная настройка, с уже установленным фильтром аудита. С драйвером log каждая служба пишет в свой стандартный вывод, а агент для Kubernetes читает его из журналов подов, если облако названо в его значениях. Каждая пишет в собственный журнал службы, без потребителя на шине. OneUptime читает их оттуда, когда включено **Искать события безопасности в логах**, в разделе **События безопасности → Подключения**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

Эта настройка не охватывает Keystone. Его собственный журнал аудита использует `spec:services`, которое Mirantis не проверяет и за которое не отвечает, поэтому взвесьте это с учётом договора поддержки:

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

Так отправляется строка на каждый вход, которую читает **OpenStack admin credential used from a new address**. Чтобы отправлять только неудачные входы, добавьте `identity.authenticate.success` в `notification_opt_out`, и тогда это обнаружение будет читать то, что увидел фильтр аудита.

## Используйте экспортёр, который уже работает

Никаких учётных данных и ничего нового запускать не нужно: агент может читать экспортёр, который у вас уже есть. Как именно, зависит от того, как он запущен.

- **С `--multi-cloud`,** как запускается собственный экспортёр агента: задайте `OPENSTACK_EXPORTER_ADDRESS`, и агент запрашивает у него по одной службе за раз на `/probe`.
- **Без него,** как запускаются экспортёр Kolla-Ansible и charm Canonical: `/probe` у него нет, поэтому задайте `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`, и агент запрашивает у него всё сразу на `/metrics`, каждые 2 минуты.

В Kolla-Ansible это его внутренний VIP на порту `9198`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Это чтение идёт сверх того, что собственный Prometheus Kolla-Ansible опрашивает каждую минуту. Kolla-Ansible закрепляет экспортёр 1.7.0, и его ответ содержит меньше, чем у экспортёра, закреплённого агентом. Вот чего не хватало страницам на пяти реальных облаках, и тест сверяет это с записями:

| Чего не хватает | Почему | Во что это обходится |
| --- | --- | --- |
| Всего, что относится к Cinder | Он запрашивает у каталога `volumev3` и не находит такого там, где Cinder зарегистрирован как `block-storage` | **Тома** и **Пулы хранения** остаются пустыми, а в **Сервисы** нет Block Storage API, `cinder-volume` и `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** и **Volume Stuck** молчат |
| Сколько экземпляров держит гипервизор и его агрегаты | Список гипервизоров Nova завершается ошибкой на новейшей микроверсии, которую запрашивает Kolla-Ansible | Эти два значения в **Гипервизоры** и то, что потеря хоста говорит о том, что он забирает с собой. Его vCPU, память и диск на месте: они берутся из Placement |
| Домены | У него нет такого ряда | **Домены** остаётся пустым |
| Статус образа, его видимость и дата создания | У него нет таких меток | Эти столбцы в **Образы**. **Image Stuck** молчит, поэтому образ, застрявший на пути к `active`, остаётся незамеченным |
| MTU сети | У него нет такой метки | Эта строка на странице сети |

Если это вам нужно, используйте вместо него собственный экспортёр агента. Передумать можно позже: облако сохраняет своё имя, кто бы его ни читал.
