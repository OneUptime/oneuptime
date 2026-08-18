# Monitor de IP

O monitoramento de IP permite monitorar a disponibilidade e a capacidade de resposta de qualquer endereço IPv4 ou IPv6. O OneUptime testa periodicamente a conectividade com o endereço IP alvo e relata seu status.

## Visão Geral

Os monitores de IP verificam se um endereço IP específico está acessível e responsivo. Isso permite que você:

- Monitore a disponibilidade de endereços IPv4 e IPv6
- Rastreie tempos de resposta e latência
- Detecte problemas de conectividade de rede
- Verifique se os endpoints de infraestrutura estão acessíveis

## Criando um Monitor de IP

1. Vá para **Monitores** no Painel do OneUptime
2. Clique em **Criar monitor**
3. Selecione **IP** como o tipo de monitor
4. Insira o endereço IP que deseja monitorar
5. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### Endereço IP

Insira o endereço IPv4 ou IPv6 que deseja monitorar (ex.: `192.168.1.1` ou `2001:db8::1`). O valor deve ser um formato de endereço IP válido.

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando seu endereço IP é considerado online, degradado ou offline com base em:

### Tipos de Verificação Disponíveis

| Tipo de Verificação   | Descrição                                                    |
| --------------------- | ------------------------------------------------------------ |
| Is Online             | Se o endereço IP está acessível                              |
| Response Time (in ms) | Tempo de resposta em milissegundos                           |
| Packet Loss (in %)    | Percentual de requisições ICMP echo sem resposta             |
| Jitter (in ms)        | Desvio padrão dos tempos de ida e volta dos pacotes enviados |
| Is Request Timeout    | Se a requisição expirou                                      |

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

#### Marcar como offline se o IP estiver inacessível

- **Check On**: Is Online
- **Tipo de filtro**: False

#### Alertar se a latência exceder 100ms

- **Check On**: Response Time (in ms)
- **Tipo de filtro**: Greater Than
- **Valor**: 100
