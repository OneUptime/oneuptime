# Agentes de runbook

Un **Agente de Runbook** es un pequeño proceso autohospedado que ejecuta los pasos Bash *y* JavaScript de tus runbooks **dentro de tu propia infraestructura**. El Worker de OneUptime nunca ejecuta tus scripts — los encola, y el Agente de Runbook que eligió el autor del paso los reclama, los ejecuta y devuelve el resultado.

JavaScript sigue corriendo en un sandbox `isolated-vm`; la diferencia es que el sandbox vive en tu host del agente en lugar de en el nuestro.

Esta página explica cómo instalar un agente, apuntar los pasos Bash y JavaScript hacia él y operarlo en el día a día.

## Por qué existen los agentes

Versiones anteriores de OneUptime corrían los pasos Bash y JavaScript en el Worker. JavaScript estaba en sandbox (vía `isolated-vm`), Bash no. Ambos tenían problemas para cualquier instalación más allá de un autohospedaje monoinquilino:

- **Frontera de confianza.** Cualquiera con permiso para redactar un runbook podía ejecutar código en el Worker, con acceso a las variables de entorno y al sistema de archivos del Worker. El sandbox de JavaScript bloqueaba lo obvio, pero no podía impedir que un usuario decidido sondeara qué era alcanzable desde nuestra red.
- **Alcance.** La mayoría de los pasos útiles quieren operar sobre la infraestructura *del cliente* ("reinicia este servicio", "kubectl en nuestro clúster", "busca un registro en nuestra DB interna") — no sobre la de OneUptime.

Los Agentes de Runbook le dan la vuelta a esto. Los pasos Bash y JavaScript no corren en nosotros. Corren en un host que controlas tú, y tú decides qué puede hacer ese host.

## Cómo funciona

1. Creas un Agente de Runbook en OneUptime. OneUptime genera un ID y una clave secreta.
2. Ejecutas el contenedor del agente en un host dentro de tu infraestructura con ese ID/clave más tu URL de OneUptime.
3. El agente sondea OneUptime cada pocos segundos preguntando "¿tienes trabajo para mí?".
4. Cuando redactas un paso Bash o JavaScript, eliges el agente desde un desplegable — el paso queda vinculado a ese agente concreto.
5. Al ejecutarse el paso, el Worker inserta una fila de job con `targetAgentId` apuntando a ese agente. Solo ese agente puede reclamarlo.
6. El agente ejecuta el script localmente — `bash -c <script>` para Bash, un sandbox `isolated-vm` para JavaScript — captura el resultado y lo publica de vuelta. El Worker reanuda el runbook con el resultado.

El agente solo necesita **HTTPS de salida** hacia tu instancia de OneUptime. No acepta ninguna conexión entrante.

## Instalar un agente

### 1. Crear el registro del agente

Ve a **Runbooks → Configuración → Agentes** y crea un nuevo agente. Rellena:

| Campo | Notas |
| --- | --- |
| **Nombre** | Un nombre amigable — normalmente `dónde-corre-y-qué-puede-hacer`, p. ej. `prod-eu-west-1`. Es lo que aparece en el desplegable al redactar un paso. |
| **Descripción** | Opcional. Una frase con lo que este host puede alcanzar. Tu yo futuro te lo agradecerá. |

### 2. Copia el comando de instalación

Tras crear el agente, pulsa **Mostrar instrucciones de configuración** en su fila. Verás un comando `docker run` precargado con el ID y la clave de este agente. **Guarda la clave ahora** — la puedes regenerar más tarde, pero no podrás volver a ver el mismo valor de clave una vez cierres el modal.

### 3. Ejecútalo en un host dentro de tu infraestructura

Ejecuta el comando Docker en cualquier host de tu entorno que pueda:

- alcanzar tu instancia de OneUptime por HTTPS, y
- hacer las cosas que quieres que hagan tus pasos Bash/JavaScript (p. ej. SSH a otros hosts, `kubectl`, hablar con una base de datos).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. Verifica que el agente está conectado

Vuelve a **Runbooks → Configuración → Agentes**. En unos 60 segundos la fila del agente debería pasar a `Connected` con un timestamp **Last seen** fresco. Si sigue `Disconnected`:

- Revisa los logs del contenedor (`docker logs oneuptime-runbook-agent`) por errores de autenticación o de red.
- Verifica que el host alcanza tu URL de OneUptime con `curl`.
- Verifica que el ID y la clave se copiaron sin espacios en blanco.

## Apuntar un paso a un agente

En tu runbook añade un paso Bash o JavaScript. El formulario tiene un desplegable **Agente de Runbook** que lista todos los agentes del proyecto actual (con un indicador de conectado/desconectado):

- Elige el agente que debe ejecutar este paso.
- Escribe tu script en el editor de debajo.

Cuando el runbook corra y llegue al paso, el Worker encola un job dirigido al ID de ese agente. Solo ese agente puede reclamarlo. Bash se ejecuta vía `bash -c`; JavaScript corre dentro de un sandbox `isolated-vm` en el agente (sin sistema de archivos, sin red, sin `Function`/`eval`).

¿Necesitas más de un agente? Créalos y luego apunta cada paso al que mejor le cuadre. Si quieres redundancia, puedes redactar dos runbooks (uno por agente) o repartir los pasos entre agentes.

