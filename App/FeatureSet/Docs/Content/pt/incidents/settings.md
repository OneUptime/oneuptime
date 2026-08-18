# Configurações e automação

A configuração de incidentes não fica em Configurações do projeto. Ela fica dentro da própria área de produto de Incidentes, em **Incidentes → Configurações** e **Incidentes → Regras**, em rotas que começam com `/dashboard/{projectId}/incidents/settings/`. Se você andou caçando modelos de incidente ou campos personalizados em **Configurações do projeto**, é por isso que não conseguiu encontrá-los.

Tanto a seção **Regras** quanto a seção **Configurações** do menu lateral de Incidentes vêm recolhidas por padrão, então você precisa expandi-las antes que os itens abaixo apareçam. Tudo aqui tem escopo de projeto: modelos, funções, campos personalizados e regras pertencem a um projeto e se aplicam a todo incidente declarado nele.

Esta página é a referência dessa configuração — o que cada página contém, e o que dela roda automaticamente no momento em que um incidente é criado.

## Onde ficam as configurações de incidentes

Abra **Incidentes** na navegação à esquerda, depois expanda **Configurações** no fim do menu lateral.

| Página                          | O que você faz ali                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Estado do incidente**         | Adicionar, renomear, recolorir e reordenar os estados pelos quais um incidente passa.           |
| **Severidade do incidente**     | Adicionar, renomear, recolorir e reordenar níveis de severidade.                                |
| **Modelos de incidentes**       | Pré-preencher um incidente inteiro — título, descrição, recursos, políticas de plantão, proprietários, rótulos. |
| **Modelos de notas**            | Texto reutilizável para notas públicas e privadas.                                              |
| **Modelos de post-mortem**      | Estruturas reutilizáveis de post-mortem.                                                        |
| **Campos personalizados**       | Definir campos extras que aparecem em todo incidente.                                           |
| **Funções de incidente**        | Definir as funções às quais você atribui respondentes, como Incident Commander.                 |
| **Mais configurações**          | Os prefixos de número de incidente e de episódio de incidente.                                  |

