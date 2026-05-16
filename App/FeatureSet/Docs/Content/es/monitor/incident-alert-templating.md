# Plantillas dinámicas de incidentes y alertas

Puedes usar la misma sintaxis de marcadores de posición `{{variable}}` que usan las Expresiones JavaScript en los criterios de monitoreo para poblar dinámicamente el Título, Descripción y Notas de remediación de Incidentes y Alertas cuando se crean automáticamente a partir de criterios de monitoreo.

## Tipos de monitores y variables compatibles

Los siguientes tipos de monitores admiten plantillas dinámicas con sus respectivas variables:

- **Monitores de sitios web y API**: Datos de respuesta, encabezados, códigos de estado, tiempos
- **Monitores de solicitudes entrantes**: Datos de solicitud, encabezados, métodos, tiempos
- **Monitores Ping**: Estado de conectividad, tiempos de respuesta, causas de fallo
- **Monitores de puerto**: Conectividad de puertos, tiempos de respuesta, estado de tiempo de espera
- **Monitores de IP**: Accesibilidad de IP, tiempos de ping, información de fallos
- **Monitores de certificado SSL**: Detalles del certificado, estado de validación, información de caducidad
- **Monitores de servidor/VM**: Métricas del sistema (CPU, memoria, disco), procesos, nombre de host
- **Monitores sintéticos**: Resultados de ejecución del script, capturas de pantalla, detalles del navegador
- **Monitores de código JavaScript personalizado**: Resultados de ejecución, tiempos, mensajes de error
- **Monitores SNMP**: Estado del dispositivo, tiempos de respuesta, valores OID

> **Nota**: Los monitores de Registros, Trazas y Métricas actualmente no admiten plantillas de incidentes/alertas ya que usan diferentes mecanismos de activación.

## Tipos de monitores y variables compatibles

### Monitores de sitios web y API

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `responseBody` | El objeto del cuerpo de la respuesta. Si es HTML/XML, entonces es una cadena. Si es JSON, entonces es un objeto JSON. | `string` o `JSON` |
| `responseHeaders` | El objeto de encabezados de respuesta (claves en minúsculas). | `Dictionary<string>` |
| `responseStatusCode` | El código de estado HTTP de la respuesta. | `number` |
| `responseTimeInMs` | El tiempo de respuesta en milisegundos. | `number` |
| `isOnline` | Si el monitor se considera en línea. | `boolean` |

### Monitores de solicitudes entrantes

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `requestBody` | El objeto del cuerpo de la solicitud. | `string` o `JSON` |
| `requestHeaders` | El objeto de encabezados de solicitud (claves en minúsculas). | `Dictionary<string>` |
| `requestMethod` | El método HTTP de la solicitud entrante (GET, POST, etc.). | `string` |
| `incomingRequestReceivedAt` | La fecha y hora en que se recibió la solicitud entrante. | `Date` |

### Monitores Ping

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `isOnline` | Si el destino del ping se considera en línea. | `boolean` |
| `responseTimeInMs` | El tiempo de respuesta del ping en milisegundos. | `number` |
| `failureCause` | La razón del fallo si el ping falló. | `string` |
| `isTimeout` | Si la solicitud de ping superó el tiempo de espera. | `boolean` |

### Monitores de puerto

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `isOnline` | Si el puerto se considera en línea/accesible. | `boolean` |
| `responseTimeInMs` | El tiempo de respuesta de la conexión en milisegundos. | `number` |
| `failureCause` | La razón del fallo si la verificación del puerto falló. | `string` |
| `isTimeout` | Si la conexión al puerto superó el tiempo de espera. | `boolean` |

### Monitores de IP

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `isOnline` | Si la dirección IP se considera en línea. | `boolean` |
| `responseTimeInMs` | El tiempo de respuesta del ping en milisegundos. | `number` |
| `failureCause` | La razón del fallo si la verificación de IP falló. | `string` |
| `isTimeout` | Si la solicitud de ping de IP superó el tiempo de espera. | `boolean` |

