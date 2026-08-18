# Criar um workflow

Para criar um workflow, abra **Fluxos de trabalho** e clique em **Criar fluxo de trabalho**. Um assistente chamado **Create a workflow** conduz você: primeiro **Start from** — escolha **Start from scratch** ou um dos modelos —, depois **Nome** e, por fim, uma etapa **Configurar**, que só aparece quando o modelo escolhido pede configurações próprias.

Criado o workflow, abra **Construtor** no menu à esquerda. É ali que fica o canvas onde você desenha o workflow.

## O canvas

Um workflow criado do zero abre com um único bloco tracejado dizendo **Please click here to add trigger**. Esse bloco é o ponto de partida — clique nele para escolher um trigger. Um workflow criado a partir de um modelo já abre com os blocos no lugar.

Todo workflow tem exatamente um **trigger** no topo. Todo o resto é um **componente**, que faz alguma coisa. Adicionar um segundo trigger substitui o primeiro, e excluir o último traz o bloco tracejado de volta.

Para adicionar blocos:

- **O trigger** — clique no bloco tracejado. Abre um painel chamado **Add Trigger**.
- **Todo o resto** — clique em **Adicionar componente**, na barra de ferramentas acima do canvas. Abre o mesmo painel, agora chamado **Add Component**.

Os dois painéis têm busca — aperte `/` para pular direto para o campo — e são agrupados por categoria. Selecione um bloco e clique em **Add to Workflow**.

Blocos novos sempre aparecem no mesmo ponto do canvas, então um recém-adicionado pode cair em cima de algo que você já posicionou. Arraste-o para um espaço livre; o canvas se alinha a uma grade enquanto você arrasta. As posições são salvas, então a próxima pessoa vê o mesmo arranjo que você deixou.

As alterações são salvas sozinhas. Uma pílula na barra de ferramentas mostra o andamento: **Saving…** enquanto a alteração está a caminho, depois **Salvo**, ou **Não foi possível salvar** se algo deu errado. Não há botão de salvar nem etapa separada de publicação.

## O que há em um bloco

| Campo                         | O que faz                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (em **ID**) | O id curto mostrado no bloco, como `log-1`. É por ele que os outros blocos se referem a este, então renomeá-lo quebra toda referência `{{local.components.…}}` que aponta para ele. O título do bloco é o nome do próprio componente e não pode ser alterado. |
| **Settings**                  | O que o bloco precisa para fazer seu trabalho — uma URL, um canal do Slack, o texto de uma mensagem. Campos opcionais vêm marcados com **(Optional)**; todos os outros são obrigatórios. Configurações menos usadas ficam atrás de um recuo **Avançado**. |
| **Input**                     | O ponto na borda superior, onde chegam as linhas vindas dos blocos anteriores. Triggers não têm — nada roda antes deles.                                                                                       |
| **Outputs**                   | Os pontos na borda inferior, com o rótulo logo acima, de onde saem as linhas para os próximos blocos. Muitos blocos têm saídas **Sucesso** e **Erro** separadas, para você tratar os dois casos.                  |

## Conectando blocos

Arraste de um ponto na parte de baixo de um bloco até o ponto no topo do bloco seguinte. A linha que você desenha define o que roda em seguida.

- Se você conectar a partir de **Sucesso**, o próximo bloco só roda quando o anterior deu certo.
- Se você conectar a partir de **Erro**, o próximo bloco só roda quando o anterior falhou.
- Se você não conectar uma saída, aquele caminho simplesmente termina ali.

Dá para conectar uma saída a vários blocos. Todos rodam — mas um depois do outro, em fila única, não em paralelo. Não conte com a ordem entre as ramificações, nem com elas acontecendo ao mesmo tempo. Cada bloco roda no máximo uma vez por execução, então um laço de volta a um bloco anterior não o faz rodar duas vezes.

## Configurando um bloco

Clique em um bloco para abrir suas configurações em uma janela. Cada configuração tem o tipo de campo adequado — texto, listas, editores de código, chaves e por aí vai. Preencha e clique em **Salvar**.

Nessa mesma janela você encontra:

- **Excluir** — remove este bloco.
- **Run just this step** — roda só este bloco, sem o resto do workflow. Os valores que ele leria de outras etapas chegam vazios, e tudo o que ele envia, grava ou apaga acontece de verdade.
- **Documentação**, **Inputs**, **Outputs** e **Returns** — fichas de referência do que este bloco espera e do que produz.