## Notas operativas

### Tiempos de espera

A cada paso Bash o JavaScript se le aplican dos timeouts:

| Timeout | Por defecto | Qué controla |
| --- | --- | --- |
| **Claim timeout** | 2 minutos | Cuánto espera el Worker a que el agente seleccionado reclame el job. Si el agente no lo recoge a tiempo, el paso falla con `TimedOut` y el runbook continúa (o se detiene, dependiendo de **Continuar al fallar**). |
| **Execution timeout** | 30 segundos | Cuánto deja el agente correr el script antes de terminarlo. Configurable por paso. (Bash recibe `SIGKILL`; el aislamiento de JavaScript se desmonta.) |

La ventana total de espera del Worker es `claim timeout + execution timeout + unos segundos`. Elige números que casen con el paso.

### Lease y heartbeat

Cuando un agente reclama un job recibe un lease corto (30 segundos por defecto). Mientras el script corre, el agente renueva el lease cada 10 segundos. Si el agente muere o pierde la red a mitad del script, el lease caduca y el Worker marca el job como `TimedOut` en lugar de esperar para siempre.

Los procesos hijo de Bash **no** se cancelan automáticamente cuando el lease caduca (un isolate de JavaScript también se deja terminar si llega a hacerlo) — pero el Worker deja de esperarlos, y el agente no podrá enviar un resultado una vez otra reclamación se haya hecho cargo. Diseña los scripts para que sean seguros de re-ejecutar si te importa el exactly-once.

### Ningún agente en línea

Si el agente seleccionado está offline en el momento de correr el paso, el job queda `Pending` hasta que el claim timeout caduca, y luego falla con un mensaje claro "ningún agente reclamó el job". La página de agentes es donde confirmar la cobertura antes de ejecutar un runbook en serio.

### Límite de salida

La suma de stdout + stderr está limitada a **50&nbsp;KB** por paso. La salida más grande se trunca con un marcador. Si necesitas el log completo, escríbelo a S3 o a tu almacén de logs dentro del script y haz `echo` de la URL.

### Cancelación

Cancelar una ejecución de runbook (desde la vista de ejecución o la API) marca inmediatamente como `Cancelled` todos sus jobs Bash y JavaScript en `Pending`/`Claimed`/`Running`. Un agente que ya esté a mitad de script terminará su trabajo, pero el servidor no aceptará su resultado.

### Concurrencia

Cada agente ejecuta un job a la vez por defecto. Para permitir más, define `RUNBOOK_AGENT_CONCURRENCY` en el contenedor del agente — pero recuerda que el agente comparte el host con lo que viva allí.

## Variables de entorno

El agente lee estas al arrancar:

| Variable | Requerida | Por defecto | Notas |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | sí | — | URL base de tu instancia de OneUptime, p. ej. `https://oneuptime.yourdomain.com`. |
| `RUNBOOK_AGENT_ID` | sí | — | El UUID mostrado en el modal de configuración del agente. |
| `RUNBOOK_AGENT_KEY` | sí | — | El secreto mostrado en el modal de configuración del agente. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | no | `5000` | Cada cuánto sondea el agente buscando jobs nuevos. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | no | `60000` | Cada cuánto reporta el agente que está vivo. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | no | `10000` | Cada cuánto renueva el agente el lease de un job en curso. |
| `RUNBOOK_AGENT_CONCURRENCY` | no | `1` | Máximo de jobs simultáneos en este agente. |

## Rotar la clave de un agente

Si una clave se filtra, abre el agente en OneUptime y regenera su clave. La clave antigua deja de funcionar de inmediato. Actualiza el contenedor del agente con la nueva clave y reinícialo.

## Permisos

La gestión de agentes vive bajo el grupo de permisos existente de Runbooks:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gestionar registros de agentes.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roles) — asignables a un equipo para conceder control total, uso diario o acceso de solo lectura, respectivamente. `RunbookAdmin` agrupa todos los permisos granulares anteriores.

Los permisos para *disparar* un runbook (y por tanto provocar el dispatch de pasos Bash y JavaScript) siguen siendo `CreateRunbookExecution` / `EditRunbookExecution`.

## API hacia el agente

Para los curiosos — el agente usa estos endpoints, montados bajo `/runbook-agent-ingest`. Se autentican mediante el ID + clave del agente en el cuerpo JSON (o cabeceras `x-agent-id` / `x-agent-key`).

| Endpoint | Propósito |
| --- | --- |
| `POST /heartbeat` | Liveness; actualiza `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`. |
| `POST /claim-next-job` | Reclamar atómicamente el job `Pending` más antiguo dirigido al ID de este agente. Devuelve `{ job: null }` si no hay nada que hacer. |
| `POST /job/:jobId/heartbeat` | Refrescar el lease del job. Devuelve 404 una vez que el lease ha vencido o el job es terminal. |
| `POST /job/:jobId/result` | Enviar el resultado final. Se ignora si el lease ya ha caducado. |

No deberías necesitar llamarlos a mano — el agente empaquetado lo hace. Se documentan aquí por si necesitas construir tu propio agente porque el nuestro no encaja con alguna restricción tuya.
