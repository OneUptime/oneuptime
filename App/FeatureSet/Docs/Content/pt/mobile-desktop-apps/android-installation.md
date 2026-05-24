# Guia de Instalação para Android

Instale o aplicativo nativo **OneUptime On-Call** para Android a partir da Google Play Store, ou faça o sideload do APK diretamente em dispositivos sem Google Play.

## Requisitos

- Celular ou tablet Android com **Android 8.0 (Oreo) ou posterior**
- Uma conta OneUptime ativa (ou o URL da sua instância auto-hospedada do OneUptime)
- Conexão com a internet para fazer login e receber notificações push

## Opção 1: Instalar pelo Google Play (Recomendado)

1. Abra a **Google Play Store** no seu dispositivo.
2. Pesquise por **"OneUptime On-Call"**, ou abra este link no seu dispositivo:
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. Toque em **Instalar**.
4. Após a instalação, toque em **Abrir** ou inicie o **OneUptime On-Call** pela gaveta de aplicativos.

## Opção 2: Instalar o APK Diretamente

Para dispositivos sem Google Play (por exemplo, GrapheneOS, /e/OS ou dispositivos Huawei), instale o APK oficial pelo GitHub Releases:

1. No seu dispositivo Android, abra este link:
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. Quando solicitado, permita que o seu navegador instale aplicativos desconhecidos:
   **Configurações → Apps → \[Seu navegador\] → Instalar apps desconhecidos → Permitir desta fonte**.
3. Abra o APK baixado e toque em **Instalar**.
4. Inicie o **OneUptime On-Call** pela gaveta de aplicativos.

O APK é compilado e assinado pelo OneUptime a partir da mesma fonte da versão da Play Store. As atualizações do aplicativo não são automáticas quando feito sideload — baixe o APK mais recente pelo link acima sempre que uma nova versão for lançada.

## Primeira Execução e Login

1. **URL do Servidor**
   - Se você usa o OneUptime Cloud, mantenha o padrão `https://oneuptime.com`.
   - Se você é auto-hospedado, insira o URL da sua instância do OneUptime (ex.: `https://oneuptime.example.com`).
   - O aplicativo verifica se o servidor está acessível antes de prosseguir.
2. **Entrar**
   - Insira o e-mail e a senha da sua conta OneUptime.
   - Opcionalmente, habilite o **desbloqueio biométrico** (impressão digital) para desbloqueios mais rápidos em execuções posteriores.
3. **Permitir Notificações**
   - Quando solicitado, toque em **Permitir** para que o aplicativo possa entregar chamados de plantão, alertas de incidentes e confirmações.

## Notificações Push

As notificações push são entregues através do Firebase Cloud Messaging (FCM) via Expo Push. Para garantir que os chamados cheguem até você de forma confiável durante o plantão:

1. Abra **Configurações → Apps → OneUptime On-Call → Notificações** e confirme que todas as categorias estão habilitadas.
2. Abra **Configurações → Apps → OneUptime On-Call → Bateria** e escolha **Sem restrições** (ou desative a otimização de bateria) para que o sistema operacional não atrase as notificações em segundo plano.
3. Permita que o aplicativo seja executado em segundo plano e desative quaisquer restrições do "Economia de Dados" para ele.
4. Se você usa dispositivos Samsung, também desative **Configurações → Cuidado com o dispositivo → Bateria → Limites de uso em segundo plano** para o OneUptime On-Call.
5. Adicione o OneUptime On-Call a quaisquer listas de exceção do **Do Not Disturb** (Não perturbar) para que os chamados continuem tocando durante seu turno de plantão.

## Atualizações

**Google Play:**
- As atualizações são instaladas automaticamente. Para acioná-las manualmente, abra **Play Store → Perfil → Gerenciar apps e dispositivo → Atualizações disponíveis → OneUptime On-Call → Atualizar**.

**Sideload do APK:**
- Baixe novamente o APK mais recente a partir do link do GitHub Releases acima e instale sobre o aplicativo existente — seus dados, URL do servidor e login são preservados.

## Desinstalação

1. **Mantenha pressionado** o ícone do **OneUptime On-Call** e toque em **Desinstalar**.
2. Ou abra **Configurações → Apps → OneUptime On-Call → Desinstalar**.
3. Confirme para remover o aplicativo.

Sua conta do OneUptime e as escalas de plantão são armazenadas no servidor e não são removidas ao desinstalar o aplicativo.

## Solução de Problemas

**"Erro de Rede" ao fazer login:**
- Verifique se o **URL do Servidor** está correto e acessível a partir do seu dispositivo.
- Se você está em uma rede corporativa ou VPN, certifique-se de que a instância do OneUptime está acessível.
- Confirme que o servidor é servido via HTTPS com um certificado válido.

**Não está recebendo notificações push:**
- Confirme que as notificações estão habilitadas em **Configurações → Apps → OneUptime On-Call → Notificações**.
- Desative a otimização de bateria para o OneUptime On-Call (veja Notificações Push acima).
- Certifique-se de que o Do Not Disturb está desativado, ou que o OneUptime On-Call está na lista de exceções.
- Saia da conta e entre novamente para atualizar o token de push registrado no servidor.
- Usuários auto-hospedados: confirme que as notificações push estão configuradas na sua instância do OneUptime (consulte o guia de [Notificações Push](/docs/self-hosted/push-notifications) para auto-hospedagem).

**Desbloqueio biométrico não funciona:**
- Cadastre uma impressão digital em **Configurações → Segurança → Impressão digital**.
- Reabilite o desbloqueio biométrico pela tela de **Configurações** dentro do aplicativo OneUptime On-Call.

**Instalação do APK bloqueada:**
- Você deve conceder ao navegador permissão para instalar aplicativos desconhecidos (veja a Opção 2 acima).
- Algumas operadoras ou perfis corporativos de dispositivos bloqueiam o sideload por completo; nesse caso, use a versão da Google Play.

**O aplicativo trava ao iniciar:**
- Atualize para a versão mais recente pelo Google Play ou pelo APK mais recente.
- Reinicie seu dispositivo.
- Se o problema persistir, desinstale e reinstale, depois faça login novamente.

## Suporte

Se você ainda precisar de ajuda, entre em contato através do seu painel do OneUptime ou abra uma issue no nosso [repositório do GitHub](https://github.com/OneUptime/oneuptime).
