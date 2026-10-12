# Feeds de calendário

Os feeds de calendário levam seus turnos de plantão para o calendário que você já usa. O OneUptime publica um link iCalendar (`.ics`) secreto para cada pessoa, cada agendamento e cada projeto; o Google Agenda, o Outlook, o Calendário da Apple, o Thunderbird e qualquer outro app que assine um calendário por URL consultam esse link e mostram um evento por turno. Nada é instalado e nenhuma conta é conectada: o link é toda a integração.

```mermaid title="Apps de calendário consultam um link secreto; alguns a partir dos próprios servidores"
flowchart TB
    subgraph links["Links .ics secretos"]
        direction LR
        personal["Feed pessoal"]
        schedule["Feed do agendamento"]
        project["Feed do projeto"]
    end
    shifts["Agendamentos, rotações<br/>e substituições"] --> links
    links -->|"lidos dos servidores deles"| serverApps["Google Agenda, Outlook na web"]
    links -->|"lidos do seu dispositivo"| deviceApps["Calendário da Apple, Thunderbird, Outlook clássico"]
```

> [!NOTE]
> Um calendário assinado serve para **planejar**. Os apps de calendário releem os feeds no próprio ritmo — o Google Agenda só a cada 8 a 24 horas —, então uma troca feita uma hora antes de um turno chega até você pelos lembretes, avisos de reatribuição e acionamentos do próprio OneUptime, não pelo calendário.

## O que você recebe

- Um evento por turno, com o título `On-call · <Schedule>` (com ` · <Policy>` acrescentado quando o agendamento está ligado a exatamente uma política de escalonamento) no feed pessoal e `<Name> · On-call · <Schedule>` em um feed compartilhado. A descrição mostra quem está de plantão, o agendamento e o fuso horário dele, a camada, o turno no fuso do agendamento, em UTC e no seu fuso, quais políticas de escalonamento acionam você por meio deste agendamento e um link para o agendamento no painel.
- As substituições são respeitadas. Quando alguém cobre você, o evento passa para essa pessoa (`(covering for <Name>)` é acrescentado) e continua sendo o mesmo evento no seu app de calendário, então é atualizado no lugar em vez de duplicado. Uma substituição parcial divide o turno em eventos contíguos.
- Dois dias de histórico e 90 dias à frente por padrão. Você pode ampliar para 60 dias para trás e 180 para frente; um feed que passaria de 5.000 eventos é encurtado e avisa isso na descrição do calendário.
- Os eventos são marcados como livres (`TRANSP:TRANSPARENT`), então um feed assinado nunca bloqueia sua disponibilidade, e nada é marcado como privado, então um calendário de equipe compartilhado mostra os títulos para todos que podem vê-lo.
- Os horários são enviados em UTC e convertidos pelo seu app de calendário; a descrição traz o horário local no fuso do agendamento e no seu. Defina o seu fuso como **Fuso horário** no seu **Perfil** (sua foto no canto superior direito do painel), e o do agendamento no cartão **Schedule timezone** da página **Camadas** dele. Um agendamento sem fuso horário é calculado no fuso do servidor, como nos acionamentos, e o evento avisa isso.

Atribuições fixas — um usuário ou uma equipe citado diretamente em uma regra de política de escalonamento — não têm início nem fim e não aparecem em nenhum feed. No OneUptime Cloud, os feeds seguem o mesmo plano dos agendamentos de plantão (Growth); um projeto abaixo desse plano recebe um calendário vazio em vez de um erro.

## Três tipos de link

| Link | Quem cria | O que contém | Onde |
| --- | --- | --- | --- |
| **Feed pessoal** | Cada usuário, um por projeto | Seus turnos em todos os agendamentos desse projeto, mais os turnos em que você cobre alguém (opcional) | **Configurações do usuário** > **Calendário** > **Feed de calendário** |
| **Feed do agendamento** | Quem pode editar o agendamento; quem pode lê-lo pode copiar o link | Os turnos de todos em um agendamento, com eventos opcionais de lacunas de cobertura | A página do agendamento, cartão **Subscrever esta escala** |
| **Feed do projeto** | Quem pode editar agendamentos de plantão; quem pode lê-los pode copiar o link | Os turnos de todos em todos os agendamentos do projeto, com eventos opcionais de lacunas de cobertura | **Plantão** > **Feeds de calendário** |

Os links são assim:

```text
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

> [!WARNING]
> O token de 43 caracteres no caminho é a única credencial — não há login, cookie nem chave de API. Trate cada um desses links como uma senha.

## Seu feed pessoal

Os feeds pessoais são por projeto: um segundo projeto tem um segundo link e um segundo calendário.

:::steps
### Abra seu feed de calendário

Abra **Configurações do usuário** > **Calendário** > **Feed de calendário** no projeto cujos turnos você quer. **Calendário** é uma seção do menu lateral que começa recolhida.

### Gere o link

Clique em **Gerar link do calendário**. O cartão **Subscrever os seus turnos de prevenção** agora oferece um único fluxo de assinatura:

- **Adicionar ao seu calendário**: **Google Agenda** abre o Google Agenda, que pergunta se deve adicionar o calendário. **Calendário da Apple / Outlook** abre a forma `webcal://` do link no app com que seu computador ou celular assina: o Calendário da Apple no Mac, iPhone ou iPad, o Outlook no Windows.
- **Ou copie o link**: **Copiar link** copia o link `https://` para qualquer outro app que assine um calendário por URL. O link fica oculto na página até você clicar para mostrá-lo.

### Assine o link

Siga os passos do seu app em "Assine no seu app de calendário", abaixo. Seus turnos aparecem como eventos na próxima vez que o app ler o link: veja "Com que frequência os calendários atualizam".
:::

### Configurações do feed

Clique em **Editar definições** no cartão **Definições do feed de calendário** para mudar o que o link inclui:

| Configuração | O que faz |
| --- | --- |
| **Incluir turnos que cubro por outros** | Ligada por padrão. Acrescenta os turnos que uma substituição dá a você em agendamentos dos quais você não é membro de outra forma. |
| **Dias de turnos passados** | Até onde o calendário volta (2 por padrão, no máximo 60). |
| **Dias futuros** | Até onde o calendário vai à frente (90 por padrão, entre 7 e 180). |

A linha de status mostra quando o link foi lido pela última vez, por qual app de calendário, quantas vezes, e os quatro últimos caracteres do token para você distinguir os links. Se nada tiver lido o link depois de dois dias, a página pergunta se o servidor está acessível pela internet (veja Solução de problemas).

### Gerencie o link

| Ação | O que acontece |
| --- | --- |
| **Regenerar link** | Cria um token novo. Todo app que assinou o link antigo para de atualizar: por 30 dias o link antigo serve um calendário vazio para que esses apps esvaziem a cópia deles; depois responde 404. Assine de novo com o link novo. |
| **Desativar** | Mantém o link, mas serve um calendário vazio até você reativá-lo. |
| **Excluir** | Remove o link. Os apps que ainda o consultam recebem 404 e continuam mostrando o que leram por último — desative antes se quiser que eles se esvaziem. |

### Próximos turnos e cobertura

A página também lista seus **Upcoming shifts** (os próximos 30 dias) e o cartão **Lembrar-me antes dos turnos**, descrito mais abaixo. Cada um dos seus turnos tem um link **Obter cobertura**: ele abre as substituições de usuário no projeto do turno com uma nova substituição já preenchida para esse turno, você como **Quem está ausente?** e os horários do turno como **Começa** e **Termina** (a partir de agora, se o turno já começou), então só falta **Quem cobre?**. A substituição envia todos os seus acionamentos desses horários para quem cobre você, a partir de todas as políticas de plantão; um turno que só existe dentro de uma política é coberto na página de substituições de usuário dessa política. Um turno em que você cobre outra pessoa não tem **Obter cobertura**: as substituições não se encadeiam, então cobrir uma cobertura não mudaria nada.

O mesmo link pessoal, filtrado para um agendamento com `?schedule=<id>`, é oferecido como **Apenas os meus turnos nesta escala** na página de cada agendamento, e o banner de plantão e a página **Minhas Políticas de Plantão** trazem um link **Adicionar os seus turnos ao seu calendário** para a página acima.

### No app para celular

No app para celular: **On-Call** > **Add shifts to my calendar** (também em **Settings** > **Calendar feed**), com um link por projeto. No iPhone, **Open in Calendar** abre a tela de assinatura nativa. No Android não há como assinar uma URL no celular, então a tela oferece **Share link** e **Copy https link** e pede que você adicione o link em um computador; depois ele sincroniza com o celular. A lista **Your shifts** do app vem dos mesmos dados e tem a mesma ação **Get cover**.

## Assine no seu app de calendário

Use **Google Agenda** ou **Calendário da Apple / Outlook** no OneUptime quando o seu app tiver um botão; qualquer outro app usa o link `https://` que **Copiar link** dá. "Links https e webcal", abaixo, explica as duas formas.

:::tabs
@tab Google Agenda
1. Clique em **Google Agenda** no OneUptime. O Google Agenda abre e pergunta se deve adicionar o calendário; clique em **Adicionar**.
2. Ou, no Google Agenda na web, ao lado de **Outras agendas**, clique em **+** > **Do URL**, cole o link (**Copiar link** no OneUptime) e clique em **Adicionar agenda**.

