# Feeds de calendário (turnos de plantão no Google Agenda, Outlook e Calendário da Apple)

Os feeds de calendário colocam seus turnos de plantão no calendário que você já consulta. O OneUptime publica um link iCalendar (`.ics`) secreto por pessoa, por escala e por projeto; Google Agenda, Outlook, Calendário da Apple, Thunderbird e qualquer outro aplicativo capaz de assinar um calendário por URL consultam esse link e mostram um evento por turno. Nada é instalado e nenhuma conta é conectada: o link é toda a integração.

> **Note:** Um calendário assinado serve para **planejamento**. Os aplicativos de calendário releem os feeds no próprio ritmo — o Google Agenda apenas a cada 8 a 24 horas —, então uma troca feita uma hora antes de um turno chega até você pelos lembretes, avisos de reatribuição e notificações de plantão do OneUptime, não pelo calendário.

## O que você recebe

- Um evento por turno, intitulado `On-call · <Schedule>` no seu feed pessoal e `<Name> · On-call · <Schedule>` em um feed compartilhado. A descrição indica quem está de plantão, a escala e seu fuso horário, a camada, o turno no fuso da escala, em UTC e no seu, quais políticas de escalonamento acionam você por essa escala e um link para a escala no painel.
- As substituições são respeitadas. Quando alguém cobre você, o evento passa para essa pessoa (`(covering for <Name>)` é acrescentado) e continua sendo o mesmo evento no seu aplicativo, atualizando no lugar em vez de duplicar. Uma substituição parcial divide o turno em eventos contíguos.
- Dois dias de histórico e 90 dias à frente por padrão. Você pode ampliar para 60 dias atrás e 180 dias à frente; um feed que ultrapassaria 5.000 eventos é encurtado e informa isso na descrição do calendário.
- Os eventos são marcados como livres (`TRANSP:TRANSPARENT`), então um feed assinado nunca bloqueia sua disponibilidade, e nada é marcado como privado, de modo que um calendário de equipe compartilhado mostra os títulos a todos que podem vê-lo.
- Os horários são enviados em UTC e convertidos pelo seu aplicativo; a descrição informa o horário local no fuso da escala e no seu. Defina seu fuso em **Configurações do usuário** > **Perfil** e o da escala na aba **Configurações** dela. Uma escala sem fuso é calculada no fuso do servidor, como no acionamento, e o evento informa isso.

Atribuições fixas — um usuário ou equipe nomeados diretamente em uma regra de política de escalonamento — não têm início nem fim e não aparecem em nenhum feed. No OneUptime Cloud, os feeds seguem o mesmo plano das escalas de plantão (Growth); um projeto abaixo desse plano recebe um calendário vazio em vez de um erro.

## Três tipos de link

| Link                | Quem cria                                                                | O que contém                                                                                     | Onde                                                  |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **Feed pessoal**    | Cada usuário, um por projeto                                             | Seus turnos em todas as escalas do projeto, mais os turnos em que você cobre alguém (opcional)   | **Configurações do usuário** > **Feed de calendário** |
| **Feed de escala**  | Quem pode editar a escala; quem pode lê-la pode copiar o link            | Os turnos de todos em uma escala, com eventos opcionais de lacunas de cobertura                  | A página da escala, cartão **Assinar esta escala**    |
| **Feed de projeto** | Quem pode editar escalas de plantão; quem pode lê-las pode copiar o link | Os turnos de todos em todas as escalas do projeto, com eventos opcionais de lacunas de cobertura | **Plantão** > **Feeds de calendário**                 |

Os links têm este formato:

```
https://<seu host>/api/on-call-calendar/user/<token>/shifts.ics
https://<seu host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<seu host>/api/on-call-calendar/project/<token>/project.ics
```

O token de 43 caracteres no caminho é a única credencial — não há login, cookie nem chave de API. Trate cada um desses links como uma senha.

## Seu feed pessoal

1. Abra **Configurações do usuário** > **Feed de calendário** no projeto cujos turnos você quer. Os feeds pessoais são por projeto: um segundo projeto tem um segundo link e um segundo calendário.
2. Clique em **Gerar link de calendário**. O cartão **Assine seus turnos de plantão** passa a mostrar o link `https://` e três botões:
   - **Google Agenda** abre o Google Agenda com o link preenchido.
   - **Apple / outros aplicativos** abre a forma `webcals://` do link, que macOS, iOS e a maioria dos aplicativos de desktop entregam direto à caixa de assinatura.
   - **Copiar link webcal** copia esse mesmo link `webcal(s)://` — o que o Outlook clássico para Windows precisa.
