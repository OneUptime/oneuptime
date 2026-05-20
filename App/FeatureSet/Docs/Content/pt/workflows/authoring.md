# Criar um workflow

Crie um workflow em **Workflows → Create Workflow**, dê um nome e uma descrição opcional e abra a aba **Builder** para começar a soltar nós no canvas.

## O canvas

O Builder é um grafo com zoom e movimentação. Você adiciona nós a partir de uma paleta de componentes, conecta-os com arestas e configura os argumentos de cada nó em um painel lateral. Um indicador de salvamento no cabeçalho avisa se a sua edição mais recente foi persistida.

Um workflow sempre começa com exatamente um nó **gatilho**. Gatilhos não têm porta de entrada — é onde a execução começa. Tudo a jusante é um **componente**.

## Anatomia de um nó

Todo nó tem:

| Campo | Função |
| --- | --- |
| **Title** | O rótulo exibido no canvas. O padrão é o nome do componente; sobrescreva para tornar workflows complexos mais fáceis de ler. |
| **Arguments** | A configuração de que o componente precisa para fazer seu trabalho — uma URL, um canal do Slack, um trecho de JavaScript etc. Argumentos obrigatórios são marcados com um asterisco. |
| **Portas de entrada** | Soquetes à esquerda do nó onde aterrissam as arestas que chegam. Componentes têm uma porta de entrada chamada `in`; gatilhos não têm nenhuma. |
| **Portas de saída** | Soquetes à direita onde as arestas que saem começam. Componentes definem portas como `success`, `error`, `yes`, `no`. |
| **Valores de retorno** | Dados que o nó produz — o payload de suas portas de saída. Nós a jusante referenciam isso como `{{NodeId.fieldName}}`. |

## Conectando nós

Arraste de uma porta de saída até a porta de entrada de um nó a jusante para criar uma aresta. Uma aresta saindo de `success` roda esse ramo apenas quando o nó a montante teve sucesso; uma aresta saindo de `error` só roda quando ele falhou. Se você não conectar uma porta, esse ramo simplesmente termina.

Você pode fazer fan-out: uma porta de saída pode alimentar vários nós a jusante, e todos rodam em paralelo a partir desse ponto.

## Configurando argumentos

Clique em um nó para abrir seu painel lateral. Cada argumento tem um editor tipado:

- **Text / URL / Email / Number / Password** — uma entrada de uma linha.
- **JSON** — um editor JSON com destaque de sintaxe e indicador de validação.
- **JavaScript** — um editor de código para trechos usados pelo componente **Custom Code**.
- **Markdown / HTML** — corpos de texto enriquecido para componentes de e-mail e mensagens.
- **CronTab** — uma expressão de agendamento (usada pelo gatilho Schedule).
- **Boolean** — um toggle.
- **Select / Query** — dropdowns para campos que aceitam um conjunto fixo de valores ou uma consulta no estilo de modelo.

Qualquer campo de texto aceita interpolação de variáveis — consulte [Variáveis](/docs/workflows/variables) para as regras.

## Um primeiro workflow mínimo

A forma mais rápida de pegar o ritmo do canvas:

1. Coloque um gatilho **Manual**.
2. Coloque um componente **Log** (em **Utils**). Conecte a porta de saída do gatilho à porta de entrada do componente Log.
3. No argumento do componente Log, digite `Hello from {{Manual.JSON.name}}`.
4. Salve e habilite o workflow.
5. Clique em **Run Manually**, cole `{ "name": "Ada" }` como entrada e envie.
6. Abra a aba **Logs**. A execução mais recente mostra a saída capturada do nó Log: `Hello from Ada`.

Esse ciclo — arrastar, conectar, configurar, executar, inspecionar — é o ritmo de criar qualquer workflow.

## Salvar, habilitar e testar em produção

Workflows são armazenados como um grafo JSON na coluna `Workflow.graph`. O Builder salva conforme você edita; o indicador de salvamento no cabeçalho mostra quando a alteração mais recente chegou ao servidor. Não existe um passo separado de "publicar".

Mas: um workflow só dispara seu gatilho quando **isEnabled** está ligado. Workflows novos nascem desabilitados. Trate essa flag como o seu interruptor de "pronto para produção" — construa, clique em **Run Manually** para fazer um teste a seco com um payload de exemplo, olhe os **Logs** e só então ligue Enable.

Se você precisa pausar um workflow sem excluí-lo (por exemplo, durante um incidente não relacionado), desligue **isEnabled** em **Settings**. As execuções em andamento continuam; nenhuma nova começa.

## Reordenar e reorganizar

- Arraste um nó para reposicioná-lo. A posição é armazenada no grafo, então a próxima pessoa a abrir o canvas vê o mesmo layout.
- Clique com o botão direito numa aresta para excluí-la; clique com o botão direito num nó para opções de excluir e duplicar.
- Para workflows largos, organize-os da esquerda para a direita para que a direção de execução acompanhe a direção de leitura.

## O que ler a seguir

- [Gatilhos](/docs/workflows/triggers) — as quatro famílias de gatilho e o que cada uma expõe como valores de retorno.
- [Componentes](/docs/workflows/components) — o catálogo completo e seus argumentos.
- [Variáveis](/docs/workflows/variables) — como referenciar dados entre nós e a partir de variáveis globais.
- [Execuções e registros](/docs/workflows/runs-and-logs) — como depurar um workflow com mau comportamento.
