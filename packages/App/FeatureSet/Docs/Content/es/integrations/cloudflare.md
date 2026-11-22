# Cloudflare

Importa en los eventos de seguridad de OneUptime lo que el firewall de [Cloudflare](https://www.cloudflare.com) hizo en el perímetro: las solicitudes que sus reglas WAF gestionadas y personalizadas, la limitación de velocidad, las IP Access Rules, la gestión de bots y la protección DDoS HTTP bloquearon, desafiaron o registraron. Cada una queda junto a las solicitudes de tu propia aplicación, así que un caso dice qué detuvo Cloudflare y qué llegó igualmente a tu aplicación. OneUptime las lee con un token de API que solo puede leer, y no cambia nada en Cloudflare a menos que actives el bloqueo, que aplica allí tu lista de bloqueo.

:::cards
- [Configurar la conexión](#configurar-la-conexión): Un token de API con dos permisos de lectura, y el formulario de la conexión.
- [Qué se importa](#qué-se-importa): Qué eventos, y cómo cada uno se convierte en un evento de seguridad.
- [Cómo funciona el sondeo](#cómo-funciona-el-sondeo): La ventana que lee cada sondeo, y por qué se solapa 10 minutos.
- [Bloquear direcciones en Cloudflare](#bloquear-direcciones-en-cloudflare): Tu lista de bloqueo, aplicada con dos listas de IP y una regla personalizada por lista.
- [Solución de problemas](#solución-de-problemas): Qué significa cada error y qué cambiar.
:::

## Cómo funciona

```mermaid title="De una solicitud que Cloudflare trató a un evento de seguridad"
flowchart TB
    edge["El firewall de<br/>Cloudflare trata<br/>una solicitud"] --> poll["OneUptime sondea<br/>en el intervalo de<br/>la conexión"]
    poll --> zones["Lee los eventos<br/>de firewall de cada<br/>zona desde la<br/>última vez"]
    zones --> event["Cada uno se guarda<br/>como evento<br/>HTTP Activity"]
```

Cada minuto, OneUptime sondea cada conexión habilitada cuyo intervalo de sondeo ha pasado. Un sondeo lista las zonas de la cuenta, lee en el nodo settings de la GraphQL Analytics API lo que permite el plan de cada zona, y lee los eventos de firewall de cada zona desde el último sondeo en el conjunto de datos `firewallEventsAdaptive` ([Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)), los más antiguos primero. Cada evento se guarda como evento [OCSF](https://schema.ocsf.io/) HTTP Activity.

## Antes de empezar

- En OneUptime, el rol Propietario del proyecto, Administrador del proyecto o Administrador de seguridad. Los roles Miembro de seguridad y Visor de seguridad pueden ver las conexiones y su historial de ejecuciones, pero no cambiarlas.
- Un usuario de Cloudflare que pueda crear tokens de API para las zonas de la cuenta.
- Zonas cuyo tráfico pasa por Cloudflare: sus registros DNS están en modo proxy.
- HTTPS saliente desde la aplicación y los workers de OneUptime hacia `api.cloudflare.com`.

## Configurar la conexión

La conexión lee con un [token de API](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), nunca con una Global API Key: un token está limitado a la cuenta y sus zonas, y puedes revocarlo por separado. Necesita dos [permisos](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), ambos de solo lectura:

| Permiso | Lo que OneUptime lee con él |
| --- | --- |
| `Zone > Zone > Read` | Las zonas, con sus cuentas y planes. |
| `Zone > Analytics > Read` | Los eventos de firewall de cada zona, mediante la GraphQL Analytics API. |

:::steps
### Crear un token de API

1. En el panel de Cloudflare, abre **My Profile → API Tokens**, selecciona **Create Token** y elige **Create Custom Token**.
2. Llámalo `oneuptime-security-events`. En **Permissions**, añade `Zone > Zone > Read` y `Zone > Analytics > Read`.
3. En **Zone Resources**, incluye todas las zonas de la cuenta, o las zonas que vas a importar.
4. Selecciona **Continue to summary**, luego **Create Token**, y copia el token. Cloudflare lo muestra una sola vez.

### Añadir la conexión en OneUptime

Abre **Productos → Eventos de seguridad → Conexiones** (`/dashboard/{projectId}/security-events/connections`), haz clic en **Añadir conexión**, elige **Cloudflare** en **Seguridad en la nube** y haz clic en **Siguiente**. Pega el token en **Token de API**. OneUptime lista entonces las cuentas y zonas que el token puede leer: elige la **Cuenta**, y en **Zonas** deja **Todas las zonas**, o elige las zonas que vas a importar.

### Probarla antes de guardar

Haz clic en **Probar esta configuración** en **Probar antes de guardar**. La prueba comprueba cada permiso con los valores del formulario, nombra el que falte y no guarda nada. Después haz clic en **Siguiente**, da a la conexión un **Nombre** y créala.
:::

| Ajuste | Qué introducir |
| --- | --- |
| **Cuenta** | La cuenta de Cloudflare que se leerá, elegida entre las cuentas que lee tu token de API. Un token que lee una sola cuenta la elige por ti. |
| **Zonas** | Opcional. Vacío lee todas las zonas activas de la cuenta, incluidas las que se añadan más tarde. Una conexión lee como máximo 50 zonas. |
| **Token de API** | Solo el token, sin `Bearer`. Se cifra, la API nunca lo devuelve y no se vuelve a mostrar. Sustitúyelo con **Actualizar credenciales** en la conexión. |

El paso **Sondeo** también tiene una **Descripción** opcional, el **Intervalo de sondeo (minutos)**, un número entero de `1` a `1440` que empieza en `5`, y **Habilitado**, que empieza activado. Los eventos de Cloudflare son solicitudes, no alertas, así que el formulario no pregunta **Abrir casos desde**: los casos vienen de las reglas de detección que los leen.

### El acceso de escritura es una decisión aparte

Esta conexión no cambia nada en Cloudflare hasta que activas el bloqueo, en su fila. Solo entonces OneUptime pide permisos de escritura, y los comprueba antes de bloquear nada: [Bloquear direcciones en Cloudflare](#bloquear-direcciones-en-cloudflare) nombra cada uno y para qué sirve. Añádelos al token solo cuando actives el bloqueo.

## Qué se importa

Cada evento tiene el proveedor `Cloudflare` y el producto `Cloudflare WAF`, y es un evento HTTP Activity (`4002`).

| Campo de Cloudflare | En el evento de seguridad |
| --- | --- |
| `clientIP` | La IP principal, y `client.address` |
| `clientRequestHTTPHost`, `clientRequestPath`, `clientRequestQuery` | El host de destino, el recurso de destino (la ruta y la consulta), y `url.original` |
| `clientRequestHTTPMethodName`, `userAgent` | La actividad, `http.request.method` y `user_agent.original` |
| `action` | El estado, y `oneuptime.edge.action` |
| `source`, `ruleId`, `description` | El ID de la regla, el nombre de la regla, y `cloudflare.source` |
| `rayName`, `clientCountryName`, `clientAsn` | `cloudflare.ray_id`, `cloudflare.client.country` y `cloudflare.client.asn` |
| `sampleInterval` | `oneuptime.edge.sample_interval` |

| Lo que hizo Cloudflare | Estado | `oneuptime.edge.action` | Resultado de la solicitud | Gravedad |
| --- | --- | --- | --- | --- |
| Bloqueó, cerró la conexión, o un desafío falló | Blocked, o Dropped para una conexión cerrada | `blocked` | Rejected | Low |
| Respondió con un desafío gestionado, JS o interactivo | Challenge | `challenged` | Rejected | Low |
| Un desafío superado, o un visitante que ya había superado uno | Allowed | `passed-challenge` | Ninguno | Informational |
| La registró y la dejó pasar | Logged | `logged` | El código de estado del origen | Medium; High cuando el origen falló; Low cuando rechazó la solicitud |
| La dejó pasar por una regla skip o allow tuya | Allowed | `let-through` | El código de estado del origen | Igual que una solicitud registrada |

Una solicitud que una de tus propias reglas skip o allow dejó pasar solo se importa cuando lleva un ataque (inyección SQL, recorrido de directorios o una búsqueda Log4Shell), o cuando el WAF attack score de Cloudflare la considera uno. El resto es tráfico que permites a propósito, como tus monitores: cada ejecución lo cuenta y lo deja fuera.

Cloudflare toma muestras de los eventos de una zona con mucho tráfico. Cada evento conserva su intervalo de muestreo, el número de solicitudes parecidas que representa, y cada recuento que OneUptime hace con ellos dice *aproximadamente*.

Los eventos aparecen en Eventos, en Campañas (solicitudes de ataque por dirección), en el riesgo de entidades y en las reglas de detección. Un caso sobre una dirección muestra, en **En el perímetro** dentro de su impacto, lo que Cloudflare hizo con las solicitudes de la dirección junto a lo que llegó a tu aplicación. Las reglas de Cloudflare de la biblioteca las leen tal como se importan aquí: muchas coincidencias de reglas gestionadas desde una dirección, una dirección que superó un desafío y luego envió ataques, y un ataque que Cloudflare dejó pasar y que llegó a tu aplicación.

## Límites de los planes

Todos los planes tienen eventos de firewall mediante la API. **What each zone's plan gives**, en **Probar conexión**, lee en Cloudflare los límites propios de cada zona.

| Plan de Cloudflare | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Eventos de firewall conservados | 31 días | 31 días | 31 días | 31 días |
| Consulta más larga | 30 días | 30 días | 30 días | 31 días |

Logpush de Cloudflare también puede enviar eventos de firewall, en todos los planes desde el 30 de septiembre de 2026, con precio según el uso. Esta conexión sondea en su lugar, así que no necesita nada más que los dos permisos de lectura.

## Cómo funciona el sondeo

- **Los eventos se leen según cuándo ocurrieron en el perímetro.** Los datos de análisis de Cloudflare se pueden consultar un minuto o dos después de la solicitud.
- **El primer sondeo mira 24 horas atrás**, para que una conexión nueva muestre enseguida sus eventos recientes.
- **Cada sondeo posterior empieza 10 minutos antes del cursor guardado**, así que un evento que Cloudflare hace legible tarde se lee en el siguiente sondeo, y los duplicados se descartan por el Ray ID de cada evento dentro del proyecto.
- **Un sondeo lee como mucho 24 horas más allá del cursor.** Una conexión cuyo cursor se quedó atrás se pone al día en una serie de ventanas de 24 horas.
- **Las zonas se leen por turnos**, una página de hasta 2.000 eventos cada una, así que una zona con mucho tráfico no puede agotar un sondeo antes de que se lea una tranquila.
- **Se respetan los límites de velocidad de Cloudflare.** Cloudflare permite 1.200 solicitudes REST y 300 consultas GraphQL en cinco minutos. Un `429` que pide esperar 30 segundos o menos se espera y se vuelve a pedir; uno más largo detiene el sondeo, y el siguiente continúa.
- **Una zona que el token no puede leer no frena nada.** Las otras zonas se importan, la ejecución es **Parcial**, y su advertencia nombra la zona. Da al token `Zone > Analytics > Read` allí, y luego usa **Importar este intervalo de tiempo** para recuperar la ventana.
- **Una ejecución fallida no cambia nada.** Tras un error de red, o un estado de error de Cloudflare, el cursor y la longitud de la ventana quedan como estaban, y el siguiente sondeo vuelve a leer la misma ventana. La única excepción es una solicitud que agotó su tiempo: el cursor se queda, pero la siguiente ventana es la mitad de larga, ya que una ventana demasiado pesada para responder a tiempo agotaría el tiempo en cada intento.

### Cuando una ventana contiene más de lo que un sondeo puede leer

Un sondeo envía como máximo 120 solicitudes, lee como máximo 20.000 eventos y se detiene tras 4 minutos. Los eventos se leen los más antiguos primero, así que cuando un presupuesto detiene un sondeo, la ejecución es **Parcial** y el siguiente sondeo continúa desde el evento más antiguo hasta el que se leyeron las zonas sin terminar. Cuando no se pudo leer cada zona una vez, OneUptime acorta la ventana en su lugar:

1. **Reducir.** El siguiente sondeo lee una ventana la mitad de larga, desde el mismo punto de partida, y la reduce a la mitad otra vez hasta que una ventana se lee completa, hasta un minuto. La advertencia de la ejecución lo dice: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Los eventos ya importados de la ventana más larga se omiten como duplicados.
2. **Volver a crecer.** Cuando una ventana se lee entera, el cursor pasa a su final, y la siguiente ventana vuelve a ser el doble de larga, hasta 24 horas.
3. **Pasar de un solo minuto.** Si incluso un minuto contiene más de lo que un sondeo puede leer, el sondeo pasa de él, para que los eventos más recientes sigan llegando. La ejecución sigue siendo **Parcial**, y **Último error** dice `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importa ese minuto con **Importar este intervalo de tiempo** para recuperar lo que una ejecución puede leer.

Cambiar el **Intervalo de sondeo (minutos)** no cambia nada de esto: decide cada cuánto empieza un sondeo, no dónde empieza su ventana.

### Ejecutar, previsualizar e importar a demanda

Haz clic en **Diagnósticos** en una conexión para ver sus ejecuciones recientes y trabajar con ella a mano. Quien puede cambiar la conexión puede iniciar estas acciones; quien puede verla puede leer el historial.

- **Ejecutar ahora** inicia un sondeo de inmediato, con el cursor habitual, incluso cuando la conexión no está **Habilitado**.
- **Vista previa de eventos del firewall** lee un intervalo de tiempo de hasta 7 días y no importa nada.
- **Importar este intervalo de tiempo** importa un intervalo de hasta 7 días, tras tu confirmación, sin mover el cursor. Los eventos ya importados se omiten. Cloudflare conserva 31 días de eventos de firewall.
- **Copiar diagnósticos** en una ejecución copia su informe para soporte. Nunca incluye credenciales.

## Probar conexión

**Probar conexión** en la fila de una conexión, y **Probar esta configuración** en el formulario, se ejecutan en el proceso de la API, no en un worker en segundo plano, para que una prueba responda incluso cuando el problema son los workers. Hace estas comprobaciones, en orden:

| Comprobación | Qué comprueba |
| --- | --- |
| **Configuración** | El token, la cuenta y las zonas tienen el formato correcto. Si esto falla, no se contacta con nada. |
| **Verify the API token** | Cloudflare acepta el token, de un usuario o propiedad de la cuenta, y está activo. Uno que caduca en los próximos 14 días es una advertencia. |
| **List the zones** | El token tiene `Zone > Zone > Read`: lista las zonas de la cuenta, y cada zona elegida. |
| **Read firewall events** | El token tiene `Zone > Analytics > Read` en cada zona. Un fallo nombra las zonas en las que falta. |
| **What each zone's plan gives** | Cuánto tiempo conserva el plan de cada zona los eventos de firewall, y cuánto puede abarcar una consulta. Una zona cuyo plan no tiene ninguno es una advertencia. |
| **Firewall events available to import** | Aproximadamente cuántos eventos contienen las últimas 24 horas y los últimos 7 días. Ninguno es una advertencia. |
| **Background workers**, **Poll scheduler**, **Security event storage** | El lado del propio OneUptime: un proceso toma los trabajos de la cola Worker, el trabajo de sondeo se ejecuta cada minuto y el almacén de eventos de seguridad responde. |
| **Sondeo programado** | Para una conexión guardada: el sondeo está activado, ninguna ejecución está atascada esperando a un worker y los sondeos se ejecutan a tiempo. |

Cada solicitud de una prueba tiene un plazo de 20 segundos. Una prueba nunca importa nada ni mueve el cursor, y cada comprobación que falla dice qué cambiar.

## Bloquear direcciones en Cloudflare

Con el bloqueo activado, Cloudflare aplica la [lista de bloqueo](/docs/telemetry/security-cases#lista-de-bloqueo) de tu proyecto. Cada dirección que bloqueas se añade en menos de un minuto a una lista de IP de tu cuenta de Cloudflare, y en cada zona una regla personalizada por lista bloquea las direcciones que contiene o les plantea un desafío. En la **Lista de bloqueo**, **Aplicado en** nombra Cloudflare para cada bloqueo que OneUptime ha vuelto a leer de Cloudflare; un bloqueo que no se vuelve a leer en 10 minutos no se aplica allí. El paso de bloqueo de un caso dice entonces también cuántas solicitudes de la dirección ha detenido Cloudflare desde el bloqueo.

El bloqueo necesita permisos de escritura en el token de API de la conexión:

| Permiso | Lo que OneUptime hace con él |
| --- | --- |
| `Account > Account Filter Lists > Edit` | Crea sus dos listas, y añade y quita sus direcciones. |
| `Zone > Zone WAF > Edit`, en cada zona donde bloquear | Añade sus reglas personalizadas, y lee las de la zona. |
| `Account > Account Firewall Access Rules > Edit` | Añade y quita IP Access Rules, en un plan sin una lista ni una regla personalizada libre. |

:::steps
### Dar permisos de escritura al token

En Cloudflare, abre **My Profile → API Tokens**, edita el token de la conexión y añade los permisos de arriba. O crea un token que los tenga, junto con los dos permisos de lectura.

### Activar el bloqueo

En la fila de la conexión, selecciona **Bloquear direcciones**. Pega un token nuevo en **Nuevo token de API**, o déjalo vacío para conservar el actual, y en **Zonas** deja **Todas las zonas**, o elige las zonas donde bloquear. **Comprobar permisos** pregunta a Cloudflare si el token tiene cada permiso, y no cambia nada. **Activar el bloqueo** activa el bloqueo solo cuando pasan todas las comprobaciones, y OneUptime configura Cloudflare en menos de un minuto.
:::

Mientras el bloqueo está activado, **Probar conexión** ejecuta las mismas comprobaciones: **How blocking is set up**, **Edit the lists**, **Edit custom rules in each zone** y, donde se usan IP Access Rules, **Edit IP Access Rules**.

### Lo que OneUptime añade a Cloudflare

| En Cloudflare | Qué es |
| --- | --- |
| Las listas `oneuptime_block` y `oneuptime_challenge` | Dos listas de IP en la cuenta, una para bloqueos y otra para desafíos. Su descripción nombra tu proyecto de OneUptime. |
| Una regla personalizada por lista, en cada zona | `(ip.src in $oneuptime_block)` con la acción Block, y `(ip.src in $oneuptime_challenge)` con la acción Managed Challenge. Su descripción dice que OneUptime las gestiona. |
| Un elemento de lista por bloqueo | Su comentario nombra el caso y cuándo termina el bloqueo, como `OneUptime case CASE-42 until 2026-11-21 10:42 UTC`. |

Cada regla va primero entre las reglas personalizadas de la zona, así que se ejecuta antes que las tuyas: una regla Skip tuya no puede dejar pasar una dirección bloqueada. Cuando tus reglas Skip dejan pasar direcciones, como las de tus monitores o las de un socio, **Estado del bloqueo** las nombra. **Proteger estas direcciones** las añade a **Entidades protegidas**, que nadie puede bloquear.

### Límites del plan para el bloqueo

| Plan de Cloudflare | Free | Pro | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Listas en la cuenta | 1 | 10 | 10 | 1.000 |
| Elementos de lista en la cuenta | 10.000 | 10.000 | 10.000 | 500.000 |
| Reglas personalizadas en una zona | 5 | 20 | 100 | 1.000 |

Tus propias listas y reglas también cuentan. Al activar el bloqueo, cada acción toma una lista, y una regla en cada zona, donde el plan las tiene libres, Block primero; donde no, toma IP Access Rules. En un plan Free cuya única lista está libre, los bloqueos toman la lista y los desafíos, IP Access Rules. Una cuenta admite 50.000 IP Access Rules, cada una una dirección, un rango IPv4 de /16 o /24, o un rango IPv6 de /32, /48 o /64: un bloqueo de otro rango no se aplica allí, y la **Lista de bloqueo** dice por qué. **How blocking is set up** dice qué toma cada acción, y por qué.

### Cuando alguien cambia una regla

OneUptime vuelve a leer sus listas y reglas cada 3 minutos, y nunca deshace un cambio que alguien hizo en Cloudflare. Una regla desactivada, eliminada o cambiada allí aparece en la fila de la conexión y en **Estado del bloqueo**, con su zona, y la **Lista de bloqueo** muestra los bloqueos de la regla de esa zona como no aplicados en Cloudflare. **Restablecer** vuelve a configurar la regla. Mientras **Zonas** sea **Todas las zonas**, una zona que se añada después a la cuenta se configura sola.

### Desactivar el bloqueo

**Desactivar el bloqueo** pregunta si quitar de Cloudflare las listas y reglas de OneUptime, con **Quitar las listas y reglas de OneUptime de Cloudflare** seleccionado. La eliminación quita las reglas de OneUptime, sus dos listas y las IP Access Rules que añadió, encontradas por los nombres, referencias y notas que les dio, y nada más. Si las conservas, siguen en Cloudflare y continúan bloqueando lo que contienen. Una conexión que bloquea direcciones no se puede eliminar: desactiva primero el bloqueo, y elimínala cuando termine la eliminación.

## Solución de problemas

El **Último error** de la conexión guarda el mensaje de error completo, con las credenciales ocultas. Cuando una conexión tiene un error, selecciona **Ver error** en su columna **Acciones** para leerlo, y **Copiar error** en el cuadro de diálogo para copiarlo. Cada mensaje nombra la solicitud que falló y cita el motivo que dio Cloudflare.

:::details El último error dice `Invalid API Token (1000)`
Cloudflare no conoce el token: se eliminó, se renovó o nunca se pegó completo. Una Global API Key se rechaza antes de enviarse. Crea un token como se indica arriba, y guárdalo con **Actualizar credenciales**.
:::

:::details El último error dice `Unauthorized to access requested resource (9109)`
El token no puede listar las zonas. Dale `Zone > Zone > Read`, con las zonas que vas a importar en **Zone Resources**.
:::

:::details El último error dice `cannot read the analytics of`
Al token le falta `Zone > Analytics > Read` en las zonas que nombra el mensaje. Añádelo allí, y luego usa **Importar este intervalo de tiempo** para recuperar lo que no se importó.
:::

:::details El último error dice `rate limit`
Otra cosa que usa el mismo usuario de Cloudflare agotó su cuota. El sondeo continúa solo cuando pasan los cinco minutos; da a OneUptime un token de un usuario propio para separar la cuota.
:::

:::details Último error dice `did not complete`
La solicitud no recibió respuesta: un tiempo agotado, un nombre que no se resuelve o una dirección rechazada. Comprueba que la aplicación y los workers de OneUptime pueden llegar a `api.cloudflare.com`, a través de cualquier proxy que uses.
:::

:::details Un caso muestra las acciones de Cloudflare, pero ninguna solicitud de la dirección en tu aplicación
Detrás de Cloudflare, las solicitudes de tu aplicación vienen de las direcciones de Cloudflare, y la dirección del visitante es la última que Cloudflare añade a `X-Forwarded-For`. Registra esa cabecera (`http.request.header.x-forwarded-for`) y la dirección propia de la conexión (`network.peer.address`) en tus trazas. Mientras exista esta conexión, OneUptime confía en las direcciones de Cloudflare como proxy, así que lee al visitante en la cabecera y asocia las solicitudes de tu aplicación con la dirección sobre la que actuó Cloudflare. Un `client.address` que tu aplicación copia de `CF-Connecting-IP` no se considera fiable: cualquiera que llegue directamente a tu aplicación puede enviar esa cabecera.
:::

:::details El estado del bloqueo dice `already exists in this Cloudflare account`
Otro proyecto de OneUptime, o una persona, creó una lista llamada `oneuptime_block` u `oneuptime_challenge`, y OneUptime nunca cambia una lista que no creó para este proyecto. Cambia el nombre de esa lista en Cloudflare o elimínala, o desactiva el bloqueo en el proyecto que la creó. OneUptime vuelve a configurar el bloqueo en menos de 5 minutos.
:::

:::details La prueba pasa, pero Último sondeo indica Never
El trabajo de sondeo nunca se ha ejecutado. Lee las comprobaciones **Background workers** y **Poll scheduler**. En una instalación autoalojada, la causa habitual es `DISABLE_QUEUE_WORKERS=true` en la aplicación, sin un despliegue de workers aparte que tome los trabajos: ponlo en `false`, o ejecuta el despliegue de workers (Helm: `worker.enabled: true`, que es `false` por defecto).
:::

## Próximos pasos

:::cards
- [Eventos de seguridad](/docs/telemetry/security-events): Busca, correlaciona y alerta sobre lo que importas.
- [Casos de seguridad](/docs/telemetry/security-cases): Mira lo que hizo Cloudflare junto a lo que llegó a tu aplicación.
- [Descripción general de integraciones](/docs/integrations/index): Las otras herramientas que puedes conectar.
:::