3. Assine no seu aplicativo de calendário seguindo os passos por aplicativo abaixo.

Configurações no mesmo cartão:

- **Incluir turnos que cubro por outros** (ativado por padrão) acrescenta os turnos que uma substituição lhe dá em escalas das quais você não é membro.
- **Dias de turnos passados** (padrão 2, no máximo 60) e **Dias à frente** (padrão 90, entre 7 e 180).

A linha de status mostra quando o link foi lido pela última vez, por qual aplicativo, quantas vezes e os quatro últimos caracteres do token para distinguir links. Se nada leu o link após dois dias, a página pergunta se o servidor está acessível pela internet (veja Solução de problemas).

A página também lista seus **Próximos turnos** (os próximos 30 dias), cada um com um link **Conseguir cobertura** que abre as substituições de usuário preenchidas para aquele turno, e o cartão **Lembrar-me antes dos turnos** descrito mais abaixo.

Ações:

- **Regenerar link** cria um novo token. Todo aplicativo assinado no link antigo para de atualizar: por 30 dias o link antigo serve um calendário vazio para que esses aplicativos limpem sua cópia, depois responde 404. Assine de novo com o novo link.
- **Desativar** mantém o link, mas serve um calendário vazio até você reativá-lo.
- **Excluir** remove o link. Aplicativos que ainda o consultam recebem 404 e continuam mostrando o que carregaram por último — desative primeiro se quiser que eles esvaziem.

O mesmo link pessoal, filtrado para uma escala com `?schedule=<id>`, é oferecido como **Somente meus turnos nesta escala** em cada página de escala, e o banner de plantão e a página **Minhas políticas de plantão** trazem um link **Adicionar seus turnos ao seu calendário** para a página acima.

No aplicativo móvel: **Plantão** > **Adicionar turnos ao meu calendário** (também em **Configurações** > **Feed de calendário**), com um link por projeto. No iPhone, **Abrir no Calendário** abre a folha de assinatura nativa. No Android não há como assinar uma URL no telefone, então a tela oferece **Compartilhar link** e **Copiar link https** e orienta a adicionar o link em um computador, após o que ele sincroniza para o telefone. A lista **Seus turnos** do aplicativo vem dos mesmos dados e tem a mesma ação **Conseguir cobertura**.

## Assinar no seu aplicativo de calendário

Use o link `https://` a menos que o aplicativo peça `webcal`; a seção sobre esquemas abaixo explica a diferença.

### Google Agenda (web)

1. No Google Agenda na web, ao lado de **Outras agendas** clique em **+** > **Usando URL**.
2. Cole o link `https://` e clique em **Adicionar agenda**. O botão **Google Agenda** no OneUptime faz o mesmo com o link preenchido.

O Google lê o feed **a partir dos servidores do Google**, aproximadamente a cada 8 a 24 horas e às vezes mais. Não há botão de atualização para agendas assinadas, e o Google ignora as dicas de atualização do feed. O nome e o fuso horário da agenda são lidos **apenas na primeira assinatura**: renomear uma escala depois não renomeia a agenda no Google — remova e adicione de novo se o nome importar. O Google descarta lembretes contidos em arquivos de calendário; defina notificações padrão para essa agenda nas configurações do Google ou, melhor, use os lembretes do próprio OneUptime. Se o Google informar que não conseguiu buscar a URL, confira se você colou a forma `https://` e não `webcal://`, e acrescente `?nocache=1` para fazê-lo tentar de novo (o OneUptime ignora parâmetros de consulta desconhecidos, o feed não muda). O aplicativo Google Agenda no Android e iOS não consegue assinar por URL; adicione o link em um computador e ele aparece no telefone.

### Outlook na web e Outlook.com

1. Abra **Calendário** > **Adicionar calendário** > **Assinar da Web**.
2. Cole o link `https://`, dê um nome ao calendário e clique em **Importar**.

