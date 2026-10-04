# Programaciones de guardia

Una programación de guardia decide quién está de guardia en cada momento. Las personas se turnan en ella: cada una está de guardia durante un tiempo y luego la siguiente toma el relevo. Añade una programación a las reglas de escalado de una política de guardia y la política avisará a quien esté de guardia en ella cuando se ejecute ese nivel.

## Quiénes se turnan

Cuando creas una programación en la página **Programaciones de guardia**, el formulario pide su **Nombre** y **¿Quiénes se turnan?**. Haz clic en **Añadir usuario** y elige a las personas en el orden en que se turnan: están de guardia de una en una, y la primera lo está en cuanto se crea la programación. Forman la primera capa de la programación, **Layer 1**, de guardia las 24 horas. La nueva programación se abre después en su página **Capas**, donde puedes cambiar la rotación o añadir más capas.

**¿Quiénes se turnan?** es opcional. Si lo dejas vacío, la programación empieza sin capas: no pone a nadie de guardia hasta que añadas una capa en su página **Capas**. La pregunta solo se hace a quienes pueden añadir capas.

Todo lo demás queda en **Más campos**, plegado hasta que lo abras:

- **Cada turno dura**: **1 día**, **1 semana**, **2 semanas** o **1 mes**, y **1 semana** si no lo cambias. Se pregunta en cuanto se elige a alguien. Cada persona está de guardia ese tiempo y luego la siguiente toma el relevo, a la hora del día en que se creó la programación.
- **Zona horaria**: la zona horaria en la que se aplican las horas de relevo y las horas de guardia. Empieza con la tuya.
- **Descripción** y **Etiquetas**.

Mientras haya alguien elegido y no se haya cambiado nada en **Más campos**, su encabezado plegado dice lo que va a pasar: cada persona está de guardia una semana y luego la siguiente toma el relevo.

## Capas

La rotación de una programación está hecha de capas, en su página **Capas**. Las capas se leen de arriba abajo: la capa más alta con alguien de guardia es la que avisa, así que pon la rotación principal arriba y la cobertura de respaldo debajo.

**Añadir capa** añade una capa que empieza como la primera: de guardia desde ahora, cada persona durante una semana, las 24 horas. Despliega una capa para añadirle personas y cambiar cuándo empieza, cada cuánto hace el relevo, cuándo hace el primero y las horas en que está de guardia.

## Crear programaciones con la API o Terraform

Las programaciones de guardia son el recurso `/api/on-call-duty-policy-schedule`; sus capas y las personas que contienen son los recursos `/api/on-call-duty-schedule-layer` y `/api/on-call-duty-schedule-layer-user`.

- Crear una programación con `firstLayerUsers` (una lista de ids de usuario, en el orden en que se turnan) en sus `miscDataProps` le da su primera capa, como hace el panel: **Layer 1**, de guardia desde ahora, las 24 horas. `firstLayerRotation` indica cuánto dura cada turno, como una rotación del tipo `{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}`; sin ella, una semana. Cada usuario debe ser miembro del proyecto y quien llama debe poder crear capas; si no, la programación no se crea.
- Una programación creada sin ellos no tiene capas, como antes; el recurso de programación de Terraform no los envía.
- Una capa creada sin `rotation` hace el relevo a diario, como siempre.
