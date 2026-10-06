# Conectando o OneUptime ao Slack

### Passos para Conectar o OneUptime ao Slack

1. **Criar uma Conta no OneUptime**

   - Visite [OneUptime.com](https://oneuptime.com) e crie uma conta.
   - Depois de criar a conta, crie um novo projeto.

2. **Conectar o Slack ao Projeto OneUptime**

   - Navegue para **Configurações do projeto** > **Slack** dentro do seu projeto OneUptime.
   - Siga os prompts para conectar sua conta do Slack ao projeto OneUptime.

3. **Configurar Notificações de Incidentes**

   - Após conectar sua conta do Slack, vá para **Incidents Page** > **Slack**.
   - Adicione regras para enviar notificações de incidentes ao Slack. Por exemplo, você pode criar uma regra que cria um novo canal do Slack e convida os proprietários do incidente quando um incidente é criado.

4. **Configurar Notificações de Alertas e Manutenção Programada**
   - Regras semelhantes podem ser aplicadas a Alertas e Manutenção Programada navegando para suas respectivas páginas e configurando as regras desejadas.

## Testar uma regra

**Regra de teste** na linha de uma regra publica uma mensagem de teste dessa regra nos canais que ela indica, para que você veja a mensagem chegar. Se a regra cria um canal para cada evento, o teste também cria um e convida as pessoas da regra.

Assim como **Enviar teste** ao lado de um canal em **Configurações do projeto** > **Workspace** > **Slack**, é preciso permissão para criar regras de notificação: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** ou **Create Workspace Notification Rule** e **Read Workspace Notification Rule** em uma função personalizada. Para quem só pode ver as regras, como um **Viewer**, **Regra de teste** fica bloqueado e a dica diz o que é preciso; a API recusa o teste com "You do not have permission to send test notifications in this project." No OneUptime Cloud, testar uma regra exige o plano **Growth**, assim como adicionar uma.

## Acesso à rede para implantações auto-hospedadas

Para conexões de saída, callbacks de entrada e implantações privadas, consulte a seção de acesso à rede do [Integração com Slack](/docs/self-hosted/slack-integration).
