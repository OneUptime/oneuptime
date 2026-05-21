# Configuración y Seguridad

Esta página cubre los ajustes y límites de seguridad que conviene conocer antes de apuntar un workflow al tráfico real.

## Activar o desactivar un workflow

Cada workflow tiene un interruptor **Activado** en **Configuración**. Cuando está apagado, el workflow no se ejecuta: las llamadas de webhook, las horas programadas y los eventos de OneUptime se ignoran. Los workflows nuevos comienzan desactivados.

Usa este interruptor como tu puerta de "listo para producción":

1. Construye el workflow.
2. Haz clic en **Ejecutar Manualmente** con una carga útil realista.
3. Comprueba los **Registros** — asegúrate de que cada bloque fue a donde esperabas.
4. Cambia **Activado** a encendido.

Apagar un workflow no detiene las ejecuciones que ya están en curso; solo impide que comiencen nuevas.

## Propietarios y etiquetas

- **Propietarios** — los usuarios y equipos listados como propietarios tienen acceso al workflow y pueden suscribirse a notificaciones cuando falla. Configúralos en **Configuración → Propietarios**.
- **Etiquetas** — etiquetas para agrupar workflows. La lista de workflows te permite filtrar por etiqueta, lo que hace que un proyecto ocupado sea mucho más fácil de navegar. Útil cuando tienes workflows organizados por equipo, integración o entorno.
- **Reglas de etiquetas** — en **Workflows → Configuración → Reglas de Etiquetas**, aplica etiquetas automáticamente a los nuevos workflows según patrones de nombre o descripción.
- **Reglas de propietarios** — en **Workflows → Configuración → Reglas de Propietarios**, asigna automáticamente propietarios a los nuevos workflows.

## Secretos

Marca una variable global como **secreta** si contiene algo sensible. El valor se cifra, se oculta en la interfaz tras guardar y se oculta en los registros de ejecución (se muestra como `[REDACTED]`).

Usa variables secretas para:

- Claves de API de servicios externos.
- Tokens de autenticación.
- Claves de firma de webhooks.
- Cualquier cosa que no quieras que vea alguien con acceso de solo lectura.

No pegues un secreto directamente en un bloque: valores como `Authorization: Bearer eyJh...` acaban visibles en el workflow y en los registros. Usa `{{variable.MY_SECRET}}` en su lugar.

## Cuánto puede durar una ejecución

Cada ejecución tiene una duración máxima. Si una ejecución no ha terminado a tiempo, se marca como **Tiempo agotado** y el bloque en progreso se cancela. El valor predeterminado es generoso: lo suficiente para llamadas HTTP normales y cadenas de bloques.

Los bloques individuales tienen sus propios tiempos límite dentro de eso; por ejemplo, un bloque API abandona una solicitud saliente colgada mucho antes de que lo haga toda la ejecución.

## Límite al llamar a otros workflows

El componente **Ejecutar Workflow** permite que un workflow llame a otro. Para evitar bucles accidentales donde el workflow A llama a B que llama a A nuevamente, hay un tope sobre la profundidad de la cadena. Una ejecución que supere el límite termina con un error claro.

Si tienes una necesidad real de una cadena larga (como un trabajo que procesa un elemento por ejecución), normalmente es más sencillo iterar dentro de un solo workflow usando **Código personalizado**.

## Seguridad de los webhooks

Los disparadores de webhook te dan una URL única. Cualquiera que conozca la URL puede llamarla. Para protegerte contra emisores accidentales o no deseados:

- Trata la URL como una contraseña. No la compartas públicamente ni la subas a un repositorio público.
- Para workflows sensibles, pide al sistema emisor que envíe un token compartido como cabecera (por ejemplo, `X-Webhook-Token`) y verifícalo con un bloque **Condiciones** antes de hacer nada importante. Guarda el token esperado como una variable secreta.
- Para workflows muy sensibles, prefiere un disparador de evento de OneUptime y un paso de importación manual en lugar de un webhook público.

## Acceso a la red saliente

Los bloques API y otros HTTP hacen sus solicitudes desde OneUptime. Si te auto-alojas, asegúrate de que tu instalación pueda alcanzar los servicios a los que estás llamando. Si usas OneUptime Cloud, nuestros rangos de IPs salientes están listados en [Direcciones IP](/docs/configuration/ip-addresses) para que puedas permitirlos en el otro lado.

## Permisos

Los workflows respetan el control de acceso basado en roles de tu proyecto. Los permisos relevantes:

- **Crear / Leer / Editar / Eliminar Workflow** — los permisos básicos sobre el workflow en sí.
- **Ejecutar Workflow** — necesario para hacer clic en **Ejecutar Manualmente** o disparar un workflow mediante la API.
- **Leer Registro de Workflow** — necesario para ver las ejecuciones.
- **Leer / Crear / Editar / Eliminar Variable de Workflow** — control sobre la lista de variables globales.

La mayoría de los ingenieros deberían tener permisos de crear/editar/leer en workflows pero no en variables. Reserva el acceso de edición de variables para las personas que gestionan los secretos de tu proyecto.

## Límites del plan

OneUptime Cloud limita el número de ejecuciones al mes en los planes más pequeños. Tu límite actual se muestra en **Configuración del Proyecto → Facturación**. Cuando lo alcances, los nuevos disparadores se rechazan hasta el siguiente ciclo de facturación. Las instalaciones auto-alojadas no tienen este límite.

## Cuándo los workflows no son la herramienta adecuada

Algunos casos en los que deberías recurrir a otra cosa:

- **Cómputo pesado o conjuntos de datos grandes** — los workflows están diseñados para trabajo ligero de conexión, no para cálculo intensivo. Ejecuta el trabajo pesado en tu propia infraestructura y deja que un workflow lo lance.
- **Procesos de larga duración que abarcan horas** — una sola ejecución está pensada para terminar rápido. Si necesitas "hacer A, esperar dos horas, hacer B", usa un planificador externo que envíe un webhook de vuelta a OneUptime cuando sea el momento.
- **Respuesta a incidentes paso a paso con humanos en el bucle** — para eso están los [Runbooks](/docs/runbooks/index). Los workflows son para automatización desatendida.

## Dónde seguir leyendo

- [Resumen de Workflows](/docs/workflows/index) — la visión general.
- [Componentes](/docs/workflows/components) — referencia bloque a bloque.
- [Runbooks](/docs/runbooks/index) — cuándo usar un runbook en su lugar.
