# Agentes de Runbook

Un **Agente de Runbook** es un pequeño proceso auto-hospedado que ejecuta los pasos Bash de tus runbooks **dentro de tu propia infraestructura**. El Worker de OneUptime nunca ejecuta tus comandos de shell — los pone en cola, y un Agente de Runbook que tú instalaste en tu entorno los recoge, los ejecuta y publica el resultado de vuelta.

Esta página explica cómo instalar un agente, dirigir pasos Bash hacia él y operarlo en el día a día.

## Por qué existen los agentes

Versiones anteriores de OneUptime ejecutaban los pasos Bash directamente en el Worker. Funcionaba para despliegues self-hosted single-tenant en los que los operadores ya tenían shell en la máquina, pero tiene dos problemas para todos los demás:

- **Límite de confianza.** Cualquiera que pueda escribir un runbook puede ejecutar shell en el Worker, con acceso a todas las variables de entorno y el sistema de archivos del Worker.
- **Alcance.** La mayoría de pasos Bash útiles quieren operar sobre la infraestructura del *cliente* (“reiniciar este servicio”, “kubectl en nuestro clúster”), no sobre la de OneUptime.

Los Agentes de Runbook le dan la vuelta a esto. Los pasos Bash no se ejecutan en nosotros. Se ejecutan en un host que tú controlas, y tú decides qué puede hacer ese host.

## Cómo funciona

1. Creas un Agente de Runbook en OneUptime. OneUptime genera un ID y una clave secreta.
2. Ejecutas el contenedor del agente en un host dentro de tu infraestructura con ese ID/clave más tu URL de OneUptime.
3. El agente le pregunta a OneUptime cada pocos segundos: “¿hay trabajo para mí?”
4. Cuando se ejecuta un paso Bash, el Worker inserta una fila de trabajo etiquetada con el **Tag de Agente** del paso y la pone en `Pending`.
5. Cualquier agente sano del mismo proyecto que lleve ese tag reclama el trabajo (de forma atómica — nunca dos agentes ejecutan el mismo trabajo), ejecuta `bash -c <tu script>` localmente, captura stdout/stderr/exit-code y envía el resultado.
6. El Worker reanuda el runbook con el resultado.

El agente solo necesita **HTTPS saliente** a tu instancia de OneUptime. No acepta ninguna conexión entrante.

## Instalar un agente

### 1. Crear el registro del agente

Ve a **Runbooks → Agents → Crear nuevo**. Rellena:

| Campo | Notas |
| --- | --- |
| **Nombre** | Un nombre descriptivo — normalmente `donde-corre-y-qué-puede-hacer`, p.ej. `prod-eu-west-1`. |
| **Descripción** | Opcional. Una frase sobre qué puede alcanzar este host. Tu yo futuro te lo agradecerá. |
| **Tags** | Separados por comas. Los pasos Bash apuntan a un tag; cualquier agente del proyecto con ese tag puede ejecutarlos. Patrones comunes: `prod`, `staging`, `eu-west-1`, `db-host`. |

### 2. Copiar el comando de instalación

Después de crear el agente, pulsa **Mostrar instrucciones de configuración** en su fila. Verás un comando `docker run` precargado con el ID y la clave de este agente. **Guarda la clave ahora** — puedes restablecerla luego, pero no podrás volver a ver el mismo valor después de cerrar el modal.

### 3. Ejecutarlo en un host dentro de tu infraestructura

Ejecuta el comando Docker en cualquier host de tu entorno que pueda:

- alcanzar tu instancia de OneUptime sobre HTTPS, y
- hacer lo que quieres que hagan tus pasos Bash (p.ej. SSH a otros hosts, `kubectl`, hablar con una base de datos).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.tu-dominio.com \
  -d oneuptime/runbook-agent:release
