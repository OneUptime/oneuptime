# Acesso às integrações a partir de redes privadas

Uma instância auto-hospedada do OneUptime pode enviar solicitações ao Twilio e à Microsoft e continuar inacessível aos serviços de nuvem desses fornecedores. A conexão VPN de um funcionário não dá a nenhum deles acesso à rede privada. Use o [guia de configuração do Twilio](/docs/self-hosted/twilio-integration) e o [guia de configuração do Teams](/docs/self-hosted/microsoft-teams-integration) junto com as etapas de rede abaixo.

## Em qual direção o acesso é necessário?

| Recurso | Do OneUptime ao fornecedor | Do fornecedor ao OneUptime |
| --- | --- | --- |
| Enviar SMS ou reproduzir um alerta de voz de saída simples | HTTPS | Não é necessário para enviar o SMS ou reproduzir instruções de voz fornecidas diretamente |
| Atualizações de entrega de SMS, ações do teclado de voz, roteamento de chamadas recebidas | HTTPS | Callbacks obrigatórios; veja as rotas no guia do Twilio |
| Notificações do Teams | HTTPS para APIs da Microsoft | Necessário para a integração completa do bot, incluindo a descoberta de conversas |
| Comandos do Teams, botões de cartões, eventos de instalação em chats | HTTPS | `POST /api/microsoft-bot/messages` |

As [configurações de acesso à rede privada](/docs/self-hosted/private-network-access) controlam solicitações de saída do OneUptime para serviços internos. Ativar `ALLOW_PRIVATE_NETWORK_WEBHOOKS` não torna o OneUptime acessível ao Twilio ou ao Teams.

## Produção: publique um gateway para a implantação privada

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
Gateway público (proxy reverso ou balanceador de carga)
          | Conexão privada; somente rotas de callback
          v