O botão **Google Agenda** abre a página do Google para adicionar por URL, `https://calendar.google.com/calendar/r?cid=` seguido da forma `webcal://` do link, codificada com porcentagem. Essa página só aceita a forma `webcal://`: com a forma `https://`, o Google responde "Unable to add calendar. Check the URL.". **Do URL** aceita as duas formas.

O Google lê o feed **dos servidores do Google**, então o servidor do OneUptime precisa estar acessível pela internet — o OneUptime Cloud sempre está; para uma instalação auto-hospedada, veja Solução de problemas. A primeira leitura costuma acontecer poucos minutos depois da assinatura; depois o Google atualiza mais ou menos a cada 8 a 24 horas, às vezes mais. Não há botão de atualizar para calendários assinados, e o Google ignora as dicas de atualização do feed. A linha de status da página do feed mostra **Última obtenção … por Google Calendar** assim que o Google lê o link.

O nome e o fuso horário do calendário são lidos **só na primeira assinatura**: renomear um agendamento depois não renomeia o calendário no Google — remova e adicione de novo se o nome importar. O Google descarta os lembretes contidos em arquivos de calendário, então configure notificações padrão para esse calendário nas configurações do Google ou, melhor, use os lembretes do OneUptime. O Google se lembra de um endereço que não conseguiu ler: depois de corrigir o que o impedia, adicione o link de novo com `?nocache=1` no final (o OneUptime ignora parâmetros de consulta desconhecidos, então o feed não muda) ou regenere o link. O app do Google Agenda no Android e no iOS não assina por URL; adicione o link em um computador e ele aparece no celular.
@tab Outlook na web
1. Abra **Calendário** > **Adicionar calendário** > **Assinar da Web**.
2. Cole o link `https://` (**Copiar link** no OneUptime), dê um nome ao calendário e clique em **Importar**.

Funciona igual no Outlook.com, no Outlook na web para contas corporativas ou de estudante, no novo Outlook para Windows e no Outlook para Mac. O Outlook lê **dos servidores da Microsoft**: mais ou menos a cada 3 horas no Outlook.com e a cada 4 a 6 horas em contas corporativas ou de estudante, às vezes mais de um dia. O intervalo é fixo e não há atualização manual.

Assine aqui em vez de no app para desktop se quiser o calendário também no celular e no Outlook na web — as assinaturas criadas no Outlook clássico para Windows ficam naquele PC.
@tab Outlook clássico para Windows
1. Em um PC com o Outlook instalado, clique em **Calendário da Apple / Outlook** no OneUptime. O Windows passa o link `webcal://` para o Outlook, que pergunta se deve adicionar o calendário da internet. Sem o Outlook, o Windows não tem um manipulador de `webcal`.
2. Ou, no Outlook, abra **Arquivo** > **Configurações de Conta** > **Configurações de Conta** > **Calendários da Internet** > **Novo**, cole o link (**Copiar link** no OneUptime) e clique em **Adicionar**.

**Não** abra o próprio link `https://…/shifts.ics` no Outlook clássico: ele importa um instantâneo único que nunca atualiza. Abrir o link `webcal://`, ou adicionar o endereço em **Calendários da Internet**, cria uma assinatura.

O feed é atualizado a cada **Enviar/Receber** (F9, ou o intervalo dos grupos de envio/recebimento). As configurações da assinatura têm uma caixa **Limite de atualização**: marcada, o Outlook não atualiza mais rápido que o intervalo sugerido pelo publicador. O OneUptime sugere uma hora (`X-PUBLISHED-TTL:PT1H`), então o feed atualiza mais ou menos de hora em hora. Feeds sem essa dica nunca atualizam enquanto a caixa estiver marcada; os do OneUptime têm a dica, então você pode deixar a caixa marcada. O Outlook clássico lê o feed **do seu PC** e valida o certificado do servidor.
@tab Calendário da Apple (macOS)
1. Clique em **Calendário da Apple / Outlook** no OneUptime, ou no Calendário escolha **Arquivo** > **Nova Assinatura de Calendário** e cole o link.
2. Na tela de assinatura, ajuste **Atualizar automaticamente** — a cada 5 minutos, 15 minutos, hora, dia ou semana (de hora em hora por padrão) — e escolha **iCloud** em **Localização** para que o calendário também apareça no seu iPhone e iPad e continue atualizando nesse ritmo.

O macOS lê o feed **do seu Mac**, então funciona com uma instalação em rede privada desde que o Mac consiga alcançá-la. Um certificado autoassinado ou de uma CA interna precisa antes ser marcado como confiável nas Chaves do macOS. **Remover alertas** vem marcado por padrão nessa tela; aqui não faz diferença, porque o feed não traz alarmes.
@tab iPhone e iPad
Para assinar no aparelho, toque em **Open in Calendar** no app para celular do OneUptime, ou vá em **Ajustes** > **Calendário** > **Contas** > **Adicionar Conta** > **Outra** > **Adicionar Calendário Assinado** e cole o link.

