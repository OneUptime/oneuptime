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

- **Admin** — controle total sobre a área, incluindo sua configuração (severidades, estados, modelos).
- **Member** — o trabalho do dia a dia: criar, editar e excluir os recursos, mas não reconfigurar a área.
- **Viewer** — somente leitura.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` e assim por diante. Funções são o que você quer quase sempre — elas continuam corretas conforme o OneUptime ganha recursos, porque uma nova tabela relacionada a monitores entra nas funções de monitor existentes em vez de exigir uma nova concessão sua.

Workflows são a exceção. Um workflow executa suas etapas dentro do projeto, então `WorkflowMember` abre os workflows e suas execuções e os executa à mão, mas não os cria, altera nem exclui. `WorkflowAdmin` os constrói. Veja [Configuração de workflows](/docs/workflows/configuration).

Todas as {{PERMISSION_ROLE_COUNT}} funções estão na [Referência de permissões](/docs/permissions/reference).

### Permissões granulares

Cada capacidade individual também pode ser atribuída sozinha — `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` e outras {{PERMISSION_TOTAL_COUNT}}. Use-as quando uma função for ampla demais e você precisar conceder exatamente uma coisa.

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

Onde encontrar: **Configurações → Rótulos**.

## Chaves de API

Chaves de API recebem permissões diretamente, na própria chave — elas não pertencem a equipes e não são afetadas por participação em equipes.

- Atribua as mesmas permissões granulares e funções que você daria a uma equipe.
- Chaves aceitam **permissões bloqueadas** e **restrições por rótulos**, do mesmo jeito que as equipes.
- Chaves **não** aceitam o escopo Próprios. A propriedade é resolvida contra um usuário, e uma chave não é um usuário — portanto conceda às chaves o acesso necessário de forma explícita.

Dê a cada integração sua própria chave com o conjunto de permissões mais estreito que funcione, para poder revogar uma sem atrapalhar as outras.

Onde encontrar: **Configurações → Chaves de API**. Veja também a [Referência da API](/docs/api-reference/api-reference).

## Como o OneUptime decide se uma requisição é permitida

Para um usuário autenticado, na ordem:

1. Encontrar as equipes a que o usuário pertence neste projeto, contando apenas convites aceitos.
2. Reunir todas as linhas de permissão dessas equipes — permitidas e bloqueadas — cada uma com seus rótulos e seu escopo.
3. Verificar primeiro a lista de bloqueios. Um bloqueio sem rótulos em qualquer permissão que a tabela de destino aceite para essa operação rejeita a requisição de imediato, seja qual for a equipe em que estiver.
4. Verificar a lista de permitidas. A requisição precisa de pelo menos uma permissão que a tabela de destino aceite para essa operação. Em um recurso operacional — um monitor, um incidente, um painel e afins — a permissão **All Operational Resources** correspondente (Create, Read, Edit ou Delete) também conta, a menos que ela própria esteja bloqueada.
5. Aplicar o escopo. Concessões com escopo Próprios restringem a consulta aos recursos próprios; as de rótulos restringem aos rótulos correspondentes. Se qualquer outra concessão para a mesma operação for mais ampla, a mais ampla vence.
6. Aplicar os bloqueios por rótulos. Um bloqueio com rótulos rejeita a requisição se o recurso de destino carregar um deles.

Cada campo de um registro é lido com a permissão de leitura do próprio registro: uma permissão de outro tipo de registro nunca o abre. Alguns campos são mais restritos de propósito. Os segredos só são lidos por quem pode editar ou administrar o registro a que pertencem, como as chaves de requisições recebidas e de e-mails recebidos de um monitor e a chave do seu agente de servidor, ou as chaves de webhook e de e-mail de entrada de um fluxo de trabalho. Assistir à gravação de uma reprodução de sessão exige **Watch Session Replays**, não apenas **List Session Replays**. A telemetria é lida sinal a sinal: **Read Telemetry Service Log** lê os logs, **Read Telemetry Service Traces** lê os traces e **Read Telemetry Service Metrics** lê as métricas, incluindo os gráficos de métricas.

Os campos seguem a mesma regra. Um bloqueio sem rótulos na permissão de um campo remove esse campo, e em um recurso operacional a permissão **All Operational Resources** correspondente abre todo campo que pode abrir qualquer pessoa que possa ler ou alterar o registro — mas não um campo mais restrito de propósito, como uma chave secreta.

A mesma regra decide tudo o mais que pergunta se você tem uma permissão: as ações que não são uma simples leitura ou escrita — adicionar crédito de SMS, chamadas ou IA, pagar uma fatura ou testar uma regra de notificação — e os botões que o OneUptime mostra. Um botão que você não pode usar aparece travado e diz por quê; quando o motivo é um bloqueio em uma de suas equipes, ele nomeia a permissão bloqueada.

Todo usuário autenticado detém ainda um pequeno conjunto de permissões automáticas que cobrem coisas como ler o próprio perfil e as próprias regras de notificação. Não são permissões administrativas e não dão acesso aos dados de mais ninguém.

As permissões resolvidas ficam em cache por usuário e projeto, e são atualizadas quando a participação em equipes ou as permissões da equipe mudam. Se você alterar permissões e um usuário não vir a mudança na hora, peça que ele recarregue.

## Receitas

**Uma equipe que só observa.** Crie a equipe e adicione a função `Viewer`, ou as funções `*Viewer` por área apenas para as áreas que ela deve ver.

**Engenheiros de plantão que cuidam dos próprios serviços.** Dê à equipe `MonitorAdmin`, `IncidentMember` e `OnCallMember` com escopo **Próprios** e depois adicione a equipe como proprietária dos monitores que ela opera.

**Terceiros mantidos longe da produção.** Dê à equipe as funções necessárias com escopo **Todos** e depois adicione uma **permissão bloqueada** para as capacidades sensíveis, restrita ao rótulo `Production`.

**Um pipeline de CI que só reporta implantações.** Crie uma chave de API apenas com as permissões granulares de que ela precisa — sem funções.

**Alguém que não deve ver o faturamento.** Não o adicione à equipe Owners. `ProjectAdmin` já exclui o faturamento.

## A seguir

- [Referência de permissões](/docs/permissions/reference) — cada função e cada permissão granular, gerados a partir do código-fonte do OneUptime.
- [SSO](/docs/identity/sso) e [SCIM](/docs/identity/scim) — autenticação e provisionamento automático de usuários.
- [Referência da API](/docs/api-reference/api-reference) — usar permissões a partir da API.
