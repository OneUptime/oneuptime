# OpenStack por herramienta de despliegue

Nadie ejecuta «OpenStack». Ejecutan una herramienta que lo despliega, y cada herramienta tiene sus propias rutas, sus propios registros y su propia idea de lo que ya está en ejecución. Esta página es lo que dice la guía de configuración de OneUptime para cada una: abre **OpenStack → All Clouds**, conecta una nube y responde a **¿Cómo despliegas OpenStack?**

:::cards
- [Hasta dónde se ha probado cada guía](#hasta-dónde-se-ha-probado-cada-guía): Léelo primero. La de Kolla-Ansible se ha ejecutado en un despliegue real, salvo una alerta. La de OpenStack-Ansible se ha ejecutado en parte. Las demás no.
- [Reenviar lo que ya está disparado](#reenviar-lo-que-ya-está-disparado): Incidentes desde la primera hora, sin agente.
- [Kolla-Ansible](#kolla-ansible): Lee los exportadores que ya ejecuta.
- [OpenStack-Ansible](#openstack-ansible): Registros de journald y anulaciones en `user_variables.yml`.
- [OpenStack-Helm](#openstack-helm) y [Atmosphere](#atmosphere): Una sonda y el agente de Kubernetes.
- [Canonical Sunbeam](#canonical-sunbeam): La Canonical Observability Stack.
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): El preajuste de OpenShift y Ceilometer.
- [Mirantis MOSK](#mirantis-mosk): Las alertas de StackLight.
- [Usar el exportador que ya ejecutas](#usar-el-exportador-que-ya-ejecutas): Lo que las páginas no tienen en la 1.7.0.
:::

## Hasta dónde se ha probado cada guía

Cada ruta, puerto y variable de abajo se leyó del código fuente o la documentación de la propia herramienta. El banco de pruebas que registra los fixtures de OneUptime también despliega Kolla-Ansible y OpenStack-Ansible en un ejecutor de CI, y ejecuta allí los propios comandos de sus guías, con un sustituto de OneUptime que conserva lo que envía el agente. Así que ninguna guía de aquí ha informado a un OneUptime en ejecución desde un despliegue real de su herramienta. Contra qué se ha comprobado cada una:

| Herramienta | Leído de | Ejecutado de verdad |
| --- | --- | --- |
| Kolla-Ansible | Su código fuente, en master y en `stable/2026.1` | Los comandos de esta guía, en un all-in-one real en `stable/2026.1` con Open vSwitch: el agente con cada credencial, sin Docker, sobre el propio exportador de Kolla-Ansible y sobre el tuyo en la versión fijada y en la 1.7.0, los destinos leídos de su `prometheus.yml` real, y el perfil de registros. Una parte no se sostuvo: con Memcached y nova-compute detenidos allí, su Alertmanager no publicó nada, así que ninguna alerta ha ido de una pila de Kolla-Ansible a OneUptime. Lo que publica Alertmanager en la versión que fija, registrado en un clúster de pruebas, sí abrió y resolvió un incidente en la nube correcta en un OneUptime en ejecución |
| OpenStack-Ansible | Su código fuente y su documentación | Un all-in-one real en `stable/2026.1`, en contenedores LXC, donde se aplicaron con sus comandos los ajustes de RabbitMQ y HAProxy de esta guía y cada exportador respondió, y su perfil de registros leyó el journal. Sus pasos del agente no se han ejecutado en él: el agente y su perfil de registros se ejecutaron en una nube que esta herramienta no desplegó |
| OpenStack-Helm | Los valores de sus charts | La sonda y el agente de Kubernetes, cada uno por separado |
| Atmosphere | Su documentación y código fuente | La sonda y el agente de Kubernetes, cada uno por separado |
| Canonical Sunbeam | La documentación de Canonical y el código fuente de sus charms | Nada en Sunbeam. La documentación de Sunbeam no menciona el charm del exportador |
| Red Hat OpenStack on OpenShift | El código fuente del Telemetry Operator | El preajuste de OpenShift y el exportador de Ceilometer, cada uno por separado |
| Mirantis MOSK | La documentación de Mirantis, cuyos ejemplos muestran otros receptores en lugar de un webhook | Nada en MOSK |

Lo que activa **Quién hizo qué** en cada guía se registró en DevStack, en cada versión que ejecuta el banco de pruebas, y en ninguna de estas herramientas. Dónde lo activa cada herramienta se leyó del código fuente o la documentación de esa herramienta.

Además de eso, todo el recorrido se ha ejecutado en un OneUptime en vivo, iniciado como lo inicia Docker Compose, con su app y su sonda compilados a partir de este código, y en un DevStack real en lugar de en cualquiera de estas herramientas. El agente, instalado con los comandos de su documentación, registró la nube desde sus primeros datos, y cada instancia, volumen e hipervisor tuvo una fila con el estado que le dio la propia nube. Con `nova-compute` realmente detenido, su fila pasó a caída, un monitor de la plantilla Compute Service Down abrió un incidente que nombraba al host 746 segundos después, y se resolvió 48 segundos después de que el servicio arrancara de nuevo. La sonda de un proyecto conectó la misma nube a través de las propias rutas del panel y leyó sus filas, y los 114 spans de un arranque firmado llegaron a través de sus servicios, desde el perfil de trazas.

Por separado, lo que enviaron un agente real y un Alertmanager real se registró en DevStack y en un clúster de pruebas, no en una nube desplegada por ninguna de estas herramientas. Enviado a un OneUptime en vivo, el webhook de disparo abrió un incidente en la nube correcta y en ninguna otra, el mismo webhook de nuevo no abrió nada, y el webhook de resolución lo resolvió.

## Reenviar lo que ya está disparado

Cualquier herramienta con un Alertmanager puede tener incidentes hoy: una alerta que se dispara se convierte en un incidente, con guardias y páginas de estado desde la primera hora, y se resuelve cuando lo hace la alerta. No hay nada que instalar, y esto funciona junto con todo lo demás de esta página.

:::steps
### Crea el monitor

Crea un monitor de Incoming Request como indica [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#recibir-alertas-con-un-monitor) y copia su **URL de latido**. Esa es la dirección `<secret key>` en el receptor de cada herramienta de abajo.

### Ponlo en la nube

Abre **Overview → Linked Resources** del monitor y añade la nube de OpenStack. Cada incidente aparece entonces en la página de **Incidentes** de esa nube: los propios ajustes de un monitor de Incoming Request no nombran ninguna nube, así que el Alertmanager de cada nube necesita un monitor propio. La nube aparece en esa lista cuando llegan sus primeros datos, así que haz esto después de los pasos de abajo, o añade antes la nube en **OpenStack → All Clouds**.
:::

Se ha registrado a Alertmanager publicando exactamente con esta forma en `Tests/Ops/openstack-e2e`, en la versión que fija Kolla-Ansible, y el registro se reproduce a través del evaluador real: un incidente por alerta, resuelto por su propio estado `resolved`.

## Kolla-Ansible

Con `enable_prometheus` activado en `/etc/kolla/globals.yml`, que Kolla-Ansible deja desactivado hasta que lo configuras, ejecuta Prometheus, Alertmanager y un exportador para cada cosa que hay bajo la nube, y no incluye reglas de alerta. Esta guía lee lo que esos ejecutan en lugar de iniciar una segunda copia.

### Reenviar lo que se dispara en Kolla-Ansible

Solo si escribiste tus propias reglas: Kolla-Ansible no incluye ninguna, así que nada se dispara hasta que `/etc/kolla/config/prometheus/*.rules` contenga algunas. En el host desde el que despliegas, escribe `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, que Kolla-Ansible lee en lugar del suyo, y aplícalo:

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

### La credencial en Kolla-Ansible

Inicia sesión como administrador con `source /etc/kolla/admin-openrc.sh`, que escribe `kolla-ansible post-deploy`.

- **Vista completa** necesita un cambio, en Cinder. Las plantillas de Kolla-Ansible ya definen `service_type` bajo `[keystone_authtoken]` en Nova, Neutron, Glance y Placement, pero su Cinder dice `volume` y su catálogo dice `block-storage`, y keystonemiddleware rechaza con un `401` una credencial limitada por reglas de acceso si ambos no coinciden. Añada `service_type = block-storage` bajo `[keystone_authtoken]` en `/etc/kolla/config/cinder.conf` y ejecute `kolla-ansible reconfigure -i <inventory> --tags cinder`.
- **Solo infraestructura** toma sus anulaciones en `/etc/kolla/config/nova/policy.yaml`, y lo mismo para `neutron`, `keystone` y `placement`, combinadas con lo que ya haya allí. Aplícalas con `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.

### Vigilar sobre qué se sostiene la nube de Kolla-Ansible

En el host que ejecuta el Prometheus de Kolla-Ansible, esto lee sus destinos del archivo que renderizó Kolla-Ansible y los imprime como ajustes para el agente:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Añade lo que imprime al `.env` del agente y luego ejecuta `docker compose up -d` en la carpeta del agente. Cada exportador escucha en la red de las API, así que la máquina del agente necesita una ruta hasta allí. La tarjeta **Plano de control** de la nube indica entonces cómo está cada uno, y dice claramente cuáles no se vigilan.

| Lee | Puerto | Ajuste |
| --- | --- | --- |
| El plugin de Prometheus de RabbitMQ | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| El exportador propio de HAProxy | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| openstack-network-exporter, para OVN y Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **Las bases de datos de OVN:** Kolla-Ansible ejecuta openstack-network-exporter desde la 2026.1, solo en los nodos de cómputo y de red, y una base de datos de OVN se lee desde el host en el que se ejecuta. Si tus nodos de control no son ninguna de las dos cosas, añádelos bajo `[prometheus-openstack-network-exporter:children]` en tu inventario y reconfigura, o las bases de datos Northbound y Southbound figurarán como no vigiladas.
- **Antes de la 2026.1** no hay exportador de red, así que OVN y Open vSwitch figuran como no vigilados.

### Registros de servicios en Kolla-Ansible

El perfil de registros del agente se ejecuta en cada nodo y lee los archivos de Kolla-Ansible. Es lo que vincula una línea con las páginas de la nube:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

El propio Fluentd de Kolla también puede reenviar, con una salida en `/etc/kolla/config/fluentd/output/*.conf` como describe [Fluentd](/docs/telemetry/fluentd), pero esos registros llegan a **Registros** bajo el nombre de un servicio, y no a las páginas de la nube.

### Quién hizo qué en Kolla-Ansible

El rastro de auditoría de Keystone y el filtro de auditoría de cada API, hacia [Eventos de seguridad](/docs/telemetry/openstack#quién-hizo-qué). Cada uno escribe en el propio registro del servicio, sin ningún consumidor en el bus. OneUptime los lee desde allí una vez activado **Encontrar eventos de seguridad en tus registros**, en **Security Events → Connections**. El perfil de registros del agente lee ambos desde `/var/log/kolla`.

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

Esto envía una línea por cada inicio de sesión, que lee **OpenStack admin credential used from a new address**. Para enviar solo los inicios de sesión fallidos, añade `identity.authenticate.success` a `notification_opt_out`, y esa detección lee entonces lo que vio el filtro de auditoría.

Para saber quién hizo qué a través de Nova, Neutron, Cinder y Glance, el filtro de auditoría necesita un ajuste, que va de una vez en la configuración de todos los servicios:

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

También necesita un archivo paste, y las tareas de configuración de Kolla-Ansible no copian ningún archivo paste para estos servicios. Pon el tuyo en cada host de API y móntalo sobre el de la imagen con `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` y `glance_api_extra_volumes` en `globals.yml`. Los archivos de mapa de pyCADF están en `/var/lib/kolla/venv/etc/pycadf` en la imagen. [Quién hizo qué](/docs/telemetry/openstack#activa-el-filtro-de-auditoría) tiene las líneas del filtro.

## OpenStack-Ansible

OpenStack-Ansible guarda los registros de sus servicios en journald y no ejecuta ningún Prometheus propio, así que el agente es la vía de entrada, y los registros tienen un camino propio.

### La credencial en OpenStack-Ansible

Inicia sesión como administrador desde el contenedor de utilidades: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)` y luego `. ~/openrc`. No tiene `curl`, que usan los comandos de abajo, así que ejecuta antes `apt-get install -y curl` allí.

- **Vista completa** necesita un cambio, en Cinder. Los roles de OpenStack-Ansible ya definen `service_type` bajo `[keystone_authtoken]`, pero su Cinder dice `volumev3` y su catálogo dice `block-storage`, y keystonemiddleware rechaza con un `401` una credencial limitada por reglas de acceso si ambos no coinciden. Defina `service_type: block-storage` bajo `keystone_authtoken` en `cinder_cinder_conf_overrides`, dentro de `/etc/openstack_deploy/user_variables.yml`, y ejecute `openstack-ansible openstack.osa.cinder --tags cinder-config`.
- **Solo infraestructura** toma sus anulaciones como `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` y `placement_policy_overrides` en `/etc/openstack_deploy/user_variables.yml`. Aplica cada una con su propio playbook y etiqueta, como `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Quitar una más tarde deja un archivo vacío en lugar de ninguno, así que nada falla.

### Vigilar sobre qué se sostiene la nube de OpenStack-Ansible

OpenStack-Ansible no ejecuta ningún exportador para estos, así que solo se vigila lo que actives.

**RabbitMQ:** activa su plugin de Prometheus y luego nombra la dirección de cada contenedor en `15692` como `OPENSTACK_RABBITMQ_TARGETS` en el `.env` del agente:

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** su exportador está desactivado, y su listener de estadísticas está en `127.0.0.1` con TLS, que el agente no puede leer. Actívalo donde el agente pueda y luego nombra esa dirección en `1936` como `OPENSTACK_HAPROXY_TARGETS`:

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB y Memcached:** OpenStack-Ansible no incluye exportador para ninguno de los dos. Ejecuta tú mismo [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) y [memcached_exporter](https://github.com/prometheus/memcached_exporter) y nómbralos como `OPENSTACK_MARIADB_TARGETS` y `OPENSTACK_MEMCACHED_TARGETS`, o déjalos fuera: la tarjeta **Plano de control** de la nube dirá entonces que no se vigilan, en lugar de que están bien.

### Registros de servicios en OpenStack-Ansible

Desde journald, en cada host que ejecuta un servicio: los contenedores pasan sus journals al host.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

Esto ejecuta el perfil de registros del agente como servicio de systemd y lee `/var/log/journal/`, adonde llegan los journals de los contenedores de OpenStack-Ansible.

### Quién hizo qué en OpenStack-Ansible

El rastro de auditoría de Keystone y el filtro de auditoría de cada API, hacia [Eventos de seguridad](/docs/telemetry/openstack#quién-hizo-qué). Cada uno escribe en el propio registro del servicio, sin ningún consumidor en el bus. OneUptime los lee desde allí una vez activado **Encontrar eventos de seguridad en tus registros**, en **Security Events → Connections**. El perfil de registros del agente lee ambos desde el journal.

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

Esto envía una línea por cada inicio de sesión, que lee **OpenStack admin credential used from a new address**. Para enviar solo los inicios de sesión fallidos, añade `identity.authenticate.success` a `notification_opt_out`, y esa detección lee entonces lo que vio el filtro de auditoría. Un segundo valor de `notification_opt_out` se introduce como un conjunto YAML, tal como [su config_template](https://docs.openstack.org/ansible-config_template/latest/) escribe una clave repetida.

Para saber quién hizo qué a través de Nova, Neutron, Cinder y Glance, cada API toma el ajuste del filtro en sus anulaciones de conf, y el filtro en sus anulaciones de paste, con `audit` justo después de `authtoken` y del filtro de contexto que le sigue en cada pipeline. El de Nova, y lo mismo en `neutron_neutron_conf_overrides` y `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` y `cinder_api_paste_ini_overrides`, y `glance_glance_api_conf_overrides` y `glance_glance_api_paste_ini_overrides`:

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

OpenStack-Helm ofrece charts para Prometheus, Alertmanager y exportadores, y que estén en ejecución depende de ti. Su plano de control se ejecuta en Kubernetes, así que una sonda lee las API y el agente de Kubernetes ve los pods.

### Reenviar lo que se dispara en OpenStack-Helm

Si ejecutas su chart prometheus-alertmanager, añade el receptor bajo `conf.alertmanager` en los valores del chart y envíale tu ruta:

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

### Leer las API y ver los pods en OpenStack-Helm

Abre **OpenStack → All Clouds**, haz clic en **Conectar nube** y dale la dirección de Keystone, una credencial de aplicación y la sonda que usar. Una sonda solo habla HTTPS con una nube. Luego sigue **Kubernetes → Documentación** para el clúster en el que se ejecutan los charts: sus pods, sus registros y sus nodos llegan a las páginas de Kubernetes.

Para tener también los registros de esos servicios en la página de **Registros** de esta nube, con cada traza de pila como un solo registro, nombra la nube en los valores del agente, con los namespaces en los que se ejecutan sus servicios:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Quién hizo qué en OpenStack-Helm

El rastro de auditoría de Keystone y el filtro de auditoría de cada API, hacia [Eventos de seguridad](/docs/telemetry/openstack#quién-hizo-qué). Cada uno escribe en el propio registro del servicio, sin ningún consumidor en el bus. OneUptime los lee desde allí una vez activado **Encontrar eventos de seguridad en tus registros**, en **Security Events → Connections**. El agente de Kubernetes lee ambos desde los registros de los pods, con la nube nombrada en sus valores.

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

Esto envía una línea por cada inicio de sesión, que lee **OpenStack admin credential used from a new address**. Para enviar solo los inicios de sesión fallidos, añade `identity.authenticate.success` a `notification_opt_out`, y esa detección lee entonces lo que vio el filtro de auditoría.

El `logging.conf` de un chart mantiene el logger raíz en `WARNING`, y el driver de log escribe bajo un logger propio, así que sin uno para él no se escribe nada. Una lista en values reemplaza la del chart, así que `keys` contiene lo que contiene la del chart, más esto:

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

Para saber quién hizo qué a través de Nova, Neutron y Cinder, el `conf.paste` de sus charts ya tiene el filtro de auditoría en cada pipeline, y hay que indicarle dónde escribir. Cada uno necesita el mismo logger, en `conf.logging`. El chart de Glance tiene el mapa, pero ni el filtro ni un lugar para él en sus pipelines: añade ambos a su `conf.paste`.

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere ejecuta kube-prometheus-stack con sus propias reglas de alerta, y Loki con Vector para los registros. Reenvía primero sus alertas; después una sonda lee las API y el agente de Kubernetes ve los pods.

### Reenviar lo que se dispara en Atmosphere

Atmosphere incluye reglas de alerta que han avisado a personas reales, así que esto funciona desde la primera hora. Añade el receptor a tu configuración de Atmosphere, junto a los receptores que ya tengas, y despliégala:

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

### Leer las API y ver los pods en Atmosphere

Abre **OpenStack → All Clouds**, haz clic en **Conectar nube** y dale la dirección de Keystone, una credencial de aplicación y la sonda que usar. Una sonda solo habla HTTPS con una nube. Luego sigue **Kubernetes → Documentación** para el clúster en el que se ejecuta Atmosphere.

Para tener también los registros de esos servicios en la página de **Registros** de esta nube, con cada traza de pila como un solo registro, nombra la nube en los valores del agente, con los namespaces en los que se ejecutan sus servicios:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Quién hizo qué en Atmosphere

El rastro de auditoría de Keystone y el filtro de auditoría de cada API, hacia [Eventos de seguridad](/docs/telemetry/openstack#quién-hizo-qué). Cada uno escribe en el propio registro del servicio, sin ningún consumidor en el bus. OneUptime los lee desde allí una vez activado **Encontrar eventos de seguridad en tus registros**, en **Security Events → Connections**. El agente de Kubernetes lee ambos desde los registros de los pods, con la nube nombrada en sus valores.

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

Esto envía una línea por cada inicio de sesión, que lee **OpenStack admin credential used from a new address**. Para enviar solo los inicios de sesión fallidos, añade `identity.authenticate.success` a `notification_opt_out`, y esa detección lee entonces lo que vio el filtro de auditoría.

Para saber quién hizo qué a través de Nova, Neutron y Cinder, los charts que despliega Atmosphere ya tienen el filtro de auditoría en cada pipeline, y hay que indicarle dónde escribir, en `nova_helm_values`, `neutron_helm_values` y `cinder_helm_values`. El chart de Glance no tiene ni el filtro ni un lugar para él en sus pipelines: añade ambos a su `conf.paste`, en `glance_helm_values`.

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam puede desplegar la Canonical Observability Stack, con `sunbeam enable observability embedded`. Canonical también tiene un charm `openstack-exporter`, que el agente puede leer si lo ejecutas. La documentación de Sunbeam no menciona ese charm, y nada de lo que hay aquí se ha ejecutado en Sunbeam.

### Reenviar lo que se dispara en Sunbeam

Si ejecutas la Canonical Observability Stack, dale a su Alertmanager una configuración que incluya el receptor:

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

### El charm del exportador

Si ejecutas el charm `openstack-exporter` de Canonical, el agente puede leerlo sin credencial propia. Responde por una sola nube en `/metrics`, en el puerto `9180` a menos que cambiaras su ajuste `port`. Encuentra su dirección con `juju status openstack-exporter`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Qué series dice depende de la versión del exportador en su snap, que no se registró aquí: `bash troubleshoot.sh` indica si lee la nube.

### Registros de servicios en Sunbeam

Con la observabilidad activada, el Loki de la pila contiene los registros de los servicios. OneUptime no tiene forma de leer Loki, y el perfil de registros del agente no se ha probado en los charms de Sunbeam, así que nada de lo que hay aquí los recopila todavía.

### Quién hizo qué en Sunbeam

Todavía no. Los charms de Sunbeam escriben la configuración de cada servicio a partir de sus propias plantillas, y su charm de Keystone no tiene ningún ajuste para indicar adónde van las notificaciones. Así que ni el rastro de auditoría de Keystone ni el filtro de auditoría pueden activarse desde fuera del charm, y nada de lo que hay aquí llega a Eventos de seguridad.

## Red Hat OpenStack on OpenShift

Su Telemetry Operator ejecuta el exportador de Prometheus de Ceilometer y una pila de monitorización con Alertmanager en OpenShift. El preajuste de OpenShift del agente de Kubernetes vigila el plano de control, y el exportador de Ceilometer dice qué hacen los nodos de cómputo.

### Reenviar lo que se dispara en Red Hat OpenStack on OpenShift

Si `MetricStorage` tiene `alertingEnabled` y escribiste o aplicaste reglas, aplica un receptor que la pila de monitorización recoja:

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

### Leer las API y el plano de control

Abre **OpenStack → All Clouds**, haz clic en **Conectar nube** y dale la dirección de Keystone, una credencial de aplicación y la sonda que usar. Una sonda solo habla HTTPS con una nube. Luego sigue **Kubernetes → Documentación** en el clúster que ejecuta el plano de control, con **Red Hat OpenShift** elegido, lo que establece `preset=openshift`.

Para tener también los registros de esos servicios en la página de **Registros** de esta nube, con cada traza de pila como un solo registro, nombra la nube en los valores del agente, con los namespaces en los que se ejecutan sus servicios:

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Leer los nodos de cómputo a través de Ceilometer

Una sonda dice qué está asignado, no qué está ocupado. Para leer el uso real, ejecuta el agente en una máquina que pueda alcanzar los nodos de cómputo, con `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` nombrando cada nodo en el puerto de Ceilometer, `9101`.

### Quién hizo qué en Red Hat OpenStack on OpenShift

El rastro de auditoría de Keystone y el filtro de auditoría de cada API, hacia [Eventos de seguridad](/docs/telemetry/openstack#quién-hizo-qué). Cada uno escribe en el propio registro del servicio, sin ningún consumidor en el bus. OneUptime los lee desde allí una vez activado **Encontrar eventos de seguridad en tus registros**, en **Security Events → Connections**. El agente de Kubernetes lee ambos desde los registros de los pods, con la nube nombrada en sus valores.

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

Esto envía una línea por cada inicio de sesión, que lee **OpenStack admin credential used from a new address**. Para enviar solo los inicios de sesión fallidos, añade `identity.authenticate.success` a `notification_opt_out`, y esa detección lee entonces lo que vio el filtro de auditoría.

Para saber quién hizo qué a través de Nova y Neutron, cada uno toma el ajuste del filtro en su `customServiceConfig` y su archivo paste en `defaultConfigOverwrite`. Los operadores de Cinder y Glance no aceptan archivo paste, así que nada de lo que hay aquí llega a ellos.

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

StackLight ya vigila los servicios de OpenStack, MariaDB, Memcached, RabbitMQ y libvirt, con sus propias reglas de alerta. Reenvía primero sus alertas; después una sonda lee las API.

### Reenviar lo que se dispara en Mirantis MOSK

StackLight incluye reglas de alerta, así que esto funciona desde la primera hora. Añade el receptor y su ruta a tus valores de StackLight. La documentación de Mirantis muestra otros receptores en lugar de un webhook, y esto no se ha ejecutado en MOSK:

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

### Leer las API

Abre **OpenStack → All Clouds**, haz clic en **Conectar nube** y dale la dirección de Keystone, una credencial de aplicación y la sonda que usar. Una sonda solo habla HTTPS con una nube.

### Quién hizo qué en Mirantis MOSK

Para saber quién hizo qué a través de Nova, Neutron, Cinder y Glance, MOSK tiene un ajuste propio, con el filtro de auditoría ya en su sitio. Con el driver de log, cada servicio escribe en su salida estándar, y el agente de Kubernetes la lee desde los registros de los pods, con la nube nombrada en sus valores. Cada uno escribe en el propio registro del servicio, sin ningún consumidor en el bus. OneUptime los lee desde allí una vez activado **Encontrar eventos de seguridad en tus registros**, en **Security Events → Connections**.

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

Ese ajuste no cubre Keystone. Su propio rastro de auditoría usa `spec:services`, que Mirantis no valida y del que no se hace responsable, así que sopésalo con tu contrato de soporte:

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

Esto envía una línea por cada inicio de sesión, que lee **OpenStack admin credential used from a new address**. Para enviar solo los inicios de sesión fallidos, añade `identity.authenticate.success` a `notification_opt_out`, y esa detección lee entonces lo que vio el filtro de auditoría.

## Usar el exportador que ya ejecutas

Sin credencial y sin nada nuevo que ejecutar: el agente puede leer un exportador que ya tienes. Cómo depende de cómo se inició.

- **Con `--multi-cloud`,** como se ejecuta el del propio agente: define `OPENSTACK_EXPORTER_ADDRESS`, y el agente le pide un servicio cada vez en `/probe`.
- **Sin él,** como se ejecutan el de Kolla-Ansible y el charm de Canonical: no tiene `/probe`, así que define `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`, y el agente le pide todo de una vez en `/metrics`, cada 2 minutos.

En Kolla-Ansible esa es su VIP interna en `9198`:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

Ese recorrido se suma al propio Prometheus de Kolla-Ansible, que pregunta cada minuto. Kolla-Ansible fija el exportador 1.7.0, y su respuesta también dice menos que el exportador que fija el agente. Esto es de lo que las páginas carecían en cinco nubes reales, y una prueba las ajusta a esos registros:

| Se queda sin | Porque | Qué cuesta |
| --- | --- | --- |
| Todo lo de Cinder | Pide al catálogo `volumev3`, y no encuentra nada así donde Cinder se registra como `block-storage` | **Volúmenes** y **Pools de almacenamiento** quedan vacíos, y **Servicios** no tiene Block Storage API, `cinder-volume` ni `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** y **Volume Stuck** quedan en silencio |
| Cuántas instancias contiene un hipervisor y sus agregados | La lista de hipervisores de Nova falla en la microversión más reciente, que es la que pide Kolla-Ansible | Esos dos en **Hipervisores**, y lo que dice que se lleva consigo un host perdido. Sus vCPU, memoria y disco siguen ahí: provienen de Placement |
| Dominios | No tiene esa serie | **Dominios** queda vacío |
| El estado, la visibilidad y la fecha de creación de una imagen | No tiene esas etiquetas | Esas columnas en **Imágenes**. **Image Stuck** queda en silencio, así que una imagen atascada en su camino a `active` pasa inadvertida |
| La MTU de una red | No tiene esa etiqueta | Esa línea en la página de una red |

Si necesitas esos datos, usa en su lugar el exportador propio del agente. Puedes cambiar de opinión más tarde: una nube conserva su nombre sea cual sea el que la lee.
