# Informes post mortem

Un post mortem es el informe posterior a un incidente: qué pasó, por qué, qué les costó a sus usuarios y qué cambia a partir de ahora. En OneUptime se escribe en el propio incidente. Puede partir de su propia plantilla o de un borrador de OneUptime AI, y puede publicarse en su página de estado como la última actualización del incidente.

:::cards
- [Escribir un post mortem](#escribir-un-post-mortem): En la página Post mortem del incidente, en cinco pasos.
- [Partir de una plantilla o de un borrador de IA](#partir-de-una-plantilla-o-de-un-borrador-de-ia): Su esquema, o uno que rellena OneUptime AI.
- [Publicarlo en su página de estado](#publicarlo-en-su-página-de-estado): Mostrarlo a los clientes y avisar a los suscriptores una vez.
- [Post mortem de los episodios](#post-mortem-de-los-episodios): Un solo informe para un grupo de incidentes.
:::

## Cómo se construye un post mortem

Un post mortem tiene tres partes, todas en el incidente: la nota, escrita en Markdown; sus adjuntos, como capturas de pantalla e informes; y si aparece en su página de estado. Están en la página **Post mortem** del incidente, en **Investigación** dentro de su menú lateral.

```mermaid title="De un incidente resuelto a un post mortem publicado"
flowchart TB
    R["El incidente se resuelve"] --> A["OneUptime AI lo redacta,<br/>si los borradores<br/>están activados"]
    R --> W["O lo empieza usted: en<br/>blanco, plantilla o IA"]
    A --> E["Su equipo lo edita"]
    W --> E
    E --> P{"¿Publicarlo en la<br/>página de estado?"}
    P -->|"Sí"| S["La página de estado<br/>lo muestra"]
    S --> N["Los suscriptores reciben<br/>un único aviso"]
    P -->|"No"| K["Se queda en su equipo"]
```

## Escribir un post mortem

:::steps
### Abrir el post mortem

Abra el incidente y haga clic en **Post mortem**, en **Investigación** dentro de su menú lateral. La tarjeta **Nota del análisis post mortem** muestra la nota, los adjuntos y si el post mortem está en la página de estado.

### Hacer clic en Editar nota de análisis post mortem

El diálogo **Editar nota de análisis post mortem** se abre en su primer paso, **Post mortem**.

### Escribir la nota y adjuntar archivos

Escriba la **Nota del análisis post mortem** en Markdown: qué pasó, el impacto, cómo se resolvió y las acciones de seguimiento. Añada capturas de pantalla, informes o cronologías en **Adjuntos del análisis post mortem**.

### Elegir si se publica

Haga clic en **Siguiente**. En el paso **Página de estado**, **Publicar en la página de estado** empieza desactivado, así que el post mortem se queda en su equipo. Para mostrarlo a los clientes, consulte [Publicarlo en su página de estado](#publicarlo-en-su-página-de-estado).

### Guardar el post mortem

Haga clic en **Guardar cambios**. La tarjeta muestra la nota y los adjuntos.
:::

Cada cambio de la nota queda registrado en el feed del incidente, y se publica en el canal de Slack o de Microsoft Teams del incidente si tiene uno. Mientras el post mortem no esté publicado, ningún suscriptor de la página de estado sabe de él.

Escribir un post mortem requiere el rol Project Owner, Project Admin, Project Member, Incident Admin o Incident Member, o un rol personalizado con el permiso Edit Incident. Quien puede leer el incidente puede leer su post mortem.

## Partir de una plantilla o de un borrador de IA

Dos botones de la tarjeta rellenan la nota por usted: **Generar con IA**, y **Aplicar plantilla** en cuanto el proyecto tiene una plantilla de post mortem. Ambos abren el mismo editor que **Editar nota de análisis post mortem**, con la nota rellenada y el resto del post mortem como estaba. No se guarda nada hasta que haga clic en **Guardar cambios**, así que lea la nota y corríjala antes.

### Aplicar una plantilla

**Aplicar plantilla** aparece en cuanto el proyecto tiene una plantilla de post mortem. Las plantillas se crean en **Incidentes → Ajustes → Plantillas de post mortem**: consulte [Plantillas de post mortem](/docs/incidents/settings#plantillas-de-post-mortem). En OneUptime Cloud, las plantillas requieren el plan Growth.

Haga clic en **Aplicar plantilla**, elija una en **Seleccionar plantilla** dentro del diálogo **Aplicar plantilla de análisis post mortem** y haga clic en **Aplicar plantilla**. Si el proyecto solo tiene una plantilla, ya aparece elegida.

### Generarlo con IA

Haga clic en **Generar con IA**. El diálogo **Generar post mortem con IA** ofrece un esquema en **Seleccionar plantilla**: **Standard Postmortem**, **Detailed Technical Postmortem** o **Brief Postmortem**, y después sus propias plantillas de post mortem. **Vista previa de la plantilla** muestra el esquema, y puede cambiarlo antes de generar.

Haga clic en **Generar con IA** al final del diálogo. OneUptime AI lee el incidente (su descripción, su causa raíz y su remediación, su cronología de estados, sus notas públicas y privadas, los mensajes de su canal de Slack o de Microsoft Teams, y lo que se dijo en [sus llamadas](/docs/workspace-connections/video-calls#transcripciones-de-llamadas)) y escribe el post mortem con su esquema. Después el editor se abre con él.

Generarlo requiere que la IA esté activada para el proyecto, en **Ajustes del proyecto → IA → Funciones de IA**, y un proveedor de LLM: consulte [Proveedores de LLM](/docs/ai/llm-provider). También requiere el rol Project Owner o Project Admin, o un rol personalizado con el permiso Edit Incident: otros roles pueden escribir el post mortem, pero no generarlo.

### Dejar que OneUptime AI lo redacte cuando se resuelve un incidente

Con **Redactar un post mortem cuando se resuelve un incidente** activado, OneUptime AI redacta el post mortem cada vez que se resuelve un incidente, lo guarda como nota y lo publica en el feed del incidente para que su equipo lo revise. El interruptor está en **Incidentes → IA → Ajustes**, y viene activado en los proyectos nuevos.

- Nunca sustituye una nota que ya está escrita.
- Nunca escribe en un post mortem ya publicado, donde el borrador llegaría a la página de estado sin revisar.
- Requiere que la IA esté activada para el proyecto, y se detiene durante el día en cuanto el proyecto alcanza sus límites diarios de IA. Consulte [Post mortem automático](/docs/ai/ai-sre#post-mortem-automático).
- Si la transcripción de la llamada del incidente aún está en camino cuando se resuelve el incidente, espera a que OneUptime AI la lea, para que el borrador recoja lo que se dijo en la llamada: hasta seis horas mientras Zoom o Google Meet prepara la transcripción. Consulte [Grabar y transcribir cada llamada](/docs/workspace-connections/video-calls#grabar-y-transcribir-cada-llamada).

#### Elegir qué incidentes reciben un borrador, y su plantilla

Sin reglas, cada incidente resuelto recibe un borrador, con el esquema estándar de OneUptime AI. Las **Reglas de post mortem**, en **Más ajustes** de la misma página, cambian eso:

- Una regla coincide con **Todos los incidentes**, o con **Solo los incidentes que cumplen las condiciones** sobre monitores, gravedades, etiquetas, etiquetas de monitor, título y descripción, como hace una regla de investigación.
- Sus **Plantillas** son las plantillas de post mortem que puede seguir el borrador. Sin ninguna, el borrador sigue el esquema estándar; con una, esa plantilla; con varias, la que OneUptime AI considera que mejor se ajusta al incidente. La publicación del borrador en el feed nombra la plantilla que siguió.
- Decide la primera regla habilitada que coincide con el incidente, empezando por arriba de la lista: arrastre una regla para cambiar su posición. Un incidente con el que no coincide ninguna regla no recibe borrador, y tampoco ningún incidente mientras no se puedan leer las reglas.
- **Redactar un post mortem cuando se resuelve un incidente** sigue siendo el único interruptor que desactiva los borradores. Las reglas solo deciden los borradores que OneUptime AI escribe por su cuenta: **Generar con IA** ofrece todos los esquemas, digan lo que digan.
- Crear, editar y reordenar reglas requiere el rol Project Owner o Project Admin. En OneUptime Cloud, las plantillas requieren el plan Growth: por debajo de él, las reglas siguen decidiendo qué incidentes reciben un borrador, y cada borrador sigue el esquema estándar.

## Publicarlo en su página de estado

Un post mortem publicado es la última actualización del incidente para sus clientes: la página de estado muestra la nota, destacada en la cronología del incidente, con sus adjuntos para descargar.

:::steps
### Abrir el paso Página de estado

Haga clic en **Editar nota de análisis post mortem** y después en **Siguiente** para llegar al paso **Página de estado**.

### Activar Publicar en la página de estado

Active **Publicar en la página de estado**. Aparecen dos campos más: **Notificar a los suscriptores**, que está activado, y **Análisis post mortem publicado el**, que marca el momento actual.

### Decidir a quién se avisa y cuándo aparece

Desactive **Notificar a los suscriptores** para publicar sin avisar a los suscriptores. Cambie **Análisis post mortem publicado el** para mostrar otra hora junto al post mortem.

### Publicarlo

Haga clic en **Guardar cambios**. La tarjeta muestra ahora **¿Análisis post mortem visible en la página de estado?**, **Notificar a los suscriptores**, **Estado de notificación del suscriptor** y **Análisis post mortem publicado el**.
:::

Lo que decide si los clientes lo ven y si se enteran:

- **El incidente debe estar en la página de estado.** Una página de estado solo muestra un post mortem en un incidente que muestra: **Visible en la página de estado** activado, y el incidente no privado.
- **La nota debe decir algo.** Un post mortem publicado con la nota vacía no se muestra, y no se avisa a nadie.
- **Los suscriptores reciben un único aviso**, la primera vez que la página de estado muestra el post mortem. Guardarlo de nuevo, o editarlo mientras está publicado, actualiza la página sin avisar a nadie. Retirarlo y volver a publicarlo les avisa de nuevo. Uno publicado mientras su incidente está oculto se envía cuando el incidente se hace visible.
- **Notificar a los suscriptores se lee cuando sale la notificación.** Activarlo después de publicar el post mortem no envía nada.

**Estado de notificación del suscriptor** muestra si la notificación salió, y ofrece **Reintentar** cuando falló. Consulte [El post mortem](/docs/status-pages/subscribers#el-análisis-post-mortem) para cada caso, y [Reintentar y reenviar](/docs/status-pages/subscribers#reintentar-y-reenviar).

**Análisis post mortem publicado el** es también el momento en que el post mortem cuenta como publicado para la medición **Tiempo hasta el post mortem**: consulte [Mediciones predefinidas](/docs/incidents/settings#mediciones-listas-para-usar).

## Post mortem de los episodios

Un episodio de incidentes también tiene una página **Post mortem**, en **Investigación**: un solo informe para todos los incidentes del episodio. Haga clic en **Editar análisis post mortem** para escribirlo. **Aplicar plantilla** y **Generar con IA** funcionan como en un incidente, y la IA lee el episodio y sus incidentes miembros.

El post mortem de un episodio es solo la nota: no tiene adjuntos, y ninguna página de estado lo muestra. OneUptime AI no redacta uno por sí mismo cuando se resuelve un episodio. Generarlo requiere el rol Project Owner o Project Admin, o un rol personalizado con el permiso Edit Incident Episode.

Las alertas y los eventos de mantenimiento programado no tienen post mortem.

## A través de la API

Un post mortem es un conjunto de campos del incidente, que se leen y escriben a través de `/api/incident` como el resto del incidente:

| Campo | Qué es |
| --- | --- |
| `postmortemNote` | La nota, en Markdown. |
| `showPostmortemOnStatusPage` | Si el post mortem está publicado en sus páginas de estado. Empieza en `false`. |
| `notifySubscribersOnPostmortemPublished` | Si se avisa a los suscriptores cuando se publica. Empieza en `true`. |
| `postmortemPostedAt` | La hora que muestra la página de estado junto a él. |

Escribir `showPostmortemOnStatusPage` como `true` sobre una `postmortemNote` escrita publica el post mortem, igual que el diálogo.

## Solución de problemas

:::details Aplicar plantilla no aparece en la tarjeta
El proyecto aún no tiene una plantilla de post mortem, o su rol no puede leerlas. Cree una en **Incidentes → Ajustes → Plantillas de post mortem**. En OneUptime Cloud, las plantillas requieren el plan Growth.
:::

:::details Generar con IA indica que la IA está desactivada, o que le falta el permiso
Active la IA en **Ajustes del proyecto → IA → Funciones de IA**. Generarlo requiere el rol Project Owner o Project Admin, o un rol personalizado con el permiso Edit Incident, incluso para quien puede editar el post mortem.
:::

:::details El post mortem no aparece en la página de estado
Compruebe tres cosas: **Publicar en la página de estado** está activado, la nota no está vacía, y el incidente se muestra en la página de estado (**Visible en la página de estado** activado, y no privado).
:::

:::details No se avisó a los suscriptores del post mortem
**Notificar a los suscriptores** estaba desactivado al publicarlo, o el incidente está oculto: en ese caso se envía en cuanto el incidente se hace visible. **Estado de notificación del suscriptor** en la tarjeta indica cuál fue.
:::

:::details No apareció ningún borrador de IA cuando se resolvió el incidente
El incidente ya tenía una nota, el post mortem ya estaba publicado, ninguna regla de post mortem coincidió con él, o **Redactar un post mortem cuando se resuelve un incidente** está desactivado. La IA debe estar activada para el proyecto, y el proyecto no debe haber alcanzado sus límites diarios de IA. Si la transcripción de la llamada del incidente está en camino, el borrador llega en cuanto OneUptime AI la ha leído.
:::

## Próximos pasos

:::cards
- [Visión general de los incidentes](/docs/incidents/index): Las demás páginas del incidente, de la declaración a la resolución.
- [Configuración y automatización de incidentes](/docs/incidents/settings): Las plantillas de post mortem y la medición del tiempo hasta el post mortem.
- [Suscriptores y anuncios](/docs/status-pages/subscribers): Todo lo que una página de estado comunica a sus suscriptores.
- [AI SRE](/docs/ai/ai-sre): Lo que OneUptime AI hace por sí mismo después de un incidente.
:::
