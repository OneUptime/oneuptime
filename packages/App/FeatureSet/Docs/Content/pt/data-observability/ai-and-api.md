# OneUptime AI e a API

O OneUptime AI conhece os seus dados: ele investiga um alerta de dados a partir de quem escreve na tabela, das execuções e da linhagem, responde se uma tabela está atualizada e a partir do que ela é construída onde quer que a pergunta seja feita, e escreve uma verificação a partir de uma regra dita em uma frase. Tudo o que a Observabilidade de dados mostra também está disponível para as suas próprias ferramentas, pelos endpoints, pelas métricas e pelo servidor MCP.

## OneUptime AI

- **Investigações de alertas de dados.** Quando o OneUptime AI investiga um alerta sobre uma tabela, um pipeline ou um banco de dados, ele parte do que está ao redor: a atualidade e os alertas abertos da tabela, o alerta do qual ele é consequência, as execuções dos pipelines que escrevem nela desde o dia anterior (uma execução com falha e o erro dela, ou a execução que nunca veio), os serviços que escrevem nela com as escritas que falharam, implantações e outras mudanças, a linhagem dela (as tabelas a partir das quais ela é construída e as tabelas construídas a partir dela, primeiro as que têm um problema, onde nela está o alerta do qual ele é consequência e em quais tabelas estão os alertas que ele causou) e as colunas que mudaram. Ele aponta a execução, a implantação ou a tabela a montante por trás do alerta. Veja [AI SRE](/docs/ai/ai-sre).
- **Esta tabela está atualizada?** Pergunte no [Pergunte à IA](/docs/ai/ask-ai), no Slack ou no Microsoft Teams: "a tabela orders está atualizada?". A resposta traz a atualidade da tabela pelo próprio ritmo dela, quando ela mudou pela última vez, os alertas abertos, as últimas execuções de quem escreve nela e os produtos de dados de que ela faz parte. Um nome que vários bancos de dados compartilham é respondido para cada um, para que ninguém ouça que a tabela errada está atualizada.
- **A partir do que esta tabela é construída?** Pergunte "o que alimenta a tabela revenue?" ou "o que quebra se raw.orders parar de carregar?". A resposta segue a linhagem da tabela três passos em cada direção, ou até cinco quando pedido, e põe primeiro o que está errado: as tabelas a montante e a jusante que estão atrasadas, foram removidas, têm alertas abertos ou cujo pipeline falhou na última execução, as mais próximas primeiro, cada uma com quantos passos a separam e as tabelas no meio. Depois vêm as demais, os pipelines que carregam as fontes dela de fora do que o OneUptime observa e os painéis de BI construídos sobre ela. Os alertas abertos são contados, nunca nomeados, e só os que a pessoa que pergunta pode ver.
- **Uma verificação a partir de uma frase.** Na aba **Verificações** de uma tabela, **Escrever uma verificação a partir de uma frase** transforma uma regra em uma verificação de SQL personalizado no SQL do seu mecanismo. Veja [Verificações e reconciliações](/docs/data-observability/checks).

- **Deriva lenta.** As linhas de uma tabela, ou o valor de uma verificação, que variam em um quinto ou mais em uma semana, devagar demais para qualquer alerta, vão para o AI Insights como um ponto de atenção. Isso não aciona ninguém.
- **Dados desatualizados por trás de apps de IA.** Um serviço que chama um modelo e também lê uma tabela é o consumidor de IA dessa tabela. Quando essa tabela atrasa, a página **Conversas** do produto de IA avisa: um app que responde com dados antigos não mostra nada de errado nos próprios traces.

Cada um desses recursos exige que o OneUptime AI esteja ativado para o projeto e age com as permissões da pessoa que pergunta.

## Agentes de IA e o servidor MCP

Agentes de IA devem verificar se os dados estão atualizados antes de usá-los, e o que é construído a partir de uma tabela antes de alterá-la. O [servidor MCP](/docs/ai/mcp-server) tem ferramentas somente leitura para as duas coisas:

| Ferramenta | O que ela responde |
| --- | --- |
| `get_data_table_freshness` | Se uma tabela observada está atualizada, quando mudou pela última vez, os alertas abertos dela, as últimas execuções de quem escreve nela e os produtos de dados dela. Informe `table` como `schema.table`, só o nome da tabela ou o ID dela |
| `get_data_table_lineage` | A partir do que uma tabela observada é construída e o que é construído a partir dela, três passos em cada direção ou até cinco: primeiro as tabelas com um problema, as mais próximas primeiro, depois as demais, os pipelines que carregam as fontes dela de fora e os painéis de BI construídos sobre ela. Informe `table` como para a atualidade dela, e `depth` de 1 a 5 |

Elas funcionam com um login somente leitura e respondem como a pessoa ou a chave de API que fez login.

## Endpoints

| Endpoint | Para que serve | Assinado com |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | Eventos do OpenLineage vindos do Airflow, Dagster, Spark, dbt ou Flink | Uma chave de ingestão de telemetria |
| `POST /telemetry/dbt/v1/artifacts` | O `manifest` e os `run_results` de um build do dbt | Uma chave de ingestão de telemetria |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Os webhooks de sincronização do Fivetran | A chave de ingestão, como segredo de assinatura do Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Os webhooks de sincronização do Airbyte | A chave de ingestão na URL |
| `POST /api/data-observability/tables/freshness` | A atualidade de uma tabela, como a ferramenta MCP a responde, com `{ "table": "public.orders" }` | Uma chave de API |
| `POST /api/data-observability/tables/lineage` | A linhagem de uma tabela alguns passos em cada direção, com o estado de cada tabela, como a aba **Linhagem** a desenha, com `{ "dataAssetId": "<table ID>", "depth": 3 }`, e com `"withColumns": true` as colunas que cada seta leva | Uma chave de API |
| `POST /api/data-observability/tables/lineage/answer` | A linhagem de uma tabela contada em palavras, primeiro as tabelas com um problema, como a ferramenta MCP a responde, com `{ "table": "public.orders", "depth": 3 }` | Uma chave de API |
| `POST /api/data-observability/pipelines/lineage` | As tabelas que um pipeline lê e escreve, com o estado de cada uma, como a página dele as desenha, com `{ "dataPipelineId": "<pipeline ID>", "depth": 1 }` | Uma chave de API |
| `POST /api/data-observability/alerts/<alert ID>/lineage` | A linhagem de um alerta de dados, como a página dele a desenha, com o caminho até o alerta que o causou e até os alertas que ele causou | Uma chave de API |
| `POST /api/data-observability/lineage/expand` | As próximas tabelas que um cartão de um diagrama de linhagem não desenha, como selecionar o número dele as desenha: o cartão como `nodeId` com o seu `side`, e o que está desenhado como `focusNodeId`, `tables` e `dataDashboardIds` | Uma chave de API |
| `POST /api/data-observability/checks/apply` | Faz as verificações do projeto corresponderem a um arquivo, como faz `oneuptime data-checks apply`, com `{ "manifest": "...", "isDryRun": true, "shouldPrune": false }` | Uma chave de API |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | O selo "data as of" de um produto de dados | O próprio token do selo |

Tabelas, verificações, reconciliações, pipelines, produtos de dados, conexões de BI e jobs de warehouse também são recursos comuns da [API](/docs/api-reference/api-reference), lidos e alterados com uma chave de API que tenha as permissões correspondentes, e do servidor MCP e dos workflows.

## Métricas

Cada número que a Observabilidade de dados guarda é uma métrica que você pode colocar em um gráfico ou em um dashboard, ou usar para criar alertas: `oneuptime.data.table.*` para cada tabela, `oneuptime.data.check.value` para cada verificação, `oneuptime.data.reconciliation.*` para cada reconciliação, `oneuptime.data.pipeline.*` para cada pipeline e `oneuptime.data.product.*` para cada produto de dados. Elas são dados operacionais do próprio OneUptime e não são cobradas como telemetria.

## Próximos passos

:::cards
- [Servidor MCP](/docs/ai/mcp-server): Conecte um agente de IA ao OneUptime.
- [Observabilidade de dados](/docs/data-observability/index): De volta à visão geral.
:::
