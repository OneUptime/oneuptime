# Usuários, equipes e permissões

Tudo no OneUptime vive dentro de um **projeto**. Quem pode fazer o quê dentro desse projeto se resume a três coisas: os **usuários** que fazem parte dele, as **equipes** às quais eles pertencem e as **permissões** concedidas a essas equipes.

A regra que explica quase todo o comportamento: **usuários nunca detêm permissões diretamente.** O acesso de um usuário é a união das permissões de todas as equipes às quais ele pertence naquele projeto. Se você quer mudar o que alguém pode fazer, muda a equipe dele ou muda as permissões daquela equipe.

**Proprietários** são outra ideia. Um proprietário é quem responde por um recurso específico — um monitor, um incidente, um painel. Proprietários são notificados sobre seus recursos, e as permissões podem, opcionalmente, ser restringidas a "somente aquilo que é meu".

## O modelo num relance

```text
Projeto
  └── Equipe                     ← as permissões ficam aqui
       ├── Permissões permitidas ← cada uma com um escopo: Todos / Próprios / Rótulos
       ├── Permissões bloqueadas ← sempre prevalecem sobre as permitidas
       └── Membros da equipe     ← usuários que aceitaram o convite
```

| Conceito | O que é |
| --- | --- |
| Usuário | Uma única conta OneUptime. Um login, quantos projetos forem necessários. |
| Projeto | A fronteira do inquilino. Monitores, incidentes, equipes e dados pertencem a exatamente um projeto. |
| Equipe | Um grupo nomeado dentro de um projeto que carrega as permissões. |
| Membro da equipe | Um usuário convidado para uma equipe que aceitou o convite. |
| Permissão | Uma capacidade única, por exemplo `CreateProjectMonitor`, ou uma função que agrupa muitas, como `MonitorAdmin`. |
| Escopo | Até onde vai uma permissão permitida: todos os recursos, apenas os próprios ou apenas os rotulados. |
| Proprietário | Um usuário ou equipe marcado como responsável por um recurso específico. |
| Rótulo | Uma marcação nos recursos, usada para restringir permissões e para organizar. |

## Usuários

Uma conta de usuário é global para a instância do OneUptime — o mesmo login funciona em todos os projetos para os quais o usuário foi convidado.

Um usuário está "em" um projeto quando é membro de **pelo menos uma equipe** dele. Não existe um passo separado de "adicionar usuário ao projeto": convidar alguém para um projeto é convidá-lo para uma equipe.

- Convites criam um membro de equipe pendente. O usuário só conta como membro do projeto — e só ganha qualquer permissão — **depois de aceitar o convite.**
- Remover um usuário de todas as equipes de um projeto retira seu acesso a esse projeto.
- Quem sai de um projeto deixa de receber as notificações dele. Os próprios métodos, regras e configurações de notificação da pessoa para o projeto são removidos com a última equipe — e-mail, SMS, chamada, WhatsApp, Telegram, push, webhook, Slack e Microsoft Teams, o resumo por e-mail e o e-mail ainda não enviado, o número para chamadas recebidas e os lembretes de plantão —, então quem volta começa com os padrões. O que ainda a menciona, como o usuário para quem uma regra de chamadas recebidas liga ou um responsável mantido em um incidente resolvido, não a notifica mais: nada é enviado em nome de um projeto a quem não é membro dele, e um convite pendente ainda não é participação. Esses lugares mostram **Não é mais membro** ao lado do nome, para que você coloque outra pessoa. Quem foi convidado e ainda não aceitou mostra **Convite ainda não aceito** no lugar. Se uma substituição encaminha os chamados de alguém para uma pessoa que saiu, quem é chamado é a pessoa que ela cobre. Sair também desconecta os clientes MCP que a pessoa conectou ao projeto, e o link pessoal do calendário de plantão dela passa a mostrar um calendário vazio. No OneUptime Cloud, quem volta pelo login único (SSO) do projeto confirma-o novamente pelo e-mail.
- Se o seu projeto exige SSO e um usuário ainda não se autenticou pelo provedor de identidade, ele é tratado como usuário SSO não autorizado e não vê nada até fazê-lo. Veja [SSO](/docs/identity/sso).
- Com o SCIM configurado, o provedor de identidade pode criar, atualizar e remover usuários e suas participações em equipes automaticamente. Veja [SCIM](/docs/identity/scim).

Onde encontrar: **Configurações → Usuários** lista todas as pessoas do projeto e o status do convite.

