# Sua conta

Sua conta é como o OneUptime conhece você: o e-mail e a senha com que você entra, seu nome e seu fuso horário, e o que protege o seu login. Uma conta pode pertencer a muitos projetos, e estas configurações acompanham você em cada um deles. Como o OneUptime contata você, e quando aciona você, se configura em cada projeto, em **Configurações do usuário**.

```mermaid title="O que pertence à sua conta, e o que cada projeto guarda para você"
flowchart TB
    account["Sua conta:<br/>login e perfil"] --> projectA["Projeto A"]
    account --> projectB["Projeto B"]
    projectA --> settingsA["Configurações do usuário em A:<br/>como você é acionado"]
    projectB --> settingsB["Configurações do usuário em B:<br/>como você é acionado"]
```

:::cards
- [Seu perfil](#seu-perfil): Seu nome, seu e-mail, seu fuso horário e sua foto.
- [Entrar com segurança](#entrar-com-segurança): Sua senha, suas chaves de acesso e a autenticação em dois fatores.
- [Seus projetos](#seus-projetos): Trocar de projeto, criar um e aceitar convites.
- [Configurações do usuário](#o-que-cada-projeto-guarda-para-você): Como o OneUptime contata você em cada projeto.
:::

## O menu do usuário

Clique na sua foto, no canto superior direito do painel.

| Item | O que faz |
| --- | --- |
| **Perfil** | Abre **Perfil do usuário**: seu nome, seu e-mail, seu fuso horário, sua foto e a segurança do seu login. |
| **Configurações de admin** | Abre o Admin Dashboard. Só os administradores principais de uma instalação auto-hospedada o veem. |
| **Tema escuro** | Muda o painel para o tema escuro. No tema escuro, o item se chama **Tema claro**. |
| **Sair** | Encerra sua sessão. |

**Perfil do usuário** tem o próprio menu lateral. **Básico** contém **Visão geral** e **Foto do perfil**. **Segurança** e **Zona de perigo** ficam recolhidas: clique no título de uma seção para abri-la.

## Seu perfil

:::steps
### Abrir seu perfil

Clique na sua foto, no canto superior direito, e escolha **Perfil**. A página **Visão geral** abre no cartão **Informações básicas**: seu nome, seu e-mail e seu fuso horário.

### Editar seus dados

Clique em **Editar: Usuário** e mude o que precisar:

- **E-mail**: o endereço com que você entra. Se você o mudar, vai verificar o novo endereço de novo.
- **Nome completo**: o nome que sua equipe vê em todo o OneUptime.
- **Fuso horário**: o fuso horário em que o painel mostra e lê os horários, e o dos horários nas notificações enviadas a você.

Clique em **Salvar alterações**.

### Adicionar uma foto

Escolha **Foto do perfil**, clique em **Update Profile Picture** e envie uma imagem. Ela aparece no seu menu do usuário, e ao lado do seu nome nas listas de pessoas.
:::

> [!NOTE]
> Na primeira vez que você entra em um navegador, o OneUptime salva o fuso horário desse navegador no seu perfil. Se depois você entrar onde o navegador tem outro fuso horário, o painel pergunta se deve **Atualizar Fuso Horário**. Feche a pergunta, e ele não pergunta de novo para esse fuso horário.

## Entrar com segurança

Expanda **Segurança** no menu lateral de **Perfil do usuário**. Ela tem três páginas.

| Página | Para que serve |
| --- | --- |
| **Gerenciamento de senhas** | Definir uma senha nova. |
| **Passkeys** | Entrar sem senha, com sua digital, seu rosto, o bloqueio de tela ou uma chave de segurança. |
| **Two-factor authentication** | Pedir uma segunda etapa depois da senha: um código de um aplicativo, ou uma chave de segurança. |

### Mudar sua senha

:::steps
1. Abra **Segurança → Gerenciamento de senhas**.
2. Digite a nova senha em **Senha** e de novo em **Confirmar senha**. Ela precisa ter pelo menos 6 caracteres.
3. Clique em **Atualizar Senha**.
:::

### Adicionar uma chave de acesso

:::steps
1. Abra **Segurança → Passkeys** e clique em **Add Passkey**.
2. Dê a ela um nome que você reconheça, como seu dispositivo ou seu gerenciador de senhas, e clique em **Create Passkey**.
3. Siga o aviso do navegador para salvar a chave de acesso.
:::

Na próxima vez, escolha **Entrar com uma chave de acesso** na página de login.

### Ativar a autenticação em dois fatores

A autenticação em dois fatores vale quando você entra com sua senha. Adicione primeiro uma segunda etapa, e depois ative-a.

:::steps
### Adicionar um aplicativo autenticador

Abra **Segurança → Two-factor authentication**. Em **Authenticator apps**, adicione um aplicativo e dê um nome a ele. Escaneie o código QR com um aplicativo como 1Password, Google Authenticator ou Microsoft Authenticator, digite o código de 6 dígitos que ele mostra e clique em **Verify and finish**. Para usar uma chave USB ou NFC, adicione-a em **Security keys**.

### Guardar seus códigos de backup

Na primeira vez que você adiciona um aplicativo, uma chave ou uma chave de acesso, o OneUptime mostra **Your backup codes**. Cada código permite entrar uma vez se você perder o aplicativo ou a chave. Copie-os ou baixe-os, marque a caixa dizendo que você os guardou e clique em **Concluído**.

### Ativar

No topo da página, clique em **Enable two-factor authentication** e confirme. O cartão agora mostra **Habilitado**. A partir do seu próximo login com senha, o OneUptime pede a sua segunda etapa.
:::

> [!TIP]
> Seus códigos de backup estão acabando? **Regenerate codes** na mesma página dá a você um conjunto novo, e os códigos antigos param de funcionar na hora.

## Seus projetos

Você pode pertencer a quantos projetos quiser. O seletor de projetos, no canto superior esquerdo do painel, lista todos eles: escolha um para trocar.

- **Criar um projeto**: abra o seletor de projetos e clique em **Criar Novo Projeto**. Em uma instalação auto-hospedada, o administrador pode reservar a criação de projetos aos administradores.
- **Aceitar um convite**: quando alguém convida você, o sino no canto superior direito mostra o convite pendente e abre **Convites do projeto**. Ali você pode **Aceitar** ou clicar em **Reject**.
- **Sair de um projeto**: peça a alguém que gerencia os usuários do projeto para remover você, com **Remover do Projeto** na página **Usuários** dele.

## O que cada projeto guarda para você

As **Configurações do usuário**, à direita na barra abaixo da barra do topo, são só suas, e cada projeto tem as suas. Abra-as em cada projeto em que você está de plantão.

| Página | Para que serve | Saiba mais |
| --- | --- | --- |
| **Lista de configuração** | Guia você por tudo o que vem a seguir, e mostra o que falta fazer. | |
| **Métodos de notificação** | Os e-mails, números de telefone, aplicativos e webhooks pelos quais o OneUptime pode contatar você. Seu e-mail de login é adicionado para você. | |
| **Regras de Plantão** | Qual método usar, e depois de quanto tempo, quando uma política de plantão aciona você. | [Regras de escalonamento](/docs/on-call/escalation-rules) |
| **Configurações de notificação** | Que novidades você recebe sobre incidentes, alertas, monitores e mais, e por qual canal. | |
| **Preferências de e-mail** | Quantos e-mails você recebe: um a um, ou agrupados. | [Resumo de notificações](/docs/emails/notification-rollup) |
| **Registros de plantão** | Cada acionamento enviado a você, e o que aconteceu com ele. | |
| **Números de telefone recebidos** | O número para o qual uma política de chamadas recebidas liga para você. | [Política de chamadas recebidas](/docs/on-call/incoming-call-policy) |
| **Feed de calendário** | Seus turnos de plantão no Google Calendar, Apple Calendar ou Outlook. | [Feeds de calendário](/docs/on-call/calendar-feeds) |

## Idioma e tema

Os dois ficam salvos no seu navegador, não na sua conta, então configure-os de novo em outro navegador ou dispositivo.

- **Idioma**: o painel começa no idioma do seu navegador. Para mudá-lo, use o menu de idiomas no rodapé de qualquer página. Esta documentação tem seu próprio menu de idiomas, no topo.
- **Tema**: escolha **Tema escuro** no menu do usuário. O painel começa no tema claro.

## Excluir sua conta

Abra **Zona de perigo → Excluir conta**. Você só pode excluir sua conta quando não estiver em nenhum projeto: a página lista os projetos em que você ainda está. Saia deles primeiro, depois clique em **Excluir conta** e confirme. Excluir sua conta é permanente e não pode ser desfeito.

## Solução de problemas

:::details Não recebi o e-mail para verificar meu endereço
Entrar de novo envia um link novo: confira também sua pasta de spam. Se você não conseguir entrar, use **Esqueceu a senha?** na página de login. O link de redefinição também verifica o seu endereço.
:::

:::details Perdi meu aplicativo autenticador
Na segunda etapa do login, escolha **Perdeu o acesso ao seu autenticador?** e digite um dos seus códigos de backup. Depois abra **Segurança → Two-factor authentication** e adicione seu novo aplicativo. Sem códigos de backup, peça a um administrador da sua instalação do OneUptime para redefinir a autenticação em dois fatores da sua conta.
:::

:::details Os horários do painel estão uma hora errados
O painel mostra os horários no **Fuso horário** do seu perfil, não no do seu computador. Confira em **Perfil do usuário → Visão geral**.
:::

## Próximos passos

:::cards
- [Página inicial e atalhos](/docs/introduction/home): Encontrar o caminho no painel.
- [Regras de escalonamento](/docs/on-call/escalation-rules): Como uma política de plantão aciona você.
- [Usuários, equipes e permissões](/docs/permissions/index): O que decide o que você pode fazer em um projeto.
- [SSO](/docs/identity/sso): Entrar pelo provedor de identidade da sua empresa.
:::
