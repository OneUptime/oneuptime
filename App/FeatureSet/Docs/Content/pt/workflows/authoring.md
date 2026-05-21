# Criando um Workflow

Para criar um workflow, abra **Workflows → Criar Workflow**, dê um nome a ele e clique na aba **Builder**. Você verá um canvas em branco onde vai construir a automação.

## O canvas

O Builder é um canvas de arrastar e soltar. Você adiciona blocos a partir da paleta lateral, conecta-os com linhas e clica em cada bloco para configurar o que ele faz. As alterações são salvas automaticamente — você verá um indicador no topo quando estiverem salvas.

Todo workflow começa com um **gatilho** no início. Tudo o mais é um **componente** que faz algo.

## O que tem em um bloco

| Campo | O que faz |
| --- | --- |
| **Título** | O nome mostrado no canvas. Renomeie para tornar workflows complexos mais fáceis de ler. |
| **Configurações** | O que o bloco precisa para fazer seu trabalho — uma URL, um canal do Slack, um corpo de mensagem etc. Campos obrigatórios são marcados com um asterisco. |
| **Entrada** | O ponto à esquerda onde as linhas dos blocos anteriores chegam. |
| **Saídas** | Os pontos à direita de onde as linhas saem para os próximos blocos. Muitos blocos têm saídas separadas de **sucesso** e **erro** para que você possa tratar ambos os casos. |

## Conectando blocos

Arraste do ponto de saída de um bloco até o ponto de entrada do próximo bloco. A linha que você desenha decide o que executa em seguida.

- Se você conectar pela saída de **sucesso**, o próximo bloco só executa quando o anterior funcionou.
- Se você conectar pela saída de **erro**, o próximo bloco só executa quando o anterior falhou.
- Se você não conectar uma saída, esse caminho simplesmente para.

Você pode conectar uma saída a múltiplos blocos. Todos eles rodam ao mesmo tempo a partir desse ponto.

## Configurando um bloco

Clique em um bloco para abrir suas configurações na lateral. Cada configuração tem o tipo de entrada apropriado — campos de texto, dropdowns, editores de código, interruptores e assim por diante.

A maioria dos campos de texto aceita variáveis — é assim que os dados fluem de um bloco para o próximo. Veja [Variáveis](/docs/workflows/variables) para a sintaxe.

## Seu primeiro workflow

A forma mais rápida de se familiarizar com o canvas:

1. Arraste um gatilho **Manual** para o canvas.
2. Arraste um componente **Log** (em **Utils**) ao lado dele. Conecte o gatilho ao componente Log.
3. No campo de mensagem do bloco Log, digite `Hello from {{Manual.JSON.name}}`.
4. Salve e ative o workflow.
5. Clique em **Executar Manualmente**, cole `{ "name": "Ada" }` como entrada e envie.
6. Abra a aba **Logs**. A execução mais recente mostra `Hello from Ada`.

Esse ciclo — arrastar, conectar, configurar, executar, verificar o log — é como você vai construir todos os workflows.

## Salvar e ativar

O canvas salva enquanto você trabalha. Não há um passo separado de "publicar".

Mas um workflow só roda de verdade quando **Ativado** está ligado nas Configurações. Workflows novos começam desativados. Use esse interruptor como sua rede de segurança — construa, teste com **Executar Manualmente**, verifique os logs e então ative.

Para pausar um workflow sem excluí-lo, desligue **Ativado**. Execuções já em andamento terminam; nenhuma nova começa.

## Organização

- Arraste os blocos para movê-los. O layout é salvo para que a próxima pessoa veja o mesmo arranjo.
- Clique com o botão direito em uma linha para excluí-la. Clique com o botão direito em um bloco para excluí-lo ou duplicá-lo.
- Para workflows extensos, organize-os da esquerda para a direita para que sejam lidos na mesma direção em que rodam.

## O que ler em seguida

- [Gatilhos](/docs/workflows/triggers) — as quatro formas de um workflow começar.
- [Componentes](/docs/workflows/components) — todos os blocos que você pode adicionar.
- [Variáveis](/docs/workflows/variables) — movendo dados entre blocos.
- [Execuções e Registros](/docs/workflows/runs-and-logs) — verificando o que aconteceu.
