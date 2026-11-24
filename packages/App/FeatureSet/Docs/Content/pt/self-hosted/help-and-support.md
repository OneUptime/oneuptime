# Ajuda e suporte

Direcione a ajuda que o OneUptime oferece para a sua própria equipe: o endereço de suporte, o chat e a página de ajuda que as pessoas veem, o destino de **Dar feedback**, o que o login único diz a quem precisa de um convite e os avisos para baixar o app móvel. Cada um pode continuar com o do OneUptime, apontar para um endereço ou link seu, ou ficar oculto.

:::cards
- [Alterar para onde vai a ajuda](#alterar-para-onde-vai-a-ajuda): Uma página no Admin Dashboard.
- [O que cada configuração altera](#o-que-cada-configuração-altera): Cada lugar, seu padrão e suas opções.
- [Dar feedback](#dar-feedback): Para onde vai o que as pessoas escrevem.
- [A mensagem de login](#a-mensagem-de-login): A quem pedir um convite.
:::

## Alterar para onde vai a ajuda

:::steps
### Abrir Ajuda e suporte
No Admin Dashboard, abra **Configurações** e depois **Ajuda e suporte** no menu lateral.

### Alterar um lugar
Selecione **Alterar** ao lado dele, escolha **Padrão**, um endereço ou link seu, ou **Ocultar**, e depois selecione **Salvar**. **Solicitar demo** e **Reportar um bug ou solicitar um recurso** são chaves, salvas assim que você as alterna.

### Conferir o que as pessoas veem
O menu Ajuda e a tela de login aparecem em pré-visualização ao lado das suas configurações. As pessoas veem uma alteração na próxima vez que abrem uma página.
:::

Enquanto você não altera um lugar, ele mostra o que o OneUptime sempre mostrou, então um servidor que nunca abre a página fica exatamente como antes.

## O que cada configuração altera

| Configuração | Onde as pessoas a veem | Padrão | Próprio |
| --- | --- | --- | --- |
| **E-mail de suporte** | Ajuda › **E-mail de suporte**, **Falar com o suporte** na tela de página não encontrada e o endereço para o qual uma tela de erro pede que as pessoas enviem um pacote de suporte | `support@oneuptime.com` | Um endereço de e-mail |
| **Chat** | Ajuda › **Chat no Slack** | A comunidade do OneUptime no Slack | Um link. Um link do Slack ou do Microsoft Teams mantém o nome; qualquer outro aparece como **Chat com o suporte** |
| **Solicitar demo** | Ajuda › **Solicitar demo** | Visível | Apenas oculto |
| **Dar feedback** | Ajuda › **Dar feedback** e **Dar feedback** em Pesquisar | Os administradores deste servidor | Um endereço de e-mail ou uma página própria |
| **Ajuda e suporte** | **Ajuda e suporte** no rodapé e **Contato** nas páginas de login | `https://oneuptime.com/support` | Um link |
| **Reportar um bug ou solicitar um recurso** | O rodapé do menu de produtos e a issue pública do GitHub oferecida depois do feedback | Visível | Apenas oculto |
| **Baixar o app móvel** | **Como me contatar**, a configuração de plantão, os primeiros passos de um novo membro no Início e **Aplicativos móveis** em **Configurações do projeto** | A App Store e o Google Play | Uma página própria, como o portal da empresa do seu gerenciador de dispositivos |
| **Mensagem para quem precisa de um convite** | As telas do login único que dizem “You need to be invited.” e “No project access.” | A frase do OneUptime | Suas próprias palavras |

Todas as configurações, exceto a mensagem, também podem ser ocultadas. Um link começa com `https://`, `http://` ou `mailto:`. Qualquer outro tipo de link, `javascript:` entre eles, é recusado pela página e de novo pelo servidor.

O próprio menu Ajuda, o rodapé e o menu de produtos do Admin Dashboard mantêm os links do OneUptime: eles são para os administradores deste servidor, que recebem do OneUptime a ajuda com o servidor.

### Quem pode ler seus links

O endereço de suporte e o link **Ajuda e suporte** também aparecem nas páginas de login, então qualquer pessoa que possa abrir essas páginas pode lê-los. Um link de chat e a página do app móvel são enviados apenas a pessoas conectadas: um link de chat muitas vezes é um convite para entrar no seu espaço de trabalho.

## Dar feedback

| Opção | O que acontece |
| --- | --- |
| **Padrão** | Como sempre foi: enviado por e-mail para o **E-mail de notificação do admin** definido em **Configurações** › **E-mails**, ou guardado para os administradores deste servidor em **Feedback** quando não há um. No OneUptime Cloud, vai para a equipe do OneUptime. |
| **Um endereço de e-mail** | Enviado por e-mail para esse endereço pelas configurações de e-mail deste servidor, com o nome e o endereço de e-mail da pessoa, para que sua equipe possa responder. A pessoa recebe uma cópia. |
| **Uma página própria** | **Dar feedback** abre a página em uma nova aba, como o formulário da sua central de suporte. Nada é enviado pelo OneUptime. |
| **Ocultar “Dar feedback”** | **Dar feedback** não é oferecido em lugar nenhum. |

Enquanto o servidor não consegue enviar e-mails, escolher um endereço de e-mail oculta **Dar feedback** em vez de aceitar uma mensagem que não pode chegar à sua equipe, e a página de configurações informa isso. Configure o e-mail em **Configurações** › **E-mails**, e **Dar feedback** volta sozinho.

As perguntas que o OneUptime faz, como quão fácil foi uma configuração guiada, não são **Dar feedback**: as respostas a elas ficam em **Feedback**, onde **Perguntar como foi** as desativa.

## A mensagem de login

O login único do próprio servidor recusa dois tipos de pessoa: quem não tem conta, enquanto o provedor não cria nenhuma (“You need to be invited.”), e quem tem uma conta que não está em nenhum projeto (“No project access.”). Os dois precisam de um convite, então as duas telas mostram a sua mensagem, com a quem pedir e como entrar em contato:

```text
Ask the IT service desk to invite you to OneUptime:
it-help@example.com or https://help.example.com/oneuptime
```

- A mensagem é texto simples de até 1000 caracteres e não pode conter `<` nem `>`.
- Cada linha é um parágrafo, e os links e endereços de e-mail nela viram links.
- O título da tela continua como está, e o app móvel mostra as mesmas palavras.

## Os avisos do app móvel

Com uma página própria, todo aviso para baixar o app móvel aponta para ela: um código QR para a sua página, identificado pelo endereço dela, e as etapas continuam indicando o endereço deste servidor para o app se conectar. Se estiver oculto, não há nenhum aviso:

- **Baixar o app móvel** sai dos primeiros passos de um novo membro no Início, que continuam sendo concluídos quando a pessoa pode ser contatada e uma chamada de teste chegou até ela.
- **Como me contatar** e a configuração de plantão oferecem apenas navegadores.
- **Aplicativos móveis** sai de **Configurações do projeto**.

## Próximos passos

:::cards
- [SSO global](/docs/identity/global-sso): O login único do próprio servidor.
- [Duração da sessão](/docs/self-hosted/session-length): Por quanto tempo as pessoas permanecem conectadas.
:::
