# Integração com Slack

Conecte seu projeto OneUptime auto-hospedado ao Slack para enviar notificações e usar ações de incidentes, comandos e eventos de mensagens.

## Configuração

1. Configure o hostname e HTTPS do OneUptime conforme indicado abaixo. Copie o manifesto gerado em **Settings > Slack Integration**, também disponível em `https://your-oneuptime-domain.com/api/slack/app-manifest`.
2. [Crie um aplicativo Slack](https://api.slack.com/apps) no workspace usando o manifesto da sua própria instalação, para que as URLs correspondam ao hostname.
3. Copie **Client ID**, **Client Secret** e **Signing Secret** de **Basic Information** para `config.env` no Docker Compose:

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   No Helm, configure estes valores:

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. Aplique a configuração e aguarde o reinício do OneUptime. Se a verificação da URL Events falhou antes de configurar o segredo de assinatura, tente novamente.
5. Volte a **Settings > Slack Integration**, selecione **Connect to Slack** e autorize o aplicativo. Conecte também sua conta pessoal Slack no OneUptime para ações que exigem identidade do usuário.

## Acesso à rede para instalações auto-hospedadas

### Direção do tráfego e endpoints

| Tráfego | Acesso necessário |
| --- | --- |
| OneUptime → Slack | DNS e HTTPS de saída via TCP 443 para `slack.com` na Web API e troca de tokens OAuth; `hooks.slack.com` para respostas a comandos e notificações por webhooks de entrada, quando usados |
| Slack → OneUptime | HTTPS público via TCP 443 para as quatro rotas POST abaixo, para a integração completa |
| Navegador do usuário → OneUptime | Painel e redirecionamentos OAuth para `/api/slack/auth/:projectId/:userId` e `/api/slack/auth/:projectId/:userId/user`; podem continuar acessíveis pela VPN do usuário |

Esses domínios descrevem a integração OneUptime, não uma lista completa para clientes ou funcionalidades do Slack. Um webhook de *entrada* do Slack é hospedado pelo Slack: o OneUptime envia solicitações a ele; não é um endpoint de entrada no seu servidor. Consulte o [guia de webhooks de entrada](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).

Encaminhe estes callbacks do provedor à aplicação OneUptime pelo ingress:

| Método e caminho | Finalidade |
| --- | --- |
| `POST /api/slack/events` | Verificação da Events API, reações, menções e mensagens |
| `POST /api/slack/interactive` | Botões, atalhos, envios de modais, `/incident` e `/maintenance` |
| `POST /api/slack/options-load` | Solicitações de opções de menus interativos |
| `POST /api/slack/command` | Comando `/oneuptime` |

OAuth usa um [redirecionamento do navegador seguido da troca de tokens no servidor](https://docs.slack.dev/authentication/installing-with-oauth/). O manifesto registra `/api/slack/auth` como prefixo; o OneUptime acrescenta os caminhos do projeto e usuário na autorização. O acesso pelo navegador, sozinho, não permite ao Slack entregar eventos ou ações.

### Instalações privadas e segurança dos callbacks

Use DNS público e um gateway com certificado HTTPS publicamente confiável, cadeia completa e rota privada ao ingress OneUptime. Permita TCP 443 de entrada e publique somente os callbacks POST do provedor indicados acima. Um `ClusterIP` privado, DNS interno ou VPN de funcionário não oferece acesso ao provedor. DNS dividido permite manter painel e rotas OAuth do navegador privados sob o mesmo hostname.

Defina `HOST=oneuptime.example.com` e `HTTP_PROTOCOL=https` em `config.env`, ou `host: oneuptime.example.com` e `httpProtocol: https` no Helm. Aplique a configuração e aguarde o reinício. Esses valores geram URLs; não provisionam DNS, TLS ou regras de firewall. Gere novamente e atualize o manifesto Slack quando o hostname mudar.

Preserve método, caminho, parâmetros, corpo original, `Content-Type`, `X-Slack-Signature` e `X-Slack-Request-Timestamp`. Preserve host público e HTTPS usando cabeçalhos de proxy confiáveis. Isente callbacks de SSO do navegador, CAPTCHA e páginas de login do proxy, mantendo as verificações de assinatura e timestamp do OneUptime. Sincronize o relógio do servidor. Verificar IP de origem não substitui a [verificação de assinaturas Slack](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

### Verificar o acesso e compreender as limitações

Verifique Events Request URL em **Event Subscriptions**: o Slack envia um [desafio POST e verifica TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/). Envie uma notificação de teste, execute um comando slash, pressione um botão de incidente e gere um evento ao qual o aplicativo esteja subscrito. Verifique logs do gateway e OneUptime sem registrar segredos. O Slack exige confirmações rápidas, incluindo [respostas em três segundos para interações](https://docs.slack.dev/interactivity/handling-user-interaction/). Um GET do navegador ou mensagem de saída bem-sucedida não verifica os callbacks POST.

Sem conexões de entrada, um aplicativo já autorizado ainda pode enviar mensagens por HTTPS de saída, mas eventos, botões, atalhos e comandos não funcionam. O manifesto OneUptime usa callbacks HTTP e desativa Socket Mode; ativar esse modo Slack não é uma alternativa compatível. A [configuração de acesso à rede privada](/docs/self-hosted/private-network-access) controla solicitações de saída para destinos privados e não publica callbacks.
