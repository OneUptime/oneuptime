# Glossário

Cada palavra que o OneUptime usa, em uma ou duas frases, com os outros nomes pelos quais ela é conhecida e a página que trata dela em detalhe. As palavras estão agrupadas na ordem em que você as encontra: o primeiro grupo é o ciclo que todo projeto percorre, e o último reúne as palavras que significam mais de uma coisa.

:::cards
- [Comece por aqui](#comece-por-aqui): O ciclo que todo projeto percorre, de um monitor a um acionamento e a uma página de status.
- [O que você observa](#o-que-você-observa): Serviços, hosts, clusters, nuvens e as metas que você define para eles.
- [Trabalhando em um problema](#trabalhando-em-um-problema): Estados, severidades, proprietários e rótulos, e os outros tipos de problema.
- [Telemetria e painéis](#telemetria-e-painéis): O que seus sistemas enviam, e onde você consulta isso.
- [Automação e IA](#automação-e-ia): O que é executado sozinho, e o que a OneUptime AI faz.
- [O que você instala e as chaves](#o-que-você-instala-e-as-chaves): Os agentes que você executa, e a chave que cada um usa.
- [Palavras com mais de um significado](#palavras-com-mais-de-um-significado): Regra, função, recurso, configurações e as outras palavras com várias funções.
:::

## Comece por aqui

### Projeto

Onde fica tudo o que você configura: monitores, incidentes, plantão, páginas de status, telemetria e configurações. Nada do que está em um projeto é visível em outro, e a maioria das empresas precisa de apenas um.

Veja [Conceitos básicos](/docs/introduction/core-concepts#projetos-e-pessoas).

### Conta

Você: o e-mail e a senha com que você entra, seu nome, seu fuso horário e seu idioma. Uma conta pode pertencer a quantos projetos você quiser.

Veja [Sua conta](/docs/introduction/your-account).

### Equipe

Um grupo de pessoas em um projeto, cujas permissões decidem o que seus membros podem fazer. Todo projeto novo começa com três equipes: Owners, Admin e Members. Convide pessoas em **Usuários** e agrupe-as em **Equipes**.

Veja [Usuários, equipes e permissões](/docs/permissions/index).

### Monitor

Verifica uma coisa que você executa, como um site, uma API, um servidor ou um cluster Kubernetes, e decide se ela está funcionando. Quando seus critérios correspondem, ele muda de status e pode declarar um incidente ou criar um alerta.

Veja [Criar um monitor](/docs/monitor/create-monitor).

### Critérios

As regras de um monitor: o que cada resultado de verificação significa. Elas são avaliadas em ordem, e a primeira que corresponde pode mudar o status do monitor, declarar um incidente, criar um alerta ou as três coisas.

Também chamado: **Critérios de Monitoramento**, **Critérios do monitor**, **Monitor Steps**. Veja [Critérios e status](/docs/monitor/criteria-and-statuses).

### Status do monitor

O que um monitor está neste momento. Todo projeto novo tem três status de monitor, **Operacional**, **Degradado** e **Offline**, e você pode adicionar os seus.

Veja [Critérios e status](/docs/monitor/criteria-and-statuses).

### Sonda

Uma máquina que executa as verificações dos monitores em uma programação: ela solicita uma página, chama uma API ou faz ping em um host. O OneUptime Cloud executa sondas em várias regiões, e uma sonda personalizada que você executa dentro da sua própria rede verifica o que só essa rede alcança.

Também chamado: **Sondas personalizadas**. Veja [Sondas personalizadas](/docs/probe/custom-probe).

### Incidente

Um problema que afeta seus usuários, como uma queda ou uma lentidão, e o registro com o qual sua equipe trabalha enquanto ele dura. Ele pode acionar quem está de plantão e aparecer nas suas páginas de status.

Veja [Visão geral dos incidentes](/docs/incidents/index).

### Alerta

Um problema que sua equipe deve investigar antes que os usuários percebam, como um disco enchendo ou um certificado prestes a expirar. Ele pode acionar quem está de plantão, mas nunca aparece em uma página de status.

Veja [Visão geral dos alertas](/docs/alerts/index).

### Episódio

Um grupo de incidentes relacionados, ou de alertas relacionados, que sua equipe trata como um só, com um único conjunto de proprietários e um único estado. Regras de agrupamento decidem o que entra em cada um.

Também chamado: **Episódio de incidentes**, **Episódio de alertas**. Veja [Episódios](/docs/incidents/episodes).

### Política de plantão

Decide quem é acionado sobre um incidente, um alerta ou um episódio, e quem vem a seguir se ninguém confirmar. Seus níveis são regras de escalonamento.

Também chamado: **Plantão**, **On-Call Duty Policy**, `OnCallDutyPolicy`. Veja [Políticas de plantão](/docs/on-call/policies).

### Regra de escalonamento

Um nível de uma política de plantão: quem é acionado, e quanto tempo esperar que alguém confirme antes de acionar o próximo nível. Um nível pode acionar pessoas, equipes ou um agendamento de plantão.

Veja [Regras de escalonamento](/docs/on-call/escalation-rules).

### Agendamento de Plantão

Quem está de plantão a cada momento: as pessoas se revezam, e cada uma passa o turno para a seguinte. Uma regra de escalonamento que aciona um agendamento aciona quem está de plantão nele.

Também chamado: **Rotation**, **Agendamento da política de plantão**. Veja [Agendamentos de plantão](/docs/on-call/schedules).

### Camada

Uma rotação dentro de um agendamento de plantão: quem se reveza, com que frequência há passagem de turno e quais horários ela cobre. É acionada a camada mais alta em que há alguém de plantão, por isso a rotação principal fica no topo e a cobertura reserva abaixo dela.

Veja [Agendamentos de plantão](/docs/on-call/schedules#camadas).

### Método de notificação

Um endereço pelo qual o OneUptime pode contatar você em um projeto: um endereço de e-mail, um número de telefone para SMS ou chamadas, sua conta do Slack ou do Microsoft Teams, ou o aplicativo do OneUptime no seu celular. Cada pessoa adiciona os seus em **Configurações do usuário**.

Veja [Métodos de notificação](/docs/notifications/notification-methods).

### Como me contatar

As suas próprias regras para ser acionado: quais dos seus métodos de notificação um acionamento tenta, e depois de quanto tempo. Uma escada cobre todo incidente, alerta e episódio, e uma gravidade pode ter regras próprias. Cada pessoa define as suas em **Configurações do usuário**.

Também chamado: **Regras de Plantão pessoais**. Veja [Como me contatar](/docs/notifications/on-call-rules).

### Página de status

Uma página que mostra aos seus clientes se seus serviços funcionam, e os incidentes e as manutenções que os afetam. Ela pode ser pública, ou privada para as pessoas que você deixar entrar.

Veja [Visão geral das páginas de status](/docs/status-pages/index).

### Assinante

Alguém que acompanha uma página de status por e-mail, SMS, Slack, Microsoft Teams ou webhook, e é avisado quando um incidente ou uma manutenção nela começa, muda e termina.

Veja [Assinantes e comunicados](/docs/status-pages/subscribers).

### Manutenção programada

Um trabalho planejado, anunciado com antecedência. Cada evento de manutenção passa pelos estados da manutenção **Agendado**, **Em andamento**, **Encerrado** e **Concluído**, e as páginas de status em que ele aparece informam visitantes e assinantes sobre ele.

Também chamado: **Evento de manutenção programada**, **Evento agendado**, **Evento**. Veja [Visão geral da manutenção programada](/docs/scheduled-maintenance/index).

### Telemetria

O que seus sistemas enviam ao OneUptime: logs, métricas, traces, exceções e perfis. Os aplicativos a enviam com OpenTelemetry, e os agentes do OneUptime a enviam a partir de hosts, clusters e outras infraestruturas, cada um com uma chave de ingestão.

Veja [OpenTelemetry](/docs/telemetry/open-telemetry).

## O que você observa

### Grupo de monitores

Vários monitores reunidos em um único status, o pior entre eles, com a sua própria disponibilidade. Uma página de status pode mostrar o grupo inteiro como uma única linha. Ative os grupos de monitores em **Configurações do projeto → Avançado → Sinalizadores de recursos**.

Veja [Grupos de monitores](/docs/monitor/monitor-groups).

### Serviço

Um aplicativo ou microsserviço que você executa. O OneUptime o adiciona na primeira vez que a telemetria dele chega, com o nome do seu `service.name`, e reúne os logs, traces, métricas, exceções, incidentes e proprietários dele em uma única página.

Também chamado: **Catálogo de serviços**, **Serviço de telemetria**. Veja [Serviços](/docs/telemetry/services).

### Host

Uma máquina Linux, Windows ou macOS que envia suas métricas, processos, logs e estados de serviços pelo OpenTelemetry Collector. **Adicionar host** instala o coletor com um único comando, e o OneUptime mantém a configuração dele atualizada.

Veja [Hosts](/docs/telemetry/hosts).

### Kubernetes

Seus clusters Kubernetes, com seus nós, pods, workloads, eventos e logs, enviados pelo agente Kubernetes que você instala com o Helm.

Veja [Agente Kubernetes](/docs/telemetry/kubernetes-agent).

### Infraestrutura

O grupo do menu com as máquinas e plataformas que você executa: Hosts, Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Storage Arrays, Network e IoT. Um agente ou uma conexão preenche cada um deles, e cada um mostra como está cada máquina, cluster ou dispositivo que contém.

Veja [Hosts](/docs/telemetry/hosts).

### Rede

Seus switches, roteadores, firewalls, pontos de acesso e tudo o mais que tenha um endereço na sua rede, fale SNMP ou não.

Veja [Monitor de dispositivos de rede](/docs/monitor/network-device-monitor).

### Nuvem

Suas contas da AWS, assinaturas do Azure e projetos do Google Cloud, conectados a partir do painel. O OneUptime lista todos os recursos que eles contêm, lê as principais métricas deles e registra o que mudou neles.

Veja [Conectar uma conta de nuvem](/docs/telemetry/cloud-accounts).

### Plataformas de aplicativos

Os aplicativos que você executa em plataformas gerenciadas, como Amazon ECS e Fargate, Google Cloud Run e Azure App Service. Cada lugar onde eles rodam é um ambiente de nuvem, que o OneUptime cria na primeira vez que a telemetria dele chega.

Também chamado: **Ambiente de nuvem**. Veja [Ambientes de nuvem](/docs/telemetry/cloud-environments).

### Serverless

Suas funções serverless, como AWS Lambda, Google Cloud Functions e Azure Functions, listadas com seus traces, logs e métricas assim que os dados de OpenTelemetry delas chegam.

Também chamado: **Funções serverless**. Veja [Funções serverless](/docs/telemetry/serverless-functions).

### Bancos de dados

Cada banco de dados que seus aplicativos consultam, montado a partir dos seus traces, das métricas do próprio banco e das outras fontes que o OneUptime consegue ler, com o estado do seu motor.

Veja [Bancos de dados](/docs/telemetry/databases).

### Filas

As filas e os tópicos de mensagens que seus serviços usam, como Apache Kafka, RabbitMQ e Amazon SQS, a partir dos seus traces e das métricas dos seus brokers.

Veja [Filas](/docs/telemetry/queues).

### Monitoramento de Usuários Reais

O que pessoas reais vivenciam nos seus aplicativos web e móveis: carregamentos de página, requisições, erros e Core Web Vitals, relatados pelo próprio aplicativo e não por uma sonda.

Veja [Visão geral do RUM](/docs/rum/index).

### Inventário

Uma única lista de tudo o que o OneUptime sabe sobre o seu ambiente: serviços, hosts, objetos Kubernetes, máquinas virtuais, dispositivos de rede, recursos de nuvem e as coisas que não enviam telemetria alguma. Quase tudo se preenche sozinho.

Veja [Visão geral do inventário](/docs/inventory/overview).

### Topologia

Um mapa de como seus sistemas se conectam, quais serviços chamam quais e o que roda onde, desenhado a partir da telemetria que você já envia.

Veja [Topologia](/docs/telemetry/topology).

### SLO

Uma meta de confiabilidade para o que você monitora, como estar no ar 99,9% do tempo em 30 dias. O OneUptime mede cada SLO a partir dos seus monitores a cada 5 minutos.

Também chamado: **Service Level Objective**. Veja [Visão geral dos SLOs](/docs/slo/introduction).

### Orçamento de erros

O tempo de inatividade que a meta de um SLO permite: a 99,9% em 30 dias, 43 minutos e 12 segundos. Com bastante sobrando, você pode correr riscos; com pouco sobrando, desacelere e invista em estabilidade.

Veja [Orçamentos de erros](/docs/slo/error-budget).

## Trabalhando em um problema

### Estado

Em que ponto da sua resposta está um incidente ou um alerta. Todo projeto novo começa com **Identificado**, **Confirmado** e **Resolvido**: confirmar indica que alguém está cuidando e impede que o próximo nível de escalonamento seja acionado, e resolver encerra.

Também chamado: **Estado do incidente**, **Estado do alerta**. Veja [Estados e severidades de incidentes](/docs/incidents/states-and-severities).

### Gravidade

O quanto um incidente ou um alerta importa. Um projeto novo começa com Critical Incident, Major Incident e Minor Incident para incidentes, e **Alto** e **Baixo** para alertas; renomeie-os, mude as cores deles ou adicione os seus.

Também chamado: **Severidade do incidente**, **Severidade do alerta**. Veja [Estados e severidades de incidentes](/docs/incidents/states-and-severities).

### Proprietário

Uma pessoa ou uma equipe responsável por um registro, como um monitor, um incidente ou uma página de status. Os proprietários são avisados quando algo acontece com o que é deles.

Veja [Regras de rótulos e proprietários](/docs/configuration/label-and-owner-rules).

### Rótulo

Uma etiqueta, como Production ou Checkout, que você coloca em monitores, incidentes, páginas de status e na maioria dos outros registros para filtrá-los e agrupá-los. As permissões de uma equipe podem ser limitadas aos registros com certos rótulos.

Veja [Regras de rótulos e proprietários](/docs/configuration/label-and-owner-rules).

### Exceção

Um erro que o seu código lança. O OneUptime agrupa todas as ocorrências do mesmo erro em uma única exceção, com o stack trace, a tendência e as requisições em que ela aconteceu.

Também chamado: **Rastreamento de exceções**, `/telemetry-exception`. Veja [Exceções](/docs/telemetry/exceptions).

### Insights de IA

Problemas que o OneUptime encontra na sua telemetria antes que algo acione alguém: exceções novas e em alta, picos de logs de erro, traces mais lentos, desvios de métricas e implantações que pioraram as coisas. Os insights nunca acionam ninguém e nunca abrem incidentes; eles esperam em uma caixa de entrada até alguém olhar. A página **Insights** na seção de IA de um produto ou de um registro mostra o que a OneUptime AI aprendeu ali.

Também chamado: **Insights**. Veja [AI SRE](/docs/ai/ai-sre#insights-detecção-proativa).

### Eventos de segurança

O SIEM do OneUptime: os eventos de segurança dos seus logs, das suas ferramentas de segurança e de tudo o mais que você envia, guardados em um único formato ao lado da sua telemetria, com regras de detecção que encontram ameaças neles.

Também chamado: **SIEM**. Veja [Eventos de segurança (SIEM)](/docs/telemetry/security-events).

### Caso de segurança

Uma coisa que vale a pena investigar, vinda de regras de detecção, de inteligência de ameaças ou de um produto de segurança conectado, com todas as detecções sobre o mesmo usuário, host ou endereço agrupadas nela. Os analistas tratam os casos em uma fila, e os playbooks respondem a eles.

Também chamado: **Caso**. Veja [Casos de segurança e playbooks (SOAR)](/docs/telemetry/security-cases).

## Telemetria e painéis

### Registros

As linhas que seus serviços, hosts e agentes escrevem, que você pesquisa no explorador de registros e acompanha com um monitor de logs.

Veja [Explorador de registros](/docs/telemetry/logs-explorer).

### Métricas

Os números que seus serviços e sua infraestrutura relatam ao longo do tempo, como contagens de requisições, latência, CPU e profundidade de filas.

Veja [Explorador de métricas](/docs/telemetry/metrics-explorer).

### Traços

O caminho de uma requisição pelos seus serviços, passo a passo. Cada passo é um span, com a sua duração e o seu resultado.

Veja [Explorador de traços](/docs/telemetry/traces-explorer).

### Perfis

Como o seu aplicativo gasta tempo de CPU e memória, função por função, enviados por um profiler que envia dados para a API compatível com Pyroscope do OneUptime.

Também chamado: **Perfis de desempenho**, **Profiling contínuo**. Veja [Perfis](/docs/telemetry/profiles).

### IA / LLM

As conversas que seus aplicativos e agentes de IA têm: cada chamada de modelo, com seus tokens, custo, latência, prompt e resposta, montadas a partir dos spans de OpenTelemetry que o seu aplicativo envia.

Também chamado: **Observabilidade de AI / LLM**. Veja [Observabilidade de IA / LLM](/docs/telemetry/ai-llm-observability).

### Observabilidade de dados

Observa as tabelas dos seus bancos de dados e data warehouses, e avisa quando os dados delas estão atrasados, faltando ou errados, e qual execução, implantação ou tabela está por trás disso.

Veja [Visão geral da Observabilidade de dados](/docs/data-observability/index).

### Segurança de dados

Encontra os dados sensíveis que a sua empresa guarda, em buckets na nuvem, bancos de dados, data warehouses e na telemetria que você envia, e diz o que há de errado na forma como eles são guardados.

Veja [Visão geral da Segurança de dados](/docs/data-security/index).

### Painel

Uma página de widgets que você mesmo organiza: gráficos das suas métricas, logs e traces, listas de incidentes e monitores, seus SLOs e muito mais. Um painel é privado do seu projeto até você compartilhá-lo.

Veja [Visão geral dos painéis](/docs/dashboards/index).

### Public Dashboard

Um painel compartilhado por um link público, para pessoas que não entram no seu projeto. Proteja-o com uma senha, limite-o a alguns endereços IP ou hospede-o no seu próprio domínio.

Veja [Compartilhamento e painéis públicos](/docs/dashboards/sharing).

## Automação e IA

### Fluxo de trabalho

Uma automação sem código: blocos em uma tela que são executados quando o gatilho deles dispara, como publicar no Slack quando um incidente é declarado, ou chamar outra ferramenta.

Veja [Visão geral dos workflows](/docs/workflows/index).

### Runbook

Um procedimento de resposta reutilizável: etapas manuais e automatizadas que sua equipe executa em um incidente, um alerta ou um evento de manutenção, manualmente ou quando uma regra de runbook corresponde.

Veja [Visão geral dos Runbooks](/docs/runbooks/index).

### Playbook

As etapas que respondem a um caso de segurança, como preservar as evidências, acionar quem está de plantão ou suspender um usuário, executadas sozinhas ou com um clique.

Também chamado: **Playbook de segurança**. Veja [Casos de segurança e playbooks (SOAR)](/docs/telemetry/security-cases#playbooks).

### Regra de IA

Decide quais novos incidentes ou alertas a OneUptime AI investiga e corrige, e como. Sem nenhuma regra de IA, ela investiga todos, então a maioria dos projetos não precisa de nenhuma.

Também chamado: **Regra de correção automática**. Veja [AI SRE](/docs/ai/ai-sre#quais-incidentes-são-investigados-e-corrigidos).

### OneUptime AI

O engenheiro de confiabilidade de sites com IA do OneUptime: ele investiga cada novo incidente e alerta em toda a sua telemetria e publica o que encontrou na linha do tempo deles. O interruptor **Habilitar IA** em **Configurações do projeto** desliga tudo isso.

Também chamado: **AI SRE**. Veja [AI SRE](/docs/ai/ai-sre).

### Pergunte à IA

Um chat sobre os dados do seu projeto. Ele consulta seus logs, traces, métricas, incidentes, monitores e muito mais, e responde com uma citação para cada afirmação.

Também chamado: **Chat**. Veja [Pergunte à IA](/docs/ai/ask-ai).

### Código

Onde você pede à OneUptime AI que trabalhe nos seus repositórios, como pediria a um agente de programação: corrigir um bug, escrever testes ou fazer uma alteração, e receber um pull request de volta.

Também chamado: **Tarefas**. Veja [Código](/docs/ai/ai-agent).

### Formulário

Uma página que qualquer pessoa com o link pode preencher, sem conta. Cada envio cria um incidente, para um relato de problema, ou um evento de manutenção programada, para uma solicitação de mudança.

Veja [Visão geral dos formulários](/docs/forms/index).

## O que você instala e as chaves

### Agente de infraestrutura

O serviço `oneuptime-infrastructure-agent` por trás de um monitor de servidor / VM: ele relata a CPU, a memória, os discos e os processos de uma máquina a cada 30 segundos, assinados com a chave secreta do monitor.

Veja [Monitor de servidor / VM](/docs/monitor/server-monitor).

### Agente Kubernetes

Um chart do Helm que coleta as métricas, os eventos e os logs de pods de um cluster e, com eBPF, os traces dele, e os envia com uma chave de ingestão.

Veja [Agente Kubernetes](/docs/telemetry/kubernetes-agent).

### OpenTelemetry Collector

O agente de código aberto que recebe, processa e envia telemetria. **Adicionar host** o instala em uma máquina, o agente Docker é um deles, e os seus próprios coletores enviam ao OneUptime com uma chave de ingestão.

Também chamado: **Coletor**. Veja [Hosts](/docs/telemetry/hosts) e [Coletor OpenTelemetry no host](/docs/telemetry/host-otel-collector).

### Runner

Um pequeno processo que você executa na sua própria infraestrutura e que executa as etapas JavaScript, Bash, SSH e kubectl dos seus runbooks. Ele se conecta ao OneUptime de dentro para fora, com o próprio ID de Runner e a própria chave.

Também chamado: **Agentes de runbook**. Veja [Agentes de runbook](/docs/runbooks/agents).

### Chave de ingestão

A chave que permite que algo envie telemetria para o seu projeto: aplicativos com OpenTelemetry, coletores e agentes. Ela vai no cabeçalho `x-oneuptime-token`, e uma chave de API do projeto não funciona no lugar dela.

Também chamado: **Telemetria Ingestão Key**, `oneuptime.apiKey`. Veja [Chaves de ingestão](/docs/telemetry/ingestion-keys).

### Chave de API

Uma chave que permite que um script, a CLI, o Terraform ou um assistente de IA leia e altere o seu projeto pela API, com as permissões que você der a ela. Crie uma em **Configurações do projeto → Avançado → Chaves de API**.

Veja [Usuários, equipes e permissões](/docs/permissions/index#chaves-de-api).

## Palavras com mais de um significado

### Regra

Muitas coisas no OneUptime são regras, e cada uma toma uma decisão por você: quem é acionado (**Regras de Plantão**, **Regras de escalonamento**), quem é o proprietário dos novos registros e como eles são rotulados (**Regras de proprietário**, **Regras de Rótulos**), o que fica junto (**Regras de agrupamento**) e o que a OneUptime AI faz (**Regras de IA**). As regras próprias de um monitor são os critérios dele.

Veja [Conceitos básicos](/docs/introduction/core-concepts#os-tipos-de-regra).

### Função

Quatro coisas diferentes: as permissões que uma equipe concede, como Project Owner ou Project Admin; uma **Função personalizada** que você monta a partir de permissões; uma **Função no incidente**, o papel que alguém desempenha em um incidente; e uma **Network Device Role**, o que um dispositivo faz na sua rede.

Veja [Usuários, equipes e permissões](/docs/permissions/index).

### Recurso

Na maioria das vezes, a infraestrutura que o OneUptime registra, como hosts, clusters, bancos de dados e recursos de nuvem. Os **Recursos afetados** de um incidente são os monitores e a infraestrutura que ele atinge, os recursos de uma página de status são os monitores e grupos que ela mostra, e os atributos de recurso do OpenTelemetry dizem de onde veio a telemetria.

Veja [Visão geral do inventário](/docs/inventory/overview).

### Configurações

Cada nível tem as suas: **Configurações do projeto** para o projeto inteiro, **Configurações do usuário** para a forma como o OneUptime chega até você, e as **Configurações** próprias de um produto no menu lateral dele, como os estados e os modelos de incidente em **Incidentes**. As configurações de um servidor auto-hospedado ficam no Admin Dashboard.

Veja [Configurações do projeto](/docs/configuration/project-settings).

### Política

Na maioria das vezes, uma **Política de plantão**: quem é acionado, e quem vem a seguir. Uma política de chamadas recebidas dá à sua equipe um número de telefone que toca para quem está de plantão, e uma política de orçamento de erros registra o que sua equipe faz quando o orçamento de um SLO vai se esgotando.

Veja [Políticas de plantão](/docs/on-call/policies).

### Modelo

Um ponto de partida salvo: um modelo de monitor cria monitores, os modelos de incidentes e de alertas preenchem novos registros, os modelos de notas e de post-mortems iniciam o que você escreve, e os modelos de painel montam os widgets de um painel.

Veja [Modelos de monitor](/docs/monitor/monitor-templates).

### Espaço de trabalho

Um espaço de trabalho do Slack ou do Microsoft Teams que você conecta ao OneUptime em **Conexões do espaço de trabalho**, para publicar atualizações nos seus canais e agir sobre incidentes a partir do chat. O que algumas outras ferramentas chamam de espaço de trabalho é um projeto no OneUptime.

Veja [Slack](/docs/workspace-connections/slack).

### Agente

Um programa que você instala e que se reporta ao OneUptime ou age em nome dele: os agentes de infraestrutura, Kubernetes e Docker enviam o que coletam, um Runner executa etapas de runbook, e um agente de IA permite que a OneUptime AI investigue um cluster ou um host. As tarefas que você dá ao **Código** são tarefas de agente de IA.

Veja [Qual devo usar?](/docs/introduction/which-one#sonda-agente-coletor-ou-runner).

### Regras de Plantão

Em **Incidentes** e **Alertas**, as regras de plantão escolhem as políticas de plantão que um novo incidente ou alerta executa. As regras próprias de cada pessoa sobre como um acionamento chega até ela também se chamavam regras de plantão: agora são **Como me contatar**, em **Configurações do usuário**.

Veja [Configurações e automação de incidentes](/docs/incidents/settings#regras-de-plantão-de-incidente) e [Como me contatar](/docs/notifications/on-call-rules).

### Configurações de notificação

Em **Configurações do usuário**, quais atualizações sobre o que é seu chegam até você, e por quais canais. Os interruptores do projeto para SMS e chamadas, o saldo de mensagens dele e o próprio SMTP e Twilio dele também se chamavam configurações de notificação: agora são **Canais de notificação**, em **Configurações do projeto**.

Veja [Configurações de notificação](/docs/notifications/notification-settings).

## Próximos passos

:::cards
- [Qual devo usar?](/docs/introduction/which-one): Incidente ou alerta, fluxo de trabalho ou runbook, e as outras coisas parecidas lado a lado.
- [Conceitos básicos](/docs/introduction/core-concepts): Como as peças se conectam, em uma única página.
- [Início rápido](/docs/introduction/quickstart): Colocar as palavras em prática em quinze minutos.
:::
