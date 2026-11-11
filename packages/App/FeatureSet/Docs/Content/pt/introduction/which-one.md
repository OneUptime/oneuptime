# Qual devo usar?

Algumas coisas no OneUptime se parecem. Esta página coloca cada conjunto lado a lado, com a finalidade de cada um, para que você escolha o certo logo na primeira vez. Cada tabela cabe em uma tela, e a primeira coluna abre a página que trata daquela escolha em detalhe.

:::cards
- [Incidente, alerta ou outro tipo de problema?](#incidente-alerta-ou-outro-tipo-de-problema): O que um problema se torna no OneUptime.
- [Fluxo de trabalho, runbook, playbook ou regra de IA?](#fluxo-de-trabalho-runbook-playbook-ou-regra-de-ia): Com o que automatizar.
- [Grupo de monitores, serviço ou rótulo?](#grupo-de-monitores-serviço-ou-rótulo): Como agrupar o que você monitora.
- [Sonda, agente, coletor ou Runner?](#sonda-agente-coletor-ou-runner): O que instalar, e a chave que cada um usa.
- [Painel, painel público ou página de status?](#painel-painel-público-ou-página-de-status): O que compartilhar, e com quem.
:::

## Incidente, alerta ou outro tipo de problema?

A maioria dos problemas é um incidente ou um alerta: escolha por quem o problema afeta. Os outros são registros que o OneUptime mantém para você, e cada um deles pode levar a um incidente ou a um alerta.

| Registro | O que é | Use quando |
| --- | --- | --- |
| [Incidente](/docs/incidents/index) | Um problema que afeta seus usuários. Ele pode acionar quem está de plantão e aparecer nas suas páginas de status. | Os clientes percebem, ou logo vão perceber: uma queda, uma lentidão, um checkout que falha. |
| [Alerta](/docs/alerts/index) | Um problema para a sua equipe. Ele pode acionar quem está de plantão, mas nunca aparece em uma página de status. | Sua equipe deve agir antes que os usuários percebam: um disco enchendo, um certificado prestes a expirar. |
| [Episódio](/docs/incidents/episodes) | Um grupo de incidentes relacionados, ou de alertas relacionados, tratado como um só. | Uma única causa gerou muitos incidentes ou alertas. As regras de agrupamento abrem episódios para você. |
| [Exceção](/docs/telemetry/exceptions) | Todas as ocorrências de um erro que o seu código lança, agrupadas, com o stack trace. | Você quer corrigir um bug. Um monitor de exceções pode gerar um alerta ou um incidente quando os erros disparam. |
| [Insight de IA](/docs/ai/ai-sre#insights-detecção-proativa) | Um problema que o OneUptime encontrou na sua telemetria antes que algo acionasse alguém, como um pico de logs de erro. | Você quer avisos antecipados. Um insight nunca aciona ninguém e nunca abre um incidente: ele espera em uma caixa de entrada. |
| [Caso de segurança](/docs/telemetry/security-cases) | Uma ameaça que vale a pena investigar, com todas as detecções sobre o mesmo usuário, host ou endereço. | Sua equipe de segurança investiga. **Declarar incidente** em um caso abre um incidente quando há usuários afetados. |

Um alerta pode ser vinculado ao incidente do qual acabou fazendo parte, então começar com um alerta não faz você perder nada.

## Fluxo de trabalho, runbook, playbook ou regra de IA?

Os quatro podem ser executados sozinhos. Escolha pelo que eles afetam e por quem escreveu as etapas.

| Ferramenta | O que faz | Use quando |
| --- | --- | --- |
| [Fluxo de trabalho](/docs/workflows/index) | Blocos em uma tela que são executados quando o gatilho deles dispara: um incidente é criado, um horário programado chega, outra ferramenta chama uma URL. | Você quer conectar o OneUptime a outras ferramentas, ou agir sobre os registros dele, sem escrever código. |
| [Runbook](/docs/runbooks/index) | Seu procedimento de resposta em etapas, de checklists manuais a scripts, requisições HTTP e kubectl, executado em um incidente, um alerta ou um evento de manutenção. | Os responsáveis pela resposta devem seguir as mesmas etapas todas as vezes. As regras de runbook iniciam um runbook nos incidentes que correspondem. |
| [Playbook](/docs/telemetry/security-cases#playbooks) | Etapas que respondem a um caso de segurança: preservar as evidências, acionar quem está de plantão, suspender um usuário. | Sua equipe de segurança responde ao mesmo tipo de ameaça da mesma forma todas as vezes. |
| [Regra de IA](/docs/ai/ai-sre#quais-incidentes-são-investigados-e-corrigidos) | Decide quais novos incidentes e alertas a OneUptime AI investiga e corrige, e se ela pergunta antes. | A OneUptime AI deve trabalhar apenas em alguns incidentes, ou corrigir sem perguntar. Sem nenhuma regra, ela investiga todos. |

## Grupo de monitores, serviço ou rótulo?

Os três reúnem coisas, para leitores diferentes. Eles também funcionam juntos: os monitores de um serviço podem formar um grupo de monitores, e todos eles podem levar o mesmo rótulo.

| Escolha | O que é | Use quando |
| --- | --- | --- |
| [Grupo de monitores](/docs/monitor/monitor-groups) | Vários monitores reunidos em um único status, o pior entre eles, com a sua própria disponibilidade. | Os clientes devem ver uma única linha em uma página de status para algo feito de vários monitores, como Checkout. |
| [Serviço](/docs/telemetry/services) | Um aplicativo que o OneUptime encontrou na sua telemetria, com os logs, traces, métricas, incidentes e proprietários dele em uma única página. | Você quer tudo sobre um aplicativo em um só lugar. Ele aparece sozinho a partir do seu `service.name`. |
| [Rótulo](/docs/configuration/label-and-owner-rules) | Uma etiqueta que você coloca em monitores e na maioria dos outros registros. Um registro pode ter vários. | Você quer filtrar listas, limitar as permissões de uma equipe ou selecionar registros em regras. |

Os grupos de monitores começam desativados: ative-os em **Configurações do projeto → Avançado → Sinalizadores de recursos**.

## Sonda, agente, coletor ou Runner?

A maior parte do OneUptime não precisa de nada instalado: instale algo apenas para alcançar o que o OneUptime não consegue ver de fora. Cada um abre uma conexão de saída, com uma chave do seu próprio tipo.

| Instalação | O que faz | Instale quando | Chave que usa |
| --- | --- | --- | --- |
| [Sonda personalizada](/docs/probe/custom-probe) | Executa as verificações dos seus monitores de dentro da sua rede. | O que você verifica está atrás do seu firewall. As sondas do próprio OneUptime verificam o que é público. | O próprio ID de sonda e a própria chave |
| [Agente de infraestrutura](/docs/monitor/server-monitor) | Relata a CPU, a memória, os discos e os processos de uma máquina a um monitor de servidor / VM. | Você quer um monitor para um servidor, com critérios sobre os números dele. | A chave secreta do monitor |
| [OpenTelemetry Collector](/docs/telemetry/hosts) | Envia as métricas, os logs e os processos de uma máquina. **Adicionar host** o instala com um único comando. | Você quer uma máquina em **Hosts**, com a telemetria dela. | Uma chave de ingestão |
| [Agente Kubernetes](/docs/telemetry/kubernetes-agent) | Coleta as métricas, os eventos, os logs e os traces de um cluster. Você o instala com o Helm. | Você usa Kubernetes. | Uma chave de ingestão |
| [Runner](/docs/runbooks/agents) | Executa etapas de runbook, como Bash, SSH e kubectl, dentro da sua infraestrutura. | Seus runbooks precisam alcançar seus próprios hosts e clusters. | O próprio ID de Runner e a própria chave |

### Chave de ingestão ou chave de API?

| Chave | O que ela permite fazer | Onde você a cria |
| --- | --- | --- |
| [Chave de ingestão](/docs/telemetry/ingestion-keys) | Enviar telemetria para o projeto, e nada mais. | **Configurações do projeto → Telemetria e APM → Chaves de ingestão** |
| [Chave de API](/docs/permissions/index#chaves-de-api) | Ler e alterar o projeto pela API, pela CLI, pelo Terraform ou por um assistente de IA, com as permissões que você der a ela. | **Configurações do projeto → Avançado → Chaves de API** |

Nenhuma das duas funciona no lugar da outra.

## Painel, painel público ou página de status?

Escolha por quem deve ver.

| Compartilhar | Quem vê | Use quando |
| --- | --- | --- |
| [Painel](/docs/dashboards/index) | As pessoas que entram no seu projeto. | Sua equipe acompanha gráficos e listas: uma tela de plantão, a visão própria de uma equipe. |
| [Painel público](/docs/dashboards/sharing) | Qualquer pessoa com o link, a menos que você adicione uma senha, limite-o a alguns endereços IP ou hospede-o no seu próprio domínio. | Pessoas de fora do projeto devem ver seus gráficos, como um parceiro ou uma tela na parede. |
| [Página de status](/docs/status-pages/index) | Seus clientes, em público, ou apenas os usuários privados que você deixar entrar. | Os clientes querem saber se seus serviços funcionam, e ser avisados sobre incidentes e manutenções. |

Uma página de status fala em incidentes e nos nomes que você dá aos seus monitores; um painel mostra os números por trás deles.

## Próximos passos

:::cards
- [Glossário](/docs/introduction/glossary): Cada palavra que o OneUptime usa, em uma ou duas frases.
- [Conceitos básicos](/docs/introduction/core-concepts): Como as peças se conectam, em uma única página.
- [Início rápido](/docs/introduction/quickstart): Um monitor, um acionamento e uma página de status em quinze minutos.
:::