As assinaturas criadas no próprio aparelho atualizam conforme **Ajustes** > **Calendário** > **Contas** > **Obter Novos Dados** — **Automaticamente** por padrão, o que lê principalmente enquanto carrega no Wi-Fi. Para uma atualização confiável, assine em um Mac com **iCloud** como localização, ou ajuste **Obter Novos Dados** para um intervalo fixo.
@tab Thunderbird
Escolha **Arquivo** > **Novo** > **Agenda** > **Na rede** > **iCalendar (ICS)**, cole o link `https://` e escolha um intervalo de atualização nas propriedades da agenda: 1, 5, 15, 30 ou 60 minutos. O Thunderbird lê **do seu computador** e precisa confiar no certificado do servidor.
@tab Android
Nem o app do Google Agenda nem o Samsung Calendar assinam uma URL. Adicione o link `https://` ao Google Agenda em um computador (**Outras agendas** > **+** > **Do URL**); o calendário então sincroniza com o celular junto com o resto daquela conta do Google. O app para celular do OneUptime no Android oferece **Share link** e **Copy https link** exatamente para isso.
@tab Outros serviços
O Fastmail atualiza mais ou menos de hora em hora e **desativa uma assinatura depois de cinco leituras com falha seguidas**; se isso acontecer, adicione de novo quando o servidor estiver bem. O Proton Calendar atualiza a cada 4 a 16 horas e recusa feeds muito grandes — reduza **Dias futuros** se ele reclamar. O Confluence Team Calendars aceita o feed do agendamento; o limite de 28 caracteres para nomes de calendário dele é respeitado.
:::

## Com que frequência os calendários atualizam

| App de calendário | Atualização típica | Lê de | Observações |
| --- | --- | --- | --- |
| Google Agenda (Do URL) | 8–24 horas, às vezes mais | Os servidores do Google | Sem atualização manual; ignora as dicas; nome e fuso horário lidos só na primeira assinatura |
| Outlook.com | Cerca de 3 horas | Os servidores da Microsoft | Fixo; pode passar de 24 horas |
| Outlook na web (trabalho, estudante) | Cerca de 4–6 horas | Os servidores da Microsoft | Fixo; sem controle do usuário |
| Outlook clássico para Windows | A cada Enviar/Receber; mais ou menos de hora em hora com **Limite de atualização** | O seu PC | Assinatura pelo link `webcal`; não sincroniza com o celular nem com a web |
| Calendário da Apple (macOS) | De 5 minutos a semanal, de hora em hora por padrão | O seu Mac | Guarde no iCloud para chegar ao iPhone e ao iPad |
| Calendário da Apple (só iOS) | Conforme **Obter Novos Dados**, limitado pela bateria | O seu celular | Assine em um Mac para mais confiabilidade |
| Thunderbird | 1–60 minutos | O seu computador | |
| Fastmail | Mais ou menos de hora em hora | Os servidores do Fastmail | Desativado depois de cinco leituras com falha |
| Proton Calendar | 4–16 horas | Os servidores do Proton | Recusa feeds grandes |

O próprio OneUptime serve dados atualizados: uma mudança em uma camada, uma rotação, uma substituição ou uma ligação de política invalida o feed na hora, e as respostas ficam em cache no máximo cinco minutos. A espera que você vê é do app de calendário, não do servidor. O OneUptime sugere atualizar de hora em hora por meio de `REFRESH-INTERVAL` e `X-PUBLISHED-TTL`; só o Outlook clássico segue a dica, e só com **Limite de atualização** ligado — o Calendário da Apple, o Thunderbird e os demais atualizam no intervalo que você define para cada calendário.

## Links https e webcal

Os dois apontam para o mesmo feed. `webcal://` é o link com o esquema renomeado, para que o sistema operacional abra um app de calendário em vez de um navegador; o app então lê o feed por `https://` quando o servidor serve https, como fazem o Calendário da Apple e o Google Agenda.

- **Copiar link** dá a forma `https://`. O **Do URL** do Google Agenda, o Outlook na web, o Thunderbird e o Fastmail aceitam essa forma.
- **Calendário da Apple / Outlook** abre a forma `webcal://`: o Calendário da Apple e o Outlook clássico para Windows assinam por ela. No Outlook clássico, abrir a forma `https://` em vez disso é uma importação única.
- **Google Agenda** leva a forma `webcal://` dentro do link do Google para adicionar por URL, a única forma que essa página aceita.
- O OneUptime não fornece mais `webcals://`: o iOS não o abre ("o endereço é inválido") e o Google também não o aceita. Um calendário que você já assinou com um link `webcals://` continua funcionando.
- Se a sua instalação ainda usa `http` simples, o feed é lido sem criptografia, token incluído, e o painel mostra um aviso ao lado do link; mude para `https` antes de compartilhar links amplamente.

