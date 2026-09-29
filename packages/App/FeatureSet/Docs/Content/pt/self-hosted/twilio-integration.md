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

Uma implantação privada precisa de acesso HTTPS de saída ao Twilio para enviar solicitações de SMS e chamadas. O Twilio recomenda permitir HTTPS de saída para `*.twilio.com`, pois seus endereços de API são dinâmicos; consulte os [endereços IP do Twilio](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). Aplique isso ao tráfego de saída da aplicação OneUptime, incluindo NetworkPolicies do Kubernetes e firewalls externos. Permita resolução DNS e HTTPS (TCP 443) de saída da aplicação OneUptime.

O acesso de entrada depende do recurso:

| Recurso | O Twilio precisa acessar o OneUptime? |
| --- | --- |
| Envio de SMS | Não. As atualizações do status de entrega precisam de um callback. |
| Chamada de voz de teste simples | Não. O OneUptime fornece as instruções de voz junto com a solicitação de saída à API. |
| Pressionar 1 para reconhecer um alerta de plantão | Sim. O Twilio envia a entrada do teclado ao OneUptime. |
| Políticas de chamadas recebidas | Sim. O Twilio solicita instruções de chamada e informa os resultados da discagem. |

Estes são os caminhos externos pelo gateway Nginx do OneUptime; os espaços reservados variam por notificação:

| Método | Caminho | Finalidade |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | Status de entrega de SMS |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | Reconhecimento pelo teclado |
| POST | `/notification/incoming-call/voice` | Instruções opcionais de chamadas recebidas |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | Resultados opcionais do roteamento de chamadas recebidas |

O OneUptime gera automaticamente as URLs de SMS e de reconhecimento. Não substitua seus tokens por uma URL de webhook estática. Para chamadas recebidas, siga o guia de [políticas de chamadas recebidas](/docs/on-call/incoming-call-policy), que configura o webhook do número quando você associa um número.

O Twilio exige [URLs de webhook acessíveis publicamente](https://www.twilio.com/docs/usage/webhooks/webhooks-overview). Use um certificado TLS de confiança pública e preserve host, protocolo, caminho, parâmetros de consulta, corpo e cabeçalho `X-Twilio-Signature` originais ao passar pelos proxies. Os manipuladores de chamadas recebidas validam as assinaturas do Twilio; a entrega de SMS usa um token de URL por mensagem, e o reconhecimento pelo teclado usa um token de consulta assinado. Não exponha tokens em logs ou capturas de tela compartilhados. Consulte a [segurança dos webhooks do Twilio](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

### Produção: publique um gateway para a implantação privada

1. **Escolha um nome de host**, por exemplo `oneuptime.example.com`. Publique registros DNS públicos apontando para um gateway acessível pela Internet. Os fornecedores não conseguem acessar endereços IP privados nem nomes DNS exclusivamente internos. Com DNS dividido, os funcionários podem resolver o mesmo nome de host para o ingress privado e continuar usando o painel pela VPN. O ingress privado também precisa oferecer HTTPS com um certificado válido para esse nome de host.

2. **Conecte o gateway ao OneUptime.** Coloque-o em uma DMZ com uma rota para o ingress privado ou use um gateway público conectado pela sua própria VPN de site a site ou conexão privada. Permita tráfego do gateway ao ingress na porta do serviço de destino. Para Kubernetes/Portainer, um serviço privado `ClusterIP` por si só não basta: o gateway precisa de um ingress/controlador ou outro destino acessível. Mantenha bancos de dados e outros serviços internos privados.

3. **Termine HTTPS na porta 443** com um certificado de confiança pública e uma cadeia intermediária completa. Permita TCP de entrada na porta 443 do gateway. Instalar um certificado ou alterar o DNS, por si só, não cria a rota para o destino privado.

4. Publique apenas as rotas de callback da tabela acima pelo gateway Nginx do OneUptime, que mapeia `/notification` para a aplicação. Preserve `/api` na rota de confirmação pelo teclado. Preserve método, caminho, query string, corpo e cabeçalhos de autenticação (`X-Twilio-Signature`). Mantenha o `Host` público e defina cabeçalhos confiáveis `X-Forwarded-Host` e `X-Forwarded-Proto: https`. Não adicione redirecionamentos.

5. Isente essas rotas de SSO do navegador, CAPTCHA e páginas de login do proxy. Mantenha a autenticação do OneUptime ativa. Restrinja o acesso à origem ao gateway e aos clientes internos autorizados; oculte tokens nos logs.

6. **Defina a URL canônica do OneUptime**:

   Docker Compose, em `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Valores de Helm/Portainer:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   Substitua o exemplo pelo seu domínio. Esses ajustes geram URLs; não criam DNS, TLS nem regras de firewall. Aplique a configuração do Compose ou a atualização do Helm e aguarde a aplicação reiniciar. O OneUptime não oferece um hostname separado para callbacks do Twilio. Se o nome mudar, atualize também os webhooks dos números Twilio existentes.

As [configurações de acesso à rede privada](/docs/self-hosted/private-network-access) controlam solicitações de saída do OneUptime para serviços internos. Ativar `ALLOW_PRIVATE_NETWORK_WEBHOOKS` não torna o OneUptime acessível ao Twilio.

### Acesso de saída e restrições de IP

Os endereços de origem dos webhooks comuns do Twilio mudam; não use intervalos SIP ou de mídia como lista de permissões. Edições elegíveis oferecem [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy). Verifique a elegibilidade e os produtos compatíveis e configure o firewall com os intervalos publicados atuais. Continue autenticando os callbacks.

### Testes e implantações sem acesso de entrada

Sem acesso de entrada, o envio de SMS e a reprodução de voz simples podem funcionar com HTTPS de saída. Status de entrega, confirmação pelo teclado e roteamento de chamadas de entrada precisam de callbacks acessíveis. Uma instalação totalmente desconectada não pode usar o Twilio.

Para desenvolvimento, o [guia de testes de webhooks do Twilio](https://www.twilio.com/docs/usage/webhooks/webhook-testing) descreve um túnel público. Encaminhe-o a um proxy que permita apenas as rotas necessárias, configure o hostname resultante como acima e pare o túnel após os testes. Um túnel continua expondo acesso de entrada.

## 4. Teste a entrega e os callbacks separadamente

1. De fora da rede corporativa e da VPN, verifique se o hostname dos callbacks resolve para o gateway público e apresenta um certificado TLS válido. Um GET do navegador não testa esses callbacks POST.
2. Use **Enviar SMS de teste** e **Enviar chamada de teste** na configuração do Twilio do projeto. Confirme o recebimento no telefone de destino.
3. Configure o contato verificado do usuário para SMS/chamadas e suas regras de notificação; depois, acione um alerta de plantão controlado. Pressione 1 e confirme o reconhecimento no OneUptime. Se você usa políticas de chamadas de entrada, ligue para o número configurado e verifique o roteamento e o registro de chamadas.
4. Confirme o status de entrega do SMS no OneUptime e nos logs de mensagens do Twilio. Um envio aceito não comprova a entrega; [o Twilio informa alterações posteriores de status por callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

Se o envio falhar, verifique credenciais, recursos do número, restrições da conta e conectividade de saída. Se a mensagem ou chamada chegar, mas o status ou reconhecimento não for atualizado, examine a URL do callback e os logs do ingress público. O [guia do Twilio sobre falhas de recuperação HTTP](https://www.twilio.com/docs/api/errors/11200) ajuda a diagnosticar callbacks inacessíveis, problemas de TLS e erros HTTP. Uma chamada de teste bem-sucedida, por si só, não verifica o acesso dos callbacks.
