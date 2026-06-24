# Monitor Sintético

O monitoramento sintético é uma maneira de monitorar proativamente seus aplicativos simulando interações do usuário. Você pode criar um monitor sintético para verificar a disponibilidade e o desempenho dos seus aplicativos a partir de diferentes localizações ao redor do mundo.

#### Exemplo

O exemplo a seguir mostra como usar um Monitor Sintético:

```javascript
// Objects available in the context of the script are:

// - axios: Axios module to make HTTP requests
// - page: Playwright Page object to interact with the browser
// - browserType: Browser type in the current run context - Chromium, Firefox, Webkit
// - screenSizeType: Screen size type in the current run context - Mobile, Tablet, Desktop

// You can use these objects to interact with the browser and make HTTP requests.

await page.goto("https://playwright.dev/");

// Playwright Documentation here: https://playwright.dev/docs/intro

// Here are some of the variables that you can use in the context of the monitored object:

console.log(browserType); // This will list the browser type in the current run context - Chromium, Firefox, Webkit

console.log(screenSizeType); // This will list the screen size type in the current run context - Mobile, Tablet, Desktop

// Playwright page object belongs to that specific browser context, so you can use it to interact with the browser.

// To take screenshots, assign them to the `screenshots` object that is provided
// in the script context. Screenshots captured this way are preserved even if the
// script later throws — useful for debugging failed runs.

screenshots["screenshot-name"] = await page.screenshot(); // you can save multiple screenshots and have them with different names.

// when you want to return a value, use return statement with data as a prop.

// To log data, use console.log
// console.log('Hello World');

// You can access the browser context via page.context() if needed (for example, to create a new page or dealing with popups).

return {
  data: "Hello World",
};
```

### Uso do Playwright

Usamos o Playwright para simular interações do usuário. Você pode usar o objeto `page` do Playwright para interagir com o navegador e realizar ações como clicar em botões, preencher formulários e tirar capturas de tela.

### Capturas de Tela

Um objeto `screenshots` pré-declarado está disponível no contexto do script. Atribua capturas de tela a ele em qualquer ponto do script — essas capturas de tela são capturadas **mesmo se o script lançar** (incluindo falhas de asserção, timeouts ou erros inesperados), para que você possa ver exatamente como a página estava quando a execução falhou. As capturas de tela capturadas aparecem no Painel do OneUptime para essa execução específica do monitor.

```javascript
// Capture screenshots via the `screenshots` side-channel — they are preserved on both success and failure.

await page.goto("https://app.example.com/login");
screenshots["login-page"] = await page.screenshot();

await page.fill("#email", "user@example.com");
await page.fill("#password", "wrong");
await page.click("button[type=submit]");

// If the next assertion throws, the `login-page` screenshot above is still captured.
await page.waitForSelector(".dashboard", { timeout: 5000 });

screenshots["dashboard"] = await page.screenshot();

return {
  data: "Login succeeded",
};
```

#### Retornando capturas de tela (legado)

Para compatibilidade retroativa, você também pode retornar capturas de tela do script como parte do valor de retorno. As capturas de tela retornadas desta forma **só** são capturadas quando o script é concluído normalmente — elas são perdidas se o script lançar. Prefira o padrão de canal lateral acima quando quiser evidências de falhas.

```javascript
// Legacy pattern — screenshots only captured on successful return.
const screenshots = {};
screenshots["screenshot-name"] = await page.screenshot();

return {
  data: "Hello World",
  screenshots: screenshots,
};
```

### Usando Segredos de Monitor

#### Adicionando um segredo

Para adicionar um segredo, vá para Painel do OneUptime -> Configurações do Projeto -> Segredos de Monitor -> Criar Segredo de Monitor.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

Você pode selecionar quais monitores têm acesso ao segredo. Neste caso, adicionamos o segredo `ApiKey` e selecionamos monitores para ter acesso a ele.

**Observe**: Os segredos são criptografados e armazenados com segurança. Se você perder o segredo, precisará criar um novo. Você não pode visualizar ou atualizar o segredo após salvo.

#### Usando um segredo

Para usar Segredos de Monitor no script, você pode usar o objeto `monitorSecrets` no contexto do script. Você pode usá-lo para acessar os segredos que adicionou ao monitor.

