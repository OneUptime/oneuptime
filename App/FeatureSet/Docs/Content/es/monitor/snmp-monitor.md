# Monitor SNMP

El monitoreo SNMP (Protocolo Simple de Gestión de Red) te permite monitorear dispositivos de red como conmutadores, enrutadores, firewalls y otra infraestructura de red consultando OIDs (Identificadores de objetos) SNMP.

## Información general

Los monitores SNMP consultan dispositivos de red para obtener información de gestión específica usando OIDs. Esto te permite:

- Monitorear la disponibilidad y el estado del dispositivo
- Rastrear estadísticas de interfaz (tráfico, errores, estado)
- Monitorear métricas del sistema (CPU, memoria, tiempo de actividad)
- Verificar OIDs personalizados específicos del proveedor
- Establecer alertas basadas en valores OID

## Creación de un monitor SNMP

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **SNMP** como tipo de monitor
4. Configura los ajustes SNMP como se describe a continuación

## Opciones de configuración

### Configuración básica

| Campo             | Descripción                                              | Requerido |
| ----------------- | -------------------------------------------------------- | --------- |
| Versión SNMP      | Versión del protocolo: v1, v2c o v3                      | Sí        |
| Nombre de host/IP | El nombre de host o la dirección IP del dispositivo SNMP | Sí        |
| Puerto            | Puerto SNMP (predeterminado: 161)                        | Sí        |

### Autenticación

#### SNMP v1/v2c

Para SNMP v1 y v2c, solo necesitas proporcionar una cadena de comunidad:

| Campo               | Descripción                                         | Requerido |
| ------------------- | --------------------------------------------------- | --------- |
| Cadena de comunidad | La cadena de comunidad SNMP (por ejemplo, "public") | Sí        |

#### SNMP v3

SNMPv3 proporciona seguridad mejorada con autenticación y cifrado:

| Campo                      | Descripción                         | Requerido                |
| -------------------------- | ----------------------------------- | ------------------------ |
| Nivel de seguridad         | noAuthNoPriv, authNoPriv o authPriv | Sí                       |
| Nombre de usuario          | Nombre de usuario SNMPv3            | Sí                       |
| Protocolo de autenticación | MD5, SHA, SHA256 o SHA512           | Si authNoPriv o authPriv |
| Clave de autenticación     | Contraseña de autenticación         | Si authNoPriv o authPriv |
| Protocolo de privacidad    | DES, AES o AES256                   | Si authPriv              |
| Clave de privacidad        | Contraseña de privacidad/cifrado    | Si authPriv              |

### OIDs a monitorear

Agrega los OIDs que deseas consultar desde el dispositivo. Para cada OID, puedes especificar:

| Campo       | Descripción                                               | Requerido |
| ----------- | --------------------------------------------------------- | --------- |
| OID         | El OID numérico (por ejemplo, 1.3.6.1.2.1.1.1.0)          | Sí        |
| Nombre      | Un nombre descriptivo para el OID (por ejemplo, sysDescr) | No        |
| Descripción | Una descripción de lo que representa este OID             | No        |

### Plantillas comunes de OID

OneUptime proporciona plantillas para OIDs de uso común:

#### MIB del sistema

| OID               | Nombre      | Descripción                                |
| ----------------- | ----------- | ------------------------------------------ |
| 1.3.6.1.2.1.1.1.0 | sysDescr    | Descripción del sistema                    |
| 1.3.6.1.2.1.1.3.0 | sysUpTime   | Tiempo de actividad del sistema (en ticks) |
| 1.3.6.1.2.1.1.5.0 | sysName     | Nombre del sistema                         |
| 1.3.6.1.2.1.1.6.0 | sysLocation | Ubicación del sistema                      |
| 1.3.6.1.2.1.1.4.0 | sysContact  | Contacto del sistema                       |

#### MIB de interfaz

| OID                    | Nombre       | Descripción                                              |
| ---------------------- | ------------ | -------------------------------------------------------- |
| 1.3.6.1.2.1.2.1.0      | ifNumber     | Número de interfaces de red                              |
| 1.3.6.1.2.1.2.2.1.8.X  | ifOperStatus | Estado operativo de la interfaz (X = índice de interfaz) |
| 1.3.6.1.2.1.2.2.1.10.X | ifInOctets   | Bytes de entrada (X = índice de interfaz)                |
| 1.3.6.1.2.1.2.2.1.16.X | ifOutOctets  | Bytes de salida (X = índice de interfaz)                 |

#### MIB de recursos del host

| OID                      | Nombre            | Descripción                                      |
| ------------------------ | ----------------- | ------------------------------------------------ |
| 1.3.6.1.2.1.25.1.1.0     | hrSystemUptime    | Tiempo de actividad del sistema host             |
| 1.3.6.1.2.1.25.1.5.0     | hrSystemNumUsers  | Número de usuarios                               |
| 1.3.6.1.2.1.25.1.6.0     | hrSystemProcesses | Número de procesos en ejecución                  |
| 1.3.6.1.2.1.25.3.3.1.2.X | hrProcessorLoad   | Carga del procesador (X = índice del procesador) |

