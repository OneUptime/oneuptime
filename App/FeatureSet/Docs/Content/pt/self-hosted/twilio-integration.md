# Integração do Twilio para SMS e chamadas de voz

O OneUptime auto-hospedado usa sua conta Twilio para enviar alertas por SMS e chamadas de voz. Você paga diretamente ao Twilio. Configure as credenciais no painel do OneUptime: o envio de notificações lê a configuração salva, e o chart Helm não inclui valores para credenciais do Twilio. Uma migração antiga importava `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_PHONE_NUMBER`; alterar essas variáveis não é a forma de atualizar as credenciais de uma instalação existente.

## 1. Prepare sua conta Twilio

1. Abra o [console do Twilio](https://console.twilio.com/) e obtenha seu **Account SID** e **Auth Token**.
2. Obtenha um número de telefone Twilio com os recursos de SMS e/ou voz necessários. Use o formato E.164, incluindo o código do país, nos números de remetente e destinatário.
3. Verifique o saldo da conta, as permissões para os países de destino e os requisitos aplicáveis de registro de remetentes. Contas de avaliação têm restrições de destinatários, geográficas e de outros tipos que podem impedir o funcionamento de alertas reais do OneUptime. Consulte a [documentação do Twilio sobre contas e avaliações](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account) antes dos testes. Use uma conta paga em produção.

## 2. Salve as credenciais no OneUptime

Para um projeto:

1. Acesse **Configurações do projeto > Notificações > Configurações de notificações**.
2. Em **Configuração do Twilio**, selecione **Criar configuração do Twilio**.
3. Insira um nome, **Twilio Account SID**, **Twilio Auth Token** e **Número de telefone principal do Twilio**. Opcionalmente, insira **Números de telefone secundários do Twilio** para outros países, separados por vírgulas.
4. Ative **Definir como padrão do projeto** para usar essa configuração em SMS e chamadas para os membros do projeto, incluindo notificações de plantão. Criar uma configuração sem ativar essa opção não a seleciona para essas notificações.
5. Salve. Apenas uma configuração pode ser o padrão do projeto. As páginas de status usam a configuração explicitamente atribuída a cada página.

Para um padrão de toda a instalação, um administrador pode abrir **Painel de administração > Configurações > Chamadas e SMS**, editar as credenciais e os números do Twilio e salvar. As notificações dos membros usam essa configuração global quando o projeto não tem um padrão. Mantenha o Auth Token confidencial.

## 3. Configure o acesso à rede

Uma implantação privada precisa de acesso HTTPS de saída ao Twilio para enviar solicitações de SMS e chamadas. O Twilio recomenda permitir HTTPS de saída para `*.twilio.com`, pois seus endereços de API são dinâmicos; consulte os [endereços IP do Twilio](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Aplique isso ao tráfego de saída da aplicação OneUptime, incluindo NetworkPolicies do Kubernetes e firewalls externos.

O acesso de entrada depende do recurso:

| Recurso | O Twilio precisa acessar o OneUptime? |
| --- | --- |
| Envio de SMS | Não. As atualizações do status de entrega precisam de um callback. |
| Chamada de voz de teste simples | Não. O OneUptime fornece as instruções de voz junto com a solicitação de saída à API. |
| Pressionar 1 para reconhecer um alerta de plantão | Sim. O Twilio envia a entrada do teclado ao OneUptime. |
| Políticas de chamadas recebidas | Sim. O Twilio solicita instruções de chamada e informa os resultados da discagem. |

Para callbacks, siga o guia de [acesso à rede para Twilio e Microsoft Teams](/docs/self-hosted/integration-network-access) para publicar as rotas HTTPS necessárias por um ingress ou proxy reverso, mantendo o painel privado. Uma VPN no laptop de um administrador não fornece conectividade ao Twilio.

Defina `HOST=oneuptime.example.com` e `HTTP_PROTOCOL=https` no `config.env` do Docker Compose, ou `host: oneuptime.example.com` e `httpProtocol: https` nos valores do Helm, e aplique a alteração da implantação. Substitua o exemplo pelo seu domínio. Essas configurações determinam as URLs geradas; não criam registros DNS, certificados nem regras de firewall. O OneUptime não tem uma configuração separada de nome de host para callbacks do Twilio.

Estes são os caminhos externos pelo gateway Nginx do OneUptime; os espaços reservados variam por notificação:

| Método | Caminho | Finalidade |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | Status de entrega de SMS |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Reconhecimento pelo teclado |
| POST | `/notification/incoming-call/voice` | Instruções opcionais de chamadas recebidas |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Resultados opcionais do roteamento de chamadas recebidas |

O OneUptime gera automaticamente as URLs de SMS e de reconhecimento. Não substitua seus tokens por uma URL de webhook estática. Para chamadas recebidas, siga o guia de [políticas de chamadas recebidas](/docs/on-call/incoming-call-policy), que configura o webhook do número quando você associa um número.

O Twilio exige [URLs de webhook acessíveis publicamente](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Use um certificado TLS de confiança pública e preserve host, protocolo, caminho, parâmetros de consulta, corpo e cabeçalho `X-Twilio-Signature` originais ao passar pelos proxies. Os manipuladores de chamadas recebidas validam as assinaturas do Twilio; a entrega de SMS usa um token de URL por mensagem, e o reconhecimento pelo teclado usa um token de consulta assinado. Não exponha tokens em logs ou capturas de tela compartilhados. Consulte a [segurança dos webhooks do Twilio](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

## 4. Teste a entrega e os callbacks separadamente

1. Use **Enviar SMS de teste** e **Enviar chamada de teste** na configuração do Twilio do projeto. Confirme o recebimento no telefone de destino.
2. Configure o contato verificado do usuário para SMS/chamadas e suas regras de notificação; depois, acione um alerta de plantão controlado. Pressione 1 e confirme o reconhecimento no OneUptime.
3. Confirme o status de entrega do SMS no OneUptime e nos logs de mensagens do Twilio. Um envio aceito não comprova a entrega; [o Twilio informa alterações posteriores de status por callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Se o envio falhar, verifique credenciais, recursos do número, restrições da conta e conectividade de saída. Se a mensagem ou chamada chegar, mas o status ou reconhecimento não for atualizado, examine a URL do callback e os logs do ingress público. O [guia do Twilio sobre falhas de recuperação HTTP](https://www.twilio.com/docs/api/errors/11200) ajuda a diagnosticar callbacks inacessíveis, problemas de TLS e erros HTTP. Uma chamada de teste bem-sucedida, por si só, não verifica o acesso dos callbacks.
