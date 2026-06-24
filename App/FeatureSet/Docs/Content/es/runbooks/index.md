# Visión general de los Runbooks

Los runbooks son procedimientos de respuesta reutilizables — listas ordenadas de pasos manuales o automatizados — que adjuntas a incidentes, alertas o eventos de mantenimiento programado. Convierten los hilos improvisados de Slack del tipo "¿qué hacemos ahora?" en algo que un compañero puede retomar en frío a las 3 de la madrugada.

## De un vistazo

- **Función de primer nivel** en el panel de OneUptime, en **Análisis y automatización → Runbooks**.
- **Cuatro tipos de pasos**: lista manual, JavaScript (en sandbox) y Bash (ambos corren en un [Agente de Runbook](/docs/runbooks/agents) dentro de tu propia infraestructura), petición HTTP.
- **Tres vías de activación**: reglas que coinciden con incidentes/alertas/mantenimiento programado, o el botón manual "Ejecutar runbook" en cualquier evento.
- **Semántica de snapshot**: al iniciar un runbook se copian sus pasos en la ejecución. Editar después la plantilla nunca altera una ejecución en curso.
- **Rastro de auditoría completo**: el estado, la salida, el mensaje de error y la duración de cada paso quedan registrados en la ejecución para siempre.

## ¿Por qué usar runbooks?

La respuesta a incidentes suele marcar la diferencia entre un microcorte y una caída de varias horas. Los runbooks te ayudan a:

- **Codificar el conocimiento tribal** — la respuesta a "qué hacer cuando se acumula la cola" está donde tu equipo puede encontrarla.
- **Reducir el tiempo medio de recuperación (MTTR)** — los pasos automatizados se ejecutan en segundos; los pasos manuales eliminan la parálisis de decisión.
- **Auditar las acciones de respuesta** — cada paso ejecutado, cada salida, cada clic del responder queda registrado en la ejecución.
- **Empoderar a perfiles junior** — pueden ejecutar un runbook con seguridad en lugar de llamar a un senior a las 3 de la madrugada.
- **Escribir post-mortems con datos, no con recuerdos** — la ejecución capturada es un registro congelado de lo que realmente pasó.

## Conceptos clave

Algunos términos se repiten en el resto de la documentación de runbooks. Aclaremos estos primero:

| Término              | Significado                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runbook**          | La plantilla. Un procedimiento nombrado y reutilizable con una lista ordenada de pasos y un flag `isEnabled`.                                                                                                                                     |
| **Paso**             | Un elemento de un runbook. Tiene un tipo (Manual / JavaScript / HTTP / Bash), un título, una descripción y configuración específica al tipo.                                                                                                      |
| **Regla de runbook** | Un patrón que adjunta automáticamente uno o más runbooks a incidentes, alertas o mantenimientos programados cuando su título o descripción coincide con un regex.                                                                                 |
| **Ejecución**        | Una corrida de un runbook. Se crea cuando una regla se dispara, cuando alguien pulsa "Ejecutar runbook" en un evento, o cuando alguien pulsa "Ejecutar ahora" en el runbook mismo. Contiene un snapshot de los pasos y el estado/salida por paso. |
| **Snapshot**         | La copia congelada de los pasos del runbook que vive en cada ejecución. Permite editar la plantilla después sin reescribir la historia.                                                                                                           |

## El ciclo de vida de un runbook

1. **Redactar** — Crea un runbook, mezcla pasos Manuales, JavaScript, HTTP y Bash. Guarda.
2. **(Opcional) Añadir una regla** — En la configuración de Incidentes, Alertas o Mantenimiento programado, di a OneUptime que inicie este runbook siempre que el título o descripción de un evento coincida con un regex.
3. **Disparar** — O la regla se activa automáticamente al crear un evento coincidente, o quien responde pulsa **Ejecutar runbook** manualmente en el evento.
4. **Ejecutar** — Se crea una nueva ejecución con un snapshot de los pasos. Los pasos automatizados corren en el worker de Runbook; la ejecución pausa en cada paso manual hasta que alguien lo marca.
5. **Auditar** — La ejecución queda para siempre en la pestaña **Runbooks** del evento y en la lista de ejecuciones del runbook. Salida, errores y tiempos por paso se preservan para el post-mortem.

## Cuándo usar cada tipo de paso

Guía rápida de decisión. El desglose completo está en [Crear un runbook](/docs/runbooks/authoring).

| Tipo de paso      | Úsalo cuando…                                                                                                                                                                                                                                               | Ejemplo                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Manual**        | Un humano debe verificar algo, emitir un juicio o realizar una acción que OneUptime no puede observar.                                                                                                                                                      | "Confirmar tráfico de la región secundaria en el panel del balanceador."                     |
| **JavaScript**    | Necesitas un cálculo pequeño y contenido — consultar un servicio de configuración, transformar un payload, ejecutar lógica antes del siguiente paso. Corre en sandbox en un [Agente de Runbook](/docs/runbooks/agents) dentro de tu propia infraestructura. | Calcular el lag actual de réplica y decidir si seguir.                                       |
| **Petición HTTP** | Llamas a una API existente — tu propio endpoint admin, un proveedor cloud, PagerDuty, Slack.                                                                                                                                                                | `POST` a tu orquestador de failover.                                                         |
| **Bash**          | Necesitas ejecutar comandos de shell en tu propia infraestructura — reiniciar un servicio, lanzar `kubectl`, llamar a un script de despliegue. Requiere un [Agente de Runbook](/docs/runbooks/agents) instalado en tu entorno.                              | Reiniciar un servicio, lanzar `kubectl rollout restart`, ejecutar un script de recuperación. |