**Estado do incidente** e **Severidade do incidente** são cobertos em profundidade em [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — o resto desta página começa a partir de **Modelos de incidentes**.

Expanda **Regras** e você tem mais oito páginas: **Regras de agrupamento**, **Regras de Plantão**, **Regras de proprietário**, **Regras de runbook**, **Regras de privacidade**, **Regras de Rótulos**, **Regras de SLA** e **Reminder Rules**. Essas são cobertas mais adiante.

## Modelos de incidentes

Um modelo de incidente é um esqueleto salvo de um incidente. Em vez de redigitar o mesmo título, a mesma lista de monitores e a mesma política de plantão toda vez que o cluster de pagamentos oscila, você salva isso uma vez e declara a partir dele.

Vá a **Incidentes → Configurações → Modelos de incidentes** (`/dashboard/{projectId}/incidents/settings/templates`). O cartão é intitulado **Modelos de incidentes**. Criar um leva você por um assistente de seis etapas:

- **Informações do modelo** — **Nome do modelo** e **Descrição do modelo**. Eles nomeiam o próprio modelo; nunca aparecem no incidente.
- **Detalhes do incidente** — **Título**, **Descrição** (Markdown), **Severidade do incidente** e **Estado Inicial do Incidente**. **Estado Inicial do Incidente** é opcional e começa vazio; suas opções são listadas na ordem dos estados. Deixe em branco e incidentes deste modelo aterrissam no estado de criação do projeto.
- **Recursos afetados** — os monitores, hosts, clusters e serviços aos quais o incidente deve ser anexado, mais **Alterar status do monitor para**.
- **Plantão** — **Política de plantão**, as políticas a executar quando um incidente criado a partir deste modelo for declarado.
- **Proprietários** — **Proprietário - Equipes** e **Proprietário - Usuários**.
- **Rótulos** — **Rótulos**.

Algumas regras rápidas:

- A lista de modelos mostra apenas **Nome** e **Descrição**. Linhas não são editáveis nem excluíveis a partir da lista — abra um modelo (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) para alterá-lo.
- Modelos suportam importação e exportação em JSON, então você pode mover um entre projetos.
- O estado vazio diz "No incident templates found."

### Como um modelo é aplicado

Há dois caminhos, e eles se comportam da mesma forma.

- **A partir do painel** — o botão **Criar a partir de modelo** na lista de incidentes abre um seletor **Selecionar Modelo de Incidente**, e a página de declaração lê o modelo a partir do parâmetro de query string `incidentTemplateId`, e então pré-preenche o formulário com o modelo mais suas equipes proprietárias e usuários proprietários.
- **A partir da API** — passe `createdIncidentTemplateId` em `POST /api/incident` e o servidor preenche o incidente a partir do modelo.

A parte importante é a regra de mesclagem: **um modelo só preenche um campo que você deixou indefinido**. Título, descrição, severidade do incidente, estado inicial do incidente, o status de monitor por trás de **Alterar status do monitor para**, monitores, hosts, clusters Kubernetes, hosts Docker, hosts Podman, serviços, políticas de plantão e rótulos são copiados do modelo apenas quando o chamador ou o formulário não forneceram nada. Qualquer coisa que você defina explicitamente sempre vence.

**O diálogo de estado vazio aponta para o lugar errado.** Se você ainda não tem modelos, o botão **Criar a partir de modelo** mostra um diálogo **No Incident Templates**. Seu texto aponta para Configurações do projeto, mas o botão roteia para **Incidentes → Configurações → Modelos de incidentes** — esse é o local real.

## Modelos de notas

Modelos de notas dão aos respondentes texto pronto para atualizações de incidente, para que uma atualização de página de status às 3 da manhã não seja escrita do zero por alguém meio adormecido.

Vá a **Incidentes → Configurações → Modelos de notas** (`/dashboard/{projectId}/incidents/settings/note-templates`). O cartão é intitulado **Modelos de nota pública ou privada para incidentes** — uma biblioteca serve aos dois tipos de nota. O formulário de criação tem duas etapas:

- **Informações do modelo** — **Nome do modelo** e **Descrição do modelo**, ambos obrigatórios.
- **Detalhes da nota** — o corpo da nota em si, em Markdown, obrigatório.

Como os modelos de incidente, as linhas são criadas e visualizadas em vez de editadas na própria lista; abra um modelo para alterá-lo.

Modelos de notas aparecem onde você realmente precisa deles: os diálogos de confirmação **Acknowledge Incident** e **Resolve Incident** ambos oferecem **Selecionar Modelo de Nota** ao lado do campo **Nota pública**. Veja [Notas, responsáveis e feed de incidentes](/docs/incidents/notes-owners-and-feed) para saber como notas públicas e privadas diferem.

## Modelos de post-mortem

Um modelo de post-mortem é o esqueleto do relato que você produz depois de um incidente — seus títulos, suas perguntas guia, suas questões permanentes — para que toda revisão no projeto siga o mesmo formato.

Vá a **Incidentes → Configurações → Modelos de post-mortem** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). O cartão é intitulado **Modelos de post-mortem**. O formulário de criação tem duas etapas:

- **Informações do modelo** — **Nome do modelo** e **Descrição do modelo**, ambos obrigatórios.
- **Detalhes da análise pós-incidente** — **Modelo de análise pós-incidente**, o corpo em si, em Markdown, obrigatório.

