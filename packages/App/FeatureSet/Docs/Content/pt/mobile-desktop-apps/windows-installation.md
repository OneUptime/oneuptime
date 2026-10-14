# Instalação no Windows

O painel do OneUptime é instalado no Windows como um aplicativo, pelo Microsoft Edge ou pelo Google Chrome. Ele abre numa janela própria, com o seu próprio ícone na barra de tarefas e no menu Iniciar, e pode mostrar notificações. Não há nada para baixar: o aplicativo é o painel do seu OneUptime, e fica atualizado assim que o seu OneUptime fica.

:::cards
- [Instalar o aplicativo](#instalar-o-aplicativo): Pelo Edge ou pelo Chrome, em poucos cliques.
- [Fixá-lo e iniciá-lo com o Windows](#fixá-lo-e-iniciá-lo-com-o-windows): Mantê-lo a um clique.
- [Receber notificações neste computador](#receber-notificações-neste-computador): Registrar o navegador para notificações push.
- [Solução de problemas](#solução-de-problemas): Sem ícone de instalação, sem notificações, entrar de novo.
:::

## Como o aplicativo de desktop funciona

```mermaid title="O que instalar o painel lhe dá"
flowchart TB
    Browser["Edge ou Chrome abre<br/>o seu painel"]
    Install["Você o instala<br/>como aplicativo"]
    App["OneUptime numa janela<br/>própria, na barra de<br/>tarefas e no menu Iniciar"]
    OneUptime["O seu OneUptime serve<br/>o painel"]
    Browser --> Install --> App
    App -->|"carrega o painel<br/>sempre que abre"| OneUptime
```

O aplicativo instalado compartilha o login, as configurações e a permissão de notificações do navegador dele. Feche o navegador e o aplicativo continua rodando na sua própria janela.

## Antes de começar

- Windows 10 ou Windows 11, com um Microsoft Edge ou Google Chrome recente.
- O endereço do seu OneUptime, por HTTPS: `https://oneuptime.com` no OneUptime Cloud, ou o seu, por exemplo `https://oneuptime.example.com`.
- Uma conta com a qual você consiga entrar no painel.

## Instalar o aplicativo

:::tabs
@tab Edge
1. Abra o seu OneUptime no Edge e faça login.
2. Em qualquer página do painel, clique no ícone de instalação à direita da barra de endereços e depois em **Instalar**. Ou abra **Configurações e mais (…) → Mais ferramentas → Aplicativos → Instalar este site como um aplicativo**.
3. O Edge abre o OneUptime numa janela própria, e pode oferecer fixá-lo na barra de tarefas ou em Iniciar.
@tab Chrome
1. Abra o seu OneUptime no Chrome e faça login.
2. Em qualquer página do painel, clique no ícone de instalação à direita da barra de endereços e depois em **Instalar**. Ou abra **⋮ → Transmitir, salvar e compartilhar → Instalar página como app…**.
3. O Chrome abre o OneUptime numa janela própria e o adiciona ao menu Iniciar.
:::

Instale a partir de uma página do painel, depois de entrar: a página de login não é o aplicativo. Procure OneUptime no menu Iniciar para abri-lo depois.

## Fixá-lo e iniciá-lo com o Windows

- **Barra de tarefas.** Com o aplicativo aberto, clique com o botão direito no ícone dele na barra de tarefas e escolha **Fixar na barra de tarefas**.
- **Iniciar com o Windows.** No Edge, abra `edge://apps`, escolha **Detalhes** em OneUptime e ative **Iniciar automaticamente no logon do dispositivo**. A mesma página fixa o aplicativo na barra de tarefas ou em Iniciar, ou cria um atalho na área de trabalho.

## Receber notificações neste computador

O aplicativo mostra notificações pelo navegador dele, depois que você registra o navegador para notificações push em cada projeto do qual quer recebê-las.

:::steps
### Abrir os seus dispositivos push
No aplicativo, abra **Configurações do usuário → Métodos de notificação** e a aba **Push Notifications**.

### Registrar este navegador
Clique em **Registrar Dispositivo**, mantenha o valor sugerido em **Nome do dispositivo**, por exemplo `Edge on Windows`, ou altere-o, e clique de novo em **Registrar Dispositivo**. Quando o navegador perguntar se o OneUptime pode mostrar notificações, escolha **Permitir**.

### Enviar um teste
Na caixa de diálogo **Browser Registered**, clique em **Send Test Notification**. Se nada aparecer, veja as configurações de notificação do Windows: veja [Solução de problemas](#solução-de-problemas).
:::

Um navegador não toca mais alto do que o Windows permite: ele não pode ignorar o Não Perturbe. Para acionamentos que precisam acordar você, use o aplicativo móvel com alertas críticos: veja [Instalação no Android](/docs/mobile-desktop-apps/android-installation#tocar-mesmo-no-modo-silencioso) ou [Instalação no iOS](/docs/mobile-desktop-apps/ios-installation#tocar-mesmo-no-modo-silencioso).

Num OneUptime auto-hospedado, as notificações do navegador precisam das chaves VAPID do servidor: veja [Notificações push](/docs/self-hosted/push-notifications#configuração-auto-hospedada).

## Atualizações

Não há nada para atualizar. O aplicativo carrega o painel do seu OneUptime sempre que abre, então ele muda quando o seu OneUptime é atualizado. Se uma janela está aberta desde a atualização, recarregue-a com Ctrl+R.

## Desinstalar

:::tabs
@tab Edge
Abra `edge://apps`, escolha **Detalhes** em OneUptime e depois **Desinstalar**.
@tab Chrome
Na janela do aplicativo, abra o menu **⋮**, escolha o item que desinstala o aplicativo e depois **Remover**.
:::

O Windows também lista o aplicativo em **Configurações → Aplicativos → Aplicativos instalados**, onde **Desinstalar** também o remove.

Desinstalar o aplicativo não cancela o registro do navegador dele: ele continua recebendo notificações. Para pará-las, exclua o navegador em **Configurações do usuário → Métodos de notificação**, na aba **Push Notifications**, com **Excluir**.

## Solução de problemas

:::details Não há ícone de instalação na barra de endereços
Abra uma página do painel depois de entrar, não a página de login, e verifique se o endereço começa com `https://`: os navegadores só instalam aplicativos de sites seguros. Se o ícone continuar sem aparecer, use o menu do navegador como acima. Outros navegadores talvez não instalem sites como aplicativos; use o Edge ou o Chrome.
:::

:::details Nenhuma notificação aparece
- Em **Configurações do usuário → Métodos de notificação**, aba **Push Notifications**, verifique se este navegador aparece na lista, e envie a ele uma **Notificação de teste**.
- No Windows, abra **Configurações → Sistema → Notificações**: as notificações precisam estar ativadas, também para o navegador, e o Não Perturbe desativado. O Windows 10 chama a página de “Notificações e ações”.
- Se o navegador bloqueia as notificações do OneUptime, clique no ícone à esquerda da barra de endereços, permita as notificações do site e registre o navegador de novo.
- Num OneUptime auto-hospedado, a caixa de diálogo **Registrar Dispositivo** avisa quando o servidor não tem chaves VAPID.
:::

:::details O aplicativo pede para entrar de novo
O aplicativo compartilha o login do navegador dele. Sair no navegador, ou apagar os cookies dele, também desconecta o aplicativo.
:::

## Próximos passos

:::cards
- [Instalação no macOS](/docs/mobile-desktop-apps/macos-installation): O mesmo aplicativo num Mac.
- [Instalação no Android](/docs/mobile-desktop-apps/android-installation): Receber os acionamentos no seu celular.
- [Perguntas frequentes e solução de problemas](/docs/mobile-desktop-apps/faq-troubleshooting): Respostas sobre os dois aplicativos.
- [Sua conta](/docs/introduction/your-account): Como o OneUptime chega a você em cada projeto.
:::
