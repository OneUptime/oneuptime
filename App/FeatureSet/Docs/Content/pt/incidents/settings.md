# Configurações e automação

A configuração de incidentes não fica em **Configurações do projeto**. Ela vive dentro da própria área de Incidentes, em **Incidentes → Configurações** e **Incidentes → Regras**, em rotas que começam com `/dashboard/{projectId}/incidents/settings/`. Se você andou vasculhando as **Configurações do projeto** atrás de modelos de incidente ou de campos personalizados, é por isso que não os encontrou.

Tanto a seção **Regras** quanto a seção **Configurações** do menu lateral de Incidentes vêm recolhidas por padrão, então você precisa expandi-las antes que os itens abaixo apareçam. Tudo aqui tem escopo de projeto: modelos, funções, campos personalizados e regras pertencem a um projeto e valem para todo incidente declarado nele.

Esta página é a referência dessa configuração — o que cada tela guarda e o que dela roda sozinho no instante em que um incidente é criado.

## Onde ficam as configurações de incidente

Abra **Incidentes** na navegação à esquerda e expanda **Configurações** no fim do menu lateral.

| Tela                     | O que você faz ali                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| **Estado do incidente**       | Adicionar, renomear, recolorir e reordenar os estados pelos quais um incidente passa.                       |
| **Severidade do incidente**    | Adicionar, renomear, recolorir e reordenar os níveis de severidade.                                            |
| **Modelos de incidentes**   | Preencher um incidente inteiro de antemão — título, descrição, recursos, políticas de plantão, proprietários, rótulos. |
| **Modelos de notas**       | Texto reutilizável para notas públicas e privadas.                                                  |
| **Modelos de post-mortem** | Estruturas reutilizáveis de post-mortem.                                                              |
| **Campos personalizados**        | Definir campos extras que aparecem em todo incidente.                                           |
| **Funções de incidente**       | Definir as funções às quais você atribui os respondentes, como Incident Commander.                       |
| **Mais configurações**        | Os prefixos de número de incidente e de episódio de incidente.                                           |

