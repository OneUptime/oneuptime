# Configuração e segurança de workflow

Esta página cobre as configurações e os limites de segurança que vale a pena conhecer antes de expor um workflow a tráfego real.

## Ligando ou desligando um workflow

Todo workflow tem um interruptor **Enabled** em **Settings**. Quando está desligado, o workflow não roda — chamadas de webhook, horários agendados e eventos do OneUptime são todos ignorados. Novos workflows começam desabilitados.

Use esse interruptor como sua trava de "pronto para ir":

1. Construa o workflow.
2. Clique em **Run Workflow** no **Builder** com valores realistas.
3. Verifique os **Logs** — certifique-se de que cada bloco foi para onde você esperava.
4. Ligue **Enabled**.

Desligar um workflow não interrompe execuções já em andamento; apenas impede que novas comecem.

## Proprietários e labels

- **Owners** — usuários e times listados como proprietários têm acesso ao workflow e podem optar por receber notificações quando ele falhar. Configure-os em **Settings → Owners**.
- **Labels** — tags para agrupar workflows. A lista de workflows permite filtrar por label, o que torna um projeto movimentado muito mais fácil de navegar. Útil quando você tem workflows organizados por time, integração ou ambiente.
- **Label rules** — em **Workflows → Settings → Label Rules**, aplique labels automaticamente a novos workflows com base em padrões de nome ou descrição.
- **Owner rules** — em **Workflows → Settings → Owner Rules**, atribua proprietários automaticamente a novos workflows.

## Segredos

Marque uma variável global como **secret** se ela contiver algo sensível. O valor fica oculto em leituras normais via API e UI depois de salvo, e o log de workflow apaga o valor resolvido antes de o registro de execução ser persistido.

Use variáveis secretas para:

- API keys de serviços externos.
- Tokens de autenticação.
- Chaves de assinatura de webhook.
- Qualquer coisa que você não gostaria que alguém com acesso somente leitura visse.

Não cole um segredo diretamente em um bloco — valores como `Authorization: Bearer eyJh...` acabam visíveis no workflow e nos logs. Use `{{global.variables.MY_SECRET}}` em vez disso.

## Exportando e importando workflows

Você pode mover um workflow entre projetos, ou entre uma instalação self-hosted e o OneUptime Cloud, como um arquivo JSON.

- **Export** — abra o workflow e use **Export Workflow** em **Settings**. A partir da lista de workflows, você também pode selecionar vários workflows e exportá-los em um único arquivo.
- **Import** — na lista **Workflows**, clique em **Import JSON** e escolha um arquivo exportado de qualquer projeto OneUptime.

O arquivo contém o nome do workflow, a descrição, o estado habilitado e seu grafo. Ele deliberadamente não contém:

- **A chave secreta do webhook.** Uma nova é gerada quando o workflow é criado, então um workflow importado tem uma URL de webhook diferente. Qualquer coisa que chamava a original precisa ser redirecionada.
- **Variáveis globais.** Um bloco que lê `{{global.variables.MY_SECRET}}` mantém essa referência, mas o valor não está no arquivo. Crie as variáveis no projeto de destino antes de rodar o workflow importado.
- **Proprietários e labels.** As próprias regras de label e de proprietário do seu projeto rodam sobre o workflow importado, da mesma forma que se você o tivesse criado manualmente.

Um workflow importado é sempre criado **desabilitado**, mesmo que estivesse habilitado no local de onde foi exportado — seu grafo pode apontar para monitores, políticas de plantão ou outros workflows que não existem no projeto de destino. Revise-o, habilite-o, teste-o com **Run Workflow** e só então deixe-o ligado. Duplicar um workflow se comporta da mesma forma, então uma cópia nunca começa a disparar junto com a original antes de você editá-la.

Como o grafo viaja literalmente, tudo o que foi digitado diretamente em um bloco viaja junto. Essa é a razão prática para manter credenciais em variáveis secretas: exportar um workflow com um token fixo entrega esse token a quem receber o arquivo.

## Quanto tempo uma execução pode levar

Cada tentativa de execução tem um prazo de relógio de parede. O executor verifica isso antes e depois de cada componente e marca uma execução atrasada como **Timeout** assim que o controle retorna. Componentes que fazem trabalho de rede ou de script também precisam de seus próprios timeouts, pois o executor não consegue interromper à força um código de componente arbitrário.

