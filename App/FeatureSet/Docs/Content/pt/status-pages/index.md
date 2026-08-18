# Visão geral das páginas de status

Uma página de status é a face pública de tudo o que você monitora: uma URL que seus clientes podem abrir em vez de mandar e-mail perguntando se é só com eles. Ela mostra o estado atual dos serviços que você escolhe expor, os incidentes em que você está trabalhando, a manutenção que você tem planejada e qualquer anúncio que você queira fixar no topo.

Quando algo quebra às 2 da manhã, a página de status é a primeira coisa que sua fila de suporte linka. Ela também é de onde seus assinantes são notificados — então vale configurá-la antes de precisar dela, e não durante a interrupção.

Páginas de status ficam em **Páginas de status** na navegação à esquerda do painel, no grupo **essentials**. Tudo nesta página é por página de status: um projeto pode rodar quantas quiser — uma pública para clientes, uma privada para um público interno, uma por região para um mercado específico.

## Em resumo

- **Criada com dois campos.** Uma nova página de status pede apenas **Nome** e **Descrição**. Recursos, marca e domínios são todos configurados depois.
- **Recursos são o que os visitantes veem.** Cada linha na página é uma **Página de status Recurso** — um monitor (ou grupo de monitores) com seu próprio nome de exibição, dica e opções de disponibilidade. Grupos dividem uma página longa em seções e podem ser aninhados.
- **Uma URL de prévia desde o primeiro dia.** Toda página de status ganha um link de prévia para você olhá-la antes que exista um domínio personalizado.
- **Rotas voltadas ao visitante são controladas por configurações.** Incidentes, anúncios, eventos agendados e a página de inscrição aparecem cada um apenas quando sua chave em **Configurações avançadas** está ativada.
- **Três maneiras de torná-la privada.** Usuários privados, uma senha mestra ou SAML SSO / OIDC — mais uma lista de permissões de IP.
- **Assinantes são avisados automaticamente.** Assinantes por e-mail, SMS, Slack, Microsoft Teams e webhook podem todos seguir uma página, cada canal atrás de sua própria chave.

## Termos-chave

| Termo                       | O que significa                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Página de status**        | Uma página pública (ou privada), com sua própria marca, domínios, recursos e assinantes. O modelo `StatusPage`.                      |
| **Recurso**                 | Uma linha que os visitantes veem — um monitor ou grupo de monitores exposto na página com um nome de exibição e opções de disponibilidade. |
| **Grupo**                   | Uma seção nomeada que contém recursos. Grupos se aninham dentro de outros grupos, e cada nível consolida o status de tudo abaixo dele. |
| **Anúncio**                 | Uma mensagem que você publica em uma ou mais páginas de status, com uma hora de início e uma hora de fim opcional.                   |
| **Assinante**               | Alguém (ou algo) que segue a página por e-mail, SMS, Slack, Microsoft Teams ou um webhook.                                           |
| **Domínio personalizado**   | Um domínio seu — `status.example.com` — apontado para a página com um CNAME e um certificado SSL.                                    |
| **Usuário privado**         | Uma conta que pode entrar em uma página de status privada. Separada dos usuários do seu projeto OneUptime.                           |

## Criar uma página de status

1. Abra **Páginas de status → Todas as páginas de status** e clique em **Criar página de status**.
2. No modal **Create New Status Page**, preencha **Nome** (obrigatório, com pelo menos dois caracteres) e, opcionalmente, **Descrição**.
3. Clique em **Criar página de status**.

Esse é todo o formulário de criação. A lista para a qual você volta mostra **Nome**, **Descrição**, **Rótulos** e **Proprietários**, e pode ser filtrada por **ID da página de status**, **Nome** e **Descrição**.

Abra a nova página e você aterrissa na tela **Visão geral**, que traz dois cartões: **Status Page Preview URL** com um link para a própria página, e **Detalhes da página de status** onde você pode editar o nome, a descrição e os rótulos que acabou de definir.

Em seguida, em ordem aproximada de utilidade:

- Adicione recursos para que a página tenha algo nela — veja [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups).
- Defina o título da página, o favicon, o logotipo e a capa, depois anexe um domínio personalizado — veja [Marca e domínios da página de status](/docs/status-pages/branding-and-domains).
- Decida em quais canais as pessoas podem se inscrever — veja [Assinantes e comunicados](/docs/status-pages/subscribers).
- Ajuste o que aparece na página em **Configurações avançadas**.

## Onde fica cada coisa

Uma vez que uma página de status está aberta, seu próprio menu lateral esquerdo é agrupado em nove seções. Use isto como mapa para o resto deste grupo de documentação.

| Seção                     | O que tem nela                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Básico**                | **Visão geral**, **Anúncios**, **Proprietários**.                                                                                                 |
| **Recursos**              | Uma única tela **Recursos** — grupos à esquerda, os monitores do grupo selecionado à direita.                                                      |
| **Assinantes**            | **Assinantes de e-mail**, **Assinantes de SMS**, **Assinantes do Slack**, **Assinantes do MS Teams**, **Assinantes de webhook**, **Configurações de assinantes**. |
| **Logs de notificação**   | **Logs de notificação** — o que foi enviado aos assinantes.                                                                                       |
| **Auditoria**             | **Registros de auditoria**.                                                                                                                       |
| **Marca**                 | **Marca essencial**, **HTML, CSS e JavaScript**, **Domínios personalizados**, **Cabeçalho**, **Rodapé**, **Página de visão geral**, **Idiomas**.   |
| **Segurança**             | **Usuários privados**, **SSO**, **OIDC**, **SCIM**, **Configurações de autenticação**.                                                            |
| **IA**                    | **MCP**.                                                                                                                                          |
| **Avançado**              | **Monitor Rules**, **Status incorporado**, **Relatórios**, **Campos personalizados**, **Configurações avançadas**, **Excluir página de status**.   |

Duas peculiaridades de nomenclatura que vale conhecer antes de sair procurando:

- O item **Recursos** só é rotulado **Recursos** quando o projeto tem grupos de monitores habilitados. Caso contrário ele diz **Monitores**. É a mesma tela de qualquer forma.
- Não há uma página de Grupos separada. Grupos e recursos foram mesclados, e a antiga rota `/groups` agora redireciona para a tela de recursos.

Fora de uma página individual, a própria seção **Páginas de status** tem uma seção **Mais** com **Anúncios**, e uma seção **Configurações** recolhida contendo **Modelos de anúncios**, **Modelos de assinantes**, **Campos personalizados**, **Regras de proprietário** e **Regras de Rótulos** — essas são de todo o projeto, compartilhadas por todas as páginas de status.

## O que os visitantes veem

A página pública é seu próprio aplicativo, com um pequeno conjunto de rotas:

- `/` — a **Visão geral**.
- `/incidents` e `/incidents/:id` — a lista de incidentes e um incidente individual.
- `/announcements` e `/announcements/:id`.
- `/scheduled-events` e `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — o feed.
- `/login`, `/sso` e `/master-password` — relevantes apenas em uma página privada.

A barra de navegação superior sempre mostra **Visão geral**; o resto aparece apenas quando habilitado. **Incidentes**, **Anúncios** e **Eventos programados** precisam cada um de sua chave ativada; **Subscribe** precisa tanto de **Mostrar página de assinantes** quanto de pelo menos um canal de assinantes habilitado. Uma página privada também ganha um item **Sair**.

### A página de visão geral

A visão geral é a página que a maioria dos visitantes chega a ver. De cima para baixo, ela renderiza:

1. **Quaisquer anúncios ativos** — anúncios cuja hora de início já passou e cuja hora de fim ainda não chegou.
2. **Um banner de status geral** — uma única linha resumindo se todos ou apenas alguns recursos estão afetados.
3. **Um percentual de disponibilidade geral**, se você o ativou. Desativado por padrão.
4. **Os grupos de recursos**, cada um com seus recursos, seu status atual e suas barras de histórico de disponibilidade.
5. **Incidentes ativos**.
6. **Agendado Manutenção Eventos**.

Uma página novinha, sem nada nela, mostra um estado vazio dizendo para você adicionar recursos a partir do painel — o que é a sua deixa para ir à tela **Recursos**.

Para saber o que coloca um incidente nesta página em primeiro lugar, e o que o tira de novo, veja [Estados e severidades de incidentes](/docs/incidents/states-and-severities).

## Escolher o que aparece na página

A maioria das chaves de exibição fica em um só lugar: **Páginas de status → sua página → Avançado → Configurações avançadas**. Cada cartão tem seu próprio botão **Edit Settings**.

**Configurações de Incidente**:

- **Mostrar incidentes** (`showIncidentsOnStatusPage`) — ativado por padrão. Desativá-lo também remove o item de navegação **Incidentes**.
- **Mostrar histórico de incidentes (em dias)** (`showIncidentHistoryInDays`) — até onde a lista de incidentes alcança. Padrão 14.
- **Mostrar rótulos de incidentes** (`showIncidentLabelsOnStatusPage`) — desativado por padrão.

**Configurações do episódio** — as mesmas três chaves para episódios de incidente: **Mostrar episódios** (`showEpisodesOnStatusPage`, ativado por padrão), **Mostrar histórico de episódios (em dias)** (padrão 14) e **Mostrar rótulos de episódios** (desativado por padrão). Episódios são seu próprio modelo com seus próprios endpoints, não uma visão de incidentes.

**Configurações do anúncio**:

- **Mostrar anúncios** (`showAnnouncementsOnStatusPage`) — ativado por padrão.
- **Mostrar histórico de anúncios (em dias)** (`showAnnouncementHistoryInDays`) — padrão 14.

**Configurações de evento agendado**:

- **Mostrar eventos de manutenção programada** (`showScheduledMaintenanceEventsOnStatusPage`) — ativado por padrão.
- **Mostrar histórico de eventos agendados (em dias)** (`showScheduledEventHistoryInDays`) — padrão 14.
- **Mostrar rótulos de eventos** (`showScheduledEventLabelsOnStatusPage`) — desativado por padrão.

**Configurações do Histórico de Disponibilidade**:

- **Mostrar histórico de tempo de atividade (em dias)** (`showUptimeHistoryInDays`) — o comprimento da barra de disponibilidade ao lado de cada recurso. Padrão 90 e precisa estar entre 1 e 90. Todas as opções **Mostrar % de tempo de atividade** e **Mostrar gráfico de histórico de status** em um recurso ou grupo leem este número.

**Configurações de assinantes**:

- **Mostrar página de assinantes** (`showSubscriberPageOnStatusPage`) — ativado por padrão, mais as cinco chaves de habilitação por canal. As mesmas chaves de canal também aparecem na tela dedicada **Configurações de assinantes**, na seção **Assinantes**; trate essa como o lugar canônico para defini-las.

**Marca "Powered By OneUptime"**:

- **Ocultar a marca Powered By OneUptime** — desativado por padrão, então o rodapé do visitante diz "Powered by OneUptime" até você ativá-lo.

**Onde estão as cores.** As cores da barra de disponibilidade não estão aqui — a **Cor Padrão da Barra**, as regras de cor de barra, os **Status de monitor de indisponibilidade** e **Mostrar percentual geral de tempo de atividade** ficam todos em **Páginas de status → sua página → Marca → Página de visão geral**. Não há configuração de tema ou de cor de marca em lugar nenhum; qualquer coisa além desses controles é feita com **CSS Personalizado**.

## Pré-visualizar antes de entrar no ar

A tela **Visão geral** de toda página de status traz um cartão **Status Page Preview URL** com um link direto para a página. Use-o enquanto ainda estiver adicionando recursos e antes que exista qualquer domínio personalizado.

Nos bastidores, toda rota pública tem uma gêmea de prévia em `/status-page/{statusPageId}/...` — uma visão geral de prévia, uma lista de incidentes de prévia, uma página de inscrição de prévia e assim por diante. Isso significa que uma URL ou captura de tela tirada da prévia do painel não vai corresponder ao que um cliente vê quando um domínio personalizado estiver anexado, então confira duas vezes qualquer link que você colar em um runbook ou em um e-mail.

## Restringir quem pode ver a página

Nem toda página de status é para o público. Todos os controles ficam na seção **Segurança**.

### Usuários privados

Desative **Está Visível ao Público** em **Páginas de status → sua página → Segurança → Configurações de autenticação** (a coluna `isPublicStatusPage`). Os visitantes então caem em `/login` e precisam entrar.

Adicione as pessoas que podem entrar em **Páginas de status → sua página → Segurança → Usuários privados**. Há uma ação **Adicionar em massa** — cole uma lista de endereços de e-mail e cada um recebe um e-mail de convite. Usuários privados têm seus próprios fluxos de esqueci a senha e redefinir senha, separados das suas contas do projeto OneUptime.

### Senha mestra

**Configurações de autenticação** também tem um cartão **Senha mestra** com uma chave **Exigir Senha Mestra** e a própria senha. Os visitantes então caem em `/master-password` e desbloqueiam a página com um único segredo compartilhado.

**Senha mestra e usuários privados não se somam.** Enquanto a senha mestra está ativa, a autenticação por usuário privado é desabilitada, e a tela **Usuários privados** mostra um aviso dizendo isso.

### SSO e OIDC

Para uma página privada ligada ao seu provedor de identidade, **Páginas de status → sua página → Segurança → SSO** configura SAML (URL de login, emissor, certificado x509, métodos de assinatura e digest) e **Páginas de status → sua página → Segurança → OIDC** configura OpenID Connect (URL de descoberta, emissor, ID e segredo do cliente, escopos, nomes de claims). **SCIM** provisiona usuários privados a partir do IdP automaticamente. Esses recursos são controlados por um recurso de plano, então podem não estar disponíveis em toda instalação.

Um cartão **Configurações de SSO** expõe **Forçar SSO para login** (`requireSsoForLogin`, desativado por padrão). Teste sua configuração de SSO antes de ativá-lo — se não funcionar, você vai se trancar para fora da página de status.

### Lista de permissões de IP

**Configurações de autenticação** também carrega um cartão **Lista de permissões de IP**, sustentado pela coluna `ipWhitelist`, para páginas que só devem responder a partir de redes conhecidas.

## O selo incorporável e o feed RSS

Duas maneiras de expor o status em algum lugar que não seja a própria página.

**Selo de status incorporado.** Ative **Habilitar selo de status incorporado** (`enableEmbeddedOverallStatus`, desativado por padrão) no cartão **Selo de status incorporado** em **Páginas de status → sua página → Avançado → Status incorporado**. Ele funciona junto com um `embeddedOverallStatusToken` e serve o selo a partir de `/badge/:statusPageId`, para que você possa colocar o status geral atual na sua documentação, no rodapé do seu aplicativo ou em uma página de marketing.

**Feed RSS.** Toda página de status serve `/rss` — um feed intitulado "{status page name} Updates" cujos itens são prefixados com `Incident: `, `Announcement: ` e `Scheduled Maintenance: `. Útil para quem prefere canalizar suas atualizações para um leitor ou um bot de chat em vez de assinar por e-mail.

Se você preferir puxar os dados por conta própria, a página de status é sustentada por endpoints públicos de leitura para a visão geral, incidentes, eventos de manutenção agendada, anúncios e episódios — veja [API pública](/docs/status-pages/public-api).

## Onde ler a seguir

- [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups) — colocar monitores na página e organizá-los em seções.
- [Marca e domínios da página de status](/docs/status-pages/branding-and-domains) — logotipo, favicon, rodapé, código personalizado e apontar seu próprio domínio para a página.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — os cinco canais de assinantes, o duplo opt-in e a publicação de anúncios.
- [API pública](/docs/status-pages/public-api) — ler dados da página de status programaticamente.
- [Visão geral dos incidentes](/docs/incidents/index) — os eventos que aparecem na página.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — o que faz um incidente aparecer em uma página de status e o que o tira dela.
