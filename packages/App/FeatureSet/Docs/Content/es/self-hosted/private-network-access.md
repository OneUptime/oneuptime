# Acceso a red privada

OneUptime se niega a enviar ciertas peticiones salientes a hosts que se resuelven en un rango privado, de loopback o link-local. Si has intentado apuntar un workflow a una herramienta interna, has visto el mensaje:

> Webhook URL resolves to a private, loopback, or link-local address and is not allowed

Ese comportamiento por defecto es el correcto para el producto alojado, donde cualquiera puede registrarse y el destino de un webhook es una entrada no fiable. En una instancia autoalojada estorba en algo cotidiano: publicar una alerta en un Mattermost, un Jira o un sistema de tickets autoalojado que solo existe en tu propia red.

Esta página explica cómo permitirlo, de forma deliberada y acotada. Lo deciden tres interruptores, cada uno para su propio tipo de conexión, y se configuran en máquinas distintas:

| Qué quieres alcanzar internamente | Dónde está el ajuste | Valor por defecto en una instalación autoalojada |
| --- | --- | --- |
| Workflows, webhooks de proyecto, webhooks de usuario de guardia | El entorno del **servidor de API** | Direcciones privadas rechazadas |
| Fuentes de datos, proveedores de LLM, servidores SMTP, descubrimiento OIDC y otras conexiones | El entorno del **servidor de API** | Direcciones privadas permitidas |
| **Monitores** API, Website, External Status Page y Custom JavaScript Code | El entorno propio de la **sonda** | Direcciones privadas rechazadas |

```mermaid title="Tres interruptores, cada uno para su propio tipo de conexión"
flowchart TB
    subgraph Server["El servidor de OneUptime"]
        direction TB
        Webhooks["Workflows y webhooks"]
        Outbound["Fuentes de datos, proveedores de LLM,<br/>SMTP y otras conexiones"]
    end
    subgraph Probe["Cada sonda"]
        Monitors["Monitores API, Website,<br/>External Status Page y<br/>Custom JavaScript Code"]
    end
    Private["Tu red privada"]
    Webhooks -->|"desactivado por defecto"| Private
    Outbound -->|"activado por defecto"| Private
    Monitors -->|"desactivado por defecto"| Private
```

Los tipos de monitor nativos de red, como Ping, Port, Certificado SSL, DNS, DNSSEC, SNMP / Dispositivo de red, Consulta SQL, Salud de base de datos, Synthetic y Network Path, usan sus propios transportes. El ajuste de esta página rige los transportes HTTP que devuelven contenido de respuesta arbitrario a un proyecto: los monitores API, Website, External Status Page y Custom JavaScript Code.

