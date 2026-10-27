# Gateway de SMS e chamadas

O OneUptime pode enviar seus SMS e chamadas por um gateway que você mesmo mantém, em vez do Twilio. Use-o quando as suas regras exigirem que cada mensagem passe pelo seu próprio provedor de SMS e voz, ou por um sistema que a verifique antes que ela saia da sua rede. O OneUptime envia cada SMS e cada chamada ao seu gateway como uma solicitação JSON assinada, e o seu gateway a entrega.

:::cards
- [Configurar o gateway](#configurar-o-gateway): Uma URL e um segredo de assinatura criado para você.
- [O que o seu gateway recebe](#o-que-o-seu-gateway-recebe): Uma solicitação JSON assinada por SMS ou chamada.
- [Agir sobre um acionamento](#agir-sobre-um-acionamento): Confirmar, escalonar ou resolver a partir de uma chamada ou de uma resposta.
- [Entrega e novas tentativas](#entrega-e-novas-tentativas): O que acontece quando o seu gateway está fora do ar.
:::

## Como funciona

```mermaid title="Um SMS pelo seu próprio gateway"
flowchart LR
    OneUptime["OneUptime"]
    Gateway["Seu gateway"]
    Provider["Seu provedor de SMS e voz"]
    Phone["Telefone"]
    OneUptime -->|"solicitação JSON assinada"| Gateway
    Gateway --> Provider
    Provider --> Phone
```

O gateway toma o lugar da conta do Twilio do próprio servidor em tudo o que passaria por ela: acionamentos de plantão, notificações, códigos de verificação e SMS para assinantes de páginas de status. Os projetos que adicionam uma configuração do Twilio própria, no cartão **Configuração do Twilio** em **Configurações do projeto > Notificações > Configurações de notificação**, continuam enviando por essa configuração. Os interruptores de SMS e de chamadas de cada projeto, e o saldo dele onde a cobrança está ativada, são verificados como no Twilio.

## Configurar o gateway

:::steps
1. No Admin Dashboard, vá para **Configurações > Chamadas e SMS** e clique em **Edit Provider** no cartão **SMS and Call Provider**.
2. Escolha **Your own gateway** e informe a **Gateway URL**. O gateway pode ficar na sua rede privada.
3. Salve. O OneUptime cria um segredo de assinatura para você. Copie-o do cartão para o seu gateway.
4. Clique em **Send Test**. O seu gateway deve responder com um status 2xx e não enviar nada.
:::

Para substituir o segredo, apague **Signing Secret** em **Mais campos** e salve: o OneUptime cria um novo. Para voltar ao Twilio, escolha **Twilio** e salve.

## O que o seu gateway recebe

Cada SMS e cada chamada é uma solicitação `POST` com um corpo JSON e estes cabeçalhos:

| Cabeçalho | Valor |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-OneUptime-Event` | `sms`, `call` ou `test` |
| `X-OneUptime-Signature` | `sha256=` seguido do HMAC-SHA256 do corpo em hexadecimal, calculado com o segredo de assinatura como chave |
| `User-Agent` | `OneUptime-CallAndSmsGateway/1.0` |

```json title="An on-call page by SMS"
{
  "version": 1,
  "event": "sms",
  "id": "7c5b0d0e-3e5f-4d1a-9a4f-2b8e6c1d9f00",
  "sentAt": "2026-10-27T09:30:00.000Z",
  "to": "+15551234567",
  "message": "OneUptime: A new alert has been created. Alert #42: Database is down…",
  "isSensitive": false,
  "project": {
    "id": "0f6b8c3a-1d2e-4f5a-8b9c-0d1e2f3a4b5c",
    "name": "Production"
  },
  "actions": {
    "acknowledge": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/acknowledge?token=…",
    "escalate": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/escalate?token=…",
    "resolve": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/resolve?token=…"
  }
}
```

| Campo | O que é |
| --- | --- |
| `version` | Sempre `1` para este formato. Campos só são acrescentados a ele. |
| `event` | `sms`, `call` ou `test`, como em `X-OneUptime-Event`. |
| `id` | Único para esta mensagem, e o mesmo em cada tentativa de entregá-la: use-o para ignorar uma mensagem que você já enviou. |
| `sentAt` | Quando o OneUptime a enviou, em ISO 8601. |
| `to` | O número de telefone, no formato E.164. `null` em um teste. |
| `message` | O SMS, ou o que a chamada diz. Um SMS tem no máximo 1.600 caracteres, e o texto de uma chamada no máximo 16.384. Um texto mais longo é cortado e termina com uma nota de que o restante está no OneUptime. |
| `isSensitive` | `true` para um código de verificação. Mantenha a mensagem fora dos seus próprios logs. |
| `project` | O `id` e o `name` do projeto, ou `null` quando nenhum projeto a enviou. |
| `actions` | Para um acionamento de plantão, os links que agem sobre ele. `null` nos outros casos. |

Uma chamada é descrita, não roteirizada: `message` é o que ela diz, sem o "pressione 1 para confirmar" do Twilio. Ofereça as ações do seu jeito, como teclas pressionadas, e chame o link correspondente.

### Verificar a assinatura

Calcule o HMAC do corpo bruto da solicitação, antes de interpretá-lo, e compare-o com o cabeçalho. A verificação é a mesma de um [canal personalizado](/docs/self-hosted/custom-notification-channels#verificar-a-assinatura), então um só verificador serve para os dois:

```javascript title="Node.js"
const crypto = require("crypto");

function isFromOneUptime(rawBody, signatureHeader, secret) {
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = String(signatureHeader || "");

  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  );
}
```

## Agir sobre um acionamento

Quando a pessoa responde durante uma chamada ou com uma resposta, o seu gateway envia uma solicitação `POST` ao link correspondente em `actions`. Os links funcionam como os de um canal personalizado: não precisam de chave de API, cada um leva um token só para aquele acionamento, válido por 7 dias, e a ação fica registrada como feita pela pessoa acionada. Veja [Agir sobre um acionamento](/docs/self-hosted/custom-notification-channels#agir-sobre-um-acionamento) para cada ação e a resposta.

```bash title="Acknowledge a page"
curl -X POST "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/acknowledge?token=…"
```

## Entrega e novas tentativas

Uma solicitação conta como entregue quando o seu gateway responde com um status 2xx em até 10 segundos. Uma solicitação à qual ele não respondeu, ou à qual respondeu com 408, 429 ou um status 5xx, é enviada de novo depois de 1 segundo e depois de mais 4 segundos: três tentativas no total. Com qualquer outro status 4xx, ela não é enviada de novo.

O registro de SMS ou de chamadas, e para um acionamento de plantão o registro de plantão da pessoa, diz `Sent to the SMS and call gateway (HTTP 200).` ou por que a mensagem não foi entregue, nunca a URL. O OneUptime não fica sabendo se a mensagem chegou ao telefone, então um SMS aparece como enviado assim que o seu gateway o aceita, e o número de onde ele saiu fica em branco.

## Solicitações de teste

**Send test** envia uma solicitação com `event` definido como `test`, e `to`, `project` e `actions` definidos como `null`. Responda com um status 2xx e não envie nada.

## Próximos passos

:::cards
- [Canais de notificação personalizados](/docs/self-hosted/custom-notification-channels): Acionar pessoas pelo seu próprio app.
- [Notificações push](/docs/self-hosted/push-notifications): Desativar o push para o servidor inteiro.
- [Integração do Twilio](/docs/self-hosted/twilio-integration): Enviar pelo Twilio em vez disso.
- [Acesso à rede privada](/docs/self-hosted/private-network-access): O que o seu servidor pode alcançar na sua própria rede.
:::
