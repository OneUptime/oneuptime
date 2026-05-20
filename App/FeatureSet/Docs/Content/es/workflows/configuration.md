# Configuración y seguridad

Esta página reúne los ajustes y los límites de seguridad que conviene conocer antes de apuntar un flujo de trabajo al tráfico de producción.

## Habilitar / deshabilitar

Cada flujo de trabajo tiene un flag **isEnabled** en **Settings**. Los flujos de trabajo deshabilitados nunca se activan — los eventos de modelo, los webhooks y las ejecuciones programadas se ignoran. Los flujos nuevos se envían deshabilitados.

Trátalo como tu interruptor de "listo para producción":

1. Construye el flujo de trabajo.
2. Haz clic en **Run Manually** con un payload representativo.
3. Comprueba **Logs** — confirma que cada nodo tomó el puerto que esperabas.
4. Activa **isEnabled**.

Deshabilitar un flujo de trabajo no afecta a las ejecuciones que ya están en curso; solo impide que se creen nuevas.

## Propiedad y etiquetas

- **Owners** — los usuarios y equipos listados como propietarios reciben acceso basado en permisos y (opcionalmente) notificaciones cuando el flujo de trabajo falla. Configúralo en **Settings → Owners**.
- **Labels** — etiquetas muchos-a-muchos para organizar flujos de trabajo. Filtra la lista de flujos por etiqueta. Útil cuando un proyecto tiene docenas de flujos organizados por equipo, integración o entorno.
- **Label rules** — en **Workflows → Settings → Label Rules**, auto-aplica etiquetas a los flujos nuevos según coincidencias regex en el nombre o la descripción.
- **Owner rules** — en **Workflows → Settings → Owner Rules**, asigna automáticamente propietarios a los flujos nuevos.

## Secretos

Las variables globales pueden marcarse como **secreto**. El valor se cifra en reposo, es de solo escritura en la interfaz tras guardar y se redacta en los logs de ejecución (sustituido por `[REDACTED]`).

Usa variables secretas para:

- Claves de API para integraciones salientes.
- Tokens bearer.
- Claves de firma de webhooks.
- Cualquier valor que un atacante con acceso de lectura a un flujo de trabajo no debería ver.

No pegues un secreto directamente en el argumento de un componente — referencias como `Authorization: Bearer eyJh...` aparecen en el JSON del flujo de trabajo y en los logs de ejecución en texto claro. Referencia `{{variable.MY_SECRET}}` en su lugar.

## Timeout de ejecución

Cada ejecución tiene una duración máxima. Si una ejecución no ha terminado dentro del timeout, se marca como `Timeout` y cualquier componente en vuelo se cancela. El valor por defecto es generoso (minutos, no segundos) — consulta la configuración de entorno del worker para el valor exacto en tu instalación.

La mayoría de los componentes tienen sus propios timeouts por llamada dentro del timeout de ejecución — por ejemplo, el componente API abandonará una petición saliente colgada bastante antes que toda la ejecución.

## Límite de recursión

El componente **Execute Workflow** permite que un flujo de trabajo llame a otro. Para prevenir bucles descontrolados donde A llama a B que llama a A indefinidamente, el worker rastrea la cadena de llamadas y detiene una cadena que excede una profundidad fija (típicamente un número pequeño como 5). La ejecución terminada se marca como `Error` con un mensaje claro sobre el límite de recursión.

Si tienes una necesidad legítima de una cadena larga (por ejemplo, un recorrido recursivo de carpetas que procesa un nivel por ejecución), refactorízalo en un solo flujo de trabajo que itere internamente mediante **Custom Code** — ese patrón no está sujeto al límite de la cadena.

## Seguridad de webhooks

Los disparadores webhook exponen una URL HTTPS única. Cualquiera que conozca la URL puede llamarla. Para defenderte contra llamadores accidentales u hostiles:

- Trata la URL como un secreto compartido. No la pegues en un chat público ni la cometas a un repositorio público.
- Para flujos de trabajo de alto valor, pide al sistema llamante que incluya un secreto compartido como header (por ejemplo, `X-Webhook-Token`) y valídalo en un nodo **Conditions** antes de hacer cualquier cosa destructiva. Define el token esperado como una variable global secreta.
- Para flujos de trabajo de muy alto valor, prefiere un disparador de evento de modelo y un paso de importación manual en lugar de un webhook público.

## Salida de red

Los componentes API y otros del estilo HTTP envían peticiones desde la red del Workflow Worker de OneUptime. Si auto-alojas OneUptime, la red saliente del worker es asunto tuyo — asegúrate de que puede llegar a las APIs de terceros a las que llamas. Si usas OneUptime Cloud, nuestro rango de IP de salida se publica en [Direcciones IP](/docs/configuration/ip-addresses) para que puedas permitirlo en el lado receptor.

## Permisos

Los flujos de trabajo son recursos de primera clase sujetos al control de acceso basado en roles a nivel de proyecto:

- `CreateWorkflow`, `ReadWorkflow`, `EditWorkflow`, `DeleteWorkflow` — los cuatro permisos CRUD sobre las plantillas de flujos de trabajo.
- `RunWorkflow` — necesario para hacer clic en **Run Manually** o despachar un flujo de trabajo vía API.
- `ReadWorkflowLog` — necesario para ver la página **Runs & Logs**.
- `ReadWorkflowVariable`, `CreateWorkflowVariable`, `EditWorkflowVariable`, `DeleteWorkflowVariable` — control sobre la lista de variables globales.

La mayoría de los ingenieros deberían tener crear/editar/leer sobre flujos de trabajo, pero no sobre variables. Reserva el acceso de edición de variables para las personas que gestionan los secretos de tu proyecto.

## Cuotas

OneUptime Cloud limita el número de ejecuciones por mes por proyecto en los planes más pequeños. El límite se muestra en **Project Settings → Billing**. Cuando lo alcanzas, los nuevos disparadores se rechazan (y se registran con la razón "cuota excedida" en el flujo de trabajo afectado) hasta el siguiente ciclo de facturación. Las instalaciones auto-alojadas no están sujetas a cuota.

## En qué *no* son buenos los flujos de trabajo

Algunos patrones donde deberías recurrir a una herramienta distinta:

- **Computación de larga duración** — los flujos de trabajo están orientados al pegamento entre sistemas, no a procesar grandes conjuntos de datos. Ejecuta el trabajo pesado en tu propia infraestructura y usa un flujo de trabajo para lanzarlo.
- **Flujos de trabajo con estado que duran minutos/horas** — una ejecución única está pensada para terminar rápido. Si necesitas "haz A, luego espera dos horas, luego haz B", modela la espera como un planificador externo que devuelva la llamada a un disparador webhook.
- **Respuesta a incidentes paso a paso con puntos de control humano** — para eso están los [Runbooks](/docs/runbooks/index). Usa un flujo de trabajo si no hay un humano en el bucle; usa un runbook si sí lo hay.

## Qué leer a continuación

- [Visión general de los flujos de trabajo](/docs/workflows/index) — el mapa conceptual.
- [Componentes](/docs/workflows/components) — detalles de argumentos para cada acción.
- [Runbooks](/docs/runbooks/index) — cuándo usar un runbook en su lugar.
