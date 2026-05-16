# Monitor de Servidor / VM

O monitoramento de servidor e VM permite monitorar a saúde e o desempenho dos seus servidores, máquinas virtuais e outras infraestruturas, instalando um agente leve que relata métricas do sistema para o OneUptime.

## Visão Geral

Os monitores de servidor usam um agente de infraestrutura instalado nos seus servidores para coletar e relatar métricas do sistema. Isso permite que você:

- Monitore o tempo de atividade e a disponibilidade do servidor
- Rastreie o uso de CPU, memória e disco
- Monitore processos em execução
- Defina alertas com base em limites de utilização de recursos
- Detecte problemas de infraestrutura antes que impactem seus serviços

## Criando um Monitor de Servidor

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Server / VM** como o tipo de monitor
4. Uma **Secret Key** será gerada para este monitor — você precisará dela para configurar o agente
5. Siga as instruções de instalação para configurar o agente no seu servidor

## Instalando o Agente de Infraestrutura

O Agente de Infraestrutura do OneUptime é um daemon leve baseado em Go que coleta métricas do sistema e as envia para o OneUptime a cada 30 segundos. Suporta Linux, macOS e Windows.

### Linux / macOS

```bash
# Install the agent
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# Configure the agent
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Start the agent
sudo oneuptime-infrastructure-agent start
```

Substitua `YOUR_SECRET_KEY` pela chave secreta mostrada nas configurações do seu monitor e `https://oneuptime.com` pela URL da sua instância do OneUptime se for auto-hospedada.

### Windows

1. Baixe o agente mais recente em [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest)
   - `oneuptime-infrastructure-agent_windows_amd64.zip` para sistemas x64
   - `oneuptime-infrastructure-agent_windows_arm64.zip` para sistemas ARM64
2. Extraia o arquivo zip
3. Abra o Prompt de Comando como Administrador e execute:

```bash
# Configure the agent
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Start the agent
oneuptime-infrastructure-agent start
```

### Suporte a Proxy

Se o seu servidor se conecta à internet por meio de um proxy, você pode configurar o agente para usá-lo:

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Comandos do Agente

O agente de infraestrutura suporta os seguintes comandos:

| Comando | Descrição |
|---------|-------------|
| `configure` | Configure o agente com sua chave secreta e URL do OneUptime |
| `start` | Inicie o serviço do agente |
| `stop` | Pare o serviço do agente |
| `restart` | Reinicie o serviço do agente |
| `status` | Mostre o status atual do serviço |
| `logs` | Visualize os logs do agente (use `-n` para contagem de linhas, `-f` para seguir) |
| `uninstall` | Desinstale o serviço do agente |

## Métricas Coletadas

O agente coleta as seguintes métricas do seu servidor:

### CPU

- **CPU Usage Percent** — Utilização geral de CPU como porcentagem
- **CPU Cores** — Número de núcleos de CPU

### Memória

- **Total Memory** — Memória total disponível
- **Used Memory** — Memória atualmente em uso
- **Free Memory** — Memória livre disponível
- **Memory Usage Percent** — Utilização de memória como porcentagem

### Disco

Para cada disco/volume montado:

- **Total Disk Space** — Capacidade total do disco
- **Used Disk Space** — Espaço atualmente em uso
- **Free Disk Space** — Espaço livre disponível
- **Disk Usage Percent** — Utilização do disco como porcentagem
- **Disk Path** — Caminho de montagem do disco

### Processos

- **Process Name** — Nome do processo em execução
- **Process ID (PID)** — Identificador do processo
- **Process Command** — Comando completo usado para iniciar o processo

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando seu servidor é considerado online, degradado ou offline.

### Tipos de Verificação Disponíveis

| Tipo de Verificação | Descrição |
|------------|-------------|
| Is Online | Se o agente do servidor está relatando (com base no heartbeat) |
| CPU Usage Percent | Porcentagem de utilização de CPU atual |
| Memory Usage Percent | Porcentagem de utilização de memória atual |
| Disk Usage Percent | Porcentagem de utilização de disco atual (para um caminho de disco específico) |
| Server Process Name | Verificar se um processo com um nome específico está em execução |
| Server Process Command | Verificar se um processo com um comando específico está em execução |
| Server Process PID | Verificar se um processo com um PID específico está em execução |

### Tipos de Filtro

Para métricas numéricas (CPU, memória, disco):

- **Greater Than** — O valor excede um limite
- **Less Than** — O valor está abaixo de um limite
- **Greater Than or Equal To** — O valor está no limite ou acima
- **Less Than or Equal To** — O valor está no limite ou abaixo
- **Evaluate Over Time** — Avalie usando agregação (Média, Soma, Máximo, Mínimo, Todos os Valores, Qualquer Valor) em uma janela de tempo

Para verificações de processo:

- **Is Executing** — O processo está em execução atualmente
- **Is Not Executing** — O processo não está em execução

### Critérios de Exemplo

#### Marcar servidor como offline se o agente parar de relatar

- **Check On**: Is Online
- **Filter Type**: False

#### Alertar quando o uso de CPU exceder 90%

- **Check On**: CPU Usage Percent
- **Filter Type**: Greater Than
- **Value**: 90

#### Alertar quando o uso de disco exceder 85%

- **Check On**: Disk Usage Percent
- **Disk Path**: `/`
- **Filter Type**: Greater Than
- **Value**: 85

#### Alertar quando o uso de memória exceder 80%

- **Check On**: Memory Usage Percent
- **Filter Type**: Greater Than
- **Value**: 80

#### Alertar se um processo crítico parar de executar

- **Check On**: Server Process Name
- **Filter Type**: Is Not Executing
- **Value**: `nginx`

## Solução de Problemas

### Agente não está relatando

- Verifique se o agente está em execução: `sudo oneuptime-infrastructure-agent status`
- Verifique os logs do agente: `sudo oneuptime-infrastructure-agent logs -n 50`
- Confirme que a chave secreta está correta
- Certifique-se de que o servidor pode alcançar a URL da sua instância do OneUptime
- Verifique as regras de firewall que permitem conexões HTTPS de saída

### Alto uso de recursos pelo agente

O agente é projetado para ser leve. Se você notar alto uso de recursos:
- Reinicie o agente: `sudo oneuptime-infrastructure-agent restart`
- Verifique os logs do agente para erros

### Problemas de proxy

- Verifique se a URL e a porta do proxy estão corretas
- Certifique-se de que o proxy permite conexões com sua instância do OneUptime
- Reconfigure com: `sudo oneuptime-infrastructure-agent configure --proxy-url=http://proxy:port --secret-key=YOUR_KEY --oneuptime-url=YOUR_URL`

## Melhores Práticas

1. **Defina limites significativos** — Configure critérios degradados e offline que correspondam aos intervalos de operação normais do seu servidor
2. **Monitore processos críticos** — Use o monitoramento de processos para garantir que serviços essenciais como servidores web e bancos de dados estejam sempre em execução
3. **Monitore o uso do disco proativamente** — Problemas de espaço em disco podem causar falhas em cascata nos aplicativos; defina alertas bem antes que os discos estejam cheios
4. **Use "Evaluate Over Time"** — Para métricas como CPU que podem ter picos breves, use agregação baseada em tempo para evitar alertas falsos
5. **Mantenha o agente atualizado** — Atualize periodicamente o agente de infraestrutura para obter as melhorias e correções mais recentes
