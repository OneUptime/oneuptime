# Configuración y seguridad

Esta página cubre los ajustes y límites de seguridad que conviene conocer antes de apuntar un flujo de trabajo a tráfico real.

## Activar o desactivar un flujo de trabajo

Todo flujo de trabajo tiene un interruptor **Habilitado** en **Ajustes**. Cuando está desactivado, el flujo de trabajo no se ejecuta — las llamadas de webhook, los horarios programados y los eventos de OneUptime se ignoran todos. Los flujos de trabajo nuevos comienzan deshabilitados.

Usa este interruptor como tu puerta de "listo para funcionar":

1. Construye el flujo de trabajo.
2. Haz clic en **Ejecutar flujo de trabajo** en el **Constructor** con valores realistas.
3. Revisa los **Registros** — asegúrate de que cada bloque hizo lo que esperabas.
4. Activa **Habilitado**.

Desactivar un flujo de trabajo no detiene las ejecuciones que ya están en curso; solo evita que empiecen otras nuevas.

## Propietarios y etiquetas

- **Propietarios** — los usuarios y equipos listados como propietarios obtienen acceso al flujo de trabajo y pueden optar por recibir notificaciones cuando falla. Configúralos en **Ajustes → Propietarios**.
- **Etiquetas** — marcas para agrupar flujos de trabajo. La lista de flujos de trabajo te permite filtrar por etiqueta, lo que facilita mucho la navegación en un proyecto con mucha actividad. Útil cuando tienes flujos de trabajo organizados por equipo, integración o entorno.
- **Reglas de etiquetas** — en **Flujos de Trabajo → Ajustes → Reglas de etiquetas**, aplica etiquetas automáticamente a los flujos de trabajo nuevos según patrones de nombre o descripción.
- **Reglas del propietario** — en **Flujos de Trabajo → Ajustes → Reglas del propietario**, asigna propietarios automáticamente a los flujos de trabajo nuevos.

## Secretos

Marca una variable global como **secret** si contiene algo sensible. El valor queda oculto de las lecturas normales de la API y la interfaz después de guardarlo, y el registro del flujo de trabajo depura el valor resuelto antes de que se guarde el registro de ejecución.

Usa variables secretas para:

- Claves de API de servicios externos.
- Tokens de autenticación.
- Claves de firma de webhooks.
- Cualquier cosa que no quieras que vea alguien con acceso de solo lectura.

No pegues un secreto directamente en un bloque — valores como `Authorization: Bearer eyJh...` terminan visibles en el flujo de trabajo y en los registros. Usa `{{global.variables.MY_SECRET}}` en su lugar.

## Exportar e importar flujos de trabajo

Puedes mover un flujo de trabajo entre proyectos, o entre una instalación autoalojada y OneUptime Cloud, como un archivo JSON.

- **Export** — abre el flujo de trabajo y usa **Export Workflow** en **Ajustes**. Desde la lista de flujos de trabajo también puedes seleccionar varios y exportarlos a un solo archivo.
- **Import** — en la lista **Flujos de Trabajo**, haz clic en **Import JSON** y elige un archivo exportado desde cualquier proyecto de OneUptime.

El archivo contiene el nombre del flujo de trabajo, la descripción, el estado habilitado y su gráfico. Deliberadamente no contiene:

- **La clave secreta del webhook.** Se genera una nueva cuando se crea el flujo de trabajo, así que un flujo de trabajo importado tiene una URL de webhook distinta. Cualquier cosa que llame a la original debe redirigirse.
- **Las variables globales.** Un bloque que lee `{{global.variables.MY_SECRET}}` conserva esa referencia, pero el valor no está en el archivo. Crea las variables en el proyecto de destino antes de ejecutar el flujo de trabajo importado.
- **Propietarios y etiquetas.** Las propias reglas de etiquetas y propietarios de tu proyecto se ejecutan sobre el flujo de trabajo importado, igual que si lo hubieras creado a mano.

Un flujo de trabajo importado siempre se crea **deshabilitado**, aunque estuviera habilitado en el lugar del que se exportó — su gráfico puede apuntar a monitores, políticas de guardia u otros flujos de trabajo que no existen en el proyecto de destino. Revísalo, habilítalo, pruébalo con **Ejecutar flujo de trabajo** y luego déjalo activado. Duplicar un flujo de trabajo se comporta igual, así que una copia nunca empieza a activarse junto con el original antes de que la hayas editado.

Como el gráfico viaja tal cual, cualquier cosa escrita directamente en un bloque viaja con él. Esa es la razón práctica para mantener las credenciales en variables secretas: exportar un flujo de trabajo con un token codificado directamente entrega ese token a quien reciba el archivo.

