# Integração com Microsoft Teams

Para integrar o Microsoft Teams com sua instância auto-hospedada do OneUptime, você precisa configurar o Registro de Aplicativo Azure e definir as variáveis de ambiente necessárias.

## Pré-requisitos

- Conta Azure - Você pode criar uma em [https://azure.com](https://azure.com)
- Acesso à configuração do seu servidor do OneUptime

## Instruções de Configuração

### Passo 1: Criar Registro de Aplicativo Azure

1. Vá para o [Portal Azure](https://portal.azure.com)
2. Navegue para "App registrations" e clique em "New registration"
3. Preencha o formulário de registro:
   - **Name:** oneuptime
   - **Supported account types:** Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)
   - **Redirect URI:** Web - `https://seu-dominio-oneuptime.com/api/microsoft-teams/auth`
   - Adicione também: `https://seu-dominio-oneuptime.com/api/microsoft-teams/admin-consent/callback`
4. Clique em "Register"
5. Anote o "Application (client) ID" — você precisará disso mais tarde

### Passo 2: Configurar Permissões do Aplicativo

1. No registro do seu aplicativo, vá para "API permissions"
2. Clique em "Add a permission" e selecione "Microsoft Graph"

**Adicionar Permissões Delegadas** (ao agir em nome de um usuário conectado):
   - **User.Read** - Necessário para obter as informações do perfil do usuário autenticado (nome de exibição, email) durante o fluxo OAuth
   - **Team.ReadBasic.All** - Necessário para listar equipes das quais o usuário é membro ao selecionar qual equipe conectar
   - **Channel.ReadBasic.All** - Necessário para ler informações de canal e listar canais dentro das equipes para entrega de notificações
   - **ChannelMessage.Send** - Necessário para enviar notificações de alerta e incidente para canais do Teams

**Adicionar Permissões de Aplicativo** (ao agir como o aplicativo em si, sem um usuário conectado):
   - **Team.ReadBasic.All** - Necessário para listar todas as equipes na organização após o consentimento do administrador ser concedido
   - **Channel.ReadBasic.All** - Necessário para verificar a existência do canal e recuperar detalhes do canal
   - **ChannelMessage.Send** - Necessário para enviar mensagens para canais programaticamente

**Nota:** O Bot Framework lida com a entrega de mensagens usando permissões de Consentimento Específico de Recurso (RSC) definidas no manifesto do aplicativo Teams. Essas permissões são:
   - **ChannelMessage.Send.Group** - Permite que o bot envie mensagens para canais de equipe
   - **ChannelMessage.Read.Group** - Permite que o bot leia mensagens de canal para comandos interativos
   - **Channel.Create.Group** - Permite que o bot crie canais quando necessário

3. Clique em "Grant admin consent" para sua organização

### Passo 3: Criar Segredo do Cliente

1. Vá para "Certificates & secrets" no registro do seu aplicativo
2. Clique em "New client secret"
3. Adicione uma descrição e defina a expiração (recomenda-se 24 meses)
4. Clique em "Add" e copie o valor do segredo imediatamente — você não poderá vê-lo novamente

**Importante:** Não copie o ID do segredo; você precisa do VALOR do segredo, que normalmente é mais longo e inclui mais caracteres.

### Passo 4: Criar um Serviço de Bot

1. No Portal Azure, navegue para "Azure Bot" e clique em "Create"
2. Preencha o formulário de criação do bot:
   - **Bot handle:** oneuptime-bot
   - **Subscription:** Sua assinatura Azure
   - **Resource group:** Crie um novo ou use um existente
   - **Location:** Escolha uma localização próxima aos seus usuários
   - **Pricing tier:** F0 (Gratuito) é suficiente para testes
   - Use o App (client) ID e Tenant ID do registro de aplicativo criado anteriormente

3. Clique em "Review + create" e depois em "Create"

4. Após a implantação, vá para seu recurso de bot e navegue para "Configuration"
5. Defina o "Messaging endpoint" como `https://seu-dominio-oneuptime.com/api/microsoft-bot/messages`
6. Salve a configuração

### Passo 5: Adicionar Canal Microsoft Teams ao Bot

1. No seu recurso Azure Bot, navegue para "Channels"
2. Encontre e selecione "Microsoft Teams" e clique em "Open" ou "Add"
3. Revise as configurações (habilite para Teams, mantenha as opções de mensagem padrão, a menos que tenha necessidades específicas)
4. Clique em "Save" (e "Done"/"Publish" se solicitado) para habilitar o canal Teams

### Passo 6: Configurar Variáveis de Ambiente do OneUptime

#### Docker Compose

Se você estiver usando Docker Compose, adicione estas variáveis de ambiente à sua configuração:

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes com Helm

Se você estiver usando Kubernetes com Helm, adicione estes ao seu arquivo `values.yaml`:

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
   tenantId: YOUR_MICROSOFT_TENANT_ID
```

**Importante:** Reinicie seu servidor do OneUptime após adicionar estas variáveis de ambiente para que elas tenham efeito.

### Passo 7: Fazer Upload do Manifesto do Aplicativo Teams

1. Vá para **Settings** > **Integrations** > **Microsoft Teams** do projeto
2. Baixe o manifesto do aplicativo Teams de lá
3. Vá para o Microsoft Teams, clique em "Apps" na barra lateral
4. Na parte inferior, clique em "Manage your apps"
5. Clique em "Upload a custom app"
6. Selecione "Upload for me or my teams"
7. Faça upload do arquivo zip do manifesto que você baixou anteriormente

## Solução de Problemas

Se você encontrar problemas:

- Certifique-se de que seu aplicativo tem as permissões corretas concedidas
- Verifique se o URI de redirecionamento corresponde exatamente (substitua `seu-dominio-oneuptime.com` pelo seu domínio real)
- Verifique se suas variáveis de ambiente estão definidas corretamente
- Certifique-se de que o endpoint de mensagens do bot está acessível pela internet
- Verifique se o bot está corretamente configurado com o canal Teams
- Verifique se o manifesto do aplicativo Teams foi carregado com sucesso

## Suporte

Gostaríamos de melhorar esta integração, portanto o feedback é mais do que bem-vindo. Por favor, envie qualquer feedback para [hello@oneuptime.com](mailto:hello@oneuptime.com)
