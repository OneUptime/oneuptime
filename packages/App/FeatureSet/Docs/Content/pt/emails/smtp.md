# SMTP

Envie o e-mail do OneUptime pelo seu próprio servidor de e-mail. Um projeto adiciona configurações SMTP com as quais suas páginas de status enviam e-mails, e uma instalação auto-hospedada define o servidor pelo qual o próprio OneUptime envia todo o resto. Os dois aceitam três formas de login:

- **Nome de usuário e senha**: a autenticação SMTP tradicional.
- **OAuth 2.0**: para Microsoft 365 e Google Workspace, onde a autenticação básica costuma estar desligada.
- **Nenhum**: para servidores de retransmissão que não exigem autenticação.

```mermaid title="Qual servidor de e-mail envia o quê"
flowchart TB
    SP["E-mail de uma página de status"] --> Q{"Configuração SMTP personalizada<br/>escolhida para a página?"}
    Q -->|"Sim"| P["A configuração SMTP<br/>do projeto"]
    Q -->|"Não"| D["O servidor de e-mail<br/>do OneUptime"]
    E["Todos os outros e-mails<br/>do OneUptime"] --> D
```

Numa instalação auto-hospedada, o servidor de e-mail do OneUptime é o definido no Admin Dashboard. Uma página de status escolhe sua configuração SMTP na página **Configurações de assinantes**, no cartão **SMTP Personalizado**.

