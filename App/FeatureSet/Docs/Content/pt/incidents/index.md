# Visão geral dos incidentes

Um incidente no OneUptime é o registro em torno do qual sua equipe se organiza quando algo quebra. Ele carrega um número, um título, uma severidade, um estado atual, os recursos que afeta e tudo o que sua equipe anota durante a resposta — notas, causa raiz, passos de remediação e um feed somente-adição de quem fez o quê.

Incidentes são o que transforma um monitor ficando vermelho em uma resposta coordenada. Declarar um aciona a escala de plantão certa, adiciona proprietários que são notificados a cada mudança, dispara runbooks e — se você quiser — publica a interrupção na sua página de status pública, para que os clientes parem de abrir chamados perguntando se você já sabe.

Você pode declarar um incidente à mão às 3 da manhã, ou deixar um monitor declarar por você no instante em que seus critérios correspondem. De um jeito ou de outro, o incidente é o mesmo objeto, com o mesmo ciclo de vida e o mesmo histórico no final.

## Em resumo

- **Recurso de primeiro nível** — **Incidentes** na navegação à esquerda do painel, em `/dashboard/{projectId}/incidents`.
- **Três estados iniciais** — **Identified**, **Confirmado** e **Resolvido** são criados para todo projeto novo. Você pode adicionar os seus; os três iniciais podem ser renomeados e recoloridos, mas nunca excluídos.
- **Três severidades iniciais** — **Critical Incident**, **Major Incident** e **Minor Incident**. Severidade é um rótulo com uma cor e uma ordem — não carrega comportamento algum por si só.
- **Quatro portas de entrada** — o assistente **Declarar incidente**, **Criar a partir de modelo**, uma regra de critérios de monitor, ou `POST /api/incident`.
- **Numerados por projeto** — todo incidente recebe um número de incidente, exibido como `#42` por padrão ou com o seu próprio prefixo, como `INC-42`.
- **Dois tipos de nota** — notas privadas (notas internas) para sua equipe, notas públicas para os assinantes da página de status.
- **As configurações ficam em Incidentes, não em Configurações do projeto** — estados, severidades, modelos, campos personalizados e os motores de regras estão todos em **Incidentes → Configurações** e **Incidentes → Regras**.

## Termos-chave

Um punhado de palavras aparece em todas as outras páginas desta seção. Comece por deixá-las claras.

| Termo                       | O que significa                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incidente**               | O registro em si — título, descrição, severidade, estado atual, recursos afetados e tudo o que for escrito nele durante a resposta.                 |
| **Estado do incidente**     | Onde o incidente está no seu ciclo de vida. Uma linha com escopo de projeto, com nome, cor e `order`, mais as flags que lhe dão significado.        |
| **Severidade do incidente** | O quão grave é. Uma linha com escopo de projeto, com nome, cor e `order`. Pura classificação — nada no produto trata uma severidade de forma especial. |
| **Número do incidente**     | Um contador por projeto exibido como `#42`, ou com um prefixo que você configura, como `INC-42`.                                                    |
| **Recursos afetados**       | Os monitores, hosts, clusters Kubernetes, hosts Docker, serviços e demais infraestruturas que você anexa ao incidente.                              |
| **Nota pública**            | Uma atualização escrita para leitores e assinantes da página de status. Ela é renderizada na linha do tempo da página de status.                    |
| **Nota privada**            | Uma nota interna (o modelo `IncidentInternalNote`) para a equipe que responde. Nunca chega a uma página de status.                                  |
| **Proprietário**            | Um usuário ou equipe responsável pelo incidente. Proprietários são notificados quando ele é criado, quando notas são publicadas e quando o estado muda. |
| **Incidente Feed**          | A linha do tempo somente-adição na **Visão geral** do incidente, registrando mudanças de estado, notas, mudanças de proprietário, execuções de regras e notificações. |
| **Linha do tempo de estado** | O registro de em qual estado o incidente esteve, quando e por quanto tempo — com o status de notificação de assinantes para cada transição.         |

## Os três estados que o OneUptime cria em todo projeto

