# Integração com GitHub

Para integrar o GitHub com sua instância auto-hospedada do OneUptime, você precisa criar um GitHub App e configurar as variáveis de ambiente necessárias. Isso permite que o OneUptime se conecte aos seus repositórios GitHub para gerenciamento de repositórios de código.

## Pré-requisitos

- Conta GitHub com acesso de administrador da organização (para repositórios de organização) ou acesso à conta pessoal
- Acesso à configuração do seu servidor do OneUptime

## Instruções de Configuração

### Passo 1: Criar um GitHub App

1. Vá para o GitHub e navegue para as configurações da sua organização ou conta pessoal:
   - **Para Organizações:** Vá para `https://github.com/organizations/YOUR_ORG/settings/apps`
   - **Para Conta Pessoal:** Vá para `https://github.com/settings/apps`

2. Clique em **"New GitHub App"**

3. Preencha o formulário de registro:
   - **GitHub App name:** OneUptime (ou qualquer nome único) - **Salve este nome, você precisará dele para a variável de ambiente `GITHUB_APP_NAME`**
   - **Homepage URL:** `https://seu-dominio-oneuptime.com`
   - **Callback URL:** `https://seu-dominio-oneuptime.com/api/github/auth/callback`
   - **Setup URL:** `https://seu-dominio-oneuptime.com/api/github/auth/callback` - **Importante: Esta URL é para onde o GitHub redireciona os usuários após instalarem o aplicativo. Ela deve ser definida para que o redirecionamento funcione.**
   - **Redirect on update:** Marque esta opção para redirecionar usuários após atualizar a instalação do aplicativo
   - **Webhook URL:** `https://seu-dominio-oneuptime.com/api/github/webhook`
   - **Webhook secret:** Gere uma string aleatória segura (salve para uso posterior)

### Passo 2: Configurar Permissões do Aplicativo

Na seção "Permissions & events", configure as seguintes permissões:

**Permissões de Repositório:**

| Permissão | Nível de Acesso | Finalidade |
|------------|--------------|---------|
| Contents | Leitura e Escrita | Ler arquivos de repositório, enviar branches (necessário para AI Agent) |
| Pull requests | Leitura e Escrita | Criar e gerenciar pull requests |
| Issues | Leitura e Escrita | Ler e comentar em issues |
| Commit statuses | Leitura | Verificar status de build/CI |
| Actions | Leitura | Ler execuções e logs de workflow do GitHub Actions |
| Metadata | Leitura | Metadados básicos do repositório (obrigatório) |

**Permissões de Organização (se usar com organizações):**

| Permissão | Nível de Acesso | Finalidade |
|------------|--------------|---------|
| Members | Leitura | Listar membros da organização |

**Permissões de Conta:**

| Permissão | Nível de Acesso | Finalidade |
|------------|--------------|---------|
| Email addresses | Leitura | Ler email do usuário para notificações |

### Passo 3: Subscrever a Eventos de Webhook

Eventos para o OneUptime receber atualizações em tempo real, subscreva a estes eventos de webhook:

- **Pull request** - Receber notificações quando PRs são abertos, fechados ou mesclados
- **Push** - Receber notificações quando o código é enviado
- **Workflow run** - Receber atualizações de status CI/CD

### Passo 4: Definir Acesso de Instalação

Em "Where can this GitHub App be installed?", escolha:
- **Only on this account** - Para uso privado/interno
- **Any account** - Se você quiser que outros instalem seu aplicativo

### Passo 5: Criar o GitHub App

1. Clique em **"Create GitHub App"**
2. Você será redirecionado para a página de configurações do seu aplicativo
3. Anote os seguintes valores:
   - **App ID** - Encontrado no topo da página de configurações do aplicativo
   - **Client ID** - Encontrado na seção "About"

### Passo 6: Gerar Segredo do Cliente

1. Nas configurações do seu GitHub App, role até "Client secrets"
2. Clique em **"Generate a new client secret"**
3. Copie o segredo imediatamente — você não poderá vê-lo novamente

### Passo 7: Gerar Chave Privada

1. Role para baixo até a seção "Private keys"
2. Clique em **"Generate a private key"**
3. Um arquivo `.pem` será baixado automaticamente
4. Mantenha este arquivo seguro — ele é usado para autenticar como o GitHub App

### Passo 8: Configurar Variáveis de Ambiente do OneUptime

#### Docker Compose

Se você estiver usando Docker Compose, adicione estas variáveis de ambiente ao seu arquivo `config.env`:

```bash
# GitHub App Configuration
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # The exact name of your GitHub App (e.g., "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**Nota:** Para a chave privada, codifique-a em base64 e cole sem novas linhas se o seu ambiente não suportar strings de múltiplas linhas.

#### Kubernetes com Helm

Se você estiver usando Kubernetes com Helm, adicione estes ao seu arquivo `values.yaml`:

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME"  # The exact name of your GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**Importante:** Reinicie seu servidor do OneUptime após adicionar estas variáveis de ambiente para que elas tenham efeito.

### Passo 9: Instalar o GitHub App

1. Vá para a página pública do seu GitHub App: `https://github.com/apps/YOUR_APP_NAME`
2. Clique em **"Install"** ou **"Configure"**
3. Selecione a organização ou conta onde deseja instalar o aplicativo
4. Escolha quais repositórios o aplicativo pode acessar:
   - **All repositories** - Acesso a todos os repositórios atuais e futuros
   - **Only select repositories** - Escolha repositórios específicos
5. Clique em **"Install"**

### Passo 10: Conectar Repositórios no OneUptime

1. Faça login no seu painel do OneUptime
2. Navegue para **More** > **Code Repositories**
3. Clique em **"Create Repository"** ou use o fluxo de instalação do GitHub App
4. Se redirecionado do GitHub, o ID de instalação será capturado automaticamente
5. Selecione os repositórios que deseja conectar da lista
6. Clique em **"Connect"** para vincular o repositório ao seu projeto do OneUptime

## Referência de Variáveis de Ambiente

| Variável | Descrição | Obrigatório |
|----------|-------------|----------|
| `GITHUB_APP_ID` | O App ID das configurações do seu GitHub App | Sim |
| `GITHUB_APP_NAME` | O nome exato do seu GitHub App (usado para URLs de instalação) | Sim |
| `GITHUB_APP_CLIENT_ID` | O Client ID das configurações do seu GitHub App | Sim |
| `GITHUB_APP_CLIENT_SECRET` | O segredo do cliente que você gerou | Sim |
| `GITHUB_APP_PRIVATE_KEY` | O conteúdo da chave privada (arquivo .pem) | Sim |
| `GITHUB_APP_WEBHOOK_SECRET` | O segredo do webhook para verificar payloads de webhook | Não (mas recomendado) |

## Solução de Problemas

### Problemas Comuns

**Não redirecionado de volta ao OneUptime após instalar o GitHub App:**
- Certifique-se de que a **Setup URL** está configurada nas configurações do seu GitHub App para: `https://seu-dominio-oneuptime.com/api/github/auth/callback`
- Vá para as configurações do seu GitHub App > seção "Post installation" e verifique se a Setup URL está definida corretamente
- A opção "Redirect on update" também deve ser marcada
- Nota: A Setup URL é diferente da Callback URL — ambas devem apontar para o mesmo endpoint `/api/github/auth/callback`

**Erro "GitHub App is not configured":**
- Certifique-se de que a variável de ambiente `GITHUB_APP_CLIENT_ID` está definida
- Reinicie seu servidor do OneUptime após definir variáveis de ambiente

**Erro "Invalid webhook signature":**
- Verifique se o seu `GITHUB_APP_WEBHOOK_SECRET` corresponde ao segredo configurado no GitHub
- Certifique-se de que a URL do webhook está correta e acessível pela internet

**Erro "Failed to get installation access token":**
- Verifique se o seu `GITHUB_APP_PRIVATE_KEY` está corretamente formatado
- Verifique se a chave privada inclui os marcadores BEGIN/END
- Certifique-se de que o App ID está correto

**Não consigo ver repositórios após a instalação:**
- Verifique se o GitHub App tem acesso aos repositórios que você deseja conectar
- Verifique as permissões de instalação no GitHub (Settings > Applications > Installed GitHub Apps)

**Eventos de webhook não estão sendo recebidos:**
- Certifique-se de que sua URL de webhook está acessível publicamente
- Verifique os logs de entrega de webhook do GitHub App nas configurações do seu aplicativo
- Verifique se o segredo do webhook está configurado corretamente

### Verificando Entregas de Webhook

1. Vá para as configurações do seu GitHub App
2. Clique em "Advanced" na barra lateral
3. Visualize "Recent Deliveries" para ver as tentativas de webhook e respostas

## Melhores Práticas de Segurança

1. **Rotacione segredos regularmente** - Gere novos segredos de cliente e chaves privadas periodicamente
2. **Use segredos de webhook** - Sempre configure um segredo de webhook para verificar a autenticidade do payload
3. **Limite o acesso ao repositório** - Conceda acesso apenas aos repositórios que precisam ser conectados
4. **Monitore as entregas de webhook** - Verifique regularmente as entregas com falha ou atividades suspeitas
5. **Mantenha as chaves privadas seguras** - Nunca commit chaves privadas para controle de versão

## Suporte

Se você encontrar problemas com a integração do GitHub, por favor:

1. Verifique a seção de solução de problemas acima
2. Revise os logs do OneUptime para mensagens de erro detalhadas
3. Entre em contato conosco em [hello@oneuptime.com](mailto:hello@oneuptime.com)

Recebemos feedback para melhorar esta integração!