### Configuración avanzada

| Campo            | Descripción                                      | Predeterminado |
| ---------------- | ------------------------------------------------ | -------------- |
| Tiempo de espera | Tiempo de espera para una respuesta (ms)         | 5000           |
| Reintentos       | Número de intentos de reintento en caso de fallo | 3              |

## Criterios de monitoreo

Puedes configurar criterios para verificar las respuestas SNMP y activar alertas o incidentes.

### Tipos de verificación disponibles

| Tipo de verificación              | Descripción                                                    |
| --------------------------------- | -------------------------------------------------------------- |
| El dispositivo SNMP está en línea | Verifica si el dispositivo responde a las consultas SNMP       |
| Tiempo de respuesta SNMP          | Verifica el tiempo de respuesta de la consulta en milisegundos |
| Valor OID SNMP                    | Verifica el valor devuelto por un OID específico               |
| El OID SNMP existe                | Verifica si un OID devuelve un valor (no nulo)                 |

### Ejemplos de criterios

#### Verificar si el dispositivo está en línea

- **Verificar en**: El dispositivo SNMP está en línea
- **Tipo de filtro**: Verdadero

#### Alertar si el tiempo de respuesta supera el umbral

- **Verificar en**: Tiempo de respuesta SNMP (en ms)
- **Tipo de filtro**: Mayor que
- **Valor**: 1000

#### Verificar el estado de la interfaz

- **Verificar en**: Valor OID SNMP
- **OID**: 1.3.6.1.2.1.2.2.1.8.1
- **Tipo de filtro**: Igual a
- **Valor**: 1 (1 = activo, 2 = inactivo)

#### Verificar el umbral de carga de CPU

- **Verificar en**: Valor OID SNMP
- **OID**: 1.3.6.1.2.1.25.3.3.1.2.1
- **Tipo de filtro**: Mayor que
- **Valor**: 80

## Uso de secretos de monitor

Por seguridad, puedes almacenar información sensible como cadenas de comunidad y credenciales de SNMPv3 como secretos.

### Agregar un secreto

1. Ve a **Configuración del proyecto** → **Secretos de monitor** → **Crear secreto de monitor**
2. Agrega tu secreto (por ejemplo, cadena de comunidad o contraseña de SNMPv3)
3. Selecciona los monitores SNMP que deben tener acceso a este secreto

### Usar secretos en la configuración SNMP

Usa la sintaxis `{{monitorSecrets.SECRET_NAME}}` en cualquier campo sensible:

- **Cadena de comunidad**: `{{monitorSecrets.SnmpCommunity}}`
- **Clave de autenticación SNMPv3**: `{{monitorSecrets.SnmpAuthKey}}`
- **Clave de privacidad SNMPv3**: `{{monitorSecrets.SnmpPrivKey}}`

## Variables de plantilla para alertas

Al crear plantillas de incidentes o alertas, puedes usar las siguientes variables:

| Variable               | Descripción                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `{{isOnline}}`         | Si el dispositivo está en línea (verdadero/falso)                    |
| `{{responseTimeInMs}}` | Tiempo de respuesta de la consulta en milisegundos                   |
| `{{failureCause}}`     | Mensaje de error si la consulta falló                                |
| `{{oidResponses}}`     | Arreglo de objetos de respuesta OID                                  |
| `{{OID_NAME}}`         | Valor de un OID específico por nombre (por ejemplo, `{{sysUpTime}}`) |

## Solución de problemas

### Problemas comunes

#### El dispositivo no responde

- Verifica que la IP/nombre de host del dispositivo sea correcta
- Comprueba que SNMP esté habilitado en el dispositivo
- Verifica que las reglas del firewall permitan el puerto UDP 161
- Confirma que la cadena de comunidad sea correcta

#### Fallos de autenticación (v3)

- Verifica el nombre de usuario, el protocolo de autenticación y la clave de autenticación
- Asegúrate de que el nivel de seguridad coincida con la configuración del dispositivo
- Comprueba que el protocolo de privacidad y la clave sean correctos para el nivel authPriv

#### OID no encontrado

- Verifica que el OID sea compatible con tu dispositivo
- Comprueba si el OID requiere que se cargue un MIB específico
- Intenta consultar el OID directamente usando las herramientas snmpget/snmpwalk

### Prueba de conectividad SNMP

Antes de configurar el monitoreo, puedes probar la conectividad SNMP usando herramientas de línea de comandos:

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## Buenas prácticas

1. **Usa SNMPv3 cuando sea posible**: Proporciona autenticación y cifrado para mayor seguridad
2. **Almacena las credenciales como secretos**: Nunca codifiques las cadenas de comunidad o contraseñas
3. **Monitorea solo los OIDs esenciales**: Consulta solo lo que necesitas para reducir la sobrecarga de red
4. **Establece tiempos de espera apropiados**: Los dispositivos de red pueden tener tiempos de respuesta variables
5. **Usa nombres descriptivos para los OIDs**: Hace que los mensajes de alerta sean más fáciles de entender
6. **Prueba antes de implementar**: Verifica la conectividad SNMP antes de crear los monitores
