# Conectando o OneUptime ao Microsoft Teams

### Passos para Conectar o OneUptime ao Microsoft Teams

1. **Criar uma Conta no OneUptime**

   - Visite [OneUptime.com](https://oneuptime.com) e crie uma conta.
   - Depois de criar a conta, crie um novo projeto.

2. **Conectar o Microsoft Teams ao Projeto OneUptime**

   - Navegue para **Configurações do projeto** > **Microsoft Teams** dentro do seu projeto OneUptime.
   - Siga os prompts para conectar sua conta do Microsoft Teams ao projeto OneUptime.

3. **Configurar Notificações de Incidentes**

   - Após conectar sua conta do Microsoft Teams, vá para **Incidents Page** > **Microsoft Teams**.
   - Adicione regras para enviar notificações de incidentes ao Microsoft Teams. Por exemplo, você pode criar uma regra que publica mensagens em um canal do Teams quando um incidente é criado.

4. **Configurar Notificações de Alertas e Manutenção Programada**
   - Regras semelhantes podem ser aplicadas a Alertas e Manutenção Programada navegando para suas respectivas páginas e configurando as regras desejadas.

## Testar uma regra

**Regra de teste** na linha de uma regra publica uma mensagem de teste dessa regra nos canais que ela indica, para que você veja a mensagem chegar. Se a regra cria um canal para cada evento, o teste também cria um e convida as pessoas da regra.

Assim como **Enviar teste** ao lado de um canal em **Configurações do projeto** > **Workspace** > **Microsoft Teams**, é preciso permissão para criar regras de notificação: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** ou **Create Workspace Notification Rule** e **Read Workspace Notification Rule** em uma função personalizada. Para quem só pode ver as regras, como um **Viewer**, **Regra de teste** fica bloqueado e a dica diz o que é preciso; a API recusa o teste com "You do not have permission to send test notifications in this project." No OneUptime Cloud, testar uma regra exige o plano **Growth**, assim como adicionar uma.

## Resumos

A aba **Summary** de **Incidentes** > **Workspace** > **Microsoft Teams** (e a de **Alertas**) publica um resumo periódico nos canais que você indicar: quantos incidentes ou alertas houve, com que rapidez foram reconhecidos e resolvidos, e uma lista com links. Um novo resumo sai toda semana e cobre os últimos 7 dias. Deixe **Enviar primeiro relatório às** em branco e o primeiro sai às 09:00 no início da próxima semana, do próximo dia ou mês; o formulário mostra quando.

Um resumo segue o relógio do seu **Fuso horário**, que começa no seu. Ali ele mantém o horário o ano todo: um configurado para as 09:00 em Berlim continua saindo às 09:00, horário de Berlim, depois da mudança de horário, e as datas da mensagem também são as de Berlim. Pela API, envie `timezone` como nome de fuso horário IANA, como `Europe/Berlin`. Um resumo criado sem fuso horário usa o do perfil de quem o cria, ou UTC quando uma chave de API o cria.

## Acesso à rede para implantações auto-hospedadas

Para conexões de saída, callbacks de entrada e implantações privadas, consulte a seção de acesso à rede do [Integração com Microsoft Teams](/docs/self-hosted/microsoft-teams-integration).
