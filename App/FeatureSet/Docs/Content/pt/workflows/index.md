# Visão geral dos workflows

Workflows permitem automatizar tarefas no OneUptime sem escrever código. Arraste e solte alguns blocos em um canvas, conecte-os, e você terá uma automação que roda sempre que algo acontece — um incidente é aberto, um agendamento dispara ou outra ferramenta envia dados para o OneUptime.

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
3. **Conexões entre eles** — você desenha linhas de um bloco para o próximo para definir a ordem.

Você constrói tudo isso visualmente em um canvas. Sem necessidade de código para a maioria dos workflows, mas você pode incluir um trecho de JavaScript quando precisar.

## Termos-chave

| Termo               | Significado                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- |
| **Workflow**        | A automação inteira — um nome, um canvas e um interruptor para ligar ou desligar.             |
| **Gatilho**         | O primeiro bloco. Ele decide quando o workflow roda. Todo workflow tem exatamente um gatilho. |
| **Componente**      | Um bloco de ação — envia uma mensagem, faz uma requisição, verifica uma condição.             |
| **Execução**        | Uma execução do workflow. Salva com timestamps e a saída de cada bloco.                       |
| **Variável global** | Um valor (como uma chave de API) que você salva uma vez e reutiliza em qualquer workflow.     |

## Onde encontrar workflows no OneUptime

Abra **Workflows** na navegação à esquerda. A partir daí:

- **Workflows** — sua lista de workflows. Crie um novo ou abra um existente.
- **Aba Builder** — o canvas onde você desenha o workflow.
- **Aba Logs** — toda execução deste workflow, com detalhes.
- **Aba Settings** — nome, descrição, donos, etiquetas, ativar/desativar.
- **Variáveis globais** — valores compartilhados em todos os seus workflows.
- **Execuções e registros** — histórico de execuções de todos os workflows do seu projeto.

## Construindo seu primeiro workflow

1. **Crie** — dê um nome e uma descrição curta ao seu workflow.
2. **Escolha um gatilho** — manual, agendado, webhook ou um evento do OneUptime.
3. **Adicione componentes** — arraste ações para o canvas e conecte-as.
4. **Teste** — clique em **Executar Manualmente** e veja o que acontece nos logs.
5. **Ative** — vire o interruptor **Ativado** nas Configurações quando estiver pronto.

## Um exemplo rápido

Suponha que você queira postar no Slack sempre que um incidente crítico é criado:

1. Crie um workflow chamado "Incidentes críticos para o Slack."
2. Escolha o gatilho **Incidente → Na Criação**.
3. Adicione um bloco **Condições**. Configure-o para verificar se o título do incidente contém "Sev 1."
4. Do ramo **Sim**, adicione um bloco **Slack**. Escolha o canal e escreva a mensagem.
5. Ative o workflow.

Da próxima vez que alguém abrir um incidente com "Sev 1" no título, o Slack se acende.

## Como os workflows se encaixam no restante do OneUptime

- **Monitores** detectam o problema. **Incidentes** o registram. **Workflows** reagem a ele.
- **Runbooks** são guias passo a passo para pessoas. Workflows são automação sem supervisão. Use um runbook quando um humano precisa tomar decisões; use um workflow quando os passos são automáticos.
- **Conexões de workspace** (Slack, Teams) são para onde os workflows enviam suas mensagens.

## O que ler em seguida

- [Criando um Workflow](/docs/workflows/authoring) — construindo no canvas.
- [Gatilhos](/docs/workflows/triggers) — as diferentes formas de um workflow começar.
- [Componentes](/docs/workflows/components) — os blocos de construção que você pode adicionar.
- [Variáveis](/docs/workflows/variables) — usando valores entre blocos e workflows.
- [Execuções e Registros](/docs/workflows/runs-and-logs) — verificando o que aconteceu.
- [Configuração e Segurança](/docs/workflows/configuration) — configurações importantes para conhecer.
