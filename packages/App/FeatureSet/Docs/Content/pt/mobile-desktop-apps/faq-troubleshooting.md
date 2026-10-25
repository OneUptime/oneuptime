# Perguntas frequentes e solução de problemas

Respostas a perguntas frequentes sobre os aplicativos móvel e de desktop do OneUptime, e soluções para o que mais dá errado: o login, notificações que não chegam e um celular que precisa se registrar de novo.

:::cards
- [Perguntas sobre o aplicativo móvel](#perguntas-sobre-o-aplicativo-móvel): Dispositivos, projetos, auto-hospedagem e segurança.
- [Perguntas sobre o aplicativo de desktop](#perguntas-sobre-o-aplicativo-de-desktop): O que é o aplicativo de desktop, e o que ele não consegue fazer.
- [Quando um celular precisa se registrar de novo](#quando-um-celular-precisa-se-registrar-de-novo): Por que um celular para de receber acionamentos, e como volta.
- [Solução de problemas](#solução-de-problemas): Problemas de login, notificações e instalação.
:::

## Perguntas sobre o aplicativo móvel

:::details O aplicativo é gratuito?
Sim. O OneUptime On-Call é gratuito na App Store, no Google Play e como APK no GitHub. Você entra com a sua conta do OneUptime.
:::

:::details Em quais celulares e tablets ele funciona?
Em iPhones e iPads com iOS ou iPadOS 16.4 ou posterior, e em celulares e tablets Android com Android 7.0 ou posterior.
:::

:::details Ele funciona com um OneUptime auto-hospedado?
Sim. Digite o endereço `https://` do seu OneUptime quando o aplicativo abrir, ou toque em **Change Server** na tela de login. Por padrão, o seu servidor envia os acionamentos aos celulares pelo relay push do OneUptime, então não precisa de conta na Apple, no Google ou na Expo: veja [Notificações push](/docs/self-hosted/push-notifications).
:::

:::details Posso usá-lo com vários projetos?
Sim. O aplicativo registra o celular em cada projeto de que você participa, para que cada projeto possa acionar você. Ele mostra um projeto por vez: toque no nome do projeto no topo de uma tela para trocar.
:::

:::details Posso entrar em mais de um celular?
Sim. Cada celular ou tablet é um dispositivo push próprio, com as suas próprias regras de plantão e a sua própria configuração de alertas críticos.
:::

:::details O que posso fazer no aplicativo?
- **Home**: o que precisa de atenção no projeto: incidentes e alertas ativos, casos de segurança abertos se o seu papel permitir vê-los, monitores com problemas e eventos agrupados.
- **Monitors**: todos os monitores, filtrados por estado, com os detalhes deles.
- **Inbox**: incidentes e alertas, e os episódios que os agrupam. Abra um para usar **Acknowledge**, **Resolve** ou **Add Note**. Se o seu papel permitir ver os casos de segurança do projeto, **Security** lista os abertos: abra um para usar **Approve** ou **Reject** em uma etapa de playbook aguardando aprovação, assumir o caso com **Assign to me** ou usar **Close case**.
- **On-Call**: se você está de plantão e até quando, quem mais está, os acionamentos enviados a você, e **Cover for me**, que passa os seus acionamentos a um colega por um tempo.
- **Settings**: os seus projetos e o login único, a aparência, os alertas críticos e o som de alarme, **Biometrics Login**, o seu feed de calendário de plantão e **Log Out**.

Todo o resto está no painel.
:::

:::details Posso confirmar um acionamento pela notificação?
Não. Toque na notificação: o aplicativo abre o incidente, o alerta, o episódio ou o caso de segurança de que ela trata, no projeto certo, e você o confirma ali. Se o aplicativo está bloqueado ou você não entrou, ele abre o acionamento assim que você entra.
:::

:::details O meu login está seguro no celular?
O aplicativo fala com o seu OneUptime só por HTTPS. O seu login fica guardado no armazenamento próprio do aplicativo no celular, e **Log Out** o apaga e também encerra a sessão no servidor. Ative **Biometrics Login** para que o aplicativo peça o seu rosto, a sua digital ou o seu código sempre que abrir.
:::

:::details O aplicativo funciona offline?
Não. Sem conexão, ele mostra **No internet connection** no topo da tela, e continua assim que a conexão volta.
:::

## Perguntas sobre o aplicativo de desktop

:::details O que é o aplicativo de desktop?
O painel do OneUptime, instalado pelo seu navegador como um aplicativo: uma janela própria, um ícone no menu Iniciar, no Dock ou no seu iniciador, e notificações. Ele faz tudo o que o painel faz, porque é o painel.
:::

:::details Por que ele não está em nenhuma loja de aplicativos?
Ele não precisa estar. O aplicativo carrega o painel do seu OneUptime sempre que abre, então é sempre a versão que o seu OneUptime roda, no Windows, no macOS e no Linux igualmente, sem nada para atualizar.
:::

:::details Ele pode me acordar como o celular?
Não. Os navegadores não conseguem ignorar o Não Perturbe nem um Foco, então uma notificação de desktop só toca tão alto quanto o computador permite. Para acionamentos que precisam acordar você, use o aplicativo móvel com alertas críticos.
:::

:::details Ele funciona offline?
Não. Ele precisa de uma conexão com o seu OneUptime, como o painel numa aba do navegador.
:::

## Quando um celular precisa se registrar de novo

O OneUptime envia os acionamentos de um celular pela Expo, que os entrega à Apple ou ao Google. Quando a Expo diz que o celular não pode mais ser alcançado, o OneUptime para de enviar qualquer coisa a ele, até o aplicativo registrá-lo de novo.

```mermaid title="Como um celular para de receber acionamentos, e como volta"
flowchart TB
    Registered["O celular está registrado,<br/>e os acionamentos<br/>chegam a ele"]
    Gone["A Expo o dá como<br/>perdido: um push é<br/>recusado, ou o recibo<br/>dele diz isso cerca<br/>de 15 minutos depois"]
    Marked["O OneUptime o marca<br/>Não está recebendo<br/>notificações e para de<br/>enviar; as regras ficam"]
    Open["Você abre o aplicativo<br/>estando conectado"]
    Renewed["O aplicativo se registra<br/>de novo, renova o<br/>token push dele,<br/>e os acionamentos<br/>voltam a chegar"]
    Registered --> Gone --> Marked --> Open --> Renewed
```

A Expo dá um celular como perdido quando o aplicativo foi removido dele, ou quando o token push dele não é mais válido. O celular não é excluído: **Configurações do usuário → Métodos de notificação**, na aba **Push Notifications**, o mostra como **Não está recebendo notificações**, e a linha do tempo de plantão de um acionamento que não chegou a ele diz por quê. Os seus outros celulares e métodos de notificação são acionados como sempre.

O aplicativo registra o celular sempre que abre, quando você entra, e quando você volta a ele, no máximo uma vez a cada cinco minutos. O registro pede de novo o token push à Expo, o que o renova, e o celular volta a receber acionamentos com as regras que tinha.

| O que aconteceu | O que fazer | O que o OneUptime faz |
| --- | --- | --- |
| O aplicativo ainda está instalado | Abra-o estando conectado | O celular volta a receber notificações, com as regras dele |
| Você reinstalou o aplicativo num iPhone ou iPad | Instale-o e entre | Normalmente a mesma entrada volta, com as regras dela |
| Você reinstalou o aplicativo no Android | Instale-o, entre e exclua a entrada antiga | Uma entrada nova com as regras padrão; a antiga continua marcada |
| Um celular novo, configurado a partir de um backup do antigo | Abra o aplicativo no celular novo | Se a entrada do celular antigo está marcada, o novo a assume, com as regras dela; se não, o celular novo ganha uma entrada própria |
| Um celular novo, configurado do zero | Entre e exclua a entrada antiga | Uma entrada nova com as regras padrão |
| Você saiu do aplicativo | Entre de novo | Sair removeu o celular e as regras dele; ele volta com as regras padrão |

Um navegador também pode parar de receber notificações, quando a inscrição push dele expira. O painel a renova quando pode; se o navegador continuar marcado, registre-o de novo com **Registrar Dispositivo** nesse navegador.

## Solução de problemas

### Login

:::details “Could not connect to the server”
O aplicativo não conseguiu chegar a `https://<your-oneuptime>/api/status`. Verifique o endereço, incluindo `https://`: o aplicativo não se conecta por HTTP simples. Se o seu OneUptime está numa rede privada, conecte o celular a ela primeiro, pela sua VPN, por exemplo. Aberto no navegador do celular, esse endereço mostra `{"status":"ok"}` quando o celular consegue chegar ao OneUptime.
:::

:::details “No SSO configuration found for the email”
Nenhum dos projetos de que esse e-mail participa tem login único configurado, ou o e-mail não tem conta neste OneUptime. Verifique o e-mail, ou entre com a sua senha. Os provedores que o seu administrador configurou para toda a instalação aparecem antes do campo de e-mail.
:::

:::details Uma chave de segurança é o seu único segundo fator
O aplicativo não consegue usar uma chave de segurança. Entre com um dos seus códigos de backup, ou adicione um aplicativo autenticador à sua conta no painel: veja [Ativar a autenticação de dois fatores](/docs/introduction/your-account#ativar-a-autenticação-em-dois-fatores).
:::

:::details O login com chave de acesso falha
As chaves de acesso precisam que o endereço do seu OneUptime comece com `https://`, e de uma chave de acesso adicionada para esse OneUptime: veja [Adicionar uma chave de acesso](/docs/introduction/your-account#adicionar-uma-chave-de-acesso). Para usar outro servidor, toque em **Change Server** na tela de login.
:::

### Notificações

:::details Nenhuma notificação no celular
- Verifique se o celular permite as notificações do OneUptime On-Call, e se o Não Perturbe ou um Foco não as está retendo.
- Em **Configurações do usuário → Métodos de notificação**, aba **Push Notifications**, verifique se o celular aparece na lista, e envie a ele uma **Notificação de teste**.
- Se ele está marcado como **Não está recebendo notificações**, abra o aplicativo estando conectado: veja [Quando um celular precisa se registrar de novo](#quando-um-celular-precisa-se-registrar-de-novo).
- Verifique as suas regras de plantão em **Configurações do usuário → Regras de Plantão**: elas decidem quais acionamentos chegam a qual método.
- Num OneUptime auto-hospedado, verifique se o servidor chega ao relay push dele: veja [Notificações push](/docs/self-hosted/push-notifications#acesso-de-rede).
:::

:::details Os acionamentos chegam atrasados no Android
Coloque o uso de bateria do aplicativo em **Sem restrições** nas configurações do Android para o OneUptime On-Call, e deixe o aplicativo fora de qualquer lista de economia de bateria: veja [Evitar que os acionamentos cheguem atrasados](/docs/mobile-desktop-apps/android-installation#evitar-que-os-acionamentos-cheguem-atrasados).
:::

:::details Os alertas críticos não tocam no modo silencioso
Abra **Settings** no aplicativo: a linha abaixo de **Critical On-Call Alerts** diz o que falta nesse celular. Depois verifique em **Configurações do usuário → Regras de Plantão** se a regra de plantão que enviou o acionamento está em **Alerta crítico**, não em **Normal**. Cada celular tem a sua própria chave.
:::

### Aplicativo de desktop

:::details Não há ícone de instalação na barra de endereços
Instale a partir de uma página do painel depois de entrar, por `https://`, no Edge ou no Chrome, ou no Safari no macOS Sonoma 14 ou posterior. Se o ícone não aparecer, o menu do navegador também o instala: veja [Instalação no Windows](/docs/mobile-desktop-apps/windows-installation#instalar-o-aplicativo).
:::

:::details Nenhuma notificação no desktop
Registre o navegador em **Configurações do usuário → Métodos de notificação**, aba **Push Notifications**, com **Registrar Dispositivo**, permita as notificações quando for perguntado, e verifique as configurações de notificação do próprio computador. Um OneUptime auto-hospedado precisa das chaves VAPID dele para as notificações do navegador.
:::

## Obter ajuda

Se algo aqui não corresponde ao que você vê, [abra uma issue no GitHub](https://github.com/OneUptime/oneuptime/issues) com a versão do seu aplicativo, no fim da tela **Settings** dele, e a plataforma que você usa.

## Próximos passos

:::cards
- [Visão geral dos aplicativos](/docs/mobile-desktop-apps/index): Qual aplicativo usar, e como eles chegam ao OneUptime.
- [Instalação no Android](/docs/mobile-desktop-apps/android-installation): Instalar e configurar o aplicativo no Android.
- [Instalação no iOS](/docs/mobile-desktop-apps/ios-installation): Instalar e configurar o aplicativo num iPhone ou iPad.
- [Notificações push](/docs/self-hosted/push-notifications): Como um OneUptime auto-hospedado envia os acionamentos, e os erros da Expo.
:::
