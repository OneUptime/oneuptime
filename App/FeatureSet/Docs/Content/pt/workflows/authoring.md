# Criar um workflow

Para criar um workflow, abra **Workflows** e clique em **Create Workflow**. Um assistente chamado **Create a workflow** guia você pelo processo: primeiro **Start from** — escolha **Start from scratch** ou um dos templates — depois **Name**, e finalmente uma etapa **Configure**, que só aparece quando o template escolhido exige configurações próprias.

Depois de criado, abra **Builder** no menu à esquerda. É o canvas onde você desenha o workflow.

## O canvas

Um workflow criado do zero abre com um único bloco tracejado dizendo **Please click here to add trigger**. Esse bloco é o ponto de partida — clique nele para escolher um trigger. Um workflow criado a partir de um template abre com seus blocos já posicionados.

Todo workflow tem exatamente um **trigger** no topo. Tudo o mais é um **componente** que faz algo. Adicionar um segundo trigger substitui o primeiro, e excluir o último devolve o placeholder tracejado.

Adicionando blocos:

- **O trigger** — clique no bloco placeholder tracejado. Um painel intitulado **Add Trigger** se abre.
- **Todo o resto** — clique em **Add Component** na barra de ferramentas acima do canvas. O mesmo tipo de painel se abre, intitulado **Add Component**.

Ambos os painéis são pesquisáveis — pressione `/` para ir direto à caixa de busca — e agrupados por categoria. Selecione um bloco e clique em **Add to Workflow**.

Novos blocos sempre caem no mesmo ponto do canvas, então um novo pode cair em cima de algo que você já posicionou. Arraste-o para longe; o canvas se ajusta a uma grade conforme você move. As posições dos blocos são salvas, então a próxima pessoa vê o mesmo arranjo que você deixou.

Mudanças são salvas automaticamente. Uma pill na barra de ferramentas acompanha isso: **Saving…** enquanto a mudança está em andamento, depois **Saved**, ou **Could not save** se não funcionou. Não há botão Save nem uma etapa de publicação separada.

## O que há em um bloco

| Campo                         | O que faz                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (em **ID**) | O id curto exibido no bloco, como `log-1`. É assim que outros blocos se referem a este, então renomeá-lo quebra toda referência `{{local.components.…}}` que apontava para ele. O título do bloco é o próprio nome do componente e não pode ser alterado. |
| **Settings**                  | O que o bloco precisa para fazer seu trabalho — uma URL, um canal do Slack, o corpo de uma mensagem. Campos opcionais são rotulados **(Optional)**; todo o resto é obrigatório. Configurações menos usadas ficam atrás de um disclosure **Advanced**. |
| **Input**                     | O ponto na borda superior, por onde entram linhas vindas de blocos anteriores. Triggers não têm um — nada roda antes deles.                                                                                       |
| **Outputs**                   | Os pontos ao longo da borda inferior, rotulados logo acima deles, por onde saem linhas para os próximos blocos. Muitos blocos têm saídas separadas de **Success** e **Error** para você tratar os dois casos.                  |

## Conectando blocos

Arraste de um ponto na parte inferior de um bloco até o ponto no topo do próximo. A linha que você desenha decide o que roda em seguida.

- Se você conectar a partir de **Success**, o próximo bloco só roda quando o anterior funcionou.
- Se você conectar a partir de **Error**, o próximo bloco só roda quando o anterior falhou.
- Se você não conectar uma saída, esse caminho simplesmente para.

Você pode conectar uma saída a vários blocos. Todos eles rodam — mas um após o outro, em uma única fila, não em paralelo. Não conte com a ordem entre branches, nem espere que se sobreponham no tempo. Cada bloco roda no máximo uma vez por execução, então um loop de volta a um bloco anterior não o roda duas vezes.

## Configurando um bloco

Clique em um bloco para abrir suas configurações em um diálogo. Cada configuração tem o tipo certo de campo — campos de texto, dropdowns, editores de código, toggles, e assim por diante. Preencha e clique em **Save**.

O mesmo diálogo é onde você encontra:

- **Delete** — remove este bloco.
- **Run just this step** — roda apenas este bloco isoladamente, sem o resto do workflow. Valores que ele leria de outras etapas chegam vazios, e qualquer coisa que ele envia, escreve ou exclui realmente acontece.
- **Documentation**, **Inputs**, **Outputs** e **Returns** — cartões de referência do que este bloco espera e produz.

