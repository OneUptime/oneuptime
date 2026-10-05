# Criar um monitor

Um monitor verifica algo que você opera, como um site, uma API, um host ou um cluster Kubernetes, e avisa quando para de funcionar. **Criar monitor** pergunta primeiro o que monitorar, depois o que verificar e depois com que frequência. Tudo, exceto o tipo, o nome e o que verificar, começa com padrões que servem para a maioria dos monitores.

## Informações do Monitor

Vá até **Monitores** e clique em **Criar monitor**. A primeira pergunta é o **Tipo de monitor**: o que você quer monitorar?

- Os seis tipos que a maioria das pessoas cria vêm primeiro: **Website**, **API**, **Ping**, **Porta**, **SSL Certificate** e **Incoming Request**, para heartbeats de cron jobs e webhooks.
- **Mais tipos de monitor** lista todos os outros tipos sob a sua categoria, como **Infraestrutura** (Kubernetes, Docker, Host) e **Telemetria** (Registros, Métricas, Traços). **Manual**, um monitor cujo status você mesmo define, fica em **Other**.
- Ou digite na caixa de pesquisa. Ela conhece as palavras que você já usa, como `k8s`, `postgres`, `heartbeat` ou `tls`, e **Enter** escolhe o primeiro resultado.

O tipo escolhido encolhe para uma linha. Clique em **Alterar** para escolher outro; pressione **Esc** durante a escolha para manter o tipo que você tinha.

Depois preencha o **Nome**. Ele é usado nos alertas e nos títulos dos incidentes. **Descrição** e **Rótulos** são opcionais e ficam em **Mais campos**.

Um monitor **Manual** não precisa de mais nada, então **Criar monitor** está nesta etapa.

## Critérios

Esta etapa começa pelo que verificar. Para um site, é a URL dele, com um exemplo na caixa; outros tipos pedem um host, uma consulta, um cluster ou um filtro de logs. **Testar monitor** executa a verificação uma vez antes de salvar.

Abaixo, os **Critérios do monitor** decidem quando o monitor muda de status, declara um incidente ou cria um alerta. Um monitor novo começa com critérios que servem para a maioria dos monitores, cada um recolhido em uma linha que diz o que verifica e o que faz. Por exemplo, um monitor de site novo é marcado como offline e declara um incidente quando o site não responde ou responde com um código de status de erro. Clique em um critério para abri-lo e alterá-lo. **Adicionar critérios** adiciona um, aberto e pronto para preencher.

Nada nesta etapa é marcado como faltando até você clicar em **Próximo**.

## Sondas e intervalo

Os monitores que as sondas verificam terminam com esta etapa: Website, API, Ping, IP, Port, SSL Certificate, DNS, DNSSEC, Domain, SQL Query, Database Health, Synthetic Monitor, Custom JavaScript Code e External Status Page. As **Sondas** são as máquinas que executam as verificações, e as sondas padrão do seu projeto já vêm selecionadas. O **Intervalo de monitoramento** começa em **A cada 5 minutos**. Clique em **Criar monitor**.

Todos os outros tipos são criados a partir da etapa **Critérios**.

## Começar de um modelo ou de um link

Um modelo de monitor, e os links que criam um monitor em outras partes do OneUptime (em um gráfico de métricas, um dispositivo de rede ou uma regra de detecção), abrem **Criar monitor** com o tipo já escolhido e o restante preenchido. Clique em **Alterar** para escolher outro tipo. O formulário de um modelo usa o mesmo seletor de tipo: veja [Modelos de monitor](/docs/monitor/monitor-templates).