Ingress privado do OneUptime -> Aplicação OneUptime
```

1. **Escolha um nome de host**, por exemplo `oneuptime.example.com`. Publique registros DNS públicos apontando para um gateway acessível pela Internet. Os fornecedores não conseguem acessar endereços IP privados nem nomes DNS exclusivamente internos. Com DNS dividido, os funcionários podem resolver o mesmo nome de host para o ingress privado e continuar usando o painel pela VPN. O ingress privado também precisa oferecer HTTPS com um certificado válido para esse nome de host.
2. **Conecte o gateway ao OneUptime.** Coloque-o em uma DMZ com uma rota para o ingress privado ou use um gateway público conectado pela sua própria VPN de site a site ou conexão privada. Permita tráfego do gateway ao ingress na porta do serviço de destino. Para Kubernetes/Portainer, um serviço privado `ClusterIP` por si só não basta: o gateway precisa de um ingress/controlador ou outro destino acessível. Mantenha bancos de dados e outros serviços internos privados.
3. **Termine HTTPS na porta 443** com um certificado de confiança pública e uma cadeia intermediária completa. Permita TCP de entrada na porta 443 do gateway. Instalar um certificado ou alterar o DNS, por si só, não cria a rota para o destino privado.
4. **Encaminhe somente os caminhos de callback necessários** da tabela do guia do Twilio e `/api/microsoft-bot/messages` para o Teams. Direcione-os pelo ingress do OneUptime, que já mapeia `/notification` para a aplicação. Preserve método, caminho original, string de consulta, corpo, `Authorization` e `X-Twilio-Signature`. Preserve o `Host` público e defina cabeçalhos confiáveis `X-Forwarded-Host` e `X-Forwarded-Proto: https` no gateway. Não remova `/api` nem adicione redirecionamentos. Negue outros caminhos no gateway público; os funcionários podem usar o ingress privado para o painel e os callbacks de login pelo navegador.
5. **Mantenha a autenticação dos callbacks intacta.** Isente essas rotas de SSO pelo navegador, CAPTCHA e páginas de login do proxy, pois os fornecedores não conseguem completá-los. O OneUptime continua validando seus tokens de callback, assinaturas do Twilio nas rotas de chamadas recebidas e a autenticação do Bot Framework. Não remova essas verificações. Permita acesso à origem apenas pelo gateway e por clientes internos autorizados, e oculte tokens de callback nos logs. O Twilio descreve essa [arquitetura de proxy em DMZ e a segurança de webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
6. **Defina a URL canônica do OneUptime** antes de configurar qualquer uma das integrações:

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

   Essas configurações controlam as URLs geradas; não provisionam DNS, TLS nem acesso pelo firewall. Aplique a configuração do Compose ou a atualização da release do Helm e aguarde a aplicação reiniciar. O OneUptime não fornece um nome de host separado para callbacks do Twilio. Se o nome de host mudar, atualize os webhooks existentes dos números de telefone Twilio, o endpoint de mensagens do Azure Bot e as URIs de redirecionamento do registro do aplicativo, e baixe e envie o manifesto do Teams novamente.

## Acesso de saída e restrições de IP

Permita resolução DNS e HTTPS de saída da aplicação OneUptime. O Twilio recomenda acesso a `*.twilio.com`, pois seus endereços de API mudam; consulte as [orientações do Twilio sobre endereços IP](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses). O Teams usa `graph.microsoft.com`, `login.microsoftonline.com`, endpoints de autenticação/canais do Bot Framework e a URL do serviço conector da conversa. Use as [orientações de firewall da Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0) e inspecione o tráfego bloqueado nos testes; esses exemplos não são uma lista completa de domínios.

Não use intervalos SIP/mídia do Twilio nem intervalos de mídia dos clientes Teams como listas de permissão de origens de webhooks. Os endereços comuns dos webhooks Twilio são dinâmicos; edições elegíveis do Twilio oferecem [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy), que requer configuração separada com o Twilio. As orientações de firewall da Microsoft alertam que listas fixas de IPs de entrada para o Bot Framework não são compatíveis. Autentique os callbacks na aplicação, em vez de presumir que um IP de origem fixo estabelece a identidade.

## Testes e implantações sem acesso de entrada

Em uma rede fora da sua VPN, verifique DNS público e TLS e depois confira a rota do Teams:

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

Nas versões atuais do OneUptime, espere `405 Method Not Allowed` com `Allow: POST`. Isso confirma que a solicitação GET chegou à rota, não que uma solicitação POST autenticada do bot funcionará. Versões anteriores podem retornar o erro JSON 404 do OneUptime; inspecione o corpo da resposta e os logs do proxy. Erros de TLS, tempos limite ou uma página de erro HTML do proxy indicam problemas de certificado ou roteamento.

Um GET de navegador não testa um callback POST do Twilio. Envie um SMS de teste real, verifique a atualização de entrega, atenda uma chamada de incidente de teste e use sua ação do teclado; depois envie uma mensagem ao bot do Teams e pressione um botão de cartão. Correlacione os diagnósticos de entrega do fornecedor com os logs do gateway e da aplicação, ocultando os tokens. Uma entrega de saída bem-sucedida não comprova, por si só, que os callbacks funcionam.

Para desenvolvimento, o Twilio documenta [testes por um túnel](https://www.twilio.com/docs/usage/webhooks/webhooks-overview), e a Microsoft documenta a [depuração local do Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug). Encaminhe um túnel HTTPS público para um proxy que permita apenas as rotas necessárias, configure o nome de host resultante como indicado acima e pare o túnel após os testes. Um túnel continua expondo um endpoint de entrada; ele não torna uma implantação fisicamente isolada da rede.

Se a política proibir toda conectividade de entrada, o envio de SMS e a reprodução simples de voz com instruções fornecidas diretamente ainda podem funcionar por HTTPS de saída. Porém, callbacks de entrega, ações do teclado, roteamento de chamadas recebidas e a integração completa do bot do Teams não podem. Os endpoints privados do Azure Bot para Direct Line não resolvem a conectividade do Teams: o [guia de isolamento de rede da Microsoft](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0) informa que desativar o acesso público remove outros canais, incluindo o Teams. Uma implantação totalmente desconectada não pode usar essas integrações de nuvem.