O componente de IA deriva seu timeout de requisição ao provedor a partir do tempo restante do workflow e o limita a 60 segundos, deixando uma pequena margem para logging e limpeza.

## Limite para chamar outros workflows

O componente **Execute Workflow** permite que um workflow chame outro. Para evitar loops acidentais em que o workflow A chama B, que chama A novamente, existe um limite de profundidade para a cadeia. Uma execução que ultrapassa o limite termina com um erro claro.

Se você tem uma necessidade real de uma cadeia longa (como um job que processa um item por execução), geralmente é mais simples fazer um loop dentro de um único workflow usando **Custom Code**.

## Segurança de webhook

Triggers de webhook fornecem uma URL única. Qualquer pessoa que conheça a URL pode acessá-la. Para se proteger contra chamadas acidentais ou indesejadas:

- Trate a URL como uma senha. Não a compartilhe publicamente nem a envie para um repositório público.
- Para workflows sensíveis, peça ao sistema que chama para enviar um token compartilhado em um header (como `X-Webhook-Token`) e verifique-o com um bloco **Conditions** antes de fazer qualquer coisa importante. Salve o token esperado como uma variável secreta.
- Para workflows muito sensíveis, prefira um trigger de evento do OneUptime e uma etapa de importação manual em vez de um webhook público.

## Acesso de rede de saída

Blocos de API e outros blocos HTTP fazem suas requisições a partir do OneUptime. Se você faz self-host, garanta que sua instalação consiga alcançar os serviços que está chamando. Se você usa o OneUptime Cloud, nossos intervalos de IP de saída estão listados em [IP Addresses](/docs/configuration/ip-addresses) para que você possa liberá-los do outro lado.

## Componentes de IA

**Generate Text with AI** envia uma requisição através do gateway de LLM configurado do OneUptime. Ele usa o provedor de LLM padrão do projeto, ou o provedor global da instalação quando o projeto não tem um. Configure provedores em **Project Settings → AI → LLM Providers**; nunca coloque uma API key de provedor ou um endpoint de modelo arbitrário diretamente no workflow.

O componente de IA tem uma fronteira de saída explícita:

- O OneUptime envia uma instrução fixa de segurança do componente, junto com os campos **System Instructions**, **Prompt** e **Context** serializado resolvidos, para o provedor configurado. O Context é anexado após um marcador explícito no final da mensagem do usuário; a instrução fixa afirma que tudo depois desse marcador permanece dado não confiável, mesmo que contenha tags ou instruções.
- Ele não anexa automaticamente o payload do trigger, o histórico do workflow, saídas de outros componentes, registros do projeto, telemetria ou segredos. Os dados só saem quando você os referencia em uma dessas três entradas.
- Ele não envia definições de ferramentas nem campos de capacidade nativos do provedor. O modelo não consegue consultar o OneUptime, fazer requisições HTTP ou alterar dados do projeto por meio deste componente. O provedor/modelo configurado continua sendo uma fronteira de confiança administrativa, então instalações que exigem geração estritamente offline devem escolher um modelo sem recuperação intrínseca gerenciada pelo provedor.
- Parâmetros adicionais em nível de provedor são restritos a uma lista de permissões de campos de ajuste apenas de geração. Eles não podem substituir as mensagens do workflow, adicionar ferramentas ou busca web/fontes de dados nativas do provedor, habilitar modalidades além de texto, solicitar múltiplas opções, habilitar streaming, reter a requisição por meio de flags de armazenamento do provedor, ou elevar o limite de tokens de saída deste componente. Campos de capacidade futuros e desconhecidos são descartados por padrão.
- Os valores de System Instructions, Prompt, Context e Response gerado são ocultados das próprias entradas de argumento e valor de retorno deste componente de IA no log automático de execução do workflow. Eles permanecem disponíveis para componentes posteriores enquanto a execução está em andamento. Se você inserir um deles em outro componente, a política de log desse componente se aplica e pode registrar o valor resolvido; trate o reuso como uma divulgação explícita. Nomes de provedor/modelo, contagens de tokens, o LLM Log ID e mensagens de erro seguras permanecem visíveis para operações e faturamento. Corpos brutos de erro do provedor são excluídos dos logs de workflow, logs de LLM, logs de aplicação e traces, porque um provedor pode ecoar o conteúdo da requisição.

