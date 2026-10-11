# Pipelines de registros

Os pipelines de registros transformam os registros enquanto o OneUptime os ingere, antes de serem armazenados. Um pipeline tem um **filtro** que decide a quais registros ele se aplica e uma lista ordenada de **processadores** que alteram esses registros: extrair campos da mensagem, corrigir a gravidade, renomear um atributo ou marcar o registro com uma categoria.

Os pipelines ficam em **Registros → Configurações → Pipelines**.

:::cards
- [Como um pipeline é executado](#como-um-pipeline-é-executado): Onde os pipelines ficam na ingestão e em que ordem são executados.
- [Criar um pipeline](#criar-um-pipeline): Selecionar alguns registros e adicionar processadores a eles.
- [Key=Value Parser](#keyvalue-parser): Transformar linhas de firewall e logfmt em atributos.
- [Exemplo: firewall Sophos XGS](#exemplo-firewall-sophos-xgs): Analisar o syslog de um firewall de ponta a ponta.
:::

## Como um pipeline é executado

Os pipelines são executados em todo registro que o OneUptime ingere, seja de OpenTelemetry, syslog ou Fluentd, depois dos filtros de descarte e das regras de mascaramento, e antes de o registro ser armazenado:

```mermaid title="Onde os pipelines são executados enquanto um registro é ingerido"
flowchart TB
    arrive["O registro chega"] --> drop{"Corresponde a um<br/>filtro de descarte?"}
    drop -->|"sim"| discarded["Descartado"]
    drop -->|"não"| scrub["As regras de mascaramento<br/>ocultam dados"]
    scrub --> filter{"O filtro do próximo<br/>pipeline corresponde?"}
    filter -->|"sim"| processors["Executar os processadores dele em ordem"]
    filter -->|"não"| more{"Mais pipelines?"}
    processors --> more
    more -->|"sim"| filter
    more -->|"não"| stored["O registro é armazenado"]
```

- **Os pipelines são executados em ordem**: a ordem da lista, que você muda arrastando as linhas. Um pipeline só mexe nos registros com que o filtro dele corresponde, e todo pipeline cujo filtro corresponde é executado, não só o primeiro.
- **Os processadores também são executados em ordem**, e cada um vê o que o anterior produziu, então um analisador precisa vir antes de um processador que lê os campos que ele extrai. O filtro de um pipeline posterior também vê o que os pipelines anteriores mudaram.
- **O processamento acontece na ingestão.** Alterar um pipeline afeta os registros que chegam depois, em cerca de um minuto; registros já armazenados não são reprocessados.
- **Um processador nunca descarta nem esvazia um registro.** Uma linha que um analisador não consegue ler passa sem alteração. Para descartar registros, use **Registros → Configurações → Filtros de descarte**.
- **Só pipelines e processadores habilitados são executados.** Desligue um na página dele para pausá-lo sem perder a configuração.

## Tipos de processador

| Processador | O que faz |
| --- | --- |
| Grok Parser | Extrai campos de uma linha de formato fixo (uma linha de acesso do nginx) usando um padrão nomeado. |
| Key=Value Parser | Divide uma linha de pares `key=value` (Sophos XGS, Fortinet, logfmt) em atributos, em qualquer ordem. |
| Remapeador de severidade | Associa um nível bruto como `warn`, lido de um atributo, à gravidade padrão do registro. |
| Remapeador de atributos | Renomeia ou copia um atributo, por exemplo `src_ip` para `source_ip`. |
| Processador de categorias | Marca um registro com um nome de categoria quando ele corresponde a um filtro, por exemplo "Payment Error". |

## Antes de começar

- Registros chegando ao OneUptime, por [OpenTelemetry](/docs/telemetry/open-telemetry), [syslog](/docs/telemetry/syslog), [Fluentd](/docs/telemetry/fluentd) ou uma sonda.
- Permissão para alterar pipelines. Proprietários e administradores do projeto a têm; os demais precisam das permissões **Create Log Pipeline** e **Create Log Pipeline Processor**.

## Criar um pipeline

:::steps
### Criar o pipeline

Acesse **Registros → Configurações → Pipelines** e clique em **Criar: Pipeline de registros**. Dê a ele um **Nome**, como *Analisar registros do firewall*, e crie-o. A página do pipeline abre.

### Escolher a quais registros ele se aplica

Em **Condições de filtro**, clique em **Editar** e adicione condições sobre **Gravidade**, **Corpo do registro**, **ID do serviço** ou um atributo personalizado. Junte-as com **Todas as condições** ou **Qualquer condição** e clique em **Salvar alterações**. Um pipeline sem condições se aplica a todos os registros.

### Adicionar processadores

Em **Processadores**, clique em **Adicionar processador**, informe um **Nome do processador**, escolha um **Tipo de processador** e preencha as configurações dele. Os analisadores Grok e Key=Value têm um testador: cole uma linha de exemplo para ver o que eles extrairiam. Clique em **Criar Processador**.

### Colocá-los em ordem

Arraste os processadores para mudar a ordem em que são executados, e arraste os pipelines na lista **Pipelines** da mesma forma. Os registros novos são processados em cerca de um minuto.
:::

### Condições de filtro

Cada condição compara um campo com um valor. Por trás do construtor, o filtro é uma consulta como `severityText = 'Error' AND body LIKE 'timeout'`, que **Preview query** mostra.

| Operador | Na consulta | Observações |
| --- | --- | --- |
| é igual a | `=` | Exato e diferencia maiúsculas de minúsculas. |
| não é igual a | `!=` | Exato e diferencia maiúsculas de minúsculas. |
| contém | `LIKE` | Ignora maiúsculas e minúsculas. `%` no valor é um curinga. |
| é um de | `IN` | Uma lista de valores exatos separados por vírgula. |

Os valores de gravidade são `Fatal`, `Error`, `Warning`, `Information`, `Debug`, `Trace` e `Unspecified`, então `severityText = 'Error'` corresponde e `'ERROR'` nunca vai corresponder. Um atributo personalizado é escrito `attributes.<key>`, por exemplo `attributes.networkDevice.name = 'hq-firewall'`.

## Key=Value Parser

Firewalls e outros equipamentos de rede registram cada evento como uma linha de pares `key=value`. Quais campos uma linha tem, e em que ordem, depende do evento, então nenhum padrão grok único consegue descrevê-los. O Key=Value Parser não precisa de um: ele percorre a linha e transforma cada par que encontra em um atributo do registro, em qualquer ordem. Como atributos, você pode pesquisá-los e filtrá-los, usá-los em um [monitor de logs](/docs/monitor/logs-monitor) e alertar uma vez por túnel, interface ou usuário com [Agrupar Por](/docs/monitor/logs-monitor#alertas-por-grupo-group-by).

### Configuração

| Configuração | Padrão | Descrição |
| --- | --- | --- |
| Source Field | `body` | O campo a analisar: `body` para a mensagem do registro, ou um atributo como `attributes.raw_line`. |
| Target Prefix | nenhum | Um namespace para as chaves extraídas. `sophos` armazena `con_name` como `sophos.con_name`. Um separador é adicionado, a menos que o prefixo já termine em `.`, `_`, `-` ou `:`. |
| Pair Delimiter | qualquer espaço em branco | O que separa um par do seguinte. Deixe em branco para Sophos, Fortinet e logfmt; use `,`, `;` ou `\|` para outros formatos. |
| Key-Value Delimiter | `=` | O que separa uma chave do valor, por exemplo `:` para `status:up`. |
| Substituir em caso de conflito | desligado | Se uma chave pode substituir um atributo que o registro já tem. Desligado por padrão: as chaves vêm da própria linha, e uma linha poderia reescrever atributos definidos na ingestão, como o dispositivo de onde veio. |

Os dois delimitadores precisam ser diferentes, não podem conter um ao outro e não podem conter aspas nem barras invertidas; cada um tem no máximo 8 caracteres. O formulário do processador verifica isso antes de salvar, e o testador dele, **Test With a Sample Line**, mostra exatamente os atributos que uma linha de exemplo produziria.

### Regras de análise

- **Valores entre aspas** mantêm espaços e delimitadores: `message="IPSec Connection HQ-Branch1 terminated"` é um único valor. Aspas duplas e simples funcionam, e `\"` dentro de um valor é uma aspa literal. Uma aspa que nunca é fechada (uma linha cortada por um limite de tamanho do syslog) vai até o fim da linha.
- **Valores sem aspas** vão até o próximo delimitador de pares, então `url=https://example.com/?a=b` mantém o seu `=`.
- **Valores vazios** (`key=` e `key=""`) são armazenados como strings vazias.
- **Os valores são sempre texto.** `latency=11` é armazenado como `"11"`, assim como uma captura grok sem tipo.
- **As chaves** começam com uma letra ou sublinhado e contêm letras, dígitos e `. _ - @`. O texto antes do primeiro par, como um cabeçalho syslog RFC 3164, e palavras soltas sem delimitador são ignorados. Uma prioridade syslog grudada na primeira chave (`<30>device_name="SFW"`) é removida e a chave é mantida.
- **Uma chave repetida mantém o primeiro valor**; os seguintes são ignorados.
- **Limites:** uma linha com mais de 32 KiB não é analisada, no máximo 100 pares são extraídos de uma linha, chaves com mais de 256 caracteres são ignoradas e valores com mais de 4.096 caracteres são truncados.

### Exemplo: firewall Sophos XGS

Quando um firewall Sophos XGS envia syslog a uma [sonda](/docs/monitor/network-device-monitor), cada mensagem é armazenada como registro do dispositivo de rede, com a mensagem syslog como corpo. Para analisá-la:

:::steps
#### Criar um pipeline para o firewall

Acesse **Registros → Configurações → Pipelines** e crie um pipeline. Dê a ele um filtro que corresponda aos registros do firewall, por exemplo o atributo personalizado `networkDevice.name` é igual a `hq-firewall` (`attributes.networkDevice.name = 'hq-firewall'`), ou **Corpo do registro** contém `log_component=` para pegar todas as linhas da Sophos.

#### Adicionar o analisador

Abra o pipeline e clique em **Adicionar processador**. Escolha **Key=Value Parser**, mantenha **Source Field** como `body` e defina **Target Prefix** como `sophos` (opcional, mas mantém os campos do firewall juntos).

#### Testar e salvar

Cole uma linha do firewall em **Test With a Sample Line** para conferir o resultado e clique em **Criar Processador**.
:::

Um evento IPsec da Sophos:

```text
device_name="SFW" timestamp="2024-05-02T11:03:12+0200" device_model="XGS2100" device_serial_id="X1234" log_id="010101600001" log_type="Event" log_component="IPSec" log_subtype="System" severity="Information" con_name="HQ-Branch1" src_ip="10.171.4.117" dst_ip="10.171.4.118" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."
```

vira estes atributos (entre outros):

| Atributo | Valor |
| --- | --- |
| `sophos.log_component` | `IPSec` |
| `sophos.con_name` | `HQ-Branch1` |
| `sophos.status` | `Terminated` |
| `sophos.src_ip` | `10.171.4.117` |
| `sophos.message` | `IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated.` |

Uma linha de SLA de SD-WAN tem outros campos em outra ordem, e o mesmo processador a trata:

```text
log_id=158825619025 log_type="SD-WAN" log_component="SLA" profile_name="Branch-Internet" gw_name="WAN2" latency=11 jitter=2 packet_loss=0 gw_status="up" sla_status="SLA met"
```

resulta em `sophos.gw_name = WAN2`, `sophos.latency = 11`, `sophos.packet_loss = 0`, `sophos.gw_status = up` e `sophos.sla_status = SLA met`. Versões mais antigas do SFOS registram um formato legado (`device="SFW" date=2017-01-31 time=18:02:03 timezone="IST" ... connectionname="Tunnel A"`); ele é analisado do mesmo jeito, com o nome do túnel em `connectionname` em vez de `con_name`.

Para transformar essas linhas de SLA em métricas de latência, jitter e perda de pacotes por gateway, veja o exemplo de [Regras de gravação de registros](/docs/telemetry/log-recording-rules).

### Exemplo: Fortinet FortiGate

Os registros do FortiGate usam o mesmo estilo:

```text
date=2024-01-01 time=10:00:00 devname="FG100" logid="0100032001" type="event" subtype="vpn" level="notice" action="tunnel-down" vpntunnel="HQ-to-Branch2" msg="IPsec tunnel down"
```

Com as configurações padrão e um prefixo `fortigate`, isso resulta em `fortigate.devname = FG100`, `fortigate.subtype = vpn`, `fortigate.action = tunnel-down`, `fortigate.vpntunnel = HQ-to-Branch2` e `fortigate.time = 10:00:00`: os dois-pontos de um horário fazem parte do valor, não são um delimitador.

### Alertar uma vez por túnel

Com os campos analisados, um [monitor de logs](/docs/monitor/logs-monitor) pode contar as falhas e abrir um alerta separado para cada túnel: filtre por `sophos.log_component` = `IPSec` com o corpo contendo `terminated` e agrupe por `sophos.con_name`. Veja [Alertas por grupo](/docs/monitor/logs-monitor#alertas-por-grupo-group-by).

## Grok Parser

Extrai campos estruturados de uma linha de formato fixo. Um padrão grok é uma expressão regular com referências nomeadas: `%{IPV4:client_ip}` significa "encontrar um endereço IPv4 e armazená-lo como `client_ip`". O padrão não precisa cobrir a linha inteira, e uma linha que não corresponde fica sem alteração.

| Configuração | Padrão | Descrição |
| --- | --- | --- |
| **Source Field** | `body` | O campo a analisar, como no Key=Value Parser. |
| **Target Prefix** | nenhum | Um namespace para os campos extraídos, adicionado da mesma forma. |
| **Grok Pattern** | — | O padrão. O formulário lista os padrões nomeados disponíveis. |

Uma captura é armazenada como texto, a menos que você lhe dê um tipo: `%{NUMBER:status:int}` a armazena como número. Os tipos são `int`, `long`, `float`, `double`, `boolean` e `string`. Teste um padrão com uma linha de exemplo em **Test Your Pattern** antes de salvar.

| Corpo do registro | Padrão | Atributos adicionados |
| --- | --- | --- |
| `10.0.1.5 - GET /health 200` | `%{IPV4:client_ip} - %{WORD:method} %{NOTSPACE:path} %{NUMBER:status:int}` | client_ip, method, path, status |

Use o Key=Value Parser quando a linha for feita de pares `key=value` cuja ordem muda.

## Remapeador de severidade

Lê um valor bruto de um atributo e o associa a uma gravidade padrão. Defina **Atributo de origem** como o atributo que contém o nível (`level` por padrão) e adicione **Mapeamentos**: cada um une um valor que sua aplicação emite, como `warn`, a uma gravidade, como Warning. A correspondência ignora maiúsculas e minúsculas. Um valor sem mapeamento mantém a gravidade do registro como estava.

## Remapeador de atributos

Move o valor de um atributo (**Chave de origem**) para outro (**Chave de Destino**), por exemplo `src_ip` para `source_ip`.

| Configuração | Padrão | Efeito |
| --- | --- | --- |
| **Preservar origem** | desligado | Desligado, renomeia o atributo: a chave de origem é removida. Ligado, copia-o e mantém a chave de origem. |
| **Substituir em caso de conflito** | ligado | Ligado, substitui o destino quando ele já existe. Desligado, mantém o destino e pula o remapeamento. |

## Processador de categorias

Avalia uma lista de regras em ordem e armazena em um atributo de destino o nome da primeira regra cujo filtro corresponde, para que você encontre de uma vez todos os registros "Payment Error". Defina **Atributo de Destino** (`category` por padrão) e adicione **Regras de categoria**: um **Category name** e as condições em **When logs match**. Vence a primeira regra que corresponder; um registro que não corresponde a nenhuma fica sem alteração.

## Próximos passos

:::cards
- [Monitor de logs](/docs/monitor/logs-monitor): Alertar sobre os atributos que seus pipelines extraem.
- [Regras de gravação de registros](/docs/telemetry/log-recording-rules): Transformar campos de registros analisados em métricas.
- [Syslog](/docs/telemetry/syslog): Enviar o syslog de firewalls e servidores ao OneUptime.
- [Sintaxe de pesquisa](/docs/telemetry/search-syntax): Pesquisar pelos novos atributos no explorador de registros.
:::
