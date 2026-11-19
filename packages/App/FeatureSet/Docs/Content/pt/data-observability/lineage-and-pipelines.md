# Linhagem e pipelines

A linhagem diz a partir de quais tabelas cada tabela é construída e quais pipelines escrevem nela. A Observabilidade de dados a reúne de seis lugares ao mesmo tempo - eventos do OpenLineage, dbt, sincronizações do Fivetran e do Airbyte, jobs nos seus traces, views e o próprio histórico de consultas de cada banco de dados - e a usa para ligar cada tabela atrasada ou quebrada à execução por trás dela, para que um problema abra um só alerta.

## De onde vem a linhagem

| Origem | O que ela fornece |
| --- | --- |
| **OpenLineage** | Cada execução de um job do Airflow, Dagster, Spark, dbt ou Flink, e as tabelas que ele leu e escreveu |
| **dbt** | A partir de que cada modelo é construído, cada build como uma execução, e o resultado de cada teste |
| **Fivetran e Airbyte** | Cada sincronização como uma execução do seu conector, e as tabelas brutas que ela carrega |
| **Jobs nos seus traces** | Um CronJob do Kubernetes ou uma função agendada, as suas execuções, e as tabelas que as chamadas de banco de dados dele leram e escreveram |
| **Views** | Uma view é construída a partir das tabelas sobre as quais é definida (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, views materializadas do ClickHouse, Databricks, MongoDB) |
| **Histórico de consultas** | Uma consulta que leu uma tabela e escreveu em outra (o histórico de acessos do Snowflake, os jobs do BigQuery, o log de consultas do Redshift, o log de consultas do ClickHouse, a tabela de linhagem do Databricks) |

A aba **Linhagem** de uma tabela mostra as tabelas a partir das quais ela é construída, os pipelines que escrevem nela com a última execução de cada um, e as tabelas construídas a partir dela. Cada aresta diz onde foi vista.

No topo da aba, um diagrama desenha essa linhagem alguns passos em cada direção (três, ou escolha 1, 2 ou 5): à esquerda, aquilo a partir do qual a tabela é construída; à direita, as tabelas e os painéis construídos a partir dela; e os pipelines que carregam dados de fora, onde eles entram. Cada cartão diz como está agora - atrasada, um alerta aberto, uma execução com falha - e uma seta fica vermelha quando a última execução do seu pipeline falhou, para que uma tabela atrasada possa ser seguida até a execução que a travou. Abra qualquer tabela para centralizar o diagrama nela.

Um cartão desenha no máximo dez tabelas em cada direção e conta o restante, como **+14**. Selecione o número para desenhar até mais dez delas onde estão, primeiro as com problemas, com cada seta entre elas e o que já está desenhado. **Redefinir diagrama** volta ao diagrama como foi desenhado no início. Quando um lado tem tantas tabelas quanto um diagrama comporta, abra uma tabela para centralizar o diagrama nela.

Quando a origem nomeia colunas, a aba **Colunas** de uma tabela diz de onde vem cada coluna e o que ela alimenta: o histórico de acessos do Snowflake (edição Enterprise, que exige `IMPORTED PRIVILEGES` no banco de dados `SNOWFLAKE`) e a faceta `columnLineage` do OpenLineage.

Na aba **Linhagem**, escolha uma coluna da tabela em **Seguir uma coluna** para destacar de onde ela vem e para onde vai: subindo o diagrama até as colunas a partir das quais é construída, descendo até as colunas construídas a partir dela, cada uma nomeada na sua tabela, mesmo onde foi renomeada no caminho. Uma seta cujas origens não nomeiam colunas pode levá-la além do que está destacado, e o diagrama avisa.

Cada visão da linhagem - a guia **Linhagem** de uma tabela, a de um pipeline, a de um alerta, o **Mapa de linhagem** e o que o OneUptime AI e a API dizem - mostra só as tabelas e os pipelines que sua função pode ler. Uma função limitada ao que seus membros possuem, ou a alguns rótulos, nunca vê outra tabela ou outro pipeline: ele não é desenhado, não é nomeado em nenhuma seta e não é contado entre as tabelas mais distantes.

