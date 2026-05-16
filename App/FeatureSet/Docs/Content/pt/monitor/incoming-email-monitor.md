# Monitor de Email de Entrada

O Monitor de Email de Entrada permite criar e resolver alertas com base em emails enviados para endereços de email únicos específicos do monitor. Isso é útil para integração com sistemas legados, ferramentas de alerta de terceiros ou qualquer serviço que possa enviar notificações por email.

## Como Funciona

1. Quando você cria um Monitor de Email de Entrada, o OneUptime gera um endereço de email único para esse monitor
2. Qualquer email enviado para esse endereço é recebido e avaliado em relação aos critérios configurados
3. Com base nos critérios, o OneUptime pode criar novos alertas ou resolver os existentes

Esta é uma forma poderosa de integrar sistemas de alerta baseados em email com o fluxo de trabalho de gerenciamento de incidentes do OneUptime.

## Criando um Monitor de Email de Entrada

1. Navegue para **Monitors** no seu Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Incoming Email** como o tipo de monitor
4. Configure as definições do monitor:
   - **Name:** Um nome descritivo para o seu monitor
   - **Description:** Para que serve este monitor
5. Configure seus **Alert Creation Criteria** (condições que criam alertas)
6. Configure seus **Alert Resolution Criteria** (condições que resolvem alertas)
7. Clique em **Create**

Após a criação, você verá o endereço de email único para este monitor exibido na página de detalhes do monitor.

## Formato do Endereço de Email

Cada Monitor de Email de Entrada recebe um endereço de email único no formato:

```
monitor-{secret-key}@{inbound-domain}
```

Por exemplo: `monitor-abc123def456@inbound.yourdomain.com`

Você pode copiar este endereço da página de detalhes do monitor e configurar seus sistemas externos para enviar emails para ele.

## Campos de Critérios Disponíveis

Você pode criar critérios com base nos seguintes campos de email:

| Campo | Descrição |
|-------|-------------|
| **Email Subject** | A linha de assunto do email de entrada |
| **Email From** | O endereço de email do remetente |
| **Email Body** | O conteúdo em texto simples do corpo do email |
| **Email To** | O endereço de email do destinatário |
| **Email Received** | Critérios baseados em tempo para quando os emails são recebidos |

## Tipos de Filtro Disponíveis

### Filtros de String (Subject, From, Body, To)

| Filtro | Descrição | Exemplo |
|--------|-------------|---------|
| **Contains** | O campo contém o texto especificado | Subject contains "CRITICAL" |
| **Not Contains** | O campo não contém o texto especificado | Subject not contains "TEST" |
| **Equals** | O campo corresponde exatamente ao texto especificado | From equals "alerts@service.com" |
| **Not Equals** | O campo não corresponde ao texto especificado | Subject not equals "OK" |
| **Starts With** | O campo começa com o texto especificado | Subject starts with "[ALERT]" |
| **Ends With** | O campo termina com o texto especificado | Subject ends with "- Production" |
| **Is Empty** | O campo está vazio ou em branco | Body is empty |
| **Is Not Empty** | O campo tem conteúdo | Subject is not empty |

### Filtros Baseados em Tempo (Email Received)

| Filtro | Descrição | Exemplo |
|--------|-------------|---------|
| **Received In Minutes** | O email foi recebido dentro de X minutos | Email received in 30 minutes |
| **Not Received In Minutes** | Nenhum email recebido em X minutos | Email not received in 60 minutes |

## Configurações de Exemplo

### Exemplo 1: Criar Alerta em Emails Críticos

**Alert Creation Criteria:**
- Email Subject **Contains** "CRITICAL"
- OR Email Subject **Contains** "ALERT"
- OR Email Subject **Contains** "ERROR"

**Alert Resolution Criteria:**
- Email Subject **Contains** "RESOLVED"
- OR Email Subject **Contains** "OK"
- OR Email Subject **Contains** "RECOVERED"

### Exemplo 2: Monitorar Remetente Específico

**Alert Creation Criteria:**
- Email From **Equals** "monitoring@legacy-system.com"
- AND Email Subject **Contains** "Failed"

**Alert Resolution Criteria:**
- Email From **Equals** "monitoring@legacy-system.com"
- AND Email Subject **Contains** "Success"

### Exemplo 3: Monitor de Heartbeat (Sem Email = Alerta)