As URLs dos feeds nunca redirecionam. Elas respondem `200` em qualquer esquema que chegue ao OneUptime, porque o aplicativo não consegue saber qual esquema o app de calendário usou quando o TLS termina antes dele — no OneUptime Cloud, ou atrás do seu próprio balanceador de carga ou CDN —, e um redirecionamento ali apontaria de volta para a mesma URL. Redirecione o `http` simples para `https` no proxy que termina o TLS, o único ponto que sabe.

## Lembretes e avisos de reatribuição

Os apps de calendário não entregam os alarmes de feeds assinados — o Google os descarta, a Apple os remove por padrão, o Outlook os achata —, então o OneUptime envia os seus.

:::steps
1. Abra **Configurações do usuário** > **Calendário** > **Feed de calendário**.
2. No cartão **Lembrar-me antes dos turnos**, escolha as antecedências: **1 semana**, **1 dia**, **1 hora**, **15 min** ou, com **Personalizado**, um valor próprio entre 15 minutos e 14 dias. Você pode escolher várias ao mesmo tempo.
3. Escolha como os lembretes chegam até você em **Antes de o meu turno de prevenção começar**, em **Configurações do usuário** > **Configurações de notificação** (aba Plantão). E-mail e push vêm ligados por padrão.
:::

Cada lembrete é enviado uma vez por turno. A mensagem cita o agendamento, as políticas pelas quais ele aciona e o horário de início no seu fuso.

- Um turno que entra em uma das suas antecedências por causa de uma substituição tardia — alguém passa um turno para você 20 minutos antes de ele começar — recebe na hora um único lembrete de recuperação.
- Se um turno sobre o qual você foi lembrado passar para outra pessoa, você recebe **O meu próximo turno de prevenção é reatribuído**, um tipo de evento separado para que possa ser silenciado à parte.
- Os lembretes nunca são enviados depois que um turno começa, nem para agendamentos que não estão ligados a nenhuma política de escalonamento, porque esses não podem acionar ninguém.
- No WhatsApp, um lembrete chega no modelo de plantão pré-aprovado pela Meta, que cita o agendamento e a política de escalonamento e traz o link do agendamento, mas não traz o horário de início, e que o WhatsApp só envia em inglês. Os avisos de reatribuição não têm modelo aprovado no WhatsApp, então chegam até você pelos seus outros canais.

## Links compartilhados de um agendamento ou de um projeto

Um link compartilhado pertence ao **projeto**, não a quem o copiou, e mostra o nome das pessoas, nunca o endereço de e-mail delas. Coloque o link do agendamento em um calendário de equipe compartilhado — Google, Outlook ou Confluence — e uma única assinatura atende a equipe toda.

### Feed do agendamento

Na página de um agendamento, o cartão **Subscrever esta escala** tem duas metades: **Apenas os meus turnos nesta escala** (o seu link pessoal com um filtro de agendamento) e **Turnos de todos nesta escala (link de equipa partilhado)**. Quem tem a permissão **Editar** nos agendamentos pode publicá-lo com **Publicar link partilhado**, renová-lo com **Regenerar link** ou pará-lo com **Desativar**; quem pode ler o agendamento pode copiá-lo. O cartão mostra quando o link foi renovado pela última vez.

### Feed do projeto

**Plantão** > **Feeds de calendário** tem o cartão **Turnos de todos neste projeto (link partilhado)** — um único link compartilhado que cobre todos os agendamentos do projeto — com as mesmas ações de publicar, regenerar e desativar, e um link para a sua página de feed pessoal.

### Configurações dos links compartilhados

Clique em **Editar definições** no cartão **Definições do link partilhado**:

| Configuração | O que faz |
| --- | --- |
| **Mostrar lacunas de cobertura** | Desligada por padrão. Acrescenta um evento `No coverage · <Schedule>` sempre que uma camada _deveria_ cobrir mas ninguém está de plantão: uma camada vazia, uma camada com data de início no futuro, camadas que não se encaixam ou qualquer buraco em um agendamento 24×7. As horas fora do expediente de um agendamento de horário comercial nunca são relatadas, e no máximo 100 eventos de lacuna são emitidos, os mais antigos primeiro. |
| **Lacuna mínima a mostrar (minutos)** | 60 por padrão. Esconde lacunas menores. |
| **Regenerar quando alguém sair do projeto** | Desligada por padrão. Regenera o link automaticamente quando alguém sai da última equipe que tem no projeto, para que o calendário de um ex-colega pare de atualizar. Todos os outros precisam assinar de novo depois, por isso ela só é ligada de propósito. |
| **Dias de turnos passados**, **Dias futuros** | Como no feed pessoal. |

