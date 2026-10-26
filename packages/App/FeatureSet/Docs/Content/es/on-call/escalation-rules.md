# Reglas de escalado

Una política de guardia avisa a las personas por niveles. Cada regla de escalado es un nivel: a quién se avisa y cuánto tiempo esperar a que alguien reconozca el aviso antes de avisar al siguiente nivel. Las reglas de una política aparecen, en orden, en su página **Reglas de escalado**.

```mermaid title="Una política de guardia avisa nivel a nivel hasta que alguien reconoce"
flowchart TB
    trigger["Incidente o alerta"] --> level1["Level 1 avisa"]
    level1 --> ack1{"¿Reconocido<br/>a tiempo?"}
    ack1 -->|"Sí"| stop["Se dejan de enviar avisos"]
    ack1 -->|"No"| level2["Level 2 avisa"]
    level2 --> ack2{"¿Reconocido<br/>a tiempo?"}
    ack2 -->|"Sí"| stop
    ack2 -->|"No, último nivel"| repeat{"¿Repetir la política?"}
    repeat -->|"Sí"| level1
    repeat -->|"No"| done["La política se detiene"]
```

:::cards
- [A quién se avisa primero](#a-quién-se-avisa-primero): Crea una política con su primer nivel.
- [Añadir una regla de escalado](#añadir-una-regla-de-escalado): Añade el siguiente nivel, paso a paso.
- [Cómo avisan los niveles a las personas](#cómo-avisan-los-niveles-a-las-personas): Tiempos, repeticiones y cómo se localiza a cada persona.
- [La siguiente persona de la rotación](#escalar-a-la-siguiente-persona-de-la-rotación): Avisa al suplente de quien está de guardia, de la misma rotación.
- [Escalar un aviso](#escalar-un-aviso): ¿No puedes atender un aviso? Avisa al siguiente nivel al momento.
- [API y Terraform](#crear-reglas-con-la-api-o-terraform): Crea políticas y reglas como código.
:::

## A quién se avisa primero

Cuando creas una política de guardia en la página **Políticas de guardia**, el formulario pide su **Nombre** y **¿A quién se avisa primero?**. La pregunta usa el mismo selector que **Notificar**: programaciones de guardia, equipos y personas, tantos como necesites. Quienes elijas forman la primera regla de escalado de la política, **Level 1**, que espera **30 minutos** a que alguien reconozca el aviso antes de avisar al siguiente nivel.

:::steps
1. Ve a **Guardia** > **Políticas de guardia** y haz clic en **Crear Política de guardia**.
2. Escribe un **Nombre**.
3. En **¿A quién se avisa primero?**, haz clic en **Añadir destinatario** y elige las programaciones de guardia, los equipos y las personas a los que avisar primero.
4. Haz clic en **Crear Política de guardia**. La nueva política se abre después en su página **Reglas de escalado**, donde puedes añadir más niveles.
:::

**¿A quién se avisa primero?** es opcional. Si lo dejas vacío, la política empieza sin reglas de escalado: no avisa a nadie hasta que añadas una, y su vista general lo indica. La descripción y las etiquetas esperan en **Más campos**. La pregunta solo se hace a quienes pueden añadir reglas de escalado.

## Añadir una regla de escalado

:::steps
### Abre las reglas de escalado de la política

Abre la política de guardia, elige **Reglas de escalado** en su menú lateral y haz clic en **Añadir regla de escalado**. El diálogo es una sola página corta.

### Elige a quién notificar

En **Notificar**, haz clic en **Añadir destinatario**, busca y elige tantas programaciones de guardia, equipos y personas como deba avisar este nivel. Añade al menos uno.

| Destinatario | A quién se avisa cuando se ejecuta el nivel |
| --- | --- |
| Una **programación de guardia** | A quien esté de guardia en ella cuando se ejecuta el nivel, no a una persona fija. |
| El **Siguiente en la rotación** de una programación | La persona que va después de quien esté de guardia en ella, de la misma rotación. Consulta [Escalar a la siguiente persona de la rotación](#escalar-a-la-siguiente-persona-de-la-rotación). |
| Un **equipo** | A cada miembro del equipo. |
| Una **persona** | A esa persona, directamente. |

### Indica cuánto esperar

**Escalar después de (en minutos)** es cuánto esperar a que alguien reconozca el aviso antes de avisar al siguiente nivel. Empieza en **30 minutos**; cámbialo a lo que convenga al nivel.

### Ponle nombre a la regla, si quieres

Todo lo demás espera en **Más campos**, plegado hasta que lo abras:

- **Nombre**: opcional. Una regla sin nombre se llama según su nivel: la primera regla de una política es **Level 1**, la segunda **Level 2**, y así sucesivamente. El campo de nombre muestra el nombre que recibirá la regla.
- **Descripción**: notas opcionales, como a quién avisa este nivel y por qué.

Plegado, el encabezado de **Más campos** nombra los dos y muestra los que tiene la regla: una descripción o un nombre propio.

### Crea la regla

Haz clic en **Crear regla**. La regla se añade debajo de las demás, como siguiente nivel de la política.
:::

## Cómo avisan los niveles a las personas

Cuando un incidente o una alerta llega a la política, **Level 1** avisa a sus destinatarios de inmediato. Si nadie reconoce el aviso dentro de su espera, se avisa a **Level 2**, y así sucesivamente hacia abajo. Cuando ha pasado la espera del último nivel sin reconocimiento, la política vuelve a empezar desde **Level 1** si su **Política de repetición** (debajo de las reglas) indica repetir, tantas veces como permita, y si no, se detiene. Reconocer o resolver el incidente o la alerta detiene los avisos en cualquier nivel. Quien recibe un aviso y no puede atenderlo puede escalarlo, y se avisa al siguiente nivel sin esperar: consulta [Escalar un aviso](#escalar-un-aviso).

Un incidente, una alerta o un episodio que se crea ya reconocido o resuelto —registrado a posteriori— no ejecuta ninguna de sus políticas: no se avisa a nadie, y su feed lo indica, nombrándolas. Consulta [Declarado ya reconocido o resuelto](/docs/incidents/declaring-incidents#declarado-ya-reconocido-o-resuelto).

Para repetir una política, haz clic en **Editar** en la tarjeta **Política de repetición**, elige **Empezar de nuevo desde Level 1** y define **¿Cuántas veces más?**.

### El resumen de escalado

El resumen de la parte superior de la página **Reglas de escalado** muestra toda la escalera: cuándo se avisa a cada nivel, a quién avisa y qué ocurre después del último. Un nivel cuyos destinatarios no pueden recibir todos el aviso lo indica en su tarjeta; haz clic en la etiqueta para ver quién y por qué.

### Cómo se localiza a cada persona

A cada persona que avisa un nivel se la localiza como indiquen sus propias reglas de guardia: **Ajustes de usuario** > **Reglas de guardia**, con una pestaña para incidentes, episodios de incidentes, alertas y episodios de alertas, y una tarjeta por severidad que indica qué método de notificación se prueba y tras cuánto tiempo. Un administrador del proyecto puede ver y cambiar las reglas de un miembro en **Usuarios** > el miembro > **Reglas de guardia**. Consulta [Reglas de guardia personales](/docs/notifications/on-call-rules).

```mermaid title="A quién avisa un nivel y cómo se localiza a cada persona"
flowchart TB
    subgraph notify["Notificar"]
        direction LR
        schedule["Programación<br/>de guardia"]
        team["Equipo"]
        user["Persona"]
    end
    schedule -->|"quien esté<br/>de guardia"| person["Persona avisada"]
    team -->|"cada miembro"| person
    user -->|"directamente"| person
    person --> rules["Sus reglas de guardia"]
    rules --> methods["Sus métodos de<br/>notificación"]
```

Una sustitución de usuario vigente para una persona envía sus avisos a quien la cubre. Una que no nombra a nadie para cubrirla la omite: no recibe avisos, la ejecución de la política indica que está ausente y hasta cuándo, y en una programación de guardia cada uno de sus turnos pasa a la siguiente persona de la rotación. Consulta [Sustituciones de usuarios](/docs/on-call/user-overrides).

Cada mensaje es uno que su proveedor acepta, así que un aviso siempre sale. Esto es lo que lleva cada canal:

| Canal | El mensaje más largo que lleva |
| --- | --- |
| SMS | 1600 caracteres |
| Llamada telefónica | Lo que cabe en el guion de llamada de Twilio de 4000 caracteres |
| Notificación push | 4 KB, de los que el título, el texto y los datos ocupan como máximo 3 KB |
| WhatsApp | 1024 caracteres |
| Telegram | 4096 caracteres |

Un mensaje más largo, con un título largo o una descripción larga que puso una plantilla, se corta y termina con una nota de que el texto completo está en OneUptime: «… (truncated — see OneUptime for the full text)». El texto de un mensaje de WhatsApp es una plantilla fija, así que allí se cortan los valores más largos, cada uno terminado en «…». Los enlaces de un mensaje nunca se cortan.

### Qué dice el SMS de un aviso

Un SMS se envía, y se cobra, en partes de 160 caracteres. Un aviso por SMS se escribe para que quepa en una sola parte siempre que se pueda, y dice solo lo que necesitas en un teléfono bloqueado: quién lo envía, qué ha pasado y el único enlace para reconocer el aviso o escalarlo. En un teléfono se lee así:

```text
OneUptime: Critical Incident INC-42 in Acme Prod: Checkout API is down.
Ack or escalate: https://oneuptime.com/l/XJlaZRsd
```

Indica la severidad y qué ha pasado (un incidente, una alerta o un episodio de cualquiera de ellos), su número, el proyecto y el título, en ese orden. Cuando no cabe todo en una parte:

1. Primero se omite el proyecto.
2. Después se corta el título, que termina en `...`.

La severidad, el número y el enlace nunca se cortan. Un título conserva al menos 20 caracteres: si ni eso cabe, por ejemplo con una dirección o un nombre de producto muy largos, el SMS ocupa una segunda parte y lo dice todo.

Cuando una política vuelve a avisar porque un incidente o una alerta reconocidos siguen sin resolverse, el SMS lo dice después del número y el proyecto, y esas palabras tampoco se cortan nunca:

```text
OneUptime: Critical Incident INC-42 in Acme Prod is still not resolved:
Checkout API is down. Ack or escalate: https://oneuptime.com/l/XJlaZRsd
```

Un solo carácter fuera del alfabeto sencillo de los SMS hace que todo el mensaje salga en partes de 70 caracteres. Por eso las comillas tipográficas y las rayas se escriben como `"`, `'` y `-`, `…` como `...`, y letras como `ç` y `ł` pierden sus acentos; los emojis se omiten. Un título en otra escritura, como japonés o ruso, se envía tal como está escrito y ocupa dos partes o más.

Los demás SMS que te envía OneUptime, por ejemplo sobre un cambio en un incidente del que eres propietario o el inicio de tu turno de guardia, también empiezan con `OneUptime:` y terminan con `Turn off in User Settings > Notification Settings.`, una frase que se omite cuando así el mensaje cabe en una parte.

### Cuando un aviso no se envía

Un aviso que no se envía indica el motivo en los **Registros de guardia** de la persona (Ajustes de usuario): su fila muestra **Error**, y su mensaje de estado da la razón. Ya no se queda en **Enviando**. El mensaje dice una de estas cosas:

- el saldo del proyecto no pudo pagarlo, y quién puede añadir saldo;
- el canal está apagado en el proyecto, y quién puede encenderlo.

Los propietarios del proyecto reciben un correo sobre ello una vez, hasta que se recargue el saldo o el canal vuelva a estar encendido.

En OneUptime Cloud, cada SMS, llamada, mensaje de WhatsApp y de Telegram se paga con el saldo del proyecto en **Ajustes del proyecto > Notificaciones > Ajustes de notificaciones**: su coste exacto se descuenta del saldo cuando el proveedor lo acepta, sin importar cuántos mensajes salgan a la vez.

- Con la **Recarga automática** activada allí, el mensaje que encuentra el saldo por debajo de su umbral añade primero la cantidad configurada en la recarga automática, con cargo a la tarjeta del proyecto; los mensajes que lo encuentran bajo en el mismo momento cargan la tarjeta una sola vez.
- Si ese cargo falla (no hay método de pago o se rechazó la tarjeta), la recarga automática vuelve a intentar el cargo una hora después, y **Ajustes de notificaciones** lo indica arriba hasta entonces. Añadir saldo a mano, o volver a guardar la recarga automática, lo intenta en el acto.
- Los avisos siguen saliendo con el saldo que queda mientras la recarga automática no puede cargar la tarjeta.

> [!IMPORTANT]
> SMS, llamadas telefónicas, WhatsApp y Telegram empiezan apagados en un proyecto nuevo: en OneUptime Cloud cada mensaje se paga con el saldo del proyecto, y una instalación autoalojada necesita antes una cuenta de Twilio o un bot de Telegram configurado. Mientras un canal esté apagado, nadie en el proyecto puede añadir un método en él. Solo un propietario del proyecto o alguien con el rol **Billing Admin** o el permiso **Manage Billing** puede encender uno, en la tarjeta **Canales de notificación** de **Ajustes del proyecto > Notificaciones > Ajustes de notificaciones**; un administrador del proyecto no puede. A todos los demás se les dice exactamente quién puede, allí donde un canal esté apagado: encima de su propia lista de métodos en ese canal, en su lista de configuración y en el mensaje que reciben cuando algo lo necesita.

## Escalar a la siguiente persona de la rotación

Un nivel puede avisar a la siguiente persona de la rotación de una programación de guardia: la que va después de quien esté de guardia en ella. Así, una política puede avisar primero a quien está de guardia, después a su suplente de la misma rotación y después a un equipo o a un responsable, todo desde una sola programación.

| Nivel | Notificar | A quién se avisa |
| --- | --- | --- |
| **Level 1** | La programación Payments primary | A quien esté de guardia en ella, por ejemplo Alex |
| **Level 2** | El **Siguiente en la rotación** de la misma programación | A la persona que va después de Alex en la rotación, por ejemplo Sam |
| **Level 3** | El equipo Platform | A cada miembro del equipo |

:::steps
1. Asegúrate de que el primer nivel de la política, **Level 1**, notifica a la programación de guardia.
2. Haz clic en **Añadir regla de escalado**, luego en **Añadir destinatario**, y elige la misma programación en **Siguiente en la rotación**. Indica **Escalar después de (en minutos)** y haz clic en **Crear regla**.
3. Añade un nivel más para el equipo o el responsable que deba enterarse a continuación.
:::

La siguiente persona se determina cuando se ejecuta el nivel, a partir de la programación tal como esté en ese momento:

- Es la persona que va después de quien está de guardia, en el orden en que se turnan las personas de la rotación. Después de la última persona vuelve la primera.
- Se pasa por alto a las personas ausentes, las cubra alguien o no, y también a quien esté de guardia en lugar de otra persona.
- Siempre es alguien de la misma rotación: con varias capas, la capa de la que viene quien está de guardia. Una rotación sin nadie más, o con todos los demás ausentes, no tiene siguiente persona, y el nivel no avisa a nadie allí y lo indica.
- Cuando no hay nadie de guardia en la programación, tampoco hay siguiente persona, y el nivel se vuelve a intentar durante unos minutos, como ocurre con la propia programación.

El mensaje de la ejecución en Slack y Microsoft Teams, el feed del incidente y la **Cronología de ejecución** indican a quién se avisó como siguiente en la rotación, y de qué programación: «Sam Lee (next in the Payments primary rotation)».

> [!TIP]
> Basta con una programación: no hay una segunda programación de suplentes que mantener al día con la primera, y las ausencias que registran sus personas cuentan para ambos niveles.

## Escalar un aviso

Quien recibe un aviso y no puede atenderlo, porque está durmiendo, en un avión o ya trabajando en otro incidente, puede escalar el aviso en lugar de dejar que suene hasta el final. La política avisa entonces a su siguiente nivel de inmediato, sin esperar a que se cumpla el **Escalar después de (en minutos)** del nivel, y a esa persona no se le vuelve a avisar de ello.

```mermaid title="Escalar un aviso lleva la política a su siguiente nivel al momento"
flowchart TB
    page["Level 1 avisa a Alex"] --> take{"¿Puede Alex<br/>atenderlo?"}
    take -->|"Sí"| ack["Alex lo reconoce:<br/>los avisos se detienen"]
    take -->|"No"| pass["Alex lo escala"]
    pass --> others{"¿Se sigue avisando a<br/>alguien más en Level 1?"}
    others -->|"Sí"| wait["La política los espera,<br/>como antes"]
    others -->|"No"| next["Se avisa a<br/>Level 2 ahora"]
```

Cada aviso se puede escalar desde donde te llegó:

| Dónde | Cómo escalarlo |
| --- | --- |
| Correo | El botón **Escalate**, y luego **Escalate** en la página que abre |
| SMS y WhatsApp | El enlace del mensaje abre la página para reconocerlo, que también tiene **Escalate** |
| Telegram, Slack y Microsoft Teams | El enlace "Can't take it? Escalate", y luego **Escalate** en la página que abre |
| Llamada | Pulsa 2. Después, la llamada dice qué ha pasado |
| Notificación push | Tócala: el incidente, la alerta o el episodio se abre en la app OneUptime On-Call, con **Escalate** debajo |
| OneUptime | **Escalar** en la parte superior del incidente, la alerta o el episodio, después de sus botones de estado |

Todas las vías salvo la llamada preguntan antes de hacer nada y dicen qué va a pasar, por ejemplo «This will immediately page Platform leads (Level 2 of 3), without waiting.»; en una llamada, pulsar 2 es la respuesta. Solo la persona a la que se avisa puede escalar su aviso: el botón en OneUptime solo se le muestra a ella, y el enlace de un mensaje solo escala el aviso sobre el que se envió, para la persona a la que se envió, durante 7 días.

Lo que pasa después depende de a quién más se esté avisando:

- Se sigue avisando a otras personas del mismo nivel: la política las espera, como antes. Avanza cuando se cumple la espera del nivel, o en cuanto la última de ellas también escala el aviso.
- No queda nadie más en el nivel: se avisa al siguiente nivel de inmediato.
- Era el último nivel: si la **Política de repetición** indica repetir, la política vuelve a empezar desde **Level 1** de inmediato. Si no, los avisos se detienen, y alguien tiene que encargarse.

Escalar un aviso no lo reconoce: el incidente o la alerta sigue esperando a que alguien lo reconozca, y quien lo escaló todavía puede reconocerlo. Esta ejecución no le vuelve a avisar de ello: un nivel posterior, o una repetición, que la nombre la salta. Cuando todas las personas a las que avisó lo han escalado y no queda nadie a quien avisar, los avisos se detienen, y el feed del incidente lo indica.

Un aviso que un workflow envía directamente a personas no tiene niveles: escalarlo deja de avisarte, y cuando todas las personas a las que avisó lo han escalado, los avisos se detienen.

Cada vez que se escala un aviso, queda registrado. La **Cronología de ejecución** de la ejecución marca la línea de la persona como **Escalado**, el feed del incidente dice «Alex Kim escalated the page from on-call policy Payments at Level 1 of 3.», el mensaje de la ejecución en Slack y Microsoft Teams dice que lo escaló, y sus **Registros de guardia** muestran el aviso como **Escalado**.

## Editar, reordenar y eliminar reglas

La tarjeta de cada regla tiene **Editar regla**, y un menú **⋯** con las demás acciones:

- **Editar regla** abre el mismo diálogo de una página, relleno con la regla tal como está: sus destinatarios, su espera, y su nombre y descripción en **Más campos**. Añade o quita destinatarios y haz clic en **Guardar cambios**. Borrar el nombre devuelve a la regla el nombre de su nivel.
- **Subir** y **Bajar**, en el menú **⋯** de una regla, cambian su nivel. Una regla que se llama según su nivel conserva un nombre que coincide con su lugar: cuando **Level 3** sube por encima de **Level 2**, las dos intercambian sus nombres. Un nombre que elegiste, como **Responsables**, sigue igual vaya donde vaya la regla.
- **Eliminar regla** pregunta primero e indica a quién avisa el nivel. Eliminar un nivel sube los niveles de debajo, y las reglas que se llaman según su nivel se renombran para coincidir.

## Crear reglas con la API o Terraform

Las reglas de escalado son el recurso `/api/on-call-duty-policy-escalation-rule`; las personas, los equipos y las programaciones que avisa una regla son los recursos `/api/on-call-duty-policy-escalation-rule-user`, `-team` y `-schedule`.

- Una regla creada sin `name` se llama según su nivel, como en el panel: **Level 3** para una regla que pasa a ser el tercer nivel de su política. El recurso de reglas de escalado de Terraform sigue exigiendo un nombre.
- `escalateAfterInMinutes` no tiene valor por defecto fuera del panel. Una regla creada sin él no espera: el siguiente nivel recibe el aviso en cuanto este se ha ejecutado. Defínelo explícitamente: 30 es lo que sugiere el panel.
- Una regla creada con `onCallSchedules`, `teams` o `users` (listas de identificadores) en sus `miscDataProps` recibe esos destinatarios; así es como los envía el selector **Notificar** del panel. Una regla creada sin ellos no avisa a nadie hasta que añadas destinatarios mediante los recursos anteriores.
- Una regla creada con `nextInRotationSchedules` (una lista de identificadores de programaciones) en sus `miscDataProps` avisa a la siguiente persona de la rotación de cada una de esas programaciones. En el recurso `-schedule`, una fila con `pageNextInRotation` a `true` hace lo mismo; se fija al crear la fila.
- Las reglas que se llaman según su nivel se renombran cuando mueves o eliminas reglas en el panel. Cambiar `order` mediante la API o Terraform solo cambia el orden.
- Crear una política de guardia en `/api/on-call-duty-policy` con `onCallSchedules`, `teams` o `users` (listas de identificadores) en sus `miscDataProps` le da su primera regla de escalado, como hace el panel: **Level 1**, que los avisa, con un `escalateAfterInMinutes` de 30. Cada identificador debe pertenecer al proyecto y quien llama debe poder crear reglas de escalado; si no, la política no se crea. Una política creada sin ellos no tiene reglas, como antes; el recurso de políticas de Terraform no los envía.

```bash
curl -X POST https://oneuptime.com/api/on-call-duty-policy \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "projectId": "<project-id>",
      "name": "Production on-call"
    },
    "miscDataProps": {
      "onCallSchedules": ["<schedule-id>"],
      "users": ["<user-id>"]
    }
  }'
```

## Próximos pasos

:::cards
- [Programaciones de guardia](/docs/on-call/schedules): Construye las rotaciones a las que avisa un nivel.
- [Línea de tiempo de guardias](/docs/on-call/schedule-timeline): Comprueba quién está de guardia en todas las programaciones y detecta huecos de cobertura.
- [Política de llamadas entrantes](/docs/on-call/incoming-call-policy): Permite que quien llama contacte por teléfono con la persona de guardia.
:::
