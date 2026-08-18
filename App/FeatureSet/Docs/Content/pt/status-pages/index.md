# Visão geral das páginas de status

Uma página de status é o rosto público de tudo o que você monitora: uma única URL que seus clientes podem abrir em vez de mandar um e-mail perguntando se o problema é só com eles. Ela mostra o estado atual dos serviços que você escolhe expor, os incidentes em que você está trabalhando, as manutenções que você tem planejadas e qualquer comunicado que queira fixar no topo.

Quando algo quebra às duas da manhã, a página de status é a primeira coisa que sua fila de suporte manda como link. É também de onde partem as notificações para seus assinantes — ou seja, vale montá-la antes de precisar dela, não durante a queda.

As páginas de status ficam em **Páginas de status**, na navegação à esquerda do painel, dentro do grupo **essentials**. Tudo nesta página vale por página de status: um projeto pode ter quantas quiser — uma pública para clientes, uma privada para o público interno, uma por região para um mercado específico.

## Em resumo

- **Criada com dois campos.** Uma nova página de status só pede **Nome** e **Descrição**. Recursos, marca e domínios são configurados depois.
- **Os recursos são o que os visitantes veem.** Cada linha da página é um **Status Page Resource** — um monitor (ou grupo de monitores) com seu próprio nome de exibição, dica e opções de disponibilidade. Grupos dividem uma página longa em seções e podem ser aninhados.
- **Uma URL de prévia desde o primeiro dia.** Toda página de status ganha um link de prévia para você olhá-la antes de existir um domínio personalizado.
- **As rotas voltadas ao visitante dependem das configurações.** Incidentes, comunicados, eventos agendados e a página de inscrição só aparecem quando a chave correspondente está ativada em **Configurações avançadas**.
- **Três formas de torná-la privada.** Usuários privados, uma senha mestra ou SAML SSO / OIDC — mais uma lista de permissões de IP.
- **Os assinantes são avisados automaticamente.** Assinantes por e-mail, SMS, Slack, Microsoft Teams e webhook podem acompanhar uma página, cada canal atrás da sua própria chave.

## Termos principais

| Termo              | O que significa                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Página de status**   | Uma página pública (ou privada), com sua própria marca, domínios, recursos e assinantes. O modelo `StatusPage`.                    |
| **Recurso**      | Uma linha que os visitantes veem — um monitor ou grupo de monitores exposto na página com um nome de exibição e opções de disponibilidade.                      |
| **Grupo**         | Uma seção nomeada que guarda recursos. Grupos se aninham dentro de outros grupos, e cada nível consolida o status de tudo o que está abaixo dele. |
| **Anúncio**  | Uma mensagem que você publica em uma ou mais páginas de status, com hora de início e hora de término opcional.                                         |
| **Assinante**    | Alguém (ou algo) que acompanha a página por e-mail, SMS, Slack, Microsoft Teams ou webhook.                                     |
| **Domínio personalizado** | Um domínio seu — `status.example.com` — apontado para a página com um CNAME e um certificado SSL.                                 |
| **Usuário privado**  | Uma conta que consegue entrar em uma página de status privada. Separada dos usuários do seu projeto no OneUptime.                                    |

## Criar uma página de status

1. Abra **Páginas de status → Todas as páginas de status** e clique em **Criar página de status**.
2. No modal **Create New Status Page**, preencha **Nome** (obrigatório, com pelo menos dois caracteres) e, se quiser, **Descrição**.
3. Clique em **Criar página de status**.

É esse o formulário de criação inteiro. A lista para a qual você volta mostra **Nome**, **Descrição**, **Rótulos** e **Proprietários**, e pode ser filtrada por **ID da página de status**, **Nome** e **Descrição**.

Abra a página nova e você cai na tela **Visão geral** dela, que traz dois cartões: **Status Page Preview URL**, com um link para a própria página, e **Detalhes da página de status**, onde você edita o nome, a descrição e os rótulos que acabou de definir.

Em seguida, mais ou menos em ordem de utilidade:

- Adicione recursos para que a página tenha algo nela — veja [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups).
- Defina título, favicon, logotipo e capa da página e depois anexe um domínio personalizado — veja [Marca e domínios da página de status](/docs/status-pages/branding-and-domains).
- Decida em quais canais as pessoas podem se inscrever — veja [Assinantes e comunicados](/docs/status-pages/subscribers).
- Ajuste o que aparece na página em **Configurações avançadas**.

## Onde fica cada coisa

Com uma página de status aberta, o menu lateral dela se divide em nove seções. Use isto como mapa para o resto deste grupo de documentação.

| Seção               | O que tem nela                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Básico**             | **Visão geral**, **Anúncios**, **Proprietários**.                                                                                   |
| **Recursos**         | Uma única tela **Recursos** — grupos à esquerda, os monitores do grupo selecionado à direita.                                                |
| **Assinantes**       | **Assinantes de e-mail**, **Assinantes de SMS**, **Assinantes do Slack**, **Assinantes do MS Teams**, **Assinantes de webhook**, **Configurações de assinantes**. |
| **Logs de notificação** | **Logs de notificação** — o que foi enviado aos assinantes.                                                                                          |
| **Auditoria**             | **Registros de auditoria**.                                                                                                                                |
| **Marca**          | **Marca essencial**, **HTML, CSS e JavaScript**, **Domínios personalizados**, **Cabeçalho**, **Rodapé**, **Página de visão geral**, **Idiomas**.              |
| **Segurança**          | **Usuários privados**, **SSO**, **OIDC**, **SCIM**, **Configurações de autenticação**.                                                                   |
| **IA**                | **MCP**.                                                                                                                                       |
| **Avançado**          | **Monitor Rules**, **Status incorporado**, **Relatórios**, **Campos personalizados**, **Configurações avançadas**, **Excluir página de status**.                         |

Duas peculiaridades de nome que vale conhecer antes de sair procurando:

- O item **Recursos** só se chama **Recursos** quando o projeto tem grupos de monitores habilitados. Caso contrário, ele aparece como **Monitores**. É a mesma tela dos dois jeitos.
- Não existe uma tela de Grupos separada. Grupos e recursos foram unificados, e a antiga rota `/groups` agora redireciona para a tela de recursos.

Fora de uma página individual, a própria seção **Páginas de status** tem uma seção **Mais** com **Anúncios**, e uma seção **Configurações** recolhida que guarda **Modelos de anúncios**, **Modelos de assinantes**, **Campos personalizados**, **Regras de proprietário** e **Regras de Rótulos** — todos com escopo de projeto, compartilhados por todas as páginas de status.

## O que os visitantes veem

A página pública é um aplicativo próprio, com um pequeno conjunto de rotas:

- `/` — a **Visão geral**.
- `/incidents` e `/incidents/:id` — a lista de incidentes e um incidente específico.
- `/announcements` e `/announcements/:id`.
- `/scheduled-events` e `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — o feed.
- `/login`, `/sso` e `/master-password` — só relevantes em uma página privada.

A barra de navegação do topo sempre mostra **Visão geral**; o resto só aparece quando está habilitado. **Incidentes**, **Anúncios** e **Eventos agendados** precisam de suas respectivas chaves ativadas; **Inscrever-se** precisa de **Mostrar página de assinantes** e de pelo menos um canal de assinatura habilitado. Uma página privada ganha ainda um item **Sair**.

### A página de visão geral

A visão geral é a página que a maioria dos visitantes vê. De cima para baixo, ela renderiza:

1. **Os comunicados ativos** — comunicados cuja hora de início já passou e cuja hora de término ainda não chegou.
2. **Uma faixa de status geral** — uma única linha resumindo se todos ou apenas alguns recursos estão afetados.
3. **Um percentual geral de disponibilidade**, se você tiver ativado. Desativado por padrão.
4. **Os grupos de recursos**, cada um com seus recursos, o status atual deles e suas barras de histórico de disponibilidade.
5. **Incidentes ativos**.
6. **Eventos de manutenção agendada**.

Uma página recém-criada, ainda sem nada, mostra um estado vazio dizendo para você adicionar recursos pelo painel — o que é a sua deixa para ir à tela **Recursos**.

Para entender o que coloca um incidente nessa página e o que o tira de lá, veja [Estados e severidades de incidentes](/docs/incidents/states-and-severities).

## Escolher o que aparece na página

A maioria das chaves de exibição fica em um só lugar: **Páginas de status → sua página → Avançado → Configurações avançadas**. Cada cartão tem seu próprio botão **Edit Settings**.

**Configurações de Incidente**:

- **Mostrar incidentes** (`showIncidentsOnStatusPage`) — ativado por padrão. Desativar também remove o item **Incidentes** da navegação.
- **Mostrar histórico de incidentes (em dias)** (`showIncidentHistoryInDays`) — até onde a lista de incidentes volta no tempo. O padrão é 14.
- **Mostrar rótulos de incidentes** (`showIncidentLabelsOnStatusPage`) — desativado por padrão.

**Configurações do episódio** — as mesmas três chaves para episódios de incidente: **Mostrar episódios** (`showEpisodesOnStatusPage`, ativado por padrão), **Mostrar histórico de episódios (em dias)** (padrão 14) e **Mostrar rótulos de episódios** (desativado por padrão). Episódios são um modelo próprio, com endpoints próprios, e não uma visão dos incidentes.

**Configurações do anúncio**:

- **Mostrar anúncios** (`showAnnouncementsOnStatusPage`) — ativado por padrão.
- **Mostrar histórico de anúncios (em dias)** (`showAnnouncementHistoryInDays`) — padrão 14.

**Configurações de evento agendado**:

- **Mostrar eventos de manutenção programada** (`showScheduledMaintenanceEventsOnStatusPage`) — ativado por padrão.
- **Mostrar histórico de eventos agendados (em dias)** (`showScheduledEventHistoryInDays`) — padrão 14.
- **Mostrar rótulos de eventos** (`showScheduledEventLabelsOnStatusPage`) — desativado por padrão.

**Configurações do Histórico de Disponibilidade**:

- **Mostrar histórico de tempo de atividade (em dias)** (`showUptimeHistoryInDays`) — o comprimento da barra de disponibilidade ao lado de cada recurso. O padrão é 90 e o valor precisa ficar entre 1 e 90. Toda opção **Mostrar % de tempo de atividade** e **Mostrar gráfico de histórico de status** de um recurso ou grupo lê esse número.

**Configurações de assinantes**:

- **Mostrar página de assinantes** (`showSubscriberPageOnStatusPage`) — ativado por padrão, mais as cinco chaves de habilitação por canal. As mesmas chaves de canal também aparecem na tela dedicada **Configurações de assinantes**, dentro da seção **Assinantes**; trate essa como o lugar canônico para defini-las.

**Marca "Powered By OneUptime"**:

- **Ocultar a marca Powered By OneUptime** — desativada por padrão, então o rodapé do visitante diz "Desenvolvido por OneUptime" até você ativá-la.

**Onde estão as cores.** As cores da barra de disponibilidade não estão aqui — a **Cor Padrão da Barra**, as regras de cor de barra, os **Status de monitor de indisponibilidade** e **Mostrar percentual geral de tempo de atividade** ficam todos em **Páginas de status → sua página → Marca → Página de visão geral**. Não existe configuração de tema ou de cor de marca em lugar nenhum; qualquer coisa além desses controles se faz com **CSS Personalizado**.

## Ver como ficou antes de publicar

A tela **Visão geral** de toda página de status traz um cartão **Status Page Preview URL** com um link direto para a página. Use-o enquanto ainda estiver adicionando recursos e antes de existir qualquer domínio personalizado.

Nos bastidores, toda rota pública tem uma gêmea de prévia em `/status-page/{statusPageId}/...` — uma visão geral de prévia, uma lista de incidentes de prévia, uma página de inscrição de prévia e assim por diante. Ou seja: uma URL ou captura de tela tirada da prévia do painel não vai corresponder ao que o cliente vê depois que um domínio personalizado é anexado, então confira duas vezes qualquer link que você colar em um runbook ou em um e-mail.

## Restringir quem pode ver a página

Nem toda página de status é para o público. Todos os controles ficam na seção **Segurança**.

### Usuários privados

Desative **Está Visível ao Público** em **Páginas de status → sua página → Segurança → Configurações de autenticação** (a coluna `isPublicStatusPage`). Os visitantes passam então a cair em `/login` e precisam entrar.

Adicione quem pode entrar em **Páginas de status → sua página → Segurança → Usuários privados**. Há uma ação **Adicionar em massa** — cole uma lista de endereços de e-mail e cada um recebe um convite. Usuários privados têm seu próprio fluxo de esqueci a senha e de redefinição, separado das contas do seu projeto no OneUptime.

### Senha mestra

**Configurações de autenticação** também tem um cartão **Senha mestra**, com uma chave **Exigir Senha Mestra** e a senha em si. Os visitantes então caem em `/master-password` e destravam a página com um único segredo compartilhado.

**Senha mestra e usuários privados não se somam.** Enquanto a senha mestra está ativa, a autenticação por usuário privado fica desativada, e a tela **Usuários privados** mostra um aviso dizendo isso.

### SSO e OIDC

Para uma página privada ligada ao seu provedor de identidade, **Páginas de status → sua página → Segurança → SSO** configura o SAML (URL de login, issuer, certificado x509, métodos de assinatura e de digest) e **Páginas de status → sua página → Segurança → OIDC** configura o OpenID Connect (URL de descoberta, issuer, client ID e secret, escopos, nomes de claims). O **SCIM** provisiona usuários privados a partir do IdP automaticamente. Isso depende de um recurso do plano, então pode não estar disponível em toda instalação.

Um cartão **Configurações de SSO** expõe **Forçar SSO para login** (`requireSsoForLogin`, desativado por padrão). Teste sua configuração de SSO antes de ativá-lo — se não funcionar, você se tranca para fora da própria página de status.

### Lista de permissões de IP

**Configurações de autenticação** também traz um cartão **Lista de permissões de IP**, apoiado na coluna `ipWhitelist`, para páginas que só devem responder a redes conhecidas.

## O selo incorporável e o feed RSS

Duas formas de mostrar o status em algum lugar que não seja a própria página.

**Selo de status incorporado.** Ative **Habilitar selo de status incorporado** (`enableEmbeddedOverallStatus`, desativado por padrão) no cartão **Selo de status incorporado** em **Páginas de status → sua página → Avançado → Status incorporado**. Ele vem acompanhado de um `embeddedOverallStatusToken` e serve o selo a partir de `/badge/:statusPageId`, para você jogar o status geral atual na sua documentação, no rodapé do seu app ou em uma página de marketing.

**Feed RSS.** Toda página de status serve `/rss` — um feed com o título "{nome da página de status} Updates", cujos itens vêm prefixados por `Incident: `, `Announcement: ` e `Scheduled Maintenance: `. Prático para quem prefere jogar suas atualizações em um leitor ou em um bot de chat a se inscrever por e-mail.

Se você preferir buscar os dados por conta própria, a página de status é apoiada por endpoints públicos de leitura para a visão geral, os incidentes, os eventos de manutenção agendada, os comunicados e os episódios — veja [API pública](/docs/status-pages/public-api).

## Onde ler a seguir

- [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups) — colocar monitores na página e organizá-los em seções.
- [Marca e domínios da página de status](/docs/status-pages/branding-and-domains) — logotipo, favicon, rodapé, código personalizado e como apontar seu próprio domínio para a página.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — os cinco canais de assinatura, o duplo opt-in e a publicação de comunicados.
- [API pública](/docs/status-pages/public-api) — ler os dados da página de status de forma programática.
- [Visão geral dos incidentes](/docs/incidents/index) — os eventos que aparecem na página.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — o que faz um incidente aparecer em uma página de status e o que o tira de lá.