Renove um link compartilhado quando alguém que o tinha sair, ou ligue a rotação automática acima.

Quando uma pessoa sai da última equipe que tem em um projeto, o OneUptime também a remove das camadas de agendamento e das regras de escalonamento desse projeto, exclui as substituições ativas e futuras do projeto que a citam (como pessoa substituída ou como substituta), desativa o feed pessoal dela no projeto e exclui ali os lembretes dela. Um link pessoal mostra turnos apenas enquanto o dono dele é membro do projeto: isso é verificado a cada leitura do link, então quem saiu recebe um calendário vazio, e a lista de próximos turnos no app para celular cobre só os projetos dos quais a pessoa ainda é membro.

## Os eventos em detalhe

- Cada turno tem uma identidade estável formada pelo agendamento e pelo início do turno, então o mesmo turno é o mesmo evento no seu feed pessoal, no feed do agendamento e depois de regenerar um link. Os apps de calendário o atualizam no lugar; uma mudança incrementa o número de sequência do evento.
- Uma substituição que troca o turno inteiro mantém o evento e troca a pessoa; uma substituição de parte de um turno gera três eventos contíguos, por exemplo A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Quando um agendamento está ligado a duas ou mais políticas de escalonamento e uma substituição vale só para uma delas, as pessoas acionadas mudam conforme a política. O feed mostra isso em vez de esconder: o turno mantém o evento para a pessoa acionada pelas outras políticas, com uma nota citando a política que aciona outra pessoa, e quem substitui recebe um evento extra com o título `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Os turnos passados trazem na descrição a linha "Past shifts reflect the current rotation, not who was actually paged".
- Um agendamento que não está ligado a nenhuma política de escalonamento aparece mesmo assim, com uma nota de que ele não vai acionar ninguém.

## Planejamento, não auditoria

O feed mostra a rotação **como está configurada agora**, inclusive para os dias passados: uma substituição registrada depois reescreve a história no calendário. Para as horas realmente passadas de plantão, revisões de equidade e remuneração, use **Plantão** > **Relatórios** > **Tempo de plantão do usuário**, que é registrado a partir do que os acionamentos de fato fizeram.

## Segurança

- O token no link é a única credencial. Quem tem o link vê os turnos — nomes, agendamentos, políticas — até ele ser regenerado. Não cole links em salas de chat nem em tickets; quando uma equipe precisar de um calendário, compartilhe o link do agendamento ou do projeto em vez do seu link pessoal.
- Os links são por projeto. Um link pessoal vazado expõe os turnos de um projeto, não de todos os projetos dos quais você faz parte.
- Regenerar um link coloca o token antigo em um período de carência de 30 dias (calendário vazio, depois 404). **Desativar** serve um calendário vazio. Um link desconhecido ou expirado responde com um 404 simples, sem pistas. Calendários vazios fazem os apps assinantes esvaziarem a cópia; um 404 faz com que a mantenham, por isso desativar e regenerar servem calendários vazios.
- Os tokens são guardados com hash; a cópia mostrada na página de configurações é criptografada com `ENCRYPTION_SECRET`. Defina essa variável com um segredo de verdade em uma instalação auto-hospedada — o servidor avisa na inicialização quando ela não está definida ou ainda é um dos valores de exemplo que este repositório traz (`secret`, ou o `please-change-this-to-random-value` que o `config.example.env` define). Se você a mudar depois, a página oferece **Regenerar link** porque a cópia guardada não pode mais ser lida; o feed continua funcionando até você fazer isso.
- As respostas dos feeds são marcadas com `Cache-Control: private`, excluídas dos buscadores (`X-Robots-Tag: noindex`) e têm limite de taxa por link e por endereço de cliente.

O Nginx do próprio OneUptime mantém as requisições dos feeds fora dos logs:

```nginx title="default.conf.template"
location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
    access_log off;
    error_log /dev/null crit;
    proxy_max_temp_file_size 0;
    ...
}
```

Assim, um token nunca vai parar em um arquivo de log ao lado do endereço de um cliente; o aplicativo também nunca o registra. `access_log off` remove a linha por requisição, `error_log` remove as linhas que o Nginx escreve quando uma chamada ao aplicativo falha — sem isso, o token de todo cliente que consulta durante um reinício é registrado — e `proxy_max_temp_file_size 0` mantém um feed grande fora de um arquivo temporário.

> [!WARNING]
> **Qualquer proxy, WAF ou CDN que você coloque na frente do OneUptime ainda registra a URI completa, tanto no log de acesso quanto no de erros,** a menos que você o configure para não fazer isso — verifique antes de liberar os feeds.

## Configuração auto-hospedada

Não é preciso ligar nada: os feeds funcionam em qualquer instalação. Quatro variáveis de ambiente os controlam, definidas no `config.env` para o Docker Compose ou em `onCallCalendarFeed` nos valores do Helm (veja a [referência de configuração](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) do chart):

| Variável | Valor do Helm | Padrão | Efeito |
| --- | --- | --- | --- |
| `DISABLE_ON_CALL_CALENDAR_FEED` | `onCallCalendarFeed.disabled` | `false` | Chave de emergência. Toda URL de feed responde `503` com `Retry-After: 3600`; os apps assinantes mantêm a cópia que têm e tentam de novo mais tarde. Nada é excluído. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS` | `onCallCalendarFeed.rateLimit.windowSeconds` | `60` | Duração da janela do limite de taxa. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60` | Leituras que um link pode fazer a partir de um endereço de cliente por janela. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perIpPerWindow` | `3000` | Leituras que um endereço de cliente pode fazer em todos os links por janela — o teto para um escritório inteiro atrás de um endereço. |

