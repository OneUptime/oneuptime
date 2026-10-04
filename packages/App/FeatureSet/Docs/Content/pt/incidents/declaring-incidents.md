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

Abra **Incidentes → Todos os incidentes** e clique em **Declarar incidente** no canto superior direito da lista de **Incidentes**. Isso leva você a um cartão intitulado **Declarar novo incidente**, que distribui o formulário em três etapas: **Detalhes do incidente**, **Recursos afetados** e **Plantão e funções**, e depois um resumo para revisar. Quando o seu projeto pede alguns dos campos personalizados de incidente na criação, uma quarta etapa, **Detalhes**, vem logo depois de **Recursos afetados**.

Só a primeira etapa tem campos obrigatórios, além de qualquer campo personalizado que os administradores marcaram como **Obrigatório na criação**. Você também pode anexar recursos, adicionar políticas de plantão e atribuir funções depois, a partir das páginas do próprio incidente. Cada etapa antes do resumo tem um simples **Próximo**, e **Declarar incidente** fica no resumo, a última etapa.

**Avançado.** As opções de que a maioria dos incidentes nunca precisa esperam recolhidas sob um cabeçalho **Avançado** no fim da sua etapa; clique nele para abri-las. Recolhido, o cabeçalho mostra **Configurado** quando algo nele está definido — por um modelo, por exemplo — e abre sozinho quando algo nele precisa de correção. O resumo só lista uma opção recolhida quando ela está definida, exceto **Notificar assinantes da página de status**, que ele sempre lista, com quem será notificado.

### Etapa 1 — Detalhes do incidente

- **Título** — obrigatório. O resumo de uma linha que todos veem na lista, no Slack e, se o incidente estiver visível, na sua página de status.
- **Severidade do incidente** — obrigatório. Uma das severidades configuradas no seu projeto.
- **Descrição** — opcional, escrita em Markdown. É o que a página de status mostra, então escreva para os clientes e não para a sua equipe.

Em **Avançado**:

- **Declarado Em** — começa no momento em que você abriu a página. Toda duração do incidente é medida a partir dele; retroceda-o para registrar um incidente que começou antes.
- **Estado Inicial** — opcional, e vazio no início. Deixado vazio, o incidente começa no estado marcado com `isCreatedState`, ou no estado inicial do modelo. Escolha um estado posterior só para registrar um incidente já reconhecido ou resolvido.
- **Rótulos** — opcional. Rótulos agrupam incidentes relacionados, e uma equipe restrita a rótulos só vê os incidentes que levam um dos seus.
- **Incidente privado** — desligado por padrão (`isPrivate`). Um incidente privado só é visível para os seus donos, os administradores e os donos do projeto, e fica oculto em todas as páginas de status.

**Se o menu de estado der trabalho.** Se o seu projeto não tiver nenhum estado carregando a flag `isCreatedState`, a chamada de criação falha e pede que você adicione um estado de criação nas configurações. Isso normalmente só acontece em projetos cujos estados foram muito editados — veja [Estados e severidades de incidentes](/docs/incidents/states-and-severities).

### Etapa 2 — Recursos afetados

Os monitores vêm primeiro, à parte: as páginas de status enxergam um incidente pelos seus monitores, e o status para o qual os monitores mudam fica logo abaixo deles.

- **Monitores** — uma caixa de busca que anexa os monitores afetados pelo incidente (`monitors`). Uma página de status mostra o incidente, e avisa os seus assinantes, quando lista um desses monitores.
- **Alterar status do monitor para** — opcional, e mostrado só quando há pelo menos um monitor escolhido. Aplica um status a cada monitor do incidente, de modo que declarar o incidente e marcar os monitores como degradados seja uma única ação. O status de um modelo aparece assim que você escolhe um monitor; sem monitor escolhido, nenhum status é salvo.
- **Outros recursos afetados** — uma segunda caixa de busca para todo o resto que o incidente afeta: hosts, clusters do Kubernetes, hosts do Docker e do Podman, clusters do Proxmox, Ceph e Docker Swarm, vCenters, frotas de IoT, bancos de dados e serviços. São relações separadas do incidente (`hosts`, `kubernetesClusters`, `services` e mais).

O cartão **Recursos afetados** do incidente pergunta do mesmo jeito quando você o edita depois.

Em **Avançado**:

- **Limitar a estas páginas de status** — opcional. Deixado vazio, o incidente aparece em todas as páginas de status que listam os seus monitores, e avisa os assinantes delas; com páginas escolhidas, só nessas entre elas. Veja [Uma página de status por público](/docs/status-pages/one-status-page-per-audience).
- **Notificar assinantes da página de status** — caixa de seleção, marcada por padrão (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Abaixo dela, e de novo no resumo, o formulário mostra quais páginas de status serão avisadas e quantos assinantes cada uma tem; no resumo, **Pré-visualizar notificação** mostra o e-mail que eles vão receber. Desmarque-a para o ruído interno que você ainda quer registrar.

**Anexe monitores mesmo quando parecer redundante.** O elo entre um incidente e uma página de status passa pelos monitores do incidente: uma página de status mostra um incidente quando um de seus recursos é um dos monitores do incidente. Uma notificação de mudança de estado aos assinantes é simplesmente ignorada quando o incidente não tem monitores anexados. Veja [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups).

### Etapa 3 — Plantão e funções

- **Política de plantão** — uma seleção múltipla das políticas de plantão a executar quando este incidente for criado (`onCallDutyPolicies`).
- **Atribuir funções do incidente** — quem assume cada função que o seu projeto define. Uma função marcada como **Principal** que você deixar vazia é sua: você a assume quando o incidente é declarado.

Este é o único lugar onde uma política de plantão é anexada diretamente a um incidente. Severidades não carregam política de plantão — severidade é um rótulo, e ela só influencia o acionamento como *critério de correspondência* dentro de uma regra de plantão. Regras configuradas em **Incidentes → Regras → Regras de Plantão** somam suas políticas ao que você escolher aqui; o conjunto final executado é a união dos dois, sem duplicatas.

As funções em si são configuradas em **Incidentes → Configurações → Funções de incidente**. Um projeto novo tem uma, Incident Commander; adicione ali o que mais o seu processo precisar.

A flag **Should be visible on status page?** (`isVisibleOnStatusPage`) não está no assistente; ela vem como verdadeira. Altere-a depois em **Configurações**, no menu lateral do incidente, onde ela aparece como **Visível na página de status**.

## Declarar a partir de um modelo

Se você vive declarando o mesmo formato de incidente — o mesmo padrão de título, a mesma severidade, a mesma política de plantão — salve isso uma vez como modelo.

Clique em **Criar a partir de modelo** (o botão contornado ao lado de **Declarar incidente**) e abre-se um modal **Criar incidente a partir de modelo**, com uma lista suspensa **Selecionar Modelo de Incidente**. Escolha um modelo e o formulário de criação abre pré-preenchido; você ainda pode mudar qualquer coisa antes de enviar. Se o seu projeto ainda não tiver modelos, você recebe um modal **No Incident Templates**, com um botão **Create Template** que leva a **Incidentes → Configurações → Modelos de incidentes**.

Modelos são construídos com o seu próprio assistente — **Informações do modelo**, **Detalhes do incidente**, **Recursos afetados**, **Plantão** — mais etapas de campos personalizados quando o seu projeto os tem. Os donos e os rótulos ficam em **Avançado** no fim de **Detalhes do incidente**. **Recursos afetados** pergunta como o formulário de declaração — **Monitores**, depois **Alterar status do monitor para**, depois **Outros recursos afetados**, com **Limitar a estas páginas de status** em **Avançado** — exceto que um modelo sempre pede o status dos monitores: ele também vale para os monitores escolhidos quando um incidente é declarado a partir dele. Estes são os campos:

| Campo                            | Para que serve                                                  |
| -------------------------------- | ---------------------------------------------------------------- |
| **Nome do modelo**               | Como o modelo é identificado no seletor.                        |
| **Descrição do modelo**          | Um recado para o seu eu do futuro sobre quando usá-lo.          |
| **Título**                       | O título pré-preenchido no incidente.                           |
| **Descrição**                    | Descrição em Markdown pré-preenchida no incidente.              |
| **Severidade do incidente**      | Severidade pré-preenchida no incidente.                         |
| **Estado Inicial do Incidente**  | O estado em que incidentes deste modelo começam.                |
| **Monitores** | Monitores a anexar. |
| **Alterar status do monitor para** | Status a aplicar aos monitores do incidente, inclusive os escolhidos ao declará-lo. |
| **Outros recursos afetados** | Hosts, clusters e serviços a anexar. |
| **Limitar a estas páginas de status** | Páginas de status às quais o incidente fica limitado. |
| **Política de plantão**          | Políticas a executar quando o incidente for criado.             |
| **Proprietários** | Pessoas e equipes donas dos incidentes criados a partir do modelo, escolhidas em uma única lista. |
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

Para mudar isso, vá a **Incidentes → Configurações → Prefixo do número** e clique em **Atualizar**. O campo **Prefixo de número de incidente** mostra o número enquanto você digita: com `INC-`, ele vira `INC-42`. Deixe vazio para manter o `#` padrão. Um prefixo novo vale para incidentes declarados depois de salvar; os incidentes existentes mantêm seus números. A mesma caixa de diálogo traz **Prefixo de número de episódio de incidente** para a numeração de episódios.

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