**Estado do incidente** e **Severidade do incidente** são tratados a fundo em [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — o resto desta página começa em **Modelos de incidentes**.

Expanda **Regras** e você ganha mais oito telas: **Regras de agrupamento**, **Regras de Plantão**, **Regras de proprietário**, **Regras de runbook**, **Regras de privacidade**, **Regras de Rótulos**, **Regras de SLA** e **Reminder Rules**. Todas elas aparecem mais adiante.

## Modelos de incidentes

Um modelo de incidente é um esqueleto salvo de incidente. Em vez de redigitar o mesmo título, a mesma lista de monitores e a mesma política de plantão toda vez que o cluster de pagamentos oscila, você salva isso uma vez e declara a partir dele.

Vá a **Incidentes → Configurações → Modelos de incidentes** (`/dashboard/{projectId}/incidents/settings/templates`). O cartão se chama **Modelos de incidentes**. Criar um leva você por um assistente de seis passos:

- **Informações do modelo** — **Nome do modelo** e **Descrição do modelo**. Eles nomeiam o modelo em si; nunca aparecem no incidente.
- **Detalhes do incidente** — **Título**, **Descrição** (Markdown), **Severidade do incidente** e **Estado Inicial do Incidente**. **Estado Inicial do Incidente** é opcional e começa vazio; suas opções são listadas na ordem dos estados. Deixe em branco e os incidentes vindos deste modelo caem no estado de criação do projeto.
- **Recursos afetados** — os monitores, hosts, clusters e serviços aos quais o incidente deve ser vinculado, mais **Alterar status do monitor para**.
- **Plantão** — **Política de plantão**, as políticas a executar quando um incidente criado a partir deste modelo é declarado.
- **Proprietários** — **Proprietário - Equipes** e **Proprietário - Usuários**.
- **Rótulos** — **Rótulos**.

Algumas regras rápidas:

- A lista de modelos mostra apenas **Nome** e **Descrição**. As linhas não podem ser editadas nem excluídas a partir da lista — abra um modelo (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) para alterá-lo.
- Modelos aceitam importação e exportação em JSON, então dá para levar um de um projeto a outro.
- O estado vazio diz "No incident templates found."

### Como um modelo é aplicado

Há dois caminhos, e ambos se comportam da mesma forma.

- **Pelo painel** — o botão **Criar a partir de modelo** na lista de incidentes abre um seletor **Selecionar Modelo de Incidente**, e a página de declaração lê o modelo do parâmetro `incidentTemplateId` na query string e então pré-preenche o formulário com o modelo, mais suas equipes e usuários proprietários.
- **Pela API** — passe `createdIncidentTemplateId` em `POST /api/incident` e o servidor preenche o incidente a partir do modelo.

O que importa mesmo é a regra de mesclagem: **um modelo só preenche um campo que você deixou indefinido**. Título, descrição, severidade do incidente, estado inicial do incidente, o status de monitor por trás de **Alterar status do monitor para**, monitores, hosts, clusters Kubernetes, hosts Docker, hosts Podman, serviços, políticas de plantão e rótulos são copiados do modelo só quando quem chamou — ou o formulário — não informou nada. O que você define explicitamente sempre vence.

**A caixa de estado vazio aponta para o lugar errado.** Se você ainda não tem modelos, o botão **Criar a partir de modelo** abre uma caixa **No Incident Templates**. O texto dela aponta para as Configurações do projeto, mas o botão leva a **Incidentes → Configurações → Modelos de incidentes** — o lugar de verdade.

## Modelos de notas

Modelos de notas dão aos respondentes um texto pronto para as atualizações de incidente, para que uma atualização de página de status às três da manhã não seja escrita do zero por alguém meio adormecido.

Vá a **Incidentes → Configurações → Modelos de notas** (`/dashboard/{projectId}/incidents/settings/note-templates`). O cartão se chama **Modelos de nota pública ou privada para incidentes** — uma única biblioteca atende aos dois tipos de nota. O formulário de criação tem dois passos:

- **Informações do modelo** — **Nome do modelo** e **Descrição do modelo**, ambos obrigatórios.
- **Detalhes da nota** — o corpo da nota em si, em Markdown, obrigatório.

Como nos modelos de incidente, as linhas são criadas e consultadas, não editadas na própria lista; abra um modelo para alterá-lo.

Os modelos de notas aparecem onde você realmente precisa deles: as caixas de confirmação **Acknowledge Incident** e **Resolve Incident** oferecem **Selecionar Modelo de Nota** ao lado do campo **Nota pública**. Veja [Notas, responsáveis e feed de incidentes](/docs/incidents/notes-owners-and-feed) para entender como notas públicas e privadas se diferenciam.

## Modelos de post-mortem

Um modelo de post-mortem é o esqueleto do relato que você escreve depois de um incidente — seus títulos, seus lembretes, suas perguntas de sempre — para que toda revisão do projeto siga o mesmo formato.

Vá a **Incidentes → Configurações → Modelos de post-mortem** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). O cartão se chama **Modelos de post-mortem**. O formulário de criação tem dois passos:

- **Informações do modelo** — **Nome do modelo** e **Descrição do modelo**, ambos obrigatórios.
- **Detalhes da análise pós-incidente** — **Modelo de análise pós-incidente**, o corpo em si, em Markdown, obrigatório.