Puedes mezclar los cuatro en un mismo runbook — la fuerza de los runbooks está en intercalar verificación humana con automatización.

## Dónde viven los runbooks en el panel

| Página                                                                                  | Qué haces ahí                                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Análisis y automatización → Runbooks**                                                | Navegar, crear y editar plantillas de runbook.                                                     |
| **Pestaña Pasos de un runbook**                                                         | Redactar y reordenar la lista de pasos.                                                            |
| **Pestaña Ejecuciones de un runbook**                                                   | Ver cada ejecución de ese runbook con filtros de estado.                                           |
| **Botón "Ejecutar ahora" de un runbook**                                                | Lanzar una ejecución ad hoc no vinculada a ningún evento.                                          |
| **Incidentes / Alertas / Mantenimiento programado → Configuración → Reglas de runbook** | Crear reglas de auto-disparo por tipo de entidad.                                                  |
| **Un incidente / alerta / mantenimiento → pestaña Runbooks**                            | Ver las ejecuciones vinculadas a ese evento y pulsar **Ejecutar runbook** para una corrida manual. |

## Casos de uso comunes

Algunos patrones donde vemos a los equipos echar mano de los runbooks:

- **Failover de base de datos** — Capturar el estado actual con JavaScript, pedir al DBA de guardia que confirme la salud de la réplica (Manual), llamar a la API del orquestador (HTTP), marcar "DNS actualizado" (Manual), publicar el "todo OK" en Slack (HTTP).
- **Vaciado de caché** — Un único paso HTTP más un Manual "confirmar que la tasa de aciertos de caché se recupera en el panel".
- **Incidente con impacto en cliente** — Manual: "Publicar actualización en la página de estado." HTTP: "Notificar al equipo de CS en #customer-incidents." JavaScript: "Obtener la lista de cuentas afectadas desde la API interna."
- **Pre-flight de mantenimiento programado** — JavaScript: snapshot de las métricas actuales. Manual: "Confirmar la ventana de cambio con los stakeholders." HTTP: activar modo mantenimiento en el balanceador.
- **Higiene de "ejecuta siempre"** — Una regla con patrón de título vacío que captura el estado del sistema en cada incidente, pase lo que pase — útil para post-mortems.

## Un ejemplo trabajado

Imagina que quieres que cada incidente con "db-primary" en el título dispare automáticamente un runbook de failover de DB de cinco pasos.

**1. Crea el runbook.** En **Runbooks → Crear Runbook**, llámalo "Failover DB primary" y añade estos pasos:

| #   | Tipo       | Título                                                 |
| --- | ---------- | ------------------------------------------------------ |
| 1   | JavaScript | Capturar lag de réplica previo al failover             |
| 2   | Manual     | Confirmar que la réplica está sana en el panel del DBA |
| 3   | HTTP       | `POST` al orquestador de failover                      |
| 4   | Manual     | Verificar que las escrituras van ya al nuevo primary   |
| 5   | HTTP       | Publicar el "todo OK" en Slack `#db-incidents`         |

**2. Añade una regla.** En **Incidentes → Configuración → Reglas de runbook**, crea:

```
Title Pattern:  ^db-primary
Runbooks:       [Failover DB primary]
```

**3. Dispara.** Una alerta de monitor abre el incidente `INC-4821 · db-primary connection timeout`. La regla casa, se crea una ejecución y:

- El paso 1 (JavaScript) corre de inmediato en el worker — se captura su `return { lagMs: 412 }`.
- El paso 2 (Manual) pausa la ejecución. La persona de guardia ve la pastilla "Esperándote" en la página del incidente, abre el panel y marca el paso.
- El paso 3 (HTTP) corre en cuanto el paso 2 queda marcado — se captura el cuerpo de la respuesta del `POST`.
- El paso 4 (Manual) pausa de nuevo.
- El paso 5 (HTTP) corre y termina la ejecución.

**4. Audita.** La ejecución queda en la pestaña **Runbooks** del incidente. La salida de cada paso está a un clic. Cuando escribas el post-mortem la semana siguiente, no tienes que preguntarte "¿qué devolvió ese script?" — está ahí.

## Cómo encajan los runbooks con el resto de OneUptime

- **Los monitores** abren incidentes y alertas; **las reglas de runbook** convierten esos eventos en ejecuciones. Juntos forman un bucle cerrado: detectar → disparar → responder → registrar.
- **Las conexiones de espacio de trabajo** (Slack, Microsoft Teams) son destino natural de los pasos HTTP — publicar actualizaciones de estado, notificar canales.
- **Las páginas de estado** se actualizan habitualmente como un paso Manual en un runbook con impacto en clientes.
- **Las guardias** deciden a quién llamar; los runbooks deciden qué hace esa persona cuando se despierta.

## Qué leer a continuación

- [Crear un runbook](/docs/runbooks/authoring) — crear runbooks, los cuatro tipos de paso y qué hace cada uno.
- [Reglas de runbook](/docs/runbooks/rules) — adjuntar runbooks automáticamente a incidentes, alertas y mantenimiento programado.
- [Ejecutar un runbook](/docs/runbooks/running) — disparos manuales, la vista de ejecución y cómo interactúan los pasos manuales con los automatizados.
- [Agentes de runbook](/docs/runbooks/agents) — instalar los agentes que ejecutan pasos Bash dentro de tu propia infraestructura.
- [Configuración y seguridad](/docs/runbooks/configuration) — límites de salida, permisos, notas de endurecimiento.
