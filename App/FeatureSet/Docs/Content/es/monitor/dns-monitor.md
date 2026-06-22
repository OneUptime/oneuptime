# Monitor DNS

El monitoreo DNS te permite supervisar el estado y la corrección de la resolución DNS para tus dominios. OneUptime consulta periódicamente los registros DNS y valida las respuestas según tus criterios configurados.

## Información general

Los monitores DNS consultan servidores DNS para tipos de registros específicos y evalúan los resultados. Esto te permite:

- Monitorear la disponibilidad del servicio DNS
- Verificar que los registros DNS devuelvan los valores correctos
- Rastrear los tiempos de respuesta de la resolución DNS
- Validar la configuración de DNSSEC
- Detectar problemas de propagación de DNS o secuestro de DNS

## Creación de un monitor DNS

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **DNS** como tipo de monitor
4. Ingresa el nombre de dominio y el tipo de registro a consultar
5. Configura los criterios de monitoreo según sea necesario

## Opciones de configuración

### Configuración básica

| Campo             | Descripción                                                                                                    | Requerido |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | --------- |
| Nombre de dominio | El dominio a consultar (por ejemplo, `example.com`)                                                            | Sí        |
| Tipo de registro  | El tipo de registro DNS a consultar                                                                            | Sí        |
| Servidor DNS      | Servidor DNS personalizado a usar (por ejemplo, `8.8.8.8`). Deja vacío para usar el predeterminado del sistema | No        |

### Tipos de registro compatibles

| Tipo de registro | Descripción                                        |
| ---------------- | -------------------------------------------------- |
| A                | Registros de dirección IPv4                        |
| AAAA             | Registros de dirección IPv6                        |
| CNAME            | Registros de nombre canónico (alias)               |
| MX               | Registros de intercambio de correo                 |
| NS               | Registros de servidor de nombres                   |
| TXT              | Registros de texto (SPF, DKIM, etc.)               |
| SOA              | Registros de inicio de autoridad                   |
| PTR              | Registros de puntero (DNS inverso)                 |
| SRV              | Registros de localizador de servicios              |
| CAA              | Registros de autorización de entidad certificadora |

### Configuración avanzada

| Campo                 | Descripción                                      | Predeterminado |
| --------------------- | ------------------------------------------------ | -------------- |
| Puerto                | Número de puerto DNS                             | 53             |
| Tiempo de espera (ms) | Tiempo de espera para una respuesta              | 5000           |
| Reintentos            | Número de intentos de reintento en caso de fallo | 3              |

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo tu DNS se considera en línea, degradado o fuera de línea según:

### Tipos de verificación disponibles

| Tipo de verificación            | Descripción                                        |
| ------------------------------- | -------------------------------------------------- |
| DNS está en línea               | Si el servidor DNS responde a las consultas        |
| Tiempo de respuesta DNS (en ms) | Tiempo de respuesta de la consulta en milisegundos |
| El registro DNS existe          | Si existen registros DNS para la consulta          |
| Valor del registro DNS          | El valor devuelto por un registro DNS              |
| DNSSEC es válido                | Si pasa la validación DNSSEC                       |

### Tipos de filtro

Para **DNS está en línea**, **El registro DNS existe** y **DNSSEC es válido**:

- **Verdadero**: La condición es verdadera
- **Falso**: La condición es falsa

Para **Tiempo de respuesta DNS**:

- **Mayor que**, **Menor que**, **Mayor o igual que**, **Menor o igual que**, **Igual a**, **Diferente de**

Para **Valor del registro DNS**:

- **Contiene**: El valor del registro contiene el texto especificado
- **No contiene**: El valor del registro no contiene el texto especificado
- **Comienza con**: El valor del registro comienza con el texto especificado
- **Termina con**: El valor del registro termina con el texto especificado
- **Igual a**: El valor del registro coincide exactamente
- **Diferente de**: El valor del registro no coincide

### Ejemplos de criterios

#### Verificar si el DNS está resolviendo

- **Verificar en**: DNS está en línea
- **Tipo de filtro**: Verdadero

#### Verificar que el registro A apunte a la IP correcta

- **Verificar en**: Valor del registro DNS
- **Tipo de filtro**: Igual a
- **Valor**: `93.184.216.34`

#### Alertar si la respuesta DNS es lenta

- **Verificar en**: Tiempo de respuesta DNS (en ms)
- **Tipo de filtro**: Mayor que
- **Valor**: 500

#### Verificar que DNSSEC sea válido

- **Verificar en**: DNSSEC es válido
- **Tipo de filtro**: Verdadero
