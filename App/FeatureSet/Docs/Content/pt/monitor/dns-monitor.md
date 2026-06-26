# Monitor de DNS

O monitoramento de DNS permite monitorar a saúde e a correção da resolução DNS para seus domínios. O OneUptime periodicamente consulta registros DNS e valida as respostas em relação aos critérios configurados.

## Visão Geral

Os monitores de DNS consultam servidores DNS para tipos de registro específicos e avaliam os resultados. Isso permite que você:

- Monitore a disponibilidade do serviço DNS
- Verifique se os registros DNS estão retornando valores corretos
- Rastreie os tempos de resposta de resolução DNS
- Valide a configuração DNSSEC
- Detecte problemas de propagação de DNS ou sequestro

## Criando um Monitor de DNS

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **DNS** como o tipo de monitor
4. Insira o nome do domínio e o tipo de registro para consultar
5. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### Configurações Básicas

| Campo       | Descrição                                                                                | Obrigatório |
| ----------- | ---------------------------------------------------------------------------------------- | ----------- |
| Domain Name | O domínio a consultar (ex.: `example.com`)                                               | Sim         |
| Record Type | O tipo de registro DNS a consultar                                                       | Sim         |
| DNS Server  | Servidor DNS personalizado a usar (ex.: `8.8.8.8`). Deixe vazio para o padrão do sistema | Não         |

### Tipos de Registro Suportados

| Tipo de Registro | Descrição                                             |
| ---------------- | ----------------------------------------------------- |
| A                | Registros de endereço IPv4                            |
| AAAA             | Registros de endereço IPv6                            |
| CNAME            | Registros de nome canônico (alias)                    |
| MX               | Registros de troca de email                           |
| NS               | Registros de servidor de nomes                        |
| TXT              | Registros de texto (SPF, DKIM, etc.)                  |
| SOA              | Registros de Início de Autoridade                     |
| PTR              | Registros de ponteiro (DNS reverso)                   |
| SRV              | Registros de localizador de serviço                   |
| CAA              | Registros de Autorização de Autoridade de Certificado |

### Configurações Avançadas

| Campo        | Descrição                                          | Padrão |
| ------------ | -------------------------------------------------- | ------ |
| Port         | Número da porta DNS                                | 53     |
| Timeout (ms) | Tempo de espera por uma resposta                   | 5000   |
| Retries      | Número de tentativas de repetição em caso de falha | 3      |

## Critérios de Monitoramento

Você pode configurar critérios para determinar quando seu DNS é considerado online, degradado ou offline com base em:

### Tipos de Verificação Disponíveis

| Tipo de Verificação       | Descrição                                      |
| ------------------------- | ---------------------------------------------- |
| DNS Is Online             | Se o servidor DNS responde a consultas         |
| DNS Response Time (in ms) | Tempo de resposta de consulta em milissegundos |
| DNS Record Exists         | Se existem registros DNS para a consulta       |
| DNS Record Value          | O valor retornado por um registro DNS          |
| DNSSEC Is Valid           | Se a validação DNSSEC passa                    |

### Tipos de Filtro

Para **DNS Is Online**, **DNS Record Exists** e **DNSSEC Is Valid**:

- **True** — Condição é verdadeira
- **False** — Condição é falsa

Para **DNS Response Time**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

Para **DNS Record Value**:

- **Contains** — O valor do registro contém o texto especificado
- **Not Contains** — O valor do registro não contém o texto especificado
- **Starts With** — O valor do registro começa com o texto especificado
- **Ends With** — O valor do registro termina com o texto especificado
- **Equal To** — O valor do registro corresponde exatamente
- **Not Equal To** — O valor do registro não corresponde

### Critérios de Exemplo

#### Verificar se o DNS está resolvendo

- **Check On**: DNS Is Online
- **Filter Type**: True

#### Verificar se o registro A aponta para o IP correto

- **Check On**: DNS Record Value
- **Filter Type**: Equal To
- **Value**: `93.184.216.34`

#### Alertar se a resposta DNS for lenta

- **Check On**: DNS Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 500

#### Verificar se o DNSSEC é válido

- **Check On**: DNSSEC Is Valid
- **Filter Type**: True