## Mapa de linhagem

**Observabilidade de dados > Mapa de linhagem** desenha em uma só página cada fluxo de dados que o seu projeto viu, para que você veja quem usa quais dados e para onde eles vão sem precisar antes escolher uma tabela. Ele mostra:

- **Serviços** que escrevem e leem tabelas, a partir dos spans de banco de dados nos seus traces: um span que nomeia a sua tabela (`db.collection.name`, ou o mais antigo `db.sql.table`) e a sua instrução (`db.operation.name`), como um `INSERT` ou um `SELECT`.
- **Tabelas** construídas a partir de outras tabelas, de todas as fontes acima.
- **Pipelines** que carregam uma tabela a partir de dados que o OneUptime não monitora, como uma sincronização do Fivetran. Um pipeline que move dados entre duas tabelas monitoradas é nomeado na seta entre elas.
- **Painéis** e sincronizações de reverse ETL nas suas ferramentas de BI, que leem as tabelas sobre as quais são construídos, mesmo quando nada mais toca essas tabelas. Um relatório do Power BI que não é construído sobre nenhuma tabela que o OneUptime monitora é desenhado com os conjuntos de dados que ele representa e as fontes de dados de onde eles carregam; quando nenhum dos painéis de uma ferramenta de BI está sobre uma tabela monitorada, o mapa diz por quê ([Linhagem do Power BI](#linhagem-do-power-bi)).

Cada seta é algo que o OneUptime registrou, nunca um palpite. Os cartões ficam da esquerda para a direita conforme os dados fluem e mostram o seu estado como no diagrama de uma tabela: vermelho para uma tabela atrasada, um alerta aberto ou uma execução com falha. Uma seta fica verde-azulada onde os traces de um serviço a viram.

Pesquise uma tabela, um serviço, um pipeline ou um painel para manter o que corresponde e tudo o que está acima e abaixo dele no fluxo. Selecione um cartão para destacar toda a linhagem dele, ver de onde ele vem e para onde vai, e abrir a página dele; **Mostrar só a linhagem dela** deixa só isso no mapa. As chaves ao lado da pesquisa deixam de fora serviços, pipelines ou painéis. **Lista** mostra cada seta como uma linha, e é o que um celular abre.

Um mapa desenha até 400 cartões, começando pelos fluxos vistos mais recentemente; quando o seu projeto tem mais, o mapa avisa. O mesmo mapa é servido por `POST /api/data-observability/lineage/map`, para quem puder ler os ativos de dados, e as chaves de API deles. Um mapa com mais diz quantas tabelas deixou de fora, cada uma contada uma vez, e pode começar em outro lugar: escolha um banco de dados para mapear os fluxos das tabelas dele e os cartões que eles ligam, ou digite um nome e escolha **Pesquisar em todo o projeto** para mapear os fluxos de cada tabela, pipeline, serviço e painel cujo nome o contém, por mais antigos que sejam. **Mostrar o mapa inteiro** volta. Para começar o mapa da API em outro lugar, envie `{ "dataStoreId": "<database ID>" }` ou `{ "search": "orders" }`.

## OpenLineage

Envie eventos do OpenLineage ao OneUptime, sem alterações, com uma [chave de ingestão](/docs/telemetry/ingestion-keys) de telemetria:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (em um OneUptime auto-hospedado, o seu próprio endereço)
- **Endpoint:** `api/v1/lineage`, o padrão do OpenLineage
- **Chave de API:** a chave de ingestão, enviada como `Authorization: Bearer`, ou defina `x-oneuptime-token`

Para o provedor OpenLineage do Airflow:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

Para qualquer outro cliente OpenLineage, defina `OPENLINEAGE_URL` e `OPENLINEAGE_API_KEY`. Os datasets são associados a tabelas pela especificação de nomes do OpenLineage, como `postgres://host:5432` com `database.schema.table`, `snowflake://account` com `database.schema.table`, `clickhouse://host:8443` com `database.table` e `databricks://workspace-host` com `catalog.schema.table`.

## dbt

Depois de `dbt build` (ou run, test, seed ou snapshot), envie os artefatos do projeto com a [CLI do OneUptime](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

No CI, execute `oneuptime dbt upload` como a etapa seguinte ao build, mesmo quando o build falha, para que os testes com falha sejam registrados. Cada tabela que o dbt constrói ganha um cartão **dbt** na Visão geral dela, a linhagem dos seus modelos e os testes dela na aba **Verificações**; cada build é uma execução do pipeline do projeto.

## Fivetran e Airbyte

Os webhooks deles dizem quando cada sincronização começa e termina. **Pipelines > Conectar Fivetran ou Airbyte** preenche as URLs com uma das suas chaves de ingestão:

- **Fivetran:** um webhook criado com a API REST do Fivetran, para os eventos `sync_start` e `sync_end`, apontando para `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, com a chave de ingestão como segredo. O Fivetran assina cada entrega com ela, então a chave nunca trafega na URL.
- **Airbyte:** o webhook do workspace definido como `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, ativado para sincronizações com falha e bem-sucedidas. Dê ao Airbyte uma chave só dele.

Uma sincronização do Fivetran reagendada por causa do limite de taxa de uma API termina como **Reagendada**: não é uma falha, então não aciona ninguém.

## Jobs nos seus traces

Muitos pipelines são um CronJob do Kubernetes, ou uma função em um temporizador, sem nenhum agendador para enviar linhagem. Os traces deles dizem tudo do mesmo jeito, sem nada para instalar. A cada quinze minutos, os spans com o atributo de recurso `k8s.cronjob.name` ou `k8s.job.name`, ou `faas.name` com um `faas.trigger` de `timer` ou `datasource`, viram um pipeline em **Pipelines**:

- Uma execução de um CronJob é o Job do Kubernetes dele, e uma execução de uma função é o seu `faas.invocation_id`.
- Uma execução falhou quando o span no topo do trace dela falhou. Uma chamada que falhou e foi repetida dentro dela não a faz falhar.
- As tabelas que ela escreveu e leu vêm dos spans de banco de dados dela.

Cada execução tem um link para o seu trace, com os logs dela. Valem os mesmos três monitores, então um CronJob que para de rodar é visto como atrasado.

## Painéis em ferramentas de BI

O impacto real de dados ruins é o painel que alguém abre. Em **Painéis de BI**, adicione suas ferramentas de BI com credenciais que possam ler os painéis delas. A cada hora, a Observabilidade de dados lê cada painel e as tabelas por trás dele, associa cada tabela a uma monitorada e mostra os painéis construídos sobre uma tabela, e sobre as tabelas construídas a partir dela, na aba **Linhagem**, nos alertas e no Production Review.

| Ferramenta | Credenciais |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, uma entidade de serviço autorizada a usar as APIs de administração somente leitura do Power BI, com as duas configurações de locatário sobre metadados de [Linhagem do Power BI](#linhagem-do-power-bi) ativadas para as tabelas por trás de cada relatório. Relatórios e painéis são lidos, com suas visualizações e atualizações (abaixo) |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (ou `eu`) |

Hightouch e Census são ferramentas de ETL reverso: uma sincronização que copia uma tabela para um CRM depende dessa tabela como um painel depende, então é lida do mesmo modo e citada nos alertas da tabela.

Somente nomes e links dos painéis, as tabelas que eles consultam e, no Power BI, quem os abre e como foram suas atualizações são lidos: nunca seus dados.

### Visualizações e atualizações no Power BI

Para cada relatório e painel do Power BI, **Painéis de BI** mostra primeiro quantas vezes ele foi aberto nos últimos 28 dias, quando foi aberto pela última vez e como foi a última atualização dos seus dados, com o erro de uma atualização que falhou. Quantas pessoas o abriram, quem mais o abriu e suas últimas atualizações são colunas que você pode ativar. A aba **Linhagem** de uma tabela diz o mesmo de cada painel construído sobre ela, com seu proprietário e seus visualizadores em **Mais**.

- As **visualizações** vêm do log de atividades do Power BI, lido pela sua API de administração de eventos de atividade. O Power BI guarda 28 dias dele, responde a 200 solicitações por hora e divide cada solicitação em horas, então o OneUptime o lê uma hora por vez: cada leitura de hora em hora acrescenta as horas desde a anterior e depois volta pelos 28 dias, das mais recentes para as mais antigas, com no máximo 100 solicitações. Uma nova ferramenta do Power BI mostra logo os últimos dias, e os 28 dias em até um dia; até lá, as visualizações dizem desde quando são contadas. Um evento pode levar até uma hora para chegar ao log, então as visualizações ficam até duas horas atrasadas. Os visualizadores são identificados como o Power BI os identifica, pelo endereço de e-mail.
- As **atualizações** de conjuntos de dados em uma capacidade (Premium, Premium por Usuário ou Fabric) vêm da lista de administração de itens atualizáveis do Power BI: a última atualização de cada conjunto de dados com seu erro, e quantas atualizações foram executadas e falharam nos sete dias que o Power BI guarda.
- As **atualizações de conjuntos de dados em capacidade compartilhada** não estão nessa lista. O Power BI mostra o histórico de atualizações de um conjunto de dados somente a quem pode alterá-lo, então adicione a entidade de serviço ao workspace dele como **Colaborador**, **Membro** ou **Administrador** e ative para ela **Service principals can call Fabric public APIs** nas configurações de desenvolvedor do portal de administração do Fabric. O OneUptime então lê cada atualização, com seu erro. Até lá, a ferramenta de BI diz de quantos conjuntos de dados não conseguiu ler as atualizações.
- Um painel do Power BI cujos blocos vêm de vários conjuntos de dados mostra a última atualização que falhou ou, se nenhuma falhou, a mais antiga: seus dados só são tão recentes quanto ela.

As visualizações, e as atualizações em capacidades, não precisam de nada além do acesso às APIs de administração acima: a entidade de serviço em um grupo de segurança permitido por **Service principals can access read-only admin APIs**, sem permissões do Power BI no aplicativo que exijam consentimento do administrador. Quando visualizações ou atualizações não podem ser lidas, os painéis ainda são lidos e mantidos, a ferramenta de BI diz o que foi ignorado e por quê, e a próxima leitura tenta de novo.

### Alertas de atualizações com falha

Ative **Alert on Failed Refreshes** ao adicionar ou editar uma ferramenta Power BI (uma nova já começa com a opção ativada) e o OneUptime mantém um monitor para a ferramenta em **Monitores**, com o nome dela. O monitor abre um alerta para cada conjunto de dados cuja última atualização falhou ou foi cancelada, com o conjunto de dados e o workspace dele no título do alerta, e o resolve assim que uma atualização posterior é concluída. Um conjunto de dados publicado depois passa a ser vigiado assim que é lido. Desativar a chave, ou remover a ferramenta, remove o monitor; até lá, ele é um monitor comum, com seus responsáveis, políticas de plantão e janelas de manutenção.

Atualizações com falha não usam os monitores de pipeline. Um conjunto de dados cuja atualização falhou continua mostrando os dados da sua última atualização concluída até que uma posterior seja concluída, então o alerta dele fica aberto até lá, enquanto o alerta de uma execução com falha se fecha uma hora depois da execução. E as atualizações são lidas uma vez por hora: uma atualização lida até uma hora depois de terminar cairia muitas vezes fora da hora que o **Pipeline Run Failed** olha, um conjunto de dados atualizado a cada meia hora viraria **Pipeline Is Late** sem parar, e uma atualização terminada mas ainda não lida pareceria **Pipeline Run Unusually Long**.

- Cada leitura de hora em hora guarda os conjuntos de dados cuja última atualização terminada falhou ou foi cancelada. A cada cinco minutos, cada um escreve `oneuptime.data.bi.refresh_failed`, 1 enquanto falha e 0 durante a hora seguinte à conclusão de uma atualização posterior, e o monitor lê esse valor, de modo que uma falha abre um único alerta, não importa quantas leituras de hora em hora a vejam.
- Uma falha é vista na leitura seguinte: o alerta dela abre até uma hora depois de a atualização falhar e é resolvido até uma hora depois de uma atualização posterior ser concluída.
- Uma atualização ainda em andamento não muda nada: o alerta de um conjunto de dados cuja atualização falhou continua aberto enquanto a próxima atualização roda, e só é resolvido quando uma atualização é concluída.
- Em uma capacidade, a lista de itens atualizáveis do Power BI traz só a última atualização de cada conjunto de dados, então uma atualização que falhou e foi seguida por uma concluída dentro da mesma hora nunca é vista: a essa altura, os dados já estão atualizados de novo.
- Conjuntos de dados em capacidade compartilhada só geram alertas onde as atualizações deles podem ser lidas (acima), e um conjunto de dados cujas atualizações não puderam ser lidas mantém o alerta como estava até que possam.

## Pipelines

Cada job, projeto dbt e sincronização aparece em **Pipelines**, com as suas execuções: quando cada uma começou e terminou, quanto tempo levou, qual tentativa ela foi onde o agendador informa (o número da tentativa do Airflow) e o erro de uma execução com falha. Depois de cinco execuções, cada pipeline aprende com as próprias execuções quanto tempo uma execução costuma levar e quanto tempo ele costuma ficar entre execuções no seu agendamento. A página de um pipeline recomenda três monitores:

- **Pipeline Run Failed**: uma execução falhou ou foi abortada.
- **Pipeline Run Unusually Long**: uma execução levou o dobro do tempo típico ou mais, verificado a cada cinco minutos enquanto ela roda, para que uma execução travada seja notada antes de terminar.
- **Pipeline Is Late**: nenhuma execução começa há mais tempo do que o agendamento dele permite.

A aba **Proprietários** de um pipeline nomeia as pessoas e equipes que cuidam dele, e os alertas dele vão para elas. A **Visão geral** e **Problemas** nomeiam os proprietários de um pipeline que falhou ou está atrasado, ou mostram **Sem proprietário**, com uma forma de adicionar um.

As **Regras de proprietário** podem nomear por você os proprietários de um pipeline. Na guia **Regras de pipeline**, uma regra compara um pipeline por uma expressão regular com o nome dele, como `orders_daily.load_orders`, ou com o namespace dele, onde ele é executado, como `airflow://prod`, e adiciona as pessoas e equipes dela como proprietárias do pipeline quando o OneUptime vê o pipeline pela primeira vez. Para adicioná-las aos pipelines que você já tem, abra a regra e selecione **Executar agora**.

A página de um pipeline desenha a **Linhagem** dele, o primeiro lugar para olhar quando uma execução falha ou atrasa: à esquerda, as tabelas que ele lê; à direita, as tabelas que ele escreve; no meio, o pipeline; e cada cartão diz como está agora. Escolha mais passos para ver a partir do que essas tabelas são construídas e o que é construído a partir delas, e abra qualquer tabela para ver a própria aba **Linhagem** dela. Um número de tabelas não desenhadas, no cartão do pipeline ou no de uma tabela, desenha mais delas no lugar aqui também. Escolha uma das colunas que ele grava para segui-la através do pipeline: para cima até a coluna de cada tabela lida a partir da qual ela foi construída, e para baixo até cada tabela em que ele a grava.

## Disjuntores

Uma verificação com falha ou uma tabela atrasada avisa seus proprietários, mas os pipelines que leem a tabela continuariam sendo executados e copiariam os dados ruins adiante. Um disjuntor os para antes: a primeira etapa do pipeline pergunta ao OneUptime se as tabelas que ele lê estão saudáveis, e o resto só é executado quando a resposta é go.

- Uma verificação com falha de uma tabela que o pipeline lê sempre o para: uma verificação com o alerta aberto, ou um teste do dbt que falhou.
- Uma tabela atrasada também o para assim que **Parar quando uma tabela que ele lê estiver atrasada** é ativado, na página **Disjuntor** do pipeline. Fica desativado em todo pipeline, porque uma tabela atrasada pode significar apenas um dia tranquilo.
- Uma verificação que não pôde ser executada ou ainda não foi executada, e uma tabela sem verificações, não param nada.

A etapa pergunta com uma chave de API do projeto que possa ler Observabilidade de dados, e nomeia o pipeline como `namespace/name`, só pelo nome ou pelo ID. O disjuntor lê da linhagem do pipeline as tabelas que ele lê. Uma requisição também pode nomear `tables`, ou somente elas, cada uma como `schema.table`, só pelo nome ou pelo ID; um nome que não corresponde a nenhuma tabela volta em `notFound`, e nunca conta como uma tabela que passou. Só são julgadas as tabelas que a chave de API pode ler.

```bash
curl -sSf https://oneuptime.com/api/data-observability/circuit-breaker \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "airflow://prod/orders_daily.load_orders", "failWithStatusCode": true}'
```

O `verdict` da resposta é `go` ou `stop`. `reasons` lista cada verificação com falha com sua tabela, e cada tabela atrasada com o atraso dela; `tables` lista cada tabela julgada; e `answer` diz o mesmo em poucas frases, para o log da etapa. Com `failWithStatusCode`, uma parada responde HTTP 412, então o `curl -f` faz a etapa falhar. Envie `stopsOnLateTables` como `true` ou `false` para decidir em uma única requisição, e `dryRun` como `true` para perguntar sem que a resposta seja guardada.

No Airflow, coloque um `ShortCircuitOperator` antes das tarefas que leem as tabelas: quando a função dele retorna false, todas as tarefas depois dele são puladas.

```python title="orders_daily.py"
import os

import requests
from airflow.operators.python import ShortCircuitOperator


def inputs_are_healthy() -> bool:
    response = requests.post(
        "https://oneuptime.com/api/data-observability/circuit-breaker",
        headers={"ApiKey": os.environ["ONEUPTIME_API_KEY"]},
        json={"pipeline": "airflow://prod/orders_daily.load_orders"},
        timeout=30,
    )
    response.raise_for_status()
    answer = response.json()
    print(answer["answer"])
    return answer["verdict"] == "go"


check_inputs = ShortCircuitOperator(
    task_id="check_inputs",
    python_callable=inputs_are_healthy,
)

check_inputs >> load_orders
```

Os hooks `on-run-start` do dbt executam SQL no seu warehouse, não requisições web, então pergunte na etapa que inicia o dbt: um job de CI, uma linha de cron ou a tarefa que o executa. O pipeline de um projeto do dbt se chama `dbt/` seguido do nome do projeto.

```bash
curl -sSf https://oneuptime.com/api/data-observability/circuit-breaker \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "dbt/analytics", "failWithStatusCode": true}' \
  && dbt build
```

Uma requisição que nomeia um pipeline é guardada nele, a menos que seja um teste. Enquanto o disjuntor mantiver um pipeline parado, a página **Disjuntor** dele diz desde quando e por quê, a **Visão geral** dele abre com a parada, e **Requer atenção** e **Problemas** o listam como parado, no lugar da execução com falha ou atrasada. A parada termina quando o disjuntor responde go novamente, ou quando uma execução começa depois dela. A mesma página tem **Testar agora**, que pergunta ao disjuntor sem que a resposta seja guardada, e a etapa para curl, Airflow e dbt com o nome do pipeline já preenchido.

Enquanto a Observabilidade de dados estiver desativada no servidor, o disjuntor responde go e não guarda nada: desativar um produto nunca para um pipeline.

## Um alerta por causa

Quando uma tabela fica desatualizada, todas as tabelas construídas a partir dela também ficam. Antes que um alerta de dados seja aberto, o OneUptime procura na linhagem um alerta já aberto sobre aquilo a partir do qual a tabela ou o pipeline dele é construído: as tabelas a montante, os pipelines que escrevem nelas e os bancos de dados em que elas ficam, até cinco níveis acima. Quando encontra um, o novo alerta é consequência desse alerta:

- Ele começa **confirmado**, para que ninguém seja acionado duas vezes por um só problema, e se recupera sozinho assim que os dados dele se recuperam.
- O feed dele e o cartão **Dados** dele dizem qual alerta o causou, e ele entra no episódio da causa.

O cartão **Dados** da causa lista o **Impacto a jusante** dela: cada alerta que ela causou. O cartão de um alerta de tabela também mostra os serviços que escrevem na tabela, com as escritas que falharam, e as implantações e outras mudanças deles no dia anterior ao alerta.

Abaixo do cartão **Dados**, a página de um alerta desenha a **Linhagem** dele: em torno da tabela dele, como a aba **Linhagem** da tabela a desenha, ou em torno do pipeline dele. O caminho para cima até o alerta que o causou e para baixo até cada alerta que ele causou fica destacado - a tabela ou o pipeline da causa marcado como **Causa**, os de cada alerta causado como **Consequência** - e o resto esmaece, para que quem o abre veja em que ponto da cadeia o problema começou. Quando a causa está em um pipeline desenhado sobre uma seta, a seta mostra **Causa** abaixo do nome do pipeline. Quando a causa é sobre um banco de dados inteiro, ou está mais acima do que o diagrama alcança, o cartão diz isso em palavras. Um alerta de uma verificação sobre uma única coluna, como uma verificação Porcentagem de nulos em `customer_id`, abre com essa coluna seguida ao lado desses caminhos, como na aba **Linhagem** da tabela: de onde ela vem e para onde vai, nomeada em cada tabela. Escolha ali outra coluna da tabela, ou limpe a seleção para ver só os caminhos. **Explorar linhagem** abre a aba **Linhagem** da tabela, ou a página do pipeline. Um alerta causado por ele em um pipeline desenhado em uma seta diz **Consequência** ali da mesma forma, e o seletor de colunas oferece primeiro a coluna da verificação e depois as outras colunas da tabela na ordem dela.

Quem não pode ver o alerta que o causou não recebe nem o cartão **Dados** nem a linhagem, e um alerta causado que essa pessoa não pode ver não é destacado nem contado.

## Linhagem do Power BI

**Tabelas correspondentes**, em cada ferramenta de BI, diz sobre quantas tabelas monitoradas os painéis dela são construídos e, abaixo, a primeira coisa que impede as demais de corresponderem. **See Why** lista o que a última leitura encontrou e o que fazer: bancos de dados que os seus painéis leem e que não estão conectados ao OneUptime, cada um a um **Connect Database** de distância, com o tipo e o endereço já preenchidos; tabelas que um banco de dados conectado não monitora, que podem ter ficado de fora da verificação dele ou ainda não ter sido coletadas; e fontes que não são um banco de dados, como arquivos e páginas da web. No Power BI, também nomeia uma configuração de locatário desativada, conjuntos de dados que leem de fluxos de dados e conjuntos de dados que o Power BI não consegue descrever. **Baseado em**, em cada painel, diz os conjuntos de dados que ele representa e de onde vêm os dados deles, como o Power BI diz.

O OneUptime lê cada conjunto de dados do Power BI a partir da verificação de metadados do Power BI, com o Power Query por trás de cada uma das tabelas dele:

- **O banco de dados que um conector nomeia**: SQL Server e Azure SQL (`Sql.Database`), PostgreSQL, MySQL, Oracle, Amazon Redshift, Snowflake, Google BigQuery, Databricks, Amazon Athena e Microsoft Dataverse, e o esquema e a tabela que a navegação dele escolhe.
- **O SQL que uma consulta executa**: a opção **SQL statement** de um conector, `Value.NativeQuery` e `Odbc.Query`, e as tabelas depois de cada `FROM` e `JOIN`.
- **Parâmetros e consultas compartilhadas**: um parâmetro vale onde quer que seja nomeado, e uma tabela que lê uma consulta de preparo lê o que essa consulta lê.
- **Modelos compostos** representam as tabelas dos conjuntos de dados sobre os quais são construídos.

Um relatório representa as tabelas do seu conjunto de dados, e um painel as dos conjuntos de dados dos seus blocos. De onde vêm os dados - o servidor e o nome de um banco de dados, o caminho de um arquivo, um endereço da web - vem das fontes de dados da verificação, que não precisam de nada além do acesso às APIs de administração acima.

O Power BI só retorna as tabelas de um conjunto de dados depois que um administrador do Fabric ativa duas configurações de locatário no portal de administração, em **Tenant settings > Admin API settings**, para o grupo de segurança que contém a entidade de serviço:

- **Enhance admin APIs responses with detailed metadata**: as tabelas de cada conjunto de dados.
- **Enhance admin APIs responses with DAX and mashup expressions**: as consultas que as carregam, que dizem quais tabelas de banco de dados elas leem.

O Power BI então descreve um conjunto de dados depois que ele é atualizado ou republicado; um que só usa DirectQuery, depois que alguém abre um relatório sobre ele. Ele nunca descreve conjuntos de dados em tempo real, conjuntos de dados com conexão dinâmica ao Analysis Services, pastas de trabalho do Excel nem conjuntos de dados com mais de 1 GB em capacidade compartilhada. Um conjunto de dados que lê de um fluxo de dados é lido até o fluxo de dados: o OneUptime ainda não lê quais tabelas um fluxo de dados carrega.

Cada tabela é associada a uma tabela monitorada pelo nome, pelo esquema e pelo banco de dados, e um servidor pelo nome curto ou pelo nome completo. Uma tabela de outro mecanismo nunca é associada, nem uma de outro banco de dados: um relatório sobre `Sales.dbo.Orders` não é ligado a `Archive.dbo.Orders` porque só `Archive` é monitorado.

As [atualizações](#visualizações-e-atualizações-no-power-bi) são lidas à parte das tabelas: um aviso de que as atualizações de alguns conjuntos de dados não puderam ser lidas não diz nada sobre as tabelas deles.

## Antes de uma alteração ser mesclada

Quando um pull request altera uma tabela observada, o [Production Review](/docs/ai/ai-agent) diz no pull request o que depende dela: os serviços que a leem, as tabelas construídas a partir dela, os painéis sobre ela e os produtos de dados dela. Uma tabela com uma cópia em um banco de dados marcado como Staging também diz como a cópia difere: as linhas, as colunas e o que as verificações da tabela leem lá, executadas na hora. Em um banco de dados que só uma sonda alcança, as verificações ficam de fora, e ele avisa.

## Próximos passos

:::cards
- [Produtos de dados](/docs/data-observability/data-products): SLAs de atualização sobre as tabelas que as pessoas usam.
- [OneUptime AI e a API](/docs/data-observability/ai-and-api): Investigações que partem de quem escreve em uma tabela e das execuções dela. Pelo Pergunte à IA e por agentes de IA, é possível perguntar a partir do que uma tabela é construída.
:::