Você aplica um deles a partir do incidente, não das configurações. Abra um incidente, escolha **Post-mortem** no menu lateral dele (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`) e use **Aplicar modelo**. Isso abre a caixa **Aplicar modelo de post-mortem** com um menu **Selecionar Modelo**; escolher um carrega o corpo do modelo no editor **Nota da análise pós-incidente**, onde você o ajusta antes de salvar. Episódios de incidente têm a mesma tela **Post-mortem** e bebem da mesma biblioteca de modelos.

## Campos personalizados

Campos personalizados deixam você carregar seus próprios metadados em todo incidente — o nome interno de um serviço, a referência de um chamado de mudança, o nível de um cliente.

Vá a **Incidentes → Configurações → Campos personalizados** (`/dashboard/{projectId}/incidents/settings/custom-fields`). A tela se chama **Campos personalizados do incidente**. Cada definição tem:

- **Nome do campo** — obrigatório, com pelo menos dois caracteres. O placeholder sugere um nome em formato de slug, como `internal-service`.
- **Descrição do campo** — opcional.
- **Tipo do campo** — obrigatório. É o que define como o dado é informado. Tipos de menu suspenso também precisam ter suas opções listadas.
- **Opções do menu suspenso** — os valores que aparecem no menu, cada um com uma cor opcional.

As definições ficam em um modelo próprio; os valores ficam no próprio incidente, na coluna `customFields`. Em um incidente específico você os preenche em **Campos personalizados**, no menu lateral do incidente (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Uma lacuna que vale conhecer.** As definições de campo personalizado de incidente são a única parte da família de incidentes sem gatilhos de workflow — veja a seção sobre workflows mais abaixo.

## Funções de incidente

Funções de incidente são os papéis nomeados aos quais você atribui pessoas durante uma resposta. Defina-as em **Incidentes → Configurações → Funções de incidente** (`/dashboard/{projectId}/incidents/settings/roles`); a descrição do cartão dá Incident Commander e Responder como exemplos.

Funções são apenas definições. Você atribui pessoas a elas incidente a incidente — o assistente de declaração tem um passo **Funções de incidente** com um campo **Atribuir funções do incidente**, e cada incidente tem uma tela **Funções** em seu menu lateral.

## Prefixos de número

Todo incidente recebe um número. Por padrão ele aparece como `#42`. Se a sua equipe fala "INC-42" em voz alta, faça o produto falar do mesmo jeito.

Vá a **Incidentes → Configurações → Mais configurações** (`/dashboard/{projectId}/incidents/settings/more`). O cartão é **Prefixo do número** e guarda dois campos do projeto:

- **Prefixo de número de incidente** — até 20 caracteres, placeholder `INC-`. Defina-o e o incidente `#42` passa a aparecer como `INC-42`.
- **Prefixo de número de episódio de incidente** — a mesma ideia para os números de episódio de incidente, placeholder `IE-`.

Deixe qualquer um dos dois vazio para manter o prefixo padrão `#`; o campo não preenchido aparece como `# (default)`. Salve com **Atualizar**. O valor com prefixo é gravado no incidente como `incidentNumberWithPrefix`, e é ele que a lista de incidentes e o cabeçalho do incidente exibem.

## Regras que rodam quando um incidente é criado

**Incidentes → Regras** guarda oito motores de regra. Todos fazem o mesmo trabalho — olhar um incidente no instante em que ele é criado e agir se ele corresponder — mas diferem no que fazem e em como várias regras correspondentes se resolvem entre si.

- **Regras de agrupamento** — agrupam incidentes relacionados em episódios. As regras são avaliadas por ordem de prioridade; números de prioridade menores vêm primeiro.
- **Regras de Plantão** — executam políticas de plantão para os incidentes correspondentes. Detalhadas mais abaixo.
- **Regras de proprietário** — atribuem proprietários automaticamente.
- **Regras de runbook** — iniciam um [runbook](/docs/runbooks/index) quando um incidente corresponde.
- **Regras de privacidade** — decidem se um incidente correspondente é privado.
- **Regras de Rótulos** — aplicam rótulos automaticamente.
- **Regras de SLA** — acompanham tempos de resposta e de resolução. As regras são avaliadas em ordem; números de ordem menores vêm primeiro.
- **Reminder Rules** — lembram periodicamente os proprietários enquanto o incidente segue aberto. As regras são avaliadas em ordem e a primeira correspondência vence.

**A semântica de ordem não é uniforme.** Regras de agrupamento, Regras de SLA e Reminder Rules são avaliadas em ordem. As Regras de Plantão não são — toda regra correspondente dispara. Não presuma que um mesmo modelo vale para as oito.

As telas **Regras de Plantão**, **Regras de proprietário**, **Regras de Rótulos** e **Regras de privacidade** têm abas — uma aba **Incident Rules** e uma aba **Episode Rules**, cada uma com sua própria tabela. Configure a aba **Incident Rules**, a não ser que você queira mesmo falar de episódios. **Regras de agrupamento**, **Regras de runbook**, **Regras de SLA** e **Reminder Rules** são tabelas únicas.

## Regras de plantão de incidente

**Incidentes → Regras → Regras de Plantão** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) é onde você torna o acionamento automático. O cartão, **Regras de plantão de incidente**, descreve regras que executam automaticamente políticas de plantão quando incidentes correspondentes são criados. A tela tem duas abas: **Incident Rules** e **Episode Rules**.

O formulário de criação tem três passos:

- **Informações básicas** — **Nome** (o placeholder sugere algo como acionar a equipe de banco de dados em qualquer incidente de BD), **Descrição** e uma chave **Habilitado**. A lista mostra uma etiqueta verde **Habilitado** ou vermelha **Desabilitado** por regra.
- **Critérios de Correspondência** — **Monitores**, **Incidente Severidades**, **Rótulos de incidentes**, **Rótulos do Monitor**, mais campos de expressão regular sem distinção de maiúsculas para o título do incidente, a descrição do incidente, o nome do monitor e a descrição do monitor.
- **Políticas de plantão** — as políticas que esta regra executa.

### Como a correspondência se resolve

Vale internalizar as regras que a própria tela traz:

- Uma regra só corresponde quando **todos** os critérios que você preencheu passam. Critérios deixados em branco são ignorados, não reprovados.
- Dentro de um mesmo critério de lista — **Monitores**, **Incidente Severidades**, **Rótulos de incidentes**, **Rótulos do Monitor** — basta que um dos valores corresponda.
- Os campos de padrão são expressões regulares sem distinção entre maiúsculas e minúsculas.
- **Todas as regras correspondentes disparam.** Não há prioridade nem curto-circuito.
- O conjunto de políticas que de fato executa é a união das políticas de todas as regras correspondentes, mais quaisquer políticas anexadas ao incidente à mão ou por um modelo, sem duplicatas, de modo que cada política roda no máximo uma vez.

A severidade é critério de correspondência aqui e em nenhum outro lugar. Não existe campo de plantão em uma severidade de incidente — escolher "Critical Incident" não aciona ninguém por si só. Se você quer que a severidade dirija o acionamento, escreva uma regra de plantão que corresponda a ela.

## Anexar políticas de plantão diretamente

Regras não são o único caminho. Todo incidente carrega sua própria lista de políticas de plantão, exposta como o campo **Política de plantão** no passo **Plantão** do assistente de declaração e no passo **Plantão** de um modelo de incidente. A descrição do campo diz sem rodeios: são as políticas de plantão a executar quando este incidente for criado.

Quando um incidente é criado, o OneUptime roda as regras de rótulo, depois as regras de plantão (que mesclam suas políticas correspondentes na lista do incidente) e depois as regras de runbook — e, se a lista resultante não estiver vazia, cada política dela é executada. As execuções rodam em paralelo e são concluídas de forma independente, então uma política que falha não impede as outras. Cada execução é marcada com o incidente que a disparou e com o tipo de evento de notificação de incidente criado.

Para ver o que aconteceu, abra o incidente e escolha **Execuções de plantão** no menu lateral dele (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Dirigir incidentes a partir de workflows

Os gatilhos de workflow para incidentes não são escritos à mão — o OneUptime os gera a partir dos modelos de dados, então todo modelo da família de incidentes ganha componentes **On Create X**, **On Update X** e **On Delete X**, batizados com o nome no singular do modelo. Os três principais são **On Create Incident**, **On Update Incident** e **On Delete Incident**, e você os encontra na categoria **Incidente** do painel **Adicionar componente**, em `/dashboard/{projectId}/workflows`.

A mesma geração lhe dá gatilhos para a própria configuração: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** e outros. Cada modelo também ganha componentes de ação equivalentes — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** e suas versões para várias linhas — de modo que um gatilho e uma ação de nomes parecidos ficam lado a lado na mesma categoria. **On Create Incident** inicia um workflow; **Create One Incident** abre um incidente.

Alguns detalhes que importam na hora de ligar isso tudo:

- **On Update X** recebe um argumento opcional **Listen on**, que restringe o gatilho às atualizações que tocam campos específicos. Deixe em branco para disparar a qualquer mudança. Se uma atualização chegar sem registro de quais campos mudaram, o filtro é ignorado e o workflow roda mesmo assim.
- **On Create X** e **On Update X** exigem um argumento **Select Fields**; **On Delete X** não recebe argumento nenhum.
- Os três expõem uma única porta de saída **Sucesso**, e cada um aceita um argumento de ID para você rodar o workflow à mão contra um registro específico.
- Os nomes vêm do nome no singular do modelo, não do nome da tabela — é por isso que você vê **On Create Incident Team Owner** e **On Create Incident User Owner** em vez de nomes no formato das tabelas.
- Não há gatilhos para as definições de campo personalizado de incidente. Esse modelo é o único membro da família de incidentes com workflows desativados.

Para montar o resto do workflow, veja [Criar um workflow](/docs/workflows/authoring) e [Variáveis de workflow](/docs/workflows/variables).

## Onde ler a seguir

- [Visão geral dos incidentes](/docs/incidents/index) — como o recurso de incidentes se encaixa.
- [Declarar um incidente](/docs/incidents/declaring-incidents) — o assistente de declaração, os modelos e a API.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — as telas de configuração de estado e severidade e o que as flags fazem.
- [Notas, responsáveis e feed de incidentes](/docs/incidents/notes-owners-and-feed) — onde os modelos de nota são usados.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — quem fica sabendo de um incidente fora da sua equipe.
- [Visão geral dos workflows](/docs/workflows/index) — automatizar em cima dos gatilhos de incidente.
- [Visão geral dos Runbooks](/docs/runbooks/index) — os procedimentos que as regras de runbook anexam.
