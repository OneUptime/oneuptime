# Monitor de Porta

O monitoramento de porta permite monitorar a disponibilidade de portas TCP ou UDP específicas em um host. O OneUptime periodicamente tenta se conectar à porta especificada e verifica se está aberta e responsiva.

## Visão Geral

Os monitores de porta testam se uma porta de rede específica está aceitando conexões. Isso permite que você:

- Monitore a disponibilidade de serviços em portas específicas
- Rastreie tempos de resposta de porta
- Verifique se serviços como bancos de dados, servidores de email e servidores de aplicativos estão em execução
- Detecte interrupções de serviço antes que impactem os usuários

## Criando um Monitor de Porta

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Port** como o tipo de monitor
4. Insira o hostname ou endereço IP e o número da porta
5. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### Hostname ou Endereço IP

Insira o hostname ou endereço IP do host alvo (ex.: `example.com` ou `192.168.1.1`).

### Porta

Insira o número da porta para monitorar (1–65535). Exemplos comuns:

| Porta | Serviço    |
| ----- | ---------- |
| 22    | SSH        |
| 25    | SMTP       |
| 80    | HTTP       |
| 443   | HTTPS      |
| 3306  | MySQL      |
| 5432  | PostgreSQL |
| 6379  | Redis      |
| 27017 | MongoDB    |

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando sua porta é considerada online, degradada ou offline com base em:

### Tipos de Verificação Disponíveis

| Tipo de Verificação   | Descrição                                           |
| --------------------- | --------------------------------------------------- |
| Is Online             | Se a porta está aberta e aceitando conexões         |
| Response Time (in ms) | Tempo para estabelecer uma conexão em milissegundos |
| Is Request Timeout    | Se a tentativa de conexão expirou                   |

### Tipos de Filtro

Para **Is Online** e **Is Request Timeout**:

- **True** — Condição é verdadeira
- **False** — Condição é falsa

Para **Response Time**:

- **Greater Than** — O tempo de resposta excede um limite
- **Less Than** — O tempo de resposta está abaixo de um limite
- **Greater Than or Equal To** — O tempo de resposta está no limite ou acima
- **Less Than or Equal To** — O tempo de resposta está no limite ou abaixo
- **Equal To** — O tempo de resposta corresponde exatamente
- **Not Equal To** — O tempo de resposta não corresponde
- **Evaluate Over Time** — Avalie usando agregação (Média, Soma, Máximo, Mínimo, Todos os Valores, Qualquer Valor) em uma janela de tempo

### Critérios de Exemplo

#### Marcar como offline se a porta estiver fechada

- **Check On**: Is Online
- **Filter Type**: False

#### Alertar se o tempo de conexão exceder 500ms

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 500

#### Marcar como degradado se a conexão for lenta

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 200
