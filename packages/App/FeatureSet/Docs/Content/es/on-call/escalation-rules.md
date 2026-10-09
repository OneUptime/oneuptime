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

Cuando un incidente o una alerta llega a la política, **Level 1** avisa a sus destinatarios de inmediato. Si nadie reconoce el aviso dentro de su espera, se avisa a **Level 2**, y así sucesivamente hacia abajo. Cuando ha pasado la espera del último nivel sin reconocimiento, la política vuelve a empezar desde **Level 1** si su **Política de repetición** (debajo de las reglas) indica repetir, tantas veces como permita, y si no, se detiene. Reconocer o resolver el incidente o la alerta detiene los avisos en cualquier nivel.

Un incidente, una alerta o un episodio que se crea ya reconocido o resuelto —registrado a posteriori— no ejecuta ninguna de sus políticas: no se avisa a nadie, y su feed lo indica, nombrándolas. Consulta [Declarado ya reconocido o resuelto](/docs/incidents/declaring-incidents#declarado-ya-reconocido-o-resuelto).

Para repetir una política, haz clic en **Editar** en la tarjeta **Política de repetición**, activa **Repetir si nadie reconoce** y define el **Número de veces que repetir**.

### El resumen de escalado

El resumen de la parte superior de la página **Reglas de escalado** muestra toda la escalera: cuándo se avisa a cada nivel, a quién avisa y qué ocurre después del último. Un nivel cuyos destinatarios no pueden recibir todos el aviso lo indica en su tarjeta; haz clic en la etiqueta para ver quién y por qué.

### Cómo se localiza a cada persona

A cada persona que avisa un nivel se la localiza como indiquen sus propias reglas de guardia: **Ajustes de usuario** > **Reglas de guardia**, con una pestaña para incidentes, episodios de incidentes, alertas y episodios de alertas, y una tarjeta por severidad que indica qué método de notificación se prueba y tras cuánto tiempo. Un administrador del proyecto puede ver y cambiar las reglas de un miembro en **Usuarios** > el miembro > **Reglas de guardia**.

```mermaid title="A quién avisa un nivel y cómo se localiza a cada persona"
flowchart TB
    subgraph notify["Notificar"]
        direction LR
        schedule["Programación de guardia"]
        team["Equipo"]
        user["Persona"]
    end
    schedule -->|"quien esté de guardia"| person["Persona avisada"]
    team -->|"cada miembro"| person
    user -->|"directamente"| person
    person --> rules["Sus reglas de guardia"]
    rules --> methods["Sus métodos de notificación"]
```

Una sustitución de usuario vigente para una persona envía sus avisos a quien la cubre.

Cada mensaje es uno que su proveedor acepta, así que un aviso siempre sale. Esto es lo que lleva cada canal:

| Canal | El mensaje más largo que lleva |
| --- | --- |
| SMS | 1600 caracteres |
| Llamada telefónica | Lo que cabe en el guion de llamada de Twilio de 4000 caracteres |
| Notificación push | 4 KB, de los que el título, el texto y los datos ocupan como máximo 3 KB |
| WhatsApp | 1024 caracteres |
| Telegram | 4096 caracteres |

Un mensaje más largo, con un título largo o una descripción larga que puso una plantilla, se corta y termina con una nota de que el texto completo está en OneUptime: «… (truncated — see OneUptime for the full text)». El texto de un mensaje de WhatsApp es una plantilla fija, así que allí se cortan los valores más largos, cada uno terminado en «…». Los enlaces de un mensaje nunca se cortan.

### Cuando un aviso no se envía

Un aviso que no se envía indica el motivo en los **Registros de guardia** de la persona (Ajustes de usuario): su fila muestra **Error**, y su mensaje de estado da la razón. Ya no se queda en **Sending**. El mensaje dice una de estas cosas:

- el saldo del proyecto no pudo pagarlo, y quién puede añadir saldo;
- el canal está apagado en el proyecto, y quién puede encenderlo.

Los propietarios del proyecto reciben un correo sobre ello una vez, hasta que se recargue el saldo o el canal vuelva a estar encendido.

En OneUptime Cloud, cada SMS, llamada, mensaje de WhatsApp y de Telegram se paga con el saldo del proyecto en **Ajustes del proyecto > Notificaciones > Ajustes de notificaciones**: su coste exacto se descuenta del saldo cuando el proveedor lo acepta, sin importar cuántos mensajes salgan a la vez.

- Con la **Recarga automática** activada allí, el mensaje que encuentra el saldo por debajo de su umbral añade primero la cantidad configurada en la recarga automática, con cargo a la tarjeta del proyecto; los mensajes que lo encuentran bajo en el mismo momento cargan la tarjeta una sola vez.
- Si ese cargo falla (no hay método de pago o se rechazó la tarjeta), la recarga automática vuelve a intentar el cargo una hora después, y **Ajustes de notificaciones** lo indica arriba hasta entonces. Añadir saldo a mano, o volver a guardar la recarga automática, lo intenta en el acto.
- Los avisos siguen saliendo con el saldo que queda mientras la recarga automática no puede cargar la tarjeta.

> [!IMPORTANT]
> SMS, llamadas telefónicas, WhatsApp y Telegram empiezan apagados en un proyecto nuevo: en OneUptime Cloud cada mensaje se paga con el saldo del proyecto, y una instalación autoalojada necesita antes una cuenta de Twilio o un bot de Telegram configurado. Mientras un canal esté apagado, nadie en el proyecto puede añadir un método en él. Solo un propietario del proyecto o alguien con el rol **Billing Admin** o el permiso **Manage Billing** puede encender uno, en la tarjeta **Canales de notificación** de **Ajustes del proyecto > Notificaciones > Ajustes de notificaciones**; un administrador del proyecto no puede. A todos los demás se les dice exactamente quién puede, allí donde un canal esté apagado: encima de su propia lista de métodos en ese canal, en su lista de configuración y en el mensaje que reciben cuando algo lo necesita.

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