A maioria dos campos de texto aceita variáveis — é assim que os dados fluem de um bloco para o outro. Em vez de digitar a sintaxe à mão, use o seletor de valores no editor: ele monta a referência correta a partir do bloco e do campo que você escolher. Veja [Variáveis de workflow](/docs/workflows/variables).

## Verificações enquanto você constrói

O Construtor revisa o grafo inteiro a cada alteração e mostra o que encontrou em uma pílula na barra de ferramentas. Clique na pílula para abrir **Problems with this workflow**, que lista cada problema e leva você ao bloco responsável. Blocos com problema também ganham um selo vermelho no canvas.

Ele pega justamente os erros que ficariam invisíveis até uma execução dar errado — nenhum trigger, dois blocos com o mesmo id, um ponto dentro de um id, um bloco que ninguém conecta, uma configuração obrigatória em branco, JSON malformado, espaços dentro de `{{ }}` e referências a uma etapa ou a um valor de retorno que não existe.

Uma coisa ele não consegue verificar: se um nome de variável existe. Uma variável renomeada só aparece no registro da execução.

## Seu primeiro workflow

O jeito mais rápido de pegar o jeito do canvas:

1. Clique no bloco tracejado, escolha **Manual** no painel **Add Trigger** e clique em **Add to Workflow**.
2. Clique em **Adicionar componente**, escolha **Log** (em **Utils**) e clique em **Add to Workflow**. Arraste o novo bloco para longe do trigger e conecte o ponto **Execute** do trigger ao ponto de entrada do bloco Log.
3. Abra o bloco Log e defina o **Valor** como `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` é o **Identifier** do trigger, mostrado no bloco — confira se bate.
4. Vá em **Visão geral**, clique em **Editar fluxo de trabalho** no cartão **Detalhes do Fluxo de Trabalho** e ligue **Habilitado**. Um workflow desabilitado não roda de jeito nenhum, nem manualmente.
5. De volta ao **Construtor**, clique em **Executar fluxo de trabalho**, coloque `{ "name": "Ada" }` no campo **JSON**, clique em **Run Workflow Manually** e confirme em **Run**.
6. Um painel **Workflow Run** abre sozinho e acompanha a execução. O registro mostra `Value:` seguido de `Hello from Ada`.

Esse ciclo — adicionar, conectar, configurar, rodar, ler o registro — é como você vai construir todos os seus workflows.

## Ativando o workflow

Workflows novos nascem desabilitados, e o mesmo vale para qualquer um que você duplique ou importe.

A chave **Habilitado** fica na página **Visão geral** do workflow, no cartão **Detalhes do Fluxo de Trabalho** — não na página de configurações. Esse mesmo cartão mostra o estado atual como uma pílula verde **Habilitado** ou vermelha **Desabilitado**.

Um workflow desabilitado não roda de jeito nenhum. Execuções manuais são recusadas com "This workflow is not enabled" exatamente como as disparadas por trigger. Então a ordem é: habilite, teste com **Executar fluxo de trabalho**, leia o registro da execução e desligue **Habilitado** de novo se ainda não estiver pronto para o trigger disparar. Para testar um bloco isolado sem rodar tudo, use **Run just this step** nas configurações daquele bloco.

Para pausar um workflow sem excluí-lo, desligue **Habilitado**. Nenhuma execução nova começa. Uma execução em andamento termina, mas uma que estiver parada em um bloco **Sleep** é cancelada ao acordar e registrada como erro.

## Organizando

- Arraste os blocos para movê-los. O layout é salvo.
- Para excluir uma linha, arraste uma das pontas para fora do ponto e solte em uma área vazia do canvas.
- Para excluir um bloco, clique nele e use **Excluir** no rodapé da janela de configurações. Selecionar um bloco ou uma linha e apertar Backspace também remove.
- Não dá para duplicar um bloco isolado. **Duplicate Workflow**, na página **Configurações** do workflow, copia tudo, e a cópia nasce desabilitada.
- Empilhe os blocos de cima para baixo, para que sejam lidos na direção em que rodam — as entradas ficam na borda de cima e as saídas na de baixo, então o fluxo desce naturalmente.

## Onde ler em seguida

- [Gatilhos de workflow](/docs/workflows/triggers) — as quatro formas de um workflow começar.
- [Componentes de workflow](/docs/workflows/components) — todos os blocos que você pode adicionar.
- [Variáveis de workflow](/docs/workflows/variables) — movendo dados entre blocos.
- [Execuções e registros de workflow](/docs/workflows/runs-and-logs) — conferindo o que aconteceu.