## Equipes

Equipes são o caminho pelo qual as permissões chegam às pessoas. Todo projeto novo começa com três:

| Equipe | Permissão que detém | Editável |
| --- | --- | --- |
| Owners | `ProjectOwner` | Não. Sempre tem pelo menos um membro. |
| Admin | `ProjectAdmin` | Não |
| Members | `ProjectMember` | Sim — é um ponto de partida, altere à vontade |

As equipes **Owners** e **Admin** são travadas de propósito: suas permissões não podem ser editadas e as equipes não podem ser excluídas nem renomeadas. É isso que impede um projeto de se trancar para fora por acidente. A equipe Owners precisa manter sempre pelo menos um membro.

`ProjectOwner` é o nível de acesso mais alto: faturamento, excluir o projeto e tudo o que um administrador pode fazer. `ProjectAdmin` cobre tudo, exceto faturamento e exclusão do projeto.

Ligar ou desligar SMS, chamadas telefônicas, WhatsApp ou Telegram para o projeto conta como faturamento, porque cada mensagem custa dinheiro. Somente `ProjectOwner`, a função `BillingAdmin` (**Billing Admin**) e a permissão `ManageProjectBilling` (**Manage Billing**) podem alterar essas chaves, em **Configurações do projeto > Notificações > Configurações de notificação** — não `ProjectAdmin`.

Recarregar os saldos pré-pagos do projeto também conta como faturamento. No OneUptime Cloud, SMS, chamadas telefônicas, WhatsApp e Telegram são pagos pelo saldo em **Configurações do projeto > Notificações > Configurações de notificação**, e a IA pelos créditos de IA em **Configurações do projeto > IA > Créditos de IA**. Somente um proprietário do projeto ou alguém com **Manage Billing** pode recarregá-los ou alterar a **Recarga automática** deles — um administrador do projeto não pode. Uma mensagem sobre um saldo que está acabando diz quem pode recarregá-lo, e só essas pessoas recebem um botão **Recarregar Saldo** que funciona ou um link para a página.

Crie quantas equipes adicionais quiser — "Plantão do Frontend", "Suporte", "Auditores somente leitura" — e dê a cada uma as permissões de que ela precisa.

Onde encontrar: **Configurações → Equipes**. Abra uma equipe para chegar a **Members** e **Permissions**; **Block Permissions** fica em **More settings**, no fim da página Permissions.

## Permissões

Uma permissão é uma capacidade única. Há duas formas de distribuí-las, ambas na aba **Permissions** da equipe.

### Funções

Uma função agrupa uma área inteira do produto em um de três níveis:

- **Admin** — o que o Member faz, mais a configuração própria da área, como severidades e estados de incidentes e alertas, status dos monitores e estados de manutenção.
- **Member** — o trabalho do dia a dia: criar, alterar e excluir os recursos da área, com suas notas, proprietários e modelos. Nas páginas de status e no plantão, o Member faz tudo o que o Admin faz.
- **Viewer** — somente leitura.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` e assim por diante. Funções são o que você quer quase sempre — elas continuam corretas conforme o OneUptime ganha recursos, porque uma nova tabela relacionada a monitores entra nas funções de monitor existentes em vez de exigir uma nova concessão sua.

Workflows e runbooks são a exceção. Ambos executam código no seu projeto — um workflow as suas etapas, um runbook os seus scripts nos seus Runners —, então `WorkflowMember` abre workflows e suas execuções e os executa manualmente, e `RunbookMember` abre runbooks e suas execuções e os executa: inicia uma execução, conclui ou pula suas etapas e a cancela. Nenhum dos dois cria, altera ou exclui o que executa; `WorkflowAdmin` e `RunbookAdmin` os constroem. Uma função executa apenas os runbooks que o seu escopo alcança: um `RunbookMember` limitado a alguns rótulos executa os runbooks que os têm. Veja [Configuração de workflows](/docs/workflows/configuration) e [Configuração de runbooks](/docs/runbooks/configuration).

As regras de uma área (regras de rótulos, de proprietários, de plantão, de agrupamento e de lembrete), os campos personalizados, os SLAs e os segredos são configuração do projeto: exigem `ProjectAdmin`, qualquer que seja a função de área da pessoa. O mesmo vale para chaves de API, equipes e suas permissões, rótulos, SSO e domínios — as funções Settings cuidam dos serviços, sondas, infraestrutura e integrações do projeto, não de quem pode fazer o quê.

O faturamento tem três funções próprias. `BillingViewer` lê o faturamento do projeto — o plano e a assinatura, as faturas, o uso, os saldos, os créditos de IA, os métodos de pagamento e os dados de contato de cobrança — e não altera nada. `BillingMember` também baixa faturas e altera os dados de contato de cobrança. `BillingAdmin` faz o que `BillingMember` faz e liga e desliga SMS, chamadas telefônicas, WhatsApp e Telegram. Alterar o plano, os métodos de pagamento ou os saldos, e pagar faturas, exige `ProjectOwner` ou **Manage Billing**; nas páginas de faturamento esses botões ficam bloqueados para os demais e dizem quem pode usá-los.

Todas as {{PERMISSION_ROLE_COUNT}} funções estão na [Referência de permissões](/docs/permissions/reference).

### Permissões granulares

Cada capacidade individual também pode ser atribuída sozinha — `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` e outras {{PERMISSION_TOTAL_COUNT}}. Use-as quando uma função for ampla demais e você precisar conceder exatamente uma coisa.

Uma permissão para alterar ou excluir algo só alcança o que você também pode ler, então conceda junto a permissão de leitura correspondente: `EditProjectIncident` não altera nenhum incidente sem `ReadProjectIncident`. Um registro lido por meio de outro, como uma nota de um incidente, também precisa de uma permissão para ler esse outro registro: `ReadIncidentInternalNote` não alcança nenhuma nota sem uma permissão para ler incidentes, e `CreateIncidentInternalNote` só adiciona uma nota a um incidente que você pode ler. Os papéis já incluem as duas.

São também as chaves usadas ao criar chaves de API, e as que a API e o provedor Terraform esperam.

A lista completa está na [Referência de permissões](/docs/permissions/reference).

### Permitir e bloquear

Cada equipe tem duas listas:

- **Permissions** (permitir) — o que esta equipe pode fazer.
- **Block Permissions** — o que esta equipe nunca pode fazer, independentemente de qualquer entrada de permissão.

**O bloqueio sempre vence.** Uma entrada de bloqueio sem rótulos remove aquela capacidade por completo da equipe. Uma entrada de bloqueio com rótulos a remove apenas para recursos que carregam esses rótulos — útil para "esta equipe pode editar monitores, exceto os rotulados como Production".

Uma permissão não pode carregar rótulos de restrição nas duas listas ao mesmo tempo; o OneUptime rejeita a segunda com uma explicação.

As permissões concedidas a um usuário se somam entre todas as suas equipes, mas um bloqueio vale para tudo o que o usuário faz: um bloqueio sem rótulos em uma equipe remove a capacidade mesmo que outra equipe a conceda, e uma entrada de bloqueio nunca concede nada. Se alguém tem menos acesso do que você esperava, procure um bloqueio em cada uma das equipes dessa pessoa; se tem mais, procure uma permissão em cada uma.

## Escopo: até onde vai uma permissão concedida

Toda permissão concedida vem com um escopo, escolhido no momento em que você a adiciona:

| Escopo | Significado |
| --- | --- |
| Todos os recursos do projeto | O padrão. A permissão vale para todos os recursos correspondentes. |
| Pertencentes a esta equipe ou a seus membros | A permissão vale apenas para recursos em que esta equipe, ou o usuário que age, consta como proprietário. |
| Restringir por rótulos (avançado) | A permissão vale apenas para recursos que carregam pelo menos um dos rótulos selecionados. |

**Próprios** é a maneira mais simples de montar um modelo do tipo "cada um cuida dos próprios serviços": dê a uma equipe `MonitorAdmin` com escopo Próprios e depois torne essa equipe proprietária dos monitores pelos quais ela responde. Isso só restringe recursos que realmente podem ter proprietários — monitores, incidentes, painéis, serviços e afins. A configuração do projeto (estados de incidente, rótulos, as próprias equipes) não tem proprietário, então uma função com escopo Próprios se comporta normalmente ali.

**Rótulos** é a versão mais manual da mesma ideia: marque os recursos e conceda permissões restritas a essas marcações.

Algumas funções são de projeto inteiro por definição e não oferecem escopo algum, porque restringi-las não faria sentido — "Billing Admin, mas só para o faturamento que é meu" não descreve nada:

{{PERMISSION_SCOPE_EXEMPT_ROLES}}

## Proprietários

Um proprietário é um usuário ou uma equipe ligado a um recurso específico. A maioria dos recursos que representam algo que você opera — monitores, incidentes, alertas, manutenções programadas, políticas de plantão, painéis, serviços, páginas de status, fluxos de trabalho, runbooks e SLOs — tem uma aba **Owners**.

Proprietários cumprem duas funções:

1. **Notificação.** Proprietários são quem o OneUptime avisa quando algo acontece com o recurso — um monitor cai, um incidente é criado, um SLO começa a consumir seu orçamento de erro.
2. **Acesso, quando você pede.** A propriedade é aquilo contra o que o escopo Próprios é resolvido. Um usuário se encaixa se for proprietário pessoalmente, ou se qualquer equipe dele for proprietária.

Propriedade sozinha não concede nada. Ser proprietário de um monitor não permite editá-lo, a menos que alguma equipe sua também detenha uma permissão de monitor. A propriedade restringe o acesso; nunca o amplia.

## Rótulos

Rótulos são marcações válidas em todo o projeto que você anexa aos recursos. Servem a dois propósitos: filtrar e agrupar no painel e restringir permissões conforme descrito acima.

Uma restrição por rótulos é satisfeita se o recurso carrega **pelo menos um** dos rótulos da permissão. Um recurso sem nenhum rótulo não satisfaz nenhuma permissão restrita por rótulos.

Um registro sem rótulos próprios, como a nota de um incidente, um anúncio de uma página de status ou um insight de IA sobre um serviço, carrega os rótulos dos registros aos quais pertence ou dos quais trata. Uma permissão restrita por rótulos o alcança quando um desses registros carrega um dos seus rótulos, e um bloqueio com rótulos o deixa de fora quando um deles carrega um rótulo bloqueado, na leitura, na alteração e na exclusão. Um registro que não trata de nenhum deles, como um insight de IA que não trata de nenhum serviço, pertence ao projeto: uma restrição por rótulos não o restringe, e um bloqueio com rótulos não o deixa de fora.

Onde encontrar: **Configurações → Rótulos**.

## Telemetria

Logs, traces, métricas, exceções, perfis e reproduções de sessão pertencem ao recurso que os enviou: um serviço, um host, um cluster Kubernetes, um monitor, um aplicativo RUM e afins. Uma permissão de telemetria lê até onde o seu escopo alcança:

- **Todos os recursos** lê a telemetria de todos os recursos do projeto.
- **Próprios** lê a telemetria dos recursos que você ou uma das suas equipes possui, e a telemetria que não indica nenhum recurso.
- **Rótulos** lê a telemetria dos recursos que carregam um dos rótulos da permissão.

Um bloqueio com rótulos em uma permissão de telemetria deixa de fora a telemetria dos recursos que carregam esses rótulos, seja o que for que você tenha além disso. Isso vale onde quer que a telemetria seja lida: os exploradores e seus gráficos, filtros e listas de atributos, as exportações, as reproduções de sessão e o que o assistente de IA lê por você. A lista de nomes de métricas mostra as métricas que um serviço que você pode ler reporta, e as métricas que nenhum serviço reporta, como as de hosts e clusters. Se você também pode ler a telemetria de outros tipos de recursos, como hosts ou clusters, ela mostra todos os nomes de métricas.

Excluir telemetria se limita aos mesmos recursos: uma exclusão alcança as linhas dos recursos que tanto a sua permissão para ler o sinal quanto a sua permissão para excluí-lo alcançam, menos os que um bloqueio com rótulos sobre qualquer uma delas retira, e é feita em um projeto de cada vez.

Os logs de monitores, o histórico de SLOs, os fluxos de rede e as alocações de custo do Kubernetes são lidos da mesma forma, através do monitor, do SLO, do dispositivo de rede ou do cluster a que pertencem: Próprios e Rótulos alcançam as linhas dos registros que você pode ler, e um bloqueio com rótulos deixa de fora as linhas dos registros que carregam esses rótulos. O log de auditoria e os indicadores de inteligência de ameaças são lidos em todo o projeto por quem pode lê-los.

## Chaves de API

Chaves de API recebem permissões diretamente, na própria chave — elas não pertencem a equipes e não são afetadas por participação em equipes.

- Atribua as mesmas permissões granulares e funções que você daria a uma equipe.
- Chaves aceitam **permissões bloqueadas** e **restrições por rótulos**, do mesmo jeito que as equipes.
- Chaves **não** aceitam o escopo Próprios. A propriedade é resolvida contra um usuário, e uma chave não é um usuário — portanto conceda às chaves o acesso necessário de forma explícita.

Dê a cada integração sua própria chave com o conjunto de permissões mais estreito que funcione, para poder revogar uma sem atrapalhar as outras.

Onde encontrar: **Configurações → Chaves de API**. Veja também a [Referência da API](/docs/api-reference/api-reference).

## Como o OneUptime decide se uma requisição é permitida

Para um usuário autenticado, na ordem:

1. Encontrar as equipes a que o usuário pertence neste projeto, contando apenas convites aceitos. Uma requisição alcança apenas os registros deste projeto: um registro de outro projeto, indicado pelo seu id ou em um filtro, é tratado como se não existisse.
2. Reunir todas as linhas de permissão dessas equipes — permitidas e bloqueadas — cada uma com seus rótulos e seu escopo.
3. Verificar primeiro a lista de bloqueios. Um bloqueio sem rótulos em qualquer permissão que a tabela de destino aceite para essa operação rejeita a requisição de imediato, seja qual for a equipe em que estiver.
4. Verificar a lista de permitidas. A requisição precisa de pelo menos uma permissão que a tabela de destino aceite para essa operação. Em um recurso operacional — um monitor, um incidente, um painel e afins — a permissão **All Operational Resources** correspondente (Create, Read, Edit ou Delete) também conta, a menos que ela própria esteja bloqueada.
5. Aplicar o escopo. Concessões com escopo Próprios restringem a consulta aos recursos próprios; as de rótulos restringem aos rótulos correspondentes. Se qualquer outra concessão para a mesma operação for mais ampla, a mais ampla vence. Um registro sem rótulos próprios, como uma nota de um incidente, satisfaz uma concessão por rótulos quando um dos registros aos quais pertence carrega um dos seus rótulos. Uma permissão **All Operational Resources** restrita a rótulos restringe da mesma forma: alcança os recursos operacionais que carregam um dos seus rótulos, como faria a própria permissão do recurso restrita a esses rótulos.
6. Aplicar os bloqueios por rótulos. Um bloqueio com rótulos rejeita a requisição se o recurso de destino carregar um deles. Quando um registro não tem rótulos próprios, como uma nota de um incidente ou um anúncio de uma página de status, um bloqueio com rótulos o deixa de fora de leituras, alterações e exclusões se um registro ao qual ele pertence carregar um desses rótulos. Uma lista de registros de todos os seus projetos de uma vez, como os incidentes da sua página inicial, restringe os registros de cada projeto pelos seus bloqueios e concessões naquele projeto. Um bloqueio com rótulos sobre uma permissão **All Operational Resources** retira os recursos que carregam esses rótulos do que essa permissão concede.
7. Limitar alterações e exclusões ao que você pode ler. Uma alteração ou exclusão é restringida pelas suas permissões de leitura além da permissão para a alteração: um registro que você não pode ler — fora dos seus rótulos ou proprietários, ou com um rótulo que um bloqueio de leitura retira — não é um que você possa alterar ou excluir, e um bloqueio sem rótulos sobre a leitura de um tipo de registro retira também alterá-lo e excluí-lo. Um registro lido por meio de outro, como uma nota de um incidente ou um anúncio de uma página de status, só é alcançado por meio de um registro que você pode ler: sem permissão para ler incidentes, uma permissão sobre notas não alcança nenhuma nota, e um bloqueio com rótulos sobre a leitura de incidentes deixa de fora as notas dos incidentes que os carregam. Uma alteração ou exclusão de um registro, indicado pelo seu ID, que não alcança nada é respondida como se o registro não existisse (`404`) quando você não pode lê-lo, e recusada quando você pode lê-lo, mas não alterá-lo. Quando sua permissão para ler incidentes tem o escopo Próprios, uma permissão sobre notas alcança apenas as notas dos incidentes de que você ou uma das suas equipes são proprietários. Um registro assim também só é criado sob um registro que você pode ler: uma nota só em um incidente que você pode ler, e um anúncio só em páginas de status que você pode ler, cada uma delas; indicar um que você não pode ler é recusado como se não existisse. Uma leitura de um registro pelo seu ID responde `404` da mesma forma quando o registro não existe ou você não pode lê-lo.

Cada campo de um registro é lido com a permissão de leitura do próprio registro: uma permissão de outro tipo de registro nunca o abre. Alguns campos são mais restritos de propósito. Os segredos só são lidos por quem pode editar ou administrar o registro a que pertencem, como as chaves de requisições recebidas e de e-mails recebidos de um monitor e a chave do seu agente de servidor, ou as chaves de webhook e de e-mail de entrada de um fluxo de trabalho. Assistir à gravação de uma reprodução de sessão exige **Watch Session Replays**, não apenas **List Session Replays**. A telemetria é lida sinal a sinal: **Read Telemetry Service Log** lê os logs, **Read Telemetry Service Traces** lê os traces e **Read Telemetry Service Metrics** lê as métricas, incluindo os gráficos de métricas.

Os campos seguem a mesma regra. Um bloqueio sem rótulos na permissão de um campo remove esse campo, e em um recurso operacional a permissão **All Operational Resources** correspondente abre todo campo que pode abrir qualquer pessoa que possa ler ou alterar o registro — mas não um campo mais restrito de propósito, como uma chave secreta.

A mesma regra decide tudo o mais que pergunta se você tem uma permissão: as ações que não são uma simples leitura ou escrita — adicionar crédito de SMS, chamadas ou IA, pagar uma fatura ou testar uma regra de notificação — e os botões que o OneUptime mostra. Um botão que você não pode usar aparece travado e diz por quê; quando o motivo é um bloqueio em uma de suas equipes, ele nomeia a permissão bloqueada.

As atualizações ao vivo seguem a mesma regra. Quando um registro é criado, alterado ou excluído, o OneUptime avisa as páginas abertas das pessoas que podem ler esse registro, e de mais ninguém. O que limita o que você pode ler limita também as suas atualizações ao vivo: rótulos, proprietários, um bloqueio com rótulos, um incidente privado ou a conversa de IA de outra pessoa. Quando uma mudança tira o seu acesso a um registro, por exemplo ao torná-lo privado, as suas páginas abertas também são avisadas, para que deixem de mostrá-lo. Uma mudança nas suas permissões, um bloqueio ou deixar de ser administrador master chega às suas páginas abertas na hora.

As atualizações ao vivo também terminam com o login que as abriu. Sair, trocar a senha ou ser bloqueado interrompe na hora as atualizações ao vivo das suas páginas abertas. Uma página aberta renova o seu login a cada 15 minutos e retoma as atualizações ao vivo; quando o login não pode ser renovado, ela leva você à página de login. Um projeto que exige SSO só envia atualizações ao vivo para páginas conectadas com SSO, como acontece com todo o resto.

Todo usuário autenticado detém ainda um pequeno conjunto de permissões automáticas que cobrem coisas como ler o próprio perfil e as próprias regras de notificação. Não são permissões administrativas e não dão acesso aos dados de mais ninguém.

As permissões resolvidas ficam em cache por usuário e projeto, e são atualizadas quando a participação em equipes ou as permissões da equipe mudam. Se você alterar permissões e um usuário não vir a mudança na hora, peça que ele recarregue.

## Receitas

**Uma equipe que só observa.** Crie a equipe e adicione a função `Viewer`, ou as funções `*Viewer` por área apenas para as áreas que ela deve ver.

**Engenheiros de plantão que cuidam dos próprios serviços.** Dê à equipe `MonitorAdmin`, `IncidentMember` e `OnCallMember` com escopo **Próprios** e depois adicione a equipe como proprietária dos monitores que ela opera.

**Terceiros mantidos longe da produção.** Dê à equipe as funções necessárias com escopo **Todos** e depois adicione uma **permissão bloqueada** para as capacidades sensíveis, restrita ao rótulo `Production`.

**Um pipeline de CI que só reporta implantações.** Crie uma chave de API apenas com as permissões granulares de que ela precisa — sem funções.

**Alguém que não deve alterar o faturamento nem ver as faturas.** Dê a ele `ProjectMember`, não `ProjectAdmin`: um administrador do projeto não pode alterar o plano, os métodos de pagamento nem os saldos, mas lê e baixa as faturas. Para que alguém leia as páginas de faturamento sem alterar nada, dê a ele `BillingViewer`.

## A seguir

- [Referência de permissões](/docs/permissions/reference) — cada função e cada permissão granular, gerados a partir do código-fonte do OneUptime.
- [SSO](/docs/identity/sso) e [SCIM](/docs/identity/scim) — autenticação e provisionamento automático de usuários.
- [Referência da API](/docs/api-reference/api-reference) — usar permissões a partir da API.
