# Convidar pessoas

As pessoas entram em um projeto por convite. Você convida o endereço de e-mail de alguém para uma equipe, a pessoa aceita e, a partir daí, a equipe dela decide o que ela pode fazer. Esta página mostra como convidar pessoas, o que elas veem e como mudar ou encerrar o acesso delas depois.

:::cards
- [Convidar alguém](#convidar-alguém): Um endereço de e-mail e uma equipe.
- [Aceitar um convite](#aceitar-um-convite): O que a pessoa convidada vê e faz.
- [Mudar as equipes de alguém](#mudar-as-equipes-de-alguém): Dar mais acesso, ou menos.
- [Remover alguém](#remover-alguém-do-projeto): O que sair do projeto leva embora.
:::

## Como funciona um convite

```mermaid title="De um convite a um membro"
flowchart TB
    invite["Você convida um e-mail<br/>para uma equipe"] --> sent["Convite enviado:<br/>ainda sem acesso"]
    sent --> mail["A pessoa recebe um<br/>e-mail: criar uma conta<br/>ou entrar"]
    mail --> decide{"Ela aceita?"}
    decide -->|"Aceitar"| member["Membro: valem as<br/>permissões da equipe"]
    decide -->|"Recusar"| deleted["O convite<br/>é excluído"]
```

- **A equipe decide o que a pessoa pode fazer.** Ninguém tem permissões próprias: uma pessoa pode fazer o que as equipes de que participa permitem. Veja [Usuários, equipes e permissões](/docs/permissions/index).
- **Nada é concedido até a pessoa aceitar.** Um convite pendente aparece como **Convite enviado** e não dá acesso ao projeto.
- **Uma aceitação vale para o projeto todo.** Aceitar um convite aceita todos os outros convites que a pessoa tem para o mesmo projeto. Um membro que você adiciona depois a outra equipe já entra nela, sem nada para aceitar.

## Antes de começar

- **Uma função que pode convidar.** Project Owner, Project Admin ou uma função com a permissão **Invite New Members**. Você só pode convidar pessoas para uma equipe cujas permissões você mesmo tem, porque um convite dá a elas o acesso da equipe. Um Project Admin sem nenhum bloqueio conta, para isso, como detentor de tudo o que Project Admin já pode fazer: pode convidar pessoas para **Members** ou para uma equipe com qualquer papel mais restrito, mas não para uma equipe que tenha Project Owner, uma permissão de faturamento, **Delete Project**, **Edit Project**, **Edit Team** ou **Invite New Members**.
- **No OneUptime Cloud, espaço no seu plano.** Cada pessoa do projeto é um assento na fatura dele, a partir do momento em que é convidada. O plano Free tem espaço para uma pessoa. Veja [Cobrança e uso](/docs/configuration/billing#seu-plano-e-seus-assentos).
- **Sem SCIM Push Groups.** Enquanto seu provedor de identidade gerencia as equipes do projeto pelo SCIM Push Groups, você convida e remove pessoas lá, não no OneUptime.

## Convidar alguém

:::steps
### Abrir Usuários

Acesse **Produtos → Configurações → Usuários**. A lista **Usuários** mostra todas as pessoas do projeto, as equipes delas e se já entraram.

### Clicar em Convidar Usuário

Clique em **Convidar Usuário**. A caixa de diálogo **Convidar Novo Usuário** se abre.

### Informar o endereço de e-mail

Digite o endereço em **E-mail**. Se nenhuma conta do OneUptime usa esse endereço ainda, a caixa de diálogo também pede um **Nome**, com o qual a nova conta começa.

### Escolher a equipe

**Equipe** começa na equipe de membros do projeto: a equipe que tem Project Member para o projeto todo, ou então a chamada Members. Escolha outra equipe para dar mais acesso, ou menos. **Equipe** fica vazia quando o projeto não tem essa equipe, ou quando você mesmo não poderia convidar ninguém para ela.

### Enviar o convite

Clique em **Convidar**. O OneUptime envia o convite por e-mail e abre a página da pessoa. Ela aparece como **Convite enviado** até aceitar.
:::

> [!TIP]
> Convide as pessoas para a equipe mais restrita que permita a elas fazer o trabalho. Você pode adicioná-las a mais equipes depois, e cada equipe em que entram amplia o que podem fazer.

## Aceitar um convite

O e-mail de convite nomeia o projeto. O botão dele é **Create Your Account** para quem ainda não tem conta no OneUptime e **Sign In to OneUptime** para quem já tem. Depois de entrar, a pessoa aceita em um de dois lugares:

| Onde ela está | O que ela vê | Onde ela clica |
| --- | --- | --- |
| Ainda em nenhum projeto | O convite, na página em que ela chega depois de entrar | **Accept & Join**, ou **Decline** |
| Já em outro projeto | O convite pendente no sino no canto superior direito, que abre **Convites do projeto** | **Aceitar**, ou **Rejeitar** |

Ao aceitar, a pessoa entra no projeto na hora, com as permissões da equipe dela e a configuração de notificações com que todo membro começa: veja [Com o que você começa](/docs/notifications/index#com-o-que-você-começa). Recusar exclui o convite, então entrar depois exige um novo.

## Ver quem está no projeto

**Usuários** tem uma linha por pessoa:

| Coluna | O que mostra |
| --- | --- |
| **Usuário** | O nome e o endereço de e-mail dela. |
| **Equipes** | Cada equipe do projeto de que ela participa, ou para a qual foi convidada. |
| **Status** | **Membro** depois que ela entrou, com o número de convites para outras equipes que ainda não aceitou. **Convite enviado** até lá. |

Filtre a lista por **Usuário**, **Status** ou **Equipe**. Clique em uma linha para abrir a página da pessoa:

| Página | Para que serve |
| --- | --- |
| **Perfil** | O nome, o endereço de e-mail, a foto e o ID de usuário dela. |
| **Equipes** | As equipes de que ela participa. Adicione ou remova uma equipe aqui. |
| **Prontidão**, **Métodos de notificação**, **Regras de Plantão** | Se ela pode ser acionada, e como. Visível para Project Owners, Project Admins, a própria pessoa e quem pode ler as regras de notificação dos outros. Veja [Prontidão e relatórios](/docs/on-call/readiness). |
| **Campos personalizados** | Os campos personalizados do projeto para pessoas, quando há algum. |
| **Remover do Projeto** | Tirar a pessoa do projeto. |

## Mudar as equipes de alguém

:::steps
### Abrir a página Equipes da pessoa

Em **Usuários**, clique na pessoa e depois em **Equipes**.

### Adicionar a pessoa a uma equipe

Clique em **Convidar**, escolha a **Equipe** e clique em **Convidar** na caixa de diálogo. Um membro entra na nova equipe na hora. Quem ainda não entrou recebe mais um convite, e aceitar qualquer um deles aceita os dois.

### Tirar a pessoa de uma equipe

Clique em **Remover** na linha da equipe. Se for a última equipe em que ela entrou, removê-la a tira do projeto, e a caixa de diálogo avisa antes que qualquer coisa mude.
:::

A equipe Owners sempre mantém pelo menos um membro que entrou, para que um projeto nunca perca o último proprietário.

## Remover alguém do projeto

Em **Usuários**, abra o menu da linha da pessoa, **⋯**, e clique em **Remover do Projeto**. Ou abra a pessoa e escolha **Remover do Projeto** no menu lateral dela. Para remover várias pessoas de uma vez, selecione as linhas delas e exclua a seleção: cada uma é removida do mesmo jeito.

Remover alguém tira a pessoa de todas as equipes do projeto. Ela perde o acesso na hora, mesmo com a sessão aberta, sai das escalas de plantão e das regras de escalonamento e deixa de receber as notificações do projeto. A conta dela no OneUptime não é excluída, e você pode convidá-la de novo. [Usuários, equipes e permissões](/docs/permissions/index#usuários) lista tudo o que sair de um projeto leva junto.

## Outras formas de entrar

- **Login único.** Quem entra pela primeira vez com o provedor de identidade do projeto passa a fazer parte das equipes que o provedor indica. Veja [Funções e equipes para usuários de SSO](/docs/identity/sso#funções-e-equipes-dos-usuários-de-sso).
- **SCIM.** Seu provedor de identidade cria as pessoas e as adiciona às equipes padrão da conexão. Veja [SCIM](/docs/identity/scim#como-um-usuário-de-projeto-é-provisionado).
- **O Admin Dashboard.** Em uma instalação auto-hospedada, um administrador mestre pode adicionar alguém a um projeto e aceitar o convite por essa pessoa. Veja [Usuários, equipes e permissões](/docs/permissions/index#usuários).

## Solução de problemas

:::details "This user has already been invited to this team"
A pessoa já está nessa equipe, como membro ou com um convite que não aceitou. Abra-a em **Usuários** para ver as equipes dela, ou convide-a para outra equipe.
:::

:::details "You have reached the user limit for the free plan"
No OneUptime Cloud, um projeto no plano Free tem espaço para uma pessoa. Mude o plano e convide de novo. Veja [Mudar o plano](/docs/configuration/billing#mudar-o-plano).
:::

:::details "Too many invitations were sent to this email address in the last hour"
Um endereço pode receber 10 convites por hora, para projetos e páginas de status privadas juntos, seja quem for que os envie. Aguarde uma hora e convide a pessoa de novo.
:::

:::details O e-mail de convite não chegou, ou o link expirou
O convite não depende do e-mail. Peça à pessoa que se cadastre com o endereço convidado: o OneUptime envia para esse endereço um novo link para terminar de criar a conta. Quem já tem conta entra e encontra o convite esperando.
:::

:::details Convidar Usuário diz que os usuários são gerenciados pelo SCIM Push Groups
Seu provedor de identidade gerencia as equipes do projeto. Convide ou remova pessoas no provedor de identidade, ou desative o Push Groups em **Configurações do projeto → Segurança → SCIM** para gerenciá-las aqui.
:::

## Próximos passos

:::cards
- [Usuários, equipes e permissões](/docs/permissions/index): Decidir o que cada equipe pode fazer.
- [Configurações do projeto](/docs/configuration/project-settings): Tudo o que vale para o projeto inteiro.
- [Sua conta](/docs/introduction/your-account): Login, perfil e os projetos de que você faz parte.
- [SCIM](/docs/identity/scim): Deixar seu provedor de identidade gerenciar pessoas e equipes.
:::
