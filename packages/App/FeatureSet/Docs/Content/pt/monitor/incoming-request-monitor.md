# Monitor de Requisição de Entrada

Um Monitor de Requisição de Entrada fornece uma URL para a qual outros sistemas enviam requisições HTTP. O OneUptime avalia cada requisição segundo os seus critérios e pode alterar o status do monitor, declarar incidentes e acionar o seu plantão.

Ele cobre duas funções diferentes:

- **Monitoramento por heartbeat** — um trabalho cron, um worker ou um dispositivo chama a URL em uma programação, e o OneUptime abre um incidente quando os heartbeats deixam de chegar.
- **Recebimento de alertas de outro sistema** — Prometheus Alertmanager, Grafana ou qualquer outra coisa capaz de fazer POST de JSON envia alertas, e o OneUptime transforma cada um deles em um incidente com escalonamento de plantão e resolução automática na recuperação.

Ambas usam o mesmo tipo de monitor. O que as separa são os critérios que você configura.

## Visão Geral

Os Monitores de Requisição de Entrada fornecem uma URL única que os seus serviços chamam. Isso permite que você:

- Monitore trabalhos cron e tarefas agendadas
- Verifique se os workers em segundo plano estão rodando
- Monitore serviços atrás de firewalls que não podem ser alcançados externamente
- Receba alertas do Prometheus Alertmanager, do Grafana e de outros sistemas de alertas
- Acompanhe sinais de heartbeat de qualquer sistema com capacidade HTTP

## Criando um Monitor de Requisição de Entrada

1. Vá para **Monitores** no painel do OneUptime
2. Clique em **Criar monitor**
3. Selecione **Requisição de entrada** como tipo de monitor
4. Uma **Chave secreta** e uma URL são geradas para este monitor
5. Abra o monitor e clique em **Documentation** no menu à esquerda para copiar a URL
6. Configure o seu serviço para enviar requisições para essa URL
7. Configure os critérios de monitoramento conforme descrito abaixo

## A URL da requisição

Seu monitor tem uma URL única no formato:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Substitua `https://oneuptime.com` pela URL da sua instância do OneUptime se for auto-hospedada.

Envie requisições **GET** ou **POST** para essa URL. HEAD é aceito e tratado como GET. Outros métodos retornam 404. A chave secreta no caminho é a única credencial — nenhum cabeçalho ou token é necessário.

> **Warning:** Qualquer pessoa que conheça essa URL pode marcar o monitor como saudável, então trate-a como um segredo. Cada cabeçalho que você envia é armazenado no monitor e fica visível para qualquer pessoa que consiga lê-lo — não envie chaves de API nem tokens em cabeçalhos para este endpoint.

O OneUptime responde imediatamente com um `200` vazio e processa a requisição em uma fila. Essa resposta é escrita antes de qualquer validação, então um `200` **não** é confirmação de que a requisição foi aceita — uma chave secreta errada, um monitor excluído e um monitor desativado também retornam `200`. Verifique a linha do tempo do próprio monitor para confirmar que as requisições estão chegando.

### Enviando um corpo de requisição

Se você quiser endereçar campos dentro do corpo — `{{requestBody.status}}` no título de um incidente, um caminho JSON no agrupamento de incidentes ou um critério JavaScript Expression — envie `Content-Type: application/json`; é o formato que esta documentação assume o tempo todo. Um corpo `application/x-www-form-urlencoded` também é interpretado, mas apenas em campos planos de nível superior. Qualquer outro content type, ou nenhum, não é interpretado e toda referência a `requestBody` não resolve nada.

Corpos de até 50 MB são aceitos. Não comprima o corpo com `Content-Encoding: gzip`; ele é armazenado sem interpretação e os caminhos dentro dele não vão resolver.

### Enviando um Heartbeat

#### Usando curl

```bash
# Simple GET request
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST request with custom body
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### A partir de um trabalho cron

```bash
# Add to crontab to send heartbeat every 5 minutes
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### A partir do código do aplicativo

