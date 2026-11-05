# डिप्लॉयमेंट टूल के अनुसार OpenStack

कोई भी "OpenStack" नहीं चलाता। लोग वह टूल चलाते हैं जो उसे डिप्लॉय करता है, और हर टूल के अपने पाथ, अपने लॉग और इस बारे में अपनी समझ होती है कि क्या पहले से चल रहा है। यह पेज वही है जो OneUptime की सेटअप गाइड हर टूल के लिए कहती है: **OpenStack → सभी क्लाउड** खोलें, क्लाउड कनेक्ट करें, और **आप OpenStack कैसे डिप्लॉय करते हैं?** का जवाब दें।

:::cards
- [हर गाइड को कितना परखा गया है](#हर-गाइड-को-कितना-परखा-गया-है): इसे पहले पढ़ें। Kolla-Ansible और OpenStack-Ansible की गाइड असली डिप्लॉयमेंट पर चलाई गई हैं। बाकी की नहीं।
- [जो पहले से फ़ायर हो रहा है उसे फ़ॉरवर्ड करें](#जो-पहले-से-फ़ायर-हो-रहा-है-उसे-फ़ॉरवर्ड-करें): पहले घंटे से घटनाएं, बिना किसी एजेंट के।
- [Kolla-Ansible](#kolla-ansible): जो एक्सपोर्टर वह पहले से चलाता है उन्हें पढ़ें।
- [OpenStack-Ansible](#openstack-ansible): Journald लॉग, और `user_variables.yml` में ओवरराइड।
- [OpenStack-Helm](#openstack-helm): एक प्रोब, और [Atmosphere](#atmosphere) के लिए Kubernetes एजेंट।
- [Canonical Sunbeam](#canonical-sunbeam): Canonical Observability Stack।
- [OpenShift पर Red Hat OpenStack](#openshift-पर-red-hat-openstack): OpenShift प्रीसेट, और Ceilometer।
- [Mirantis MOSK](#mirantis-mosk): StackLight के अलर्ट।
- [जो एक्सपोर्टर आप पहले से चलाते हैं उसी का उपयोग करें](#जो-एक्सपोर्टर-आप-पहले-से-चलाते-हैं-उसी-का-उपयोग-करें): 1.7.0 पर पेज किसके बिना रहते हैं।
:::

## हर गाइड को कितना परखा गया है

नीचे का हर पाथ, पोर्ट और वेरिएबल टूल के अपने सोर्स या डॉक्स से पढ़ा गया है। जो रिग OneUptime की फ़िक्स्चर रिकॉर्ड करती है वह CI रनर पर Kolla-Ansible और OpenStack-Ansible भी डिप्लॉय करती है, और वहाँ उनकी गाइड के अपने कमांड चलाती है, OneUptime के एक स्टैंड-इन के साथ जो एजेंट का भेजा हुआ रख लेता है। इसलिए यहाँ किसी भी गाइड ने अपने टूल के असली डिप्लॉयमेंट से चलते हुए OneUptime को रिपोर्ट नहीं किया है। हर एक को किसके विरुद्ध जाँचा गया है:

| टूल | कहाँ से पढ़ा गया | असल में चलाया गया |
| --- | --- | --- |
| Kolla-Ansible | उसका सोर्स, master और `stable/2026.1` पर | इस गाइड के कमांड, `stable/2026.1` पर Open vSwitch वाले असली ऑल-इन-वन पर: पहले क्रेडेंशियल पर एजेंट, Docker के बिना, Kolla-Ansible के अपने एक्सपोर्टर पर और आपके अपने पर पिन किए गए संस्करण और 1.7.0 दोनों पर, दूसरे क्रेडेंशियल पर एक्सपोर्टर, उसकी असली `prometheus.yml` से पढ़े गए टारगेट, और लॉग प्रोफ़ाइल। वहाँ Memcached को सचमुच रोकने पर उसके Alertmanager ने पहले firing वेबहुक और फिर resolved वेबहुक पोस्ट किया, और उसने जो पोस्ट किया, उसे चलते हुए OneUptime को भेजने पर उसने सही क्लाउड पर, और किसी दूसरे पर नहीं, एक घटना खोली और उसे हल किया |
| OpenStack-Ansible | उसका सोर्स और डॉक्स | इस गाइड के कमांड, `stable/2026.1` पर LXC कंटेनरों में असली ऑल-इन-वन पर: पहली क्रेडेंशियल पर एजेंट, दूसरी पर एक्सपोर्टर अपने पॉलिसी ओवरराइड के साथ, RabbitMQ और HAProxy की सेटिंग जिनमें से हर एक को एजेंट ने पढ़ा, और जर्नल पर लॉग प्रोफ़ाइल |
| OpenStack-Helm | उसकी चार्ट वैल्यू | प्रोब और Kubernetes एजेंट, हर एक अलग से |
| Atmosphere | उसके डॉक्स और सोर्स | प्रोब और Kubernetes एजेंट, हर एक अलग से |
| Canonical Sunbeam | Canonical के डॉक्स, और उसके चार्म का सोर्स | Sunbeam पर कुछ नहीं। Sunbeam के अपने डॉक्स एक्सपोर्टर चार्म का ज़िक्र नहीं करते |
| OpenShift पर Red Hat OpenStack | Telemetry Operator का सोर्स | OpenShift प्रीसेट और Ceilometer का एक्सपोर्टर, हर एक अलग से |
| Mirantis MOSK | Mirantis के डॉक्स, जिनके उदाहरण वेबहुक नहीं बल्कि दूसरे रिसीवर दिखाते हैं | MOSK पर कुछ नहीं |

हर गाइड का **किसने क्या किया** किस पर टिका है, यह DevStack पर, रिग जितने रिलीज़ चलाती है उन सब पर रिकॉर्ड किया गया, और इनमें से किसी भी टूल पर नहीं। हर टूल उसे कहाँ ले जाता है, यह उस टूल के सोर्स या डॉक्स से पढ़ा गया।

इनके अलावा, पूरा रास्ता चलते हुए OneUptime पर चला है, जिसे वैसे शुरू किया गया जैसे Docker Compose करता है, इस कोड से बने उसके ऐप और प्रोब के साथ, और असली DevStack पर, इनमें से किसी टूल पर नहीं। इसके डॉक्स के कमांड से इंस्टॉल किए गए एजेंट ने अपने पहले डेटा से क्लाउड रजिस्टर किया, और हर इंस्टेंस, वॉल्यूम और हाइपरवाइज़र की एक पंक्ति थी जिसमें वह स्थिति थी जो क्लाउड ने खुद दी। `nova-compute` के सचमुच रुकने पर उसकी पंक्ति डाउन हो गई, Compute Service Down टेम्पलेट के मॉनिटर ने 746 सेकंड बाद होस्ट का नाम लेती एक घटना खोली, और सेवा के दोबारा शुरू होने के 48 सेकंड बाद वह हल हो गई। एक प्रोजेक्ट के प्रोब ने उसी क्लाउड को डैशबोर्ड के अपने रूट से कनेक्ट किया और उसकी पंक्तियाँ वापस पढ़ीं, और ट्रेस प्रोफ़ाइल से, एक साइन किए गए बूट के 114 स्पैन उसकी सेवाओं में पहुँचे।

अलग से, असली एजेंट और असली Alertmanager ने जो भेजा था वह DevStack पर और टेस्ट क्लस्टर में रिकॉर्ड किया गया, किसी ऐसे क्लाउड पर नहीं जिसे इनमें से कोई टूल डिप्लॉय करता। चलते हुए OneUptime को भेजे जाने पर, फ़ायरिंग वेबहुक ने सही क्लाउड पर एक घटना खोली और किसी और पर नहीं, वही वेबहुक फिर से भेजने पर कुछ नहीं खुला, और रिज़ॉल्व्ड वेबहुक ने उसे हल कर दिया।

## जो पहले से फ़ायर हो रहा है उसे फ़ॉरवर्ड करें

Alertmanager वाला कोई भी टूल आज ही घटनाएं पा सकता है: जो अलर्ट फ़ायर होता है वह घटना बन जाता है, पहले घंटे से ऑन-कॉल और स्टेटस पेज के साथ, और अलर्ट के रिज़ॉल्व होने पर वह भी हल हो जाती है। कुछ इंस्टॉल नहीं करना पड़ता, और यह इस पेज की बाकी हर चीज़ के साथ चलता है।

:::steps
### मॉनिटर बनाएँ

[Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#मॉनिटर-से-अलर्ट-पाएं) जैसा कहता है वैसा Incoming Request मॉनिटर बनाएँ, और उसका **Heartbeat URL** कॉपी करें। नीचे हर टूल के रिसीवर में वही `<secret key>` वाला पता है।

### इसे क्लाउड पर रखें

मॉनिटर के **अवलोकन → लिंक किए गए संसाधन** में OpenStack क्लाउड जोड़ें। फिर हर घटना उस क्लाउड के **घटनाएं** पेज पर होती है: Incoming Request मॉनिटर की अपनी सेटिंग में कोई क्लाउड नहीं होता, इसलिए हर क्लाउड के Alertmanager को अपना मॉनिटर चाहिए। क्लाउड उस सूची में तब दिखता है जब उसका पहला डेटा पहुँच जाता है, इसलिए यह नीचे के चरणों के बाद करें, या पहले **OpenStack → सभी क्लाउड** में क्लाउड जोड़ें।
:::

Alertmanager को ठीक इसी रूप में पोस्ट करते हुए `Tests/Ops/openstack-e2e` में रिकॉर्ड किया गया है, उस संस्करण पर जो Kolla-Ansible पिन करता है, और रिकॉर्डिंग असली मूल्यांकनकर्ता से दोबारा चलती है: हर अलर्ट पर एक घटना, जो उसकी अपनी `resolved` स्थिति से हल होती है।

## Kolla-Ansible

`/etc/kolla/globals.yml` में `enable_prometheus` चालू होने पर, जिसे Kolla-Ansible तब तक बंद रखता है जब तक आप उसे सेट न करें, वह Prometheus, Alertmanager और क्लाउड के नीचे की हर चीज़ के लिए एक एक्सपोर्टर चलाता है, और कोई अलर्ट नियम नहीं देता। यह गाइड वही पढ़ती है जो वे चलाते हैं, दूसरी कॉपी शुरू करने के बजाय।

### Kolla-Ansible पर जो फ़ायर हो रहा है उसे फ़ॉरवर्ड करें

केवल तब जब आपने अपने नियम लिखे हों: Kolla-Ansible कोई नहीं देता, इसलिए जब तक `/etc/kolla/config/prometheus/*.rules` में कुछ न हो, कुछ फ़ायर नहीं होता। जिस होस्ट से आप डिप्लॉय करते हैं उस पर `/etc/kolla/config/prometheus/prometheus-alertmanager.yml` लिखें, जिसे Kolla-Ansible अपनी फ़ाइल की जगह पढ़ता है, और उसे लागू करें:

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

### Kolla-Ansible पर क्रेडेंशियल

`source /etc/kolla/admin-openrc.sh` से admin के रूप में लॉगिन करें, जिसे `kolla-ansible post-deploy` लिखता है।

- **Full view** को एक बदलाव चाहिए, Cinder में। Kolla-Ansible के टेम्पलेट Nova, Neutron, Glance और Placement पर `[keystone_authtoken]` के नीचे पहले से `service_type` सेट करते हैं, लेकिन उसका Cinder `volume` कहता है और उसका कैटलॉग `block-storage`, और जब दोनों मेल न खाएं तो keystonemiddleware एक्सेस नियमों से सीमित क्रेडेंशियल को `401` से अस्वीकार कर देता है। `/etc/kolla/config/cinder.conf` में `[keystone_authtoken]` के नीचे `service_type = block-storage` जोड़ें, फिर `kolla-ansible reconfigure -i <inventory> --tags cinder` चलाएं।
- **Infrastructure only** अपने ओवरराइड `/etc/kolla/config/nova/policy.yaml` पर लेता है, और `neutron`, `keystone` और `placement` के लिए भी वैसे ही, वहाँ पहले से जो है उसके साथ मर्ज करके। उन्हें `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement` से लागू करें।

### Kolla-Ansible का क्लाउड जिन पर टिका है उन पर नज़र रखें

जिस होस्ट पर Kolla-Ansible का Prometheus चलता है, वहाँ यह उसके टारगेट उस फ़ाइल से पढ़ता है जो Kolla-Ansible ने रेंडर की, और उन्हें एजेंट की सेटिंग के रूप में प्रिंट करता है:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

जो प्रिंट हो उसे एजेंट की `.env` में जोड़ें, फिर एजेंट के फ़ोल्डर में `docker compose up -d` चलाएँ। हर एक्सपोर्टर API नेटवर्क पर सुनता है, इसलिए एजेंट की मशीन के पास वहाँ का रास्ता होना चाहिए। फिर क्लाउड का **कंट्रोल प्लेन** कार्ड बताता है कि हर एक कैसा है, और साफ़ बताता है कि किन पर नज़र नहीं रखी जा रही।

| क्या पढ़ता है | पोर्ट | सेटिंग |
| --- | --- | --- |
| RabbitMQ का Prometheus प्लगइन | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| HAProxy का अपना एक्सपोर्टर | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, OVN और Open vSwitch के लिए | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **OVN के डेटाबेस:** Kolla-Ansible 2026.1 से openstack-network-exporter चलाता है, केवल कंप्यूट और नेटवर्क नोड पर, और OVN डेटाबेस उसी होस्ट से पढ़ा जाता है जिस पर वह चलता है। अगर आपके कंट्रोल नोड इनमें से कुछ नहीं हैं, तो उन्हें अपने इन्वेंटरी में `[prometheus-openstack-network-exporter:children]` के नीचे जोड़ें और रीकॉन्फ़िगर करें, वरना Northbound और Southbound डेटाबेस नज़र में नहीं हैं ऐसे दिखते हैं।
- **2026.1 से पहले** कोई नेटवर्क एक्सपोर्टर नहीं है, इसलिए OVN और Open vSwitch नज़र में नहीं हैं ऐसे दिखते हैं।

### Kolla-Ansible पर सेवा लॉग

एजेंट की लॉग प्रोफ़ाइल हर नोड पर चलती है, और Kolla-Ansible की फ़ाइलें पढ़ती है। यही किसी पंक्ति को क्लाउड के पेजों से जोड़ती है:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Kolla का अपना Fluentd भी फ़ॉरवर्ड कर सकता है, `/etc/kolla/config/fluentd/output/*.conf` में एक आउटपुट के साथ जैसा [Fluentd](/docs/telemetry/fluentd) बताता है, लेकिन वे रिकॉर्ड **लॉग** में किसी सेवा के नाम से पहुँचते हैं, क्लाउड के पेजों पर नहीं।

### Kolla-Ansible पर किसने क्या किया

Keystone का ऑडिट ट्रेल और हर API पर ऑडिट फ़िल्टर, [सुरक्षा इवेंट](/docs/telemetry/openstack#किसने-क्या-किया) में। हर एक सेवा के अपने लॉग में लिखता है, बस पर किसी उपभोक्ता के बिना। जब **अपने लॉग में सुरक्षा इवेंट खोजें** चालू हो, **सुरक्षा इवेंट → कनेक्शन** के अंतर्गत, तब OneUptime उन्हें वहीं से पढ़ता है। एजेंट की लॉग प्रोफ़ाइल दोनों को `/var/log/kolla` से पढ़ती है।

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

यह हर लॉगिन के लिए एक पंक्ति भेजता है, जिसे **OpenStack admin credential used from a new address** पढ़ता है। केवल विफल लॉगिन भेजने के लिए `notification_opt_out` में `identity.authenticate.success` जोड़ें, और तब वह पहचान वह पढ़ती है जो ऑडिट फ़िल्टर ने देखा।

Nova, Neutron, Cinder और Glance के ज़रिए किसने क्या किया, इसके लिए ऑडिट फ़िल्टर को एक सेटिंग चाहिए, जो हर सेवा के कॉन्फ़िग में एक साथ जाती है:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

इसे एक paste फ़ाइल भी चाहिए, और Kolla-Ansible के कॉन्फ़िग टास्क इन सेवाओं के लिए कोई paste फ़ाइल कॉपी नहीं करते। अपनी फ़ाइल हर API होस्ट पर रखें, और इमेज में मौजूद फ़ाइल के ऊपर उसे `globals.yml` में `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` और `glance_api_extra_volumes` से माउंट करें। pyCADF की मैप फ़ाइलें इमेज में `/var/lib/kolla/venv/etc/pycadf` में हैं। फ़िल्टर की पंक्तियाँ [किसने क्या किया](/docs/telemetry/openstack#ऑडिट-फ़िल्टर-चालू-करें) में हैं।

## OpenStack-Ansible

OpenStack-Ansible अपनी सेवाओं के लॉग journald में रखता है और अपना कोई Prometheus नहीं चलाता, इसलिए एजेंट ही रास्ता है, और लॉग का अपना रास्ता है।

### OpenStack-Ansible पर क्रेडेंशियल

यूटिलिटी कंटेनर से admin के रूप में लॉगिन करें: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, फिर `. ~/openrc`। उसमें `curl` नहीं है, जिसे नीचे के कमांड इस्तेमाल करते हैं, इसलिए पहले वहाँ `apt-get install -y curl` चलाएँ।

- **Full view** को एक बदलाव चाहिए, Cinder में। OpenStack-Ansible की भूमिकाएँ `[keystone_authtoken]` के नीचे पहले से `service_type` सेट करती हैं, लेकिन उसका Cinder `volumev3` कहता है और उसका कैटलॉग `block-storage`, और जब दोनों मेल न खाएं तो keystonemiddleware एक्सेस नियमों से सीमित क्रेडेंशियल को `401` से अस्वीकार कर देता है। `/etc/openstack_deploy/user_variables.yml` में `cinder_cinder_conf_overrides` के अंदर `keystone_authtoken` के नीचे `service_type: block-storage` सेट करें, फिर `openstack-ansible openstack.osa.cinder --tags cinder-config` चलाएं।
- **Infrastructure only** अपने ओवरराइड `/etc/openstack_deploy/user_variables.yml` में `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` और `placement_policy_overrides` के रूप में लेता है। हर एक को उसके अपने प्लेबुक और टैग से लागू करें, जैसे `openstack-ansible openstack.osa.nova --tags nova-policy-override`। बाद में किसी को हटाने पर फ़ाइल हट जाने के बजाय खाली रह जाती है, इसलिए कुछ विफल नहीं होता।

### OpenStack-Ansible का क्लाउड जिन पर टिका है उन पर नज़र रखें

OpenStack-Ansible इनके लिए कोई एक्सपोर्टर नहीं चलाता, इसलिए केवल वही देखा जाता है जो आप चालू करते हैं।

**RabbitMQ:** उसका Prometheus प्लगइन चालू करें, फिर हर कंटेनर का पता `15692` पर एजेंट की `.env` में `OPENSTACK_RABBITMQ_TARGETS` के रूप में लिखें:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** उसका एक्सपोर्टर बंद है, और उसका stats लिसनर `127.0.0.1` पर TLS के साथ है, जिसे एजेंट नहीं पढ़ सकता। उसे वहाँ चालू करें जहाँ एजेंट पहुँच सके, फिर वह पता `1936` पर `OPENSTACK_HAPROXY_TARGETS` के रूप में लिखें:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB और Memcached:** OpenStack-Ansible किसी के लिए एक्सपोर्टर नहीं देता। [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) और [memcached_exporter](https://github.com/prometheus/memcached_exporter) खुद चलाएँ और उन्हें `OPENSTACK_MARIADB_TARGETS` और `OPENSTACK_MEMCACHED_TARGETS` के रूप में लिखें, या उन्हें छोड़ दें: तब क्लाउड का **कंट्रोल प्लेन** कार्ड यह बताता है कि उन पर नज़र नहीं रखी जा रही, यह नहीं कि वे ठीक हैं।

### OpenStack-Ansible पर सेवा लॉग

journald से, हर उस होस्ट पर जो कोई सेवा चलाता है: कंटेनर अपने जर्नल होस्ट तक पहुँचाते हैं।

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

यह एजेंट की लॉग प्रोफ़ाइल को systemd सेवा के रूप में चलाता है, और `/var/log/journal/` पढ़ता है, जहाँ OpenStack-Ansible के कंटेनरों के जर्नल पहुँचते हैं।

### OpenStack-Ansible पर किसने क्या किया

Keystone का ऑडिट ट्रेल और हर API पर ऑडिट फ़िल्टर, [सुरक्षा इवेंट](/docs/telemetry/openstack#किसने-क्या-किया) में। हर एक सेवा के अपने लॉग में लिखता है, बस पर किसी उपभोक्ता के बिना। जब **अपने लॉग में सुरक्षा इवेंट खोजें** चालू हो, **सुरक्षा इवेंट → कनेक्शन** के अंतर्गत, तब OneUptime उन्हें वहीं से पढ़ता है। एजेंट की लॉग प्रोफ़ाइल दोनों को जर्नल से पढ़ती है।

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

यह हर लॉगिन के लिए एक पंक्ति भेजता है, जिसे **OpenStack admin credential used from a new address** पढ़ता है। केवल विफल लॉगिन भेजने के लिए `notification_opt_out` में `identity.authenticate.success` जोड़ें, और तब वह पहचान वह पढ़ती है जो ऑडिट फ़िल्टर ने देखा। `notification_opt_out` का दूसरा मान YAML सेट के रूप में जाता है, जैसे [उसका config_template](https://docs.openstack.org/ansible-config_template/latest/) दोहराई गई कुंजी लिखता है।

Nova, Neutron, Cinder और Glance के ज़रिए किसने क्या किया, इसके लिए हर API फ़िल्टर की सेटिंग अपने conf ओवरराइड में लेता है, और फ़िल्टर अपने paste ओवरराइड में, हर पाइपलाइन में `authtoken` और उसके बाद आने वाले कॉन्टेक्स्ट फ़िल्टर के ठीक बाद `audit` के साथ। Nova का, और वही `neutron_neutron_conf_overrides` और `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` और `cinder_api_paste_ini_overrides`, और `glance_glance_api_conf_overrides` और `glance_glance_api_paste_ini_overrides` में:

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

OpenStack-Helm Prometheus, Alertmanager और एक्सपोर्टर के चार्ट देता है, और वे चल रहे हैं या नहीं यह आप पर है। उसका कंट्रोल प्लेन Kubernetes में चलता है, इसलिए प्रोब API पढ़ता है और Kubernetes एजेंट पॉड देखता है।

### OpenStack-Helm पर जो फ़ायर हो रहा है उसे फ़ॉरवर्ड करें

अगर आप उसका prometheus-alertmanager चार्ट चलाते हैं, तो चार्ट की वैल्यू में `conf.alertmanager` के नीचे रिसीवर जोड़ें, और अपना रूट उसकी ओर भेजें:

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

### OpenStack-Helm पर API पढ़ें और पॉड देखें

**OpenStack → सभी क्लाउड** खोलें, **क्लाउड कनेक्ट करें** पर क्लिक करें, और उसे Keystone का पता, एक एप्लिकेशन क्रेडेंशियल और इस्तेमाल होने वाला प्रोब दें। प्रोब क्लाउड से केवल HTTPS में बात करता है। फिर उस क्लस्टर के लिए **Kubernetes → दस्तावेज़ीकरण** का पालन करें जिस पर चार्ट चलते हैं: उसके पॉड, उनके लॉग और उसके नोड Kubernetes पेजों तक पहुँचते हैं।

उन सेवाओं के लॉग इस क्लाउड के **लॉग** पेज पर भी पाने के लिए, हर स्टैक ट्रेस एक रिकॉर्ड, एजेंट की वैल्यू में क्लाउड का नाम दें, उन नेमस्पेस के साथ जिनमें उसकी सेवाएँ चलती हैं:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### OpenStack-Helm पर किसने क्या किया

Keystone का ऑडिट ट्रेल और हर API पर ऑडिट फ़िल्टर, [सुरक्षा इवेंट](/docs/telemetry/openstack#किसने-क्या-किया) में। हर एक सेवा के अपने लॉग में लिखता है, बस पर किसी उपभोक्ता के बिना। जब **अपने लॉग में सुरक्षा इवेंट खोजें** चालू हो, **सुरक्षा इवेंट → कनेक्शन** के अंतर्गत, तब OneUptime उन्हें वहीं से पढ़ता है। Kubernetes एजेंट दोनों को पॉड के लॉग से पढ़ता है, क्लाउड का नाम उसकी वैल्यू में देकर।

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

यह हर लॉगिन के लिए एक पंक्ति भेजता है, जिसे **OpenStack admin credential used from a new address** पढ़ता है। केवल विफल लॉगिन भेजने के लिए `notification_opt_out` में `identity.authenticate.success` जोड़ें, और तब वह पहचान वह पढ़ती है जो ऑडिट फ़िल्टर ने देखा।

चार्ट का `logging.conf` रूट लॉगर को `WARNING` पर रखता है, और log ड्राइवर अपने ही लॉगर के नीचे लिखता है, इसलिए उसके लिए लॉगर न हो तो कुछ नहीं लिखा जाता। वैल्यू में दी गई सूची चार्ट की सूची को बदल देती है, इसलिए `keys` में वह सब रखें जो चार्ट के पास है, और यह भी:

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

Nova, Neutron और Cinder के ज़रिए किसने क्या किया, इसके लिए उनके चार्ट के `conf.paste` में हर पाइपलाइन में पहले से ऑडिट फ़िल्टर है, और उसे बताना होता है कि कहाँ लिखना है। हर एक को `conf.logging` में वही लॉगर चाहिए। Glance के चार्ट में मैप है, पर न फ़िल्टर है और न उसकी पाइपलाइन में उसके लिए जगह: दोनों उसके `conf.paste` में जोड़ें।

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere अपने अलर्ट नियमों के साथ kube-prometheus-stack चलाता है, और लॉग के लिए Vector के साथ Loki। पहले उसके अलर्ट फ़ॉरवर्ड करें, फिर प्रोब API पढ़ता है और Kubernetes एजेंट पॉड देखता है।

### Atmosphere पर जो फ़ायर हो रहा है उसे फ़ॉरवर्ड करें

Atmosphere ऐसे अलर्ट नियम देता है जिन्होंने असली लोगों को पेज किया है, इसलिए यह पहले घंटे से काम करता है। रिसीवर को अपने Atmosphere कॉन्फ़िगरेशन में जोड़ें, उन रिसीवर के बगल में जो आपके पास पहले से हों, और उसे डिप्लॉय करें:

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

### Atmosphere पर API पढ़ें और पॉड देखें

**OpenStack → सभी क्लाउड** खोलें, **क्लाउड कनेक्ट करें** पर क्लिक करें, और उसे Keystone का पता, एक एप्लिकेशन क्रेडेंशियल और इस्तेमाल होने वाला प्रोब दें। प्रोब क्लाउड से केवल HTTPS में बात करता है। फिर उस क्लस्टर के लिए **Kubernetes → दस्तावेज़ीकरण** का पालन करें जिस पर Atmosphere चलता है।

उन सेवाओं के लॉग इस क्लाउड के **लॉग** पेज पर भी पाने के लिए, हर स्टैक ट्रेस एक रिकॉर्ड, एजेंट की वैल्यू में क्लाउड का नाम दें, उन नेमस्पेस के साथ जिनमें उसकी सेवाएँ चलती हैं:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Atmosphere पर किसने क्या किया

Keystone का ऑडिट ट्रेल और हर API पर ऑडिट फ़िल्टर, [सुरक्षा इवेंट](/docs/telemetry/openstack#किसने-क्या-किया) में। हर एक सेवा के अपने लॉग में लिखता है, बस पर किसी उपभोक्ता के बिना। जब **अपने लॉग में सुरक्षा इवेंट खोजें** चालू हो, **सुरक्षा इवेंट → कनेक्शन** के अंतर्गत, तब OneUptime उन्हें वहीं से पढ़ता है। Kubernetes एजेंट दोनों को पॉड के लॉग से पढ़ता है, क्लाउड का नाम उसकी वैल्यू में देकर।

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

यह हर लॉगिन के लिए एक पंक्ति भेजता है, जिसे **OpenStack admin credential used from a new address** पढ़ता है। केवल विफल लॉगिन भेजने के लिए `notification_opt_out` में `identity.authenticate.success` जोड़ें, और तब वह पहचान वह पढ़ती है जो ऑडिट फ़िल्टर ने देखा।

Nova, Neutron और Cinder के ज़रिए किसने क्या किया, इसके लिए Atmosphere जो चार्ट डिप्लॉय करता है उनमें हर पाइपलाइन में पहले से ऑडिट फ़िल्टर है, और उसे बताना होता है कि कहाँ लिखना है, `nova_helm_values`, `neutron_helm_values` और `cinder_helm_values` में। Glance के चार्ट में न फ़िल्टर है और न उसकी पाइपलाइन में उसके लिए जगह: दोनों उसके `conf.paste` में जोड़ें, `glance_helm_values` में।

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam, `sunbeam enable observability embedded` से, Canonical Observability Stack डिप्लॉय कर सकता है। Canonical के पास एक `openstack-exporter` चार्म भी है, जिसे एजेंट पढ़ सकता है अगर आप उसे चलाते हैं। Sunbeam के अपने डॉक्स उस चार्म का ज़िक्र नहीं करते, और यहाँ कुछ भी Sunbeam पर चलाया नहीं गया है।

### Sunbeam पर जो फ़ायर हो रहा है उसे फ़ॉरवर्ड करें

अगर आप Canonical Observability Stack चलाते हैं, तो उसके Alertmanager को ऐसा कॉन्फ़िगरेशन दें जिसमें रिसीवर हो:

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

### एक्सपोर्टर चार्म

अगर आप Canonical का `openstack-exporter` चार्म चलाते हैं, तो एजेंट उसे बिना अपने किसी क्रेडेंशियल के पढ़ सकता है। वह एक क्लाउड का जवाब `/metrics` पर देता है, पोर्ट `9180` पर जब तक आपने उसकी `port` सेटिंग न बदली हो। उसका पता `juju status openstack-exporter` से मिलता है:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

वह कौन सी सीरीज़ बताता है यह उसके स्नैप के एक्सपोर्टर रिलीज़ पर निर्भर है, जो यहाँ रिकॉर्ड नहीं किया गया: `bash troubleshoot.sh` बताता है कि वह क्लाउड को पढ़ता है या नहीं।

### Sunbeam पर सेवा लॉग

observability चालू होने पर, स्टैक का Loki सेवाओं के लॉग रखता है। OneUptime के पास Loki पढ़ने का कोई तरीका नहीं है, और एजेंट की लॉग प्रोफ़ाइल को Sunbeam के चार्म पर आज़माया नहीं गया है, इसलिए यहाँ अभी उन्हें कुछ इकट्ठा नहीं करता।

### Sunbeam पर किसने क्या किया

अभी नहीं। Sunbeam के चार्म हर सेवा का कॉन्फ़िगरेशन अपने टेम्पलेट से लिखते हैं, और उसके Keystone चार्म में नोटिफ़िकेशन कहाँ जाएँ इसकी कोई सेटिंग नहीं है। इसलिए न Keystone का ऑडिट ट्रेल और न ऑडिट फ़िल्टर चार्म के बाहर से चालू किया जा सकता है, और यहाँ कुछ भी सुरक्षा इवेंट तक नहीं पहुँचता।

## OpenShift पर Red Hat OpenStack

इसका Telemetry Operator OpenShift पर Ceilometer का Prometheus एक्सपोर्टर और Alertmanager के साथ एक मॉनिटरिंग स्टैक चलाता है। Kubernetes एजेंट का OpenShift प्रीसेट कंट्रोल प्लेन पर नज़र रखता है, और Ceilometer का एक्सपोर्टर बताता है कि कंप्यूट नोड क्या कर रहे हैं।

### OpenShift पर Red Hat OpenStack पर जो फ़ायर हो रहा है उसे फ़ॉरवर्ड करें

अगर `MetricStorage` में `alertingEnabled` है और आपने नियम लिखे या लागू किए हैं, तो ऐसा रिसीवर लागू करें जिसे मॉनिटरिंग स्टैक उठा ले:

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

### API और कंट्रोल प्लेन पढ़ें

**OpenStack → सभी क्लाउड** खोलें, **क्लाउड कनेक्ट करें** पर क्लिक करें, और उसे Keystone का पता, एक एप्लिकेशन क्रेडेंशियल और इस्तेमाल होने वाला प्रोब दें। प्रोब क्लाउड से केवल HTTPS में बात करता है। फिर उस क्लस्टर पर, जो कंट्रोल प्लेन चलाता है, **Kubernetes → दस्तावेज़ीकरण** का पालन करें, **Red Hat OpenShift** चुनकर, जो `preset=openshift` सेट करता है।

उन सेवाओं के लॉग इस क्लाउड के **लॉग** पेज पर भी पाने के लिए, हर स्टैक ट्रेस एक रिकॉर्ड, एजेंट की वैल्यू में क्लाउड का नाम दें, उन नेमस्पेस के साथ जिनमें उसकी सेवाएँ चलती हैं:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Ceilometer के ज़रिए कंप्यूट नोड पढ़ें

प्रोब बताता है कि क्या आवंटित है, यह नहीं कि क्या व्यस्त है। असली उपयोग पढ़ने के लिए एजेंट को ऐसी मशीन पर चलाएँ जो कंप्यूट नोड तक पहुँच सके, `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` में हर नोड का नाम Ceilometer के पोर्ट `9101` पर देकर।

### OpenShift पर Red Hat OpenStack पर किसने क्या किया

Keystone का ऑडिट ट्रेल और हर API पर ऑडिट फ़िल्टर, [सुरक्षा इवेंट](/docs/telemetry/openstack#किसने-क्या-किया) में। हर एक सेवा के अपने लॉग में लिखता है, बस पर किसी उपभोक्ता के बिना। जब **अपने लॉग में सुरक्षा इवेंट खोजें** चालू हो, **सुरक्षा इवेंट → कनेक्शन** के अंतर्गत, तब OneUptime उन्हें वहीं से पढ़ता है। Kubernetes एजेंट दोनों को पॉड के लॉग से पढ़ता है, क्लाउड का नाम उसकी वैल्यू में देकर।

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

यह हर लॉगिन के लिए एक पंक्ति भेजता है, जिसे **OpenStack admin credential used from a new address** पढ़ता है। केवल विफल लॉगिन भेजने के लिए `notification_opt_out` में `identity.authenticate.success` जोड़ें, और तब वह पहचान वह पढ़ती है जो ऑडिट फ़िल्टर ने देखा।

Nova और Neutron के ज़रिए किसने क्या किया, इसके लिए हर एक फ़िल्टर की सेटिंग अपने `customServiceConfig` में लेता है, और अपनी paste फ़ाइल `defaultConfigOverwrite` में। Cinder और Glance के ऑपरेटर कोई paste फ़ाइल नहीं लेते, इसलिए यहाँ कुछ उन तक नहीं पहुँचता।

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

StackLight पहले से अपने अलर्ट नियमों के साथ OpenStack की सेवाओं, MariaDB, Memcached, RabbitMQ और libvirt पर नज़र रखता है। पहले उसके अलर्ट फ़ॉरवर्ड करें, फिर प्रोब API पढ़ता है।

### Mirantis MOSK पर जो फ़ायर हो रहा है उसे फ़ॉरवर्ड करें

StackLight अलर्ट नियम देता है, इसलिए यह पहले घंटे से काम करता है। रिसीवर और उसका रूट अपनी StackLight वैल्यू में जोड़ें। Mirantis के डॉक्स वेबहुक नहीं बल्कि दूसरे रिसीवर दिखाते हैं, और इसे MOSK पर चलाया नहीं गया है:

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

### API पढ़ें

**OpenStack → सभी क्लाउड** खोलें, **क्लाउड कनेक्ट करें** पर क्लिक करें, और उसे Keystone का पता, एक एप्लिकेशन क्रेडेंशियल और इस्तेमाल होने वाला प्रोब दें। प्रोब क्लाउड से केवल HTTPS में बात करता है।

### Mirantis MOSK पर किसने क्या किया

Nova, Neutron, Cinder और Glance के ज़रिए किसने क्या किया, इसके लिए MOSK की अपनी सेटिंग है, जिसमें ऑडिट फ़िल्टर पहले से लगा है। log ड्राइवर के साथ, हर सेवा अपने स्टैंडर्ड आउटपुट पर लिखती है, और Kubernetes एजेंट उसे पॉड के लॉग से पढ़ता है, क्लाउड का नाम उसकी वैल्यू में देकर। हर एक सेवा के अपने लॉग में लिखता है, बस पर किसी उपभोक्ता के बिना। जब **अपने लॉग में सुरक्षा इवेंट खोजें** चालू हो, **सुरक्षा इवेंट → कनेक्शन** के अंतर्गत, तब OneUptime उन्हें वहीं से पढ़ता है।

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

वह सेटिंग Keystone को कवर नहीं करती। उसका अपना ऑडिट ट्रेल `spec:services` लेता है, जिसे Mirantis सत्यापित नहीं करता और जिसकी कोई ज़िम्मेदारी नहीं लेता, इसलिए इसे अपने सपोर्ट अनुबंध के साथ तौलें:

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

यह हर लॉगिन के लिए एक पंक्ति भेजता है, जिसे **OpenStack admin credential used from a new address** पढ़ता है। केवल विफल लॉगिन भेजने के लिए `notification_opt_out` में `identity.authenticate.success` जोड़ें, और तब वह पहचान वह पढ़ती है जो ऑडिट फ़िल्टर ने देखा।

## जो एक्सपोर्टर आप पहले से चलाते हैं उसी का उपयोग करें

न कोई क्रेडेंशियल और न कुछ नया चलाना: एजेंट वह एक्सपोर्टर पढ़ सकता है जो आपके पास पहले से है। कैसे, यह इस पर निर्भर है कि उसे कैसे शुरू किया गया।

- **`--multi-cloud` के साथ,** जैसे एजेंट का अपना चलता है: `OPENSTACK_EXPORTER_ADDRESS` सेट करें, और एजेंट उससे `/probe` पर एक बार में एक सेवा माँगता है।
- **इसके बिना,** जैसे Kolla-Ansible का और Canonical का चार्म चलते हैं: उसमें `/probe` नहीं होता, इसलिए `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` सेट करें, और एजेंट उससे हर 2 मिनट पर `/metrics` पर सब कुछ एक साथ माँगता है।

Kolla-Ansible पर वह उसका आंतरिक VIP है, `9198` पर:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

वह वॉक Kolla-Ansible के अपने Prometheus के हर मिनट पूछने के ऊपर है। Kolla-Ansible एक्सपोर्टर 1.7.0 पिन करता है, और उसका जवाब उस एक्सपोर्टर से भी कम बताता है जो एजेंट पिन करता है। यह वह है जिसके बिना पेज पाँच असली क्लाउड पर रहे, और एक टेस्ट उसे उन रिकॉर्डिंग से बाँधे रखता है:

| किसके बिना रहता है | क्योंकि | इसकी क्या कीमत है |
| --- | --- | --- |
| Cinder का सब कुछ | वह कैटलॉग से `volumev3` माँगता है, और जहाँ Cinder `block-storage` के रूप में रजिस्टर होता है वहाँ ऐसा कुछ नहीं मिलता | **वॉल्यूम** और **Storage pools** खाली रहते हैं, और **सेवाएं** में Block Storage API, `cinder-volume` या `cinder-scheduler` नहीं होता। **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** और **Volume Stuck** शांत रहते हैं |
| हाइपरवाइज़र में कितने इंस्टेंस हैं, और उसके aggregates | Nova की हाइपरवाइज़र सूची सबसे नए माइक्रोवर्ज़न पर विफल होती है, जो Kolla-Ansible माँगता है | **हाइपरवाइज़र** पर वे दोनों, और खोए हुए होस्ट के साथ क्या जाता है यह बताने वाली बात। उसके vCPU, मेमोरी और डिस्क फिर भी मौजूद हैं: वे Placement से आते हैं |
| डोमेन | उसके पास ऐसी कोई सीरीज़ नहीं है | **डोमेन** खाली रहता है |
| इमेज की स्थिति, दृश्यता और बनने की तारीख | उसके पास ऐसे लेबल नहीं हैं | **इमेज** पर वे कॉलम। **Image Stuck** शांत रहता है, इसलिए `active` तक के रास्ते में अटकी इमेज का पता नहीं चलता |
| नेटवर्क का MTU | उसके पास ऐसा कोई लेबल नहीं है | नेटवर्क के पेज पर वह पंक्ति |

अगर आपको ये चाहिए, तो इसके बजाय एजेंट का अपना एक्सपोर्टर इस्तेमाल करें। आप बाद में अपना मन बदल सकते हैं: क्लाउड का नाम वही रहता है चाहे उसे कोई भी पढ़े।