Você aplica um a partir do incidente, não das configurações. Abra um incidente, escolha **Post-mortem** no seu menu lateral (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`) e use **Aplicar modelo**. Isso abre um diálogo **Aplicar modelo de post-mortem** com um menu **Selecionar Modelo**; escolher um carrega o corpo do modelo no editor **Nota da análise pós-incidente**, onde você o edita antes de salvar. Episódios de incidente têm a mesma página **Post-mortem** e usam a mesma biblioteca de modelos.

## Campos personalizados

Campos personalizados permitem carregar seus próprios metadados em todo incidente — um nome de serviço interno, uma referência de ticket de mudança, um nível de cliente.

Vá a **Incidentes → Configurações → Campos personalizados** (`/dashboard/{projectId}/incidents/settings/custom-fields`). A página é intitulada **Campos personalizados do incidente**. Cada definição tem:

- **Nome do campo** — obrigatório, com pelo menos dois caracteres. O placeholder sugere um nome em formato de slug, como `internal-service`.
- **Descrição do campo** — opcional.
- **Tipo do campo** — obrigatório. Isso escolhe como os dados são inseridos. Tipos de menu suspenso também precisam de suas opções listadas.
- **Opções do menu suspenso** — os valores que aparecem no menu suspenso, cada um com uma cor opcional.

Definições vivem em seu próprio modelo; os valores vivem no próprio incidente, na coluna `customFields`. Em um único incidente você os preenche a partir de **Campos personalizados** no menu lateral do incidente (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Uma lacuna que vale conhecer.** Definições de campos personalizados de incidente são a única parte da família de incidentes sem gatilhos de workflow — veja a seção de workflows abaixo.

## Funções de incidente

Funções de incidente são os trabalhos nomeados aos quais você atribui pessoas durante uma resposta. Defina-as em **Incidentes → Configurações → Funções de incidente** (`/dashboard/{projectId}/incidents/settings/roles`); a descrição do cartão dá Incident Commander e Responder como exemplos.

Funções são apenas definições. Você atribui pessoas a elas por incidente — o assistente de declaração tem uma etapa **Funções de incidente** com um campo **Atribuir funções do incidente**, e cada incidente tem uma página **Funções** em seu menu lateral.

## Prefixos de número

Todo incidente recebe um número. Por padrão ele é exibido como `#42`. Se sua equipe fala "INC-42" em voz alta, faça o produto falar também.

Vá a **Incidentes → Configurações → Mais configurações** (`/dashboard/{projectId}/incidents/settings/more`). O cartão é **Prefixo do número** e contém dois campos no projeto:

- **Prefixo de número de incidente** — até 20 caracteres, placeholder `INC-`. Defina-o e o incidente `#42` é exibido como `INC-42`.
- **Prefixo de número de episódio de incidente** — a mesma ideia para números de episódio de incidente, placeholder `IE-`.

Deixe qualquer um vazio para manter o prefixo `#` padrão; o campo não definido exibe `# (default)`. Salve com **Atualizar**. O valor com prefixo é armazenado no incidente como `incidentNumberWithPrefix`, que é o que a lista de incidentes e o cabeçalho do incidente exibem.

## Regras que rodam quando um incidente é criado

**Incidentes → Regras** contém oito motores de regras. Todos fazem o mesmo trabalho — olhar um incidente no momento em que é criado e agir se ele corresponder — mas diferem no que fazem e em como múltiplas regras correspondentes se resolvem.

- **Regras de agrupamento** — agrupam incidentes relacionados em episódios. As regras são avaliadas em ordem de prioridade; números de prioridade menores vêm primeiro.
- **Regras de Plantão** — executam políticas de plantão para incidentes correspondentes. Detalhadas abaixo.
- **Regras de proprietário** — atribuem proprietários automaticamente.
- **Regras de runbook** — iniciam um [runbook](/docs/runbooks/index) quando um incidente corresponde.
- **Regras de privacidade** — decidem se um incidente correspondente é privado.
- **Regras de Rótulos** — aplicam rótulos automaticamente.
- **Regras de SLA** — acompanham tempos de resposta e de resolução. As regras são avaliadas em ordem; números de ordem menores vêm primeiro.
- **Reminder Rules** — lembram periodicamente os proprietários do incidente enquanto ele ainda estiver aberto. As regras são avaliadas em ordem e a primeira regra correspondente vence.

**A semântica de ordem não é uniforme.** Regras de agrupamento, Regras de SLA e Reminder Rules são avaliadas por ordem. Regras de Plantão não são — toda regra correspondente dispara. Não assuma que um modelo se aplica a todas as oito.

As páginas **Regras de Plantão**, **Regras de proprietário**, **Regras de Rótulos** e **Regras de privacidade** têm abas — uma aba **Incident Rules** e uma aba **Episode Rules**, cada uma com sua própria tabela. Configure a aba **Incident Rules** a menos que você queira especificamente episódios. **Regras de agrupamento**, **Regras de runbook**, **Regras de SLA** e **Reminder Rules** são tabelas únicas.

## Regras de plantão de incidente

**Incidentes → Regras → Regras de Plantão** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) é onde você torna o acionamento automático. O cartão, **Regras de plantão de incidente**, descreve regras que executam automaticamente políticas de plantão quando incidentes correspondentes são criados. A página tem duas abas: **Incident Rules** e **Episode Rules**.

O formulário de criação tem três etapas:

- **Informações básicas** — **Nome** (o placeholder sugere algo como acionar o time de banco de dados para qualquer incidente de BD), **Descrição** e uma chave **Habilitado**. A lista exibe uma pílula verde **Habilitado** ou vermelha **Desabilitado** por regra.
- **Critérios de Correspondência** — **Monitores**, **Incidente Severidades**, **Rótulos de incidentes**, **Rótulos do Monitor**, mais campos de expressão regular sem distinção de maiúsculas para o título do incidente, a descrição do incidente, o nome do monitor e a descrição do monitor.
- **Políticas de plantão** — as políticas que esta regra executa.

### Como a correspondência se resolve

As regras que a própria página traz vale internalizar:

- Uma regra corresponde apenas quando **todos** os critérios que você preencheu passam. Critérios que você deixou vazios são pulados, não reprovados.
- Dentro de um único critério de lista — **Monitores**, **Incidente Severidades**, **Rótulos de incidentes**, **Rótulos do Monitor** — a correspondência é do tipo qualquer-um.
- Os campos de padrão são expressões regulares sem distinção de maiúsculas.
- **Todas as regras correspondentes disparam.** Não há prioridade nem curto-circuito.
- O conjunto de políticas que de fato é executado é a união das políticas de cada regra correspondente mais quaisquer políticas anexadas ao incidente manualmente ou por um modelo, sem duplicatas, de modo que cada política rode no máximo uma vez.

A severidade é um critério de correspondência aqui e em nenhum outro lugar. Não há campo de plantão em uma severidade de incidente — selecionar "Critical Incident" não aciona ninguém por si só. Se você quer que a severidade dirija o acionamento, escreva uma regra de plantão que corresponda a ela.

## Anexar políticas de plantão diretamente

Regras não são o único caminho. Todo incidente carrega sua própria lista de políticas de plantão, exposta como o campo **Política de plantão** na etapa **Plantão** do assistente de declaração e na etapa **Plantão** de um modelo de incidente. A descrição do campo diz claramente: estas são as políticas de plantão a executar quando este incidente for criado.

Quando um incidente é criado, o OneUptime roda regras de rótulos, depois regras de plantão (que mesclam suas políticas correspondentes na lista do incidente), depois regras de runbook — e, se a lista resultante não estiver vazia, toda política nela é executada. As execuções rodam em paralelo e são resolvidas independentemente, então uma política falhando não impede as outras. Cada execução é marcada com o incidente que a disparou e com o tipo de evento de notificação de incidente criado.

Para ver o que aconteceu, abra o incidente e escolha **Execuções de plantão** em seu menu lateral (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Dirigir incidentes a partir de workflows

Gatilhos de workflow para incidentes não são escritos à mão — o OneUptime os gera a partir dos modelos de dados, então todo modelo da família de incidentes ganha componentes **On Create X**, **On Update X** e **On Delete X**, nomeados a partir do nome singular do modelo. Os três principais são **On Create Incident**, **On Update Incident** e **On Delete Incident**, e eles ficam na categoria **Incidente** do painel **Adicionar componente** em `/dashboard/{projectId}/workflows`.

A mesma geração dá a você gatilhos para a própria configuração: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** e mais. Cada modelo também ganha componentes de ação correspondentes — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** e seus equivalentes para várias linhas — de modo que um gatilho e uma ação com nomes parecidos ficam lado a lado na mesma categoria. **On Create Incident** inicia um workflow; **Create One Incident** abre um incidente.

Alguns detalhes que importam quando você conecta isso tudo:

- **On Update X** recebe um argumento opcional **Listen on** que restringe o gatilho a atualizações que tocam campos específicos. Deixe em branco para disparar em qualquer mudança. Se uma atualização chega sem um registro de quais campos mudaram, o filtro é pulado e o workflow roda de qualquer forma.
- **On Create X** e **On Update X** ambos recebem um argumento obrigatório **Select Fields**; **On Delete X** não recebe argumentos.
- Todos os três expõem uma única porta de saída **Sucesso**, e cada um aceita um argumento de ID para que você possa rodar o workflow à mão contra um registro.
- Os nomes vêm do nome singular do modelo, não do nome da tabela — que é por que você vê **On Create Incident Team Owner** e **On Create Incident User Owner** em vez de nomes no formato da tabela.
- Não há gatilhos para definições de campos personalizados de incidente. Esse modelo é o único membro da família de incidentes com workflows desabilitados.

Para construir o resto do workflow, veja [Criar um workflow](/docs/workflows/authoring) e [Variáveis](/docs/workflows/variables).

## Onde ler a seguir

- [Visão geral dos incidentes](/docs/incidents/index) — como o recurso de incidentes se encaixa.
- [Declarar um incidente](/docs/incidents/declaring-incidents) — o assistente de declaração, os modelos e a API.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — as páginas de configuração de estado e severidade e o que as flags fazem.
- [Notas, responsáveis e feed de incidentes](/docs/incidents/notes-owners-and-feed) — onde os modelos de notas são usados.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — quem fica sabendo de um incidente fora da sua equipe.
- [Visão geral dos workflows](/docs/workflows/index) — automatizar sobre gatilhos de incidente.
- [Visão geral dos Runbooks](/docs/runbooks/index) — os procedimentos que as regras de runbook anexam.