:::cards
- [Adicionar um servidor de e-mail](#adicionar-um-servidor-smtp): Duas etapas, com todo o resto recolhido.
- [Microsoft 365](#configuração-do-microsoft-365): OAuth com um registro de aplicativo no Entra.
- [Google Workspace](#configuração-do-google-workspace): OAuth com uma conta de serviço.
- [Solução de problemas](#solução-de-problemas): Erros comuns e o que significam.
:::

## Adicionar um servidor SMTP

Adicione o servidor de e-mail de um projeto em **Configurações do projeto > Notificações > Configurações de notificação**, no cartão **Configurações SMTP Personalizadas**. Numa instalação auto-hospedada, o servidor pelo qual o próprio OneUptime envia é definido em **Admin Dashboard > Configurações > Notificações > E-mails**, no cartão **Configurações personalizadas de e-mail e SMTP**. Os dois formulários pedem as mesmas coisas, em duas etapas.

:::steps
### Abrir o formulário

:::tabs
@tab Projeto
Em **Configurações do projeto > Notificações > Configurações de notificação**, clique em **Criar: SMTP Configuração** no cartão **Configurações SMTP Personalizadas**.
@tab Instância auto-hospedada
No Admin Dashboard, abra **Configurações** e depois **Notificações > E-mails** no menu lateral (**Notificações** começa recolhido). No cartão **Configurações do servidor de e-mail**, clique em **Editar servidor** e defina **Tipo de servidor de e-mail** como `Custom SMTP`. Depois clique em **Editar config SMTP** no cartão **Configurações personalizadas de e-mail e SMTP**, que aparece abaixo.
:::

### Preencher a etapa Servidor

Na etapa **Servidor**, informe o **Nome** (só em configurações de projeto), o **Nome do host**, a **Porta** (uma configuração de projeto nova começa em `587`), o **Nome de usuário** e a **Senha**.

### Conferir Mais campos

Todo o resto fica recolhido em **Mais campos**, no fim da etapa **Servidor**. Enquanto está recolhido, o cabeçalho diz como o e-mail é enviado, por exemplo "O e-mail é enviado por SMTP, com login por nome de usuário e senha. O TLS é obrigatório." Abra só se precisar mudar uma das configurações da tabela abaixo.

### Preencher a etapa Remetente

Na etapa **Remetente**, informe o **E-mail de origem** e o **Nome de origem** de onde seus e-mails vêm. Seu servidor precisa permitir o envio a partir desse endereço.

### Salvar e enviar um e-mail de teste

Salve a configuração. Depois que uma configuração de projeto é salva, **Enviar e-mail de teste** na linha dela verifica se funciona. É preciso ter permissão para adicionar configurações SMTP: **Project Owner**, **Project Admin**, ou **Create SMTP Config** e **Read SMTP Config** numa função personalizada. No OneUptime Cloud também é preciso o plano **Growth**, como para adicionar uma configuração. Para qualquer outra pessoa o botão fica bloqueado, e a dica dele diz o que falta.

O teste pede um endereço de **E-mail** para onde enviar, o seu de início. Confira se a mensagem chega.
:::

Estas são as configurações em **Mais campos**:

| Campo | O que faz |
| --- | --- |
| **Transporte** | `SMTP` (o padrão), ou `Microsoft Graph` para um locatário do Microsoft 365 com o SMTP AUTH desligado. Escolher Microsoft Graph oculta o nome do host, a porta, o nome de usuário e a senha, e mostra os campos de OAuth. |
| **Exigir TLS** | Ligado numa configuração de projeto nova. O e-mail é enviado apenas por uma conexão criptografada com um certificado válido. Quando esta opção está desativada, o e-mail só é criptografado se o servidor oferecer, e o certificado não é verificado. A porta 465 é sempre criptografada. |
| **Tipo de autenticação** | `Username and Password` (o padrão), `OAuth`, ou `None` para um relay que não exige login. |
| **Campos de OAuth** | **Tipo de provedor OAuth**, **OAuth Client ID**, **OAuth Client Secret**, **URL do token OAuth** e **Escopo OAuth**, mostrados quando OAuth ou Microsoft Graph é escolhido. |
| **Descrição** | Uma nota para a sua equipe (só em configurações de projeto). |

**Microsoft Graph.** Abra **Mais campos**, defina **Transporte** como `Microsoft Graph` e preencha os dados de um aplicativo do Azure que tenha a permissão de aplicativo **Mail.Send**: o client ID e o client secret dele, a URL do token `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` e o escopo `https://graph.microsoft.com/.default`. O e-mail sai da caixa de correio do **E-mail de origem**, que precisa ser uma caixa licenciada no seu locatário.

> [!NOTE]
> No OneUptime Cloud, o servidor de e-mail de um projeto precisa ser acessível pela internet: um host que resolve para um endereço privado ou interno é recusado. Numa instalação auto-hospedada, endereços privados são permitidos, a menos que `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` seja `true`; endereços de loopback e link-local são sempre recusados. O servidor de e-mail da própria instância não é verificado dessa forma.

## Autenticação OAuth 2.0

O OAuth 2.0 permite que o OneUptime faça login no seu servidor de e-mail sem senha, algo que os serviços de e-mail corporativos exigem cada vez mais. O OneUptime aceita dois tipos de concessão OAuth:

- **Client Credentials**: usado pelo Microsoft 365 e pela maioria dos provedores OAuth.
- **JWT Bearer**: usado pelas contas de serviço do Google Workspace.

```mermaid title="Como o OneUptime faz login com OAuth"
sequenceDiagram
    participant O as OneUptime
    participant T as URL do token
    participant M as Servidor de e-mail
    O->>T: Pede um token de acesso
    T-->>O: Token de acesso
    Note over O: Guardado em cache e renovado<br/>antes de expirar
    O->>M: Faz login com o token
    O->>M: Envia o e-mail
```

**Tipo de autenticação** e os campos de OAuth ficam em **Mais campos**, na etapa Servidor do formulário. Para fazer login com OAuth, preencha:

| Campo | Descrição |
| --- | --- |
| **Nome do host** | Endereço do servidor SMTP |
| **Porta** | Porta SMTP (normalmente 587 para STARTTLS ou 465 para TLS implícito) |
| **Nome de usuário** | O endereço de e-mail da caixa de correio que envia |
| **Tipo de autenticação** | `OAuth` |
| **Tipo de provedor OAuth** | `Client Credentials` para o Microsoft 365, ou `JWT Bearer` para o Google Workspace |
| **OAuth Client ID** | O ID do aplicativo (cliente) do seu provedor OAuth (no Google: o e-mail da conta de serviço) |
| **OAuth Client Secret** | O client secret do seu provedor OAuth (no Google: a chave privada) |
| **URL do token OAuth** | O endpoint de tokens OAuth do seu provedor |
| **Escopo OAuth** | O escopo OAuth que concede acesso SMTP |

O OneUptime guarda os tokens OAuth em cache e os renova automaticamente antes de expirarem.

## Configuração do Microsoft 365

Para usar OAuth com o Microsoft 365 (Exchange Online), registre um aplicativo no Microsoft Entra, dê a ele permissão para enviar e-mail por SMTP e permita que ele use a caixa de correio de onde você envia.

:::steps
### Registrar um aplicativo no Microsoft Entra

1. Entre no [centro de administração do Microsoft Entra](https://entra.microsoft.com).
2. Vá em **Identity** > **Applications** > **App registrations** e clique em **New registration**.
3. Digite um nome (por exemplo, "OneUptime SMTP"), selecione "Accounts in this organizational directory only" e deixe **Redirect URI** em branco.
4. Clique em **Register**.

Na página **Overview**, anote o **Application (client) ID** (seu client ID) e o **Directory (tenant) ID** (para a URL do token).

### Criar um client secret

1. No registro do aplicativo, vá em **Certificates & secrets** e clique em **New client secret**.
2. Adicione uma descrição, escolha um prazo de expiração e clique em **Add**.
3. **Copie o valor do secret imediatamente**: ele não é mostrado de novo.

### Adicionar a permissão SMTP

1. Vá em **API permissions** e clique em **Add a permission**.
2. Selecione **APIs my organization uses**, depois procure e selecione **Office 365 Exchange Online**.
3. Selecione **Application permissions**, marque **SMTP.SendAsApp** e clique em **Add permissions**.
4. Clique em **Grant admin consent for [your organization]** (isso exige privilégios de administrador).

### Registrar a entidade de serviço no Exchange Online

Antes que o aplicativo possa enviar e-mail, registre a entidade de serviço dele no Exchange Online e dê a ela acesso à caixa de correio de onde você envia:

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> Use `Add-MailboxPermission`, não `Add-RecipientPermission`. `Add-RecipientPermission` concede apenas `SendAs` sobre o destinatário, o que não basta para a entidade de serviço enviar e-mail por SMTP com OAuth: o envio falha com um erro de autenticação ou de permissão.

### Criar a configuração SMTP no OneUptime

Crie ou edite uma configuração SMTP com estas configurações, trocando `<tenant-id>` pelo seu **Directory (tenant) ID**:

| Campo | Valor |
| --- | --- |
| Nome do host | `smtp.office365.com` |
| Porta | `587` |
| Nome de usuário | O endereço de e-mail ao qual você concedeu as permissões (por ex., `sender@yourdomain.com`) |
| Tipo de autenticação | `OAuth` |
| Tipo de provedor OAuth | `Client Credentials` |
| OAuth Client ID | Seu **Application (client) ID** |
| OAuth Client Secret | O valor do client secret |
| URL do token OAuth | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Escopo OAuth | `https://outlook.office365.com/.default` |
| E-mail de origem | O mesmo do nome de usuário |
| Exigir TLS | Ligado |

Depois use **Enviar e-mail de teste** para verificar.
:::

## Configuração do Google Workspace

O Google Workspace precisa de uma **conta de serviço** com delegação em todo o domínio, que envia e-mail em nome de um usuário do seu domínio. Os servidores SMTP do Google não aceitam um fluxo simples de client credentials para o Gmail.

### Antes de começar com o Google Workspace

- Uma conta do Google Workspace. Contas pessoais do Gmail não aceitam isso.
- Acesso de superadministrador ao console de administração do Google Workspace.
- Acesso ao Google Cloud Console.

:::steps
### Criar um projeto no Google Cloud

1. Acesse o [Google Cloud Console](https://console.cloud.google.com).
2. Clique no seletor de projetos e escolha **New Project**.
3. Digite um nome para o projeto, clique em **Create** e selecione o projeto novo.

### Ativar a API do Gmail

1. Vá em **APIs & Services** > **Library**.
2. Procure "Gmail API", clique em **Gmail API** e depois em **Enable**.

### Criar uma conta de serviço

1. Vá em **APIs & Services** > **Credentials**.
2. Clique em **Create Credentials** > **Service account**.
3. Digite um nome e uma descrição, clique em **Create and Continue**, pule as etapas opcionais e clique em **Done**.

### Criar uma chave da conta de serviço

1. Clique na conta de serviço que você acabou de criar e vá na aba **Keys**.
2. Clique em **Add Key** > **Create new key**, selecione **JSON** e clique em **Create**.
3. Guarde o arquivo JSON baixado em local seguro. O `client_email` dele é o seu client ID OAuth, e a `private_key`, o seu client secret OAuth.

### Ativar a delegação em todo o domínio

1. Nos detalhes da conta de serviço, clique em **Show Advanced Settings**.
2. Anote o **Client ID** numérico.
3. Marque **Enable Google Workspace Domain-wide Delegation** e clique em **Save**.

### Autorizar a conta de serviço na administração do Google Workspace

1. Entre no [console de administração do Google Workspace](https://admin.google.com).
2. Vá em **Security** > **Access and data control** > **API Controls** e clique em **Manage Domain Wide Delegation**.
3. Clique em **Add new**, informe o **Client ID** numérico da etapa anterior e, em **OAuth Scopes**, digite `https://mail.google.com/`.
4. Clique em **Authorize**.

A delegação pode levar de alguns minutos até 24 horas para valer.

### Criar a configuração SMTP para o Google Workspace

Crie ou edite uma configuração SMTP com estas configurações:

| Campo | Valor |
| --- | --- |
| Nome do host | `smtp.gmail.com` |
| Porta | `587` |
| Nome de usuário | O endereço de e-mail do Google Workspace de onde enviar (por ex., `notifications@yourdomain.com`). A conta de serviço age em nome desse usuário. |
| Tipo de autenticação | `OAuth` |
| Tipo de provedor OAuth | `JWT Bearer` |
| OAuth Client ID | O `client_email` do JSON da sua conta de serviço (por ex., `your-service@your-project.iam.gserviceaccount.com`) |
| OAuth Client Secret | A `private_key` do JSON da sua conta de serviço (a chave inteira, incluindo `-----BEGIN PRIVATE KEY-----` e `-----END PRIVATE KEY-----`) |
| URL do token OAuth | `https://oauth2.googleapis.com/token` |
| Escopo OAuth | `https://mail.google.com/` |
| E-mail de origem | O mesmo do nome de usuário |
| Exigir TLS | Ligado |

Depois use **Enviar e-mail de teste** para verificar.
:::

> [!IMPORTANT]
> No Google (JWT Bearer), o **OAuth Client ID** é o **e-mail da conta de serviço** (`client_email`), não o `client_id` numérico. A conta de serviço age em nome do usuário informado em **Nome de usuário** para enviar e-mail.

## Solução de problemas

### Erros do Microsoft 365

| Problema | Solução |
| --- | --- |
| "Authentication unsuccessful" | Verifique se a entidade de serviço está registrada no Exchange e tem permissões na caixa de correio |
| "AADSTS700016: Application not found" | Confira se o client ID está correto e se o aplicativo existe no seu locatário |
| "AADSTS7000215: Invalid client secret" | Crie um client secret novo: o antigo pode ter expirado |
| "The mailbox is not enabled for this operation" | Execute `Add-MailboxPermission` para conceder acesso à caixa de correio |

### Erros do Google Workspace

| Problema | Solução |
| --- | --- |
| "invalid_grant" | Garanta que a delegação em todo o domínio está configurada corretamente e já se propagou |
| "unauthorized_client" | Verifique se o client ID está autorizado no console de administração do Google Workspace |
| "access_denied" | Confira se o escopo `https://mail.google.com/` está autorizado |
| "Domain policy has disabled third-party Drive apps" | Ative o acesso às APIs na administração do Google Workspace, em Security > API Controls |

### Outros problemas

:::details "Cannot send email. Please check your SMTP config."
**Enviar e-mail de teste** mostra isto quando um servidor em que se faz login com nome de usuário e senha, ou sem login, não aceita o e-mail. Confira o **Nome do host**, a **Porta**, o **Nome de usuário** e a **Senha**. Se o seu servidor não oferece TLS, ou o certificado dele não é válido para o nome do host, desligue **Exigir TLS** em **Mais campos** e tente de novo. A resposta do próprio servidor fica guardada com o teste: abra a aba **E-mail** de **Configurações do projeto > Notificações > Logs de notificação** e selecione **Ver mensagem de status** na linha dele.
:::

:::details "Cannot send email with OAuth authentication"
O login com OAuth falhou, e a mensagem termina com o erro devolvido pelo seu provedor. Confira o **OAuth Client ID**, o **OAuth Client Secret**, a **URL do token OAuth** e o **Escopo OAuth**, se o aplicativo tem as permissões acima e se o consentimento do administrador foi concedido. Se o seu locatário do Microsoft 365 tem o SMTP AUTH desligado, defina **Transporte** como `Microsoft Graph`.
:::

:::details "Microsoft Graph send failed"
Uma configuração cujo **Transporte** é `Microsoft Graph` mostra isto quando o Graph não aceita o e-mail, seguido do erro da própria Microsoft. Confira se o aplicativo tem a permissão de aplicativo **Mail.Send** com o consentimento do administrador concedido, se o **Escopo OAuth** é `https://graph.microsoft.com/.default` e se o **E-mail de origem** é uma caixa de correio licenciada no seu locatário.
:::

:::details "SMTP server host … could not be reached"
O OneUptime se recusou a conectar ao servidor de e-mail do projeto. No OneUptime Cloud, um nome de host que não resolve, ou que resolve para um endereço privado, de loopback ou link-local, é recusado com esta mensagem, que nunca diz qual foi o caso: use o nome de host público do servidor de e-mail. Numa instalação auto-hospedada, e para um servidor de e-mail informado pelo endereço IP, a mensagem diz o motivo. **Enviar e-mail de teste** só a mostra numa configuração OAuth; nas outras, encontre-a com **Ver mensagem de status** na aba **E-mail** dos logs de notificação.
:::

:::details O e-mail de teste não chega
Confira o **E-mail de origem**: o seu servidor precisa permitir o envio a partir dele. Depois olhe a pasta de spam do destinatário e os logs do seu servidor de e-mail em busca da tentativa.
:::

## Boas práticas de segurança

- **Troque os secrets com regularidade.** Crie lembretes para substituir os client secrets antes de expirarem.
- **Use credenciais dedicadas.** Crie credenciais próprias para o OneUptime em vez de compartilhá-las com outros aplicativos.
- **Conceda o menor privilégio.** Conceda só o que o envio precisa: **SMTP.SendAsApp** na Microsoft, o escopo `https://mail.google.com/` no Google.
- **Monitore o uso.** Revise os logs de e-mail e os logins dos aplicativos OAuth em busca de atividade incomum.
- **Guarde os secrets com segurança.** Nunca faça commit de client secrets no controle de versão.

## Leitura adicional

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## Próximos passos

:::cards
- [Resumo de notificações](/docs/emails/notification-rollup): Como o OneUptime agrupa rajadas de e-mails para os proprietários.
- [Assinantes e comunicados](/docs/status-pages/subscribers): Enviar o e-mail aos assinantes de uma página de status por uma configuração SMTP do projeto.
:::
