# Atrás de uma VPN ou firewall

Um OneUptime auto-hospedado pode ficar fora da internet pública: ele envia todos os alertas por conexões de saída. Algumas coisas, porém, chegam de fora. Quem está de plantão toca em **Acknowledge** em uma mensagem, o Twilio informa uma tecla pressionada em uma chamada, o Slack informa o clique em um botão. Esta página lista cada uma delas, quem se conecta ao seu servidor para isso e por qual caminho, para que você publique só o que usa, ou nada.

:::cards
- [Quem se conecta ao seu servidor](#quem-se-conecta-ao-seu-servidor): Os celulares de quem está de plantão e os provedores que enviam callbacks.
- [Manter tudo privado](#manter-tudo-privado): Coloque os celulares da equipe de plantão na sua VPN.
- [Publicar só as páginas de confirmação](#publicar-só-as-páginas-de-confirmação): Uma entrada estreita para os links de confirmação.
- [Callbacks dos provedores](#callbacks-dos-provedores): Telegram, Twilio, WhatsApp, Slack e Microsoft Teams.
:::

## Quem se conecta ao seu servidor

O envio nunca precisa de acesso de entrada: o OneUptime se conecta, de dentro para fora, ao seu servidor de e-mail, ao Twilio, ao Telegram, à Meta, ao Slack, à Microsoft e ao relay de push. O que chega de fora é uma destas coisas:

| O que acontece | Quem se conecta ao seu servidor | Uma lista de permissões de endereços de origem resolve? |
| --- | --- | --- |
| Quem está de plantão toca em **Acknowledge** em um e-mail, SMS ou mensagem do WhatsApp ou do Telegram | O celular ou o computador dessa pessoa | Não: ele se conecta de onde a pessoa estiver |
| Quem está de plantão confirma no app OneUptime On-Call | O celular dessa pessoa | Não: pelo mesmo motivo |
| Quem está de plantão pressiona 1 em uma chamada de plantão | Twilio | Só com o Static Proxy for Webhooks do Twilio |
| Alguém vincula a própria conta do Telegram | Telegram | Sim, ou consulte o Telegram periodicamente e não libere nada |
| Alguém clica em um botão de uma mensagem do Slack ou do Microsoft Teams | Slack ou Microsoft | Não: nenhum dos dois publica endereços fixos |
| O WhatsApp informa que uma mensagem foi entregue ou lida | Meta | Não: a Meta não publica endereços fixos |

Um servidor auto-hospedado fala diretamente com esses provedores, nunca pelos servidores do próprio OneUptime, então não existe uma lista de endereços do OneUptime para liberar.

## Manter tudo privado

Coloque os celulares da equipe de plantão na sua VPN, sempre ligada ou sob demanda para o nome de host do seu OneUptime, para que ninguém precise conectá-la antes de confirmar um acionamento às 3 da manhã. Sem nada publicado:

- Os links de confirmação em e-mails, SMS e mensagens do WhatsApp e do Telegram abrem, porque o celular alcança o seu servidor.
- O app OneUptime On-Call funciona: aponte-o para o endereço do seu servidor. As notificações push não precisam de acesso de entrada, porque o servidor as envia pelo relay de push.
- As pessoas vinculam as contas do Telegram assim que você ativa a consulta periódica (veja [Telegram](#telegram)).

Um link em um app de mensagens abre no navegador do próprio app ou no navegador padrão do celular, nunca no app do OneUptime. Por isso, uma VPN por app precisa cobrir os apps de mensagens e o navegador, não só o app do OneUptime.

Pressionar 1 em uma chamada, os botões das mensagens do Slack e do Microsoft Teams e os status de entrega do WhatsApp continuam precisando que o respectivo provedor alcance o seu servidor.

## Publicar só as páginas de confirmação

Se os celulares da equipe de plantão não puderem usar a sua VPN, publique as páginas que um link de confirmação abre, e nada mais. Coloque um proxy reverso na frente do OneUptime, ou um túnel de saída como o Cloudflare Tunnel, que não precisa de nenhuma regra de entrada no firewall, e deixe passar só estes caminhos:

| Método | Caminho | O que entrega |
| --- | --- | --- |
| GET | `/l/*` | Os links curtos das mensagens de SMS, WhatsApp e Telegram |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | A página que mostra o motivo do acionamento, com o botão **Acknowledge** |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | O botão **Acknowledge** |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | Opcional: a página que repassa o acionamento para a próxima pessoa |
| POST | `/api/user-notification-log-timeline/pass-on/*` | Opcional: o botão dessa página |
| GET | `/oneuptime-assets/*` | As fontes, os estilos e o logotipo dessas páginas |

:::steps
### Aponte um nome público para o proxy
Os links das mensagens são montados a partir da sua configuração `HOST`, então esse nome precisa resolver publicamente para o proxy, com um certificado de confiança pública. Com DNS dividido, as pessoas na sua rede continuam resolvendo esse nome para o endereço privado e usam todo o resto como antes.

### Encaminhe os caminhos sem alterações
Envie esses caminhos ao ingress do OneUptime com o método, o caminho e a string de consulta, e responda a todo o resto com 404.

### Limite a taxa de requisições
Cada link carrega um ID aleatório, e um link curto tem oito letras. Limite as requisições que cada endereço pode fazer, para que ninguém consiga testar IDs em alta velocidade.
:::

Depois que alguém de plantão confirma, a página abre o alerta no painel, que só carrega na sua rede. A essa altura, a confirmação já foi salva.

## Callbacks dos provedores

### Telegram

Enviar alertas só exige HTTPS de saída para `api.telegram.org`. Vincular uma conta significa o seu servidor receber a mensagem `/start` que uma pessoa envia ao seu bot, de uma de duas formas:

- **Por consulta periódica**: ative **Poll Telegram for Messages** em **Admin Dashboard > Configurações > Telegram**. O OneUptime busca as mensagens do bot no Telegram a cada poucos segundos por HTTPS de saída, então nada precisa alcançar o seu servidor.
- **Por webhook**: o Telegram envia cada mensagem para `POST /api/notification/telegram/webhook`. O Telegram [envia webhooks](https://core.telegram.org/bots/webhooks) a partir de `149.154.160.0/20` e `91.108.4.0/22`, então você pode liberar só esses endereços.

### Twilio

Quando alguém de plantão pressiona 1 em uma chamada para confirmar o acionamento, o Twilio envia a tecla para `POST /api/user-notification-log-timeline/call/gather-input/*`. Os endereços de webhook do Twilio mudam, a menos que a sua edição do Twilio inclua o [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). As atualizações de entrega de SMS e as chamadas recebidas estão descritas em [Integração do Twilio](/docs/self-hosted/twilio-integration).

### WhatsApp

Os alertas e as confirmações não precisam de nada de entrada. A Meta envia os status de entrega e de leitura para `/api/notification/whatsapp/webhook`; sem eles, o log de WhatsApp do OneUptime não consegue mostrar se uma mensagem foi entregue, lida ou falhou depois que a Meta a aceitou. A Meta assina cada requisição e não publica endereços fixos.

### Slack e Microsoft Teams

Os botões, os menus e os comandos das mensagens deles chamam o seu servidor a partir de endereços que nenhum dos dois publica. Os caminhos, e como publicá-los, estão em [Integração com Slack](/docs/self-hosted/slack-integration) e [Integração com Microsoft Teams](/docs/self-hosted/microsoft-teams-integration).

## Próximos passos

:::cards
- [Integração do Twilio](/docs/self-hosted/twilio-integration): SMS e chamadas pela sua própria conta do Twilio.
- [Notificações push](/docs/self-hosted/push-notifications): O relay de push, e o que o seu servidor e os celulares alcançam.
- [Visão geral dos aplicativos](/docs/mobile-desktop-apps/index): Conecte o app OneUptime On-Call ao seu servidor.
- [Acesso à rede privada](/docs/self-hosted/private-network-access): No sentido inverso: deixe o OneUptime alcançar as suas ferramentas internas.
:::
