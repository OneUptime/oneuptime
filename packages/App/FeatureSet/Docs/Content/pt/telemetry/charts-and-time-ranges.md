# Aplicar zoom em um intervalo de tempo

Arraste sobre um gráfico para aplicar zoom na página até aquele momento, e clique duas vezes para voltar. Esta página explica os gestos, como um zoom se comporta e quais gráficos aplicam zoom em quê.

:::cards
- [Aplicar zoom e voltar](#aplicar-zoom-e-voltar): Os dois gestos e o botão Reset zoom.
- [Como o zoom se comporta](#como-o-zoom-se-comporta): Zooms aninhados, atualização automática, cliques e arrastos.
- [Onde funciona](#onde-funciona): As páginas e os gráficos cujo intervalo um arrasto muda.
- [Gráficos sem zoom](#gráficos-sem-zoom): Faixas, medidores e sparklines.
:::

## Aplicar zoom e voltar

Todo gráfico de série temporal no OneUptime também funciona como seletor de intervalo de tempo. Quando um gráfico mostra um pico que você quer examinar, não é preciso abrir o seletor e digitar datas:

:::steps
1. **Arraste sobre o pico** em qualquer gráfico. O intervalo de tempo da página passa para a janela que você traçou, exatamente como se você a tivesse escolhido no seletor de intervalo. Cada gráfico, e cada bloco ou tabela calculado a partir do intervalo da página, refaz a consulta para ela, então você lê o mesmo momento em todos.
2. **Clique duas vezes em qualquer gráfico** para voltar. A página volta ao intervalo de tempo que tinha antes de você começar a aplicar zoom.
:::

Os painéis que mostram o estado atual continuam no agora, assim como quando você escolhe um intervalo: contagens de inventário, saúde, maiores consumidores de recursos, avisos recentes, incidentes e alertas abertos e as listas ao vivo de um painel.

Enquanto um zoom está ativo, um botão **Reset zoom** aparece ao lado do seletor de intervalo de tempo da página. Ele faz o mesmo que um clique duplo e é o caminho de volta para quem usa o teclado e em telas sensíveis ao toque.

```mermaid title="O que um arrasto, um clique duplo e o seletor fazem com o intervalo da página"
stateDiagram-v2
    state "Intervalo do seletor" as Picked
    state "Janela com zoom" as Zoomed
    [*] --> Picked
    Picked --> Zoomed: arrastar sobre um gráfico
    Zoomed --> Zoomed: arrastar de novo
    Zoomed --> Picked: clique duplo ou Reset zoom
    Zoomed --> Picked: escolher um intervalo
```

## Como o zoom se comporta

- **Aplique zoom o quanto quiser; uma única redefinição sai de tudo.** Depois de passar de "Past 1 Hour" para dez minutos e depois para um, um único clique duplo (ou **Reset zoom**) devolve a hora inteira em vez de subir um nível de cada vez.
- **Qualquer gráfico pode redefinir qualquer zoom.** Arraste no gráfico de CPU e clique duas vezes no de memória: quem está com zoom é a página, não o gráfico.
- **Escolher você mesmo um intervalo recomeça do zero.** Uma predefinição ou um intervalo personalizado no seletor é um novo ponto de partida: o zoom acaba e **Reset zoom** some.
- **Uma janela com zoom é fixa.** "Past 30 Minutes" avança com o relógio; um zoom é uma janela fixa, então para de avançar enquanto a atualização automática está ligada. Redefina o zoom para que volte a avançar.
- **Um zoom nunca passa do agora.** O bucket mais recente de um gráfico costuma ainda estar se enchendo; um arrasto que termina nele é cortado no horário atual.
- **Você pode soltar o mouse fora do gráfico**: o arrasto conta mesmo assim.
- **Não é preciso esperar os gráficos carregarem para voltar.** Logo após um zoom, enquanto os gráficos ainda buscam a janela traçada, ou quando essa janela acaba vazia, um clique duplo em um gráfico redefine o zoom na hora.
- **Clicar duas vezes em uma página sem zoom não faz nada.**

### Cliques e arrastos

- **Em gráficos de linhas, áreas e barras, um clique simples não é um zoom.** Isso vale para a maioria dos gráficos: cartões de métricas e o explorador de métricas, visões gerais de recursos, SLOs, monitores e todo gráfico de um painel. Só um arrasto por vários buckets aplica zoom, então clicar em um ponto, uma barra ou uma entrada da legenda continua fazendo o que fazia antes. Enquanto um zoom está ativo, um clique na área de plotagem de um gráfico só tem efeito um instante depois, para ser diferenciado do clique duplo que redefine. A linha do tempo de padrões de erro nos Insights de registros e o Occurrence Trend de uma exceção também só aplicam zoom com um arrasto.
- **Nos gráficos de volume dos exploradores, um clique em uma barra aplica zoom nessa barra.** Os gráficos de volume dos exploradores de registros, traces, exceções e eventos de segurança, e os gráficos de análise de registros e traces, aplicam zoom nas barras sobre as quais você arrasta, ou na barra em que você clica. Esses gráficos mostram **Click or drag to zoom**.

### Dicas nos gráficos

A maioria dos gráficos com zoom indica o gesto acima da área de plotagem, **Drag to zoom** ou **Click or drag to zoom**, e, enquanto um zoom está ativo, acrescenta o lembrete **double-click to reset**. Os cartões de métricas, o explorador de métricas e os gráficos de volume dos exploradores sempre mostram a dica. Nos cartões de gráficos das visões gerais de recursos e dos SLOs, e em alguns widgets de painel, ela só aparece enquanto você aponta para o cartão ou entra nele com a tecla Tab.

## Onde funciona

O zoom muda o intervalo da página inteira em:

- visões gerais de recursos e suas páginas de Insights: clusters Kubernetes, hosts Docker, Podman e Docker Swarm, hosts e seus processos, serviços e unidades do systemd, VMware, Proxmox, Ceph, arrays de armazenamento, bancos de dados, recursos de nuvem e funções serverless;
- serviços e aplicações de RUM;
- métricas e tráfego de dispositivos de rede;
- cartões de métricas, incluindo a aba Métricas de um recurso e as métricas de um monitor;
- o explorador de métricas;
- gráficos de histórico de SLO;
- Insights de registros, incluindo a linha do tempo "Quando aconteceu" de um padrão de erro, cujo painel tem o próprio **Reset zoom** porque cobre o seletor da página;
- gráficos de volume de registros, traces, exceções e eventos de segurança, e os gráficos de análise de registros e traces, que mudam o intervalo do explorador a que pertencem;
- [painéis](/docs/dashboards/authoring), onde um arrasto muda o intervalo do painel inteiro.

Gráficos com uma janela própria aplicam zoom só nessa janela, então nunca mudam nada mais na página. Isso inclui a prévia de uma métrica no formulário de um monitor (o monitor continua avaliando a própria janela móvel), o Occurrence Trend de uma exceção, um gráfico aberto em um pop-up ou no painel de investigação e os gráficos nas respostas do chat de IA. Um clique duplo em um deles, ou no seu botão **Reset zoom**, restaura a janela própria dele.

O instantâneo de telemetria na página de um incidente, um alerta ou um episódio também tem uma janela própria. Um arrasto no gráfico dele (o gráfico de métrica, ou o gráfico de volume de registros, traces ou exceções quando é isso que o instantâneo mostra) aplica zoom em todo o instantâneo, então as abas Métricas, Registros, Traces e Exceções mostram o trecho que você traçou. **Reset zoom** ao lado do selo do instantâneo, ou um clique duplo nesse gráfico, restaura a janela do instantâneo.

## Gráficos sem zoom

Algumas visualizações não têm um eixo de tempo para arrastar, são pequenas demais para isso ou sempre mostram uma janela fixa própria, então não aplicam zoom:

- faixas de histórico de disponibilidade (uma barra por dia), que não conseguem mostrar nada mais fino que um dia;
- barras de participação e proporção, medidores e barras de progresso;
- gráficos de chama, mapas de serviços e diagramas de fluxo;
- as pequenas sparklines de tendência nas listas de métricas, onde um clique abre a métrica: abra-a para ter um gráfico com zoom;
- pequenas sparklines com uma janela fixa própria, como o tempo de ida e volta de um dispositivo de rede na última hora: o link **Open metrics** delas leva a gráficos em que você pode aplicar zoom.

## Próximos passos

:::cards
- [Criar um painel](/docs/dashboards/authoring): O zoom funciona em todos os gráficos de um painel.
- [Sintaxe de pesquisa](/docs/telemetry/search-syntax): Filtrar os exploradores depois de encontrar o momento.
- [Monitor de métricas](/docs/monitor/metrics-monitor): Alertar sobre a métrica que você estava olhando.
:::
