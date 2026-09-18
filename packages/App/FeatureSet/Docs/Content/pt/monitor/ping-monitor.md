# Monitor de Ping

O monitoramento de ping permite monitorar a disponibilidade e a capacidade de resposta de qualquer host ou endereço IP. O OneUptime periodicamente envia requisições de ping para o seu alvo e verifica se ele responde corretamente.

## Visão Geral

Os monitores de ping testam a conectividade básica de rede enviando requisições de ping ICMP para um host. Isso permite que você:

- Monitore o tempo de atividade e a disponibilidade do host
- Rastreie a latência de rede e os tempos de resposta
- Detecte problemas de conectividade antes que impactem seus serviços
- Verifique se servidores e dispositivos de rede estão acessíveis

## Criando um Monitor de Ping

1. Vá para **Monitores** no Painel do OneUptime
2. Clique em **Criar monitor**
3. Selecione **Ping** como o tipo de monitor
4. Insira o hostname ou endereço IP que deseja monitorar
5. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### Hostname ou Endereço IP de Ping

Insira o hostname ou endereço IP do alvo que deseja monitorar (ex.: `example.com` ou `192.168.1.1`). Tanto hostnames quanto endereços IP são aceitos.

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando seu host é considerado online, degradado ou offline com base em:

### Tipos de Verificação Disponíveis

| Tipo de Verificação   | Descrição                                                    |
| --------------------- | ------------------------------------------------------------ |
| Is Online             | Se o host responde a requisições de ping                     |
| Response Time (in ms) | Tempo de ida e volta da requisição de ping em milissegundos  |
| Packet Loss (in %)    | Percentual de requisições ICMP echo sem resposta             |
| Jitter (in ms)        | Desvio padrão dos tempos de ida e volta dos pacotes enviados |
| Is Request Timeout    | Se a requisição de ping expirou                              |

### Tipos de Filtro

Para **Is Online** e **Is Request Timeout**:

- **True** — Condição é verdadeira
- **False** — Condição é falsa

Para **Response Time**, **Packet Loss** e **Jitter**:

- **Greater Than** — O tempo de resposta excede um limite
- **Less Than** — O tempo de resposta está abaixo de um limite
- **Greater Than or Equal To** — O tempo de resposta está no limite ou acima
- **Less Than or Equal To** — O tempo de resposta está no limite ou abaixo

**Evaluate this criteria over a period of time** é uma caixa de seleção no formulário de critérios, não uma condição de filtro. Ative-a para comparar uma agregação — escolhida em **Evaluate** (Média, Soma, Máximo, Mínimo, Todos os Valores, Qualquer Valor) sobre a janela definida em **For the last (in minutes)** — em vez do valor da última verificação.

### Critérios de Exemplo

#### Marcar como offline se o host estiver inacessível

- **Check On**: Is Online
- **Tipo de filtro**: False

#### Alertar se o tempo de resposta exceder 200ms

- **Check On**: Response Time (in ms)
- **Tipo de filtro**: Greater Than
- **Valor**: 200