O Outlook lê **a partir dos servidores da Microsoft**: cerca de a cada 3 horas no Outlook.com e a cada 4 a 6 horas em contas corporativas ou de estudante, às vezes mais de um dia. O intervalo é fixo e não há atualização manual. Assine aqui em vez de no aplicativo de desktop se quiser o calendário também no telefone e no Outlook na web — assinaturas criadas no Outlook clássico para Windows ficam naquele PC. O novo Outlook para Windows e o Outlook para Mac usam a mesma caixa **Adicionar calendário** > **Assinar da Web**.

### Outlook clássico para Windows

1. No OneUptime clique em **Copiar link webcal**.
2. No Outlook, abra **Arquivo** > **Configurações de Conta** > **Configurações de Conta** > **Calendários da Internet** > **Novo**, cole o link `webcals://` e clique em **Adicionar**. Abrir um link `webcal` no navegador também funciona em um PC com o Outlook instalado; sem o Outlook, o Windows não tem manipulador `webcal`.

**Não** abra o próprio link `https://…/shifts.ics` no Outlook clássico: ele importa um instantâneo único que nunca atualiza. Somente `webcal://` e `webcals://` criam uma assinatura.

O feed é atualizado em cada **Enviar/Receber** (F9, ou o intervalo dos grupos de envio/recebimento). As configurações da assinatura têm uma caixa **Limite de atualização**: marcada, o Outlook não atualiza mais rápido do que o intervalo sugerido pelo publicador. O OneUptime sugere uma hora (`X-PUBLISHED-TTL:PT1H`), então o feed atualiza aproximadamente de hora em hora. Feeds sem essa dica nunca atualizam enquanto a caixa está marcada; os do OneUptime a incluem, então você pode deixá-la marcada. O Outlook clássico lê o feed **a partir do seu PC** e valida o certificado do servidor.

### Calendário da Apple no macOS

1. Clique em **Apple / outros aplicativos** no OneUptime, ou no Calendário escolha **Arquivo** > **Nova Assinatura de Calendário** e cole o link.
2. Na folha de assinatura, defina **Atualizar automaticamente** — a cada 5 minutos, 15 minutos, hora, dia ou semana (de hora em hora por padrão) — e escolha **iCloud** em **Localização** para que o calendário apareça também no seu iPhone e iPad e continue atualizando nesse ritmo.

O macOS lê o feed **a partir do seu Mac**, então funciona com uma instalação em rede privada desde que o Mac a alcance. Um certificado autoassinado ou de uma CA interna precisa ser confiado primeiro nas Chaves do macOS. **Remover alertas** vem marcado por padrão nessa folha; aqui não faz diferença, porque o feed não traz alarmes.

### iPhone e iPad

Assinaturas criadas no próprio dispositivo atualizam conforme **Ajustes** > **Calendário** > **Contas** > **Obter Novos Dados** — **Automaticamente** por padrão, que busca principalmente ao carregar no Wi-Fi. Para uma atualização confiável, assine em um Mac com **iCloud** como localização, ou defina **Obter Novos Dados** para um intervalo fixo. Para assinar no dispositivo, toque em **Abrir no Calendário** no aplicativo móvel do OneUptime, ou vá em **Ajustes** > **Calendário** > **Contas** > **Adicionar Conta** > **Outra** > **Adicionar Calendário Assinado** e cole o link.

### Thunderbird

Escolha **Arquivo** > **Novo** > **Calendário** > **Na rede** > **iCalendar (ICS)**, cole o link `https://` e escolha um intervalo de atualização nas propriedades do calendário: 1, 5, 15, 30 ou 60 minutos. O Thunderbird lê **a partir do seu computador** e precisa confiar no certificado do servidor.

### Fastmail, Proton e outros serviços

O Fastmail atualiza aproximadamente de hora em hora e **desativa uma assinatura após cinco leituras consecutivas com falha**; se isso acontecer, adicione-a de novo quando o servidor estiver saudável. O Proton Calendar atualiza a cada 4 a 16 horas e rejeita feeds muito grandes — reduza **Dias à frente** se ele reclamar. O Confluence Team Calendars aceita o feed de escala; seu limite de 28 caracteres para nomes de calendário é respeitado.

### Android

Nem o aplicativo Google Agenda nem o Samsung Calendar conseguem assinar uma URL. Adicione o link `https://` ao Google Agenda em um computador (**Outras agendas** > **+** > **Usando URL**); a agenda então sincroniza para o telefone com todo o resto daquela conta Google. O aplicativo móvel do OneUptime no Android oferece **Compartilhar link** e **Copiar link https** exatamente para isso.

