# Desencadenantes de runbook

Un runbook puede iniciarse solo: según una programación, o cuando otra herramienta llama a su URL de webhook. Usa una programación para el trabajo rutinario, como una limpieza nocturna o una revisión semanal de certificados, y el webhook para iniciar un runbook desde un sistema de alertas, un pipeline de CI o un script. Ambos se configuran en la página **Desencadenantes** del runbook.

:::cards
- [Ejecutar según una programación](#ejecutar-según-una-programación): Cada pocos minutos, cada día, ciertos días de la semana o una expresión cron.
- [Llamar al webhook](#llamar-al-webhook): Iniciar una ejecución con una solicitud POST a la URL del runbook.
- [Valores que envía una llamada al webhook](#valores-que-envía-una-llamada-al-webhook): Cómo leen los pasos el JSON que envía quien llama.
- [Solución de problemas](#solución-de-problemas): Una programación que no se ejecuta, una llamada rechazada.
:::

## Cómo un desencadenante inicia una ejecución

```mermaid title="De una programación o una llamada al webhook a una ejecución"
flowchart TB
    subgraph starts["Qué inicia la ejecución"]
        direction LR
        schedule["La programación:<br/>llega una hora"]
        webhook["El webhook: un<br/>POST a su URL"]
    end
    schedule --> checks["El runbook está<br/>activado y tiene pasos"]
    webhook --> checks
    checks --> execution["Ejecución, marcada<br/>como Schedule o Webhook"]
    execution --> worker["El Worker de OneUptime<br/>ejecuta los pasos"]
```

Un desencadenante inicia una ejecución como lo hace **Ejecutar ahora**: la ejecución recorre los pasos actuales del runbook y no está vinculada a ningún incidente, alerta ni evento de mantenimiento programado. Cada ejecución registra qué la inició. Las **Ejecuciones** del runbook y **Runbooks → Ejecuciones** lo muestran en **Activado por**, con la hora en que vencía una ejecución programada o la dirección que llamó al webhook, y ambas listas se pueden filtrar por ello.

## Antes de empezar

- Un runbook con al menos un paso y con su interruptor **Ejecutar este runbook** activado, en su página **Ajustes**.
- Permiso para editar el runbook y para ejecutarlo. Consulta [Quién puede configurar desencadenantes](#quién-puede-configurar-desencadenantes).

## Ejecutar según una programación

:::steps
### Abrir la página Desencadenantes del runbook
Abre el runbook desde **Runbooks** y haz clic en **Ajustes → Desencadenantes** en su menú lateral. **Ajustes** empieza plegado: haz clic en él para mostrar **Desencadenantes**.

### Configurar la programación
Haz clic en **Configurar programación**. En **Cuándo se ejecuta**, elige una opción de **Repetir** y lo que necesita. El cuadro de diálogo dice la programación en una frase, como «Se ejecuta cada día laborable a las 09:00», y enumera sus próximas ejecuciones a medida que la cambias.

### Comprobar la zona horaria
**Zona horaria** empieza con la tuya. Las horas de la programación se leen en el reloj de esa zona.

### Guardarla
Haz clic en **Guardar programación**. La programación se activa, y la tarjeta la muestra en una frase con sus **Próximas ejecuciones**.
:::

| **Repetir** | Qué eliges | Por ejemplo |
| --- | --- | --- |
| **Cada pocos minutos** | **Cada**: 1, 2, 3, 4, 5, 6, 10, 12, 15, 20 o 30 minutos | Cada 15 minutos |
| **Cada pocas horas** | **Cada**: 1, 2, 3, 4, 6, 8 o 12 horas, y **Minutos después de la hora** | Cada 2 horas a los :30 |
| **Cada día** | **Hora** | Cada día a las 09:00 |
| **Días de la semana** | **Estos días**, con **Días laborables** y **Cada día** como atajos, y **Hora** | Cada día laborable a las 09:00 |
| **Personalizado (expresión cron)** | **Expresión cron** | `0 2 1 * *`: a las 02:00 del día 1 de cada mes |

Una expresión cron tiene cinco campos: minuto, hora, día del mes, mes y día de la semana. Los runbooks se ejecutan como mucho una vez por minuto, así que no hay campo de segundos. El cuadro de diálogo explica una expresión que no puede leer, o una que nunca se ejecuta, como `0 0 31 2 *`, y no guarda nada hasta que pueda ejecutarse.

Después, la tarjeta muestra la programación, sus tres próximas ejecuciones en el reloj de la zona, qué hace cuando una ejecución sigue en curso o se perdió una hora, y la **Última ejecución programada** con **Ver ejecución**. **Editar programación** abre el mismo cuadro de diálogo, y el interruptor **Ejecutar con esta programación** pausa la programación sin perderla.

### Si una ejecución sigue en curso

Una ejecución sigue en curso mientras está en cola, ejecutándose o esperando a que alguien complete o apruebe un paso, sin importar cómo empezó. El ajuste **Si una ejecución sigue en curso** de la programación, plegado en **Más campos** en el cuadro de diálogo, decide qué hace una hora que llega en ese momento:

| Ajuste | Qué ocurre |
| --- | --- |
| **Omitir esa hora** (predeterminado) | No se inicia nada. La programación espera a su próxima hora. |
| **Ejecutar cuando termine** | Una ejecución espera y se inicia cuando termina la ejecución en curso. Las demás horas que lleguen mientras tanto no inician nada. |

### Si OneUptime se saltó una hora

Si OneUptime estaba caído o actualizándose a una hora programada, la hora se pierde en cuanto lleva más de 5 minutos de retraso. **Si OneUptime se saltó una hora** decide qué ocurre cuando OneUptime vuelve:

| Ajuste | Qué ocurre |
| --- | --- |
| **Ejecutar una vez cuando OneUptime vuelva** (predeterminado) | Se inicia una ejecución, sin importar cuántas horas se perdieran, marcada como «Ejecutada una vez para compensar las horas que OneUptime se saltó». |
| **Omitir las horas perdidas** | No se inicia nada hasta la próxima hora. |

Las horas que pasan mientras la programación o el runbook está desactivado no se pierden: al volver a activar cualquiera de los dos, se continúa desde la próxima hora.

### Zonas horarias y horario de verano

Las horas se leen todo el año en el reloj de la zona. Una programación para las 09:00 en Europe/London se ejecuta a las 09:00 hora de Londres en invierno y en verano. La noche en que se adelantan los relojes, una hora que no existe esa noche se ejecuta una hora más tarde en el reloj. Cuando se atrasan los relojes y una hora llega dos veces, una programación que se ejecuta cada hora se ejecuta en ambas, y cualquier otra programación una sola vez, en la primera.

## Llamar al webhook

:::steps
### Activar el webhook
En la página **Desencadenantes** del runbook, activa **Ejecutar cuando se llame a esta URL**. El runbook obtiene su propia URL.

### Copiar la URL
La **URL del webhook** está enmascarada: haz clic en **Mostrar** para verla, o en **Copiar URL** para copiarla entera. **Pruébalo** tiene un comando `curl` para empezar.

### Llamarla desde tu herramienta
Envía una solicitud `POST` a la URL, con un objeto JSON como cuerpo, o sin cuerpo:

```bash
curl -X POST "https://oneuptime.com/runbook/webhook/RUNBOOK_ID/SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"host": "web-1", "reason": "Disk almost full"}'
```

### Comprobar la ejecución
La respuesta nombra la ejecución que inició: `{"runbookExecutionId": "...", "status": "Scheduled"}`. La ejecución está en las **Ejecuciones** del runbook, donde **Activado por** dice **Webhook**, y su página muestra lo que envió la llamada en **Entradas**.
:::

**Enviar solicitud de prueba** envía un `POST` con un cuerpo que escribes a la URL, como lo haría otra herramienta, y enlaza la ejecución que inició. Es una ejecución real del runbook.

### Qué responde una llamada

| Respuesta | Cuándo |
| --- | --- |
| `200` | La ejecución se inició. El cuerpo la nombra. |
| `400` | El cuerpo no es un objeto JSON, está anidado más de 32 niveles o contiene un carácter NUL, o el runbook no tiene pasos. |
| `403` | El webhook o el runbook está desactivado. |
| `404` | Ningún webhook de runbook responde en esta URL: el ID del runbook o la clave es incorrecto, o la URL se restableció. |
| `405` | La solicitud es un `GET`. Un `GET` nunca inicia una ejecución, así que la vista previa de un enlace en una app de chat no puede ejecutarlo por accidente. |
| `413` | El cuerpo supera los 64 KB. |
| `429` | El webhook inició 30 ejecuciones en el último minuto, 10 de sus ejecuciones siguen en curso, o una dirección hizo más de 120 llamadas a webhooks de runbook en un minuto, o las direcciones de un mismo /64 de IPv6 hicieron más de 1200 juntas. El encabezado `Retry-After` dice cuándo volver a intentarlo, cuando es posible. |
| `503` | OneUptime no puede contar las llamadas ahora mismo. Vuelve a intentarlo en un minuto. |

Una llamada rechazada no inicia nada, y su cuerpo dice el motivo en una frase, como "This runbook is turned off, so it was not started. Turn it on with Run this runbook, under the runbook's Settings."

### Mantener la URL en privado

La URL contiene la clave secreta del runbook: cualquiera que la tenga puede iniciar el runbook. La clave tiene 43 caracteres aleatorios, se compara en tiempo constante, y una clave incorrecta recibe la misma respuesta que si no existiera tal runbook.

Si la URL se filtra, haz clic en **Restablecer URL**. El runbook obtiene una URL nueva y la anterior deja de funcionar al instante, así que da la nueva a cada herramienta que la llame. Desactivar y volver a activar el webhook conserva la misma URL.

## Valores que envía una llamada al webhook

Los valores de primer nivel del cuerpo se convierten en las entradas de la ejecución. Llegan a los pasos como datos, nunca como texto pegado en un script o un comando:

| Tipo de paso | Cómo lee las entradas |
| --- | --- |
| Bash | Variables de entorno: una `ONEUPTIME_INPUT_<NAME>` por cada valor de primer nivel, `ONEUPTIME_INPUTS` con el objeto entero como JSON y `ONEUPTIME_TRIGGER` con lo que inició la ejecución, como `Webhook` o `Schedule`. |
| JavaScript | `args.inputs`, el objeto tal como se envió, y `args.trigger`. |
| AI | En su prompt, marcadas como datos de fuera de OneUptime, cuando **Incluir el contexto del desencadenante** está activado. |
| HTTP request, SSH y Kubernetes | De ningún modo. Su URL, su comando y su destino son los que dice el runbook, y nada de lo que envíe quien llama los cambia. |

El nombre de una variable es el nombre del valor en mayúsculas, con cada carácter que no sea una letra o un dígito escrito como `_`: `host-name` se convierte en `ONEUPTIME_INPUT_HOST_NAME`. El texto se pasa tal cual, los números y `true` o `false` como están escritos, y los objetos y listas como JSON. Un paso recibe como mucho 100 de estas variables, y un nombre de más de 100 caracteres no se convierte en ninguna; cada valor sigue estando en `ONEUPTIME_INPUTS`. Cada nombre empieza por `ONEUPTIME_`, así que quien llama no puede definir `PATH` ni ninguna otra variable que lea el Runner.

Quien llama decide estos valores, así que compruébalos antes de actuar con ellos:

```bash
set -euo pipefail
case "$ONEUPTIME_INPUT_HOST" in
  web-1|web-2|web-3) ;;
  *) echo "Unknown host: $ONEUPTIME_INPUT_HOST"; exit 1 ;;
esac
curl -fsS -X POST "http://$ONEUPTIME_INPUT_HOST.internal:8080/restart"
```

```javascript
const host = args.inputs.host;
if (!["web-1", "web-2", "web-3"].includes(host)) {
  throw new Error(`Unknown host: ${host}`);
}
console.log(`Started by ${args.trigger} for ${host}`);
return { host };
```

## Quién puede configurar desencadenantes

Una programación o un webhook inicia ejecuciones sin nadie presente, así que configurar uno requiere permiso para editar el runbook y para ejecutarlo: Project Owner, Project Admin o Runbook Admin, o **Edit Runbook** junto con Project Member, Runbook Member o **Create Runbook Execution**. Cuentan las etiquetas a las que se limita un rol, como en **Ejecutar ahora**. Ver o restablecer la URL del webhook requiere lo mismo.

Desactivar una programación o un webhook no inicia nada, así que solo requiere permiso para editar el runbook. Quien puede editar el runbook pero no ejecutarlo ve la página **Desencadenantes** con **Configurar programación** bloqueado, y se le dice quién puede ver la URL del webhook.

## Solución de problemas

:::details No se ejecuta nada según la programación
El runbook está desactivado o no tiene pasos: la tarjeta dice cuál de las dos. Activa **Ejecutar este runbook** en la página **Ajustes** del runbook, o añade pasos en su página **Pasos**. Si la tarjeta dice que la programación está en pausa, activa **Ejecutar con esta programación**.
:::

:::details Una hora programada no inició nada
Una ejecución seguía en curso y la programación omite esas horas, o OneUptime se saltó la hora y la programación omite las horas perdidas. Consulta [Si una ejecución sigue en curso](#si-una-ejecución-sigue-en-curso) y [Si OneUptime se saltó una hora](#si-oneuptime-se-saltó-una-hora).
:::

:::details Guardar una programación falla con "You do not have permission to set up this runbook's schedule or webhook."
Configurar un desencadenante requiere permiso para ejecutar el runbook además de para editarlo. Pide Runbook Admin, o Runbook Member o **Create Runbook Execution** además de **Edit Runbook**.
:::

:::details Una llamada recibe la respuesta "No runbook webhook answers at this URL."
La URL se restableció o se copió mal. Cópiala de nuevo desde la página **Desencadenantes** del runbook.
:::

:::details Una llamada recibe la respuesta "This runbook's webhook is turned off, so the runbook was not started."
Activa **Ejecutar cuando se llame a esta URL** en la página **Desencadenantes** del runbook. La URL es la misma que antes.
:::

## Próximos pasos

:::cards
- [Ejecutar un runbook](/docs/runbooks/running): Qué muestra una ejecución y cómo hacerla avanzar.
- [Crear un runbook](/docs/runbooks/authoring): Escribir los pasos que ejecuta un desencadenante.
- [Configuración y seguridad de runbooks](/docs/runbooks/configuration): Límites, permisos y endurecimiento.
:::
