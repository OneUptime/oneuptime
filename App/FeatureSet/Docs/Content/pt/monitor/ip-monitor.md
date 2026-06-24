# Monitor de IP

O monitoramento de IP permite monitorar a disponibilidade e a capacidade de resposta de qualquer endereço IPv4 ou IPv6. O OneUptime testa periodicamente a conectividade com o endereço IP alvo e relata seu status.

## Visão Geral

Os monitores de IP verificam se um endereço IP específico está acessível e responsivo. Isso permite que você:

- Monitore a disponibilidade de endereços IPv4 e IPv6
- Rastreie tempos de resposta e latência
- Detecte problemas de conectividade de rede
- Verifique se os endpoints de infraestrutura estão acessíveis

## Criando um Monitor de IP

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **IP** como o tipo de monitor
4. Insira o endereço IP que deseja monitorar
5. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### Endereço IP

Insira o endereço IPv4 ou IPv6 que deseja monitorar (ex.: `192.168.1.1` ou `2001:db8::1`). O valor deve ser um formato de endereço IP válido.

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando seu endereço IP é considerado online, degradado ou offline com base em:

### Tipos de Verificação Disponíveis

| Tipo de Verificação   | Descrição                          |
| --------------------- | ---------------------------------- |
| Is Online             | Se o endereço IP está acessível    |
| Response Time (in ms) | Tempo de resposta em milissegundos |
| Is Request Timeout    | Se a requisição expirou            |

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

#### Marcar como offline se o IP estiver inacessível

- **Check On**: Is Online
- **Filter Type**: False

#### Alertar se a latência exceder 100ms

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 100
