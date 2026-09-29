# Aplicativos Mobile e Desktop do OneUptime

O OneUptime oferece duas formas de utilizar a plataforma fora do seu navegador:

- **Aplicativos mobile nativos** para iOS e Android, publicados na **Apple App Store** e no **Google Play**. Eles entregam chamados de plantão (on-call), alertas de incidentes e ações de confirmação diretamente no seu celular.
- **Aplicativos desktop instaláveis** para Windows, macOS e Linux, distribuídos como um Progressive Web App (PWA) instalado diretamente a partir do seu navegador. Eles fornecem ao painel do OneUptime sua própria janela, ícone e área de notificações no seu computador.

## Mobile (Aplicativos Nativos)

O aplicativo **OneUptime On-Call** é uma aplicação nativa criada com React Native. É distribuído através das lojas oficiais para que você receba atualizações automáticas, notificações push e desbloqueio biométrico.

- **iOS** — [Baixar na App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391). Requer iOS 15.0 ou posterior. Consulte o [Guia de Instalação para iOS](./ios-installation.md).
- **Android** — [Obter no Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Requer Android 8.0 ou posterior. Um [download direto do APK](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) também está disponível para dispositivos sem Google Play. Consulte o [Guia de Instalação para Android](./android-installation.md).

## Desktop (Progressive Web App)

O painel web do OneUptime é um Progressive Web App, então você pode instalá-lo como um aplicativo desktop a partir de um navegador moderno, sem passar por nenhuma loja.

- [Instalação no Windows](./windows-installation.md)
- [Instalação no macOS](./macos-installation.md)
- [Instalação no Linux](./linux-installation.md)

### Primeiros Passos no Desktop

1. Abra sua instância do OneUptime em um navegador baseado em Chromium (Chrome, Edge) ou no Safari.
2. Procure pelo botão **Instalar** na barra de endereço ou em **Arquivo → Adicionar ao Dock / Aplicativos → Instalar este site como um aplicativo**.
3. Inicie o aplicativo instalado a partir do Menu Iniciar, Launchpad ou do iniciador de aplicativos.

### Solução de Problemas no Desktop

**A opção de instalar não aparece:**

- Certifique-se de estar usando um navegador compatível.
- Confirme que sua instância do OneUptime é servida via HTTPS.
- Atualize a página ou limpe o cache do navegador.

**As notificações push não funcionam:**

- Conceda permissões de notificação quando o navegador solicitar.
- Verifique as configurações de notificação do sistema operacional para o navegador.
- Usuários auto-hospedados: confirme que as notificações push estão configuradas na sua instância do OneUptime.

## Suporte

- Problemas específicos do mobile: consulte os guias de instalação do [iOS](./ios-installation.md) ou do [Android](./android-installation.md).
- Problemas específicos do desktop: consulte os guias de instalação do [Windows](./windows-installation.md), [macOS](./macos-installation.md) ou [Linux](./linux-installation.md).
- Dúvidas gerais: consulte a página de [Perguntas Frequentes e Solução de Problemas](./faq-troubleshooting.md).
- Reporte bugs ou solicite funcionalidades no nosso [repositório do GitHub](https://github.com/OneUptime/oneuptime).