```javascript
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python example
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando o seu serviço é considerado online, degradado ou offline. Cada filtro de critério tem um **Filter Type** (o que observar), uma **Filter Condition** (como comparar) e um **Value**.

### Filter Types disponíveis

| Filter Type           | Verifica                                                     | Observações                                                                               |
| --------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Incoming Request      | Se uma requisição foi recebida dentro de uma janela de tempo | A única verificação que pode disparar quando nada chega                                   |
| Request Body          | O corpo da requisição                                        | Correspondência por substring. Corpos de objeto são comparados como JSON compacto         |
| Request Header        | Os nomes dos cabeçalhos da requisição                        | Correspondência exata com um nome de cabeçalho, em minúsculas                             |
| Request Header Value  | Os valores dos cabeçalhos da requisição                      | Correspondência exata com um valor de cabeçalho, em minúsculas                            |
| JavaScript Expression | Qualquer expressão sobre `requestBody` e `requestHeaders`    | A opção mais flexível — veja [Expressões JavaScript](/docs/monitor/javascript-expression) |

### Filter Conditions

Cada Filter Type oferece o seu próprio conjunto de condições.

Para **Incoming Request** (reproduzidas aqui com a grafia do painel):

- **Recieved In Minutes** — uma requisição foi recebida dentro do número de minutos indicado
- **Not Recieved In Minutes** — nenhuma requisição foi recebida dentro do número de minutos indicado

Para **Request Body**, **Request Header** e **Request Header Value**: **Contains** e **Not Contains**.

Para **JavaScript Expression**: **Evaluates To True**.

> **Note:** Nomes e valores de cabeçalho são convertidos para minúsculas antes da comparação, e a correspondência é com o nome ou valor inteiro, não com uma substring. Escreva `content-type`, não `Content-Type`, e `application/json`, não `application/JSON`. Só **Request Body** faz uma verdadeira correspondência por substring.

Corpos de objeto são comparados como JSON compacto sem espaços, então um filtro **Request Body** / **Contains** precisa ser escrito `"status":"firing"` — copiar `"status": "firing"` de um payload formatado nunca vai corresponder.

### Critérios de Exemplo

#### Marcar como offline se nenhum heartbeat em 10 minutos

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### Marcar como degradado com base no conteúdo do corpo de requisição

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** Um monitor só é reavaliado em segundo plano se pelo menos um dos seus critérios verificar **Incoming Request**. Um monitor cujos critérios só verificam Request Body, Request Header ou uma JavaScript Expression é avaliado quando uma requisição chega e em nenhum outro momento — portanto ele nunca pode ficar offline por conta própria. Se você quer um alarme de heartbeat ausente, precisa de um critério **Incoming Request**.

Note também que um monitor que nunca recebeu uma requisição é tratado como se o seu momento de criação fosse a última requisição. Um critério "Not Recieved In Minutes: 10" em um monitor recém-criado dispara 10 minutos depois de você criá-lo, mesmo que o emissor nunca tenha sido ligado.

## Recebendo alertas de outro sistema

Alertmanager, Grafana e ferramentas semelhantes fazem POST de um documento JSON descrevendo um ou mais alertas. Por padrão, um critério abre **um** incidente, então um payload com cinco alertas produziria um único incidente. O agrupamento de incidentes muda isso: ele extrai um valor do payload e abre **um incidente separado por valor distinto**, e todos podem estar abertos ao mesmo tempo.

### Ativando o agrupamento de incidentes

Abra o critério, expanda **Settings** e ative **Group incidents and alerts by a payload field**. Quatro campos aparecem:

| Campo                              | Exemplo                                  | O que faz                                                                                  |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | O caminho cujos valores distintos separam os incidentes                                    |
| Field that signals recovery        | `requestBody.alerts[*].status`           | O caminho verificado para decidir que um alerta se recuperou                               |
| Value that means recovered         | `resolved`                               | O valor exato que marca a recuperação                                                      |
| Max incidents per request          | `100` (padrão)                           | Limite de segurança para que um campo de alta cardinalidade não abra incidentes sem limite |

### Sintaxe dos caminhos

Os caminhos precisam começar com o prefixo literal `requestBody.`. Um caminho sem ele — `alerts[*].labels.alertname` — não corresponde a nada, em silêncio. O invólucro `{{ }}` é opcional: `requestBody.status` e `{{requestBody.status}}` se comportam de forma idêntica.

- `[*]` se expande sobre um array — um incidente por valor **distinto**. Dois elementos que produzam o mesmo valor se fundem em um único incidente, e o estado firing/resolved desse incidente vem do **primeiro** elemento correspondente. **Apenas o primeiro `[*]` de um caminho é um curinga**; `requestBody.groups[*].alerts[*].name` não corresponde a nada.
- `[0]` e `[last]` selecionam um único elemento, e podem vir depois de um `[*]`.
- Valores de objeto e array, strings vazias e nulos são ignorados. `0` e `false` são chaves válidas.

### A resolução é orientada a eventos

Um webhook descreve apenas o que está naquele payload, então o OneUptime nunca resolve um incidente porque a sua chave deixou de aparecer. Um incidente só é resolvido quando um payload diz explicitamente que aquela chave se recuperou. Duas coisas precisam ser verdadeiras ao mesmo tempo:

1. **Field that signals recovery** e **Value that means recovered** estão definidos e correspondem ao payload. A comparação é exata e diferencia maiúsculas de minúsculas — `Resolved` não corresponde a `resolved`.
2. O incidente do critério tem **Auto Resolve Incident** ativado, em **Advanced Options** no formulário do incidente. Sem isso, eventos de recuperação correspondentes são ignorados e os incidentes continuam abertos. (O mesmo vale para alertas e **Auto Resolve Alert**.)

**Max incidents per request** limita a extração, não apenas a criação. As chaves além do limite também ficam invisíveis para a recuperação, então em um payload com mais chaves distintas do que o limite, um alerta informando `resolved` além dele não fechará o seu incidente.

> **Warning:** Se **Field that signals recovery** contiver `[*]` mas **Open a separate incident for each…** não, nada será resolvido nunca. Use `[*]` em ambos, ou em nenhum. Um caminho de recuperação sem `[*]` é avaliado contra o payload inteiro, então um `status: resolved` no nível do payload resolve todas as chaves daquele payload — inclusive alertas cujo próprio status ainda é firing.

### Nomeando os incidentes

A chave de agrupamento é exposta aos modelos de incidentes e alertas como uma variável com o nome do **último segmento do caminho**:

| Caminho                                  | Variável          |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

O payload completo continua disponível ao lado dela, então um título de incidente `{{alertname}}` e uma descrição referenciando `{{requestBody.commonAnnotations.summary}}` funcionam ambos. Veja [Modelos dinâmicos de incidentes e alertas](/docs/monitor/incident-alert-templating).

> **Warning:** O nome da variável faz parte da identidade que o OneUptime usa para casar um evento de recuperação com um incidente aberto. Mudar o caminho de agrupamento para outro com um último segmento diferente deixa órfãos todos os incidentes que estiverem abertos sob o caminho antigo — eles não podem mais ser resolvidos automaticamente e precisam ser fechados à mão.

Note que `[*]` funciona **apenas** nos dois campos de caminho de agrupamento. Em qualquer outro lugar ele não resolve, e um marcador não resolvido é impresso **literalmente** em vez de esvaziado — um título `{{requestBody.alerts[*].labels.alertname}}` aparece com as chaves ainda nele. Um título `{{requestBody.alerts[0].annotations.summary}}` resolve, mas sempre lê o primeiro alerta do payload, não aquele para o qual este incidente foi aberto. Prefira a variável de agrupamento mais os campos compartilhados `commonAnnotations` do payload.

### Exemplo completo

Para uma configuração completa do Alertmanager, veja [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager). Para o Grafana, veja [Grafana](/docs/integrations/grafana).

## Melhores Práticas

1. **Defina a janela de tempo adequadamente** — Se o seu trabalho cron roda a cada 5 minutos, defina o limite "Not Recieved In Minutes" entre 10 e 15 minutos para tolerar atrasos ocasionais
2. **Inclua dados significativos** — Envie informações de status no corpo da requisição para poder definir critérios granulares
3. **Use POST com `Content-Type: application/json`** — tudo que lê dentro do corpo depende disso
4. **Não misture as duas funções em um mesmo monitor** — um monitor que recebe alertas orientados a eventos não tem cadência regular, então um critério "Not Recieved In Minutes" nele vai oscilar. Use um monitor separado para o interruptor de homem morto
5. **Monitore o monitor** — Garanta que o serviço que envia as requisições tenha tratamento de erros adequado, para que requisições falhas não passem despercebidas

## O que ler em seguida

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — uma configuração completa de alertas de entrada
- [Grafana](/docs/integrations/grafana) — o mesmo, para os alertas do Grafana
- [Modelos dinâmicos de incidentes e alertas](/docs/monitor/incident-alert-templating) — todas as variáveis disponíveis em títulos e descrições
- [Expressões JavaScript](/docs/monitor/javascript-expression) — sintaxe de expressões e regras de aspas
