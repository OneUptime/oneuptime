# Integração de Email de Entrada com SendGrid

O **Monitor de Email de Entrada** do OneUptime permite criar e resolver alertas com base em emails enviados para endereços de email únicos específicos do monitor. Isso é útil para integração com sistemas legados, ferramentas de alerta ou qualquer serviço que possa enviar emails.

Este guia explica como configurar o SendGrid Inbound Parse para encaminhar emails de entrada para sua instância auto-hospedada do OneUptime.

## Pré-requisitos

- Uma conta SendGrid (o nível gratuito funciona)
- Um domínio que você controla com acesso às configurações de DNS
- Sua instância do OneUptime deve ser publicamente acessível (para que o SendGrid possa enviar webhooks)

## Como Funciona

1. Você cria um **Monitor de Email de Entrada** no OneUptime
2. O OneUptime gera um endereço de email único para esse monitor (ex.: `monitor-abc123@inbound.seudominio.com`)
3. Quando um email é enviado para esse endereço, o SendGrid o recebe e o encaminha para o OneUptime via webhook
4. O OneUptime avalia o email em relação aos critérios configurados para criar ou resolver alertas

## Instruções de Configuração

### Passo 1: Escolher Seu Domínio de Email de Entrada

Você precisará de um subdomínio dedicado a receber emails de entrada. Recomendamos usar um subdomínio como:

- `inbound.seudominio.com`
- `email.seudominio.com`
- `monitor.seudominio.com`

Este subdomínio será usado exclusivamente para emails de monitor do OneUptime.

### Passo 2: Configurar o Registro MX do DNS

Adicione um registro MX à sua configuração de DNS para rotear emails do seu subdomínio de entrada para o SendGrid.

| Tipo | Host/Nome | Prioridade | Valor           |
| ---- | --------- | ---------- | --------------- |
| MX   | inbound   | 10         | mx.sendgrid.net |

**Exemplo:** Se o seu domínio for `example.com` e você estiver usando `inbound.example.com`:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**Nota:** As alterações de DNS podem levar até 48 horas para se propagar, mas geralmente são concluídas em algumas horas.

### Passo 3: Verificar o Domínio no SendGrid (Opcional, mas Recomendado)

Para melhor entregabilidade e para evitar que emails sejam marcados como spam:

1. Faça login no seu [Painel do SendGrid](https://app.sendgrid.com)
2. Vá para **Settings** > **Sender Authentication**
3. Clique em **Authenticate Your Domain**
4. Siga as instruções para adicionar os registros de DNS necessários (registros CNAME para DKIM)

### Passo 4: Configurar o SendGrid Inbound Parse

1. Faça login no seu [Painel do SendGrid](https://app.sendgrid.com)
2. Navegue para **Settings** > **Inbound Parse**
3. Clique em **Add Host & URL**
4. Configure o seguinte:

| Campo                               | Valor                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------- |
| **Receiving Domain**                | Seu subdomínio de entrada (ex.: `inbound.seudominio.com`)               |
| **Destination URL**                 | `https://seu-dominio-oneuptime.com/incoming-email/sendgrid/YOUR_SECRET` |
| **Check incoming emails for spam**  | Opcional — habilite se desejar                                          |
| **Send raw, full MIME message**     | Deixe desmarcado (não necessário)                                       |
| **POST the raw, full MIME message** | Deixe desmarcado (não necessário)                                       |

5. Clique em **Add**

### Passo 5: Configurar Variáveis de Ambiente do OneUptime

#### Docker Compose

Adicione estas variáveis de ambiente ao seu arquivo `config.env`:

```bash
# Inbound Email Configuration
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.seudominio.com
# INBOUND_EMAIL_WEBHOOK_SECRET=seu-segredo-opcional  # Opcional: para segurança adicional
```

#### Kubernetes com Helm

Adicione estes ao seu arquivo `values.yaml`:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.seudominio.com"
  # webhookSecret: "seu-segredo-opcional"  # Opcional
```

**Importante:** Reinicie seu servidor do OneUptime após adicionar estas variáveis de ambiente.

### Passo 6: Criar um Monitor de Email de Entrada

1. Faça login no seu Painel do OneUptime
2. Navegue para **Monitors** > **Create Monitor**
3. Selecione **Incoming Email** como o tipo de monitor
4. Configure seu monitor:
   - **Name:** Dê ao seu monitor um nome descritivo
   - **Description:** Descreva para que serve este monitor
5. Configure **Alert Creation Criteria** (quando criar um alerta):
   - Exemplo: Email Subject contém "ALERT" ou "CRITICAL"
6. Configure **Alert Resolution Criteria** (quando resolver um alerta):
   - Exemplo: Email Subject contém "RESOLVED" ou "OK"
7. Clique em **Create**

Após a criação, você verá o endereço de email único para este monitor (ex.: `monitor-abc123def456@inbound.seudominio.com`).

### Passo 7: Testar a Integração

1. Copie o endereço de email do monitor do Painel do OneUptime
2. Envie um email de teste para esse endereço com um assunto que corresponda aos seus critérios de alerta
3. Verifique o Painel do OneUptime para verificar:
   - O email foi recebido (visível no Resumo do Monitor)
   - Um alerta foi criado (se os critérios corresponderam)

## Referência de Variáveis de Ambiente

| Variável                       | Descrição                                                                                                                                      | Obrigatório | Padrão |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| `INBOUND_EMAIL_PROVIDER`       | O provedor de email de entrada a ser usado                                                                                                     | Sim         | -      |
| `INBOUND_EMAIL_DOMAIN`         | O subdomínio configurado para emails de entrada                                                                                                | Sim         | -      |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Segredo para validar requisições de webhook. Quando definido, acrescente este segredo à URL do webhook: `/incoming-email/sendgrid/YOUR_SECRET` | Não         | -      |

## Critérios de Email Suportados

Ao configurar seu Monitor de Email de Entrada, você pode criar critérios baseados em:

| Campo              | Descrição                                   | Filtros Disponíveis                                                                        |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Email Subject**  | A linha de assunto do email                 | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **Email From**     | O endereço de email do remetente            | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **Email Body**     | O corpo em texto simples do email           | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **Email To**       | O endereço de email do destinatário         | Contains, Not Contains, Equals, Not Equals, Starts With, Ends With, Is Empty, Is Not Empty |
| **Email Received** | Tempo desde que o último email foi recebido | Received In Minutes, Not Received In Minutes                                               |

## Casos de Uso de Exemplo

### Alertas de Sistema Legado

Muitos sistemas legados só podem enviar alertas por email. Crie um Monitor de Email de Entrada para:

- Criar alertas do OneUptime quando o sistema legado envia emails com `[CRITICAL]`
- Resolver alertas quando emails com `[RESOLVED]` são recebidos

### Integração com Serviço de Terceiros

Integre com serviços que enviam notificações por email:

- Ferramentas de monitoramento sem integrações de API
- Notificações de provedores de nuvem
- Ferramentas de verificação de segurança

### Heartbeat via Email

Use critérios de "Email Received" para garantir que você receba emails periódicos:

- Criar alerta se nenhum email recebido em 60 minutos
- Útil para monitorar trabalhos em lote ou tarefas programadas que enviam emails de conclusão

## Solução de Problemas

### Emails Não Sendo Recebidos

1. **Verificar propagação de DNS:**

   ```bash
   dig MX inbound.seudominio.com
   ```

   Deve retornar `mx.sendgrid.net`

2. **Verificar as configurações do SendGrid Inbound Parse:**

   - Faça login no Painel do SendGrid
   - Vá para Settings > Inbound Parse
   - Verifique se seu domínio e URL de webhook estão corretos

3. **Verificar logs do OneUptime:**
   - Procure por requisições de webhook nos logs do serviço ProbeIngest
   - Verifique quaisquer mensagens de erro

### Webhooks Falhando

1. **Certifique-se de que o OneUptime está publicamente acessível:**

   - A URL do webhook deve ser acessível pela internet
   - Teste com: `curl -X POST https://seu-dominio-oneuptime.com/incoming-email/sendgrid`

2. **Verificar regras de firewall:**

   - Permita tráfego HTTPS de entrada dos intervalos de IP do SendGrid

3. **Verificar certificado SSL:**
   - O SendGrid requer um certificado SSL válido
   - Certificados autoassinados podem causar problemas

### Monitor Não Criando Alertas

1. **Verificar a configuração de critérios:**

   - Verifique se seus critérios de criação de alerta correspondem ao conteúdo do email
   - Teste com strings exatas primeiro antes de usar correspondência de padrões

2. **Verificar o status do monitor:**

   - Certifique-se de que o monitor não está desabilitado
   - Verifique se o tipo do monitor é "Incoming Email"

3. **Revisar o Resumo do Monitor:**
   - Verifique se o email foi recebido e processado
   - Revise os logs de avaliação para detalhes de correspondência de critérios

## Melhores Práticas de Segurança

1. **Use HTTPS:** Sempre use HTTPS para seu endpoint de webhook
2. **Segredo do Webhook:** Configure `INBOUND_EMAIL_WEBHOOK_SECRET` e inclua-o na sua URL de webhook (ex.: `/incoming-email/sendgrid/seu-segredo`) para validação adicional
3. **Verificação de Domínio:** Verifique seu domínio no SendGrid para melhor segurança de email
4. **Restrinja o Acesso:** Crie monitores apenas para fontes de email confiáveis
5. **Monitore os Logs:** Revise regularmente os logs de email de entrada para atividades suspeitas

## Provedores Alternativos

O OneUptime é projetado para suportar múltiplos provedores de email de entrada. Atualmente suportados:

| Provedor                | Status    |
| ----------------------- | --------- |
| SendGrid                | Suportado |
| Haraka (Auto-hospedado) | Planejado |

Se você precisar de suporte para um provedor diferente, entre em contato conosco ou envie uma solicitação de recurso.

## Suporte

Se você encontrar problemas com a integração de Email de Entrada do SendGrid:

1. Verifique a seção de solução de problemas acima
2. Revise os logs do OneUptime para mensagens de erro detalhadas
3. Entre em contato conosco em [hello@oneuptime.com](mailto:hello@oneuptime.com)

Recebemos feedback para melhorar esta integração!
