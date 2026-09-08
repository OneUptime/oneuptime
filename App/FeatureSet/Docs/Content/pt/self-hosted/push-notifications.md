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
| OneUptime → relay padrão | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | Push móvel sem `EXPO_ACCESS_TOKEN`. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | Push móvel direto com `EXPO_ACCESS_TOKEN`. |
| OneUptime → serviço push do navegador | Endpoint HTTPS da inscrição push | HTTPS / normalmente TCP 443 | Web push. |
| Aplicativo móvel ou navegador → OneUptime | Seu hostname OneUptime | HTTPS / TCP 443 | Login, registro do dispositivo e abertura de links de notificações. |

Se alterar `PUSH_NOTIFICATION_RELAY_URL`, permita seu hostname e porta configurada. Um relay personalizado deve implementar a API de relay do OneUptime. Os padrões e a seleção do modo estão na [configuração](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) e no [serviço push do OneUptime](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts); o endpoint direto está documentado no [Expo](https://docs.expo.dev/push-notifications/sending-notifications/).

Para web push, permita os hosts reais dos endpoints dos navegadores usados. O OneUptime aceita `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` e `push.apple.com`, incluindo subdomínios como `updates.push.services.mozilla.com` e `web.push.apple.com`. A [inscrição do navegador](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) determina o destino. Permitir somente Expo ou o relay não habilita web push.

Permita DNS e TLS de saída do processo OneUptime que envia notificações. Seu armazenamento de certificados deve validar o certificado de destino; proxies devem encaminhar chamadas API sem autenticação interativa. Os provedores push não chamam webhooks no OneUptime. O servidor pode continuar privado se os dispositivos o acessarem por VPN ou outra conexão privada. Sem acesso ao relay ou aos serviços push externos, as notificações não podem ser entregues.

A conectividade dos dispositivos é separada. iOS precisa de APNs, normalmente TCP 5223 com TCP 443 como alternativa; consulte as faixas atuais da [Apple](https://support.apple.com/en-us/102266). Android precisa de FCM em TCP 5228–5230 e 443; consulte hosts e regras atuais do [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration). Não abra essas portas de entrada no OneUptime: o servidor usa o relay ou Expo para push móvel, não APNs/FCM diretamente.

Verifique DNS e HTTPS do container ou pod remetente ao destino do modo selecionado. Envie um teste em **User Settings > Notification Methods > Push** e confirme a recepção no dispositivo registrado. Teste web push em cada navegador separadamente. Confira erros de relay, Expo ou web-push nos logs do OneUptime; a aceitação pela API não confirma a entrega ao dispositivo.

## Solução de Problemas

### Notificações push não chegando

- Certifique-se de que o aplicativo móvel foi compilado com EAS Build (o Expo Go não suporta notificações push)
- Verifique se o dispositivo está registrado na tabela `UserPush` no seu banco de dados
- Verifique os logs do servidor do OneUptime para erros da API Expo Push
- Confirme que o dispositivo tem uma conexão ativa com a internet e as permissões de notificação habilitadas

### Erros "DeviceNotRegistered" nos logs

O Expo Push Token não é mais válido. Isso geralmente significa que o aplicativo foi desinstalado ou o usuário revogou as permissões de notificação. O token será limpo automaticamente.

## Suporte

Se você encontrar problemas com notificações push, por favor:

1. Verifique a seção de solução de problemas acima
2. Revise os logs do OneUptime para mensagens de erro detalhadas
3. Entre em contato conosco em [hello@oneuptime.com](mailto:hello@oneuptime.com)