### Monitores de certificado SSL

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `isOnline` | Si la verificación del certificado SSL fue exitosa. | `boolean` |
| `isSelfSigned` | Si el certificado SSL está firmado automáticamente. | `boolean` |
| `createdAt` | La fecha en que se creó el certificado SSL. | `Date` |
| `expiresAt` | La fecha en que caduca el certificado SSL. | `Date` |
| `commonName` | El nombre común (CN) del certificado. | `string` |
| `organizationalUnit` | La unidad organizacional (OU) del certificado. | `string` |
| `organization` | La organización (O) del certificado. | `string` |
| `locality` | La localidad (L) del certificado. | `string` |
| `state` | El estado/provincia (ST) del certificado. | `string` |
| `country` | El país (C) del certificado. | `string` |
| `serialNumber` | El número de serie del certificado. | `string` |
| `fingerprint` | La huella digital SHA-1 del certificado. | `string` |
| `fingerprint256` | La huella digital SHA-256 del certificado. | `string` |
| `failureCause` | La razón del fallo si la verificación SSL falló. | `string` |

### Monitores de servidor/VM

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `hostname` | El nombre de host del servidor monitoreado. | `string` |
| `requestReceivedAt` | La fecha y hora en que se recibió la solicitud del monitor de servidor. | `Date` |
| `cpuUsagePercent` | El porcentaje de uso de CPU. | `number` |
| `cpuCores` | El número de núcleos de CPU. | `number` |
| `memoryUsagePercent` | El porcentaje de uso de memoria. | `number` |
| `memoryFreePercent` | El porcentaje de memoria libre. | `number` |
| `memoryTotalBytes` | La memoria total en bytes. | `number` |
| `diskMetrics` | Arreglo de métricas de disco para todos los discos montados. | `Array<Object>` |
| `diskMetrics[].diskPath` | La ruta del punto de montaje del disco. | `string` |
| `diskMetrics[].usagePercent` | El porcentaje de uso del disco para este punto de montaje. | `number` |
| `diskMetrics[].freePercent` | El porcentaje de disco libre para este punto de montaje. | `number` |
| `diskMetrics[].totalBytes` | El espacio total en disco en bytes para este punto de montaje. | `number` |
| `processes` | Arreglo de procesos en ejecución en el servidor. | `Array<Object>` |
| `processes[].pid` | El ID del proceso. | `number` |
| `processes[].name` | El nombre del proceso. | `string` |
| `processes[].command` | El comando usado para iniciar el proceso. | `string` |
| `failureCause` | La razón del fallo si la verificación del servidor falló. | `string` |

### Monitores sintéticos

Los monitores sintéticos ejecutan el mismo script en múltiples navegadores (Chromium, Firefox, Webkit) y tamaños de pantalla (móvil, tableta, escritorio), produciendo una respuesta por configuración. Cada ejecución se expone a través del arreglo `syntheticResponses`; accede a una ejecución específica por índice (`{{syntheticResponses[0].browserType}}`) o itera con `{{#each syntheticResponses}}`.

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `failureCause` | La razón del fallo si la verificación sintética falló. | `string` |
| `syntheticResponses` | Arreglo que contiene una entrada por combinación de navegador/tamaño de pantalla en la que se ejecutó el script. | `Array<Object>` |
| `syntheticResponses[].executionTimeInMs` | Tiempo de ejecución en milisegundos para esta ejecución. | `number` |
| `syntheticResponses[].result` | El resultado devuelto por esta ejecución. | `string`, `number`, `boolean` o `JSON` |
| `syntheticResponses[].scriptError` | Cualquier error que ocurrió durante esta ejecución. | `string` |
| `syntheticResponses[].logMessages` | Mensajes de registro generados durante esta ejecución. | `Array<string>` |
| `syntheticResponses[].screenshots` | Capturas de pantalla tomadas durante esta ejecución. | `Object` |
| `syntheticResponses[].browserType` | Navegador usado para esta ejecución. | `string` |
| `syntheticResponses[].screenSizeType` | Tamaño de pantalla usado para esta ejecución. | `string` |

