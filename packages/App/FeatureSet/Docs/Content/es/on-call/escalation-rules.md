# Reglas de escalado

Una política de guardia avisa a las personas por niveles. Cada regla de escalado es un nivel: a quién se avisa y cuánto se espera a que alguien confirme antes de avisar al siguiente nivel. Las reglas de una política aparecen, en orden, en su página **Reglas de escalado**.

## A quién se avisa primero

Cuando creas una política de guardia en la página **Políticas de guardia**, el formulario pide su **Nombre** y **¿A quién se avisa primero?**. La pregunta usa el mismo selector que **Notificar**: horarios de guardia, equipos y personas, tantos como necesites. Quienes elijas forman la primera regla de escalado de la política, **Level 1**, que espera **30 minutos** a que alguien confirme antes de avisar al siguiente nivel. Después, la nueva política se abre en su página **Reglas de escalado**, donde puedes añadir más niveles.

**¿A quién se avisa primero?** es opcional. Si lo dejas vacío, la política empieza sin reglas de escalado: no avisa a nadie hasta que añadas una, y su resumen lo indica. La descripción y las etiquetas están en **Más campos**. La pregunta solo se muestra a quien puede añadir reglas de escalado.

## Añadir una regla de escalado

Abre la política de guardia, elige **Reglas de escalado** en su menú lateral y haz clic en **Añadir regla de escalado**. El diálogo es una sola página corta con dos preguntas:

- **Notificar** — a quién se avisa en este nivel. Un único selector reúne horarios de guardia, equipos y personas: haz clic en **Añadir destinatario**, busca y elige todos los que necesites. Hace falta al menos uno.
  - Un **horario de guardia** avisa a quien esté de guardia cuando se ejecuta el nivel, no a una persona fija.
  - Un **equipo** avisa a cada miembro del equipo.
  - A una **persona** se le avisa directamente.
- **Escalar después de (en minutos)** — cuánto esperar una confirmación antes de avisar al siguiente nivel. Empieza en **30 minutos**; cámbialo según convenga al nivel.

Todo lo demás está en **Más campos**, plegado hasta que lo abras:

- **Nombre** — opcional. Una regla sin nombre se llama como su nivel: la primera regla de una política es **Level 1**, la segunda **Level 2**, y así sucesivamente. El campo del nombre muestra el nombre que recibirá la regla.
- **Descripción** — notas opcionales, por ejemplo a quién avisa este nivel y por qué.

Plegada, la cabecera de **Más campos** nombra los dos y muestra los que tiene la regla: una descripción o un nombre propio.

## Cómo avisan los niveles

Cuando un incidente o una alerta llega a la política, **Level 1** avisa a sus destinatarios de inmediato. Si nadie confirma dentro de su espera, se avisa a **Level 2**, y así sucesivamente. Cuando la espera del último nivel termina sin confirmación, la política vuelve a empezar desde **Level 1** si su **Política de repetición** (debajo de las reglas) indica repetir, tantas veces como permita, y si no, se detiene.

El resumen en la parte superior de la página **Reglas de escalado** muestra toda la escalera: cuándo se avisa a cada nivel, a quién avisa y qué pasa después del último. Un nivel cuyos destinatarios no pueden recibir todos el aviso lo indica en su tarjeta; haz clic en la etiqueta para ver quién y por qué.

A cada persona a la que avisa un nivel se la contacta según sus propias reglas de guardia: **Ajustes de usuario** > **Reglas de guardia**, con una pestaña para incidentes, episodios de incidente, alertas y episodios de alerta, y una tarjeta por gravedad que indica qué método de notificación se usa y tras cuánto tiempo. Un administrador del proyecto puede ver y cambiar las reglas de un miembro en **Usuarios** > el miembro > **Reglas de guardia**.

SMS, llamadas telefónicas, WhatsApp y Telegram empiezan apagados en un proyecto nuevo: en OneUptime Cloud cada mensaje se paga con el saldo del proyecto, y una instalación autoalojada necesita antes una cuenta de Twilio o un bot de Telegram configurado. Mientras un canal esté apagado, nadie en el proyecto puede añadir un método en él. Solo un propietario del proyecto o alguien con el permiso **Manage Billing** puede encender uno, en la tarjeta **Canales de notificación** de **Ajustes del proyecto > Notificaciones > Ajustes de Notificación**; un administrador del proyecto no puede. A todos los demás se les dice exactamente quién puede, allí donde un canal esté apagado: encima de su propia lista de métodos en ese canal, en su lista de configuración y en el mensaje que reciben cuando algo lo necesita.

## Editar, reordenar y eliminar reglas

- **Editar regla** abre el mismo diálogo de una página, relleno con la regla tal como está: sus destinatarios, su espera, y su nombre y descripción en **Más campos**. Añade o quita destinatarios y guarda. Si vacías el nombre, la regla vuelve a llamarse como su nivel.
- **Subir** y **Bajar** en el menú **⋯** de una regla cambian su nivel. Una regla que se llama como su nivel mantiene un nombre acorde con su lugar: cuando **Level 3** sube por encima de **Level 2**, ambas intercambian sus nombres. Un nombre que elegiste, como **Managers**, se mantiene vaya donde vaya la regla.
- **Eliminar regla** pide confirmación primero e indica a quién avisa el nivel. Al eliminar un nivel, los niveles de debajo suben, y las reglas que se llaman como su nivel se renombran en consecuencia.

## Crear reglas con la API o Terraform

Las reglas de escalado son el recurso `/api/on-call-duty-policy-escalation-rule`; las personas, equipos y horarios a los que avisa una regla son los recursos `/api/on-call-duty-policy-escalation-rule-user`, `-team` y `-schedule`.

- Una regla creada sin `name` se llama como su nivel, igual que en el panel: **Level 3** para una regla que pasa a ser el tercer nivel de su política. El recurso de Terraform para reglas de escalado sigue exigiendo un nombre.
- `escalateAfterInMinutes` no tiene valor predeterminado fuera del panel. Una regla creada sin él no espera: se avisa al siguiente nivel en cuanto este se ha ejecutado. Indícalo de forma explícita: el panel sugiere 30.
- Las reglas que se llaman como su nivel se renombran cuando mueves o eliminas reglas en el panel. Cambiar `order` mediante la API o Terraform solo cambia el orden.
- Crear una política de guardia en `/api/on-call-duty-policy` con `onCallSchedules`, `teams` o `users` (listas de ids) en sus `miscDataProps` le da su primera regla de escalado, igual que en el panel: **Level 1**, que les avisa, con un `escalateAfterInMinutes` de 30. Cada id debe pertenecer al proyecto y quien llama debe poder crear reglas de escalado; si no, la política no se crea. Una política creada sin ellos no tiene reglas, como antes; el recurso de Terraform para políticas no los envía.
