# Configuração e segurança

Esta página reúne as configurações e os limites de segurança que vale conhecer antes de apontar um workflow para tráfego real.

## Ligar e desligar um workflow

Todo workflow tem uma chave **Habilitado** no topo do **Construtor** e na página **Visão geral** dele. Com ela desligada, o workflow não roda — chamadas de webhook, horários agendados e eventos do OneUptime são todos ignorados, assim como **Executar fluxo de trabalho** e **Run just this step**. Workflows novos nascem desabilitados.

Use essa chave como o seu portão de "pronto para valer":

1. Monte o workflow.
2. Clique em **Executar fluxo de trabalho** no **Construtor**, com valores realistas. Um workflow desabilitado não roda nem manualmente, então o Construtor pede para ativá-lo primeiro: clique em **Ativar e executar**.
3. Confira os **Registros** — verifique se cada bloco foi para onde você esperava.
4. Deixe **Habilitado** ligado se estiver pronto. Se não estiver, desligue até que esteja: enquanto ele estiver ligado, o trigger dispara com eventos reais.

Desligar um workflow não interrompe as execuções que já estão em andamento; apenas impede que novas comecem.

## Proprietários e rótulos

- **Proprietários** — usuários e equipes listados como proprietários ganham acesso ao workflow e podem optar por receber notificações quando ele falha. Defina-os em **Configurações → Proprietários**.
- **Rótulos** — etiquetas para agrupar workflows. A lista permite filtrar por rótulo, o que torna um projeto movimentado bem mais navegável. Útil quando você organiza workflows por equipe, integração ou ambiente.
- **Regras de Rótulos** — em **Fluxos de trabalho → Configurações → Regras de Rótulos**, aplique rótulos automaticamente a novos workflows conforme padrões de nome ou descrição.
- **Regras de proprietário** — em **Fluxos de trabalho → Configurações → Regras de proprietário**, atribua proprietários automaticamente a novos workflows.

## Segredos

Marque uma variável global como **Segredo** se ela contiver algo sensível. Depois de salvo, o valor fica oculto nas leituras normais de API e de interface, e o registro do workflow limpa o valor resolvido antes de persistir o log da execução.

Use variáveis secretas para:

- Chaves de API de serviços externos.
- Tokens de autenticação.
- Chaves de assinatura de webhook.
- Qualquer coisa que você não queira mostrar a alguém com acesso somente leitura.

Não cole um segredo direto em um bloco — valores como `Authorization: Bearer eyJh...` acabam visíveis no workflow e nos registros. Use `{{global.variables.MY_SECRET}}` em vez disso.

## Exportar e importar workflows

Você pode mover um workflow entre projetos, ou entre uma instalação self-hosted e o OneUptime Cloud, como um arquivo JSON.

- **Exportar** — abra o workflow e use **Export Workflow**, em **Configurações**. Na lista de workflows você também pode selecionar vários e exportá-los em um único arquivo.
- **Importar** — na lista **Fluxos de trabalho**, clique em **Import JSON** e escolha um arquivo exportado de qualquer projeto OneUptime.

O arquivo guarda o nome, a descrição, o estado de habilitação e o grafo do workflow. Ele deliberadamente não guarda:

- **A chave secreta do webhook.** Uma nova é gerada quando o workflow é criado, então um workflow importado tem uma URL de webhook diferente. Tudo o que chamava a original precisa ser reapontado.
- **As variáveis globais.** Um bloco que lê `{{global.variables.MY_SECRET}}` mantém a referência, mas o valor não está no arquivo. Crie as variáveis no projeto de destino antes de rodar o workflow importado.
- **Proprietários e rótulos.** As regras de rótulo e de proprietário do seu projeto rodam sobre o workflow importado, exatamente como se você o tivesse criado à mão.

Um workflow importado é sempre criado **desabilitado**, mesmo que estivesse habilitado na origem — seu grafo pode apontar para monitores, políticas de plantão ou outros workflows que não existem no projeto de destino. Revise, habilite, teste com **Executar fluxo de trabalho** e só então deixe ligado. Duplicar um workflow funciona da mesma forma, então uma cópia nunca começa a disparar ao lado do original antes de você editá-la.