## Com que frequência os calendários atualizam

| Aplicativo de calendário          | Atualização típica                                                     | Lê a partir de          | Observações                                                                           |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| Google Agenda (Usando URL)        | 8–24 horas, às vezes mais                                              | Servidores do Google    | Sem atualização manual; ignora dicas; nome e fuso lidos apenas na primeira assinatura |
| Outlook.com                       | Cerca de 3 horas                                                       | Servidores da Microsoft | Fixo; pode ultrapassar 24 horas                                                       |
| Outlook na web (trabalho, escola) | Cerca de 4–6 horas                                                     | Servidores da Microsoft | Fixo; sem controle do usuário                                                         |
| Outlook clássico para Windows     | Em Enviar/Receber; cerca de hora em hora com **Limite de atualização** | Seu PC                  | Precisa de um link `webcal`; não sincroniza com telefone ou web                       |
| Calendário da Apple (macOS)       | De 5 minutos a semanal, de hora em hora por padrão                     | Seu Mac                 | Guarde no iCloud para alcançar iPhone e iPad                                          |
| Calendário da Apple (somente iOS) | Conforme **Obter Novos Dados**, limitado pela bateria                  | Seu telefone            | Assine em um Mac para maior confiabilidade                                            |
| Thunderbird                       | 1–60 minutos                                                           | Seu computador          |                                                                                       |
| Fastmail                          | Cerca de hora em hora                                                  | Servidores do Fastmail  | Desativado após cinco leituras com falha                                              |
| Proton Calendar                   | 4–16 horas                                                             | Servidores do Proton    | Rejeita feeds grandes                                                                 |

O próprio OneUptime serve dados atuais: uma edição em uma camada, rotação, substituição ou vínculo de política invalida o feed na hora, e as respostas ficam em cache por no máximo cinco minutos. A espera que você vê é do aplicativo de calendário, não do servidor. O OneUptime sugere atualização de hora em hora via `REFRESH-INTERVAL` e `X-PUBLISHED-TTL`; só o Outlook clássico e o Calendário da Apple seguem a dica.

## https, webcal e webcals

Os três apontam para o mesmo feed. `webcal://` e `webcals://` são o link `http://` e `https://` com o esquema renomeado, para que o sistema operacional abra um aplicativo de calendário em vez de um navegador; `webcals` é a variante criptografada e é a que o OneUptime oferece quando `HTTP_PROTOCOL` é `https`.

- Google Agenda, Outlook na web, Thunderbird e Fastmail querem a forma `https://`.
- Calendário da Apple e Outlook clássico para Windows assinam a partir de um link `webcal(s)://`; no Outlook clássico a forma `https://` é uma importação única.
- `webcal://` sem o `s` não é criptografado e envia o token em texto claro a cada leitura. Se sua instalação ainda roda em `http` simples, o painel mostra um aviso ao lado do link; mude para `https` antes de compartilhar links amplamente.

## Lembretes e avisos de reatribuição

Os aplicativos de calendário não entregam alarmes de feeds assinados — o Google os descarta, a Apple os remove por padrão, o Outlook os achata —, então o OneUptime envia os seus.

Em **Configurações do usuário** > **Feed de calendário**, o cartão **Lembrar-me antes dos turnos** permite escolher antecedências: **1 semana**, **1 dia**, **1 hora**, **15 min** ou um valor personalizado entre 15 minutos e 14 dias, várias ao mesmo tempo. Cada lembrete é enviado uma vez por turno pelos métodos de entrega escolhidos para **Antes do início do meu turno de plantão** em **Configurações do usuário** > **Configurações de notificação** (aba Plantão; e-mail e push ativados por padrão). A mensagem indica a escala, as políticas pelas quais ela aciona e o horário de início no seu fuso.

- Um turno que cai dentro de uma das suas antecedências por causa de uma substituição tardia — alguém lhe passa um turno 20 minutos antes de começar — recebe imediatamente um único lembrete de recuperação.
- Se um turno sobre o qual você foi lembrado é passado a outra pessoa, você recebe **Meu próximo turno de plantão foi reatribuído**, um tipo de evento separado que pode ser silenciado à parte.
- Lembretes nunca são enviados depois que um turno começou, nem para escalas que não estão vinculadas a nenhuma política de escalonamento, porque essas não acionam ninguém.

