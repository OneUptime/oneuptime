# Provedores de e-mail

Envie o e-mail do OneUptime pela API HTTPS de um provedor de e-mail em vez de um servidor SMTP: Amazon SES, SendGrid, Mailgun, Postmark ou Resend. Um projeto escolhe um deles para uma configuração SMTP, e uma instalação auto-hospedada pode enviar todo o seu próprio e-mail por um deles. A API é acessada por HTTPS na porta 443, então o e-mail continua saindo de redes que bloqueiam as portas SMTP, e a chave de cada provedor é guardada criptografada.

:::cards
- [Amazon SES](#amazon-ses): Uma chave de acesso do IAM e a região em que o seu remetente foi verificado.
- [SendGrid](#sendgrid): Uma chave de API com acesso Mail Send.
- [Mailgun](#mailgun): Uma chave de API, o domínio de envio e a região dele.
- [Postmark](#postmark): O token de API do servidor.
- [Resend](#resend): Uma chave de API com acesso de envio.
- [Solução de problemas](#solução-de-problemas): O que significa a recusa de cada provedor.
:::

## Escolher um provedor

:::tabs
@tab Projeto
Em **Configurações do projeto > Notificações > Configurações de notificação**, abra **Mais configurações** e clique em **Criar: SMTP Configuração** no cartão **Configurações SMTP Personalizadas**. Na etapa **Provedor**, informe um **Nome** e escolha o provedor. A etapa seguinte pede as configurações desse provedor, e a etapa **Remetente**, o **E-mail de origem** e o **Nome de origem**. Depois que a configuração é salva, **Enviar e-mail de teste** na linha dela verifica se funciona.
@tab Instância auto-hospedada
No Admin Dashboard, abra **Configurações** e depois **Notificações > E-mails**. No cartão **Configurações do servidor de e-mail**, clique em **Editar servidor** e escolha o provedor como **Tipo de servidor de e-mail**. O cartão do provedor aparece abaixo, como **Configurações Amazon SES**: clique no botão de edição dele, como **Editar Amazon SES**, e preencha as configurações do provedor e a etapa **Remetente**. Enquanto faltar algo, o cartão diz o que falta, e cada e-mail é recusado com a configuração que ainda precisa ser preenchida.
:::

| Provedor | O que informar | Para onde o OneUptime envia |
| --- | --- | --- |
| Amazon SES | ID da chave de acesso, Chave de acesso secreta, Região | `https://email.<region>.amazonaws.com` (SES API v2) |
| SendGrid | Chave de API | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | Chave de API, Domínio, Região | `https://api.mailgun.net` ou `https://api.eu.mailgun.net` |
| Postmark | Token de API do servidor | `https://api.postmarkapp.com/email` |
| Resend | Chave de API | `https://api.resend.com/emails` |

Cada e-mail é enviado com a sua parte em texto e com as suas imagens (o logotipo do OneUptime, capturas de tela) como anexos embutidos. Quando um provedor limita a velocidade de envio, ou falha do lado dele, o OneUptime tenta de novo depois da espera que o provedor pede; qualquer outra recusa fica guardada nos logs de notificação, com o que o provedor respondeu.

## Amazon SES

:::steps
### Verificar o remetente

No [console do Amazon SES](https://console.aws.amazon.com/ses/), na região de onde você vai enviar, verifique em **Identities** o endereço de onde você envia ou o domínio dele. Enquanto a sua conta estiver no sandbox do SES, verifique também cada destinatário, ou solicite acesso de produção.

### Criar uma chave de acesso

Crie um usuário do IAM para o OneUptime com uma política que permita `ses:SendEmail` na sua identidade e depois crie uma chave de acesso para ele:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:123456789012:identity/example.com"
    }
  ]
}
```

### Preencher a etapa Amazon SES

Informe o **ID da chave de acesso**, a **Chave de acesso secreta** e a **Região** em que a sua identidade foi verificada, como `us-east-1`.
:::

## SendGrid

No SendGrid, abra **Settings > API Keys**, crie uma chave com acesso **Mail Send** e verifique o endereço de onde você envia (Single Sender Verification) ou o domínio dele (Domain Authentication). Informe a chave como **Chave de API** na etapa **SendGrid**.

## Mailgun

No Mailgun, adicione e verifique o seu domínio de envio, como `mg.example.com`, e depois crie uma chave de envio para ele, ou use a chave de API da sua conta. Na etapa **Mailgun**, informe a **Chave de API** e o **Domínio**, e escolha a **Região** em que o domínio foi criado: `EU` para um domínio na região europeia do Mailgun, `US` para os demais. O **E-mail de origem** precisa ser um endereço desse domínio. Um domínio sandbox só envia para os destinatários autorizados dele.

## Postmark

No Postmark, abra o servidor que envia, depois a aba **API Tokens** dele, e copie o token de API do servidor: um token da conta não envia. Informe-o como **Token de API do servidor** na etapa **Postmark**. O **E-mail de origem** precisa ser uma assinatura de remetente confirmada, ou um endereço de um domínio verificado. Até o Postmark aprovar a sua conta, ele só envia para endereços do seu próprio domínio.

## Resend

No Resend, adicione e verifique o seu domínio em **Domains** e depois crie uma chave de API com acesso de envio em **API Keys**. Informe-a como **Chave de API** na etapa **Resend**, com um **E-mail de origem** do seu domínio verificado. O domínio de teste do próprio Resend só envia para o seu próprio endereço.

## Solução de problemas

Um e-mail de teste que não é enviado diz o motivo. Para qualquer outro e-mail, abra a aba **E-mail** de **Configurações do projeto > Notificações > Logs de notificação** e selecione **Ver mensagem de status** na linha dele.

:::details "Amazon SES needs a verified identity in …"
O **E-mail de origem**, ou o domínio dele, não está verificado na região definida na configuração, ou a conta está no sandbox do SES e o destinatário não está verificado. Verifique-o nessa região, ou solicite acesso de produção.
:::

:::details "Amazon SES does not recognize the access key" ou "did not accept the request's signature"
Confira o **ID da chave de acesso**, se a chave está ativa no IAM e se a **Chave de acesso secreta** é a que foi criada com ela. Uma assinatura também é recusada quando o relógio do servidor está errado.
:::

:::details "The access key may not send with Amazon SES"
A política do usuário do IAM não permite `ses:SendEmail` na sua identidade. Adicione a política acima.
:::

:::details "Mailgun has no domain … in its US region"
O domínio não está na região para a qual a configuração envia. Confira o **Domínio** e defina a **Região** como `EU` se o domínio foi criado lá.
:::

:::details "is not a confirmed sender signature in Postmark" ou "is not a verified domain in Resend"
Confirme o **E-mail de origem** como remetente, ou verifique o domínio dele, no painel do provedor.
:::

:::details "did not accept the API key" ou "did not accept the server API token"
Confira a chave na configuração: a do SendGrid precisa de acesso Mail Send, a chave de envio do Mailgun só funciona para o próprio domínio, o Postmark precisa do token do servidor, e a do Resend precisa de acesso de envio.
:::

## Próximos passos

:::cards
- [SMTP](/docs/emails/smtp): Enviar, em vez disso, pelo seu próprio servidor de e-mail ou pelo Microsoft 365.
- [Assinantes e comunicados](/docs/status-pages/subscribers): Enviar o e-mail aos assinantes de uma página de status por uma configuração SMTP do projeto.
:::
