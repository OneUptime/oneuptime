# Provedores de e-mail

Envie o e-mail do OneUptime pela API HTTPS de um provedor de e-mail em vez de um servidor SMTP: Amazon SES, SendGrid, Mailgun, Postmark ou Resend. Um projeto escolhe um deles para uma configuração SMTP, e uma instalação auto-hospedada pode enviar todo o seu próprio e-mail por um deles. A API é acessada por HTTPS na porta 443, então o e-mail continua saindo de redes que bloqueiam as portas SMTP, e a chave de cada provedor é guardada criptografada.

:::cards
- [Amazon SES](#amazon-ses): Uma chave de acesso do IAM, ou a própria função do IAM do servidor, e a região em que o seu remetente foi verificado.
- [SendGrid](#sendgrid): Uma chave de API com acesso Mail Send.
- [Mailgun](#mailgun): Uma chave de API, o domínio de envio e a região dele.
- [Postmark](#postmark): O token de API do servidor.
- [Resend](#resend): Uma chave de API com acesso de envio.
- [Variáveis de ambiente](#definir-o-e-mail-do-servidor-com-variáveis-de-ambiente): Defina o e-mail de um servidor auto-hospedado pelos values do Helm ou pelo `config.env`.
- [Solução de problemas](#solução-de-problemas): O que significa a recusa de cada provedor.
:::

## Escolher um provedor

:::tabs
@tab Projeto
Em **Configurações do projeto > Notificações > Canais de notificação**, abra **Mais configurações** e clique em **Criar: Configuração SMTP** no cartão **Configurações SMTP Personalizadas**. Na etapa **Provedor**, informe um **Nome** e escolha o provedor. A etapa seguinte pede as configurações desse provedor, e a etapa **Remetente**, o **E-mail de origem** e o **Nome de origem**. Depois que a configuração é salva, **Enviar e-mail de teste** na linha dela verifica se funciona.
@tab Instância auto-hospedada
No Admin Dashboard, abra **Configurações** e depois **Notificações > E-mails**. No cartão **Configurações do servidor de e-mail**, clique em **Editar servidor** e escolha o provedor como **Tipo de servidor de e-mail**. O cartão do provedor aparece abaixo, como **Configurações Amazon SES**: clique no botão de edição dele, como **Editar Amazon SES**, e preencha as configurações do provedor e a etapa **Remetente**. Enquanto faltar algo, o cartão diz o que falta, e cada e-mail é recusado com a configuração que ainda precisa ser preenchida. Um servidor implantado a partir de código pode defini-las com variáveis de ambiente: veja [Definir o e-mail do servidor com variáveis de ambiente](#definir-o-e-mail-do-servidor-com-variáveis-de-ambiente).
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

Uma instalação auto-hospedada na AWS pode dispensar a chave e [entrar com a função do IAM do servidor](#entrar-com-a-função-do-iam-do-servidor), com a mesma política.

### Preencher a etapa Amazon SES

Informe o **ID da chave de acesso**, a **Chave de acesso secreta** e a **Região** em que a sua identidade foi verificada, como `us-east-1`.
:::

### Entrar com a função do IAM do servidor

Uma instalação auto-hospedada na AWS pode enviar os próprios e-mails como a função do IAM que a AWS dá ao servidor, sem nenhuma chave de acesso armazenada no OneUptime: as credenciais que a AWS fornece expiram em poucas horas, e o OneUptime obtém novas antes disso. Isso vale só para os e-mails do próprio servidor. A configuração do Amazon SES de um projeto sempre entra com uma chave de acesso, porque a função do servidor é a identidade da AWS do próprio servidor, não a de um projeto.

Dê à função a política acima e depois execute o OneUptime com ela:

:::tabs
@tab Amazon EKS
Com funções do IAM para contas de serviço, crie a função com uma política de confiança para o provedor OIDC do seu cluster e faça o chart do Helm criar uma conta de serviço com o ARN da função. Os pods app e worker do OneUptime são executados com ela:

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

Com o EKS Pod Identity, crie em vez disso uma associação do Pod Identity entre a função e essa conta de serviço, e deixe a anotação de fora.
@tab Amazon ECS
Defina a função como a **Task role** da definição de tarefa do OneUptime.
@tab Amazon EC2
Anexe a função à instância como o perfil de instância dela. Com o OneUptime no Docker na instância, aumente o limite de saltos dos metadados da instância para 2, para que os contêineres possam alcançá-los:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

Depois, no Admin Dashboard, clique em **Editar Amazon SES**, escolha **Função do IAM deste servidor** como **Tipo de autenticação** e informe a **Região**. Ao salvar, qualquer chave de acesso armazenada antes é removida.

O OneUptime procura as credenciais do servidor onde os SDKs da AWS procuram, nesta ordem: `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` no seu ambiente, um token de identidade web (`AWS_ROLE_ARN` e `AWS_WEB_IDENTITY_TOKEN_FILE`), o endpoint de credenciais de contêiner do Amazon ECS e do EKS Pod Identity e, por fim, o serviço de metadados de instância do EC2 (IMDSv2).

## SendGrid

No SendGrid, abra **Settings > API Keys**, crie uma chave com acesso **Mail Send** e verifique o endereço de onde você envia (Single Sender Verification) ou o domínio dele (Domain Authentication). Informe a chave como **Chave de API** na etapa **SendGrid**.

## Mailgun

No Mailgun, adicione e verifique o seu domínio de envio, como `mg.example.com`, e depois crie uma chave de envio para ele, ou use a chave de API da sua conta. Na etapa **Mailgun**, informe a **Chave de API** e o **Domínio**, e escolha a **Região** em que o domínio foi criado: `EU` para um domínio na região europeia do Mailgun, `US` para os demais. O **E-mail de origem** precisa ser um endereço desse domínio. Um domínio sandbox só envia para os destinatários autorizados dele.

## Postmark

No Postmark, abra o servidor que envia, depois a aba **API Tokens** dele, e copie o token de API do servidor: um token da conta não envia. Informe-o como **Token de API do servidor** na etapa **Postmark**. O **E-mail de origem** precisa ser uma assinatura de remetente confirmada, ou um endereço de um domínio verificado. Até o Postmark aprovar a sua conta, ele só envia para endereços do seu próprio domínio.

## Resend

No Resend, adicione e verifique o seu domínio em **Domains** e depois crie uma chave de API com acesso de envio em **API Keys**. Informe-a como **Chave de API** na etapa **Resend**, com um **E-mail de origem** do seu domínio verificado. O domínio de teste do próprio Resend só envia para o seu próprio endereço.

## Definir o e-mail do servidor com variáveis de ambiente

Um servidor auto-hospedado implantado a partir de código pode subir já enviando e-mails, sem nada para configurar à mão: defina as configurações de e-mail com variáveis de ambiente, pelo Terraform ou pelo que implanta o OneUptime. Assim que `GLOBAL_EMAIL_SERVER_TYPE` está definida, o servidor envia os próprios e-mails como as variáveis descrevem. As configurações salvas no Admin Dashboard em **Configurações** e depois **Notificações > E-mails** não são usadas, e essa página mostra estas em modo somente leitura, cada campo com a variável que o define. Deixe `GLOBAL_EMAIL_SERVER_TYPE` vazia para configurar o e-mail no Admin Dashboard. As configurações SMTP dos projetos não mudam.

| Variável | Valor do Helm | O que contém |
| --- | --- | --- |
| `GLOBAL_EMAIL_SERVER_TYPE` | `email.serverType` | `custom-smtp`, `sendgrid`, `amazon-ses`, `mailgun`, `postmark` ou `resend`. Só quando ela está definida o OneUptime lê as outras variáveis |
| `GLOBAL_EMAIL_FROM_EMAIL` | `email.fromEmail` | O endereço de onde sai cada e-mail |
| `GLOBAL_EMAIL_FROM_NAME` | `email.fromName` | O nome com que sai cada e-mail. Obrigatório para `custom-smtp` e `sendgrid` |
| `GLOBAL_EMAIL_SMTP_TRANSPORT` | `email.smtp.transport` | `smtp` (também quando vazia), ou `microsoft-graph` para enviar pelo Microsoft Graph com o aplicativo OAuth |
| `GLOBAL_EMAIL_SMTP_HOST` | `email.smtp.host` | O servidor de e-mail, como `smtp.example.com` |
| `GLOBAL_EMAIL_SMTP_PORT` | `email.smtp.port` | A porta dele, como `587` |
| `GLOBAL_EMAIL_SMTP_REQUIRE_TLS` | `email.smtp.requireTls` | `true` para enviar só por uma conexão criptografada com um certificado válido, ou `false` (também quando vazia) |
| `GLOBAL_EMAIL_SMTP_AUTH_TYPE` | `email.smtp.authType` | `username-and-password` (também quando vazia), `oauth` ou `none` |
| `GLOBAL_EMAIL_SMTP_USERNAME` | `email.smtp.username` | A caixa de correio com que entrar, também para `oauth`. Deixe-a vazia junto com a senha para enviar sem entrar |
| `GLOBAL_EMAIL_SMTP_PASSWORD` | `email.smtp.password`, ou um Secret indicado em `email.existingSecret.name` | A senha dela |
| `GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE` | `email.smtp.oauth.providerType` | `client-credentials` (também quando vazia) ou `jwt-bearer` |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID` | `email.smtp.oauth.clientId` | O ID do cliente do aplicativo OAuth |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET` | `email.smtp.oauth.clientSecret`, ou um Secret indicado em `email.existingSecret.name` | O segredo do cliente dele; para `jwt-bearer`, a chave privada dele no formato PEM |
| `GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL` | `email.smtp.oauth.tokenUrl` | A URL do token dele |
| `GLOBAL_EMAIL_SMTP_OAUTH_SCOPE` | `email.smtp.oauth.scope` | O scope dele |
| `GLOBAL_EMAIL_SENDGRID_API_KEY` | `email.sendgrid.apiKey`, ou um Secret indicado em `email.existingSecret.name` | A chave de API do SendGrid |
| `GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE` | `email.amazonSes.authenticationType` | `access-key` (também quando vazia), ou `server-iam-role` para entrar com a função do IAM do servidor |
| `GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID` | `email.amazonSes.accessKeyId` | O ID da chave de acesso |
| `GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY` | `email.amazonSes.secretAccessKey`, ou um Secret indicado em `email.existingSecret.name` | A chave de acesso secreta dela |
| `GLOBAL_EMAIL_AMAZON_SES_REGION` | `email.amazonSes.region` | A região em que o seu remetente foi verificado, como `us-east-1` |
| `GLOBAL_EMAIL_MAILGUN_API_KEY` | `email.mailgun.apiKey`, ou um Secret indicado em `email.existingSecret.name` | A chave de API do Mailgun |
| `GLOBAL_EMAIL_MAILGUN_DOMAIN` | `email.mailgun.domain` | O domínio de envio, como `mg.example.com` |
| `GLOBAL_EMAIL_MAILGUN_REGION` | `email.mailgun.region` | `us` (também quando vazia) ou `eu` |
| `GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN` | `email.postmark.serverToken`, ou um Secret indicado em `email.existingSecret.name` | O token de API do servidor do Postmark |
| `GLOBAL_EMAIL_RESEND_API_KEY` | `email.resend.apiKey`, ou um Secret indicado em `email.existingSecret.name` | A chave de API do Resend |

Só são usadas as variáveis que o tipo de servidor lê: as `GLOBAL_EMAIL_SMTP_` para `custom-smtp`, e as próprias de um provedor para esse provedor. O log do servidor e o Admin Dashboard indicam qualquer outra que esteja definida, como não usada.

Com o Helm, defina-as em `email` nos seus values. Para manter a senha ou a chave fora dos values que o Helm salva a cada release, coloque-a em um Secret seu e indique esse Secret em `email.existingSecret.name`. O chart a lê da chave indicada em `email.existingSecret.key` ou, se não houver, da chave com o nome dela: `smtpPassword`, `smtpOAuthClientSecret`, `sendgridApiKey`, `amazonSesSecretAccessKey`, `mailgunApiKey`, `postmarkServerToken` ou `resendApiKey`.

```bash
kubectl create secret generic oneuptime-email --namespace oneuptime \
  --from-literal=smtpPassword=YOUR_SMTP_PASSWORD
```

```yaml
email:
  serverType: custom-smtp
  fromEmail: alerts@example.com
  fromName: OneUptime
  smtp:
    host: smtp.example.com
    port: 587
    requireTls: true
    username: alerts@example.com
  existingSecret:
    name: oneuptime-email
```

O chart recusa outros valores de `email` sem `email.serverType`, configurações sem a senha ou a chave que elas leem, uma senha ou chave informada tanto nos values quanto em um Secret, e um Secret do qual as configurações não leem nada. Com o Terraform, defina os mesmos valores em um `helm_release`, com a senha ou a chave como valor sensível.

Com o Docker Compose, defina as configurações `GLOBAL_EMAIL_` no `config.env` e depois execute `npm run start` para recriar os contêineres.

O OneUptime lê as variáveis ao iniciar. Se alguma estiver errada, como uma porta que não é um número ou uma senha ausente, o servidor não envia e-mails até que isso seja corrigido; o log do servidor, as configurações de e-mail do Admin Dashboard e a lista de verificação em `/admin/setup` indicam a variável. Senhas e chaves nunca são exibidas. Para mudar as configurações, altere as variáveis e reinicie o OneUptime: o Admin Dashboard não as altera.

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

:::details "This server has no AWS credentials"
O servidor entra com a sua função do IAM, mas a AWS não lhe dá credenciais. Execute-o com a função, como mostra [Entrar com a função do IAM do servidor](#entrar-com-a-função-do-iam-do-servidor), e depois reinicie os pods ou tarefas do OneUptime: um pod recebe as configurações da sua função quando inicia. No Docker no Amazon EC2, a mensagem também diz quando o limite de saltos dos metadados da instância está baixo demais.
:::

:::details "This server's IAM role may not send with Amazon SES" ou "did not let this server assume the role"
A política da função não permite `ses:SendEmail` na sua identidade: adicione a política acima. Ou, no Amazon EKS, a política de confiança da função não permite `sts:AssumeRoleWithWebIdentity` para o provedor OIDC do seu cluster e a conta de serviço do OneUptime.
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
