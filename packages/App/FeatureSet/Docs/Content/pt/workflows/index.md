# Visão geral dos workflows

Workflows permitem automatizar tarefas no OneUptime sem escrever código. Você põe alguns blocos em um canvas, liga um no outro, e tem uma automação que roda sempre que algo acontece — um incidente é aberto, um agendamento dispara, ou outra ferramenta envia dados para o OneUptime.

Pense nos workflows como ajudantes de bastidores do seu projeto: eles reagem a eventos, conversam com outras ferramentas e mantêm tudo em sincronia sem barulho, enquanto você foca no seu trabalho.

## O que dá para fazer com workflows

- **Conectar o OneUptime às suas outras ferramentas** — mandar incidentes para o Slack, criar tickets no Jira, publicar em um webhook da sua stack.
- **Reagir ao que acontece no OneUptime** — quando um incidente crítico é criado, avisar quem está de plantão e abrir um ticket automaticamente.
- **Rodar tarefas em um agendamento** — a cada cinco minutos, toda noite, toda segunda de manhã.
- **Receber dados de fora** — deixar outros sistemas empurrarem dados para dentro do OneUptime por uma URL exclusiva.
- **Reaproveitar automações comuns** — construir uma vez e chamar de qualquer outro workflow.

## Como um workflow funciona

Todo workflow tem três partes:

1. **Um trigger** — o que dá a partida. Pode ser um botão manual, um agendamento, um webhook de entrada ou um evento do OneUptime (como um novo incidente).
2. **Um ou mais componentes** — o que o workflow faz. Enviar uma mensagem, fazer uma chamada HTTP, rodar uma verificação rápida, ramificar conforme uma condição.
3. **Ligações entre eles** — você traça linhas de um bloco ao próximo para definir a ordem.

Tudo isso é montado visualmente, em um canvas. A maioria dos workflows não exige código, embora você possa incluir um trecho de JavaScript quando precisar.

## Termos-chave

| Termo               | O que significa                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Workflow**        | A automação inteira — um nome, um canvas e uma chave para ligar ou desligar.                |
| **Trigger**         | O primeiro bloco. Ele decide quando o workflow roda. Todo workflow tem exatamente um.       |
| **Componente**      | Um bloco de ação — envia uma mensagem, faz uma requisição, verifica uma condição.           |
| **Execução**        | Uma rodada do workflow. Guardada com horários e a saída de cada bloco.                      |
| **Variável global** | Um valor (como uma chave de API) que você salva uma vez e reutiliza em qualquer workflow.   |

## Onde encontrar os workflows no OneUptime

Abra **Fluxos de trabalho** na navegação à esquerda. Essa seção guarda:

- **Fluxos de trabalho** — sua lista de workflows. Crie um novo ou abra um existente.
- **Variáveis globais** — valores compartilhados entre todos os seus workflows.
- **Execuções e registros** — o histórico de execuções de todos os workflows do projeto.

Abra um workflow específico e o menu à esquerda dele traz:

- **Visão geral** — nome, descrição, rótulos e a chave **Habilitado**.
- **Construtor** — o canvas onde você desenha o workflow.
- **Variáveis do fluxo** — valores restritos a este workflow.
- **Execuções e registros** — cada execução deste workflow, com detalhes.
- **Configurações** — segredo do webhook, duplicação e exportação.

## Construindo seu primeiro workflow

1. **Crie** — escolha um ponto de partida e dê um nome ao workflow.
2. **Escolha um trigger** — manual, agendado, webhook ou um evento do OneUptime.
3. **Adicione componentes** — coloque as ações no canvas e ligue-as.
4. **Ligue** — ative **Habilitado** na página **Visão geral**. Um workflow desabilitado não roda de jeito nenhum, nem à mão.
5. **Teste** — clique em **Executar fluxo de trabalho** no Construtor e acompanhe o registro da execução.

## Um exemplo rápido

Digamos que você queira publicar no Slack sempre que um incidente crítico for criado:

1. Crie um workflow chamado "Incidentes críticos para o Slack".
2. Escolha o trigger **On Create Incident**.
3. Adicione um bloco **If / Else**. Configure-o para verificar se o título do incidente contém "Sev 1".
4. A partir da saída **Sim**, adicione um bloco **Slack**. Escolha o canal e escreva a mensagem.
5. Ligue o workflow.

Na próxima vez que alguém abrir um incidente com "Sev 1" no título, o Slack acende.

## Como os workflows se encaixam no resto do OneUptime

- **Monitores** detectam o problema. **Incidentes** registram. **Fluxos de trabalho** reagem.
- **Runbooks** são guias passo a passo para pessoas. Workflows são automação sem supervisão. Use um runbook quando alguém precisa tomar decisões; use um workflow quando os passos são automáticos.
- **Conexões do espaço de trabalho** (Slack, Teams) são para onde os workflows mandam suas mensagens.

## Onde ler em seguida

- [Criar um workflow](/docs/workflows/authoring) — construindo no canvas.
- [Gatilhos de workflow](/docs/workflows/triggers) — as diferentes formas de um workflow começar.
- [Componentes de workflow](/docs/workflows/components) — os blocos de construção que você pode adicionar.
- [Variáveis de workflow](/docs/workflows/variables) — usando valores entre blocos e workflows.
- [Execuções e registros de workflow](/docs/workflows/runs-and-logs) — verificando o que aconteceu.
- [Configuração e segurança de workflow](/docs/workflows/configuration) — configurações que vale a pena conhecer.