**Alert Creation Criteria:**
- Email Received **Not Received In Minutes** com valor `60`

Isso cria um alerta se nenhum email for recebido por 60 minutos — útil para monitorar trabalhos programados ou processos em lote que devem enviar emails de conclusão.

**Alert Resolution Criteria:**
- Email Received **Received In Minutes** com valor `5`

Isso resolve o alerta quando um email é recebido.

## Casos de Uso

### Integração com Sistema Legado

Muitos sistemas mais antigos suportam apenas alerta baseado em email. Use o Monitor de Email de Entrada para:
- Converter alertas de email em incidentes do OneUptime
- Resolver automaticamente incidentes quando emails de recuperação chegam
- Centralizar alertas de múltiplos sistemas legados

### Monitoramento de Serviços de Terceiros

Integre com serviços que enviam notificações por email:
- Alertas de provedores de nuvem (AWS, GCP, Azure)
- Ferramentas de verificação de segurança
- Notificações de conclusão de backup
- Avisos de expiração de certificado SSL

### Monitoramento de Trabalhos Programados

Monitore trabalhos em lote e tarefas programadas:
- Crie alertas se emails de conclusão não forem recebidos no prazo
- Rastreie falhas de trabalhos por emails de notificação de erro
- Monitore conclusões de pipelines de dados

### Agregação de Alertas de Múltiplos Fornecedores

Consolide alertas de múltiplas ferramentas de monitoramento:
- Receba alertas do Nagios, Zabbix ou outras ferramentas por email
- Unifique o gerenciamento de incidentes no OneUptime
- Mantenha uma única fonte de verdade para todos os alertas

## Variáveis de Modelo

Ao configurar modelos de incidentes, você pode usar estas variáveis de emails de entrada:

| Variável | Descrição |
|----------|-------------|
| `{{emailSubject}}` | O assunto do email recebido |
| `{{emailFrom}}` | O endereço de email do remetente |
| `{{emailTo}}` | O endereço de email do destinatário |
| `{{emailBody}}` | O corpo em texto simples do email |
| `{{emailReceivedAt}}` | Quando o email foi recebido |

## Visão Resumida do Monitor

O resumo do monitor mostra:
- **Last Email Received At:** Quando o email mais recente foi recebido
- **From:** O remetente do último email
- **Subject:** A linha de assunto do último email
- **Email Headers:** Cabeçalhos completos do último email (expansível)
- **Email Body:** Conteúdo do último email (expansível)

## Configuração Auto-Hospedada

Se você está auto-hospedando o OneUptime, precisa configurar um provedor de email de entrada. Atualmente suportado:

- **SendGrid Inbound Parse** - Consulte [Integração de Email de Entrada do SendGrid](/docs/self-hosted/sendgrid-inbound-email) para instruções de configuração

## Considerações

- **Segurança do Endereço de Email:** O endereço de email do monitor contém uma chave secreta. Trate-o como uma senha e não o compartilhe publicamente.
- **Tamanho do Email:** Emails muito grandes (com anexos grandes) podem ser truncados ou rejeitados pelo provedor de email.
- **Tempo de Processamento:** Os emails são processados de forma assíncrona. Pode haver alguns segundos de atraso entre o envio de um email e a criação do alerta.
- **Insensibilidade a Maiúsculas/Minúsculas:** Todas as comparações de strings (Contains, Equals, etc.) são insensíveis a maiúsculas/minúsculas.
- **Texto Simples:** Os critérios do corpo do email usam a versão em texto simples do email. A formatação HTML é removida.

## Solução de Problemas

### Emails Não Sendo Recebidos

1. Verifique se o endereço de email está correto (verifique erros de digitação)
2. Verifique se o email está sendo bloqueado por filtros de spam
3. Verifique se o provedor de email de entrada está configurado corretamente
4. Verifique os logs do OneUptime para quaisquer mensagens de erro

### Alertas Não Sendo Criados

1. Verifique se seus critérios correspondem ao conteúdo do email
2. Verifique se o monitor não está desabilitado
3. Revise os logs de avaliação nos detalhes do monitor
4. Teste com correspondências de strings exatas antes de usar correspondência de padrões

### Alertas Não Sendo Resolvidos

1. Verifique se seus critérios de resolução correspondem ao email de recuperação
2. Certifique-se de que há um alerta ativo para resolver
3. Verifique se o email de resolução é enviado para o mesmo endereço do monitor
