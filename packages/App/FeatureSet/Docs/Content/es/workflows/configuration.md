# Configuración y seguridad del flujo de trabajo

Esta página cubre los ajustes y los límites de seguridad que conviene conocer antes de apuntar un flujo de trabajo a tráfico real.

## Encender o apagar un flujo de trabajo

Todo flujo de trabajo tiene un interruptor **Habilitado** en **Ajustes**. Cuando está apagado, el flujo no se ejecuta — se ignoran las llamadas al webhook, las horas programadas y los eventos de OneUptime. Los flujos de trabajo nuevos nacen deshabilitados.

Usa este interruptor como tu puerta de «listo para salir»:

1. Construye el flujo de trabajo.
2. Haz clic en **Ejecutar flujo de trabajo** en el **Constructor** con valores realistas.
3. Revisa los **Registros** — asegúrate de que cada bloque fue adonde esperabas.
4. Activa **Habilitado**.

Apagar un flujo de trabajo no detiene las ejecuciones que ya están en marcha; solo impide que empiecen nuevas.

## Propietarios y etiquetas

- **Propietarios** — los usuarios y equipos listados como propietarios tienen acceso al flujo de trabajo y pueden optar por recibir notificaciones cuando falle. Se definen en **Ajustes → Propietarios**.
- **Etiquetas** — marcas para agrupar flujos de trabajo. La lista de flujos permite filtrar por etiqueta, lo que hace mucho más llevadero un proyecto con muchos. Útil cuando los organizas por equipo, por integración o por entorno.
- **Reglas de etiquetas** — en **Flujos de Trabajo → Ajustes → Reglas de etiquetas**, aplica etiquetas automáticamente a los flujos nuevos según patrones de nombre o descripción.
- **Reglas del propietario** — en **Flujos de Trabajo → Ajustes → Reglas del propietario**, asigna propietarios automáticamente a los flujos nuevos.

## Secretos

Marca una variable global como **Secreto** si contiene algo sensible. El valor queda oculto en las lecturas normales de la API y de la interfaz una vez guardado, y el registro del flujo de trabajo lo depura antes de persistir el log de la ejecución.

Usa variables secretas para:

- Claves de API de servicios externos.
- Tokens de autenticación.
- Claves de firma de webhooks.
- Cualquier cosa que no quieras que vea alguien con acceso de solo lectura.

No pegues un secreto directamente en un bloque — valores como `Authorization: Bearer eyJh...` acaban a la vista en el flujo de trabajo y en los registros. Usa `{{global.variables.MY_SECRET}}` en su lugar.

## Exportar e importar flujos de trabajo

Puedes mover un flujo de trabajo entre proyectos, o entre una instalación autoalojada y OneUptime Cloud, como un archivo JSON.

- **Exportar** — abre el flujo de trabajo y usa **Export Workflow** en **Ajustes**. Desde la lista de flujos también puedes seleccionar varios y exportarlos todos a un único archivo.
- **Importar** — en la lista de **Flujos de Trabajo**, haz clic en **Import JSON** y elige un archivo exportado desde cualquier proyecto de OneUptime.

El archivo guarda el nombre del flujo de trabajo, su descripción, si estaba habilitado y su grafo. Deliberadamente no guarda:

- **La clave secreta del webhook.** Al crear el flujo de trabajo se genera una nueva, así que un flujo importado tiene una URL de webhook distinta. Todo lo que llamara a la original hay que reapuntarlo.
- **Las variables globales.** Un bloque que lee `{{global.variables.MY_SECRET}}` conserva esa referencia, pero el valor no está en el archivo. Crea las variables en el proyecto de destino antes de ejecutar el flujo importado.
- **Los propietarios y las etiquetas.** Las reglas de etiquetas y de propietarios de tu proyecto se aplican al flujo importado igual que si lo hubieras creado a mano.

Un flujo de trabajo importado siempre se crea **deshabilitado**, aunque estuviera habilitado allí de donde se exportó — su grafo puede apuntar a monitores, políticas de guardia u otros flujos que no existen en el proyecto de destino. Revísalo, habilítalo, pruébalo con **Ejecutar flujo de trabajo** y entonces déjalo encendido. Duplicar un flujo de trabajo se comporta igual, así que una copia nunca empieza a dispararse junto al original antes de que la hayas editado.

Como el grafo viaja tal cual, todo lo que se haya escrito directamente en un bloque viaja con él. Esa es la razón práctica para guardar las credenciales en variables secretas: exportar un flujo de trabajo con un token escrito a mano le entrega ese token a quien reciba el archivo.

## Cuánto puede durar una ejecución

