# Servidores MCP externos

OneUptime AI puede usar las herramientas de servidores MCP fuera de OneUptime —los de tu nube, tu alojamiento de código o tu propio equipo, como AWS, Azure o GitHub— en Preguntar a la IA, en sus respuestas en Slack y Microsoft Teams, y mientras investiga y corrige incidentes y alertas. Añade un servidor una vez en **Ajustes del proyecto → IA → Servidores MCP externos**, y OneUptime AI lo usa desde tu próxima pregunta y el siguiente incidente.

:::cards
- [Añadir un servidor](#añadir-un-servidor): Su dirección, y cómo inicia sesión OneUptime.
- [Qué hace OneUptime AI con un servidor](#qué-hace-oneuptime-ai-con-un-servidor): Las herramientas que leen en las investigaciones, las demás en las correcciones.
- [Marcar una herramienta como de solo lectura](#marcar-una-herramienta-como-de-solo-lectura): Cuando el servidor no lo indica, como ocurre con el de kAgent.
- [En Preguntar a la IA](#en-preguntar-a-la-ia): Pídele que liste las herramientas de un servidor o que use una; un cambio espera tu aprobación.
- [En Slack y Microsoft Teams](#en-slack-y-microsoft-teams): Las herramientas que leen, para la persona que preguntó.
- [Elegir los servidores que puede usar una regla](#elegir-los-servidores-que-puede-usar-una-regla): Todos, salvo que una regla elija algunos.
- [Seguridad](#seguridad): Lo que un servidor puede y no puede hacer que haga OneUptime AI.
:::

Esta página trata de los servidores a los que se conecta OneUptime AI. Para conectar en cambio un asistente de IA como Claude o Cursor a OneUptime, consulta [Servidor MCP](/docs/ai/mcp-server).

## Antes de empezar

- **OneUptime AI está activado** en el proyecto, con un proveedor de LLM que pueda usar: consulta [Proveedores de LLM](/docs/ai/llm-provider).
- **La dirección MCP del servidor.** Funcionan tanto Streamable HTTP como el antiguo HTTP con SSE: OneUptime averigua cuál habla el servidor al conectarse.
- **Cómo inicia sesión OneUptime en él:** un token de API, encabezados propios del servidor o credenciales de cliente OAuth de tu proveedor de identidad.
- **Un Project Owner o un Project Admin** añade, cambia, prueba y elimina servidores; los Miembros del proyecto y los Visores pueden verlos. En OneUptime Cloud, añadir un servidor requiere el plan Growth o superior.

## Añadir un servidor

:::steps
### Abrir Servidores MCP externos
Ve a **Ajustes del proyecto → IA → Servidores MCP externos** y haz clic en **Crear Servidor MCP externo**.

### Indicar dónde está
Dale un **Nombre**, con el que OneUptime AI y las personas que leen lo que hizo lo ven, y su **URL**, como `https://mcp.example.com/mcp`. En **Más campos**, una **Descripción** dice para qué sirve el servidor; OneUptime AI la lee para elegir el servidor adecuado.

### Elegir cómo inicia sesión OneUptime
Elige una tarjeta en **Autenticación** y rellena lo que pide (consulta [Autenticación](#autenticación)).

### Ver lo que encontró OneUptime
Al guardar, OneUptime se conecta de inmediato y el cuadro de diálogo **Probar conexión** dice lo que encontró: el servidor, cómo se comunica y cada una de sus herramientas, marcada como **Solo lectura** o **Puede cambiar cosas**. Si no pudo conectarse, el cuadro de diálogo dice por qué y qué revisar.
:::

La lista de servidores dice cómo está cada uno: **Conectado**, **No se puede conectar** (pasa el cursor por encima para ver el motivo), **Aún sin comprobar** o **Desactivado**, y cuántas herramientas ofrece. La página de un servidor muestra sus detalles, el interruptor que permite a OneUptime AI usarlo y sus **Herramientas**, con **Probar conexión** para volver a conectarse y leerlas de nuevo. Una prueba no llama a ninguna herramienta del servidor.

## Autenticación

| Autenticación | Qué envía OneUptime | Qué rellenas |
| --- | --- | --- |
| **Sin inicio de sesión** | Nada | Nada. Para un servidor que no necesita inicio de sesión, o al que solo llega tu red. |
| **Token bearer** | `Authorization: Bearer <token>` | **Token** |
| **Encabezados personalizados** | Los encabezados que introduces, con cada solicitud | Un nombre y un valor por encabezado, como `X-API-Key`. Como máximo 10. |
| **Credenciales de cliente OAuth** | Un token que pide a tu proveedor de identidad, como token bearer, y que vuelve a pedir antes de que caduque | **URL del token**, **ID de cliente** y **Secreto de cliente**, en un paso propio; **Alcance** y **Audiencia** en **Más campos** |

El token, los valores de los encabezados y el secreto de cliente se guardan cifrados y no se vuelven a mostrar, ni siquiera a quienes los guardaron. Al editar empiezan vacíos; deja uno vacío para conservar lo guardado. La página del servidor muestra los nombres de los encabezados que envía, nunca sus valores. Cambiar la **Autenticación** elimina los secretos que usaba la forma anterior de iniciar sesión.

Nunca pongas un token ni una contraseña en la **URL**: cualquiera que pueda leer el servidor lee su dirección, y un nombre de usuario o una contraseña en ella se rechaza.

## Qué hace OneUptime AI con un servidor

Cada herramienta que ofrece un servidor o solo lee, o puede cambiar algo. OneUptime se guía por lo que el servidor dice de la herramienta (su `readOnlyHint`): una herramienta que el servidor no marca como de solo lectura cuenta como una que puede cambiar algo, salvo que un Administrador del proyecto la marque como de solo lectura (consulta [Marcar una herramienta como de solo lectura](#marcar-una-herramienta-como-de-solo-lectura)). Algunos servidores no marcan ninguna de sus herramientas: hasta que alguien marque una, una investigación no tiene ninguna herramienta suya que usar, y en Preguntar a la IA cada llamada a una de ellas espera tu aprobación.

```mermaid title="Qué herramientas usa OneUptime AI por su cuenta, y cuándo"
flowchart TB
    T["Una herramienta<br/>de tu servidor MCP"] --> Q{"¿Solo<br/>lee?"}
    Q -->|"sí"| R["Se usa en<br/>investigaciones<br/>y correcciones"]
    Q -->|"no"| C["Se usa solo<br/>en correcciones"]
    C --> A{"La Aprobación<br/>de la regla"}
    A -->|"Preguntar antes<br/>de corregir"| P["Propuesto, para<br/>que una persona<br/>lo apruebe"]
    A -->|"Corregir sin<br/>preguntar"| M["Hecho al momento,<br/>a través de los<br/>servidores que<br/>nombra la regla"]
```

| | Herramientas que solo leen | Herramientas que pueden cambiar algo |
| --- | --- | --- |
| **Investigaciones** | Se usan, junto con los datos propios de OneUptime | Nunca se usan: OneUptime rechaza la llamada |
| **Correcciones** | Se usan para preparar la corrección | Se proponen para aprobación o se usan de inmediato, según la **Corrección** de la regla de IA |
| **Preguntar a la IA** | Se usan cuando lo pides | Se usan cuando apruebas cada llamada |
| **Slack y Microsoft Teams** | Se usan cuando lo pides | Nunca se usan: allí no hay tarjeta de aprobación, así que OneUptime AI te remite a Preguntar a la IA |

**En una investigación**, OneUptime AI lista las herramientas de los servidores que puede usar y llama a las que leen, para mirar lo que OneUptime no ve por sí mismo: tu cuenta en la nube, un despliegue, un gestor de incidencias. Usa lo que responden en su análisis de causa raíz. Consulta [AI SRE](/docs/ai/ai-sre).

**En una corrección**, cuando un servidor que puede usar ofrece una herramienta que puede cambiar algo, OneUptime AI prepara una corrección mediante él, después del análisis de causa raíz cuando lo hay:

- **Preguntar antes de corregir**: cada cambio que haría se registra y no se envía a ningún sitio. El paso **Remediación** de la tarjeta **OneUptime AI** del incidente los resume en una frase, y **Revisar y aprobar** los lista en orden, cada uno con su servidor, su herramienta y lo que enviaría. **Aprobar y ejecutar** hace exactamente esos cambios, en ese orden, en tu nombre; aprobar requiere el mismo permiso que iniciar un runbook. Un cambio que falla detiene los siguientes.
- **Corregir sin preguntar**: OneUptime AI hace los cambios por sí mismo, cada uno registrado antes de enviarse. Solo lo hace para una regla que nombra sus servidores MCP, cuando ninguna otra regla que coincide pregunta antes, nada más está ya corrigiendo el incidente por su cuenta (un agente de IA en un clúster o host, o un runbook) y la regla no ha hecho el máximo de correcciones que puede hacer por su cuenta en una hora; si no, los cambios se proponen. Sin ninguna regla configurada, o con una regla que no nombra ningún servidor MCP, todo cambio se propone.

Una corrección hace como máximo 5 cambios. Después OneUptime vigila los monitores del incidente, como en toda corrección. Nada se deshace automáticamente: una herramienta MCP no tiene un deshacer que OneUptime pueda conocer, así que una corrección que no funcionó queda para una persona, y el paso **Remediación** muestra lo que respondió cada servidor.

Para que OneUptime AI deje de usar un servidor, desactiva **Permitir que OneUptime AI use este servidor** en su página. Pregunta antes: el servidor ya no se usa en ninguna investigación ni corrección, y una corrección propuesta mediante él ya no se puede aprobar.

## Marcar una herramienta como de solo lectura

Algunos servidores no dicen nada sobre si sus herramientas solo leen. El servidor de herramientas de kAgent no dice nada de ninguna de sus herramientas, `k8s_get_resources` incluida, así que OneUptime AI trata cada una como una que puede cambiar algo. Cuando sabes que una herramienta solo lee, un Propietario del proyecto o un Administrador del proyecto puede marcarla como de solo lectura, y OneUptime AI la usa entonces como tal: en investigaciones y correcciones, en Slack y Microsoft Teams, y en Preguntar a la IA sin tarjeta de aprobación.

:::steps
### Abrir la tarjeta Herramientas del servidor
Ve a **Ajustes del proyecto → IA → Servidores MCP externos** y abre el servidor. Su tarjeta **Herramientas** indica sobre cuántas de sus herramientas no dice nada el servidor.

### Elegir una herramienta
Haz clic en **Marcar como de solo lectura** junto a ella. El cuadro de diálogo muestra lo que hace la herramienta según el servidor y los argumentos que acepta, y lo que significa marcarla.

### Marcar la herramienta
Haz clic en **Marcar como de solo lectura** en el cuadro de diálogo. La herramienta muestra ahora **Solo lectura**, con quién la marcó y cuándo.
:::

- **Una herramienta cada vez.** Nada marca varias herramientas a la vez.
- **Solo una herramienta sobre la que su servidor no dice nada.** Una herramienta que el servidor marca como una que puede cambiar algo (`readOnlyHint: false` o `destructiveHint: true`) no se puede marcar. Algunas bibliotecas MCP escriben eso para cada herramienta que su autor no marcó: mcp-go lo hace, así que el servidor de herramientas de kAgent en su versión 0.2 lo dice de cada herramienta. A partir de la versión 0.3 no dice nada, y sus herramientas se pueden marcar.
- **Nunca una herramienta que claramente cambia cosas.** Una herramienta cuyo nombre dice que cambia algo (como `delete`, `apply`, `create`, `update` o `restart`), una que ejecuta un comando que se le da y una con un argumento que puede activar un cambio (como `should_install` o `dry_run`) no se pueden marcar, y su fila dice por qué. Estas comprobaciones solo detectan los casos evidentes: lee lo que hace una herramienta antes de marcarla.
- **Una marca deja de aplicarse cuando el servidor cambia la herramienta.** Guarda el nombre, la descripción y el esquema de entrada de la herramienta tal como los leyó OneUptime. OneUptime AI vuelve a leer las herramientas en cada ejecución: si el servidor ha cambiado alguno de ellos, tras una actualización por ejemplo, la herramienta vuelve a contar como una que puede cambiar algo, hasta que alguien la vuelva a marcar. Su fila dice que el servidor la cambió, con **Volver a marcar**. kAgent vuelve a escribir la descripción de su `k8s_generate_resource` cada vez que arranca, así que una marca en esa herramienta caduca siempre que kAgent se reinicia.
- **Quién y cuándo quedan registrados.** Cada herramienta marcada muestra quién la marcó y cuándo. Con los [registros de auditoría](/docs/configuration/audit-logs) activados, marcar una herramienta y quitar una marca quedan en el registro de auditoría del proyecto. **Quitar marca** hace que OneUptime AI vuelva a preguntar al momento antes de usar la herramienta.

Los Miembros del proyecto y los Visores ven qué herramientas están marcadas, y por quién.

## En Preguntar a la IA

Preguntar a la IA, y la conversación bajo la tarjeta **OneUptime AI** de un incidente o una alerta, pueden usar cada servidor activado, para la persona que pregunta. Pregunta «¿Qué herramientas tiene AWS?» y OneUptime AI las lista, cada una marcada según lo que puede hacer; pídele que use una, indicando su servidor y su nombre, y la llama y responde a partir de lo que se devolvió.

- **Las herramientas que solo leen** se ejecutan al momento, en cualquier modo de permiso: las que el servidor marca como de solo lectura, y las que marcó un Administrador del proyecto.
- **Cualquier otra herramienta** te espera, también en **Ejecución automática**: la tarjeta de aprobación nombra el servidor y la herramienta y muestra exactamente lo que se envía, y nada llega al servidor hasta que lo permites. Una conversación en **Solo lectura** nunca ofrece ninguna.
- **Tus permisos deciden.** Usar un servidor requiere lo mismo que leer los servidores MCP externos del proyecto; aprobar un cambio mediante uno requiere el permiso para iniciar ejecuciones de runbooks, como aprobar una corrección mediante servidores MCP. Una llamada rechazada dice por qué, y no envía nada.

Los servidores que nombra una regla de IA son los que OneUptime AI usa por su cuenta, para lo que coincide con la regla; en Preguntar a la IA, eliges tú el servidor.

## En Slack y Microsoft Teams

Las respuestas de OneUptime AI en Slack y Microsoft Teams también pueden usar cada servidor activado, para la persona que preguntó. Pregunta «¿Qué herramientas tiene Kubernetes?» o «Usa el servidor de Kubernetes para listar los pods de shop», con el nombre de tu servidor, y responde a partir de lo que devuelven las herramientas del servidor.

- **Solo las herramientas que leen.** Las que el servidor marca como de solo lectura, y las que marcó un Administrador del proyecto. Una aplicación de chat no tiene tarjeta de aprobación, así que allí nunca se usa ninguna otra herramienta: si le pides una, OneUptime AI lo dice y te remite a Preguntar a la IA, donde apruebas cada llamada.
- **Como la persona que preguntó.** La respuesta se ejecuta como la cuenta de OneUptime a la que está conectada tu cuenta de Slack o Microsoft Teams, con sus permisos: alguien cuya cuenta no puede leer los servidores MCP externos del proyecto no recibe ninguna herramienta MCP. A una cuenta que no está conectada se le pide que se conecte primero, y no recibe respuesta hasta que lo haga.
- **Todos en la conversación leen la respuesta**, con lo que devolvieron en ella las herramientas de los servidores. Pregunta en un mensaje directo por cualquier cosa que solo debas ver tú.

## Elegir los servidores que puede usar una regla

Cada regla de IA puede nombrar los servidores MCP que OneUptime AI puede usar para lo que coincide con ella. El campo es **Servidores MCP**, en **Más campos**. Hasta que eliges algunos, OneUptime AI puede usarlos todos, y la sección plegada lo dice.

- **Ninguno elegido**: todos los servidores activados del proyecto.
- **Algunos elegidos**: solo esos. En una regla de IA que corrige sin preguntar, nombrar sus servidores es también lo que permite a OneUptime AI hacer sus cambios sin preguntar.

Cuando coinciden varias reglas que investigan, OneUptime AI puede usar cada servidor que permita cualquiera de ellas; si las reglas no se pueden leer, la investigación no usa ningún servidor MCP. Una investigación que alguien inicia en un incidente o una alerta que no coincide con ninguna regla puede usarlos todos. Cada regla que corrige y coincide prepara su propia corrección mediante sus servidores, y las reglas que no nombran ninguno comparten una corrección mediante todos.

## Seguridad

- **Lo que devuelve un servidor son datos, nunca instrucciones.** OneUptime AI lee las descripciones y las respuestas de sus herramientas como texto de fuera de OneUptime: nunca cambian una regla, una aprobación ni lo que OneUptime AI puede hacer.
- **Una herramienta recibe solo lo que acepta.** OneUptime envía a una herramienta solo los argumentos que nombra su esquema; cualquier otra cosa que haya escrito OneUptime AI se queda en OneUptime.
- **El interruptor Habilitar IA detiene todas las llamadas.** Con **Habilitar IA** desactivado, OneUptime no envía nada a ningún servidor: ninguna llamada de una investigación, de una corrección, de Preguntar a la IA, de Slack ni de Microsoft Teams, ni siquiera una que una persona ya aprobó.
- **La dirección se comprueba en cada conexión.** OneUptime nunca se conecta a su propia dirección ni a una dirección link-local. En OneUptime Cloud también rechaza las direcciones de red privada: usa la dirección pública del servidor. Un OneUptime autoalojado llega a las direcciones privadas salvo que esté definido `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`. No sigue redirecciones.
- **Límites.** Un proyecto tiene como máximo 20 servidores, y OneUptime lee como máximo 200 herramientas de cada uno. La conexión caduca a los 20 segundos, el listado de herramientas a los 30 y una llamada a una herramienta a los 60. Una respuesta de más de 2 MB se rechaza. Las llamadas de una ejecución a servidores MCP cuentan para los límites por ejecución del proyecto, cuando los fija.
- **Cada llamada queda registrada.** Cada llamada es un paso de la ejecución, visible en su actividad (en Preguntar a la IA, entre los pasos de la respuesta), y cada cambio que hace una corrección aparece en el paso **Remediación** con lo que respondió el servidor. Una respuesta en Slack o Microsoft Teams nombra entre sus fuentes cada servidor y cada herramienta que leyó. Las llamadas al modelo que hay detrás están en **Ajustes del proyecto → IA → Registros de IA**.

## Solución de problemas

:::details No se puede conectar, o la prueba falla
El cuadro de diálogo **Probar conexión** dice qué salió mal y qué revisar: la dirección (una dirección privada en OneUptime Cloud, un host que no responde), el inicio de sesión (un token o encabezados que el servidor rechazó, o una URL de token que no dio ningún token) o una URL que no es la dirección MCP del servidor. Corrige los ajustes del servidor con **Editar** en su página y vuelve a probar.
:::

:::details OneUptime AI no usa un servidor
Comprueba que **Permitir que OneUptime AI use este servidor** está activado, y que se leyeron las herramientas del servidor: su tarjeta **Herramientas** las lista, cada una marcada como **Solo lectura** o **Puede cambiar cosas**, y **Probar conexión** las vuelve a leer. Después pregunta en Preguntar a la IA «¿Qué herramientas tiene AWS?», con el nombre de tu servidor: las lista, o dice por qué no puede llegar al servidor o no puede usarlo. Para una investigación, comprueba también que la regla que coincidió con el incidente no nombra otros servidores en **Más campos**: una investigación solo usa las herramientas marcadas como **Solo lectura**, así que un servidor que no marca ninguna de sus herramientas no le da ninguna que usar hasta que un Administrador del proyecto marque las que solo leen (consulta [Marcar una herramienta como de solo lectura](#marcar-una-herramienta-como-de-solo-lectura)).
:::

:::details Una herramienta que marqué como de solo lectura vuelve a esperar aprobación
Su servidor la cambió después de que se marcara: su fila en la tarjeta **Herramientas** lo dice, y **Probar conexión** muestra lo que OneUptime lee ahora. Comprueba qué cambió en el cuadro de diálogo que abre **Volver a marcar**, y vuelve a marcarla si todavía solo lee. Una herramienta que su servidor marca ahora como una que puede cambiar algo no se puede volver a marcar.
:::

## Próximos pasos

:::cards
- [AI SRE](/docs/ai/ai-sre): Cómo investiga y corrige OneUptime AI, y las reglas que deciden qué incidentes.
- [Proveedores de LLM](/docs/ai/llm-provider): El modelo que usa las herramientas de los servidores.
- [Servidor MCP](/docs/ai/mcp-server): Conectar en cambio un asistente de IA a OneUptime.
:::