```javascript
// if your secret is of type string then you need to wrap it in quotes
let stringSecret = '{{monitorSecrets.StringSecret}}';

// if your secret is of type number or boolean then you can use it directly
let numberSecret = {{monitorSecrets.NumberSecret}};

// if your secret is of type boolean then you can use it directly
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// you can even console log to see if the secrets is being fetched correctly
console.log(stringSecret);
```

### Métricas Personalizadas

Você pode capturar métricas personalizadas do seu script usando a função `oneuptime.captureMetric()`. Essas métricas são armazenadas no OneUptime e podem ser exibidas em painéis usando o Explorador de Métricas.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (string, obrigatório): O nome da métrica (ex.: `"dashboard.load.time"`). Será armazenado com o prefixo `custom.monitor.` automaticamente.
- `value` (number, obrigatório): O valor numérico da métrica.
- `attributes` (object, opcional): Pares chave-valor para contexto adicional.

#### Exemplo

```javascript
await page.goto("https://app.example.com");

const startTime = Date.now();
await page.waitForSelector("#dashboard-loaded");
const loadTime = Date.now() - startTime;

// Capture page load time as a custom metric
oneuptime.captureMetric("dashboard.load.time", loadTime, {
  page: "dashboard",
});

screenshots["dashboard"] = await page.screenshot();

return {
  data: { loadTime },
};
```

Uma vez capturadas, essas métricas aparecem no Explorador de Métricas com nomes como `custom.monitor.dashboard.load.time`. Você pode adicioná-las a gráficos do painel, configurar alertas e filtrar por monitor, probe, tipo de navegador, tamanho de tela ou quaisquer atributos personalizados fornecidos.

**Limites:**

- Máximo de 100 métricas por execução de script.
- Os nomes de métricas são limitados a 200 caracteres.
- Os valores devem ser numéricos.

### Módulos disponíveis no script

- `page`: Você pode usar este módulo para interagir com o navegador. É um objeto Playwright Page que permite realizar ações como clicar em botões, preencher formulários e tirar capturas de tela. Você pode acessar o contexto do navegador via `page.context()` se necessário (por exemplo, para criar uma nova página ou lidar com popups).
- `screenshots`: Um objeto pré-declarado ao qual você atribui capturas de tela (ex.: `screenshots['login-page'] = await page.screenshot()`). As capturas de tela atribuídas aqui são capturadas mesmo se o script lançar posteriormente.
- `axios`: Você pode usar este módulo para fazer requisições HTTP. É um cliente HTTP baseado em promessas para o navegador e Node.js.
- `crypto`: Você pode usar este módulo para realizar operações criptográficas. É um módulo Node.js integrado que fornece funcionalidade criptográfica que inclui um conjunto de wrappers para as funções de hash, HMAC, cifra, decifra, assinatura e verificação do OpenSSL.
- `console.log`: Você pode usar este módulo para registrar dados no console. Isso é útil para fins de depuração.
- `oneuptime.captureMetric`: Você pode usar isso para capturar métricas personalizadas do seu script. Consulte a seção Métricas Personalizadas acima.
- `http`: Você pode usar este módulo para fazer requisições HTTP. É um módulo Node.js integrado que fornece um cliente e servidor HTTP.
- `https`: Você pode usar este módulo para fazer requisições HTTPS. É um módulo Node.js integrado que fornece um cliente e servidor HTTPS.

### Considerações

- O objeto `page` é a interface principal para interagir com o navegador. Esta é da classe Playwright Page. Você pode acessar o contexto do navegador via `page.context()` se necessário.
- Você pode usar `console.log` para registrar os dados no console. Isso estará disponível na seção de logs do monitor.
- Você pode retornar os dados do script usando a instrução `return`. Atribua capturas de tela ao objeto `screenshots` fornecido para que sejam preservadas mesmo se o script lançar.
- Você pode usar as variáveis `browserType` e `screenSizeType` para obter o tipo de navegador e o tipo de tamanho de tela no contexto de execução atual.
- Este é um script JavaScript, então você pode usar todos os recursos JavaScript no script.
- Você pode usar o módulo `axios` para fazer requisições HTTP no script.
- Se estiver usando o oneuptime.com, você sempre terá a versão mais recente do Playwright e navegadores disponíveis no contexto do script. Se você estiver auto-hospedando, certifique-se de atualizar os probes para ter a versão mais recente do Playwright e dos navegadores.
- O timeout para o script é de 2 minutos. Se o script levar mais de 2 minutos, será encerrado.
