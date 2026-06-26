# Variáveis e Filtros

Uma variável transforma um único painel em um template. Adicione uma variável `service` ao seu painel e os mesmos gráficos são renderizados novamente para `checkout`, `payments` ou `search` — os visualizadores escolhem em um dropdown no topo em vez de você construir três painéis quase idênticos.

## Tipos de variável

Adicione variáveis em **Painel → Configurações → Variáveis**. Cada variável tem um nome (usado como `{{name}}` nos seus widgets), um rótulo opcional e um tipo.

### Lista Customizada

Um dropdown estático. Você digita as opções por conta própria.

Use quando: as opções são poucas e fixas. `environment` com valores `prod, staging, dev`. `region` com valores `us-east-1, eu-west-1, ap-south-1`.

### Consulta

As opções vêm de uma consulta aos seus dados.

Use quando: as opções mudam ao longo do tempo e você quer que o dropdown acompanhe. "Todo ID de cliente visto nas últimas 24 horas." A consulta roda sobre os dados do seu projeto e os resultados se tornam o dropdown.

### Campo de Texto

Um campo de texto livre. O que o visualizador digitar é usado.

Use quando: você quer que o painel funcione como uma ferramenta de busca. Filtrar por endereço IP, ID de requisição ou qualquer outro valor de forma livre.

### Atributo de Telemetria

As opções são os valores distintos de um atributo na sua telemetria dentro do intervalo de tempo do painel.

Configure a **chave do atributo** (por exemplo, `service.name`, `host.name`, `k8s.cluster.name`). O dropdown se preenche com todos os valores distintos vistos nos seus logs, métricas e traces.

Use quando: as opções correspondem às tags que você já envia com sua telemetria. Este é o tipo mais comum porque ele se atualiza automaticamente — quando você lança um novo serviço com a tag `service.name = inventory`, esse nome aparece no dropdown sem você editar o painel.

## Seleção múltipla

Cada variável pode permitir múltiplas seleções. Quando ligado, o visualizador pode escolher um ou mais valores; o painel filtra para qualquer um deles.

Use seleção múltipla quando: você quer comparar "checkout e payments juntos" sem sair do painel. Evite quando a matemática não funciona entre os valores selecionados (por exemplo, fazer média de médias).

## Valores padrão

Toda variável pode ter um valor padrão. O painel é renderizado com o padrão até que o visualizador o altere. Para painéis públicos, o padrão é o que os visitantes veem primeiro.

## Como usar uma variável em um widget

Em qualquer lugar em que um widget aceite um filtro — um `WHERE` de métrica, o filtro de uma lista, a correspondência de atributo de um fluxo de logs — você pode usar `{{variable_name}}`.

Por exemplo, um gráfico filtrado por serviço:

```
service.name = '{{service}}'
```

Quando o dropdown está em `checkout`, o gráfico filtra para o serviço de checkout. Quando o visualizador muda para `payments`, o gráfico é renderizado novamente para payments.

Para variáveis do tipo **Atributo de Telemetria**, o OneUptime sabe a qual atributo a variável corresponde e aplica o filtro a todo widget que usa o mesmo atributo — você não precisa editar cada widget manualmente.

## Intervalo de tempo

O cabeçalho do painel tem um intervalo de tempo global. Todo widget de métrica consulta dentro dessa janela. Opções:

- **Predefinições** — última hora, 24 horas, 7 dias, 30 dias, 90 dias (dependendo da retenção dos seus dados).
- **Personalizado** — escolha uma hora de início e fim.

O intervalo de tempo faz parte da URL do painel — compartilhar a URL compartilha a janela. Útil durante um incidente: fixe o intervalo em "10:00–10:30 UTC de hoje" e cole o link no canal do incidente.

## Intervalo de atualização

Ao lado do intervalo de tempo, escolha com que frequência os widgets reconsultam:

- **Desligado** — os widgets consultam uma vez quando a página carrega.
- **5s / 10s / 30s / 1m / 5m / 15m** — atualização automática.

A atualização automática é boa para uma tela na parede ou uma visualização de incidente ao vivo. Deixe desligada quando estiver investigando para que a tela fique parada enquanto você analisa.

## Juntando tudo

Um painel templado por serviço geralmente tem:

1. Uma variável `service` do tipo **Atributo de Telemetria** para `service.name`. Padrão: seu serviço mais observado. Seleção múltipla desligada (para que os gráficos sempre mostrem um por vez).
2. Uma variável `environment` do tipo **Lista Customizada**. Padrão: `prod`.
3. Uma variável `cluster` do tipo **Atributo de Telemetria** para `k8s.cluster.name`. Seleção múltipla ligada (para que você possa comparar entre clusters).
4. Widgets que referenciam essas variáveis nos seus filtros.

O resultado: um único painel, todos os serviços cobertos, três dropdowns no topo.

## O que ler em seguida

- [Widgets](/docs/dashboards/widgets) — como cada widget usa um filtro.
- [Compartilhamento e Painéis Públicos](/docs/dashboards/sharing) — variáveis e links compartilhados.
- [Criando um Painel](/docs/dashboards/authoring) — a mecânica do canvas.
