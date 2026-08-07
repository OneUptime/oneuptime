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

Crie quantas equipes adicionais quiser — "Plantão do Frontend", "Suporte", "Auditores somente leitura" — e dê a cada uma as permissões de que ela precisa.

Onde encontrar: **Configurações → Equipes**. Abra uma equipe para chegar a **Members**, **Permissions** e **Block Permissions**.

## Permissões

Uma permissão é uma capacidade única. Há duas formas de distribuí-las, ambas na aba **Permissions** da equipe.

### Funções

Uma função agrupa uma área inteira do produto em um de três níveis:

- **Admin** — controle total sobre a área, incluindo sua configuração (severidades, estados, modelos).
- **Member** — o trabalho do dia a dia: criar, editar e excluir os recursos, mas não reconfigurar a área.
- **Viewer** — somente leitura.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` e assim por diante. Funções são o que você quer quase sempre — elas continuam corretas conforme o OneUptime ganha recursos, porque uma nova tabela relacionada a monitores entra nas funções de monitor existentes em vez de exigir uma nova concessão sua.

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

Como o acesso de um usuário é a união de todas as suas equipes, um bloqueio em uma equipe **não** cancela uma permissão concedida em outra. Bloqueios restringem a equipe em que foram definidos. Se alguém tem mais acesso do que você esperava, verifique todas as equipes a que essa pessoa pertence.

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
3. Verificar primeiro a lista de bloqueios. Um bloqueio correspondente sem rótulos rejeita a requisição de imediato.
4. Verificar a lista de permitidas. A requisição precisa de pelo menos uma permissão que a tabela de destino aceite para essa operação.
5. Aplicar o escopo. Concessões com escopo Próprios restringem a consulta aos recursos próprios; as de rótulos restringem aos rótulos correspondentes. Se qualquer outra concessão para a mesma operação for mais ampla, a mais ampla vence.
6. Aplicar os bloqueios por rótulos. Um bloqueio com rótulos rejeita a requisição se o recurso de destino carregar um deles.

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
