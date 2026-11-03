# Señales conectadas

Un caso de seguridad dice a qué usuarios, hosts y direcciones se refiere. Señales conectadas dice cuáles de ellos ya conoce OneUptime - sus hosts, hosts de contenedores, clústeres de Kubernetes, dispositivos de red, recursos en la nube, funciones serverless, servicios, los monitores que los comprueban y miembros - y qué ocurría en cada uno en torno al caso: sus registros, trazas y métricas, los incidentes y alertas abiertos en él, los monitores que lo vigilan y qué cambió en él. También busca en sus propios registros y trazas: la dirección de un atacante en el registro de acceso de un servidor web, un correo filtrado en el error de una aplicación. A la inversa, la página de un host, un clúster, un recurso en la nube, un servicio, un monitor o un miembro dice qué encontró Eventos de seguridad sobre él.

:::cards
- [Dónde se ve](#dónde-se-ve): La página de un caso, la pestaña de un evento, la página de una entidad y las páginas de lo que nombran.
- [Cómo se empareja un valor](#cómo-se-empareja-un-valor): Qué cuenta como el mismo elemento y qué solo posiblemente.
- [Qué muestra cada elemento](#qué-muestra-cada-elemento): Sus señales en torno al caso y lo que está abierto en él.
- [En sus registros y trazas](#en-sus-registros-y-trazas): Dónde aparece una dirección, un dominio o un correo que nombra en sus líneas de registro y spans.
- [Quién ve qué](#quién-ve-qué): Cada elemento se lee con el rol de quien lo lee.
:::

## Cómo funciona

```mermaid title="De un caso a lo que nombra"
flowchart TB
    case["Un caso, un evento<br/>o una entidad"] --> values["Sus usuarios, hosts<br/>y direcciones"]
    values -->|"Exacta o<br/>posible"| records["Sus hosts, clústeres,<br/>servicios y miembros"]
    records --> signals["Sus registros,<br/>trazas, métricas y<br/>lo que está abierto"]
    records --> cards["Una tarjeta Seguridad<br/>en sus páginas"]
```

OneUptime busca cada valor entre los elementos del proyecto, dice qué tan segura es cada coincidencia y muestra qué ocurría en cada elemento en torno al caso.

## Antes de empezar

- Eventos de seguridad que llegan, y hosts, clústeres de Kubernetes, recursos en la nube, servicios, monitores o miembros del proyecto que puedan nombrar. Consulte [Primeros pasos con la seguridad](/docs/telemetry/security-getting-started).
- Un rol que pueda leer eventos de seguridad, y los tipos de elementos que quiere ver.

## Dónde se ve

- **Señales conectadas**, una página de cada caso de seguridad: abra un caso en **Productos → Eventos de seguridad → Casos de seguridad → Casos abiertos** y luego **Señales conectadas** después de **Entidades** en su menú.
- **Conectado**, una pestaña de cada evento de seguridad: abra un evento en **Productos → Eventos de seguridad → Eventos**. Lista lo que nombra el evento, en la hora en torno a él.
- La página de una entidad, en **Productos → Eventos de seguridad → Riesgo de entidades**: dónde conoce OneUptime al usuario, el host o la dirección, en torno a su último evento de seguridad.
- Una tarjeta **Seguridad** en la página de cada host, host de Docker, host de Podman, clúster de Kubernetes, dispositivo de red, recurso en la nube, función serverless, servicio, monitor, miembro y elemento de inventario: los casos de seguridad abiertos que lo nombran, cuántos eventos de seguridad y hallazgos lo nombraron en los últimos 7 días, el más grave de ellos y su riesgo. **Abrir en Eventos de seguridad** lo abre allí. La tarjeta de un monitor trata de los hosts y las direcciones que comprueba.
- Una tarjeta **Seguridad** en la página de un incidente, cuando un caso de seguridad declaró el incidente (**Declarado desde**) o casos abiertos nombran un host o un clúster al que afecta (**Casos abiertos que nombran lo que afecta**).

## Cómo se empareja un valor

Cada usuario, host y dirección que nombra un caso o un evento se busca entre los elementos del proyecto:

| Lo que nombra el caso o el evento | Emparejado con | Certeza |
| --- | --- | --- |
| Un nombre de host o de dominio igual al nombre que informa un host, un host de contenedores, un clúster o un dispositivo de red, o un nombre en el que responde un recurso en la nube | Ese elemento | Exacta |
| El mismo nombre, dado sin decir que es un host | Ese elemento | Posible |
| Una forma corta o completa del nombre de un elemento, como `web-1` y `web-1.acme.internal` | Ese elemento | Posible |
| Una dirección IP pública que solo tiene un host o dispositivo de red, o en la que solo responde un recurso en la nube | Ese elemento | Exacta |
| Una dirección IP privada, o una que tienen varios elementos | Cada elemento que la tiene | Posible |
| El ID propio de un recurso en la nube: un ARN de AWS, un ID de recurso de Azure o un nombre de recurso de Google Cloud | Ese recurso en la nube | Exacta |
| Un host, una dirección IP pública o el host de una URL que comprueba un monitor | Ese monitor | Exacta |
| Una dirección IP privada que comprueba un monitor | Ese monitor | Posible |
| El correo electrónico de un miembro | Ese miembro | Exacta |
| El elemento con el que se envió una línea de registro, para los eventos leídos de sus registros | Ese host, clúster, recurso en la nube, función serverless o servicio | Exacta |
| Un simple nombre de usuario, un hash de archivo o un proceso | Nada: ningún elemento se identifica por ellos | - |

- Una posible coincidencia muestra **Posible coincidencia** junto a su nombre y dice por qué. Nunca se cuenta en la página del elemento, y un incidente que declara el caso nunca se vincula a ella.
- Lo que se buscó y no es un elemento del proyecto aparece en **Ningún elemento coincidente**. Un valor nunca aparece allí cuando no se pudo leer un tipo de elemento que podría ser.
- Se listan como mucho 10 elementos para un caso, primero los exactos.

## Qué muestra cada elemento

- Sus señales, cada una abierta en el elemento y el periodo del caso: **Registros**, **Trazas** y **Métricas**, las **Excepciones** de un servicio, los **Eventos de Kubernetes** de un clúster, la **Topología** del elemento y su elemento de **Inventario** cuando el inventario tiene uno.
- Los incidentes y alertas abiertos en él ahora y los monitores que lo vigilan, cada uno abriendo su página. Un monitor muestra su estado junto a su nombre, y sus **Registros** son lo que vio en cada comprobación.
- Las programaciones de guardia de un miembro, con **De guardia ahora** junto a aquellas en las que está de guardia, y los equipos de los que forma parte.
- Qué cambió en él durante el periodo: los despliegues de un servicio, los despliegues graduales de un clúster y las correcciones de un host.

| Dónde | Periodo |
| --- | --- |
| Un caso | Desde 30 minutos antes de su primera detección hasta 30 minutos después de la última, como mucho sus últimas 24 horas |
| Un evento | 30 minutos antes y después |
| La página de una entidad | 30 minutos antes y después de su último evento de seguridad |
| La tarjeta **Seguridad** de un elemento | Los últimos 7 días |

## En sus registros y trazas

Debajo de los elementos, Señales conectadas busca en sus registros y trazas, en el mismo intervalo, los valores que nombra que solo pueden significar una cosa: una dirección IP (salvo `127.0.0.1` y las demás que tiene cualquier máquina), un nombre completo de host o de dominio, un correo electrónico, una URL, el ID de un recurso en la nube y un hash de archivo. Nunca se busca un nombre de host simple, el nombre simple de un usuario ni un proceso: una línea de registro puede contenerlos por cualquier motivo. Se buscan como máximo 10 valores.

| Dónde | Nombra un valor cuando |
| --- | --- |
| El mensaje de una línea de registro | Contiene el valor completo, sin importar mayúsculas y minúsculas: `10.0.0.1` en `from 10.0.0.1:52144`, nunca en `10.0.0.12` ni en `110.0.0.1` |
| Un atributo de una línea de registro o de un span | Su valor es exactamente el valor: tal como se escribió, en minúsculas o en mayúsculas, o una dirección IPv6 en su forma corta |

- Cada valor encontrado muestra cuántas líneas de registro y spans lo nombran, dónde estaba en ellos - **En el mensaje** o un atributo por su clave -, cada uno abriendo **Registros** o **Trazas** en esas líneas o spans y el intervalo, y los elementos que los enviaron, primero los que más.
- Un atributo de recurso, como `resource.host.name`, solo dice qué elemento envió una línea, y nunca se cuenta.
- Los valores que se buscaron y que ninguno de los dos nombra aparecen en **No está en tus registros ni trazas**.
- Se buscan con su propio rol: los registros o las trazas que su rol no puede leer se indican y no se buscan; los que no se pudieron buscar en este momento lo indican, con **Volver a intentar**. Una búsqueda que tarda más de 15 segundos se detiene y lo indica.

## Quién ve qué

- Señales conectadas y la tarjeta **Seguridad** de un elemento requieren un rol que pueda leer eventos de seguridad: Security Admin, Security Member, Security Viewer, Project Owner o Project Admin. Nadie más ve datos de seguridad en ninguna página. Consulte [Roles](/docs/permissions/reference#roles).
- La tarjeta **Seguridad** de un incidente requiere un rol que pueda leer casos de seguridad.
- Cada elemento se lee con su propio rol, y también lo que tiene: un rol que no puede leer programaciones de guardia no ve las de un miembro. Un tipo de elemento que su rol no puede leer se omite, y la página lo dice; uno que no se pudo leer en este momento también lo dice, con **Volver a intentar**.
- La página de un elemento muestra su tarjeta **Seguridad** solo en un proyecto que usa Eventos de seguridad: uno que recibió un evento de seguridad en los últimos 7 días.

## Incidentes que declara un caso

**Declarar incidente** en un caso, o el paso de un playbook que declara uno, vincula el incidente con los hosts, hosts de Docker y Podman, clústeres de Kubernetes, dispositivos de red, recursos en la nube y servicios con los que el caso está conectado de forma exacta. El paso de un playbook que avisa a la guardia vincula de la misma forma la alerta que abre; cada alerta e incidente que abre una regla de detección o una coincidencia de inteligencia de amenazas se vincula con lo que su coincidencia nombra de forma exacta, y cada uno que abre Data Security, con el almacén de datos al que se refiere. El incidente aparece en sus páginas y se le aplican las reglas de sus propietarios, y su feed nombra el caso y aquello con lo que se vinculó. Una posible coincidencia nunca se vincula, y un monitor tampoco: un incidente en un monitor puede cambiar su estado y aparecer en sus páginas de estado.

## OneUptime AI

La clasificación de un caso por OneUptime AI lee sus señales conectadas: lo que está abierto y lo que cambió en los hosts, servicios, monitores y miembros que nombra el caso, las programaciones de guardia y los equipos de un miembro, y dónde aparecen sus valores en sus registros y trazas. La investigación de un incidente lee el caso de seguridad que lo declaró y los casos abiertos que nombran lo que afecta. Consulte [OneUptime AI en la seguridad](/docs/telemetry/security-ai).

## Solución de problemas

:::details Un host que nombra el caso no aparece
Compruebe que el caso nombra el host como el host se nombra a sí mismo, o nombra una dirección pública que solo tiene ese host. Un nombre corto, como `web-1` para `web-1.acme.internal`, aparece como posible coincidencia, y un simple nombre de usuario, un hash de archivo o un proceso no se busca en absoluto. Una URL solo se busca entre los monitores que comprueban su host.
:::

:::details Una dirección que nombra el caso no está en sus registros y trazas
Solo se busca en el intervalo del caso, y solo en los registros y trazas que su rol puede leer. Un mensaje nombra una dirección solo si la contiene completa: `10.0.0.12` es otra dirección, aunque la búsqueda de mensajes del explorador de Registros también la encuentra. Un atributo la nombra solo cuando su valor es exactamente la dirección, y un atributo de recurso nunca lo hace.
:::

:::details El host correcto aparece como posible coincidencia
Una posible coincidencia nunca se cuenta ni se vincula, para que un nombre que comparten dos máquinas nunca le diga nada sobre la equivocada. Haga que sus registros y detecciones nombren el host por el nombre que informa.
:::

:::details La página de un host no tiene la tarjeta Seguridad
La tarjeta se muestra a un rol que puede leer eventos de seguridad, en un proyecto que recibió un evento de seguridad en los últimos 7 días. Un host que nada nombró en ese tiempo muestra una línea que lo dice.
:::

:::details La página de un monitor no tiene la tarjeta Seguridad
La tarjeta aparece para un monitor que comprueba un host, una dirección o una URL: un monitor de sitio web, API, ping, puerto, certificado SSL, DNS o dominio. Un heartbeat, un script o un monitor de su telemetría no comprueba ningún host, así que no la tiene.
:::

:::details La página dice que su rol no puede ver un tipo de elemento
Cada elemento se lee con su propio rol. Pida a un Project Owner o a un Project Admin un rol que pueda leer ese tipo de elemento.
:::

## Próximos pasos

:::cards
- [Casos de seguridad y playbooks](/docs/telemetry/security-cases): Trabajar un caso y declarar un incidente a partir de él.
- [Eventos de seguridad (SIEM)](/docs/telemetry/security-events): Los eventos detrás de un caso y los registros de los que se leen.
- [Riesgo de entidades (alertas basadas en el riesgo)](/docs/telemetry/security-entity-risk): La página de una entidad, su riesgo y dónde la conoce OneUptime.
- [OneUptime AI en la seguridad](/docs/telemetry/security-ai): Cómo una clasificación lee lo que nombra un caso.
:::
