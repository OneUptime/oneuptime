# Declarar um incidente

Declarar um incidente é o momento em que o OneUptime começa a contar o placar. Um registro é criado, um número é carimbado nele, políticas de plantão disparam e — a menos que você diga o contrário — os assinantes da sua página de status ficam sabendo. Todo o resto do ciclo de vida do incidente pende dessa primeira gravação.

Há quatro maneiras de um incidente entrar no OneUptime, e todas terminam no mesmo lugar: uma linha na tabela `Incident` com uma severidade, um estado atual e uma lista de recursos afetados. A diferença está apenas em quem preenche os campos — você às 3 da manhã, um modelo salvo, os critérios de um monitor, ou seu próprio código chamando a API.

Esta página percorre as quatro, campo a campo, e depois cobre o que o servidor preenche por você e o que dispara no instante em que o incidente passa a existir.

## Quatro maneiras de declarar um incidente

| Se você quiser…                                                     | Escolha                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Abrir um incidente à mão, preenchendo tudo                          | O assistente **Declarar incidente**                                         |
| Abrir um tipo recorrente de incidente com os campos já preenchidos  | **Criar a partir de modelo**                                                |
| Abrir um automaticamente quando as verificações de um monitor falham | Um filtro de critérios de monitor com **When filters match, declare an incident.** |
| Abrir um a partir do seu próprio código, de um script ou de outra ferramenta | `POST /api/incident`                                                |

As quatro gravam o mesmo modelo, então um incidente aberto por uma sonda é idêntico a um que um respondente abriu à mão — fora algumas colunas de controle que o servidor define nos automáticos.

## Declarar um à mão

Abra **Incidentes → Todos os incidentes** e clique em **Declarar incidente** no canto superior direito da lista de **Incidentes**. Isso leva você a um cartão intitulado **Declarar novo incidente**, que distribui o formulário em cinco etapas: **Detalhes do incidente**, **Recursos afetados**, **Funções de incidente**, **Plantão** e **Mais**. O botão de envio no final também diz **Declarar incidente**.

Só a primeira etapa tem campos obrigatórios. Se estiver com pressa, preencha **Detalhes do incidente** e envie — você pode anexar recursos, atribuir funções e adicionar políticas de plantão depois, a partir das próprias páginas do incidente.

### Etapa 1 — Detalhes do incidente

- **Título** — obrigatório. O resumo de uma linha que todo mundo vai ver na lista, no Slack e (se o incidente estiver visível) na sua página de status. Placeholder: `Incident Title`.
- **Descrição** — opcional, escrita em Markdown. Este é o campo que é renderizado na página de status, então escreva-o pensando nos clientes e não na sua equipe. Você pode editá-lo depois em **Descrição**, no menu lateral do incidente.
- **Declarado Em** — obrigatório no formulário, com padrão agora. É a partir deste carimbo de tempo que toda duração do incidente é medida, então retroaja a data se estiver registrando algo que começou antes.
- **Severidade do incidente** — obrigatória. Uma das severidades configuradas no seu projeto; projetos novos nascem com **Critical Incident**, **Major Incident** e **Minor Incident**.
- **Estado do incidente** — opcional. Deixe como está e o incidente aterrissa no estado marcado com `isCreatedState`, que projetos novos criam como **Identified**. Defina-o apenas quando estiver registrando um incidente que já passou desse ponto.

**Se o menu de estado der trabalho.** Se o seu projeto não tiver nenhum estado carregando a flag `isCreatedState`, a chamada de criação falha e pede que você adicione um estado de criação nas configurações. Isso normalmente só acontece em projetos cujos estados foram muito editados — veja [Estados e severidades de incidentes](/docs/incidents/states-and-severities).

### Etapa 2 — Recursos afetados