Também importa:

- **`HOST` e `HTTP_PROTOCOL`** montam os links. Se `HOST` estiver vazio ou for `localhost`, ou se `HTTP_PROTOCOL` for `http`, a página do feed mostra um aviso e os links não vão funcionar de fora. Se `HOST` for um endereço privado — `10.x`, `172.16–31.x`, `192.168.x`, um nome sem ponto como o de um contêiner, ou um nome sob `.internal`, `.local`, `.lan` e similares —, a página avisa que o Google Agenda e o Outlook na web não conseguem alcançar o link; apps em um computador da mesma rede ainda conseguem.
- **`TRUSTED_PROXY_HOPS`** decide qual endereço conta para o limite por endereço. O padrão `1` é o certo para os layouts padrão do Docker Compose e do Helm; some um para cada proxy seu — CDN, WAF ou balanceador de carga — que acrescente a `X-Forwarded-For`; caso contrário, todo cliente de calendário parece o mesmo endereço e todos dividem um único orçamento. Veja [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) na documentação do chart.
- O **Redis** sustenta os caches e o limite de taxa. Os dois degradam com suavidade: sem o Redis, os feeds continuam sendo gerados, só que mais devagar, e o limite deixa as requisições passarem.
- No modo dividido do chart do Helm (`worker.enabled: true`), os feeds são gerados na camada de API, então dimensione essa camada para uma rajada de clientes de calendário consultando no início de cada hora.
- A exceção do log de acesso do Nginx mostrada acima faz parte do `packages/Nginx/default.conf.template` distribuído; mantenha-a se você personalizar o modelo.

## Solução de problemas

:::details O Google Agenda diz "Unable to add calendar. Check the URL."
Versões antigas do OneUptime colocavam a forma `https://` do link no botão **Google Agenda**, e a página do Google para adicionar por URL só aceita a forma `webcal://`. Recarregue a página do feed e clique de novo em **Google Agenda**, ou adicione o link em **Outras agendas** > **+** > **Do URL**.
:::

:::details O Google Agenda mostra o calendário, mas nenhum turno
Verifique primeiro a linha de status da página do feed. **Última obtenção … por Google Calendar** significa que o Google leu o link: abra o link em um navegador e veja o que ele serve — um calendário vazio informa o motivo em `X-WR-CALDESC` (veja "O calendário está vazio" abaixo).

**Ainda não obtido** significa que o Google não conseguiu lê-lo: de uma máquina fora da sua rede, `curl -sI <link>` precisa responder `200` com `Content-Type: text/calendar` na hora. Um redirecionamento, uma página de login, um firewall ou uma verificação antibots na frente do OneUptime barra o leitor do Google; um loop de redirecionamento das versões antigas do OneUptime também barrava, em instalações com `PROVISION_SSL=true` cujo TLS termina antes do Nginx. Quando ele responder `200`, adicione o link de novo com `?nocache=1` no final para o Google lê-lo outra vez.
:::

:::details Nada leu o link, ou "Não foi possível buscar a URL"
O Google Agenda, o Outlook na web, o Fastmail e o Proton leem **dos próprios servidores**, então o host do OneUptime precisa estar acessível pela internet pública com um certificado em que eles confiem. Uma instalação em rede privada, atrás de uma VPN ou com uma autoridade certificadora interna fica inacessível para eles, não importa o que você cole.

O Calendário da Apple, o Thunderbird e o Outlook clássico leem do dispositivo, então funcionam onde quer que o dispositivo consiga abrir o painel — depois de confiar no certificado nesse dispositivo, se for autoassinado. A linha de status da página do feed diz se algo já leu o link; `curl -I` no link de fora da sua rede é a verificação mais rápida:

```bash
curl -I "https://<your host>/api/on-call-calendar/user/<token>/shifts.ics"
```

Permitir que o OneUptime _alcance_ redes privadas — [Acesso a redes privadas](/docs/self-hosted/private-network-access) — é outro assunto e não ajuda aqui.
:::

