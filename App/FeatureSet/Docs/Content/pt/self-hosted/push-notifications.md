# Notificações Push

As notificações push nativas (iOS/Android) são alimentadas pelo **Expo Push** e **não requerem configuração do lado do servidor** para instâncias auto-hospedadas.

## Como Funciona

O aplicativo móvel do OneUptime registra um Expo Push Token com o backend. Quando o backend precisa enviar uma notificação, ele faz POST para a API pública do Expo Push, que roteia a mensagem para o Apple APNs ou Google FCM em nome do aplicativo.

As notificações push da web continuam usando chaves VAPID e o protocolo Web Push.

## Configuração Auto-Hospedada

Nenhuma configuração de notificação push é necessária. O binário do aplicativo móvel lida com todo o registro de plataforma automaticamente via infraestrutura de push do Expo.

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
