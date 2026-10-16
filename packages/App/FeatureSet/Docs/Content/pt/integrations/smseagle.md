# Integração com o SMSEagle

Envie notificações de alertas por SMS ou chamada através do [SMSEagle](https://www.smseagle.eu), um gateway SMS de hardware instalado no local, na sua própria rede. O OneUptime tem componentes de fluxo de trabalho do **SMSEagle** integrados, então a configuração é rápida.

Esta integração é de **saída**: o OneUptime envia as mensagens pela [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/).

```text
Alerta do OneUptime → On Create  ──►  componente SMSEagle  ──►  SMS ou chamada para um telefone
```

## Passo 1: Crie uma chave de API

1. Na GUI web do SMSEagle, vá em **Settings → API → API v2** e clique em **Create API key**.
2. Em **Permissions**, permita **Send SMS** e, se quiser chamadas, **Make a TTS Advanced Call**.
3. Copie a chave. O OneUptime a chama de **SMSEagle Access Token**.

## Passo 2: Deixe o OneUptime alcançar o dispositivo

1. Permita a conexão do seu servidor OneUptime até o endereço do dispositivo, por exemplo `https://192.168.0.100`, nos firewalls e VPNs entre os dois.
2. Um dispositivo SMSEagle costuma ter um endereço privado, que os fluxos de trabalho bloqueiam por padrão. Em uma instância auto-hospedada, adicione o endereço IP ou o nome de host do dispositivo a `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` no servidor da API, por exemplo `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, e reinicie-o. Veja [Acesso a redes privadas](/docs/self-hosted/private-network-access).

## Passo 3: Guarde os segredos

1. No OneUptime, vá em **Fluxos de trabalho → Variáveis globais → Criar**.
2. Crie `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (secreta) e `ONCALL_PHONE`.

## Passo 4: Monte o fluxo de trabalho

1. Abra **Fluxos de trabalho → Criar fluxo de trabalho**, dê o nome `Alerts → SMSEagle` e abra o **Construtor**.
2. Adicione um gatilho **Alert** definido como **On Create**. Renomeie-o para `Alert`.
3. Adicione um componente **Send SMS via SMSEagle** ligado ao gatilho:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. Clique em **Salvar**, ative o fluxo e crie um alerta de teste. O SMS chega ao telefone.

O modelo **Text a phone via SMSEagle when an alert fires** monta o mesmo fluxo de trabalho.

## Chamadas em vez de SMS

Use **Make a Call via SMSEagle** no lugar. Ele tem as mesmas configurações mais um **Voice ID**, a voz de conversão de texto em fala do dispositivo, e lê em voz alta o **Text to Read Out**. A chave de API precisa da permissão **Make a TTS Advanced Call**.

O modelo **Call a phone via SMSEagle when an alert fires** monta o mesmo fluxo de trabalho com uma chamada.

## Alternativa: o componente API

Um bloco **API** também funciona:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## Dicas

- Se o dispositivo recusar a mensagem, o motivo está no valor **Error** do componente. Registre-o na saída **Erro**.
- Use **Condições** para filtrar por gravidade antes de enviar.
- Para avisar várias pessoas, ligue vários componentes SMSEagle, um por número.

## O que ler a seguir

- [Visão geral das integrações](/docs/integrations/index): o padrão de saída.
- [Componentes → SMSEagle](/docs/workflows/components#smseagle): a referência do componente.
