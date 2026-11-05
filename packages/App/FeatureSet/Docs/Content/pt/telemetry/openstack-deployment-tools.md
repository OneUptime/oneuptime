# OpenStack por ferramenta de implantação

Ninguém executa "o OpenStack". Executam uma ferramenta que o implanta, e cada ferramenta tem seus próprios caminhos, seus próprios registros e sua própria ideia do que já está em execução. Esta página reúne o que o guia de configuração do OneUptime diz para cada uma: abra **OpenStack → Todas as nuvens**, conecte uma nuvem e responda a **Como você implanta o OpenStack?**

:::cards
- [Até onde cada guia foi testado](#até-onde-cada-guia-foi-testado): Leia isto primeiro. O do Kolla-Ansible foi executado em uma implantação real, exceto por um alerta. O do OpenStack-Ansible foi executado em parte. Os outros não foram.
- [Encaminhe o que já está disparando](#encaminhe-o-que-já-está-disparando): Incidentes desde a primeira hora, sem agente.
- [Kolla-Ansible](#kolla-ansible): Leia os exportadores que ele já executa.
- [OpenStack-Ansible](#openstack-ansible): Registros do journald e substituições em `user_variables.yml`.
- [OpenStack-Helm](#openstack-helm) e [Atmosphere](#atmosphere): Uma sonda e o agente do Kubernetes.
- [Canonical Sunbeam](#canonical-sunbeam): A Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): O preset do OpenShift e o Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): Os alertas do StackLight.
- [Use o exportador que você já executa](#use-o-exportador-que-você-já-executa): O que as páginas deixam de ter na 1.7.0.
:::

## Até onde cada guia foi testado

Cada caminho, porta e variável abaixo foi lido do código-fonte ou da documentação da própria ferramenta. A bancada de testes que grava os fixtures do OneUptime também implanta o Kolla-Ansible e o OpenStack-Ansible em um runner de CI e executa ali os comandos dos próprios guias, com um substituto do OneUptime que guarda o que o agente envia. Portanto, nenhum guia aqui reportou a um OneUptime em execução a partir de uma implantação real da sua ferramenta. Contra o que cada um foi verificado:

| Ferramenta | Lido de | Executado de verdade |
| --- | --- | --- |
| Kolla-Ansible | Seu código-fonte, no master e no `stable/2026.1` | Os comandos deste guia, em um all-in-one real no `stable/2026.1` com Open vSwitch: o agente em cada credencial, sem Docker, no exportador do próprio Kolla-Ansible e no seu na versão fixada e na 1.7.0, os alvos lidos do seu `prometheus.yml` real e o perfil de logs. Uma parte não se confirmou: com o Memcached e o nova-compute parados ali, seu Alertmanager não enviou nada, então nenhum alerta saiu de uma stack do Kolla-Ansible para o OneUptime. O que o Alertmanager envia na versão que ele fixa, gravado em um cluster de teste, abriu e resolveu um incidente na nuvem certa em um OneUptime em execução |
| OpenStack-Ansible | Seu código-fonte e documentação | Um all-in-one real no `stable/2026.1`, em contêineres LXC, onde as configurações de RabbitMQ e HAProxy deste guia foram aplicadas com seus comandos e cada exportador respondeu, e seu perfil de logs leu o journal. Seus passos do agente não foram executados nele: o agente e seu perfil de logs foram executados em uma nuvem que esta ferramenta não implantou |
| OpenStack-Helm | Os values dos seus charts | A sonda e o agente do Kubernetes, cada um por conta própria |
| Atmosphere | Sua documentação e código-fonte | A sonda e o agente do Kubernetes, cada um por conta própria |
| Canonical Sunbeam | A documentação da Canonical e o código-fonte dos seus charms | Nada no Sunbeam. A documentação do próprio Sunbeam não menciona o charm do exportador |
| Red Hat OpenStack on OpenShift | O código-fonte do Telemetry Operator | O preset do OpenShift e o exportador do Ceilometer, cada um por conta própria |
| Mirantis MOSK | A documentação da Mirantis, cujos exemplos mostram outros receptores em vez de um webhook | Nada no MOSK |

O que o **Quem fez o quê** de cada guia ativa foi gravado no DevStack, em todas as versões que a bancada executa, e em nenhuma dessas ferramentas. Onde cada ferramenta o aceita foi lido do código-fonte ou da documentação dela.

Além disso, todo o caminho foi executado em um OneUptime ativo, iniciado como o Docker Compose o inicia, com seu app e sua sonda compilados a partir deste código, e em um DevStack real em vez de qualquer uma dessas ferramentas. O agente, instalado com os comandos da documentação, registrou a nuvem a partir dos seus primeiros dados, e toda instância, volume e hipervisor teve uma linha com o status que a própria nuvem deu. Com o `nova-compute` realmente parado, sua linha ficou inativa, um monitor do modelo Compute Service Down abriu um incidente nomeando o host 746 segundos depois, e ele foi resolvido 48 segundos após o serviço iniciar de novo. A sonda de um projeto conectou a mesma nuvem pelas rotas do próprio painel e leu de volta suas linhas, e os 114 spans de um boot assinado chegaram pelos seus serviços, a partir do perfil de traces.

Separadamente, o que um agente real e um Alertmanager real tinham enviado foi gravado no DevStack e em um cluster de teste, não em uma nuvem implantada por alguma dessas ferramentas. Enviado a um OneUptime ativo, o webhook de disparo abriu um incidente na nuvem certa e em nenhuma outra, o mesmo webhook de novo não abriu nada, e o webhook de resolução o resolveu.

## Encaminhe o que já está disparando

Qualquer ferramenta com um Alertmanager pode ter incidentes hoje: um alerta que dispara vira um incidente, com plantão e páginas de status desde a primeira hora, e ele é resolvido quando o alerta é. Não há nada para instalar, e isso funciona junto com tudo o mais nesta página.

:::steps
### Crie o monitor

Crie um monitor de Incoming Request como diz o [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receber-alertas-com-um-monitor) e copie seu **URL de heartbeat**. Esse é o endereço `<secret key>` no receptor de cada ferramenta abaixo.

### Associe-o à nuvem

Abra **Visão geral → Recursos vinculados** do monitor e adicione a nuvem OpenStack. Cada incidente passa a aparecer na página **Incidentes** dessa nuvem: as configurações de um monitor Incoming Request não nomeiam nenhuma nuvem, então o Alertmanager de cada nuvem precisa de um monitor próprio. A nuvem aparece nessa lista assim que seus primeiros dados chegam, então faça isso depois dos passos abaixo, ou adicione a nuvem antes em **OpenStack → Todas as nuvens**.
:::

O Alertmanager foi gravado enviando exatamente neste formato em `Tests/Ops/openstack-e2e`, na versão que o Kolla-Ansible fixa, e a gravação é reproduzida no avaliador real: um incidente por alerta, resolvido pelo seu próprio status `resolved`.

## Kolla-Ansible

Com `enable_prometheus` ativado em `/etc/kolla/globals.yml`, que o Kolla-Ansible deixa desativado até você configurar, ele executa o Prometheus, o Alertmanager e um exportador para cada componente sob a nuvem, e não traz regras de alerta. Este guia lê o que eles executam em vez de iniciar uma segunda cópia.

### Encaminhe o que está disparando no Kolla-Ansible

Somente se você escreveu suas próprias regras: o Kolla-Ansible não traz nenhuma, então nada dispara até que `/etc/kolla/config/prometheus/*.rules` contenha algumas. No host a partir do qual você implanta, escreva `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, que o Kolla-Ansible lê no lugar do seu próprio, e aplique-o:

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

### A credencial no Kolla-Ansible

Faça login como administrador com `source /etc/kolla/admin-openrc.sh`, que o `kolla-ansible post-deploy` escreve.

- **Visão completa** não exige nenhuma alteração em nenhum serviço: os templates do Kolla-Ansible já definem `service_type` em `[keystone_authtoken]` no Nova, Neutron, Cinder, Glance e Placement. O Cinder dele diz `volume`, que as regras de acesso também contêm.
- **Somente infraestrutura** recebe suas substituições em `/etc/kolla/config/nova/policy.yaml`, e o mesmo para `neutron`, `keystone` e `placement`, mescladas com o que já houver ali. Aplique-as com `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.

### Observe aquilo em que a nuvem do Kolla-Ansible se apoia

No host que executa o Prometheus do Kolla-Ansible, isto lê seus alvos do arquivo que o Kolla-Ansible gerou e os imprime como configurações para o agente:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Adicione o que ele imprimir ao `.env` do agente e depois execute `docker compose up -d` na pasta do agente. Cada exportador escuta na rede das APIs, então a máquina do agente precisa de uma rota até lá. O cartão **Plano de controle** da nuvem passa a informar como está cada um e diz claramente quais não são observados.

| Lê | Porta | Configuração |
| --- | --- | --- |
| O plugin Prometheus do RabbitMQ | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| O exportador próprio do HAProxy | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, para OVN e Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **Os bancos de dados do OVN:** o Kolla-Ansible executa o openstack-network-exporter a partir da 2026.1, somente nos nós de computação e de rede, e um banco de dados do OVN é lido do host em que ele executa. Se seus nós de controle não forem nenhum dos dois, adicione-os em `[prometheus-openstack-network-exporter:children]` no seu inventário e reconfigure, ou os bancos Northbound e Southbound aparecem como não observados.
- **Antes da 2026.1** não há exportador de rede, então OVN e Open vSwitch aparecem como não observados.

### Registros de serviço no Kolla-Ansible

O perfil de logs do agente executa em cada nó e lê os arquivos do Kolla-Ansible. É ele que associa uma linha às páginas da nuvem:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

O Fluentd do próprio Kolla também pode encaminhar, com uma saída em `/etc/kolla/config/fluentd/output/*.conf` como o [Fluentd](/docs/telemetry/fluentd) descreve, mas esses registros chegam a **Registros** sob o nome de um serviço, e não às páginas da nuvem.

### Quem fez o quê no Kolla-Ansible

A trilha de auditoria do Keystone e o filtro de auditoria de cada API, em [Eventos de segurança](/docs/telemetry/openstack#quem-fez-o-quê). Cada um escreve no registro do próprio serviço, sem nenhum consumidor no barramento. O OneUptime os lê de lá depois que **Encontrar eventos de segurança nos seus logs** é ativado, em **Eventos de segurança → Conexões**. O perfil de logs do agente lê ambos de `/var/log/kolla`.

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

Isso envia uma linha para cada login, que **OpenStack admin credential used from a new address** lê. Para enviar apenas os logins que falharam, adicione `identity.authenticate.success` a `notification_opt_out`, e essa detecção passa a ler o que o filtro de auditoria viu.

Para saber quem fez o quê pelo Nova, Neutron, Cinder e Glance, o filtro de auditoria precisa de uma configuração, que vai na configuração de todos os serviços de uma vez:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

Ele também precisa de um arquivo paste, e as tarefas de configuração do Kolla-Ansible não copiam nenhum arquivo paste para esses serviços. Coloque o seu em cada host de API e monte-o sobre o da imagem com `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` e `glance_api_extra_volumes` em `globals.yml`. Os arquivos de mapa do pyCADF estão em `/var/lib/kolla/venv/etc/pycadf` na imagem. [Quem fez o quê](/docs/telemetry/openstack#ative-o-filtro-de-auditoria) traz as linhas do filtro.

## OpenStack-Ansible

O OpenStack-Ansible mantém os registros dos seus serviços no journald e não executa um Prometheus próprio, então o agente é o caminho de entrada, e os registros têm um caminho próprio.

### A credencial no OpenStack-Ansible

Faça login como administrador a partir do contêiner utility: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, depois `. ~/openrc`. Ele não tem `curl`, que os comandos abaixo usam, então execute `apt-get install -y curl` ali primeiro.

- **Visão completa** não exige nenhuma alteração em nenhum serviço: os roles do OpenStack-Ansible já definem `service_type` em `[keystone_authtoken]`. O Cinder dele diz `volumev3`, que as regras de acesso também contêm.
- **Somente infraestrutura** recebe suas substituições como `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` e `placement_policy_overrides` em `/etc/openstack_deploy/user_variables.yml`. Aplique cada uma com seu próprio playbook e tag, como `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Remover uma depois deixa um arquivo vazio em vez de nenhum, então nada falha.

### Observe aquilo em que a nuvem do OpenStack-Ansible se apoia

O OpenStack-Ansible não executa exportadores para isso, então apenas o que você ativar é observado.

**RabbitMQ:** ative o plugin Prometheus dele e depois informe o endereço de cada contêiner na `15692` como `OPENSTACK_RABBITMQ_TARGETS` no `.env` do agente:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** o exportador dele está desativado, e seu listener de estatísticas está em `127.0.0.1` com TLS, que o agente não consegue ler. Ative-o onde o agente possa ler e depois informe esse endereço na `1936` como `OPENSTACK_HAPROXY_TARGETS`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB e Memcached:** o OpenStack-Ansible não traz exportador para nenhum dos dois. Execute você mesmo o [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) e o [memcached_exporter](https://github.com/prometheus/memcached_exporter) e informe-os como `OPENSTACK_MARIADB_TARGETS` e `OPENSTACK_MEMCACHED_TARGETS`, ou deixe-os de fora: o cartão **Plano de controle** da nuvem passa a dizer que não são observados, em vez de dizer que estão bem.

### Registros de serviço no OpenStack-Ansible

A partir do journald, em cada host que executa um serviço: os contêineres repassam seus journals ao host.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

Isso executa o perfil de logs do agente como um serviço systemd e lê `/var/log/journal/`, onde chegam os journals dos contêineres do OpenStack-Ansible.

### Quem fez o quê no OpenStack-Ansible

A trilha de auditoria do Keystone e o filtro de auditoria de cada API, em [Eventos de segurança](/docs/telemetry/openstack#quem-fez-o-quê). Cada um escreve no registro do próprio serviço, sem nenhum consumidor no barramento. O OneUptime os lê de lá depois que **Encontrar eventos de segurança nos seus logs** é ativado, em **Eventos de segurança → Conexões**. O perfil de logs do agente lê ambos do journal.

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

Isso envia uma linha para cada login, que **OpenStack admin credential used from a new address** lê. Para enviar apenas os logins que falharam, adicione `identity.authenticate.success` a `notification_opt_out`, e essa detecção passa a ler o que o filtro de auditoria viu. Um segundo valor de `notification_opt_out` entra como um conjunto YAML, como o [config_template dele](https://docs.openstack.org/ansible-config_template/latest/) escreve uma chave repetida.

Para saber quem fez o quê pelo Nova, Neutron, Cinder e Glance, cada API recebe a configuração do filtro em suas substituições de conf, e o filtro em suas substituições de paste, com `audit` logo depois de `authtoken` e do filtro de contexto que o segue em cada pipeline. O do Nova, e o mesmo em `neutron_neutron_conf_overrides` e `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` e `cinder_api_paste_ini_overrides`, e `glance_glance_api_conf_overrides` e `glance_glance_api_paste_ini_overrides`:

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

O OpenStack-Helm oferece charts para Prometheus, Alertmanager e exportadores, e se eles estão em execução fica por sua conta. Seu plano de controle executa no Kubernetes, então uma sonda lê as APIs e o agente do Kubernetes enxerga os pods.

### Encaminhe o que está disparando no OpenStack-Helm

Se você executa o chart prometheus-alertmanager dele, adicione o receptor em `conf.alertmanager` nos values do chart e envie sua rota para ele:

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

### Leia as APIs e veja os pods no OpenStack-Helm

Abra **OpenStack → Todas as nuvens**, clique em **Conectar nuvem** e informe o endereço do Keystone, uma credencial de aplicação e a sonda a usar. Uma sonda só fala HTTPS com a nuvem. Depois siga **Kubernetes → Documentação** para o cluster em que os charts executam: seus pods, os registros deles e seus nós chegam às páginas do Kubernetes.

Para ter também os registros desses serviços na página **Registros** desta nuvem, com cada stack trace como um único registro, informe a nuvem nos values do agente, com os namespaces em que seus serviços executam:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Quem fez o quê no OpenStack-Helm

A trilha de auditoria do Keystone e o filtro de auditoria de cada API, em [Eventos de segurança](/docs/telemetry/openstack#quem-fez-o-quê). Cada um escreve no registro do próprio serviço, sem nenhum consumidor no barramento. O OneUptime os lê de lá depois que **Encontrar eventos de segurança nos seus logs** é ativado, em **Eventos de segurança → Conexões**. O agente do Kubernetes lê ambos dos registros dos pods, com a nuvem informada nos seus values.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

Isso envia uma linha para cada login, que **OpenStack admin credential used from a new address** lê. Para enviar apenas os logins que falharam, adicione `identity.authenticate.success` a `notification_opt_out`, e essa detecção passa a ler o que o filtro de auditoria viu.

O `logging.conf` de um chart mantém o logger raiz em `WARNING`, e o driver de log escreve sob um logger próprio, então sem um para ele nada é escrito. Uma lista nos values substitui a do chart, então `keys` contém o que o do chart tem, mais isto:

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

Para saber quem fez o quê pelo Nova, Neutron e Cinder, o `conf.paste` dos charts deles já tem o filtro de auditoria em cada pipeline, e é preciso dizer onde escrever. Cada um precisa do mesmo logger, em `conf.logging`. O chart do Glance tem o mapa, mas nem o filtro nem um lugar para ele em seus pipelines: adicione ambos ao `conf.paste` dele.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

O Atmosphere executa o kube-prometheus-stack com suas próprias regras de alerta, e o Loki com o Vector para os registros. Encaminhe primeiro os alertas dele, depois uma sonda lê as APIs e o agente do Kubernetes enxerga os pods.

### Encaminhe o que está disparando no Atmosphere

O Atmosphere traz regras de alerta que já acionaram pessoas de verdade, então isso funciona desde a primeira hora. Adicione o receptor à sua configuração do Atmosphere, ao lado de quaisquer receptores que você já tenha, e implante:

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

### Leia as APIs e veja os pods no Atmosphere

Abra **OpenStack → Todas as nuvens**, clique em **Conectar nuvem** e informe o endereço do Keystone, uma credencial de aplicação e a sonda a usar. Uma sonda só fala HTTPS com a nuvem. Depois siga **Kubernetes → Documentação** para o cluster em que o Atmosphere executa.

Para ter também os registros desses serviços na página **Registros** desta nuvem, com cada stack trace como um único registro, informe a nuvem nos values do agente, com os namespaces em que seus serviços executam:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Quem fez o quê no Atmosphere

A trilha de auditoria do Keystone e o filtro de auditoria de cada API, em [Eventos de segurança](/docs/telemetry/openstack#quem-fez-o-quê). Cada um escreve no registro do próprio serviço, sem nenhum consumidor no barramento. O OneUptime os lê de lá depois que **Encontrar eventos de segurança nos seus logs** é ativado, em **Eventos de segurança → Conexões**. O agente do Kubernetes lê ambos dos registros dos pods, com a nuvem informada nos seus values.

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

Isso envia uma linha para cada login, que **OpenStack admin credential used from a new address** lê. Para enviar apenas os logins que falharam, adicione `identity.authenticate.success` a `notification_opt_out`, e essa detecção passa a ler o que o filtro de auditoria viu.

Para saber quem fez o quê pelo Nova, Neutron e Cinder, os charts que o Atmosphere implanta já têm o filtro de auditoria em cada pipeline, e é preciso dizer onde escrever, em `nova_helm_values`, `neutron_helm_values` e `cinder_helm_values`. O chart do Glance não tem nem o filtro nem um lugar para ele em seus pipelines: adicione ambos ao `conf.paste` dele, em `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

O Sunbeam pode implantar a Canonical Observability Stack, com `sunbeam enable observability embedded`. A Canonical também tem um charm `openstack-exporter`, que o agente pode ler se você o executar. A documentação do próprio Sunbeam não menciona esse charm, e nada aqui foi executado no Sunbeam.

### Encaminhe o que está disparando no Sunbeam

Se você executa a Canonical Observability Stack, dê ao Alertmanager dela uma configuração com o receptor:

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

### O charm do exportador

Se você executa o charm `openstack-exporter` da Canonical, o agente pode lê-lo sem nenhuma credencial própria. Ele responde por uma nuvem em `/metrics`, na porta `9180`, a menos que você tenha alterado a configuração `port` dele. Encontre o endereço dele com `juju status openstack-exporter`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Quais séries ele informa depende da versão do exportador no snap dele, que não foi registrada aqui: `bash troubleshoot.sh` informa se ele lê a nuvem.

### Registros de serviço no Sunbeam

Com a observabilidade ativada, o Loki da stack guarda os registros dos serviços. O OneUptime não tem como ler o Loki, e o perfil de logs do agente não foi testado nos charms do Sunbeam, então nada aqui os coleta ainda.

### Quem fez o quê no Sunbeam

Ainda não. Os charms do Sunbeam escrevem a configuração de cada serviço a partir de seus próprios templates, e o charm do Keystone dele não tem configuração para o destino das notificações. Portanto, nem a trilha de auditoria do Keystone nem o filtro de auditoria podem ser ativados de fora do charm, e nada aqui chega aos Eventos de segurança.

## Red Hat OpenStack on OpenShift

O Telemetry Operator dele executa o exportador Prometheus do Ceilometer e uma stack de monitoramento com Alertmanager no OpenShift. O preset OpenShift do agente do Kubernetes observa o plano de controle, e o exportador do Ceilometer diz o que os nós de computação estão fazendo.

### Encaminhe o que está disparando no Red Hat OpenStack on OpenShift

Se o `MetricStorage` tem `alertingEnabled` e você escreveu ou aplicou regras, aplique um receptor que a stack de monitoramento reconheça:

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

### Leia as APIs e o plano de controle

Abra **OpenStack → Todas as nuvens**, clique em **Conectar nuvem** e informe o endereço do Keystone, uma credencial de aplicação e a sonda a usar. Uma sonda só fala HTTPS com a nuvem. Depois siga **Kubernetes → Documentação** no cluster que executa o plano de controle, com **Red Hat OpenShift** escolhido, o que define `preset=openshift`.

Para ter também os registros desses serviços na página **Registros** desta nuvem, com cada stack trace como um único registro, informe a nuvem nos values do agente, com os namespaces em que seus serviços executam:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Leia os nós de computação pelo Ceilometer

Uma sonda diz o que está alocado, não o que está ocupado. Para ler o uso real, execute o agente em uma máquina que alcance os nós de computação, com `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` nomeando cada nó na porta do Ceilometer, `9101`.

### Quem fez o quê no Red Hat OpenStack on OpenShift

A trilha de auditoria do Keystone e o filtro de auditoria de cada API, em [Eventos de segurança](/docs/telemetry/openstack#quem-fez-o-quê). Cada um escreve no registro do próprio serviço, sem nenhum consumidor no barramento. O OneUptime os lê de lá depois que **Encontrar eventos de segurança nos seus logs** é ativado, em **Eventos de segurança → Conexões**. O agente do Kubernetes lê ambos dos registros dos pods, com a nuvem informada nos seus values.

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

Isso envia uma linha para cada login, que **OpenStack admin credential used from a new address** lê. Para enviar apenas os logins que falharam, adicione `identity.authenticate.success` a `notification_opt_out`, e essa detecção passa a ler o que o filtro de auditoria viu.

Para saber quem fez o quê pelo Nova e Neutron, cada um recebe a configuração do filtro em seu `customServiceConfig`, e seu arquivo paste em `defaultConfigOverwrite`. Os operators do Cinder e do Glance não aceitam arquivo paste, então nada aqui chega a eles.

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

O StackLight já observa os serviços do OpenStack, o MariaDB, o Memcached, o RabbitMQ e o libvirt, com suas próprias regras de alerta. Encaminhe primeiro os alertas dele, depois uma sonda lê as APIs.

### Encaminhe o que está disparando no Mirantis MOSK

O StackLight traz regras de alerta, então isso funciona desde a primeira hora. Adicione o receptor e sua rota aos values do seu StackLight. A documentação da Mirantis mostra outros receptores em vez de um webhook, e isso não foi executado no MOSK:

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

### Leia as APIs

Abra **OpenStack → Todas as nuvens**, clique em **Conectar nuvem** e informe o endereço do Keystone, uma credencial de aplicação e a sonda a usar. Uma sonda só fala HTTPS com a nuvem.

### Quem fez o quê no Mirantis MOSK

Para saber quem fez o quê pelo Nova, Neutron, Cinder e Glance, o MOSK tem uma configuração própria, com o filtro de auditoria já no lugar. Com o driver de log, cada serviço escreve na sua saída padrão, e o agente do Kubernetes lê isso dos registros dos pods, com a nuvem informada nos seus values. Cada um escreve no registro do próprio serviço, sem nenhum consumidor no barramento. O OneUptime os lê de lá depois que **Encontrar eventos de segurança nos seus logs** é ativado, em **Eventos de segurança → Conexões**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

Essa configuração não cobre o Keystone. A trilha de auditoria dele usa `spec:services`, que a Mirantis não valida e pelo qual não assume responsabilidade, então avalie isso junto ao seu contrato de suporte:

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

Isso envia uma linha para cada login, que **OpenStack admin credential used from a new address** lê. Para enviar apenas os logins que falharam, adicione `identity.authenticate.success` a `notification_opt_out`, e essa detecção passa a ler o que o filtro de auditoria viu.

## Use o exportador que você já executa

Nenhuma credencial e nada novo para executar: o agente pode ler um exportador que você já tem. Como depende de como ele foi iniciado.

- **Com `--multi-cloud`,** como o do próprio agente executa: defina `OPENSTACK_EXPORTER_ADDRESS`, e o agente pede a ele um serviço por vez em `/probe`.
- **Sem ele,** como o do Kolla-Ansible e o charm da Canonical executam: ele não tem `/probe`, então defina `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`, e o agente pede a ele tudo de uma vez em `/metrics`, a cada 2 minutos.

No Kolla-Ansible, esse é o VIP interno dele na `9198`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Essa varredura se soma ao próprio Prometheus do Kolla-Ansible perguntando a cada minuto. O Kolla-Ansible fixa o exportador 1.7.0, e a resposta dele também diz menos do que o exportador que o agente fixa. Isto é o que as páginas deixaram de ter em cinco nuvens reais, e um teste as confronta com essas gravações:

| Fica sem | Porque | O que custa |
| --- | --- | --- |
| Tudo do Cinder | Ele pede ao catálogo o `volumev3` e não encontra nada assim onde o Cinder se registra como `block-storage` | **Volumes** e **Pools de armazenamento** ficam vazios, e **Serviços** não tem Block Storage API, `cinder-volume` nem `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** e **Volume Stuck** ficam em silêncio |
| Quantas instâncias um hipervisor guarda e seus agregados | A lista de hipervisores do Nova falha na microversão mais nova, que o Kolla-Ansible pede | Esses dois em **Hipervisores**, e o que um host perdido diz que leva consigo. Seus vCPUs, memória e disco continuam lá: vêm do Placement |
| Domínios | Ele não tem essa série | **Domínios** fica vazio |
| Status, visibilidade e data de criação de uma imagem | Ele não tem esses rótulos | Essas colunas em **Imagens**. **Image Stuck** fica em silêncio, então uma imagem presa a caminho de `active` passa despercebida |
| O MTU de uma rede | Ele não tem esse rótulo | Essa linha na página de uma rede |

Se você precisa deles, use o exportador do próprio agente. Você pode mudar de ideia depois: uma nuvem mantém seu nome, qualquer que seja o exportador que a leia.
