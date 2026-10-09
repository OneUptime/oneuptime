# Notificações Push

As notificações push nativas (iOS/Android) usam **Expo Push**. Instâncias auto-hospedadas utilizam por padrão o relay do OneUptime e precisam de acesso de saída a ele.

## Como Funciona

O aplicativo móvel OneUptime registra um Expo Push Token no backend. O backend envia notificações pelo relay do OneUptime ou diretamente ao Expo quando `EXPO_ACCESS_TOKEN` está configurado. O Expo encaminha para Apple APNs ou Google FCM para entrega ao dispositivo.

As notificações push da web continuam usando chaves VAPID e o protocolo Web Push.

## Configuração Auto-Hospedada

O aplicativo oficial com o relay padrão não exige credenciais Expo no servidor. Para entrega direta, configure `EXPO_ACCESS_TOKEN` com credenciais do projeto Expo do aplicativo. Web push exige `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT`.

## Acesso à rede

| Direção | Destino | Protocolo / porta | Quando necessário |
| --- | --- | --- | --- |
| OneUptime → relay padrão | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | Push móvel sem `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | Push móvel direto com `EXPO_ACCESS_TOKEN`. |
| OneUptime → serviço push do navegador | Endpoint HTTPS da inscrição push | HTTPS / normalmente TCP 443 | Web push. |
| Aplicativo móvel ou navegador → OneUptime | Seu hostname OneUptime | HTTPS / TCP 443 | Login, registro do dispositivo e abertura de links de notificações. |

Se alterar `PUSH_NOTIFICATION_RELAY_URL`, permita seu hostname e porta configurada. Um relay personalizado deve implementar a API de relay do OneUptime. Os padrões e a seleção do modo estão na [configuração](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) e no [serviço push do OneUptime](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts); o endpoint direto está documentado no [Expo](https://docs.expo.dev/push-notifications/sending-notifications/). O OneUptime lê os recibos de entrega do relay no mesmo endereço, com `/receipts` no lugar de `/send`. Um relay sem essa rota continua entregando os pushes; nesse caso, um dispositivo cujo aplicativo foi removido só é percebido quando um push posterior para ele é recusado.

Para web push, permita os hosts reais dos endpoints dos navegadores usados. O OneUptime aceita `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` e `push.apple.com`, incluindo subdomínios como `updates.push.services.mozilla.com` e `web.push.apple.com`. A [inscrição do navegador](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) determina o destino. Permitir somente Expo ou o relay não habilita web push.

Permita DNS e TLS de saída do processo OneUptime que envia notificações. Seu armazenamento de certificados deve validar o certificado de destino; proxies devem encaminhar chamadas API sem autenticação interativa. Os provedores push não chamam webhooks no OneUptime. O servidor pode continuar privado se os dispositivos o acessarem por VPN ou outra conexão privada. Sem acesso ao relay ou aos serviços push externos, as notificações não podem ser entregues.

A conectividade dos dispositivos é separada. iOS precisa de APNs, normalmente TCP 5223 com TCP 443 como alternativa; consulte as faixas atuais da [Apple](https://support.apple.com/en-us/102266). Android precisa de FCM em TCP 5228–5230 e 443; consulte hosts e regras atuais do [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Não abra essas portas de entrada no OneUptime: o servidor usa o relay ou Expo para push móvel, não APNs/FCM diretamente.

Verifique DNS e HTTPS do container ou pod remetente ao destino do modo selecionado. Envie um teste em **User Settings > Notification Methods > Push** e confirme a recepção no dispositivo registrado. Teste web push em cada navegador separadamente. Confira erros de relay, Expo ou web-push nos logs do OneUptime; a aceitação pela API não confirma a entrega ao dispositivo. Para pushes móveis, o OneUptime também lê o recibo de entrega do Expo cerca de 15 minutos após cada push: um push que nunca chegou ao dispositivo aparece então como não entregue no log de push e, para um alerta de plantão, na linha do tempo de plantão.

## Solução de Problemas

### Notificações push não chegando

- Certifique-se de que o aplicativo móvel foi compilado com EAS Build (o Expo Go não suporta notificações push)
- Verifique se o dispositivo está registrado na tabela `UserPush` no seu banco de dados
- Verifique os logs do servidor do OneUptime para erros da API Expo Push
- Confirme que o dispositivo tem uma conexão ativa com a internet e as permissões de notificação habilitadas
- Verifique **User Settings > Notification Methods > Push**: um dispositivo marcado como **Não está recebendo notificações** parou de recebê-las e precisa ser registrado novamente (veja abaixo)

### Pushes marcados como "não entregue"

O Expo aceitar um push não significa que ele chegou ao dispositivo: a Apple ou o Google ainda podem recusá-lo. O OneUptime lê o recibo de entrega de cada push móvel cerca de 15 minutos após o envio, pelo relay de push quando `EXPO_ACCESS_TOKEN` não está definido. Quando o recibo informa um erro, o log de push e a linha do tempo de plantão do alerta mudam de enviado para **Push notification not delivered**, com o código de erro do Expo:

- `DeviceNotRegistered`: o aplicativo móvel foi removido do dispositivo ou seu token push não é mais válido. Veja a próxima seção.
- `MessageRateExceeded`: foram enviadas notificações demais ao dispositivo em pouco tempo. Os pushes seguintes para ele são enviados normalmente.
- `MessageTooBig`: a notificação era maior do que os serviços de push aceitam. O OneUptime encurta as notificações para caberem, então isso não deveria acontecer; se acontecer, informe-nos.
- `InvalidCredentials` ou `MismatchSenderId`: as credenciais de push do projeto Expo que enviou o push não são válidas. Com `EXPO_ACCESS_TOKEN`, verifique as credenciais de push do seu projeto Expo; com o relay padrão, entre em contato com o suporte do OneUptime.

Quando o Expo recusa um push na hora, o log de push informa o motivo na hora. Pelo relay de push isso também acontece: o relay repassa o código de erro do Expo em vez de responder com um erro de servidor.

### Erros "DeviceNotRegistered" nos logs

O Expo informa `DeviceNotRegistered` quando o aplicativo móvel foi removido do dispositivo ou o token push do dispositivo não é mais válido. Normalmente ele informa isso no recibo de entrega de um push, que o OneUptime lê cerca de 15 minutos após o envio, e às vezes recusa o push na hora. Em ambos os casos, o OneUptime para de enviar para esse dispositivo. Ele é marcado como não recebendo notificações em vez de excluído, então suas regras de notificação permanecem, e o log de push e a linha do tempo de plantão do alerta que não chegou informam o motivo. **User Settings > Notification Methods > Push** o mostra como **Não está recebendo notificações**. Os outros dispositivos e métodos de notificação do proprietário continuam sendo acionados.

Para recuperar o dispositivo, abra o aplicativo móvel nele enquanto estiver logado. O aplicativo se registra novamente, o que renova seu token push no Expo, e o dispositivo volta a receber notificações com suas regras. Se o aplicativo foi removido, instale-o novamente e faça login. O recibo de um push enviado antes de o aplicativo se registrar novamente não marca o dispositivo. Quando um aplicativo móvel atualizado é configurado em um telefone novo a partir de um backup do antigo, ele informa ao OneUptime o token push que tinha antes; se o dispositivo do telefone antigo não recebe mais notificações, o telefone novo o assume com suas regras.

Pelo relay de push (sem `EXPO_ACCESS_TOKEN`) funciona da mesma forma: o relay informa `DeviceNotRegistered` quando envia um push e lê os recibos de entrega que sua instância solicita.

## Suporte

Se você encontrar problemas com notificações push, por favor:

1. Verifique a seção de solução de problemas acima
2. Revise os logs do OneUptime para mensagens de erro detalhadas
3. Entre em contato conosco em [hello@oneuptime.com](mailto:hello@oneuptime.com)
