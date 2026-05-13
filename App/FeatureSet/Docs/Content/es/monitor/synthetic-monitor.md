# Monitor sintético

El monitoreo sintético es una forma de monitorear proactivamente tus aplicaciones simulando interacciones del usuario. Puedes crear un monitor sintético para verificar la disponibilidad y el rendimiento de tus aplicaciones desde diferentes ubicaciones alrededor del mundo.

#### Ejemplo

El siguiente ejemplo muestra cómo usar un Monitor sintético:

```javascript

// Los objetos disponibles en el contexto del script son:

// - axios: Módulo Axios para realizar solicitudes HTTP
// - page: Objeto Page de Playwright para interactuar con el navegador
// - browserType: Tipo de navegador en el contexto de ejecución actual: Chromium, Firefox, Webkit
// - screenSizeType: Tipo de tamaño de pantalla en el contexto de ejecución actual: Mobile, Tablet, Desktop

// Puedes usar estos objetos para interactuar con el navegador y realizar solicitudes HTTP.

await page.goto('https://playwright.dev/');

// Documentación de Playwright aquí: https://playwright.dev/docs/intro

// Aquí tienes algunas de las variables que puedes usar en el contexto del objeto monitoreado:

console.log(browserType) // Esto listará el tipo de navegador en el contexto de ejecución actual: Chromium, Firefox, Webkit

console.log(screenSizeType) // Esto listará el tipo de tamaño de pantalla en el contexto de ejecución actual: Mobile, Tablet, Desktop

// El objeto page de Playwright pertenece a ese contexto de navegador específico, por lo que puedes usarlo para interactuar con el navegador.

// Para tomar capturas de pantalla, asígnalas al objeto `screenshots` que se proporciona
// en el contexto del script. Las capturas de pantalla capturadas de esta forma se preservan incluso si el
// script lanza un error después, lo que es útil para depurar ejecuciones fallidas.

screenshots['screenshot-name'] = await page.screenshot(); // puedes guardar múltiples capturas de pantalla y asignarles diferentes nombres.

// cuando quieras devolver un valor, usa la declaración return con data como prop.

// Para registrar datos, usa console.log
// console.log('Hello World');

// Puedes acceder al contexto del navegador mediante page.context() si es necesario (por ejemplo, para crear una nueva página o gestionar ventanas emergentes).


return {
    data: 'Hello World'
};
```

### Uso de Playwright

Usamos Playwright para simular las interacciones del usuario. Puedes usar el objeto `page` de Playwright para interactuar con el navegador y realizar acciones como hacer clic en botones, rellenar formularios y tomar capturas de pantalla. 

### Capturas de pantalla

En el contexto del script hay disponible un objeto `screenshots` predeclarado. Asígnale capturas de pantalla en cualquier punto del script: estas capturas se capturan **incluso si el script lanza un error** (incluidos fallos de aserción, tiempos de espera o errores inesperados), para que puedas ver exactamente cómo se veía la página cuando falló la ejecución. Las capturas capturadas aparecen en el Panel de OneUptime para esa ejecución específica del monitor.

```javascript

// Captura capturas de pantalla mediante el canal lateral `screenshots`: se preservan tanto en caso de éxito como de fallo.

await page.goto('https://app.example.com/login');
screenshots['login-page'] = await page.screenshot();

await page.fill('#email', 'user@example.com');
await page.fill('#password', 'wrong');
await page.click('button[type=submit]');

// Si la siguiente aserción lanza un error, la captura de pantalla de 'login-page' anterior todavía se captura.
await page.waitForSelector('.dashboard', { timeout: 5000 });

screenshots['dashboard'] = await page.screenshot();

return {
    data: 'Login succeeded'
};

```

#### Devolución de capturas de pantalla (método heredado)

Por compatibilidad con versiones anteriores, también puedes devolver capturas de pantalla desde el script como parte del valor devuelto. Las capturas devueltas de esta forma se capturan **solo** cuando el script se completa con normalidad; se pierden si el script lanza un error. Prefiere el patrón del canal lateral anterior cuando desees evidencia de los fallos.

