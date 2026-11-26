# Ajuda e suporte

Direcione a ajuda que o OneUptime oferece para a sua própria equipe: o endereço de suporte, o chat e a página de ajuda que as pessoas veem, o destino de **Dar feedback**, o que o login único diz a quem precisa de um convite e os avisos para baixar o app móvel. Cada um pode continuar com o do OneUptime, apontar para um endereço ou link seu, ou ficar oculto.

:::cards
- [Alterar para onde vai a ajuda](#alterar-para-onde-vai-a-ajuda): Uma página no Admin Dashboard.
- [O que cada configuração altera](#o-que-cada-configuração-altera): Cada lugar, seu padrão e suas opções.
- [Dar feedback](#dar-feedback): Para onde vai o que as pessoas escrevem.
- [A mensagem de login](#a-mensagem-de-login): A quem pedir um convite.
- [Definir pela configuração do servidor](#definir-pela-configuração-do-servidor): Valores do Helm ou `config.env`, para um novo servidor.
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
| **E-mail de suporte** | Ajuda › **E-mail de suporte**, **Falar com o suporte** na tela de página não encontrada, os e-mails da conta e o endereço para o qual uma tela de erro pede que as pessoas enviem um pacote de suporte | `support@oneuptime.com` | Um endereço de e-mail |
| **Chat** | Ajuda › **Chat no Slack** e o link de chat no topo da referência da API | A comunidade do OneUptime no Slack | Um link. Um link do Slack ou do Microsoft Teams mantém o nome; qualquer outro aparece como **Chat com o suporte** |
| **Solicitar demo** | Ajuda › **Solicitar demo** | Visível | Apenas oculto |
| **Dar feedback** | Ajuda › **Dar feedback** e **Dar feedback** em Pesquisar | Os administradores deste servidor | Um endereço de e-mail ou uma página própria |
| **Ajuda e suporte** | **Ajuda e suporte** no rodapé, **Contato** nas páginas de login e **Suporte** no topo da referência da API | `https://oneuptime.com/support` | Um link |
| **Reportar um bug ou solicitar um recurso** | O rodapé do menu de produtos, a issue pública do GitHub oferecida depois do feedback e os links do GitHub da documentação e da referência da API | Visível | Apenas oculto |
| **Baixar o app móvel** | **Como me contatar**, a configuração de plantão, os primeiros passos de um novo membro no Início e **Aplicativos móveis** em **Configurações do projeto** | A App Store e o Google Play | Uma página própria, como o portal da empresa do seu gerenciador de dispositivos |
| **Mensagem para quem precisa de um convite** | As telas do login único que dizem “You need to be invited.” e “No project access.” | A frase do OneUptime | Suas próprias palavras |

Todas as configurações, exceto a mensagem, também podem ser ocultadas. Um link começa com `https://`, `http://` ou `mailto:`. Qualquer outro tipo de link, `javascript:` entre eles, é recusado pela página e de novo pelo servidor.

O próprio menu Ajuda, o rodapé e o menu de produtos do Admin Dashboard mantêm os links do OneUptime: eles são para os administradores deste servidor, que recebem do OneUptime a ajuda com o servidor.

### E-mails da conta

Em um servidor auto-hospedado, os e-mails da conta, como um convite ou a alteração de um endereço de e-mail, terminam indicando o administrador deste servidor, nunca o suporte do OneUptime. Com um endereço de suporte próprio, eles o mencionam, como link: “Precisa de ajuda? Escreva para it-help@example.com.” No padrão, ou oculto, continuam como sempre foram.

### A documentação e a referência da API

A documentação e a referência da API que este servidor publica seguem as mesmas configurações. Com **Reportar um bug ou solicitar um recurso** oculto, nenhuma página tem links para o GitHub, e **Esta página foi útil?** só é perguntado onde a resposta é guardada ou enviada. A barra superior da referência da API mostra o chat e a página de ajuda que você escolheu, ou nenhum dos dois quando estão ocultos.

### Quem pode ler seus links

O endereço de suporte e o link **Ajuda e suporte** também aparecem nas páginas de login, então qualquer pessoa que possa abrir essas páginas pode lê-los. Um link de chat e a página do app móvel são enviados apenas a pessoas conectadas: um link de chat muitas vezes é um convite para entrar no seu espaço de trabalho. Pelo mesmo motivo, a documentação e a referência da API, que qualquer pessoa pode ler, mostram um link de chat próprio apenas para quem está conectado a este servidor.

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
- Onde quer que o OneUptime liste as formas de contatar alguém, como nas configurações guiadas, no Início, nas regras de conformidade de uma equipe e no Pergunte à IA, o app não é mais citado entre elas.

## Definir pela configuração do servidor

Um servidor instalado com Helm ou Docker Compose pode começar com essas configurações já feitas. Defina-as nos valores `helpAndSupport` do chart do Helm, ou no `config.env` para o Docker Compose:

```yaml
helpAndSupport:
  supportEmail: it-help@example.com
  chat: https://example.slack.com/archives/C024BE91L
  requestDemo: hidden
  gitHub: hidden
  inviteMessage: |
    Ask the IT service desk to invite you to OneUptime:
    it-help@example.com
```

| Valor do Helm | `config.env` | O que aceita |
| --- | --- | --- |
| `supportEmail` | `HELP_AND_SUPPORT_SUPPORT_EMAIL` | Um endereço de e-mail, ou `hidden` |
| `chat` | `HELP_AND_SUPPORT_CHAT` | Um link, ou `hidden` |
| `requestDemo` | `HELP_AND_SUPPORT_REQUEST_DEMO` | `shown` ou `hidden` |
| `giveFeedback` | `HELP_AND_SUPPORT_GIVE_FEEDBACK` | Um endereço de e-mail, um link, ou `hidden` |
| `helpLink` | `HELP_AND_SUPPORT_HELP_LINK` | Um link, ou `hidden` |
| `gitHub` | `HELP_AND_SUPPORT_GITHUB` | `shown` ou `hidden` |
| `mobileApp` | `HELP_AND_SUPPORT_MOBILE_APP` | Um link, ou `hidden` |
| `inviteMessage` | `HELP_AND_SUPPORT_INVITE_MESSAGE` | Texto simples |

- Eles são lidos quando o servidor inicia, apenas enquanto nada tiver sido salvo em **Ajuda e suporte**. A partir daí, a página guarda as configurações: uma alteração feita nela é mantida, e uma reinicialização nunca a desfaz.
- Um valor alterado depois na configuração do servidor não é aplicado, e o log do servidor avisa. Altere-o na página.
- Cada valor é verificado como a página o verifica. Um valor que seria recusado, como um link `javascript:`, fica de fora, e a página e o log do servidor dizem por quê. Os outros são definidos mesmo assim.
- Deixe um valor vazio para manter o padrão do OneUptime. `true` e `false` também funcionam para as duas chaves.
- A página indica cada item definido pela configuração do servidor, até você alterá-lo.

## Próximos passos

:::cards
- [SSO global](/docs/identity/global-sso): O login único do próprio servidor.
- [Duração da sessão](/docs/self-hosted/session-length): Por quanto tempo as pessoas permanecem conectadas.
:::
