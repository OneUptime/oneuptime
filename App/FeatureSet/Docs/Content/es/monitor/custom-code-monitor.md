# Monitor de código personalizado

El Monitor de código personalizado te permite escribir scripts personalizados para monitorear tus aplicaciones. Puedes usar esta función para monitorear tus aplicaciones de formas que no son posibles con los monitores existentes. Por ejemplo, puedes realizar solicitudes de API de varios pasos.

#### Ejemplo

El siguiente ejemplo muestra cómo usar un Monitor de código personalizado:

```javascript
// Puedes usar el módulo axios.

await axios.get("https://api.example.com/");

// Documentación de Axios aquí: https://axios-http.com/docs/intro

return {
  data: "Hello World", // devuelve cualquier dato que desees aquí.
};
```

### Uso de secretos de monitor

#### Agregar un secreto

Para agregar un secreto, ve al Panel de OneUptime → Configuración del proyecto → Secretos de monitor → Crear secreto de monitor.

![Crear secreto](/docs/static/images/CreateMonitorSecret.png)

Puedes seleccionar qué monitores tienen acceso al secreto. En este caso agregamos el secreto `ApiKey` y seleccionamos los monitores que tendrán acceso a él.

**Ten en cuenta**: Los secretos están cifrados y almacenados de forma segura. Si pierdes el secreto, deberás crear uno nuevo. No puedes ver ni actualizar el secreto después de guardarlo.

#### Usar un secreto

Para usar los Secretos de monitor en el script, puedes usar el objeto `monitorSecrets` en el contexto del script. Puedes usarlo para acceder a los secretos que has agregado al monitor.

```javascript
// si tu secreto es de tipo cadena, debes envolverlo entre comillas
let stringSecret = '{{monitorSecrets.StringSecret}}';

// si tu secreto es de tipo número o booleano, puedes usarlo directamente
let numberSecret = {{monitorSecrets.NumberSecret}};

// si tu secreto es de tipo booleano, puedes usarlo directamente
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// incluso puedes usar console.log para verificar si el secreto se está obteniendo correctamente
console.log(stringSecret);
```

### Métricas personalizadas

Puedes capturar métricas personalizadas desde tu script usando la función `oneuptime.captureMetric()`. Estas métricas se almacenan en OneUptime y pueden representarse en gráficos del panel usando el Explorador de métricas.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (cadena, requerido): El nombre de la métrica (por ejemplo, `"api.response.time"`). Se almacenará con el prefijo `custom.monitor.` automáticamente.
- `value` (número, requerido): El valor numérico de la métrica.
- `attributes` (objeto, opcional): Pares clave-valor para contexto adicional.

#### Ejemplo

```javascript
const response = await axios.get("https://api.example.com/health");

// Capturar una métrica simple
oneuptime.captureMetric("api.response.time", response.data.latency);

// Capturar una métrica con atributos
oneuptime.captureMetric("api.queue.depth", response.data.queueDepth, {
  region: "us-east-1",
  environment: "production",
});

return {
  data: response.data,
};
```

Una vez capturadas, estas métricas aparecen en el Explorador de métricas con nombres como `custom.monitor.api.response.time`. Puedes agregarlas a los gráficos del panel, configurar alertas y filtrar por monitor, sonda o cualquier atributo personalizado que hayas proporcionado.

**Límites:**

- Máximo 100 métricas por ejecución de script.
- Los nombres de métricas están limitados a 200 caracteres.
- Los valores deben ser numéricos.

### Módulos disponibles en el script

- `axios`: Puedes usar este módulo para realizar solicitudes HTTP. Es un cliente HTTP basado en promesas para el navegador y Node.js.
- `crypto`: Puedes usar este módulo para realizar operaciones criptográficas. Es un módulo integrado de Node.js que proporciona funcionalidad criptográfica, incluyendo un conjunto de envoltorios para las funciones de hash, HMAC, cifrado, descifrado, firma y verificación de OpenSSL.
- `console.log`: Puedes usar este módulo para registrar datos en la consola. Esto es útil para fines de depuración.
- `oneuptime.captureMetric`: Puedes usar esto para capturar métricas personalizadas desde tu script. Consulta la sección de Métricas personalizadas anterior.
- `http`: Puedes usar este módulo para realizar solicitudes HTTP. Es un módulo integrado de Node.js que proporciona un cliente y servidor HTTP.
- `https`: Puedes usar este módulo para realizar solicitudes HTTPS. Es un módulo integrado de Node.js que proporciona un cliente y servidor HTTPS.

### Aspectos a considerar

- Puedes usar `console.log` para registrar datos en la consola. Esto estará disponible en la sección de registros del monitor (Sondas > Ver registros).
- Puedes devolver los datos desde el script usando la declaración `return`.
- Este es un script JavaScript, por lo que puedes usar todas las características de JavaScript en el script.
- El tiempo de espera del script es de 2 minutos. Si el script tarda más de 2 minutos, será terminado.
