# Configuração e segurança de workflow

O que saber antes de colocar um workflow diante de tráfego real: como ligá-lo com segurança, quem pode fazer o quê, como segredos e URLs ficam privados, o que os passos de um workflow podem alterar e os limites dentro dos quais cada execução trabalha.

:::cards
- [Entrar em produção](#ligar-e-desligar-um-workflow): Teste com Executar fluxo de trabalho e depois deixe o workflow ligado.
- [Permissões](#permissões): Os papéis de workflow e as permissões individuais por trás deles.
- [O que os passos podem fazer](#o-que-os-passos-de-um-workflow-podem-fazer): Os passos agem como Project Admin do projeto do workflow.
- [Limites](#limites-do-plano): Execuções por plano, duração de uma execução e chamadas entre workflows.
:::

## Ligar e desligar um workflow

Todo workflow tem uma chave **Habilitado** no topo do **Construtor** dele e na página **Visão geral**. Quando está desligado, o workflow não roda — chamadas de webhook, e-mails recebidos, horários agendados e eventos do OneUptime são todos ignorados, assim como **Executar fluxo de trabalho** e **Run just this step**. Os novos workflows começam desabilitados.

Use essa chave como o seu sinal de «pronto para rodar»:

:::steps
1. Monte o workflow.
2. Clique em **Executar fluxo de trabalho** no **Construtor** com valores realistas. Um workflow desabilitado não roda nem manualmente, então o Construtor pede para ligá-lo primeiro: clique em **Ativar e executar**.
3. Abra a execução e confira se cada bloco foi para onde você esperava. Veja [Execuções](/docs/workflows/runs-and-logs).
4. Deixe **Habilitado** ligado se estiver pronto. Se não estiver, desligue-o até estar: enquanto ele está ligado, o gatilho dispara com eventos reais.
:::

Desligar um workflow impede que novas execuções comecem. Uma execução que já está em andamento termina, mas uma execução esperando em um bloco **Sleep** é cancelada ao acordar.

## Arquivar um workflow

Arquive um workflow de que você não precisa mais, mas quer guardar. Um workflow arquivado:

- **Nunca roda**, por nenhum gatilho. Execuções manuais e **Run just this step**, chamadas de webhook, agendamentos, eventos do OneUptime, e-mails recebidos e passos **Execute Workflow** de outros workflows são todos recusados. Uma chamada de webhook para um workflow arquivado recebe um erro dizendo que o workflow está arquivado.
- **Para as execuções que estão esperando.** Uma execução adormecida em um passo **Sleep** é cancelada ao acordar, e uma execução que estava na fila mas ainda não tinha começado termina com "Workflow was archived before this run started, so it did not run."
- **Sai da lista de workflows.** Você o encontra em **Fluxos de trabalho → Avançado → Arquivado**.
- **Mantém tudo.** Os passos, as variáveis, os proprietários, os rótulos e o histórico de execuções dele continuam como estavam.

Para arquivar um workflow, abra-o, vá em **Configurações** e clique em **Arquivar**. Para arquivar vários, selecione-os na lista **Fluxos de trabalho** e escolha **Arquivar**.

Para trazer um workflow de volta, abra **Fluxos de trabalho → Avançado → Arquivado**, selecione-o e escolha **Desarquivar**, ou abra-o e clique em **Desarquivar** no banner no topo das páginas dele.

Arquivar e a chave **Habilitado** são independentes. Arquivar não mexe na chave, então um workflow que estava ligado volta a rodar assim que é desarquivado, e um que estava desligado continua desligado. A página **Arquivado** mostra qual é qual na coluna **When Unarchived**.

Um workflow exportado nunca leva o estado de arquivado, então uma cópia importada nunca está arquivada.

## Proprietários e rótulos

| O quê                         | Onde                                                          | O que faz                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Proprietários**             | A página **Proprietários** do workflow                        | Os usuários e equipes responsáveis pelo workflow. Um papel limitado ao que a equipe dele possui alcança os workflows que essa equipe possui.         |
| **Rótulos**                   | A página **Visão geral** do workflow                          | Rótulos para agrupar workflows, por equipe, integração ou ambiente. Filtre a lista **Fluxos de trabalho** por rótulo, e limite um papel a alguns rótulos. |
| **Regras de Rótulos**         | **Fluxos de trabalho → Configurações → Regras de Rótulos**    | Rotula automaticamente os novos workflows, conforme padrões no nome ou na descrição.                                                                |
| **Regras de proprietário**    | **Fluxos de trabalho → Configurações → Regras de proprietário** | Atribui automaticamente proprietários aos novos workflows.                                                                                         |

Veja [Regras de rótulos e de proprietários](/docs/configuration/label-and-owner-rules) para saber como as regras correspondem.

## Segredos

Marque uma variável como **secreta** se ela contiver algo sensível: o valor dela passa a ser apagado dos logs de execução e dos rastros dos passos. Nenhum valor de variável pode ser lido de volta depois de salvo, secreto ou não, nem no dashboard nem pela API, e uma variável que se torna secreta continua secreta.

Use variáveis secretas para:

- Chaves de API de serviços externos.
- Tokens de autenticação.
- Chaves de assinatura de webhook.
- Qualquer coisa que você não queira que alguém com acesso só de leitura veja.

Não cole um segredo direto em um bloco — valores como `Authorization: Bearer eyJh...` acabam visíveis no workflow e nos logs. Use `{{global.variables.MY_SECRET}}` em vez disso.

Se o segredo for um token de acesso OAuth que expira, transforme a variável em uma [variável OAuth 2.0](/docs/workflows/variables#variáveis-oauth-20-tokens-que-se-renovam-sozinhos). O OneUptime passa então a obter o token do seu provedor de identidade e a renová-lo sempre que um workflow está prestes a usar um expirado. As variáveis OAuth 2.0 são sempre secretas, e as credenciais delas são criptografadas no banco de dados.

## Exportar e importar workflows

Você pode mover um workflow entre projetos, ou entre uma instalação self-hosted e o OneUptime Cloud, como um arquivo JSON.

:::tabs
@tab Exportar
Abra o workflow, vá em **Configurações** e clique em **Exportar: Fluxo de trabalho**. Para colocar vários workflows em um arquivo, selecione-os na lista **Fluxos de trabalho** e escolha **Exportar: JSON**.
@tab Importar
Na lista **Fluxos de trabalho**, clique em **Import JSON** e escolha um arquivo exportado de qualquer projeto do OneUptime. Um workflow cujo nome o projeto já tem é importado com "(Imported)" depois do nome.
:::

O arquivo contém o nome do workflow, a descrição, o estado de ativação e o grafo. De propósito, ele não contém:

- **A chave secreta do webhook.** Uma nova é gerada quando o workflow é criado, então um workflow importado tem outra URL de webhook — copie-a do gatilho Webhook do novo workflow. Tudo o que chamava o original precisa ser reapontado.
- **O endereço de e-mail recebido.** Um workflow importado com um gatilho Incoming Email recebe um endereço próprio — copie-o do gatilho do novo workflow. Tudo o que mandava e-mail para o original precisa receber o novo endereço.
- **As variáveis globais.** Um bloco que lê `{{global.variables.MY_SECRET}}` mantém essa referência, mas o valor não está no arquivo. Crie as variáveis no projeto de destino antes de rodar o workflow importado.
- **Os proprietários e os rótulos.** As regras de rótulos e de proprietários do seu projeto são aplicadas ao workflow importado, como se você o tivesse criado manualmente.

Um workflow importado é sempre criado **desabilitado**, mesmo que estivesse habilitado de onde foi exportado — o grafo dele pode apontar para monitores, políticas de plantão ou outros workflows que não existem no projeto de destino. Revise-o, ligue-o, teste-o com **Executar fluxo de trabalho** e depois deixe-o ligado. Duplicar um workflow funciona do mesmo jeito, então uma cópia nunca começa a disparar junto com o original antes de você editá-la.

Como o grafo viaja como está, qualquer coisa digitada direto em um bloco viaja junto. Esse é o motivo prático para guardar credenciais em variáveis secretas: exportar um workflow com um token fixo no código entrega esse token a quem receber o arquivo.

## Segurança do webhook

Os gatilhos de webhook dão a você uma URL única. Qualquer pessoa que conheça a URL pode chamá-la. Para se proteger de chamadas acidentais ou indesejadas:

- Trate a URL como uma senha. Não a compartilhe publicamente nem a coloque em um repositório público. O gatilho Webhook oculta a chave secreta da URL até você clicar em **Mostrar**, e **Copiar URL** copia a URL sem mostrá-la.
- Se a URL vazar, clique no gatilho Webhook no **Construtor** e depois em **Redefinir URL**. O workflow recebe uma URL nova e a antiga para de funcionar na hora.
- Se o gatilho disser que a URL dele termina com o ID do workflow, redefina-a. Workflows criados antes de as URLs de webhook terem uma chave secreta própria usam o ID do workflow no lugar dela, e qualquer pessoa que pode abrir o workflow consegue vê-lo.
- Para workflows sensíveis, peça ao sistema que chama que envie um token compartilhado em um cabeçalho (como `X-Webhook-Token`) e verifique-o com um bloco **If / Else** antes de fazer qualquer coisa importante. Salve o token esperado como variável secreta.
- Para workflows muito sensíveis, prefira um gatilho de evento do OneUptime e um passo de importação manual a um webhook público.

Só quem pode editar o workflow — **Project Owner**, **Project Admin**, **Workflow Admin** ou **Edit Workflow** — pode ver ou redefinir a URL de webhook dele. Qualquer pessoa com a URL pode iniciar o workflow de qualquer lugar, sem fazer login, então todos os outros veem uma nota dizendo a quem pedir. Isso inclui um **Workflow Member**, que roda o workflow manualmente pelo **Construtor**.

## Segurança do e-mail recebido

O gatilho Incoming Email dá ao workflow um endereço próprio, e qualquer pessoa que conheça o endereço pode mandar e-mail para ele. A parte antes do `@` é a chave secreta do workflow, então trate o endereço como uma senha:

- Não o publique nem o coloque em um repositório público. O gatilho oculta a chave até você clicar em **Mostrar**, e **Copiar endereço** copia o endereço sem mostrá-lo.
- Se o endereço vazar, clique no gatilho Incoming Email no **Construtor** e depois em **Redefinir endereço**. O workflow recebe um endereço novo, e e-mails para o antigo passam a ser ignorados.
- Qualquer pessoa pode colocar qualquer remetente em um e-mail, então **From** não prova quem o enviou. Antes que um workflow faça algo importante, verifique algo que só o remetente real saiba — um token no assunto ou em um cabeçalho — com um bloco **If / Else**. Salve o token esperado como variável secreta.
- A chave fica oculta em tudo o que a execução recebe — **To**, **CC**, os cabeçalhos e os corpos —, porque o log da execução fica visível para qualquer pessoa que pode ler as execuções do workflow.

Só quem pode editar o workflow — **Project Owner**, **Project Admin**, **Workflow Admin** ou **Edit Workflow** — pode ver ou redefinir o endereço dele. Todos os outros veem uma nota dizendo a quem pedir.

## Acesso de rede para fora

Os blocos API e os outros blocos HTTP fazem as requisições a partir do OneUptime, e o bloco IRC se conecta do OneUptime à porta do servidor IRC. Se você usa self-hosting, garanta que a sua instalação consegue alcançar os serviços que você chama. Se você usa o OneUptime Cloud, os nossos intervalos de IP de saída estão em [Endereços IP](/docs/configuration/ip-addresses), para você permiti-los do outro lado.

Os endereços que um bloco pode alcançar dependem do bloco:

| Blocos                                                     | Loopback, link-local, metadados de nuvem                                      | Endereços de rede privada                                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Os blocos **API** e as requisições de **Run Custom JavaScript** | Recusados, a menos que o host exato esteja em `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Recusados, a menos que um administrador self-hosted os permita com `ALLOW_PRIVATE_NETWORK_WEBHOOKS` ou `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Send Email**, **IRC** e as URLs de token OAuth 2.0       | Recusados                                                                     | Recusados no OneUptime Cloud. Permitidos em uma instalação self-hosted, a menos que `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` seja `true`     |
| Slack, Microsoft Teams, Discord e Telegram                 | Recusados                                                                     | Recusados: cada um só envia para os endereços do próprio serviço                                                                          |

Veja [Acesso a redes privadas](/docs/self-hosted/private-network-access) para saber como um administrador self-hosted os libera.

## Componentes de AI

**Generate Text with AI** envia uma requisição a um LLM: o provedor de LLM padrão do projeto, ou o provedor global da instalação quando o projeto não tem um. Configure os provedores em **Configurações do projeto → IA → Provedores LLM**, e nunca coloque a chave de API de um provedor ou um endpoint seu em um workflow.

O que o provedor recebe, e o que o modelo pode fazer com isso:

- **Só o que você coloca no bloco.** O OneUptime envia uma instrução de segurança fixa e depois as **System Instructions**, o **Prompt** e o **Context** do bloco, com as referências preenchidas. **Context** vem por último, depois de um marcador, e a instrução de segurança diz ao modelo que tudo o que vem depois do marcador são dados não confiáveis, mesmo um texto que pareça instruções.
- **Nada mais.** Os dados do gatilho, o histórico do workflow, as saídas de outros blocos, os registros do projeto, a telemetria e os segredos nunca são anexados. Eles só saem do OneUptime quando você faz referência a eles em uma dessas três configurações.
- **Texto, e nenhuma ferramenta.** O modelo não consegue consultar o OneUptime, fazer requisições HTTP nem alterar dados. Os parâmetros adicionais de um provedor só deixam passar uma lista permitida de campos de ajuste da geração: eles não podem substituir as mensagens, acrescentar ferramentas, busca na web ou outras fontes de dados, pedir algo além de texto ou várias respostas, ativar streaming, fazer o provedor guardar a requisição nem aumentar o limite de saída do bloco. Os campos que o OneUptime não conhece são descartados.
- **O modelo é escolha do seu administrador.** Se a geração precisa ficar offline, escolha um modelo que não busque nada por conta própria do lado do provedor.

O que é registrado:

- O log da execução oculta as **System Instructions**, o **Prompt**, o **Context** e a **Response** do bloco. Os blocos seguintes ainda podem usá-los durante a execução, e um bloco em que você insere um deles o registra pelas regras dele, então inseri-lo é uma escolha de mostrá-lo.
- O provedor, o modelo, as contagens de tokens, o **LLM Log ID** e uma mensagem de erro segura continuam visíveis, para operação e cobrança. O erro bruto de um provedor fica fora de todos os logs, porque um provedor pode repetir a requisição nele.
- Cada chamada aparece em **Configurações do projeto → IA → Registros de IA** com o provedor, o modelo, o status, os tokens, o custo e a cobrança, sem o prompt, a resposta nem o erro bruto.

Do que o bloco precisa, e quanto ele custa:

- **Habilitar IA** precisa estar ligado, em **Configurações do projeto → IA → AI Features**. No OneUptime Cloud, o projeto também precisa do plano Growth ou superior e de uma assinatura paga. Instalações self-hosted sem cobrança não têm restrição de plano.
- As chamadas por um provedor global pago usam os créditos de IA do projeto.
- Cada chamada conta para os [limites diários de IA do próprio projeto](/docs/ai/ai-sre#the-projects-own-daily-limits), quando um proprietário do projeto os define. Quando um limite é atingido, o bloco toma **Error** sem contatar o modelo, até a meia-noite UTC.

| Limite                                                       | Valor                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **System Instructions**, **Prompt** e **Context** juntos     | 50.000 caracteres                                                         |
| **Temperature**                                              | De `0` a `1`                                                              |
| **Maximum Output Tokens**                                    | De `1` a `4096`, `1024` por padrão                                        |
| Uma requisição                                               | Uma única tentativa, de no máximo 60 segundos                             |
| Chamadas ao mesmo tempo                                      | 3 por projeto. As demais tomam **Error**, e uma execução posterior pode tentar de novo. |

As falhas de validação, configuração, acesso, limite, créditos, concorrência, provedor e tempo esgotado tomam todas o caminho **Error**, com o motivo em **Error**. Ligue esse caminho antes de o workflow entrar em produção.

> [!WARNING]
> Cada valor a que você faz referência é um dado que você envia ao provedor. Não coloque uma variável secreta no prompt nem no contexto, a menos que o provedor esteja aprovado para recebê-la. Um provedor local self-hosted como o Ollama mantém as requisições dentro da sua própria infraestrutura; um provedor hospedado as recebe sob os termos de tratamento de dados dele.

## Permissões

Os workflows respeitam o controle de acesso baseado em papéis do seu projeto. Os três papéis de workflow:

- **Workflow Admin** — monta workflows: cria, altera, executa e exclui, e gerencia as variáveis que eles usam.
- **Workflow Member** — usa workflows: abre os workflows e as execuções deles, e roda um workflow manualmente com **Executar fluxo de trabalho**. Um membro não pode criar, alterar nem excluir um workflow, nem rodar um dos passos dele sozinho.
- **Workflow Viewer** — lê os workflows e as execuções deles.

**Project Owner** e **Project Admin** podem fazer tudo o que um Workflow Admin pode. **Project Member** pode criar e excluir workflows, mas não alterá-los nem executá-los.

As permissões individuais, para uma equipe ou uma chave de API que precisa de exatamente uma coisa:

- **Create / Read / Edit / Delete Workflow** — as permissões básicas sobre o próprio workflow. Alterar um workflow, inclusive ligá-lo, desligá-lo ou arquivá-lo, exige **Edit Workflow**; **Delete Workflow** só exclui.
- **Edit Workflow** — também é o que é preciso para rodar um passo sozinho com **Run just this step**, e para ver ou redefinir a URL de webhook e o endereço de e-mail recebido de um workflow. Rodar um workflow inteiro manualmente exige **Edit Workflow**, **Workflow Admin** ou **Workflow Member**.
- **Read Workflow Log** — necessária para ver as execuções.
- **Create / Read / Edit / Delete Workflow Variables** — gerenciar as variáveis globais e de workflow.

Uma execução manual só alcança os workflows que você pode abrir: um papel limitado a alguns rótulos, ou aos workflows que a sua equipe possui, só roda esses. Quem não pode rodar um workflow vê **Executar fluxo de trabalho** em cinza, com o motivo na dica.

Dê **Workflow Admin** a quem monta a automação, e **Workflow Member** a quem só a inicia. Reserve o acesso de edição de variáveis a quem gerencia os segredos do projeto. Veja [Usuários, equipes e permissões](/docs/permissions/index) para saber como os papéis são concedidos.

## O que os passos de um workflow podem fazer

Os passos que leem e alteram registros do OneUptime — os componentes Find, Create, Update e Delete, e os gatilhos On Create, On Update e On Delete — agem como **Project Admin** do projeto do workflow. Seja quem for que montou o workflow, um passo passa pelas mesmas verificações que um Project Admin passa no dashboard e na API:

- **Só o projeto do próprio workflow.** Um passo lê e grava os registros do projeto ao qual o workflow pertence e de nenhum outro, e um Update nunca move um registro para outro projeto.
- **Só o que um Project Admin pode fazer.** Um passo só pode conceder as permissões de equipe e de chave de API que um Project Admin tem, então não pode dar **Project Owner**, permissões de cobrança ou de exclusão do projeto, e não pode adicionar alguém a uma equipe cujas permissões vão além das de um Project Admin, como a equipe de proprietários. Um passo não pode ler quem criou uma sonda ou um agente de IA, o que só os proprietários do projeto veem.
- **Não a leitura de credenciais de runbook.** Um Project Admin pode ler credenciais de runbook, mas isso não é emprestado a um passo. Quando uma alteração exige essa leitura — deixar o OneUptime AI rodar os comandos dele sem perguntar, ativar **Executa comandos de remediação por IA** em um Runner, atribuir uma credencial SSH a um Runner que roda os comandos do OneUptime AI ou indicar uma credencial de runbook, por exemplo nos passos de um runbook —, a verificação é feita sobre a pessoa que salvou os passos do workflow por último, e o passo é recusado a menos que ela possa ler credenciais de runbook (**Read Runbook Credential**, ou um Project Owner ou Project Admin). O OneUptime registra essa pessoa quando alguém cria o workflow e cada vez que alguém salva os passos dele; renomear o workflow, mudar os rótulos ou ligá-lo e desligá-lo mantém quem salvou os passos por último. Salvar os passos com uma chave de API não registra ninguém, então os passos do workflow não podem fazer essas alterações até uma pessoa salvá-los.
- **Só o que o seu plano inclui.** No OneUptime Cloud, um passo que cria ou altera algo que o seu plano não inclui é recusado com o plano necessário, como no dashboard. Instalações self-hosted sem cobrança não têm limites de plano.
- **Nada do que o OneUptime guarda para si.** Isto é recusado a todos, workflows incluídos:
  - editar ou excluir uma entrada de feed (os feeds de incidentes, alertas, episódios, monitores, políticas de plantão e manutenções agendadas);
  - gravar um log de notificação (os logs de SMS, chamadas, e-mail, WhatsApp, Telegram, push, webhook e mensagens de workspace);
  - os valores que o OneUptime define conforme as coisas acontecem: se o CNAME de um domínio personalizado está verificado, as chaves de proteção de uma equipe (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), qual papel de incidente é o principal e se ele pode ser excluído, se um proprietário ou membro foi notificado, os horários e contagens de lembretes, quem está de plantão agora e em seguida em uma escala, o andamento de uma execução de plantão, a taxa de consumo e o error budget atuais de um SLO, um monitor pausado por um incidente ou uma manutenção, o token de redefinição de senha e o último acesso de um usuário privado de uma página de status, os dados que um serviço informa sobre si mesmo (versão, runtime, nuvem) e a última execução de uma regra de detecção ou de um feed de ameaças;
  - declarar um incidente a partir de um modelo enviando `createdIncidentTemplateId` para **Create One Incident** — escolha o modelo na configuração **Incident Template** do passo: o passo então declara o incidente a partir dele, como Project Admin, e registra o modelo;
  - alterar a qual registro um registro pertence depois de criado, como o monitor de uma linha de proprietário ou o incidente de uma nota.
- **Como ninguém.** Um registro que um workflow cria não nomeia criador, e o log de auditoria nomeia o workflow, com o nome que ele tinha na hora, como autor da alteração.

Quando uma verificação recusa um passo, o passo toma a saída **Error** sem fazer a alteração recusada, e o log da execução nomeia o passo e o motivo em palavras simples, por exemplo *"Create One Team Permission" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Leia-o nas [Execuções](/docs/workflows/runs-and-logs) do workflow. Um passo Create Many cria os registros um de cada vez e para no primeiro recusado: os registros criados antes dele são mantidos.

Os passos que conversam com outros sistemas — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Custom Code e Generate Text with AI — não leem nem alteram registros do OneUptime, então nada disso os afeta.

## Limites do plano

No OneUptime Cloud, os workflows exigem o plano Growth ou superior, e cada plano permite um número de execuções em qualquer período de 30 dias:

| Plano      | Execuções nos últimos 30 dias |
| ---------- | ----------------------------- |
| Growth     | 500                           |
| Scale      | 2.000                         |
| Enterprise | Sem limite prático            |

A janela é móvel: cada execução que o projeto registra, manual ou por um gatilho, conta por 30 dias. Nos planos Growth e Scale, a página **Fluxos de trabalho** mostra um cartão **Execuções do Fluxo de Trabalho** com quantas o projeto já usou. Quando o limite é atingido, as novas execuções são registradas com o status **Execution Exceeded Current Plan** e não rodam, e o mesmo acontece enquanto a assinatura estiver em atraso. Instalações self-hosted sem cobrança não têm limite.

## Quanto tempo uma execução pode durar

| Limite                                                       | Padrão             | Configuração self-hosted        |
| ------------------------------------------------------------ | ------------------ | ------------------------------- |
| Uma execução, desde o início ou desde que acorda depois de um **Sleep** | 2 minutos | `WORKFLOW_TIMEOUT_IN_MS`        |
| Um bloco **Run Custom JavaScript**                           | 5 segundos         | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| Um bloco **Sleep**                                           | No máximo 30 dias  | —                               |

O executor verifica o prazo antes e depois de cada bloco, e marca uma execução atrasada como **Timeout** assim que retoma o controle. Ele não consegue interromper um bloco no meio, então os blocos que esperam pela rede têm limites de tempo próprios: uma requisição de Generate Text with AI desiste depois de no máximo 60 segundos, e uma requisição de token OAuth 2.0 depois de 20. Uma espera em um bloco **Sleep** não conta para o tempo de uma execução: a execução é deixada de lado e recebe 2 minutos novos ao acordar.

## Limite para chamar outros workflows

O componente **Execute Workflow** permite que um workflow inicie outro. Para evitar loops em que o workflow A inicia o B, que inicia o A de novo, uma cadeia de workflows que se iniciam uns aos outros é recusada quando voltaria a um workflow que já está nela, ou passaria de 10 workflows de profundidade. O bloco **Execute Workflow** então toma a saída **Error**, e o erro mostra a cadeia.

Se você precisa mesmo de uma cadeia longa (como um job que processa um item por execução), normalmente é mais simples fazer o loop dentro de um único workflow com **Run Custom JavaScript**.

## Quando workflow não é a ferramenta certa

Alguns casos em que vale usar outra coisa:

- **Processamento pesado ou grandes volumes de dados** — os workflows foram feitos para um trabalho leve de integração, não para processar números em massa. Rode o trabalho pesado na sua própria infraestrutura e deixe um workflow dispará-lo.
- **Processamento ativo de longa duração** — uma execução tem 2 minutos por padrão. Para uma espera passiva como «faça A, espere duas horas, faça B», use o componente **Sleep**; ele deixa a execução de lado e a retoma depois, sem ocupar um worker.
- **Resposta a incidentes passo a passo com pessoas envolvidas** — é para isso que existem os [Runbooks](/docs/runbooks/index). Os workflows são para automação sem supervisão.

## Próximos passos

:::cards
- [Visão geral dos workflows](/docs/workflows/index): O panorama geral e um primeiro workflow de ponta a ponta.
- [Componentes](/docs/workflows/components): Do que cada bloco precisa, o que devolve e o que pode alcançar.
- [Runbooks](/docs/runbooks/index): Quando as pessoas precisam tomar as decisões pelo caminho.
:::
