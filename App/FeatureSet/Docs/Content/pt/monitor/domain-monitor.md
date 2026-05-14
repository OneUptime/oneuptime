# Monitor de Domínio

O monitoramento de domínio permite monitorar o status de registro e a expiração dos seus nomes de domínio. O OneUptime periodicamente realiza pesquisas WHOIS para rastrear a saúde do seu domínio e alertá-lo antes que ele expire.

## Visão Geral

Os monitores de domínio consultam dados WHOIS para seus domínios para rastrear detalhes de registro. Isso permite que você:

- Monitore as datas de expiração do domínio
- Detecte domínios expirados ou prestes a expirar
- Rastreie informações do registrador do domínio
- Verifique a configuração de servidores de nomes
- Monitore códigos de status do domínio

## Criando um Monitor de Domínio

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Domain** como o tipo de monitor
4. Insira o nome do domínio que deseja monitorar
5. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### Configurações Básicas

| Campo | Descrição | Obrigatório |
|-------|-------------|----------|
| Domain Name | O domínio para monitorar (ex.: `example.com`) | Sim |

### Configurações Avançadas

| Campo | Descrição | Padrão |
|-------|-------------|---------|
| Timeout (ms) | Tempo de espera por uma resposta WHOIS | 10000 |
| Retries | Número de tentativas de repetição em caso de falha | 3 |

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando seu domínio é considerado online, degradado ou offline com base em:

### Tipos de Verificação Disponíveis

| Tipo de Verificação | Descrição |
|------------|-------------|
| Domain Expires In Days | Número de dias até que o registro do domínio expire |
| Domain Registrar | O nome do registrador do domínio |
| Domain Name Server | Hostnames dos servidores de nomes para o domínio |
| Domain Status Code | Códigos de status WHOIS do domínio |
| Domain Is Expired | Se o domínio expirou |

### Tipos de Filtro

Para **Domain Is Expired**:

- **True** — O domínio expirou
- **False** — O domínio não expirou

Para **Domain Expires In Days**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

Para **Domain Registrar**, **Domain Name Server** e **Domain Status Code**:

- **Contains** — O valor contém o texto especificado
- **Not Contains** — O valor não contém o texto especificado
- **Starts With** — O valor começa com o texto especificado
- **Ends With** — O valor termina com o texto especificado
- **Equal To** — O valor corresponde exatamente
- **Not Equal To** — O valor não corresponde

### Critérios de Exemplo

#### Alertar se o domínio expirar em 30 dias

- **Check On**: Domain Expires In Days
- **Filter Type**: Less Than
- **Value**: 30

#### Marcar como offline se o domínio estiver expirado

- **Check On**: Domain Is Expired
- **Filter Type**: True

#### Verificar se os servidores de nomes estão corretos

- **Check On**: Domain Name Server
- **Filter Type**: Contains
- **Value**: `ns1.example.com`

## Melhores Práticas

1. **Defina alertas antecipados** — Configure alertas de degradação em 60 dias e alertas de offline em 14 dias antes do vencimento
2. **Monitore todos os domínios críticos** — Inclua domínios primários, subdomínios registrados separadamente e quaisquer domínios usados para email ou APIs
3. **Rastreie mudanças de registrador** — Monitore o campo do registrador para detectar transferências não autorizadas de domínio