Trate cada variável referenciada como um dado que você está intencionalmente enviando ao provedor. Em particular, não insira uma variável global secreta no prompt ou no context, a menos que essa divulgação seja necessária e o provedor esteja aprovado para recebê-la. Um provedor local self-hosted como o Ollama pode manter a requisição dentro da sua própria infraestrutura; um provedor hospedado recebe a requisição sob os termos de processamento de dados desse provedor.

Cada chamada é registrada em **Project Settings → AI → AI Logs**, incluindo provedor, modelo, status, tokens, custo e informações de faturamento. Prévias de prompt e resposta, e detalhes brutos de erro do provedor, não são armazenados no AI log. Chamadas por meio de um provedor global pago consomem o saldo de crédito de IA do projeto. O uso de IA em workflow também conta para o orçamento diário de tokens de IA autônoma do projeto; quando o orçamento se esgota, o componente segue pelo caminho **Error** sem contatar o modelo. Project AI precisa estar habilitado. No OneUptime Cloud, a assinatura precisa estar paga e o plano Growth (ou um plano que inclua os recursos do Growth) é necessário; instalações self-hosted com faturamento desabilitado não têm essa restrição de plano.

Limites embutidos mantêm as chamadas não supervisionadas finitas: System Instructions, Prompt e Context serializado são limitados a 50.000 caracteres combinados; Temperature deve estar entre `0` e `1`; Maximum Output Tokens deve estar entre `1` e `4096` (padrão `1024`); e a requisição ao provedor é tentada uma vez e expira após no máximo 60 segundos. No máximo três chamadas de IA de workflow rodam em paralelo por projeto; chamadas adicionais seguem pelo caminho **Error** e podem ser tentadas novamente por uma execução de workflow posterior. Falhas de validação, configuração, acesso, orçamento, saldo, concorrência, provedor e timeout seguem todas pelo caminho **Error** e preenchem a saída **Error**. Conecte esse caminho antes de habilitar um workflow de produção.

## Permissões

Workflows respeitam o controle de acesso baseado em papéis (RBAC) do seu projeto. As permissões relevantes:

- **Create / Read / Edit / Delete Workflow** — as permissões básicas sobre o próprio workflow.
- **Run Workflow** — necessária para rodar um workflow manualmente ou disparar um via API.
- **Read Workflow Log** — necessária para visualizar execuções.
- **Read / Create / Edit / Delete Workflow Variable** — controle sobre a lista de variáveis globais.

A maioria dos engenheiros deve ter create/edit/read em workflows, mas não em variáveis. Reserve o acesso de edição de variáveis para as pessoas que gerenciam os segredos do seu projeto.

## Limites de plano

O OneUptime Cloud limita o número de execuções por mês em planos menores. Seu limite atual é exibido em **Project Settings → Billing**. Ao atingi-lo, novos triggers são rejeitados até o próximo ciclo de faturamento. Instalações self-hosted não têm esse limite.

## Quando workflows não são a ferramenta certa

Alguns casos em que você deve recorrer a outra coisa:

- **Computação pesada ou grandes volumes de dados** — workflows são feitos para trabalho leve de integração, não para processamento numérico. Rode trabalho pesado na sua própria infraestrutura e deixe um workflow iniciá-lo.
- **Computação ativa de longa duração** — uma única tentativa de execução deve terminar rapidamente. Para um atraso passivo como "faça A, espere duas horas, faça B," use o componente **Sleep**; ele persiste a execução e a retoma depois, sem ocupar um worker.
- **Resposta a incidentes passo a passo com humanos no loop** — é para isso que servem os [Runbooks](/docs/runbooks/index). Workflows são para automação não supervisionada.

## Onde ler a seguir

- [Visão geral dos workflows](/docs/workflows/index) — o panorama geral.
- [Componentes de workflow](/docs/workflows/components) — referência bloco a bloco.
- [Runbooks](/docs/runbooks/index) — quando usar um runbook em vez disso.