:::details O calendário está desatualizado
Leia primeiro a tabela de atualização: no Google, o atraso é normal. Para o Google olhar de novo, remova e adicione o calendário outra vez ou acrescente `?nocache=1` ao link (parâmetros desconhecidos são ignorados, então o feed não muda, mas o Google o trata como novo). No Outlook clássico, aperte F9 e confira a configuração **Limite de atualização**. No Calendário da Apple, use **Visualizar** > **Atualizar Calendários**. Se uma mudança no mesmo dia importar, confie nos lembretes e avisos de reatribuição do OneUptime, não no calendário.
:::

:::details O calendário está vazio
Um calendário vazio é proposital. Significa que o link está desativado, que é um link antigo dentro do período de carência de 30 dias depois de uma regeneração, que o projeto está abaixo do plano que inclui os agendamentos de plantão ou que você não está mais em nenhum agendamento desse projeto. Abra o link em um navegador: a descrição do calendário (`X-WR-CALDESC`) informa o motivo. Se você saiu do projeto, o link continua vazio: ele só mostra turnos enquanto você é membro.
:::

:::details O link responde 404
O link é desconhecido, foi excluído ou o período de carência dele terminou. Gere um novo e assine de novo.
:::

:::details O link responde 503
Ou `DISABLE_ON_CALL_CALENDAR_FEED` está definido, ou o servidor está ocupado: no máximo alguns feeds são gerados ao mesmo tempo, e um agendamento que demora muito para ser calculado é interrompido. Quando existe uma cópia anterior do feed, o servidor serve essa cópia, com um cabeçalho `Warning: 110`, então um 503 significa que não havia nada em que se apoiar. Os clientes mantêm a última cópia e tentam de novo depois do intervalo `Retry-After`. O Fastmail desativa uma assinatura depois de cinco falhas seguidas; adicione de novo quando o servidor estiver bem. A métrica `oncall_calendar_render_duration_ms` mostra aos operadores quais feeds estão lentos.
:::

:::details 429 ou "muitas requisições"
Muitos clientes atrás de um mesmo endereço — um NAT de escritório, um gateway de VPN — dividem o orçamento por endereço. Aumente `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` e confira `TRUSTED_PROXY_HOPS`: se ele estiver baixo demais, todo cliente é atribuído ao seu próprio proxy e todos dividem um único orçamento.
:::

:::details Erros de certificado no Calendário da Apple, no Thunderbird ou no Outlook
Esses apps validam o TLS no dispositivo. Importe a sua CA interna para o repositório de confiança do dispositivo — as Chaves do macOS, o repositório de certificados do Windows, o gerenciador de certificados do Thunderbird — ou use um certificado de confiança pública. Leitores do lado do servidor, como o Google e a Microsoft, não podem ser levados a confiar em uma CA privada.
:::

:::details Os horários estão errados
Todos os horários do arquivo estão em UTC; o app de calendário os converte para o próprio fuso. Se os turnos parecerem deslocados por um valor fixo, confira o fuso do agendamento (**Schedule timezone** na página **Camadas** dele) e o seu (**Fuso horário** no seu **Perfil**). Um agendamento sem fuso horário é calculado no fuso do servidor, e o evento avisa isso.
:::

:::details O feed diz que foi encurtado
Mais de 5.000 eventos caíram dentro da janela. Reduza **Dias futuros**, ou assine **Apenas os meus turnos nesta escala** em vez de um projeto inteiro.
:::

:::details O Google mostra um nome de calendário antigo
O Google lê o nome só na primeira assinatura; remova o calendário e adicione de novo.
:::

:::details A página de configurações diz que o link precisa ser regenerado
O `ENCRYPTION_SECRET` mudou desde que o link foi criado, então o servidor não consegue mais mostrá-lo. A assinatura existente continua funcionando; regenerar dá a você um link que pode ser copiado de novo e aposenta o antigo depois de 30 dias.
:::

:::details Falta um turno no meu feed
Só aparecem os turnos dos agendamentos; atribuições diretas de usuário ou equipe em uma regra de política são fixas e não têm eventos. Um turno assumido por outra pessoa por meio de uma substituição sai do seu feed porque agora está no dela. Ligue **Incluir turnos que cubro por outros** para ver os turnos que você ganhou por substituições em agendamentos dos quais não é membro.
:::

## Próximos passos

:::cards
- [Agendamentos de plantão](/docs/on-call/schedules): Configure as rotações que seus feeds mostram.
- [Linha do tempo de plantões](/docs/on-call/schedule-timeline): Veja todos os agendamentos lado a lado no painel.
- [Regras de escalonamento](/docs/on-call/escalation-rules): Ligue agendamentos a políticas para que os turnos deles acionem pessoas.
:::