### Monitores de código JavaScript personalizado

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `executionTimeInMs` | El tiempo que tardó en ejecutarse el código personalizado en milisegundos. | `number` |
| `result` | El resultado devuelto por el código personalizado. | `string`, `number`, `boolean` o `JSON` |
| `scriptError` | Cualquier error que ocurrió durante la ejecución del código. | `string` |
| `logMessages` | Arreglo de mensajes de registro generados durante la ejecución. | `Array<string>` |

### Monitores SNMP

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `isOnline` | Si el dispositivo SNMP está en línea y responde. | `boolean` |
| `responseTimeInMs` | El tiempo de respuesta de la consulta SNMP en milisegundos. | `number` |
| `failureCause` | La razón del fallo si la consulta SNMP falló. | `string` |
| `isTimeout` | Si la consulta SNMP superó el tiempo de espera. | `boolean` |
| `oidResponses` | Arreglo de objetos de respuesta OID con oid, name, value y type. | `Array<Object>` |
| `oidResponses[].oid` | El OID que se consultó. | `string` |
| `oidResponses[].name` | El nombre descriptivo del OID (si se proporcionó). | `string` |
| `oidResponses[].value` | El valor devuelto por el OID. | `string` o `number` |
| `oidResponses[].type` | El tipo de datos SNMP del valor. | `string` |
| `{{OID_NAME}}` | Acceso directo al valor OID por nombre (por ejemplo, `{{sysUpTime}}`). | `string` o `number` |


## Uso básico

En el formulario de Incidente/Alerta dentro de una instancia de criterios de monitor, puedes escribir:

```
API devolvió {{responseStatusCode}} en {{responseTimeInMs}}ms
```

Si el código de estado de respuesta del monitor es `502` y el tiempo es `842`, el título almacenado se convierte en:

```
API devolvió 502 en 842ms
```

El acceso JSON anidado funciona de la misma forma que las Expresiones JavaScript:

```
ID del problema: {{responseBody.error.id}}
Mensaje: {{responseBody.error.message}}
```

La indexación de arreglos es compatible:

```
Primer usuario: {{responseBody.users[0].name}}
```

Si una ruta no existe, se resuelve como una cadena vacía de forma predeterminada.

## Uso avanzado

### Acceso a elementos de arreglos
```
Uso del primer disco: {{diskMetrics[0].usagePercent}}%
Último proceso: {{processes[-1].name}}
```

