# Monitor SNMP

O monitoramento SNMP (Simple Network Management Protocol) permite monitorar dispositivos de rede como switches, roteadores, firewalls e outras infraestruturas de rede consultando OIDs (Object Identifiers) SNMP.

## Visão Geral

Os monitores SNMP consultam dispositivos de rede para informações de gerenciamento específicas usando OIDs. Isso permite que você:

- Monitore a disponibilidade e a saúde do dispositivo
- Rastreie estatísticas de interface (tráfego, erros, status)
- Monitore métricas do sistema (CPU, memória, tempo de atividade)
- Verifique OIDs específicos de fornecedores personalizados
- Defina alertas com base em valores de OID

## Criando um Monitor SNMP

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **SNMP** como o tipo de monitor
4. Configure as definições SNMP conforme descrito abaixo

## Opções de Configuração

### Configurações Básicas

| Campo | Descrição | Obrigatório |
|-------|-------------|----------|
| SNMP Version | Versão do protocolo: v1, v2c ou v3 | Sim |
| Hostname/IP | O hostname ou endereço IP do dispositivo SNMP | Sim |
| Port | Porta SNMP (padrão: 161) | Sim |

### Autenticação

#### SNMP v1/v2c

Para SNMP v1 e v2c, você só precisa fornecer uma string de comunidade:

| Campo | Descrição | Obrigatório |
|-------|-------------|----------|
| Community String | A string de comunidade SNMP (ex.: "public") | Sim |

#### SNMP v3

O SNMPv3 fornece segurança aprimorada com autenticação e criptografia:

| Campo | Descrição | Obrigatório |
|-------|-------------|----------|
| Security Level | noAuthNoPriv, authNoPriv ou authPriv | Sim |
| Username | Nome de usuário SNMPv3 | Sim |
| Auth Protocol | MD5, SHA, SHA256 ou SHA512 | Se authNoPriv ou authPriv |
| Auth Key | Senha de autenticação | Se authNoPriv ou authPriv |
| Priv Protocol | DES, AES ou AES256 | Se authPriv |
| Priv Key | Senha de privacidade/criptografia | Se authPriv |

### OIDs para Monitorar

Adicione os OIDs que deseja consultar do dispositivo. Para cada OID, você pode especificar:

| Campo | Descrição | Obrigatório |
|-------|-------------|----------|
| OID | O OID numérico (ex.: 1.3.6.1.2.1.1.1.0) | Sim |
| Name | Um nome amigável para o OID (ex.: sysDescr) | Não |
| Description | Uma descrição do que este OID representa | Não |

### Modelos de OID Comuns

O OneUptime fornece modelos para OIDs monitorados comumente:

#### MIB do Sistema

| OID | Nome | Descrição |
|-----|------|-------------|
| 1.3.6.1.2.1.1.1.0 | sysDescr | Descrição do Sistema |
| 1.3.6.1.2.1.1.3.0 | sysUpTime | Tempo de Atividade do Sistema (em ticks) |
| 1.3.6.1.2.1.1.5.0 | sysName | Nome do Sistema |
| 1.3.6.1.2.1.1.6.0 | sysLocation | Localização do Sistema |
| 1.3.6.1.2.1.1.4.0 | sysContact | Contato do Sistema |

#### MIB de Interface

| OID | Nome | Descrição |
|-----|------|-------------|
| 1.3.6.1.2.1.2.1.0 | ifNumber | Número de Interfaces de Rede |
| 1.3.6.1.2.1.2.2.1.8.X | ifOperStatus | Status Operacional da Interface (X = índice da interface) |
| 1.3.6.1.2.1.2.2.1.10.X | ifInOctets | Bytes de Entrada (X = índice da interface) |
| 1.3.6.1.2.1.2.2.1.16.X | ifOutOctets | Bytes de Saída (X = índice da interface) |

#### MIB de Recursos do Host

| OID | Nome | Descrição |
|-----|------|-------------|
| 1.3.6.1.2.1.25.1.1.0 | hrSystemUptime | Tempo de Atividade do Sistema Host |
| 1.3.6.1.2.1.25.1.5.0 | hrSystemNumUsers | Número de Usuários |
| 1.3.6.1.2.1.25.1.6.0 | hrSystemProcesses | Número de Processos em Execução |
| 1.3.6.1.2.1.25.3.3.1.2.X | hrProcessorLoad | Carga de CPU (X = índice do processador) |

### Configurações Avançadas