## Cuánto puede durar una ejecución

Cada intento de ejecución tiene un límite de tiempo real. El ejecutor lo comprueba antes y después de cada componente y marca una ejecución vencida como **Timeout** en cuanto el control regresa. Los componentes que realizan trabajo de red o de script también necesitan sus propios tiempos de espera, porque el ejecutor no puede interrumpir a la fuerza código de componente arbitrario.

El componente de IA deriva el tiempo de espera de su solicitud al proveedor a partir del tiempo restante del flujo de trabajo y lo limita a 60 segundos, dejando un pequeño margen para el registro y la limpieza.

## Límite al llamar a otros flujos de trabajo

El componente **Execute Workflow** permite que un flujo de trabajo llame a otro. Para evitar bucles accidentales donde el flujo de trabajo A llama a B, que vuelve a llamar a A, hay un límite en la profundidad que puede alcanzar la cadena. Una ejecución que supera el límite termina con un error claro.

Si tienes una necesidad real de una cadena larga (como una tarea que procesa un elemento por ejecución), normalmente es más sencillo iterar dentro de un único flujo de trabajo usando **Custom Code**.

## Seguridad de webhooks

Los disparadores de webhook te dan una URL única. Cualquiera que conozca la URL puede llamarla. Para protegerte de llamadas accidentales o no deseadas:

- Trata la URL como una contraseña. No la compartas públicamente ni la subas a un repositorio público.
- Para flujos de trabajo sensibles, pide al sistema que llama que envíe un token compartido como cabecera (como `X-Webhook-Token`) y verifícalo con un bloque **Conditions** antes de hacer nada importante. Guarda el token esperado como una variable secreta.
- Para flujos de trabajo muy sensibles, prefiere un disparador de evento de OneUptime y un paso de importación manual en lugar de un webhook público.

## Acceso a la red saliente

Los bloques de API y otros bloques HTTP hacen sus solicitudes desde OneUptime. Si te autoalojas, asegúrate de que tu instalación pueda alcanzar los servicios a los que llamas. Si usas OneUptime Cloud, nuestros rangos de IP salientes se listan en [Direcciones IP](/docs/configuration/ip-addresses) para que puedas permitirlos del otro lado.

## Componentes de IA

**Generate Text with AI** envía una solicitud a través de la pasarela LLM configurada de OneUptime. Usa el proveedor LLM predeterminado del proyecto, o el proveedor global de la instalación cuando el proyecto no tiene uno propio. Configura los proveedores en **Ajustes del proyecto → AI → LLM Providers**; nunca pongas una clave de API de proveedor o un endpoint de modelo arbitrario en el propio flujo de trabajo.

El componente de IA tiene un límite explícito de salida de datos:

- OneUptime envía una instrucción fija de seguridad del componente más las **System Instructions**, el **Prompt** y el **Context** serializado resueltos al proveedor configurado. El Context se añade después de un marcador explícito al final del mensaje del usuario; la instrucción fija indica que todo lo que sigue a ese marcador sigue siendo datos no confiables, incluso si contiene etiquetas o instrucciones.
- No adjunta automáticamente la carga del disparador, el historial del flujo de trabajo, otras salidas de componentes, registros del proyecto, telemetría o secretos. Los datos solo salen cuando los referencias en una de esas tres entradas.
- No envía definiciones de herramientas ni campos de capacidad nativos del proveedor. El modelo no puede consultar OneUptime, hacer solicitudes HTTP ni modificar datos del proyecto a través de este componente. El proveedor/modelo configurado sigue siendo un límite de confianza administrativo, así que las instalaciones que requieran generación estrictamente sin conexión deben elegir un modelo sin recuperación nativa gestionada por el proveedor.
- Los parámetros adicionales a nivel de proveedor se restringen a una lista permitida de campos de ajuste solo de generación. No pueden reemplazar los mensajes del flujo de trabajo, añadir herramientas o búsqueda web/fuentes de datos nativas del proveedor, habilitar modalidades que no sean texto, solicitar múltiples opciones, habilitar streaming, retener la solicitud mediante indicadores de almacenamiento del proveedor, ni elevar el límite de tokens de salida de este componente. Los campos de capacidad futuros desconocidos se descartan por defecto.
- Los valores de System Instructions, Prompt, Context y Response generados se ocultan en las entradas de argumento y valor de retorno propias de este componente de IA en el registro automático de ejecución del flujo de trabajo. Siguen disponibles para los componentes posteriores mientras la ejecución está en curso. Si insertas uno en otro componente, se aplica la política de registro de ese componente y puede registrar el valor resuelto; trata la reutilización como una divulgación explícita. Los nombres de proveedor/modelo, los recuentos de tokens, el LLM Log ID y los mensajes de error seguros permanecen visibles para operaciones y facturación. Los cuerpos de error sin procesar del proveedor se excluyen de los registros del flujo de trabajo, los registros LLM, los registros de la aplicación y las trazas, porque un proveedor puede repetir el contenido de la solicitud.