Quando um projeto é criado, o OneUptime semeia exatamente três estados de incidente, nesta ordem:

| Estado           | Ordem | Cor                  | O que significa                                                              |
| ---------------- | ----- | -------------------- | ---------------------------------------------------------------------------- |
| **Identified**   | 1     | Vermelho (`#fd625e`) | O estado em que um incidente recém-criado aterrissa. Este é o estado de criação. |
| **Confirmado**   | 2     | Amarelo (`#ffbf53`)  | Alguém assumiu o incidente e está trabalhando nele.                          |
| **Resolvido**    | 3     | Verde (`#2ab57d`)    | O incidente acabou. Resolvê-lo é o que o tira da sua página de status.       |

Os nomes são apenas rótulos — o que de fato dirige o comportamento são três booleanos na linha do estado: `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. Espera-se que apenas um estado por projeto carregue cada flag.

Essa distinção importa mais do que parece:

- `isCreatedState` decide onde um novo incidente começa. Se nenhum estado for explicitamente selecionado na criação, o OneUptime procura o estado de criação do projeto e o utiliza.
- `isAcknowledgedState` e `isResolvedState` alimentam os botões **Acknowledge** e **Resolver** no cabeçalho do incidente, os dois blocos de estatística na **Visão geral** do incidente e o contador **Incidentes ativos** no menu lateral.
- **Incidentes ativos** é definido puramente como "o estado atual não é o estado resolvido". Qualquer estado personalizado que você adicionar é, portanto, ativo, a menos que seja o resolvido.

**Repare na nomenclatura.** O primeiro estado inicial se chama **Identified**, mesmo que várias descrições dentro do produto ainda o chamem de estado de criação. Se você estiver procurando por "Created" na lista de estados do seu projeto, é a linha chamada **Identified**.

Você pode adicionar seus próprios estados em **Incidentes → Configurações → Estado do incidente**. Novos estados são acrescentados ao fim da lista ordenada e você pode arrastar para reordenar. Os três estados com flag não podem ser excluídos — o OneUptime bloqueia isso — mas você pode renomeá-los e recolori-los, e é por isso que a interface lê os nomes dos estados dinamicamente.

A ordem é imposta, não decorativa: um incidente não pode ir para um estado que esteja antes do atual na ordenação.

O detalhamento completo está em [Estados e severidades de incidentes](/docs/incidents/states-and-severities).

## As três severidades que o OneUptime cria em todo projeto

Todo projeto novo também ganha três severidades:

| Severidade            | Ordem | Cor                  | O que significa                                              |
| --------------------- | ----- | -------------------- | ------------------------------------------------------------ |
| **Critical Incident** | 1     | Bordô (`#b70400`)    | Impacto muito alto ao cliente, exigindo resposta imediata.   |
| **Major Incident**    | 2     | Vermelho (`#fd625e`) | Impacto significativo, geralmente exigindo resposta imediata. |
| **Minor Incident**    | 3     | Amarelo (`#ffbf53`)  | Impacto baixo, geralmente tratado em horário comercial.      |

As descrições iniciais completas estão em [Estados e severidades de incidentes](/docs/incidents/states-and-severities).

Severidades têm `name`, `description`, `color` e `order`, e nada mais. Não há flags, e nenhum caminho de código trata "Critical Incident" de forma diferente de qualquer outra linha. A severidade é como as pessoas fazem triagem, e ela está disponível como critério de correspondência quando você escreve regras de plantão — mas escolher uma severidade não aciona ninguém por si só.

Edite ou adicione severidades em **Incidentes → Configurações → Severidade do incidente**.

## A vida de um incidente

### 1. Ele é declarado

Quatro caminhos levam ao mesmo objeto:

- **À mão** — na lista de incidentes, clique em **Declarar incidente**. Isso abre o assistente **Declarar novo incidente**, com cinco etapas: **Detalhes do incidente**, **Recursos afetados**, **Funções de incidente**, **Plantão** e **Mais**.
- **A partir de um modelo** — clique em **Criar a partir de modelo** e escolha um **Modelos de incidentes** salvo. Modelos pré-preenchem título, descrição, severidade, estado inicial, recursos, políticas de plantão, proprietários e rótulos.
- **A partir de um monitor** — uma regra de critérios de monitor com a opção "declarar um incidente" ativada cria o incidente automaticamente no instante em que seus filtros correspondem. Títulos e descrições ali suportam templating com `{{variable}}`.
- **Pela API** — `POST /api/incident` com uma chave de API. O servidor preenche `declaredAt`, o estado de criação e o número do incidente por você.

Veja [Declarar um incidente](/docs/incidents/declaring-incidents) para o passeio campo a campo.

### 2. As pessoas certas ficam sabendo

Na criação, o OneUptime executa a automação que você configurou: regras de rótulos, regras de plantão, regras de proprietário e regras de runbook. Quaisquer políticas de plantão anexadas ao incidente — manualmente, por um modelo, ou incorporadas por uma regra de plantão correspondente — são executadas em paralelo.

Proprietários são notificados por e-mail, SMS, chamada, push e WhatsApp, sujeitos às preferências de notificação de cada usuário. Se um incidente não tiver proprietário algum, a notificação recai sobre os proprietários do projeto em vez de ser descartada.

Se o incidente estiver visível em uma página de status e as notificações a assinantes estiverem habilitadas, os assinantes também são avisados. As notificações são dirigidas por cron e rodam a cada minuto, então espere até cerca de um minuto de atraso em vez de um envio instantâneo.

### 3. Sua equipe trabalha nele

Respondentes confirmam o incidente, anexam recursos afetados, executam runbooks, atribuem funções de incidente e anotam as coisas conforme as descobrem — notas privadas para a equipe, notas públicas para os clientes, mais as páginas **Causa raiz** e **Remediação** quando o quadro fica mais claro. Tudo o que fizerem aterrissa no **Incidente Feed** na página **Visão geral**.

### 4. Ele é resolvido

Clicar em **Resolver** move o incidente para o estado resolvido, carimba a linha do tempo de estado, para o cronômetro de duração e remove o incidente da seção ativa de qualquer página de status em que ele aparecia. Nada mais precisa mudar para isso acontecer — a flag de estado resolvido é o que a consulta da página de status observa.

Depois disso você pode escrever um post-mortem e, opcionalmente, publicá-lo na página de status.

## Onde os incidentes ficam no painel

Abra **Incidentes** na navegação à esquerda. Seu menu lateral está organizado em seções:

| Seção                     | O que você faz ali                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Visão geral**           | **Todos os incidentes** e **Incidentes ativos** — este último traz um selo vermelho com a contagem de incidentes que não estão no estado resolvido.                    |
| **Episódios**             | Episódios de incidente, um recurso de agrupamento à parte com suas próprias páginas.                                                                                  |
| **IA**                    | **Investigação** e **Remediação** — configurações de investigação automática e auto-remediação.                                                                       |
| **Espaço de trabalho**    | Conexões **Slack** e **Microsoft Teams** para incidentes.                                                                                                             |
| **Regras**                | Os motores de regras: **Regras de agrupamento**, **Regras de Plantão**, **Regras de proprietário**, **Regras de runbook**, **Regras de privacidade**, **Regras de Rótulos**, **Regras de SLA**, **Reminder Rules**. |
| **Configurações**         | **Estado do incidente**, **Severidade do incidente**, **Modelos de incidentes**, **Modelos de notas**, **Modelos de post-mortem**, **Campos personalizados**, **Funções de incidente**, **Mais configurações**. |

**Regras** e **Configurações** vêm recolhidas por padrão — expanda-as para encontrar as páginas às quais o resto desta documentação se refere. A configuração de incidentes não fica em Configurações do projeto; ela mora toda aqui.

A própria lista de incidentes mostra **Número do incidente**, **Título**, **Estado**, **Gravidade**, **Recursos afetados**, **Declarado**, **Duração**, **Rótulos** e **Proprietários**, com uma ação em lote **Alterar estado** para fechar vários de uma vez.

