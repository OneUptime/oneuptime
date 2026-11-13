# Orçamentos de ingestão

Um orçamento de ingestão limita quanta telemetria um projeto envia em um dia, para que um serviço barulhento ou um loop de registros descontrolado não encha o seu armazenamento. O administrador da instância define um orçamento diário para cada sinal, para todos os projetos ou para um só projeto, e qualquer pessoa que edite uma chave de ingestão pode dar à chave um orçamento próprio menor. Cada orçamento também pode ter um limite de taxa por segundo.

:::cards
- [Como os orçamentos funcionam](#como-os-orçamentos-funcionam): Três níveis, contados à medida que a telemetria chega.
- [Definir os orçamentos padrão de todos os projetos](#definir-os-orçamentos-padrão-de-todos-os-projetos): Nas configurações do Admin Dashboard.
- [Dar a uma chave de ingestão um orçamento próprio](#dar-a-uma-chave-de-ingestão-um-orçamento-próprio): Uma parte do orçamento do projeto.
- [Alertar sobre um orçamento](#alertar-sobre-um-orçamento): Antes de ele se esgotar, e quando se esgota.
:::

## Como os orçamentos funcionam

A telemetria é contada à medida que chega: no orçamento que o projeto dela tem para aquele sinal, e no da chave de ingestão quando a chave tem um. Quando um orçamento diário se esgota, esse sinal é recusado até o orçamento ser redefinido.

```mermaid title="O que o OneUptime verifica antes de armazenar telemetria"
flowchart TB
    request["A telemetria chega<br/>com uma chave<br/>de ingestão"] --> budget{"Orçamento de hoje<br/>esgotado?"}
    budget -->|"Sim"| refused["Recusada com 403<br/>até a redefinição"]
    budget -->|"Não"| rate{"Mais rápida que<br/>o limite de taxa?"}
    rate -->|"Sim"| throttled["Recusada com 429:<br/>o remetente tenta<br/>de novo"]
    rate -->|"Não"| counted["Contada e depois<br/>armazenada"]
```

- **Três níveis.** O padrão da instância vale para todos os projetos. O administrador da instância pode dar a um projeto um orçamento próprio no lugar dele, ou nenhum limite. O orçamento de uma chave apenas subdivide o do projeto dela: pode ser menor, nunca maior.
- **Cinco sinais.** Registros, traços, métricas, perfis e eventos de segurança têm, cada um, um orçamento próprio. As reproduções de sessão têm limites próprios: veja [Reprodução de sessões](/docs/telemetry/session-replay).
- **Os bytes são contados descomprimidos.** Uma requisição conta o tamanho do seu corpo depois de descomprimido, então comprimi-la não muda o que ela conta. Um GB são 1024³ bytes, e um MB, 1024² bytes.
- **Conta o que chega, não o que é armazenado.** A telemetria que um [filtro de descarte](/docs/telemetry/drop-filters-and-scrub-rules) remove depois ainda conta, então um orçamento pode mostrar mais do que a página [Uso de telemetria](/docs/telemetry/usage), que conta o que foi armazenado.
- **A última requisição é armazenada inteira.** Uma requisição que chega enquanto um orçamento ainda tem espaço é armazenada por completo, então um orçamento esgotado pode mostrar um pouco mais de 100%.
- **Nada é limitado até que um orçamento seja definido.** Toda instalação começa sem orçamentos, e um projeto sem nenhum nem chega a ser contado.
- **As mudanças chegam a todos os servidores em até um minuto.**
- **A telemetria é aceita quando não pode ser contada.** Os orçamentos são contados no Valkey. Enquanto ele estiver inacessível, o OneUptime armazena a telemetria sem contá-la em vez de recusá-la, e as páginas de orçamento avisam disso.

## Antes de começar

- **Para os orçamentos da instância e de um projeto, o Admin Dashboard.** Em uma instalação de hospedagem própria, só o administrador da instância os define. Os proprietários e administradores de um projeto veem os orçamentos dele, mas não podem alterá-los.
- **Para o orçamento próprio de uma chave, uma função que edite chaves de ingestão.** Project Owner ou Project Admin, ou uma função personalizada com a permissão Edit Ingestion Key.
- **Para ver os orçamentos, uma função que veja o uso do projeto.** As funções que veem a página [Uso de telemetria](/docs/telemetry/usage) veem nela os orçamentos do projeto.

## Definir os orçamentos padrão de todos os projetos

:::steps
### Abrir Orçamentos de ingestão

No Admin Dashboard, acesse **Configurações → Telemetria → Orçamentos de ingestão**. **Telemetria** começa recolhido no menu lateral: clique nele para abri-lo.

### Definir os orçamentos diários

No cartão **Orçamentos diários padrão**, clique em **Editar orçamentos diários padrão**, informe um número de GB para cada sinal a limitar, como **Registros (GB por dia)**, e clique em **Salvar alterações**. Deixe um sinal vazio para não ter limite.

### Definir os limites de taxa, se precisar deles

No cartão **Limites de taxa padrão**, clique em **Editar limites de taxa padrão** e informe um número de MB por segundo para um sinal, como **Registros (MB por segundo)**. Um limite de taxa impede que um único pico esgote em minutos o orçamento de um dia.
:::

O cartão **Aviso e redefinição** guarda o limite de aviso e o horário em que o dia de orçamento é redefinido: veja [O aviso e a redefinição](#o-aviso-e-a-redefinição).

## Definir os orçamentos de um projeto

:::steps
### Abrir o projeto

No Admin Dashboard, acesse **Projetos**, clique no projeto e clique em **Orçamentos de ingestão** no menu lateral dele. A página abre com o que o projeto usou dos seus orçamentos hoje.

### Definir os orçamentos diários dele

No cartão **Orçamentos diários deste projeto**, clique em **Editar orçamentos diários**. Informe para um sinal um número de GB no lugar do padrão da instância, ou 0 para nenhum limite. Deixe um sinal vazio para manter o padrão da instância.

### Definir os limites de taxa dele

No cartão **Limites de taxa deste projeto**, clique em **Editar limites de taxa** e defina-os da mesma forma: um número de MB por segundo, 0 para nenhum limite, ou vazio para o padrão da instância.
:::

Os membros do projeto veem esses orçamentos na página [Uso de telemetria](/docs/telemetry/usage) deles, em modo somente leitura.

## Dar a uma chave de ingestão um orçamento próprio

O orçamento de uma chave é uma parte do orçamento do projeto dela: um remetente que inunda a própria chave para no orçamento da chave, enquanto as outras chaves do projeto continuam enviando.

:::steps
### Abrir a chave

Acesse **Configurações do projeto → Telemetria e APM → Chaves de ingestão** e clique na chave. **Telemetria e APM** começa recolhido no menu lateral: clique nele para abri-lo.

### Definir os orçamentos dela

No cartão **Orçamentos de ingestão**, clique em **Editar orçamentos de ingestão**. Informe um número de GB por dia para cada sinal a limitar na etapa **Orçamentos diários**, e um número de MB por segundo na etapa **Limites de taxa**. Deixe um sinal vazio para que a chave não tenha orçamento próprio.

### Salvar os orçamentos

Clique em **Salvar alterações**. O orçamento de uma chave não pode ser maior que o do projeto dela: o OneUptime o recusa e diz qual é o máximo permitido.
:::

- **Os dois orçamentos contam.** A telemetria enviada com a chave conta no orçamento da chave e no do projeto, e o que se esgotar primeiro a recusa.
- **Um orçamento de projeto reduzido também limita a chave.** Quando o orçamento do projeto é reduzido abaixo do de uma chave, a chave fica limitada ao do projeto.

## O que os remetentes veem

| Quando | Por HTTP | Por OTLP/gRPC | O que o remetente faz |
| --- | --- | --- | --- |
| Um orçamento diário se esgotou | `403` | `RESOURCE_EXHAUSTED` | Descarta o lote: tentar de novo não adianta antes da redefinição |
| Um limite de taxa foi excedido | `429` com `Retry-After` | `RESOURCE_EXHAUSTED` com um atraso para a nova tentativa | Tenta enviar o lote de novo depois do atraso |

Toda recusa diz o motivo. Por OTLP/HTTP, o corpo dela é um `google.rpc.Status`, em protobuf ou JSON, conforme a requisição foi enviada, então o log do remetente mostra um motivo como:

```text
This project's daily logs ingestion budget of 10 GB is used up, so OneUptime is not storing logs from this project until the budget resets at 2026-11-10 00:00 UTC.
```

- **Outros remetentes HTTP recebem JSON.** Fluent Bit, Fluentd, syslog e os outros endpoints HTTP recebem `error`, `message` e `resetsAt`, e também `retryAfterSeconds` quando é um limite de taxa que recusa.
- **MQTT e as transmissões de nuvem não podem ser avisados.** A telemetria que chega por MQTT ou pela transmissão de um provedor de nuvem é descartada assim que o orçamento dela se esgota. Nenhum limite de taxa se aplica a ela: ela não poderia ser enviada de novo.
- **As recusas são contadas.** O que um orçamento esgotado recusa ou descarta é contado como descartado, e cada requisição que um limite de taxa recusa, como limitada: veja [Ver o uso e os descartes de hoje](#ver-o-uso-e-os-descartes-de-hoje).

## O aviso e a redefinição

- **O aviso.** Quando um orçamento diário passa do limite de aviso, 80% a menos que o administrador da instância o mude, os proprietários do projeto recebem um e-mail, e os exploradores mostram um banner acima dos dados desse sinal. Eles recebem mais um e-mail quando o orçamento se esgota. Cada orçamento envia cada e-mail no máximo uma vez por dia.
- **A redefinição.** Cada dia de orçamento recomeça às 00:00 UTC, a menos que o administrador da instância mude isso. O cartão **Aviso e redefinição** define **Limite de aviso (%)**, de 1 a 99, **Horário de redefinição**, como HH:MM, e **Fuso horário de redefinição**: clique em **Editar aviso e redefinição**.
- **Horário de verão.** A redefinição segue o relógio do fuso horário, então o dia de orçamento em que os relógios mudam fica uma hora mais curto ou mais longo. Um horário de redefinição que os relógios pulam acontece esse mesmo intervalo depois do salto.
- **Mudar a redefinição inicia um novo dia.** Mudar o horário de redefinição ou o fuso horário inicia na hora um novo dia de orçamento, ainda sem nada contado.

## Ver o uso e os descartes de hoje

Acesse **Configurações do projeto → Telemetria e APM → Uso**. Enquanto um orçamento ou um limite de taxa estiver definido para o projeto, a página abre com o cartão **Orçamentos de ingestão**, e as chaves com orçamentos próprios ficam no cartão **Orçamentos das chaves de ingestão**:

| Coluna | O que mostra |
| --- | --- |
| **Sinal** | O sinal a que a linha se refere. |
| **Usado hoje** | O que foi contado desde o início do dia de orçamento, e a parcela do orçamento que isso representa. |
| **Orçamento diário** | O orçamento em vigor, e onde ele foi definido: **Padrão da instância**, **Definido para este projeto** ou **Próprio desta chave**. |
| **Limite de taxa** | O limite de taxa em vigor. |
| **Descartadas** | O que foi recusado ou descartado porque o orçamento se esgotou. |
| **Limitado** | Quantas requisições o limite de taxa recusou. |
| **Status** | **Dentro do orçamento**, **Acima do aviso** ou **Esgotado**, **Sem orçamento diário** para um sinal com apenas um limite de taxa, e **Desconhecido** enquanto as contagens não podem ser lidas. |

- **Na página de uma chave**, o cartão **Uso do orçamento de hoje** mostra o que a chave usou dos próprios orçamentos.
- **Nos exploradores**, um banner acima dos dados de registros, traços, métricas, perfis e eventos de segurança avisa quando o orçamento desse sinal passou do aviso ou se esgotou, com **Ver orçamentos** para abrir a página Uso.
- **No Admin Dashboard**, a página **Orçamentos de ingestão** de um projeto mostra os mesmos números.

## Alertar sobre um orçamento

A cada 5 minutos, o OneUptime grava os números do dia de cada orçamento como métricas do projeto, e um [monitor de métricas](/docs/monitor/metrics-monitor) alerta sobre elas como sobre qualquer outra métrica:

| Métrica | Unidade | O que contém |
| --- | --- | --- |
| `oneuptime.telemetry.budget.used.bytes` | `By` | Os bytes contados no orçamento diário desde o início do dia de orçamento. |
| `oneuptime.telemetry.budget.used.percent` | `%` | O mesmo, como porcentagem do orçamento diário. Em 100 ou mais, o sinal é recusado até a redefinição. |
| `oneuptime.telemetry.budget.dropped.bytes` | `By` | Os bytes recusados ou descartados desde o início do dia de orçamento porque o orçamento se esgotou. |
| `oneuptime.telemetry.budget.throttled.requests` | `{request}` | As requisições que o limite de taxa recusou desde o início do dia de orçamento. |

Cada ponto carrega estes atributos:

| Atributo | Valor |
| --- | --- |
| `projectId` | O ID do projeto. |
| `signal` | `logs`, `traces`, `metrics`, `profiles` ou `security-events`. |
| `scope` | `project`, ou `ingestion-key` para o orçamento próprio de uma chave. |
| `ingestionKeyId` | O ID da chave, para o orçamento próprio de uma chave. |
| `ingestionKeyName` | O nome da chave quando o ponto foi gravado, para o orçamento próprio de uma chave. |

Para ser avisado em 90% do orçamento de registros do projeto, crie um monitor de métricas em `oneuptime.telemetry.budget.used.percent`, filtrado por `signal` `logs` e `scope` `project`, que alerte quando o máximo passar de 90:

- **Agregue pelo máximo.** Cada número só cresce durante um dia de orçamento.
- **Use uma janela de 15 minutos ou mais.** Um ponto é gravado a cada 5 minutos, e uma janela sem nenhum ponto resolve o alerta.
- **Espere lacunas, não zeros.** Nada é gravado para um número que é 0, nem enquanto as contagens não podem ser lidas.
- **Elas não custam nada.** Estas métricas não são contadas em nenhum orçamento nem como uso de telemetria, e são mantidas pelo mesmo tempo que as métricas de monitor: 30 dias, a menos que o administrador da instância mude isso. Os nomes de métricas que começam com `oneuptime.telemetry.budget.` são reservados para elas: as métricas que os seus aplicativos enviam com um nome assim são descartadas.

## Solução de problemas

:::details Um coletor registra 403 nas suas exportações
O orçamento diário do projeto ou da chave para esse sinal se esgotou, e o coletor descarta o que não consegue enviar até o orçamento ser redefinido. Veja **Usado hoje** na página Uso. Peça ao administrador da instância para aumentar o orçamento do projeto, ou envie menos: um filtro de descarte não ajuda aqui, pois remove a telemetria depois que ela é contada.
:::

:::details Um coletor registra 429 e tenta de novo
Ele envia mais rápido do que um limite de taxa permite. Ele tenta de novo depois do atraso de `Retry-After`, então nada se perde, a menos que a fila dele encha. Aumente o limite de taxa, ou distribua o envio de forma mais uniforme.
:::

:::details Usado hoje é maior do que mostra a página Uso de telemetria
Um orçamento conta a telemetria à medida que chega, descomprimida, incluindo o que os filtros de descarte removem depois. A página Uso conta o que foi armazenado, no dia seguinte.
:::

:::details Os orçamentos dizem que não foi possível ler as contagens de hoje
O OneUptime não consegue acessar o Valkey, onde os orçamentos são contados. Até conseguir, a telemetria é armazenada sem ser contada, e nenhum orçamento é aplicado.
:::

## Próximos passos

:::cards
- [Uso de telemetria](/docs/telemetry/usage): Veja o que cada projeto e serviço envia.
- [Filtros de descarte e regras de mascaramento](/docs/telemetry/drop-filters-and-scrub-rules): Pare de armazenar a telemetria de que você não precisa.
- [Chaves de ingestão](/docs/telemetry/ingestion-keys): Uma chave para cada remetente, para que cada um possa ter um orçamento.
- [Monitor de métricas](/docs/monitor/metrics-monitor): Alerte sobre as métricas de orçamento.
:::
