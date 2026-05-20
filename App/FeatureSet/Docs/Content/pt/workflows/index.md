# Visão geral dos workflows

Workflows são o construtor visual de automação do OneUptime. Arraste um gatilho para o canvas, conecte-o a uma cadeia de ações — chamadas HTTP, mensagens no Slack, trechos de JavaScript, ramificações condicionais, consultas em banco de dados — e você terá uma automação que roda sempre que um evento no OneUptime (ou no mundo externo) acontece.

Se runbooks são checklists para humanos durante um incidente, workflows são tarefas em segundo plano para o seu projeto — eles rodam sem supervisão, reagem a eventos e colam o OneUptime ao resto da sua stack.

## Visão rápida

- **Funcionalidade de primeiro nível** no painel do OneUptime, em **Workflows**.
- **Três estilos de gatilho**: Manual, Agendado (cron), Webhook — além de um **gatilho de evento de modelo** que dispara quando qualquer entidade do OneUptime (incidente, alerta, monitor, página de status etc.) é criada, atualizada ou excluída.
- **Canvas visual**: arraste nós de uma paleta de componentes, conecte portas de saída a portas de entrada.
- **Automação mista**: requisições HTTP, mensagens no Slack / Discord / Microsoft Teams / Telegram, JavaScript customizado, parsing de JSON, condicionais, e-mail, chamadas a sub-workflows e operações CRUD em modelos do OneUptime.
- **Variáveis globais**: segredos e configurações de escopo de projeto que você referencia em qualquer workflow sem precisar copiar e colar.
- **Execuções e registros**: toda execução é registrada com status, tempo e saída por passo.

## Por que usar workflows?

A maioria dos times recorre a workflows quando quer:

- **Conectar o OneUptime a outro sistema** — postar um incidente no PagerDuty, espelhar um alerta no Jira, enviar um ping para um webhook na sua stack.
- **Reagir a eventos do OneUptime** — quando um incidente `Sev 1` é aberto, acionar o gerente de plantão *e* criar um ticket no Linear *e* travar uma feature flag.
- **Agendar tarefas recorrentes** — a cada cinco minutos, consultar uma API interna e escrever o resultado em um sistema externo.
- **Receber dados de fora do OneUptime** — um webhook de um sistema de CI dispara uma cadeia de atualizações no OneUptime.
- **Reutilizar pequenas peças de lógica de cola** — um workflow chama outro, então padrões comuns ficam em um único lugar.

## Conceitos-chave

| Termo | Significado |
| --- | --- |
| **Workflow** | O canvas. Um grafo nomeado e reutilizável de gatilhos e componentes com uma flag `isEnabled`. |
| **Gatilho** | O nó que inicia a execução de um workflow. Manual, Agendado, Webhook ou um evento de modelo. Cada workflow tem exatamente um gatilho. |
| **Componente** | Um nó que executa trabalho — uma chamada HTTP, uma mensagem no Slack, um trecho de JavaScript, uma condicional etc. |
| **Porta** | Um soquete de entrada ou saída em um nó. Componentes têm portas de saída como `success` e `error`; você conecta uma porta à porta de entrada do próximo nó. |
| **Execução / Registro** | Uma execução do workflow. Guarda o timestamp, o status (Running, Success, Failed, Timeout) e a saída capturada de cada nó que rodou. |
| **Variável global** | Um valor nomeado (em geral um segredo ou chave de API) definido uma vez no nível do projeto e referenciado em qualquer workflow como `{{variable.NAME}}`. |
| **Variável local** | Um valor com escopo de uma única execução — normalmente o valor de retorno de um nó anterior, referenciado como `{{ComponentId.portName}}`. |

## Onde os workflows ficam no painel