## O que cada página de um incidente mostra

Abra um incidente e você ganha um menu lateral à esquerda, agrupado assim:

- **Visão geral** — o cartão **Detalhes do incidente** (título, severidade, rótulos, número do incidente, declarado em, declarado por, políticas de plantão), um cartão **Recursos afetados** e o **Incidente Feed**. Acima deles, blocos de estatística para tempo até a confirmação, tempo até a resolução e **Duração** total.
- **Linha do tempo de estado** — todos os estados pelos quais o incidente passou, com **Começa em**, **Termina em**, **Duração** e o status de notificação de assinantes para cada transição. **Ver causa** e **Ver registros** explicam por que cada mudança aconteceu.
- **SLA** — acompanhamento de SLA para este incidente.
- **Descrição**, **Causa raiz**, **Remediação** — três páginas em markdown. A descrição é a que aparece na sua página de status.
- **Runbooks** — execuções de runbook anexadas a este incidente.
- **Post-mortem** — a análise escrita, que você pode opcionalmente publicar na página de status.
- **Funções**, **Execuções de plantão**, **Proprietários** — quem está nele, quais políticas dispararam e quem é notificado.
- **Logs de notificação**, **Registros de IA**, **Registros de auditoria** — o que foi enviado e o que mudou.
- **Notas privadas** e **Notas públicas** — na seção **Notas** do menu lateral.
- **Campos personalizados**, **Configurações**, **Excluir incidente** — em **Avançado**. A página **Configurações** contém **Visível na página de status**, **Incidente privado** e o cartão **Reminders**.

[Notas, responsáveis e feed de incidentes](/docs/incidents/notes-owners-and-feed) cobre em profundidade as páginas de colaboração.

## Como os incidentes se encaixam no resto do OneUptime

- **Monitores detectam o problema; incidentes o registram.** Uma regra de critérios de monitor pode declarar um incidente automaticamente, pré-preenchendo título, severidade, políticas de plantão, proprietários, rótulos e notas de remediação. Veja [Modelos de incidentes e alertas](/docs/monitor/incident-alert-templating) para as variáveis disponíveis ali.
- **Políticas de plantão fazem o acionamento.** Anexe políticas na etapa **Plantão** do assistente de declaração, em um modelo, ou por meio de **Incidentes → Regras → Regras de Plantão**. Toda regra correspondente dispara — o conjunto executado é a união de todas as correspondências mais qualquer coisa anexada diretamente, sem duplicatas.
- **Runbooks dizem às pessoas o que fazer.** Regras de runbook anexam um procedimento automaticamente quando um incidente correspondente é criado, e os respondentes podem iniciar um à mão a partir do incidente. Veja [Visão geral dos Runbooks](/docs/runbooks/index).
- **Páginas de status avisam os clientes.** Um incidente aparece na lista ativa de uma página de status quando a página tem incidentes habilitados, o incidente está marcado como visível na página de status e seu estado atual não é o estado resolvido. Incidentes privados ficam ocultos de toda página de status, sempre. Veja [Visão geral das páginas de status](/docs/status-pages/index).
- **Workflows automatizam em torno dele.** Os gatilhos **On Create Incident**, **On Update Incident** e **On Delete Incident** permitem construir automação sem código sobre o ciclo de vida do incidente. Veja [Visão geral dos workflows](/docs/workflows/index).

## Onde ler a seguir

- [Declarar um incidente](/docs/incidents/declaring-incidents) — o assistente, modelos, critérios de monitor e a API.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — as flags de estado, estados personalizados e a classificação por severidade.
- [Notas, responsáveis e feed de incidentes](/docs/incidents/notes-owners-and-feed) — notas públicas e privadas, proprietários e o feed de atividades.
- [Configurações e automação de incidentes](/docs/incidents/settings) — modelos, campos personalizados, prefixos de número e os motores de regras.
- [Visão geral das páginas de status](/docs/status-pages/index) — como os incidentes chegam aos seus clientes.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — quem é notificado quando um incidente muda.