Cada intento de ejecución tiene un plazo de tiempo real. El runner lo comprueba antes y después de cada componente, y marca como **Timeout** la ejecución que se pasa en cuanto recupera el control. Los componentes que hacen trabajo de red o ejecutan scripts necesitan además sus propios tiempos límite, porque el runner no puede interrumpir por la fuerza el código arbitrario de un componente.

El componente de IA calcula el tiempo límite de la petición al proveedor a partir del tiempo restante del flujo de trabajo y lo topa en 60 segundos, dejando un pequeño margen para el registro y la limpieza.

## Límite al llamar a otros flujos de trabajo

El componente **Execute Workflow** permite que un flujo de trabajo llame a otro. Para evitar bucles accidentales en los que A llama a B y B vuelve a llamar a A, hay un tope de profundidad para la cadena. Una ejecución que se pasa del límite termina con un error claro.

Si de verdad necesitas una cadena larga (por ejemplo, una tarea que procesa un elemento por ejecución), suele ser más sencillo iterar dentro de un único flujo de trabajo con **Custom Code**.

## Seguridad de los webhooks

Los disparadores de webhook te dan una URL única. Cualquiera que la conozca puede llamarla. Para protegerte de llamadas accidentales o indeseadas:

- Trata la URL como una contraseña. No la compartas en público ni la subas a un repositorio público.
- En flujos de trabajo sensibles, pide al sistema que llama que envíe un token compartido en una cabecera (como `X-Webhook-Token`) y compruébalo con un bloque **Condiciones** antes de hacer nada importante. Guarda el token esperado como variable secreta.
- En flujos de trabajo muy sensibles, es mejor un disparador de evento de OneUptime y un paso de importación manual que un webhook público.

## Acceso de red saliente

Los bloques de API y demás bloques HTTP hacen sus peticiones desde OneUptime. Si te autoalojas, asegúrate de que tu instalación llega a los servicios a los que llamas. Si usas OneUptime Cloud, nuestros rangos de IP salientes están listados en [Direcciones IP](/docs/configuration/ip-addresses) para que puedas permitirlos al otro lado.

## Componentes de IA

**Generate Text with AI** envía una petición a través de la pasarela LLM configurada de OneUptime. Usa el proveedor LLM predeterminado del proyecto o, si el proyecto no tiene ninguno, el proveedor global de la instalación. Configura los proveedores en **Ajustes del proyecto → IA → Proveedores LLM**; nunca pongas la clave de API de un proveedor ni un endpoint de modelo arbitrario en el propio flujo de trabajo.

El componente de IA tiene una frontera de salida explícita:

- OneUptime envía al proveedor configurado una instrucción fija de seguridad del componente más los valores resueltos de **System Instructions**, **Prompt** y **Context** serializado. El contexto se añade después de un marcador explícito al final del mensaje del usuario; la instrucción fija dice que todo lo que va después de ese marcador sigue siendo dato no confiable aunque contenga etiquetas o instrucciones.
- No adjunta automáticamente el payload del disparador, el historial del flujo de trabajo, las salidas de otros componentes, los registros del proyecto, la telemetría ni los secretos. Los datos solo salen cuando tú los referencias en una de esas tres entradas.
- No envía definiciones de herramientas ni campos de capacidades propias del proveedor. El modelo no puede consultar OneUptime, hacer peticiones HTTP ni modificar datos del proyecto a través de este componente. El proveedor y el modelo configurados siguen siendo una frontera de confianza del administrador, así que las instalaciones que exijan generación estrictamente sin conexión deberían elegir un modelo sin recuperación intrínseca gestionada por el proveedor.
- Los parámetros adicionales a nivel de proveedor están restringidos a una lista de permitidos con campos de ajuste que solo afectan a la generación. No pueden sustituir los mensajes del flujo de trabajo, añadir herramientas ni búsquedas web o fuentes de datos propias del proveedor, habilitar modalidades que no sean texto, pedir varias respuestas, activar streaming, retener la petición mediante marcas de almacenamiento del proveedor ni elevar el tope de tokens de salida de este componente. Los campos de capacidades futuras que no se reconozcan se descartan por defecto.
- System Instructions, Prompt, Context y los valores de Response generados se redactan de las entradas de argumentos y de valores de retorno de este componente de IA en el registro automático de ejecución del flujo de trabajo. Siguen disponibles para los componentes posteriores mientras la ejecución está en curso. Si insertas uno de ellos en otro componente, se aplica la política de registro de ese componente, que puede guardar el valor resuelto; trata esa reutilización como una divulgación explícita. Los nombres de proveedor y modelo, los recuentos de tokens, el LLM Log ID y los mensajes de error seguros siguen siendo visibles para operaciones y facturación. Los cuerpos de error en bruto del proveedor quedan excluidos de los registros de flujo de trabajo, los registros de LLM, los registros de aplicación y las trazas, porque un proveedor puede devolver el contenido de la petición.