A maioria dos campos de texto aceita variáveis — é assim que os dados fluem de um bloco para o próximo. Em vez de digitar a sintaxe manualmente, use o seletor de valores no editor: ele monta uma referência correta a partir do bloco e do campo que você escolher. Veja [Variáveis de workflow](/docs/workflows/variables).

## Verificações enquanto você constrói

O Builder verifica todo o grafo a cada mudança e reporta o que encontra em uma pill na barra de ferramentas. Clique na pill para abrir **Problems with this workflow**, que lista cada problema e leva você direto ao bloco responsável. Blocos com um problema também carregam um badge vermelho no canvas.

Ele detecta os erros que de outra forma ficariam invisíveis até uma execução dar errado — nenhum trigger, dois blocos compartilhando um id, um ponto dentro de um id, um bloco que nada conecta, uma configuração obrigatória deixada em branco, JSON malformado, espaços dentro de `{{ }}`, e referências a uma etapa ou valor de retorno que não existe.

Uma coisa que ele não consegue verificar: se um nome de variável existe. Uma variável renomeada só aparece no log de execução.

## Seu primeiro workflow

A forma mais rápida de se familiarizar com o canvas:

1. Clique no bloco placeholder tracejado, escolha **Manual** no painel **Add Trigger**, e clique em **Add to Workflow**.
2. Clique em **Add Component**, escolha **Log** (em **Utils**), e clique em **Add to Workflow**. Arraste o novo bloco para longe do trigger, depois conecte o ponto **Execute** do trigger até o ponto de entrada do bloco Log.
3. Abra o bloco Log e defina seu **Value** como `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` é o **Identifier** do trigger, exibido no bloco do trigger — confira se corresponde.
4. Vá para **Overview**, clique em **Edit Workflow** no card **Workflow Details**, e ligue **Enabled**. Um workflow desabilitado não pode ser executado de forma alguma, nem mesmo manualmente.
5. De volta no **Builder**, clique em **Run Workflow**, coloque `{ "name": "Ada" }` no campo **JSON**, clique em **Run Workflow Manually**, e confirme com **Run**.
6. Um painel **Workflow Run** se abre sozinho e acompanha a execução. O log mostra `Value:` seguido de `Hello from Ada`.

Esse ciclo — adicionar, conectar, configurar, rodar, ler o log — é como você vai construir todo workflow.

## Ativando-o

Novos workflows começam desabilitados, assim como qualquer workflow que você duplicar ou importar.

O interruptor **Enabled** fica na página **Overview** do workflow, no card **Workflow Details** — não na página Settings. O mesmo card mostra o estado atual como uma pill verde **Enabled** ou vermelha **Disabled**.

Um workflow desabilitado não pode rodar de forma alguma. Execuções manuais são rejeitadas com "This workflow is not enabled," exatamente como as disparadas por trigger, então a ordem é: habilite-o, teste-o com **Run Workflow**, leia o log de execução e desligue **Enabled** novamente se você ainda não estiver pronto para o trigger dele disparar. Para testar um único bloco sem rodar o workflow inteiro, use **Run just this step** nas configurações daquele bloco.

Para pausar um workflow sem excluí-lo, desligue **Enabled**. Nenhuma nova execução começa. Uma execução em andamento termina, mas uma parada em um bloco **Sleep** é cancelada quando ela acorda e é registrada como um erro.

## Organizando

- Arraste blocos para movê-los. O layout é salvo.
- Para excluir uma linha, arraste uma de suas pontas para fora do ponto e solte-a em uma área vazia do canvas.
- Para excluir um bloco, clique nele e use **Delete** na parte inferior do diálogo de configurações. Selecionar um bloco ou uma linha e pressionar Backspace também os remove.
- Não há como duplicar um único bloco. **Duplicate Workflow** na página **Settings** do workflow copia tudo, e a cópia é criada desabilitada.
- Empilhe blocos de cima para baixo para que se leiam na direção em que rodam — entradas ficam na borda superior, saídas na inferior, então o fluxo naturalmente desce.

## Onde ler a seguir

- [Gatilhos de workflow](/docs/workflows/triggers) — as quatro formas de um workflow começar.
- [Componentes de workflow](/docs/workflows/components) — todo bloco que você pode adicionar.
- [Variáveis de workflow](/docs/workflows/variables) — movendo dados entre blocos.
- [Execuções e registros de workflow](/docs/workflows/runs-and-logs) — verificando o que aconteceu.