### Acceso a objetos anidados
```
Mensaje de error: {{responseBody.error.details.message}}
Ubicación del servidor: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### Iteración sobre arreglos con `{{#each}}`

Puedes iterar sobre arreglos usando la sintaxis de bloque `{{#each path}}...{{/each}}`. Esto es útil cuando los datos contienen una lista de elementos y quieres incluir cada uno en tu descripción de incidente o alerta.

**Sintaxis:**
```
{{#each arrayPath}}
  ...cuerpo usando {{property}} de cada elemento...
{{/each}}
```

Dentro del cuerpo del bucle:
- `{{propertyName}}` se resuelve de forma relativa al elemento del arreglo actual
- El acceso con notación de puntos `{{nested.property}}` funciona en el elemento actual
- `{{@index}}` se resuelve al índice basado en 0 de la iteración actual
- `{{this}}` se resuelve al valor del elemento actual (útil para arreglos de cadenas/números)
- Las variables no encontradas en el elemento actual recurren al mapa de almacenamiento padre

**Ejemplo: Solicitud entrante con arreglo de alertas (por ejemplo, webhooks de Grafana):**

Si el cuerpo de tu solicitud entrante tiene el siguiente aspecto:
```json
{
  "status": "firing",
  "alerts": [
    { "status": "firing", "labels": { "label": "Coralpay" } },
    { "status": "firing", "labels": { "label": "capitecpay" } },
    { "status": "resolved", "labels": { "label": "capricorn" } }
  ]
}
```

Puedes escribir una plantilla como:
```
Etiquetas de alerta:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

Lo cual produce:
```
Etiquetas de alerta:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**Ejemplo: Métricas de disco del servidor:**
```
Uso del disco:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% usado
{{/each}}
```

**Ejemplo: Uso de `{{@index}}`:**
```
Procesos:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**Ejemplo: Arreglo primitivo con `{{this}}`:**
```
Mensajes de registro:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**Ejemplo: Bucles anidados:**

Puedes anidar bloques `{{#each}}` para arreglos de múltiples niveles:
```
{{#each requestBody.groups}}
Grupo: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **Nota**: Si la ruta no se resuelve como un arreglo, todo el bloque `{{#each}}...{{/each}}` se elimina de la salida. Los arreglos vacíos no producen ninguna salida para el bloque.


## Ejemplos

### Título de incidente del monitor de sitio web/API
```
Alta latencia: {{responseTimeInMs}}ms (> umbral)
```

### Descripción de incidente del monitor de sitio web/API
```
### Error de API
Estado: **{{responseStatusCode}}**  
Latencia: **{{responseTimeInMs}}ms**  
Fragmento del cuerpo: `{{responseBody.error.message}}`
```

### Título de alerta de solicitud entrante
```
Solicitud entrante defectuosa: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### Título de alerta de certificado SSL
```
Certificado SSL a punto de expirar: {{commonName}} caduca {{expiresAt}}
```

### Descripción de alerta del monitor de servidor
```
### Alerta del servidor: {{hostname}}
Uso de CPU: **{{cpuUsagePercent}}%**  
Uso de memoria: **{{memoryUsagePercent}}%**  
Uso del primer disco: **{{diskMetrics[0].usagePercent}}%**  
Última verificación: {{requestReceivedAt}}
```

### Título de alerta del monitor Ping
```
Ping fallido para el destino: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Descripción de alerta del monitor de puerto
```
Problema de conectividad del puerto
Estado del puerto de destino: {{isOnline}}
Tiempo de respuesta: {{responseTimeInMs}}ms
Causa del fallo: {{failureCause}}
```

### Alerta del monitor sintético

Accede a una ejecución específica de navegador/tamaño de pantalla por índice:
```
Primera ejecución: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Resultado: {{syntheticResponses[0].result}} en {{syntheticResponses[0].executionTimeInMs}}ms
```

Itera sobre cada combinación de navegador/tamaño de pantalla con `{{#each}}`:
```
### Resultados del monitor sintético
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} en {{executionTimeInMs}}ms
  - Error del script: {{scriptError}}
  - Primer registro: {{logMessages[0]}}
{{/each}}
```

### Alerta del monitor de código personalizado
```
Ejecución del código personalizado: {{executionTimeInMs}}ms
Salida del registro: {{logMessages[0]}}
```

### Título de alerta del monitor SNMP
```
Dispositivo SNMP fuera de línea: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Descripción de alerta del monitor SNMP
```
### Alerta del dispositivo SNMP
Estado: **{{isOnline}}**
Tiempo de respuesta: **{{responseTimeInMs}}ms**
Tiempo de actividad del sistema: {{sysUpTime}}
Nombre del sistema: {{sysName}}
Valor del primer OID: {{oidResponses[0].value}}
```

### Solicitud entrante con bucle de arreglos (webhook de Grafana)

Título:
```
[{{requestBody.status}}] {{requestBody.receiver}}
```

Descripción:
```
### Alertas de {{requestBody.receiver}}

{{#each requestBody.alerts}}
**Alerta {{@index}}**: {{labels.alertname}}
- Etiqueta: {{labels.label}}
- Estado: {{status}}
- Valores: {{valueString}}
- Fuente: {{generatorURL}}
{{/each}}
```

### Monitor de servidor con bucle de disco

Descripción:
```
### Alerta del servidor: {{hostname}}
Uso de CPU: **{{cpuUsagePercent}}%**
Uso de memoria: **{{memoryUsagePercent}}%**

**Uso del disco:**
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% usado ({{freePercent}}% libre)
{{/each}}

**Procesos en ejecución:**
{{#each processes}}
- [{{pid}}] {{name}}: {{command}}
{{/each}}
```

### Monitor SNMP con bucle OID

Descripción:
```
### Estado del dispositivo SNMP
En línea: {{isOnline}}
Respuesta: {{responseTimeInMs}}ms

**Valores OID:**
{{#each oidResponses}}
- {{name}} ({{oid}}): {{value}}
{{/each}}
```