| Página | O que você faz lá |
| --- | --- |
| **Workflows** | Navegar, criar e pesquisar modelos de workflow. |
| **Aba Builder de um workflow** | O canvas de arrastar e soltar. Adicione nós, conecte portas, configure argumentos. |
| **Aba Logs de um workflow** | Cada execução desse workflow com filtros por status e intervalo de tempo. Clique em uma execução para ver a saída por nó. |
| **Aba Settings de um workflow** | Renomear, habilitar/desabilitar, alterar a descrição, gerenciar rótulos, excluir. |
| **Workflows → Variáveis globais** | Defina valores de escopo do projeto referenciados em qualquer workflow. Marque um valor como segredo para escondê-lo da interface após salvar. |
| **Workflows → Execuções e registros** | Histórico de execução de todos os workflows, no escopo do projeto. |

## O ciclo de vida de um workflow

1. **Criar** — Crie um workflow, coloque um gatilho no canvas, arraste os componentes de que precisa, conecte-os e configure cada um.
2. **Habilitar** — Workflows nascem desabilitados. Acione a chave em Settings depois que estiver confiante de que a fiação está certa.
3. **Disparar** — Manual: clique em **Run Manually** com um payload JSON opcional. Agendado: o cron dispara. Webhook: um sistema externo faz `POST` na URL do workflow. Evento de modelo: alguém (ou outro workflow) cria/atualiza/exclui um monitor, incidente, alerta etc.
4. **Executar** — O Workflow Worker percorre o grafo em ordem. Cada componente lê seus argumentos (valores literais ou variáveis interpoladas), faz seu trabalho, escreve seu valor de retorno e escolhe uma porta de saída. O próximo nó dispara.
5. **Auditar** — A execução aparece em **Logs**. Status, duração total, saída por componente e quaisquer erros ficam guardados pelo tempo de vida do projeto.

## Um exemplo trabalhado

Objetivo: quando um incidente é criado com `Sev 1` no título, postar em um canal do Slack e abrir um ticket na sua ferramenta admin interna.

**1. Crie um workflow** chamado "Sev 1 fan-out".

**2. Coloque um gatilho.** Escolha o gatilho **Incident → On Create** na paleta. O gatilho expõe o novo incidente como valor de retorno.

**3. Coloque um componente Conditional.** Conecte a porta de saída do gatilho à entrada dele. Defina a condição: `{{Incident.title}}` *contém* `Sev 1`.

**4. Da porta `yes` do Conditional, coloque um componente Slack.** Canal: `#incident-room`. Texto da mensagem: `Sev 1 declared: {{Incident.title}} — {{Incident.dashboardUrl}}`.

**5. Da mesma porta `yes` (em paralelo), coloque um componente API.** `POST` para `https://admin.internal/incidents`. Corpo: um pequeno objeto JSON construído a partir do incidente.

**6. Habilite o workflow.** Abra um incidente com o título "Sev 1 — checkout 500s" em outra aba. Em poucos segundos a mensagem do Slack chega e uma nova execução aparece em **Logs** com a saída de cada nó capturada.

## Como os workflows se encaixam no resto do OneUptime

- **Monitores** detectam problemas; **incidentes/alertas** os registram; **workflows** reagem a eles — postam mensagens, abrem tickets, disparam automações.
- **Runbooks** são procedimentos de resposta para humanos (com passos opcionais de script). Workflows são automação de fundo, sem supervisão. Eles se complementam — um passo de runbook pode fazer `POST` para um gatilho webhook de um workflow.
- **Conexões de workspace** (Slack, Microsoft Teams) são os destinos típicos das notificações de workflow.
- **Painéis** são visões somente leitura; workflows são o lado de escrita — eles atualizam o estado do OneUptime, chamam APIs externas e movimentam dados.

## O que ler a seguir

- [Criar um workflow](/docs/workflows/authoring) — construir um workflow no canvas, configurar nós, conectar portas.
- [Gatilhos](/docs/workflows/triggers) — gatilhos Manual, Agendado, Webhook e de evento de modelo em detalhe.
- [Componentes](/docs/workflows/components) — o catálogo de ações e como configurar cada uma.
- [Variáveis](/docs/workflows/variables) — variáveis globais, variáveis locais e como funciona a interpolação.
- [Execuções e registros](/docs/workflows/runs-and-logs) — lendo o histórico de execução e depurando falhas.
- [Configuração e segurança](/docs/workflows/configuration) — habilitar/desabilitar, propriedade, rótulos, segredos, limites de recursão.