```javascript
// Patrón heredado: las capturas de pantalla solo se capturan en el retorno exitoso.
const screenshots = {};
screenshots['screenshot-name'] = await page.screenshot();

return {
    data: 'Hello World',
    screenshots: screenshots
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

- `name` (cadena, requerido): El nombre de la métrica (por ejemplo, `"dashboard.load.time"`). Se almacenará con el prefijo `custom.monitor.` automáticamente.
- `value` (número, requerido): El valor numérico de la métrica.
- `attributes` (objeto, opcional): Pares clave-valor para contexto adicional.

#### Ejemplo

```javascript
await page.goto('https://app.example.com');

const startTime = Date.now();
await page.waitForSelector('#dashboard-loaded');
const loadTime = Date.now() - startTime;

// Capturar el tiempo de carga de la página como métrica personalizada
oneuptime.captureMetric('dashboard.load.time', loadTime, {
    page: 'dashboard'
});

screenshots['dashboard'] = await page.screenshot();

return {
    data: { loadTime }
};
```

Una vez capturadas, estas métricas aparecen en el Explorador de métricas con nombres como `custom.monitor.dashboard.load.time`. Puedes agregarlas a los gráficos del panel, configurar alertas y filtrar por monitor, sonda, tipo de navegador, tamaño de pantalla o cualquier atributo personalizado que hayas proporcionado.

**Límites:**
- Máximo 100 métricas por ejecución de script.
- Los nombres de métricas están limitados a 200 caracteres.
- Los valores deben ser numéricos.

### Módulos disponibles en el script
- `page`: Puedes usar este módulo para interactuar con el navegador. Es un objeto Page de Playwright que te permite realizar acciones como hacer clic en botones, rellenar formularios y tomar capturas de pantalla. Puedes acceder al contexto del navegador mediante `page.context()` si es necesario (por ejemplo, para crear una nueva página o gestionar ventanas emergentes).
- `screenshots`: Un objeto predeclarado al que asignas capturas de pantalla (por ejemplo, `screenshots['login-page'] = await page.screenshot()`). Las capturas asignadas aquí se capturan incluso si el script lanza un error posteriormente.
- `axios`: Puedes usar este módulo para realizar solicitudes HTTP. Es un cliente HTTP basado en promesas para el navegador y Node.js.
- `crypto`: Puedes usar este módulo para realizar operaciones criptográficas. Es un módulo integrado de Node.js que proporciona funcionalidad criptográfica.
- `console.log`: Puedes usar este módulo para registrar datos en la consola. Esto es útil para fines de depuración.
- `oneuptime.captureMetric`: Puedes usar esto para capturar métricas personalizadas desde tu script. Consulta la sección de Métricas personalizadas anterior.
- `http`: Puedes usar este módulo para realizar solicitudes HTTP. Es un módulo integrado de Node.js.
- `https`: Puedes usar este módulo para realizar solicitudes HTTPS. Es un módulo integrado de Node.js.

### Aspectos a considerar

- El objeto `page` es la interfaz principal para interactuar con el navegador. Proviene de la clase Page de Playwright. Puedes acceder al contexto del navegador mediante `page.context()` si es necesario.
- Puedes usar `console.log` para registrar datos en la consola. Esto estará disponible en la sección de registros del monitor.
- Puedes devolver los datos desde el script usando la declaración `return`. Asigna las capturas de pantalla al objeto `screenshots` proporcionado para que se preserven incluso si el script lanza un error.
- Puedes usar las variables `browserType` y `screenSizeType` para obtener el tipo de navegador y el tipo de tamaño de pantalla en el contexto de ejecución actual.
- Este es un script JavaScript, por lo que puedes usar todas las características de JavaScript en el script.
- Puedes usar el módulo `axios` para realizar solicitudes HTTP en el script.
- Si estás usando oneuptime.com, siempre tendrás la última versión de Playwright y los navegadores disponibles en el contexto del script. Si te auto-alojas, asegúrate de actualizar las sondas para tener la última versión de Playwright y los navegadores. 
- El tiempo de espera del script es de 2 minutos. Si el script tarda más de 2 minutos, será terminado.
