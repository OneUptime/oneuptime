# Monitor de Código Personalizado

O Monitor de Código Personalizado permite escrever scripts personalizados para monitorar seus aplicativos. Você pode usar esse recurso para monitorar seus aplicativos de uma forma que não é possível com os monitores existentes. Por exemplo, você pode ter requisições de API em múltiplas etapas.

#### Exemplo

O exemplo a seguir mostra como usar um Monitor de Código Personalizado:

```javascript
// You can use axios module.

await axios.get('https://api.example.com/');

// Axios Documentation here: https://axios-http.com/docs/intro

return {
    data: 'Hello World' // return any data you like here. 
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

- `name` (string, obrigatório): O nome da métrica (ex.: `"api.response.time"`). Será armazenado com o prefixo `custom.monitor.` automaticamente.
- `value` (number, obrigatório): O valor numérico da métrica.
- `attributes` (object, opcional): Pares chave-valor para contexto adicional.

#### Exemplo

```javascript
const response = await axios.get('https://api.example.com/health');

// Capture a simple metric
oneuptime.captureMetric('api.response.time', response.data.latency);

// Capture a metric with attributes
oneuptime.captureMetric('api.queue.depth', response.data.queueDepth, {
    region: 'us-east-1',
    environment: 'production'
});

return {
    data: response.data
};
```

Uma vez capturadas, essas métricas aparecem no Explorador de Métricas com nomes como `custom.monitor.api.response.time`. Você pode adicioná-las a gráficos do painel, configurar alertas e filtrar por monitor, probe ou quaisquer atributos personalizados fornecidos.

**Limites:**
- Máximo de 100 métricas por execução de script.
- Os nomes de métricas são limitados a 200 caracteres.
- Os valores devem ser numéricos.

### Módulos disponíveis no script
- `axios`: Você pode usar este módulo para fazer requisições HTTP. É um cliente HTTP baseado em promessas para o navegador e Node.js.
- `crypto`: Você pode usar este módulo para realizar operações criptográficas. É um módulo Node.js integrado que fornece funcionalidade criptográfica que inclui um conjunto de wrappers para as funções de hash, HMAC, cifra, decifra, assinatura e verificação do OpenSSL.
- `console.log`: Você pode usar este módulo para registrar dados no console. Isso é útil para fins de depuração.
- `oneuptime.captureMetric`: Você pode usar isso para capturar métricas personalizadas do seu script. Consulte a seção Métricas Personalizadas acima.
- `http`: Você pode usar este módulo para fazer requisições HTTP. É um módulo Node.js integrado que fornece um cliente e servidor HTTP.
- `https`: Você pode usar este módulo para fazer requisições HTTPS. É um módulo Node.js integrado que fornece um cliente e servidor HTTPS.

### Considerações

- Você pode usar `console.log` para registrar os dados no console. Isso estará disponível na seção de logs do monitor (Probes > View Logs).
- Você pode retornar os dados do script usando a instrução `return`.
- Este é um script JavaScript, então você pode usar todos os recursos JavaScript no script.
- O timeout para o script é de 2 minutos. Se o script levar mais de 2 minutos, será encerrado.