Trata cada variable referenciada como un dato que estás enviando a propósito al proveedor. En concreto, no metas una variable global secreta en el prompt ni en el contexto salvo que esa divulgación sea necesaria y el proveedor esté aprobado para recibirla. Un proveedor local autoalojado como Ollama puede mantener la petición dentro de tu propia infraestructura; un proveedor alojado recibe la petición bajo sus propias condiciones de tratamiento de datos.

Cada llamada se registra en **Ajustes del proyecto → IA → Registros de IA**, con el proveedor, el modelo, el estado, los tokens, el coste y la información de facturación. Las vistas previas del prompt y de la respuesta y los detalles en bruto de los errores del proveedor no se guardan en el registro de IA. Las llamadas a través de un proveedor global con coste consumen el saldo de créditos de IA del proyecto. La IA de flujos de trabajo también cuenta para el presupuesto diario de tokens de IA autónoma del proyecto; cuando el presupuesto se agota, el componente toma su camino **Error** sin contactar con el modelo. La IA del proyecto tiene que estar habilitada. En OneUptime Cloud, la suscripción debe estar al corriente de pago y hace falta el plan Growth (o uno que incluya las funciones de Growth); las instalaciones autoalojadas con la facturación desactivada no tienen esa restricción de plan.

Hay límites integrados que mantienen finitas las llamadas desatendidas: System Instructions, Prompt y el Context serializado están topados en 50.000 caracteres combinados; Temperature tiene que estar entre `0` y `1`; Maximum Output Tokens tiene que estar entre `1` y `4096` (`1024` por defecto); y la petición al proveedor se intenta una sola vez y expira como mucho a los 60 segundos. No se ejecutan más de tres llamadas de IA de flujos de trabajo a la vez por proyecto; las adicionales toman el camino **Error** y se pueden reintentar en una ejecución posterior. Los fallos de validación, configuración, acceso, presupuesto, saldo, concurrencia, proveedor y tiempo límite toman todos el camino **Error** y rellenan la salida **Error**. Conecta ese camino antes de habilitar un flujo de trabajo en producción.

## Permisos

Los flujos de trabajo respetan el control de acceso basado en roles de tu proyecto. Los permisos relevantes:

- **Crear / Leer / Editar / Eliminar flujo de trabajo** — los permisos básicos sobre el flujo de trabajo en sí.
- **Ejecutar flujo de trabajo** — necesario para ejecutar un flujo a mano o dispararlo por API.
- **Leer registro de flujo de trabajo** — necesario para ver las ejecuciones.
- **Leer / Crear / Editar / Eliminar variable de flujo de trabajo** — control sobre la lista de variables globales.

La mayoría de los ingenieros deberían tener crear/editar/leer sobre flujos de trabajo, pero no sobre variables. Reserva el acceso de edición de variables para quienes gestionan los secretos de tu proyecto.

## Límites del plan

OneUptime Cloud limita el número de ejecuciones al mes en los planes más pequeños. Tu límite actual se muestra en **Ajustes del proyecto → Facturación**. Cuando lo alcanzas, los disparos nuevos se rechazan hasta el siguiente ciclo de facturación. Las instalaciones autoalojadas no tienen este límite.

## Cuándo un flujo de trabajo no es la herramienta adecuada

Algunos casos en los que deberías recurrir a otra cosa:

- **Cálculo pesado o conjuntos de datos grandes** — los flujos de trabajo están pensados para trabajo ligero de pegamento, no para machacar números. Ejecuta el trabajo pesado en tu propia infraestructura y deja que un flujo lo arranque.
- **Cálculo activo de larga duración** — un intento de ejecución está pensado para terminar rápido. Para una espera pasiva del tipo «haz A, espera dos horas, haz B», usa el componente **Sleep**; persiste la ejecución y la reanuda más tarde sin ocupar un worker.
- **Respuesta a incidentes paso a paso con personas de por medio** — para eso están los [Runbooks](/docs/runbooks/index). Los flujos de trabajo son automatización desatendida.

## Qué leer a continuación

- [Visión general de los flujos de trabajo](/docs/workflows/index) — el panorama completo.
- [Componentes de flujo de trabajo](/docs/workflows/components) — referencia bloque a bloque.
- [Runbooks](/docs/runbooks/index) — cuándo usar un runbook en su lugar.
