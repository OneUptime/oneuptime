# Gatilhos

Um gatilho é o nó inicial de um workflow. Ele não tem porta de entrada — a execução começa aqui. O OneUptime suporta quatro famílias de gatilhos; cada workflow usa exatamente um.

## Manual

Execute um workflow sob demanda clicando em **Run Manually** na página do workflow. Você pode colar um payload JSON opcional que o workflow consegue ler como `{{Manual.JSON}}`.

Use isso quando quiser um botão que dispara um pedaço de automação — um workflow de "rotacionar a chave de plantão" ou "reconstruir o índice de busca" em um clique, sem precisar de agendamento recorrente ou de um evento para disparar.

**Argumentos**: nenhum.

**Valores de retorno**:

| Nome | Tipo | Descrição |
| --- | --- | --- |
| `JSON` | JSON | O payload JSON fornecido no momento da execução, ou um objeto vazio. |

## Schedule

Execute um workflow em uma agenda cron. Configure a cadência com uma expressão cron padrão.

Use para tarefas recorrentes: limpeza noturna, sincronização horária, exportação semanal.

**Argumentos**:

| Nome | Tipo | Descrição |
| --- | --- | --- |
| `Schedule at` | CronTab | Expressão cron padrão de 5 campos. Por exemplo, `0 * * * *` roda no início de cada hora, `*/5 * * * *` a cada cinco minutos. |

**Valores de retorno**:

| Nome | Tipo | Descrição |
| --- | --- | --- |
| `executedAt` | Date | O horário de execução agendado. |

Workflows agendados rodam no Workflow Worker na região do projeto. Se o worker estiver brevemente indisponível, a execução é despachada quando ele se recuperar — você não precisa se defender contra ticks perdidos em interrupções curtas.

## Webhook

Exponha uma URL HTTPS única para a qual um sistema externo faz `POST`. Os cabeçalhos, parâmetros de consulta e corpo da requisição ficam expostos como valores de retorno para os componentes a jusante consumirem.

Use para receber dados *para dentro* do OneUptime a partir de um sistema de terceiros: callbacks de CI/CD, alertas de outra ferramenta de monitoramento, cadastros de clientes no seu CRM.

**Argumentos**: nenhum. A URL é alocada automaticamente quando o workflow é salvo e mostrada no nó do gatilho. Trate como um segredo — qualquer pessoa com a URL pode disparar o workflow.

**Valores de retorno**:

| Nome | Tipo | Descrição |
| --- | --- | --- |
| `Request Headers` | JSON | Todos os cabeçalhos da requisição HTTP recebida. |
| `Request Query Params` | JSON | Query string parseada. |
| `Request Body` | JSON | Corpo da requisição parseado. Se o corpo não for um JSON válido, ele chega como string sob a chave `raw`. |

O webhook aceita `GET` e `POST`. A resposta para quem chamou é um `200 OK` com um JSON de reconhecimento assim que a execução é enfileirada — o workflow em si roda de forma assíncrona, então não espere ler o resultado dos componentes a jusante na resposta HTTP.

## Gatilhos de evento de modelo

Quase toda entidade do OneUptime — monitores, incidentes, alertas, eventos de manutenção programada, páginas de status, políticas de plantão, equipes, serviços de telemetria e muitos outros — expõe três gatilhos:

- **On Create** — dispara quando um novo registro desse tipo é criado.
- **On Update** — dispara quando um registro existente é alterado. O gatilho expõe tanto os valores antigos quanto os novos.
- **On Delete** — dispara quando um registro é excluído.

É assim que você constrói automação do tipo "quando X acontece no OneUptime, faça Y" sem polling.

O próprio modelo é exposto como valor de retorno com os mesmos nomes de campo que você vê no recurso. Por exemplo, o gatilho **Incident → On Create** retorna o objeto `Incident` completo para que os nós a jusante consigam ler `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` etc.

**Argumentos**: tipicamente nenhum para create/delete. Gatilhos de update podem permitir restringir os campos aos quais você quer reagir, para não disparar em alterações cosméticas.

**Valores de retorno** (variam conforme o modelo):

| Nome | Tipo | Descrição |
| --- | --- | --- |
| Campos do modelo | (varia) | Toda coluna da entidade — nome, status, timestamps, chaves estrangeiras. |
| `previous` (apenas Update) | JSON | O registro como estava antes da alteração. |

### Gatilhos de modelo comuns

Uma lista não exaustiva dos eventos de modelo que os times mais usam:

- **Incident** — `On Create`, `On Update` (use para reagir a mudanças de estado como Acknowledged ou Resolved), `On Delete`.
- **Alert** — os mesmos três eventos no modelo de alerta.
- **Monitor** — reaja quando um monitor é adicionado, editado ou removido; combine com condições para agir apenas em monitores de produção.
- **Scheduled Maintenance** — automatize anúncios a jusante quando uma janela de manutenção é criada ou o estado dela muda.
- **Status Page Subscriber** — dispare um fluxo de boas-vindas quando alguém se inscreve.
- **On-Call Duty Policy** — sincronize mudanças de escala com uma escala externa.

Se o modelo é exposto na API do OneUptime, é quase certo que ele pode disparar um workflow — pesquise a paleta de gatilhos pelo nome da entidade.

## Escolhendo o gatilho certo

| Se você quer… | Use |
| --- | --- |
| Construir um botão em um workflow para alguém clicar | **Manual** |
| Rodar uma tarefa a cada N minutos/horas/dias | **Schedule** |
| Fazer um sistema externo enviar dados para o OneUptime | **Webhook** |
| Reagir a algo que acontece *dentro* do OneUptime | **Evento de modelo** |

Workflows só podem ter um gatilho. Se você precisa que dois sinais de início diferentes compartilhem a maior parte da mesma lógica, fatore os passos compartilhados em um workflow e o chame a partir de dois workflows "wrapper" finos usando o componente **Execute Workflow** (consulte [Componentes](/docs/workflows/components)).

## O que ler a seguir

- [Componentes](/docs/workflows/components) — as ações que você conecta depois do gatilho.
- [Variáveis](/docs/workflows/variables) — como ler os valores de retorno do gatilho a partir dos nós a jusante.
- [Execuções e registros](/docs/workflows/runs-and-logs) — como confirmar que seu gatilho está disparando.
