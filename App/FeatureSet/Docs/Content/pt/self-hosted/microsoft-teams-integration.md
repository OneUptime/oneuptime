# Integração com Microsoft Teams

Para integrar o Microsoft Teams com sua instância auto-hospedada do OneUptime, você precisa configurar o Registro de Aplicativo Azure e definir as variáveis de ambiente necessárias.

## Pré-requisitos

- Conta Azure - Você pode criar uma em [https://azure.com](https://azure.com)
- Acesso à configuração do seu servidor do OneUptime

## Acesso de rede

O OneUptime usa um Azure Bot para sua integração com o Teams. Uma URL de Incoming Webhook ou Teams Workflow não substitui o endpoint de mensagens desse bot. A Microsoft exige um [endpoint HTTPS acessível publicamente para um bot auto-hospedado](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0). Um endereço IP privado, nome DNS interno ou a conexão VPN de um funcionário não dão ao Azure Bot Service acesso ao OneUptime.

| Recurso | Do OneUptime ao fornecedor | Do fornecedor ao OneUptime |
| --- | --- | --- |
| Notificações do Teams | HTTPS para APIs da Microsoft | Necessário para a integração completa do bot, incluindo a descoberta de conversas |
| Comandos do Teams, botões de cartões, eventos de instalação em chats | HTTPS | `POST /api/microsoft-bot/messages` |

Os redirecionamentos do registro do aplicativo `/api/microsoft-teams/auth` e `/api/microsoft-teams/admin-consent/callback` retornam pelo navegador do usuário. Esse navegador precisa acessar o OneUptime, por exemplo pela rede corporativa ou VPN. As mensagens do bot e ações dos cartões chegam dos servidores da Microsoft e precisam de seu próprio ingress acessível. A entrega de alertas de saída, por si só, não verifica a conectividade de entrada.

### Produção: publique um gateway para a implantação privada

1. **Escolha um nome de host**, por exemplo `oneuptime.example.com`. Publique registros DNS públicos apontando para um gateway acessível pela Internet. Os fornecedores não conseguem acessar endereços IP privados nem nomes DNS exclusivamente internos. Com DNS dividido, os funcionários podem resolver o mesmo nome de host para o ingress privado e continuar usando o painel pela VPN. O ingress privado também precisa oferecer HTTPS com um certificado válido para esse nome de host.

2. **Conecte o gateway ao OneUptime.** Coloque-o em uma DMZ com uma rota para o ingress privado ou use um gateway público conectado pela sua própria VPN de site a site ou conexão privada. Permita tráfego do gateway ao ingress na porta do serviço de destino. Para Kubernetes/Portainer, um serviço privado `ClusterIP` por si só não basta: o gateway precisa de um ingress/controlador ou outro destino acessível. Mantenha bancos de dados e outros serviços internos privados.

3. **Termine HTTPS na porta 443** com um certificado de confiança pública e uma cadeia intermediária completa. Permita TCP de entrada na porta 443 do gateway. Instalar um certificado ou alterar o DNS, por si só, não cria a rota para o destino privado.

4. Publique apenas `/api/microsoft-bot/messages` e defina essa URL HTTPS pública completa como endpoint de mensagens do Azure Bot na etapa 4. O adaptador Bot Framework do OneUptime deve receber e autenticar as solicitações. Preserve método, caminho, query string, corpo e cabeçalhos de autenticação (`Authorization`). Mantenha o `Host` público e defina cabeçalhos confiáveis `X-Forwarded-Host` e `X-Forwarded-Proto: https`. Não adicione redirecionamentos.

5. Isente essas rotas de SSO do navegador, CAPTCHA e páginas de login do proxy. Mantenha a autenticação do OneUptime ativa. Restrinja o acesso à origem ao gateway e aos clientes internos autorizados; oculte tokens nos logs.

6. **Defina a URL canônica do OneUptime**:

   Docker Compose, em `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Valores de Helm/Portainer:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Substitua o exemplo pelo seu domínio. Esses ajustes geram URLs; não criam DNS, TLS nem regras de firewall. Aplique a configuração do Compose ou a atualização do Helm e aguarde a aplicação reiniciar. Se o hostname mudar, atualize o endpoint do Azure Bot e as URIs de redirecionamento do registro do aplicativo; depois baixe e envie o manifesto do Teams novamente.

As [configurações de acesso à rede privada](/docs/self-hosted/private-network-access) controlam solicitações de saída do OneUptime para serviços internos. Ativar `ALLOW_PRIVATE_NETWORK_WEBHOOKS` não torna o OneUptime acessível ao Teams.

### Acesso de saída e restrições de IP

Permita resolução DNS e HTTPS (TCP 443) de saída da aplicação OneUptime. Teams usa `graph.microsoft.com`, `login.microsoftonline.com`, endpoints de autenticação/canais do Bot Framework e a URL do serviço conector da conversa. Use as [orientações de firewall da Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) e inspecione o tráfego bloqueado nos testes; esses exemplos não são uma lista completa de domínios. O conector de fallback da nuvem comercial é `https://smba.trafficmanager.net/teams/`; a URL de serviço de uma conversa pode ser diferente.

A Microsoft não oferece suporte a listas fixas de IPs de entrada do Bot Framework, pois os endereços mudam. Os intervalos de mídia dos clientes Teams não são as origens dos webhooks do bot. Mantenha a autenticação do Bot Framework ativa.

### Testes e implantações sem acesso de entrada

Em uma rede fora da sua VPN, verifique DNS público e TLS e depois confira a rota do Teams:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

Nas versões atuais do OneUptime, espere `405 Method Not Allowed` com `Allow: POST`. Isso confirma que a solicitação GET chegou à rota, não que uma solicitação POST autenticada do bot funcionará. Versões anteriores podem retornar o erro JSON 404 do OneUptime; inspecione o corpo da resposta e os logs do proxy. Erros de TLS, tempos limite ou uma página de erro HTML do proxy indicam problemas de certificado ou roteamento.

Conecte o Teams, envie uma notificação de teste, escreva para o bot e pressione um botão de cartão. Confirme a ação no OneUptime e compare os diagnósticos da Microsoft com os logs do gateway e da aplicação. Uma notificação entregue não verifica um POST de entrada autenticado.

Para desenvolvimento, o [guia de testes do Teams da Microsoft](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams) descreve como expor um serviço local por um túnel. Encaminhe para o ingress do OneUptime e use `/api/microsoft-bot/messages`, substituindo o caminho de exemplo da Microsoft `/api/messages`. Atualize o endpoint do Azure Bot sempre que a URL pública do túnel mudar e use ingress estável em produção. Configure também o hostname correspondente no OneUptime. Pare o túnel após os testes; ele continua expondo acesso de entrada.

Se toda conectividade de entrada for proibida, a integração completa do Teams não funciona: comandos, ações de cartões e descoberta de conversas dependem dela. Uma instalação totalmente desconectada não pode usar o Teams.

Azure Bot Private Endpoint não substitui esse ingress do Teams. As [instruções de isolamento de rede da Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) descrevem o isolamento do Direct Line e informam que desativar o acesso à rede pública remove a configuração dos canais do Teams.

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

`ChannelMessage.Send` é apenas uma permissão delegada; não há variante de permissão de aplicativo na [referência de permissões do Microsoft Graph](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend). Mantenha-a na lista de permissões delegadas acima.

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

1. Vá para **Configurações do projeto** > **Espaço de trabalho** > **Microsoft Teams**
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
