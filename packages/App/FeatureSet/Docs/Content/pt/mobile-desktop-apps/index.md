# Visão geral dos aplicativos

O OneUptime tem um aplicativo para o seu celular e outro para o seu computador. O **OneUptime On-Call**, para iPhone, iPad e Android, aciona você quando está de plantão e permite confirmar e resolver de onde estiver. No Windows, macOS e Linux, o painel do OneUptime é instalado a partir do navegador como um aplicativo de desktop, com uma janela própria. Os dois funcionam com o OneUptime Cloud e com um OneUptime hospedado por você.

:::cards
- [Escolher um aplicativo](#escolher-um-aplicativo): Para que serve cada aplicativo, lado a lado.
- [Como os aplicativos chegam ao OneUptime](#como-os-aplicativos-chegam-ao-oneuptime): Por onde passam o login e os acionamentos de plantão.
- [Obter o aplicativo móvel](#obter-o-aplicativo-móvel): Pela App Store, pelo Google Play ou pelo GitHub.
- [Obter o aplicativo de desktop](#obter-o-aplicativo-de-desktop): Instalar o painel pelo Edge, Chrome ou Safari.
:::

## Escolher um aplicativo

|  | Aplicativo móvel | Aplicativo de desktop |
| --- | --- | --- |
| O que é | OneUptime On-Call, um aplicativo nativo para iPhone, iPad e Android | O painel do OneUptime, instalado pelo seu navegador |
| Onde obter | A App Store, o Google Play, ou um APK do GitHub | O seu próprio OneUptime: não há nada para baixar |
| Acionamentos de plantão | Notificações push, que podem tocar mesmo no modo silencioso e no Não Perturbe | Notificações do navegador, depois que você registra o navegador |
| O que você pode fazer | Incidentes, alertas, casos de segurança, monitores e quem está de plantão; confirmar, resolver, aprovar etapas de playbook e adicionar notas | Tudo o que o painel faz |
| Atualizações | Pela loja, ou instalando um APK mais novo | Sempre que abre, ele carrega o painel do seu OneUptime |
| Funciona em | iOS 16.4 ou posterior, Android 7.0 ou posterior | Windows, macOS e Linux, com Edge ou Chrome, ou Safari no macOS Sonoma 14 ou posterior |

Você pode usar os dois: deixe o aplicativo de desktop aberto no trabalho, e deixe o celular acordar você à noite.

## Como os aplicativos chegam ao OneUptime

```mermaid title="Como os acionamentos de plantão chegam ao seu celular e ao seu computador"
flowchart TB
    OneUptime["O seu OneUptime:<br/>Cloud ou auto-hospedado"]
    Expo["Serviço push da Expo,<br/>depois Apple ou Google"]
    WebPush["O serviço push<br/>do seu navegador"]
    Phone["OneUptime On-Call<br/>no seu celular"]
    Desktop["O aplicativo de desktop<br/>no seu computador"]
    OneUptime -->|"para um celular"| Expo
    OneUptime -->|"para um navegador<br/>registrado"| WebPush
    Expo -->|"notificação push"| Phone
    WebPush -->|"notificação"| Desktop
```

O aplicativo móvel faz login no seu OneUptime e registra o celular em cada projeto de que você participa. A partir daí, o OneUptime envia as notificações push do celular, entre elas os acionamentos de plantão, pelo serviço push da Expo, que as entrega à Apple ou ao Google. Por padrão, um OneUptime auto-hospedado as envia pelo relay push do OneUptime, então não precisa de conta própria na Apple, no Google ou na Expo: veja [Notificações push](/docs/self-hosted/push-notifications).

O aplicativo de desktop é o próprio painel, numa janela própria. Ele mostra notificações depois que você registra o navegador dele para notificações push: as páginas do Windows, macOS e Linux mostram como.

## Antes de começar

- Uma conta num projeto do OneUptime. Para ser acionado, você também precisa estar de plantão: veja [Regras de escalonamento](/docs/on-call/escalation-rules).
- O endereço do seu OneUptime. No OneUptime Cloud é `https://oneuptime.com`; um OneUptime auto-hospedado tem o seu, por exemplo `https://oneuptime.example.com`.
- O seu OneUptime servido por HTTPS. O aplicativo móvel não se conecta por HTTP simples, e os navegadores só mostram notificações, e o Edge e o Chrome só instalam aplicativos, para sites HTTPS.

## Obter o aplicativo móvel

:::steps
### Instalar o OneUptime On-Call
Baixe-o na [App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) num iPhone ou iPad, ou no [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall) no Android. Para um celular Android sem Google Play, instale o [APK](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk). Os mesmos links estão no painel, em **Configurações do projeto → Notificações → Aplicativos móveis**.

### Conectá-lo ao seu OneUptime
Abra o aplicativo, mantenha `https://oneuptime.com` para o OneUptime Cloud ou digite o endereço do seu próprio OneUptime, e faça login com a sua senha, uma chave de acesso ou login único.

### Permitir as notificações
Permita-as quando o celular perguntar. O aplicativo registra o celular em cada um dos seus projetos, e os seus acionamentos de plantão passam a chegar a ele.
:::

Cada etapa em detalhe, com o que verificar depois: [Instalação no Android](/docs/mobile-desktop-apps/android-installation) e [Instalação no iOS](/docs/mobile-desktop-apps/ios-installation).

## Obter o aplicativo de desktop

:::steps
### Abrir o seu painel
Faça login no seu OneUptime no Microsoft Edge ou no Google Chrome, ou no Safari num Mac.

### Instalá-lo
No Edge ou no Chrome, clique no ícone de instalação à direita da barra de endereços. No Safari, escolha **Arquivo → Adicionar ao Dock**.

### Abri-lo como qualquer outro aplicativo
Ele abre numa janela própria, pelo menu Iniciar, pelo Dock ou pelo seu iniciador de aplicativos.
:::

Cada navegador passo a passo: [Instalação no Windows](/docs/mobile-desktop-apps/windows-installation), [Instalação no macOS](/docs/mobile-desktop-apps/macos-installation) e [Instalação no Linux](/docs/mobile-desktop-apps/linux-installation).

## Próximos passos

:::cards
- [Instalação no Android](/docs/mobile-desktop-apps/android-installation): Instalar o aplicativo no Android, fazer login e verificar que os acionamentos chegam.
- [Instalação no iOS](/docs/mobile-desktop-apps/ios-installation): Instalar o aplicativo num iPhone ou iPad e ativar os alertas críticos.
- [Instalação no Windows](/docs/mobile-desktop-apps/windows-installation): Instalar o painel pelo Edge ou pelo Chrome.
- [Instalação no macOS](/docs/mobile-desktop-apps/macos-installation): Adicionar o painel ao Dock pelo Safari, Chrome ou Edge.
- [Instalação no Linux](/docs/mobile-desktop-apps/linux-installation): Instalar o painel pelo Chrome, Chromium ou Edge.
- [Perguntas frequentes e solução de problemas](/docs/mobile-desktop-apps/faq-troubleshooting): Respostas, soluções, e o que fazer quando um celular para de receber acionamentos.
:::
