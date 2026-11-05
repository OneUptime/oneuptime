# Nuvens OpenStack muito grandes

O que uma nuvem de qualquer tamanho custa antes de você instalar qualquer coisa: o quanto o monitoramento pesa sobre o plano de controle dela, quantos dados ele envia e o que o OneUptime faz de diferente à medida que a nuvem cresce. Quase toda nuvem deveria dispensar isto: pelas contagens abaixo, os padrões do [agente OpenStack](/docs/telemetry/openstack) e de uma [sonda](/docs/telemetry/openstack-agentless) aguentam milhares de instâncias sem que nada precise ser configurado.

:::cards
- [A carga sobre o seu plano de controle](#a-carga-sobre-o-seu-plano-de-controle): Requisições por minuto por serviço, em cada tamanho.
- [Os dados que ele envia](#os-dados-que-ele-envia): Séries e gigabytes por dia, a partir das contagens da sua nuvem.
- [Modo resumo](#modo-resumo): O que uma nuvem acima de 5.000 instâncias mantém e o que deixa de ter.
- [Compartilhar uma nuvem entre coletores](#compartilhar-uma-nuvem-entre-coletores): Um agente por região ou por serviço.
- [O caminho pelo banco de dados](#o-caminho-pelo-banco-de-dados): Ler as maiores nuvens a partir dos seus bancos de dados.
- [A que o maior tamanho foi submetido](#a-que-o-maior-tamanho-foi-submetido): Uma hora com 200.000 instâncias, com seus orçamentos e o que foi medido.
:::

## A carga sobre o seu plano de controle

### Por uma sonda

Uma sonda se mantém dentro de uma carga declarada, por maior que seja a nuvem. Ela consulta cada serviço com uma requisição por vez, o Placement com quatro, lê as instâncias pelo que mudou entre leituras completas e, acima de um número declarado, lê em rodízio o que é uma chamada por item (os usos de um hipervisor, os agentes de um roteador, as cotas de um projeto). Cada coleta envia tudo como na última leitura, então nenhuma série tem lacuna: só muda o quão recentes são essas partes.

Requisições por minuto com os padrões, depois que uma coleta se estabilizou, em uma nuvem com OVN:

| Nuvem | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hipervisores, 100 instâncias, 20 projetos | 1,3 | 3,5 | 12,5 | 3,5 | 2,5 | 0,3 |
| 500 hipervisores, 20.000 instâncias, 1.000 projetos | 1,3 | 4,2 | 253 | 7,5 | 8,5 | 0,3 |
| 5.000 hipervisores, 200.000 instâncias, 10.000 projetos | 1,3 | 12,7 | 1.003 | 43,5 | 62,5 | 0,5 |

Esses números são contados, não estimados: um teste executa o coletor real contra uma API simulada de cada tamanho, em um relógio que ele mesmo move, e confronta o que foi pedido com esses números exatamente, serviço por serviço, sempre que algo diferente vence. Uma contagem de requisições não depende da máquina em que foi contada.

O que cada tamanho contém além de seus hipervisores, instâncias e projetos é presumido, e uma nuvem real é diferente: um volume a cada segunda instância, um snapshot e um backup a cada décimo volume, uma rede, sub-rede, roteador e grupo de segurança por projeto, um IP flutuante a cada décima instância, 40 flavors, dois agentes do Neutron por hipervisor e uma imagem a cada dez projetos, entre 10 e 1.000. Uma lista custa uma requisição por mil linhas, então o que sua nuvem realmente contém altera esses números só um pouco. O que mais os altera:

| O que muda | O que custa |
| --- | --- |
| A primeira coleta depois que uma sonda inicia | Uma chamada para os inventários de cada hipervisor e uma para os usos dele, não importa quantos sejam |
| ML2/OVS em vez de OVN | Uma chamada por roteador para perguntar quais agentes L3 o guardam, no máximo 2.000 por coleta |
| Instâncias mudando | Uma chamada ao Nova por instância que mudou, para ler o que aconteceu com ela, no máximo 25 por coleta |
| [Limites de projeto](/docs/telemetry/openstack-agentless#o-que-isso-custa-à-sua-nuvem) ativados | Quatro chamadas por projeto, no máximo 250 projetos por coleta, então uma nuvem de 10.000 leva 80 minutos para dar a volta |
| Coletar com menos frequência | **Coletar a cada** na página **Configurações** da nuvem. O dobro do tempo é metade das chamadas |
| Mais regiões | Tudo, exceto o Keystone, de novo por região |

Uma coleta tem nove décimos do seu intervalo, e no máximo dez minutos, e cada serviço é lido com uma requisição por vez. Portanto, a rapidez com que as APIs de uma nuvem grande respondem decide com que frequência ela pode ser coletada: com 200.000 instâncias e os dois minutos padrão, o Nova precisa responder a cada página da sua leitura completa em cerca de meio segundo, e o Cinder suas listas em cerca de 0,8 segundo. Um serviço que não consegue terminar aparece como fora do ar até conseguir, e o cartão mostra **A coleta demorou demais**. Aumente **Coletar a cada**, o que também reduz a carga, ou use o [caminho pelo banco de dados](#o-caminho-pelo-banco-de-dados).

### Pelo agente

O exportador do agente faz login e lê toda lista por inteiro a cada coleta, e pergunta ao Placement três coisas por hipervisor, uma chamada por vez. Requisições por minuto com os padrões:

| Nuvem | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hipervisores, 100 instâncias, 20 projetos | 3,4 | 3 | 15,5 | 3,5 | 2 | 0,2 |
| 500 hipervisores, 20.000 instâncias, 1.000 projetos | 3,4 | 13 | 751 | 7,5 | 7,5 | 0,2 |
| 5.000 hipervisores, 200.000 instâncias, 10.000 projetos | 3,4 | 106 | 7.501 | 43,5 | 57 | 0,4 |

Esses números são contados a partir do código-fonte do exportador, e o exportador não foi executado nesses tamanhos. Uma coleta tem 110 segundos, então um Placement que responde em 20 ms fica sem tempo com cerca de 1.800 hipervisores, e o Nova, a um segundo por página, com cerca de 110.000 instâncias. Acima disso, uma coleta deles falha por mais gentil que seja o pedido. Acima desses tamanhos, use o [caminho pelo banco de dados](#o-caminho-pelo-banco-de-dados) ou uma sonda.

### Quando uma API fica lenta

Uma sonda observa em quanto tempo cada serviço costuma responder, e recua quando uma resposta é lenta ou recusada: [O que custa à sua nuvem](/docs/telemetry/openstack-agentless#o-que-isso-custa-à-sua-nuvem) diz em quanto. Várias leituras esperando ao mesmo tempo se revezam, então uma pausa não termina em uma rajada. Nada mais fica retido: cada serviço é consultado por conta própria.

O cartão **Coleta de dados** da nuvem informa isso enquanto durar, serviço por serviço: quão lenta foi a resposta mais lenta e por quanto tempo a sonda se conteve. O exportador do agente não consegue fazer isso. Uma coleta executa inteira, no seu intervalo: aumente `scrape_interval` e `scrape_timeout` desse job para pesar menos sobre um serviço.

## Os dados que ele envia

As séries de uma nuvem decorrem das suas contagens. A calculadora em **OpenStack → Documentação** no OneUptime calcula isso a partir de três números. Para calcular você mesmo, para uma região:

| Série | Quantas |
| --- | --- |
| Compute | 10 por hipervisor, mais flavors e serviços de controle, mais 7 |
| Placement | 15 por hipervisor, mais 4. Uma sonda acrescenta cerca de 2 por flavor, para [quantos de cada cabem](/docs/telemetry/openstack#capacidade) |
| Neutron | Agentes, redes, roteadores e IPs flutuantes, 3 por sub-rede, mais 11. Mais uma por roteador no ML2/OVS |
| Cinder | Serviços, snapshots e backups, 2 por pool de armazenamento, mais 26 |
| Instâncias e volumes, a menos que o modo resumo esteja ativado | 4 por instância, 2 por volume |
| Contagens do modo resumo, quando ele está ativado | Uma por status e uma por projeto: cerca de 6 mais os projetos |
| Keystone, Glance | Projetos, domínios e 9, e 2 por imagem mais 5. Uma sonda acrescenta 3 para cada um entre Heat e Magnum, quer a nuvem os execute ou não |

As linhas de cada coleta são o que você paga: as cinco primeiras chegam a cada 2 minutos, 720 vezes por dia, e a última a cada 5 minutos, 288 vezes. O preço é o da sua fatura, [por GB pelo tempo em que é mantido](/docs/telemetry/data-retention#quanto-custa-a-retenção). A fatura lê o tamanho real de cada linha, e este cálculo usa 1.024 bytes por linha, o que o faturamento do OneUptime usa quando não tem o tamanho de uma linha. Uma linha com muitos rótulos, como a de uma instância, custa mais que isso, e uma sem nenhum custa menos.

| Nuvem | Séries | GB por dia, todas as séries | GB por dia, no modo resumo | Um mês mantido por 15 dias, no modo resumo |
| --- | --- | --- | --- | --- |
| 10 hipervisores, 100 instâncias, 20 projetos | 1.084 | 0,7 | Não está no modo resumo | $2,12 |
| 500 hipervisores, 20.000 instâncias, 1.000 projetos | 123.856 | 84,5 | 16,6 | $49,71 |
| 5.000 hipervisores, 200.000 instâncias, 10.000 projetos | 1.237.192 | 844,5 | 164,9 | $494,73 |

Esses valores são pelo agente, com uma instância em mil em um estado que mantém suas séries. Uma sonda acima do tamanho do resumo envia o que não mudou uma vez por ciclo em vez de a cada coleta, o que dá cerca de 13,2 GB por dia no segundo tamanho e 116 GB no terceiro.

O uso real por instância, do libvirt ou do Ceilometer, vem além de tudo isto: veja [quanto custa](/docs/telemetry/openstack#quanto-custa).

## Modo resumo

Acima de 5.000 instâncias, uma nuvem mantém contagens e linhas, em vez de uma série por instância. Nesse tamanho, essas séries são a maior parte da fatura, com cerca de 17 GB por dia contra 4 GB para todo o resto, e dizem o que as linhas e as contagens já dizem.

**O que ele mantém:**

- Uma linha para cada parte, em todas as páginas e listas, mantida atualizada. As mudanças de status chegam a ela normalmente.
- Todas as séries de hipervisores, workers, redes, roteadores, IPs flutuantes, pools de endereços e pools de armazenamento.
- `openstack_nova_instances_by_status` e `openstack_nova_instances_by_project`, em cada região.
- As séries de qualquer instância ou volume em um estado que um alerta observa: em `ERROR`, ou preso em `BUILD`, `RESIZE`, `attaching` e semelhantes. Assim todo [modelo de alerta](/docs/monitor/openstack-monitor#templates-de-alerta-prontos) continua funcionando e continua se recuperando sozinho.

**O que ele deixa de ter:**

- O histórico do status de cada instância e volume estabilizado, e um gráfico ou monitor sobre essas séries. `openstack_nova_server_status`, `openstack_cinder_volume_gb` e `openstack_cinder_volume_status` deixam de ser enviadas para uma parte assim que ela se estabiliza. Um monitor que precise de uma instância deve escolher o projeto dela, abaixo.
- `openstack_placement_resource_provider_allocations` e `openstack_nova_server_local_gb`, de quem quer que sejam. Uma sonda deixa de pedir alocações ao Placement por completo.

**Para manter as séries de uma instância mesmo assim**, abra as **Configurações** da nuvem e depois **Uso real por instância**. **Somente os projetos e agregados que eu escolher** mantém todas as instâncias e volumes desses projetos, seja qual for o tamanho da nuvem. **Cada instância** desativa o modo resumo para a nuvem inteira. Uma sonda recusa isso acima de cerca de 480 MiB de métricas por coleta, em vez de manter isso na memória: use o agente para uma nuvem assim.

**Por uma sonda** há mais uma diferença. Acima do tamanho do resumo, ela lê tudo toda vez e envia apenas o que mudou, o que alguém escolheu, o que um alerta observa e uma parte do restante. Cada parte volta uma vez por ciclo, dimensionado para que o envio de uma coleta fique em cerca de 24 MiB além das séries que vão sempre: 6 minutos com 20.000 instâncias, 44 com 200.000. O cartão **Coleta de dados** informa a duração do ciclo. Duas coisas decorrem disso:

- **As listas de uma nuvem nova são preenchidas durante o primeiro ciclo.** A primeira coleta sabe o que a nuvem contém, e o cartão informa isso de imediato, mas suas linhas chegam uma parte por vez. O mesmo vale para uma sonda que reiniciou, embora as linhas que ela deixou permaneçam nas páginas nesse meio tempo. O cartão informa quando todas terão chegado.
- **Uma parte que sumiu continua listada por um pouco mais de tempo.** Ela sai em até 15 minutos sem que nada a reporte, mais o ciclo, mais duas leituras. Ou seja, 15 minutos e alguns na maioria das nuvens, e pouco mais de uma hora com 200.000 instâncias. Uma parte que ainda existe nunca é removida. Uma leitura que falha não remove nada, por mais que dure.

## Compartilhar uma nuvem entre coletores

Um agente lê uma nuvem com quantas regiões ela tiver, e é por isso que se deve começar. Quando um só é demais para a máquina em que executa ou para o tempo de uma coleta, dê a cada agente uma parte. Todos eles enviam para a mesma nuvem do OneUptime sob o mesmo `OPENSTACK_CLOUD_NAME`. Duas regras evitam que um gráfico e uma fatura contem em dobro:

- **Cada par de região e serviço pertence a um agente.** Uma linha é a mesma linha por mais agentes que a reportem, mas as séries de cada agente são armazenadas e cobradas.
- **O Keystone pertence a um agente.** Ele é um só para a nuvem inteira, qualquer que seja a região que o consulte.

**Um agente por região** é o que a maioria das nuvens quer. Liste apenas as entradas dessa região em `clouds.yaml` e `OPENSTACK_EXPORTER_CLOUDS`. Somente o primeiro agente fica com o Keystone. Um agente que define `OPENSTACK_AGENT_SERVICES` lê apenas o que ele nomeia, então acrescente qualquer outro serviço que a sua nuvem execute, como `load-balancer`:

```bash
# On the agent for RegionOne, in .env
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionOne]

# On the agent for RegionTwo
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionTwo]
OPENSTACK_AGENT_SERVICES=compute|placement|network|volume|image
```

**Um agente por serviço** é para as maiores nuvens, em que as listas de um serviço são o que uma coleta não consegue terminar. `OPENSTACK_AGENT_SERVICES` mantém os jobs que nomeia e deixa o restante para outro agente:

```bash
# Nova and Placement, which take the most
OPENSTACK_AGENT_SERVICES=compute|placement

# And the rest: add any other service you run, such as load-balancer
OPENSTACK_AGENT_SERVICES=identity|network|volume|image
```

Defina `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` em um agente que tenha uma parte grande: ele mantém uma coleta na memória a caminho do envio, e o padrão é 512 MiB. Uma linha é garantida pelo seu próprio serviço na sua própria região, então um agente que para não leva nada do que outro agente lê. Informe aquilo em que a nuvem se apoia, os `OPENSTACK_RABBITMQ_TARGETS` e [os outros semelhantes](/docs/telemetry/openstack#variáveis-de-ambiente), em apenas um agente. Se esse agente parar enquanto os outros continuam, essas máquinas saem das páginas após 15 minutos e voltam quando ele voltar.

**Com sondas**, uma nuvem tem uma sonda. Dê a uma região uma sonda própria conectando-a como uma nuvem independente, com apenas essa região escolhida: nada é contado em dobro, porque cada uma lê apenas a sua região, e cada uma lê o Keystone por conta própria. Cada uma passa então a ser uma nuvem independente no OneUptime, com suas próprias páginas e seus próprios alertas.

## O caminho pelo banco de dados

Acima de **1.500 hipervisores ou 100.000 instâncias**, o agente pode ler os bancos de dados de uma nuvem em vez das APIs, com o [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter). Nesse tamanho, uma coleta das APIs fica sem tempo, e leituras que não conseguem terminar são carga à toa. Uma leitura de banco de dados não custa nada às APIs. Ele só é oferecido acima desse tamanho porque abaixo dele as APIs respondem bem o bastante e esse caminho abre mão de coisas.

**O que ele pede de você:**

- Uma conta somente leitura no banco de dados de cada serviço: Nova, Nova API, Placement, Neutron, Cinder, Glance e Keystone. Um banco de dados deixado de fora é um serviço que ele não consulta.
- Uma rota da máquina do agente até esses bancos de dados, que na maioria das nuvens são mantidos bem longe de tudo o mais. É mais uma coisa que pode ler os registros de todos os projetos.
- Um exportador por região, e por célula do Nova. Ele lê o que você apontar, e uma segunda célula precisa de um segundo exportador.
- Seus esquemas acompanhando a sua versão. Ele lê diretamente as tabelas de cada serviço, então uma atualização do OpenStack pode mudar o que ele consegue ler antes de uma nova versão do exportador.

**Para ativá-lo**, no `.env`:

```bash
COMPOSE_PROFILES=openstack-database-exporter
# Read from the databases, and from nowhere else: with the two together every series arrives twice.
OPENSTACK_EXPORTER_CLOUDS=[]
OPENSTACK_DATABASE_EXPORTER_TARGETS=[openstack-database-exporter:9180]
# What a hypervisor's full name adds to Nova's host name, so an instance finds its hypervisor.
OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX=.example.org
# oslo.db's form. Each is kept in .env, which only its owner can read.
NOVA_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova
NOVA_API_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova_api
PLACEMENT_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/placement
NEUTRON_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/neutron
CINDER_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/cinder
GLANCE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/glance
KEYSTONE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/keystone
# What a database cannot say, from the API: each is one small list a scrape.
OPENSTACK_WORKER_STATE_CLOUDS=[RegionOne]
```

**O que ele cobre.** As mesmas séries com os mesmos nomes, então toda página, monitor e modelo de alerta as lê da mesma forma. Um teste as confronta com as do exportador de API, nome por nome e rótulo por rótulo.

**O que ele não cobre:**

| O quê | Por quê, e o que acontece no lugar |
| --- | --- |
| Se cada worker do Nova está vivo | O `openstack_nova_agent_state` dele vale 1 para qualquer serviço habilitado, então um `nova-compute` parado apareceria como ativo. O agente descarta essa série e a lê da API do Nova, que é uma lista pequena |
| Quão cheio está cada pool de armazenamento | Cada backend informa isso ao scheduler do Cinder, e isso não está no banco de dados. O agente lê da API do Cinder, que é mais uma lista |
| O MTU de uma rede | Aparece como desconhecido |
| `openstack_placement_resource_provider_allocations`, a generation de um provider | Nada os lê |
| Cotas e limites por projeto | Ele consegue lê-los, e com 10.000 projetos são 790.000 pontos de dados por coleta, então o agente os deixa de fora. Exclua essa regra em `otel-collector-config.yaml` para mantê-los |
| Se uma API responde | `openstack_<service>_up` informa se o banco de dados dela responde. Uma API parada com o banco de dados saudável aparece como ativa, então observe as próprias APIs com um [monitor de site](/docs/monitor/website-monitor) |

**Até onde isso está comprovado.** As séries foram lidas do código-fonte do exportador e dos seus próprios testes na tag que o agente fixa, e cada uma corresponde ao que o OneUptime lê. Ele não foi executado aqui contra um banco de dados real.

## A que o maior tamanho foi submetido

O coletor real leu uma API simulada com 5.000 hipervisores, 200.000 instâncias e 10.000 projetos a cada dois minutos durante 60 minutos, em um relógio real. O que ele enviou passou pela ingestão real e pelas escritas reais em um Postgres real, com as leituras da Visão geral e a varredura de linhas obsoletas executando ao lado a cada 30 segundos, e 200 instâncias mudando a cada coleta. Cada orçamento abaixo é verificado por asserção, e uma execução que não cumpre um deles falha.

| O quê | Orçamento | Medido |
| --- | --- | --- |
| Requisições por minuto, como pedidas a cada serviço | Exatamente o que o cronograma do coletor diz, serviço por serviço | Exato. Keystone 1,3, Nova 25,1, Placement 1.166, Neutron 43,5, Cinder 62,4, Glance 0,5 |
| Coletas ignoradas porque a anterior ainda estava em execução | Nenhuma | 0 de 30 |
| Atraso de ingestão, do início de uma coleta até a escrita da sua última linha | Menos de 2 minutos | 37 s na mediana, 112 s no pior caso |
| A abertura de uma Visão geral, todas as leituras que ela faz ao mesmo tempo | Menos de 6 segundos | 0,6 s na mediana, 4,1 s no pior caso, e 5.008 bytes do que precisa de atenção |
| O maior tempo que qualquer escritor esperou por um lock na tabela de inventário | Menos de 5 segundos | 0,0 s, em 2.739 verificações uma vez por segundo |
| Partes excluídas que ainda existiam | Nenhuma | 0 |

E o que foi preciso, que não tem orçamento: 73 MiB de métricas por coleta antes da compressão, em até 2 envios, 14 s de CPU deste processo por coleta para ler, enviar e escrever juntos, e no máximo 998 MiB de heap do JavaScript. Uma sonda que coleta uma nuvem deste tamanho precisa dessa memória além do seu outro trabalho.

Isto foi executado em um Mac com 10 núcleos, compartilhado com outros trabalhos a uma carga média de cerca de 33, e com o PostgreSQL 14 na mesma máquina, então os tempos são o que uma máquina ocupada conseguiu, e não o que um servidor faria. Foi medido em 2026-11-05. As requisições de uma hora incluem a primeira coleta, que pede ao Placement os inventários de todos os hipervisores, então ficam um pouco acima [da tabela](#por-uma-sonda) de uma coleta estabilizada, e as 200 instâncias mudando a cada coleta são o restante das leituras do Nova ali.

A margem não é larga em uma máquina tão ocupada. Uma hora anterior, com uma carga média de cerca de 42 que chegou a 95, foi até a última linha de uma coleta ser gravada aos 124 segundos, de modo que a coleta seguinte foi ignorada, e todos os outros orçamentos foram cumpridos.

**O que isto deixa de fora.** A simulação responde na hora, então isto não diz nada sobre a rapidez das suas APIs: [o que o tempo de uma coleta permite](#por-uma-sonda) trata disso. Deixa de fora o servidor HTTP e a fila entre uma sonda e a ingestão, e o ClickHouse, então a leitura das séries por um gráfico ou monitor não está aqui, apenas as escritas e leituras do inventário. As linhas têm o formato das de um DevStack real e as contagens são inventadas. Nenhuma nuvem deste tamanho foi executada contra isto.

## O que as páginas leem

As páginas de uma nuvem grande leem pouco mais do que as de uma pequena, porque nenhuma delas lê a nuvem inteira.

| Página | O que ela lê |
| --- | --- |
| **Visão geral** | Contagens calculadas no servidor e as linhas que podem precisar de alguém. Acima de 1.000 hosts ou workers, os demais são apenas contados, então o que ela traz fica abaixo de um megabyte por maior que seja a nuvem |
| **Serviços** | O mesmo: um cartão para cada serviço, o que precisa de alguém primeiro e quantos outros estão bem. Uma busca consulta o servidor, então encontra qualquer host |
| Listas | Uma página por vez, cada uma a partir da última linha da página anterior. Um salto para uma página distante usa offset, o que na última página de 200.000 linhas leva segundos em vez de um milissegundo |
| **Topologia** | Acima de 5.000 partes, a estrutura, o que falhou e o que isso leva consigo. Ela informa o que deixou de fora |
| **Escritas de inventário** | No máximo 500 linhas por instrução e 5.000 por exclusão, cada uma em sua própria transação, então nenhum escritor espera muito por outro. Uma linha em que nada mudou não é reescrita por até 5 minutos, o que reduz o write-ahead log mais de vinte vezes |

## Uso e gastos

A [página Gastos](/docs/telemetry/openstack#gastos) de uma nuvem lê as linhas do inventário em vez das séries de qualquer instância, então funciona da mesma forma no modo resumo, e seu custo cresce com os projetos e não com as instâncias. Ela lê uma linha da nuvem e uma página de projetos. [Sua própria seção](/docs/telemetry/openstack#em-cada-tamanho) traz os números em cada tamanho.

## Próximos passos

:::cards
- [Agente OpenStack](/docs/telemetry/openstack): Instale o agente.
- [OpenStack sem agente](/docs/telemetry/openstack-agentless): Colete uma nuvem com uma sonda.
- [Monitor OpenStack](/docs/monitor/openstack-monitor): Alerte sobre o que chega.
:::