## Links compartilhados para uma escala ou um projeto

Um link compartilhado pertence ao **projeto**, não a quem o copiou, e mostra os nomes das pessoas, nunca seus endereços de e-mail.

**Feed de escala.** Na página de uma escala, o cartão **Assinar esta escala** tem duas metades: **Somente meus turnos nesta escala** (seu link pessoal com filtro de escala) e **Turnos de todos nesta escala (link de equipe compartilhado)**. Quem tem a permissão **Editar** em escalas pode **Publicar link compartilhado**, **Regenerá-lo** ou **Desativá-lo**; quem pode ler a escala pode copiá-lo. O cartão mostra quando o link foi rotacionado pela última vez.

**Feed de projeto.** **Plantão** > **Feeds de calendário** contém o cartão **Turnos de todos neste projeto (link compartilhado)** — um link compartilhado que cobre todas as escalas do projeto — com as mesmas ações de publicar, regenerar e desativar, e um link para a página do seu feed pessoal.

Configurações em ambos:

- **Mostrar lacunas de cobertura** (desativado por padrão) adiciona um evento `No coverage · <Schedule>` onde uma camada _deveria_ cobrir mas ninguém está de plantão: uma camada vazia, uma camada cuja data de início está no futuro, camadas desalinhadas ou qualquer lacuna em uma escala 24×7. As horas fora do expediente de uma escala de horário comercial nunca são reportadas. **Lacuna mínima a mostrar (minutos)** (padrão 60) oculta lacunas mais curtas; no máximo 100 eventos de lacuna são emitidos, os mais antigos primeiro.
- **Regenerar quando alguém sair do projeto** (desativado por padrão) regenera o link automaticamente quando alguém sai da última equipe no projeto, para que o calendário de um ex-colega pare de atualizar. Todos os demais precisam assinar de novo depois, por isso é opcional.
- **Dias de turnos passados** e **Dias à frente**, como no feed pessoal.

Coloque o link de escala em um calendário de equipe compartilhado — Google, Outlook ou Confluence — e uma única assinatura atende toda a equipe. Rotacione-o quando alguém que o tinha sair, ou ative a rotação automática acima.

Quando uma pessoa sai da última equipe em um projeto, o OneUptime também a remove das camadas de escala e das regras de escalonamento daquele projeto, desativa seu feed pessoal do projeto e exclui seus lembretes ali.

## Os eventos em detalhe

