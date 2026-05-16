# Configuração de SMTP

O OneUptime suporta o envio de emails via servidores SMTP personalizados com três métodos de autenticação:

- **Nome de Usuário e Senha** - Autenticação SMTP tradicional
- **OAuth 2.0** - Autenticação moderna para Microsoft 365 e Google Workspace
- **Nenhum** - Para servidores de relay que não requerem autenticação

Este guia aborda como configurar a autenticação OAuth 2.0 para Microsoft 365 e Google Workspace.

## Autenticação OAuth 2.0

O OAuth 2.0 fornece uma maneira mais segura de autenticar com servidores de email, especialmente para ambientes empresariais que desativaram a autenticação básica. O OneUptime suporta dois tipos de concessão OAuth:

- **Client Credentials** - Usado pelo Microsoft 365 e pela maioria dos provedores OAuth
- **JWT Bearer** - Usado por contas de serviço do Google Workspace

### Campos Necessários para OAuth

Ao configurar o SMTP com autenticação OAuth no OneUptime, você precisará:

| Campo | Descrição |
|-------|-------------|
| **Hostname** | Endereço do servidor SMTP |
| **Port** | Porta SMTP (tipicamente 587 para STARTTLS ou 465 para TLS implícito) |
| **Username** | O endereço de email para enviar |
| **Authentication Type** | Selecione "OAuth" |
| **OAuth Provider Type** | Selecione "Client Credentials" para Microsoft 365, ou "JWT Bearer" para Google Workspace |
| **Client ID** | ID da Aplicação/Cliente do seu provedor OAuth (para Google: email da conta de serviço) |
| **Client Secret** | Segredo do cliente do seu provedor OAuth (para Google: chave privada) |
| **Token URL** | URL do endpoint de token OAuth |
| **Scope** | Escopo(s) OAuth necessário(s) para acesso SMTP |

---

## Configuração do Microsoft 365

Para usar OAuth com Microsoft 365/Exchange Online, você precisa registrar um aplicativo no Microsoft Entra (Azure AD) e configurar as permissões apropriadas.

### Passo 1: Registrar um Aplicativo no Microsoft Entra