```

### 4. Verificar que el agente está conectado

Vuelve a **Runbooks → Agents**. En unos 60 segundos la fila del agente debería pasar a `Connected` con un timestamp **Last seen** fresco. Si sigue `Disconnected`:

- Mira los logs del contenedor (`docker logs oneuptime-runbook-agent`) buscando errores de autenticación o de red.
- Verifica que el host alcanza tu URL de OneUptime con `curl`.
- Verifica que el ID y la clave se copiaron sin espacios en blanco.

## Tags y enrutamiento

Los tags son la forma en que un paso Bash encuentra un agente. Algunos patrones:

- **Un tag por entorno.** Etiqueta el agente de prod como `prod`, el de staging como `staging`. Los pasos Bash apuntando a `prod` solo corren en prod.
- **Un tag por región.** `eu-west-1`, `us-east-1`. Útil cuando un paso tiene que correr cerca del recurso que toca.
- **Varios agentes, mismo tag.** Levanta dos agentes ambos etiquetados `prod`. Cualquiera puede reclamar un trabajo — te da alta disponibilidad y te permite hacer reinicios rotativos sin caída de runbooks.
- **Varios tags por agente.** Un agente en tu clúster prod EU podría llevar `prod`, `eu-west-1` y `kubernetes`. Los pasos Bash pueden apuntar a cualquiera.

Un paso Bash **debe** especificar exactamente un tag de agente. El enrutamiento multi-tag (correr en cualquier agente que tenga `prod` AND `db`) está en la hoja de ruta pero no en este release.

## Apuntar un paso Bash a un agente

En tu runbook, añade un paso Bash. El formulario te pedirá un **Agent Tag**:

- Escribe el tag que coincida con el/los agente(s) en los que quieres que corra.
- Escribe tu script en el editor de abajo.

Cuando el runbook se ejecute y llegue a este paso, el Worker encolará un trabajo con ese tag. Si al menos un agente sano con ese tag está en línea, el trabajo se reclama en unos segundos y se ejecuta.

## Notas operativas

### Timeouts

A cada paso Bash le aplican dos timeouts:

| Timeout | Predeterminado | Qué controla |
| --- | --- | --- |
| **Claim timeout** | 2 minutos | Cuánto espera el Worker a que *algún* agente reclame el trabajo. Si nadie lo recoge a tiempo, el paso falla con `TimedOut` y el runbook continúa (o se detiene, dependiendo de **Continuar en caso de fallo**). |
| **Execution timeout** | 30 segundos | Cuánto deja el agente correr el script antes de mandar `SIGKILL`. Configurable por paso. |

La ventana total de espera del Worker es `claim timeout + execution timeout + unos segundos de margen`. Elige números acordes al paso.

### Lease y heartbeat

Cuando un agente reclama un trabajo, recibe un lease corto (30 segundos por defecto). Mientras el script corre, el agente renueva el lease cada 10 segundos. Si el agente muere o pierde la red a mitad de script, el lease expira y el Worker marca el trabajo como `TimedOut` en lugar de esperar indefinidamente.

El proceso hijo del script **no** se cancela automáticamente cuando expira el lease — pero el Worker deja de esperarlo, y el agente no podrá enviar un resultado una vez que otro claim haya tomado el relevo. Diseña los scripts para que sean seguros de reintentar si te importa la garantía “exactly-once”.

### Ningún agente en línea

Si en el momento de ejecutar el paso no hay ningún agente sano con el tag del paso, el trabajo queda `Pending` hasta que se agote el claim timeout y luego falla con un mensaje claro (“no agent claimed the job”). La página de Agents es donde confirmas que tienes cobertura antes de lanzar un runbook en serio.

### Tope de salida

stdout + stderr combinados están limitados a **50 KB** por paso. Salida mayor se trunca con un marcador. Si necesitas el log completo, escríbelo a S3 o a tu sistema de logs desde el propio script y `echo` la URL.

### Cancelación

Cancelar una ejecución de runbook (desde la vista de ejecución o la API) marca inmediatamente como `Cancelled` todos sus trabajos Bash en `Pending`/`Claimed`/`Running`. Un agente que ya está a mitad de script terminará su trabajo, pero el servidor no aceptará su resultado.

### Concurrencia

Cada agente corre un trabajo a la vez por defecto. Para permitir más, define `RUNBOOK_AGENT_CONCURRENCY` en el contenedor del agente — pero recuerda que el agente comparte host con todo lo demás que viva ahí.

## Variables de entorno

El agente lee estas al arrancar:

| Variable | Requerida | Predeterminado | Notas |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | sí | — | URL base de tu instancia de OneUptime, p.ej. `https://oneuptime.tu-dominio.com`. |
| `RUNBOOK_AGENT_ID` | sí | — | El UUID mostrado en el modal de configuración del agente. |
| `RUNBOOK_AGENT_KEY` | sí | — | El secreto mostrado en el modal de configuración del agente. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | no | `5000` | Cada cuánto consulta el agente nuevos trabajos. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | no | `60000` | Cada cuánto reporta el agente que está vivo. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | no | `10000` | Cada cuánto renueva el agente el lease de un trabajo en curso. |
| `RUNBOOK_AGENT_CONCURRENCY` | no | `1` | Máximo de trabajos simultáneos en este agente. |

## Rotar la clave de un agente

Si una clave se filtra, abre el agente en OneUptime y resetea su clave. La clave antigua deja de funcionar de inmediato. Actualiza el contenedor del agente con la nueva clave y reinícialo.

## Permisos

La gestión de agentes vive bajo el grupo de permisos de Runbooks ya existente:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gestionar registros de agentes.
- `RunbookManager` (rol) — agrupa todos los anteriores.

Los permisos para *disparar* un runbook (y por tanto despachar pasos Bash) siguen siendo `CreateRunbookExecution` / `EditRunbookExecution`.

## API expuesta a los agentes

Para los curiosos — el agente usa estos endpoints, montados bajo `/runbook-agent-ingest`. Se autentican con el ID + clave del agente en el cuerpo JSON (o cabeceras `x-agent-id` / `x-agent-key`).

| Endpoint | Propósito |
| --- | --- |
| `POST /heartbeat` | Vida; actualiza `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`. |
| `POST /claim-next-job` | Reclama atómicamente el trabajo `Pending` más antiguo cuyo tag coincida con uno de los tags del agente. Devuelve `{ job: null }` cuando no hay nada que hacer. |
| `POST /job/:jobId/heartbeat` | Renueva el lease del trabajo. Devuelve 404 una vez que el lease ha caducado o el trabajo es terminal. |
| `POST /job/:jobId/result` | Envía el resultado final. Ignorado si el lease ya pasó a otro. |

No deberías necesitar llamarlos a mano — el agente incluido lo hace. Se documentan aquí por si quieres construir tu propio agente porque el nuestro no te encaja.
