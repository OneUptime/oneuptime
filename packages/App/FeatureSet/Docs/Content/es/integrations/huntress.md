# Integración con Huntress

Avisa a tu equipo de guardia por los informes de incidente de Huntress, con un flujo de trabajo. Cuando el SOC de Huntress envía un informe de incidente sobre un equipo o una identidad, el flujo de trabajo abre un único incidente para él, avisa a la política de guardia que elijas, añade los comentarios hechos en Huntress como notas privadas y resuelve el incidente cuando el informe se cierra en Huntress.

Esta integración es **entrante**: Huntress envía cada evento de un informe de incidente a la URL propia del flujo de trabajo, firmado con el secreto de firma del endpoint. OneUptime nunca llama a Huntress, así que no necesita ninguna clave de API de Huntress.

:::cards
- [Cómo funciona](#cómo-funciona): Qué hace el flujo de trabajo con cada evento de un informe.
- [Configurarla](#configurar-la-integración): Crear el flujo de trabajo, añadir el endpoint en Huntress, guardar su secreto de firma, enviar una prueba.
- [El disparador](#el-disparador-huntress-incident-report): Los valores que un informe pasa al flujo de trabajo y los ajustes del disparador.
- [Solución de problemas](#solución-de-problemas): Qué significan los errores del disparador y qué cambiar.
:::

## Cómo funciona

Huntress envía un evento sobre un informe de incidente cuando se envía el informe, cuando alguien lo comenta y cuando se cierra. El disparador **Huntress Incident Report** inicia el flujo de trabajo una vez por cada evento, y su **Event** dice cuál fue: `created`, `comment-added` o `closed`.

```mermaid title="Un informe de incidente de Huntress en un flujo de trabajo"
sequenceDiagram
    participant H as Huntress
    participant W as Flujo de trabajo
    participant C as Equipo de guardia
    H->>W: incident_report.created
    W->>W: Comprobar la firma,<br/>abrir un único incidente
    opt Informe alto<br/>o crítico
        W->>C: Avisar a la política<br/>de guardia
    end
    H->>W: incident_report.comment_added
    W->>W: Añadir el comentario<br/>como nota privada
    H->>W: incident_report.closed
    W->>W: Resolver el incidente
```

1. **Comprobar.** Una solicitud debe estar firmada con el secreto de firma del endpoint, como mucho cinco minutos antes de llegar. Todo lo demás se rechaza, y los ajustes del disparador dicen por qué.
2. **Iniciar el flujo de trabajo.** Cada evento inicia una ejecución, con los campos del informe como valores del disparador. Un evento que Huntress vuelve a enviar ya no inicia nada.
3. **Abrir un único incidente.** Con `created`, el flujo de trabajo abre un incidente con el nombre del informe, como `Huntress: Incident on DESKTOP-01 (Acme Corp)`. Su descripción contiene el resumen del informe, su gravedad en Huntress, la organización, el equipo o la identidad afectados, los indicadores que encontró Huntress y un enlace al informe en Huntress. El incidente recibe una etiqueta con la organización del informe y avisa a la política de guardia que elijas cuando el informe es alto o crítico.
4. **Seguir el informe.** Con `comment-added`, el comentario pasa a ser una nota privada en el incidente. Con `closed`, el incidente se resuelve, con el motivo en su cronología.

El incidente guarda el número del informe en sus campos personalizados, como `huntressReportId`: así lo vuelve a encontrar el flujo de trabajo cuando Huntress comenta o cierra el informe. Los incidentes abiertos así nunca se muestran en una página de estado, y tus reglas de incidentes (de guardia, de responsables, de etiquetas y de privacidad) se les aplican como a cualquier otro incidente.

## Antes de empezar

- En OneUptime, un rol que pueda crear y editar flujos de trabajo, como **Propietario del proyecto**, **Administrador del proyecto** o **Administrador de flujos de trabajo**.
- En Huntress, el rol **Account Admin**: solo los administradores de cuenta pueden añadir webhooks.
- Una política de guardia a la que avisar.
- En OneUptime Cloud, un plan con flujos de trabajo: Growth o superior. Cada evento que envía Huntress es una ejecución de flujo de trabajo.
- En una instalación autoalojada, un OneUptime al que Huntress pueda llegar desde internet por HTTPS: Huntress solo envía webhooks a URL `https://`.

## Configurar la integración

:::steps
### Crear el flujo de trabajo

Abre **Flujos de trabajo** y haz clic en **Crear flujo de trabajo**. En **O empieza con una plantilla**, elige la categoría **Huntress**, elige **Open an incident for each Huntress incident report**, haz clic en **Usar esta plantilla** y crea el flujo de trabajo. Se abre en el **Constructor**, desactivado.

### Elegir a quién avisar

Haz clic en el paso **Page an On-Call Policy**, elige las **Políticas de guardia** a las que avisar y guarda el paso.

### Añadir un endpoint de webhook en Huntress

Haz clic en el disparador **Huntress Incident Report** y, en **Añadir un endpoint de webhook en Huntress**, haz clic en **Copiar URL**. La URL se parece a `https://oneuptime.com/workflow/huntress/<key>`; en una instalación autoalojada empieza por tu propio host.

En Huntress, abre el menú de arriba a la derecha y elige **Integrations**. Haz clic en **Add an Integration**, elige **Webhooks** y haz clic en **Add Endpoint**. Pega la URL, activa **Incident Reports** y guarda. Deja desactivados **Escalations**, **Platform Actions** y **Account Notices**: el disparador acepta esos eventos y no inicia nada por ellos.

### Guardar el secreto de firma del endpoint

En Huntress, abre el menú del endpoint (⋯) y elige **View Signing Secret**. Cópialo entero: empieza por `whsec_`. En el disparador, haz clic en **Guardar secreto de firma**, pégalo y haz clic en **Guardar secreto de firma**. El secreto se guarda cifrado y no se vuelve a mostrar.

Hasta que se guarde el secreto, el disparador rechaza todas las solicitudes. Huntress vuelve a enviar más tarde un evento rechazado, así que un evento rechazado ahora llega igualmente.

### Activar el flujo de trabajo y enviar una prueba

Activa **Habilitado** en la parte superior del **Constructor**. En Huntress, abre el menú del endpoint (⋯) y elige **Send Test**. En pocos segundos, el disparador muestra **Recibiendo informes**.

> [!NOTE]
> Lleve lo que lleve la prueba, el disparador muestra que llegó. Una prueba que lleva un informe de incidente inicia el flujo de trabajo como cualquier otro informe.
:::

## Qué hace el flujo de trabajo

La plantilla toma un camino para cada **Event**, con un **Switch / Case** después del disparador:

| Event | Qué hace el flujo de trabajo |
| --- | --- |
| `created` | Abre un incidente con la **Incident Severity ID** del disparador, etiquetado con su **Organization Label ID**. Para un informe alto o crítico, **Page an On-Call Policy** avisa a tu política; un informe bajo no avisa a nadie. Un informe que ya tiene un incidente no abre otro. |
| `comment-added` | Busca el incidente del informe y le añade el comentario como nota privada. |
| `closed` | Busca el incidente del informe y lo resuelve, salvo que ya esté resuelto. El motivo queda en su cronología: Huntress cerró el informe. |

Es un flujo de trabajo como cualquier otro, así que puedes cambiar lo que hace: avisar solo por informes críticos cambiando lo que compara el **If / Else** después de **Create One Incident**, publicar cada informe en un canal de chat con un paso de Slack o de Microsoft Teams, o enviar cada organización a su propia política de guardia con un **Switch / Case** sobre **Organization**. Cada ejecución aparece en las ejecuciones del flujo de trabajo, con lo que hizo cada paso.

### Gravedades

Huntress da a cada informe de incidente una de tres gravedades. La **Incident Severity ID** del disparador es la gravedad de incidente con la que se abre el informe: la que elige su ajuste o, si no, el orden de tus gravedades de incidente, tal como las lista **Incidentes → Ajustes → Gravedad del incidente**:

| Gravedad en Huntress | Qué quiere decir Huntress | Ajuste | Gravedad de incidente cuando el ajuste está vacío |
| --- | --- | --- | --- |
| Critical | Atacantes al teclado, malware peligroso o compromiso activo, que hay que contener de inmediato. | **Gravedad para informes críticos** | La más alta |
| High | Malware confirmado que requiere una corrección urgente, o un compromiso de identidad sobre el que actuar. | **Gravedad para informes altos** | La segunda |
| Low | Programas potencialmente no deseados, restos de malware y hallazgos de identidad más antiguos. | **Gravedad para informes bajos** | La tercera |

Un proyecto con menos gravedades usa la más baja para el resto. Un informe sin gravedad se trata como alto. Si se elimina una gravedad que elegiste, vuelve a decidir el orden.

### Organizaciones

La **Organization Label ID** del disparador es una etiqueta con el nombre de la organización de Huntress del informe, como _Acme Corp_, que crea la primera vez que llega un informe de esa organización. Un flujo de trabajo recibe los informes de todas las organizaciones de tu cuenta de Huntress, y **Solo estas organizaciones** del disparador lo acota: un nombre o ID de organización por línea, los nombres sin distinguir mayúsculas.

> [!TIP]
> Para avisar al equipo de cada cliente, añade una regla de guardia de incidentes por organización, como «Si **Etiquetas de incidentes** tiene alguno de _Acme Corp_», que ejecute la política de ese cliente. Consulta [Reglas de guardia de incidentes](/docs/incidents/settings#reglas-de-guardia-de-incidentes).

## El disparador Huntress Incident Report

El disparador se abre en Huntress: su URL, una marca junto a cada paso de configuración hecho y lo último que envió Huntress. Sus ajustes, todos opcionales, están plegados en **Más campos**: **Solo estas organizaciones**, **Gravedad para informes críticos**, **Gravedad para informes altos** y **Gravedad para informes bajos**.

| Valor | Qué contiene |
| --- | --- |
| **Event** | `created`, `comment-added` o `closed`. Un informe ya cerrado o descartado es `closed`, sea cual sea el evento que lo trajo. |
| **Report ID** | El número del informe en Huntress. |
| **Severity** | `critical`, `high` o `low`. |
| **Status** | El estado del informe en Huntress, como `sent`, `closed` o `dismissed`. |
| **Subject** | El asunto del informe, tal como lo escribe Huntress. |
| **Summary** | Lo que escribió el analista del SOC. |
| **Organization**, **Organization ID** | La organización de Huntress de la que trata el informe. |
| **Affected** | El equipo o la identidad de los que trata el informe. |
| **Platform**, **Indicators** | Dónde lo encontró Huntress y qué encontró. |
| **Comment** | El comentario que añadió alguien, con `comment-added`. |
| **Report URL** | Dónde se abre el informe en Huntress. |
| **Incident Title**, **Incident Description** | Un título y una descripción en Markdown para un incidente sobre el informe. |
| **Note** | Markdown para una nota sobre el evento: el comentario, o que Huntress cerró el informe. |
| **Incident Severity ID**, **Organization Label ID** | La gravedad de incidente y la etiqueta, como arriba. |
| **Received At** | Cuándo recibió OneUptime el evento. |

**Summary** y **Comment** son texto que escribieron los analistas de Huntress. Para ponerlos en un incidente o una nota, usa **Incident Description** y **Note**: conservan el formato, y nada en ellos carga una imagen ni menciona a nadie.

Para probar el flujo de trabajo sin Huntress, haz clic en **Ejecutar flujo de trabajo** en el **Constructor** y escribe un **Event**, un **Report ID** y los campos que necesites. Usa el mismo **Report ID** para seguir un informe de `created` a `closed`.

## Conexiones de Huntress creadas antes

Huntress se configuraba antes en **Incidentes → Integraciones → Huntress**. Cada conexión de Huntress pasó a ser un flujo de trabajo con el mismo nombre, activado, que hace lo que hacía la conexión: avisa a las mismas políticas de guardia por los mismos informes, añade las mismas etiquetas y resuelve (o solo anota) del mismo modo. Su URL sigue siendo la de la conexión, `https://oneuptime.com/api/huntress/webhook/<connection-id>`, y su secreto de firma es el mismo, así que no hay nada que cambiar en Huntress. Los incidentes que abrió la conexión conservan el número de su informe, así que el flujo de trabajo los encuentra cuando Huntress comenta o cierra esos informes.

## Seguridad

- **Solo solicitudes firmadas.** El disparador comprueba las cabeceras `svix-id`, `svix-timestamp` y `svix-signature` que envía Huntress contra el cuerpo de la solicitud tal como llegó. Una solicitud que no está firmada con el secreto guardado, o que se firmó más de cinco minutos antes o después, se rechaza.
- **El secreto sigue siendo secreto.** Se guarda cifrado, la API nunca lo devuelve y no se vuelve a mostrar. **Reemplazar secreto de firma** en el disparador guarda otro, como el secreto de un endpoint nuevo.
- **La URL es una dirección, no una contraseña.** Termina en la clave del flujo de trabajo; solo una solicitud firmada con el secreto del endpoint inicia el flujo de trabajo.
- **Un endpoint por flujo de trabajo.** Cada flujo de trabajo tiene su propia URL y su propio secreto. Para recibir los informes de una segunda cuenta de Huntress, crea un segundo flujo de trabajo.

## Usar el correo en su lugar

Huntress también envía los informes de incidente por correo, y un [monitor de correos entrantes](/docs/monitor/incoming-email-monitor) puede abrir incidentes a partir de esos correos, por ejemplo cuando el asunto contiene `Critical Incident Report`. Sin embargo, trata los correos como el estado de un solo monitor: mientras su incidente está abierto, el siguiente informe no abre ninguno, y el incidente se resuelve según los criterios del monitor y no cuando Huntress cierra el informe. El flujo de trabajo abre un incidente por informe y resuelve cada uno con su informe, así que es preferible. En cuanto el flujo de trabajo reciba informes, deja de enviar los correos al monitor, o cada informe avisará dos veces.

## Solución de problemas

Cuando el disparador rechaza una solicitud, sus ajustes muestran el motivo en **Se rechazó la última solicitud**. En Huntress, **View Delivery Attempts** en el menú del endpoint (⋯) lista cada entrega con la respuesta de OneUptime.

:::details "A request arrived but was refused, because no signing secret is saved for this workflow yet"
Guarda el secreto de firma del endpoint: consulta [Configurar la integración](#configurar-la-integración). Huntress vuelve a enviar la solicitud rechazada.
:::

:::details "The request's signature does not match the signing secret"
El secreto guardado no es el de este endpoint. Cada endpoint tiene el suyo: en Huntress, abre el menú del endpoint (⋯), elige **View Signing Secret**, cópialo entero y guárdalo con **Reemplazar secreto de firma**.
:::

:::details "The request was signed more than five minutes from now"
Los relojes de Huntress y de tu servidor de OneUptime se separan más de cinco minutos, o la solicitud es una repetición. En una instalación autoalojada, comprueba que el reloj del servidor sea correcto.
:::

:::details "A request arrived while this workflow is off"
Activa **Habilitado** en la parte superior del **Constructor**. Huntress vuelve a enviar la solicitud rechazada, y entonces inicia el flujo de trabajo.
:::

:::details "No Huntress workflow has this address."
El flujo de trabajo se eliminó o se archivó, su disparador ya no es **Huntress Incident Report**, o la URL del endpoint en Huntress no es la del flujo de trabajo. Copia la URL desde el disparador y vuelve a pegarla en el endpoint de Huntress.
:::

:::details No se abrió ningún incidente
Abre las ejecuciones del flujo de trabajo y la ejecución del informe. Si **Create One Incident** falló porque la gravedad del incidente está vacía, el proyecto no tiene gravedades de incidente: añade una en **Incidentes → Ajustes → Gravedad del incidente**.
:::

:::details No se avisó a nadie
Un informe bajo abre un incidente sin avisar. Si no, la ejecución del informe dice qué hizo **Page an On-Call Policy**, y la página **Ejecuciones de guardia** del incidente muestra qué hizo cada política.
:::

## Próximos pasos

:::cards
- [Disparadores de flujo de trabajo](/docs/workflows/triggers): Las demás formas de iniciar un flujo de trabajo.
- [Reglas de guardia de incidentes](/docs/incidents/settings#reglas-de-guardia-de-incidentes): Avisar al equipo de cada organización, por su etiqueta.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities): Ordenar las gravedades con las que se abren los informes de Huntress.
- [Descripción general de integraciones](/docs/integrations/index): Las demás herramientas que puedes conectar.
:::