:::cards
- [Webhooks y workflows](#webhooks-y-workflows): Permite que un webhook publique en tu red.
- [Otras conexiones salientes](#otras-conexiones-salientes): Fuentes de datos, proveedores de LLM y servidores de correo.
- [Sondas y monitores](#sondas-y-monitores): Deja que una sonda compruebe sitios privados.
- [Comprobar que funciona](#comprobar-que-funciona): Lee qué interruptor nombra un rechazo.
:::

## Qué está bloqueado y qué se puede desbloquear

Los destinos bloqueados se dividen en dos niveles.

| Nivel | Rangos | ¿Se puede permitir? |
| --- | --- | --- |
| **Privado** | RFC-1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), CGNAT (`100.64.0.0/10`), IPv6 unique-local (`fc00::/7`) y site-local (`fec0::/10`) | Sí |
| **Prohibido** | Loopback (`127.0.0.0/8`, `::1`), la dirección no especificada, link-local (`169.254.0.0/16`, `fe80::/10`), multicast, reservado, broadcast, y los nombres `localhost` y `metadata.google.internal` | Solo nombrando el host o CIDR exacto en la lista de permitidos de webhooks. Nunca para monitores. |

El endpoint de metadatos de la nube `169.254.169.254` está en el nivel prohibido por una razón. En una VM en la nube entrega las credenciales IAM de la instancia a cualquier cosa que pueda hacer una petición HTTP desde la máquina, así que ningún ajuste general lo abrirá nunca.

Las formas de escribir IPv6 que llevan dentro un destino IPv4 – IPv4-mapped (`::ffff:10.0.0.5`), NAT64, 6to4, Teredo – se clasifican por la dirección IPv4 a la que llegan, así que no sirven para colar una dirección prohibida por una autorización del nivel privado.

## Webhooks y workflows

Estos destinos están cubiertos, porque el destino es una URL que escribió un miembro autenticado de tu proyecto:

- Los componentes **API** de los workflows (GET / POST / PUT / PATCH / DELETE)
- Las peticiones HTTP que hace el componente de workflow **Custom JavaScript**
- Las notificaciones de webhook del proyecto (incidentes, alertas, monitores, guardia, mantenimiento programado, eventos de páginas de estado)
- Los **webhooks de usuario** de guardia

**No** están cubiertos, ni lo estarán nunca: los **webhooks de suscriptores de páginas de estado**. Cualquier visitante de una página de estado pública puede registrar uno, así que relajar ese destino permitiría a cualquiera en internet hacer que tu servidor envíe POST a tu red privada. Esto no es configurable.

Las conexiones salientes que no son webhooks – fuentes de datos externas, proveedores de LLM, servidores SMTP (los ajustes SMTP de un proyecto y el componente de workflow **Email**), endpoints de tokens OAuth de SMTP, descubrimiento OIDC y pasos HTTP de runbooks – se rigen por separado, mediante `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES`, y ya permiten rangos privados en las instalaciones autoalojadas. Consulta [Otras conexiones salientes](#otras-conexiones-salientes).

### Configurar el servidor de API

Define una o ambas de estas variables en el servidor de API y reinícialo. Están desactivadas por defecto, así que una instancia que no define ninguna se comporta exactamente igual que antes.

| Variable | Valor de Helm | Qué permite |
| --- | --- | --- |
| `ALLOW_PRIVATE_NETWORK_WEBHOOKS` | `webhooks.allowPrivateNetwork` | Todo el nivel privado, cuando vale `true`. |
| `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | `webhooks.privateNetworkAllowlist` | Los hosts y CIDR que nombra, sea cual sea su nivel. |

:::tabs
@tab Docker Compose
```bash title="config.env"
ALLOW_PRIVATE_NETWORK_WEBHOOKS=true
PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=mattermost.internal,*.svc.cluster.local,10.20.0.0/16
```
@tab Kubernetes
```yaml title="values.yaml"
webhooks:
  allowPrivateNetwork: true
  privateNetworkAllowlist: "mattermost.internal,10.20.0.0/16"
```
:::

En Docker Compose, `config.env` tiene una línea `ALLOW_PRIVATE_NETWORK_WEBHOOKS=false`: cámbiala en lugar de añadir una segunda y luego ejecuta `npm run start`. En Kubernetes, actualiza la release.

Las entradas de la lista de permitidos pueden separarse con comas, espacios o saltos de línea, y cada una puede ser:

- un nombre de host – `mattermost.internal`
- un comodín – `*.svc.cluster.local` (coincide con los subdominios, no con el sufijo solo)
- una dirección IPv4 o IPv6 – `10.20.30.40`, `fd00::1`
- un CIDR – `10.20.0.0/16`, `fd12:3456::/32`

El esquema, el puerto, la ruta o la información de usuario de una entrada se eliminan, así que pegar la URL de webhook que ya tienes funciona.

Un nombre de host incluido en la lista de permitidos se acepta **sin comprobación DNS**: ese es precisamente el motivo de nombrarlo, ya que se espera que se resuelva en algo que la lista de bloqueo rechazaría. Una entrada de dirección se compara con el literal de la URL y con cada dirección que el DNS devuelve para ella.

> [!CAUTION]
> **Nunca pongas `169.254.169.254`, ni ningún rango que la contenga, en la lista de permitidos.** En una VM en la nube, eso da a cada miembro del proyecto las credenciales IAM de tu instancia.

## Otras conexiones salientes

Una segunda protección cubre las conexiones salientes cuyo destino elige un miembro del proyecto pero que no son webhooks:

- fuentes de datos externas (conexiones PostgreSQL, MySQL, SQL Server, ClickHouse, Elasticsearch y API REST), conexiones de eventos de seguridad como Splunk y fuentes de threat intel
- proveedores de LLM, incluido un Ollama o vLLM autoalojado
- servidores SMTP – los ajustes SMTP de un proyecto y el componente de workflow **Email** – y las URL de tokens OAuth de SMTP y de workflows
- el descubrimiento OIDC para el inicio de sesión único
- la verificación de dominios personalizados de páginas de estado y paneles
- los pasos HTTP de runbooks
- la URL de la API de Grafana OnCall de la que lee una importación (**Ajustes del proyecto** > **Básico** > **Importar desde otra herramienta**)

Esta protección funciona al revés que los ajustes de webhooks. En una instalación autoalojada **permite** el nivel privado por defecto, porque la base de datos, el servidor de correo o el servidor de modelos a los que se conectan suelen estar en tu propia red. El nivel prohibido – loopback, link-local y el endpoint de metadatos de la nube – se rechaza en cualquier caso, y no existe lista de permitidos para él.

`DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` la endurece. Ponla en `true` para rechazar también el nivel privado en estas conexiones, por ejemplo cuando los proyectos de tu instancia pertenecen a personas que no deberían llegar a tu red interna:

:::tabs
@tab Docker Compose
```bash title="config.env"
DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true
```
@tab Kubernetes
```yaml title="values.yaml"
outboundConnections:
  blockPrivateNetwork: true
```
:::

Este ajuste no se aplica a un proveedor de LLM global, que configura un administrador en lugar de un proyecto (con las variables `GLOBAL_LLM_PROVIDER_*`, el valor `vllm.globalProvider` del chart de Helm, o en el Panel de administración en **Ajustes** > **Proveedores LLM globales**): un proveedor así puede seguir alcanzando direcciones privadas, aunque loopback y link-local también le siguen rechazados.

Solo el valor exacto `true` lo activa. En una instancia con `BILLING_ENABLED=true` está siempre activado, definas lo que definas. No cambia qué destinos permiten los ajustes de webhooks de arriba ni el ajuste de las sondas de abajo; cada barrera se configura por separado. Sí cambia cómo se formulan los rechazos, también para webhooks y peticiones de workflows: con él activado, un nombre de host rechazado se notifica sin decir a qué se resolvió (consulta [Comprobar que funciona](#comprobar-que-funciona)).

En Docker Compose, `config.env` tiene una línea `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=false` (añádela si tu `config.env` es anterior). Cambia esa línea a `true` en lugar de añadir una segunda y luego ejecuta `npm run start` para que los contenedores se vuelvan a crear con el nuevo valor; `docker compose restart` no vuelve a leer `config.env`. En Kubernetes, defínelo en tu archivo de valores y actualiza la release; el chart lo pasa a los pods de la aplicación y del worker.

Con él activado, un nombre de host rechazado se notifica sin decir a qué se resolvió, por ejemplo _"LLM provider host ollama.internal could not be reached."_ Un nombre que no se resuelve en absoluto recibe el mismo mensaje, para que los miembros del proyecto no puedan usar estos campos para averiguar qué nombres internos existen. Una dirección escrita como IP se sigue nombrando junto con el motivo, por ejemplo _"LLM provider host 10.0.4.12 is not allowed: private network address."_ Con `LOG_LEVEL=DEBUG`, la aplicación registra la dirección a la que se resolvió cada nombre rechazado.

## Sondas y monitores

Se ven afectados cuatro tipos de monitor: **API**, **Sitio web**, **Página de estado externa** y **Custom JavaScript Code**. En una sonda estándar pueden alcanzar destinos HTTP(S) públicos, pero rechazan el espacio de direcciones privado. Los monitores API, Website y External Status Page validan y fijan los resultados DNS en cada conexión y revalidan cada redirección; Custom JavaScript Code aplica la misma política de direcciones en el puente de su sandbox.

El interruptor lo lee el **proceso de la sonda desde su propio entorno**, no desde el del servidor de API, y cada sonda lo lee: las incluidas con Docker Compose, las que despliega el chart de Helm y cualquier [sonda personalizada](/docs/probe/custom-probe) que ejecutes tú. Quien despliega una sonda controla su entorno y es quien sabe qué red puede ver esa sonda: una sonda personalizada suele ser otra máquina, a menudo gestionada por otra persona, y nunca lee la configuración del servidor de API.

:::tabs
@tab Docker Compose
`config.env` ya tiene una línea `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=false`: cambia esa línea a `true` en lugar de añadir una segunda, porque cuando una variable aparece dos veces gana la última línea. Después ejecuta `npm run start`, que vuelve a crear los contenedores con el nuevo valor; `docker compose restart` no vuelve a leer `config.env`. Todas las sondas incluidas leen esa misma línea, así que se aplica a `probe-1` y, si tu stack ejecuta una segunda sonda, a `probe-2`.

```bash title="config.env"
PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true
```
@tab Kubernetes
Defínelo por sonda en tu archivo de valores y actualiza la release. Cada entrada bajo `probes:` es una sonda distinta, así que defínelo en cada una que deba alcanzar direcciones privadas:

```yaml title="values.yaml"
probes:
  one:
    allowPrivateNetworkMonitors: true
```
:::

En una sonda personalizada, define `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` en el entorno propio de esa sonda y reiníciala. El valor debe ser exactamente `true`; cualquier otro, como `TRUE` o `1`, deja el interruptor desactivado, y la sonda lo indica con una advertencia al arrancar, sea cual sea el valor de `LOG_LEVEL`.

Las sondas incluidas son **sondas globales**: se registran con el `REGISTER_PROBE_KEY` de la instancia, y cualquier proyecto de la instancia puede seleccionarlas. Activar el interruptor en una sonda incluida permite, por tanto, que los monitores de **cada proyecto de la instancia** alcancen direcciones privadas a través de ella. Eso es normalmente lo que quiere una instalación de un solo equipo. Donde los proyectos no deban compartir ese alcance – equipos separados o clientes que alojas –, déjalo desactivado en las sondas incluidas y despliega en su lugar una sonda privada (personalizada) dentro de cada red, activada solo allí.

Hay una excepción. Una sonda que se registra con `REGISTER_PROBE_KEY` y tiene `BILLING_ENABLED=true` en su propio entorno – una sonda global del producto alojado con registro abierto, donde cualquiera puede registrarse y todos los proyectos comparten las sondas globales – sigue siendo solo pública incluso con el interruptor activado, y registra al arrancar una advertencia de que no lo tiene en cuenta. Las sondas incluidas con Docker Compose y el chart de Helm reciben automáticamente el `BILLING_ENABLED` de la instancia; dáselo a cualquier otra sonda `REGISTER_PROBE_KEY` que ejecutes para una instancia así. Una sonda no puede saber de ninguna otra forma que es global, así que una sonda global creada en el Panel de administración y ejecutada con `PROBE_ID` y `PROBE_KEY` respeta el interruptor como una privada: no lo actives allí si los proyectos no deben compartir la red de esa sonda. Una sonda privada respeta el interruptor en cualquier instancia.

Cada sonda registra al arrancar su política efectiva de red privada: si la supervisión de red privada está activada o desactivada, y por qué. Un valor que no se tiene en cuenta, y una sonda global que el interruptor abre a todos los proyectos, se registran como advertencias con cualquier `LOG_LEVEL`. La línea habitual de activado o desactivado, y el JSON «Probe environment» que registra la misma decisión bajo `privateNetworkMonitors`, se registran con `LOG_LEVEL=INFO`, el valor predeterminado del chart de Helm; Docker Compose se distribuye con `LOG_LEVEL=ERROR`, así que define `LOG_LEVEL=INFO` para verlos allí. Revisa primero ese registro cuando un monitor en una sonda que acabas de cambiar sigue siendo rechazado.

Activarlo **no** abre el loopback, el link-local ni el endpoint de metadatos de la nube. Esos siguen rechazados en todas las sondas, lo que importa sobre todo en las sondas que se ejecutan en una red que no pertenece al autor del monitor.

> [!WARNING]
> Déjalo desactivado en las sondas que operas en nombre de otras personas.

## Comprobar que funciona

Vuelve a ejecutar el workflow o el monitor. Si sigue rechazado, el mensaje de error nombra qué barrera está cerrada:

- _"...points to a private network address and is not allowed. Self-hosted instances can allow this by setting `ALLOW_PRIVATE_NETWORK_WEBHOOKS`..."_ – falta el ajuste del servidor de API.
- _"...private network address... Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it."_ – una sonda privada (personalizada) ejecutó el monitor y su interruptor está desactivado. Ten en cuenta que se define en la sonda, no en el servidor de API.
- _"...private network address... Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it (probes.<name>.allowPrivateNetworkMonitors in the Helm chart). This is a global probe, so that allows it for every project on this instance; otherwise, select a private probe deployed on that network."_ – una sonda incluida (global) ejecutó el monitor y su interruptor está desactivado. Actívalo para esa sonda como se describe arriba si todos los proyectos de la instancia pueden alcanzar esa red; si no, selecciona una sonda privada en el monitor.
- _"...Global probes cannot monitor private network addresses. Deploy and select a private probe for this target."_ – una sonda global con `BILLING_ENABLED=true` en su entorno ejecutó el monitor. Las sondas globales registradas automáticamente siguen ahí siendo solo públicas, diga lo que diga su interruptor; despliega una sonda privada dentro de la red del destino y selecciónala en el monitor.
- _"Monitor target host ... could not be reached."_ – un monitor API, Website o External Status Page cuyo destino es un **nombre de host** informa de esto tanto cuando el nombre se resuelve en una dirección rechazada como cuando falla el DNS, para que un monitor no pueda usarse para mapear qué nombres internos existen. Los detalles del error que se muestran con él mencionan `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` en ambos casos; no dicen cuál se dio. Si el nombre apunta a una dirección privada, revisa en el registro de arranque de la sonda su política de red privada; si está desactivada, la solución es la misma que para los mensajes de arriba. Con `LOG_LEVEL=DEBUG`, la sonda también registra el motivo exacto de cada nombre rechazado.
- _"Request URL could not be reached."_ – la misma regla para un monitor **Custom JavaScript Code**: un script que pide un **nombre de host** recibe esto tanto cuando el nombre se resuelve en una dirección rechazada como cuando falla el DNS. Con `LOG_LEVEL=DEBUG`, la sonda registra el motivo exacto.
- _"Webhook URL could not be reached."_ o, desde un workflow, _"Request URL could not be reached."_ – la instancia se ejecuta con `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (o `BILLING_ENABLED=true`), así que un **nombre de host** rechazado no se explica: o se resolvió en una dirección rechazada o no se resolvió en absoluto. Con `LOG_LEVEL=DEBUG`, la aplicación o el worker registran cuál de los dos, y la dirección.
- _"...points to a private, loopback, or link-local address and is not allowed."_ – el destino está en el nivel prohibido. Para un webhook, nombra el host o CIDR exacto en `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` si de verdad lo necesitas. Para un monitor, no hay excepción.
- _"...hostname could not be resolved via DNS."_ – el contenedor no puede resolver el nombre. Comprueba que comparte una red con el destino.

## Notas de seguridad

Abrir esto cambia de verdad lo que tu instancia de OneUptime puede llegar a alcanzar, así que conviene hacerlo de forma deliberada:

- **Prefiere la lista de permitidos al interruptor general.** Nombrar `mattermost.internal` es una autorización mucho menor que abrir todas las direcciones RFC-1918.
- **Cualquiera que pueda crear un workflow o un monitor API, Website, External Status Page o Custom JavaScript Code puede alcanzar todo lo que hayas permitido.** Trata la pertenencia a esos proyectos en consecuencia.
- **El cuerpo de la respuesta vuelve.** Un componente API de workflow devuelve el estado, las cabeceras y el cuerpo al registro del workflow, así que un host permitido se puede leer, no solo escribir.
- **Las redirecciones nunca se siguen** en las peticiones de webhook, así que un host público permitido no puede rebotar el servidor a uno interno en un segundo salto.
- **Limita por sonda en lugar de a toda la instancia siempre que puedas.** Una sonda desplegada dentro de una red es una autorización más estrecha que abrir la salida del servidor de API.

## Próximos pasos

:::cards
- [Sondas personalizadas](/docs/probe/custom-probe): Ejecuta una sonda dentro de la red que debe comprobar.
- [Configuración de workflows](/docs/workflows/configuration): Qué pueden alcanzar y hacer los pasos de un workflow.
- [Proveedores de LLM](/docs/ai/llm-provider): Conecta OneUptime AI a un modelo de tu red.
- [Arquitectura](/docs/self-hosted/architecture): Qué parte de una instalación autoalojada hace cada conexión.
:::