Trata cada variable referenciada como datos que estás enviando intencionalmente al proveedor. En particular, no insertes una variable global secreta en el prompt o el contexto a menos que esa divulgación sea necesaria y el proveedor esté aprobado para recibirla. Un proveedor local autoalojado como Ollama puede mantener la solicitud dentro de tu propia infraestructura; un proveedor alojado recibe la solicitud bajo los términos de procesamiento de datos de ese proveedor.

Cada llamada se registra en **Ajustes del proyecto → AI → AI Logs**, incluyendo proveedor, modelo, estado, tokens, coste e información de facturación. Las vistas previas del prompt y la respuesta, y los detalles de error sin procesar del proveedor no se almacenan en el registro de IA. Las llamadas a través de un proveedor global con coste consumen el saldo de crédito de IA del proyecto. La IA del flujo de trabajo también cuenta para el presupuesto diario de tokens de IA autónoma del proyecto; cuando el presupuesto se agota, el componente toma su ruta **Error** sin contactar al modelo. La IA del proyecto debe estar habilitada. En OneUptime Cloud, la suscripción debe estar pagada y se requiere el plan Growth (o un plan que incluya funciones Growth); las instalaciones autoalojadas con la facturación deshabilitada no tienen esta restricción de plan.

Los límites integrados mantienen finitas las llamadas desatendidas: System Instructions, Prompt y el Context serializado están limitados a 50,000 caracteres combinados; Temperature debe ir de `0` a `1`; Maximum Output Tokens debe ir de `1` a `4096` (por defecto `1024`); y la solicitud al proveedor se intenta una vez y expira después de un máximo de 60 segundos. No se ejecutan más de tres llamadas de IA de flujo de trabajo simultáneamente por proyecto; las llamadas adicionales toman la ruta **Error** y pueden reintentarse en una ejecución posterior del flujo de trabajo. Los fallos de validación, configuración, acceso, presupuesto, saldo, concurrencia, proveedor y tiempo de espera toman todos la ruta **Error** y completan la salida **Error**. Conecta esa ruta antes de habilitar un flujo de trabajo en producción.

## Permisos

Los flujos de trabajo respetan el control de acceso basado en roles de tu proyecto. Los permisos relevantes:

- **Create / Read / Edit / Delete Workflow** — los permisos básicos sobre el propio flujo de trabajo.
- **Run Workflow** — necesario para ejecutar un flujo de trabajo a mano o dispararlo vía API.
- **Read Workflow Log** — necesario para ver las ejecuciones.
- **Read / Create / Edit / Delete Workflow Variable** — control sobre la lista de variables globales.

La mayoría de los ingenieros deberían tener crear/editar/leer sobre flujos de trabajo, pero no sobre variables. Reserva el acceso de edición de variables para las personas que gestionan los secretos de tu proyecto.

## Límites del plan

OneUptime Cloud limita el número de ejecuciones por mes en los planes más pequeños. Tu límite actual se muestra en **Ajustes del proyecto → Facturación**. Cuando lo alcanzas, los disparadores nuevos se rechazan hasta el siguiente ciclo de facturación. Las instalaciones autoalojadas no tienen este límite.

## Cuándo los flujos de trabajo no son la herramienta adecuada

Algunos casos en los que deberías usar otra cosa:

- **Cómputo pesado o conjuntos de datos grandes** — los flujos de trabajo están diseñados para trabajo ligero de conexión, no para procesamiento numérico intensivo. Ejecuta el trabajo pesado en tu propia infraestructura y deja que un flujo de trabajo lo inicie.
- **Cómputo activo de larga duración** — un único intento de ejecución está pensado para terminar rápido. Para una demora pasiva como "hacer A, esperar dos horas, hacer B," usa el componente **Sleep**; persiste la ejecución y la reanuda más tarde sin ocupar un worker.
- **Respuesta a incidentes paso a paso con humanos en el bucle** — para eso están los [Runbooks](/docs/runbooks/index). Los flujos de trabajo son para automatización desatendida.

## Dónde leer a continuación

- [Visión general de los flujos de trabajo](/docs/workflows/index) — la panorámica general.
- [Componentes de flujo de trabajo](/docs/workflows/components) — referencia bloque a bloque.
- [Visión general de los Runbooks](/docs/runbooks/index) — cuándo usar un runbook en su lugar.
