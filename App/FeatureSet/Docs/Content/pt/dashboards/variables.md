# Variáveis e filtros

Uma variável transforma um único painel em um template. Defina uma variável `service` e o mesmo gráfico se renderiza para `checkout`, `payments` e `search` — escolha em uma lista suspensa no topo em vez de montar três painéis quase idênticos.

Esta página cobre os quatro tipos de variável, como seus valores são injetados nas consultas dos widgets e os controles globais de intervalo de tempo e atualização que ficam ao lado deles.

## Tipos de variável

Adicione variáveis em **Dashboard → Settings → Variables**. Cada uma tem um nome (referenciado como `{{name}}` nas consultas dos widgets), um rótulo opcional e um tipo.

### Custom List

Uma lista suspensa estática. Você fornece uma lista de valores separados por vírgula; o visualizador escolhe um.

Use quando: o conjunto de opções é pequeno, fixo e relevante apenas para sua equipe. `environment` com valores `prod, staging, dev`. `region` com valores `us-east-1, eu-west-1, ap-south-1`.

### Query

As opções da lista suspensa são calculadas por uma consulta ClickHouse no momento da renderização.

Use quando: as opções são dinâmicas e vivem na sua telemetria. "Todo ID de cliente que entrou nas últimas 24 horas" via `SELECT DISTINCT customer_id FROM ...`. A consulta roda contra os dados do seu projeto; trate o resultado como entrada não confiável mesmo sendo seus próprios dados.

### Text Input

Um campo de texto livre. O que quer que o visualizador digite é injetado.

Use quando: você quer que o painel se comporte como uma ferramenta de busca. Um painel "filtrar por IP" ou "filtrar por ID de requisição".

### Telemetry Attribute

As opções são os valores distintos de uma chave de atributo do OpenTelemetry em toda a telemetria do seu projeto, no intervalo de tempo do painel.

Configure a **chave de atributo** (por exemplo, `k8s.cluster.name`, `service.name`, `host.name`). O widget busca valores distintos em logs / métricas / traces e os oferece em uma lista suspensa.

Use quando: as opções são exatamente as entidades com que você já etiquetou sua telemetria. Nome do cluster, nome do serviço, região, ID do cliente, ambiente de deployment — qualquer coisa que você já envie como recurso ou atributo de span do OpenTelemetry.

Esse é o tipo de variável mais comum para painéis orientados a serviço porque ele se atualiza automaticamente: quando você lança um novo serviço etiquetado `service.name = inventory`, esse valor aparece na lista suspensa sem ninguém editar o painel.

## Multi-select

Cada variável pode ser configurada como **multi-select**. Quando ligado, o visualizador escolhe um ou mais valores; o painel filtra para `value IN (...)` em vez de `value = ...`.

Use multi-select quando: você quer olhar "checkout + payments juntos" sem sair do painel. Evite quando a matemática do gráfico não faz sentido entre valores selecionados — por exemplo, fazer médias de médias.

## Valores padrão

Toda variável aceita um valor padrão opcional. O painel renderiza com o padrão até que o visualizador altere a lista suspensa. Para painéis públicos, o padrão é o que os visitantes encontram ao chegar.

## Como funciona a interpolação

Em qualquer lugar onde uma consulta de widget recebe um filtro string — uma cláusula `WHERE` de uma consulta de métrica, o filtro de um widget de lista, a correspondência de atributo de um fluxo de log — você pode referenciar `{{variable_name}}`.

Por exemplo, a consulta de métrica de um Chart pode ser:

```
SELECT avg(latency_ms) FROM spans WHERE service.name = '{{service}}'
```

Quando `service` está definido como `checkout`, a consulta roda com `service.name = 'checkout'`. Quando o visualizador troca para `payments`, a consulta re-roda com `service.name = 'payments'`.

Para variáveis **Telemetry Attribute** especificamente, o OneUptime conhece a chave de atributo e injeta o filtro em todo widget que menciona o mesmo atributo — você não precisa editar manualmente a consulta de cada widget quando a variável muda. Essa é a mágica que faz painéis templados por serviço funcionarem prontos para uso.

## Intervalo de tempo

O cabeçalho do painel tem um seletor global de **intervalo de tempo**. Todo widget de métrica consulta contra essa janela. Escolhas:

- **Presets** — Última 1 hora, 24 horas, 7 dias, 30 dias, 90 dias (dependendo da sua retenção).
- **Intervalo personalizado** — escolha timestamps de início e fim.

O intervalo de tempo faz parte da URL do painel — compartilhar a URL compartilha a janela. Isso é conveniente durante um incidente: fixe o intervalo de tempo em "10:00–10:30 UTC hoje" e compartilhe o link no canal do incidente.

## Intervalo de atualização

Ao lado do intervalo de tempo, escolha com que frequência os widgets reconsultam:

- **Off** — os widgets consultam uma vez no carregamento.
- **5s / 10s / 30s / 1m / 5m / 15m** — auto-refresh.

O auto-refresh é conveniente para uma tela montada na parede e para uma visão de incidente em andamento. Para investigação ad hoc, deixe desligado para que a visão fique estável enquanto você rola.

## Juntando tudo

Um painel templado por serviço tipicamente tem:

1. Uma variável `service` do tipo **Telemetry Attribute** vinculada a `service.name`. Padrão: o serviço que você mais observa. Multi-select: desligado (para que os gráficos sempre mostrem um serviço por vez).
2. Uma variável `environment` do tipo **Custom List**. Padrão: `prod`.
3. Uma variável `cluster` do tipo **Telemetry Attribute** vinculada a `k8s.cluster.name`. Multi-select: ligado (para que você possa fazer rollup entre clusters).
4. Os widgets do painel referenciam essas variáveis em seus filtros.

O resultado: um painel, cobertura da frota inteira, algumas listas suspensas no topo.

## O que ler a seguir

- [Widgets](/docs/dashboards/widgets) — como cada widget consome um filtro.
- [Compartilhamento e painéis públicos](/docs/dashboards/sharing) — variáveis em URLs, incluindo seus valores para links compartilhados.
- [Criar um painel](/docs/dashboards/authoring) — a mecânica do canvas.
