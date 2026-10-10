# Criar um monitor

Um monitor verifica algo que você opera, como um site, uma API, um host ou um cluster Kubernetes, e avisa quando isso para de funcionar. **Criar monitor** pergunta primeiro o que monitorar, depois o que verificar e então com que frequência. Tudo, exceto o tipo, o nome e o que verificar, começa com padrões que servem para a maioria dos monitores.

> [!NOTE]
> Para criar um monitor, você precisa da função Project Owner, Project Admin, Project Member, Monitor Admin ou Monitor Member, ou de uma função personalizada com a permissão Create Monitor.

## Informações do Monitor

A primeira etapa pergunta o que monitorar e como chamar o monitor.

:::steps
### Abrir Criar monitor

Acesse **Monitores** e clique em **Criar monitor**. O formulário abre na primeira etapa, **Informações do Monitor**.

### Escolher o tipo de monitor

A primeira pergunta é o **Tipo de monitor**: o que você quer monitorar?

- Os seis tipos que a maioria das pessoas cria vêm primeiro: **Site**, **API**, **Ping**, **Porta**, **SSL Certificate** e **Incoming Request**, para heartbeats de cron jobs e webhooks.
- **Mais tipos de monitor** lista todos os outros tipos sob a sua categoria, como **Infraestrutura** (Kubernetes, Docker, host) e **Telemetria** (registros, métricas, traços). **Manual**, um monitor cujo status você mesmo define, fica em **Outro**.
- Ou digite na caixa de pesquisa. Ela conhece as palavras que você já usa, como `k8s`, `postgres`, `heartbeat` ou `tls`, e **Enter** escolhe o primeiro resultado.

O tipo escolhido encolhe para uma linha. Clique em **Alterar** para escolher outro; pressione **Escape** durante a escolha para manter o tipo que você tinha.

### Dar um nome ao monitor

Preencha o **Nome**. Ele é usado nos alertas e nos títulos dos incidentes. **Descrição** e **Rótulos** são opcionais e ficam em **Mais campos**.

Um monitor **Manual** não precisa de mais nada, então **Criar monitor** está nesta etapa. Para qualquer outro tipo, clique em **Próximo**.
:::

## Critérios

A segunda etapa pergunta o que verificar e decide o que conta como um problema.

:::steps
### Informar o que verificar

Esta etapa abre no que verificar. Para um site, é a URL dele, com um exemplo na caixa; outros tipos pedem um host, uma consulta, um cluster ou um filtro de logs. As configurações que a maioria dos monitores nunca altera, como tempos limite e novas tentativas, ficam recolhidas em **Mais campos**.

Para um monitor que as sondas verificam, **Testar monitor** executa a verificação uma vez antes de você salvar: escolha uma sonda em **Selecionar Sonda** e clique em **Executar teste**. A resposta abre em **Resultado do Teste do Monitor**.

### Revisar os critérios

Logo abaixo, os **Critérios do monitor** decidem quando o monitor muda de status, declara um incidente ou cria um alerta. Um monitor novo começa com critérios que servem para a maioria dos monitores, cada um recolhido em uma linha que diz o que verifica e o que faz. Um monitor de site novo, por exemplo, é marcado como offline e declara um incidente quando o site não responde ou responde com um código de status de erro.

Clique em um critério para abri-lo e alterá-lo. **Adicionar critérios** adiciona um, aberto e pronto para preencher. Para mudar a ordem, arraste um critério pela alça à esquerda dele.

### Ir para a próxima etapa

Clique em **Próximo**. Nada nesta etapa é marcado como faltando até você clicar em **Próximo**.
:::

### Como os critérios são avaliados

O resultado de cada verificação passa pelos critérios de cima para baixo, e o primeiro que corresponde decide o que acontece. Esse critério pode mudar o status do monitor, declarar um incidente, criar um alerta ou qualquer combinação dos três. Quando nenhum corresponde, o monitor mostra o seu **Status Padrão do Monitor**, definido em **Mais campos** abaixo dos critérios (**Operacional**, a menos que você escolha outro).

```mermaid title="De uma verificação a um status, um incidente ou um alerta"
flowchart TB
    check["O resultado de uma verificação"] --> criteria{"Primeiro critério<br/>que corresponde"}
    criteria -->|"Nenhum corresponde"| fallback["Status Padrão do Monitor"]
    criteria -->|"Um corresponde"| actions
    subgraph actions["O que esse critério faz"]
        direction LR
        status["Mudar o status"]
        incident["Declarar um incidente"]
        alert["Criar um alerta"]
    end
```

Incidentes e alertas configurados para se resolver automaticamente, como os dos critérios padrão, se resolvem sozinhos assim que o critério deixa de corresponder. Um monitor verificado por mais de uma sonda só muda quando as sondas concordam: por padrão, toda sonda ativada e conectada precisa chegar ao mesmo resultado. Para exigir menos, defina **Concordância de sondas** na página **Configuração → Sondas e intervalo** do monitor.

## Sondas e intervalo

Os monitores que as sondas verificam terminam com esta etapa: Site, API, Ping, IP, Porta, SSL Certificate, DNS, DNSSEC, NTP, Domínio, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code e External Status Page. As **Sondas** são as máquinas que executam as verificações, e as sondas padrão do seu projeto começam selecionadas. O **Intervalo de monitoramento** começa em **A cada 5 minutos**.

:::steps
### Escolher as sondas

Mantenha as **Sondas** selecionadas ou escolha outras. Um monitor sem sondas nunca é verificado. Para verificar algo em uma rede privada, execute uma [sonda personalizada](/docs/probe/custom-probe) dentro dessa rede e escolha-a aqui.

### Escolher com que frequência verificar

Escolha um **Intervalo de monitoramento**, de **A cada minuto** a **Toda semana**. Monitores Synthetic Monitor, Custom JavaScript Code e SSL Certificate recebem intervalos de 5 minutos ou mais.

### Criar o monitor

Clique em **Criar monitor**. A página do novo monitor abre. Para alterar as sondas ou o intervalo depois, abra **Configuração → Sondas e intervalo** nessa página.
:::

Todos os outros tipos, exceto Manual, são criados a partir da etapa **Critérios**.

## Começar de um modelo ou de um link

Um modelo de monitor, e os links que criam um monitor em outras partes do OneUptime (em um gráfico de métricas, um dispositivo de rede ou uma regra de detecção), abrem **Criar monitor** com o tipo escolhido e o resto preenchido. Clique em **Alterar** para escolher outro tipo. O formulário de um modelo usa o mesmo seletor de tipo: veja [Modelos de monitor](/docs/monitor/monitor-templates).

Cada tipo de monitor tem a sua própria página, com as suas configurações, os seus critérios padrão e exemplos. Bons lugares para continuar:

:::cards
- [Monitor de site](/docs/monitor/website-monitor): Verificar se uma página carrega, e o que ela responde.
- [Monitor de API](/docs/monitor/api-monitor): Chamar um endpoint com um método, cabeçalhos e um corpo.
- [Modelos de monitor](/docs/monitor/monitor-templates): Criar muitos monitores a partir de uma configuração e mantê-los alinhados.
- [Incidentes](/docs/incidents/index): O que acontece depois que um monitor declara um incidente.
:::
