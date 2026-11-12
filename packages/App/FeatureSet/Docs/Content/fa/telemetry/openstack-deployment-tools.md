# OpenStack بر اساس ابزار استقرار

هیچ‌کس «OpenStack» را اجرا نمی‌کند. آن‌ها ابزاری را اجرا می‌کنند که OpenStack را مستقر می‌کند، و هر ابزار مسیرها، لاگ‌ها و تصور خودش از آنچه از قبل در حال اجراست را دارد. این صفحه همان چیزی است که راهنمای راه‌اندازی در OneUptime برای هر کدام می‌گوید: **OpenStack** > **مستندات** را باز کنید و به **OpenStack را چگونه مستقر می‌کنید؟** پاسخ دهید.

:::cards
- [هر راهنما تا کجا آزمایش شده](#هر-راهنما-تا-کجا-آزمایش-شده): اول این را بخوانید. راهنمای Kolla-Ansible و راهنمای OpenStack-Ansible روی استقرارهای واقعی اجرا شده‌اند. بقیه اجرا نشده‌اند.
- [آنچه از قبل فعال است را ارسال کنید](#آنچه-از-قبل-فعال-است-را-ارسال-کنید): حوادث از همان ساعت اول، بدون عامل.
- [Kolla-Ansible](#kolla-ansible): exporterهایی را که از قبل اجرا می‌کند بخوانید.
- [OpenStack-Ansible](#openstack-ansible): لاگ‌های Journald، و overrideها در `user_variables.yml`.
- [OpenStack-Helm](#openstack-helm): یک پراب و عامل Kubernetes، و همین‌طور در [Atmosphere](#atmosphere).
- [Canonical Sunbeam](#canonical-sunbeam): Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): پریست OpenShift، و Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): هشدارهای StackLight.
- [از exporterی که از قبل اجرا می‌کنید استفاده کنید](#از-exporterی-که-از-قبل-اجرا-میکنید-استفاده-کنید): صفحه‌ها در 1.7.0 بدون چه چیزی می‌مانند.
:::

## هر راهنما تا کجا آزمایش شده

هر مسیر، پورت و متغیر زیر از سورس یا مستندات خود ابزار خوانده شده است. راهنماهای Kolla-Ansible و OpenStack-Ansible روی استقرارهای واقعی هم دنبال شده‌اند، با دستورهای خودشان و یک جایگزین برای OneUptime که آنچه عامل می‌فرستد را نگه می‌دارد. پس هیچ راهنمایی اینجا از یک استقرار واقعی ابزارش به یک OneUptime در حال اجرا گزارش نداده است. هر کدام با چه چیزی مقایسه شده‌اند:

| ابزار | خوانده شده از | واقعاً اجرا شده |
| --- | --- | --- |
| Kolla-Ansible | سورس آن، در master و `stable/2026.1` | دستورهای این راهنما، روی یک all-in-one واقعی در `stable/2026.1` با Open vSwitch: عامل روی اعتبارنامه **Full view**، بدون Docker، روی exporter خود Kolla-Ansible و روی exporter خودتان در نسخه پین‌شده و در 1.7.0، exporter عامل روی اعتبارنامه **Infrastructure only**، هدف‌های خوانده‌شده از `prometheus.yml` واقعی آن، و پروفایل لاگ‌ها. با توقف واقعی Memcached در آنجا، Alertmanager آن یک webhook با وضعیت firing و سپس یک webhook با وضعیت resolved ارسال کرد، و آنچه ارسال کرد، وقتی به یک OneUptime در حال اجرا فرستاده شد، یک حادثه را روی ابر درست و روی هیچ ابر دیگری باز کرد و آن را حل کرد |
| OpenStack-Ansible | سورس و مستندات آن | دستورهای این راهنما، روی یک all-in-one واقعی در `stable/2026.1`، در کانتینرهای LXC: عامل روی اعتبارنامه **Full view**، exporter عامل روی اعتبارنامه **Infrastructure only** با policy overrideهایش، تنظیمات RabbitMQ و HAProxy همراه با خواندن هر کدام توسط عامل، و پروفایل لاگ‌ها روی journal |
| OpenStack-Helm | مقادیر chart آن | هیچ چیز روی OpenStack-Helm. پراب و عامل Kubernetes هر کدام به‌تنهایی آزمایش شدند |
| Atmosphere | مستندات و سورس آن | هیچ چیز روی Atmosphere. پراب و عامل Kubernetes هر کدام به‌تنهایی آزمایش شدند |
| Canonical Sunbeam | مستندات Canonical، و سورس charmهای آن | هیچ چیز روی Sunbeam. مستندات خود Sunbeam charm مربوط به exporter را ذکر نمی‌کنند |
| Red Hat OpenStack on OpenShift | سورس Telemetry Operator | هیچ چیز روی توزیع Red Hat. پریست OpenShift و exporter مربوط به Ceilometer هر کدام به‌تنهایی آزمایش شدند |
| Mirantis MOSK | مستندات Mirantis، که مثال‌هایش به‌جای webhook گیرنده‌های دیگر را نشان می‌دهند | هیچ چیز روی MOSK |

آنچه **چه کسی چه کرد** در هر راهنما روشن می‌کند روی DevStack ضبط شد، و روی هیچ‌یک از این ابزارها نه. اینکه هر ابزار آن را کجا می‌برد از سورس یا مستندات همان ابزار خوانده شد.

علاوه بر آن‌ها، کل مسیر روی یک OneUptime زنده اجرا شده است، که همان‌طور که Docker Compose آن را شروع می‌کند شروع شد، و روی یک DevStack واقعی و نه روی هیچ‌یک از این ابزارها. عامل، نصب‌شده با دستورهای مستنداتش، ابر را از اولین داده‌اش ثبت کرد، و هر اینستنس، حجم و هایپروایزر ردیفی داشت با وضعیتی که خود ابر به آن داد. با توقف واقعی `nova-compute`، ردیف آن پایین رفت، یک مانیتور از الگوی Compute Service Down حدود ۱۲ دقیقه بعد یک حادثه باز کرد که میزبان را نام می‌برد، و کمتر از یک دقیقه پس از شروع دوباره سرویس آن را حل کرد. پراب یک پروژه همان ابر را از طریق مسیرهای خود داشبورد متصل کرد و ردیف‌هایش را بازخواند، و ۱۱۴ span از یک boot امضاشده در سرویس‌هایش، از پروفایل traces، رسید.

جداگانه، آنچه یک عامل واقعی روی DevStack فرستاد و آنچه Alertmanager مربوط به Kolla-Ansible ارسال کرد ضبط شد، سپس به یک OneUptime زنده فرستاده شد: webhook مربوط به firing یک حادثه را روی ابر درست و هیچ ابر دیگری باز کرد، همان webhook دوباره چیزی باز نکرد، و webhook مربوط به resolved آن را حل کرد.

## آنچه از قبل فعال است را ارسال کنید

هر ابزاری که Alertmanager دارد می‌تواند همین امروز حادثه داشته باشد: هشداری که فعال می‌شود به حادثه تبدیل می‌شود، با on-call و صفحه‌های وضعیت از ساعت اول، و وقتی هشدار حل شود حل می‌شود. چیزی برای نصب نیست، و این در کنار هر چیز دیگر در این صفحه کار می‌کند.

:::steps
### مانیتور را بسازید

یک مانیتور Incoming Request را همان‌طور که [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#دریافت-هشدارها-با-یک-مانیتور) می‌گوید بسازید، و **نشانی ضربان** آن را کپی کنید. آن آدرس `<secret key>` در گیرنده هر ابزار در ادامه است.

### آن را روی ابر قرار دهید

**نمای کلی** > **منابع پیوندشده** مانیتور را باز کنید و ابر OpenStack را اضافه کنید. هر حادثه سپس در صفحه **حوادث** همان ابر است: تنظیمات خود مانیتور Incoming Request هیچ ابری را نام نمی‌برد، پس Alertmanager هر ابر به مانیتور مخصوص خودش نیاز دارد. ابر پس از رسیدن اولین داده‌اش در آن فهرست ظاهر می‌شود، پس این کار را پس از گام‌های زیر انجام دهید، یا ابتدا ابر را زیر **OpenStack** > **همه ابرها** اضافه کنید.
:::

Alertmanager، در نسخه‌ای که Kolla-Ansible پین می‌کند، با همین شکل دقیق ارسال کردنش ضبط شد، و آنچه ارسال کرد روی یک OneUptime در حال اجرا یک حادثه باز کرد، که وضعیت `resolved` خودش آن را حل کرد.

## Kolla-Ansible

با روشن بودن `enable_prometheus` در `/etc/kolla/globals.yml`، که Kolla-Ansible تا وقتی آن را تنظیم نکنید خاموش می‌گذارد، Prometheus، Alertmanager و یک exporter برای هر چیز زیر ابر اجرا می‌کند، و هیچ قاعده هشداری همراه ندارد. این راهنما آنچه آن‌ها اجرا می‌کنند را می‌خواند، به‌جای آنکه نسخه دومی شروع کند.

### آنچه در Kolla-Ansible فعال است را ارسال کنید

فقط اگر قواعد خودتان را نوشته‌اید: Kolla-Ansible هیچ قاعده‌ای همراه ندارد، پس تا وقتی `/etc/kolla/config/prometheus/*.rules` قواعدی نداشته باشد هیچ چیز فعال نمی‌شود. روی میزبانی که از آن مستقر می‌کنید، `/etc/kolla/config/prometheus/prometheus-alertmanager.yml` را بنویسید، که Kolla-Ansible به‌جای فایل خودش آن را می‌خواند، و اعمالش کنید:

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

### اعتبارنامه در Kolla-Ansible

با `source /etc/kolla/admin-openrc.sh`، که `kolla-ansible post-deploy` آن را می‌نویسد، به‌عنوان admin وارد شوید.

- **Full view** به یک تغییر نیاز دارد، در Cinder. templateهای Kolla-Ansible از قبل `service_type` را زیر `[keystone_authtoken]` در Nova، Neutron، Glance و Placement تنظیم می‌کنند، اما Cinder آن `volume` می‌گوید و کاتالوگش `block-storage`، و keystonemiddleware اعتبارنامه‌ای را که با قواعد دسترسی محدود شده با `401` رد می‌کند مگر اینکه این دو یکی باشند. `service_type = block-storage` را زیر `[keystone_authtoken]` در `/etc/kolla/config/cinder.conf` اضافه کنید، سپس `kolla-ansible reconfigure -i <inventory> --tags cinder` را اجرا کنید.
- **Infrastructure only** overrideهایش را در `/etc/kolla/config/nova/policy.yaml` می‌گیرد، و همین برای `neutron`، `keystone` و `placement`، ادغام‌شده با هر چیزی که از قبل آنجا هست. آن‌ها را با `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement` اعمال کنید.

### آنچه ابر Kolla-Ansible بر آن بنا شده را پایش کنید

روی میزبانی که Prometheus مربوط به Kolla-Ansible را اجرا می‌کند، این دستور هدف‌هایش را از فایلی که Kolla-Ansible رندر کرده می‌خواند و آن‌ها را به شکل تنظیمات عامل چاپ می‌کند:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

آنچه چاپ می‌کند را به `.env` عامل اضافه کنید، سپس در پوشه عامل `docker compose up -d` را اجرا کنید. هر exporter روی شبکه API گوش می‌دهد، پس ماشین عامل به مسیری به آنجا نیاز دارد. کارت **Control Plane** ابر سپس می‌گوید هر کدام در چه وضعی است، و صریحاً می‌گوید کدام‌ها پایش نمی‌شوند.

| می‌خواند | پورت | تنظیم |
| --- | --- | --- |
| افزونه Prometheus مربوط به RabbitMQ | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| exporter خود HAProxy | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter، برای OVN و Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **پایگاه‌داده‌های OVN:** Kolla-Ansible از 2026.1 openstack-network-exporter را فقط روی نودهای compute و network اجرا می‌کند، و پایگاه‌داده OVN از میزبانی که روی آن اجرا می‌شود خوانده می‌شود. اگر نودهای control شما هیچ‌کدام نیستند، آن‌ها را زیر `[prometheus-openstack-network-exporter:children]` در inventory خود اضافه کنید و reconfigure کنید، وگرنه پایگاه‌داده‌های Northbound و Southbound به‌صورت پایش‌نشده خوانده می‌شوند.
- **پیش از 2026.1** هیچ network exporter وجود ندارد، پس OVN و Open vSwitch به‌صورت پایش‌نشده خوانده می‌شوند.

### لاگ‌های سرویس در Kolla-Ansible

پروفایل لاگ‌های عامل روی هر نود اجرا می‌شود و فایل‌های Kolla-Ansible را می‌خواند. این همان چیزی است که یک خط را به صفحه‌های ابر وصل می‌کند:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Fluentd خود Kolla هم می‌تواند ارسال کند، با یک output در `/etc/kolla/config/fluentd/output/*.conf` همان‌طور که [Fluentd](/docs/telemetry/fluentd) شرح می‌دهد، اما آن رکوردها زیر نام یک سرویس به **لاگ‌ها** می‌رسند، و نه به صفحه‌های ابر.

### چه کسی چه کرد در Kolla-Ansible

ردپای ممیزی Keystone و فیلتر ممیزی روی هر API، به [رویدادهای امنیتی](/docs/telemetry/openstack#چه-کسی-چه-کرد). هر کدام در لاگ خود سرویس می‌نویسد، بدون هیچ مصرف‌کننده‌ای روی bus. OneUptime آن‌ها را از همان‌جا می‌خواند، وقتی **یافتن رویدادهای امنیتی در لاگ‌های شما** روشن باشد، زیر **رویدادهای امنیتی** > **اتصال‌ها**. پروفایل لاگ‌های عامل هر دو را از `/var/log/kolla` می‌خواند.

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

این برای هر ورود یک خط می‌فرستد، که **OpenStack admin credential used from a new address** آن را می‌خواند. برای فرستادن فقط ورودهای ناموفق، `identity.authenticate.success` را به `notification_opt_out` اضافه کنید، و آن تشخیص سپس آنچه فیلتر ممیزی دیده را می‌خواند.

برای اینکه بدانید چه کسی چه کرد از طریق Nova، Neutron، Cinder و Glance، فیلتر ممیزی به یک تنظیم نیاز دارد، که یک‌جا در پیکربندی همه سرویس‌ها می‌رود:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

همچنین به یک فایل paste نیاز دارد، و taskهای config مربوط به Kolla-Ansible هیچ فایل paste برای این سرویس‌ها کپی نمی‌کنند. فایل خودتان را روی هر میزبان API بگذارید، و با `nova_api_extra_volumes`، `neutron_server_extra_volumes`، `cinder_api_extra_volumes` و `glance_api_extra_volumes` در `globals.yml` آن را روی فایل داخل image mount کنید. فایل‌های map مربوط به pyCADF در image در `/var/lib/kolla/venv/etc/pycadf` هستند. [چه کسی چه کرد](/docs/telemetry/openstack#فیلتر-ممیزی-را-روشن-کنید) خطوط فیلتر را دارد.

## OpenStack-Ansible

OpenStack-Ansible لاگ‌های سرویس‌هایش را در journald نگه می‌دارد و Prometheus مخصوص خودش را اجرا نمی‌کند، پس عامل راه ورود است، و لاگ‌ها مسیر مخصوص خودشان را دارند.

### اعتبارنامه در OpenStack-Ansible

از کانتینر utility به‌عنوان admin وارد شوید: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`، سپس `. ~/openrc`. `curl` ندارد، که دستورهای زیر از آن استفاده می‌کنند، پس ابتدا `apt-get install -y curl` را آنجا اجرا کنید.

- **Full view** به یک تغییر نیاز دارد، در Cinder. roleهای OpenStack-Ansible از قبل `service_type` را زیر `[keystone_authtoken]` تنظیم می‌کنند، اما Cinder آن `volumev3` می‌گوید و کاتالوگش `block-storage`، و keystonemiddleware اعتبارنامه‌ای را که با قواعد دسترسی محدود شده با `401` رد می‌کند مگر اینکه این دو یکی باشند. `service_type: block-storage` را زیر `keystone_authtoken` در `cinder_cinder_conf_overrides` در `/etc/openstack_deploy/user_variables.yml` تنظیم کنید، سپس `openstack-ansible openstack.osa.cinder --tags cinder-config` را اجرا کنید.
- **Infrastructure only** overrideهایش را به‌صورت `nova_policy_overrides`، `neutron_policy_overrides`، `keystone_policy_overrides` و `placement_policy_overrides` در `/etc/openstack_deploy/user_variables.yml` می‌گیرد. هر کدام را با playbook و tag مخصوص خودش اعمال کنید، مانند `openstack-ansible openstack.osa.nova --tags nova-policy-override`. برداشتن بعدی یکی از آن‌ها به‌جای هیچ، یک فایل خالی به جا می‌گذارد، پس چیزی شکست نمی‌خورد.

### آنچه ابر OpenStack-Ansible بر آن بنا شده را پایش کنید

OpenStack-Ansible برای این‌ها هیچ exporterی اجرا نمی‌کند، پس فقط آنچه روشن کنید پایش می‌شود.

**RabbitMQ:** افزونه Prometheus آن را روشن کنید، سپس آدرس هر کانتینر را روی `15692` به‌صورت `OPENSTACK_RABBITMQ_TARGETS` در `.env` عامل نام ببرید:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** exporter آن خاموش است، و listener آمارش روی `127.0.0.1` با TLS است، که عامل نمی‌تواند بخواند. آن را جایی روشن کنید که عامل بتواند، سپس آن آدرس را روی `1936` به‌صورت `OPENSTACK_HAPROXY_TARGETS` نام ببرید:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB و Memcached:** OpenStack-Ansible برای هیچ‌کدام exporter ندارد. [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) و [memcached_exporter](https://github.com/prometheus/memcached_exporter) را خودتان اجرا کنید و آن‌ها را به‌صورت `OPENSTACK_MARIADB_TARGETS` و `OPENSTACK_MEMCACHED_TARGETS` نام ببرید، یا کنارشان بگذارید: کارت **Control Plane** ابر آن‌گاه می‌گوید پایش نمی‌شوند، نه اینکه سالم‌اند.

### لاگ‌های سرویس در OpenStack-Ansible

از journald، روی هر میزبانی که سرویسی را اجرا می‌کند: کانتینرها journalهایشان را به میزبان منتقل می‌کنند.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

این پروفایل لاگ‌های عامل را به‌صورت سرویس systemd اجرا می‌کند، و `/var/log/journal/` را می‌خواند، جایی که journalهای کانتینرهای OpenStack-Ansible می‌رسند.

### چه کسی چه کرد در OpenStack-Ansible

ردپای ممیزی Keystone و فیلتر ممیزی روی هر API، به [رویدادهای امنیتی](/docs/telemetry/openstack#چه-کسی-چه-کرد). هر کدام در لاگ خود سرویس می‌نویسد، بدون هیچ مصرف‌کننده‌ای روی bus. OneUptime آن‌ها را از همان‌جا می‌خواند، وقتی **یافتن رویدادهای امنیتی در لاگ‌های شما** روشن باشد، زیر **رویدادهای امنیتی** > **اتصال‌ها**. پروفایل لاگ‌های عامل هر دو را از journal می‌خواند.

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

این برای هر ورود یک خط می‌فرستد، که **OpenStack admin credential used from a new address** آن را می‌خواند. برای فرستادن فقط ورودهای ناموفق، `identity.authenticate.success` را به `notification_opt_out` اضافه کنید، و آن تشخیص سپس آنچه فیلتر ممیزی دیده را می‌خواند. مقدار دوم `notification_opt_out` به‌صورت یک set در YAML وارد می‌شود، همان‌طور که [config_template آن](https://docs.openstack.org/ansible-config_template/latest/) یک کلید تکراری را می‌نویسد.

برای اینکه بدانید چه کسی چه کرد از طریق Nova، Neutron، Cinder و Glance، هر API تنظیم فیلتر را در conf overrideهای خود می‌گیرد، و خود فیلتر را در paste overrideهایش، با `audit` درست پس از `authtoken` و فیلتر context که در هر pipeline پس از آن می‌آید. مال Nova، و همین در `neutron_neutron_conf_overrides` و `neutron_api_paste_ini_overrides`، `cinder_cinder_conf_overrides` و `cinder_api_paste_ini_overrides`، و `glance_glance_api_conf_overrides` و `glance_glance_api_paste_ini_overrides`:

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

OpenStack-Helm chartهایی برای Prometheus، Alertmanager و exporterها ارائه می‌دهد، و اینکه در حال اجرا باشند با شماست. control plane آن در Kubernetes اجرا می‌شود، پس یک پراب APIها را می‌خواند و عامل Kubernetes podها را می‌بیند.

### آنچه در OpenStack-Helm فعال است را ارسال کنید

اگر chart مربوط به prometheus-alertmanager آن را اجرا می‌کنید، گیرنده را زیر `conf.alertmanager` در مقادیر chart اضافه کنید، و route خود را به آن بفرستید:

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

### APIها را بخوانید و podها را در OpenStack-Helm ببینید

**OpenStack** > **همه ابرها** را باز کنید، روی **اتصال ابر** کلیک کنید، و آدرس Keystone، یک application credential و پرابی که باید استفاده شود را به آن بدهید. پراب فقط با HTTPS با ابر صحبت می‌کند. سپس **Kubernetes** > **مستندات** را برای کلاستری که chartها روی آن اجرا می‌شوند دنبال کنید: podها، لاگ‌هایشان و نودهایشان به صفحه‌های Kubernetes می‌رسند.

برای اینکه لاگ‌های آن سرویس‌ها در صفحه **لاگ‌ها**ی این ابر هم باشند، با هر stack trace به‌صورت یک رکورد، ابر را در مقادیر عامل نام ببرید، همراه با namespaceهایی که سرویس‌هایش در آن اجرا می‌شوند:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### چه کسی چه کرد در OpenStack-Helm

ردپای ممیزی Keystone و فیلتر ممیزی روی هر API، به [رویدادهای امنیتی](/docs/telemetry/openstack#چه-کسی-چه-کرد). هر کدام در لاگ خود سرویس می‌نویسد، بدون هیچ مصرف‌کننده‌ای روی bus. OneUptime آن‌ها را از همان‌جا می‌خواند، وقتی **یافتن رویدادهای امنیتی در لاگ‌های شما** روشن باشد، زیر **رویدادهای امنیتی** > **اتصال‌ها**. عامل Kubernetes هر دو را از لاگ‌های podها می‌خواند، با ابری که در مقادیرش نام برده شده است.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

این برای هر ورود یک خط می‌فرستد، که **OpenStack admin credential used from a new address** آن را می‌خواند. برای فرستادن فقط ورودهای ناموفق، `identity.authenticate.success` را به `notification_opt_out` اضافه کنید، و آن تشخیص سپس آنچه فیلتر ممیزی دیده را می‌خواند.

`logging.conf` یک chart لاگر root را روی `WARNING` نگه می‌دارد، و log driver زیر لاگر مخصوص خودش می‌نویسد، پس بدون لاگری برای آن چیزی نوشته نمی‌شود. یک فهرست در values جایگزین فهرست chart می‌شود، پس `keys` آنچه را که chart دارد نگه می‌دارد، به‌علاوه این:

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

برای اینکه بدانید چه کسی چه کرد از طریق Nova، Neutron و Cinder، `conf.paste` در chartهایشان از قبل فیلتر ممیزی را در هر pipeline دارد، و باید به آن گفت کجا بنویسد. هر کدام همان لاگر را در `conf.logging` لازم دارند. chart مربوط به Glance map را دارد، و نه فیلتر را و نه جایی برای آن در pipelineهایش: هر دو را به `conf.paste` آن اضافه کنید.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere کیت kube-prometheus-stack را با قواعد هشدار خودش اجرا می‌کند، و Loki را با Vector برای لاگ‌ها. ابتدا هشدارهایش را ارسال کنید، سپس یک پراب APIها را می‌خواند و عامل Kubernetes podها را می‌بیند.

### آنچه در Atmosphere فعال است را ارسال کنید

Atmosphere قواعد هشداری دارد که واقعاً آدم‌ها را بیدار کرده‌اند، پس این از ساعت اول کار می‌کند. گیرنده را به پیکربندی Atmosphere خود اضافه کنید، کنار هر گیرنده‌ای که از قبل دارید، و مستقر کنید:

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

### APIها را بخوانید و podها را در Atmosphere ببینید

**OpenStack** > **همه ابرها** را باز کنید، روی **اتصال ابر** کلیک کنید، و آدرس Keystone، یک application credential و پرابی که باید استفاده شود را به آن بدهید. پراب فقط با HTTPS با ابر صحبت می‌کند. سپس **Kubernetes** > **مستندات** را برای کلاستری که Atmosphere روی آن اجرا می‌شود دنبال کنید.

برای اینکه لاگ‌های آن سرویس‌ها در صفحه **لاگ‌ها**ی این ابر هم باشند، با هر stack trace به‌صورت یک رکورد، ابر را در مقادیر عامل نام ببرید، همراه با namespaceهایی که سرویس‌هایش در آن اجرا می‌شوند:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### چه کسی چه کرد در Atmosphere

ردپای ممیزی Keystone و فیلتر ممیزی روی هر API، به [رویدادهای امنیتی](/docs/telemetry/openstack#چه-کسی-چه-کرد). هر کدام در لاگ خود سرویس می‌نویسد، بدون هیچ مصرف‌کننده‌ای روی bus. OneUptime آن‌ها را از همان‌جا می‌خواند، وقتی **یافتن رویدادهای امنیتی در لاگ‌های شما** روشن باشد، زیر **رویدادهای امنیتی** > **اتصال‌ها**. عامل Kubernetes هر دو را از لاگ‌های podها می‌خواند، با ابری که در مقادیرش نام برده شده است.

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

این برای هر ورود یک خط می‌فرستد، که **OpenStack admin credential used from a new address** آن را می‌خواند. برای فرستادن فقط ورودهای ناموفق، `identity.authenticate.success` را به `notification_opt_out` اضافه کنید، و آن تشخیص سپس آنچه فیلتر ممیزی دیده را می‌خواند.

برای اینکه بدانید چه کسی چه کرد از طریق Nova، Neutron و Cinder، chartهایی که Atmosphere مستقر می‌کند از قبل فیلتر ممیزی را در هر pipeline دارند، و باید به آن گفت کجا بنویسد، در `nova_helm_values`، `neutron_helm_values` و `cinder_helm_values`. chart مربوط به Glance نه فیلتر را دارد و نه جایی برای آن در pipelineهایش: هر دو را به `conf.paste` آن اضافه کنید، در `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam می‌تواند Canonical Observability Stack را با `sunbeam enable observability embedded` مستقر کند. Canonical یک charm به نام `openstack-exporter` هم دارد، که اگر آن را اجرا کنید عامل می‌تواند بخواند. مستندات خود Sunbeam این charm را ذکر نمی‌کنند، و هیچ چیز اینجا روی Sunbeam اجرا نشده است.

### آنچه در Sunbeam فعال است را ارسال کنید

اگر Canonical Observability Stack را اجرا می‌کنید، به Alertmanager آن پیکربندی‌ای بدهید که گیرنده در آن باشد:

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

### charm مربوط به exporter

اگر charm مربوط به `openstack-exporter` از Canonical را اجرا می‌کنید، عامل می‌تواند آن را بدون اعتبارنامه‌ای مخصوص خودش بخواند. یک ابر را روی `/metrics` پاسخ می‌دهد، روی پورت `9180` مگر اینکه تنظیم `port` آن را تغییر داده باشید. آدرسش را با `juju status openstack-exporter` پیدا کنید:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

اینکه کدام سری‌ها را می‌گوید به انتشار exporter در snap آن بستگی دارد، که اینجا ثبت نشد: `bash troubleshoot.sh` می‌گوید ابر را می‌خواند یا نه.

### لاگ‌های سرویس در Sunbeam

با روشن بودن observability، Loki مربوط به stack لاگ‌های سرویس‌ها را نگه می‌دارد. OneUptime راهی برای خواندن Loki ندارد، و پروفایل لاگ‌های عامل روی charmهای Sunbeam امتحان نشده، پس هنوز هیچ چیز اینجا آن‌ها را جمع‌آوری نمی‌کند.

### چه کسی چه کرد در Sunbeam

هنوز نه. charmهای Sunbeam پیکربندی هر سرویس را از templateهای خودشان می‌نویسند، و charm مربوط به Keystone آن تنظیمی برای اینکه اعلان‌ها کجا بروند ندارد. پس نه ردپای ممیزی Keystone و نه فیلتر ممیزی را نمی‌توان از بیرون charm روشن کرد، و هیچ چیز اینجا به Security Events نمی‌رسد.

## Red Hat OpenStack on OpenShift

Telemetry Operator آن exporter مربوط به Prometheus در Ceilometer و یک monitoring stack با Alertmanager را روی OpenShift اجرا می‌کند. پریست OpenShift عامل Kubernetes control plane را پایش می‌کند، و exporter مربوط به Ceilometer می‌گوید نودهای compute چه می‌کنند.

### آنچه در Red Hat OpenStack on OpenShift فعال است را ارسال کنید

اگر `MetricStorage` مقدار `alertingEnabled` دارد و قواعدی نوشته یا اعمال کرده‌اید، گیرنده‌ای را اعمال کنید که monitoring stack برمی‌دارد:

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

### APIها و control plane را بخوانید

**OpenStack** > **همه ابرها** را باز کنید، روی **اتصال ابر** کلیک کنید، و آدرس Keystone، یک application credential و پرابی که باید استفاده شود را به آن بدهید. پراب فقط با HTTPS با ابر صحبت می‌کند. سپس **Kubernetes** > **مستندات** را روی کلاستری که control plane را اجرا می‌کند دنبال کنید، با انتخاب **Red Hat OpenShift**، که `preset=openshift` را تنظیم می‌کند.

برای اینکه لاگ‌های آن سرویس‌ها در صفحه **لاگ‌ها**ی این ابر هم باشند، با هر stack trace به‌صورت یک رکورد، ابر را در مقادیر عامل نام ببرید، همراه با namespaceهایی که سرویس‌هایش در آن اجرا می‌شوند:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### نودهای compute را از طریق Ceilometer بخوانید

پراب می‌گوید چه چیزی تخصیص یافته، نه اینکه چه چیزی مشغول است. برای خواندن مصرف واقعی، عامل را روی ماشینی اجرا کنید که به نودهای compute دسترسی دارد، با `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` که هر نود را روی پورت Ceilometer، یعنی `9101`، نام می‌برد.

### چه کسی چه کرد در Red Hat OpenStack on OpenShift

ردپای ممیزی Keystone و فیلتر ممیزی روی هر API، به [رویدادهای امنیتی](/docs/telemetry/openstack#چه-کسی-چه-کرد). هر کدام در لاگ خود سرویس می‌نویسد، بدون هیچ مصرف‌کننده‌ای روی bus. OneUptime آن‌ها را از همان‌جا می‌خواند، وقتی **یافتن رویدادهای امنیتی در لاگ‌های شما** روشن باشد، زیر **رویدادهای امنیتی** > **اتصال‌ها**. عامل Kubernetes هر دو را از لاگ‌های podها می‌خواند، با ابری که در مقادیرش نام برده شده است.

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

این برای هر ورود یک خط می‌فرستد، که **OpenStack admin credential used from a new address** آن را می‌خواند. برای فرستادن فقط ورودهای ناموفق، `identity.authenticate.success` را به `notification_opt_out` اضافه کنید، و آن تشخیص سپس آنچه فیلتر ممیزی دیده را می‌خواند.

برای اینکه بدانید چه کسی چه کرد از طریق Nova و Neutron، هر کدام تنظیم فیلتر را در `customServiceConfig` خود می‌گیرند، و فایل paste آن را در `defaultConfigOverwrite`. operatorهای Cinder و Glance هیچ فایل paste نمی‌گیرند، پس هیچ چیز اینجا به آن‌ها نمی‌رسد.

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

StackLight از قبل سرویس‌های OpenStack، MariaDB، Memcached، RabbitMQ و libvirt را با قواعد هشدار خودش پایش می‌کند. ابتدا هشدارهایش را ارسال کنید، سپس یک پراب APIها را می‌خواند.

### آنچه در Mirantis MOSK فعال است را ارسال کنید

StackLight قواعد هشدار همراه دارد، پس این از ساعت اول کار می‌کند. گیرنده و route آن را به مقادیر StackLight خود اضافه کنید. مستندات Mirantis به‌جای webhook گیرنده‌های دیگر را نشان می‌دهند، و این روی MOSK اجرا نشده است:

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

### APIها را بخوانید

**OpenStack** > **همه ابرها** را باز کنید، روی **اتصال ابر** کلیک کنید، و آدرس Keystone، یک application credential و پرابی که باید استفاده شود را به آن بدهید. پراب فقط با HTTPS با ابر صحبت می‌کند.

### چه کسی چه کرد در Mirantis MOSK

برای اینکه بدانید چه کسی چه کرد از طریق Nova، Neutron، Cinder و Glance، MOSK تنظیم مخصوص خودش را دارد، با فیلتر ممیزی که از قبل سر جایش است. با log driver، هر سرویس در standard output خود می‌نویسد، و عامل Kubernetes آن را از لاگ‌های podها می‌خواند، با ابری که در مقادیرش نام برده شده است. هر کدام در لاگ خود سرویس می‌نویسد، بدون هیچ مصرف‌کننده‌ای روی bus. OneUptime آن‌ها را از همان‌جا می‌خواند، وقتی **یافتن رویدادهای امنیتی در لاگ‌های شما** روشن باشد، زیر **رویدادهای امنیتی** > **اتصال‌ها**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

آن تنظیم Keystone را پوشش نمی‌دهد. ردپای ممیزی خودش `spec:services` را می‌گیرد، که Mirantis آن را اعتبارسنجی نمی‌کند و مسئولیتی در قبالش نمی‌پذیرد، پس این را با قرارداد پشتیبانی خود بسنجید:

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

این برای هر ورود یک خط می‌فرستد، که **OpenStack admin credential used from a new address** آن را می‌خواند. برای فرستادن فقط ورودهای ناموفق، `identity.authenticate.success` را به `notification_opt_out` اضافه کنید، و آن تشخیص سپس آنچه فیلتر ممیزی دیده را می‌خواند.

## از exporterی که از قبل اجرا می‌کنید استفاده کنید

بدون اعتبارنامه و بدون چیز تازه‌ای برای اجرا: عامل می‌تواند exporterی را که از قبل دارید بخواند. چگونگی آن به نحوه شروع آن بستگی دارد.

- **با `--multi-cloud`،** همان‌طور که exporter خود عامل اجرا می‌شود: `OPENSTACK_EXPORTER_ADDRESS` را تنظیم کنید، و عامل هر بار یک سرویس را روی `/probe` از آن می‌پرسد.
- **بدون آن،** همان‌طور که exporter مربوط به Kolla-Ansible و charm مربوط به Canonical اجرا می‌شوند: `/probe` ندارد، پس `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` را تنظیم کنید، و عامل همه چیز را یک‌جا روی `/metrics` از آن می‌پرسد، هر ۲ دقیقه.

در Kolla-Ansible این VIP داخلی آن روی `9198` است:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

این خواندن علاوه بر Prometheus خود Kolla-Ansible است که هر دقیقه می‌پرسد. Kolla-Ansible نسخه 1.7.0 exporter را پین می‌کند، و پاسخ آن هم کمتر از exporterی می‌گوید که عامل پین می‌کند. این همان چیزی است که صفحه‌ها روی پنج ابر واقعی بدون آن ماندند، و یک تست آن را به همان ضبط‌ها پایبند نگه می‌دارد:

| بدون این می‌ماند | چون | چه هزینه‌ای دارد |
| --- | --- | --- |
| همه چیز مربوط به Cinder | از کاتالوگ `volumev3` را می‌خواهد، و جایی که Cinder به‌عنوان `block-storage` ثبت می‌شود چنین چیزی نمی‌یابد | **حجم‌ها** و **Storage pools** خالی می‌مانند، و **سرویس‌ها** هیچ Block Storage API، `cinder-volume` یا `cinder-scheduler` ندارد. **Block Storage API Down**، **Block Storage Service Down**، **Storage Pool Warning**، **Storage Pool Critical**، **Volumes in Error** و **Volume Stuck** ساکت می‌مانند |
| اینکه یک هایپروایزر چند اینستنس دارد، و aggregateهایش | فهرست هایپروایزرهای Nova در جدیدترین microversion، که Kolla-Ansible می‌خواهد، شکست می‌خورد | آن دو مورد در **هایپروایزرها**، و آنچه یک میزبان ازدست‌رفته می‌گوید با خود می‌برد. vCPUها، حافظه و دیسک آن همچنان هستند: از Placement می‌آیند |
| دامنه‌ها | چنین سری‌ای ندارد | **دامنه‌ها** خالی می‌ماند |
| وضعیت، قابلیت دید و تاریخ ساخت یک ایمیج | چنین labelهایی ندارد | آن ستون‌ها در **ایمیج‌ها**. **Image Stuck** ساکت می‌ماند، پس ایمیجی که در مسیر `active` شدن گیر کرده بی‌خبر می‌ماند |
| MTU یک شبکه | چنین labelی ندارد | آن خط در صفحه یک شبکه |

اگر به این‌ها نیاز دارید، به‌جایش از exporter خود عامل استفاده کنید. بعداً می‌توانید نظرتان را عوض کنید: یک ابر نامش را نگه می‌دارد، هر کدام که آن را بخوانند.
