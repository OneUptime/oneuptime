# Criar um painel

Crie um painel em **Dashboards → Create Dashboard**, dê um nome a ele e abra-o. O canvas abre no modo **Edit**, pronto para receber widgets.

## O canvas

Um painel é uma grade. O canvas padrão é **12 unidades de painel de largura** por **60 unidades de altura** — você pode aumentar a altura adicionando linhas além do fundo. Cada unidade é um quadrado que se ajusta à janela de visualização: em um desktop ele é mais largo do que em um celular, mas cada widget mantém suas proporções.

Os widgets ocupam um retângulo de unidades. Você decide tanto a posição (canto superior esquerdo, medido em unidades a partir do canto superior esquerdo do canvas) quanto o tamanho (largura e altura em unidades). Dimensões mínimas garantem que um widget minúsculo continue legível.

## Edit vs. View

A chave no cabeçalho da página alterna entre os dois modos:

- **Edit** — a paleta de widgets está aberta, os widgets podem ser arrastados e redimensionados, todo widget tem uma engrenagem de configurações. Use este modo durante a construção.
- **View** — o painel renderiza somente leitura, exatamente como alguém com acesso somente de visualização (ou um visitante público) o vê. Use este modo para conferir o resultado antes de compartilhar.

O mesmo painel é mostrado nos dois modos — não existe um passo separado de "publicar". Salvar uma edição entra em vigor imediatamente para todo visualizador.

## Adicionando um widget

1. Abra a paleta de widgets (o botão **+** no modo Edit).
2. Escolha o tipo de widget. Veja [Widgets](/docs/dashboards/widgets) para o catálogo.
3. O widget aterrissa no canvas na próxima posição livre com um tamanho padrão.
4. Clique na engrenagem do widget para abrir seu painel de configurações.
5. Configure a fonte de dados (consulta de métrica, filtro de lista, corpo de texto etc.) e quaisquer opções de exibição (limites, unidades, eixos, colunas).
6. Arraste o widget para posicioná-lo. Arraste um canto para redimensionar.

Repita. A grade encaixa os widgets em fronteiras de unidade inteira.

## Configurando fontes de dados

A maioria dos widgets lê de uma destas três origens:

- **Métricas** — uma consulta de métrica respaldada por ClickHouse. O widget monta um `metricQueryConfig` (uma única série) ou `metricQueryConfigs` (múltiplas séries empilhadas ou sobrepostas). O `transformAsRate` opcional converte um contador cumulativo do OpenTelemetry em uma taxa de variação. O `formula` opcional permite combinar duas consultas (por exemplo, contagem de erros / contagem total).
- **Listas de recursos em tempo real** — incidentes, alertas, monitores, recursos de Kubernetes, recursos de Docker, hosts. Cada widget de lista recebe um filtro (por exemplo, rótulos, status, namespace) e exibe as linhas correspondentes ao vivo.
- **Conteúdo estático** — o widget **Text** recebe um corpo em Markdown. Use para cabeçalhos, divisores, links de runbook e anotações do tipo "o que é este painel?".

Para widgets de métrica, a configuração espelha o construtor de consultas inline que você vê em outros lugares do OneUptime — escolha uma métrica, escolha uma agregação, adicione filtros `WHERE`, escolha um agrupamento temporal. A consulta roda contra os dados de telemetria do seu projeto.

## Limites e formatação

Widgets que exibem um único número (**Value**, **Gauge**) aceitam limites opcionais:

- **Warning threshold** — renderiza o valor em amarelo quando ele cruza esse limite.
- **Critical threshold** — renderiza o valor em vermelho quando ele cruza esse limite.

Gráficos permitem definir a unidade do eixo Y, a posição da legenda e se as séries devem ser empilhadas. Tabelas permitem escolher quais colunas exibir e o limite de linhas.

## Intervalo de tempo e atualização

O cabeçalho do painel carrega dois controles globais que afetam todo widget de métrica:

- **Time range** — escolha um preset (Última 1 hora, 24 horas, 7 dias, 30 dias) ou um intervalo personalizado. Todo widget de métrica consulta contra essa janela.
- **Refresh interval** — Off, 5s, 10s, 30s, 1m, 5m, 15m. Re-roda a consulta de cada widget na cadência escolhida. Widgets de lista que suportam websockets nativamente atualizam por push independentemente do intervalo escolhido.

Para widgets que ignoram o intervalo de tempo global (por exemplo, um bloco de texto), o controle é um no-op.

## Salvamento

O canvas salva automaticamente conforme você edita. Um pequeno indicador no cabeçalho avisa quando a alteração mais recente foi persistida. Não existe "publicar" — toda edição fica ao vivo no momento em que é salva. Se você está fazendo uma mudança arriscada, duplique o painel antes.

## Padrões que funcionam bem

- **Um tema por painel.** Resista à tentação de colocar "tudo o que monitoramos" em uma página. Três painéis rotulados `oncall-checkout`, `oncall-payments`, `oncall-search` envelhecem melhor do que um mega-painel.
- **Ancore o topo da página com o widget mais importante.** As pessoas leem de cima para baixo — garanta que a primeira coisa que elas veem é a resposta para "este sistema está saudável?".
- **Use widgets Text para rotular seções.** Um pequeno cabeçalho a cada poucas linhas ("Latência" / "Erros" / "Capacidade") torna o painel legível de longe.
- **Use variáveis em vez de duplicar.** Se você se pegar montando o mesmo painel duas vezes para dois serviços, você quer uma variável `service`. Veja [Variáveis e filtros](/docs/dashboards/variables).

## O que ler a seguir

- [Widgets](/docs/dashboards/widgets) — o catálogo e a configuração por widget.
- [Variáveis e filtros](/docs/dashboards/variables) — templating com variáveis, filtros de atributo e intervalo de tempo.
- [Compartilhamento e painéis públicos](/docs/dashboards/sharing) — tornar um painel acessível fora da equipe.
- [Configuração e permissões](/docs/dashboards/configuration) — propriedade e controle de acesso.