Como o grafo viaja literalmente, tudo o que foi digitado direto em um bloco vai junto. É essa a razão prática para manter credenciais em variáveis secretas: exportar um workflow com um token embutido entrega esse token a quem receber o arquivo.

## Quanto tempo uma execução pode durar

Cada tentativa de execução tem um prazo de relógio. O executor o verifica antes e depois de cada componente e marca como **Timeout** a execução que estourou o prazo, assim que o controle volta para ele. Componentes que fazem trabalho de rede ou rodam scripts também precisam dos seus próprios tempos limite, porque o executor não consegue interromper à força o código arbitrário de um componente.

O componente de AI deriva o tempo limite da requisição ao provedor a partir do tempo restante do workflow e o limita a 60 segundos, deixando uma pequena margem para registro e limpeza.

## Limite para chamar outros workflows

O componente **Execute Workflow** permite que um workflow chame outro. Para evitar loops acidentais em que o workflow A chama B, que chama A de novo, existe um teto de profundidade para essa cadeia. Uma execução que passa do limite termina com um erro claro.

Se você realmente precisa de uma cadeia longa (como uma tarefa que processa um item por execução), normalmente é mais simples fazer o loop dentro de um único workflow, com **Custom Code**.

## Segurança do webhook

Gatilhos de webhook dão a você uma URL exclusiva. Quem souber a URL consegue chamá-la. Para se proteger de chamadores acidentais ou indesejados:

- Trate a URL como uma senha. Não a divulgue nem a versione em um repositório público.
- Em workflows sensíveis, peça ao sistema que chama para enviar um token compartilhado em um cabeçalho (algo como `X-Webhook-Token`) e confira-o com um bloco **Conditions** antes de fazer qualquer coisa importante. Guarde o token esperado como uma variável secreta.
- Em workflows muito sensíveis, prefira um gatilho de evento do OneUptime e uma etapa manual de importação a um webhook público.

## Acesso de rede para fora

Blocos de API e outros blocos HTTP fazem suas requisições a partir do OneUptime. Se você faz self-host, garanta que sua instalação consiga alcançar os serviços que está chamando. Se você usa o OneUptime Cloud, nossas faixas de IP de saída estão listadas em [Endereços IP](/docs/configuration/ip-addresses) para que você possa liberá-las do outro lado.

## Componentes de AI

**Generate Text with AI** envia uma requisição pelo gateway de LLM configurado do OneUptime. Ele usa o provedor de LLM padrão do projeto ou, quando o projeto não tem um, o provedor global da instalação. Configure os provedores em **Configurações do projeto → IA → Provedores LLM**; nunca coloque uma chave de API de provedor ou um endpoint de modelo arbitrário no próprio workflow.

O componente de AI tem uma fronteira de saída explícita:

- O OneUptime envia ao provedor configurado uma instrução fixa de segurança do componente, mais os valores resolvidos de **System Instructions**, **Prompt** e **Context** serializado. O contexto é acrescentado depois de um marcador explícito, ao final da mensagem do usuário; a instrução fixa determina que tudo o que vier depois desse marcador continua sendo dado não confiável, mesmo que contenha tags ou instruções.
- Ele não anexa automaticamente o payload do gatilho, o histórico do workflow, saídas de outros componentes, registros do projeto, telemetria ou segredos. Os dados só saem quando você os referencia em uma dessas três entradas.
- Ele não envia definições de ferramentas nem campos nativos de capacidade do provedor. O modelo não consegue consultar o OneUptime, fazer requisições HTTP ou alterar dados do projeto por meio deste componente. O provedor/modelo configurado continua sendo uma fronteira de confiança do administrador, então instalações que exigem geração estritamente offline devem escolher um modelo sem recuperação intrínseca gerenciada pelo provedor.
- Parâmetros adicionais no nível do provedor ficam restritos a uma lista de permissões com campos de ajuste que afetam só a geração. Eles não podem substituir as mensagens do workflow, adicionar ferramentas ou fontes de dados e busca na web nativas do provedor, habilitar modalidades não textuais, pedir múltiplas alternativas, ligar streaming, reter a requisição por flags de armazenamento do provedor, nem elevar o teto de tokens de saída deste componente. Campos de capacidade futuros e desconhecidos são descartados por padrão.
- System Instructions, Prompt, Context e os valores de Response gerados são omitidos das entradas de argumento e de retorno deste próprio componente de AI no log automático de execução do workflow. Eles continuam disponíveis para os componentes seguintes enquanto a execução acontece. Se você inserir um deles em outro componente, vale a política de registro daquele componente, que pode gravar o valor resolvido; trate o reúso como uma divulgação explícita. Nomes de provedor e de modelo, contagens de tokens, o LLM Log ID e mensagens de erro seguras continuam visíveis, para operação e cobrança. Corpos brutos de erro do provedor ficam de fora dos registros de workflow, dos registros de LLM, dos registros da aplicação e dos traces, porque um provedor pode ecoar o conteúdo da requisição.

