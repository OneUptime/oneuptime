# Criando um Painel

Para criar um painel, abra **Dashboards → Criar Painel**, dê um nome a ele e abra-o. O canvas abre no modo **Edição**, pronto para você começar a adicionar widgets.

## O canvas

Um painel é uma grade. Os widgets se encaixam — você decide onde cada um fica e o tamanho. Você pode aumentar a página para baixo conforme adiciona mais linhas. Todo widget mantém suas proporções em telas maiores ou menores.

## Edição e Visualização

O alternador no cabeçalho troca entre dois modos:

- **Edição** — a paleta de widgets está aberta, você pode arrastar widgets pela página, redimensioná-los e clicar em qualquer widget para alterar suas configurações.
- **Visualização** — o painel é somente leitura, exatamente como visitantes e outros membros da equipe veem. Use este modo para conferir o resultado antes de compartilhar.

É o mesmo painel nos dois modos. Não há um passo separado de "publicar" — toda edição fica no ar no momento em que é salva.

## Adicionando um widget

1. Clique no botão **+** para abrir a paleta de widgets.
2. Escolha o tipo de widget. Veja [Widgets](/docs/dashboards/widgets) para o catálogo.
3. O widget aparece no canvas.
4. Clique no ícone de engrenagem no widget para abrir suas configurações.
5. Escolha a fonte de dados (uma métrica, um filtro de lista, um parágrafo de texto etc.) e quaisquer opções de exibição.
6. Arraste o widget para movê-lo. Arraste um canto para redimensionar.

## De onde vêm os dados

A maioria dos widgets lê de um destes três lugares:

- **Métricas** — escolha uma métrica e uma agregação (média, máximo, contagem, percentil). Adicione filtros. Escolha como agrupar o resultado. É o mesmo construtor de consultas que você vê em outros lugares do OneUptime.
- **Listas ao vivo** — incidentes, alertas, monitores, pods do Kubernetes, contêineres Docker, hosts. Cada widget de lista recebe um filtro e mostra os itens correspondentes, atualizados ao vivo.
- **Conteúdo estático** — o widget **Texto** recebe um bloco de Markdown. Use-o para títulos, contexto, links para runbooks ou notas temporárias durante um incidente.

## Limiares e formatação

Widgets de valor único (**Valor**, **Indicador**) permitem definir:

- Um **limiar de aviso** — a cor fica amarela quando o valor o ultrapassa.
- Um **limiar crítico** — a cor fica vermelha quando o valor o ultrapassa.

Gráficos permitem definir a unidade do eixo Y, escolher onde a legenda aparece e escolher se as séries se empilham ou se sobrepõem. Tabelas permitem escolher quais colunas mostrar e quantas linhas.

## Intervalo de tempo e atualização

No topo do painel, dois controles afetam todos os widgets de métricas:

- **Intervalo de tempo** — uma predefinição (última hora, 24 horas, 7 dias, 30 dias) ou um intervalo personalizado. Todo gráfico e número usa essa janela.
- **Atualização** — com que frequência os widgets reconsultam. Desligado, 5s, 10s, 30s, 1m, 5m, 15m. Listas ao vivo atualizam por conta própria, independentemente dessa configuração.

Widgets que não usam o intervalo de tempo (como um widget de Texto) ignoram ambos os controles.

## Salvando

O canvas salva por conta própria enquanto você trabalha. Um pequeno indicador no cabeçalho avisa quando a última alteração foi salva. Se você está fazendo uma mudança grande, duplique o painel primeiro para ter uma cópia segura.

## Dicas para painéis que envelhecem bem

- **Um tema por painel.** Evite colocar "tudo o que monitoramos" em uma só página. Alguns painéis focados valem mais que uma única página gigante.
- **Coloque o widget mais importante no topo.** As pessoas leem de cima para baixo — faça com que a primeira coisa que veem responda "este sistema está saudável?"
- **Marque seções com widgets de Texto.** Um título curto a cada poucas linhas ("Latência", "Erros", "Capacidade") torna a página legível de longe.
- **Use variáveis em vez de duplicar.** Se você está prestes a montar o mesmo painel para um segundo serviço, monte um painel com uma variável `service`. Veja [Variáveis e Filtros](/docs/dashboards/variables).

## O que ler em seguida

- [Widgets](/docs/dashboards/widgets) — o catálogo.
- [Variáveis e Filtros](/docs/dashboards/variables) — variáveis, filtros e o intervalo de tempo.
- [Compartilhamento e Painéis Públicos](/docs/dashboards/sharing) — compartilhando fora da sua equipe.
- [Configuração e Permissões](/docs/dashboards/configuration) — donos e controle de acesso.
