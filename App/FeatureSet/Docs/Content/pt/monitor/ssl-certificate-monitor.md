# Monitor de Certificado SSL

O monitoramento de certificado SSL permite monitorar a validade e a expiração dos certificados SSL/TLS nos seus sites e serviços. O OneUptime verifica periodicamente seus certificados e o alerta antes que expirem ou se algum problema for detectado.

## Visão Geral

Os monitores de certificado SSL se conectam aos seus endpoints HTTPS e inspecionam o certificado SSL/TLS. Isso permite que você:

- Monitore as datas de expiração dos certificados
- Detecte certificados expirados ou prestes a expirar
- Identifique certificados autoassinados
- Verifique a validade dos certificados
- Previna interrupções de serviço causadas por certificados expirados

## Criando um Monitor de Certificado SSL

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **SSL Certificate** como o tipo de monitor
4. Insira a URL do endpoint HTTPS para verificar
5. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### URL

Insira a URL HTTPS completa do endpoint cujo certificado SSL deseja monitorar (ex.: `https://example.com` ou `https://example.com:8443`).

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando o status do seu certificado é considerado online, degradado ou offline com base em:

### Tipos de Verificação Disponíveis

| Tipo de Verificação | Descrição |
|------------|-------------|
| Is Online | Se o servidor está acessível |
| Is Valid Certificate | Se o certificado é válido (não expirado, não autoassinado) |
| Is Self-Signed Certificate | Se o certificado é autoassinado |
| Is Expired Certificate | Se o certificado expirou |
| Is Not A Valid Certificate | Se o certificado é inválido |
| Expires In Hours | Número de horas até o certificado expirar |
| Expires In Days | Número de dias até o certificado expirar |
| Is Request Timeout | Se a conexão expirou |

### Tipos de Filtro

Para **Is Online**, **Is Valid Certificate**, **Is Self-Signed Certificate**, **Is Expired Certificate**, **Is Not A Valid Certificate** e **Is Request Timeout**:

- **True** — Condição é verdadeira
- **False** — Condição é falsa

Para **Expires In Hours** e **Expires In Days**:

- **Greater Than** — A expiração está a mais do que o valor especificado
- **Less Than** — A expiração está a menos do que o valor especificado
- **Greater Than or Equal To** — A expiração está no valor especificado ou mais
- **Less Than or Equal To** — A expiração está no valor especificado ou menos
- **Equal To** — A expiração corresponde exatamente
- **Not Equal To** — A expiração não corresponde

### Critérios de Exemplo

#### Marcar como degradado se o certificado expirar em 30 dias

- **Check On**: Expires In Days
- **Filter Type**: Less Than
- **Value**: 30

#### Marcar como offline se o certificado estiver expirado

- **Check On**: Is Expired Certificate
- **Filter Type**: True

#### Alertar se o certificado for autoassinado

- **Check On**: Is Self-Signed Certificate
- **Filter Type**: True

#### Marcar como offline se o certificado for inválido

- **Check On**: Is Not A Valid Certificate
- **Filter Type**: True

## Melhores Práticas

1. **Defina múltiplos limites** — Use status degradado em 30 dias e offline em 7 dias antes do vencimento para ter tempo de renovar
2. **Monitore todos os endpoints** — Se você tiver múltiplos domínios ou subdomínios, crie um monitor para cada um
3. **Inclua portas não padrão** — Não esqueça os serviços executando HTTPS em portas não padrão
4. **Monitore após a renovação** — Após renovar um certificado, verifique se o monitor confirma que é válido