Trate cada variável referenciada como um dado que você está intencionalmente enviando ao provedor. Em especial, não insira uma variável global secreta no prompt ou no contexto a menos que essa divulgação seja necessária e o provedor esteja aprovado para recebê-la. Um provedor local self-hosted como o Ollama consegue manter a requisição dentro da sua própria infraestrutura; um provedor hospedado recebe a requisição sob os termos de tratamento de dados dele.

Cada chamada é registrada em **Configurações do projeto → IA → Registros de IA**, com provedor, modelo, status, tokens, custo e informações de cobrança. Prévias de prompt e de resposta e detalhes brutos de erro do provedor não são armazenados no registro de IA. Chamadas por um provedor global com custo consomem o saldo de créditos de IA do projeto. A AI de workflow também conta para o orçamento diário de tokens de AI autônoma do projeto; quando o orçamento acaba, o componente segue pelo caminho **Error** sem contatar o modelo. A AI do projeto precisa estar habilitada. No OneUptime Cloud, a assinatura precisa estar em dia e o plano Growth (ou um plano que inclua os recursos do Growth) é obrigatório; instalações self-hosted com cobrança desativada não têm essa exigência de plano.

Limites embutidos mantêm as chamadas não supervisionadas finitas: System Instructions, Prompt e o Context serializado somados têm teto de 50.000 caracteres; Temperature precisa ficar entre `0` e `1`; Maximum Output Tokens precisa ficar entre `1` e `4096` (padrão `1024`); e a requisição ao provedor é tentada uma vez e expira em no máximo 60 segundos. No máximo três chamadas de AI de workflow rodam ao mesmo tempo por projeto; as demais seguem pelo caminho **Error** e podem ser repetidas em uma execução posterior. Falhas de validação, configuração, acesso, orçamento, saldo, concorrência, provedor e tempo limite seguem todas pelo caminho **Error** e preenchem a saída **Error**. Conecte esse caminho antes de habilitar um workflow em produção.

## Permissões

Workflows respeitam o controle de acesso baseado em papéis do seu projeto. As três funções de workflow:

- **Workflow Admin** — constrói workflows: cria, altera, executa e exclui, e gerencia as variáveis que eles usam.
- **Workflow Member** — usa os workflows: abre os workflows e suas execuções, e executa um workflow à mão com **Executar fluxo de trabalho**. Um membro não pode criar, alterar ou excluir um workflow, nem executar uma de suas etapas sozinha.
- **Workflow Viewer** — lê os workflows e suas execuções.

**Project Owner** e **Project Admin** podem fazer tudo o que um Workflow Admin faz. **Project Member** pode criar e excluir workflows, mas não alterá-los nem executá-los.

As permissões individuais, para uma equipe ou chave de API que precisa de exatamente uma coisa:

- **Create / Read / Edit / Delete Workflow** — as permissões básicas sobre o próprio workflow. Alterar um workflow, inclusive ligá-lo, desligá-lo e arquivá-lo, exige **Edit Workflow**; **Delete Workflow** só exclui.
- **Edit Workflow** — também é o que se precisa para executar uma única etapa sozinha com **Run just this step**, e para ver ou redefinir a URL do webhook e o endereço de e-mail de entrada de um workflow. Executar um workflow inteiro à mão exige **Edit Workflow**, **Workflow Admin** ou **Workflow Member**.
- **Read Workflow Log** — necessária para ver as execuções.
- **Read / Create / Edit / Delete Workflow Variable** — controle sobre a lista de variáveis globais.

Uma execução à mão só alcança os workflows que você consegue abrir: uma função limitada a alguns rótulos, ou aos workflows que sua equipe possui, executa só esses. Quem não pode executar um workflow vê **Executar fluxo de trabalho** esmaecido, com o motivo na dica.

Dê **Workflow Admin** a quem constrói a automação e **Workflow Member** a quem só a inicia. Reserve o acesso de edição de variáveis para quem cuida dos segredos do projeto.

## O que os passos de um workflow podem fazer

Os passos que leem e alteram registros do OneUptime (os componentes Find, Create, Update e Delete e os gatilhos On Create, On Update e On Delete) agem como um **Project Admin** do projeto do workflow. Passam pelas mesmas verificações que um Project Admin no painel e na API:

- **Somente o projeto do próprio workflow.** Um passo nunca lê nem altera registros de outro projeto, e um Update nunca move um registro para outro projeto.
- **Somente o que um Project Admin pode fazer.** Um passo não pode conceder permissões que um Project Admin não tem (como **Project Owner** ou faturamento), nem adicionar alguém a uma equipe com mais permissões, como a equipe de proprietários.
- **Somente o que o seu plano inclui.** No OneUptime Cloud, o que o seu plano não inclui é recusado com o nome do plano necessário.
- **Nada do que o OneUptime mantém por conta própria.** Entradas de feed não podem ser editadas nem excluídas, registros de notificações não podem ser escritos, e valores que o OneUptime define por conta própria (como um CNAME verificado, os interruptores de proteção de uma equipe ou quem está de plantão agora) não podem ser alterados. Um passo **Create One Incident** também não pode declarar um incidente a partir de um modelo (`createdIncidentTemplateId`): leia o modelo com **Find One Incident Template** e passe os seus valores.
- **Como nenhuma pessoa.** Um registro que um workflow cria não tem criador, e o log de auditoria nomeia o workflow como autor da alteração.

Um passo recusado segue pela sua saída **Error** sem fazer a alteração recusada, e o log da execução diz qual passo foi recusado e por quê. Um passo Create Many cria seus registros um de cada vez e para no recusado; os criados antes dele permanecem. Passos que falam com outros sistemas (API, e-mail, chat, Custom Code, IA) não são afetados.

## Limites do plano

O OneUptime Cloud limita o número de execuções por mês nos planos menores. Seu limite atual aparece em **Configurações do projeto → Cobrança**. Ao atingi-lo, novos disparos são recusados até o próximo ciclo de cobrança. Instalações self-hosted não têm esse limite.

## Quando workflow não é a ferramenta certa

Alguns casos em que você deve buscar outra coisa:

- **Computação pesada ou grandes volumes de dados** — workflows são feitos para trabalho leve de ligação, não para processamento pesado. Rode o trabalho pesado na sua própria infraestrutura e deixe um workflow dar a partida.
- **Computação ativa de longa duração** — uma tentativa de execução deve terminar rápido. Para uma espera passiva do tipo "faça A, espere duas horas, faça B", use o componente **Sleep**; ele persiste a execução e a retoma depois, sem ocupar um worker.
- **Resposta a incidentes passo a passo com humanos no loop** — é para isso que servem os [Runbooks](/docs/runbooks/index). Workflows são para automação não supervisionada.

## Onde ler em seguida

- [Visão geral dos workflows](/docs/workflows/index) — o panorama geral.
- [Componentes de workflow](/docs/workflows/components) — referência bloco a bloco.
- [Visão geral dos Runbooks](/docs/runbooks/index) — quando usar um runbook em vez disso.
