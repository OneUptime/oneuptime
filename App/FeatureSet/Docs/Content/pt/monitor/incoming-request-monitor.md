# Monitor de Requisição de Entrada

O monitoramento de requisição de entrada (também conhecido como monitoramento de heartbeat) permite monitorar serviços fazendo com que eles enviem requisições HTTP periódicas para o OneUptime. Em vez do OneUptime alcançar o seu serviço, o seu serviço faz ping no OneUptime para confirmar que está em execução.

## Visão Geral

Os monitores de requisição de entrada fornecem uma URL de webhook única que seus serviços chamam periodicamente. Isso permite que você:

- Monitore trabalhos cron e tarefas programadas
- Verifique se os workers em segundo plano estão em execução
- Monitore serviços atrás de firewalls que não podem ser alcançados externamente
- Integre com ferramentas de monitoramento de terceiros
- Rastreie sinais de heartbeat de qualquer sistema capaz de HTTP

## Criando um Monitor de Requisição de Entrada

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Incoming Request** como o tipo de monitor
4. Uma **Secret Key** e URL de heartbeat serão geradas para este monitor
5. Configure seu serviço para enviar requisições para a URL de heartbeat
6. Configure os critérios de monitoramento conforme necessário

## URL de Heartbeat

Uma vez criado, seu monitor terá uma URL de heartbeat única no formato:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Seu serviço deve enviar requisições HTTP **GET** ou **POST** para esta URL em intervalos regulares.

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

Substitua `https://oneuptime.com` pela URL da sua instância do OneUptime se for auto-hospedada.

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando seu serviço é considerado online, degradado ou offline com base em:

### Tipos de Verificação Disponíveis

| Tipo de Verificação  | Descrição                                                  |
| -------------------- | ---------------------------------------------------------- |
| Incoming Request     | Se um heartbeat foi recebido dentro de uma janela de tempo |
| Request Body         | Conteúdo do corpo de requisição enviado com o heartbeat    |
| Request Header       | Nome de um cabeçalho de requisição específico              |
| Request Header Value | Valor de um cabeçalho de requisição específico             |

### Tipos de Filtro

Para **Incoming Request**:

- **Received In Minutes** — Um heartbeat foi recebido dentro do número especificado de minutos
- **Not Received In Minutes** — Nenhum heartbeat foi recebido dentro do número especificado de minutos

Para **Request Body**, **Request Header** e **Request Header Value**:

- **Contains** — O valor contém o texto especificado
- **Not Contains** — O valor não contém o texto especificado

### Critérios de Exemplo

#### Marcar como offline se nenhum heartbeat em 10 minutos

- **Check On**: Incoming Request
- **Filter Type**: Not Received In Minutes
- **Value**: 10

#### Marcar como degradado com base no conteúdo do corpo de requisição

- **Check On**: Request Body
- **Filter Type**: Contains
- **Value**: `"status": "degraded"`

## Melhores Práticas

1. **Defina a janela de tempo adequadamente** — Se seu trabalho cron é executado a cada 5 minutos, defina o limite de "Not Received In Minutes" para 10–15 minutos para permitir atrasos ocasionais
2. **Inclua dados significativos** — Envie informações de status no corpo da requisição para que você possa configurar critérios granulares
3. **Use POST para dados ricos** — Use requisições POST com corpos JSON quando precisar enviar informações detalhadas de status
4. **Monitore o monitor** — Certifique-se de que o serviço que envia heartbeats tem tratamento de erros adequado para que requisições de heartbeat com falha não passem despercebidas
