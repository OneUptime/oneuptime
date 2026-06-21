# Global SSO (Single Sign-On em toda a instância)

O Global SSO permite que um **administrador da instância** (master admin) do OneUptime configure um único provedor de identidade SAML 2.0 ou OpenID Connect (OIDC) **uma vez no nível da instância** e o conecte a qualquer projeto no servidor. É a contraparte para toda a instância do SSO por projeto: em vez de cada proprietário de projeto configurar seu próprio provedor de identidade, um master admin configura um que pode servir toda a instância.

O Global SSO é um recurso da **OneUptime Enterprise Edition** e está disponível apenas em instâncias que executam a build da Enterprise Edition.

## Global SSO vs. SSO de Projeto

| | SSO de Projeto | Global SSO |
|---|---|---|
| Configurado por | Proprietário/admin do projeto (Project Settings) | Master admin da instância (Admin Dashboard) |
| Escopo | Um único projeto | Toda a instância — conectável a qualquer projeto |
| Resultado do login | Acesso a esse único projeto | Acesso a todos os projetos que o usuário pode alcançar |

## Configurando o Global SSO

1. **Abra o Admin Dashboard**
   - Faça login como master admin e abra **Admin** > **Settings** > **Global SSO** (para SAML) ou **Global OIDC** (para OpenID Connect).

2. **Crie um provedor**
   - Clique em **Create Global SSO**.
   - Para SAML: insira um **Name**, a **Sign On URL** e o **Issuer** do seu provedor de identidade, e cole o **Public Certificate**. Escolha os métodos de **Signature** e **Digest** (deixe os padrões — `RSA-SHA256` / `SHA256` — se estiver em dúvida).
   - Para OIDC: insira a **Discovery URL**, o **Issuer**, o **Client ID**, o **Client Secret**, os **Scopes** (devem incluir `openid`) e os nomes das declarações de **email** / **name**.

3. **Copie as URLs do OneUptime para o seu provedor de identidade**
   - Abra o provedor (clique na sua linha na lista) para revelar o card **Identity Provider URLs**.
   - Para SAML, copie a **ACS URL (Reply URL)** e o **Issuer (Entity ID)** para o seu IdP (Okta, Azure AD, OneLogin, JumpCloud e outros).
   - Para OIDC, copie a **Redirect URI** para a lista de redirecionamentos permitidos do seu IdP.

4. **Teste o provedor**
   - Use o link **Test this SSO provider** na página do provedor para executar um login de ponta a ponta através do seu provedor de identidade. O provedor deve estar **habilitado** para que o link funcione. Habilitar um provedor global apenas adiciona uma opção "Sign in with SSO" na página de login — nunca força o SSO nem bloqueia ninguém, portanto é seguro habilitar, testar e desabilitar novamente se necessário.

## Como os Usuários Fazem Login

Como um provedor global se comporta depende de você anexar ou não algum projeto a ele:

- **Nenhum projeto anexado (default-all / invite-first):** Os usuários podem fazer login com o provedor e alcançar **qualquer projeto do qual já sejam membros**. Novos usuários **não** são criados automaticamente — um usuário deve primeiro ser convidado para um projeto. Use isso para SSO em toda a empresa, onde as associações são gerenciadas em outro lugar.

- **Projetos anexados (provisionamento automático):** Abra o provedor e use a tabela **Attached Projects** para anexar um ou mais projetos, cada um com um conjunto de equipes padrão. Os usuários que fazem login são **provisionados automaticamente** nesses projetos e adicionados às equipes padrão no primeiro login. Adicione um projeto + equipes por vez para construir a lista; para alterar um anexo, exclua-o e adicione-o novamente.

Se você quiser impedir qualquer criação automática de conta mesmo quando há projetos anexados, habilite **Disable Sign Up with SSO** no provedor — os usuários devem então ser convidados antes de poderem fazer login.

## Aplicando o SSO

Configurar um provedor global não força ninguém a usá-lo; o login com senha ainda funciona. Para exigir o SSO, use os controles **Require SSO for Login**:

- **Por projeto:** um projeto pode exigir o SSO e, opcionalmente, exigir um provedor *específico* (de projeto ou global).
- **Em toda a instância:** **Admin** > **Settings** > **Authentication** tem uma opção **Require SSO for Login** que força o SSO para cada usuário em toda a instância. Os master admins permanecem isentos para que não possam ser bloqueados.

## Relacionado

- [SSO (SSO de Projeto)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
