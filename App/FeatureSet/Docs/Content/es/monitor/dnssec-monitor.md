# Monitor DNSSEC

El monitoreo DNSSEC te permite validar la integridad criptográfica de las respuestas DNS para tus zonas. OneUptime realiza periódicamente una validación DNSSEC completa: verifica los registros DNSKEY, la delegación DS en la zona padre, la validez de las firmas RRSIG, el consenso de los resolvers sobre el indicador AD y la coherencia entre los servidores de nombres autoritativos.

## Información general

Los monitores DNSSEC validan toda la cadena de confianza desde la zona raíz hasta tu dominio. Esto te permite:

- Detectar cadenas DNSSEC rotas antes de que los resolvers comiencen a devolver SERVFAIL a tus usuarios
- Recibir advertencias antes de que expiren las claves de firma de zona
- Verificar que tus registros DS estén correctamente publicados en la zona padre
- Detectar divergencias entre servidores de nombres autoritativos (primario/secundario desincronizados)
- Confirmar que los resolvers validadores realmente activan el indicador AD para tu zona

## Creación de un monitor DNSSEC

1. Ve a **Monitores** en el panel de OneUptime
2. Haz clic en **Crear monitor**
3. Selecciona **DNSSEC** como tipo de monitor
4. Ingresa la zona (dominio) que deseas validar
5. Configura los resolvers y los criterios de monitoreo según sea necesario

## Opciones de configuración

### Configuración básica

| Campo | Descripción | Requerido |
|-------|-------------|----------|
| Zona (Nombre de dominio) | La zona a validar mediante DNSSEC (por ejemplo, `example.com`) | Sí |
| Resolvers | Lista separada por comas de resolvers validadores a consultar (por ejemplo, `1.1.1.1, 8.8.8.8, 9.9.9.9`) | Sí |
| Verificar coherencia de servidores de nombres | Consultar directamente cada servidor de nombres autoritativo y verificar que devuelvan el mismo número de serie SOA | No |

### Configuración avanzada

| Campo | Descripción | Predeterminado |
|-------|-------------|---------|
| Advertencia de expiración de firma (días) | Umbral predeterminado para el filtro de expiración RRSIG | 7 |
| Tiempo de espera (ms) | Tiempo de espera para cada consulta DNS | 10000 |
| Reintentos | Número de intentos de reintento en caso de fallo | 3 |

## Criterios de monitoreo

Puedes configurar criterios para determinar cuándo tu zona se considera en línea, degradada o fuera de línea según:

### Tipos de verificación disponibles

| Tipo de verificación | Descripción |
|------------|-------------|
| La cadena DNSSEC es válida | Toda la cadena de validación (raíz → TLD → zona) se resuelve correctamente |
| El registro DNSKEY DNSSEC existe | La zona publica al menos un registro DNSKEY |
| El registro DS DNSSEC existe en la zona padre | La zona padre publica un registro DS que coincide con la KSK de la zona |
| La firma DNSSEC expira en días | Días hasta que expire la firma RRSIG más próxima |
| Consenso de resolvers DNSSEC (indicador AD) | Cada resolver consultado devuelve el indicador AD (Authenticated Data) |
| Los servidores de nombres DNSSEC son coherentes | Todos los servidores de nombres autoritativos devuelven el mismo número de serie SOA |
| DNSSEC es válido | Resultado agregado de aprobado/fallido en todas las verificaciones de validación |

### Tipos de filtro

Para **La cadena DNSSEC es válida**, **El registro DNSKEY DNSSEC existe**, **El registro DS DNSSEC existe en la zona padre**, **Consenso de resolvers DNSSEC (indicador AD)**, **Los servidores de nombres DNSSEC son coherentes** y **DNSSEC es válido**:

- **Verdadero**: La condición es verdadera
- **Falso**: La condición es falsa

Para **La firma DNSSEC expira en días**:

- **Mayor que**, **Menor que**, **Mayor o igual que**, **Menor o igual que**, **Igual a**, **Diferente de**

### Ejemplos de criterios

#### Alertar si la cadena DNSSEC está rota

- **Verificar en**: La cadena DNSSEC es válida
- **Tipo de filtro**: Falso

#### Advertir antes de que expiren las firmas

- **Verificar en**: La firma DNSSEC expira en días
- **Tipo de filtro**: Menor que
- **Valor**: 7

#### Detectar un DS faltante en la zona padre (delegación rota)

- **Verificar en**: El registro DS DNSSEC existe en la zona padre
- **Tipo de filtro**: Falso

#### Detectar desacuerdo entre resolvers

- **Verificar en**: Consenso de resolvers DNSSEC (indicador AD)
- **Tipo de filtro**: Falso

#### Detectar incoherencia entre servidores de nombres

- **Verificar en**: Los servidores de nombres DNSSEC son coherentes
- **Tipo de filtro**: Falso

## Mejores prácticas

1. **Usa varios resolvers públicos**: Por defecto, `1.1.1.1`, `8.8.8.8` y `9.9.9.9` para que la caída de un solo resolver no cause falsos positivos
2. **Advierte con suficiente antelación a la expiración**: Configura alertas degradadas 7 días y alertas fuera de línea 2 días antes de la expiración de la firma; las rotaciones de claves pueden fallar silenciosamente
3. **Monitorea cada zona firmada**: Incluye dominios apex, subdominios firmados y cualquier zona delegada a otro operador
4. **Habilita las verificaciones de coherencia de servidores de nombres**: Detectan problemas de sincronización entre primario y secundario que la validación DNSSEC por sí sola pasaría por alto, a menos que tu red bloquee el tráfico DNS saliente hacia IPs arbitrarias
