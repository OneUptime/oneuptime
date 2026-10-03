# Reglas de Escalación

Una política de guardia avisa a las personas por niveles. Cada regla de escalación es un nivel: a quién se avisa y cuánto se espera a que alguien confirme antes de avisar al siguiente nivel. Las reglas de una política aparecen, en orden, en su página **Reglas de Escalación**.

## Añadir una regla de escalación

Abre la política de guardia, elige **Reglas de Escalación** en su menú lateral y haz clic en **Add Escalation Rule**. El diálogo es una sola página corta con dos preguntas:

- **Notificar** — a quién se avisa en este nivel. Un único selector reúne horarios de guardia, equipos y personas: haz clic en **Añadir destinatario**, busca y elige todos los que necesites. Hace falta al menos uno.
  - Un **horario de guardia** avisa a quien esté de guardia cuando se ejecuta el nivel, no a una persona fija.
  - Un **equipo** avisa a cada miembro del equipo.
  - A una **persona** se le avisa directamente.
- **Escalar después de (en minutos)** — cuánto esperar una confirmación antes de avisar al siguiente nivel. Empieza en **30 minutos**; cámbialo según convenga al nivel.

Todo lo demás está en **Avanzado**, plegado hasta que lo abras:

- **Nombre** — opcional. Una regla sin nombre se llama como su nivel: la primera regla de una política es **Level 1**, la segunda **Level 2**, y así sucesivamente. El campo del nombre muestra el nombre que recibirá la regla.
- **Descripción** — notas opcionales, por ejemplo a quién avisa este nivel y por qué.

La cabecera de **Avanzado** indica **Configurado** cuando la regla tiene una descripción o un nombre propio.

## Cómo avisan los niveles

Cuando un incidente o una alerta llega a la política, **Level 1** avisa a sus destinatarios de inmediato. Si nadie confirma dentro de su espera, se avisa a **Level 2**, y así sucesivamente. Cuando la espera del último nivel termina sin confirmación, la política vuelve a empezar desde **Level 1** si su **Repeat Policy** (debajo de las reglas) indica repetir, tantas veces como permita, y si no, se detiene.

El resumen en la parte superior de la página **Reglas de Escalación** muestra toda la escalera: cuándo se avisa a cada nivel, a quién avisa y qué pasa después del último. Un nivel cuyos destinatarios no pueden recibir todos el aviso lo indica en su tarjeta; haz clic en la etiqueta para ver quién y por qué.

## Editar, reordenar y eliminar reglas

- **Edit rule** abre el mismo diálogo de una página, relleno con la regla tal como está: sus destinatarios, su espera, y su nombre y descripción en **Avanzado**. Añade o quita destinatarios y guarda. Si vacías el nombre, la regla vuelve a llamarse como su nivel.
- **Move up** y **Move down** en el menú **⋯** de una regla cambian su nivel. Una regla que se llama como su nivel mantiene un nombre acorde con su lugar: cuando **Level 3** sube por encima de **Level 2**, ambas intercambian sus nombres. Un nombre que elegiste, como **Managers**, se mantiene vaya donde vaya la regla.
- **Delete rule** pide confirmación primero e indica a quién avisa el nivel. Al eliminar un nivel, los niveles de debajo suben, y las reglas que se llaman como su nivel se renombran en consecuencia.

## Crear reglas con la API o Terraform

Las reglas de escalación son el recurso `/api/on-call-duty-policy-escalation-rule`; las personas, equipos y horarios a los que avisa una regla son los recursos `/api/on-call-duty-policy-escalation-rule-user`, `-team` y `-schedule`.

- Una regla creada sin `name` se llama como su nivel, igual que en el panel: **Level 3** para una regla que pasa a ser el tercer nivel de su política. El recurso de Terraform para reglas de escalación sigue exigiendo un nombre.
- `escalateAfterInMinutes` no tiene valor predeterminado fuera del panel. Una regla creada sin él no espera: se avisa al siguiente nivel en cuanto este se ha ejecutado. Indícalo de forma explícita: el panel sugiere 30.
- Las reglas que se llaman como su nivel se renombran cuando mueves o eliminas reglas en el panel. Cambiar `order` mediante la API o Terraform solo cambia el orden.
