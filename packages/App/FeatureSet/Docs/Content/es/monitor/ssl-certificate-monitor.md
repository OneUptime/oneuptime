# Monitor de certificado SSL

Un monitor de certificado SSL comprueba los certificados TLS que presentan sus sitios y servicios, como lo hace un navegador, y le avisa antes de que caduquen. También pone el monitor sin conexión cuando un certificado deja de ser válido: caducado, autofirmado, emitido para otro nombre de host o por una autoridad en la que los navegadores no confían.

:::cards
- [Crear el monitor](#crear-un-monitor-de-certificado-ssl): Seis pasos en el panel.
- [Criterios predeterminados](#criterios-predeterminados): Un aviso de caducidad con 14 días de antelación, sin configurar nada.
- [Criterios de monitoreo](#criterios-de-monitoreo): Validez, caducidad y certificados autofirmados.
- [Solución de problemas](#solución-de-problemas): Certificados autofirmados e internos.
:::

## Cómo funciona

En cada comprobación, una sonda abre una conexión TLS con el host y el puerto de la URL, el puerto `443` salvo que la URL indique otro, y verifica el certificado como lo haría un navegador: un emisor de confianza, un nombre de host que coincide y unas fechas que incluyen hoy. Si el certificado no supera la verificación, la sonda lo lee igualmente, así que su fecha de caducidad, su emisor y sus huellas se registran en cualquier caso. Una conexión que falla, agota el tiempo de espera o presenta un certificado no válido se vuelve a intentar, hasta el número de reintentos que permita. Después, OneUptime pasa el resultado por los criterios del monitor.

```mermaid title="Cómo juzgan un certificado los criterios predeterminados"
flowchart TB
    connect["Negociación TLS,<br/>verificada como un navegador"] --> valid{"¿Certificado válido?"}
    valid -->|"No, o sin respuesta"| offline["Sin conexión,<br/>incidente declarado"]
    valid -->|"Sí"| soon{"¿Caduca en<br/>14 días o menos?"}
    soon -->|"Sí"| alert["Alerta,<br/>estado sin cambios"]
    soon -->|"No"| ok["Operativo"]
```

Una sonda que ha perdido su propia conexión de red no informa de ningún resultado, así que no puede marcar su certificado como no válido.

## Antes de empezar

- **Un rol que pueda crear monitores**: Project Owner, Project Admin, Project Member, Monitor Admin o Monitor Member, o un rol personalizado con el permiso Create Monitor.
- **Una sonda que pueda llegar al host y al puerto.** Las sondas predeterminadas de su proyecto se eligen para cada monitor nuevo. Un servicio en una red privada necesita una [sonda personalizada](/docs/probe/custom-probe) dentro de esa red.

## Crear un monitor de certificado SSL

:::steps
### Empezar un monitor nuevo

Vaya a **Monitores** y haga clic en **Crear monitor**. En **Tipo de monitor**, elija **Certificado SSL**.

### Ponerle nombre

Introduzca un **Nombre**, como `example.com certificate`, y haga clic en **Siguiente**.

### Introducir la URL

En **URL del sitio web**, introduzca el sitio cuyo certificado se va a comprobar, como `https://example.com`. Para un servicio en otro puerto, inclúyalo: `https://example.com:8443`.

### Probarlo

Haga clic en **Probar monitor**, elija una sonda en **Seleccionar sonda** y haga clic en **Ejecutar prueba**. **Resultado de la prueba del monitor** muestra el certificado que recibió la sonda, con su emisor y su fecha de caducidad.

### Revisar los criterios

**Criterios del monitor** empieza con los [criterios predeterminados](#criterios-predeterminados): sin conexión cuando el certificado no es válido, una alerta cuando caduca en 14 días o menos. Cámbielos si lo necesita y haga clic en **Siguiente**.

### Elegir sondas y crear

Mantenga o cambie las **Sondas** y el **Intervalo de monitoreo** (empieza en **Cada 5 minutos**; a los monitores de certificado SSL se les ofrecen 5 minutos o más) y haga clic en **Crear monitor**. Se abre la página del monitor.
:::

## Opciones de configuración

| Campo | Predeterminado | Qué introducir |
| --- | --- | --- |
| **URL del sitio web** | Ninguno | El sitio cuyo certificado se comprueba, como `https://example.com` o `https://example.com:8443`. Solo se usan el host y el puerto; la ruta se ignora. |
| **Tiempo de espera de la solicitud (segundos)** (en **Más campos**) | `60` | Cuánto esperar la negociación TLS en cada intento. El máximo es de 60 segundos. |
| **Reintentos en caso de fallo** (en **Más campos**) | El predeterminado de la sonda, normalmente `3` | Cuántas veces reintentar un intento fallido. El máximo es 3. |

**Reintentos en caso de fallo** cuenta los reintentos _después_ del primer intento, así que `0` ejecuta la comprobación una vez y `2` hasta tres veces. Si se deja vacío, usa el predeterminado de la sonda: 3, salvo que el `PROBE_MONITOR_RETRY_LIMIT` de la sonda diga otra cosa. Los fallos de conexión, los fallos de validación del certificado y los tiempos de espera agotados se reintentan todos, con una pausa de un segundo entre intentos.

## Criterios de monitoreo

Los criterios deciden cuándo el certificado cuenta como correcto, degradado o roto, y si eso declara un incidente o crea una alerta. Cada criterio comprueba uno o más filtros:

| Filtro | Condiciones | Qué comprueba |
| --- | --- | --- |
| **Is Valid Certificate** | **Verdadero**, **Falso** | El certificado supera las comprobaciones de un navegador: un emisor de confianza, un nombre de host que coincide y unas fechas que incluyen hoy. **Falso** cuando el punto de conexión no respondió. |
| **Is Not A Valid Certificate** | **Verdadero**, **Falso** | Lo contrario de **Is Valid Certificate**: **Verdadero** cuando el certificado no supera esas comprobaciones o no se pudo comprobar. |
| **Is Expired Certificate** | **Verdadero**, **Falso** | La fecha de caducidad del certificado ya pasó. |
| **Is Self Signed Certificate** | **Verdadero**, **Falso** | El certificado, o uno de su cadena, es autofirmado. |
| **Expires In Days** | **Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** | Los días que faltan para que caduque el certificado. |
| **Expires In Hours** | **Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** | Las horas que faltan para que caduque el certificado. |

**Expires In Days** cuenta días completos: a un certificado que caduca dentro de 14 días y 20 horas le quedan 14 días. **Expires In Hours** cuenta horas completas del mismo modo.

Con dos o más filtros, **Condición de coincidencia** decide si deben coincidir **Todos** o basta con **Cualquiera**. Las **Acciones** de un criterio deciden qué hace: cambiar el estado del monitor, crear una alerta, declarar un incidente, o varias de estas cosas.

### Criterios predeterminados

Un monitor de certificado SSL nuevo empieza con tres criterios, así que le avisa antes de que caduque un certificado sin configurar nada:

1. **El certificado no es válido** — el certificado ha caducado, es autofirmado, se emitió para otro nombre de host o por una autoridad que no es de confianza, o no se pudo comprobar porque el punto de conexión no respondió. El monitor se marca como **Sin conexión** y se crea un incidente llamado «_monitor name_ certificate is not valid». Su causa raíz indica cuál de estos casos fue. El incidente se resuelve solo en cuanto el certificado vuelve a ser válido.
2. **El certificado caduca pronto** — el certificado es válido pero caduca en 14 días o menos. Se crea una **alerta** llamada «_monitor name_ certificate expires soon».
3. **El certificado es válido** — el monitor se marca como **Operativo**.

El aviso de «caduca pronto» es una alerta, no un incidente: no aparece en sus páginas de estado, no avisa a nadie salvo que le añada una política de guardia, y no cambia el estado del monitor. Usa la segunda gravedad de alerta de su proyecto, **Low** en un proyecto nuevo. Cuando se detecta el certificado renovado, el monitor vuelve a «El certificado es válido» y la alerta se resuelve sola.

Los criterios se comprueban de arriba abajo, y el primero que coincide decide qué ocurre. Por eso «caduca pronto» está por encima de «es válido»: un certificado a punto de caducar sigue siendo válido, así que coincidiría con ambos.

Para recibir el aviso antes, cambie el valor del filtro **Expires In Days** del criterio «caduca pronto», por ejemplo a `30`. Para avisar a alguien en su lugar, abra las **Acciones** de ese criterio: active **Cuando los filtros coinciden, declarar un incidente.**, o mantenga la alerta y añádale una política de guardia en **Políticas de guardia**.

:::details Añadir el aviso a un monitor creado antes de que existiera
Los monitores creados antes de que OneUptime añadiera este aviso no tienen un criterio de «caduca pronto». Para añadirlo:

1. En el monitor, abra **Configuración → Criterios** y haga clic en **Editar criterios de monitoreo**.
2. Haga clic en **Añadir criterios**. Ponga su filtro en **Is Valid Certificate** / **Verdadero**, haga clic en **Añadir filtro** y ponga el segundo en **Expires In Days** / **Less Than Or Equal To** / `14`. Deje **Condición de coincidencia** en **Todos** (aparece bajo los filtros en cuanto hay dos).
3. En **Acciones**, active **Cuando los filtros coinciden, crear una alerta.** y deje desactivado **Cuando los filtros coinciden, cambiar el estado del monitor.**, para que cree una alerta y no cambie el estado del monitor.
4. Arrastre el nuevo criterio por encima del criterio que marca el monitor como en línea, y guarde.
:::

### Criterios de ejemplo

| Objetivo | Filtro | Condición | Valor |
| --- | --- | --- | --- |
| Avisar con un mes de antelación | **Expires In Days** | **Less Than Or Equal To** | `30` |
| Avisar a alguien el último día | **Expires In Hours** | **Less Than** | `24` |
| Sin conexión solo cuando el certificado ya caducó | **Is Expired Certificate** | **Verdadero** | — |
| Señalar un certificado autofirmado | **Is Self Signed Certificate** | **Verdadero** | — |

Un criterio sobre la caducidad tiene que estar por encima del criterio que marca el certificado como válido: un certificado a punto de caducar sigue siendo válido, y gana el primer criterio que coincide.

## Buenas prácticas

1. **Dese tiempo para renovar** — El aviso predeterminado llega 14 días antes de la caducidad, lo que se ajusta a los certificados que se renuevan solos. Si renovar le lleva más (un certificado que compra, o un proceso de cambios), súbalo a 30 días.
2. **Monitorice cada punto de conexión** — Si tiene varios dominios o subdominios, cree un monitor para cada uno. Cada uno puede tener su propio certificado.
3. **Incluya otros puertos** — Los servicios que sirven TLS en un puerto distinto de `443`, como `8443`, también tienen certificados. Ponga el puerto en la URL.
4. **Compruebe después de renovar** — Después de renovar un certificado, mire el siguiente resultado del monitor: la fecha de caducidad que muestra debe ser la nueva.

## Solución de problemas

:::details El certificado está bien en mi navegador, pero el monitor dice que no es válido
La causa raíz del incidente dice por qué. Un caso habitual es un servidor que envía su certificado sin los certificados intermedios: los navegadores suelen completar el hueco por sí mismos, la sonda no. Configure el servidor para que envíe la cadena completa. Otro es una URL cuyo nombre de host no figura en el certificado.
:::

:::details Monitorizo un servicio interno con un certificado autofirmado
Un certificado autofirmado nunca es válido, así que los criterios predeterminados mantienen el monitor sin conexión. **Is Self Signed Certificate**, **Is Expired Certificate** y **Expires In Days** siguen funcionando con él, así que construya los criterios sobre ellos. En **Configuración → Criterios**:

1. En el criterio «no es válido», haga clic en **Añadir filtro**, ponga el nuevo filtro en **Is Self Signed Certificate** / **Falso** y ponga **Condición de coincidencia** en **Todos**. El criterio sigue poniendo el monitor sin conexión cuando el punto de conexión no responde, o el certificado está mal de otra manera.
2. Añada un criterio con **Is Expired Certificate** / **Verdadero** que marque el monitor como **Sin conexión** y declare un incidente, y arrástrelo arriba del todo.
3. En el criterio «caduca pronto», sustituya **Is Valid Certificate** / **Verdadero** por **Is Expired Certificate** / **Falso**, para que el aviso cubra también el certificado autofirmado.

Mientras el certificado esté vigente, ningún criterio coincide y el monitor muestra su estado predeterminado, **Operativo**.
:::

:::details El monitor está sin conexión con «could not be checked because the endpoint is not reachable»
La sonda no pudo abrir una conexión TLS con el host y el puerto. Revise el puerto de la URL, y que un cortafuegos deje pasar a las sondas. Un host en una red privada necesita una [sonda personalizada](/docs/probe/custom-probe).
:::

## Próximos pasos

:::cards
- [Monitor de sitio web](/docs/monitor/website-monitor): Comprobar que el propio sitio responde.
- [Monitor de dominio](/docs/monitor/domain-monitor): Recibir un aviso antes de que caduque el registro del dominio.
- [Reglas de escalado](/docs/on-call/escalation-rules): Decidir a quién avisan las alertas y los incidentes.
- [Visión general de los incidentes](/docs/incidents/index): Qué ocurre después de que el monitor declare uno.
:::
