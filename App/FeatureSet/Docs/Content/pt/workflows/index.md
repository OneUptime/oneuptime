# Visão geral dos workflows

Workflows permitem automatizar tarefas no OneUptime sem escrever código. Adicione alguns blocos a um canvas, conecte-os entre si, e você terá uma automação que roda sempre que algo acontece — um incidente é aberto, um agendamento dispara ou outra ferramenta envia dados para o OneUptime.

Pense nos workflows como ajudantes em segundo plano para o seu projeto: eles reagem a eventos, conversam com outras ferramentas e mantêm tudo em sincronia silenciosamente, enquanto você foca no seu trabalho.

## O que dá para fazer com workflows

- **Conectar o OneUptime às suas outras ferramentas** — enviar incidentes para o Slack, criar tickets no Jira, postar em um webhook da sua stack.
- **Reagir ao que acontece no OneUptime** — quando um incidente crítico é criado, notificar o time de plantão e abrir um ticket automaticamente.
- **Executar tarefas em um agendamento** — a cada cinco minutos, toda noite, toda segunda de manhã.
- **Receber dados externos** — permitir que outros sistemas enviem dados ao OneUptime através de uma URL única.
- **Reutilizar automações comuns** — construa uma vez, chame de qualquer outro workflow.

## Como um workflow funciona

Todo workflow tem três partes:

1. **Um gatilho** — o que inicia o workflow. Pode ser um botão manual, um agendamento, um webhook de entrada ou um evento no OneUptime (como um novo incidente).
2. **Um ou mais componentes** — o que o workflow faz. Enviar uma mensagem, fazer uma chamada HTTP, executar uma verificação rápida, ramificar com base em uma condição.
3. **Conexões entre eles** — você desenha linhas de um bloco para o próximo para decidir a ordem.

Você constrói tudo isso visualmente em um canvas. Não é necessário programar na maioria dos workflows, embora você possa adicionar um trecho de JavaScript quando precisar.

## Termos-chave

| Termo                | O que significa                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------- |
| **Workflow**        | A automação inteira — um nome, um canvas e um interruptor para ligá-la ou desligá-la.                 |
| **Trigger**         | O primeiro bloco. Ele decide quando o workflow roda. Todo workflow tem exatamente um trigger. |
| **Componente**       | Um bloco de ação — envia uma mensagem, faz uma requisição, verifica uma condição.                     |
| **Execução**             | Uma execução do workflow. Salva com timestamps e a saída de cada bloco.         |
| **Variável global** | Um valor (como uma API key) que você salva uma vez e reutiliza em qualquer workflow.          |

## Onde encontrar workflows no OneUptime

Abra **Workflows** na navegação à esquerda. Essa seção contém:

- **Workflows** — sua lista de workflows. Crie um novo ou abra um existente.
- **Global Variables** — valores compartilhados entre todos os seus workflows.
- **Runs & Logs** — histórico de execução de todos os workflows do seu projeto.

Ao abrir um único workflow, seu próprio menu à esquerda contém:

- **Overview** — nome, descrição, labels e o interruptor **Enabled**.
- **Builder** — o canvas onde você desenha o workflow.
- **Workflow Variables** — valores com escopo restrito a este workflow.
- **Runs & Logs** — todas as execuções deste workflow, com detalhes.
- **Settings** — segredo do webhook, duplicar e exportar.

## Construindo seu primeiro workflow

1. **Create** — escolha um ponto de partida e dê um nome ao seu workflow.
2. **Escolha um trigger** — manual, agendado, webhook, ou um evento do OneUptime.
3. **Adicione componentes** — adicione ações ao canvas e conecte-as.
4. **Ative-o** — ligue o interruptor **Enabled** na página **Overview**. Um workflow desabilitado não pode rodar de forma alguma, nem mesmo manualmente.
5. **Teste** — clique em **Run Workflow** no Builder e acompanhe o log de execução.

## Um exemplo rápido

Digamos que você queira postar no Slack sempre que um incidente crítico for criado:

1. Crie um workflow chamado "Critical incidents to Slack."
2. Escolha o trigger **On Create Incident**.
3. Adicione um bloco **If / Else**. Configure-o para verificar se o título do incidente contém "Sev 1."
4. A partir do branch **Yes**, adicione um bloco **Slack**. Escolha o canal e escreva a mensagem.
5. Ative o workflow.

Na próxima vez que alguém abrir um incidente com "Sev 1" no título, o Slack acende.

## Como os workflows se encaixam no restante do OneUptime

- **Monitores** detectam o problema. **Incidentes** o registram. **Workflows** reagem a ele.
- **Runbooks** são guias passo a passo para pessoas. Workflows são automação não supervisionada. Use um runbook quando um humano precisar tomar decisões; use um workflow quando as etapas forem automáticas.
- **Workspace connections** (Slack, Teams) são para onde os workflows enviam suas mensagens.

## Onde ler a seguir

- [Criar um workflow](/docs/workflows/authoring) — construindo no canvas.
- [Gatilhos de workflow](/docs/workflows/triggers) — as diferentes formas de um workflow começar.
- [Componentes de workflow](/docs/workflows/components) — os blocos de construção que você pode adicionar.
- [Variáveis de workflow](/docs/workflows/variables) — usando valores entre blocos e workflows.
- [Execuções e registros de workflow](/docs/workflows/runs-and-logs) — verificando o que aconteceu.
- [Configuração e segurança de workflow](/docs/workflows/configuration) — configurações que vale a pena conhecer.
