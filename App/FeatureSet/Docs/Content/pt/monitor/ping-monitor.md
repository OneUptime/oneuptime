# Monitor de Ping

O monitoramento de ping permite monitorar a disponibilidade e a capacidade de resposta de qualquer host ou endereço IP. O OneUptime periodicamente envia requisições de ping para o seu alvo e verifica se ele responde corretamente.

## Visão Geral

Os monitores de ping testam a conectividade básica de rede enviando requisições de ping ICMP para um host. Isso permite que você:

- Monitore o tempo de atividade e a disponibilidade do host
- Rastreie a latência de rede e os tempos de resposta
- Detecte problemas de conectividade antes que impactem seus serviços
- Verifique se servidores e dispositivos de rede estão acessíveis

## Criando um Monitor de Ping

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Ping** como o tipo de monitor
4. Insira o hostname ou endereço IP que deseja monitorar
5. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### Hostname ou Endereço IP de Ping

Insira o hostname ou endereço IP do alvo que deseja monitorar (ex.: `example.com` ou `192.168.1.1`). Tanto hostnames quanto endereços IP são aceitos.

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando seu host é considerado online, degradado ou offline com base em:

### Tipos de Verificação Disponíveis

| Tipo de Verificação   | Descrição                                                   |
| --------------------- | ----------------------------------------------------------- |
| Is Online             | Se o host responde a requisições de ping                    |
| Response Time (in ms) | Tempo de ida e volta da requisição de ping em milissegundos |
| Is Request Timeout    | Se a requisição de ping expirou                             |

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

#### Marcar como offline se o host estiver inacessível

- **Check On**: Is Online
- **Filter Type**: False

#### Alertar se o tempo de resposta exceder 200ms

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 200