1. Faça login no [centro de administração do Microsoft Entra](https://entra.microsoft.com)
2. Navegue para **Identity** > **Applications** > **App registrations**
3. Clique em **New registration**
4. Insira um nome para seu aplicativo (ex.: "OneUptime SMTP")
5. Para **Supported account types**, selecione "Accounts in this organizational directory only"
6. Deixe **Redirect URI** em branco (não necessário para o fluxo de credenciais do cliente)
7. Clique em **Register**

Após o registro, anote os seguintes valores da página **Overview**:
- **Application (client) ID** - Este é o seu Client ID
- **Directory (tenant) ID** - Você precisará disso para a Token URL

### Passo 2: Criar um Segredo de Cliente

1. No registro do seu aplicativo, vá para **Certificates & secrets**
2. Clique em **New client secret**
3. Adicione uma descrição e selecione um período de expiração
4. Clique em **Add**
5. **Copie o valor do segredo imediatamente** - ele não será exibido novamente

### Passo 3: Adicionar Permissões de API SMTP

1. Vá para **API permissions**
2. Clique em **Add a permission**
3. Selecione **APIs my organization uses**
4. Pesquise e selecione **Office 365 Exchange Online**
5. Selecione **Application permissions**
6. Encontre e marque **SMTP.SendAsApp**
7. Clique em **Add permissions**
8. Clique em **Grant admin consent for [sua organização]** (requer privilégios de administrador)

### Passo 4: Registrar Principal de Serviço no Exchange Online

Antes que seu aplicativo possa enviar emails, você deve registrar o principal de serviço no Exchange Online e conceder permissões de caixa de correio.

1. Instale o módulo Exchange Online PowerShell:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Conecte-se ao Exchange Online:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. Registre o principal de serviço (use o Object ID em **Enterprise Applications**, não em App Registrations):

```powershell
# Encontre o Object ID em Microsoft Entra > Enterprise Applications > Seu Aplicativo > Object ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. Conceda ao principal de serviço permissão para enviar como uma caixa de correio específica:

```powershell
# Conceder acesso total à caixa de correio ao principal de serviço
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **Nota:** Use `Add-MailboxPermission` (não `Add-RecipientPermission`). `Add-RecipientPermission` concede apenas `SendAs` no destinatário e não é suficiente para o principal de serviço enviar email via SMTP com OAuth — você receberá um erro de autenticação/permissão no momento do envio. `Add-MailboxPermission` com `FullAccess` é o comando que realmente funciona.

### Passo 5: Configurar no OneUptime

No OneUptime, crie ou edite uma configuração SMTP com estas configurações:

| Campo | Valor |
|-------|-------|
| Hostname | `smtp.office365.com` |
| Port | `587` |
| Username | O endereço de email ao qual você concedeu permissões (ex.: `sender@yourdomain.com`) |
| Authentication Type | `OAuth` |
| OAuth Provider Type | `Client Credentials` |
| Client ID | Seu Application (client) ID do Passo 1 |
| Client Secret | O valor do segredo do Passo 2 |
| Token URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope | `https://outlook.office365.com/.default` |
| From Email | Igual ao Username |
| Secure (TLS) | Habilitado |

Substitua `<tenant-id>` pelo seu Directory (tenant) ID do Passo 1.

---

## Configuração do Google Workspace

O Google Workspace requer uma **conta de serviço** com delegação em todo o domínio para enviar emails em nome de usuários. Isso é necessário porque os servidores SMTP do Google não suportam fluxo direto de credenciais de cliente OAuth para Gmail.

### Pré-requisitos

- Conta do Google Workspace (não Gmail regular — contas Gmail do consumidor não suportam isso)
- Acesso de Super Admin ao Console de Administração do Google Workspace
- Acesso ao Google Cloud Console

### Passo 1: Criar um Projeto no Google Cloud

1. Vá para o [Google Cloud Console](https://console.cloud.google.com)
2. Clique no menu suspenso de projetos e selecione **New Project**
3. Insira um nome de projeto e clique em **Create**
4. Selecione seu novo projeto

### Passo 2: Habilitar a API do Gmail

1. Vá para **APIs & Services** > **Library**
2. Pesquise por "Gmail API"
3. Clique em **Gmail API** e depois em **Enable**

### Passo 3: Criar uma Conta de Serviço

1. Vá para **APIs & Services** > **Credentials**
2. Clique em **Create Credentials** > **Service account**
3. Insira um nome e uma descrição para a conta de serviço
4. Clique em **Create and Continue**
5. Ignore as etapas opcionais e clique em **Done**

### Passo 4: Criar Chaves de Conta de Serviço

1. Clique na conta de serviço que você acabou de criar
2. Vá para a aba **Keys**
3. Clique em **Add Key** > **Create new key**
4. Selecione **JSON** e clique em **Create**
5. Salve o arquivo JSON baixado com segurança — ele contém:
   - `client_id` - Seu Client ID
   - `private_key` - Seu Client Secret (a chave privada)

### Passo 5: Habilitar Delegação em Todo o Domínio

1. Nos detalhes da conta de serviço, clique em **Show Advanced Settings**
2. Anote o **Client ID** (ID numérico)
3. Marque **Enable Google Workspace Domain-wide Delegation**
4. Clique em **Save**

### Passo 6: Autorizar a Conta de Serviço no Admin do Google Workspace

1. Faça login no [Console de Administração do Google Workspace](https://admin.google.com)
2. Vá para **Security** > **Access and data control** > **API Controls**
3. Clique em **Manage Domain Wide Delegation**
4. Clique em **Add new**
5. Insira o **Client ID** do Passo 5
6. Para **OAuth Scopes**, insira: `https://mail.google.com/`
7. Clique em **Authorize**

Nota: Pode levar alguns minutos a 24 horas para a delegação se propagar.

### Passo 7: Configurar no OneUptime

No OneUptime, crie ou edite uma configuração SMTP com estas configurações:

| Campo | Valor |
|-------|-------|
| Hostname | `smtp.gmail.com` |
| Port | `587` |
| Username | O endereço de email do Google Workspace para enviar (ex.: `notifications@yourdomain.com`). Este usuário será representado pela conta de serviço. |
| Authentication Type | `OAuth` |
| OAuth Provider Type | `JWT Bearer` |
| Client ID | O `client_email` do seu JSON de conta de serviço (ex.: `your-service@your-project.iam.gserviceaccount.com`) |
| Client Secret | A `private_key` do seu JSON de conta de serviço (a chave inteira incluindo `-----BEGIN PRIVATE KEY-----` e `-----END PRIVATE KEY-----`) |
| Token URL | `https://oauth2.googleapis.com/token` |
| Scope | `https://mail.google.com/` |
| From Email | Igual ao Username |
| Secure (TLS) | Habilitado |

**Importante:** Para Google (JWT Bearer), o Client ID é o **email da conta de serviço** (`client_email`), NÃO o `client_id` numérico. A conta de serviço representará o usuário especificado no campo Username para enviar emails.

---

## Solução de Problemas

### Microsoft 365

| Problema | Solução |
|-------|----------|
| "Authentication unsuccessful" | Verifique se o principal de serviço está registrado no Exchange e tem permissões de caixa de correio |
| "AADSTS700016: Application not found" | Verifique se o Client ID está correto e se o aplicativo existe no seu tenant |
| "AADSTS7000215: Invalid client secret" | Regenere o segredo do cliente — ele pode ter expirado |
| "The mailbox is not enabled for this operation" | Execute `Add-MailboxPermission` para conceder acesso à caixa de correio |

### Google Workspace

| Problema | Solução |
|-------|----------|
| "invalid_grant" | Certifique-se de que a delegação em todo o domínio está corretamente configurada e propagada |
| "unauthorized_client" | Verifique se o Client ID está autorizado no Console de Administração do Google Workspace |
| "access_denied" | Verifique se o escopo `https://mail.google.com/` está autorizado |
| "Domain policy has disabled third-party Drive apps" | Habilite o acesso à API em Google Workspace Admin > Security > API Controls |

### Geral

- **Teste sua configuração**: Use o botão "Send Test Email" no OneUptime para verificar sua configuração
- **Verifique os logs**: Revise os logs do OneUptime para mensagens de erro detalhadas
- **Cache de token**: O OneUptime armazena em cache tokens OAuth e os atualiza automaticamente antes do vencimento

---

## Melhores Práticas de Segurança

1. **Rotacione segredos regularmente**: Defina lembretes no calendário para rotacionar segredos de cliente antes que expirem
2. **Use contas de serviço dedicadas**: Crie credenciais separadas para o OneUptime em vez de compartilhar com outros aplicativos
3. **Princípio de menor privilégio**: Conceda apenas as permissões mínimas necessárias (SMTP.SendAsApp para Microsoft, escopo mail.google.com para Google)
4. **Monitore o uso**: Revise logs de email e logins de aplicativos OAuth para atividade incomum
5. **Armazenamento seguro**: Nunca commit segredos de cliente para controle de versão

---

## Recursos Adicionais

### Microsoft 365
- [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace
- [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)