- **Recursos afetados** — uma única caixa de busca que anexa monitores, hosts, clusters Kubernetes, hosts Docker, hosts Podman e serviços. Por baixo dos panos, essas são relações separadas no incidente (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` e outras), mas o formulário as reúne em um único seletor.
- **Change Monitor Status to** — opcional. Escolhe um status de monitor que é aplicado a todo monitor anexado a este incidente, de modo que declarar o incidente e marcar os monitores como degradados vira uma ação em vez de duas.

**Anexe monitores mesmo quando parecer redundante.** O elo entre um incidente e uma página de status passa pelos monitores do incidente: uma página de status mostra um incidente quando um de seus recursos é um dos monitores do incidente. Uma notificação de mudança de estado aos assinantes é simplesmente ignorada quando o incidente não tem monitores anexados. Veja [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups).

### Etapa 3 — Funções de incidente

- **Atribuir funções do incidente** — atribua membros da equipe às funções que o seu projeto define. Algumas funções aceitam mais de um usuário.

As funções em si são configuradas em **Incidentes → Configurações → Funções de incidente**, onde você define as funções que podem ser atribuídas durante a resposta — Incident Commander, Responder e o que mais o seu processo exigir. Se você pular esta etapa, um Incident Commander é atribuído automaticamente na primeira mudança de estado, caso ninguém ainda ocupe a função.

### Etapa 4 — Plantão

- **Política de plantão** — uma seleção múltipla das políticas de plantão a executar quando este incidente for criado. Isso corresponde a `onCallDutyPolicies` no incidente.

Este é o único lugar onde uma política de plantão é anexada diretamente a um incidente. Severidades não carregam política de plantão — severidade é um rótulo, e ela só influencia o acionamento como *critério de correspondência* dentro de uma regra de plantão. Regras configuradas em **Incidentes → Regras → Regras de Plantão** somam suas políticas ao que você escolher aqui; o conjunto final executado é a união dos dois, sem duplicatas.

### Etapa 5 — Mais

- **Rótulos** — opcional e um recurso avançado: os membros da equipe com acesso a esses rótulos são os que conseguem acessar o incidente.
- **Notificar assinantes da página de status** — caixa de seleção, ativada por padrão. Controla se os assinantes recebem e-mail sobre a criação do incidente (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Desmarque para ruído interno que você ainda quer registrar.
- **Incidente privado** — caixa de seleção, desativada por padrão (`isPrivate`). Um incidente privado é visível apenas para seus usuários proprietários, os membros de suas equipes proprietárias, administradores e proprietários do projeto — e fica oculto de toda página de status, independentemente de qualquer outra configuração. A lista de incidentes marca esses com uma etiqueta vermelha **Private**.

A flag **Should be visible on status page?** (`isVisibleOnStatusPage`) não está no assistente; ela vem como verdadeira. Altere-a depois em **Configurações**, no menu lateral do incidente, onde ela aparece como **Visível na página de status**.

## Declarar a partir de um modelo

Se você vive declarando o mesmo formato de incidente — o mesmo padrão de título, a mesma severidade, a mesma política de plantão — salve isso uma vez como modelo.

Clique em **Criar a partir de modelo** (o botão contornado ao lado de **Declarar incidente**) e abre-se um modal **Criar incidente a partir de modelo**, com uma lista suspensa **Selecionar Modelo de Incidente**. Escolha um modelo e o formulário de criação abre pré-preenchido; você ainda pode mudar qualquer coisa antes de enviar. Se o seu projeto ainda não tiver modelos, você recebe um modal **No Incident Templates**, com um botão **Create Template** que leva a **Incidentes → Configurações → Modelos de incidentes**.

Modelos são construídos com seu próprio assistente de seis etapas — **Informações do modelo**, **Detalhes do incidente**, **Recursos afetados**, **Plantão**, **Proprietários**, **Rótulos** — com estes campos:

| Campo                            | Para que serve                                                  |
| -------------------------------- | ---------------------------------------------------------------- |
| **Nome do modelo**               | Como o modelo é identificado no seletor.                        |
| **Descrição do modelo**          | Um recado para o seu eu do futuro sobre quando usá-lo.          |
| **Título**                       | O título pré-preenchido no incidente.                           |
| **Descrição**                    | Descrição em Markdown pré-preenchida no incidente.              |
| **Severidade do incidente**      | Severidade pré-preenchida no incidente.                         |
| **Estado Inicial do Incidente**  | O estado em que incidentes deste modelo começam.                |
| **Recursos afetados**            | Monitores, hosts, clusters e serviços a anexar.                 |
| **Change Monitor Status to**     | Status de monitor a aplicar aos monitores anexados.             |
| **Política de plantão**          | Políticas a executar quando o incidente for criado.             |
| **Proprietário - Equipes**       | Equipes que são donas dos incidentes criados a partir do modelo. |
| **Proprietário - Usuários**      | Usuários que são donos dos incidentes criados a partir do modelo. |
| **Rótulos**                      | Rótulos aplicados ao incidente.                                 |

Algumas regras rápidas:

- Modelos não são editáveis a partir da lista de modelos — você cria um e depois o abre para alterá-lo.
- Um modelo só preenche um campo que você deixou vazio. Na página de criação, o modelo é aplicado como um pré-preenchimento que você pode sobrescrever; na API, o servidor preenche um campo a partir do modelo apenas quando a requisição deixou aquele campo `undefined`. O que o chamador enviar sempre vence.

## Declarar automaticamente a partir de critérios de monitor

A maioria dos incidentes não deveria precisar de um humano para digitá-los. No editor de critérios de um monitor, ative a chave **When filters match, declare an incident.** e aparece uma seção **Criar incidente** com um botão **Adicionar incidente** — um único filtro de critérios pode declarar mais de um incidente.

Cada entrada tem:

- **Título do Incidente** — aceita templating; o placeholder sugere algo como `{{monitorName}} is down`.
- **Gravidade** — obrigatória.
- **Descrição do incidente** — também aceita templating.
- **Plantão → Políticas de plantão** — políticas executadas quando este incidente é criado.
- **Funções de incidente** — pré-atribua membros da equipe a funções.
- **Propriedade e rótulos → Equipes proprietárias**, **Usuários proprietários**, **Rótulos**.
- **Opções avançadas → Resolver incidente automaticamente** (resolve o incidente automaticamente quando os critérios deixam de corresponder), **Mostrar incidente na página de status**, **Incidente privado** e **Notas de remediação**.

Para a lista completa de espaços reservados `{{variable}}` que você pode usar no título, na descrição e nas notas de remediação, veja [Modelos de incidentes e alertas](/docs/monitor/incident-alert-templating).

Incidentes criados assim são marcados pelo servidor: `isCreatedAutomatically` é definido, `createdCriteriaId` registra qual filtro de critérios disparou e `createdByProbe` registra qual sonda o observou. Em todo o resto, eles se comportam exatamente como um incidente declarado à mão.

## Declarar pela API

O modelo de incidente expõe um endpoint CRUD padrão, então `POST /api/incident` cria um. Autentique-se com uma chave de API gerada em **Configurações do projeto → Chaves de API**, enviada no cabeçalho `apikey` — a chave identifica o projeto, então você não precisa passar um id de projeto separadamente.

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

Campos úteis no corpo da requisição:

- `title` — o único campo que você realmente precisa enviar.
- `declaredAt` — opcional aqui, mesmo sendo obrigatório no formulário. Omita-o e o servidor usa a hora atual.
- `incidentSeverityId` e `currentIncidentStateId` — o servidor confere se ambos pertencem ao mesmo projeto da chave de API e rejeita a requisição se não pertencerem. A mesma checagem vale para o status de monitor por trás de **Change Monitor Status to**.
- `createdIncidentTemplateId` — aplica um modelo salvo. Qualquer campo que você omitir é preenchido a partir do modelo; qualquer campo que você enviar é mantido como está.

Endpoints relacionados são `/api/incident-state`, `/api/incident-severity` e `/api/incident-state-timeline`. A [referência da API](/reference) gerada traz os formatos exatos de requisição e resposta de cada um, incluindo como campos de relação, como monitores, são expressos.

## Números de incidente e prefixos

Todo incidente recebe um número sequencial de um contador por projeto, atribuído pelo servidor no momento da criação. Duas colunas o guardam: `incidentNumber` (o inteiro puro) e `incidentNumberWithPrefix` (o que você de fato vê). Sem prefixo configurado, o valor exibido é `#42`.

Para mudar isso, vá a **Incidentes → Configurações → Mais configurações**. O cartão **Prefixo do número** tem um campo **Prefixo de número de incidente** (até 20 caracteres, placeholder `INC-`) — defina-o e o mesmo incidente passa a aparecer como `INC-42`. Deixe vazio para manter o `#` padrão. O cartão também traz **Prefixo de número de episódio de incidente** para a numeração de episódios.

O número aparece como a primeira coluna da lista de incidentes, é um link para o incidente, e aparece como **Número do incidente** na **Visão geral** do incidente.

## O que acontece no instante em que um incidente é declarado

A chamada de criação faz bem mais do que gravar uma linha. Em ordem:

1. **O servidor preenche as lacunas.** `declaredAt` assume a hora atual, o estado atual assume o estado `isCreatedState` do projeto, e o número do incidente e o número com prefixo são atribuídos a partir do contador do projeto.
2. **Um modelo é aplicado**, se `createdIncidentTemplateId` tiver sido enviado — preenchendo apenas os campos que o chamador deixou indefinidos.
3. **Regras de privacidade rodam**, marcando o incidente como privado quando uma regra correspondente assim determina. Este é o primeiro motor de regras a rodar, para que tudo depois dele enxergue a configuração de privacidade correta.
4. **Regras de proprietário rodam**, adicionando os usuários e equipes proprietários que as regras correspondentes nomeiam.
5. **Regras de rótulos rodam**, adicionando os rótulos que correspondem ao incidente.
6. **Regras de plantão rodam.** Toda regra habilitada em **Incidentes → Regras → Regras de Plantão** cujos critérios correspondam soma suas políticas ao incidente. Não há ordem de prioridade nem curto-circuito — todas as regras correspondentes disparam e as políticas são deduplicadas.
7. **Regras de runbook rodam**, anexando e iniciando os runbooks correspondentes. Veja [Runbooks](/docs/runbooks/index).
8. **Políticas de plantão são executadas.** Toda política no incidente — escolhida no assistente, herdada de um modelo, ou adicionada por uma regra — é executada em paralelo com o tipo de evento `IncidentCreated`. Uma política falhar não interrompe as demais.
9. **Assinantes entram na fila**, se **Notificar assinantes da página de status** tiver ficado ativado e o incidente estiver visível na página de status. A entrega fica a cargo de um job em segundo plano, não da sua requisição.
10. **Workflows disparam.** O gatilho **On Create Incident** inicia qualquer workflow construído sobre ele. Veja [Visão geral dos workflows](/docs/workflows/index).

Daí em diante o incidente está no ar: ele conta para o selo **Incidentes ativos** no menu lateral de Incidentes (qualquer estado sem a flag `isResolvedState` conta como ativo), aparece nas páginas de status que carregam um de seus monitores, e sua **Linha do tempo de estado** começa a registrar.

## Onde ler a seguir

- [Visão geral dos incidentes](/docs/incidents/index) — como o modelo de incidente se encaixa.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — o que as flags de estado fazem e como adicionar as suas.
- [Notas, responsáveis e feed de incidentes](/docs/incidents/notes-owners-and-feed) — notas públicas, notas privadas, proprietários e o feed de atividades.
- [Configurações e automação de incidentes](/docs/incidents/settings) — modelos, campos personalizados, funções, regras e gatilhos de workflow.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — quem fica sabendo do incidente que você acabou de declarar.
- [Modelos de incidentes e alertas](/docs/monitor/incident-alert-templating) — as variáveis disponíveis para incidentes declarados automaticamente.