| Campo | Descrição | Padrão |
|-------|-------------|---------|
| Timeout | Tempo de espera por uma resposta (ms) | 5000 |
| Retries | Número de tentativas de repetição em caso de falha | 3 |

## Critérios de Monitoramento

Você pode configurar critérios para verificar respostas SNMP e acionar alertas ou incidentes.

### Tipos de Verificação Disponíveis

| Tipo de Verificação | Descrição |
|------------|-------------|
| SNMP Device Is Online | Verificar se o dispositivo responde a consultas SNMP |
| SNMP Response Time | Verificar o tempo de resposta da consulta em milissegundos |
| SNMP OID Value | Verificar o valor retornado por um OID específico |
| SNMP OID Exists | Verificar se um OID retorna um valor (não nulo) |

### Critérios de Exemplo

#### Verificar se o dispositivo está online
- **Check On**: SNMP Device Is Online
- **Filter Type**: True

#### Alertar se o tempo de resposta exceder o limite
- **Check On**: SNMP Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 1000

#### Verificar o status da interface
- **Check On**: SNMP OID Value
- **OID**: 1.3.6.1.2.1.2.2.1.8.1
- **Filter Type**: Equal To
- **Value**: 1 (1 = ativo, 2 = inativo)

#### Verificar o limite de carga de CPU
- **Check On**: SNMP OID Value
- **OID**: 1.3.6.1.2.1.25.3.3.1.2.1
- **Filter Type**: Greater Than
- **Value**: 80

## Usando Segredos de Monitor

Para segurança, você pode armazenar informações sensíveis como strings de comunidade e credenciais SNMPv3 como segredos.

### Adicionando um Segredo

1. Vá para **Project Settings** -> **Monitor Secrets** -> **Create Monitor Secret**
2. Adicione seu segredo (ex.: string de comunidade ou senha SNMPv3)
3. Selecione os monitores SNMP que devem ter acesso a este segredo

### Usando Segredos na Configuração SNMP

Use a sintaxe `{{monitorSecrets.SECRET_NAME}}` em qualquer campo sensível:

- **Community String**: `{{monitorSecrets.SnmpCommunity}}`
- **SNMPv3 Auth Key**: `{{monitorSecrets.SnmpAuthKey}}`
- **SNMPv3 Priv Key**: `{{monitorSecrets.SnmpPrivKey}}`

## Variáveis de Modelo para Alertas

Ao criar modelos de incidente ou alerta, você pode usar as seguintes variáveis:

| Variável | Descrição |
|----------|-------------|
| `{{isOnline}}` | Se o dispositivo está online (true/false) |
| `{{responseTimeInMs}}` | Tempo de resposta da consulta em milissegundos |
| `{{failureCause}}` | Mensagem de erro se a consulta falhou |
| `{{oidResponses}}` | Array de objetos de resposta OID |
| `{{OID_NAME}}` | Valor de um OID específico por nome (ex.: `{{sysUpTime}}`) |

## Solução de Problemas

### Problemas Comuns

#### Dispositivo não respondendo
- Verifique se o IP/hostname do dispositivo está correto
- Verifique se o SNMP está habilitado no dispositivo
- Verifique as regras de firewall que permitem a porta UDP 161
- Confirme que a string de comunidade está correta

#### Falhas de autenticação (v3)
- Verifique o nome de usuário, protocolo de autenticação e chave de autenticação
- Certifique-se de que o nível de segurança corresponde à configuração do dispositivo
- Verifique se o protocolo priv e a chave estão corretos para o nível authPriv

#### OID não encontrado
- Verifique se o OID é suportado pelo seu dispositivo
- Verifique se o OID requer que uma MIB específica seja carregada
- Tente consultar o OID diretamente usando as ferramentas snmpget/snmpwalk

### Testando a Conectividade SNMP

Antes de configurar o monitoramento, você pode testar a conectividade SNMP usando ferramentas de linha de comando:

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## Melhores Práticas

1. **Use SNMPv3 quando possível** - Fornece autenticação e criptografia para melhor segurança
2. **Armazene credenciais como segredos** - Nunca codifique strings de comunidade ou senhas
3. **Monitore apenas OIDs essenciais** - Consulte apenas o que você precisa para reduzir a sobrecarga de rede
4. **Defina timeouts apropriados** - Dispositivos de rede podem ter tempos de resposta variáveis
5. **Use nomes descritivos de OID** - Facilita a compreensão das mensagens de alerta
6. **Teste antes de implantar** - Verifique a conectividade SNMP antes de criar monitores