- Cada turno tem uma identidade estável formada pela escala e pelo início do turno, de modo que o mesmo turno é o mesmo evento no seu feed pessoal, no feed de escala e após regenerar um link. Os aplicativos o atualizam no lugar; uma alteração incrementa o número de sequência do evento.
- Uma substituição que troca o turno inteiro mantém o evento e muda a pessoa; uma substituição que cobre parte de um turno produz três eventos contíguos, por exemplo A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- Quando uma escala está vinculada a duas ou mais políticas de escalonamento e uma substituição se aplica a apenas uma delas, as pessoas acionadas diferem por política. O feed mostra isso em vez de esconder: o turno mantém seu evento para a pessoa acionada pelas outras políticas, com uma nota indicando a política que aciona outra pessoa, e o substituto recebe um evento extra intitulado `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Turnos passados trazem na descrição a linha "Past shifts reflect the current rotation, not who was actually paged".
- Uma escala não vinculada a nenhuma política de escalonamento ainda é mostrada, com uma nota de que não acionará ninguém.

## Planejamento, não auditoria

O feed mostra a rotação **como está configurada agora**, inclusive para dias passados: uma substituição inserida depois reescreve o histórico no calendário. Para horas realmente passadas de plantão, revisões de equidade e remuneração, use **Plantão** > **Relatórios** > **Tempo de plantão por usuário**, que é escrito a partir do que o pager realmente fez.

## Segurança

- O token no link é a única credencial. Quem tem o link vê os turnos — nomes, escalas, políticas — até que seja regenerado. Não cole links em salas de chat ou tickets; quando uma equipe precisar de um calendário, compartilhe o link de escala ou de projeto em vez do pessoal.
- Os links são por projeto. Um link pessoal vazado expõe os turnos de um projeto, não de todos os projetos aos quais você pertence.
- **Regenerar** move o token antigo para um período de carência de 30 dias (calendário vazio, depois 404). **Desativar** serve um calendário vazio. Um link desconhecido ou expirado responde com um simples 404 sem pistas. Calendários vazios fazem os aplicativos assinados limparem sua cópia; um 404 os faz mantê-la, e é por isso que desativar e regenerar servem calendários vazios.
- Os tokens são armazenados com hash; a cópia mostrada na página de configurações é criptografada com `ENCRYPTION_SECRET`. Defina essa variável com um segredo real em uma instalação auto-hospedada — o servidor avisa na inicialização quando ela não está definida ou ainda é literalmente `secret`. Se você a alterar depois, a página oferece **Regenerar link** porque a cópia armazenada não pode mais ser lida; o feed continua funcionando até você fazer isso.
- As respostas dos feeds são marcadas `Cache-Control: private`, excluídas dos mecanismos de busca (`X-Robots-Tag: noindex`) e limitadas por link e por endereço do cliente.
- O Nginx do próprio OneUptime não grava requisições de feed em seu log de acesso:

  ```
  location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
      access_log off;
      ...
  }
  ```

  assim um token nunca acaba em um arquivo de log ao lado de um endereço de cliente; a aplicação também nunca o registra. **Qualquer proxy, WAF ou CDN que você coloque na frente do OneUptime ainda registra a URI completa** a menos que seja configurado para não fazê-lo — verifique isso antes de disponibilizar os feeds.

## Configuração auto-hospedada

Nada precisa ser ativado: os feeds funcionam em toda instalação. Quatro variáveis de ambiente os controlam, definidas em `config.env` no Docker Compose ou em `onCallCalendarFeed` nos valores do Helm (veja a [referência de configuração](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds) do chart):

| Variável                                                | Valor Helm                                       | Padrão  | Efeito                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISABLE_ON_CALL_CALENDAR_FEED`                         | `onCallCalendarFeed.disabled`                    | `false` | Interruptor de emergência. Toda URL de feed responde `503` com `Retry-After: 3600`; aplicativos assinados mantêm sua cópia e tentam de novo depois. Nada é excluído. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS`       | `onCallCalendarFeed.rateLimit.windowSeconds`     | `60`    | Duração da janela de limitação.                                                                                                                                      |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60`    | Leituras que um link pode fazer a partir de um endereço de cliente por janela.                                                                                       |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`    | `onCallCalendarFeed.rateLimit.perIpPerWindow`    | `3000`  | Leituras que um endereço de cliente pode fazer em todos os links por janela — o teto para um escritório inteiro atrás de um único endereço.                          |

Também relevante:

- **`HOST` e `HTTP_PROTOCOL`** constroem os links. Se `HOST` estiver vazio ou for `localhost`, ou `HTTP_PROTOCOL` for `http`, a página do feed mostra um aviso e os links não funcionarão de fora.
- **`TRUSTED_PROXY_HOPS`** decide qual endereço o limite por endereço conta. O padrão `1` é correto para as configurações padrão de Docker Compose e Helm; some um para cada proxy seu — CDN, WAF ou balanceador — que acrescenta a `X-Forwarded-For`, caso contrário todo cliente de calendário parece o mesmo endereço e todos dividem um único orçamento. Veja [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) na documentação do chart.
- **Redis** sustenta os caches e o limitador. Ambos degradam de forma controlada: sem Redis os feeds ainda são gerados, apenas mais devagar, e o limitador deixa as requisições passarem.
- No modo dividido do chart Helm (`worker.enabled: true`) os feeds são gerados na camada de API; dimensione essa camada para uma rajada de clientes de calendário consultando na hora cheia.
- A exceção do log de acesso do Nginx mostrada acima faz parte do `Nginx/default.conf.template` distribuído; mantenha-a se personalizar o template.

## Solução de problemas

**Nada leu o link, ou "Não foi possível buscar a URL".** Google Agenda, Outlook na web, Fastmail e Proton leem **a partir dos próprios servidores**, então o host do OneUptime precisa estar acessível pela internet pública com um certificado em que eles confiem. Uma instalação em rede privada, atrás de uma VPN ou com uma autoridade certificadora interna é inacessível para eles, não importa o que você cole. Calendário da Apple, Thunderbird e Outlook clássico leem a partir do dispositivo, então funcionam onde o dispositivo consiga abrir o painel — depois de confiar no certificado naquele dispositivo, se for autoassinado. A linha de status da página do feed diz se algo já leu o link; `curl -I` no link de fora da sua rede é a verificação mais rápida. Permitir que o OneUptime _alcance_ redes privadas — [Acesso a redes privadas](/docs/self-hosted/private-network-access) — é outro assunto e não ajuda aqui.

**O calendário está desatualizado.** Leia primeiro a tabela de atualização: no Google o atraso é normal. Para fazer o Google olhar de novo, remova e adicione a agenda novamente ou acrescente `?nocache=1` ao link (parâmetros desconhecidos são ignorados, o feed é o mesmo, mas o Google o trata como novo). No Outlook clássico pressione F9 e confira a configuração **Limite de atualização**. No Calendário da Apple use **Visualizar** > **Atualizar Calendários**. Se uma mudança do mesmo dia importa, confie nos lembretes e avisos de reatribuição do OneUptime em vez do calendário.

**O calendário está vazio.** Um calendário vazio é proposital. Significa que o link está desativado, é um link antigo dentro do período de carência de 30 dias após regenerar, o projeto está abaixo do plano que inclui escalas de plantão, ou você não está mais em nenhuma escala daquele projeto. Abra o link em um navegador: a descrição do calendário (`X-WR-CALDESC`) informa o motivo.

**404.** O link é desconhecido, foi excluído ou seu período de carência terminou. Gere um novo e assine de novo.

**503.** Ou `DISABLE_ON_CALL_CALENDAR_FEED` está definido, ou o servidor está ocupado: no máximo alguns feeds são gerados ao mesmo tempo, e uma escala que demora demais para ser calculada é interrompida. Quando existe uma cópia anterior do feed, o servidor a serve no lugar com um cabeçalho `Warning: 110`, então um 503 significa que não havia nada para recorrer. Os clientes mantêm a última cópia e tentam de novo após o intervalo `Retry-After`. O Fastmail desativa uma assinatura após cinco falhas seguidas; adicione-a de novo quando o servidor estiver saudável. A métrica `oncall_calendar_render_duration_ms` mostra aos operadores quais feeds são lentos.

**429 ou "muitas requisições".** Muitos clientes atrás de um mesmo endereço — um NAT de escritório, um gateway VPN — dividem o orçamento por endereço. Aumente `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW` e confira `TRUSTED_PROXY_HOPS`: se estiver baixo demais, todo cliente é atribuído ao seu próprio proxy e todos dividem um único orçamento.

**Erros de certificado no Calendário da Apple, Thunderbird ou Outlook.** Esses aplicativos validam TLS no dispositivo. Importe sua CA interna para o repositório de confiança do dispositivo — as Chaves do macOS, o repositório de certificados do Windows, o gerenciador de certificados do Thunderbird — ou use um certificado de confiança pública. Leitores do lado do servidor como Google e Microsoft não podem ser levados a confiar em uma CA privada.

**Os horários estão errados.** Todos os horários no arquivo estão em UTC; o aplicativo de calendário converte para o próprio fuso. Se os turnos parecem deslocados por um intervalo fixo, confira o fuso da escala (aba **Configurações**) e o seu (**Configurações do usuário** > **Perfil**). Uma escala sem fuso é calculada no fuso do servidor e o evento informa isso.

**O feed diz que foi encurtado.** Mais de 5.000 eventos caíram dentro da janela. Reduza **Dias à frente**, ou assine **Somente meus turnos nesta escala** em vez de um projeto inteiro.

**O Google mostra um nome de agenda antigo.** O Google lê o nome apenas na primeira assinatura; remova e adicione a agenda de novo.

**A página de configurações diz que o link precisa ser regenerado.** `ENCRYPTION_SECRET` mudou desde que o link foi criado, então o servidor não consegue mais mostrá-lo. A assinatura existente continua funcionando; regenerar lhe dá um link que pode ser copiado de novo e aposenta o antigo após 30 dias.

**Um turno está faltando no meu feed.** Só turnos de escala aparecem; atribuições diretas de usuário ou equipe em uma regra de política são fixas e não têm eventos. Um turno assumido por outra pessoa por substituição sai do seu feed porque agora está no dela. Ative **Incluir turnos que cubro por outros** para ver turnos obtidos por substituições em escalas das quais você não é membro.
